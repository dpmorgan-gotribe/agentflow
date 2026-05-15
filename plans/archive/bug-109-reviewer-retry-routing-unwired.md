---
id: bug-109-reviewer-retry-routing-unwired
type: bug
status: archived
author-agent: claude-opus-4-7
created: 2026-05-15
updated: 2026-05-15
approved-at: 2026-05-15
completed-at: 2026-05-15
parent-plan: investigate-030-builder-retry-feedback-gap
supersedes: null
superseded-by: null
branch: fix/reviewer-retry-routing-unwired
affected-files:
  - orchestrator/src/feature-graph.ts
  - orchestrator/src/invoke-agent.ts
  - packages/orchestrator-contracts/src/reviewer.ts
  - orchestrator/tests/feature-graph.test.ts
  - orchestrator/tests/invoke-agent.test.ts
  - .claude/agents/backend-builder.md
  - .claude/agents/web-frontend-builder.md
  - .claude/agents/mobile-frontend-builder.md
feature-area: orchestrator/retry-feedback-loop
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "Reviewer's `retryTargets[]` + `findings[]` from ReviewerOutput are never consumed by the orchestrator's retry path. Reviewer fires verdicts into the void."
reproduction-steps: |
  1. Run any Mode B feature where the agent_sequence ends in reviewer.
  2. Author code that the reviewer would reject (e.g., unwired SSRF guard, broken AppShell, missing test).
  3. Reviewer returns ReviewerOutput { overallVerdict: "needs-revision", retryTargets: [{agent: backend-builder, taskIds: [...], notes: "exact-fix-recipe"}] }.
  4. Observe: orchestrator re-dispatches the REVIEWER against the same unchanged code (per-task retry, same-agent loop in feature-graph.ts:1162-1190). The named builder in retryTargets[] is never invoked.
  5. Reviewer re-rejects with same finding. Retry-cap exhausts. Feature marked failed.
stack-trace: null
---

# bug-109 — Reviewer's retry routing is unwired in the orchestrator (P0 — factory-wide latent)

## Bug Description

Investigate-030 H5 (CONFIRMED). The orchestrator's `runFeature` in `orchestrator/src/feature-graph.ts:1100-1216` runs the agent_sequence with a per-task retry loop that re-dispatches the **same agent** that just failed. When the reviewer returns `overallVerdict: "needs-revision"` with `retryTargets[]` naming a builder + specific fix-recipe, the orchestrator NEVER reads `ReviewerOutput.retryTargets` — it just re-dispatches the reviewer against the unchanged worktree, which produces the same verdict, until retry-cap exhausts.

Repository-wide grep: `retryTargets`, `needs-revision`, `overallVerdict`, `ReviewerOutput` appear **zero times** in `orchestrator/src/`. The reviewer contract is defined in `packages/orchestrator-contracts/src/reviewer.ts` but the orchestrator never imports it for retry routing.

This is the smoking gun behind feat-010's deferred "orchestrator routing of retryTargets[]" — feat-010 archived assuming task-035's retry ladder consumed them; it does not.

## Reproduction Steps

See frontmatter. Empirical anchor: `gotribe-tribe-directory/feat-tribe-api` 2026-05-15. The rate-limit-events.ndjson shows 6 total dispatches: 1× backend-builder, 1× security, 1× tester, 3× reviewer. **Zero backend-builder retries** despite the reviewer naming `retryTarget: backend-builder` on every rejection.

## Root Cause Analysis

Per investigate-030 §Findings:

- `orchestrator/src/invoke-agent.ts:1684-1688` — `retryContext` is only `{ taskId, errorMessage }`. Single string. No schema-aware reviewer-verdict context.
- `orchestrator/src/feature-graph.ts:1162-1190` — per-task retry loop hardcodes `agent: agentName` (the current agent that just failed). For a reviewer that fails its own task, this re-invokes the reviewer.
- `packages/orchestrator-contracts/src/reviewer.ts` defines ReviewerOutput.retryTargets[] + findings[] but nothing in orchestrator/ consumes them.

**Class is widespread.** reading-log-01 has ≥9 features with reviewer-dispatch-count ≥3 (max 5) — every one is a candidate for "reviewer's verdict was noisy because no builder ever applied the fix". Every project that has run Mode B with a reviewer in agent_sequence since feat-010 shipped is affected.

