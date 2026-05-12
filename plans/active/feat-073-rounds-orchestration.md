---
id: feat-073-rounds-orchestration
type: feature
status: draft
author-agent: human
created: 2026-05-12
updated: 2026-05-12
parent-plan: feat-066-fix-loop-effectiveness-v2
branch: feat/rounds-orchestration
affected-files:
  - orchestrator/src/round-state.ts
  - orchestrator/src/fix-bugs-loop.ts
  - orchestrator/src/build-to-spec-verify.ts
  - orchestrator/src/perceptual-review.ts
  - packages/orchestrator-contracts/src/round-state.ts
  - orchestrator/tests/round-state.test.ts
feature-area: orchestrator/fix-loop-orchestration
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-073: Loop-of-loops — round-state orchestration of detection tiers

## Problem Statement

The current fix-bugs loop runs all detection tiers (reachability, flow execution, parity, perceptual review) in every verify pass. This was the right design when there was only ONE visual layer; with three visual/behavioral detection layers active (parity, perceptual review, future AI walkthrough) the all-tiers-per-iteration model produces noise, wastes API spend, and obscures the find-fix rhythm.

**Empirical motivation from reading-log-02 / feat-068 Phase D (2026-05-12):**

1. Parity verifier surfaced layout-regrouping bugs masking the smaller drift bugs underneath. Vision-LLM running on top of a broken layout would produce ~30 noise findings per screen — bugs that vanish once layout is fixed.
2. AI walkthrough (feat-069, pending) CAN'T meaningfully test interactions on a page that doesn't load (page.goto timeout) or has a stripped shell. Running it before structural+visual rounds are clean is wasted spend.
3. Three discoverability dependencies already exist as point-fixes in the codebase, hinting at a missing layer of abstraction:
   - bug-084 routes `page.goto` timeouts to operator-review because no agent can fix dev-server availability
   - bug-072 hardens failure-HTML capture because page-content failed-to-render bugs need different downstream handling
   - feat-068 cascade-skip rules suppress vision-LLM per-screen when parity already filed systemic bugs

The user's framing names this as **a loop of loops**: an outer state machine that advances through detection rounds, each wrapping the existing fix-bugs-loop with a different tier-set + bug-class filter.

## Approach

### Round structure (4 active rounds + final gate)

```
Round 1: STRUCTURAL  — "can the user see the page?"
Round 2: VISUAL-STRUCTURE  — "does the page have the right shape?"
Round 3: VISUAL-POLISH  — "does the page look exact?"
Round 4: BEHAVIORAL  — "does the page work right?"
Round 5: FINAL-GATE  — "anything new on a full re-verify?"
```

Per-round configuration (sourced from a new contract):

| Round | Detection tiers active                                   | Bug-class filter (this round fixes)                                                                                | Exit gate condition            |
| ----- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| 1     | 0 (compile/lint) + 1 (reachability) + 2 (flow execution) | dev-server-compile, runtime-error, reachability-orphan, dev-server-not-responding, flow-execution-failure (subset) | 0 pending bugs in filter       |
| 2     | 0–3 (adds parity)                                        | visual-parity:shell-stripping, layout-regrouping, systemic-divergence, pixel-systemic-divergence                   | 0 pending bugs in filter       |
| 3     | 0–4 (adds perceptual review)                             | visual-parity:variant-drift/style-drift/token-drift/copy-sizing-drift/pixel-minor, perceptual-divergence           | 0 pending bugs in filter       |
| 4     | 0–5 (adds AI walkthrough)                                | walkthrough-divergence                                                                                             | 0 pending bugs in filter       |
| 5     | 0–5 (all tiers fire)                                     | NONE — final gate is observational                                                                                 | 0 new bugs from full re-verify |

Critical design point: **cheaper tiers continue firing in later rounds** — they catch regressions. Only the expensive LLM tiers (4, 5) gate on round-state. Round 3's verify ALSO runs reachability + flow + parity; round 4's verify runs everything; round 5 is a final clean-check.

### Round-state derivation (load-bearing primitive)

```ts
// orchestrator/src/round-state.ts
import type { BugEntry } from "@repo/orchestrator-contracts";

export type RoundId = 1 | 2 | 3 | 4 | 5;

/**
 * Derive the current round from bugs.yaml shape. Returns the LOWEST round
 * whose bug-class filter has pending entries — that's the round the loop
 * should operate in. Demotion is automatic: a fix in round 3 that breaks
 * round 1 surfaces as a new round-1 bug; deriveRoundState returns 1; outer
 * loop sets the round back to 1.
 *
 * Returns 5 (final gate) when no round-1..4 classes have pending bugs.
 */
export function deriveRoundState(bugs: BugEntry[]): RoundId {
  const pending = bugs.filter((b) => b.status === "pending");
  if (pending.length === 0) return 5;

  // Round 1 classes
  const round1Sources = new Set([
    "dev-server-compile",
    "runtime-error",
    "reachability-orphan",
  ]);
  const round1PrimaryCauses = new Set(["dev-server-not-responding"]);
  if (
    pending.some(
      (b) =>
        round1Sources.has(b.source) ||
        (b.primaryCause && round1PrimaryCauses.has(b.primaryCause)),
    )
  ) {
    return 1;
  }

  // Round 2 classes — structural visual
  const round2ParityPatterns = new Set([
    "shell-stripping",
    "layout-regrouping",
    "systemic-divergence",
    "pixel-systemic-divergence",
    "clustered-systemic-divergence",
  ]);
  if (
    pending.some(
      (b) =>
        b.source === "visual-parity" &&
        b.parity?.pattern &&
        round2ParityPatterns.has(b.parity.pattern),
    )
  ) {
    return 2;
  }

  // Round 3 classes — visual polish + perceptual
  if (
    pending.some(
      (b) =>
        b.source === "visual-parity" || b.source === "perceptual-divergence",
    )
  ) {
    return 3;
  }

  // Round 4 — walkthrough (placeholder for feat-069's bug source)
  if (pending.some((b) => b.source === ("walkthrough-divergence" as never))) {
    return 4;
  }

  return 5;
}
```

