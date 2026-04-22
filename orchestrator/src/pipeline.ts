import type { PipelineStage } from "@repo/orchestrator-contracts";
import { runStage, type RunContext, type StageResult } from "./stage-runner.js";
import { STAGES } from "./stages-array.js";
import { saveState } from "./state-persistence.js";

/**
 * Gate resolution primitive. A gate is paused until this resolves. In
 * production, task-036 spins an HTTP server (gates 2 + 4) or watches
 * `docs/gate-{N}-approved.txt` (gates 1 + 3 + 5 + 6). For tests and the
 * MVP CLI dry-run we inject a stub that resolves immediately or per the
 * caller's control.
 */
export type WaitForGateFn = (args: {
  stage: PipelineStage;
  projectRoot: string;
  pipelineRunId: string;
}) => Promise<GateResolution>;

export interface GateResolution {
  approved: boolean;
  /** Free-form note from the human (stored in the pipeline output). */
  note?: string;
}

/**
 * Context snapshot primitive — task 013's `/save-context` when present.
 * MVP stub logs + no-ops. Phase 9 wires the real skill.
 */
export type SaveContextFn = (args: {
  stage: PipelineStage;
  projectRoot: string;
  pipelineRunId: string;
}) => Promise<void>;

export interface PipelineConfig {
  projectRoot: string;
  pipelineRunId: string;
  flags: readonly string[];
  runCtx: Omit<RunContext, "queryFn" | "modelConfigOverride"> &
    Pick<RunContext, "queryFn" | "modelConfigOverride">;
  stages?: readonly PipelineStage[];
  waitForGate?: WaitForGateFn;
  saveContext?: SaveContextFn;
}

export interface PipelineResult {
  mode: "design";
  stagesCompleted: string[];
  stagesFailed: string[];
  totalCostUsd: number;
  gatesOpened: string[];
  stageResults: Record<string, StageResult>;
  abortedAt?: string;
  abortReason?: string;
}

const defaultWaitForGate: WaitForGateFn = async () => ({ approved: true });
const defaultSaveContext: SaveContextFn = async () => {
  // no-op until task-013 lands
};

/**
 * Walk the Mode A `STAGES[]` in order, respecting `dependsOn`. For each
 * stage: run it, validate output, checkpoint context, pause at gate if
 * enabled, and persist state. Abort on first failure.
 *
 * Returns a PipelineResult describing the walk. On success, all
 * `STAGES.map(s => s.name)` appear in `stagesCompleted`. On failure,
 * `abortedAt` names the failing stage.
 */
export async function runPipeline(
  cfg: PipelineConfig,
): Promise<PipelineResult> {
  const stages = cfg.stages ?? STAGES;
  const waitForGate = cfg.waitForGate ?? defaultWaitForGate;
  const saveContext = cfg.saveContext ?? defaultSaveContext;

  const completed = new Set<string>();
  const failed = new Set<string>();
  const gatesOpened: string[] = [];
  const stageResults: Record<string, StageResult> = {};
  let totalCostUsd = 0;
  let abortedAt: string | undefined;
  let abortReason: string | undefined;

  for (const stage of stages) {
    // Dependency check
    const missing = (stage.dependsOn ?? []).filter((d) => !completed.has(d));
    if (missing.length > 0) {
      abortedAt = stage.name;
      abortReason = `dependsOn-unmet: missing [${missing.join(", ")}]`;
      break;
    }

    const result = await runStage(stage, {
      ...cfg.runCtx,
      projectRoot: cfg.projectRoot,
      pipelineRunId: cfg.pipelineRunId,
      flags: cfg.flags,
    });
    stageResults[stage.name] = result;
    totalCostUsd += result.costUsd;

    if (!result.success) {
      failed.add(stage.name);
      abortedAt = stage.name;
      abortReason = result.error ?? "stage-failed";
      break;
    }

    completed.add(stage.name);

    await saveContext({
      stage,
      projectRoot: cfg.projectRoot,
      pipelineRunId: cfg.pipelineRunId,
    });
    saveState(
      cfg.projectRoot,
      cfg.pipelineRunId,
      cfg.runCtx.retryCounters,
      cfg.runCtx.budget,
    );

    if (stage.gateEnabled) {
      gatesOpened.push(stage.name);
      const resolution = await waitForGate({
        stage,
        projectRoot: cfg.projectRoot,
        pipelineRunId: cfg.pipelineRunId,
      });
      if (!resolution.approved) {
        abortedAt = stage.name;
        abortReason = `gate-rejected: ${resolution.note ?? "no note"}`;
        break;
      }
    }
  }

  const out: PipelineResult = {
    mode: "design",
    stagesCompleted: [...completed],
    stagesFailed: [...failed],
    totalCostUsd,
    gatesOpened,
    stageResults,
  };
  if (abortedAt) out.abortedAt = abortedAt;
  if (abortReason) out.abortReason = abortReason;
  return out;
}
