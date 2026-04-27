---
id: bug-005-windows-quoting-and-default-branch
type: bug
status: completed
approved-at: 2026-04-26
approved-by: human
author-agent: claude-opus-4-7
created: 2026-04-26
updated: 2026-04-26
completed-at: 2026-04-27
parent-plan: bug-004-agent-output-format-schema
supersedes: null
superseded-by: null
branch: fix/windows-quoting-and-default-branch
affected-files:
  - orchestrator/src/invoke-agent.ts
  - orchestrator/tests/invoke-agent.test.ts
feature-area: orchestration
priority: P0
attempt-count: 1
max-attempts: 5
error-message: |
  - "auto-commit warning for feat-bootstrap/<agent>: git commit failed: error: pathspec '<task-id>' did not match any file(s) known to git"
  - "feat-bootstrap — merge-conflict exhausted after 3 attempts; emergency-abort fired"
reproduction-steps: |
  1. Apply bug-002, bug-003, bug-004 fixes
  2. Run on Windows (cmd.exe) with a project whose default branch is `master` (older git default)
  3. /start-build kanban-webapp --resume-feature-graph --max-concurrent=1 --auto-merge-after-reviewer
  4. Observe: every auto-commit fails with task IDs as pathspecs; close-feature can't find `main` branch; merge-conflict retries exhaust; emergency-abort fires; $8.64 burned per run
stack-trace: null
---

# bug-005 — Windows shell-quoting in auto-commit + hardcoded `main` branch in close-feature

## Bug Description

**Expected:** after a builder/tester/reviewer agent successfully completes a task, `commitWorktreeChanges` (`feat-018`) creates a commit on the feature branch with a meaningful message. After the agent_sequence completes, `runCloseFeature` merges those commits into the project's default branch.

**Actual on Windows + `master`-default projects:**

1. **Auto-commit fails for every task on Windows.** `commitWorktreeChanges` builds a shell command like `git commit -m '<message>'` and passes it to `child_process.exec`. On Windows `cmd.exe`, single quotes are **literal characters**, not string delimiters. The shell parses `'feat(scaffold-next-app, state-shell-localstorage): ...'` as multiple separate arguments — git takes `-m` plus the next bare token as the message, then treats the rest (the task IDs) as **pathspecs**. Every commit fails with `error: pathspec '<task-id>' did not match any file(s) known to git`. Worse: the failure is non-fatal (per feat-018), so the orchestrator continues agent_sequence + emits warnings only.

2. **Close-feature hardcodes `main` and trips on `master`-default projects.** `runCloseFeature` references `main` in four places: `git fetch origin main`, `git rev-parse main`, `git checkout main`, and the merge target. The kanban-webapp project (and many others initialized with older git defaults on Windows) uses `master`. Result: `git rev-parse main` fails → `mainSha` stays null → feat-018's defensive `feature-no-commits` guard MISFIRES (it requires non-null mainSha to compare against branchSha). The orchestrator falls through to `git checkout main`, which fails with "did not match any file or branch" → the catch path at invoke-agent.ts:478-490 returns `conflict: true` with `<checkout-main-failed>: ...` as the conflictingFile. The merge-conflict retry loop fires resolve-conflict-handoff agents 3 times trying to "resolve" a phantom conflict. Each retry burns ~$1-2 in dispatched agent calls. Total wasted budget per failed feature: $4-5.

Combined effect on the kanban-webapp validation re-run 2026-04-26 ~01:24Z UTC (pipeline run `2cf29109-8735-4fa9-bbc3-3e6377ec9d0f`, total burn $8.64):

- web-frontend-builder, tester, reviewer all executed successfully (bug-002/003/004 fixes confirmed working)
- Real apps/web/ scaffold + tests + e2e + coverage all written to the worktree
- 0 commits ever landed on the feature branch (every auto-commit hit bug-005a)
- close-feature went into the wrong path (bug-005b), exhausted resolve-conflict-handoff retries, emergency-abort fired
- All 9 dependent features cascaded to aborted

**Both bugs are latent on Linux+main. Both surface together on Windows+master.** Tests didn't catch either because they stub execGit with regex pattern matching — the production shell-string-to-cmd.exe parsing path is never exercised, and the hardcoded "main" string matches the test's stubbed responses.

## Reproduction Steps

