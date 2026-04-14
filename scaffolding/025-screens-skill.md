---
task-id: "025"
title: "/screens Skill + /user-flows-generator"
status: pending
priority: P2
tier: 6 — Design Pipeline
depends-on: ["024"]
estimated-scope: medium
---

# 025: /screens Skill + /user-flows-generator

## What This Task Produces
1. Skill at `.claude/skills/screens/SKILL.md`
2. Skill at `.claude/skills/user-flows-generator/SKILL.md`
3. Template at `.claude/templates/user-flows-template.html`

## Scope

### /screens Skill (blueprint lines 1647-1684)
1. Read `companion/navigation-schema.json` — full screen list
2. Identify screens still needing mockups (vs approved representative set)
3. For each remaining screen: reference approved style, compose from primitives, follow wireframe if present
4. Write to `docs/screens/{target}/{screen-id}.html`
5. Invoke `/user-flows-generator` after all screens
6. Report progress in batches of 20

### Batching for Large Apps (450+ screens)
- Group by feature area and user journey
- Generate in batches of 20-40 per invocation
- Checkpoint contexts between batches
- Retry failed batches only, not entire set

### /user-flows-generator Skill (blueprint lines 1872-1916)
1. Read `docs/screens/**/*.html` — catalog every screen
2. Read `docs/requirements.md` user journeys
3. Read `brief.md §6` user personas
4. Group screens into journeys per persona
5. Generate `docs/user-flows-manifest.json`
6. Inject manifest into viewer template
7. Write `docs/user-flows.html`

### User Flows Viewer Template (blueprint lines 1922-1996)
Self-contained HTML with:
- Sidebar navigation by persona and journey
- iframe embedding current screen with device frame chrome
- Device switcher (mobile, tablet, desktop)
- Target switcher (webapp, mobile, admin)
- Step annotations
- Sign-off form that writes `docs/signoff-{timestamp}.json`

## Acceptance Criteria
- [ ] Both skills exist as SKILL.md files
- [ ] Batching strategy documented for large apps
- [ ] User flows template is self-contained HTML (no build step)
- [ ] Sign-off form produces `signoff-{timestamp}.json`
- [ ] FINAL HITL GATE noted: "client signs off on user flows before code generation"

## Human Verification
This is the most important gate in the pipeline. Is the sign-off flow clear? Would you feel confident approving flows through this viewer?
