---
id: bug-071-playwright-webserver-spawn-zero-bytes
type: bug
status: draft
author-agent: human
created: 2026-05-07
updated: 2026-05-07
parent-plan: bug-069-backend-cold-boot-exceeds-180s-strategy-c
supersedes: null
superseded-by: null
branch: fix/playwright-webserver-spawn-zero-bytes
affected-files:
  - projects/reading-log-01/apps/web/playwright.config.ts
  - .claude/templates/playwright.config.ts.template
feature-area: orchestrator/strategy-c-webserver-spawn
priority: P1
attempt-count: 0
max-attempts: 5
error-message: |
  When playwright spawns its webServer block (`pnpm --filter @repo/api dev`),
  the backend produces 0 bytes of stdout/stderr for the entire 180s timeout
  window. Same command spawned directly via Node child_process boots in 3.1s
  with normal output. Mystery: playwright's webServer spawn semantics +
  Windows + pnpm filter combination produces no observable backend activity.
---

# bug-071: Playwright webServer spawning backend produces 0 bytes for 180s

## Bug Description

bug-069 Step 2 diagnostic (`_tmp-time-playwright-spawn.mjs`) ran the EXACT
spawn pattern `scripts/run-synthesized-flows.mjs:486` uses:

```
pnpm.cmd -C apps/web exec playwright test e2e/synthesized/ --reporter=json --project=chromium
```

Result: 180s elapsed, 0 bytes stdout, 0 bytes stderr from backend.
Playwright's JSON output:

```json
"errors": [{"message": "Error: Timed out waiting 180000ms from config.webServer."}]
```

Direct backend spawn (`_tmp-time-backend-boot.mjs`) using the same command
boots in 3.1s with full output. So the issue is specifically how playwright
spawns + manages the webServer child process.

## Hypotheses

**A. Playwright suppresses webServer child output by default.** Per
playwright docs, webServer stdout/stderr is NOT propagated to the
parent unless explicitly piped. The "0 bytes" observation is from MY
node parent of the playwright CLI — playwright might be running the
backend fine but never sending its output upstream. Need to test by
adding `stdout: "pipe"` to webServer config + check.

**B. pnpm-recursive-exec issue.** The command `pnpm -C apps/web exec
playwright test` shows `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` at the end
of the diagnostic run. pnpm may be misinterpreting the command shape
on Windows. Maybe `pnpm --filter @repo/web exec ...` would behave
differently.

**C. Windows shell-nesting.** The chain is: my Node spawns shell:true
→ runs pnpm.cmd → pnpm spawns Node → playwright runs → playwright
spawns webServer command via shell again → pnpm --filter @repo/api dev
→ pnpm spawns Node → tsx watch. Five levels of nested shells/processes.
On Windows, env propagation, signal handling, or PATH resolution may
fail at one of these layers.

**D. Backend genuinely doesn't start under playwright spawn.** Maybe
playwright sets a working directory or env var that breaks pnpm's
filter resolution. e.g. if cwd is `apps/web/`, `pnpm --filter @repo/api`
might not find the workspace root.

## Investigation steps

### Step 1 — Add stdout: "pipe" to webServer config + re-test (15min)

Test hypothesis A directly. If backend output appears with the explicit
pipe, the bug is "playwright defaults to suppressed output" and the fix
is updating the playwright.config.ts template + project to opt in.

### Step 2 — Try pnpm --filter instead of pnpm -C (15min)

Replace `pnpm -C apps/web exec playwright test` with `pnpm --filter
@repo/web exec playwright test` in the runner. Tests hypothesis B.

### Step 3 — Direct playwright invocation (skip pnpm) (15min)

Run `node apps/web/node_modules/playwright/cli.js test` directly. If it
works, the issue is pnpm's exec wrapper.

### Step 4 — Decide based on Step 1-3 findings

Most likely fix: add `stdout: "pipe"` (or similar surfacing) to the
webServer template. Plus maybe document the pnpm-recursive-exec issue.

## Operator workaround (current)

Pre-boot backend via `node scripts/dev.mjs` from project root.
playwright's `reuseExistingServer: !process.env.CI` skips its own
spawn → goes straight to test execution. Empirically validated:
reading-log-01 b3alrlt19 (with bug-070 patch ALSO needed) runs full
suite in seconds.

## Cross-references

- `bug-069` (parent) — overall Strategy C cold-boot wall
- `bug-067` — playwright webServer.timeout (extended to 180s; this bug
  shows the 180s isn't actually being USED to boot backend, just to
  WAIT for output that never comes)
