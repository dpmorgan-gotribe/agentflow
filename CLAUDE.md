# Project CLAUDE.md

## Project Initialization

- This repository is the **factory** — it holds agentic resources (agents, skills, hooks, rules) used to generate apps
- Generated apps live under `projects/<name>/` and are independent git repos
- To create a new project: run `/new-project <name>` (see `.claude/skills/new-project/SKILL.md`)
- To refresh agentic resources in an existing project without losing user content: `/new-project <name> --force`
- Design + planning is HITL-gated, run one skill at a time: `/analyze` → `/mockups` → (gate 2: `/pick-style`) → `/stylesheet` → `/screens` → `/user-flows-generator` → (gate 4: design signoff) → `/architect` → (gate 5: fill .env + drop `docs/credentials-confirmed.txt`) → `/pm --mode=tasks`.
- Then `/start-build <name>` to run the autonomous build phase (Mode B): opens parallel git worktrees per feature from `docs/tasks.yaml`, runs each feature's `agent_sequence` (builder → security → tester → reviewer), merges to main. Refuses to run until all Mode A artifacts + gate-5 are in place. `/start-build <name> --dry-run` previews the feature DAG wave plan.
- The factory↔project distinction is load-bearing: never edit a project's `.claude/agents/` expecting it to propagate back to the factory

## Project Specification

- The canonical specification is `brief.md` at project root
- Read brief.md FIRST before starting any work
- Never ask the user for information that is in the brief
- Reference brief sections, never copy content from them
- For large companion files, read .summary.md first, use jq for targeted extraction
- If brief.md is missing or invalid, STOP and report the error
- Run `/validate-brief` if you suspect issues

## Agent Section Assignments

- Analyst: all sections (validation + requirements extraction)
- Architect: §7, §8, §9 + companion/data-models.yaml
- PM: §12, §19, requirements.md
- UI Designer: §2, §10, §11 + companion/navigation-schema.json
- Security: §13, §14
- DevOps: §8, §16, §18

## User Assets

- Check `./assets/` for user-supplied logos, icons, fonts, wireframes
- User assets ALWAYS override generated or researched assets
- Asset inventory lives at `docs/asset-inventory.json` after /scan-assets
- If wireframe exists for a screen, use it as layout blueprint

## Model Configuration

- System defaults: `~/.claude/models.yaml` (managed by the platform owner)
- Project overrides: `.claude/models.yaml` (edit freely per project)
- To switch a single agent to a different tier, add it to `agents:` in the project config
- Budget limits are enforced by the orchestrator — exceeding `perPipelineMaxUsd` aborts the run
- To bypass config entirely for debugging: `ANTHROPIC_MODEL=claude-sonnet-4-6`
- Resolution order: `ANTHROPIC_MODEL` > project `.claude/models.yaml` > `~/.claude/models.yaml`
- The TypeScript `readModelConfig()` that merges these lives in the orchestrator (task 035)
- Auth provider config lives in the same `models.yaml` under the top-level `provider:` key — see `docs/agent-sdk-auth-providers.md` for the 4 options + precedence rules. Factory default is `claude-max-subscription` (uses your logged-in Claude Code session; no per-token API bill).

## Plan/Archive System (NON-NEGOTIABLE)

### Before ANY Work

1. Run `/check-existing-work [keywords]` to search for related plans
2. If related archived plans exist, READ their lessons
3. Create a plan: `/plan-feature`, `/plan-bug`, `/plan-refactor`, or `/plan-investigation`
4. Get plan approved before implementing (status: draft → approved)

### During Work

- Work on your plan's git branch
- Log attempts in plan's Attempt Log section
- If stuck after 3 attempts, run `/plan-investigation`
- If stuck after 5 attempts, STOP and escalate to human
- NEVER try the same fix twice — check the attempt log

### After Work

- Run `/plan-archive` with outcome and lessons learned
- Lessons feed into `docs/lessons.md` for future agents

### File Ownership

- Check `affected-files` in active plans before editing any file
- If claimed by another plan, coordinate with PM agent

## Context Preservation

- Before starting work, run `/load-context-chain` for prior state
- After significant steps, run `/save-context`
- Checkpoints every 5 snapshots or at milestones
- Never read more than 5 snapshots deep without hitting a checkpoint

## Retry Policy

- Attempt 1-2: Try different approaches
- Attempt 3: Run `/plan-investigation`
- Attempt 4: Try investigation's recommendation
- Attempt 5: STOP and escalate
- NEVER exceed 5 attempts on the same error

## Output Contracts

- UI Designer writes HTML to files, returns only status
- Never include HTML/code in response text
- Self-verify by reading back files before reporting complete

## Key File Locations

- Architecture spec: `.claude/architecture.yaml`
- Requirements: `docs/requirements.md`
- Task graph: `docs/tasks.yaml`
- Asset inventory: `docs/asset-inventory.json`
- Active plans: `plans/active/`
- Archived plans: `plans/archive/`
- Context snapshots: `contexts/`
- Pipeline stage outputs: `pipeline/`
- Design tokens: `packages/tokens/`
- Shared UI components: `packages/ui/`
- Shared types: `packages/types/`

## Brief Protocol

- The canonical specification is `brief.md` at project root
- Read brief.md FIRST before starting any work
- Never ask the user for information that is in the brief
- Reference brief sections, never copy content from them
- For large companion files, use jq to extract targeted sections
- If brief.md is missing or invalid, STOP and report the error
