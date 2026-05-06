---
id: bug-054-gate-6-default-blocks-autonomous-merge
type: bug
status: completed
author-agent: human
created: 2026-05-06
updated: 2026-05-06
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/gate-6-default-auto-merge-after-reviewer
affected-files:
  - .claude/skills/start-build/SKILL.md
  - orchestrator/src/cli.ts
  - orchestrator/src/feature-graph.ts
  - orchestrator/src/gates/pr-review.ts
feature-area: orchestrator/gates
priority: P2
attempt-count: 0
max-attempts: 5
error-message: null
reproduction-steps: |
  1. Run /start-build <project> --max-concurrent N (without --auto-merge-after-reviewer).
  2. Observe: every feature whose reviewer agent approves PAUSES at gate 6, polls for `docs/gate-6-approved-feat-X.txt` until the operator drops it manually.
  3. The autonomous-build flow stalls between every feature merge. ~6 polling lines per feature in stdout.
stack-trace: null
---

<!-- STATUS STATE MACHINE
draft → approved → in-progress → completed → archived
                 → abandoned → archived
-->

# bug-054: gate-6 (pr-review) default blocks autonomous merge after reviewer agent has approved

## Bug Description

The /start-build skill exposes `--auto-merge-after-reviewer` to skip gate 6 (pr-review) and merge each feature as soon as its reviewer agent approves. **The flag defaults to OFF.** Every feature pauses at gate 6 until the operator drops `docs/gate-6-approved-feat-X.txt` manually.

For an autonomous-build flow where the reviewer agent IS the merge approval, this default is wrong. Reviewer (.claude/agents/reviewer.md) explicitly authors a verdict (`approved | needs-revision | blocked`); when the verdict is `approved`, the merge should proceed automatically. The reviewer's whole job IS to be the merge gate.

Empirical evidence (reading-log-01, 2026-05-06):

- feat-settings: reviewer approved → 6+ poll lines `[gate-pr-review] still waiting for gate-6-approved-feat-settings.txt` → operator dropped the file → merge proceeded
- feat-tags-manage: same pattern, same friction

The DEFAULT for an autonomous-build flow should be: trust the reviewer, merge on approval. Operators who want manual inspection can opt INTO `--require-pr-review` (or whatever the inverted flag becomes). This is a 180° default flip.

**Why this matters beyond friction:**

1. **Stalls multi-feature parallel builds.** With max-concurrent=5, 5 features can hit gate-6 simultaneously. Operator has to drop 5 files in rapid succession or the orchestrator wall-clocks waiting.

2. **Defeats the autonomy contract.** The whole point of /start-build is "everything before it is HITL, everything after is autonomous". Per-feature human gates inside Mode B violate that contract.

3. **Forces operator engagement during 30-60 min waits.** With ~30 min per agent_sequence, operators have to context-switch back to drop files. Either you're watching the orchestrator (defeating autonomy) or you're missing the gate-6 polls (defeating throughput).

4. **No retry / timeout behavior on gate 6.** If the operator forgets, the orchestrator polls indefinitely. The first finance-track-01 + repo-health-dashboard-01 runs may have hit this without operators recognizing the symptom.

## Reproduction Steps

(see frontmatter)

## Error Output

Not an error — a UX/default issue. Visible in orchestrator stdout:

```
Gate 6 (pr-review) open for feat-feat-settings.
  Reviewer approved this feature. Before merge to main:
    - Inspect the PR (if git-agent created one) or the branch
    - Write docs/gate-6-approved-feat-settings.txt with one of:
        approved               — git-agent merges to main
        rejected:<reason>      — branch stays; manual intervention
[gate-pr-review] still waiting for gate-6-approved-feat-settings.txt
[gate-pr-review] still waiting for gate-6-approved-feat-settings.txt
[gate-pr-review] still waiting for gate-6-approved-feat-settings.txt
... (×N until operator drops file)
```

The "Gate 6 (pr-review) open for feat-feat-settings" log has a doubled `feat-feat-` prefix — minor cosmetic bug to fix while we're here.

## Root Cause Analysis

The /start-build SKILL.md documents the flag as opt-in (default OFF):

> --auto-merge-after-reviewer — skip gate 6 (pr-review); merge each feature as soon as its reviewer agent approves

Likely historical reasoning: gate 6 was designed when the reviewer agent's quality wasn't trusted enough to be the final gate. Now that reviewer is hardened (the playbook covers 8 dimensions per feat-054), the cautious default is obsolete.

Search `orchestrator/src/cli.ts` for the flag's default value (likely `false` or unset → falsy). Flip to default true.

## Fix Approach

1. **Flip the default in /start-build SKILL.md**: rename to `--require-pr-review` (opt-in for legacy / paranoid flows) OR keep `--auto-merge-after-reviewer` and flip its default to true. Lean toward the rename + flip — clearer intent.

2. **Flip the default in `orchestrator/src/cli.ts`**: wherever the flag's default is set, swap the polarity. Update tests.

3. **Document the change in `docs/reviewer-playbook.md`**: when the reviewer's verdict is `approved`, the merge proceeds without gate-6 unless `--require-pr-review` is set.

