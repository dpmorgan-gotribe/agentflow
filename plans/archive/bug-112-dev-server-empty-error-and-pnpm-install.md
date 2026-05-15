---
id: bug-112-dev-server-empty-error-and-pnpm-install
type: bug
status: archived
author-agent: human
created: 2026-05-15
updated: 2026-05-15
approved-at: 2026-05-15
completed-at: 2026-05-15
outcome: success
parent-plan: investigate-033-verifier-spawn-vs-manual-spawn-divergence
supersedes: null
superseded-by: null
branch: fix/dev-server-empty-error-and-pnpm-install
affected-files:
  - orchestrator/src/dev-server.ts
  - orchestrator/src/build-to-spec-verify.ts
  - orchestrator/src/fix-bugs-loop.ts
  - orchestrator/tests/dev-server.test.ts
  - orchestrator/tests/build-to-spec-verify.test.ts
feature-area: orchestrator/dev-server-spawn
priority: P1
attempt-count: 0
max-attempts: 5
error-message: "dev-server pre-boot failed: last error: ;"
reproduction-steps: |
  1. Project has merged Mode B but node_modules/ never installed in apps/web/ (e.g. operator-staging environment OR fresh git checkout).
  2. Run `cd orchestrator && pnpm exec tsx scripts/run-verifier.ts <projectDir>`.
  3. Verifier wall-clock: ~124s. Output shows `dev-server pre-boot failed: last error: ;` (empty .message).
  4. Tier 3 parity + Tier 5 walkthrough cascade-skip. "Clean" status reported despite frontend never booting.
stack-trace: null
---

# bug-112-dev-server-empty-error-and-pnpm-install: Frontend dev-server spawn silently fails on missing node_modules; probeOnce ECONNREFUSED has empty .message on Windows; verifier doesn't pre-flight install

## Bug Description

Three composing gaps in the verifier's dev-server boot path produce the same observable: `dev-server pre-boot failed: last error: ;` (empty error message) after 60s of polling. Tier 3 parity-verify + Tier 5 walkthrough cascade-skip, and the verifier reports "clean" status despite never actually exercising the live app.

Root cause analysis from `investigate-033` (4 of 5 hypotheses falsified — the backend was a red herring):

1. **`spawnDevServer` (frontend) drains stdout + stderr to no-op consumers** (`dev-server.ts:180-181`) and never captures a `_stderrTail` ring buffer. The backend's `spawnBackendDevServer` does both (`dev-server.ts:283-298`); the frontend was authored before that hardening shipped and was never back-ported.

2. **`bootDevServer:641` doesn't pass the frontend child to `waitForDevServer`**. The function already accepts `child?: ChildProcess` (line 473) and contains a premature-exit fast-fail (lines 484-492) — but the frontend call site omits the param, so a 1-second `'next' is not recognized` exit becomes a 60-second silent timeout.

3. **`probeOnce` (`dev-server.ts:506-517`) propagates `err.message` directly from Node's http error**. On Node 22 + Windows 11, `ECONNREFUSED` errors carry an empty `.message` field (the `.code` is `ECONNREFUSED` + `.errno` is set, but `.message` is `''`). `waitForDevServer:502` then throws `last error: ` with nothing after the colon.

4. **The verifier doesn't pre-flight `pnpm install`**. Empirical motivator: `projects/gotribe-tribe-directory/` 2026-05-15 — `apps/web/node_modules/` was never installed after Mode B's last merge. The dev-server spawn finds no `next` binary → immediate exit → 60s of silent ECONNREFUSED probes → "clean" verifier despite the frontend not being launchable. The fix-bugs loop has the same blind spot.

## Reproduction Steps

1. Use a project whose Mode B merged but whose `apps/web/node_modules/` is empty / missing:
   ```bash
   ls projects/gotribe-tribe-directory/apps/web/node_modules
   # → ls: cannot access ...: No such file or directory
   ```
2. Run the verifier:
   ```bash
   cd orchestrator
   pnpm exec tsx scripts/run-verifier.ts "<absolute-path>/projects/gotribe-tribe-directory"
   ```
3. Observe:
   - Wall-clock: ~124s (60s frontend pre-boot wait + 60s parity-verify auto-boot wait)
   - `docs/_tmp-verify-output.json` warnings include `dev-server pre-boot failed: last error: ;` and `walkthrough-review skipped: no dev-server pre-boot handle`
   - Tiers 3+4+5 cascade-skip
