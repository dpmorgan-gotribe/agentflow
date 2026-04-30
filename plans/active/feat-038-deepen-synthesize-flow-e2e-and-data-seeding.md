---
id: feat-038-deepen-synthesize-flow-e2e-and-data-seeding
type: feature
status: draft
author-agent: claude-opus-4-7
created: 2026-04-29
updated: 2026-04-29
parent-plan: null
supersedes: null
superseded-by: null
branch: feat/deepen-synthesize-flow-e2e-and-data-seeding
affected-files:
  - scripts/synthesize-flow-e2e.mjs
  - scripts/run-synthesized-flows.mjs
  - .claude/skills/build-to-spec-verify/SKILL.md
  - .claude/skills/user-flows-generator/SKILL.md
  - schemas/build-to-spec-verify-output.schema.json
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-038 — Deepen `synthesize-flow-e2e` for interactive flows + investigate data-seeding strategy

## Problem Statement

The verify pipeline's flow-execution stage (`scripts/synthesize-flow-e2e.mjs` + `scripts/run-synthesized-flows.mjs`) exists to catch the kanban-webapp-09 class of integration bug ("Generate a single repo health report — paste URL, see seven charts populated") that pure static reachability misses. The synthesizer reads `docs/user-flows-manifest.json` (high-level user task descriptions authored by `/user-flows-generator`) and emits Playwright specs into `apps/web/e2e/synthesized/flow-N.spec.ts`. The runner executes them against the auto-booted dev server.

In practice — empirically observed during the `repo-health-dashboard-01` end-to-end run on 2026-04-29 — the generated specs are **too shallow to catch real bugs**. Inspecting `flow-1.spec.ts` (the "Generate a single repo health report" flow):

```ts
test("flow-1: Generate a single repo health report", async ({ page }) => {
  await page.goto("/");
  // ... that's it, basically. No form fill, no submit click,
  // no wait for response, no assertion that charts rendered.
});
```

The flow's task description (paraphrased): _"User pastes a repo URL, sees all seven charts and four header cards populated, decides in under 30 seconds whether the project looks alive."_ The spec opens `/` and stops. So a critical class of bug — **the home form's API call points at the wrong port and 404s on submit** (see `bug-032`) — passes the verify stage as `flow-1: passed` because navigating to `/` works fine even when submitting the form would fail.

Two distinct gaps surface together:

### Gap 1 — Synthesizer can't translate task descriptions into interactions

The synthesizer (`scripts/synthesize-flow-e2e.mjs`) is a regex-based template. It emits a spec shell with `page.goto(url)` based on the flow's first screen, then... essentially nothing. The user-flow's task description ("paste a repo URL, see seven charts populated") doesn't translate into:

- `await page.fill("input[name=repo]", "facebook/react")`
- `await page.click("button[type=submit]")`
- `await page.waitForResponse(/\/api\/report\//)`
- `await expect(page.getByTestId("contributors-chart")).toBeVisible()`

Without these, the spec runs but exercises ~5% of the actual user journey. Coverage is theatrical.

### Gap 2 — Data-seeding strategy is undefined

Even if the synthesizer produced interactive specs, many of the project's UI states require **data to be present in the system before the test starts**. `repo-health-dashboard-01` is a relatively benign case — it queries an external API (GitHub) and the test could use a public-domain repo. But richer projects exhibit:

- **Mutation-tier UI states**: a kanban board's "Archive completed cards" button only appears when at least one card is in the Done column. To test the archive flow, the spec must seed a Done-column card first.
- **Empty-state UI**: a "Add your first repo" CTA only renders when the user's saved-repo list is empty. Tests that need to assert on this CTA must clean up any previously-seeded repos.
- **Pagination / overflow UI**: a "Load more" button only appears when ≥21 repos exist in the list. Tests that exercise pagination must seed ≥21 repos.

The verify pipeline currently has no concept of seeding. It assumes either (a) tests don't need data (false in practice), or (b) tests seed/cleanup themselves (which the synthesizer can't generate from a high-level task description).

