---
id: feat-029-screen-state-fixtures
type: feature
status: completed
outcome: shipped
approved-at: 2026-04-28
approved-by: human
completed-at: 2026-04-28
author-agent: claude-opus-4-7
created: 2026-04-28
updated: 2026-04-28
parent-plan: feat-028-visual-parity-verifier
supersedes: null
superseded-by: null
branch: feat/screen-state-fixtures
affected-files:
  - .claude/skills/screens/SKILL.md (emit per-screen fixture authoring)
  - .claude/skills/parity-verify/SKILL.md (consume fixtures pre-comparison)
  - scripts/derive-fixture-from-mockup.mjs (Pattern A — auto-extract)
  - scripts/seed-app-state.mjs (apply fixture to running dev server via __seedFromUrl helper)
  - scripts/diff-kit-skeleton.mjs (extend with --fixture / --flow-context routing)
  - packages/orchestrator-contracts/src/screen-fixtures.ts (Zod schema)
  - schemas/screen-fixture.schema.json
  - .claude/skills/agents/front-end/react-next/SKILL.md (require __seedFromUrl dev-only handler)
  - .claude/skills/agents/front-end/svelte-kit/SKILL.md (same)
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-029 — Screen state fixtures (close the empty-app blind spot in feat-028)

## Summary

feat-028's visual parity verifier compares the built app's rendered DOM against the designed mockups. But the built app starts with **empty state** (no boards, no cards, no settings configured) while the mockups show **populated state** (3 boards, 12 cards with priorities + tags, configured settings). Without seeding the app to match the mockup's data shape, the DOM-diff is comparing apples to oranges — every screen comes back as "everything missing".

This feature closes the gap with a **hybrid fixture system**:

- **Pattern A (auto-derive)**: parse each mockup HTML for visible cards/columns/tags/settings → emit `<id>.fixture.json` matching the app's data schema
- **Pattern B (flow-context)**: for dynamic screens that can't be statically seeded (e.g. `search-empty` requires a search-query mid-flow), walk the flow synthesizer's transitions to GET the app into state before snapshotting
- **Seed-from-URL helper**: every project gets a dev-only `__seedFromUrl` handler that applies a JSON fixture to localStorage on `?_seed=<fixture-id>` query param. The verifier navigates to `/?_seed=home` → app populates → DOM matches mockup

Without this, feat-028 ships green but provides no signal — every parity check fails for the wrong reason.

## Goals

1. Auto-derive fixtures from mockups for the static-state subset (estimated 80% of screens — `home`, `card-modal`, `settings`, `empty-no-board`, `not-found`)
2. Flow-context fallback for dynamic-state screens (`search-empty`, `card-modal` mid-edit, etc.) — reuse feat-022's flow synthesizer
3. Build-time `__seedFromUrl` helper enforced by builder skills; dev-only (excluded from production builds)
4. feat-028's differ accepts `--fixture <path>` OR `--via-flow <flowId>` routing per screen
5. Fixture schema versioned + validated against `@repo/types`

## Non-goals (deferred)

