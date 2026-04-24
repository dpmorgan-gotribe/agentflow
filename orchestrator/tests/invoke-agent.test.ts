import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Task } from "@repo/orchestrator-contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BudgetExceededError, BudgetTracker } from "../src/budget-tracker.js";
import {
  commitWorktreeChanges,
  createInvokeAgent,
  type ExecGitFn,
} from "../src/invoke-agent.js";
import type { QueryFn } from "../src/stage-runner.js";

/**
 * Fake SDK `query()` — same shape as the stubs in stage-runner.test.ts.
 * Scripts are indexed by invocation (each call to the returned function
 * increments); each plan is either a terminal result or an error throw.
 */
function makeFakeQuery(
  script: (invocationIndex: number) => {
    subtype:
      | "success"
      | "error_during_execution"
      | "error_max_budget_usd"
      | "error_max_turns";
    result?: string;
    structured_output?: unknown;
    total_cost_usd?: number;
    throwInstead?: Error;
  },
): QueryFn & { calls: Array<{ prompt: string; options: unknown }> } {
  const calls: Array<{ prompt: string; options: unknown }> = [];
  const fn: QueryFn = ({ prompt, options }) => {
    const invIdx = calls.length;
    const promptStr = typeof prompt === "string" ? prompt : "<streaming>";
    calls.push({ prompt: promptStr, options });
    const plan = script(invIdx);

    async function* gen(): AsyncGenerator<unknown, void> {
      if (plan.throwInstead) {
        throw plan.throwInstead;
      }
      yield {
        type: "result",
        subtype: plan.subtype,
        duration_ms: 10,
        duration_api_ms: 8,
        is_error: plan.subtype !== "success",
        num_turns: 1,
        result: plan.result ?? "",
        stop_reason: "end_turn",
        total_cost_usd: plan.total_cost_usd ?? 0.05,
        usage: {},
        modelUsage: {},
        permission_denials: [],
        ...(plan.structured_output !== undefined
          ? { structured_output: plan.structured_output }
          : {}),
        ...(plan.subtype !== "success" ? { errors: ["forced"] } : {}),
        uuid: "00000000-0000-0000-0000-000000000000",
        session_id: "test-session",
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return gen() as any;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fn as any).calls = calls;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return fn as any;
}

/**
 * Scripted `execGit` stub. Pattern-matches the command against `map`;
 * the first matching entry wins. Unmatched commands throw.
 */
function makeExecGit(
  map: Array<{
    match: RegExp;
    stdout?: string;
    stderr?: string;
    code?: number;
    throwInstead?: Error;
  }>,
): ExecGitFn & { calls: string[] } {
  const calls: string[] = [];
  const fn: ExecGitFn = async (cmd) => {
    calls.push(cmd);
    const entry = map.find((e) => e.match.test(cmd));
    if (!entry) {
      throw new Error(`execGit stub: no match for '${cmd}'`);
    }
    if (entry.throwInstead) throw entry.throwInstead;
    return {
      stdout: entry.stdout ?? "",
      stderr: entry.stderr ?? "",
      code: entry.code ?? 0,
    };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fn as any).calls = calls;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return fn as any;
}

let projectRoot: string;
let globalYaml: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "invoke-agent-"));
  globalYaml = join(projectRoot, "global.yaml");
  writeFileSync(
    globalYaml,
    `defaults:\n  build: claude-sonnet-4-6\nagents:\n  backend-builder: { tier: build, effort: medium, budgetUsd: 2 }\n  tester: { tier: build, effort: medium, budgetUsd: 2 }\n  reviewer: { tier: build, effort: medium, budgetUsd: 2 }\n`,
  );
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

function mkBudget(cap = 100): BudgetTracker {
  return new BudgetTracker({ perPipelineMaxUsd: cap, perStageMaxUsd: {} });
}

const featureContext = {
  id: "feat-auth",
  branch: "feat/auth",
  priority: "P1" as const,
};

const task1: Task = {
  id: "t1",
  agent: "backend-builder",
  depends_on: [],
  skills: [],
  status: "pending",
  screens: [],
};
const task2: Task = {
  id: "t2",
  agent: "backend-builder",
  depends_on: [],
  skills: [],
  status: "pending",
  screens: [],
};
const task3: Task = {
  id: "t3",
  agent: "backend-builder",
  depends_on: [],
  skills: [],
  status: "pending",
  screens: [],
};

