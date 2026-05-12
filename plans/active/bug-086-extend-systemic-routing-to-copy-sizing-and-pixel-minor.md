---
id: bug-086-extend-systemic-routing-to-copy-sizing-and-pixel-minor
type: bug
status: draft
author-agent: human
created: 2026-05-12
updated: 2026-05-12
parent-plan: feat-066-fix-loop-effectiveness-v2
supersedes: null
superseded-by: null
branch: fix/extend-systemic-routing-to-copy-sizing-and-pixel-minor
affected-files:
  - scripts/file-bug-plan.mjs
  - orchestrator/tests/file-bug-plan-parity.test.ts
feature-area: orchestrator/fix-loop
priority: P1
attempt-count: 0
max-attempts: 5
error-message: "remaining 2 bug-fixer failures post-bug-085 are copy-sizing-drift + pixel-minor-divergence; both also need systemic-fixer routing"
---

# bug-086: extend systemic-fixer routing to copy-sizing-drift + high-drift pixel-minor-divergence patterns

## Bug Description

bug-085 routed `layout-regrouping` to systemic-fixer and cleared 5 of 5 empirically-failed bugs in the reading-log-02 2026-05-12 follow-up run. Only 2 bugs remained failed after that run:

- `bug-parity-book-create-copy-sizing-drift` — pattern: `copy-sizing-drift`
- `bug-parity-book-detail-pixel-minor-divergence` — pattern: `pixel-minor-divergence`

Both still route to bug-fixer per bug-085's conservative Phase A (which only routed `layout-regrouping`). Both also wall-clock-stalled with bug-fixer's smallest-diff contract — bug-fixer's `taskOutcomes: completed` returned without committing source (caught by bug-082's guard), then either escalated by convergence-detector or maxed-out attempts.

The empirical signal: these two patterns ALSO need cross-file reasoning. `copy-sizing-drift` involves font-scale + typographic-hierarchy changes that touch multiple components. `pixel-minor-divergence` at HIGH drift counts (the ones that fail bug-fixer) likewise reflect spread-out style mismatches.

## Reproduction Steps

1. With bug-085 active, trigger any /build-to-spec-verify that produces a `copy-sizing-drift` divergence (e.g. mockup uses font-size 18px headers, build uses 16px — happens when stylesheet token defaults drift).
2. Trigger /fix-bugs. Watch bug-fixer attempts wall-clock-stall trying to find the single source of the drift, eventually return `completed` without commit (bug-082 catches), fail.
3. Same for pixel-minor-divergence on high-drift screens.

Empirical: reading-log-02 2026-05-12 — `bug-parity-book-create-copy-sizing-drift` (failed bug-fixer 3 attempts) and `bug-parity-book-detail-pixel-minor-divergence` (failed bug-fixer 3 attempts) both lingered as failed after bug-085 cleared the 5 layout-regrouping bugs.

## Root Cause Analysis

`scripts/file-bug-plan.mjs:defaultAgentSequence` (post-bug-085):

```js
case "visual-parity": {
  const pattern = violation && violation.parity && violation.parity.pattern;
  if (pattern === "layout-regrouping") {
    return ["systemic-fixer"];
  }
  return ["bug-fixer"];
}
```

bug-085 was deliberately conservative — only one pattern routed. The fix-approach plan explicitly flagged copy-sizing-drift and pixel-minor-divergence for follow-up:

> Optional: also route `copy-sizing-drift` to systemic-fixer based on this run's empirical (book-create-copy-sizing-drift also failed bug-fixer 3 attempts). Decide based on the systemic-fixer success rate on layout-regrouping first — if Phase A clears 80%+ of these, copy-sizing-drift might just need a separate tweak; if it doesn't, Phase A should expand.

bug-085's Phase A cleared 5 of 5 layout-regrouping (100%). That validates systemic-fixer for structural drift. The 2 remaining failures clearly suggest the same expansion for the OTHER non-trivial parity patterns.

## Fix Approach

### Phase A — extend pattern allowlist (~15min)

Add two more patterns to the systemic-fixer branch in `defaultAgentSequence`:

```js
case "visual-parity": {
  const pattern = violation && violation.parity && violation.parity.pattern;
  if (
    pattern === "layout-regrouping" ||
    pattern === "copy-sizing-drift" ||
    pattern === "pixel-minor-divergence"
  ) {
    return ["systemic-fixer"];
  }
  return ["bug-fixer"];
}
```

