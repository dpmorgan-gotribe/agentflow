---
id: feat-004-builder-tdd-hybrid
type: feature
status: draft
author-agent: human
created: 2026-04-22
updated: 2026-04-22
parent-plan: investigate-001-post-design-pipeline-architecture
supersedes: null
superseded-by: null
branch: feat/builder-tdd-hybrid
affected-files:
  - scaffolding/14-028-backend-builder-agent.md
  - scaffolding/15-029-web-frontend-builder.md
  - scaffolding/16-030-mobile-frontend-builder.md
  - scaffolding/17-031-tester-agent.md
  - .claude/skills/agents/front-end/react-next/SKILL.md # add test-generation idioms
  - .claude/skills/agents/front-end/svelte-kit/SKILL.md
  - .claude/skills/agents/back-end/node-trpc-nest/SKILL.md
  - .claude/skills/agents/back-end/python-fastapi/SKILL.md
  - .claude/skills/agents/mobile/expo-rn/SKILL.md
feature-area: builders
priority: P2
attempt-count: 0
max-attempts: 5
---

# feat-004-builder-tdd-hybrid: Builders write + confirm happy-path unit tests; tester owns edge cases + integration + E2E

## Problem Statement

Current spec (`scaffolding/17-031-tester-agent.md`) assigns ALL test writing to the tester agent after builders complete. Builders only run `pnpm typecheck` + `pnpm lint` — no test-level signal while building. Consequences:

- Builders can't catch unit-level regressions during their build loop; tests only surface after tester runs, potentially many tasks later
- Tester has to reverse-engineer the builder's implementation choices to write unit tests — the tester didn't write the code, so it guesses at invariants the builder knew
- Tester becomes a bottleneck: all test writing + all test execution for an entire project flows through one agent

Closes question **Q3** of `investigate-001-post-design-pipeline-architecture`. User asked: _"do we make builders write and confirm tests as per TDD - and tester build the e2e test and runs tests as a whole."_

Investigation landed on a **hybrid** — builders write happy-path unit tests alongside their code; tester adds edge cases + integration + E2E + runs the full suite. Neither pure TDD (too slow for AI builders) nor pure post-build (misses unit-level invariants).

Depends on **feat-002-stack-skill-shelf** — stack skills carry the test-generation idioms per stack (Vitest for react-next, pytest for python-fastapi, etc.).

## Approach

1. **Rewrite `scaffolding/14-028-backend-builder-agent.md`** steps:
   - After each feature implementation file is written (router, service, resolver), generate a sibling `.test.ts` (or `_test.py`) with happy-path cases
   - Happy path = the canonical success path the task spec describes. Not edge cases, not exhaustive.
   - Run `pnpm test <file>` (or stack-specific equivalent from the stack skill) — if fail, retry up to 2 times before escalating
   - Only after tests pass, move to the next task in the feature
   - Self-verify step 7 changes: `pnpm typecheck && pnpm lint && pnpm test` (was `typecheck && lint`)

2. **Rewrite `scaffolding/15-029-web-frontend-builder.md` + `scaffolding/16-030-mobile-frontend-builder.md`** with the same pattern:
   - For each React component, generate a sibling `.test.tsx` with `@testing-library/react` covering the component's rendered output + key interactions
   - For mobile, jest-expo + `@testing-library/react-native`
   - Run the stack's test command in self-verify

3. **Rewrite `scaffolding/17-031-tester-agent.md`** scope narrowing:
   - Tester reads builder-generated unit tests (sanity check: they exist + they pass)
   - Tester ADDS edge-case unit tests (error paths, boundary conditions, auth failures, rate limits) — NOT happy-path rewrites
   - Tester OWNS integration tests (cross-module: e.g., "auth middleware + session router")
   - Tester OWNS E2E (Playwright for web, Maestro for mobile)
   - Tester runs the FULL suite (builder tests + tester tests) and reports pass/fail with coverage numbers

4. **Update stack skills** with test-generation idioms per stack:
   - Each `SKILL.md` gets a §Testing block detailing: test file naming convention, test runner command, common patterns (how to mock a db, how to assert on tRPC input schemas, how to test a FastAPI dependency), minimum coverage expectations
   - Initial 5 stack skills (from feat-002) get this section filled

5. **Coverage threshold policy**: document in `.claude/rules/testing-policy.md` (new file) — builders aim for 60% line coverage of their implementation (happy path + obvious validation); tester raises total to 80% with edge cases + integration. Below 60% from builder → build loop retries once. Below 80% total after tester → human review flag.

6. **Budget + duration expectations**: stack skills document expected test-writing overhead per task (~15-25% on top of implementation time). Update `~/.claude/models.yaml` docs in the scaffolding to flag that builder stages should budget this.

## Rejected Alternatives

- **Alternative A: Pure TDD (red-green-refactor per builder)** — Rejected. AI builders don't get the benefit of the TDD discipline (internalized spec via test-first writing) that human developers do; they write code and tests equally well. Red-green-refactor just doubles turns without quality gain.

- **Alternative B: Pure post-build testing (current spec, keep as-is)** — Rejected. The investigation showed tester becomes a bottleneck; builders can't catch regressions mid-loop; tester has less context than the builder that just wrote the code. Hybrid is strictly better.

- **Alternative C: Snapshot-only testing from builders** — Rejected. Snapshots catch regressions but don't assert correctness. Builders writing real unit tests (arrange/act/assert) produce better invariant coverage.

## Expected Outcomes

- [ ] Builder scaffolding files (028/029/030) each include a step "Generate sibling .test.{ts,tsx,py} file after implementation; run stack-specific test command; retry up to 2 times on failure"
- [ ] Tester scaffolding file (031) narrows scope to edge cases + integration + E2E + full-suite run; removes happy-path unit-test generation
- [ ] Each of the 5 initial stack SKILL.md files (from feat-002) has a §Testing block with file-naming convention, test runner command, mocking patterns, min coverage expectation
- [ ] `.claude/rules/testing-policy.md` documents the 60% (builder) / 80% (total after tester) coverage policy + what happens when thresholds miss
- [ ] Manual smoke test: synthetic backend task → backend-builder produces both `auth.router.ts` and `auth.router.test.ts` → test passes → task marked done

## Validation Criteria

**Scaffolding coherence:**

- Tester scaffolding file (031) no longer contains "generate unit tests" in its scope
- Each builder scaffolding file (028/029/030) mentions test generation explicitly + a retry rule for test failures

**Stack skill updates:**

- Each of 5 initial SKILL.md files: §Testing block exists, names the exact test runner command for that stack, shows one example test (not a full suite — just the pattern)

**Policy file:**

- `.claude/rules/testing-policy.md` explicitly lists the two thresholds + what triggers a retry vs human review

**Coverage instrumentation:**

- Builder self-verify step reads coverage from the stack's test runner output (e.g. `vitest run --coverage`) and asserts >=60%. This is scaffolding spec only for this plan; implementation is a future concern.

## Attempt Log

<!-- Populated by executing agent. -->
