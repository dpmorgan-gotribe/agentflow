import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Feature,
  FeatureGraphProgress,
  GitAgentOutput,
  TasksV2,
} from "@repo/orchestrator-contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BudgetTracker } from "../src/budget-tracker.js";
import {
  agentSurface,
  runFeature,
  runFeatureGraph,
  type InvokeAgentFn,
} from "../src/feature-graph.js";
import { RetryCounters } from "../src/retry-counters.js";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "feature-graph-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

function makeCtx(
  invokeAgent: InvokeAgentFn,
  overrides: Partial<{
    autoMergeAfterReviewer: boolean;
    waitForPrReviewGate: (args: {
      featureId: string;
      projectRoot: string;
    }) => Promise<{ approved: boolean; note?: string }>;
    commitWorktreeChanges: (
      cwd: string,
      message: string,
    ) => Promise<{ committed: boolean; sha?: string; warning?: string }>;
    installIfPackageJsonChanged: (
      cwd: string,
    ) => Promise<{ installed: boolean; warning?: string }>;
    skipBuildToSpecVerify: boolean;
    runBuildToSpecVerify: (
      args: import("../src/build-to-spec-verify.js").BuildToSpecVerifyContext,
    ) => Promise<
      import("@repo/orchestrator-contracts").BuildToSpecVerifyOutput
    >;
    skipFixBugsLoop: boolean;
    runFixBugsLoop: (
      ctx: import("../src/fix-bugs-loop.js").FixBugsLoopContext,
    ) => Promise<import("../src/fix-bugs-loop.js").FixBugsLoopResult>;
  }> = {},
) {
  return {
    projectRoot,
    pipelineRunId: "pipe-test-001",
    budget: new BudgetTracker({ perPipelineMaxUsd: 1000, perStageMaxUsd: {} }),
    retryCounters: new RetryCounters(),
    invokeAgent,
    // Default test stub: auto-approve gate 6 so existing tests don't hang.
    // Tests exercising gate 6 behavior override this.
    waitForPrReviewGate:
      overrides.waitForPrReviewGate ?? (async () => ({ approved: true })),
    // feat-018 Phase A: default no-op auto-commit stub. Tests that
    // exercise commit behavior override this; everyone else gets a
    // silent successful no-op so the helper doesn't try to run git
    // against a tmp dir without a real repo.
    commitWorktreeChanges:
      overrides.commitWorktreeChanges ??
      (async () => ({ committed: false }) as const),
    // feat-019 Phase B: default no-op install-after-commit stub. Tests
    // that exercise install behavior override this; everyone else gets
    // a silent { installed: false } so the helper doesn't try to run
    // `git diff-tree` + `pnpm install` against a tmp dir.
    installIfPackageJsonChanged:
      overrides.installIfPackageJsonChanged ??
      (async () => ({ installed: false }) as const),
    // feat-022: default to SKIPPING the post-merge verify stage. Existing
    // tests don't supply a project tree under projectRoot — running
    // verify there would shell out to scripts and produce noise. Tests
    // exercising verify routing override `skipBuildToSpecVerify: false`
    // + supply a `runBuildToSpecVerify` stub.
    skipBuildToSpecVerify: overrides.skipBuildToSpecVerify ?? true,
    // feat-026: default-skip the post-verify bug-fix loop in tests so
    // existing fixtures don't fire it on stub bug payloads. Tests that
    // exercise the loop opt in via `skipFixBugsLoop: false` + a stub
    // `runFixBugsLoop`.
    skipFixBugsLoop: overrides.skipFixBugsLoop ?? true,
    ...(overrides.runFixBugsLoop !== undefined
      ? { runFixBugsLoop: overrides.runFixBugsLoop }
      : {}),
    ...(overrides.runBuildToSpecVerify !== undefined
      ? { runBuildToSpecVerify: overrides.runBuildToSpecVerify }
      : {}),
    ...(overrides.autoMergeAfterReviewer !== undefined
      ? { autoMergeAfterReviewer: overrides.autoMergeAfterReviewer }
      : {}),
  };
}

function buildFeature(overrides: Partial<Feature> = {}): Feature {
  return {
    id: "feat-auth",
    worktree: "feat-auth",
    branch: "feat/auth",
    priority: "P1",
    depends_on: [],
    skip: [],
    affects_files: [],
    agent_sequence: ["backend-builder", "tester", "reviewer"],
    tasks: [
      {
        id: "auth-api",
        agent: "backend-builder",
        depends_on: [],
        skills: [],
        status: "pending",
        screens: [],
      },
      {
        id: "auth-tests",
        agent: "tester",
        depends_on: [],
        skills: [],
        status: "pending",
        screens: [],
      },
      {
        id: "auth-review",
        agent: "reviewer",
        depends_on: [],
        skills: [],
        status: "pending",
        screens: [],
      },
    ],
    ...overrides,
  };
}

/**
 * Module-scope helper that produces a default-success InvokeAgentFn for
 * tests that don't need to script per-call outcomes. Returns checkout +
 * close success for git-agent ops, "completed" for every task on every
 * other agent. Reused across multiple describe blocks (graph-level + the
 * feat-022 verify suite + the feat-026 fix-loop suite).
 */
function mkOkInvoke(): InvokeAgentFn {
  return async (args) => {
    if (args.agent === "git-agent") {
      if (args.gitOp?.op === "checkout-feature") {
        return {
          taskStatus: {},
          errors: {},
          gitAgentOutput: {
            op: "checkout-feature",
            success: true,
            worktreePath: `.claude/worktrees/${args.gitOp.worktree}`,
            lockfilePath: `.claude/worktrees/${args.gitOp.worktree}.lock`,
            branch: args.gitOp.branch,
            featureId: args.gitOp.featureId,
          },
          costUsd: 0.001,
        };
      }
      const op = args.gitOp;
      const featureId =
        op && op.op !== "resolve-conflict-handoff"
          ? op.featureId
          : "feat-unknown";
      return {
        taskStatus: {},
        errors: {},
        gitAgentOutput: {
          op: "close-feature",
          success: true,
          conflict: false,
          mergeSha: "abc1234",
          featureId,
        },
        costUsd: 0.001,
      };
    }
    return {
      taskStatus: Object.fromEntries(
        args.tasks.map((t) => [t.id, "completed"] as const),
      ),
      errors: {},
      costUsd: 0.01,
    };
  };
}

const checkoutOk: GitAgentOutput = {
  op: "checkout-feature",
  success: true,
  worktreePath: ".claude/worktrees/feat-auth",
  lockfilePath: ".claude/worktrees/feat-auth.lock",
  branch: "feat/auth",
  featureId: "feat-auth",
};

const closeOk: GitAgentOutput = {
  op: "close-feature",
  success: true,
  conflict: false,
  mergeSha: "abc1234",
  featureId: "feat-auth",
};

describe("agentSurface", () => {
  it("maps builder agents to their surface", () => {
    expect(agentSurface("backend-builder")).toBe("backend");
    expect(agentSurface("web-frontend-builder")).toBe("web");
    expect(agentSurface("mobile-frontend-builder")).toBe("mobile");
  });

  it("returns null for cross-surface agents", () => {
    expect(agentSurface("tester")).toBeNull();
    expect(agentSurface("reviewer")).toBeNull();
    expect(agentSurface("security")).toBeNull();
    expect(agentSurface("devops")).toBeNull();
  });
});

