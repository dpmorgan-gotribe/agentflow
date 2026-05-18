---
id: bug-121-builder-prompt-reviewer-feedback-handling
type: bug
status: approved
author-agent: human
created: 2026-05-18
updated: 2026-05-18
approved-at: 2026-05-18
parent-plan: bug-109-reviewer-retry-routing-unwired
supersedes: null
superseded-by: null
branch: fix/builder-prompt-reviewer-feedback-handling
affected-files:
  - .claude/agents/backend-builder.md
  - .claude/agents/web-frontend-builder.md
  - .claude/agents/mobile-frontend-builder.md
feature-area: orchestrator/retry-feedback-loop
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "bug-109 routed reviewer-driven retry to web-frontend-builder correctly, but the builder dispatched without applying the named fix. Empirical: gotribe-member-profile feat-member-read 2026-05-16 — reviewer flagged data-screen-id missing on apps/web/app/members/[id]/page.tsx lines 134+264, retry target = web-frontend-builder, builder retry returned with 'no new commits since original builder run'. The HARD CONSTRAINT block in retryContext.errorMessage reached the agent but the agent's system prompt biases toward 're-implement task from spec' rather than 'apply the named fix verbatim'."
reproduction-steps: |
  1. Any Mode B feature where the reviewer rejects with a precise fix-recipe (file + line + change).
  2. Orchestrator (post-bug-109) routes the retry to the named builder via retryTargets[].
  3. Builder dispatches, reads the HARD CONSTRAINT block in retryContext.errorMessage.
  4. Builder produces no commits OR the same incomplete implementation; reviewer re-rejects.
  Empirical: gotribe-member-profile feat-member-read tester+reviewer flagged data-screen-id missing
  on detail page; web-frontend-builder retry "fix was never applied".
stack-trace: null
---

# bug-121: Builder system prompts lack a §"Reviewer feedback handling" section — retry dispatches don't apply the HARD CONSTRAINT fix verbatim

## Bug Description

bug-109 (shipped 2026-05-15) wired reviewer-driven retry routing into the orchestrator. When the reviewer returns `overallVerdict: "needs-revision"` with `retryTargets[]`, the orchestrator dispatches the named builder with a HARD CONSTRAINT block formatted into `retryContext.errorMessage`:

```
HARD CONSTRAINT — REVIEWER REJECTED A PRIOR ATTEMPT
The reviewer flagged the following issue(s) on this feature:
  - [<dimension> / <playbookSection>] <filePath>:<line> — <message>
You MUST apply these exact fixes. Do not re-implement from
the task spec — extend the existing implementation with the
named changes. Run lint+typecheck+test, then report completed.
```

**The block reaches the agent's prompt.** Confirmed by reading `orchestrator/src/feature-graph.ts:1297-1316` (the bug-109 routing branch). The HARD CONSTRAINT text is the `errorMessage` argument to `invokeAgent`, which gets formatted into the agent's prompt via `buildAgentPrompt` in `invoke-agent.ts:1743-1746`.

**But the builder system prompts don't tell the agent how to handle this scenario.** `.claude/agents/backend-builder.md`, `web-frontend-builder.md`, `mobile-frontend-builder.md` instruct the agent to "implement the task spec from scratch using the stack skill" with retry context as supplemental info. There is no instruction like "if the retry context contains a HARD CONSTRAINT block from the reviewer, apply that exact change as the FIRST action, do NOT re-implement the task from scratch".

The agent's default framing ("implement the spec") wins over the HARD CONSTRAINT's "apply this exact change" because the spec is the agent's primary task surface and the HARD CONSTRAINT is hidden in `retryContext.errorMessage` — a slot named for a "prior attempt failed" advisory, not a "your new task is to apply this change" hard task swap.

Empirical case (2026-05-16 gotribe-member-profile feat-member-read):

