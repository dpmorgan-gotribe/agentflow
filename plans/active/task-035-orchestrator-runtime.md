---
id: task-035-orchestrator-runtime
type: feature
status: draft
author-agent: human
created: 2026-04-22
updated: 2026-04-22
parent-plan: investigate-002-build-tier-readiness-gap
supersedes: null
superseded-by: null
branch: feat/task-035-orchestrator-runtime
affected-files:
  # Runtime implementation
  - orchestrator/index.ts
  - orchestrator/pipeline.ts
  - orchestrator/stage-runner.ts
  - orchestrator/feature-graph.ts
  - orchestrator/model-config.ts
  - orchestrator/budget-tracker.ts
  - orchestrator/retry-counters.ts
  - orchestrator/gate-server-lifecycle.ts
  - orchestrator/visual-review-retry.ts
  - orchestrator/kit-change-request-detour.ts
  - orchestrator/state-persistence.ts
  - orchestrator/cli.ts
  - orchestrator/package.json
  - orchestrator/tsconfig.json
  # Shared contracts package
  - packages/orchestrator-contracts/src/index.ts
  - packages/orchestrator-contracts/src/stages.ts
  - packages/orchestrator-contracts/src/common.ts
  - packages/orchestrator-contracts/src/tasks.ts
  - packages/orchestrator-contracts/src/feature-context.ts
  - packages/orchestrator-contracts/src/git-agent.ts
  # (+ re-exports of schemas already authored in scaffolding/09-034b)
  - packages/orchestrator-contracts/package.json
  - packages/orchestrator-contracts/tsconfig.json
  # Test fixtures + integration tests
  - orchestrator/tests/fixtures/tasks-v2-valid.yaml
  - orchestrator/tests/fixtures/tasks-v2-cycle.yaml
  - orchestrator/tests/stage-runner.test.ts
  - orchestrator/tests/feature-graph.test.ts
  - orchestrator/tests/budget-tracker.test.ts
  - orchestrator/tests/retry-counters.test.ts
  - orchestrator/tests/state-persistence.test.ts
  # Integration wiring
  - package.json # add orchestrator run script + workspace entry
  - pnpm-workspace.yaml # list orchestrator/
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
---

# task-035-orchestrator-runtime: TypeScript orchestrator that drives the two-mode pipeline

## Problem Statement

Every post-design-tier plan binds to the orchestrator. The design pipeline validated end-to-end on mindapp-v2 by running slash commands manually. The build tier can't run manually — it needs programmatic dispatch of tasks to agents inside per-feature worktrees with retry ladders, budget tracking, and crash recovery. Today: `orchestrator/` directory does not exist; `packages/orchestrator-contracts/` does not exist; zero TypeScript code has been written.

The scaffolding spec at `scaffolding/21-035-orchestrator-core.md` (~500 lines) fully specifies the runtime. This plan implements it. Outputs:

1. **`orchestrator/` workspace package** — TypeScript CLI + core modules (`runPipeline`, `runStage`, `runFeature`, `runFeatureGraph`) driving the Claude Agent SDK.
2. **`packages/orchestrator-contracts/` workspace package** — Zod + TypeScript schemas shared with agents. Re-exports of `TasksV2Schema`, `FeatureSchema`, `FeatureContextSchema`, `GitAgentOutput`, + per-stage output schemas specified in `scaffolding/09-034b-output-contract-zod-schemas.md`.

Reference: blueprint Appendix D (refactor-004 feature-graph phase) is the shape; `scaffolding/21-035-orchestrator-core.md` is the contract; this plan is the code.

Must-have acceptance criteria from `docs/build-tier-roadmap.md` §Phase I #1:

- **Cost enforcement** — orchestrator tracks cumulative `query()` cost via Agent SDK response metadata; aborts cleanly (checkpoint context first) when cumulative spend exceeds `.claude/models.yaml.perPipelineMaxUsd`.
- **Retry-counter persistence** at `.claude/state/{pipelineRun}/counters.json` so crash-recovery preserves retry state across the 5-tier retry table (Layer 5 / visual-review / task-retry / merge-conflict / kit-change-request).

## Approach

Nine phases, each independently committable. Every phase ends with passing unit tests. Order is dependency-correct: later phases import from earlier.

### Phase 1 — Packages scaffolded + workspace wired

1. `pnpm init` inside `orchestrator/` + `packages/orchestrator-contracts/`
2. Write `orchestrator/package.json` with `type: "module"`, `exports: { ".": "./dist/index.js" }`, dependencies (`@anthropic-ai/claude-agent-sdk`, `zod`, `js-yaml`, `commander`), devDependencies (`typescript`, `vitest`, `tsx`, `@types/node`)
3. Write `packages/orchestrator-contracts/package.json` — minimal, re-exports zod schemas
4. Add both to `pnpm-workspace.yaml` `packages:` array
5. Write root `tsconfig.json` composite-project config; per-package `tsconfig.json` extends it
6. Run `pnpm install` at factory root; verify workspace resolves cross-package imports via `@repo/orchestrator-contracts`

