---
id: feat-030-quota-observability
type: feature
status: archived
author-agent: claude-opus-4-7
created: 2026-04-28
updated: 2026-04-29
completed-at: 2026-04-29
parent-plan: investigate-010-rate-limit-observability-and-reduction
supersedes: null
superseded-by: null
branch: feat/quota-observability
affected-files:
  - .claude/skills/quota-status/SKILL.md
  - orchestrator/src/invoke-agent.ts
  - orchestrator/src/state-persistence.ts
  - orchestrator/src/cli-runner.ts
  - orchestrator/src/cli.ts
feature-area: orchestration
priority: P1
attempt-count: 0
max-attempts: 5
---

# feat-030 — Quota observability: `/quota-status` skill + rate-limit-events ledger + warning-level pause-hook gate

## Problem Statement

The orchestrator hits Claude Max's `SDKRateLimitEvent` (rateLimitType=
five_hour) with zero advance warning to the operator, while the
claude.ai dashboard reports a completely different bucket. The SDK
already emits structured `SDKRateLimitInfo` with 8 fields (utilization,
status='allowed_warning'|'allowed'|'rejected', surpassedThreshold,
overageStatus, isUsingOverage, overageResetsAt, …) — `runLlmAgent`
reads only 2 of them and persists none. Per investigate-010 §F1-F8.

Operator pain pattern (repo-health-dashboard-01, 2026-04-28): 4
consecutive Mode B re-launches blocked at the same `resetsAt` epoch
with no operator-facing way to:

1. See bucket fullness BEFORE dispatching a Mode B run.
2. Distinguish "just got an `'allowed_warning'` at 75% fill — 15 min
   left" from "rejected, must wait for reset".
3. Know whether the £41.10 Max overage credit is auto-routable on
   rejection (`overageStatus: 'allowed'` vs. `'rejected'`).
4. Tell which bucket actually filled first — `five_hour` vs.
   `seven_day_sonnet` (Mode B is Sonnet-dominated; ~28 Sonnet
   dispatches/run).

This feature closes those gaps by reading what the SDK already emits.

Cross-references: investigate-010 (parent), feat-024 (the existing
pause/resume mechanism this extends), feat-017 (auth provider config).

## Approach

### Phase A — `/quota-status` skill (operator-facing pre-flight)

1. Author `.claude/skills/quota-status/SKILL.md` following the
   `pause-build` / `resume-build` skill style: declarative steps,
   structured JSON output for orchestrator pre-flight + plain-text for
   operator.
2. Implement the probe in `scripts/probe-quota.mjs` (factory-level
   utility — orchestrator-independent so it can run from any project
   shell):
   - Reads `~/.claude/models.yaml` + project's `.claude/models.yaml`
     for active provider via the same `readModelConfig()` merge
     orchestrator uses.
   - Calls the SDK with a 1-token prompt (`"hi"`,
     `max_turns: 1`, `model: claude-haiku-4-5`).
   - Captures every `rate_limit_event` from the response stream by
     listening on the for-await message iterator.
   - Pretty-prints all 5 rateLimitType variants (`five_hour`,
     `seven_day`, `seven_day_opus`, `seven_day_sonnet`, `overage`)
     with `utilization × 100%`, `status`, `resetsAt` (formatted),
     `isUsingOverage`, `overageStatus`.
3. JSON-mode output (`--json` flag) returns the same payload for
   orchestrator pre-flight integration.
4. Manual integration into `/start-build`: skill reads
   `/quota-status --json`, warns if any bucket utilization > 0.85 OR
   any status is `'rejected'`, refuses to dispatch unless operator
   passes `--force`.

### Phase B — Persistent rate-limit-events ledger

1. Add `<run-id>/rate-limit-events.ndjson` writer in
   `orchestrator/src/state-persistence.ts`. Each line:
   ```json
   {
     "ts": "2026-04-28T22:01:08Z",
     "agent": "backend-builder",
     "featureId": "feat-x",
     "rateLimitType": "five_hour",
     "status": "allowed_warning",
     "utilization": 0.78,
     "surpassedThreshold": 0.75,
     "resetsAt": 1777425600,
     "isUsingOverage": false
   }
   ```
2. Hook `runLlmAgent`'s for-await loop (`invoke-agent.ts:1188`): every
   `rate_limit_event` writes a line, regardless of status. Closes the
   F7 visibility gap (we have no historical record of warning events).
