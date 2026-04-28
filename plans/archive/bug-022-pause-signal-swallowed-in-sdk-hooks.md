---
id: bug-022-pause-signal-swallowed-in-sdk-hooks
type: bug
status: archived
author-agent: claude-opus-4-7
created: 2026-04-28
updated: 2026-04-28
parent-plan: feat-024-orchestrator-pause-resume
supersedes: null
superseded-by: null
branch: fix/pm-skips-affects-files
affected-files:
  - orchestrator/src/invoke-agent.ts (3 catch blocks around pause-hook calls)
  - orchestrator/tests/invoke-agent.test.ts (new test for PauseSignal propagation through SDK loop)
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
error-message: |
  Symptom (from repo-health-dashboard-01 resume on 2026-04-28T22:01Z):
    1. Tester ran on Opus 4.7 — Opus 5-hour rate-limit event fired during invocation
    2. onRateLimitPause hook called pauseRun() → wrote paused.json + threw PauseSignal
    3. Catch in runLlmAgent (invoke-agent.ts:1210-1212) SWALLOWED the PauseSignal
    4. SDK loop continued; tester completed successfully
    5. Auto-commit + onAgentBoundary fired; orchestrator advanced to reviewer iteration
    6. Reviewer iteration's pause-sentinel poll (top of for-loop) saw paused.json → called pauseRun → PauseSignal propagated
    7. Final paused.json had reason="user-request" (overwritten by the poll's pauseRun), hiding the original rate-limit cause
reproduction-steps: |
  1. Configure auth provider claude-max-subscription with Opus 4.7 quota near
     5-hour rolling cap.
  2. /start-build (or /resume-build) a project with reasoning-heavy quality
     agents (tester, reviewer) configured to Opus.
  3. Watch for the SDK to emit a rate_limit_event during an agent invocation.
  4. Observe: the agent COMPLETES successfully despite the pause-hook firing,
     paused.json is left behind, the run advances one extra agent before the
     between-agent poll catches it.
  5. Inspect paused.json: reason field is "user-request" (from the poll's
     pauseRun overwrite), NOT the original "claude-max-five-hour-limit" /
     "claude-max-seven-day-limit" / "auth-failed" / "stall-timeout".
stack-trace: null
---

# bug-022-pause-signal-swallowed-in-sdk-hooks: SDK pause hooks fire correctly but PauseSignal is swallowed in the runLlmAgent catch blocks

## Bug Description

`runLlmAgent` (orchestrator/src/invoke-agent.ts) wraps each pause-hook
invocation in a try/catch with the comment:

```ts
} catch {
  /* swallow — pause helper failures shouldn't crash the loop */
}
```

The intent is correct (a buggy hook shouldn't crash the SDK loop) but the
implementation is wrong: it ALSO swallows `PauseSignal`, which is the hook's
SUCCESS path. PauseSignal is the documented sentinel that funnels every pause
trigger through `pauseRun()` (per pause.ts §funnel-comment) and propagates up
to cli.ts for a clean exit 0.

When the catch swallows PauseSignal:

1. The SDK message loop continues iterating past the rate-limit / auth /
   stall event
2. The agent's invocation completes "successfully" (the SDK calls didn't
   actually fail — rate-limit events are warnings before bucket exhaustion)
3. Auto-commit + onAgentBoundary fire — the orchestrator advances state
4. The next iteration's pause-sentinel poll catches the paused.json that was
   already written by the original pauseRun call
5. That poll's pauseRun OVERWRITES paused.json with reason="user-request" +
   detail="paused.json sentinel detected before <next-agent> on <feature>"
6. The original cause (rate-limit / auth / stall) is lost

## Empirical Hit (2026-04-28)

repo-health-dashboard-01 resume after bug-021 ship:

- progress.json before resume: `lastAgent=backend-builder, nextAgent=tester`
- bug-021 hydration kicked in, walked from tester
- Tester ran on Opus 4.7 (quality tier) for ~5 min — completed cleanly,
  committed `8002c3d tester: edge-case-tests`
- progress.json after tester: `lastAgent=tester, nextAgent=reviewer`
- paused.json appeared with reason="user-request" + detail="paused.json
  sentinel detected before reviewer on feat-proxy-and-cache"
- Operator confirmed they did NOT manually invoke /pause-build

The user-request reason was clearly the orchestrator's own between-agent
poll overwrite. The original cause is gone — most likely the Opus 4.7
5-hour rolling rate-limit fired during tester's reasoning-heavy edge-case
test authoring.

## Affected Code

Three catch blocks in `orchestrator/src/invoke-agent.ts`'s `runLlmAgent`:

1. **Lines ~1210-1212** — `onRateLimitPause` catch:

   ```ts
   try {
     await cfg.onRateLimitPause(pauseInfo);
   } catch {
     /* swallow — pause helper failures shouldn't crash the loop */
   }
   ```

2. **Lines ~1223-1225** — `onAuthFailedPause` catch:

   ```ts
   try {
     await cfg.onAuthFailedPause({ detail: am.error });
   } catch {
     /* same — never fail the loop on a pause-helper bug */
   }
   ```

3. **Lines ~1265-1267** — `onStallTimeoutPause` catch:
   ```ts
   try {
     await cfg.onStallTimeoutPause({ ... });
   } catch {
     /* swallow */
   }
   ```

All three sites have the same bug shape.

## Fix Approach

**One-line change per catch site:** re-throw if the caught error is a
`PauseSignal`. Other errors stay swallowed (the comment's intent is preserved
for genuinely buggy hooks).

```ts
} catch (err) {
  if (err instanceof PauseSignal) throw err;
  /* swallow — pause helper failures shouldn't crash the loop */
}
```

Add `import { PauseSignal } from "./pause.js"` at the top of
invoke-agent.ts.

The PauseSignal then propagates:

- Out of runLlmAgent → into runFeature's `await ctx.invokeAgent(...)`
- Out of runFeature → into runFeatureGraph's promise.race + drain
- Out of runFeatureGraph → into cli.ts's catch → exit 0 with the ORIGINAL reason

## Rejected Fixes

- **"Make pauseRun NOT throw"** — rejected. The throw is the documented
  funnel that lets cli.ts distinguish pause from crash. Removing it would
  require the orchestrator's runners to manually check a flag after every
  await call, which is fragile.
- **"Move the catch outside the for-loop"** — rejected. The for-loop
  iterates SDK messages; we want each message processed independently. A
  hook throwing on message N shouldn't affect processing of message N+1
  in the SDK iterator. The fix is to re-throw the specific signal we
  care about, not restructure the loop.
- **"Don't write paused.json from pauseRun until the throw catches"** —
  rejected. The atomic-write semantics are deliberate: even if the throw
  is swallowed, the on-disk paused.json acts as a safety net that the
  next iteration's poll catches. Bug-022's fix preserves this safety net
  AND makes the immediate path work correctly.

## Validation Criteria

- New test `runLlmAgent — bug-022 pause hook propagation` in
  `invoke-agent.test.ts`: configure a stub `onRateLimitPause` that throws
  PauseSignal. Inject a stub queryFn that emits a rate_limit_event with
  `rateLimitType: five_hour`, then continues with subsequent messages.
  Assert that the await on `runLlmAgent` rejects with PauseSignal — NOT
  resolves with the stub's would-be result.
- Same coverage for `onAuthFailedPause` (assistant message with
  `error: authentication_failed`) and `onStallTimeoutPause`
  (abort-signaled invocation).
- Existing 552/552 orchestrator + 344/344 contracts tests still pass.
- E2E validation: re-launch repo-health-dashboard-01 resume; if Opus
  rate-limit fires again, observe paused.json with the ORIGINAL reason
  (claude-max-five-hour-limit or claude-max-seven-day-limit), not
  user-request. Run halts at the agent that triggered the rate limit,
  not the next one.

## Cross-references

- **Parent**: feat-024 (orchestrator-pause-resume — introduced PauseSignal
  - the pause hooks)
- **Discovered while resuming**: bug-021 (the resume that exposed this
  bug — bug-021's fix worked correctly + revealed bug-022 as the next
  blocker for full autonomous operation)
- **Related**: bug-020 (recovery decision tree) — depends on paused.json's
  reason field being accurate; bug-022 fix restores that signal

## Attempt Log

<!-- Populated automatically by agents. -->

---

# COMPLETION RECORD (appended on archive)

completed: 2026-04-28
outcome: success
actual-files-changed:

- orchestrator/src/invoke-agent.ts (modified — 4 catch sites fixed)
- orchestrator/tests/invoke-agent.test.ts (modified — 3 new tests)
- orchestrator/tests/feature-graph.test.ts (modified — drive-by fix to bug-021 fixtures)
  commits:
- hash: 88c5b32
  message: "bug-022: re-throw PauseSignal from SDK pause-hook catches"
  attempts: 1
  lessons:
- "Plan said 3 catch sites needed fixing; reality was 4 (the outer for-await catch around the SDK message loop ALSO swallowed PauseSignal into queryThrew). Always trace the FULL throw path from hook → up the call stack — don't trust the plan's count of catches without re-verifying."
- "Drive-by lesson: bug-021's tests passed pnpm test but had typecheck errors (bogus TasksV2 fields, readonly literals). I ran `pnpm typecheck` BEFORE adding tests, not after. Lesson: tests are code; typecheck after adding them too. Vitest isn't a substitute for tsc --noEmit on test files."
- "PauseSignal funnels every pause cause (rate-limit / auth-failed / stall / SIGINT / user) through one type. When something catches Error generically, PauseSignal gets caught too. Future similar code should either (a) check `err instanceof PauseSignal` and re-throw, or (b) catch a more specific class than Error."
  test-results:
  unit: 555/555 orchestrator + 344/344 contracts (3 new bug-022 tests, 0 regressions)
  integration: validated by re-launch of repo-health-dashboard-01 resume (next session step)
  duration-minutes: 35
