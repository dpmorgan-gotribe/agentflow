import type {
  AgentSequenceMember,
  BuildToSpecVerifyOutput as BuildToSpecVerifyOutputType,
  Feature,
  FeatureGraphProgress,
  GateResolution,
  GitAgentOutput,
  InFlightFeature,
  ParityDivergence,
  Task,
  TasksV2,
} from "@repo/orchestrator-contracts";
import { GitAgentOutput as GitAgentOutputSchema } from "@repo/orchestrator-contracts";
import type { BudgetTracker } from "./budget-tracker.js";
import {
  runBuildToSpecVerify as defaultRunBuildToSpecVerify,
  type BuildToSpecVerifyContext,
} from "./build-to-spec-verify.js";
import {
  runFixBugsLoop as defaultRunFixBugsLoop,
  type FixBugsLoopContext,
  type FixBugsLoopResult,
} from "./fix-bugs-loop.js";
import { waitForGateDecision } from "./gate-server-lifecycle.js";
import {
  type CommitResult,
  commitWorktreeChanges as defaultCommitWorktreeChanges,
  type InstallResult,
  installIfPackageJsonChanged as defaultInstallIfPackageJsonChanged,
} from "./invoke-agent.js";
import type { RetryCounters } from "./retry-counters.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join as pathJoin } from "node:path";
import { PauseSignal, pausedStatePath, pauseRun } from "./pause.js";
import { saveState, writeFeatureGraphProgress } from "./state-persistence.js";

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
 * Auto-commit hook used by `runFeature` to stage + commit a build
 * agent's worktree changes after each successful invocation (feat-018
 * Phase A). Injectable for tests so we don't need a real git repo.
 */
export type CommitWorktreeChangesFn = (
  cwd: string,
  message: string,
) => Promise<CommitResult>;

/**
 * Defense-in-depth helper used by `runFeature` after each successful
 * commit (feat-019 Phase B). If the just-committed change set touched
 * any `package.json`, runs `pnpm install` so the next agent in
 * `agent_sequence[]` sees an up-to-date lockfile + node_modules tree.
 * Injectable for tests; default delegates to the real helper bound to
 * the real git CLI + shell.
 */
export type InstallIfPackageJsonChangedFn = (
  cwd: string,
) => Promise<InstallResult>;

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
  /**
   * bug-010: when set, this invocation was a graceful skip (agent was in
   * agent_sequence but not shipped/configured). Tasks return as completed
   * (so orchestrator advances) but the role didn't actually run. Surfaced
   * to the operator + recorded in feature outcomes for post-hoc review.
   */
  skippedReason?: string;
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
  /** bug-054: opt INTO gate 6 (pr-review). Default behavior is auto-merge on reviewer approval. */
  requirePrReview?: boolean;
  /**
   * Override the gate-6 watcher. Default delegates to
   * `waitForGateDecision` (file-drop at `docs/gate-6-approved-{id}.txt`).
   */
  waitForPrReviewGate?: WaitForPrReviewGateFn;
  /**
   * Override the auto-commit helper. Default delegates to
   * `invoke-agent.ts::commitWorktreeChanges` with the real git CLI.
   * Tests inject a stub to avoid touching a real worktree.
   */
  commitWorktreeChanges?: CommitWorktreeChangesFn;
  /**
   * Override the install-after-commit helper (feat-019 Phase B).
   * Default delegates to `invoke-agent.ts::installIfPackageJsonChanged`
   * with the real git CLI + shell. Tests inject a stub to avoid running
   * `pnpm install` against a tmp dir.
   */
  installIfPackageJsonChanged?: InstallIfPackageJsonChangedFn;
  /**
   * feat-022 — skip the post-merge `/build-to-spec-verify` deterministic
   * stage. Default false (the stage runs). Tests covering the pre-feat-022
   * happy paths set this true to keep their fixtures stable; tests that
   * exercise verify behavior set it false + supply `runBuildToSpecVerify`.
   */
  skipBuildToSpecVerify?: boolean;
  /**
   * feat-022 — override the post-merge verification runner. Default
   * delegates to the real script-shelling implementation in
   * `build-to-spec-verify.ts`. Tests inject a stub returning a canned
   * `BuildToSpecVerifyOutput` to assert orchestrator routing without
   * spawning child processes.
   */
  runBuildToSpecVerify?: RunBuildToSpecVerifyFn;
  /**
   * feat-022 — factory root passed through to the verify runner. Default
   * `process.cwd()`. Tests override this to a fixture dir; the real
   * orchestrator entry point sets it to the agentflow_phase2 repo root
   * where `scripts/audit-app-reachability.mjs` + friends live.
   */
  factoryRoot?: string;
  /**
   * feat-052 Phase B (2026-05-05) — per-feature parity-smoke runner.
   * When set, fires AFTER the agent_sequence completes + BEFORE
   * close-feature. When omitted, the smoke is skipped (legacy callers
   * + tests that don't exercise parity behavior). Production CLI wires
   * this to a wrapper that delegates to `parity-verify.ts:runParityVerify`
   * with `filterScreensToFeature` + autoBootDevServer enabled.
   */
  runParityVerify?: RunParityVerifyFn;
  /**
   * feat-052 Phase B — max retries when parity-verify finds divergences.
   * Default 2 (matches TASK_RETRY_CAP). Tests inject 0 to assert the
   * single-pass + capture path without dispatching builder retries.
   */
  parityRetriesMax?: number;
  /**
   * feat-026 — skip the post-verify automated bug-fix loop. Default
   * false in production (loop runs when verify produces bugs); existing
   * tests default it to true via `makeCtx` so they don't trigger fix-loop
   * dispatch on stub bug payloads.
   */
  skipFixBugsLoop?: boolean;
  /**
   * feat-026 — override the bug-fix loop runner. Default delegates to
   * `runFixBugsLoop` from `fix-bugs-loop.ts`. Tests inject a stub to
   * assert dispatch routing without running real agents.
   */
  runFixBugsLoop?: (ctx: FixBugsLoopContext) => Promise<FixBugsLoopResult>;
  /**
   * feat-024 Phase A — progress checkpoint tracker. Default: a real
   * tracker that writes `feature-graph-progress.json` on every state
   * transition (dispatch / agent boundary / merge / fail / abort) so
   * paused / crashed runs can resume cleanly. Tests inject a no-op
   * tracker via `noopProgressTracker()` to avoid touching disk.
   */
  progressTracker?: ProgressTracker;
  /**
   * feat-024 Phase A — master commit SHA captured at run start, written
   * into the progress snapshot for resume-time drift detection. Default
   * `"unknown"` when unset (tests). The real CLI entry point reads
   * `git rev-parse HEAD` against the project root and passes it here.
   */
  masterCommitSha?: string;
  /**
   * feat-024 Phase C — auth provider in effect at run start. Persisted
   * into paused.json so the resume helper can detect mid-pause provider
   * switches. Default "unknown" when unset (tests).
   */
  authProvider?: string;
  /**
   * feat-024 Phase C — disable the paused.json sentinel poll between
   * agents. Default false (poll happens). Tests that don't exercise
   * pause logic typically leave this false too — there's no perf cost
   * since `existsSync` against a non-existent path is microseconds.
   */
  pauseSentinelPollDisabled?: boolean;
  /**
   * bug-021 — when set, the progress tracker created by `runFeatureGraph`
   * is seeded from this snapshot rather than starting empty. Wired by
   * `cli-runner.ts` on `--resume-feature-graph`: it reads
   * `feature-graph-progress.json` from disk and passes it here so the
   * orchestrator remembers what was in-flight at the moment of pause.
   *
   * Without this seed, `runFeature` cannot tell a freshly-dispatched
   * feature from one whose worktree already exists from a prior run, and
   * `runCheckoutFeature` hard-fails with `stale-worktree`. With the seed,
   * `runFeature` detects the in-flight entry, skips checkout, and
   * advances `agent_sequence[]` to `nextAgent`.
   *
   * Tests can pass this directly without going through state-persistence.
   * Ignored when `progressTracker` is also set (the caller-supplied
   * tracker wins).
   */
  seedProgress?: FeatureGraphProgress;
}

