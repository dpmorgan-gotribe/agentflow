---
id: bug-032-api-base-url-not-coordinated-with-backend-port
type: bug
status: completed
author-agent: claude-opus-4-7
created: 2026-04-29
updated: 2026-04-30
completed-at: 2026-04-30
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/api-base-url-not-coordinated-with-backend-port
affected-files:
  - .claude/skills/architect/SKILL.md
  - orchestrator/src/dev-server.ts
  - orchestrator/src/parity-verify.ts
  - .claude/skills/agents/back-end/python-fastapi/SKILL.md
  - .claude/skills/agents/front-end/react-next/SKILL.md
  - scripts/synthesize-flow-e2e.mjs
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "Browser console: `:3000/api/report/<owner>/<repo> Failed to load resource: 404 (Not Found)`. Manual repro on repo-health-dashboard-01 in dev — submitting any repo URL on the home page hits a Next.js 404 because the request goes to same-origin `:3000` instead of the FastAPI backend (default `:8000`)."
reproduction-steps: "1. cd projects/repo-health-dashboard-01; 2. pnpm -C apps/web dev (Next.js boots on :3000); 3. open http://localhost:3000/, paste 'facebook/react' into the form, submit; 4. browser DevTools shows a GET to /api/report/facebook/react returning 404."
stack-trace: null
---

# bug-032 — API base URL not coordinated with backend dev port

## Bug Description

The Next.js frontend's API client uses an empty `baseUrl` default — `packages/api-client/src/client.ts:8` declares `const DEFAULT_BASE_URL = ""` and `apps/web/next.config.ts` exposes `NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? ""`. With no `apps/web/.env*` file authored at scaffold time, the env var is unset → `baseUrl` is empty → `${baseUrl}/api/report/${owner}/${repo}` produces a same-origin relative URL → the request hits the Next.js dev server on port 3000 instead of the FastAPI backend.

The FastAPI backend lives in `apps/api/src/api/` and defaults to port `8000` (`apps/api/src/api/config.py: port: int = 8000`). Three ports float around the project with no shared contract:

- `3000` — Next.js dev default
- `3001` — what `packages/api-client/src/client.test.ts` assumes (`http://localhost:3001/api/report/...`)
- `8000` — what FastAPI actually serves on

None of these are wired together. Even worse, the verify pipeline's auto-boot only spins up the Next.js side (`orchestrator/src/dev-server.ts` only knows `apps/web/dev`), so any flow that exercises `/api/...` would 404 even if `NEXT_PUBLIC_API_BASE` was set, because the FastAPI process isn't running during verify.

The user's explicit constraint: **"we can't just assume the port"** — solving this with a hard-coded `:8000` in `.env.example` is not enough. The dev orchestration must discover the backend's actual bound port (it could be 8001 if 8000 is taken, 3007 if the operator deliberately forces a different port, etc.) and propagate that port to the frontend's runtime config.

**Expected:** in dev (manual + verify-auto-boot), the frontend's API requests reach the FastAPI backend regardless of which port FastAPI ended up bound to.

**Actual:** all `/api/*` requests hit the Next.js dev server on `:3000` and 404.

## Reproduction Steps

1. `cd projects/repo-health-dashboard-01`
2. `pnpm -C apps/web dev` (Next.js boots on :3000)
3. Open `http://localhost:3000/` in a browser
4. Paste `facebook/react` (or any `<owner>/<repo>`) into the home page's input
5. Submit the form
6. DevTools Console: `:3000/api/report/facebook/react Failed to load resource: 404 (Not Found)`
7. Verify: `curl -i http://localhost:3000/api/report/facebook/react` → 404
8. Verify: at this point FastAPI isn't even running. Even if you started it (`uv run -C apps/api uvicorn api.main:app --port 8000`), the frontend has no way to know the port and would still hit `:3000`.

## Error Output

```
:3000/api/report/facebook/react   Failed to load resource: the server responded with a status of 404 (Not Found)
:3000/api/report/dpmorgan-gotribe/agentflow   Failed to load resource: the server responded with a status of 404 (Not Found)
```

## Root Cause Analysis

Three structural gaps, each independently fatal to the dev experience:

### Gap 1 — `apps/web/.env*` files were never authored at scaffold time

