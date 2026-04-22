import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";

/**
 * Resolved config for one agent invocation.
 *
 * `model` is the SDK model identifier. `effort` maps to the Agent SDK's
 * extended-thinking setting (`low | medium | high | max`). `budgetUsd` is a
 * soft per-invocation hint — the hard per-stage cap lives on
 * `PipelineStage.budgetUsd`, and the pipeline-wide ceiling is enforced by
 * `BudgetTracker` via `perPipelineMaxUsd`.
 */
export interface ModelConfig {
  model: string;
  effort: "low" | "medium" | "high" | "max";
  budgetUsd: number;
}

export interface BudgetCaps {
  perPipelineMaxUsd: number;
  perStageMaxUsd: Record<string, number>;
}

interface RawYaml {
  version?: string;
  extends?: string;
  defaults?: Record<string, string>;
  agents?: Record<
    string,
    Partial<{
      tier: string;
      model: string;
      effort: ModelConfig["effort"];
      budgetUsd: number;
    }>
  >;
  budget?: {
    perPipelineMaxUsd?: number;
    perStageMaxUsd?: Record<string, number>;
  };
}

const DEFAULT_EFFORT: ModelConfig["effort"] = "medium";
const DEFAULT_BUDGET_USD = 5;
const DEFAULT_PIPELINE_MAX_USD = 150;

function loadYaml(path: string): RawYaml {
  if (!existsSync(path)) return {};
  const parsed = yaml.load(readFileSync(path, "utf8"));
  return (parsed ?? {}) as RawYaml;
}

/**
 * Read + merge `~/.claude/models.yaml` (global) with
 * `<projectRoot>/.claude/models.yaml` (project). Project wins.
 *
 * `agentName` selects the agent entry; tier→model lookup uses the merged
 * `defaults` map. `ANTHROPIC_MODEL` env var overrides the resolved model
 * as the final escape hatch (CLAUDE.md rule).
 */
export function readModelConfig(
  agentName: string,
  projectRoot: string,
  opts?: { globalPath?: string; projectPath?: string },
): ModelConfig {
  const globalPath =
    opts?.globalPath ?? join(homedir(), ".claude", "models.yaml");
  const projectPath =
    opts?.projectPath ?? join(projectRoot, ".claude", "models.yaml");

  const globalCfg = loadYaml(globalPath);
  const projectCfg = loadYaml(projectPath);

  const mergedDefaults: Record<string, string> = {
    ...(globalCfg.defaults ?? {}),
    ...(projectCfg.defaults ?? {}),
  };

  const globalAgent = globalCfg.agents?.[agentName] ?? {};
  const projectAgent = projectCfg.agents?.[agentName] ?? {};
  const agent = { ...globalAgent, ...projectAgent };

  let model: string | undefined;
  if (process.env.ANTHROPIC_MODEL) {
    model = process.env.ANTHROPIC_MODEL;
  } else if (agent.model) {
    model = agent.model;
  } else if (agent.tier && mergedDefaults[agent.tier]) {
    model = mergedDefaults[agent.tier];
  }

  if (!model) {
    throw new Error(
      `No model resolved for agent '${agentName}'. ` +
        `Set ~/.claude/models.yaml agents.${agentName}.tier (with a matching defaults entry) ` +
        `or a direct model override, or ANTHROPIC_MODEL env var.`,
    );
  }

  const effort = agent.effort ?? DEFAULT_EFFORT;
  const budgetUsd = agent.budgetUsd ?? DEFAULT_BUDGET_USD;

  return { model, effort, budgetUsd };
}

/**
 * Read the merged budget caps. Used by `BudgetTracker` at pipeline startup.
 * Project values override global; missing keys fall back to defaults.
 */
export function readBudgetCaps(
  projectRoot: string,
  opts?: { globalPath?: string; projectPath?: string },
): BudgetCaps {
  const globalPath =
    opts?.globalPath ?? join(homedir(), ".claude", "models.yaml");
  const projectPath =
    opts?.projectPath ?? join(projectRoot, ".claude", "models.yaml");

  const globalCfg = loadYaml(globalPath);
  const projectCfg = loadYaml(projectPath);

  const perPipelineMaxUsd =
    projectCfg.budget?.perPipelineMaxUsd ??
    globalCfg.budget?.perPipelineMaxUsd ??
    DEFAULT_PIPELINE_MAX_USD;

  const perStageMaxUsd: Record<string, number> = {
    ...(globalCfg.budget?.perStageMaxUsd ?? {}),
    ...(projectCfg.budget?.perStageMaxUsd ?? {}),
  };

  return { perPipelineMaxUsd, perStageMaxUsd };
}