// ─── feat-024 Phase A: progress tracker ──────────────────────────────
//
// Funnels every feature-graph state transition into the
// `feature-graph-progress.json` snapshot. The tracker is a small object
// that owns the in-memory snapshot + flushes after each mutation. We
// keep the snapshot in memory (incremental update) rather than rebuilding
// it from scratch — cheaper + matches the plan's "INCREMENTAL" requirement.

export interface ProgressTracker {
  onFeatureDispatched(args: {
    featureId: string;
    worktree: string;
    branch: string;
    firstAgent: AgentSequenceMember;
    nextAgent: AgentSequenceMember | null;
  }): void;
  onAgentBoundary(args: {
    featureId: string;
    completedAgent: AgentSequenceMember;
    nextAgent: AgentSequenceMember | null;
  }): void;
  onProgress(args: { featureId: string }): void;
  onFeatureMerged(args: { featureId: string }): void;
  onFeatureFailed(args: { featureId: string }): void;
  onFeatureAborted(args: { featureId: string }): void;
  /** Flush the snapshot to disk (or no-op for the noop tracker). */
  flush(): void;
  /** Read-only snapshot accessor (used by `pause` to capture a copy). */
  snapshot(): FeatureGraphProgress;
}

/** A no-op tracker — the default in tests so they don't touch disk. */
export function noopProgressTracker(): ProgressTracker {
  const empty: FeatureGraphProgress = {
    version: "1.0",
    pipelineRunId: "noop",
    lastUpdatedAt: new Date().toISOString(),
    masterCommitSha: "unknown",
    completed: [],
    failed: [],
    aborted: [],
    inFlight: [],
  };
  return {
    onFeatureDispatched() {},
    onAgentBoundary() {},
    onProgress() {},
    onFeatureMerged() {},
    onFeatureFailed() {},
    onFeatureAborted() {},
    flush() {},
    snapshot: () => empty,
  };
}

/**
 * Factory for the real disk-backed tracker. Holds the snapshot in memory;
 * `flush()` writes atomically to `feature-graph-progress.json`. Each
 * mutation method calls `flush()` so the on-disk file always reflects the
 * latest known state (a Mode B crash leaves a usable checkpoint).
 *
 * bug-021: when `seedSnapshot` is provided, the in-memory snapshot is
 * hydrated from it (deep-cloned) so a resumed run remembers what was
 * completed / failed / in-flight at pause time. `pipelineRunId` and
 * `masterCommitSha` from the args still take precedence over the seed —
 * the seed's bookkeeping fields are advisory.
 */
export function createProgressTracker(args: {
  projectRoot: string;
  pipelineRunId: string;
  masterCommitSha: string;
  seedSnapshot?: FeatureGraphProgress;
}): ProgressTracker {
  const seed = args.seedSnapshot;
  const snapshot: FeatureGraphProgress = seed
    ? {
        version: "1.0",
        pipelineRunId: args.pipelineRunId,
        lastUpdatedAt: new Date().toISOString(),
        masterCommitSha: args.masterCommitSha,
        completed: [...seed.completed],
        failed: [...seed.failed],
        aborted: [...seed.aborted],
        inFlight: seed.inFlight.map((f) => ({ ...f })),
      }
    : {
        version: "1.0",
        pipelineRunId: args.pipelineRunId,
        lastUpdatedAt: new Date().toISOString(),
        masterCommitSha: args.masterCommitSha,
        completed: [],
        failed: [],
        aborted: [],
        inFlight: [],
      };

  function bump(): void {
    snapshot.lastUpdatedAt = new Date().toISOString();
  }

  function findInFlight(featureId: string): InFlightFeature | undefined {
    return snapshot.inFlight.find((f) => f.featureId === featureId);
  }

  function removeInFlight(featureId: string): void {
    snapshot.inFlight = snapshot.inFlight.filter(
      (f) => f.featureId !== featureId,
    );
  }

  const tracker: ProgressTracker = {
    onFeatureDispatched({
      featureId,
      worktree,
      branch,
      firstAgent,
      nextAgent,
    }) {
      removeInFlight(featureId);
      const now = new Date().toISOString();
      snapshot.inFlight.push({
        featureId,
        worktree,
        branch,
        lastAgent: firstAgent,
        nextAgent,
        lastProgressAt: now,
        dispatchedAt: now,
      });
      bump();
      tracker.flush();
    },
    onAgentBoundary({ featureId, completedAgent, nextAgent }) {
      const entry = findInFlight(featureId);
      if (!entry) return;
      entry.lastAgent = completedAgent;
      entry.nextAgent = nextAgent;
      entry.dispatchedAt = new Date().toISOString();
      entry.lastProgressAt = entry.dispatchedAt;
      bump();
      tracker.flush();
    },
    onProgress({ featureId }) {
      const entry = findInFlight(featureId);
      if (!entry) return;
      entry.lastProgressAt = new Date().toISOString();
      // Don't flush on every keepalive — too chatty. Caller should flush
      // explicitly at coarser boundaries (agent completion, merge, etc.).
      bump();
    },
    onFeatureMerged({ featureId }) {
      removeInFlight(featureId);
      if (!snapshot.completed.includes(featureId)) {
        snapshot.completed.push(featureId);
      }
      bump();
      tracker.flush();
    },
    onFeatureFailed({ featureId }) {
      removeInFlight(featureId);
      if (!snapshot.failed.includes(featureId)) {
        snapshot.failed.push(featureId);
      }
      bump();
      tracker.flush();
    },
    onFeatureAborted({ featureId }) {
      removeInFlight(featureId);
      if (!snapshot.aborted.includes(featureId)) {
        snapshot.aborted.push(featureId);
      }
      bump();
      tracker.flush();
    },
    flush() {
      writeFeatureGraphProgress(args.projectRoot, args.pipelineRunId, snapshot);
    },
    snapshot: () => ({
      ...snapshot,
      completed: [...snapshot.completed],
      failed: [...snapshot.failed],
      aborted: [...snapshot.aborted],
      inFlight: snapshot.inFlight.map((f) => ({ ...f })),
    }),
  };
  return tracker;
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
  /**
   * Warnings raised by the per-step auto-commit helper (feat-018 Phase A).
   * Empty when every commit succeeded or was a legitimate no-op.
   */
  commitWarnings?: string[];
}

