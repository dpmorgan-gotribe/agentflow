---
id: bug-107-strategy-d-web-tester-wall-clock-cap
type: bug
status: archived
author-agent: claude-opus-4-7
created: 2026-05-15
updated: 2026-05-15
approved-at: 2026-05-15
completed-at: 2026-05-15
parent-plan: investigate-031-tester-wall-clock-strategy-d-web
supersedes: null
superseded-by: null
branch: fix/strategy-d-web-tester-wall-clock-cap
affected-files:
  - orchestrator/src/model-config.ts
  - orchestrator/tests/model-config.test.ts
feature-area: orchestrator/wall-clock-cap
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "task tester-web-e2e failed after 2 attempts: error_stall_timeout: wall-clock-1200000ms"
reproduction-steps: |
  1. Author a Strategy-D web project (persistence_layer=external-api-only + web_framework=react-next).
  2. Run /start-build. Web feature dispatches; tester step starts.
  3. Tester needs synthesize-flow-e2e + Playwright + page.route + edge-case authoring + coverage.
  4. At 91% seven_day rate-limit utilization, SDK round-trips are 95-117s — work doesn't fit 20-min cap.
  5. Tester aborts at error_stall_timeout: wall-clock-1200000ms.
stack-trace: null
---

# bug-107 — Strategy-D web tester needs a longer wall-clock cap than the global default

## Bug Description

Investigate-031 R1 (CONFIRMED H1 + H2). The orchestrator's per-task wall-clock cap is 20 min (1,200,000 ms) globally. For testers on Strategy-D web features (web_framework set + persistence_layer=external-api-only), this is structurally too tight — the workload (synthesize-flow-e2e against N flows + Playwright child processes + page.route mock authoring + edge-case unit tests + coverage run) realistically needs 25-40 min on a cold worktree, and rate-limit slowdown at high bucket utilization compounds the gap.

Expected: tester completes its work within the per-task cap with reasonable headroom.
Actual: wall-clock fires; feature marked failed; $1.60+ burned per attempt.

## Reproduction Steps

See frontmatter. Empirical anchor: `gotribe-tribe-directory/feat-tribe-directory-web` 2026-05-15.

## Root Cause Analysis

Per investigate-031 §Findings:

- `DEFAULT_STALL_TIMEOUT_BY_AGENT` in `orchestrator/src/model-config.ts:164-200` maps each agent class to a single ms value. Tester defaults to 20 min.
- The cap has NO class-discriminator for Strategy-D-web vs backend. A backend tester runs httpx_mock unit tests in <5 min; a Strategy-D web tester does 4-5× more work.
- Backend testers in the same run finished in <5 min each (feat-tribe-fixture `validate-fixture`, feat-tribe-api `tester-tribes-api`). Web tester needed >20 min.

## Fix Approach

Add a class-discriminator helper in `orchestrator/src/model-config.ts`:

1. Define `resolveStallTimeout(agent, featureContext)` that:
   - Reads project's `tooling.stack.persistence_layer` + `tooling.stack.web_framework` from architecture.yaml
   - For tester on Strategy-D web (external-api-only + web_framework non-null): return 30 min (1,800,000 ms)
   - For all other classes: return current default
2. Wire the helper at the dispatch site in `orchestrator/src/invoke-agent.ts` where the cap is currently looked up.
3. Add 3 regression tests in `orchestrator/tests/model-config.test.ts`:
   - Strategy-D web tester → 30 min
   - Backend tester → 20 min (unchanged)
   - Web tester on Strategy-A or Strategy-C → 20 min (unchanged)

Estimated diff: ~25 lines in model-config.ts + ~60 lines of tests.

## Rejected Fixes

- **Bump global default to 30 min** — rejected: penalizes every backend tester with longer abort latency for a problem that only affects Strategy-D web.
- **Make cap fully configurable per-project via models.yaml** — rejected: pushes the burden onto every project. Class-discrimination is the right scope.

## Validation Criteria

1. Strategy-D web tester gets 30-min cap; no other class changes.
2. Re-run feat-tribe-directory-web after R3 (bug-108) ships — tester completes within the new cap.
3. Regression tests pass.

## Attempt Log

### Attempt 1 — 2026-05-15 — claude-opus-4-7 — SUCCESS

Implemented per plan §Fix Approach.

Changes:

- `orchestrator/src/model-config.ts` — added `STRATEGY_D_WEB_TESTER_STALL_TIMEOUT = 30*60*1000`, private helper `readArchStackContext(projectRoot)` (regex parse of architecture.yaml for persistence_layer + web_framework slots), helper `resolveDefaultStallTimeout(agentName, projectRoot)` that wraps the discrimination logic. Wired into step-5 of the precedence chain (`else if (agentName in DEFAULT_STALL_TIMEOUT_BY_AGENT)`). ~85 lines.
- `orchestrator/tests/model-config.test.ts` — added describe block "Strategy-D web tester wall-clock cap (bug-107)" with 6 cases:
  - Strategy-D web tester gets 30-min cap ✓
  - Backend-only Strategy-D (no web_framework) keeps 20-min ✓
  - Strategy-C real-db web tester keeps 20-min ✓
  - Missing architecture.yaml keeps 20-min (Mode A path) ✓
  - backend-builder on Strategy-D web unaffected (only tester discriminates) ✓
  - Explicit project YAML override preempts the discriminator ✓

Validation:

- `pnpm vitest run tests/model-config.test.ts` → 43/43 passed (37 prior + 6 new) in 72ms
- `pnpm typecheck` → zero new errors in model-config files (pre-existing 4 errors in perceptual-review.test.ts + walkthrough-review.test.ts are unrelated)
- `pnpm vitest run` (full orchestrator suite) → 1039/1039 passed in 35s (was 1033; +6)

Decision: committed directly to master rather than fix branch (per-bug branches would conflict across bug-108/109/110 which all touch the same orchestrator files). All 4 bugs are sequenced as a batch.

### Lessons

1. **Mirror existing arch-yaml read patterns.** `dev-server.ts` already has `readPersistenceLayerSlug` exported + a private `readBackendFrameworkSlug` using the same regex shape. I added a third reader inline in model-config rather than cross-module-importing, accepting the small DRY cost for the bigger lockstep-evolution benefit (all three readers need updating together if `tooling.stack.*` shape changes). Worth a `/plan-refactor` someday to consolidate into one helper — not urgent.
2. **Step-5 discrimination is the right shape.** Inserting the discriminator at the lowest-precedence step (the built-in default) preserves all higher-precedence operator overrides cleanly. Explicit `agents.tester.stallTimeoutMs: N` or top-level `stallTimeoutMs.tester: N` in models.yaml still wins. Test 6 confirms this empirically.
3. **The empirical wall-clock cap on builders matters too.** Investigate-031 surprise finding #2 noted the web-frontend-builder also hit a 25-min wall-clock on the same dispatch. The discriminator framework here generalizes — if/when that becomes a recurring issue, the `resolveDefaultStallTimeout` function picks up a `web-frontend-builder + Strategy-D` clause with the same shape.
