import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type BugEntry,
  type BugsYaml,
  type BuildToSpecVerifyOutput,
} from "@repo/orchestrator-contracts";
import { BudgetTracker } from "../src/budget-tracker.js";
import {
  runFixBugsLoop,
  type FixBugsLoopContext,
} from "../src/fix-bugs-loop.js";
import type { InvokeAgentFn } from "../src/feature-graph.js";

let projectRoot: string;
let bugsYamlPath: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "fix-bugs-loop-"));
  mkdirSync(join(projectRoot, "docs"), { recursive: true });
  bugsYamlPath = join(projectRoot, "docs", "bugs.yaml");
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

function makeBug(overrides: Partial<BugEntry> = {}): BugEntry {
  return {
    id: "bug-orphan-foo",
    iteration: 1,
    source: "reachability-orphan",
    severity: "P0",
    summary: "foo orphan",
    orphan: {
      componentPath: "apps/web/src/components/Foo.tsx",
      exportNames: ["Foo"],
      suggestedImporters: ["apps/web/src/App.tsx"],
    },
    correlatedOrphanPath: null,
    owningFeature: null,
    affectsFiles: [],
    agentSequence: ["web-frontend-builder", "tester", "reviewer"],
    status: "pending",
    attempts: 0,
    maxAttempts: 3,
    flapResets: 0,
    resolvedInIteration: null,
    bugPlanPath: null,
    errorLog: [],
    ...overrides,
  };
}

function writeBugsYamlDoc(bugs: BugEntry[], iteration = 1): void {
  const doc: BugsYaml = {
    version: "1.0",
    generated_at: new Date().toISOString(),
    project_name: "test-project",
    source_run_id: "run-test-001",
    iteration,
    iteration_cap: 5,
    bugs,
  };
  writeFileSync(bugsYamlPath, yaml.dump(doc));
}

function readBugsYamlDoc(): BugsYaml {
  return yaml.load(readFileSync(bugsYamlPath, "utf8")) as BugsYaml;
}

function makeCtx(
  invokeAgent: InvokeAgentFn,
  runBuildToSpecVerify: FixBugsLoopContext["runBuildToSpecVerify"],
  overrides: Partial<FixBugsLoopContext> = {},
): FixBugsLoopContext {
  return {
    projectRoot,
    pipelineRunId: "run-test-001",
    factoryRoot: process.cwd(),
    budget: new BudgetTracker({ perPipelineMaxUsd: 1000, perStageMaxUsd: {} }),
    invokeAgent,
    runBuildToSpecVerify,
    iterationCap: 5,
    skipWorktreeManagement: true,
    ...overrides,
  };
}

const cleanVerify = async (): Promise<BuildToSpecVerifyOutput> => ({
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
  durationMs: 1,
  warnings: [],
});

describe("runFixBugsLoop — empty / missing bugs.yaml", () => {
  it("returns no-bugs when bugs.yaml does not exist", async () => {
    const result = await runFixBugsLoop(
      makeCtx(
        async () => ({ taskStatus: {}, errors: {}, costUsd: 0 }),
        cleanVerify,
      ),
    );
    expect(result.status).toBe("no-bugs");
    expect(result.iterationsRun).toBe(0);
    expect(result.bugsResolved).toEqual([]);
  });

  it("returns no-bugs when bugs.yaml has empty bugs array", async () => {
    writeBugsYamlDoc([]);
    const result = await runFixBugsLoop(
      makeCtx(
        async () => ({ taskStatus: {}, errors: {}, costUsd: 0 }),
        cleanVerify,
      ),
    );
    expect(result.status).toBe("no-bugs");
  });
});

describe("runFixBugsLoop — happy path: clean exit on first iteration", () => {
  it("dispatches each agent for every pending bug then exits clean", async () => {
    const calls: string[] = [];
    const invoke: InvokeAgentFn = async (args) => {
      calls.push(args.agent);
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "completed"] as const),
        ),
        errors: {},
        costUsd: 0.1,
      };
    };
    writeBugsYamlDoc([
      makeBug({ id: "bug-orphan-a" }),
      makeBug({ id: "bug-orphan-b" }),
    ]);

    const result = await runFixBugsLoop(makeCtx(invoke, cleanVerify));
    expect(result.status).toBe("clean");
    expect(result.iterationsRun).toBe(1);
    expect(result.bugsResolved.sort()).toEqual([
      "bug-orphan-a",
      "bug-orphan-b",
    ]);
    expect(result.bugsFailed).toEqual([]);
    // Each bug → 3 agents (web-frontend-builder, tester, reviewer)
    expect(calls.filter((c) => c === "web-frontend-builder")).toHaveLength(2);
    expect(calls.filter((c) => c === "tester")).toHaveLength(2);
    expect(calls.filter((c) => c === "reviewer")).toHaveLength(2);
    // Cost recorded: 6 agent invocations × $0.10 = $0.60
    expect(result.totalCostUsd).toBeCloseTo(0.6, 5);
  });
});

