---
id: feat-072-class-batched-dispatch-reenable
type: feature
status: draft
author-agent: human
created: 2026-05-08
updated: 2026-05-08
parent-plan: feat-066-fix-loop-effectiveness-v2
branch: feat/class-batched-dispatch-reenable
affected-files:
  - orchestrator/src/feature-graph.ts
feature-area: orchestrator/dispatch-batching
priority: P2
attempt-count: 0
max-attempts: 5
---

# feat-072: Phase 7 — re-enable class-batched dispatch (selected classes)

## Problem Statement

feat-066 Phase 7. Class-batched dispatch (feat-061) was disabled by default in bug-075 (investigate-024 Phase 1) because parity-batches blew the 25-min wall-clock cap during reading-log-02 v4 validation. Empirically the issue was that batches conflated 6 layout-regrouping parity bugs into 1 dispatch with too much scope.

With Phase 1 (audit reconfig with systemic-divergence at >15 drifts) + Phase 5 (systemic-fixer for those) + Phase 6 (clustering for repeated patterns), the conditions that caused batch-blowup are addressed. The REMAINING use case for class-batched dispatch is `pixel-minor-divergence` (Phase 2 output): per-pixel small drifts across multiple screens, each a 1-2 line fix, all sharing the same fix-site (e.g. a token value in tailwind.config.ts).

For pixel-minor-divergence: 5-10 bugs in one bug-fixer dispatch = 8-12 min wall-clock vs sequential 25-60 min.

## Approach

1. **Selective re-enable in `orchestrator/src/feature-graph.ts`** — `enableClassBatchedDispatch` defaults remain DISABLED (per bug-075), but add a per-class allowlist:
   ```ts
   const CLASS_BATCH_ALLOWLIST = new Set<string>([
     "pixel-minor-divergence",
     // Future: "perceptual-cosmetic" if we add a low-severity perceptual class
   ]);
   ```

2. **Batching rules (preserved from feat-061)**:
   - Group by (bug.source, bug.parity?.pattern OR equivalent)
   - Cap batch size at 10 (was 6 — bug-fixer + pre-loaded context can handle more now)
   - Wall-clock cap at 15 min (matches bug-fixer's stallTimeoutMs)
   - If batch fails, FALL BACK to individual dispatches (each retried under per-bug retry policy)

3. **Pre-loaded context for batches**: include all N member-bugs' context blocks; include shared resources (tailwind.config.ts, the relevant kit primitive file). Bug-fixer's `buildBugContextEnvelope` extended to handle batch shape.

4. **Operator env override**: `FIX_BUGS_CLASS_BATCH_DISABLED=1` to fully disable class-batching (back to default-pre-Phase-7 behavior).

## Rejected Alternatives

- **Re-enable class-batching for all classes by default.** Rejected — bug-075's empirical evidence is still load-bearing for layout-regrouping batches; keeping the default off + allowlist per class respects that.
- **Use class-batching for systemic divergences instead of Phase 6 clustering.** Rejected — Phase 6 clusters within a single screen-pattern tuple; class-batching crosses tuples. Different operations; need both.
- **Skip Phase 7.** Rejected — without it, pixel-minor-divergence floods the loop with 20+ individual 5-6 min dispatches. Empirical projection: a fully-styled project with light token drift could see 50+ minor divergences across screens; sequential = 4-5 hr; batched = 30-40 min.

## Expected Outcomes

- [ ] CLASS_BATCH_ALLOWLIST mechanism added to feature-graph.ts
- [ ] pixel-minor-divergence batches up to 10 bugs per dispatch
- [ ] Bug-fixer pre-loaded context handles batch shape (multi-bug envelope)
- [ ] Wall-clock cap 15 min preserved
- [ ] Fallback to individual dispatch on batch failure
- [ ] Operator override `FIX_BUGS_CLASS_BATCH_DISABLED=1` works

## Validation Criteria

1. Synthetic test: 8 pixel-minor-divergence bugs → 1 batched dispatch
2. Synthetic test: 12 pixel-minor-divergence bugs → 2 batches (10 + 2)
3. Synthetic test: 5 layout-regrouping bugs (NOT in allowlist) → 5 individual dispatches (no batching)
4. Wall-clock for 8-bug batch ≤ 15 min on reading-log-02-class project
5. Batch-failure fallback re-dispatches members individually
6. Per-bug wall-clock for non-batched classes unchanged from current

## Attempt Log

<!-- Populated by executing agents. -->
