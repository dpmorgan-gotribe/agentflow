---
id: feat-009-tester-implementation
type: feature
status: completed
approved-at: 2026-04-23
approved-by: human
completed-at: 2026-04-23
author-agent: human
created: 2026-04-23
updated: 2026-04-23
parent-plan: investigate-002-build-tier-readiness-gap
supersedes: null
superseded-by: null
branch: feat/tester-implementation
affected-files:
  - packages/orchestrator-contracts/src/tester.ts
  - packages/orchestrator-contracts/tests/tester.test.ts
  - .claude/agents/tester.md
  - .claude/skills/tester/SKILL.md
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-009-tester-implementation: `/tester` agent + skill (hybrid-TDD edge-case owner)

## Problem Statement

Per feat-004 hybrid-TDD policy (shipped via `.claude/rules/testing-policy.md`), builders author happy-path unit tests alongside their implementation and verify via the stack skill's `lint && typecheck && test` block with 60% builder-scope coverage floor. The tester has a narrower, newer role:

- **Trust but verify** builder-generated tests — confirm they exist + pass
- **Add edge-case unit tests** (error paths, boundary conditions, auth failures, rate limits, malformed inputs, concurrency races)
- **Own integration tests** (cross-module: auth + session + cache interactions)
- **Own E2E tests** (Playwright for web, Maestro for mobile)
- **Run the full suite** and report coverage ≥ 80% total (per testing-policy)
- **Flag genuine product bugs** back to the last-writing builder via orchestrator's task-retry ladder

Tester is Mode B's quality gate — it follows builders in `feature.agent_sequence[]` and precedes reviewer.

Scaffolding at `scaffolding/17-031-tester-agent.md` (~130 lines) specifies the agent + skill. `.claude/rules/testing-policy.md` is already shipped and is the binding contract tester references.

## Approach

Four phases, same cadence as feat-008.

### Phase 1 — TesterOutput Zod contract + tests

1. Write `packages/orchestrator-contracts/src/tester.ts`:
   - `TesterTestLayer` enum: `"edge-case" | "integration" | "e2e"`
   - `GenuineProductBug`: `{ taskId, builderAgent, testFile, testName, failureMessage, likelyCause }` (routed back to builders for retry)
   - `TesterOutput`:
     ```
     { featureId, testsWritten: { edgeCase, integration, e2e }, testsRun: { total, passed, failed },
       coverageTotal (0-100), coverageBuilderOnly (0-100), policyCheck: "pass" | "fail" | "blocked",
       genuineProductBugs: GenuineProductBug[], headSha, warnings }
     ```
2. Re-export via index.ts
3. Write `packages/orchestrator-contracts/tests/tester.test.ts` — ≥6 tests covering happy-path, policy-check enum, genuine-product-bugs populated vs empty, coverage invariants

**Exit**: contracts tests green, count ≥110.

### Phase 2 — Agent definition

1. Write `.claude/agents/tester.md` per scaffolding L36-47:
   - Frontmatter: tools (Read, Write, Edit, Bash, Grep, Glob), model:inherit, maxTurns:30, effort:medium, mcp_servers:[]
2. System prompt:
   - **Narrow scope.** Tester does NOT author happy-path unit tests — that's the builder's job (feat-004). Duplicate happy-path is explicitly forbidden.
   - **Trust-but-verify** builder tests: walk `src/`, confirm every non-test source has a sibling test, run them first.
   - **Edge-case unit tests** focused on: error paths, boundary conditions, auth failures, rate limits, malformed inputs, concurrency hazards, off-by-one.
   - **Integration tests** for cross-module interactions (auth + session + cache; db migration + data model).
   - **E2E tests** for feature user flows (Playwright web, Maestro mobile). Backend-only features skip E2E.
   - **Coverage ≥80% total** (builder + tester combined) per testing-policy.md. Below floor → iterate up to 3 times OR flag as blocker.
   - **Genuine product bugs** surfaced via `genuineProductBugs[]` return field; orchestrator routes back to the implementing builder for retry.
   - **Worktree CWD**, `.feature-context.json` agent_history append (same pattern as builders).

### Phase 3 — Skill (dispatcher + test authoring)

