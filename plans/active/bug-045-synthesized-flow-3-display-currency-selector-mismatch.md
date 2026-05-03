---
id: bug-045-synthesized-flow-3-display-currency-selector-mismatch
type: bug
status: draft
author-agent: human
created: 2026-05-03
updated: 2026-05-03
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/synthesizer-selector-inference-display-currency
affected-files:
  - scripts/synthesize-flow-e2e.mjs
  - projects/finance-track-01/docs/user-flows-manifest.json
feature-area: synthesizer/selector-inference
priority: P2
attempt-count: 0
max-attempts: 5
error-message: 'Test timeout of 30000ms exceeded. Call log: waiting for locator(''role=button[name="Display currency"]'')'
reproduction-steps: "From projects/finance-track-01: DATABASE_PATH=./data/finance-track-test.db PORT=3001 ENABLE_TEST_SEED=1 NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 pnpm -C apps/web exec playwright test e2e/synthesized/flow-3.spec.ts → fails at interaction 4+ (8 total) waiting for a button with name 'Display currency' that doesn't exist as named in the rendered page."
stack-trace: null
---

# bug-045: synthesized flow-3 interaction 4 selector mismatch — `role=button[name="Display currency"]` doesn't render

## Bug Description

Surfaced 2026-05-03 during Wave 2 empirical validation of the bug-040/041/042/043 chain. The seeding pipeline works (page snapshot confirms populated "Dashboard · May 2026 · normalized to EUR"); the synthesized flow-3 spec progresses past the 2026-05-02 empty-state failure (interaction 2: "No accounts yet") to fail at interaction 4 (8 total) waiting for `role=button[name="Display currency"]` — a button the synthesizer guessed should exist based on the user-flows-manifest's interaction step but which doesn't render with that exact name.

