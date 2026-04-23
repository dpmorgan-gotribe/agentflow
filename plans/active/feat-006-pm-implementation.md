---
id: feat-006-pm-implementation
type: feature
status: approved
approved-at: 2026-04-23
approved-by: human
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

<!-- Populated by executing agent. -->