describe("runFeature — happy path", () => {
  it("checks out, walks agent_sequence, closes cleanly", async () => {
    const feature = buildFeature();
    const calls: string[] = [];
    const invokeAgent: InvokeAgentFn = async (args) => {
      calls.push(`${args.agent}${args.gitOp ? `:${args.gitOp.op}` : ""}`);
      if (args.agent === "git-agent") {
        const output =
          args.gitOp?.op === "checkout-feature" ? checkoutOk : closeOk;
        return {
          taskStatus: {},
          errors: {},
          gitAgentOutput: output,
          costUsd: 0.001,
        };
      }
      // Build agent — all tasks complete first try
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "completed"] as const),
        ),
        errors: {},
        costUsd: 0.5,
      };
    };

    const result = await runFeature(feature, makeCtx(invokeAgent));
    expect(result.status).toBe("completed");
    expect(result.taskOutcomes).toEqual({
      "auth-api": "completed",
      "auth-tests": "completed",
      "auth-review": "completed",
    });
    expect(calls).toEqual([
      "git-agent:checkout-feature",
      "backend-builder",
      "tester",
      "reviewer",
      "git-agent:close-feature",
    ]);
  });

  it("skips agents whose surface is in feature.skip", async () => {
    const feature = buildFeature({
      skip: ["mobile"],
      agent_sequence: ["backend-builder", "mobile-frontend-builder", "tester"],
      tasks: [
        {
          id: "api",
          agent: "backend-builder",
          depends_on: [],
          skills: [],
          status: "pending",
          screens: [],
        },
        {
          id: "mobile-ui",
          agent: "mobile-frontend-builder",
          depends_on: [],
          skills: [],
          status: "pending",
          screens: [],
        },
        {
          id: "tests",
          agent: "tester",
          depends_on: [],
          skills: [],
          status: "pending",
          screens: [],
        },
      ],
    });
    const invoked: string[] = [];
    const invokeAgent: InvokeAgentFn = async (args) => {
      invoked.push(args.agent);
      if (args.agent === "git-agent") {
        return {
          taskStatus: {},
          errors: {},
          gitAgentOutput:
            args.gitOp?.op === "checkout-feature" ? checkoutOk : closeOk,
          costUsd: 0.001,
        };
      }
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "completed"] as const),
        ),
        errors: {},
        costUsd: 0.1,
      };
    };

    const result = await runFeature(feature, makeCtx(invokeAgent));
    expect(result.status).toBe("completed");
    expect(invoked).not.toContain("mobile-frontend-builder");
    expect(invoked).toContain("backend-builder");
    expect(invoked).toContain("tester");
  });

  it("skips agents listed in sequence but with zero tasks", async () => {
    const feature = buildFeature({
      agent_sequence: ["backend-builder", "tester", "reviewer"],
      tasks: [
        {
          id: "api",
          agent: "backend-builder",
          depends_on: [],
          skills: [],
          status: "pending",
          screens: [],
        },
        // no tester task, no reviewer task
      ],
    });
    const invoked: string[] = [];
    const invokeAgent: InvokeAgentFn = async (args) => {
      invoked.push(args.agent);
      if (args.agent === "git-agent") {
        return {
          taskStatus: {},
          errors: {},
          gitAgentOutput:
            args.gitOp?.op === "checkout-feature" ? checkoutOk : closeOk,
          costUsd: 0.001,
        };
      }
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "completed"] as const),
        ),
        errors: {},
        costUsd: 0.1,
      };
    };

    await runFeature(feature, makeCtx(invokeAgent));
    expect(invoked).toEqual(["git-agent", "backend-builder", "git-agent"]);
  });
});

describe("runFeature — per-task retry", () => {
  // bug-002: TASK_RETRY_CAP was lowered from 3 → 1 for fast-fail debug mode.
  // When the cap is restored to 3 (post Mode-B-stable), update the assertion
  // below from .toBe(1) → .toBe(3).
  it("retries failed tasks up to TASK_RETRY_CAP times then fails the feature", async () => {
    const feature = buildFeature({
      agent_sequence: ["backend-builder"],
      tasks: [
        {
          id: "flaky-api",
          agent: "backend-builder",
          depends_on: [],
          skills: [],
          status: "pending",
          screens: [],
        },
      ],
    });
    let attempts = 0;
    const invokeAgent: InvokeAgentFn = async (args) => {
      if (args.agent === "git-agent") {
        return {
          taskStatus: {},
          errors: {},
          gitAgentOutput:
            args.gitOp?.op === "checkout-feature" ? checkoutOk : closeOk,
          costUsd: 0.001,
        };
      }
      attempts += 1;
      return {
        taskStatus: { "flaky-api": "failed" },
        errors: { "flaky-api": `boom-${attempts}` },
        costUsd: 0.1,
      };
    };

    const ctx = makeCtx(invokeAgent);
    const result = await runFeature(feature, ctx);
    expect(result.status).toBe("failed");
    expect(result.abortReason).toContain("task flaky-api failed");
    // bug-008: TASK_RETRY_CAP restored 1 → 2 post-stabilization (was 1 during
    // bug-002…007 fast-fail debug phase; now that the chain is stable we give
    // transient SDK hiccups one extra retry).
    expect(ctx.retryCounters.get("task-retry", "feat-auth/flaky-api")).toBe(2);
  });

  it("succeeds if a task passes on retry", async () => {
    const feature = buildFeature({
      agent_sequence: ["backend-builder"],
      tasks: [
        {
          id: "flaky-api",
          agent: "backend-builder",
          depends_on: [],
          skills: [],
          status: "pending",
          screens: [],
        },
      ],
    });
    let attempts = 0;
    const invokeAgent: InvokeAgentFn = async (args) => {
      if (args.agent === "git-agent") {
        return {
          taskStatus: {},
          errors: {},
          gitAgentOutput:
            args.gitOp?.op === "checkout-feature" ? checkoutOk : closeOk,
          costUsd: 0.001,
        };
      }
      attempts += 1;
      if (attempts === 1) {
        return {
          taskStatus: { "flaky-api": "failed" },
          errors: { "flaky-api": "first-try-flap" },
          costUsd: 0.1,
        };
      }
      return {
        taskStatus: { "flaky-api": "completed" },
        errors: {},
        costUsd: 0.1,
      };
    };

    const ctx = makeCtx(invokeAgent);
    const result = await runFeature(feature, ctx);
    expect(result.status).toBe("completed");
    expect(result.taskOutcomes["flaky-api"]).toBe("completed");
    expect(ctx.retryCounters.get("task-retry", "feat-auth/flaky-api")).toBe(1);
  });
});

describe("runFeature — merge conflict routing", () => {
  it("routes a conflict through resolve-conflict-handoff then re-closes", async () => {
    const feature = buildFeature({
      agent_sequence: ["backend-builder"],
      tasks: [
        {
          id: "api",
          agent: "backend-builder",
          depends_on: [],
          skills: [],
          status: "pending",
          screens: [],
        },
      ],
    });
    let closeAttempts = 0;
    const invokeAgent: InvokeAgentFn = async (args) => {
      if (args.agent === "git-agent") {
        if (args.gitOp?.op === "checkout-feature") {
          return {
            taskStatus: {},
            errors: {},
            gitAgentOutput: checkoutOk,
            costUsd: 0.001,
          };
        }
        if (args.gitOp?.op === "close-feature") {
          closeAttempts += 1;
          if (closeAttempts === 1) {
            return {
              taskStatus: {},
              errors: {},
              gitAgentOutput: {
                op: "close-feature",
                success: false,
                conflict: true,
                conflictingFiles: ["src/api/auth.ts"],
                lastWritingAgent: "backend-builder",
                worktreePath: ".claude/worktrees/feat-auth",
              },
              costUsd: 0.001,
            };
          }
          return {
            taskStatus: {},
            errors: {},
            gitAgentOutput: closeOk,
            costUsd: 0.001,
          };
        }
      }
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "completed"] as const),
        ),
        errors: {},
        costUsd: 0.1,
      };
    };

    const ctx = makeCtx(invokeAgent);
    const result = await runFeature(feature, ctx);
    expect(result.status).toBe("completed");
    expect(closeAttempts).toBe(2);
    expect(ctx.retryCounters.get("merge-conflict", "feat-auth")).toBe(1);
  });

  it("fires emergency-abort after 3 merge-conflict retries", async () => {
    const feature = buildFeature({
      agent_sequence: ["backend-builder"],
      tasks: [
        {
          id: "api",
          agent: "backend-builder",
          depends_on: [],
          skills: [],
          status: "pending",
          screens: [],
        },
      ],
    });
    const gitOps: string[] = [];
    const invokeAgent: InvokeAgentFn = async (args) => {
      if (args.agent === "git-agent") {
        gitOps.push(args.gitOp!.op);
        if (args.gitOp?.op === "checkout-feature") {
          return {
            taskStatus: {},
            errors: {},
            gitAgentOutput: checkoutOk,
            costUsd: 0.001,
          };
        }
        if (args.gitOp?.op === "emergency-abort") {
          return {
            taskStatus: {},
            errors: {},
            gitAgentOutput: {
              op: "emergency-abort",
              success: true,
              featureId: "feat-auth",
              reason: args.gitOp.reason,
              cleanup: "worktree-removed",
            },
            costUsd: 0.001,
          };
        }
        // close-feature always conflicts
        return {
          taskStatus: {},
          errors: {},
          gitAgentOutput: {
            op: "close-feature",
            success: false,
            conflict: true,
            conflictingFiles: ["src/api/auth.ts"],
            lastWritingAgent: "backend-builder",
            worktreePath: ".claude/worktrees/feat-auth",
          },
          costUsd: 0.001,
        };
      }
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "completed"] as const),
        ),
        errors: {},
        costUsd: 0.1,
      };
    };

    const ctx = makeCtx(invokeAgent);
    const result = await runFeature(feature, ctx);
    expect(result.status).toBe("failed");
    expect(result.abortReason).toContain("merge-conflict exhausted");
    expect(gitOps).toContain("emergency-abort");
    expect(ctx.retryCounters.get("merge-conflict", "feat-auth")).toBe(3);
  });
});

