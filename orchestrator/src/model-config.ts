import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Provider, type ProviderConfig } from "@repo/orchestrator-contracts";
import yaml from "js-yaml";

/**
 * Resolved config for one agent invocation.
 *
 * `model` is the SDK model identifier. `effort` maps to the Agent SDK's
 * extended-thinking setting (`low | medium | high | max`). `budgetUsd` is a
 * soft per-invocation hint — the hard per-stage cap lives on
 * `PipelineStage.budgetUsd`, and the pipeline-wide ceiling is enforced by
 * `BudgetTracker` via `perPipelineMaxUsd`.
 *
 * `provider` + `providerConfig` carry the auth-backend selection (feat-017).
 * They're resolved from the same YAML files via a top-level `provider:` key;
 * see docs/agent-sdk-auth-providers.md for precedence + semantics.
 */
export interface ModelConfig {
  provider: Provider;
  providerConfig: ProviderConfig;
  model: string;
  effort: "low" | "medium" | "high" | "max";
  budgetUsd: number;
  /**
   * feat-024 Phase B — wall-clock + keepalive abort budget for one
   * `runLlmAgent` invocation. `null` means "never abort by liveness"
   * (used by git-agent which doesn't actually call the SDK). Defaults
   * documented in `.claude/models.yaml` template:
   *   - backend-builder, web-frontend-builder, mobile-frontend-builder: 25*60*1000
   *   - tester: 20*60*1000
   *   - reviewer, security: 10*60*1000
   *   - git-agent: null
   */
  stallTimeoutMs: number | null;
}

export interface BudgetCaps {
  perPipelineMaxUsd: number;
  perStageMaxUsd: Record<string, number>;
}

interface RawYaml {
  version?: string;
  extends?: string;
  /** Top-level auth provider selection (feat-017). */
  provider?: string;
  /** For `anthropic-api`: env var name holding the key. */
  apiKeyEnvVar?: string;
  /** For `bedrock`: AWS region override. */
  awsRegion?: string;
  /** For `vertex`: GCP project override. */
  gcpProject?: string;
  defaults?: Record<string, string>;
  agents?: Record<
    string,
    Partial<{
      tier: string;
      model: string;
      effort: ModelConfig["effort"];
      budgetUsd: number;
      /**
       * feat-024 Phase B — `null` (or omitted) inherits from
       * `defaults.stallTimeoutMs.<agent>` (project YAML) or the
       * built-in fallback in DEFAULT_STALL_TIMEOUT_BY_AGENT below.
       */
      stallTimeoutMs: number | null;
    }>
  >;
  /**
   * feat-024 Phase B + feat-024 Phase C: top-level liveness defaults.
   * `stallTimeoutMs` is the per-agent wall-clock + keepalive budget.
   * `stallTimeoutMode` selects "lenient" (default) → mark feature
   * failed and continue, or "strict" → trigger a pause via paused.json
   * so the operator can intervene.
   */
  stallTimeoutMs?: Record<string, number | null>;
  stallTimeoutMode?: "lenient" | "strict";
  budget?: {
    perPipelineMaxUsd?: number;
    perStageMaxUsd?: Record<string, number>;
  };
}

const DEFAULT_EFFORT: ModelConfig["effort"] = "medium";
const DEFAULT_BUDGET_USD = 5;
const DEFAULT_PIPELINE_MAX_USD = 150;

/**
 * feat-024 Phase B factory defaults for `stallTimeoutMs`. Mirrors the
 * recommendation in investigate-007 §F4-#1 — builders get more headroom
 * than testers/reviewers, git-agent is exempt entirely (deterministic
 * git ops, no SDK call). Override per-agent in the project's
 * `.claude/models.yaml` under `stallTimeoutMs:` or per-agent
 * `agents.<name>.stallTimeoutMs`.
 */
const DEFAULT_STALL_TIMEOUT_BY_AGENT: Record<string, number | null> = {
  "backend-builder": 25 * 60 * 1000,
  "web-frontend-builder": 25 * 60 * 1000,
  "mobile-frontend-builder": 25 * 60 * 1000,
  tester: 20 * 60 * 1000,
  reviewer: 10 * 60 * 1000,
  security: 10 * 60 * 1000,
  "git-agent": null,
};

/**
 * Factory default auth provider. Subscription mode is chosen so the factory
 * operator's Claude Max quota covers SDK calls (zero incremental cost). A
 * public-product distribution can override this build-time constant in
 * `orchestrator/src/defaults.ts` — see docs/agent-sdk-auth-providers.md
 * §"Public product release path".
 */
const FACTORY_DEFAULT_PROVIDER: Provider = "claude-max-subscription";

function loadYaml(path: string): RawYaml {
  if (!existsSync(path)) return {};
  const parsed = yaml.load(readFileSync(path, "utf8"));
  return (parsed ?? {}) as RawYaml;
}

/**
 * Resolve the auth-provider config from merged YAML + env.
 *
 * Precedence (highest → lowest):
 *   1. `process.env.AGENTFLOW_PROVIDER` — session-level override
 *   2. `<projectRoot>/.claude/models.yaml` top-level `provider:`
 *   3. `~/.claude/models.yaml` top-level `provider:`
 *   4. Factory fallback: `claude-max-subscription`
 *
 * Provider-specific fields (`apiKeyEnvVar`, `awsRegion`, `gcpProject`) are
 * resolved project-wins from the same files. An invalid provider value
 * (typo, unknown enum) throws a clear zod validation error.
 */
