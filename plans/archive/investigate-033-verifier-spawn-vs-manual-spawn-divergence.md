---
id: investigate-033-verifier-spawn-vs-manual-spawn-divergence
type: investigation
status: archived
author-agent: human
created: 2026-05-15
updated: 2026-05-15
archived-at: 2026-05-15
outcome: success
parent-plan: null
supersedes: null
superseded-by: null
branch: null
affected-files:
  - orchestrator/src/dev-server.ts
feature-area: orchestrator/dev-server-spawn
priority: P1
attempt-count: 1
max-attempts: 5
time-box-minutes: 60
hypothesis: "The verifier's `spawnBackendDevServer` (orchestrator/src/dev-server.ts) produces an empty err.message during 60s of /health probing on Windows, while the EXACT same uv-shaped spawn from a bash shell at the same cwd boots cleanly + responds. The most likely cause is Windows-specific spawn behavior — either (a) PATH/PATHEXT shim doesn't resolve `uv` (no .exe suffix, no shell:true) so the child exits silently, (b) child stdout/stderr pipes aren't drained → child blocks on full buffer → never binds, OR (c) the child cwd inherits orchestrator/'s cwd rather than `<projectDir>/apps/api`. The empty err.message strongly suggests an ECONNREFUSED whose .message field is blank for some Node-on-Windows path."
---

# investigate-033-verifier-spawn-vs-manual-spawn-divergence: Why does the verifier's backend spawn fail with an empty error on Windows when the manual equivalent works?

## Question

After `git mv apps/api/src/main.py apps/api/src/api/main.py` resolved the bug-111 module-import-failure class on `gotribe-tribe-directory`, the manual spawn `(cd apps/api && uv run uvicorn api.main:app --app-dir src --port 8003)` boots cleanly and responds. But the verifier's `spawnBackendDevServer` — using IDENTICAL command/args/cwdRelativeToProject — fails: `dev-server pre-boot failed: last error: ;` (empty `lastErr.message`) after a full 60s of polling. Both Tier 3 parity-verify and Tier 5 walkthrough cascade-skip as a result. **Why does the verifier's spawn fail when the manual spawn succeeds with the same command shape, and what does the empty error message conceal?**

## Hypothesis

Empirically (2026-05-15 post-`6646601`):

- Manual: `(cd projects/gotribe-tribe-directory/apps/api && uv run uvicorn api.main:app --app-dir src --port 8003)` → server up, HTTP 404 on `/` (no route by design), HTTP 404 on `/health` (no route)
- Verifier: same project, same `STACK_BACKEND_SPAWN_COMMAND["python-fastapi"]` shape (port 8000) → `last error: ` empty after 60s, child never marked as `child.exitCode !== null` (line 484-492 fast-fail path doesn't fire)

5 falsifiable hypotheses, ordered by likelihood given the Windows context:

- **H1 — PATH/PATHEXT resolution.** `cmd: "uv"` (no `.exe`) spawned without `shell: true` on Windows may not resolve at all → child fails to launch → underlying error is something like `Error: spawn uv ENOENT` but the message gets swallowed at the orchestrator layer. Earlier dev-server.ts edits explicitly call out `pnpm.cmd` vs `pnpm` (line 5-9 of the spawn-block comments). The `uv` entry doesn't have a `.cmd` / `.exe` variant logic. **Falsified if** the child PID is created and visible in process list during the verifier's 60s window.

- **H2 — stdin/stdout pipe backpressure.** If the spawn config doesn't redirect or drain the child's stdout+stderr, Node's default pipe behavior will fill the OS buffer and BLOCK the child once it writes ~64KB of stdout (uvicorn's startup banner + per-request logs). Block-on-write → child never binds → /health 60s timeout. The `_stderrTail` array (lines 484-488) implies stderr IS being captured; need to check whether stdout is captured AND drained. **Falsified if** the spawn explicitly drains stdout (e.g. `child.stdout.on('data', ...)`) OR uses `stdio: 'pipe'` with consumption.

- **H3 — cwd inheritance.** The spawn uses `cwdRelativeToProject: "apps/api"` resolved relative to `projectDir`. If `projectDir` resolution differs between the orchestrator's invocation path and the test seam, the spawn cwd could land somewhere that doesn't have `pyproject.toml` → `uv run` fails with no project found. **Falsified if** the spawn options object has a correct absolute `cwd` and the child's actual cwd is `<projectRoot>/apps/api`.

