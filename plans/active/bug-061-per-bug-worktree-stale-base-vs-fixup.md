---
id: bug-061-per-bug-worktree-stale-base-vs-fixup
type: bug
status: completed
author-agent: human
created: 2026-05-06
updated: 2026-05-06
parent-plan: bug-058-fixup-worktree-stale-base-vs-master
supersedes: null
superseded-by: null
branch: fix/per-bug-worktree-stale-base-vs-fixup
affected-files:
  - orchestrator/src/fix-bugs-loop.ts
  - orchestrator/tests/fix-bugs-loop.test.ts
feature-area: orchestrator/fix-bugs-loop
priority: P1
attempt-count: 1
max-attempts: 5
error-message: |
  bug-058's `ensureFixupTracksMaster` syncs the fixup branch to master
  but does NOT extend to PER-BUG worktrees. When openPerBugWorktree
  finds an existing registered worktree at `.claude/worktrees/<bugId>/`
  (left over from a prior session — typically because Windows MAX_PATH
  caused bug-060's cleanup to fail), it reuses it as-is at the stale
  base. Agent dispatches against an outdated tree, can't see master's
  recent fixes, thrashes for 25 min, hits wall-clock abort with no
  commits.
reproduction-steps: |
  1. Run /fix-bugs <project> on Windows. Compile/parity bugs surface;
     per-bug worktrees install full node_modules (deep paths).
  2. closePerBugWorktree's `git worktree remove --force` hits MAX_PATH;
     bug-060's fallback also fails or leaves residue. Worktree dir
     persists registered (in `.git/worktrees/`).
  3. Operator commits a manual fix to master via cherry-pick.
  4. Next /fix-bugs run: same bug surfaces. openPerBugWorktree finds
     the registered worktree at `.claude/worktrees/<bugId>/`, reuses
     it AS-IS at the stale base.
  5. Agent dispatches into stale tree, doesn't see master's fixes,
     burns 25 min wall-clock budget without converging. Wall-clock
     timer (bug-059 Phase B) fires precisely at deadline.
stack-trace: null
---

# bug-061: Per-bug worktrees reuse stale base across sessions

## Bug Description

`openPerBugWorktree` in `orchestrator/src/fix-bugs-loop.ts` has bug-055
Phase A logic that rm-rfs orphan dirs (exists but not registered). It
does NOT handle the case where the worktree IS still registered at a
stale base. bug-058 added master-tracking for the fixupBranch; per-bug
branches don't get the same treatment.

Empirical: reading-log-01 bhs2ki3i6 (2026-05-06 23:00) — the
`bug-compile-tooling-pre-flight` worktree was at `0505bf4` (a prior
session's commit) when master had advanced to `cb050f2` with the
prisma migrate-on-boot fix. Backend-builder dispatched into the
worktree at the stale base, didn't see the master fix, ran 25 min
without converging, and hit the wall-clock abort.

The worktree had survived between sessions because closePerBugWorktree
hit Windows MAX_PATH on cleanup (bug-060's lane) and bug-060's
fallback didn't fully delete either. So the dir + the registered
worktree entry persisted.

## Reproduction Steps

See frontmatter `reproduction-steps`. Min reliable repro: leave a
per-bug worktree from a prior /fix-bugs run, advance master via a
direct commit, re-run /fix-bugs against the same surfaced bug, observe
the per-bug worktree still at stale base.

## Error Output

From bhs2ki3i6 stall-log.json (post-timeout):

```json
{
  "featureId": "bug-compile-tooling-pre-flight",
  "agent": "backend-builder",
  "abortReason": "wall-clock-1500000ms",
  "wallTimeMs": 1500317,
  "ts": "2026-05-06T22:50:58.519Z"
}
```

`git log master..fix/bug-compile-tooling-pre-flight --oneline`:

```
0505bf4 fix(api): add .npmrc Prisma hoisting + patch-prisma-client.mjs   ← prior session
73ba7d8 fix(web): resolve tooling-pre-flight compile error                ← prior session
```

NO new commits after `0505bf4`. Agent ran 25 min, committed zero.

## Root Cause Analysis

`orchestrator/src/fix-bugs-loop.ts:380-435` `openPerBugWorktree`:

```ts
if (existsSync(worktreePath) && !isRegisteredGitWorktree(...)) {
  // bug-055 Phase A: orphan dir → rm -rf + create fresh
  rmSync(worktreePath, ...);
}
if (!existsSync(worktreePath)) {
  // create fresh
  execSync(`git worktree add <path> -b <branch> <baseBranch>`, ...);
}
// else: dir exists AND IS registered → reuse AS-IS (THIS IS THE BUG)
```

When dir exists AND is registered, the function falls through to seed
the worktree without verifying its base. Per-bug branches are
ephemeral (created at dispatch, supposed to be merged + deleted at
close); they have no business surviving across sessions. Reusing them
at stale state is never the right behavior.

## Fix Approach

User chose **always remove + recreate** (vs the bug-058-style sync
approach). Rationale: per-bug worktrees are ephemeral by design — they
get merged into fixup + torn down at close-feature. If they survive
across sessions, that's bug-060's failure to clean up; reusing the
survivor at stale base is the wrong recovery. Always-recreate guarantees
fresh-from-fixup state.

### Implementation (single phase, ~30min)

`orchestrator/src/fix-bugs-loop.ts::openPerBugWorktree`:

```ts
function openPerBugWorktree(args) {
  const worktreePath = bugWorktreePath(args.projectRoot, args.bugId);
  const branch = bugBranchName(args.bugId);

  // bug-061 (2026-05-06) — always teardown + recreate. Per-bug worktrees
  // are ephemeral; reuse across sessions risks stale-base regression
  // (worktree at fixupBranch HEAD from prior session ≠ current
  // fixupBranch HEAD). Empirical: reading-log-01 bhs2ki3i6 — backend-
  // builder ran 25 min in a worktree at 0505bf4 when master had
  // advanced to cb050f2 with the load-bearing fix. No commits landed.
  // Supersedes bug-055 Phase A's orphan-only rm-rf — now unconditional.
  if (
    existsSync(worktreePath) ||
    isRegisteredGitWorktree(args.projectRoot, worktreePath)
  ) {
    // Tear down via git worktree remove first (cleanest path).
    try {
      execSync(`git worktree remove --force ${shellQuote(worktreePath)}`, {
        cwd: args.projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (gitErr) {
      // Windows MAX_PATH or other failure — bug-060-style fallback.
      try {
        execSync(`git worktree prune`, {
          cwd: args.projectRoot,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        /* best-effort prune */
      }
      try {
        rmSync(worktreePath, {
          recursive: true,
          force: true,
          maxRetries: 3,
        });
      } catch (rmErr) {
        return {
          ok: false,
          reason: `bug-061: per-bug worktree teardown failed: ${rmErr instanceof Error ? rmErr.message : String(rmErr)}`,
        };
      }
    }
    // Delete the branch if it exists. -D forces (may have unmerged).
    try {
      execSync(`git branch -D ${shellQuote(branch)}`, {
        cwd: args.projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      /* branch may not exist if cleanup already happened */
    }
  }

  // Create fresh worktree from current baseBranch HEAD.
  mkdirSync(dirname(worktreePath), { recursive: true });
  try {
    execSync(
      `git worktree add ${shellQuote(worktreePath)} -b ${shellQuote(branch)} ${shellQuote(args.baseBranch)}`,
      { cwd: args.projectRoot, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    return {
      ok: false,
      reason: `git worktree add failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Seed + slot env-inject as before (existing logic unchanged).
  // ...
}
```

### Tests (15min)

`orchestrator/tests/fix-bugs-loop.test.ts`, extending the existing
bug-055 + bug-058 describe blocks:

1. `openPerBugWorktree tears down + recreates when worktree pre-existed
at stale base` — verify HEAD after openPerBugWorktree matches
   baseBranch HEAD (not the prior commit)
2. `openPerBugWorktree tears down + recreates orphan dir (bug-055
regression)` — same orphan recovery still works
3. `openPerBugWorktree tears down + recreates a clean state (no prior
worktree)` — happy path unchanged

## Validation Criteria

1. After ship: re-fire /fix-bugs reading-log-01 — bug-compile worktree
   should be at current master HEAD (not 0505bf4 stale base).
2. New unit tests pass.
3. All existing fix-bugs-loop tests pass (bug-055 Phase A test still
   green — superseded but compatible).

## Cross-references

- `bug-055` Phase A — orphan-only rm-rf (this bug supersedes by making
  unconditional; the bug-055 test still passes since orphan IS one of
  the cases bug-061 handles)
- `bug-058` `ensureFixupTracksMaster` — analogous logic for the FIXUP
  branch (bug-061 is the per-bug-branch counterpart)
- `bug-060` Windows MAX_PATH cleanup — root cause of why per-bug
  worktrees survive across sessions in the first place; bug-061
  closes the consequence

## Attempt Log

(Implementation in progress — same session as plan filing.)
