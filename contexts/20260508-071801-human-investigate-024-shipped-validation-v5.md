---
session-id: "20260508-071801"
timestamp: "2026-05-08T07:18:01Z"
agent: human
task-id: investigate-024-bug-fix-dispatch-efficiency
previous-context: 20260507-004018-human-investigate-018-021-stack-shipped-and-strategy-c-gaps-found.md
checkpoint: true
status: in-progress
---

# Context snapshot — human — investigate-024 shipped + validation v5 mid-flight

## Summary

investigate-024 (bug-fix dispatch efficiency: get per-bug from 25-90+min →
2-3 min target) shipped all 5 phases + 4 follow-up bugs in a single
~10-hour session against reading-log-02. Validation is running its 5th
iteration (v5); 5 of 14 fresh bugs resolved cleanly via bug-fixer agent
(flow-1/2/3/6 at att 1, ~5 min/bug each). Remaining 9 bugs (flow-4,
flow-5, 8 parity-divergence) are stuck — bug-fixer dispatches but commits
nothing (empty-merge) or hits 15-min wall-clock. Empirical signal:
bug-fixer's narrow scope nails simple E2E selector/URL fixes but can't
do parity-divergence's structural JSX restructuring.

## Completed since last snapshot

- investigate-024 (240-min time-box) — 7-step investigation + 5-phase ship
  plan documented in plans/active/investigate-024-bug-fix-dispatch-efficiency.md
- Phase 1 (bug-075 — disable class-batched parity by default, env flag flip)
- Phase 2 (bug-074 — null-safe flow-failure body + bug-id slug fallback)
- Phase 3 (feat-063 — pre-loaded bug-fix dispatch context, NEW
  orchestrator/src/bug-fix-context.ts module with per-class file resolution)
- Phase 4 (feat-064 — bug-fixer agent at .claude/agents/bug-fixer.md;
  AgentSequenceMember enum extended; defaultAgentSequence routes 4 cheap
  classes → ["bug-fixer"])
- Phase 5 Phase A (feat-065 — bug-fixer in models.yaml at tier:building/
  effort:medium; DEFAULT_STALL_TIMEOUT_BY_AGENT.bug-fixer = 15min after
  bumping from 10min)
- bug-076 (openFixupWorktree force-recreate orphan dirs — Windows file
  lock empirical fix)
- feat-064-followup (flow-failure with no primaryCause → bug-fixer)
- feat-064-followup-2 (step-transition + timeout-no-evidence route → bug-fixer)
- bug-074-followup (slug cap at 20 chars to avoid Windows MAX_PATH)
- feat-064-followup-3 (runLlmAgent fail-on-missing-config instead of
  silent-success)
- feat-065-followup (FACTORY_DEFAULT_AGENT_TIERS map for bug-fixer fallback)
- feat-063-followup (parity 3-path pre-load: route page + index page +
  components dir)
- feat-050 Phase D — /user-flows-generator SKILL.md gains requiredState
  authoring guidance (~128 lines added)
- 8 commits landed on feat/quota-observability branch
- 5 plans filed in plans/active/: investigate-024, bug-074, bug-075,
  feat-063, feat-064, feat-065 (+ bug-076 as separate followup)

## Current state

- Branch: feat/quota-observability (38c4fe9)
- Tests: 245+/245+ passing across orchestrator suites (model-config,
  invoke-agent, file-bug-plan-parity, fix-bugs-loop, bug-fix-context)
- Uncommitted files: 6 plan-doc edits from earlier sessions (pre-this-session
  state, untouched), plus tmp scripts ignored. NO code changes uncommitted.
- Blockers: validation v5 not finishing — bug-fixer agent stalls on parity
  bugs + flow-4/flow-5. 5 of 14 fresh bugs resolved cleanly; the rest
  empty-merge or hit wall-clock.

## Next steps

1. Wait for v5 to finish iter 1 verify pass (3 parity bugs in-flight at
   snapshot time). Determine whether iter 2 resolves any of the stuck
   bugs OR whether they all hit attempts:3 → failed.
2. If validation ends with ≥10/15 resolved, declare the ship plan
   validated + commit-and-move-on. If <10/15, file follow-up
   investigation — likely "bug-fixer scope is too narrow for layout-
   regrouping; needs class-conditional fallback to 3-agent sequence".
3. Operator must add bug-fixer to ~/.claude/models.yaml manually (boundary
   hook blocks orchestrator-side edit). FACTORY_DEFAULT_AGENT_TIERS map
   covers most cases but home-yaml is the canonical place.
4. /new-project scaffold already inherits factory's .claude/models.yaml
   (which has bug-fixer); no additional template change needed.
5. Phase B of feat-065 (class-aware model + effort per bug.source) DEFERRED
   pending more empirical signal — currently shipping uniform Sonnet medium.