describe("runFixBugsLoop — per-bug attempt cap", () => {
  it("marks a bug failed after maxAttempts dispatch failures", async () => {
    let calls = 0;
    const invoke: InvokeAgentFn = async (args) => {
      calls += 1;
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "failed"] as const),
        ),
        errors: Object.fromEntries(
          args.tasks.map((t) => [t.id, "synthetic failure"] as const),
        ),
        costUsd: 0.05,
      };
    };
    writeBugsYamlDoc([makeBug({ id: "bug-orphan-stuck", maxAttempts: 3 })]);
    const result = await runFixBugsLoop(makeCtx(invoke, cleanVerify));
    expect(result.status).toBe("all-bugs-failed");
    expect(result.bugsFailed).toEqual(["bug-orphan-stuck"]);
    expect(result.bugsResolved).toEqual([]);
    // First-agent abort short-circuits the sequence — exactly one call per attempt.
    expect(calls).toBe(3);
    const doc = readBugsYamlDoc();
    expect(doc.bugs[0]!.attempts).toBe(3);
    expect(doc.bugs[0]!.status).toBe("failed");
    expect(doc.bugs[0]!.errorLog.length).toBeGreaterThanOrEqual(3);
  });

  it("succeeds when a bug passes within its attempt cap", async () => {
    let attempt = 0;
    const invoke: InvokeAgentFn = async (args) => {
      // Fail on first agent of attempts 1-2; succeed on attempt 3.
      attempt += 1;
      const completed = attempt > 2;
      const status: "completed" | "failed" = completed ? "completed" : "failed";
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, status] as const),
        ),
        errors: completed
          ? {}
          : Object.fromEntries(
              args.tasks.map((t) => [t.id, "first-agent flap"] as const),
            ),
        costUsd: 0.05,
      };
    };
    // Once attempt 3 succeeds with web-frontend-builder, tester + reviewer
    // also need to succeed; bump them to "completed" via the attempt counter.
    let postSuccess = 0;
    const invokeWrapped: InvokeAgentFn = async (args) => {
      const r = await invoke(args);
      if (r.taskStatus[args.tasks[0]!.id] === "completed") postSuccess += 1;
      // After first success, force subsequent agents to succeed too.
      if (postSuccess > 1) {
        return {
          taskStatus: Object.fromEntries(
            args.tasks.map((t) => [t.id, "completed"] as const),
          ),
          errors: {},
          costUsd: 0.05,
        };
      }
      return r;
    };
    writeBugsYamlDoc([makeBug({ id: "bug-orphan-flaky", maxAttempts: 5 })]);
    const result = await runFixBugsLoop(makeCtx(invokeWrapped, cleanVerify));
    expect(result.status).toBe("clean");
    expect(result.bugsResolved).toEqual(["bug-orphan-flaky"]);
  });
});

describe("runFixBugsLoop — iteration cap", () => {
  it("hits iteration-cap when verify keeps reporting failures with new bugs", async () => {
    // Each invocation succeeds, but verify keeps appending NEW bugs to
    // bugs.yaml so the loop never reaches a clean exit. Cap at 3 here for
    // a fast test.
    let verifyCallCount = 0;
    const verify: FixBugsLoopContext["runBuildToSpecVerify"] = async () => {
      verifyCallCount += 1;
      // Append a new fake bug each time verify runs — emulates the real
      // verifier writing via scripts/file-bug-plan.mjs::appendBugToYaml.
      const doc = readBugsYamlDoc();
      doc.bugs.push(
        makeBug({
          id: `bug-orphan-new-${verifyCallCount}`,
          iteration: doc.iteration + 1,
        }),
      );
      writeFileSync(bugsYamlPath, yaml.dump(doc));
      return {
        ok: false,
        reachability: {
          orphanComponents: [],
          orphanRoutes: [],
          scannedFiles: 0,
          ignoredByAllowComment: [],
        },
        flows: { passed: [], failed: [], generated: [] },
        bugPlansFiled: [`bug-001-orphan-new-${verifyCallCount}`],
        costUsd: 0,
        durationMs: 1,
        warnings: [],
      };
    };
    const invoke: InvokeAgentFn = async (args) => ({
      taskStatus: Object.fromEntries(
        args.tasks.map((t) => [t.id, "completed"] as const),
      ),
      errors: {},
      costUsd: 0.01,
    });

    writeBugsYamlDoc([makeBug({ id: "bug-orphan-original" })]);
    const result = await runFixBugsLoop(
      makeCtx(invoke, verify, { iterationCap: 3 }),
    );
    expect(result.status).toBe("iteration-cap-hit");
    expect(result.iterationsRun).toBe(3);
    // Original + bugs added by verify across 3 iterations
    expect(result.bugsResolved.length).toBeGreaterThanOrEqual(1);
    expect(result.bugsRemaining.length).toBeGreaterThan(0);
  });
});