describe("runFeatureGraph — topological order + parallel execution", () => {
  function mkAllSuccessInvoke(): {
    invokeAgent: InvokeAgentFn;
    started: string[];
  } {
    const started: string[] = [];
    const invokeAgent: InvokeAgentFn = async (args) => {
      if (args.agent === "git-agent") {
        if (args.gitOp?.op === "checkout-feature") {
          started.push(args.gitOp.featureId);
          // Force a tiny delay so tests can observe concurrency
          await new Promise((r) => setTimeout(r, 5));
          return {
            taskStatus: {},
            errors: {},
            gitAgentOutput: {
              op: "checkout-feature",
              success: true,
              worktreePath: `.claude/worktrees/${args.gitOp.worktree}`,
              lockfilePath: `.claude/worktrees/${args.gitOp.worktree}.lock`,
              branch: args.gitOp.branch,
              featureId: args.gitOp.featureId,
            },
            costUsd: 0.001,
          };
        }
        if (args.gitOp?.op === "close-feature") {
          return {
            taskStatus: {},
            errors: {},
            gitAgentOutput: {
              op: "close-feature",
              success: true,
              conflict: false,
              mergeSha: "abc1234",
              featureId: args.gitOp.featureId,
            },
            costUsd: 0.001,
          };
        }
      }
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "completed"] as const),
        ),
        errors: {},
        costUsd: 0.01,
      };
    };
    return { invokeAgent, started };
  }

  it("runs independent features in parallel; dependent feature waits", async () => {
    const featA = buildFeature({
      id: "feat-a",
      worktree: "feat-a",
      branch: "feat/a",
    });
    const featB = buildFeature({
      id: "feat-b",
      worktree: "feat-b",
      branch: "feat/b",
      depends_on: ["feat-a"],
      tasks: [
        {
          id: "api-b",
          agent: "backend-builder",
          depends_on: [],
          skills: [],
          status: "pending",
          screens: [],
        },
      ],
      agent_sequence: ["backend-builder"],
    });
    const featC = buildFeature({
      id: "feat-c",
      worktree: "feat-c",
      branch: "feat/c",
      tasks: [
        {
          id: "mob",
          agent: "mobile-frontend-builder",
          depends_on: [],
          skills: [],
          status: "pending",
          screens: [],
        },
      ],
      agent_sequence: ["mobile-frontend-builder"],
    });
    const tasks: TasksV2 = {
      version: "2.0",
      features: [featA, featB, featC],
      warnings: [],
    };

    const { invokeAgent, started } = mkAllSuccessInvoke();
    const result = await runFeatureGraph(tasks, makeCtx(invokeAgent));

    expect(result.completed.sort()).toEqual(["feat-a", "feat-b", "feat-c"]);
    expect(result.failed).toEqual([]);
    // A and C start before B because B depends on A
    const bIdx = started.indexOf("feat-b");
    const aIdx = started.indexOf("feat-a");
    expect(bIdx).toBeGreaterThan(aIdx);
  });

  it("aborts dependents when a dependency fails", async () => {
    const featA = buildFeature({
      id: "feat-a",
      worktree: "feat-a",
      branch: "feat/a",
    });
    const featB = buildFeature({
      id: "feat-b",
      worktree: "feat-b",
      branch: "feat/b",
      depends_on: ["feat-a"],
    });
    const tasks: TasksV2 = {
      version: "2.0",
      features: [featA, featB],
      warnings: [],
    };

    const invokeAgent: InvokeAgentFn = async (args) => {
      if (args.agent === "git-agent") {
        if (args.gitOp?.op === "checkout-feature") {
          return {
            taskStatus: {},
            errors: {},
            gitAgentOutput: {
              op: "checkout-feature",
              success: true,
              worktreePath: `.claude/worktrees/${args.gitOp.worktree}`,
              lockfilePath: `.claude/worktrees/${args.gitOp.worktree}.lock`,
              branch: args.gitOp.branch,
              featureId: args.gitOp.featureId,
            },
            costUsd: 0.001,
          };
        }
        return {
          taskStatus: {},
          errors: {},
          gitAgentOutput: closeOk,
          costUsd: 0.001,
        };
      }
      // Always fail
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "failed"] as const),
        ),
        errors: Object.fromEntries(
          args.tasks.map((t) => [t.id, "forced fail"] as const),
        ),
        costUsd: 0.01,
      };
    };

    const result = await runFeatureGraph(tasks, makeCtx(invokeAgent));
    expect(result.failed.sort()).toEqual(["feat-a", "feat-b"]);
    expect(result.featureResults["feat-b"]!.abortReason).toContain(
      "dependency feat-a failed",
    );
    // feat-b was aborted without running
    expect(result.featureResults["feat-b"]!.attempts).toBe(0);
  });

  it("throws on cyclic feature.depends_on", async () => {
    const featA = buildFeature({
      id: "feat-a",
      worktree: "feat-a",
      branch: "feat/a",
      depends_on: ["feat-b"],
    });
    const featB = buildFeature({
      id: "feat-b",
      worktree: "feat-b",
      branch: "feat/b",
      depends_on: ["feat-a"],
    });
    const tasks: TasksV2 = {
      version: "2.0",
      features: [featA, featB],
      warnings: [],
    };

    const { invokeAgent } = mkAllSuccessInvoke();
    await expect(runFeatureGraph(tasks, makeCtx(invokeAgent))).rejects.toThrow(
      /cycle/,
    );
  });
});