The architect stage produced `.env.example` at the project root with backend env vars (`GITHUB_TOKEN`, `PORT`), but `apps/web/.env.example` and `apps/web/.env.local.example` declaring `NEXT_PUBLIC_API_BASE` were never authored. The `next.config.ts` reads the var correctly, but the var is never set, so the fallback `""` always applies.

### Gap 2 — No port-coordination between the two app processes

Even with `apps/web/.env.local` setting `NEXT_PUBLIC_API_BASE=http://localhost:8000`, this is brittle: it assumes :8000 is free. In practice the backend may bind to :8001 (port collision) or a deliberately-chosen alternate (`PORT=3007 uv run ...`). There's no mechanism to:

1. Boot the FastAPI process
2. Capture the actual bound port (uvicorn prints `Uvicorn running on http://0.0.0.0:8000`)
3. Write the port into `apps/web/.env.local` (or pass via `NEXT_PUBLIC_API_BASE=...` env at boot time)
4. Boot the Next.js process with that env var set

`turbo dev` runs both processes in parallel but doesn't coordinate ports between them. `justfile`'s `just dev` recipe is `pnpm turbo dev` — same gap.

### Gap 3 — Verify pipeline's auto-boot only knows about the frontend

`orchestrator/src/dev-server.ts:36-54` (`spawnDevServer()`) hard-codes `pnpm -C apps/web dev`. It doesn't know that:

- This particular project also has an `apps/api/` that needs to run for `/api/*` calls to resolve
- The two processes need port-coordinated env (see Gap 2)
- The verify pipeline's flow-execution stage would 404 on every `/api/*` call even if Playwright tried to fill the form

This is the gap that explains why `bug-031`-validated end-to-end run reported `flows: 0 passed, 0 failed` despite 8 synthesized specs — none of them could exercise the actual report API even if they tried to. (See feat-038 for the parallel "synthesizer is too shallow" issue; bug-032 covers ONLY the port-coordination layer.)

### Why `audit-app-reachability` and `parity-verify` couldn't catch this

- audit-app-reachability checks file-system imports + JSX nav targets. It has no notion of HTTP URL paths or runtime API base URLs.
- parity-verify Phase B does DOM-snapshot diffs. It loads the page once and compares; doesn't fire user interactions or watch network traffic.

So the entire verify trio was silent on this bug. It surfaced only via manual browser testing.

## Fix Approach

Three phases. Phase A is the minimum to unblock manual dev + the user's empirical case; Phases B and C close the architectural gaps so future projects don't regress.

### Phase A — Author the env contract (P0, immediate)

For `repo-health-dashboard-01` specifically:

1. Author `apps/web/.env.example` declaring `NEXT_PUBLIC_API_BASE` with default + comment explaining the contract:

   ```env
   # Backend API origin — must match the FastAPI process's bound port.
   # In dev: copy this file to .env.local and set to the actual port.
   # In prod: set in deployment env (Vercel project settings, etc.)
   NEXT_PUBLIC_API_BASE=http://localhost:8000
   ```

2. Author `apps/web/.env.local` (gitignored) with the same contract pre-set for local dev.

3. Author `apps/api/.env.example` declaring `PORT` with the same default `8000`, so both halves read from the same source-of-truth.

4. Update `docs/credentials-checklist.md` (gate-5 artifact) to include the API-base-URL coordination requirement.

This is a **per-project fix** — manually authored files. Doesn't touch factory code yet. Unblocks the user's empirical case in <5 min.

### Phase B — Dev-server port-coordination at the project level (P0, structural)

