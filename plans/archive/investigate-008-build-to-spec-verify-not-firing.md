---
id: investigate-008-build-to-spec-verify-not-firing
type: investigation
status: completed
author-agent: claude-opus-4-7
created: 2026-04-27
updated: 2026-04-27
completed-at: 2026-04-27
parent-plan: feat-022-build-to-spec-verification
supersedes: null
superseded-by: null
branch: null
affected-files:
  - orchestrator/src/cli-runner.ts
  - orchestrator/src/build-to-spec-verify.ts
  - orchestrator/src/feature-graph.ts
feature-area: orchestration
priority: P1
attempt-count: 1
max-attempts: 5
time-box-minutes: 30
hypothesis: "feat-022's `runBuildToSpecVerify` hook in feature-graph.ts is gated by `skipBuildToSpecVerify: false` (or similar) in the orchestrator config, but cli-runner.ts may default it to true (the test-default) when invoked from the live CLI. Either that or the all-features-merged check fires on the wrong branch (only fires when last feature transitions completed→merged in the CURRENT process, missing the resume case where features land out-of-order or the orchestrator exits before the trigger condition)."
---

# investigate-008 — Why didn't /build-to-spec-verify auto-run on kanban-webapp-10?

## Question

kanban-webapp-10 Mode B resume completed cleanly (`Features completed: 6, Features failed: 0, Total cost: $32.55`) but the orchestrator did NOT log any `[build-to-spec-verify]` lines or run the deterministic post-Mode-B verifier shipped in feat-022. Where in the resume code path did the hook get bypassed, and what's the minimal fix to get it firing on resumed runs (not just first-run completions)?

## Hypothesis

feat-022 wired `runBuildToSpecVerify` into `runFeatureGraph` (per the implementation agent's report) as a post-merge step. Three plausible reasons it didn't fire on -10's resume:

1. **Test-default leaks into CLI**: `feature-graph.ts`'s `FeatureGraphContext` has `skipBuildToSpecVerify?: boolean` defaulting `true` for the test harness (so existing tests don't suddenly need a verifier stub). `cli-runner.ts` may not explicitly set it to `false` for live runs.
2. **Trigger condition gated on "all-features-completed-this-process"**: If the trigger checks something like `features.every(f => completedThisRun.has(f.id))`, a resume where 4 of 6 features were re-merged via re-attempt + 2 newly merged would still satisfy `every`. But if it checks `features.length === completedThisRun.size` (i.e. SIZE comparison) and the resume re-attempted features double-counted (we saw duplicate merge commits) the count could be off.
3. **Hook is downstream of an early return**: The `--auto-merge-after-reviewer` flag path or the resume-feature-graph entry-point may exit before reaching the verify hook.

## Investigation Steps

### Step 1 — Read the wiring (10 min)

- `orchestrator/src/feature-graph.ts`: find `runBuildToSpecVerify` call site. Note the gating condition + which code path leads to it.
- `orchestrator/src/cli-runner.ts`: find where `FeatureGraphContext` is constructed for a live run. Check if `skipBuildToSpecVerify` is set explicitly to `false` or relies on the type-level default.
- `orchestrator/src/cli.ts`: confirm the resume-feature-graph entry point eventually reaches `runFeatureGraph` (vs. some short-circuit).

### Step 2 — Check the kanban-10 output for evidence (5 min)

- `tasks/bam0prdo4.output` — the resume run's stdout. Grep for `build-to-spec`, `verify`, `BuildToSpec`, `reachability`, `flow-`. If zero matches → the hook never fired (vs. fired-and-noop'd-silently).
- Compare against feat-022's tests in `orchestrator/tests/feature-graph.test.ts` — what `console.log` lines does the verify path emit? Should appear in stdout.

### Step 3 — Trace the gating condition (10 min)

- If the hook IS in `feature-graph.ts` but gated on a flag, identify the flag's default + where it's set per-context.
- If the hook fires conditionally on `allFeaturesMerged`, check whether the resume's success criterion ("Features completed: 6") aligns with the trigger's expected shape.

### Step 4 — Recommend (5 min)

