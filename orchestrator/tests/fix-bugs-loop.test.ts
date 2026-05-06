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
import { execSync } from "node:child_process";
import {
  closePerBugWorktree,
  ensureFixupTracksMaster,
  groupDispatchableBugsByPattern,
  injectSlotEnvIntoWorktree,
  isRegisteredGitWorktree,
  openPerBugWorktree,
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

// feat-046 Phase A.1 (2026-05-05) — parallel per-bug-worktree dispatch.
// When ctx.maxConcurrent >= 2, the loop batches dispatchable bugs via
// Promise.all + per-bug worktrees. Tests run with skipWorktreeManagement
// so no real git ops fire; the parallel STRUCTURE is what's exercised.
describe("runFixBugsLoop — parallel dispatch (feat-046 Phase A.1)", () => {
  it("maxConcurrent=3 dispatches 5 bugs in 2 batches (3+2)", async () => {
    const dispatchTimestamps: Array<{ bug: string; agent: string; t: number }> =
      [];
    const invoke: InvokeAgentFn = async (args) => {
      // featureContext.id mirrors bug.id per dispatchAgentsForBug.
      const bugId = args.featureContext?.id ?? "?";
      dispatchTimestamps.push({
        bug: bugId,
        agent: args.agent,
        t: Date.now(),
      });
      // Small delay to make ordering observable.
      await new Promise((r) => setTimeout(r, 10));
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
      makeBug({ id: "bug-orphan-c" }),
      makeBug({ id: "bug-orphan-d" }),
      makeBug({ id: "bug-orphan-e" }),
    ]);

    const result = await runFixBugsLoop(
      makeCtx(invoke, cleanVerify, { maxConcurrent: 3 }),
    );
    expect(result.status).toBe("clean");
    expect(result.bugsResolved.sort()).toEqual([
      "bug-orphan-a",
      "bug-orphan-b",
      "bug-orphan-c",
      "bug-orphan-d",
      "bug-orphan-e",
    ]);
    // 5 bugs × 3 agents = 15 dispatches.
    expect(dispatchTimestamps).toHaveLength(15);
  });

  it("maxConcurrent=2 with 1 manifest-author + 2 build-gap bugs: skip + 1 batch of 2", async () => {
    let dispatchedBugs: string[] = [];
    const invoke: InvokeAgentFn = async (args) => {
      // featureContext.id mirrors bug.id per dispatchAgentsForBug.
      const bugId = args.featureContext?.id ?? "?";
      if (args.agent === "web-frontend-builder") {
        dispatchedBugs.push(bugId);
      }
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "completed"] as const),
        ),
        errors: {},
        costUsd: 0.1,
      };
    };
    writeBugsYamlDoc([
      // Empty agentSequence → skip-dispatch (manifest-author class).
      makeBug({ id: "bug-orphan-skip", agentSequence: [] }),
      makeBug({ id: "bug-orphan-build1" }),
      makeBug({ id: "bug-orphan-build2" }),
    ]);

    const result = await runFixBugsLoop(
      makeCtx(invoke, cleanVerify, { maxConcurrent: 2 }),
    );
    // skip-dispatch bug → needs-operator-review (NOT counted as resolved/failed).
    const doc = readBugsYamlDoc();
    const skipBug = doc.bugs.find((b) => b.id === "bug-orphan-skip");
    expect(skipBug!.status).toBe("needs-operator-review");
    // 2 build-gap bugs → completed.
    expect(result.bugsResolved.sort()).toEqual([
      "bug-orphan-build1",
      "bug-orphan-build2",
    ]);
    // Builder dispatched only against the 2 dispatchable bugs.
    expect(dispatchedBugs.sort()).toEqual([
      "bug-orphan-build1",
      "bug-orphan-build2",
    ]);
  });

  it("maxConcurrent=undefined (default) preserves sequential single-worktree behavior", async () => {
    // Same setup as the existing happy-path sequential test; verifies the
    // default-1 path is unchanged from pre-feat-046.
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

    // No maxConcurrent override → defaults to sequential.
    const result = await runFixBugsLoop(makeCtx(invoke, cleanVerify));
    expect(result.status).toBe("clean");
    expect(result.bugsResolved.sort()).toEqual([
      "bug-orphan-a",
      "bug-orphan-b",
    ]);
    expect(calls.filter((c) => c === "web-frontend-builder")).toHaveLength(2);
  });

  // feat-046 Phase A.2 — per-slot env injection for Strategy C parallelism.
  describe("injectSlotEnvIntoWorktree (Phase A.2)", () => {
    it("writes apps/api/.env.local with slot-specific PORT + DATABASE_PATH", () => {
      const wt = mkdtempSync(join(tmpdir(), "slot-env-api-"));
      try {
        mkdirSync(join(wt, "apps", "api"), { recursive: true });
        injectSlotEnvIntoWorktree({ worktreePath: wt, slot: 2 });
        const apiEnv = readFileSync(
          join(wt, "apps", "api", ".env.local"),
          "utf8",
        );
        // slot 2 → backendPort = 3001 + 2*2 = 3005
        expect(apiEnv).toContain("PORT=3005");
        expect(apiEnv).toContain("ENABLE_TEST_SEED=1");
        expect(apiEnv).toContain(
          "DATABASE_PATH=./data/finance-track-test-slot2.db",
        );
      } finally {
        rmSync(wt, { recursive: true, force: true });
      }
    });

    it("writes apps/web/.env.local with frontend NEXT_PUBLIC_API_BASE_URL", () => {
      const wt = mkdtempSync(join(tmpdir(), "slot-env-web-"));
      try {
        mkdirSync(join(wt, "apps", "web"), { recursive: true });
        injectSlotEnvIntoWorktree({ worktreePath: wt, slot: 0 });
        const webEnv = readFileSync(
          join(wt, "apps", "web", ".env.local"),
          "utf8",
        );
        // slot 0 → backendPort 3001, frontendPort 3000
        expect(webEnv).toContain(
          "NEXT_PUBLIC_API_BASE_URL=http://localhost:3001",
        );
        expect(webEnv).toContain("PORT=3000");
      } finally {
        rmSync(wt, { recursive: true, force: true });
      }
    });

    it("rewrites apps/web/playwright.config.ts PORT/baseURL fallbacks to slot ports", () => {
      const wt = mkdtempSync(join(tmpdir(), "slot-env-pwconfig-"));
      try {
        mkdirSync(join(wt, "apps", "web"), { recursive: true });
        const original = `import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  use: {
    baseURL: process.env["PLAYWRIGHT_BASE_URL"] ?? "http://localhost:3000",
  },
  webServer: {
    command: "node ../../scripts/dev.mjs",
    url: "http://localhost:3000",
    env: {
      PORT: process.env["PORT"] ?? "3001",
      NEXT_PUBLIC_API_BASE_URL: process.env["NEXT_PUBLIC_API_BASE_URL"] ?? "http://localhost:3001",
    },
  },
});
`;
        writeFileSync(
          join(wt, "apps", "web", "playwright.config.ts"),
          original,
          "utf8",
        );
        injectSlotEnvIntoWorktree({ worktreePath: wt, slot: 1 });
        const rewritten = readFileSync(
          join(wt, "apps", "web", "playwright.config.ts"),
          "utf8",
        );
        // slot 1 → frontendPort=3002, backendPort=3003
        expect(rewritten).toContain('?? "3003"'); // PORT fallback
        expect(rewritten).toContain('?? "http://localhost:3003"'); // NEXT_PUBLIC_API_BASE_URL
        expect(rewritten).toContain('?? "http://localhost:3002"'); // baseURL
        expect(rewritten).toContain('"http://localhost:3002"'); // url field
        // Original literals replaced.
        expect(rewritten).not.toContain('?? "3001"');
        expect(rewritten).not.toContain('?? "http://localhost:3001"');
        expect(rewritten).not.toContain('?? "http://localhost:3000"');
      } finally {
        rmSync(wt, { recursive: true, force: true });
      }
    });

    it("is idempotent — running twice produces the same output", () => {
      const wt = mkdtempSync(join(tmpdir(), "slot-env-idem-"));
      try {
        mkdirSync(join(wt, "apps", "api"), { recursive: true });
        injectSlotEnvIntoWorktree({ worktreePath: wt, slot: 0 });
        const first = readFileSync(
          join(wt, "apps", "api", ".env.local"),
          "utf8",
        );
        injectSlotEnvIntoWorktree({ worktreePath: wt, slot: 0 });
        const second = readFileSync(
          join(wt, "apps", "api", ".env.local"),
          "utf8",
        );
        expect(first).toEqual(second);
      } finally {
        rmSync(wt, { recursive: true, force: true });
      }
    });

    it("graceful no-op when playwright.config.ts absent", () => {
      const wt = mkdtempSync(join(tmpdir(), "slot-env-noconfig-"));
      try {
        // Don't create apps/ tree at all — helper must not throw.
        expect(() =>
          injectSlotEnvIntoWorktree({ worktreePath: wt, slot: 5 }),
        ).not.toThrow();
      } finally {
        rmSync(wt, { recursive: true, force: true });
      }
    });
  });

  // bug-052 follow-up (2026-05-05) — pause-resume hardening for parallel path.
  // When PauseSignal fires inside one bug's dispatch within a Promise.all
  // batch, the OTHER bugs must still complete + persist their statuses
  // before the orchestrator unwinds. Pre-fix: PauseSignal aborted Promise.all,
  // post-batch yaml write was skipped, completed-but-not-yet-merged bugs
  // stayed marked in-progress on disk → resume re-attempted wasted work.
  it("parallel path: PauseSignal in one bug doesn't lose other bugs' progress", async () => {
    const dispatchedBugs: string[] = [];
    const invoke: InvokeAgentFn = async (args) => {
      const bugId = args.featureContext?.id ?? "?";
      dispatchedBugs.push(`${bugId}:${args.agent}`);
      // Throw PauseSignal for bug-2's tester. Other bugs (1, 3) should still
      // complete their full agent_sequence + flip to completed.
      if (bugId === "bug-orphan-pause-target" && args.agent === "tester") {
        const { PauseSignal } = await import("../src/pause.js");
        throw new PauseSignal({
          version: "1.0",
          pausedAt: new Date().toISOString(),
          reason: "claude-max-five-hour-limit",
          reasonDetail: "test-injected pause",
          authProvider: "claude-max-subscription",
          drainedInFlight: true,
          pipelineRunId: "run-test-001",
        });
      }
      // Tiny stagger so other bugs progress through their agents.
      await new Promise((r) => setTimeout(r, 5));
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "completed"] as const),
        ),
        errors: {},
        costUsd: 0.05,
      };
    };
    writeBugsYamlDoc([
      makeBug({ id: "bug-orphan-1" }),
      makeBug({ id: "bug-orphan-pause-target" }),
      makeBug({ id: "bug-orphan-3" }),
    ]);

    let caughtPauseSignal = false;
    try {
      await runFixBugsLoop(makeCtx(invoke, cleanVerify, { maxConcurrent: 3 }));
    } catch (err) {
      const { PauseSignal } = await import("../src/pause.js");
      if (err instanceof PauseSignal) {
        caughtPauseSignal = true;
      } else {
        throw err;
      }
    }
    // Pause re-thrown to caller (clean orchestrator unwind path).
    expect(caughtPauseSignal).toBe(true);

    // Critical invariant: bugs OTHER than the paused one persisted their
    // outcomes. Pre-fix: bug-orphan-1 + bug-orphan-3 would stay
    // in-progress on disk because Promise.all aborted before yaml write.
    const doc = readBugsYamlDoc();
    const bug1 = doc.bugs.find((b) => b.id === "bug-orphan-1");
    const bug3 = doc.bugs.find((b) => b.id === "bug-orphan-3");
    const bugPause = doc.bugs.find((b) => b.id === "bug-orphan-pause-target");
    expect(bug1?.status).toBe("completed");
    expect(bug3?.status).toBe("completed");
    // Paused bug stays in-progress — resume picks it up via pendingThisIter
    // (which includes "in-progress" per the existing semantic).
    expect(bugPause?.status).toBe("in-progress");
  });

  it("parallel path: bugs.yaml gets ONE write per batch (not per-bug)", async () => {
    // Wrap writeFileSync to count bugs.yaml writes during the run.
    // Implementation detail: vitest doesn't easily intercept the inline
    // writeBugsYaml — we instead verify the OBSERVABLE invariant: after
    // the run, the doc reflects the final state of all bugs (no race
    // corruption).
    const invoke: InvokeAgentFn = async (args) => {
      // Tiny stagger to expose any race-on-doc-mutation.
      await new Promise((r) => setTimeout(r, Math.random() * 5));
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "completed"] as const),
        ),
        errors: {},
        costUsd: 0.05,
      };
    };
    writeBugsYamlDoc([
      makeBug({ id: "bug-orphan-1" }),
      makeBug({ id: "bug-orphan-2" }),
      makeBug({ id: "bug-orphan-3" }),
      makeBug({ id: "bug-orphan-4" }),
    ]);

    await runFixBugsLoop(makeCtx(invoke, cleanVerify, { maxConcurrent: 4 }));
    // All 4 bugs must end up `completed` — none stuck in-progress (would
    // indicate race-on-doc).
    const doc = readBugsYamlDoc();
    for (const b of doc.bugs) {
      expect(b.status).toBe("completed");
      expect(b.resolvedInIteration).toBe(1);
    }
  });
});