The user explicitly named the central tradeoff: **"do we clean up and seed data for each test, OR do we reuse dummy data across many tests and clean+reseed for other test blocks?"** This is a Phase 0 investigation — different projects + test layers want different answers, and the factory needs a documented contract that scales across stack skills.

## Approach

### Phase 0 — Decision (shipped 2026-04-30)

The original 3-option framing (per-test reseed / shared baseline / hybrid) assumed every project would have a real-DB backend. Empirical survey across the factory's shipped projects revealed the reality: **strategy is stack-determined by the project's persistence layer**, not a single global choice.

**Empirical findings (audit at feat-038 Phase 0 time):**

| Project                                    | Persistence layer                                         | Strategy actually used                                                                                        | Per-test cost |
| ------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------- |
| `kanban-webapp-09` (shipped)               | localStorage only (Zustand-persist, no backend mutations) | **A** (per-test reseed) — `test.beforeEach: localStorage.clear() + reload` (`apps/web/e2e/board.spec.ts:23`)  | ~10ms         |
| `repo-health-dashboard-01` (shipped)       | External GitHub API + in-memory proxy cache               | **D** (API interception) — `page.route("**/api/report/**", ...)` (`apps/web/e2e/compare.spec.ts:15`)          | ~0ms          |
| `book-swap` / `finance-track` (pre-builds) | Real DB-backed (planned, not yet shipped)                 | **C** (hybrid) when first project ships — pattern to be defined alongside the canonical `/test/seed` endpoint | ~50–500ms     |

**Decision: per-stack-skill strategy declaration.**

The factory's stack skills declare which seeding strategy applies based on the project's `architecture.yaml.tooling.stack.persistence_layer` value. A single project may need to mix strategies at the test-suite level (e.g. external API → intercept; project-managed user-prefs DB → hybrid).

The canonical contract lands in `.claude/rules/testing-policy.md §E2E data-seeding strategy (feat-038 Phase 0)` so per-stack-skill `§Testing` blocks reference one source of truth rather than re-deriving.

**Why not pure A / B / C:**

- **Pure A** (per-test backend reseed): correct for localStorage projects (cheap), punishingly expensive for DB-backed ones (would 10× test wall-clock).
- **Pure B** (shared global baseline): order-dependent and flaky for any mutation flow; debugging a single failing test requires running its predecessors. Rejected.
- **Pure C** (hybrid): correct when there's a real DB, but adds machinery that's pure overhead for projects with no backend mutation tier.

The persistence-layer-driven dispatch makes each project pay the minimum overhead its architecture requires.

**Why not just call out to existing tester patterns:**

