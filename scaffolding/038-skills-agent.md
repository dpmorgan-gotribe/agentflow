---
task-id: "038"
title: "Skills Agent"
status: pending
priority: P3
tier: 10 — Meta & Compliance
depends-on: ["019"]
estimated-scope: small
---

# 038: Skills Agent

## What This Task Produces

Agent definition at `.claude/agents/skills-agent.md`.

## Scope

From blueprint lines 243-246:

### Agent Definition

```yaml
---
name: skills-agent
description: Audits whether the project has skills for the chosen stack. If missing, researches documentation, authors new SKILL.md with bundled resources, validates on a minimal test case.
tools: Read, Write, Edit, Bash, Grep, Glob, WebSearch, WebFetch
model: inherit
maxTurns: 30
effort: high
---
```

### Responsibilities

1. After /analyze, audit `docs/requirements.md` for technologies mentioned
2. Check if skills exist for each technology in `.claude/skills/` and `~/.claude/skills/`
3. For missing skills: research documentation, author SKILL.md with templates and examples
4. Validate new skill on minimal test case
5. Deposit at root (`~/.claude/skills/`) and clone into project (`.claude/skills/`)

### Invocation Point

Runs after /analyze and before /architect in the pipeline (step 7 in the sequence).

## Acceptance Criteria

- [ ] `.claude/agents/skills-agent.md` exists
- [ ] Skill audit logic documented
- [ ] Research + authoring + validation flow specified
- [ ] Deposit locations documented (global + project)

## Human Verification

Is the skill audit thorough enough? Should it also check for agent definitions, not just skills?
