import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import yaml from "js-yaml";
import {
  BugsYamlSchema,
  type BugEntry,
  type BugsYaml,
  type BuildToSpecVerifyOutput,
} from "@repo/orchestrator-contracts";
import type { BudgetTracker } from "./budget-tracker.js";
import type { BuildToSpecVerifyContext } from "./build-to-spec-verify.js";
import type { InvokeAgentFn } from "./feature-graph.js";

/**
 * feat-026 — automated bug-fix loop runner.
 *
 * Reads `<projectRoot>/docs/bugs.yaml` (orchestrator-managed, populated by
 * the verifier in feat-022/feat-025), iterates verify→fix→verify until
 * either every bug is `completed` OR an iteration cap is hit OR no
 * pending bug remains workable. The loop runs INSIDE a single shared
 * `fixup` worktree so bugs accumulate fixes across iterations without
 * the parallel-feature contention bug-015 surfaced.
 *
 * IMPORTANT separation: `/plan-bug` (user-only) is unchanged; this loop
 * never reads or writes those plans. The standalone `bug-NNN-*.md` files
 * referenced from BugEntry.bugPlanPath are the auto-filed variant
 * `scripts/file-bug-plan.mjs` writes for the verifier — same disk
 * location, different channel.
 */

/** Per-iteration breakdown for the loop's return summary. */
export interface IterationSummary {
  iteration: number;
  bugsAttempted: number;
  bugsCompleted: number;
  bugsFailed: number;
  bugsRemaining: number;
  /** True if the post-iteration verify pass came back clean. */
  verifyOk: boolean;
  /** New bug ids the verify pass surfaced + appended to bugs.yaml this iteration. */
  newBugIds: string[];
  /** Bug ids that were `completed` last iteration but reappeared (flap). */
  reappearedBugIds: string[];
  iterationCostUsd: number;
}

export interface FixBugsLoopResult {
  status: "clean" | "iteration-cap-hit" | "all-bugs-failed" | "no-bugs";
  iterationsRun: number;
  bugsResolved: string[]; // bug ids
  bugsFailed: string[];
  bugsRemaining: string[]; // pending after cap hit
  totalCostUsd: number;
  iterationLog: IterationSummary[];
  /** Final verify output (last iteration's verify pass), if any. */
  finalVerify?: BuildToSpecVerifyOutput;
}

export type RunBuildToSpecVerifyFn = (
  ctx: BuildToSpecVerifyContext,
) => Promise<BuildToSpecVerifyOutput>;

export interface FixBugsLoopContext {
  projectRoot: string;
  pipelineRunId: string;
  /** Repo root for the factory itself (where scripts/ lives). */
  factoryRoot: string;
  budget: BudgetTracker;
  invokeAgent: InvokeAgentFn;
  runBuildToSpecVerify: RunBuildToSpecVerifyFn;
  /** Loop-iteration cap. Default 5 (matches plan §Phase B). */
  iterationCap?: number;
  /**
   * Reset-to-pending count after which a bug is escalated to `failed`
   * (flapping detector). Default 3.
   */
  maxFlapResets?: number;
  /** Path to the shared fixup worktree. Default `<projectRoot>/.claude/worktrees/fixup`. */
  fixupWorktreePath?: string;
  /** Branch name for the fixup worktree. Default `fix/bugs-yaml-iter`. */
  fixupBranchName?: string;
  /** Override path for `docs/bugs.yaml`. Default `<projectRoot>/docs/bugs.yaml`. */
  bugsYamlPath?: string;
  /**
   * When true, skip actually creating / closing the git worktree (tests
   * pass true; real runs leave undefined so default git behavior runs).
   * Defaults to true when invoked under vitest (NODE_ENV === "test")
   * unless explicitly overridden, false otherwise.
   */
  skipWorktreeManagement?: boolean;
}

