---
id: investigate-009-built-vs-designed-visual-parity
type: investigation
status: draft
author-agent: claude-opus-4-7
created: 2026-04-28
updated: 2026-04-28
parent-plan: feat-022-build-to-spec-verification
supersedes: null
superseded-by: null
branch: null
affected-files: []
feature-area: orchestration
priority: P0
attempt-count: 0
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

<!-- Filled in by the executing agent -->

## Recommendation

<!-- Filled in by the executing agent. Should propose either:
   (a) A prospective feat-028-visual-parity-verifier plan with one-paragraph scope
   (b) A follow-up investigation if the option space is too wide
   (c) "Defer until N more projects shipped" with explicit cutover criteria
-->

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->
