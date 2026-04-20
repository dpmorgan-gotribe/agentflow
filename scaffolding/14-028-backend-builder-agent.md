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

- Read `.claude/architecture.yaml` focusing on backend sections (apps.api, integrations with `deployment: vendor | self-hosted`)
- Read `docs/tasks.yaml` for assigned tasks
- **Read `.env` for runtime secrets** — user-authored at gate 5 (refactor-003) after `/architect` emits `.env.example` with placeholder rows. `block-dangerous.sh` (task 007) blocks general agent `.env` reads; backend-builder inherits a sanctioned exception because runtime config is load-bearing for build-and-test. Missing required-now keys surface as loud failures at container startup / first API call — correct failure mode since the user was warned at gate 5 via `docs/credentials-checklist.md`.
- Generate into `apps/api/`
- Use `@repo/types` for shared Zod schemas
- Run `pnpm typecheck` after every file created
- Follow the universal prompt template from blueprint lines 2632-2658

### Inputs

| Input                                                    | Source                                                  | Purpose                                                                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/architecture.yaml`                              | `/architect` output (refactor-003, post-signoff)        | Stack choices, integration vendors, data models, routing                                                                                     |
| `docs/tasks.yaml`                                        | `/pm --mode=tasks` output                               | Assigned backend tasks with `integration-ref` pointers                                                                                       |
| `.env`                                                   | User-authored at gate 5                                 | Runtime secrets: `STRIPE_SECRET_KEY`, `THIRDWEB_SECRET_KEY`, `RESEND_API_KEY`, etc. Must be filled before `/build-backend` runs.             |
| `.env.example`                                           | `/architect` output                                     | Reference for which keys exist; used for sanity-checking env vars referenced in generated code match what the architect told the user to set |
| `packages/types/`                                        | `/stylesheet` indirect + `@repo/orchestrator-contracts` | Shared Zod schemas                                                                                                                           |
| `packages/orchestrator-contracts/`                       | Task 034b                                               | Output schemas the backend validates against                                                                                                 |
| Self-hosted config templates in `docs/config/*.template` | `/architect` output for self-hosted integrations        | Pointers to deployment config, NOT built into the app                                                                                        |

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
