---
id: bug-085-layout-regrouping-routes-to-systemic-fixer
type: bug
status: draft
author-agent: human
created: 2026-05-12
updated: 2026-05-12
parent-plan: feat-066-fix-loop-effectiveness-v2
supersedes: null
superseded-by: null
branch: fix/layout-regrouping-routes-to-systemic-fixer
affected-files:
  - scripts/file-bug-plan.mjs
  - orchestrator/src/audit-computed-styles.ts
  - orchestrator/tests/file-bug-plan-parity.test.ts
feature-area: orchestrator/fix-loop
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "high-drift visual-parity layout-regrouping bugs all fail at bug-fixer; need systemic-fixer routing"
---

# bug-085: visual-parity layout-regrouping bugs route to bug-fixer but consistently fail; need systemic-fixer routing

## Bug Description

Empirical evidence from reading-log-02 /fix-bugs run 2026-05-12: 7 of 7 `failed` bugs are visual-parity `layout-regrouping` (or related layout-shape) classes. None were fixable by bug-fixer despite 3 maxAttempts × 6 wall-clock-min each = ~3hr cumulative bug-fixer dispatch time burned across the run.

Routing today (`scripts/file-bug-plan.mjs:defaultAgentSequence` + `audit-computed-styles.ts:promoteToSystemic`):

- **systemic-divergence** pattern → `[systemic-fixer]` (feat-070 routing)
- **pixel-systemic-divergence** pattern → `[systemic-fixer]`
- **layout-regrouping** pattern → `[bug-fixer]` ← but bug-fixer's smallest-diff contract isn't structurally suited to fixing layout-shape mismatches
- **copy-sizing-drift** pattern → `[bug-fixer]` ← also empirically failed in this run
- **variant-drift / style-drift / token-drift / pixel-minor-divergence** → `[bug-fixer]` ← these CAN succeed at bug-fixer when drift count is small; they're per-element nudges

The empirical signal: layout-regrouping is structural drift (DOM shape mismatch — different parent components, missing wrapper sections, regrouped flex children). Fixing it requires cross-file reasoning: read the mockup's structure, identify the page's structure, restructure the JSX. That's exactly what `systemic-fixer.md`'s contract enables ("authorized to edit multiple files in one dispatch; suspect infrastructure first; fix the source of the symptom-class").

## Reproduction Steps