3. Append-only, no rotation in v1 (one Mode B run = one file = bounded).
4. Tests: integration test that mocks 3 events at 0.50/0.78/0.95
   utilization, verifies 3 ndjson lines written + parseable.

### Phase C — Warning-level gate in pause hook

1. Update `orchestrator/src/invoke-agent.ts:1199` from:
   ```ts
   if ((rateLimitType === "five_hour" || rateLimitType === "seven_day") &&
       cfg.onRateLimitPause) { … }
   ```
   to:
   ```ts
   const isHardLimit = [
     "five_hour",
     "seven_day",
     "seven_day_opus",
     "seven_day_sonnet",
   ].includes(rateLimitType);
   if (isHardLimit && status === "allowed_warning") {
     console.warn(`[runLlmAgent] rate-limit warning: ${rateLimitType} at
       ${Math.round((utilization ?? 0) * 100)}% — pausing soon`);
     // breadcrumb only; do NOT pause
   } else if (isHardLimit && status === "rejected" && cfg.onRateLimitPause) {
     await cfg.onRateLimitPause({
       rateLimitType,
       resetsAt,
       utilization,
       overageStatus,
       isUsingOverage,
     });
   }
   ```
2. Preserve bug-022 PauseSignal re-throw on rejection path (existing
   try/catch).
3. Bonus: when rejection fires AND `overageStatus === "allowed"` AND
   `isUsingOverage === false`, emit a clearer pause message: `"Base
bucket rejected but overage tier is available — your next call will
auto-route to £-balance billing if you have remaining credit."` —
   helps operators decide between waiting (free) and proceeding
   (charged against overage).

### Phase D — Per-model cost breakdown in counters.json

1. Extend `BudgetState` in
   `orchestrator/src/state-persistence.ts` with:
   ```ts
   modelBreakdown?: Record<string, {
     costUSD: number;
     inputTokens: number;
     outputTokens: number;
     cacheReadInputTokens: number;
     cacheCreationInputTokens: number;
   }>
   ```
2. After every `runLlmAgent` returns a `SDKResultMessage`, accumulate
   `result.modelUsage` into `state.budget.modelBreakdown` (keyed by
   model id like `claude-sonnet-4-6`).
3. Migration: write `modelBreakdown: {}` if missing on read; readers
   tolerate absence.
4. Lightly format counters.json on archive: emit a `byModelSummary`
   block with `% of run` per model — enables eyeballing "Sonnet ate
   86% of this run" without jq gymnastics.

## Rejected Alternatives

- **Build a separate quota daemon that polls every N minutes** —
  Rejected because the SDK only reports rate-limit info in response to
  actual calls; a polling daemon would have to make ghost calls every
  N min, burning bucket itself. The 1-token probe is on-demand and
  cheap.
- **Skip Phase D (per-model breakdown)** — Rejected because it's the
  single most-actionable forecasting input. Without it, operators can't
  estimate "Mode B run = ~28 Sonnet dispatches × $X each = $Y bucket
  consumption". Two extra fields in the JSON; no perf cost.
- **Move pause-trigger gate to a separate file** — Rejected because
  the warning-vs-rejection distinction is intrinsic to the `runLlmAgent`
  message loop; extracting it would create cross-file coupling for no
  win. Phase C is ~30 LOC in place.
- **Implement the gate logic generically (any rateLimitType pauses)** —
  Rejected because `'overage'` is a different beast (it's the £-balance
  tier, NOT a hard limit), and `'allowed'` events are informational
  only. Whitelist the 4 hard-limit types explicitly.

## Expected Outcomes

- [ ] `/quota-status` skill exists, runnable as `/quota-status` (plain
      text) and `/quota-status --json` (structured)
- [ ] Probe shows all 5 rateLimitType buckets with %-fill on a paused
      Max account (validate against repo-health-dashboard-01 right now
      while bucket is at 100%)
- [ ] `<run-id>/rate-limit-events.ndjson` written for every
      `rate_limit_event` during a Mode B run; line count > 0 by run end
- [ ] `'allowed_warning'` events log a `[runLlmAgent] rate-limit
warning: …` line; do NOT pause
- [ ] `'rejected'` events still fire `pauseRun()` cleanly (regression
      test for bug-022 PauseSignal re-throw)
- [ ] `counters.json.budget.modelBreakdown[<model>]` populated after
      first agent dispatch; sums to ≤ `cumulativeUsd` ± rounding
- [ ] No regressions in 555 orchestrator + 344 contracts test suites

