---
id: bug-003-builder-output-contract-mismatch
type: bug
status: in-progress
approved-at: 2026-04-25
approved-by: human
author-agent: claude-opus-4-7
created: 2026-04-25
updated: 2026-04-25
parent-plan: bug-002-worktree-missing-hooks-perms
supersedes: null
superseded-by: null
branch: fix/builder-output-contract-mismatch
affected-files:
  - orchestrator/src/invoke-agent.ts
  - orchestrator/tests/invoke-agent.test.ts
feature-area: orchestration
priority: P0
attempt-count: 1
max-attempts: 5
error-message: "feat-bootstrap — task scaffold-next-app failed after 1 attempts: agent produced no parseable outcome JSON"
reproduction-steps: |
  1. Apply bug-002 fix (worktree seed for hooks + permissions) — required so the agent gets past the write-permission wall
  2. /start-build kanban-webapp --resume-feature-graph --max-concurrent=1 --auto-merge-after-reviewer
  3. Observe: feat-bootstrap fails after 1 attempt with "agent produced no parseable outcome JSON" despite the agent successfully writing apps/web/* scaffold files; budget burns ~$1.70 per attempt
stack-trace: null
---

# bug-003 — Orchestrator's per-task outcome parser doesn't match the canonical BuilderOutput contract

## Bug Description

**Expected:** when a builder agent (web-frontend-builder, backend-builder, mobile-frontend-builder) successfully completes its tasks and emits a `BuilderOutput`-shaped JSON in its terminal `result` message, the orchestrator's `runLlmAgent` parses that JSON and marks each task's outcome (`completed` / `failed` / `skipped`) so feature-graph can advance to the next agent in `agent_sequence[]`.

**Actual:** the agent emits valid `BuilderOutput`-shaped JSON (per `packages/orchestrator-contracts/src/builder.ts` and per the agent's prompt at `.claude/agents/web-frontend-builder.md:114-132`), but the orchestrator's `translateOutcomes` function in `orchestrator/src/invoke-agent.ts:786-823` looks for a completely different shape (`{ taskOutcomes: { "<id>": "completed" } }`). The orchestrator never finds `taskOutcomes` in the agent's output, defaults to "agent produced no parseable outcome JSON" for every task, and marks the feature failed — even though the agent did all its work correctly and committed real files.

This was discovered during the bug-002 validation re-run on kanban-webapp 2026-04-25 (~23:21Z). The agent successfully wrote `apps/web/{app/{layout,page}.tsx, components/theme-provider.tsx, lib/{store.ts,store.test.ts}, next.config.ts, postcss.config.{mjs,ts}, package.json, tsconfig.json, vitest.config.ts, vitest.setup.ts}` plus `node_modules/` (pnpm install ran), but the orchestrator marked the task failed and aborted the entire 10-feature DAG.

## Reproduction Steps

1. Apply bug-002 fix (commit `ff58d27`) — required so the agent gets past the worktree write-permission wall
2. Run `/start-build kanban-webapp --resume-feature-graph --max-concurrent=1 --auto-merge-after-reviewer` against a project that has completed Mode A through gate 5 (`docs/credentials-confirmed.txt: proceed`)
3. Observe orchestrator exit report:
   - `feat-bootstrap — task scaffold-next-app failed after 1 attempts: agent produced no parseable outcome JSON`
   - All 9 dependent features cascade to `aborted` with `dependency feat-bootstrap failed`
   - Total cost: ~$1.70 (TASK_RETRY_CAP=1, fast-fail)
4. Inspect the worktree: `apps/web/` exists with real scaffold files (proves the agent ran successfully); `git log` on the feature branch may show the agent's commit; counter shows `feat-bootstrap/scaffold-next-app: 1`

## Error Output

From the orchestrator's structured exit report:

```
Project: C:\Development\ps\claude\claude_\agentflow_phase2\projects\kanban-webapp
Completed stages (9): analyze, skills-audit-design, mockups, stylesheet, screens, visual-review, user-flows, architect, pm
Pending stages   (3): skills-audit-build, register-mcp-build, git-agent-bootstrap
Resume from: skills-audit-build
Features completed: 0
Features failed:    10
Total cost:         $1.70

Failed features:
  ✗ feat-bootstrap — task scaffold-next-app failed after 1 attempts: agent produced no parseable outcome JSON
  ✗ feat-board-core — dependency feat-bootstrap failed
  ✗ feat-card-detail — dependency feat-board-core failed
  ✗ feat-multiple-boards — dependency feat-board-core failed
  ✗ feat-filter — dependency feat-board-core failed
  ✗ feat-settings-data — dependency feat-bootstrap failed
  ✗ feat-theme — dependency feat-bootstrap failed
  ✗ feat-keyboard-shortcuts — dependency feat-board-core failed
  ✗ feat-not-found — dependency feat-bootstrap failed
  ✗ feat-a11y-polish — dependency feat-board-core failed
```

Filesystem evidence that the agent actually succeeded (despite being marked failed):

```
$ ls projects/kanban-webapp/.claude/worktrees/feat-bootstrap/apps/web/
app/  components/  e2e/  lib/  next.config.ts  node_modules/  package.json
postcss.config.mjs  postcss.config.ts  tsconfig.json  tsconfig.tsbuildinfo
vitest.config.ts  vitest.setup.ts
```

## Root Cause Analysis

Three sources of truth must agree on the builder's return shape:

1. **Canonical contract** — `packages/orchestrator-contracts/src/builder.ts:38-90` defines `BuilderOutput` (discriminated on `tier`):

   ```ts
   const BuilderOutputBase = z.object({
     success: z.boolean(),
     stackSlug: z.string().nullable(),
     featureId: z.string().regex(/^feat-[a-z][a-z0-9-]{1,48}$/),
     tasksCompleted: z.array(BuilderTaskResult).default([]),
     tasksFailed: z.array(BuilderTaskResult).default([]),
     tasksSkipped: z.array(BuilderTaskResult).default([]),
     // ... totalFilesWritten, headSha, lintPassed, etc.
   });
   ```

   Where `BuilderTaskResult` is `{ taskId, status: "completed"|"failed"|"skipped", filesWritten, testsWritten, coverageBuilderScope, commitSha, errors? }`.

2. **Agent prompts** — all 3 builder agents (`.claude/agents/{backend,web-frontend,mobile-frontend}-builder.md`) instruct the agent to emit JSON matching the canonical contract:

   ```json
   {
     "tier": "web",
     "success": true,
     "stackSlug": "react-next",
     "featureId": "feat-bootstrap",
     "tasksCompleted": [...],
     "tasksFailed": [],
     "tasksSkipped": [],
     "totalFilesWritten": N,
     "headSha": "<sha>",
     ...
   }
   ```

3. **Orchestrator parser** — `orchestrator/src/invoke-agent.ts:786-823` (`translateOutcomes`) expects a DIFFERENT shape:

   ```ts
   /**
    * Translate a parsed agent-output blob into the orchestrator's per-task
    * outcome map. Expected shape:
    *   { taskOutcomes: { "<task-id>": "completed" | "failed" }, errors?: {...} }
    * Missing task IDs are marked failed.
    */
   const obj = parsed as { taskOutcomes?: unknown; errors?: unknown };
   const rawOutcomes =
     obj.taskOutcomes && typeof obj.taskOutcomes === "object"
       ? (obj.taskOutcomes as Record<string, unknown>)
       : null;
   if (!rawOutcomes) {
     for (const t of tasks) {
       taskStatus[t.id] = "failed";
       errors[t.id] = "agent produced no parseable outcome JSON";
     }
     return { taskStatus, errors };
   }
   ```

The canonical contract (1) and the agent prompts (2) AGREE on `tasksCompleted: BuilderTaskResult[]`. The orchestrator parser (3) is the OUTLIER — it expects a `taskOutcomes: { id: status }` map shape that doesn't appear anywhere in the canonical contract or any agent prompt.

**Why didn't tests catch this?** `orchestrator/tests/invoke-agent.test.ts` stubs the agent SDK to return `structured_output: { taskOutcomes: { t1: "completed" } }` — i.e., the tests use the parser's incorrect shape, not the canonical contract. So the parser tests pass, the agent contract tests pass, but the integration breaks at runtime when a real agent emits the canonical shape.

This is a **plan-handoff defect**:

- task-035 (orchestrator-runtime) authored `translateOutcomes` with its own ad-hoc shape
- feat-008 (builder-runtimes) authored the agent prompts + the `BuilderOutput` zod schema with the canonical shape
- The two plans landed at different times; nobody held a contract-reconciliation step between them

The same defect exists in `backend-builder.md` and `mobile-frontend-builder.md` — they emit the canonical shape too. So the parser fix unblocks all 3 builder tiers simultaneously.

## Fix Approach

Single-phase fix: update the orchestrator's parser to consume `BuilderOutput` per the canonical contract. Two non-negotiables:

1. **Use the zod schema as the parser, not ad-hoc property access.** Replace the manual `obj.taskOutcomes` unwrap with `BuilderOutput.safeParse(parsed)`. This gets us:
   - Type-safe validation aligned with the canonical contract
   - Free upgrade path when the contract evolves (zod errors become diagnostic strings)
   - Discriminated-union narrowing on `tier` so future tier-specific handling is trivial

2. **Translate canonical → internal `taskOutcomes` map.** The orchestrator's per-task retry loop (`feature-graph.ts:316-355`) consumes `result.taskStatus[t.id] === "failed"`. Keep that internal shape; just translate at the parser boundary:

   ```ts
   // Pseudocode
   const parsed = BuilderOutput.safeParse(extractedJson);
   if (parsed.success) {
     const { tasksCompleted, tasksFailed, tasksSkipped } = parsed.data;
     for (const r of tasksCompleted) taskStatus[r.taskId] = "completed";
     for (const r of tasksFailed) {
       taskStatus[r.taskId] = "failed";
       if (r.errors) errors[r.taskId] = r.errors;
     }
     for (const r of tasksSkipped) taskStatus[r.taskId] = "completed"; // skipped → not-failed
     // Tasks not present in any of the 3 arrays default to "failed" + "agent did not report on this task"
   } else {
     // Legacy fallback: try the old taskOutcomes map shape (back-compat with existing tests)
     // OR: surface the zod error as the failure detail so future-debug is one step easier
   }
   ```

### Phase 1 — Parser update

File: `orchestrator/src/invoke-agent.ts:786-823`. Replace `translateOutcomes`:

- Import `BuilderOutput` from `@repo/orchestrator-contracts`
- Add primary path: `BuilderOutput.safeParse(parsed)` → if success, translate the 3 arrays into the internal `taskStatus` + `errors` shape per pseudocode above
- Add legacy fallback: existing `obj.taskOutcomes` map shape (preserves back-compat with the existing test fixtures and any non-builder agent that uses the old shape — git-agent doesn't go through this path; tester/reviewer have their own outputs)
- On total failure (neither shape matches), preserve the existing "agent produced no parseable outcome JSON" message but ALSO include the zod error string so future debugging is one step easier

### Phase 2 — Tests

File: `orchestrator/tests/invoke-agent.test.ts`. Add tests covering:

- Happy path: agent emits `BuilderOutput` shape; parser translates correctly; per-task outcomes match `tasksCompleted`/`tasksFailed`/`tasksSkipped` arrays
- Mixed outcomes: `tasksCompleted: [t1]`, `tasksFailed: [t2]` → `taskStatus = { t1: completed, t2: failed }`, `errors = { t2: <from t2.errors> }`
- Skipped tasks: `tasksSkipped: [t1]` → t1 marked completed (skipped is not a failure); orchestrator advances
- Missing tier discriminator → falls back to legacy parser
- Legacy `taskOutcomes` map still works (back-compat preserved)
- Unparseable JSON → "agent produced no parseable outcome JSON" with zod-error detail
- Update existing test stubs to use `BuilderOutput` shape OR keep them on legacy + verify both paths

### Phase 3 — Companion: orphan branch + worktree dir cleanup (defer to bug-004?)

During the bug-002 validation re-run, two adjacent issues surfaced that don't fit cleanly in bug-003 but are worth flagging:

1. **Orphan local branch from a failed run blocks the next run.** When `/start-build` fails partway through, the leftover `feat/<feature-id>` branch persists locally. The next `git worktree add ... -b feat/<feature-id>` rejects with `branch-conflict`. Workaround today: manual `git branch -D feat/<id>` between runs.

2. **Orphan worktree directory blocks the next run too.** When `git worktree remove --force` succeeds at unregistration but Windows file-locking (e.g. node_modules) prevents directory removal, the next `runCheckoutFeature`'s `existsSync(worktreePath)` returns true → `stale-worktree` failure. Worse: the destructive cleanup `rm -rf` is denied at the operator's permission layer (per feat-020 attempt-2 lesson, MUST surface to the user; never reroute through PowerShell).

Both could be fixed in `runCheckoutFeature`'s pre-flight: detect orphan-but-not-registered worktree dir + delete-and-retry, and orphan branch + reuse-not-recreate. Defer to **bug-004** if you want crisp scoping; OR fold into bug-003 Phase 3 as a defensive prelude. Recommendation: **defer to bug-004** so bug-003 stays narrowly scoped to the contract mismatch.

### Phase 4 — Validation re-run

Re-fire `/start-build kanban-webapp --resume-feature-graph --max-concurrent=1 --auto-merge-after-reviewer` after Phases 1-2 land + the orphan worktree dir is manually cleared. Expected outcome:

- feat-bootstrap completes cleanly: agent's `BuilderOutput` parses → tester runs → reviewer runs → git-agent merges
- Wave 2 unblocks: feat-board-core opens (5 dependents wait on it)
- Either: the run completes (best case → MVP exit) OR fails for a NEW reason in ~$2 (next-layer signal)

Cost expectation per failed feature with TASK_RETRY_CAP=1: ~$2-3 (single attempt + retry) for builder + tester + reviewer combined. Full 10-feature happy path: ~$30-50.

## Rejected Fixes

- **Update the agent prompts to emit `taskOutcomes` map.** Rejected: the agent prompts already match the canonical contract (`BuilderOutput`). Changing them to emit a different shape would diverge from the contracts package and the schema validation downstream of the parser. The parser is the wrong-shape outlier; fix the outlier.

- **Add `taskOutcomes: { id: status }` as an OPTIONAL field to `BuilderOutput`.** Rejected: doubles the source of truth. Either field could drift; agents would have to emit both; reviewers would have to verify both. Single source of truth (`tasksCompleted`/`tasksFailed`/`tasksSkipped` arrays) is cleaner.

- **Loosen the parser to accept ANY shape with `tasksCompleted` OR `taskOutcomes`.** This IS the proposed fix (Phase 1's "legacy fallback") — but only as back-compat for existing non-builder agents and tests. The PRIMARY path uses `BuilderOutput.safeParse` for canonical correctness.

- **Defer until Mode B is fully integration-tested with real agents.** Rejected: bug-002 + bug-003 form a chain that's exactly that integration test. Each iteration peels back the next layer. Continuing the loop is the right strategy; deferring stalls MVP exit indefinitely.

## Validation Criteria

- The original error no longer occurs: a fresh `/start-build kanban-webapp --resume-feature-graph --max-concurrent=1 --auto-merge-after-reviewer` produces `taskStatus: { "scaffold-next-app": "completed" }` for the agent's first attempt (parsed from the agent's `tasksCompleted: [{ taskId: "scaffold-next-app", status: "completed", ... }]`).
- All 218 existing orchestrator tests still pass.
- New `BuilderOutput`-shape happy-path test added; passes.
- Legacy `taskOutcomes`-shape test still passes (back-compat).
- A failed task's `errors[r.taskId]` propagates from `BuilderTaskResult.errors` into the internal `errors` map.
- `pnpm --filter orchestrator typecheck` clean.
- `pnpm --filter @repo/orchestrator-contracts typecheck` clean.
- Validation re-run on kanban-webapp progresses past feat-bootstrap (either completes the full DAG OR fails at a NEW signal — both prove bug-003 is fixed).

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->

### Attempt 1 — 2026-04-25 — claude-opus-4-7

**Tried (Phases 1, 2; Phase 3 deferred per plan; Phase 4 = validation re-run pending):**

- **Phase 1 — Parser update in `orchestrator/src/invoke-agent.ts`**: imported `BuilderOutput` from `@repo/orchestrator-contracts`. Replaced `translateOutcomes` with two-shape parser:
  - **Primary**: `BuilderOutput.safeParse(parsed)` — if valid, walk `tasksCompleted` / `tasksSkipped` / `tasksFailed` arrays, populating `taskStatus` map. Skipped tasks marked `completed` (orchestrator's per-task retry loop only branches on `failed`). Tasks dispatched but absent from all 3 arrays → marked `failed` with `"agent did not report outcome"`.
  - **Fallback**: legacy `taskOutcomes: { id: status }` map shape — preserved for back-compat with existing test fixtures and any non-builder agent (tester, reviewer) that uses the old shape.
  - **Defensive enrichment**: when both shapes fail, the error string now includes a zod-hint from `BuilderOutput.safeParse.error.issues` (top 3) — per the bug-003 attempt-1 lesson, silent "no parseable outcome JSON" cost $6.52 to diagnose; including the zod hint shaves the next debug cycle.
- **Phase 2 — Tests in `orchestrator/tests/invoke-agent.test.ts`**: added a new describe block `invokeAgent — BuilderOutput canonical-shape parsing (bug-003)` with 5 tests:
  - happy path (all completed)
  - mixed outcomes (some completed, some failed, errors propagate)
  - skipped tasks (translated to completed, no error)
  - dispatched task absent from all 3 arrays (marked failed with precise error)
  - totally unparseable JSON (both shapes fail; zod hint surfaces in error string)
  - Each test uses a `builderOutputFixture()` helper to construct schema-valid stubs.

**What happened:**

- First test run after Phase 1: all 218 existing tests passed unchanged (legacy fallback preserved back-compat).
- Second test run after adding the 5 new tests: 4 of 5 failed with "No model resolved for agent 'web-frontend-builder'" — the test's `globalYaml` fixture only registers `backend-builder`, `tester`, `reviewer`. Easy fix: switch the new tests' `agent:` field to `"backend-builder"` (the parser is agent-agnostic; tier discrimination happens via `structured_output.tier`, not the dispatch agent name). One sed pass: `agent: "web-frontend-builder"` → `agent: "backend-builder"` and same for mobile.
- Third test run after the sed fix: **223/223 tests pass** (218 + 5 new). `pnpm --filter orchestrator typecheck` clean. `pnpm --filter @repo/orchestrator-contracts typecheck` clean.

**Outcome:** Phases 1 + 2 implemented and verified at the unit-test level. Validation re-run on kanban-webapp pending — needs the orphan worktree dir cleared (user did this manually after attempt-2 of bug-002 validation), then a fresh `/start-build`.

**Lessons for future-claude:**

- **Test fixtures lie about contracts.** The orchestrator parser tests stubbed `structured_output: { taskOutcomes: { ... } }` — the parser's incorrect shape — and passed for months. They never tested against the canonical `BuilderOutput` schema from `@repo/orchestrator-contracts`. **A test that doesn't import the canonical schema doesn't validate against the canonical contract.** Going forward, contract-bridging code (parser ↔ schema) should always import the schema and `safeParse` against it, not pattern-match field names manually.
- **When a parser branches on shape, surface zod errors at the failure boundary.** Silent "no parseable outcome JSON" took $6.52 to diagnose. The new zod-hint on the failure path costs ~30 LOC and turns the next mismatch into a 30-second read instead of a 30-minute filesystem-archaeology session.
- **Plan-handoff defects are detectable post-hoc by name-grepping.** `tasksCompleted`/`tasksFailed`/`tasksSkipped` exists in the schema + 3 agent prompts but not in the parser. Conversely `taskOutcomes` exists in the parser + tests but not in the schema or any agent prompt. A 30-second `grep -r tasksCompleted .` would have surfaced the mismatch in feat-008 review. Worth proposing a CI check that flags asymmetric uses of contract field names across the schema/agent/parser triangle.

## References

- `plans/active/bug-002-worktree-missing-hooks-perms.md` — parent bug; bug-003 surfaced cheaply because bug-002's TASK_RETRY_CAP=1 surfaced this in $1.70 instead of $6
- `plans/active/feat-014-mvp-completion-autonomous-e2e.md` — MVP plan; bug-003 is the next layer of the autonomous Mode B chain
- `plans/archive/task-035-orchestrator-runtime.md` — where `translateOutcomes` was authored with the wrong shape
- `plans/archive/feat-008-builder-runtimes.md` — where the agent prompts + `BuilderOutput` schema landed with the canonical shape
- `orchestrator/src/invoke-agent.ts:763-836` — `extractStructuredOutput` + `translateOutcomes` (the defect)
- `packages/orchestrator-contracts/src/builder.ts:14-90` — canonical `BuilderOutput` schema
- `.claude/agents/web-frontend-builder.md:114-132` — agent prompt (correctly emits canonical shape)
- `.claude/agents/backend-builder.md:96-130` — sibling agent (same shape, same fix benefit)
- `.claude/agents/mobile-frontend-builder.md:103-130` — sibling agent (same shape, same fix benefit)
- Validation re-run output (transient): `tasks/br7uqeinn.output` — the failed run that surfaced the bug with budget $1.70
