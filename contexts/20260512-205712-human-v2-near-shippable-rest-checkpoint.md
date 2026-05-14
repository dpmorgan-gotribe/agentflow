---
session-id: "20260512-205712"
timestamp: 2026-05-12T20:57:12Z
agent: human
task-id: feat-066-fix-loop-effectiveness-v2
previous-context: 20260512-042354-human-v2-trio-shipped-and-empirically-validated.md
checkpoint: true
status: in-progress
---

# Context snapshot — human — v2 epic near-complete; 3 architectural bugs + AI walkthrough remain

## Summary

20-hour session shipped the feat-068 (Tier 4 vision-LLM perceptual review) + feat-073 (loop-of-loops rounds orchestration) + bug-087/bug-088 (perceptual category-aware routing with project-agnostic heuristic) stack on top of the prior bug-082/083/084/085/086 trio. Empirically validated against reading-log-02 over multiple /fix-bugs runs hitting 97.7% perceptual resolution metric.

**Critical late-session discovery:** the orchestrator's "completed" metrics were partly illusory. Three architectural bugs surfaced when the operator booted the dev server and saw the OLD pre-v2 state despite the metrics claiming 95%+ fixes:

1. **bug-089** — fix-bugs-loop auto-merge to master silently fails on dirty tree (filed)
2. **bug-090** — verifier mid-loop boots dev-server from projectRoot/master (stale, no in-iter fixes); vision-LLM PNGs + parity DOM-diff + flow execution all see stale code (filed)
3. **bug-091** — agents can delete load-bearing config files (postcss.config.mjs deleted by fix-loop, bug-077 regression); detection layers are blind to "page is unstyled" (not yet filed)

After manual `git merge --no-ff fix/bugs-yaml-iter` + restoring postcss.config.mjs + adding @tailwind directives + clearing .next cache → site finally rendered with all v2 fixes visible. The empirical metrics were partly correct (fixes WERE made) but the verifier feedback loop was broken (verifier always saw stale state).

The session also crystallized a longer roadmap: feat-069 (AI walkthrough Tier 5) + feat-071 (clusterer) remain to complete the v2 detection stack.

## Completed since last snapshot

