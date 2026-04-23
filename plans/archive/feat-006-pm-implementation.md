---
id: feat-006-pm-implementation
type: feature
status: completed
approved-at: 2026-04-23
approved-by: human
completed-at: 2026-04-23
author-agent: human
created: 2026-04-23
updated: 2026-04-23
parent-plan: investigate-002-build-tier-readiness-gap
supersedes: null
superseded-by: null
branch: feat/pm-implementation
affected-files:
  # Agent
  - .claude/agents/project-manager.md
  # Skill (dual-mode)
  - .claude/skills/pm/SKILL.md
  # Templates
  - docs/tasks.yaml.template
  - plans/templates/kit-change-request-plan.md
  # Contract
  - packages/orchestrator-contracts/src/pm.ts
  - packages/orchestrator-contracts/tests/pm.test.ts
  # Smoke-test output (written under projects/mindapp-v2/)
  - projects/mindapp-v2/docs/tasks.yaml
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-006-pm-implementation: `/pm` dual-mode skill + agent

## Problem Statement

`pnpm generate mindapp-v2 --dry-run` now halts at stage 9 (`pm`) because `.claude/skills/pm/SKILL.md` doesn't exist. Until `/pm` ships, no project can produce `tasks.yaml` — which is the sole input to Mode B (feature-graph) of the orchestrator runtime shipped in task-035. Builders (feat-007) + tester (feat-008) + reviewer (feat-009) all downstream-block on this.

Scaffolding at `scaffolding/08-021-pm-agent.md` fully specifies the dual-mode shape:

- **`--mode=tasks`** (main): reads `architecture.yaml` (feat-005 output) + `requirements.md` + `brief.md` §12/§19 + per-platform `flows.md`, applies the feature-grouping heuristic (shared flow / shared brief §11 feature / shared integration), emits `docs/tasks.yaml` v2 with `features[]` + `agent_sequence[]` + `tasks[]`.
- **`--mode=kit-change-request`** (design-time detour): reads a `docs/screens/kit-change-requests/{screen-id}.md` + `packages/ui-kit/package.json`, produces `plans/active/kit-change-request-{id}.md` mini-plan. Does NOT require `architecture.yaml` — design-phase detours fire before architect stage.

Same agent definition, two invocation surfaces. Orchestrator owns when each mode runs.

## Approach

Five phases. Each ends with a commit + passing validation.

### Phase 1 — PmOutput Zod contract

1. Write `packages/orchestrator-contracts/src/pm.ts`:
   - `PmModeSchema` enum: `"tasks" | "kit-change-request"`
   - `PmTasksOutputSchema`: mode=tasks return shape (counts, featuresCount, tasksCount, byAgent map, byPriority map, tasksYamlPath, warnings)
   - `PmKitChangeRequestOutputSchema`: mode=kit-change-request return shape (miniPlanPath, requestedComponent, currentKitVersion, proposedKitVersion, emittingScreen, warnings)
   - `PmOutputSchema`: discriminated union on `mode` (or z.union if duplicate-discriminator-value is a concern, per feat-005 lesson)
2. Re-export via `packages/orchestrator-contracts/src/index.ts`
3. Write `packages/orchestrator-contracts/tests/pm.test.ts` — ≥6 tests (happy-path tasks, happy-path kit-change, mode discriminator, invariants)

**Exit**: `pnpm --filter @repo/orchestrator-contracts test` passes, contracts test count up to ~76+.

### Phase 2 — Agent definition

1. Write `.claude/agents/project-manager.md` per scaffolding L36-45:
   - frontmatter: `tools: Read, Write, Bash, Grep, Glob`, `model: inherit`, `maxTurns: 30`, `effort: high`
