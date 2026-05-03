---
id: bug-052-verifier-integration-shakeout-five-runtime-bugs
type: bug
status: in-progress
author-agent: claude-opus-4-7
created: 2026-05-03
updated: 2026-05-03
parent-plan: feat-022-build-to-spec-verification
supersedes: null
superseded-by: null
branch: feat/quota-observability
affected-files:
  - scripts/run-synthesized-flows.mjs
  - scripts/synthesize-flow-e2e.mjs
  - orchestrator/src/dev-server.ts
  - orchestrator/tests/synthesize-flow-e2e.test.ts
feature-area: orchestration
priority: P0
attempt-count: 1
max-attempts: 5
error-message: "First end-to-end run of feat-049 + bug-050 + feat-050 against finance-track-01 surfaced 5 distinct verifier-integration runtime bugs that unit tests didn't catch. The verifier wrapper was technically working but every code path that involved spawning a dev server / parsing Playwright output / making HTTP requests had a latent bug that fired only in the orchestrator-driven run."
reproduction-steps: "Run `runBuildToSpecVerify` (orchestrator wrapper) against any Strategy C project (multi-tier with mandatory webServer block). Each phase below reproduces against finance-track-01 specifically; classes generalize across projects."
stack-trace: null
---

# bug-052 — Verifier-integration shakeout: 5 runtime bugs surfaced by first end-to-end run

## Description

Wave 3 factory work (feat-049 catalog/classifier + bug-050 cause-routing + feat-050 per-flow seed orchestration) all unit-tested green at 660/660. First time the orchestrator wrapper `runBuildToSpecVerify` was invoked end-to-end against a real Strategy C project (`finance-track-01`), 5 distinct integration-runtime bugs surfaced — each independently masked the next, requiring an iterative empirical-debugging loop to surface them in turn.

This plan captures all 5 fixes for traceability. Each is a narrow surgical patch; aggregate effect is the verifier finally running end-to-end with correct classification + routing + visual-parity output.

## Phase A — Runner CI=1 collision with `webServer.reuseExistingServer` (SHIPPED)

### Symptom

`scripts/run-synthesized-flows.mjs` ran in 8s and reported `flows: { passed:[], failed:[], skipped:[] }` with `ok: true` and no warnings. 9 synthesized specs existed; Playwright should have run them; 0 ran.

### Root cause

The runner spawned its own dev-server in Step 3, then ran Playwright in Step 4 with `env: { ..., CI: "1" }`. `playwright.config.ts` (per bug-041 Phase B mandate) has `reuseExistingServer: !process.env["CI"]` — with CI=1, Playwright tried to boot ITS OWN webServer (running `node ../../scripts/dev.mjs`), hit port collision on 3000, exited fast with no JSON reporter output.

### Fix

`scripts/run-synthesized-flows.mjs` runPlaywright spawn — strip `CI` from the child env (was hardcoded to "1"). Side-effect: `retries: 0` instead of CI's 1, and `forbidOnly: false` instead of true. Acceptable — verifier loop has its own retry layer; forbidOnly doesn't matter for synthesized specs.

```js
const childEnv = { ...process.env, FORCE_COLOR: "0" };
delete childEnv.CI;
```

## Phase B — Runner spawnDevServer only boots frontend, not multi-tier (SHIPPED)

### Symptom

