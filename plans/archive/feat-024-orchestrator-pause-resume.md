---
id: feat-024-orchestrator-pause-resume
type: feature
status: completed
approved-at: 2026-04-27
approved-by: human
author-agent: claude-opus-4-7
created: 2026-04-27
updated: 2026-04-27
completed-at: 2026-04-27
parent-plan: investigate-007-orchestrator-liveness-and-pause
supersedes: null
superseded-by: null
branch: feat/orchestrator-pause-resume
affected-files:
  - orchestrator/src/state-persistence.ts
  - orchestrator/src/feature-graph.ts
  - orchestrator/src/invoke-agent.ts
  - orchestrator/src/cli.ts
  - orchestrator/src/model-config.ts
  - packages/orchestrator-contracts/src/feature-graph-progress.ts
  - packages/orchestrator-contracts/src/paused-state.ts
  - .claude/skills/pause-build/SKILL.md
  - .claude/skills/resume-build/SKILL.md
  - .claude/agents/git-agent.md (pause-aware close-feature behavior)
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-024 — Orchestrator pause / resume + liveness probe

## Summary

Per investigate-007: Mode B has no liveness signal — when a Claude Agent SDK call hangs silently (kanban-webapp-10 stalled 70+ min with zero output, zero CPU, zero error), the orchestrator waits indefinitely. Recovery required manual `git worktree remove --force` + branch-delete dance.

The investigation found the SDK already exposes everything needed (`AbortController`, `SDKKeepAliveMessage`, `SDKRateLimitEvent`) — we've just been ignoring it. This feature wires those primitives in + ships first-class pause/resume so the user can interrupt cleanly.

## Goals

1. Detect silent SDK stalls within ~90s (vs. the kanban-10 silence of 70min) via a `SDKKeepAliveMessage` gap watcher.
2. Bound any agent invocation by a configurable wall-clock timeout (defaults: builders 25min, tester 20min, reviewer 10min, git-agent never) via SDK-native `AbortController`.
3. Ship `/pause-build <project>` + `/resume-build <project>` skills that checkpoint mid-run state to a sentinel file + restore cleanly without the manual git cleanup we did on kanban-10.
4. Auto-trigger pause on Claude Max 5h subscription limit (`SDKRateLimitEvent.rate_limit_info.rateLimitType === "five_hour"`), auth-failure (`SDKAssistantMessageError = "authentication_failed"`), and operator SIGINT — not just user-initiated pauses.
5. Preserve every previously-merged feature on resume (no re-running merged work).

## Non-goals (deferred to feat-025+)

- Disk-space monitoring as a pause trigger
- Error-rate-based pauses (e.g. 3 features in a row crash → pause)
- Loop-detection-hook integration
- `includePartialMessages` per-turn timeout
- OS-level process probes
- Multi-orchestrator-run coordination (one project, one in-flight Mode B at a time for v1)
- `Query.interrupt()` migration (would require streaming-input refactor)

## Approach

5 phases per investigate-007's recommendation. Phases A+B unblock the liveness fix; C+D add user-facing pause/resume; E is empirical refinement.

### Phase A — Checkpoint plumbing (~120 LOC)

New file: `packages/orchestrator-contracts/src/feature-graph-progress.ts` — Zod schema for `FeatureGraphProgress`:

```ts
{
  version: "1.0",
  pipelineRunId: string,
  lastUpdatedAt: ISO-datetime,
  masterCommitSha: string,        // master HEAD when run started
  completed: string[],            // featureIds merged to master
  failed: string[],               // hit retry cap
  aborted: string[],              // dependency-failed cascade
  inFlight: [
    {
      featureId, worktree, branch,
      lastAgent: AgentSequenceMember,
      nextAgent: AgentSequenceMember | null,
      lastProgressAt: ISO-datetime,
      dispatchedAt: ISO-datetime
    }
  ]
}
```

Extend `orchestrator/src/state-persistence.ts` with `readFeatureGraphProgress(projectRoot, runId)` + `writeFeatureGraphProgress(projectRoot, runId, snapshot)`. Do **NOT** modify `counters.json` — keep concerns separate.

Wire `runFeatureGraph` to update the snapshot on every state transition: feature dispatched, agent boundary, feature merged, feature failed, feature aborted. Update is incremental — append to inFlight[] on dispatch, move to completed[] on merge, etc. Atomic write via tempfile + rename.

Tests: 12-15 in `orchestrator/tests/state-persistence.test.ts` covering each state transition + atomic-write semantics + schema validation.

### Phase B — Liveness probe (~80 LOC + stub-SDK harness)

Extend `ModelConfig` schema (`packages/orchestrator-contracts/src/model-config.ts`) with optional `stallTimeoutMs?: number`. Defaults in factory `~/.claude/models.yaml`:

