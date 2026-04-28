---
id: investigate-009-built-vs-designed-visual-parity
type: investigation
status: completed
author-agent: claude-opus-4-7
recommendation-implemented-by: feat-028-visual-parity-verifier
created: 2026-04-28
updated: 2026-04-28
completed-at: 2026-04-28
parent-plan: feat-022-build-to-spec-verification
supersedes: null
superseded-by: null
branch: null
affected-files: []
feature-area: orchestration
priority: P0
attempt-count: 1
max-attempts: 5
time-box-minutes: 60
hypothesis: "investigate-006's option survey deferred screenshot-diff (Option #2) as 'high engineering cost, lower marginal catch over flow-E2E'. Kanban-10 evidence (2026-04-28) contradicts that — manual inspection shows substantial visual divergence between built screens (apps/web/) and designed mockups (docs/screens/webapp/) that NO current verifier stage catches. Flow execution + reachability + runtime errors + brief coverage cover behaviour, structure, runtime safety, and spec coverage — but NOT 'does the built page LOOK like the design'. The right v1 approach is probably structural DOM-diff (compare data-kit-* attribute trees + key spacing/color tokens) rather than pixel diff (which over-fires on font rendering / antialiasing / browser quirks)."
---

# investigate-009 — How do we make sure the built app matches the designed screens?

## Question

The kanban-webapp-10 manual inspection (2026-04-28) shows substantial visual differences between the built app at `apps/web/` and the designed mockups at `docs/screens/webapp/*.html`. None of the current or planned verifier stages (feat-022 reachability, feat-022/025 flow execution, feat-026 auto-fix loop, feat-027 runtime errors, feat-023 PM brief coverage) detect these visual gaps. What mechanism should the factory introduce to catch them — and is the cost/complexity now justified given the kanban-10 evidence that contradicts investigate-006's earlier deferral?

## Hypothesis

investigate-006's deferral of "screenshot diff" (Option #2) was based on the assumption that flow execution + reachability would catch most user-impacting gaps. Kanban-10 invalidates that assumption — the app is functionally close to spec (clicks work, modals open, transitions land on the right screen-ids) but VISUALLY substantially different (layout, spacing, colors, component composition).

Three plausible v1 approaches, in increasing cost/coverage:

1. **Structural DOM-diff** — compare the `data-kit-*` attribute tree of built page vs mockup. The factory's HTML mockups already embed `data-kit-component`, `data-kit-variant`, `data-kit-layout` attributes as the deterministic translation contract (per `/screens` skill); built React components preserve these. A walk + structural-diff catches "kit primitive mismatch" (e.g. mockup says `data-kit-component="Button" data-kit-variant="primary"` but built page renders `data-kit-variant="ghost"`). Misses: pure style drift, custom-CSS overrides.
2. **Token-level CSS audit** — at each screen, snapshot the computed-style values for a curated list of tokens (`--color-accent-500`, `--radius-md`, etc.) on key elements. Compare against the mockup's computed styles. Catches color/spacing/radius drift; misses layout shifts.
3. **Pixel screenshot diff** — Playwright screenshot at fixed viewport, compare against mockup screenshot via Pixelmatch / Resemble.js. Catches everything; over-fires on font rendering, scrollbar widths, antialiasing, browser-version drift. Industry-standard but operationally heavy (golden screenshot management, threshold tuning, CI flake).

Hypothesis: **#1 + #2 combined** beats #3 for our gap distribution at much lower cost. Pixel diff is the right answer ONLY IF we can solve the operational pain (Chromatic / Percy do this with managed services; we'd be hand-rolling).

## Investigation Steps

### Step 1 — Catalog actual kanban-10 visual divergences (15 min)

Open dev server (already running at localhost:3001). For 3-5 screens (`empty-no-board`, `home`, `card-modal`, `settings`, `search-empty`):

