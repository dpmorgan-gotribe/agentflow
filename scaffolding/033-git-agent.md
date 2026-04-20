---
task-id: "033"
title: "Git Agent"
status: pending
priority: P2
tier: 8 — Quality & Ship
depends-on: ["001"]
estimated-scope: small
---

# 033: Git Agent

## What This Task Produces

Agent definition at `.claude/agents/git-agent.md`.

## Scope

### Agent Definition

```yaml
---
name: git-agent
description: Creates feature branches, conventional commits, pull requests. Branch-per-feature workflow.
tools: Read, Bash, Grep, Glob
model: inherit
maxTurns: 10
effort: low
---
```

### Responsibilities

- Create feature branches matching plan slugs
- Write conventional commit messages (feat:, fix:, refactor:, etc.)
- Create pull requests via `gh pr create`
- Verify branch names match patterns
- Never force push, never push to main/master

### Conventional Commit Format

```
<type>(<scope>): <description>

<body>

<footer>
```

Types: feat, fix, refactor, test, docs, chore, ci

### Branch Naming

Must match: `feat/<slug>`, `fix/<slug>`, `refactor/<slug>`, `chore/<slug>`

### Note on Model

This agent uses the `mechanical` tier (Haiku) — simple deterministic work that doesn't need deep reasoning.

## Acceptance Criteria

- [ ] `.claude/agents/git-agent.md` exists
- [ ] Conventional commit format documented
- [ ] Branch naming convention documented
- [ ] No destructive git operations allowed
- [ ] Uses `mechanical` tier (cheapest model)

## Human Verification

Does the conventional commit format match your team's conventions? Any adjustments needed?
