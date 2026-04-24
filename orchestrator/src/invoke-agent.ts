import { exec } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type {
  Options,
  SDKMessage,
  SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { query as realQuery } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentSequenceMember,
  GitAgentOutput,
  Task,
} from "@repo/orchestrator-contracts";
import { GitAgentOutput as GitAgentOutputSchema } from "@repo/orchestrator-contracts";
import { resolveAuthOptions } from "./auth-provider.js";
import type { BudgetTracker } from "./budget-tracker.js";
import type {
  GitOpInput,
  InvokeAgentFn,
  InvokeAgentResult,
} from "./feature-graph.js";
import { readModelConfig, type ModelConfig } from "./model-config.js";
import type { QueryFn } from "./stage-runner.js";

const execAsync = promisify(exec);

/** Promise-returning git CLI runner — injectable for tests. */
export type ExecGitFn = (
  cmd: string,
  cwd: string,
) => Promise<{ stdout: string; stderr: string; code: number }>;

export interface CreateInvokeAgentConfig {
  projectRoot: string;
  budget: BudgetTracker;
  flags: readonly string[];
  gateApiBase?: string;
  /** Test hook — overrides the SDK's real query(). */
  queryFn?: QueryFn;
  /** Test hook — overrides git CLI exec. */
  execGit?: ExecGitFn;
  /** Test hook — overrides readModelConfig paths. */
  modelConfigOverride?: { globalPath?: string; projectPath?: string };
}

/** Build-agent surfaces that should populate `lastWritingAgent`. */
const BUILD_AGENTS: readonly AgentSequenceMember[] = [
  "backend-builder",
  "web-frontend-builder",
  "mobile-frontend-builder",
];

function isBuildAgent(agent: AgentSequenceMember): boolean {
  return BUILD_AGENTS.includes(agent);
}

/**
 * Factory producing the real `InvokeAgentFn` that `runFeature` /
 * `runFeatureGraph` require. Splits behaviour on agent name:
 *
 *   - `"git-agent"`  → deterministic local git commands + lockfile writes
 *                      (no SDK calls, `costUsd: 0`).
 *   - other agents   → wrap Claude Agent SDK `query()` with budget
 *                      enforcement + structured-output parsing.
 */
export function createInvokeAgent(cfg: CreateInvokeAgentConfig): InvokeAgentFn {
  const execGit: ExecGitFn = cfg.execGit ?? defaultExecGit;
  const queryFn: QueryFn = cfg.queryFn ?? (realQuery as unknown as QueryFn);

  return async (args) => {
    if (args.agent === "git-agent") {
      if (!args.gitOp) {
        throw new Error(
          "invokeAgent: git-agent invoked without args.gitOp payload",
        );
      }
      const output = await runGitOp(args.gitOp, cfg.projectRoot, execGit);
      const validated = GitAgentOutputSchema.parse(output);
      return {
        taskStatus: {},
        errors: {},
        gitAgentOutput: validated,
        costUsd: 0,
      };
    }

    return runLlmAgent(args.agent, args, cfg, queryFn);
  };
}

// ─── git-agent implementation ────────────────────────────────────────

async function runGitOp(
  gitOp: GitOpInput,
  projectRoot: string,
  execGit: ExecGitFn,
): Promise<GitAgentOutput> {
  switch (gitOp.op) {
    case "checkout-feature":
      return runCheckoutFeature(gitOp, projectRoot, execGit);
    case "close-feature":
      return runCloseFeature(gitOp, projectRoot, execGit);
    case "resolve-conflict-handoff":
      return runResolveConflictHandoff(gitOp);
    case "emergency-abort":
      return runEmergencyAbort(gitOp, projectRoot, execGit);
    default: {
      // Exhaustiveness guard.
      const _never: never = gitOp;
      void _never;
      throw new Error(`runGitOp: unknown op`);
    }
  }
}