- Reviewer rejected: `apps/web/app/members/[id]/page.tsx` lines 134 + 264 missing `data-screen-id="member-detail"`. E2E `flow-1-browse-members.spec.ts:62` asserts the locator.
- `retryTargets: [{agent: "web-frontend-builder", taskIds: [...]}]`
- bug-109 routed the retry to web-frontend-builder with the HARD CONSTRAINT block.
- Builder dispatched. **Returned with no new commits — fix was never applied.**
- Reviewer re-rejected (same finding). Task marked failed after 2 attempts. Cascade-failed feat-member-create, feat-member-edit, feat-member-delete.

This is investigate-030's H3 (builder agent prompt encourages "redo from scratch") + investigate-030's §"Secondary fix" recommendation, which was approved but not shipped at the time bug-109 landed.

## Reproduction Steps

1. Any Mode B feature where the reviewer can plausibly reject the first builder output.
2. Orchestrator's bug-109 routing dispatches a retry to the named builder.
3. Observe: builder's reasoning trace re-reads the task spec; the HARD CONSTRAINT is mentioned but not elevated to the agent's primary instruction.
4. Builder produces either no diff OR the same incomplete code.

## Error Output

Yesterday's orchestrator stdout (gotribe-member-profile retry, run-id `1aa1a69e-661e-4c40-992d-995317608d44`):

```
✗ feat-member-read — task member-read-review failed after 2 attempts:
  Genuine product bug (unresolved after builder retry):
  apps/web/app/members/[id]/page.tsx lines 134+264 — both <AppShell>
  usages missing data-screen-id="member-detail".
  E2E flow-1-browse-members.spec.ts:62 asserts this locator.
  No new commits since original builder run — fix was never applied.
  retryTargets: [web-frontend-builder]
```

The "No new commits since original builder run — fix was never applied" diagnostic is bug-121's exact fingerprint: bug-109 routed correctly; builder failed to act.

## Root Cause Analysis

`.claude/agents/backend-builder.md` (and web/mobile siblings):

- Line ~100: "On failure: retry up to 2× with the error output appended to your prompt context" — refers to the agent's INTERNAL self-verify retries, NOT orchestrator-driven retries from a reviewer rejection.
- Line ~148-192: merge-conflict resolution carve-out — the ONLY section that explicitly handles `retryContext.taskId` framing.
- **No section** titled "Reviewer feedback handling" or "When you are being retried because the reviewer rejected a prior attempt".

The agent reads `retryContext.errorMessage` as advisory info (per the merge-conflict precedent), not as a task-replacement directive. The HARD CONSTRAINT framing prefixed by bug-109 helps but is undermined by the agent's system prompt encouraging "re-attempt the original task with this context in mind".

## Fix Approach

### Phase A — add §"Reviewer feedback handling" to 3 builder system prompts (~30 lines × 3 files)

Add the following section to `.claude/agents/backend-builder.md`, `web-frontend-builder.md`, and `mobile-frontend-builder.md`. Place it after the existing "Output discipline" / "Self-verify" section and before "Merge conflict resolution":

