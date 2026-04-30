/**
 * feat-036 — dev-server lifecycle helpers used by /build-to-spec-verify
 * stages that need a running app (parity-verify Phase B, flow-execution).
 *
 * Mirrors the spawn pattern from `scripts/run-synthesized-flows.mjs` (the
 * .mjs version that pre-dates this TS module). Intentional duplication
 * for now — the .mjs script can't import a TS module without compilation;
 * future refactor (feat-037 candidate) could unify by promoting the
 * .mjs to a shared package or having both call out to a CLI helper.
 *
 * bug-032 Phase C: extended to detect `apps/api/` and co-boot the backend
 * with port coordination. Frontend's NEXT_PUBLIC_API_BASE env is set from
 * the backend's actual bound port, mirroring the per-project
 * `scripts/dev.mjs` orchestrator (so verify auto-boot reaches the same
 * working state operators get from `node scripts/dev.mjs` manually).
 * Empirical fixes baked in from operator smoke-test:
 *   - `uv` (not `uv.exe`) — let cmd.exe's PATHEXT resolve
 *   - spawn cwd at `apps/api/` (uv's `-C` is `--config-setting`, not -d)
 *   - `uvicorn api.main:app --app-dir src` (not `python -m api`) so
 *     src-layout projects work without `pip install -e`
 *
 * Cross-platform notes:
 *   - Windows: `pnpm.cmd` / `uv` (PATHEXT) shim; spawn with `shell: true`;
 *     teardown via `taskkill /PID <pid> /T /F` to kill the cmd.exe + child tree.
 *   - POSIX: native `pnpm` / `uv`; spawn `detached: true` so we can kill
 *     the process group via `process.kill(-pid, ...)`.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { get as httpGet } from "node:http";
import { join } from "node:path";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_BACKEND_PORT = 8000;

export interface DevServerHandle {
  /** Frontend (Next.js / Vite / SvelteKit) child process. */
  process: ChildProcess;
  /** Frontend baseURL (typically http://localhost:3000). */
  baseUrl: string;
  startedAtMs: number;
  /**
   * Backend (FastAPI / etc.) child process when the project has an
   * `apps/api/` tier. Null for single-tier projects.
   *
   * teardownDevServer() kills BOTH processes when present.
   */
  backendProcess?: ChildProcess;
  /**
   * Backend baseURL (typically http://localhost:8000) when present.
   * Mirrors what got passed to the frontend as NEXT_PUBLIC_API_BASE.
   */
  backendUrl?: string;
}

/**
 * Spawn `pnpm -C apps/web dev` from the project root. Returns immediately;
 * caller must `await waitForDevServer()` before using the URL.
 *
 * bug-032 Phase C: when `apiBaseUrl` is provided, set NEXT_PUBLIC_API_BASE
 * in the spawned env so the frontend's API client constructs URLs that
 * hit the real backend (not same-origin :3000 → 404).
 */
export function spawnDevServer(
  projectDir: string,
  apiBaseUrl?: string,
): ChildProcess {
  const isWin = process.platform === "win32";
  const cmd = isWin ? "pnpm.cmd" : "pnpm";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BROWSER: "none",
    FORCE_COLOR: "0",
  };
  if (apiBaseUrl) env.NEXT_PUBLIC_API_BASE = apiBaseUrl;
  const child = spawn(cmd, ["-C", "apps/web", "dev"], {
    cwd: projectDir,
    stdio: ["ignore", "pipe", "pipe"],
    detached: !isWin,
    windowsHide: true,
    shell: isWin,
    env,
  });
  if (!isWin && typeof child.unref === "function") child.unref();
  // Drain stdout/stderr so the buffer doesn't fill — orchestrator doesn't
  // surface dev-server logs by default; operators can spawn manually if
  // they want to inspect.
  if (child.stdout) child.stdout.on("data", () => {});
  if (child.stderr) child.stderr.on("data", () => {});
  return child;
}

/**
 * bug-032 Phase C: spawn the FastAPI backend via `uv run uvicorn ...` from
 * `<projectDir>/apps/api/`. Returns null when the project has no
 * `apps/api/` tier (single-tier project; caller skips backend boot).
 *
 * Empirical fixes from operator smoke-test on 2026-04-30:
 *   - `uv` not `uv.exe` (cmd.exe PATHEXT resolves under `shell: true`)
 *   - spawn cwd at apps/api/ (uv's `-C` is `--config-setting`, not -d)
 *   - `uvicorn api.main:app --app-dir src` (not `python -m api`) — works
 *     with src/ layout projects without requiring `pip install -e`
 */
export function spawnBackendDevServer(
  projectDir: string,
  port: number,
): ChildProcess | null {
  const apiDir = join(projectDir, "apps", "api");
  if (!existsSync(apiDir)) return null;
  const isWin = process.platform === "win32";
  const cmd = "uv";
  const args = [
    "run",
    "uvicorn",
    "api.main:app",
    "--app-dir",
    "src",
    "--host",
    "0.0.0.0",
    "--port",
    String(port),
  ];
  const child = spawn(cmd, args, {
    cwd: apiDir,
    stdio: ["ignore", "pipe", "pipe"],
    detached: !isWin,
    windowsHide: true,
    shell: isWin,
    env: { ...process.env, PORT: String(port) },
  });
  if (!isWin && typeof child.unref === "function") child.unref();
  if (child.stdout) child.stdout.on("data", () => {});
  if (child.stderr) child.stderr.on("data", () => {});
  return child;
}