// bug-054 (2026-05-05) — closePerBugWorktree must run merges in the dedicated
// fixup-worktree, NOT projectRoot. Earlier impl ran `git checkout fixup +
// git merge` in projectRoot's working tree; sibling stages (verifier, synth,
// tester) accumulated uncommitted state in projectRoot between merges; the
// next merge collided with that dirt and failed with "Your local changes to
// the following files would be overwritten by merge."
//
// These tests exercise REAL git in a temp dir (no skipWorktreeManagement)
// and verify the merge succeeds even when projectRoot's working tree is dirty.
describe("closePerBugWorktree — bug-054 dirty-projectRoot regression", () => {
  function git(cwd: string, cmd: string): string {
    return execSync(`git ${cmd}`, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    }).toString();
  }

  function setupRepo(): {
    repoRoot: string;
    fixupWorktreePath: string;
    bugWorktreePath: string;
    cleanup: () => void;
  } {
    const repoRoot = mkdtempSync(join(tmpdir(), "bug-054-repo-"));
    git(repoRoot, "init -q -b master");
    git(repoRoot, "config user.email test@example.com");
    git(repoRoot, "config user.name Test");
    git(repoRoot, "config commit.gpgsign false");
    // Initial commit on master.
    writeFileSync(join(repoRoot, "shared.txt"), "v1\n");
    git(repoRoot, "add shared.txt");
    git(repoRoot, 'commit -q -m "initial"');

    // Open fixup worktree on fix/bugs-yaml-iter.
    const fixupWorktreePath = join(repoRoot, ".claude", "worktrees", "fixup");
    mkdirSync(join(repoRoot, ".claude", "worktrees"), { recursive: true });
    git(repoRoot, `worktree add "${fixupWorktreePath}" -b fix/bugs-yaml-iter`);

    // Open per-bug worktree on fix/bug-x with a commit modifying shared.txt.
    const bugWorktreePath = join(repoRoot, ".claude", "worktrees", "bug-x");
    git(repoRoot, `worktree add "${bugWorktreePath}" -b fix/bug-x`);
    writeFileSync(join(bugWorktreePath, "shared.txt"), "v1-fixed-by-bug-x\n");
    git(bugWorktreePath, "add shared.txt");
    git(bugWorktreePath, 'commit -q -m "fix bug-x"');

    return {
      repoRoot,
      fixupWorktreePath,
      bugWorktreePath,
      cleanup: () => rmSync(repoRoot, { recursive: true, force: true }),
    };
  }

  it("merges per-bug branch into fixup branch even when projectRoot has uncommitted changes to a shared file", () => {
    const { repoRoot, fixupWorktreePath, bugWorktreePath, cleanup } =
      setupRepo();
    try {
      // Pollute projectRoot's working tree — simulates the verifier/synth
      // stages writing to projectRoot between merge attempts.
      writeFileSync(
        join(repoRoot, "shared.txt"),
        "v1-locally-modified-in-projectRoot\n",
      );
      const projectRootStatusBefore = git(repoRoot, "status --short");
      expect(projectRootStatusBefore).toContain("shared.txt");

      const result = closePerBugWorktree({
        projectRoot: repoRoot,
        fixupWorktreePath,
        worktreePath: bugWorktreePath,
        branch: "fix/bug-x",
        fixupBranch: "fix/bugs-yaml-iter",
      });

      expect(result.ok).toBe(true);
      // Fixup-worktree HEAD should now have the merge commit + bug-x's edit.
      // (Use `replace(/\r/g, "")` so the assertion stays platform-tolerant —
      // Windows git autocrlf may normalize line endings on checkout.)
      const fixupContent = readFileSync(
        join(fixupWorktreePath, "shared.txt"),
        "utf8",
      ).replace(/\r/g, "");
      expect(fixupContent).toBe("v1-fixed-by-bug-x\n");
      // Per-bug worktree torn down.
      expect(existsSync(bugWorktreePath)).toBe(false);
      // projectRoot's dirty state untouched (the merge happened in the
      // fixup-worktree, not projectRoot).
      const projectRootContent = readFileSync(
        join(repoRoot, "shared.txt"),
        "utf8",
      ).replace(/\r/g, "");
      expect(projectRootContent).toBe("v1-locally-modified-in-projectRoot\n");
    } finally {
      cleanup();
    }
  });

  it("returns ok:false on real merge conflict (no regression)", () => {
    const { repoRoot, fixupWorktreePath, bugWorktreePath, cleanup } =
      setupRepo();
    try {
      // Make the fixup branch have a conflicting edit so the bug-x merge
      // genuinely conflicts.
      writeFileSync(
        join(fixupWorktreePath, "shared.txt"),
        "v1-divergent-on-fixup\n",
      );
      git(fixupWorktreePath, "add shared.txt");
      git(fixupWorktreePath, 'commit -q -m "divergent fixup commit"');

      const result = closePerBugWorktree({
        projectRoot: repoRoot,
        fixupWorktreePath,
        worktreePath: bugWorktreePath,
        branch: "fix/bug-x",
        fixupBranch: "fix/bugs-yaml-iter",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/merge.*failed/);
      }
      // After a real conflict, merge --abort runs; fixup tree is clean.
      const status = git(fixupWorktreePath, "status --short");
      expect(status.trim()).toBe("");
    } finally {
      cleanup();
    }
  });
});

