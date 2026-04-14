---
task-id: "036"
title: "HITL Gates + Budget Enforcement"
status: pending
priority: P2
tier: 9 — Orchestrator
depends-on: ["035"]
estimated-scope: medium
---

# 036: HITL Gates + Budget Enforcement

## What This Task Produces
Human-in-the-loop gate system and budget enforcement for the orchestrator.

## Scope

### HITL Gate System
From blueprint Section 11 (lines 1700-1845):

Four gates, each with `gateEnabled: boolean`:
1. **After /analyze** — requirements review
2. **After /mockups** — mockup style approval
3. **After /stylesheet** — design system approval
4. **After /screens** — user flows sign-off (THE FINAL GATE — never disable)

### Gate Implementation
```typescript
interface GateDecision {
  approved: boolean;
  feedback?: string;
}
```
- Each gate has an `onGate` callback
- If not approved + feedback: retry stage with feedback (max 3 attempts)
- If not approved + no feedback: abort pipeline
- If approved: proceed to next stage

### Gate Toggling
Config-driven:
```yaml
stages:
  analyze:    { gateEnabled: true }
  mockups:    { gateEnabled: true }
  stylesheet: { gateEnabled: true }
  screens:    { gateEnabled: true }   # Never disable this one
  architect:  { gateEnabled: false }
  build:      { gateEnabled: false }
  test:       { gateEnabled: false }
  review:     { gateEnabled: false }
  git:        { gateEnabled: false }
```

### Budget Enforcement
From blueprint lines 2253-2271:
- Reserve-commit pattern for MCP calls
- `Budget` interface: `reserve()`, `commit()`, `release()`
- Atomic reservation before every external API call
- Per-pipeline budget cap (`perPipelineMaxUsd`)
- Abort if budget exceeded

### Sign-off Detection
Orchestrator watches for `docs/signoff-{timestamp}.json` with `approved: true` at the screens gate.

## Acceptance Criteria
- [ ] Four gate callbacks implemented
- [ ] Gate toggling via config
- [ ] Retry-with-feedback loop (max 3 attempts)
- [ ] Budget reserve-commit pattern implemented
- [ ] Pipeline abort on budget exceeded
- [ ] Sign-off JSON detection for screens gate

## Human Verification
Is the gate flow intuitive? Would you prefer a different approval mechanism (e.g., CLI prompt vs file-based sign-off)?
