---
id: investigate-006-build-to-spec-verification
type: investigation
status: completed
recommendation-implemented-by: feat-022-build-to-spec-verification, feat-023-pm-stage-brief-coverage-assertion
author-agent: claude-opus-4-7
created: 2026-04-27
updated: 2026-04-27
completed-at: 2026-04-27
parent-plan: null
branch: null
attempt-count: 1
max-attempts: 5
time-box-minutes: 45
priority: P0
feature-area: orchestration
hypothesis: "Mode B's per-feature verification (builder happy-path tests + tester edge tests + reviewer playbook + security agent) does NOT compose into end-to-end product correctness. Cross-feature integration gaps (e.g. modal built but never wired into page; settings page built but no nav link) ship clean through the agent_sequence because no agent owns the integration layer. We need a post-graph verification stage that compares the running app against the design artifacts (screens, user flows, brief)."
---

# investigate-006 — How do we verify a generated project matches spec?

## Question

After Mode B reports `Features completed: 10/10, Total cost: $X`, the orchestrator's signal of success is "every feature merged + tested + reviewed cleanly". But on kanban-webapp-09 we found **integration gaps** that ship through the green pipeline:

1. `feat-card-detail` built `CardDetailModal.tsx` (370 LOC, 21 passing tests) but it's **never imported in production code**. Every per-feature test green; production app has no modal.
2. `feat-settings-data` built `/settings` page but **no in-app navigation link** to reach it (only a manual URL works). The TopBar has a settings button slot, but `BoardPageClient` doesn't pass the `onOpenSettings` callback.

These are not bugs in any single feature — they're gaps in the _seams between_ features. **What verification mechanism should the factory introduce so these gaps surface BEFORE the human discovers them?**

## Hypothesis

Per-feature verification (the current model) and end-to-end product verification are different problems requiring different tools. Mode B has the first; the second is missing entirely.

The pre-existing assumptions that turned out to be insufficient:

- **Tester writes E2E specs** (Playwright per testing-policy.md). But these are PER-FEATURE — `e2e/board-core.spec.ts` tests board-core's surfaces in isolation, not "click a card → modal opens" because the modal is a different feature.
- **Reviewer runs a 7-dimension playbook**. The "brief-delivery" dimension is supposed to catch integration gaps but is currently a per-feature check (does THIS feature deliver what its tasks claimed?), not a cross-feature check.
- **Visual-review** runs at the design stage on screen mockups, not on the running built app.

The investigation should answer:

1. What's the minimum-viable post-build verification stage that catches this class of gap?
2. Should it be visual (screenshot diff against approved mockup), behavioral (Playwright E2E that walks user flows), or structural (static analysis: does every screen in `docs/screens/` have a route + does every component get rendered)?
3. Where does it go in the pipeline — after Mode B's last feature, before the "complete" signal?
4. What does it FAIL on — does it open new bug plans, dispatch a "patch-up" feature, or just surface to human?

## Investigation Steps

### Step 1 — Catalog the integration-gap surface

Walk kanban-webapp-09's actual integration gaps (~10 min). For each, identify:

- What WAS built (file paths, test counts)
- What's MISSING (the wiring)
- Which design artifact (screen, user flow, brief section) would have predicted the gap if anyone read it

Estimated: 4-6 distinct gaps once you look hard. Record the patterns.

### Step 2 — Audit existing verification surfaces

What does the factory ALREADY have that could be repurposed?

- `docs/visual-review/report.json` — design-stage; what would it look like applied post-build?
- `apps/web/e2e/*.spec.ts` — per-feature E2E specs; could a synthesized "all flows" spec live alongside them?
- `docs/user-flows/` — user-flows-generator stage output; is this machine-readable enough to drive a Playwright runner?
- `docs/screens/` — every screen has an HTML mockup; could screenshot-diffing the running app against these catch missing components?
- Reviewer playbook (`docs/reviewer-playbook.md`) — what would a "cross-feature reviewer" pass look like? Is it a different agent or an extra dimension on the existing reviewer?