- Production-mode fixtures (security risk; only dev-mode `?_seed=` query param)
- Cross-project fixture sharing (each project's fixtures are self-contained)
- Fixture authoring UI (operator edits JSON directly if auto-derive misses)
- Time-travel / multi-step fixture orchestration (one fixture per screen for v1; stateful sequences via Pattern B flow-context)

## Approach

5 phases. Phase 0 = fixture schema. Phase 1 = auto-derive. Phase 2 = seed helper. Phase 3 = flow-context fallback. Phase 4 = differ integration.

### Phase 0 — Fixture schema (~80 LOC + 10 tests)

New `packages/orchestrator-contracts/src/screen-fixtures.ts`:

```ts
export const ScreenFixtureSchema = z.object({
  version: z.literal("1.0"),
  screenId: z.string(), // e.g. "home"
  derivedFrom: z.enum(["mockup-auto", "flow-context", "hand-authored"]),
  derivedAt: z.string().datetime(),
  storeState: z.record(z.unknown()), // shape matches app's store schema
  routePath: z.string().default("/"), // where to navigate after seeding
  preActions: z
    .array(
      z.object({
        // for flow-context: actions to perform after seed before snapshot
        kind: z.enum(["click", "type", "press", "wait"]),
        selector: z.string().optional(),
        value: z.string().optional(),
        timeoutMs: z.number().optional(),
      }),
    )
    .default([]),
});
```

Per-project fixtures live at `docs/screens/webapp/fixtures/<screenId>.fixture.json` (gitignored — derived per run).

JSON Schema mirror in `schemas/screen-fixture.schema.json`.

### Phase 1 — Auto-derive from mockup (~250 LOC + 15 tests)

`scripts/derive-fixture-from-mockup.mjs`:

- Inputs: `<projectDir>` + `--screen=<id>`
- Loads `docs/screens/webapp/<id>.html` via Playwright at desktop viewport (mockup is static; no app server needed)
- Walks DOM looking for kit-primitive instances with extractable data:
  - `[data-kit-component="Card"]` → text content = title; child `[data-kit-priority]` = priority; child `[data-kit-tag]` collection = tags
  - `[data-kit-component="Column"]` → header text = title; cards within = cardIds
  - `[data-kit-component="Board"]` → header text = title
- Maps the parsed structure into the app's `@repo/types` schema (Board, Column, Card, Tag types)
- Writes `docs/screens/webapp/fixtures/<id>.fixture.json` with `derivedFrom: "mockup-auto"`
- Per-screen fallback: if a screen's data isn't introspectable (e.g. modal open state), emit a stub fixture with a warning + flag for Pattern B

Gracefully degrades: missing primitive types or unknown structures → fall back to "hand-authored" stub with TODOs.

### Phase 2 — Seed-from-URL dev helper (~100 LOC + builder-skill updates)

A pattern every generated project gets at scaffold time. New convention enforced by `.claude/skills/agents/front-end/react-next/SKILL.md`:

In `apps/web/src/lib/dev-seed.ts` (or framework equivalent):

```ts
// dev-only helper — guarded by NODE_ENV !== "production"
// Reads ?_seed=<id> from URL, fetches /docs/screens/webapp/fixtures/<id>.fixture.json,
// applies to localStorage as if user had imported a backup,
// reloads page to take effect.
```

Wire into the root layout/component:

```tsx
import { useDevSeedOnMount } from "@/lib/dev-seed";

export function Providers({ children }) {
  useDevSeedOnMount(); // no-op in production
  return <>{children}</>;
}
```

Builder skill enforces:

- The helper file MUST exist + be wired into Providers
- Production builds MUST exclude it (via NODE_ENV check OR conditional import)
- Self-verify command: `grep -c "useDevSeedOnMount" apps/web/src/components/providers*.tsx` returns ≥1

Same convention for svelte-kit (different syntax).

### Phase 3 — Flow-context fallback (~150 LOC + 8 tests)

For screens where Pattern A can't extract a static fixture (e.g. `search-empty`):

- Mark the screen in its fixture file as `derivedFrom: "flow-context"`
- Define `preActions[]`: an ordered list of click/type/press actions that get from the prior screen to the target state
- Example for `search-empty`:
  ```json
  {
    "screenId": "search-empty",
    "derivedFrom": "flow-context",
    "storeState": "@inherit-from:home", // start from home fixture
    "routePath": "/",
    "preActions": [
      { "kind": "click", "selector": "[aria-label='Search']" },
      {
        "kind": "type",
        "selector": "input[type='search']",
        "value": "zzznoresult"
      },
      { "kind": "wait", "timeoutMs": 500 }
    ]
  }
  ```

`scripts/seed-app-state.mjs`: orchestrates seed → navigate → preActions → ready-for-snapshot. Used by feat-028's differ.

### Phase 4 — Differ integration (~80 LOC + 8 tests)

Extend `scripts/diff-kit-skeleton.mjs` (added by feat-028):

- New flag: `--fixture <path>` (or auto-resolve from `docs/screens/webapp/fixtures/<screen>.fixture.json` if present)
- Pre-comparison: navigate to `/?_seed=<screenId>` → wait for `data-screen-id` to appear → run preActions[] if specified → THEN snapshot DOM
- Same change in `scripts/audit-computed-styles.mjs`

Update `.claude/skills/parity-verify/SKILL.md` (drafted by feat-028) to document the fixture system.

## Validation criteria

- Replay kanban-webapp-10 with feat-029 active: parity verifier seeds the home fixture before checking → DOM-diff catches the actual divergences (shell-stripping, layout, color drift) instead of "everything missing"
- Auto-derive against `docs/screens/webapp/home.html` produces a fixture with 3 boards × 4 columns × 12 cards matching the mockup's visible structure
- Flow-context fallback for `search-empty` correctly types a no-result query and snapshots the empty state
- Production build excludes the seed helper (`grep useDevSeedOnMount apps/web/dist/...` returns 0 matches)
- 693 + feat-027 + feat-028 tests still pass; +41 new

## Cross-references

- **Parent**: feat-028 visual-parity-verifier (which is blind without fixtures — kanban-10 evidence)
- **Sibling**: feat-022 flow synthesizer (Pattern B reuses the synthesizer's preActions DSL)
- **Reuses**: `@repo/types` for store-shape validation; `scripts/visual-review-preflight.mjs` for the dev-server lifecycle
- **Orchestration**: feat-028's differ calls feat-029's seed before each comparison
- **Docs surface**: `/screens` skill emits per-screen fixtures alongside the HTML; updated to document the schema

## Open questions

- **Schema drift**: app's `@repo/types` evolves; how do we keep auto-derived fixtures in sync? Suggest: fixtures regenerated each `/build-to-spec-verify` run (gitignored; never committed) so they always match current types.
- **Multi-board / multi-card variability**: mockup shows 3 boards but the app may render 0/1/many. Should fixtures be exact (3 boards) or representative (≥1 board with all priorities)? Suggest exact for v1; the goal is structural parity with the mockup, not flexibility.
- **Modal-open states**: how does the differ snapshot the card-detail-modal IN ITS OPEN STATE? Pattern B with preAction `[click first card]` should work; verify on first run.
- **Localization**: if a project ships in multiple languages, fixtures need locale awareness. Defer; v1 = single locale per project.

## Attempt Log

### Attempt 1 — Implementation (background agent a41792e2d1154522d, completed 2026-04-28)

All 5 phases shipped in single pass. Also closed feat-028's
`.claude/skills/parity-verify/SKILL.md` gap (created the file the prior
agent skipped, documenting the differ + fixture system together).

Test counts: contracts 324→344 (+20), orchestrator 483→544 (+61), total
807→888 (+81 — exceeds the +49 dispatch estimate; coverage came in stronger
than planned).

## Outcome

**Status: completed (shipped 2026-04-28; commit ce00f41)**

Verified by:

- 81 new tests (20 contracts + 19 derive-fixture + 28 seed-app-state +
  7+7 resolveFixturePath in audit-cs/diff-kit)
- Both `--help` invocations exit 0
- `grep -c "data-kit-component" .claude/skills/agents/front-end/react-next/SKILL.md`
  returns 5 (preserves feat-028 contract + adds fixture seed contract)

## Lessons learned

- **Phase 2 implementation pattern: full ready-to-paste snippets in builder
  SKILLs beat abstract requirements**. The dispatch instruction said
  "probably documented snippet inside SKILL files since we don't ship to
  projects/\*". The agent took it literally and gave React+Svelte
  implementations side-by-side with framework-specific guards
  (`process.env.NODE_ENV` for Next, `import.meta.env.DEV` for Vite). When
  the next builder runs against an updated SKILL, they paste verbatim and
  pass the grep self-verify on first try.
- **Conditional-load Playwright keeps unit tests deterministic**: the agent
  loaded Playwright only inside the CLI branch + duck-typed `PageLike` in
  unit tests via recording stubs. Avoids the cross-platform tmp-file +
  browser-bin headache feat-028 hit.
- **`@inherit-from:` convention** for cross-fixture composition (Pattern B
  start-state inherits from Pattern A) is a clean way to keep `home` as
  the canonical seeded-state and have `search-empty` etc. layer on top.
- **ESM CLI guard pattern reuse**: the agent shipped a shared `isMainModule()`
  helper across all 4 new CLI scripts (derive-fixture, seed-app-state +
  the 2 feat-028 differ extensions). Same pattern; one mental model.

## Follow-ups

- **Auto-derive against non-kanban archetypes**: Phase 1 currently maps
  `[data-kit-component="Board" / "Column" / "Card"]` to a kanban store
  shape. Apps with different kit-primitive vocabulary (e.g. dashboards
  with KPI cards, list views) will need archetype detection or per-app
  mapping configs. Defer until a non-kanban project hits this.
- **Multi-board variability**: open-question item resolved in favor of
  exact (mockup shows 3 boards → fixture seeds 3 boards). Empirical
  validation deferred to first kanban-11+ run.
- **Modal-open states** (open question): Pattern B with preAction
  `[click first card]` is the design; verify on first run.
- **Localization**: deferred per Non-goals; v1 = single locale per project.
