---
id: bug-010-graceful-skip-unknown-agent
type: bug
status: completed
approved-at: 2026-04-26
approved-by: human
author-agent: claude-opus-4-7
created: 2026-04-26
updated: 2026-04-26
completed-at: 2026-04-27
parent-plan: bug-009-checkout-feature-snapshot
supersedes: null
superseded-by: null
branch: fix/graceful-skip-unknown-agent
affected-files:
  - orchestrator/src/feature-graph.ts
  - orchestrator/src/invoke-agent.ts
  - orchestrator/src/model-config.ts
  - orchestrator/tests/feature-graph.test.ts
  - orchestrator/tests/invoke-agent.test.ts
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "Error: No model resolved for agent 'security'. Set ~/.claude/models.yaml agents.security.tier (with a matching defaults entry) or a direct model override, or ANTHROPIC_MODEL env var."
reproduction-steps: |
  1. Apply bug-002 through bug-009 fixes
  2. /start-build kanban-webapp-04 --resume-feature-graph --max-concurrent=3 --auto-merge-after-reviewer
  3. feat-bootstrap completes successfully (merges to master)
  4. Wave 2 starts; orchestrator dispatches feat-card-detail (which has agent_sequence: [web-frontend-builder, security, tester, reviewer])
  5. runLlmAgent calls readModelConfig('security', projectRoot) → throws "No model resolved for agent 'security'"
  6. Exception propagates up through runFeature → runFeatureGraph → CLI → process exits with stack trace
  7. Entire Mode B run dies; 8 other in-flight or pending features get no completion or cleanup
stack-trace: |
  at readModelConfig (orchestrator/src/model-config.ts:174:11)
  at runLlmAgent (orchestrator/src/invoke-agent.ts:849:23)
  at Object.invokeAgent (orchestrator/src/invoke-agent.ts:114:12)
  at runFeature (orchestrator/src/feature-graph.ts:299:30)
  at async runFeatureGraph (orchestrator/src/feature-graph.ts:729:21)
  at async runCli (orchestrator/src/cli-runner.ts:200:20)
---

# bug-010 — Orchestrator throws unhandled exception when dispatching unknown agent (e.g., `security`)

## Bug Description

**Expected:** when an `agent_sequence[]` entry references an agent that the factory hasn't shipped (no model config entry AND/OR no `.claude/agents/<name>.md` definition), the orchestrator should warn + skip that agent gracefully and continue dispatching the remaining agents in the sequence. The feature can still complete (potentially partially), and other in-flight or pending features in the DAG are unaffected.

**Actual:** `runLlmAgent` calls `readModelConfig(agentName, ...)` which throws an `Error("No model resolved for agent '<name>'")`. The exception propagates synchronously up through `runFeature` → `runFeatureGraph` → CLI without any catch handler, killing the entire orchestrator process. **One feature using an unshipped agent kills the whole Mode B run** — including N-1 sibling features that were doing fine.

This surfaced during the kanban-webapp-04 validation run on 2026-04-26 (run ID `by14mxe2u`). bug-009 worked perfectly: feat-bootstrap merged cleanly to master (first true autonomous Mode B feature merge — MVP exit threshold met). Then wave 2 started, the orchestrator picked up `feat-card-detail` (which has `agent_sequence: [web-frontend-builder, security, tester, reviewer]`), tried to dispatch `security`, and the entire process died with an unhandled exception.

### Why PM puts `security` in agent_sequence even though no agent ships

PM's skill (`.claude/skills/pm/SKILL.md:156`) explicitly lists `security` as a known agent role:

> Non-frontend tasks (`backend-builder` / `tester` / `reviewer` / **security** / `devops`) MUST have `screens: []`.

PM treats `security` as first-class — it's the canonical role for code-review of security-sensitive paths (XSS sanitization, JSON injection, localStorage tampering, auth flows, secrets). For kanban-webapp PM dispatched it on:

- `feat-card-detail` (markdown card editor with DOMPurify XSS prevention)
- `feat-settings-data` (JSON import/export + localStorage clear)

Both are reasonable security-sensitive surfaces. The intent is correct; the factory just hasn't shipped a security agent definition yet (no `.claude/agents/security.md`, no model config entry).

## Reproduction Steps

1. Apply bug-002 (`ff58d27`) → bug-009 (`954b394`) fixes
2. Use any project where `docs/tasks.yaml` references an agent not in the factory's shipped `.claude/agents/` (e.g., `security`, `devops`)
3. Run `/start-build <project> --resume-feature-graph --max-concurrent=N --auto-merge-after-reviewer`
4. Wait until orchestrator dispatches the unknown-agent feature
5. Observe: process exits with `Error: No model resolved for agent '<name>'` stack trace; entire Mode B run dies

## Error Output

From kanban-webapp-04 run 2026-04-26:

