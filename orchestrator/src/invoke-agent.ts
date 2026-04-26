import { exec } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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
import {
  BuilderOutput,
  BuilderOutputJsonSchema,
  GitAgentOutput as GitAgentOutputSchema,
} from "@repo/orchestrator-contracts";
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

/**
 * Promise-returning shell-command runner (NOT prefixed with `git` — runs
 * the literal command as-is). Injectable for tests; default delegates to
 * Node's `child_process.exec` via `execAsync`.
 *
 * Same result shape as `ExecGitFn` so callers can branch on `code` only.
 */
export type ShellExecFn = (
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

  // bug-002: seed worktree with .claude/hooks/ + permissions allow-list so
  // autonomous Mode B agents can actually Write/Edit/MultiEdit. Without this,
  // every agent invocation hits the harness permission layer (no human to
  // approve the prompt) and burns retries until the feature is marked failed.
  const seedResult = seedWorktree(projectRoot, worktreePath);
  if (!seedResult.ok) {
    return {
      op: "checkout-feature",
      success: false,
      reason: seedResult.reason,
      detail: seedResult.detail,
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

/**
 * bug-002: seed a freshly-created worktree with the runtime artefacts that
 * autonomous Mode B agents need to actually write code. Two structural gaps
 * are closed here:
 *
 *  1. `.claude/hooks/` is gitignored at project level (per agenticVisibility:
 *     private), so `git worktree add` does NOT bring it along. The agent SDK
 *     reads PreToolUse hooks from `<worktree>/.claude/settings.json` which
 *     references `$CLAUDE_PROJECT_DIR/.claude/hooks/<script>` — those scripts
 *     don't exist in the worktree → every PreToolUse hook fails → tool call
 *     blocked. Fix: copy the hooks dir into the worktree.
 *
 *  2. The project root's `.claude/settings.json` is intentionally restrictive
 *     (Read/Grep/Glob + specific Bash patterns; no Write/Edit/MultiEdit) — it
 *     was designed for human-driven Claude Code sessions where each Write
 *     triggers an interactive approval prompt. In autonomous Mode B there's no
 *     human to approve → hard deny. Fix: amend the WORKTREE's settings.json
 *     (NOT the project root) with an additional permissions.allow block
 *     granting Write(*)/Edit(*)/MultiEdit(*). The project root stays restrictive
 *     for human use; only the worktree (autonomous-only context) gets the
 *     permissive block. Idempotent: existing entries are preserved.
 *
 * Returns `{ ok: true }` on success or a `CheckoutFeatureFailure`-shaped
 * `reason` + `detail` for the orchestrator to bubble up.
 */
type SeedResult =
  | { ok: true }
  | {
      ok: false;
      reason: "missing-project-hooks" | "worktree-seed-failed";
      detail: string;
    };

const REQUIRED_HOOKS = [
  "block-dangerous.sh",
  "detect-loop.mjs",
  "enforce-boundaries.sh",
  "validate-brief.mjs",
] as const;

const REQUIRED_AUTONOMOUS_PERMISSIONS = [
  "Write(*)",
  "Edit(*)",
  "MultiEdit(*)",
  "Bash(*)",
  "Read(*)",
  "Glob(*)",
  "Grep(*)",
] as const;

function seedWorktree(projectRoot: string, worktreePath: string): SeedResult {
  // Step 1: confirm the project actually has the hooks dir to copy.
  const projectHooks = join(projectRoot, ".claude", "hooks");
  if (!existsSync(projectHooks)) {
    return {
      ok: false,
      reason: "missing-project-hooks",
      detail: `expected hooks at ${projectHooks} — run /new-project to re-seed the project`,
    };
  }

  // Step 2: copy hooks into the worktree.
  const worktreeHooks = join(worktreePath, ".claude", "hooks");
  try {
    mkdirSync(dirname(worktreeHooks), { recursive: true });
    cpSync(projectHooks, worktreeHooks, { recursive: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: "worktree-seed-failed",
      detail: `cpSync hooks failed: ${msg}`,
    };
  }

  // Step 3: amend the worktree's settings.json with an autonomous-mode
  // permissions.allow block. Read-modify-write is idempotent — existing
  // entries are preserved; missing required entries are appended.
  const worktreeSettingsPath = join(worktreePath, ".claude", "settings.json");
  try {
    type SettingsShape = {
      permissions?: { allow?: string[]; deny?: string[] };
      [k: string]: unknown;
    };
    let settings: SettingsShape;
    if (existsSync(worktreeSettingsPath)) {
      const raw = readFileSync(worktreeSettingsPath, "utf8");
      try {
        settings = JSON.parse(raw) as SettingsShape;
      } catch (parseErr) {
        const msg =
          parseErr instanceof Error ? parseErr.message : String(parseErr);
        return {
          ok: false,
          reason: "worktree-seed-failed",
          detail: `worktree settings.json is malformed JSON: ${msg}`,
        };
      }
    } else {
      // Worktree settings.json absent (defensive — should not happen in real
      // git, but possible under stubbed tests). Seed a minimal one.
      mkdirSync(dirname(worktreeSettingsPath), { recursive: true });
      settings = {};
    }

    settings.permissions ??= {};
    const existing = Array.isArray(settings.permissions.allow)
      ? settings.permissions.allow
      : [];
    const merged = [...existing];
    for (const p of REQUIRED_AUTONOMOUS_PERMISSIONS) {
      if (!merged.includes(p)) merged.push(p);
    }
    settings.permissions.allow = merged;

    writeFileSync(
      worktreeSettingsPath,
      `${JSON.stringify(settings, null, 2)}\n`,
      "utf8",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: "worktree-seed-failed",
      detail: `settings.json amendment failed: ${msg}`,
    };
  }

  // Step 4: self-verify. If any of these trip, the worktree is in a state
  // that would silently fail under autonomous dispatch — fail loudly here
  // instead.
  for (const hook of REQUIRED_HOOKS) {
    if (!existsSync(join(worktreeHooks, hook))) {
      return {
        ok: false,
        reason: "worktree-seed-failed",
        detail: `self-verify: hook ${hook} missing from worktree after copy`,
      };
    }
  }
  try {
    const verifyRaw = readFileSync(worktreeSettingsPath, "utf8");
    const verifyParsed = JSON.parse(verifyRaw) as {
      permissions?: { allow?: string[] };
    };
    const allow = verifyParsed.permissions?.allow ?? [];
    for (const p of REQUIRED_AUTONOMOUS_PERMISSIONS) {
      if (!allow.includes(p)) {
        return {
          ok: false,
          reason: "worktree-seed-failed",
          detail: `self-verify: permissions.allow missing required entry ${p}`,
        };
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: "worktree-seed-failed",
      detail: `self-verify: settings.json read-back failed: ${msg}`,
    };
  }

  return { ok: true };
}

/**
 * bug-005b: detect the project's default branch instead of hardcoding `main`.
 * Older git defaults (and many Windows environments) use `master`; the factory
 * orchestrator was authored assuming `main` and broke on those projects.
 *
 * Probe order:
 *   1. `main` (modern git default; most Linux/macOS envs since 2020)
 *   2. `master` (older default; common on Windows + corporate environments)
 *   3. Whatever HEAD is currently pointing at (best-effort fallback for
 *      fresh-init projects with no merge target yet)
 *   4. Last resort: literal "main" (caller will fail loudly downstream)
 */
async function detectDefaultBranch(
  projectRoot: string,
  execGit: ExecGitFn,
): Promise<string> {
  try {
    await execGit("git rev-parse main", projectRoot);
    return "main";
  } catch {
    /* main not present */
  }
  try {
    await execGit("git rev-parse master", projectRoot);
    return "master";
  } catch {
    /* master not present */
  }
  try {
    const res = await execGit("git symbolic-ref --short HEAD", projectRoot);
    const head = res.stdout.trim();
    if (head) return head;
  } catch {
    /* fall through */
  }
  return "main";
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
  // bug-005b: detect the project's default branch (main / master / fallback)
  // instead of hardcoding "main".
  const defaultBranch = await detectDefaultBranch(projectRoot, execGit);

  // Optional: fetch origin (ignore failure for local-only repos).
  try {
    await execGit(`git fetch origin ${shellQuote(defaultBranch)}`, projectRoot);
  } catch {
    // local-only — skip
  }

  // feat-018 Phase B: defensive guard against the silent no-op merge
  // mode. If the feature branch's HEAD === default-branch's HEAD, no commits
  // were made on the branch. There are two sub-cases:
  //   1. Worktree is dirty → builders authored code but skipped commit;
  //      Phase A should have caught this. Surface as a hard failure
  //      so the orchestrator + the operator see it.
  //   2. Worktree is clean → legitimate no-op feature (e.g. config-
  //      only). Log + continue; the merge below will succeed as
  //      "already up to date" + the schema-valid CloseFeatureSuccess
  //      will be returned.
  let mainSha: string | null = null;
  let branchSha: string | null = null;
  try {
    const mainRes = await execGit(
      `git rev-parse ${shellQuote(defaultBranch)}`,
      projectRoot,
    );
    mainSha = mainRes.stdout.trim();
  } catch {
    mainSha = null;
  }
  try {
    const branchRes = await execGit(
      `git rev-parse ${shellQuote(branch)}`,
      projectRoot,
    );
    branchSha = branchRes.stdout.trim();
  } catch {
    branchSha = null;
  }

  if (mainSha !== null && branchSha !== null && mainSha === branchSha) {
    let dirtyFiles: string[] = [];
    try {
      const status = await execGit("git status --porcelain", worktreePath);
      dirtyFiles = status.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      dirtyFiles = [];
    }
    if (dirtyFiles.length > 0) {
      return {
        op: "close-feature",
        success: false,
        conflict: false,
        reason: "feature-no-commits",
        worktreePath,
        dirtyFiles,
      };
    }
    // eslint-disable-next-line no-console
    console.warn(
      `[runCloseFeature] feature ${gitOp.featureId}: branch === ${defaultBranch} and worktree clean — likely a no-op feature. Proceeding with no-op merge.`,
    );
  }

  // Checkout default branch + merge feature branch.
  try {
    await execGit(`git checkout ${shellQuote(defaultBranch)}`, projectRoot);
  } catch (err) {
    return {
      op: "close-feature",
      success: false,
      conflict: true,
      conflictingFiles: [
        `<checkout-${defaultBranch}-failed>: ${err instanceof Error ? err.message : String(err)}`,
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
  const options = buildAgentOptions(agent, args, cfg, modelConfig);

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
  const extracted = extractStructuredOutput(result);
  if (!extracted.ok) {
    // bug-004: surface a precise reason instead of the silent
    // "no parseable outcome JSON" message that historically cost $6+ per
    // debug session.
    const failed: Record<string, "completed" | "failed"> = {};
    const errors: Record<string, string> = {};
    for (const t of args.tasks) {
      failed[t.id] = "failed";
      errors[t.id] =
        `agent produced no parseable outcome JSON: ${extracted.reason}`;
    }
    return {
      taskStatus: failed,
      errors,
      costUsd: result.total_cost_usd,
      ...(isBuildAgent(agent) ? { lastWritingAgent: agent } : {}),
    };
  }
  const translated = translateOutcomes(extracted.parsed, args.tasks);

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
  agent: AgentSequenceMember,
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
    // bug-004: builder agents (backend/web-frontend/mobile-frontend) emit
    // `BuilderOutput`. Telling the SDK the schema makes it (a) coerce the
    // model toward valid output, (b) retry on validation failure (max →
    // subtype `error_max_structured_output_retries`), and (c) populate
    // `result.structured_output` deterministically — eliminating the
    // brittle trailing-JSON regex as the primary extraction path. Other
    // agents (tester, reviewer, git-agent) keep the regex fallback until
    // their schemas are formalized.
    ...(isBuildAgent(agent)
      ? {
          outputFormat: {
            type: "json_schema" as const,
            schema: BuilderOutputJsonSchema as Record<string, unknown>,
          },
        }
      : {}),
  };
}

/**
 * bug-004: structured-output extractor with two paths and explicit failure
 * reasons (formerly silent null-return).
 *
 *   PRIMARY — `result.structured_output` populated by the SDK when the caller
 *   set `Options.outputFormat: { type: 'json_schema', schema }`. Builder
 *   agents (backend/web-frontend/mobile-frontend) opt into this in
 *   `buildAgentOptions`. Returns the parsed object verbatim; the SDK has
 *   already validated it against the schema.
 *
 *   FALLBACK — trailing JSON in `result.result`. Used by non-builder agents
 *   (tester, reviewer) until their schemas are formalized. Tolerates a
 *   trailing markdown code fence (```json {...} ``` or ``` {...} ```) so
 *   common LLM emission patterns don't trip the regex.
 *
 *   Returns `{ ok: true, parsed }` on success or `{ ok: false, reason }` so
 *   `runLlmAgent` can surface a precise breadcrumb instead of the historical
 *   silent "agent produced no parseable outcome JSON" (which cost $6+ per
 *   debug session pre-bug-004).
 */
type ExtractResult =
  | { ok: true; parsed: unknown }
  | { ok: false; reason: string };

function extractStructuredOutput(result: SDKResultMessage): ExtractResult {
  if (result.subtype !== "success") {
    return {
      ok: false,
      reason: `SDK subtype was '${result.subtype}', not 'success'`,
    };
  }
  if (result.structured_output !== undefined) {
    return { ok: true, parsed: result.structured_output };
  }

  // Fallback: trailing JSON in text. Strip a trailing markdown code fence first.
  let text = result.result.trim();
  if (text.length === 0) {
    return {
      ok: false,
      reason: "result.result was empty (no structured_output, no text)",
    };
  }
  // Strip trailing ```...``` (with optional language tag) — common LLM pattern
  // is to wrap JSON in ```json ... ```. The regex captures the inner content.
  const fenceStripped = text.replace(
    /```[a-zA-Z0-9]*\s*\n?([\s\S]*?)\n?```\s*$/,
    "$1",
  );
  if (fenceStripped !== text) text = fenceStripped.trim();

  const jsonMatch = text.match(/\{[\s\S]*\}\s*$/);
  if (!jsonMatch) {
    const tail = text.length > 200 ? `...${text.slice(-200)}` : text;
    return {
      ok: false,
      reason: `text didn't end with parseable JSON object; tail was: ${JSON.stringify(tail)}`,
    };
  }
  try {
    return { ok: true, parsed: JSON.parse(jsonMatch[0]) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Include the text the regex matched (truncated) so the next debug
    // cycle can see exactly what the agent emitted — common cause is a
    // JS object literal (unquoted keys) that JSON.parse rejects at pos 1.
    const matchedText = jsonMatch[0];
    const matchedSample =
      matchedText.length > 400
        ? `${matchedText.slice(0, 200)}...(${matchedText.length - 400} chars elided)...${matchedText.slice(-200)}`
        : matchedText;
    return {
      ok: false,
      reason: `JSON.parse threw on trailing-JSON match: ${msg}; matched text was: ${JSON.stringify(matchedSample)}`,
    };
  }
}

/**
 * Translate a parsed agent-output blob into the orchestrator's per-task
 * outcome map.
 *
 * bug-003: two accepted shapes.
 *
 *   PRIMARY (canonical) — `BuilderOutput` per
 *   `@repo/orchestrator-contracts/builder.ts`. Emitted by all 3 builder
 *   agents (backend, web-frontend, mobile-frontend). Discriminated on `tier`.
 *
 *     {
 *       tier: "web" | "backend" | "mobile",
 *       success: true,
 *       tasksCompleted: BuilderTaskResult[],
 *       tasksFailed:    BuilderTaskResult[],
 *       tasksSkipped:   BuilderTaskResult[],
 *       ...other diagnostic fields
 *     }
 *
 *   LEGACY (back-compat) — flat task-id → status map. Used by older agents
 *   (tester, reviewer pre-bug-003) and by the orchestrator's own test
 *   fixtures. Kept as a fallback so the parser stays permissive.
 *
 *     { taskOutcomes: { "<task-id>": "completed" | "failed" }, errors?: {...} }
 *
 * Tasks not reported in either shape default to `failed` with a precise error
 * message. Skipped tasks (canonical only) are translated to `completed` —
 * the orchestrator's per-task retry loop only branches on "failed".
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

  // Primary: BuilderOutput canonical shape (zod-validated).
  const builderParsed = BuilderOutput.safeParse(parsed);
  if (builderParsed.success) {
    const reported = new Set<string>();
    for (const r of builderParsed.data.tasksCompleted) {
      taskStatus[r.taskId] = "completed";
      reported.add(r.taskId);
    }
    for (const r of builderParsed.data.tasksSkipped) {
      // Skipped tasks aren't failures — orchestrator advances past them.
      taskStatus[r.taskId] = "completed";
      reported.add(r.taskId);
    }
    for (const r of builderParsed.data.tasksFailed) {
      taskStatus[r.taskId] = "failed";
      errors[r.taskId] = r.errors ?? "agent reported failed";
      reported.add(r.taskId);
    }
    // Tasks dispatched to the agent but absent from all 3 arrays.
    for (const t of tasks) {
      if (!reported.has(t.id)) {
        taskStatus[t.id] = "failed";
        errors[t.id] = "agent did not report outcome";
      }
    }
    return { taskStatus, errors };
  }

  // Legacy fallback: flat taskOutcomes map.
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
    // Neither shape matched. Surface the BuilderOutput zod error so future
    // debugging is one step easier (per bug-003 attempt-1 lesson — silent
    // "no parseable outcome JSON" cost $6.52 to diagnose).
    const zodHint = builderParsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    for (const t of tasks) {
      taskStatus[t.id] = "failed";
      errors[t.id] =
        `agent produced no parseable outcome JSON (BuilderOutput zod: ${zodHint})`;
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

// ─── auto-commit helper (feat-018 Phase A) ───────────────────────────

/**
 * Result of a `commitWorktreeChanges` call.
 *   - `committed: true`  → a commit was created on HEAD; `sha` is its SHA.
 *   - `committed: false` + no `warning` → clean tree, no-op task (legitimate).
 *   - `committed: false` + `warning`    → git command failed; caller decides
 *     whether to surface the warning or abort. Never throws.
 */
export interface CommitResult {
  committed: boolean;
  sha?: string;
  warning?: string;
}

/**
 * Auto-commit any pending changes inside a feature worktree. Mode B's
 * builders/testers/reviewers don't run `git commit` themselves; this
 * helper closes that gap so close-feature has real commits to merge.
 *
 * Contract:
 *   - clean tree → `{ committed: false }` (no warning — legitimate no-op)
 *   - dirty tree happy path → `git add -A && git commit -m '<msg>'` then
 *     `git rev-parse HEAD` → `{ committed: true, sha }`
 *   - any git failure → `{ committed: false, warning: "..." }` (no throw)
 *
 * The default `defaultExecGit` throws on non-zero exit; we catch + treat
 * thrown errors as exit-code-non-zero results so injected stubs that
 * return `{ code: 1 }` AND the production wrapper that throws both work.
 */
export async function commitWorktreeChanges(
  cwd: string,
  message: string,
  exec: ExecGitFn = defaultExecGit,
): Promise<CommitResult> {
  const status = await safeExec(exec, "git status --porcelain", cwd);
  if (status.code !== 0) {
    return { committed: false, warning: `git status failed: ${status.stderr}` };
  }
  if (status.stdout.trim() === "") {
    // Clean tree — legitimate no-op task (e.g. config-only).
    return { committed: false };
  }

  const add = await safeExec(exec, "git add -A", cwd);
  if (add.code !== 0) {
    return { committed: false, warning: `git add failed: ${add.stderr}` };
  }

  // bug-005a: write the message to a tempfile and use `git commit -F <path>`
  // instead of `git commit -m '<msg>'`. The shell-quoted -m form breaks on
  // Windows cmd.exe (single quotes are literal characters there, not string
  // delimiters), causing messages like "feat(scaffold-next-app, state-shell-...)"
  // to be parsed as separate args — git interprets the task IDs as pathspecs
  // and every commit fails. The tempfile path has zero shell-meta-character
  // escape concerns: git reads the file directly.
  const tmpDir = mkdtempSync(join(tmpdir(), "agentflow-commit-"));
  const msgPath = join(tmpDir, "COMMIT_MSG");
  try {
    writeFileSync(msgPath, message, "utf8");
    const commit = await safeExec(
      exec,
      `git commit -F ${shellQuote(msgPath)}`,
      cwd,
    );
    if (commit.code !== 0) {
      return {
        committed: false,
        warning: `git commit failed: ${commit.stderr}`,
      };
    }
    const rev = await safeExec(exec, "git rev-parse HEAD", cwd);
    if (rev.code !== 0) {
      return {
        committed: false,
        warning: `git rev-parse HEAD failed: ${rev.stderr}`,
      };
    }
    return { committed: true, sha: rev.stdout.trim() };
  } finally {
    // Always clean up the tempfile, even on early return / throw.
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ─── install-discipline helper (feat-019 Phase B) ────────────────────

/**
 * Result of an `installIfPackageJsonChanged` call.
 *   - `installed: true`  → `pnpm install` ran + succeeded.
 *   - `installed: false` + no `warning` → no package.json in the diff,
 *     no-op (this is the common case after a non-dep-changing commit).
 *   - `installed: false` + `warning` → either git diff-tree failed OR
 *     `pnpm install` returned non-zero. Caller surfaces the warning;
 *     never aborts (next agent in agent_sequence may still succeed).
 */
export interface InstallResult {
  installed: boolean;
  warning?: string;
}

/**
 * If the most-recent commit in the worktree includes any package.json
 * changes, run `pnpm install` to refresh the dep tree. Defense-in-depth
 * for builders that forgot to install (feat-019 Phase B).
 *
 * Detection: `git diff-tree --no-commit-id --name-only -r HEAD` and
 * filter for `^package\.json$|/package\.json$`.
 *
 * Returns warnings (not errors) — the next agent in agent_sequence
 * may still succeed even if install fails (e.g. tester running with
 * stale node_modules; reviewer is read-only).
 */
export async function installIfPackageJsonChanged(
  cwd: string,
  exec: ExecGitFn = defaultExecGit,
  shellExec: ShellExecFn = defaultShellExec,
): Promise<InstallResult> {
  const diff = await safeExec(
    exec,
    "git diff-tree --no-commit-id --name-only -r HEAD",
    cwd,
  );
  if (diff.code !== 0) {
    return {
      installed: false,
      warning: `git diff-tree failed: ${diff.stderr}`,
    };
  }
  const changed = diff.stdout.split(/\r?\n/).filter(Boolean);
  if (
    !changed.some((f) => f === "package.json" || f.endsWith("/package.json"))
  ) {
    return { installed: false };
  }
  const install = await safeShellExec(shellExec, "pnpm install", cwd);
  if (install.code !== 0) {
    return {
      installed: false,
      warning: `pnpm install failed (commit had package.json changes): ${install.stderr.slice(0, 300)}`,
    };
  }
  return { installed: true };
}

/**
 * Wrapper around a `ShellExecFn` that normalizes thrown errors into a
 * `{ code, stdout, stderr }` result so callers can branch on `code` only.
 * Mirrors `safeExec`'s contract for the non-git shell path.
 */
async function safeShellExec(
  exec: ShellExecFn,
  cmd: string,
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    return await exec(cmd, cwd);
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: typeof e.stdout === "string" ? e.stdout : "",
      stderr:
        typeof e.stderr === "string"
          ? e.stderr
          : err instanceof Error
            ? err.message
            : String(err),
      code: typeof e.code === "number" && e.code !== 0 ? e.code : 1,
    };
  }
}

/**
 * Wrapper around an `ExecGitFn` that normalizes thrown errors into a
 * `{ code, stdout, stderr }` result so callers can branch on `code` only.
 */
async function safeExec(
  exec: ExecGitFn,
  cmd: string,
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    return await exec(cmd, cwd);
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: typeof e.stdout === "string" ? e.stdout : "",
      stderr:
        typeof e.stderr === "string"
          ? e.stderr
          : err instanceof Error
            ? err.message
            : String(err),
      code: typeof e.code === "number" && e.code !== 0 ? e.code : 1,
    };
  }
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
 * Default shell-command runner (non-git). Mirrors `defaultExecGit`'s
 * thrown-error shape so `safeShellExec` can normalize it.
 */
async function defaultShellExec(
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
    const wrapped = new Error(
      `shell command failed: ${cmd}\n${stderr}`,
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