export interface FeatureGraphResult {
  completed: string[];
  failed: string[];
  totalCostUsd: number;
  featureResults: Record<string, FeatureResult>;
  /**
   * Final orchestrator status. feat-022 added the
   * `completed-with-integration-failures` outcome — Mode B reached
   * "all features merged" but the post-merge `/build-to-spec-verify`
   * stage surfaced reachability or flow violations and auto-filed bug
   * plans. feat-026 added the `bugLoopResult` channel — when the
   * automated bug-fix loop achieves a clean re-verify, status flips
   * back to `completed`; if the loop hits caps, it stays
   * `completed-with-integration-failures`.
   */
  status?: "completed" | "completed-with-integration-failures" | "incomplete";
  /**
   * `/build-to-spec-verify` payload (feat-022). Present iff the post-merge
   * stage ran (i.e. all features completed AND the stage wasn't suppressed
   * via `ctx.skipBuildToSpecVerify`). Inspect `verify.bugPlansFiled[]` to
   * see which bug plans the stage created from violations.
   */
  verify?: BuildToSpecVerifyOutputType;
  /**
   * feat-026 — automated bug-fix loop result. Present iff verify
   * produced bugs AND the loop wasn't suppressed via
   * `ctx.skipFixBugsLoop`. Inspect `bugLoopResult.status` for
   * clean / iteration-cap-hit / all-bugs-failed.
   */
  bugLoopResult?: FixBugsLoopResult;
}

/** Feature-graph-level seam for the post-merge verification stage. */
export type RunBuildToSpecVerifyFn = (
  ctx: BuildToSpecVerifyContext,
) => Promise<BuildToSpecVerifyOutputType>;

/**
 * feat-052 Phase B (2026-05-05) — feature-graph seam for the per-feature
 * parity-smoke that fires AFTER agent_sequence completes + BEFORE
 * close-feature. Delegates to `parity-verify.ts:runParityVerify` in
 * production; tests inject a stub returning canned divergences without
 * booting Playwright.
 *
 * The narrow ParityVerifyArgs shape avoids a circular import between
 * feature-graph.ts and parity-verify.ts — the helper assembles a full
 * ParityVerifyContext from these args internally.
 */
export type RunParityVerifyFn = (args: {
  projectDir: string;
  factoryRoot?: string;
  affectsFiles: readonly string[];
  /**
   * Worktree path. parity-verify boots a dev-server in the worktree's
   * apps/web context — bug-052 Phase E ensures slot env files are
   * present so the boot picks the right port.
   */
  worktreeCwd: string;
}) => Promise<{ divergences: ParityDivergence[]; warnings: string[] }>;

/**
 * Heuristic — does this feature render app pages?
 *
 * True iff:
 *  - feature has at least one task with agent === web-frontend-builder
 *  - feature.affects_files contains at least one glob covering page files
 *
 * False otherwise — backend-only features, infra features, etc., skip
 * the parity-smoke. Mobile (expo) features get a future stack-aware
 * variant; v1 ships web only.
 */
function featureNeedsParitySmoke(feature: Feature): boolean {
  const hasWebFrontendTask = feature.tasks.some(
    (t) => t.agent === "web-frontend-builder",
  );
  if (!hasWebFrontendTask) return false;
  const affects = feature.affects_files ?? [];
  return affects.some((g) => {
    const norm = g.replace(/\\/g, "/");
    // Catches: apps/web/**, apps/web/app/**, apps/web/app/<screen>/**,
    // apps/web/app/page.tsx, etc.
    return (
      /apps\/web\/(app|src\/pages)\/.*/.test(norm) || norm === "apps/web/**"
    );
  });
}

/**
 * feat-052 Phase B+D — per-feature parity-smoke with retries.
 *
 * Runs parity-verify against the worktree's dev-server (booted by
 * parity-verify itself when ctx.devServerUrl is omitted). On divergences,
 * dispatches web-frontend-builder retry inside the worktree (max 2)
 * with the divergences as retryContext. Returns the FINAL residual
 * divergences after retries exhausted.
 *
 * v1 design choices:
 *  - Local retry counter (not RetryCounters tier) — keeps the change
 *    scoped to runFeature; pause-resume restarts the count which is
 *    acceptable since parity-verify is idempotent.
 *  - Cap = 2 retries (matches TASK_RETRY_CAP). Empirical tuning may
 *    revise this to 1 (cheaper) or 3 (more chances) post-validation.
 *  - On exhausted retries: log warning + return divergences. Caller
 *    proceeds to close-feature; bugs.yaml channel via /build-to-spec-verify
 *    catches the residual.
 */
async function runParitySmokeWithRetries(args: {
  feature: Feature;
  featureContext: { id: string; branch: string; priority: string };
  worktreeCwd: string;
  ctx: FeatureGraphContext;
  runParityVerify: RunParityVerifyFn;
  maxRetries: number;
}): Promise<{
  divergences: ParityDivergence[];
  warnings: string[];
  costUsd: number;
}> {
  const { feature, featureContext, worktreeCwd, ctx, runParityVerify } = args;
  let costUsd = 0;
  const warnings: string[] = [];
  let attempt = 0;
  let divergences: ParityDivergence[] = [];

  while (attempt <= args.maxRetries) {
    const verify = await runParityVerify({
      projectDir: ctx.projectRoot,
      factoryRoot: ctx.factoryRoot,
      affectsFiles: feature.affects_files ?? [],
      worktreeCwd,
    });
    warnings.push(...verify.warnings);
    divergences = verify.divergences;

    if (divergences.length === 0) return { divergences, warnings, costUsd };

    // We have divergences. If we've used all retries, stop + return them.
    if (attempt >= args.maxRetries) break;

    attempt += 1;
    // Dispatch web-frontend-builder retry inside the worktree with
    // divergences as retryContext. Mirrors the tester `genuineProductBugs[]`
    // ladder: same retry-context shape, same builder dispatch surface.
    const retryMessage = formatParityDivergencesAsRetry(divergences);
    const taskForRetry = feature.tasks.find(
      (t) => t.agent === "web-frontend-builder",
    );
    const synthTaskId = taskForRetry
      ? taskForRetry.id
      : `${feature.id}-parity-smoke-retry`;
    const result = await ctx.invokeAgent({
      agent: "web-frontend-builder",
      cwd: worktreeCwd,
      featureContext,
      tasks: taskForRetry ? [taskForRetry] : [],
      retryContext: {
        taskId: synthTaskId,
        errorMessage: retryMessage,
      },
    });
    costUsd += result.costUsd;
    // Don't fail the feature here — even if the builder retry returned
    // failed status, we re-run parity-verify next loop iteration to
    // see if anything changed. Cap exhaustion is the only exit.
  }

  if (divergences.length > 0) {
    warnings.push(
      `[parity-smoke] feature ${feature.id}: ${divergences.length} divergence(s) remain after ${args.maxRetries} retries; close-feature will proceed and bugs.yaml channel will catch residual.`,
    );
    // eslint-disable-next-line no-console
    console.warn(
      `[runFeature] ${feature.id}: parity-smoke residual divergences after retries — proceeding to merge; bugs.yaml will pick up the rest`,
    );
  }

  return { divergences, warnings, costUsd };
}

