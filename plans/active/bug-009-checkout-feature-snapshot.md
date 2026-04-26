---
id: bug-009-checkout-feature-snapshot
type: bug
status: in-progress
approved-at: 2026-04-26
approved-by: human
author-agent: claude-opus-4-7
created: 2026-04-26
updated: 2026-04-26
parent-plan: bug-008-close-feature-dirty-root
supersedes: null
superseded-by: null
branch: fix/checkout-feature-snapshot
affected-files:
  - orchestrator/src/invoke-agent.ts
  - orchestrator/tests/invoke-agent.test.ts
feature-area: orchestration
priority: P0
attempt-count: 1
max-attempts: 5
error-message: "feat-bootstrap — merge-conflict exhausted after 3 attempts; emergency-abort fired (kit add/add conflicts: packages/ui-kit/{package.json, src/index.ts, src/lib/cn.ts})"
reproduction-steps: |
  1. Apply bug-002 through bug-008 fixes
  2. Take a copy of `kanban-webapp-pre-build` with uncommitted Mode A artifacts in project root
  3. /start-build <project> --resume-feature-graph --max-concurrent=N --auto-merge-after-reviewer
  4. checkout-feature creates worktree from b4c586c (init only — NO kit)
  5. Agent looks for `@repo/ui-kit` imports → kit "doesn't exist" → agent CREATES kit files in worktree → commits
  6. close-feature pre-flight (bug-008) commits pre-build's kit version to master
  7. Merge: master has kit-version-A, feat/<id> has kit-version-B → "AA" (add/add) conflicts on `packages/ui-kit/{package.json, src/index.ts, src/lib/cn.ts}`
  8. resolve-conflict-handoff can't resolve "both sides claim to be the original" 3 times → emergency-abort → branch deleted → ~$5 burn
stack-trace: null
---

# bug-009 — checkout-feature must snapshot project root BEFORE worktree creation (not at close-feature time)

## Bug Description

**Expected:** when `checkout-feature` creates a worktree, the worktree's working directory should reflect the FULL project state (init commit + any pre-existing uncommitted Mode A artifacts), not just the bare init commit.

**Actual:** `checkout-feature` calls `git worktree add ... -b feat/<id>` which branches from the project's current HEAD. If HEAD is at the init commit (`b4c586c`) and the project root has uncommitted Mode A artifacts (kit files, docs/, .env.example, etc.), the worktree starts BLANK — without any of those artifacts. The agent then tries to import from `@repo/ui-kit`, finds the kit "missing", and creates its own version of kit files. When close-feature later snapshots the project root's pre-existing kit to master (per bug-008 Phase 1), the merge sees TWO different versions of the same files added independently → "AA" (add/add) merge conflicts that resolve-conflict-handoff cannot trivially resolve.

**Bug-008 partially fixed the symptom but caused this new issue** by snapshotting in the wrong phase. The fix is to move the snapshot to checkout-feature time, BEFORE worktree creation, so the worktree branches from a kit-inclusive state.

## Reproduction Steps

1. Apply bug-002 (`ff58d27`) → bug-008 (`addaf6b`) fixes
2. Use `kanban-webapp-pre-build` or any project with uncommitted Mode A artifacts (the standard pre-build shape)
3. `/start-build <project> --resume-feature-graph --max-concurrent=N --auto-merge-after-reviewer`
4. Wait through the full agent_sequence (~30-60 min for feat-bootstrap)
5. close-feature pre-flight commits dirty state to master (bug-008 logging fires)
6. close-feature merge attempts → 3 "AA" / "UU" conflicts on `packages/ui-kit/{package.json, src/index.ts, src/lib/cn.ts}`
7. resolve-conflict-handoff dispatches 3× → all fail → emergency-abort → branch deleted → ~$5 burn

## Error Output

From kanban-webapp-03 run 2026-04-26 (run ID `bdy0sw5v5`, total cost $5.53):

