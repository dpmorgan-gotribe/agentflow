---
id: bug-058-fixup-worktree-stale-base-vs-master
type: bug
status: completed
author-agent: human
attempt-count: 1
created: 2026-05-06
updated: 2026-05-06
parent-plan: investigate-018-fix-bugs-dispatch-latency
supersedes: null
superseded-by: null
branch: fix/fixup-worktree-stale-base-vs-master
affected-files:
  - orchestrator/src/fix-bugs-loop.ts
  - orchestrator/tests/fix-bugs-loop.test.ts
feature-area: orchestrator/fix-bugs-loop
priority: P1
attempt-count: 0
max-attempts: 5
error-message: |
  Bug-fix worktrees branch from `fix/bugs-yaml-iter` (the fixup branch),
  which sits at the last `closeFixupWorktree` HEAD. If master has moved
  since then (operator manual fix between /fix-bugs runs), the worktrees
  branch from a stale base. Dispatched agents see neither the master
  commits nor the fixes — they may even REGRESS them by re-introducing
  changes that master had explicitly fixed.
reproduction-steps: |
  1. /fix-bugs <project> finishes with auto-merge-to-master failure
     (e.g. dirty working tree). fixupBranch stays at OLD master HEAD;
     master moves forward via operator manual commit.
  2. Operator commits fixes to master directly (e.g. config update).
  3. Next /fix-bugs <project> run starts. openFixupWorktree finds
     fix/bugs-yaml-iter already exists at OLD master HEAD; checks
     it out there.
  4. openPerBugWorktree branches per-bug worktrees from fixupBranch HEAD
     (= OLD master). Agent dispatches into stale worktree.
  5. Agent makes fixes, INCLUDING potentially undoing operator's master
     commits because they're not in the agent's worktree.
  6. closePerBugWorktree merges per-bug → fixupBranch (still stale).
  7. closeFixupWorktree auto-merges fixupBranch → master — fails again
     because of the same dirty-tree issue OR succeeds and ROLLS BACK
     master's manual fixes.
stack-trace: null
---

# bug-058: openFixupWorktree branches from stale base when master has diverged

## Bug Description

`orchestrator/src/fix-bugs-loop.ts:openFixupWorktree` creates the
fixup worktree at the existing `fix/bugs-yaml-iter` branch HEAD. If
that branch has fallen behind master between /fix-bugs runs (because
operator manually committed to master, or a prior auto-merge-to-master
failed leaving WIP on fixupBranch), the worktree starts at the stale
HEAD. Subsequent per-bug worktrees branch from there, so agents see
the WORLD AS IT WAS at fixupBranch's last cleanup, NOT current master.

Empirical: reading-log-01 bjw01o7js (2026-05-06) — agent commit
73ba7d8 deleted `.npmrc` and reverted the
`apps/web/tsconfig.json` `vitest/globals` types entry. Both files
had been added by operator manual commit b1c3e20 between the prior
/fix-bugs run and bjw01o7js. The agent's worktree branched from
fixupBranch which was at f0f7f77 (pre-b1c3e20) — agent saw NEITHER
file in its tree, classified them as stale config, regressed them.

## Reproduction Steps

See frontmatter `reproduction-steps`. Minimum reliable repro:

1. Run /fix-bugs to completion with at least one closeFixupWorktree
   auto-merge failure (e.g. by leaving uncommitted file in projectRoot
   matching a fixup-branch path).
