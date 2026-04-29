---
id: feat-034-devops-agent
type: feature
status: draft
author-agent: claude-opus-4-7
created: 2026-04-29
updated: 2026-04-29
parent-plan: null
supersedes: null
superseded-by: null
branch: feat/devops-agent
affected-files:
  - .claude/agents/devops.md
  - .claude/skills/agents/devops/github-actions/SKILL.md
  - .claude/skills/agents/devops/vercel/SKILL.md
  - .claude/skills/agents/devops/fly-io/SKILL.md
  - .claude/models.yaml
  - ~/.claude/models.yaml
  - .claude/skills/pm/SKILL.md
  - .claude/skills/architect/SKILL.md
feature-area: orchestration
priority: P1
attempt-count: 0
max-attempts: 5
---

# feat-034 — Ship the missing `devops` agent + 3 deploy stack skills

## Problem Statement

The PM agent that wrote `projects/repo-health-dashboard-01/docs/tasks.yaml`
recruited an agent named `devops` for `feat-deploy-pipeline`'s 4 tasks
(`gha-ci-pipeline`, `vercel-deploy`, `fly-deploy`, `smoke-test`) — but
the factory ships no such agent. Discovered live during the
2026-04-29 Mode B run:

```
[runLlmAgent] agent 'devops' not configured: No model resolved for agent 'devops'.
              Skipping 4 task(s) and continuing agent_sequence.
[runFeature] auto-commit warning for feat-deploy-pipeline/devops: git commit failed:
```

The orchestrator's graceful-skip-unknown-agent path (bug-010 archived
2026-04-27) correctly degraded — the run continues, no crash. But
the consequence is real: every deploy-pipeline task is silently
no-op'd. CI workflows, Vercel config, Fly.io config, smoke tests —
none get authored.

The 12 agents currently shipped in `.claude/agents/` cover design +
build + test + review + git, but no deployment / infra automation
tier:

```
analyst, architect, backend-builder, git-agent,
mobile-frontend-builder, project-manager, reviewer, security,
skills-agent, tester, ui-designer, web-frontend-builder
```

