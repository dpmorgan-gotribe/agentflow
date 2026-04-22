---
id: refactor-004-task-driven-orchestration
type: refactor
status: completed
completed: 2026-04-22
author-agent: human
created: 2026-04-22
updated: 2026-04-22
parent-plan: investigate-001-post-design-pipeline-architecture
supersedes: null
superseded-by: null
branch: refactor/task-driven-orchestration
affected-files:
  - scaffolding/21-035-orchestrator-core.md
  - scaffolding/08-021-pm-agent.md
  - scaffolding/09-034b-output-contract-zod-schemas.md
  - schemas/tasks.schema.json # new — define the features[] + agent_sequence[] schema
  - schemas/feature.schema.json # new — per-feature validator
  - multi-agent-app-generation-blueprint.md # blueprint revision for task-driven post-design
feature-area: orchestration
priority: P1
attempt-count: 0
max-attempts: 5
motivation: |
  Foundational refactor. Q4 of investigate-001. Current orchestrator is
  stage-linear post-design; extending tasks.yaml with features[] +
  agent_sequence[] unblocks Q1 (worktrees bind to features) and Q2 (per-stack
  skill dispatch per task). Do this first — everything else binds to the
  new schema.
---

# refactor-004-task-driven-orchestration: Post-PM pipeline becomes feature-graph, not stage-linear

## Current State

Per `scaffolding/21-035-orchestrator-core.md`, the orchestrator walks a linear `STAGES[]` array through the design pipeline AND the build phase:

```
analyze → skills-audit-design → mockups → stylesheet → screens →
visual-review → user-flows → architect → pm → skills-audit-build →
register-mcp-build → build-backend → (build-web || build-mobile) →
test → review → git
```

`tasks.yaml` (from task 021 PM spec) records per-task `agent: <one>` + `depends-on[]`. Builders self-select tasks by matching their agent field.

Problems:

- Only one agent per task. Multi-agent sequences for a single feature (e.g. backend-builder → web-frontend-builder → tester → reviewer) are encoded by splitting a feature into multiple tasks with `depends-on` chains. Messy.
- No first-class "feature" concept. Grouping related tasks for worktree scoping (Q1) has no home.
- Tasks that don't need frontend / backend still flow through the same rigid build-backend → build-web → build-mobile → test → review chain. Orchestrator runs unused stages for tasks that skip them.
- `build-web` and `build-mobile` parallelism is at stage level, not per-feature — one slow feature blocks others that could have been worked in parallel.

## Desired State

Two-mode orchestrator:

- **Mode A: stage-linear (design pipeline, unchanged).** `analyze → skills-audit-design → mockups → stylesheet → screens → visual-review → user-flows → gate-4 → architect → pm → skills-audit-build → register-mcp-build → git-agent-bootstrap`
- **Mode B: feature-graph (post-PM, build phase).** For each feature in `tasks.yaml.features[]`, open a worktree, run the feature's declared `agent_sequence[]` inside that worktree, merge on success. Features unblocked by their `depends_on[]` run in parallel.

New tasks.yaml schema:

```yaml
version: "2.0"
features:
  - id: feat-password-reset
    worktree: feat-password-reset
    branch: feat/password-reset
    priority: P1
    depends_on: []
    skip: [] # [mobile] | [web] if not applicable
    agent_sequence:
      - backend-builder
      - web-frontend-builder
      - tester
      - reviewer
    tasks:
      - id: api-password-reset-endpoint
        agent: backend-builder
        depends_on: []
        skills: [nodemailer, bcrypt]
      - id: web-password-reset-form
        agent: web-frontend-builder
        depends_on: [api-password-reset-endpoint]
      - id: test-password-reset
        agent: tester
        depends_on: [web-password-reset-form]
```

Orchestrator gains:

- `runFeature(feature)` — coordinates worktree lifecycle (delegates to git-agent from Q1) + loops through `agent_sequence[]` + passes tasks whose `agent` matches the current agent in the sequence
- `runFeatureGraph(features[])` — respects `feature.depends_on[]` for inter-feature ordering; parallelizes independent features up to a `maxConcurrentFeatures` cap

## Motivation

