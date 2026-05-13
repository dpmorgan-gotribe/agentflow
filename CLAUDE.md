# Project CLAUDE.md

## Project Initialization

- This repository is the **factory** — it holds agentic resources (agents, skills, hooks, rules) used to generate apps
- Generated apps live under `projects/<name>/` and are independent git repos
- To create a new project: run `/new-project <name>` (see `.claude/skills/new-project/SKILL.md`)
- To refresh agentic resources in an existing project without losing user content: `/new-project <name> --force`
- To delete a project (inverse of `/new-project`): `/delete-project <name>` — destructive; preview with `--dry-run` first, confirm with `--yes`
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

## Test Policy (NON-NEGOTIABLE)

- **No test rot.** When any test fails — yours, mine, pre-existing — it must be fixed before the work that surfaces it is considered done. Do not leave broken tests in the suite.
- This applies regardless of whether the failure is "caused by my change" or "predated my branch." If the suite is red, we fix it.
- **The default fix is to fix the TEST, not the production code.** A test failing usually means the test's expectation has drifted from the production code's evolving intent; the production code was working correctly until the test caught up. Reach for production-code changes ONLY when you have strong evidence the production code is genuinely wrong AND the test is correctly describing intended behavior.
- **Changing production code to "make a test pass" is dangerous.** It can break working features by chasing a test whose expectation was authored against an outdated spec. Before touching production code, you must (a) understand the intent the test was originally encoding, (b) confirm the current production behavior diverges from that intent (not just from the test's literal assertion), (c) confirm the divergence is a real bug, not a deliberate evolution. If unsure, fix the test or escalate to /plan-investigation — never assume the test is right.
- Acceptable resolutions, in preference order: (1) fix the test if its assertion has drifted from intent or its setup is missing recent context (most common); (2) delete the test if the behavior it covered has been deliberately removed AND no other coverage replaces it; (3) fix the production code ONLY when you can prove the test correctly describes intended behavior that the implementation no longer delivers (rare, requires evidence — see /plan-bug if in doubt).
- Unacceptable: marking tests `.skip`, commenting them out, or adding "pre-existing rot" notes that defer the fix indefinitely.
- The retry-cap (attempt 5 escalate) still applies per individual test. If a single test resists 5 fix attempts, escalate to investigation — don't just leave it red.
- Rationale: red tests are noise that hides new regressions and erodes trust in the signal. But the inverse — production code being silently broken in pursuit of a green suite — is worse. Bias toward fixing the test; only touch production code when you have evidence-of-bug.

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
