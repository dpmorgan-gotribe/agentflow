---
id: bug-059-event-loop-starvation-during-parallel-dispatch
type: bug
status: completed
author-agent: human
attempt-count: 1
created: 2026-05-06
updated: 2026-05-06
parent-plan: investigate-019-sdk-keepalive-stalls-during-parallel-dispatch
supersedes: null
superseded-by: null
branch: fix/event-loop-starvation-during-parallel-dispatch
affected-files:
  - orchestrator/src/invoke-agent.ts
  - orchestrator/src/fix-bugs-loop.ts
  - orchestrator/tests/fix-bugs-loop.test.ts
feature-area: orchestrator/sdk-dispatch
priority: P1
attempt-count: 0
max-attempts: 5
error-message: |
  setInterval keepalive watcher and setTimeout wall-clock timer both
  drift by minutes when 5 SDK dispatches run in parallel via Promise.all.
  Empirical drift on reading-log-01 today: keepalive aborts firing
  +156s to +509s late (5-17 ticks dropped); wall-clock setTimeout for
  25-min builder budget didn't fire when wall-clock hit 26.25 min.
reproduction-steps: |
  1. Run /fix-bugs <project> with --max-concurrent 5 against a project
     that surfaces 5+ bugs of the same class (e.g. parity bugs).
  2. Observe stall-log.json — keepalive-gap aborts firing >300s late.
  3. The orchestrator becomes effectively unresponsive for 30+ min
     because all 5 in-flight agents must hit their delayed keepalive
     thresholds before the loop can proceed.
stack-trace: null
---

# bug-059: Event-loop starvation drifts keepalive + wall-clock timers under parallel dispatch

## Bug Description

Confirmed by investigate-019. Under `Promise.all` parallel dispatch
with maxConcurrent=5, both `setInterval` (keepalive watcher) and
`setTimeout` (wall-clock budget) drift by 5-17 ticks (2.6 min to
8.5 min) past their configured deadlines. Direct cause: per-message
SDK processing on the in-process Claude Agent SDK runs synchronous
work that blocks the Node.js event loop. With 5 concurrent
`for-await` loops, the synchronous bursts compound; timer callbacks
miss their slots.

Net effect: stalled SDK dispatches take 7-26 min wall-clock to
abort instead of the configured 5-25 min. Multiplied across 5
parallel slots, the orchestrator is effectively wedged for tens of
minutes per stall cycle.

## Reproduction Steps

See frontmatter. Empirical anchor: `projects/reading-log-01/.claude/state/<runId>/stall-log.json`
on 2026-05-06 — 3 stalls captured this session, all with abort-time
drift.

## Error Output

From investigate-019 Step 5 analysis:

| Effective `sinceLast` | Default `abortMs` (300s) | Drift                    |
| --------------------- | ------------------------ | ------------------------ |
| 322s                  | 300s                     | +22s (1 tick — healthy)  |
| 456s                  | 300s                     | +156s (5 ticks dropped)  |
| 809s                  | 300s                     | +509s (17 ticks dropped) |

`bug-parity-tags-manage` wall=1575408ms (26.25min) exceeded the
documented 25-min `stallTimeoutMs`, yet aborted via keepalive-gap
NOT wall-clock — wall-clock setTimeout missed its deadline by 75+
seconds.

## Root Cause Analysis

`orchestrator/src/invoke-agent.ts:1265-1300`:

- Wall-clock: `setTimeout(callback, stallTimeoutMs)` — fires once
  at deadline. If event loop is blocked at deadline, fires LATE.
- Keepalive: `setInterval(callback, 30s)` — drift accumulates if
  ticks are repeatedly delayed.

When 5 dispatches run in parallel, all 5 `for-await` loops process
SDK messages on the same event loop. Per-message handlers contain
synchronous work (`execSync` git ops, JSON parse on large
payloads, fs operations without async wrappers). Each sync burst
blocks the timer queue; with 5x concurrency the bursts compound
unpredictably.

## Fix Approach

### Phase A — Cap maxConcurrent default 5 → 3 (10min, ship-now)

`orchestrator/src/fix-bugs-loop.ts:1024` — change `ctx.maxConcurrent ?? 1`
to remain unchanged at the loop level, but the CLI default that gets
passed in needs a bump. Trace where `--max-concurrent` is parsed +
where the default is set; lower the default from 5 to 3.

