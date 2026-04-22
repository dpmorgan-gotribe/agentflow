# mutation-testing-policy

**Deferred from**: investigate-002-build-tier-readiness-gap §Additional consideration (a).

## The concern

`.claude/rules/testing-policy.md` caps at 80% line coverage. **Line coverage ≠ behavioural coverage.** A test suite can execute 100% of lines while a subtly-wrong implementation still passes — e.g. `if (x > 5)` mutated to `if (x >= 5)` often slips through branch-execution-only tests.

Mutation testing runs the test suite against intentionally-mutated code + counts how many mutations get caught. A well-tested module kills ≥80% of mutations; a weak suite kills <50%.

## Why deferred

Our first autonomous run targets "passes build + tests + reviewer". Mutation testing is a DEPTH concern — it makes good test suites better; it doesn't make bad test suites exist. We'll know our baseline test quality only after builders + tester have produced real output on mindapp-v2.

## Rough shape when it's time

**`refactor-006-mutation-testing-policy`** — extends testing-policy.md with:

- Stack-skill-specific mutation tools: Stryker (web TypeScript), mutmut (Python), pitest (JVM), go-mutesting (Go)
- Threshold: ≥75% mutation kill rate on builder-authored tests; ≥85% total after tester
- Runs: pre-merge in CI, not during per-task builder loop (too slow for inner loop)
- Output parser → `.claude/rules/testing-policy.md` gets a new §Mutation block

Estimated size: medium plan. ~300 LOC across stack-skill updates (each needs its mutation runner command) + new reviewer dimension + CI wiring.

## When to revisit

After mindapp-v2 ships from the first autonomous run. Look at the actual test output: if tester's tests are thorough, mutation testing is incremental. If tester's tests are thin, mutation testing catches a lot. Decide priority based on observed quality.

## Related

Reviewer's playbook dimension `test-quality` might want a mutation-coverage signal; initial playbook uses line coverage; upgrade when this plan lands.
