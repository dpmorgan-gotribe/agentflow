import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BudgetTracker } from "./budget-tracker.js";
import type { InvokeAgentFn } from "./feature-graph.js";
import type { WaitForGateFn } from "./pipeline.js";
import {
  detectStageCompletions,
  firstIncompleteStage,
  skillExists,
  type StageCompletion,
} from "./project-state.js";
import {
  readBudgetCaps,
  readProviderConfig,
  readStallTimeoutMode,
} from "./model-config.js";
import type { QueryFn } from "./stage-runner.js";
import { STAGES, getStage } from "./stages-array.js";

export interface CliOptions {
  projectName?: string;
  flags: string;
  resumeFromStage?: string;
  resumeFeatureGraph?: boolean;
  dryRun?: boolean;
  /** Skip gate 6 (pr-review) — wired into Mode B when live runs land. */
  autoMergeAfterReviewer?: boolean;
  /** Override Mode B's `maxConcurrentFeatures` (default 4). */
  maxConcurrent?: number;
  /**
   * feat-024 Phase D — explicit pipeline run id (used by /resume-build to
   * target the right state directory). When omitted, a fresh UUID is
   * generated as before.
   */
  pipelineRunId?: string;
  /**
   * Test hook — override Mode B's `InvokeAgentFn`. When set, the CLI uses
   * this instead of `createInvokeAgent`'s real SDK wiring. Production code
   * leaves this undefined.
   */
  invokeAgentOverride?: InvokeAgentFn;
  /**
   * Test hook — override Mode A's SDK `query()`. When set, `runPipeline`'s
   * stage-runner uses this instead of the real SDK. Production code leaves
   * this undefined.
   */
  queryFnOverride?: QueryFn;
  /**
   * Test hook — override Mode A's gate waiter. When set, replaces the
   * default file-drop watcher (which blocks on human action). Tests pass
   * an auto-approve stub.
   */
  waitForGateOverride?: WaitForGateFn;
}

export interface CliResult {
  exitCode: number;
  messages: string[];
}

/**
 * Drive the orchestrator from CLI arguments. Returns structured data
 * rather than calling `process.exit` so tests can assert on it.
 *
 * MVP scope (Phase 9):
 *   - Project resolution from `projects/<name>/`
 *   - Stage-completion detection via project-state.ts
 *   - --dry-run mode: report the walk plan + flag first missing skill
 *   - No actual Agent SDK invocation yet (wire-up in follow-up plans
 *     feat-005 architect, feat-006 pm, etc., or via direct skill calls)
 */