function formatParityDivergencesAsRetry(
  divergences: readonly ParityDivergence[],
): string {
  const lines = [
    `parity-verify caught ${divergences.length} divergence(s) on this feature's screens — reapply the mockup's kit-component tree:`,
  ];
  for (const d of divergences.slice(0, 10)) {
    lines.push(
      `  - ${d.screen} (${d.pattern}, ${d.severity}): missing=${d.detail.missing.length} extra=${d.detail.extra.length} variantDrift=${d.detail.variantDrift.length} styleDrift=${d.detail.styleDrift.length}`,
    );
  }
  if (divergences.length > 10) {
    lines.push(`  ... and ${divergences.length - 10} more`);
  }
  return lines.join("\n");
}

// Per-task retry cap. bug-002 dropped this 3 → 1 for fast-fail debugging
// during the structural-bug discovery phase. bug-008 (2026-04-26) restores
// it to 2 now that the orchestrator chain is robust through bugs 002-007:
// the parser, output extraction, commit discipline, and branch-detection
// layers all reliably succeed end-to-end. With the chain stable, transient
// SDK / LLM hiccups deserve one retry before failing the task. Restore to 3
// post-MVP if more retry headroom is needed for production runs.
const TASK_RETRY_CAP = 2;
const MERGE_CONFLICT_CAP = 3;

// bug-036 Phase A: per-project-root mutex for checkout-feature operations.
// `git worktree add` (and the dirty-state auto-commit branch in
// `runCheckoutFeature`) takes the project root's `.git/index.lock`; concurrent
// dispatches with maxConcurrentFeatures > 1 race on the lock and the losers
// silently fail with `worktree-seed-failed` / `index.lock: File exists`. This
// mutex serializes ONLY the checkout-feature step (the rest of runFeature —
// builder, tester, reviewer, close-feature merge — runs against the
// per-feature worktree's own .git and doesn't contend on the project-root lock,
// so concurrent execution remains safe + parallel after checkout). Empirical
// motivation: 2026-05-01 finance-track-01 wave-4 race + cap=5 race lost 2/3
// + 2/5 features respectively.
const checkoutMutex = new Map<string, Promise<void>>();

async function acquireCheckoutLock(projectRoot: string): Promise<() => void> {
  while (checkoutMutex.has(projectRoot)) {
    await checkoutMutex.get(projectRoot);
  }
  let release!: () => void;
  const p = new Promise<void>((resolve) => {
    release = resolve;
  });
  checkoutMutex.set(projectRoot, p);
  return () => {
    checkoutMutex.delete(projectRoot);
    release();
  };
}

// bug-034 Phase A: deterministic additive-same-region merge resolver.
// When `git merge --no-ff feat/X` fires from project root and hits
// CONFLICT (content) on a file, the conflict region looks like:
//   <<<<<<< HEAD
//   <ours-side lines>
//   =======
//   <theirs-side lines>
//   >>>>>>> feat/X
// For "additive" patterns — both sides only ADDED new lines, neither
// modified or deleted lines that existed in the common ancestor —
// the correct resolution is to concat both sides. git can't infer
// this; the LLM handoff path is expensive + unreliable for this
// pattern. This helper detects the additive case + resolves
// deterministically. Mixed-modify cases (one side changed an existing
// line while the other added) are NOT additive; helper returns
// `unresolved` for those + the existing LLM handoff path takes over.
//
// Empirical motivation: 2026-05-01/02 finance-track-01 — feat-transactions-crud
// (manual recovery via bug-002) + feat-accounts-ui (in-flight as this
// ships) both hit identical additive-same-region conflicts in
// `apps/api/src/app.ts` (route registration block) and
// `packages/types/src/index.ts` (barrel exports). Pattern is
// structurally guaranteed to recur on every project with central
// registration files + parallel feature waves.
const CONFLICT_HEAD_RE = /^<{7}\s+\S/;
const CONFLICT_BASE_RE = /^={7}\s*$/;
const CONFLICT_TAIL_RE = /^>{7}\s+\S/;

interface ConflictResolveResult {
  resolved: boolean;
  reason?: string;
}

export function tryAdditiveConcatResolve(fileContent: string): {
  resolvedContent: string | null;
  reason?: string;
} {
  const lines = fileContent.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!CONFLICT_HEAD_RE.test(line)) {
      out.push(line);
      i++;
      continue;
    }
    // Found a conflict region. Walk to ======= and >>>>>>>
    const ourLines: string[] = [];
    const theirLines: string[] = [];
    let j = i + 1;
    while (j < lines.length && !CONFLICT_BASE_RE.test(lines[j]!)) {
      if (
        CONFLICT_HEAD_RE.test(lines[j]!) ||
        CONFLICT_TAIL_RE.test(lines[j]!)
      ) {
        return {
          resolvedContent: null,
          reason: "nested or malformed conflict markers",
        };
      }
      ourLines.push(lines[j]!);
      j++;
    }
    if (j >= lines.length) {
      return { resolvedContent: null, reason: "missing ======= marker" };
    }
    j++; // skip =======
    while (j < lines.length && !CONFLICT_TAIL_RE.test(lines[j]!)) {
      if (
        CONFLICT_HEAD_RE.test(lines[j]!) ||
        CONFLICT_BASE_RE.test(lines[j]!)
      ) {
        return {
          resolvedContent: null,
          reason: "nested or malformed conflict markers",
        };
      }
      theirLines.push(lines[j]!);
      j++;
    }
    if (j >= lines.length) {
      return { resolvedContent: null, reason: "missing >>>>>>> marker" };
    }
    // Heuristic: additive iff neither side is empty AND both blocks look
    // like NEW lines (not deletions). We err conservative: if EITHER
    // side is empty, that's a delete/add modification (one side removed
    // content the other kept) — NOT additive. Concat would silently
    // restore deleted content. Fall through to LLM handoff for that.
    if (ourLines.length === 0 || theirLines.length === 0) {
      return {
        resolvedContent: null,
        reason: `non-additive: one side is empty (ours=${ourLines.length}, theirs=${theirLines.length})`,
      };
    }
    // Concat: ours first (preserves master's order — feature branches
    // append after master's lines), then theirs.
    out.push(...ourLines, ...theirLines);
    i = j + 1; // skip past >>>>>>> line
  }
  return { resolvedContent: out.join("\n") };
}

/**
 * bug-034 Phase A: end-to-end resolver invoked from `attemptCloseFeature`
 * conflict path. Reads each conflicting file from project root, attempts
 * `tryAdditiveConcatResolve`, writes back, and commits the merge if all
 * files resolved cleanly. Returns `resolved: true` only when ALL
 * conflicts were additive + the merge committed successfully.
 */