### Outer-loop wiring in fix-bugs-loop.ts

The existing `runFixBugsLoop` becomes the inner loop, unchanged in shape. A thin wrapper queries `deriveRoundState` between iterations to decide which detection tiers to activate AND which bugs to dispatch fixes on:

```ts
// Pseudocode for the new wrapper
const MAX_ROUNDS_PER_RUN = 8; // round-demotion guard
let promotedRounds: RoundId[] = [];
let lastRound: RoundId | null = null;
let lastIterCount = 0;

while (lastIterCount < globalIterCap) {
  const round = deriveRoundState(currentBugs);
  if (round === 5) {
    // Final-gate check — full verify with all tiers
    const verify = await runBuildToSpecVerify({
      ...verifyArgs,
      enabledTiers: ALL_TIERS,
    });
    if (newBugsFiledOnRound5(verify)) {
      lastRound = deriveRoundState(currentBugs);
      continue; // demoted by final-gate findings
    }
    return { status: "clean", roundsPromoted: promotedRounds };
  }

  // Inner loop runs scoped to this round
  const innerResult = await runFixBugsLoopInner({
    ...innerArgs,
    enabledTiers: TIERS_FOR_ROUND[round],
    bugClassFilter: BUG_CLASSES_FOR_ROUND[round],
  });

  if (innerResult.bugsResolved === 0 && innerResult.bugsFailed > 0) {
    // Inner loop made no progress — escalate this round to "stuck"
    // and let the outer loop advance to next round (carry forward
    // failed bugs as needs-operator-review per the round's gate)
    promoteRoundToFailed(round);
  }
  promotedRounds.push(round);
  lastRound = round;
  lastIterCount += innerResult.iterations;
}
```

### Tier-gating in build-to-spec-verify

`runBuildToSpecVerify` already takes optional flags like `runParity`. Extend to accept an `enabledTiers` set OR `roundId`:

```ts
interface BuildToSpecVerifyContext {
  // ...existing fields...
  enabledTiers?: Set<TierId>; // when set, only these tiers fire
  // OR
  roundId?: RoundId; // convenience: maps to default TIERS_FOR_ROUND[round]
}
```

The perceptual-review block (post-feat-068) checks `enabledTiers.has(4)` before invoking the agent. The future walkthrough block (post-feat-069) checks `enabledTiers.has(5)`.

### Bug-class filter at dispatch

When inner loop dispatches fixes, it ignores pending bugs whose source/pattern isn't in the round's filter. This prevents wasting fix-loop budget on a perceptual-divergence bug while round 1 structural bugs are still pending — the round-1 fix may obviate the perceptual finding entirely.

The pre-feat-073 `pendingThisIter` filter in `runFixBugsLoop` (currently just `bug.status === "pending"`) gets a new constraint: also matches the round's class filter.

## Phases

### Phase A — round-state derivation + contract (~2hr)

1. NEW `packages/orchestrator-contracts/src/round-state.ts` — `RoundId` enum, `RoundConfig` interface mapping round → enabledTiers + bugClassFilter
2. NEW `orchestrator/src/round-state.ts` — `deriveRoundState()` pure function
3. Unit tests covering 5 cases: empty bugs.yaml, pure-round-1, mixed-round-1+3 (round-1 wins), pure-round-3, all-resolved
4. Add `RoundConfig` map constants

### Phase B — outer-loop wrapper + tier-gating (~3hr)

1. Wrap `runFixBugsLoop` in `runRoundsOrchestrator` (outer loop)
2. Extend `BuildToSpecVerifyContext` with `enabledTiers` (optional, defaults to ALL)
3. Update perceptual-review block in build-to-spec-verify to check `enabledTiers.has(4)` — when false, skip the entire dispatch (not just per-screen)
4. Update the inner `runFixBugsLoop`'s `pendingThisIter` filter to apply the round's bug-class filter
5. Surface round-state telemetry: log round transitions, round-promotion timestamps, round-failure events into bugs.yaml.iterationLog (new field) OR a separate `docs/build-to-spec/rounds-log.json`

### Phase C — feat-068 round integration (~30min)