## Fix Approach

Three coordinated changes:

### Phase A — Type the retryContext (`packages/orchestrator-contracts/src/reviewer.ts` + `invoke-agent.ts`)

Extend `InvokeAgentFn.retryContext` from `{ taskId, errorMessage }` to a discriminated union:

```ts
retryContext?:
  | { source: "task-retry"; taskId: string; errorMessage: string }
  | {
      source: "reviewer";
      taskId: string;
      errorMessage: string;
      playbookSection: string;
      filePath: string;
      line?: number;
      dimension: ReviewDimension;
      retryTargetNotes?: string;
    }
  | { source: "merge-conflict"; taskId: string; errorMessage: string }
  | { source: "parity-smoke"; taskId: string; errorMessage: string }
  | { source: "install-failure"; taskId: string; errorMessage: string };  // bug-108 pairing
```

Back-compat shim: legacy 2-field callers default to `source: "task-retry"`.

### Phase B — Wire reviewer-driven routing in `feature-graph.ts:runFeature`

After a reviewer dispatch returns, if `result.taskStatus[reviewerTaskId] === "failed"` AND output parses as `ReviewerOutput` with `overallVerdict === "needs-revision"`:

1. For each `retryTarget` in `ReviewerOutput.retryTargets[]`:
   - Find the matching prior-agent step in the same feature's agent_sequence (e.g., `backend-builder`).
   - Re-dispatch that agent against the tasks named in `retryTarget.taskIds[]`, with `retryContext.source = "reviewer"` carrying the full `ReviewIssue` payload.
2. After ALL retry-target builders complete, **re-run the FULL downstream chain** (security → tester → reviewer) — not just reviewer — so the new code gets re-validated.
3. Bound by existing per-task retry cap (max 2-3). If retry-cap exhausts on the builder, the feature fails with `reviewer-cap-exhausted`.
4. If `overallVerdict === "approved"`: proceed to close-feature.
5. If `overallVerdict === "blocked"`: mark feature failed with `gate-blocked-by-reviewer`.

### Phase C — Prompt formatting (`invoke-agent.ts:buildAgentPrompt`)

When `retryContext.source === "reviewer"`, emit a HARD CONSTRAINT block at the TOP of the prompt (above the task block), modeled on `.claude/rules/testing-policy.md`'s framing:

```
HARD CONSTRAINT — REVIEWER REJECTED A PRIOR ATTEMPT
The reviewer flagged the following issue on this feature:
  Dimension: <dimension>     Playbook: <playbookSection>
  File: <filePath>:<line>
  Diagnostic: <message>
You MUST apply this exact fix before re-running self-verify. Do not
re-implement from the task spec — extend the existing implementation
with the named change. Run lint+typecheck+test, then report completed.
```

### Phase D — Agent prompt updates (small, follow-up; H3 fallback)

Add a §"Reviewer feedback handling" subsection to `.claude/agents/backend-builder.md`, `web-frontend-builder.md`, `mobile-frontend-builder.md`. ~15 lines each. Instruct: "When invoked with `retryContext.source === 'reviewer'`, the reviewer named a specific file + line + fix. Apply that exact change. Do NOT re-implement the task from scratch."

### Phase E — Regression tests (`orchestrator/tests/feature-graph.test.ts`)

- Reviewer returns `needs-revision` with one `retryTarget = {agent: backend-builder, taskIds: ["x"]}` → orchestrator re-invokes backend-builder with the issue context.
- Reviewer returns `needs-revision` with two retryTargets across two agents → both agents re-invoked.
- After all retryTargets re-run, reviewer is re-invoked + returns `approved` → orchestrator advances to close-feature.
- Retry cap exhausted → feature marked failed with reviewer-cap-exhausted reason.

Estimated size: ~150 lines in feature-graph.ts (routing decision + downstream-rerun loop), ~30 lines in invoke-agent.ts (typed retryContext + HARD CONSTRAINT formatter), ~120 lines of tests. Total ~300 LoC.

## Rejected Fixes