```
[runCloseFeature] feature feat-bootstrap: project root has dirty/untracked state — auto-committing pre-merge snapshot to master.
[runCloseFeature] feature feat-bootstrap: merge failed.
conflictingFiles: packages/ui-kit/package.json, packages/ui-kit/src/index.ts, packages/ui-kit/src/lib/cn.ts
merge stdout: Auto-merging packages/ui-kit/package.json
CONFLICT (content): Merge conflict in packages/ui-kit/package.json
Auto-merging packages/ui-kit/src/index.ts
CONFLICT (add/add): Merge conflict in packages/ui-kit/src/index.ts
Auto-merging packages/ui-kit/src/lib/cn.ts
CONFLICT (add/add): Merge conflict in packages/ui-kit/src/lib/cn.ts
Automatic merge failed; fix conflicts and then commit the result.

<post-merge-failure-state>
projectRoot status:
M  .claude/settings.json
A  apps/web/.eslintrc.json
... (clean adds for apps/web/, packages/api-client/src/, packages/types/src/, packages/utils/src/)
UU packages/ui-kit/package.json    ← unresolved: both modified
AA packages/ui-kit/src/index.ts    ← unresolved: both ADDED
AA packages/ui-kit/src/lib/cn.ts   ← unresolved: both ADDED
A  packages/ui-kit/styles/globals.css
A  packages/ui-kit/tokens.ts
projectRoot HEAD: 69afb34
worktree HEAD: b643d71

Total cost: $5.53
✗ feat-bootstrap — merge-conflict exhausted after 3 attempts; emergency-abort fired
```

The `AA` (add/add) markers on `packages/ui-kit/src/index.ts` and `cn.ts` are the smoking gun — both master AND feat/bootstrap added the SAME path with DIFFERENT content. Git can't auto-resolve "both sides claim to be the original creator" — it requires human/agent judgment which version to keep.

## Root Cause Analysis

The problem is **temporal ordering**:

```
Current sequence (broken):
  1. checkout-feature: worktree branches from master (b4c586c, NO kit)
  2. Agent runs: kit "missing" → recreates it → commits to feat/<id>
  3. close-feature pre-flight: snapshots project root (which HAS pre-build kit) to master
  4. Merge: master kit-A vs feat/<id> kit-B → AA conflicts → emergency-abort

Intended sequence (this fix):
  1. checkout-feature pre-flight: snapshots project root to master FIRST
  2. checkout-feature: worktree branches from master (now kit-inclusive)
  3. Agent runs: kit EXISTS → imports from @repo/ui-kit per its prompt → does NOT recreate
  4. close-feature: clean merge (no conflicts)
```

The agent's behavior is actually correct given its inputs. The agent prompt explicitly says "NEVER re-implement a primitive the kit provides" — but the agent has no kit to consume because the worktree is empty. Its logical reaction: create the kit. Then conflicts inevitable.

**The orchestrator owns this contract.** It must ensure the worktree starts from a state where the kit + Mode A artifacts are present. The fix moves bug-008's auto-commit logic from close-feature (too late) to checkout-feature (right time).

## Fix Approach

Single-phase relocation: move bug-008's auto-commit logic from `runCloseFeature` to `runCheckoutFeature`, with two refinements.

### Phase 1 — Move snapshot to checkout-feature

File: `orchestrator/src/invoke-agent.ts::runCheckoutFeature`. Insert pre-flight BEFORE `git worktree add`:

```ts
// bug-009: snapshot dirty/untracked project root state to the current branch
// (typically master) BEFORE creating the worktree. This ensures the worktree
// branches from a state that includes pre-build's Mode A artifacts (kit, docs,
// configs) so the agent doesn't need to recreate them — eliminating the AA
// (add/add) merge conflicts that bug-008's close-feature pre-flight created
// by snapshotting AFTER the agent had already committed its own version.
try {
  const status = await execGit("git status --porcelain", projectRoot);
  if (status.stdout.trim() !== "") {
    console.warn(
      `[runCheckoutFeature] feature ${gitOp.featureId}: project root has dirty/untracked state — auto-committing snapshot before worktree creation.`,
    );
    await execGit("git add -A", projectRoot);
    const snapTmp = mkdtempSync(join(tmpdir(), "agentflow-snapshot-"));
    const snapMsg = join(snapTmp, "MSG");
    try {
      writeFileSync(
        snapMsg,
        `factory: project bootstrap snapshot before checkout-feature for ${gitOp.featureId}\n\nAuto-committed by orchestrator so the worktree branches from a state inclusive of pre-build Mode A artifacts (kit, docs, configs). Without this, agents see a blank worktree, recreate kit files independently, and merges hit AA (add/add) conflicts at close-feature time.`,
        "utf8",
      );
      await execGit(`git commit -F ${shellQuote(snapMsg)}`, projectRoot);
    } finally {
      rmSync(snapTmp, { recursive: true, force: true });
    }
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  return {
    op: "checkout-feature",
    success: false,
    reason: "worktree-seed-failed", // existing schema enum entry
    detail: `pre-worktree snapshot failed: ${msg}`,
  };
}
```