1. Apply bug-002 fix (commit `ff58d27`), bug-003 fix (`0d5a84d`), bug-004 fix (`37a9567`)
2. On Windows (cmd.exe shell), with a project whose default branch is `master`:
3. Run `/start-build <project> --resume-feature-graph --max-concurrent=1 --auto-merge-after-reviewer`
4. Observe orchestrator exit:
   - 3 auto-commit warnings (one per agent in agent_sequence) with `pathspec '<task-id>' did not match any file(s) known to git`
   - `<feature> — merge-conflict exhausted after 3 attempts; emergency-abort fired`
   - All dependent features aborted
   - Total cost ~$8 (versus expected ~$3-5 for a successful first feature)

## Error Output

From the orchestrator exit (2026-04-26 ~01:24Z UTC, pipeline run `2cf29109-8735-4fa9-bbc3-3e6377ec9d0f`):

```
[runFeature] auto-commit warning for feat-bootstrap/web-frontend-builder: git commit failed: error: pathspec 'scaffold-next-app,' did not match any file(s) known to git
error: pathspec 'state-shell-localstorage' did not match any file(s) known to git

[runFeature] auto-commit warning for feat-bootstrap/tester: git commit failed: error: pathspec 'bootstrap-tests' did not match any file(s) known to git

[runFeature] auto-commit warning for feat-bootstrap/reviewer: git commit failed: error: pathspec 'bootstrap-review' did not match any file(s) known to git

Features completed: 0
Features failed:    10
Total cost:         $8.64

Failed features:
  ✗ feat-bootstrap — merge-conflict exhausted after 3 attempts; emergency-abort fired
```

Filesystem evidence (the agents DID work; only the git-glue failed):

```
$ ls projects/kanban-webapp/.claude/worktrees/feat-bootstrap/apps/web/
app/ components/ coverage/ e2e/ lib/ next-env.d.ts next.config.ts node_modules/
package.json playwright.config.ts postcss.config.mjs src/ tailwind.config.ts
test-results/ tsconfig.json tsconfig.tsbuildinfo vitest.config.ts

$ cd projects/kanban-webapp && git branch --show-current
master    ← project's default; orchestrator hardcoded "main" everywhere
```

## Root Cause Analysis

### Bug-005a: Windows shell-quoting in `commitWorktreeChanges`

`orchestrator/src/invoke-agent.ts:1054-1055`:

```ts
// Replace single quotes with backticks so the shell-quoted -m argument
// can't be broken by a stray apostrophe in the message.
const safeMsg = message.replace(/'/g, "`");
const commit = await safeExec(exec, `git commit -m '${safeMsg}'`, cwd);
```

This works on bash/zsh where `'...'` is a string literal. On Windows `cmd.exe`:

- Single quotes are not delimiters; they're literal characters
- The token `'foo` and `bar'` would each be passed as separate arguments to git
- `git commit -m 'feat(scaffold-next-app, state-shell-localstorage): ...'` becomes:
  ```
  argv: ["git", "commit", "-m", "'feat(scaffold-next-app,", "state-shell-localstorage):", "...:", "..."]
  ```
- Git takes `-m` + the next arg as message, then treats the remainder as PATHSPECS — hence the per-task-id "did not match any file(s)" errors

The `safeMsg.replace(/'/g, "`")` does nothing useful here — the message itself doesn't contain apostrophes; the breakage is from spaces/parens/commas inside the supposedly-quoted string.

### Bug-005b: Hardcoded `main` branch in `runCloseFeature`

`orchestrator/src/invoke-agent.ts:401-510`:

```ts
async function runCloseFeature(...) {
  // ...
  await execGit("git fetch origin main", projectRoot);                  // line 416
  // ...
  const mainRes = await execGit("git rev-parse main", projectRoot);    // line 434
  mainSha = mainRes.stdout.trim();
  // ... (defensive guard requires mainSha !== null)
  await execGit("git checkout main", projectRoot);                      // line 478
  await execGit(`git merge --no-ff ${shellQuote(branch)} -m "merge feat/${gitOp.featureId}"`, projectRoot);  // line 494
}
```

Four hardcoded references to `main`. The project's default branch comes from whatever `/new-project` (or the user's git defaults) decided. The factory operator's environment defaults to `master` (older Windows git default). Result: `git rev-parse main` fails → `mainSha` stays null → defensive guard at line 449 (`mainSha !== null && branchSha !== null && mainSha === branchSha`) silently doesn't trigger → orchestrator falls through to `git checkout main` which fails → conflict path returns `<checkout-main-failed>` as the conflictingFile.

### Why tests didn't catch either

The test suite stubs `execGit` via `makeExecGit`:

```ts
const execGit = makeExecGit([
  { match: /git fetch origin main/, stdout: "" },
  { match: /git checkout main/, stdout: "" },
  { match: /git merge --no-ff/, stdout: "Fast-forward\n" },
  // ...
]);
```