- Tester-authored E2E (e.g. `compare.spec.ts`'s `page.route(...)`) is per-feature scope. The synthesizer authors cross-feature integration specs that exist precisely to catch bugs the per-feature tests miss. Some flows (e.g. "create card → assign user → archive") span features and therefore can't trivially mock the backend mid-flow.
- For flows whose `seedingTier: "mutation"`, the synthesized spec needs real persistence (real localStorage state OR real DB writes) to validate the integration. API interception is wrong here.

**Out-of-scope for Phase 0** — explicitly deferred:

- Live benchmarking on `book-swap-pre-build` (the original investigation step) was infeasible — pre-build projects have no built backend. The first project to ship a real-DB Strategy C E2E will produce empirical numbers that we can fold back into this rule. Hypothesis stays: if reseed <500ms, A also works for DB-backed; >2s makes C mandatory.
- Per-stack `seed-{strategy}.ts` helper authoring (Phase 1+ implementation work).
- The structured `steps[]` schema extension to user-flows-manifest (Phase 1).

### Phase 0 — Original time-boxed investigation outline (preserved for record)

Decide the canonical seeding strategy before deepening the synthesizer (Phase 1+ depends on knowing how to write seed-aware specs). Three options, each with documented tradeoffs:

| Option                                                               | Description                                                                                                                                                        | Pros                                                                                                           | Cons                                                                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **A. Per-test seed + cleanup**                                       | Each spec begins with `await seed(...)` + ends with `await cleanup(...)` (or `test.afterEach`). Maximum isolation.                                                 | No cross-test state pollution. Specs can run in any order, in parallel. Easy to reason about per-spec.         | Slow (every test re-seeds). Seed data must be small or this becomes punitive. Doubles test wall-clock for data-heavy projects. |
| **B. Shared dummy data across the entire test run + cleanup at end** | One big `globalSetup` seeds a fixed dataset; all tests assume it; one `globalTeardown` cleans up.                                                                  | Fast (seed once). Simple model.                                                                                | Tests can mutate shared state and break each other. Order-dependent. Hard to debug a single failing test in isolation.         |
| **C. Hybrid: per-block seed/cleanup with shared baseline**           | A `globalSetup` seeds the baseline (read-only data). Each `describe` block declares its mutation-tier needs and seeds those in `beforeAll` + cleans in `afterAll`. | Balances speed + isolation. Read-only tests hit the shared baseline; mutation tests get their own scoped data. | Adds complexity to the spec author. Requires a way to declare "this block mutates" — needs convention or schema.               |

Investigation steps:

1. **Survey existing factory projects** for what data each project's flows need: `repo-health-dashboard-01` (read-only — just hits GitHub), `book-swap-pre-build` (mutation-heavy — listing creation, swap workflows), `kanban-webapp-pre-build` (mixed — board view is read-only, card-create + card-archive are mutations), `finance-track-pre-build` (mutation-heavy — transaction CRUD).
2. **Benchmark per-test reseed cost** on `book-swap-pre-build`'s 8 flows: how long does a single reseed take vs the test itself? (Hypothesis: if reseed is <500ms, Option A becomes viable; if it's >2s, Option C is mandatory.)
3. **Check whether existing E2E layer in shipped projects** (e.g. tester-authored Playwright tests for non-synthesized flows) has any pattern we can adopt — if `book-swap-pre-build` already uses a `globalSetup`, that's signal.
4. **Document the contract** in `.claude/rules/testing-policy.md` once a strategy is chosen — so per-stack-skill `§Testing` blocks can reference a single canonical answer rather than each re-deriving.

Output: `plans/active/feat-038-...md` updated with a Phase 0 §Decision section naming the chosen option, with rationale + benchmarks.

### Phase 1 — Schema + manifest extension

Update `docs/user-flows-manifest.json` schema (and the `/user-flows-generator` skill that produces it) to include a structured **interaction script** per flow, not just a prose task description:

```json
{
  "flowId": "flow-1",
  "name": "Generate a single repo health report",
  "task": "User pastes a repo URL...",
  "steps": [
    { "kind": "navigate", "to": "/" },
    {
      "kind": "fill",
      "selector": "[data-testid=repo-input]",
      "value": "facebook/react"
    },
    { "kind": "click", "selector": "[data-testid=submit-report]" },
    { "kind": "waitForResponse", "urlPattern": "/api/report/" },
    { "kind": "assertVisible", "selector": "[data-testid=contributors-chart]" },
    { "kind": "assertVisible", "selector": "[data-testid=stars-chart]" }
  ],
  "seedingTier": "read-only" // OR "mutation" — drives per-block strategy from Phase 0
}
```

Step kinds (initial vocabulary — extend per empirical demand):

- `navigate { to: <route> }`
- `fill { selector, value }`
- `click { selector }`
- `select { selector, option }`
- `waitForResponse { urlPattern, status? }`
- `waitForSelector { selector, timeout? }`
- `assertVisible { selector }`
- `assertText { selector, text }`
- `assertUrlMatches { pattern }`
- `screenshot { name }` (for visual diff cross-cutting with parity-verify)

The vocabulary is finite + structured, which means the synthesizer's job becomes purely mechanical translation (step-list → Playwright spec) instead of LLM-flavored interpretation.

### Phase 2 — Deepen the synthesizer

Rewrite `scripts/synthesize-flow-e2e.mjs` to consume the new manifest schema and emit one Playwright statement per step. Also add the seeding-tier logic:

