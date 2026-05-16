---
id: bug-115-worktree-creation-blocked-by-pycache-lock
type: bug
status: approved
author-agent: human
created: 2026-05-16
updated: 2026-05-16
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/worktree-pycache-preflight
affected-files:
  - orchestrator/src/fix-bugs-loop.ts
  - orchestrator/src/git-agent.ts
  - .gitignore (project-level via /new-project template if not already present)
  - orchestrator/tests/fix-bugs-loop.test.ts
feature-area: orchestrator/fix-bugs-loop/per-bug-worktree
priority: P0
attempt-count: 0
max-attempts: 5
error-message: |
  git worktree add ... fix/bug-XXX fix/bugs-yaml-iter
  Preparing worktree (new branch 'fix/bug-XXX')
  error: unable to create file apps/api/src/api/upstream/__pycache__/test_tribes_source_edge_cases.cpython-313-pytest-8.4.2.pyc: File ...
  → 2nd attempt: fatal: a branch named 'fix/bug-XXX' already exists
  → bug-073-convergence-detector escalates to failed
reproduction-steps: |
  1. Run /build-to-spec-verify on a python-fastapi project (e.g. gotribe-tribe-directory). This boots uvicorn which generates apps/api/src/api/**/__pycache__/*.pyc files.
  2. uvicorn process may or may not be fully torn down by teardownDevServer; even if torn down, Windows may hold .pyc file handles briefly.
  3. Run /fix-bugs against pending bugs. Each per-bug dispatch calls git worktree add (orchestrator/src/fix-bugs-loop.ts openPerBugWorktree → git-agent.ts).
  4. git worktree add tries to populate the new worktree with the tracked tree, including tracked .pyc files. Windows file-lock blocks the write.
  5. First attempt fails with "unable to create file ... .pyc: File" — BUT the branch was already created server-side.
  6. Second attempt fails with "fatal: a branch named 'fix/bug-XXX' already exists".
  7. bug-073-convergence-detector compares last 2 errorLog entries; they match (both worktree-open failures); escalates to failed without exhausting maxAttempts.
  8. Bug-fixer NEVER RUNS against the bug. The bug isn't a product bug at all — pure infrastructure failure.
stack-trace: null
---

# bug-115-worktree-creation-blocked-by-pycache-lock: Windows .pyc file locks block per-bug worktree creation; 24 of 28 fix-loop dispatches fail without ever running the fixer

## Bug Description

`git worktree add` on Windows fails with `unable to create file ... .pyc: File ...` when Python `__pycache__/*.pyc` files are TRACKED in the project AND held by a lingering process (uvicorn from the verifier's pre-boot, pytest from a prior run, etc.). The first failed attempt leaves a partial branch behind; the second attempt fails with `branch already exists`. bug-073-convergence-detector sees two near-identical errors + escalates to failed.

**Critical impact:** 24 of 28 fix-loop dispatches on gotribe-tribe-directory 2026-05-16 round 3 failed at this stage. The bug-fixer never ran. ~$10-15 spent on a round that gained 1 actual fix because 24 dispatches died at worktree creation.

## Reproduction Steps

See frontmatter.

## Error Output

```
[per-bug-worktree-open-failed] git worktree add failed: Command failed:
git worktree add C:\...\projects\gotribe-tribe-directory\.claude\worktrees\bug-perceptual-tribe-directory-browse-the-mockup-shows-a-prominent-f
  -b fix/bug-perceptual-tribe-directory-browse-the-mockup-shows-a-prominent-f
  fix/bugs-yaml-iter
Preparing worktree (new branch 'fix/bug-perceptual-tribe-directory-browse-the-mockup-shows-a-prominent-f')
error: unable to create file apps/api/src/api/upstream/__pycache__/test_tribes_source_edge_cases.cpython-313-pytest-8.4.2.pyc: File
```

Second attempt:

```
fatal: a branch named 'fix/bug-perceptual-tribe-directory-browse-the-mockup-shows-a-prominent-f' already exists
```

Then:

```
[bug-073-convergence-detector] last 2 errorLog entries near-identical (first 200 chars match):
[per-bug-worktree-open-failed] git worktree add failed: Command failed: git work... —
escalating to failed without exhausting maxAttempts cap (saved 1 retry slot)
```

## Root Cause Analysis

Three independent issues compound:

1. **`.pyc` files reach the tracked git tree.** Project's `.gitignore` (or factory's `/new-project` template) doesn't catch `**/__pycache__/`. On Windows, pytest + uvicorn write .pyc files; if these aren't gitignored, they get committed (often by accident in early scaffolding). gotribe-tribe-directory's tree has `apps/api/src/api/**/__pycache__/*.pyc` tracked — confirmed by `git ls-files | grep __pycache__` (28 .pyc files).

2. **`git worktree add` on Windows can't overwrite locked .pyc files.** Even though `git checkout` normally handles this gracefully, worktree-add's lower-level write API fails on Windows file-locks. The fix is upstream — don't have .pyc tracked.

3. **Failed worktree-add leaves a half-created branch.** Second attempt's `git worktree add -b fix/X` fails because branch `fix/X` already exists from attempt 1's partial run. Should be detected and either reused or deleted before re-attempting.

bug-073 convergence-detector then sees `[per-bug-worktree-open-failed] git worktree add failed` twice in a row + escalates. The detector is doing its job (recognizing futile retry) but the underlying issue is the worktree creation, not the bug content.

## Fix Approach

Four patches, layered defense:

### Patch A — Project-level `.gitignore` template + audit

The factory's `/new-project` scaffold MUST include `**/__pycache__/` + `*.pyc` + `*.pyo` in the project-root `.gitignore`. Check `.claude/skills/new-project/SKILL.md` template generation; if missing, add. Plus: add an audit script `scripts/audit-tracked-pycache.mjs` that the orchestrator runs as a pre-verify discriminator (cheap; ~10ms `git ls-files | grep -c __pycache__`) — if hits found, AUTO-FIX by emitting `git rm -r --cached path` for each tracked .pyc file + committing with message `fix(gitignore): untrack __pycache__ files (bug-115 auto-fix)`.

### Patch B — git-agent pre-flight cleanup in openPerBugWorktree

`orchestrator/src/fix-bugs-loop.ts openPerBugWorktree` (or wherever `git worktree add` is invoked for per-bug-worktrees): BEFORE calling worktree-add, run a pre-flight cleanup:

1. Walk `<projectRoot>/apps/api/` (if exists) + delete every `__pycache__/` directory (these are runtime build artifacts, safe to delete; gitignore should keep them out but defense-in-depth).
2. Run `git ls-files apps/api/**/__pycache__/*.pyc` — if any tracked .pyc surfaces, log a warning + propose Patch A's auto-fix.

### Patch C — Branch-already-exists recovery on 2nd attempt

`orchestrator/src/fix-bugs-loop.ts openPerBugWorktree` retry handler: when the second-attempt error stderr matches `/^fatal: a branch named '.*' already exists/`, detect the stale branch + delete it (`git branch -D fix/bug-X`) + retry the worktree-add. Don't escalate to failed on this specific sub-class. Today the convergence-detector escalates because both attempts surface "worktree-open-failed" with same first-200-chars — but they're actually DIFFERENT errors (one is file-lock, one is stale-branch); the detector's character-prefix match is too coarse for this case.

### Patch D — Convergence-detector signature granularity

`bug-073-convergence-detector` (probably in `orchestrator/src/fix-bugs-loop.ts` or sibling): when detecting "near-identical errors", consider the error CLASS (e.g. `per-bug-worktree-open-failed`) separately from the underlying CAUSE in stderr. Today's check uses first-200-chars prefix-match; this conflates `unable to create file ... .pyc: File` (resolvable infra issue) with `branch already exists` (resolvable cleanup issue) under one class. The detector should EITHER:
(a) require ≥3 truly-identical errors before escalating (give Patches A/B/C a chance to recover), OR
(b) deeper signature match that distinguishes file-lock vs stale-branch.

Patch D is the smallest immediate fix; Patches A+B+C are the proper root-cause fixes.

## Rejected Fixes

- **R1 — Suppress worktree-add stderr + retry forever.** Rejected: convergence-detector exists for a reason; some failures ARE genuine. Better to fix the underlying classes.

- **R2 — Move per-bug worktrees to a different filesystem location to dodge file locks.** Rejected: same Windows process holds the lock regardless of where the destination is. The lock is on the file in the tracked tree, not the worktree.

- **R3 — Kill any python.exe / uv.exe processes before worktree-add.** Rejected: too invasive, may kill processes the operator started intentionally. Patch B's cleanup is sufficient — even if uvicorn is still alive, deleting the .pyc directory removes the file lock target.

## Validation Criteria

- [ ] Patch A: `.claude/skills/new-project/SKILL.md` scaffold produces a project with `**/__pycache__/` in `.gitignore`. Existing gotribe-tribe-directory project: audit script identifies the 28 tracked .pyc files + emits the auto-fix.
- [ ] Patch B: openPerBugWorktree pre-flight deletes apps/api/\*\*/**pycache**/ before worktree-add. Regression test: seed tracked .pyc file + assert post-pre-flight tree has no **pycache** dirs.
- [ ] Patch C: 2nd-attempt with stale branch detected + branch deleted + retry succeeds. Regression test: seed scenario where 1st attempt leaves orphan branch + 2nd attempt should succeed (not escalate).
- [ ] Patch D: bug-073-convergence-detector requires ≥3 truly-identical errors OR distinguishes failure sub-classes.
- [ ] After ship: re-run /fix-bugs on gotribe-tribe-directory. The 24 perceptual failures should ALL proceed past worktree-add (whether they ultimately resolve or fail on real product issues is downstream of this fix).

## Cross-references

- bug-116 (sibling, filed same session) — the OTHER class of failure from gotribe-tribe-directory round 3 (affectsFiles glob mismatch). Both bugs share the same empirical motivator + ship-together flavor.
- bug-073 convergence-detector — the existing detector that escalates near-identical errors. Patch D refines its signature match.
- bug-060 (archived?) — Windows worktree-removal permission denied. Related class; both about Windows + git worktree + file locks.

## Attempt Log

(empty — to be populated when implementation runs)
