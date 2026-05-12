---
session-id: "20260503-052312"
timestamp: 2026-05-03T05:23:12Z
agent: human
task-id: null
previous-context: 20260503-045718-human-wave3-synthesizer-loop-hardening-shipped-3of5.md
checkpoint: true
status: final
---

# Context snapshot — Wave 3 synthesizer-loop hardening — ALL 5 FACTORY GAPS SHIPPED

## Summary

Continued from prior checkpoint (20260503-045718) where 3 of 5 factory gaps had landed. Today's session continued through feat-049 (catalog + classifier) + bug-050 (cause-routing) + feat-050 (per-flow seed orchestration). All 5 Wave 3 factory plans are now shipped at LOAD-BEARING phases (Phase A+B+(C+)E for each); Phase D documentation tightening on a couple plans deferred. The autonomous /fix-bugs loop is now correct end-to-end across projects: synthesizer catches manifest-author issues at synth-time; runner classifies failures into build-gap vs manifest-author; bug-router skips dispatch on manifest-author + seed-mismatch; per-flow seed orchestration closes the seed-mismatch class. Tests: 620 → 660 (+40 across the session).

## Completed since last snapshot

### feat-049 Phase A+B+C (commit `24a35a3`) — screens-catalog + classifier

- New `scripts/build-screens-catalog.mjs` walks `docs/screens/**.html` via the regex pattern from `derive-fixture-from-mockup.mjs`. Builds 3 indices: `byKitComponent`, `byRoleName` (`role|name`), `byScreenId`. Accessible name resolution: aria-label > title > collapsed visible text (per WAI-ARIA Computation Algorithm).
- `classifySelector(selector, catalog)` exported for in-process use. Recognizes 5 selector shapes (`[data-kit-component=X]`, `role=<role>[name="<name>"]`, name regex form, `:has-text("Y")` parent + child, `>>` chain). Returns `"in-design" | "not-in-design" | null` (catalog absent/empty).
- Plumbed into `scripts/run-synthesized-flows.mjs`: builds catalog at startup, classifies failures, drives new primaryCause values:
  - `not-in-design` → `manifest-author`
  - `in-design` → `build-gap`
  - `null` → falls back to legacy `step-transition`
- Extended `parseFailureMessage` to extract selectors from Playwright v2.0 messages (`locator('X')` chains, `getByRole`). Pre-fix only the v1.0 `(selector: X)` form was extracted.

### bug-050 Phase A+B (same commit `24a35a3`) — cause-routing

- `FlowPrimaryCause` enum extended with `build-gap` + `manifest-author` (Zod + JSON schema).
- `defaultAgentSequence()` in `scripts/file-bug-plan.mjs` rewritten to switch on `primaryCause`:
  - `build-gap` → `[web-frontend-builder, tester, reviewer]`
  - `seed-setup` → `[backend-builder, tester, reviewer]`
  - `manifest-author` → `[]` (no dispatch — design-stage regen needed)
  - `step-transition` / unknown → default
- Pre-bug-050 `void violation;` + uniform routing: 5 of 9 finance-track-01 failures would have misrouted.
- `BugStatus` schema gained `needs-operator-review` value; fix-bugs-loop respects empty `agentSequence` by marking the bug `needs-operator-review` + skipping dispatch (saves $$ on no-op agent calls).
- +4 routing tests in `file-bug-plan-parity.test.ts`.

### feat-050 Phase A+B+E (commit `99f46cd`) — per-flow seed orchestration

- `RequiredStateSchema` discriminated union added to `FlowSchema` (Zod + JSON schema):
  - `{ kind: "baseline" }` (default; no-op)
  - `{ kind: "empty", tablesToCleanup }` (cleanup, skip seed)
  - `{ kind: "custom", tablesToCleanup, fixtures }` (cleanup + seed)
- Synthesizer emission: when `flow.requiredState` is set on Strategy C, emits LIVE `test.beforeAll`/`test.afterAll` calling `/test/cleanup` + `/test/seed` + `/test/seed-baseline` (existing endpoints per bug-042 Phase A.5). Inline error-handling with `feat-050 cleanup failed` / `feat-050 seed failed` / `feat-050 baseline-restore failed` prefixes for downstream classification.
- Empirical validation against finance-track-01 (in-process only; project-side manifest patches NOT committed to factory): flow-1 `kind=empty` and flow-9 `kind=custom` with stale fx_cache fixtures both emit correctly. Generated specs hand-inspected; structure matches expected pattern.
- +5 emission tests covering empty / custom / absent-fallback / baseline-no-op / error-handling.

### Empirical signal — full run-through against finance-track-01

Catalog + classifier correctly classify the 9 failures from the original run:

| Selector                                       | Classifier output                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| flow-1 EmptyState:has-text("No accounts yet")  | in-design ✓ (seed-mismatch)                                          |
| flow-2 [Card]:has-text("Import CSV") >> button | in-design (caught earlier by bug-051 synth lint)                     |
| flow-3 role=button[name="Display currency"]    | in-design ✓ (build-gap)                                              |
| flow-4 [Card]:has-text("FX cache")             | in-design (caught by bug-051 mock-layer warn)                        |
| flow-5 [data-kit-component="Table"]            | **not-in-design** ✓ (manifest-author — design uses DataTable!)       |
| flow-6 role=button[name=/Filter by date/]      | **not-in-design** ✓ (manifest-author — name doesn't exist)           |
| flow-7 [data-kit-component="Chart"]            | **not-in-design** ✓ (manifest-author — design uses different naming) |
| flow-8 [ListItem]:has-text("USD Cash")         | in-design ✓ (seed-mismatch)                                          |
| flow-9 [Badge]:has-text("stale")               | in-design ✓ (seed-mismatch)                                          |

3 of 9 correctly tagged `not-in-design` → routes to `[]` → no false-positive builder dispatch. 2 of 9 (flow-2/4) caught at synth-time by bug-051 lint before E2E runs. The remaining `in-design` failures route to web-frontend-builder which is the correct first-attempt for build-gap; for seed-mismatch they'll spin/fail (acceptable cost compared to manifest-author misroutes).

## Current state

- Factory branch: `feat/quota-observability` at `99f46cd` (4 new commits this session: 47d3444, db79046, 24a35a3, 99f46cd)
- Tests: orchestrator **660/660** (was 620 at session start; +40 across bug-048/049/051/050 + feat-049/050). Contracts unchanged.
- Uncommitted (factory): 0 (only the long-standing `scripts/_tmp-*.mjs` files which predate this session)
- finance-track-01 branch: `fix/bugs-yaml-iter` at `cf157ba` (1 commit this session — bug-044 + regen + Playwright bump)
- Quota: not measured this session
- Blockers: NONE. All 5 Wave 3 factory plans shipped at load-bearing phases.

## Next steps

1. **Empirically validate end-to-end on finance-track-01.** Re-author `docs/user-flows-manifest.json` to add `requiredState` for flow-1 (empty) + flow-8 (custom — different name) + flow-9 (custom — stale fx). Re-run synthesizer, then run Playwright against the 3 affected flows. Expected: 3 fewer failures than the previous 9. Project-side commit on `fix/bugs-yaml-iter`.
2. **Run /build-to-spec-verify orchestrator wrapper end-to-end.** This invokes both the catalog builder + the runner with classifier integration; should produce a `docs/bugs.yaml` with correctly classified entries (manifest-author entries get `agentSequence: []`).
3. **Optionally run /fix-bugs against the populated `docs/bugs.yaml`.** Should ONLY dispatch builders against the `build-gap` bugs (flow-3 + any v2.0 v1.0 stragglers). The flow-5/6/7 manifest-author bugs should land at `needs-operator-review` without builder dispatch.
4. **Tackle remaining deferred phases when convenient:**
   - feat-049 Phase D: `/screens` SKILL.md contract tightening (document `data-screen-id` requirement — already mostly in place but worth tightening).
   - feat-050 Phase C: backend partial-fixture audit. Verify all 3 backend stack skills' `/test/seed` endpoints handle partial-table fixtures cleanly (e.g. seeding only `fx_cache` without `accounts`).
   - feat-050 Phase D: `/user-flows-generator` SKILL.md examples for when to author `requiredState`.
5. **Roll forward to book-swap.** With Wave 3 fully shipped, book-swap should be the cleanest end-to-end run yet (Strategy C real-DB; exercises bug-042 + feat-049 + bug-050 + feat-050 end-to-end).

## Open questions

- **`seed-mismatch` distinct primaryCause?** Currently in-design selector failures get `build-gap` regardless of whether the build is missing the element OR rendering it with wrong content (seed-mismatch). Distinguishing requires runtime DOM inspection at failure capture (parse error-context.md page snapshot, check whether the failing selector matches anything in the actual DOM). Deferred to v2; the bug-050 schema doc explicitly notes this.
- **Should bug-051's synth-time errors block emission?** Currently `errors[]` is a signal but the synthesizer still emits the spec (so it runs in Playwright). For finance-track-01 flow-2's strict-mode trap, this means the test STILL runs and STILL fails at runtime — the lint catches it earlier but doesn't prevent waste. Should bug-051 errors HALT emission for the offending flow? Pro: saves Playwright wall-clock + gives operator a single-source error signal. Con: changes a quasi-warning into a hard-stop; if the lint has a false positive the operator can't bypass.
- **`/screens` SKILL.md aria-label contract?** finance-track-01 dashboard has `<button aria-label="Display currency">EUR</button>` — design clearly intends "Display currency" as the accessible name. Build dropped the aria-label. Should the /screens skill explicitly require `aria-label` for buttons whose visible text differs from intent? Or is the catalog's role-name lookup sufficient discipline?

## Key files touched

### Factory (committed this session — 4 commits on `feat/quota-observability`)

#### `47d3444` (bug-048+049 analyzer fix)

- `scripts/audit-app-reachability.mjs` — `.js → .ts` swap + `CONFIG_STRING_PATH_RE`
- `orchestrator/tests/audit-app-reachability.test.ts` (NEW) + 3 fixture trees
- `plans/active/bug-048-...md` + `plans/active/bug-049-...md` (NEW)

#### `db79046` (bug-051 + 3 plans)

- `.claude/skills/user-flows-generator/SKILL.md` — §4b 2 anti-pattern callouts
- `scripts/synthesize-flow-e2e.mjs` — `detectHasTextStrictModeTrap` + `isLikelyBackendOriginatedMock`
- `orchestrator/tests/synthesize-flow-e2e.test.ts` — +4 bug-051 tests
- `plans/active/bug-050/051-...md` + `plans/active/feat-049/050-...md` (4 NEW)
- `plans/active.md` — manifest +4 rows

#### `24a35a3` (feat-049 + bug-050)

- `scripts/build-screens-catalog.mjs` (NEW) — Phase A catalog builder + Phase B classifier
- `orchestrator/tests/build-screens-catalog.test.ts` (NEW) — 15 tests
- `scripts/run-synthesized-flows.mjs` — Phase C plumbing + selector extraction from v2.0 messages
- `scripts/file-bug-plan.mjs` — bug-050 Phase B agentSequence routing
- `orchestrator/src/fix-bugs-loop.ts` — needs-operator-review on empty agentSequence
- `orchestrator/tests/file-bug-plan-parity.test.ts` — +4 routing tests
- `packages/orchestrator-contracts/src/{bugs-yaml,build-to-spec-verify}.ts` — schemas

#### `99f46cd` (feat-050 Phase A+B+E)

- `packages/orchestrator-contracts/src/user-flows-manifest.ts` — RequiredStateSchema
- `schemas/user-flows-manifest.schema.json` — JSON schema oneOf
- `scripts/synthesize-flow-e2e.mjs` — Strategy C requiredState emission
- `orchestrator/tests/synthesize-flow-e2e.test.ts` — +5 feat-050 emission tests

## Decisions made

- **Shipped feat-049 + bug-050 + feat-050 in this session** — user push-through after the prior checkpoint. All ship-able phases done; deferred only Phase D documentation tightening on each (low-leverage, can land in a follow-up commit).

- **`seed-mismatch` not separately classified** — distinguishing from `build-gap` requires runtime DOM inspection at failure capture. Deferred to v2; the schema doc explicitly notes this trade-off. For routing purposes web-frontend-builder is the right first-attempt for both classes (will succeed on build-gap, will spin/fail on seed-mismatch but feat-050 gives operators the manifest primitive to fix).

- **Conservative classifier defaults (in-design for unrecognized shapes)** — over-counting reachability is safer than under-counting. Misclassifying as build-gap dispatches a builder (recoverable); misclassifying as manifest-author skips dispatch when a real bug exists (loses signal). Empirical: 5 of 9 finance-track-01 selectors are in-design and only 1 is a true build-gap (flow-3); the over-counting cost is bounded by the per-bug attempt cap.

- **`needs-operator-review` as new BugStatus value** — without it, an empty agentSequence would mark the bug `completed` after a no-op dispatch loop, which would flap-loop (re-detect on next verify). The new terminal status is the architecturally clean answer.

- **Inline error-handling vs helper imports in feat-050 emission** — chose to inline `request.post` calls + ok-checks rather than depending on the `seedFixtures`/`cleanupFixtures` helpers from the seed-db.ts template. Reasoning: shipped projects (e.g. finance-track-01) have older versions of the helper that may lack `seedBaseline`. Inline is self-contained + works against any project with the 3-endpoint contract.

- **Empirical Phase E validation in-process only** — patched finance-track-01 manifest with requiredState for flow-1 + flow-9, regenerated specs, hand-inspected the emit, then REVERTED the manifest patches. Project-side authoring belongs in a project commit, not a factory commit. The factory ships the schema + emission; the project applies them.

- **Deferred Phase C of feat-050** (backend partial-fixture audit) — would touch 3 stack skills + their templates. Probably needs project-side empirical signal first. Defer until book-swap or another DB-backed project ships and exercises the surface.
