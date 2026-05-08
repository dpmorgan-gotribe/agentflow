---
session-id: "20260508-225240"
timestamp: "2026-05-08T22:52:40Z"
agent: human
task-id: feat-066-fix-loop-effectiveness-v2
previous-context: 20260508-071801-human-investigate-024-shipped-validation-v5.md
checkpoint: true
status: final
---

# Context snapshot — human — investigate-025 shipped + v2 epic filed

## Summary

Two major milestones shipped this session: (1) **bug-077 (factory-wide Tailwind CSS pipeline scaffold gap)** — empirically discovered via reading-log-02 manual visual inspection post-/fix-bugs validation v5; Phase A+B+C closed, Phase D deferred. (2) **investigate-025 (meta-investigation: is the bug-fix loop structurally able to catch the bugs that matter)** — completed in ~30min of 180min budget; falsified own optimistic Phase 1 projection (70% → empirically ~17%); produced 7-phase Hybrid v2 architecture recommendation with wall-clock preservation contract. Filed feat-066 epic + 7 phase tickets + 3 emergency factory bugs. User paused here; next session picks up with v2 phase work.

## Completed since last snapshot

**bug-077 work (P0 factory bug — Tailwind pipeline missing):**

- Empirical surfacing: reading-log-02 dev server spun post-validation-v5; pages rendered unstyled. 970MB hung Next process on first attempt; restart cleanly worked once `@tailwind` directives + postcss.config.mjs added. Verified via `find . -name "postcss.config*" + grep "@tailwind"` — both load-bearing pieces missing from factory scaffold + every shipped web project.
- Investigation: factory's stylesheet/SKILL.md line 238 admits "globals.css alone provides only token CSS variables + a base reset, not compiled Tailwind utilities. Production builders consume the kit at JSX-time and run a real Tailwind build" — but react-next/SKILL.md never tells production builders HOW to do that. Latent gap from scaffold inception.
- Filing: bug-077-react-next-tailwind-pipeline.md (P0, 4-phase plan)
- Phase A shipped: react-next/SKILL.md gains postcss.config.mjs in scaffold tree + sample content + §1b Tailwind pipeline section + scaffold-owned files entry + Tailwind 3 vs 4 dep mismatch cleanup
- Phase B shipped: stylesheet/SKILL.md gains @tailwind directives in globals.css required header + preview-bootstrap docstring updated to clarify production-consumer path
- Phase C shipped: reading-log-pre-bugs project backfilled (postcss.config.mjs + @tailwind directives); reading-log-01 already has both; reading-log-02 patched in working tree (unfinished commit since user mid-inspection of v5 merge)
- Phase D deferred to investigate-025 v2 architecture

**investigate-025 work (P0 meta-investigation):**

- Filed initially as 7-step 180-min time-boxed investigation
- Step 1 (empirical census) — collaborative walkthrough of reading-log-02 with user. 30 distinct user-visible bugs catalogued. Falsification result: ~1/30 caught by current verifier (~3%). Falsifies my optimistic projection that Phase 1 alone would close 70%. Strongly justifies all 5 v2 phases.
- Step 2 (audit-computed-styles audit) — found that surface IS wired correctly + DOES fire each fix-loop iteration. But 3 silent config defaults suppress 75% of signal: PATTERN_ALLOWLIST drops 3 of 4 patterns; MAX_DRIFTS_PER_BUCKET=5 caps detection; bug-fixer per-bug isolation prevents systemic-pattern recognition.
- Step 3 (Playwright MCP feasibility) — knowledge-based; recommend Playwright CLI over MCP per user-research signal CLI is ~4× cheaper for terminal agents.
- Step 5 (synthesizer audit) — flow-1 spec read; 7 interaction steps, role-based selectors, no `getComputedStyle()` checks, no screenshot comparisons. Confirms H2 (synthesized E2E executes selectors not walkthroughs).
- Steps 4 (pixelmatch demo) and parts of Step 1 deferred to phase implementation.
- Recommendation written: **Hybrid v2 with 7 phases** (was 5 originally; added Phase 0.5 deterministic discriminators + Phase 6 cluster-bugs + Phase 7 class-batched re-enable). Wall-clock preservation contract: per-bug 5-6 min preserved for ~90% of bugs (bug-fixer dispatches unchanged); systemic-fixer intentionally slower (8-10 min) for ~10%; total fix-loop ≤1.7× current run-time at ~25× catch rate.
- Plan archived (status: completed). No follow-up investigations needed.

