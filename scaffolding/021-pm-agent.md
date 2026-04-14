---
task-id: "021"
title: "Project Manager Agent + tasks.yaml"
status: pending
priority: P2
tier: 5 — Planning Agents
depends-on: ["019"]
estimated-scope: small
---

# 021: Project Manager Agent + tasks.yaml

## What This Task Produces
1. Agent definition at `.claude/agents/project-manager.md`
2. Tasks.yaml template at `docs/tasks.yaml.template`

## Scope

### Agent Definition
Decomposes requirements into a task graph with dependencies, priorities, and agent assignments.

```yaml
---
name: project-manager
description: Decomposes requirements into task graph with dependencies, priorities, and agent assignments. Outputs docs/tasks.yaml.
tools: Read, Write, Bash, Grep, Glob
model: inherit
maxTurns: 30
effort: high
---
```

### tasks.yaml Template
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
```

### Key Responsibilities
- Read §12 (Key Features), §19 (Milestones), and `docs/requirements.md`
- Assign each task to the correct agent
- Set dependencies (e.g., backend before frontend integration)
- Set priorities (P0 = critical path, P1 = important, P2 = nice-to-have)
- Estimate screen counts for budget projection

## Acceptance Criteria
- [ ] `.claude/agents/project-manager.md` exists
- [ ] `docs/tasks.yaml.template` shows task structure with all fields
- [ ] Dependencies, priorities, and agent assignments documented
- [ ] Status tracking (pending, in-progress, completed, blocked)

## Human Verification
Does the task structure capture enough information for the orchestrator to sequence work correctly?
