---
id: bug-090-verify-freshness-dedicated-worktree
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
branch: fix/verify-freshness-dedicated-worktree
affected-files:
  - orchestrator/src/build-to-spec-verify.ts
  - orchestrator/src/dev-server.ts
  - orchestrator/src/parity-verify.ts
  - orchestrator/src/perceptual-review.ts
  - orchestrator/src/fix-bugs-loop.ts
  - scripts/run-synthesized-flows.mjs
feature-area: orchestrator/fix-loop
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "verifier boots dev-server from projectRoot/master which doesn't have mid-loop fixes; PNGs + DOM-diff + vision-LLM all see stale code"
---

# bug-090: verifier runs against stale code mid-loop (dedicated verify worktree on fix/bugs-yaml-iter)

## Bug Description

The fix-bugs-loop's `closeFixupWorktree(mergeFirst: ...)` only fires AT THE END of the run, AND only when `status === "clean"`. Mid-loop verify passes boot the dev-server from `projectRoot`, which stays checked out on `master`. Master has NONE of the in-iteration fix commits (those live on `fix/bugs-yaml-iter`).

Cascade of consequences:

1. **Vision-LLM (Tier 4)** captures PNGs from the dev-server. The dev-server compiles master. PNGs reflect pre-fix state.
2. **Parity verifier (Tier 3)** snapshots DOM via Playwright against the same stale dev-server. DOM-diff sees pre-fix structure.
3. **Synthesized flow execution (Tier 2)** runs against the stale dev-server. Interactions test pre-fix behavior.
4. The verifier re-files the SAME bugs as new findings on the next iteration (with slightly different IDs since slugs include findings text). bug-082's commit guard catches the agents' "completed" returns as unverified-completion when the verifier doesn't re-confirm — but only because the verifier is rendering the wrong code.

**Empirical confirmation (reading-log-02 2026-05-12 stack):**

- After hours of fix-loop runs reporting "97.7% perceptual resolution"
- Operator boots dev-server for review → sees no apparent fixes
- Diagnosis: master is at the pre-v2-epic state; all fixes are on `fix/bugs-yaml-iter` (40+ commits ahead)
- After manual `git merge --no-ff fix/bugs-yaml-iter` → site shows ALL the fixes
- The orchestrator's empirical metrics were partly correct (fixes WERE made) but the verifier-side feedback loop was broken (verifier always saw stale state)

This compounds with bug-089 (silent auto-merge failure): even if the end-of-run merge succeeds, every MID-LOOP verify produced bad data → bad bug-files → wasted dispatches.

## Reproduction Steps

1. Run `/fix-bugs <project>` on a project with pending visual-parity or perceptual-divergence bugs.
2. After iteration 1's fix-dispatch completes (any bug status: completed), inspect:
   - `git log master..fix/bugs-yaml-iter --oneline` → shows commits that landed on fixup branch
   - `git -C projects/<name> rev-parse --abbrev-ref HEAD` → still `master`
3. Watch iteration 2's verify pass:
   - `bootDevServer(projectDir)` spawns `pnpm dev` in the project root
   - Project root is on master → dev-server compiles master → no iteration-1 fixes visible
4. Vision-LLM / parity / flow execution all run against this stale dev-server.

## Root Cause Analysis

