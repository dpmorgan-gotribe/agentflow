---
id: bug-089-fix-loop-auto-merge-silent-fail
type: bug
status: approved
author-agent: human
created: 2026-05-12
updated: 2026-05-13
approved-by: human
approved-at: 2026-05-13
parent-plan: feat-066-fix-loop-effectiveness-v2
supersedes: null
superseded-by: null
branch: fix/fix-loop-auto-merge-silent-fail
affected-files:
  - orchestrator/src/fix-bugs-loop.ts
  - orchestrator/tests/fix-bugs-loop.test.ts
feature-area: orchestrator/fix-loop
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "fix-bugs-loop's auto-merge of fix/bugs-yaml-iter into master silently fails on dirty tree; operator's site review keeps looking at stale master"
---

# bug-089: fix-bugs-loop auto-merge to master silently fails on dirty tree

## Bug Description

`orchestrator/src/fix-bugs-loop.ts` attempts to auto-merge the shared fixup branch (`fix/bugs-yaml-iter`) into the project's `master` at the end of each fix-loop run. The merge uses `git merge --no-ff fix/bugs-yaml-iter -m "..."` against the project's working tree. When the working tree has uncommitted changes (which is the COMMON case during long-running fix-loop runs — agents leave intermediate test/lockfile changes), the merge fails with:

```
error: Your local changes to the following files would be overwritten by merge:
  .claude/models.yaml apps/web/e2e/synthesized/flow-4.spec.ts apps/web/e2e/synthesized/flow-6.spec.ts
Merge with strategy ort failed.
```

The orchestrator catches this as a WARNING and continues. The operator-facing output says:

```
[fix-bugs-loop] WARNING: auto-merge of fix/bugs-yaml-iter failed; fixes remain on the branch.
  Run `git merge --no-ff fix/bugs-yaml-iter` manually. Detail: Command failed: ...
```

But the next step in the orchestrator is to report `Bug-fix loop: resolved: N, status: clean` — making it look like everything's fine. The operator inspects the site, sees the OLD broken state, and reasonably concludes "the fix-loop didn't actually fix anything."

In reality, the fixes DID land — on `fix/bugs-yaml-iter`. They just never made it to `master`. The operator's `pnpm dev` boot serves master, which is now stale by potentially DOZENS of commits.

**Empirical confirmation (reading-log-02 feat-068+073+087+088 stack 2026-05-12):**

- Multiple `/fix-bugs` runs reported ~95% resolution
- Site review at each milestone showed unchanged-looking page
- `git log fix/bugs-yaml-iter --oneline` had 40+ fix commits that NEVER appeared on master
- Manual `git merge --no-ff fix/bugs-yaml-iter` (with the 3 blocker files reset) finally moved master forward; site immediately reflected all the fixes
- Diff size on the merge commit: ~938 insertions / 135 deletions across 22 files

## Reproduction Steps

1. Run `/start-build <project>` or `/fix-bugs <project>` on any project with pending bugs.
2. Let the fix-loop run multiple iterations. Watch the orchestrator log.
3. Observe: `WARNING: auto-merge of fix/bugs-yaml-iter failed` appears mid-run, but the loop continues and ends with a "resolved: N" success-shaped report.
4. After run completes: `cd projects/<name> && git log --oneline master..fix/bugs-yaml-iter` reveals the unmerged fix commits.
5. Boot dev server (`scripts/dev.mjs` or `pnpm --filter @repo/web dev`) and inspect the site. The fixes are invisible because master is stale.

## Root Cause Analysis

`orchestrator/src/fix-bugs-loop.ts` — the auto-merge call site (search for `merge fix/bugs-yaml-iter`):

```js
try {
  execSync(
    `git merge --no-ff fix/bugs-yaml-iter -m "merge fix/bugs-yaml-iter (fix-bugs-loop)"`,
    {
      cwd: projectRoot,
      encoding: "utf8",
    },
  );
} catch (err) {
  warnings.push(
    `auto-merge of fix/bugs-yaml-iter failed; fixes remain on the branch. ...`,
  );
}
```

The catch turns a HARD CORRECTNESS FAILURE into a warning. The orchestrator's exit-code + final status report don't distinguish between "fixes landed on master cleanly" and "fixes are stranded on fix/bugs-yaml-iter".

**Why the working tree is dirty in the common case:**

1. Per-bug worktrees create intermediate state (test files, lockfile changes, package.json bumps) that doesn't always make it into the per-bug commit.
2. `scripts/dev.mjs` (operator-side) leaves runtime artifacts in `apps/api/prisma/data/`.
3. Synthesized E2E specs (`apps/web/e2e/synthesized/`) get regenerated on each verifier pass and stay uncommitted between verify-runs.
4. `.claude/models.yaml` gets touched if the operator manually edits during a run.

