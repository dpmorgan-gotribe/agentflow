---
id: bug-056-route-dev-server-compile-by-tier-signal
type: bug
status: draft
author-agent: human
created: 2026-05-06
updated: 2026-05-06
parent-plan: investigate-018-fix-bugs-dispatch-latency
supersedes: null
superseded-by: null
branch: fix/route-dev-server-compile-by-tier-signal
affected-files:
  - scripts/file-bug-plan.mjs
  - orchestrator/src/build-to-spec-verify.ts
  - tests/file-bug-plan.test.mjs
feature-area: verifier/file-bug-plan + orchestrator/dispatch-routing
priority: P1
attempt-count: 0
max-attempts: 5
error-message: |
  defaultAgentSequence routes dev-server-compile + runtime-error +
  reachability-orphan bugs to web-frontend-builder by default,
  regardless of which tier the failure actually points at. For backend
  port-bind failures, runtime errors in apps/api/, or wiring fixes
  that span tiers, the wrong-tier dispatch burns 5-15min of agent
  reasoning before the empty-merge guard rejects the no-op result.
reproduction-steps: |
  1. /start-build a project with both web + api tiers (e.g.
     reading-log-01).
  2. Verifier surfaces a dev-server-compile bug because backend
     fails to bind on its port within 60s (Prisma DB missing,
     migrate not run, etc.).
  3. file-bug-plan.mjs:730 switch defaults to
     `[web-frontend-builder, tester, reviewer]`.
  4. Loop dispatches web-frontend-builder. Agent reads frontend
     code, finds nothing wrong with the frontend, can't fix the
     backend port-bind issue.
  5. Agent eventually returns success with no commits OR irrelevant
     commits. Phase B empty-merge guard rejects (post-bug-055).
  6. Bug retries up to maxAttempts. Total wasted: 15-45min.
stack-trace: null
---

# bug-056: Route dev-server-compile + runtime-error + reachability-orphan by tier signal

## Bug Description

`scripts/file-bug-plan.mjs:730-740`'s `defaultAgentSequence` does
NOT use any tier information when picking the agent. For
`dev-server-compile`, `runtime-error`, `reachability-orphan`, and
the `default` (unknown) branch, it always routes to
`web-frontend-builder`. This is wrong when:

1. The failure is in the backend tier (e.g. apps/api/ port doesn't
   bind, FastAPI/Fastify import error, Prisma migrate missing).
