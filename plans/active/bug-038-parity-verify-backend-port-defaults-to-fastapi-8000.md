---
id: bug-038-parity-verify-backend-port-defaults-to-fastapi-8000
type: bug
status: draft
author-agent: human
created: 2026-05-02
updated: 2026-05-02
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/dev-server-stack-aware-port-resolution
affected-files:
  - orchestrator/src/dev-server.ts
  - .claude/templates/dev-multi-tier.mjs.template
  - .claude/skills/agents/back-end/node-fastify/SKILL.md
  - .claude/skills/agents/back-end/node-trpc-nest/SKILL.md
  - .claude/skills/architect/SKILL.md
feature-area: orchestrator/dev-server + verifier
priority: P1
attempt-count: 0
max-attempts: 5
error-message: "parity: dev-server: auto-boot failed: backend (apps/api/) did not respond on http://localhost:8000/health within 60000ms — verify uv is on PATH and the project's pyproject.toml is valid. Underlying: last error: ; parity-verify will skip with screens unchecked"
reproduction-steps: "Run /start-build on a project with backend_framework != python-fastapi (e.g. node-fastify, node-trpc-nest, node-express). After Mode B + verify, the parity-verify auto-boot fails because dev-server.ts:147 resolveBackendPort defaults to 8000 (FastAPI convention) when apps/api/.env doesn't have an explicit PORT line."
stack-trace: null
---

# bug-038: dev-server backend-port resolution defaults to FastAPI's :8000 + skips parity-verify on non-FastAPI stacks

## Bug Description

`orchestrator/src/dev-server.ts:147 resolveBackendPort` resolves the backend port via this precedence:

1. `process.env.PORT` (operator override)
2. `apps/api/.env` (PORT=N line)
3. **`8000` (FastAPI default per pydantic-settings convention)**

For non-FastAPI backends (node-fastify, node-trpc-nest, node-express, ...) the actual default port is different (typically 3001 for fastify per most templates, 4000 for express, etc) AND the per-project port lives in `apps/api/.env.local` (not `.env`) per the bug-033 fix to `dev-multi-tier.mjs.template`. The resolver doesn't check `.env.local`, doesn't read `architecture.yaml.tooling.stack.backend_framework` to choose a stack-appropriate default, and doesn't read `dev-multi-tier.mjs.template` for the authoritative port.

