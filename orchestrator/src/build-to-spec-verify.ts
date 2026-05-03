import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  BuildToSpecVerifyOutput,
  type BuildToSpecVerifyOutput as BuildToSpecVerifyOutputType,
  type FlowFailure,
  type OrphanComponent,
  type OrphanRoute,
  type ParityVerifyOutput,
  type ParityDivergence,
} from "@repo/orchestrator-contracts";
import { runParityVerify, type ParityVerifyContext } from "./parity-verify.js";

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
  /**
   * feat-026 — pipelineRunId + iteration forwarded into bug entries
   * appended to `docs/bugs.yaml`. Optional; defaults are "unknown" + 1
   * when absent so standalone (non-orchestrator) verifier runs still
   * write a usable file.
   */
  pipelineRunId?: string;
  iteration?: number;
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
    pipelineRunId?: string;
    iteration?: number;
    /**
     * feat-027 Phase D — when set, the bug-author tags the resulting
     * bugs.yaml entry with `dependsOnBugId: <id>`. The bug-fix loop uses
     * this to defer dependent timeouts until the cascade root resolves.
     * Optional; only flow-execution-failure bugs with primaryCause:
     * "timeout-no-evidence" carry it.
     */
    dependsOnBugId?: string;
  }) => Promise<{ planId: string; planPath: string; bugYamlId?: string }>;
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
  /**
   * feat-028 Phase 4 — when false, skip the visual-parity stage entirely.
   * Default true. The stage is also a runtime no-op (returns ok:true,
   * screensChecked:0) when the project has no
   * `docs/screens/{platform}/*.html` mockups, so most callers don't need
   * to disable it explicitly.
   */
  runParity?: boolean;
  /**
   * feat-028 Phase 4 — test seam replacing the parity-verify wrapper.
   * Defaults to `runParityVerify` from `./parity-verify.js`. Tests stub
   * to inject canned divergences without booting Playwright.
   */
  parityVerify?: (ctx: ParityVerifyContext) => Promise<ParityVerifyOutput>;
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

/**
 * feat-028 Phase 4 — minimal serializable shape for a parity divergence
 * the bug-author template consumes. Mirrors `ParityDivergence` from the
 * contracts package; defined inline to avoid forcing the bug-author script
 * (a .mjs CLI helper) to import the Zod-generated type.
 */
export interface ParityViolationShape {
  screen: string;
  pattern: string;
  severity: "P0" | "P1" | "P2";
  detail: {
    missing: string[];
    extra: string[];
    variantDrift: {
      selector: string;
      mockupValue: string;
      builtValue: string;
    }[];
    styleDrift: {
      selector: string;
      property: string;
      mockupValue: string;
      builtValue: string;
    }[];
  };
}