- **H4 — probeOnce ECONNREFUSED has empty message.** Node's `http.get` on a not-listening port throws an Error whose `.message` may be `''` for some kernel paths (vs `"connect ECONNREFUSED 127.0.0.1:8000"` for the common case). If the child IS launched + binding fails for reasons orthogonal to H1-H3, every probe ECONNREFUSEs with no message → `last error: ` = empty. **Falsified if** probeOnce's catch produces a non-empty `.message` when manually wired to a known-bad port.

- **H5 — Stale port 8000 holder.** Something on the developer's machine holds port 8000 but doesn't show up in `netstat`/`Get-NetTCPConnection` (e.g. WSL2 proxy, Docker desktop, antivirus interceptor). Manual spawn used port 8003 (succeeded) while verifier uses 8000 (failed). **Falsified if** running the verifier with `BACKEND_PORT=8003` env override still fails identically.

The empty error message is the load-bearing signal. Whichever hypothesis carries the actual bug, the fix MUST also include making the error informative — silent 60s timeouts are the same class as bug-111 (warnings that hide root causes).

## Investigation Steps

Time-boxed at 60 minutes. Each step produces an observation.

1. **Reproduce the empty error reliably** (5 min):
   - From factory root, run `cd orchestrator && pnpm exec tsx scripts/run-verifier.ts "C:/Development/ps/claude/claude_/agentflow_phase2/projects/gotribe-tribe-directory"`.
   - Confirm `_tmp-verify-output.json` shows the same `last error: ` empty warning.
   - Note wall-clock duration (last run: 124s) + which tiers cascade-skipped.

2. **Read the spawn code** (5 min):
   - `orchestrator/src/dev-server.ts spawnBackendDevServer` — capture: spawn options (cwd, env, stdio, shell), how stderr is captured into `_stderrTail`, whether stdout is consumed.
   - Compare against `node-fastify` entry's spawn shape (which uses `pnpm.cmd` on Windows per process.platform check). Note: does `python-fastapi` have any platform-conditional logic for `uv`?

3. **Test H1 — PATH/PATHEXT resolution** (10 min):
   - Run the same `child_process.spawn` directly via a tiny tsx scratchpad:
     ```ts
     const c = spawn(
       "uv",
       [
         "run",
         "uvicorn",
         "api.main:app",
         "--app-dir",
         "src",
         "--host",
         "0.0.0.0",
         "--port",
         "8004",
       ],
       { cwd: "<absolute-path>/apps/api", windowsHide: true },
     );
     c.on("error", (e) => console.error("error:", e));
     c.stderr.on("data", (d) => process.stderr.write(d));
     c.stdout.on("data", (d) => process.stdout.write(d));
     ```
   - Observe: does the child emit `error` (spawn-level failure) OR start uvicorn? Capture exit code + first 30 lines of stdout/stderr.
   - If H1 confirmed → fix shape: change cmd to `process.platform === "win32" ? "uv.exe" : "uv"` OR add `shell: true`.

4. **Test H2 — pipe drainage** (10 min):
   - In the spawn-direct scratchpad from step 3, withhold the `stdout.on("data", ...)` consumer and observe whether uvicorn binds within 60s.
   - If withholding stdout consumption breaks the bind → H2 confirmed; the orchestrator's actual spawn must NOT be draining stdout. Verify by inspecting `spawnBackendDevServer`'s spawn-options block.
   - If H2 confirmed → fix shape: add `child.stdout.on("data", () => {})` (drain-only consumer) or pipe to a ring buffer for diagnostics.

5. **Test H3 — cwd resolution** (5 min):
   - Add a `console.error` line to `spawnBackendDevServer` printing `resolvedCwd` right before spawn.
   - Re-run the verifier; observe whether `resolvedCwd` is the expected `<projectRoot>/apps/api` absolute path.
   - If wrong → trace `cwdRelativeToProject` resolution back to its consumer; fix the join.

