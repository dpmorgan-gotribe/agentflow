---
id: feat-048-synthesizer-output-linting
type: feature
status: draft
author-agent: human
created: 2026-05-03
updated: 2026-05-03
parent-plan: null
supersedes: null
superseded-by: null
branch: feat/synthesizer-output-linting
affected-files:
  - scripts/synthesize-flow-e2e.mjs
  - orchestrator/tests/synthesize-flow-e2e.test.ts
feature-area: synthesizer/defense-in-depth-output-linting
priority: P2
attempt-count: 0
max-attempts: 5
error-message: null
reproduction-steps: null
stack-trace: null
---

# feat-048: synthesizer output linting — TS typecheck + Playwright locator dry-create on emitted specs

## Feature Description

Defense-in-depth follow-up to bug-046 + bug-047. The 2026-05-03 Wave 2 verifier-equivalent run surfaced two classes of latent synthesizer failure modes:

1. **Manifest selectors invalid Playwright syntax** (bug-046 — caught at runtime as `Unexpected token "=" while parsing css selector`)
2. **Manifest URL patterns regex-vs-string semantic mismatch** (bug-047 — caught at runtime as `Expected pattern: /^\/foo/. Received string: "http://..."`)

Both are caught at PLAYWRIGHT RUNTIME — meaning the synthesizer emits an invalid spec, the spec gets written to disk, the verifier runs the full chrome+test boot just to discover the spec was malformed, and the operator pays $0 in LLM but ~30s of wall-clock per failure.

A pre-emission lint pass would catch these (and analogous future classes) before the spec ever runs. Two cheap mechanisms:

1. **TypeScript typecheck pass** — run `tsc --noEmit` against the emitted `apps/web/e2e/synthesized/*.spec.ts` directory after synthesis. Catches: import errors, type mismatches, deprecated Playwright API, syntactically-invalid TS that slipped through.
2. **Playwright locator dry-create pass** — for each `page.locator(<selector>)` call site, attempt `page.locator(selector)` in isolation (zero-arg create, no network, no DOM). Throws on syntactically-invalid selector. Catches: bug-046's CSS+role= mix, mis-escaped quotes, unbalanced brackets, etc.

Both run in <2 seconds for typical 9-flow projects. Catches issues that would otherwise consume verifier wall-clock + operator-debug attention.

## Why P2 (deferred)

bug-046 + bug-047 cover the live-surfaced classes. feat-048 is preventative for FUTURE classes that haven't surfaced yet. Worth filing now (so the design is captured while context is fresh) but not blocking — the regex-based pre-flight check from bug-046 covers the known-bad pattern; feat-048 is the broader generalization.

## Background

The synthesizer ships emitted specs to disk + reports `ok: true` regardless of whether they actually run. Empirically:

- **2026-05-02** (pre-Wave-1): synthesizer emitted 9 specs for finance-track-01; verifier ran them; 9/9 failed at runtime with various symptoms (mostly "No accounts yet" empty-state) → false-positive bugs filed.
- **2026-05-03** (post-Wave-1+2): synthesizer emitted same 9 specs; verifier ran them; 9/9 failed at runtime with NEW symptoms (selector parse errors, regex-string mismatches) → the new failures are caught by what feat-048 would lint pre-runtime.

The verifier's flow-execution stage costs ~30s per failed spec (chromium boot + global-setup + test attempt + timeout + teardown). Linting pre-emission saves: ~5min × 9 flows × N retries.

## Fix Approach

### Phase A — TypeScript typecheck pre-emission (P2)

