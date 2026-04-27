---
id: feat-026-automated-bug-fix-loop
type: feature
status: draft
author-agent: claude-opus-4-7
created: 2026-04-27
updated: 2026-04-27
parent-plan: feat-025-flow-spec-execution
supersedes: null
superseded-by: null
branch: feat/automated-bug-fix-loop
affected-files:
  - packages/orchestrator-contracts/src/bugs-yaml.ts
  - schemas/bugs-yaml.schema.json
  - orchestrator/src/fix-bugs-loop.ts
  - orchestrator/src/build-to-spec-verify.ts (emit bugs.yaml from verify failures)
  - orchestrator/src/cli-runner.ts (auto-invoke fix-bugs-loop post-verify)
  - orchestrator/src/feature-graph.ts (extend runFeatureGraph result with bugLoopResult)
  - scripts/file-bug-plan.mjs (also append to bugs.yaml)
  - orchestrator/tests/fix-bugs-loop.test.ts (new)
  - .claude/skills/build-to-spec-verify/SKILL.md (document bugs.yaml emit)
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-026 — Automated bug-fix loop (post-verify auto-remediation)

## Summary

Today: `/build-to-spec-verify` (feat-022 + feat-025) detects integration gaps + files bug plans, then the orchestrator EXITS. Bug remediation is manual — operator picks up plans, manually re-dispatches agents.

This feature **closes the loop**: after verify produces bugs, the orchestrator automatically dispatches a bug-fix iteration → re-runs verify → if new bugs surface, iterates again → continues until 0 bugs OR iteration cap (default 5). The run only "succeeds" when the verifier produces a clean pass.

**Critical separation**: `/plan-bug` (existing user-initiated skill for manually filing bug plans into `plans/active/bug-NNN-*.md`) is **unchanged**. That's the human-discovery channel. feat-026's `bugs.yaml` is a **separate orchestrator-managed channel** populated only by the verifier. The two channels never overlap.

## Goals

1. Mode B → verifier → bug-fix-loop → verifier → ... → clean exit (or iteration cap), all autonomous
2. Each bug carries enough context for an agent to fix it without human triage (orphan correlation, screenshot, expected vs actual screen-id, owning feature, suggested integration point)
3. Per-bug attempt cap (3) prevents stuck-bug-loops; iteration cap (5) prevents stuck-iteration-loops
4. `bugs.yaml` is orchestrator-managed; `/plan-bug` plans remain user-managed; never blur
5. Bug-fix work happens in a dedicated `fixup` worktree (one shared worktree per iteration, sequential within) — avoids the parallel-feature contention bug-015 surfaced

## Non-goals (deferred)