Even after Phase A, the runner still returned 0/0/0 because Playwright's webServer didn't fire (reuseExistingServer succeeded against the runner's frontend-only dev server) but global-setup needed the BACKEND at port 3001 → global-setup failed → tests never ran.

### Root cause

`spawnDevServer` invokes `pnpm -C apps/web dev` which is just `next dev` (frontend only). Multi-tier projects (post bug-040/041) have a `node scripts/dev.mjs` orchestrator that boots both tiers — the canonical Strategy C boot is via Playwright's `webServer.command: "node ../../scripts/dev.mjs"`. The runner's dev-server is now redundant + actively harmful.

### Fix

`scripts/run-synthesized-flows.mjs` Step 3 — when `playwright.config.ts` contains a `webServer:` block, SKIP the runner's own dev-server boot and let Playwright handle it via `reuseExistingServer: true`. Legacy projects without webServer keep the existing boot path.

```js
const hasWebServerBlock = /\bwebServer\s*:/.test(cfgText);
if (!hasWebServerBlock) {
  devProc = spawnDevServer(...);
  await waitForDevServer(...);
} else {
  warnings.push("dev-server: deferring to playwright.config.ts webServer block (per bug-041 Phase B)");
}
```

## Phase C — `parseFailureMessage` regex chokes on embedded quotes (SHIPPED)

### Symptom

After Phase A+B, Playwright ran (218s wall-clock = 9 specs × ~30s + boot). 9 failures captured. classifier output: only 1 of 9 selectors got extracted; 8 fell through to `step-transition` or `timeout-no-evidence` fallback classes → all 9 routed identically to `web-frontend-builder`.

### Root cause

`scripts/run-synthesized-flows.mjs` `parseFailureMessage` extracts selectors from Playwright errors via `/locator\(\s*['"]([^'"]+)['"]\s*\)/g`. The `[^'"]+` character class breaks at the FIRST quote of EITHER kind — so `locator('[data-kit-component="Card"]:has-text("Import CSV")')` (single-quoted argument with double-quoted CSS attributes inside) caused the regex to stop at the first `"` it hit → captured nothing → selector was undefined → classifier returned null → primaryCause stayed `step-transition` (legacy fallback).

### Fix

`scripts/run-synthesized-flows.mjs` `parseFailureMessage` — split the regex into two alternated patterns (single-quoted vs double-quoted), each respecting only its own opening quote:

```js
const locatorRe = /locator\(\s*'([^']*)'\s*\)|locator\(\s*"([^"]*)"\s*\)/g;
```

Empirical impact: 8-of-8 finance-track-01 selectors now extracted correctly; classifier now fires; primaryCause distribution shifts from `4 step-transition + 1 build-gap + 4 timeout` to `4 build-gap + 1 manifest-author + 4 timeout`.

## Phase D — feat-050 emission relative URLs hit FRONTEND not BACKEND (SHIPPED)

### Symptom

After Phase A+B+C, flow-1 + flow-9 (the only flows with feat-050 `requiredState`) failed with:

```
Error: feat-050 cleanup failed: 404: <!DOCTYPE html><html lang="en">...
```

The 404 HTML is a Next.js 404 page → request hit FRONTEND port 3000, not BACKEND port 3001. The cleanup endpoint never reached the backend.

### Root cause

`scripts/synthesize-flow-e2e.mjs` Strategy C requiredState emission used `await request.post("/test/cleanup", ...)`. Playwright's `APIRequestContext` defaults to `use.baseURL` from `playwright.config.ts` which is `http://localhost:3000` (frontend). `/test/cleanup` lives on the BACKEND.

### Fix

Emit absolute URLs using the `NEXT_PUBLIC_API_BASE_URL` env var convention (matches `apps/web/e2e/helpers/seed-db.ts` pattern):

```js
const __apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const cleanupRes = await request.post(`${__apiBase}/test/cleanup`, { data: ... });
```

+5 emission tests updated to expect the new absolute-URL pattern.

## Phase E — parity-verify backend boot missing required env vars (SHIPPED)

### Symptom

After Phase A+B+C+D, flows ran + 9 bugs filed correctly. But parity-verify reported `screensChecked: 0` with the warning:

```
parity: dev-server: auto-boot failed: backend (node-fastify) did not respond on
http://localhost:3001/health within 60000ms. Resolved spawn: pnpm.cmd --filter @repo/api dev ...
```

Visual bugs (logo color, header drift, kit-component shell-stripping) NOT detected because parity-verify never got past its dev-server step.

### Root cause

`orchestrator/src/dev-server.ts` `spawnBackendDevServer` spawned `pnpm --filter @repo/api dev` with only `PORT` injected into env. finance-track-01's backend has strict env validation:

```ts
// apps/api/src/plugins/env.ts
throw new Error(`Invalid environment configuration: ${missing}`);
// → DATABASE_PATH: Required
```

The backend crashed during plugin-init before binding /health. Playwright's webServer block injects DATABASE_PATH + ENABLE_TEST_SEED + LOG_LEVEL + NEXT_PUBLIC_API_BASE_URL — parity-verify's spawn didn't.

### Fix

`spawnBackendDevServer` — inject the test-mode env conventions established by bug-041/042 (the Strategy C contract): `ENABLE_TEST_SEED=1`, `DATABASE_PATH="./data/finance-track-test.db"`, `LOG_LEVEL="warn"`. Operator can still override via process.env (caller-overrides win via spread order).

```ts
const backendEnv = {
  ENABLE_TEST_SEED: "1",
  DATABASE_PATH: "./data/finance-track-test.db",
  LOG_LEVEL: "warn",
  ...process.env,
  PORT: String(port),
};
```

## Bonus — Defensive warning when 0 tests run unexpectedly fast (SHIPPED in Phase A)

### Symptom

Phase A's symptom (runner returned 0/0/0 with no warning) wouldn't have been visible without inspection. This warning makes the failure mode self-diagnosing for future occurrences.

### Fix

`scripts/run-synthesized-flows.mjs` post-parse — when 0 tests recorded AND totalRunMs < 15s (a single test takes longer to boot Chromium), push warning:

```js
warnings.push(
  `runner returned 0 tests in ${totalRunMs}ms despite ${specFiles.length} synthesized spec(s) — Playwright likely failed to start. Common causes: webServer port collision (CI=1 disables reuseExistingServer), pnpm exec resolution failure, missing browser install.`,
);
```

## Empirical impact

| Run                                 | Phase fixes in place                        | flows passed | flows failed | bugs filed | classifications                                                                               |
| ----------------------------------- | ------------------------------------------- | ------------ | ------------ | ---------- | --------------------------------------------------------------------------------------------- |
| 1 (b90fa42ft, bpyyw1df9, bpsauvpk6) | none — naked invocation                     | 0            | 0            | 0          | runner crashed silently                                                                       |
| 2 (bg0f7syse)                       | A+B                                         | 0            | 0            | 0          | runner returned 0/0 in 8s — Phase B not complete                                              |
| 3 (b44ati1vu)                       | A+B                                         | 0            | 9            | 9          | 4 step-transition + 1 build-gap + 4 timeout (regex broken)                                    |
| 4 (bvy79r3q8)                       | A+B+C                                       | 0            | 9            | 9          | 4 build-gap + 1 manifest-author + 4 timeout — but bugs.yaml had stale entries from prior runs |
| 5 (bmjxdwyz3)                       | A+B+C+D                                     | 0            | 9            | 9          | classifier correct, but flow-1/9 still hitting backend 500 (FK + column-name issues)          |
| 6 (bor4cy989)                       | A+B+C+D — bugs.yaml deleted, manifest fixes | 0            | 9            | 9          | 4 build-gap + 1 manifest-author + 4 timeout — fresh bugs.yaml correctly classified            |
| 7 (by29fswv0 — in-flight)           | A+B+C+D+E                                   | TBD          | TBD          | TBD        | parity-verify expected to run + produce visual-parity divergences                             |

## Success criteria

- [x] Phase A: runner doesn't propagate `CI=1` to Playwright child env
- [x] Phase B: runner skips own dev-server boot when webServer block present
- [x] Phase C: parseFailureMessage extracts selectors with embedded quotes
- [x] Phase D: feat-050 emission uses absolute URL via NEXT_PUBLIC_API_BASE_URL
- [x] Phase E: spawnBackendDevServer injects DATABASE_PATH + ENABLE_TEST_SEED defaults
- [x] Bonus: defensive warning fires when 0 tests run < 15s
- [ ] Empirical run #7 (post Phase E): parity-verify produces visual-parity divergences in bugs.yaml
- [ ] Test suite stays green (660/660 confirmed mid-Phase-E)

## Cross-references

- Parent: `feat-022-build-to-spec-verification` — the verifier framework all 5 phases hardened
- Sister: `bug-041-playwright-config-missing-webserver-block` — Phase B leans on bug-041's webServer mandate
- Sister: `bug-042-global-setup-baseline-only-seeds-fx-cache` — Phase D + E exercise bug-042's `/test/*` endpoint contract
- Sister: `feat-049-screens-json-cross-reference` — Phase C unblocks classifier (which feat-049 introduced)
- Sister: `feat-050-per-flow-seed-orchestration` — Phase D + E support feat-050's `requiredState` emission
- Empirical: 7 verifier runs against finance-track-01 (2026-05-03) — each surfaced the next phase's bug after the prior was fixed
