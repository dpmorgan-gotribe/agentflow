---
id: investigate-014-fix-bugs-loop-parallelism-and-worktree-lifecycle
type: investigation
status: draft
author-agent: human
created: 2026-05-02
updated: 2026-05-02
parent-plan: null
supersedes: null
superseded-by: null
branch: null
affected-files: []
feature-area: orchestrator/fix-bugs-loop + worktree-lifecycle
priority: P2
attempt-count: 0
max-attempts: 5
time-box-minutes: 60
hypothesis: "Two independent ergonomics gaps surfaced by finance-track-01 (2026-05-02). (1) The fix-bugs loop runs sequentially via a plain `for (const bug of pendingThisIter)` loop ignoring `--max-concurrent`; can be parallelized via per-bug worktrees mirroring the feature-graph pattern, with a coordination strategy for the bug fixes that touch shared central files. (2) Completed feature/bug worktrees accumulate on disk (~12 GB+ across this project's 17 features) and are never cleaned up; `git-agent` could prune post-merge with operator-controlled retention policy. Both fit a 60-min audit + scope-decision time-box."
---

# investigate-014: Can we (a) parallelize the fix-bugs loop + (b) auto-clean completed worktrees?

## Question

Two related but independent operational gaps surfaced from the 2026-05-02 finance-track-01 build:

### Q1 — Fix-bugs loop parallelism

`orchestrator/src/fix-bugs-loop.ts:521` runs a plain sequential `for (const bug of pendingThisIter)` loop, dispatching each bug's full agent_sequence (builder → tester → reviewer → merge-into-fixup-branch) before starting the next bug. The `--max-concurrent` flag set on `/start-build` is **not honored** in the fix-bugs phase. Empirically (this session), 7 orphan-component bugs took ~50 min sequentially when wave-B-style parallelism could have completed them in ~15 min.

Two structural reasons today's fix-loop is sequential:

- All bug fixes accumulate in ONE shared `fixup` worktree on `fix/bugs-yaml-iter` branch. Concurrent edits would race on the filesystem.
- Bug fixes typically touch overlapping central files (`apps/web/app/layout.tsx`, `apps/web/src/components/nav.tsx`) — the orphan-component fix pattern wires unused exports into central registration files. Two parallel fixes editing the same file would conflict immediately.

Both are mitigatable via per-bug worktrees + the bug-034 Phase A additive-concat resolver (now shipped). The question: is the engineering cost worth the wall-clock savings?

### Q2 — Worktree lifecycle / cleanup

After this session's finance-track-01 run completed, `.claude/worktrees/` contains:

- 17 feature worktrees (all merged + closed, but the worktree dirs + their node_modules persist)
- 1 fixup worktree (post-fix-loop, also dormant)
- Each worktree has its own pnpm install — likely ~500MB-1GB of node_modules per worktree
- Total disk usage estimated 8-15 GB for a single completed project

`git-agent close-feature` merges to master but doesn't run `git worktree remove`. The orchestrator never prunes. Operator must `rm -rf .claude/worktrees/*` manually.

The question: should completed worktrees be auto-pruned post-merge? With what retention policy (e.g. keep last N for forensic debug, prune older)? Or does the operator need them around for some reason we haven't documented?

### Combined investigation rationale

Both questions touch worktree-lifecycle policy in the orchestrator. They share the same surfaces (`git-agent`, `feature-graph.ts`, `fix-bugs-loop.ts`) and same underlying architectural concern: when is a worktree "done" and what happens to it. Worth investigating together to avoid two passes over the same code paths + to surface any interactions (e.g. parallel fix-bug worktrees would compound the disk-bloat problem, so the cleanup story matters more if Q1 ships).

## Hypothesis

### H1 — fix-bugs loop CAN be parallelized

Per-bug worktrees + bug-034 Phase A's additive-concat resolver (now shipped) make parallel fix-bugs dispatch tractable. Concrete shape:

- Each bug gets its own worktree (e.g. `.claude/worktrees/bug-orphan-X/`) on its own branch (e.g. `fix/bug-orphan-X`).
- Builders write fixes per-bug independently.
- Testers/reviewers run per-bug.
- Merging back to a single `fix/bugs-yaml-iter` branch (or directly to master) sequentially via the bug-034 mutex + additive-concat resolver eats the inevitable conflicts on shared files (layout.tsx, nav.tsx, etc) deterministically.

Cost: ~2-3 days of orchestrator engineering (mirror `feature-graph.ts` patterns to fix-loop).
Benefit: ~60-80% wall-clock reduction on the fix-loop phase (sequential 50 min → parallel 10-15 min for 7 bugs).

### H2 — Worktree cleanup is straightforward + safe

`git worktree remove --force <worktree>` post-merge cleanly removes the worktree dir + de-registers it from git's worktree list. The branch (already merged to master) remains as a no-op ref OR can be deleted via `git branch -d`.

Retention policy options (from cheap to defensive):

