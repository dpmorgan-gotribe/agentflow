---
id: feat-062-pure-verify-mode-for-cheap-classes
type: feature
status: draft
author-agent: human
created: 2026-05-06
updated: 2026-05-06
parent-plan: investigate-020-fix-bugs-loop-architecture-tester-reviewer-economics
supersedes: null
superseded-by: null
branch: feat/pure-verify-mode-for-cheap-classes
affected-files:
  - scripts/file-bug-plan.mjs
  - orchestrator/src/fix-bugs-loop.ts
  - orchestrator/tests/fix-bugs-loop.test.ts
  - orchestrator/tests/file-bug-plan-parity.test.ts
feature-area: orchestrator/fix-bugs-loop
priority: P1
attempt-count: 0
max-attempts: 5
---

# feat-062: Pure-verify mode for cheap bug classes (no per-bug tester, no per-bug reviewer)

## Problem

Per-bug tester+reviewer dispatch consumes 50-70% of bug-fix wall-
clock for cheap classes (compile/runtime/orphan/visual-parity)
where the bug-fix loop's verify→fix→verify cycle ALREADY catches
incorrect fixes on the next iteration. At 100+ bugs in a mature
project this becomes 5-10+ hours of redundant work per iteration.

Empirical (investigate-020 Step 4 partial): visual-parity tester
flagged a markup placement issue that the next parity-verify pass
would have re-detected — tester added zero unique information.
Reviewer for cheap classes similarly redundant when the fix is
plumbing-level (not feature work).

## Goals

1. Drop tester+reviewer entirely for cheap bug classes
   (compile, runtime, reachability-orphan, visual-parity).
2. Preserve safety via a single LOOP-EXIT tester+reviewer pass
   on the fixup branch — catches regressions before declaring
   `clean`.
3. Keep full 3-agent sequence for feature-class bugs (build-gap,
   seed-setup, flow-execution-failure).
4. Compose multiplicatively with feat-058 (sequence trim already
   landed) + feat-061 (class-batched-dispatch already landed).

## Non-goals

- Modify what the verifier checks (orthogonal — verifier is the
  source of truth).
- Skip tester+reviewer in /start-build feature mode (not in scope;
  per-feature work justifies per-feature test+review).
- Replace the fail-after-3-flaps detector (already correct).

## Pre-requisites — empirical validation BEFORE ship

investigate-020 Step 4 needs concrete data on tester-redundancy
PER bug class. Before this feat ships, run:

```
git log --oneline | grep -i 'tester\|reviewer' on shipped projects
```

Cross-reference: how often does tester flag a `genuineProductBug`
that the next verify pass WOULDN'T have caught? Per class:

| Class                  | Sample size | Tester unique-value rate |
| ---------------------- | ----------- | ------------------------ |
| dev-server-compile     | TBD         | TBD                      |
| runtime-error          | TBD         | TBD                      |
| reachability-orphan    | TBD         | TBD                      |
| visual-parity          | TBD         | TBD                      |
| flow-execution-failure | TBD         | TBD                      |
| build-gap              | TBD         | TBD                      |

Threshold for ship: <5% unique-value rate for the class → drop
tester. For reviewer: same threshold on "rejected for reasons
unrelated to structural correctness".

## Proposed implementation

### Phase A — Pure-verify routing (45min)

`scripts/file-bug-plan.mjs::defaultAgentSequence` switch updates:

```js
case "dev-server-compile":     return [tier];                    // already 1 agent (feat-058)
case "runtime-error":          return [tier];                    // was [tier, reviewer]; now 1
case "visual-parity":          return [tier];                    // was [tier, reviewer]; now 1
case "reachability-orphan":    return [tier];                    // (handled at call-site for orphan-*)
case "seed-setup":             return ["backend-builder", "tester", "reviewer"];  // KEEP
case "manifest-author":        return [];                        // KEEP
case "build-gap":
case "flow-execution-failure":
default:                       return [tier, "tester", "reviewer"];  // KEEP
```

The orphan + parity-divergence remap at the call-site stays the
same — they synthesize `primaryCause: "visual-parity"` which now
returns `[tier]` only.

### Phase B — Loop-exit tester+reviewer pass (1h)

In `orchestrator/src/fix-bugs-loop.ts::runFixBugsLoop`, when
status flips to `clean` (line ~1450 area), dispatch ONE
`[tester, reviewer]` against the fixup-branch HEAD before
declaring done. If either rejects:

- Re-open the loop for one more iteration with reviewer/tester
  context as `retryContext.errorMessage`
- Failures here block `clean` status — surface them as bugs with
  `source: loop-exit-validation`

```ts
// in runFixBugsLoop, post-iteration loop, before final return
if (status === "clean" && !ctx.skipLoopExitValidation) {
  const validation = await runLoopExitValidation({
    ctx,
    fixupBranch,
    fixupWorktreePath: worktreePath,
  });
  if (!validation.ok) {
    // ... append validation.bugs to doc.bugs, write yaml,
    //     re-enter loop for one final iteration
  }
}
```

### Phase C — Tests (45min)

1. defaultAgentSequence test updates: assert each cheap class
   returns `[tier]` only (1 agent).
2. Loop-exit validation: mock 1 verifier-pass + 1 builder fix
   merging cleanly + 1 loop-exit tester rejection → loop iterates
   once more.
3. Loop-exit validation: same setup but tester passes → loop
   declares clean.
4. `--skip-loop-exit-validation` opt-out flag (for projects with
   no test suite).

### Phase D — Rollout

- Default ON for new /fix-bugs runs
- Operators can opt OUT via `FIX_BUGS_PURE_VERIFY=0` env var
- Document in /fix-bugs SKILL.md as the new model
- After 30-day soak: archive feat-062 + remove the env override

## Validation Criteria

1. All cheap bug classes dispatch as 1 agent (vs prior 1-3).
2. Loop-exit validation pass correctly catches regressions
   (Phase C tests).
3. Empirical: re-fire /fix-bugs against reading-log-01 — bug
   completion wall-clock 50-70% lower than feat-061-only baseline.
4. No regression on feature-class bugs.

## Composition with the rest of the stack

- **bug-055** Phase B (empty-merge guard): still catches builder
  silent-success
- **feat-058** (per-cause sequence trim): now overridden for cheap
  classes (was `[tier, reviewer]` for visual-parity; now `[tier]`)
- **bug-056** (tier inference): unaffected — still picks the
  right builder
- **bug-057** (stderr context): more important than ever —
  builder is the ONLY agent, needs full context
- **bug-058** (fixup-master sync): unaffected
- **bug-059** (event-loop clamp): unaffected, but pure-verify
  reduces concurrent agent count, easing pressure further
- **feat-061** (class-batched ON): composes — group-level dispatch
  becomes 1 builder for N bugs (no group-level tester/reviewer
  needed at all — loop-exit validation covers the group)

## Rejected fixes

- **Drop tester+reviewer entirely (no loop-exit pass)** —
  Rejected: loses regression coverage. Loop-exit pass is the
  cheap insurance.
- **Drop reviewer only, keep tester per-bug** — Rejected: reviewer
  is the cheaper agent of the two (~3-10min vs tester's 5-15min).
  Better economics keeping reviewer at exit.
- **Drop tester only, keep reviewer per-bug** — Rejected: similar
  reasoning. Both hit zero unique-value for cheap classes.

## Attempt Log

(empty — plan filed by human 2026-05-06; ship deferred pending
investigate-020 Step 4 empirical validation against ≥3 shipped
projects' tester/reviewer event logs.)