export async function runCli(
  opts: CliOptions,
  factoryRoot: string,
): Promise<CliResult> {
  const messages: string[] = [];
  const projectRoot = resolveProjectRoot(opts.projectName, factoryRoot);
  if (!projectRoot) {
    messages.push("No project specified and no unambiguous default found.");
    messages.push("Available projects in projects/:");
    for (const name of listProjects(factoryRoot)) messages.push(`  - ${name}`);
    messages.push(
      "Usage: pnpm generate <project-name> [--flags=...] [--dry-run]",
    );
    return { exitCode: 2, messages };
  }

  messages.push(`Project: ${projectRoot}`);
  messages.push(`Factory: ${factoryRoot}`);

  const flags = opts.flags
    ? opts.flags
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean)
    : [];
  if (flags.length > 0) messages.push(`Flags: ${flags.join(", ")}`);

  const completions = detectStageCompletions(projectRoot);
  const completedNames = completions
    .filter((c) => c.complete)
    .map((c) => c.stage);
  const pendingNames = completions
    .filter((c) => !c.complete)
    .map((c) => c.stage);
  messages.push(
    `Completed stages (${completedNames.length}): ${completedNames.join(", ") || "(none)"}`,
  );
  messages.push(
    `Pending stages   (${pendingNames.length}): ${pendingNames.join(", ")}`,
  );

  const resumeStage = opts.resumeFromStage ?? firstIncompleteStage(completions);
  if (!resumeStage) {
    messages.push(
      "All Mode A stages complete. Mode B (feature-graph) would start here — not yet implemented in CLI.",
    );
    return { exitCode: 0, messages };
  }
  messages.push(`Resume from: ${resumeStage}`);

  if (opts.resumeFromStage && opts.resumeFromStage !== resumeStage) {
    // Explicit override — honor it but warn
    messages.push(
      `(warning: --resume-from-stage=${opts.resumeFromStage} does not match auto-detected ${resumeStage})`,
    );
  }

  const caps = readBudgetCaps(projectRoot);
  const budget = new BudgetTracker(caps);
  messages.push(
    `Budget cap: ${caps.perPipelineMaxUsd.toFixed(2)} USD per pipeline`,
  );

  // feat-017: surface the active auth backend so it's obvious at run-time
  // which quota/bill the SDK calls will hit. Resolved from
  // AGENTFLOW_PROVIDER > project models.yaml > global models.yaml > default.
  const providerConfig = readProviderConfig(projectRoot);
  messages.push(`Auth provider: ${providerConfig.provider}`);

  if (opts.dryRun) {
    messages.push("");
    messages.push("--- DRY RUN ---");
    const walk = simulateWalk(factoryRoot, completions, resumeStage);
    for (const entry of walk.lines) messages.push(entry);
    if (walk.firstMissingSkill) {
      messages.push("");
      messages.push(
        `Pipeline would halt at stage '${walk.firstMissingSkill.stage}' because ` +
          `'${walk.firstMissingSkill.slashCommand}' resolves to skill '${walk.firstMissingSkill.skillName}' ` +
          `which does not exist at .claude/skills/${walk.firstMissingSkill.skillName}/SKILL.md.`,
      );
      messages.push(
        `See build-tier-roadmap.md for the plan that ships this skill (look for '${walk.firstMissingSkill.skillName}').`,
      );
    } else {
      messages.push("");
      messages.push(
        "All remaining stages have their skills registered. Real invocation would start here.",
      );
    }
    messages.push(
      `Cumulative spend: ${budget.getCumulative().toFixed(2)} USD (dry-run — nothing was invoked)`,
    );
    return { exitCode: 0, messages };
  }

  // ── Live run ─────────────────────────────────────────────────────
  messages.push("");
  messages.push("Ready to invoke.");

  const { runPipeline, fileDropWaitForGate } = await import("./pipeline.js");
  const { runFeatureGraph } = await import("./feature-graph.js");
  const { createInvokeAgent } = await import("./invoke-agent.js");
  const { RetryCounters } = await import("./retry-counters.js");
  const { randomUUID } = await import("node:crypto");
  const { writeOrchestratorPid } = await import("./pause.js");

  const pipelineRunId = opts.pipelineRunId ?? randomUUID();

  // feat-024 Phase C: register the active pause-context globally so the
  // SIGINT handler in cli.ts can write paused.json. Idempotent set.
  (
    globalThis as unknown as {
      __agentflowActivePauseCtx?: {
        projectRoot: string;
        pipelineRunId: string;
        authProvider: string;
      };
    }
  ).__agentflowActivePauseCtx = {
    projectRoot,
    pipelineRunId,
    authProvider: providerConfig.provider,
  };
  // feat-024 Phase C: drop orchestrator.pid so /pause-build --hard can SIGINT.
  writeOrchestratorPid(projectRoot, pipelineRunId);

  const retryCounters = new RetryCounters();
  const stallMode = readStallTimeoutMode(projectRoot);
  // feat-024 Phase C: in strict mode, route stall aborts through pauseRun
  // (writes paused.json + throws PauseSignal). In lenient mode (default),
  // the abort just fails the feature and the run continues.
  const stallPauseHook =
    stallMode === "strict"
      ? async (info: {
          agent: string;
          featureId: string;
          abortReason: string;
        }) => {
          const { pauseRun } = await import("./pause.js");
          await pauseRun(
            {
              projectRoot,
              pipelineRunId,
              authProvider: providerConfig.provider,
            },
            "stall-timeout",
            `${info.agent} on ${info.featureId}: ${info.abortReason}`,
            { drained: false },
          );
        }
      : undefined;
  // Same for rate-limit / auth-failed (always pause — these are explicit
  // hard signals from the SDK, not heuristic).
  const ratePauseHook = async (info: {
    rateLimitType: string;
    resetsAt?: number;
  }) => {
    const { pauseRun } = await import("./pause.js");
    const reason =
      info.rateLimitType === "five_hour"
        ? "claude-max-five-hour-limit"
        : "claude-max-seven-day-limit";
    await pauseRun(
      {
        projectRoot,
        pipelineRunId,
        authProvider: providerConfig.provider,
      },
      reason as "claude-max-five-hour-limit" | "claude-max-seven-day-limit",
      `SDKRateLimitEvent rateLimitType=${info.rateLimitType}`,
      info.resetsAt !== undefined
        ? { drained: false, resetsAt: info.resetsAt }
        : { drained: false },
    );
  };
  const authPauseHook = async (info: { detail: string }) => {
    const { pauseRun } = await import("./pause.js");
    await pauseRun(
      {
        projectRoot,
        pipelineRunId,
        authProvider: providerConfig.provider,
      },
      "auth-failed",
      info.detail,
      { drained: false },
    );
  };

  const invokeAgent: InvokeAgentFn =
    opts.invokeAgentOverride ??
    createInvokeAgent({
      projectRoot,
      budget,
      flags,
      pipelineRunId,
      ...(stallPauseHook ? { onStallTimeoutPause: stallPauseHook } : {}),
      onRateLimitPause: ratePauseHook,
      onAuthFailedPause: authPauseHook,
    });

  if (opts.resumeFeatureGraph) {
    const { loadTasksYaml } = await import("./tasks-loader.js");
    let tasks;
    try {
      tasks = loadTasksYaml(projectRoot);
    } catch (err) {
      messages.push(
        `Failed to load docs/tasks.yaml: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { exitCode: 1, messages };
    }
    const graphCtx: Parameters<typeof runFeatureGraph>[1] = {
      projectRoot,
      pipelineRunId,
      budget,
      retryCounters,
      invokeAgent,
      authProvider: providerConfig.provider,
      ...(opts.autoMergeAfterReviewer ? { autoMergeAfterReviewer: true } : {}),
      ...(opts.maxConcurrent
        ? { maxConcurrentFeatures: opts.maxConcurrent }
        : {}),
    };
    const result = await runFeatureGraph(tasks, graphCtx);
    messages.push(`Features completed: ${result.completed.length}`);
    messages.push(`Features failed:    ${result.failed.length}`);
    messages.push(`Total cost:         $${result.totalCostUsd.toFixed(2)}`);
    if (result.failed.length > 0) {
      messages.push("");
      messages.push("Failed features:");
      for (const id of result.failed) {
        const fr = result.featureResults[id];
        const reason = fr?.abortReason ?? "(no reason recorded)";
        messages.push(`  ✗ ${id} — ${reason}`);
      }
    }
    return {
      exitCode: result.failed.length > 0 ? 1 : 0,
      messages,
    };
  }

  // Mode A — slice STAGES starting at resumeStage. Strip the first
  // stage's `dependsOn` since earlier stages are presumed satisfied
  // (detected via project-state.ts).
  const startIdx = STAGES.findIndex((s) => s.name === resumeStage);
  if (startIdx < 0) {
    messages.push(`Unknown stage '${resumeStage}' — cannot resume.`);
    return { exitCode: 1, messages };
  }
  const stages = STAGES.slice(startIdx).map((s, i) => {
    if (i === 0) {
      const { dependsOn: _omit, ...rest } = s;
      void _omit;
      return rest;
    }
    return s;
  });

  const runCtx: Parameters<typeof runPipeline>[0]["runCtx"] = {
    projectRoot,
    pipelineRunId,
    budget,
    retryCounters,
    flags,
    ...(opts.queryFnOverride ? { queryFn: opts.queryFnOverride } : {}),
  };
  const result = await runPipeline({
    projectRoot,
    pipelineRunId,
    flags,
    runCtx,
    stages,
    waitForGate: opts.waitForGateOverride ?? fileDropWaitForGate(),
  });
  messages.push(`Stages completed: ${result.stagesCompleted.length}`);
  messages.push(`Stages failed:    ${result.stagesFailed.length}`);
  messages.push(`Total cost:       $${result.totalCostUsd.toFixed(2)}`);
  if (result.abortedAt) {
    messages.push(
      `Aborted at:       ${result.abortedAt} (${result.abortReason ?? "?"})`,
    );
  }
  return {
    exitCode: result.stagesFailed.length > 0 ? 1 : 0,
    messages,
  };
}

function resolveProjectRoot(
  name: string | undefined,
  factoryRoot: string,
): string | null {
  const projectsDir = join(factoryRoot, "projects");
  if (!existsSync(projectsDir)) return null;
  if (name) {
    const candidate = join(projectsDir, name);
    return existsSync(candidate) ? candidate : null;
  }
  const names = listProjects(factoryRoot);
  if (names.length === 1) return join(projectsDir, names[0]!);
  return null;
}

function listProjects(factoryRoot: string): string[] {
  const projectsDir = join(factoryRoot, "projects");
  if (!existsSync(projectsDir)) return [];
  return readdirSync(projectsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

interface WalkLine {
  stage: string;
  status: string;
  skillExists: boolean;
}

interface WalkResult {
  lines: string[];
  firstMissingSkill?: {
    stage: string;
    slashCommand: string;
    skillName: string;
  };
}

function simulateWalk(
  factoryRoot: string,
  completions: readonly StageCompletion[],
  resumeStage: string,
): WalkResult {
  const lines: string[] = ["Stage walk:"];
  const completionByStage = new Map<string, StageCompletion>(
    completions.map((c) => [c.stage, c]),
  );
  let firstMissingSkill: WalkResult["firstMissingSkill"];
  let reached = false;

  for (const stage of STAGES) {
    const completion = completionByStage.get(stage.name);
    if (!reached && stage.name !== resumeStage) {
      if (completion?.complete) {
        lines.push(
          `  ✓ ${stage.name} — already complete (${completion.artifactPath})`,
        );
      } else {
        lines.push(`  · ${stage.name} — skipped (earlier than resume point)`);
      }
      continue;
    }
    reached = true;
    const skillName =
      stage.slashCommand.replace(/^\//, "").split(/\s+/)[0] ?? "";
    const present = skillExists(factoryRoot, stage.slashCommand);
    const gate = stage.gateEnabled ? ` [gate: ${stage.gateType}]` : "";
    if (present) {
      lines.push(
        `  → ${stage.name} — skill present at .claude/skills/${skillName}${gate}`,
      );
    } else {
      lines.push(
        `  ✗ ${stage.name} — skill MISSING (.claude/skills/${skillName}/SKILL.md)${gate}`,
      );
      if (!firstMissingSkill) {
        firstMissingSkill = {
          stage: stage.name,
          slashCommand: stage.slashCommand,
          skillName,
        };
      }
    }
  }

  const _walkLines: WalkLine[] = [];
  void _walkLines;
  const result: WalkResult = { lines };
  if (firstMissingSkill) result.firstMissingSkill = firstMissingSkill;
  return result;
}

// re-export for direct consumers
export { getStage };