- Open the rendered page in Chrome
- Open the mockup HTML at `projects/kanban-webapp-10/docs/screens/webapp/<id>.html` side-by-side
- Note differences across these axes:
  - Component composition (kit primitives present? variants match?)
  - Layout (sidebar width, content padding, card density)
  - Color (accent token application, surface contrast)
  - Typography (font family loaded? size scale?)
  - Spacing (radius, shadow, gap)
  - Behaviour vs visual: mark which gaps would be caught by feat-022's flow synthesizer vs would be missed

Write findings as a table; aim for ≥10 concrete divergences across the 5 screens. Pattern-cluster them (composition / layout / color / typography / spacing).

### Step 2 — Audit existing factory primitives we can reuse (10 min)

- `/visual-review` skill — what does it currently do? Could it be re-pointed at the BUILT app (vs the mockups it currently checks)?
- `scripts/visual-review-preflight.mjs` — already starts a dev server + drives Playwright MCP; can the same harness power post-build visual comparison?
- `data-kit-*` attribute coverage — what's the actual emission rate? Spot-check a few mockups + matching built components to confirm parity is detectable.
- `docs/screens/webapp/*.html` — are the mockups self-contained (Tailwind CDN inlined) so a Playwright run at the same viewport produces a comparable screenshot?
- Reviewer-playbook §1 architecture / §6 performance — do any criteria touch visual fidelity today?

### Step 3 — Survey the option space + industry precedent (15 min)

For each of the 3 hypothesis approaches (DOM-diff, token-CSS audit, pixel diff):

- Effort estimate (LOC, new deps, ops complexity)
- Catch rate against the divergences from Step 1
- False-positive risk
- Integration point (post-Mode-B verify slot, alongside feat-022 reachability)

External survey (≤5 web fetches):

- Storybook + Chromatic — what's the actual workflow? Pricing? Self-host options?
- Percy / Argos — same questions
- Playwright's `toHaveScreenshot()` — built-in; how does it handle thresholds + golden management?
- Resemble.js / Pixelmatch — bare-metal alternatives
- "AI-codegen visual verification" — anything novel in the space?

### Step 4 — Cost / coverage / complexity matrix + recommendation (10 min)

For the 3 approaches × the kanban-10 divergences from Step 1:

- Which approach catches X of N divergences
- One-line "why this beats / loses to" alternatives
- Recommended primary v1 + backup
- Sketch a `feat-028-visual-parity-verifier` mini-spec (3-5 bullets, not a full plan)

If the answer is "structural DOM-diff is enough for v1 + pixel diff is v2" — articulate the cutover criteria (e.g., "ship pixel diff once we have N projects shipped + a Chromatic-equivalent budget").

### Step 5 — Re-litigate investigate-006's deferral (5 min)

investigate-006 explicitly considered Option #2 (screenshot diff vs `docs/screens/<id>.html`) and recommended deferring. Was that decision wrong, or right-at-the-time but now wrong-given-evidence? Document the lesson — does investigate-007's framework need a "re-evaluate after N runs" cadence?

## Findings

### Step 1 — Catalog of kanban-10 visual divergences (mockup vs built, read-only)

Compared `projects/kanban-webapp-10/docs/screens/webapp/*.html` against `apps/web/app/**` + `apps/web/src/components/**` for 6 screens. Did NOT touch the running dev server (b9zlz1jwb); read source only. **15 concrete divergences cataloged**, clustering into 5 patterns.