// feat-053 (2026-05-05) — class-batched fix-dispatch. Groups parity-
// divergence bugs by pattern; multi-bug groups dispatch as ONE batched
// task instead of N separate dispatches. Empirical motivator: 22 shell-
// stripping bugs all wanting the same `<AppShell>` wrap fix collapses
// from 22 dispatches × 28min = ~10h to 1 × 30-45min = ~13× faster.
describe("groupDispatchableBugsByPattern — feat-053 helper", () => {
  function parityBug(id: string, pattern: string): BugEntry {
    return {
      ...makeBug({ id }),
      source: "visual-parity",
      severity: "P0",
      parity: {
        screen: id.replace(/^bug-parity-/, ""),
        pattern: pattern as
          | "shell-stripping"
          | "layout-regrouping"
          | "variant-drift"
          | "token-drift",
        detail: { missing: [], extra: [], variantDrift: [], styleDrift: [] },
      },
    };
  }

  it("groups 7 shell-stripping bugs into ONE pattern-group", () => {
    const bugs: BugEntry[] = Array.from({ length: 7 }).map((_, i) =>
      parityBug(`bug-parity-screen-${i}`, "shell-stripping"),
    );
    const groups = groupDispatchableBugsByPattern(bugs);
    expect(groups.size).toBe(1);
    expect(groups.get("pattern:shell-stripping")?.length).toBe(7);
  });

  it("mixes patterns: 7 shell-stripping + 5 layout-regrouping → 2 pattern groups", () => {
    const bugs: BugEntry[] = [
      ...Array.from({ length: 7 }).map((_, i) =>
        parityBug(`bug-parity-screen-${i}`, "shell-stripping"),
      ),
      ...Array.from({ length: 5 }).map((_, i) =>
        parityBug(`bug-parity-other-${i}`, "layout-regrouping"),
      ),
    ];
    const groups = groupDispatchableBugsByPattern(bugs);
    expect(groups.get("pattern:shell-stripping")?.length).toBe(7);
    expect(groups.get("pattern:layout-regrouping")?.length).toBe(5);
  });

  it("singleton parity bugs (size 1 group) are demoted to singletons", () => {
    const bugs: BugEntry[] = [
      parityBug("bug-parity-only-one", "variant-drift"),
    ];
    const groups = groupDispatchableBugsByPattern(bugs);
    expect(groups.has("pattern:variant-drift")).toBe(false);
    expect(groups.has("__singleton__bug-parity-only-one")).toBe(true);
  });

  it("non-parity bugs (orphan, flow-failure) flow as singletons", () => {
    const bugs: BugEntry[] = [
      makeBug({ id: "bug-orphan-foo" }), // reachability-orphan default
      {
        ...makeBug({ id: "bug-flow-flow-1-home" }),
        source: "flow-execution-failure",
      } as BugEntry,
    ];
    const groups = groupDispatchableBugsByPattern(bugs);
    expect(groups.size).toBe(2);
    expect(groups.has("__singleton__bug-orphan-foo")).toBe(true);
    expect(groups.has("__singleton__bug-flow-flow-1-home")).toBe(true);
  });

  it("mixed: 5 shell-stripping + 2 unrelated singletons → 1 pattern-group + 2 singletons", () => {
    const bugs: BugEntry[] = [
      ...Array.from({ length: 5 }).map((_, i) =>
        parityBug(`bug-parity-screen-${i}`, "shell-stripping"),
      ),
      makeBug({ id: "bug-orphan-component-x" }),
      {
        ...makeBug({ id: "bug-flow-flow-2-home" }),
        source: "flow-execution-failure",
      } as BugEntry,
    ];
    const groups = groupDispatchableBugsByPattern(bugs);
    expect(groups.get("pattern:shell-stripping")?.length).toBe(5);
    expect(groups.has("__singleton__bug-orphan-component-x")).toBe(true);
    expect(groups.has("__singleton__bug-flow-flow-2-home")).toBe(true);
  });
});

