import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBuildToSpecVerify } from "../src/build-to-spec-verify.js";
import type {
  OrphanComponent,
  OrphanRoute,
} from "@repo/orchestrator-contracts";

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "build-to-spec-verify-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

const stubReachOk = () => ({
  stdout: JSON.stringify({
    ok: true,
    scannedFiles: 25,
    orphanComponents: [],
    orphanRoutes: [],
    ignoredByAllowComment: [],
  }),
  stderr: "",
  exitCode: 0,
});

const stubReachWithViolations = () => ({
  stdout: JSON.stringify({
    ok: false,
    scannedFiles: 25,
    orphanComponents: [
      {
        path: "apps/web/src/components/board/CardDetailModal.tsx",
        exportNames: ["CardDetailModal"],
        owningFeature: "feat-board-core",
        suggestedImporters: ["apps/web/src/components/board/KanbanBoard.tsx"],
        reason: "exported but no production importer",
      } satisfies OrphanComponent,
    ],
    orphanRoutes: [],
    ignoredByAllowComment: [],
  }),
  stderr: "",
  exitCode: 0,
});

const stubReachOrphanRoute = () => ({
  stdout: JSON.stringify({
    ok: false,
    scannedFiles: 25,
    orphanComponents: [],
    orphanRoutes: [
      {
        path: "apps/web/app/settings/page.tsx",
        routePattern: "/settings",
        owningFeature: "feat-settings",
        suggestedNavSurfaces: ["apps/web/src/components/layout/TopBar.tsx"],
        reason: "no nav reference",
      } satisfies OrphanRoute,
    ],
    ignoredByAllowComment: [],
  }),
  stderr: "",
  exitCode: 0,
});

const stubSynthOk = () => ({
  stdout: JSON.stringify({
    ok: true,
    flowsCount: 3,
    generatedFiles: [
      "apps/web/e2e/synthesized/flow-1.spec.ts",
      "apps/web/e2e/synthesized/flow-2.spec.ts",
      "apps/web/e2e/synthesized/flow-3.spec.ts",
    ],
    skippedFiles: [],
    projectDir: "/tmp/x",
    outDir: "apps/web/e2e/synthesized",
  }),
  stderr: "",
  exitCode: 0,
});

const stubSynthMissingManifest = () => ({
  stdout: JSON.stringify({
    ok: false,
    reason:
      "missing docs/user-flows-manifest.json — run /user-flows-generator first",
    generatedFiles: [],
    flowsCount: 0,
    projectDir: "/tmp/x",
  }),
  stderr: "",
  exitCode: 0,
});

// feat-056 Gap A — benign runFlows stub for tests that don't care about
// flow execution. Returns ok:true with empty arrays so the new
// tool-failure-as-bug logic in build-to-spec-verify.ts doesn't synthesize
// a FlowFailure (which would flip result.ok to false). Tests that DO
// care about flow execution provide their own runFlows stub.
const runFlowsOk = async () => ({
  ok: true,
  flows: { passed: [], failed: [], skipped: [] },
  warnings: [],
});

describe("runBuildToSpecVerify — happy path (no violations)", () => {
  it("returns ok:true when both scripts return zero violations", async () => {
    const result = await runBuildToSpecVerify({
      projectDir,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachOk()
          : stubSynthOk(),
      runFlows: runFlowsOk,
      fileBugPlan: async () => ({
        planId: "should-not-be-called",
        planPath: "",
      }),
    });
    expect(result.ok).toBe(true);
    expect(result.reachability.orphanComponents).toEqual([]);
    expect(result.reachability.orphanRoutes).toEqual([]);
    expect(result.flows.failed).toEqual([]);
    expect(result.flows.generated).toHaveLength(3);
    expect(result.bugPlansFiled).toEqual([]);
    expect(result.costUsd).toBe(0);
  });

  it("captures synth's generated files into flows.generated[]", async () => {
    const result = await runBuildToSpecVerify({
      projectDir,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachOk()
          : stubSynthOk(),
    });
    expect(result.flows.generated).toEqual([
      "apps/web/e2e/synthesized/flow-1.spec.ts",
      "apps/web/e2e/synthesized/flow-2.spec.ts",
      "apps/web/e2e/synthesized/flow-3.spec.ts",
    ]);
  });
});

