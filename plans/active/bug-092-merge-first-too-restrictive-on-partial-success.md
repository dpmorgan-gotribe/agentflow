---
id: bug-092-merge-first-too-restrictive-on-partial-success
type: bug
status: approved
author-agent: human
created: 2026-05-13
updated: 2026-05-13
approved-by: human
approved-at: 2026-05-13
parent-plan: feat-066-fix-loop-effectiveness-v2
supersedes: null
superseded-by: null
branch: fix/merge-first-on-partial-success
affected-files:
  - orchestrator/src/fix-bugs-loop.ts
  - orchestrator/tests/fix-bugs-loop.test.ts
feature-area: orchestrator/fix-loop
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "closeFixupWorktree's mergeFirst gate is `status === 'clean'`; runs that end 'all-bugs-failed' or 'iteration-cap-hit' with PARTIAL success strand the resolved fixes on fix/bugs-yaml-iter — never reach master"
reproduction-steps: "run /fix-bugs against any project where N bugs are pending; agent resolves M of N (M<N); the remaining N-M fail; loop ends status='all-bugs-failed' → mergeFirst=false → closeFixupWorktree removes worktree without merging → fix/bugs-yaml-iter ahead of master by M fix commits, master stays at original sha"
stack-trace: null
---

# bug-092: closeFixupWorktree mergeFirst gate is too restrictive — partial successes strand on fix/bugs-yaml-iter

## Bug Description

`runFixBugsLoop` calls `closeFixupWorktree({ mergeFirst: status === "clean" })` at end-of-loop (fix-bugs-loop.ts ~line 2488). The merge only fires when EVERY pending bug resolved cleanly. Any partial-success outcome — `status: "all-bugs-failed"` (some failed but others resolved) or `status: "iteration-cap-hit"` (ran out of iterations with mixed results) — sets `mergeFirst=false`, skipping the merge entirely.

The bug: partial-success runs are routine. Systemic bugs sometimes resolve, sometimes hit rate-limit / stall thresholds and fail. Resolved fixes still represent real progress that should land on master so the operator's site review sees them. Stranding them on `fix/bugs-yaml-iter` while master stays unchanged is the same end-user symptom bug-089 was supposed to fix.

**Empirical confirmation (reading-log-02 /fix-bugs run 2026-05-13, post-bug-089/090/091 ship):**

Two pending pre-verify systemic bugs dispatched:

- `tooling-config-mismatch`: systemic-fixer committed `9c5c3a3 fix(tooling): add missing postcss.config.mjs and remove output:export from next.config.ts` → merged into `fix/bugs-yaml-iter` at `14ea7b6` ✓
- `tooling-test-seed-contract-broken`: agent hit "no SDK message in 110s + 118s" rate-limit/stall → bug-082 unverified-completion guard caught empty commit → marked failed

