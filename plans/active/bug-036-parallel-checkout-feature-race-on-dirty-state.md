---
id: bug-036-parallel-checkout-feature-race-on-dirty-state
type: bug
status: draft
author-agent: human
created: 2026-05-01
updated: 2026-05-01
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/checkout-feature-serialize-dirty-state
affected-files:
  - orchestrator/src/invoke-agent.ts
  - orchestrator/src/feature-graph.ts
  - orchestrator/tests/invoke-agent.test.ts
feature-area: orchestrator/git-agent
priority: P1
attempt-count: 0
max-attempts: 5
error-message: "Two of three concurrently-dispatched features (feat-csv-import-backend + feat-spa-shell-dashboard) silently failed at checkout-feature with no worktree creation; only feat-reports-aggregation (the lucky winner of the dirty-state auto-commit race) proceeded."
reproduction-steps: "Run /start-build with maxConcurrentFeatures >= 2 on a wave that contains 3+ features whose deps just resolved AND whose project root has any dirty/untracked state at dispatch time. The first feature wins the auto-commit race + opens its worktree; the others fail silently at checkout-feature."
stack-trace: null
---

# bug-036: Concurrent checkout-feature dispatches race on the dirty-state auto-commit; loser features silently fail

## Bug Description

When the orchestrator opens a wave of N features in parallel (`maxConcurrentFeatures >= 2`) and the project root has uncommitted changes at dispatch time, **only one of the parallel features successfully checks out**. The others fail silently — no worktree gets created, no per-feature log lines surface, the features land in `failed[]` with no diagnostic in stdout.

The race surface is `runCheckoutFeature`'s "auto-commit dirty state before worktree creation" step. All N parallel dispatches see the dirty state simultaneously, all N attempt `git add . && git commit -m "factory: project bootstrap snapshot before checkout-feature for feat-X"`. Only one succeeds (gets the lock); the others see the project root either mid-commit or already committed (depending on timing) and their downstream `git worktree add` fails for reasons that don't reach the orchestrator's structured error stream.

Empirical case (2026-05-01 finance-track-01 resume after bug-002 manual merge):

- Wave 4 dispatched 3 features in parallel: `feat-reports-aggregation`, `feat-csv-import-backend`, `feat-spa-shell-dashboard`.
- Project root had 2 uncommitted changes at dispatch (the package.json `pnpm.onlyBuiltDependencies` field I added during bug-002 Phase B verification).
- Orchestrator log lines all 3 emitted `[runCheckoutFeature] feature feat-X: project root has dirty/untracked state — auto-committing snapshot before worktree creation.`
- Only `feat-reports-aggregation` got a worktree (`.claude/worktrees/feat-reports-aggregation`) + branch (`feat/reports-aggregation`).
- `feat-csv-import-backend` and `feat-spa-shell-dashboard` got NO worktree, NO branch, and immediately moved to `failed[]` in `feature-graph-progress.json` within seconds.
- 7 dependent features cascade-aborted (accounts-ui, transactions-ui, csv-import-ui, json-export-ui, reports-ui, runner, acceptance-suite).
- `feat-reports-aggregation` proceeded normally: backend-builder → tester → reviewer (in flight as of this filing).

This is the third orchestrator-state failure mode discovered in the same build session (after bug-034 merge-conflict cascade + bug-035 dispatch-drops-notes). The orchestrator's MVP did not anticipate the concurrency surfaces of `git` operations against the same physical project root.

## Reproduction Steps

1. Bootstrap a project where Mode B has progressed past wave 1 (multiple features completed + merged to master).
2. Edit any file in the project root that's tracked by git AND that the orchestrator's `git worktree` operations touch (e.g. `package.json`, `.gitignore`).
3. Resume `/start-build` (or run from scratch where wave-1 succeeded + wave-2 has ≥2 parallel-eligible features).
4. Observe: the orchestrator emits `[runCheckoutFeature] ... auto-committing snapshot ...` for all parallel features.
5. Inventory `.claude/worktrees/` after dispatch: only ONE feature in the parallel batch has a worktree. The others are missing.
6. `feature-graph-progress.json` shows the missing features as `failed[]` with no `inFlight` entry, no per-feature diagnostic.