**Exit**: `pnpm --filter orchestrator typecheck` passes with one empty `index.ts`. `pnpm --filter @repo/orchestrator-contracts typecheck` same.

### Phase 2 — Shared contracts package (@repo/orchestrator-contracts)

1. Create `packages/orchestrator-contracts/src/common.ts` with `PlatformId`, `Target`, `FeatureFlag` enums + `platformIdToTarget()` mapper per `scaffolding/09-034b` spec
2. Create `src/stages.ts` with `PipelineStage` interface + `StageName` enum
3. Create `src/tasks.ts` — port `TasksV2Schema` + `FeatureSchema` + `TaskSchema` from `09-034b` scaffolding spec verbatim
4. Create `src/feature-context.ts` — port `FeatureContextSchema` from feat-003
5. Create `src/git-agent.ts` — port `GitAgentOutput` discriminated union from feat-003
6. Create `src/index.ts` barrel re-exporting everything
7. Write minimal per-schema unit tests (~5 fixtures each; valid + invalid cases) under `orchestrator-contracts/tests/`

**Exit**: `pnpm --filter @repo/orchestrator-contracts test` passes.

### Phase 3 — Model config reader + budget tracker

1. Implement `orchestrator/model-config.ts` per `scaffolding/21-035-orchestrator-core.md` §Model Config Reader exactly. Reads `~/.claude/models.yaml` + `projects/<name>/.claude/models.yaml` + `ANTHROPIC_MODEL` env override. Returns `ModelConfig { model, effort, budgetUsd }`.
2. Implement `orchestrator/budget-tracker.ts` — class `BudgetTracker` with `record(costUsd: number)` + `assertUnderBudget(projectedUsd: number)` + `getCumulative()` + `exhausted()`. Reads `perPipelineMaxUsd` from resolved config.
3. Write unit tests — model config precedence order; budget tracker throws on exhaust; cumulative math correct.

**Exit**: `pnpm --filter orchestrator test -- model-config budget-tracker` passes.

### Phase 4 — Retry counters + state persistence

1. Implement `orchestrator/retry-counters.ts` — class `RetryCounters` maintaining 5 independent counters per the refactor-004 5-tier table (stage Layer-5 / visual-review per-screen / feature-graph per-task / merge-conflict per-feature / kit-change-request pipeline-wide). Each method `increment(tier, key)` + `get(tier, key)` + `isExhausted(tier, key)`.
2. Implement `orchestrator/state-persistence.ts` — serializes `RetryCounters` + `BudgetTracker.cumulative` + pipeline-run-id to `.claude/state/{pipelineRun}/counters.json` after every increment. Loads on startup if the directory exists (crash-recovery).
3. Unit tests — counters hit their caps correctly; state persists across save/load; crash-recovery restores state accurately.

**Exit**: `pnpm --filter orchestrator test -- retry-counters state-persistence` passes. Test creates + populates + serializes + re-instantiates state; asserts round-trip fidelity.

### Phase 5 — runStage primitive

1. Implement `orchestrator/stage-runner.ts` — async function `runStage(stage: PipelineStage, context: RunContext): Promise<StageResult>`:
   - Calls `readModelConfig(stage.agent, projectRoot)`
   - Invokes `@anthropic-ai/claude-agent-sdk`'s `query()` with: `stage.slashCommand + stage.args`, resolved model, resolved effort, plus env vars `CLAUDE_PIPELINE_FLAGS` + (when gated) `CLAUDE_GATE_API_BASE`
   - Parses return JSON from the `query()` output stream
   - Validates against `stage.outputSchema` (Zod)
   - On validation fail: retry up to `maxAttempts: 3` with feedback fed into the next prompt; increments `RetryCounters.tier=layer5`
   - On budget exhaust (query cost pushes cumulative over `perPipelineMaxUsd`): checkpoint + abort
   - Returns `StageResult { success, output, costUsd, attempts, warnings }`
2. Unit tests (mock Agent SDK) — retry on validation fail; budget-abort path; env var passing.

**Exit**: `pnpm --filter orchestrator test -- stage-runner` passes with 4+ test cases.

### Phase 6 — runPipeline (Mode A)

