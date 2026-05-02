---
id: feat-047-worktree-auto-prune-on-close-feature
type: feature
status: draft
author-agent: human
created: 2026-05-02
updated: 2026-05-02
parent-plan: investigate-014-fix-bugs-loop-parallelism-and-worktree-lifecycle
supersedes: null
superseded-by: null
branch: feat/worktree-auto-prune-on-close-feature
affected-files:
  - .claude/agents/git-agent.md
  - .claude/skills/git-agent/SKILL.md
  - orchestrator/src/feature-graph.ts
  - orchestrator/src/git-agent-runner.ts
  - .claude/skills/cleanup-worktrees/SKILL.md
feature-area: orchestrator/git-agent + worktree-lifecycle
priority: P2
attempt-count: 0
max-attempts: 5
---

# feat-047: Auto-prune completed worktrees post-merge

## Problem Statement

`.claude/agents/git-agent.md:52` documents: "close-feature after partial merge → reruns the merge; if already merged, detects + removes the worktree cleanly." But empirically (2026-05-02 finance-track-01 audit), all 17 feature worktrees + 1 fixup worktree persist on disk after the run completes. Disk inventory: 1.2 GB per project. At 12 shipped projects, ~12+ GB drag; compounds as more projects accumulate.

Per investigate-014 finding F5: most likely cause is the same Windows file-lock issue that blocked operator `rm -rf` attempts mid-session — `git worktree remove --force` returns "Directory not empty" until ~15s after files are released by AV scanners / lingering Node child processes. A retry-with-backoff in close-feature's worktree-remove path would handle this.

If feat-046 (per-bug worktree parallelism) ships without this, fix-loop iterations would create + abandon 5+ bug-worktrees per iteration, compounding disk drift across multiple iterations. Pair feat-047 with feat-046 at design + ship time.

## Approach

### Phase A — git-agent close-feature retry-with-backoff (P0 within feature)

1. **Locate `git-agent`'s close-feature handler** in `orchestrator/src/git-agent-runner.ts` (or wherever the git-CLI invocations live for the close-feature op).

2. **After a successful merge to master**, attempt `git worktree remove --force <worktree-path>`:

   ```ts
   async function removeWorktreeWithBackoff(
     projectRoot: string,
     worktreePath: string,
     maxRetries = 5,
   ): Promise<{ removed: boolean; reason?: string }> {
     for (let attempt = 1; attempt <= maxRetries; attempt++) {
       const result = spawnSync(
         "git",
         ["worktree", "remove", "--force", worktreePath],
         {
           cwd: projectRoot,
           encoding: "utf8",
         },
       );
       if (result.status === 0) return { removed: true };
       // "Directory not empty" or "Device or resource busy" → backoff + retry
       const errOutput = (result.stderr || "") + (result.stdout || "");
       const isLockIssue =
         errOutput.includes("not empty") ||
         errOutput.includes("Device or resource busy") ||
         errOutput.includes("EBUSY");
       if (!isLockIssue) {
         return { removed: false, reason: errOutput.trim() };
       }
       // Exponential backoff: 1s, 2s, 4s, 8s, 16s (total ~31s max wait)
       const waitMs = 1000 * Math.pow(2, attempt - 1);
       await new Promise((r) => setTimeout(r, waitMs));
     }
     return {
       removed: false,
       reason: `still locked after ${maxRetries} retries`,
     };
   }
   ```

3. **Wire into close-feature** AFTER the merge succeeds (so we never delete a worktree whose merge is incomplete).

4. **Include a `worktreeRemoved: boolean` field in the close-feature return JSON** so the orchestrator can surface the removal status. Don't fail close-feature if removal fails — the merge already succeeded, the worktree is just dormant disk usage.

### Phase B — post-success branch deletion

