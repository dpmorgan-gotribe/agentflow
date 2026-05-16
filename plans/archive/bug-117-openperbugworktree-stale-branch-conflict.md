---
id: bug-117-openperbugworktree-stale-branch-conflict
type: bug
status: archived
author-agent: human
created: 2026-05-16
updated: 2026-05-16
approved-at: 2026-05-16
completed-at: 2026-05-16
outcome: success
shipped-scope: "Single patch — pre-delete fix/bug-* before git worktree add -b"
ship-commits: ["4cada06"]
parent-plan: bug-115-worktree-creation-blocked-by-pycache-lock
supersedes: null
superseded-by: null
branch: fix/openperbugworktree-stale-branch-conflict
affected-files:
  - orchestrator/src/fix-bugs-loop.ts
  - orchestrator/tests/fix-bugs-loop.test.ts
feature-area: orchestrator/fix-bugs-loop/per-bug-worktree
priority: P0
attempt-count: 0
max-attempts: 5
error-message: |
  git worktree add ... fix/bug-X ... fix/bugs-yaml-iter
  Preparing worktree (new branch 'fix/bug-X')
  fatal: a branch named 'fix/bug-X' already exists
reproduction-steps: |
  1. Run /fix-bugs against a project. Round 1 dispatches per-bug worktrees;
     SOME teardowns succeed, SOME fail (Windows MAX_PATH, file locks,
     orphan dirs). The fix/bug-* BRANCHES persist regardless.
  2. Round 1 finishes; the bugs.yaml has some bugs in `failed` status.
  3. Operator resets failed → pending in bugs.yaml + re-fires /fix-bugs.
  4. openPerBugWorktree's bug-061 teardown (lines 766-817) ONLY runs when
     the worktree DIR is present (existsSync || isRegisteredGitWorktree).
     For stale-branch-only state (branch exists but no worktree dir),
     teardown is skipped + `git branch -D` never runs.
  5. `git worktree add -b fix/bug-X` fails with "branch already exists".
  6. bug-073 convergence-detector sees 2 identical errors + escalates to
     failed without exhausting maxAttempts.
stack-trace: null
---

# bug-117-openperbugworktree-stale-branch-conflict: `openPerBugWorktree` doesn't pre-delete stale `fix/bug-*` branches from prior /fix-bugs rounds

## Bug Description

`orchestrator/src/fix-bugs-loop.ts openPerBugWorktree` (line 721) creates per-bug worktrees via `git worktree add -b fix/bug-X`. When a prior /fix-bugs round left a `fix/bug-X` branch behind WITHOUT a matching worktree dir, the create-fresh path fails because the branch exists. bug-061's teardown logic (lines 766-817) only fires when the worktree DIR is present; stale-branch-only state slips through.

