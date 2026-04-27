import { mkdtempSync, rmSync } from "node:fs";
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

describe("runBuildToSpecVerify — happy path (no violations)", () => {
  it("returns ok:true when both scripts return zero violations", async () => {
    const result = await runBuildToSpecVerify({
      projectDir,
      runScript: async ({ script }) =>
        script.includes("audit-app-reachability")
          ? stubReachOk()
          : stubSynthOk(),
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

  it("propagates playwright-not-installed as a WARNING not a failure", async () => {
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
    });
    expect(result.ok).toBe(true); // soft-gate: no orphans, no failed flows
    expect(result.warnings.join(" ")).toContain("playwright-not-installed");
    expect(result.warnings.join(" ")).toContain("pnpm -C apps/web add -D");
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

  it("treats a thrown runFlows as a warning, not a fatal", async () => {
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
    expect(result.ok).toBe(true); // no orphans, no failures recorded
    expect(result.warnings.join(" ")).toContain("run-synthesized-flows threw");
    expect(result.warnings.join(" ")).toContain("spawn ENOENT");
  });
});
