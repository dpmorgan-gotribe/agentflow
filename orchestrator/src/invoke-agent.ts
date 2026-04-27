import { exec } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
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
  /** Test hook — overrides non-git shell exec (e.g. `pnpm install`). */
  execShell?: ShellExecFn;
  /** Test hook — overrides readModelConfig paths. */
  modelConfigOverride?: { globalPath?: string; projectPath?: string };
  /**
   * feat-024 Phase B — pipeline run id is used as the directory name
   * under `<projectRoot>/.claude/state/<runId>/` for the stall-log
   * breadcrumb file. When unset, the breadcrumb is silently skipped
   * (back-compat with tests that don't supply a run id).
   */
  pipelineRunId?: string;
  /**
   * feat-024 Phase B — explicit override for the per-agent stall budget
   * (ms). When set, takes precedence over the per-agent value resolved
   * from `.claude/models.yaml`. `null` disables the timer entirely.
   * Tests use this to inject a tiny budget for fast assertions without
   * mucking with the YAML resolver.
   */
  stallTimeoutMsOverride?: number | null;
  /**
   * feat-024 Phase B — keepalive watcher tick interval. Defaults to 30s
   * in production; tests can drop this to speed up assertions.
   */
  keepaliveCheckIntervalMs?: number;
  /**
   * feat-024 Phase B — keepalive gap thresholds.
   *  - `warnMs`: log a warning when no message has arrived for this long
   *  - `abortMs`: abort the SDK query when no message has arrived for this long
   * Defaults: 90_000 / 300_000 per investigate-007 §F4-#2.
   */
  keepaliveWarnMs?: number;
  keepaliveAbortMs?: number;
  /**
   * feat-024 Phase C — invoked when liveness fires + cfg.stallTimeoutMode
   * is "strict". The hook is responsible for writing paused.json + any
   * additional bookkeeping. Default: not set → lenient behavior (mark
   * the feature failed, continue the run).
   */
  onStallTimeoutPause?: (info: {
    agent: AgentSequenceMember;
    featureId: string;
    abortReason: string;
    lastKeepAliveAt: number;
    dispatchedAt: number;
  }) => void | Promise<void>;
  /**
   * feat-024 Phase C — invoked when the SDK message stream surfaces a
   * Claude Max five-hour or seven-day rate limit. Default: not set →
   * orchestrator continues (the SDK will fail the call naturally).
   */
  onRateLimitPause?: (info: {
    rateLimitType: string;
    resetsAt?: number;
  }) => void | Promise<void>;
  /**
   * feat-024 Phase C — invoked when SDKAssistantMessage carries
   * errorCode "authentication_failed". Default: not set.
   */
  onAuthFailedPause?: (info: { detail: string }) => void | Promise<void>;
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
 * feat-024 Phase B — append a stall-log breadcrumb when liveness fires.
 * NDJSON-style append (one JSON object per line) so the tester can
 * accumulate breadcrumbs across multiple aborts in one Mode B run
 * without a parser. Lives at
 * `<projectRoot>/.claude/state/<runId>/stall-log.json`.
 *
 * Silent no-op when `cfg.pipelineRunId` isn't set (back-compat with
 * tests that construct an InvokeAgent without a run id).
 */