2. The failure is in the mobile tier (apps/mobile/ build error).
3. The orphan is a backend-only file (rare but possible — server-
   side route handlers that aren't imported anywhere).

Empirical case: reading-log-01 2026-05-06
`bug-compile-tooling-pre-flight` (P0, dev-server-compile) — backend
node-fastify didn't respond on `http://localhost:3001/health`
within 60s. Verifier captured the warning verbatim, but
defaultAgentSequence ignored it and routed to
`web-frontend-builder`. Agent burned ~15min before producing
nothing actionable. (Pre-bug-055 this resulted in a fake "clean"
result; post-bug-055 the empty-merge guard catches it but the
~15min is still wasted.)

The verifier already HAS the tier signal — it's in the warnings
array (`"backend (node-fastify) did not respond on
http://localhost:3001/health"`) and in the failed flow's stderr
(`apps/api/src/plugins/...`). We just don't use it at routing
time.

## Reproduction Steps

See frontmatter `reproduction-steps`. Also: any project where the
backend fails to boot (DB connection, port collision, missing
env var, prisma generate not run) will dispatch the wrong tier.

## Error Output

From reading-log-01 2026-05-06 b3zwmyp7a verifier output:

```
warnings:
  - flow-execution: dev-server-not-ready (playwright webServer
    timed out — backend or frontend dev-server failed to bind port
    within 60s. ...)
  - parity: dev-server: auto-boot failed: backend (node-fastify)
    did not respond on http://localhost:3001/health within 60000ms.
    Resolved spawn: `pnpm.cmd --filter @repo/api dev` from
    `<projectDir>`. Resolved port: 3001 ...
```

Tier signal: `backend (node-fastify)` + `localhost:3001` + `@repo/api`.
Routing should pick `backend-builder`, not `web-frontend-builder`.

## Root Cause Analysis

`scripts/file-bug-plan.mjs:702-740` `defaultAgentSequence` only
inspects `violation.primaryCause`. The function signature and
internal logic don't accept any tier signal:

```js
function defaultAgentSequence(violation) {
  const cause = violation && violation.primaryCause;
  switch (cause) {
    case "build-gap":
      return ["web-frontend-builder", "tester", "reviewer"];
    case "seed-setup":
      return ["backend-builder", "tester", "reviewer"];
    case "manifest-author":
      return [];
    default:
      return ["web-frontend-builder", "tester", "reviewer"];
  }
}
```

The `seed-setup` case correctly routes to backend-builder because
the verifier classifies seed-setup-class failures specifically.
But dev-server-compile, runtime-error, and step-transition all
fall through to the web-frontend-builder default — even when the
failure is unambiguously backend-side.

## Fix Approach

### Phase A — Tier classifier helper (45min)

Add `inferTierFromViolation(violation)` to file-bug-plan.mjs.
Returns `"backend" | "web" | "mobile" | "unknown"`. Heuristics
in priority order:

1. **affectsFiles glob match** — if any path matches `apps/api/**`
   → backend; `apps/mobile/**` → mobile; `apps/web/**` → web.
2. **violation.flow.htmlDump or violation.flow.warnings**
   substring match:
   - `/backend|node-fastify|node-trpc-nest|fastapi|api\..*\.error/i`
     → backend
   - `/web|react-next|svelte-kit|next\.js|vite/i` → web
   - `/mobile|expo|react-native/i` → mobile
3. **port number heuristic** — `localhost:300[1-9]` (excluding 3000) → backend; `localhost:3000` or `localhost:5173` (vite) → web.
4. **stack-trace path** — if violation has a stackTrace and it
   contains `apps/api/` → backend; etc.
5. **Default** — `"unknown"` → caller falls back to existing
   default (web-frontend-builder).

### Phase B — Wire tier into defaultAgentSequence (30min)

`defaultAgentSequence(violation)` calls `inferTierFromViolation`
and maps tier → builder agent name:

```js
function tierToBuilder(tier) {
  if (tier === "backend") return "backend-builder";
  if (tier === "mobile") return "mobile-frontend-builder";
  return "web-frontend-builder"; // default + "web" + "unknown"
}
```

For each cause case that currently has a hardcoded builder, swap
to the inferred tier. Keep the cause-specific overrides (e.g.
`seed-setup` always → backend regardless of tier-infer).

The signature compatibility with feat-058 (which adds a `tier`
param) is straightforward: feat-058's explicit `tier` arg wins
over inference; if not provided, fall back to inference.

### Phase C — Tests (45min)

`tests/file-bug-plan.test.mjs`:

- Each tier × each cause class × expected agent sequence.
- Empirical fixtures: paste actual reading-log-01 verifier output
  - assert routing returns `backend-builder`.
- Negative case: violation with no tier hints + cause:unknown →
  fallback to `web-frontend-builder`.

### Phase D — Empirical re-validation (30min)

Re-fire /fix-bugs reading-log-01 against the same
bug-compile-tooling-pre-flight. Confirm the loop dispatches
`backend-builder` (not web-frontend-builder), and that the
backend-builder makes a real fix (e.g. adds prisma migrate to
postinstall, or creates the data dir, etc.).

## Rejected Fixes

- **Add a 'tier' field to BugEntry directly** — Rejected: requires
  schema change to bugs.yaml + migration of in-flight bug entries.
  Inferring at dispatch-time is cheaper and reversible.

- **Always route dev-server-compile to backend** — Rejected:
  not all dev-server-compile failures are backend (e.g. Next.js
  build error → frontend). Need the heuristic.

- **Make the agent figure out the tier itself** — Rejected:
  that's exactly the wrong-tier-waste pattern we're trying to
  close. The verifier already has the signal; we just need to
  use it.

## Validation Criteria

1. `inferTierFromViolation` unit-tested against ≥10 fixture
   cases drawn from real verifier outputs (reading-log-01,
   finance-track-01, kanban-09, repo-health-dashboard-01).
2. Reading-log-01 re-run dispatches `backend-builder` for
   bug-compile-tooling-pre-flight.
3. No regression: existing seed-setup test case still routes to
   backend-builder; existing build-gap routes to
   web-frontend-builder.

## Attempt Log

(empty — plan filed by human 2026-05-06)