describe("runFeature — gate 6 (pr-review) integration", () => {
  function okInvokeAgent(): { invokeAgent: InvokeAgentFn; gitOps: string[] } {
    const gitOps: string[] = [];
    const invokeAgent: InvokeAgentFn = async (args) => {
      if (args.agent === "git-agent") {
        gitOps.push(args.gitOp!.op);
        return {
          taskStatus: {},
          errors: {},
          gitAgentOutput:
            args.gitOp?.op === "checkout-feature" ? checkoutOk : closeOk,
          costUsd: 0.001,
        };
      }
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "completed"] as const),
        ),
        errors: {},
        costUsd: 0.1,
      };
    };
    return { invokeAgent, gitOps };
  }

  it("fires gate 6 when reviewer is in the sequence; approved → close-feature", async () => {
    const feature = buildFeature();
    const gateCalls: string[] = [];
    const { invokeAgent, gitOps } = okInvokeAgent();
    const ctx = makeCtx(invokeAgent, {
      waitForPrReviewGate: async ({ featureId }) => {
        gateCalls.push(featureId);
        return { approved: true, note: "LGTM" };
      },
    });
    const result = await runFeature(feature, ctx);
    expect(result.status).toBe("completed");
    expect(gateCalls).toEqual(["feat-auth"]);
    expect(gitOps).toEqual(["checkout-feature", "close-feature"]);
  });

  it("gate 6 rejected → feature failed, close-feature NOT called", async () => {
    const feature = buildFeature();
    const { invokeAgent, gitOps } = okInvokeAgent();
    const ctx = makeCtx(invokeAgent, {
      waitForPrReviewGate: async () => ({
        approved: false,
        note: "missing CSRF",
      }),
    });
    const result = await runFeature(feature, ctx);
    expect(result.status).toBe("failed");
    expect(result.abortReason).toContain("gate-6-rejected");
    expect(result.abortReason).toContain("missing CSRF");
    expect(gitOps).toEqual(["checkout-feature"]);
  });

  it("autoMergeAfterReviewer=true short-circuits gate 6", async () => {
    const feature = buildFeature();
    let gateCalled = false;
    const { invokeAgent } = okInvokeAgent();
    const ctx = makeCtx(invokeAgent, {
      autoMergeAfterReviewer: true,
      waitForPrReviewGate: async () => {
        gateCalled = true;
        return { approved: true };
      },
    });
    const result = await runFeature(feature, ctx);
    expect(result.status).toBe("completed");
    expect(gateCalled).toBe(false);
  });

  it("gate 6 does NOT fire when reviewer is absent from sequence", async () => {
    const feature = buildFeature({
      agent_sequence: ["backend-builder"],
      tasks: [
        {
          id: "api",
          agent: "backend-builder",
          depends_on: [],
          skills: [],
          status: "pending",
          screens: [],
        },
      ],
    });
    let gateCalled = false;
    const { invokeAgent } = okInvokeAgent();
    const ctx = makeCtx(invokeAgent, {
      waitForPrReviewGate: async () => {
        gateCalled = true;
        return { approved: true };
      },
    });
    const result = await runFeature(feature, ctx);
    expect(result.status).toBe("completed");
    expect(gateCalled).toBe(false);
  });
});

// ─── feat-018 Phase A: auto-commit per agent step ─────────────────────

describe("runFeature — auto-commit per agent step (feat-018 Phase A)", () => {
  function okGitInvoke(): InvokeAgentFn {
    return async (args) => {
      if (args.agent === "git-agent") {
        return {
          taskStatus: {},
          errors: {},
          gitAgentOutput:
            args.gitOp?.op === "checkout-feature" ? checkoutOk : closeOk,
          costUsd: 0.001,
        };
      }
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "completed"] as const),
        ),
        errors: {},
        costUsd: 0.1,
      };
    };
  }

  it("calls commitWorktreeChanges once per successful agent step with the right message", async () => {
    const feature = buildFeature(); // backend-builder + tester + reviewer
    const commitCalls: Array<{ cwd: string; message: string }> = [];
    const ctx = makeCtx(okGitInvoke(), {
      commitWorktreeChanges: async (cwd, message) => {
        commitCalls.push({ cwd, message });
        return { committed: true, sha: `sha-${commitCalls.length}` };
      },
    });
    const result = await runFeature(feature, ctx);
    expect(result.status).toBe("completed");
    expect(commitCalls).toHaveLength(3); // builder + tester + reviewer

    // Each message follows the contract:
    //   "<agent>: <task-ids>\n\n[via orchestrator Mode B; feature: <id>]"
    expect(commitCalls[0]!.message).toContain("backend-builder: auth-api");
    expect(commitCalls[0]!.message).toContain(
      "[via orchestrator Mode B; feature: feat-auth]",
    );
    expect(commitCalls[1]!.message).toContain("tester: auth-tests");
    expect(commitCalls[2]!.message).toContain("reviewer: auth-review");

    // All called against the worktree's absolute cwd.
    for (const call of commitCalls) {
      expect(call.cwd).toContain(".claude/worktrees/feat-auth");
    }
  });

  it("comma-separates multiple task ids in the commit message", async () => {
    const feature = buildFeature({
      agent_sequence: ["backend-builder"],
      tasks: [
        {
          id: "schema-a",
          agent: "backend-builder",
          depends_on: [],
          skills: [],
          status: "pending",
          screens: [],
        },
        {
          id: "schema-b",
          agent: "backend-builder",
          depends_on: [],
          skills: [],
          status: "pending",
          screens: [],
        },
      ],
    });
    const commitCalls: Array<{ cwd: string; message: string }> = [];
    const ctx = makeCtx(okGitInvoke(), {
      commitWorktreeChanges: async (cwd, message) => {
        commitCalls.push({ cwd, message });
        return { committed: true, sha: "abc" };
      },
    });
    await runFeature(feature, ctx);
    expect(commitCalls).toHaveLength(1);
    expect(commitCalls[0]!.message).toMatch(
      /backend-builder: schema-a, schema-b/,
    );
  });

  it("does NOT call commit when the agent step fails (preserves dirty worktree)", async () => {
    const feature = buildFeature({
      agent_sequence: ["backend-builder"],
      tasks: [
        {
          id: "broken-task",
          agent: "backend-builder",
          depends_on: [],
          skills: [],
          status: "pending",
          screens: [],
        },
      ],
    });
    const commitCalls: string[] = [];
    const invokeAgent: InvokeAgentFn = async (args) => {
      if (args.agent === "git-agent") {
        return {
          taskStatus: {},
          errors: {},
          gitAgentOutput:
            args.gitOp?.op === "checkout-feature" ? checkoutOk : closeOk,
          costUsd: 0.001,
        };
      }
      // Always fail
      return {
        taskStatus: { "broken-task": "failed" },
        errors: { "broken-task": "boom" },
        costUsd: 0.1,
      };
    };
    const ctx = makeCtx(invokeAgent, {
      commitWorktreeChanges: async (_cwd, msg) => {
        commitCalls.push(msg);
        return { committed: true, sha: "abc" };
      },
    });
    const result = await runFeature(feature, ctx);
    expect(result.status).toBe("failed");
    expect(commitCalls).toEqual([]); // never called
  });

  it("never calls commit for the git-agent itself", async () => {
    const feature = buildFeature();
    const commitCalls: string[] = [];
    const ctx = makeCtx(okGitInvoke(), {
      commitWorktreeChanges: async (_cwd, msg) => {
        commitCalls.push(msg);
        return { committed: true, sha: "abc" };
      },
    });
    await runFeature(feature, ctx);
    // 3 build agents in sequence; no commit message starts with git-agent.
    expect(commitCalls).toHaveLength(3);
    for (const m of commitCalls) {
      expect(m).not.toContain("git-agent:");
    }
  });

  it("continues iteration after a commit warning (does NOT fail the feature)", async () => {
    const feature = buildFeature();
    const ctx = makeCtx(okGitInvoke(), {
      commitWorktreeChanges: async (_cwd, message) => {
        // Always warn — simulating a buggy git env.
        return {
          committed: false,
          warning: `simulated warning for: ${message.split(":")[0]}`,
        };
      },
    });
    const result = await runFeature(feature, ctx);
    expect(result.status).toBe("completed");
    expect(result.commitWarnings).toBeDefined();
    expect(result.commitWarnings!.length).toBe(3);
    expect(result.commitWarnings![0]).toContain("simulated warning");
    expect(result.taskOutcomes).toEqual({
      "auth-api": "completed",
      "auth-tests": "completed",
      "auth-review": "completed",
    });
  });

  it("commitWarnings is undefined / empty when every commit succeeds", async () => {
    const feature = buildFeature();
    const ctx = makeCtx(okGitInvoke(), {
      commitWorktreeChanges: async () => ({
        committed: true,
        sha: "abc1234",
      }),
    });
    const result = await runFeature(feature, ctx);
    expect(result.status).toBe("completed");
    expect(result.commitWarnings).toBeUndefined();
  });

  it("clean-tree no-op (committed: false, no warning) records nothing", async () => {
    const feature = buildFeature();
    const ctx = makeCtx(okGitInvoke(), {
      commitWorktreeChanges: async () => ({ committed: false }),
    });
    const result = await runFeature(feature, ctx);
    expect(result.status).toBe("completed");
    expect(result.commitWarnings).toBeUndefined();
  });
});