- Generate `playwright/global-setup.ts` containing the baseline seed (Option B/C selected from Phase 0).
- Generate `apps/web/e2e/fixtures/seed-helpers.ts` with the per-block helpers.
- Each spec imports the helpers + opts into the appropriate seeding tier per the flow's `seedingTier` declaration.

For the `repo-health-dashboard-01` empirical case: flow-1 should produce a spec that fills the input, submits, waits for the `/api/report/` response, and asserts on the rendered charts. THIS spec would have caught bug-032 cleanly (the response would have been a 404 → spec fails → bug filed).

### Phase 3 — Update `/user-flows-generator` skill

The skill currently outputs prose task descriptions plus a screen sequence. Phase 1's schema change requires it to also output the structured `steps[]` array. Two implementation paths:

- **Path 3a**: extend the generator's prompt to author `steps[]` alongside the task description. The generator already has all the context (mockup HTML, screen IDs, kit components used in each screen) to know what selectors exist.
- **Path 3b**: keep the generator producing prose, add a NEW post-processing skill `synthesize-flow-steps` that reads the prose + the screen HTML and authors `steps[]`. Decoupled but doubles LLM call cost.

Recommend 3a unless empirical evidence shows the LLM struggles to author selectors deterministically.

### Phase 4 — Verify pipeline integration

- `scripts/run-synthesized-flows.mjs` already runs Playwright. Should not need major changes — just runs whatever specs the synthesizer emitted.
- `orchestrator/src/build-to-spec-verify.ts` flow-execution branch already wires up correctly. Verify the new specs report failures correctly.
- `BuildToSpecVerifyOutput` schema may need extension to surface seed-failures distinctly from spec-failures.

### Phase 5 — Validation harness

Per-stack-skill fixtures under `tests/fixtures/synthesize-flow-e2e/`:

- `read-only-baseline/` — flow that just navigates + reads
- `mutation-isolated/` — flow that creates+asserts+cleans up its own data
- `mutation-with-baseline/` — flow that uses Phase 0's hybrid model

Each fixture: a tiny `user-flows-manifest.json` + expected synthesized spec output. Test asserts the synthesizer's output matches the expected spec verbatim.

## Rejected Alternatives

