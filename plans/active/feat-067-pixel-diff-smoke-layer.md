---
id: feat-067-pixel-diff-smoke-layer
type: feature
status: draft
author-agent: human
created: 2026-05-08
updated: 2026-05-08
parent-plan: feat-066-fix-loop-effectiveness-v2
branch: feat/pixel-diff-smoke-layer
affected-files:
  - scripts/audit-pixel-diff.mjs
  - orchestrator/src/parity-verify.ts
  - packages/orchestrator-contracts/src/bugs.ts
feature-area: orchestrator/verification-coverage
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-067: Phase 2 — pixel-diff smoke layer

## Problem Statement

feat-066 Phase 2. Today's verifier compares DOM structure + class strings + per-element computed-styles, but never compares the **rendered pixel output** of the live page vs the mockup. That's the load-bearing detection layer for systemic visual breakage (bug-077 class — entire page unstyled) and for missing-elements that aren't `[data-kit-component]`-tagged in the mockup (sidebar book counts, "last added" subtitle, brand logo, debug pill, etc. — items 4, 6, 7, 8, 9, 10, 11 from the reading-log-02 census).

Empirical leverage: ~50% of the 30-bug reading-log-02 census becomes catchable.

## Approach

1. **NEW `scripts/audit-pixel-diff.mjs`** — pure-function module, no Playwright import. Exports:
   ```js
   export function diffScreenshots(mockupPNG, livePNG, options) { /* uses pixelmatch */ }
   export function classifyPixelDiff(diffStats, screenId) { /* returns ParityDivergence-shaped */ }
   ```
   Per-call deps: `pixelmatch` + `pngjs`. Sub-200ms per screen.

2. **Wire into `parity-verify.ts`** alongside existing kit-skeleton + computed-styles audits (around line 519). Captures already happen for both mockup + live page; just save them as PNG before the existing snapshot-capture-and-discard.

3. **Bug classes emitted**:
   - **`pixel-minor-divergence`** — diff 2-15% of pixels. Routes to bug-fixer (or class-batched per Phase 7).
   - **`pixel-systemic-divergence`** — diff >15% of pixels. Routes to systemic-fixer (Phase 5). Single bug per screen; cross-references the pre-verify deterministic discriminators where applicable.

4. **Threshold defaults** (tunable via env):
   - `PIXEL_DIFF_THRESHOLD_MINOR=0.02` (2% — anti-aliasing + font hinting noise floor)
   - `PIXEL_DIFF_THRESHOLD_SYSTEMIC=0.15` (15% — entire-page-broken signal)
   - `PIXELMATCH_THRESHOLD=0.1` (per-pixel match aggressiveness; pixelmatch's 0-1 scale)

5. **Diff PNG persistence** — when a bug is filed, write `docs/build-to-spec/pixel-diffs/<screen>.diff.png` so the bug-fixer can include it in the dispatch envelope.

## Rejected Alternatives

- **Use Percy / Chromatic / cloud visual-regression service.** Rejected — adds external dependency + per-snapshot $$$; pixelmatch + pngjs are local + free.
- **Pixel-diff every iteration regardless of upstream changes.** Rejected — ~200ms × N screens × M iterations adds up; only fire when at least one structural divergence is also present (gates pixel-diff cost on existing structural signal).
- **Use Playwright's built-in `toMatchSnapshot()`.** Rejected — Playwright snapshot tooling is per-test-file scoped; doesn't fit the per-screen-mockup-vs-built shape we need.

## Expected Outcomes

- [ ] `scripts/audit-pixel-diff.mjs` ships with ≥80% test coverage
- [ ] Wired into parity-verify behind existing computed-styles audit
- [ ] On reading-log-02 deliberately-broken-Tailwind state: emits `pixel-systemic-divergence` for every screen
- [ ] On a working build: emits 0 false positives at default thresholds
- [ ] Diff PNGs persisted in `docs/build-to-spec/pixel-diffs/`
- [ ] Bug-fixer dispatch envelope includes the diff PNG when fix is for a pixel-divergence bug

## Validation Criteria

1. Run on reading-log-02 with broken Tailwind state → `pixel-systemic-divergence` fires for all 5 screens
2. Run on the same project post-bug-077-fix → 0 pixel-systemic-divergences
3. Run on a small known-good visual change (one button color tweaked) → fires `pixel-minor-divergence` cleanly
4. Wall-clock per screen ≤ 500ms (capture+diff)
5. No regression on existing parity-verify outputs

## Attempt Log

<!-- Populated by executing agents. -->
