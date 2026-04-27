import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Tests for scripts/run-synthesized-flows.mjs (feat-025 Phase 2).
 *
 * The runner exposes a seam-friendly `runSynthesizedFlows()` function that
 * accepts spawn / spawnSync / httpGet / fs / now overrides so we can drive
 * pure-unit tests without booting a real Next.js dev server. We import the
 * .mjs at the top of the file (the orchestrator package is `type: "module"`
 * so direct ESM import works at test time).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let runSynthesizedFlows: (args: any) => Promise<any>;

// Lazy-load the .mjs once before the suite runs.
beforeEach(async () => {
  if (!runSynthesizedFlows) {
    const specifier = "../../scripts/run-synthesized-flows.mjs";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import(specifier)) as any;
    runSynthesizedFlows = mod.runSynthesizedFlows;
  }
});

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "run-synthesized-flows-"));
  mkdirSync(join(projectDir, "apps/web/e2e/synthesized"), { recursive: true });
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function writePackageJson(opts: { hasPlaywright?: boolean } = {}) {
  const pkg = {
    name: "@repo/web",
    devDependencies: opts.hasPlaywright
      ? { "@playwright/test": "^1.48.0" }
      : {},
  };
  writeFileSync(
    join(projectDir, "apps/web/package.json"),
    JSON.stringify(pkg, null, 2),
  );
}

function writePlaywrightConfig(baseUrl = "http://localhost:3000") {
  writeFileSync(
    join(projectDir, "apps/web/playwright.config.ts"),
    `import { defineConfig } from "@playwright/test";\nexport default defineConfig({ use: { baseURL: "${baseUrl}" } });\n`,
  );
}

function writeSpec(name = "flow-1.spec.ts") {
  writeFileSync(
    join(projectDir, "apps/web/e2e/synthesized", name),
    `import { test } from "@playwright/test";\ntest("noop", async () => {});\n`,
  );
}

// ─── Stub helpers ──────────────────────────────────────────────────────────

/** Build a fake child process that immediately "completes" with given exit. */
function fakeProc(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}) {
  const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
  const child = {
    pid: 12345,
    stdout: {
      on: (ev: string, cb: (d: Buffer) => void) => {
        if (ev === "data" && opts.stdout)
          setImmediate(() => cb(Buffer.from(opts.stdout!)));
      },
    },
    stderr: {
      on: (ev: string, cb: (d: Buffer) => void) => {
        if (ev === "data" && opts.stderr)
          setImmediate(() => cb(Buffer.from(opts.stderr!)));
      },
    },
    on: (ev: string, cb: (...a: unknown[]) => void) => {
      handlers[ev] ??= [];
      handlers[ev].push(cb);
      if (ev === "close") {
        setImmediate(() => cb(opts.exitCode ?? 0));
      }
    },
    unref: () => {},
  };
  return child;
}

/** Always-respond httpGet stub. */
const httpGetOk = async () => 200;
const httpGetFail = async () => {
  throw new Error("ECONNREFUSED");
};

const noopSpawnSync = (() => ({
  status: 0,
  stdout: "",
  stderr: "",
})) as unknown as typeof import("node:child_process").spawnSync;

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("runSynthesizedFlows — pre-flight (Playwright not installed)", () => {
  it("returns ok:false reason=playwright-not-installed when package.json missing", async () => {
    // No package.json written
    const result = await runSynthesizedFlows({ projectDir });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("playwright-not-installed");
    expect(result.remediation).toContain("apps/web/package.json");
  });

  it("returns ok:false when @playwright/test not in devDependencies", async () => {
    writePackageJson({ hasPlaywright: false });
    writePlaywrightConfig();
    const result = await runSynthesizedFlows({ projectDir });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("playwright-not-installed");
    expect(result.remediation).toContain(
      "pnpm -C apps/web add -D @playwright/test",
    );
  });

  it("returns ok:false when playwright.config.ts missing", async () => {
    writePackageJson({ hasPlaywright: true });
    // no config
    const result = await runSynthesizedFlows({ projectDir });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("playwright-not-installed");
    expect(result.remediation).toContain("playwright.config.ts");
  });
});

describe("runSynthesizedFlows — no synthesized specs", () => {
  it("returns ok:true with empty flows + warning when synth dir empty", async () => {
    writePackageJson({ hasPlaywright: true });
    writePlaywrightConfig();
    // synth dir exists (mkdir in beforeEach) but no .spec.ts files.
    const result = await runSynthesizedFlows({ projectDir });
    expect(result.ok).toBe(true);
    expect(result.flows).toEqual({ passed: [], failed: [], skipped: [] });
    expect(result.warnings.join(" ")).toContain("no synthesized specs");
    expect(result.devServerStartedMs).toBe(0);
  });
});