**v2 epic filing (10 plans):**

- feat-066-fix-loop-effectiveness-v2.md (umbrella P0)
- bug-078-audit-computed-styles-config-and-discriminators.md (Phase 1, P0, 6hr, ~17% leverage)
- feat-067-pixel-diff-smoke-layer.md (Phase 2, P0, 6hr, +50% leverage)
- feat-068-vision-llm-perceptual-review.md (Phase 3, P1, 10hr, +15%)
- feat-069-ai-walkthrough.md (Phase 4, P1, 12hr, +15%)
- feat-070-systemic-fixer-agent.md (Phase 5, P0, 3hr, enables 1+2)
- feat-071-cluster-bugs-pre-dispatch.md (Phase 6, P1, 3hr, wall-clock mitigation)
- feat-072-class-batched-dispatch-reenable.md (Phase 7, P2, 1hr, wall-clock mitigation)

**Emergency factory bugs (orthogonal to v2):**

- bug-079-runtime-errors-not-elevated-for-passing-tests.md (P0) — smoking gun at scripts/run-synthesized-flows.mjs:652; only fires extractRuntimeErrors() on test-FAILED path; passing tests with hydration errors silently shelved
- bug-080-test-seed-routes-not-in-shipped-projects.md (P0) — /test/cleanup returns 404 on reading-log-02; per .claude/rules/testing-policy.md these are mandatory; hypothesis matrix in plan
- bug-081-output-export-breaks-dynamic-routes.md (P0) — output:export in next.config.ts breaks /books/[id] server-side; misclassification of full-stack project as static-SPA; hypothesis matrix in plan

## Current state

- Branch: feat/quota-observability (290c631)
- Tests: assumed all passing — no test changes this session beyond plan files
- Uncommitted files: 6 plan-doc edits from earlier sessions (pre-this-session, untouched), tmp scripts ignored. NO factory code changes uncommitted.
- reading-log-02: working tree has packages/ui-kit/src/styles/globals.css with @tailwind directives uncommitted (mixed with the v5 merge artifacts from earlier this session). Decision: leave for user to commit when wrapping up v5 inspection.
- Blockers: none. Investigation completed cleanly; v2 plans ready for prioritization.

## Next steps

1. **Recommended ship order for ~70% catch rate at minimum cost:**
   - bug-078 (Phase 1 audit config + deterministic discriminators) + feat-070 (Phase 5 systemic-fixer) as a leverage pair = 9hr engineering. Closes the cheap-detection gap + enables systemic-divergence routing.
   - feat-067 (Phase 2 pixel-diff) = +6hr → ~67% cumulative catch (the load-bearing perceptual layer per empirical census).
2. **Orthogonal factory bugs to ship in parallel** (small effort each):
   - bug-079 (runtime-errors not elevated for passing tests) — likely 1-line fix in scripts/run-synthesized-flows.mjs + tests. Closes the hydration-error invisibility class.
   - bug-080 (test-seed routes) — investigation first, then backfill. Likely Hypothesis C (env var not set) or D (combination).
   - bug-081 (output:export) — investigation first; check react-next stack skill scaffold default + architect skill heuristics.
3. **Polish phases** (defer until 1+2 land):
   - feat-068 (vision-LLM perceptual review)
   - feat-069 (AI walkthrough)
   - feat-071 (cluster-bugs-pre-dispatch)
   - feat-072 (class-batched re-enable)
4. **Re-validation**: after Phase 1+2+5 land, re-run /fix-bugs against a fresh project (one of the gotribe pre-builds) + manual census; target ≥70% catch rate. If hit, ship Phase 3-7 in priority order. If miss, file follow-up investigation.
5. **Post-v2 archives**: feat-066 archives only after empirical re-validation confirms catch-rate target met.

## Open questions