4. Manual sanity check shows `pnpm.cmd -C apps/web dev` exits in ~1s with `'next' is not recognized` + `WARN node_modules missing` — but the verifier never surfaces this stderr.

## Error Output

```
[verify-output.warnings]
- dev-server pre-boot failed: last error: ; runFlows + parityVerify will fall back to their own spawn paths
- parity: dev-server: auto-boot failed: last error: ; parity-verify will skip with screens unchecked
- walkthrough-review skipped: no dev-server pre-boot handle (sharedDevServerHandle not available)

[manual probe stderr]
> @repo/web@0.0.0 dev .../apps/web
> next dev --port 3000
'next' is not recognized as an internal or external command,
operable program or batch file.
 WARN  Local package.json exists, but node_modules missing, did you mean to install?
```

## Root Cause Analysis

Per `investigate-033`:

- **H1 (PATH/PATHEXT for `uv`)** — FALSIFIED. `shell: isWin` at `dev-server.ts:269` resolves both `uv` and `pnpm.cmd` via cmd.exe correctly. Backend boots in ~1037ms; frontend spawn ALSO launches (PID assigned) — just exits ~1s later.
- **H2 (stdout pipe backpressure)** — FALSIFIED. Both backend AND frontend spawns drain stdout+stderr.
- **H3 (cwd inheritance)** — FALSIFIED. `cwd: projectDir` resolves correctly; `-C apps/web` is pnpm's filter flag.
- **H4 (probeOnce empty message)** — **CONFIRMED**. `node -e "require('http').get('http://localhost:9999/health',()=>{}).on('error',e=>console.log(JSON.stringify({code:e.code,message:e.message,errno:e.errno})))"` → `{"code":"ECONNREFUSED","message":""}`.
- **H5 (port 8000 holder)** — FALSIFIED. Verifier with `BACKEND_PORT=8003` fails identically.

The empirical bug is the **frontend spawn shape**, not the backend. The agent investigation confirmed the backend boots in 1037ms; the verifier's pre-boot times out because the FRONTEND child exits in ~1s with `'next' is not recognized` (when `node_modules/` is missing) and the orchestrator never sees the stderr tail nor the exit code in time.

## Fix Approach

Four patches on adjacent surfaces. All independently shippable but landing in one PR.

### Patch A — Frontend spawn captures `_stderrTail` + premature-exit detection

**Surface:** `orchestrator/src/dev-server.ts spawnDevServer` (lines 155-184) + `bootDevServer:641` frontend wait call.

**Change:**

1. In `spawnDevServer`, mirror the backend pattern: capture stderr lines into a 50-line ring buffer + attach to child as `_stderrTail`. Keep stdout drain-only.
2. In `bootDevServer`, pass `proc` as the 4th arg to `waitForDevServer(baseUrl, timeoutMs, undefined, proc)` so the existing premature-exit fast-fail (lines 484-492) catches the 1-second `'next' is not recognized` exit instead of waiting 60s.

Result: missing-node_modules surfaces as `child process exited prematurely with code 1; stderr tail: 'next' is not recognized ... WARN node_modules missing` within ~2s.

### Patch B — `probeOnce` synthesizes message when `err.message` is empty

**Surface:** `orchestrator/src/dev-server.ts probeOnce` (lines 506-517).

**Change:** Wrap the `req.on("error", reject)` handler. When `err.message === ""` (the Node 22 + Windows 11 ECONNREFUSED case), build a synthetic message from `err.code` + `err.errno` + the URL:

```ts
req.on("error", (err) => {
  if (!err.message) {
    const code = (err as NodeJS.ErrnoException).code ?? "UNKNOWN";
    const errno = (err as NodeJS.ErrnoException).errno;
    err.message = `${code}${errno !== undefined ? ` (errno ${errno})` : ""} probing ${url}`;
  }
  reject(err);
});
```

Result: even when the premature-exit path doesn't fire (e.g. dev-server slow to start but eventually binds, intermittent network), the timeout-class error includes the underlying code. Future debug runs see `last error: ECONNREFUSED (errno -4078) probing http://localhost:3000/` instead of `last error: `.

This patch is mandatory regardless of whether Patch A lands — empty errors are bad UX in every case.

### Patch C — `bootDevServer` frontend catch matches stderr-tail signatures

**Surface:** `orchestrator/src/dev-server.ts bootDevServer` (lines 644-650 frontend catch block).

**Change:** When the frontend `waitForDevServer` throws, sweep `(proc as any)._stderrTail` for known signatures BEFORE re-throwing. If matched, enrich the error with a specific operator hint:

