---
id: bug-055-orphan-worktree-empty-merge-silent-success
type: bug
status: completed
author-agent: human
created: 2026-05-06
updated: 2026-05-06
attempt-count: 1
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/orphan-worktree-empty-merge-silent-success
affected-files:
  - orchestrator/src/fix-bugs-loop.ts
  - orchestrator/tests/fix-bugs-loop.test.ts
feature-area: orchestrator/fix-bugs-loop
priority: P0
attempt-count: 0
max-attempts: 5
error-message: |
  Loop reports `status: clean` and bug as `completed` despite the dispatched
  agent producing zero commits to the per-bug branch. Master HEAD does not
  move; the agent's edits sit abandoned in an orphan worktree directory.
reproduction-steps: |
  1. Run /fix-bugs <project> to completion (creates per-bug worktrees +
     branches at .claude/worktrees/<bugId>/ and fix/<bugId>).
  2. After completion, the per-bug worktrees are removed by closePerBugWorktree.
     But if a prior crash, taskkill, or manual abort leaves the directory in
     place WITHOUT removing the registered worktree (`git worktree list` shows
     it absent yet the dir exists on disk), the dir becomes "orphan".
  3. Re-run /fix-bugs against the same project. The verifier files a new bug.
  4. openPerBugWorktree's `if (!existsSync(worktreePath))` guard sees the
     directory and SKIPS `git worktree add` entirely.
  5. Agent dispatches into the orphan dir; its git context resolves to the
     project's main worktree (master), not a fresh per-bug branch.
  6. Agent makes edits; closePerBugWorktree runs `git merge fix/<bugId>` —
     branch has no new commits, merge is a no-op, exit 0.
  7. Loop accepts merge as success and marks bug `completed`.
  8. Master HEAD is unchanged; no $ spent on agent invocations is reflected
     in counters.json; agent's edits remain in the orphan dir.
stack-trace: null
---

# bug-055: Orphan worktree dir + empty merge silent-success in fix-bugs-loop

## Bug Description

The fix-bugs loop reports `status: clean` and marks bugs as `completed`
even when the dispatched agent produces ZERO commits to the per-bug
branch. Empirically observed on `reading-log-01` 2026-05-06 16:25–16:48
local: verifier correctly filed bug-compile-tooling-pre-flight (P0,
dev-server-compile, "backend port 3001 didn't bind in 60s"); loop
dispatched web-frontend-builder; reported `iteration 1/1; resolved: 1;
failed: 0; remaining: 0; status: clean; cost: $3.28`. But:

- master HEAD did NOT move (still at `f0f7f77` from prior run)
- `git worktree list` shows the per-bug worktree was never registered
- `fix/bug-compile-tooling-pre-flight` branch had empty diff vs master
- `counters.json` lastUpdated 12:58 UTC (a prior run) — this run added $0
- Real product state: backend still doesn't boot (Prisma DB issue persists)

The "clean" claim is false. The bug is not fixed. The loop's success
signal is detached from the actual code state.

This is a NEW silent-success antipattern at the bug-fix-loop layer —
distinct from feat-056's verifier-classification fix (which only affects
how the verifier surfaces failures) and from feat-057's Playwright-binary
fix (which only affects whether tests can run). This bug is in the
dispatch+merge plumbing itself.

## Reproduction Steps

See frontmatter `reproduction-steps`. Minimum reliable repro:

1. Manually create `.claude/worktrees/bug-test-orphan/` as a normal
   directory (no `.git` file, not registered with `git worktree`).
2. Manually create branch `fix/bug-test-orphan` pointing at master.
3. Construct a minimal `bugs.yaml` with one entry whose id is
   `bug-test-orphan`, status `pending`, agentSequence `[web-frontend-builder]`.
4. Invoke `runFixBugsLoop` with `maxConcurrent: >= 2` (forces
   per-bug-worktree path, not the sequential single-fixup path).
