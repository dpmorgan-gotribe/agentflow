---
task-id: "020"
title: "Architect Agent + Architecture.yaml Template"
status: pending
priority: P2
tier: 5 — Planning Agents
depends-on: ["019"]
estimated-scope: medium
---

# 020: Architect Agent + Architecture.yaml Template

## What This Task Produces
1. Agent definition at `.claude/agents/architect.md`
2. Architecture.yaml template at `.claude/architecture.yaml.template`

## Scope

### Agent Definition
The most critical planning agent. Reads requirements and produces `.claude/architecture.yaml` — the Architecture-as-Code spec that every downstream agent reads.

```yaml
---
name: architect
description: Produces architecture.yaml from requirements. The most critical planning agent — every downstream agent reads its output.
tools: Read, Write, Bash, Grep, Glob
model: inherit
maxTurns: 40
effort: max
---
```

### Architecture.yaml Template
Create a template showing the expected structure. Key sections from the blueprint:

- **apps**: target applications (admin, web, mobile, api) with routing, auth, state management
- **packages**: shared code packages (types, tokens, ui, api-client, utils)
- **tooling**: MCP servers needed, skills needed, budget limits
- **assets**: provenance tracking (user | researched | generated | hybrid)
- **compliance**: privacy manifest, AI consent modal, required native features, account management, required assets

### /architect Skill
Skill at `.claude/skills/architect/SKILL.md`:
1. Read `docs/requirements.md` and `docs/asset-inventory.json`
2. Read brief.md §7, §8, §9
3. Produce `.claude/architecture.yaml`
4. Produce project-specific `.mcp.json`
5. Note compliance requirements for reviewer

## Acceptance Criteria
- [ ] `.claude/agents/architect.md` exists
- [ ] `.claude/architecture.yaml.template` shows all key sections
- [ ] `.claude/skills/architect/SKILL.md` exists
- [ ] Asset provenance section included
- [ ] Compliance section included with privacy manifest fields

## Human Verification
Review the architecture.yaml template — does it capture everything a downstream builder agent would need to know?