- ONE-line fix if it's a flag default
- A more involved fix if the gating logic is structural (e.g., trigger on the `runFeatureGraph` exit path that returns success, not buried in an inner conditional)
- Document any tests that would have caught this (and didn't, since current tests stub verify with `skipBuildToSpecVerify: true`)

## Findings

### Premise correction

The user's evidence ("zero `[build-to-spec-verify]` log lines in stdout") is a **false signal**. Confirmed by `grep -n console\. orchestrator/src/build-to-spec-verify.ts` → only one match, and it's a JSDoc comment (`* /build-to-spec-verify deterministic skill.`). The verify wrapper has **zero `console.log` lines**, so absence of `[build-to-spec-verify]` lines in stdout proves nothing about whether the stage ran.

### Actual call site (Step 1)

`runBuildToSpecVerify` is called **exactly once**, at `orchestrator/src/feature-graph.ts:1112-1147`, inside `runFeatureGraph` after the `while (remaining.size > 0 || inFlight.size > 0)` drain loop. Gating:

```ts
if (failed.size > 0) {
  status = "incomplete"; // skip verify
} else if (!ctx.skipBuildToSpecVerify && completed.size > 0) {
  // ← run verify here
}
```

For kanban-10's resume run: `failed.size === 0`, `completed.size === 6`, and `ctx.skipBuildToSpecVerify` is **never set** anywhere in `cli-runner.ts:285-296` → `!undefined === true`. **Verify SHOULD have entered the branch**. The default runner (`defaultRunBuildToSpecVerify` from `build-to-spec-verify.ts`) is used because `ctx.runBuildToSpecVerify` is also unset.

### Real bug #1 — `factoryRoot` not threaded through (Step 2)

`cli-runner.ts:285-296` constructs `graphCtx` without passing `factoryRoot`. `runCli` has `factoryRoot` as a function parameter (line 74) but never forwards it. Inside `feature-graph.ts:1116-1121` `factoryRoot` is conditionally added to `verifyArgs` only `if (ctx.factoryRoot !== undefined)`, so it falls through to `build-to-spec-verify.ts:100`:

```ts
const factoryRoot = ctx.factoryRoot ?? process.cwd();
```

When the user runs `pnpm --filter orchestrator start generate kanban-webapp-10 ...`, `process.cwd()` is the **orchestrator package dir** (`agentflow_phase2/orchestrator/`), NOT the factory root. The verify wrapper then spawns `node scripts/audit-app-reachability.mjs <projectDir>` with `cwd: factoryRoot` — and `agentflow_phase2/orchestrator/scripts/audit-app-reachability.mjs` doesn't exist (the script lives at `agentflow_phase2/scripts/`). The spawn returns non-zero exit code, the wrapper throws, and `feature-graph.ts:1126-1147` catches it → sets `status: "completed-with-integration-failures"` + records a warning in `verify.warnings[]`.

### Real bug #2 — orchestrator silently swallows the verify outcome (Step 3 + Step 2 cross-check)

`cli-runner.ts:298-309` only surfaces three messages:

```ts
messages.push(`Features completed: ${result.completed.length}`);
messages.push(`Features failed:    ${result.failed.length}`);
messages.push(`Total cost:         $${result.totalCostUsd.toFixed(2)}`);
```

`result.status` and `result.verify` (including `verify.bugPlansFiled[]` and `verify.warnings[]`) are **never logged**. The exit code is also tied only to `result.failed.length`, not to `result.status === "completed-with-integration-failures"`. So even when verify ran AND failed AND filed bug plans (or threw silently), the operator sees only the same four "happy" lines we see in the kanban-10 output.

### Test gap (Step 3)

`orchestrator/tests/feature-graph.test.ts:81` has the test-default `skipBuildToSpecVerify: overrides.skipBuildToSpecVerify ?? true` — so the existing tests that DO exercise verify (lines 1248, 1292, 1343, 1421, 1463) all stub `runBuildToSpecVerify` directly. **No test exercises the real `cli-runner.ts → runFeatureGraph → defaultRunBuildToSpecVerify` wiring**. The CLI-level integration test would have caught both bugs:

- The missing `factoryRoot` thread-through (verify scripts not found)
- The missing `result.status` / `result.verify` surfacing (operator sees no signal)

## Recommendation

### Primary fix (one-liner) — thread `factoryRoot` into `graphCtx`

`orchestrator/src/cli-runner.ts:285-296`, add `factoryRoot` to the literal:

```ts
const graphCtx: Parameters<typeof runFeatureGraph>[1] = {
  projectRoot,
  pipelineRunId,
  budget,
  retryCounters,
  invokeAgent,
  authProvider: providerConfig.provider,
  factoryRoot, // ← add this line
  ...(opts.autoMergeAfterReviewer ? { autoMergeAfterReviewer: true } : {}),
  ...(opts.maxConcurrent ? { maxConcurrentFeatures: opts.maxConcurrent } : {}),
};
```

`factoryRoot` is already in scope (function parameter, line 74). This makes the verify spawn find the right scripts.

### Secondary fix (small) — surface verify outcome in CLI messages

`orchestrator/src/cli-runner.ts:298-309`, add after `Total cost`:

```ts
if (result.status && result.status !== "completed") {
  messages.push(`Status:             ${result.status}`);
}
if (result.verify) {
  messages.push(`Verify ok:          ${result.verify.ok}`);
  if (result.verify.warnings.length > 0)
    messages.push(`Verify warnings:    ${result.verify.warnings.join("; ")}`);
  if (result.verify.bugPlansFiled.length > 0)
    messages.push(`Bug plans filed:    ${result.verify.bugPlansFiled.length}`);
}
```

And consider treating `completed-with-integration-failures` as exitCode 1 (or at least 2) so CI doesn't pass when verify catches violations.

### Test gap fix

Add a CLI-level integration test in `orchestrator/tests/cli-runner.test.ts` that:

1. Sets up a fake project with a tasks.yaml having one already-completed feature.
2. Runs `runCli({ resumeFeatureGraph: true, ... }, factoryRoot)` with the real `runFeatureGraph` (only `invokeAgentOverride` stubbed) and a fake `factoryRoot` containing dummy `scripts/audit-app-reachability.mjs` + `scripts/synthesize-flow-e2e.mjs` that emit valid JSON.
3. Asserts `result.messages` includes a `Verify ok:` or `Status:` line.

This would have caught both the `factoryRoot` thread-through gap and the silent-result gap in one test.

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->