The stub matches against the production code's hardcoded `main` literally — so the regex matches, the stub returns success, the test passes. The production behavior on a `master`-default project is never exercised. Same for the shell-quoting: the stub never invokes a real shell, so cmd.exe-vs-bash differences are invisible.

This is a **classic "stubbed integration" gap**: unit tests guard against logic bugs but not platform/environment assumptions that only manifest at the OS-shell or git-CLI boundary.

## Fix Approach

Three phases. Phase 1 (Windows quoting) and Phase 2 (default branch detection) are independent fixes for the two underlying bugs; Phase 3 covers tests.

### Phase 1 — `commitWorktreeChanges` uses `git commit -F <tempfile>` (cross-platform)

File: `orchestrator/src/invoke-agent.ts:1033-1068`. Replace the shell-quoted `-m '<msg>'` path with a tempfile-backed `-F <path>` invocation:

```ts
// Pseudocode
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

export async function commitWorktreeChanges(
  cwd: string,
  message: string,
  exec: ExecGitFn = defaultExecGit,
): Promise<CommitResult> {
  // ... existing status + add ...
  const tmpDir = mkdtempSync(join(tmpdir(), "agentflow-commit-"));
  const msgPath = join(tmpDir, "COMMIT_MSG");
  writeFileSync(msgPath, message, "utf8");
  try {
    const commit = await safeExec(
      exec,
      `git commit -F ${shellQuote(msgPath)}`,
      cwd,
    );
    if (commit.code !== 0) {
      return {
        committed: false,
        warning: `git commit failed: ${commit.stderr}`,
      };
    }
    // ... existing rev-parse ...
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
```

`shellQuote` already exists in invoke-agent.ts and handles cross-platform path quoting. The tempfile approach has zero shell-meta-character escape concerns: git reads the file directly. Removes the broken `safeMsg.replace(/'/g, "`")` (which was already a no-op for the actual breakage cause).

### Phase 2 — `runCloseFeature` detects the project's default branch

File: `orchestrator/src/invoke-agent.ts:401-510`. Add a helper at the top of the file:

```ts
/**
 * Detect the project's default branch. Tries `main` (modern git default),
 * then `master` (older default), then falls back to whatever the project
 * is currently on (best effort for fresh inits with no merged branches yet).
 *
 * bug-005b: orchestrator was authored assuming `main` everywhere; older Windows
 * git defaults to `master`, breaking close-feature on most factory-test projects.
 */
async function detectDefaultBranch(
  projectRoot: string,
  execGit: ExecGitFn,
): Promise<string> {
  try {
    await execGit("git rev-parse main", projectRoot);
    return "main";
  } catch {
    /* main not present */
  }
  try {
    await execGit("git rev-parse master", projectRoot);
    return "master";
  } catch {
    /* master not present */
  }
  // Last-resort fallback: whatever HEAD is currently pointing at.
  try {
    const res = await execGit("git symbolic-ref --short HEAD", projectRoot);
    return res.stdout.trim() || "main";
  } catch {
    return "main"; // give up — caller will fail loudly downstream
  }
}
```

Then update `runCloseFeature` to call `const defaultBranch = await detectDefaultBranch(projectRoot, execGit);` once at the top, and replace all 4 hardcoded `main` references with `defaultBranch`. The `git fetch origin <branch>` should also use it; the catch path already ignores failure for local-only repos.

### Phase 3 — Tests

File: `orchestrator/tests/invoke-agent.test.ts`. Add tests covering:

- `commitWorktreeChanges` writes a tempfile and uses `-F <path>` (not `-m '<msg>'`); verify by inspecting the execGit call args
- `commitWorktreeChanges` cleans up the tempfile after success AND failure (no leaks)
- `commitWorktreeChanges` handles a multi-line message + special characters (parens, commas, apostrophes, backticks) without escaping concerns
- `runCloseFeature` calls `detectDefaultBranch` and uses the result in its 4 git ops
- `detectDefaultBranch`:
  - Returns `"main"` when `git rev-parse main` succeeds
  - Returns `"master"` when only `git rev-parse master` succeeds (main rejected)
  - Returns the symbolic-ref fallback when neither main nor master exists
  - Returns `"main"` as last-resort default if symbolic-ref also fails (fresh-init edge case)

Existing close-feature tests will need their stubs updated: the stub regex `/git rev-parse main/` etc. will be hit first by `detectDefaultBranch`'s probing — should still match because the production code asks main first. But add a sibling test where the stub responds to `git rev-parse main` with a thrown error and `git rev-parse master` with success → verify orchestrator picks master.

### Phase 4 — Validation re-run

After Phases 1-3 land:

