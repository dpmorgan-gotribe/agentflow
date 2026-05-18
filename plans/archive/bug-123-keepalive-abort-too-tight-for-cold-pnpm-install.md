---
id: bug-123-keepalive-abort-too-tight-for-cold-pnpm-install
type: bug
status: completed
author-agent: human
created: 2026-05-18
updated: 2026-05-18
approved-at: 2026-05-18
completed-at: 2026-05-18
outcome: success
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/keepalive-abort-cold-pnpm-install
affected-files:
  - orchestrator/src/invoke-agent.ts
  - orchestrator/tests/invoke-agent-liveness.test.ts
feature-area: orchestrator/keepalive-abort
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "feat-scaffold backend-builder on gotribe-member-profile hit abortReason: keepalive-gap-308070ms (5min) on attempt 1 + keepalive-gap-320838ms on attempt 2. Wall-time only 8min and 10min — well under any wall-clock cap. Rate-limit allowed (no pressure). The agent went silent for >5min between SDK messages because it was running a long Bash tool call (most likely `pnpm install` on a cold worktree node_modules on Windows, which routinely takes 5-10 min)."
reproduction-steps: |
  1. Project with a non-trivial Node monorepo (apps/web + apps/api + several packages).
  2. /start-build triggers feat-scaffold's backend-builder.
  3. Builder authors apps/api/src/server.ts + runs a Bash tool call that includes `pnpm install` (cold worktree, fresh node_modules).
  4. pnpm install takes >5 min on Windows with cold pnpm store (the symlink-thousands-of-files step is I/O-bound).
  5. During the install, the agent is in a single Bash tool call — no intermediate SDK messages → keepalive gap exceeds 300s threshold → orchestrator aborts the dispatch.
  Empirical: gotribe-member-profile 2026-05-18 — run-id 39bb9199-6a0f-4c38-b588-842da85686af; 2 attempts, both aborted at keepalive-gap > 300s; $0.87 burned.
stack-trace: null
---

# bug-123: Keep-alive abort threshold (300s) too tight for cold-pnpm-install Bash tool calls

## Bug Description

`orchestrator/src/invoke-agent.ts:1342` sets `keepaliveAbortMs ?? 300_000` (5 min) as the default keep-alive abort threshold. When the agent goes silent for >300s between SDK messages, the orchestrator fires `AbortController.abort()` with reason `keepalive-gap-<ms>ms` and the dispatch fails.

**The 300s threshold is structurally too tight for builders whose tool calls include `pnpm install` on a fresh worktree.** Windows pnpm install with a cold store routinely takes 5-10 min (the symlink-thousands-of-files step is I/O-bound — even with a warm pnpm store, the per-package fan-out is slow). During this single Bash tool call, the agent emits no intermediate SDK messages because it's blocked waiting for the child process to exit.

Empirical case (2026-05-18 gotribe-member-profile):

- run-id: `39bb9199-6a0f-4c38-b588-842da85686af`
- task: `api-fastify-bootstrap` (backend-builder, first task of feat-scaffold)
- attempt 1: dispatched 13:28:48, last keepalive 13:31:40 (~3min in), aborted 13:36:48 — `keepalive-gap-308070ms` (5min 8s), wall-time 8min
- attempt 2: dispatched 13:36:48, last keepalive 13:41:27 (~5min in), aborted 13:46:48 — `keepalive-gap-320838ms` (5min 20s), wall-time 10min
- Rate-limit: `status: "allowed"` — NOT under rate-limit pressure
- Cost: $0.87 burned

The agent's reasoning trace (when we eventually capture it post-fix) likely shows a single Bash call that ran `pnpm install` (and possibly subsequent typecheck + tests) sequentially. The orchestrator can't see inside the Bash call; it only sees "no SDK messages for >300s" and aborts.

## Reproduction Steps

1. Any project with a non-trivial Node monorepo (apps/web + apps/api + 5+ packages).
2. `/start-build <project>` triggers Mode B; the first feature's backend-builder dispatch runs in a fresh worktree.
3. Backend-builder authors source + runs `pnpm install` to pull deps for the new code.
4. On Windows with a cold pnpm store, pnpm install takes 5-10 min.
5. The agent's single Bash tool call runs `pnpm install` synchronously — no SDK messages during.
6. At 300s + 30s (next keep-alive check tick), the orchestrator aborts the dispatch.

## Error Output

From gotribe-member-profile stall-log.json:

```json
{
  "featureId": "feat-scaffold",
  "agent": "backend-builder",
  "dispatchedAt": 1779110928437,
  "lastKeepAliveAt": 1779111100440,
  "abortReason": "keepalive-gap-308070ms",
  "wallTimeMs": 480075
}
{
  "featureId": "feat-scaffold",
  "agent": "backend-builder",
  "dispatchedAt": 1779111408517,
  "lastKeepAliveAt": 1779111687793,
  "abortReason": "keepalive-gap-320838ms",
  "wallTimeMs": 600115
}
```

Both attempts: keepalive gap > 300s threshold, wall-time well under any cap.

From orchestrator stdout:

```
[runLlmAgent] backend-builder on feat-scaffold: no SDK message in 91s (warn threshold 90000ms)  (×4)

✗ feat-scaffold — task api-fastify-bootstrap failed after 2 attempts:
                  agent produced no parseable outcome JSON: result.result was empty
                  (no structured_output, no text)
```

The "result.result was empty" framing is downstream of the abort — when the SDK query is force-aborted mid-tool-call, no final output reaches the orchestrator.

## Root Cause Analysis

`orchestrator/src/invoke-agent.ts:1340-1342`:

```ts
const checkIntervalMs = cfg.keepaliveCheckIntervalMs ?? 30_000;
const warnMs = cfg.keepaliveWarnMs ?? 90_000;
const abortMs = cfg.keepaliveAbortMs ?? 300_000; // ← 5 min
```

The 300s default came from `investigate-007 §F4-#2` (per the JSDoc on line 103). That investigation likely calibrated against typical agent reasoning + lightweight tool calls (Read, Grep, brief Bash commands). It did NOT account for:

- `pnpm install` on a cold worktree (5-10 min on Windows; 3-5 min on Linux/Mac)
- `pnpm build` of a Storybook static (3-8 min on a large kit)
- `pnpm test --coverage` of a large suite (2-5 min)
- TypeScript typecheck of a large monorepo (1-3 min)

Any of these inside a single Bash tool call can blow through the 300s threshold without the agent doing anything wrong. The agent isn't stalled; it's just waiting on a slow child process.

The keep-alive abort is the right idea (catch truly hung agents) but the 300s default is calibrated against a different workload class than today's builder dispatches.

## Fix Approach

### Phase A — bump the default keepaliveAbortMs from 300_000 to 600_000 (10 min)

Simplest possible change. Single-line edit at `orchestrator/src/invoke-agent.ts:1342`:

```ts
// Before
const abortMs = cfg.keepaliveAbortMs ?? 300_000;

// After
// bug-123 (2026-05-18): bumped from 300_000 (5min) → 600_000 (10min).
// The 300s threshold was calibrated against agent reasoning + lightweight
// tool calls and didn't account for the long Bash tool calls builders
// routinely make (`pnpm install` on cold worktree, `pnpm build`,
// `pnpm test --coverage`, `tsc --noEmit` on large monorepos). 10min
// still catches truly hung agents; the 5min false-positive class
// surfaced on gotribe-member-profile 2026-05-18 (keepalive-gap-308070ms
// during cold pnpm install). Per-agent + per-project overrides via
// keepaliveAbortMs option remain available; this is just the default.
const abortMs = cfg.keepaliveAbortMs ?? 600_000;
```

The doc comment on line 103 also needs updating:

```ts
// Before:
* Defaults: 90_000 / 300_000 per investigate-007 §F4-#2.
// After:
* Defaults: 90_000 / 600_000 (warnMs / abortMs). Original 300_000
* abortMs (investigate-007 §F4-#2) bumped per bug-123 — too tight
* for cold-pnpm-install Bash tool calls on Windows monorepos.
```

### Phase B — add regression test

`orchestrator/tests/invoke-agent-liveness.test.ts` already has the test infrastructure (`makeScriptedQuery` + `createInvokeAgent`). Add a test asserting that when the test omits `keepaliveAbortMs`, the resolved default is 600_000 (not 300_000):

```ts
it("default keepaliveAbortMs is 600_000 (bug-123) — allows for cold pnpm install", async () => {
  // ... a test that doesn't pass keepaliveAbortMs and asserts the abort
  // doesn't fire at 300s if there's a keepalive at 5min 30s
});
```

Easier alternative: a unit test on the constant itself (just check the default in the source). Skip if the existing infrastructure makes the integration test simple.

### Phase C — empirical re-test on gotribe-member-profile (deferred)

Re-launch gotribe-member-profile from Mode A snapshot. Expect feat-scaffold's backend-builder to complete within the new 10min keep-alive threshold (or fail for a different reason).

## Rejected Fixes

- **Bump to 30 min** — too loose; truly stalled agents (network hang, infinite tool-use loop) wouldn't be caught for 30 min. 10 min is enough for the empirical worst case (cold pnpm install on Windows ~5-8 min) with margin.
- **Make threshold class-discriminated by agent + project (like bug-122)** — over-engineered for an MVP fix. The 10min default is fine for ALL agents (a 10min hang during reviewer / tester / etc. is also reasonable to wait). Class discrimination can come later if 10min proves too loose for some classes.
- **Add intermediate "I'm running pnpm install" SDK messages from inside Bash tool calls** — out of scope; would require Bash tool wrapping at the agent SDK level, which is upstream of the orchestrator.
- **Detect pnpm install in flight + extend threshold dynamically** — too fragile + adds complexity. The static 10min default is simpler.

## Validation Criteria

- [ ] `orchestrator/src/invoke-agent.ts:1342` default `keepaliveAbortMs` changed from `300_000` to `600_000`.
- [ ] JSDoc on line 103 updated to reflect the new default + reference bug-123.
- [ ] Regression test added (or existing test extended) confirming the new default.
- [ ] Full orchestrator test suite passes (no other test should depend on the old 300_000 default).
- [ ] (Deferred — Phase C) gotribe-member-profile re-launch: feat-scaffold's backend-builder completes within the new 10min threshold (or fails for a different reason — that's a different bug).

## Cross-references

- **Empirical case**: gotribe-member-profile Mode B 2026-05-18, run-id `39bb9199-6a0f-4c38-b588-842da85686af`. Cost: $0.87. Both attempts aborted on keepalive-gap > 300s during cold-worktree `pnpm install`.
- **Sibling bug**: bug-122 (Strategy-C web tester wall-clock cap, shipped 2026-05-18 commit `0d2ffb2`). bug-122 addressed the 20-min wall-clock cap; bug-123 addresses the orthogonal 5-min keep-alive abort. Both are timer-related but different timers.
- **Origin**: `feat-024 Phase B` shipped the keep-alive abort mechanism with defaults from `investigate-007 §F4-#2`. Those defaults were calibrated against a different workload class than today's builder dispatches.

## Attempt Log

<!-- populated as the fix is made -->
