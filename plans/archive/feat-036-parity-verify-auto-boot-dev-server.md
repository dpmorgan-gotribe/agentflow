---
id: feat-036-parity-verify-auto-boot-dev-server
type: feature
status: archived
author-agent: claude-opus-4-7
created: 2026-04-29
updated: 2026-04-29
completed-at: 2026-04-29
parent-plan: feat-035-visual-parity-v2-built-page-render
supersedes: null
superseded-by: null
branch: feat/parity-verify-auto-boot-dev-server
affected-files:
  - orchestrator/src/dev-server.ts (new)
  - orchestrator/src/parity-verify.ts (modified — autoBootDevServer ctx field + lifecycle wiring)
  - orchestrator/src/build-to-spec-verify.ts (modified — opts parity into auto-boot)
  - orchestrator/scripts/parity-verify.ts (modified — CLI auto-boots when no --dev-server-url)
feature-area: orchestration
priority: P1
attempt-count: 1
max-attempts: 5
---

# feat-036 — Auto-boot dev server for parity-verify (closes feat-035 §Rejected Alternatives gap)

## Problem Statement

feat-035 v2 shipped Phase B parity-verify but **explicitly required operator-managed dev server** per its §Rejected Alternatives:

> "Auto-boot dev server — Rejected. Adding lifecycle management (spawn pnpm dev → wait for ready → kill on exit) introduces flake + cross-platform brittleness. Operator-managed dev server is simpler + matches their existing workflow."

In practice this required operators to:

1. Open a second terminal
2. `cd projects/<name>/`
3. Run `pnpm --filter @repo/web dev`
4. Wait for "Ready"
5. THEN run `parity-verify` with `--dev-server-url http://localhost:<port>`

For the orchestrator-driven `/build-to-spec-verify` path that's not even an option — the orchestrator runs unattended and there's no operator there to boot a server. That's why the run on repo-health-dashboard-01 (commit 8ca9da0 era) emitted `dev-server-not-ready (60s timeout)` on flow-execution + `playwright driver pending v2` on parity — neither stage could connect.

This feature closes the gap: parity-verify auto-boots its own dev server when no URL supplied. Both standalone CLI + the build-to-spec-verify wrapper opt in. Test seams (loadScreenList + compareScreen) implicitly stay in non-boot mode by setting `autoBootDevServer: false` (the default).

## Approach

### `orchestrator/src/dev-server.ts` (new module)

Self-contained TS port of the spawn/wait/teardown helpers from `scripts/run-synthesized-flows.mjs` (intentional duplication for now; future feat could unify by promoting the .mjs to a shared package). Exports:

- `spawnDevServer(projectDir): ChildProcess` — `pnpm -C apps/web dev`, cross-platform (Windows shell:true + .cmd, POSIX detached for process-group teardown)
- `waitForDevServer(baseUrl, timeoutMs, pollIntervalMs): Promise<void>` — polls `<baseUrl>/` until status code < 500
- `teardownDevServer(handle): void` — best-effort process-tree kill (Windows: `taskkill /T /F`, POSIX: `process.kill(-pid)`)
- `bootDevServer(projectDir, timeoutMs): Promise<DevServerHandle>` — convenience wrapper (spawn + wait + return handle, teardown on failure)
- `readBaseUrlFromPlaywrightConfig(projectDir): string` — extracts baseURL from `apps/web/playwright.config.ts`, defaults to `http://localhost:3000`

### `orchestrator/src/parity-verify.ts` (auto-boot wiring)

`ParityVerifyContext` gains:

- `autoBootDevServer?: boolean` — default `false` (preserves test seams). CLI sets to `true` when no `--dev-server-url`. build-to-spec-verify always sets to `true`.
- `devServerBootTimeoutMs?: number` — default 60_000ms (matches run-synthesized-flows.mjs).

`runParityVerify` now:

1. Resolves screens.
2. If `screens.length > 0 && !ctx.devServerUrl && ctx.autoBootDevServer === true`:
   - `bootDevServer(projectDir)`
   - on success: thread the booted URL into `effectiveCtx.devServerUrl`, log "auto-booted at X (took Yms)" warning
   - on failure: warn + early-return with `ok:true, screensChecked:0` (no point comparing against a non-existent server; warning surfaces remediation)
