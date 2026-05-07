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

(empty — drafted; deferred pending bug-070 empirical re-validation. If
bug-070 alone unblocks Strategy C via pre-booted backend, bug-071 is a
lower-priority polish item. If Strategy C still wedges in fully-
autonomous /fix-bugs runs, bug-071 becomes urgent.)