The synthesizer's selector inference (per `scripts/synthesize-flow-e2e.mjs:133 inferSelector`) generates Playwright selectors from the manifest's `interactions[].label` field. For "switch display currency" (or similar), it inferred `role=button[name="Display currency"]`. The actual rendered control on the dashboard is presumably a select/combobox/dropdown labeled differently (e.g., aria-label="Display currency selector" or it's a `<select>` not a button).

This is a synthesizer-vs-product-API mismatch. Fix path TBD: depends on whether the cleanest move is (a) sharpen the synthesizer's selector inference, (b) update the manifest to specify the actual selector hint, OR (c) add an aria-label to the rendered control matching the synthesized expectation.

## Reproduction Steps

```
cd projects/finance-track-01
DATABASE_PATH=./data/finance-track-test.db \
  PORT=3001 \
  ENABLE_TEST_SEED=1 \
  NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 \
  pnpm -C apps/web exec playwright test e2e/synthesized/flow-3.spec.ts --reporter=list
```

Empirical output (2026-05-03):

```
1) [chromium] › e2e\synthesized\flow-3.spec.ts:68:7 › Month-end review across currencies (flow-3)
   › walks 8 interaction(s) deterministically

   Test timeout of 30000ms exceeded.

   Call log:
     - waiting for locator('role=button[name="Display currency"]')
```

Page snapshot at failure confirms dashboard rendered populated UI (heading "Dashboard", "May 2026 · normalized to EUR" subtitle, full primary nav including a "Settings" link in the sidebar) — proving the seeding chain worked end-to-end.

## Root Cause Analysis

### 2026-05-03 diagnosis (Phase A complete — supersedes the inference-heuristic theory below)

**The bug is NOT a synthesizer or selector-inference issue.** Investigated the chain:

1. The manifest's flow-3 `interactions[]` explicitly authors `role=button[name="Display currency"]` (lines 369 + 375 of `docs/user-flows-manifest.json`). The synthesizer just emits exactly what the manifest specifies — it does NOT use `inferSelector` for v2.0 manifests with explicit selectors.
2. The DESIGN (`docs/screens/webapp/dashboard-populated.html` line 776) has `<button class="currency-selector" aria-haspopup="listbox" aria-label="Display currency">` in the topbar. The manifest's selector matches the design verbatim.
3. The BUILD (`apps/web/app/layout.tsx` + `apps/web/src/components/fx-status-indicator.tsx`) renders ONLY `<FxStatusIndicator />` in the AppShell `topBar` slot — a brand label + conditional FX-stale badge. **No currency selector control exists in the build at all.**

So this is a **build-completeness gap**: the build diverged from the design by omitting the topbar currency selector. The hand-written flow-3 (`apps/web/e2e/flow-3.spec.ts`) works around this by navigating to `/settings` to change the display currency (the build's only path to do so). The synthesized flow trusts the design and fails when the topbar control isn't there.

### Recommendation: defer to /build-to-spec-verify's fix-loop

`/build-to-spec-verify` is the canonical surface for catching build-completeness gaps:

1. Verifier runs the synthesized flow → flow-3 fails at interaction 4 with "waiting for locator..." timeout
2. Verifier files a bug entry in `docs/bugs.yaml` with the failing test as context (`flowFailure` correlated to the orphan if any)
3. Fix-loop dispatches a `web-frontend-builder` retry with the failing test as context
4. Builder reads the design HTML + sees the missing topbar currency selector + adds it to layout/topbar (likely a new `<TopBarCurrencySelector />` component replacing or wrapping `<FxStatusIndicator />`)
5. Re-run verifier → flow-3 passes

This is the loop the factory was designed for. Pre-fixing the build manually would BYPASS the verifier's coverage role + leave no audit trail of the gap.

### Original theory (REJECTED — kept for posterity)

The original framing assumed the synthesizer's selector inference (`scripts/synthesize-flow-e2e.mjs:133 inferSelector`) was guessing. It is NOT — for v2.0 manifests the synthesizer copies the explicit selector verbatim. Below was the rejected theory.

`scripts/synthesize-flow-e2e.mjs:133 inferSelector` walks fallback heuristics:

1. anchor whose href matches the to-screen
2. button/element whose visible text matches the to-screen label
3. modal-style screens → kit-component card-like
4. sidebar/nav link for top-level screens (`settings`/`profile`/etc)
5. fallback: any clickable that names the to-screen

"Display currency" likely matched heuristic 2 (button-like text). But the actual UI element might be a `<select>` (combobox role) or a button with a slightly different aria-label.

### Why this only surfaces post-bug-040/041/042/043

Pre-Wave-2: the spec failed at interaction 2 with "No accounts yet" (empty UI), masking everything beyond. Post-Wave-2: dashboard renders populated, interactions 1-3 pass, interaction 4 hits the selector wall.

### Three intervention points

1. **Synthesizer-side**: cross-reference docs/screens/{screen}.html (the design mockups) at synthesis time — the design HTML carries the actual `data-kit-component` + button/select markup the build emits. Inferring selectors from the design instead of from the abstract manifest label would converge synthesizer ↔ build.
2. **Manifest-side**: extend `interactions[]` schema with optional `selectorHint` field that the user-flows-generator can populate from the design HTML at manifest-authoring time, so the synthesizer doesn't have to re-infer.
3. **Build-side**: have web-frontend-builder add aria-label to the rendered control matching the manifest's interaction label. Aligns build output with synthesizer expectation.

Likely best: **Option 1 (synthesizer reads design HTML)** — same source of truth as bug-029's data-kit-\* attribute pass-through, scales to all flows without manifest-author burden.

## Fix Approach

### Phase A — diagnosis (COMPLETE 2026-05-03)

Phase A finding: design HTML has `<button aria-label="Display currency">` in topbar; build's topBar slot renders only `<FxStatusIndicator />` (brand label + FX-stale badge); no currency selector control exists in the build.

### Phase B — choose intervention (COMPLETE 2026-05-03 — DEFER to verifier's fix-loop)

Decision: don't pre-fix manually. Re-run `/build-to-spec-verify --bugs-yaml-mode=fresh` and let the verifier surface flow-3's failure as a real bug in `docs/bugs.yaml`. The fix-loop will dispatch a `web-frontend-builder` retry with the failing test as context; the builder will read the design HTML + add the missing topbar currency selector to `apps/web/app/layout.tsx`. This is the canonical loop the factory was designed for.

### Phase C — empirical re-validation (PENDING verifier rerun)

Re-run synthesized flow-3 after the fix-loop completes. Expect: interaction 4+ passes against the populated dashboard with the new topbar currency selector.

## Validation Criteria

- [ ] Synthesized flow-3 progresses past interaction 4.
- [ ] No regression on interactions 1-3 (which currently pass).
- [ ] Fix scales: doesn't require per-flow manifest hand-tuning if the same root cause hits flow-2/flow-5/etc.

## Cross-references

- **Empirical case**: 2026-05-03 finance-track-01 Wave 2 validation — surfaced after bug-040/041/042/043 fixed the seeding pipeline.
- **Sister bug**: bug-044 (hand-written flow-3 step 7 URL-regex bug) — different test, different surface, but same "post-Wave-2 visibility" theme.
- **Related synthesizer surface**: `scripts/synthesize-flow-e2e.mjs:133 inferSelector` — the selector-inference algorithm. bug-045 may motivate enhancing this with design-HTML cross-reference.
- **Related build-side surface**: `web-frontend-builder.md §2a HTML → JSX translation` — the data-kit-\* pass-through contract. May need to extend to aria-label preservation if Phase B points at build-side fix.
- **Predecessor**: bug-040/041/042/043 — Wave 2 empirical validation that proved the seeding chain works.

## Attempt Log

<!-- populated as fix attempts are made -->
