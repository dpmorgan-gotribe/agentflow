---
id: bug-054-fix-bugs-loop-merge-cascade-runs-in-shared-projectroot-and-fails-on-dirty-tree
type: bug
status: draft
author-agent: claude-opus-4-7
created: 2026-05-05
updated: 2026-05-05
parent-plan: investigate-017-token-usage-reduction-for-bug-fix-process
supersedes: null
superseded-by: null
branch: bug/fix-bugs-loop-merge-cascade-dirty-tree
affected-files:
  - orchestrator/src/fix-bugs-loop.ts
  - orchestrator/tests/fix-bugs-loop.test.ts
feature-area: orchestrator/fix-bugs-loop
priority: P1
attempt-count: 0
max-attempts: 3
---

# bug-054: fix-bugs-loop's merge cascade runs in shared projectRoot working tree → fails on dirty state from sibling stages

## Description

`fix-bugs-loop.ts:closePerBugWorktree` (lines 436-504) performs the per-bug → fixup-branch merge cascade by running `git checkout <fixup-branch>` + `git merge --no-ff <bug-branch>` IN `projectRoot`. The comment at line 442-451 acknowledges this is "pragmatic v1" with a known fragility: it assumes projectRoot's working tree is clean.

That assumption breaks in long-running fix-bugs sessions because **sibling stages write to projectRoot between merge attempts**:

- `/build-to-spec-verify` re-runs after each fix-bugs iteration, writing failure artifacts to `docs/build-to-spec/failures/*.{html,png}` directly in projectRoot.
- The synthesizer (`scripts/synthesize-flow-e2e.mjs`) rewrites `apps/web/e2e/synthesized/flow-*.spec.ts` against the latest manifest in projectRoot.
- Tester edge-case test files appear in projectRoot when tests run for parity-check (`apps/web/app/**/*.edge-cases.test.tsx`).

Empirical evidence — finance-track-01 run `2276b8a1-...` (2026-05-05):

- Bug `bug-parity-account-create-modal-shell-stripping` failed after 3 attempts. `errorLog[1]`:

  ```
  [per-bug-merge-cascade-failed] merge fix/bug-parity-account-create-modal-shell-stripping
  into fix/bugs-yaml-iter failed: ... error: Your local changes to the following
  files would be overwritten by merge: apps/web/src/components/accounts/account-archive-dialog.tsx.
  Please commit your changes or stash them before you merge.
  ```

- `git status` in projectRoot at investigation time: **36 uncommitted modifications** including the exact file from the errorLog. Other modified files: `apps/web/app/{accounts,reports,settings}/page.tsx`, `apps/web/e2e/synthesized/flow-{1,2,4,5,6,7,8,9}.spec.ts`, `docs/build-to-spec/failures/*.{html,png}`, edge-case test files.

The merge that DOES succeed (early in the loop, before sibling stages have polluted projectRoot) leaves merge artifacts behind. Each iteration adds more dirt. Eventually a merge collides with that dirt and fails — even though the per-bug branch's edits would have merged cleanly into a clean fixup-branch.

This is a **state-management bug, not a real merge conflict**. The bug-branch + fixup-branch are compatible; only the polluted working tree blocks the merge.

## Likely cause

`closePerBugWorktree` chose projectRoot as the merge cwd for v1 simplicity (per the in-code comment). The dedicated fixup-worktree at `ctx.fixupWorktreePath` (`.claude/worktrees/fix-bugs-yaml-iter/`) is the correct merge venue — it's isolated from sibling stages writing to projectRoot.

The fixup-worktree IS opened earlier in the loop (line 639+ creates it). It's just not USED for merges; the merge cascade bypasses it.

## Fix approach

### Phase A — move merge cascade into the fixup-worktree

Change `closePerBugWorktree` to take `fixupWorktreePath` as input + run all git ops there:

```ts
function closePerBugWorktree(args: {
  projectRoot: string;
  fixupWorktreePath: string; // NEW
  worktreePath: string; // per-bug worktree (unchanged)
  branch: string; // per-bug branch
  fixupBranch: string;
}): { ok: true } | { ok: false; reason: string } {
  // The fixup-worktree is ALREADY checked out on the fixup branch (set up
  // at fix-bugs-loop bootstrap). No `git checkout` needed.
  try {
    execSync(
      `git merge --no-ff ${shellQuote(args.branch)} -m "merge ${args.branch} into ${args.fixupBranch} (fix-bugs-loop parallel)"`,
      { cwd: args.fixupWorktreePath, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    try {
      execSync(`git merge --abort`, {
        cwd: args.fixupWorktreePath,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      /* best-effort */
    }
    return {
      ok: false,
      reason: `merge ${args.branch} into ${args.fixupBranch} (in fixup worktree) failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  // Tear down per-bug worktree + branch from projectRoot (worktree refs
  // live in projectRoot's .git regardless of which worktree the merge ran in).
  try {
    execSync(`git worktree remove --force ${shellQuote(args.worktreePath)}`, {
      cwd: args.projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    execSync(`git branch -D ${shellQuote(args.branch)}`, {
      cwd: args.projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    /* cleanup non-fatal */
  }
  return { ok: true };
}
```

Update the call-site at line 1088 to pass `fixupWorktreePath: ctx.fixupWorktreePath`.

### Phase B — final fixup-branch → master merge in projectRoot still needs cleanup

`closeFixupWorktree` (line 511+) still runs the FINAL `fix/bugs-yaml-iter → master` merge in projectRoot. It removes the fixup worktree first (line 525 — bug-027 fix), so projectRoot's working tree CAN be on master at merge time. Risk: if projectRoot isn't on master, the final merge can hit the same dirty-tree class.

Pre-flight: before final merge, `git checkout master` + `git reset --hard origin/master` (or `git reset --hard HEAD` if no remote) to ensure clean state. Or simpler: ensure projectRoot stays on master throughout the loop (the per-bug merge cascade no longer needs to checkout fixup-branch in projectRoot under Phase A's fix).

### Phase C — operator-recovery for the in-flight finance-track-01 run

The current run (`2276b8a1-...`) has accumulated dirt in projectRoot. To unblock subsequent merges WITHOUT killing the orchestrator:

1. Pause: `/pause-build finance-track-01 --yes`
2. In projectRoot: `git stash push --include-untracked -m "fix-bugs-loop dirty tree recovery (bug-054)"`
3. Verify clean: `git status` (should be empty)
4. Resume: `/resume-build finance-track-01`

The stashed changes are recoverable via `git stash list` if any are load-bearing. (Spot-check shows mostly verifier failure artifacts + synthesized specs — both regeneratable; no manual edits at risk.)

### Phase D — regression test

`orchestrator/tests/fix-bugs-loop.test.ts` new test:

- Set up: per-bug worktree on `fix/bug-X` with one commit; fixup-worktree on `fix/bugs-yaml-iter` (clean); projectRoot on `master` with **uncommitted modifications** to a file the per-bug branch ALSO modified (the regression scenario).
- Action: invoke `closePerBugWorktree` with the new `fixupWorktreePath` arg.
- Assert: merge succeeds (because it ran in the clean fixup-worktree, not the dirty projectRoot); per-bug worktree torn down; projectRoot's uncommitted state preserved.

## Validation

- [ ] Unit test: dirty-projectRoot scenario merges cleanly when cascade runs in fixup-worktree.
- [ ] Unit test: existing happy-path tests still pass (merge result should be unchanged when projectRoot IS clean).
- [ ] Empirical: re-run finance-track-01 fix-bugs phase post-fix. Bug `bug-parity-account-create-modal-shell-stripping` should re-attempt + merge successfully.
- [ ] No regression: closeFixupWorktree's final master merge still works (Phase B addressed).

## Cross-references

- **Empirical observation source**: finance-track-01 run `2276b8a1-1e71-4ec4-ad4c-e0f63f1024b1` — failed bug `bug-parity-account-create-modal-shell-stripping` errorLog[1]
- **Related architecture**:
  - `feat-046-fix-bugs-loop-per-bug-parallelism` Phase A (the per-bug worktree pattern this builds on)
  - `bug-027` (the prior fix to closeFixupWorktree where worktree-remove-before-merge was needed)
  - `bug-034 Phase A` (the additive-concat merge resolver — orthogonal; both are needed)
- **Surface**:
  - `orchestrator/src/fix-bugs-loop.ts:closePerBugWorktree` (lines 436-504) — primary edit
  - `orchestrator/src/fix-bugs-loop.ts:closeFixupWorktree` (lines 511+) — Phase B cleanup
- **Sister cost-reduction plans (this bug doesn't block them but its fix unblocks finance-track-01's residual run)**:
  - feat-051..055, bug-053 — the cost-reduction stack docs/fix-bugs-cost-and-speed-priority-plan.md describes
