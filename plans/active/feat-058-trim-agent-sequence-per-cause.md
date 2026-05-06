---
id: feat-058-trim-agent-sequence-per-cause
type: feature
status: completed
author-agent: human
attempt-count: 1
created: 2026-05-06
updated: 2026-05-06
parent-plan: investigate-018-fix-bugs-dispatch-latency
supersedes: null
superseded-by: null
branch: feat/trim-agent-sequence-per-cause
affected-files:
  - scripts/file-bug-plan.mjs
  - orchestrator/src/fix-bugs-loop.ts
  - orchestrator/tests/fix-bugs-loop.test.ts
feature-area: orchestrator/fix-bugs-loop + verifier/file-bug-plan
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-058: Trim agentSequence per primaryCause for cheap bug classes

## Problem

`scripts/file-bug-plan.mjs:730-740` defaults every bug class to a
3-agent sequence `[builder, tester, reviewer]`. For cheap bug classes
(dev-server-compile, reachability-orphan, visual-parity), tester +
reviewer add ~10-20min wall-clock per dispatch without catching what
the loop's re-verify already catches. Empirical anchor: reading-log-01
2026-05-06 single-bug dispatches taking ~20-30min for plumbing fixes
the user expected to be 3-5min quick wins.

Parent investigation: `investigate-018-fix-bugs-dispatch-latency`.
This plan implements the agent-sequence trim from Step 4 of that plan.

## Goals

1. Cut dispatch wall-clock by 2-3x on cheap bug classes.
2. Preserve safety: every fix still gets validated before close
   (re-verify pass for cheap classes; tester for feature-class fixes).
3. Zero regression for feature-class bugs (build-gap, seed-setup,
   flow-execution-failure) — those keep the full 3-agent sequence.

## Non-goals

- Agent-shape changes (Option Z bugFixMode prompt prefix) — deferred
  to feat-059 (conditional on empirical data).
- Tier routing (web-frontend-builder vs backend-builder) — bug-056's
  lane.
- Prompt warmup pooling — feat-060's lane (conditional).
- New bug classes — out of scope.

## Mapping table (from investigate-018 Step 4)

| primaryCause                  | Current sequence                          | New sequence                          | Rationale                                                         |
| ----------------------------- | ----------------------------------------- | ------------------------------------- | ----------------------------------------------------------------- |
| `dev-server-compile`          | `[<builder>, tester, reviewer]`           | `[<builder>]`                         | Re-verify IS the test (does dev-server boot?); reviewer adds 0    |
| `runtime-error`               | `[<builder>, tester, reviewer]`           | `[<builder>, reviewer]`               | Re-verify catches the runtime failure; reviewer kept for semantic |
| `reachability-orphan`         | `[<builder>, tester, reviewer]`           | `[<builder>, reviewer]`               | Wiring fix verified by re-verify; reviewer kept                   |
| `visual-parity`               | `[<builder>, tester, reviewer]`           | `[<builder>, reviewer]`               | Parity-verify is the structural check; tester redundant           |
| `flow-execution-failure`      | `[<builder>, tester, reviewer]` (KEEP)    | `[<builder>, tester, reviewer]`       | Real flow work; full safety net                                   |
| `seed-setup`                  | `[backend-builder, tester, reviewer]`     | `[backend-builder, tester, reviewer]` | Real backend work; full safety net                                |
| `build-gap`                   | `[<builder>, tester, reviewer]` (KEEP)    | `[<builder>, tester, reviewer]`       | Real feature work surfaced post-build                             |
| `manifest-author`             | `[]`                                      | `[]`                                  | Already routed to operator review                                 |
| `step-transition` / `unknown` | `[<builder>, tester, reviewer]` (default) | `[<builder>, tester, reviewer]`       | Conservative — full sequence until classified                     |