This runs BEFORE the existing `git worktree add` command. Uses the bug-005a tempfile pattern (Windows-safe) and the same idempotent "skip if clean" semantics as bug-008.

### Phase 2 — Remove (or keep as defense-in-depth) close-feature pre-flight

The bug-008 close-feature pre-flight is now structurally REDUNDANT — checkout-feature has cleaned the project root before the worktree was even created, so by close-feature time everything should already be committed.

Options:

- **A:** Remove the close-feature pre-flight entirely. Simpler code; trusts checkout-feature.
- **B:** Keep as defense-in-depth. Detects edge cases (e.g., manual operator edits to project root mid-run) and snapshots them too. No-ops in the normal case.

**Recommend B** — defense-in-depth is cheap (single git status check; skipped if clean), and protects against operator-introduced state between checkout and close. Add a comment documenting that bug-009 made checkout-feature the primary path.

### Phase 3 — Tests

File: `orchestrator/tests/invoke-agent.test.ts`. Add tests:

- checkout-feature with dirty project root → snapshot commit fires BEFORE `git worktree add` (verify call order)
- checkout-feature with clean project root → no snapshot, just worktree add (back-compat)
- checkout-feature snapshot commit failure → returns `worktree-seed-failed` reason
- Existing checkout-feature tests need `git status --porcelain` clean stub added

### Phase 4 — Validation re-run

After Phases 1-3 land:

1. Re-run `/start-build kanban-webapp-04 --resume-feature-graph --max-concurrent=3 --auto-merge-after-reviewer`
2. Watch for: checkout-feature snapshot warning fires once (or per worktree); `git worktree add` runs against post-snapshot HEAD; agent sees existing kit; agent imports from `@repo/ui-kit` (doesn't recreate); close-feature merge is CLEAN; master moves past snapshot to a real merge commit; wave 2 unblocks
3. **Best case: first true autonomous Mode B feature merge ever. MVP exit signal.**

## Rejected Fixes

- **Have the agent always assume kit doesn't exist + always recreate it** (so master snapshot can be skipped). Rejected: the kit IS the artifact of /stylesheet (gate 3). Recreating it loses design-system fidelity, breaks kit-version pinning, and violates the agent prompt that explicitly says "NEVER re-implement a primitive the kit provides".

- **Have close-feature DELETE the pre-existing kit from master before merging** (so feat/<id>'s version "wins"). Rejected: destructive — loses pre-build's intentional kit content. Even if equivalent, the resulting commit history would be confusing.

- **Update the agent prompt to detect "missing kit" and emit a kit-change-request** instead of recreating. Rejected: that path exists for missing PRIMITIVES (specific components), not for an entirely-missing-kit baseline. The architectural assumption is that the kit IS THERE; agents shouldn't have to handle its absence as a normal flow.

- **Run `pnpm install` from the worktree to symlink the kit from project root packages/ui-kit/**. Rejected: workspaces still need the source files to exist in the worktree's checkout. Symlinking would create cross-worktree contamination + break parallelism.

- **Bundle bug-008's close-feature pre-flight removal into bug-009.** Defer. The close-feature pre-flight is harmless (no-op when clean); removing is mechanical cleanup that doesn't affect correctness. Phase 2 above keeps it as defense-in-depth.

- **Move snapshot to git-agent-bootstrap (the very first git op in Mode B).** Considered. git-agent-bootstrap currently just creates the `.claude/worktrees/` directory. Snapshotting there would commit BEFORE any feature graph runs — slightly cleaner separation of concerns. But: the diff vs Phase 1 is small; checkout-feature is already where worktree creation happens; moving to bootstrap adds an extra hop with no real benefit. Phase 1 wins on simplicity.

## Validation Criteria

- The original error no longer occurs: a fresh `/start-build` against a project with uncommitted Mode A artifacts produces a CLEAN close-feature merge (master moves past the snapshot to a real merge commit including the agent's work).
- All 253 existing orchestrator tests still pass.
- New tests added for checkout-feature pre-flight; pass.
- `pnpm --filter orchestrator typecheck` clean.
- Validation re-run on a fresh kanban-webapp-XX produces ≥1 fully-merged feature → wave 2 unblocks → at least one downstream feature starts. **MVP exit signal.**

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

**Tried (Phase 1 + Phase 3; Phase 2 deferred — kept bug-008 close-feature pre-flight as defense-in-depth; Phase 4 = validation re-run pending):**

- **Phase 1 — pre-flight snapshot in `runCheckoutFeature`** (`orchestrator/src/invoke-agent.ts`): inserted snapshot block AFTER the stale-worktree check + BEFORE `git worktree add`. Calls `git status --porcelain` on projectRoot; if dirty, runs `git add -A` then `git commit -F <tempfile>` with "factory: project bootstrap snapshot" message. Uses bug-005a tempfile pattern (Windows-safe). On snapshot-commit failure, returns clean `worktree-seed-failed` reason with "bug-009 pre-worktree snapshot failed" detail.
- **Phase 2 — bug-008 close-feature pre-flight kept as defense-in-depth**: not removed. It now no-ops in the normal case (project root already clean from checkout-feature snapshot), but protects against operator-introduced state between checkout and close.
- **Phase 3 — Tests** (`orchestrator/tests/invoke-agent.test.ts`):
  - Updated 7 existing checkout-feature tests to add `git status --porcelain` clean stub (so the new pre-flight is a no-op for back-compat tests)
  - Added 3 new bug-009 tests under `describe("runCheckoutFeature (bug-009 pre-worktree snapshot)")`:
    - dirty project root → snapshot fires BEFORE worktree add (verifies critical ordering: status → add → commit-F → worktree-add)
    - clean project root → no auto-commit, just worktree add (back-compat)
    - snapshot commit failure → returns `worktree-seed-failed` with `bug-009 pre-worktree snapshot failed` detail

**What happened:**

- First test run after Phase 1: 7 failures, all checkout-feature tests missing `git status --porcelain` stubs.
- Updated 5 makeExecGit-style stubs (added `{ match: /git status --porcelain/, stdout: "" }` first) + 2 closure-style execGit handlers (added `if (/git status --porcelain/.test(cmd)) return { stdout: "", ... }`).
- Second test run: all 253 existing tests pass.
- Added 3 new bug-009 tests → **256/256 pass on first try**. Typecheck clean.

**Outcome:** Phases 1 + 3 implemented and verified at the unit-test level. Phase 4 (validation re-run on kanban-webapp-04) pending. Forecast: with bug-009 in place, the worktree branches from the snapshot-inclusive master state, the agent sees the kit, doesn't recreate it, close-feature merge is clean → first true autonomous Mode B feature merge.

**Lessons for future-claude:**

- **Temporal ordering matters as much as logic.** Bug-008's snapshot logic was correct — just running at the wrong phase. Snapshotting AFTER the agent had already committed its own version of kit files created the AA conflict that the snapshot was supposed to prevent. Lesson: when a fix's effect depends on what the agent does next, the fix must run BEFORE the agent.
- **Git's add/add merge conflicts are essentially unresolvable without human judgment.** When two branches independently `add` the same file path with different content, git can't decide which version is "right" — both sides claim to be the original creator. The structural fix is to ensure the file exists on the base branch BEFORE either side independently adds it. That's what this plan accomplishes.
- **The agent's "let me create the missing kit" reaction is logically correct given its inputs.** Don't blame the agent for the conflict — the orchestrator gave it a worktree without a kit. The fix belongs at the orchestrator/git layer, not the agent prompt layer (deferred bug-007 about agent over-reach is still real but separate).

## References

- `plans/active/bug-008-close-feature-dirty-root.md` — parent; bug-008 added the snapshot logic but in the wrong phase (close-feature instead of checkout-feature)
- `plans/active/bug-002-worktree-missing-hooks-perms.md` — first orchestrator-pipeline-stabilization plan; bug-009 may be the LAST in the chain
- `plans/active/feat-014-mvp-completion-autonomous-e2e.md` — MVP plan; bug-009 likely unblocks MVP exit
- `orchestrator/src/invoke-agent.ts::runCheckoutFeature` — function this plan modifies (~line 143-233)
- `orchestrator/src/invoke-agent.ts::runCloseFeature` — function whose pre-flight becomes defense-in-depth (~line 441+)
- Validation re-run output (transient): `tasks/bdy0sw5v5.output` — kanban-webapp-03 run that surfaced bug-009 with full diagnostic context
- Cost trajectory: $6.52 → $1.70 → $1.33 → $2.69 → $8.64 → $1.35 → $4.48 → $2.52 → $5.91 → $6.43 → $5.53 → ?