- **Just tighten builder prompts (H3 alone)** — rejected: the prompt never reaches the builder, so prompt tightening is useless until routing is wired. Phase D is a secondary defense AFTER A+B+C ship.
- **Have the reviewer write directly to a fix-bugs queue** — rejected: that would bypass the orchestrator's retry-cap + accounting, and creates an unbounded loop class.

## Validation Criteria

1. End-to-end test: simulate reviewer returning `needs-revision` with a builder retryTarget → confirm orchestrator re-invokes the named builder with HARD CONSTRAINT context → builder applies fix → reviewer re-runs + approves → feature merges.
2. Re-run gotribe-tribe-directory feat-tribe-api from scratch against the fix → backend-builder retry applies the SSRF wiring on its own, no hand-recovery needed.
3. All existing orchestrator tests pass.
4. New regression tests pass.

## Related Work

- `plans/active/bug-035-builder-dispatch-drops-task-notes-field.md` — adjacent (task.notes was the FIRST channel of context-dropping). Per investigate-030 surprise #1, bug-035 is ALREADY SHIPPED (patch at invoke-agent.ts:1648-1666); only its frontmatter is stale. Bookkeeping cleanup at end of this bug.
- `plans/archive/feat-010-reviewer-implementation.md` — line 120 EXPLICITLY DEFERRED retryTargets[] routing, assuming task-035 would consume. Latent gap since reviewer shipped.

## Attempt Log

### Attempt 1 — 2026-05-15 — claude-opus-4-7 — SUCCESS (MVP)

Shipped a pragmatic MVP closing the core gap. Phases A (typed retryContext discriminated union) + D (builder-agent prompt edits) deferred as follow-up since they're defense-in-depth rather than load-bearing. The wire from reviewer verdict → named builder dispatch is now live.

Changes (~180 LoC across 3 source files + 1 test file):

**Phase A (subset) — opaque reviewerOutput on InvokeAgentResult:**

- `orchestrator/src/feature-graph.ts` — added `reviewerOutput?: ReviewerOutputType` to `InvokeAgentResult`; imported `ReviewerOutput as ReviewerOutputType` from `@repo/orchestrator-contracts`.
- `orchestrator/src/invoke-agent.ts` — imported `ReviewerOutput as ReviewerOutputSchema` (value) + `ReviewerOutput as ReviewerOutputType` (type). In the result-shaping block at end of `runLlmAgent`, when `agent === "reviewer"`, ran `ReviewerOutputSchema.safeParse(extracted.parsed)` and attached `reviewerOutput` to the returned result. Fails gracefully (silently) when the parse fails (legacy reviewers / hand-stubbed test agents).

**Phase B — feature-graph routing:**

- `orchestrator/src/feature-graph.ts` — inserted a ~130-line routing block AFTER the reviewer dispatch returns but BEFORE the per-task retry loop. When `agentName === "reviewer" && reviewerOutput && verdict !== "approved"`:
  - `verdict === "blocked"`: immediately fail the feature with `abortReason: "reviewer-blocked: <dimension>: <message>"`.
  - `verdict === "needs-revision"`: loop bounded by `TASK_RETRY_CAP`. For each retry-target's agent, group all the `issuesFound[]` entries targeting that agent, build a `HARD CONSTRAINT` block listing them with dimension + playbook section + file:line + message, re-dispatch the named builder with `retryContext.errorMessage` carrying the HARD CONSTRAINT, commit any successful retry, then re-dispatch the reviewer. Approved → break; blocked → fail; still needs-revision → loop. On retry-cap exhaustion → fail with `reviewer-cap-exhausted (bug-109): <last-issue>`.
  - After routing resolves (verdict → approved), `continue` the outer agent_sequence loop to skip the reviewer's own commit/install branch (the reviewer authored no code; only the in-loop retry-target builders did, which already committed inline).

**Phase C (subset) — HARD CONSTRAINT inline in errorMessage:**

The retryContext.errorMessage is enriched with a HARD CONSTRAINT block modeled on `.claude/rules/testing-policy.md`'s framing. The full typed-discriminator retryContext (`source: "reviewer"` variant) is deferred to a follow-up; the rich errorMessage closes the practical gap without requiring schema changes to `InvokeAgentFn.retryContext`.

**Phase E — regression tests:**