`<builder>` = whatever tier bug-056 routes to (or current default
`web-frontend-builder` if bug-056 hasn't shipped yet).

## Phases

### Phase A — Update `defaultAgentSequence` (1h)

`scripts/file-bug-plan.mjs:702-740`:

- Extend the switch statement to return the trimmed sequences from
  the mapping table.
- Add a `tier` parameter (default `web-frontend-builder` for
  pre-bug-056) so feat-058 can ship before bug-056 without rework
  when bug-056 lands.
- Comment block documents which classes are "cheap" (no tester) vs
  "real work" (tester required).

```js
function defaultAgentSequence(violation, tier = "web-frontend-builder") {
  const cause = violation && violation.primaryCause;
  switch (cause) {
    // Cheap classes: re-verify is the test; reviewer adds 0 on plumbing.
    case "dev-server-compile":
      return [tier];
    // Cheap classes with semantic risk: drop tester, keep reviewer.
    case "runtime-error":
    case "visual-parity":
      return [tier, "reviewer"];
    // Real backend work: full safety net (already correctly routed pre-058).
    case "seed-setup":
      return ["backend-builder", "tester", "reviewer"];
    // Operator-review-only — out-of-band fix.
    case "manifest-author":
      return [];
    // Real feature work: full safety net.
    case "build-gap":
    case "flow-execution-failure":
    default:
      return [tier, "tester", "reviewer"];
  }
}
```

Also: `reachability-orphan` violations come from the reachability
analyzer (not the flow runner) — they don't have `primaryCause`. The
existing `default` branch catches them with the full 3-agent
sequence. **Add explicit handling at the call-site in
`buildBugEntry`** so reachability-orphan gets `[tier, "reviewer"]`
(no tester) since orphans are wiring fixes that re-verify catches.

### Phase B — Tests (1h)

`orchestrator/tests/file-bug-plan.test.ts` (or wherever
defaultAgentSequence's tests live — confirm path):

- Each `primaryCause` value → expected sequence
- `tier` parameter override works (default web; explicit backend)
- Reachability-orphan path returns `[<tier>, reviewer]`
- Backwards compat: `null` / `undefined` cause returns the default
  3-agent sequence

### Phase C — Empirical re-validation (30min)

After ship, re-run /fix-bugs reading-log-01 (or another project
with mixed bug classes) and compare per-bug wall-clock against the
b3zwmyp7a baseline:

| Bug class           | Pre-058 wall-clock | Post-058 expected  | Post-058 actual |
| ------------------- | ------------------ | ------------------ | --------------- |
| dev-server-compile  | ~30min             | ~10min             | TBD             |
| runtime-error       | ~30min             | ~20min             | TBD             |
| reachability-orphan | ~30min             | ~20min             | TBD             |
| visual-parity       | ~30min             | ~20min             | TBD             |
| flow-execution      | ~30min             | ~30min (unchanged) | TBD             |

Capture timing into a benchmarks doc for future tuning. If actual
post-058 wall-clock matches expected within ±15%, ship is validated.
If not, file follow-up: which agents are NOT taking the predicted time.

## Validation criteria

1. All existing `file-bug-plan` tests pass (no regression).
2. New tests cover every `primaryCause` value + the `tier` param.
3. Phase C empirical run shows ≥40% wall-clock reduction on cheap
   bug classes.
4. Zero regression on feature-class bugs (full 3-agent sequence
   preserved).

## Dependencies / sequencing

- **Independent of bug-056** (cause-routing): feat-058 ships with
  default `tier="web-frontend-builder"`; bug-056 layers the tier
  selection on top.
- **Independent of bug-057** (stderr enrichment): feat-058 trims the
  sequence regardless of how rich the bug.summary is.
- **Independent of feat-059** (bugFixMode prompt prefix): feat-058
  reduces the NUMBER of agent invocations; feat-059 would reduce
  the COST per invocation; they compose multiplicatively if both
  ship.

Recommended ship order: feat-058 first (biggest wall-clock win,
zero new agent surface), then bug-056 + bug-057 in either order,
then feat-059 conditional on empirical data.

## Attempt Log

(empty — plan filed by human 2026-05-06)
