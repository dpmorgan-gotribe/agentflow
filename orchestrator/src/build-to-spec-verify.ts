import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  BuildToSpecVerifyOutput,
  type BuildToSpecVerifyOutput as BuildToSpecVerifyOutputType,
  type FlowFailure,
  type OrphanComponent,
  type OrphanRoute,
} from "@repo/orchestrator-contracts";

/**
 * feat-022 Phase 4 — orchestrator-side wrapper for the
 * `/build-to-spec-verify` deterministic skill.
 *
 * This is NOT an LLM dispatch. It shells out to two pure scripts
 * (`scripts/audit-app-reachability.mjs` + `scripts/synthesize-flow-e2e.mjs`),
 * aggregates their output, optionally auto-files bug plans for each
 * violation via `scripts/file-bug-plan.mjs`, and returns a typed
 * `BuildToSpecVerifyOutput` that the post-Mode-B step in
 * `feature-graph.ts` consumes.
 *
 * The synthesizer's emitted spec files persist as a regression suite for
 * the next run — we don't actually EXECUTE them here (that requires a live
 * dev server + Playwright runtime, which the project owns; the orchestrator
 * stages on the green-build assumption that `pnpm playwright test` ran as
 * part of the tester step). For the gap-detection pass we need the static
 * reachability layer plus the existence + parseability of the spec files.
 *
 * Future versions (v2) will run the synthesized specs against a temporary
 * dev server during this stage; v1 keeps the runtime cost at ~$0 by
 * relying on the existing tester-stage Playwright invocation to surface
 * any regressions of the synthesized specs on the next run.
 */

export interface BuildToSpecVerifyContext {
  projectDir: string;
  /** Repo root for the factory itself (where scripts/ lives). Defaults to process.cwd(). */
  factoryRoot?: string;
  /** When true, file bug plans for each violation. Default true. */
  autoFileBugPlans?: boolean;
  /** Test seam — replaces the spawn() helper. Default uses `node`. */
  runScript?: (args: {
    script: string;
    projectDir: string;
    cwd: string;
  }) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /** Test seam — replaces fileBugPlan import; receives the structured violation. */
  fileBugPlan?: (args: {
    projectDir: string;
    violation: BugPlanViolation;
    relatedOrphan?: OrphanComponent;
  }) => Promise<{ planId: string; planPath: string }>;
  /**
   * feat-025 Phase 3 — test seam for the flow-execution runner. Replaces
   * the `runSynthesizedFlows()` import from `scripts/run-synthesized-flows.mjs`.
   * If omitted in tests, the runner is invoked via dynamic import (same
   * pattern as `fileBugPlan`).
   */
  runFlows?: (args: {
    projectDir: string;
    factoryRoot: string;
  }) => Promise<RunFlowsResult>;
  /**
   * feat-025 Phase 3 — when false, skip the flow-execution stage entirely
   * (only run reachability + synthesis). Default true. Tests that don't
   * exercise execution can opt out without supplying a stub.
   */
  executeFlows?: boolean;
}

/**
 * Output shape from `scripts/run-synthesized-flows.mjs`. Matches the JSON
 * the runner emits to stdout. Mirrors `BuildToSpecVerifyOutput.flows` plus
 * pre-flight gating fields (`reason` / `remediation`) when Playwright
 * isn't installed.
 */
export interface RunFlowsResult {
  ok: boolean;
  reason?: string;
  remediation?: string;
  browser?: string;
  flows: {
    passed: string[];
    failed: FlowFailure[];
    skipped: string[];
  };
  devServerStartedMs?: number;
  totalRunMs?: number;
  warnings?: string[];
}

export type BugPlanViolation =
  | (FlowFailure & { kind: "flow-failure" })
  | (OrphanComponent & { kind: "orphan-component" })
  | (OrphanRoute & { kind: "orphan-route" });

/**
 * Default `runScript` implementation. Spawns `node <script> <projectDir>`
 * from the factory root, captures stdout/stderr, returns parseable JSON.
 */
async function defaultRunScript({
  script,
  projectDir,
  cwd,
}: {
  script: string;
  projectDir: string;
  cwd: string;
}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolveP) => {
    const child = spawn(process.execPath, [script, projectDir], {
      cwd,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) =>
      resolveP({ stdout, stderr, exitCode: code ?? 0 }),
    );
  });
}

/**
 * Run the deterministic verification stage. Returns a parsed
 * `BuildToSpecVerifyOutput` (Zod-validated). On internal failure
 * (script crash, missing project, JSON parse fail) returns an `ok: false`
 * payload with a `warnings[]` entry — the caller decides whether to abort
 * the orchestrator's "complete" signal.
 */
