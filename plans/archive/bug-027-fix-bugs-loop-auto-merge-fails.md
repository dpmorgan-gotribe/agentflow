---
id: bug-027-fix-bugs-loop-auto-merge-fails
type: bug
status: archived
author-agent: claude-opus-4-7
created: 2026-04-29
updated: 2026-04-29
completed-at: 2026-04-29
parent-plan: null
supersedes: null
superseded-by: null
branch: bug/fix-bugs-loop-auto-merge-fails
affected-files:
  - orchestrator/src/fix-bugs-loop.ts
feature-area: orchestration
priority: P1
attempt-count: 1
max-attempts: 5
---

# bug-027 — fix-bugs-loop auto-merge silently fails when fixup worktree owns the branch

## Symptom

After a successful bug-fix loop iteration on
repo-health-dashboard-01:

```
Bug-fix loop:
  iteration 1/1; resolved: 3; failed: 0; remaining: 0; status: clean
```

But master HEAD didn't advance. The 3 fix commits remained on the
`fix/bugs-yaml-iter` branch + the fixup worktree directory remained
intact:

```
master HEAD:    e30f519 merge feat/feat-error-states
fix/bugs-yaml-iter: ce53027 fix(nav)
                    4432d2f test(report-route)
                    fa659d8 test(home-url-parser)
```

Operator had to manually run
`git merge --no-ff fix/bugs-yaml-iter` to apply the fixes.

## Root Cause

`orchestrator/src/fix-bugs-loop.ts::closeFixupWorktree` ran the
operations in this order:

```ts
if (args.mergeFirst) {
  try {
    execSync(`git merge --no-ff ${branch} ...`, { cwd: projectRoot });
  } catch {
    // Conflict or no commits — non-fatal. Warning surfaced upstream.
  }
}
execSync(`git worktree remove --force ${worktreePath}`, ...);
```

Two-part bug:

1. **Wrong order**. When `merge` runs from `projectRoot`, the
   target branch (`fix/bugs-yaml-iter`) is still checked out in
   the fixup worktree. Git refuses to merge a branch that's
   checked out in another worktree. The merge fails immediately.
2. **Silent swallow**. The merge error was caught by an empty
   `catch {}` with the comment "warning surfaced upstream" — but
   no warning was actually surfaced. Operators only discovered
   the failure when checking master HEAD post-run.

## Fix shipped

`orchestrator/src/fix-bugs-loop.ts` lines 167-200:

1. **Reorder**: remove the worktree FIRST (which releases the
   branch), THEN attempt merge.
2. **Surface warning**: replace the silent `catch {}` with a
   `process.stderr.write` that explicitly tells the operator the
   merge failed + what to run manually:

   ```
   [fix-bugs-loop] WARNING: auto-merge of fix/bugs-yaml-iter failed;
   fixes remain on the branch. Run `git merge --no-ff fix/bugs-yaml-iter`
   manually. Detail: <git error message>
   ```

3. **Keep branch on merge failure**: if the merge fails, the
   branch is preserved so the operator can fix the conflict and
   re-merge. (Branch is only auto-deleted on successful merge.)

## Validation

- ✅ Typecheck clean post-edit
- Pending: next bug-fix loop run will validate auto-merge works
  end-to-end (no immediate test target — would need a fresh
  smoke project's verify+fix cycle)

## Closing

Already archived as outcome:success — the fix shipped inline
because (a) the orchestrator was idle (run completed), (b) the
fix is small + isolated to `closeFixupWorktree`, (c) operator
explicitly requested the patch as part of the active session.
