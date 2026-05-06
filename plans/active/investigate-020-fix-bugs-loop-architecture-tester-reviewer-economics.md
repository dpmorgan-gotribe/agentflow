---
id: investigate-020-fix-bugs-loop-architecture-tester-reviewer-economics
type: investigation
status: in-progress
author-agent: human
attempt-count: 1
created: 2026-05-06
updated: 2026-05-06
parent-plan: null
supersedes: null
superseded-by: null
branch: null
affected-files:
  - orchestrator/src/fix-bugs-loop.ts
  - scripts/file-bug-plan.mjs
  - .claude/agents/tester.md
  - .claude/agents/reviewer.md
feature-area: orchestrator/fix-bugs-loop
priority: P1
attempt-count: 0
max-attempts: 5
time-box-minutes: 90
hypothesis: |
  The bug-fix loop's verify→fix→verify cycle ALREADY provides
  structural integration testing — if a bug isn't fully fixed, the
  verifier re-surfaces it in the next iteration (or surfaces a
  derivative bug). This makes per-bug tester+reviewer dispatch
  largely redundant for bug-fix mode (vs feature-build mode where
  per-feature tester+reviewer is load-bearing). At 15-25 min wall-
  clock per bug × 100+ bugs in a real project, the current
  per-bug-tester+reviewer model becomes a 25-40 hour bottleneck
  per /fix-bugs run. Scale forces a different architecture:
  group-level testing OR pure-verify mode.
---

# investigate-020: Is per-bug tester+reviewer the right architecture for /fix-bugs at scale?

## Question

Empirical (reading-log-01 today): per-bug dispatch wall-clock is
~15-25 min EVEN AFTER the full investigate-018+019 stack landed
(feat-058 sequence trim + bug-056 tier routing + bug-057 stderr
context + bug-058 fixup-master sync + bug-059 event-loop clamp +
bug-060 cleanup robustness). With 7 bugs at 3-way concurrency this
is ~60+ min for a single iteration — manageable for a small
project. **At 100+ bugs (typical for a mature real-world ship),
this becomes 5-10+ hours per iteration** — multiplied across
3-5 iterations of the verify→fix loop = 15-50 hours per /fix-bugs
run.

But: the bug-fix loop's verify→fix→verify cycle is fundamentally
different from /start-build's per-feature tester+reviewer model.
**The verifier IS the ground-truth integration check.** If a fix
doesn't actually resolve the bug, the next iteration's verify
re-surfaces it. The flap-detector escalates after 3 reappearances.
Per-bug tester+reviewer dispatch is therefore largely redundant
for bug-fix mode.

What's the right architecture for /fix-bugs at scale?

## Empirical anchor

reading-log-01 bj2kqzj19 (the post-bug-059 run, 2026-05-06):

