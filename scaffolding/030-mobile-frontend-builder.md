---
task-id: "030"
title: "Mobile Frontend Builder Agent"
status: pending
priority: P2
tier: 7 — Build Pipeline
depends-on: ["020", "027"]
estimated-scope: medium
---

# 030: Mobile Frontend Builder Agent

## What This Task Produces
1. Agent definition at `.claude/agents/mobile-frontend-builder.md`
2. Skill at `.claude/skills/build-mobile-frontend/SKILL.md`

## Scope

### Agent Definition
```yaml
---
name: mobile-frontend-builder
description: Builds Expo React Native mobile app from architecture specs. Generates apps/mobile/.
tools: Read, Write, Edit, Bash, Grep, Glob
model: inherit
permissionMode: acceptEdits
maxTurns: 30
skills:
  - expo-patterns
---
```

### System Prompt
- Senior React Native/Expo developer
- Expo SDK 52+ with Expo Router
- NativeWind 4 for styling (same Tailwind classes as web)
- React Native Reusables for components
- Use `@repo/ui` (`.native.tsx` variants)
- Use `@repo/tokens` for design tokens

### /build-mobile-frontend Skill
1. Read architecture.yaml mobile section
2. Read approved screen mockups from `docs/screens/mobile/`
3. Generate Expo Router layouts and screens
4. Generate components using RN Reusables + tokens
5. Wire up tRPC client
6. Configure `app.json` with unique bundleIdentifier, permissions, deep linking
7. Write to `apps/mobile/`
8. Run typecheck

### Separated from Web
Blueprint rationale: "Separating web from mobile builders ensures each has focused expertise rather than context-switching between platforms."

## Acceptance Criteria
- [ ] `.claude/agents/mobile-frontend-builder.md` exists
- [ ] `.claude/skills/build-mobile-frontend/SKILL.md` exists
- [ ] References correct stack: Expo, NativeWind, RN Reusables
- [ ] Uses `.native.tsx` variant pattern from @repo/ui
- [ ] app.json configuration included in scope

## Human Verification
Is the Expo/NativeWind stack the right choice for your mobile targets?