Result: parity-verify's auto-boot tries to hit `http://localhost:8000/health`, the backend isn't there (it's at e.g. :4000), the boot times out at 60s, parity-verify SKIPS with "screens unchecked", and the run completes without ever validating the build matches the design.

The error message also misleadingly mentions "uv is on PATH" + "pyproject.toml is valid" — diagnostic detritus from the FastAPI assumption that doesn't apply to node-\* stacks.

Empirical case (2026-05-02 finance-track-01):

```
Build-to-spec verify:
  ...
  warnings:
    - parity: dev-server: auto-boot failed: backend (apps/api/) did not respond on
      http://localhost:8000/health within 60000ms — verify uv is on PATH and the
      project's pyproject.toml is valid. Underlying: last error: ;
      parity-verify will skip with screens unchecked
```

The project's actual fastify backend is on a different port. The `apps/api/.env` may not exist (the canonical config lives in `.env.local` per bug-033). The resolver had no path to find the right port.

## Reproduction Steps

1. Bootstrap a project with `architecture.yaml.tooling.stack.backend_framework = node-fastify` (or `node-trpc-nest`, `node-express`).
2. Confirm `apps/api/.env.local` has `PORT=4000` (or similar) — written by `dev-multi-tier.mjs.template` per bug-033 fix.
3. Run `/start-build` to completion.
4. After Mode B + post-build verify, observe the parity-verify warning: `dev-server: auto-boot failed: backend (apps/api/) did not respond on http://localhost:8000/health`.
5. Verifier output also shows `parity: ... screens unchecked` — the visual-parity dimension scored 0 because no comparison ran.

## Error Output

From `tasks/bdr9m4527.output`:

```
Build-to-spec verify:
  reachability:    7 orphan component(s), 0 orphan route(s)
  flows:           0 passed, 0 failed
  bug plans filed: bug-003-orphan-..., (7 entries)
  warnings:
    - flow-execution: playwright reporter stdout empty; ... (sister bug-037)
    - parity: dev-server: auto-boot failed: backend (apps/api/) did not respond on
      http://localhost:8000/health within 60000ms — verify uv is on PATH and the
      project's pyproject.toml is valid. Underlying: last error: ;
      parity-verify will skip with screens unchecked
```

The error message's "verify uv is on PATH" + "pyproject.toml is valid" wording is a giveaway — the resolver hard-coded FastAPI's tooling expectations.

## Root Cause Analysis

`orchestrator/src/dev-server.ts:147 resolveBackendPort`:

```ts
export function resolveBackendPort(projectDir: string): number | null {
  const apiDir = join(projectDir, "apps", "api");
  if (!existsSync(apiDir)) return null;
  if (process.env.PORT) {
    const n = Number(process.env.PORT);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const apiEnvPath = join(apiDir, ".env"); // ← only .env, NOT .env.local
  if (existsSync(apiEnvPath)) {
    try {
      const text = readFileSync(apiEnvPath, "utf8");
      const m = text.match(/^\s*PORT\s*=\s*(\d+)\s*$/m);
      if (m && m[1]) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > 0) return n;
      }
    } catch {
      /* fall through to default */
    }
  }
  return DEFAULT_BACKEND_PORT; // ← 8000 (FastAPI), not stack-aware
}
```

Three independent gaps:

1. **Doesn't read `apps/api/.env.local`** — bug-033 (factory) made `.env.local` the canonical port-config location for `dev-multi-tier.mjs.template`-driven projects. The resolver predates that fix.
2. **Doesn't consult `architecture.yaml.tooling.stack.backend_framework`** to pick a stack-appropriate default (3001 for fastify, 4000 for express, 8000 for FastAPI, etc).
3. **Doesn't consult `dev-multi-tier.mjs.template` (or its emitted `scripts/dev.mjs`)** for the authoritative `BACKEND_PORT` constant that the project's runtime actually uses.

Compound effect: the resolver fails to find ANY signal, falls back to 8000, the parity-verify auto-boot tries that, fails, the run skips parity validation.

## Fix Approach

### Phase A — extend resolution chain (P1)

1. **Update `resolveBackendPort` precedence** in `orchestrator/src/dev-server.ts:147`:
   ```ts
   // 1. process.env.PORT  (existing)
   // 2. process.env.BACKEND_PORT  (NEW — dev.mjs writes this)
   // 3. apps/api/.env.local PORT/BACKEND_PORT  (NEW — bug-033 canonical location)
   // 4. apps/api/.env PORT/BACKEND_PORT  (existing)
   // 5. scripts/dev.mjs BACKEND_PORT constant  (NEW — read the source of truth)
   // 6. architecture.yaml.tooling.stack.backend_framework → stack-default  (NEW)
   //    {fastapi: 8000, fastify: 3001, trpc-nest: 4000, express: 4000, ...}
   // 7. throw with actionable message ("could not resolve backend port; set BACKEND_PORT in apps/api/.env.local OR pass --backend-port to /start-build")
   ```
2. **Replace the FastAPI-flavored error message** with a stack-neutral one. The current "verify uv is on PATH" only makes sense for python-fastapi; a node-fastify project getting that error is confusing.

### Phase B — stack-skill alignment (P2)

3. **Update each backend stack skill's §1 Canonical layout** (node-fastify, node-trpc-nest, python-fastapi) to declare the canonical port:
   - python-fastapi: 8000
   - node-fastify: 3001
   - node-trpc-nest: 4000 (or whatever Nest's convention is)
4. **Update `.claude/templates/dev-multi-tier.mjs.template`** to emit `BACKEND_PORT=<stack-default>` into `.env.local` (currently emits to PORT only — let's emit both for compat).
5. **Update `.claude/skills/architect/SKILL.md`** to document that the architect should record the chosen backend_framework's canonical port in architecture.yaml so dev-server.ts can consult it.

### Phase C — verifier diagnostic (P2)

6. **Improve the parity-verify auto-boot warning** to surface the specific resolution path that failed:
   - "Backend port resolution chain: env=null, .env.local=null, .env=null, dev.mjs=null, stack-default=fastify→3001"
   - "Tried http://localhost:3001/health, no response within 60s"
   - "Either start the backend manually before parity-verify, or fix the port detection."

### Phase D — empirical re-validation (P0 to declare bug-038 closed)

7. **Re-run finance-track-01's parity-verify** (or a fresh small project) — confirm:
   - resolveBackendPort returns the actual port (not 8000)
   - Backend boot succeeds
   - parity-verify completes with `screens checked` rather than skipping
   - The dimension's score goes from 0 to non-zero (real coverage)

## Rejected Fixes

- **"Just bump DEFAULT_BACKEND_PORT to 3001"** — Rejected: still hardcoded, just shifts the broken default to a different stack. Need stack-aware resolution.
- **"Make every project ship a `apps/api/.env` with PORT="** — Rejected: bug-033 canonical location is `.env.local`. We should TEACH the resolver to read `.env.local`, not move the convention.
- **"Pass --backend-port flag to /start-build"** — Rejected: operator-side workaround that doesn't scale. Default should JUST WORK per stack.
- **"Fail the build instead of warning"** — Rejected as the primary fix: parity-verify is one verifier dimension; failing the entire build because of port detection is too aggressive. After Phase A lands, this becomes consideration territory (warning OR failure depending on scoring policy).

## Validation Criteria

### Phase A

- [ ] `resolveBackendPort` precedence extended to 7 levels (env, BACKEND_PORT, .env.local, .env, dev.mjs, stack-default, throw).
- [ ] Stack-default lookup reads `architecture.yaml.tooling.stack.backend_framework`.
- [ ] Default table covers fastapi:8000, fastify:3001, trpc-nest:4000, express:4000.
- [ ] Error message no longer mentions "uv" / "pyproject.toml" for non-FastAPI stacks.
- [ ] Regression tests cover each precedence level + stack-default fallback.

### Phase B

- [ ] node-fastify SKILL.md §1 declares canonical port = 3001.
- [ ] node-trpc-nest SKILL.md §1 declares canonical port.
- [ ] python-fastapi SKILL.md §1 declares canonical port = 8000.
- [ ] dev-multi-tier.mjs.template emits BACKEND_PORT (in addition to PORT).
- [ ] architect SKILL.md documents recording the canonical port.

### Phase C

- [ ] parity-verify warning surfaces the resolution chain that failed.

### Phase D

- [ ] Re-run finance-track-01's verifier (or fresh project): parity-verify completes with screens checked.

## Cross-references

- **Empirical case**: 2026-05-02 finance-track-01 — fastify backend, port 4000 in .env.local; resolver fell back to 8000; auto-boot failed.
- **Sister bug**: bug-037 (Playwright runtime not auto-installed) — same verify-stage warnings surfaced both bugs.
- **Predecessor fix**: bug-033 made `.env.local` the canonical port-config location for `dev-multi-tier.mjs.template`. dev-server.ts predates that fix.
- **Architecture context**: `.claude/architecture.yaml` already records `backend_framework` — the resolver just needs to consume it.

## Attempt Log

<!-- populated as fix attempts are made -->
