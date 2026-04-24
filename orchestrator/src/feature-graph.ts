import type {
  AgentSequenceMember,
  Feature,
  GateResolution,
  GitAgentOutput,
  Task,
  TasksV2,
} from "@repo/orchestrator-contracts";
import { GitAgentOutput as GitAgentOutputSchema } from "@repo/orchestrator-contracts";
import type { BudgetTracker } from "./budget-tracker.js";
import { waitForGateDecision } from "./gate-server-lifecycle.js";
import type { RetryCounters } from "./retry-counters.js";
import { saveState } from "./state-persistence.js";

/**
 * Gate 6 (pr-review) waiter. Fires between the last agent in
 * `agent_sequence` (typically reviewer) and git-agent `close-feature`.
 * Injectable so tests can stub without touching the filesystem; default
 * delegates to `waitForGateDecision({ gateType: "pr-review", featureId })`.
 */
export type WaitForPrReviewGateFn = (args: {
  featureId: string;
  projectRoot: string;
}) => Promise<GateResolution>;

/**
 * Surface of a build-agent for `feature.skip[]` logic. Tester / reviewer /
 * security / devops apply to all surfaces and return null.
 */
export function agentSurface(
  agent: AgentSequenceMember,
): "web" | "mobile" | "backend" | null {
  switch (agent) {
    case "backend-builder":
      return "backend";
    case "web-frontend-builder":
      return "web";
    case "mobile-frontend-builder":
      return "mobile";
    default:
      return null;
  }
}

/**
 * Primitive for invoking a named agent inside a feature worktree. This is
 * Mode B's analog of runStage's Agent-SDK wrapper — but without
 * pipeline-level gates. `runFeature` calls this for every
 * agent_sequence[] member and for the surrounding git-agent lifecycle.
 *
 * Injectable. Default wiring (Phase 9) binds this to the real SDK; tests
 * supply a stub that scripts per-task outcomes.
 */
export type InvokeAgentFn = (args: {
  agent: AgentSequenceMember | "git-agent";
  cwd: string;
  featureContext: { id: string; branch: string; priority: string };
  tasks: readonly Task[];
  retryContext?: { taskId: string; errorMessage: string };
  gitOp?: GitOpInput;
}) => Promise<InvokeAgentResult>;

export type GitOpInput =
  | {
      op: "checkout-feature";
      worktree: string;
      branch: string;
      featureId: string;
    }
  | { op: "close-feature"; worktree: string; featureId: string }
  | {
      op: "resolve-conflict-handoff";
      worktree: string;
      conflictingFiles: readonly string[];
      lastWritingAgent: string;
      attempt: number;
      mergeBaseSha: string;
      mainHeadSha: string;
      featureHeadSha: string;
    }
  | {
      op: "emergency-abort";
      worktree: string;
      featureId: string;
      reason: string;
    };

export interface InvokeAgentResult {
  /** Per-task outcome. Only meaningful for build-agents; git-agent leaves empty. */
  taskStatus: Record<string, "completed" | "failed">;
  /** Per-task error messages (when status=failed). */
  errors: Record<string, string>;
  /** Name of the agent that most recently wrote to the worktree — used to
   *  seed the conflict-handoff's `lastWritingAgent` on close-feature. */
  lastWritingAgent?: AgentSequenceMember;
  /** Raw git-agent output (when agent === "git-agent"); otherwise undefined. */
  gitAgentOutput?: GitAgentOutput;
  /** Cost recorded for this invocation — summed into Mode B totals. */
  costUsd: number;
}

export interface FeatureGraphContext {
  projectRoot: string;
  pipelineRunId: string;
  budget: BudgetTracker;
  retryCounters: RetryCounters;
  invokeAgent: InvokeAgentFn;
  /** Parallelism cap for runFeatureGraph. Defaults to 4. */
  maxConcurrentFeatures?: number;
  /**
   * Skip gate 6 (pr-review) — auto-merge once reviewer approves. Default
   * false. Investigate-002 answer #1: gate 6 is opt-in for the first ~5
   * autonomous runs; this flag lets trust build by flipping to opt-out.
   */
  autoMergeAfterReviewer?: boolean;
  /**
   * Override the gate-6 watcher. Default delegates to
   * `waitForGateDecision` (file-drop at `docs/gate-6-approved-{id}.txt`).
   */
  waitForPrReviewGate?: WaitForPrReviewGateFn;
}

export type FeatureStatus = "completed" | "failed" | "aborted";

export interface FeatureResult {
  featureId: string;
  status: FeatureStatus;
  durationMs: number;
  attempts: number;
  totalCostUsd: number;
  /** Human-readable reason when status !== "completed". */
  abortReason?: string;
  /** Per-task terminal outcome across all agents in the sequence. */
  taskOutcomes: Record<string, "completed" | "failed">;
}

