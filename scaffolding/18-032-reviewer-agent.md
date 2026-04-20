---
task-id: "032"
title: "Reviewer Agent + Output Contract Hooks"
status: pending
priority: P2
tier: 8 — Quality & Ship
depends-on: ["028", "029", "030"]
estimated-scope: medium
---

# 032: Reviewer Agent

## What This Task Produces

1. Agent definition at `.claude/agents/reviewer.md`
2. Skill at `.claude/skills/review/SKILL.md`

## Scope

### Agent Definition

```yaml
---
name: reviewer
description: Checks architecture adherence, code quality, security, cross-target consistency. Can trigger builders to fix issues.
tools: Read, Write, Edit, Bash, Grep, Glob
model: inherit
maxTurns: 30
effort: high
---
```

### Review Checklist

From blueprint Section 20 (generator-verifier pattern):

- Architecture adherence: does code match `.claude/architecture.yaml`?
- Code quality: TypeScript strict, no `any`, proper error handling
- Security: no secrets in code, proper auth checks, input validation
- Cross-target consistency: shared types used correctly, API contracts match
- Design tokens: all UI uses `@repo/tokens`, no hardcoded colors/fonts
- Compliance: check items from architecture.yaml compliance section

### /review Skill

1. Read architecture.yaml as the reference spec
2. Check each generated app against spec
3. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`
4. Check for placeholder text (grep for Lorem, TODO, sample, test data)
5. Check for hardcoded values that should come from tokens
6. Report issues as structured list with file:line references
7. If issues found, trigger builders to fix (max 3 iterations)

### Key: Explicit Criteria

The blueprint warns: "Without explicit criteria, the verifier becomes theater." Every check must be specific and testable.

## Acceptance Criteria

- [ ] `.claude/agents/reviewer.md` exists
- [ ] `.claude/skills/review/SKILL.md` exists with explicit checklist
- [ ] Max 3 iteration fix loop documented
- [ ] Compliance checks included
- [ ] Placeholder text detection included

## Human Verification

Is the review checklist comprehensive enough? Any quality criteria missing?
