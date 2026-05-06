---
id: bug-060-worktree-cleanup-fails-windows-max-path
type: bug
status: completed
author-agent: human
attempt-count: 1
created: 2026-05-06
updated: 2026-05-06
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/worktree-cleanup-windows-max-path
affected-files:
  - orchestrator/src/fix-bugs-loop.ts
  - orchestrator/tests/fix-bugs-loop.test.ts
feature-area: orchestrator/fix-bugs-loop
priority: P2
attempt-count: 0
max-attempts: 5
error-message: |
  `git worktree remove --force <path>` fails on Windows when nested
  node_modules paths exceed MAX_PATH (260 chars). The bug-fix
  worktree dir is left as an orphan after the merge cascade
  succeeds. bug-055 Phase A's orphan-recovery handles it on the
  next /fix-bugs run, but each persistent orphan wastes ~50-200MB
  of disk + clutters .claude/worktrees/.
reproduction-steps: |
  1. Run /fix-bugs <project> with --max-concurrent >= 2 on Windows.
  2. Per-bug worktrees install full node_modules (Next.js stack
     puts paths like .pnpm/next@15.../node_modules/next/dist/...
     past the 260-char limit).
  3. After merge cascade succeeds, closePerBugWorktree calls
     `git worktree remove --force <path>`.
  4. Observe stderr warning (post-bug-055): `[fix-bugs-loop]
     WARNING: per-bug worktree cleanup for fix/<bug-id> failed; dir
     at <path> may persist as orphan. Detail: ... Filename too long`
  5. Inspect `.claude/worktrees/` — orphan dir persists.
stack-trace: |
  Empirical from be56zlptr (2026-05-06):
    [fix-bugs-loop] WARNING: per-bug worktree cleanup for fix/bug-compile-tooling-pre-flight failed
    error: failed to delete '...': Filename too long

    [fix-bugs-loop] WARNING: per-bug worktree cleanup for fix/bug-parity-books-list-layout-regrouping failed
    error: failed to delete '...': Filename too long
---

# bug-060: Worktree cleanup fails on Windows MAX_PATH (Filename too long)

## Bug Description

After bug-055 Phase B's empty-merge guard + closePerBugWorktree's
successful merge cascade, the per-bug worktree should be cleanly
removed via `git worktree remove --force <path>`. On Windows, this
fails when the per-bug worktree's `node_modules/.pnpm/<package>@<version>/node_modules/<deep-path>`
exceeds the OS's 260-char MAX_PATH limit.

Empirical: 2 of 7 fix-bugs-loop dispatches hit this in this session
alone. Both completed bugs (compile-tooling-pre-flight,
books-list-parity) had their fix correctly land on master via the
fixup branch — but their per-bug worktree dirs persisted as orphans.

The bug-055 cross-cutting cleanup-noisy fix correctly surfaces the
failure as a stderr WARNING (vs. silent `catch {}` pre-fix). bug-055
Phase A then rm-rfs the orphan on the next /fix-bugs run when
openPerBugWorktree sees a dir-without-registration. So the system
self-heals over multiple runs — but each persistent orphan costs:

- ~50-200MB disk (node_modules + .pnpm cache)
- Visual clutter in `.claude/worktrees/` ls
- Confusing for operators inspecting state mid-pipeline

## Reproduction Steps

See frontmatter. Reproduce reliably on:

- Windows host (any version)
- Project using Next.js / React-Next stack (deep node_modules paths)
- /fix-bugs runs with maxConcurrent >= 2 (per-bug worktrees)

## Error Output

```
[fix-bugs-loop] WARNING: per-bug worktree cleanup for fix/bug-compile-tooling-pre-flight failed;
  dir at C:\Development\ps\claude\claude_\agentflow_phase2\projects\reading-log-01\.claude\worktrees\bug-compile-tooling-pre-flight
  may persist as orphan. Detail: Command failed: git worktree remove --force <path>
error: failed to delete '<path>': Filename too long
```

## Root Cause Analysis

Windows has two MAX_PATH layers:

1. **Win32 API default**: 260 chars. Most CLI tools (git included)
   use this layer by default and fail above it.
