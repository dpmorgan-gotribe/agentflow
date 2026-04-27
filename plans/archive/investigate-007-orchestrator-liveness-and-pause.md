---
id: investigate-007-orchestrator-liveness-and-pause
type: investigation
status: completed
recommendation-implemented-by: feat-024-orchestrator-pause-resume
author-agent: claude-opus-4-7
created: 2026-04-27
updated: 2026-04-27
completed-at: 2026-04-27
parent-plan: null
supersedes: null
superseded-by: null
branch: null
affected-files: []
feature-area: orchestration
priority: P1
attempt-count: 1
max-attempts: 5
time-box-minutes: 45
hypothesis: "Mode B has no liveness signal — when the Claude Agent SDK call hangs (silent stall: no error, no progress), the orchestrator waits indefinitely. We need (a) an active liveness probe with a per-agent stall timeout that surfaces to the user as 'agent X has been silent N minutes — likely stuck', plus (b) explicit /pause-build + /resume-build skills so the user can interrupt the run cleanly (e.g. when they need a break, when Claude Max hits its 5h subscription limit, when they spot an environment issue). The pause primitive lets the orchestrator persist mid-run state + cleanly resume without the brittle git-cleanup dance we did manually after kanban-webapp-10's stall."
---

# investigate-007 — Orchestrator liveness signals + /pause-build + /resume-build

## Question

The kanban-webapp-10 Mode B run silently stalled for 70+ minutes inside a Claude Agent SDK call (web-frontend-builder dispatched on `feat-filters`, wrote uncommitted changes, then went CPU-quiet with no error, no log line, no timeout). The user discovered this by noticing worktree mtimes were stale; the orchestrator itself had no idea anything was wrong.

**Three intertwined sub-questions:**

1. What's the cheapest way to detect "this agent invocation has gone silent and is probably stuck" + surface it to the user without false positives?
2. How should `/pause-build` + `/resume-build` work — so the user can deliberately interrupt + resume a multi-hour Mode B run cleanly (preserving all merged features + the in-flight worktree state, not requiring the manual `git worktree remove --force` + branch-delete dance we did to recover -10)?
3. What ELSE besides "user wants a break" should auto-invoke `/pause-build`? (Claude Max 5-hour subscription limit, network outage, low-disk, dirty-git-state-detected, etc.)

## Hypothesis

Liveness + pause are the same problem from two ends — both require the orchestrator to checkpoint state mid-run + know how to gracefully suspend / resume. Once the checkpoint mechanism exists, layering different triggers (heartbeat-based stall detection, user-invoked pause, environmental triggers) is mostly mechanical.

The current orchestrator's `--resume-feature-graph` is a coarse resume that re-walks tasks.yaml from scratch, leaning on git state + missing-file heuristics. For the stall-recovery use case we hit on kanban-10 it failed (orchestrator thought all features needed re-dispatch even though 4 were merged). A proper pause/resume needs:

- A "feature-graph progress" state file (which features are merged-to-main, which are in-flight in worktrees, which haven't started)
- A liveness ledger (per-invocation: dispatched-at, last-progress-at)
- Resume logic that consults BOTH (skip merged, recover in-flight worktrees by re-checking their git state + diffing against the agent's expected output).

For pause triggers — Claude Max's 5-hour subscription limit is concrete + happens predictably; SDK errors typically surface (we'd see them); silent hangs are the harder case (need an active liveness probe).

## Investigation Steps

### Step 1 — Diagnose the actual stall (10 min)

Re-read the kanban-webapp-10 stall evidence (stdout output file at `tasks/bkak61sd3.output` was 5 lines after 70 min). Determine:

- Was the SDK actually mid-call, or was the orchestrator's `await` resolved but the process hung in a different layer (event loop vs. parent pnpm wrapper vs. tsx loader)?
- Does the Claude Agent SDK have any built-in timeout / heartbeat / progress-message capability we're not using?
- Walk `orchestrator/src/invoke-agent.ts::runLlmAgent` — is there an `AbortController` or `signal` we can wire up?

Grep for: `AbortController`, `signal:`, `timeout`, `setTimeout`, `progress`, `heartbeat`, `keepalive`. Check `@anthropic-ai/claude-agent-sdk` types for any `onProgress` or `signal` option.

### Step 2 — Survey liveness-probe options (10 min)

Enumerate plausible stall-detection mechanisms with rough effort/coverage:

| Option | What it catches | False-positive risk | Effort |
|---|---|---|---|
| Per-invocation `AbortController` with N-min hard timeout | All silent hangs | Long-running legitimate agent calls would abort | Low |
| Heartbeat: orchestrator polls worktree mtime every M sec; if no change for K min → flag | Silent hangs that don't write files | Misses agents that ARE writing but not committing | Low |
| Watch SDK message stream for ≥1 message every N sec | Hangs at the SDK layer | Misses pre-stream auth hangs | Medium |
| Request a "progress" SDK feature from Anthropic (feature request) | Comprehensive | None — but slow + external | High |
| Active health-check: orchestrator pings the agent process every M sec; if unresponsive → flag | Process-level hangs | None | Medium |
| Wall-clock budget per-agent-task (e.g. web-frontend-builder = max 30 min, then surface warning) | All hangs | Slow tasks legitimately exceed | Low-Medium |
| **Hybrid** (worktree mtime + per-agent wall budget + AbortController) | Most cases | Low | Medium |

Cross-reference with the SDK's actual capabilities (Step 1 findings).

### Step 3 — Design /pause-build + /resume-build (10 min)

Sketch the pause/resume contract:

- **Pause trigger entry points** (each maps to one pause-emit code path):
  - User invokes `/pause-build <project>` directly
  - Orchestrator detects Claude Max subscription limit (need to find the SDK error code / message pattern)
  - Liveness probe (Step 2) flags an agent stalled past N minutes — surface to user, who confirms pause
  - Network-error retry exhausted at the SDK layer
  - Disk-space low (sub-1GB available)
  - User Ctrl+C in the terminal (graceful SIGINT handler)

- **Pause action** (what the orchestrator does on pause-trigger):
  1. Stop dispatching new agents (drain the in-flight ones if possible — wait up to T minutes)
  2. Write a `paused-state.json` to `<project>/.claude/state/<run-id>/paused-state.json` capturing:
     - Master commit SHA at pause time
     - List of features completed (merged to master)
     - List of in-flight features + their worktree paths + last-known agent + last-progress timestamp
     - Pause reason + timestamp
     - Auth provider state (so we can detect on resume if it changed)
  3. Emit a clear human-readable message: `"Build paused. Reason: <X>. Resume with /resume-build <project>."`
  4. Exit cleanly (status code 0)

- **Resume action**:
  1. Read `paused-state.json` — abort if missing
  2. Reconcile master commit SHA with disk state (warn if drifted)
  3. For each in-flight feature: inspect worktree, decide whether to (a) continue from where the agent left off, (b) reset + retry, or (c) emergency-abort
  4. Re-dispatch the next agent in each in-flight feature's `agent_sequence[]`
  5. Continue normal orchestrator flow

- **State file lifecycle**: `paused-state.json` deleted on successful resume; preserved if resume fails so user can inspect.

### Step 4 — Survey other "should auto-pause" instances (5 min)

Enumerate triggers beyond the user-initiated case + the Claude Max limit:

- Subscription limit detected in SDK error message
- Rate-limit hit (HTTP 429)
- Network down for > N minutes (per liveness probe)
- Auth token expired (need refresh)
- Low disk space (< 1 GB free) — agents writing files would fail anyway
- High orchestrator-side error rate (e.g. 3 features in a row hitting unhandled errors → pause for human triage)
- Manual SIGINT (Ctrl+C in terminal — SIGINT handler triggers graceful pause vs. uncaught crash)
- Specific orchestrator-state assertions (e.g. master-commit-SHA changes unexpectedly mid-run = corruption signal → pause)
- Detected loop in agent retries (loop-detection hook fires → pause for human review)

### Step 5 — Recommend (10 min)

Pick:
- ONE liveness-probe mechanism for v1 (deterministic + cheap)
- ONE state-file format for `paused-state.json`
- ONE skill-pair design for `/pause-build` + `/resume-build`
- ONE concrete list of pause triggers for v1 (probably: user, Claude Max limit, SIGINT)

Then sketch a follow-up `feat-024-orchestrator-pause-resume` plan (don't implement — just outline).

## Findings

### F1 — `runLlmAgent` is structurally blind to stalls

`orchestrator/src/invoke-agent.ts::runLlmAgent` (lines 892–1022) is a single
`for await (const msg of q)` loop with one terminating condition: an SDK
message with `type === "result"`. There is no:

- `AbortController` constructed or wired into `Options` (the SDK accepts
  one — see F2),
- `setTimeout` / `Promise.race` wrapping the iterator,
- Per-message wall-clock check (could detect "no message in N min"),
- Worktree-mtime probe,
- Heartbeat poll of any kind.

If the SDK's WebSocket / IPC pipe goes silent for 70 minutes, this loop
silently waits 70 minutes. The only escape is a thrown error from the
iterator itself, which the kanban-10 stall did not produce. The
`tasks/bkak61sd3.output` file having only 5 lines after 70 minutes
confirms `for await` was simply parked on a pending promise — not
mid-message-handling.

`buildAgentOptions` (lines 1067–1114) does NOT pass `abortController`,
`includePartialMessages: true`, or any timeout/budget signal beyond
`maxBudgetUsd` (which only fires AFTER the SDK itself decides to check —
useless for hangs). The `cli.ts` file has zero `process.on('SIGINT', …)`
handlers — Ctrl+C in a stuck Mode B run uncleanly kills the process and
strands worktrees, exactly matching the recovery dance we did manually.

### F2 — The SDK has rich liveness primitives we're not using

From `node_modules/.../@anthropic-ai/claude-agent-sdk/sdk.d.ts`:

- **`Options.abortController?: AbortController`** (line 1094) — "When
  aborted, the query will stop and clean up resources." Drop-in cancel.
- **`Options.includePartialMessages?: boolean`** (line 1316) — emits
  `SDKPartialAssistantMessage` events during streaming. A heartbeat-by-
  proxy: if no partial message in N seconds while a turn is in flight,
  the SDK pipe is hung, not the model.
- **`SDKKeepAliveMessage = { type: 'keep_alive' }`** (line 2750) — the
  SDK already emits these to maintain the WebSocket. We can timestamp
  them as the cheapest possible liveness ping with zero false positives.
- **`SDKToolProgressMessage`** with `elapsed_time_seconds` (line 3266) —
  emitted while a long-running tool (Bash, MCP) is executing; gives
  per-tool stall visibility.
- **`SDKAPIRetryMessage`** with `attempt`, `max_retries`, `retry_delay_ms`
  (line 2174) — surfaces when the SDK is silently retrying upstream
  errors. We could log these instead of mistaking them for stalls.
- **`SDKRateLimitEvent`** with `rate_limit_info: { status, resetsAt,
  rateLimitType: 'five_hour' | 'seven_day' | … }` (line 2910) — the
  Claude Max 5-hour limit emits this BEFORE rejection, with a structured
  `resetsAt` epoch. Foundation for an automated `/pause-build` trigger.
- **`Query.interrupt()`** (line 1882) — async cancel that's cleaner than
  AbortController (drains in-flight tools); only available in streaming
  input mode.
- **`SDKResultError.subtype = 'error_max_budget_usd' | 'error_max_turns'
  | …`** + **`TerminalReason = 'blocking_limit' | 'rapid_refill_breaker'
  | …`** (line 5005) — typed reasons we can pattern-match for pause vs.
  fail-fast routing.
- **`Options.loadTimeoutMs`** (line 1301, default 60_000) — only covers
  the *spawn* window. Doesn't help post-spawn.

There is NO documented `query()`-level wall-clock timeout. We have to
build it ourselves with `abortController` + `setTimeout`.

### F3 — Existing checkpoint state is too thin for resume

`orchestrator/src/state-persistence.ts::PipelineState` writes only
`{ retryCounters, budget }` to
`<projectRoot>/.claude/state/<run-id>/counters.json`. The kanban-10
artefact at `projects/kanban-webapp-10/.claude/state/.../counters.json`
confirms this — no feature-graph progress, no in-flight worktree map,
no last-message timestamps. Real example contents:
`{ "retryCounters": { "layer5": {}, "task-retry": {}, … },
"budget": { "cumulativeUsd": 2.76 } }` — useful for retry/budget but
silent on which features merged.

`runFeatureGraph` (feature-graph.ts:722–845) builds its `completed` /
`failed` / `inFlight` sets in-memory and never serializes them. On
`--resume-feature-graph`, `cli-runner.ts:178–217` reloads tasks.yaml
from scratch and walks the entire DAG again. The "resume" is really
"restart, and hope git-state heuristics tell you which features
already merged" — which failed for kanban-10 (orchestrator wanted to
re-dispatch all 5 features even though 4 had merged).

This is the single biggest gap: pause/resume cannot be additive on top
of `counters.json` because the feature-graph progress was never
captured anywhere. It needs a NEW `feature-graph-progress.json`
sibling in the same `.claude/state/<run-id>/` directory.

### F4 — Liveness-probe option survey

| # | Option | Catches | False positive | Effort | Verdict |
|---|---|---|---|---|---|
| 1 | `Options.abortController` + per-agent wall timeout (e.g. web-frontend-builder = 25 min) | All stalls, hard cap | Slow legit calls | Low (~30 LOC in `runLlmAgent` + `buildAgentOptions`) | **PRIMARY** |
| 2 | Watch `SDKKeepAliveMessage` interval; flag if > 90 s gap | SDK pipe wedged | Almost zero (SDK's own heartbeat) | Low (~10 LOC) | **SECONDARY — combine with #1** |
| 3 | Watch worktree mtime every 60 s; flag if no change for 10 min during build-agent | Builder writing pause | Misses pure-thinking phases (initial planning) | Low | Tertiary; keep as warning, not abort |
| 4 | `includePartialMessages: true` + per-message-gap timeout | SDK silent during turn | None — partial messages stream every few seconds | Medium (must filter all the new events; some perf overhead) | Defer to v2 |
| 5 | Wall-clock budget per agent type (config in `.claude/models.yaml`) | Same as #1 | Same as #1 | Low | Subsumed by #1 |
| 6 | OS process probe (e.g. `/proc/PID/status` Sleeping vs Running) | Process-level wedge | Cross-platform pain (Windows) | High | Reject |
| 7 | Hybrid (#1 + #2 + #3 surface-warning) | Most cases | Low | Medium | **RECOMMENDED bundle** |
| 8 (new) | Surface `SDKAPIRetryMessage` to operator log when `attempt > 1` | Distinguishes "SDK is retrying upstream" from "process hung" | None | Trivial (~5 LOC) | Add as observability win |
| 9 (new) | Subscribe to `SDKRateLimitEvent` and route `status: "allowed_warning"` to a soft-pause prompt; `status: "rejected"` to hard pause until `resetsAt` | Claude Max limits BEFORE the failure | None — typed event | Low | **DEDICATED PAUSE TRIGGER** |

### F5 — `/pause-build` + `/resume-build` design validation

**Pause file location** — additive: write a NEW
`<projectRoot>/.claude/state/<run-id>/feature-graph-progress.json` next
to `counters.json`. Do NOT bloat `counters.json` (it's currently a
clean retry/budget ledger and tested as such; mixing concerns invites
schema regressions). Also write
`<projectRoot>/.claude/state/<run-id>/paused.json` (sentinel) only when
a pause is in effect; absence = running.

**In-flight feature recovery decision tree on resume**:

1. For each entry in `feature-graph-progress.json.inFlight[]`, inspect
   `<projectRoot>/.claude/worktrees/<feature>/`:
   - If worktree dir missing → emergency-abort path (stale lockfile cleanup)
   - If worktree exists but branch matches `master` HEAD on its tip →
     close-feature path (it actually completed; the orchestrator just
     didn't know)
   - If worktree dirty (`git status --porcelain` non-empty) → reset
     hard to its branch tip + re-dispatch from the LAST agent listed
     in `inFlight[].lastAgent`
   - If clean and branch ahead of master → re-dispatch from
     `inFlight[].nextAgent` (the agent_sequence successor)
   - If clean and branch == master HEAD → close-feature
2. Cross-reference master-commit-SHA at pause time with current master;
   on drift, surface a warning + force `--continue` flag from operator.
3. The auth provider key in `paused.json` lets us detect mid-run auth
   changes (user switched from claude-max-subscription to
   anthropic-api-key); on mismatch, hard-fail with explicit message.

**Trigger entry point integration**:

| Trigger | Detection site | Auto vs. ask |
|---|---|---|
| User `/pause-build <project>` | New skill writes a pause-request sentinel; `runFeature`'s outer loop polls between agents | Auto (immediate) |
| SIGINT (Ctrl+C) | New `process.on("SIGINT")` in `cli.ts` | Auto (immediate, drains in-flight up to 60 s) |
| Claude Max 5-hour limit | `runLlmAgent`'s message loop watches for `SDKRateLimitEvent` with `status: 'rejected'` or `'allowed_warning'` + `rateLimitType: 'five_hour'` | Auto + log `resetsAt` epoch |
| Per-agent wall-timeout fired | `AbortController.abort()` in `runLlmAgent`; classify as stall | Auto |
| Disk < 1 GB free | New periodic check in `runFeatureGraph` outer loop | Auto |
| 3 consecutive feature failures | Count in `runFeatureGraph` | Ask (warning) |

### F6 — Other pause-trigger triage

| # | Trigger | Detect HOW | Auto / Ask | Effort | v1? |
|---|---|---|---|---|---|
| 1 | Subscription limit (`SDKRateLimitEvent`) | SDK message in loop | Auto | Low | **YES** |
| 2 | HTTP 429 rate limit | `SDKAssistantMessageError = 'rate_limit'` | Auto | Low | YES (subset of #1) |
| 3 | Network down > 2 min | Heartbeat gap from `SDKKeepAliveMessage` | Auto | Low | **YES** |
| 4 | Auth token expired | `SDKAssistantMessageError = 'authentication_failed'` | Auto | Low | **YES** |
| 5 | Low disk (< 1 GB) | `statvfs` poll every 60 s | Auto | Medium (Win compat) | Defer |
| 6 | High error rate (3 features fail in a row) | Counter in `runFeatureGraph` | Ask | Low | Defer |
| 7 | SIGINT (Ctrl+C) | `process.on("SIGINT")` | Auto | Low | **YES** |
| 8 | Master SHA drifts mid-run | git rev-parse poll between features | Ask | Low | Defer (rare) |
| 9 | Loop-detection hook fires | `.claude/hooks/detect-loop.mjs` exit code | Ask | Medium | Defer |
| 10 | User-invoked `/pause-build` | Sentinel-file polling between agents | Auto | Low | **YES** |
| 11 | Per-agent wall-timeout | `AbortController` from F4-#1 | Auto | Low | **YES** |

**v1 trigger set: #1, #4, #7, #10, #11.** Network gap (#3) and disk
(#5) are next-priority but defer to keep v1 surface area tight.

## Recommendation

Ship **`feat-024-orchestrator-pause-resume`** with the scope below.
Confidence is high enough on primary mechanism (SDK exposes
`abortController` + `SDKRateLimitEvent` natively; checkpoint format is
additive on existing `.claude/state/<run-id>/`); no further
investigation needed before implementation.

### Primary liveness mechanism — F4 hybrid (#1 + #2 + #8/#9 observability)

Per-agent `AbortController` with wall-clock timeout (configurable per
agent in `.claude/models.yaml`; defaults: builders 25 min, tester 20
min, reviewer 10 min, git-agent never), supplemented by a
`SDKKeepAliveMessage` gap watcher (90 s threshold → log warning; 5 min →
abort). On abort: classify the stall as `error_stall_timeout`, treat
the feature as failed (per existing retry ladder), but ALSO write a
breadcrumb to a new `<run-id>/stall-log.json` so we can tune thresholds
empirically.

**Why this beats the others vs. the kanban-10 stall pattern
specifically**: kanban-10's 70-min stall had ZERO output AND ZERO
worktree writes for ~65 of those minutes (the agent wrote 10 files in
the first ~5 min, then quiesced). Worktree-mtime probing alone
(option #3) would have flagged it correctly but ~10 minutes late. Pure
wall-clock timeout (#1) catches it at the 25-min mark deterministically
and cheaply, without per-agent semantics. Adding the
`SDKKeepAliveMessage` watcher (#2) cuts detection to ~90 s for the
common case (SDK pipe wedged) at zero false-positive cost — the SDK
emits these for its own connection health and we just timestamp them.
Option #4 (`includePartialMessages`) was tempting but adds significant
event volume and parser surface for marginal additional coverage.

### `paused-state.json` schema sketch

Two files in `<projectRoot>/.claude/state/<run-id>/`:

**`feature-graph-progress.json`** — written incrementally during normal
runs (after each feature merges or enters in-flight); always present
once a Mode B run starts:

```jsonc
{
  "version": "1.0",
  "pipelineRunId": "f7c852fb-…",
  "lastUpdatedAt": "2026-04-27T11:42:03.123Z",
  "masterCommitSha": "f135b02…",                  // master HEAD when run started
  "completed": ["feat-shell", "feat-board"],     // merged to master
  "failed": [],                                   // hit retry cap
  "aborted": [],                                  // dependency-failed cascade
  "inFlight": [                                   // alive worktrees at snapshot
    {
      "featureId": "feat-filters",
      "worktree": ".claude/worktrees/feat-filters",
      "branch": "feat/filters",
      "lastAgent": "web-frontend-builder",        // who was dispatched
      "nextAgent": "tester",                       // who's next in agent_sequence
      "lastProgressAt": "2026-04-27T10:55:01.000Z", // last SDK message ts
      "dispatchedAt": "2026-04-27T10:50:00.000Z"
    }
  ]
}
```

**`paused.json`** — sentinel file present ONLY when paused; absence =
running:

```jsonc
{
  "version": "1.0",
  "pausedAt": "2026-04-27T11:42:05.000Z",
  "reason": "claude-max-five-hour-limit", // |"user-request"|"sigint"|"stall-timeout"|"auth-failed"
  "reasonDetail": "SDKRateLimitEvent rateLimitType=five_hour resetsAt=…",
  "resetsAt": "2026-04-27T16:30:00.000Z",  // optional — for rate-limit pauses
  "authProvider": "claude-max-subscription", // detect mid-pause provider switch
  "drainedInFlight": true                   // false if pause was hard (SIGINT 2x)
}
```

### v1 trigger list

User `/pause-build`, SIGINT, Claude Max subscription limit
(`SDKRateLimitEvent`), auth-failed (`SDKAssistantMessageError`), and
per-agent wall-timeout (default 25 min for builders). Defer
network-gap, disk-space, error-rate, and loop-detection triggers to v2.

### `/pause-build` + `/resume-build` skill behavior

- **`/pause-build <project> [--hard]`** — writes
  `projects/<project>/.claude/state/<run-id>/paused.json` (resolves
  `<run-id>` from the most-recent counters.json). With `--hard`, also
  sends SIGINT to any orchestrator process listed in a new
  `<run-id>/orchestrator.pid` file. Without `--hard`, the running
  orchestrator polls the sentinel between agent invocations and drains
  the current dispatch up to 60 s before writing
  `feature-graph-progress.json` and exiting cleanly. Exit 0 on success,
  1 if no run-id found, 2 if already paused.

- **`/resume-build <project>`** — checks `paused.json` exists; if not,
  errors. Reads `feature-graph-progress.json`, runs the F5 in-flight
  recovery decision tree, deletes `paused.json`, and dispatches
  `pnpm --filter orchestrator run mode-b --resume-feature-graph
  --pipeline-run-id <id>` (extending the existing flag). Exit 0 on
  success, 1 on missing pause file, 2 on resume-recovery failure
  (worktree state ambiguous → operator must decide).

### `feat-024-orchestrator-pause-resume` mini-spec

1. **Phase A — checkpoint plumbing.** Extend
   `state-persistence.ts` with a separate `feature-graph-progress.json`
   reader/writer (do NOT modify `counters.json` schema). Wire
   `runFeatureGraph` to update it on every feature
   start / merge / abort / status change. Cost: medium; touches one
   file plus tests.
2. **Phase B — liveness probe.** Add `abortController` to
   `buildAgentOptions`; add a `setTimeout` + `SDKKeepAliveMessage` gap
   watcher in `runLlmAgent`'s for-await loop; route abort →
   `error_stall_timeout` failure path. Per-agent timeouts read from
   `.claude/models.yaml` (extend `ModelConfig` schema with
   `stallTimeoutMs`). Cost: medium; ~80 LOC + tests + a stub-SDK
   harness for the timeout-fires path.
3. **Phase C — pause triggers.** Add `process.on('SIGINT')` to
   `cli.ts`, sentinel-file polling between agents in
   `runFeatureGraph`, and `SDKRateLimitEvent` /
   `SDKAssistantMessageError = 'authentication_failed'` handlers in
   `runLlmAgent`. All paths funnel through a single `pauseRun(reason,
   detail)` helper that writes `paused.json` and drains. Cost: medium.
4. **Phase D — `/pause-build` + `/resume-build` skills.** Author both
   skills following `delete-project`'s preview-by-default pattern;
   resume implements the F5 in-flight recovery tree. Cost: low.
5. **Phase E — empirical tuning.** Use `stall-log.json` from the next
   ~10 Mode B runs to calibrate per-agent timeouts. Treat initial
   defaults (25/20/10 min) as load-bearing-but-revisable.

**Out of scope (defer to feat-025+):** disk-space monitoring, error-
rate triggers, loop-detection integration,
`includePartialMessages`-based per-turn timeout, OS process probes,
multi-orchestrator-run coordination (one project, one in-flight Mode B
at a time for v1).

**Open questions for follow-up investigation if Phase B turns out
harder than expected:**

- Does `Query.interrupt()` (streaming-input only) give a cleaner cancel
  than `AbortController` for our use case? We don't currently use
  streaming input, so adoption would touch the prompt construction in
  `buildAgentPrompt`.
- Is there a way to surface `SDKToolProgressMessage.elapsed_time_seconds`
  to the operator's terminal for in-flight visibility WITHOUT bloating
  the orchestrator stdout (which is parsed by the harness)? Possibly a
  separate `<run-id>/agent-progress.ndjson` log.
- Empirically, do builder agents ever go > 25 min on legitimate work?
  If yes (tester runs with large suites might), we need either a
  longer default or a per-feature override in `tasks.yaml`.

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->