5. Observe: bug marked `completed`, no commits on `fix/bug-test-orphan`,
   merge `closePerBugWorktree` returns ok despite no work landed.

## Error Output

From `b71mtcpmv.output` orchestrator log:

```
Build-to-spec verify:
  reachability: 0 orphans
  flows: 0 passed, 1 failed
  bug plans filed: bug-002-compile-tooling-pre-flight
  warnings:
    - flow-execution: dev-server-not-ready (backend port 3001 didn't bind in 60s)
    - parity: dev-server: auto-boot failed: backend (node-fastify) did not respond
      on http://localhost:3001/health within 60000ms

Bug-fix loop:
  iteration 1/1; resolved: 1; failed: 0; remaining: 0; status: clean
  resolved: bug-compile-tooling-pre-flight
  cost: $3.28
```

Filesystem state immediately after orchestrator exit (verified):

```
$ git log --oneline -1
f0f7f77 chore(web): add postinstall hook for chromium browser install (feat-057 Phase D)

$ git diff master..fix/bug-compile-tooling-pre-flight --stat
(empty — branch at same commit as master)

$ git worktree list
projects/reading-log-01                                   f0f7f77 [master]
projects/reading-log-01/.claude/worktrees/feat-books-core 58aaae7 [feat/books-core]
projects/reading-log-01/.claude/worktrees/feat-tags-manage b2d214e [feat/tags-manage]

$ ls .claude/worktrees/bug-compile-tooling-pre-flight/
brief.md  CLAUDE.md  package.json  apps/  ...   # full project tree, no .git
```

## Root Cause Analysis

THREE compounding silent-success points in `orchestrator/src/fix-bugs-loop.ts`:

### Layer 1 — Orphan worktree reuse (line 268)

```ts
function openPerBugWorktree(args) {
  const worktreePath = bugWorktreePath(args.projectRoot, args.bugId);
  const branch = bugBranchName(args.bugId);
  if (!existsSync(worktreePath)) {              // ← THE GUARD
    mkdirSync(dirname(worktreePath), { recursive: true });
    try {
      execSync(`git worktree add ${worktreePath} -b ${branch} ${baseBranch}`, ...);
    } catch (err) {
      // recovery: try without -b if branch exists
    }
  }
  // ELSE branch: no verification that the existing dir IS a registered worktree
  const seed = seedWorktree(args.projectRoot, worktreePath);
  // ... return { ok: true }
}
```

The `if (!existsSync(worktreePath))` check assumes "dir exists ⇒ valid
worktree". But `.claude/worktrees/<bugId>/` can exist without being a
registered git worktree:

- Prior orchestrator crash leaves dir + `.git/worktrees/<bugId>/` registry
- Operator manually `rm -rf`s the registry but not the dir
- Cross-platform behavior — `git worktree remove --force` may leave
  partial state on Windows on filesystem races

Result: dispatch proceeds against a dir that's just a regular tree with
no git worktree binding. Git ops inside the dir resolve to the parent
`.git`'s default branch (master).

### Layer 2 — Empty-merge accepted as success (line 474)

```ts
function closePerBugWorktree(args) {
  try {
    execSync(`git merge --no-ff fix/<bugId> -m "..."`, { cwd: fixupWorktreePath, ... });
  } catch (err) {
    // abort + return ok: false
  }
  // tear down worktree + delete branch
  return { ok: true };
}
```

`git merge --no-ff <branch>` with NO new commits returns exit code 0 with
"Already up to date" output. There's no check for "did this merge actually
move HEAD?" — the loop reads the exit-0 as "fix landed".

The merge succeeded in the trivial sense (no error). But "merge succeeded"
≠ "fix landed in the codebase". The conflation is the silent-success.

### Layer 3 — No empty-commit guard in dispatch result

```ts
if (mergedOk) {
  for (const bug of result.unit.bugs) {
    bug.status = "completed";
    bug.resolvedInIteration = iteration;
    completedCount += 1;
  }
}
```

