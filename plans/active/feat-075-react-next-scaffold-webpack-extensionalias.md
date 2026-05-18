---
id: feat-075-react-next-scaffold-webpack-extensionalias
type: feature
status: draft
author-agent: claude-opus-4-7
created: 2026-05-18
updated: 2026-05-18
parent-plan: null
supersedes: null
superseded-by: null
branch: feat/react-next-extensionalias-scaffold
affected-files:
  - .claude/skills/agents/front-end/react-next/SKILL.md
feature-area: factory/stack-skills/react-next
priority: P1
attempt-count: 0
max-attempts: 5
error-message: |
  apps/web build: Module not found: Can't resolve './message.js'
  apps/web build: ../../packages/types/src/index.ts
  apps/web build: > Build failed because of webpack errors
---

# feat-075 — react-next stack-skill ships next.config.ts with webpack resolve.extensionAlias for NodeNext .js imports

## Problem

Every multi-tier project (web frontend + node backend sharing `packages/types`, `packages/ui-kit`, `packages/api-client`) writes workspace package imports using NodeNext-style `.js` extensions on `.ts` files — e.g. `export * from "./message.js"` inside `packages/types/src/index.ts`. This is **required** for Node ESM consumption by the api app + the canonical TypeScript NodeNext convention.

Vitest tolerates the convention via esbuild. TypeScript compilation tolerates it with `moduleResolution: "Bundler"`. But **Next.js's webpack does not** — it literally tries to find `./message.js` and fails since only `./message.ts` exists. The result: every `pnpm --filter @repo/web build` fails out-of-the-box on a fresh multi-tier project.

**Empirical:** discovered today on gotribe-tribe-chat post-build verification (`pnpm --filter @repo/web build` failed with 4 separate "Module not found" errors across packages/types + packages/ui-kit/lib/motion.ts + packages/api-client). The tester on `feat-channel-view` ALREADY hit this gap during Mode B — and "fixed" it by stripping `.js` extensions from the source files (bug-024 forbidden territory; broke Node ESM contract).

## Proposed fix

`react-next` stack-skill (`.claude/skills/agents/front-end/react-next/SKILL.md`) scaffold ships `apps/web/next.config.ts` with the following webpack hook:

```ts
import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: [...],   // existing
  env: {...},                  // existing

  // Workspace packages use NodeNext-style `.js` extensions on `.ts` imports
  // (required for Node ESM consumption by apps/api). Webpack needs an
  // extensionAlias to rewrite them when bundling for the browser.
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js":  [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    return config;
  },
};

export default config;
```

Add a §5 Gotchas entry naming the rule, with a back-reference to this plan.

## Acceptance criteria

- [ ] `.claude/skills/agents/front-end/react-next/SKILL.md` scaffold's `next.config.ts` template includes the webpack hook
- [ ] `.claude/skills/agents/front-end/react-next/SKILL.md` §5 Gotchas mentions the NodeNext-extension contract + back-references feat-075
- [ ] Smoke test: bootstrap a fresh multi-tier project (web + node backend) via `/new-project`, run pipeline through `/start-build`, confirm `pnpm --filter @repo/web build` succeeds on the first try
- [ ] Existing shipped projects (gotribe-tribe-chat itself) already have the fix — no retrofit needed; document in plan body that the fix landed inline during 2026-05-18 build verification

## Risk + rollback

- **Risk:** none. `resolve.extensionAlias` is a vanilla Next.js 15 + webpack 5 config and standard for any monorepo using NodeNext workspace packages.
- **Rollback:** revert the scaffold change. Projects that consumed the new scaffold continue to work (the config is additive).

## Cross-references

- **gotribe-tribe-chat** (2026-05-18) — empirical motivator; the inline fix that landed in `apps/web/next.config.ts` commit `8adb45e` is the canonical shape to ship in the scaffold
- **bug-024** — tester forbidden source-file mods; the tester here tried to "fix" the build by stripping .js extensions instead of flagging the scaffold gap, which is exactly the anti-pattern bug-024 forbids
- **feat-042** — node-fastify stack-skill (the backend half of the multi-tier pair that requires .js extensions for Node ESM)
- **investigate-028** + **feat-074** — `/stylesheet` split; introduces packages/ui-kit React surface that this fix covers
