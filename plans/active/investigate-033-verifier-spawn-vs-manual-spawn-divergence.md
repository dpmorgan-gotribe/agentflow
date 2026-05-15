---
id: investigate-033-verifier-spawn-vs-manual-spawn-divergence
type: investigation
status: draft
author-agent: human
created: 2026-05-15
updated: 2026-05-15
parent-plan: null
supersedes: null
superseded-by: null
branch: null
affected-files: []
feature-area: orchestrator/dev-server-spawn
priority: P1
attempt-count: 0
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
     const c = spawn("uv", ["run","uvicorn","api.main:app","--app-dir","src","--host","0.0.0.0","--port","8004"], { cwd: "<absolute-path>/apps/api", windowsHide: true });
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

(empty — to be populated by executing agent within the time box)

## Recommendation

(empty — to be populated once findings are complete)

## Attempt Log

(empty)
