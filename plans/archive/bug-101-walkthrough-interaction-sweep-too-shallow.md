---
id: bug-101-walkthrough-interaction-sweep-too-shallow
type: bug
status: completed
author-agent: human
created: 2026-05-13
updated: 2026-05-14
outcome: shipped MVP — 3 of the 5 planned helpers (runAnchorClick, runFormSubmitAndCreate, runFilterCombine) wired into the per-route sweep. Cover empirical bug classes: anchor-scrolls-to-top, POST-422-form-submit, OR-not-AND-filter-logic. Theme-visual-diff + create-then-verify (subset of form-submit) deferred to Phase 2.
parent-plan: feat-066-fix-loop-effectiveness-v2 (v2-Phase-4) / feat-069 Phase G follow-up
supersedes: null
superseded-by: null
branch: fix/walkthrough-interaction-depth
affected-files:
  - scripts/ai-walkthrough.mjs
  - .claude/agents/walkthrough-reviewer.md
feature-area: verifier/walkthrough
priority: P1
attempt-count: 0
max-attempts: 5
error-message: "Walkthrough Tier 5 interaction sweep is a fixed set of 4 generic helpers (theme-toggle, search-fill, delete-click, tab-traversal). Real user-found bugs require interactions not in this set: form-submit-and-verify, anchor-click-and-assert-url, theme-visual-diff, filter-combine, create-and-verify-appears. Result: bugs of those classes never surface in walkthrough findings."
reproduction-steps: "1. Compare reading-log-02 user session 2026-05-13 manual-found bugs against walkthrough findings. 2. User found: 'Open documentation scrolls to top' (anchor failure), 'New Tag not functioning' (create flow), 'System theme same as Dark' (theme visual diff), 'OR not AND filter combination' (filter logic), 'POST /books 422 on save variants' (form submit + status enum). 3. Walkthrough surfaced none — its 4 helpers don't reach these interactions."
stack-trace: null
---

# bug-101: walkthrough interaction-sweep limited to 4 generic helpers (feat-069 Phase G follow-up)

## Bug Description

feat-069 Phase B.2 shipped 4 interaction helpers in `scripts/ai-walkthrough.mjs`:

- `runThemeToggle` — clicks theme button, cycles, captures.
- `runSearchFill` — types "test query", captures.
- `runDeleteClick` — clicks delete, confirms dialog, captures.
- `runTabTraversal` — presses Tab N times, captures focus path.

This catches: hydration errors (any page render), duplicate-request patterns (deterministic detector), a11y issues in tab order, delete-flow regressions. Empirically caught: DELETE-400 root cause, hydration mismatch on every page, badge-counts-in-aria-name.

What it MISSES: ~5 distinct interaction classes that empirical user testing found, every one a real product bug:

1. **Anchor-click + URL assertion** (Prompt 5: "Open documentation just scrolls to top"). Walkthrough doesn't follow anchor links + check page state change.
2. **Form-submit + create-and-verify** (Prompt 6: "New Tag not functioning"). Walkthrough doesn't fill forms, submit, then verify the new entity appears.
3. **Theme visual diff** (Prompt 7: "System same as Dark — no difference"). `runThemeToggle` cycles through themes + captures screenshots but doesn't COMPARE the captures pairwise for visual difference. If two themes produce indistinguishable pixels, walkthrough doesn't surface it.
4. **Multi-step filter combination** (Prompt 9: "OR not AND filter; status shows all books"). Walkthrough doesn't combine filter state and assert result-set count changes.
5. **Form validation + 422 capture** (Prompt 3: "POST /books 422 on every save variant"). Walkthrough captures network responses but doesn't TRIGGER form submits with the various valid input combinations the brief / user-flows describe.

## Fix Approach (Phase G of feat-069)

Extend `scripts/ai-walkthrough.mjs` with 5 new interaction helpers:

### `runAnchorClick(routeSlug)`

- Find first `<a href="#..."` OR `<a>` whose URL is in-app
- Capture `page.url()` BEFORE click
- Click + waitForLoadState
- Capture `page.url()` AFTER. Assert change. Capture scroll position. Manifest step.
- Catches: broken anchor / 404 link / wrong-target-route.

### `runFormSubmitAndCreate(routeSlug)`

- Find first form on page (`<form>` or `[role=form]`)
- Fill inputs with sentinel values (e.g. "walkthrough-probe-{timestamp}")
- Click submit button. Capture network response (200/201 = success; 4xx = product bug).
- After submit, verify the sentinel appears in DOM (e.g. as a list item).
- Catches: "submit silently fails", "422 validation mismatch", "create doesn't re-fetch list".

### `runThemeVisualDiff(routeSlug)`

- For each theme available (light/dark/system), cycle + capture full-page PNG.
- Pixel-diff each pair. If two themes produce >99% pixel match → file finding "themes visually indistinguishable".
- Catches: theme application broken, system-vs-dark equivalence.

### `runFilterCombine(routeSlug)`

- Find filter controls on page (status buttons, tag chips, etc).
- Toggle one filter, capture result-set count (via DOM selector or network response).
- Toggle a SECOND filter, capture count.
- If count after 2nd toggle is greater than after 1st → AND-semantic is violated (likely OR).
- Catches: filter-combination logic bug, status filter shows all.