1. Trigger any project's `/build-to-spec-verify` such that the parity verifier produces a layout-regrouping divergence with high drift counts (e.g. 6+ `variantDrift` or `styleDrift` entries on a single screen).
2. Inspect `docs/bugs.yaml`: the bug's `agentSequence` is `[bug-fixer]`.
3. Trigger `/fix-bugs <project>`. Watch bug-fixer dispatch:
   - Attempt 1: bug-fixer reads the mockup + pre-loaded page.tsx, edits one component, returns `taskOutcomes: completed`. Verify re-runs → divergence still present (different drift entries this time because the small edit shuffled one thing but didn't restructure).
   - Attempt 2: same shape — small targeted edit, doesn't fix the structural problem.
   - Attempt 3 (or convergence-detector-triggered escalation): bug marked `failed`.
4. Manual inspection of the built page vs. mockup confirms the gap is structural, not surface-style.

Empirical: reading-log-02 run 2026-05-12 — bug-parity-book-create-layout-regrouping (6 variantDrift, 11 styleDrift), bug-parity-book-detail-layout-regrouping, bug-parity-books-list-empty-layout-regrouping, bug-parity-settings-layout-regrouping, bug-parity-tags-manage-layout-regrouping all failed this way.

## Root Cause Analysis

`scripts/file-bug-plan.mjs:defaultAgentSequence` (post-feat-070):

```js
// Cheap classes route to bug-fixer (single narrow-scope edit):
case "dev-server-compile":
case "runtime-error":
case "visual-parity":           // ← catches ALL visual-parity patterns
case "flow-execution-failure":
case "step-transition":
case "timeout-no-evidence":
  return ["bug-fixer"];
```

The `visual-parity` cause is a single bucket. It doesn't distinguish layout-regrouping (structural) from style-drift / variant-drift / token-drift / pixel-minor-divergence (surface).

`orchestrator/src/audit-computed-styles.ts:promoteToSystemic` (feat-067 / bug-078) DOES promote some visual-parity divergences to `systemic-divergence` / `pixel-systemic-divergence` patterns, which then route via:

```js
case "systemic-divergence":
case "pixel-systemic-divergence":
  return ["systemic-fixer"];
```

But the promotion logic uses thresholds on `styleDrift` count + visualSurface% — it doesn't consider the `pattern` field directly. Layout-regrouping bugs with high drift get filed with `pattern: layout-regrouping`, NOT promoted to `systemic-divergence`, despite the empirical evidence that they're systemic in nature.

## Fix Approach

Two complementary routes — ship Phase A first, evaluate empirically, ship Phase B if needed.

### Phase A — route layout-regrouping (+ copy-sizing-drift?) directly to systemic-fixer (~30min)

In `scripts/file-bug-plan.mjs:defaultAgentSequence`, OR ahead of the visual-parity default case, branch by the parity pattern:

```js
const pattern = violation && violation.parity && violation.parity.pattern;

if (cause === "visual-parity") {
  if (pattern === "layout-regrouping") {
    return ["systemic-fixer"];
  }
  // Other visual-parity patterns (variant-drift, style-drift, token-drift,
  // copy-sizing-drift, pixel-minor-divergence) stay at bug-fixer for now —
  // they're surface-level and bug-fixer handles them when drift counts are low.
  return ["bug-fixer"];
}
```

Optional: also route `copy-sizing-drift` to systemic-fixer based on this run's empirical (book-create-copy-sizing-drift also failed bug-fixer 3 attempts). Decide based on the systemic-fixer success rate on layout-regrouping first — if Phase A clears 80%+ of these, copy-sizing-drift might just need a separate tweak; if it doesn't, Phase A should expand.

### Phase B — extend `audit-computed-styles.ts:promoteToSystemic` to consider pattern + drift severity (~1hr; OPTIONAL)

Make the systemic-promotion logic explicitly factor `pattern`:

```ts
// pseudo-code; actual API depends on existing promoteToSystemic signature
if (pattern === "layout-regrouping" && (variantDrift.length + styleDrift.length) >= 5) {
  return { pattern: "layout-regrouping-systemic", ... };
}
```

The advantage of Phase B over Phase A: keeps the systemic vs. cheap distinction discoverable at audit time (the verifier classifies the bug ONCE, file-bug-plan just routes by class). Disadvantage: schema churn (new pattern enum value) + more test surface.

Recommend: Phase A first (~30min, schema-stable). Only revisit Phase B if the empirical signal post-Phase-A shows layout-regrouping bugs are sometimes legitimately small (i.e. some pass systemic-fixer trivially and would have been cheaper at bug-fixer).

### Phase C — tests (~30min)

- Unit test: file-bug-plan with `violation.parity.pattern: "layout-regrouping"` → `agentSequence: ["systemic-fixer"]`
- Unit test: file-bug-plan with `violation.parity.pattern: "variant-drift"` → `agentSequence: ["bug-fixer"]` (regression preserve)
- Unit test: file-bug-plan with `violation.parity.pattern: "style-drift"` → `agentSequence: ["bug-fixer"]` (regression preserve)

## Rejected Fixes

- **Make bug-fixer's contract more permissive on visual-parity bugs** — duplicates systemic-fixer's contract and breaks the bug-fixer/systemic-fixer distinction. systemic-fixer was built for exactly this lane.
- **Bump bug-fixer's maxTurns from 8 to 16 for layout-regrouping** — turn budget isn't the problem; bug-fixer's smallest-diff guidance is. Even with infinite turns, the wrong contract produces wrong fixes.
- **Auto-merge layout-regrouping bugs into systemic-divergence at audit time** — schema-invasive, and the distinction may matter for human review (operator can tell at a glance "this is layout-shape" vs "this is everywhere").
- **Route ALL visual-parity to systemic-fixer** — wastes the higher dispatch cost on small drifts that bug-fixer fixes cheaply. Discriminating by pattern is the right granularity.

## Validation Criteria

- [ ] `scripts/file-bug-plan.mjs:defaultAgentSequence` (or adjacent) routes `visual-parity + layout-regrouping` to `["systemic-fixer"]`
- [ ] Non-layout-regrouping visual-parity patterns continue routing to `["bug-fixer"]`
- [ ] 3 new tests cover the routing branches (layout-regrouping → systemic-fixer; variant-drift → bug-fixer; style-drift → bug-fixer)
- [ ] `orchestrator/tests/file-bug-plan-parity.test.ts` full suite stays green (44+ tests)
- [ ] Empirical: re-run /fix-bugs reading-log-02 after Phase A lands; the 5 failed layout-regrouping bugs (book-create, book-detail, books-list-empty, settings, tags-manage) should now route to systemic-fixer. Expected lift: at least 3 of 5 should succeed (~60%), based on systemic-fixer's empirical success rate on systemic-divergence patterns elsewhere.

## Cross-references

- **feat-066 v2 epic** — this is a natural Phase 7 candidate (post-validation factory follow-on). The v2 trio (bug-082+083+084) eliminated false-positive completions; this bug closes the routing gap that 7 of 7 failures empirically exposed.
- **feat-070 (systemic-fixer agent)** — the agent that already exists and is the right target for this routing.
- **bug-078 (audit-computed-styles classifier defaults + discriminators)** — adjacent work; bug-085 Phase B would extend the discriminator.
- **bug-082** (`1587b54`) — without bug-082 in place, the 7 failures would have appeared as fake "completed" entries, masking the routing gap. bug-082 is what made this signal visible.
- **investigate-026** — parent investigation that surfaced the broader fix-loop completion gap.
- **reading-log-02 /fix-bugs run 2026-05-12** — empirical case file. See `projects/reading-log-02/docs/bugs.yaml` for the bug-by-bug data + `contexts/20260512-042354-…md` for the analysis writeup.

## Attempt Log

<!-- Populated by executing agents. -->