1. Confirm `pnpm --filter orchestrator test` passes (existing 229 + new tests).
2. Re-fire `/start-build kanban-webapp --resume-feature-graph --max-concurrent=1 --auto-merge-after-reviewer` (after orphan worktree cleared).
3. Watch for: every per-task auto-commit succeeds → real commits on feat/bootstrap → close-feature detects `master` → merge succeeds → wave 2 unblocks → DAG progresses.
4. Best case: feat-bootstrap + 1+ downstream features merge autonomously to master = first verified autonomous Mode B feature = MVP exit signal.

## Rejected Fixes

- **Switch to double-quote escaping in commitWorktreeChanges (`git commit -m "..."`).** Rejected: Windows cmd.exe and PowerShell both handle double quotes, but escaping inner double quotes / backslashes / dollar signs differs between shells. Tempfile is portable and has zero escape concerns.

- **Use `child_process.spawn` with array args instead of `exec` with shell string.** Considered, rejected for now: would require refactoring `defaultExecGit`'s signature and the `ExecGitFn` type contract — touching every git-op call site. Tempfile is a smaller surgical change for this immediate fix; spawn migration could be a post-MVP refactor.

- **Force-rename the project's `master` branch to `main` during `/new-project`.** Rejected: rewrites operator's git environment, surprises users, and doesn't help projects already set up with `master`. The factory should adapt to whatever default the host environment uses.

- **Make the default branch a configurable field in architecture.yaml.** Considered, rejected for now: adds config surface for what should be auto-detected. If specific projects need an override later, we can add it then; YAGNI for the MVP exit goal.

- **Fix only Phase 1 (auto-commit) and let close-feature continue using `main`.** Rejected: the kanban-webapp validation run shows BOTH bugs need to fix together. Auto-commit fix alone leaves close-feature still hitting the master/main mismatch and burning $4+ per run on phantom conflict resolution.

- **Bundle the orphan-worktree cleanup gap (surfaced repeatedly during validation re-runs) into bug-005.** Rejected, defer to a follow-up bug. The leftover-feat-bootstrap-dir-blocks-next-run issue is a separate concern (Windows file-locking on node_modules, operator-permission-layer denial of `rm -rf`, no orchestrator-level orphan detection). Worth its own scoped plan; keeps bug-005 tight.

## Validation Criteria

- The original errors no longer occur: a fresh `/start-build kanban-webapp --resume-feature-graph --max-concurrent=1 --auto-merge-after-reviewer` produces:
  - 3 successful auto-commits per feature (one per agent in agent_sequence) with no `pathspec` errors
  - close-feature succeeds (or fails for a NEW reason — both prove bug-005 is structurally fixed)
- All 229 existing orchestrator tests still pass.
- New tests added for tempfile-based commit + `detectDefaultBranch`; pass.
- `pnpm --filter orchestrator typecheck` clean.
- `pnpm --filter @repo/orchestrator-contracts typecheck` clean (no contract changes expected, but defensive).
- Validation re-run produces ≥1 real commit on `feat/bootstrap` branch (verifiable via `git log feat/bootstrap` from the project root post-run).
- Best case: feat-bootstrap merges to master autonomously; cost forecast ~$3-5 (no wasted merge-conflict retries).

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->

### Attempt 1 — 2026-04-26 — claude-opus-4-7

**Tried (Phases 1, 2, 3; Phase 4 = validation re-run pending):**

- **Phase 1 — `commitWorktreeChanges` tempfile** (`orchestrator/src/invoke-agent.ts:1033-1080`): added imports for `mkdtempSync`, `tmpdir`. Replaced shell-quoted `git commit -m '<msg>'` with tempfile-backed `git commit -F <path>`:
  - `mkdtempSync(join(tmpdir(), "agentflow-commit-"))` creates an isolated dir per commit
  - Message written verbatim via `writeFileSync`
  - `git commit -F ${shellQuote(msgPath)}` — only the path needs shell-quoting (cross-platform safe)
  - `try/finally` ensures `rmSync(tmpDir, { recursive: true, force: true })` always fires, even on commit failure
- **Phase 2 — `detectDefaultBranch` helper + `runCloseFeature` updates** (`invoke-agent.ts:401-540`):
  - New `detectDefaultBranch(projectRoot, execGit)` — probe order: `main` → `master` → `git symbolic-ref --short HEAD` → literal `"main"` last-resort
  - `runCloseFeature` calls it once at top, stores in `defaultBranch` const
  - All 4 hardcoded `"main"` references replaced with `${shellQuote(defaultBranch)}` (or string concat for log message)
  - Conflict-path sentinel updated: `<checkout-${defaultBranch}-failed>` instead of `<checkout-main-failed>` for accurate diagnostic
