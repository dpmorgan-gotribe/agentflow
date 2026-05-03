---
id: bug-050-verifier-failure-class-taxonomy-and-agent-routing
type: bug
status: draft
author-agent: claude-opus-4-7
created: 2026-05-03
updated: 2026-05-03
parent-plan: feat-022-build-to-spec-verification
supersedes: null
superseded-by: null
branch: fix/verifier-failure-class-taxonomy-and-routing
affected-files:
  - scripts/run-synthesized-flows.mjs
  - scripts/file-bug-plan.mjs
  - packages/orchestrator-contracts/src/build-to-spec-verify.ts
  - orchestrator/tests/run-synthesized-flows.test.ts
  - orchestrator/tests/file-bug-plan.test.ts
feature-area: orchestration
priority: P1
attempt-count: 0
max-attempts: 5
error-message: "9 synthesized E2E failures on finance-track-01 (2026-05-03 post bug-048+049). Three distinct failure classes (build-gap, manifest-author, seed-mismatch) collapse into one `primaryCause: step-transition` bucket; `defaultAgentSequence()` ignores violation kind and routes everything to `web-frontend-builder` regardless. Auto-dispatching /fix-bugs against this output would produce wrong fixes for 5 of 9 failures."
reproduction-steps: "Run /build-to-spec-verify on any project where flows fail for non-build reasons (sloppy selectors, seed-vs-flow mismatch). All failures land under `step-transition`; bug plans dispatch `web-frontend-builder` even when the right agent is `user-flows-generator` or PM."
stack-trace: null
---

# bug-050 — Verifier failure-class taxonomy too coarse + agent routing ignores cause

## Bug Description

Run `/build-to-spec-verify` on `finance-track-01` (post bug-048+049 fixes; commit pending). 9 synthesized flows fail; empirical classification:

| Flow   | True class                                                          | Current `primaryCause` |
| ------ | ------------------------------------------------------------------- | ---------------------- |
| flow-1 | seed-mismatch (flow expects empty state, baseline has 3 accounts)   | `step-transition`      |
| flow-2 | manifest-author (`:has-text` strict-mode violation)                 | `step-transition`      |
| flow-3 | build-gap (currency selector missing — bug-045)                     | `step-transition`      |
| flow-4 | manifest-author (`page.route` can't mock backend calls)             | `timeout-no-evidence`  |
| flow-5 | build-gap (Table primitive doesn't exist in ui-kit)                 | `step-transition`      |
| flow-6 | build-gap (Filter button missing)                                   | `step-transition`      |
| flow-7 | build-gap (Reports page never fires `/api/reports`)                 | `timeout-no-evidence`  |
| flow-8 | seed-mismatch (flow expects "USD Cash", seed has "US Checking")     | `step-transition`      |
| flow-9 | seed-mismatch (flow expects "stale" badge, seed has fresh fx_cache) | `step-transition`      |

The current taxonomy collapses 3 distinct classes into one bucket. Then `scripts/file-bug-plan.mjs:675` does:

```js
function defaultAgentSequence(violation) {
  void violation;
  return ["web-frontend-builder", "tester", "reviewer"];
}
```

`void violation;` is the smoking gun — the function intentionally throws away the failure-class signal. Every bug gets the SAME agent regardless. For build-gap that's correct; for seed-mismatch and manifest-author it's wrong.

**Empirical cost if shipped as-is:** auto-dispatching `/fix-bugs` against this output would dispatch web-frontend-builder against 5 false-positive bugs (3 seed-mismatch + 2 manifest-author). At ~$0.10–$0.50/dispatch × 5 × up to 3 retries = ~$5 wasted per cycle. Worse: builders chasing seed-mismatch would either rename source (corrupting the real product to match the test's wrong expectation) or fail-loop indefinitely.

**Expected:** `primaryCause` discriminates the 3 classes; `defaultAgentSequence()` routes by class.

## Reproduction Steps

1. Project with synthesized E2E specs that include selectors not present in the build, AND seed-vs-flow mismatches, AND sloppy `:has-text` selectors. (Empirical: `finance-track-01` post-bug-048+049.)
2. Run the orchestrator-driven verifier (so synthesized specs auto-execute via `runSynthesizedFlows`).
3. Inspect `docs/bugs.yaml` — observe every entry has `agentSequence: [web-frontend-builder, tester, reviewer]`, regardless of the underlying cause.

## Root Cause Analysis

### Gap 1 — `primaryCause` taxonomy is incomplete

Current enum in `scripts/run-synthesized-flows.mjs:511`:

```js
let primaryCause;
if (runtimeErrors?.devServerOverlay) primaryCause = "dev-server-compile";
else if (isSeedSetupFailure) primaryCause = "seed-setup";
else if (hasRuntimeSignal) primaryCause = "runtime-error";
else if (isTimedOut && !meta.step) primaryCause = "timeout-no-evidence";
else primaryCause = "step-transition";
```

`step-transition` is the catch-all when nothing else matches — covers ALL of:

- Build doesn't render an element the design intended (build-gap)
- Build is fine; flow's selector is sloppy / hallucinated (manifest-author)
- Build + flow are both fine; baseline seed produces wrong state (seed-mismatch)

The discriminator for these three is **whether design intended the element** (cross-reference against `docs/screens/*.json`) — see sister plan **feat-049** for that work. Without the discriminator, `primaryCause` cannot widen safely.

### Gap 2 — `defaultAgentSequence()` ignores the cause

`scripts/file-bug-plan.mjs:671`:

```js
function defaultAgentSequence(violation) {
  void violation;
  return ["web-frontend-builder", "tester", "reviewer"];
}
```

Even with a richer taxonomy, the routing function has no branches. Need:

- `build-gap` → `[web-frontend-builder, tester, reviewer]` (current correct)
- `manifest-author` → `[user-flows-generator, reviewer]` (regen + verify)
- `seed-mismatch` → flag as `needs-operator-decision` (manifest re-author OR per-flow seed override per **feat-050** is an operator call)
- `seed-setup` → `[backend-builder, tester, reviewer]` (Strategy C `/test/seed-baseline` endpoint missing/broken)

## Approach

### Phase A — Taxonomy widening (depends on feat-049 landing first)

Extend `primaryCause` enum:

```js
type PrimaryCause =
  | "dev-server-compile"  // existing — cascade root
  | "seed-setup"          // existing — Strategy C beforeAll/afterAll fail
  | "runtime-error"       // existing — console/page/network errors
  | "timeout-no-evidence" // existing — opaque timeout
  | "build-gap"           // NEW — selector resolves in design (screens.json) but not in build
  | "manifest-author"     // NEW — selector doesn't resolve anywhere; flow-authoring sloppiness
  | "seed-mismatch"       // NEW — selector exists in build BUT flow expects different content/state
  | "step-transition";    // existing — fallback when no classifier signal fires
```

Classification logic uses feat-049's `screensCatalog` lookup: when a selector doesn't match an element on the current page, check whether ANY page in screens.json has an element matching it. Result feeds primaryCause:

| Selector matches        | Element present in build      | New primaryCause  |
| ----------------------- | ----------------------------- | ----------------- |
| screens.json            | NO                            | `build-gap`       |
| screens.json            | YES (different content/state) | `seed-mismatch`   |
| nothing in screens.json | N/A                           | `manifest-author` |

### Phase B — Agent routing in `file-bug-plan.mjs`

Replace `defaultAgentSequence()`:

```js
function defaultAgentSequence(violation) {
  switch (violation.primaryCause) {
    case "build-gap":
      return ["web-frontend-builder", "tester", "reviewer"];
    case "seed-setup":
      return ["backend-builder", "tester", "reviewer"];
    case "manifest-author":
      return ["user-flows-generator", "reviewer"];
    case "seed-mismatch":
      // Operator decision: re-author flow OR per-flow seed override (feat-050).
      // Mark for human triage; no auto-dispatch.
      return [];
    case "dev-server-compile":
    case "runtime-error":
    case "timeout-no-evidence":
    case "step-transition":
    default:
      return ["web-frontend-builder", "tester", "reviewer"];
  }
}
```

`seed-mismatch` returns empty → orchestrator's fix-bugs-loop skips dispatch and surfaces in the iteration summary as `needs-operator-decision`. Once feat-050 ships, manifest-extension authors get the per-flow seed primitive and can re-emit; until then, operator chooses path.

### Phase C — Schema + tests

1. `packages/orchestrator-contracts/src/build-to-spec-verify.ts` — extend `PrimaryCauseSchema` Zod enum with the 3 new values.
2. `orchestrator/tests/run-synthesized-flows.test.ts` — fixture-driven tests for all 3 new classifications (build-gap, manifest-author, seed-mismatch).
3. `orchestrator/tests/file-bug-plan.test.ts` — agent-routing tests per primaryCause.

## Success Criteria

- [ ] Phase A: `primaryCause` enum extended; classification logic correctly tags 9 finance-track-01 failures as 4 build-gap + 3 seed-mismatch + 2 manifest-author
- [ ] Phase B: `defaultAgentSequence()` routes by primaryCause; seed-mismatch returns empty
- [ ] Phase C: Zod schema updated; 3 + 4 = 7 new tests pass
- [ ] No regression: existing test suite stays green (632 → ~639)
- [ ] Cross-project: any subsequent project's verifier output respects the new taxonomy

## Cross-references

- Sister: `feat-049` — screens.json cross-reference (provides the discriminator this plan depends on)
- Sister: `feat-050` — per-flow seed orchestration (closes the seed-mismatch class)
- Sister: `bug-051` — selector quality (closes the manifest-author class via SKILL.md + lint)
- Parent: `feat-022-build-to-spec-verification` — the verifier framework this plan extends
- Empirical: 9-failure run on `projects/finance-track-01` 2026-05-03 (pre-feat-049/050 baseline)
