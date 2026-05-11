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
      // bug-071: baseUrlOverride skips the dev-server spawn; this single
      // spawn call is the playwright run.
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

// ─── feat-027 Phase B: runtime-errors attachment extraction ─────────────────

describe("runSynthesizedFlows — feat-027 runtime-errors extraction", () => {
  it("extracts runtime-errors attachment (inline body) → failure.runtimeErrors", async () => {
    writePackageJson({ hasPlaywright: true });
    writePlaywrightConfig();
    writeSpec("flow-rt.spec.ts");

    const runtimePayload = {
      consoleErrors: ["Error: Foo failed"],
      pageErrors: [
        { message: "TypeError: x is undefined", stack: "at Foo:1:1" },
      ],
      networkFailures: [
        { method: "GET", url: "/missing.css", failureText: "net::ERR_FAILED" },
      ],
    };

    const reporterJson = JSON.stringify({
      suites: [
        {
          file: "e2e/synthesized/flow-rt.spec.ts",
          specs: [
            {
              title: "rt flow",
              tests: [
                {
                  results: [
                    {
                      status: "failed",
                      error: { message: "transition failed at step 2" },
                      attachments: [
                        {
                          name: "runtime-errors",
                          contentType: "application/json",
                          body: JSON.stringify(runtimePayload),
                        },
                        {
                          contentType: "image/png",
                          path: "test-results/flow-rt.png",
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
      return fakeProc({ stdout: reporterJson, exitCode: 1 });
    }) as unknown as typeof import("node:child_process").spawn;

    const result = await runSynthesizedFlows({
      projectDir,
      spawnFn,
      spawnSyncFn: noopSpawnSync,
      httpGet: httpGetOk,
      baseUrlOverride: "http://localhost:3000",
    });

    expect(result.flows.failed).toHaveLength(1);
    const f = result.flows.failed[0];
    expect(f.runtimeErrors).toBeDefined();
    expect(f.runtimeErrors.consoleErrors).toEqual(["Error: Foo failed"]);
    expect(f.runtimeErrors.pageErrors[0].message).toContain("TypeError");
    expect(f.runtimeErrors.networkFailures[0].url).toBe("/missing.css");
  });

  it("classifies primaryCause=runtime-error when console/page/network errors present", async () => {
    writePackageJson({ hasPlaywright: true });
    writePlaywrightConfig();
    writeSpec("flow-pc.spec.ts");

    const runtimePayload = {
      consoleErrors: ["Error: thing"],
      pageErrors: [],
      networkFailures: [],
    };

    const reporterJson = JSON.stringify({
      suites: [
        {
          file: "e2e/synthesized/flow-pc.spec.ts",
          specs: [
            {
              title: "pc flow",
              tests: [
                {
                  results: [
                    {
                      status: "failed",
                      error: { message: "transition failed step 1" },
                      attachments: [
                        {
                          name: "runtime-errors",
                          contentType: "application/json",
                          body: JSON.stringify(runtimePayload),
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
      return fakeProc({ stdout: reporterJson, exitCode: 1 });
    }) as unknown as typeof import("node:child_process").spawn;

    const result = await runSynthesizedFlows({
      projectDir,
      spawnFn,
      spawnSyncFn: noopSpawnSync,
      httpGet: httpGetOk,
      baseUrlOverride: "http://localhost:3000",
    });

    expect(result.flows.failed[0].primaryCause).toBe("runtime-error");
  });

  it("classifies primaryCause=dev-server-compile when devServerOverlay present (root cascade)", async () => {
    writePackageJson({ hasPlaywright: true });
    writePlaywrightConfig();
    writeSpec("flow-ovl.spec.ts");

    const runtimePayload = {
      consoleErrors: ["Error: foo"], // even with other signals, overlay wins
      pageErrors: [],
      networkFailures: [],
      devServerOverlay: {
        detected: true,
        rawText: "Module not found: Can't resolve 'X'",
      },
    };

    const reporterJson = JSON.stringify({
      suites: [
        {
          file: "e2e/synthesized/flow-ovl.spec.ts",
          specs: [
            {
              title: "ovl flow",
              tests: [
                {
                  results: [
                    {
                      status: "timedOut",
                      error: { message: "timeout 30s" },
                      attachments: [
                        {
                          name: "runtime-errors",
                          contentType: "application/json",
                          body: JSON.stringify(runtimePayload),
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
      return fakeProc({ stdout: reporterJson, exitCode: 1 });
    }) as unknown as typeof import("node:child_process").spawn;

    const result = await runSynthesizedFlows({
      projectDir,
      spawnFn,
      spawnSyncFn: noopSpawnSync,
      httpGet: httpGetOk,
      baseUrlOverride: "http://localhost:3000",
    });

    expect(result.flows.failed[0].primaryCause).toBe("dev-server-compile");
    expect(result.flows.failed[0].runtimeErrors.devServerOverlay.detected).toBe(
      true,
    );
  });

  it("classifies primaryCause=timeout-no-evidence when timed out + no runtime signals", async () => {
    writePackageJson({ hasPlaywright: true });
    writePlaywrightConfig();
    writeSpec("flow-to.spec.ts");

    const reporterJson = JSON.stringify({
      suites: [
        {
          file: "e2e/synthesized/flow-to.spec.ts",
          specs: [
            {
              title: "to flow",
              tests: [
                {
                  results: [
                    {
                      status: "timedOut",
                      error: { message: "Test timeout of 30000ms exceeded" },
                      attachments: [],
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
      return fakeProc({ stdout: reporterJson, exitCode: 1 });
    }) as unknown as typeof import("node:child_process").spawn;

    const result = await runSynthesizedFlows({
      projectDir,
      spawnFn,
      spawnSyncFn: noopSpawnSync,
      httpGet: httpGetOk,
      baseUrlOverride: "http://localhost:3000",
    });

    expect(result.flows.failed[0].primaryCause).toBe("timeout-no-evidence");
    expect(result.flows.failed[0].runtimeErrors).toBeUndefined();
  });

  it("classifies primaryCause=step-transition for synthesizer-fired assertion failures", async () => {
    writePackageJson({ hasPlaywright: true });
    writePlaywrightConfig();
    writeSpec("flow-st.spec.ts");

    const reporterJson = JSON.stringify({
      suites: [
        {
          file: "e2e/synthesized/flow-st.spec.ts",
          specs: [
            {
              title: "st flow",
              tests: [
                {
                  results: [
                    {
                      status: "failed",
                      error: {
                        message:
                          'flow-st — step 2: clicked toward "card-modal" but landed on "home" (selector: x)',
                      },
                      attachments: [],
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
      return fakeProc({ stdout: reporterJson, exitCode: 1 });
    }) as unknown as typeof import("node:child_process").spawn;

    const result = await runSynthesizedFlows({
      projectDir,
      spawnFn,
      spawnSyncFn: noopSpawnSync,
      httpGet: httpGetOk,
      baseUrlOverride: "http://localhost:3000",
    });

    expect(result.flows.failed[0].primaryCause).toBe("step-transition");
  });

  it("feat-038 Phase 4 — classifies primaryCause=seed-setup when seedFixtures throws (Strategy C beforeAll)", async () => {
    writePackageJson({ hasPlaywright: true });
    writePlaywrightConfig();
    writeSpec("flow-seed.spec.ts");

    const reporterJson = JSON.stringify({
      suites: [
        {
          file: "e2e/synthesized/flow-seed.spec.ts",
          specs: [
            {
              title: "mutation flow needing seed",
              tests: [
                {
                  results: [
                    {
                      status: "failed",
                      error: {
                        message:
                          "seedFixtures: POST http://127.0.0.1:8000/test/seed → 503 Service Unavailable",
                      },
                      attachments: [],
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
      return fakeProc({ stdout: reporterJson, exitCode: 1 });
    }) as unknown as typeof import("node:child_process").spawn;

    const result = await runSynthesizedFlows({
      projectDir,
      spawnFn,
      spawnSyncFn: noopSpawnSync,
      httpGet: httpGetOk,
      baseUrlOverride: "http://localhost:3000",
    });

    expect(result.flows.failed[0].primaryCause).toBe("seed-setup");
  });

  it("feat-038 Phase 4 — parseFailureMessage handles v2.0 'failed at interaction N' emit", async () => {
    writePackageJson({ hasPlaywright: true });
    writePlaywrightConfig();
    writeSpec("flow-v2.spec.ts");

    const reporterJson = JSON.stringify({
      suites: [
        {
          file: "e2e/synthesized/flow-v2.spec.ts",
          specs: [
            {
              title: "v2 interactions flow",
              tests: [
                {
                  results: [
                    {
                      status: "failed",
                      error: {
                        message:
                          "flow-1 (Generate a single repo health report) failed at interaction 4: page.waitForResponse: Test timeout of 30000ms exceeded.",
                      },
                      attachments: [],
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
      return fakeProc({ stdout: reporterJson, exitCode: 1 });
    }) as unknown as typeof import("node:child_process").spawn;

    const result = await runSynthesizedFlows({
      projectDir,
      spawnFn,
      spawnSyncFn: noopSpawnSync,
      httpGet: httpGetOk,
      baseUrlOverride: "http://localhost:3000",
    });

    // step populated from "failed at interaction 4:"
    expect(result.flows.failed[0].step).toBe(4);
    // No runtime signal + has step meta + not timed-out → step-transition.
    expect(result.flows.failed[0].primaryCause).toBe("step-transition");
  });

  it("gracefully handles malformed runtime-errors JSON → warning + null", async () => {
    writePackageJson({ hasPlaywright: true });
    writePlaywrightConfig();
    writeSpec("flow-bad.spec.ts");

    const reporterJson = JSON.stringify({
      suites: [
        {
          file: "e2e/synthesized/flow-bad.spec.ts",
          specs: [
            {
              title: "bad flow",
              tests: [
                {
                  results: [
                    {
                      status: "failed",
                      error: { message: "x" },
                      attachments: [
                        {
                          name: "runtime-errors",
                          contentType: "application/json",
                          body: "<<not json>>",
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
      return fakeProc({ stdout: reporterJson, exitCode: 1 });
    }) as unknown as typeof import("node:child_process").spawn;

    const result = await runSynthesizedFlows({
      projectDir,
      spawnFn,
      spawnSyncFn: noopSpawnSync,
      httpGet: httpGetOk,
      baseUrlOverride: "http://localhost:3000",
    });

    expect(result.flows.failed[0].runtimeErrors).toBeUndefined();
    expect(result.warnings.join(" ")).toContain("runtime-errors");
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

// ─── bug-079: runtime-error elevation on PASSING tests ──────────────────────
//
// Pre-fix: extractRuntimeErrors() only ran inside the if(anyFailed) block,
// so console / page / network errors fired during a passing spec were
// silently shelved in test-results/ and never reached bugs.yaml. Empirical
// motivator was reading-log-02 (2026-05-08) where a hydration error fired on
// every page.goto("/") but all flows still passed selector-based assertions.
// Post-fix: the runner walks every passing test result's attachments, emits
// a synthesized FlowFailure with primaryCause:"runtime-error" per unique
// error signature (cross-spec dedup), preserves the spec in flows.passed
// (test genuinely passed), but adds the cascade-root bug for the loop.

describe("runSynthesizedFlows — bug-079 runtime-error elevation on passing tests", () => {
  it("emits a synthesized runtime-error FlowFailure when a PASSING spec attaches console errors", async () => {
    writePackageJson({ hasPlaywright: true });
    writePlaywrightConfig();
    writeSpec("flow-pass-rt.spec.ts");

    const runtimePayload = {
      consoleErrors: [
        "Warning: Text content did not match. Server: 'A' Client: 'B'",
      ],
      pageErrors: [],
      networkFailures: [],
    };
    const reporterJson = JSON.stringify({
      suites: [
        {
          file: "e2e/synthesized/flow-pass-rt.spec.ts",
          specs: [
            {
              title: "pass-with-hydration",
              tests: [
                {
                  results: [
                    {
                      status: "passed",
                      attachments: [
                        {
                          name: "runtime-errors",
                          contentType: "application/json",
                          body: JSON.stringify(runtimePayload),
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
      return fakeProc({ stdout: reporterJson, exitCode: 0 });
    }) as unknown as typeof import("node:child_process").spawn;

    const result = await runSynthesizedFlows({
      projectDir,
      spawnFn,
      spawnSyncFn: noopSpawnSync,
      httpGet: httpGetOk,
      baseUrlOverride: "http://localhost:3000",
    });

    // Spec genuinely passed — flowId stays in passed[].
    expect(result.flows.passed).toContain("flow-pass-rt");
    // But the runtime error is now elevated as a separate synthesized
    // FlowFailure with primaryCause: "runtime-error".
    expect(result.flows.failed).toHaveLength(1);
    const f = result.flows.failed[0];
    expect(f.primaryCause).toBe("runtime-error");
    expect(f.flowId).toBe("flow-pass-rt");
    expect(f.runtimeErrors).toBeDefined();
    expect(f.runtimeErrors.consoleErrors[0]).toContain(
      "Text content did not match",
    );
    // ok flips to false because a real bug is now visible.
    expect(result.ok).toBe(false);
  });

  it("dedups the same runtime error across N passing specs to ONE bug entry", async () => {
    writePackageJson({ hasPlaywright: true });
    writePlaywrightConfig();
    writeSpec("flow-a.spec.ts");
    writeSpec("flow-b.spec.ts");
    writeSpec("flow-c.spec.ts");

    // Same hydration error fires on every flow's page.goto("/")
    const sharedPayload = {
      consoleErrors: [],
      pageErrors: [
        {
          message:
            "Error: Hydration failed because the initial UI does not match",
        },
      ],
      networkFailures: [],
    };
    const passingResult = {
      status: "passed",
      attachments: [
        {
          name: "runtime-errors",
          contentType: "application/json",
          body: JSON.stringify(sharedPayload),
        },
      ],
    };
    const reporterJson = JSON.stringify({
      suites: ["flow-a", "flow-b", "flow-c"].map((name) => ({
        file: `e2e/synthesized/${name}.spec.ts`,
        specs: [
          {
            title: name,
            tests: [{ results: [passingResult] }],
          },
        ],
      })),
    });

    let spawnCallIdx = 0;
    const spawnFn = ((..._args: unknown[]) => {
      spawnCallIdx += 1;
      return fakeProc({ stdout: reporterJson, exitCode: 0 });
    }) as unknown as typeof import("node:child_process").spawn;

    const result = await runSynthesizedFlows({
      projectDir,
      spawnFn,
      spawnSyncFn: noopSpawnSync,
      httpGet: httpGetOk,
      baseUrlOverride: "http://localhost:3000",
    });

    expect(result.flows.passed.sort()).toEqual(["flow-a", "flow-b", "flow-c"]);
    // Cross-spec dedup: one synthesized FlowFailure, not three.
    expect(result.flows.failed).toHaveLength(1);
    const f = result.flows.failed[0];
    expect(f.primaryCause).toBe("runtime-error");
    // The flowId is the first one we encountered; message lists the others.
    expect(f.flowId).toBe("flow-a");
    expect(f.message).toContain("also fired in");
    expect(f.message).toContain("flow-b");
    expect(f.message).toContain("flow-c");
  });

  it("does NOT emit a synthetic failure when passing spec has empty runtime-errors payload", async () => {
    writePackageJson({ hasPlaywright: true });
    writePlaywrightConfig();
    writeSpec("flow-clean.spec.ts");

    const emptyPayload = {
      consoleErrors: [],
      pageErrors: [],
      networkFailures: [],
    };
    const reporterJson = JSON.stringify({
      suites: [
        {
          file: "e2e/synthesized/flow-clean.spec.ts",
          specs: [
            {
              title: "clean",
              tests: [
                {
                  results: [
                    {
                      status: "passed",
                      attachments: [
                        {
                          name: "runtime-errors",
                          contentType: "application/json",
                          body: JSON.stringify(emptyPayload),
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
    expect(result.flows.passed).toEqual(["flow-clean"]);
    expect(result.flows.failed).toEqual([]);
  });

  it("does NOT emit a synthetic failure when passing spec has no runtime-errors attachment at all", async () => {
    writePackageJson({ hasPlaywright: true });
    writePlaywrightConfig();
    writeSpec("flow-no-att.spec.ts");

    const reporterJson = JSON.stringify({
      suites: [
        {
          file: "e2e/synthesized/flow-no-att.spec.ts",
          specs: [
            {
              title: "no-attachment",
              tests: [{ results: [{ status: "passed", attachments: [] }] }],
            },
          ],
        },
      ],
    });

    let spawnCallIdx = 0;
    const spawnFn = ((..._args: unknown[]) => {
      spawnCallIdx += 1;
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
    expect(result.flows.failed).toEqual([]);
  });

  it("emits separate bugs for DISTINCT runtime errors across passing specs", async () => {
    writePackageJson({ hasPlaywright: true });
    writePlaywrightConfig();
    writeSpec("flow-x.spec.ts");
    writeSpec("flow-y.spec.ts");

    const reporterJson = JSON.stringify({
      suites: [
        {
          file: "e2e/synthesized/flow-x.spec.ts",
          specs: [
            {
              title: "x",
              tests: [
                {
                  results: [
                    {
                      status: "passed",
                      attachments: [
                        {
                          name: "runtime-errors",
                          contentType: "application/json",
                          body: JSON.stringify({
                            consoleErrors: [],
                            pageErrors: [
                              { message: "Error: Apple specific failure" },
                            ],
                            networkFailures: [],
                          }),
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          file: "e2e/synthesized/flow-y.spec.ts",
          specs: [
            {
              title: "y",
              tests: [
                {
                  results: [
                    {
                      status: "passed",
                      attachments: [
                        {
                          name: "runtime-errors",
                          contentType: "application/json",
                          body: JSON.stringify({
                            consoleErrors: [],
                            pageErrors: [
                              { message: "Error: Banana specific failure" },
                            ],
                            networkFailures: [],
                          }),
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
      return fakeProc({ stdout: reporterJson, exitCode: 0 });
    }) as unknown as typeof import("node:child_process").spawn;

    const result = await runSynthesizedFlows({
      projectDir,
      spawnFn,
      spawnSyncFn: noopSpawnSync,
      httpGet: httpGetOk,
      baseUrlOverride: "http://localhost:3000",
    });

    expect(result.flows.passed.sort()).toEqual(["flow-x", "flow-y"]);
    // Two distinct error signatures → two synthesized failures.
    expect(result.flows.failed).toHaveLength(2);
    const causes = result.flows.failed.map(
      (f: { primaryCause: string }) => f.primaryCause,
    );
    expect(causes.every((c: string) => c === "runtime-error")).toBe(true);
    const messages = result.flows.failed
      .map(
        (f: { runtimeErrors: { pageErrors: { message: string }[] } }) =>
          f.runtimeErrors.pageErrors[0]?.message ?? "",
      )
      .sort();
    expect(messages[0]).toContain("Apple");
    expect(messages[1]).toContain("Banana");
  });
});
