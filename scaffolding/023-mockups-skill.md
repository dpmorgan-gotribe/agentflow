---
task-id: "023"
title: "/mockups Skill"
status: pending
priority: P2
tier: 6 — Design Pipeline
depends-on: ["022", "018"]
estimated-scope: medium
---

# 023: /mockups Skill

## What This Task Produces
Skill at `.claude/skills/mockups/SKILL.md` — the second pipeline stage.

## Scope
From blueprint lines 1550-1594:

### Skill Steps
1. Read `docs/asset-inventory.json` — catalog user assets
2. Read `docs/requirements.md` — get screen list and journeys
3. Read `companion/navigation-schema.json` via jq for screen metadata
4. If `$ARGUMENTS` specifies count N, limit to N representative mockups (1 dashboard, 1 list, 1 form, 1 detail)
5. For each mockup:
   a. If `assets/wireframes/{screen}.png` exists, read as layout blueprint
   b. If user has logos/colors/fonts, use those
   c. If icons needed and user has them, use user's; else queue for Icons8
   d. Generate as pure HTML (not React) for iteration speed
   e. Write to `docs/mockups/{screen-id}.html`
6. Generate `docs/mockups/index.html` — grid view of all mockups
7. Report: mockup count, styles used, icons downloaded

### Output Contract
- `docs/mockups/*.html` files (one per screen)
- `docs/mockups/index.html` grid review page
- Return JSON: `{ success, mockupsGenerated, userAssetsUsed, iconsFromMCP }`

### Critical: File-Based Output
HTML goes to files. Response text contains ONLY status and file paths.

## Acceptance Criteria
- [ ] `.claude/skills/mockups/SKILL.md` exists
- [ ] Supports partial generation via count argument
- [ ] Uses wireframes as blueprints when present
- [ ] Respects asset priority (user > researched > generated)
- [ ] Index page for grid review
- [ ] HITL gate noted: "human reviews mockups after this stage"

## Human Verification
Would you feel confident reviewing mockups via the grid index page?