describe("runFixBugsLoop — flapping detection", () => {
  it("escalates a bug to failed after 3 flap-resets", async () => {
    // Bug starts pending; agent dispatch completes it; verify reports the
    // SAME bug id as failed (matches a pending entry in bugs.yaml ⇒
    // flapping). After maxFlapResets the bug is marked failed.
    writeBugsYamlDoc([makeBug({ id: "bug-orphan-flapper" })]);

    const invoke: InvokeAgentFn = async (args) => ({
      taskStatus: Object.fromEntries(
        args.tasks.map((t) => [t.id, "completed"] as const),
      ),
      errors: {},
      costUsd: 0.01,
    });

    let verifyCallCount = 0;
    const verify: FixBugsLoopContext["runBuildToSpecVerify"] = async () => {
      verifyCallCount += 1;
      // After we've marked the bug completed, simulate verify finding the
      // SAME bug id again with status pending. This mimics the real
      // verifier re-emitting a violation that already exists by id.
      const doc = readBugsYamlDoc();
      const entry = doc.bugs.find((b) => b.id === "bug-orphan-flapper");
      if (entry && entry.status === "completed") {
        entry.status = "pending";
      }
      writeFileSync(bugsYamlPath, yaml.dump(doc));
      return {
        ok: false,
        reachability: {
          orphanComponents: [],
          orphanRoutes: [],
          scannedFiles: 0,
          ignoredByAllowComment: [],
        },
        flows: { passed: [], failed: [], generated: [] },
        bugPlansFiled: ["bug-orphan-flapper"],
        costUsd: 0,
        durationMs: 1,
        warnings: [],
      };
    };

    const result = await runFixBugsLoop(
      makeCtx(invoke, verify, {
        iterationCap: 10,
        maxFlapResets: 3,
      }),
    );
    // After 3 flap-resets the bug gets marked failed, leaving the loop
    // with no pending bugs → all-bugs-failed (since none are completed).
    expect(result.bugsFailed).toContain("bug-orphan-flapper");
    expect(verifyCallCount).toBeGreaterThanOrEqual(3);
    const doc = readBugsYamlDoc();
    const flapped = doc.bugs.find((b) => b.id === "bug-orphan-flapper");
    expect(flapped?.flapResets).toBeGreaterThanOrEqual(3);
    expect(flapped?.status).toBe("failed");
  });
});

describe("runFixBugsLoop — new bugs across iterations", () => {
  it("detects a new bug appended during iteration N + works it iteration N+1", async () => {
    writeBugsYamlDoc([makeBug({ id: "bug-orphan-original" })]);
    let verifyCallCount = 0;
    const verify: FixBugsLoopContext["runBuildToSpecVerify"] = async () => {
      verifyCallCount += 1;
      if (verifyCallCount === 1) {
        // First verify after iteration 1: append a new bug.
        const doc = readBugsYamlDoc();
        doc.bugs.push(
          makeBug({
            id: "bug-orphan-newcomer",
            iteration: doc.iteration + 1,
          }),
        );
        writeFileSync(bugsYamlPath, yaml.dump(doc));
        return {
          ok: false,
          reachability: {
            orphanComponents: [],
            orphanRoutes: [],
            scannedFiles: 0,
            ignoredByAllowComment: [],
          },
          flows: { passed: [], failed: [], generated: [] },
          bugPlansFiled: ["bug-orphan-newcomer"],
          costUsd: 0,
          durationMs: 1,
          warnings: [],
        };
      }
      // Second verify (after iteration 2): clean.
      return cleanVerify();
    };
    const invoke: InvokeAgentFn = async (args) => ({
      taskStatus: Object.fromEntries(
        args.tasks.map((t) => [t.id, "completed"] as const),
      ),
      errors: {},
      costUsd: 0.05,
    });

    const result = await runFixBugsLoop(makeCtx(invoke, verify));
    expect(result.status).toBe("clean");
    expect(result.iterationsRun).toBe(2);
    expect(result.bugsResolved.sort()).toEqual([
      "bug-orphan-newcomer",
      "bug-orphan-original",
    ]);
    expect(result.iterationLog[0]!.newBugIds).toEqual(["bug-orphan-newcomer"]);
  });
});

