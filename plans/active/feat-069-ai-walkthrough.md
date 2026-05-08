---
id: feat-069-ai-walkthrough
type: feature
status: draft
author-agent: human
created: 2026-05-08
updated: 2026-05-08
parent-plan: feat-066-fix-loop-effectiveness-v2
branch: feat/ai-walkthrough
affected-files:
  - scripts/ai-walkthrough.mjs
  - orchestrator/src/walkthrough-review.ts
  - .claude/models.yaml
feature-area: orchestrator/verification-coverage
priority: P1
attempt-count: 0
max-attempts: 5
---

# feat-069: Phase 4 — AI walkthrough (Playwright CLI variant)

## Problem Statement

feat-066 Phase 4. The synthesized E2E flow tier executes 6 flows × ~6 interactions each = ~36 interactions for the entire app. A real user inspecting reading-log-02 for 60 seconds does ~25 distinct things (clicks, hovers, scrolls, viewport-resize-tests, theme toggles, keyboard nav). Synthesized flows cover ~80% of explicit user stories from the manifest, **0% of implicit interaction integrity** ("does the rename button actually rename", "does theme System actually differ from Dark", "does Tab traverse status filter buttons in expected order").

Empirical leverage on reading-log-02: ~15% (~5 of 30 bugs) — items 20 (open-documentation scrolls to top), 23 (New Tag no-op), 25 (System=Dark theme), 30 (Tab skips status buttons).

## Approach

1. **NEW `scripts/ai-walkthrough.mjs`** — Playwright CLI variant per user-research signal that CLI is ~4× cheaper than MCP for terminal agents (no per-step ARIA snapshot streaming).

2. **Walkthrough script** — deterministic Playwright script that visits every project route + exercises common interactions:
   - For each route in `architecture.yaml` route map: `page.goto`, screenshot, scroll-to-bottom, screenshot, viewport-resize-narrow, screenshot
   - For each user-flow `requiredState: empty`: trigger empty state, screenshot, click first CTA, screenshot
   - Generic interactions: theme toggle (light → dark → system), search input fill, keyboard Tab traversal of focusable elements
   - Saves N screenshots to `docs/build-to-spec/walkthrough/<screen>-<step>.png`

3. **Single Claude API call** — vision review of all walkthrough screenshots:
   - Image inputs: 30+ screenshots from the walkthrough + 5 mockup references
   - Prompt: "You are QA-testing this app. Here's a walkthrough of N screens. Mockups attached as reference. List interaction-level issues you'd report: button doesn't do what its label says, modal opens wrong, theme toggle doesn't appear to affect anything, keyboard nav skips elements, etc. Format JSON: `{ findings: [{ step, observation, expected, severity }] }`. Skip cosmetic drift (covered by other reviewers)."

4. **Bug class**: `walkthrough-divergence`. Each finding files as a bug; routes to bug-fixer with the relevant screenshots in the pre-load envelope.

5. **When to run**:
   - Default: end of fix-loop final iteration (after all other detection layers settled)
   - Operator-triggerable: `pnpm exec /ai-walkthrough` standalone for ad-hoc QA passes

6. **Cost projection**: ~$0.05-0.10 per walkthrough run (single API call; ~30 image inputs at ~1K tokens each + 1-2K output tokens).

7. **Optional Phase 4-add (deferred)**: Playwright MCP variant for operator-triggered "let the AI poke around" mode where the agent generates the walkthrough script ad-hoc instead of running a fixed one.

## Rejected Alternatives

- **Drive walkthrough via Playwright MCP server (AI generates each step).** Rejected per user-research — token cost is ~4× higher because each tool call streams ARIA snapshot of post-action page. Defer MCP variant to optional follow-up.
- **Run AI walkthrough every iteration.** Rejected on cost — once at end-of-fix-loop is sufficient for catching interaction bugs that survive earlier layers.
- **Split AI walkthrough into per-flow sub-walkthroughs.** Rejected — single big API call with all screenshots is cheaper in token-overhead AND lets the AI cross-reference (e.g. "the empty state I saw on screen 3 matches the empty state from screen 5, but the CTA copy differs in a confusing way").

## Expected Outcomes

- [ ] `scripts/ai-walkthrough.mjs` ships, deterministic walkthrough per architecture route map
- [ ] Triggers at end of fix-loop final iteration (or operator-on-demand)
- [ ] Bug class `walkthrough-divergence` flows through orchestrator → bug-fixer
- [ ] On reading-log-02: catches items 20, 23, 25, 30
- [ ] Cost per run ≤ $0.10
- [ ] Wall-clock ≤ 5 min including walkthrough + vision review

## Validation Criteria

1. Run on reading-log-02 census-state → catches items 20, 23, 25, 30 (or close superset)
2. Walkthrough script visits every route declared in architecture.yaml
3. Single API call (not N calls — important for cost projection)
4. Output schema validates against orchestrator-contracts BugEntry shape
5. No false positives on known-good build

## Attempt Log

<!-- Populated by executing agents. -->
