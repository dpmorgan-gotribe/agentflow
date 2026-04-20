---
task-id: "021"
title: "Project Manager Agent + tasks.yaml (refactor-003 dual-mode)"
status: pending
priority: P2
tier: 6.5 — Post-Design Planning
depends-on: ["019", "020"]
estimated-scope: small
---

# 021: Project Manager Agent + tasks.yaml

## Position in pipeline (refactor-003)

PM runs **AFTER** `/architect` (not after `/analyze` as in the pre-refactor order). This lets tasks.yaml reference concrete vendor decisions from `architecture.yaml` (e.g., "wire Resend transactional-email templates to member-approval flow") rather than abstract placeholders.

PM is **dual-mode** in refactor-003:

- **`--mode=tasks`** (main pipeline run, post-architect): reads `architecture.yaml` + `requirements.md` + brief §12 / §19, produces `docs/tasks.yaml` — the full project task graph.
- **`--mode=kit-change-request`** (on-demand detour during design): reads a `docs/screens/kit-change-requests/{screen-id}.md` file + current `packages/ui-kit/package.json`, produces `plans/active/kit-change-request-{id}.md` mini-plan. Does NOT require `architecture.yaml` to exist — crucially important since design-phase detours fire BEFORE the main architect stage.

Same agent definition; two invocation surfaces. Orchestrator (task 035) owns when each mode runs.

## What This Task Produces

1. Agent definition at `.claude/agents/project-manager.md`
2. Tasks.yaml template at `docs/tasks.yaml.template`
3. Kit-change-request mini-plan template at `plans/templates/kit-change-request-plan.md`

## Scope

### Agent Definition

Decomposes requirements + architecture into a task graph (main mode) OR authors a single-purpose kit-bump mini-plan (detour mode).

```yaml
---
name: project-manager
description: Dual-mode agent. Main: decompose requirements + architecture into tasks.yaml. Detour: author kit-change-request mini-plans during design.
tools: Read, Write, Bash, Grep, Glob
model: inherit
maxTurns: 30
effort: high
---
```

### tasks.yaml Template (--mode=tasks)

Show expected structure:

```yaml
tasks:
  - id: build-landing-page
    agent: web-frontend-builder
    depends-on: [setup-tokens, setup-ui-primitives]
    priority: P0
    skills: [hero-image-generation, responsive-layout]
    status: pending
    estimated-screens: 1
  - id: wire-stripe-checkout
    agent: backend-builder
    depends-on: [setup-orm, setup-stripe-connect-client]
    priority: P0
    skills: [stripe-connect]
    integration-ref: architecture.yaml#apps.api.integrations.payments
    status: pending
```

Key fields per task:

- `id`, `agent`, `depends-on`, `priority`, `skills`, `status`, `estimated-screens`
- `integration-ref` (new for refactor-003): pointer into `architecture.yaml` when the task implements a vendor integration. Lets downstream builders cross-reference the concrete vendor decision.

### kit-change-request mini-plan template (--mode=kit-change-request)

```markdown
---
id: kit-change-request-{id}
type: refactor
status: draft
created: { YYYY-MM-DD }
branch: design/kit-bump-{id}
affected-files:
  - packages/ui-kit/CHANGELOG.md
  - packages/ui-kit/src/primitives/{new-primitive}.tsx
  - packages/ui-kit/stories/{new-primitive}.stories.tsx
feature-area: ui-kit
priority: P1
---

# Kit Change Request — {summary}

## Missing primitive / pattern / layout

{what the emitting stage needed and the kit didn't provide}

## Proposed addition

{minimal delta to the kit — one primitive / one pattern / one layout per request}

## Kit version bump

`{current} → {new}` (minor bump)

## Consumers requiring regeneration

- `{screen-id}` (emitted this request)
- {any other screens that would benefit — optional, PM surveys screens.json to find them}
```

### Key Responsibilities

**--mode=tasks (main)**:

- Read §12 (Key Features), §19 (Milestones), `docs/requirements.md`, `.claude/architecture.yaml`
- Filter architecture.yaml `apps.*.integrations[]` to `deployment: vendor` + `deployment: self-hosted` entries; each becomes at least one task
- `declined` integrations are skipped (no task emitted)
- Assign each task to the correct agent
- Set dependencies (e.g., backend before frontend integration; ORM before API routes; shared types before any builder)
- Set priorities (P0 = critical path, P1 = important, P2 = nice-to-have)
- Estimate screen counts for budget projection

**--mode=kit-change-request (detour)**:

- Read the specific kit-change-request file + `packages/ui-kit/package.json` + `packages/ui-kit/CHANGELOG.md`
- Author a mini-plan scoping exactly the kit delta needed (one primitive or one pattern — never a multi-primitive bundle; that's a design-cycle issue to escalate)
- Reference the emitting screen ID in the mini-plan
- Compute the new kit minor version number
- Surface as return JSON for the orchestrator to resume the design detour

## Acceptance Criteria

- [ ] `.claude/agents/project-manager.md` exists
- [ ] Skill accepts `--mode=tasks | --mode=kit-change-request` and rejects invocations without a mode with a clear error
- [ ] `docs/tasks.yaml.template` shows task structure with all fields including refactor-003 `integration-ref`
- [ ] `plans/templates/kit-change-request-plan.md` template exists
- [ ] Dependencies, priorities, and agent assignments documented (tasks mode)
- [ ] Status tracking (pending, in-progress, completed, blocked)
- [ ] Kit-change-request mode produces mini-plans without requiring architecture.yaml
- [ ] Return JSON matches `PmOutput` (034b) — discriminated union on `mode`

## Human Verification

1. Main mode: does tasks.yaml reference concrete vendor decisions via `integration-ref` fields pointing into architecture.yaml?
2. Detour mode: invoke mid-design with a sample kit-change-request. Does PM author a mini-plan without complaining about missing architecture.yaml?
3. Does the orchestrator's kit-change-request flow (035 §Kit-change-request detour) resume cleanly after PM writes the mini-plan?