1. perceptual-review's cascade-skip rules ALREADY work at the screen level. Per-round gating is a SHORTCUT — when round < 3, the whole dispatcher returns `{ ok: true, screensReviewed: 0, screensSkipped: <all>, warnings: ["round-gate suppressed Tier 4"] }`. No per-screen LLM dispatch.
2. Update tests to cover round-gating + verify cascade-skip still works for the per-screen path

### Phase D — empirical validation (~1hr wall-clock + ~$2-5 spend)

Re-run /fix-bugs reading-log-02 with feat-073 + feat-068 BOTH active. Validate:

- Round transitions visible in logs (1 → 2 → 3 → final-gate)
- Tier 4 fires ONLY in round 3 (suppressed in rounds 1 + 2)
- Demotion works: simulate a round-3 fix that breaks round-1; confirm derived round drops to 1
- Final round-5 gate either passes clean OR re-triggers an inner loop
- Cost: <50% of current per-iter overhead (since vision-LLM doesn't run until structural is clean)

### Phase E — feat-069 design alignment (~30min, no shipping)

Update feat-069 (AI walkthrough) plan to specify:

- Round 4 = behavioral round
- `walkthrough-divergence` bug source
- Round-gate: feat-069's dispatcher checks `enabledTiers.has(5)` first

## Rejected Alternatives

- **Run all tiers in every verify pass + filter findings post-hoc.** Wastes the API spend of Tier 4 + Tier 5 every iteration when their output is noisy under round-1 conditions. The skip-per-screen rules in feat-068 are a half-measure of this approach.
- **Explicit round counter persisted to bugs.yaml.** Schema bloat + state drift. Deriving round-state from bugs.yaml shape is canonical — the BUGS are the state machine.
- **One round per iteration cap.** Inflexible: some rounds need 1 iteration (cheap round 1 with clean structural), some need 5+ (visual rounds with many drift bugs). Iteration cap should stay per-round, configurable; global cap should sum to a project-level wall-clock budget.
- **Promote rounds aggressively even when round-N has failed bugs.** Tested empirically in pre-feat-073 runs (the `needs-operator-review` flow): when round-1 bugs are unfixable, downstream rounds can still produce useful signal. The wrapper handles this by carrying forward `needs-operator-review` bugs without blocking promotion.

## Validation Criteria

- [ ] `deriveRoundState()` exists + has 5+ unit tests covering its branches
- [ ] `runRoundsOrchestrator` wraps `runFixBugsLoop` cleanly; outer loop transitions visible in logs
- [ ] Round-2 verify run does NOT invoke Tier 4 (perceptual review)
- [ ] Round-3 verify run DOES invoke Tier 4; Tier 4 produces findings
- [ ] Bug-class filter at dispatch prevents round-3 bugs from being touched during round 1+2
- [ ] Demotion behavior empirically validated: round-3 fix that breaks round-1 → round drops to 1 → inner loop fixes structural again → re-promote to round 3
- [ ] Total per-run cost decreases vs. pre-feat-073 baseline (Tier 4 doesn't fire on round-1-incomplete projects)
- [ ] feat-068 cascade-skip rules still work at the screen level for round-3 path (no regression)
- [ ] No regression on existing test suites (fix-bugs-loop 60/60, bug-fix-context 17/17, file-bug-plan-parity 49/49)

## Cross-references

- **feat-066 v2 epic** — parent. feat-073 is the architectural shift the v2 work has been building toward; rounds-orchestration is the missing abstraction layer.
- **feat-068** (`04b722b`) — Tier 4 perceptual review. Its cascade-skip rules are a per-screen primitive form of round-gating; feat-073 generalizes them to the entire tier.
- **feat-069** — AI walkthrough (pending). Will be Tier 5 / round-4 detection. Should be drafted with round-gating from day 1, not retrofitted.
- **feat-071** clusterer — orthogonal to feat-073. Clusterer reduces bug count per dispatch; round-orchestration shapes WHICH bugs dispatch when.
- **bug-084** (`0f861db`) — dev-server-not-responding → operator-review. feat-073's round 1 contains this; the bug's existence motivates the "page must load before downstream tiers fire" rule.
- **bug-085** + **bug-086** — pattern-aware routing. feat-073's round-2 filter directly maps to bug-085's systemic patterns (layout-regrouping, etc.); the routing improvements compose cleanly with round-orchestration.

## Open Questions

1. **Round 4 trigger threshold.** Should walkthrough fire only when round 3 is 100% clean, or 90%+? Empirical decision; defer to feat-069's Phase D.
2. **Round-state persistence across pause/resume.** Currently round is derived per-iteration. If a /pause-build fires mid-round-3, /resume-build will re-derive — should match. Test in Phase D.
3. **Iteration cap distribution.** Global cap (default 5) split per-round vs. shared? Suggest per-round caps (3 per round × 4 rounds = 12 max; configurable).
4. **Final-gate behavior on non-trivial new bugs.** If round-5 surfaces a brand-new round-1 bug (regression), do we restart the whole orchestration or just demote? Suggest demote; document in Phase B.

## Attempt Log

<!-- Populated by executing agents. -->
