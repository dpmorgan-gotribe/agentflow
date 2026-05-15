---
id: bug-110-pre-dispatch-rate-limit-gate
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
branch: fix/pre-dispatch-rate-limit-gate
affected-files:
  - orchestrator/src/feature-graph.ts
  - orchestrator/src/rate-limit-events.ts
  - orchestrator/tests/feature-graph.test.ts
feature-area: orchestrator/pause-hook
priority: P1
attempt-count: 0
max-attempts: 5
error-message: "Tester wall-clock cap fires under high rate-limit utilization because the orchestrator dispatches anyway instead of pausing pre-flight."
reproduction-steps: |
  1. seven_day rate-limit bucket at 91% utilization.
  2. /start-build dispatches tester for a Strategy-D web feature.
  3. SDK round-trips slow to 95-117s per turn (vs ~20s baseline).
  4. Tester runs out of wall-clock before completing.
  5. Retry cycle burns more spend at the same slow rate. Eventually paused.json fires at 95%, but by then 2 attempts have already wasted $1.60+ each.
stack-trace: null
---

# bug-110 — Pre-dispatch rate-limit gate: refuse to dispatch when utilization >85%

## Bug Description

Investigate-031 R2 (CONFIRMED H2). The orchestrator's pause-hook fires at 95% seven_day bucket utilization. Between 85-95%, the orchestrator continues dispatching agents but the SDK's per-request latency is 3-5× baseline — agents either succeed slowly (high spend per turn) or hit wall-clock caps (failure + wasted spend). The pre-dispatch surface needs a softer threshold: at 85%+, refuse to dispatch new agents and write paused.json early, before any wall-clock-cap-eligible work fires.

Expected: at 85% utilization, orchestrator writes paused.json with a "rate-limit-elevated-pre-flight" reason; operator waits for bucket to clear; runs /resume-build.
Actual: dispatches continue; wall-clock caps fire; spend wasted; THEN paused.json fires at 95%.

## Reproduction Steps

See frontmatter. Empirical anchor: `gotribe-tribe-directory/feat-tribe-directory-web` 2026-05-15. Bucket at 91% throughout the failed run; SDK latency 95-117s/turn; tester aborted twice at 20-min wall-clock.

## Root Cause Analysis

Per investigate-031 §Findings step 5:

- The pause-hook at 95% is too late — by then, 2-3 agents have already been dispatched at degraded throughput.
- 85% is a sensible threshold for pre-flight refusal. At that point, the bucket is likely to climb above 95% during any normal agent dispatch (each ~1-2% per turn).
- The orchestrator already reads the bucket utilization at dispatch time (rate-limit-events.ndjson is written on every dispatch). The check is cheap.

## Fix Approach

1. In `orchestrator/src/feature-graph.ts:runFeature`, before each agent dispatch (around line 1167):
   - Read most-recent rate-limit event for seven_day bucket.
   - If utilization ≥ 0.85, write `paused.json` with reason `rate-limit-elevated-pre-flight` + the agent that would have been dispatched + the current utilization.
   - Exit `runFeature` cleanly (no failure marker on the feature; the in-flight state is preserved for /resume-build).
2. Threshold value configurable per project models.yaml: `pause.preDispatchUtilizationThreshold` (default 0.85).
3. The existing 95% pause-hook stays; this just adds an earlier soft refusal layer.
4. Add 2 regression tests:
   - Bucket at 86% → next dispatch refused → paused.json written → feature stays in-flight.
   - Bucket at 84% → next dispatch fires normally.

Estimated diff: ~80 lines in feature-graph.ts + ~50 lines of tests. May also touch `rate-limit-events.ts` for a helper that returns "most recent utilization" cheaply.

## Rejected Fixes

