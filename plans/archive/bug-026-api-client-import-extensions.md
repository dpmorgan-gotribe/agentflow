---
id: bug-026-api-client-import-extensions
type: bug
status: archived
author-agent: claude-opus-4-7
created: 2026-04-29
updated: 2026-04-29
completed-at: 2026-04-29
parent-plan: null
supersedes: null
superseded-by: null
branch: bug/api-client-import-extensions
affected-files:
  - .claude/skills/agents/back-end/python-fastapi/SKILL.md
  - .claude/skills/agents/back-end/node-trpc-nest/SKILL.md
  - .claude/skills/agents/front-end/react-next/SKILL.md
  - .claude/agents/backend-builder.md
  - .claude/agents/web-frontend-builder.md
feature-area: orchestration
priority: P1
attempt-count: 0
max-attempts: 5
---

# bug-026 — Workspace package authored with `.js` import extensions breaks Webpack consumers

## Symptom

User-visible error in browser console (and Next.js dev-server
compile output):

```
./packages/api-client/src/index.ts:1:1
Module not found: Can't resolve './client.js'
> 1 | export { fetchReport } from "./client.js";
    | ^
Import trace: ./components/report/report-client.tsx
```

`packages/api-client/src/index.ts` was authored with NodeNext-style
explicit `.js` extensions:

```ts
export { fetchReport } from "./client.js";
export type { ApiClientOptions } from "./client.js";
export type { ... } from "./types.js";
```

But `client.js` doesn't exist on disk — only `client.ts`. The
package has no build step:

```jsonc
{
  "name": "@repo/api-client",
  "main": "./src/index.ts", // raw TS source
  "types": "./src/index.ts",
}
```

Next.js's Webpack bundler resolves `./client.js` literally — it
doesn't apply Node's NodeNext "rewrite `.js` to `.ts`" rule. So
Webpack fails to find the module.

## Root Cause

**Backend-builder authored the api-client as Node-ESM with
explicit extensions (correct for Node)** without checking that the
ONLY consumer is the web app via Webpack (where this convention
breaks).

The factory has TWO consumer conventions but builders aren't told
which one applies to a given workspace package:

| Consumer    | Resolver    | Extension convention            |
| ----------- | ----------- | ------------------------------- |
| Node.js ESM | NodeNext    | `from "./client.js"` (rewrites) |
| Next.js web | Webpack 5   | `from "./client"` (no rewrite)  |
| Vite        | Rollup-like | Either works                    |