function tryAdditiveConcatMergeResolution(
  projectRoot: string,
  conflictingFiles: readonly string[],
  branch: string,
): ConflictResolveResult {
  if (conflictingFiles.length === 0) {
    return { resolved: false, reason: "no conflicting files reported" };
  }
  const resolutionLog: string[] = [];
  for (const relPath of conflictingFiles) {
    const absPath = pathJoin(projectRoot, relPath);
    let raw: string;
    try {
      raw = readFileSync(absPath, "utf8");
    } catch (err) {
      return {
        resolved: false,
        reason: `failed to read ${relPath}: ${(err as Error).message}`,
      };
    }
    const result = tryAdditiveConcatResolve(raw);
    if (result.resolvedContent === null) {
      return {
        resolved: false,
        reason: `non-additive conflict in ${relPath}: ${result.reason}`,
      };
    }
    try {
      writeFileSync(absPath, result.resolvedContent, "utf8");
    } catch (err) {
      return {
        resolved: false,
        reason: `failed to write ${relPath}: ${(err as Error).message}`,
      };
    }
    resolutionLog.push(relPath);
  }
  // Stage + commit the merge.
  const addRes = spawnSync("git", ["add", ...conflictingFiles], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (addRes.status !== 0) {
    return {
      resolved: false,
      reason: `git add failed: ${addRes.stderr || addRes.stdout}`,
    };
  }
  const commitMsg = `merge ${branch} (additive-concat resolver — bug-034 Phase A)\n\nResolved files (concat ours+theirs):\n${resolutionLog.map((f) => `  - ${f}`).join("\n")}\n`;
  const commitRes = spawnSync(
    "git",
    ["commit", "--no-verify", "-m", commitMsg],
    { cwd: projectRoot, encoding: "utf8" },
  );
  if (commitRes.status !== 0) {
    return {
      resolved: false,
      reason: `git commit failed: ${commitRes.stderr || commitRes.stdout}`,
    };
  }
  return { resolved: true };
}

/**
 * Roll back a failed `git merge --no-ff` so the worktree state is clean
 * for the LLM handoff path. Equivalent to `git merge --abort` if the
 * merge is in progress; no-op (and tolerated) if the merge isn't in a
 * conflicted state for any reason.
 */
function abortFailedMerge(projectRoot: string): void {
  spawnSync("git", ["merge", "--abort"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  // Best-effort. If --abort fails (no merge in progress), silent skip.
}

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
  const tracker = ctx.progressTracker ?? noopProgressTracker();
  const featureContext = {
    id: feature.id,
    branch: feature.branch,
    priority: feature.priority,
  };
  // Compute the first/next agent in the sequence for the dispatch breadcrumb.
  // First non-git-agent in agent_sequence (or fall back to the first member).
  const sequenceForTrack = feature.agent_sequence.filter(
    (a): a is AgentSequenceMember => a !== "git-agent",
  );
  const firstSeqAgent: AgentSequenceMember =
    sequenceForTrack[0] ?? feature.agent_sequence[0]!;
  const secondSeqAgent: AgentSequenceMember | null =
    sequenceForTrack[1] ?? null;
  // Absolute path: SDK's child_process.spawn would otherwise resolve a
  // project-relative cwd against the orchestrator's process.cwd() (factory
  // root), which is the wrong dir.
  const worktreeCwd = `${ctx.projectRoot}/.claude/worktrees/${feature.worktree}`;
  const taskOutcomes: Record<string, "completed" | "failed"> = {};
  const commitWarnings: string[] = [];
  let totalCostUsd = 0;
  let attempts = 0;
  let lastWritingAgent: AgentSequenceMember | undefined;
  // feat-018 Phase A: auto-commit hook. Default to the real helper bound
  // to the real git CLI; tests inject a stub via ctx.commitWorktreeChanges.
  const commitChanges: CommitWorktreeChangesFn =
    ctx.commitWorktreeChanges ??
    ((cwd, message) => defaultCommitWorktreeChanges(cwd, message));
  // feat-019 Phase B: install-after-commit hook. Defense-in-depth for
  // builders that bumped a package.json line but skipped `pnpm install`.
  // Default to the real helper; tests inject a stub.
  const installAfterCommit: InstallIfPackageJsonChangedFn =
    ctx.installIfPackageJsonChanged ??
    ((cwd) => defaultInstallIfPackageJsonChanged(cwd));

  // 0. Fast-skip — if every task in this feature is already status: completed,
  //    the feature was finished in a prior run (or by a prior smoke test) and
  //    merged to main. Don't re-checkout / re-run / re-merge. Cheap idempotency
  //    that keeps resumed pipelines from duplicating work.
  if (
    feature.tasks.length > 0 &&
    feature.tasks.every((t) => t.status === "completed")
  ) {
    for (const t of feature.tasks) taskOutcomes[t.id] = "completed";
    // Treat fast-skip as merge for the progress checkpoint — the feature
    // is already on master from a prior run, so resume should treat it
    // as completed (don't re-dispatch).
    tracker.onFeatureMerged({ featureId: feature.id });
    return {
      featureId: feature.id,
      status: "completed",
      durationMs: Date.now() - startedAt,
      attempts: 0,
      totalCostUsd: 0,
      taskOutcomes,
    };
  }

  // bug-021: detect resume context. If a `seedProgress` was passed via
  // ctx (via cli-runner reading feature-graph-progress.json on
  // --resume-feature-graph), the tracker now has an inFlight[] entry for
  // this feature. We trust the /resume-build SKILL §7 recovery actions
  // (operator-side) ran already, so the worktree is in a state where we
  // should:
  //   - SKIP checkout-feature entirely (the worktree exists; calling
  //     checkout-feature would hit `stale-worktree` and cascade-fail —
  //     this is the bug-021 empirical hit).
  //   - SKIP `tracker.onFeatureDispatched` (the inFlight[] entry already
  //     exists from the prior run; replacing it with firstAgent/secondAgent
  //     would clobber the resume signal).
  //   - JUMP the agent_sequence walk to the index of `nextAgent`. If
  //     `nextAgent === null`, skip the walk entirely + go to close-feature.
  //   - Seed `lastWritingAgent` from the inFlight entry's `lastAgent` so
  //     close-feature's conflict-handoff routing has a sensible target.
  const inFlightEntry = tracker
    .snapshot()
    .inFlight.find((f) => f.featureId === feature.id);
  const isResume = inFlightEntry !== undefined;
  let resumeStartIdx = 0;
  if (isResume && inFlightEntry) {
    lastWritingAgent = inFlightEntry.lastAgent;
    if (inFlightEntry.nextAgent === null) {
      // Walk is fully done — skip directly to close-feature.
      resumeStartIdx = feature.agent_sequence.length;
    } else {
      const idx = feature.agent_sequence.indexOf(inFlightEntry.nextAgent);
      // If the snapshot's nextAgent isn't in agent_sequence anymore (e.g.,
      // tasks.yaml changed between pause + resume), fall back to walking
      // from the start. Conservative — better to redo work than skip it.
      resumeStartIdx = idx >= 0 ? idx : 0;
    }
  } else {
    // feat-024 Phase A: dispatch breadcrumb. Fires AFTER the fast-skip
    // check (a fast-skipped feature is already on master, never enters
    // inFlight[]) but BEFORE checkout — checkout failures still warrant
    // a recorded "we tried" state via the matched onFeatureFailed call.
    tracker.onFeatureDispatched({
      featureId: feature.id,
      worktree: feature.worktree,
      branch: feature.branch,
      firstAgent: firstSeqAgent,
      nextAgent: secondSeqAgent,
    });
  }

  // 1. Checkout feature worktree (skipped on resume — worktree already
  // exists from prior run; /resume-build SKILL §7 recovery actions ran).
  // bug-036 Phase A: serialize this step via the project-root mutex.
  // `git worktree add` + the dirty-state auto-commit branch in
  // `runCheckoutFeature` take the project-root .git/index.lock; concurrent
  // dispatches race on it and losers fail with `worktree-seed-failed`.
  // The mutex spans ONLY this step — builder/tester/reviewer/close-feature
  // run against the per-feature worktree's own .git and don't contend.
  if (!isResume) {
    const releaseCheckoutLock = await acquireCheckoutLock(ctx.projectRoot);
    let checkoutFailed = false;
    let checkoutFailureMessage = "";
    try {
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
        checkoutFailed = true;
        checkoutFailureMessage = `checkout-feature failed: ${JSON.stringify(checkoutParsed ?? checkout.gitAgentOutput)}`;
      }
    } finally {
      releaseCheckoutLock();
    }
    if (checkoutFailed) {
      tracker.onFeatureFailed({ featureId: feature.id });
      return finish(
        feature.id,
        "failed",
        startedAt,
        attempts,
        totalCostUsd,
        taskOutcomes,
        checkoutFailureMessage,
        commitWarnings,
      );
    }
  }

  // 2. Walk agent_sequence[] (on resume, start from `resumeStartIdx` so
  // already-completed agents from the prior run are skipped).
  for (
    let seqIdx = resumeStartIdx;
    seqIdx < feature.agent_sequence.length;
    seqIdx++
  ) {
    // feat-024 Phase C: poll for paused.json sentinel before each agent
    // dispatch. If present, drain happens implicitly (this in-flight
    // feature finishes its current agent before we re-check + abort the
    // walk). The throw propagates up to runFeatureGraph + cli.ts, which
    // catches PauseSignal and exits 0.
    if (
      !ctx.pauseSentinelPollDisabled &&
      existsSync(pausedStatePath(ctx.projectRoot, ctx.pipelineRunId))
    ) {
      tracker.flush();
      await pauseRun(
        {
          projectRoot: ctx.projectRoot,
          pipelineRunId: ctx.pipelineRunId,
          authProvider: ctx.authProvider ?? "unknown",
          progressTracker: tracker,
        },
        "user-request",
        `paused.json sentinel detected before ${feature.agent_sequence[seqIdx]} on ${feature.id}`,
        { drained: true },
      );
    }
    const agentName = feature.agent_sequence[seqIdx]!;
    if (agentName === "git-agent") continue; // lifecycle is owned by the orchestrator

    const surface = agentSurface(agentName);
    if (surface && feature.skip.includes(surface)) continue;

    const agentTasks = feature.tasks.filter((t) => t.agent === agentName);
    if (agentTasks.length === 0) continue;

    // Compute the next non-git-agent in the sequence for the boundary breadcrumb.
    const nextAgentForTrack: AgentSequenceMember | null =
      (feature.agent_sequence
        .slice(seqIdx + 1)
        .find((a) => a !== "git-agent") as AgentSequenceMember | undefined) ??
      null;

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
        tracker.onFeatureFailed({ featureId: feature.id });
        return finish(
          feature.id,
          "failed",
          startedAt,
          attempts,
          totalCostUsd,
          taskOutcomes,
          `task ${t.id} failed after ${TASK_RETRY_CAP} attempts: ${result.errors[t.id] ?? "n/a"}`,
          commitWarnings,
        );
      }
    }

    // feat-018 Phase A: every task assigned to this agent succeeded —
    // stage + commit the worktree so close-feature has a real merge to
    // do. One commit per agent step (not per task) keeps the log
    // readable. We never abort the feature on a commit warning; we
    // record it + continue. After Phase A this should rarely fire — if
    // it does, close-feature's Phase B guard catches the dirty tree.
    const completedIds = agentTasks
      .filter((t) => taskOutcomes[t.id] === "completed")
      .map((t) => t.id);
    if (completedIds.length > 0) {
      const message =
        `${agentName}: ${completedIds.join(", ")}\n\n` +
        `[via orchestrator Mode B; feature: ${feature.id}]`;
      let commitLanded = false;
      try {
        const commit = await commitChanges(worktreeCwd, message);
        if (commit.committed === true) {
          commitLanded = true;
        }
        if (commit.warning) {
          commitWarnings.push(`${agentName}: ${commit.warning}`);
          // eslint-disable-next-line no-console
          console.warn(
            `[runFeature] auto-commit warning for ${feature.id}/${agentName}: ${commit.warning}`,
          );
        }
      } catch (err) {
        // Defensive — `commitWorktreeChanges` is contracted not to
        // throw, but a buggy stub or unexpected exception shouldn't
        // fail the feature. Log + continue.
        const msg = err instanceof Error ? err.message : String(err);
        commitWarnings.push(`${agentName}: commit threw: ${msg}`);
        // eslint-disable-next-line no-console
        console.warn(
          `[runFeature] auto-commit threw for ${feature.id}/${agentName}: ${msg}`,
        );
      }

      // feat-024 Phase A: agent boundary — record completion of this
      // agent + the next agent in agent_sequence for resume routing.
      tracker.onAgentBoundary({
        featureId: feature.id,
        completedAgent: agentName,
        nextAgent: nextAgentForTrack,
      });

      // feat-019 Phase B: if the commit landed, refresh the dep tree
      // when the change set touched any package.json. Failures here
      // are warnings — the next agent may still succeed.
      if (commitLanded) {
        try {
          const install = await installAfterCommit(worktreeCwd);
          if (install.warning) {
            commitWarnings.push(`${agentName}: ${install.warning}`);
            // eslint-disable-next-line no-console
            console.warn(
              `[runFeature] install warning for ${feature.id}/${agentName}: ${install.warning}`,
            );
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          commitWarnings.push(`${agentName}: install threw: ${msg}`);
          // eslint-disable-next-line no-console
          console.warn(
            `[runFeature] install threw for ${feature.id}/${agentName}: ${msg}`,
          );
        }
      }
    }
  }

  // 2.5 — feat-052 Phase B+D: per-feature parity-smoke + retry.
  // Runs AFTER agent_sequence completes + BEFORE gate-6/close-feature so
  // divergences caught here can be fixed in the still-open worktree
  // (rather than waiting for post-merge /build-to-spec-verify which
  // costs ~$5/bug to fix in the fix-bugs loop). Skipped when:
  //  - ctx.runParityVerify isn't injected (legacy + most test paths)
  //  - feature doesn't render web pages (backend-only, infra)
  if (ctx.runParityVerify && featureNeedsParitySmoke(feature)) {
    const smokeResult = await runParitySmokeWithRetries({
      feature,
      featureContext,
      worktreeCwd,
      ctx,
      runParityVerify: ctx.runParityVerify,
      maxRetries: ctx.parityRetriesMax ?? TASK_RETRY_CAP,
    });
    totalCostUsd += smokeResult.costUsd;
    for (const w of smokeResult.warnings) {
      commitWarnings.push(`[parity-smoke] ${w}`);
    }
    // Residual divergences (after retries exhausted) are logged via
    // commitWarnings + the runParitySmokeWithRetries helper; close-feature
    // proceeds. The bugs.yaml channel via post-merge /build-to-spec-verify
    // catches anything that slipped through.
  }

  // 3. Gate 6 (pr-review) — fires between reviewer-approve and merge.
  // Only when the feature had a reviewer step AND the operator opted IN
  // via --require-pr-review. Default behavior (bug-054, 2026-05-06): trust
  // the reviewer agent's verdict — reviewer IS the merge gate. Per-feature
  // human file-drop is opt-in for paranoid flows that want a manual
  // inspection between reviewer-approve and merge. Reviewer's successful
  // completion is implicit by reaching this point without earlier early-return.
  const reviewerInSequence = feature.agent_sequence.includes("reviewer");
  if (reviewerInSequence && ctx.requirePrReview) {
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
      tracker.onFeatureFailed({ featureId: feature.id });
      return finish(
        feature.id,
        "failed",
        startedAt,
        attempts,
        totalCostUsd,
        taskOutcomes,
        `gate-6-rejected: ${decision.note ?? "no note"}`,
        commitWarnings,
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
    tracker.onFeatureFailed({ featureId: feature.id });
    return finish(
      feature.id,
      "failed",
      startedAt,
      attempts,
      totalCostUsd,
      taskOutcomes,
      closeResult.reason ?? "close-feature failed",
      commitWarnings,
    );
  }

  tracker.onFeatureMerged({ featureId: feature.id });
  return finish(
    feature.id,
    "completed",
    startedAt,
    attempts,
    totalCostUsd,
    taskOutcomes,
    undefined,
    commitWarnings,
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

    // feat-018 Phase B: feature-no-commits diagnostic — the branch
    // had no commits beyond main AND the worktree was dirty. After
    // Phase A's auto-commit lands this should never fire; if it does,
    // surface it as a hard failure (not a conflict to retry).
    if (
      parsed.success === false &&
      parsed.conflict === false &&
      "reason" in parsed &&
      parsed.reason === "feature-no-commits"
    ) {
      const dirty = "dirtyFiles" in parsed ? parsed.dirtyFiles : [];
      return {
        success: false,
        costUsd,
        reason: `feature-no-commits: builders produced files but no commit was made (dirty: ${dirty.join(", ")})`,
      };
    }

    // Conflict path
    if (parsed.success !== false || parsed.conflict !== true) {
      return {
        success: false,
        costUsd,
        reason: `close-feature returned unrecognized conflict shape: ${JSON.stringify(parsed)}`,
      };
    }

    // bug-034 Phase A: deterministic fast-path for additive-same-region
    // conflicts. Try to resolve each conflicting file via concat
    // (ours-then-theirs) BEFORE incrementing the retry counter and
    // dispatching the expensive LLM handoff. If ALL conflicts resolve
    // cleanly, commit the merge here and return success. If ANY file
    // has a non-additive conflict (delete/modify/etc), abort the merge
    // and fall through to the legacy handoff path.
    const fastPath = tryAdditiveConcatMergeResolution(
      ctx.projectRoot,
      parsed.conflictingFiles,
      feature.branch,
    );
    if (fastPath.resolved) {
      // Merge committed via concat. Treat as success without burning
      // a merge-conflict retry slot.
      return { success: true, costUsd };
    }
    // Non-additive: roll back the partial merge so the worktree-state
    // is clean for the LLM handoff. The LLM resolves in the worktree;
    // a subsequent close-feature attempt re-runs `git merge --no-ff`.
    abortFailedMerge(ctx.projectRoot);

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
  commitWarnings?: readonly string[],
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
  if (commitWarnings && commitWarnings.length > 0) {
    result.commitWarnings = [...commitWarnings];
  }
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

  // feat-024 Phase A: build (or accept) a progress tracker. The real
  // tracker writes feature-graph-progress.json on every transition;
  // tests inject a noop tracker via ctx.progressTracker to avoid disk.
  // bug-021: when ctx.seedProgress is set (resume path), hydrate the
  // tracker's in-memory snapshot from it so runFeature can detect
  // already-in-flight features instead of treating every entry as a
  // fresh dispatch.
  const tracker: ProgressTracker =
    ctx.progressTracker ??
    createProgressTracker({
      projectRoot: ctx.projectRoot,
      pipelineRunId: ctx.pipelineRunId,
      masterCommitSha: ctx.masterCommitSha ?? "unknown",
      ...(ctx.seedProgress ? { seedSnapshot: ctx.seedProgress } : {}),
    });
  // Wrap ctx so runFeature inherits the tracker even if the caller didn't
  // set one — without this, runFeature's `ctx.progressTracker ?? noop`
  // would no-op even when runFeatureGraph created a real tracker.
  const wrappedCtx: FeatureGraphContext = { ...ctx, progressTracker: tracker };
  // Initial flush so the file exists from t=0 of the run (consumers like
  // /pause-build can find it even before any feature dispatches).
  tracker.flush();

  const concurrency = ctx.maxConcurrentFeatures ?? 4;
  const features = tasks.features;
  const completed = new Set<string>();
  const failed = new Set<string>();
  const inFlight = new Map<string, Promise<FeatureResult>>();
  const featureResults: Record<string, FeatureResult> = {};
  let totalCostUsd = 0;

  const remaining = new Set(features.map((f) => f.id));

  // bug-021: when resuming with a hydrated progress snapshot, pre-populate
  // the topological loop's tracking sets so already-resolved features
  // (merged / failed / aborted) don't get re-dispatched. Features in
  // `seed.inFlight[]` stay in `remaining` — they're the resume targets and
  // runFeature detects them via tracker.snapshot().inFlight to skip
  // checkout-feature + advance to nextAgent.
  if (ctx.seedProgress) {
    for (const id of ctx.seedProgress.completed) {
      if (!remaining.has(id)) continue;
      remaining.delete(id);
      completed.add(id);
      featureResults[id] = {
        featureId: id,
        status: "completed",
        durationMs: 0,
        attempts: 0,
        totalCostUsd: 0,
        taskOutcomes: {},
      };
    }
    for (const id of ctx.seedProgress.failed) {
      if (!remaining.has(id)) continue;
      remaining.delete(id);
      failed.add(id);
      featureResults[id] = {
        featureId: id,
        status: "failed",
        durationMs: 0,
        attempts: 0,
        totalCostUsd: 0,
        taskOutcomes: {},
        abortReason: "carried over from prior run (paused-then-resumed)",
      };
    }
    for (const id of ctx.seedProgress.aborted) {
      if (!remaining.has(id)) continue;
      remaining.delete(id);
      failed.add(id);
      featureResults[id] = {
        featureId: id,
        status: "aborted",
        durationMs: 0,
        attempts: 0,
        totalCostUsd: 0,
        taskOutcomes: {},
        abortReason: "carried over from prior run (paused-then-resumed)",
      };
    }
  }

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
      tracker.onFeatureAborted({ featureId: f.id });
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
        runFeature(ready, wrappedCtx).then((r) => {
          featureResults[r.featureId] = r;
          totalCostUsd += r.totalCostUsd;
          if (r.status === "completed") completed.add(r.featureId);
          else failed.add(r.featureId);
          return r;
        }),
      );
    }

    if (inFlight.size === 0) break;

    // feat-024 Phase C: drain all in-flight + propagate PauseSignal if
    // any of them threw it. Without this, Promise.race would resolve on
    // the FIRST settle but leave the other in-flight features hanging
    // (and miss their pause throws). We instead await the next settle
    // explicitly + re-throw if we see a PauseSignal.
    const settled = await Promise.race(
      [...inFlight.entries()].map(([id, p]) =>
        p.then(
          () => ({ id, error: null as Error | null }),
          (err: Error) => ({ id, error: err }),
        ),
      ),
    );
    inFlight.delete(settled.id);
    if (settled.error) {
      // Drain other in-flight features so they don't leak — but bound
      // it so a deadlocked feature can't hang the pause forever. Caller
      // (cli.ts) catches PauseSignal regardless.
      const remainingDrains = [...inFlight.values()];
      inFlight.clear();
      for (const p of remainingDrains) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await p;
        } catch {
          /* swallow — pause cascades naturally; we've already captured the first */
        }
      }
      tracker.flush();
      throw settled.error;
    }
  }

  // ── feat-022: post-merge build-to-spec verification ────────────────────────
  // Run iff every feature in the graph completed AND the stage isn't
  // suppressed. If any feature failed, we skip — verification on a half-merged
  // codebase produces noise. Failures here mark the run
  // `completed-with-integration-failures` rather than failing it outright;
  // bug plans land in `plans/active/` for the next builder pass.
  let verify: BuildToSpecVerifyOutputType | undefined;
  let status: FeatureGraphResult["status"] = "completed";
  if (failed.size > 0) {
    status = "incomplete";
  } else if (!ctx.skipBuildToSpecVerify && completed.size > 0) {
    const verifyRunner =
      ctx.runBuildToSpecVerify ?? defaultRunBuildToSpecVerify;
    try {
      const verifyArgs: BuildToSpecVerifyContext = {
        projectDir: ctx.projectRoot,
        autoFileBugPlans: true,
        pipelineRunId: ctx.pipelineRunId,
        iteration: 1,
      };
      if (ctx.factoryRoot !== undefined)
        verifyArgs.factoryRoot = ctx.factoryRoot;
      verify = await verifyRunner(verifyArgs);
      if (!verify.ok) {
        status = "completed-with-integration-failures";
      }
    } catch (err) {
      // Verification failure must not abort the orchestrator —
      // surface it as a warning + treat as completed-with-integration-failures
      // so the operator notices.
      status = "completed-with-integration-failures";
      verify = {
        ok: false,
        reachability: {
          orphanComponents: [],
          orphanRoutes: [],
          scannedFiles: 0,
          ignoredByAllowComment: [],
        },
        flows: { passed: [], failed: [], generated: [] },
        bugPlansFiled: [],
        costUsd: 0,
        durationMs: 0,
        warnings: [
          `runBuildToSpecVerify threw: ${(err as Error).message ?? String(err)}`,
        ],
      };
    }
  }

  // ── feat-026: automated bug-fix loop ────────────────────────────────────────
  // Auto-invoked AFTER verify when verify produced bugs (bugPlansFiled
  // non-empty OR ok=false). Loop iterates verify→fix→verify until either
  // every bug resolves OR the iteration cap (default 5) hits OR every
  // pending bug exhausts its per-bug attempt cap.
  //
  // Gated on three explicit conditions (all must be true):
  //   1. The verify stage ran + returned a result (status !== "incomplete")
  //   2. Verify produced at least one bug (verify.bugPlansFiled.length > 0
  //      OR verify.ok === false — defensive: ok=false without filed plans
  //      shouldn't happen in v1 but the loop's no-op exit handles it)
  //   3. ctx.skipFixBugsLoop !== true (existing tests opt out via this)
  //
  // The auto-invocation is NEVER on by default for tests — every existing
  // feature-graph test sets `skipFixBugsLoop: true` via makeCtx defaults.
  // Production runs (cli-runner.ts) leave it undefined → loop fires.
  let bugLoopResult: FixBugsLoopResult | undefined;
  if (
    verify !== undefined &&
    !ctx.skipFixBugsLoop &&
    (verify.bugPlansFiled.length > 0 || !verify.ok)
  ) {
    const fixRunner = ctx.runFixBugsLoop ?? defaultRunFixBugsLoop;
    const factoryRootForLoop = ctx.factoryRoot ?? process.cwd();
    try {
      const loopCtx: FixBugsLoopContext = {
        projectRoot: ctx.projectRoot,
        pipelineRunId: ctx.pipelineRunId,
        factoryRoot: factoryRootForLoop,
        budget: ctx.budget,
        invokeAgent: ctx.invokeAgent,
        runBuildToSpecVerify:
          ctx.runBuildToSpecVerify ?? defaultRunBuildToSpecVerify,
        // feat-046 Phase A.1 (2026-05-05): forward the operator's
        // `--max-concurrent` flag to the fix-bugs loop. Defaults to
        // sequential (1) when unset; >= 2 enables per-bug worktree
        // parallelism (Strategy A/D safe; Strategy C requires Phase A.2
        // env-isolation — operator must hold concurrency at 1 until A.2
        // ships for real-DB projects).
        ...(ctx.maxConcurrentFeatures && ctx.maxConcurrentFeatures >= 2
          ? { maxConcurrent: ctx.maxConcurrentFeatures }
          : {}),
        // feat-061 (2026-05-06) — class-batched-fix-dispatch ON by
        // default. feat-053 already implements grouping (N parity bugs
        // sharing a pattern → 1 dispatch); we just flip the default.
        // Empirical motivator (investigate-020): per-bug dispatch is
        // ~15-25min × 100 bugs = 25-40h on mature projects; class-
        // batching collapses N → 1 for shell-stripping / layout-
        // regrouping / token-drift / variant-drift parity classes.
        // Operators can opt OUT via FIX_BUGS_DISABLE_CLASS_BATCHING
        // env var.
        enableClassBatchedDispatch:
          process.env.FIX_BUGS_DISABLE_CLASS_BATCHING !== "1",
      };
      bugLoopResult = await fixRunner(loopCtx);
      totalCostUsd += bugLoopResult.totalCostUsd;
      // Status resolution per plan §Phase C:
      //   clean         → flip status back to "completed"
      //   any other     → leave at "completed-with-integration-failures"
      if (bugLoopResult.status === "clean") {
        status = "completed";
      } else {
        status = "completed-with-integration-failures";
      }
    } catch (err) {
      // bug-052 follow-up (2026-05-05): PauseSignal MUST propagate up to
      // cli.ts so the orchestrator exits 0 cleanly with a "resume with:"
      // hint. Pre-fix: this catch swallowed PauseSignal + flagged the run
      // "completed-with-integration-failures", which masquerades as a
      // crash from the operator's POV (exit code 1, no resume hint).
      // bugs.yaml + paused.json are already persisted by the time
      // PauseSignal reaches here (per fix-bugs-loop's lossless pause-
      // boundary), so re-throwing is safe.
      if (err instanceof PauseSignal) {
        throw err;
      }
      // Other failures must not crash the orchestrator. Surface as
      // completed-with-integration-failures + log via the verify warnings
      // channel.
      status = "completed-with-integration-failures";
      if (verify) {
        verify.warnings = [
          ...verify.warnings,
          `runFixBugsLoop threw: ${(err as Error).message ?? String(err)}`,
        ];
      }
    }
  }

  return {
    completed: [...completed],
    failed: [...failed],
    totalCostUsd,
    featureResults,
    status,
    ...(verify !== undefined ? { verify } : {}),
    ...(bugLoopResult !== undefined ? { bugLoopResult } : {}),
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