export interface FeatureGraphResult {
  completed: string[];
  failed: string[];
  totalCostUsd: number;
  featureResults: Record<string, FeatureResult>;
}

const TASK_RETRY_CAP = 3;
const MERGE_CONFLICT_CAP = 3;

/**
 * Per refactor-004 Appendix D: open a worktree, walk agent_sequence[]
 * with per-task retries, close the worktree (merge to main), handle
 * merge conflicts via resolve-conflict-handoff routing.
 */
export async function runFeature(
  feature: Feature,
  ctx: FeatureGraphContext,
): Promise<FeatureResult> {
  const startedAt = Date.now();
  const featureContext = {
    id: feature.id,
    branch: feature.branch,
    priority: feature.priority,
  };
  // Absolute path: SDK's child_process.spawn would otherwise resolve a
  // project-relative cwd against the orchestrator's process.cwd() (factory
  // root), which is the wrong dir.
  const worktreeCwd = `${ctx.projectRoot}/.claude/worktrees/${feature.worktree}`;
  const taskOutcomes: Record<string, "completed" | "failed"> = {};
  let totalCostUsd = 0;
  let attempts = 0;
  let lastWritingAgent: AgentSequenceMember | undefined;

  // 0. Fast-skip — if every task in this feature is already status: completed,
  //    the feature was finished in a prior run (or by a prior smoke test) and
  //    merged to main. Don't re-checkout / re-run / re-merge. Cheap idempotency
  //    that keeps resumed pipelines from duplicating work.
  if (
    feature.tasks.length > 0 &&
    feature.tasks.every((t) => t.status === "completed")
  ) {
    for (const t of feature.tasks) taskOutcomes[t.id] = "completed";
    return {
      featureId: feature.id,
      status: "completed",
      durationMs: Date.now() - startedAt,
      attempts: 0,
      totalCostUsd: 0,
      taskOutcomes,
    };
  }

  // 1. Checkout feature worktree
  const checkout = await ctx.invokeAgent({
    agent: "git-agent",
    cwd: ctx.projectRoot,
    featureContext,
    tasks: [],
    gitOp: {
      op: "checkout-feature",
      worktree: feature.worktree,
      branch: feature.branch,
      featureId: feature.id,
    },
  });
  totalCostUsd += checkout.costUsd;

  const checkoutParsed = validateGitOutput(checkout.gitAgentOutput);
  if (
    !checkoutParsed ||
    checkoutParsed.op !== "checkout-feature" ||
    !checkoutParsed.success
  ) {
    return finish(
      feature.id,
      "failed",
      startedAt,
      attempts,
      totalCostUsd,
      taskOutcomes,
      `checkout-feature failed: ${JSON.stringify(checkoutParsed ?? checkout.gitAgentOutput)}`,
    );
  }

  // 2. Walk agent_sequence[]
  for (const agentName of feature.agent_sequence) {
    if (agentName === "git-agent") continue; // lifecycle is owned by the orchestrator

    const surface = agentSurface(agentName);
    if (surface && feature.skip.includes(surface)) continue;

    const agentTasks = feature.tasks.filter((t) => t.agent === agentName);
    if (agentTasks.length === 0) continue;

    attempts += 1;
    const result = await ctx.invokeAgent({
      agent: agentName,
      cwd: worktreeCwd,
      featureContext,
      tasks: agentTasks,
    });
    totalCostUsd += result.costUsd;
    lastWritingAgent = result.lastWritingAgent ?? agentName;

    // Merge per-task outcomes
    for (const t of agentTasks) {
      const status = result.taskStatus[t.id] ?? "failed";
      taskOutcomes[t.id] = status;
    }

    // Per-task retry
    for (const t of agentTasks) {
      if (result.taskStatus[t.id] !== "failed") continue;

      const counterKey = `${feature.id}/${t.id}`;
      while (!ctx.retryCounters.isExhausted("task-retry", counterKey)) {
        const counterValue = ctx.retryCounters.increment(
          "task-retry",
          counterKey,
        );
        saveState(
          ctx.projectRoot,
          ctx.pipelineRunId,
          ctx.retryCounters,
          ctx.budget,
        );
        if (counterValue > TASK_RETRY_CAP) break;

        attempts += 1;
        const retryResult = await ctx.invokeAgent({
          agent: agentName,
          cwd: worktreeCwd,
          featureContext,
          tasks: [t],
          retryContext: {
            taskId: t.id,
            errorMessage: result.errors[t.id] ?? "unknown error",
          },
        });
        totalCostUsd += retryResult.costUsd;
        lastWritingAgent = retryResult.lastWritingAgent ?? agentName;

        if (retryResult.taskStatus[t.id] === "completed") {
          taskOutcomes[t.id] = "completed";
          break;
        }
        taskOutcomes[t.id] = "failed";
        result.errors[t.id] =
          retryResult.errors[t.id] ?? result.errors[t.id] ?? "retry failed";
      }

      if (taskOutcomes[t.id] !== "completed") {
        return finish(
          feature.id,
          "failed",
          startedAt,
          attempts,
          totalCostUsd,
          taskOutcomes,
          `task ${t.id} failed after ${TASK_RETRY_CAP} attempts: ${result.errors[t.id] ?? "n/a"}`,
        );
      }
    }
  }

  // 3. Gate 6 (pr-review) — fires between reviewer-approve and merge.
  // Only when the feature actually had a reviewer step AND the autonomy
  // opt-out flag isn't set. Reviewer's successful completion is implicit
  // by reaching this point without an earlier early-return.
  const reviewerInSequence = feature.agent_sequence.includes("reviewer");
  if (reviewerInSequence && !ctx.autoMergeAfterReviewer) {
    const gate6 =
      ctx.waitForPrReviewGate ??
      (async ({ featureId, projectRoot }) =>
        waitForGateDecision({
          gateType: "pr-review",
          projectRoot,
          stageName: "pr-review",
          featureId,
        }));
    const decision = await gate6({
      featureId: feature.id,
      projectRoot: ctx.projectRoot,
    });
    if (!decision.approved) {
      return finish(
        feature.id,
        "failed",
        startedAt,
        attempts,
        totalCostUsd,
        taskOutcomes,
        `gate-6-rejected: ${decision.note ?? "no note"}`,
      );
    }
  }

  // 4. Merge back via close-feature
  const closeResult = await attemptCloseFeature(
    feature,
    featureContext,
    worktreeCwd,
    lastWritingAgent,
    ctx,
  );
  totalCostUsd += closeResult.costUsd;

  if (!closeResult.success) {
    return finish(
      feature.id,
      "failed",
      startedAt,
      attempts,
      totalCostUsd,
      taskOutcomes,
      closeResult.reason ?? "close-feature failed",
    );
  }

  return finish(
    feature.id,
    "completed",
    startedAt,
    attempts,
    totalCostUsd,
    taskOutcomes,
  );
}