1. Write `.claude/skills/tester/SKILL.md` with frontmatter: `name: tester`, `argument-hint: "--feature-id=<feat-...> [--skip-e2e]"`.
2. Accept `--feature-id=<feat-...>` (required); reject missing.
3. **Steps**:
   - Argument gate + project-root walk
   - Load architecture.yaml; for each tier present (web/mobile/backend — not null), load the stack skill's §Testing block verbatim
   - Load `.claude/rules/testing-policy.md`
   - Filter tasks.yaml to `agent === "tester"` + feature.skip[] honored
   - Confirm worktree CWD (read + validate `.feature-context.json`, feature-id match)
   - Per task:
     - **Sanity check** builder tests: walk `src/`; every non-test source file should have a sibling test; run the stack's test command first; on any fail OR coverage <60% on builder scope → warning, continue
     - **Author edge-case unit tests** (stack-specific patterns from each stack skill §Testing)
     - **Author integration tests** (testcontainers postgres for node/python stacks; mocked-backend for frontend)
     - **Author E2E tests** — web: `apps/web/e2e/{feature-id}.spec.ts` (Playwright); mobile: `apps/mobile/.maestro/{feature-id}.yaml` (Maestro). `--skip-e2e` flag skips this step (useful for backend-only features).
     - Commit each test file: `git add <files> && git commit -m "test({task.id}): <summary>"`
   - **Run full suite** with coverage flag; parse total coverage
   - **Retry loop** (max 3 iterations): on test-authoring failure (your tests fail), adjust + retry; on builder-code failure (canonical success path breaks), flag as `genuineProductBugs[]` entry and stop
   - Append ONE agent_history entry (`agent: "tester", op: "execute-tasks"`); set `last_writing_agent: "tester"` if ≥1 commit
   - Return `TesterOutput` JSON

**Exit**: skill registered (visible in available-skills list); invoking without `--feature-id=` returns clean rejection.

### Phase 4 — Smoke test against the feat-008 scratch repo's backend-builder output

Reuse the scratch repo at `projects/backend-builder-smoke-20260423-013328/` from feat-008's Phase 4. It has a clean main with the backend-builder's 8 committed files. The smoke test:

1. **Bootstrap** via /git-agent against the scratch repo's main (should be clean).
2. **Checkout a new feature worktree** for a synthetic "test-coverage-followup" feature — OR reuse the existing `feat-core-data-model.closed.json` and restage to test against.
3. Actually, simpler: **synthesize a fresh feature** on the scratch repo for tester alone. Create a minimal `docs/tasks.yaml` v2 with one feature, one task (`agent: tester`), `skip: [web, mobile]` (backend-only). The test target: the backend-builder-produced `apps/api/src/knowledge-graph/knowledge-graph.service.ts`.
4. **Invoke tester subagent** with `--feature-id=<slug> --skip-e2e`:
   - Load architecture + testing-policy + backend stack skill §Testing
   - Walk apps/api/src/, confirm sibling tests exist (backend-builder wrote `knowledge-graph.service.test.ts`)
   - Author edge-case tests targeting the builder's canonical methods: error paths, null inputs, empty results from traverse, concurrent-modification scenarios
   - Skip integration + E2E (backend-only, --skip-e2e flag, integration requires testcontainers which needs a real install)
   - Attempt to run stack skill's test block; document limitations (no pnpm install in scratch — same as feat-008 Phase 4)
   - Return TesterOutput with the edge-case tests written + warnings documenting the install-skip
5. **Close-feature** via /git-agent — merge the tester's test-only commit to main. Confirm merge commit.
6. **Cleanup** — scratch repo persists per prior convention; flagged for user cleanup.
7. Archive plan.

**Exit**: tester skill produces real edge-case test files committed to a feature worktree's merge-to-main flow. TesterOutput validates against schema.

## Rejected Alternatives

- **Alternative A: Bundle tester with reviewer (feat-010) since they both run post-builder** — Rejected. Tester owns tests + coverage; reviewer owns code-quality + security + architecture-drift. Different skill-specific patterns (testing frameworks vs lint/scan tools). Bundling conflates the roles. Keep separate.

- **Alternative B: Tester also writes happy-path tests (hybrid-with-hybrid fallback)** — Rejected. feat-004 explicitly moved happy-path to builders; having tester duplicate is wasted tokens + creates test-authoring collision ("who owns the canonical-success-case test?"). Sharp role split is correct per hybrid-TDD policy.

- **Alternative C: Smoke-test against mindapp-v2's real architecture + full apps/api/ install** — Rejected. Same reason as feat-008 Phase 4: no real `pnpm install` in scratch = no real test run. The scratch repo pattern proves the DISPATCH + AUTHORING flow. A real end-to-end pipeline run post-feat-010 will exercise the full install + test cycle.

- **Alternative D: Author E2E tests in Phase 4 smoke** — Rejected. E2E requires a running dev server; scratch repo can't provide one without real install. `--skip-e2e` flag in the skill + backend-only scope in Phase 4 = clean validation of the non-E2E paths. E2E paths are documented in the skill + stack-skill §Testing blocks but exercised when a UI feature first runs end-to-end.