## Validation Criteria

1. **Probe correctness** — run `node scripts/probe-quota.mjs` against
   the live paused state of repo-health-dashboard-01. Expected: at
   least one bucket with `status: 'rejected'` (the five_hour we keep
   hitting), `utilization` ≥ 0.95.
2. **Skill structured output** — `/quota-status --json` emits
   parseable JSON conforming to a new
   `packages/orchestrator-contracts/src/QuotaStatus.ts` Zod schema.
3. **Ledger write integration test** — mock 3 `rate_limit_event`
   messages in a `runLlmAgent` test fixture; assert 3 ndjson lines.
4. **Phase C gate test** — fixture emits warning then rejection;
   assert pause hook fires once (rejection only), warning logs but
   does not pause.
5. **Phase D fidelity test** — fixture returns
   `result.modelUsage: { 'claude-sonnet-4-6': { costUSD: 0.42, …}}`;
   assert `state.budget.modelBreakdown` accumulates.
6. **Live integration**: after this ships, the next Mode B run on
   repo-health-dashboard-01 (post-reset) writes events to
   `rate-limit-events.ndjson` AND surfaces a warning line ~15-30 min
   before the next rejection — measurable via the new ledger.
7. **Coverage**: ≥ 80% line coverage on touched files per
   `.claude/rules/testing-policy.md`.

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->

---

# COMPLETION RECORD (appended at archive time)

completed: 2026-04-29
outcome: success
actual-files-changed:

- .claude/skills/quota-status/SKILL.md (created)
- orchestrator/scripts/probe-quota.mjs (created)
- orchestrator/package.json (modified — probe-quota script entry)
- packages/orchestrator-contracts/src/quota-status.ts (created)
- packages/orchestrator-contracts/src/index.ts (modified — export)
- orchestrator/src/invoke-agent.ts (modified — Phase B+C+D)
- orchestrator/src/budget-tracker.ts (modified — Phase D)
- orchestrator/src/state-persistence.ts (modified — Phase D)
- orchestrator/tests/budget-tracker.test.ts (modified — +6 Phase D tests)
- orchestrator/tests/invoke-agent.test.ts (modified — +5 Phase B+C+D tests, bug-022 status fix)
  commits:
- hash: c4e6c0f
  message: "plans: archive investigate-010, queue feat-030 + feat-031"
- hash: 8b8351d
  message: "feat-030 Phase A: /quota-status skill + probe + QuotaStatusReport contract"
- hash: 1c05176
  message: "feat-030 Phase B+C+D: rate-limit ledger + warning gate + per-model breakdown"
  attempts: 1
  duration-minutes: 90
  test-results:
  unit: 567/567 passed (orchestrator)
  integration: n/a (factory-internal feature)
  lessons:
- "SDK prompt-cache primitives + rate-limit metadata are first-class typed surface — read sdk.d.ts FIRST when integrating Anthropic SDK features. Halved investigate-010 + feat-030 implementation time."
- "The five_hour bucket is a recoverable rolling window, not an anchored full-refill. After 23:07Z rejection, by 23:51Z all 3 model classes (Haiku, Sonnet, Opus) reported status='allowed' — the resetsAt epoch represents full-refill, not allow-traffic-again. Operators can usually retry within 30-60 min of a rejection without waiting for the full reset."
- "Probe must be model-class-aware: SDK only emits rate_limit_event for buckets the probed model exercises. Haiku probe shows five_hour only; Sonnet probe surfaces seven_day_sonnet; Opus surfaces seven_day_opus. --all flag (~$0.018) is the right pre-flight default for Mode B."
- "Phase B (ndjson ledger) was the highest-leverage piece of feat-030 — within the first 30s of the resume launch, rate-limit-events.ndjson captured the live SDK event we'd been blind to before. Cheap (~10 LOC) + permanent (closes the F7 visibility gap forever)."
- "Phase C gate-split removed a subtle bug: pre-feat-030 the orchestrator paused on ANY rate_limit_event with rateLimitType=five_hour|seven_day, regardless of status. Empirically the SDK only emitted these on rejections so it didn't manifest, but the gate's spec was sloppy. New gate is whitelist-by-status."
- "TypeScript strict-null with noUncheckedIndexedAccess catches `array[0].x` patterns vitest doesn't enforce at runtime. Always re-run typecheck after adding tests, not just `pnpm test`."
  recommendation-implemented-by: feat-030 (this plan)

---