interface CloseAttemptResult {
  success: boolean;
  costUsd: number;
  reason?: string;
}

/**
 * Close-feature with merge-conflict routing. On conflict: invoke
 * resolve-conflict-handoff with the last-writing agent, have them
 * resolve in the worktree, retry close-feature (up to
 * MERGE_CONFLICT_CAP). On exhaust: emergency-abort.
 */
async function attemptCloseFeature(
  feature: Feature,
  featureContext: { id: string; branch: string; priority: string },
  worktreeCwd: string,
  lastWritingAgent: AgentSequenceMember | undefined,
  ctx: FeatureGraphContext,
): Promise<CloseAttemptResult> {
  let costUsd = 0;
  let attempt = 0;

  while (attempt < MERGE_CONFLICT_CAP) {
    attempt += 1;
    const close = await ctx.invokeAgent({
      agent: "git-agent",
      cwd: ctx.projectRoot,
      featureContext,
      tasks: [],
      gitOp: {
        op: "close-feature",
        worktree: feature.worktree,
        featureId: feature.id,
      },
    });
    costUsd += close.costUsd;

    const parsed = validateGitOutput(close.gitAgentOutput);
    if (!parsed || parsed.op !== "close-feature") {
      return {
        success: false,
        costUsd,
        reason: `close-feature returned unexpected payload: ${JSON.stringify(parsed ?? close.gitAgentOutput)}`,
      };
    }

    if (parsed.success === true && parsed.conflict === false) {
      return { success: true, costUsd };
    }

    // Conflict path
    if (parsed.success !== false || parsed.conflict !== true) {
      return {
        success: false,
        costUsd,
        reason: `close-feature returned unrecognized conflict shape: ${JSON.stringify(parsed)}`,
      };
    }

    ctx.retryCounters.increment("merge-conflict", feature.id);
    saveState(
      ctx.projectRoot,
      ctx.pipelineRunId,
      ctx.retryCounters,
      ctx.budget,
    );

    const conflictingAgent = parsed.lastWritingAgent as AgentSequenceMember;
    const effectiveAgent =
      lastWritingAgent ?? conflictingAgent ?? "backend-builder";

    const handoff = await ctx.invokeAgent({
      agent: effectiveAgent,
      cwd: worktreeCwd,
      featureContext,
      tasks: [],
      retryContext: {
        taskId: `merge-conflict-attempt-${attempt}`,
        errorMessage: `Conflict on files: ${parsed.conflictingFiles.join(", ")}`,
      },
    });
    costUsd += handoff.costUsd;

    if (ctx.retryCounters.isExhausted("merge-conflict", feature.id)) {
      // Emergency abort
      const abort = await ctx.invokeAgent({
        agent: "git-agent",
        cwd: ctx.projectRoot,
        featureContext,
        tasks: [],
        gitOp: {
          op: "emergency-abort",
          worktree: feature.worktree,
          featureId: feature.id,
          reason: `merge-conflict retries exhausted after ${MERGE_CONFLICT_CAP} attempts`,
        },
      });
      costUsd += abort.costUsd;
      return {
        success: false,
        costUsd,
        reason: `merge-conflict exhausted after ${MERGE_CONFLICT_CAP} attempts; emergency-abort fired`,
      };
    }
  }

  return {
    success: false,
    costUsd,
    reason: `close-feature loop completed without resolution`,
  };
}