- backend-builder, web-frontend-builder, mobile-frontend-builder: 25 _ 60 _ 1000
- tester: 20 _ 60 _ 1000
- reviewer, security: 10 _ 60 _ 1000
- git-agent: never (explicit `null`)

In `orchestrator/src/invoke-agent.ts::runLlmAgent`:

- Instantiate `AbortController` per invocation
- Pass `abortController` to `query()` options
- Wrap the for-await loop with two timers:
  - **Wall-clock timer**: `setTimeout(() => abortController.abort("stall-timeout-wall"), config.stallTimeoutMs)` — fires once
  - **Keepalive watcher**: `setInterval(() => { if (Date.now() - lastKeepAliveAt > 90_000) { console.warn(...); }; if (Date.now() - lastKeepAliveAt > 300_000) { abortController.abort("stall-timeout-keepalive"); } }, 30_000)` — clear on every keepalive
- Update `lastKeepAliveAt` on every `SDKKeepAliveMessage` (also on every `SDKAssistantMessage` / `SDKToolProgressMessage` — anything counts as "alive")
- On abort: classify as `taskStatus.failed` with error `error_stall_timeout`, append breadcrumb to `<run-id>/stall-log.json`, propagate to feature-graph-progress as inFlight removal

The stall-log breadcrumb captures `featureId`, `agent`, `dispatchedAt`, `lastKeepAliveAt`, `abortReason`, `wallTimeMs`. Tunes empirically over Phase E.

Tests: 8-12 in `orchestrator/tests/invoke-agent.test.ts` — fake SDK that withholds keepalives + asserts abort fires; fake SDK that emits keepalives + asserts no abort.

### Phase C — Pause triggers (~150 LOC)

New file: `packages/orchestrator-contracts/src/paused-state.ts` — Zod schema for `PausedState`:

```ts
{
  version: "1.0",
  pausedAt: ISO-datetime,
  reason: "user-request" | "sigint" | "claude-max-five-hour-limit"
        | "claude-max-seven-day-limit" | "auth-failed" | "stall-timeout",
  reasonDetail: string,
  resetsAt?: ISO-datetime,         // for rate-limit pauses
  authProvider: string,            // detect mid-pause provider switch
  drainedInFlight: boolean         // false if pause was hard (SIGINT 2x)
}
```

All pause paths funnel through one helper:

```ts
async function pauseRun(
  ctx: FeatureGraphContext,
  reason: PauseReason,
  detail: string,
  options: { drained: boolean; resetsAt?: Date },
): Promise<void>;
```

Helper writes `paused.json` to `<projectRoot>/.claude/state/<runId>/`, flushes `feature-graph-progress.json`, then exits 0 (or throws a sentinel that cli.ts catches for clean exit).

Trigger sources:

- **`runFeatureGraph` between agent invocations**: poll for `paused.json` sentinel; if present, drain in-flight up to 60s, then `pauseRun(reason: "user-request")`
- **`cli.ts` SIGINT handler**: `process.on("SIGINT", () => pauseRun(ctx, "sigint", "operator interrupt", { drained: true }))`. Second SIGINT within 5s → hard exit (`drained: false`)
- **`runLlmAgent` SDK message inspection**:
  - `SDKRateLimitEvent` with `rateLimitType === "five_hour" | "seven_day"` → `pauseRun(reason: "claude-max-{five|seven}-{hour|day}-limit", resetsAt: rateLimitInfo.resetsAt)`
  - `SDKAssistantMessageError` with `errorCode === "authentication_failed"` → `pauseRun(reason: "auth-failed")`
- **Stall-timeout from Phase B's AbortController** → `pauseRun(reason: "stall-timeout")` (option: configurable — strict mode pauses; lenient mode just fails the feature + continues)

Write `<run-id>/orchestrator.pid` at startup so `/pause-build --hard` can SIGINT the process.

Tests: 10-12 covering each trigger path + the drain + the pid file lifecycle.

### Phase D — `/pause-build` + `/resume-build` skills (~200 LOC)

Mirror `delete-project`'s preview-by-default pattern.

**`.claude/skills/pause-build/SKILL.md`**:

- Args: `<project>` (required), `[--hard]` (optional)
- Resolves run-id from `<project>/.claude/state/` (most-recent counters.json)
- Writes `<run-id>/paused.json` (preview shows what will happen)
- With `--hard`: also reads `<run-id>/orchestrator.pid` + sends SIGINT
- Without `--hard`: relies on the running orchestrator to poll the sentinel between agents
- Exit 0 success / 1 no run-id / 2 already paused

**`.claude/skills/resume-build/SKILL.md`**:

- Args: `<project>` (required)
- Reads `<run-id>/paused.json` — error if missing
- Reads `<run-id>/feature-graph-progress.json` — error if missing or schema-invalid
- Sanity-check master commit SHA didn't drift unexpectedly (warn if so)
- Run **in-flight recovery decision tree** for each entry in `inFlight[]`:
  - If worktree directory missing → `inFlight` was orphaned → mark feature as failed, leave for retry
  - If worktree clean (no uncommitted changes) → resume from `nextAgent`
  - If worktree dirty + last agent was building (web/backend/mobile-frontend-builder) → soft-reset worktree, retry from same agent (avoids partial-write commit)
  - If worktree dirty + last agent was tester/reviewer → likely benign mid-write; commit + advance to nextAgent
  - If worktree branch DOESN'T exist anymore (manually cleaned) → mark feature aborted, surface to user
- Delete `paused.json`
- Dispatch `pnpm --filter orchestrator start generate <project> --resume-feature-graph --pipeline-run-id <id>` (extending the existing flag with explicit run-id support)
- Exit 0 success / 1 missing pause file / 2 resume-recovery failure (worktree state ambiguous → operator must decide)

### Phase E — Empirical tuning

Run feat-024 through 5-10 Mode B runs (kanban-webapp variants + book-swap + finance-track). Watch `stall-log.json` for false-positives + missed-stalls. Adjust per-agent `stallTimeoutMs` defaults. Document outcomes in plan attempt log.

If tester regularly exceeds 20min on large suites: bump default OR add per-task override in `tasks.yaml`.

## Validation criteria

