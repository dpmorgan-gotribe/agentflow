---
id: bug-046-user-flows-generator-malformed-css-role-selectors
type: bug
status: draft
author-agent: human
created: 2026-05-03
updated: 2026-05-03
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/user-flows-malformed-mixed-selectors
affected-files:
  - .claude/skills/user-flows-generator/SKILL.md
  - scripts/synthesize-flow-e2e.mjs
  - orchestrator/tests/synthesize-flow-e2e.test.ts
feature-area: user-flows-generator/manifest-validation + synthesizer-preflight
priority: P1
attempt-count: 0
max-attempts: 5
error-message: "locator.click: Unexpected token \"=\" while parsing css selector \"[data-kit-component=\\\"Card\\\"]:has-text(\\\"Import CSV\\\") role=button\". Did you mean to CSS.escape it?"
reproduction-steps: "Run /user-flows-generator on a project with multi-button-in-card UX patterns (e.g. finance-track-01's Settings → Import CSV / Refresh FX flows). Inspect docs/user-flows-manifest.json — interactions[].selector fields will contain CSS+role= mixed via space (invalid Playwright syntax). Run /build-to-spec-verify; synthesized specs fail at runtime with 'Unexpected token = while parsing css selector'."
stack-trace: null
---

# bug-046: /user-flows-generator authors invalid Playwright selectors mixing CSS + `role=` via space

## Bug Description

Surfaced 2026-05-03 during finance-track-01 Wave 2 verifier-equivalent run. Synthesized flow-2 (CSV import) + flow-4 (FX refresh) failed at the same kind of error:

```
locator.click: Unexpected token "=" while parsing css selector
"[data-kit-component=\"Card\"]:has-text(\"Import CSV\") role=button". Did you mean to CSS.escape it?
```

Investigation traced the malformed selectors to the project's `docs/user-flows-manifest.json` directly — 7+ instances of selectors mixing CSS-shape (`[data-kit-component="X"]:has-text("Y")`) with Playwright's role-engine syntax (`role=button[name="Z"]`) via a SPACE (CSS descendant combinator). This is invalid Playwright syntax — the cross-engine chain operator is `>>`, not space.

The synthesizer faithfully passes through what the manifest contains. The manifest was authored by `/user-flows-generator` (LLM-driven). Root cause is the user-flows-generator's prompt: SKILL.md line 257 teaches a CSS-only descendant pattern (`[Card]:has-text(X) [Button]`), and the LLM **mis-extrapolated** to mix in `role=`.

Empirical scope across shipped projects:

- `finance-track-01`: 7+ malformed instances (lines 109, 127, 147, 167, 285, 441, 713 of manifest)
- `repo-health-dashboard-01`, `kanban-webapp-09`, `kanban-webapp-10`: zero (different flow shapes — they didn't trigger the multi-button-in-card pattern that exposes the mistake)

## Reproduction Steps

1. Run `/user-flows-generator` on a project whose screens contain multiple buttons inside the same Card / Dialog / EmptyState (e.g. an Add Account button inside a Dialog also containing close + cancel buttons).
2. Inspect the generated `docs/user-flows-manifest.json` `interactions[]`. Search for ` role=` (space-separated). Empirically: at least one match per multi-button-card flow.
3. Run `/build-to-spec-verify`. Synthesized specs fail with `locator.click: Unexpected token "=" while parsing css selector`.

Empirical case (2026-05-03 finance-track-01):

```
$ grep -c "has-text.*role=\|role=.*\[data-kit" projects/finance-track-01/docs/user-flows-manifest.json
7
```

## Error Output

From the verifier-equivalent run (`pnpm -C apps/web exec playwright test e2e/synthesized/flow-2.spec.ts`):

```
Error: flow-2 (Bulk import a week of transactions from CSV) failed at interaction 5:
  locator.click: Unexpected token "=" while parsing css selector
  "[data-kit-component=\"Card\"]:has-text(\"Import CSV\") role=button". Did you mean to CSS.escape it?
```

Same error shape on flow-4 interaction 4 with a different selector (`FX cache` / `Refresh FX now`).

## Root Cause Analysis

### Why the LLM mis-extrapolated

`.claude/skills/user-flows-generator/SKILL.md §4b` step 2 documents the selector preference order. Line 257 (in the "ambiguous selector" subsection) teaches:

> "If still ambiguous, prefer the kit-component selector and disambiguate via parent: `[data-kit-component="Card"]:has-text("Project A") [data-kit-component="Button"]`."

This is VALID CSS — both halves are CSS-shape selectors, descendant combinator (`space`) chains them, and Playwright's CSS engine handles the whole expression. Good guidance for the CSS-only case.

But the LLM extrapolated this to mix CSS with `role=`:

```
[data-kit-component="Card"]:has-text("Import CSV") role=button
```

Playwright's `role=` is its OWN selector engine (not CSS). Cross-engine chaining requires the `>>` operator:

```
[data-kit-component="Card"]:has-text("Import CSV") >> role=button
```

OR locator chaining:

```
page.locator('[data-kit-component="Card"]:has-text("Import CSV")').locator('role=button')
```

The SKILL.md's worked example doesn't cover this case, so the LLM applied the descendant-combinator pattern uniformly.

### Why the synthesizer doesn't catch it

`scripts/synthesize-flow-e2e.mjs:252` emits click interactions verbatim:

```js
case "click":
  return `      ${idx} await page.locator(${JSON.stringify(step.selector)}).click();`;
```

No selector validation at synthesis time. The malformed selector flows through to the spec file unchanged.

### Why the schema doesn't catch it

`packages/orchestrator-contracts/src/user-flows-manifest.ts` `ClickInteractionSchema` (line 101+) declares `selector: z.string().min(1)`. No syntactic validation — any non-empty string passes.

## Fix Approach

### Phase A — SKILL.md correction (P1, cheapest, prevents future projects)

1. **Add anti-pattern callout** to `.claude/skills/user-flows-generator/SKILL.md §4b` step 2:
   - "DO NOT mix CSS and `role=` selectors via space. CSS uses space as descendant combinator within ONE engine. To chain across engines (CSS → role=, text=, etc), use Playwright's `>>` operator OR locator chaining."

2. **Add valid worked example** showing the disambiguation pattern with `>>`:

   ```
   [data-kit-component="Card"]:has-text("Import CSV") >> role=button
   ```

   Plus the locator-chain alternative for cases where `>>` becomes hard to read.

3. **Reorder selector preference** to discourage the mix where possible — when a button has an unambiguous accessible name, prefer plain `role=button[name="Add account"]` over the kit-component-disambiguated form. Most flows don't need the disambiguation; the LLM defaults to the more complex form.

### Phase B — synthesizer pre-flight selector validation (P1, catches existing-project bad manifests)

4. **Extend `scripts/synthesize-flow-e2e.mjs`** post-flight (similar shape to bug-041's webServer check) to validate each `interactions[]` selector. Detection regex: ` role=` OR ` text=` preceded by non-whitespace AND not preceded by `>> ` AND coming after another selector segment (i.e. mid-selector, not start-of-string).

5. **Push to `errors[]` array** with the offending flow + interaction + suggested fix:

   ```
   errors.push(`flow-${flowId} interaction ${stepIndex}: malformed selector "${selector}" — mixes CSS and Playwright role= engine via space. Use ' >> role=...' to chain. See user-flows-generator/SKILL.md §4b anti-pattern callout (bug-046).`);
   ```

6. **Hard-error semantics** (per operator decision 2026-05-03): NO auto-rewrite. The synthesizer is intentionally a mechanical translator — fixing manifest authoring errors silently would create drift between what /user-flows-generator emits and what runs. Hard-error forces /user-flows-generator regeneration with the corrected SKILL.md.

### Phase C — empirical re-validation (P2)

7. After Phases A + B ship, dispatch `/user-flows-generator` on a fresh test project (or re-run on finance-track-01) + confirm zero malformed selectors in the new manifest.

### Phase D — finance-track-01 manifest recovery (project-side)

8. Re-run `/user-flows-generator` on finance-track-01 (LLM dispatch, ~$5-10) with the corrected SKILL.md to regenerate `docs/user-flows-manifest.json`. The new manifest should be clean.
9. Alternative if quota-bound: hand-fix the 7+ malformed selectors directly (one-time recovery; ~10 min). Not preferred — bypasses the LLM-regeneration validation loop.

## Rejected Fixes

- **Auto-rewrite `role=` after non-`>>` whitespace** — Rejected. Synthesizer is intentionally mechanical (per feat-038 design intent). Auto-fix hides authoring errors from /user-flows-generator + creates drift.
- **Schema-level zod refine on selector** — Rejected for selector field. Selector validity rules are complex (Playwright's selector engine has many valid forms). Pre-flight regex check at synthesizer is simpler + more specific to the known-bad pattern.
- **Document better, hope LLM follows** — Rejected. Same anti-pattern as bug-040/041; documentation alone is insufficient. Need automated enforcement.

## Validation Criteria

### Phase A

- [ ] SKILL.md §4b has anti-pattern callout for CSS+role= space mix.
- [ ] SKILL.md §4b shows valid `>>` chaining example.
- [ ] Selector preference reordered to favor unambiguous `role=button[name="X"]` over kit-component-disambiguated forms.

### Phase B

- [ ] Synthesizer regex-detects ` role=` / ` text=` after non-`>>` whitespace mid-selector.
- [ ] Detection pushes to `errors[]` with flow + interaction + fix suggestion.
- [ ] Regression test with a synthetic manifest containing one malformed selector → verifies error fires.

### Phase C

- [ ] Fresh project /user-flows-generator dispatch produces 0 malformed selectors.

### Phase D

- [ ] finance-track-01 manifest regenerated (or hand-fixed) → 0 ` role=` after non-`>>` whitespace matches.
- [ ] Synthesized flow-2 + flow-4 (the failing ones) progress past their malformed-selector interactions on next playwright run.

## Cross-references

- **Empirical case**: 2026-05-03 finance-track-01 Wave 2 verifier-equivalent run — surfaced after bug-040/041/042/043 fixed the seeding pipeline; was masked behind those failures pre-Wave-2.
- **Sister bug**: bug-047 (synthesizer toHaveURL semantics — same investigation; both manifest-authoring + synthesizer-translation issues).
- **Predecessor**: bug-040/041/042/043 — Wave 2 success unmasked these manifest authoring bugs that were always there.
- **Related synthesizer surface**: `scripts/synthesize-flow-e2e.mjs:252` (click), `:271` (assertVisible), `:268` (waitForSelector), `:273` (assertText), `:250` (fill), `:254` (select) — all selector-bearing interaction kinds need the same validation.

## Attempt Log

<!-- populated as fix attempts are made -->