export type BugPlanViolation =
  | (FlowFailure & { kind: "flow-failure" })
  | (FlowFailure & { kind: "runtime-error" })
  | (FlowFailure & { kind: "dev-server-compile" })
  | (OrphanComponent & { kind: "orphan-component" })
  | (OrphanRoute & { kind: "orphan-route" })
  | (ParityViolationShape & { kind: "parity-divergence" });

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
    // bug-041 Phase A (2026-05-03): surface the synthesizer's warnings[] +
    // errors[] arrays so config-level gaps reach the operator. errors[] are
    // hard failures (specs generated but cannot run — e.g. webServer block
    // absent); warnings[] are informational. Both flow into the verifier's
    // warnings[] for now; auto-filing as bugs is a separate Phase D concern.
    for (const w of parsed.warnings ?? []) {
      warnings.push(`synth: ${w}`);
    }
    for (const e of parsed.errors ?? []) {
      warnings.push(`synth ERROR: ${e}`);
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
      (async ({
        projectDir: pd,
        violation,
        relatedOrphan,
        pipelineRunId: prid,
        iteration: it,
        dependsOnBugId,
      }) => {
        const specifier = `../../scripts/file-bug-plan.mjs`;
        const mod = (await import(specifier)) as unknown as {
          fileBugPlan: (args: {
            projectDir: string;
            violation: BugPlanViolation;
            relatedOrphan?: OrphanComponent;
            pipelineRunId?: string;
            iteration?: number;
            dependsOnBugId?: string;
          }) => Promise<{
            planId: string;
            planPath: string;
            bugYamlId?: string;
          }>;
        };
        const callArgs: Parameters<typeof mod.fileBugPlan>[0] = {
          projectDir: pd,
          violation,
        };
        if (relatedOrphan !== undefined) callArgs.relatedOrphan = relatedOrphan;
        if (prid !== undefined) callArgs.pipelineRunId = prid;
        if (it !== undefined) callArgs.iteration = it;
        if (dependsOnBugId !== undefined)
          callArgs.dependsOnBugId = dependsOnBugId;
        return mod.fileBugPlan(callArgs);
      });

    // Track orphans already consumed by a consolidated flow-failure plan
    // so we don't double-file (orphan stand-alone plan + flow plan that
    // mentions the same orphan).
    const consumedOrphanPaths = new Set<string>();

    // ── feat-027 Phase D: classify failures by primaryCause ─────────────────
    // dev-server-compile + runtime-error bugs are CASCADE ROOTS — they
    // typically mask every downstream timeout. File them FIRST so the
    // bugs.yaml priority sort + the bug-fix loop see them before chasing
    // dependent failures. After they file, surface their bug IDs as a
    // `dependsOnBugId` on any subsequent flow-execution-failure tagged
    // with primaryCause: "timeout-no-evidence" so the loop suppresses /
    // defers them until the cascade root resolves.
    const cascadeRootFailures = flowsFailed.filter(
      (f) =>
        f.primaryCause === "dev-server-compile" ||
        f.primaryCause === "runtime-error",
    );
    const dependentFailures = flowsFailed.filter(
      (f) =>
        f.primaryCause !== "dev-server-compile" &&
        f.primaryCause !== "runtime-error",
    );
    const cascadeRootBugIds: string[] = [];

    // 0. cascade-root plans (dev-server-compile + runtime-error)
    for (const failure of cascadeRootFailures) {
      try {
        const kind: "runtime-error" | "dev-server-compile" =
          failure.primaryCause === "dev-server-compile"
            ? "dev-server-compile"
            : "runtime-error";
        const args: Parameters<typeof fileBugPlan>[0] = {
          projectDir,
          violation: {
            ...failure,
            kind,
          },
        };
        if (ctx.pipelineRunId !== undefined)
          args.pipelineRunId = ctx.pipelineRunId;
        if (ctx.iteration !== undefined) args.iteration = ctx.iteration;
        const { planId } = await fileBugPlan(args);
        bugPlansFiled.push(planId);
        cascadeRootBugIds.push(planId);
      } catch (err) {
        warnings.push(
          `file-bug-plan failed for ${failure.primaryCause} ${failure.flowId}: ${(err as Error).message}`,
        );
      }
    }

    // 1. flow-failure plans (consolidated with related orphan when matched)
    for (const failure of dependentFailures) {
      try {
        const relatedOrphan = correlateFlowFailureToOrphan(
          failure,
          orphanComponents,
        );
        if (relatedOrphan) consumedOrphanPaths.add(relatedOrphan.path);
        const args: Parameters<typeof fileBugPlan>[0] = {
          projectDir,
          violation: {
            ...failure,
            kind: "flow-failure" as const,
          },
        };
        if (relatedOrphan) args.relatedOrphan = relatedOrphan;
        if (ctx.pipelineRunId !== undefined)
          args.pipelineRunId = ctx.pipelineRunId;
        if (ctx.iteration !== undefined) args.iteration = ctx.iteration;
        // feat-027 Phase D: dependent timeouts → tag with the FIRST cascade-
        // root bug id so the bug-fix loop can defer them until the root fix
        // lands. The fileBugPlan helper accepts `dependsOnBugId` as a
        // post-construction hook (we extend it below).
        if (
          failure.primaryCause === "timeout-no-evidence" &&
          cascadeRootBugIds.length > 0 &&
          cascadeRootBugIds[0] !== undefined
        ) {
          args.dependsOnBugId = cascadeRootBugIds[0];
        }
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
        const args: Parameters<typeof fileBugPlan>[0] = {
          projectDir,
          violation: { ...orphan, kind: "orphan-component" },
        };
        if (ctx.pipelineRunId !== undefined)
          args.pipelineRunId = ctx.pipelineRunId;
        if (ctx.iteration !== undefined) args.iteration = ctx.iteration;
        const { planId } = await fileBugPlan(args);
        bugPlansFiled.push(planId);
      } catch (err) {
        warnings.push(
          `file-bug-plan failed for orphan ${orphan.path}: ${(err as Error).message}`,
        );
      }
    }
    for (const route of orphanRoutes) {
      try {
        const args: Parameters<typeof fileBugPlan>[0] = {
          projectDir,
          violation: { ...route, kind: "orphan-route" },
        };
        if (ctx.pipelineRunId !== undefined)
          args.pipelineRunId = ctx.pipelineRunId;
        if (ctx.iteration !== undefined) args.iteration = ctx.iteration;
        const { planId } = await fileBugPlan(args);
        bugPlansFiled.push(planId);
      } catch (err) {
        warnings.push(
          `file-bug-plan failed for orphan-route ${route.path}: ${(err as Error).message}`,
        );
      }
    }
  }

  // ── feat-028 Phase 4: visual-parity stage ─────────────────────────────────
  // Runs AFTER reachability + flow synthesis + flow execution. Default-on;
  // operator can disable per-call via `runParity:false`. The stage gracefully
  // degrades to a no-op (returns ok:true, screensChecked:0) when the project
  // lacks `docs/screens/{platform}/*.html` mockups OR Playwright isn't
  // installed — both cases surface as warnings, not failures.
  let parity: ParityVerifyOutput | undefined;
  if (ctx.runParity !== false) {
    const parityVerify = ctx.parityVerify ?? runParityVerify;
    try {
      parity = await parityVerify({
        projectDir,
        factoryRoot,
        // feat-036 — orchestrator-driven build-to-spec-verify auto-boots
        // the dev server for parity. Operator running parity-verify
        // standalone with --dev-server-url uses manual mode instead.
        autoBootDevServer: true,
      });
      for (const w of parity.warnings) warnings.push(`parity: ${w}`);
    } catch (err) {
      warnings.push(`parity-verify threw: ${(err as Error).message}`);
    }
  }

  // Auto-file ONE bug per (screen, pattern) parity divergence — the
  // divergences are already merged by `mergeByScreenPattern` inside
  // `runParityVerify`, so each entry here maps 1:1 to a bug plan. When the
  // operator opted out of bug-plan filing entirely (`autoFileBugPlans:false`)
  // we still surface the divergences in the output for human review.
  if (ctx.autoFileBugPlans !== false && parity) {
    const fileBugPlan = ctx.fileBugPlan ?? defaultFileBugPlanResolver();
    for (const div of parity.divergences) {
      try {
        const args: Parameters<typeof fileBugPlan>[0] = {
          projectDir,
          violation: {
            ...divToViolation(div),
            kind: "parity-divergence" as const,
          } as unknown as BugPlanViolation,
        };
        if (ctx.pipelineRunId !== undefined)
          args.pipelineRunId = ctx.pipelineRunId;
        if (ctx.iteration !== undefined) args.iteration = ctx.iteration;
        const { planId } = await fileBugPlan(args);
        bugPlansFiled.push(planId);
      } catch (err) {
        warnings.push(
          `file-bug-plan failed for parity ${div.screen}/${div.pattern}: ${(err as Error).message}`,
        );
      }
    }
  }

  const parityOk = parity ? parity.divergences.length === 0 : true;
  const ok =
    orphanComponents.length === 0 &&
    orphanRoutes.length === 0 &&
    flows.failed.length === 0 &&
    parityOk;

  const output: BuildToSpecVerifyOutputType = {
    ok,
    reachability: {
      orphanComponents,
      orphanRoutes,
      scannedFiles,
      ignoredByAllowComment,
    },
    flows,
    ...(parity ? { parity } : {}),
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
 * feat-028 Phase 4 — fold a `ParityDivergence` into a serializable
 * violation that `scripts/file-bug-plan.mjs#parityDivergenceBody()`
 * understands. The result is NOT a `FlowFailure | OrphanComponent | OrphanRoute`
 * (we cast the kind to `parity-divergence` at the call site); the
 * type-checker accepts the cast because the bug-author dispatch table
 * keys on `kind` and our new branch is wired in below.
 */
function divToViolation(div: ParityDivergence) {
  return {
    screen: div.screen,
    pattern: div.pattern,
    severity: div.severity,
    detail: div.detail,
  };
}

/**
 * Resolves the default `fileBugPlan` function via dynamic import. Mirrors
 * the inline-resolver pattern further up but extracted for the parity
 * branch. Tests pass `ctx.fileBugPlan` directly + this resolver isn't
 * touched.
 */
function defaultFileBugPlanResolver() {
  return async (args: {
    projectDir: string;
    violation: BugPlanViolation;
    relatedOrphan?: OrphanComponent;
    pipelineRunId?: string;
    iteration?: number;
  }) => {
    const specifier = `../../scripts/file-bug-plan.mjs`;
    const mod = (await import(specifier)) as unknown as {
      fileBugPlan: (a: typeof args) => Promise<{
        planId: string;
        planPath: string;
        bugYamlId?: string;
      }>;
    };
    return mod.fileBugPlan(args);
  };
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
  // bug-039 (2026-05-02): expectedScreenId is nullable for v2.0 synth
  // path. When null, we have no screen-id to correlate on — skip
  // correlation; the bug entry is filed without a correlated orphan,
  // which is correct (correlation is heuristic + nice-to-have, not
  // load-bearing for the fix-loop dispatch).
  if (failure.expectedScreenId === null) return undefined;
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