`orchestrator/src/build-to-spec-verify.ts:bootDevServer()` is invoked with `projectDir` from `ctx.projectDir` (the project's working tree root). Per `orchestrator/src/dev-server.ts`, the spawn cwd is whatever projectDir resolves to:

```ts
const proc = spawn(devCmd, devArgs, { cwd: projectDir, ... });
```

`projectDir` is set ONCE at orchestrator-run-startup. It doesn't change as fix/bugs-yaml-iter accumulates commits. The only branch-switch that happens in the project root is the end-of-loop `git merge --no-ff fix/bugs-yaml-iter` (which has its own failure modes per bug-089).

Per-bug fix worktrees DO exist at `.claude/worktrees/<bug-id>/` on `fix/<bug-id>` branches, but those are for the AGENT's work, not for the verifier. The verifier has no equivalent.

## Fix Approach

### Phase A — dedicated verify worktree (~3-4hr)

Introduce `.claude/worktrees/verify/` as a third worktree shape (alongside per-bug fix worktrees + the shared fixup worktree). It's checked out on `fix/bugs-yaml-iter` and stays fresh across iterations.

**New module: `orchestrator/src/verify-worktree.ts`**

```ts
export function ensureVerifyWorktree(args: {
  projectRoot: string;
  fixupBranchName: string; // default "fix/bugs-yaml-iter"
  verifyWorktreePath?: string; // default `<projectRoot>/.claude/worktrees/verify`
}): { ok: true; cwd: string } | { ok: false; reason: string };
```

Behavior:

- If `.claude/worktrees/verify/` doesn't exist → create it via `git worktree add <path> <branch>`
- If it exists but on the wrong branch → `git -C <path> checkout <branch>`
- If it's stale (HEAD lags fixupBranch HEAD) → `git -C <path> reset --hard <branch>` to fast-forward
- Returns `cwd` = the verify worktree path; build-to-spec-verify uses this as the dev-server boot cwd

**Wiring in `build-to-spec-verify.ts:runBuildToSpecVerify()`:**

Before calling `bootDevServer`, resolve the verify worktree path:

```ts
const verifyTree = ensureVerifyWorktree({
  projectRoot: ctx.projectDir,
  fixupBranchName: "fix/bugs-yaml-iter",
});
if (!verifyTree.ok) {
  warnings.push(`verify worktree setup failed: ${verifyTree.reason}; falling back to projectRoot`);
}
const verifyCwd = verifyTree.ok ? verifyTree.cwd : ctx.projectDir;
const sharedDevServerHandle = await bootDevServer(verifyCwd, ...);
```

All downstream verifier surfaces inherit the new cwd:

- `runFlows({ projectDir: verifyCwd, ... })` for synthesized-flow execution
- `parityVerify({ projectDir: verifyCwd, devServerUrl, ... })` for Tier 3
- `runPerceptualReview` reads pixel-diff PNGs from `verifyCwd/docs/build-to-spec/pixel-diffs/` (NOT the operator's projectRoot — those PNGs would also be stale)

### Phase B — fix/bugs-yaml-iter freshness ensured before each verify (~30min)

Inside the fix-bugs-loop iteration, BEFORE invoking `runBuildToSpecVerify`:

1. Confirm `fix/bugs-yaml-iter` has the per-bug-worktree merges committed (already happens via `closePerBugWorktree`).
2. Call `ensureVerifyWorktree` to fast-forward the verify worktree to the current `fix/bugs-yaml-iter` HEAD.
3. Proceed with verify against the verify worktree's dev-server.

### Phase C — operator-side affordances (~30min)

- `/pause-build` skill: surface the verify worktree path in its preview so operators know where to inspect mid-run state.
- `/resume-build`: ensure the verify worktree resumes cleanly post-pause.
- Document the verify worktree in `docs/build-to-spec/README.md` (or similar): "the orchestrator boots a dev-server from `.claude/worktrees/verify/` mid-run — do NOT inspect that worktree manually; for human review use the project root's master after `/fix-bugs` completes."

### Phase D — tests (~1hr)

1. Unit: `ensureVerifyWorktree` creates a fresh worktree when missing.
2. Unit: `ensureVerifyWorktree` fast-forwards a stale worktree.
3. Unit: `ensureVerifyWorktree` gracefully handles a missing fix/bugs-yaml-iter branch (returns `ok: false`, dispatcher falls back to projectRoot).
4. Integration: end-of-iteration verify uses the verify worktree's cwd (assertion via a spawn-spy on bootDevServer).
5. Integration: PerceptualReview reads PNGs from verify worktree (not projectRoot).

### Phase E — empirical re-validation (~1hr wall-clock + ~$2-3)

Re-run `/fix-bugs reading-log-02` with the full v2 stack + bug-090. Validate:

- bug-082 catch rate drops dramatically (the false-catches from stale-verifier-re-checking go away)
- Perceptual findings don't repeat across iterations (because the verifier sees fixes)
- The "completed" status in bugs.yaml actually corresponds to fixes the verifier confirmed
- Operator's master-side dev-server still shows fixes (end-of-loop merge unaffected)

## Rejected Fixes

- **Switch projectRoot's working tree to fix/bugs-yaml-iter mid-loop** — breaks operator's mental model (they expect projectRoot to be on master). Conflicts with operator-side dev-server inspection. Dirty-tree blockers cause `git checkout` failures.
- **Merge fix/bugs-yaml-iter → master after each iteration** — invasive; depends on bug-089's auto-merge robustness; pollutes master with intermediate WIP between iterations. The verify worktree decouples this cleanly.
- **Read PNGs from per-bug worktrees** — those are scoped to one bug; the verifier needs the integrated state.
- **Boot dev-server from per-bug worktrees** — same scoping issue; also there are N per-bug worktrees, the verifier wants ONE integrated state.

## Validation Criteria

- [ ] `orchestrator/src/verify-worktree.ts` exists with `ensureVerifyWorktree()`
- [ ] `runBuildToSpecVerify` uses the verify worktree's cwd for dev-server boot when available
- [ ] `runFlows`, `parityVerify`, `runPerceptualReview` all consume the verify worktree's projectDir consistently
- [ ] Verify worktree is created on first verify pass + fast-forwarded on subsequent passes
- [ ] Operator's projectRoot stays untouched during fix-loop runs
- [ ] 5 new tests cover the worktree-management primitives + integration paths
- [ ] Empirical: re-run /fix-bugs reading-log-02; the same perceptual finding does NOT re-file across iterations (currently it does)
- [ ] No regression on existing 231 tests across the touched suites

## Cross-references

- **bug-089** (companion) — auto-merge silent failure. Independent fix; bug-090 makes bug-089 less critical (verifier no longer depends on master being fresh) but doesn't replace it (operator-side review still needs the merge to land).
- **bug-058** — fixup-worktree-stale-base-vs-master. Same shape; bug-090 introduces the analogous concern for the verifier-side worktree.
- **bug-061** — per-bug-worktree-stale-base-vs-fixup. Same shape; bug-090 introduces the third worktree to the family.
- **feat-066 v2 epic** — bug-090 closes the empirical-validation feedback loop. Every "97.7% resolved" metric in this epic is suspect until bug-090 lands; numbers post-bug-090 will be honest.
- **bug-077** (cross-reference, NOT part of bug-090's scope) — a related concern: agents can DELETE load-bearing config files (postcss.config.mjs) that the verify worktree would inherit. The verifier wouldn't catch the deletion because it surfaces as "0 utility classes" not a structural error. Separate fix needed.

## Attempt Log

<!-- Populated by executing agents. -->
