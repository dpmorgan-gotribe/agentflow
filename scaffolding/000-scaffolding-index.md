# Scaffolding Index — Multi-Agent App Generation System

## Build Philosophy
- Each task is a self-contained unit you can understand completely
- No task moves to "in progress" until the previous is signed off
- Human verifies every task before the next begins
- We build the **work management system first**, then use it to manage the rest

## Priority Tiers

### Tier 1: Work Management Foundation (Tasks 001-006)
*Build the system that manages work — so we can use it to manage building everything else.*

- [001 — Project skeleton & CLAUDE.md](001-project-skeleton.md)
- [002 — Plan file templates & directory structure](002-plan-templates.md)
- [003 — /plan-bug skill](003-plan-bug-skill.md)
- [004 — /plan-feature skill](004-plan-feature-skill.md)
- [005 — /check-existing-work skill](005-check-existing-work.md)
- [006 — /plan-status, /plan-archive, /plan-search skills](006-plan-lifecycle-skills.md)

### Tier 2: Safety & Guardrails (Tasks 007-010)
*Before agents write code, ensure they can't break things.*

- [007 — block-dangerous.sh hook](007-block-dangerous-hook.md)
- [008 — enforce-boundaries.sh hook](008-enforce-boundaries-hook.md)
- [009 — Loop detection hook](009-loop-detection-hook.md)
- [010 — Justfile safe command wrapper](010-justfile.md)

### Tier 3: Configuration & Context (Tasks 011-014)
*Model config, context preservation, settings.json wiring.*

- [011 — Model configuration system (models.yaml)](011-model-config.md)
- [012 — settings.json with hook wiring](012-settings-json.md)
- [013 — /save-context skill](013-save-context-skill.md)
- [014 — /load-context-chain skill](014-load-context-chain-skill.md)

### Tier 4: Brief System (Tasks 015-018)
*The canonical input that drives everything.*

- [015 — Brief schema & frontmatter validation](015-brief-schema.md)
- [016 — Brief template (20-section structure)](016-brief-template.md)
- [017 — /validate-brief skill](017-validate-brief-skill.md)
- [018 — /scan-assets skill (asset scanner)](018-scan-assets-skill.md)

### Tier 5: Planning Agents (Tasks 019-021)
*The agents that turn a brief into actionable specs.*

- [019 — Analyst agent + /analyze skill](019-analyst-agent.md)
- [020 — Architect agent + architecture.yaml template](020-architect-agent.md)
- [021 — Project Manager agent + tasks.yaml](021-pm-agent.md)

### Tier 6: Design Pipeline (Tasks 022-025)
*From brief to visual mockups to design system.*

- [022 — UI Designer agent definition](022-ui-designer-agent.md)
- [023 — /mockups skill](023-mockups-skill.md)
- [024 — /stylesheet skill (design tokens)](024-stylesheet-skill.md)
- [025 — /screens skill + /user-flows-generator](025-screens-skill.md)

### Tier 7: Build Pipeline (Tasks 026-030)
*Shared packages and builder agents.*

- [026 — Turborepo + pnpm workspace scaffold](026-turborepo-scaffold.md)
- [027 — Shared packages skeleton (types, tokens, ui, api-client, utils)](027-shared-packages.md)
- [028 — Backend Builder agent](028-backend-builder-agent.md)
- [029 — Web Frontend Builder agent](029-web-frontend-builder.md)
- [030 — Mobile Frontend Builder agent](030-mobile-frontend-builder.md)

### Tier 8: Quality & Ship (Tasks 031-034)
*Testing, review, git, output enforcement.*

- [031 — Tester agent](031-tester-agent.md)
- [032 — Reviewer agent + output contract hooks](032-reviewer-agent.md)
- [033 — Git Agent](033-git-agent.md)
- [034 — Output contract enforcement (6 layers)](034-output-contracts.md)

### Tier 9: Orchestrator (Tasks 035-036)
*The external TypeScript orchestrator that ties it all together.*

- [035 — Orchestrator core (stage runner + SDK integration)](035-orchestrator-core.md)
- [036 — HITL gates + budget enforcement](036-hitl-gates.md)

### Tier 10: Meta & Compliance (Tasks 037-040)
*Self-improvement loop and App Store readiness.*

- [037 — Lessons Agent](037-lessons-agent.md)
- [038 — Skills Agent](038-skills-agent.md)
- [039 — Agent Expert (meta-agent)](039-agent-expert.md)
- [040 — App Store compliance layer](040-app-store-compliance.md)

---

## Sign-off Protocol
After each task:
1. Builder completes the task and self-verifies
2. Human reviews the output files
3. Human signs off: `APPROVED` or `REVISE: [feedback]`
4. Only then does the next task begin
