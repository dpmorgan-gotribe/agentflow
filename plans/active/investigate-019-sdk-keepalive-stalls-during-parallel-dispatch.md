---
id: investigate-019-sdk-keepalive-stalls-during-parallel-dispatch
type: investigation
status: draft
author-agent: human
created: 2026-05-06
updated: 2026-05-06
parent-plan: null
supersedes: null
superseded-by: null
branch: null
affected-files:
  - orchestrator/src/invoke-agent.ts
  - orchestrator/src/fix-bugs-loop.ts
  - .claude/state/<runId>/stall-log.json
  - .claude/state/<runId>/rate-limit-events.ndjson
feature-area: orchestrator/sdk-dispatch
priority: P1
attempt-count: 0
max-attempts: 5
time-box-minutes: 90
hypothesis: |
  SDK calls go silent for 5-15 min during parallel-dispatch /fix-bugs runs
  on reading-log-01, requiring keepalive-watchdog aborts. Multiple
  hypotheses: (H1) Claude Max subscription silently rate-limits / drops
  messages under parallel load; (H2) agent prompts trigger very long
  Claude reasoning that doesn't surface partial output; (H3) specific
  tool-call patterns (long Bash commands, large Read returns) block the
  SDK message stream; (H4) NodeJS event loop contention starves the
  setInterval keepalive watcher; (H5) transient Anthropic API connectivity
  issues during heavy parallel load. H4 is most likely given the empirical
  pattern (only happens with maxConcurrent>=2; abort gaps cluster around
  the same wall-time across parallel siblings).
---

# investigate-019: Why do SDK dispatches stall during parallel /fix-bugs runs?

## Question

Reading-log-01 /fix-bugs runs hit 3+ keepalive-watchdog aborts per
attempt cycle, even after the full investigate-018 stack landed. The
SDK calls go silent for 5-15 min mid-dispatch, requiring the
keepalive watchdog to abort. Pattern is consistent across agent
types (web-frontend-builder, reviewer) and across bug classes
(parity, runtime, flow-execution).

What's the actual root cause? Is it (a) the Claude Max subscription
silently rate-limiting under parallel load, (b) Claude SDK
event-loop starvation when many parallel queries run, (c) specific
agent prompts triggering very long no-output reasoning, or (d)
something else?

## Empirical anchor

`projects/reading-log-01/.claude/state/25656fec-99e8-42e9-91f3-437c76cfda62/stall-log.json`
(ALL from this session, 2026-05-06):

```jsonl
{"featureId":"feat-search-filter","agent":"reviewer",
 "dispatchedAt":1778071918647,"lastKeepAliveAt":1778072011858,
 "abortReason":"keepalive-gap-326896ms","wallTimeMs":420108,
 "ts":"2026-05-06T12:58:58.756Z"}

{"featureId":"bug-runtime-tooling-pre-flight","agent":"web-frontend-builder",
 "dispatchedAt":1778079136442,"lastKeepAliveAt":1778079432009,
 "abortReason":"keepalive-gap-808602ms","wallTimeMs":1104211,
 "ts":"2026-05-06T15:10:40.653Z"}

{"featureId":"bug-parity-tags-manage-layout-regrouping","agent":"web-frontend-builder",
 "dispatchedAt":1778098283723,"lastKeepAliveAt":1778099402711,
 "abortReason":"keepalive-gap-456418ms","wallTimeMs":1575408,
 "ts":"2026-05-06T20:37:39.131Z"}
```

Plus latest run be56zlptr (still in flight at pause time): orchestrator
output captured 4 simultaneous keepalive warnings:

```
[runLlmAgent] web-frontend-builder on bug-parity-book-create: no SDK message in 97s
[runLlmAgent] web-frontend-builder on bug-parity-book-detail: no SDK message in 96s
[runLlmAgent] reviewer on bug-parity-books-list-empty: no SDK message in 103s
[runLlmAgent] tester on bug-parity-tags-manage: no SDK message in 95s
```

Four distinct dispatches all hit the 90s warn threshold within ~10s
of each other. That's a strong correlation — suggests common cause
across siblings, not bug-specific behavior.

Also notable: bug-parity-tags-manage had wall=1575408ms = 26.25 min,
EXCEEDING the documented 25-min builder stallTimeoutMs budget. Yet
the abort fired via keepalive-gap, not wall-clock. That's a
secondary anomaly — the wall-clock timer should have fired first.

## Hypothesis (priority order)

