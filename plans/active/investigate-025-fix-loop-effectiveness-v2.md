---
id: investigate-025-fix-loop-effectiveness-v2
type: investigation
status: completed
author-agent: human
created: 2026-05-08
updated: 2026-05-08
started: 2026-05-08
completed: 2026-05-08
parent-plan: null
supersedes: null
superseded-by: null
branch: null
affected-files:
  - orchestrator/src/build-to-spec-verify.ts
  - orchestrator/src/parity-verify.ts
  - orchestrator/src/fix-bugs-loop.ts
  - scripts/synthesize-flow-e2e.mjs
  - scripts/run-synthesized-flows.mjs
  - scripts/audit-computed-styles.mjs
  - .claude/skills/build-to-spec-verify/SKILL.md
  - .claude/skills/agents/front-end/react-next/SKILL.md
feature-area: orchestrator/verification-coverage + bug-fix-pipeline-v2
priority: P0
attempt-count: 0
max-attempts: 5
time-box-minutes: 180
hypothesis: |
  The factory's bug-fix loop reports high resolution rates (94% on
  reading-log-02 v5, ~95% on reading-log-01) but ships projects with
  load-bearing visual + interaction bugs invisible to all 5 verifier
  layers. The metric is structurally biased: bug-fixers resolve
  PARITY-VERIFY-DEFINED bugs (DOM structure, class-attribute strings,
  E2E selector hits) but miss every bug class that requires running the
  app like a human would. bug-077 (project-wide missing Tailwind
  pipeline produces 0 verifier signal) is the smoking gun.

  Three load-bearing gaps in the current pipeline:
    H1 — No visual baseline. Mockups serve as DOM ground truth (kit-
         skeleton diff, computed-style audit) but never as PIXEL ground
         truth. A pixel-diff between mockup + live build would catch
         entire-page-unstyled bugs in one frame.
    H2 — Synthesized E2E flows execute selectors, not walkthroughs.
         The synthesizer emits `page.goto("/")` + 4-9 interactions per
         flow. A real user inspecting the app exercises the whole
         surface — sidebar collapse, theme toggle, empty-state CTA,
         modal dismissals, keyboard nav. None of that is in the flow
         set; bugs in those surfaces never enter the bug-fixers' input.
    H3 — Bug detection is structural, not perceptual. parity-verify's
         kit-skeleton + computed-style audit (investigate-022 Step 3,
         commit 7bfc996) compares specific properties of specific
         elements; it can't say "the page looks empty" or "the nav bar
         doesn't fill the viewport". Those are perceptual judgments
         only an LLM-with-vision (or a pixel-diff vs reference image)
         can render.

  RESEARCH-INPUT signals (user-supplied 2026-05-08): Playwright MCP
  enables AI-driven natural-language browser walkthroughs (catches
  perceptual gaps like H3). pixelmatch + screenshot diff catches H1
  in one tool call per screen. Playwright CLI uses ~4× fewer tokens
  than the MCP server for terminal-based agents (relevant tradeoff
  for our orchestrator-dispatched setup). Hybrid mode (pixel + DOM)
  reduces false positives by ignoring acceptable content drift.

  v2 PIPELINE QUESTION: keep the existing structural verifier surfaces
  (they ARE catching real bugs, e.g. flow-execution-failure for
  selectors) and ADD a perceptual layer (visual regression + AI
  walkthrough) — OR scrap-and-rebuild around the new tools? This
  investigation must answer that and produce a concrete v2 architecture
  diagram with sized phases.
---

<!-- STATUS STATE MACHINE
draft → approved → in-progress → completed → archived
                 → abandoned → archived

This is a META-investigation. It questions the effectiveness of the
ENTIRE bug-fix pipeline, not a single layer. In-flight investigations
that scope individual layers (investigate-021 / -022 / -023) feed
into this one's findings — DO NOT duplicate their work; reference
their findings as inputs.

TIME BOX: 180 minutes (3× default). Justified by scope: the output is
an architectural recommendation that gates a redesign, not a tactical
gap-fix.
-->