- **feat-068 Phase A shipped** (`04b722b`): Tier 4 vision-LLM perceptual review. New `perceptual-reviewer` agent, `runPerceptualReview` dispatcher, BugSource extended with `perceptual-divergence`, cascade-skip rules baked in (parity-systemic / parity-shell-stripping / dev-server-not-responding / no-png), build-to-spec-verify wired post-parity, parity-verify modified to ALWAYS persist mockup.png + built.png per screen.
- **feat-068 followups**: invokeAgent threading into BuildToSpecVerifyContext (`e4afb78`), `perceptual-reviewer` registered in FACTORY_DEFAULT_AGENT_TIERS with tier:building (`549c832`), models.yaml pin (`780dafd`).
- **feat-068 schema evolution** (`5dd011a`): adopted the richer agent shape — PerceptualFinding gains `id`, `category`, `description`, optional `mockupValue`/`actualValue`. PerceptualScreenReview gains `verdict`, `summary`, `alreadyFiled`. Normalization layer maps agent aliases (`tier`→`severity`, `title`→`element`, `critical`/`major`/`minor`→P0/P1/P2). Schema mistakes from initial design were corrected here after empirical Phase D produced rich JSON files but bug-filing was 0.
- **feat-073 Phase A+B** (`7a4db9d` + `b75b9e0` + `80508ea`): loop-of-loops rounds orchestration. New `RoundConfig` contract + ROUND_CONFIGS table + `deriveRoundState` pure function. `runRoundsOrchestrator` wrapper around `runFixBugsLoop` with bidirectional promotion + demotion-on-regression. `enabledTiers` gating on `BuildToSpecVerifyContext` suppresses Tier 4 when round < 3. feature-graph defaults to rounds-orchestration in production; tests opt out via `useRoundsOrchestration: false`.
- **bug-087** (`d179bd2`): perceptual-divergence category-aware routing in `defaultAgentSequence`. functional/runtime/state-routing → operator-review; missing-element/missing-component/layout/structural → systemic-fixer; everything else → bug-fixer (default).
- **bug-088 attempt 1 → architectural correction → attempt 2** (`fba74f4`): initial hardcoded element-name list (book-list-item, search, nav, etc.) reverted as project-specific anti-pattern; replaced with regex heuristic `/^[a-z]+(-[a-z]+)*$/` that generalizes across projects (catches reading-log-02's book-list-item AND hypothetical kanban's task-card AND finance's invoice-row). Operator caught the architectural flaw post-implementation; correction landed in same session.
- **Empirical Phase D runs** on reading-log-02: multiple /fix-bugs iterations producing 38 perceptual completions, 5 operator-review routes, 4 bug-fixer failures (vs 0 pre-v2). Cost: ~$15-25 across the session.
- **Three new bugs filed** (P0): bug-089 (auto-merge silent fail), bug-090 (verify-freshness via dedicated worktree). bug-091 (protected-files guard) NOT yet filed but specified in this snapshot's roadmap.
- **Manual recovery for site review**: stashed dirty tree → merged `fix/bugs-yaml-iter` into master (~40 commits / 938 insertions) → recreated `apps/web/postcss.config.mjs` + added `@tailwind base/components/utilities` directives to `packages/ui-kit/src/styles/globals.css` → cleared `.next` cache → restarted backend + Next.js → site finally rendered with the v2 fixes visible.

## Current state

- **Branch:** `feat/vision-llm-perceptual-review` — 15 commits ahead of factory master; not yet pushed to origin
- **HEAD:** `fba74f4` (bug-088 architectural correction)
- **Project (`projects/reading-log-02`):** master at `f1c2930` (post-manual-merge of fix/bugs-yaml-iter with 938 insertions). bugs.yaml: 54 completed | 4 failed | 0 in-progress | 8 needs-operator-review | 0 pending. Note: the orchestrator-side bugs.yaml looks great BUT the verifier's metrics need re-validation post-bug-090 because mid-loop verifies were rendering stale code.
- **Tests:** 231/231 across rounds-orchestrator + round-state + perceptual-review + fix-bugs-loop + bug-fix-context + file-bug-plan-parity + feature-graph. Pre-existing test-rot bundle (~30 failures in build-to-spec-verify.test.ts / cli-runner.test.ts / run-synthesized-flows.test.ts) unchanged.
- **Operator-side site:** running at http://localhost:3000 (Next.js) + http://localhost:3001 (Fastify). Backend + DB seeded with baseline books data. Site renders with full Tailwind styling + v2 perceptual fixes (brand logo, book-list-item structure, sort controls, filter-tab count badges, theme toggle icons, etc.). Operator confirmed: "very close now to the first shipped project e2e".
- **Blockers (none for next session — three filed bugs to ship):**
  - bug-089 ready to ship (~1hr)
  - bug-090 ready to ship (~1day, biggest lift)
  - bug-091 to file + ship (~30min file + 1hr ship)

## Next steps

The full completion roadmap was articulated in the chat — captured here for next session:

### Phase 1 — Correctness infrastructure (must precede honest metrics)

1. **bug-091 (TO FILE + SHIP)** — protected-files guard. Need a manifest of files that bug-fixer/systemic-fixer dispatches MUST NOT delete (postcss.config.mjs, tailwind.config.ts, scripts/dev.mjs, @tailwind directives in globals.css, etc.). System-prompt callout + post-dispatch verify-pass invariant check.
2. **bug-089 (FILED, READY)** — auto-merge robustness. Fail loudly when merge fails on non-whitelisted blockers; auto-recover when blockers match whitelist (synth specs, .claude/models.yaml, prisma db files).
3. **bug-090 (FILED, READY)** — dedicated `.claude/worktrees/verify/` on `fix/bugs-yaml-iter`; bootDevServer + Playwright + parity + perceptual-review all read from THERE, not projectRoot. Decouples verify-freshness from master-merge state. Biggest single lift in the roadmap.
4. **Empirical re-run #1** — re-run /fix-bugs reading-log-02 with bug-089 + bug-090 + bug-091 active. Validates Phase 1.

### Phase 2 — Complete the v2 detection stack

5. **feat-069 (AI walkthrough Tier 5)** — behavioral detection layer. Playwright-driven multi-step user journey → vision-LLM review. Round 4 of the loop-of-loops. Round-gating baked in from day 1 (already specified in feat-073). Catches behavior bugs (broken buttons, theme toggles, kbd nav skips) that vision-LLM static review can't.
6. **feat-071 (clusterer)** — fold same-screen / same-root-cause perceptual findings into one cluster dispatch. Massively reduces wall-clock + API spend post-feat-068.

### Phase 3 — Empirical re-validation + ship

7. **Empirical re-run #2** — full stack validated.
8. **Branch hygiene** — merge `feat/vision-llm-perceptual-review` → factory master, push to origin, delete branch.
9. **Update feat-066 v2 epic plan** with final attempt log.

### Phase 4 — Optional polish

10. **feat-072** (class-batched-dispatch-reenable) — throughput optimization for pixel-minor-divergence; low priority.

## Open questions

- **bug-090's fallback when `fix/bugs-yaml-iter` doesn't exist** (first /fix-bugs run on a fresh project): use projectRoot/master? Or skip verify with a warning? Recommend: fall back to projectRoot/master + log so operator notices.
- **bug-091's protected-files list shape** — hardcoded TS set vs. JSON manifest vs. consulting the stack-skill canonical-paths registry? Probably hardcoded for v1; extract to manifest later if it grows.
- **Empirical metrics across the session were partly illusory** (bug-089 + bug-090). Should the feat-066 v2 attempt log carry a disclaimer about this? Yes — be honest. The numbers post-bug-089+bug-090 will be the load-bearing ones.
- **bug-077 regression cleanup on OTHER shipped projects** — reading-log-02 had the regression; kanban-09 / repo-health-dashboard-01 / finance-track-01 may too. Audit-and-backfill is a separate session, deferred to docs/ideas.md (or a fresh investigation).
- **Cost cap discussion** — per-empirical-re-run cost is $3-10; we've spent ~$30-50 on reading-log-02 across this epic. Future projects will need similar cycles. Worth thinking about a "cheap dry-run" mode that skips Tier 4/5 dispatches and just reports routing decisions.

## Key files touched

### Code surfaces (factory side)

- `orchestrator/src/perceptual-review.ts` — Tier 4 dispatcher + normalization layer (feat-068 + schema evolution)
- `orchestrator/src/round-state.ts` — `deriveRoundState`, `bugsInRound` (feat-073 Phase A)
- `orchestrator/src/rounds-orchestrator.ts` — outer-loop wrapper (feat-073 Phase B)
- `orchestrator/src/build-to-spec-verify.ts` — perceptual-review wiring + enabledTiers gating
- `orchestrator/src/parity-verify.ts` — always-persist mockup.png + built.png per screen (feat-068 companion)
- `orchestrator/src/fix-bugs-loop.ts` — roundConfig filter in pendingThisIter; invokeAgent + enabledTiers threading
- `orchestrator/src/feature-graph.ts` — useRoundsOrchestration default-on in production
- `orchestrator/src/model-config.ts` — perceptual-reviewer in FACTORY_DEFAULT_AGENT_TIERS + DEFAULT_STALL_TIMEOUT_BY_AGENT
- `scripts/file-bug-plan.mjs` — perceptual-finding violation kind + category-aware routing (bug-087/bug-088)
- `packages/orchestrator-contracts/src/perceptual-review.ts` — PerceptualFinding/PerceptualScreenReview schemas
- `packages/orchestrator-contracts/src/round-state.ts` — RoundConfig contract
- `packages/orchestrator-contracts/src/bugs-yaml.ts` — BugSource:perceptual-divergence + BugPerceptualContext
- `packages/orchestrator-contracts/src/tasks.ts` — perceptual-reviewer in AgentSequenceMember + TaskAgent
- `.claude/agents/perceptual-reviewer.md` — new agent system prompt
- `.claude/models.yaml` — perceptual-reviewer tier:building pin

### Test surfaces

- `orchestrator/tests/perceptual-review.test.ts` — 7 tests (happy path + 5 cascade-skip + agent-no-output)
- `orchestrator/tests/round-state.test.ts` — 17 tests
- `orchestrator/tests/rounds-orchestrator.test.ts` — 7 tests
- `orchestrator/tests/file-bug-plan-parity.test.ts` — bug-087/bug-088 routing tests
- `orchestrator/tests/feature-graph.test.ts` — useRoundsOrchestration test seam

### Plan surfaces

- `plans/active/bug-082-…md` through `plans/active/bug-088-…md` — all of this session's filed bugs
- `plans/active/feat-068-vision-llm-perceptual-review.md` — feat-068 plan with Phase A landed
- `plans/active/feat-073-rounds-orchestration.md` — feat-073 plan with Phase A+B landed
- `plans/active/bug-089-fix-loop-auto-merge-silent-fail.md` — NEW, drafted this session
- `plans/active/bug-090-verify-freshness-dedicated-worktree.md` — NEW, drafted this session

### Project-side recovery (reading-log-02)

- `projects/reading-log-02/apps/web/postcss.config.mjs` — RESTORED (was deleted by fix-loop run)
- `projects/reading-log-02/packages/ui-kit/src/styles/globals.css` — @tailwind directives ADDED at top
- `projects/reading-log-02/.next/` — cleared cache
- `projects/reading-log-02/apps/api/prisma/data/reading-log.db` — re-seeded baseline data

## Decisions made

- **bug-088's first attempt (hardcoded element-name list) was the wrong architecture.** Operator caught it during code review. Project-agnostic regex heuristic is the right design — kebab-case categories that aren't in any explicit abstract set are treated as element-names → systemic-fixer. The lesson: routing tables that contain project-specific vocabulary won't scale; always reach for project-agnostic discriminators.
- **The empirical metrics across this session were partly illusory.** "97.7% perceptual resolution" was based on bug-fix dispatch tracking, not verifier-confirmed state. The verifier was reading stale master (bug-090) while fixes accumulated on fix/bugs-yaml-iter unmerged (bug-089). The numbers post-bug-089+bug-090 will be the honest ones. Be transparent about this when updating the feat-066 v2 epic plan.
- **feat-073's rounds-orchestrator is the right architecture** but its empirical validation needs to wait for bug-090. Without bug-090, the verify-pass at round-boundary gives wrong round-state signals (round derives from stale bugs.yaml that doesn't reflect current state).
- **feat-069 (AI walkthrough) must be designed with feat-073's round-gating from day 1** — not retrofitted. Round 4 = behavioral / Tier 5; the dispatcher checks `enabledTiers.has(5)` first. This was specified in the feat-073 plan but feat-069 hasn't shipped yet.
- **Manual project recovery was necessary mid-session** to validate the empirical claims. The operator's observation "I'm seeing just as many bugs" was the load-bearing signal — without that human-in-the-loop check, the entire v2 epic's metrics would have looked legitimate while shipping broken builds.
- **Operator burn-out / 20-hour shift** is real. The completion roadmap above is paced for healthy multi-session execution, not heroics. Phase 1 (bug-089/090/091) is the next focused 1-2 day block; Phase 2 (feat-069/071) is a separate multi-day effort.
