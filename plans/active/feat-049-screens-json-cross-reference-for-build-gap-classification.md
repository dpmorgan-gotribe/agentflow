---
id: feat-049-screens-json-cross-reference-for-build-gap-classification
type: feature
status: draft
author-agent: claude-opus-4-7
created: 2026-05-03
updated: 2026-05-03
parent-plan: feat-022-build-to-spec-verification
supersedes: null
superseded-by: null
branch: feat/screens-json-cross-reference
affected-files:
  - scripts/run-synthesized-flows.mjs
  - scripts/build-screens-catalog.mjs
  - packages/orchestrator-contracts/src/build-to-spec-verify.ts
  - orchestrator/tests/run-synthesized-flows.test.ts
  - .claude/skills/screens/SKILL.md
feature-area: orchestration
priority: P1
attempt-count: 0
max-attempts: 5
---

# feat-049 — Screens-catalog cross-reference for build-gap vs manifest-author classification

## Problem Statement

bug-050 needs a way to discriminate two failure classes:

- **build-gap** — flow targets element that EXISTS in design (`docs/screens/*.json` or the `data-screen-id` markers in mockups) but NOT in the rendered build → builder must wire it
- **manifest-author** — flow targets element that EXISTS NOWHERE — neither in design nor build → flow author hallucinated → user-flows-generator must regenerate

Without this discriminator, `primaryCause` collapses both into `step-transition` (per bug-050 §Gap 1) and the routing in `file-bug-plan.mjs` can't tell builder-fix from flow-regen.

The factory already CARRIES the ground truth: `/screens` skill emits `data-screen-id="{id}"` + `data-kit-component="{name}"` markers on every element it places (per the SKILL.md §4e.1 contract), and screens.json metadata captures the layout intent. The verifier just doesn't consult them at classification time.

## Approach

### Phase A — Build a screens catalog at /build-to-spec-verify time

New script `scripts/build-screens-catalog.mjs` consumes `docs/screens/*.json` + the rendered HTML mockups and emits a flat in-memory map:

```ts
type ScreensCatalog = {
  // Every element with data-screen-id OR data-kit-component, indexed by both.
  byKitComponent: Map<
    string,
    Array<{ screenId: string; name?: string; role?: string; text?: string }>
  >;
  byScreenId: Map<
    string,
    Array<{
      kitComponent?: string;
      name?: string;
      role?: string;
      text?: string;
    }>
  >;
  byRoleName: Map<string, Array<{ screenId: string; kitComponent?: string }>>;
};
```

Walks each mockup HTML's DOM (using `node-html-parser`, already a transitive dep) → extracts `data-kit-component`, `data-screen-id`, accessible name, role, surface text → builds the maps.

Cost: trivially fast (~50ms for 30 screens × 100 elements). Runs once at verifier startup, passed to runner via context.

### Phase B — Selector→catalog matcher

`scripts/run-synthesized-flows.mjs` gets a new `classifySelector(selector, catalog)` helper:

```ts
function classifySelector(selector, catalog): "in-design" | "not-in-design" {
  // Parse common selector shapes:
  //   [data-kit-component="X"]                → catalog.byKitComponent.has("X")
  //   role=button[name="Y"]                  → catalog.byRoleName.has("button|Y")
  //   [data-kit-component="X"]:has-text("Y") → catalog.byKitComponent + text-substring match
  // Returns "in-design" if ANY screen's catalog entry matches; else "not-in-design".
}
```

When a flow fails on a locator step, the runner extracts the failing selector from `meta.selector` (already captured) and runs `classifySelector` to drive the new `primaryCause`:

| `classifySelector` result | DOM at failure has the element? | primaryCause      |
| ------------------------- | ------------------------------- | ----------------- |
| `in-design`               | NO                              | `build-gap`       |
| `in-design`               | YES (different state)           | `seed-mismatch`   |
| `not-in-design`           | N/A                             | `manifest-author` |

### Phase C — Plumbing into the runner contract

1. `runSynthesizedFlows()` accepts a new `screensCatalog` param (optional; falls back to `manifest-author` when absent so legacy projects keep working).
2. `BuildToSpecVerifyContext` plumbs the catalog through.
3. The wrapper in `orchestrator/src/build-to-spec-verify.ts` builds the catalog before calling `runSynthesizedFlows`.

### Phase D — `/screens` SKILL.md tightening

Document the contract: every element MUST carry `data-kit-component="{name}"` (when consuming a kit primitive) AND `data-screen-id="{id}"` on the topmost element of each screen. Failures of the catalog matcher will manifest as false `manifest-author` flags — the cure is for /screens to emit the markers consistently.

## Success Criteria

- [ ] Phase A: `build-screens-catalog.mjs` ships with happy-path + edge-case tests
- [ ] Phase B: `classifySelector()` correctly tags `[data-kit-component="Table"]` (finance-track-01 flow-5) as `in-design` IF the screens specify Table, else `manifest-author`
- [ ] Phase C: Verifier wrapper builds the catalog + plumbs to runner; catalog absence falls back to current `step-transition` behavior (no regression)
- [ ] Phase D: `/screens` SKILL.md contract section explicit + audit for retroactive coverage of shipped projects
- [ ] Empirical: re-running verifier on finance-track-01 produces the bug-050 classification table (4 build-gap + 3 seed-mismatch + 2 manifest-author)

## Decision: catalog from screens.json vs DOM-walk of mockups

Two sources of truth:

1. **screens.json** — the `/screens` skill's structured output. Authoritative but only as complete as the screen author was.
2. **HTML mockup DOM walk** — actually-rendered elements. More complete but coupled to mockup quality.

Recommend BOTH: catalog merges both sources, with mockup DOM as the higher-fidelity layer. Rationale: any element that physically renders in the design mockups counts as "in-design" even if screens.json doesn't enumerate it.

## Cross-references

- Sister: `bug-050` — consumes this plan's catalog to extend `primaryCause` taxonomy
- Sister: `feat-050` — per-flow seed orchestration (closes the seed-mismatch class once classified)
- Sister: `bug-051` — `/user-flows-generator` selector quality (reduces `manifest-author` rate at the source)
- `/screens` SKILL.md §4e.1 — `data-screen-id` contract
- Each shipped frontend stack-skill §1c — `data-screen-id` mirroring contract