PMs that read project briefs requesting CI + deploy will continue to
recruit `devops` (it's the obvious name) and continue to silently
skip. Either we ship the agent, or we strip CI/deploy from PM's
recruitable set (worse — projects do need this).

## Approach

Stack-agnostic agent following the pattern of backend-builder /
web-frontend-builder / mobile-frontend-builder: the agent reads
`.claude/architecture.yaml.tooling.stack.deploy_target` and
dispatches to a matching stack skill at
`.claude/skills/agents/devops/{stack-slug}/SKILL.md`.

### Phase A — Author `.claude/agents/devops.md`

Mirror the structure of `.claude/agents/backend-builder.md`:

```yaml
---
name: devops
description: Stack-agnostic deployment + CI/CD agent. Reads architecture.yaml.tooling.stack.deploy_target (or per-task .stack hint), dispatches to the matching stack-skill at .claude/skills/agents/devops/{stack-slug}/SKILL.md. Authors CI workflow YAML, deployment configs (Vercel / Fly / Render / Docker), and smoke-test scripts. Stays inside the feature worktree like other builders.
tools: Read, Write, Edit, Bash, Grep, Glob
model: inherit
permissionMode: acceptEdits
maxTurns: 30
effort: high
---
```

System prompt content:

- §Stack-agnostic by design (mirror backend-builder lines 17-23)
- §Worktree CWD awareness (mirror lines 26-40)
- §Output contracts: emit BuilderOutput-shaped JSON (taskOutcomes +
  errors via sentinels) — same as other builders. Per-task
  conventional-commit messages (`ci: <summary>` / `chore: <summary>`
  / `feat: <summary>` per task type).
- §Per-task type expectations: CI workflow tasks emit
  `.github/workflows/*.yml`; deploy-config tasks emit
  `vercel.json` / `fly.toml` / `Dockerfile` etc.; smoke-test tasks
  emit either curl-based scripts in `scripts/smoke-*.sh` OR
  Playwright `*.smoke.spec.ts` per the architecture's preferred
  test runner.
- §Boundaries: the agent does NOT push to remote branches, does NOT
  invoke deployment platforms (no `vercel deploy` from inside the
  agent — the GHA workflow does that on push). Pure
  config-and-script authorship.
- §Error path: if `architecture.yaml.tooling.stack.deploy_target` is
  null OR the matching stack-skill is missing, exit with
  `stack-skill-missing; run /skills-audit --scope=build --auto-author-stack-skills`.

### Phase B — Author 3 deploy stack skills

Pick the 3 deploy targets the existing repo-health-dashboard-01 +
likely future projects need:

1. **`.claude/skills/agents/devops/github-actions/SKILL.md`** —
   GHA CI for Node + Python monorepos. Outputs:
   - `.github/workflows/ci.yml` (lint + typecheck + test on PR)
   - `.github/workflows/deploy.yml` (deploy on main push;
     downstream-vendor-specific)
   - Cache + matrix strategy for monorepo packages
2. **`.claude/skills/agents/devops/vercel/SKILL.md`** —
   Vercel deployment config for Next.js + static sites:
   - `vercel.json` with build command + output directory
   - Project env-var checklist (read from `.env.example`)
   - Smoke-test pattern (curl `/api/health` post-deploy)
3. **`.claude/skills/agents/devops/fly-io/SKILL.md`** —
   Fly.io for Python/FastAPI / Node servers:
   - `fly.toml` with regions + scaling rules
   - `Dockerfile` per the app's runtime
   - `fly deploy` invocation pattern (in GHA, not from the agent)

Each stack skill mirrors the §Canonical layout, §Idioms, §Testing,
§Commands, §Gotchas, §Dependency pins, §Testing-policy-coverage
sections that backend stack skills already use (per
`.claude/rules/testing-policy.md`).

### Phase C — Wire `devops` into `~/.claude/models.yaml`

```yaml
agents:
  ...
  devops:                  { tier: building, effort: high }
```

`tier: building` because devops authorship is config + script
generation — same complexity class as other builders. Effort `high`
because deploy mistakes cost real money + downtime.

### Phase D — PM + Architect awareness

1. Update `.claude/skills/pm/SKILL.md`: add `devops` to the
   recruitable-agents list. Document when to use it (any project
   with a deploy target in `architecture.yaml`). PM was already
   doing this implicitly; making it explicit closes the doc gap.
2. Update `.claude/skills/architect/SKILL.md`: when emitting
   `architecture.yaml`, include
   `tooling.stack.deploy_target: <github-actions+vercel | github-actions+fly-io | docker-compose | none>`.
   Without this field, devops has nothing to dispatch on and the
   `null → exit clean` path fires.

### Phase E — Validation against repo-health-dashboard-01

After this ships, manually re-dispatch `feat-deploy-pipeline` on
the repo-health-dashboard-01 run (or just leave it for the next
project's run). Expected:

- `vercel-deploy` task → `apps/web/vercel.json` authored
- `fly-deploy` task → `apps/api/fly.toml` + `apps/api/Dockerfile`
  authored
- `gha-ci-pipeline` task → `.github/workflows/ci.yml` +
  `deploy.yml` authored
- `smoke-test` task → `scripts/smoke-deploy.sh` (curl-based) OR
  `apps/web/e2e/smoke.spec.ts` (Playwright) authored
- All 4 tasks complete; reviewer approves; close-feature merges.

## Rejected Alternatives

- **Strip CI/deploy from PM's recruitable set** — Rejected. CI
  - deploy are real-world requirements; muting them would push the
    burden to the operator, who'd then need to author CI manually for
    every shipped project. The factory should ship the capability.
- **Author CI/deploy inline in backend-builder + web-frontend-builder**
  — Rejected. Separation of concerns: a frontend builder shouldn't
  know how to author Fly.io configs; a backend builder shouldn't
  know GHA workflow YAML. Stack-agnostic devops is the right
  surface.
- **Fold this into feat-021 (PM agent-availability + agent-change-request)**
  — Rejected. feat-021 is the long-term mechanism for handling
  ANY missing agent generically (PM detects gap → AgentChangeRequest
  → `agent-expert` authors → operator approves). feat-034 is the
  specific ship of the devops agent NOW so future runs don't no-op.
  Both can ship; feat-021 retroactively covers feat-034 as one of
  its consumers.
- **Use a single monolithic devops skill instead of 3 stack-skills**
  — Rejected. Stack-agnosticism is core to the factory's design;
  bundling GHA + Vercel + Fly into one skill would force operators
  who use a different deploy target (Render, Railway, AWS, …) to
  fork the whole skill. Per-stack skills compose naturally.

## Expected Outcomes

- [ ] `.claude/agents/devops.md` exists with frontmatter +
      stack-dispatch system prompt
- [ ] 3 stack skills authored under
      `.claude/skills/agents/devops/{github-actions,vercel,fly-io}/SKILL.md`
- [ ] `~/.claude/models.yaml` (factory) and
      `.claude/models.yaml` (project template) include `devops:`
      tier mapping
- [ ] PM SKILL.md + architect SKILL.md updated to surface
      `devops` + `deploy_target` field
- [ ] re-dispatched `feat-deploy-pipeline` on a project produces
      4 successful tasks + reviewer approval
- [ ] No regressions in 567/567 existing orchestrator tests

## Validation Criteria

1. **Smoke-test the agent**: spin up a tiny test project, set
   `architecture.yaml.tooling.stack.deploy_target: github-actions+vercel`,
   dispatch devops with a mock `gha-ci-pipeline` task, assert
   `.github/workflows/ci.yml` is authored.
2. **Stack-skill-missing path**: dispatch devops with
   `deploy_target: aws-cloudfront` (not shipped), assert exit
   message matches `stack-skill-missing; run /skills-audit ...`.
3. **PM round-trip**: re-run PM agent on
   repo-health-dashboard-01's brief, assert it still recruits
   `devops` for feat-deploy-pipeline AND the agent now resolves
   to a model.
4. **Coverage**: ≥ 80% line coverage on touched files per
   `.claude/rules/testing-policy.md` (skills are markdown; the
   agent prompt has no test surface — coverage applies only if we
   add helper scripts).

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->