- Q1 (deferred from investigate-025): Is `AUDIT_COMPUTED_ALL_PATTERNS=1` (Phase 1's default-on flip) actually safe? Empirical test on reading-log-02 might overwhelm the loop with token-polish bugs. Mitigation: ship Phase 1 + Phase 5 (systemic-fixer) + Phase 6 (cluster-bugs) together so polish bugs cluster into 1 dispatch rather than flood individually.
- Q2 (deferred): What's the actual % of bug-077-class issues Phase 1 (reconfigured audit-computed-styles) catches that Phase 2 (pixel-diff) ALSO catches? If overlap >80%, Phase 2 might be deprioritized. (Empirically expect overlap to be ~30% — they catch different things; pixel-diff catches missing-element class that audit-computed-styles can't see.)
- Q3 (deferred): How does the systemic-fixer agent interact with merge-cascade conflicts when 50 individual bugs are clustered into one? Phase 5+6 plans don't fully spec this; will surface during Phase 5 implementation.

## Key files touched

**Factory commits this session (3 commits):**

- `503f14b` bug-077 Phase A+B+C shipped:
  - `.claude/skills/agents/front-end/react-next/SKILL.md` — postcss.config.mjs in scaffold tree + §1b Tailwind pipeline + scaffold-owned files + Tailwind 3 dep cleanup
  - `.claude/skills/stylesheet/SKILL.md` — @tailwind directives in globals.css required header + preview-bootstrap docstring update
  - 2 new plan files: bug-077, investigate-025 (initial)
  - `plans/active.md` — bug-077 + investigate-025 manifest entries

- `290c631` investigate-025 archive + v2 epic + emergency bugs:
  - `plans/active/investigate-025-fix-loop-effectiveness-v2.md` — status flip to completed; Findings + Recommendation populated (~280 lines added)
  - 10 new plan files: feat-066 (umbrella) + bug-078 + feat-067/068/069/070/071/072 + bug-079/080/081
  - `plans/active.md` — 11 manifest rows added; investigate-025 row updated to completed

**Project commits this session (1 commit):**

- `f9a1f8c` (reading-log-pre-bugs) bug-077 Phase C backfill:
  - `apps/web/postcss.config.mjs` (NEW)
  - `packages/ui-kit/src/styles/globals.css` (@tailwind directives prepended)

**reading-log-02 — uncommitted (mixed with v5 merge):**

- `packages/ui-kit/src/styles/globals.css` — @tailwind directives applied (lines 7-9); user holds the commit

## Decisions made

- **bug-077 Option A (kit-side @tailwind directives) over Option B (apps-side globals.css with @tailwind).** Reason: simpler single source of truth; matches existing ui-kit centralized stylesheet pattern; what was already applied to reading-log-02 manually. Tradeoff: ui-kit slightly less framework-agnostic, but only React/Next consumes it as React anyway.
- **Phase D of bug-077 deferred to investigate-025.** Reason: tactical first-pixel detection + systemic-fixer for bug-077 class are both better designed AFTER understanding the full v2 architecture. Avoid locking in wrong design.
- **investigate-025 closed early (~30min of 180min budget).** Reason: hit recommendation after Steps 2/3/5 + collaborative Step 1; no benefit from more time-on-task. Followups are concrete plan IDs not more research.
- **Empirical census FALSIFIES my own optimistic Phase 1 projection (70% → ~17%).** Reason: baked into the Findings section and updated phase-leverage table. Phase 2 (pixel-diff) becomes load-bearing; Phase 1 alone insufficient.
- **7-phase v2 over 5-phase v2.** Reason: wall-clock preservation contract requires Phase 6 (cluster-bugs) + Phase 7 (class-batched re-enable) to keep total fix-loop ≤1.7× current run-time at ~25× catch rate. Without those, total wall-clock would balloon ~3×.
- **Playwright CLI variant over MCP for AI walkthrough.** Reason: per user-research signal CLI is ~4× cheaper than MCP (no per-step ARIA snapshot streaming). MCP variant deferred to optional follow-up for operator-triggered "let AI poke around" mode.
- **systemic-fixer as separate agent vs bug-fixer with extended maxTurns.** Reason: bug-fixer's "smallest diff" + "don't refactor" frontmatter actively blocks systemic-thinking; flipping that per-dispatch would require system-prompt mutation logic. Cleaner to have two agents with distinct contracts.
- **Project-side fixes deferred per user direction ("we don't want to fix anything in the project as we will want to work on factory until we can fix all these bugs").** Reason: factory backports cascade to all projects on next /new-project --force; project-side fixes drift from factory canonical. bug-079/080/081 all factory-side root causes.
