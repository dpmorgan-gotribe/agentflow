---
task-id: "019"
title: "Analyst Agent + /analyze Skill"
status: pending
priority: P2
tier: 5 — Planning Agents
depends-on: ["015", "016", "017", "018"]
estimated-scope: medium
---

# 019: Analyst Agent + /analyze Skill

## What This Task Produces
1. Agent definition at `.claude/agents/analyst.md`
2. Skill at `.claude/skills/analyze/SKILL.md`

## Scope

### Agent Definition
From blueprint lines 208-215:
```yaml
---
name: analyst
description: Analyzes brief.md and user assets. Use at the start of every new project.
tools: Read, Write, Bash, Grep, Glob, WebSearch, WebFetch
model: inherit
maxTurns: 40
effort: max
---
```
System prompt: senior business analyst who reads brief.md, validates it, scans for assets, identifies targets, maps user flows, and produces structured requirements.

### /analyze Skill
From blueprint lines 1500-1546. The first pipeline stage.

Steps:
1. Run `/validate-brief` — abort on failure
2. Run `/scan-assets` — produce `docs/asset-inventory.json`
3. Read brief.md section by section
4. Identify targets: admin portal, web portal, mobile app
5. Map user journeys per persona (§6)
6. List all screens per target (§11 + companion/navigation-schema.json)
7. Identify integrations (auth, payments, analytics, AI)
8. Research external technologies for skills audit
9. Write `docs/requirements.md`
10. Write `docs/brief-summary.json`
11. Report: target count, screen count, skills needed, assets found

### Output Contract
- `docs/requirements.md` exists and is valid
- `docs/asset-inventory.json` exists
- `docs/brief-summary.json` exists with required fields
- Return JSON: `{ success, targets, screenCount, skillsNeeded, assetsFound, warnings }`

## Acceptance Criteria
- [ ] `.claude/agents/analyst.md` exists with correct frontmatter
- [ ] `.claude/skills/analyze/SKILL.md` exists with full steps
- [ ] Output contract specifies all three output files
- [ ] Self-verification step included
- [ ] HITL gate noted: "human reviews requirements after this stage"

## Human Verification
Read the skill steps — is there anything the analyst should check that's missing? Is the output contract sufficient for downstream agents?
