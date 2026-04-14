---
task-id: "024"
title: "/stylesheet Skill (Design Tokens)"
status: pending
priority: P2
tier: 6 — Design Pipeline
depends-on: ["023"]
estimated-scope: medium
---

# 024: /stylesheet Skill

## What This Task Produces
Skill at `.claude/skills/stylesheet/SKILL.md` — generates the canonical design token system.

## Scope
From blueprint lines 1598-1639:

### Skill Steps
1. Analyze approved mockups for consistent visual vocabulary:
   - Color palette (user assets first, then mockups)
   - Typography scale (user fonts first, then mockups)
   - Spacing rhythm (4px or 8px base unit)
   - Border radii, shadows, transitions
2. Full asset inventory download (partial was for mockups, full for production)
3. Generate `packages/tokens/`:
   - `tailwind-preset.ts` with extended theme
   - `index.ts` exporting tokens as TypeScript
   - `css-variables.css` for runtime theming
4. Generate `packages/ui/primitives/` base components:
   - Button, Input, Card, Modal, Badge, etc.
5. Generate `docs/design-system-preview.html` showing every primitive with every variant

### Output Contract
- `packages/tokens/*` files exist and `pnpm typecheck` passes
- `packages/ui/primitives/*` components exist
- `docs/design-system-preview.html` exists
- Return JSON: `{ success, tokenCount, primitiveCount, assetsDownloaded }`

### Prerequisite
`/mockups` completed and approved by HITL gate.

## Acceptance Criteria
- [ ] `.claude/skills/stylesheet/SKILL.md` exists
- [ ] Specifies all three token output formats (TS, preset, CSS vars)
- [ ] Lists UI primitives to generate
- [ ] Design system preview page specified
- [ ] HITL gate noted: "human reviews design system after this stage"

## Human Verification
Is the list of UI primitives (Button, Input, Card, Modal, Badge) sufficient for most apps? What's missing?