1. Implement `orchestrator/pipeline.ts` — `runPipeline(config: PipelineConfig): Promise<PipelineResult>`:
   - Defines `STAGES[]` array exactly per `scaffolding/21-035-orchestrator-core.md` — 12 entries from `analyze` through `git-agent-bootstrap`
   - For each stage: check `dependsOn` (all must be in `completed` set); `await runStage(stage, ctx)`; append to completed set; checkpoint via `/save-context` (task 013) if present
   - On `stage.gateEnabled`: pause + file-watch `docs/gate-{N}-approved.txt` (formalized by task-036 for gates 1 + 3 + 6; gate 5 already uses file-drop) OR HTTP POST to `{GATE_API_BASE}/api/signoff` for gates 2 + 4 (task-036 HTTP server)
   - Budget check after each stage
   - Returns `PipelineResult { mode: "design", stagesCompleted, totalCostUsd, gatesOpened }`
2. Integration test using mock stages — pipeline walks 3 synthetic stages in order; parallel-dependsOn works; gate-pause is mocked via fake file-write.

**Exit**: `pnpm --filter orchestrator test -- pipeline` passes integration test.

### Phase 7 — runFeature + runFeatureGraph (Mode B)

1. Implement `orchestrator/feature-graph.ts`:
   - `runFeature(feature: Feature, ctx): Promise<FeatureResult>` per `scaffolding/21-035-orchestrator-core.md` §Feature-graph phase pseudocode. Opens worktree via git-agent invocation, runs `feature.agent_sequence[]` in order, each agent gets its `feature.tasks[]` subset filtered by `task.agent === agentName`. Per-task retry on fail (max 3); `agentSurface(agent) ∈ feature.skip` → skip this agent entirely.
   - `runFeatureGraph(features: Feature[], ctx): Promise<FeatureGraphResult>` — topological sort of features by `depends_on`; parallel execution up to `maxConcurrentFeatures` (default 4; configurable in `.claude/models.yaml.stages.feature-graph`)
   - Merge-conflict routing: on `close-feature` conflict, calls git-agent `resolve-conflict-handoff`, re-invokes last-writing agent with context, retries close-feature (max 3 attempts). On exhaust → `emergency-abort`.
2. Integration tests — 3-feature fixture (A backend-only / B depends-on-A web+backend / C mobile-only independent); mock agent invocations; expect parallel A + C, B waits, all merge.

**Exit**: `pnpm --filter orchestrator test -- feature-graph` passes.

### Phase 8 — Visual-review retry loop + kit-change-request detour

1. Implement `orchestrator/visual-review-retry.ts` per spec §Visual-review retry loop — after visual-review stage returns, iterate `violations[]` where severity=error; per screen, counter (max 3); re-invoke `/screens --screen {platform}/{id}`; re-run `/visual-review`; accumulate `needsHumanReview[]`.
2. Implement `orchestrator/kit-change-request-detour.ts` per spec §Kit-change-request detour — on detection in `/screens` or a builder's output, halt emitting stage; invoke PM `--mode=kit-change-request`; re-run `/stylesheet`; resume emitting stage. Post-signoff variant re-opens gate 4.
3. Unit tests for both flows with mocked sub-invocations.

**Exit**: `pnpm --filter orchestrator test` all green (~40+ tests across phases 2-8).

### Phase 9 — CLI + gate-server lifecycle + end-to-end on mindapp-v2 dry-run

1. Implement `orchestrator/cli.ts` — entry point using `commander`:
   ```
   pnpm generate <project-name> [--flags=nanobanana] [--resume-from-stage=<name>] [--resume-feature-graph] [--dry-run]
   ```
2. Implement `orchestrator/gate-server-lifecycle.ts` — spins ephemeral HTTP server (from task-036 when ready) on dynamic port; writes `CLAUDE_GATE_API_BASE` env var; file-watches resolution files; kills server after. MVP stub that logs "task-036 server not yet shipped; using file-drop placeholder"; task-036 plan replaces this with real HTTP server.
3. Root `package.json` gets a `generate` script: `"generate": "pnpm --filter orchestrator start"`.
4. Smoke test: `pnpm generate mindapp-v2 --dry-run` from factory root. Expected: orchestrator reads `projects/mindapp-v2/docs/signoff-*.json` (confirming design-tier complete); attempts to advance to `architect` stage; fails with clean "`/architect` skill not found — see feat-005-architect-implementation plan"; budget tracker shows $0 spent (dry-run); exit code 0.

**Exit**: smoke test passes. orchestrator knows what to do; it's waiting for the agents to exist.

## Rejected Alternatives

- **Alternative A: ship orchestrator in Python** — Rejected. Rest of factory is TypeScript; builder stacks speak TS; shared Zod schemas can't cross-serialize into Python without codegen (the `zod-to-pydantic` plumbing we deferred). Orchestrator-in-TS keeps one language + one type system.

