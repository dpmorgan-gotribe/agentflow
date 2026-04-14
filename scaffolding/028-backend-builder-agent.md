---
task-id: "028"
title: "Backend Builder Agent"
status: pending
priority: P2
tier: 7 — Build Pipeline
depends-on: ["020", "027"]
estimated-scope: medium
---

# 028: Backend Builder Agent

## What This Task Produces
1. Agent definition at `.claude/agents/backend-builder.md`
2. Skill at `.claude/skills/build-backend/SKILL.md`

## Scope

### Agent Definition
```yaml
---
name: backend-builder
description: Generates tRPC routers, Prisma schema, migrations, middleware, and authentication into apps/api/.
tools: Read, Write, Edit, Bash, Grep, Glob
model: inherit
permissionMode: acceptEdits
maxTurns: 30
---
```

### System Prompt
- Read `.claude/architecture.yaml` focusing on backend sections
- Read `docs/tasks.yaml` for assigned tasks
- Generate into `apps/api/`
- Use `@repo/types` for shared Zod schemas
- Run `pnpm typecheck` after every file created
- Follow the universal prompt template from blueprint lines 2632-2658

### /build-backend Skill
Steps:
1. Read architecture.yaml backend section
2. Generate Prisma schema from data models
3. Generate tRPC routers per module
4. Generate middleware (auth, logging, error handling)
5. Generate database migrations
6. Write to `apps/api/`, `packages/types/`, `packages/api-client/`
7. Run `pnpm typecheck` and `pnpm lint`
8. Report files created and any issues

## Acceptance Criteria
- [ ] `.claude/agents/backend-builder.md` exists
- [ ] `.claude/skills/build-backend/SKILL.md` exists
- [ ] System prompt references architecture.yaml
- [ ] Outputs to correct directories
- [ ] Self-validation step (typecheck) included
- [ ] `model: inherit` used (orchestrator assigns model)

## Human Verification
Is the scope right? Should backend building be split further (e.g., schema generation separate from route generation)?
