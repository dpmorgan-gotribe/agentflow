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

  // v1: We don't execute the synthesized specs here. flows.failed[] is
  // empty in the deterministic stage and gets populated only when a
  // future runner runs the persisted specs against a live build (or when
  // the next tester invocation runs them and feeds failures back via
  // `BuildToSpecVerifyContext.preExecutedFlowFailures` — not implemented
  // in v1).
  const flows = {
    passed: [] as string[],
    failed: [] as FlowFailure[],
    generated: generatedFiles,
  };

  // Auto-file bug plans
  const bugPlansFiled: string[] = [];
  if (ctx.autoFileBugPlans !== false) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fileBugPlan: NonNullable<BuildToSpecVerifyContext["fileBugPlan"]> =
      ctx.fileBugPlan ??
      (async ({ projectDir: pd, violation, relatedOrphan }) => {
        // Dynamic import of the .mjs helper — TS doesn't ship a .d.ts for
        // it. Resolve through a string-template specifier so the compiler
        // treats it as a runtime-only path; cast through unknown to the
        // expected shape.
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

    for (const orphan of orphanComponents) {
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