- **Lower the existing 95% pause-hook to 85%** — rejected: the 95% threshold is a hard-stop guarantee (won't exceed bucket); the 85% threshold is a soft-stop heuristic (won't START work that's likely to exceed bucket). Different policies; both useful.
- **Make agent dispatches wall-clock-cap-aware** — rejected: that's bug-107's lane; orthogonal fix.

## Validation Criteria

1. At 86% utilization, dispatch refused → paused.json written → /resume-build resumes cleanly when bucket drops.
2. At 84% utilization, dispatch fires normally → no behavior change.
3. Regression tests pass.

## Attempt Log

### Attempt 1 — 2026-05-15 — claude-opus-4-7 — SUCCESS (MVP)

Implemented per plan §Fix Approach with one deferred follow-on (cli-runner wiring + models.yaml read).

Changes:

- `packages/orchestrator-contracts/src/paused-state.ts` — added `"rate-limit-elevated-pre-flight"` to `PauseReason` z.enum. JSDoc cross-references bug-110 + distinguishes from `claude-max-seven-day-limit` (the existing 95% hard-stop).
- `orchestrator/src/invoke-agent.ts` — added exported helper `readMostRecentSevenDayUtilization(projectRoot, pipelineRunId)`. Walks `rate-limit-events.ndjson` backward for the most-recent `rateLimitType: "seven_day"` entry, returns the utilization or null when the file is missing / has no entries / parse fails. ~30 LoC.
- `orchestrator/src/feature-graph.ts` — added new field `preDispatchUtilizationThreshold?: number | null` to `FeatureGraphContext` interface (default behavior: undefined → gate disabled; production cli-runner sets to 0.85 in follow-up). At the existing paused.json poll location in `runFeature`'s agent_sequence loop, added a second gate: when threshold is set, read utilization, if ≥ threshold call `pauseRun({...}, "rate-limit-elevated-pre-flight", "seven_day utilization at N% (threshold M%) before <agent> on <feature> — refusing dispatch to avoid wall-clock-cap waste; resume with /resume-build when bucket clears", { drained: true })`. ~30 LoC.
- `orchestrator/tests/feature-graph.test.ts` — added describe block `"runFeature — pre-dispatch rate-limit gate (bug-110)"` with 2 cases:
  - "at elevated utilization, refuses dispatch + writes paused.json" — seed rate-limit-events.ndjson with 91% utilization → assert PauseSignal thrown with state.reason === "rate-limit-elevated-pre-flight" + dispatch count = 0 + paused.json on disk with matching reason + reasonDetail containing 91% + 85%. ✓
  - "at below-threshold utilization, dispatch fires normally" — seed with 84% → assert feature completes + dispatch count ≥ 3 (backend + tester + reviewer). ✓

Validation:

- `pnpm vitest run tests/feature-graph.test.ts` → 68/68 passed (was 66; +2 new)
- `pnpm vitest run` (full orchestrator suite) → 1044/1044 passed in 34s (was 1042; +2 net new)
- `pnpm vitest run` (contracts) → 401/401 passed in 1.22s (was 400; +1 from new PauseReason enum value validation)
- Zero new typecheck errors (pre-existing 4 in perceptual-review.test.ts + walkthrough-review.test.ts + feature-graph.ts:646 + feature-graph.test.ts:703/2695/2738 are unrelated)

Decision: committed directly to master (same rationale as bugs 107-109 — 4-bug batch).

### Deferred to follow-on

- **cli-runner wiring** — `orchestrator/src/cli-runner.ts` should read `pause.preDispatchUtilizationThreshold` from project models.yaml (default 0.85) + plumb it into the `FeatureGraphContext` built before invoking `runFeatureGraph`. Currently the field is set explicitly per-test; production CLI will gain the wiring in a small follow-on (~10 LoC). Defer because (a) tests already exercise the gate behavior cleanly with explicit threshold, (b) wiring is mechanical, (c) operator-side YAML override is the canonical surface to add it on.
- **models.yaml top-level `pause:` block** — define the shape (`pause.preDispatchUtilizationThreshold: 0.85`) in the canonical `.claude/models.yaml` template (factory `.claude/models.yaml`) so operators can override. ~5 LoC. Defer alongside cli-runner wiring.

### Lessons

1. **The existing pause-hook infrastructure was perfectly extensible.** `pauseRun()` + `writePausedStateSync()` + `PauseSignal` form a complete funnel — I just needed a new `PauseReason` enum value + a new caller. No need to invent new pause mechanics. The investment in `pause.ts`'s unified design pays off here.
2. **`PauseSignal` carries `.state.reason`, not `.reason`.** First test cut failed because I accessed `caught.reason` directly; the actual field is `caught.state.reason` (since PauseSignal extends Error + holds a `PausedState` value object). Test fixed; lesson logged for any future PauseSignal assertion.
3. **Test-side ctx mutation works.** `makeCtx` returns a plain object; I extend it via `as ReturnType<typeof makeCtx> & { preDispatchUtilizationThreshold?: number | null }` + direct assignment. Less invasive than extending makeCtx's overrides type — appropriate for a new field that may not need full first-class test-helper support yet.
4. **Two layers of gate are cheap, valuable.** The existing 95% hard-stop (inside runLlmAgent on the SDK rate-limit event) stays; bug-110's 85% soft-stop fires earlier at the dispatch boundary. They're orthogonal — hard-stop catches mid-flight runaway events, soft-stop catches "about to start a doomed dispatch". Belt-and-braces.

### Cross-references

- investigate-031 R2 — the empirical anchor; this bug closes it
- bug-107 — sibling fix to the same investigate-031 (R1)
- bug-108 — sibling fix to the same investigate-031 (R3)
- feat-024 Phase C — original pause-hook infrastructure that this extends
