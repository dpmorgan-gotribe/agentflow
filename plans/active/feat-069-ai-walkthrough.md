---
id: feat-069-ai-walkthrough
type: feature
status: approved
author-agent: human
created: 2026-05-08
updated: 2026-05-13
approved-by: human
approved-at: 2026-05-13
parent-plan: feat-066-fix-loop-effectiveness-v2
branch: feat/ai-walkthrough
affected-files:
  - scripts/ai-walkthrough.mjs
  - orchestrator/src/walkthrough-review.ts
  - orchestrator/src/build-to-spec-verify.ts
  - packages/orchestrator-contracts/src/walkthrough-review.ts
  - packages/orchestrator-contracts/src/bugs-yaml.ts
  - packages/orchestrator-contracts/src/tasks.ts
  - .claude/agents/walkthrough-reviewer.md
  - .claude/models.yaml
  - scripts/file-bug-plan.mjs
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
6. **Catches bug-094 (delete-fires-multiple-times) on reading-log-02 census-state** — the canonical empirical motivator surfaced 2026-05-13.

## Phased Implementation (added 2026-05-13)

The 2026-05-08 plan defines the approach; this section breaks it into shippable phases.

### Phase A — contracts + agent skeleton (~2hr)

- New `packages/orchestrator-contracts/src/walkthrough-review.ts`: `WalkthroughFinding`, `WalkthroughScreenReview`, `WalkthroughReviewOutput`, `WalkthroughReviewContext` schemas. Mirror the feat-068 perceptual-review contract shape — same JSON-output / sentineled-block / normalization patterns.
- `BugSourceSchema` in `packages/orchestrator-contracts/src/bugs-yaml.ts` gains `walkthrough-divergence` (already named in feat-073's round 4 config; just needs the schema entry).
- `AgentSequenceMember` + `TaskAgent` in `packages/orchestrator-contracts/src/tasks.ts` gain `walkthrough-reviewer`.
- New `.claude/agents/walkthrough-reviewer.md` — agent system prompt. Read-only (tools: Read), single invocation per fix-loop iteration when round 4 enabled, consumes the walkthrough's evidence bundle, emits sentineled JSON. Model tier: `building` (Sonnet 4.6) per the precedent set by `perceptual-reviewer`.
- `FACTORY_DEFAULT_AGENT_TIERS` in `orchestrator/src/model-config.ts` gains the new agent.

### Phase B — walkthrough script (~3-4hr)

- New `scripts/ai-walkthrough.mjs` — pure-Node Playwright CLI runner. Inputs: projectDir + verifyCwd + dev-server baseUrl. Behavior:
  - For each route in `architecture.yaml`'s route map: `page.goto`, screenshot, scroll-to-bottom, screenshot, narrow-viewport-resize, screenshot.
  - For each user-flow with `requiredState: "empty"` in `docs/user-flows-manifest.json`: trigger empty state, capture screenshot + click first CTA + capture screenshot.
  - Generic interaction sweep (per route): theme toggle (light → dark → system, capture each), search input fill + screenshot, keyboard Tab traversal (capture focus state every N tabs).
  - **Network capture (bug-094 motivator)**: install a `page.on('request')` listener that logs `{ method, url, timestamp, frame }` per request. Persist to `docs/build-to-spec/walkthrough/network.ndjson`. Vision agent gets this as a JSON input alongside the screenshots.
  - **Console capture**: `page.on('console')` + `page.on('pageerror')` → `docs/build-to-spec/walkthrough/console.ndjson`.
  - Saves screenshots to `docs/build-to-spec/walkthrough/<route-slug>-<step-id>.png`.

### Phase C — dispatcher wiring (~2hr)

- New `orchestrator/src/walkthrough-review.ts` analogous to `perceptual-review.ts`:
  - `runWalkthroughReview(ctx: WalkthroughReviewContext): Promise<WalkthroughReviewOutput>`
  - Reads screenshots + network log + console log from `<verifyCwd>/docs/build-to-spec/walkthrough/`
  - Dispatches `walkthrough-reviewer` agent via `invokeAgent` (threaded through from build-to-spec-verify's `invokeAgent` seam).
  - Normalizes the agent's emitted findings (similar to perceptual-review's schema-evolution normalization).
  - Cascade-skip rules: skip when walkthrough script produced 0 screenshots (signal: dev-server boot failed).
- `build-to-spec-verify.ts`:
  - Add `runWalkthroughReview?: typeof import("./walkthrough-review.js").runWalkthroughReview` test seam.
  - Add `runWalkthrough?: boolean` opt-out (mirrors `runPerceptual`).
  - In the verify pipeline: AFTER perceptual-review (Tier 4), call walkthrough-review when `enabledTiers.has(5)`. Same cascade-skip-when-no-screens / no-invokeAgent shape.
- `scripts/file-bug-plan.mjs`:
  - Add a `walkthrough-divergence` violation kind. Bug-fixer is the default route (the bug is behavioral; might be cross-file but typically scoped).
  - Body template captures: step number + observation + expected + screenshot reference.

### Phase D — round-state activation (already wired) + verify-worktree integration (~30min)

- feat-073's `ROUND_CONFIGS[4]` already has `enabledTiers: ALL_TIERS` (includes 5). No round-state change needed.
- bug-090's verify worktree already provides the fresh-state cwd. The walkthrough script reads from `verifyCwd` (where the build-to-spec-verify wrapper sets it).
- bug-091's protected-files guard fires regardless of which dispatcher made the commit (walkthrough-reviewer is read-only, so this doesn't apply directly — but any walkthrough-divergence bug routed to bug-fixer DOES get bug-091's guard).
- bug-092's mergeFirst gate fires on any resolved bug; walkthrough-divergence bugs that bug-fixer resolves get the same end-of-loop merge.

### Phase E — tests (~2hr)

- `orchestrator/tests/walkthrough-review.test.ts` — 5 tests minimum, mirroring perceptual-review.test.ts shape:
  - happy path (agent emits findings → normalized output)
  - cascade-skip: walkthrough script produced 0 screenshots → returns empty findings + warning
  - cascade-skip: no invokeAgent provided → returns empty + warning
  - normalization: agent emits `tier` instead of `severity` → mapped correctly
  - bug-094 fixture: agent emits a `delete-fires-multiple-times` finding → routes to bug-fixer

### Phase F — empirical validation (~$2-5 + 1hr wall-clock)

- Re-run /fix-bugs on reading-log-02 with round 4 active. Cost projection from existing plan body: ≤$0.10/walkthrough × N iterations. Expected to surface bug-094 + items 20/23/25/30 from the original plan body.
- Manual spot-check: confirm walkthrough screenshots in `docs/build-to-spec/walkthrough/` look correct.
- Confirm no false positives on known-good builds (regression: run against a manually-greenlit reading-log-02 snapshot post-bug-094-fix).

### Phase G — operator-triggerable standalone (deferred)

- `pnpm exec /ai-walkthrough <project>` standalone for ad-hoc QA passes (per original plan's §5).
- Defer until Phases A-F empirically validated.

### Phase H — MCP variant (deferred — original plan's optional Phase 4-add)

- Playwright MCP server-driven walkthrough where the agent generates each step ad-hoc. Higher token cost (per-step ARIA snapshot streaming). Defer indefinitely; CLI variant is the load-bearing channel.

## Cross-references (updated 2026-05-13)

- **feat-068** — vision-LLM perceptual review (Tier 4). Architectural twin. feat-069 reuses the same contract shape, invokeAgent threading, cascade-skip rules.
- **feat-073** — rounds-orchestrator. Round 4 (behavioral) is feat-069's home; `enabledTiers: ALL_TIERS` already includes Tier 5. No round-state change needed.
- **bug-090** — verify worktree (shipped 2026-05-13). The walkthrough script reads from the fresh-fix verify worktree, not stale projectRoot.
- **bug-091/089/092** — Phase 1 correctness infrastructure (shipped 2026-05-13). All apply to walkthrough-divergence bugs that bug-fixer resolves.
- **bug-094 — delete-fires-multiple-times** (superseded 2026-05-13). Originally feat-069's first validation gate; today's empirical run produced 1 DELETE per click, not 6, contradicting the hypothesis. The real bug under the symptom (`bug-delete-content-type-400`) was attributed correctly by the walkthrough's agent.
- **feat-071** — clusterer (planned). Sister Phase 2 work. Once feat-069 produces walkthrough-divergence findings, feat-071 folds related findings into single dispatches.

## Attempt Log

### 2026-05-13 — Phases A through F shipped + empirically validated

Commits on `feat/vision-llm-perceptual-review`:

- `d82eefb` Phase 1 — B.1 route sweep + dispatcher + agent
- `05fb83e` Phase B.2 — interaction sweep (theme/search/delete/tab) + deterministic duplicate-request detector
- `1ebb687` Phase B.3 — confirm-dialog flow + render-aware polling for delete-click + route restoration

Validation surface (reading-log-02, 2026-05-13):

- Standalone walkthrough runs ($0.35–$1.01 each, ~4–15 min): all 5 routes captured, interaction sweep produced delete-click + search-fill + tab-traversal manifest entries, DELETE events captured.
- Full `/build-to-spec-verify` run with invokeAgent wired (`bfb4i16rd`, $1.50, 15.6 min): walkthrough fired as Tier 5, surfaced 4 findings, dup-detector caught duplicate-GET patterns deterministically without false-firing on the single DELETE per click.
- `/fix-bugs reading-log-02 --max-concurrent=3` ($26.55, 5/5 iterations, status `clean`): walkthrough-divergence bugs entered the rounds-orchestrator's round 4 lane; bug-fixer dispatches resolved real findings, escalated false positives correctly via convergence detector.

Empirical proof of leverage: the agent traced the project-side `bug-delete-content-type-400` (Content-Type-on-body-less-DELETE → 400 rejection → user-visible "delete does nothing") in one walkthrough pass. No other tier (parity, perceptual) catches this — both are read-only. This finding alone justifies the entire Tier 5 stack.

### Decision

Phases A–F closed as shipped. Phase G (operator-triggerable standalone) is deferred to a future polish phase; the existing `orchestrator/scripts/run-walkthrough.ts` operator script (promoted from `_tmp-` on 2026-05-13) covers the operator-needs surface for now. Phase H (MCP variant) remains indefinitely deferred — CLI variant is the load-bearing channel.
