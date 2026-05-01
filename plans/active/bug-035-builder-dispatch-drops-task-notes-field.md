---
id: bug-035-builder-dispatch-drops-task-notes-field
type: bug
status: approved
author-agent: human
created: 2026-05-01
updated: 2026-05-01
parent-plan: investigate-013-seed-state-coverage-from-brief
supersedes: null
superseded-by: null
branch: fix/builder-dispatch-includes-task-notes
affected-files:
  - orchestrator/src/invoke-agent.ts
  - orchestrator/tests/invoke-agent.test.ts
feature-area: orchestrator/builder-dispatch
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "feat-seed-script reviewer rejected: 'archived account still missing after retry. seed.ts:26-38 insertAccount SQL omits archived_at; no account receives archived_at value.' (2 backend-builder retries before reviewer-exhaustion)"
reproduction-steps: "Author a tasks.yaml task with a load-bearing requirement in `notes:` field that is NOT also stated in `summary:`. Dispatch via orchestrator. Confirm the agent's prompt does NOT mention the requirement. Builder produces an implementation that doesn't satisfy the spec; reviewer (which DOES read tasks.yaml fully) catches it after retries exhaust."
stack-trace: null
---

# bug-035: Builder dispatch silently drops the `task.notes` field — load-bearing spec context never reaches the agent

## Bug Description

The orchestrator's `buildAgentPrompt` in `orchestrator/src/invoke-agent.ts:1516` only includes `task.id` + `task.summary` when assembling the per-task block of the agent's prompt. The `task.notes` field — which PM uses to enumerate detailed requirements that don't fit cleanly in a one-liner summary — is **never read** during dispatch.

This means PM-emitted requirements like:

```yaml
- id: seed-script-data
  agent: backend-builder
  summary: apps/api/src/db/seed.ts — creates 3 accounts (USD, GBP, JPY) + ~100 transactions across 12 months across 8 categories.
  notes: |
    Includes one archived account for archive-flow testing.
    Idempotent (TRUNCATE allowlist + reseed). No fx rates seeded
    — fx-refresh hits Frankfurter on first run.
```

reach the builder as just:

```
Tasks assigned to you on this feature:
  - seed-script-data (backend-builder): apps/api/src/db/seed.ts — creates 3 accounts (USD, GBP, JPY) + ~100 transactions across 12 months across 8 categories.
```

The "Includes one archived account for archive-flow testing" + "Idempotent (TRUNCATE allowlist + reseed)" + "No fx rates seeded" lines are **invisible** to the builder. The builder produces an implementation that satisfies `summary:` but misses `notes:`. The reviewer (which DOES read tasks.yaml in full per the reviewer-playbook) catches the gap, but only after the per-task retry budget is exhausted (orchestrator dispatches the builder up to 3 times with the SAME incomplete prompt).

Empirical case (2026-05-01 finance-track-01 launch):

- PM emitted "Includes one archived account for archive-flow testing." in `notes:` for `seed-script-data` (task.yaml line 1046).
- PM emitted "verify ... at least one archived account for testing." in `summary:` for `reviewer-seed-script` (task.yaml line 1055).
- Backend-builder produced a 3-account seed (no archived) on attempt 1.
- Backend-builder produced a 3-account seed (no archived) on attempt 2 — same prompt, same result.
- Reviewer rejected after attempt 2 with a precise diagnosis ("seed.ts:26-38 insertAccount SQL omits archived_at; no account receives archived_at value").
- Feature marked failed; cascade-aborted feat-acceptance-suite.

## Reproduction Steps

1. Author any tasks.yaml task with a load-bearing requirement only in `notes:`, not duplicated in `summary:`. Example:
   ```yaml
   - id: example-task
     agent: backend-builder
     summary: implement /api/users/:id endpoint
     notes: |
       Endpoint MUST return 410 Gone (not 404) for soft-deleted users
       per brief §5 distinction.
   ```