describe("runFixBugsLoop — bug priority ordering", () => {
  it("dispatches P0 before P1 before P2; orphan before flow within tier", async () => {
    const dispatched: string[] = [];
    const invoke: InvokeAgentFn = async (args) => {
      dispatched.push(args.featureContext.id); // bug id is in featureContext.id
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "completed"] as const),
        ),
        errors: {},
        costUsd: 0.01,
      };
    };

    writeBugsYamlDoc([
      makeBug({
        id: "bug-flow-flow-1-foo",
        source: "flow-execution-failure",
        severity: "P1",
      }),
      makeBug({ id: "bug-orphan-zeta", severity: "P0" }),
      makeBug({
        id: "bug-flow-flow-2-bar",
        source: "flow-execution-failure",
        severity: "P0",
      }),
      makeBug({ id: "bug-orphan-alpha", severity: "P2" }),
    ]);

    await runFixBugsLoop(makeCtx(invoke, cleanVerify));
    // First dispatch per bug — first invoke for each bug
    const firstCalls: string[] = [];
    const seen = new Set<string>();
    for (const id of dispatched) {
      if (seen.has(id)) continue;
      seen.add(id);
      firstCalls.push(id);
    }
    // Order should be: P0 orphan-zeta, P0 flow-flow-2-bar, P1 flow-flow-1-foo, P2 orphan-alpha
    expect(firstCalls).toEqual([
      "bug-orphan-zeta",
      "bug-flow-flow-2-bar",
      "bug-flow-flow-1-foo",
      "bug-orphan-alpha",
    ]);
  });
});