`mergedOk` is purely the close-feature result. The loop never asks "did
the agent actually produce N>0 commits on the per-bug branch?". Any
agent return-success + any merge-success = bug completed.

### Why this didn't surface earlier

The first /fix-bugs run on a project always succeeds (no orphan dirs).
This bug only surfaces on the SECOND or later run when state has
accumulated AND a prior run's worktrees weren't cleaned up. This is
exactly the scenario every project hits once it goes through one
fix-bugs cycle.

reading-log-01 is the empirical first hit because it's the first project
to go through TWO consecutive /fix-bugs runs in close succession (the
feat-057 ship + this validation re-run).

## Fix Approach

Three layers, mirror the three silent-success points. Each layer
hardens independently — a single layer would close the empirical gap on
reading-log-01, but defense-in-depth on all three closes the class.

### Phase A — Orphan worktree pre-flight check

Modify `openPerBugWorktree` (line 238–313) to verify the dir is a
registered worktree, NOT just exists:

```ts
function openPerBugWorktree(args) {
  const worktreePath = bugWorktreePath(args.projectRoot, args.bugId);
  const branch = bugBranchName(args.bugId);

  const dirExists = existsSync(worktreePath);
  const registeredAsWorktree =
    dirExists && isRegisteredGitWorktree(args.projectRoot, worktreePath);

  if (dirExists && !registeredAsWorktree) {
    // Orphan dir from prior run. Two recovery options:
    //   (a) rm -rf the orphan dir + proceed with fresh worktree add
    //   (b) hard-fail with operator instruction
    // Option (a) is automatic + safer (prior orphan content was already
    // abandoned). Option (b) preserves operator's potentially-valuable
    // mid-flight state but blocks autonomous runs.
    // PICK (a) — automation > preservation, since the orphan content was
    // never committed and is by definition unreachable to the operator
    // anyway (no branch points at it).
    rmSync(worktreePath, { recursive: true, force: true });
  }

  if (!existsSync(worktreePath)) {
    // ... existing creation path unchanged
  }
  // ... rest unchanged
}

function isRegisteredGitWorktree(projectRoot, candidatePath): boolean {
  try {
    const out = execSync(`git worktree list --porcelain`, {
      cwd: projectRoot,
      encoding: "utf8",
    });
    // Each entry is a `worktree <abspath>` line; parse + match.
    return out
      .split("\n")
      .some(
        (line) =>
          line.startsWith("worktree ") &&
          resolve(line.slice("worktree ".length)) === resolve(candidatePath),
      );
  } catch {
    return false;
  }
}
```

Files: `orchestrator/src/fix-bugs-loop.ts` (modify openPerBugWorktree +
add isRegisteredGitWorktree helper).

Tests: 2 new in `orchestrator/tests/fix-bugs-loop.test.ts`:

- `openPerBugWorktree recovers from orphan dir by rm -rf + recreate`
- `openPerBugWorktree no-ops on already-registered worktree (idempotent)`

### Phase B — Empty-merge detection

Modify `closePerBugWorktree` (line 464–509) to check whether the merge
actually moved fixupBranch's HEAD:

```ts
function closePerBugWorktree(args) {
  // Capture HEAD before merge.
  const beforeHead = execSync(`git rev-parse HEAD`, {
    cwd: args.fixupWorktreePath,
    encoding: "utf8",
  }).trim();

  try {
    execSync(`git merge --no-ff fix/<bugId> -m "..."`, ...);
  } catch (err) {
    // ... existing abort path
  }

  const afterHead = execSync(`git rev-parse HEAD`, {
    cwd: args.fixupWorktreePath,
    encoding: "utf8",
  }).trim();

  if (beforeHead === afterHead) {
    // No commits merged. Don't lie about success.
    return {
      ok: false,
      reason: `merge of ${args.branch} into ${args.fixupBranch} produced 0 commits — agent did not commit any work`,
    };
  }

  // ... existing teardown path
  return { ok: true };
}
```