6. **Test H4 — probeOnce error message** (5 min):
   - Run `node -e "require('http').get('http://localhost:9999/health', () => {}).on('error', e => console.log(JSON.stringify({code:e.code,message:e.message,errno:e.errno})))"` — port 9999 known-not-listening.
   - Observe whether `.message` is non-empty (e.g. `"connect ECONNREFUSED 127.0.0.1:9999"`) or empty.
   - If empty → H4 confirmed; fix: in `probeOnce`'s reject path, synthesize a richer message from `err.code` + `err.errno` + the URL.

7. **Test H5 — port 8000 holder** (5 min):
   - Run `BACKEND_PORT=8003 pnpm exec tsx scripts/run-verifier.ts <projectDir>` (verifier honors per-project port overrides via env).
   - If verifier succeeds on 8003 → H5 confirmed; the issue is port 8000 specifically.
   - If verifier still fails identically on 8003 → H5 falsified; the issue is spawn-shape, not port-availability.

8. **Synthesize fix-recipe scope** (10 min):
   - Once hypotheses are resolved, draft a bug plan covering:
     - The spawn-shape fix (whichever H confirmed)
     - The probeOnce error-message enrichment (always — empty errors are the wrong UX regardless of which H is the actual cause)
     - A regression test in `orchestrator/tests/dev-server.test.ts` that simulates each failure mode + asserts the resulting err.message is non-empty + descriptive
   - Identify whether the fix should also extend bug-111 Phase C — currently the regex only catches `Could not import module` / `ModuleNotFoundError` / `Cannot find module`. If H4 is real, ALL probe-timeout failures should ALSO route through `flowsFailed[]` rather than `warnings[]` (probably with a different `flowId` like `backend-probe-timeout`).

## Findings

**The investigation's framing was incorrect.** The operator's reported manual repro covered ONLY the backend (`uv run uvicorn ...`). The verifier failure is NOT the backend at all — it is the **frontend** (`pnpm.cmd -C apps/web dev`) failing because `projects/gotribe-tribe-directory/` has no `node_modules/` installed.

### Smoking gun (instrumented run, port 8000 + port 8003)

With temporary `console.error("[INV-033] ...")` instrumentation added to `bootDevServer` and reverted before commit, two identical verifier runs (one with default port 8000, one with `BACKEND_PORT=8003`) produced:

```
[INV-033] bootDevServer: backend child pid=43052 spawnargs=[..., "uv run uvicorn api.main:app --app-dir src --host 0.0.0.0 --port 8000"]
[INV-033] bootDevServer: backend ready in 1037ms       ← BACKEND BOOTS FINE
[INV-033] bootDevServer: spawning frontend dev-server (apps/web), baseUrl=http://localhost:3000
[INV-033] bootDevServer: frontend child pid=45724 spawnargs=[..., "pnpm.cmd -C apps/web dev"]
[INV-033] bootDevServer: frontend FAILED: last error:  ← FRONTEND IS WHAT TIMES OUT
```

Direct manual probe of the frontend (the test the operator never ran):

```
$ pnpm.cmd -C apps/web dev
> @repo/web@0.0.0 dev .../projects/gotribe-tribe-directory/apps/web
> next dev
'next' is not recognized as an internal or external command, operable program or batch file.
 ELIFECYCLE  Command failed with exit code 1.
 WARN   Local package.json exists, but node_modules missing, did you mean to install?
```

`ls projects/gotribe-tribe-directory/node_modules` → `No such file or directory`. The project has never had `pnpm install` run.

### Hypothesis verdicts

- **H1 — PATH/PATHEXT for `cmd: "uv"`.** **FALSIFIED.** Backend instrumentation shows `spawnargs=["cmd.exe","/d","/s","/c","\"uv run uvicorn ...\""]` — `shell: isWin` resolves `uv` cleanly via cmd.exe's PATHEXT. Backend pid 43052/45196/45040 all booted in ~1s on every run. Scratchpad replica (`spawn-test.ts`) matching dev-server.ts shape spawned a uvicorn that bound 0.0.0.0:8008 in <1s and answered 11 consecutive `/health` probes (status=404, no `/health` route by design).

- **H2 — stdout pipe backpressure.** **FALSIFIED.** dev-server.ts:284 already attaches `child.stdout.on("data", () => {})` to drain the buffer; line 286-294 captures stderr into `_stderrTail` (also drained). No backpressure path exists for the backend. For the frontend, lines 179-180 attach pure-drain handlers to BOTH stdout + stderr — drainage isn't the bug, but discarding the stderr content IS what hides the diagnostic ("'next' is not recognized" + "node_modules missing") from any downstream caller.

