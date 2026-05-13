---
id: feat-071-cluster-bugs-pre-dispatch
type: feature
status: in-progress
author-agent: human
created: 2026-05-08
updated: 2026-05-13
parent-plan: feat-066-fix-loop-effectiveness-v2 (v2-Phase-3)
branch: feat/cluster-bugs-pre-dispatch
affected-files:
  - orchestrator/src/cluster-bugs.ts
  - orchestrator/src/fix-bugs-loop.ts
  - orchestrator/tests/cluster-bugs.test.ts
  - packages/orchestrator-contracts/src/bugs-yaml.ts
feature-area: orchestrator/dispatch-batching
priority: P1
attempt-count: 1
max-attempts: 5
---

# feat-071: Phase 6 — cluster-bugs-pre-dispatch

## Problem Statement

feat-066 Phase 6. With Phase 1 (audit defaults default-on) + Phase 2 (pixel-diff) + Phase 3 (vision-LLM), the verifier will catch ~25 bugs on a reading-log-02-class project (vs ~1 today). At 5-6 min/bug × 25 = 2-2.5 hours of fix-loop wall-clock. Without mitigation, that's a ~3× regression on investigate-024's gains.

When N>10 bugs of the SAME pattern × screen-tuple file in one iteration, they're almost always one root cause. Clustering them into a single `clustered-systemic-divergence` bug + dispatching to systemic-fixer ONCE = 10-12 min wall-clock vs N × 5-6 min sequential.

## Approach

1. **NEW `orchestrator/src/cluster-bugs.ts`** — pure function module:

   ```ts
   export function clusterBugs(bugs: BugEntry[]): {
     clusters: ClusteredBug[]; // N>10 same-pattern × tuple bugs folded
     individuals: BugEntry[]; // bugs that didn't cluster
   };
   ```

2. **Clustering rules**:
   - Group by `(bug.source, bug.parity?.pattern, bug.parity?.screen)` tuple
   - If group size > 10, create ONE `clustered-systemic-divergence` bug containing all N member-bugs
   - The clustered bug's `errorLog` carries summaries of the members
   - The clustered bug's `bug.summary` is "N divergences of pattern X across screen Y — likely systemic"
   - Members' status: `clustered-into-<id>` (visible for traceability)

3. **Wire into fix-bugs-loop**:
   - Cluster pass runs AFTER bug-filing but BEFORE dispatch
   - Clustered bug routes to systemic-fixer (via Phase 5)
   - If systemic-fixer resolves the cluster, all members are auto-resolved (status updated)
   - If systemic-fixer fails, the cluster falls back to individual dispatch (each member dispatched normally)

4. **Cluster threshold tuning**:
   - Default: N > 10
   - Per-pattern override: pixel-minor-divergence might cluster at N>3 (since each one is cheap to fix individually but they share fix-site)
   - Operator override: `FIX_BUGS_CLUSTER_THRESHOLD=5` env

## Rejected Alternatives

- **Cluster regardless of N (always batch).** Rejected — for 2-3 bugs the cluster overhead (single dispatch with longer maxTurns) costs more than 2-3 × 5-6 min individual dispatches. Threshold at N>10 amortizes the systemic-fixer overhead.
- **Cluster across patterns (group all parity bugs together).** Rejected — different patterns need different fix sites; cross-pattern clustering would mislead the systemic-fixer about scope.
- **Skip clustering if Phase 5 (systemic-fixer) hasn't shipped.** Mitigation: clustering FALLS BACK to bug-fixer with extended maxTurns:12 if systemic-fixer is unavailable. Phase 5+6 are orderable independently.

## Expected Outcomes

- [ ] `cluster-bugs.ts` ships with ≥80% test coverage
- [ ] Clustering pass runs after bug-filing, before dispatch
- [ ] Cluster bug carries member summaries; member status traceable
- [ ] On reading-log-02 broken-Tailwind state: 30 bugs cluster into 3-5 systemic-divergence bugs → 3-5 systemic-fixer dispatches
- [ ] Total wall-clock for that scenario: ~40 min (5 × 8 min) vs sequential 150-180 min (30 × 5-6 min)