Files: same. Tests: 2 new:

- `closePerBugWorktree returns ok:false when per-bug branch has no commits`
- `closePerBugWorktree returns ok:true when per-bug branch has >= 1 commit`

### Phase C — Cost-spend sanity check + structured warning

The loop already tracks `dispatch.costUsd`. Add a defensive check at the
loop level: if a bug is marked completed BUT cost was $0 BUT no
skipWorktreeManagement, log a structured warning. Doesn't change behavior
yet (Phase B already prevents the silent-success), but operator-visible
signal helps catch the next-class bug.

```ts
// in the dispatch result handler
if (
  result.kind === "completed-or-failed" &&
  result.success &&
  result.costUsd === 0
) {
  process.stderr.write(
    `[fix-bugs-loop] WARNING: bug ${result.unit.unitId} marked complete with $0 spend — ` +
      `verify agent dispatch actually fired (could indicate orchestrator dispatch skip)\n`,
  );
}
```

Files: same. Tests: 1 new — verify the warning fires on the synthetic
$0-cost-but-success path.

### Cross-cutting — make `git worktree remove` failure noisy

The current `closePerBugWorktree` catches worktree-remove errors with
`catch {}` and a comment "Cleanup failure is non-fatal". This is the
mechanism by which orphan dirs accumulate in the first place. Phase A

- Phase B close the loop on the consequence; this hardens the cause.

Change to log a warning + record the cleanup-failure into the bug's
`errorLog` so operator review surfaces it:

```ts
try {
  execSync(`git worktree remove --force ${args.worktreePath}`, ...);
  execSync(`git branch -D ${args.branch}`, ...);
} catch (err) {
  process.stderr.write(
    `[fix-bugs-loop] WARNING: worktree cleanup for ${args.bugId} failed; ` +
    `dir at ${args.worktreePath} may persist as orphan. Detail: ${err.message}\n`
  );
  // Don't fail the close — merge already landed.
}
```

## Rejected Fixes

- **Phase A alternative: hard-fail on orphan instead of rm -rf** — Rejected
  because: the orphan content is by definition unreachable (no branch
  points at it, agent already abandoned it). Preserving it adds noise
  for the operator to triage but no recovery value. Auto-cleanup is
  safe + autonomous.

- **Skip per-bug-worktree path entirely; go back to single shared fixup
  worktree (maxConcurrent=1)** — Rejected because: feat-046 Phase A.1
  parallelism is the load-bearing performance story; reverting it
  loses 5x throughput. The fix should preserve parallelism, not unwind
  it.

- **Add a "did agent actually commit?" check to dispatchAgentsForBug
  itself** — Rejected because: dispatchAgentsForBug doesn't own the
  worktree — it just invokes ctx.invokeAgent. Putting the commit check
  here splits the responsibility across two functions. The merge step
  (Phase B) is the natural place for "did anything happen?" gate.

- **Use `git diff --quiet master..branch` instead of HEAD comparison** —
  Rejected because: the per-bug branch is created from fixupBranch
  HEAD, not master. The correct baseline is fixupBranch pre-merge HEAD,
  which is exactly what `git rev-parse HEAD` (in fixup worktree) captures.

## Validation Criteria

1. Reading the unit tests added in Phases A + B + C — all 5 new tests
   pass on first run.
2. Manual repro from frontmatter `reproduction-steps`: after fix, the
   loop reports `status: failed` (or escalates to `iteration-cap-hit`
   after retry budget exhausted) instead of `clean` when no agent
   commits land.
3. Re-run /fix-bugs reading-log-01 (the original repro target):
   - Verifier files the same dev-server-compile bug
   - Loop dispatches builder
   - If builder commits: bug completes correctly, master HEAD moves,
     counters.json `cumulativeUsd` increases
   - If builder doesn't commit: bug marked failed (or pending for
     retry), `[fix-bugs-loop] WARNING: ...` lines surface in stderr,
     master HEAD does NOT move