Rationale: 3-way concurrency leaves 1.67x more event-loop budget per
dispatch. Empirical drift compounds non-linearly with concurrency;
small reduction has outsized stall-mitigation impact. Cost: ~1.67x
slower wall-clock for many-bug runs in the happy path.

Operators wanting 5-way can still pass `--max-concurrent 5`
explicitly; the default change just shifts the unsafe-by-default to
safe-by-default.

### Phase B — Polling wall-clock timer (15min, ship-with-A)

Replace the `setTimeout(callback, stallTimeoutMs)` wall-clock timer
with a `setInterval(checkDeadline, 30000)` that polls
`Date.now() - dispatchedAt >= stallTimeoutMs`. Polling catches up
after event-loop starvation; setTimeout doesn't.

Concretely in `invoke-agent.ts:1275-1280`:

```ts
// BEFORE (subject to event-loop starvation)
if (stallTimeoutMs && stallTimeoutMs > 0) {
  wallTimer = setTimeout(() => {
    abortReason = `wall-clock-${stallTimeoutMs}ms`;
    abortController.abort(abortReason);
  }, stallTimeoutMs);
}

// AFTER (catches up after starvation)
if (stallTimeoutMs && stallTimeoutMs > 0) {
  const wallDeadline = Date.now() + stallTimeoutMs;
  wallTimer = setInterval(() => {
    if (Date.now() >= wallDeadline) {
      abortReason ??= `wall-clock-${stallTimeoutMs}ms`;
      abortController.abort(abortReason);
      // setInterval clears via clearTimers when abort propagates.
    }
  }, 30_000);
}
```

The keepalive watcher is already a setInterval; it has the same
catch-up property when ticks are merely delayed (not skipped). The
wall-clock missing its single shot is the more anomalous failure
mode and Phase B closes it.

### Phase C — Test coverage (15min)

`orchestrator/tests/invoke-agent.test.ts` (or similar):

1. Wall-clock timer: simulate event-loop starvation by injecting a
   long synchronous busy-loop after dispatch; assert that the
   polling wall-clock timer fires close to the stallTimeoutMs
   deadline (not immediately, not arbitrarily late) once the loop
   unblocks. Use `vitest.fakeTimers()` for determinism.

2. Default maxConcurrent: integration test against `runFixBugsLoop`
   with no `--max-concurrent` arg verifies the new 3-way default.

### Phase D — Empirical re-validation

After Phase A+B+C ship, re-fire /fix-bugs reading-log-01 (the
investigate-019 anchor). Expected:

- Stall events still possible per H1/H2/H3 hypotheses (not all
  ruled out by H4-fix), but timer-drift component eliminated.
- Wall-clock aborts fire AT 25 min, not 26+ min.
- Keepalive aborts fire ≤ 330s, not 456-809s.
- 5 currently-stalled bugs converge to either fix or fail status
  within 5-10 min instead of indefinitely hung.

### Out of scope (deferred)

- **Mitigation B** (worker_thread keepalive watcher) — proper
  isolation. Engineering cost ~3x of Phase A+B; ship only if
  Phase A+B aren't sufficient.
- **Mitigation C** (audit + de-block all execSync calls) — large
  refactor; defer until empirical evidence forces it.

## Rejected Fixes

- **Hard-cap maxConcurrent at 1 (sequential dispatches only)** —
  Rejected: loses the parallelism win that feat-046 Phase A.1
  shipped. 3-way is a measured compromise.

- **Increase abortMs / stallTimeoutMs to mask drift** — Rejected:
  papers over the bug. Stalls still happen; operators just notice
  later. Real fix is timer correctness + reduced concurrency.

- **Move SDK dispatch to subprocess (out-of-process)** —
  Rejected: rewrites the Anthropic-supplied SDK harness; massive
  scope. Worker_thread isolation (Mitigation B) gets us most of
  the way without rewriting SDK internals.

## Validation Criteria

1. Default `--max-concurrent` is 3 (down from 5). Existing tests
   that explicitly pass higher values keep passing.
2. Wall-clock timer fires at `dispatchedAt + stallTimeoutMs` even
   when event loop has been blocked for minutes (vitest fake-timer
   test).
3. Re-fire /fix-bugs reading-log-01: stall-log.json shows abort
   reasons matching configured budgets (no more 5-17 tick drift).
4. All existing 730+ orchestrator tests still pass.

## Attempt Log

(empty — plan filed by human 2026-05-06)