- Parallel bug-fix dispatch (one shared worktree for v1; explicit future plan if needed)
- Cross-iteration bug deduplication beyond bug-id matching (e.g. "this iteration's flow-4 failure is the same root-cause as last iteration's" — heuristic correlator deferred)
- Bug severity tiers beyond P0/P1 (verifier emits all bugs as P0 in v1)
- Auto-archive of resolved bugs (they stay in bugs.yaml with `status: completed` for audit; archive sweep is a separate utility)
- Integration with `/plan-bug`-authored plans (those continue to be human-handled via existing `/start-build` re-run pattern)
- Visual diff bugs (this is feat-022's reachability + flow scope; visual regressions handled by separate plan if needed)

## Approach

5 phases. Phase A is the schema + loader. Phase B is the loop runner. Phase C wires it into the orchestrator. Phase D is the new skill (mirrors `/start-build`). Phase E handles `bugs.yaml` lifecycle (cleanup + audit).

### Phase A — `bugs.yaml` schema + writer (~120 LOC + 12 tests)

New file `packages/orchestrator-contracts/src/bugs-yaml.ts`:

```ts
export const BugSourceSchema = z.enum([
  "reachability-orphan", // feat-022 reachability analyzer
  "flow-execution-failure", // feat-025 spec runner
  "pm-coverage-omission", // feat-023 brief-coverage gate (rare; usually fails earlier)
]);

export const BugStatusSchema = z.enum([
  "pending",
  "in-progress",
  "completed",
  "failed", // hit per-bug attempt cap
  "skipped", // dependency-failed cascade
]);

export const BugEntrySchema = z.object({
  id: z.string().regex(/^bug-(flow|orphan|coverage)-[a-z0-9-]+$/),
  iteration: z.number().int().min(1), // which iteration this bug was first detected
  source: BugSourceSchema,
  severity: z.enum(["P0", "P1", "P2"]).default("P0"),
  summary: z.string().max(200),

  // Source-specific context (one of these will be populated)
  flow: z
    .object({
      id: z.string(), // e.g. "flow-4"
      name: z.string(), // e.g. "Open detail-edit modal"
      failedStep: z.number().int(),
      expectedScreenId: z.string(),
      actualScreenId: z.string().nullable(),
      selector: z.string().nullable(),
      screenshot: z.string().nullable(),
      htmlDump: z.string().nullable(),
    })
    .optional(),
  orphan: z
    .object({
      componentPath: z.string(),
      exportNames: z.array(z.string()),
      suggestedImporters: z.array(z.string()),
    })
    .optional(),

  // Correlation (set when verifier matches a flow failure to an orphan)
  correlatedOrphanPath: z.string().nullable().default(null),
  owningFeature: z.string().nullable().default(null), // featureId from tasks.yaml
  affectsFiles: z.array(z.string()).default([]),

  // Assignment + retry
  agentSequence: z.array(AgentSequenceMember).min(1),
  status: BugStatusSchema.default("pending"),
  attempts: z.number().int().min(0).default(0),
  maxAttempts: z.number().int().min(1).default(3),

  // Cross-references
  bugPlanPath: z.string().nullable().default(null), // plans/active/bug-NNN-...md
  errorLog: z.array(z.string()).default([]), // append per attempt
});

export const BugsYamlSchema = z.object({
  version: z.literal("1.0"),
  generated_at: z.string().datetime(),
  project_name: z.string(),
  source_run_id: z.string(), // pipelineRunId of the run that filed bugs
  iteration: z.number().int().min(1), // current iteration of the fix loop
  iteration_cap: z.number().int().min(1).default(5),
  bugs: z.array(BugEntrySchema),
});
```

`scripts/file-bug-plan.mjs` (extended): in addition to writing the standalone `plans/active/bug-NNN-*.md`, ALSO append to `docs/bugs.yaml` with the auto-derived `agentSequence` (per source: orphan → `[web-frontend-builder, tester, reviewer]`; flow-failure → same; coverage-omission → `[pm, ...flowsource]`).

`affectsFiles[]` derivation:

- `orphan` source: `[componentPath, ...suggestedImporters]`
- `flow-execution-failure` source: `[correlatedOrphan.componentPath, ...suggestedImporters]` (if correlated) OR (uncorrelated) the file paths in the `errorContext.md` Playwright dropped at failure time

### Phase B — Bug-fix loop runner (~250 LOC + 18 tests)

New file `orchestrator/src/fix-bugs-loop.ts`:

```ts
export interface FixBugsLoopContext {
  projectRoot: string;
  pipelineRunId: string;
  factoryRoot: string;
  budget: BudgetTracker;
  invokeAgent: InvokeAgentFn;
  runBuildToSpecVerify: RunBuildToSpecVerifyFn;
  iterationCap?: number; // default 5
  fixupWorktreePath?: string; // default .claude/worktrees/fixup/
  // Test seams
  bugsYamlPath?: string;
}

export interface FixBugsLoopResult {
  status: "clean" | "iteration-cap-hit" | "all-bugs-failed";
  iterationsRun: number;
  bugsResolved: string[]; // bug ids
  bugsFailed: string[];
  bugsRemaining: string[]; // pending after cap hit
  totalCostUsd: number;
  iterationLog: IterationSummary[]; // per-iteration pass/fail breakdown
}

export async function runFixBugsLoop(
  ctx: FixBugsLoopContext,
): Promise<FixBugsLoopResult>;
```

Loop structure:

```
1. Read docs/bugs.yaml → BugsYaml object
2. while iteration <= iterationCap:
     a. iteration += 1
     b. Open shared fixup worktree (one per loop run, NOT per iteration —
        the same worktree gets reused across iterations to preserve fixes
        across the verify→fix→verify cycle). Created at iteration 1, kept
        until loop exits, then merged to master.
     c. For each bug with status === "pending" (priority order: P0 > P1 > P2,
        within tier: orphan > flow-failure > coverage):
          - bug.attempts += 1
          - Build retryContext: { bugId, summary, screenshot, expectedVs
            actualScreenId, suggestedImporters, errorLog: [...prior] }
          - Dispatch agentSequence sequentially (e.g. web-frontend-builder
            then tester then reviewer):
              * Each agent inherits the bug's affectsFiles[] as scope
              * web-frontend-builder gets the orphan + integration target
              * tester re-runs the failing flow spec specifically
              * reviewer validates the merge doesn't regress other flows
          - Per-attempt outcome:
              ✓ success → bug.status = "completed"
              ✗ retry available → leave pending, log to bug.errorLog[]
              ✗ max attempts hit → bug.status = "failed"
     d. If ANY bug got worked on this iteration:
          - git-agent: close-fixup-worktree (merge fixup → master)
          - Re-run /build-to-spec-verify
          - If verify produces NEW bugs (not in bugs.yaml already):
              * Append them to bugs.yaml with iteration = current+1
              * continue loop
          - If verify produces SAME bugs (matched by id):
              * Reset their attempts to 0 and continue (a fix changed
                something but didn't resolve; agent gets fresh attempts)
              * Cap protection: if a bug has been "resolved" 3 times across
                iterations and keeps reappearing, mark it `flapping` +
                escalate to human (treat as failed)
          - If verify clean: status = "clean", break loop
     e. If NO bugs worked on this iteration (all already failed/completed):
          - status = "all-bugs-failed", break
3. After loop:
   - Emit iteration summary to stdout (cli-runner surfaces)
   - Update bugs.yaml with final statuses
   - Tear down fixup worktree (merge if any pending fixes; remove)
   - Return FixBugsLoopResult
```

**Worktree strategy decision**: ONE shared `fixup/` worktree across all bugs + iterations. Pro: avoids the parallel-feature contention bug-015 surfaced. Pro: cheaper (no per-bug worktree creation/teardown). Con: bugs are processed sequentially. Trade-off accepted for v1; parallel bug-fix is a follow-up.

Tests in `orchestrator/tests/fix-bugs-loop.test.ts`: 18 unit tests with stubbed invokeAgent + stubbed verify. Cover: clean exit (0 bugs), iteration cap hit, per-bug attempt cap hit, flapping detection, new-bug detection across iterations, fixup worktree lifecycle.

### Phase C — Orchestrator wiring (~60 LOC + 8 tests)

In `orchestrator/src/feature-graph.ts`:

- Extend `FeatureGraphResult` with `bugLoopResult?: FixBugsLoopResult`
- After `runBuildToSpecVerify` returns, if `verify.bugPlansFiled.length > 0` (or new equivalent: `verify.bugsAppendedToYaml`), invoke `runFixBugsLoop`
- Final `result.status` resolution:
  - `completed` (no integration failures from verifier OR fix-loop achieved clean)
  - `completed-with-integration-failures` (fix-loop hit cap with bugs remaining)
  - `failed` (per-feature failures, unchanged)

In `orchestrator/src/cli-runner.ts`:

- Surface bug-loop iteration summary in stdout (extends bug-017's verify surfacing)
- Exit code: 0 if status === "completed", 1 otherwise

### Phase D — `/fix-bugs` skill (~80 LOC)

New skill at `.claude/skills/fix-bugs/SKILL.md`. **NOT auto-invoked from CLI** — instead it's a manual trigger if the operator wants to re-run the loop standalone (e.g. they manually edited bugs.yaml or added bugs from external triage).

Args:

- `<project>` (required)
- `--max-iterations=N` (override default 5)
- `--bugs-file=<path>` (override default `docs/bugs.yaml`)
- `--dry-run` (preview which bugs would dispatch + estimated cost)

Skill: invokes `runFixBugsLoop` against the same wiring as auto-mode. Mirrors `/start-build`'s shape (preview → confirm → run).

### Phase E — `bugs.yaml` lifecycle + audit (~50 LOC)

- On a fresh `/start-build` run, if `docs/bugs.yaml` exists from a prior run → archive to `docs/bugs-archive/bugs-{timestamp}-iter-{n}.yaml`, then start fresh
- Resolved bugs (`status: completed`) stay in bugs.yaml with the resolution iteration tagged for audit
- Failed bugs (`status: failed`) get a corresponding `plans/active/bug-NNN-*.md` plan file (or update existing) tagged with `escalated-from-bugs-yaml: true`
- New cli flag: `--bugs-yaml-mode={fresh|append}` for advanced operators (default fresh on `/start-build`, append on standalone `/fix-bugs`)

## Validation criteria

- Replay kanban-webapp-10 with feat-026 in place: 6 flow failures → bugs.yaml populated → fix-loop dispatches → web-frontend-builder wires CardDetailModal → re-verify → if 0 failures → exit clean. Estimated cost: ~$8-15 per iteration × ~2 iterations = $16-30 total.
- Synthetic test: bugs.yaml has 5 bugs, all resolve on attempt 1 → loop runs 1 iteration → clean exit
- Synthetic test: bugs.yaml has 1 bug that needs 3 attempts → loop runs 1 iteration with 3 attempts → resolved
- Synthetic test: bugs.yaml has 1 bug that exhausts cap → loop marks failed → continues with others → exits at iteration N with `all-bugs-failed` status
- Synthetic test: fix on iteration 1 introduces NEW bug → loop adds it to bugs.yaml → iteration 2 fixes new bug → clean exit at iteration 3
- Synthetic test: same bug reappears 3 iterations in a row → flapping detected → escalated to failed → human review
- 644 existing tests still pass; +44 new tests across phases A-E

## Cross-references

- **Parent**: feat-025 (spec execution that produces the bugs to fix)
- **Sibling**: feat-022 (verifier that initially detects bugs), feat-023 (PM coverage that prevents some upstream)
- **Reuses**: bug-015's worktree management patterns; feat-024's checkpoint primitives (fix-loop iterations could checkpoint into `feature-graph-progress.json` for pause/resume integration)
- **Untouched**: `/plan-bug` skill remains user-only; bugs.yaml is orchestrator-only — no overlap by design
- **Future**: feat-027 might add parallel bug-fix dispatch via per-bug worktrees IF v1's sequential model proves too slow

## Open questions

- **Bug ID stability across iterations**: today verifier emits `bug-flow-{n}-{slug}`. If iteration 2 introduces a NEW failure on flow-4 (different step) — should it be the same id or a new one? Suggest new id with disambiguator (`bug-flow-4-step-2-<hash>`) so the flapping detector can match on logical bug identity.
- **Fixup worktree → master merge timing**: end-of-iteration vs. end-of-loop? End-of-iteration means fixes are visible to next verify pass (good). End-of-loop is simpler but verify can't see in-progress fixes. Suggest end-of-iteration with a single squash commit per iteration.
- **Cost protection**: should fix-loop have its own budget cap separate from Mode B's? E.g., never spend > 50% of remaining pipeline budget on bug-fix iterations. Defer to operator until we have data; v1 just shares the global budget.
- **Cross-bug interactions**: fixing bug A might inadvertently fix bug B (or break it). Today's design: re-verify after each iteration catches both directions. No special handling.

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->
