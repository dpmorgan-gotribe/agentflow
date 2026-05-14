---
session-id: "20260514-025423"
timestamp: 2026-05-14T02:54:23Z
agent: human
task-id: null
previous-context: 20260513-074505-human-phase-1-shipped-and-empirically-validated.md
checkpoint: true
status: checkpoint
---

# Context snapshot — human — v2-Phase-2/3/4 complete; gotribe-ready

## Summary

Three sessions converged onto a single shipping push: v2-Phase-2 (feat-068 vision-LLM perceptual + feat-069 AI walkthrough Phases A-F) merged from `feat/vision-llm-perceptual-review` to master via `4f7213f`. v2-Phase-3 closed the orchestrator correctness gaps (bug-097 env auto-fix, bug-095 in-loop DB pollution, bug-096 apiBase regression, bug-093 source-change-gaming, feat-071 cluster-bugs Phase A+B, failureClass field, bug-104 spawn env-spread). v2-Phase-4 cleaned the empirical follow-ups from the user's manual session (bug-099 perceptual fullPage + prompt, bug-100 PM mockup-coverage audit, bug-101 walkthrough new helpers MVP, bug-103 walkthrough Pass B manifest flow walker, bug-098 closed-by-diagnostic, bug-102 closed-as-subsumed-by-bug-101, bug-105 stack-skill AppShell layout invariants, investigate-027 dual-path recommendation completed). All P0+P1 closed across every phase. Factory is in a clean shippable state for the gotribe per-feature isolation projects per memory's `project_post_reading_log_02_plan.md` directive.

## Completed since last snapshot

