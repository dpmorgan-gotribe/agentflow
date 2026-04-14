---
task-id: "031"
title: "Tester Agent"
status: pending
priority: P2
tier: 8 — Quality & Ship
depends-on: ["028", "029", "030"]
estimated-scope: medium
---

# 031: Tester Agent

## What This Task Produces
1. Agent definition at `.claude/agents/tester.md`
2. Skill at `.claude/skills/test/SKILL.md`

## Scope

### Agent Definition
```yaml
---
name: tester
description: Generates and runs tests — Vitest for web, jest-expo for mobile, Playwright for web E2E, Maestro YAML for mobile E2E.
tools: Read, Write, Edit, Bash, Grep, Glob
model: inherit
maxTurns: 30
effort: medium
---
```

### Testing Strategy (from blueprint Section 18)
- **Vitest** — web code and shared packages (5-28x faster than Jest)
- **jest-expo** — mobile (RN ecosystem requires Jest)
- **@testing-library/react** — web component tests
- **@testing-library/react-native** — mobile component tests
- **Playwright** — web E2E (cross-browser, auto-waiting)
- **Maestro** — mobile E2E (YAML tests, <1% flakiness)

### /test Skill
1. Read architecture.yaml and tasks.yaml to understand what was built
2. Generate unit tests for shared packages (@repo/types, @repo/utils)
3. Generate component tests for UI components
4. Generate integration tests for API routes
5. Generate Playwright E2E tests for web flows
6. Generate Maestro YAML tests for mobile flows
7. Run all tests to confirm they pass
8. Report results

### Key Rule
The tester runs the tests it generates to confirm they pass. Max 3 iterations on test failures.

## Acceptance Criteria
- [ ] `.claude/agents/tester.md` exists
- [ ] `.claude/skills/test/SKILL.md` exists
- [ ] All five testing tools documented
- [ ] Self-validation: tester runs tests after generating them
- [ ] Max 3 iteration rule documented

## Human Verification
Is the test coverage scope right? Any specific testing patterns you want emphasized?