Author a project-root `dev` script (or extend the justfile's `just dev` recipe) that:

1. Spawns the FastAPI process with a deterministic port (read from `apps/api/.env` `PORT` var)
2. Probes the actual bound port (parse uvicorn's startup line OR check the .env value matches `netstat`)
3. Writes `NEXT_PUBLIC_API_BASE=http://localhost:<port>` into `apps/web/.env.local` BEFORE booting Next.js
4. Spawns Next.js with that env in scope
5. On exit (Ctrl+C / SIGINT), tears down both processes cleanly

The port-discovery layer is essential — the user explicitly named it as the requirement. Two viable implementations:

- **Option B1**: a small Node.js orchestration script under `scripts/dev.mjs` that does the spawn + capture + write + spawn dance. Adds one tool, but explicit + debuggable.
- **Option B2**: extend `justfile` with a `dev` recipe that runs the FastAPI in foreground (background-ed via `&`), greps its output for the bound port, exports `NEXT_PUBLIC_API_BASE`, then runs `pnpm -C apps/web dev`. POSIX-only — Windows operators would need an alternative.

Recommend B1 because Windows is the factory's primary dev surface (per CLAUDE.md). Cross-platform spawn + parse via Node is easier than `bash`-script port capture.

### Phase C — Factory-level wiring so future projects don't regress (P1, generalizable)

Three factory changes:

1. **Architect skill** (`.claude/skills/architect/SKILL.md`): when the architecture has both a `web` and `api` tier, the architect MUST author `apps/web/.env.example` declaring the API-base contract and `apps/api/.env.example` declaring `PORT`. Plus produce a project-root `scripts/dev.mjs` from the new template (Phase B output).

2. **Orchestrator dev-server lifecycle** (`orchestrator/src/dev-server.ts`): extend `bootDevServer()` to detect `apps/api/` presence and, when present, also boot the backend with port-coordination — same logic as Phase B's `scripts/dev.mjs` but living in TypeScript so the verify pipeline's auto-boot uses it too. Verify-stage would then reach a working backend, fix-loop builders can hit the API, and synthesized E2E flows can exercise `/api/*` paths.

3. **Stack skills** (`react-next` + `python-fastapi`): both stack skills' `§Output structure` blocks should declare the env contract surface as part of the canonical scaffold, so a fresh project from the factory ships with the contract in place rather than depending on architect-stage memory.

### Phase D — `synthesize-flow-e2e` baseURL signal

Update `scripts/synthesize-flow-e2e.mjs` so generated flows use `process.env.PLAYWRIGHT_BASE_URL` (set by the auto-boot lifecycle from Phase C) when constructing API URLs in test fixtures. Currently the generated specs are too shallow to even exercise the API (see feat-038), but when feat-038 deepens them, they need to know the right API origin too.

## Rejected Fixes

- **Hard-code `:3001` everywhere** — matches the api-client test fixture's assumption but encodes a magic number in three places (test, env, dev orchestration) with no shared declaration. Brittle to port collisions. Rejected per the user's explicit constraint ("we can't just assume the port").
- **Use Next.js rewrites to proxy `/api/*` → `http://localhost:8000`** — works in dev but encodes the assumption that the backend is on :8000 specifically. Doesn't solve port discovery. Also adds a same-origin proxy hop with subtle CORS/cookie semantics that some flows might trip on. Rejected.
- **Server-side fetch via Next.js Server Components** (e.g., `app/report/[owner]/[repo]/page.tsx` does the GitHub fetch directly, eliminating the API tier) — restructures the architecture to bypass the bug, but throws away the architect-decided FastAPI tier and the cache server it owns. Out of scope. Rejected.
- **Drop the FastAPI backend entirely; use Next.js API routes** — same as above, with even more architectural churn. The architect chose this two-tier shape for a reason (server-side cache, secret-scoped GitHub token). Rejected.

## Validation Criteria

1. **Phase A:** `apps/web/.env.local` exists with `NEXT_PUBLIC_API_BASE=http://localhost:8000`. Manual repro: with FastAPI running on :8000 + Next.js on :3000, submitting `facebook/react` on the home form fetches a real report and renders it. Browser console: zero `/api/*` 404s.
2. **Phase B:** `pnpm dev` (or `just dev`) at project root boots BOTH processes, port-coordinates them, and the manual repro from Phase A works without any extra setup. Forcing the backend to a different port (`PORT=3007 pnpm dev`) propagates the value to the frontend correctly.
3. **Phase C:** A fresh `/new-project test-multi-tier` followed by the full pipeline produces a project where `apps/web/.env.example`, `apps/api/.env.example`, and `scripts/dev.mjs` are all present and wired. The orchestrator's verify-stage auto-boot starts both processes and synthesized E2E flows can hit `/api/*` paths without 404.
4. **Phase D:** Synthesized flow specs reference `process.env.PLAYWRIGHT_BASE_URL` for API origin (when the spec needs to assert on a network response).
5. **Regression on bug-031:** the fix-loop's seedWorktree path still works after Phase B/C changes (wiring should be additive, not replace existing dev-server code).

## Open Questions

1. **Architect must author `.env.example` only, never `.env.local`.** Empirical finding while shipping Phase A on 2026-04-30: the project's `enforce-boundaries.sh` hook blocks writes to filenames matching `.env.local` (correctly — that's a secrets-pattern guard). Phase C's architect-skill update must reflect this: author `.env.example` declaring the contract, document the operator copy step in `docs/credentials-checklist.md` (e.g. `cp apps/web/.env.example apps/web/.env.local && edit`). Don't try to bypass the hook to auto-create `.env.local`.
2. **Should the `dev.mjs` orchestration live in `scripts/` (per project) or as a stack-skill-scaffolded artifact (per stack)?** Per-project gives flexibility to projects that diverge architecturally; per-stack-skill ensures consistency. Lean toward stack-skill-scaffolded with project-level overrides allowed.
3. **What does the contract look like for projects with mobile + web + api?** `apps/mobile`'s API base is platform-specific (iOS dev simulator can use `localhost`, Android emulator must use `10.0.2.2`). May need a separate `EXPO_PUBLIC_API_BASE` with its own port-coordination story.
4. **For verify auto-boot, should the backend boot on a deterministic port** (read from `apps/api/.env`) **OR a randomly-chosen free port?** Random-free avoids collisions when multiple projects run in parallel, but complicates env propagation. Lean deterministic + collision-fail-loud (operator triages by editing `.env`).
5. **Does the architect skill have enough signal at scaffold time to know the project will have BOTH apps?** Should be yes — `architecture.yaml.apps` lists tiers — but worth verifying before Phase C.

## Cross-references

- `plans/active/feat-038-deepen-synthesize-flow-e2e-and-data-seeding.md` (the parallel "synthesizer is too shallow + data-seeding strategy" feat — together with bug-032 these close the verify pipeline's API-coverage blind spot)
- `plans/archive/bug-031-fix-loop-fixup-worktree-not-seeded.md` (sibling — bug-031 fixed dispatch, bug-032 fixes the dev environment those dispatches run against)
- `plans/archive/bug-030-audit-reachability-false-positive-flood.md` (the verify-stage flood; with bug-030 + bug-031 + bug-032, the verify+fix-loop end-to-end exercises real API behavior)
- `orchestrator/src/dev-server.ts` (the auto-boot helper — Phase C extends it)
- `.claude/skills/architect/SKILL.md` (Phase C — env-contract authoring)
- `.claude/skills/agents/back-end/python-fastapi/SKILL.md` + `.claude/skills/agents/front-end/react-next/SKILL.md` (Phase C — stack-skill scaffolding)
- `apps/web/next.config.ts` + `packages/api-client/src/client.ts` (the consumer surface that already reads the env contract correctly)

## Attempt Log

### Phase A — per-project env contract (2026-04-29)

Authored `apps/web/.env.example` + `apps/api/.env.example` for `repo-health-dashboard-01`. `.env.local` write blocked by `enforce-boundaries.sh` hook (correctly — secrets-pattern guard); operator-copy step folded into Phase C's architect skill update.

### Phase B — project-level dev orchestration (2026-04-29 → 2026-04-30 smoke-test)

Authored `projects/repo-health-dashboard-01/scripts/dev.mjs` (~180 LOC). Smoke-test surfaced four issues, each fixed:

1. `uv.exe` literal failed → drop `.exe`; let cmd.exe's PATHEXT resolve under `shell: true`.
2. `uv -C apps/api` is `--config-setting` not change-directory → set spawn `cwd: apps/api/` directly.
3. `python -m api` failed on `src/` layout (no `pip install -e`) → `uvicorn api.main:app --app-dir src --port $PORT`.
4. Stale process on either port masked spawn failure as "ready" → dual-port pre-flight refuse-to-start with platform-specific kill hint. Critical: backend's `CORS_ORIGIN=http://localhost:3000` allowlist means a Next.js fall-back to `:3001` (when :3000 is taken) silently breaks every API call with CORS preflight failure.

Empirically validated: real GitHub fetch via FastAPI on `:8000`, frontend on `:3000`, no CORS errors, no `/api/*` 404s. Browser test on `facebook/react` rendered a real report.

### Phase C — factory-level structural (2026-04-30)

Three changes that generalize Phase A+B so future projects ship with the contract baked in:

- **`orchestrator/src/dev-server.ts`**: `bootDevServer()` detects `apps/api/` and co-boots the backend with port coordination during verify auto-boot. New exports `spawnBackendDevServer()` + `resolveBackendPort()`. `DevServerHandle` gains optional `backendProcess` + `backendUrl`. `teardownDevServer()` kills both. Empirical fixes from smoke-test (uv invocation, src-layout uvicorn, etc.) baked in. 568/568 orchestrator tests still pass.
- **`.claude/skills/architect/SKILL.md`**: new step 7b (per-app `.env.example` files for multi-tier projects), new step 7c (copy `.claude/templates/dev-multi-tier.mjs.template` to project's `scripts/dev.mjs`), step 8 gains "Local dev setup" sub-section documenting the operator copy step (since `enforce-boundaries.sh` blocks auto-`.env.local`).
- **Stack skills `python-fastapi/SKILL.md` + `react-next/SKILL.md`**: section 1a in each declares the env contract is part of the canonical scaffold. Documents `pydantic-settings` pattern (FastAPI) and `next.config.ts env: { ... }` pattern (Next.js). Notes that builders MUST NOT auto-author `.env.local`/`.env`.
- **`.claude/templates/dev-multi-tier.mjs.template`** (new): verbatim copy of the validated `scripts/dev.mjs` for the architect to copy into each multi-tier project.

### Phase D — synthesize-flow-e2e baseURL signal — deferred to feat-038

The current synthesizer generates trivial specs (`page.goto("/")` + screen-id wait) — relative URLs work correctly with Playwright's baseURL regardless of port. The "API base URL signal" is meaningful only when feat-038 deepens specs to assert on `/api/*` responses; feat-038's structured `steps[]` schema is the right place to land this rather than retrofitting the current shallow synthesizer.

### Outcome

bug-032 is complete. Multi-tier projects now have:

- Per-project env-contract files (Phase A, scaffolded by architect Phase C)
- Project-level `scripts/dev.mjs` for manual port-coordinated boot (Phase B, scaffolded from template)
- Verify-stage auto-boot that co-boots backend + frontend with the same port coordination (Phase C orchestrator change)
- Documented operator copy step for `.env.local` (Phase C credentials-checklist update)

Empirical false-positive case from 2026-04-29 (`/api/report/* → 404`) is closed for `repo-health-dashboard-01` and structurally closed for all future multi-tier projects.

### Lessons

1. **`.env.local` auto-authoring is correctly forbidden by `enforce-boundaries.sh`.** Architect skill must document the operator copy step rather than fight the hook. Logged as Phase C requirement up front; saved a circular debugging session.
2. **Pre-flight refuse-to-start beats faulty probe-success.** A stale process on the same port made the original `dev.mjs` declare "backend ready" while the spawn had silently failed. Pre-flight check (refuse if port already responding) catches this loudly. Same pattern now in `bootDevServer()` for the factory.
3. **`src/` layout + `python -m <pkg>` fails without `pip install -e`.** uv's `uv run python -m api` doesn't auto-install the local project. Switch to `uvicorn api.main:app --app-dir src --port $PORT` — explicit `--app-dir` flag bypasses the install step. Documented in python-fastapi stack skill.
4. **CORS allowlist + auto-port-fallback is a quiet failure mode.** When :3000 is taken Next.js falls back to :3001, but the backend's `CORS_ORIGIN=http://localhost:3000` blocks every API call from :3001. Pre-flight refusing :3000 is a much better UX than mid-test CORS errors.
5. **Three ports floating in shipped scaffolds with no shared contract.** :3000 (Next.js default), :3001 (api-client test fixture's fictional assumption), :8000 (FastAPI default). Phase C's per-app `.env.example` + project-root `scripts/dev.mjs` make all three flow from a single source of truth (`apps/api/.env`'s `PORT`).