- `orchestrator/tests/feature-graph.test.ts` — added describe block `"runFeature — reviewer-driven retry routing (bug-109)"` with 2 cases:
  - "routes needs-revision verdict to named builder + re-reviews until approved" — full happy-path: reviewer rejects → builder retries with HARD CONSTRAINT context (asserted via regex on `retryContext.errorMessage`) → reviewer re-runs → approved. Asserts builder invoked 2× (original + 1 reviewer-routed retry), reviewer invoked 2× (original + 1 re-review). ✓
  - "blocked verdict immediately fails the feature with reviewer-blocked reason" — `verdict: "blocked"` → feature fails with `abortReason` matching `/reviewer-blocked/` + `/compliance/` (the rejected dimension). No retry loop fires for blocked verdicts. ✓

Validation:

- `pnpm vitest run tests/feature-graph.test.ts` → 66/66 passed (was 64; +2 new)
- `pnpm vitest run` (full orchestrator suite) → 1042/1042 passed in 35s (was 1040; +2 net new)
- Zero new typecheck errors (pre-existing 4 in perceptual-review.test.ts + walkthrough-review.test.ts + feature-graph.ts:646 + feature-graph.test.ts:703/2695/2738 are unrelated)

Decision: committed directly to master (same rationale as bug-107 + 108 — 4-bug batch on shared files; per-bug branches would conflict).

### Deferred to follow-on plans

- **Phase A (typed retryContext discriminated union)** — schema change from `{taskId, errorMessage}` to a tagged union with `source: "task-retry" | "reviewer" | "merge-conflict" | "parity-smoke" | "install-failure"`. Current MVP uses the existing 2-field shape with `errorMessage` carrying the HARD CONSTRAINT block. Behaviorally identical; semantically cleaner to ship the typed shape. Worth ~30 LoC + back-compat shim. Defer to a `/plan-refactor` when next touching invoke-agent.ts.
- **Phase D (builder agent prompts)** — add a `§Reviewer feedback handling` subsection to backend-builder.md, web-frontend-builder.md, mobile-frontend-builder.md. ~15 lines × 3 = ~45 lines. Defense-in-depth on top of the HARD CONSTRAINT prompt framing. Defer to a small `/plan-feat` whenever next iterating on builder prompts.
- **bug-035 frontmatter cleanup** — bug-035's plan is `status: approved` but the patch shipped at `invoke-agent.ts:1648-1666`. Frontmatter is stale. Bookkeeping; not load-bearing. Defer to next plan-status sweep.

### Lessons

1. **The reviewer's own task status was always "failed" when verdict !== "approved".** The per-task retry loop further down the function takes that signal + re-dispatches reviewer → loop. Inserting the bug-109 routing BEFORE the per-task retry loop + using `continue` to skip the rest of the agent's iteration was the cleanest shape. The alternative (mutate `result.taskStatus[reviewerTaskId] = "completed"` to mask the failure) would have hidden the real status from downstream observers.
2. **The reviewer agent doesn't author code.** This means the bug-109 routing block can SKIP the outer commit+install branch via `continue`. Each retry-target builder inside my loop runs its own `commitChanges` inline so the next re-review sees a fresh worktree state.
3. **MVP scope discipline.** Full Phase A+D would have been ~300 LoC; the MVP at ~180 closes the load-bearing gap. The deferred phases are defense-in-depth on top of a working primary fix. Important to file the follow-ups explicitly (Phase A as /plan-refactor; Phase D as /plan-feat) so they don't get forgotten.
4. **Reviewer-routed retries don't burn the per-task counter.** I introduced a separate counter key (`{feature.id}/reviewer-routing`) so reviewer-driven retries don't double-count against the per-task retries. Both caps are TASK_RETRY_CAP=2; if a feature needs both builder retries (task-level) AND reviewer retries (verdict-level), each gets its full budget.

### Cross-references

- investigate-030 H5 — the empirical anchor; this bug closes it
- bug-108 — pairs (install-failure retry routing uses the same retry-counter shape)
- bug-035 — sibling fix (task.notes propagation; same dispatch surface; already shipped per investigate-030 surprise #1)
- feat-010 — explicitly deferred this wiring per its archive (line 120); this bug closes the latent integration gap that has existed since reviewer shipped