/** Internal: filesystem helpers, injectable for tests via FixBugsLoopContext extras. */
function defaultBugsYamlPath(projectRoot: string): string {
  return join(projectRoot, "docs", "bugs.yaml");
}

function defaultFixupWorktreePath(projectRoot: string): string {
  return join(projectRoot, ".claude", "worktrees", "fixup");
}

function readBugsYaml(path: string): BugsYaml | null {
  if (!existsSync(path)) return null;
  try {
    const raw = yaml.load(readFileSync(path, "utf8"));
    const parsed = BugsYamlSchema.safeParse(raw);
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeBugsYaml(path: string, doc: BugsYaml): void {
  mkdirSync(dirname(path), { recursive: true });
  doc.generated_at = new Date().toISOString();
  writeFileSync(path, yaml.dump(doc, { lineWidth: 120 }));
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@/.:\\-]+$/.test(value)) return value;
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

/**
 * Open the shared fixup worktree on master. Idempotent — returns
 * silently if the worktree already exists. Uses the same `git worktree
 * add` pattern as `runCheckoutFeature` in invoke-agent.ts (cross-platform
 * shell quoting via `shellQuote`).
 *
 * Skipped when `skipWorktreeManagement` is true (tests + standalone
 * verify-without-loop runs).
 */
function openFixupWorktree(args: {
  projectRoot: string;
  worktreePath: string;
  branch: string;
}): { ok: true } | { ok: false; reason: string } {
  if (existsSync(args.worktreePath)) return { ok: true };
  mkdirSync(dirname(args.worktreePath), { recursive: true });
  try {
    execSync(
      `git worktree add ${shellQuote(args.worktreePath)} -b ${shellQuote(args.branch)}`,
      { cwd: args.projectRoot, stdio: ["ignore", "pipe", "pipe"] },
    );
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Tear down the shared fixup worktree at loop exit. Best-effort — leaves
 * a warning on the result rather than throwing (the loop's bug outcomes
 * are the actual source of truth, not the worktree state).
 */
function closeFixupWorktree(args: {
  projectRoot: string;
  worktreePath: string;
  branch: string;
  mergeFirst: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (!existsSync(args.worktreePath)) return { ok: true };
  try {
    // bug-027: remove worktree FIRST. Empirically observed: when the
    // fixup worktree has the fix branch checked out, `git merge --no-ff
    // <branch>` from projectRoot fails with "branch is checked out
    // elsewhere" — silently swallowed by the prior try/catch, leaving
    // master without the fixes. Removing the worktree releases the
    // branch and lets the merge succeed.
    execSync(`git worktree remove --force ${shellQuote(args.worktreePath)}`, {
      cwd: args.projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (args.mergeFirst) {
      // Attempt to merge fixup branch back to master after worktree release.
      try {
        execSync(
          `git merge --no-ff ${shellQuote(args.branch)} -m "merge ${args.branch} (fix-bugs-loop)"`,
          { cwd: args.projectRoot, stdio: ["ignore", "pipe", "pipe"] },
        );
      } catch (mergeErr) {
        // Conflict or no commits — surface as warning instead of silent
        // (bug-027 root cause: prior code swallowed merge errors entirely,
        // operators only noticed when checking master HEAD post-run).
        const detail =
          mergeErr instanceof Error ? mergeErr.message : String(mergeErr);
        process.stderr.write(
          `[fix-bugs-loop] WARNING: auto-merge of ${args.branch} failed; fixes remain on the branch. Run \`git merge --no-ff ${args.branch}\` manually. Detail: ${detail}\n`,
        );
      }
    }
    try {
      execSync(`git branch -D ${shellQuote(args.branch)}`, {
        cwd: args.projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      /* branch may have been merged + auto-cleaned, or merge failed and
       operator wants to keep it for manual recovery */
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Comparator: P0 > P1 > P2; within tier, the cascade-root sources sort
 * FIRST (feat-027): dev-server-compile + runtime-error typically mask every
 * downstream flow failure, so the loop fixes them before chasing dependent
 * timeouts. After cascade-roots: orphan → flow → coverage. Visual-parity
 * (feat-028) sits between orphan and flow since a stripped-shell breaks
 * every assertion downstream.
 */
function bugPriorityComparator(a: BugEntry, b: BugEntry): number {
  const sevOrder = { P0: 0, P1: 1, P2: 2 } as const;
  const sevDelta = sevOrder[a.severity] - sevOrder[b.severity];
  if (sevDelta !== 0) return sevDelta;
  const sourceOrder: Record<BugEntry["source"], number> = {
    "dev-server-compile": 0, // feat-027 — page literally won't render
    "runtime-error": 1, // feat-027 — JS error prevents interaction
    "reachability-orphan": 2,
    "visual-parity": 3, // feat-028 — DOM-skeleton / computed-style mismatch
    "flow-execution-failure": 4,
    "pm-coverage-omission": 5,
  };
  return sourceOrder[a.source] - sourceOrder[b.source];
}

/**
 * Build the `retryContext.errorMessage` string handed to the dispatched
 * agent. Carries the bug summary + (when present) the screenshot path +
 * the suggested integration point so the builder doesn't have to
 * re-derive context from scratch.
 */
function buildRetryContextMessage(bug: BugEntry): string {
  const lines: string[] = [];
  lines.push(`Bug ${bug.id} (iteration ${bug.iteration}): ${bug.summary}`);
  if (bug.flow) {
    lines.push(
      `  Flow ${bug.flow.id} step ${bug.flow.failedStep}: clicked ${bug.flow.selector ?? "(no selector)"} on ${bug.flow.expectedScreenId}; landed on ${bug.flow.actualScreenId ?? "(no screen-id)"}`,
    );
    if (bug.flow.screenshot) lines.push(`  Screenshot: ${bug.flow.screenshot}`);
    if (bug.flow.htmlDump) lines.push(`  HTML dump: ${bug.flow.htmlDump}`);
  }
  if (bug.orphan) {
    lines.push(
      `  Orphan: ${bug.orphan.componentPath} exports ${(bug.orphan.exportNames ?? []).join(", ") || "(default)"}`,
    );
    if ((bug.orphan.suggestedImporters ?? []).length > 0) {
      lines.push(
        `  Suggested integration points: ${bug.orphan.suggestedImporters.slice(0, 3).join(", ")}`,
      );
    }
  }
  if (bug.bugPlanPath) lines.push(`  Plan: ${bug.bugPlanPath}`);
  if ((bug.errorLog ?? []).length > 0) {
    lines.push(`  Prior attempts:`);
    for (const e of bug.errorLog.slice(-3)) lines.push(`    - ${e}`);
  }
  return lines.join("\n");
}

/**
 * Run agent_sequence sequentially against a single bug in the fixup
 * worktree. Returns success once every agent completes; on first agent
 * failure aborts + logs to bug.errorLog, leaving the bug pending for
 * a future attempt (or for the loop's post-attempt cap check).
 */
async function dispatchAgentsForBug(args: {
  bug: BugEntry;
  ctx: FixBugsLoopContext;
  worktreeCwd: string;
}): Promise<{ success: boolean; costUsd: number; errorLog: string[] }> {
  const { bug, ctx, worktreeCwd } = args;
  let costUsd = 0;
  const errorLog: string[] = [];
  const featureContext = {
    id: bug.id,
    branch: ctx.fixupBranchName ?? "fix/bugs-yaml-iter",
    priority: bug.severity,
  };

  // Synthetic task — bug-fix work isn't expressed as a tasks.yaml task,
  // but the InvokeAgentFn contract takes a Task[] so we synthesize one
  // matching the bug shape. agent + id mirror the bug's identity.
  const syntheticTaskBase = {
    depends_on: [] as string[],
    skills: [] as string[],
    status: "pending" as const,
    screens: [] as string[],
    summary: bug.summary,
  };

  for (const agent of bug.agentSequence) {
    if (agent === "git-agent") continue; // worktree lifecycle is loop-owned
    const syntheticTask = {
      id: `${bug.id}-${agent}`,
      agent,
      ...syntheticTaskBase,
    };
    const result = await ctx.invokeAgent({
      agent,
      cwd: worktreeCwd,
      featureContext,
      tasks: [syntheticTask],
      retryContext: {
        taskId: syntheticTask.id,
        errorMessage: buildRetryContextMessage(bug),
      },
    });
    costUsd += result.costUsd;
    const taskOutcome = result.taskStatus[syntheticTask.id];
    if (taskOutcome !== "completed") {
      errorLog.push(
        `[${agent}] ${result.errors[syntheticTask.id] ?? "agent did not return success"}`,
      );
      return { success: false, costUsd, errorLog };
    }
  }

  return { success: true, costUsd, errorLog };
}

/**
 * Detect new bugs in the latest verify output that aren't already in
 * bugs.yaml. The verifier appends them to bugs.yaml automatically (via
 * `scripts/file-bug-plan.mjs` → `appendBugToYaml`); this returns the ids
 * for the iteration-summary breakdown.
 */
function detectNewBugIds(
  preVerifyIds: ReadonlySet<string>,
  postVerifyDoc: BugsYaml,
): string[] {
  const out: string[] = [];
  for (const b of postVerifyDoc.bugs) {
    if (!preVerifyIds.has(b.id)) out.push(b.id);
  }
  return out;
}

/**
 * Detect bugs that were `completed` last iteration but reappeared this
 * iteration. Flapping protection bumps `flapResets` and resets `attempts`
 * to 0; on `flapResets >= maxFlapResets`, the bug is marked `failed`.
 */
function applyFlappingDetection(args: {
  pre: ReadonlyMap<string, BugEntry>;
  post: BugsYaml;
  maxFlapResets: number;
}): { reappeared: string[]; flapEscalated: string[] } {
  const reappeared: string[] = [];
  const flapEscalated: string[] = [];
  for (const b of args.post.bugs) {
    const prior = args.pre.get(b.id);
    if (!prior) continue;
    if (prior.status === "completed" && b.status !== "completed") {
      reappeared.push(b.id);
      b.flapResets = (b.flapResets ?? 0) + 1;
      if (b.flapResets >= args.maxFlapResets) {
        b.status = "failed";
        b.errorLog.push(
          `flapping-detector: bug reappeared ${b.flapResets} times across iterations; escalating to failed`,
        );
        flapEscalated.push(b.id);
      } else {
        b.status = "pending";
        b.attempts = 0;
        b.errorLog.push(
          `flapping-detector: bug reappeared after iteration ${prior.resolvedInIteration ?? prior.iteration}; resetting attempts (flapResets=${b.flapResets})`,
        );
      }
    }
  }
  return { reappeared, flapEscalated };
}

/**
 * The main loop. See plan §Phase B for the spec; this implementation
 * matches the pseudocode there with the worktree-lifecycle decisions
 * called out in the file-level docstring above.
 */
export async function runFixBugsLoop(
  ctx: FixBugsLoopContext,
): Promise<FixBugsLoopResult> {
  const bugsYamlPath = ctx.bugsYamlPath ?? defaultBugsYamlPath(ctx.projectRoot);
  const iterationCap = ctx.iterationCap ?? 5;
  const maxFlapResets = ctx.maxFlapResets ?? 3;
  const worktreePath = resolve(
    ctx.fixupWorktreePath ?? defaultFixupWorktreePath(ctx.projectRoot),
  );
  const fixupBranch = ctx.fixupBranchName ?? "fix/bugs-yaml-iter";
  const skipWorktreeManagement =
    ctx.skipWorktreeManagement ??
    (process.env.NODE_ENV === "test" || process.env.VITEST !== undefined);

  const iterationLog: IterationSummary[] = [];
  let totalCostUsd = 0;
  let finalVerify: BuildToSpecVerifyOutput | undefined;

  let doc = readBugsYaml(bugsYamlPath);
  if (!doc) {
    return {
      status: "no-bugs",
      iterationsRun: 0,
      bugsResolved: [],
      bugsFailed: [],
      bugsRemaining: [],
      totalCostUsd: 0,
      iterationLog: [],
    };
  }
  if (doc.bugs.length === 0) {
    return {
      status: "no-bugs",
      iterationsRun: 0,
      bugsResolved: [],
      bugsFailed: [],
      bugsRemaining: [],
      totalCostUsd: 0,
      iterationLog: [],
    };
  }

  // Open the shared fixup worktree once at loop entry. We keep it open
  // across all iterations so per-iteration verify sees the accumulated
  // fixes (well, after each iteration's merge — see end-of-iteration
  // step below).
  if (!skipWorktreeManagement) {
    const open = openFixupWorktree({
      projectRoot: ctx.projectRoot,
      worktreePath,
      branch: fixupBranch,
    });
    if (!open.ok) {
      return {
        status: "all-bugs-failed",
        iterationsRun: 0,
        bugsResolved: [],
        bugsFailed: doc.bugs.map((b) => b.id),
        bugsRemaining: [],
        totalCostUsd: 0,
        iterationLog: [],
      };
    }
  }
  const worktreeCwd = skipWorktreeManagement ? ctx.projectRoot : worktreePath;

  let status: FixBugsLoopResult["status"] = "iteration-cap-hit";
  let iteration = doc.iteration;

  for (let i = 0; i < iterationCap; i++) {
    iteration = doc.iteration;
    const iterationStartCost = totalCostUsd;
    // Pick pending OR in-progress (resumed mid-attempt) bugs whose
    // attempts haven't hit their cap. Treat in-progress as pending: the
    // prior attempt either crashed or was killed mid-flight, so we get a
    // fresh attempt subject to the same cap.
    const pendingThisIter = [...doc.bugs]
      .filter(
        (b) =>
          (b.status === "pending" || b.status === "in-progress") &&
          (b.attempts ?? 0) < b.maxAttempts,
      )
      .sort(bugPriorityComparator);

    if (pendingThisIter.length === 0) {
      // No work to do. If the loop hasn't run a verify yet AND every bug
      // is already completed, treat as clean.
      const anyFailed = doc.bugs.some((b) => b.status === "failed");
      const anyPending = doc.bugs.some((b) => b.status === "pending");
      if (!anyFailed && !anyPending) {
        status = "clean";
      } else if (anyFailed && !anyPending) {
        status = "all-bugs-failed";
      } else {
        status = "iteration-cap-hit";
      }
      break;
    }

    let attemptedCount = 0;
    let completedCount = 0;
    let failedCount = 0;
    for (const bug of pendingThisIter) {
      bug.attempts = (bug.attempts ?? 0) + 1;
      bug.status = "in-progress";
      attemptedCount += 1;
      // Persist BEFORE dispatch so a crash mid-agent leaves the bug
      // marked in-progress (not pending) — the resume helper can then
      // detect partial work + decide whether to re-attempt.
      writeBugsYaml(bugsYamlPath, doc);

      const dispatch = await dispatchAgentsForBug({
        bug,
        ctx,
        worktreeCwd,
      });
      totalCostUsd += dispatch.costUsd;

      if (dispatch.success) {
        bug.status = "completed";
        bug.resolvedInIteration = iteration;
        completedCount += 1;
      } else {
        for (const entry of dispatch.errorLog) bug.errorLog.push(entry);
        if (bug.attempts >= bug.maxAttempts) {
          bug.status = "failed";
          failedCount += 1;
        } else {
          // Leave pending for a subsequent iteration's retry pool.
          bug.status = "pending";
        }
      }
      // Persist after each bug so a crash mid-iteration leaves a usable
      // checkpoint for resume.
      writeBugsYaml(bugsYamlPath, doc);
    }

    // Snapshot pre-verify state for new-bug + flap detection.
    const preVerifyIds = new Set(doc.bugs.map((b) => b.id));
    const preVerifyByid = new Map(doc.bugs.map((b) => [b.id, { ...b }]));

    // Re-run verify with iteration+1 so any newly-filed bugs are tagged
    // with the iteration they FIRST appeared in (not the one we just
    // ran fixes against).
    const verifyArgs: BuildToSpecVerifyContext = {
      projectDir: ctx.projectRoot,
      autoFileBugPlans: true,
      pipelineRunId: ctx.pipelineRunId,
      iteration: iteration + 1,
    };
    if (ctx.factoryRoot !== undefined) verifyArgs.factoryRoot = ctx.factoryRoot;
    let verify: BuildToSpecVerifyOutput | undefined;
    try {
      verify = await ctx.runBuildToSpecVerify(verifyArgs);
      finalVerify = verify;
      totalCostUsd += verify.costUsd;
    } catch {
      // Treat verify failure as iteration cap continuation; the loop will
      // retry on next pass. Persist warning into the iteration summary.
    }

    // Re-read bugs.yaml — the verify step appends new entries via
    // `scripts/file-bug-plan.mjs::appendBugToYaml`. We need the fresh
    // doc to detect new + reappeared bugs.
    const refreshed = readBugsYaml(bugsYamlPath);
    if (refreshed) doc = refreshed;

    const newBugIds = detectNewBugIds(preVerifyIds, doc);
    const flap = applyFlappingDetection({
      pre: preVerifyByid,
      post: doc,
      maxFlapResets,
    });
    const remainingPending = doc.bugs.filter(
      (b) => b.status === "pending",
    ).length;

    // Bump iteration counter for the next pass + persist.
    doc.iteration = iteration + 1;
    writeBugsYaml(bugsYamlPath, doc);

    iterationLog.push({
      iteration,
      bugsAttempted: attemptedCount,
      bugsCompleted: completedCount,
      bugsFailed: failedCount,
      bugsRemaining: remainingPending,
      verifyOk: verify?.ok ?? false,
      newBugIds,
      reappearedBugIds: flap.reappeared,
      iterationCostUsd: totalCostUsd - iterationStartCost,
    });

    // Exit condition: verify clean AND no pending bugs AND no failed bugs.
    // (Failed bugs override "clean" — they're a hard signal something
    // unfixable lives in the codebase even if verify happens to be ok.)
    const anyPending = doc.bugs.some((b) => b.status === "pending");
    const anyFailed = doc.bugs.some((b) => b.status === "failed");
    if (verify?.ok && !anyPending && !anyFailed) {
      status = "clean";
      break;
    }
    // Exit condition: nothing more we can work on.
    if (!anyPending) {
      const anyCompleted = doc.bugs.some((b) => b.status === "completed");
      if (anyFailed) {
        status = "all-bugs-failed";
      } else {
        status = anyCompleted ? "clean" : "all-bugs-failed";
      }
      break;
    }
  }

  if (!skipWorktreeManagement) {
    closeFixupWorktree({
      projectRoot: ctx.projectRoot,
      worktreePath,
      branch: fixupBranch,
      mergeFirst: status === "clean",
    });
  }

  const bugsResolved = doc.bugs
    .filter((b) => b.status === "completed")
    .map((b) => b.id);
  const bugsFailed = doc.bugs
    .filter((b) => b.status === "failed")
    .map((b) => b.id);
  const bugsRemaining = doc.bugs
    .filter((b) => b.status === "pending" || b.status === "in-progress")
    .map((b) => b.id);

  return {
    status,
    iterationsRun: iterationLog.length,
    bugsResolved,
    bugsFailed,
    bugsRemaining,
    totalCostUsd,
    iterationLog,
    ...(finalVerify ? { finalVerify } : {}),
  };
}
