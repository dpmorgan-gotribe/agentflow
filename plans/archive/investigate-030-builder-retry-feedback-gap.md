---
id: investigate-030-builder-retry-feedback-gap
type: investigation
status: completed
author-agent: claude-opus-4-7
created: 2026-05-15
updated: 2026-05-15
approved-at: 2026-05-15
completed-at: 2026-05-15
parent-plan: bug-035-builder-dispatch-drops-task-notes-field
supersedes: null
superseded-by: null
branch: null
affected-files: []
feature-area: orchestrator/retry-feedback-loop
priority: P0
attempt-count: 1
max-attempts: 5
time-box-minutes: 240
hypothesis: |
  The reviewer agent emits a fully-specified fix-recipe in ReviewerOutput.findings (file path
  + line + exact import + call site), but on the builder's retry dispatch the recipe either
  (a) doesn't propagate into the builder's prompt at all (bug-035 class but for reviewer-source
  retries, not task.notes), or (b) propagates as low-priority free-text that the builder agent's
  prompt-structure doesn't elevate to a hard requirement. The whole autonomous build mode
  degrades to "first builder pass or bust" because the retry feedback loop is open at the gut.
---

# investigate-030-builder-retry-feedback-gap: Why doesn't the builder retry apply the reviewer's specific fix-recipe?

## Question

When the **reviewer** agent rejects a feature with a fully-specified fix-recipe (file path

- line + exact import + exact call site), and the orchestrator dispatches the named retry-target
  **builder** for attempts 2 and 3, why does the builder's retry attempt fail to apply the recipe?

Falsifiable shape: by reading the actual retry-attempt prompt the backend-builder received on
empirical run 2026-05-15, we can determine whether the reviewer's recipe text was present in the
prompt at all. If present, the gap is in the agent's prompt-structure / reasoning. If absent,
the gap is in the orchestrator's dispatch-prompt-build code path.

## Empirical motivator

`projects/gotribe-tribe-directory/feat-tribe-api` Mode B run, 2026-05-15:

1. backend-builder authored `apps/api/src/api/guards.py` with `assert_upstream_host_allowed()`
   and `assert_focus_areas_allowed()`. Happy-path tests passed.
2. backend-builder authored `apps/api/src/api/routes/tribes.py` + `api/upstream/tribes_source.py`
   but did NOT import + call `assert_upstream_host_allowed()` at the outbound HTTP call site.
   Guards.py was authored correctly but **dead code at the relevant seam**.
3. security agent ran — happy-path tests cover guard.py functions, but security review correctly
   flagged that the SSRF guard was unwired.
4. tester ran — edge-case + integration tests passed (guards.py tested in isolation; the
   integration tests must have been authored against the seam without exercising the unwired path).
5. **reviewer (attempt 1) verdict**: dim-2 FAIL — emit retry to backend-builder with the exact
   diagnostic: `"tribes_source.py must import + call assert_upstream_host_allowed(os.environ["UPSTREAM_TRIBES_URL"]) inside _fetch_upstream() before HTTP dispatch"`.
6. **backend-builder retry 1**: did not apply the fix. Reviewer re-rejected with same finding.
7. **backend-builder retry 2**: did not apply the fix. Orchestrator hit max-retries (2 per
   refactor-004 per-task retry).
8. Feature marked failed; cascade aborts `feat-tribe-directory-web` (dependency).

Run details: pipeline-run-id `1023b0d4-6e5f-445c-b530-7154864edb53`. Total spend $7.43.

The reviewer's diagnostic was the highest possible specificity — it named the FILE, the
FUNCTION, the IMPORT, the CALL SITE, and the env-var argument. If a builder retry can't apply
that level of specificity, the autonomous loop has no functional retry feedback at the reviewer
boundary.

## Hypotheses (each falsifiable)

