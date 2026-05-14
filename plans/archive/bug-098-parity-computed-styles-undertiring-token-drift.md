---
id: bug-098-parity-computed-styles-undertiring-token-drift
type: bug
status: closed
author-agent: human
created: 2026-05-13
updated: 2026-05-14
outcome: closed by diagnostic — hypothesis falsified. Audit IS firing correctly when mockup + build diverge; the user-reported tab-grey-vs-light-blue isn't a verifier gap but a design-intent issue (screen template's `.seg` already specifies #f1f4f5 grey, matching the build). Re-scoped to a new investigation about design-intent → screen-template token-binding consistency.
parent-plan: feat-066-fix-loop-effectiveness-v2 (v2-Phase-4)
supersedes: null
superseded-by: null
branch: fix/parity-computed-styles-token-drift
affected-files:
  - scripts/audit-computed-styles.mjs
  - orchestrator/src/parity-verify.ts
feature-area: verifier/parity
priority: P1
attempt-count: 0
max-attempts: 5
error-message: "Token-drift color divergences (e.g. grey-vs-light-blue active tab background) don't surface as parity-verify findings even when the rendered + mockup pixel ratios differ visibly to a human user"
reproduction-steps: "1. Inspect reading-log-02 user-reported bugs from manual session 2026-05-13. Prompt 1: 'All|Reading|Finished|Want to read|Paused tabs grey background (in screens its light blue)'. Same pattern on Prompt 5 (Settings sort tabs) + Prompt 6 (tag edit highlight green vs light blue). 2. Run /build-to-spec-verify on a clean reading-log-02 state. 3. Check parity bug count: token-drift entries SHOULD include these three — they did not on the empirical 2026-05-13 verifier runs."
stack-trace: null
---

# bug-098: parity-verify's computed-styles audit under-fires on token drift

## Bug Description

When the live app renders an interactive element (tab, button, highlight) with a different background color than the mockup token specifies, the divergence is visible to a human user but not surfaced by parity-verify's computed-styles audit. Reading-log-02's manual session captured three instances of this pattern across three different screens — none filed by the verifier in the 2026-05-13 runs.

## Empirical evidence

User manual session 2026-05-13:

- **Prompt 1** (library/populated): "All|Reading|Finished|Want to read|Paused Tabs grey background (in screens its light blue)"
- **Prompt 5** (Settings): "Background color is grey on tabs like Recently added|Title (A-Z)|Rating(highest) Light|Dark|System - screens show light blue"
- **Prompt 6** (Tags): "Edit tag - box highlights with green border - screen shows light blue background highlight"

All three should fire computed-styles `token-drift` divergences. None appeared in any of the verifier's 0/3-or-better bug-count outputs.

## Root Cause Hypotheses

**H1 — PATTERN_ALLOWLIST too narrow**: feat-066 Phase 1 (bug-078) was supposed to widen the allowlist beyond `["layout-regrouping"]` to include `token-drift`, `copy-sizing-drift`, `spacing-token-drift`. Maybe the widening didn't fully land OR the project's `audit-computed-styles.config.json` overrides back to the narrow set.

**H2 — Token-mapping gap**: the audit compares the computed `background-color` of a rendered element against the mockup's TOKEN value. If the project's design-tokens mapping doesn't link the mockup's "accent-50" token to the actual rendered "rgb(232, 240, 255)" computed style, the diff produces a noisy unrelated mismatch that gets filtered out OR scored as cosmetic-only.

**H3 — Per-bucket cap**: the audit caps each pattern bucket at 5 findings to avoid swamping the bug-fix loop. If parity-verify found 5 OTHER token-drifts and filtered to top-5, the tab-background drifts may have been silently dropped.

**H4 — Mockup vs built selector mismatch**: the audit walks tree-aligned selectors. If the mockup's tabs have a slightly different DOM nesting than the built version, the audit may compare the WRONG built element to the mockup element and produce false-matches.

## Fix Approach

**Step 1 (diagnostic)**: run `node scripts/audit-computed-styles.mjs projects/reading-log-02` in isolation against the current build + dump raw output. Inspect for:

- Was `token-drift` enabled in the allowlist?
- Did the audit find the tab-background divergence anywhere in raw output before filtering?
- What was the per-bucket cap hit count?

**Step 2 (fix per finding)**:

- If H1: widen allowlist OR fix the project config that's narrowing it.
- If H2: extend token mapping to cover the missing tokens (probably a one-pattern union).
- If H3: raise per-bucket cap OR allow MORE buckets to fire OR change the dedup key so distinct screens don't collapse into one bucket.
- If H4: tighten DOM-tree alignment OR add fallback by-className matching.

**Step 3 (validation)**: re-run /build-to-spec-verify on reading-log-02 — expect ≥3 new `token-drift` parity bugs for the tab-background pattern across the three affected screens.

## Cross-references

- **bug-078** — Phase 1 audit-computed-styles defaults fix. This bug suggests bug-078 didn't fully land.
- **feat-066 v2** — empirical metrics. This bug + bug-099 + bug-100 are the v2-Phase-4 follow-up surfaced by user manual session.

## Attempt Log

### 2026-05-14 — diagnostic falsified the hypothesis; bug closed; re-scoped finding documented

Walked through all 4 hypotheses from the plan body:

- **H1 PATTERN_ALLOWLIST too narrow**: ruled out. `scripts/audit-computed-styles.mjs` line 330-339 confirms the default `PATTERN_ALLOWLIST_DEFAULT` includes all 4 patterns (`layout-regrouping`, `token-drift`, `copy-sizing-drift`, `spacing-token-drift`). The narrow-only mode requires explicit `AUDIT_COMPUTED_LAYOUT_ONLY=1` env override.
- **H3 Per-bucket cap of 5**: ruled out. The default cap is `MAX_DRIFTS_PER_BUCKET = 20` (line 321-324), well above the 3 user-found color drifts.
- **H4 Mockup vs built selector mismatch**: ruled out. Both `docs/screens/webapp/books-list.html` (mockup, line 162+: `data-kit-component="Tabs"`) and `packages/ui-kit/src/primitives/tabs/tabs.tsx` (kit Tabs primitive, line 68: `data-kit-component="Tabs"`) emit the same attribute → selector path overlap in both snapshots.
- **H2 Token-mapping gap**: ruled out via empirical investigation. The screen template's `.seg` CSS class at line 162 explicitly hardcodes `background: #f1f4f5` (light grey). The style-1 mockup at `docs/mockups/style-1/webapp/books-list.html` also uses `#f1f4f5`. NEITHER source-of-truth specifies the user-expected "light blue" — both match the build's rendered grey.

**The audit IS working.** It correctly compares two `data-kit-component`-tagged trees + would report drift where one exists. The mockup template AND the build both express `.seg` background as `#f1f4f5` → no drift → no bug. The user's "light blue" expectation diverges from BOTH the mockup template AND the build, which means the issue isn't the verifier under-firing — it's the upstream design-intent pipeline (style picker, screen template generator, token bindings) that has already-baked-in the grey choice.

**Re-scoped finding** (warrants a separate investigation plan, not a bug):

There's no signal-feedback path from "user-found design-doesn't-match-expectation" back to the pipeline. The screen templates hardcode hex colors (e.g. `#f1f4f5`) instead of binding to named tokens (e.g. `var(--accent-50)`). This breaks the audit's ability to reason about token-binding correctness AND it locks the design-decision at screen-generation time without an obvious revision surface.

**Recommendation**: file a new investigation plan (`investigate-NNN-screen-template-token-bindings`) covering:

- Does `/screens` generate templates that reference named tokens vs hardcoded hex?
- If hardcoded: where does the hex value originate? `selected-style.json`? Brief? Default?
- What's the revision flow when the user reports "screens should be X instead of Y"?
- Should there be a `audit-design-tokens-vs-screens` step in the verifier?

Bug-098 closed; the empirical evidence is in the attempt log. Future work routes through the investigation rather than re-opening this bug with a same-framing fix.
