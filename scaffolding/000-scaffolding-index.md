# Scaffolding Index — Multi-Agent App Generation System

## Build Philosophy

- Each task is a self-contained unit you can understand completely
- No task moves to "in progress" until the previous is signed off
- Human verifies every task before the next begins
- We build the **work management system first**, then use it to manage the rest

## Priority Tiers

### Tier 1: Work Management Foundation (Tasks 001-006)

_Build the system that manages work — so we can use it to manage building everything else._

- [001 — Project skeleton & CLAUDE.md](archive/001-project-skeleton.md) ✓ complete
- [002 — Plan file templates & directory structure](archive/002-plan-templates.md) ✓ complete
- [003 — /plan-bug skill](archive/003-plan-bug-skill.md) ✓ complete
- [004 — /plan-feature skill](archive/004-plan-feature-skill.md) ✓ complete
- [005 — /check-existing-work skill](archive/005-check-existing-work.md) ✓ complete
- [006 — /plan-status, /plan-archive, /plan-search, /plan-refactor, /plan-investigation skills](archive/006-plan-lifecycle-skills.md) ✓ complete

### Tier 2: Safety & Guardrails (Tasks 007-010)

_Before agents write code, ensure they can't break things._

- [007 — block-dangerous.sh hook](archive/007-block-dangerous-hook.md) ✓ complete
- [008 — enforce-boundaries.sh hook](archive/008-enforce-boundaries-hook.md) ✓ complete
- [009 — Loop detection hook](archive/009-loop-detection-hook.md) ✓ complete
- [010 — Justfile safe command wrapper](archive/010-justfile.md) ✓ complete

### Tier 3: Configuration & Context (Tasks 011-014)

_Model config, context preservation, settings.json wiring._

- [011 — Model configuration system (models.yaml)](archive/011-model-config.md) ✓ complete
- [012 — settings.json with hook wiring](archive/012-settings-json.md) ✓ complete
- [013 — /save-context skill](archive/013-save-context-skill.md) ✓ complete
- [014 — /load-context-chain skill](archive/014-load-context-chain-skill.md) ✓ complete

### Tier 4: Brief System (Tasks 015-018)

_The canonical input that drives everything._

- [015 — Brief schema & frontmatter validation](archive/015-brief-schema.md) ✓ complete
- [016 — Brief template (20-section structure)](archive/016-brief-template.md) ✓ complete
- [017 — /validate-brief skill](archive/017-validate-brief-skill.md) ✓ complete
- [018 — /scan-assets skill (asset scanner)](archive/018-scan-assets-skill.md) ✓ complete
- [018b — /new-project skill (bootstrap projects/<name>/)](archive/018b-new-project-skill.md) ✓ complete
- [018c — /draft-brief skill (proposal → filled-in brief.md)](archive/018c-draft-brief-skill.md) ✓ complete

### Tier 5: Planning Agents (Tasks 019-021)

_The agents that turn a brief into actionable specs._

- [019 — Analyst agent + /analyze skill](archive/019-analyst-agent.md) ✓ complete
- [020 — Architect agent + architecture.yaml template](020-architect-agent.md)
- [021 — Project Manager agent + tasks.yaml](021-pm-agent.md)

### Tier 6: Design Pipeline (Tasks 022-025b)

_From brief to mockup-grid style selection to UI Kit to composed screens to visual review to sign-off. Per refactor-001, this tier now covers the full six-stage design flow._

- [022 — UI Designer agent definition (opinionated identity + anti-slop)](022-ui-designer-agent.md)
- [022b — UI Kit consumption contract (ESLint plugin + validate-consumer + CONTRACT.md)](022b-ui-kit-contract.md)
- [023 — /mockups skill (N styles × M apps style-selection gate)](023-mockups-skill.md)
- [024 — /stylesheet skill (UI Kit assembly: tokens + primitives + patterns + layouts + Storybook)](024-stylesheet-skill.md)
- [025 — /screens skill + /user-flows-generator (kit-only composition + single-screen retry mode)](025-screens-skill.md)
- [025b — /visual-review skill (Layer 7 — LLM visual critique loop)](025b-visual-review-skill.md)

### Tier 7: Build Pipeline (Tasks 026-030)

_Shared packages and builder agents._

- [026 — Turborepo + pnpm workspace scaffold](026-turborepo-scaffold.md)
- [027 — Shared packages skeleton (types, ui-kit, api-client, utils)](027-shared-packages.md)
- [028 — Backend Builder agent](028-backend-builder-agent.md)
- [029 — Web Frontend Builder agent](029-web-frontend-builder.md)
- [030 — Mobile Frontend Builder agent](030-mobile-frontend-builder.md)
- [041 — MCP server registration & .mcp.json generation](041-mcp-server-registration.md)

### Tier 8: Quality & Ship (Tasks 031-034)

_Testing, review, git, output enforcement._

- [031 — Tester agent](031-tester-agent.md)
- [032 — Reviewer agent + output contract hooks](032-reviewer-agent.md)
- [032b — HTML Verifier agent (Layer 6 defense-in-depth)](032b-html-verifier-agent.md)
- [033 — Git Agent](033-git-agent.md)
- [034 — Output contract enforcement (6 layers)](034-output-contracts.md)
- [034b — Output contract Zod schemas](034b-output-contract-zod-schemas.md)

### Tier 9: Orchestrator (Tasks 035-036)

_The external TypeScript orchestrator that ties it all together._

- [035 — Orchestrator core (stage runner + SDK integration)](035-orchestrator-core.md)
- [036 — HITL gates + budget enforcement](036-hitl-gates.md)

### Tier 10: Meta & Compliance (Tasks 037-040)

_Self-improvement loop and App Store readiness._

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