- **Alternative E: Defer `genuineProductBugs` feedback loop to a future plan** — Rejected. It's the tester's primary escape hatch when a builder's implementation genuinely breaks tester's valid edge-case tests. Without this field, tester retry-ladders uselessly on what's actually a builder bug. Shipping the shape now (even if the orchestrator's routing logic is light) lets the contract settle.

## Expected Outcomes

- [ ] `packages/orchestrator-contracts/src/tester.ts` + `tests/tester.test.ts` ship; contracts test count ≥110
- [ ] `.claude/agents/tester.md` exists; narrow-scope mandate in system prompt; no happy-path-test-authoring language
- [ ] `.claude/skills/tester/SKILL.md` registered in available-skills list
- [ ] Invoking `/tester` without `--feature-id=` returns a clear rejection
- [ ] Smoke test: in the feat-008 scratch repo, tester subagent writes real edge-case test files, commits them to a feature worktree, closes to main via git-agent
- [ ] TesterOutput JSON from smoke test validates against the Zod schema
- [ ] `.feature-context.json` agent_history[] populated + lockfile still schema-valid
- [ ] All existing 103 contracts tests still pass; 112 orchestrator tests still pass
- [ ] Plan archived with lessons

## Validation Criteria

**Skill coverage:**

- Rejects invocations without `--feature-id=`
- `--skip-e2e` flag skips E2E step cleanly (no Playwright / Maestro command attempts)
- Tier-skipped features (feature.skip[] excludes all tester-relevant tiers) → tier-skipped warning + empty testsWritten
- Stack-skill-missing → abort with skills-audit pointer (same pattern as builders)

**Smoke-test coverage:**

- Tester's edge-case tests actually run (or fail cleanly with the "no install" warning, same pattern as feat-008)
- Tester does NOT author happy-path tests for functions the builder already covered — grep the tester's output for canonical-success-case descriptions → zero matches matching the builder's canonical test names
- `genuineProductBugs[]` returns empty for this smoke (no builder bugs synthesized)

**No regression:**

- `pnpm test:all` green across contracts + orchestrator
- Nothing in `orchestrator/` source changes — additive
- Factory repo untouched by smoke test (scratch repo lives under `projects/*` gitignored path)

## Attempt Log

### Attempt 1 — 2026-04-23 (succeeded across all 4 phases)

4 commits on `feat/tester-implementation` + 1 gap-fix commit:

- Phase 1: `packages/orchestrator-contracts/src/tester.ts` — TesterOutput + TesterTestLayer enum + GenuineProductBug (routed-back-to-builder shape) + FullSuiteRun. 18 new tests. Contracts now at 121.
- Phase 2: `.claude/agents/tester.md` — narrow-scope per feat-004 hybrid-TDD: no happy-path authoring, trust-but-verify builder tests, own edge-case + integration + (optional) E2E, coverage ≥80% total, genuineProductBugs feedback loop.
- Phase 3: `.claude/skills/tester/SKILL.md` — 8-step dispatcher with retry ladder (≤3 iterations) distinguishing tester-authoring bugs vs genuine product bugs; `--skip-e2e` flag for backend-only features.
- Phase 4 smoke test: reused feat-008 scratch repo. Synthesized `feat-test-coverage-knowledge-graph` feature. Tester subagent wrote **33 edge-case tests across 2 files** (knowledge-graph.service.edge-cases.test.ts + seed.edge-cases.test.ts), committed with `test:` conventional-commit prefix, merged to main via close-feature. TesterOutput validated.
- Fix commit: step-2 ambiguity ("load-then-filter" vs "filter-then-load") clarified per Phase 4 gap finding.

**Phase 4 artifacts on the scratch repo's main branch:**

```
*   6c7e820 Merge feat/test-coverage-knowledge-graph: feat-test-coverage-knowledge-graph
|\
| * ce88872 test(...): edge-case tests for seed.slugify (8 tests)
| * 111b19e test(...): edge-case tests for KnowledgeGraphService (25 tests: error paths, empty graphs, depth clamps, lifecycle)
|/
* 2da6777 chore: add feat-test-coverage-knowledge-graph for tester smoke test
* 72c1301 (previous feat-008 merge) ...
```

## Lessons Learned

**Gap 1 (fixed in SKILL.md): "load-then-filter" is wasteful — prefer "filter-then-load".** Original step 2 said "for each tier present in tooling.stack.\*, load the stack skill". In a 3-tier project with a backend-only feature (feature.skip: [web, mobile]), this would load web + mobile stack skills for zero benefit — pure prompt noise. Updated step 2 explicitly: filter tasks first (step 3), THEN load stack skills for tiers that survive filtering. Survival rule: non-null framework + not in feature.skip[] + ≥1 task targeting that tier's app directory.