export async function runBuildToSpecVerify(
  ctx: BuildToSpecVerifyContext,
): Promise<BuildToSpecVerifyOutputType> {
  const startedAt = Date.now();
  const factoryRoot = ctx.factoryRoot ?? process.cwd();
  const runScript = ctx.runScript ?? defaultRunScript;
  const projectDir = resolve(ctx.projectDir);

  const reachScript = resolve(
    factoryRoot,
    "scripts/audit-app-reachability.mjs",
  );
  const synthScript = resolve(factoryRoot, "scripts/synthesize-flow-e2e.mjs");

  const warnings: string[] = [];

  // Sanity: scripts must exist
  if (!existsSync(reachScript)) warnings.push(`missing script: ${reachScript}`);
  if (!existsSync(synthScript)) warnings.push(`missing script: ${synthScript}`);

  // Run both in parallel
  const [reachResult, synthResult] = await Promise.all([
    runScript({ script: reachScript, projectDir, cwd: factoryRoot }).catch(
      (err) => ({ stdout: "", stderr: String(err), exitCode: 1 }),
    ),
    runScript({ script: synthScript, projectDir, cwd: factoryRoot }).catch(
      (err) => ({ stdout: "", stderr: String(err), exitCode: 1 }),
    ),
  ]);

  // Parse reachability output
  let orphanComponents: OrphanComponent[] = [];
  let orphanRoutes: OrphanRoute[] = [];
  let scannedFiles = 0;
  let ignoredByAllowComment: string[] = [];
  try {
    const parsed = JSON.parse(reachResult.stdout);
    orphanComponents = (parsed.orphanComponents ?? []) as OrphanComponent[];
    orphanRoutes = (parsed.orphanRoutes ?? []) as OrphanRoute[];
    scannedFiles = Number(parsed.scannedFiles ?? 0);
    ignoredByAllowComment = parsed.ignoredByAllowComment ?? [];
  } catch (err) {
    warnings.push(
      `reachability script output parse failed: ${(err as Error).message}; stderr: ${reachResult.stderr.slice(0, 200)}`,
    );
  }

  // Parse synth output
  let generatedFiles: string[] = [];
  let synthOk = false;
  try {
    const parsed = JSON.parse(synthResult.stdout);
    generatedFiles = parsed.generatedFiles ?? [];
    synthOk = parsed.ok === true;
    if (!synthOk && parsed.reason) {
      warnings.push(`synth: ${parsed.reason}`);
    }
  } catch (err) {
    warnings.push(
      `synth script output parse failed: ${(err as Error).message}; stderr: ${synthResult.stderr.slice(0, 200)}`,
    );
  }

  // ── feat-025 Phase 3: execute synthesized flow specs ─────────────────────
  // Call the runner only when synthesis emitted at least one spec AND
  // executeFlows isn't explicitly disabled. The runner shells out to
  // `pnpm -C apps/web exec playwright test e2e/synthesized/`; it gracefully
  // degrades to `{ ok:false, reason:"playwright-not-installed" }` when the
  // project hasn't installed the runtime — we propagate that as a warning
  // (not a failure) so the verify stage stays soft-gated for v1.
  const flowsPassed: string[] = [];
  const flowsFailed: FlowFailure[] = [];
  if (ctx.executeFlows !== false && generatedFiles.length > 0) {
    let runResult: RunFlowsResult | null = null;
    try {
      const runFlows: NonNullable<BuildToSpecVerifyContext["runFlows"]> =
        ctx.runFlows ??
        (async ({ projectDir: pd, factoryRoot: fr }) => {
          const specifier = `../../scripts/run-synthesized-flows.mjs`;
          const mod = (await import(specifier)) as unknown as {
            runSynthesizedFlows: (args: {
              projectDir: string;
            }) => Promise<RunFlowsResult>;
          };
          // factoryRoot is unused by the runner (it doesn't shell to other
          // factory scripts) but we accept it for symmetry with reach/synth.
          void fr;
          return mod.runSynthesizedFlows({ projectDir: pd });
        });
      runResult = await runFlows({ projectDir, factoryRoot });
    } catch (err) {
      warnings.push(`run-synthesized-flows threw: ${(err as Error).message}`);
    }
    if (runResult) {
      if (!runResult.ok && runResult.reason) {
        // Soft-gate: surface as warning, don't fail the verify stage.
        warnings.push(
          `flow-execution: ${runResult.reason}${runResult.remediation ? ` (${runResult.remediation})` : ""}`,
        );
      }
      for (const w of runResult.warnings ?? []) {
        warnings.push(`flow-execution: ${w}`);
      }
      flowsPassed.push(...runResult.flows.passed);
      flowsFailed.push(...runResult.flows.failed);
    }
  }

  const flows = {
    passed: flowsPassed,
    failed: flowsFailed,
    generated: generatedFiles,
  };

  // ── feat-022 + feat-025 Phase 4: auto-file bug plans ─────────────────────
  // For each flow failure, correlate with reachability orphans by
  // owningFeature (when known): emit ONE consolidated bug plan per (flow,
  // owning-feature) tuple — the bug-plan template renders both contexts
  // together so the builder fixes the wiring + the navigation in one pass.
  const bugPlansFiled: string[] = [];
  if (ctx.autoFileBugPlans !== false) {
    const fileBugPlan: NonNullable<BuildToSpecVerifyContext["fileBugPlan"]> =
      ctx.fileBugPlan ??
      (async ({ projectDir: pd, violation, relatedOrphan }) => {
        const specifier = `../../scripts/file-bug-plan.mjs`;
        const mod = (await import(specifier)) as unknown as {
          fileBugPlan: (args: {
            projectDir: string;
            violation: BugPlanViolation;
            relatedOrphan?: OrphanComponent;
          }) => Promise<{ planId: string; planPath: string }>;
        };
        return mod.fileBugPlan(
          relatedOrphan === undefined
            ? { projectDir: pd, violation }
            : { projectDir: pd, violation, relatedOrphan },
        );
      });

    // Track orphans already consumed by a consolidated flow-failure plan
    // so we don't double-file (orphan stand-alone plan + flow plan that
    // mentions the same orphan).
    const consumedOrphanPaths = new Set<string>();

    // 1. flow-failure plans (consolidated with related orphan when matched)
    for (const failure of flowsFailed) {
      try {
        const relatedOrphan = correlateFlowFailureToOrphan(
          failure,
          orphanComponents,
        );
        if (relatedOrphan) consumedOrphanPaths.add(relatedOrphan.path);
        const args = relatedOrphan
          ? {
              projectDir,
              violation: {
                ...failure,
                kind: "flow-failure" as const,
              },
              relatedOrphan,
            }
          : {
              projectDir,
              violation: {
                ...failure,
                kind: "flow-failure" as const,
              },
            };
        const { planId } = await fileBugPlan(args);
        bugPlansFiled.push(planId);
      } catch (err) {
        warnings.push(
          `file-bug-plan failed for flow ${failure.flowId}: ${(err as Error).message}`,
        );
      }
    }

    // 2. stand-alone orphan-component plans (skip any consumed above)
    for (const orphan of orphanComponents) {
      if (consumedOrphanPaths.has(orphan.path)) continue;
      try {
        const { planId } = await fileBugPlan({
          projectDir,
          violation: { ...orphan, kind: "orphan-component" },
        });
        bugPlansFiled.push(planId);
      } catch (err) {
        warnings.push(
          `file-bug-plan failed for orphan ${orphan.path}: ${(err as Error).message}`,
        );
      }
    }
    for (const route of orphanRoutes) {
      try {
        const { planId } = await fileBugPlan({
          projectDir,
          violation: { ...route, kind: "orphan-route" },
        });
        bugPlansFiled.push(planId);
      } catch (err) {
        warnings.push(
          `file-bug-plan failed for orphan-route ${route.path}: ${(err as Error).message}`,
        );
      }
    }
  }

  const ok =
    orphanComponents.length === 0 &&
    orphanRoutes.length === 0 &&
    flows.failed.length === 0;

  const output: BuildToSpecVerifyOutputType = {
    ok,
    reachability: {
      orphanComponents,
      orphanRoutes,
      scannedFiles,
      ignoredByAllowComment,
    },
    flows,
    bugPlansFiled,
    costUsd: 0, // v1: zero LLM dispatch
    durationMs: Date.now() - startedAt,
    warnings,
  };

  // Validate before returning — guard against drift between this code +
  // the contract.
  return BuildToSpecVerifyOutput.parse(output);
}

