---
id: bug-082-orchestrator-trusts-unverified-fix-completion
type: bug
status: draft
author-agent: human
created: 2026-05-11
updated: 2026-05-11
parent-plan: investigate-026-timeout-no-evidence-bug-fixer-stalls
supersedes: null
superseded-by: null
branch: fix/orchestrator-trusts-unverified-fix-completion
affected-files:
  - orchestrator/src/fix-bugs-loop.ts
  - orchestrator/tests/fix-bugs-loop.test.ts
feature-area: orchestrator/fix-loop
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "orchestrator marks bug status=completed when agent self-reports taskOutcomes:completed, without verifying any commit was made"
---

# bug-082: orchestrator trusts agent self-reported fix completion without verifying any diff was produced

## Bug Description

`orchestrator/src/fix-bugs-loop.ts:dispatchAgentsForBug` returns `{ success: true }` based solely on the agent's self-reported `taskOutcomes[id] === "completed"`. No check that:

- Any commit was made in the per-bug worktree (`git log <dispatch-start>..HEAD` is empty)
- Any source file was modified (`git diff <dispatch-start>..HEAD --name-only` is empty)
- The verifier no longer surfaces this bug (end-of-iteration verify catches this — but the bug is already marked completed by then, and the dispatch cost is sunk)

Empirical evidence: reading-log-02 /fix-bugs run 2026-05-11 (paused at 2.5hr / 7-of-21 bugs marked completed). `git for-each-ref --sort=-committerdate refs/heads/` shows ZERO commits across all branches in this project today — every branch's most-recent commit is from 2026-05-08 (the prior /fix-bugs run). 7 bugs marked `status: completed, resolvedInIteration: 1` despite zero code changes.

This breaks the fix-loop's basic accounting. "X of Y bugs fixed" stats are unreliable. The 95% production-quality target is unreachable while the loop trusts unverified completion.

## Reproduction Steps

1. Trigger `/fix-bugs <any-project>` with bugs that the bug-fixer cannot meaningfully fix (e.g., `timeout-no-evidence` flow failures where the test fails at `page.goto`).
2. Watch the bug-fixer agent dispatch finish without producing a commit.
3. Observe `docs/bugs.yaml`: the bug's `status` flips to `completed`, `resolvedInIteration` is set.
4. Run `git log --since=<dispatch-start>` on the per-bug worktree branch — it's empty.
5. End-of-iteration verify re-files the same bug as a NEW entry (because the source is unchanged).

## Root Cause Analysis

`orchestrator/src/fix-bugs-loop.ts:1310-1316`:

```ts
const taskOutcome = result.taskStatus[syntheticTask.id];
if (taskOutcome !== "completed") {
  errorLog.push(...);
  return { success: false, costUsd, errorLog };
}
// ...no other verification...
return { success: true, costUsd, errorLog };
```

The agent's `taskStatus: completed` is the SOLE evidence the orchestrator requires. Two failure modes this enables:

1. **Honest "nothing to fix" agents** — bug-fixer correctly determines the bug isn't fixable from the current envelope (e.g., the bug is environmental), reports completed, but the orchestrator can't distinguish this from a real fix. The bug stays unfixed.
2. **Stall-escape agents** — under wall-clock pressure (the 15min stall-abort cap), an agent may return `completed` rather than `failed` to avoid the retry-loop. This pattern was suspected on reading-log-02 flow-1/4/6 — completed in att:1 with no commits.

End-of-iteration `runBuildToSpecVerify` re-runs at line 1982 (`fix-bugs-loop.ts`) — and IF the bug re-appears, the loop would re-file it. But:

- The dispatch cost is already sunk (~$2-5 per bug)
- The bugs.yaml intermediate state is misleading (operator sees "completed" stats that are false)
- The flapping detector should catch repeated reappearance, but at higher iteration cost than necessary
- The loop's exit condition could be miscomputed if the verifier itself is flaky on the bug class

## Fix Approach

