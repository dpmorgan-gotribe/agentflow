---
id: bug-105-stack-skill-layout-invariants
type: bug
status: completed
author-agent: human
created: 2026-05-14
updated: 2026-05-14
outcome: shipped — §2c AppShell layout invariants added to react-next/SKILL.md (full body with 5 invariants + self-verify checklist). svelte-kit/SKILL.md gets a mirror §2c with cross-reference (framework-agnostic Tailwind classes; only syntax differs). Codifies the 5 empirical violations from reading-log-02 Prompt 1 as invariants the builder MUST honor before reporting AppShell-class tasks complete.
parent-plan: investigate-027 (Path E recommendation)
supersedes: null
superseded-by: null
branch: fix/stack-skill-layout-invariants
affected-files:
  - .claude/skills/agents/front-end/react-next/SKILL.md
  - .claude/skills/agents/front-end/svelte-kit/SKILL.md
feature-area: stack-skills/layout-conventions
priority: P1
attempt-count: 0
max-attempts: 5
error-message: "Builders don't have explicit layout invariants for AppShell sidebar height, topbar width, brand wordmark placement, page-bottom element scroll-container — produces empirical bugs like 'sidebar only 227.333px not full height', 'topbar search not centered / Add-book not right-aligned', 'no logo / brand in topbar'. The kit's defaults don't enforce these visually-load-bearing conventions, and the builder has no spec saying it must."
reproduction-steps: "1. Build any project with AppShell layout. 2. Inspect rendered sidebar height — measure against viewport. 3. Empirical reading-log-02 user manual session 2026-05-13 Prompt 1: sidebar measures 227.333px instead of 100vh, search bar not centered in topbar, Add-book button not right-aligned, no Reading Log brand wordmark. All four are kit-default-doesn't-enforce-convention bugs; PM didn't enumerate them; builder picked defaults that visually break."
stack-trace: null
---

# bug-105: front-end stack skills lack explicit AppShell layout invariants

## Bug Description

Per investigate-027 (Path E recommendation 2026-05-14), the empirical reading-log-02 user-found bugs (Prompt 1) surface a common gap: kit-default layout decisions don't visually match user-design intent, and builders have no specification saying they MUST honor specific layout conventions when consuming AppShell.

The bug class is preventive — the right fix is documented invariants in the front-end stack skill that the builder reads as part of its dispatch context. Once codified, every builder dispatched against a Strategy-C-class project sees the same layout rules + honors them.

## Empirical motivator

reading-log-02 user manual session 2026-05-13 Prompt 1 user-found bugs:

1. **"Sidebar only 227.333px"** (clarified 2026-05-14: "i meant full height") — sidebar should extend full viewport height; kit default leaves it at content-height.
2. **"Topbar - search not centered"** — search input should be horizontally centered in the topbar's central slot.
3. **"Topbar - Add book not aligned right"** — Add-book CTA should sit at the topbar's right edge.
4. **"Topbar - no logo or Reading Log brand shown"** — brand wordmark should appear in topbar's left slot when the project has one.
5. **"Sidenav - doesn't show count of books and count of finished this year at the bottom"** — sidebar bottom slot should host the stats footer.

All 5 trace to the same gap: builder consumed AppShell with kit defaults; the kit's defaults don't enforce these layout invariants; the screen template's data-kit-component attributes don't carry the layout specifics; PM's tasks.yaml didn't enumerate them.

## Root Cause Analysis

The chain of responsibility:

1. **Kit defaults**: AppShell may render at content-height without explicit `min-h-screen` or `h-dvh`. Topbar slots may be unopinionated about which element goes where.
2. **Screen template**: emits `<div data-kit-component="AppShell">` but doesn't specify layout-modifier classes (e.g. `class="h-dvh"`).
3. **Builder dispatch context**: receives the screen template HTML + the kit's documented API surface, but no layout-decision rules. Picks the smallest reasonable JSX that satisfies the structural shape.
4. **Built output**: kit defaults applied, layout invariants violated.
5. **Tier 3 parity-verify**: compares mockup template vs built — both consumed the same kit, both produced the same broken layout, no drift.
6. **User**: sees the broken layout in production, files bug.

The right fix is at step 3 — give the builder agent explicit invariants in its stack-skill dispatch context.

## Fix Approach

Update `.claude/skills/agents/front-end/react-next/SKILL.md` with a new section `## §X — AppShell layout invariants`:

```markdown
## §X — AppShell layout invariants (factory-wide; preventive per bug-105)

When the project's architecture.yaml declares `apps.web.layout: app-shell` (typical
Strategy C / multi-tier project), the AppShell layout MUST honor the following
invariants regardless of what kit defaults produce:

### Vertical (height) invariants

- **Sidebar fills viewport height**: AppShellSidebar root must have one of
  `min-h-dvh`, `min-h-screen`, `h-dvh`, `h-screen`. Default kit AppShellSidebar
  may render at content-height; the explicit class is non-negotiable for apps
  shipping with sidenav.
- **Main content scroll-container**: AppShellMain must be the scrollable container
  (`overflow-y-auto`), so page-bottom elements like pagination, footer, stats
  block stay reachable. Empirical motivator: reading-log-02 user reported missing
  pagination / sidenav stats footer; root cause was main content not scrollable +
  elements rendered below the visible viewport.

### Horizontal (width) invariants

- **Topbar spans full viewport width**: AppShellHeader (the topbar) must be
  `w-full` AND span the entire horizontal viewport, NOT constrained by the
  sidebar's column.
- **Topbar slot allocation** (left → center → right):
  - LEFT: brand wordmark + logo when the project has a brand identity (check
    `docs/analysis/shared/styles.md` brand-context section for the project's
    brand name). Default kit AppShellHeader may leave this slot empty; the
    builder MUST emit it when the screen template includes brand element OR
    when the brief specifies a brand identity.
  - CENTER: primary search input when the screen has a search affordance
    (most lists do). Use `flex-1 flex justify-center` on the center slot.
  - RIGHT: primary CTA + utility actions (Add book / settings / profile).
    Use `flex items-center gap-2` for the cluster.
- **Sidebar minimum + maximum width**: 240px-280px typical. Anything below 240px
  cramps nav labels; anything above 280px wastes content space.

### Sidenav slot allocation

- **Top slot**: brand identity (alternative to topbar-brand for "icon-as-brand"
  designs).
- **Middle slot**: primary navigation items (Library / Tags / Settings / ...).
- **Bottom slot**: utility info — stats footer ("147 books / 23 finished this
  year"), version string, support link. Use `mt-auto` on the bottom slot to
  push it to the bottom of the (sidebar-height-filling) container.

### Self-verify

Before reporting a feature complete, the builder MUST visually verify:

1. Sidebar reaches the bottom of the viewport (open DevTools, check
   `getComputedStyle(sidebar).height` matches viewport height).
2. Topbar spans `100vw` (or `100% - scrollbar-width`).
3. Brand wordmark renders when the screen template / brief specifies one.
4. Sidebar bottom-slot renders when the screen template has a stats / utility
   element.

If any invariant fails, the feature is NOT complete — re-author the JSX to honor
the invariant.

### Cross-references

- **bug-105 (motivator)**: reading-log-02 user manual session 2026-05-13
  documented 5 layout-invariant violations in a single screen.
- **investigate-027 Path E**: this is the preventive (stack-skill content) layer
  complementary to Path A (structural — `data-token-*` annotations on screen
  templates).
- **bug-099**: perceptual fullPage capture lets Tier 4 SEE these violations
  post-build; bug-105 prevents them from being generated in the first place.
```

The svelte-kit stack skill receives the same section verbatim (substitute React-specific class names with Tailwind / vanilla CSS equivalents where applicable).

## Validation

- [ ] `.claude/skills/agents/front-end/react-next/SKILL.md` contains new §AppShell layout invariants section
- [ ] `.claude/skills/agents/front-end/svelte-kit/SKILL.md` contains analogous section
- [ ] Sections cite bug-105 + investigate-027 as motivators
- [ ] Self-verify steps explicitly require visual check of sidebar/topbar dimensions

Empirical validation: next gotribe project that uses AppShell layout — confirm the 5 specific layout-invariant bugs from reading-log-02's Prompt 1 do NOT reproduce.

## Cross-references

- **investigate-027**: parent investigation; bug-105 is its Path E recommendation.
- **bug-099**: perceptual review will catch these post-build (defense-in-depth).
- **bug-100**: PM mockup coverage audit catches mockup-element absences but doesn't enforce layout-shape — bug-105 fills the layout-decision-not-element-presence gap.
- **future feat-NNN (Path A)**: data-token-\* annotations on screen templates; structural complement to bug-105's preventive layer.

## Attempt Log

<!-- Populated by the agent or operator implementing the section. -->