2. Dispatch via orchestrator (`pnpm --filter orchestrator start generate <project> --resume-feature-graph`).
3. In the orchestrator's stdout / agent log, observe: the prompt the builder receives shows `summary:` content but not `notes:`.
4. Builder ships an implementation that returns 404 for soft-deleted users.
5. Reviewer (which reads tasks.yaml fully) flags the bug; orchestrator retries with the same incomplete prompt.

## Error Output

From `tasks/b7u251uxc.output:242` (the actual orchestrator log):

```
✗ feat-seed-script — task reviewer-seed-script failed after 2 attempts:
  Archived account still missing after retry. seed.ts:26-38 insertAccount SQL
  omits archived_at; no account receives archived_at value. seed.test.ts has no
  assertion for archived account presence. Fix: (1) add archived_at column to
  insertAccount INSERT and set a timestamp on at least one account, (2) add
  seed.test.ts assertion that COUNT(*) WHERE archived_at IS NOT NULL >= 1.
  retryTargets: [{agent: 'backend-builder', task: 'seed-script-data'}]
```

The reviewer's diagnosis is exact + actionable because reviewer reads `notes:`. The builder NEVER sees it.

## Root Cause Analysis

`orchestrator/src/invoke-agent.ts:1510-1522`, the `buildAgentPrompt` function:

```ts
function buildAgentPrompt(
  agent: AgentSequenceMember,
  args: Parameters<InvokeAgentFn>[0],
): string {
  const { featureContext, tasks, retryContext } = args;
  const taskLines = tasks
    .map((t) => `  - ${t.id} (${t.agent})${t.summary ? `: ${t.summary}` : ""}`)
    .join("\n");

  let prompt =
    `You are the ${agent} agent for feature ${featureContext.id} ` +
    `(branch ${featureContext.branch}, priority ${featureContext.priority}).\n` +
    `Tasks assigned to you on this feature:\n${taskLines}\n`;
  ...
}
```

The `tasks` array elements have a `notes?: string` field (per `schemas/feature.schema.json` task definition; PM emits it routinely). The map callback ignores it.

This is the same shape as bug-024 (tester source-fix), bug-029 (UI primitives missing data-kit-component), bug-031 (fix-loop fixup-worktree not seeded) — a critical context channel was implicit when the orchestrator was MVP'd, then load-bearing material slipped through the gap. PM and reviewer adapted to use the channel; builder dispatch did not.

## Fix Approach

### Phase A — primary fix (1 PR, ~1 hour)

1. **Edit `orchestrator/src/invoke-agent.ts:1510-1522`** — extend the map callback to include `notes` when present:

   ```ts
   const taskLines = tasks
     .map((t) => {
       const head = `  - ${t.id} (${t.agent})${t.summary ? `: ${t.summary}` : ""}`;
       if (!t.notes) return head;
       const indented = t.notes
         .trim()
         .split("\n")
         .map((line) => `    ${line}`)
         .join("\n");
       return `${head}\n${indented}`;
     })
     .join("\n");
   ```

   Indented under each task line so the prompt remains structurally clear. Trims trailing whitespace from `notes` since PM emits with `|` block scalars (preserves trailing newline).

2. **Add a regression test** in `orchestrator/tests/invoke-agent.test.ts`:

   ```ts
   describe("buildAgentPrompt task.notes", () => {
     it("includes notes content under each task line when present", () => {
       const prompt = buildAgentPrompt("backend-builder", {
         featureContext: { id: "feat-x", branch: "feat/x", priority: "P0" },
         tasks: [
           {
             id: "t1",
             agent: "backend-builder",
             summary: "do the thing",
             notes: "MUST satisfy constraint Y\nIdempotent on re-run",
           },
         ],
         retryContext: undefined,
       });
       expect(prompt).toMatch(/- t1 \(backend-builder\): do the thing/);
       expect(prompt).toMatch(/MUST satisfy constraint Y/);
       expect(prompt).toMatch(/Idempotent on re-run/);
     });

     it("omits notes block when notes is absent", () => {
       const prompt = buildAgentPrompt("backend-builder", {
         featureContext: { id: "feat-x", branch: "feat/x", priority: "P0" },
         tasks: [
           { id: "t1", agent: "backend-builder", summary: "do the thing" },
         ],
         retryContext: undefined,
       });
       expect(prompt).not.toMatch(/notes/i);
     });
   });
   ```

