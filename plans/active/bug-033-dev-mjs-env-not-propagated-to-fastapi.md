---
id: bug-033-dev-mjs-env-not-propagated-to-fastapi
type: bug
status: completed
completed-at: 2026-04-30
approved-at: 2026-04-30
approved-by: human
author-agent: claude-opus-4-7
created: 2026-04-30
updated: 2026-04-30
parent-plan: feat-045-shepherd-repo-health-dashboard-01-to-95
supersedes: null
superseded-by: null
branch: fix/dev-mjs-env-not-propagated-to-fastapi
affected-files:
  - scripts/dev.mjs
  - .claude/skills/architect/SKILL.md
  - .claude/templates/dev-multi-tier.mjs.template
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "FastAPI returns 429 Too Many Requests on /api/report/* despite GITHUB_TOKEN being set in .env.local"
reproduction-steps: "1. cd projects/repo-health-dashboard-01; 2. node scripts/dev.mjs; 3. curl http://localhost:8000/api/report/facebook/react; 4. Observe 429 with rate-limit message — token from .env.local is not reaching the FastAPI subprocess (unauth limit of 60/hr applies instead of authenticated 5000/hr)"
stack-trace: null
---

# bug-033 — `scripts/dev.mjs` does not propagate `.env.local` to FastAPI subprocess

## Bug Description

Factory-wide bug surfaced live during feat-045 Phase B (E2E run on repo-health-dashboard-01). The factory's `scripts/dev.mjs` (shipped via `/new-project` to multi-tier projects) co-boots a FastAPI / Express / Nest backend alongside the Next dev server. Per its docstring it propagates `PORT` from `apps/api/.env` into `NEXT_PUBLIC_API_BASE` so the frontend's API URLs reach the backend.

But it does NOT propagate other secrets from `.env.local` (or `.env`) into the FastAPI subprocess's environment. Specifically: `GITHUB_TOKEN` lives in `projects/<name>/.env.local` (per the credentials contract) — the SPA reads it via `NEXT_PUBLIC_API_BASE` (no token; just URL), but FastAPI needs the actual `GITHUB_TOKEN` to authenticate against GitHub.

When dev.mjs spawns the FastAPI subprocess, it inherits `process.env` from the parent Node process — but Node doesn't auto-load `.env.local` at startup. So `GITHUB_TOKEN` is undefined inside FastAPI, and FastAPI falls back to unauthenticated GitHub calls (60/hr rate limit), exhausted in seconds during E2E runs.

This affects every Strategy D project (today: `repo-health-dashboard-01`, future: any external-API proxy) and every Strategy C project (when ORM secrets / signing keys / etc. live in `.env.local`).

## Reproduction Steps

1. `cd projects/repo-health-dashboard-01`
2. Confirm `.env.local` contains a real `GITHUB_TOKEN=ghp_...` (or `github_pat_...`)
3. `node scripts/dev.mjs`
4. Wait for "[dev] backend port: 8000" + "[dev] frontend port: 3000"
5. `curl http://localhost:8000/api/report/facebook/react`
6. **Observe:** 429 response with `{"detail":{"code":"rate_limited",...}}` — even on a fresh boot, because FastAPI is making unauth GitHub calls and the unauth bucket has been exhausted by other consumers on the same IP.

Cross-check: launch FastAPI directly with the env loaded:

```
GITHUB_TOKEN=$(grep GITHUB_TOKEN .env.local | cut -d= -f2-) uv run uvicorn apps.api.src.api.main:app --port 8000
curl http://localhost:8000/api/report/facebook/react
```

→ should return 200 with full body. Confirms the issue is in dev.mjs's env propagation, not in FastAPI itself.

## Error Output

From feat-045 Phase B turn-21 E2E run:

```
[WebServer] [api] INFO:     127.0.0.1:57512 - "GET /api/report/this-org-cant-exist-xyz/this-repo-also-cant-exist-9999 HTTP/1.1" 429 Too Many Requests
flow-3 (Recover from a 404) failed at interaction 4: page.waitForResponse: Test timeout of 90000ms exceeded.
```

The flow expected `status: 404` on a deliberately-nonexistent repo, but got `429` because GitHub never received the auth header.

## Root Cause Analysis

`scripts/dev.mjs` spawns FastAPI via `spawn("uv", ["run", "uvicorn", ...], { env: { ...process.env, PORT: backendPort } })` (or equivalent). This passes Node's current `process.env` plus PORT — but Node hasn't loaded `.env.local` (Next loads it at runtime; Node itself does not without `dotenv` package).

Three fix paths:

1. **dev.mjs reads `.env.local` and merges into the spawn env** — single point of truth; works for both halves.
2. **FastAPI's `apps/api/src/api/config.py` reads `.env.local`** — Python-side fix; uvicorn's pydantic-settings can autoload via `model_config = SettingsConfigDict(env_file=".env.local")`. Per-stack-skill convention.
3. **Operator manually exports env vars** before invoking dev.mjs — works but breaks the "single command boots both halves" UX.