- **Phase 3 — Tests**:
  - Updated 3 existing `commitWorktreeChanges` tests to match the new `-F <tempfile>` shape (regex `/git commit -F/` instead of `/git commit -m/`)
  - Replaced the obsolete "single-quotes-replaced-with-backticks" test with a new "shell-meta characters land verbatim via tempfile" test that uses the exact problematic message from the kanban-webapp run (`feat(scaffold-next-app, state-shell-localstorage): ... (don't break the shell)`) and verifies it's byte-identical in the tempfile
  - Added 2 tempfile-cleanup tests (success path + failure path) verifying `rmSync` fires
  - Added 2 `detectDefaultBranch`-via-`runCloseFeature` tests:
    - main fails → master succeeds → orchestrator uses master in fetch/checkout/merge
    - main + master + symbolic-ref all fail → falls back to literal "main"; subsequent checkout fails; conflict sentinel includes `checkout-main-failed`

**What happened:**

- First test run after Phase 1+2: 3 of the existing `commitWorktreeChanges` tests failed because they stubbed `git commit -m`. Updated stub regexes to `/git commit -F/`.
- Second test run after fixture updates: all 229 existing tests pass.
- Third test run after adding the 4 new bug-005 tests: **233/233 pass**.
- First typecheck: 2 errors in new tests at `fMatch[1].replace(...)` — TypeScript narrowing requires explicit check on the optional capture group. Fixed via `if (fMatch?.[1])` pattern (also caught one in the rewritten "single quotes" test).
- Final typecheck: clean. `pnpm --filter @repo/orchestrator-contracts typecheck` clean.

**Outcome:** Phases 1-3 implemented and verified at the unit-test level. Validation re-run on kanban-webapp pending — needs the orphan worktree dir cleared (user action) then a fresh `/start-build`. With both bugs fixed, this run should produce real commits on the feature branch AND have close-feature succeed against the project's actual `master` default.

**Lessons for future-claude:**

- **Stubbing `execGit` against literal command strings hides platform bugs.** The factory's orchestrator tests use `makeExecGit([{ match: /git commit -m/, ... }])` — the regex matches the production code's hardcoded string, so the test passes. The PRODUCTION shell behavior (cmd.exe vs bash, single-quote handling) is invisible to the test suite. To catch platform bugs at the orchestrator/git boundary, we'd either need real-git integration tests OR a stub that simulates shell argument splitting. Worth a separate plan post-MVP — for now, the lesson is "test fixtures must be skeptical of their own assumptions about cross-platform shell behavior".
- **Hardcoded branch names age badly.** The factory was authored when `main` was the modern default and `master` was being deprecated. But Windows + corporate environments + older git installs all still default to `master`. Detect-from-environment beats hardcode-and-pray. Worth grepping the codebase for other hardcoded branch references (e.g. CI configs, deploy scripts).
- **Two structural bugs can mask each other.** Bug-005a (failed commits → no commits on branch) hid bug-005b (close-feature can't find main → falls into conflict path) because the orchestrator never got far enough to try close-feature with REAL commits. Without pulling on the diagnostic thread (the auto-commit warning messages, the merge-conflict counter at 2, the project's actual default branch), it would be tempting to "fix" only one and assume the other works. Always inspect the FULL failure context, not just the headline error.

## References

- `plans/active/bug-004-agent-output-format-schema.md` — parent bug; this surfaced cheaply because bug-004's `extractStructuredOutput` enrichment let me see exactly what failed (auto-commit warnings reached stdout); the actual cause was downstream of the SDK's structured output.
- `plans/active/bug-003-builder-output-contract-mismatch.md` — grandparent
- `plans/active/bug-002-worktree-missing-hooks-perms.md` — great-grandparent
- `plans/active/feat-014-mvp-completion-autonomous-e2e.md` — MVP plan; bug-005 is the next-and-hopefully-last layer of the autonomous Mode B chain
- `plans/active/feat-018-mode-b-commit-discipline.md` — where `commitWorktreeChanges` was authored (Phase A) and `runCloseFeature`'s defensive guard was added (Phase B). Both got the latent bug-005a/b at the same time.
- `orchestrator/src/invoke-agent.ts:1033-1068` — `commitWorktreeChanges` (Windows-quoting bug)
- `orchestrator/src/invoke-agent.ts:401-510` — `runCloseFeature` (hardcoded-main bug)
- Validation re-run output (transient): `tasks/bttphh7yo.output` — the failed run that surfaced both bugs at $8.64