| #   | Screen         | Axis           | Mockup says                                                                                                                                                                                       | Built renders                                                                                                                                                                                                            | Pattern                                 |
| --- | -------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| 1   | empty-no-board | Composition    | Full AppShell with sidebar (wordmark + "No boards yet" empty list + Settings link) + topbar (Welcome + theme + settings icon buttons) + EmptyState body                                           | `<div class="flex flex-1 items-center justify-center"><EmptyState/></div>` — **no AppShell, no sidebar, no topbar**                                                                                                      | A: shell-stripping                      |
| 2   | empty-no-board | Composition    | EmptyState has SVG glyph (rect + lines) + headline + 420px description + lg primary button "Create your first board" + tertiary helper "New board defaults to To Do · In Progress · Done"         | EmptyState has no glyph, generic title, generic description, md button labelled "Create Board"                                                                                                                           | B: copy + size drift                    |
| 3   | empty-no-board | Typography     | Headline `text-2xl font-bold tracking-tight`                                                                                                                                                      | EmptyState heading hard-coded to `text-[18px] font-semibold`                                                                                                                                                             | C: token drift                          |
| 4   | home           | Composition    | Topbar = title + global SearchCombobox (with `/` kbd hint) + theme toggle + settings icon (3-cell grid)                                                                                           | BoardHeader = title + tiny "{n} columns · {n} boards" caption + SearchInput pushed right; **no theme toggle, no settings icon**                                                                                          | A: missing primitives                   |
| 5   | home           | Composition    | FilterBar with "Filter" label + chips (All / design / a11y / infra / High priority danger-styled) + "{n} cards · {n} columns" caption                                                             | FilterChips component (separate file) — different layout, no caption                                                                                                                                                     | A: layout-axis                          |
| 6   | home           | Layout         | KanbanBoard = `grid-template-columns: repeat(N, minmax(280px, 1fr))`; column-bottom "Add a card" button border `1px dashed var(--color-border-default)`                                           | DndBoard renders columns; built source has different sizing primitives (not verified pixel-equal)                                                                                                                        | E: spacing tokens                       |
| 7   | home           | Composition    | Bottom-of-main "Add a column" affordance with dashed border, min-width 280px                                                                                                                      | No "Add column" affordance in DndBoard                                                                                                                                                                                   | A: missing affordance                   |
| 8   | card-modal     | Composition    | Two-pane: left = description + tabs (write/preview); right = sidebar with Status/Priority/Tags/Due-date/Activity                                                                                  | CardDetailModal uses `<Dialog>` w/ flat layout; description uses `<Textarea>` + tab buttons; right pane present but token/spacing-different                                                                              | D: layout regrouping                    |
| 9   | settings       | Composition    | AppShell sidebar identical to home + topbar with **Breadcrumbs primitive** ("kanban / Settings") + theme/settings icon buttons                                                                    | AppShell sidebar (BoardSidebar — different from mockup sidebar; no wordmark, kebab menus) + Link-based breadcrumbs (no Breadcrumbs primitive)                                                                            | A + D                                   |
| 10  | settings       | Composition    | Settings body = single max-width column with 3 cards: Theme (segmented control) / Data (export+import) / Reset                                                                                    | Settings body = `max-w-[720px]` flex-col stack with 4 panels (ThemePanel/Export/Import/Reset)                                                                                                                            | D: section count                        |
| 11  | settings       | Typography     | Section headings appear once with consistent `text-2xl font-bold` for page header                                                                                                                 | Page header `text-2xl font-bold tracking-tight`; ThemePanel uses `text-base font-semibold` for section heading                                                                                                           | C                                       |
| 12  | search-empty   | Composition    | Inline message inside Filter bar context with active filter chips visible above                                                                                                                   | Standalone full-screen `🔍` emoji + heading + filter summary + "Clear filters" button — **no surrounding board chrome**                                                                                                  | A: shell-stripping                      |
| 13  | not-found      | Layout         | FocusedTask layout, EmptyState pattern with sad-face SVG + 360px description + small primary button with arrow icon "Return to your boards"                                                       | Bare `<main>` with select-none `text-8xl 404` numeral + heading + max-w-sm + Link styled as button                                                                                                                       | A + D: completely different composition |
| 14  | all screens    | Color/identity | Tokens applied via CSS custom props (`var(--color-accent-soft)`, `var(--color-border-default)`, `var(--color-semantic-danger)`)                                                                   | Tailwind utility classes (`bg-accent/10`, `border-border-subtle`, `text-semantic-danger`) — **mostly equivalent but no programmatic check**                                                                              | C: no parity verifier                   |
| 15  | all screens    | Identity       | Mockup `<body data-kit-layout="AppShell">` and EVERY composed primitive carries `data-kit-component="X" data-kit-variant="Y" data-kit-props='...'` attributes (48 occurrences in home.html alone) | Built React: `data-kit-*` attribute count is **0** across `apps/web/src/` and `apps/web/app/` (grep). The `@repo/ui-kit` primitives (`EmptyState`, `AppShell`, `Button`) **do not emit** `data-kit-*` attrs in their JSX | F: contract-broken                      |