The backend-builder defaulted to NodeNext (the "correct" answer for
Python-FastAPI's TypeScript-typed-client output) without reading
that the web app pulls this package via `transpilePackages` in
next.config.ts.

## Factory contracts that COULD have caught this

1. **Stack skill cross-tier conventions table** — neither the
   `python-fastapi` back-end stack skill nor the `react-next`
   front-end stack skill has a section on "if you're authoring a
   workspace package consumed across both tiers, use these
   import-extension conventions". Backend-builder couldn't have
   known.
2. **A linter rule** — eslint-plugin-import has `import/extensions`
   that can enforce/forbid extensions per file. Not configured at
   factory level.
3. **`packages/<name>/package.json` template** — should declare
   the consumer profile (e.g. `"consumer": "web" | "api" | "both"`)
   so builders know which convention applies. Currently absent.

## What verify SHOULD catch

- **`runtime-error-capture` (feat-027)** — the dev-server-compile
  error fires on first browser navigation to a page that imports
  api-client. Captured as `dev-server-compile` source bug, routed
  to whichever feature's task wrote the offending file (api-client-
  package, owned by feat-proxy-and-cache's backend-builder).
- **`audit-app-reachability.mjs`** — may not catch this; it's a
  static analysis of route/component graph, not a build-time
  resolution check.
- **`flow-execution-failure`** — Playwright-driven flow tests
  render the report screen → triggers the import → bundle build
  fails → flow-execution-failure auto-filed.

This bug plan exists to:

1. Validate verify catches the dev-server-compile signal
2. Prevent recurrence by adding cross-tier convention guidance to
   stack skills

## Approach

### Phase A — Hotfix the existing api-client (post-verify)

After verify auto-files the bug AND/OR after the user requests it,
ship a one-line fix in `packages/api-client/src/index.ts`:

```ts
export { fetchReport } from "./client";          // drop .js
export type { ApiClientOptions } from "./client";
export type { ... } from "./types";
```

This is the safer convention — works in Webpack AND Node ESM
(Node will resolve `./client` to `./client.js` at runtime when
the package is actually built; for source-only packages consumed
through `transpilePackages`, no extension lets the resolver pick).

### Phase B — Stack skill cross-tier conventions section

Add a §Cross-tier package conventions section to relevant back-end
stack skills (`python-fastapi`, `node-trpc-nest`, etc.):

```
## Cross-tier package conventions (workspace packages)

If you're authoring a `packages/<name>/` workspace package consumed
by both backend AND web frontend (the only two via @repo/types,
@repo/api-client patterns), use the FRONTEND-COMPATIBLE convention
on imports:

- DO NOT use `.js` extensions in imports — write `from "./client"`,
  NOT `from "./client.js"`.
- The Node-side runtime + Webpack consumer both work this way.
  Adding `.js` only works on Node-ESM (and breaks Webpack).
- The package.json `main` should point to raw TS source
  (`./src/index.ts`); add the consumer side's bundler does
  transpilation via `transpilePackages` (Next) or equivalent.
- DO NOT add a build step for source-only packages. Build steps
  add CI complexity and the orchestrator currently doesn't know
  to run them per-feature.
```

### Phase C — Per-package consumer profile field

Optional (defer if Phase B is sufficient): add a
`packages/<name>/package.json` non-standard field declaring the
consumer profile:

```jsonc
{
  "name": "@repo/api-client",
  "x-repo-consumer": "web",   // | "api" | "both"
  ...
}
```

Builders read this on package-authoring tasks and apply the
matching convention. Skip for v1.

### Phase D — Web-frontend-builder defensive prompt

A one-line note in
`.claude/agents/web-frontend-builder.md`'s §Worktree CWD awareness:

> If you encounter a `Module not found: Can't resolve` error from
> a workspace package (`@repo/*`), check the package's `src/index.ts`
> for `.js` extension imports — that's the most common cause. File
> a `genuineProductBug` against the package's owning task.

Same pattern as bug-024's tester guidance — agents flag, don't fix
out-of-lane.

## Rejected Alternatives

- **Always add a build step to workspace packages** — Rejected.
  Adds CI time, complicates dev workflow (need watch+rebuild or
  Turborepo task graph), and `transpilePackages` already handles
  the source-only case cleanly.
- **Configure Webpack to rewrite `.js` to `.ts`** — Rejected.
  Possible via Next.js custom webpack config but: (a) makes
  the project's bundler config bespoke, (b) still doesn't help
  Vite/other consumers, (c) the no-extension convention is simpler
  and works everywhere.
- **Use only Node-ESM extensions (force Webpack to comply)** —
  Rejected. Webpack's resolver doesn't rewrite by default; forcing
  the rewrite via webpack config is bespoke + brittle.

## Expected Outcomes

- [ ] `packages/api-client/src/index.ts` uses bare specifiers
      (no `.js` extensions)
- [ ] Stack skills for cross-tier-relevant backends include
      §Cross-tier package conventions
- [ ] Web-frontend-builder prompt has a defensive flag-don't-fix note
- [ ] On a fresh smoke project: no `Module not found` errors when
      web app imports a workspace package authored by the backend
      builder
- [ ] No regressions in 567/567 existing orchestrator tests

## Validation Criteria

1. **Hotfix on this project**: drop `.js` extensions →
   `pnpm --filter @repo/web dev` builds cleanly →
   `localhost:3000/report/facebook/react` renders without console
   errors.
2. **Verify catches the original**: when `/build-to-spec-verify`
   fires post-feat-error-states completion, `docs/bugs.yaml`
   should contain a `dev-server-compile` or
   `flow-execution-failure` entry citing the `Module not found`
   error → confirms feat-027 runtime-error-capture is working.
3. **Future-project audit**: spin a smoke project; backend-builder
   authors a workspace package; web app consumes it; build
   succeeds with no extension issues.

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->

---

# COMPLETION RECORD (appended at archive time)

completed: 2026-04-29
outcome: success
actual-files-changed:

- projects/repo-health-dashboard-01/packages/api-client/src/index.ts (project-side hotfix — drop .js extensions)
- .claude/skills/agents/back-end/python-fastapi/SKILL.md (modified — §6.5 Cross-tier package conventions)
- .claude/skills/agents/back-end/node-trpc-nest/SKILL.md (modified — §6.5 Cross-tier package conventions mirror)
- .claude/agents/web-frontend-builder.md (modified — §Hard rules flag-don't-fix note for @repo/\* package imports)
  commits:
- hash: 7d8435f (project) — "fix(api-client): drop .js extensions from index.ts"
- hash: c346ac3 (factory) — "bug-026: factory-side cross-tier package conventions"
  attempts: 1
  duration-minutes: 30
  test-results:
  unit: n/a (markdown + project hotfix)
  integration: live-validated symptom on repo-health-dashboard-01 — pre-fix dev server failed compile; post-fix booted cleanly on :3001
  lessons:
- "Stack-skill should explicitly call out cross-consumer conventions when a package is consumed by a different bundler tier. Backend-builders default to NodeNext; web consumers use Webpack — silent mismatch unless documented."
- "Phase C (per-package consumer profile in package.json) deferred — Phase B documentation is sufficient if shipped consistently across stack-skills. Add Phase C only if drift recurs."
- "Defensive flag-don't-fix note pattern (in web-frontend-builder.md) keeps lane-discipline tight even when bug surfaces in cross-package context. Same pattern as bug-024 + bug-029."
  recommendation-implemented-by: bug-026 (this plan)

---