**Risk consideration for `pixel-minor-divergence`:** unlike layout-regrouping (always structural) and copy-sizing-drift (always typographic), pixel-minor-divergence can be EITHER trivial (1-2 pixel shifts on one component — bug-fixer territory) OR systemic (whole-screen distribution — systemic-fixer territory). Routing all pixel-minor to systemic-fixer would waste systemic-fixer's higher dispatch cost on trivial cases.

Two sub-options for handling this:

**Phase A.1 (conservative):** route only `layout-regrouping` + `copy-sizing-drift` to systemic-fixer (skip pixel-minor). Expected lift: +1 fix (book-create-copy-sizing-drift). Final completion: 18/22 = 82%.

**Phase A.2 (aggressive):** route all 3 patterns. Risk: pixel-minor false-positives (small drifts going to systemic-fixer needlessly). Expected lift: +2 fixes (both currently-failed bugs). Final completion: 19/22 = 86%.

Recommend Phase A.1 first; check the empirical Phase D outcome; if pixel-minor-divergence is still failing, ship Phase A.2 OR (cleaner) ship Phase B (drift-count threshold).

### Phase B — drift-threshold sub-routing (deferred; depends on Phase A outcome)

If Phase A.1 leaves pixel-minor-divergence failing, factor drift counts into the routing:

```js
const drift =
  (violation.parity?.detail?.styleDrift?.length ?? 0) +
  (violation.parity?.detail?.variantDrift?.length ?? 0);

if (pattern === "pixel-minor-divergence" && drift >= 5) {
  return ["systemic-fixer"]; // high-drift: structural
}
if (pattern === "pixel-minor-divergence") {
  return ["bug-fixer"]; // low-drift: surface-level
}
```

This is the cleaner discriminator — operates on objective drift counts rather than blanket pattern routing. Could also apply to `style-drift` and `variant-drift` (which currently route to bug-fixer and succeed at low drift but may need to escalate at high drift).

### Phase C — tests (~15min)

- Unit test: `copy-sizing-drift` pattern → `["systemic-fixer"]`
- Unit test: `pixel-minor-divergence` pattern → `["systemic-fixer"]` (or `["bug-fixer"]` with drift-threshold check, depending on Phase A.1 vs A.2)
- Unit test: variant-drift, style-drift, token-drift unchanged at `["bug-fixer"]` (regression preserve)

## Rejected Fixes

- **Bump bug-fixer's maxTurns higher for these patterns** — same reason as bug-085 rejected this for layout-regrouping. Turn budget isn't the problem; the smallest-diff contract is.
- **Add ALL visual-parity patterns to systemic-fixer** — wastes dispatch cost on patterns that bug-fixer handles cheaply (variant-drift, token-drift, low-drift pixel-minor). The pattern-aware routing has to stay discriminating.
- **Promote at audit time via `audit-computed-styles.ts`** — Phase B equivalent at the discriminator layer; more invasive than file-bug-plan-side routing. Defer.

## Validation Criteria

- [ ] `scripts/file-bug-plan.mjs:defaultAgentSequence` routes `copy-sizing-drift` to `["systemic-fixer"]` (Phase A.1 minimum)
- [ ] Optionally routes `pixel-minor-divergence` to `["systemic-fixer"]` (Phase A.2) OR conditionally on drift counts (Phase B)
- [ ] Other visual-parity patterns (variant-drift, style-drift, token-drift) continue routing to `["bug-fixer"]`
- [ ] 2-3 new routing tests in `orchestrator/tests/file-bug-plan-parity.test.ts`
- [ ] Existing 46 file-bug-plan-parity tests stay green
- [ ] Empirical: re-run /fix-bugs reading-log-02 after Phase A lands; the 2 currently-failed bugs should now route to systemic-fixer. Expected lift: +1 to +2 fixes, completion 82-86%.

## Cross-references

- **bug-085** (`40defc9`) — the parent that demonstrated this routing approach works for layout-regrouping. 100% success rate (5 of 5 fixes) validates the pattern-aware approach for structural drift classes.
- **feat-066 v2 epic** — natural extension of the v2 trio's empirical validation arc.
- **feat-070 (systemic-fixer agent)** — the dispatch target; already exists and proven.
- **reading-log-02 /fix-bugs run 2026-05-12 post-bug-085** — empirical case file. 17/22 completed (77%), 2 failed; both are bug-086's targets.
- **bug-078 (audit-computed-styles defaults + discriminators)** — adjacent; bug-086 Phase B would extend the discriminator side of the same routing system.

## Attempt Log

<!-- Populated by executing agents. -->