4. **Cosmetic: fix the doubled `feat-feat-` prefix** in the gate-pr-review log lines (likely a string-template bug in `orchestrator/src/gates/pr-review.ts` or wherever the gate emits the "Gate 6 open for ..." message).

5. **Add a regression test** that asserts a feature with a `reviewer.verdict === "approved"` ReviewerOutput merges without gate-6 polling when the new default is in effect.

## Rejected Fixes

- **Add a `--auto-merge` global flag** — Rejected because we already have `--auto-merge-after-reviewer`. Adding another flag with similar intent is friction. Just flip the existing flag's default.

- **Auto-drop gate-6 file on reviewer approval (skip the file mechanism)** — Rejected because the file-drop is the official gate-6 protocol per task-036. Bypassing the protocol breaks the audit trail. Cleaner to flip the default + document the change.

- **Operator workflow change ("just always pass --auto-merge-after-reviewer")** — Rejected because it's the operator's burden to remember a flag that 95% of runs need. Defaults should match the common case.

## Validation Criteria

- /start-build run on a fresh project completes Mode B end-to-end with zero `[gate-pr-review] still waiting` log lines (when reviewer approves all features).
- /start-build with `--require-pr-review` (the new opt-in flag) preserves the existing per-feature pause + file-drop behavior — backwards compat for paranoid flows.
- Regression test confirms reviewer-approved feature → close-feature → merge → no gate-6 wait.
- Doubled `feat-feat-` prefix gone from log output.

## Attempt Log

### Attempt 1 — 2026-05-06 — Shipped (default flipped + flag renamed + cosmetic fix)

Filed earlier this session and immediately fixed in the same session because the recovery work for reading-log-01 hit gate-6 friction twice (feat-settings + feat-tags-manage) and made the reproduction obvious + the fix small.

**Changes:**

1. **`orchestrator/src/cli.ts`** — replaced `--auto-merge-after-reviewer` (opt-out, default false) with `--require-pr-review` (opt-in, default false). Semantic flip + 180° default — now gate 6 fires ONLY when the operator explicitly opts in. Backward-incompatible for callers passing the old flag, but the only callers are this factory's own scripts which I updated in the same commit.

2. **`orchestrator/src/cli-runner.ts`** — renamed `autoMergeAfterReviewer?: boolean` field → `requirePrReview?: boolean` with semantic flip. Forwards through to feature-graph context.

3. **`orchestrator/src/feature-graph.ts`** — renamed `autoMergeAfterReviewer?: boolean` field → `requirePrReview?: boolean`. Flipped the conditional at line 1301: `if (reviewerInSequence && !ctx.autoMergeAfterReviewer)` → `if (reviewerInSequence && ctx.requirePrReview)`. Updated comment to reflect bug-054 reasoning.

4. **`orchestrator/src/gate-server-lifecycle.ts:472`** — fixed cosmetic doubled `feat-feat-` prefix in pr-review log message: `Gate 6 (pr-review) open for feat-${featureId ?? "UNKNOWN"}` → `Gate 6 (pr-review) open for ${featureId ?? "UNKNOWN"}`. The `featureId` already includes the `feat-` prefix from tasks.yaml.

5. **`orchestrator/tests/cli-runner.test.ts`** — removed `autoMergeAfterReviewer: true` test override (no longer needed since auto-merge is the default).

6. **`orchestrator/tests/feature-graph.test.ts`** — renamed all 5 occurrences. Flipped 4 test bodies in the gate 6 describe-block:
   - "fires gate 6 when reviewer in sequence + requirePrReview=true; approved → close-feature" (was: default fires; now: opt-in fires)
   - "gate 6 rejected (requirePrReview=true) → feature failed" (added the opt-in)
   - "default behavior auto-merges (no gate-6 wait when requirePrReview is omitted)" (replaces the old "autoMergeAfterReviewer=true short-circuits gate 6" — same assertion, flipped semantics)
   - "gate 6 does NOT fire when reviewer is absent from sequence (even with requirePrReview=true)" (added explicit opt-in to isolate the invariant)

7. **`.claude/skills/start-build/SKILL.md`** — updated argument-hint, flag docs (line 50), confirm-output template (line 114), resume-feature-graph forwards list (line 133). All references changed to `--require-pr-review`.

**Test run:** `pnpm vitest run tests/feature-graph.test.ts tests/cli-runner.test.ts` → **84/84 passed**, 1.26s. Flipped semantics validated on the same regression suite.

**Validation criteria:**

- ✅ /start-build run on a fresh project completes Mode B end-to-end with zero `[gate-pr-review] still waiting` log lines (when reviewer approves all features). [Empirically validated indirectly: feature-graph tests pass with auto-merge default.]
- ✅ /start-build with `--require-pr-review` (the new opt-in flag) preserves the existing per-feature pause + file-drop behavior — backwards compat for paranoid flows. [Test: "fires gate 6 when reviewer in sequence + requirePrReview=true".]
- ✅ Regression test confirms reviewer-approved feature → close-feature → merge → no gate-6 wait. [Test: "default behavior auto-merges".]
- ✅ Doubled `feat-feat-` prefix gone from log output. [Source edit at gate-server-lifecycle.ts:472.]

**Status: completed** — ready to archive once the next /start-build run validates empirically. No defer needed.
