#!/usr/bin/env node
// scripts/run-synthesized-flows.mjs — feat-025 Phase 2.
//
// Executes the Playwright `*.spec.ts` files emitted by
// `scripts/synthesize-flow-e2e.mjs` against a freshly-spawned dev server
// for the project. Closes the v1 EXECUTION gap left by feat-022 (which
// only SYNTHESIZED specs).
//
// Usage:
//   node scripts/run-synthesized-flows.mjs <projectDir> [--browser=chromium]
//
// Algorithm:
//   1. Pre-flight: confirm <projectDir>/apps/web/package.json has
//      @playwright/test AND playwright.config.ts exists. If missing,
//      return { ok: false, reason: "playwright-not-installed", remediation }.
//   2. Confirm at least one spec file under apps/web/e2e/synthesized/.
//      If none, return { ok: true, flows: { passed:[], failed:[], skipped:[] }, warnings:["no-specs"] }.
//   3. Spawn `pnpm -C apps/web dev` from the project. Wait for HTTP 200
//      on the baseURL (default http://localhost:3000) with 60s timeout.
//      Reuses the cross-platform spawn pattern from visual-review-preflight.mjs.
//   4. Run `pnpm -C apps/web exec playwright test e2e/synthesized/ --reporter=json`.
//      Capture stdout (the JSON reporter writes the entire run to stdout).
//   5. Parse the JSON reporter output: per-suite (= flow file) → pass/fail,
//      failed step name + error + screenshot path + html dump path.
//   6. Tear down the dev server (cross-platform process-tree kill: taskkill
//      /T on Windows; process.kill(-pid) on POSIX).
//   7. Return { ok, browser, flows: {...}, devServerStartedMs, totalRunMs, warnings }.
//
// Output JSON shape (BuildToSpecVerifyOutput.flows-compatible):
//   {
//     ok: true,
//     browser: "chromium",
//     flows: {
//       passed: ["flow-1", "flow-2"],
//       failed: [{ flowId, flowName, step, fromScreenId, expectedScreenId,
//                  actualScreenId, selector, screenshotPath, htmlDumpPath, message }],
//       skipped: ["flow-3"]
//     },
//     devServerStartedMs: 12345,
//     totalRunMs: 45678,
//     warnings: []
//   }
//
// Exit code 0 always (failures surface via JSON).

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import {
  buildScreensCatalog,
  classifySelector,
} from "./build-screens-catalog.mjs";

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const flags = Object.fromEntries(
  args
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v = "true"] = a.replace(/^--/, "").split("=");
      return [k, v];
    }),
);

const DEFAULT_BROWSER = "chromium";
const DEV_SERVER_TIMEOUT_MS = 60_000;
const DEV_SERVER_POLL_INTERVAL_MS = 500;

/**
 * Test seam — exposes the runner as an importable function so unit tests
 * can stub spawn + http-poll + reporter parsing without booting a real
 * dev server. CLI mode (below) calls this with default helpers.
 */