| Stderr signature             | Enrichment                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `node_modules missing`       | "Run `pnpm install` at projectDir first. Patch D auto-installs when this is detected." |
| `EADDRINUSE`                 | "Port 3000 already in use. Kill the holder or set `FRONTEND_PORT` env."                |
| `'next' is not recognized`   | "Same as node_modules missing — Next binary not in PATH for the spawn shell."          |
| `Cannot find module`         | "Missing dep in apps/web/package.json — backend-builder retry needed."                 |
| (no match — generic timeout) | Keep the existing `last error: ...` shape from Patch B.                                |

### Patch D — Verifier pre-flights `pnpm install` when `node_modules/` is missing

**Surface:** `orchestrator/src/build-to-spec-verify.ts` (very early in `runBuildToSpecVerify`, before any spawn or analysis call) + `orchestrator/src/fix-bugs-loop.ts` (before iteration 1's dispatches).

**Change:** When `existsSync(join(projectDir, "node_modules"))` is `false` (cheap check), spawn `pnpm install` from projectDir + await. Add to `warnings[]`: `"verifier pre-flight: ran pnpm install (took Nms; root node_modules was missing)"`. If install fails: file as a `runtime-error` bug via the existing cascade-root path so the fix-bugs loop sees it.

Mode B's `installAfterCommit` covers post-merge installs DURING the feature graph, but the verifier path (manual reruns, fix-bugs re-entry, operator-triggered) has no equivalent. This patch closes the gap for ALL non-Mode-B entry points.

Cheap when not needed: ~1ms (just an `existsSync` check). Expensive when needed: 30-60s for the install. The wall-clock cost is justified because the alternative is a 60s silent timeout PLUS a false-clean report PLUS operator confusion.

### Patch E (deferred) — Stderr-tail-content sweep for generic probe-timeouts

The investigation's recommendation noted that bug-111 Phase C's regex catches a narrow project-source class. A broader sweep matching node_modules / EADDRINUSE / command-not-found in stderr-tails should ALSO route through `flowsFailed[]` (not warnings[]). Patches A+B+C+D cover the immediate empirical case; this generalization is a follow-up plan after Patch C lands and we see whether the operator-hint shape is sufficient.

## Rejected Fixes

- **R1 — Make `pnpm install` always run before verify** — Rejected. 30-60s of unnecessary wall-clock on warm projects. The `existsSync` gate (Patch D) is the cheap, correct shape.

- **R2 — Make the dev-server spawn `pnpm install` itself** — Rejected. Mixing concerns; `spawnDevServer` should boot, not provision. Pre-flight separation makes the failure mode clearer.

- **R3 — Skip Patch B (probeOnce enrichment) since Patch A catches the empirical case** — Rejected. Patch A only catches PREMATURE-exit failures. Slow-binding servers, intermittent networks, port collisions all still produce the empty-message class. Patch B is universal defense.

- **R4 — Patch A's `_stderrTail` capture should pass through to the eventual fileBugPlan call** — Out of scope for this bug. Patch C's diagnostic hint covers the operator-facing surface; full pipeline integration (so bug-fix loop dispatches see the stderr tail) is Patch E's territory.

## Validation Criteria

- [ ] Patch A — `dev-server.test.ts` simulates a frontend spawn that exits with code 1 + writes `'next' is not recognized` to stderr; `waitForDevServer` throws within 2s with stderr-tail-rich error.
- [ ] Patch B — unit test: `probeOnce("http://localhost:9999/")` rejects with non-empty `.message` containing `ECONNREFUSED`.
- [ ] Patch C — integration test: `bootDevServer` against project with missing `apps/web/node_modules/` throws with operator hint mentioning `pnpm install`.
- [ ] Patch D — `build-to-spec-verify.test.ts` simulates a project with missing `node_modules/`; verifier runs pnpm install + emits warning; downstream spawn succeeds.
- [ ] `pnpm --filter orchestrator test -- --run tests/dev-server.test.ts tests/build-to-spec-verify.test.ts` exits 0.
- [ ] `pnpm --filter @repo/orchestrator-contracts test` exits 0.
- [ ] Re-running `pnpm exec tsx scripts/run-verifier.ts "<gotribe-tribe-directory>"` after these patches: Patch D installs node_modules first; dev-server boots cleanly; Tiers 3+4+5 fire instead of cascade-skipping.

## Attempt Log

(empty — to be populated by executing agent)
