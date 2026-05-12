---
id: bug-088-extend-perceptual-systemic-routing
type: bug
status: in-progress
author-agent: human
created: 2026-05-12
updated: 2026-05-12
parent-plan: feat-066-fix-loop-effectiveness-v2
supersedes: null
superseded-by: null
branch: fix/extend-perceptual-systemic-routing
affected-files:
  - scripts/file-bug-plan.mjs
  - orchestrator/tests/file-bug-plan-parity.test.ts
feature-area: orchestrator/fix-loop
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "post-bug-087, 15 element-name-categorized perceptual bugs failed bug-fixer; all structural; need systemic-fixer routing"
---

# bug-088: extend perceptual-divergence systemic-fixer routing to element-name categories

## Bug Description

bug-087's empirical Phase C run on reading-log-02 (paused at outer-iteration 1) processed 44 perceptual-divergence bugs:

- **5/5** operator-review-routed bugs → marked `needs-operator-review` instantly (zero spend) ✓
- **2/8** systemic-fixer-routed `missing-element` bugs → completed (6 still pending) ✓
- **3/29** bug-fixer-routed bugs → completed (the `(no-category)` bucket is mixed-success at bug-fixer)
- **15/29** bug-fixer-routed bugs → caught by bug-082 (unverified-completion)

**Failure distribution by category among the 15 bug-fixer failures:**

```
book-list-item   5  ← structural: covers + badges + dates + tags absent on book items
search           3  ← structural: search bar wide+centered vs narrow+left-aligned
nav              1  ← structural: count badges missing on nav items
branding         1  ← structural: brand logo + label absent
header           1  ← structural: subtitle format + sort control
filter-tabs      1  ← structural: count badges on filter tabs
tag-filter       1  ← structural: '+ N more' overflow button missing
(no-category)    1
copy-mismatch    1
```

The pattern: element-name categories (which I conservatively kept at bug-fixer in bug-087) are mostly **structural cross-component drift** — same shape as the `missing-element` / `layout` categories already routed to systemic-fixer.

## Reproduction Steps

1. Trigger any project's `/build-to-spec-verify` with the feat-068 stack + bug-087 active.
2. Wait for Tier 4 vision-LLM to file `perceptual-divergence` bugs with element-name categories.
3. Watch the bug-fixer dispatches return `taskOutcomes: completed` without committing (bug-082 catches), with the same shape as pre-bug-085 layout-regrouping failures.

Empirical: reading-log-02 feat-068 Phase D 2.0 / bug-087 Phase C — 15 bug-fixer dispatches failed, all on element-name categories.

## Root Cause Analysis

`scripts/file-bug-plan.mjs:defaultAgentSequence` post-bug-087:

```js
const SYSTEMIC_FIXER_CATEGORIES = new Set([
  "missing-element",
  "missing-component",
  "layout",
]);
// Element-name categories fall through to bug-fixer (default)
```

bug-087's conservative scope explicitly noted:

> Element-name categories (search, nav, branding, header, filter-tabs, tag-filter)
> stay at bug-fixer pending more empirical data — they describe WHERE not WHAT KIND.

The empirical data is now in: element-name categories ARE structural in practice. The naming (`search` / `nav` / etc.) describes a UI surface, but the underlying findings are about cross-component structural drift on that surface. systemic-fixer is the right lane.

## Fix Approach

### Phase A — extend SYSTEMIC_FIXER_CATEGORIES (~10min)

Add element-name categories to the existing set in `defaultAgentSequence`:

```js
const SYSTEMIC_FIXER_CATEGORIES = new Set([
  // bug-087 (bug-shape categories)
  "missing-element",
  "missing-component",
  "layout",
  // bug-088 (element-name categories — empirically structural)
  "book-list-item",
  "search",
  "nav",
  "branding",
  "header",
  "filter-tabs",
  "tag-filter",
]);
```

Categories that REMAIN at bug-fixer (intentionally):

- `copy-mismatch` — 1 of 3 failed empirically; small sample but bug-fixer's lane (single-element text from design source-of-truth).
- `(no-category)` — 3 of 4 succeeded at bug-fixer empirically. ~75% hit rate. Keep at bug-fixer.
- Future / unrecognized categories — default to bug-fixer (safe).

### Phase B — tests (~10min)

3 new tests cover the new categories (matches conservative scope decision):

