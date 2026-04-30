---
id: bug-031-fix-loop-fixup-worktree-not-seeded
type: bug
status: completed
author-agent: claude-opus-4-7
created: 2026-04-29
updated: 2026-04-29
completed-at: 2026-04-29
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/fix-loop-fixup-worktree-not-seeded
affected-files:
  - orchestrator/src/fix-bugs-loop.ts
  - orchestrator/src/invoke-agent.ts
  - orchestrator/tests/fix-bugs-loop.test.ts
feature-area: orchestration
priority: P0
attempt-count: 1
max-attempts: 5
error-message: "Builder dispatches inside the fix-bugs-loop's `fixup` worktree fail with `block-dangerous.sh` / `enforce-boundaries.sh` not-found errors and Write-permission denials, because `openFixupWorktree()` does `git worktree add` but does NOT call `seedWorktree()` (which is what per-feature worktrees in Mode B use). The fixup worktree therefore lacks `.claude/hooks/` and lacks the autonomous `permissions.allow` block — both of which `seedWorktree()` provisions for per-feature worktrees per bug-002."
reproduction-steps: "Run `pnpm --filter orchestrator start generate <project> --resume-feature-graph --pipeline-run-id <run-id> --bugs-yaml-mode=fresh` against any project that produces ≥1 bug from `/build-to-spec-verify`. The fix-loop opens the fixup worktree, dispatches a builder against the bug, and the builder reports permission/hook errors in `bugs.yaml.bugs[].errorLog[]` rather than fixing anything."
stack-trace: null
---

# bug-031 — `runFixBugsLoop`'s fixup worktree is not seeded with hooks + autonomous permissions

## Bug Description

The orchestrator's bug-fix loop (`orchestrator/src/fix-bugs-loop.ts`) opens a shared `fixup` git worktree at `<project>/.claude/worktrees/fixup` for every iteration's builder dispatches. Per-feature worktrees opened during Mode B feature build (`runFeature` path) are seeded by `seedWorktree()` in `orchestrator/src/invoke-agent.ts` — that helper:

1. Copies `.claude/hooks/` from the project root into the worktree (because `.claude/` is gitignored at `agenticVisibility: private` projects, so `git worktree add` does NOT bring hooks along).
2. Amends the worktree's `.claude/settings.json` with `permissions.allow: ["Write(*)", "Edit(*)", "MultiEdit(*)", "Bash(*)", "Read(*)", "Glob(*)", "Grep(*)"]` — the autonomous permissions block, scoped to the worktree only so the project root's restrictive human-mode settings stay in place.

`openFixupWorktree()` in `fix-bugs-loop.ts` does `git worktree add` but **does NOT call `seedWorktree()`**. The fixup worktree therefore:

- Has no `.claude/` directory at all (no hooks, no settings)
- Inherits the project root's restrictive permissions when settings.json is searched upward
- Triggers `PreToolUse` hooks that reference `$CLAUDE_PROJECT_DIR/.claude/hooks/<script>` — which resolve to scripts that don't exist (Claude Code's hook execution fails-closed → tool call denied)

**Empirical evidence (this session, 2026-04-29):**

After bug-030 Phase A shipped clean (`audit-app-reachability` flood reduced 62 → 0 false positives), the verify+fix-loop re-run on `repo-health-dashboard-01` produced exactly the 2 legitimate visual-parity bugs we expected. The fix-loop dispatched against them and both stalled at iteration 2 with the following error logs:

`bug-parity-about-layout-regrouping`:

> `[web-frontend-builder] File write operations blocked by security system: Read tool requires user permission grant (not auto-approved in this environment), git apply blocked by block-dangerous.sh hook for JSX content with braces/quotes, and large Node.js writes timeout. Cannot modify apps/web/app/about/page.tsx.`

`bug-parity-home-layout-regrouping`:

> `[web-frontend-builder] Environment blocked: working directory is the factory fixup worktree (C:\...\fixup) which lacks write permissions to project files. The hook scripts referenced in settings.json (block-dangerous.sh, enforce-boundaries.sh) do not exist at .claude/hooks/, causing all file write operations to fail with permission errors.`

Filesystem inspection of the fixup worktree confirms:

```
projects/repo-health-dashboard-01/.claude/worktrees/fixup/
  ├── node_modules/
  ├── package.json
  ├── packages/
  ├── pnpm-lock.yaml
  ├── pnpm-workspace.yaml
  ├── proposals/
  ├── schemas/
  ├── scripts/
  ├── tsconfig.json
  └── turbo.json
```

No `.claude/` directory. No hooks. No autonomous permissions block. The builder is trying to write to a sandbox that's misconfigured for autonomous use.

**Expected:** the fixup worktree is seeded identically to per-feature worktrees — `.claude/hooks/` copied in, `.claude/settings.json` amended with autonomous permissions — so builders dispatched against bugs can actually write fixes.

**Actual:** the fixup worktree is created via raw `git worktree add` and dispatched into without seeding. Builders correctly report the environmental failure but cannot recover.

## Reproduction Steps

1. Pick any project under `projects/` with at least one feature merged to master AND at least one bug pending in `docs/bugs.yaml` (or that will produce one when verify runs — e.g., a known visual-parity divergence).
2. From the factory root: `pnpm --filter orchestrator start generate <project> --resume-feature-graph --pipeline-run-id <run-id> --bugs-yaml-mode=fresh`
3. Wait for the verify stage to complete and write `docs/bugs.yaml`.
4. Wait for fix-loop iteration 1 to dispatch a builder.
5. Inspect `<project>/.claude/worktrees/fixup/.claude/` — does NOT exist.
6. Inspect `<project>/docs/bugs.yaml` after iteration 1 — `bugs[*].errorLog[]` reports permission/hook errors, not actual fix-attempt results.

Expected to reproduce on every project; the gap is in `openFixupWorktree()`, not in any project-specific config.

## Error Output

From `projects/repo-health-dashboard-01/docs/bugs.yaml` (2026-04-29 run, iteration 2):

```yaml
- id: bug-parity-about-layout-regrouping
  status: in-progress
  attempts: 2
  errorLog:
    - >-
      [web-frontend-builder] File write operations blocked by security system:
      Read tool requires user permission grant (not auto-approved in this
      environment), git apply blocked by block-dangerous.sh hook for JSX
      content with braces/quotes, and large Node.js writes timeout. Cannot
      modify apps/web/app/about/page.tsx. The about page requires: ...
- id: bug-parity-home-layout-regrouping
  status: pending
  attempts: 1
  errorLog:
    - >-
      [web-frontend-builder] Environment blocked: working directory is the
      factory fixup worktree (C:\...\fixup) which lacks write permissions to
      project files. The hook scripts referenced in settings.json
      (block-dangerous.sh, enforce-boundaries.sh) do not exist at
      .claude/hooks/, causing all file write operations to fail with
      permission errors. Cannot modify apps/web/app/page.tsx or
      packages/ui-kit/**/*.tsx ...
```

## Root Cause Analysis

`orchestrator/src/fix-bugs-loop.ts:127–156` (`openFixupWorktree`):

```ts
function openFixupWorktree(args: {
  projectRoot: string;
  worktreePath: string;
  branch: string;
}): { ok: true } | { ok: false; reason: string } {
  if (existsSync(args.worktreePath)) return { ok: true };
  mkdirSync(dirname(args.worktreePath), { recursive: true });
  try {
    execSync(
      `git worktree add ${shellQuote(args.worktreePath)} -b ${shellQuote(args.branch)}`,
      { cwd: args.projectRoot, stdio: "ignore" },
    );
  } catch (err) { ... }
  return { ok: true };
}
```

The function does `git worktree add` then returns `{ ok: true }`. It does NOT call the per-feature `seedWorktree()` from `invoke-agent.ts:572` — which is the helper that:

- Copies `<project>/.claude/hooks/` → `<worktree>/.claude/hooks/`
- Read-modify-writes `<worktree>/.claude/settings.json` to add `permissions.allow: ["Write(*)", "Edit(*)", ...]`
- Self-verifies that all 4 required hooks (`block-dangerous.sh`, `detect-loop.mjs`, `enforce-boundaries.sh`, `validate-brief.mjs`) exist in the worktree post-copy

`seedWorktree()` is called from `runFeature()` (Mode B feature builds) but is NOT invoked from `runFixBugsLoop()`. This is a clean gap, not a misuse — the helper exists and is correct; it just isn't wired into the fix-loop's worktree-creation path.

The two error logs surface the same root cause through different builder voices:

- About-page builder hit the hooks (which existed somehow — possibly Claude Code's upward search found the project's `.claude/settings.json` and resolved hooks against the project root, BUT the builder then tried `git apply` and `block-dangerous.sh`'s aggressive JSX pattern matching blocked it — see §Open Questions). The Read tool _also_ prompted because the worktree's settings.json doesn't have the autonomous `permissions.allow` block.
- Home-page builder concluded the hooks were missing entirely.

Both paths converge on: **the fixup worktree is not the same kind of object as a per-feature worktree, and downstream code wrongly assumes it is.**

## Fix Approach

### Phase A — Seed the fixup worktree (P0)

In `orchestrator/src/fix-bugs-loop.ts`, after the `git worktree add` succeeds in `openFixupWorktree()`, invoke `seedWorktree(projectRoot, worktreePath)`. Two implementation options:

**Option 1 — Export `seedWorktree` from `invoke-agent.ts`** and import in `fix-bugs-loop.ts`. Cleanest; the helper is already self-contained with a `SeedResult` discriminated-union return.

**Option 2 — Factor `seedWorktree` to a shared helper module** (e.g., `orchestrator/src/worktree-seed.ts`) and import from both `invoke-agent.ts` and `fix-bugs-loop.ts`. Slightly more refactoring but better dependency direction (utility doesn't live inside an "invocation" module).

Recommend Option 1 for first cut (smaller diff, easier review); consider Option 2 if a third call site emerges.

Failure handling: if `seedWorktree` returns `{ ok: false }`, propagate as a fix-loop iteration failure with `reason: "fixup-worktree-seed-failed"`. The loop should NOT silently dispatch builders into a half-seeded worktree.

### Phase B — Idempotency for already-existing fixup worktrees

`openFixupWorktree()` currently early-returns on `existsSync(worktreePath)` without re-seeding. After Phase A ships, also re-run `seedWorktree()` on every call (it's idempotent per the docstring). Reason: a fixup worktree that survived a prior orchestrator session may have stale `.claude/` content from a different factory revision; re-seeding refreshes it.

### Phase C — Investigate `block-dangerous.sh` JSX false-positive (deferred to investigate-NNN if reproducible)

The about-page errorLog mentions `git apply blocked by block-dangerous.sh hook for JSX content with braces/quotes`. After Phase A unblocks the fix-loop end-to-end, re-run and check whether legitimate JSX writes are still blocked. If yes, `block-dangerous.sh`'s pattern set needs narrowing (likely a `.{}` regex matching too broadly). Out of scope for this bug — file separately if the symptom persists.

### Phase D — Tests

Add a unit test in `orchestrator/tests/fix-bugs-loop.test.ts` (or sibling) that:

1. Mocks `git worktree add` (or stubs the seed result).
2. Calls `openFixupWorktree()`.
3. Asserts `<worktreePath>/.claude/hooks/` exists with all 4 required hooks.
4. Asserts `<worktreePath>/.claude/settings.json` parses + contains all required `permissions.allow` entries.

Cross-references the existing `invoke-agent.seedWorktree` test pattern (the seed helper already has tests; this is just covering the new wiring).

## Rejected Fixes

- **Bypass via SDK `permissionMode: "bypassPermissions"`** — would skip the permission gate entirely, but also disable hooks (which include the load-bearing `block-dangerous.sh`, `enforce-boundaries.sh`, and bug-022 PauseSignal hook). Loses safety+observability. Rejected.
- **Make settings.json's `permissions.allow` permissive at the project root** — works around the worktree gap but exposes interactive Claude Code sessions (when an operator opens the project for human review) to silent autonomous-grade writes. Project root must stay restrictive. Rejected per bug-002's original reasoning (the autonomous block is worktree-only by design).
- **Symlink `<project>/.claude` → `<worktree>/.claude`** — Windows symlink semantics are inconsistent (require admin rights for some configurations); also collapses the autonomous-permissions distinction. Rejected.
- **Defer hooks/settings provisioning to first dispatch** (lazy, idempotent on every builder invocation) — duplicates seed-checks across N builder calls per iteration, complicates failure semantics, and decouples seed-failure from worktree-create-failure (worse signal-to-noise for operator triage). Rejected; eager seeding at worktree-open time is correct.

## Validation Criteria

1. Fresh fixup worktree post-Phase-A contains `.claude/hooks/{block-dangerous.sh,detect-loop.mjs,enforce-boundaries.sh,validate-brief.mjs}` and `.claude/settings.json` with `permissions.allow` containing all 7 required entries.
2. Re-running `--resume-feature-graph --bugs-yaml-mode=fresh` on `repo-health-dashboard-01` (the empirical case) — builders dispatched against the 2 legitimate parity bugs no longer report "permission errors" or "hooks not found"; instead they either resolve the bug OR exhaust attempts with substantive error logs (e.g., "could not match mockup structure to current page layout").
3. Phase A's unit test passes.
4. No regression on per-feature worktree seeding (existing `invoke-agent.seedWorktree` tests still pass — the helper is unchanged, only the call site is added).
5. Idempotency: running `openFixupWorktree()` twice produces no different state on disk (Phase B).

## Open Questions

1. **Why did the about-page builder report the hooks DID run** (`block-dangerous.sh hook for JSX content with braces/quotes`) when the worktree has no `.claude/`? Two hypotheses: (a) Claude Code's upward `.claude/settings.json` search walked up to the project root + hooks resolved against the project's `.claude/hooks/` even though `$CLAUDE_PROJECT_DIR` was the worktree; (b) the builder's report is approximate / hallucinated based on the script's name visible in settings.json. Phase A's unit-tested fix should make this question moot, but worth verifying empirically.
2. **Should the fixup worktree's branch name (`fix/bugs-yaml-iter`) be timestamped/run-id-scoped?** Currently it's a fixed branch; a stale branch from a prior session might cause `git worktree add` to fail on a subsequent run. Open as `bug-NNN` if it surfaces.
3. **Cross-platform path normalization** — `seedWorktree()` uses Node's `path.join` which handles Windows separators. Worth a quick smoke-test on POSIX (CI Ubuntu) once Phase A lands.

## Cross-references

- `plans/archive/bug-002-worktree-missing-hooks-perms.md` (the original `seedWorktree` work — same problem class, scoped to per-feature worktrees only)
- `plans/archive/feat-026-automated-bug-fix-loop.md` (the fix-loop feature plan — silent on worktree seeding, which is the gap this bug exposes)
- `orchestrator/src/invoke-agent.ts` `seedWorktree()` at lines ~572-700 (the helper that needs to be invoked from fix-loop)
- `orchestrator/src/fix-bugs-loop.ts` `openFixupWorktree()` at lines ~127-156 (the call site that needs the fix)
- `plans/active/bug-030-audit-reachability-false-positive-flood.md` (sibling bug — bug-030 fixed the verify-stage flood; bug-031 fixes the fix-loop's downstream block; together they unblock the verify+fix-loop end-to-end)

## Attempt Log

### Attempt 1 — Phases A + B + D shipped 2026-04-29 (this session)

Three changes:

1. **`orchestrator/src/invoke-agent.ts`** — exported the previously-internal `seedWorktree()` function and `SeedResult` type (unchanged behavior; just the visibility modifier).
2. **`orchestrator/src/fix-bugs-loop.ts`** — restructured `openFixupWorktree()` to:
   - Phase A: invoke `seedWorktree(projectRoot, worktreePath)` after the worktree exists (whether freshly added OR pre-existing). Surface seed failures as `fixup-worktree-seed-failed: <detail> (<reason>)`.
   - Phase B: removed the early-return on `existsSync(worktreePath)`. Both fresh and pre-existing worktrees now flow through the seed step (idempotent — the helper preserves existing settings entries and only appends missing required ones).
   - Updated the function docstring to document why per-feature and fixup worktrees both need this seeding (the `agenticVisibility: private` gitignore on `.claude/`).
3. **`orchestrator/tests/fix-bugs-loop.test.ts`** — Phase D test added inside the existing `runFixBugsLoop — fixup worktree lifecycle` block. Pre-creates the fixup worktree dir (skipping the unfeasible `git worktree add` in test env), seeds the project's `.claude/hooks/{4 files}` + `.claude/settings.json`, runs the loop, and asserts post-conditions:
   - All 4 required hooks copied into `<worktree>/.claude/hooks/`
   - `<worktree>/.claude/settings.json` contains all 7 required `permissions.allow` entries (`Write(*)`, `Edit(*)`, `MultiEdit(*)`, `Bash(*)`, `Read(*)`, `Glob(*)`, `Grep(*)`)

Phase C (block-dangerous.sh JSX false-positive) deferred — to be filed as a separate bug if it reproduces post-Phase-A.

### Validation results

```
pnpm --filter orchestrator typecheck   → exit 0
pnpm --filter orchestrator test fix-bugs-loop  → 18/18 passing (incl. new test)
pnpm --filter orchestrator test                 → 568/568 passing across 26 files
```

No regressions on the existing per-feature `seedWorktree` callsite (the helper is unchanged; only visibility + an additional caller).

### Outcome

The fix-bugs loop's fixup worktree is now properly provisioned for autonomous builder dispatch. Combined with bug-030 Phase A (which fixed the verify-stage flood), the verify+fix-loop end-to-end is unblocked. Empirical validation against `repo-health-dashboard-01` is the next step — re-run `--resume-feature-graph --pipeline-run-id 6b5985b4-... --bugs-yaml-mode=fresh` and confirm builders dispatched against the 2 legitimate parity bugs report substantive results (success OR genuine fix-difficulty errors), not the prior permission/hook environmental errors.

### Lessons

1. **`agenticVisibility: private` is load-bearing context for any orchestrator path that creates a worktree.** `.claude/` gets gitignored at the project level, so worktrees never inherit it via git. Anything that runs Claude Code agents inside a worktree must explicitly seed the agentic layer. bug-002 closed this gap for per-feature worktrees but the contract wasn't documented as a generalizable rule — bug-031 is the second incident of the same class. Worth adding a guard rail: any new code path in `orchestrator/src/` that creates a worktree must call `seedWorktree()` (or be explicitly typed against a "no-agent-dispatch" worktree variant).
2. **The error log from the dispatched builder accurately diagnosed the environment.** Builders are good at reporting structural failures; treat the textual error log in `bugs.yaml.bugs[*].errorLog[]` as a primary diagnostic surface, not a secondary one. The two parity-bug error logs in this case described the bug exactly.
3. **Idempotent seed-on-every-open is cheap insurance against state drift.** Earlier `openFixupWorktree` early-returned on existence; this only worked when the worktree was always created in lockstep with the orchestrator revision. When sessions straddle a factory upgrade (common during active development), the worktree may have stale `.claude/` content. Phase B's "always re-seed" closes that without measurable cost.
