---
id: bug-096-bug-052-apibase-env-regression
type: bug
status: draft
author-agent: human
created: 2026-05-13
updated: 2026-05-13
parent-plan: feat-066-fix-loop-effectiveness-v2 (v2-Phase-3 lead candidate)
supersedes: null
superseded-by: null
branch: fix/bug-052-apibase-regression
affected-files:
  - scripts/synthesize-flow-e2e.mjs
  - scripts/run-synthesized-flows.mjs
feature-area: orchestrator/verifier-flows
priority: P0
attempt-count: 0
max-attempts: 5
error-message: 'All 6 synthesized flow specs fail at step 0 with ''feat-050 cleanup failed: 404: <!DOCTYPE html><html lang=en>...'' — the body is Next.js dev-server HTML, meaning the cleanup request hit :3000 (frontend) instead of :3001 (Fastify API). The synthesizer''s bug-052 fix emitted `process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001"` but somehow the request still lands on :3000.'
reproduction-steps: "1. Generate a project with Strategy-C test-seed contract (any node-fastify or python-fastapi backend). 2. Run /build-to-spec-verify against it. 3. Inspect docs/_tmp-verify-output.json: flows[].failed[].message will start with 'feat-050 cleanup failed: 404' and the body will be Next.js HTML rather than a Fastify 404 JSON response."
stack-trace: null
---

# bug-096: bug-052's apiBase fix didn't actually fix the cleanup-to-:3000 issue

## Bug Description

bug-052 (factory archive) was supposed to fix synthesized flow specs hitting the FRONTEND port (:3000) instead of the API port (:3001) for `/test/cleanup` calls. The fix landed: the synthesizer now emits `process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001"` and uses it as the absolute base URL.

But empirically (2026-05-13, reading-log-02), the cleanup still hits :3000. All 6 generated flow specs fail at step 0 with HTML 404 bodies that match the Next.js dev-server's "This page could not be found" template.

## Empirical evidence

`docs/_tmp-verify-output.json` from `/build-to-spec-verify` 2026-05-13 run:

```json
{
  "flowId": "flow-1",
  "primaryCause": "step-transition",
  "message": "Error: feat-050 cleanup failed: 404: <!DOCTYPE html><html lang=\"en\"><head>..."
}
```

The body's `link rel=\"stylesheet\" href=\"/_next/static/css/app/layout.css\"` is a Next.js dev-server signature. Fastify on :3001 doesn't emit HTML — its 404 would be JSON.

Generated spec file `apps/web/e2e/synthesized/flow-1.spec.ts` line 71:

```ts
const __apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const cleanupRes = await request.post(`${__apiBase}/test/cleanup`, { data: { tables: [...] } });
```

The fallback string IS `http://localhost:3001`. Yet the request lands on :3000.

## Root Cause Hypotheses

Three plausible candidates:

1. **`NEXT_PUBLIC_API_BASE_URL` set to empty string somewhere in the test-runner env**: nullish-coalescing `??` only triggers on `undefined` / `null`; an empty string passes through. `${""}/test/cleanup` → `/test/cleanup` → Playwright resolves relative to `use.baseURL` from `playwright.config.ts` (= `http://localhost:3000`). Need to check `apps/web/.env.local`, `apps/web/.env.example`, `apps/api/.env`, root `.env*` for empty-or-different NEXT_PUBLIC_API_BASE_URL values.

2. **Project sets `NEXT_PUBLIC_API_BASE` (no `_URL` suffix) but spec reads `NEXT_PUBLIC_API_BASE_URL`**: verified in reading-log-02 today — `apps/web/.env.local` has `NEXT_PUBLIC_API_BASE=http://localhost:3001`. The spec's env name has `_URL` appended. So the spec falls back to its hardcoded `"http://localhost:3001"`. But that hardcoded fallback should work...

3. **Playwright's `request.post()` doesn't honor absolute URLs the way we think**: unlikely (it does per docs), but worth verifying by directly observing the outbound HTTP. Run with `DEBUG=pw:api` and confirm the URL the request fixture actually sends.

Hypothesis #1 is the most likely, but the fact that the hardcoded fallback to `:3001` ALSO produces :3000 traffic suggests a deeper resolution issue.

## Fix Approach

**Step 1 (diagnostic, before any code change)**: Run a synthesized spec under `DEBUG=pw:api` and log the actual outbound URL. If it's `:3001` per the spec but receives Next.js HTML, there may be a port-forwarding or proxy issue elsewhere. If it's `:3000`, then either hypothesis #1 (env var present-but-empty) or hypothesis #3 (Playwright resolving relative against baseURL even when given an absolute URL) is wrong.

**Step 2 (likely fix, post-diagnostic)**:

- Switch from `process.env.X ?? "default"` to `process.env.X || "default"` — `||` catches empty strings.
- Standardize on a single env var name. Pick ONE of `NEXT_PUBLIC_API_BASE` or `NEXT_PUBLIC_API_BASE_URL` and update the synthesizer + project scaffold templates to match. The current both-names situation is the underlying smell.
- Add a synthesizer-emit assertion: `if (!apiBase.startsWith("http"))` throw a clear error.

**Step 3 (validation)**: re-run `/build-to-spec-verify` against reading-log-02. All 6 flows should pass step 0 cleanup. (They will then likely fail on later steps — that's a separate finding to surface, not a regression of this fix.)

## Cross-references

- **bug-052 (archive)** — the original fix that this bug supersedes/extends.
- **bug-095** — in-loop verifier DB pollution. bug-095 Option B can't ship without bug-096 because it relies on `afterAll` baseline-restore running, which can't run if `beforeAll` cleanup 404's.
- **bug-097** — scaffold .env.example default. Companion; together they form the test-seed-contract reliability set.

## Attempt Log

<!-- Populated by executing agents. -->