- **Have the LLM author the Playwright spec end-to-end** (skip the structured-steps schema; just prompt the model with the prose task description + screen HTML and let it write the spec). Rejected because (a) the LLM would silently regress between runs as model versions change; (b) there's no validation surface — spec validity becomes runtime-only; (c) doubles cost per project (24+ flows × per-spec LLM call) versus a deterministic generator. The structured-steps approach makes 95% of the synthesis mechanical.
- **Use Codegen / Playwright Inspector to author specs** (let a human use Playwright's record-and-replay to author each flow's spec, commit them, and forget the synthesizer). Rejected because (a) defeats the auto-regenerate-on-task-update value of the synthesizer; (b) per-project burden scales linearly with flows; (c) human-authored specs drift from intended behavior over time.
- **Skip synthesis entirely; rely on tester-authored E2E** (each feature's tester pass writes its own E2E spec; no synthesis layer). Rejected because (a) testers test ONE feature at a time, can't see cross-feature flows like "create a card → assign to user → archive" that span multiple features; (b) the synthesis layer's purpose is exactly to catch integration gaps tester misses. Already discussed in `investigate-006`.
- **Only support the read-only seeding model**; refuse to handle mutation-tier flows; document as a known limitation. Rejected because mutation flows are >50% of any non-trivial project's UI surface (every CRUD app), and skipping them gives the verify pipeline near-zero coverage on the things that matter most.
- **Fixture-based seeding via JSON files** (each spec declares `seed: ["./fixtures/three-cards.json"]` and the runner POSTs the JSON to a backend `/test/seed` endpoint). Worth considering — but punts the question of HOW the backend exposes a seed endpoint to per-project. Could be a Phase 0 sub-question if the chosen seeding option is "shared baseline".

## Expected Outcomes

- [ ] Phase 0 produces a documented decision: A | B | C (with rationale + benchmark numbers).
- [ ] `.claude/rules/testing-policy.md` has a new section codifying the chosen seeding strategy as the canonical contract.
- [ ] Phase 1's structured-steps schema is in `schemas/user-flows-manifest.schema.json` (and Zod equivalent in `packages/orchestrator-contracts/`).
- [ ] Phase 2's deepened synthesizer produces interactive specs from the new schema; the 8 specs in `repo-health-dashboard-01/apps/web/e2e/synthesized/` are non-trivial (form fill + submit + wait-for-response + assert).
- [ ] Empirical re-run on `repo-health-dashboard-01` POST-bug-032: synthesized flow-1 (Generate a report) executes the full user journey and surfaces real bugs. With bug-032 fixed (API base URL set), flow-1 passes; with bug-032 reverted (env unset), flow-1 fails with a clear "404 from /api/report/" assertion failure rather than a silent navigate-only pass.
- [ ] Phase 3's `/user-flows-generator` skill outputs `steps[]` per flow alongside prose; existing factory projects can re-run the skill to upgrade their manifests.
- [ ] Phase 5 validation harness covers all three seeding tiers from Phase 0; CI catches synthesizer regressions before they ship.
- [ ] Cross-platform: synthesizer + runner work on Windows AND POSIX (the factory's primary surface is Windows).
- [ ] Side-by-side run on `repo-health-dashboard-01`, `book-swap-pre-build`, `kanban-webapp-pre-build` produces specs that compile + run + meaningfully exercise each project's UI. (book-swap and kanban were chosen specifically because they're mutation-heavy — they exercise the seeding strategy chosen in Phase 0.)

## Open Questions

1. **How does the seeding strategy interact with the bug-fix loop?** When a builder dispatches against a flow-execution failure, the seed data state at dispatch time may differ from what the original failure was triggered with. Need either (a) deterministic seed → reproducible failure context, or (b) per-failure capture of the seed state used.
2. **Does each stack skill need its own seeding helpers**, or is there a single cross-stack helper API? `react-next` + `python-fastapi` (HTTP-based seeding) differs from `expo` + `python-fastapi` (mobile-platform-quirky setup). Phase 5's fixtures should cover at least the React stacks.
3. **Should the synthesizer's `steps[]` schema be versioned**? Future step kinds (e.g., `dragAndDrop`, `uploadFile`, `keyboardShortcut`) will need to land additively. Yes — add `schemaVersion` field from the start.
4. **For projects without `apps/api/`** (Next.js full-stack via API routes only), the seeding endpoint discussion changes. Probably out-of-scope until a real example surfaces, but worth noting in §Open Questions until then.
5. **Should `seedingTier: "mutation"` flows run in serial mode by default** (Playwright `test.describe.serial`) to avoid order-dependent failures, even when the strategy chosen in Phase 0 is fully isolated? Defaulting to serial is safer; explicit opt-in to parallel costs less than debugging a flaky concurrent run.

## Cross-references

- `plans/active/bug-032-api-base-url-not-coordinated-with-backend-port.md` (the parallel bug — bug-032 fixes the dev environment so synthesized flows can hit a real backend; feat-038 fixes the synthesis to actually exercise that backend)
- `plans/archive/feat-022-build-to-spec-verification.md` (the verify pipeline's parent — feat-038 deepens its flow-execution branch)
- `plans/archive/feat-025-flow-spec-execution.md` (the original runner — feat-038 extends what the runner is given to run)
- `plans/archive/investigate-006-build-to-spec-verification.md` (the option survey that motivated the synthesis approach over alternatives)
- `scripts/synthesize-flow-e2e.mjs` (current synthesizer to be deepened)
- `scripts/run-synthesized-flows.mjs` (current runner — should not need major changes)
- `.claude/skills/user-flows-generator/SKILL.md` (Phase 3 — needs to output structured steps)
- `.claude/skills/build-to-spec-verify/SKILL.md` (cross-reference for the verify pipeline integration)
- `.claude/rules/testing-policy.md` (Phase 0 outcome lands here as the canonical seeding contract)
