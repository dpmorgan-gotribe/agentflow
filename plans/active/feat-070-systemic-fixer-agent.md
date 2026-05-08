---
id: feat-070-systemic-fixer-agent
type: feature
status: draft
author-agent: human
created: 2026-05-08
updated: 2026-05-08
parent-plan: feat-066-fix-loop-effectiveness-v2
branch: feat/systemic-fixer-agent
affected-files:
  - .claude/agents/systemic-fixer.md
  - .claude/models.yaml
  - packages/orchestrator-contracts/src/tasks.ts
  - orchestrator/src/feature-graph.ts
  - orchestrator/src/model-config.ts
feature-area: orchestrator/agent-routing
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-070: Phase 5 — systemic-fixer agent variant

## Problem Statement

feat-066 Phase 5. The bug-fixer agent (feat-064) is intentionally narrow-scoped: maxTurns:8, "smallest possible diff", "don't refactor". That's load-bearing for per-bug wall-clock (5-6 min target), but it's the WRONG dispatch for systemic bugs:

- bug-077 (Tailwind pipeline broken) was empirically a 1-line fix in TWO places (apps/web/postcss.config.mjs + ui-kit/styles/globals.css) but the bug-fixer's per-bug isolation made it impossible to recognize as one root cause across 30 surface symptoms
- Phase 1 will emit `systemic-divergence` bugs (when audit-computed-styles finds >15 drifts on a tuple)
- Phase 2 will emit `pixel-systemic-divergence` (whole-screen-broken)
- Phase 0.5 deterministic discriminators will emit `tooling-css-pipeline-broken`, `tooling-config-mismatch`, `tooling-test-seed-contract-broken`

All of these need a systemic-thinking dispatch — explicitly authorized to look across files, suspect the build pipeline / scaffold / kit-CSS layer, NOT just patch individual symptoms.

## Approach

1. **NEW `.claude/agents/systemic-fixer.md`** — system prompt:
   - tools: Read, Write, Edit, Bash, Grep, Glob (same as bug-fixer)
   - mcp_servers: [] (keep cold-start tax low)
   - maxTurns: 12 (vs bug-fixer's 8 — needs more exploration)
   - effort: medium
   - System prompt: "You diagnose and fix SYSTEMIC defects — bugs whose symptoms are scattered across many files but whose root cause is in a single config / scaffold / library. Look ACROSS files. Suspect the build pipeline, the scaffold, or shared infrastructure FIRST before touching individual surface symptoms. Do NOT patch one symptom at a time — find the source. If you can't find a single root cause within maxTurns budget, document what you ruled out + flag for human review."

2. **Add to `AgentSequenceMember` enum** in `packages/orchestrator-contracts/src/tasks.ts`. Same shape as bug-fixer addition.

3. **Wire dispatch routing** in `scripts/file-bug-plan.mjs`:
   - `systemic-divergence`, `pixel-systemic-divergence`, `tooling-css-pipeline-broken`, `tooling-config-mismatch`, `tooling-test-seed-contract-broken`, `clustered-systemic-divergence` (from Phase 6) → `["systemic-fixer"]`

4. **Add to `.claude/models.yaml` + `FACTORY_DEFAULT_AGENT_TIERS`** in `model-config.ts`:
   - `systemic-fixer: { tier: building, effort: medium }` (one tier above bug-fixer's effort:medium for cross-file work)
   - `DEFAULT_STALL_TIMEOUT_BY_AGENT["systemic-fixer"] = 18 * 60 * 1000` (18 min — pairs with maxTurns:12)

5. **Pre-loaded context envelope** for systemic-fixer in `orchestrator/src/bug-fix-context.ts`:
   - For `systemic-divergence` / `clustered-systemic-divergence`: include all N drift entries as a single block; include the project's `tailwind.config.ts`, `next.config.ts`, `postcss.config.{mjs,js}` (or "FILE MISSING" markers), and the kit's `globals.css` so the agent sees the full pipeline state at-a-glance
   - For `tooling-*`: include the relevant config files + a one-paragraph diagnostic summary from the discriminator that fired

## Rejected Alternatives

- **Don't add a separate agent — let bug-fixer handle systemic bugs with longer maxTurns.** Rejected because the bug-fixer's "smallest diff" + "don't refactor" frontmatter actively blocks systemic-thinking; flipping that for some dispatches but not others would require per-dispatch system-prompt mutation (more orchestrator complexity than a separate agent).
- **Use Opus for systemic-fixer instead of Sonnet.** Rejected — investigate-024 evidence + bug-fixer empirical wins say Sonnet is sufficient for these tasks; Opus would 5× the cost without measurable quality lift.
- **Drop maxTurns to 8 (match bug-fixer) for cost parity.** Rejected — empirically bug-077-class bugs need cross-file exploration; an 8-turn cap would force the agent into the same shell-game pattern bug-fixer fell into.

## Expected Outcomes

- [ ] `.claude/agents/systemic-fixer.md` ships
- [ ] AgentSequenceMember + TaskAgent enums extended
- [ ] Dispatch routing emits `["systemic-fixer"]` for the 6 systemic bug classes
- [ ] models.yaml entry + FACTORY_DEFAULT_AGENT_TIERS fallback
- [ ] DEFAULT_STALL_TIMEOUT 18-min cap for systemic-fixer
- [ ] Pre-loaded context envelope per-class file resolution
- [ ] On a deliberately-broken Tailwind project: systemic-fixer resolves bug-077 in ONE dispatch (~10 min) instead of 30 surface dispatches (~3 hr)
- [ ] Median wall-clock for systemic dispatches: 8-12 min

## Validation Criteria

1. systemic-fixer dispatched on `tooling-css-pipeline-broken` (deliberately-broken project) → fixes BOTH postcss.config + @tailwind directives in one dispatch
2. systemic-fixer dispatched on `systemic-divergence` (>15 drifts on one tuple) → identifies root cause vs surface-patching
3. Per-dispatch wall-clock measured: 90%-percentile ≤ 12 min
4. Pre-loaded envelope for systemic-fixer includes the right config files (verified via dispatch log inspection)
5. No regression on bug-fixer dispatches (existing per-bug 5-6 min target preserved)

## Attempt Log

<!-- Populated by executing agents. -->