```
[runCheckoutFeature] feature feat-bootstrap: project root has dirty/untracked state — auto-committing snapshot before worktree creation.
... (feat-bootstrap completes + merges successfully) ...
C:\Development\ps\claude\claude_\agentflow_phase2\orchestrator\src\model-config.ts:174
    throw new Error(
          ^

Error: No model resolved for agent 'security'. Set ~/.claude/models.yaml agents.security.tier (with a matching defaults entry) or a direct model override, or ANTHROPIC_MODEL env var.
    at readModelConfig (orchestrator/src/model-config.ts:174:11)
    at runLlmAgent (orchestrator/src/invoke-agent.ts:849:23)
    at Object.invokeAgent (orchestrator/src/invoke-agent.ts:114:12)
    at runFeature (orchestrator/src/feature-graph.ts:299:30)
    at async runFeatureGraph (orchestrator/src/feature-graph.ts:729:21)
    at async runCli (orchestrator/src/cli-runner.ts:200:20)

ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL ... Exit status 1
```

Master state at the moment of crash (per `git log master --oneline`):

```
087321c  merge feat/feat-bootstrap                                    ← FIRST AUTONOMOUS MERGE!
cdce61e  tester: bootstrap-tests
fc9ce30  web-frontend-builder: scaffold-next-app, state-shell-localstorage
02256b9  factory: project bootstrap snapshot before checkout-feature for feat-bootstrap
b4c586c  init
```

## Root Cause Analysis

### Layer 1 — `readModelConfig` throws on unknown agent

`orchestrator/src/model-config.ts:174`:

```ts
if (!model) {
  throw new Error(
    `No model resolved for agent '${agentName}'. ` +
      `Set ~/.claude/models.yaml agents.${agentName}.tier (with a matching defaults entry) ` +
      `or a direct model override, or ANTHROPIC_MODEL env var.`,
  );
}
```

Throwing is correct for "operator misconfigured the framework's known agents" (e.g., model file missing for `backend-builder`). It's WRONG for "PM emitted agent_sequence with an agent the factory doesn't ship yet" — that's a PM/factory contract mismatch the orchestrator should handle gracefully.

### Layer 2 — `runFeature` doesn't catch the exception

`orchestrator/src/feature-graph.ts:299`:

```ts
const result = await ctx.invokeAgent({
  agent: agentName,
  // ... no try/catch around this dispatch
});
```

The exception from `readModelConfig` propagates out of `invokeAgent` → out of `runFeature` → out of `runFeatureGraph` → out of `runCli` without any catch boundary. **N-1 sibling features that were running concurrently or queued in waves get NO completion signal** — the process just dies.

This violates the orchestrator's "feature-level isolation" promise (per `feature-graph.ts:670-726` which uses `Promise.race` and per-feature failure tracking). One feature's unknown-agent error shouldn't kill the entire run.

### Layer 3 — PM emits agent_sequence with unshipped agent names

PM's skill knows `security` is a logical role. PM doesn't check whether `.claude/agents/security.md` exists at emit time — it just emits the agent_sequence per its design model. This is arguably correct (PM's job is to plan; agent shipping is the factory's concern), but it requires the orchestrator to handle "PM said dispatch security; security doesn't exist" gracefully rather than crashing.

## Fix Approach

Two-layer fix: orchestrator graceful skip + (optional defensive) PM warn.

### Phase 1 — Orchestrator graceful skip (load-bearing)

File: `orchestrator/src/invoke-agent.ts::runLlmAgent`. Wrap the `readModelConfig` call in a try/catch that translates the "no model resolved" exception into a clean per-task "skipped" outcome:

```ts
let modelConfig: ModelConfig;
try {
  modelConfig = readModelConfig(
    agent,
    cfg.projectRoot,
    cfg.modelConfigOverride,
  );
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  // bug-010: unknown/unshipped agent — skip rather than crash. Mark all
  // dispatched tasks as "completed" (so the feature can advance to the
  // next agent in agent_sequence) and surface a warning. Future PM/
  // factory-skill should detect this earlier; the orchestrator's role is
  // to be robust against PM emitting agent_sequence with unshipped agents.
  // eslint-disable-next-line no-console
  console.warn(
    `[runLlmAgent] agent '${agent}' is not configured (${msg.split("\n")[0]}). Skipping ${args.tasks.length} task(s) and continuing agent_sequence.`,
  );
  const skipped: Record<string, "completed" | "failed"> = {};
  for (const t of args.tasks) skipped[t.id] = "completed";
  return {
    taskStatus: skipped,
    errors: {},
    costUsd: 0,
    skippedReason: `agent '${agent}' not configured: ${msg.split("\n")[0]}`,
  };
}
// ... existing code continues with modelConfig in scope
```

Returning `taskStatus: completed` (rather than failed) for skipped agent's tasks ensures the orchestrator advances to the next agent in agent_sequence rather than triggering retries or marking the feature failed. The warning + new `skippedReason` field surfaces the skip in logs + structured outputs.

The schema for `InvokeAgentResult` may need a new optional `skippedReason?: string` field (in `orchestrator/src/feature-graph.ts` type definition) — additive change, no migration concerns.