/**
 * feat-025 Phase 4 — correlate a flow failure to an orphan component.
 *
 * Heuristic: an orphan component is "related" to a flow failure when the
 * flow's `expectedScreenId` (the screen the click should have landed on)
 * appears in the orphan's path, OR the orphan's exportNames contain a
 * component name that resembles the screen id (kebab → PascalCase).
 *
 * Examples:
 *   - flow expects "card-modal" + orphan path .../CardDetailModal.tsx
 *     → MATCH (path contains "modal" + screen contains "modal")
 *   - flow expects "settings" + orphan exports ["SettingsPanel"]
 *     → MATCH (export name contains "settings", case-insensitive)
 *
 * Returns the FIRST matching orphan or undefined. We deliberately don't
 * file multiple plans for one flow when several orphans loosely match —
 * the bug plan template handles only one related orphan, and
 * builder-feedback-loop tuning is cheaper with one plan per flow.
 */
function correlateFlowFailureToOrphan(
  failure: FlowFailure,
  orphans: readonly OrphanComponent[],
): OrphanComponent | undefined {
  const screenId = failure.expectedScreenId.toLowerCase();
  const screenSlug = screenId.replace(/-/g, "");
  for (const orphan of orphans) {
    const pathLower = orphan.path.toLowerCase();
    if (pathLower.includes(screenSlug) || pathLower.includes(screenId)) {
      return orphan;
    }
    for (const name of orphan.exportNames ?? []) {
      const nameLower = name.toLowerCase();
      if (nameLower.includes(screenSlug) || nameLower.includes(screenId)) {
        return orphan;
      }
      // Also match individual screen-id tokens against PascalCase parts
      const tokens = screenId.split("-").filter((t) => t.length >= 4);
      if (tokens.some((t) => nameLower.includes(t))) {
        return orphan;
      }
    }
  }
  return undefined;
}
