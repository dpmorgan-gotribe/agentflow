---
task-id: "026"
title: "Turborepo + pnpm Workspace Scaffold"
status: pending
priority: P2
tier: 7 — Build Pipeline
depends-on: ["001"]
estimated-scope: medium
---

# 026: Turborepo + pnpm Workspace Scaffold

## What This Task Produces
The monorepo skeleton with Turborepo configuration, pnpm workspace, and empty app/package stubs.

## Scope

### Root Files
- `package.json` — workspace root with scripts
- `pnpm-workspace.yaml` — defining `apps/*` and `packages/*`
- `turbo.json` — task pipeline from blueprint lines 2560-2571
- `tsconfig.json` — base TypeScript config

### App Stubs (empty directories with package.json)
- `apps/admin/` — Next.js 15 admin portal
- `apps/web/` — Next.js 15 web portal
- `apps/mobile/` — Expo mobile app
- `apps/api/` — tRPC backend

### Package Stubs (empty directories with package.json)
- `packages/ui/` — shared components
- `packages/types/` — Zod schemas + TS types
- `packages/tokens/` — design tokens
- `packages/api-client/` — tRPC client + hooks
- `packages/utils/` — shared business logic
- `packages/eslint-config/` — shared ESLint config
- `packages/typescript-config/` — shared TS configs

### turbo.json
```json
{
  "$schema": "https://turborepo.com/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": [".next/**", "dist/**"] },
    "dev": { "persistent": true, "cache": false },
    "lint": { "dependsOn": ["^lint"] },
    "typecheck": { "dependsOn": ["^typecheck"] },
    "test": { "dependsOn": ["^build"] }
  }
}
```

### Update justfile
Add monorepo-aware recipes to the justfile from Task 010.

## Acceptance Criteria
- [ ] `pnpm-workspace.yaml` lists all apps and packages
- [ ] `turbo.json` has correct task pipeline
- [ ] Each app/package stub has a `package.json` with correct name (@repo/*)
- [ ] `pnpm install` runs without errors
- [ ] `pnpm turbo build` runs (even if apps are empty)

## Human Verification
Does the monorepo structure match your expectations? Any packages missing or unnecessary?