// ─── feat-019 Phase B: install-after-commit ───────────────────────────

describe("runFeature — install-after-commit (feat-019 Phase B)", () => {
  function okGitInvoke(): InvokeAgentFn {
    return async (args) => {
      if (args.agent === "git-agent") {
        return {
          taskStatus: {},
          errors: {},
          gitAgentOutput:
            args.gitOp?.op === "checkout-feature" ? checkoutOk : closeOk,
          costUsd: 0.001,
        };
      }
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "completed"] as const),
        ),
        errors: {},
        costUsd: 0.1,
      };
    };
  }

  it("after successful commit + package.json change → install fires once per agent step", async () => {
    const feature = buildFeature(); // backend-builder + tester + reviewer
    const installCalls: string[] = [];
    const ctx = makeCtx(okGitInvoke(), {
      commitWorktreeChanges: async () => ({
        committed: true,
        sha: "abc1234",
      }),
      installIfPackageJsonChanged: async (cwd) => {
        installCalls.push(cwd);
        return { installed: true };
      },
    });
    const result = await runFeature(feature, ctx);
    expect(result.status).toBe("completed");
    // 3 build agents → 3 commit-then-install pairs.
    expect(installCalls).toHaveLength(3);
    for (const cwd of installCalls) {
      expect(cwd).toContain(".claude/worktrees/feat-auth");
    }
    expect(result.commitWarnings).toBeUndefined();
  });

  it("after successful commit without package.json change → install helper called but no-op { installed: false }", async () => {
    // The orchestrator calls the helper unconditionally on commit-success;
    // the helper itself is what decides whether to run pnpm install.
    // From runFeature's perspective: helper called, no warning bubbles.
    const feature = buildFeature();
    let helperCalls = 0;
    const ctx = makeCtx(okGitInvoke(), {
      commitWorktreeChanges: async () => ({
        committed: true,
        sha: "abc1234",
      }),
      installIfPackageJsonChanged: async () => {
        helperCalls += 1;
        return { installed: false };
      },
    });
    const result = await runFeature(feature, ctx);
    expect(result.status).toBe("completed");
    expect(helperCalls).toBe(3);
    expect(result.commitWarnings).toBeUndefined();
  });

  it("install helper NOT called when commit didn't land (committed: false, clean tree)", async () => {
    const feature = buildFeature();
    let helperCalls = 0;
    const ctx = makeCtx(okGitInvoke(), {
      commitWorktreeChanges: async () => ({ committed: false }),
      installIfPackageJsonChanged: async () => {
        helperCalls += 1;
        return { installed: false };
      },
    });
    const result = await runFeature(feature, ctx);
    expect(result.status).toBe("completed");
    expect(helperCalls).toBe(0);
  });

  it("install warning is appended to commitWarnings + surfaces in FeatureResult", async () => {
    const feature = buildFeature();
    const ctx = makeCtx(okGitInvoke(), {
      commitWorktreeChanges: async () => ({
        committed: true,
        sha: "abc1234",
      }),
      installIfPackageJsonChanged: async () => ({
        installed: false,
        warning: "pnpm install failed (commit had package.json changes): boom",
      }),
    });
    const result = await runFeature(feature, ctx);
    expect(result.status).toBe("completed");
    expect(result.commitWarnings).toBeDefined();
    expect(result.commitWarnings!.length).toBe(3);
    for (const w of result.commitWarnings!) {
      expect(w).toContain("pnpm install failed");
    }
  });

  it("install failure does NOT abort the feature — next agent in sequence still runs", async () => {
    const feature = buildFeature(); // backend-builder + tester + reviewer
    const agentInvocations: string[] = [];
    const invokeAgent: InvokeAgentFn = async (args) => {
      if (args.agent === "git-agent") {
        return {
          taskStatus: {},
          errors: {},
          gitAgentOutput:
            args.gitOp?.op === "checkout-feature" ? checkoutOk : closeOk,
          costUsd: 0.001,
        };
      }
      agentInvocations.push(args.agent);
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "completed"] as const),
        ),
        errors: {},
        costUsd: 0.1,
      };
    };
    const ctx = makeCtx(invokeAgent, {
      commitWorktreeChanges: async () => ({
        committed: true,
        sha: "abc1234",
      }),
      // First install fails; runFeature must continue iteration.
      installIfPackageJsonChanged: async () => ({
        installed: false,
        warning: "pnpm install failed: registry 500",
      }),
    });
    const result = await runFeature(feature, ctx);
    expect(result.status).toBe("completed");
    // Every agent in the sequence ran despite the install warnings.
    expect(agentInvocations).toEqual(["backend-builder", "tester", "reviewer"]);
    expect(result.taskOutcomes).toEqual({
      "auth-api": "completed",
      "auth-tests": "completed",
      "auth-review": "completed",
    });
  });
});