/**
 * Resolve the backend port for `<projectDir>/apps/api/`. Precedence:
 *   1. `process.env.PORT` (operator override)
 *   2. `apps/api/.env` (PORT=N line)
 *   3. 8000 (FastAPI default per pydantic-settings convention)
 *
 * Returns null when the project has no `apps/api/` tier.
 */
export function resolveBackendPort(projectDir: string): number | null {
  const apiDir = join(projectDir, "apps", "api");
  if (!existsSync(apiDir)) return null;
  if (process.env.PORT) {
    const n = Number(process.env.PORT);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const apiEnvPath = join(apiDir, ".env");
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
  return DEFAULT_BACKEND_PORT;
}

/**
 * Best-effort baseURL extraction from `apps/web/playwright.config.ts`.
 * Falls back to `http://localhost:3000` (Next.js default).
 */
export function readBaseUrlFromPlaywrightConfig(projectDir: string): string {
  const cfgPath = join(projectDir, "apps", "web", "playwright.config.ts");
  if (!existsSync(cfgPath)) return DEFAULT_BASE_URL;
  try {
    const src = readFileSync(cfgPath, "utf8");
    const m = src.match(/baseURL\s*:\s*["'`]([^"'`]+)["'`]/);
    if (m && m[1]) return m[1];
  } catch {
    /* fall through */
  }
  return DEFAULT_BASE_URL;
}

/**
 * Poll `baseUrl` until the server responds with anything < 500 (server is
 * up — Next.js returns 200 on `/`; some SPAs return 404 before a route is
 * hit; both indicate the dev server is responsive). Throws on timeout.
 */
export async function waitForDevServer(
  baseUrl: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: Error | null = null;
  while (Date.now() < deadline) {
    try {
      const code = await probeOnce(baseUrl);
      if (code !== null && code < 500) return;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(
    lastErr ? `last error: ${lastErr.message}` : "no server response",
  );
}

function probeOnce(url: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const req = httpGet(url, (res) => {
      res.resume();
      resolve(res.statusCode ?? null);
    });
    req.on("error", reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error("http get timeout"));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Cross-platform process-tree kill for a single ChildProcess. Best-effort;
 * never throws.
 */
function killChildTree(child: ChildProcess | undefined): void {
  if (!child || !child.pid) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        /* group may already be gone */
      }
      try {
        process.kill(child.pid, "SIGTERM");
      } catch {
        /* process may already be gone */
      }
    }
  } catch {
    /* best-effort; never throw out of teardown */
  }
}

/**
 * Cross-platform process-tree kill. Best-effort; never throws. Tears down
 * BOTH frontend and backend (when present) since bug-032 Phase C.
 */
export function teardownDevServer(handle: DevServerHandle | null): void {
  if (!handle) return;
  killChildTree(handle.process);
  if (handle.backendProcess) killChildTree(handle.backendProcess);
}

/**
 * Convenience: spawn + wait + return a DevServerHandle. Caller must
 * `teardownDevServer(handle)` when done. On failure, the spawned
 * process is torn down before the error propagates.
 *
 * bug-032 Phase C: when `apps/api/` exists at projectDir, the backend is
 * spawned FIRST (with port read from apps/api/.env or default 8000), the
 * health endpoint is awaited, then the frontend is spawned with
 * NEXT_PUBLIC_API_BASE pointing at the backend. Without this coordination,
 * frontend `/api/*` requests hit the Next.js dev server (same-origin) and
 * 404 — silently breaking every flow that exercises the backend.
 */
export async function bootDevServer(
  projectDir: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<DevServerHandle> {
  const baseUrl = readBaseUrlFromPlaywrightConfig(projectDir);
  const startedAtMs = Date.now();

  // ── bug-032 Phase C: backend co-boot when apps/api/ is present ─────────
  const backendPort = resolveBackendPort(projectDir);
  let backendProcess: ChildProcess | undefined;
  let backendUrl: string | undefined;
  if (backendPort !== null) {
    backendUrl = `http://localhost:${backendPort}`;
    const child = spawnBackendDevServer(projectDir, backendPort);
    if (child) {
      backendProcess = child;
      try {
        // Backend is considered ready when /health responds with anything
        // < 500. FastAPI conventionally exposes GET /health; if the route
        // doesn't exist a 404 also indicates the server is listening.
        await waitForDevServer(`${backendUrl}/health`, timeoutMs);
      } catch (err) {
        killChildTree(backendProcess);
        throw new Error(
          `backend (apps/api/) did not respond on ${backendUrl}/health within ` +
            `${timeoutMs}ms — verify uv is on PATH and the project's pyproject.toml is valid. ` +
            `Underlying: ${(err as Error).message}`,
        );
      }
    }
  }

  // ── frontend boot — pass NEXT_PUBLIC_API_BASE when backend is co-booted ─
  const proc = spawnDevServer(projectDir, backendUrl);
  const handle: DevServerHandle = {
    process: proc,
    baseUrl,
    startedAtMs,
    ...(backendProcess ? { backendProcess } : {}),
    ...(backendUrl ? { backendUrl } : {}),
  };
  try {
    await waitForDevServer(baseUrl, timeoutMs);
    return handle;
  } catch (err) {
    teardownDevServer(handle);
    throw err;
  }
}