- **Unblocks Q1** — features are the natural unit for worktree scoping
- **Unblocks Q2** — agent_sequence names the agent per step; dispatcher builder loads the right stack skill based on architecture.yaml at each step
- **Unblocks Q3** — tester role becomes clearer when placed explicitly in `agent_sequence` rather than implied by stage order
- **Paralellism win** — sibling features with no shared ancestor can build concurrently in isolated worktrees
- **Skip logic** — mobile-only features don't invoke web builders, API-only features don't invoke UI builders

Blueprint commits to the opposite direction (stage-linear), so the blueprint revision is part of this refactor.

## Migration Strategy

1. **Write new schemas** (`schemas/tasks.schema.json` + `schemas/feature.schema.json`) with v2.0 shape + `additionalProperties: false`. Keep v1.0 tasks.schema valid during migration.
2. **Extend `scaffolding/09-034b-output-contract-zod-schemas.md`** — add `TasksV2Schema` + `FeatureSchema` Zod definitions next to the existing `TasksSchema`.
3. **Rewrite `scaffolding/08-021-pm-agent.md`** PM output spec to produce v2.0 tasks.yaml. Include the feature-grouping heuristic: tasks sharing a screen cluster, a brief §11 feature ID, or a dominant sub-system merge into one feature.
4. **Rewrite `scaffolding/21-035-orchestrator-core.md`** — split STAGES into `DESIGN_STAGES[]` (unchanged) + `POST_DESIGN_STAGES[]` (architect → pm → skills-audit-build → register-mcp-build → git-agent-bootstrap). Post-bootstrap, orchestrator switches mode: reads tasks.yaml v2 → `runFeatureGraph()`.
5. **Write `runFeature()` + `runFeatureGraph()`** pseudocode inside the orchestrator spec. Don't implement yet (orchestrator source is implementation, not scaffolding) — scaffolding documents the contract.
6. **Blueprint revision** — update `multi-agent-app-generation-blueprint.md` §17 + §18 to describe the feature-graph post-design model. Keep §2-16 (design pipeline) unchanged.
7. **Migration path for v1 consumers** — since no project has yet produced a tasks.yaml (PM hasn't run anywhere), no migration needed. Document that v1 is deprecated at schema level only.

## Affected Consumers

| Consumer                      | File                                                    | Change Required                                                                         |
| ----------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| PM agent spec                 | `scaffolding/08-021-pm-agent.md`                        | Output v2.0 tasks.yaml with `features[]` + `agent_sequence[]`                           |
| Orchestrator spec             | `scaffolding/21-035-orchestrator-core.md`               | Split design vs feature-graph modes; add `runFeature()` pseudocode                      |
| Output schemas                | `scaffolding/09-034b-output-contract-zod-schemas.md`    | Add `TasksV2Schema` + `FeatureSchema`                                                   |
| Builder specs (028, 029, 030) | `scaffolding/14-028-*.md`, `15-029-*.md`, `16-030-*.md` | Read tasks.yaml v2.0 (features[].tasks[] filtered by `agent: <self>`); respect `skip[]` |
| Tester spec (031)             | `scaffolding/17-031-*.md`                               | Read v2 tasks.yaml to find `agent: tester` tasks per feature                            |
| Git-agent spec (033)          | `scaffolding/20-033-*.md`                               | (will be rewritten by Q1 plan) — needs the v2 feature shape to exist first              |
| Blueprint                     | `multi-agent-app-generation-blueprint.md`               | §17 + §18 revision                                                                      |
| New schema file               | `schemas/tasks.schema.json`                             | Create v2.0                                                                             |
| New schema file               | `schemas/feature.schema.json`                           | Create per-feature validator                                                            |

## Validation Criteria

**Schema:**

- `schemas/tasks.schema.json` v2.0 validates with ajv against a hand-crafted valid tasks.yaml fixture
- An invalid fixture (e.g. feature referencing a task ID not in its own `tasks[]`) is rejected with a meaningful error

**Scaffolding coherence:**

- `scaffolding/08-021-pm-agent.md` output shape matches `TasksV2Schema`
- `scaffolding/21-035-orchestrator-core.md` references the feature-graph mode + contains `runFeature()` pseudocode
- Builders 028/029/030 specs explicitly read from `features[].tasks[]`, not top-level `tasks[]`

**Blueprint:**

- Blueprint §17/§18 revision reviewed + merged into main blueprint
- Old stage-linear post-design language removed

**No regression:**

- Design stages STAGES array is byte-identical to the current (refactor-003) shape — we didn't drift the design pipeline
- Existing investigate-001 + refactor-003 plans still reference correct file paths

## Attempt Log

### Attempt 1 — 2026-04-22 · Scaffolding landed

**Scope:** scaffolding spec-only (no runtime implementation). Every file change is a normative spec downstream tasks bind to.

**Files changed / created:**

- `schemas/feature.schema.json` (NEW) — per-feature validator with `id / worktree / branch / priority / depends_on / skip / agent_sequence / tasks[]` and the nested task shape. Enum-locked agent IDs + kebab-case regex on IDs + `additionalProperties: false` throughout.
- `schemas/tasks.schema.json` (NEW) — top-level tasks.yaml v2 validator with `version: "2.0"` required + `features[]` + optional `summary_counts` + `warnings[]`. References feature.schema.json.
- `scaffolding/09-034b-output-contract-zod-schemas.md` — added `tasks.ts` section with `TasksV2Schema` + `FeatureSchema` + `TaskSchema` Zod mirrors + cross-field invariant commentary (5 invariants orchestrator enforces at load time).
- `scaffolding/08-021-pm-agent.md` — rewrote tasks.yaml template with v2 shape (full example: 2 features with 5 tasks + summary_counts); added §v2 field reference, §Feature-grouping heuristic (5-rule), §v1 → v2 migration note; updated §Key Responsibilities (--mode=tasks) with v2 emission steps; updated §Acceptance Criteria (9 v2-specific checks).
- `scaffolding/21-035-orchestrator-core.md` — introduced "Two-phase pipeline" framing replacing "Stage sequence"; trimmed `STAGES[]` to end at `git-agent-bootstrap` (removed build-backend / build-web / build-mobile / test / review / git — now per-feature); added §Feature-graph phase with `runFeature()` + `runFeatureGraph()` pseudocode + merge-conflict routing + agent surface mapping for `skip[]` logic; rewrote §runStage()+runPipeline() into §runStage()+runPipeline()+runFeatureGraph() with 5-tier independent retry-counter table; updated kit-change-request detour references (builders inside worktrees, not stages).
- `multi-agent-app-generation-blueprint.md` — appended **Appendix D — Refactor-004 Task-Driven Orchestration** (7 subsections: Two modes, tasks.yaml v2 shape, what moved vs stayed, git-agent as first-class operator, retry models, stack-skill dispatch cross-reference, supersession breadcrumb).

**Not changed — intentional deferrals:**

- Builder specs (028 / 029 / 030) — will be rewritten by `feat-002-stack-skill-shelf` (per-stack dispatch) which is the correct home for their v2 changes. Tester (031) + reviewer specs similarly deferred.
- git-agent spec (033) — rewritten by `feat-003-git-agent-worktrees`; this refactor only LOCKS the contract (agent_sequence[], feature.worktree/branch fields, git-agent-bootstrap Mode A stage) that git-agent must satisfy.
- Runtime orchestrator TypeScript (`orchestrator/index.ts`) — still pending on task 035 itself; this refactor updates the scaffolding (spec) not the implementation.

**Cross-field invariants documented (orchestrator enforces, schema can't):**

1. Every `task.agent` ∈ parent `feature.agent_sequence`
2. `feature.depends_on[]` resolves + no cycles (DFS at load)
3. `task.depends_on[]` within same feature only
4. `summary_counts` disagreement → warning (not hard fail)

**Supersession flags added:**

- Blueprint §23 BUILD+SHIP subsections marked as superseded in Appendix D §7
- Blueprint §17 (React/NestJS/Expo stack lock) flagged for feat-002 follow-up
- Task 035 STAGES[] trimmed from 17 entries to 11 (removed 6 build-phase stages now handled per-feature)

**Ready to mark completed + commit.**