1. **Author `scripts/lint-synthesized-specs.mjs`** — invoked after `synthesize-flow-e2e.mjs` writes specs:
   - Locate `apps/web/tsconfig.json` (project's tsconfig)
   - Spawn `pnpm exec tsc --noEmit -p apps/web/tsconfig.json --include "e2e/synthesized/**/*.spec.ts"`
   - Parse stderr for diagnostics
   - Push to `errors[]` (synthesizer's existing array per bug-041)

2. **Detection scope**: catches import errors, missing types, syntax errors, deprecated API usage in emitted specs. Does NOT catch runtime selector validity (Phase B).

### Phase B — Playwright locator dry-create (P2)

3. **Extend the lint script** to extract every `page.locator(<selector>)` invocation from the emitted specs (regex over the source).

4. **For each selector, attempt `playwright.selectors.parseSelector(<selector>)`** — Playwright exposes selector parsing internally. (If the API isn't directly accessible, fall back to running a tiny throwaway script: `await page.locator(selector).count()` with `page` from a closed browser context — throws on invalid selector before any DOM access.)

5. **Push parse-error to `errors[]`** with flow + interaction + offending selector.

### Phase C — Wire into orchestrator's verifier flow (P2)

6. **`orchestrator/src/build-to-spec-verify.ts`** — after synthesizer dispatch, before flow-execution stage, invoke the lint script. Surface lint errors[] in the verifier's warnings[] (similar shape to bug-041 Phase A's surfacing of synth errors[]).

7. **Lint failure semantics**: lint errors don't BLOCK the flow-execution stage (so existing-known-good specs still run) but DO surface clearly in the verifier output. Operator can decide whether to skip flow-execution on lint failures.

### Phase D — Unit tests + empirical validation

8. Regression tests in `orchestrator/tests/synthesize-flow-e2e.test.ts` (or new `lint-synthesized-specs.test.ts`):
   - Synthetic spec with TS error → lint fails
   - Synthetic spec with valid CSS selector → lint passes
   - Synthetic spec with bug-046-shape malformed selector → lint fails before runtime
   - Synthetic spec with valid Playwright selector → lint passes

9. Empirical: re-run synthesizer on finance-track-01 (post-bug-046+047 fix); confirm lint passes 0 errors.

## Rejected Approaches

- **Run actual playwright test in headless mode for lint** — Rejected. Defeats the cost savings (~30s per spec).
- **AST-parse emitted specs to extract + validate selectors** — Possibly equivalent to Phase B but more code; defer if Phase B's tsc + locator-dry-create pattern works.
- **Move lint into a separate orchestrator stage** — Considered. Keeping it as a synthesizer post-flight matches the existing pattern (bug-041 Phase A's webServer check, bug-037 Phase A's @playwright/test auto-add).
- **Schema-level zod refines on selector + pattern** — Considered. Schema validation is the wrong place: zod can't actually parse Playwright selectors, only catch obvious shapes. Defer to runtime lint.

## Validation Criteria

### Phase A (TS typecheck)

- [ ] `scripts/lint-synthesized-specs.mjs` exists + invoked post-synthesis.
- [ ] Catches synthetic TS-error spec.

### Phase B (locator dry-create)

- [ ] Catches bug-046-shape malformed selector pre-emission.
- [ ] Selector dry-create runs <500ms per spec.

### Phase C (orchestrator wiring)

- [ ] `build-to-spec-verify` surfaces lint errors in warnings[].
- [ ] Lint failures don't block flow-execution stage (soft-gate).

### Phase D (validation)

- [ ] Regression tests cover known + future patterns.
- [ ] finance-track-01 re-run post-bug-046+047 produces 0 lint errors.

## Cross-references

- **Predecessors**: bug-046 + bug-047 — feat-048 generalizes their narrow regex-based pre-flight checks to a broader lint pass.
- **Pattern-source**: bug-041 Phase A (synthesizer webServer check + errors[] surfacing) + bug-037 Phase A (synthesizer @playwright/test auto-add) — same shape of post-synthesis pre-flight pattern.
- **Cost reference**: 2026-05-03 verifier wall-clock — ~30s × 9 failed flows × 1 attempt = ~5min wasted per round; linting pre-runtime catches before wall-clock burn.
- **Defer reasoning**: bug-046 + bug-047's targeted fixes cover known cases; feat-048 is the systematic generalization. Ship after both bugs land + observed for ~1 project's worth of cycle.

## Attempt Log

<!-- populated as fix attempts are made -->