describe("runBuildToSpecVerify — violation routing", () => {
  it("auto-files a bug plan per orphan component when violations present", async () => {
    const filed: string[] = [];
    const result = await runBuildToSpecVerify({
      projectDir,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachWithViolations()
          : stubSynthOk(),
      runFlows: runFlowsOk,
      fileBugPlan: async ({ violation }) => {
        const planId = `bug-001-${(violation as { kind: string }).kind}-stub`;
        filed.push(planId);
        return { planId, planPath: `/tmp/${planId}.md` };
      },
    });
    expect(result.ok).toBe(false);
    expect(result.bugPlansFiled).toEqual(["bug-001-orphan-component-stub"]);
    expect(filed).toEqual(["bug-001-orphan-component-stub"]);
    expect(result.reachability.orphanComponents).toHaveLength(1);
  });

  it("auto-files a bug plan per orphan route when present", async () => {
    const filed: string[] = [];
    const result = await runBuildToSpecVerify({
      projectDir,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachOrphanRoute()
          : stubSynthOk(),
      runFlows: runFlowsOk,
      fileBugPlan: async ({ violation }) => {
        const planId = `bug-002-${(violation as { kind: string }).kind}-stub`;
        filed.push(planId);
        return { planId, planPath: `/tmp/${planId}.md` };
      },
    });
    expect(result.ok).toBe(false);
    expect(result.bugPlansFiled).toEqual(["bug-002-orphan-route-stub"]);
    expect(result.reachability.orphanRoutes).toHaveLength(1);
  });

  it("does NOT call fileBugPlan when autoFileBugPlans=false", async () => {
    let called = 0;
    const result = await runBuildToSpecVerify({
      projectDir,
      autoFileBugPlans: false,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachWithViolations()
          : stubSynthOk(),
      fileBugPlan: async () => {
        called += 1;
        return { planId: "x", planPath: "/tmp/x" };
      },
    });
    expect(called).toBe(0);
    expect(result.bugPlansFiled).toEqual([]);
    expect(result.ok).toBe(false);
  });

  it("surfaces fileBugPlan errors as warnings without aborting", async () => {
    const result = await runBuildToSpecVerify({
      projectDir,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachWithViolations()
          : stubSynthOk(),
      fileBugPlan: async () => {
        throw new Error("disk full");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.bugPlansFiled).toEqual([]);
    expect(result.warnings.join(" ")).toContain("disk full");
  });
});

describe("runBuildToSpecVerify — script-output edge cases", () => {
  it("missing manifest in synth → warning surfaced + flows.generated stays empty", async () => {
    const result = await runBuildToSpecVerify({
      projectDir,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachOk()
          : stubSynthMissingManifest(),
      fileBugPlan: async () => ({ planId: "x", planPath: "/tmp/x" }),
    });
    expect(result.flows.generated).toEqual([]);
    expect(result.warnings.join(" ")).toContain("user-flows-manifest");
    // Reachability returned no orphans, so overall ok is still true.
    expect(result.ok).toBe(true);
  });

  it("malformed reachability stdout → warning + empty arrays + ok:true", async () => {
    const result = await runBuildToSpecVerify({
      projectDir,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? { stdout: "<<not-json>>", stderr: "", exitCode: 0 }
          : stubSynthOk(),
      runFlows: runFlowsOk,
      fileBugPlan: async () => ({ planId: "x", planPath: "/tmp/x" }),
    });
    expect(result.warnings.join(" ")).toContain(
      "reachability script output parse failed",
    );
    expect(result.reachability.orphanComponents).toEqual([]);
    expect(result.reachability.orphanRoutes).toEqual([]);
    // No violations → ok:true even though parse failed.
    expect(result.ok).toBe(true);
  });

  it("durationMs is non-negative and integer", async () => {
    const result = await runBuildToSpecVerify({
      projectDir,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachOk()
          : stubSynthOk(),
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result.durationMs)).toBe(true);
  });
});

// ─── feat-025 Phase 3 — flow-execution integration ──────────────────────────

describe("runBuildToSpecVerify — flow-execution integration (feat-025)", () => {
  it("calls runFlows when synth produced specs; populates flows.passed/failed", async () => {
    let runFlowsCalled = 0;
    const result = await runBuildToSpecVerify({
      projectDir,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachOk()
          : stubSynthOk(),
      runFlows: async () => {
        runFlowsCalled += 1;
        return {
          ok: true,
          browser: "chromium",
          flows: {
            passed: ["flow-1", "flow-2", "flow-3"],
            failed: [],
            skipped: [],
          },
          warnings: [],
        };
      },
    });
    expect(runFlowsCalled).toBe(1);
    expect(result.flows.passed).toEqual(["flow-1", "flow-2", "flow-3"]);
    expect(result.flows.failed).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("does NOT call runFlows when synth produced zero specs", async () => {
    let runFlowsCalled = 0;
    await runBuildToSpecVerify({
      projectDir,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachOk()
          : stubSynthMissingManifest(),
      runFlows: async () => {
        runFlowsCalled += 1;
        return {
          ok: true,
          flows: { passed: [], failed: [], skipped: [] },
          warnings: [],
        };
      },
    });
    expect(runFlowsCalled).toBe(0);
  });

  it("does NOT call runFlows when executeFlows: false", async () => {
    let runFlowsCalled = 0;
    await runBuildToSpecVerify({
      projectDir,
      executeFlows: false,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachOk()
          : stubSynthOk(),
      runFlows: async () => {
        runFlowsCalled += 1;
        return {
          ok: true,
          flows: { passed: [], failed: [], skipped: [] },
          warnings: [],
        };
      },
    });
    expect(runFlowsCalled).toBe(0);
  });

  it("classifies playwright-not-installed as runtime-error tool-failure bug + ok:false (feat-056 Gap A)", async () => {
    let bugPlansFiledCount = 0;
    let lastBugViolation: { kind?: string } = {};
    const result = await runBuildToSpecVerify({
      projectDir,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachOk()
          : stubSynthOk(),
      runFlows: async () => ({
        ok: false,
        reason: "playwright-not-installed",
        remediation: "pnpm -C apps/web add -D @playwright/test",
        flows: { passed: [], failed: [], skipped: [] },
        warnings: [],
      }),
      fileBugPlan: async ({ violation }) => {
        bugPlansFiledCount++;
        lastBugViolation = violation as { kind?: string };
        return {
          planId: `bug-runtime-tooling-${bugPlansFiledCount}`,
          planPath: `plans/active/bug-runtime-tooling-${bugPlansFiledCount}.md`,
        };
      },
    });
    // bug-037 Phase C / feat-056 Gap A — was result.ok=true (soft-gate);
    // now flips to false because tool-failure is a real bug, not a warning.
    expect(result.ok).toBe(false);
    expect(result.flows.failed.length).toBe(1);
    expect(result.flows.failed[0]?.flowId).toBe("tooling-pre-flight");
    expect(result.flows.failed[0]?.primaryCause).toBe("runtime-error");
    expect(bugPlansFiledCount).toBe(1);
    expect(lastBugViolation.kind).toBe("runtime-error");
    // Warnings still preserved alongside the bug filing.
    expect(result.warnings.join(" ")).toContain("playwright-not-installed");
    expect(result.warnings.join(" ")).toContain("pnpm -C apps/web add -D");
  });

  it("classifies dev-server-not-ready as dev-server-compile tool-failure bug + ok:false (feat-056 Gap A)", async () => {
    let bugPlansFiledCount = 0;
    let lastBugViolation: { kind?: string } = {};
    const result = await runBuildToSpecVerify({
      projectDir,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachOk()
          : stubSynthOk(),
      runFlows: async () => ({
        ok: false,
        reason: "dev-server-not-ready",
        remediation:
          "dev server at http://localhost:3000 did not respond within 60000ms: ECONNREFUSED",
        flows: { passed: [], failed: [], skipped: [] },
        warnings: [],
      }),
      fileBugPlan: async ({ violation }) => {
        bugPlansFiledCount++;
        lastBugViolation = violation as { kind?: string };
        return {
          planId: `bug-compile-tooling-${bugPlansFiledCount}`,
          planPath: `plans/active/bug-compile-tooling-${bugPlansFiledCount}.md`,
        };
      },
    });
    expect(result.ok).toBe(false);
    expect(result.flows.failed.length).toBe(1);
    expect(result.flows.failed[0]?.primaryCause).toBe("dev-server-compile");
    expect(bugPlansFiledCount).toBe(1);
    expect(lastBugViolation.kind).toBe("dev-server-compile");
  });

  it("classifies runFlows throw as runtime-error tool-failure bug + ok:false (feat-056 Gap A)", async () => {
    let bugPlansFiledCount = 0;
    const result = await runBuildToSpecVerify({
      projectDir,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachOk()
          : stubSynthOk(),
      runFlows: async () => {
        throw new Error("playwright-runner-threw: unexpected exit code 137");
      },
      fileBugPlan: async () => {
        bugPlansFiledCount++;
        return {
          planId: `bug-runtime-tooling-throw`,
          planPath: `plans/active/bug-runtime-tooling-throw.md`,
        };
      },
    });
    expect(result.ok).toBe(false);
    expect(result.flows.failed.length).toBe(1);
    expect(result.flows.failed[0]?.primaryCause).toBe("runtime-error");
    expect(result.flows.failed[0]?.message).toContain(
      "playwright-runner-threw",
    );
    expect(bugPlansFiledCount).toBe(1);
    expect(result.warnings.join(" ")).toContain("run-synthesized-flows threw");
  });

  it("flow failures contribute to ok:false even with zero orphans", async () => {
    const result = await runBuildToSpecVerify({
      projectDir,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachOk()
          : stubSynthOk(),
      runFlows: async () => ({
        ok: false,
        flows: {
          passed: ["flow-1"],
          failed: [
            {
              flowId: "flow-2",
              flowName: "Open detail",
              step: 1,
              fromScreenId: "home",
              expectedScreenId: "card-modal",
              actualScreenId: "home",
              selector: "[data-kit-component=Card]",
              screenshotPath: "test-results/flow-2.png",
              htmlDumpPath: "test-results/flow-2.html",
              message: "clicked card; landed on home",
            },
          ],
          skipped: [],
        },
        warnings: [],
      }),
      fileBugPlan: async () => ({
        planId: "bug-100-flow-2-stub",
        planPath: "/tmp/x",
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.flows.failed).toHaveLength(1);
    expect(result.bugPlansFiled).toContain("bug-100-flow-2-stub");
  });

  it("consolidates flow failure with related orphan into ONE bug plan", async () => {
    const filed: { kind: string; relatedOrphan?: string }[] = [];
    const result = await runBuildToSpecVerify({
      projectDir,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? // orphan path includes "modal" which matches the failed flow's
            // expectedScreenId="card-modal" → correlate
            {
              stdout: JSON.stringify({
                ok: false,
                scannedFiles: 25,
                orphanComponents: [
                  {
                    path: "apps/web/src/components/board/CardDetailModal.tsx",
                    exportNames: ["CardDetailModal"],
                    owningFeature: "feat-board-core",
                    suggestedImporters: [
                      "apps/web/src/components/board/KanbanBoard.tsx",
                    ],
                    reason: "exported but no production importer",
                  },
                ],
                orphanRoutes: [],
                ignoredByAllowComment: [],
              }),
              stderr: "",
              exitCode: 0,
            }
          : stubSynthOk(),
      runFlows: async () => ({
        ok: false,
        flows: {
          passed: [],
          failed: [
            {
              flowId: "flow-1",
              flowName: "Open card",
              step: 1,
              fromScreenId: "home",
              expectedScreenId: "card-modal",
              actualScreenId: "home",
              selector: "[data-kit-component=Card]",
              screenshotPath: null,
              htmlDumpPath: null,
              message: "clicked toward card-modal but landed on home",
            },
          ],
          skipped: [],
        },
        warnings: [],
      }),
      fileBugPlan: async ({ violation, relatedOrphan }) => {
        const entry: { kind: string; relatedOrphan?: string } = {
          kind: violation.kind,
        };
        const exportName = relatedOrphan?.exportNames?.[0];
        if (exportName !== undefined) entry.relatedOrphan = exportName;
        filed.push(entry);
        return { planId: `bug-200-${violation.kind}`, planPath: "" };
      },
    });
    expect(result.ok).toBe(false);
    // Only the flow plan files; the orphan does NOT get a stand-alone plan
    // because it was consumed by the flow plan as relatedOrphan.
    expect(filed).toHaveLength(1);
    expect(filed[0]!.kind).toBe("flow-failure");
    expect(filed[0]!.relatedOrphan).toBe("CardDetailModal");
  });

  it("surfaces runFlows.warnings into top-level warnings[] (prefixed)", async () => {
    const result = await runBuildToSpecVerify({
      projectDir,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachOk()
          : stubSynthOk(),
      runFlows: async () => ({
        ok: true,
        flows: { passed: ["flow-1"], failed: [], skipped: [] },
        warnings: ["dev server took 45s to start"],
      }),
    });
    expect(result.warnings.join(" ")).toContain("flow-execution:");
    expect(result.warnings.join(" ")).toContain("dev server took 45s");
  });

  it("treats a thrown runFlows as a runtime-error tool-failure bug + ok:false (feat-056 Gap A)", async () => {
    const result = await runBuildToSpecVerify({
      projectDir,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachOk()
          : stubSynthOk(),
      runFlows: async () => {
        throw new Error("spawn ENOENT");
      },
    });
    // bug-037 Phase C / feat-056 Gap A — was result.ok=true (soft-gate);
    // now flips to false because runner-throw is a real bug, not a warning.
    expect(result.ok).toBe(false);
    expect(result.flows.failed.length).toBe(1);
    expect(result.flows.failed[0]?.flowId).toBe("tooling-pre-flight");
    expect(result.flows.failed[0]?.primaryCause).toBe("runtime-error");
    expect(result.warnings.join(" ")).toContain("run-synthesized-flows threw");
    expect(result.warnings.join(" ")).toContain("spawn ENOENT");
  });
});

// ─── feat-027 Phase D — runtime-error / dev-server-compile routing ──────────

describe("runBuildToSpecVerify — feat-027 cascade-root routing", () => {
  it("files dev-server-compile bug FIRST and tags dependent timeouts with dependsOnBugId", async () => {
    /** @type {Array<{kind: string, dependsOnBugId?: string}>} */
    const filed: Array<{ kind: string; dependsOnBugId?: string }> = [];
    let seq = 0;
    const result = await runBuildToSpecVerify({
      projectDir,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachOk()
          : stubSynthOk(),
      runFlows: async () => ({
        ok: false,
        flows: {
          passed: [],
          failed: [
            {
              flowId: "flow-1",
              flowName: "Sign in",
              step: 0,
              fromScreenId: "(entry)",
              expectedScreenId: "home",
              actualScreenId: null,
              selector: null,
              screenshotPath: null,
              htmlDumpPath: null,
              message: "Test timeout 30000ms exceeded",
              primaryCause: "timeout-no-evidence",
            },
            {
              flowId: "flow-2",
              flowName: "View board",
              step: 0,
              fromScreenId: "(entry)",
              expectedScreenId: "board",
              actualScreenId: null,
              selector: null,
              screenshotPath: null,
              htmlDumpPath: null,
              message: "Test timeout 30000ms exceeded",
              primaryCause: "timeout-no-evidence",
            },
            {
              flowId: "flow-3",
              flowName: "Edit card",
              step: 1,
              fromScreenId: "home",
              expectedScreenId: "card-modal",
              actualScreenId: null,
              selector: null,
              screenshotPath: "test-results/flow-3.png",
              htmlDumpPath: null,
              message: "Test timeout 30000ms exceeded",
              primaryCause: "dev-server-compile",
              runtimeErrors: {
                consoleErrors: [],
                pageErrors: [],
                networkFailures: [],
                devServerOverlay: {
                  detected: true,
                  rawText: "Module not found: Can't resolve '../../foo.css'",
                },
              },
            },
          ],
          skipped: [],
        },
        warnings: [],
      }),
      fileBugPlan: async ({ violation, dependsOnBugId }) => {
        seq += 1;
        const planId = `bug-${String(seq).padStart(3, "0")}-${violation.kind}-stub`;
        filed.push({
          kind: violation.kind,
          ...(dependsOnBugId !== undefined && { dependsOnBugId }),
        });
        return { planId, planPath: `/tmp/${planId}.md` };
      },
    });
    expect(result.ok).toBe(false);
    // Cascade root files FIRST
    expect(filed[0]!.kind).toBe("dev-server-compile");
    expect(filed[0]!.dependsOnBugId).toBeUndefined();
    // Dependent timeouts file SECOND + THIRD with dependsOnBugId set
    expect(filed.slice(1).every((f) => f.kind === "flow-failure")).toBe(true);
    expect(filed[1]!.dependsOnBugId).toBe("bug-001-dev-server-compile-stub");
    expect(filed[2]!.dependsOnBugId).toBe("bug-001-dev-server-compile-stub");
  });

  it("files runtime-error bug FIRST when no dev-server overlay", async () => {
    /** @type {string[]} */
    const filed: string[] = [];
    const result = await runBuildToSpecVerify({
      projectDir,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachOk()
          : stubSynthOk(),
      runFlows: async () => ({
        ok: false,
        flows: {
          passed: [],
          failed: [
            {
              flowId: "flow-2",
              flowName: "Late",
              step: 1,
              fromScreenId: "home",
              expectedScreenId: "board",
              actualScreenId: "home",
              selector: "[data-x]",
              screenshotPath: null,
              htmlDumpPath: null,
              message: "step 1 failed",
              primaryCause: "step-transition",
            },
            {
              flowId: "flow-1",
              flowName: "Boot",
              step: 0,
              fromScreenId: "(entry)",
              expectedScreenId: "home",
              actualScreenId: null,
              selector: null,
              screenshotPath: null,
              htmlDumpPath: null,
              message: "step 1 failed; runtime errors present",
              primaryCause: "runtime-error",
              runtimeErrors: {
                consoleErrors: ["Error: Maximum update depth exceeded"],
                pageErrors: [],
                networkFailures: [],
              },
            },
          ],
          skipped: [],
        },
        warnings: [],
      }),
      fileBugPlan: async ({ violation }) => {
        const planId = `bug-${violation.kind}-stub`;
        filed.push(planId);
        return { planId, planPath: "/tmp/x" };
      },
    });
    expect(result.ok).toBe(false);
    // First filed = runtime-error (cascade root)
    expect(filed[0]).toBe("bug-runtime-error-stub");
    // Second = step-transition (dependent flow-failure, no dependsOn since
    // this isn't a timeout-no-evidence)
    expect(filed[1]).toBe("bug-flow-failure-stub");
  });

  it("does NOT tag dependsOnBugId on step-transition failures (only timeout-no-evidence)", async () => {
    /** @type {Array<{kind: string, dependsOnBugId?: string}>} */
    const filed: Array<{ kind: string; dependsOnBugId?: string }> = [];
    await runBuildToSpecVerify({
      projectDir,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachOk()
          : stubSynthOk(),
      runFlows: async () => ({
        ok: false,
        flows: {
          passed: [],
          failed: [
            {
              flowId: "flow-1",
              flowName: "x",
              step: 1,
              fromScreenId: "a",
              expectedScreenId: "b",
              actualScreenId: "c",
              selector: "[d]",
              screenshotPath: null,
              htmlDumpPath: null,
              message: "synth assertion fired",
              primaryCause: "step-transition",
            },
            {
              flowId: "flow-2",
              flowName: "y",
              step: 0,
              fromScreenId: "(entry)",
              expectedScreenId: "home",
              actualScreenId: null,
              selector: null,
              screenshotPath: null,
              htmlDumpPath: null,
              message: "runtime err",
              primaryCause: "runtime-error",
              runtimeErrors: {
                consoleErrors: ["Error: a"],
                pageErrors: [],
                networkFailures: [],
              },
            },
          ],
          skipped: [],
        },
        warnings: [],
      }),
      fileBugPlan: async ({ violation, dependsOnBugId }) => {
        filed.push({
          kind: violation.kind,
          ...(dependsOnBugId !== undefined && { dependsOnBugId }),
        });
        return { planId: `bug-${violation.kind}`, planPath: "" };
      },
    });
    // First entry = runtime-error (cascade root, no dependsOn)
    expect(filed[0]!.kind).toBe("runtime-error");
    expect(filed[0]!.dependsOnBugId).toBeUndefined();
    // Second entry = step-transition (NOT timeout-no-evidence, so no dependsOn)
    expect(filed[1]!.kind).toBe("flow-failure");
    expect(filed[1]!.dependsOnBugId).toBeUndefined();
  });

  it("preserves existing flow-failure routing when no cascade-root failures present", async () => {
    /** @type {string[]} */
    const filed: string[] = [];
    const result = await runBuildToSpecVerify({
      projectDir,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachOk()
          : stubSynthOk(),
      runFlows: async () => ({
        ok: false,
        flows: {
          passed: [],
          failed: [
            {
              flowId: "flow-1",
              flowName: "x",
              step: 2,
              fromScreenId: "a",
              expectedScreenId: "b",
              actualScreenId: "a",
              selector: "[d]",
              screenshotPath: null,
              htmlDumpPath: null,
              message: "synth fail",
              primaryCause: "step-transition",
            },
          ],
          skipped: [],
        },
        warnings: [],
      }),
      fileBugPlan: async ({ violation }) => {
        const planId = `bug-${violation.kind}`;
        filed.push(planId);
        return { planId, planPath: "" };
      },
    });
    expect(result.ok).toBe(false);
    expect(filed).toEqual(["bug-flow-failure"]);
  });
});

// ─── feat-028 Phase 4 — parity-verify integration ──────────────────────────

describe("runBuildToSpecVerify — parity-verify integration (feat-028)", () => {
  it("calls parityVerify when runParity is unset (default true) + folds output", async () => {
    let parityCalls = 0;
    const result = await runBuildToSpecVerify({
      projectDir,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachOk()
          : stubSynthOk(),
      executeFlows: false,
      parityVerify: async () => {
        parityCalls += 1;
        return {
          ok: true,
          screensChecked: 4,
          divergences: [],
          warnings: [],
          durationMs: 100,
          costUsd: 0,
        };
      },
    });
    expect(parityCalls).toBe(1);
    expect(result.parity).toBeDefined();
    expect(result.parity?.screensChecked).toBe(4);
    expect(result.ok).toBe(true);
  });

  it("does NOT call parityVerify when runParity:false", async () => {
    let parityCalls = 0;
    const result = await runBuildToSpecVerify({
      projectDir,
      runParity: false,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachOk()
          : stubSynthOk(),
      executeFlows: false,
      parityVerify: async () => {
        parityCalls += 1;
        return {
          ok: true,
          screensChecked: 0,
          divergences: [],
          warnings: [],
          durationMs: 0,
          costUsd: 0,
        };
      },
    });
    expect(parityCalls).toBe(0);
    expect(result.parity).toBeUndefined();
    expect(result.ok).toBe(true);
  });

  it("flips top-level ok:false when parity has divergences (otherwise green)", async () => {
    const result = await runBuildToSpecVerify({
      projectDir,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachOk()
          : stubSynthOk(),
      executeFlows: false,
      parityVerify: async () => ({
        ok: false,
        screensChecked: 1,
        divergences: [
          {
            screen: "home",
            pattern: "shell-stripping",
            detail: {
              missing: ['[data-kit-component="AppShell"]'],
              extra: [],
              variantDrift: [],
              styleDrift: [],
            },
            severity: "P0",
          },
        ],
        warnings: [],
        durationMs: 100,
        costUsd: 0,
      }),
      fileBugPlan: async () => ({
        planId: "bug-001-parity-home-shell-stripping",
        planPath: "/tmp/x",
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.parity?.divergences).toHaveLength(1);
    expect(result.bugPlansFiled).toContain(
      "bug-001-parity-home-shell-stripping",
    );
  });

  it("propagates parity warnings into top-level warnings[]", async () => {
    const result = await runBuildToSpecVerify({
      projectDir,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachOk()
          : stubSynthOk(),
      executeFlows: false,
      parityVerify: async () => ({
        ok: true,
        screensChecked: 0,
        divergences: [],
        warnings: ["playwright-not-installed"],
        durationMs: 5,
        costUsd: 0,
      }),
    });
    expect(result.warnings.join(" ")).toContain(
      "parity: playwright-not-installed",
    );
  });

  it("captures parityVerify exceptions as warnings without aborting", async () => {
    const result = await runBuildToSpecVerify({
      projectDir,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachOk()
          : stubSynthOk(),
      executeFlows: false,
      parityVerify: async () => {
        throw new Error("parity boom");
      },
    });
    expect(result.warnings.join(" ")).toContain("parity-verify threw");
    expect(result.warnings.join(" ")).toContain("parity boom");
    expect(result.parity).toBeUndefined();
    expect(result.ok).toBe(true); // no divergences (threw → no parity object)
  });

  it("files ONE bug plan per (screen, pattern) divergence", async () => {
    const filed: string[] = [];
    await runBuildToSpecVerify({
      projectDir,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachOk()
          : stubSynthOk(),
      executeFlows: false,
      parityVerify: async () => ({
        ok: false,
        screensChecked: 2,
        divergences: [
          {
            screen: "home",
            pattern: "shell-stripping",
            detail: {
              missing: ['[data-kit-component="AppShell"]'],
              extra: [],
              variantDrift: [],
              styleDrift: [],
            },
            severity: "P0",
          },
          {
            screen: "settings",
            pattern: "token-drift",
            detail: {
              missing: [],
              extra: [],
              variantDrift: [],
              styleDrift: [
                {
                  selector: '[data-kit-component="Card"]',
                  property: "background-color",
                  mockupValue: "rgb(248, 250, 252)",
                  builtValue: "rgb(255, 255, 255)",
                },
              ],
            },
            severity: "P1",
          },
        ],
        warnings: [],
        durationMs: 200,
        costUsd: 0,
      }),
      fileBugPlan: async ({ violation }) => {
        const div = violation as unknown as { kind: string; screen?: string };
        filed.push(`bug-${div.kind}-${div.screen ?? "n/a"}`);
        return { planId: filed[filed.length - 1]!, planPath: "" };
      },
    });
    expect(filed).toEqual([
      "bug-parity-divergence-home",
      "bug-parity-divergence-settings",
    ]);
  });

  it("does NOT file parity bug plans when autoFileBugPlans:false", async () => {
    let calls = 0;
    const result = await runBuildToSpecVerify({
      projectDir,
      autoFileBugPlans: false,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachOk()
          : stubSynthOk(),
      executeFlows: false,
      parityVerify: async () => ({
        ok: false,
        screensChecked: 1,
        divergences: [
          {
            screen: "home",
            pattern: "shell-stripping",
            detail: {
              missing: ['[data-kit-component="AppShell"]'],
              extra: [],
              variantDrift: [],
              styleDrift: [],
            },
            severity: "P0",
          },
        ],
        warnings: [],
        durationMs: 100,
        costUsd: 0,
      }),
      fileBugPlan: async () => {
        calls += 1;
        return { planId: "x", planPath: "" };
      },
    });
    expect(calls).toBe(0);
    expect(result.parity?.divergences).toHaveLength(1);
    expect(result.bugPlansFiled).toEqual([]);
    expect(result.ok).toBe(false); // divergences still flip ok:false
  });
});

// ─── bug-078 / feat-066 v2 Phase 1B: pre-verify discriminator gate ─────────

describe("runBuildToSpecVerify — bug-078 pre-verify discriminator gate", () => {
  function writeFile(rel: string, content: string) {
    const abs = join(projectDir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }

  it("short-circuits + emits ONE bug when P0 discriminator (css-pipeline) hits", async () => {
    // Tailwind config exists but postcss config + @tailwind directives don't
    writeFile("apps/web/tailwind.config.ts", "export default {};");

    let runScriptCalled = false;
    let fileBugPlanCalled = 0;
    const result = await runBuildToSpecVerify({
      projectDir,
      factoryRoot: "/factory",
      runScript: async () => {
        runScriptCalled = true;
        return { stdout: "{}", stderr: "", exitCode: 0 };
      },
      runParity: false,
      fileBugPlan: async () => {
        fileBugPlanCalled += 1;
        return {
          planId: `bug-pre-${fileBugPlanCalled}`,
          planPath: "plans/active/bug-pre.md",
        };
      },
    });

    expect(result.ok).toBe(false);
    // Verifier short-circuited — reach + synth scripts NOT called.
    expect(runScriptCalled).toBe(false);
    // One bug plan filed for the css-pipeline discriminator hit.
    expect(result.bugPlansFiled).toHaveLength(1);
    expect(result.flows.failed).toHaveLength(1);
    expect(result.flows.failed[0]?.flowId).toBe(
      "pre-verify-tooling-css-pipeline-broken",
    );
    expect(result.flows.failed[0]?.primaryCause).toBe("dev-server-compile");
    // warnings include the discriminator trace
    expect(result.warnings?.join(" ")).toContain("tooling-css-pipeline-broken");
  });

  it("emits multiple synthetic bugs when several P0 discriminators hit", async () => {
    // Two problems simultaneously:
    //  1. Tailwind config present, postcss + @tailwind missing → css-pipeline
    //  2. next.config has output:export + apps/api/ exists → output-export-mismatch
    writeFile("apps/web/tailwind.config.ts", "export default {};");
    writeFile(
      "apps/web/next.config.ts",
      `const config = { output: "export" };\nexport default config;`,
    );
    writeFile("apps/api/package.json", "{}");

    const result = await runBuildToSpecVerify({
      projectDir,
      factoryRoot: "/factory",
      runScript: async () => ({ stdout: "{}", stderr: "", exitCode: 0 }),
      runParity: false,
      fileBugPlan: async () => ({
        planId: "bug-pre",
        planPath: "plans/active/bug-pre.md",
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.flows.failed.length).toBeGreaterThanOrEqual(2);
    const flowIds = result.flows.failed.map((f) => f.flowId).sort();
    expect(flowIds).toContain("pre-verify-tooling-css-pipeline-broken");
    expect(flowIds).toContain("pre-verify-tooling-config-mismatch");
  });

  it("does NOT short-circuit on a clean project (no discriminator hits)", async () => {
    // Build a project that passes every discriminator:
    writeFile("apps/web/tailwind.config.ts", "export default {};");
    writeFile(
      "apps/web/postcss.config.mjs",
      "export default { plugins: { tailwindcss: {}, autoprefixer: {} } };",
    );
    writeFile(
      "packages/ui-kit/src/styles/globals.css",
      "@tailwind base;\n@tailwind components;\n@tailwind utilities;",
    );
    writeFile(
      "apps/web/next.config.ts",
      `const config = { transpilePackages: ["@repo/ui-kit"] };\nexport default config;`,
    );
    writeFile("apps/api/.env.example", "ENABLE_TEST_SEED=1\n");

    let runScriptCallCount = 0;
    const result = await runBuildToSpecVerify({
      projectDir,
      factoryRoot: "/factory",
      runScript: async () => {
        runScriptCallCount += 1;
        return {
          stdout: JSON.stringify({
            ok: true,
            scannedFiles: 0,
            orphanComponents: [],
            orphanRoutes: [],
            ignoredByAllowComment: [],
            generatedFiles: [],
          }),
          stderr: "",
          exitCode: 0,
        };
      },
      executeFlows: false,
      runParity: false,
    });

    expect(result.ok).toBe(true);
    expect(runScriptCallCount).toBe(2); // reach + synth both ran
  });

  it("does NOT short-circuit on a P1/P2-only hit (test-seed missing line)", async () => {
    // apps/api/ exists but .env.example doesn't have ENABLE_TEST_SEED line at
    // all → P2 hit only. Verifier should still proceed.
    writeFile("apps/api/.env.example", "PORT=3001\n"); // no ENABLE_TEST_SEED line

    let runScriptCallCount = 0;
    const result = await runBuildToSpecVerify({
      projectDir,
      factoryRoot: "/factory",
      runScript: async () => {
        runScriptCallCount += 1;
        return {
          stdout: JSON.stringify({
            ok: true,
            scannedFiles: 0,
            orphanComponents: [],
            orphanRoutes: [],
            ignoredByAllowComment: [],
            generatedFiles: [],
          }),
          stderr: "",
          exitCode: 0,
        };
      },
      executeFlows: false,
      runParity: false,
    });

    // P2 hit logs a warning but doesn't short-circuit
    expect(runScriptCallCount).toBe(2);
    expect(result.warnings?.join(" ")).toContain(
      "tooling-test-seed-contract-broken",
    );
  });
});