### `runCreateThenVerify(routeSlug)`

- For routes whose user-flows declare "create" mutations (e.g. /tags creates new tag): fill the create form with sentinel, submit, then re-query the page for the sentinel as a list entry.
- Catches: "create button does nothing" / "create succeeds but list doesn't refresh".

## Wiring

Each helper follows the existing pattern:

- Returns manifest step OR null when affordance absent
- Captures pre/post network/console state
- Adds to per-route interaction sweep

Helper-selection from project flows:

- Default: run all 9 helpers on every route (graceful skip when affordance absent)
- Per-project override: `docs/user-flows-manifest.json` can declare `walkthroughHelpers: ["formSubmit", "filterCombine"]` for explicit selection

## Cross-references

- **feat-069 Phase G** — operator-triggerable standalone (deferred in original plan). bug-101 partially overlaps; the implementation here is a natural Phase G expansion.
- **bug-099** — perceptual element-absences. Together cluster #2+#5 from the 2026-05-13 root-cause analysis.
- **bug-103** — walkthrough doesn't iterate user-flows-manifest entries. bug-103 ships the META layer (which flows to walk); bug-101 ships the IMPLEMENTATION (what each step looks like).

## Attempt Log

### 2026-05-14 — MVP shipped (3 of 5 helpers)

Scope decision: ship the 3 highest-empirical-leverage helpers first; defer 2 nice-to-haves.

**Shipped** (`scripts/ai-walkthrough.mjs`):

1. **`runAnchorClick(routeSlug)`** — finds first in-app anchor (href starting with `/` or `#`, OR `role=link` non-http), captures URL + scroll position BEFORE click, clicks, waits 800ms for nav/scroll settle, captures URL + scroll AFTER. Manifest entry includes `urlChanged` + `scrollChanged` booleans for agent reasoning. Catches: anchor that scrolls to top instead of target (Prompt 5: "Open documentation just scrolls to top"), anchor whose route 404s, anchor with broken href.

2. **`runFormSubmitAndCreate(routeSlug)`** — finds first `<form>` on the route, fills all text/email/url/textarea inputs with `walkthrough-probe-<ts>` sentinel + selects first option for any `<select>` (skips date / hidden / file inputs). Registers a temporary response listener for POST/PUT/PATCH/DELETE methods to capture network outcomes during this step. Clicks the form's submit button. Captures `responseStatus` + `networkEvents` array + `sentinelVisible` (whether the sentinel appears in DOM post-submit). Catches: Prompt 3's `POST /books 422` class, silent-fail submits, create-but-list-doesn't-refresh patterns.

3. **`runFilterCombine(routeSlug)`** — finds ≥2 filter-style controls (`button[role=tab][aria-selected=false]` OR `button[aria-pressed=false]`), captures result-set count via a heuristic list-item selector (`[role=listitem], article, [data-list-item], li[role=article]`), toggles first filter + captures count, toggles second filter + captures count. Computes `isMonotonicNonIncreasing` heuristic: AND-combining filters should produce a non-increasing count sequence; if count INCREASES after a second toggle, OR-semantics is the likely cause. Catches: Prompt 9's "if tag and status set returns OR not AND" pattern.

**Wiring** — added to the per-route interaction sweep at the appropriate order:

```
runThemeToggle → runDeleteClick → runFilterCombine →
runFormSubmitAndCreate → runAnchorClick → runSearchFill → runTabTraversal
```

Ordering rationale:

- runFilterCombine: between delete-click + form-submit (toggle-only, no nav, no mutation)
- runFormSubmitAndCreate: AFTER delete-click (otherwise the freshly-created sentinel might get deleted on delete-click's pass) + BEFORE search-fill / anchor-click (those navigate away)
- runAnchorClick: AFTER form-submit (anchor nav may leave the page entirely) + BEFORE search-fill / tab-traversal

The existing route-restoration logic re-navigates to the canonical URL after each helper, so each helper gets the right route context.

**Deferred** (Phase 2 of bug-101 if empirical evidence shows the gap):

4. **`runThemeVisualDiff`** — cycle through themes (light/dark/system), pixel-diff each capture, flag when two themes produce >99% pixel match. Implementation requires `pixelmatch` or equivalent + careful capture-state management. Defer until empirical run shows it's needed (current `runThemeToggle` already captures themesObserved which the agent can review).
5. **`runCreateThenVerify`** — subset of `runFormSubmitAndCreate` (which already verifies `sentinelVisible` post-submit). If empirical evidence shows we need a separate helper for non-form create flows (e.g. inline-create-buttons that open dialogs), add it then.

**Testing**: existing 995/995 orchestrator suite still passes (no new tests added — the helpers follow the existing pattern + are inside the `runAiWalkthrough` closure, not directly exported). Empirical validation lands on next walkthrough run against a project with these affordances.

**Cross-impact**:

- The per-route sweep now runs 7 helpers (was 4). Each route's wall-clock cost goes up by ~6-8s (anchor + form + filter each ~2-3s). For a 5-route walkthrough that's +30-40s per run, well within budget.
- bug-103 (Pass B) + bug-101 (Pass A helpers) are complementary. Pass A's generic helpers run on every route; Pass B's manifest-driven flow walker runs the project's declared canonical flows. Together they cover both cross-project bugs + project-specific flows.