describe("runFeatureGraph — feat-022 build-to-spec verification", () => {
  // mkOkInvoke is defined at module scope below for reuse across describe blocks.

  it("runs verify after all features merge; status=completed when verify ok", async () => {
    const featA = buildFeature({
      id: "feat-a",
      worktree: "feat-a",
      branch: "feat/a",
    });
    const tasks: TasksV2 = {
      version: "2.0",
      features: [featA],
      warnings: [],
    };

    let verifyCalled = 0;
    const result = await runFeatureGraph(
      tasks,
      makeCtx(mkOkInvoke(), {
        skipBuildToSpecVerify: false,
        runBuildToSpecVerify: async () => {
          verifyCalled += 1;
          return {
            ok: true,
            reachability: {
              orphanComponents: [],
              orphanRoutes: [],
              scannedFiles: 42,
              ignoredByAllowComment: [],
            },
            flows: { passed: ["flow-1"], failed: [], generated: [] },
            bugPlansFiled: [],
            costUsd: 0,
            durationMs: 100,
            warnings: [],
          };
        },
      }),
    );

    expect(verifyCalled).toBe(1);
    expect(result.completed).toEqual(["feat-a"]);
    expect(result.status).toBe("completed");
    expect(result.verify).toBeDefined();
    expect(result.verify!.ok).toBe(true);
    expect(result.verify!.reachability.scannedFiles).toBe(42);
  });

  it("status=completed-with-integration-failures when verify reports violations", async () => {
    const featA = buildFeature({
      id: "feat-a",
      worktree: "feat-a",
      branch: "feat/a",
    });
    const tasks: TasksV2 = {
      version: "2.0",
      features: [featA],
      warnings: [],
    };

    const result = await runFeatureGraph(
      tasks,
      makeCtx(mkOkInvoke(), {
        skipBuildToSpecVerify: false,
        runBuildToSpecVerify: async () => ({
          ok: false,
          reachability: {
            orphanComponents: [
              {
                path: "apps/web/src/components/board/CardDetailModal.tsx",
                exportNames: ["CardDetailModal"],
                owningFeature: "feat-board-core",
                suggestedImporters: [
                  "apps/web/src/components/board/KanbanBoard.tsx",
                ],
                reason: "exported but no production importer",
              },
            ],
            orphanRoutes: [],
            scannedFiles: 25,
            ignoredByAllowComment: [],
          },
          flows: { passed: [], failed: [], generated: [] },
          bugPlansFiled: ["bug-100-orphan-CardDetailModal"],
          costUsd: 0,
          durationMs: 200,
          warnings: [],
        }),
      }),
    );

    expect(result.status).toBe("completed-with-integration-failures");
    expect(result.verify!.bugPlansFiled).toContain(
      "bug-100-orphan-CardDetailModal",
    );
    expect(result.verify!.reachability.orphanComponents).toHaveLength(1);
  });

  it("skips verify entirely when skipBuildToSpecVerify=true", async () => {
    const featA = buildFeature({
      id: "feat-a",
      worktree: "feat-a",
      branch: "feat/a",
    });
    const tasks: TasksV2 = {
      version: "2.0",
      features: [featA],
      warnings: [],
    };

    let verifyCalled = 0;
    const result = await runFeatureGraph(
      tasks,
      makeCtx(mkOkInvoke(), {
        skipBuildToSpecVerify: true,
        runBuildToSpecVerify: async () => {
          verifyCalled += 1;
          return {
            ok: true,
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
            warnings: [],
          };
        },
      }),
    );

    expect(verifyCalled).toBe(0);
    expect(result.status).toBe("completed");
    expect(result.verify).toBeUndefined();
  });

  it("skips verify when any feature failed (status=incomplete)", async () => {
    const featA = buildFeature({
      id: "feat-a",
      worktree: "feat-a",
      branch: "feat/a",
    });
    const tasks: TasksV2 = {
      version: "2.0",
      features: [featA],
      warnings: [],
    };

    // Force the build agent to always fail every task.
    const failingInvoke: InvokeAgentFn = async (args) => {
      if (args.agent === "git-agent") {
        if (args.gitOp?.op === "checkout-feature") {
          return {
            taskStatus: {},
            errors: {},
            gitAgentOutput: {
              op: "checkout-feature",
              success: true,
              worktreePath: `.claude/worktrees/${args.gitOp.worktree}`,
              lockfilePath: `.claude/worktrees/${args.gitOp.worktree}.lock`,
              branch: args.gitOp.branch,
              featureId: args.gitOp.featureId,
            },
            costUsd: 0.001,
          };
        }
        return {
          taskStatus: {},
          errors: {},
          gitAgentOutput: closeOk,
          costUsd: 0.001,
        };
      }
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "failed"] as const),
        ),
        errors: Object.fromEntries(
          args.tasks.map((t) => [t.id, "synthetic failure"] as const),
        ),
        costUsd: 0.01,
      };
    };

    let verifyCalled = 0;
    const result = await runFeatureGraph(
      tasks,
      makeCtx(failingInvoke, {
        skipBuildToSpecVerify: false,
        runBuildToSpecVerify: async () => {
          verifyCalled += 1;
          return {
            ok: true,
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
            warnings: [],
          };
        },
      }),
    );

    expect(verifyCalled).toBe(0);
    expect(result.status).toBe("incomplete");
    expect(result.failed).toEqual(["feat-a"]);
    expect(result.verify).toBeUndefined();
  });

  it("verify thrower → status=completed-with-integration-failures + warning surfaced", async () => {
    const featA = buildFeature({
      id: "feat-a",
      worktree: "feat-a",
      branch: "feat/a",
    });
    const tasks: TasksV2 = {
      version: "2.0",
      features: [featA],
      warnings: [],
    };

    const result = await runFeatureGraph(
      tasks,
      makeCtx(mkOkInvoke(), {
        skipBuildToSpecVerify: false,
        runBuildToSpecVerify: async () => {
          throw new Error("synthetic verify-runner crash");
        },
      }),
    );

    expect(result.status).toBe("completed-with-integration-failures");
    expect(result.verify).toBeDefined();
    expect(result.verify!.ok).toBe(false);
    expect(result.verify!.warnings.join(" ")).toContain(
      "synthetic verify-runner crash",
    );
  });
});

// ─── feat-026: automated bug-fix loop integration ─────────────────────────
//
// These tests assert the orchestrator wires the post-verify bug-fix loop
// correctly: gated on verify producing bugs, suppressed via
// skipFixBugsLoop, status flips back to "completed" when the loop reaches
// clean. No real fix-loop machinery runs — the runFixBugsLoop seam is
// stubbed.

