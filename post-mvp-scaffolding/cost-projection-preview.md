# cost-projection-preview

**Deferred from**: investigate-002-build-tier-readiness-gap §Additional consideration (c).

## The concern

Task-035 orchestrator runtime (critical path) includes cost-enforcement: tracks cumulative `query()` cost + aborts when cumulative exceeds `perPipelineMaxUsd`. That's a reactive cap — the pipeline stops when budget runs out, mid-run.

Better UX: at gate 5 (credentials file-drop — the last HITL point before build tier starts spending real money), the orchestrator previews "estimated cost for remaining build stages: $45 (±$15)". The user can choose to commit, raise the budget cap, or defer integrations before the autonomous spend begins.

## Why deferred

Reactive cost-cap in task-035 handles the worst case (runaway spend). Preview is a POLISH — nice for budget-conscious users but not a blocker for first autonomous run. We don't have historical data to project estimates against yet anyway — first run teaches us what builders + tester + reviewer actually cost.

## Rough shape when it's time

Add a step between gate 5 (credentials approved) and architect stage in task-035:

1. Read `tasks.yaml.features[]` from PM output
2. Sum: `features × avg-tasks-per-feature × avg-tokens-per-task × model-price`
3. Factor in: tester passes per feature (~3x read + 1x author); reviewer passes (~1x); any kit-change-request detour probability
4. Display in terminal + write to `docs/cost-projection.md`:
   ```
   Projected build cost: $42-$65
     backend-builder: 12 tasks × ~$1.80 ≈ $21.60
     web-frontend-builder: 28 tasks × ~$1.20 ≈ $33.60
     tester: $12
     reviewer: $8
   Your cap: $80. Proceed? (file-drop: docs/cost-projection-confirmed.txt)
   ```

Estimated size: small plan. ~150 LOC + historical-data feed from `plans/archive/` lessons + docs/lessons.md telemetry.

## When to revisit

After 3-5 autonomous runs have shipped + we have real-cost-per-feature data to calibrate against. Without that baseline, projections are wild guesses.

## Related

- `factory-upgrade` flow could seed projections from `docs/lessons.md` aggregated cost data
- `/quickstart` command would display estimated total cost before starting