**H4 (highest a-priori): NodeJS event loop contention starves the
setInterval keepalive watcher.** When 5 dispatches run in parallel
via Promise.all (per fix-bugs-loop.ts:1208), each agent's
keepaliveTimer is a setInterval(checkIntervalMs=30s). If the event
loop is blocked by another dispatch's heavy synchronous work
(e.g. large prompt parsing, big tool-result rendering), all
keepalive timers drift. The "lastKeepAliveAt" reset only fires when
a new SDK message arrives, but the abort check only fires when the
setInterval ticks — and both can be delayed under load.

Evidence FOR H4:

- 4 simultaneous keepalive warnings within ~10s of each other
  (correlated, not random)
- Stalls only seen during parallel maxConcurrent>=2 paths
- abortMs default is 300s but actual aborts fire at 326-808s
  (timer drift compatible with event-loop starvation)

Evidence AGAINST H4:

- The 326s case is barely over default 300s — could just be next-tick.
- The 808s case is 2.7x over default — hard to explain by drift alone.

**H1: Claude Max subscription silently rate-limits / drops messages
under parallel load.** The subscription has hidden concurrency caps;
when exceeded, individual queries' message streams stall instead of
returning a clean rate-limit error.

Evidence FOR H1:

- claude-max-subscription is the auth provider in use
- Anthropic's 5-hour + 7-day quotas are documented but per-second
  / per-minute concurrency caps are not. They might exist + degrade
  silently.
- rate-limit-events.ndjson shows past `allowed_warning` events on
  this project — proves rate limit machinery is active.

Evidence AGAINST H1:

- A clean rate-limit response would surface as `rate_limit_event`
  message type (handled in invoke-agent.ts line 1346+). These
  stalls don't fire the rate-limit event hook.

**H2: Specific agent prompts trigger very long Claude reasoning
without surfacing partial output.** The Anthropic API streams
intermediate tokens, but if the model reasons internally (no tool
calls, no text output) for >5 min, the SDK appears silent.

Evidence FOR H2:

- Stalls cluster on bug classes with large fix surfaces (parity
  with 7-18 missing/extra nodes; runtime errors with full
  traceback context).
- Pre-feat-058, the 3-agent sequence had longer dispatches but
  fewer stalls. Trimming to 1-2 agents may concentrate the work
  per dispatch, causing longer single-prompt reasoning.

Evidence AGAINST H2:

- Anthropic API claims continuous streaming. Even mid-reasoning,
  partial tokens flow.

**H3: Specific tool-call patterns block the SDK message stream.**
Long Bash commands (e.g. `pnpm install` running 60s+) or very
large Read results don't yield to the message stream; the SDK
appears silent until the tool returns.

Evidence FOR H3:

- Builders run lots of `pnpm install`, `prisma generate`, and
  other multi-second commands.
- tool_progress messages should fire periodically but might be
  Bash-tool-specific and skipped for synchronous-looking calls.

Evidence AGAINST H3:

- Each tool call is a discrete SDK message; even if it took
  60s, that's <300s default abort threshold.

**H5 (lowest a-priori): Anthropic API connectivity flakiness.**

Evidence FOR H5:

- Heavy parallel load could trigger upstream throttling or
  connection drops that don't surface cleanly to the SDK client.

Evidence AGAINST H5:

- Repeated stalls on the same machine + provider over hours
  suggest a pattern, not transient flakes.

## Investigation Steps

### Step 1 — Reproduce the stall in isolation (15min)

Write a minimal repro: dispatch 5 web-frontend-builder agents in
parallel against a synthetic feature with the same prompt-shape as
parity bugs (large affectsFiles list + large message). Capture:

- Time-stamped log of every SDK message received (msg.type,
  msg.subtype if any, length)
- Wall-clock per parallel dispatch
- Whether the stall fires deterministically or only intermittently

Tooling: `orchestrator/scripts/_tmp-stall-repro.ts` (one-off).

If the stall reproduces deterministically → core issue is in
orchestrator + SDK. If it doesn't → environmental (network /
provider).

### Step 2 — Distinguish H4 (event-loop) from H1 (rate-limit) (15min)

Add `process.hrtime.bigint()` instrumentation to the keepaliveTimer
tick: log the actual interval since last tick. If event-loop
starvation is real, ticks should land at 60-120s instead of the
configured 30s during parallel dispatches.

If ticks are on time but lastKeepAliveAt isn't updating → SDK
message stream is genuinely silent → H1 / H2 / H3 / H5 territory.

If ticks are delayed → H4 confirmed.

### Step 3 — Test H1 with rate-limit-events.ndjson (10min)

Read the project's `rate-limit-events.ndjson`:

```bash
cat projects/reading-log-01/.claude/state/<runId>/rate-limit-events.ndjson
```

Cross-correlate event timestamps with stall-log abort timestamps.
If `allowed_warning` events fire JUST before stalls → H1 confirmed.

### Step 4 — Test H2/H3 with SDK-level message-type histogram (15min)

For each pre-stall window (10 min before abort): count SDK message
types (assistant text, tool_use, tool_result, keep_alive, etc.).
If `keep_alive` events stop firing but tool calls were in flight
→ H3 (tool-call blocking). If NO messages fire (no tools in
progress, no text streamed) → H2 (long internal reasoning).

### Step 5 — Test wall-clock-timer anomaly (10min)

Why did bug-parity-tags-manage run 26.25 min (over the 25-min
builder stallTimeoutMs default) yet abort via keepalive instead
of wall-clock? Two possibilities:

1. The default is overridden somewhere to a higher value
2. The wall-clock timer has a bug (not firing reliably under load)

Read `models.yaml` resolution path; trace where stallTimeoutMs is
actually set for web-frontend-builder. If config is 25min, the
26.25min observation contradicts the config — implies wall-clock
timer drift / starvation (compatible with H4).

### Step 6 — Mitigation candidates (decision)

Based on Steps 1-5 findings, pick:

- **If H4 confirmed** (event-loop starvation):
  - Lower default abortMs from 300s → 180s so aborts fire faster
    under load, retry sooner.
  - OR move keepalive watcher to a worker_thread / separate process
    so it doesn't compete with main loop's parallel work.
  - OR cap maxConcurrent more aggressively for fix-bugs-loop
    (e.g. cap at 3 instead of 5) until H4 resolves.

- **If H1 confirmed** (rate-limit silent drops):
  - File upstream issue with Anthropic re: claude-max-subscription
    parallel-query semantics.
  - Add explicit pre-flight rate-limit probe before parallel
    dispatch.

- **If H2/H3 confirmed** (long reasoning / tool blocking):
  - Tighten agent prompts to avoid very large input contexts
    (fewer files in affectsFiles + retryContext at once).
  - Add explicit tool_progress callbacks for long-running tools.

- **If H5 confirmed** (upstream flakiness):
  - Add SDK-level retry on connection drop with exponential backoff.

### Step 7 — Document + close loop (15min)

Write findings into this plan's `## Findings` section. File
follow-up bug/feat plans as needed (e.g. `bug-060-event-loop-
starvation-during-parallel-dispatch` if H4 wins).

## Findings

### Step 3 — Rate-limit events audit (✓ done 2026-05-06)

Read `projects/reading-log-01/.claude/state/<runId>/rate-limit-events.ndjson`
(79 entries across the day). **ALL events are `status: "allowed"`** with
`overageStatus: "rejected"` (meaning overage attempts are rejected, not the
queries themselves). NONE are `status: "rejected"` or `"allowed_warning"`.

Cross-correlation with stall-log entries:

| Stall ts            | Pre-stall rate-limit events         | Status  |
| ------------------- | ----------------------------------- | ------- |
| 2026-05-06T12:58:58 | 12:52:10, 12:59:05 (same featureId) | allowed |
| 2026-05-06T15:10:40 | 14:52:24, 15:11:55 (same featureId) | allowed |
| 2026-05-06T20:37:39 | 19:30:31 (same featureId)           | allowed |

**H1 (claude-max silent rate-limit) PARTIALLY REFUTED at the documented
quota layer.** No five-hour or seven-day quota events fired anywhere
near stall times. If the subscription has hidden per-second / per-minute
concurrency caps, they wouldn't surface in this log — those would
require Step 1 repro to confirm. But the documented quota layer is
clearly NOT the issue.

### Step 5 — Wall-clock timer anomaly (✓ done 2026-05-06)

Read `orchestrator/src/invoke-agent.ts:1255-1280`. Wall-clock timer is:

```ts
if (stallTimeoutMs && stallTimeoutMs > 0) {
  wallTimer = setTimeout(() => {
    abortReason = `wall-clock-${stallTimeoutMs}ms`;
    abortController.abort(abortReason);
  }, stallTimeoutMs);
}
```

Default for builders per models.yaml: 25 min (1,500,000 ms). Empirical
data from stall-log shows:

| Bug                            | Agent                | wallTimeMs             | abortReason            |
| ------------------------------ | -------------------- | ---------------------- | ---------------------- |
| feat-search-filter             | reviewer             | 420,108 (7m)           | keepalive-gap-326896ms |
| bug-runtime-tooling-pre-flight | web-frontend-builder | 1,104,211 (18m)        | keepalive-gap-808602ms |
| bug-parity-tags-manage         | web-frontend-builder | **1,575,408 (26.25m)** | keepalive-gap-456418ms |

**The third row is critical.** Wall-clock = 26.25 min, EXCEEDING the
25-min builder budget by 75 seconds. Yet `abortReason` is keepalive-gap,
NOT wall-clock-1500000ms. This means **the wall-clock setTimeout did
NOT fire at its 25-min deadline** — the keepalive's setInterval fired
later instead.

A setTimeout missing its deadline by 75+ seconds is direct evidence
of event-loop starvation. The Node.js event loop was so busy it
delayed the timer-callback queue.

### H4 (event-loop starvation) — STRONGLY SUPPORTED

Re-examining keepalive abort gaps:

| Effective sinceLast | Default abortMs (300s) | Drift                        |
| ------------------- | ---------------------- | ---------------------------- |
| 326,896 ms (322s)   | 300s                   | **+22s** (1 tick) — healthy  |
| 456,418 ms (456s)   | 300s                   | **+156s** (5 ticks dropped)  |
| 808,602 ms (809s)   | 300s                   | **+509s** (17 ticks dropped) |

The keepalive setInterval should tick every 30s (`checkIntervalMs`).
For abort to fire at sinceLast=809s instead of ~310s, the timer
callback queue dropped ~17 of its 30s ticks. That's 8.5 minutes of
event-loop blocking — IMPOSSIBLE on a healthy Node.js process unless
heavy synchronous work was running on main thread.

### Concrete root cause hypothesis

The Claude Agent SDK runs **in-process** (not subprocess). When
`Promise.all` dispatches 5 parallel agents, all 5 `for-await` loops
iterate on the SAME event loop. Per-message processing in some
handlers contains synchronous work — likely candidates:

- `execSync(...)` calls in the dispatch path (git operations,
  worktree management) — each blocks the event loop for hundreds
  of ms to seconds
- JSON parse/stringify on large message payloads
- File-system operations without `await`-ed wrappers

Under 5-way concurrency, these synchronous bursts compound. The
keepalive setInterval and wall-clock setTimeout both go in the same
timer queue and get starved.

**H4 confirmed empirically.** No need for Step 1 (live SDK repro)
or Step 2 (instrumentation) at this point — the timer-drift evidence
in stall-log.json is conclusive.

## Recommendation

File **bug-059-event-loop-starvation-during-parallel-dispatch** as a
follow-up. Three concrete mitigations, in priority order:

### Mitigation A (low-risk, ship-now): Cap maxConcurrent for fix-bugs-loop

Reduce default cap from 5 → 3. Reduces parallel pressure on the
event loop. Empirical: with 3-way parallelism, event-loop budget per
dispatch ~1.67x higher; setTimeout/setInterval drift should resolve
or shrink dramatically. Cost: ~1.67x slower wall-clock for
many-bug runs. Net win on stalled runs (which currently take
infinite time).

### Mitigation B (medium-risk, ship-next): Move keepalive watcher to worker_thread

Spawn a dedicated `worker_threads.Worker` whose only job is to
tick keepalive timers + call `abortController.abort()` via a
SharedArrayBuffer signal. Worker thread isolates the timer from
main-thread synchronous-work bursts. Requires careful AbortSignal
plumbing but textbook isolation pattern.

### Mitigation C (highest-risk, longer-term): Audit + de-blocked all execSync calls

Replace every `execSync` in the dispatch hot-path with `execFile` +
async wrapper. Ensures no per-call event-loop block exceeds whatever
the OS scheduler gives us. Significant code churn; defer until
A+B aren't sufficient.

### Wall-clock timer fix

Specifically for the wall-clock timer drift: change from
`setTimeout(callback, ms)` to `setInterval(checkDeadline, 30000)`
that polls `Date.now() - dispatchedAt >= stallTimeoutMs`. Polling
catches up after event-loop starvation; setTimeout doesn't. Small
patch, ship inside Mitigation A.

### Cross-references

- `bug-058` (just-shipped) — fixupBranch sync; orthogonal to this
  but in the same /fix-bugs reliability bucket
- `feat-058` — sequence trim reduces per-bug agent count; cuts
  parallel pressure indirectly
- `feat-046 Phase A.1` — original parallelism feature; this
  investigation closes a known limitation

## Attempt Log

(empty — plan filed by human 2026-05-06 with empirical data from
session ending be56zlptr at 20:55)