1. `category: "book-list-item"` → `["systemic-fixer"]` (the highest-count failure category)
2. `category: "search"` → `["systemic-fixer"]` (multi-finding root cause)
3. `category: "nav"` → `["systemic-fixer"]` (count-badge structural drift)
4. Regression-preserve: `category: "copy-mismatch"` → `["bug-fixer"]` (still bug-fixer's lane)

### Phase C — empirical re-validation (~1hr wall-clock + ~$2-3)

Same reset-and-rereoute pattern as bug-087's Phase C. The 29 bug-fixer-routed perceptual bugs from the prior run get re-derived: ~20 will flip to systemic-fixer (the element-name categories), ~9 stay at bug-fixer.

Expected outcome based on systemic-fixer's empirical 100% rate on layout-regrouping (bug-085) + 25% rate on missing-element so far (2/8, but the rest are still pending):

- Target: systemic-fixer clears 50-80% of the re-routed bugs
- Combined with bug-087's 5 operator-review + bug-fixer's 4-of-9 successes → total perceptual fix rate ~70-80% expected

## Rejected Fixes

- **Route ALL element-name categories blindly** — the empirical data shows copy-mismatch (~33% success at bug-fixer) and (no-category) (~75% success at bug-fixer) are genuinely bug-fixer's lane. Adding them would waste systemic-fixer's higher dispatch cost.
- **Wait for feat-071 (clusterer) first** — clusterer reduces dispatch count but doesn't change which agent runs. Routing decision is upstream + independent. Ship bug-088 now; feat-071 amplifies later.
- **Move element-name routing into the discriminator (audit-computed-styles equivalent)** — bug-085 Phase B's deferred-discriminator approach. Same reasoning: file-bug-plan-side routing is sufficient + simpler.

## Validation Criteria

- [x] `defaultAgentSequence`'s perceptual-divergence case adds book-list-item, search, nav, branding, header, filter-tabs, tag-filter to SYSTEMIC_FIXER_CATEGORIES
- [x] copy-mismatch, no-category, future categories continue routing to bug-fixer
- [x] 4 new tests (3 systemic-fixer routes + 1 bug-fixer regression-preserve)
- [x] 58/58 file-bug-plan-parity green; 229/229 full sweep
- [ ] Empirical Phase C: re-run /fix-bugs reading-log-02 after Phase A lands. Expected: ~13 more perceptual bugs route to systemic-fixer (the 5 book-list-item + 3 search + 1-each of nav/branding/header/filter-tabs/tag-filter). systemic-fixer success rate ≥50% on those.

## Cross-references

- **bug-087** (`d179bd2`) — direct parent. bug-087 introduced the perceptual-divergence routing branch + the 3 bug-shape categories. bug-088 extends with 7 element-name categories.
- **bug-085** (`40defc9`) — the pattern this follows. Same shape: empirical data → expanded routing table.
- **bug-086** (`dc4521a`) — bug-085's element-name follow-up. Same pattern at a different layer.
- **feat-068** Phase A (`04b722b`) — the perceptual-review layer that produces these bugs.
- **feat-071** (cluster-bugs-pre-dispatch) — amplifies bug-088: the 5 book-list-item findings would cluster to 1 dispatch.
- **reading-log-02 bug-087 Phase C run 2026-05-12** — empirical case file. 44 perceptual bugs, 29 bug-fixer-routed, 15 failed.

## Attempt Log

### Attempt 1 — 2026-05-12 — Phase A+B landed

- **Phase A — extend SYSTEMIC_FIXER_CATEGORIES**: Added 7 element-name categories (book-list-item, search, nav, branding, header, filter-tabs, tag-filter) to the set in `scripts/file-bug-plan.mjs:defaultAgentSequence`'s perceptual-divergence case. Existing 3 bug-shape categories (missing-element, missing-component, layout) preserved. Decision rationale recorded inline in code comments.

- **Phase B — tests**: 4 new tests in `orchestrator/tests/file-bug-plan-parity.test.ts`:
  - `category: "book-list-item"` → `["systemic-fixer"]` (highest-failure-count category)
  - `category: "search"` → `["systemic-fixer"]` (multi-finding root cause)
  - `category: "nav"` → `["systemic-fixer"]` (structural)
  - `category: "copy-mismatch"` → `["bug-fixer"]` (regression-preserve)
  - Net: 58/58 file-bug-plan-parity; 229/229 full sweep.

- **Phase C — empirical re-validation pending**. Same reset-and-rereoute script pattern from bug-087.
