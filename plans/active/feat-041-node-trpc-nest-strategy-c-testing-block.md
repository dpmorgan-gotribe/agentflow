---
id: feat-041-node-trpc-nest-strategy-c-testing-block
type: feature
status: completed
completed-at: 2026-04-30
approved-at: 2026-04-30
approved-by: human
author-agent: claude-opus-4-7
created: 2026-04-30
updated: 2026-04-30
parent-plan: investigate-012-factory-readiness-pre-builds
supersedes: null
superseded-by: null
branch: feat/quota-observability
affected-files:
  - .claude/skills/agents/back-end/node-trpc-nest/SKILL.md
feature-area: orchestration
priority: P1
attempt-count: 0
max-attempts: 5
---

# feat-041 — node-trpc-nest §Testing block declaring Strategy C

## Problem Statement

F3a of `investigate-012`. The `node-trpc-nest` back-end stack skill exists but lacks a §Testing block declaring its E2E data-seeding strategy. Per the testing-policy.md feat-038 Phase 0 contract, every back-end stack skill must declare which strategy (A / C / D) applies based on its persistence_layer + document the per-strategy contract:

- For Strategy C (real-DB): the `/test/seed` + `/test/cleanup` endpoint contract gated by `ENABLE_TEST_SEED=1`
- The vitest commands (with + without coverage)
- Cross-tier package conventions
- §Files NOT to modify (scaffold-owned)

Without this, `book-swap-pre-build` (postgres + tRPC + Nest, the first Strategy C consumer) cannot run `/build-to-spec-verify` cleanly — the verifier doesn't know the seed/cleanup contract to invoke.

## Approach

### Phase 1 — Mirror python-fastapi §3 structure

The `python-fastapi/SKILL.md §3` already declares Strategy C/D for FastAPI. Mirror its structure for node-trpc-nest:

- §Testing strategy declaration (Strategy C when database != null, Strategy D when database == null)
- `/test/seed` + `/test/cleanup` endpoint contract — same JSON shape as python-fastapi
- `ENABLE_TEST_SEED=1` env gate
- vitest run commands with `--coverage`
- Mocking patterns specific to tRPC (mock the tRPC router for unit tests; integration tests hit a test database)

### Phase 2 — Cross-tier package conventions

Per bug-026, document that cross-tier shared packages (e.g. `@repo/api-client`) must NOT use `.js` extensions in TypeScript imports — same convention as python-fastapi §6.5.

### Phase 3 — Self-validate via skills-audit

Run `node scripts/skills-audit.mjs --scope=build projects/book-swap-pre-build` (when book-swap-pre-build's architecture.yaml resolves) — should report no missing skills for the back-end slot.

## Rejected Alternatives

- **Defer until book-swap-pre-build's Mode B run** — the orchestrator dispatches stack skills BEFORE Mode B starts; missing §Testing is a Mode B blocker. Ship preemptively.
- **Generic "node-backend" skill instead of node-trpc-nest specific** — tRPC + Nest patterns differ from plain Express. Specificity wins.

## Expected Outcomes

- [ ] node-trpc-nest/SKILL.md has full §Testing block per testing-policy.md template
- [ ] `/test/seed` + `/test/cleanup` contract documented with example payload shapes
- [ ] `skills-audit --scope=build` for book-swap-pre-build reports no gaps
- [ ] Sync to projects (book-swap-pre-build is gitignored on .claude/skills, so manual copy)

## Validation Criteria

- Compare structure to python-fastapi §3 — should be 1:1 isomorphic
- Lint-check via existing `node scripts/verify-stack-reviews.mjs`
- skills-audit run produces no `missingSkills[]` entries for book-swap-pre-build's back-end slot

## Attempt Log

(empty — pending; ships ahead of book-swap-pre-build's Mode B run per investigate-012 step 7.)