Loop ended `status: all-bugs-failed` (because 5 failed bugs aggregated across rounds-orchestrator's outer iterations). `mergeFirst=false`. Master stayed at `f1c2930`. The resolved fix sits on `fix/bugs-yaml-iter` (advanced 2 commits ahead) but never reaches the operator's working tree.

This subverts bug-089's loud-banner contract: the AUTO-MERGE FAILED stderr never fires because no merge was even attempted. Operator can't tell from output that there's a stranded fix — they have to manually check `git log master..fix/bugs-yaml-iter` post-run.

## Reproduction Steps

1. Pick any project with 2+ pending bugs in `docs/bugs.yaml` where at least one will resolve and one will not (e.g. rate-limit hits, agent stalls, genuinely-unfixable bugs).
2. Run `/fix-bugs <project>`.
3. Observe `status: all-bugs-failed` (or `iteration-cap-hit`) in the final summary even though `bugsResolved.length > 0`.
4. Check `git -C projects/<name> log master..fix/bugs-yaml-iter --oneline` → shows the unmerged fix commits.
5. Check `git -C projects/<name> rev-parse HEAD` → still at original master sha.
6. No `AUTO-MERGE FAILED` banner in stderr (bug-089's loud-failure path never fires).

## Error Output

```
Bug-fix loop:
  iteration 2/2; resolved: 116; failed: 10; remaining: 0; status: clean
  cost:     $0.38
```

(Aggregated reporting from rounds-orchestrator dedup-bug aside, the underlying per-runFixBugsLoop status was `all-bugs-failed` for the round that actually dispatched work. `mergeFirst` gated on that status and skipped the merge.)

State post-run:

```
$ git -C projects/reading-log-02 log master..fix/bugs-yaml-iter --oneline
14ea7b6 merge fix/bug-compile-pre-verify-tooling-config-mismatch into fix/bugs-yaml-iter
9c5c3a3 fix(tooling): add missing postcss.config.mjs and remove output:export from next.config.ts

$ git -C projects/reading-log-02 rev-parse HEAD
f1c293003d84b0412fa6adb507d022d0a0220dc5   # unchanged from pre-run
```

## Root Cause Analysis

`orchestrator/src/fix-bugs-loop.ts` at the close-out site (line ~2488):

```ts
const close = closeFixupWorktree({
  projectRoot: ctx.projectRoot,
  worktreePath,
  branch: fixupBranch,
  mergeFirst: status === "clean", // ← TOO RESTRICTIVE
});
```

`status` enum: `"clean" | "iteration-cap-hit" | "all-bugs-failed" | "no-bugs" | "auto-merge-failed"` (last added in bug-089). Only `"clean"` triggers the merge.

The intent of `mergeFirst` is "should we attempt to land the loop's work on master?" — which is YES whenever ANY resolved bug produced a real commit. The current gate equates "loop fully clean" with "any progress to ship", which is wrong.

Why the bug didn't surface earlier:

- Pre-rounds-orchestrator (feat-073), the loop ran ONCE per `/fix-bugs` invocation. Either all bugs resolved (`clean`, merge fires) or all failed (`all-bugs-failed`, merge skipped — semantically reasonable: nothing to merge).
- Post-rounds-orchestrator, the loop runs N times (once per outer iteration). Round-state-gated dispatches mean each inner-loop call can produce mixed outcomes — some resolved, some failed — but the `status` aggregation summarizes the WHOLE picture and ignores per-iteration partial success.
- bug-089 added auto-merge robustness on the merge ATTEMPT path. It didn't change the merge-gate. The gate stays narrow → bug-089's loud-banner never fires for partial-success runs.

## Fix Approach

### Phase A — relax the mergeFirst gate (~10min)

Change the gate from "status is clean" to "any bug resolved this run":

```ts
const anyResolved = doc.bugs.some((b) => b.status === "completed");
const close = closeFixupWorktree({
  projectRoot: ctx.projectRoot,
  worktreePath,
  branch: fixupBranch,
  mergeFirst: anyResolved,
});
```

Or, equivalently, compute via the result-shape we're about to return:

```ts
const bugsResolvedForGate = doc.bugs.filter((b) => b.status === "completed").map((b) => b.id);
const close = closeFixupWorktree({
  ...,
  mergeFirst: bugsResolvedForGate.length > 0,
});
```

Why "any" not "any new this iteration": the fixup branch HOLDS the cumulative state across all rounds-orchestrator outer iterations. The merge needs to ship whatever's on the branch that isn't on master yet — regardless of whether THIS specific runFixBugsLoop call's iteration was responsible.

Edge cases handled:

- `bugsResolved.length === 0` (zero progress) → mergeFirst=false → existing behavior (no-op merge skipped).
- `bugsResolved.length > 0` AND `status === "all-bugs-failed"` → mergeFirst=true → merge attempted. bug-089's whitelist recovery + loud banner fire correctly.
- `bugsResolved.length > 0` AND `status === "iteration-cap-hit"` → same as above.
- `bugsResolved.length > 0` AND `status === "clean"` → same as today (merge fires).

### Phase B — verify status reporting is consistent (~5min)

Confirm the `status` field returned in `FixBugsLoopResult` still reflects the loop's TERMINAL state truthfully even when merge succeeded on partial progress. The merge outcome lives in `mergeOutcome` (per bug-089's contract), so `status` doesn't need to change. But add a regression assertion in the new test: `status === "all-bugs-failed"` + `mergeOutcome === "merged"` is a valid combination.

### Phase C — 1 fix-bugs-loop test (~15min)

Add to `orchestrator/tests/fix-bugs-loop.test.ts` (in the bug-089 describe block or its own):

- "partial success (1 resolved + 1 failed) → merge fires + master advances + status:all-bugs-failed" — set up a real repo, dispatch 2 bugs where 1 succeeds + 1 fails, assert master HEAD advances + final status is `all-bugs-failed` + `bugsResolved.length === 1`.

### Phase D — empirical re-validation (~$0 cost)

Manual `git -C projects/reading-log-02 merge --no-ff fix/bugs-yaml-iter` to land the stranded fix from the 2026-05-13 run. Then re-run `/fix-bugs reading-log-02` against the remaining failed bug (seed-contract-broken). Validate:

- The resolved bug DID land on master automatically (no manual merge needed).
- If it fails again, bug-089's loud banner fires correctly.
- If it resolves, master advances + bug count drops.

## Rejected Fixes

- **Always set `mergeFirst: true`** — would attempt a merge even on `no-bugs` runs where the loop did literally nothing. Harmless but noisy (merge of empty branch is a fast-forward no-op, but the close-out warning would fire if anything in the working tree was dirty).
- **Add a separate "merge requested" enum to FixBugsLoopResult.status** — over-engineered; `bugsResolved.length` is the load-bearing signal.
- **Add a flag to mergeFirst per-bug** — too granular; the merge is all-or-nothing per branch.
- **Move the gate to closeFixupWorktree** (e.g. always pass mergeFirst=true; closeFixupWorktree decides) — couples the close-out function to the loop's domain knowledge of "what counts as progress". The fix-bugs-loop is the right layer for the policy decision.

## Validation Criteria

- [ ] `mergeFirst` is computed from `bugsResolved.length > 0` (or equivalent: `doc.bugs.some(b => b.status === "completed" && b.resolvedInIteration !== null)`)
- [ ] When loop ends `status: "all-bugs-failed"` with at least one resolved bug, the merge attempt fires + auto-merge robustness (bug-089) applies normally
- [ ] When loop ends `status: "no-bugs"` OR resolved count is zero, mergeFirst=false (preserves existing behavior)
- [ ] One new fix-bugs-loop test covers the partial-success path (1 resolved + 1 failed → merge fires + master advances)
- [ ] Suite stays 931/931 + 1 new test = 932/932
- [ ] Empirical: post-fix re-run of /fix-bugs reading-log-02 lands the stranded `tooling-config-mismatch` fix on master without manual intervention

## Cross-references

- **bug-089** — auto-merge robustness. bug-089 made the merge ATTEMPT path more robust (loud failures + whitelist recovery). bug-092 fixes the GATE so the attempt happens at all in partial-success cases.
- **feat-073** — rounds-orchestrator (loop-of-loops). Increased the surface area for partial-success states because the outer-iteration aggregation can produce mixed outcomes. bug-092 closes that gap.
- **bug-082** — unverified-completion guard. Caught the seed-contract-broken bug's empty commit on this empirical run; the agent's "completed" return was rejected correctly. bug-082 is working as designed; bug-092 is orthogonal.
- **feat-066 v2 epic** — bug-092 is the FOURTH Phase 1 bug surfaced by the empirical re-run #1. Phase 1 ships when bug-089 + bug-090 + bug-091 + bug-092 all land + empirical signal is clean.

## Attempt Log

<!-- Populated by executing agents. -->