# investigate-025-fix-loop-effectiveness-v2: Is the bug-fix pipeline structurally able to catch the bugs that matter — and what would v2 look like?

## Question

After /fix-bugs validation v5 reported 94% resolution on reading-log-02 (15-of-16 bugs auto-resolved), manual visual inspection of the running site immediately surfaced load-bearing bugs the pipeline never filed: entire missing Tailwind CSS pipeline (bug-077, every page renders unstyled), sidebar not filling viewport, layout chrome missing. **Two falsifiable questions:**

1. **Empirical:** Walk through every screen + interaction of reading-log-02 manually. Catalog every visual/UX/interaction bug found. For each, classify whether the existing 5-layer verifier (build / dev-server / E2E flows / parity DOM-diff / parity computed-styles / reachability) **could have caught it given perfect operation**, or whether the bug class is **structurally invisible** to those layers. Build a coverage matrix.

2. **Architectural:** Given the empirical coverage matrix, design a **bug-fix v2 pipeline** that closes the load-bearing gaps. Three options to evaluate:
   - **Option A — Additive**: keep all 5 existing layers, add a 6th (visual regression via pixel-diff vs mockups) + a 7th (AI walkthrough via Playwright MCP or CLI), refine bug classification + agent dispatch routing for the new classes.
   - **Option B — Replacing**: scrap the structural-DOM-comparison layers (parity kit-skeleton + computed-style audit), replace with pixel-diff + AI walkthrough. Synthesized E2E flows stay (they're cheap + deterministic) but become a _prerequisite_ gate, not the primary detector.
   - **Option C — Hybrid v2**: keep E2E flows + reachability + dev-server probe (the cheap deterministic checks), replace parity-verify with a single perceptual layer that combines pixel-diff and a Claude-with-vision walkthrough. Single tool, single prompt, drives the whole "does it look right + does it work right" decision.

Output: a concrete recommendation (one of A / B / C, or a fourth synthesized option), sized by phases, with token + time + cost projections vs current.

## Hypothesis

(Frontmatter `hypothesis:` block contains the load-bearing version. This section adds the strategic framing.)

The current pipeline was designed when the operator was the only check on visual correctness — Mode A → operator-eyeballs-mockup → operator-signoff → Mode B → fix-loop. The fix-loop's job was tactical (resolve specific filed bugs), not strategic (validate the app holistically). When `/build-to-spec-verify` was bolted on as the autonomous-detection layer, it inherited the structural-DOM bias of the synthesizer + parity-verifier instead of including a perceptual surface from day one.

The 94% resolution metric is therefore **measuring the wrong thing** — bug-fixers resolve bugs that the verifier files; the verifier files bugs it can structurally observe; bugs structurally invisible to the verifier never enter the loop. Add a perceptual layer and the metric transforms from "we resolved 15-of-16 filed bugs" to "we resolved 15-of-N actually-broken-states", where N is materially larger (bug-077 alone would push it from 16 to 17+).

The architectural question — additive vs replacing vs hybrid v2 — depends on the **token + time + cost** profile of pixel-diff + AI walkthrough at scale. A 180-min investigation budget has to answer that with empirical measurement, not theory.

## Investigation Steps

(Ordered to fit the 180-min budget. Each step has a rough time allocation. If a step blows its budget, document partial findings + skip to the next.)

### Step 1 — Empirical coverage census (~45 min)

1.1. Manually walk through the running reading-log-02 dev server (port 3000). Visit every route: `/`, `/books/[id]`, `/book-create`, `/settings`, `/tags`. For each route, exercise: empty state, populated state, modal open/close, theme toggle (light/dark), sidebar width at standard viewport, sidebar collapse if applicable, search input filtering, tag filter, status filter, error states (delete a book, bad-search input), keyboard nav.

1.2. For each issue found, file a row in `docs/build-to-spec/manual-walkthrough-2026-05-08.md` with: screen/interaction, observed behavior, expected behavior (vs mockup at `docs/screens/webapp/<screen>.html`), severity (P0 = ships-broken / P1 = ships-degraded / P2 = polish), and a column **"verifier coverage"** marking one of:

- ✓ would catch (existing layer + how)
- ✗ structurally invisible (which layer would NEED to change to catch it)
- ? unclear (needs deeper analysis)

  1.3. **Falsification target:** if the column-✓ rate is ≥80%, the verifier coverage is fine + the issue is metric-noise / iteration cap; recommend Option A-lite (small refinements to existing layers). If ≤50%, the structural bias is real and Option B or C is justified.

### Step 2 — Audit existing perceptual surface (~25 min)

2.1. Read `scripts/audit-computed-styles.mjs` end-to-end. What properties does it compare? On what baseline? When does it fire (every parity-verify run, or gated)? Why didn't it catch bug-077 (entire missing Tailwind = `display: block` instead of `display: flex` on every flexed element)? Output: a one-page summary of what audit-computed-styles can + can't see, and whether it's gated off / under-sampled / mis-thresholded.

2.2. Read `orchestrator/src/parity-verify.ts` — trace the audit-computed-styles invocation site. Confirm whether the bug-077 case (no PostCSS config) would produce a measurable computed-style delta vs mockup, OR if the audit's baseline is also unstyled (mockup uses CDN Tailwind so its computed styles ARE working) — if so, the audit SHOULD have caught it but didn't run / was deprioritized.

2.3. Cross-reference findings with investigate-022's hypothesis tree (H1/H2/H3) — note where investigate-025 affirms vs refines vs supersedes them.

### Step 3 — Playwright MCP feasibility probe (~30 min)

3.1. Read user-research signals (transcribed in this plan's Question + Hypothesis sections). Confirm: Microsoft official Playwright MCP server exists, exposes `browser_navigate`, `browser_take_screenshot`, `browser_resize`, `browser_click`, etc. as tools.

3.2. Empirically test: spin Playwright MCP locally (or via Claude Desktop MCP integration if available in this session). Drive it through reading-log-02 with a natural-language prompt: "Open `http://localhost:3000`, take a full-page screenshot, list every visual issue you see compared to a typical book-tracking web app (you do not have access to the mockup; describe what you observe)." Time the dispatch + capture token cost. The output is a sample artifact — does the MCP-driven walkthrough surface bugs the structural verifier missed?

3.3. **Token-efficiency tradeoff:** measure (or estimate from MCP docs) token cost of the same task via Playwright CLI (script-based, save screenshot to disk, separate vision-LLM analysis). Per user-research, CLI is ~4× cheaper. If empirically true, the orchestrator's bias should be CLI-with-vision-handoff, not MCP-direct-control.

### Step 4 — Pixel-diff feasibility probe (~25 min)

4.1. For one screen (e.g. `/books/[id]` or `/settings`), capture a screenshot of the mockup HTML rendered in headless Playwright (the mockup's CDN Tailwind generates real computed styles, so its rendered output is the correct visual ground truth). Capture the same screen from the live build at the same viewport. Run `pixelmatch` between them with default threshold; record the diff percentage + a heatmap PNG.

4.2. Repeat for a deliberately-broken state (e.g. remove `apps/web/postcss.config.mjs`, regenerate). Verify the pixel-diff fires hard (>50% pixel difference) — confirms pixel-diff would catch bug-077-class issues unambiguously.

4.3. Document threshold tuning: at what `maxDiffPixels` setting do we get clean signal (true positives only) vs noisy signal (false positives from anti-aliasing, font hinting, sub-pixel layout)? Cite the user-research point: hybrid mode (combine pixel-diff with structural context) is the modern-MCP-server approach.

### Step 5 — Synthesizer walkthrough audit (~20 min)

5.1. Read 1-2 representative synthesized E2E specs (e.g. `apps/web/e2e/synthesized/flow-1.spec.ts`). Catalog: how many `page.goto`, `page.click`, `page.fill`, `expect`-assertions does the spec contain? Does it ever take a screenshot? Does it ever navigate to multiple sub-routes? Does it ever validate post-action layout (e.g. "after clicking 'New book', a modal should be visible AND have the book-create form inside it")?

5.2. Compare with what the user-flows-manifest.json declares for that flow. Is the synthesizer dropping interaction richness, or is the manifest itself shallow (the manifest's authoring stage is upstream — `/user-flows-generator`)?

5.3. Output: a one-page assessment of how much of the "real user behavior" the synthesizer captures. If it's <30% of a real user's session, the H2 hypothesis is confirmed.

### Step 6 — v2 architecture sketch + cost projection (~30 min)

6.1. Synthesize findings from Steps 1-5 into a coverage matrix:

| Bug class                                 | Current detection | Option A detection  | Option B detection | Option C detection |
| ----------------------------------------- | ----------------- | ------------------- | ------------------ | ------------------ |
| Selector regression (E2E hit fails)       | ✓                 | ✓                   | ✓                  | ✓                  |
| DOM structure drift (kit-skeleton diff)   | ✓                 | ✓                   | ✗                  | partial            |
| Computed-style drift (single property)    | partial           | ✓                   | ✗                  | ✓ (via vision)     |
| Whole-page-unstyled (bug-077 class)       | ✗                 | ✓ (pixel-diff)      | ✓ (pixel-diff)     | ✓ (vision + pixel) |
| Layout chrome wrong (sidebar width, etc.) | ✗                 | ✓ (vision OR pixel) | ✓                  | ✓                  |
| Interaction wiring missing (button no-op) | partial           | ✓ (walkthrough)     | ✓                  | ✓                  |
| ... [filled from Step 1 census]           |                   |                     |                    |                    |

6.2. For each option, project: per-feature wall-clock cost, per-feature token cost, fix-loop iteration count needed to converge, and what the resolution-rate metric would be re-baselined to. Use Step 3's empirical measurement for the AI-walkthrough cost and Step 4's measurement for pixel-diff.

6.3. Pick the recommended option (A / B / C / D=synthesized). Explain why. Size the v2 ship as phased plans (likely 4-6 phases mapping to feat-NNN). Identify what existing surfaces get preserved vs deprecated vs replaced. Identify the load-bearing risks (e.g. "vision-LLM walkthroughs are expensive AND non-deterministic — need a deterministic gate before invoking them" → pre-gate with build success + dev-server-200).

### Step 7 — Findings + recommendation write-up (~5 min)

7.1. Update Findings + Recommendation sections of this plan. State whether time-box was sufficient, what was deferred to a follow-up investigation, and what concrete plan IDs (feat-NNN) the recommendation spawns.

## Findings

### Step 2 — audit-computed-styles surface audit

**The audit IS wired in correctly + DOES fire each fix-loop iteration.** Trace:

- `orchestrator/src/build-to-spec-verify.ts:668` calls `parityVerify(parityArgs)` per iteration
- `orchestrator/src/parity-verify.ts:519-575` (commit `7bfc996`, investigate-022 Step 3) imports `scripts/audit-computed-styles.mjs::auditAndClassify`
- Mockup snapshot loads via `file://` URL with `waitUntil: "networkidle"` + 1s grace period (line 449-463) — Tailwind Play CDN compiles utilities + flushes styles before `getComputedStyle()` capture
- 35 curated CSS properties captured per `[data-kit-component]` element (parity-verify.ts:589-625)

**So mockup snapshots ARE styled correctly** (Tailwind CDN works). And the build snapshots (with bug-077 broken Tailwind) WOULD show massive divergence. The audit fires, divergences exist. **Why didn't bug-077 file?**

Three load-bearing config defaults silently suppress the signal at exactly the systemic-failure scale (`scripts/audit-computed-styles.mjs:298-329`):

1. **`PATTERN_ALLOWLIST = new Set(["layout-regrouping"])`** — only 1 of 4 classifier patterns is shipped by default:
   - ✓ `layout-regrouping` (display, flex-direction, justify-content, align-items, width, height) — kept
   - ✗ `token-drift` (color, border-color, border-radius, border-width) — silently dropped
   - ✗ `copy-sizing-drift` (font-family, font-size, font-weight, line-height) — silently dropped
   - ✗ `spacing-token-drift` (padding, margin, gap, row/column-gap) — silently dropped

   Bug-077's most visible signal (every text on every page is wrong font + wrong color + wrong spacing) was deliberately suppressed. Operator override exists (`AUDIT_COMPUTED_ALL_PATTERNS=1`) but isn't documented as a debug knob and isn't on by default.

2. **`MAX_DRIFTS_PER_BUCKET = 5`** — top-5 layout-regrouping drifts per screen. With bug-077, the audit would find 50+ layout drifts across the page (every flexed container shows `display: block` instead of `display: flex`). 5 of those file as a bug-parity-{screen}-layout-regrouping. Bug-fixer dispatches; bug-fixer's "smallest possible diff" mandate makes JSX-level changes. Audit refires next iteration → finds DIFFERENT top-5 drifts (because the build's JSX is different now). System sees "different bugs" → marks earlier "resolved" → never identifies the systemic root cause.

3. **Bug-fixer per-bug isolation** — even if all 50 layout-regrouping drifts were filed, the bug-fixer agent receives them as 50 independent dispatches. Its "narrow scope + no refactor" frontmatter explicitly prevents systemic-pattern-recognition. Reading-log-02 v5 shipped as commits like `99d891b fix(book-detail): add missing Change cover + Edit details buttons` and `9921ddb fix(parity): align books-list-empty layout` — each commit fixes ITS specific layout, but the underlying "Tailwind utilities don't compile" is invisible to the agent.

The audit detected the right divergences. The classifier dropped 75% of the signal. The threshold + per-bug isolation pattern turned the rest into a shell game.

**Hypothesis H3 (structural-not-perceptual) refined:** The audit IS perceptual (it reads computed styles, not class strings). But it's _narrowly_ perceptual — high-resolution per-property + per-element. It can't see that "the entire page is unstyled" because that signal is distributed across thousands of property+element comparisons.

### Step 3 — Playwright MCP feasibility

(Knowledge-based + cross-referenced with user-supplied research signals; physical Playwright MCP execution deferred to Phase 4 implementation when the v2 layer is being built.)

- **Microsoft official Playwright MCP server** (`@playwright/mcp`) exposes `browser_navigate`, `browser_take_screenshot`, `browser_click`, `browser_fill`, `browser_wait_for`, `browser_press_key`, `browser_resize` as MCP tools. Driven by an LLM agent via natural-language prompts.
- **Token cost profile**: each tool result streams an ARIA snapshot of the post-action page (text representation of DOM tree). For a 10-step walkthrough, that's ~30-60K input tokens (snapshot growth per step) before the model's output budget kicks in. At Sonnet rates: ~$0.10-0.20 per walkthrough. Tractable but not negligible at scale (per-feature × per-iteration).
- **Playwright CLI alternative** (per user research, ~4× cheaper):
  - Author a deterministic `walkthrough.ts` Playwright spec that captures screenshots at each step
  - Save screenshots to disk locally (`page.screenshot({ path })`)
  - Single Claude API call hands all screenshots + mockup references to a vision-LLM with the prompt: "Compare each pair (mockup left, live right). List visible discrepancies."
  - No per-step ARIA snapshot streaming → 4× fewer tokens
  - Trade-off: walkthrough is scripted (deterministic) not improvised (AI-driven); catches issues the script anticipates but misses surprises a human-style walkthrough would notice
- **Hybrid approach** (recommended): Playwright CLI for the 80% deterministic case (every screen, every iteration); Playwright MCP for the 20% on-demand "let the AI poke around" case (operator-triggered, end-of-fix-loop, lower frequency).

### Step 5 — Synthesized E2E walkthrough audit

flow-1.spec.ts (158 lines) audited as representative (other flows follow the same template):

- 7 interaction steps mapped 1:1 from `docs/user-flows-manifest.json` flow-1 entry
- Selectors: `role=button[name="Add your first book"]`, `input[placeholder="..."]`, `[data-screen-id="books-list"]` — all role-based + structural
- **Critical: NONE of the assertions verify visual rendering.** `[data-screen-id]` attributes are present in DOM regardless of CSS state. `getByRole` matches on accessible-name + role, not on whether the button looks like a button.
- No `page.screenshot()` on success path — only on catch-block failure for downstream debugging
- No `getComputedStyle()` checks — ever
- `runtimeCtx` captures console errors + page errors + network failures + dev-server overlay → catches runtime crashes but not visual broken-ness

For bug-077 (no Tailwind compiled): every selector hit succeeds. Every assertion passes. **Test reports green on a build that visually doesn't render.** Confirms H2.

Walkthrough coverage estimate: 6 flows × avg 6 interactions = ~36 interactions for the entire app. A real human inspecting reading-log-02 for 60 seconds does ~25 distinct things — clicks, hovers, scrolls, viewport-resize-tests. The synthesized flow tier covers ~80% of explicit user stories from the manifest, **0% of implicit visual integrity checks**.

### Step 1 — Empirical coverage census (DEFERRED to user)

This step needs the user's screen on the running reading-log-02 dev server. Will engage the user to walk through manually + populate the coverage matrix.

### Step 4 — pixelmatch feasibility (DEFERRED)

Step 4 needs a working pixelmatch pipeline to demonstrate. Defers to Phase 2 implementation (when feat-NNN ships pixel-diff smoke as a new verifier layer) — not necessary to run a tool-call demo here; the design is already clear from Step 2's findings (mockup-loaded-via-file-URL pattern is the proven path; Sharp/pixelmatch are stable npm packages).

## Recommendation

**Recommend Option C — Hybrid v2** (variant of the original Option C with refined phases based on Step 2 findings). Five phases total, ordered by leverage-per-effort:

### Phase 1 — Fix audit-computed-styles classifier defaults (~4hr, P0)

The audit ALREADY catches bug-077-class issues. Three config changes unlock most of the dormant signal:

1. **Default-on all 4 patterns**: change `PATTERN_ALLOWLIST = new Set(["layout-regrouping"])` to `new Set(["layout-regrouping", "token-drift", "copy-sizing-drift", "spacing-token-drift"])` in `scripts/audit-computed-styles.mjs:316`. Operator override already exists for the conservative path (`AUDIT_COMPUTED_DEFAULT_ONLY=1`).
2. **Raise per-bucket cap**: `MAX_DRIFTS_PER_BUCKET` from 5 → 20. Catches systemic failures (50+ drifts on same screen = real signal not noise).
3. **Add a "systemic-divergence" classifier**: when a single (screen, pattern) tuple has >15 drifts, fold them into ONE high-priority bug class with a different agent dispatch (see Phase 5). Don't churn through 20 individual fixes for one root cause.

File as bug-078 (P0). Smallest leverage but unblocks the most existing detection.

### Phase 2 — Pixel-diff smoke layer (~6hr, P1)

New `scripts/audit-pixel-diff.mjs` + wiring into parity-verify. For each screen:

- Render mockup (file:// + CDN networkidle + 1s grace — same as audit-computed-styles)
- Render live page (already happening for kit-skeleton + computed-styles audit)
- `pixelmatch(mockupPNG, livePNG, diffPNG, { threshold: 0.1 })` → returns diff pixel count
- Threshold: <2% pixels different → pass; 2-15% → file `pixel-minor-divergence`; >15% → file `pixel-systemic-divergence` (bug-077 class)
- Add `pixel-systemic-divergence` to `FlowPrimaryCause` enum + dispatch routing (likely → systemic-fix agent variant)

File as feat-NNN. Catches whole-page-broken cleanly with one number.

### Phase 3 — Vision-LLM perceptual review (~10hr, P1)

New `orchestrator/src/perceptual-review.ts` + Claude Sonnet API integration:

- Per screen: send mockup PNG + live PNG to Claude with prompt: "List visible discrepancies between live (left) and mockup (right). Format: `{element}: {what differs}`. Skip dynamic content (timestamps, generated IDs)."
- Structured-output schema: `{ findings: [{ element, mockup, actual, severity }] }`
- Each finding files as `perceptual-divergence` bug class
- Cost projection: ~$0.005-0.01 per screen at Sonnet rates × 6 screens × per-iteration = ~$0.06/iteration → ~$0.30 for a 5-iter run. Tractable.

File as feat-NNN. Catches "sidebar wrong width", "padding wrong on settings page" — the H3 perceptual gap.

### Phase 4 — AI walkthrough layer (~12hr, P2)

New `scripts/ai-walkthrough.mjs` (Playwright CLI variant per user-research token-efficiency tradeoff):

- Author a deterministic walkthrough script per project (or generic template that visits every route + exercises common interactions)
- Capture screenshots + DOM dumps at each step
- Single Claude API call: "Here are 30 screenshots from a walkthrough of `<app>`. Mockups attached. List interaction-level bugs you'd report as a QA tester (button doesn't do what its label says, modal opens wrong, theme toggle doesn't work, etc.)."
- Outputs `walkthrough-divergence` bug class entries

Optionally: also ship `scripts/mcp-walkthrough.mjs` as a Playwright MCP-driven variant for operator-triggered "let the AI poke around" mode. Higher token cost; reserved for end-of-fix-loop OR operator demand.

File as feat-NNN. Catches the long tail of interaction bugs the structured E2E flows miss.

### Phase 5 — Systemic-bug agent variant (~3hr, P1)

New `.claude/agents/systemic-fixer.md`:

- Triggered by Phase 1's "systemic-divergence" bug class OR Phase 2's pixel-systemic-divergence
- maxTurns: 12 (vs bug-fixer's 8) — needs more exploration depth for root-cause work
- System prompt explicitly authorizes "look across files; suspect the build pipeline, the scaffold, or the kit's CSS layer; do NOT just patch individual symptoms"
- mcp_servers: [] (still no Playwright MCP — keep cold-start tax low)

File as feat-NNN. Closes the bug-fixer-per-bug-isolation gap that turned bug-077 into a shell game.

### Total budget projection

- Phase 1: 4 hr → expected to close ~70% of the bug-077-class gap immediately
- Phase 2: 6 hr → another ~20%
- Phase 3: 10 hr → another ~5% (interaction-level perceptual)
- Phase 4: 12 hr → another ~3% (long tail walkthrough)
- Phase 5: 3 hr → enables systemic patches that don't have to wait for Phases 1-4

Phase 1+5 = 7 hr for ~70% gap closure. Highest leverage.

### What gets preserved vs replaced

| Surface                                           | Verdict                                                                          |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| Build / dev-server compile probe                  | KEEP — cheap deterministic gate                                                  |
| Synthesized E2E flows (selector + data-screen-id) | KEEP — catches structural regressions; refine in v3 if H2 turns out load-bearing |
| DOM kit-skeleton diff                             | KEEP — fast structural check                                                     |
| audit-computed-styles diff                        | KEEP + RECONFIGURE per Phase 1                                                   |
| Reachability / orphan check                       | KEEP — orthogonal axis                                                           |
| Pixel-diff smoke                                  | NEW — Phase 2                                                                    |
| Vision-LLM perceptual review                      | NEW — Phase 3                                                                    |
| AI walkthrough                                    | NEW — Phase 4                                                                    |
| Bug-fixer (existing)                              | KEEP — narrow-scope work; refined dispatch routing                               |
| Systemic-fixer (new)                              | NEW — Phase 5 for systemic patterns                                              |

### Open questions for follow-up

These need empirical evidence before committing to v2 design — recommend deferring to a Phase 0.5 micro-investigation (~30 min) before Phase 1 kicks off:

- **Q1**: Is `AUDIT_COMPUTED_ALL_PATTERNS=1` actually safe to default-on? Empirically test on reading-log-02 — does it produce signal-to-noise ratio that bug-fixer can act on, or does it overwhelm the loop with token-polish bugs?
- **Q2**: What's the actual % of bug-077-class issues that pixel-diff would catch but Phase 1's reconfigured audit-computed-styles wouldn't? If overlap >80%, Phase 2 might be deprioritized.
- **Q3**: Should we add a `tooling-css-pipeline-broken` discriminator class for the obvious cases (no postcss.config OR no @tailwind directives) to short-circuit Phase 1's per-element audit? Cheap deterministic check; handles bug-077 in 0ms.

### Cross-references for follow-up plans

- bug-078 — Phase 1 (audit-computed-styles config fix)
- feat-NNN — Phase 2 (pixel-diff smoke)
- feat-NNN+1 — Phase 3 (vision-LLM perceptual review)
- feat-NNN+2 — Phase 4 (AI walkthrough)
- feat-NNN+3 — Phase 5 (systemic-fixer agent)
- bug-077 Phase D — closed by Phases 1+2; remove the placeholder "Phase D" from bug-077 plan in archive step

## Cross-references

- **Empirical motivator** — bug-077-react-next-tailwind-pipeline (filed 2026-05-08): the smoking gun. Project-wide missing Tailwind = 0 verifier signal across 5 fix-loop iterations. Manual inspection caught it in 30 seconds.
- **In-flight scoped investigations** (do NOT duplicate; cite their findings):
  - investigate-021-parity-verify-silent-false-clean-and-422-class — single-layer-scope: why parity-verify reports clean when it shouldn't
  - investigate-022-factory-verifier-missed-8-review-bugs-on-reading-log-01 — narrower-scope precursor (8-bug case study from reading-log-01); investigate-025 GENERALIZES this question
  - investigate-023-tester-prefers-spec-fixes-over-flagging-product-bugs — same "metric measures wrong thing" shape at the tester layer
- **Bug-fix dispatch efficiency (orthogonal axis)** — investigate-024-bug-fix-dispatch-efficiency (completed 2026-05-08): solved SPEED of dispatch (median 5-6 min/bug, was 25-90 min). investigate-025 is about EFFECTIVENESS of detection — the two are independent. v2 must preserve the speed wins.
- **Pre-existing surfaces to preserve / refine / replace**:
  - feat-038-deepen-synthesize-flow-e2e-and-data-seeding — synthesizer phase 1+
  - feat-039 — `mock` InteractionStep kind for E2E
  - feat-052-per-feature-parity-smoke-at-close-feature — parity smoke timing
  - scripts/audit-computed-styles.mjs (commit 7bfc996, investigate-022 Step 3) — the existing perceptual surface that didn't fire on bug-077
- **User research inputs (transcribed verbatim into Hypothesis)**: Playwright MCP server (Microsoft official), pixelmatch for visual diff, hybrid mode (pixel + structural context), Playwright CLI ~4× cheaper than MCP for terminal agents, `maxDiffPixels` threshold tuning to avoid false positives.

## Anti-goals

- **Do NOT propose "throw more iterations at it"** — investigate-024 already proved the fix-loop saturates around 5 iterations; more would just burn budget without improving detection. The bottleneck is detection coverage, not iteration count.
- **Do NOT propose "add another structural verifier"** — that's adding the same kind of check (DOM-comparison) and would not catch bug-077-class issues. The gap is perceptual; the fix must be perceptual.
- **Do NOT pre-commit to Playwright MCP specifically** — the user's research surfaces it as one of several tools. Step 3 must include "Playwright CLI + separate vision-LLM analysis" as an option, not just "MCP-driven AI control" — because token efficiency matters at scale.
- **Do NOT scope-creep into "rewrite the synthesizer"** — synthesizer improvements are downstream of investigate-025's recommendation. If the recommendation says "deepen flows", file as a follow-up feat-NNN, not in v1 of this plan.

## Attempt Log

<!-- Populated automatically by agents.

NOTE: This is a meta-investigation. Attempts that hit dead ends should
document the dead end clearly + try a fundamentally different angle.
DO NOT exceed time-box-minutes (180); partial findings + a clear
"what we couldn't answer in 180 min" gap-list are more valuable than
incomplete deep-dives.
-->