function writeStallLogBreadcrumb(
  cfg: CreateInvokeAgentConfig,
  entry: {
    featureId: string;
    agent: AgentSequenceMember;
    dispatchedAt: number;
    lastKeepAliveAt: number;
    abortReason: string;
    wallTimeMs: number;
  },
): void {
  if (!cfg.pipelineRunId) return;
  const dir = join(cfg.projectRoot, ".claude", "state", cfg.pipelineRunId);
  try {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "stall-log.json");
    const line = `${JSON.stringify({ ...entry, ts: new Date().toISOString() })}\n`;
    appendFileSync(path, line, "utf8");
  } catch {
    // Breadcrumb best-effort — never crash the orchestrator on a write
    // failure to .claude/state/.
  }
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
  const execShell: ShellExecFn = cfg.execShell ?? defaultShellExec;
  const queryFn: QueryFn = cfg.queryFn ?? (realQuery as unknown as QueryFn);

  return async (args) => {
    if (args.agent === "git-agent") {
      if (!args.gitOp) {
        throw new Error(
          "invokeAgent: git-agent invoked without args.gitOp payload",
        );
      }
      const output = await runGitOp(
        args.gitOp,
        cfg.projectRoot,
        execGit,
        execShell,
      );
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
  execShell: ShellExecFn,
): Promise<GitAgentOutput> {
  switch (gitOp.op) {
    case "checkout-feature":
      return runCheckoutFeature(gitOp, projectRoot, execGit);
    case "close-feature":
      return runCloseFeature(gitOp, projectRoot, execGit, execShell);
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

/**
 * bug-016: shared pre-flight snapshot helper used by `runCheckoutFeature`
 * (bug-009) + `runCloseFeature` (bug-008). Performs the exact same dance both
 * callers used inline before:
 *   1. `git status --porcelain` on the project root
 *   2. if dirty: `git add -A` → `git commit -F <tempfile>` with `commitMessage`
 *
 * Race-loss handling (bug-016): with `--max-concurrent>=2` two callers can
 * observe identical "dirty" state between status (T1) and commit (T3). The
 * race winner commits successfully; the race loser's commit fails with
 * "nothing to commit, working tree clean". Catching that specific failure
 * + re-checking status lets us distinguish:
 *   - race-loss-clean → working tree is now clean (race winner cleaned it
 *     for us) → benign; caller should proceed as if pre-flight succeeded.
 *   - real failure → working tree still dirty after the failed commit, OR
 *     the failure does not match the race patterns at all → caller surfaces
 *     a hard failure as before.
 *
 * Returns a discriminated union the caller switches on. Patterns are matched
 * against `err.stderr` case-insensitively (Windows + Linux + macOS git
 * stderr text differs slightly; case-insensitive regex covers the variance).
 */
type PreFlightSnapshotResult =
  | { status: "ok" }
  | { status: "race-loss-clean" }
  | { status: "fail"; errorMessage: string };

async function preFlightSnapshot(opts: {
  projectRoot: string;
  execGit: ExecGitFn;
  callerLabel: string;
  featureId: string;
  commitMessage: string;
  dirtyWarn: string;
}): Promise<PreFlightSnapshotResult> {
  const { projectRoot, execGit, callerLabel, featureId, commitMessage, dirtyWarn } =
    opts;
  try {
    const status = await execGit("git status --porcelain", projectRoot);
    if (status.stdout.trim() === "") {
      return { status: "ok" };
    }
    // eslint-disable-next-line no-console
    console.warn(dirtyWarn);
    await execGit("git add -A", projectRoot);
    // bug-005a tempfile pattern — cross-platform safe (no shell quoting).
    const snapTmp = mkdtempSync(join(tmpdir(), "agentflow-snapshot-"));
    const snapMsg = join(snapTmp, "MSG");
    try {
      writeFileSync(snapMsg, commitMessage, "utf8");
      await execGit(`git commit -F ${shellQuote(snapMsg)}`, projectRoot);
    } finally {
      rmSync(snapTmp, { recursive: true, force: true });
    }
    return { status: "ok" };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const stderr = (err as { stderr?: string })?.stderr ?? "";

    // bug-016: distinguish race-loss ("nothing to commit") from real
    // failures. Concurrent callers against shared projectRoot routinely
    // race here. Case-insensitive — Windows git stderr capitalisation can
    // differ slightly from Linux.
    const isNothingToCommit =
      /nothing to commit/i.test(stderr) ||
      /working tree clean/i.test(stderr) ||
      /no changes added to commit/i.test(stderr);

    if (!isNothingToCommit) {
      return { status: "fail", errorMessage };
    }

    // Re-check: if the working tree is now clean, the race winner committed
    // for us. Proceed as if pre-flight succeeded.
    let recheckStdout = "";
    try {
      const recheck = await execGit("git status --porcelain", projectRoot);
      recheckStdout = recheck.stdout;
    } catch {
      // If we can't even re-check status, fall through to fail with the
      // original error message.
      return { status: "fail", errorMessage };
    }

    if (recheckStdout.trim() === "") {
      // eslint-disable-next-line no-console
      console.warn(
        `[${callerLabel}] feature ${featureId}: pre-merge snapshot ` +
          `race-lost to a concurrent close-feature; working tree now clean — ` +
          `proceeding with merge.`,
      );
      return { status: "race-loss-clean" };
    }

    // Status STILL dirty after the failed commit — this isn't just a race;
    // something else is going on. Surface as a real failure.
    return { status: "fail", errorMessage };
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

  // bug-009: snapshot dirty/untracked project root state to the current branch
  // (typically master) BEFORE creating the worktree. This ensures the worktree
  // branches from a state INCLUSIVE of pre-build's Mode A artifacts (kit, docs,
  // configs) so the agent doesn't need to recreate them — eliminating the AA
  // (add/add) merge conflicts that bug-008's close-feature pre-flight created
  // by snapshotting AFTER the agent had already committed its own version.
  //
  // Idempotent: skipped if status is clean. First feature in a Mode B run
  // typically does the heavy lifting; subsequent features find the project
  // root already-clean and skip entirely.
  //
  // bug-016: handles concurrent-checkout-feature races via the shared
  // preFlightSnapshot helper — see its docs for the race-loss-clean path.
  const preflight = await preFlightSnapshot({
    projectRoot,
    execGit,
    callerLabel: "runCheckoutFeature",
    featureId: gitOp.featureId,
    commitMessage: `factory: project bootstrap snapshot before checkout-feature for ${gitOp.featureId}\n\nAuto-committed by orchestrator so the worktree branches from a state inclusive of pre-build Mode A artifacts (kit, docs, configs). Without this, agents see a blank worktree, recreate kit files independently, and merges hit AA (add/add) conflicts at close-feature time.`,
    dirtyWarn: `[runCheckoutFeature] feature ${gitOp.featureId}: project root has dirty/untracked state — auto-committing snapshot before worktree creation.`,
  });
  if (preflight.status === "fail") {
    return {
      op: "checkout-feature",
      success: false,
      reason: "worktree-seed-failed",
      detail: `bug-009 pre-worktree snapshot failed: ${preflight.errorMessage}`,
    };
  }
  // status === "ok" or "race-loss-clean" → both proceed with worktree add.

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
  execShell: ShellExecFn,
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

  // bug-008 Phase 1: protect close-feature against dirty/untracked project
  // root that would cause `git merge` to abort BEFORE touching HEAD with
  // "your local changes would be overwritten by merge". This is the failure
  // mode that killed every kanban-webapp validation run before bug-008 —
  // pre-build snapshots ship with Mode A artifacts uncommitted; the
  // orchestrator tries to merge feat/X (which has those same paths as
  // tracked commits) into a default branch whose working tree has them as
  // untracked files.
  //
  // Auto-commit any dirty/untracked state to the CURRENT branch (which is
  // the default branch since we haven't checked out feat/X yet — the
  // worktree is on feat/X, not the project root). Surfaces as a real
  // commit on the default branch with a clear "factory: pre-merge snapshot"
  // message so the operator can see/revert/squash it later.
  //
  // bug-016: handles concurrent-close-feature races via the shared
  // preFlightSnapshot helper — see its docs for the race-loss-clean path.
  const preflight = await preFlightSnapshot({
    projectRoot,
    execGit,
    callerLabel: "runCloseFeature",
    featureId: gitOp.featureId,
    commitMessage: `factory: pre-merge snapshot before close-feature for ${gitOp.featureId}\n\nAuto-committed by orchestrator because project root had dirty/untracked state when close-feature ran. Files included here would otherwise have caused 'git merge' to abort with "your local changes would be overwritten by merge".`,
    dirtyWarn: `[runCloseFeature] feature ${gitOp.featureId}: project root has dirty/untracked state — auto-committing pre-merge snapshot to ${defaultBranch}.`,
  });
  if (preflight.status === "fail") {
    // eslint-disable-next-line no-console
    console.warn(
      `[runCloseFeature] feature ${gitOp.featureId}: pre-merge snapshot failed: ${preflight.errorMessage}`,
    );
    return {
      op: "close-feature",
      success: false,
      conflict: true,
      conflictingFiles: [
        `<pre-merge-snapshot-failed>: ${preflight.errorMessage}`,
        `Hint: project root may have files that resist 'git add -A && git commit'. Inspect 'git status --porcelain' and resolve manually.`,
      ],
      lastWritingAgent: "unknown",
      worktreePath,
    };
  }
  // status === "ok" or "race-loss-clean" → both proceed with the merge below.

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

  // bug-008 diag: snapshot pre-merge state for the catch blocks below so
  // we can see WHY a merge fails (uncommitted changes? branch state?
  // actual conflict? something else?). Cheap to capture; invaluable when
  // the merge fails for non-obvious reasons.
  const snapshotState = async (label: string): Promise<string[]> => {
    const lines: string[] = [`<${label}>`];
    try {
      const status = await execGit("git status --porcelain", projectRoot);
      lines.push(`projectRoot status:\n${status.stdout || "(clean)"}`);
    } catch (e) {
      lines.push(
        `projectRoot status FAILED: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    try {
      const wtStatus = await execGit("git status --porcelain", worktreePath);
      lines.push(`worktree status:\n${wtStatus.stdout || "(clean)"}`);
    } catch (e) {
      lines.push(
        `worktree status FAILED: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    try {
      const head = await execGit("git rev-parse --short HEAD", projectRoot);
      lines.push(`projectRoot HEAD: ${head.stdout.trim()}`);
    } catch {
      /* skip */
    }
    try {
      const wtHead = await execGit("git rev-parse --short HEAD", worktreePath);
      lines.push(`worktree HEAD: ${wtHead.stdout.trim()}`);
    } catch {
      /* skip */
    }
    return lines;
  };

  // Checkout default branch + merge feature branch.
  try {
    await execGit(`git checkout ${shellQuote(defaultBranch)}`, projectRoot);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const stderr = (err as { stderr?: string })?.stderr ?? "";
    const snapshot = await snapshotState("checkout-failed-state");
    // bug-008 Phase 2: also surface to stdout so the orchestrator's exit
    // message shows the cause (not just the resolve-conflict-handoff agent's
    // prompt context). Future filesystem-archaeology debug sessions cost
    // hours; a console.warn costs nothing.
    // eslint-disable-next-line no-console
    console.warn(
      `[runCloseFeature] feature ${gitOp.featureId}: checkout-${defaultBranch} failed.\n${errMsg}\nstderr: ${stderr}\n${snapshot.join("\n")}`,
    );
    return {
      op: "close-feature",
      success: false,
      conflict: true,
      conflictingFiles: [
        `<checkout-${defaultBranch}-failed>: ${errMsg}`,
        `stderr: ${stderr}`,
        ...snapshot,
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
  } catch (err) {
    // bug-008 diag: capture FULL context (the err itself + pre-existing
    // state + post-merge git status) so we can tell whether this was
    // (a) a real file conflict, (b) "your local changes would be overwritten"
    // because of dirty working tree, (c) some other git failure that the
    // historical "<unknown-conflict-file>" sentinel hid completely.
    const errMsg = err instanceof Error ? err.message : String(err);
    const stderr = (err as { stderr?: string })?.stderr ?? "";
    const stdout = (err as { stdout?: string })?.stdout ?? "";
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
      /* fall through — empty list signals no real-conflict files found */
    }

    // bug-012: lockfile auto-resolve. pnpm-lock.yaml / package-lock.json /
    // yarn.lock are content-addressed + structurally non-mergeable; the
    // canonical recipe is "checkout --theirs + reinstall + commit". Run it
    // deterministically here so we don't waste agent retries text-merging.
    // Strict gate: lockfile-only conflicts (no mixed package.json + lockfile);
    // mixed conflicts fall through to the agent (whose prompt knows the recipe).
    if (conflictingFiles.length > 0) {
      const lockResult = await tryAutoResolveLockfileConflicts(
        conflictingFiles,
        projectRoot,
        gitOp.featureId,
        execGit,
        execShell,
      );
      // eslint-disable-next-line no-console
      console.warn(
        `[runCloseFeature] feature ${gitOp.featureId}: lockfile auto-resolve attempt.\n${lockResult.diagnostic.join("\n")}`,
      );
      if (lockResult.resolved.length > 0 && lockResult.remaining.length === 0) {
        // Auto-resolved cleanly — return success.
        let mergeShaR = "0000000";
        try {
          const res = await execGit("git rev-parse HEAD", projectRoot);
          mergeShaR = res.stdout.trim();
        } catch {
          // placeholder — schema requires 7+ hex; unlikely to fire because
          // auto-resolve just made a commit
        }
        return {
          op: "close-feature",
          success: true,
          conflict: false,
          mergeSha: mergeShaR,
          featureId: gitOp.featureId,
        };
      }
    }

    const postMergeSnapshot = await snapshotState("post-merge-failure-state");
    try {
      await execGit("git merge --abort", projectRoot);
    } catch {
      // best-effort
    }
    const diagnostic: string[] = [];
    if (conflictingFiles.length > 0) {
      diagnostic.push(`conflictingFiles: ${conflictingFiles.join(", ")}`);
    } else {
      diagnostic.push(
        "<no-files-in-diff-filter-U>: merge failed for a NON-conflict reason",
      );
    }
    diagnostic.push(`merge stderr: ${stderr || "(empty)"}`);
    diagnostic.push(`merge stdout: ${stdout || "(empty)"}`);
    diagnostic.push(`merge err.message: ${errMsg}`);
    diagnostic.push(...postMergeSnapshot);
    // bug-008 Phase 2: surface the diagnostic to stdout — the
    // resolve-conflict-handoff agent gets the same data via
    // conflictingFiles[] but the orchestrator's exit message never showed it
    // historically; that's why bug-008 took a manual reflog inspection to
    // diagnose. Cheap to log; turns future merge-failure debug sessions from
    // 30+ minutes of filesystem archaeology into a 30-second message read.
    // eslint-disable-next-line no-console
    console.warn(
      `[runCloseFeature] feature ${gitOp.featureId}: merge failed.\n${diagnostic.join("\n")}`,
    );
    return {
      op: "close-feature",
      success: false,
      conflict: true,
      conflictingFiles: diagnostic,
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
  // bug-010: PM's schema enum (AgentSequenceMember) deliberately includes
  // agents the factory hasn't shipped yet (e.g., security, devops) — design B
  // intent per scaffolding/26-039-agent-expert.md. When the orchestrator
  // hits an unshipped agent, throw vs skip is the difference between
  // crashing the entire Mode B run vs degrading one feature gracefully.
  // Mark the dispatched task(s) as completed (NOT failed — failed would
  // trigger task-retry → exhaust → cascade abort) and surface a warning.
  let modelConfig: ModelConfig;
  try {
    modelConfig = readModelConfig(
      agent,
      cfg.projectRoot,
      cfg.modelConfigOverride,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const reason = `agent '${agent}' not configured: ${msg.split("\n")[0]}`;
    // eslint-disable-next-line no-console
    console.warn(
      `[runLlmAgent] ${reason}. Skipping ${args.tasks.length} task(s) and continuing agent_sequence.`,
    );
    const skipped: Record<string, "completed" | "failed"> = {};
    for (const t of args.tasks) skipped[t.id] = "completed";
    return {
      taskStatus: skipped,
      errors: {},
      costUsd: 0,
      skippedReason: reason,
      ...(isBuildAgent(agent) ? { lastWritingAgent: agent } : {}),
    };
  }

  // Budget check FIRST — before building the prompt, so the stub's call
  // count stays at zero when the tracker is already at cap.
  cfg.budget.assertUnderBudget(modelConfig.budgetUsd);

  // feat-024 Phase B: per-invocation AbortController. Resolved budget is
  // either an explicit override (tests) or the per-agent value from the
  // model config. `null` means no liveness probe (e.g. git-agent — but
  // that path doesn't run an LLM anyway).
  const stallTimeoutMs =
    cfg.stallTimeoutMsOverride !== undefined
      ? cfg.stallTimeoutMsOverride
      : modelConfig.stallTimeoutMs;
  const abortController = new AbortController();
  const dispatchedAt = Date.now();
  let lastKeepAliveAt = dispatchedAt;
  let abortReason: string | null = null;

  // Wall-clock timer fires once at stallTimeoutMs.
  let wallTimer: NodeJS.Timeout | null = null;
  // Keepalive watcher ticks every keepaliveCheckIntervalMs and warns at
  // warnMs / aborts at abortMs since the last observed message.
  let keepaliveTimer: NodeJS.Timeout | null = null;

  const checkIntervalMs = cfg.keepaliveCheckIntervalMs ?? 30_000;
  const warnMs = cfg.keepaliveWarnMs ?? 90_000;
  const abortMs = cfg.keepaliveAbortMs ?? 300_000;
  let warnedAt = 0;

  if (stallTimeoutMs && stallTimeoutMs > 0) {
    wallTimer = setTimeout(() => {
      abortReason = `wall-clock-${stallTimeoutMs}ms`;
      abortController.abort(abortReason);
    }, stallTimeoutMs);
  }
  if (stallTimeoutMs !== null) {
    // Keepalive watcher uses checkIntervalMs ticks. We allow tests to
    // disable it by setting checkIntervalMs to 0.
    if (checkIntervalMs > 0) {
      keepaliveTimer = setInterval(() => {
        const sinceLast = Date.now() - lastKeepAliveAt;
        if (sinceLast >= abortMs) {
          abortReason ??= `keepalive-gap-${sinceLast}ms`;
          abortController.abort(abortReason);
          return;
        }
        if (sinceLast >= warnMs && warnedAt < lastKeepAliveAt) {
          // eslint-disable-next-line no-console
          console.warn(
            `[runLlmAgent] ${agent} on ${args.featureContext.id}: no SDK message in ${Math.round(sinceLast / 1000)}s (warn threshold ${warnMs}ms)`,
          );
          warnedAt = lastKeepAliveAt;
        }
      }, checkIntervalMs);
    }
  }

  function clearTimers(): void {
    if (wallTimer) {
      clearTimeout(wallTimer);
      wallTimer = null;
    }
    if (keepaliveTimer) {
      clearInterval(keepaliveTimer);
      keepaliveTimer = null;
    }
  }

  const prompt = buildAgentPrompt(agent, args);
  const options = buildAgentOptions(
    agent,
    args,
    cfg,
    modelConfig,
    abortController,
  );

  let result: SDKResultMessage | undefined;
  let queryThrew: Error | null = null;
  try {
    const q = queryFn({ prompt, options });
    for await (const msg of q as AsyncIterable<SDKMessage>) {
      // feat-024 Phase B: ANY SDK message resets the keepalive clock.
      // Includes 'keep_alive', 'assistant', 'tool_progress', system
      // events, etc. — anything that proves the SDK is alive.
      lastKeepAliveAt = Date.now();

      // feat-024 Phase C: route Claude Max five-hour / seven-day rate
      // limits into the pause-trigger hook. We DO NOT abort the SDK here
      // — the hook decides (it'll typically pauseRun + propagate).
      if (msg.type === "rate_limit_event") {
        // Wide cast — the SDK's own type uses snake_case but we don't
        // import the type here to keep this layer SDK-version-tolerant.
        const evt = msg as unknown as {
          rate_limit_info?: {
            rateLimitType?: string;
            resetsAt?: number;
            status?: string;
          };
        };
        const rateLimitType = evt.rate_limit_info?.rateLimitType ?? "";
        if (
          (rateLimitType === "five_hour" || rateLimitType === "seven_day") &&
          cfg.onRateLimitPause
        ) {
          try {
            const pauseInfo: { rateLimitType: string; resetsAt?: number } = {
              rateLimitType,
            };
            if (evt.rate_limit_info?.resetsAt !== undefined) {
              pauseInfo.resetsAt = evt.rate_limit_info.resetsAt;
            }
            await cfg.onRateLimitPause(pauseInfo);
          } catch {
            /* swallow — pause helper failures shouldn't crash the loop */
          }
        }
      }

      // feat-024 Phase C: route auth-failed errors on assistant messages
      // into the pause-trigger hook.
      if (msg.type === "assistant") {
        const am = msg as unknown as { error?: string };
        if (am.error === "authentication_failed" && cfg.onAuthFailedPause) {
          try {
            await cfg.onAuthFailedPause({ detail: am.error });
          } catch {
            /* same — never fail the loop on a pause-helper bug */
          }
        }
      }

      if (msg.type === "result") {
        result = msg;
        break;
      }
    }
  } catch (err) {
    queryThrew = err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimers();
  }

  // feat-024 Phase B: classify aborts. If an abort fired, treat as
  // error_stall_timeout regardless of whether the SDK threw or simply
  // exited the iterator.
  if (abortController.signal.aborted) {
    const reason = abortReason ?? "abort";
    writeStallLogBreadcrumb(cfg, {
      featureId: args.featureContext.id,
      agent,
      dispatchedAt,
      lastKeepAliveAt,
      abortReason: reason,
      wallTimeMs: Date.now() - dispatchedAt,
    });
    // Phase C: optional strict-mode pause hook. Failures-or-not, we still
    // mark the feature failed in lenient mode (the hook decides whether
    // to ALSO write paused.json).
    if (cfg.onStallTimeoutPause) {
      try {
        await cfg.onStallTimeoutPause({
          agent,
          featureId: args.featureContext.id,
          abortReason: reason,
          lastKeepAliveAt,
          dispatchedAt,
        });
      } catch {
        /* swallow */
      }
    }
    const failed: Record<string, "completed" | "failed"> = {};
    const errors: Record<string, string> = {};
    for (const t of args.tasks) {
      failed[t.id] = "failed";
      errors[t.id] = `error_stall_timeout: ${reason}`;
    }
    return {
      taskStatus: failed,
      errors,
      costUsd: 0,
      ...(isBuildAgent(agent) ? { lastWritingAgent: agent } : {}),
    };
  }

  if (queryThrew) {
    const msg = queryThrew.message;
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
    `"errors": { "<task-id>": "<message>" } }\n` +
    // bug-007: sentinel contract for unambiguous extraction. The orchestrator's
    // text parser is brittle against arbitrary markdown wrappers (backticks,
    // code fences, prose, emoji) — sentinels eliminate that ambiguity entirely.
    `\nIMPORTANT — wrap your final outcome JSON in <<<TASK_OUTCOME>>> and ` +
    `<<<END_TASK_OUTCOME>>> sentinels so the orchestrator can find it ` +
    `unambiguously. Example:\n` +
    `<<<TASK_OUTCOME>>>\n` +
    `{ "taskOutcomes": { "scaffold-next-app": "completed" }, "errors": {} }\n` +
    `<<<END_TASK_OUTCOME>>>\n` +
    `\nWrite whatever markdown summary you want OUTSIDE the sentinels — the ` +
    `summary helps human reviewers; the sentineled JSON is the machine-` +
    `parseable contract. Do NOT wrap the JSON inside the sentinels in ` +
    `markdown code fences or backticks.\n`;

  return prompt;
}

function buildAgentOptions(
  agent: AgentSequenceMember,
  args: Parameters<InvokeAgentFn>[0],
  cfg: CreateInvokeAgentConfig,
  modelConfig: ModelConfig,
  abortController?: AbortController,
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
    ...(abortController ? { abortController } : {}),
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
  // Strategy 1: SDK-native. When `Options.outputFormat: { type: 'json_schema',
  // schema }` is set AND honored, the SDK populates `structured_output`
  // with validated data. Empirically rare under Claude Max subscription auth
  // (separate investigation pending) but free when it works.
  if (result.subtype !== "success") {
    return {
      ok: false,
      reason: `SDK subtype was '${result.subtype}', not 'success'`,
    };
  }
  if (result.structured_output !== undefined) {
    return { ok: true, parsed: result.structured_output };
  }

  const text = result.result;
  if (!text || text.trim() === "") {
    return {
      ok: false,
      reason: "result.result was empty (no structured_output, no text)",
    };
  }

  // Strategy 2: sentinel-delimited block. The agent prompt (buildAgentPrompt)
  // instructs every agent to wrap final JSON in <<<TASK_OUTCOME>>>...<<<END_
  // TASK_OUTCOME>>>. ~95% reliable when the agent follows the prompt; covers
  // all current and future markdown-wrapper variants.
  const sentineled = findSentinelDelimitedJson(text);
  if (sentineled !== null) return { ok: true, parsed: sentineled };

  // Strategy 3: balanced-brace forward scan. Defense in depth for when the
  // agent forgets the sentinel pattern (~5-10% of dispatches). Walks `{`
  // positions from LAST to FIRST, scanning forward respecting JSON string
  // literals to find the matching `}`. Robust against trailing characters
  // (backticks, prose, code fences, emoji) — the scan ignores everything
  // after the matched `}`.
  const balanced = findBalancedJsonObject(text);
  if (balanced !== null) return { ok: true, parsed: balanced };

  // Strategy 4: rich diagnostic failure with tail breadcrumb. Tells the
  // operator EXACTLY what the agent emitted so the next debug cycle is
  // a 30-second read instead of a $6+ filesystem-archaeology session.
  const tail = text.length > 300 ? `...${text.slice(-300)}` : text;
  return {
    ok: false,
    reason: `no <<<TASK_OUTCOME>>> sentinel block found, no balanced JSON object found; tail was: ${JSON.stringify(tail)}`,
  };
}

/**
 * bug-007: extract JSON wrapped in <<<TASK_OUTCOME>>>...<<<END_TASK_OUTCOME>>>
 * sentinels. Tolerates an optional inner code fence (defensive — agents
 * may slip into wrapping JSON in ```json``` even when told not to). Returns
 * `null` when the sentinel block isn't present OR the inner content isn't
 * parseable JSON.
 */
function findSentinelDelimitedJson(text: string): unknown | null {
  const m = text.match(/<<<TASK_OUTCOME>>>([\s\S]*?)<<<END_TASK_OUTCOME>>>/);
  if (!m?.[1]) return null;
  let inner = m[1].trim();
  // Defense: agent may wrap inner JSON in a code fence anyway. Strip if so.
  const fenceStripped = inner.replace(
    /^```[a-zA-Z0-9]*\s*\n?([\s\S]*?)\n?```\s*$/,
    "$1",
  );
  if (fenceStripped !== inner) inner = fenceStripped.trim();
  try {
    return JSON.parse(inner);
  } catch {
    return null;
  }
}

/**
 * bug-007: find a well-formed JSON object somewhere in `text`, robust to
 * arbitrary characters before AND after the closing brace, AND robust to
 * `{...}`-shaped fragments appearing in surrounding prose. Returns the LAST
 * top-level JSON object whose parse yields a non-empty plain object.
 *
 * Algorithm:
 *  1. Walk the text forward from index 0.
 *  2. At each `{`, do a balanced-brace forward scan (respecting JSON string
 *     literals so internal `{`/`}` chars don't confuse the depth counter)
 *     to find the matching `}`. This identifies a TOP-LEVEL `{...}` region.
 *  3. Try `JSON.parse` on that region. If it parses to a plain object with
 *     at least one key, record it as a candidate.
 *  4. Skip past the matched region — we don't want to re-walk nested `{`s
 *     (the trailing JSON's inner `errors: {}` would otherwise win).
 *  5. After the walk, return the LAST candidate (most likely the agent's
 *     trailing status object).
 *
 * Why "last with keys" and not "last": the agent's status object is usually
 * the last well-formed top-level JSON in the text. Inner `{}` (empty errors
 * map) and JS-style destructuring `{ a, b, c }` either parse as empty or
 * fail entirely — neither becomes a candidate, so noise blocks don't crowd
 * out the real status.
 *
 * Time: O(n) overall — the outer index advances past every matched region.
 */
function findBalancedJsonObject(text: string): unknown | null {
  const candidates: object[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "{") {
      i++;
      continue;
    }
    const start = i;
    let depth = 0;
    let inString = false;
    let escape = false;
    let matched = -1;
    for (let j = start; j < text.length; j++) {
      const c = text[j];
      if (escape) {
        escape = false;
        continue;
      }
      if (inString) {
        if (c === "\\") {
          escape = true;
          continue;
        }
        if (c === '"') inString = false;
        continue;
      }
      if (c === '"') {
        inString = true;
        continue;
      }
      if (c === "{") {
        depth++;
        continue;
      }
      if (c === "}") {
        depth--;
        if (depth === 0) {
          matched = j;
          break;
        }
      }
    }
    if (matched === -1) {
      // Unbalanced from this `{` to end of text — skip this char and continue.
      i++;
      continue;
    }
    const candidate = text.slice(start, matched + 1);
    try {
      const parsed = JSON.parse(candidate);
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        Object.keys(parsed as object).length > 0
      ) {
        candidates.push(parsed as object);
      }
    } catch {
      /* not valid JSON; fine, move on */
    }
    // Skip past the matched region — we want top-level blocks only, not
    // nested ones (agent status JSON is the OUTER object, not its inner
    // `{ "errors": {} }` map).
    i = matched + 1;
  }
  return candidates.length > 0
    ? (candidates[candidates.length - 1] ?? null)
    : null;
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

/**
 * bug-012: deterministic lockfile-conflict resolver. pnpm-lock.yaml,
 * package-lock.json, and yarn.lock are content-addressed and structurally
 * non-mergeable; the canonical recipe is "checkout --theirs + regen + commit".
 *
 * Strict gate: only attempts when ALL conflicting files are lockfiles. If any
 * non-lockfile (e.g. package.json) is also conflicting, we bail and let the
 * agent handle it — package.json must be resolved first or the regenerated
 * lockfile won't match the merged manifest.
 *
 * On success: stages all regenerated lockfiles + finalizes the in-flight
 * merge commit. On any failure (regen, commit): aborts the merge so the
 * caller's normal failure path runs cleanly.
 */
const LOCKFILE_BASENAMES = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
]);

export interface LockfileAutoResolveResult {
  /** Lockfiles that were checked-out + regenerated + staged + committed. */
  resolved: string[];
  /** Conflict files still requiring agent handoff. */
  remaining: string[];
  /** Per-step log lines (success or failure). Always populated. */
  diagnostic: string[];
}

export async function tryAutoResolveLockfileConflicts(
  conflictingFiles: readonly string[],
  projectRoot: string,
  featureId: string,
  execGit: ExecGitFn,
  execShell: ShellExecFn,
): Promise<LockfileAutoResolveResult> {
  const lockfileConflicts = conflictingFiles.filter((f) =>
    LOCKFILE_BASENAMES.has(basename(f)),
  );
  const nonLockfile = conflictingFiles.filter(
    (f) => !LOCKFILE_BASENAMES.has(basename(f)),
  );

  // Strict gate — see header comment.
  if (lockfileConflicts.length === 0) {
    return {
      resolved: [],
      remaining: [...conflictingFiles],
      diagnostic: [
        "[lockfile-auto-resolve] no lockfile conflicts detected — skipping",
      ],
    };
  }
  if (nonLockfile.length > 0) {
    return {
      resolved: [],
      remaining: [...conflictingFiles],
      diagnostic: [
        `[lockfile-auto-resolve] mixed conflict (${nonLockfile.length} non-lockfile + ${lockfileConflicts.length} lockfile) — deferring to agent`,
      ],
    };
  }

  const diagnostic: string[] = [
    `[lockfile-auto-resolve] detected ${lockfileConflicts.length} lockfile-only conflict(s): ${lockfileConflicts.join(", ")}`,
  ];
  const resolved: string[] = [];

  for (const lockfile of lockfileConflicts) {
    let pm: "pnpm" | "npm" | "yarn";
    try {
      pm = detectPackageManager(lockfile);
    } catch (e) {
      diagnostic.push(
        `  ✗ unknown lockfile basename: ${lockfile} — bailing out`,
      );
      await tryMergeAbort(projectRoot, execGit, diagnostic);
      return { resolved: [], remaining: [...conflictingFiles], diagnostic };
    }

    try {
      // --theirs in merge context = the branch being merged IN (the feature
      // branch). Lockfile content gets overwritten by regen below; we just
      // need a non-conflicted file on disk for the package manager to read.
      await execGit(
        `git checkout --theirs ${shellQuote(lockfile)}`,
        projectRoot,
      );
      diagnostic.push(`  ✓ git checkout --theirs ${lockfile}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      diagnostic.push(`  ✗ checkout --theirs ${lockfile} failed: ${msg}`);
      await tryMergeAbort(projectRoot, execGit, diagnostic);
      return { resolved: [], remaining: [...conflictingFiles], diagnostic };
    }

    const regenCwd = join(projectRoot, dirname(lockfile));
    const regenCmd = lockfileRegenCommand(pm);
    const regen = await safeShellExec(execShell, regenCmd, regenCwd);
    if (regen.code !== 0) {
      diagnostic.push(
        `  ✗ ${pm} regen failed (cwd=${regenCwd}): ${regen.stderr.slice(0, 300) || "(no stderr)"}`,
      );
      await tryMergeAbort(projectRoot, execGit, diagnostic);
      return { resolved: [], remaining: [...conflictingFiles], diagnostic };
    }
    diagnostic.push(`  ✓ ${pm} regen ok (cwd=${regenCwd}): ${regenCmd}`);

    try {
      await execGit(`git add ${shellQuote(lockfile)}`, projectRoot);
      diagnostic.push(`  ✓ git add ${lockfile}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      diagnostic.push(`  ✗ git add ${lockfile} failed: ${msg}`);
      await tryMergeAbort(projectRoot, execGit, diagnostic);
      return { resolved: [], remaining: [...conflictingFiles], diagnostic };
    }
    resolved.push(lockfile);
  }

  // Finalize the in-flight merge. core.editor=true is the cross-platform
  // no-op editor (true succeeds with no output) so git won't try to open
  // an interactive editor for the merge message.
  try {
    await execGit(
      `git -c core.editor=true commit --no-edit -m "merge feat/${featureId}"`,
      projectRoot,
    );
    diagnostic.push(`  ✓ merge commit finalized for feat/${featureId}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    diagnostic.push(`  ✗ merge commit failed: ${msg}`);
    await tryMergeAbort(projectRoot, execGit, diagnostic);
    return { resolved: [], remaining: [...conflictingFiles], diagnostic };
  }

  return { resolved, remaining: [], diagnostic };
}

async function tryMergeAbort(
  projectRoot: string,
  execGit: ExecGitFn,
  diagnostic: string[],
): Promise<void> {
  try {
    await execGit("git merge --abort", projectRoot);
    diagnostic.push("  · git merge --abort (cleanup)");
  } catch {
    // best-effort — merge may already be in clean state
  }
}

function detectPackageManager(lockfile: string): "pnpm" | "npm" | "yarn" {
  const base = basename(lockfile);
  if (base === "pnpm-lock.yaml") return "pnpm";
  if (base === "package-lock.json") return "npm";
  if (base === "yarn.lock") return "yarn";
  throw new Error(`unknown lockfile: ${lockfile}`);
}

function lockfileRegenCommand(pm: "pnpm" | "npm" | "yarn"): string {
  // Lockfile-only flags avoid node_modules churn — fast on every project + CI.
  switch (pm) {
    case "pnpm":
      return "pnpm install --lockfile-only";
    case "npm":
      return "npm install --package-lock-only";
    case "yarn":
      return "yarn install --mode update-lockfile";
  }
}

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
