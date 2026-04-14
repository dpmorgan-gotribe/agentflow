---
task-id: "022"
title: "UI Designer Agent Definition"
status: pending
priority: P2
tier: 6 — Design Pipeline
depends-on: ["020"]
estimated-scope: small
---

# 022: UI Designer Agent Definition

## What This Task Produces
Agent definition at `.claude/agents/ui-designer.md`.

## Scope

### Agent Definition
```yaml
---
name: ui-designer
description: Generates design tokens, HTML mockups, and user flows sign-off screen. Uses wireframes as layout blueprints when present.
tools: Read, Write, Bash, Grep, Glob
model: inherit
maxTurns: 30
effort: high
mcp_servers:
  - icons8
  - unsplash
  - image-generator
---
```

### System Prompt Content
From blueprint lines 2046-2058 — the CRITICAL OUTPUT RULES:
1. ALWAYS write HTML output to the file path specified
2. NEVER include HTML in response text
3. Response should ONLY contain file path and status
4. DO NOT explain the HTML, add markdown, or wrap in backticks
5. Self-verify by reading back files before reporting complete

### Asset Priority Rule
Embedded in the system prompt:
```
PRIORITY: user-supplied > researched > generated
```

### Wireframe Integration
When wireframes exist in `assets/wireframes/`, read via vision and use as layout blueprints. Keep user's structural decisions, apply extracted brand system.

## Acceptance Criteria
- [ ] `.claude/agents/ui-designer.md` exists with correct frontmatter
- [ ] CRITICAL OUTPUT RULES are in the system prompt
- [ ] Asset priority rule documented
- [ ] Wireframe-driven generation documented
- [ ] MCP server scoping correct (icons8, unsplash, image-generator)

## Human Verification
Are the output rules strict enough to prevent the "prose instead of HTML" problem the blueprint warns about?