**Gap 2 (documented, not fixed — stack-skill improvement candidate): seed scripts need DI seams OR integration-only scope.** `seed.ts::seedPsychology` + `seedKnowledgeGraph` instantiate `PrismaClient` + `neo4j.driver` at module level — no way to unit-test. Tester scoped seed edge cases to `slugify` boundaries only (pure function). In real pipeline with installed deps, tester would push these to the integration tier with testcontainers-postgres. **Action**: add to node-trpc-nest stack skill's §Gotchas: "Seed scripts: export inner helpers for unit-testing OR scope their tests to integration tier".

**Gap 3 (documented): `.test.ts` test-isolation hazard.** Edge-case tests that mutate `process.env` or module-level state will leak across sibling tests if vitest parallelizes. Tester's lifecycle-edge-cases used `try/finally` to restore env — correct defensive shape. **Action**: add to node-trpc-nest stack skill's §Gotchas: "vitest-config.ts should set `pool: 'forks', isolate: true` when testing modules with env-var read-sites".

**Gap 4 (documented, contract limitation): `coverageBuilderOnly: 0` when runner is blocked is semantically ambiguous.** 0 could mean "zero coverage" OR "unknown". The Zod schema enforces `0..100`, so "unknown" can't be represented. Consumers must gate on `policyCheck === "blocked"` before trusting coverage numbers. **Action**: either make the coverage fields nullable in a follow-up contract refactor (minor semver bump), OR document the "gate on policyCheck" rule more prominently in the Zod comments. Current smoke test's `policyCheck: "blocked"` + coverage: 0 is correctly interpretable, but future consumers may miss this.

**`.git/info/exclude` idempotency confirmed.** Phase 4 re-used the scratch repo from feat-008 — `.feature-context.json` was already in `.git/info/exclude` from the earlier run. The skill's "check before append" logic correctly no-op'd. Good idempotent shape; working as designed.

**Builders' §Testing stack-skill content DRIVES tester's authoring quality.** Tester authored realistic Vitest edge cases by reading node-trpc-nest's §Testing block verbatim. The quality of tester output is directly proportional to the quality of the stack skill's §Testing content. **Implication**: future stack-skill additions need substantive §Testing blocks (runner setup, mocking idiom, example test, anti-patterns) to give tester authoring context. A thin stub §Testing block = thin tester output.

**No-overlap-with-builder verified via grep.** Tester's 33 tests had zero canonical-test-name collisions with the builder's 5 happy-path tests. Hybrid-TDD role split held cleanly. Trust-but-verify pattern (run builder tests first, surface handoff warnings, don't rewrite builder code) also held — the scratch-repo install-skip surfaced as a documented warning, not a retry-loop.

**Scratch-repo reuse pattern works for cross-plan smoke tests.** feat-009 built on feat-008's scratch artifact (backend-builder's commits on main). Total new scratch setup time: a single commit adding the tester-only feature to tasks.yaml. **Implication**: feat-010 reviewer can reuse the same scratch repo — builder + tester commits already on main make a realistic reviewer input. Keep the scratch repo around until the feat-011+ first live mindapp-v2 Mode B run retires the pattern.

## Follow-up Work Unblocked

- **feat-010 reviewer** — next critical-path plan. Reviewer reads tester's test files + builder's implementation + architecture.yaml. Scratch repo is ready: builder commits + tester commits both on main. Same pattern as feat-008 / feat-009.
- **feat-011+ registrar skills** (task-010 skills-audit + task-011 register-mcp-servers) — clear the remaining Mode A dry-run halt stages. After reviewer ships, the full agent_sequence chain (builders → tester → reviewer) is validated; registrar work is cheap shelf-stocking.
- **First live Mode B run against mindapp-v2** — post-reviewer, post-registrars. Will exercise the real-install code path that smoke tests have bypassed.

Follow-ups NOT yet tested:

- **Web + mobile tester dispatch** — backend-only smoke didn't exercise web E2E (Playwright) or mobile E2E (Maestro) authoring paths. Deferred to first live run with UI features.
- **genuineProductBugs routing** — no synthesized product bugs in Phase 4. First failed-builder-test scenario will exercise orchestrator's task-retry-to-last-writing-builder routing.
- **Coverage-based retry ladder** — Phase 4 was install-blocked so coverage measurement was skipped; 3-iteration retry logic not exercised against real coverage numbers. First live run with passing install validates.
- **80% total coverage threshold** — can't be measured in install-skip mode. Will be validated on first real pipeline run.