### Phase 2 — Tests

File: `orchestrator/tests/invoke-agent.test.ts`. Add tests:

- Unknown agent → returns `taskStatus: { all: completed }`, `skippedReason` populated, `costUsd: 0`, no exception thrown
- Unknown agent in agent_sequence → `runFeature` advances to the next agent (verify dispatch order)
- Existing model-config tests still pass (back-compat preserved)

### Phase 3 — Validation re-run

After Phase 1+2 land:

1. Re-run `/start-build kanban-webapp-04 --resume-feature-graph --max-concurrent=3 --auto-merge-after-reviewer` (orchestrator should pick up where it left off — feat-bootstrap already merged on master)
2. Watch for: orchestrator advances to wave 2; for `feat-card-detail` and `feat-settings-data`, the security dispatch is skipped with a warning; web-frontend-builder + tester + reviewer run normally; features merge to master
3. **Best case: full DAG completes — 10/10 features merged. Full MVP delivery on a single project.**

### Phase 4 (deferred — bug-011 territory) — Ship a real security agent

The skip-and-warn unblocks the run, but security review on actual security-sensitive features (XSS sanitization, JSON injection, etc.) is genuinely useful. A follow-up plan should:

- Author `.claude/agents/security.md` (system prompt: read PR diff, walk OWASP Top 10 for the changed files, surface findings)
- Add `security: { tier: build, effort: medium, budgetUsd: 2 }` to factory `~/.claude/models.yaml`
- Verify on the kanban-webapp DOMPurify + JSON-import features

Defer for now — bug-010 makes the orchestrator robust without requiring a security agent to ship. Adding one is optimization, not unblocking.

## Rejected Fixes

- **Add `security` to factory `~/.claude/models.yaml` (just the model entry)**. Rejected: model entry alone doesn't help — there's no `.claude/agents/security.md` skill prompt. The SDK would dispatch with no system prompt → agent does whatever. Need both, or skip both. bug-010's approach is "skip cleanly until both ship together".

- **Edit kanban-webapp-04's tasks.yaml to remove security from agent_sequence**. Project-specific patch, doesn't help next project that hits this. Bug-010's orchestrator-side fix benefits ALL projects.

- **Have PM omit security from agent_sequence by default**. PM's design is correct — security IS a logical role. Removing it from PM's vocabulary loses signal that those features need security review. Better: orchestrator gracefully degrades + a follow-up ships the security agent.

- **Mark unknown-agent tasks as `failed` instead of `completed`**. Rejected: failing them would trigger task-retry → exhaust → mark feature failed → cascade abort. The agent didn't run because IT DOESN'T EXIST — that's a configuration gap, not a task failure. Marking `completed` lets the orchestrator move on.

- **Throw a typed error subclass that `runFeature` catches and converts to feature-skip**. Considered, rejected for now: more layers, more changes, more test surface. The simple try/catch in runLlmAgent achieves the same outcome with smaller blast radius.

## Validation Criteria

- The original error no longer crashes the orchestrator: dispatching unknown agent returns a clean skipped result + warning instead of throwing.
- All 256 existing orchestrator tests still pass.
- New tests added for skip behavior; pass.
- `pnpm --filter orchestrator typecheck` clean.
- Validation re-run on kanban-webapp-04 progresses past the security-agent feature (likely advancing through wave 2 + wave 3 features).
- **Best case: 10/10 features merged on kanban-webapp-04 = full DAG MVP delivery.**

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->

## References

- `plans/active/bug-009-checkout-feature-snapshot.md` — parent; bug-009's success unblocked Mode B's first autonomous merge, exposing bug-010 as the next-layer issue
- `plans/active/feat-014-mvp-completion-autonomous-e2e.md` — MVP plan; bug-009 + bug-010 together unlock full-DAG MVP delivery
- `plans/active/investigate-004-agent-shipped-vs-task-gap.md` — sibling investigation auditing the broader gap between PM-emitted agent identifiers and shipped agent definitions; informs bug-010's deferred Phase 4 (ship a real security agent) and any peer follow-ups
- `orchestrator/src/model-config.ts:174` — where the throw lives
- `orchestrator/src/invoke-agent.ts::runLlmAgent` (line 849-ish) — where the throw needs to be caught
- `orchestrator/src/feature-graph.ts::runFeature` (line 299) — uncaught propagation site
- `.claude/skills/pm/SKILL.md:156` — PM's contract treating `security` as first-class
- `projects/kanban-webapp-04/docs/tasks.yaml:155-156, 318-319` — security tasks PM emitted
- Validation re-run output: `tasks/by14mxe2u.output` — kanban-webapp-04 run that surfaced bug-010 (and confirmed bug-009 worked: feat-bootstrap merged to master `087321c`)
- Cost trajectory: $6.52 → $1.70 → $1.33 → $2.69 → $8.64 → $1.35 → $4.48 → $2.52 → $5.91 → $6.43 → $5.53 → ? (run 12 cost not surfaced — process crashed before exit summary)
