---
id: feat-052-per-feature-parity-smoke-at-close-feature
type: feature
status: draft
author-agent: claude-opus-4-7
created: 2026-05-05
updated: 2026-05-05
parent-plan: investigate-016-shift-left-bug-prevention-and-fix-loop-throughput
supersedes: null
superseded-by: null
branch: feat/per-feature-parity-smoke
affected-files:
  - orchestrator/src/parity-verify.ts
  - orchestrator/src/invoke-agent.ts
  - orchestrator/src/feature-graph.ts
  - packages/orchestrator-contracts/src/git-agent.ts
  - orchestrator/tests/parity-verify.test.ts
  - orchestrator/tests/invoke-agent.test.ts
feature-area: orchestrator/parity-verify + git-agent
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-052: Run parity-verify on JUST this feature's screens at close-feature time

## Problem Statement

Per investigate-016 F4: parity-verify currently runs ONCE post-merge across the entire project's mockups. By that point, all 17 features have already merged code that systematically diverges from mockups (22 shell-stripping bugs in the empirical case). The fix-bugs loop then chases each divergence individually.

Earlier detection: each feature's worktree has the screens it owns + a dev-server it can boot (per bug-052 Phase E's per-feature env isolation). Running a NARROW parity-verify scoped to JUST the screens this feature touches at close-feature time catches divergences AT THE SOURCE — the FIRST feature that strips AppShell gets routed to web-frontend-builder retry. Subsequent features inherit the corrected master and don't re-introduce the pattern.

## Approach

### Phase A — parity-verify per-feature subset filter

Extend `parity-verify.ts ParityVerifyContext` (already injectable):

- `loadScreenList` injection point exists. Wrap it with a subset filter.
- Filter rule: read `architecture.yaml.features[<feature-id>].affects_files`. Map page.tsx paths to screen-ids via screens-manifest.json (each manifest entry has `path` like `apps/web/app/<screen-id>/page.tsx`). Pass only those screens.

Implementation: new helper `filterScreensToFeature(screens, featureAffectsFiles)` in parity-verify.ts. Returns the subset whose mockup-path's screen-id matches a built-page-path in affectsFiles.

### Phase B — close-feature handler integration

Extend `runCloseFeature` in `orchestrator/src/invoke-agent.ts`. After `git merge --no-ff` succeeds + before the worktree-remove cleanup (feat-047 Phase A), but ONLY when:

- Feature involves web-frontend (any task in feature with `agent: web-frontend-builder`)
- Feature has page-rendering tasks (affectsFiles includes `apps/web/app/**/page.tsx`)

Run `runParityVerify` with the subset filter + the worktree's auto-booted dev-server (boot fresh if not running; reuse if already up from tester).

If divergences:

- Return `CloseFeatureSuccess` with new field `parityDivergences: ParityViolationShape[]`
- Orchestrator's feature-graph routing: when close-feature returns parityDivergences non-empty AND this feature's reviewer hasn't hit retry cap, route back to web-frontend-builder retry (similar to tester flagging genuineProductBugs[]).

If no divergences: proceed with merge as today.

### Phase C — schema + contract updates

`packages/orchestrator-contracts/src/git-agent.ts CloseFeatureSuccess`: add `parityDivergences?: ParityViolationShape[]` (optional; legacy callers + non-web features see undefined).

`feature-graph.ts runFeature`: detect non-empty parityDivergences in the close-feature output. If present + retry budget remains, dispatch web-frontend-builder retry inside the worktree (mirrors tester's genuine-bugs ladder). retry context message: "parity-verify caught N divergences: [...]; reapply per mockup".

### Phase D — Tests + empirical re-validation

`orchestrator/tests/parity-verify.test.ts`: new test for `filterScreensToFeature` — given 25 screens + a feature touching 3 page.tsx files → returns 3 ScreenEntries.

`orchestrator/tests/invoke-agent.test.ts`: extend close-feature happy-path tests with parity-verify integration. Mock parity-verify return value; assert close-feature output carries divergences when present.

Empirical: re-run on book-swap or finance-track-02. Verify post-Mode-B verifier shows zero shell-stripping (caught at first feature with web-frontend builder).

## Rejected Alternatives

- **Run parity-verify INSIDE reviewer dispatch** — Rejected. Reviewer is read-first per refactor-008; doesn't dispatch tools that boot dev-servers. Close-feature is the cleaner integration point (already has worktree + can boot dev-server cleanly).
- **Run parity-verify in EVERY feature's tester** — Rejected. Bloats tester scope (already at ~9min per agent). Close-feature is post-tester so we only run parity-verify on features that already passed tests.
- **Defer to a separate verifier-as-gate skill** — Rejected. Coupling close-feature to parity-verify means the divergence catch is inseparable from the merge — there's no "merge bypassed parity check" failure mode. Operational invariant.
- **Parity-verify against mockup screenshots (not DOM)** — Out of scope. Pixel-diff is the FUTURE depth (feat-future-pixel-parity); the DOM-walk + computed-style audit is empirically sufficient for class-uniform issues.

## Expected Outcomes

- [ ] parity-verify accepts a per-feature subset via loadScreenList injection.
- [ ] close-feature runs parity-verify when feature has page-rendering tasks.
- [ ] CloseFeatureSuccess carries parityDivergences (optional).
- [ ] feature-graph routes parity divergences back to web-frontend-builder retry (within retry budget).
- [ ] Empirical: fresh project's post-Mode-B verifier shows ≤1 shell-stripping bug (vs finance-track-01's 22).

## Validation Criteria

- [ ] Unit test: filterScreensToFeature correctly subsets given affects_files patterns.
- [ ] Integration test: close-feature with mocked parity-verify returning 1 divergence routes to web-frontend-builder retry; with 0 divergences proceeds to merge.
- [ ] No regression: feat-047 Phase A+B cleanup still fires post-merge; parity check is BEFORE cleanup.
- [ ] Cost: per-feature parity-smoke adds ~30-60s per web-frontend feature; budget fits within existing per-feature wall-clock allowance.

## Cross-references

- Parent: `investigate-016-shift-left-bug-prevention-and-fix-loop-throughput` F4 + recommendation
- Sister: `feat-051` (PM mandate — upstream prevention); `feat-054` (reviewer playbook — peer defense-in-depth)
- Existing infrastructure: `bug-052 Phase E` (per-feature dev-server env isolation) — close-feature can reuse the worktree's dev-server
- Sister surface: `feat-047 Phase A+B` (close-feature worktree cleanup) — parity-smoke runs BEFORE cleanup; no ordering conflict
- Existing API: `orchestrator/src/parity-verify.ts ParityVerifyContext.loadScreenList` is already injectable — no API breaks needed