async function runCheckoutFeature(
  gitOp: Extract<GitOpInput, { op: "checkout-feature" }>,
  projectRoot: string,
  execGit: ExecGitFn,
): Promise<GitAgentOutput> {
  const worktreePath = join(
    projectRoot,
    ".claude",
    "worktrees",
    gitOp.worktree,
  );
  const lockfilePath = join(
    projectRoot,
    ".claude",
    "worktrees",
    `${gitOp.featureId}.lock.json`,
  );

  // Pre-flight checks — the real git command will also fail, but we want
  // clean failure reasons for the orchestrator's `CheckoutFeatureFailure`.
  if (existsSync(worktreePath)) {
    return {
      op: "checkout-feature",
      success: false,
      reason: "stale-worktree",
      existingWorktree: worktreePath,
    };
  }

  try {
    await execGit(
      `git worktree add ${shellQuote(worktreePath)} -b ${shellQuote(gitOp.branch)}`,
      projectRoot,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/already exists|already checked out/i.test(msg)) {
      return {
        op: "checkout-feature",
        success: false,
        reason: "branch-conflict",
      };
    }
    if (/worktree .* already exists/i.test(msg)) {
      return {
        op: "checkout-feature",
        success: false,
        reason: "stale-worktree",
        existingWorktree: worktreePath,
      };
    }
    return {
      op: "checkout-feature",
      success: false,
      reason: "branch-conflict",
    };
  }

  // Write lockfile
  mkdirSync(dirname(lockfilePath), { recursive: true });
  const lock = {
    featureId: gitOp.featureId,
    worktree: worktreePath,
    branch: gitOp.branch,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(lockfilePath, JSON.stringify(lock, null, 2), "utf8");

  return {
    op: "checkout-feature",
    success: true,
    worktreePath,
    lockfilePath,
    branch: gitOp.branch,
    featureId: gitOp.featureId,
  };
}

async function runCloseFeature(
  gitOp: Extract<GitOpInput, { op: "close-feature" }>,
  projectRoot: string,
  execGit: ExecGitFn,
): Promise<GitAgentOutput> {
  const worktreePath = join(
    projectRoot,
    ".claude",
    "worktrees",
    gitOp.worktree,
  );
  const branch = `feat/${gitOp.featureId.replace(/^feat-/, "")}`;

  // Optional: fetch origin (ignore failure for local-only repos).
  try {
    await execGit("git fetch origin main", projectRoot);
  } catch {
    // local-only — skip
  }

  // Checkout main + merge feature branch.
  try {
    await execGit("git checkout main", projectRoot);
  } catch (err) {
    return {
      op: "close-feature",
      success: false,
      conflict: true,
      conflictingFiles: [
        `<checkout-main-failed>: ${err instanceof Error ? err.message : String(err)}`,
      ],
      lastWritingAgent: "unknown",
      worktreePath,
    };
  }

  try {
    await execGit(
      `git merge --no-ff ${shellQuote(branch)} -m "merge feat/${gitOp.featureId}"`,
      projectRoot,
    );
  } catch {
    // Conflict path — collect conflicting files, abort merge.
    let conflictingFiles: string[] = [];
    try {
      const res = await execGit(
        "git diff --name-only --diff-filter=U",
        projectRoot,
      );
      conflictingFiles = res.stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {
      conflictingFiles = ["<unknown-conflict-file>"];
    }
    try {
      await execGit("git merge --abort", projectRoot);
    } catch {
      // best-effort
    }
    return {
      op: "close-feature",
      success: false,
      conflict: true,
      conflictingFiles:
        conflictingFiles.length > 0
          ? conflictingFiles
          : ["<unknown-conflict-file>"],
      lastWritingAgent: "unknown",
      worktreePath,
    };
  }

  let mergeSha = "0000000";
  try {
    const res = await execGit("git rev-parse HEAD", projectRoot);
    mergeSha = res.stdout.trim();
  } catch {
    // fall back to placeholder — schema requires 7+ hex
    mergeSha = "0000000";
  }

  return {
    op: "close-feature",
    success: true,
    conflict: false,
    mergeSha,
    featureId: gitOp.featureId,
  };
}

function runResolveConflictHandoff(
  gitOp: Extract<GitOpInput, { op: "resolve-conflict-handoff" }>,
): GitAgentOutput {
  // Pure echo — routing primitive consumed by `runFeature`.
  return {
    op: "resolve-conflict-handoff",
    worktreePath: gitOp.worktree,
    conflictingFiles: [...gitOp.conflictingFiles],
    lastWritingAgent: gitOp.lastWritingAgent,
    attempt: gitOp.attempt,
    mergeBaseSha: gitOp.mergeBaseSha,
    mainHeadSha: gitOp.mainHeadSha,
    featureHeadSha: gitOp.featureHeadSha,
  };
}

async function runEmergencyAbort(
  gitOp: Extract<GitOpInput, { op: "emergency-abort" }>,
  projectRoot: string,
  execGit: ExecGitFn,
): Promise<GitAgentOutput> {
  const worktreePath = join(
    projectRoot,
    ".claude",
    "worktrees",
    gitOp.worktree,
  );
  const lockfilePath = join(
    projectRoot,
    ".claude",
    "worktrees",
    `${gitOp.featureId}.lock.json`,
  );
  const branch = `feat/${gitOp.featureId.replace(/^feat-/, "")}`;

  // Best-effort cleanup — emergency abort MUST report success even if some
  // steps fail (otherwise the orchestrator can't recover).
  try {
    await execGit(
      `git worktree remove --force ${shellQuote(worktreePath)}`,
      projectRoot,
    );
  } catch {
    // ignore
  }
  try {
    if (existsSync(lockfilePath)) {
      rmSync(lockfilePath, { force: true });
    }
  } catch {
    // ignore
  }
  try {
    await execGit(`git branch -D ${shellQuote(branch)}`, projectRoot);
  } catch {
    // ignore — branch may already be gone
  }

  return {
    op: "emergency-abort",
    success: true,
    featureId: gitOp.featureId,
    reason: gitOp.reason,
    cleanup: "worktree-removed",
  };
}

// ─── LLM-agent implementation ────────────────────────────────────────

async function runLlmAgent(
  agent: AgentSequenceMember,
  args: Parameters<InvokeAgentFn>[0],
  cfg: CreateInvokeAgentConfig,
  queryFn: QueryFn,
): Promise<InvokeAgentResult> {
  const modelConfig = readModelConfig(
    agent,
    cfg.projectRoot,
    cfg.modelConfigOverride,
  );

  // Budget check FIRST — before building the prompt, so the stub's call
  // count stays at zero when the tracker is already at cap.
  cfg.budget.assertUnderBudget(modelConfig.budgetUsd);

  const prompt = buildAgentPrompt(agent, args);
  const options = buildAgentOptions(args, cfg, modelConfig);

  let result: SDKResultMessage | undefined;
  try {
    const q = queryFn({ prompt, options });
    for await (const msg of q as AsyncIterable<SDKMessage>) {
      if (msg.type === "result") {
        result = msg;
        break;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const failed: Record<string, "completed" | "failed"> = {};
    const errors: Record<string, string> = {};
    for (const t of args.tasks) {
      failed[t.id] = "failed";
      errors[t.id] = `query threw: ${msg}`;
    }
    return {
      taskStatus: failed,
      errors,
      costUsd: 0,
      ...(isBuildAgent(agent) ? { lastWritingAgent: agent } : {}),
    };
  }

  if (!result) {
    const failed: Record<string, "completed" | "failed"> = {};
    const errors: Record<string, string> = {};
    for (const t of args.tasks) {
      failed[t.id] = "failed";
      errors[t.id] = "SDK stream ended without a 'result' message";
    }
    return {
      taskStatus: failed,
      errors,
      costUsd: 0,
      ...(isBuildAgent(agent) ? { lastWritingAgent: agent } : {}),
    };
  }

  cfg.budget.record(result.total_cost_usd);

  if (result.subtype !== "success") {
    const failed: Record<string, "completed" | "failed"> = {};
    const errors: Record<string, string> = {};
    for (const t of args.tasks) {
      failed[t.id] = "failed";
      errors[t.id] = result.subtype;
    }
    return {
      taskStatus: failed,
      errors,
      costUsd: result.total_cost_usd,
      ...(isBuildAgent(agent) ? { lastWritingAgent: agent } : {}),
    };
  }

  // success subtype — parse + translate
  const parsed = extractStructuredOutput(result);
  const translated = translateOutcomes(parsed, args.tasks);

  return {
    taskStatus: translated.taskStatus,
    errors: translated.errors,
    costUsd: result.total_cost_usd,
    ...(isBuildAgent(agent) ? { lastWritingAgent: agent } : {}),
  };
}

function buildAgentPrompt(
  agent: AgentSequenceMember,
  args: Parameters<InvokeAgentFn>[0],
): string {
  const { featureContext, tasks, retryContext } = args;
  const taskLines = tasks
    .map((t) => `  - ${t.id} (${t.agent})${t.summary ? `: ${t.summary}` : ""}`)
    .join("\n");

  let prompt =
    `You are the ${agent} agent for feature ${featureContext.id} ` +
    `(branch ${featureContext.branch}, priority ${featureContext.priority}).\n` +
    `Tasks assigned to you on this feature:\n${taskLines}\n`;

  if (retryContext) {
    prompt +=
      `\nRetry context — prior attempt failed:\n` +
      `${retryContext.taskId}: ${retryContext.errorMessage}\n`;
  }

  prompt +=
    `\nYour working directory is the feature worktree. Execute your skill ` +
    `(the factory maps agent names to their SKILL.md). When you finish, ` +
    `return a final JSON message with shape:\n` +
    `{ "taskOutcomes": { "<task-id>": "completed" | "failed", ... }, ` +
    `"errors": { "<task-id>": "<message>" } }\n`;

  return prompt;
}

function buildAgentOptions(
  args: Parameters<InvokeAgentFn>[0],
  cfg: CreateInvokeAgentConfig,
  modelConfig: ModelConfig,
): Options {
  // Resolve auth backend FIRST (same pattern as stage-runner.buildOptions):
  // provider-specific env vars layer in before our pipeline-specific keys.
  const auth = resolveAuthOptions(modelConfig.providerConfig, {
    ...process.env,
  });
  const env: Record<string, string | undefined> = {
    ...auth.env,
    CLAUDE_PIPELINE_FLAGS: cfg.flags.join(","),
    CLAUDE_FEATURE_ID: args.featureContext.id,
    CLAUDE_FEATURE_BRANCH: args.featureContext.branch,
  };
  if (cfg.gateApiBase) {
    env.CLAUDE_GATE_API_BASE = cfg.gateApiBase;
  }

  return {
    model: modelConfig.model,
    effort: modelConfig.effort as NonNullable<Options["effort"]>,
    cwd: args.cwd,
    env,
    maxBudgetUsd: modelConfig.budgetUsd,
    ...(auth.forceLoginMethod
      ? { forceLoginMethod: auth.forceLoginMethod }
      : {}),
  };
}

/**
 * Mirror of stage-runner.ts::extractStructuredOutput. Prefer
 * `result.structured_output`; fall back to trailing JSON in `result.result`.
 */
function extractStructuredOutput(result: SDKResultMessage): unknown {
  if (result.subtype !== "success") return null;
  if (result.structured_output !== undefined) return result.structured_output;
  const text = result.result.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}\s*$/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

/**
 * Translate a parsed agent-output blob into the orchestrator's per-task
 * outcome map. Expected shape:
 *   { taskOutcomes: { "<task-id>": "completed" | "failed" }, errors?: {...} }
 * Missing task IDs are marked failed.
 */
function translateOutcomes(
  parsed: unknown,
  tasks: readonly Task[],
): {
  taskStatus: Record<string, "completed" | "failed">;
  errors: Record<string, string>;
} {
  const taskStatus: Record<string, "completed" | "failed"> = {};
  const errors: Record<string, string> = {};

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    for (const t of tasks) {
      taskStatus[t.id] = "failed";
      errors[t.id] = "agent produced no parseable outcome JSON";
    }
    return { taskStatus, errors };
  }

  const obj = parsed as {
    taskOutcomes?: unknown;
    errors?: unknown;
  };
  const rawOutcomes =
    obj.taskOutcomes && typeof obj.taskOutcomes === "object"
      ? (obj.taskOutcomes as Record<string, unknown>)
      : null;
  const rawErrors =
    obj.errors && typeof obj.errors === "object"
      ? (obj.errors as Record<string, unknown>)
      : null;

  if (!rawOutcomes) {
    for (const t of tasks) {
      taskStatus[t.id] = "failed";
      errors[t.id] = "agent produced no parseable outcome JSON";
    }
    return { taskStatus, errors };
  }

  for (const t of tasks) {
    const val = rawOutcomes[t.id];
    if (val === "completed" || val === "failed") {
      taskStatus[t.id] = val;
      if (val === "failed") {
        const errVal = rawErrors?.[t.id];
        errors[t.id] =
          typeof errVal === "string" ? errVal : "agent reported failed";
      }
    } else {
      taskStatus[t.id] = "failed";
      errors[t.id] = "agent did not report outcome";
    }
  }

  return { taskStatus, errors };
}

// ─── helpers ─────────────────────────────────────────────────────────

async function defaultExecGit(
  cmd: string,
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    const code = typeof e.code === "number" ? e.code : 1;
    const stdout = e.stdout ?? "";
    const stderr = e.stderr ?? e.message ?? "";
    // Re-throw so the caller's try/catch fires — matches prior expectations.
    const wrapped = new Error(
      `git command failed: ${cmd}\n${stderr}`,
    ) as Error & { stdout?: string; stderr?: string; code?: number };
    wrapped.stdout = stdout;
    wrapped.stderr = stderr;
    wrapped.code = code;
    throw wrapped;
  }
}

/**
 * Minimal shell quoting — wraps in double quotes + escapes embedded
 * double quotes. Sufficient for worktree paths, branch names (which must
 * already match the `feat/...` pattern).
 */
function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@/.:\\-]+$/.test(value)) return value;
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

export type { InvokeAgentFn, InvokeAgentResult } from "./feature-graph.js";