- **Alternative B: single monolithic `orchestrator/index.ts`** (one file, ~1500 LOC) — Rejected. The 9 phases map cleanly to separate modules; splitting per-module enables independent unit tests + easier review + easier future edits. The phase boundaries in this plan match the module boundaries in the code.

- **Alternative C: implement runtime inside `scripts/` as a node CLI, no `orchestrator/` package** — Rejected. Scripts are for one-off tooling; this is a runtime-critical component with 40+ tests. Workspace package is the right home; also makes future task-036 HTTP gate server trivial to colocate.

- **Alternative D: skip retry-counter persistence for MVP** (in-memory only; crash loses state) — Rejected. Without persistence, a mid-run crash requires fully restarting the pipeline including re-spending tokens on stages that already completed. The extra ~200 LOC in `state-persistence.ts` + persistence wiring pays for itself on the first crash.

- **Alternative E: gate-server stub in this plan + real HTTP server inline** — Rejected. HTTP server is task-036's scope. This plan stubs it so orchestrator can run end-to-end without blocking on task-036; task-036 swaps the stub for the real server without further orchestrator changes.

## Expected Outcomes

- [ ] `orchestrator/` workspace package exists with `package.json`, `tsconfig.json`, `src/` + `tests/` layout
- [ ] `packages/orchestrator-contracts/` workspace package exists + re-exports all Zod schemas from `scaffolding/09-034b`
- [ ] Both packages resolve via `pnpm install` at factory root; `pnpm --filter orchestrator typecheck` + `pnpm --filter @repo/orchestrator-contracts typecheck` pass
- [ ] `runStage()` implemented with validation-retry + budget-abort paths
- [ ] `runPipeline()` walks 12-stage Mode A array with `dependsOn` parallelism + gate-pause hooks
- [ ] `runFeature()` + `runFeatureGraph()` implement refactor-004 Appendix D spec with merge-conflict routing
- [ ] Visual-review retry loop (max 3 per screen) + kit-change-request detour (max 2 per pipeline) implemented
- [ ] 5-tier retry counters persist to `.claude/state/{pipelineRun}/counters.json` after every increment; crash-recovery restores state
- [ ] Budget tracker reads `perPipelineMaxUsd`; tracks cumulative cost from Agent SDK response metadata; aborts cleanly (checkpoint first) on exhaust
- [ ] CLI: `pnpm generate <project> [--flags] [--resume-from] [--resume-feature-graph] [--dry-run]`
- [ ] Unit tests: ≥40 across phases 2-8; `pnpm --filter orchestrator test` green
- [ ] Smoke test: `pnpm generate mindapp-v2 --dry-run` exits cleanly with diagnostic "waiting for /architect (see feat-005)"

## Validation Criteria

**Unit test coverage:**

- `orchestrator/tests/` runs via Vitest; ≥40 tests; all passing
- Coverage per testing-policy.md: ≥60% on orchestrator/src builder-scope lines (Phase 8 acceptance)
- Cross-field invariants tested (task.agent ∈ parent.agent_sequence; feature.depends_on has no cycles; task.depends_on same-feature-only)

**Integration test coverage:**

- 3-feature fixture (`orchestrator/tests/fixtures/tasks-v2-valid.yaml`) drives `runFeatureGraph` with mocked agent invocations; expected: parallel A+C, B-waits-on-A, all merge
- Cycle fixture (`tasks-v2-cycle.yaml`) causes `runFeatureGraph` to abort with clear "feature.depends_on forms cycle" error
- Budget-abort fixture triggers orchestrator to checkpoint + exit with informative message

**Manual smoke test:**

1. `pnpm install` at factory root — verifies workspace resolves
2. `pnpm --filter orchestrator build` — verifies TypeScript compiles
3. `pnpm --filter orchestrator test` — verifies all unit + integration tests pass
4. `pnpm generate mindapp-v2 --dry-run` — verifies orchestrator reads design-tier outputs from `projects/mindapp-v2/`, attempts to advance past `user-flows` (which is already complete), hits `architect` stage, reports "/architect skill not yet implemented; see feat-005" and exits cleanly with exit code 0

**Spec fidelity:**

- `scaffolding/21-035-orchestrator-core.md` is the reference; every spec'd function (`runStage`, `runPipeline`, `runFeature`, `runFeatureGraph`, `handleMergeConflict`, `agentSurface`) has an implementation with matching signature
- Blueprint Appendix D's retry-counter table (5 tiers; independent; specified max per tier) is implemented verbatim

**No regression on design tier:**

- Existing `projects/mindapp-v2/` design-tier artefacts (screens, manifests, signoff) unaffected
- Orchestrator in `--dry-run` does not mutate any `projects/*` files

## Attempt Log

<!-- Populated by executing agent.

Per CLAUDE.md retry policy:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
-->
