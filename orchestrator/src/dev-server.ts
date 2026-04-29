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
 * Cross-platform notes:
 *   - Windows: `pnpm.cmd` shim; spawn with `shell: true`; teardown via
 *     `taskkill /PID <pid> /T /F` to kill the cmd.exe + child tree.
 *   - POSIX: native `pnpm`; spawn `detached: true` so we can kill the
 *     process group via `process.kill(-pid, ...)`.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { get as httpGet } from "node:http";
import { join } from "node:path";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_BASE_URL = "http://localhost:3000";

export interface DevServerHandle {
  process: ChildProcess;
  baseUrl: string;
  startedAtMs: number;
}

/**
 * Spawn `pnpm -C apps/web dev` from the project root. Returns immediately;
 * caller must `await waitForDevServer()` before using the URL.
 */
export function spawnDevServer(projectDir: string): ChildProcess {
  const isWin = process.platform === "win32";
  const cmd = isWin ? "pnpm.cmd" : "pnpm";
  const child = spawn(cmd, ["-C", "apps/web", "dev"], {
    cwd: projectDir,
    stdio: ["ignore", "pipe", "pipe"],
    detached: !isWin,
    windowsHide: true,
    shell: isWin,
    env: { ...process.env, BROWSER: "none", FORCE_COLOR: "0" },
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
 * Cross-platform process-tree kill. Best-effort; never throws.
 */
export function teardownDevServer(handle: DevServerHandle | null): void {
  if (!handle || !handle.process || !handle.process.pid) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(handle.process.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      try {
        process.kill(-handle.process.pid, "SIGTERM");
      } catch {
        /* group may already be gone */
      }
      try {
        process.kill(handle.process.pid, "SIGTERM");
      } catch {
        /* process may already be gone */
      }
    }
  } catch {
    /* best-effort; never throw out of teardown */
  }
}

/**
 * Convenience: spawn + wait + return a DevServerHandle. Caller must
 * `teardownDevServer(handle)` when done. On failure, the spawned
 * process is torn down before the error propagates.
 */
export async function bootDevServer(
  projectDir: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<DevServerHandle> {
  const baseUrl = readBaseUrlFromPlaywrightConfig(projectDir);
  const startedAtMs = Date.now();
  const proc = spawnDevServer(projectDir);
  const handle: DevServerHandle = { process: proc, baseUrl, startedAtMs };
  try {
    await waitForDevServer(baseUrl, timeoutMs);
    return handle;
  } catch (err) {
    teardownDevServer(handle);
    throw err;
  }
}