- **Aggressive**: prune immediately on `close-feature` success. Pros: simplest, smallest disk footprint. Cons: lose forensic state if an operator wants to inspect what the builder wrote.
- **Last-N**: keep last 3 (or N) merged worktrees, prune older. Pros: balance disk + forensic. Cons: needs LRU bookkeeping.
- **Operator-gated**: emit a hint at run completion ("12 worktrees consume X GB; run `/cleanup-worktrees <project>` to prune"). Pros: zero risk of losing state. Cons: relies on operator action.

Cost: ~1 day of orchestrator engineering for any retention policy.
Benefit: ~10 GB disk reclaim per completed project run.

### Combined recommendation prediction

H1 ships as a P2 feature (real wall-clock win, but not blocking). H2 ships as part of git-agent's `close-feature` response with operator-gated default + a flag for aggressive prune. Both can ship in parallel; neither blocks the other.

Falsification tests:

- H1 falsified if: per-bug worktree concurrent dispatch surfaces a non-merge-conflict failure mode we didn't anticipate (e.g. shared node_modules contention, shared dev-server port collision) that resists structural fixes.
- H2 falsified if: there's a load-bearing reason worktrees must persist post-merge (e.g. fix-loop iterations re-use them, or the verifier reads them, or the operator has a workflow we haven't documented).

## Investigation Steps

(60-min time-box. If incomplete, document partial findings + recommend next step.)

### Step 1 — confirm fix-loop sequentiality + measure cost (10 min)

- Read `orchestrator/src/fix-bugs-loop.ts:419 runFixBugsLoop` end-to-end.
- Confirm the `for (const bug of pendingThisIter)` loop on line 521 is the only dispatch path.
- Check whether any per-bug parallelism exists at a level I missed (e.g. agent_sequence within a bug runs concurrent agents — unlikely but possible).
- Measure: from finance-track-01's rate-limit log, confirm sequential timing pattern (each bug's builder→tester→reviewer cleanly precedes the next).

### Step 2 — audit shared-file edit pattern across bug fixes (10 min)

- Inspect 3 of finance-track-01's 7 completed bug fixes (their commits on the `fix/bugs-yaml-iter` branch — IF they exist; if commits are batched, check the worktree's actual diffs vs master).
- For each, list the files touched.
- Cross-reference: how many files appear in ≥2 bug fixes? Those are the merge-conflict surface in a hypothetical parallel mode.
- Empirical estimate: if N=7 bugs all touch `apps/web/app/layout.tsx` (likely for orphan-component fixes), the bug-034 Phase A resolver eats those conflicts deterministically.

### Step 3 — feasibility check for per-bug worktrees (10 min)

- Audit `git-agent`'s `op: checkout-feature` to see if it generalizes to bug-IDs (it should — featureId is just a string).
- Check `tracker.onFeatureDispatched` / similar lifecycle hooks: do they assume "feature" semantics or could they accept "bug" featureIds?
- Check `runCheckoutFeature` mutex (bug-036 Phase A): does it scale to 5+ concurrent bug-checkouts? (yes — same projectRoot, same lock, just N more contenders).

### Step 4 — worktree disk inventory (5 min)

- `du -sh projects/finance-track-01/.claude/worktrees/*` to measure actual disk per worktree.
- Sum across all worktrees + the project root + node_modules elsewhere.
- Confirm the ~10 GB ballpark (or correct it).

### Step 5 — git-agent close-feature semantics + extension feasibility (10 min)

- Read `git-agent`'s `close-feature` op handler — does it currently leave the worktree in place (verified yes, empirically), or is there a code path I missed?
- Sketch the diff for an `auto-prune-on-close` boolean flag — how invasive?
- Sketch the diff for a `/cleanup-worktrees <project>` skill — what does it need (worktree list, age detection, optional N-most-recent retention)?

### Step 6 — interaction analysis (5 min)

If H1 ships (per-bug worktrees), each bug fix consumes ~500MB-1GB of node_modules. 5 concurrent bug-fixes = 2.5-5GB additional disk during the fix-loop phase. Cleanup of fix-loop worktrees becomes more important. Confirm Q1 + Q2 should ship as a coordinated pair.

### Step 7 — write findings + recommendation (10 min)

Document below.

## Findings

<!-- populated during investigation -->

## Recommendation

<!-- populated after findings; expected output is one of:
     - "Ship feat-046 (fix-bugs parallelism, P2) + feat-047 (worktree auto-prune, P2)" — separate plans, parallel ship
     - "Ship feat-046 alone; defer feat-047 indefinitely (operators don't mind manual cleanup)"
     - "Ship feat-047 alone; defer feat-046 (sequential fix-loop is fine because bug counts are usually small)"
     - "Defer both — neither is high-leverage enough to ship now; document operator workarounds in CLAUDE.md and revisit in 6 months"
     - "Re-scope; one or both Qs surfaces a deeper issue (e.g. shared-state contention beyond filesystem) — file investigate-015"
-->

## Attempt Log

<!-- populated by agents -->