- `bug-070` — globalSetup port-resolution (sister bug; ships unblocking
  pre-booted-backend path)

## Attempt Log

### 2026-05-07 — Empirical reframing + fix architecture

After investigate-022 (factory-verifier missed 8 review bugs on reading-
log-01), promoted bug-071 from deferred → urgent. The `synth-e2e wedge`
explains 5 of 8 review-bug misses (62.5% of the gap). The factory's
behavior tier (synthesized e2e specs) is dead-on-arrival in autonomous
mode because every dispatch hits this 0-byte spawn issue.

**Empirical isolation test (reading-log-01 master @ 9d28a0d, 2026-05-07)**:

Manual-bypass run reproduced the working path:

```
1. Boot backend with ENABLE_TEST_SEED=1:
     `pnpm --filter @repo/api dev` (env: ENABLE_TEST_SEED=1)
2. Boot frontend (already up via `node scripts/dev.mjs`)
3. From apps/web/, run:
     `pnpm exec playwright test e2e/synthesized/ --project=chromium`
```

Result: **all 6 synth-e2e specs RAN in 3 minutes**. 6 failures with real
locator-not-found errors at interaction 2-3 — exactly the kinds of
bugs the verifier was designed to surface (e.g. "role=link[name=/The
Overstory/i]" not found ↔ user's manually-discovered `/books/NaN`
bug; "role=button[name='Rename tag']" not found ↔ user's manually-
discovered tag-rename-broken bug).

**Wedge isolated to the SPAWN.** When playwright (or its webServer
block, or run-synthesized-flows.mjs's spawnDevServer) tries to spawn
the dev server fresh, 0 bytes for 180s. When the dev server is
ALREADY running and playwright sees it via `reuseExistingServer:true`,
all 6 specs run.

**Sister findings during isolation test**:

1. **`scripts/dev.mjs` doesn't set ENABLE_TEST_SEED=1** — operators
   manually booting for review can't subsequently run the verifier
   because `/test/seed-baseline` returns 404 (route gated by env var).
   The orchestrator's `dev-server.ts` line 230 sets it correctly for
   verifier-mode, but the operator-mode `dev.mjs` doesn't.

2. **`reuseExistingServer` health-check is too weak** —
   playwright.config.ts probes `/health` for reuse. A pre-booted server
   without ENABLE_TEST_SEED=1 PASSES `/health` but lacks `/test/seed-baseline`.
   Playwright reuses it silently → globalSetup fails → 0 tests run.
   Should probe `/test/seed-baseline` (or a similarly gated endpoint)
   for Strategy C reuse.

### Fix architecture (shipping)

**Main fix — orchestrator pre-boots dev-server before synth-e2e**:

- `orchestrator/src/build-to-spec-verify.ts` already calls
  `parityVerify({ autoBootDevServer: true })` which uses `dev-server.ts`'s
  `bootDevServer()` (works ✓ — emits "auto-booted at http://localhost:3000
  (took 7367ms)" empirically).
- Currently `runFlows` doesn't get a pre-booted URL — it shells to
  `scripts/run-synthesized-flows.mjs` which detects `webServer:` block in
  playwright.config.ts and DEFERS to playwright's auto-spawn (which 0-bytes).
- Fix: hoist the dev-server boot to the orchestrator-level, share the
  URL across `runFlows` AND `parityVerify`, teardown at end.

**Sub-fix D — `dev.mjs` templates set ENABLE_TEST_SEED=1**:

All 4 backend stack variants under
`.claude/templates/dev-multi-tier-*.mjs.template`. Two-line change per
template — set `ENABLE_TEST_SEED: "1"` in the backend spawn env.

**Sub-fix E (deferred)**: enrich playwright.config.ts's
`reuseExistingServer` health probe to verify `/test/seed-baseline`
when Strategy C. Defer pending main-fix empirical confirmation; the
main fix bypasses webServer block entirely so reuse-health-check is
moot in the orchestrator path.

### Cross-references

- `investigate-019` H6 — orthogonal MCP-keepalive issue affecting
  agent dispatches (M-D shipped 76d29a5). Not the same as bug-071's
  webServer issue.
- `investigate-022` — meta-analysis showing 5 of 8 review-bug misses
  trace to bug-071's wedge. THIS plan is the ship surface for that
  finding.
- `bug-070` — sister wedge issue at globalSetup port resolution
  (shipped). bug-071 is the LAYER ABOVE — even if globalSetup works,
  the dev-server has to be reachable first.
- `bug-072` — envelope-fallback for failure-HTML capture (shipped
  335642f); makes bug-071's eventual fix-cycle output debuggable.