- 7 bugs surfaced (1 dev-server-compile + 6 visual-parity)
- 3-way parallel dispatch (clamped from 5 by bug-059)
- At 26 min in: 0 completed, 3 in-flight on attempt 1, 4 queued
- Per-bug agentSequence sizes:
  - dev-server-compile (compile bug): `[backend-builder]` — 1 agent (feat-058)
  - visual-parity (6 bugs): `[web-frontend-builder, tester, reviewer]` — 3 agents (feat-058 didn't trim parity because parity-divergence has no `primaryCause` field)
- Empirical wall-clock per parity bug: ~15-25 min serial across 3 agents

Compare to /start-build's per-feature dispatch: features bundle 5-15
tasks each, justifying the 3-agent investment. Bug fixes are typically
1-3 task-equivalents — the per-bug-3-agent overhead is ~10x relative
to the actual fix work.

## Hypotheses

### H1 (the user's insight): Re-verify makes per-bug tester+reviewer largely redundant

The bug-fix loop already runs `runBuildToSpecVerify` between
iterations. The verifier captures:

- Reachability orphans (any unimported export)
- Flow execution failures (synthesized e2e specs)
- Visual parity (DOM-skeleton comparison)
- Dev-server compile errors
- Runtime errors

If a bug-fix didn't fully resolve the bug, ONE OF THESE re-fires in
the next verify pass. The flap-detector escalates after 3
reappearances. Net effect: **the verifier IS the structural
integration test.** Per-bug tester adds:

- Edge-case test coverage (already lower-priority for bug-fix scope)
- Test suite green-state confirmation (already required at feature
  ship time, not at every bug-fix dispatch)

Per-bug reviewer adds:

- Semantic correctness check (was the fix RIGHT, not just sufficient
  to pass verify?)
- Style/convention conformance (handled by the project's hooks +
  tests already)
- Defense-in-depth on builder hallucinations

Both have value but **at 15-25 min/bug × 100 bugs = 25-40h, the
ROI is dubious for plumbing fixes.** For semantic / visual bugs,
reviewer's value is higher; for compile/runtime, value is near zero.

### H2 (user's batching idea): Group-level tester+reviewer per bug class

For 10 UI parity bugs all touching `apps/web/app/**/page.tsx`:

1. Dispatch all 10 builders in parallel/sequence on a SHARED
   group worktree (e.g. `fix/group-parity-layout-regrouping`)
2. After all builders complete, ONE tester pass against the merged
   group state
3. ONE reviewer pass against the same merged state
4. Single merge cascade group → fixup → master

Cost: tester+reviewer goes from N dispatches to 1.
Savings: ~(N-1) × (tester+reviewer wall-clock) per group.
Risk: builders contending on shared worktree (bug-015 pattern);
need serialization within group (already solved by feat-053
class-batched-fix-dispatch infrastructure for builders).

### H3: Pure verify-driven loop (no per-bug tester, no per-bug reviewer)

Skip tester+reviewer entirely in bug-fix mode. Builder makes fix →
merge → next iteration's verify confirms or refiles. The verifier's
deterministic checks become the only ground truth.

Pros:

- Maximum throughput: per-bug dispatch is 1 agent only (~5-10 min)
- Aligned with the loop's existing semantics (verify between iters)
- Iteration count naturally grows for bugs that don't converge —
  flap-detector handles persistent bad fixes

Cons:

- Loses semantic review on visual bugs (reviewer flags wrong-but-
  passes-verify fixes)
- Loses test-suite green-state at iteration boundaries
- Risk: bug-fix introduces regression that doesn't surface in
  verify (e.g. a runtime path NOT exercised by synthesized flows)

Mitigation for cons: run a single full-suite test pass + reviewer
audit at LOOP-EXIT (not per-bug, not per-iteration). Catches
regressions before /fix-bugs declares "clean".

### H4: Per-iteration tester+reviewer, not per-bug

All bugs in iteration N dispatch their builders. After all
builders complete, ONE tester pass + ONE reviewer pass on the
fixup-branch state (which has all iteration-N merges). If issues,
iteration N+1 re-dispatches with new context.

Pros:

- Tester+reviewer per iteration scales with iteration count, not
  bug count (typically 2-3 iterations for a 100-bug project)
- Tester sees the COMBINED state, catches inter-bug interactions
- Reviewer's audit is global, not local — better for cross-cutting
  issues

Cons:

- Tester might struggle to isolate "which builder caused which
  issue" → blast-radius problem on rejection
- Iteration boundary becomes a hard sync point — slower
  iteration-1 wall-clock since waiting for ALL builders before
  test+review

### H5: Decoupled tester+reviewer (parallel-pipelined post-merge)

Builder commits → merges to fixup → tester+reviewer dispatch
ASYNCHRONOUSLY (don't block next builder). If tester+reviewer fail
later, mark for next iteration retry; if pass, no-op.

Pros:

- Builder throughput decoupled from tester+reviewer wall-clock
- Maximum parallelism: builder dispatches at full rate, tester+
  reviewer queue catches up

Cons:

- Race conditions: reviewer may audit code that's been re-modified
  by next builder before review completes
- Complex bookkeeping (which review applies to which fix?)
- Hard to express the "rejected" path cleanly

### H6: Hybrid — class-determined sequence

- **Plumbing bugs** (compile, runtime, orphan): builder only
  (current feat-058 partial state for compile). Re-verify catches
  any miss.
- **Visual-parity bugs**: builder + reviewer (no tester) — reviewer
  audits the markup change semantically; verify confirms structure
- **Flow-execution bugs**: builder + tester (no reviewer) — tester
  re-runs the failing flow; passing it IS the proof
- **Build-gap / seed-setup**: full 3-agent (feature-class work,
  current behavior preserved)

This is a refinement of feat-058's table with more aggressive trims
on cheap classes.

## Investigation Steps

### Step 1 — Audit current per-bug agent costs (15min, code-reading)

For each agentSequence variant currently produced, walk the code

- document the actual wall-clock + spend per agent:

| primaryCause        | Current sequence                    | Per-agent ~wall-clock | Per-agent ~$                         | Total                |
| ------------------- | ----------------------------------- | --------------------- | ------------------------------------ | -------------------- |
| dev-server-compile  | [backend-builder]                   | 5-10min               | $0.30-0.80                           | 5-10min, $0.30-0.80  |
| runtime-error       | [<tier>, reviewer]                  | 5-10 + 3-8            | $0.30-0.80 + $0.20-0.50              | 8-18min, $0.50-1.30  |
| visual-parity       | [web-frontend, tester, reviewer]    | 8-15 + 5-15 + 3-10    | $0.40-1.20 + $0.30-1.00 + $0.20-0.60 | 16-40min, $0.90-2.80 |
| reachability-orphan | [<tier>, reviewer]                  | 5-10 + 3-8            | $0.30-0.80 + $0.20-0.50              | 8-18min, $0.50-1.30  |
| build-gap           | full 3-agent                        | 8-15 + 5-15 + 3-10    | $0.40-1.20 + $0.30-1.00 + $0.20-0.60 | 16-40min, $0.90-2.80 |
| seed-setup          | [backend-builder, tester, reviewer] | (same)                | (same)                               | (same)               |
| flow-execution      | full 3-agent                        | (same)                | (same)                               | (same)               |

Source: empirical data from this session's stall-log + counters.json

- reading-log-01 bug history.

### Step 2 — Quantify the scale problem (10min, calculator math)

Project size scenarios:

| Project              | Surfaced bugs | Per-bug avg | Total iter time | 3 iterations |
| -------------------- | ------------- | ----------- | --------------- | ------------ |
| Small (this session) | 7             | 18min       | 7×18/3 = 42min  | 2.1h         |
| Medium               | 30            | 18min       | 30×18/3 = 3h    | 9h           |
| Large                | 100           | 18min       | 100×18/3 = 10h  | 30h          |
| Mature               | 300           | 18min       | 300×18/3 = 30h  | 90h          |

The medium and large projects are operationally painful; the mature
project is unworkable.

### Step 3 — Cross-reference feat-053 class-batched-dispatch (15min)

`orchestrator/src/fix-bugs-loop.ts:1091+` already implements
class-batched-fix-dispatch for parity bugs. Let me audit:

- What does it batch? (BUILDER only? or builder + tester + reviewer?)
- What's the empirical impact?
- Can the same batching be extended to tester + reviewer?

Initial read: feat-053 batches builders (1 builder for N bugs in
a class) but each bug still individually goes through tester +
reviewer. So the WIN is on builder cost; tester+reviewer is per-bug.
This is the ~50% solution; H2 would extend it to tester+reviewer too.

### Step 4 — Evaluate H1 + H3 (pure-verify) feasibility (20min)

Run `git log --oneline | grep -i 'tester\|reviewer'` on a few past
projects to find cases where tester or reviewer caught something
the verifier WOULDN'T HAVE CAUGHT on the next iteration. If those
cases are rare → H1/H3 viable.

Specific sub-questions:

- How often does tester flag a `genuineProductBug` that the next
  verify wouldn't have re-surfaced?
- How often does reviewer reject for reasons unrelated to the
  fix's structural correctness?
- What's the rate of "reviewer found a bug the test suite + verifier
  missed"?

If answers are <5% → H3 (pure-verify) is correct for the cheap
classes; reviewer kept only for visual / semantic bugs.

### Step 5 — Evaluate H2 + H4 (group/iteration batching) (20min)

Concrete prototype design for H2:

- New BugFixGroup concept: collection of bugs sharing
  primaryCause + affectsFiles overlap
- Dispatch all builders of a group on shared worktree (serialized)
- ONE tester + reviewer pass at group close
- Merge group → fixup as single unit

Compare against feat-053's existing groupDispatchableBugsByPattern:

- Reuse feat-053's grouping for builders (already shipped)
- Add tester+reviewer batching at the same group boundary

For H4 (per-iteration test+review):

- Track total dispatched builders per iteration
- After ALL iteration-N builders complete + merge, dispatch ONE
  tester + ONE reviewer against fixup HEAD
- If reject, iteration N+1 picks up retry with reviewer's context
- Simpler than H2 (no grouping logic); blast radius is whole
  iteration, not just one group

### Step 6 — Cost-benefit analysis + decision (10min)

Score each architecture against:

- Wall-clock per 100-bug project
- Total $ spend per 100-bug project
- Engineering complexity (LOC + new abstractions)
- Risk of false-clean (regression escapes verify+test net)
- Compatibility with existing investigate-018+019 stack

Pick winning architecture(s). Likely outcomes:

- H6 (hybrid class-determined sequence) is the safest extension
- H2 (group-level tester+reviewer) requires feat-053-extension
  for tester batching
- H3 (pure verify-driven) is most aggressive — needs strong
  per-class confidence (from Step 4 data)

## Findings (immediate, code-reading only)

### Step 1 partial — agent-sequence cost audit (read 2026-05-06)

Per-bug agentSequence currently produced by `defaultAgentSequence`
(post feat-058 + bug-056):

```js
case "dev-server-compile":          return [tier];                    // 1 agent
case "runtime-error":               return [tier, "reviewer"];        // 2 agents
case "visual-parity":               return [tier, "reviewer"];        // 2 agents
case "seed-setup":                  return ["backend-builder", "tester", "reviewer"];  // 3 agents
case "manifest-author":             return [];                        // 0 agents (operator review)
case "build-gap":
case "flow-execution-failure":
default:                            return [tier, "tester", "reviewer"];  // 3 agents
```

**BUT** parity-divergence violations don't have `primaryCause` set
(they go through a separate violation kind), so they fall through
to the 3-agent default in feat-058's switch. Empirical reading-log-01
bj2kqzj19 confirms: all 6 visual-parity bugs got 3-agent sequence
despite feat-058's intended 2-agent for visual-parity. **This is
a feat-058 implementation gap that bug-058's empirical run already
exposed but we deferred fixing.**

Quick fix worth flagging: extend the switch to also key off
`violation.kind === "parity-divergence"` so parity bugs get the
2-agent sequence. Should be a feat-058-followup.

### Step 3 partial — feat-053 audit (read 2026-05-06)

`orchestrator/src/fix-bugs-loop.ts:1091-1119` (feat-053 class-batched
dispatch logic):

```ts
if (ctx.enableClassBatchedDispatch) {
  const groups = groupDispatchableBugsByPattern(dispatchableBugs);
  for (const [key, groupBugs] of groups) {
    if (key.startsWith("pattern:") && groupBugs.length >= 2) {
      const pattern = key.slice("pattern:".length);
      dispatchUnits.push({
        kind: "batch",
        bugs: groupBugs,
        pattern,
        unitId: `pattern-${pattern}-batch`,
      });
    } else {
      const bug = groupBugs[0]!;
      dispatchUnits.push({ kind: "single", bugs: [bug], unitId: bug.id });
    }
  }
} else {
  /* per-bug singletons only */
}
```

Then `dispatchAgentsForPatternGroup` runs ONE builder dispatch
across all bugs in the group. **It runs a SINGLE 3-agent sequence
(builder + tester + reviewer) for the entire group — tester +
reviewer DO get batched too at this layer.**

So feat-053 ALREADY implements H2 partially — but only when the
operator passes `--enable-class-batched-dispatch`. **Default is
OFF.**

This is a major finding: **feat-053 already exists; we just need
to (a) enable it by default for bug-fix runs and (b) extend the
grouping criteria beyond pure parity-pattern to other cause classes.**

### Step 4 partial — empirical "did tester catch what verify wouldn't" (read 2026-05-06)

From this session's actual tester output:

bug-parity-book-create attempt 1 tester errorLog (verbatim):

```
[tester] Genuine product bug: data-screen-id=book-create and
data-kit-component=Modal are on the same element in
book-create-modal.tsx:69. Parity verifier requires Modal as a
child of the screen-id container, not the root.
```

This IS a structural bug the parity-verifier WOULD have caught on
re-verify (the markup mismatch IS what parity-verify checks).
Tester surfaced it sooner but didn't add information the loop
wouldn't have re-derived.

Counter-example: tester's flag for tsconfig.json + Prisma issues
in attempt 1 of the prior run — those were OUTSIDE parity-verify's
scope (wouldn't have been caught by the next /build-to-spec-verify
pass). **Tester DID add unique value here.**

So the "redundant" claim depends on bug class:

- Visual-parity / compile: tester redundant (verify catches)
- Flow-execution: tester redundant (next flow run re-detects)
- runtime-error / build-gap: **tester adds value** (catches
  test-suite breakage that verify doesn't run)

### Recommendation (preliminary)

Three concrete follow-up plans, in priority order:

1. **feat-058-followup-parity-divergence-routing** (P0, ~30min):
   extend `defaultAgentSequence` switch to include
   `violation.kind === "parity-divergence"` → `[tier, reviewer]`.
   Closes the gap exposed in this session's runs. **Quickest win.**

2. **feat-061-default-class-batched-dispatch-on** (P1, ~1h):
   change `enableClassBatchedDispatch` default from false → true
   for /fix-bugs runs. feat-053 already does the heavy lifting;
   this is a default flip + audit of any unintended consequences
   on non-parity bug classes.

3. **feat-062-pure-verify-mode-for-cheap-classes** (P1, ~3h):
   ship H3 (no tester, no reviewer) for dev-server-compile +
   reachability-orphan + visual-parity classes. Add a single
   loop-exit tester+reviewer pass to catch regressions before
   declaring "clean". Empirically validate against a 30+ bug
   project to measure scale impact.

DEFER for later:

- H2 group-level batching beyond what feat-053 does (already
  closes most of the gap)
- H4 per-iteration tester+reviewer (only if H3 + Step 4 data
  show pure-verify isn't enough)
- H5 decoupled async tester+reviewer (high complexity for
  marginal win)

## Recommendation

After Steps 4-6 complete, file:

- **feat-058-followup-parity-divergence-routing** — quick fix,
  ship-now confidence
- **feat-061-default-class-batched-dispatch-on** — enable
  feat-053 by default for /fix-bugs (closes most of the wall-clock
  gap at scale)
- **feat-062-pure-verify-mode-for-cheap-classes** — pending
  empirical validation of "tester+reviewer redundancy" claim per
  bug class

If feat-061 + feat-062 ship, expected wall-clock at 100 bugs:

- Pre-stack: ~30h
- Post-stack: 5-8h (4-6x speedup)

Beyond that, the only optimization is reducing per-bug AGENT cost
(prompt size, model tier, SDK warmup) — investigate-019's
deferred follow-ups.

## Attempt Log

(Plan filed by human 2026-05-06 21:56. Step 1 + 3 + 4 partial
findings already populated; Steps 2 + 5 + 6 require empirical
validation against a 30+ bug project.)