export async function runSynthesizedFlows({
  projectDir,
  browser = DEFAULT_BROWSER,
  // Test seams — defaults shell out to real subprocesses.
  spawnFn = spawn,
  spawnSyncFn = spawnSync,
  httpGet = defaultHttpGet,
  fsApi = fs,
  now = Date.now,
  // Optional override for the dev-server URL (the script otherwise reads
  // playwright.config.ts heuristically; tests pin this explicitly).
  baseUrlOverride,
  // Test seams for the dev-server-wait loop — defaults are
  // DEV_SERVER_POLL_INTERVAL_MS / DEV_SERVER_TIMEOUT_MS. Tests can shrink
  // these to keep the polling loop cheap.
  pollIntervalMs = DEV_SERVER_POLL_INTERVAL_MS,
  devServerTimeoutMs = DEV_SERVER_TIMEOUT_MS,
} = {}) {
  const startedAt = now();
  const warnings = [];

  // ── Step 1: pre-flight ────────────────────────────────────────────────────
  const pkgPath = path.join(projectDir, "apps/web/package.json");
  const cfgPath = path.join(projectDir, "apps/web/playwright.config.ts");
  if (!fsApi.existsSync(pkgPath)) {
    return preflightFail(
      "playwright-not-installed",
      `apps/web/package.json not found at ${pkgPath}`,
    );
  }

  let pkg;
  try {
    pkg = JSON.parse(fsApi.readFileSync(pkgPath, "utf8"));
  } catch (err) {
    return preflightFail(
      "playwright-not-installed",
      `apps/web/package.json could not be parsed: ${err.message}`,
    );
  }

  const hasDep = Boolean(
    (pkg.devDependencies && pkg.devDependencies["@playwright/test"]) ||
    (pkg.dependencies && pkg.dependencies["@playwright/test"]),
  );
  if (!hasDep) {
    return preflightFail(
      "playwright-not-installed",
      "Run: pnpm -C apps/web add -D @playwright/test && pnpm -C apps/web exec playwright install chromium",
    );
  }
  if (!fsApi.existsSync(cfgPath)) {
    return preflightFail(
      "playwright-not-installed",
      "apps/web/playwright.config.ts missing — author per .claude/skills/agents/front-end/{stack}/SKILL.md §3a",
    );
  }

  // ── Step 2: confirm at least one synthesized spec exists ──────────────────
  const synthDir = path.join(projectDir, "apps/web/e2e/synthesized");
  let specFiles = [];
  if (fsApi.existsSync(synthDir)) {
    specFiles = fsApi
      .readdirSync(synthDir)
      .filter((f) => f.endsWith(".spec.ts"));
  }
  if (specFiles.length === 0) {
    return {
      ok: true,
      browser,
      flows: { passed: [], failed: [], skipped: [] },
      devServerStartedMs: 0,
      totalRunMs: now() - startedAt,
      warnings: [
        "no synthesized specs found under apps/web/e2e/synthesized/ — run scripts/synthesize-flow-e2e.mjs first",
      ],
    };
  }

  // ── Step 3: spawn dev server + wait for ready ─────────────────────────────
  const baseUrl = baseUrlOverride ?? readBaseUrlFromConfig(cfgPath, fsApi);
  const devServerStart = now();
  const devProc = spawnDevServer(spawnFn, projectDir);
  let devServerStartedMs = 0;

  try {
    await waitForDevServer(
      baseUrl,
      devServerTimeoutMs,
      httpGet,
      now,
      pollIntervalMs,
    );
    devServerStartedMs = now() - devServerStart;
  } catch (err) {
    teardownDevServer(devProc, spawnSyncFn);
    return {
      ok: false,
      reason: "dev-server-not-ready",
      remediation: `dev server at ${baseUrl} did not respond within ${devServerTimeoutMs}ms: ${err.message}`,
      browser,
      flows: { passed: [], failed: [], skipped: [] },
      devServerStartedMs: now() - devServerStart,
      totalRunMs: now() - startedAt,
      warnings,
    };
  }

  // ── Step 4: run playwright + capture JSON reporter ────────────────────────
  let reporterStdout = "";
  let reporterStderr = "";
  let reporterExit = 0;
  try {
    const result = await runPlaywright(spawnFn, projectDir, browser, specFiles);
    reporterStdout = result.stdout;
    reporterStderr = result.stderr;
    reporterExit = result.exitCode;
  } catch (err) {
    warnings.push(`playwright runner threw: ${err.message}`);
  } finally {
    // Step 6: tear down ALWAYS, even if runner crashed.
    teardownDevServer(devProc, spawnSyncFn);
  }

  // ── feat-049 Phase C: build screens catalog for failure classification ────
  // Catalog discriminates `build-gap` (selector matches a design element) from
  // `manifest-author` (selector targets an element no mockup contains). Built
  // ONCE here; passed into parseReporterJson for per-failure classifySelector.
  // If docs/screens/ is absent or fails to parse, catalog will be empty +
  // classifier falls back to legacy `step-transition` behavior — graceful.
  let screensCatalog = null;
  try {
    const catalogResult = buildScreensCatalog(projectDir);
    screensCatalog = catalogResult.catalog;
    for (const w of catalogResult.warnings ?? []) {
      warnings.push(`screens-catalog: ${w}`);
    }
  } catch (err) {
    warnings.push(
      `screens-catalog build threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ── Step 5: parse reporter JSON ───────────────────────────────────────────
  const flows = parseReporterJson(
    reporterStdout,
    warnings,
    reporterStderr,
    screensCatalog,
  );

  // playwright exit code 1 = test failures; we don't treat that as runner-fail.
  // Exit code > 1 typically means runner crashed (no JSON to parse).
  if (reporterExit > 1 && flows.passed.length + flows.failed.length === 0) {
    warnings.push(
      `playwright runner exited ${reporterExit}; stderr=${reporterStderr.slice(0, 300)}`,
    );
  }

  return {
    ok: flows.failed.length === 0,
    browser,
    flows,
    devServerStartedMs,
    totalRunMs: now() - startedAt,
    warnings,
  };
}

function preflightFail(reason, remediation) {
  return {
    ok: false,
    reason,
    remediation,
    browser: DEFAULT_BROWSER,
    flows: { passed: [], failed: [], skipped: [] },
    devServerStartedMs: 0,
    totalRunMs: 0,
    warnings: [],
  };
}

/**
 * Best-effort baseURL extraction from playwright.config.ts. Falls back to
 * http://localhost:3000 (Next.js default). Format:
 *   use: { baseURL: "http://localhost:5173", ... }
 */
function readBaseUrlFromConfig(cfgPath, fsApi) {
  try {
    const src = fsApi.readFileSync(cfgPath, "utf8");
    const m = src.match(/baseURL\s*:\s*["'`]([^"'`]+)["'`]/);
    if (m) return m[1];
  } catch {
    // fall through
  }
  return "http://localhost:3000";
}

/**
 * Spawn `pnpm -C apps/web dev` from the project root. Cross-platform per
 * the visual-review-preflight pattern: shell:true on Windows for .cmd shim,
 * detached on POSIX so we can kill the process group.
 */
function spawnDevServer(spawnFn, projectDir) {
  const isWin = process.platform === "win32";
  const cmd = isWin ? "pnpm.cmd" : "pnpm";
  const child = spawnFn(cmd, ["-C", "apps/web", "dev"], {
    cwd: projectDir,
    stdio: ["ignore", "pipe", "pipe"],
    detached: !isWin,
    windowsHide: true,
    shell: isWin,
    env: { ...process.env, BROWSER: "none", FORCE_COLOR: "0" },
  });
  // Don't keep parent alive on POSIX
  if (!isWin && typeof child.unref === "function") child.unref();
  // Drain stdout/stderr so the buffer doesn't fill (tests can ignore).
  if (child.stdout) child.stdout.on("data", () => {});
  if (child.stderr) child.stderr.on("data", () => {});
  return child;
}

/**
 * Poll `baseUrl` until any 2xx/3xx/4xx (server is responsive), or timeout.
 */
async function waitForDevServer(
  baseUrl,
  timeoutMs,
  httpGetFn,
  now,
  pollIntervalMs = DEV_SERVER_POLL_INTERVAL_MS,
) {
  const deadline = now() + timeoutMs;
  let lastErr = null;
  while (now() < deadline) {
    try {
      const code = await httpGetFn(baseUrl);
      // Accept anything < 500 — Next.js dev server returns 200 on /; some
      // SPAs return 404 on / before a route is hit; both indicate the server
      // is up.
      if (code !== null && code < 500) return;
    } catch (err) {
      lastErr = err;
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(
    lastErr ? `last error: ${lastErr.message}` : "no server response",
  );
}

function defaultHttpGet(url) {
  return new Promise((resolveP, rejectP) => {
    const req = http.get(url, (res) => {
      // Drain body; we only care about the status code.
      res.resume();
      resolveP(res.statusCode ?? null);
    });
    req.on("error", rejectP);
    req.setTimeout(5000, () => {
      req.destroy(new Error("http get timeout"));
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run `pnpm -C apps/web exec playwright test e2e/synthesized/ --reporter=json
 * --project=<browser>`. Captures the entire stdout (JSON reporter dumps a
 * single object at end). Returns { stdout, stderr, exitCode }.
 */
function runPlaywright(spawnFn, projectDir, browser, specFiles) {
  return new Promise((resolveP) => {
    const isWin = process.platform === "win32";
    const cmd = isWin ? "pnpm.cmd" : "pnpm";
    const child = spawnFn(
      cmd,
      [
        "-C",
        "apps/web",
        "exec",
        "playwright",
        "test",
        "e2e/synthesized/",
        "--reporter=json",
        `--project=${browser}`,
      ],
      {
        cwd: projectDir,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: isWin,
        env: { ...process.env, FORCE_COLOR: "0", CI: "1" },
      },
    );
    let stdout = "";
    let stderr = "";
    if (child.stdout) child.stdout.on("data", (d) => (stdout += d.toString()));
    if (child.stderr) child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) =>
      resolveP({ stdout, stderr, exitCode: code ?? 0 }),
    );
    child.on("error", (err) =>
      resolveP({ stdout, stderr: stderr + String(err), exitCode: 2 }),
    );
  });
}

/**
 * Cross-platform process-tree kill. On Windows, spawn-with-shell:true
 * returns the PID of cmd.exe; we taskkill /T to kill the tree. On POSIX,
 * we spawned detached, so process.kill(-pid) targets the process group.
 */
function teardownDevServer(devProc, spawnSyncFn) {
  if (!devProc || !devProc.pid) return;
  try {
    if (process.platform === "win32") {
      spawnSyncFn("taskkill", ["/PID", String(devProc.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      try {
        process.kill(-devProc.pid, "SIGTERM");
      } catch {
        // group may already be gone
      }
      try {
        process.kill(devProc.pid, "SIGTERM");
      } catch {
        // process may already be gone
      }
    }
  } catch {
    // best-effort; never throw out of teardown
  }
}

/**
 * Parse Playwright's --reporter=json output into our flow-shaped result.
 *
 * The JSON reporter emits a single top-level object:
 *   { suites: [{ file, suites: [{ specs: [{ title, ok, tests: [{ results: [{ status, error, attachments }] }] }] }] }], ... }
 *
 * We treat each spec FILE as one flow (flow-N → flow-N.spec.ts). For
 * failed flows we capture the first failed test's error message + the
 * first PNG attachment as screenshot + the first HTML attachment as
 * htmlDumpPath (the synthesizer writes both alongside the test).
 */
function parseReporterJson(
  stdout,
  warnings,
  stderr = "",
  screensCatalog = null,
) {
  const flows = { passed: [], failed: [], skipped: [] };
  if (!stdout || !stdout.trim()) {
    if (stderr && stderr.trim()) {
      warnings.push(
        `playwright reporter stdout empty; stderr=${stderr.slice(0, 200)}`,
      );
    }
    return flows;
  }

  // Playwright sometimes prefixes stdout with non-JSON noise (warnings,
  // package-manager output). Find the outermost JSON object.
  const jsonStart = stdout.indexOf("{");
  const jsonEnd = stdout.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < jsonStart) {
    warnings.push("playwright reporter stdout had no JSON object");
    return flows;
  }
  let report;
  try {
    report = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1));
  } catch (err) {
    warnings.push(`playwright reporter JSON parse failed: ${err.message}`);
    return flows;
  }

  // Walk every spec — Playwright nests describe blocks arbitrarily deep.
  const allSpecs = [];
  function walk(node) {
    if (!node) return;
    if (Array.isArray(node.specs)) {
      for (const s of node.specs) {
        allSpecs.push({ ...s, file: node.file ?? s.file ?? "(unknown)" });
      }
    }
    if (Array.isArray(node.suites)) {
      for (const child of node.suites) {
        walk({ ...child, file: child.file ?? node.file });
      }
    }
  }
  if (Array.isArray(report.suites)) {
    for (const top of report.suites) walk(top);
  }

  for (const spec of allSpecs) {
    const flowId = flowIdFromFile(spec.file);
    const tests = Array.isArray(spec.tests) ? spec.tests : [];
    const allResults = tests.flatMap((t) =>
      Array.isArray(t.results) ? t.results : [],
    );
    const anyFailed = allResults.some(
      (r) => r.status === "failed" || r.status === "timedOut",
    );
    const anyPassed = allResults.some((r) => r.status === "passed");
    const allSkipped =
      allResults.length > 0 && allResults.every((r) => r.status === "skipped");

    if (anyFailed) {
      const firstFailed = allResults.find(
        (r) => r.status === "failed" || r.status === "timedOut",
      );
      const errorMsg =
        (firstFailed?.error?.message ?? firstFailed?.error?.value ?? "")
          .toString()
          .trim() || "unknown failure";
      const attachments = Array.isArray(firstFailed?.attachments)
        ? firstFailed.attachments
        : [];
      const screenshot =
        attachments.find(
          (a) => a.contentType === "image/png" || /\.png$/i.test(a.path ?? ""),
        )?.path ?? null;
      const htmlDump =
        attachments.find(
          (a) => a.contentType === "text/html" || /\.html$/i.test(a.path ?? ""),
        )?.path ?? null;
      // ── feat-027 Phase B: extract runtime-errors attachment ───────────────
      // The synthesizer's afterEach hook attaches a JSON payload named
      // "runtime-errors" with consoleErrors / pageErrors / networkFailures /
      // devServerOverlay. We surface that into failure.runtimeErrors so the
      // bug-author can render it into a runtime-error bug template.
      const runtimeErrors = extractRuntimeErrors(attachments, warnings);
      // Try to extract step / from / expected from the error message.
      // The synthesizer formats v1.0 (legacy heuristic path) as
      //   `step N: clicked toward "X" but landed on "Y" (selector: ...)`.
      // feat-038 Phase 4 — the v2.0 (interactions[]) path emits
      //   `flow-1 (Name) failed at interaction N: <playwright error>`.
      // parseFailureMessage handles both; v2.0 only populates `step`,
      // since the action vocabulary doesn't carry from/to/selector meta.
      const meta = parseFailureMessage(errorMsg);
      // ── feat-027 Phase B + feat-038 Phase 4: classify primary cause ───────
      // - dev-server-compile: overlay detected → ALWAYS primary (cascades all)
      // - seed-setup: error message comes from seedFixtures/cleanupFixtures
      //   (Strategy C beforeAll/afterAll hooks). Env-issue precedes
      //   runtime-signals because the test never got to interact with the page;
      //   any runtime errors captured are downstream of the seed failure.
      // - runtime-error: any console / page / network errors captured
      // - timeout-no-evidence: timedOut with no runtime signal AND no step meta
      // - step-transition: the synthesizer's own assertion fired (default)
      const isTimedOut = firstFailed?.status === "timedOut";
      const hasRuntimeSignal =
        runtimeErrors !== null &&
        (runtimeErrors.consoleErrors.length > 0 ||
          runtimeErrors.pageErrors.length > 0 ||
          runtimeErrors.networkFailures.length > 0 ||
          runtimeErrors.devServerOverlay !== undefined);
      // feat-038 Phase 4: detect Strategy C seed-helper failures by their
      // canonical thrown-error prefix (see .claude/templates/seed-db.ts.template).
      const isSeedSetupFailure =
        typeof errorMsg === "string" &&
        /^seedFixtures:|^cleanupFixtures:/m.test(errorMsg);
      // feat-049 Phase C: when the failure carries a selector AND we have a
      // screens catalog, classify it. `not-in-design` → manifest-author (flow
      // hallucinated; no builder dispatch); `in-design` → build-gap (design
      // intends X, build missing/diverging — could ALSO be seed-mismatch but
      // that's not separately classified at v1, see schema doc).
      let selectorClass = null;
      if (typeof meta.selector === "string" && screensCatalog) {
        try {
          selectorClass = classifySelector(meta.selector, screensCatalog);
        } catch (err) {
          warnings.push(
            `classifySelector threw on selector "${meta.selector}": ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      let primaryCause;
      if (runtimeErrors?.devServerOverlay) {
        primaryCause = "dev-server-compile";
      } else if (isSeedSetupFailure) {
        primaryCause = "seed-setup";
      } else if (hasRuntimeSignal) {
        primaryCause = "runtime-error";
      } else if (isTimedOut && !meta.step) {
        primaryCause = "timeout-no-evidence";
      } else if (selectorClass === "not-in-design") {
        primaryCause = "manifest-author";
      } else if (selectorClass === "in-design") {
        primaryCause = "build-gap";
      } else {
        primaryCause = "step-transition";
      }
      const failure = {
        flowId,
        flowName: spec.title ?? flowId,
        step: meta.step ?? 0,
        // bug-039 (2026-05-02): emit null (not "") when meta missing.
        // The v2.0 synthesizer emit path doesn't include
        // `from-screen-id:` / `toward-screen-id:` markers in catch
        // messages, so meta.fromScreenId / .expectedScreenId are
        // routinely undefined. The schema is now nullable; sending null
        // is the honest signal vs. empty-string (which used to cause
        // schema validation failure → entire flow-failure array dropped).
        fromScreenId: meta.fromScreenId ?? null,
        expectedScreenId: meta.expectedScreenId ?? null,
        actualScreenId: meta.actualScreenId ?? null,
        selector: meta.selector ?? null,
        screenshotPath: screenshot,
        htmlDumpPath: htmlDump,
        message: errorMsg,
        primaryCause,
      };
      if (runtimeErrors !== null) failure.runtimeErrors = runtimeErrors;
      flows.failed.push(failure);
    } else if (anyPassed) {
      flows.passed.push(flowId);
    } else if (allSkipped) {
      flows.skipped.push(flowId);
    } else {
      // Empty or interrupted — count as skipped for surface visibility.
      flows.skipped.push(flowId);
    }
  }

  // De-dupe (a flow file can have multiple tests; we collapse to one entry).
  flows.passed = [...new Set(flows.passed)];
  flows.skipped = [...new Set(flows.skipped)].filter(
    (id) =>
      !flows.passed.includes(id) && !flows.failed.some((f) => f.flowId === id),
  );

  return flows;
}

function flowIdFromFile(file) {
  if (!file) return "unknown";
  const base = path.basename(String(file), ".spec.ts");
  return base; // e.g., "flow-1"
}

/**
 * feat-027 Phase B — extract the "runtime-errors" attachment if present.
 *
 * The synthesizer's afterEach hook attaches a JSON document with the shape:
 *   {
 *     consoleErrors: string[],
 *     pageErrors: { message, stack? }[],
 *     networkFailures: { method, url, failureText }[],
 *     devServerOverlay: { detected, rawText } | null,
 *   }
 *
 * Playwright's JSON reporter writes attachments to disk by default and
 * exposes `path`. Modern reporters may inline the body via `body` (base64
 * for binary, utf8 for text) — we honor either. Returns null when no
 * runtime-errors attachment exists OR the body fails to parse (best-effort
 * — we surface a warning instead of throwing).
 */
function extractRuntimeErrors(attachments, warnings) {
  const att = attachments.find((a) => a && a.name === "runtime-errors");
  if (!att) return null;
  let raw;
  try {
    if (typeof att.body === "string" && att.body.length > 0) {
      // Inline body — Playwright base64-encodes binary attachments but text
      // contentTypes (application/json) are written as utf8.
      raw = att.body;
    } else if (att.path && fs.existsSync(att.path)) {
      raw = fs.readFileSync(att.path, "utf8");
    } else {
      return null;
    }
  } catch (err) {
    warnings.push(
      `runtime-errors attachment read failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    /** @type {{ consoleErrors: string[], pageErrors: Array<{message: string, stack?: string}>, networkFailures: Array<{method: string, url: string, failureText: string}>, devServerOverlay?: { detected: boolean, rawText: string } }} */
    const out = {
      consoleErrors: Array.isArray(parsed.consoleErrors)
        ? parsed.consoleErrors.filter((s) => typeof s === "string")
        : [],
      pageErrors: Array.isArray(parsed.pageErrors)
        ? parsed.pageErrors
            .filter((e) => e && typeof e.message === "string")
            .map((e) => {
              /** @type {{message: string, stack?: string}} */
              const r = { message: e.message };
              if (typeof e.stack === "string") r.stack = e.stack;
              return r;
            })
        : [],
      networkFailures: Array.isArray(parsed.networkFailures)
        ? parsed.networkFailures
            .filter(
              (n) =>
                n &&
                typeof n.method === "string" &&
                typeof n.url === "string" &&
                typeof n.failureText === "string",
            )
            .map((n) => ({
              method: n.method,
              url: n.url,
              failureText: n.failureText,
            }))
        : [],
    };
    if (
      parsed.devServerOverlay &&
      typeof parsed.devServerOverlay === "object" &&
      typeof parsed.devServerOverlay.rawText === "string"
    ) {
      out.devServerOverlay = {
        detected: parsed.devServerOverlay.detected !== false,
        rawText: parsed.devServerOverlay.rawText,
      };
    }
    return out;
  } catch (err) {
    warnings.push(
      `runtime-errors attachment JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Extract step/from/expected/actual/selector from the synthesizer's
 * canonical error message:
 *   "flow-1 (Sign in) — 1 transition failure(s):
 *      - step 2: clicked toward "card-modal" but landed on "home" (selector: ...)"
 * Returns {} if no match.
 */
function parseFailureMessage(msg) {
  const out = {};
  // v1.0 emit: "step N: clicked toward X but landed on Y (selector: ...)"
  const stepM = msg.match(/step\s+(\d+)\s*:/i);
  if (stepM) out.step = Number.parseInt(stepM[1], 10);
  // feat-038 Phase 4 — v2.0 emit: "flow-1 (Name) failed at interaction N: ..."
  // Only set `step` when it wasn't already populated by v1.0 match (so a
  // future hybrid spec wouldn't double-clobber).
  if (out.step === undefined) {
    const interactionM = msg.match(/failed at interaction\s+(\d+)\s*:/i);
    if (interactionM) out.step = Number.parseInt(interactionM[1], 10);
  }
  const towardM = msg.match(/clicked toward\s+["']([^"']+)["']/i);
  if (towardM) out.expectedScreenId = towardM[1];
  const landedM = msg.match(/landed on\s+["']([^"']+)["']/i);
  if (landedM) out.actualScreenId = landedM[1];
  const fromM = msg.match(/expected on-screen\s+["']([^"']+)["']/i);
  if (fromM) out.fromScreenId = fromM[1];
  const selM = msg.match(/selector:\s*([^)]+)\)/);
  if (selM) out.selector = selM[1].trim();

  // feat-049 Phase C: extract selector from Playwright error messages emitted
  // by the v2.0 synthesizer (which carries a try/catch that re-throws the
  // verbatim Playwright error). Common shapes:
  //   - `locator('SELECTOR')` (single)
  //   - `locator('A').locator('B')` (chained — equivalent to `A >> B`)
  //   - `waiting for locator('SELECTOR')` (timeout case)
  // Without this, v2.0 failures land in parseFailureMessage with no selector
  // → classifier can't run → primaryCause stays `step-transition`.
  if (out.selector === undefined) {
    const locatorChain = [];
    const locatorRe = /locator\(\s*['"]([^'"]+)['"]\s*\)/g;
    let lm;
    while ((lm = locatorRe.exec(msg)) !== null) {
      locatorChain.push(lm[1]);
    }
    if (locatorChain.length > 0) {
      out.selector = locatorChain.join(" >> ");
    } else {
      // getByRole('button', { name: 'X' }) → role=button[name="X"]
      const rolM = msg.match(
        /getByRole\(\s*['"]([^'"]+)['"]\s*,\s*\{\s*name\s*:\s*['"]([^'"]+)['"]/,
      );
      if (rolM) out.selector = `role=${rolM[1]}[name="${rolM[2]}"]`;
    }
  }

  return out;
}

// ─── CLI mode ──────────────────────────────────────────────────────────────
if (
  import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` ||
  import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`
) {
  const projectDir = path.resolve(positional[0] ?? process.cwd());
  if (!fs.existsSync(projectDir)) {
    console.error(`projectDir not found: ${projectDir}`);
    process.exit(2);
  }
  const browser = flags.browser ?? DEFAULT_BROWSER;
  runSynthesizedFlows({ projectDir, browser })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(`runSynthesizedFlows failed: ${err.message}`);
      console.log(
        JSON.stringify(
          {
            ok: false,
            reason: "runner-crashed",
            remediation: err.message,
            browser,
            flows: { passed: [], failed: [], skipped: [] },
            devServerStartedMs: 0,
            totalRunMs: 0,
            warnings: [String(err.stack ?? err.message)],
          },
          null,
          2,
        ),
      );
      process.exit(0);
    });
}