2. Commit a new change to master (any change). Master HEAD moves.
3. Run /fix-bugs again. Inspect the resulting per-bug worktree's `git
log` — it does NOT include the master commit from step 2.

## Error Output

From bjw01o7js post-mortem:

```
Master HEAD: cb050f2 (post-cherry-pick of agent fix)
fix/bug-compile-tooling-pre-flight (agent's branch): 73ba7d8
git log master..fix/bug-compile-tooling-pre-flight diff:
  - .npmrc                                   |  8 ----   ← REGRESSION
  - apps/web/tsconfig.json                   | 10 ++++   ← REGRESSION (removed vitest/globals)
  + apps/api/src/server.ts                   | 17 ++++   ← good fix
  + apps/web/playwright.config.ts            |  2 ++    ← good fix
  + (synthesized e2e specs, etc.)
```

The .npmrc and tsconfig regressions are direct evidence of stale-base
dispatch — both files exist on master b1c3e20 but the agent's worktree
at f0f7f77 (fixupBranch HEAD) didn't see them.

## Root Cause Analysis

`orchestrator/src/fix-bugs-loop.ts:192-223` `openFixupWorktree`:

```ts
function openFixupWorktree(args) {
  if (!existsSync(args.worktreePath)) {
    // Create worktree on `args.branch`.
    // If branch doesn't exist, git creates it at current HEAD (master).
    // If branch exists, checks it out at its existing HEAD.
    execSync(`git worktree add <path> -b <branch>`, { cwd: projectRoot });
  }
  // seed hooks; return ok
}
```

The `git worktree add` command does NOT update the existing branch
to current master. If `fix/bugs-yaml-iter` already exists at OLD
HEAD, the worktree is opened at OLD HEAD. Per-bug worktrees then
branch from that OLD HEAD via `openPerBugWorktree` (line 380:
`git worktree add ... -b <branch> <baseBranch>`).

The lifecycle assumption is: `closeFixupWorktree` cleans up
fixupBranch by merging it into master + deleting it. But that path
fails when:

- Auto-merge to master encounters conflicts (e.g. dirty tree)
- Orchestrator crashed/killed mid-run
- Operator deleted `paused.json` without resuming

In all three failure modes, fixupBranch persists across runs at a
stale HEAD.

## Fix Approach

### Phase A — Detect master-divergence + fast-forward when safe

Modify `openFixupWorktree` to inspect master vs fixupBranch state
AFTER worktree open + BEFORE returning ok. Three possible states:

1. **fixupBranch is at master OR ahead of master** — no-op (current
   behavior). Including the case where fixupBranch is brand-new.
2. **fixupBranch is behind master AND fast-forwardable** (master is
   ancestor of fixupBranch is FALSE; fixupBranch is ancestor of
   master is TRUE) — the common stale-base case. Fast-forward
   fixupBranch to master via `git merge --ff-only master` from
   inside the fixup worktree.
3. **fixupBranch and master have diverged** (neither is ancestor
   of the other) — exotic; means there's WIP on fixupBranch AND
   new master commits. Try a real merge (`git merge --no-ff
master`); on conflict, return ok:false with a clear reason
   asking the operator to manually reconcile.

```ts
function ensureFixupTracksMaster(args: {
  projectRoot: string;
  worktreePath: string;
  fixupBranch: string;
  baseBranch?: string; // default "master"
}): { ok: true } | { ok: false; reason: string } {
  const baseBranch = args.baseBranch ?? "master";

  // Resolve commits.
  let masterSha: string;
  let fixupSha: string;
  try {
    masterSha = execSync(`git rev-parse ${baseBranch}`, {
      cwd: args.projectRoot,
      encoding: "utf8",
    }).trim();
    fixupSha = execSync(`git rev-parse HEAD`, {
      cwd: args.worktreePath,
      encoding: "utf8",
    }).trim();
  } catch (err) {
    return { ok: false, reason: `rev-parse failed: ${err.message}` };
  }

  if (masterSha === fixupSha) return { ok: true }; // already aligned

  // Is fixupBranch behind master? (master is descendant of fixup)
  const fixupBehind = isAncestor(args.projectRoot, fixupSha, masterSha);
  if (fixupBehind) {
    // Fast-forward in the fixup worktree.
    try {
      execSync(`git merge --ff-only ${baseBranch}`, {
        cwd: args.worktreePath,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: `fast-forward failed: ${err.message}` };
    }
  }

  // Is fixupBranch ahead OR diverged?
  const fixupAhead = isAncestor(args.projectRoot, masterSha, fixupSha);
  if (fixupAhead) {
    // fixupBranch has WIP commits but is descendant of master — no-op.
    // Subsequent merge cascades will integrate them when ready.
    return { ok: true };
  }

  // Diverged — try real merge.
  try {
    execSync(
      `git merge --no-ff ${baseBranch} -m "merge ${baseBranch} into fixup (bug-058 stale-base recovery)"`,
      {
        cwd: args.worktreePath,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return { ok: true };
  } catch (err) {
    // Conflict — abort + surface for operator review.
    try {
      execSync(`git merge --abort`, { cwd: args.worktreePath });
    } catch {
      /* best-effort */
    }
    return {
      ok: false,
      reason: `fixup branch diverged from ${baseBranch} AND merge failed: ${err.message}. Manually reconcile fix/bugs-yaml-iter with ${baseBranch} before re-running /fix-bugs.`,
    };
  }
}

function isAncestor(
  cwd: string,
  ancestor: string,
  descendant: string,
): boolean {
  try {
    execSync(`git merge-base --is-ancestor ${ancestor} ${descendant}`, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}
```

Then `openFixupWorktree` calls `ensureFixupTracksMaster` after the
worktree is opened + seeded.

### Phase B — Tests (45min)

`orchestrator/tests/fix-bugs-loop.test.ts`:

- `openFixupWorktree fast-forwards fixupBranch when behind master`
- `openFixupWorktree no-ops when fixupBranch is ahead of master (WIP preserved)`
- `openFixupWorktree no-ops when fixupBranch is at master HEAD (idempotent)`
- `openFixupWorktree merges master into fixupBranch on divergence`
- `openFixupWorktree returns ok:false on merge conflict + leaves clean tree`

### Phase C — Configurable base branch

Some projects use `main` instead of `master`. Add `baseBranch` to
`FixBugsLoopContext` (default `"master"`); thread through to
`ensureFixupTracksMaster`. Cross-check existing orchestrator config
(architecture.yaml.meta or similar) for any project-level base-branch
field — if found, plumb through. If not, default-only for v1.

### Phase D — Empirical re-validation (15min)

Re-fire /fix-bugs reading-log-01 against current master cb050f2
(which has the prisma migrate-on-boot fix). After bug-058 ships:

- openFixupWorktree picks up the cb050f2 commit
- Verifier runs against current master state
- Either reports clean (all fixed!) OR surfaces a different bug class
- New per-bug worktrees include cb050f2 in their base; agents don't
  regress it

## Rejected Fixes

- **Force-reset fixupBranch to master at every open** — Rejected:
  loses WIP on the rare case where fixupBranch has commits master
  doesn't (e.g. orchestrator crashed mid-merge cascade).

- **Delete fixupBranch entirely at every /fix-bugs run start** —
  Rejected: same WIP-loss concern; resumability matters.

- **Document the issue + ask operator to manually run `git merge
master`** — Rejected: that's the current state of the world
  and it doesn't work — operators don't know to do it.

- **Always merge master into fixupBranch via real merge (not
  ff-only)** — Rejected: produces unnecessary merge commits when a
  fast-forward would suffice. Cleaner history matters.

## Validation Criteria

1. Re-fire /fix-bugs reading-log-01 — observe per-bug worktree's
   `git log` includes cb050f2 (the migrate-on-boot fix).
2. New unit tests pass (Phase B's 5 cases).
3. All existing fix-bugs-loop tests still pass.
4. Empirical: reading-log-01 verifier on cb050f2 master state should
   report clean (backend now boots; flows now run) — closes the
   investigate-018 epic empirically.

## Dependencies / sequencing

- **Independent of feat-058 / bug-056 / bug-057** — those affect
  WHAT the agent does; bug-058 affects WHAT THE AGENT SEES at
  dispatch time.
- **Independent of bug-055** — Phase A (orphan recovery) and Phase
  B (empty-merge guard) are about cleanup + signal-correctness;
  bug-058 is about base-correctness.
- Recommended ship: solo. The factory layer is small + bounded; no
  reason to batch.

## Attempt Log

(empty — plan filed by human 2026-05-06)
