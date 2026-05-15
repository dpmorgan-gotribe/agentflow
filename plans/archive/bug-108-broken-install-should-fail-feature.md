---
id: bug-108-broken-install-should-fail-feature
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
branch: fix/broken-install-should-fail-feature
affected-files:
  - orchestrator/src/feature-graph.ts
  - orchestrator/tests/feature-graph.test.ts
feature-area: orchestrator/install-gate
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "[runFeature] install warning for feat-X/web-frontend-builder: pnpm install failed (commit had package.json changes)"
reproduction-steps: |
  1. Builder authors apps/web/ scaffold including package.json. Misses test-deps (@playwright/test, @vitest/coverage-v8) and/or playwright.config.ts.
  2. Orchestrator's post-builder pnpm install fires.
  3. Install may exit non-zero OR may succeed with stderr warnings.
  4. Current code emits a "install warning" line but DOES NOT mark the feature failed.
  5. Tester dispatches against an unworkable worktree (missing deps; missing config). It loops trying to import missing modules until wall-clock cap.
stack-trace: null
---

# bug-108 — `pnpm install` failure post-builder should fail the feature, not warn

## Bug Description

Investigate-031 R3 (CONFIRMED H4). When the post-builder `pnpm install` step fails (exit non-zero) OR succeeds with a diff that indicates the builder produced an unworkable package.json (missing react-next SKILL.md §3a.0 mandated deps like `@playwright/test`, `@vitest/coverage-v8`, `playwright.config.ts`, `postinstall: playwright install chromium`), the orchestrator emits a "install warning" log and CONTINUES to dispatch the tester. The tester lands on a worktree where its first `pnpm vitest run` or `pnpm exec playwright test` immediately fails on missing modules.

Expected: install failure routes back to the builder for a fix-pkg-json retry, with the install stderr threaded as retry context.
Actual: tester runs against broken state; wall-clock cap eventually fires; $1.60+ burned per attempt; feature marked failed with the wrong root-cause attributed (wall-clock vs. broken install).

## Reproduction Steps

See frontmatter. Empirical anchor: `gotribe-tribe-directory/feat-tribe-directory-web` 2026-05-15. Post-builder install failed to populate `apps/web/node_modules/`; package.json was missing all 4 react-next §3a.0 mandates; tester then burned 2× 20-min wall-clock attempts.

## Root Cause Analysis

Per investigate-031 §Findings step 3:

- `feature-graph.ts:runFeature` has a post-builder `pnpm install` invocation. On non-zero exit or known-bad-package.json diff, current code writes a warn-level log and proceeds.
- The right behavior: fail the feature's current task → route back to the named builder with a `retryContext.source = "install-failure"` carrying the install stderr + missing-dep diagnostic.
- Sister to bug-037 Phase D (Playwright runtime auto-install) — same shape: builder's scaffold gap surfaces as a downstream tester failure when caught too late.

## Fix Approach

1. In `feature-graph.ts:runFeature`'s post-builder branch, after `pnpm install`:
   - If exit non-zero, capture stderr.
   - If exit zero, run a lightweight `package.json` audit against the stack's SKILL.md §3a.0 mandates (or a stack-specific helper). The list of required deps + config files for react-next: `@playwright/test`, `@vitest/coverage-v8`, `test:e2e` script, `postinstall: playwright install chromium`, `playwright.config.ts`. For node-fastify: TBD per its skill.
   - On any of these failures: mark the builder's task as failed in `taskStatus`; populate `errors[<task-id>]` with the install-failure diagnostic (stderr snippet + missing-dep list); break out of the install branch + fall through to the retry loop.
2. The existing retry loop (per-task, same-agent) then picks up the failure + re-dispatches the builder with the new error context. Combined with bug-109's reviewer-aware routing this becomes a clean closed-loop fix.
3. Add 2 regression tests in `orchestrator/tests/feature-graph.test.ts`:
   - Builder commits a package.json missing `@playwright/test` → post-install audit fails → builder retried with diagnostic in retryContext.
   - Builder commits a clean package.json → install succeeds → tester dispatches normally.

Estimated diff: ~50 lines in feature-graph.ts + ~70 lines of tests + a small stack-helper to know which deps are mandated per stack (read from SKILL.md §3a.0 patterns, or hardcoded per react-next/node-fastify/python-fastapi).

## Rejected Fixes

