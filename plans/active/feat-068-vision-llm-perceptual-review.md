---
id: feat-068-vision-llm-perceptual-review
type: feature
status: in-progress
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

### Attempt 1 — 2026-05-12 — Phase A landed with cascade contracts baked in

Shipped the full Tier 4 detection layer with the cascade design from the orchestrator's session (per-tier context flows downhill, expensive tiers gated on upstream signal).

**New surfaces:**

- `.claude/agents/perceptual-reviewer.md` — agent system prompt. Read+Write tools only; 3-turn max. Defines what counts as a finding, severity rubric, output contract (per-screen JSON written by agent + sentineled task outcome).
- `packages/orchestrator-contracts/src/perceptual-review.ts` — schema. `PerceptualFinding`, `PerceptualScreenReview` (with `skippedReason` enum: parity-systemic, parity-shell-stripping, dev-server-not-responding, no-mockup-png, no-live-png), `PerceptualReviewOutput`.
- `packages/orchestrator-contracts/src/bugs-yaml.ts` — `BugSourceSchema` extended with `perceptual-divergence`; new `BugPerceptualContextSchema` (element, mockup/actual values); `BugEntrySchema.perceptual` optional field.
- `packages/orchestrator-contracts/src/tasks.ts` — `TaskAgent` + `AgentSequenceMember` enums both extended with `perceptual-reviewer`.
- `orchestrator/src/perceptual-review.ts` — dispatcher. Implements cascade-skip rules (parity-systemic / parity-shell-stripping / dev-server-not-responding / no-png), per-screen invokeAgent dispatch with parity findings threaded into the user prompt as "DO NOT re-report" context, post-dispatch file read + Zod validation, aggregate `PerceptualReviewOutput` return.
- `orchestrator/src/build-to-spec-verify.ts` — wired in AFTER parity-verify completes. `ctx.runPerceptual` / `ctx.perceptualReview` / `ctx.invokeAgent` test seams. Screen list derived from `docs/build-to-spec/pixel-diffs/<screenId>.mockup.png` enumeration so it inherits parity's screen coverage without re-loading. Each finding flows through `fileBugPlan` as `kind: "perceptual-finding"`.
- `orchestrator/src/parity-verify.ts` — load-bearing companion fix: parity now ALWAYS persists both source PNGs per screen (not just on divergence) so Tier 4 can compare even on parity-clean screens.
- `scripts/file-bug-plan.mjs` — new handlers for `perceptual-finding` violation kind: bugSourceFor, stableSlugFor, summaryFor, defaultAgentSequence routing branch (primaryCause:perceptual-divergence → bug-fixer), new `perceptualFindingBody()` template, buildBugEntry surfaces the perceptual context.

**Cascade contracts (load-bearing per orchestrator-session design):**

1. Cheap → expensive ordering — Tier 4 runs only after Tier 0-3 produced their outputs.
2. Context flows downhill — perceptualReview's per-screen prompt includes the parity findings list for that screen so vision-LLM focuses on novel findings only.
3. Cascade-suppression — skip Tier 4 on screens where Tier 3 fired pixel-systemic-divergence or shell-stripping (systemic bug already covers); skip ALL screens when Tier 2 fired dev-server-not-responding.

**Test coverage:**

- 7 tests in `orchestrator/tests/perceptual-review.test.ts` (happy path, all 4 cascade-skip rules, parity-context threading into prompt, agent-no-output-file error path).
- 1 routing test in `orchestrator/tests/file-bug-plan-parity.test.ts` (perceptual-finding → bug-fixer + perceptual context preserved in bugs.yaml).
- Regression sweep: 133/133 across fix-bugs-loop + bug-fix-context + file-bug-plan-parity + perceptual-review.

**Empirical Phase D pending:**

Re-run /fix-bugs reading-log-02 with perceptual review active. Expected: 5-10 new bugs filed (visual issues parity missed), most routed to bug-fixer for surface fixes. Empirical lift target: 82% → 90%+ completion, closing most of the 13pt gap to 95%.

Outcome: code-side Phase A complete. Empirical Phase D blocked on dispatching against reading-log-02.