3. Run all screen comparisons (existing flow).
4. `try/finally`: always `teardownDevServer` if we booted.

### `orchestrator/src/build-to-spec-verify.ts` (orchestrator opt-in)

Pass `autoBootDevServer: true` when invoking `runParityVerify`. The orchestrator-driven verify flow now never depends on a manually-booted server.

### `orchestrator/scripts/parity-verify.ts` (CLI opt-in)

Detect explicit `--dev-server-url`: when present, manual-boot mode (operator owns lifecycle); when absent, set `autoBootDevServer: true`. Updated usage line to surface the new behavior.

## Rejected Alternatives

- **Hoist single shared dev-server boot to build-to-spec-verify** (Tier 2 — both flow-execution + parity reuse one boot) — Rejected for v1. Tier 1 (each stage boots its own) is simpler + correct; the 10-15s extra boot per run is acceptable. Revisit when measurement shows it's a meaningful tax.
- **Auto-detect existing server before spawning** — Considered. Pre-flight HTTP probe to skip spawn when something already responds. Rejected: complicates ownership semantics (do we tear down something we didn't spawn?). Operator-managed mode (explicit `--dev-server-url`) is the correct opt-out.
- **Require dev-server URL in screens-manifest.json** — Rejected. Adds yet another schema field for a runtime concern. Heuristic + override is sufficient.

## Expected Outcomes

- [x] `orchestrator/src/dev-server.ts` exists with the 5 exported helpers
- [x] `parity-verify.ts` auto-boots when `autoBootDevServer: true` + no `devServerUrl`
- [x] `parity-verify.ts` tears down on completion (and on inner throw)
- [x] CLI auto-boots by default; explicit `--dev-server-url` switches to manual mode
- [x] build-to-spec-verify opts parity into auto-boot
- [x] 567/567 orchestrator tests pass (test seams default `autoBootDevServer: false`)

## Validation Criteria

1. **Live live test against repo-health-dashboard-01 (no operator-managed server)**:
   - `netstat` confirms ports clear before run
   - `pnpm --filter orchestrator parity-verify -- repo-health-dashboard-01`
   - Output includes "dev-server: auto-booted at <url> (took <ms>ms)"
   - Diff runs + reports divergences
   - `netstat` confirms ports clear AFTER run (teardown worked)
2. **Tests pass** under default behavior (`autoBootDevServer: false`).

Both validated 2026-04-29.

---

# COMPLETION RECORD (appended at archive time)

completed: 2026-04-29
outcome: success
actual-files-changed:

- orchestrator/src/dev-server.ts (created — 5 exported helpers)
- orchestrator/src/parity-verify.ts (modified — autoBootDevServer ctx field + boot/teardown around screen-comparison loop)
- orchestrator/src/build-to-spec-verify.ts (modified — passes autoBootDevServer:true to parity-verify call)
- orchestrator/scripts/parity-verify.ts (modified — CLI defaults to auto-boot when no --dev-server-url)
  attempts: 1
  duration-minutes: 50
  test-results:
  unit: 567/567 passed
  integration: live-validated against repo-health-dashboard-01 — boot 6.1s, teardown clean, 2 P1 divergences caught (post-AppShell retrofit; matches bug-029 known issue)
  lessons:
- "feat-035's §Rejected Alternatives 'auto-boot rejected' was right scope-wise (Tier 1 ships without it) but wrong for the orchestrator-driven path (no operator there to boot manually). feat-036 closes the gap with a default-off opt-in pattern that preserves test seams."
- "Cross-platform process-tree kill works correctly via taskkill /T /F on Windows + process.kill(-pid) on POSIX. Lifted verbatim from run-synthesized-flows.mjs (validated pattern)."
- "Default autoBootDevServer:false — test seams (loadScreenList + compareScreen stubs) implicitly stay in non-boot mode without needing test-specific overrides. Cleaner than NODE_ENV-checking."
- "Pre-existing dev server on the target port causes confusion (waitForDevServer returns immediately on the first probe); operator should ensure ports are clear before testing the boot path. Tier 2 hoist (single shared boot) would help but isn't required."
- "Tier 2 (single shared boot hoisted to build-to-spec-verify, used by both flow-execution + parity) deferred — saves 10-15s per run but adds coordination complexity. Revisit if measurement shows it matters."
  recommendation-implemented-by: feat-036 (this plan)

---