## Validation Criteria

1. Synthetic test: 15 bugs of pattern P on screen S → 1 clustered bug + 0 individuals
2. Synthetic test: 5 bugs of pattern P on screen S → 0 clustered + 5 individuals (below threshold)
3. Synthetic test: 30 bugs across 3 patterns → 3 clusters (one per pattern) when each cluster >10
4. Empirical test on reading-log-02 v2-with-broken-Tailwind: cluster + systemic-fixer resolves in 1 dispatch
5. Member-bug status updates correctly on cluster resolution

## Attempt Log

### 2026-05-13 — Phase A shipped (pure function + schema); Phase B (loop wiring) deferred

Split the feature into two phases for a safe incremental ship:

**Phase A — pure function + schema (SHIPPED)**

- `orchestrator/src/cluster-bugs.ts`: pure `clusterBugs(bugs, opts) → { clusters, individuals }` function. Buckets by `(source, parity.pattern, parity.screen)` tuple. Folds groups ≥ threshold (default 10) into `clustered-systemic-divergence` parents. Per-pattern threshold overrides via `opts.perPatternThresholds`. ID generator slugifies (screen, pattern) into `bug-parity-clustered-{screen}-{pattern}` — matches the bugs.yaml regex.
- `packages/orchestrator-contracts/src/bugs-yaml.ts`: BugEntrySchema gains two optional nullable fields:
  - `clusterParent: string | null` — when set, the bug is a member of a synthesized cluster; dispatch path skips it while the parent runs.
  - `clusterMembers: string[] | null` — on cluster parent only; lists member ids so the loop can flip them on parent resolution.
- 11 new tests cover: empty input, sub-threshold, above-threshold fold, multi-pattern split, per-pattern override, non-parity bugs (don't cluster), mixed clusterable + non-clusterable, affectsFiles union, errorLog summary references, default threshold, pure-function (no input mutation).

Suite: 958/958 orchestrator pass.

**Phase B — wire into fix-bugs-loop (DEFERRED, next session)**

Required steps:

1. Add `clusterThreshold?: number` to `FixBugsLoopContext` (default undefined = OFF for safety). Operator opt-in via env `FIX_BUGS_CLUSTER_THRESHOLD=N` resolved at the entry-point caller (`cli-runner.ts` or `start-build`).
2. At each iteration's top: call `clusterBugs()` on the pending list, persist synthesized parents + member tags to `bugs.yaml`. The cluster pass runs BEFORE the dispatchable-list assembly.
3. Modify the dispatch filter to skip bugs with `clusterParent !== null` (they're handled via the parent).
4. On cluster parent resolution (status === completed): walk bugs.yaml for entries with `clusterParent === <parent-id>`, flip them to `completed` with `resolvedInIteration` set to current.
5. On cluster parent failure: clear `clusterParent` on members (set null), increment `clusterFallbackCount`. Next iteration dispatches members individually.
6. New tests:
   - "loop synthesizes cluster parent + tags members" (above-threshold scenario)
   - "loop resolves cluster → all members flip to completed"
   - "loop fails cluster → members revert to clusterParent:null + dispatch individually next iteration"
   - "below-threshold pending bugs go through normal dispatch (no cluster synthesized)"

Estimated Phase B effort: 2-3 hours of careful state-machine wiring + 4 new fix-bugs-loop tests. Best landed when the operator has a fresh session for the bugs.yaml state-transition design.

Phase A landing rationale: the pure function + schema are stand-alone correct + tested. They're a load-bearing foundation that's safe to ship without the wiring (the unused module sits dormant; no existing fix-loop test asserts cluster-pass behavior). Phase B builds on it. This split keeps the v2-Phase-3 push closeable + leaves Phase B for a focused session.
