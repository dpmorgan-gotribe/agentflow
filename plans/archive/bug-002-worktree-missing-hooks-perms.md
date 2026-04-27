---
id: bug-002-worktree-missing-hooks-perms
type: bug
status: completed
approved-at: 2026-04-25
approved-by: human
author-agent: claude-opus-4-7
created: 2026-04-25
updated: 2026-04-25
completed-at: 2026-04-27
parent-plan: feat-014-mvp-completion-autonomous-e2e
supersedes: null
superseded-by: null
branch: fix/worktree-missing-hooks-perms
affected-files:
  - orchestrator/src/invoke-agent.ts
  - orchestrator/src/feature-graph.ts
  - .claude/skills/git-agent/SKILL.md
  - .claude/skills/new-project/SKILL.md
  - orchestrator/tests/invoke-agent.test.ts
feature-area: orchestration
priority: P0
attempt-count: 1
max-attempts: 5
error-message: "Write/Edit/MultiEdit permissions are not in the allow-list of .claude/settings.json (feat-bootstrap worktree). Every Write and Edit call returned 'Claude requested permissions ... but you haven't granted it yet.' Additionally .claude/hooks/ does not exist, so the enforce-boundaries.sh and validate-brief.mjs PreToolUse hooks would also block writes."
reproduction-steps: |
  1. /new-project kanban-webapp (or any project)
  2. Walk Mode A through gates 1-5 (or use a project where these are already done)
  3. /start-build kanban-webapp --resume-feature-graph --max-concurrent=1 --auto-merge-after-reviewer
  4. Observe: feat-bootstrap fails after 3 attempts, all 9 dependent features abort, $5-7 burned, zero files written
stack-trace: null
---

# bug-002 — git-agent worktree creation omits .claude/hooks/ + permissions allow-list, blocking all autonomous Mode B writes

## Bug Description

**Expected:** when git-agent's `checkout-feature` op creates a worktree under `projects/<name>/.claude/worktrees/<feature-id>/`, the worktree should be a fully-functional agent execution environment — Write/Edit/MultiEdit calls should succeed, PreToolUse hooks should fire correctly, and the agent should be able to scaffold files into the worktree.

**Actual:** the worktree is created and registered (lockfile written, branch checked out from project main), but it is **non-functional for autonomous agent execution**:

1. **`.claude/hooks/` directory does not exist in the worktree.** The project root has all 4 hook scripts (`block-dangerous.sh`, `detect-loop.mjs`, `enforce-boundaries.sh`, `validate-brief.mjs`); the worktree's `.claude/` contains only `CLAUDE.md`, `models.yaml`, `settings.json`. The worktree's `settings.json` references `$CLAUDE_PROJECT_DIR/.claude/hooks/...` which resolves to non-existent paths, so every PreToolUse hook fails to execute → tool call blocked.

2. **`permissions.allow` block is absent from worktree's `settings.json`.** Even if hooks worked, the Claude Agent SDK defaults to requiring user approval on Write/Edit/MultiEdit unless an explicit allow-list grants them. In an autonomous Mode B context with no human available to approve, this becomes a hard deny.

The combination produces a silent-but-expensive failure mode: the agent's LLM round-trips succeed, the agent reasons about the task, attempts to call Write tools — and every single Write call returns a permission denial. The agent retries within its turn budget, exhausts the budget, and reports `taskStatus: failed` to the orchestrator. The orchestrator retries the task (per refactor-004 retry ladder, max 3 attempts), each retry repeats the same failure mode, and the feature is marked failed. Every other feature in the DAG that `depends_on` the failed feature is then aborted automatically (per `feature-graph.ts:678-695`).

## Reproduction Steps

1. `/new-project <name>` (or use any project with completed Mode A through gate 5)
2. Walk Mode A through gates 1-5 — produce `docs/tasks.yaml`, `.claude/architecture.yaml`, `docs/credentials-confirmed.txt: proceed`
3. `/start-build <name> --resume-feature-graph --max-concurrent=1 --auto-merge-after-reviewer` (or any flag combination)
4. Observe `task-retry: feat-bootstrap/scaffold-next-app: 3` after ~30 minutes, $5-7 spent, zero files written to the worktree
5. Final orchestrator report: `Features completed: 0`, `Features failed: 10`