2. **NT API**: 32,767 chars. Accessible via `\\?\` prefix on Win32
   API calls, OR by enabling LongPathsEnabled in registry.

`git worktree remove --force` shells to Windows file deletion APIs
(probably DeleteFile / RemoveDirectory) without the `\\?\` prefix.
When pnpm-installed deep node_modules trees land deeper than
~260 chars from the worktree root, the deletion fails partway.

`closePerBugWorktree` in `orchestrator/src/fix-bugs-loop.ts:587-601`
catches the failure and emits the WARNING, but doesn't fall back
to a Node-side recursive delete that could use the long-path
prefix.

## Fix Approach

### Phase A — Node-side rmSync fallback (30min)

When `git worktree remove --force` fails AND we're on Windows AND
the failure message contains "Filename too long" / "path too long":

1. Run `git worktree prune` to unregister the worktree from
   git's metadata (cheap; doesn't touch the filesystem)
2. Use `fs.rmSync(path, { recursive: true, force: true, maxRetries: 3 })`
   for the actual filesystem removal. Node's `fs.rmSync` on Windows
   uses RemoveDirectoryW with long-path support when given an
   absolute path; should handle the deep node_modules.
3. If rmSync ALSO fails, fall through to the existing WARNING (no
   regression in behavior).

```ts
// in closePerBugWorktree, replace:
try {
  execSync(`git worktree remove --force ${shellQuote(args.worktreePath)}`, ...);
  execSync(`git branch -D ${shellQuote(args.branch)}`, ...);
} catch (err) {
  process.stderr.write(`[fix-bugs-loop] WARNING: ...`);
}

// with:
try {
  execSync(`git worktree remove --force ${shellQuote(args.worktreePath)}`, ...);
  execSync(`git branch -D ${shellQuote(args.branch)}`, ...);
} catch (gitErr) {
  const msg = String(gitErr instanceof Error ? gitErr.message : gitErr);
  // Windows MAX_PATH fallback (bug-060)
  if (process.platform === "win32" && /Filename too long|path too long/i.test(msg)) {
    try {
      // Unregister from git's metadata first.
      execSync(`git worktree prune`, { cwd: args.projectRoot, stdio: "ignore" });
      // Then delete the dir via Node's fs (handles long paths via NT API).
      rmSync(args.worktreePath, { recursive: true, force: true, maxRetries: 3 });
      try {
        execSync(`git branch -D ${shellQuote(args.branch)}`, { cwd: args.projectRoot, stdio: "ignore" });
      } catch {
        // Branch may have been auto-cleaned; non-fatal.
      }
    } catch (rmErr) {
      // Both git AND Node fs failed — surface the warning.
      process.stderr.write(
        `[fix-bugs-loop] WARNING: per-bug worktree cleanup for ${args.branch} failed (Windows MAX_PATH); ` +
          `git remove + fs.rmSync fallback both failed. Dir at ${args.worktreePath} persists. ` +
          `bug-055 Phase A will recover on next /fix-bugs run. Detail: ${rmErr instanceof Error ? rmErr.message : String(rmErr)}\n`,
      );
    }
  } else {
    // Non-MAX_PATH failure — original behavior.
    process.stderr.write(
      `[fix-bugs-loop] WARNING: per-bug worktree cleanup for ${args.branch} failed; ` +
        `dir at ${args.worktreePath} may persist as orphan. Detail: ${msg}\n`,
    );
  }
}
```

### Phase B — Tests (20min)

Hard to test the actual Windows MAX_PATH failure cross-platform.
Test the fallback path with a mock that simulates the git error:

1. `closePerBugWorktree on Windows MAX_PATH error → fs.rmSync
fallback + ok:true` — mock `execSync` to throw "Filename too long"
   on the `git worktree remove` call; verify rmSync is called +
   the worktree dir is removed.
2. `closePerBugWorktree on Linux/macOS path-too-long → no fallback,
surfaces WARNING as before` — same mock; verify the Windows-
   conditional branch doesn't fire.

### Phase C — Empirical re-validation

After ship, re-fire /fix-bugs reading-log-01. Expected: 0 leftover
`.claude/worktrees/bug-*/` dirs after a successful run on Windows.

### Cross-references

- `bug-055` cross-cutting cleanup-noisy — surfaces the failure
  (this bug fixes the underlying root cause)
- `bug-055` Phase A orphan-recovery — current self-heal mechanism
  (this bug eliminates the need for self-heal in the common case)

## Rejected Fixes

- **Enable Windows LongPathsEnabled registry setting** — Rejected:
  requires admin + machine-wide change; not portable to operators
  on locked-down corporate Windows.
- **Use rimraf package** — Rejected: same long-path semantics as
  Node's built-in `fs.rmSync` on modern Node (≥14). No reason to
  add a dep.
- **Pre-clean node_modules before git worktree remove** — Rejected:
  if node_modules is the cause, deleting it via `rm -rf` hits the
  same MAX_PATH issue. Putting Node's fs after git fails is the
  cleaner approach.

## Validation Criteria

1. New Windows MAX_PATH simulated test passes.
2. Existing closePerBugWorktree tests still pass (43+5 in
   fix-bugs-loop.test.ts).
3. Linux/macOS no-regression: WARNING fires unchanged on
   non-Windows path-too-long errors.
4. Empirical: post-ship /fix-bugs run on reading-log-01 (Windows)
   produces 0 leftover `.claude/worktrees/bug-*/` dirs.

## Attempt Log

(empty — plan filed by human 2026-05-06)