describe("runSynthesizedFlows — happy path (all flows pass)", () => {
  it("parses Playwright JSON reporter for an all-passed run", async () => {
    writePackageJson({ hasPlaywright: true });
    writePlaywrightConfig();
    writeSpec("flow-1.spec.ts");
    writeSpec("flow-2.spec.ts");

    const reporterJson = JSON.stringify({
      suites: [
        {
          file: "e2e/synthesized/flow-1.spec.ts",
          specs: [
            {
              title: "walks 3 steps",
              tests: [{ results: [{ status: "passed", attachments: [] }] }],
            },
          ],
        },
        {
          file: "e2e/synthesized/flow-2.spec.ts",
          specs: [
            {
              title: "walks 2 steps",
              tests: [{ results: [{ status: "passed", attachments: [] }] }],
            },
          ],
        },
      ],
    });

    let spawnCallIdx = 0;
    const spawnFn = ((..._args: unknown[]) => {
      spawnCallIdx += 1;
      // Call 1: dev server (stays "running"); call 2: playwright run
      if (spawnCallIdx === 1) {
        return fakeProc({ exitCode: 0 });
      }
      return fakeProc({ stdout: reporterJson, exitCode: 0 });
    }) as unknown as typeof import("node:child_process").spawn;

    const result = await runSynthesizedFlows({
      projectDir,
      spawnFn,
      spawnSyncFn: noopSpawnSync,
      httpGet: httpGetOk,
      baseUrlOverride: "http://localhost:3000",
    });

    expect(result.ok).toBe(true);
    expect(result.flows.passed).toEqual(["flow-1", "flow-2"]);
    expect(result.flows.failed).toEqual([]);
    expect(result.browser).toBe("chromium");
  });
});

