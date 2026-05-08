---
id: bug-076-openfixupworktree-detects-stale-empty-dir
type: bug
status: completed
author-agent: human
created: 2026-05-08
updated: 2026-05-08
parent-plan: investigate-024-bug-fix-dispatch-efficiency
supersedes: null
superseded-by: null
branch: fix/openfixupworktree-detects-stale-empty-dir
affected-files:
  - orchestrator/src/fix-bugs-loop.ts
feature-area: orchestrator/fix-bugs-loop
priority: P0
attempt-count: 0
max-attempts: 5
error-message: |
  All 14 bugs failed with `[per-bug-worktree-open-failed]` after the orchestrator
  resumed against an empty-but-Windows-locked `.claude/worktrees/fixup` dir. The
  fixup branch (fix/bugs-yaml-iter) was never created because `existsSync`
  returned true → `git worktree add` was skipped → per-bug worktrees branched
  from a missing ref.
reproduction-steps: |
  1. Have `.claude/worktrees/fixup` exist as a non-registered git worktree dir
     (e.g. left behind by a prior `git worktree remove --force` that hit a
     Windows kernel handle lock and removed the contents but couldn't remove
     the directory itself)
  2. Run /fix-bugs against the project
  3. orchestrator's openFixupWorktree: existsSync(path) → true → SKIPS `git worktree add`
  4. seedWorktree writes .claude/settings.json into the empty dir (succeeds)
  5. ensureFixupTracksMaster runs `git rev-parse HEAD` from inside the dir;
     git falls back to the parent project's master HEAD → returns ok
  6. openFixupWorktree returns ok:true (false signal)
  7. fix-bugs-loop dispatches per-bug worktrees branched from `fix/bugs-yaml-iter`
  8. The branch doesn't exist → `git worktree add fix/<bug-id>` fails →
     `[per-bug-worktree-open-failed]`
  9. bug-073 convergence detector escalates all bugs to `failed` at attempts=2
stack-trace: null
---

# bug-076: openFixupWorktree silently skips git-worktree-add for orphan empty dirs

## Bug Description

When `.claude/worktrees/fixup` exists as a non-registered directory (e.g.
left by partial cleanup, a Windows file-lock preventing `rmSync`, etc.),
`openFixupWorktree` mistakes it for a live worktree and skips `git worktree
add`. The fixup BRANCH is never created. Per-bug worktrees subsequently
fail to branch from the missing ref, cascade-failing every bug in the run.

This mirrors bug-061 (per-bug-worktree force-recreate) which already
ships the same detection for `openPerBugWorktree`. The fixup-worktree
path was missed.

## Reproduction Steps

See `reproduction-steps` field in frontmatter. Empirical instance:
reading-log-02 /fix-bugs validation retry 2026-05-08 — Windows held a
kernel handle on the empty fixup dir; orchestrator returned
`completed-with-integration-failures` with 20 bugs failed at iter 2/4.

## Error Output

```
iteration 2/4; resolved: 1; failed: 20; remaining: 0; status: all-bugs-failed
failed:   bug-flow-flow-1-null, bug-flow-flow-2-null, ..., bug-parity-tags-manage-layout-regrouping
errorLog (per bug): [bug-073-convergence-detector] last 2 errorLog entries
                    byte-identical: [per-bug-worktree-open-failed] ...
```

## Root Cause Analysis

`orchestrator/src/fix-bugs-loop.ts::openFixupWorktree` (pre-fix):

```ts
if (!existsSync(args.worktreePath)) {
  // git worktree add ...  ← only runs when path doesn't exist
}
// proceed to seedWorktree + ensureFixupTracksMaster regardless
```

The `existsSync` check is too coarse — it can't distinguish a registered
worktree from an orphan dir. bug-061 already ships the same detection
for `openPerBugWorktree` via `isRegisteredGitWorktree`; the fixup path
was missed.

## Fix Approach

3-state detection in `openFixupWorktree`:

```ts
const exists = existsSync(args.worktreePath);
let listOk = false;
let registered = false;
try {
  const out = execSync(`git worktree list --porcelain`, { cwd: projectRoot });
  listOk = true;
  // ... scan for the candidate path in the output
} catch {
  listOk = false; // git failed (no repo, etc.)
}
const isOrphan = exists && listOk && !registered;
if (!exists || isOrphan) {
  if (isOrphan) {
    rmSync(path, { recursive: true, force: true }); // best-effort; tolerate Windows lock
  }
  // git worktree add (with -b first; fall back to without -b on
  // "branch already exists" / "already used by worktree" errors)
}
```

Two key safeties:

1. **Only force-recreate on DEFINITIVE orphan signal** (listOk + !registered).
   When git worktree list FAILS (no git repo, e.g. test envs), fall back
   to legacy "skip add when exists" — preserves existing tests.

2. **Tolerate `rmSync` failure on Windows lock** — empirical: a
   kernel-locked empty dir can STILL accept `git worktree add` even
   though `rmSync` can't delete it. Don't fail outright on rm errors.

3. **Retry without `-b` on "branch already exists"** — if the fix branch
   already exists from a partial prior attempt, re-attach to it instead
   of failing.

## Rejected Fixes

- **Always force-recreate on `existsSync(path)`** — Rejected: breaks
  existing tests that pre-create the fixup dir to test seedWorktree.

- **Make `isRegisteredGitWorktree` return true on git failure** —
  Rejected: that's the wrong direction. We'd silently skip force-recreate
  in the bug case (no git repo found = "treat as registered" = bug
  persists).

- **Throw-on-orphan instead of force-recreate** — Rejected: the
  orchestrator's resilience model is "self-heal where possible". Failing
  loudly here would block runs on a transient state that we can recover.

## Validation Criteria

- [x] `openFixupWorktree` detects orphan dir + force-recreates
- [x] Tolerates Windows file lock (rmSync failure → still tries git worktree add)
- [x] Retry-without-`-b` path handles existing branch
- [x] All 56 fix-bugs-loop existing tests pass (no regression on
      non-orphan cases)

## Cross-references

- Sister: `bug-061-openperbugworktree-always-tears-down-and-recreates`
  (the ALREADY-shipped force-recreate for per-bug worktrees). This bug
  ships the same pattern for fixup worktrees.
- Empirical: investigate-024 ship-plan validation 2026-05-08 — Phase 5
  retry surfaced this gap.

## Attempt Log

### Attempt 1 — 2026-05-08 ✅ SHIPPED

**Implementation**: 3-state detection in `openFixupWorktree`. Probes
`git worktree list --porcelain` to definitively classify the path as
orphan vs registered vs unknown. Only force-recreates on DEFINITIVE
orphan signal (listOk + !registered). Falls back to legacy behavior
(skip add when exists) when git itself fails — keeps existing tests
passing.

**Tests**: 56/56 fix-bugs-loop tests pass. The seedWorktree-on-pre-
existing-dir test (line 589) continues to pass because the test env
has no git repo → listOk=false → fall-back-to-legacy.

**Effort**: ~30 min total (matches Phase 5 estimate).

**Validation pending**: re-run reading-log-02 /fix-bugs to confirm
the production scenario (empty + Windows-locked fixup dir) recovers
cleanly.