4. All 703+ existing orchestrator tests still pass.
5. `pnpm --filter orchestrator typecheck` clean.

## Attempt Log

### 2026-05-06 — Attempt 1 (shipped)

All 3 phases + cross-cutting cleanup-noise change landed in a single
edit pass against `orchestrator/src/fix-bugs-loop.ts`:

- **Phase A** — added exported `isRegisteredGitWorktree(projectRoot,
candidatePath): boolean` helper (parses `git worktree list --porcelain`).
  Modified `openPerBugWorktree` to rm-rf orphan dirs (exists but not
  registered) before falling through to the standard `git worktree add`
  creation path. Returns ok:false with structured reason on rm-rf
  failure (e.g. Windows file lock).
- **Phase B** — added HEAD-before/HEAD-after capture in
  `closePerBugWorktree`. `git rev-parse HEAD` before merge, `git merge
--no-ff <branch>`, `git rev-parse HEAD` after. If the SHA is unchanged
  (= "Already up to date" / no commits to merge), return ok:false with
  `empty-merge: <branch> produced 0 commits ahead of <fixupBranch>`.
  Caller's existing logic marks the bug pending/failed for retry.
- **Phase C** — defense-in-depth $0-spend stderr warning in the
  parallel-dispatch result handler. Fires when dispatch reports
  `success: true` AND `costUsd === 0` AND `!skipWorktreeManagement`.
  Phase B already prevents the silent-success outcome; this is an
  operator-visible signal for the next-class bug.
- **Cross-cutting** — replaced the silent `catch {}` in
  `closePerBugWorktree`'s worktree-cleanup teardown with a stderr
  warning. The silent catch was the upstream cause of orphan-dir
  accumulation (the very state Phase A recovers from).
- Exported `openPerBugWorktree` so the new test can exercise it
  directly without going through the full loop.

Tests: 5 new under `describe("bug-055 — orphan worktree + empty-merge
guards")` in `orchestrator/tests/fix-bugs-loop.test.ts`:

1. `isRegisteredGitWorktree` returns true for registered worktree,
   false for orphan dir, false for nonexistent path
2. `openPerBugWorktree` recovers from orphan dir by rm-rf + creating
   fresh registered worktree
3. `closePerBugWorktree` returns ok:false when per-bug branch has 0
   commits ahead (empty merge guard)
4. `closePerBugWorktree` returns ok:true when per-bug branch has ≥1
   commit (smoke regression)
5. Phase C $0-spend warning fires when dispatch reports success with
   cost 0 in a non-test run

`setupRepo()` helper creates a real on-disk repo with `.claude/hooks/`
stub files (block-dangerous.sh, detect-loop.mjs, enforce-boundaries.sh,
validate-brief.mjs) so `seedWorktree`'s self-verify doesn't fail.

Suite results:

- `pnpm --filter orchestrator test fix-bugs-loop` — 43/43 pass
  (38 existing + 5 new)
- Full orchestrator suite — 709/710 pass; 1 pre-existing failure in
  `run-synthesized-flows.test.ts > handles empty/non-JSON stdout
gracefully` unrelated to this fix (last modified by feat-057's
  f8532b0; my edits don't import or modify run-synthesized-flows)
- `pnpm --filter orchestrator typecheck` — 1 pre-existing TS error
  in `feature-graph.ts:617` (exactOptionalPropertyTypes, unrelated)

The reading-log-01 empirical repro will not re-occur on next /fix-bugs
run because:

- The orphan dir at `.claude/worktrees/bug-compile-tooling-pre-flight/`
  will be rm-rf'd before any new dispatch (Phase A)
- Even if a future agent dispatch silently no-ops, the empty merge will
  return ok:false instead of marking the bug completed (Phase B)
- The $0-spend warning gives a separate operator-visible signal (Phase C)