describe("runFixBugsLoop — fixup worktree lifecycle", () => {
  it("creates + tears down a fixup worktree when skipWorktreeManagement=false", async () => {
    // We don't run a real git repo here — opening the worktree should fail
    // gracefully. The loop returns all-bugs-failed without dispatching.
    writeBugsYamlDoc([makeBug({ id: "bug-orphan-noworktree" })]);
    const invoke: InvokeAgentFn = async (args) => ({
      taskStatus: Object.fromEntries(
        args.tasks.map((t) => [t.id, "completed"] as const),
      ),
      errors: {},
      costUsd: 0,
    });
    const result = await runFixBugsLoop(
      makeCtx(invoke, cleanVerify, {
        skipWorktreeManagement: false,
      }),
    );
    // Without a real git repo, openFixupWorktree fails → all-bugs-failed
    // with iterationsRun=0. The bug stays pending (never dispatched).
    expect(result.status).toBe("all-bugs-failed");
    expect(result.iterationsRun).toBe(0);
    expect(result.bugsFailed).toContain("bug-orphan-noworktree");
  });

  // bug-031 Phase A regression — pre-fix the fixup worktree was opened via
  // raw `git worktree add` without the seedWorktree() helper, so dispatched
  // builders hit "hooks not found" + "Read tool requires permission grant"
  // errors. This test pre-creates the fixup worktree (skipping the git path
  // we can't exercise without a real repo) so the seed step still runs and
  // we can assert the post-conditions on disk.
  it("seeds the fixup worktree with .claude/hooks + permissions.allow when the worktree pre-exists", async () => {
    // Project must have hooks + a permissions.allow block at root for
    // seedWorktree to copy/extend.
    const projectHooks = join(projectRoot, ".claude", "hooks");
    mkdirSync(projectHooks, { recursive: true });
    for (const hook of [
      "block-dangerous.sh",
      "detect-loop.mjs",
      "enforce-boundaries.sh",
      "validate-brief.mjs",
    ]) {
      writeFileSync(join(projectHooks, hook), "# stub\n");
    }
    writeFileSync(
      join(projectRoot, ".claude", "settings.json"),
      JSON.stringify({ permissions: { allow: ["Read(*)"] } }, null, 2),
    );

    // Pre-create the fixup worktree dir so openFixupWorktree skips the
    // `git worktree add` path entirely (we cannot run real git here).
    const worktreePath = join(projectRoot, ".claude", "worktrees", "fixup");
    mkdirSync(worktreePath, { recursive: true });

    writeBugsYamlDoc([makeBug({ id: "bug-orphan-seed-test" })]);

    // Build a context where seeding actually runs — skipWorktreeManagement
    // false invokes openFixupWorktree, which now calls seedWorktree().
    const invoke: InvokeAgentFn = async (args) => ({
      taskStatus: Object.fromEntries(
        args.tasks.map((t) => [t.id, "completed"] as const),
      ),
      errors: {},
      costUsd: 0,
    });
    await runFixBugsLoop(
      makeCtx(invoke, cleanVerify, { skipWorktreeManagement: false }),
    );

    // Phase A assertions: the seed-step ran during openFixupWorktree.
    for (const hook of [
      "block-dangerous.sh",
      "detect-loop.mjs",
      "enforce-boundaries.sh",
      "validate-brief.mjs",
    ]) {
      expect(
        existsSync(join(worktreePath, ".claude", "hooks", hook)),
        `seeded hook missing: ${hook}`,
      ).toBe(true);
    }
    const wtSettings = JSON.parse(
      readFileSync(join(worktreePath, ".claude", "settings.json"), "utf8"),
    ) as { permissions?: { allow?: string[] } };
    const allow = wtSettings.permissions?.allow ?? [];
    for (const required of [
      "Write(*)",
      "Edit(*)",
      "MultiEdit(*)",
      "Bash(*)",
      "Read(*)",
      "Glob(*)",
      "Grep(*)",
    ]) {
      expect(allow, `missing autonomous permission: ${required}`).toContain(
        required,
      );
    }
  });

  it("uses projectRoot as cwd when skipWorktreeManagement=true", async () => {
    let observedCwd: string | undefined;
    const invoke: InvokeAgentFn = async (args) => {
      observedCwd = args.cwd;
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "completed"] as const),
        ),
        errors: {},
        costUsd: 0,
      };
    };
    writeBugsYamlDoc([makeBug({ id: "bug-orphan-cwd" })]);
    await runFixBugsLoop(makeCtx(invoke, cleanVerify));
    expect(observedCwd).toBe(projectRoot);
  });
});

describe("runFixBugsLoop — verify integration", () => {
  it("invokes runBuildToSpecVerify after each iteration with iteration+1", async () => {
    const verifyCalls: number[] = [];
    const verify: FixBugsLoopContext["runBuildToSpecVerify"] = async (args) => {
      verifyCalls.push(args.iteration ?? -1);
      return cleanVerify();
    };
    writeBugsYamlDoc(
      [makeBug({ id: "bug-orphan-iter", iteration: 1 })],
      1, // doc.iteration
    );
    const invoke: InvokeAgentFn = async (args) => ({
      taskStatus: Object.fromEntries(
        args.tasks.map((t) => [t.id, "completed"] as const),
      ),
      errors: {},
      costUsd: 0,
    });
    await runFixBugsLoop(makeCtx(invoke, verify));
    expect(verifyCalls).toEqual([2]); // first iteration was 1; verify gets 1+1=2
  });

  it("forwards pipelineRunId + factoryRoot into verify args", async () => {
    let observedArgs: { pipelineRunId?: string; factoryRoot?: string } = {};
    const verify: FixBugsLoopContext["runBuildToSpecVerify"] = async (args) => {
      observedArgs = {
        ...(args.pipelineRunId !== undefined
          ? { pipelineRunId: args.pipelineRunId }
          : {}),
        ...(args.factoryRoot !== undefined
          ? { factoryRoot: args.factoryRoot }
          : {}),
      };
      return cleanVerify();
    };
    writeBugsYamlDoc([makeBug({ id: "bug-orphan-args" })]);
    const invoke: InvokeAgentFn = async (args) => ({
      taskStatus: Object.fromEntries(
        args.tasks.map((t) => [t.id, "completed"] as const),
      ),
      errors: {},
      costUsd: 0,
    });
    await runFixBugsLoop(
      makeCtx(invoke, verify, {
        pipelineRunId: "run-passthrough-001",
        factoryRoot: "/tmp/factory-test",
      }),
    );
    expect(observedArgs.pipelineRunId).toBe("run-passthrough-001");
    expect(observedArgs.factoryRoot).toBe("/tmp/factory-test");
  });
});