- **H3 — cwd inheritance.** **FALSIFIED.** Backend `spawnargs` confirm the spawn runs inside the cmd.exe at `<projectDir>/apps/api` (uvicorn finds `api.main` immediately; backend boots in 1037ms). Frontend cmd.exe runs at `<projectDir>` with `pnpm -C apps/web dev`. Both cwds are correct.

- **H4 — probeOnce ECONNREFUSED has empty `.message` on Windows.** **CONFIRMED.** `node -e "require('http').get('http://localhost:9999/health', () => {}).on('error', e => console.log(JSON.stringify({code:e.code,message:e.message,errno:e.errno})))"` → `{"code":"ECONNREFUSED","message":""}`. The `err.message` IS empty on Node 22.18.0 / Windows 11 for ECONNREFUSED. This is exactly what surfaces as `"last error: "` in dev-server.ts:502. The empty message is a real Node-on-Windows behavior and the dev-server.ts error-formatting assumes a populated `.message`.

- **H5 — stale port 8000 holder.** **FALSIFIED.** `netstat -ano | grep :8000` returned empty before the verifier run. Backend successfully bound port 8000 on baseline run (then port 8003 on H5 run). Both attempts produced the SAME final failure mode (frontend timeout, empty error). The bug is not port-specific.

### Additional incidental finding — leaked child processes

During scratchpad experiments, the SIGTERM-via-`child.kill()` on Windows did NOT terminate the underlying uvicorn process: pid 20096 was still LISTENING on port 8004 after the cmd.exe parent exited. Manual `taskkill /PID 20096 /F` was needed. This is the same class as the existing `killChildTree` `taskkill /T /F` solution in dev-server.ts (line 530-533) — but `child.kill()` (used by some teardown paths and by the scratchpad) bypasses it. Not the focal bug here; flag for future bug plan (`killChildTree` should be the only teardown surface).

### Root-cause chain

1. `gotribe-tribe-directory/` has no `node_modules/` (pnpm install never ran).
2. `spawnDevServer` (line 155-182) fires `pnpm.cmd -C apps/web dev` which prints `"'next' is not recognized..."` to stderr and exits code=1 within ~1s.
3. Frontend stderr is drain-only (line 180) — no `_stderrTail` capture, no error event surfaced.
4. `bootDevServer`'s frontend `waitForDevServer(baseUrl, timeoutMs)` (line 641) does NOT pass the child handle (compare backend boot at line 596-601 which DOES pass `backendProcess`). So the premature-exit fast-fail path (waitForDevServer line 484-492) cannot fire for the frontend.
5. `waitForDevServer` polls `http://localhost:3000` for 60s. Every poll ECONNREFUSEs with `err.message = ""` (H4 confirmed).
6. At 60s deadline it throws `"last error: ${lastErr.message}"` → `"last error: "` (empty trailing).
7. Caller surfaces `"dev-server: auto-boot failed: last error: ; parity-verify will skip..."` and the operator stares at an empty error with no clue that pnpm install was the missing prereq.

## Recommendation

Combined fix scope: single P1 bug plan with three coupled patches in `orchestrator/src/dev-server.ts`. None of these are pure regression fixes — they are diagnostic-surface fills that the empirical case proves are needed.

### Patch A — Frontend premature-exit detection (mirror backend pattern)

**File**: `orchestrator/src/dev-server.ts`
**Function**: `spawnDevServer` (lines 155-182) + `bootDevServer` frontend branch (lines 641).

- Capture frontend stderr into `_stderrTail: string[]` (mirror the backend pattern at lines 282-294). Drain-only at line 180 is what makes the diagnostic disappear.
- Pass the frontend `proc` as the 4th arg to `waitForDevServer(baseUrl, timeoutMs, undefined, proc)` at line 641 so the existing fast-fail path (lines 484-492) fires when `next dev` exits within seconds. This single line change converts a 60s silent timeout into a ~1s rich error: `"child process exited prematurely with code 1; stderr tail: <next-not-recognized + ELIFECYCLE + node_modules-missing-warning>"`.

### Patch B — probeOnce error-message enrichment (cross-cutting)

