---
id: task-011-registrar-skills
type: feature
status: approved
approved-at: 2026-04-23
approved-by: human
author-agent: human
created: 2026-04-23
updated: 2026-04-23
parent-plan: investigate-002-build-tier-readiness-gap
supersedes: null
superseded-by: null
branch: task/registrar-skills
affected-files:
  - .claude/skills/skills-audit/SKILL.md
  - .claude/skills/register-mcp-servers/SKILL.md
  - .claude/agents/skills-agent.md
feature-area: orchestration
priority: P1
attempt-count: 0
max-attempts: 5
---

# task-011-registrar-skills: `/skills-audit` + `/register-mcp-servers` (bundled twins)

## Problem Statement

Orchestrator dry-run on any project currently halts at `skills-audit-build` because `.claude/skills/skills-audit/SKILL.md` doesn't exist. One stage later, `register-mcp-build` also halts for the same reason with `.claude/skills/register-mcp-servers/SKILL.md`. These are the LAST two Mode A registrar stages before the pipeline transitions to `git-agent-bootstrap` + Mode B.

Scaffolding:

- `scaffolding/23-038-skills-agent.md` — skills-audit dual-scope (design + build)
- `scaffolding/11-041-mcp-server-registration.md` — register-mcp-servers dual-scope

Both are small registrar skills. Design-scope already effectively runs at `/new-project` time (design MCPs pre-registered from `mcp-defaults-design.json`; design-stage skills shipped with the factory). What's missing is the build-scope implementations that the orchestrator actually invokes post-PM.

For mindapp-v2 and hatch, the build-scope work is near-no-op:

- `/skills-audit --scope=build` reads `architecture.yaml.tooling.skills.build[]` + confirms each has a SKILL.md on-disk OR flags as missing for follow-up
- `/register-mcp-servers --scope=build` reads `architecture.yaml.tooling.mcp_servers` and appends any build-stage entries to `.mcp.json` — typically zero entries (vendor SDKs are NPM packages, not MCP servers)

Bundling both into one plan because: same structural shape (read architecture.yaml, compare to disk state, emit registration deltas), same near-no-op behavior for MVP projects, same dry-run halt clearance purpose.

## Approach

Three phases. No runtime code (these are skill files only). No smoke test against scratch repo — the skills' effects are architecture-dependent and will be exercised during the first live Mode B run on hatch.

### Phase 1 — Two skill files + agent definition

1. Write `.claude/agents/skills-agent.md` per scaffolding L26-37:
   - `tools: Read, Write, Edit, Bash, Grep, Glob, WebSearch, WebFetch`, `model: inherit`, `maxTurns: 30`, `effort: high`
   - Body: audits whether the project has the skills/MCP servers the architecture calls for; on gap, researches + authors a stub skill file; flags for human review if research is beyond budget.
2. Write `.claude/skills/skills-audit/SKILL.md`:
   - Frontmatter: `name: skills-audit`, `allowed-tools: Read Write Edit Bash Grep Glob WebSearch WebFetch`, `argument-hint: "--scope=design | --scope=build"`
   - Reject invocations without `--scope=`
   - `--scope=design`: short-circuit with `already-provisioned-at-new-project` return (design skills + MCPs are factory-seeded; this invocation is a no-op audit). Read `.claude/skills/` + confirm shipped design skills present.
   - `--scope=build`: read `architecture.yaml.tooling.skills.build[]`; for each slug, check `.claude/skills/{slug}/SKILL.md` OR `.claude/skills/agents/{tier}/{slug}/SKILL.md`; if missing, emit warning `stack-skill-missing: {slug}` + flag in output JSON. If `--auto-author-stack-skills` flag supplied, spawn sub-research (WebSearch + WebFetch) + author stub; otherwise leave for human follow-up.
   - Emit `SkillsAuditOutput` JSON: `{ scope, missingSkills[], authoredSkills[], warnings }`. Placeholder schema in orchestrator's stages-array — accepts any `{ success: boolean }` shape for now.