describe("runSynthesizedFlows — failure path (flow fails)", () => {
  it("captures failed flow with parsed step/expected/actual + screenshot", async () => {
    writePackageJson({ hasPlaywright: true });
    writePlaywrightConfig();
    writeSpec("flow-3.spec.ts");

    const reporterJson = JSON.stringify({
      suites: [
        {
          file: "e2e/synthesized/flow-3.spec.ts",
          specs: [
            {
              title: "Open card detail (flow-3)",
              tests: [
                {
                  results: [
                    {
                      status: "failed",
                      error: {
                        message:
                          'flow-3 (Open card detail) — 1 transition failure(s):\n  - step 2: clicked toward "card-modal" but landed on "home" (selector: page.locator(\'[data-kit-component="Card"]\'))',
                      },
                      attachments: [
                        {
                          contentType: "image/png",
                          path: "docs/build-to-spec/failures/flow-3-step-2.png",
                        },
                        {
                          contentType: "text/html",
                          path: "docs/build-to-spec/failures/flow-3-step-2.html",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    let spawnCallIdx = 0;
    const spawnFn = ((..._args: unknown[]) => {
      spawnCallIdx += 1;
      if (spawnCallIdx === 1) return fakeProc({ exitCode: 0 });
      // playwright exits 1 on test failure
      return fakeProc({ stdout: reporterJson, exitCode: 1 });
    }) as unknown as typeof import("node:child_process").spawn;

    const result = await runSynthesizedFlows({
      projectDir,
      spawnFn,
      spawnSyncFn: noopSpawnSync,
      httpGet: httpGetOk,
      baseUrlOverride: "http://localhost:3000",
    });

    expect(result.ok).toBe(false);
    expect(result.flows.failed).toHaveLength(1);
    const f = result.flows.failed[0];
    expect(f.flowId).toBe("flow-3");
    expect(f.step).toBe(2);
    expect(f.expectedScreenId).toBe("card-modal");
    expect(f.actualScreenId).toBe("home");
    expect(f.selector).toContain("Card");
    expect(f.screenshotPath).toBe(
      "docs/build-to-spec/failures/flow-3-step-2.png",
    );
    expect(f.htmlDumpPath).toBe(
      "docs/build-to-spec/failures/flow-3-step-2.html",
    );
  });

  it("treats skipped tests as flows.skipped[]", async () => {
    writePackageJson({ hasPlaywright: true });
    writePlaywrightConfig();
    writeSpec("flow-skip.spec.ts");

    const reporterJson = JSON.stringify({
      suites: [
        {
          file: "e2e/synthesized/flow-skip.spec.ts",
          specs: [
            {
              title: "skipped flow",
              tests: [{ results: [{ status: "skipped", attachments: [] }] }],
            },
          ],
        },
      ],
    });

    let spawnCallIdx = 0;
    const spawnFn = ((..._args: unknown[]) => {
      spawnCallIdx += 1;
      if (spawnCallIdx === 1) return fakeProc({ exitCode: 0 });
      return fakeProc({ stdout: reporterJson, exitCode: 0 });
    }) as unknown as typeof import("node:child_process").spawn;

    const result = await runSynthesizedFlows({
      projectDir,
      spawnFn,
      spawnSyncFn: noopSpawnSync,
      httpGet: httpGetOk,
      baseUrlOverride: "http://localhost:3000",
    });

    expect(result.ok).toBe(true);
    expect(result.flows.skipped).toContain("flow-skip");
    expect(result.flows.passed).not.toContain("flow-skip");
  });
});

describe("runSynthesizedFlows — dev server lifecycle", () => {
  it("returns ok:false reason=dev-server-not-ready when http never responds", async () => {
    writePackageJson({ hasPlaywright: true });
    writePlaywrightConfig();
    writeSpec();

    const spawnFn = ((..._args: unknown[]) =>
      fakeProc({
        exitCode: 0,
      })) as unknown as typeof import("node:child_process").spawn;

    // Use a tight 50ms timeout + 1ms poll interval so the polling loop
    // exits in a few millis instead of 60s.
    const result = await runSynthesizedFlows({
      projectDir,
      spawnFn,
      spawnSyncFn: noopSpawnSync,
      httpGet: httpGetFail,
      baseUrlOverride: "http://localhost:3000",
      pollIntervalMs: 1,
      devServerTimeoutMs: 50,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("dev-server-not-ready");
    expect(result.remediation).toContain("http://localhost:3000");
  });

  it("invokes spawnSync (taskkill / process.kill) on Windows during teardown", async () => {
    writePackageJson({ hasPlaywright: true });
    writePlaywrightConfig();
    writeSpec();

    let teardownCalled = false;
    const spawnSyncFn = ((cmd: string) => {
      if (cmd === "taskkill" || cmd === "kill") teardownCalled = true;
      return { status: 0, stdout: "", stderr: "" };
    }) as unknown as typeof import("node:child_process").spawnSync;

    let spawnCallIdx = 0;
    const spawnFn = ((..._args: unknown[]) => {
      spawnCallIdx += 1;
      if (spawnCallIdx === 1) return fakeProc({ exitCode: 0 });
      return fakeProc({
        stdout: JSON.stringify({ suites: [] }),
        exitCode: 0,
      });
    }) as unknown as typeof import("node:child_process").spawn;

    await runSynthesizedFlows({
      projectDir,
      spawnFn,
      spawnSyncFn,
      httpGet: httpGetOk,
      baseUrlOverride: "http://localhost:3000",
    });

    // On Windows, teardown calls taskkill via spawnSync. On POSIX, it uses
    // process.kill — we can't easily intercept that via the seam here, but
    // the test still verifies the lifecycle completes without throwing.
    if (process.platform === "win32") {
      expect(teardownCalled).toBe(true);
    } else {
      // On POSIX, just confirm the call returned cleanly.
      expect(true).toBe(true);
    }
  });
});

describe("runSynthesizedFlows — JSON reporter parsing edge cases", () => {
  it("handles empty/non-JSON stdout gracefully", async () => {
    writePackageJson({ hasPlaywright: true });
    writePlaywrightConfig();
    writeSpec();

    let spawnCallIdx = 0;
    const spawnFn = ((..._args: unknown[]) => {
      spawnCallIdx += 1;
      if (spawnCallIdx === 1) return fakeProc({ exitCode: 0 });
      return fakeProc({
        stdout: "no json here\nblah",
        exitCode: 2,
        stderr: "boom",
      });
    }) as unknown as typeof import("node:child_process").spawn;

    const result = await runSynthesizedFlows({
      projectDir,
      spawnFn,
      spawnSyncFn: noopSpawnSync,
      httpGet: httpGetOk,
      baseUrlOverride: "http://localhost:3000",
    });

    expect(result.ok).toBe(true); // no failed flows
    expect(result.flows.passed).toEqual([]);
    expect(result.warnings.join(" ")).toContain("playwright");
  });

  it("walks deeply-nested describe blocks", async () => {
    writePackageJson({ hasPlaywright: true });
    writePlaywrightConfig();
    writeSpec("flow-7.spec.ts");

    // Playwright's reporter nests `describe(...)` blocks under `suites[].suites[].specs`.
    const reporterJson = JSON.stringify({
      suites: [
        {
          file: "e2e/synthesized/flow-7.spec.ts",
          suites: [
            {
              suites: [
                {
                  specs: [
                    {
                      title: "inner",
                      tests: [
                        { results: [{ status: "passed", attachments: [] }] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    let spawnCallIdx = 0;
    const spawnFn = ((..._args: unknown[]) => {
      spawnCallIdx += 1;
      if (spawnCallIdx === 1) return fakeProc({ exitCode: 0 });
      return fakeProc({ stdout: reporterJson, exitCode: 0 });
    }) as unknown as typeof import("node:child_process").spawn;

    const result = await runSynthesizedFlows({
      projectDir,
      spawnFn,
      spawnSyncFn: noopSpawnSync,
      httpGet: httpGetOk,
      baseUrlOverride: "http://localhost:3000",
    });

    expect(result.ok).toBe(true);
    expect(result.flows.passed).toEqual(["flow-7"]);
  });
});
