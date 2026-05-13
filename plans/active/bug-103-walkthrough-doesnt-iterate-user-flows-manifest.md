---
id: bug-103-walkthrough-doesnt-iterate-user-flows-manifest
type: bug
status: draft
author-agent: human
created: 2026-05-13
updated: 2026-05-13
parent-plan: feat-066-fix-loop-effectiveness-v2 (v2-Phase-4) / feat-069 Phase G follow-up
supersedes: null
superseded-by: null
branch: fix/walkthrough-from-user-flows-manifest
affected-files:
  - scripts/ai-walkthrough.mjs
  - docs/user-flows-manifest.json (per-project canonical)
feature-area: verifier/walkthrough
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "Walkthrough Tier 5 applies a FIXED set of 4 generic interaction helpers (theme/search/delete/tab) uniformly across all projects. The walkthrough does NOT read docs/user-flows-manifest.json — the canonical project-specific declaration of which user flows the app supports. Result: for projects whose canonical flows differ from those 4 helpers (e.g. shopping cart with add-to-cart-checkout, calendar with create-event-invite, doc-editor with type-format-save), the walkthrough exercises ZERO of the project's actual user-facing behavior."
reproduction-steps: "1. Generate a project with a non-reading-log shape (e.g. shopping cart). 2. PM authors docs/user-flows-manifest.json with flows like 'browse catalog → add to cart → checkout'. 3. Synthesizer reads the manifest, emits Playwright specs. 4. /build-to-spec-verify runs walkthrough Tier 5. 5. Walkthrough exercises theme/search/delete/tab and NOTHING else. The browse → add → checkout flow is never walked, so its bugs never surface in walkthrough findings."
stack-trace: null
---

# bug-103: walkthrough doesn't iterate user-flows-manifest entries (project-shape ambiguity)

## Bug Description

The AI walkthrough (feat-069 Tier 5) is currently a fixed 4-helper sweep applied uniformly to every project's discovered routes. The interaction set:

1. `runThemeToggle` — generic theme toggle CSS selectors
2. `runSearchFill` — generic search input CSS selectors
3. `runDeleteClick` — generic delete-button + confirm-dialog CSS selectors
4. `runTabTraversal` — keyboard Tab × 8 capture

For reading-log-02 these happened to map to real user behavior because that project has a search input, theme toggle, delete buttons, and the bug-094 family of delete-click bugs was a known concern. For ANY OTHER project shape — shopping cart, calendar, doc editor, kanban board, social feed — the walkthrough never exercises the project's actual canonical flows.

The factory ALREADY has the project-shape signal at `docs/user-flows-manifest.json` (consumed by `scripts/synthesize-flow-e2e.mjs` to emit Playwright specs). The walkthrough should consume the SAME signal so its exploration matches the project's declared user flows.

## Empirical motivator

User question 2026-05-13: "is this project ambiguous or are we directly adding cases for reading-log-02 - ultimately every app works differently so downstream needs to have captured all the walkthroughs that the AI walkthrough will take at the end of project."

The user correctly identified the gap. Current walkthrough is partly project-derived (route list from `screens.json`) but the INTERACTION DEPTH is hardcoded.

## Architectural shape

The walkthrough should be a 2-pass exploration per route:

**Pass A — generic discovery sweep** (today's existing 4 helpers): exercises common UI primitives that every web app shares — search, theme, delete-with-confirm, keyboard nav. These catch CROSS-PROJECT bugs (hydration, focus order, duplicate requests).

**Pass B — flow-derived sweep** (NEW per bug-103): for each entry in `docs/user-flows-manifest.json` whose `requiredState` matches the current route's screen-id, execute that flow's `interactions[]` steps via Playwright. Capture network + console + screenshots as today.

For the manifest's entry like:

```json
{
  "id": "flow-3",
  "name": "Book create flow",
  "interactions": [
    { "kind": "navigate", "url": "/" },
    { "kind": "click", "selector": "role=button[name='Add book']" },
    {
      "kind": "fill",
      "selector": "input[placeholder*='title']",
      "value": "Walkthrough Probe"
    },
    {
      "kind": "fill",
      "selector": "input[placeholder*='author']",
      "value": "Test Author"
    },
    { "kind": "click", "selector": "role=button[name='Save book']" }
  ]
}
```

Pass B executes those 5 steps verbatim, capturing the network for the POST. The bug-102 POST 422 finding would have surfaced via this path; the bug-101 "New Tag not functioning" finding too.

## Fix Approach

### Step 1 — read the manifest in `runAiWalkthrough`

Extend `scripts/ai-walkthrough.mjs` to read `<projectDir>/docs/user-flows-manifest.json` at the top of `runAiWalkthrough()`. If absent, skip Pass B silently (graceful fallback to today's Pass-A-only behavior).

### Step 2 — execute each declared flow as a walkthrough step

For each manifest flow:

- Reuse the SYNTHESIZER'S step → Playwright translation (refactor `scripts/synthesize-flow-e2e.mjs` to extract the step-translator into a shared helper)
- Execute step-by-step in the walkthrough's already-open page context
- Capture network deltas + console errors per step
- Add each step to `manifest.json` with kind `flow-step` + flow-id + step-index

### Step 3 — agent prompt update

Extend `.claude/agents/walkthrough-reviewer.md` prompt: when reviewing `manifest.json`, distinguish `kind: flow-step` from `kind: route-visit / search-fill / etc.`. Flow-steps are CANONICAL user paths — bugs surfaced from them have higher severity than bugs surfaced from generic Pass-A helpers (which might be exercising affordances the brief doesn't claim).

### Step 4 — graceful degradation

When the manifest has zero flows OR all flows have `kind: route-visit-only` (read-only paths), Pass B is a no-op. The walkthrough falls back to Pass-A-only. This matches today's behavior for projects without rich flow declarations.

### Step 5 — synthesizer alignment

Bug-101's new helpers (form-submit, anchor-click, filter-combine, etc.) can ALSO be invoked from Pass B's flow-step interpretation when the manifest's step kind matches. So bug-101 + bug-103 are complementary: bug-101 ships the IMPLEMENTATION primitives; bug-103 ships the DRIVER that decides what primitives to invoke per project.

## Validation Criteria

- [ ] Walkthrough on reading-log-02 reads its 6-flow manifest + executes each flow's interaction sequence (≥30 walkthrough steps total across all flows)
- [ ] Walkthrough on a non-reading-log project shape (e.g. test fixture with shopping-cart flows) executes the shopping-cart flows + emits findings for any anomalies
- [ ] Generic Pass-A helpers continue to work (no regression)
- [ ] Cost projection ≤ +50% over today's $0.40-$1.00/run (manifest flows are typically 5-10 steps each; not LLM-dispatch-multiplying)

## Cross-references

- **bug-101** — walkthrough interaction-sweep too shallow. bug-101 ships the helper primitives; bug-103 ships the project-shape driver that calls them.
- **feat-069 Phase G** — operator-triggerable standalone (deferred). bug-103 + bug-101 together fulfill Phase G.
- **scripts/synthesize-flow-e2e.mjs** — currently the ONLY consumer of `user-flows-manifest.json`. bug-103 makes the walkthrough the second consumer + factors out the step-translator.
- **feat-038** — deepen synthesize-flow-e2e-and-data-seeding. The manifest schema bug-103 reads from is the same one feat-038 deepened.

## Attempt Log

<!-- Populated by executing agents. -->