function resolveProviderConfig(
  globalCfg: RawYaml,
  projectCfg: RawYaml,
): ProviderConfig {
  const envOverride = process.env.AGENTFLOW_PROVIDER;
  const rawProvider =
    envOverride ??
    projectCfg.provider ??
    globalCfg.provider ??
    FACTORY_DEFAULT_PROVIDER;

  const parseResult = Provider.safeParse(rawProvider);
  if (!parseResult.success) {
    const validValues = Provider.options.join(", ");
    const source = envOverride
      ? "AGENTFLOW_PROVIDER env var"
      : projectCfg.provider
        ? "project .claude/models.yaml `provider:`"
        : "global ~/.claude/models.yaml `provider:`";
    throw new Error(
      `Invalid auth provider '${rawProvider}' from ${source}. ` +
        `Valid values: ${validValues}. ` +
        `See docs/agent-sdk-auth-providers.md.`,
    );
  }

  const apiKeyEnvVar = projectCfg.apiKeyEnvVar ?? globalCfg.apiKeyEnvVar;
  const awsRegion = projectCfg.awsRegion ?? globalCfg.awsRegion;
  const gcpProject = projectCfg.gcpProject ?? globalCfg.gcpProject;

  return {
    provider: parseResult.data,
    ...(apiKeyEnvVar ? { apiKeyEnvVar } : {}),
    ...(awsRegion ? { awsRegion } : {}),
    ...(gcpProject ? { gcpProject } : {}),
  };
}

/**
 * Read + merge `~/.claude/models.yaml` (global) with
 * `<projectRoot>/.claude/models.yaml` (project). Project wins.
 *
 * `agentName` selects the agent entry; tier→model lookup uses the merged
 * `defaults` map. `ANTHROPIC_MODEL` env var overrides the resolved model
 * as the final escape hatch (CLAUDE.md rule).
 *
 * Returns `{ provider, providerConfig, model, effort, budgetUsd }`; auth
 * backend selection is per-run (not per-agent) — see
 * docs/agent-sdk-auth-providers.md.
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

  // feat-024 Phase B: resolve stallTimeoutMs per agent. Precedence
  //   1. agent.stallTimeoutMs in project YAML
  //   2. agent.stallTimeoutMs in global YAML
  //   3. project YAML's top-level `stallTimeoutMs.<agent>` map
  //   4. global YAML's top-level `stallTimeoutMs.<agent>` map
  //   5. built-in `DEFAULT_STALL_TIMEOUT_BY_AGENT[agent]`
  //   6. `null` (never abort by liveness) for unmapped agents
  // `null` explicitly disables; missing means "fall through".
  let stallTimeoutMs: number | null = null;
  if (agent.stallTimeoutMs !== undefined) {
    stallTimeoutMs = agent.stallTimeoutMs;
  } else if (projectCfg.stallTimeoutMs?.[agentName] !== undefined) {
    stallTimeoutMs = projectCfg.stallTimeoutMs[agentName] ?? null;
  } else if (globalCfg.stallTimeoutMs?.[agentName] !== undefined) {
    stallTimeoutMs = globalCfg.stallTimeoutMs[agentName] ?? null;
  } else if (agentName in DEFAULT_STALL_TIMEOUT_BY_AGENT) {
    stallTimeoutMs = DEFAULT_STALL_TIMEOUT_BY_AGENT[agentName] ?? null;
  }

  const providerConfig = resolveProviderConfig(globalCfg, projectCfg);

  return {
    provider: providerConfig.provider,
    providerConfig,
    model,
    effort,
    budgetUsd,
    stallTimeoutMs,
  };
}

/** feat-024 Phase C — read the `stallTimeoutMode` setting (default lenient). */
export function readStallTimeoutMode(
  projectRoot: string,
  opts?: { globalPath?: string; projectPath?: string },
): "lenient" | "strict" {
  const globalPath =
    opts?.globalPath ?? join(homedir(), ".claude", "models.yaml");
  const projectPath =
    opts?.projectPath ?? join(projectRoot, ".claude", "models.yaml");
  const globalCfg = loadYaml(globalPath);
  const projectCfg = loadYaml(projectPath);
  return projectCfg.stallTimeoutMode ?? globalCfg.stallTimeoutMode ?? "lenient";
}

/**
 * Read the resolved auth-provider config without resolving a specific
 * agent's model/effort/budget. Used by `cli-runner.ts` to log the active
 * provider at startup; also useful for other run-level wiring that wants
 * just the provider selection.
 *
 * Same precedence as `readModelConfig`'s provider branch:
 *   AGENTFLOW_PROVIDER > project `provider:` > global `provider:` > factory default.
 */
export function readProviderConfig(
  projectRoot: string,
  opts?: { globalPath?: string; projectPath?: string },
): ProviderConfig {
  const globalPath =
    opts?.globalPath ?? join(homedir(), ".claude", "models.yaml");
  const projectPath =
    opts?.projectPath ?? join(projectRoot, ".claude", "models.yaml");

  const globalCfg = loadYaml(globalPath);
  const projectCfg = loadYaml(projectPath);

  return resolveProviderConfig(globalCfg, projectCfg);
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
