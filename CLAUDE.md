# Project CLAUDE.md

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
- System defaults: `~/.claude/models.yaml`
- Project overrides: `.claude/models.yaml`
- Orchestrator resolves model per agent at invocation time
- To bypass: `ANTHROPIC_MODEL=claude-sonnet-4-6`

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