**Reproduction project for this report:** `projects/kanban-webapp/` on 2026-04-25 ~21:53Z, pipeline-run `ee2b2a72-b3ea-4c66-ab49-5a8a9532386c`, total burn $6.52.

## Error Output

From the orchestrator's structured exit report (buffered through pnpm/tsx, flushed only at process exit):

```
Project: C:\Development\ps\claude\claude_\agentflow_phase2\projects\kanban-webapp
Completed stages (9): analyze, skills-audit-design, mockups, stylesheet, screens, visual-review, user-flows, architect, pm
Pending stages   (3): skills-audit-build, register-mcp-build, git-agent-bootstrap
Resume from: skills-audit-build
Features completed: 0
Features failed:    10
Total cost:         $6.52
✗ feat-bootstrap — task scaffold-next-app failed after 3 attempts: Write/Edit/MultiEdit permissions are not in the allow-list of .claude/settings.json (feat-bootstrap worktree). Every Write and Edit call returned 'Claude requested permissions ... but you haven't granted it yet.' Additionally .claude/hooks/ does not exist, so the enforce-boundaries.sh and validate-brief.mjs PreToolUse hooks would also block writes. Remediation: add "Write(*)", "Edit(*)", "MultiEdit(*)" to permissions.allow in pro...(truncated)
✗ feat-board-core — dependency feat-bootstrap failed
✗ feat-card-detail — dependency feat-board-core failed
✗ feat-multiple-boards — dependency feat-board-core failed
✗ feat-filter — dependency feat-board-core failed
✗ feat-settings-data — dependency feat-bootstrap failed
✗ feat-theme — dependency feat-bootstrap failed
✗ feat-keyboard-shortcuts — dependency feat-board-core failed
✗ feat-not-found — dependency feat-bootstrap failed
✗ feat-a11y-polish — dependency feat-board-core failed
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  orchestrator@0.1.0 start: `tsx src/cli.ts "generate" "kanban-webapp" "--resume-feature-graph" "--max-concurrent=1" "--auto-merge-after-reviewer"`
Exit status 1
```

Filesystem evidence at the time of post-mortem (2026-04-25 ~22:34Z):

```
$ ls projects/kanban-webapp/.claude/worktrees/feat-bootstrap/.claude/
CLAUDE.md
models.yaml
settings.json

$ ls projects/kanban-webapp/.claude/worktrees/feat-bootstrap/.claude/hooks/
ls: cannot access ...: No such file or directory

$ ls projects/kanban-webapp/.claude/hooks/
block-dangerous.sh
detect-loop.mjs
enforce-boundaries.sh
validate-brief.mjs
```