3. **Run the full orchestrator test suite** — expect 578+ tests to pass (no other test should depend on the absence of notes in the prompt).

### Phase B — empirical validation against finance-track-01 (post-Phase-A)

4. After Phase A merges, resume the finance-track-01 build. The orchestrator's natural retry path will:
   - Re-dispatch `feat-seed-script` because it's currently in `failed[]`.
   - Builder receives the prompt WITH the "Includes one archived account" + "Idempotent" notes.
   - Builder produces seed.ts with the archived account on first attempt.
   - Reviewer's brief-delivery check passes without retry.
   - Feature transitions to `completed[]`.
5. **Acceptance criterion**: bug-001 (project-side, finance-track-01) is resolved by orchestrator retry alone — no manual seed.ts edit needed. This validates the dispatch fix closes the bug class.

### Phase C — optional defense-in-depth (P2, defer)

6. Update node-fastify, python-fastapi, node-trpc-nest stack skills' seed-script subsections (if present) with a "if your task notes mention specific data states, demonstrate each one in your seed implementation" rule. This is **redundant** with Phase A (the spec is now in the prompt; the builder's job is to satisfy it) but is **cheap insurance** for variance. Cost: ~30 min editing 3 SKILL.md files. Defer until Phase A + B have been observed in 2-3 fresh builds; if residual variance still produces the bug class, ship Phase C.

## Rejected Fixes

- **PM-side enumeration in `summary:`** — Rejected: PM ALREADY does this when the requirement fits in one line; PM appropriately uses `notes:` for multi-line context. Forcing PM to inline everything in summary defeats the purpose of having a structured field.
- **Stack-skill seed checklist as the primary fix** — Rejected as primary. Even with the best stack-skill rule, the builder needs to see WHICH states the brief promises. The dispatch fix delivers that signal; the stack-skill rule is downstream insurance.
- **Verifier-tier `state-coverage` check (a hypothetical `/build-to-spec verify-state-coverage`)** — Rejected for this bug. Build-to-spec verifier runs AFTER all features merge; catching the bug there is way too late (the work is already done; orchestrator wasted retries; cascade may have aborted dependents). Catching it at builder-prompt time is much cheaper.
- **Modify the brief template to surface state-coverage as a dedicated section** — Rejected: the brief template already has §5 Distinctions + §4 Entities that capture the signal. PM is already extracting it. The breakage is downstream of the brief.

## Validation Criteria

- [ ] `orchestrator/src/invoke-agent.ts:1516` map callback includes `task.notes` content (indented under task line) when notes is non-empty.
- [ ] `orchestrator/tests/invoke-agent.test.ts` has new regression tests covering notes-present + notes-absent cases.
- [ ] Full orchestrator test suite passes (no other test broken by the change).
- [ ] **Empirical**: finance-track-01's `feat-seed-script` retry produces a seed.ts with archived account on first builder attempt + reviewer approves without retry.
- [ ] (After Phase B observed) `projects/finance-track-01/plans/active/bug-001-seed-script-missing-archived-account.md` archived as `closed-by-bug-035` since the orchestrator's automatic retry now resolves it.

## Cross-references

- **Parent**: `plans/active/investigate-013-seed-state-coverage-from-brief.md` — the investigation that surfaced this fix. Recommendation written; investigation closed in 18 min of 45-min time-box.
- **Empirical case**: `projects/finance-track-01/plans/active/bug-001-seed-script-missing-archived-account.md` — the project-side instance. Resolved as a side-effect of bug-035 landing (no manual fix needed at project level once orchestrator retry runs).
- **Sister bugs (same root-cause shape)**: bug-024 (tester source-fix), bug-029 (UI primitives missing data-kit-component), bug-031 (fix-loop fixup-worktree not seeded) — all incomplete-context-delivery patterns in the orchestrator's MVP.
- **Stack skills not affected (this round)**: node-fastify, python-fastapi, node-trpc-nest. Phase C defer per "Optional defense-in-depth" above.

## Attempt Log

<!-- populated as the fix is made -->