Note: this race is timing-dependent. With `maxConcurrentFeatures=1` (sequential dispatch) the bug never surfaces. With high counts (3+) on dirty state, the loss rate approaches 100% for non-winners.

## Error Output

From `tasks/bgskcms4m.output` (the orchestrator's stdout — only 9 lines after a 20-min run):

```
> orchestrator@0.1.0 start C:\...\agentflow_phase2\orchestrator
> tsx src/cli.ts "generate" "finance-track-01" "--resume-feature-graph" "--pipeline-run-id" "2276b8a1-..." "--auto-merge-after-reviewer"

[runCheckoutFeature] feature feat-reports-aggregation: project root has dirty/untracked state — auto-committing snapshot before worktree creation.
[runCheckoutFeature] feature feat-csv-import-backend: project root has dirty/untracked state — auto-committing snapshot before worktree creation.
[runCheckoutFeature] feature feat-spa-shell-dashboard: project root has dirty/untracked state — auto-committing snapshot before worktree creation.
[runLlmAgent] backend-builder on feat-reports-aggregation: no SDK message in 107s (warn threshold 90000ms)
[runLlmAgent] tester on feat-reports-aggregation: no SDK message in 112s (warn threshold 90000ms)
```

Notice: only `feat-reports-aggregation` has subsequent log lines. The 2 race-losers produced ZERO downstream log output despite landing in `failed[]`. The actual git/checkout-feature error was silently swallowed.

State at the same moment, from `feature-graph-progress.json`:

```json
{
  "completed": [...6 features...],
  "failed": ["feat-seed-script", "feat-csv-import-backend", "feat-spa-shell-dashboard"],
  "aborted": [...7 cascade-aborted...],
  "inFlight": [{ "featureId": "feat-reports-aggregation", "lastAgent": "tester", ... }]
}
```

## Root Cause Analysis

### Surface mechanism

`orchestrator/src/invoke-agent.ts` has a `runCheckoutFeature` flow that, when project root has dirty state, runs an inline `git add . && git commit` BEFORE invoking `git worktree add`. This auto-commit is **not serialized** across concurrent feature dispatches — each parallel `runFeature` invocation runs its own checkout-feature, each sees the dirty state independently, each tries to commit.

The race window:

1. T+0ms — feature A's checkout-feature reads `git status --porcelain` → sees dirty state → enters auto-commit branch.
2. T+1ms — feature B's checkout-feature reads `git status --porcelain` → sees dirty state → enters auto-commit branch.
3. T+5ms — feature A: `git add .` + `git commit` succeeds; project root is now clean.
4. T+8ms — feature B: `git add .` succeeds (no-op since A already added) but the subsequent state may be fine; B proceeds.
5. T+10ms — feature A: `git worktree add .claude/worktrees/feat-A feat/A` succeeds.
6. T+12ms — feature B: `git worktree add .claude/worktrees/feat-B feat/B` — fails with some error like `fatal: index file is locked` OR `fatal: branch is checked out at <other-worktree>` OR similar git index/lock contention.
7. B's failure is wrapped by orchestrator + treated as feature-level failure → marked `failed[]` → cascade aborts dependents.

The exact failure timing varies by system; the deterministic outcome is "first dispatch wins, others lose silently".

### Underlying cause

`git` is not reentrant against a single physical project root. Operations that take the index lock (`commit`, `worktree add`, etc.) serialize at the filesystem level, but the orchestrator's TS dispatch invokes them in parallel. The kernel's lock arbitration means non-winners get an error; the orchestrator's error-handling path doesn't surface that error usefully.

### Why bug-009 (pre-worktree snapshot) didn't catch this

bug-009 introduced the auto-commit-before-worktree behavior to fix an unrelated problem (worktree creation failing on dirty state). It assumed a single dispatch at a time. The MVP test coverage for `runCheckoutFeature` does not include parallel-dispatch scenarios.

### Three non-overlapping fixes

**Surface A — serialize the dirty-state auto-commit** (recommended primary fix):
Add a per-project-root mutex in `feature-graph.ts` that serializes the `runCheckoutFeature` call across concurrent feature dispatches. The mutex releases as soon as the worktree is created (each worktree's subsequent operations are independent). This is a ~15-line change.

**Surface B — eliminate the race by committing dirty state ONCE pre-wave** (cleaner long-term):
The orchestrator's main loop, before opening a wave, checks for dirty state in the project root + commits once if present. Per-feature `runCheckoutFeature` then skips the auto-commit branch entirely. Removes the race surface; doesn't require a mutex.

**Surface C — capture + surface the failed checkout-feature error** (defense in depth):
Whatever git error closed-feature swallowed, capture it explicitly (stderr, exit code) + emit it as a log line + attach it to the `failed[]` entry's diagnostic field. Won't fix the bug but makes it observable so the next operator doesn't lose 20 minutes diagnosing.

### How it interacts with bug-034

bug-034 (additive-concat merge resolver) is also an orchestrator concurrency issue, but at the merge-to-main stage rather than the checkout-feature stage. They're independent surfaces:

- bug-034: `git merge` of feature branches that have additive same-region conflicts in central registration files.
- bug-036: `git worktree add` in parallel against the same project root racing on the index lock.

Both should ship together as part of an "orchestrator concurrency hardening" mini-roadmap.

## Fix Approach

### Phase A — serialize dirty-state auto-commit (P1, immediate harm reduction)

1. **Add a project-root mutex in `orchestrator/src/feature-graph.ts`**:

   ```ts
   const projectRootCheckoutMutex = new Map<string, Promise<void>>();

   async function acquireCheckoutLock(
     projectRoot: string,
   ): Promise<() => void> {
     while (projectRootCheckoutMutex.has(projectRoot)) {
       await projectRootCheckoutMutex.get(projectRoot);
     }
     let release: () => void;
     const p = new Promise<void>((resolve) => {
       release = resolve;
     });
     projectRootCheckoutMutex.set(projectRoot, p);
     return () => {
       projectRootCheckoutMutex.delete(projectRoot);
       release!();
     };
   }
   ```

2. **Wrap `runCheckoutFeature` invocation** in `feature-graph.ts`'s wave dispatcher with the lock:
   ```ts
   const release = await acquireCheckoutLock(projectRoot);
   try {
     const checkoutResult = await runCheckoutFeature(...);
   } finally {
     release();
   }
   ```
   Lock spans only the `runCheckoutFeature` call, NOT the entire feature lifecycle (builder/tester/reviewer/close-feature can all run in parallel; only the checkout-feature initiation needs serialization).
3. **Add regression test** in `orchestrator/tests/invoke-agent.test.ts` (or a new `feature-graph.test.ts` describe block):
   - Dispatch 3 mock features in parallel against a dirty project root.
   - Assert all 3 get worktrees (the test is "did the race not happen", not "did the lock work specifically").
   - Negative: dispatch 3 features against a CLEAN project root + assert no extra serialization overhead (dispatches happen in true parallel — no one waits on the mutex).

### Phase B — pre-wave dirty-state commit (P2, structural cleanup)

4. **In `feature-graph.ts`'s wave loop, before opening a wave**:
   ```ts
   await commitDirtyStateIfPresent(
     projectRoot,
     `factory: pre-wave snapshot for wave ${waveNum}`,
   );
   ```
5. **Update `runCheckoutFeature`** to skip the auto-commit branch (assume project root is clean — the orchestrator's pre-wave step handled it).
6. Remove the per-feature mutex from Phase A (no longer needed; eliminate the race surface).
7. Test: dispatch a wave of 3 features against a dirty root; assert exactly ONE auto-commit happens (not 3) + all 3 worktrees succeed.

### Phase C — defense-in-depth diagnostic capture (P2, separate PR)

8. **In `runCheckoutFeature`'s error path**, capture the actual git stderr + exit code + emit as a structured log line:
   ```ts
   if (worktreeAddResult.exitCode !== 0) {
     console.error(
       `[runCheckoutFeature] feature ${featureId}: git worktree add failed.\n` +
         `  exitCode: ${worktreeAddResult.exitCode}\n` +
         `  stderr: ${worktreeAddResult.stderr.trim()}\n` +
         `  stdout: ${worktreeAddResult.stdout.trim()}`,
     );
   }
   ```
9. Attach the same diagnostic to the `failed[]` entry's payload so the operator's `dag-status` skill can surface it.

## Rejected Fixes

- **`maxConcurrentFeatures=1` always** — Rejected: defeats the entire purpose of parallel Mode B. Reduces 60-min builds to 180-min builds. Acceptable as an emergency-recovery escape hatch, NOT as the default fix.
- **Retry the failed checkout-feature** — Rejected: doesn't fix the race; just gives racing features a 2nd chance to lose. Some races are timing-dependent (a feature might lose 3 retries in a row).
- **Lock at the per-feature level (long lock)** — Rejected: would serialize the ENTIRE feature lifecycle (builder + tester + reviewer + close-feature), defeating parallel Mode B. The mutex must scope only to the operations that actually contend.
- **Use `git -c index.skipHash=true` or other index optimizations** — Rejected: doesn't address the lock contention; just changes which operation hits the lock first.

## Validation Criteria

### Phase A

- [ ] `acquireCheckoutLock` exists in `orchestrator/src/feature-graph.ts`.
- [ ] Wave dispatch wraps `runCheckoutFeature` in the lock.
- [ ] Regression test: dispatch 3 mock features in parallel against dirty root → all 3 get worktrees + branches.
- [ ] Regression test: dispatch 3 mock features against clean root → no extra serialization overhead (concurrent execution still happens for downstream agents).
- [ ] Re-run finance-track-01's resume — wave-4 features all check out cleanly without race losses.
- [ ] Documented in `.claude/agents/git-agent.md` § Concurrency model.

### Phase B

- [ ] Pre-wave `commitDirtyStateIfPresent` lives in `feature-graph.ts`.
- [ ] Per-feature `runCheckoutFeature` no longer auto-commits dirty state.
- [ ] Regression test: dirty root + 3-feature wave → exactly 1 auto-commit, 3 worktrees succeed.

### Phase C

- [ ] Failed checkout-feature surfaces stderr + exit code in stdout.
- [ ] Failed checkout-feature payload in `failed[]` includes `diagnostic` field with same content.
- [ ] `dag-status` skill renders the diagnostic for failed features.

## Cross-references

- **Sister bugs (orchestrator concurrency hardening)**:
  - bug-034 (git-agent additive-concat merge resolver gap) — different stage (close-feature merge) but same family of "git operations against single project root in parallel" failure modes.
  - bug-035 (builder dispatch drops task.notes) — already shipped 2026-05-01; different surface (prompt assembly), same MVP-incomplete-context-delivery theme.
- **Empirical case**: 2026-05-01 finance-track-01 resume — wave 4 of 7. Recovery for this specific case sidesteps the bug via `--max-concurrent=1` resume; the underlying fix lives here.
- **Memory entries**: `feedback_orchestrator_pause_dont_kill.md` covers the kill-vs-pause recovery flow. This bug adds a third recovery surface (parallel-checkout race); a future memory entry might capture the operator-side workaround "set --max-concurrent=1 when resuming after dispatched-failures".

## Attempt Log

<!-- populated as fix attempts are made -->