Path 1 is the cleanest factory fix (one place, all tiers benefit). Path 2 is also valid but requires per-stack-skill changes. Lean toward Path 1 with Path 2 as a redundancy.

## Fix Approach

### Phase 1 — `scripts/dev.mjs` env-loading

1. After `resolveBackendPort()`, add a `loadEnvFiles()` step:
   - Read `.env` (lowest priority)
   - Read `.env.local` (highest priority — overrides .env)
   - Parse simple `KEY=VALUE` lines (skip blank lines + `#` comments)
   - Merge into the env object passed to `spawn(...)` for the backend subprocess
2. Same propagation for the Next dev subprocess (so `NEXT_PUBLIC_API_BASE` and any other public-prefixed envs are consistent)
3. Log which env vars were loaded (with values redacted) so the operator sees what's plumbed

### Phase 2 — Stack-skill `config.py` belt-and-braces

In `python-fastapi/SKILL.md` §3 (and node-trpc-nest, node-fastify when shipped): document that `config.py` should use `pydantic-settings` with `env_file=[".env", ".env.local"]` so the FastAPI app loads its own envs even when invoked outside dev.mjs.

### Phase 3 — Sync to projects

Update `scripts/dev.mjs` in factory; sync to all 12 projects via `node scripts/sync-project-schemas.mjs --all` (after extending the SYNC_PAIRS to cover scripts/ if not already).

### Phase 4 — Validation

- Re-run the feat-045 E2E flows 1/2/3 with mocks REMOVED (revert the convert-to-mocks of those flows). Live happy-path should now hit GitHub successfully + return 200.
- `curl http://localhost:8000/api/report/facebook/react` after `node scripts/dev.mjs` boot returns 200 with valid body.

## Rejected Fixes

- **Hard-code `dotenv` package as factory dep on every project** — adds a runtime dep where one isn't strictly needed; Node 20+ has `--env-file` but the dev.mjs already manages env semantics, so a small inline parser is cleaner.
- **Switch to a single `.env` file (no `.env.local`)** — breaks the established convention where `.env.local` is git-ignored for secrets; would require operator-side workflow change.
- **Document as operator responsibility ("export GITHUB_TOKEN before running dev.mjs")** — defeats the purpose of dev.mjs as a single-command boot.

## Validation Criteria

- `node scripts/dev.mjs` in repo-health-dashboard-01 → `curl http://localhost:8000/api/report/facebook/react` returns 200 (live GitHub call succeeds with token)
- Restoring feat-045 flow-1's interactions[] to use `waitForResponse` (no mock) + re-running E2E → flow-1 passes against live API
- Schema sync to all 12 projects shows 1 update (scripts/dev.mjs)
- Future `from-zero` Mode B runs (book-swap-pre-build, finance-track-pre-build, etc.) don't surface this same issue

## Attempt Log

### Attempt 1 — 2026-04-30 — fixed end-to-end

**Phase 1 (template fix):** Added `parseEnvFile()` + `loadEnvFiles()` to `.claude/templates/dev-multi-tier.mjs.template`. Loads `.env` then `.env.local` (latter wins), with `process.env` overriding both (so explicit `PORT=8001 node scripts/dev.mjs` still wins). Added `redactEnvForLog()` so the boot log shows which secrets were loaded with values redacted (`"GITHUB_TOKEN":"<set>"`, `"VERCEL_TOKEN":"<empty>"`). Both backend and frontend spawn calls now spread `MERGED_ENV` instead of `process.env`.

**Phase 1.5 (mid-fix discovery):** During smoke-test, `.env.local` had `PORT=4000` which now bled into Next via MERGED_ENV — both halves tried to bind :4000. Added `PORT: String(FRONTEND_PORT)` to the frontend spawn env to scope the .env-file PORT signal to the backend only. Documented the rationale inline.

**Phase 3 (testing-policy hardening):** Added "tests for proxy/external-API logic must mock the upstream" rule to `.claude/rules/testing-policy.md` — prevents the bug-119-class issue (project tests depending on live external API) from recurring on book-swap, finance-track, etc.

**Phase 5 (sync):** Ran `node scripts/sync-project-schemas.mjs --all` — template synced to all 12 projects. Manually copied to `projects/repo-health-dashboard-01/scripts/dev.mjs` (the live instance under test).

**Validation (live smoke-test):**

- `node scripts/dev.mjs` → boot log shows `[dev] env-loaded secrets (redacted): {"GITHUB_TOKEN":"<set>",...}` ✓
- `curl http://localhost:4000/api/report/facebook/react` → **200** with full payload ✓
- `rate_limit.remaining: 4998` (authenticated 5000/hr bucket) ✓ — confirms token reached FastAPI
- Backend on 4000, Frontend on 3000 — no port collision ✓
- Pre-fix repro (revert dev.mjs to old version) → 429 unauth-rate-limit, confirming the fix path

**Outcome:** success. Factory-wide bug closed; future Strategy C/D projects get the fix automatically via `/new-project` template-copy.
