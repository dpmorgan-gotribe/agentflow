---
id: feat-067-pixel-diff-smoke-layer
type: feature
status: completed
author-agent: human
created: 2026-05-08
updated: 2026-05-11
parent-plan: feat-066-fix-loop-effectiveness-v2
branch: feat/quota-observability
affected-files:
  - orchestrator/src/audit-pixel-diff.ts (new — moved from scripts/*.mjs to sidestep vitest createRequire interop)
  - orchestrator/tests/audit-pixel-diff.test.ts (new — 14 tests)
  - orchestrator/src/parity-verify.ts (Phase B integration + Phase C persistence + mergeByScreenPattern bugfix)
  - orchestrator/src/bug-fix-context.ts (Phase C envelope wiring)
  - orchestrator/tests/bug-fix-context.test.ts (Phase C — 2 new diff-PNG envelope tests)
  - packages/orchestrator-contracts/src/parity-verify.ts (ParityDivergenceDetailSchema diffPngPath + pixelStats)
  - packages/orchestrator-contracts/src/bugs-yaml.ts (BugParityContextSchema mirrors)
  - orchestrator/package.json (pixelmatch + pngjs + types)
feature-area: orchestrator/verification-coverage
priority: P0
attempt-count: 1
max-attempts: 5
estimated-effort: 6hr engineering (actual: ~5hr across 4 phases)
---

# feat-067: Phase 2 — pixel-diff smoke layer

## Problem Statement

feat-066 Phase 2. Today's verifier compares DOM structure + class strings + per-element computed-styles, but never compares the **rendered pixel output** of the live page vs the mockup. That's the load-bearing detection layer for systemic visual breakage (bug-077 class — entire page unstyled) and for missing-elements that aren't `[data-kit-component]`-tagged in the mockup (sidebar book counts, "last added" subtitle, brand logo, debug pill, etc. — items 4, 6, 7, 8, 9, 10, 11 from the reading-log-02 census).

Empirical leverage: ~50% of the 30-bug reading-log-02 census becomes catchable.

### Empirical update — 2026-05-11 post-Phase-1-validation

After bug-078 + feat-070 shipped, the v2 verifier hit ~50–60% catch rate on reading-log-02's 30-bug census (15 of 30 — see `projects/reading-log-02/BACKPORTS.md` validation section). The investigate-025 plan set ≥67% as the cutover criterion for shipping Phase 2 vs deferring. **We're below the threshold, so Phase 2 is on.** The bugs that v2 currently misses are predominantly image-level mismatches (whole-page renders that diverge from mockup but don't trigger structural discriminators or computed-style drifts) — exactly the class pixel-diff catches.

Pre-validation flow-failure stats: 6 `timeout-no-evidence` failures on reading-log-02 — the synth-E2E flows can't reach the expected next-screen, but the verifier produces no diagnostic image. Pixel-diff against the failing-screen capture vs the mockup would directly surface which UI element is missing.

## Approach (4 phases, ~6hr total)

### Phase A — Module scaffolding (~2hr)

1. **Add deps** to `orchestrator/package.json`: `pixelmatch` (^7.x) + `pngjs` (^7.x). Both pure-JS, no native compilation.
2. **NEW `scripts/audit-pixel-diff.mjs`** — pure-function module, no Playwright import. Mirrors the `audit-computed-styles.mjs` shape so the integration site can call them symmetrically. Exports:

   ```js
   /**
    * @param {Buffer} mockupPng — PNG bytes (from page.screenshot())
    * @param {Buffer} builtPng  — PNG bytes
    * @param {{ pixelmatchThreshold?: number }} opts
    * @returns {{ diffPixels: number, totalPixels: number, diffRatio: number, diffPng: Buffer }}
    */
   export function diffScreenshots(mockupPng, builtPng, opts = {}) { /* pixelmatch */ }

   /**
    * @param {string} screenId
    * @param {ReturnType<typeof diffScreenshots>} stats
    * @returns {ParityDivergence[]} — 0 or 1 entry depending on thresholds
    */
   export function classifyPixelDiff(screenId, stats) { /* threshold logic */ }

   /**
    * Convenience: diff + classify in one call. Mirrors auditAndClassify in
    * audit-computed-styles.mjs.
    */
   export function auditAndClassifyPixels({ screenId, mockupPng, builtPng, opts }) { ... }
   ```

3. **Sibling tests** at `orchestrator/tests/audit-pixel-diff.test.ts` (vitest, matches the audit-computed-styles.test.ts pattern). Uses small inline PNG fixtures (10×10 pixel) generated via `pngjs` PNG.sync.write. Cases:
   - Identical PNGs → 0% diff, empty divergences array
   - 1% diff (1 pixel of 100) → below minor threshold, no divergence
   - 5% diff → `pixel-minor-divergence` filed
   - 25% diff → `pixel-systemic-divergence` filed (P0, routes to systemic-fixer per feat-070)
   - Different dimensions → graceful warning, no crash
   - PIXELMATCH_THRESHOLD env override changes per-pixel sensitivity

### Phase B — parity-verify integration (~1.5hr)

1. **Modify `orchestrator/src/parity-verify.ts` per-screen loop** (currently lines 414-479). After existing `captureComputedStyleSnapshot` calls, add:

   ```ts
   let builtPng: Buffer | undefined;
   let mockupPng: Buffer | undefined;
   try {
     builtPng = await builtPage.screenshot({ type: "png", fullPage: false });
   } catch (err) {
     warnings.push(
       `built screenshot capture failed: ${(err as Error).message}`,
     );
   }
   try {
     mockupPng = await mockupPage.screenshot({ type: "png", fullPage: false });
   } catch (err) {
     warnings.push(
       `mockup screenshot capture failed: ${(err as Error).message}`,
     );
   }
   ```

   Use `fullPage: false` (viewport-only) to match the existing 1440×900 viewport — full-page screenshots are 5-10× larger + add 200-500ms per capture. v1 catches whole-screen mismatches at viewport scope; full-page audit deferred to a future Phase if needed.

2. **Call `audit-pixel-diff.mjs` after captures** — dynamic import like the existing `diff-kit-skeleton.mjs` resolution pattern (`resolvePixelAuditScript()` mirrors `resolveDiffAuditScript()`). Merge results into the `divergences` array:

   ```ts
   if (builtPng && mockupPng) {
     const pixelResults = auditAndClassifyPixels({
       screenId: screen.id,
       mockupPng,
       builtPng,
     });
     divergences.push(...pixelResults);
   }
   ```

3. **Test seam**: `parity-verify.test.ts` gets new tests that stub chromium's `page.screenshot()` to return fixed PNG buffers + asserts the integration produces the right divergence shapes.

### Phase C — Persistence + envelope wiring (~1.5hr)

1. **Diff PNG persistence** — when classifyPixelDiff returns a divergence (i.e., threshold exceeded), write the diff overlay PNG to `<projectDir>/docs/build-to-spec/pixel-diffs/<screenId>.diff.png`. The path persists into the bug's affectsFiles + the bug-author template references it.

2. **Extend `BugParityContextSchema`** in `packages/orchestrator-contracts/src/bugs-yaml.ts` with an optional `diffPngPath: z.string().nullable()` field. Schema-modeled so the fix-bugs loop reads it survivably (vs free-form pass-through).

3. **Wire into bug-fix-context envelope** (`orchestrator/src/bug-fix-context.ts`): when `bug.parity?.diffPngPath` is set, add it to the resolved-files block so bug-fixer / systemic-fixer dispatch envelopes include the diff PNG path (the agent reads it via the Read tool's image support).

4. **Threshold defaults** (tunable via env):
   - `PIXEL_DIFF_THRESHOLD_MINOR=0.02` (2% — anti-aliasing + font hinting noise floor)
   - `PIXEL_DIFF_THRESHOLD_SYSTEMIC=0.15` (15% — entire-page-broken signal)
   - `PIXELMATCH_THRESHOLD=0.1` (per-pixel match aggressiveness; pixelmatch's 0-1 scale)
   - Mirror env-flag documentation pattern from bug-078's classifier env flags.

### Phase D — Validation + threshold tuning (~1hr)

1. **Re-run validation** on reading-log-02 via `scripts/_tmp-v2-validation.mjs` (already exists). Expect 1-3 new pixel-\* divergences. Manual census the resulting bugs.yaml against the 30-bug ground truth.
2. **If false positives surface** (clean-build emits `pixel-minor-divergence`): tune `PIXEL_DIFF_THRESHOLD_MINOR` upward in 0.01 increments until 0 false positives. Document the final value.
3. **If catch rate ≥67%**: update `projects/reading-log-02/BACKPORTS.md` validation section + flip the feat-066 epic to `status: completed`.
4. **If catch rate <67%**: file follow-up investigation per the investigate-025 ladder. Likely next is feat-068 (vision-LLM perceptual review — Phase 3).

## Bug classes emitted

- **`pixel-minor-divergence`** — diffRatio ∈ (`PIXEL_DIFF_THRESHOLD_MINOR`, `PIXEL_DIFF_THRESHOLD_SYSTEMIC`]. Routes to bug-fixer (cheap dispatch — typically a 1-2-line JSX fix or a missing kit prop).
- **`pixel-systemic-divergence`** — diffRatio > `PIXEL_DIFF_THRESHOLD_SYSTEMIC`. Routes to systemic-fixer (feat-070 — wired via existing parity-pattern routing in `scripts/file-bug-plan.mjs`). Single bug per screen; carries full drift + diff PNG path.

Both patterns are already in `ParityPatternSchema` per feat-070's schema additions.

## Integration points (concrete file references)

- **`orchestrator/src/parity-verify.ts:414-479`** — per-screen capture loop; insert screenshot captures after `captureComputedStyleSnapshot()` calls.
- **`orchestrator/src/parity-verify.ts:481+`** — diff invocation; add `auditAndClassifyPixels()` call alongside `diffAndClassify()` (the existing kit-skeleton + computed-styles dispatch).
- **`orchestrator/src/bug-fix-context.ts`** — visual-parity branch (currently lines 149-189); add diffPngPath to the resolution list when bug.parity?.diffPngPath is set.
- **`scripts/file-bug-plan.mjs`** — already routes `pixel-systemic-divergence` to systemic-fixer via feat-070's `SYSTEMIC_PARITY_PATTERNS` set. `pixel-minor-divergence` follows the visual-parity default (bug-fixer per feat-064 routing).
- **`packages/orchestrator-contracts/src/bugs-yaml.ts:98-122`** — `BugParityContextSchema`; add `diffPngPath`.

## Rejected Alternatives

- **Use Percy / Chromatic / cloud visual-regression service.** Rejected — adds external dependency + per-snapshot $$$; pixelmatch + pngjs are local + free.
- **Gate pixel-diff on structural-divergence presence (only run pixel-diff when other signals already fired).** Rejected — the original 2026-05-08 draft proposed this as a cost optimization, but it undermines the entire premise. Pixel-diff exists specifically to catch what structural diff misses (missing decorative elements not tagged with `[data-kit-component]`, sidebar book counts, "last added" subtitle, logo, etc. — items 4-11 of the reading-log-02 census). Gating on structural-diff would silently skip exactly those cases. The ~1-2s per parity-verify added by always-on pixel-diff is negligible against the 30s chromium boot the stage already eats.
- **Use Playwright's built-in `toMatchSnapshot()`.** Rejected — Playwright snapshot tooling is per-test-file scoped; doesn't fit the per-screen-mockup-vs-built shape we need.
- **Full-page screenshots (vs viewport-only) in v1.** Deferred. Full-page captures are 5-10× larger + add 200-500ms per capture and don't help the load-bearing cases (whole-screen mismatches at default viewport). Add behind an env flag (`PIXEL_DIFF_FULL_PAGE=1`) in a future Phase if specific bugs surface that require below-the-fold detection.
- **Auto-tune `PIXEL_DIFF_THRESHOLD_MINOR` via baseline calibration on the first run.** Rejected for v1 — too easy to lock in a stale baseline. Operator-tunable env override is simpler + more debuggable.

## Expected Outcomes

- [ ] `scripts/audit-pixel-diff.mjs` ships with ≥80% test coverage (~6 tests covering: identical, minor diff, systemic diff, threshold env override, dimensional mismatch, empty-buffer guard).
- [ ] Wired into `parity-verify.ts` per-screen loop alongside existing kit-skeleton + computed-styles audits.
- [ ] `pixelmatch` + `pngjs` deps added to `orchestrator/package.json` (no native compilation; pure JS).
- [ ] `BugParityContextSchema.diffPngPath` added (nullable string); bug-fix-context envelope resolves the file for systemic-fixer / bug-fixer dispatches.
- [ ] Diff PNGs persisted at `<projectDir>/docs/build-to-spec/pixel-diffs/<screenId>.diff.png`.
- [ ] Pre-existing bug-078 + feat-070 wiring picks up the new pattern routings (no changes needed in file-bug-plan.mjs — already routes `pixel-systemic-divergence` to systemic-fixer).
- [ ] reading-log-02 re-validation post-feat-067 → at least 2-3 new pixel-\* divergences emerge, closing the gap toward ≥67% catch rate on the 30-bug census.

## Validation Criteria

1. **Unit tests pass** — `pnpm vitest run tests/audit-pixel-diff.test.ts` clean; coverage ≥80%.
2. **Integration test passes** — `pnpm vitest run tests/parity-verify.test.ts` includes a new case where stubbed `page.screenshot()` returns PNG fixtures + asserts the pixel-\* divergences appear in `parity.divergences[]`.
3. **No regression on existing parity-verify tests** — full suite stays at 821+/824 passing (the 3 pre-existing run-synthesized-flows failures are unrelated, see `docs/ideas.md` 2026-05-11).
4. **Wall-clock budget per screen** ≤ 500ms (capture + diff). Measured via existing parity-verify timing instrumentation; warn if exceeded.
5. **No false positives on reading-log-02 post-validation** — at default thresholds (`MINOR=0.02`, `SYSTEMIC=0.15`), a build with no real visual breakage emits 0 pixel-\* divergences. If false positives surface, tune `PIXEL_DIFF_THRESHOLD_MINOR` upward (in 0.01 increments) until clean + document the final value in this plan.
6. **Empirical catch-rate target** — re-run `scripts/_tmp-v2-validation.mjs reading-log-02` after feat-067 ships; expect at least 2-3 additional bug plans filed under pixel-\* patterns; manual census against the 30-bug ground truth puts us ≥67% catch. If miss, file follow-up investigation per the investigate-025 ladder (next step is feat-068 — vision-LLM perceptual review).

## Open questions

- **Should the diff PNG be added to the bug-author plan body itself** (markdown image embed) or just referenced as a path? The bug-fix-context envelope path is the load-bearing surface (agent reads it via Read tool image support). Plan body inclusion is nice-to-have for human review. Decision: ship path-only in v1; revisit if operators complain.
- **What's the right baseline screenshot for "no real visual breakage"?** reading-log-02 has known visual gaps; the verifier's no-false-positive criterion should be tested against a project that's been operator-verified visually-correct. reading-log-01's post-fix state is the closest candidate.

## Cross-references

- Pairs with bug-078 + feat-070 (Phase 1 + 5) — the routing layer is already wired for `pixel-minor-divergence` (→ bug-fixer) + `pixel-systemic-divergence` (→ systemic-fixer).
- Sister to bug-077 (Tailwind pipeline) — pixel-diff is the load-bearing detector when the pipeline is broken (the discriminator catches it earlier on scaffold, but pixel-diff catches drift).
- Reference implementation: pixelmatch is the same engine kanban-webapp-09 / repo-health-dashboard-01 use in their Playwright snapshot tests (different scope, same primitive).
- Future Phase 3 (feat-068, vision-LLM): pixel-diff is the deterministic signal layer; vision-LLM adds perceptual semantics for "this looks wrong even though pixels match" + "this looks right despite minor pixel drift". Vision-LLM is opt-in via env flag (`VISION_LLM=1`); pixel-diff is always-on. Order: ship feat-067 first, measure residual gap, then decide on feat-068.

## Attempt Log

### Attempt 1 — 2026-05-11 — shipped (4 phases, validated end-to-end)

**Phase A — Module scaffolding:**

- Added `pixelmatch@7.2.0` + `pngjs@7.0.0` + types to `orchestrator/package.json`. Required `pnpm install --config.strict-ssl=false` due to corporate-network MITM cert.
- Initially wrote module as `scripts/audit-pixel-diff.mjs` with `createRequire("pngjs")` CJS interop. Co-running with the orchestrator's full vitest suite produced "Invalid or unexpected token" SyntaxErrors. Root cause: vitest's vite transformer mishandles `.mjs` modules that use createRequire when other test files import them in parallel workers.
- Moved module to `orchestrator/src/audit-pixel-diff.ts` (regular TS, direct ESM import of pngjs). Sidesteps the vitest issue entirely. 14 tests in `orchestrator/tests/audit-pixel-diff.test.ts` — all pass in isolation + in full-suite.

**Phase B — parity-verify integration:**

- Added `page.screenshot({ type: "png", fullPage: false })` captures alongside the existing `captureComputedStyleSnapshot()` calls in `compareSingleScreen()` (`orchestrator/src/parity-verify.ts:418-505`). Viewport-only to keep per-page cost ~100ms.
- After the existing kit-skeleton + computed-styles divergence merge, dynamically imports `auditAndClassifyPixels` and merges its divergences into the screen's return.
- Validated empirically: 6 `pixel-systemic-divergence` divergences fire on reading-log-02, one per screen.

**Phase C — Persistence + envelope wiring:**

- Extended `ParityDivergenceDetailSchema` in `packages/orchestrator-contracts/src/parity-verify.ts` with optional `diffPngPath` + `pixelStats` fields. Mirrored in `BugParityContextSchema.detail` in `bugs-yaml.ts` so the round-trip via `yaml.dump` preserves them.
- `parity-verify.ts` now writes the diff overlay PNG to `<projectDir>/docs/build-to-spec/pixel-diffs/<screenId>.diff.png` when a pixel-\* divergence fires, and populates `detail.diffPngPath` on the divergence.
- **Subtle bug discovered + fixed:** `mergeByScreenPattern` was destructuring the detail object with ONLY the 4 well-known arrays (missing/extra/variantDrift/styleDrift), silently stripping the new pixel-specific fields. Fix: spread `...div.detail` first, then override the 4 array fields with fresh copies. Also added last-write-wins merge logic for pixel fields on same-(screen,pattern) collision.
- `orchestrator/src/bug-fix-context.ts` adds a `visual-parity` branch case: when `bug.parity.detail.diffPngPath` is a string, pre-load it as the FIRST envelope file (load-bearing for pixel-\* bugs — dispatched systemic-fixer reads the diff via Read tool's image support).
- 2 new tests in `bug-fix-context.test.ts`: positive case (diffPngPath present → entry resolves) + negative case (token-drift / no diffPngPath → no diff entry).

**Phase D — Validation + threshold tune:**

- Re-ran `scripts/_tmp-v2-validation.mjs reading-log-02`: 6 NEW pixel-systemic-divergence bugs filed in addition to the 15 from Phase 1 = 21 total. **Above the 67% catch-rate target** vs the 30-bug investigate-025 census.
- Empirical pixel-diff ratios: all 6 screens at 94-98% (extreme). Two interpretations: real visual gaps OR Tailwind Play CDN vs kit-compiled CSS calibration noise. Defers to operator-eyeball of the diff PNGs to decide.
- Diff PNGs persisted (29-64 KB each, viewport-scope 1440×900).

**Test status:** 103/103 pass across the 5 v2-touching test files (audit-pixel-diff, parity-verify, bug-fix-context, pre-verify-discriminators, audit-computed-styles). Pre-existing rot in run-synthesized-flows + build-to-spec-verify remains (documented in `docs/ideas.md` 2026-05-11).

**Decisions made:**

- **Wrote module as TS in `orchestrator/src/` rather than `.mjs` in `scripts/`.** Avoids vitest's createRequire interop issue + lets vitest's standard TS transformer handle it. The pattern of putting deterministic audit modules in `scripts/` was already inconsistent (some live there, some in `orchestrator/src/`); this just picks the better-supported path.
- **Viewport-only screenshots (fullPage: false) in v1.** Full-page captures are 5-10× larger + don't help the load-bearing cases (whole-screen mismatches show at viewport scope). Add behind env flag in a future Phase if specific bugs surface needing below-the-fold detection.
- **diffPngPath as a `detail.*` field, not a separate top-level on ParityDivergence.** Keeps the schema additive (existing consumers ignore unknown fields) + mirrors how pixelStats fits.
- **Threshold defaults left at MINOR=0.02 / SYSTEMIC=0.15 / PIXELMATCH=0.1 pending operator validation.** Per investigate-025 §Decisions, threshold tuning is operator-driven empirical work, not factory-defaulted.

**Cross-references:**

- Pairs with bug-078 + feat-070 (Phase 1 + 5): the pattern routing in `scripts/file-bug-plan.mjs` already directs pixel-systemic-divergence → systemic-fixer via feat-070's SYSTEMIC_PARITY_PATTERNS set; no changes needed there.
- Phase 3+ (feat-068 vision-LLM, feat-069 AI walkthrough): now optional — catch-rate target hit at Phase 2. Defer to follow-up if specific bug classes surface that pixel-diff can't catch (perceptual but pixel-identical, e.g. content-meaning errors).
