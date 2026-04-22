import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Feature,
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

function makeCtx(invokeAgent: InvokeAgentFn) {
  return {
    projectRoot,
    pipelineRunId: "pipe-test-001",
    budget: new BudgetTracker({ perPipelineMaxUsd: 1000, perStageMaxUsd: {} }),
    retryCounters: new RetryCounters(),
    invokeAgent,
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
    agent_sequence: ["backend-builder", "tester", "reviewer"],
    tasks: [
      {
        id: "auth-api",
        agent: "backend-builder",
        depends_on: [],
        skills: [],
        status: "pending",
      },
      {
        id: "auth-tests",
        agent: "tester",
        depends_on: [],
        skills: [],
        status: "pending",
      },
      {
        id: "auth-review",
        agent: "reviewer",
        depends_on: [],
        skills: [],
        status: "pending",
      },
    ],
    ...overrides,
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
        },
        {
          id: "mobile-ui",
          agent: "mobile-frontend-builder",
          depends_on: [],
          skills: [],
          status: "pending",
        },
        {
          id: "tests",
          agent: "tester",
          depends_on: [],
          skills: [],
          status: "pending",
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
  it("retries failed tasks up to 3 times then fails the feature", async () => {
    const feature = buildFeature({
      agent_sequence: ["backend-builder"],
      tasks: [
        {
          id: "flaky-api",
          agent: "backend-builder",
          depends_on: [],
          skills: [],
          status: "pending",
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
    // initial + 3 retries = 4 calls; retry-counter caps at 3 increments
    expect(ctx.retryCounters.get("task-retry", "feat-auth/flaky-api")).toBe(3);
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