**File**: `orchestrator/src/dev-server.ts`
**Function**: `probeOnce` (lines 506-517) — reject path; AND/OR `waitForDevServer` line 501-503 error-formatter.

- `req.on("error", reject)` at line 512 propagates a Node error whose `.message` is empty for ECONNREFUSED on Windows. Wrap in a thin re-thrower that synthesizes from `err.code + err.errno + url`:
  ```ts
  req.on("error", (err: NodeJS.ErrnoException) => {
    const msg =
      err.message ||
      `${err.code ?? "UNKNOWN_ERR"} (errno=${err.errno ?? "?"}) probing ${url}`;
    reject(Object.assign(new Error(msg), { code: err.code, errno: err.errno }));
  });
  ```
- This change is mandatory regardless of which H confirmed — empty `.message` is bad UX in every failure mode, not just the frontend-not-installed case. After Patch A converts the common case to "child exited prematurely", Patch B catches the residual cases where the child stays alive but the server never binds (firewall, port in use externally, etc).

### Patch C — bootDevServer frontend catch-handler diagnostic wrap (parity with backend catch)

**File**: `orchestrator/src/dev-server.ts`
**Function**: `bootDevServer` (lines 640-646) — frontend catch handler.

- The backend catch at lines 602-627 wraps the underlying error with a rich diagnostic ("backend (python-fastapi) did not respond on ... Resolved spawn: ... Underlying: ..."). The frontend catch at lines 643-646 just re-throws. Symmetry: wrap frontend errors with the resolved baseUrl + the spawn command (`pnpm.cmd -C apps/web dev`) + a hint ("Verify `pnpm install` ran at <projectDir> and `apps/web` has a `dev` script").

### Patch D — extend bug-111 Phase C regex (deferred, separate plan)

**Recommendation**: **NO** — do NOT extend bug-111 Phase C regex to catch generic-probe-timeout failures.