- Merged feat-069 Phase B.3 + closure commits to master (`4f7213f`)
- Shipped v2-Phase-3: bug-097, bug-095, bug-096, bug-093, failureClass field, feat-071 Phase A+B (clusterBugs() + loop wiring + propagation + fallback), bug-104 env-spread + diagnostic
- Shipped v2-Phase-4: bug-099 (parity-verify fullPage + agent prompt), bug-100 (audit-pm-mockup-coverage.mjs + PM self-verify step 8), bug-101 MVP (anchor-click + form-submit + filter-combine helpers), bug-103 (walkthrough Pass B — user-flows-manifest flow walker)
- Closed-by-diagnostic: bug-098 (token-drift hypothesis falsified; reframed to design-pipeline issue), bug-102 (POST 422 family subsumed by bug-101's runFormSubmitAndCreate response capture)
- Filed + closed investigate-027 (60-min time-box): dual-path recommendation A (structural data-token annotations, deferred) + E (preventive stack-skill layout invariants, shipped as bug-105)
- Shipped bug-105: §2c AppShell layout invariants in react-next + svelte-kit SKILL.md (5 invariant groups + self-verify checklist)
- Test suite: 942 → 995 (+53 net new tests across the session)
- 38 commits pushed to origin/master (dc4521a → 0ac3e44)

## Current state

- Branch: master (0ac3e44)
- Tests: 995/995 orchestrator passing
- Uncommitted files: 416 (all pre-existing prior-session prep work; NONE from today's session — verified by git status against today's commits)
- Blockers: none

## Next steps

1. **gotribe per-feature isolation projects** — per memory's post-reading-log-02 plan, the canonical empirical environment for stress-testing the factory at narrow scope before applying to the full gotribe suite. First gotribe feature project to be selected by the operator.
2. Optional polish (low priority, can defer indefinitely): Path A of investigate-027 (data-token-\* annotations on screen templates + new audit-design-tokens-vs-screens verifier step). Best landed AFTER gotribe empirical evidence shows Path E's preventive content isn't sufficient.
3. Optional polish: feat-069 Phase G + Phase 2 of bug-101 (theme-visual-diff + create-then-verify helpers). Deferred to dedicated session if walkthrough findings on gotribe surface gaps.

## Open questions

- Will Path E (stack-skill AppShell layout invariants) be sufficient on the first gotribe project, or will Path A (structural data-token annotations) be required? Empirical evidence on first gotribe project will tell.
- Does feat-071 cluster-bugs Phase B actually fire usefully when `FIX_BUGS_CLUSTER_THRESHOLD=N` is set on a real /fix-bugs run with ≥N same-tuple parity bugs? Deferred validation; the unit tests are green but no live cluster has ever synthesized + resolved end-to-end on a real project.

## Key files touched

### Orchestrator src (production code)

- `orchestrator/src/build-to-spec-verify.ts` — bug-095 seed-baseline restore between Tier 3 + Tier 4/5 with bug-104 pre-flight health diagnostic
- `orchestrator/src/dev-server.ts` — bug-104 env-spread order fix (extracted as `buildBackendSpawnEnv` pure helper)
- `orchestrator/src/fix-bugs-loop.ts` — bug-093 diffOverlapsBugScope + failureClass + feat-071 applyClusterPass + propagateClusterResolutions
- `orchestrator/src/cluster-bugs.ts` (NEW) — feat-071 Phase A pure clusterBugs() function
- `orchestrator/src/pre-verify-discriminators.ts` — bug-097 auto-fix for ENABLE_TEST_SEED=0
- `orchestrator/src/parity-verify.ts` — bug-099 fullPage:true on both mockup + built PNGs

### Schemas + contracts

- `packages/orchestrator-contracts/src/bugs-yaml.ts` — failureClass enum + clusterParent + clusterMembers fields

### Scripts (factory-side)

- `scripts/ai-walkthrough.mjs` — bug-103 Pass B + bug-101 3 new helpers (anchor-click + form-submit + filter-combine)
- `scripts/synthesize-flow-e2e.mjs` — bug-096 apiBase resolution hardening
- `scripts/audit-pm-mockup-coverage.mjs` (NEW) — bug-100 PM mockup-element coverage audit

### Agent prompts + stack skills

- `.claude/agents/architect.md` — bug-097 self-verify step 14
- `.claude/agents/project-manager.md` — bug-100 self-verify step 8
- `.claude/agents/perceptual-reviewer.md` — bug-099 removed ignore-outside-viewport guidance + added element-absence emphasis
- `.claude/skills/agents/front-end/react-next/SKILL.md` — bug-105 §2c AppShell layout invariants (5 groups + self-verify)
- `.claude/skills/agents/front-end/svelte-kit/SKILL.md` — bug-105 §2c mirror with cross-reference
- `.claude/skills/screens/SKILL.md` — referenced as Path A target for future feat-NNN

### Operator scripts promoted

- `orchestrator/scripts/run-walkthrough.ts` (formerly `_tmp-run-walkthrough.ts`)
- `orchestrator/scripts/run-verifier.ts` (formerly `_tmp-run-verifier.ts`)
- `orchestrator/scripts/renormalize-walkthrough.ts` (formerly `_tmp-renormalize-walkthrough.ts`)

### Tests

- 6+ new test files added: cluster-bugs.test.ts, ai-walkthrough-pass-b.test.ts, audit-pm-mockup-coverage.test.ts, etc.
- 53 net new tests across the session (942 → 995)

## Decisions made

- **Path E before Path A** (investigate-027): preventive stack-skill content ships first as bug-105; structural Path A (data-token-\* annotations) deferred to await gotribe empirical evidence. Reasoning: Path E is fast + immediate-value; Path A is half-day work that benefits from validating Path E's coverage first.
- **bug-098 closed-by-diagnostic, not by code change**: the hypothesis (parity-verify under-firing on token-drift) was falsified empirically. Both mockup template AND build use identical hex (`#f1f4f5`); audit correctly finds nothing. Real gap is design-intent-vs-source-of-truth (investigate-027 territory). Honest closure with empirical evidence in attempt log.
- **bug-102 closed-as-subsumed-by-bug-101**: empirical motivator (POST 422 family) is now caught at runtime by `runFormSubmitAndCreate`'s networkEvents capture. Deterministic audit-contract.mjs deferred as future enhancement when gotribe empirical evidence shows runtime capture is insufficient.
- **bug-101 shipped MVP (3 of 5 helpers)**: anchor-click + form-submit + filter-combine address the highest-empirical-leverage user-found classes. Theme-visual-diff + create-then-verify deferred until walkthrough findings on gotribe show they're needed.
- **feat-071 Phase B shipped same session as Phase A**: originally split (Phase A safe-to-ship-alone, Phase B deferred). User direction "drive this home" prompted Phase B implementation. Cycle-prevention via cluster-fallback errorLog marker discovered + documented inline.
- **All `_tmp-*` operator scripts promoted to permanent**: was getting recreated each session; permanent location avoids re-derivation. Drop the prefix + commit.
- **Stack-skill AppShell invariants are FACTORY-WIDE, not per-project**: codifying common layout pitfalls in the skill prevents every future project from repeating them. Per-project CLAUDE.md overrides remain possible but the baseline is in the skill.
- **bug-104 fix is at orchestrator dev-server.ts, NOT in any project's .env**: the operator's shell env can clobber default values via spread order; reordering `...process.env` to come BEFORE pinned `ENABLE_TEST_SEED: "1"` ensures the verifier-spawned API always has the test-seed contract regardless of operator shell state.
