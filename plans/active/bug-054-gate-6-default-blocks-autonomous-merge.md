---
id: bug-054-gate-6-default-blocks-autonomous-merge
type: bug
status: draft
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

<!-- Populated by agents during fix.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
-->