6. Consider: should bug-fixer escalate to web-frontend-builder + tester +
   reviewer when "small diff" mandate fails N times? File as feat-066 if
   pattern continues.

## Open questions

- Why does bug-fixer empty-merge ALL parity bugs? Pre-load includes mockup
  - 3 candidate fix-sites + diagnostic block. Yet 6/6 in v4 + 1/1 in v5
    (so far) commit nothing. Possible: agent's "smallest diff" + "don't
    refactor" hard constraints make it bail on layout-regrouping which
    requires 20-50 line JSX restructures.
- Why does flow-5 hit wall-clock TWICE (10min in v4, 15min in v5)? Either
  the spec genuinely needs more architectural work than bug-fixer can do,
  OR the agent's prompt has it stuck in an exploration loop that 15min
  doesn't break. Worth reading flow-5.spec.ts contents to understand.
- Should the dev-server-compile case keep tier-routing (bug-056) for
  backend-builder vs all-bug-fixer? Currently dev-server-compile → bug-fixer.
  For backend dev-server-compile bugs, bug-fixer (web-stack-aware) might
  not have the right context for FastAPI / Fastify boot fixes.

## Key files touched

- orchestrator/src/bug-fix-context.ts — NEW (232+ lines, feat-063 +
  feat-063-followup parity 3-path heuristic)
- orchestrator/src/fix-bugs-loop.ts — bug-073 convergence detector +
  feat-063 dispatch wiring + bug-076 force-recreate (~138 line diff)
- orchestrator/src/invoke-agent.ts — feat-063 preLoadedContext field +
  feat-064-followup-3 fail-on-missing-config (~13 line diff)
- orchestrator/src/feature-graph.ts — bug-075 default flip + feat-063
  InvokeAgentFn extension (~31 line diff)
- orchestrator/src/model-config.ts — feat-065 stallTimeoutMs (15min) +
  feat-065-followup FACTORY_DEFAULT_AGENT_TIERS map (~6+30 lines)
- scripts/file-bug-plan.mjs — bug-074 null-safe body + slug cap +
  feat-064-followup-1/2 routing (~56 line diff total across 4 commits)
- packages/orchestrator-contracts/src/tasks.ts — added "bug-fixer" to
  AgentSequenceMember + TaskAgent enums
- .claude/agents/bug-fixer.md — NEW (75 lines, narrow-scope patch agent)
- .claude/models.yaml — bug-fixer pin
- 5 new plan files: investigate-024, bug-074, bug-075, bug-076, feat-063,
  feat-064, feat-065

## Decisions made

- **Routing**: 4 cheap classes (dev-server-compile, runtime-error,
  visual-parity, flow-execution-failure) plus step-transition +
  timeout-no-evidence ALL route to ["bug-fixer"] only. seed-setup keeps
  full 3-agent (real backend work). build-gap + default keep
  [<tier>, tester, reviewer] (real feature work). Rationale: feat-062
  pure-verify routing — the bug-fix loop's verify→fix→verify cycle IS
  the test; tester+reviewer add latency without unique value.
- **Wall-clock cap**: 15min for bug-fixer (was 10min v4, was 25min for
  full builders). maxTurns:8 frontmatter is the primary convergence
  enforcer; wall-clock is defense-in-depth backstop. Rationale:
  empirical 10min was too tight for parity bugs.
- **Pre-load multi-path for parity**: 3 candidate fix-sites instead of 1.
  Over-specifying is cheap (missing files go to diagnostic, don't load
  content). Rationale: app-router projects have screen-id-to-page-path
  mismatches (book-create is a Modal not a route).
- **fail-on-missing-config**: runLlmAgent now returns FAILED + errors[id]
  when readModelConfig throws. bug-010 era's "skip-completed" was
  cascade-prevention pre-retry-cap; today's retry caps + bug-073
  convergence detector handle that naturally. Silent success was masking
  real config bugs.
- **FACTORY_DEFAULT_AGENT_TIERS**: hardcoded fallback (lowest precedence)
  for factory-shipped agents not yet in operator's home YAML. Currently
  contains bug-fixer. Added because boundary hook prevents
  orchestrator-side edits to ~/.claude/models.yaml.
- **Phase 5 Phase B (class-aware model)**: DEFERRED. Empirical signal
  needed first. Currently shipping uniform Sonnet medium; if Phase A
  doesn't hit the 2-3 min target, ship class-aware as polish.
- **bug-074 slug cap at 20 chars**: necessary for Windows MAX_PATH.
  Synthesizer populates flowName with TEST DESCRIPTION
  ("walks 7 interaction(s) deterministically") not manifest's flow.name
  ("First-time setup"). Followup deferred: fix synthesizer to use the
  manifest's flow.name instead.