2. System prompt body:
   - Dual-mode. `--mode=tasks` is the main pipeline mode; `--mode=kit-change-request` is the design-time detour.
   - Feature-grouping heuristic: shared flow ID → shared brief §11 feature → shared architecture integration → single-task fallback.
   - Cross-field invariants: every `task.agent` ∈ parent `feature.agent_sequence`; feature.depends_on no cycles; task.depends_on same-feature-only.
   - kit-change mode: one primitive OR one pattern OR one layout per request (no multi-primitive bundles — that's a design-cycle issue).

**Exit**: agent file present + frontmatter parses.

### Phase 3 — Dual-mode skill

1. Write `.claude/skills/pm/SKILL.md` with frontmatter:
   ```yaml
   ---
   name: pm
   description: Dual-mode. --mode=tasks produces docs/tasks.yaml v2 from architecture.yaml + requirements.md + flows.md. --mode=kit-change-request produces a kit-bump mini-plan from a screens/kit-change-requests/*.md file. Runs post-architect (main) or mid-design (detour).
   when_to_use: mode=tasks after /architect resolves; mode=kit-change-request when /screens or a builder emits docs/screens/kit-change-requests/*.md
   allowed-tools: Read Write Bash Grep Glob
   argument-hint: "--mode=tasks | --mode=kit-change-request [--request-file=<path>]"
   ---
   ```
2. Argument parsing:
   - Reject invocations without `--mode=` (clear error)
   - `tasks` mode: requires `.claude/architecture.yaml`
   - `kit-change-request` mode: requires `--request-file=<path>` (the .md file that was emitted)
3. **Mode=tasks steps** (main):
   - Read `.claude/architecture.yaml`, `docs/requirements.md`, `docs/brief-summary.json`, `brief.md` §12 + §19, every `docs/analysis/{platform}/flows.md` for grouping hints
   - Apply feature-grouping heuristic (shared flow / §11 feature / integration → merge; none → single-task feature)
   - For each `apps.*.integrations.*` with `deployment: vendor | self-hosted`, emit ≥1 task inside the appropriate feature. `declined` skipped entirely.
   - Determine minimal `agent_sequence[]` per feature (typical: builders → tester → reviewer; `skip[]` removes tiers with zero tasks)
   - Set inter-feature `depends_on` (cascade from vendor dependencies, auth-before-payments, etc.)
   - Priorities: P0 = critical path, P1 = important, P2 = nice-to-have, P3 = polish
   - Estimate `estimated_screens` on frontend tasks
   - Enforce cross-field invariants before write
   - Validate against `schemas/tasks.schema.json` (v2); fail → retry ≤3x with error context; fail 3x → abort with the validation errors
4. **Mode=kit-change-request steps** (detour):
   - Read the request file + `packages/ui-kit/package.json` + `packages/ui-kit/CHANGELOG.md`
   - Author a mini-plan scoping exactly the kit delta (one primitive / pattern / layout — NO multi-primitive bundles)
   - Compute new minor version
   - Reference the emitting screen ID in the mini-plan
   - Write `plans/active/kit-change-request-{id}.md`
5. Return JSON matches `PmOutputSchema` (discriminated on `mode`)
6. Self-verify step: every task.agent ∈ feature.agent_sequence; feature.depends_on has no cycles; task.depends_on resolves within the same feature

**Exit**: skill file registered in available-skills list (harness scans `.claude/skills/` on boot); accepts both modes; rejects no-mode invocations.

### Phase 4 — Templates

1. Write `docs/tasks.yaml.template` — walk-through example matching scaffolding L55-131 (2 features, 5 tasks, summary_counts + warnings block).
2. Write `plans/templates/kit-change-request-plan.md` — frontmatter + body structure per scaffolding L184-217.
3. Both templates validated against their schemas (`tasks.schema.json` + plan template).

**Exit**: templates on disk, tasks.yaml.template validates via a quick `scripts/validate-tasks-yaml.mjs` (add this script alongside).

### Phase 5 — Smoke test against mindapp-v2

1. Run `pnpm generate mindapp-v2 --dry-run` — reports `pm` skill present; halt point advances to `skills-audit-build`.
2. Spawn a subagent (general-purpose) to execute `/pm --mode=tasks` against mindapp-v2's architecture.yaml (feat-005 output) + requirements.md.
3. Validate produced `projects/mindapp-v2/docs/tasks.yaml` against `schemas/tasks.schema.json`.
4. Manual review: does tasks.yaml reference real vendors from mindapp-v2's architecture.yaml (Auth0, Stripe, RevenueCat, pgvector, MediaPipe, Firecracker, Terraform, etc.)? Does it group reasonably (e.g., "feat-auth", "feat-payments-web", "feat-payments-mobile-iap", "feat-pose-detection-sandbox")? Does skip[] correctly exclude tiers per feature (e.g., pose-detection is mobile-only)?
5. Archive plan.

**Exit**: tasks.yaml on disk, schema-valid, vendor-tied, feature-grouped. Dry-run halt point at `skills-audit-build` (feat-010 or skippable until builders exist).

## Rejected Alternatives

- **Alternative A: Single-mode PM (emit only tasks.yaml)** — Rejected. Kit-change-request is load-bearing for refactor-001 design-system detours; without a dedicated PM mode, the orchestrator's kit-change-request-detour.ts has no skill to invoke. We'd either have to bake kit-change-request logic into the orchestrator runtime itself (worse separation) or ship a second standalone skill (more files, same logic burden).

- **Alternative B: Skip feature-grouping; emit a flat tasks list** — Rejected. Feat-003 refactor-004 explicitly upgraded tasks.yaml from flat v1 to hierarchical v2 because the orchestrator's Mode B needs `features[]` with per-feature worktrees + agent_sequence[] to drive Mode B parallelism + worktree isolation. Without grouping, every task becomes a single-task feature, defeating parallelism.

- **Alternative C: Have PM set task priorities automatically via some LLM heuristic only** — Rejected. Priorities should flow from brief.md §19 (Milestones) + §12 feature markings (P0 vs P1 vs P2). LLM-only heuristic without brief grounding tends to P0-everything.

- **Alternative D: Emit Jinja2 / Handlebars templates for tasks.yaml** — Rejected (same reason as feat-005 rejected for architecture.yaml). Variable dimensionality per project; procedural YAML writer is more robust.

- **Alternative E: Defer kit-change-request mode until refactor-001 detour actually fires in the wild** — Rejected. Orchestrator's kit-change-request-detour.ts (shipped in task-035 Phase 8) has an `invokePMKitChangeRequest` injection point. Shipping PM without the detour mode leaves that slot permanently unfillable; bundling now means zero future work when a design-phase detour actually fires.

## Expected Outcomes

- [ ] `.claude/agents/project-manager.md` exists with dual-mode system prompt
- [ ] `.claude/skills/pm/SKILL.md` exists; frontmatter supports both modes
- [ ] `docs/tasks.yaml.template` + `plans/templates/kit-change-request-plan.md` exist
- [ ] `packages/orchestrator-contracts/src/pm.ts` exports `PmOutputSchema` (discriminated); re-exported via index
- [ ] `packages/orchestrator-contracts/tests/pm.test.ts` ≥6 tests; full contracts test count ≥76
- [ ] Running `/pm --mode=tasks` against mindapp-v2 produces `docs/tasks.yaml` validating against `schemas/tasks.schema.json`
- [ ] tasks.yaml references real vendors from mindapp-v2's architecture.yaml via `integration_ref`
- [ ] Feature-grouping heuristic visible in output (shared-flow features, shared-integration features, single-task fallbacks)
- [ ] Cross-field invariants hold in tasks.yaml: every `task.agent` ∈ parent `feature.agent_sequence`; feature.depends_on no cycles; task.depends_on same-feature-only
- [ ] `pnpm generate mindapp-v2 --dry-run` halts at `skills-audit-build` (not `pm`)
- [ ] All 112 orchestrator tests still pass
- [ ] Plan archived with lessons-learned section

## Validation Criteria

**Unit test coverage:**

- `packages/orchestrator-contracts/tests/pm.test.ts` — ≥6 tests: happy-path tasks output, happy-path kit-change output, mode discriminator, counts match features+tasks arrays, priority enum accepts P0-P3, warnings defaults to []
- Total contracts tests ≥76 (up from 70)

**Skill coverage:**

- Invoking `/pm` without `--mode=` returns a clear rejection
- Invoking `/pm --mode=tasks` without architecture.yaml returns "requires /architect to have run"
- Invoking `/pm --mode=kit-change-request` without `--request-file=` returns a clear rejection
- Smoke test against mindapp-v2 produces tasks.yaml with ≥5 features (mindapp-v2 has 18 vendor integrations + self-hosted components — grouping should yield roughly auth, payments-web, payments-mobile, media-hosting, messaging, ai-inference, pose-detection-sandbox, search, monitoring, etc.)

**Orchestrator integration:**

- `pnpm generate mindapp-v2 --dry-run` halt point: `pm` → `skills-audit-build`

**Spec fidelity:**

- Every acceptance criterion from scaffolding L242-256 has an implementation
- v2 shape: `version: "2.0"`, `features[]`, per-feature `agent_sequence[]`, per-task `integration_ref` — all present

**No regression:**

- `pnpm test:all` green (112 orch + 70+ contracts)
- Nothing in `orchestrator/` source changes — additive
- mindapp-v2's design-tier + architect artifacts unchanged by this run

## Attempt Log

### Attempt 1 — 2026-04-23 (succeeded end-to-end across all 5 phases)

5 commits on `feat/pm-implementation`:

- Phase 1: `packages/orchestrator-contracts/src/pm.ts` — PmOutput discriminated union on `mode` (tasks | kit-change-request). 16 new tests. Contracts now at 86 tests.
- Phase 2: `.claude/agents/project-manager.md` — dual-mode agent, feature-grouping heuristic, 3 cross-field invariants, priority ladder from brief §19.
- Phase 3: `.claude/skills/pm/SKILL.md` — 7 tasks-mode steps + 6 kit-change-request-mode steps; argument gate; schema-validate + retry ≤3x.
- Phase 4: `docs/tasks.yaml.template` + `plans/templates/kit-change-request-plan.md` + `scripts/validate-tasks-yaml.mjs` (AJV + cross-field DFS cycle check). Template validates OK.
- Phase 5 smoke test: spawned general-purpose subagent to execute `/pm --mode=tasks` against mindapp-v2's architecture.yaml (feat-005 output) + requirements + flows. Produced `projects/mindapp-v2/docs/tasks.yaml` — 1714 lines, 25 features, 136 tasks, schema-valid, all cross-field invariants pass. Dry-run now reports `✓ pm — already complete`; halt point advanced to `skills-audit-build` (feat-010).

**25 features emerged from grouping:**

- P0 infrastructure: `feat-infra-aws-foundation`, `feat-feature-flags-launchdarkly`, `feat-core-data-model`, `feat-fsrs-scheduler`, `feat-auth-auth0`, `feat-home-dashboard`
- P0 learning core: `feat-onboarding-diagnostic`, `feat-card-study-session`
- P0 billing: `feat-billing-stripe-web` (web-only)
- P1 features: knowledge map, progress analytics, AI coach, on-demand topics, marketing, account settings, billing-iap-mobile
- P2 features: public-kb, study-clubs, body-checkin, practice-guitar, practice-pose-detection, push-notifications, code-sandbox-firecracker
- P3 deferred: language-audio, image-generation (nanobanana flag-gated)

**byAgent** breakdown: devops 7 / backend-builder 42 / web-frontend-builder 18 / mobile-frontend-builder 19 / tester 25 / reviewer 25. **byPriority**: P0 48 / P1 43 / P2 37 / P3 8.

## Lessons Learned

**Discriminated union works cleanly when discriminator values are unique.** PmOutput's `mode: "tasks" | "kit-change-request"` has no duplicate-value variants, so `z.discriminatedUnion("mode", [...])` works. Feat-005's GitAgentOutput had duplicate `op` values across success/failure variants; that's what forced the fallback to `z.union`. Rule of thumb: try discriminatedUnion first; fall back to z.union only when the discriminator field has collisions.

**Feature-grouping collapses are OK — even preferred.** The subagent naturally merged overlapping flows (e.g. mobile flows 2+3 + web flow 3 → `feat-card-study-session`) rather than creating 3 separate features for parallel surfaces of the same flow. This is the right call for worktree parallelism — splitting the same logical feature across 3 worktrees would serialize merges. Document the collapse in warnings[] so re-runs see the deliberate grouping choice.

**`requiredNow: true` is a credential-presence contract, not a P0 task marker.** Architect flags integrations `requiredNow: true` to mean "this env var must be in .env at build time" — not "this integration must be used in a P0 task". PM correctly surfaced as a warning that `ai-inference` is `requiredNow: true` but its first consumer (AI Coach) is P1 (M1 milestone). The relationship between the two is intentionally loose; architect sizes the credential window, PM sizes the feature sequencing.

**The `devops` agent is in the schema but not in FULL_SEQ defaults.** Features like `feat-infra-aws-foundation` (Terraform + AWS provisioning) and `feat-code-sandbox-firecracker` (Firecracker host provisioning) need `devops` explicitly at the front of their `agent_sequence[]`. The feature.schema enum includes `devops` + `security` for exactly this reason — PM should emit them when the feature's work naturally falls outside the typical builder/tester/reviewer chain.

**AJV + js-yaml: remember to addSchema() for $refs across schema files.** `tasks.schema.json` has `items: { $ref: "./feature.schema.json" }`. AJV can't resolve that by path — you have to `ajv.addSchema(featureSchema, "./feature.schema.json")` so the compiled validator knows where to find it. Without this, AJV silently skips the ref and accepts any feature shape. Learned during Phase 4 when my first validator pass didn't actually verify feature structure.

**1714 lines of tasks.yaml is a lot to eyeball — the cross-field validator is the load-bearing check.** For a 25-feature × 136-task graph, manual invariant checking isn't feasible. `scripts/validate-tasks-yaml.mjs` runs (a) AJV schema + (b) DFS cycle detection on feature.depends_on + (c) task.agent ∈ agent_sequence + (d) task.depends_on same-feature-scope. All four ran cleanly on the subagent's first output. That's what gives me confidence the output is actually usable by Mode B.

## Follow-up Work Unblocked

- **feat-007-builder-runtimes** — next on the critical path. Builders (backend + web + mobile) read their task subsets from the orchestrator (filtered by `task.agent == agentName` per feature), resolve `integration_ref` into architecture.yaml for vendor details, and dispatch stack-specific sub-skills from `.claude/skills/agents/{tier}/{stack-slug}/SKILL.md`.
- **feat-008-tester** — reads tester-assigned tasks; testing-policy.md shipped in an earlier refactor.
- **feat-009-reviewer** — reads reviewer-assigned tasks; consumes architecture.yaml + tasks.yaml for cross-reference.
- **task-010 skills-audit** — next dry-run halt point. Secondary-scope skill shipping involves registering vendor SDKs identified in architecture.yaml.tooling.skills.build[]. Less load-bearing than builders — mostly registrar work.

Follow-ups NOT yet tested in this plan:

- **Live `/pm --mode=kit-change-request` invocation** — no kit-change-request has fired in any pipeline yet; the mode is load-bearing for refactor-001 detours but hasn't been exercised end-to-end. Deferred until a real design-phase detour fires OR until we synthesize a test request file for unit-level testing.
- **`.claude/worktrees/` directory does not exist on mindapp-v2 yet.** tasks.yaml references worktrees that git-agent will create at runtime; that's Mode B territory + feat-007 (git-agent lifecycle).
- **Re-run determinism** — did not verify that re-running /pm produces identical tasks.yaml. PM is supposed to use stable feature-slug naming so `depends_on` references survive; first live re-run will be the test.