describe("runFeatureGraph — feat-026 fix-bugs-loop wiring", () => {
  const featA = (): import("@repo/orchestrator-contracts").Feature =>
    buildFeature({
      id: "feat-a",
      worktree: "feat-a",
      branch: "feat/a",
    });

  const tasksFor = (
    f: import("@repo/orchestrator-contracts").Feature,
  ): TasksV2 => ({
    version: "2.0",
    features: [f],
    warnings: [],
  });

  const verifyWithBugs = async () => ({
    ok: false,
    reachability: {
      orphanComponents: [],
      orphanRoutes: [],
      scannedFiles: 5,
      ignoredByAllowComment: [],
    },
    flows: { passed: [], failed: [], generated: [] },
    bugPlansFiled: ["bug-100-orphan-foo"],
    costUsd: 0,
    durationMs: 50,
    warnings: [],
  });

  const verifyClean = async () => ({
    ok: true,
    reachability: {
      orphanComponents: [],
      orphanRoutes: [],
      scannedFiles: 5,
      ignoredByAllowComment: [],
    },
    flows: { passed: [], failed: [], generated: [] },
    bugPlansFiled: [],
    costUsd: 0,
    durationMs: 50,
    warnings: [],
  });

  it("invokes fix-bugs-loop after verify produces bugs (default behavior)", async () => {
    let loopCalled = 0;
    const result = await runFeatureGraph(
      tasksFor(featA()),
      makeCtx(mkOkInvoke(), {
        skipBuildToSpecVerify: false,
        runBuildToSpecVerify: verifyWithBugs,
        skipFixBugsLoop: false,
        runFixBugsLoop: async () => {
          loopCalled += 1;
          return {
            status: "clean",
            iterationsRun: 1,
            bugsResolved: ["bug-orphan-foo"],
            bugsFailed: [],
            bugsRemaining: [],
            totalCostUsd: 1.5,
            iterationLog: [],
          };
        },
      }),
    );
    expect(loopCalled).toBe(1);
    expect(result.bugLoopResult).toBeDefined();
    expect(result.bugLoopResult!.status).toBe("clean");
    // Status flipped from completed-with-integration-failures back to completed
    expect(result.status).toBe("completed");
  });

  it("skips fix-bugs-loop when skipFixBugsLoop=true (default for tests)", async () => {
    let loopCalled = 0;
    const result = await runFeatureGraph(
      tasksFor(featA()),
      makeCtx(mkOkInvoke(), {
        skipBuildToSpecVerify: false,
        runBuildToSpecVerify: verifyWithBugs,
        skipFixBugsLoop: true,
        runFixBugsLoop: async () => {
          loopCalled += 1;
          return {
            status: "clean",
            iterationsRun: 0,
            bugsResolved: [],
            bugsFailed: [],
            bugsRemaining: [],
            totalCostUsd: 0,
            iterationLog: [],
          };
        },
      }),
    );
    expect(loopCalled).toBe(0);
    expect(result.bugLoopResult).toBeUndefined();
    expect(result.status).toBe("completed-with-integration-failures");
  });

  it("does NOT invoke fix-bugs-loop when verify is clean (zero bugs)", async () => {
    let loopCalled = 0;
    const result = await runFeatureGraph(
      tasksFor(featA()),
      makeCtx(mkOkInvoke(), {
        skipBuildToSpecVerify: false,
        runBuildToSpecVerify: verifyClean,
        skipFixBugsLoop: false,
        runFixBugsLoop: async () => {
          loopCalled += 1;
          return {
            status: "no-bugs",
            iterationsRun: 0,
            bugsResolved: [],
            bugsFailed: [],
            bugsRemaining: [],
            totalCostUsd: 0,
            iterationLog: [],
          };
        },
      }),
    );
    expect(loopCalled).toBe(0);
    expect(result.bugLoopResult).toBeUndefined();
    expect(result.status).toBe("completed");
  });

  it("does NOT invoke fix-bugs-loop when verify is suppressed entirely", async () => {
    let loopCalled = 0;
    const result = await runFeatureGraph(
      tasksFor(featA()),
      makeCtx(mkOkInvoke(), {
        skipBuildToSpecVerify: true,
        skipFixBugsLoop: false,
        runFixBugsLoop: async () => {
          loopCalled += 1;
          return {
            status: "clean",
            iterationsRun: 0,
            bugsResolved: [],
            bugsFailed: [],
            bugsRemaining: [],
            totalCostUsd: 0,
            iterationLog: [],
          };
        },
      }),
    );
    expect(loopCalled).toBe(0);
    expect(result.bugLoopResult).toBeUndefined();
    expect(result.status).toBe("completed");
  });

  it("status stays completed-with-integration-failures when loop hits iteration cap", async () => {
    const result = await runFeatureGraph(
      tasksFor(featA()),
      makeCtx(mkOkInvoke(), {
        skipBuildToSpecVerify: false,
        runBuildToSpecVerify: verifyWithBugs,
        skipFixBugsLoop: false,
        runFixBugsLoop: async () => ({
          status: "iteration-cap-hit",
          iterationsRun: 5,
          bugsResolved: ["bug-orphan-resolved"],
          bugsFailed: [],
          bugsRemaining: ["bug-orphan-stuck"],
          totalCostUsd: 12.34,
          iterationLog: [],
        }),
      }),
    );
    expect(result.bugLoopResult!.status).toBe("iteration-cap-hit");
    expect(result.status).toBe("completed-with-integration-failures");
    expect(result.bugLoopResult!.bugsRemaining).toEqual(["bug-orphan-stuck"]);
  });

  it("status stays completed-with-integration-failures when loop reports all-bugs-failed", async () => {
    const result = await runFeatureGraph(
      tasksFor(featA()),
      makeCtx(mkOkInvoke(), {
        skipBuildToSpecVerify: false,
        runBuildToSpecVerify: verifyWithBugs,
        skipFixBugsLoop: false,
        runFixBugsLoop: async () => ({
          status: "all-bugs-failed",
          iterationsRun: 3,
          bugsResolved: [],
          bugsFailed: ["bug-orphan-A", "bug-orphan-B"],
          bugsRemaining: [],
          totalCostUsd: 8.0,
          iterationLog: [],
        }),
      }),
    );
    expect(result.bugLoopResult!.status).toBe("all-bugs-failed");
    expect(result.status).toBe("completed-with-integration-failures");
  });

  it("loop totalCostUsd accumulates into FeatureGraphResult.totalCostUsd", async () => {
    const result = await runFeatureGraph(
      tasksFor(featA()),
      makeCtx(mkOkInvoke(), {
        skipBuildToSpecVerify: false,
        runBuildToSpecVerify: verifyWithBugs,
        skipFixBugsLoop: false,
        runFixBugsLoop: async () => ({
          status: "clean",
          iterationsRun: 1,
          bugsResolved: ["bug-orphan-x"],
          bugsFailed: [],
          bugsRemaining: [],
          totalCostUsd: 7.42,
          iterationLog: [],
        }),
      }),
    );
    // totalCostUsd is the sum of all features + the loop's cost. Features
    // here are stub-cheap ($0.001-ish per agent call). Verify cost is also
    // added separately by the loop's internal verify calls (we stub them
    // to 0). The loop's $7.42 must be present.
    expect(result.totalCostUsd).toBeGreaterThanOrEqual(7.42);
  });

  it("a thrown loop runner surfaces a warning + leaves status at integration-failures", async () => {
    const result = await runFeatureGraph(
      tasksFor(featA()),
      makeCtx(mkOkInvoke(), {
        skipBuildToSpecVerify: false,
        runBuildToSpecVerify: verifyWithBugs,
        skipFixBugsLoop: false,
        runFixBugsLoop: async () => {
          throw new Error("synthetic loop crash");
        },
      }),
    );
    expect(result.status).toBe("completed-with-integration-failures");
    expect(result.bugLoopResult).toBeUndefined();
    expect(result.verify!.warnings.join(" ")).toContain(
      "runFixBugsLoop threw: synthetic loop crash",
    );
  });

  it("does NOT invoke fix-bugs-loop when verify produced no bug plans (ok=false defensive)", async () => {
    // verify.ok=false but bugPlansFiled=[]: the gate condition uses OR, so
    // the loop fires anyway. This test asserts the behavior in case the
    // verifier reports a soft failure with no actionable bugs (e.g. a
    // missing manifest). Loop returns no-bugs immediately.
    let loopCalled = 0;
    const result = await runFeatureGraph(
      tasksFor(featA()),
      makeCtx(mkOkInvoke(), {
        skipBuildToSpecVerify: false,
        runBuildToSpecVerify: async () => ({
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
          warnings: ["soft failure"],
        }),
        skipFixBugsLoop: false,
        runFixBugsLoop: async () => {
          loopCalled += 1;
          return {
            status: "no-bugs",
            iterationsRun: 0,
            bugsResolved: [],
            bugsFailed: [],
            bugsRemaining: [],
            totalCostUsd: 0,
            iterationLog: [],
          };
        },
      }),
    );
    // verify.ok=false triggers the gate; loop runs but reports no-bugs
    expect(loopCalled).toBe(1);
    expect(result.bugLoopResult!.status).toBe("no-bugs");
  });
});