```markdown
## Reviewer feedback handling (HARD CONSTRAINT retry)

When you are dispatched via orchestrator retry AND `retryContext.errorMessage` contains a `HARD CONSTRAINT — REVIEWER REJECTED A PRIOR ATTEMPT` block, your task is **NOT** to re-implement the original task spec from scratch. It is to apply the named fix(es) verbatim.

**Algorithm**:

1. **Read the HARD CONSTRAINT block first.** Parse the file path, line, dimension, playbook section, and message. The reviewer's diagnostic is the canonical specification of what needs to change.
2. **Read the existing file** at the named `filePath`. The current implementation is mostly correct — the prior builder pass authored it, the tester wrote tests against it, and only the reviewer flagged a specific gap.
3. **Apply the named change at the named line.** Do NOT rewrite the file. Do NOT re-implement the task spec. The reviewer named a precise, surgical fix; ship the surgical fix.
4. **Run lint + typecheck + your self-verify tests.** Confirm the fix didn't break what the prior pass got right.
5. **Report completed** with the surgical-diff commit in the worktree.

**Anti-patterns** (any of these counts as a failed retry — the orchestrator's bug-109 routing will mark the task failed if you do this):

- Re-implementing the original task spec from scratch and hoping the reviewer's complaint resolves.
- Reading the HARD CONSTRAINT but choosing to address a "deeper" issue instead.
- Arguing with the reviewer's diagnostic in `errors[t.id]` without first applying the fix. (If you genuinely believe the diagnostic is wrong, apply the fix anyway AND add your counter-argument to `errors[t.id]` so the next reviewer pass sees both signals.)
- Returning `taskStatus: completed` with no commits in the worktree. The orchestrator detects this and re-marks as failed.

**When the HARD CONSTRAINT block is absent** (i.e. `retryContext` is from `task-retry` source, not reviewer-source), the original "implement the task spec" framing applies. Reviewer-source retries are the discriminator — they carry the HARD CONSTRAINT prefix verbatim.

### Why this matters

The bug-109 reviewer-driven retry routing depends on builders honoring the HARD CONSTRAINT. Without this section, the builder defaults to "redo from scratch" framing and the retry produces no diff. Empirical: gotribe-member-profile 2026-05-16 — bug-109 routed correctly but builder didn't apply the fix; feature failed.
```

### Phase B — regression test (deferred; agent-prompt behavior is hard to assert mechanically)

A unit test asserting the system prompt contains the section is trivial but low-leverage. The empirical-confirmation path is: re-run a project that hit bug-121 yesterday + observe the builder retry now applies the fix on the first try. Defer to the eventual gotribe-member-profile re-launch.

## Rejected Fixes

- **Move HARD CONSTRAINT formatting out of `retryContext.errorMessage` into a dedicated top-of-prompt block** — Considered. Would require extending the InvokeAgent contract with a new field (e.g. `hardConstraintBlock?: string`) + plumbing through `buildAgentPrompt`. Higher coordination cost. Rejected for now; revisit if Phase A's system-prompt approach proves insufficient after 2-3 empirical re-runs.
- **Add per-agent test asserting "HARD CONSTRAINT" string is preserved in dispatch** — Already partly covered by bug-109's test suite. The gap is on the AGENT side (how it interprets the constraint), not the dispatch side (how it routes the message). Unit tests can't capture agent reasoning.
- **Build a "constraint-applier" sub-tool the builder agent calls when it sees HARD CONSTRAINT** — Over-engineered for an MVP fix. The system-prompt instruction is the cheapest intervention with the highest leverage; if it fails empirically, escalate to tooling.

## Validation Criteria

- [ ] `.claude/agents/backend-builder.md` has §"Reviewer feedback handling (HARD CONSTRAINT retry)" with the 5-step algorithm + anti-patterns.
- [ ] Same section present in `.claude/agents/web-frontend-builder.md` and `.claude/agents/mobile-frontend-builder.md` (byte-stable copy across the three files for consistency).
- [ ] Empirical (deferred): gotribe-member-profile re-launch → feat-member-read's reviewer-flagged data-screen-id miss is corrected on the FIRST builder retry, no further cascade.

## Cross-references

- **Parent**: `plans/archive/bug-109-reviewer-retry-routing-unwired.md` — the bug that wired reviewer-driven retry routing in the orchestrator. bug-121 closes the agent-side gap that bug-109's primary fix doesn't address.
- **Grandparent**: `plans/active/investigate-030-builder-retry-feedback-gap.md` §"Secondary fix" — the investigation explicitly called out this fix as the follow-on to bug-109's primary. Acceptance criteria for investigate-030 includes this fix shipping.
- **Empirical case**: gotribe-member-profile Mode B 2026-05-16, run-id `1aa1a69e-661e-4c40-992d-995317608d44`. Reviewer flagged data-screen-id missing on member-detail; bug-109 routed retry to web-frontend-builder; builder dispatched without committing any change. Operator hand-applied the fix to unblock; the autonomous loop never closed.

## Attempt Log

<!-- populated as the fix is made -->
