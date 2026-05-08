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
 *
 * 2026-05-01: reviewer + security bumped 10 → 15 min after empirical
 * pattern on finance-track-01 (3/30 reviewer dispatches hit the 10-min
 * wall). Reviewer walks 7 dimensions of `docs/reviewer-playbook.md`
 * against the full feature diff; for medium/large diffs (5+ task files
 * + extensive tester edge-cases) the per-dimension reasoning blows the
 * 10-min budget. 15 min is a band-aid pending a structural fix
 * (per-dimension cap or diff-summarization pre-pass) — see bug-037 if
 * filed.
 */
/**
 * feat-065-followup (2026-05-08) — Factory-shipped agents that may not
 * yet be present in operator-managed `~/.claude/models.yaml`. When the
 * resolver can't find an agent in either project or global YAML, it
 * checks here first before throwing "No model resolved".
 *
 * Precedence (lowest first):
 *   1. FACTORY_DEFAULT_AGENT_TIERS (this map)
 *   2. global ~/.claude/models.yaml agents.<name>
 *   3. project .claude/models.yaml agents.<name>
 *   4. ANTHROPIC_MODEL env var (highest)
 *
 * Add an entry here whenever the factory ships a new agent that isn't
 * already documented in the canonical `~/.claude/models.yaml` template.
 * The operator can override the tier/effort here by adding the agent
 * to their home YAML.
 *
 * Empirical motivator: reading-log-02 validation 2026-05-08 — bug-fixer
 * (feat-064) was added to the factory + project models.yaml but the
 * operator's home file lacked it. Existing projects with empty
 * `agents: {}` in their project YAML hit "No model resolved" cascade-
 * fail.
 */
const FACTORY_DEFAULT_AGENT_TIERS: Record<
  string,
  { tier?: string; effort?: ModelConfig["effort"] }
> = {
  // bug-fixer — narrow-scope patch agent for /fix-bugs loop dispatches
  // (feat-064). tier:building + effort:medium reflects "narrow-scope
  // with pre-loaded context" — bug-fixer doesn't need full exploration
  // depth (the orchestrator's buildBugContextEnvelope supplies it).
  "bug-fixer": { tier: "building", effort: "medium" },
};

const DEFAULT_STALL_TIMEOUT_BY_AGENT: Record<string, number | null> = {
  "backend-builder": 25 * 60 * 1000,
  "web-frontend-builder": 25 * 60 * 1000,
  "mobile-frontend-builder": 25 * 60 * 1000,
  tester: 20 * 60 * 1000,
  reviewer: 15 * 60 * 1000,
  security: 15 * 60 * 1000,
  "git-agent": null,
  // feat-065 (2026-05-08) — narrow-scope patch agent for /fix-bugs loop.
  // Tighter cap than tier-specific builders because bug-fixer's
  // maxTurns:8 frontmatter forces convergence; combining the two
  // eliminates the "agent wandered 25 min" failure mode observed in
  // reading-log-02 /fix-bugs run b0e1281c. Per investigate-024 §F8.
  // feat-065-followup-2 (2026-05-08): bumped 10 → 15 min after
  // empirical evidence that 10 was too tight for parity bugs that
  // require structural JSX restructuring. flow-5 hit the 10min cap
  // mid-fix-attempt; 15 gives cushion without losing the fail-fast
  // discipline (vs the 25min full-builder cap).
  "bug-fixer": 15 * 60 * 1000,
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
  // feat-065-followup (2026-05-08) — `FACTORY_DEFAULT_AGENT_TIERS` is a
  // hardcoded fallback for agents that ship in the factory but may not be
  // present in operator-managed `~/.claude/models.yaml` yet (typical for
  // freshly-introduced agents like bug-fixer). Without this fallback, a
  // /fix-bugs run on an existing project crashes with "No model resolved"
  // until the operator manually edits their home file. The fallback is
  // applied with LOWEST precedence — both project + global YAML override
  // it. Empirical: reading-log-02 validation 2026-05-08.
  const factoryDefault = FACTORY_DEFAULT_AGENT_TIERS[agentName] ?? {};
  const agent = { ...factoryDefault, ...globalAgent, ...projectAgent };

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
