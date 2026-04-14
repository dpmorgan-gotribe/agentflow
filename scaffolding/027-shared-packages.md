---
task-id: "027"
title: "Shared Packages Skeleton (types, tokens, ui, api-client, utils)"
status: pending
priority: P2
tier: 7 — Build Pipeline
depends-on: ["026"]
estimated-scope: medium
---

# 027: Shared Packages Skeleton

## What This Task Produces
Working starter code for the five core shared packages that eliminate cross-app duplication.

## Scope

### @repo/types
- `packages/types/src/index.ts` — barrel export
- Example Zod schema + inferred TS type
- `package.json` with Zod dependency

### @repo/tokens
- `packages/tokens/src/index.ts` — token exports
- `packages/tokens/tailwind-preset.ts` — shared Tailwind theme from blueprint lines 726-746
- `packages/tokens/css-variables.css` — CSS custom properties
- Reads from `docs/asset-inventory.json` for user colors/fonts with fallback defaults

### @repo/ui
- `packages/ui/src/index.ts` — barrel export
- `packages/ui/src/primitives/` — placeholder for Button, Input, Card, etc.
- Platform variant pattern: `.web.tsx` / `.native.tsx` file convention documented

### @repo/api-client
- `packages/api-client/src/index.ts` — tRPC client setup
- Typed query hooks pattern

### @repo/utils
- `packages/utils/src/index.ts` — barrel export
- Pure business logic placeholder

### Each Package Gets
- `package.json` with correct name and dependencies
- `tsconfig.json` extending shared config
- `src/index.ts` barrel export

## Acceptance Criteria
- [ ] All five packages have working `package.json` and `tsconfig.json`
- [ ] `@repo/tokens` has the Tailwind preset with user asset fallback logic
- [ ] `@repo/ui` documents the platform variant pattern
- [ ] `pnpm typecheck` passes for all packages
- [ ] Cross-package imports work (e.g., `@repo/ui` imports from `@repo/tokens`)

## Human Verification
Review the token fallback logic — does user asset priority feel right? Review the platform variant pattern — is it clear how web vs mobile components coexist?