### Step 3 — Survey the option space

Enumerate plausible verification approaches with rough effort/coverage tradeoffs:

| Option                                                                                                                 | What it catches                                 | What it misses                    | Effort            | When in pipeline                   |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------- | ----------------- | ---------------------------------- |
| Synthesized E2E from user-flows-generator output                                                                       | Behavior gaps (clicks-don't-work, missing nav)  | Visual regression, accessibility  | Medium            | Post-Mode-B                        |
| Screenshot diff (built app vs `docs/screens/<id>.html`)                                                                | Visual gaps (missing components, broken layout) | Behavioral gaps                   | Medium-High       | Post-Mode-B                        |
| Static analysis: every screen in `docs/screens/` has a matching route + every exported component is imported somewhere | "Built but not wired" gaps                      | Visual regression, runtime errors | Low               | Post-Mode-B                        |
| New "integrator" agent that runs after all features merge, reads brief+screens+running app, files bug plans            | Anything humans would catch                     | Cost; novel agent role            | High              | Post-Mode-B                        |
| Extend reviewer to cross-feature (read all merged commits + check seams)                                               | Some integration gaps                           | Visual regression, novel UX       | Low-Medium        | Per-feature reviewer pass extended |
| Post-build Playwright recording (humans-in-loop click-through with auto-record)                                        | Realistic flows                                 | Manual; not autonomous            | Low (per project) | Pre-ship                           |
| Scenario-based: brief.md "user can do X" → generate Playwright + run                                                   | High-signal                                     | Brief-quality dependent           | Medium            | Post-Mode-B                        |

### Step 4 — Look at how others solve this

Quick web fetch (don't go deep): how do tools like Playwright Codegen, Storybook + Chromatic, Percy, and Argos handle "does the built app match the design?"

### Step 5 — Recommend

Pick ONE primary mechanism + ONE backup, justify the choice against the kanban-webapp-09 gaps. Write it up as a prospective `feat-022-build-to-spec-verification` feature plan (don't implement — just sketch).

## Findings

### Step 1 — Gap catalog (kanban-webapp-09 as-shipped, HEAD before monkey-patch)

Walked `apps/web/` as committed at `a81b927` (last merge, before the human monkey-patch). Found **8 distinct integration gaps**, clustering into 4 patterns.

#### Pattern A — Built-but-not-wired (component exists with tests, never imported in production)

1. **`CardDetailModal`** — `apps/web/src/components/board/CardDetailModal.tsx`, 370 LOC + 21 tests. Imported only by its own `*.test.tsx` files. `KanbanBoard.tsx` (HEAD) does NOT accept an `onCardClick` prop and never instantiates the modal. Brief §12 ("Inline edit + modal edit"), screen `card-modal.html`, and **user-flow flow-4** (`home → card-modal → home`) all expected this wiring.
2. **`ThemeToggle`** (`apps/web/components/theme-toggle.tsx`) — full component + 3 test files. Never imported anywhere in `app/` or `src/components/`. The settings page (`settings-page.tsx`) ships its own inline `Switch`-based theme toggle, leaving `ThemeToggle` an orphan duplicate. This wasn't even noticed in the human walkthrough — pure dead code.
3. **`ShortcutOverlayDialog`** is wired (good), but `useKeyboardShortcuts` only fires when `boardActive=true` (no board → no `?` overlay). Mockup `home.html` has no parallel "no boards yet" state for shortcuts; arguably spec-correct, but the overlay being unreachable from `empty-no-board` is a flow gap.

#### Pattern B — Wired-but-no-entry-point (route/feature exists; UI never surfaces it)

4. **`/settings` page** — TopBar's `onOpenSettings` callback existed but `BoardPageClient.tsx` never passed it through to `HomeBoardView`. Even after monkey-patch, the brief mockup `home.html` shows TWO entry points (sidebar Settings link AND TopBar gear); the built `BoardSidebar.tsx` has neither. Sidebar settings link still missing post-patch.
5. **`/help` route** — Brief §10 + §11 + nav-schema all list it. Never built — no `app/help/` directory, no nav link. This passed because PM never created a feature for it; the omission lives in `tasks.yaml`, not in any feature's code.

#### Pattern C — Spec'd-but-not-built (brief §12 promised; no store action)

6. **Column rename** — Brief §12: "Custom columns — add, **rename**, reorder, delete". `kanban-store.ts` has no `renameColumn`/`updateColumn` action. `KanbanColumn.tsx` only renders the column title — no inline-edit, no rename UI. Reviewer's brief-delivery dimension didn't catch this because it scopes per-feature (`feat-board-core` claimed "render columns", not "rename columns").
7. **Column delete** — same as above. No `removeColumn` action; no UI affordance. Brief §12 promised it; nothing flags its absence.

#### Pattern D — Visual-mockup-vs-built drift (mockup shows it; built omits it)

8. **Sidebar Settings + Help links** — `docs/screens/webapp/home.html` lines 69, 132 show `<a href="./settings.html">` in the sidebar AND TopBar. `BoardSidebar.tsx` (built) has neither — only the boards list and a "+ New board" affordance. Visual-review never flagged it (and ran in `static-analysis` mode for this project anyway, per `report.json.reviewMode: "static-analysis"` due to a Playwright lock — a separate fragility worth noting).

#### Cluster summary

- **3 gaps in Pattern A** (orphan components — the most expensive to detect because per-feature unit tests pass)
- **2 gaps in Pattern B** (orphan routes/handlers)
- **2 gaps in Pattern C** (missing-from-tasks-yaml; PM-stage hole)
- **1 gap in Pattern D** (mockup drift — would have been caught by post-build visual diff)

The **dominant cluster (5/8) is reachability**: a thing exists in code or in spec but no path through the app's UI exercises it. The remaining 3 are coverage holes (PM/architect missed them upstream).

### Step 2 — Existing factory verification surfaces

| Surface                                                            | What it catches today                                                                                                                                                                                    | What it misses for our gaps                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Reuse potential                                                                                                                                                                                                     |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `visual-review/SKILL.md` + `rubric.md`                             | Per-screen 28-rule rubric on **HTML mockups** at design stage. Renders 3 viewports; emits `report.json` + `retry-feedback.md`. 7-section rubric: composition/type/color/states/motion/mobile/slop-sniff. | (a) Operates on `docs/screens/*.html`, NOT on the built app. (b) Per-screen, not per-flow — won't notice a click-target doesn't open the next screen. (c) On this project ran degraded-mode (`static-analysis` only) because Playwright MCP was locked.                                                                                                                                                                                                                                 | **HIGH**. The Playwright MCP infra, the `visual-review-preflight.mjs` http-server harness, the rubric agent pattern — all reusable. New skill could do `mockup-vs-running-app` diff using the same building blocks. |
| `apps/web/e2e/*.spec.ts` (per-feature Playwright, tester-authored) | Tests each feature's own surfaces in isolation: `card-detail.spec.ts`, `dnd.spec.ts`, etc.                                                                                                               | Each spec mocks/sets up its own state. There is NO spec that walks `home → click-card → modal → close → home` as a real user would. The card-detail spec presumably navigates directly to the card-modal route or seeds the modal state — it cannot fail when KanbanBoard never wires `onCardClick`.                                                                                                                                                                                    | **MEDIUM**. Pattern is established; need a NEW spec category authored from `user-flows-manifest.json` rather than from feature tasks.                                                                               |
| `docs/user-flows-manifest.json`                                    | **Machine-readable** flow spec. 10 flows × N steps, each step is `{screenId, file, status}`. Flow-4 is literally `home → card-modal → home` — exactly the flow that's broken.                            | Used today only to render the HITL viewer (`user-flows.html`); no downstream consumer treats it as an executable contract.                                                                                                                                                                                                                                                                                                                                                              | **VERY HIGH**. This is the missing input for a synthesizer. It already names the screens that must transition into each other.                                                                                      |
| `docs/screens/webapp/*.html`                                       | 7 screen mockups with `data-kit-component` attributes for kit-only translation. Reviewed at design stage.                                                                                                | Never compared to the running app post-build. No screenshot-diff exists.                                                                                                                                                                                                                                                                                                                                                                                                                | **HIGH**. Already viewport-stable, kit-bound; ideal baseline for a post-build screenshot diff.                                                                                                                      |
| `docs/reviewer-playbook.md` Dimension 7 (brief-delivery)           | Static cross-ref: `tasks.yaml.features[]` vs commits vs brief §11 catalog. Flags missing imports + missing brief entries.                                                                                | (a) Per-feature scope (`audit-brief-delivery.mjs --feature=<id>`) — won't catch cross-feature wiring (Modal exists; KanbanBoard doesn't import it; both are in different features). (b) Doesn't run runtime — wouldn't catch column-rename absent from store. (c) Brief §11 → tasks.yaml mapping check would catch /help (gap #5) and column rename/delete (gaps #6+7) IF authored, but the script doesn't exist yet (`scripts/audit-brief-delivery.mjs` is TBD per playbook line 444). | **MEDIUM**. Authoring the missing script + extending its scope to the cross-feature seam (every feature's exported components must be imported by some OTHER feature's code) catches Pattern A cheaply.             |

**Visual-review degraded mode is itself a finding**: `report.json.reviewMode: "static-analysis"` with reason "Playwright MCP browser lock prevented screenshot capture". Even the mockup-stage rubric didn't run for this project. Any post-build solution leaning on Playwright MCP needs a more robust harness than the current one.

### Step 3 — Option-space survey

Each option scored against: **(P-A)** orphan components, **(P-B)** orphan routes, **(P-C)** spec-not-built, **(P-D)** mockup drift.

| #   | Option                                                                                                                                                                                                                                                                                 | Catches                                                 | Cost                                                                                                                                                                                                            | Pipeline slot                                                                            | On failure                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Synthesized E2E from `user-flows-manifest.json`** — read each flow's step sequence, generate a Playwright spec that asserts each transition (click on screen N, expect screen N+1 to render)                                                                                         | P-A (modal flow), P-B (settings reachability)           | Medium. Need: flow-to-spec generator (~250 LOC), step-to-selector convention (use `data-kit-component` + screen identity from URL or DOM), Playwright runner.                                                   | After Mode B's last feature merge, before "complete" signal.                             | Open `bug-NNN-flow-X-broken` plans automatically; orchestrator routes to the builder owning the originating component (e.g., KanbanBoard for flow-4). |
| 2   | **Screenshot diff: built app vs `docs/screens/{id}.html`** (per route)                                                                                                                                                                                                                 | P-D (drift), partial P-A (modal HTML structure missing) | Medium-High. Need: viewport-matched render harness for both, perceptual diff threshold tuning, baseline auto-approval flow. The `visual-review-preflight.mjs` already serves the static screens; reuse pattern. | Same slot as #1.                                                                         | Emit per-screen diff PNGs + structured deltas; route to web-frontend-builder of owning feature.                                                       |
| 3   | **Static reachability analyzer** — `audit-app-reachability.mjs`: graph every exported `.tsx` component → check it's imported by at least one non-test file in another module; graph every route in `app/**/page.tsx` → check at least one `<Link>`/`router.push`/`<a href>` reaches it | P-A (orphan components), P-B (orphan routes)            | LOW. ~150 LOC AST walker (ts-morph or simple regex chain). Could ship this week.                                                                                                                                | Per-feature reviewer step + once at end of Mode B.                                       | `genuineProductBugs[]` style — orchestrator routes to the named builder.                                                                              |
| 4   | **New "integrator" agent** — runs after all features merge, reads brief + screens + running app, opens patch features for gaps                                                                                                                                                         | All 4 patterns                                          | HIGH. Novel agent; cost ~$5-15/run; non-deterministic.                                                                                                                                                          | Post-Mode-B, pre-"complete".                                                             | Files new feat-NNN plans; queues builder; loops until clean.                                                                                          |
| 5   | **Extend reviewer Dimension 7 cross-feature** — implement the missing `audit-brief-delivery.mjs` AND make it scan every brief §12 entry against every feature's code (not per-feature)                                                                                                 | P-A, P-C, P-D-partial                                   | Low-Medium. Authoring the script already in playbook backlog. Extending to cross-feature is one extra pass over all merged code.                                                                                | Reviewer's existing slot, with a "final pass" mode triggered at last feature's reviewer. | Same routing as today — back to named builder.                                                                                                        |
| 6   | **Post-build Playwright recording (HITL)** — orchestrator pauses, opens browser, asks user to walk flows, records                                                                                                                                                                      | All — by definition                                     | Low engineering, HIGH user time. Defeats autonomy goal.                                                                                                                                                         | Pre-ship gate.                                                                           | Recording becomes a regression spec for next runs.                                                                                                    |
| 7   | **Scenario-based brief→Playwright** — read `brief.md §15` acceptance criteria + §12 features, prompt LLM to author E2E spec                                                                                                                                                            | P-A, P-B, P-C (best for unbuilt-yet-spec'd)             | Medium. LLM cost per project; brief-quality dependent. Brief §15.1-5 is already concrete enough.                                                                                                                | Same slot as #1; complementary, not competing.                                           | Same as #1 — bug plans auto-filed.                                                                                                                    |
| 8   | **(NEW) Combine #1 + #3** — flows-driven E2E for behavior + reachability analyzer for orphans                                                                                                                                                                                          | P-A + P-B (both); P-C + P-D need #5 or #7 too           | Low + Medium = Medium total                                                                                                                                                                                     | Same slot                                                                                | Hybrid routing                                                                                                                                        |
| 9   | **(NEW) Brief §11/§12 → tasks.yaml coverage assertion at PM stage** — moves Pattern C upstream, prevents column-rename gap from ever entering Mode B                                                                                                                                   | P-C only (preventatively)                               | Low. Few-line addition to PM agent / `pm` skill.                                                                                                                                                                | Mode A, post-`/pm`, pre-Mode-B.                                                          | PM re-runs to add missing features; gate 4/5 blocked until covered.                                                                                   |

External survey (Step 4):

- **Chromatic / Percy** — visual regression on isolated Storybook stories OR full-page screenshots. Strong industry norm: component VRT (Chromatic-style) catches per-component regressions; page-level VRT (Percy/Playwright snapshots) catches integration. Aligns with our gap analysis: per-component is what we already over-rotate on; page-level is the missing layer.
- **Playwright Codegen + AI** — Microsoft now ships a Playwright "Test Agents" pattern: Planner → Generator → Healer. The Planner explores the app, produces a markdown test plan; Generator writes Playwright code; Healer self-repairs on UI drift. This is essentially Option #1 with an LLM in the loop instead of a deterministic synthesizer. The deterministic version is cheaper for our case because `user-flows-manifest.json` already IS the test plan.
- **Spec-driven dev (GitHub spec-kit, OpenAI alignment work)** — broad consensus that the gap between "agent thinks code is done" and "code matches spec" is best closed by a separate **verification agent reading the spec + the built artifact** rather than by trusting per-task checks. Confirms the architectural shape of #4 + #7, even if we don't build them in MVP.

Time check at end of Step 4: ~35 min. Moving to recommendation.

## Recommendation

**Primary: Option #8 — combine flow-driven E2E synthesizer (#1) + static reachability analyzer (#3), as a new factory skill `/build-to-spec-verify` that runs once at the end of Mode B before the orchestrator emits "complete".**

**Backup: Option #5 — author the long-overdue `scripts/audit-brief-delivery.mjs` and extend it cross-feature** (covers Pattern C if PM-stage Option #9 also doesn't ship).

### Justification against the kanban-webapp-09 gaps

| Gap                               | Caught by #1 (flow E2E)                                                                                                     | Caught by #3 (reachability)                                        | Verdict                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------ |
| 1. CardDetailModal orphan         | YES — flow-4 step `home → card-modal` would `expect(modal).toBeVisible()` after clicking a card; modal never appears → fail | YES — `CardDetailModal` not imported anywhere except its own tests | Both catch; reachability fires first (cheaper)               |
| 2. ThemeToggle orphan             | NO — no flow exercises it (settings page has its own toggle)                                                                | YES — exported, only test importers                                | Reachability is the only catch                               |
| 3. ShortcutOverlay no-board state | PARTIAL — depends on whether a flow includes "press ? from empty state"                                                     | NO                                                                 | Edge case; acceptable miss                                   |
| 4. Settings nav-link missing      | YES — flow-7 (`home → settings → home`) requires a clickable path                                                           | NO                                                                 | Flow-E2E catches it                                          |
| 5. /help route never built        | PARTIAL — depends on whether PM authored a flow for it (it didn't, since /help was deferred)                                | NO (route doesn't exist to be analyzed)                            | Needs Option #9 (PM-stage) or Option #5 (brief §11 coverage) |
| 6. Column rename missing          | NO (no flow specifies it)                                                                                                   | NO                                                                 | Needs Option #5 brief §12 cross-ref                          |
| 7. Column delete missing          | NO                                                                                                                          | NO                                                                 | Same as #6                                                   |
| 8. Sidebar settings link          | YES — same flow-7 path                                                                                                      | NO                                                                 | Flow-E2E catches it                                          |

**Coverage of the 8 gaps with #1+#3 combined: 5 hard catches + 1 partial. The 3 misses (#5/#6/#7) are PM-stage holes not Mode B integration gaps** — they need Option #9 (preventative coverage assertion at `/pm`) or Option #5 (brief-§12 cross-ref in reviewer). Recommend filing those as separate plans.

**Why this combination, not the alternatives:**

- Not #4 (integrator agent): too expensive + non-deterministic for the catch rate. The deterministic combo gets 5/8 at <$1/run.
- Not #2 (screenshot diff): high engineering cost, lower catch rate for THIS class of gap. Settings-link missing visually present in mockup but built app has TopBar gear instead — false-positive heavy. Defer to phase-2.
- Not #6 (HITL): violates autonomy.
- Not #7 alone (brief→E2E LLM): higher variance than the deterministic flows-manifest path; brief §15 acceptance criteria are coarser than flow-step granularity. Could ship as v2 enhancement.

### What it would have produced for kanban-webapp-09

```
$ /build-to-spec-verify projects/kanban-webapp-09

REACHABILITY (3 violations):
  - apps/web/src/components/board/CardDetailModal.tsx
    exported but not imported by any production module
    owning feature: feat-card-detail
    suspect importer (per task spec "render-card-modal"): apps/web/src/components/board/KanbanBoard.tsx OR apps/web/src/components/HomeBoardView.tsx
  - apps/web/components/theme-toggle.tsx
    exported but not imported by any production module
    owning feature: feat-theme
  - (no orphan routes detected)

FLOW E2E (2 failures of 10 flows):
  - flow-4 "Open detail-edit modal" failed at step 2/4
    home.html step passed (board renders)
    card-modal.html step FAILED: clicked first card on board; expected
    [data-testid="card-detail-modal"] to be visible within 2000ms; not found.
    likely cause: KanbanCard.onClick not wired to KanbanBoard's onCardClick prop chain
  - flow-7 "Export / Import (backup + restore)" failed at step 2/3
    home.html step passed
    settings.html step FAILED: no click target on home page leads to /settings.
    expected one of [aria-label="Open settings"], [href="/settings"], [data-testid="settings-link"] to exist
    likely cause: BoardPageClient.tsx not passing onOpenSettings prop to HomeBoardView

ROUTING:
  Filing 2 bug plans:
    - bug-021-flow-4-card-modal-not-wired
    - bug-022-flow-7-settings-not-reachable
  Plus 2 reachability follow-ups (CardDetailModal, ThemeToggle) attached to bug-021/bug-022 above
  to consolidate fix attempts.

Mode B status: completed-with-integration-failures
Next step: orchestrator dispatches builder retries (max 2× per bug plan).
```

### Where it runs / who owns response

- **Slot**: new pipeline stage between the last feature merge and the orchestrator's "completed" signal. Same kind of integration point as `/visual-review` slots between `/screens` and `/user-flows-generator`.
- **Owner**: orchestrator (task 035) calls `/build-to-spec-verify` and consumes its return JSON. On failure, opens bug plans (one per flow violation, collapsing reachability hits into the most relevant bug plan), then dispatches the named builder for retry — same retry ladder as `genuineProductBugs[]` from tester (max 3 per task, escalation to human at 5).
- **HITL escalation**: if 3 retries don't fix a flow, the bug plan goes into `needs-human-review` queue at gate 4-equivalent. The synthesizer's failing spec is preserved as a regression test on next run.

### Sketch — `feat-022-build-to-spec-verification`

- **Scope**: ship a new `/build-to-spec-verify` skill + `audit-app-reachability.mjs` script + `synthesize-flow-e2e.mjs` script + `BuildToSpecVerifyOutput` schema. Wire into orchestrator (task 035) as a post-Mode-B stage. Bug-plan auto-author template.
- **Inputs**: `docs/user-flows-manifest.json`, `docs/screens/{platform}/*.html` (for asserted screenIds), `docs/tasks.yaml` (for owning-feature attribution), running dev server at localhost (started + torn down by the same `visual-review-preflight.mjs` harness).
- **Outputs**: `docs/build-to-spec/report.json` (machine-readable: `{ flows[], reachability[], bugPlansFiled[] }`), per-flow Playwright specs persisted at `apps/web/e2e/synthesized/flow-{n}.spec.ts` (preserved as regression tests on subsequent runs).
- **Convention**: each `docs/screens/{id}.html` must carry a `<body data-screen-id="{id}">` attribute (already there: `data-kit-layout="AppShell"` is similar shape; add `data-screen-id`). Built pages assert `document.body.dataset.screenId === expected` between flow steps.
- **Estimated effort**: 1 builder feature, 3-5 days. ~600 LOC across script + skill + schema. ~$2-5 per project run at runtime. New files: `scripts/audit-app-reachability.mjs`, `scripts/synthesize-flow-e2e.mjs`, `.claude/skills/build-to-spec-verify/SKILL.md`, `schemas/build-to-spec-verify-output.schema.json`. No new agents (skill-only); orchestrator update is ~30 LOC.
- **Out of scope for v1** (deferred to feat-023+): screenshot diff (Option #2), brief §11/§12 coverage assertion at PM stage (Option #9 — separate plan), brief-driven E2E LLM synthesis (Option #7).

### Open questions to defer to follow-up investigation if needed

These shouldn't block feat-022 but warrant a parallel `investigate-007`:

1. **Where do `data-screen-id` attributes get authored?** Mockup HTML already has them as `data-kit-layout` analogs. Built React components need the same attribute on the page-root `<body>` or wrapper. Adding it could be a `/screens` and a builder-stage convention (one-line per page). Investigate whether to retrofit existing screens or only enforce on new ones.
2. **PM-stage gap detector (Option #9)** — separate from this plan. Worth its own plan to address Pattern C (column rename, /help) preventatively.
3. **Visual-review fragility** — kanban-webapp-09 ran in `static-analysis` degraded mode because Playwright MCP was locked. If `/build-to-spec-verify` shares the same harness, the same fragility hits. Worth either hardening `visual-review-preflight.mjs` or building a fallback path.
4. **Orphan-detection false-positive rate** — `ThemeToggle` is a real orphan (replaced by inline switch), but in larger projects export-only files (entry shims, future-feature components staged behind a flag) might trip the analyzer. Ignore-list convention TBD.

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->