- **Fail loudly but don't retry** — rejected: this is exactly the case where retry-with-context succeeds (builder gets the install stderr; one prompt-cycle later the package.json is fixed).
- **Auto-fix the missing deps via codemod** — rejected: brittle; the builder should learn to author correctly. Defense-in-depth via SKILL.md §3a.0 reinforcement + retry-context is the right shape.

## Validation Criteria

1. Builder authors a broken apps/web/package.json → install fails or audit fails → builder is retried with retryContext.source="install-failure" + the diagnostic.
2. After retry, builder fixes the package.json → next install succeeds → tester dispatches against a working worktree.
3. Regression tests pass.

## Attempt Log

### Attempt 1 — 2026-05-15 — claude-opus-4-7 — SUCCESS

Implemented per plan §Fix Approach.

Changes:

- `orchestrator/src/feature-graph.ts` — at the post-commit `installAfterCommit` call site (line 1267+), captured the install failure into a local `installFailure: string | null`. When non-null AND `isBuildAgent(agentName)`, entered a retry loop bounded by TASK_RETRY_CAP that re-invokes the same builder with `retryContext.errorMessage` carrying the install stderr. After each retry, re-runs `commitChanges` + `installAfterCommit`. On install success → exit recovery loop; on retry-cap exhaustion → return feature failed with `install-failure: <agent> produced unworkable package.json after N retries: <stderr>`. ~80 LoC.
- `orchestrator/src/invoke-agent.ts` — exported `isBuildAgent` (was private). +1 word.
- `orchestrator/src/feature-graph.ts` import block — added `isBuildAgent` to the `./invoke-agent.js` import.
- `orchestrator/tests/feature-graph.test.ts` — rewrote 2 prior tests + added 1 new:
  - "install warning on builder triggers retry; recovery succeeds when install passes 2nd time" — mock fails install once, succeeds 2nd; assert feature completes + warning surfaces in commitWarnings ✓
  - "install failure on builder exhausts retries → feature fails with install-failure reason" — mock always fails; assert status=failed + abortReason matches /install-failure/ + /backend-builder/ + tester/reviewer never invoked ✓
  - "install failure on non-builder (tester) stays warn-only" — bug-108's retry scope is build agents only; non-builder install warnings preserve legacy warn-and-continue behavior ✓

Validation:

- `pnpm vitest run tests/feature-graph.test.ts` → 64/64 passed (was 63 with 2 old, replaced with 3 new = net +1)
- `pnpm vitest run` (full orchestrator suite) → 1040/1040 passed in 38s (was 1039; +1 net new)
- Zero new typecheck errors (pre-existing 4 in perceptual-review.test.ts + walkthrough-review.test.ts + feature-graph.ts:636 + feature-graph.test.ts:703/2652/2695 are unrelated)

Decision: committed directly to master (same rationale as bug-107 — 4-bug batch on shared files).

### Lessons

1. **Replaced 2 tests that asserted the OLD (bug-108-class) behavior.** The previous tests literally asserted "install failure does NOT abort the feature — next agent still runs". That contract IS the bug. Fix discipline: when changing behavior, also update tests that codified the old behavior, with explicit comments naming the bug ID. Future archaeologists searching for "install warning" should land on the bug-108-aware tests.
2. **abortReason is the field name (not `reason`).** First test cut used `result.reason` which was undefined. The `FeatureResult.abortReason?: string` field is documented as "Human-readable reason when status !== 'completed'". Worth a /plan-refactor someday to consolidate `reason | abortReason | failureReason` field naming across orchestrator-contracts — they're inconsistent.
3. **TASK_RETRY_CAP=2 means up to 2 retries** (counter increments 1,2,3 and breaks on 3 > cap). My retry loop reuses this constant so install-failure retries match per-task-retry behavior. If bug-110's pre-dispatch gate fires AFTER an install-failure retry kicked in, the retry loop still completes its in-flight attempt before yielding.

### Cross-references

- bug-107 — pairs with this fix: bug-107 bumps tester wall-clock cap; bug-108 prevents the tester from landing on an unworkable worktree in the first place. Together they close both sides of investigate-031 H1+H4.
- bug-109 phase A — future enhancement: when the typed retryContext discriminated union lands, this fix's `retryContext.errorMessage` can be upgraded to `retryContext.source = "install-failure"` for downstream UI clarity. Behavior unchanged; semantics improved.
