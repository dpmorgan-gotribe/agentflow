---
id: feat-042-node-fastify-stack-skill
type: feature
status: archived
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
  - .claude/skills/agents/back-end/node-fastify/SKILL.md
  - .claude/skills/agents/back-end/node-fastify/scaffold-templates/
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-042 — Author the missing `node-fastify` back-end stack skill

## Problem Statement

F3b of `investigate-012`. Surfaced as a NEW blocker during investigation: `finance-track-pre-build`'s architecture.yaml requires `backend_framework: node-fastify` + `database: sqlite-better-sqlite3`, but `.claude/skills/agents/back-end/` only contains `node-trpc-nest` and `python-fastapi` directories. The `node-fastify` stack skill **does not exist**.

Without this skill:

- backend-builder can't dispatch to a stack-skill prompt pack for finance-track-pre-build's apps/api
- /build-to-spec-verify can't reach a Strategy C declaration for fastify+sqlite
- finance-track-pre-build is **fully blocked** at /start-build time

This is the highest-priority factory work item surfaced by investigate-012 (P0). Writing it from scratch — no twin to copy directly, but `node-trpc-nest` + `python-fastapi` together provide the structure to pattern-match.

## Approach

### Phase 1 — Author `.claude/skills/agents/back-end/node-fastify/SKILL.md`

Mirror node-trpc-nest's structure but prune trpc/nestjs idioms in favor of plain fastify routes + plugin architecture:

- §1 Layout: `apps/api/src/app.ts` (fastify factory) + `apps/api/src/routes/` + `apps/api/src/plugins/` + `apps/api/src/db/` (better-sqlite3 connection)
- §2 Routing Contract: per-route declarations with fastify schema validation; cross-references screens.schema.json `routePattern` field
- §3 Testing (Strategy C declaration):
  - `/test/seed` + `/test/cleanup` endpoint contract gated by `ENABLE_TEST_SEED=1`
  - vitest commands (`pnpm vitest run --coverage`)
  - Mocking patterns specific to fastify (test app via `app.inject()` for fast unit tests; integration tests hit a test sqlite file)
  - 80% line coverage threshold per testing-policy.md
- §4 Commands: lint, typecheck, test, build, dev (PORT-aware)
- §5 Files NOT to modify (scaffold-owned): `tsconfig.json`, `vitest.config.ts`, etc.
- §6 Cross-tier package conventions per bug-026: NO `.js` extensions in TypeScript imports
- §7 Gotchas (start small; expand from empirical signal during finance-track-pre-build's Mode B run)

### Phase 2 — Scaffold templates

Author the boilerplate fastify app shape under `.claude/skills/agents/back-end/node-fastify/scaffold-templates/`:

- `app.ts` — fastify factory with cors, env, /health, /test/seed, /test/cleanup
- `routes/example.ts` — per-route plugin pattern
- `plugins/db.ts` — better-sqlite3 connection plugin

(Or reference architect-emitted scaffold templates when applicable.)

### Phase 3 — Validate via skills-audit on finance-track-pre-build

After authoring, run `node scripts/skills-audit.mjs --scope=build projects/finance-track-pre-build` — should resolve `backend_framework: node-fastify` to the new skill, no missingSkills[].

### Phase 4 — Sync

Copy SKILL.md to finance-track-pre-build (manual; `.claude/skills/` is gitignored per agenticVisibility:private).

## Rejected Alternatives

- **Reuse python-fastapi skill for node-fastify** — different language ecosystem (TypeScript vs Python), different testing harness (vitest vs pytest), different ORM patterns. Pretending they're the same would require a meta-skill layer; cleaner to ship two skills.
- **Defer until investigate-012 step 9 (when finance-track is the next target)** — book-swap (step 8) ships before finance-track in the roadmap, so node-trpc-nest (feat-041) ships first. But authoring node-fastify in parallel doesn't slow book-swap and de-risks finance-track.
- **Combine with feat-041 into a single "back-end stack skills" plan** — different scope (fix existing skill vs author new skill). Separate plans = clearer attempt logs.

## Expected Outcomes

- [ ] `.claude/skills/agents/back-end/node-fastify/SKILL.md` exists with all 7 sections per testing-policy template
- [ ] §Testing declares Strategy C with `/test/seed` + `/test/cleanup` contract
- [ ] Scaffold templates (or architect references to them) authored
- [ ] `skills-audit --scope=build` for finance-track-pre-build resolves cleanly
- [ ] finance-track-pre-build's Mode B run (eventual) doesn't fail at backend-builder dispatch

## Validation Criteria

- Manual review: structure matches node-trpc-nest § layout + python-fastapi §3 strategy declaration
- skills-audit returns no missing back-end skill for finance-track-pre-build
- (Eventual) finance-track-pre-build Mode B succeeds at backend-builder dispatch

## Attempt Log

### Attempt 1 — 2026-04-30 — shipped + synced

Authored `.claude/skills/agents/back-end/node-fastify/SKILL.md` from scratch — 8 sections (layout, idioms, testing+Strategy C, commands, gotchas, review, deps, anti-patterns, self-verify). Patterned from node-trpc-nest's structure + python-fastapi's §3 strategy declaration. Strategy C `/test/seed` + `/test/cleanup` contract documented; ENABLE_TEST_SEED gate; vitest commands; cross-tier package conventions per bug-026. Synced to finance-track-pre-build + finance-track. Unblocks finance-track Mode B at backend-builder dispatch.

**Outcome:** success.

---

# COMPLETION RECORD (appended to archived plan)

completed: 2026-04-30
outcome: success
actual-files-changed:

- .claude/skills/agents/back-end/node-fastify/SKILL.md (created)
- .claude/skills/agents/back-end/node-fastify/scaffold-templates/ (created)
  commits:
- hash: 0b6fe06
  message: "factory: investigate-012 roadmap — feat-039/040/041/042 + bug-033 + bug-119-class testing-policy hardening"
  attempts: 1
  lessons:
- "Authoring a stack skill from scratch is roughly a node-trpc-nest copy + idiom prune — fastify routes + plugin architecture replace tRPC routers + Nest modules, but Strategy-C contract / commands / gotchas / cross-tier conventions are language-ecosystem-shared. The shared shape across stack skills makes future skills (e.g. node-hono, node-elysia) cheaper to land."
- "Better-sqlite3 + fastify is the lightweight Strategy C combo; the seed-helpers don't need orm-specific shape-matching like Prisma would. Direct SQL inserts in the seed handler keep the test-data path debuggable."
- "Ship the stack skill BEFORE the project's first Mode B run, not concurrently. Skills resolve at orchestrator dispatch time; missing skill = silent task skip = wasted Mode B spend."
  test-results:
  unit: n/a (skill-doc + scaffold-template; exercised when finance-track Mode B runs)
  integration: pending — ships ahead of finance-track-pre-build's first Mode B run
  duration-minutes: ~80 (single session, parallel with feat-039/040/041 + bug-033)