3. Write `.claude/skills/register-mcp-servers/SKILL.md`:
   - Frontmatter: `name: register-mcp-servers`, `allowed-tools: Read Write Bash Grep Glob`, `argument-hint: "--scope=design | --scope=build"`
   - Reject invocations without `--scope=`
   - `--scope=design`: read `mcp-defaults-design.json` (factory seed); merge into project's `.mcp.json`; sync `mcp_servers` list in every agent's frontmatter per their `scoped_to` field in the seed. Idempotent on identical inputs.
   - `--scope=build`: read `architecture.yaml.tooling.mcp_servers[]` filtered to entries NOT already in `.mcp.json` (design-scope already registered). Append new entries + sync per-agent frontmatter. Usually zero entries.
   - Emit `McpRegisterOutput` JSON: `{ scope, registered[], skipped[], warnings }`. Same placeholder schema.

**Exit**: both skill files registered in available-skills list. Invoking either without `--scope=` returns clean rejection.

### Phase 2 — Dry-run verification on mindapp-v2

Run `pnpm generate mindapp-v2 --dry-run` to confirm:

1. `skills-audit-build` no longer shows `skill MISSING`
2. `register-mcp-build` no longer shows `skill MISSING`
3. Dry-run reports `→ skills-audit-build — skill present` + `→ register-mcp-build — skill present`
4. Halt point advances past both — only `git-agent-bootstrap` remains + any end-of-Mode-A transition logic.

Since all 12 Mode A stages' skills will be present after this plan ships, the dry-run should now report: all skills present, no halt.

**Exit**: mindapp-v2 dry-run advances cleanly through all 12 Mode A stages.

### Phase 3 — Archive

Move plan to archive/, update active.md manifest. Optionally: if time permits, also archive `scaffolding/11-041-mcp-server-registration.md` + `scaffolding/23-038-skills-agent.md` since their shipped-counterparts are now in `.claude/skills/`.

## Rejected Alternatives

- **Alternative A: Ship as two separate plans (task-010 + task-011)** — Rejected. Bundling cheapest when both skills have near-identical structure + same no-op behavior for MVP. One branch, one smoke cycle, one archive.

- **Alternative B: Full WebSearch/WebFetch auto-authoring for missing stack skills** — Rejected for this plan. Auto-authoring stack skills is non-trivial (skill needs 150-200 lines of canonical-layout + idioms + testing + commands + gotchas). For MVP, simpler to emit `stack-skill-missing` warning + leave for human. `--auto-author-stack-skills` flag present in skill args but real implementation deferred to a follow-up plan when it actually fires.

- **Alternative C: Bundle into feat-010** — Rejected. feat-010 shipped the reviewer — different concern. Grouping by "concern + timing" beats "size + timing"; these two are registrar twins.

- **Alternative D: Smoke test against scratch repo** — Rejected. The skills' effects are architecture-dependent; the only realistic exercise is the first live Mode B run against hatch. Scratch-repo smoke tests would just confirm the skill-registration contract without testing the actual registration logic end-to-end.

## Expected Outcomes

- [ ] `.claude/skills/skills-audit/SKILL.md` exists; visible in available-skills list
- [ ] `.claude/skills/register-mcp-servers/SKILL.md` exists; visible in available-skills list
- [ ] `.claude/agents/skills-agent.md` exists
- [ ] Both skills reject invocations without `--scope=`
- [ ] `--scope=design` short-circuits cleanly (already-provisioned)
- [ ] `--scope=build` reads architecture.yaml + emits delta JSON
- [ ] `pnpm generate mindapp-v2 --dry-run` shows ALL 12 Mode A stages present (zero missing skills)
- [ ] Plan archived; active.md updated
- [ ] 2 scaffolding files optionally archived if representative of shipped work

## Validation Criteria

**Skill coverage:**

- `/skills-audit` without `--scope=` → clean rejection
- `/register-mcp-servers` without `--scope=` → clean rejection
- Invalid `--scope=` values rejected

**Dry-run:**

- `pnpm generate mindapp-v2 --dry-run` output grep for `skill MISSING` returns zero
- halt message (if any) points to Mode B, not a missing skill

**No regression:**

- `pnpm test:all` green across contracts + orchestrator (149 + 112)
- Nothing in `orchestrator/` source changes
- Factory repo untouched except new skill files + optional scaffolding archive

## Attempt Log

<!-- Populated by executing agent. -->