5. **After `git worktree remove` succeeds**, also run `git branch -d <feature-branch>` to delete the now-merged branch. Use `-d` (safe) not `-D` (force) — if the branch wasn't merged, `git branch -d` refuses + we surface the warning rather than silently nuking unmerged work.

### Phase C — operator-gated retention + manual cleanup skill

6. **Add `--keep-last-n-worktrees <N>` flag to `/start-build`** (default: 0, i.e. prune all). Operators wanting forensic state can pass `--keep-last-n-worktrees=3` to keep the 3 most-recently-merged worktrees.

7. **Ship `.claude/skills/cleanup-worktrees/SKILL.md`** — operator-invocable for projects that didn't have auto-prune enabled OR want to clean up older worktrees beyond the retention window:
   - Lists all worktrees + their age + merge state
   - Default: prune all merged worktrees older than 7 days
   - `--all` flag: prune all merged regardless of age
   - `--dry-run` flag: print the plan without touching disk

### Phase D — git-agent doc + skill alignment

8. **Update `.claude/agents/git-agent.md` § close-feature** to clearly state the retry-with-backoff behavior + the new `worktreeRemoved` return field. Replace the aspirational "removes the worktree cleanly" with the implemented contract.

9. **Update `.claude/skills/git-agent/SKILL.md`** with the matching skill-driven dispatch context.

## Rejected Alternatives

- **Alternative A: Aggressive prune immediately on close-feature success (no retention)** — Rejected as default. Retention=0 is the right ship-time default but Phase C's `--keep-last-n` flag offers forensic-debug operators an escape hatch.
- **Alternative B: Cleanup as a separate post-pipeline step (not in close-feature)** — Rejected. Coupling cleanup to close-feature means each merged feature's disk gets reclaimed promptly; deferring to end-of-pipeline accumulates 17+ worktrees of disk drift across the run.
- **Alternative C: Use `git worktree prune` instead of `git worktree remove`** — Rejected. `prune` only removes registrations for ALREADY-deleted worktree dirs; doesn't delete the dir itself. We need the dir gone; `remove --force` is the right primitive.
- **Alternative D: Polling cleanup loop separate from git-agent** — Rejected. Adds operational complexity (when does it run? what triggers it?) compared to coupling to close-feature.
- **Alternative E: Defer indefinitely (status quo)** — Rejected because feat-046 (parallel fix-loop) compounds the disk problem; ship as a pair.

## Expected Outcomes

- [ ] `git-agent close-feature` post-merge attempts `git worktree remove --force` with 5-retry exponential backoff (1s, 2s, 4s, 8s, 16s).
- [ ] Returns `worktreeRemoved: boolean` in close-feature output.
- [ ] Failure to remove doesn't fail close-feature (merge already succeeded; dormant disk is non-fatal).
- [ ] Post-success branch deletion via `git branch -d`.
- [ ] Operator `--keep-last-n-worktrees N` flag honored.
- [ ] `/cleanup-worktrees` skill ships for retroactive cleanup.
- [ ] git-agent.md + SKILL.md docs match the implemented contract.
- [ ] Empirical: re-run finance-track-01 (or fresh project) → after run completes, `.claude/worktrees/` is near-empty (0 dirs at default retention=0).

## Validation Criteria

- [ ] Unit test: `removeWorktreeWithBackoff` retries 5 times with exponential backoff on "not empty" / "EBUSY"; returns immediately on other errors.
- [ ] Integration test: full feature lifecycle (checkout → builder → tester → reviewer → close-feature) → worktree dir exists during; gone after close-feature returns success.
- [ ] Integration test: branch deletion fires only after `git worktree remove` succeeds.
- [ ] Empirical: `du -sh projects/<name>/.claude/worktrees/` post-run = ~0 MB (down from 1.2 GB on the finance-track-01 baseline).
- [ ] No regression: bug-036 mutex still works; bug-034 resolver still works; close-feature merge semantics unchanged.

## Attempt Log

<!-- populated as fix attempts are made -->