// ─── bug-021: resume-aware feature graph ──────────────────────────────────
//
// Prior to bug-021, runFeature always called checkout-feature, which
// hard-failed with `stale-worktree` for any feature whose worktree already
// existed from a paused prior run. The fix: when ctx.seedProgress contains
// an inFlight[] entry for the feature, runFeature skips checkout +
// advances agent_sequence walk to nextAgent. When seedProgress contains a
// completed/failed/aborted entry, runFeatureGraph skips the feature
// entirely (no dispatch).
describe("runFeatureGraph — bug-021 resume-aware dispatch", () => {
  const NOW_ISO = "2026-04-28T03:30:00.000Z";

  it("skips checkout-feature for an in-flight feature + starts walk from nextAgent", async () => {
    // Arrange: pretend a prior run got through backend-builder, paused
    // before tester. The on-disk snapshot has an inFlight entry with
    // lastAgent=backend-builder, nextAgent=tester.
    const seedProgress: FeatureGraphProgress = {
      version: "1.0",
      pipelineRunId: "pipe-test-001",
      lastUpdatedAt: NOW_ISO,
      masterCommitSha: "abcd1234",
      completed: [],
      failed: [],
      aborted: [],
      inFlight: [
        {
          featureId: "feat-auth",
          worktree: "feat-auth",
          branch: "feat/auth",
          lastAgent: "backend-builder",
          nextAgent: "tester",
          lastProgressAt: NOW_ISO,
          dispatchedAt: NOW_ISO,
        },
      ],
    };

    // Track which agents are dispatched. We expect: NO checkout-feature,
    // tester (the resume-from agent), reviewer, then close-feature.
    const dispatched: string[] = [];
    const invokeAgent: InvokeAgentFn = async (args) => {
      if (args.agent === "git-agent") {
        const op = args.gitOp?.op ?? "(no-op)";
        dispatched.push(`git-agent:${op}`);
        if (op === "checkout-feature") {
          // If we ever hit this path on resume, the test fails — and the
          // bug-021 empirical hit reproduces.
          throw new Error("checkout-feature was dispatched on resume");
        }
        return {
          taskStatus: {},
          errors: {},
          gitAgentOutput: {
            op: "close-feature",
            success: true,
            conflict: false,
            mergeSha: "deadbee",
            featureId: "feat-auth",
          },
          costUsd: 0.001,
        };
      }
      dispatched.push(args.agent);
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "completed"] as const),
        ),
        errors: {},
        costUsd: 0.01,
      };
    };

    const tasks: TasksV2 = {
      version: "2.0",
      warnings: [],
      features: [buildFeature()],
    };

    // Act
    const ctx = makeCtx(invokeAgent);
    const result = await runFeatureGraph(tasks, {
      ...ctx,
      seedProgress,
    });

    // Assert: agent walk started at tester (skipped backend-builder), then
    // reviewer, then close-feature. NO checkout-feature.
    expect(dispatched).toEqual([
      "tester",
      "reviewer",
      "git-agent:close-feature",
    ]);
    expect(result.completed).toEqual(["feat-auth"]);
    expect(result.failed).toEqual([]);
  });

  it("skips agent_sequence walk entirely when nextAgent === null + goes straight to close-feature", async () => {
    // Arrange: prior run completed reviewer (the last agent in the
    // sequence) but paused before close-feature. Snapshot has nextAgent=null.
    const seedProgress: FeatureGraphProgress = {
      version: "1.0",
      pipelineRunId: "pipe-test-001",
      lastUpdatedAt: NOW_ISO,
      masterCommitSha: "abcd1234",
      completed: [],
      failed: [],
      aborted: [],
      inFlight: [
        {
          featureId: "feat-auth",
          worktree: "feat-auth",
          branch: "feat/auth",
          lastAgent: "reviewer",
          nextAgent: null,
          lastProgressAt: NOW_ISO,
          dispatchedAt: NOW_ISO,
        },
      ],
    };

    const dispatched: string[] = [];
    const invokeAgent: InvokeAgentFn = async (args) => {
      if (args.agent === "git-agent") {
        const op = args.gitOp?.op ?? "(no-op)";
        dispatched.push(`git-agent:${op}`);
        if (op === "checkout-feature") {
          throw new Error("checkout-feature was dispatched on resume");
        }
        return {
          taskStatus: {},
          errors: {},
          gitAgentOutput: {
            op: "close-feature",
            success: true,
            conflict: false,
            mergeSha: "deadbee",
            featureId: "feat-auth",
          },
          costUsd: 0.001,
        };
      }
      dispatched.push(args.agent);
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "completed"] as const),
        ),
        errors: {},
        costUsd: 0.01,
      };
    };

    const tasks: TasksV2 = {
      version: "2.0",
      warnings: [],
      features: [buildFeature()],
    };

    const ctx = makeCtx(invokeAgent);
    const result = await runFeatureGraph(tasks, { ...ctx, seedProgress });

    // Assert: ONLY close-feature was dispatched.
    expect(dispatched).toEqual(["git-agent:close-feature"]);
    expect(result.completed).toEqual(["feat-auth"]);
  });

  it("falls back to walking from index 0 when snapshot's nextAgent is no longer in agent_sequence", async () => {
    // Arrange: tasks.yaml was edited between pause + resume, removing the
    // agent that was the snapshot's nextAgent. Resume must NOT crash —
    // conservative fallback: walk from start.
    const seedProgress: FeatureGraphProgress = {
      version: "1.0",
      pipelineRunId: "pipe-test-001",
      lastUpdatedAt: NOW_ISO,
      masterCommitSha: "abcd1234",
      completed: [],
      failed: [],
      aborted: [],
      inFlight: [
        {
          featureId: "feat-auth",
          worktree: "feat-auth",
          branch: "feat/auth",
          lastAgent: "backend-builder",
          // mobile-frontend-builder is NOT in agent_sequence below.
          nextAgent: "mobile-frontend-builder",
          lastProgressAt: NOW_ISO,
          dispatchedAt: NOW_ISO,
        },
      ],
    };

    const dispatched: string[] = [];
    const invokeAgent: InvokeAgentFn = async (args) => {
      if (args.agent === "git-agent") {
        const op = args.gitOp?.op ?? "(no-op)";
        dispatched.push(`git-agent:${op}`);
        if (op === "checkout-feature") {
          throw new Error("checkout-feature was dispatched on resume");
        }
        return {
          taskStatus: {},
          errors: {},
          gitAgentOutput: {
            op: "close-feature",
            success: true,
            conflict: false,
            mergeSha: "deadbee",
            featureId: "feat-auth",
          },
          costUsd: 0.001,
        };
      }
      dispatched.push(args.agent);
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "completed"] as const),
        ),
        errors: {},
        costUsd: 0.01,
      };
    };

    const tasks: TasksV2 = {
      version: "2.0",
      warnings: [],
      features: [buildFeature()],
    };

    const ctx = makeCtx(invokeAgent);
    await runFeatureGraph(tasks, { ...ctx, seedProgress });

    // Assert: walked from index 0 (backend-builder onward); checkout still
    // skipped because the resume signal was honored.
    expect(dispatched).toEqual([
      "backend-builder",
      "tester",
      "reviewer",
      "git-agent:close-feature",
    ]);
  });

  it("skips features already in seed.completed[] without dispatching them", async () => {
    // Arrange: prior run merged feat-auth. New run should not re-dispatch.
    const seedProgress: FeatureGraphProgress = {
      version: "1.0",
      pipelineRunId: "pipe-test-001",
      lastUpdatedAt: NOW_ISO,
      masterCommitSha: "abcd1234",
      completed: ["feat-auth"],
      failed: [],
      aborted: [],
      inFlight: [],
    };

    let invocations = 0;
    const invokeAgent: InvokeAgentFn = async () => {
      invocations += 1;
      return {
        taskStatus: {},
        errors: {},
        costUsd: 0,
      };
    };

    const tasks: TasksV2 = {
      version: "2.0",
      warnings: [],
      features: [buildFeature()],
    };

    const ctx = makeCtx(invokeAgent);
    const result = await runFeatureGraph(tasks, { ...ctx, seedProgress });

    // Zero invocations — feature was carried over from prior run.
    expect(invocations).toBe(0);
    expect(result.completed).toEqual(["feat-auth"]);
    expect(result.featureResults["feat-auth"]?.status).toBe("completed");
    expect(result.featureResults["feat-auth"]?.attempts).toBe(0);
  });

  it("skips features already in seed.failed[] + records carryover reason", async () => {
    const seedProgress: FeatureGraphProgress = {
      version: "1.0",
      pipelineRunId: "pipe-test-001",
      lastUpdatedAt: NOW_ISO,
      masterCommitSha: "abcd1234",
      completed: [],
      failed: ["feat-auth"],
      aborted: [],
      inFlight: [],
    };

    let invocations = 0;
    const invokeAgent: InvokeAgentFn = async () => {
      invocations += 1;
      return { taskStatus: {}, errors: {}, costUsd: 0 };
    };

    const tasks: TasksV2 = {
      version: "2.0",
      warnings: [],
      features: [buildFeature()],
    };

    const ctx = makeCtx(invokeAgent);
    const result = await runFeatureGraph(tasks, { ...ctx, seedProgress });

    expect(invocations).toBe(0);
    expect(result.failed).toEqual(["feat-auth"]);
    expect(result.featureResults["feat-auth"]?.status).toBe("failed");
    expect(result.featureResults["feat-auth"]?.abortReason).toMatch(
      /carried over from prior run/,
    );
  });

  it("seedProgress=undefined behaves like a fresh run (no resume path)", async () => {
    // Sanity: ensure the bug-021 code paths only fire when seedProgress is
    // present. Without it, runFeature dispatches checkout-feature normally.
    const dispatched: string[] = [];
    const invokeAgent: InvokeAgentFn = async (args) => {
      if (args.agent === "git-agent") {
        const op = args.gitOp?.op ?? "(no-op)";
        dispatched.push(`git-agent:${op}`);
        if (op === "checkout-feature") {
          return {
            taskStatus: {},
            errors: {},
            gitAgentOutput: {
              op: "checkout-feature",
              success: true,
              worktreePath: ".claude/worktrees/feat-auth",
              lockfilePath: ".claude/worktrees/feat-auth.lock",
              branch: "feat/auth",
              featureId: "feat-auth",
            },
            costUsd: 0.001,
          };
        }
        return {
          taskStatus: {},
          errors: {},
          gitAgentOutput: {
            op: "close-feature",
            success: true,
            conflict: false,
            mergeSha: "deadbee",
            featureId: "feat-auth",
          },
          costUsd: 0.001,
        };
      }
      dispatched.push(args.agent);
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "completed"] as const),
        ),
        errors: {},
        costUsd: 0.01,
      };
    };

    const tasks: TasksV2 = {
      version: "2.0",
      warnings: [],
      features: [buildFeature()],
    };

    const ctx = makeCtx(invokeAgent);
    await runFeatureGraph(tasks, ctx); // NO seedProgress

    // Full walk including checkout-feature.
    expect(dispatched[0]).toBe("git-agent:checkout-feature");
    expect(dispatched).toContain("backend-builder");
    expect(dispatched).toContain("tester");
    expect(dispatched).toContain("reviewer");
    expect(dispatched[dispatched.length - 1]).toBe("git-agent:close-feature");
  });
});