The worktree's `settings.json` (`projects/kanban-webapp/.claude/worktrees/feat-bootstrap/.claude/settings.json`) references hook scripts that don't exist:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash $CLAUDE_PROJECT_DIR/.claude/hooks/block-dangerous.sh"
          }
        ]
      },
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "bash $CLAUDE_PROJECT_DIR/.claude/hooks/enforce-boundaries.sh"
          },
          {
            "type": "command",
            "command": "node $CLAUDE_PROJECT_DIR/.claude/hooks/validate-brief.mjs"
          }
        ]
      },
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node $CLAUDE_PROJECT_DIR/.claude/hooks/detect-loop.mjs"
          }
        ]
      }
    ]
    // ...no `permissions` block at all
  }
}
```

## Root Cause Analysis

The defective code path is `handleCheckoutFeature` in `orchestrator/src/invoke-agent.ts:131-205`. After `git worktree add` succeeds, the function writes a lock file and returns success — but it does **not** seed the worktree with the runtime artefacts that the agent SDK needs to write code:

```ts
// orchestrator/src/invoke-agent.ts:159-196 (excerpted)
await execGit(
  `git worktree add ${shellQuote(worktreePath)} -b ${shellQuote(gitOp.branch)}`,
  projectRoot,
);
// ... (no .claude/hooks/ copy step)
// ... (no settings.json amendment for permissions.allow)
mkdirSync(dirname(lockfilePath), { recursive: true });
writeFileSync(lockfilePath, JSON.stringify(lock, null, 2), "utf8");
```

The reason `.claude/hooks/` doesn't appear in the worktree even though it exists at the project root is that the project-level `.gitignore` (driven by `agenticVisibility: private` from `/new-project`) **excludes** `.claude/hooks/` from git tracking. `git worktree add` only materializes tracked files — so `.claude/CLAUDE.md`, `.claude/settings.json`, `.claude/models.yaml` come along (they ARE tracked), but `.claude/hooks/` does not.

The permissions allow-list issue is independent: the project's source `settings.json` template (likely seeded by `/new-project` from `.claude/skills/new-project/SKILL.md`) never wrote a `permissions.allow` block in the first place. This worked for human-driven Claude Code sessions (where the user clicks "approve") but doesn't work for orchestrator-driven dispatch.

**Two structural gaps. Both must be closed in the same fix:**

| Gap                            | Where it lives                                                                                                               | What's missing                                                                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing hooks dir in worktree  | `orchestrator/src/invoke-agent.ts::handleCheckoutFeature`                                                                    | `cp -R <project>/.claude/hooks <worktree>/.claude/` (or symlink) after `git worktree add`                                                       |
| Missing permissions allow-list | Project's source `settings.json` (templated by `/new-project`) AND/OR worktree settings amendment in `handleCheckoutFeature` | `permissions: { allow: ["Write(*)", "Edit(*)", "MultiEdit(*)", ...] }` must be present in the worktree's settings.json that the agent SDK reads |

## Fix Approach

Combined approach — patch the worktree-creation runtime path (so existing projects work) AND amend the project-seeding template (so new projects ship correct from day one). Plus a companion debug-mode change to the per-task retry cap so the next failed run costs $2 instead of $6.

### Phase 1 — Runtime worktree hardening (`handleCheckoutFeature`)

File: `orchestrator/src/invoke-agent.ts:131-205`. Insert two new steps between the `git worktree add` call (line 161) and the lockfile write (line 196):

1. **Copy `.claude/hooks/` from project root into the worktree.** Use Node `fs.cpSync(src, dest, { recursive: true })` (Node ≥ 16.7). Source: `<projectRoot>/.claude/hooks`. Destination: `<worktreePath>/.claude/hooks`. If source doesn't exist, return a `CheckoutFeatureFailure` with a new `reason: "missing-project-hooks"` — the project itself is broken, not a worktree-creation issue.

2. **Amend the worktree's `.claude/settings.json` with a `permissions.allow` block.** Read the file, parse JSON, ensure `permissions.allow` exists as an array, and ensure these entries are present (idempotent — add only if missing):

   ```json
   "permissions": {
     "allow": ["Write(*)", "Edit(*)", "MultiEdit(*)", "Bash(*)", "Read(*)", "Glob(*)", "Grep(*)"]
   }
   ```

   The Bash/Read/Glob/Grep entries are belt-and-braces — most agent SDK defaults already permit them, but explicit-is-better-than-implicit eliminates the "is this denied at runtime?" debugging step we just paid $6.52 to learn. Write back the amended settings with stable JSON formatting (2-space indent, trailing newline).

3. **Self-verify before returning success.** Before writing the lockfile, assert:
   - `<worktreePath>/.claude/hooks/{block-dangerous.sh,detect-loop.mjs,enforce-boundaries.sh,validate-brief.mjs}` all exist (use `existsSync`)
   - `<worktreePath>/.claude/settings.json` parses as JSON and `permissions.allow` is an array containing at minimum `Write(*)`, `Edit(*)`, `MultiEdit(*)`

   On any failure, return `{ op: "checkout-feature", success: false, reason: "worktree-seed-failed", detail: "<what was missing>" }`. The orchestrator's existing checkout-feature failure path will mark the feature failed and abort dependents — same blast radius as a `branch-conflict`, but with a precise root-cause string.

### Phase 2 — DROPPED (post-recon revision 2026-04-25)

Original intent: amend `/new-project` SKILL.md to seed projects with `Write(*)`/`Edit(*)`/`MultiEdit(*)` in their root `settings.json`'s `permissions.allow`.

**Dropped because:** all 4 existing standby projects (book-swap, finance-track, repo-health-dashboard, kanban-webapp) already have a `permissions.allow` block — but it's deliberately restrictive (Read/Grep/Glob/specific Bash patterns only). The intent of those restrictive settings is **human-driven Claude Code sessions**: when a human runs `/analyze` etc. from the project root, every Write triggers an interactive approval prompt — that's the safety design. Adding `Write(*)`/`Edit(*)`/`MultiEdit(*)` to the project root would silently auto-approve every write in every human session, weakening the safety posture for the human-use case.

The clean separation is:

- **Project root `settings.json`** → stays restrictive (human use)
- **Worktree `settings.json`** → Phase 1 amendment adds Write/Edit/MultiEdit (autonomous use only)

So Phase 1 alone is the load-bearing fix. No project-root template change. No retroactive patches to standby projects (they get the amendment automatically when `/start-build` opens their worktrees).

Phase numbers below renumbered: original Phase 3 → Phase 2, etc.

For the `agenticVisibility: private` case (the default): `.claude/hooks/` stays gitignored at project level, so Phase 1's runtime copy remains the load-bearing mechanism for worktrees. We do NOT change the gitignore behavior — see Rejected Fixes (B).

### Phase 3 — Companion change: lower TASK_RETRY_CAP for fast-fail debug mode

File: `orchestrator/src/feature-graph.ts:190`.

Change `const TASK_RETRY_CAP = 3;` → `const TASK_RETRY_CAP = 1;` with this exact comment above it:

```ts
// Per-task retry cap. Set to 1 (fast-fail) during the autonomous-Mode-B
// stabilization phase (bug-002, 2026-04-25): the kanban-webapp run burned
// $6.52 retrying a hard write-permission denial 3× before the orchestrator
// gave up. Until Mode B has a clean end-to-end success on a real project,
// we'd rather pay $2 to discover a structural failure than $6. Restore to 3
// once the next /start-build run completes ≥1 feature autonomously and we've
// confirmed the retry path is exercising recoverable failures (transient API
// errors, etc.) rather than masking config gaps.
```

Leave `MERGE_CONFLICT_CAP = 3` unchanged — merge conflicts are inherently transient and 3 attempts is the right shape there.

### Phase 4 — Tests

File: `orchestrator/tests/invoke-agent.test.ts`. Add unit tests covering:

- Happy path: `checkout-feature` copies all 4 hook scripts and amends settings.json with the permissions block; self-verify passes; success returned.
- `permissions.allow` already contains the required entries → no-op (idempotent); success returned.
- `permissions.allow` exists but is missing some entries → entries added; success returned.
- `<projectRoot>/.claude/hooks/` doesn't exist → `success: false`, `reason: "missing-project-hooks"`.
- Settings.json malformed JSON → `success: false`, `reason: "worktree-seed-failed"` with detail.
- Self-verify trips because cpSync failed silently → `success: false`, `reason: "worktree-seed-failed"`.

Existing tests touching `handleCheckoutFeature` may need a stub-projectRoot fixture that includes a `.claude/hooks/` and a baseline settings.json. Use `os.tmpdir()` + uuid for isolated per-test scratch dirs; clean up in `afterEach`.

### Phase 5 — Validation re-run

After Phase 1-4 land:

1. Confirm `pnpm --filter orchestrator test` passes (existing 200+ suites + new ones).
2. Re-run `/start-build kanban-webapp --resume-feature-graph --max-concurrent=1 --auto-merge-after-reviewer`.
3. Watch for: `feat-bootstrap` worktree contains `.claude/hooks/` + `permissions.allow` block immediately after creation. Agent's first attempt actually writes files into `apps/web/`. Either feature completes (best case → MVP unblocked) OR fails for a different reason (which we then triage as a new bug — but at least it's a NEW signal, not the same wall).
4. If the run fails for a new reason, capture evidence into `docs/mvp-completion-report.md` and open a follow-up bug — TASK_RETRY_CAP=1 means we'll learn the new failure mode in ~$2, not $6.

## Rejected Fixes

- **(B) Move `.claude/hooks/` out of `.gitignore` so `git worktree add` brings them along naturally.** Rejected: `agenticVisibility: private` is a deliberate IP-protection feature — projects scaffolded with this default may be pushed to public repos by their owners, and exposing factory hook internals defeats the purpose. Reverting it would leak factory infrastructure to project consumers. Also doesn't solve the permissions allow-list problem (still needs a separate fix). The Phase 1 runtime copy keeps the privacy boundary intact.

- **Symlink `.claude/hooks/` instead of copying.** Rejected on Windows compatibility — symlinks require admin or Developer Mode on Windows, which is not a safe assumption for the factory's user base. `cpSync` is portable. The downside (drift if a project's hooks evolve mid-feature run) is mitigated by feat-graph rebuilding worktrees per feature anyway.

- **Make `permissions.allow` a runtime parameter passed to the SDK rather than a settings.json field.** Rejected: the SDK reads settings.json at session start; runtime parameters don't override it cleanly. Settings.json is the canonical surface and there's no benefit to splitting the source of truth.

- **Lower TASK_RETRY_CAP via env var instead of hard-coding 1.** Rejected for now — the hard-coded value with the WHY-comment is the lowest-friction debug-mode toggle. Once Mode B is stable we can promote it to a `models.yaml` field properly. Premature config surface for a value we expect to flip back to 3 within the next 1-2 weeks.

## Validation Criteria

- The original error no longer occurs: a fresh `/start-build kanban-webapp --resume-feature-graph --max-concurrent=1 --auto-merge-after-reviewer` produces ≥1 file in `projects/kanban-webapp/.claude/worktrees/feat-bootstrap/apps/web/` during the agent's first attempt.
- `task-retry` counter for `feat-bootstrap/scaffold-next-app` stays at `0` after a successful run (no retries needed because no permission denials).
- Worktree contains `.claude/hooks/` with all 4 hook scripts after `checkout-feature` completes.
- Worktree's `.claude/settings.json` contains a `permissions.allow` block listing at minimum `Write(*)`, `Edit(*)`, `MultiEdit(*)` (and any other tool surfaces builders need).
- Existing `orchestrator/tests/invoke-agent.test.ts` checkout-feature suites still pass; new test added for the hooks-copy + permissions-amendment behavior.
- A second autonomous run on a different project (e.g. `book-swap` or `repo-health-dashboard`) completes feat-bootstrap (or its equivalent first feature) without hitting the same write-denial wall.

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->

### Attempt 1 — 2026-04-25 — claude-opus-4-7

**Tried (Phases 1, 2, 3 of the approved plan; Phase 4 = validation re-run deferred):**

- **Schema (`packages/orchestrator-contracts/src/git-agent.ts`)**: extended `CheckoutFeatureFailure.reason` enum from `["branch-conflict", "stale-worktree"]` → `["branch-conflict", "stale-worktree", "missing-project-hooks", "worktree-seed-failed"]`. Added optional `detail: z.string()` for the new failure modes.
- **Phase 1 — `runCheckoutFeature` in `orchestrator/src/invoke-agent.ts`**: inserted `seedWorktree(projectRoot, worktreePath)` call between `git worktree add` success and lockfile write. New helper:
  - Validates `<projectRoot>/.claude/hooks/` exists; returns `missing-project-hooks` if not.
  - `cpSync(projectHooks, worktreeHooks, { recursive: true })` — copies all hook scripts into the worktree.
  - Reads worktree's `.claude/settings.json` (or seeds a fresh `{}` if absent), merges autonomous-mode entries (`Write(*)`, `Edit(*)`, `MultiEdit(*)`, `Bash(*)`, `Read(*)`, `Glob(*)`, `Grep(*)`) into `permissions.allow` idempotently (no duplicates), preserves existing entries + the `deny` block.
  - Self-verifies: re-reads + re-parses settings.json, asserts all 4 hook scripts exist + all 7 required allow entries are present. Any failure → `worktree-seed-failed` with a `detail` string.
- **Phase 2 (renumbered) — TASK_RETRY_CAP 3 → 1**: discovered the retry cap has TWO sources of truth — `TASK_RETRY_CAP` in `feature-graph.ts:190` (backup check inside the loop body) AND `RETRY_CAPS["task-retry"]` in `retry-counters.ts:34` (drives `isExhausted()`, the loop condition). Lowered both to 1 with matching WHY-comments referencing bug-002. The duplication is a code smell worth a separate refactor plan post-MVP.
- **Phase 3 — Tests**: in `orchestrator/tests/invoke-agent.test.ts`:
  - Added a `beforeEach` step seeding `<projectRoot>/.claude/hooks/` with the 4 stub scripts (so the existing happy-path checkout-feature test still passes).
  - Added 5 new tests under `describe("invokeAgent — checkout-feature seeds worktree (bug-002)")` covering: hooks copy, settings.json amendment, idempotent merge of pre-existing entries, missing-project-hooks failure, malformed-settings failure. Two of the 5 use a custom `execGit` (not `makeExecGit`) so the worktree dir + a project-style settings.json get materialized as a side-effect of `git worktree add` — mimicking real git behavior and avoiding the pre-flight stale-worktree check.
  - Updated `orchestrator/tests/feature-graph.test.ts:290` retry-cap assertion from `.toBe(3)` → `.toBe(1)` with a comment referencing bug-002.

**What happened:**

- First test run: 2 expected failures.
  - `invoke-agent.test.ts` happy-path tripped because the seeding step required `.claude/hooks/` in the test fixture — fixed via the beforeEach addition.
  - `feature-graph.test.ts` retry-cap test got value 2 instead of expected 1 — caught the `RETRY_CAPS` duplication; fixed by lowering it too.
- Second test run: still 1 failure on the retry-cap test (counter 2 vs expected 1) — the `RETRY_CAPS` change wasn't yet in.
- Third test run after the `RETRY_CAPS` fix: clean, 213/213.
- Fourth run after adding the 5 new tests: 2 failures in the new tests (pre-flight `stale-worktree` triggered because I pre-created the worktree dir before the existsSync check) — fixed by moving the seeding into a custom execGit that fires AFTER the existsSync check.
- Final run: **218/218 tests pass** (213 existing + 5 new). `pnpm --filter orchestrator typecheck` and `pnpm --filter @repo/orchestrator-contracts typecheck` both clean.

**Outcome:** Phases 1-3 implemented and verified at the unit-test level. Phase 4 (validation re-run on kanban-webapp) deferred to next session — needs `projects/kanban-webapp/.claude/state/<run-uuid>/` cleanup so the next run starts fresh, plus a fresh `/start-build` invocation. With TASK_RETRY_CAP=1, the next failed run will cost ~$2 not $6.

**Lesson for future-claude:**

- **Cap constants in this codebase often have two sources of truth.** When changing a retry cap, grep for ALL references — `RETRY_CAPS["..."]` AND any local `*_CAP = N` constants in other files. The TS type system doesn't catch this drift because both paths return numbers.
- **Test fixture realism matters for git-touching code.** The default `makeExecGit` stub treats `git worktree add` as a no-op shell command, but real git creates directories + materializes tracked files. When testing code that runs AFTER `git worktree add` and expects the worktree to exist, the stub must mimic that side effect (custom execGit closure) — otherwise either the production code or the test expectations end up wrong.
- **Defense-in-depth on permissions.** The `permissions.allow` block I added to the worktree includes `Bash(*)`, `Read(*)`, `Glob(*)`, `Grep(*)` even though most SDK defaults already permit them. The cost is ~5 extra entries per worktree settings.json; the benefit is eliminating "is this denied at runtime?" as a future debug step the next time something silent fails. $6.52 of yesterday's burn was spent learning that distinction.

## References

- `plans/active/feat-014-mvp-completion-autonomous-e2e.md` — parent MVP plan; Phase 4 of feat-014 is what surfaced this bug
- `plans/archive/feat-007-git-agent-implementation.md` — original git-agent worktree-creation design (predates the autonomous Mode B usage that exposed the gap)
- `plans/archive/feat-020-delete-project.md` Attempt 2 — surfaced an adjacent class of harness-permission gotcha (Bash `rm` denial), informs the remediation pattern of "always test the autonomous path, not just the human-driven path"
- `orchestrator/src/invoke-agent.ts:131-205` — `handleCheckoutFeature` (defective)
- `orchestrator/src/feature-graph.ts:678-695` — DAG drain logic that explains why one failed bootstrap aborts every dependent feature
- `.claude/skills/new-project/SKILL.md` — where the seeded settings.json for new projects is templated
- `.claude/skills/git-agent/SKILL.md` — git-agent skill definition; should document the worktree contract this bug violates
- Pipeline-run state for the failing run: `projects/kanban-webapp/.claude/state/ee2b2a72-b3ea-4c66-ab49-5a8a9532386c/counters.json` (preserved on disk for post-mortem evidence; safe to delete after fix lands)