// ─── git-agent happy paths ────────────────────────────────────────────

describe("invokeAgent — git-agent happy paths", () => {
  it("checkout-feature writes a worktree + lockfile + returns success payload", async () => {
    const budget = mkBudget();
    const execGit = makeExecGit([
      { match: /git worktree add/, stdout: "Preparing worktree\n" },
    ]);
    const invoke = createInvokeAgent({
      projectRoot,
      budget,
      flags: [],
      execGit,
    });
    const result = await invoke({
      agent: "git-agent",
      cwd: projectRoot,
      featureContext,
      tasks: [],
      gitOp: {
        op: "checkout-feature",
        worktree: "feat-auth",
        branch: "feat/auth",
        featureId: "feat-auth",
      },
    });
    expect(result.costUsd).toBe(0);
    expect(result.gitAgentOutput).toMatchObject({
      op: "checkout-feature",
      success: true,
      branch: "feat/auth",
      featureId: "feat-auth",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = result.gitAgentOutput as any;
    expect(existsSync(out.lockfilePath)).toBe(true);
    const lock = JSON.parse(readFileSync(out.lockfilePath, "utf8"));
    expect(lock).toMatchObject({
      featureId: "feat-auth",
      branch: "feat/auth",
    });
    expect(typeof lock.createdAt).toBe("string");
  });

  it("close-feature (clean merge) returns mergeSha on success", async () => {
    const budget = mkBudget();
    const execGit = makeExecGit([
      { match: /git fetch origin main/, stdout: "" },
      { match: /git checkout main/, stdout: "" },
      { match: /git merge --no-ff/, stdout: "Fast-forward\n" },
      {
        match: /git rev-parse HEAD/,
        stdout: "abc1234def5678901234567890abcdef12345678\n",
      },
    ]);
    const invoke = createInvokeAgent({
      projectRoot,
      budget,
      flags: [],
      execGit,
    });
    const result = await invoke({
      agent: "git-agent",
      cwd: projectRoot,
      featureContext,
      tasks: [],
      gitOp: {
        op: "close-feature",
        worktree: "feat-auth",
        featureId: "feat-auth",
      },
    });
    expect(result.gitAgentOutput).toMatchObject({
      op: "close-feature",
      success: true,
      conflict: false,
      featureId: "feat-auth",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result.gitAgentOutput as any).mergeSha).toMatch(/^[0-9a-f]{7,40}$/);
  });

  it("close-feature (merge conflict) parses conflicting files + aborts merge", async () => {
    const budget = mkBudget();
    const execGit = makeExecGit([
      { match: /git fetch origin main/, stdout: "" },
      { match: /git checkout main/, stdout: "" },
      {
        match: /git merge --no-ff/,
        throwInstead: new Error(
          "CONFLICT (content): Merge conflict in src/x.ts",
        ),
      },
      {
        match: /git diff --name-only --diff-filter=U/,
        stdout: "src/x.ts\nsrc/y.ts\n",
      },
      { match: /git merge --abort/, stdout: "" },
    ]);
    const invoke = createInvokeAgent({
      projectRoot,
      budget,
      flags: [],
      execGit,
    });
    const result = await invoke({
      agent: "git-agent",
      cwd: projectRoot,
      featureContext,
      tasks: [],
      gitOp: {
        op: "close-feature",
        worktree: "feat-auth",
        featureId: "feat-auth",
      },
    });
    expect(result.gitAgentOutput).toMatchObject({
      op: "close-feature",
      success: false,
      conflict: true,
      conflictingFiles: ["src/x.ts", "src/y.ts"],
    });
  });

  it("emergency-abort cleans up worktree + lockfile + branch", async () => {
    const budget = mkBudget();
    // Pre-create a lockfile so we can assert it's deleted.
    const lockPath = join(
      projectRoot,
      ".claude",
      "worktrees",
      "feat-auth.lock.json",
    );
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(projectRoot, ".claude", "worktrees"), { recursive: true });
    writeFileSync(lockPath, "{}");
    const execGit = makeExecGit([
      { match: /git worktree remove --force/, stdout: "" },
      { match: /git branch -D/, stdout: "" },
    ]);
    const invoke = createInvokeAgent({
      projectRoot,
      budget,
      flags: [],
      execGit,
    });
    const result = await invoke({
      agent: "git-agent",
      cwd: projectRoot,
      featureContext,
      tasks: [],
      gitOp: {
        op: "emergency-abort",
        worktree: "feat-auth",
        featureId: "feat-auth",
        reason: "test abort",
      },
    });
    expect(result.gitAgentOutput).toMatchObject({
      op: "emergency-abort",
      success: true,
      featureId: "feat-auth",
      cleanup: "worktree-removed",
    });
    expect(existsSync(lockPath)).toBe(false);
  });

  it("resolve-conflict-handoff echoes payload fields", async () => {
    const budget = mkBudget();
    const execGit = makeExecGit([]); // should never be called
    const invoke = createInvokeAgent({
      projectRoot,
      budget,
      flags: [],
      execGit,
    });
    const result = await invoke({
      agent: "git-agent",
      cwd: projectRoot,
      featureContext,
      tasks: [],
      gitOp: {
        op: "resolve-conflict-handoff",
        worktree: "feat-auth",
        conflictingFiles: ["src/x.ts"],
        lastWritingAgent: "backend-builder",
        attempt: 2,
        mergeBaseSha: "abcdef1",
        mainHeadSha: "1234567",
        featureHeadSha: "2345678",
      },
    });
    expect(result.gitAgentOutput).toMatchObject({
      op: "resolve-conflict-handoff",
      worktreePath: "feat-auth",
      conflictingFiles: ["src/x.ts"],
      lastWritingAgent: "backend-builder",
      attempt: 2,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((execGit as any).calls.length).toBe(0);
  });
});

// ─── git-agent failure paths ──────────────────────────────────────────

describe("invokeAgent — git-agent failure paths", () => {
  it("checkout-feature: stale-worktree when target path already exists", async () => {
    const budget = mkBudget();
    // Pre-create the worktree dir
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(projectRoot, ".claude", "worktrees", "feat-auth"), {
      recursive: true,
    });
    const execGit = makeExecGit([]); // must not be called
    const invoke = createInvokeAgent({
      projectRoot,
      budget,
      flags: [],
      execGit,
    });
    const result = await invoke({
      agent: "git-agent",
      cwd: projectRoot,
      featureContext,
      tasks: [],
      gitOp: {
        op: "checkout-feature",
        worktree: "feat-auth",
        branch: "feat/auth",
        featureId: "feat-auth",
      },
    });
    expect(result.gitAgentOutput).toMatchObject({
      op: "checkout-feature",
      success: false,
      reason: "stale-worktree",
    });
  });

  it("checkout-feature: branch-conflict when git reports existing branch", async () => {
    const budget = mkBudget();
    const execGit = makeExecGit([
      {
        match: /git worktree add/,
        throwInstead: new Error(
          "fatal: A branch named 'feat/auth' already exists",
        ),
      },
    ]);
    const invoke = createInvokeAgent({
      projectRoot,
      budget,
      flags: [],
      execGit,
    });
    const result = await invoke({
      agent: "git-agent",
      cwd: projectRoot,
      featureContext,
      tasks: [],
      gitOp: {
        op: "checkout-feature",
        worktree: "feat-auth",
        branch: "feat/auth",
        featureId: "feat-auth",
      },
    });
    expect(result.gitAgentOutput).toMatchObject({
      op: "checkout-feature",
      success: false,
      reason: "branch-conflict",
    });
  });
});

// ─── LLM-agent paths ──────────────────────────────────────────────────

describe("invokeAgent — builder happy path", () => {
  it("parses structured_output and returns per-task status + cost + lastWritingAgent", async () => {
    const budget = mkBudget();
    const queryFn = makeFakeQuery(() => ({
      subtype: "success",
      structured_output: {
        taskOutcomes: { t1: "completed" },
      },
      total_cost_usd: 0.12,
    }));
    const invoke = createInvokeAgent({
      projectRoot,
      budget,
      flags: ["nanobanana"],
      queryFn,
      modelConfigOverride: {
        globalPath: globalYaml,
        projectPath: join(projectRoot, "no-project.yaml"),
      },
    });
    const result = await invoke({
      agent: "backend-builder",
      cwd: join(projectRoot, ".claude", "worktrees", "feat-auth"),
      featureContext,
      tasks: [task1],
    });
    expect(result.taskStatus).toEqual({ t1: "completed" });
    expect(result.errors).toEqual({});
    expect(result.costUsd).toBeCloseTo(0.12, 4);
    expect(result.lastWritingAgent).toBe("backend-builder");
    expect(budget.getCumulative()).toBeCloseTo(0.12, 4);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = (queryFn as any).calls[0];
    expect(call.options.env.CLAUDE_FEATURE_ID).toBe("feat-auth");
    expect(call.options.env.CLAUDE_FEATURE_BRANCH).toBe("feat/auth");
    expect(call.options.env.CLAUDE_PIPELINE_FLAGS).toBe("nanobanana");
    expect(call.options.cwd).toBe(
      join(projectRoot, ".claude", "worktrees", "feat-auth"),
    );
    expect(call.prompt).toContain("backend-builder");
    expect(call.prompt).toContain("feat-auth");
    expect(call.prompt).toContain("t1");
  });
});

describe("invokeAgent — builder missing-task handling", () => {
  it("marks unreported tasks as failed with 'agent did not report outcome'", async () => {
    const budget = mkBudget();
    const queryFn = makeFakeQuery(() => ({
      subtype: "success",
      structured_output: {
        taskOutcomes: { t1: "completed", t2: "completed" },
      },
      total_cost_usd: 0.03,
    }));
    const invoke = createInvokeAgent({
      projectRoot,
      budget,
      flags: [],
      queryFn,
      modelConfigOverride: {
        globalPath: globalYaml,
        projectPath: join(projectRoot, "no-project.yaml"),
      },
    });
    const result = await invoke({
      agent: "backend-builder",
      cwd: projectRoot,
      featureContext,
      tasks: [task1, task2, task3],
    });
    expect(result.taskStatus).toEqual({
      t1: "completed",
      t2: "completed",
      t3: "failed",
    });
    expect(result.errors.t3).toBe("agent did not report outcome");
    expect(result.errors.t1).toBeUndefined();
    expect(result.errors.t2).toBeUndefined();
  });
});

describe("invokeAgent — builder SDK error", () => {
  it("propagates SDK subtype as the per-task error message", async () => {
    const budget = mkBudget();
    const queryFn = makeFakeQuery(() => ({
      subtype: "error_max_budget_usd",
      total_cost_usd: 1.0,
    }));
    const invoke = createInvokeAgent({
      projectRoot,
      budget,
      flags: [],
      queryFn,
      modelConfigOverride: {
        globalPath: globalYaml,
        projectPath: join(projectRoot, "no-project.yaml"),
      },
    });
    const result = await invoke({
      agent: "backend-builder",
      cwd: projectRoot,
      featureContext,
      tasks: [task1, task2],
    });
    expect(result.taskStatus).toEqual({ t1: "failed", t2: "failed" });
    expect(result.errors.t1).toBe("error_max_budget_usd");
    expect(result.errors.t2).toBe("error_max_budget_usd");
    // SDK still reports the cost — tracker records it.
    expect(result.costUsd).toBeCloseTo(1.0, 4);
    expect(budget.getCumulative()).toBeCloseTo(1.0, 4);
  });
});

describe("invokeAgent — budget exceeded pre-call", () => {
  it("throws BudgetExceededError before invoking queryFn when tracker is at cap", async () => {
    const budget = mkBudget(1); // cap at $1
    budget.record(0.99); // leave $0.01; modelConfig budget = $2
    let invoked = 0;
    const queryFn = makeFakeQuery(() => {
      invoked += 1;
      return { subtype: "success", structured_output: { taskOutcomes: {} } };
    });
    const invoke = createInvokeAgent({
      projectRoot,
      budget,
      flags: [],
      queryFn,
      modelConfigOverride: {
        globalPath: globalYaml,
        projectPath: join(projectRoot, "no-project.yaml"),
      },
    });
    await expect(
      invoke({
        agent: "backend-builder",
        cwd: projectRoot,
        featureContext,
        tasks: [task1],
      }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(invoked).toBe(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((queryFn as any).calls.length).toBe(0);
  });
});

describe("invokeAgent — auth provider wiring (feat-017)", () => {
  it("defaults to forceLoginMethod: 'claudeai' and strips ANTHROPIC_API_KEY", async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-stale";
    try {
      const budget = mkBudget();
      const queryFn = makeFakeQuery(() => ({
        subtype: "success",
        structured_output: { taskOutcomes: { t1: "completed" } },
        total_cost_usd: 0.01,
      }));
      const invoke = createInvokeAgent({
        projectRoot,
        budget,
        flags: [],
        queryFn,
        modelConfigOverride: {
          globalPath: globalYaml,
          projectPath: join(projectRoot, "no-project.yaml"),
        },
      });
      await invoke({
        agent: "backend-builder",
        cwd: projectRoot,
        featureContext,
        tasks: [task1],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const opts = (queryFn as any).calls[0].options;
      expect(opts.forceLoginMethod).toBe("claudeai");
      expect(opts.env.ANTHROPIC_API_KEY).toBeUndefined();
    } finally {
      if (originalKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = originalKey;
      }
    }
  });

  it("injects CLAUDE_CODE_USE_BEDROCK=1 when provider=bedrock", async () => {
    writeFileSync(
      globalYaml,
      `provider: bedrock\nawsRegion: us-east-2\ndefaults:\n  build: claude-sonnet-4-6\nagents:\n  backend-builder: { tier: build, effort: medium, budgetUsd: 2 }\n`,
    );
    const budget = mkBudget();
    const queryFn = makeFakeQuery(() => ({
      subtype: "success",
      structured_output: { taskOutcomes: { t1: "completed" } },
      total_cost_usd: 0.01,
    }));
    const invoke = createInvokeAgent({
      projectRoot,
      budget,
      flags: [],
      queryFn,
      modelConfigOverride: {
        globalPath: globalYaml,
        projectPath: join(projectRoot, "no-project.yaml"),
      },
    });
    await invoke({
      agent: "backend-builder",
      cwd: projectRoot,
      featureContext,
      tasks: [task1],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts = (queryFn as any).calls[0].options;
    expect(opts.env.CLAUDE_CODE_USE_BEDROCK).toBe("1");
    expect(opts.env.AWS_REGION).toBe("us-east-2");
    expect(opts.forceLoginMethod).toBeUndefined();
  });

  it("sets forceLoginMethod: 'console' when provider=anthropic-api + key present", async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-real";
    try {
      writeFileSync(
        globalYaml,
        `provider: anthropic-api\ndefaults:\n  build: claude-sonnet-4-6\nagents:\n  backend-builder: { tier: build, effort: medium, budgetUsd: 2 }\n`,
      );
      const budget = mkBudget();
      const queryFn = makeFakeQuery(() => ({
        subtype: "success",
        structured_output: { taskOutcomes: { t1: "completed" } },
        total_cost_usd: 0.01,
      }));
      const invoke = createInvokeAgent({
        projectRoot,
        budget,
        flags: [],
        queryFn,
        modelConfigOverride: {
          globalPath: globalYaml,
          projectPath: join(projectRoot, "no-project.yaml"),
        },
      });
      await invoke({
        agent: "backend-builder",
        cwd: projectRoot,
        featureContext,
        tasks: [task1],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const opts = (queryFn as any).calls[0].options;
      expect(opts.forceLoginMethod).toBe("console");
      expect(opts.env.ANTHROPIC_API_KEY).toBe("sk-ant-real");
    } finally {
      if (originalKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = originalKey;
      }
    }
  });
});

describe("invokeAgent — cost tracking across multiple invocations", () => {
  it("accumulates cost from two sequential invocations", async () => {
    const budget = mkBudget();
    let idx = 0;
    const costs = [0.03, 0.05];
    const queryFn = makeFakeQuery(() => ({
      subtype: "success",
      structured_output: { taskOutcomes: { t1: "completed" } },
      total_cost_usd: costs[idx++] ?? 0,
    }));
    const invoke = createInvokeAgent({
      projectRoot,
      budget,
      flags: [],
      queryFn,
      modelConfigOverride: {
        globalPath: globalYaml,
        projectPath: join(projectRoot, "no-project.yaml"),
      },
    });
    await invoke({
      agent: "backend-builder",
      cwd: projectRoot,
      featureContext,
      tasks: [task1],
    });
    await invoke({
      agent: "backend-builder",
      cwd: projectRoot,
      featureContext,
      tasks: [task1],
    });
    expect(budget.getCumulative()).toBeCloseTo(0.08, 4);
  });
});

// ─── feat-018 Phase A: commitWorktreeChanges ──────────────────────────

describe("commitWorktreeChanges (feat-018 Phase A)", () => {
  it("clean tree → { committed: false }, no warning, no add/commit calls", async () => {
    const execGit = makeExecGit([
      { match: /git status --porcelain/, stdout: "" },
    ]);
    const result = await commitWorktreeChanges(
      "/tmp/worktree",
      "backend-builder: t1",
      execGit,
    );
    expect(result).toEqual({ committed: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls = (execGit as any).calls as string[];
    expect(calls).toEqual(["git status --porcelain"]);
  });

  it("dirty tree happy path → { committed: true, sha }", async () => {
    const execGit = makeExecGit([
      {
        match: /git status --porcelain/,
        stdout: " M src/foo.ts\n?? src/bar.ts\n",
      },
      { match: /git add -A/, stdout: "" },
      { match: /git commit -m/, stdout: "[feat/auth abc1234] msg\n" },
      { match: /git rev-parse HEAD/, stdout: "abc1234def5678\n" },
    ]);
    const result = await commitWorktreeChanges(
      "/tmp/worktree",
      "backend-builder: t1, t2",
      execGit,
    );
    expect(result.committed).toBe(true);
    expect(result.sha).toBe("abc1234def5678");
    expect(result.warning).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls = (execGit as any).calls as string[];
    expect(calls[0]).toBe("git status --porcelain");
    expect(calls[1]).toBe("git add -A");
    expect(calls[2]).toMatch(/^git commit -m '.*backend-builder: t1, t2/);
    expect(calls[3]).toBe("git rev-parse HEAD");
  });

  it("git add fails → { committed: false, warning: 'git add failed: ...' }", async () => {
    const execGit = makeExecGit([
      { match: /git status --porcelain/, stdout: " M src/x.ts\n" },
      {
        match: /git add -A/,
        throwInstead: Object.assign(new Error("permission denied"), {
          stderr: "fatal: permission denied",
          code: 128,
        }),
      },
    ]);
    const result = await commitWorktreeChanges(
      "/tmp/worktree",
      "tester: t1",
      execGit,
    );
    expect(result.committed).toBe(false);
    expect(result.warning).toContain("git add failed");
    expect(result.warning).toContain("permission denied");
    expect(result.sha).toBeUndefined();
  });

  it("git commit fails → { committed: false, warning: 'git commit failed: ...' }", async () => {
    const execGit = makeExecGit([
      { match: /git status --porcelain/, stdout: " M src/x.ts\n" },
      { match: /git add -A/, stdout: "" },
      {
        match: /git commit -m/,
        throwInstead: Object.assign(new Error("commit hook rejected"), {
          stderr: "pre-commit hook failed",
          code: 1,
        }),
      },
    ]);
    const result = await commitWorktreeChanges(
      "/tmp/worktree",
      "reviewer: t1",
      execGit,
    );
    expect(result.committed).toBe(false);
    expect(result.warning).toContain("git commit failed");
    expect(result.warning).toContain("pre-commit hook failed");
  });

  it("message with single quotes → quotes replaced with backticks; commit succeeds", async () => {
    let commitCmd = "";
    const execGit: ExecGitFn = async (cmd) => {
      if (/git status --porcelain/.test(cmd)) {
        return { stdout: " M src/x.ts\n", stderr: "", code: 0 };
      }
      if (/git add -A/.test(cmd)) {
        return { stdout: "", stderr: "", code: 0 };
      }
      if (/git commit -m/.test(cmd)) {
        commitCmd = cmd;
        return { stdout: "", stderr: "", code: 0 };
      }
      if (/git rev-parse HEAD/.test(cmd)) {
        return { stdout: "abcdef0\n", stderr: "", code: 0 };
      }
      throw new Error(`unexpected: ${cmd}`);
    };
    const result = await commitWorktreeChanges(
      "/tmp/worktree",
      "agent: don't break the shell",
      execGit,
    );
    expect(result.committed).toBe(true);
    expect(result.sha).toBe("abcdef0");
    // The single quote in "don't" must have been swapped for a backtick
    // so the outer single-quoted -m argument doesn't break.
    expect(commitCmd).not.toContain("don't");
    expect(commitCmd).toContain("don`t");
  });

  it("git status fails → { committed: false, warning: 'git status failed: ...' }", async () => {
    const execGit = makeExecGit([
      {
        match: /git status --porcelain/,
        throwInstead: Object.assign(new Error("not a git repo"), {
          stderr: "fatal: not a git repository",
          code: 128,
        }),
      },
    ]);
    const result = await commitWorktreeChanges(
      "/tmp/not-a-repo",
      "agent: t1",
      execGit,
    );
    expect(result.committed).toBe(false);
    expect(result.warning).toContain("git status failed");
  });
});

// ─── feat-018 Phase B: close-feature defensive checks ─────────────────

describe("invokeAgent — close-feature feature-no-commits guard", () => {
  it("branch === main + dirty tree → returns feature-no-commits failure", async () => {
    const budget = mkBudget();
    const execGit = makeExecGit([
      { match: /git fetch origin main/, stdout: "" },
      { match: /git rev-parse main/, stdout: "abc1234\n" },
      { match: /git rev-parse feat\/auth/, stdout: "abc1234\n" },
      {
        match: /git status --porcelain/,
        stdout: " M src/foo.ts\n?? src/bar.ts\n",
      },
    ]);
    const invoke = createInvokeAgent({
      projectRoot,
      budget,
      flags: [],
      execGit,
    });
    const result = await invoke({
      agent: "git-agent",
      cwd: projectRoot,
      featureContext,
      tasks: [],
      gitOp: {
        op: "close-feature",
        worktree: "feat-auth",
        featureId: "feat-auth",
      },
    });
    expect(result.gitAgentOutput).toMatchObject({
      op: "close-feature",
      success: false,
      conflict: false,
      reason: "feature-no-commits",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = result.gitAgentOutput as any;
    expect(out.dirtyFiles).toEqual(["M src/foo.ts", "?? src/bar.ts"]);
  });

  it("branch === main + clean tree → success (no-op merge OK)", async () => {
    const budget = mkBudget();
    const execGit = makeExecGit([
      { match: /git fetch origin main/, stdout: "" },
      { match: /git rev-parse main/, stdout: "abc1234\n" },
      { match: /git rev-parse feat\/auth/, stdout: "abc1234\n" },
      { match: /git status --porcelain/, stdout: "" },
      { match: /git checkout main/, stdout: "" },
      { match: /git merge --no-ff/, stdout: "Already up to date.\n" },
      {
        match: /git rev-parse HEAD/,
        stdout: "abc1234def5678901234567890abcdef12345678\n",
      },
    ]);
    const invoke = createInvokeAgent({
      projectRoot,
      budget,
      flags: [],
      execGit,
    });
    const result = await invoke({
      agent: "git-agent",
      cwd: projectRoot,
      featureContext,
      tasks: [],
      gitOp: {
        op: "close-feature",
        worktree: "feat-auth",
        featureId: "feat-auth",
      },
    });
    expect(result.gitAgentOutput).toMatchObject({
      op: "close-feature",
      success: true,
      conflict: false,
    });
  });

  it("branch !== main → existing code path unchanged", async () => {
    const budget = mkBudget();
    const execGit = makeExecGit([
      { match: /git fetch origin main/, stdout: "" },
      { match: /git rev-parse main/, stdout: "abc1234\n" },
      { match: /git rev-parse feat\/auth/, stdout: "def5678\n" },
      { match: /git checkout main/, stdout: "" },
      { match: /git merge --no-ff/, stdout: "Fast-forward\n" },
      {
        match: /git rev-parse HEAD/,
        stdout: "def5678901234567890abcdef1234567890abcd\n",
      },
    ]);
    const invoke = createInvokeAgent({
      projectRoot,
      budget,
      flags: [],
      execGit,
    });
    const result = await invoke({
      agent: "git-agent",
      cwd: projectRoot,
      featureContext,
      tasks: [],
      gitOp: {
        op: "close-feature",
        worktree: "feat-auth",
        featureId: "feat-auth",
      },
    });
    expect(result.gitAgentOutput).toMatchObject({
      op: "close-feature",
      success: true,
      conflict: false,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls = (execGit as any).calls as string[];
    // Status was NOT called (branch differs from main) — defensive
    // guard short-circuits to the existing merge path.
    expect(calls.some((c) => /git status --porcelain/.test(c))).toBe(false);
  });
});