**Empirical motivator:** gotribe-tribe-directory /fix-bugs round 4 on 2026-05-16. Round 3 left ~24 stale `fix/bug-perceptual-*` branches behind (worktrees were cleaned up by bug-061's teardown but branches remained — git keeps branches independent of worktree presence). Round 4 reset bugs.yaml failed→pending and re-fired; 24+ dispatches failed at `git worktree add -b` because the branch already existed.

This is the **deferred Patch C class** from bug-115's plan. bug-115's plan correctly identified the issue:

> ### Patch C — Branch-already-exists recovery on 2nd attempt
> When the second-attempt error stderr matches `/^fatal: a branch named '.*' already exists/`, detect the stale branch + delete it (`git branch -D fix/bug-X`) + retry the worktree-add.

That Patch C was deferred under the assumption that bug-115's Patch 1 pre-flight check would catch the underlying class. Patch 1 catches the .pyc lock class correctly; this bug catches the *separate* stale-branch class that surfaces when /fix-bugs is re-fired after a reset.

## Root Cause Analysis

Two compounding gaps:

1. **bug-061's teardown is gated on worktree-dir presence.** Looking at fix-bugs-loop.ts lines 766-817:
   ```
   if (existsSync(worktreePath) || isRegisteredGitWorktree(...)) {
     // teardown attempt — git worktree remove or rm-rf
     // then try git branch -D
   }
   ```
   When the worktree dir is GONE (cleaned up by a prior teardown OR the OS reclaimed it) but the branch persists, neither condition is true → teardown skipped → `git branch -D` doesn't run.

2. **No fallback retry path.** `openFixupWorktree` (the SHARED worktree's create path at lines 502-528) has a fallback that catches "already exists" and re-runs `git worktree add` WITHOUT `-b` to re-attach to the existing branch. `openPerBugWorktree` (line 822) has NO such fallback — a single try/catch that returns ok:false immediately.

## Fix Approach

Single patch in `orchestrator/src/fix-bugs-loop.ts`:

Before `git worktree add -b ${branch} ${baseBranch}`, unconditionally attempt `git branch -D ${branch}` and swallow any error (branch may not exist, which is the common case for fresh bugs). The pre-delete is cheap and idempotent.

```ts
// bug-117 — pre-delete stale per-bug branch if it exists. Without this,
// `git worktree add -b fix/bug-X` fails when a prior /fix-bugs run left
// the branch around (typical post-reset-and-resume).
try {
  execSync(`git branch -D ${shellQuote(branch)}`, {
    cwd: args.projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch {
  /* branch did not exist; expected for fresh bugs */
}
```

Insert at line ~821, immediately before the `try { execSync(git worktree add ... -b ...)`.

**Safety:** `-D` is force-delete (vs `-d` which checks merge-status). Per-bug branches are ephemeral by design — the loop's state machine doesn't reach back into a per-bug branch after closePerBugWorktree merges it into fix/bugs-yaml-iter. Any uncommitted work in a stale branch is already unreachable. Worst case: we lose orphaned commits that were never meant to live on long-term.

## Rejected Fixes

- **R1 — Make the bug-061 teardown unconditional (run even when worktree dir is absent).** Rejected: the teardown does more than just `git branch -D` (also rm-rf, git worktree remove). Running those when there's nothing to clean wastes cycles + may emit confusing errors. Targeted pre-delete is simpler.

- **R2 — Add the same fallback openFixupWorktree has (catch "already exists", retry without -b).** Rejected: re-attaching to an existing branch with `git worktree add ... fix/bug-X` (no -b) gives the worktree the stale branch's HEAD, NOT current baseBranch HEAD. For per-bug worktrees we want a FRESH branch from baseBranch — pre-delete-then-create-fresh is the right shape.

- **R3 — Delete all `fix/bug-*` branches at /fix-bugs loop start (mass cleanup).** Rejected: invasive + assumes no other process is using them. Per-call lazy delete is safer.

## Validation Criteria

- [ ] Unit test: openPerBugWorktree returns ok:true when a stale `fix/bug-X` branch exists pre-call + no worktree dir. Branch is re-created from baseBranch HEAD (verify via `git rev-parse fix/bug-X` matching baseBranch HEAD).
- [ ] Unit test: existing happy path (no stale branch) still passes — pre-delete is a silent no-op.
- [ ] Empirical: gotribe-tribe-directory round 4 — after this ships + stale fix/bug-* branches cleaned + bugs.yaml reset, the dispatches should reach the bug-fixer (not die at worktree-add).

## Attempt Log

### Attempt 1 — 2026-05-16 — patch shipped inline before bg-task resume

5-line addition to openPerBugWorktree, just before the existing
`git worktree add -b ...` call. Idempotent: branch may or may not exist;
either way the worktree-add can proceed afterwards.

Empirical validation pending: still need to (a) commit + merge this fix,
(b) clean up the ~24 stale fix/bug-* branches in gotribe-tribe-directory
(or let the new pre-delete handle them naturally), (c) reset failed →
pending again, (d) resume /fix-bugs.

### Lessons

1. **Deferred patches need re-evaluation when sibling fixes ship.** bug-115's Patch C was deferred because Patch 1's pre-flight was assumed to cover the failure class. It covered the .pyc lock class only; the stale-branch class is orthogonal. Lesson: when shipping narrow scopes, document explicitly which sub-classes the narrow ship does + doesn't cover. (bug-115 plan did this clearly — "Patch C: 2nd-attempt branch-already-exists recovery" — but the priority assumption was wrong.)

2. **Per-bug branches need explicit lifecycle.** The /fix-bugs loop creates `fix/bug-*` branches per-dispatch but only sometimes cleans them up. A loop-start "delete all matching" pass would be cleaner long-term, but the per-call pre-delete is sufficient + lower-risk for v1.

3. **The convergence-detector's coarse signature match (bug-073) is correct here.** Two identical "branch already exists" errors → escalation is the right response if no fix is shipped. bug-073 isn't the bug; bug-117 is. The deferred bug-115 Patch D (signature granularity) remains correctly deferred.

### Cross-references

- bug-115 (archived 2026-05-16) — parent. This bug ships the deferred Patch C.
- bug-061 — teardown branch in openPerBugWorktree; doesn't fire when worktree dir is absent.
- bug-076 — openFixupWorktree's "already exists" fallback (different code path; this bug adds a sibling).
- gotribe-tribe-directory 2026-05-16 round 4 — empirical motivator.