Reasoning: bug-111 Phase C is narrowly scoped to `Could not import module / ModuleNotFoundError / Cannot find module` because those signatures unambiguously identify a **project-source** root cause (entry file at wrong path). Generic probe-timeout failures (Patch A's "child exited prematurely with code 1" + Patch C's wrapped diagnostic) cover a much broader class — missing pnpm install, port conflicts, syntax errors in next.config.ts, missing apps/web entirely, etc. Some of those are project-source bugs (file the plan), some are operator-environment (don't file). The right routing requires reading the stderr tail content, not just the wrapper text.

Counter-recommendation: when Patch A + B + C land, the stderr tail will be rich enough that a follow-up plan can SEPARATELY add a regex sweep over `_stderrTail` content matching specific signatures (`node_modules missing`, `command not found`, `EADDRINUSE`, etc.) and route THOSE through `flowsFailed[]`. That extension belongs in its own bug plan once the diagnostic surface exists to feed it.

### Regression test

`orchestrator/tests/dev-server.test.ts` — add three tests:

1. `probeOnce` against a known-not-listening port produces a non-empty error message (`expect(err.message).toMatch(/ECONNREFUSED.*9999/)`).
2. `waitForDevServer` with a child that exits code=1 within 100ms throws with stderr tail content within 1s, not 60s (`expect(elapsed).toBeLessThan(2000); expect(err.message).toMatch(/exited prematurely/)`).
3. `bootDevServer` against a project dir whose `apps/web` has no `node_modules` throws a wrapped error containing both the spawn command + a `pnpm install` hint within 5s (not 60s).

### Project-side hand-fix for the immediate operator

This is **not** a factory bug for `gotribe-tribe-directory` specifically — the project is missing its install step. Operator hand-fix:

```
cd C:\Development\ps\claude\claude_\agentflow_phase2\projects\gotribe-tribe-directory
pnpm install
```

After install, re-run the verifier. With Patches A+B+C still UNlanded, if the dev-server actually boots on this project the empty-error class will resurface only when SOMETHING ELSE breaks frontend boot — patches A+B+C are still load-bearing for future occurrences and other projects.

### Cross-references

- bug-111 — project-source module-import-failure routing. Not extended by this work; separate from frontend boot diagnostics.
- bug-038 Phase A — backend stderr tail capture. The pattern Patch A mirrors for the frontend.
- bug-061 — worktree teardown semantics. Tangential observation about `child.kill()` not killing the cmd.exe subtree on Windows surfaced during scratchpad work; file as separate plan if it surfaces empirically.
- investigate-032 — surfaced the bug-111 class. This investigation is the follow-up that explored the residual "spawn shape" question post-handfix.

## Attempt Log

### Attempt 1 — investigation execution (2026-05-15)

**Wall-clock**: ~50 minutes within the 60-minute time-box. Status: complete.

**Reproducer confirmed (step 1)**: Verifier run at port 8000 produced `last error: ` empty after 123.7s wall-clock, 5 warnings, 1 flow failure (tooling-pre-flight), parity skipped with screensChecked=0, walkthrough skipped (no dev-server handle). Identical signature to operator's report.

**Spawn-code read (step 2)**: `STACK_BACKEND_SPAWN_COMMAND["python-fastapi"]` uses `cmd: "uv"`, `cwdRelativeToProject: "apps/api"`. spawnBackendDevServer (line 235-299) ALREADY uses `shell: isWin` (line 269) so PATHEXT resolution works; ALREADY drains stdout (line 284); ALREADY captures stderr into `_stderrTail` (line 286-294). The full Strategy-C env (DATABASE_PATH, ENABLE_TEST_SEED, PORT) is built via `buildBackendSpawnEnv`. Backend spawn shape is well-defended.

**H1 / H2 / H3 — spawn-test scratchpad**: Wrote `orchestrator/scripts/spawn-test.ts` matching the exact dev-server.ts shape (`shell: isWin`, drained stdout, drained stderr, projectDir-relative cwd, full env). On port 8008 the scratchpad uvicorn:

- Spawned at pid 44532 with `spawnargs=["cmd.exe","/d","/s","/c","\"uv run uvicorn api.main:app --app-dir src --host 0.0.0.0 --port 8008\""]`
- Emitted "Application startup complete" via stderr
- Bound 0.0.0.0:8008 and answered 11 consecutive `/health` probes (status=404, no route by design)
- Exited only on our SIGTERM at t=12s

**FALSIFIED**: H1 (PATHEXT), H2 (backpressure), H3 (cwd).

**H4 — probeOnce empty message**: One-line node probe to port 9999 produced `{"code":"ECONNREFUSED","message":""}`. **CONFIRMED**: `err.message` IS empty on Node 22.18.0 / Windows 11 for ECONNREFUSED.

**Instrumented `bootDevServer`** with `[INV-033] console.error` prints, re-ran verifier. Output revealed the true failure path:

- Backend boots in 1037ms (port 8000) and 1015-1039ms (port 8003 — H5 run)
- Frontend `pnpm.cmd -C apps/web dev` spawns then fails with `last error: ` (empty)
- Empty message is because (a) frontend stderr is drain-only (line 180) so no `_stderrTail` exists, (b) frontend `waitForDevServer` call (line 641) doesn't pass the child handle so premature exit goes undetected, (c) probeOnce's ECONNREFUSED carries `.message = ""` (H4)

**Direct manual frontend probe**: `pnpm.cmd -C apps/web dev` from project root prints `"'next' is not recognized"` + ELIFECYCLE error + `WARN Local package.json exists, but node_modules missing`. Confirmed `ls node_modules` returns "No such file or directory" — the project has never had `pnpm install` run.

**H5 — port 8003 verifier**: `BACKEND_PORT=8003 pnpm exec tsx scripts/run-verifier.ts ...` produced IDENTICAL failure mode (backend boots fine on 8003, frontend fails identically). **FALSIFIED**.

**Cleanup**: Reverted all `[INV-033]` instrumentation from `dev-server.ts` (verified via `git diff orchestrator/src/dev-server.ts` → clean). Deleted `orchestrator/scripts/spawn-test.ts`. No production-shaped fix committed (out of investigation scope per instructions).

**Outcome**: Hypothesis framing in the plan body was off — bug is in frontend boot path, not backend. H4 confirmed (the empty-message class is real and load-bearing). Three coupled patches (A frontend premature-exit detection + B probeOnce message enrichment + C frontend catch-wrap diagnostic) recommended for follow-on bug plan. bug-111 Phase C regex extension NOT recommended — the right post-fix surface for project-source routing is a separate sweep over `_stderrTail` content once Patches A+B+C make that content available.