All four are routine. The auto-merge is the EXCEPTION case, not the dirty-tree.

## Fix Approach

### Phase A — fail loudly on merge failure (~30min)

The auto-merge MUST succeed for the fix-loop's "resolved" status to be meaningful. When it fails:

1. **Mark the fix-loop run as `status: "auto-merge-failed"`** in the FixBugsLoopResult — a NEW terminal status alongside `clean / iteration-cap-hit / all-bugs-failed`.
2. **Emit a clearly-visible error in the orchestrator's stdout summary**, not just a warning. The summary should read:
   ```
   ⚠️  fix-loop reported N resolved bugs, but auto-merge to master FAILED.
       The fixes are stranded on `fix/bugs-yaml-iter`. Site review will show
       STALE code until you manually merge:
         cd projects/<name>
         git status                        # inspect dirty files
         git stash -u                       # OR git restore <blocker-files>
         git merge --no-ff fix/bugs-yaml-iter
   ```
3. **Set `featureGraphResult.status = "completed-with-integration-failures"`** so the parent runner treats this as a non-clean exit.

### Phase B — auto-recover when safe (~1hr)

Even better: the orchestrator should try to recover. Most dirty-tree blockers are:

- **Synthesized E2E specs** (regenerated; safe to reset)
- **`.claude/models.yaml`** (factory-managed; safe to reset to HEAD)
- **`apps/api/prisma/data/*.db`** (runtime artifact; safe to remove)

When the auto-merge fails, before giving up, the orchestrator could:

1. List the merge blockers (files git reports as overwrite-blockers).
2. Cross-check against a whitelist of "known safe to reset" patterns.
3. If ALL blockers match the whitelist → reset them + retry merge.
4. If ANY blocker is OUTSIDE the whitelist → escalate per Phase A.

The whitelist starts conservative:

```
^apps/web/e2e/synthesized/.*\.spec\.ts$
^\.claude/models\.yaml$
^apps/api/prisma/data/.*\.db$
^apps/api/\.env$  (always gitignored; ignore)
```

### Phase C — tests (~30min)

3 new fix-bugs-loop tests:

1. Successful auto-merge → `status: "clean"`, master has the fix commits.
2. Auto-merge fails on whitelisted blocker → Phase B recovery resets + retries; merge succeeds.
3. Auto-merge fails on non-whitelisted blocker → Phase A escalation: `status: "auto-merge-failed"`, master unchanged, operator-facing error message present.

## Rejected Fixes

- **Always `git stash -u` before merge** — destructive; could lose operator-side WIP we don't know about. The whitelist approach is safer.
- **Make per-bug worktrees commit their intermediate state** — solves part of the problem but not the operator-side / runtime-artifact part. Doesn't address `.claude/models.yaml` drift.
- **Skip the merge entirely; operate from `fix/bugs-yaml-iter` exclusively** — would require the dev-server boot + the operator's mental model to change. Breaks `master` as the source-of-truth convention.
- **Just refuse to start the fix-loop if working tree is dirty** — too brittle; operators routinely have intermediate state. The dirty tree is the COMMON case.

## Validation Criteria

- [ ] FixBugsLoopResult gains an `auto-merge-failed` status variant
- [ ] When auto-merge fails on a non-whitelisted blocker, the orchestrator stdout summary surfaces the failure prominently (not a swallowed warning)
- [ ] When auto-merge fails on whitelisted blockers only, Phase B recovers (resets blockers + retries merge)
- [ ] FeatureGraphResult.status flips to `completed-with-integration-failures` when auto-merge fails
- [ ] 3 new fix-bugs-loop tests cover the three branches
- [ ] Empirical: re-run /fix-bugs on a project with intentionally dirty .claude/models.yaml; observe the warning becomes a recovery + retry; master ends up with the fix commits

## Cross-references

- **bug-058** — fixup-worktree-stale-base-vs-master. Related pattern: fix-loop's interaction with master is fragile. bug-058 fixed the FETCH side; bug-089 fixes the MERGE side.
- **bug-052 + bug-053 + bug-054 + bug-055 + bug-058** — the fix-bugs-loop worktree-lifecycle cluster. Bug-089 is the next logical extension: the FINAL git operation in the loop is also fragile.
- **feat-066 v2 epic** — the empirical metrics across this epic (~93% resolution) were partly hollow because the merge silently failed. Every prior site-review check by the operator was inspecting stale master.
- **bug-090 (companion)** — verifier-freshness gap: even if auto-merge succeeded, the verifier's dev-server boot might use a stale working-tree branch. Architecturally adjacent.

## Attempt Log

<!-- Populated by executing agents. -->
