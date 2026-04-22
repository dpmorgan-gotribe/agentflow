# Testing policy — hybrid TDD (feat-004)

Authoritative policy consumed by builders (tasks 028 / 029 / 030) + the tester (task 031). Referenced from `.claude/agents/*-builder.md` + `.claude/agents/tester.md` + every shipped stack skill's §Testing block.

## Who authors what

| Test layer                | Who writes it                                      | When                                  | Where                                                             |
| ------------------------- | -------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------- |
| Happy-path unit tests     | **Builder**                                        | Alongside each implementation file    | Sibling `.test.{ts,tsx,py}` inside feature worktree               |
| Edge-case unit tests      | **Tester**                                         | After builder completes               | Same stack-skill idioms; same `src/` tree                         |
| Component tests (UI)      | **Builder** (happy path) + **Tester** (edge cases) | During builder pass + tester pass     | Co-located `.test.tsx`                                            |
| Integration tests         | **Tester**                                         | After builder completes               | `apps/{app}/integration/` or `tests/integration/` per stack skill |
| E2E tests (web)           | **Tester**                                         | After all builders + integration pass | `apps/web/e2e/*.spec.ts` (Playwright)                             |
| E2E tests (mobile)        | **Tester**                                         | Same                                  | `apps/mobile/.maestro/*.yaml` (Maestro)                           |
| Full-suite run + coverage | **Tester**                                         | End of feature                        | Command from stack skill's §Commands block                        |

Rationale per `plans/active/investigate-001-post-design-pipeline-architecture.md` Q3: pure TDD is slow for AI builders; pure post-build tester misses unit-level invariants the builder knew best. Hybrid is the middle path.

## Coverage thresholds

| Threshold                                                     | Where measured                              | Set by  | Consequence of miss                                                                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **60% line coverage of implementation**                       | Builder's own self-verify step              | Builder | Build loop retries once (up to 2× per task); persistent miss → feature marked `failed`, orchestrator routes to human review                            |
| **80% line coverage total** (builder + tester tests combined) | Tester's `--coverage` run at end of feature | Tester  | `policyCheck: "fail"` in return JSON; orchestrator marks feature `needs-human-review` at gate 4 (sign-off invalidated if coverage regresses below 80%) |

Coverage parsed from the stack skill's test runner output. Each shipped stack skill names the coverage flag explicitly:

- Vitest: `pnpm vitest run --coverage`
- Jest (expo): `pnpm jest --coverage`
- pytest: `uv run pytest --cov=api --cov-report=term-missing`

## What counts as "happy path"

A builder's happy-path test covers:

1. The **canonical success case** of each public function / endpoint / component — the signature the task spec describes.
2. The **primary branch** of any non-trivial conditional. Example: `if (user.tier === "paid")` gets one test with a paid user; edge cases (null user, malformed tier, etc.) are tester territory.
3. **Input validation** at the public boundary — but only the positive case ("valid input produces expected output"); rejection of malformed input is tester territory.

Explicitly NOT happy path (tester writes these):

- Error paths (network failures, DB timeouts, auth rejections, rate-limit hits)
- Boundary conditions (empty arrays, zero-length strings, max-int overflow, negative numbers)
- Concurrency races (two writes arriving same millisecond, dropped connections mid-transaction)
- Malformed input (wrong types, missing required fields, XSS-style strings, unicode edge cases)
- Cross-module interactions (auth middleware + session router behavior when redis is down)

## What counts as a "genuine product bug"

When the tester authors an edge-case test and the implementation fails it, two things could be true:

- **Tester's test is wrong** — the test's arrange/act/assert logic doesn't match the spec. Tester iterates (max 3 attempts).
- **Builder's implementation is wrong** — the test caught a real bug. Tester adds it to `genuineProductBugs[]` in its return JSON; orchestrator routes back to the builder for a fix attempt (per refactor-004 per-task retry: max 3).

Tester uses a bias: if a failing test matches the task spec's success criteria cleanly, it's a genuine bug. If it requires interpretive latitude to call "correct behavior", it's test-authoring noise.

## Stack-skill integration

Every shipped stack skill (`.claude/skills/agents/{tier}/{stack-slug}/SKILL.md`) has a §Testing section documenting:

- Test-file naming convention
- Test runner command (with + without coverage)
- Mocking patterns (db, http, clock, tRPC, etc.)
- One example test (arrange / act / assert in the stack's idiom)
- Minimum coverage expectation — restated from THIS file so the builder sees the threshold in its dispatch context

Future stack skills added by `/skills-audit --scope=build --auto-author-stack-skills` must fill the §Testing section against this policy.

## When this policy doesn't apply

- **Data-only tasks** (seed scripts, data migrations, one-off cron jobs) — happy-path test required, edge-case + integration + E2E not required. PM should group these into single-task features with `agent_sequence: [backend-builder, reviewer]` (no tester step).
- **Config-only changes** (bump a dependency, update a token) — no new tests; tester runs the full existing suite unchanged to confirm no regression.
- **Stack-skill-declared exceptions** — a stack skill's §Testing block may narrow or widen these defaults for its ecosystem (e.g. Flutter's integration_test framework pattern may restructure what counts as "integration" vs "E2E").

## Retry ladder (cross-references refactor-004)

- **Builder test-authoring failure** → builder retries (max 2× per task) with stack-skill §Gotchas as hint-context.
- **Tester test-authoring failure** (tester's own bug) → tester retries (max 3 iterations).
- **Tester flags a genuine product bug** → task marked failed; orchestrator re-invokes builder with tester's failing test as context (per-task retry, max 3).
- **All retries exhausted** → feature marked `failed` in tasks.yaml; human review at gate 4.

## Cross-references

- `scaffolding/14-028-backend-builder-agent.md` §TDD policy — binds to this file
- `scaffolding/15-029-web-frontend-builder.md` §TDD policy — binds to this file
- `scaffolding/16-030-mobile-frontend-builder.md` §TDD policy — binds to this file
- `scaffolding/17-031-tester-agent.md` §Testing Strategy — binds to this file
- `plans/active/feat-004-builder-tdd-hybrid.md` — the plan that introduced this file
- Each shipped stack skill's §Testing block (`.claude/skills/agents/{tier}/{stack-slug}/SKILL.md`)