function validateGitOutput(
  raw: GitAgentOutput | undefined,
): GitAgentOutput | null {
  if (!raw) return null;
  const parsed = GitAgentOutputSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function finish(
  featureId: string,
  status: FeatureStatus,
  startedAt: number,
  attempts: number,
  totalCostUsd: number,
  taskOutcomes: Record<string, "completed" | "failed">,
  abortReason?: string,
): FeatureResult {
  const result: FeatureResult = {
    featureId,
    status,
    durationMs: Date.now() - startedAt,
    attempts,
    totalCostUsd,
    taskOutcomes,
  };
  if (abortReason) result.abortReason = abortReason;
  return result;
}

/**
 * Topological driver — runs features honoring feature.depends_on,
 * executing ready features in parallel up to maxConcurrentFeatures.
 */
export async function runFeatureGraph(
  tasks: TasksV2,
  ctx: FeatureGraphContext,
): Promise<FeatureGraphResult> {
  assertNoDependencyCycle(tasks.features);

  const concurrency = ctx.maxConcurrentFeatures ?? 4;
  const features = tasks.features;
  const completed = new Set<string>();
  const failed = new Set<string>();
  const inFlight = new Map<string, Promise<FeatureResult>>();
  const featureResults: Record<string, FeatureResult> = {};
  let totalCostUsd = 0;

  const remaining = new Set(features.map((f) => f.id));

  while (remaining.size > 0 || inFlight.size > 0) {
    // Drain doomed features whose dependencies have already failed —
    // these never run; they're recorded as aborted.
    for (const f of features) {
      if (!remaining.has(f.id)) continue;
      const depFailed = f.depends_on.find((d) => failed.has(d));
      if (!depFailed) continue;
      remaining.delete(f.id);
      failed.add(f.id);
      featureResults[f.id] = {
        featureId: f.id,
        status: "aborted",
        durationMs: 0,
        attempts: 0,
        totalCostUsd: 0,
        taskOutcomes: {},
        abortReason: `dependency ${depFailed} failed`,
      };
    }

    // Schedule ready features up to concurrency
    while (inFlight.size < concurrency) {
      const ready = features.find(
        (f) =>
          remaining.has(f.id) &&
          !inFlight.has(f.id) &&
          f.depends_on.every((d) => completed.has(d)),
      );
      if (!ready) break;

      remaining.delete(ready.id);
      inFlight.set(
        ready.id,
        runFeature(ready, ctx).then((r) => {
          featureResults[r.featureId] = r;
          totalCostUsd += r.totalCostUsd;
          if (r.status === "completed") completed.add(r.featureId);
          else failed.add(r.featureId);
          return r;
        }),
      );
    }

    if (inFlight.size === 0) break;

    const settled = await Promise.race(
      [...inFlight.entries()].map(([id, p]) => p.then(() => id)),
    );
    inFlight.delete(settled);
  }

  return {
    completed: [...completed],
    failed: [...failed],
    totalCostUsd,
    featureResults,
  };
}

/** DFS cycle detection on feature.depends_on. Throws if a cycle is found. */
function assertNoDependencyCycle(features: readonly Feature[]): void {
  const graph = new Map<string, readonly string[]>();
  for (const f of features) graph.set(f.id, f.depends_on);

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of graph.keys()) color.set(id, WHITE);

  const stack: Array<{ id: string; iter: Iterator<string> }> = [];
  for (const start of graph.keys()) {
    if (color.get(start) !== WHITE) continue;
    stack.push({ id: start, iter: graph.get(start)![Symbol.iterator]() });
    color.set(start, GRAY);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const next = frame.iter.next();
      if (next.done) {
        color.set(frame.id, BLACK);
        stack.pop();
        continue;
      }
      const dep = next.value;
      const c = color.get(dep);
      if (c === GRAY) {
        throw new Error(
          `feature.depends_on forms a cycle — '${frame.id}' → '${dep}' closes the loop`,
        );
      }
      if (c === WHITE) {
        stack.push({
          id: dep,
          iter: (graph.get(dep) ?? [])[Symbol.iterator](),
        });
        color.set(dep, GRAY);
      }
    }
  }
}