describe("runFixBugsLoop — feat-053 class-batched dispatch", () => {
  function parityBug(id: string, pattern: string): BugEntry {
    return {
      ...makeBug({ id }),
      source: "visual-parity",
      severity: "P0",
      parity: {
        screen: id.replace(/^bug-parity-/, ""),
        pattern: pattern as
          | "shell-stripping"
          | "layout-regrouping"
          | "variant-drift"
          | "token-drift",
        detail: { missing: [], extra: [], variantDrift: [], styleDrift: [] },
      },
    };
  }

  it("with enableClassBatchedDispatch:true, 5 shell-stripping bugs dispatch as ONE batched task (1 builder + 1 tester + 1 reviewer = 3 dispatches, NOT 15)", async () => {
    const dispatchedAgents: string[] = [];
    const featureContextIds: string[] = [];
    const invoke: InvokeAgentFn = async (args) => {
      dispatchedAgents.push(args.agent);
      featureContextIds.push(args.featureContext?.id ?? "?");
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "completed"] as const),
        ),
        errors: {},
        costUsd: 0.05,
      };
    };
    writeBugsYamlDoc([
      parityBug("bug-parity-home", "shell-stripping"),
      parityBug("bug-parity-accounts", "shell-stripping"),
      parityBug("bug-parity-settings", "shell-stripping"),
      parityBug("bug-parity-reports", "shell-stripping"),
      parityBug("bug-parity-transactions", "shell-stripping"),
    ]);

    const result = await runFixBugsLoop(
      makeCtx(invoke, cleanVerify, {
        maxConcurrent: 3,
        enableClassBatchedDispatch: true,
      } as Partial<FixBugsLoopContext>),
    );

    expect(result.status).toBe("clean");
    // Only 3 agent dispatches (NOT 5 × 3 = 15) because all 5 bugs share
    // a pattern → ONE batched dispatch.
    expect(dispatchedAgents).toHaveLength(3);
    // The batched dispatch's featureContext.id reflects the pattern, not
    // any individual bug id.
    expect(featureContextIds[0]).toMatch(/pattern-shell-stripping-batch/);
    // All 5 bugs end up completed via the SHARED batch dispatch.
    expect(result.bugsResolved.sort()).toEqual([
      "bug-parity-accounts",
      "bug-parity-home",
      "bug-parity-reports",
      "bug-parity-settings",
      "bug-parity-transactions",
    ]);
  });

  it("WITHOUT enableClassBatchedDispatch, the 5 same-pattern bugs dispatch individually (zero behavior change from feat-046)", async () => {
    let dispatchCount = 0;
    const invoke: InvokeAgentFn = async (args) => {
      dispatchCount += 1;
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "completed"] as const),
        ),
        errors: {},
        costUsd: 0.05,
      };
    };
    writeBugsYamlDoc([
      parityBug("bug-parity-home", "shell-stripping"),
      parityBug("bug-parity-accounts", "shell-stripping"),
      parityBug("bug-parity-settings", "shell-stripping"),
    ]);

    const result = await runFixBugsLoop(
      makeCtx(invoke, cleanVerify, { maxConcurrent: 3 }),
    );

    expect(result.status).toBe("clean");
    // 3 bugs × 3 agents = 9 dispatches (existing per-bug behavior preserved).
    expect(dispatchCount).toBe(9);
    expect(result.bugsResolved).toHaveLength(3);
  });

  it("mixed batch + singletons: 4 shell-stripping (batched) + 2 orphan-singletons (per-bug) = 3 batch dispatches + 6 singleton dispatches = 9 total", async () => {
    let batchDispatches = 0;
    let singletonDispatches = 0;
    const invoke: InvokeAgentFn = async (args) => {
      const featureId = args.featureContext?.id ?? "?";
      if (featureId.includes("pattern-")) {
        batchDispatches += 1;
      } else {
        singletonDispatches += 1;
      }
      return {
        taskStatus: Object.fromEntries(
          args.tasks.map((t) => [t.id, "completed"] as const),
        ),
        errors: {},
        costUsd: 0.05,
      };
    };
    writeBugsYamlDoc([
      parityBug("bug-parity-a", "shell-stripping"),
      parityBug("bug-parity-b", "shell-stripping"),
      parityBug("bug-parity-c", "shell-stripping"),
      parityBug("bug-parity-d", "shell-stripping"),
      makeBug({ id: "bug-orphan-foo" }),
      makeBug({ id: "bug-orphan-bar" }),
    ]);

    const result = await runFixBugsLoop(
      makeCtx(invoke, cleanVerify, {
        maxConcurrent: 3,
        enableClassBatchedDispatch: true,
      } as Partial<FixBugsLoopContext>),
    );

    expect(result.status).toBe("clean");
    // 4 same-pattern bugs → 1 batched unit (3 agent dispatches)
    // 2 orphan singletons → 2 units × 3 agents = 6 dispatches
    // Total: 9 dispatches for 6 bugs (vs 18 if per-bug).
    expect(batchDispatches).toBe(3); // builder + tester + reviewer for the pattern
    expect(singletonDispatches).toBe(6); // 2 orphans × 3 agents each
    expect(result.bugsResolved).toHaveLength(6);
  });
});