**Phase A — minimal verification gate (~2hr):**

In `dispatchAgentsForBug` (line ~1254-1337), capture the worktree's HEAD ref BEFORE invoking the agent. After the agent returns `taskOutcomes: completed`, verify:

```ts
const headBefore = readGitHead(worktreeCwd); // capture at dispatch start
// ... agent runs ...
const headAfter = readGitHead(worktreeCwd);
const commits = gitLog(worktreeCwd, `${headBefore}..${headAfter}`);
if (commits.length === 0) {
  errorLog.push(
    `[${agent}] reported taskOutcomes:completed but produced no commits in worktree — treating as silent-failure`,
  );
  return { success: false, costUsd, errorLog };
}
// Also check that the diff touches at least one non-bugs.yaml / non-plan file:
const changedSourceFiles = gitDiffNames(worktreeCwd, headBefore).filter(
  (f) => !f.startsWith("docs/bugs.yaml") && !f.startsWith("plans/"),
);
if (changedSourceFiles.length === 0) {
  errorLog.push(
    `[${agent}] commits don't touch any source files — likely doc-only or empty change`,
  );
  return { success: false, costUsd, errorLog };
}
```

This forces the agent to produce ACTUAL changes before being marked successful. Agents that legitimately can't fix the bug should return `taskOutcomes: failed` with a diagnostic, which the orchestrator already handles correctly.

**Phase B — tests (~30 min):**

- Unit test: stub `invokeAgent` to return `taskStatus: completed` + don't make any changes → `dispatch.success` must be `false`.
- Unit test: stub agent to make a commit touching only `docs/bugs.yaml` → still `success: false` (no source change).
- Unit test: stub agent to commit `apps/web/foo.tsx` → `success: true`.

**Phase C — documentation (~15 min):**

- Update bug-fixer's system prompt at `.claude/agents/bug-fixer.md` to explicitly note: "Returning `taskOutcomes: completed` requires you to have made an actual commit. If you cannot identify a fix, return `failed` with a diagnostic — that's the honest signal."
- Same update to `.claude/agents/systemic-fixer.md`.

## Rejected Fixes

- **Trust the end-of-iteration verifier to catch false completions** — already happens but at higher cost (the dispatch already spent ~$2-5; bugs.yaml intermediate state is misleading; flapping detector cycles eat iterations).
- **Add a re-verify call after every dispatch** — too expensive. Verifier takes ~30-90s per call, multiplied by 20+ bugs per iteration. Phase A's commit-check is ~0ms.
- **Block agents from returning `taskOutcomes: completed` without a commit at the SDK level** — would require a system-prompt-only fix that agents can ignore. The orchestrator-side guard is the truth surface.

## Validation Criteria

- [ ] `dispatchAgentsForBug` reads `git rev-parse HEAD` before + after invokeAgent
- [ ] When agent returns `taskOutcomes: completed` with `headBefore === headAfter`, dispatch returns `success: false` with errorLog naming "no commits produced"
- [ ] When agent's commits only touch `docs/bugs.yaml` / `plans/`, dispatch returns `success: false`
- [ ] When agent makes a real source-file commit, dispatch returns `success: true`
- [ ] 4 new tests cover all 4 cases
- [ ] Empirical: re-run /fix-bugs reading-log-02 after this fix lands; the 7 false-positive completions from 2026-05-11 should now correctly classify as `failed` with diagnostics

## Cross-references

- **investigate-026** Finding 3 surfaced this empirically.
- Related: feat-066 v2 epic — the 95% production-quality target depends on this fix being in place.
- Related: bug-073 Phase B convergence detector (`transitionFailedDispatch`) — handles failed dispatches but only catches the "no diff" case if `dispatch.success: false` first. Phase A here is the upstream signal.
- Related: investigate-023 (tester anti-pattern audit) — same principle, different agent. Tester gets a post-dispatch diff audit at line 1322; bug-fixer should have the same shape.

## Attempt Log

<!-- Populated by executing agents. -->