describe("runFixBugsLoop — persistence + resumability", () => {
  it("persists bugs.yaml after every bug attempt (mid-iteration crash safety)", async () => {
    const seenStatuses: Array<string[]> = [];
    const invoke: InvokeAgentFn = async (args) => {
      // Snapshot bugs.yaml after each call so we can inspect the persisted
      // state mid-iteration.
      const doc = readBugsYamlDoc();
      seenStatuses.push(doc.bugs.map((b) => `${b.id}:${b.status}`));
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "completed"] as const),
        ),
        errors: {},
        costUsd: 0,
      };
    };
    writeBugsYamlDoc([
      makeBug({ id: "bug-orphan-a" }),
      makeBug({ id: "bug-orphan-b" }),
    ]);
    await runFixBugsLoop(makeCtx(invoke, cleanVerify));
    // First snapshot taken at first agent invoke for bug-a should show
    // bug-a as in-progress.
    const firstSnap = seenStatuses[0]!;
    expect(firstSnap).toContain("bug-orphan-a:in-progress");
  });

  it("resume scenario: pre-existing bugs.yaml is read + iterated from saved state", async () => {
    // bugs.yaml has one completed bug (already resolved last run) + one
    // pending bug. Loop should skip the completed one + work the pending.
    writeBugsYamlDoc([
      makeBug({
        id: "bug-orphan-already-done",
        status: "completed",
        attempts: 1,
        resolvedInIteration: 1,
      }),
      makeBug({ id: "bug-orphan-resume", status: "pending" }),
    ]);
    const dispatched: string[] = [];
    const invoke: InvokeAgentFn = async (args) => {
      dispatched.push(args.featureContext.id);
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "completed"] as const),
        ),
        errors: {},
        costUsd: 0,
      };
    };
    const result = await runFixBugsLoop(makeCtx(invoke, cleanVerify));
    // Each bug invokes 3 agents (sequence) — completed bug should never
    // appear in dispatched list.
    expect(dispatched).not.toContain("bug-orphan-already-done");
    expect(dispatched).toContain("bug-orphan-resume");
    expect(result.bugsResolved.sort()).toEqual([
      "bug-orphan-already-done",
      "bug-orphan-resume",
    ]);
  });
});

describe("runFixBugsLoop — iteration summary", () => {
  it("records per-iteration cost, completed/failed/remaining counts", async () => {
    writeBugsYamlDoc([
      makeBug({ id: "bug-orphan-pass" }),
      makeBug({ id: "bug-orphan-fail", maxAttempts: 1 }),
    ]);
    const invoke: InvokeAgentFn = async (args) => {
      const willFail = args.featureContext.id === "bug-orphan-fail";
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map(
            (t) => [t.id, willFail ? "failed" : "completed"] as const,
          ),
        ),
        errors: willFail
          ? Object.fromEntries(
              args.tasks.map((t) => [t.id, "scripted failure"] as const),
            )
          : {},
        costUsd: 0.1,
      };
    };
    const result = await runFixBugsLoop(makeCtx(invoke, cleanVerify));
    expect(result.iterationLog).toHaveLength(1);
    const iter = result.iterationLog[0]!;
    expect(iter.iteration).toBe(1);
    expect(iter.bugsAttempted).toBe(2);
    expect(iter.bugsCompleted).toBe(1);
    expect(iter.bugsFailed).toBe(1);
    expect(iter.iterationCostUsd).toBeGreaterThan(0);
  });
});

describe("runFixBugsLoop — bugs.yaml file shape after run", () => {
  it("persists final iteration counter + bug statuses to disk", async () => {
    writeBugsYamlDoc([makeBug({ id: "bug-orphan-persist" })]);
    const invoke: InvokeAgentFn = async (args) => ({
      taskStatus: Object.fromEntries(
        args.tasks.map((t) => [t.id, "completed"] as const),
      ),
      errors: {},
      costUsd: 0,
    });
    await runFixBugsLoop(makeCtx(invoke, cleanVerify));
    expect(existsSync(bugsYamlPath)).toBe(true);
    const doc = readBugsYamlDoc();
    expect(doc.iteration).toBe(2); // bumped from 1 → 2 after iteration 1 ran
    expect(doc.bugs[0]!.status).toBe("completed");
    expect(doc.bugs[0]!.resolvedInIteration).toBe(1);
  });
});
