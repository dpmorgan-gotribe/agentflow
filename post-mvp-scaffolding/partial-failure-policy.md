# partial-failure-policy

**Deferred from**: investigate-002-build-tier-readiness-gap §Additional consideration (b).

## The concern

Feature-graph orchestrator (refactor-004) runs N features in parallel. Current failure model is per-feature: if feature-A exhausts its retries, `emergency-abort` destroys its worktree + marks it `failed` in tasks.yaml. But:

**What about cross-feature partial failure?** If 12 of 20 features succeed and 8 fail, what do we do?

- Option A: ship the 12 with known gaps; reviewer surfaces the 8 as documented-but-missing
- Option B: abort all 20; rollback merges back to pre-run state; human investigates
- Option C: attempt rescue — re-plan the 8 failed with revised feature-grouping; re-run just them

Currently: the orchestrator doesn't decide. Each feature finishes independently; nothing aggregates.

## Why deferred

Zero autonomous runs have completed. We don't know what partial-failure rates look like yet. Designing a policy without data risks over-engineering for a scenario that doesn't occur OR under-engineering for a worse-than-expected failure mode.

## Rough shape when it's time

Extend task-035 orchestrator with a `partialFailurePolicy` field in `.claude/models.yaml`:

```yaml
stages:
  feature-graph:
    partialFailurePolicy: "ship-with-warnings" | "abort-all" | "rescue-failed"
    maxFailureRatio: 0.3    # abort if >30% of features fail
    rescueAttempts: 1       # when partialFailurePolicy=rescue-failed, how many re-plan passes
```

On pipeline completion:

- `success`: every feature merged, policy doesn't fire
- `partial + ratio < maxFailureRatio + policy=ship-with-warnings`: proceed; reviewer output + PR both flag unbuilt features; human decides if PR is mergeable
- `partial + ratio ≥ maxFailureRatio`: auto-abort-all
- `policy=rescue-failed`: re-invoke PM with the failed feature IDs + `--replan-only`; run one more feature-graph pass

Estimated size: medium plan. ~400 LOC in orchestrator + tasks.yaml schema extension + PM `--replan-only` mode.

## When to revisit

After first 2-3 autonomous runs on mindapp-v2. Observed failure patterns will suggest which policy works — and whether the ratio threshold is 20%, 30%, or 50%.

## Related

- Reviewer's scope includes "brief-delivery check" per refactor-005 — if features fail, reviewer flags the brief §12 items the app doesn't deliver. Human at PR review decides whether to ship anyway.
- Tests must still pass at 80% coverage even when partial; don't ship broken code just because most features built.