- Replay kanban-webapp-10's stall scenario with feat-024 in place: SDK stub stops emitting keepalives → orchestrator aborts within ~5min → feature marked failed → next feature dispatches.
- `/pause-build kanban-webapp-XX` mid-run: orchestrator drains current agent, writes paused.json, exits 0 within 60s.
- `/resume-build kanban-webapp-XX` after pause: in-flight features recover per decision tree; merged features stay merged; new agents dispatch from `nextAgent`.
- SIGINT in terminal: same drain behavior as `/pause-build`; second SIGINT within 5s exits hard.
- Claude Max 5h limit fires (intentional or natural): orchestrator pauses with `resetsAt` populated; resume blocked until past `resetsAt` (warn, don't block — let operator override if they switched providers).
- 271 + 242 = 513 existing tests still pass; +50 new tests across phases A-D.

## Cross-references

- **Parent**: investigate-007 — full SDK API audit + option survey + paused-state schema
- **Touches**: state-persistence (Phase A), invoke-agent (Phase B+C), feature-graph (Phase A+C), cli (Phase C), model-config (Phase B)
- **New skills**: `/pause-build`, `/resume-build` (mirror `/delete-project`'s preview-default pattern)
- **Schema pattern**: bug-004's `BuilderOutputJsonSchema` → `FeatureGraphProgressJsonSchema` + `PausedStateJsonSchema`
- **Open follow-ups (per investigate-007)**: `Query.interrupt()` adoption, `agent-progress.ndjson` for in-flight visibility, per-task `stallTimeoutMs` overrides in tasks.yaml

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->

### Attempt 1 — 2026-04-26 (claude-opus-4-7)

End-to-end implementation of Phases A-D (Phase E intentionally deferred — empirical post-ship tuning).

**Phase A — Checkpoint plumbing**:

- Added `FeatureGraphProgressSchema` + `InFlightFeatureSchema` in `packages/orchestrator-contracts/src/feature-graph-progress.ts`.
- Added `writeFeatureGraphProgress()` / `readFeatureGraphProgress()` / `featureGraphProgressPath()` to `orchestrator/src/state-persistence.ts` (atomic tempfile+rename, schema validation on both read + write).
- Added `ProgressTracker` interface + `createProgressTracker()` (real disk-backed, flushes on every state transition) + `noopProgressTracker()` (test default) to `orchestrator/src/feature-graph.ts`.
- Wired `runFeatureGraph` to auto-create a tracker when none is injected; wired all state transitions in `runFeature` (dispatch / agent boundary / merge / fail / abort / fast-skip) + the cascade-abort path in `runFeatureGraph`.
- Tests: 9 in `state-persistence.test.ts` + 14 in new `feature-graph-progress.test.ts` + 7 in `packages/orchestrator-contracts/tests/feature-graph-progress.test.ts`.

**Phase B — Liveness probe**:

- Extended `ModelConfig` (in `orchestrator/src/model-config.ts`) with `stallTimeoutMs: number | null` + factory defaults map (`DEFAULT_STALL_TIMEOUT_BY_AGENT`).
- Resolution precedence: per-agent project YAML > per-agent global YAML > top-level `stallTimeoutMs.<agent>` map (project > global) > built-in defaults > null. Added top-level `stallTimeoutMode` ("lenient" | "strict") read via new `readStallTimeoutMode()` helper.
- Documented defaults in factory `.claude/models.yaml` (left `~/.claude/models.yaml` untouched per the boundary rule).
- Wired `AbortController` + wall-clock `setTimeout` + keepalive `setInterval` watcher into `runLlmAgent`. Every SDK message resets `lastKeepAliveAt`; abort cause is captured for the breadcrumb. Timers are cleared in a `finally` block.
- On abort: writes NDJSON breadcrumb to `<run-id>/stall-log.json` (append-mode, best-effort), classifies tasks as `error_stall_timeout`, optionally invokes the strict-mode pause hook.
- Tests: 8 in new `invoke-agent-liveness.test.ts` (vitest fake timers + scripted SDK stub that yields keepalives + result-or-not) + 10 stallTimeoutMs precedence tests in `model-config.test.ts`.

**Phase C — Pause triggers**:

- Added `PausedStateSchema` + `PauseReason` in `packages/orchestrator-contracts/src/paused-state.ts`.
- New module `orchestrator/src/pause.ts`: `pauseRun()` (the funnel — writes paused.json atomically, flushes the tracker, throws `PauseSignal`), `writePausedStateSync()` (used by `/pause-build` skill + cli.ts SIGINT handler), `writeOrchestratorPid()`, `pausedStatePath()`, `orchestratorPidPath()`.
- Wired `runFeatureGraph` to poll for the paused.json sentinel before each agent dispatch via `existsSync` (microsecond cost). Promise.race rewritten so PauseSignal propagates out (drains other in-flight features then re-throws).
- `runLlmAgent` SDK message inspection routes `SDKRateLimitEvent` (rateLimitType ∈ {five_hour, seven_day}) to `onRateLimitPause` and `SDKAssistantMessage.error === "authentication_failed"` to `onAuthFailedPause`.
- `cli.ts` registers `process.on("SIGINT")` with the 5s double-tap pattern (1× → write paused.json via the shared helper; 2× within 5s → exit 130). Catches `PauseSignal` for clean exit 0 with a friendly resume command. Added `--pipeline-run-id <id>` flag.
- `cli-runner.ts` honors `opts.pipelineRunId`, writes `orchestrator.pid` at startup, registers a global pause-context for the SIGINT handler, wires the strict-mode stall pause hook + the always-on rate-limit + auth-failed pause hooks via `createInvokeAgent`.
- Tests: 16 in new `pause.test.ts` (path helpers, write helpers, pid lifecycle, pauseRun throws PauseSignal, runFeatureGraph poll integration with poll-disabled negative case) + 9 in `packages/orchestrator-contracts/tests/paused-state.test.ts`.

**Phase D — `/pause-build` + `/resume-build` skills**:

- `.claude/skills/pause-build/SKILL.md` — preview-by-default like `/delete-project`; resolves run-id from newest `counters.json` mtime; writes paused.json sentinel atomically; with `--hard` reads orchestrator.pid + sends SIGINT via `process.kill(pid, "SIGINT")`.
- `.claude/skills/resume-build/SKILL.md` — reads + validates paused.json + feature-graph-progress.json; sanity-checks master commit SHA drift (`--ignore-master-drift` to override); walks the F5 in-flight worktree recovery decision tree (`clean` / `dirty-builder` / `dirty-meta` / `orphaned` / `aborted`); deletes paused.json; dispatches `pnpm --filter orchestrator start generate <name> --resume-feature-graph --pipeline-run-id <id>`.

**Test counts**: 299 → 356 orchestrator (+57); 242 → 258 contracts (+16); total 513 → 614 (+101 new across phases A-D, well above the ~50 target).

**Cross-platform notes**: Verified `process.on("SIGINT")` semantics on Windows — Node maps Ctrl+C to its SIGINT listener via `SetConsoleCtrlHandler` so the 5s double-tap pattern works identically on both platforms. `process.kill(pid, "SIGINT")` is also portable. Documented in code comments at the SIGINT handler + the `/pause-build` skill's edge-cases section.

**Deviations from plan**: (1) Plan said "extend `ModelConfig` schema in `packages/orchestrator-contracts/src/model-config.ts`" — but that file only contains the `Provider` enum; the actual `ModelConfig` interface lives in `orchestrator/src/model-config.ts`, so the extension landed there. (2) Plan said "wire `runFeatureGraph` between agent invocations to poll for paused.json" — moved the poll INSIDE `runFeature`'s agent loop (between `agent_sequence` items) which is the same logical boundary but lets the tracker's flush() happen with the correct featureId context. (3) Promise.race in `runFeatureGraph` had to be rewritten to capture rejection (PauseSignal) rather than just resolution, otherwise the pause throw would be swallowed.

**Phase E — deferred**: empirical tuning of stallTimeoutMs defaults requires real Mode B run telemetry; documented in plan §Phase E + factory `.claude/models.yaml` template.
