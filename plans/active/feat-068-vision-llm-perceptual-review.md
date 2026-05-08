---
id: feat-068-vision-llm-perceptual-review
type: feature
status: draft
author-agent: human
created: 2026-05-08
updated: 2026-05-08
parent-plan: feat-066-fix-loop-effectiveness-v2
branch: feat/vision-llm-perceptual-review
affected-files:
  - orchestrator/src/perceptual-review.ts
  - orchestrator/src/parity-verify.ts
  - .claude/models.yaml
feature-area: orchestrator/verification-coverage
priority: P1
attempt-count: 0
max-attempts: 5
---

# feat-068: Phase 3 — vision-LLM perceptual review

## Problem Statement

feat-066 Phase 3. Pixel-diff (Phase 2) catches systemic breakage but is binary — it can't say "the sidebar is too narrow by 60px" or "the rename button has the wrong border color but the right icon position". A vision-capable LLM can render that perceptual judgment with structured output.

Empirical leverage on reading-log-02: ~15% (~5 of 30 bugs) — items the pixel-diff catches as "yeah something's different here" but doesn't articulate what; plus items the structural verifier misses entirely (Pencil icon underscore, theme System=Dark, etc.).

## Approach

1. **NEW `orchestrator/src/perceptual-review.ts`** — Anthropic API integration via the orchestrator's existing model-config plumbing.

2. **Per-screen prompt** (single Claude API call):
   - Image inputs: mockup PNG + live PNG side-by-side (or as separate vision blocks)
   - Prompt: "You are reviewing an app build against its design mockup. The mockup is the ground truth. List visible discrepancies between live (left/first) and mockup (right/second). Format strictly as JSON: `{ findings: [{ element, mockup, actual, severity }] }`. Skip dynamic content (timestamps, generated IDs, random book titles). Use `severity: 'P0'` for missing major elements / wrong copy / broken interactions, `'P1'` for color/spacing/sizing drift, `'P2'` for cosmetic polish."
   - Structured-output schema enforced via the orchestrator's existing JSON-mode logic.

3. **Bug class**: `perceptual-divergence`. Each finding becomes one bug entry. Routes to bug-fixer with a richer pre-loaded envelope (mockup PNG + live PNG + finding text).

4. **Cost control**:
   - Use Sonnet (not Opus) for cost — perceptual tasks don't need maximum reasoning
   - Cache mockup PNG embeddings if API supports (reduces per-screen cost when same mockup used across iterations)
   - Skip if pixel-diff already fired `pixel-systemic-divergence` for the screen (the systemic bug already covers it; perceptual review at that point is wasted)

5. **Cost projection**: ~$0.005-0.01 per screen × 6 screens × per-iteration ≈ $0.03-0.06/iteration. ~$0.15-0.30 for a 5-iter run.

6. **Add `perceptual-reviewer` agent slot to `.claude/models.yaml`** with tier:planning effort:medium (vision capability).

## Rejected Alternatives

- **Use Opus instead of Sonnet for vision review.** Rejected on cost — empirical signal that Sonnet's vision mode is sufficient for "list visible discrepancies"; no compelling reason to spend 5× more.
- **Drive vision review via Playwright MCP.** Rejected — MCP-driven flow streams ARIA snapshot per step (high token cost). Passing screenshot-pairs to a vanilla Claude API call is cheaper + simpler.
- **Run on every screen every iteration.** Rejected — gate behind structural signal so we don't pay vision-LLM cost on unchanged screens. (Cache the mockup-vs-live PNG hash; skip if no change since last iteration.)

## Expected Outcomes

- [ ] `perceptual-review.ts` ships with ≥80% test coverage (mocking the Anthropic SDK)
- [ ] Bug class `perceptual-divergence` flows through orchestrator → bug-fixer
- [ ] Bug-fixer dispatch envelope includes mockup PNG + live PNG (image-rich pre-load)
- [ ] On reading-log-02: catches items 4 (last added missing), 11 (debug pill), 24 (pencil underscore), 25 (System=Dark)
- [ ] Cost per fix-loop run ≤ $0.50 for typical 6-screen project
- [ ] Wall-clock per screen ≤ 5s including API round-trip

## Validation Criteria

1. Run on reading-log-02 census-state → `perceptual-divergence` fires for items 4, 11, 24, 25 (or close superset)
2. Run on a known-good build → 0 false positives (severity should never come back P0 on a valid screen)
3. Cost per screen logged + observable in `docs/build-to-spec/perceptual-review-cost.json`
4. Wall-clock + cost stay within projection on a 6-screen project

## Attempt Log

<!-- Populated by executing agents. -->