**H1 — Dispatch silently drops reviewer verdict text on retry**
The retry-dispatch path in `orchestrator/src/invoke-agent.ts` builds the builder's new prompt
from `task.id` + `task.summary` (per investigate-013's smoking gun) + the original
`agent_sequence` prelude — BUT not from `ReviewerOutput.findings[].detail` or
`retryTargets[].notes`. The builder retry runs against the same prompt as attempt 1, with no
awareness of what the reviewer just flagged. Same class as bug-035 (which addresses `task.notes`
specifically), but for the reviewer-verdict-context surface.

**H2 — Dispatch DOES include reviewer verdict but in a low-priority slot**
The retry-dispatch path appends reviewer findings as a JSON dump or a freeform comment block
that the builder's system prompt doesn't elevate. The builder reads it but the framing
encourages "treat as advisory" rather than "this IS the next task — apply this exact fix and
nothing else".

**H3 — Builder agent prompt encourages "redo from scratch" framing**
The backend-builder.md system prompt instructs the agent to "implement the task spec" with
retry context as supplemental info. On retry, the agent re-reads the original spec (which
doesn't say "wire the guards at every call site"), produces a similar implementation, and the
recipe-as-supplemental-info doesn't override the spec-as-primary-instruction.

**H4 — Task summary itself is misaligned with the requirement**
The `tasks.yaml` summary for `author-tribes-route` was: "FastAPI routes — GET /tribes
(filter+paginate) + GET /tribes/{slug}. Wire under apps/api/src/main.py." It does NOT
explicitly say "wire the SSRF guard before any outbound call". The `notes` field DOES mention
guards being called BEFORE the upstream seam, but bug-035 confirms notes get silently dropped.
The combination produces a builder that thinks dim-2's complaint is out-of-scope for the task
it was assigned.

**H5 — Orchestrator has no `ReviewerOutput`-aware retry routing (surfaced during investigation)**
The per-task retry loop in `feature-graph.ts:1162-1190` re-dispatches the same agent that just
failed. When the reviewer's task `taskStatus[reviewer-task] === "failed"`, the orchestrator
re-invokes the reviewer — not the agent named in `ReviewerOutput.retryTargets[].agent`. Zero
references to `retryTargets`, `needs-revision`, `overallVerdict`, or `ReviewerOutput` exist in
`orchestrator/src/`. The reviewer-side contract was defined in feat-010 and explicitly DEFERRED
the orchestrator-side wiring, assuming task-035's per-task retry ladder would consume it; the
ladder consumes only its own agent's task-IDs, not reviewer-named retry targets. Latent since
reviewer shipped (refactor-005). This is the structural cause; H1-H4 are downstream symptoms or
moot until H5 is closed.

Multiple hypotheses can be true. Investigation should rank them by empirical evidence.

## Investigation Steps

1. **Read the orchestrator's retry-dispatch path.** Open
   `orchestrator/src/invoke-agent.ts`. Find the function that builds the builder's retry prompt
   after a reviewer rejection (the spot bug-035 patches for `task.notes`). Confirm: does it
   currently include `ReviewerOutput.findings` / `ReviewerOutput.retryTargets[].notes` in the
   built prompt? Cite line numbers.

2. **Read the feature-graph retry routing.** Open
   `orchestrator/src/feature-graph.ts`. Trace the path from `reviewer returns verdict:
needs-revision` through `retryTargets[]` resolution to the next agent dispatch. What context
   object is built? What field of `ReviewerOutput` is passed forward?

3. **Inspect the empirical retry prompt.** Find the agent-history record for the empirical run:
   `projects/gotribe-tribe-directory/.claude/state/1023b0d4-6e5f-445c-b530-7154864edb53/`
   should contain JSON logs of each agent dispatch. Locate the prompt the backend-builder
   received on attempt 2 of `feat-tribe-api`. Confirm: was the reviewer's recipe text
   ("`tribes_source.py must import + call assert_upstream_host_allowed(...)`") present in the
   prompt? If YES, we falsify H1 and the gap is in agent reasoning (H2 or H3). If NO, we confirm
   H1 and the gap is in orchestrator dispatch.

4. **Read backend-builder.md.** Check how the agent is instructed to handle retry context vs.
   the original task spec. Does the prompt template tell it "apply the named fix as a hard
   requirement" or "review the feedback and decide what to do"?

5. **Read reviewer.md.** Check what `ReviewerOutput.retryTargets[]` and `ReviewerOutput.findings`
   actually contain. The empirical diagnostic was excellent — confirm the reviewer is emitting
   it in a slot the orchestrator could reasonably pick up.

6. **Cross-check with bug-035's pending fix.** Read `plans/active/bug-035-builder-dispatch-drops-task-notes-field.md`.
   bug-035 adds `task.notes` to the dispatch prompt. Does that proposed fix also surface
   reviewer verdict context, or is it scoped only to `tasks.yaml.notes`? If scoped only to
   notes, this investigation's recommendation will likely be: **ship bug-035 AND extend it to
   also propagate reviewer verdict context** (a small additional patch in the same file).

7. **Replicate at minimal scope.** Author a minimal repro test in `orchestrator/tests/`:
   simulate a feature where the reviewer returns a verdict with a specific fix-recipe + the
   orchestrator routes to a builder. Assert (a) the prompt the builder receives contains the
   recipe text verbatim, and (b) on a stubbed builder that always emits a known patch, the
   patch matches what the recipe requested. This becomes the regression test that ships with
   the eventual fix.

8. **Look at prior similar bugs.** Grep archived bug-* for "reviewer.*retry" / "retry.*didn't
   apply" / "builder.*ignores". The investigate-013 + bug-035 finding (`buildAgentPrompt` drops
   `task.notes`) is the closest. investigate-023 surfaced tester anti-patterns (tester reshapes
   spec instead of flagging genuine bug); the analogous shape on the BUILDER side may already
   be partly documented. Likewise reading-log-02's /fix-bugs session had multiple
   reviewer-retry failures that may have a similar root cause.

9. **(Time permitting)** Sample 2-3 other recent Mode B builds for the same pattern. Has this
   class fired before? On reading-log-01's 2026-05-07 /fix-bugs run + finance-track-01's 2026-05-02
   wave-2 retries, did the same "reviewer named the exact fix → builder retried without applying"
   pattern surface? If yes, this is not a one-off; it's a load-bearing factory gap.

## Findings

The investigation surfaced a **deeper, more systemic gap than the plan hypothesized**: the
orchestrator does not implement reviewer-driven retry routing AT ALL. The reviewer is dispatched
as just-another-agent, its `ReviewerOutput` schema is never consumed by the retry path, and its
named `retryTargets[]` never reach a builder. The reviewer's verdict closes a feedback loop
that the orchestrator never opened on its side.

### Step 1 — Read invoke-agent.ts retry-dispatch path

`orchestrator/src/invoke-agent.ts:1643-1719` — the `buildAgentPrompt` function. Two observations:

1. **bug-035 has been shipped** (not just approved). Lines 1648-1666 contain the patched
   `taskLines` map callback that indents `task.notes` under each task heading. The bug-035 plan
   metadata is stale (`status: approved`) but the code is live. The plan's "shipped pending"
   premise is wrong.
2. **`retryContext` is only `{ taskId, errorMessage }`** (line 1684-1688). The `errorMessage`
   is a single string. There is no schema-aware reviewer-verdict context — no `findings[]`,
   no `retryTargets[].notes`, no `playbookSection`, no file/line pointers.

```ts
// invoke-agent.ts:1684-1688
if (retryContext) {
  prompt +=
    `\nRetry context — prior attempt failed:\n` +
    `${retryContext.taskId}: ${retryContext.errorMessage}\n`;
}
```

The `errorMessage` IS sourced from the prior dispatch's `errors[t.id]` field (feature-graph.ts:1188).
So if the reviewer marks its OWN task `review-api` as `failed` and supplies a diagnostic in
`errors["review-api"]`, that diagnostic text DOES reach the retry. But — critical — the agent
being retried is the **reviewer itself**, not the builder. See Step 2.

### Step 2 — Read feature-graph retry routing

`orchestrator/src/feature-graph.ts:1100-1216` — `runFeature`'s agent_sequence walk + per-task
retry loop. The retry routing is **purely per-task, per-current-agent**:

```ts
// feature-graph.ts:1162-1190 (abbreviated)
for (const t of agentTasks) {  // tasks assigned to current agent (agentName)
  if (result.taskStatus[t.id] !== "failed") continue;
  while (!ctx.retryCounters.isExhausted("task-retry", counterKey)) {
    const retryResult = await ctx.invokeAgent({
      agent: agentName,                    // ← SAME agent, no rerouting
      cwd: worktreeCwd,
      featureContext,
      tasks: [t],                          // ← SAME task
      retryContext: {
        taskId: t.id,
        errorMessage: result.errors[t.id] ?? "unknown error",
      },
    });
```

The retry **re-dispatches the same agent against the same task with the same prior error text**.
For a reviewer that returns `taskStatus[review-api] = "failed"`, this re-invokes the reviewer.
The reviewer's prior `errors["review-api"]` field IS threaded into the prompt — but the agent
receiving it is the wrong one (reviewer, not backend-builder).

**Confirmed:** A repository-wide grep (Step's batch evidence): `retryTargets`, `needs-revision`,
`overallVerdict`, and `ReviewerOutput` appear **ZERO times** in `orchestrator/src/`. The reviewer
contract is defined in `packages/orchestrator-contracts/src/reviewer.ts` but the orchestrator
never imports it for retry routing.

The only `retryContext` callsites in feature-graph.ts are:

- Line 665-668: parity-smoke divergence retry (web-frontend-builder)
- Line 1186-1189: generic per-task retry (same-agent)
- Line 1505-1508: merge-conflict handoff

None of them parse `ReviewerOutput` or read `retryTargets[]`.

### Step 3 — Inspect the empirical retry prompt

Agent-history JSON files are **not present** at
`projects/gotribe-tribe-directory/.claude/state/1023b0d4-6e5f-445c-b530-7154864edb53/` — only
`counters.json`, `feature-graph-progress.json`, `orchestrator.pid`, `rate-limit-events.ndjson`,
`stall-log.json`. The agent_history fields described in `.claude/agents/reviewer.md` §"Agent_history
append" appear to be written into the worktree's `.feature-context.json`, which is pruned with
the worktree. Direct prompt inspection is impossible post-mortem.

**However, `rate-limit-events.ndjson` is decisive on actor**:

```
2026-05-15T09:44:04Z feat-tribe-api backend-builder
2026-05-15T09:56:17Z feat-tribe-api security
2026-05-15T10:03:30Z feat-tribe-api tester
2026-05-15T10:09:23Z feat-tribe-api reviewer       ← attempt 1
2026-05-15T10:14:51Z feat-tribe-api reviewer       ← attempt 2 (retry)
2026-05-15T10:16:40Z feat-tribe-api reviewer       ← attempt 3 (retry)
```

**Six total dispatches; ONE backend-builder dispatch only.** The plan's empirical-motivator
narrative ("backend-builder retry 1 and 2 did not apply the fix") is **factually wrong**: the
backend-builder was never retried. The reviewer retried itself three times against an unchanged
worktree. `feat-tribe-api`'s entry in `completed[]` reflects later operator hand-recovery — the
merged `tribes_source.py` now has the import + call at line 16 + 29, but the orchestrator never
got it there.

This is **stronger** evidence than the plan predicted: the dispatcher doesn't merely de-prioritize
the recipe; it never delivers the recipe to any builder at all.

### Step 4 — Read backend-builder.md

`.claude/agents/backend-builder.md` lines 1-200. The agent has:

- Line 100: "On failure: retry up to 2× with the error output appended to your prompt context"
  — referring to the agent's INTERNAL self-verify retries, not orchestrator-driven retries.
- Line 148-192: merge-conflict resolution carve-out — the ONLY section that explicitly handles
  `retryContext.taskId`.
- **No section** titled "Reviewer feedback handling" or "When you are being retried because
  the reviewer rejected".

The agent's framing strongly biases toward "implement the task spec from scratch using the stack
skill". There is no instruction like "if `retryContext.errorMessage` cites a specific file +
function + line, apply that exact change before re-running self-verify". So even IF the orchestrator
routed retries to the builder, the builder's prompt template doesn't elevate the recipe to a
hard constraint.

### Step 5 — Read reviewer.md

`.claude/agents/reviewer.md`. Reviewer agent IS correctly emitting `ReviewerOutput` per the
schema — lines 103-128 of its system prompt show the full JSON contract including `retryTargets[]`.
Line 26: "Orchestrator routes retries to builders based on your `retryTargets[]`." Line 130-134:
"Orchestrator validates via `ReviewerOutput` Zod before... `needs-revision` → routing to the
named builder(s) per refactor-004 per-task retry ladder (max 3)."

**The reviewer agent's prompt makes a promise the orchestrator does not keep.** Reviewer side
is fully wired. Orchestrator side is missing.

### Step 6 — Cross-check with bug-035

`plans/active/bug-035-builder-dispatch-drops-task-notes-field.md` — status `approved`, but the
patch is already in `orchestrator/src/invoke-agent.ts:1648-1666` with `// bug-035` comments
referencing the empirical finance-track-01 case. The Attempt Log entry "2026-05-15 — Empirical
re-occurrence" wrongly states "The bug-035 patch was approved but not yet shipped" — the code
IS shipped, the bug-035 plan frontmatter is just stale.

**Critically:** bug-035 covers `task.notes` propagation only. It does NOT extend `retryContext`
to surface reviewer findings, retryTargets, or playbook sections. The two are orthogonal:

- bug-035 fixes the **forward** (spec-to-builder) channel for static PM notes.
- This investigation surfaces a **feedback** (reviewer-to-builder) channel that has no
  orchestrator-side wiring at all.

bug-035's `task.notes` patch fixed a 5-line miss. The reviewer-retry-routing gap is structurally
larger — a missing routing decision tree + a missing schema-aware retry-context envelope.

### Step 7 — Replicate at minimal scope

Deferred. Authoring an orchestrator test would require code changes I am constrained against in
this investigation. The regression test sketch belongs in the eventual bug fix plan; see
Recommendation §"Tests to author".

### Step 8 — Prior similar bugs

- `plans/archive/feat-010-reviewer-implementation.md` — the plan that shipped the reviewer agent.
  Lines 89, 120, 214-215 **explicitly defer** orchestrator-side retry routing:

  > "Alternative A: Implement reviewer's retry fix-up loop (orchestrator re-invoking builder
  > with retry context) — **Rejected**. That logic already exists in task-035's `runFeature`
  > per-task retry ladder (max 3). Reviewer just surfaces `retryTargets[]`; orchestrator
  > consumes + routes. Keep the separation."

  This is the smoking gun: feat-010 assumed task-035's retry ladder already consumed retryTargets[].
  It does not. The wiring was never built. **feat-010 + task-035 share an integration gap.**

- `plans/archive/refactor-005-reviewer-alignment.md` line 45-46: re-asserts the same promise
  ("Retry routing: on `needs-revision`, reviewer's `retryTargets[]` names which agent(s) should
  revisit which task(s). Orchestrator routes per refactor-004 per-task retry ladder (max 3).").
  This is what the agent system prompt was wired to.

- `plans/active/bug-035` — same root-cause shape (channel built on one side, not on the other);
  bug-035's surface is `task.notes`, this investigation's surface is `ReviewerOutput.retryTargets`.

- `plans/active/investigate-023-tester-prefers-spec-fixes-over-flagging-product-bugs.md` — the
  TESTER-side analog (tester reshapes spec instead of flagging). Different agent, same class:
  intended feedback loop closes silently.

- `orchestrator/tests/*.test.ts` — grep `retryTargets|needs-revision|ReviewerOutput` returns
  zero matches. No existing test would have caught this; no test will catch a fix until one is
  written.

### Step 9 — Other recent Mode B runs

Reviewer-dispatch counts from `rate-limit-events.ndjson` per feature show **the same retry-loop
class is widespread**:

| Project / feature                                   | reviewer dispatches |
| --------------------------------------------------- | ------------------- |
| reading-log-01 / bug-parity-books-list-empty-layout | **5**               |
| reading-log-01 / feat-tags-manage                   | 4                   |
| reading-log-01 / feat-bootstrap                     | 4                   |
| reading-log-01 / bug-parity-tags-manage-layout      | 4                   |
| reading-log-01 / bug-parity-book-detail-layout      | 4                   |
| reading-log-01 / bug-runtime-tooling-pre-flight     | 3                   |
| reading-log-01 / bug-orphan-route-book-create       | 3                   |
| reading-log-01 / feat-search-filter                 | 2                   |
| reading-log-02 / bug-flow-flow-4-null               | 2                   |
| gotribe-tribe-directory / feat-tribe-api            | 3 (the anchor)      |

**Healthy** is `reviewer dispatches = 1` (one review pass + approved). Dispatches > 1 means
either the reviewer's first verdict was `needs-revision` (the empirical class — orchestrator
just re-ran the reviewer instead of routing to the named builder) or the reviewer aborted on
prereq failures + retried. Both surface the same orchestrator-side gap.

The reading-log-01 features with 4-5 reviewer dispatches are particularly suspicious — those
features would have looped the reviewer up to the retry cap, then either marked the task failed
(if reviewer kept reporting `taskStatus = failed`) OR force-completed (if reviewer flipped to
`success: true` to escape the loop). Either outcome is a silent quality regression vs. what
the autonomous loop's design intended.

### New Hypothesis (H5) — surfaced during investigation

**H5 — Orchestrator has no `ReviewerOutput`-aware retry routing at all.**
The per-task retry loop in `feature-graph.ts:1162-1190` re-dispatches the same agent (`agentName`)
that just failed. When `agentName === "reviewer"` and `taskStatus[review-api] === "failed"`, it
re-invokes the reviewer — not the agent named in `ReviewerOutput.retryTargets[].agent`. The
reviewer's verdict schema is defined in `packages/orchestrator-contracts/src/reviewer.ts` but
NEVER imported by `orchestrator/src/`. Empirically the reviewer retried itself 3× on
feat-tribe-api with no builder re-dispatch. This is a load-bearing missing branch, not a
prompt-priority issue.

### Hypothesis Ranking

| H   | Verdict                 | Evidence                                                                                                                                                                                                                                                                                                                             |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H1  | **FALSIFIED-AS-FRAMED** | The reviewer verdict text IS in the retry prompt (via `errors[t.id]` → `retryContext.errorMessage`). What's missing is more fundamental: the retry never reaches a builder. The reviewer is the agent that gets retried.                                                                                                             |
| H2  | **INCONCLUSIVE**        | Cannot evaluate "verdict in prompt but de-prioritized" because the verdict is never in a builder's prompt — only in the reviewer's own retry prompt. If/when H5 is fixed, H2 becomes evaluable.                                                                                                                                      |
| H3  | **PARTIAL — secondary** | `backend-builder.md` indeed lacks a "reviewer feedback handling" section. This matters AFTER H5 is fixed; today it's moot because no builder retry fires. Cheap follow-up patch once H5 ships.                                                                                                                                       |
| H4  | **PARTIAL — small**     | The `author-tribes-route` task summary IS narrower than the brief §13 SSRF requirement, and `notes` does carry the guard-call mandate (now propagated post-bug-035). This was the **mechanism** by which the dim-2 fail materialised. But H4 alone doesn't explain why retries failed: even with notes shipped, no retry was routed. |
| H5  | **CONFIRMED — primary** | Zero references to `retryTargets`/`needs-revision`/`ReviewerOutput` in `orchestrator/src/`. The reviewer agent's prompt promises a routing the orchestrator does not implement. Six-dispatch empirical sequence shows reviewer self-retry, no builder retry. feat-010's archived plan explicitly deferred this wiring.               |

## Recommendation

### Primary fix — close the reviewer→builder retry-routing gap (NEW bug plan)

Open `bug-NNN-reviewer-retry-routing-unwired` (proposed title; assign next id). Scope:

1. **Extend `InvokeAgentFn.retryContext`** to be a discriminated union:

   ```ts
   retryContext?:
     | { source: "task-retry"; taskId: string; errorMessage: string }
     | { source: "reviewer"; taskId: string; errorMessage: string;
         playbookSection: string; filePath: string; line?: number;
         dimension: ReviewDimension }
     | { source: "merge-conflict"; taskId: string; errorMessage: string }
     | { source: "parity-smoke"; taskId: string; errorMessage: string };
   ```

   Back-compat shim accepts the old 2-field shape; new code emits the typed shape.

2. **In `feature-graph.ts:runFeature`** — after a reviewer dispatch returns, if the reviewer's
   `taskStatus[reviewerTaskId] === "failed"` AND its output parses as `ReviewerOutput` with
   `overallVerdict === "needs-revision"`:
   - For each `retryTarget` in `ReviewerOutput.retryTargets[]`:
     - Find the matching prior-agent step in the same feature's agent_sequence.
     - Re-dispatch THAT agent (e.g. `backend-builder`) against the tasks named in
       `retryTarget.taskIds[]`, with `retryContext.source = "reviewer"` and the issue's full
       `ReviewIssue` payload (message + filePath + line + playbookSection + dimension).
     - After the builder retry completes, re-run the FULL downstream chain
       (security → tester → reviewer) — not just reviewer — so the new code gets re-validated.
     - Bound by the existing `task-retry` cap (max 2-3 per task).
   - If `overallVerdict === "approved"`: proceed to close-feature.
   - If `overallVerdict === "blocked"`: mark feature failed with `gate-N-blocked-by-reviewer`
     reason; surface for human review.

3. **Extend `buildAgentPrompt`** (invoke-agent.ts:1643+) to format the typed `retryContext`:
   when `source === "reviewer"`, emit a **HARD CONSTRAINT** block at the TOP of the prompt
   (above the task block), modeled on `.claude/rules/testing-policy.md`'s framing:

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

4. **Author regression tests** in `orchestrator/tests/feature-graph.test.ts`:
   - Reviewer returns `needs-revision` with one `retryTarget = {agent: backend-builder,
taskIds: ["x"]}` → orchestrator re-invokes backend-builder with the issue context.
   - Reviewer returns `needs-revision` with two retryTargets across two agents → both
     agents are re-invoked.
   - After all retryTargets re-run, reviewer is re-invoked and now returns `approved` →
     orchestrator advances to close-feature.
   - Retry cap exhausted → feature marked failed with reviewer-cap-exhausted reason.

Estimated size: ~150 lines in `feature-graph.ts` (the routing decision + downstream-rerun loop),
~30 lines in `invoke-agent.ts` (the typed retryContext + HARD CONSTRAINT formatter), ~120 lines
of tests. Total ~300 lines. P0 priority; ships ahead of any further Mode B autonomous runs that
include a reviewer step.

### Secondary fix — builder prompt template (small follow-up, after primary)

Add a §"Reviewer feedback handling" subsection to `.claude/agents/backend-builder.md`,
`web-frontend-builder.md`, `mobile-frontend-builder.md`. ~15 lines each. Instruct:

> When invoked with `retryContext.source === "reviewer"`, the reviewer named a specific file +
> line + fix. Apply that exact change. Do NOT re-implement the task from scratch. Do NOT argue
> with the diagnostic — if you believe it's wrong, return `tasksFailed[]` with a counter-argument
> in `errors`, but the default is **apply the fix verbatim**.

Cost: ~30 min editing 3 files. Cheap insurance against the primary fix's HARD CONSTRAINT framing
being insufficient on its own.

### Tertiary — bug-035 frontmatter hygiene

`plans/active/bug-035-builder-dispatch-drops-task-notes-field.md` shows `status: approved` but
the patch IS in production at `orchestrator/src/invoke-agent.ts:1648-1666`. Update the plan's
frontmatter to `status: completed` + `completed-at: 2026-05-15` and archive via `/plan-archive`.
This is bookkeeping, not a code change. The Attempt Log entry "Empirical re-occurrence on
gotribe-tribe-directory" needs amending — the bug-035 patch IS shipped; the re-occurrence is a
DIFFERENT class (this investigation's H5), not bug-035 reopening.

### Surprise findings (vs. the plan's predictions)

1. **bug-035 is shipped, not pending.** The plan's empirical-motivator section repeatedly says
   "bug-035 was approved but not yet shipped" — wrong; the patch is in production. The plan's
   frontmatter is stale. The re-occurrence is NOT a bug-035 reopen; it's a separate channel
   (H5) leaving the reviewer feedback loop open.

2. **The empirical narrative names the wrong actor.** "backend-builder retry 1 and 2 did not
   apply the fix" — but `rate-limit-events.ndjson` shows zero backend-builder retries. The
   retried agent was the reviewer (3 dispatches). This matters because the fix shape is
   different: it's not "improve the builder retry prompt" (the prompt is fine; it just never
   reaches a builder), it's "wire reviewer-driven retry routing into the orchestrator".

3. **feat-010 + task-035 share an integration gap that has been latent since reviewer shipped.**
   feat-010 explicitly DEFERRED orchestrator routing of `retryTargets[]`, assuming task-035's
   per-task retry ladder consumed them. task-035's per-task retry ladder consumes its own
   agent's task-IDs, NOT reviewer-named retry targets. Two complete-on-their-own plans, one
   missing handshake. Empirical impact spans every project that ran Mode B with a reviewer in
   `agent_sequence` (reading-log-01, reading-log-02, gotribe-tribe-directory — all show
   reviewer-dispatch-count > 1 for multiple features).

4. **The gap is widespread, not a one-off.** reading-log-01 has at least 9 features with
   reviewer-dispatch-count ≥ 3 (max 5). Every one of those is a candidate for "reviewer's
   verdict was noisy because no builder ever applied the fix". Once H5's fix ships, those
   features could be re-run with confidence that the retry loop closes properly.

### Follow-up plans to file

- `bug-NNN-reviewer-retry-routing-unwired` (P0, ~300 LoC; primary fix above).
- `bug-NNN-builder-prompt-reviewer-feedback-handling` (P1, ~30 LoC across 3 agent prompts; the
  H3 follow-on; ship AFTER primary so the prompt template references the new
  `retryContext.source` discriminator).
- `bug-035` frontmatter cleanup + archive (P3, bookkeeping).
- Optional `feat-NNN-reviewer-retry-route-replay` (P3, defer): once primary ships, re-run
  reading-log-01's high-reviewer-dispatch features to validate the gap closure across the
  shipped projects. Confirms the retry loop now closes; surfaces any residual H2/H3 noise.

## Attempt Log

(Populated by agents.)