**Pattern clusters:**

- **A — Shell-stripping (5 hits: #1, #4, #5, #7, #12)**: builders treat each "screen" as a content island and forget the shared chrome (sidebar, topbar, surrounding bars) the mockup explicitly wraps it in. Most user-visible class.
- **B — Copy + sizing drift (1 hit: #2)**: the mockup's specific button label / size dial / helper text gets simplified to a generic shorter version.
- **C — Token / typography drift (3 hits: #3, #11, #14)**: kit primitives bake hard-coded sizes (`text-[18px]`) instead of consuming the mockup's stated `text-2xl` token; CSS-var vs Tailwind utility paths agree by convention only.
- **D — Layout regrouping (3 hits: #8, #9, #10, #13)**: same content, different containment hierarchy (3 panels vs 4, 2-pane modal vs flat dialog, FocusedTask layout dropped).
- **E — Spacing-token drift (1 hit: #6)**: mockup `var(--space-7)` paddings vs built Tailwind utilities at slightly different scale.
- **F — Identity contract broken (1 hit: #15, BUT compounds the rest)**: every other pattern would be cheap to detect IF the kit emitted `data-kit-*` attrs into built DOM. It does not.

**Behaviour vs visual gap analysis:**

- feat-022 flow synthesizer (scripted Playwright) catches: 0/15. All flows still pass — buttons exist, click → transition lands on the right screen-id. Visual composition is unchecked.
- feat-022 reachability catches: 0/15. Every component IS imported.
- feat-027 runtime-errors catches: 0/15. App boots clean.
- feat-023 PM brief coverage catches: ~0–1 (might catch #7's missing "Add column" affordance IF brief §12 enumerates it).
- **Net: ≥14/15 divergences ship green through every existing/planned verifier.**

### Step 2 — Audit of existing factory primitives

| Primitive                             | Reusable for built-vs-design parity?                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/visual-review` skill + `rubric.md`  | **HIGH**. Already does 3-viewport screenshot via Playwright MCP, runs a 28-rule rubric agent. Today it runs on `docs/screens/<id>.html`; could be re-pointed at the BUILT app at `http://localhost:3001/{route}` with the same harness. The rubric checks intrinsic quality (composition / type / color / motion / mobile / slop-sniff) — would need a NEW rubric (or new section) for "match the mockup".                  |
| `scripts/visual-review-preflight.mjs` | **HIGH**. Already starts a static http-server with port-collision handling + Windows-safe teardown. Drop-in for serving either side of the comparison. Already used by Layer-7 design-stage review.                                                                                                                                                                                                                         |
| `data-kit-*` attribute coverage       | **BROKEN AS-IS**. Mockups emit (48× in home.html). `@repo/ui-kit/src/patterns/empty-state/index.tsx` does NOT pass `data-kit-component="EmptyState"` to the rendered `<div>` — confirmed by grep across `apps/web/src/` returning zero `data-kit-*` matches. **This is the single highest-leverage fix: make the kit emit the same attrs its mockups already use.** Cheap (one prop per primitive, ~30 LOC across the kit). |
| Reviewer playbook §1/§6               | **LOW**. No visual-fidelity dimension today. Dimension 7 (brief-delivery) is text-based.                                                                                                                                                                                                                                                                                                                                    |
| `docs/visual-review/report.json`      | **MEDIUM**. Schema already exists for per-screen pass/fail + violations; could host a parallel `parity[]` block.                                                                                                                                                                                                                                                                                                            |
| Playwright MCP                        | **HIGH**. Browser already wired into design pipeline; reusable for built-app capture.                                                                                                                                                                                                                                                                                                                                       |

**Key enabler discovered**: the `data-kit-*` contract is **half-implemented**. Mockups + the `/screens` skill enforce it religiously on the design side; the `/stylesheet` skill (which generates the kit) and the `web-frontend-builder` (which consumes it) silently drop it. Restoring this contract makes structural DOM-diff almost free.

### Step 3 — Option-space survey + industry precedent

Three v1 mechanisms scored against the 15 divergences from Step 1.

| Mechanism                                                                                                                                          | Catches                                                 | Misses                                                                   | Effort                                                                                                                                                                                                                                                        | False-positive risk                                                                                                                                                                   | Integration                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **#1 — Structural DOM-diff via `data-kit-*` trees**                                                                                                | A (5/5), D (3/3), F (1/1), partial B (1/1) = **~10/15** | C token drift, E spacing drift, intrinsic styling                        | **Medium-LOW**. Two parts: (a) ~30 LOC across `@repo/ui-kit` primitives to pass `data-kit-*` props through; (b) ~250 LOC walker that normalises both DOMs to a `data-kit-*` skeleton tree + diffs hierarchy. Reuse `visual-review-preflight.mjs` for serving. | LOW. Works on a stable, mockup-authored vocabulary. False-positives only if mockups emit attrs the kit can't.                                                                         | New skill `/parity-verify` post-Mode-B; bug plans on diff. |
| **#2 — Token-level CSS audit** (Playwright `evaluate(getComputedStyle)` on a curated element list, compare against mockup computed-style snapshot) | C (3/3), E (1/1), partial A (~1/5) = **~5/15**          | composition (#1, #4, #7, #12), copy (#2), layout regrouping (#8/9/10/13) | Medium. Need: curated selector list per screen, computed-style snapshot harness, threshold-tolerant comparator (px ≈ px ± 1).                                                                                                                                 | MEDIUM. Browser-version drift in computed values (e.g. resolved font shorthands).                                                                                                     | Same slot as #1; complementary.                            |
| **#3 — Pixel screenshot diff** (Playwright `toHaveScreenshot()` with `maxDiffPixels`)                                                              | All 15 in principle                                     | None — but at the cost of very high false-positive rate                  | High operationally. Need: golden management (hash docs/screens/\* HTML to a baseline PNG), threshold tuning per screen, retention strategy on intentional mockup edits, OS-pinned CI.                                                                         | **HIGH**. Per Playwright docs, host-OS antialiasing + scrollbar widths are explicit footguns. Per Applitools' write-up, raw pixel diff is industry-acknowledged false-positive heavy. | Same slot; flaky-test budget concerns.                     |

**Industry precedent (5 fetches/searches):**

1. **Playwright `toHaveScreenshot()`** — built-in, free; goldens stored as `*.spec.ts-snapshots/*.png` keyed by `{name}-{browser}-{platform}`. `maxDiffPixels` + `maxDiffPixelRatio` + `threshold` knobs. Docs explicitly warn: "Browser rendering can vary based on the host OS, version, settings, hardware. Use the same environment where the baseline screenshots were generated." → CI environment pinning required, which we don't have for self-hosted runs.
2. **Chromatic** — managed Storybook visual regression service (component-level, not page-level). Pricing per snapshot; not a fit for our slot (we don't ship Storybook to projects).
3. **Percy / Applitools** — page-level VRT services; managed. Applitools claims "Visual AI" using CV models that classify regions semantically (button vs text vs image) to filter out anti-alias noise — interesting but a paid SaaS we can't bake into the autonomous pipeline cheaply.
4. **Resemble.js / Pixelmatch** — bare-metal pixel diff libraries; same false-positive surface as Playwright's built-in (it uses Pixelmatch).
5. **2026 industry consensus** (per the search results: getautonoma, vizproof, bug0): "AI-generated UI" code is the dominant new VRT use case in 2026; the consensus answer is **structural / semantic diff, not pixel diff**, because AI-codegen produces "structurally correct but visually wrong" output where pixel diff over-fires on irrelevant rendering deltas. Applitools' own marketing piece concedes that DOM-only diff "misses visual bugs that don't show up in the DOM" (e.g. wrong-aspect images) but agrees that for code-spec parity (our case) DOM-structural is the right primary check.

### Step 4 — Cost / coverage matrix + recommendation

| Mechanism            | Catches (of 15) | LOC | New deps     | Ops complexity         | Per-run \$ at scale | False-positive risk |
| -------------------- | --------------- | --- | ------------ | ---------------------- | ------------------- | ------------------- |
| #1 DOM-diff          | ~10             | 280 | none (reuse) | LOW                    | <\$0.10             | LOW                 |
| #2 Computed-style    | ~5              | 200 | none         | MEDIUM                 | <\$0.10             | MEDIUM              |
| #3 Pixel diff        | 15 (with FP)    | 150 | pixelmatch   | HIGH (goldens, OS-pin) | <\$0.05             | HIGH                |
| **#1 + #2 combined** | **~13/15**      | 480 | none         | LOW-MEDIUM             | <\$0.20             | LOW                 |

**Recommendation: #1 (primary) + #2 (backup, ship in same feature) — combined ships >85% catch rate at a fraction of #3's operational pain.**

### Step 5 — Re-litigating investigate-006's deferral

Re-read investigate-006 §Step 3 + §Recommendation. Its quoted deferral of Option #2 (screenshot diff): "Settings-link missing visually present in mockup but built app has TopBar gear instead — false-positive heavy. Defer to phase-2."

That reasoning was **right-at-the-time but applied to the wrong target**. Investigate-006 was scoping a tool for the Pattern A/B/C/D gaps it had just catalogued (orphan components, orphan routes, missing brief items, mockup drift) — for those specifically, deterministic flow E2E + reachability did dominate pixel-diff on cost/catch. The deferral assumed pixel-diff was the only flavour of visual verification.

**What was missed**: the _third_ flavour, structural DOM-diff via the already-authored `data-kit-*` contract, was never enumerated as its own option. Investigate-006's table conflated all "visual" options under "Option #2 screenshot diff", and pixel-diff's well-known false-positive risk killed the whole category. Kanban-10 evidence shows the gap class is real (≥14/15 divergences ship green) and that the tool to catch it is structurally cheaper than feared because the kit-attribute contract already exists in the mockups.

**Lesson for the recommendation framework (extends investigate-007's territory):**

- **Add explicit "re-evaluate after N projects shipped" cadence** to every option-space survey investigation. Concrete proposal: each `Recommendation` block carries a `revisit-after: {projects-shipped: N | runs: N | calendar-days: N}` field; on a project's `/start-build` completion, the orchestrator scans `plans/archive/` for `revisit-after.projects-shipped <= shippedCount` and surfaces them at the post-Mode-B summary as "decisions due for re-litigation".
- **Decompose categorical options** before scoring. "Visual diff" is three flavours (DOM, computed-style, pixel) with three distinct cost/catch profiles. Future option surveys must show the decomposition explicitly — the table itself is a thinking tool.
- **Track contradiction-evidence on archived plans**. When kanban-10 produced direct evidence that an archived recommendation was wrong, the discovery was ad-hoc (manual inspection during a build). A `/lessons --contradicts <plan-id>` flow would let any agent flag "I found data invalidating this archived plan" without rewriting the whole plan-archive system.

## Recommendation

Ship `feat-028-visual-parity-verifier` as a v1 with structural DOM-diff (#1) + computed-style audit (#2), explicitly deferring pixel-diff (#3). Cutover to pixel-diff is justified ONLY if a future project surfaces a class of divergence neither #1 nor #2 catches — write the cutover criterion into the feat-028 plan ("revisit if ≥3 divergences in a single project ship through #1+#2 verification cleanly").

### `feat-028-visual-parity-verifier` mini-spec (5 bullets)

- **Scope**: new `/parity-verify` factory skill + `scripts/diff-kit-skeleton.mjs` (DOM-tree walker) + `scripts/audit-computed-styles.mjs` (curated-selector computed-style audit) + `ParityVerifyOutput` schema + a one-feature `@repo/ui-kit` retrofit pass-through `data-kit-component`/`data-kit-variant`/`data-kit-size`/`data-kit-props` props on every primitive (`EmptyState`, `AppShell`, `Button`, `Dialog`, `Input`, `Badge`, `Breadcrumbs`, `FilterBar`, etc.).
- **Pipeline slot**: post-Mode-B, alongside `/build-to-spec-verify` (after the last feature merges, before the orchestrator emits "complete"). Reuses `scripts/visual-review-preflight.mjs` to serve both the built app AND the mockup HTML; uses Playwright MCP to capture each side's DOM tree at desktop viewport (mobile/tablet are stretch).
- **DOM-diff algorithm**: walk both DOM trees, project to a kit-skeleton (only `data-kit-*` attributes + nesting), compare structural hierarchy + presence of variants/props. Diff format: `{missing: [], extra: [], variantDrift: []}`. Computed-style audit walks the same skeleton, diffs `getComputedStyle` for `color, background-color, font-size, padding, margin, border-radius` against mockup baseline with ±1px tolerance.
- **On failure**: file `bug-NNN-parity-{screen}-{pattern}` plans (one per pattern cluster, NOT per individual divergence — A-class shell-stripping is one bug); orchestrator routes to web-frontend-builder for the owning feature. Same retry ladder as feat-022's `BuildToSpecVerifyOutput`.
- **Out of scope for v1, deferred with explicit cutover criteria**:
  - Pixel diff — revisit if ≥3 divergences ship past v1 in a single project, OR if a project specifies brand-identity assets (logos, photos) where pixel parity actually matters to the user.
  - Mobile/tablet viewports — desktop only at v1; expand once desktop catch rate is validated on 3+ projects.
  - Visual-AI / SaaS path (Applitools / Percy) — defer until self-hosted catch rate plateaus AND a project's contractual sign-off requires "human-equivalent" visual review.

### Prerequisites (must ship before or alongside feat-028)

1. **Kit-attribute retrofit (P0 sub-feature)**: every `@repo/ui-kit` primitive forwards `data-kit-component`, `data-kit-variant`, `data-kit-size`, `data-kit-props` to its rendered root element. Without this, #1 cannot run. Estimated 30 LOC + tests; could ship as a standalone refactor plan today since it's risk-free (purely additive DOM attributes).
2. **Stylesheet skill update (P1)**: `/stylesheet` SKILL.md must document the contract so future kits don't regress. Add to `packages/ui-kit/CLAUDE.md` or equivalent.
3. **Web-frontend-builder dispatch context (P1)**: builders currently strip `data-kit-*` when translating mockup HTML → JSX. Update the web stack skill's §Translation block to require pass-through.

### Framework lesson — apply to investigate-007's recommendation framework

Append a `revisit-after` field to every investigation's frontmatter. On `/plan-archive`, the field is preserved; on `/start-build` completion, surface plans whose threshold has been crossed as "decisions due for re-litigation". Concrete schema sketch:

```yaml
recommendation: ...
revisit-after:
  projects-shipped: 3 # check after 3 more projects ship
  reason: "Pixel-diff false-positive surface untested at scale; revisit if structural diff misses ≥3 divergences in any project"
```

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->