// bug-055 (2026-05-06) — orphan worktree dir + empty-merge silent-success.
// Empirically observed on reading-log-01 second /fix-bugs run: leftover
// .claude/worktrees/<bugId>/ from a prior crash silently reused (existSync
// guard true, registered-as-worktree false), agent dispatched into orphan
// dir, agent's git ops resolved to project's master, per-bug branch had no
// commits, closePerBugWorktree's `git merge` returned "Already up to date"
// = exit 0 = ok:true, loop marked bug completed despite no fix landing.
//
// Three layers of defense:
//   Phase A — isRegisteredGitWorktree pre-flight + orphan-dir rm-rf
//   Phase B — HEAD-before/HEAD-after empty-merge guard in closePerBugWorktree
//   Phase C — $0-spend stderr warning (defense-in-depth signal)
describe("bug-055 — orphan worktree + empty-merge guards", () => {
  function git(cwd: string, cmd: string): string {
    return execSync(`git ${cmd}`, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    }).toString();
  }

  function setupRepo(): {
    repoRoot: string;
    fixupWorktreePath: string;
    cleanup: () => void;
  } {
    const repoRoot = mkdtempSync(join(tmpdir(), "bug-055-repo-"));
    git(repoRoot, "init -q -b master");
    git(repoRoot, "config user.email test@example.com");
    git(repoRoot, "config user.name Test");
    git(repoRoot, "config commit.gpgsign false");
    writeFileSync(join(repoRoot, "README.md"), "v1\n");
    // seedWorktree (called from openPerBugWorktree) requires a .claude/hooks
    // dir at projectRoot with the canonical REQUIRED_HOOKS files; otherwise
    // its self-verify step fails. Stub each with a no-op body — the test
    // never executes them.
    const hooksDir = join(repoRoot, ".claude", "hooks");
    mkdirSync(hooksDir, { recursive: true });
    for (const h of [
      "block-dangerous.sh",
      "detect-loop.mjs",
      "enforce-boundaries.sh",
      "validate-brief.mjs",
    ]) {
      writeFileSync(join(hooksDir, h), "#!/bin/sh\n");
    }
    git(repoRoot, "add README.md .claude/hooks");
    git(repoRoot, 'commit -q -m "initial"');

    const fixupWorktreePath = join(repoRoot, ".claude", "worktrees", "fixup");
    mkdirSync(join(repoRoot, ".claude", "worktrees"), { recursive: true });
    git(repoRoot, `worktree add "${fixupWorktreePath}" -b fix/bugs-yaml-iter`);

    return {
      repoRoot,
      fixupWorktreePath,
      cleanup: () => rmSync(repoRoot, { recursive: true, force: true }),
    };
  }

  it("isRegisteredGitWorktree returns true for a registered worktree, false for an orphan dir", () => {
    const { repoRoot, fixupWorktreePath, cleanup } = setupRepo();
    try {
      // Registered fixup worktree → true.
      expect(isRegisteredGitWorktree(repoRoot, fixupWorktreePath)).toBe(true);

      // Orphan dir at expected per-bug path (NOT created via git worktree add).
      const orphanPath = join(repoRoot, ".claude", "worktrees", "bug-orphan-x");
      mkdirSync(orphanPath, { recursive: true });
      writeFileSync(join(orphanPath, "leftover.txt"), "stale-content\n");
      expect(isRegisteredGitWorktree(repoRoot, orphanPath)).toBe(false);

      // Nonexistent dir → false (no throw).
      const ghostPath = join(
        repoRoot,
        ".claude",
        "worktrees",
        "bug-does-not-exist",
      );
      expect(isRegisteredGitWorktree(repoRoot, ghostPath)).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("openPerBugWorktree recovers from an orphan dir by rm-rf + creating a fresh registered worktree", () => {
    const { repoRoot, cleanup } = setupRepo();
    try {
      const orphanPath = join(
        repoRoot,
        ".claude",
        "worktrees",
        "bug-orphan-recoverable",
      );
      // Simulate orphan: dir exists with stale content, NOT registered.
      mkdirSync(orphanPath, { recursive: true });
      writeFileSync(join(orphanPath, "stale.txt"), "abandoned-by-prior-run\n");
      expect(isRegisteredGitWorktree(repoRoot, orphanPath)).toBe(false);

      const result = openPerBugWorktree({
        projectRoot: repoRoot,
        bugId: "bug-orphan-recoverable",
        baseBranch: "fix/bugs-yaml-iter",
      });

      if (!result.ok) {
        throw new Error(
          `openPerBugWorktree returned ok:false — ${result.reason}`,
        );
      }
      expect(result.ok).toBe(true);
      // Stale file gone — orphan was rm-rf'd.
      expect(existsSync(join(orphanPath, "stale.txt"))).toBe(false);
      // New registered worktree at the same path.
      expect(isRegisteredGitWorktree(repoRoot, orphanPath)).toBe(true);
      // Branch fix/bug-orphan-recoverable exists.
      const branchList = git(
        repoRoot,
        "branch --list fix/bug-orphan-recoverable",
      );
      expect(branchList).toContain("fix/bug-orphan-recoverable");
    } finally {
      cleanup();
    }
  });

  it("closePerBugWorktree returns ok:false when per-bug branch has 0 commits ahead (empty merge)", () => {
    const { repoRoot, fixupWorktreePath, cleanup } = setupRepo();
    try {
      // Open a per-bug worktree on fix/bug-empty pointing at fixup HEAD —
      // NO new commits on the per-bug branch. This is the silent-success
      // scenario: agent dispatched into the worktree but committed nothing.
      const bugWorktreePath = join(
        repoRoot,
        ".claude",
        "worktrees",
        "bug-empty",
      );
      git(repoRoot, `worktree add "${bugWorktreePath}" -b fix/bug-empty`);

      const fixupHeadBefore = git(fixupWorktreePath, "rev-parse HEAD").trim();

      const result = closePerBugWorktree({
        projectRoot: repoRoot,
        fixupWorktreePath,
        worktreePath: bugWorktreePath,
        branch: "fix/bug-empty",
        fixupBranch: "fix/bugs-yaml-iter",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/empty-merge/);
        expect(result.reason).toContain("fix/bug-empty");
      }

      // Fixup HEAD unchanged — no fake fix landed.
      const fixupHeadAfter = git(fixupWorktreePath, "rev-parse HEAD").trim();
      expect(fixupHeadAfter).toBe(fixupHeadBefore);

      // Per-bug worktree NOT torn down on empty-merge failure (caller can
      // inspect / next iteration may retry).
      expect(existsSync(bugWorktreePath)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("closePerBugWorktree returns ok:true when per-bug branch has >= 1 commit (smoke regression)", () => {
    const { repoRoot, fixupWorktreePath, cleanup } = setupRepo();
    try {
      const bugWorktreePath = join(
        repoRoot,
        ".claude",
        "worktrees",
        "bug-real-fix",
      );
      git(repoRoot, `worktree add "${bugWorktreePath}" -b fix/bug-real-fix`);
      writeFileSync(join(bugWorktreePath, "fix.txt"), "real-content\n");
      git(bugWorktreePath, "add fix.txt");
      git(bugWorktreePath, 'commit -q -m "real fix"');

      const fixupHeadBefore = git(fixupWorktreePath, "rev-parse HEAD").trim();

      const result = closePerBugWorktree({
        projectRoot: repoRoot,
        fixupWorktreePath,
        worktreePath: bugWorktreePath,
        branch: "fix/bug-real-fix",
        fixupBranch: "fix/bugs-yaml-iter",
      });

      expect(result.ok).toBe(true);
      // Fixup HEAD moved (merge commit landed).
      const fixupHeadAfter = git(fixupWorktreePath, "rev-parse HEAD").trim();
      expect(fixupHeadAfter).not.toBe(fixupHeadBefore);
      // Per-bug worktree torn down on successful merge.
      expect(existsSync(bugWorktreePath)).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("Phase C — $0-spend warning fires when dispatch reports success with cost 0 in a non-test run", async () => {
    // Capture stderr writes from the loop's $0-spend defense-in-depth check.
    const origStderrWrite = process.stderr.write.bind(process.stderr);
    const captured: string[] = [];
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      captured.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    }) as typeof process.stderr.write;

    // setupRepo creates a real on-disk repo so skipWorktreeManagement=false
    // exercises the per-bug-worktree branch where the warning lives.
    const { repoRoot, cleanup } = setupRepo();
    try {
      const bug = makeBug({
        id: "bug-orphan-zero-spend",
        agentSequence: ["web-frontend-builder"],
      });
      const projectBugsYaml = join(repoRoot, "docs", "bugs.yaml");
      mkdirSync(join(repoRoot, "docs"), { recursive: true });
      writeFileSync(
        projectBugsYaml,
        yaml.dump({
          version: "1.0",
          generated_at: new Date().toISOString(),
          project_name: "test-project",
          source_run_id: "run-test-001",
          iteration: 1,
          iteration_cap: 5,
          bugs: [bug],
        } satisfies BugsYaml),
      );

      // The agent invocation reports success but $0 spend AND commits a
      // real change to the per-bug worktree — so closePerBugWorktree's
      // empty-merge guard does NOT trip; the warning is the only signal.
      const invokeAgent: InvokeAgentFn = async (a) => {
        const cwd = a.cwd as string;
        writeFileSync(join(cwd, "freebie.txt"), "free work\n");
        execSync(`git add freebie.txt`, { cwd });
        execSync(`git commit -q -m "free fix" --no-verify`, { cwd });
        return {
          stage: a.agent,
          taskStatus: { [`${bug.id}-${a.agent}`]: "completed" },
          taskRetryRequests: {},
          errors: {},
          costUsd: 0,
          durationMs: 1,
        };
      };

      const ctx = makeCtx(invokeAgent, cleanVerify, {
        projectRoot: repoRoot,
        bugsYamlPath: projectBugsYaml,
        skipWorktreeManagement: false,
        maxConcurrent: 2, // forces parallel path where the warning lives
        iterationCap: 1,
      });

      const result = await runFixBugsLoop(ctx);
      expect(result.status).toBe("clean");

      const allStderr = captured.join("");
      expect(allStderr).toMatch(/\[fix-bugs-loop\] WARNING/);
      expect(allStderr).toMatch(/\$0 spend/);
      expect(allStderr).toContain("bug-orphan-zero-spend");
    } finally {
      process.stderr.write = origStderrWrite;
      cleanup();
    }
  });
});

// bug-059 (2026-05-06) — event-loop starvation cap for parallel dispatch.
// runFixBugsLoop now clamps maxConcurrent at 3 by default (overridable via
// FIX_BUGS_MAXCONCURRENT_OVERRIDE env var). Empirical motivator: reading-
// log-01 5-way parallel dispatch caused timer-callback queue starvation;
// keepalive setInterval ticks dropped 5-17 times (drift 156-509s past
// configured 300s abort threshold).
describe("bug-059 — maxConcurrent clamp at 3", () => {
  let stderrCaptured: string[];
  let origStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    stderrCaptured = [];
    origStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      stderrCaptured.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = origStderrWrite;
    delete process.env.FIX_BUGS_MAXCONCURRENT_OVERRIDE;
  });

  it("clamps maxConcurrent=5 to 3 by default + emits stderr warning", async () => {
    const bugs = [makeBug({ id: "bug-orphan-a" })];
    writeBugsYamlDoc(bugs);

    let observedConcurrency = 0;
    const invokeAgent: InvokeAgentFn = async (a) => {
      observedConcurrency = Math.max(observedConcurrency, 1);
      return {
        stage: a.agent,
        taskStatus: { [`bug-orphan-a-${a.agent}`]: "completed" },
        taskRetryRequests: {},
        errors: {},
        costUsd: 0,
        durationMs: 1,
      };
    };

    await runFixBugsLoop(
      makeCtx(invokeAgent, cleanVerify, {
        maxConcurrent: 5,
        iterationCap: 1,
      } as Partial<FixBugsLoopContext>),
    );

    const allStderr = stderrCaptured.join("");
    expect(allStderr).toMatch(/maxConcurrent=5 clamped to 3/);
    expect(allStderr).toContain("bug-059");
  });

  it("FIX_BUGS_MAXCONCURRENT_OVERRIDE env var lifts the clamp", async () => {
    process.env.FIX_BUGS_MAXCONCURRENT_OVERRIDE = "5";
    const bugs = [makeBug({ id: "bug-orphan-a" })];
    writeBugsYamlDoc(bugs);

    const invokeAgent: InvokeAgentFn = async (a) => ({
      stage: a.agent,
      taskStatus: { [`bug-orphan-a-${a.agent}`]: "completed" },
      taskRetryRequests: {},
      errors: {},
      costUsd: 0,
      durationMs: 1,
    });

    await runFixBugsLoop(
      makeCtx(invokeAgent, cleanVerify, {
        maxConcurrent: 5,
        iterationCap: 1,
      } as Partial<FixBugsLoopContext>),
    );

    const allStderr = stderrCaptured.join("");
    // No clamp warning when env override allows the requested value.
    expect(allStderr).not.toMatch(/maxConcurrent=5 clamped/);
  });

  it("requests under cap (e.g. 2) pass through unchanged with no warning", async () => {
    const bugs = [makeBug({ id: "bug-orphan-a" })];
    writeBugsYamlDoc(bugs);

    const invokeAgent: InvokeAgentFn = async (a) => ({
      stage: a.agent,
      taskStatus: { [`bug-orphan-a-${a.agent}`]: "completed" },
      taskRetryRequests: {},
      errors: {},
      costUsd: 0,
      durationMs: 1,
    });

    await runFixBugsLoop(
      makeCtx(invokeAgent, cleanVerify, {
        maxConcurrent: 2,
        iterationCap: 1,
      } as Partial<FixBugsLoopContext>),
    );

    const allStderr = stderrCaptured.join("");
    expect(allStderr).not.toMatch(/clamped/);
  });
});

// bug-061 (2026-05-06) — per-bug worktrees reuse stale base across sessions.
// openPerBugWorktree now always tears down + recreates. Empirical: reading-
// log-01 bhs2ki3i6 — backend-builder ran 25min in a worktree at the prior
// session's commit (0505bf4) when current master had the load-bearing fix
// at cb050f2. Zero commits landed. Always-recreate guarantees fresh-from-
// baseBranch state. Supersedes bug-055 Phase A's orphan-only rm-rf.
describe("bug-061 — openPerBugWorktree always tears down + recreates", () => {
  function git(cwd: string, cmd: string): string {
    return execSync(`git ${cmd}`, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    }).toString();
  }

  function setupRepo(): {
    repoRoot: string;
    cleanup: () => void;
  } {
    const repoRoot = mkdtempSync(join(tmpdir(), "bug-061-repo-"));
    git(repoRoot, "init -q -b master");
    git(repoRoot, "config user.email test@example.com");
    git(repoRoot, "config user.name Test");
    git(repoRoot, "config commit.gpgsign false");
    writeFileSync(join(repoRoot, "README.md"), "v1\n");
    const hooksDir = join(repoRoot, ".claude", "hooks");
    mkdirSync(hooksDir, { recursive: true });
    for (const h of [
      "block-dangerous.sh",
      "detect-loop.mjs",
      "enforce-boundaries.sh",
      "validate-brief.mjs",
    ]) {
      writeFileSync(join(hooksDir, h), "#!/bin/sh\n");
    }
    git(repoRoot, "add README.md .claude/hooks");
    git(repoRoot, 'commit -q -m "initial"');

    // Open fixup worktree on a fix branch to act as baseBranch.
    const fixupWorktreePath = join(repoRoot, ".claude", "worktrees", "fixup");
    mkdirSync(join(repoRoot, ".claude", "worktrees"), { recursive: true });
    git(repoRoot, `worktree add "${fixupWorktreePath}" -b fix/bugs-yaml-iter`);

    return {
      repoRoot,
      cleanup: () => rmSync(repoRoot, { recursive: true, force: true }),
    };
  }

  it("recreates worktree at current baseBranch HEAD when worktree pre-existed at stale base", () => {
    const { repoRoot, cleanup } = setupRepo();
    try {
      // 1. Initial dispatch: open per-bug worktree at original fixupBranch HEAD.
      const r1 = openPerBugWorktree({
        projectRoot: repoRoot,
        bugId: "bug-foo-stale",
        baseBranch: "fix/bugs-yaml-iter",
      });
      expect(r1.ok).toBe(true);
      const bugWorktreePath = join(
        repoRoot,
        ".claude",
        "worktrees",
        "bug-foo-stale",
      );
      const initialBugSha = git(bugWorktreePath, "rev-parse HEAD").trim();

      // 2. Advance fixupBranch in the fixup worktree (simulating a later
      //    session's merge cascade landing new commits).
      const fixupWorktreePath = join(repoRoot, ".claude", "worktrees", "fixup");
      writeFileSync(join(fixupWorktreePath, "new-fix.txt"), "advanced\n");
      git(fixupWorktreePath, "add new-fix.txt");
      git(fixupWorktreePath, 'commit -q -m "advance fixup branch"');
      const newFixupSha = git(fixupWorktreePath, "rev-parse HEAD").trim();
      expect(newFixupSha).not.toBe(initialBugSha);

      // 3. Re-open the same per-bug worktree (simulating a re-fired
      //    /fix-bugs run after master moved).
      const r2 = openPerBugWorktree({
        projectRoot: repoRoot,
        bugId: "bug-foo-stale",
        baseBranch: "fix/bugs-yaml-iter",
      });
      expect(r2.ok).toBe(true);

      // 4. Worktree HEAD should match current fixupBranch HEAD (recreated),
      //    NOT the stale initial HEAD.
      const recreatedSha = git(bugWorktreePath, "rev-parse HEAD").trim();
      expect(recreatedSha).toBe(newFixupSha);
      // The advance commit's file should be visible in the new tree.
      expect(existsSync(join(bugWorktreePath, "new-fix.txt"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("recreates worktree when prior dir is an orphan (bug-055 Phase A regression)", () => {
    const { repoRoot, cleanup } = setupRepo();
    try {
      // Simulate orphan: dir exists with stale content, NOT registered.
      const orphanPath = join(
        repoRoot,
        ".claude",
        "worktrees",
        "bug-orphan-bar",
      );
      mkdirSync(orphanPath, { recursive: true });
      writeFileSync(join(orphanPath, "stale.txt"), "abandoned-prior-session\n");
      expect(isRegisteredGitWorktree(repoRoot, orphanPath)).toBe(false);

      const r = openPerBugWorktree({
        projectRoot: repoRoot,
        bugId: "bug-orphan-bar",
        baseBranch: "fix/bugs-yaml-iter",
      });
      expect(r.ok).toBe(true);
      // Stale file gone; fresh registered worktree created.
      expect(existsSync(join(orphanPath, "stale.txt"))).toBe(false);
      expect(isRegisteredGitWorktree(repoRoot, orphanPath)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("creates fresh worktree on first call (no pre-existing state)", () => {
    const { repoRoot, cleanup } = setupRepo();
    try {
      const r = openPerBugWorktree({
        projectRoot: repoRoot,
        bugId: "bug-fresh-baz",
        baseBranch: "fix/bugs-yaml-iter",
      });
      expect(r.ok).toBe(true);
      const bugWorktreePath = join(
        repoRoot,
        ".claude",
        "worktrees",
        "bug-fresh-baz",
      );
      expect(isRegisteredGitWorktree(repoRoot, bugWorktreePath)).toBe(true);
      // Branch fix/bug-fresh-baz exists.
      const branchList = git(repoRoot, "branch --list fix/bug-fresh-baz");
      expect(branchList).toContain("fix/bug-fresh-baz");
    } finally {
      cleanup();
    }
  });
});

// bug-058 (2026-05-06) — fixup worktree branches from stale fixupBranch
// when master has diverged. openFixupWorktree now calls
// ensureFixupTracksMaster after the worktree is opened to fast-forward
// or merge as appropriate. Empirical motivator: reading-log-01 bjw01o7js
// agent regressed .npmrc + tsconfig fixes that landed on master via
// b1c3e20 between /fix-bugs runs because its worktree branched from
// fix/bugs-yaml-iter at f0f7f77 (stale).
describe("bug-058 — ensureFixupTracksMaster", () => {
  function git(cwd: string, cmd: string): string {
    return execSync(`git ${cmd}`, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    }).toString();
  }

  function setupRepo(): {
    repoRoot: string;
    fixupWorktreePath: string;
    cleanup: () => void;
  } {
    const repoRoot = mkdtempSync(join(tmpdir(), "bug-058-repo-"));
    git(repoRoot, "init -q -b master");
    git(repoRoot, "config user.email test@example.com");
    git(repoRoot, "config user.name Test");
    git(repoRoot, "config commit.gpgsign false");
    writeFileSync(join(repoRoot, "README.md"), "v1\n");
    git(repoRoot, "add README.md");
    git(repoRoot, 'commit -q -m "initial"');

    const fixupWorktreePath = join(repoRoot, ".claude", "worktrees", "fixup");
    mkdirSync(join(repoRoot, ".claude", "worktrees"), { recursive: true });
    git(repoRoot, `worktree add "${fixupWorktreePath}" -b fix/bugs-yaml-iter`);

    return {
      repoRoot,
      fixupWorktreePath,
      cleanup: () => rmSync(repoRoot, { recursive: true, force: true }),
    };
  }

  it("no-ops when fixupBranch is at master HEAD (idempotent)", () => {
    const { repoRoot, fixupWorktreePath, cleanup } = setupRepo();
    try {
      const before = git(fixupWorktreePath, "rev-parse HEAD").trim();
      const result = ensureFixupTracksMaster({
        projectRoot: repoRoot,
        worktreePath: fixupWorktreePath,
        baseBranch: "master",
      });
      expect(result.ok).toBe(true);
      const after = git(fixupWorktreePath, "rev-parse HEAD").trim();
      expect(after).toBe(before); // no movement
    } finally {
      cleanup();
    }
  });

  it("fast-forwards fixupBranch when behind master (empirical bjw01o7js shape)", () => {
    const { repoRoot, fixupWorktreePath, cleanup } = setupRepo();
    try {
      // Operator commits new file to master AFTER fixup branch was created.
      writeFileSync(
        join(repoRoot, ".npmrc"),
        "public-hoist-pattern[]=*prisma*\n",
      );
      git(repoRoot, "add .npmrc");
      git(repoRoot, 'commit -q -m "operator: add npmrc"');
      const masterSha = git(repoRoot, "rev-parse master").trim();
      const fixupBefore = git(fixupWorktreePath, "rev-parse HEAD").trim();
      expect(fixupBefore).not.toBe(masterSha); // fixup is BEHIND

      const result = ensureFixupTracksMaster({
        projectRoot: repoRoot,
        worktreePath: fixupWorktreePath,
        baseBranch: "master",
      });
      expect(result.ok).toBe(true);

      const fixupAfter = git(fixupWorktreePath, "rev-parse HEAD").trim();
      expect(fixupAfter).toBe(masterSha); // fast-forwarded
      // The .npmrc file is now visible in the fixup worktree.
      expect(existsSync(join(fixupWorktreePath, ".npmrc"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("preserves WIP when fixupBranch is ahead of master (descendant)", () => {
    const { repoRoot, fixupWorktreePath, cleanup } = setupRepo();
    try {
      // Add a WIP commit to fixupBranch only.
      writeFileSync(join(fixupWorktreePath, "fixup-wip.txt"), "WIP\n");
      git(fixupWorktreePath, "add fixup-wip.txt");
      git(fixupWorktreePath, 'commit -q -m "WIP on fixup"');
      const fixupBefore = git(fixupWorktreePath, "rev-parse HEAD").trim();
      const masterSha = git(repoRoot, "rev-parse master").trim();
      expect(fixupBefore).not.toBe(masterSha);

      const result = ensureFixupTracksMaster({
        projectRoot: repoRoot,
        worktreePath: fixupWorktreePath,
        baseBranch: "master",
      });
      expect(result.ok).toBe(true);
      const fixupAfter = git(fixupWorktreePath, "rev-parse HEAD").trim();
      expect(fixupAfter).toBe(fixupBefore); // WIP preserved (no movement)
    } finally {
      cleanup();
    }
  });

  it("merges master into fixupBranch on divergence (both have new commits)", () => {
    const { repoRoot, fixupWorktreePath, cleanup } = setupRepo();
    try {
      // Add WIP commit to fixupBranch on a file that won't conflict.
      writeFileSync(join(fixupWorktreePath, "fixup-only.txt"), "fixup wip\n");
      git(fixupWorktreePath, "add fixup-only.txt");
      git(fixupWorktreePath, 'commit -q -m "fixup wip commit"');

      // Operator commits to master on a different file.
      writeFileSync(join(repoRoot, "operator-only.txt"), "operator wip\n");
      git(repoRoot, "add operator-only.txt");
      git(repoRoot, 'commit -q -m "operator commit"');

      // Both branches have commits the other doesn't → diverged.
      const result = ensureFixupTracksMaster({
        projectRoot: repoRoot,
        worktreePath: fixupWorktreePath,
        baseBranch: "master",
      });
      expect(result.ok).toBe(true);

      // Both files should be visible in fixupBranch after merge.
      expect(existsSync(join(fixupWorktreePath, "fixup-only.txt"))).toBe(true);
      expect(existsSync(join(fixupWorktreePath, "operator-only.txt"))).toBe(
        true,
      );
    } finally {
      cleanup();
    }
  });

  it("returns ok:false on merge conflict + leaves clean tree", () => {
    const { repoRoot, fixupWorktreePath, cleanup } = setupRepo();
    try {
      // Both branches edit the SAME file with different content → conflict.
      writeFileSync(join(fixupWorktreePath, "README.md"), "fixup version\n");
      git(fixupWorktreePath, "add README.md");
      git(fixupWorktreePath, 'commit -q -m "fixup edits readme"');

      writeFileSync(join(repoRoot, "README.md"), "operator version\n");
      git(repoRoot, "add README.md");
      git(repoRoot, 'commit -q -m "operator edits readme"');

      const result = ensureFixupTracksMaster({
        projectRoot: repoRoot,
        worktreePath: fixupWorktreePath,
        baseBranch: "master",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/diverged|merge.*failed/);
      }
      // After conflict, the merge --abort should leave the working tree clean.
      const status = git(fixupWorktreePath, "status --short").trim();
      expect(status).toBe("");
    } finally {
      cleanup();
    }
  });
});
