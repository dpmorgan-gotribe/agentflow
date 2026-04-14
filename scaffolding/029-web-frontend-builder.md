---
task-id: "029"
title: "Web Frontend Builder Agent"
status: pending
priority: P2
tier: 7 — Build Pipeline
depends-on: ["020", "027"]
estimated-scope: medium
---

# 029: Web Frontend Builder Agent

## What This Task Produces
1. Agent definition at `.claude/agents/web-frontend-builder.md`
2. Skill at `.claude/skills/build-web-frontend/SKILL.md`

## Scope

### Agent Definition
```yaml
---
name: web-frontend-builder
description: Builds React and Next.js frontend components from architecture specs. Generates apps/web/ and apps/admin/.
tools: Read, Write, Edit, Bash, Grep, Glob
model: inherit
permissionMode: acceptEdits
maxTurns: 30
skills:
  - react-patterns
  - tailwind-conventions
---
```

### System Prompt
- Senior React/Next.js developer
- Next.js 15 App Router with file-based routing
- Tailwind CSS 4 + shadcn/ui components
- Read architecture.yaml and screen mockups
- Use `@repo/ui` components before creating new ones
- Use `@repo/tokens` for all design tokens
- Run `pnpm typecheck` after every file created

### /build-web-frontend Skill
1. Read architecture.yaml web/admin sections
2. Read approved screen mockups from `docs/screens/`
3. Generate Next.js pages (file = route)
4. Generate components using shadcn/ui + tokens
5. Wire up tRPC client from `@repo/api-client`
6. Write to `apps/web/` and `apps/admin/`
7. Run typecheck and lint

### Runs in Parallel
Web and mobile frontend builders run concurrently after backend is complete.

## Acceptance Criteria
- [ ] `.claude/agents/web-frontend-builder.md` exists
- [ ] `.claude/skills/build-web-frontend/SKILL.md` exists
- [ ] References correct stack: Next.js 15, Tailwind, shadcn/ui
- [ ] Uses shared packages (@repo/ui, @repo/tokens, @repo/api-client)
- [ ] Self-validation step included

## Human Verification
Is the separation between web and admin apps clear? Should they share more code or be more independent?
