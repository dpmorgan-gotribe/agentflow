# multi-project-concurrency

**Deferred from**: investigate-002-build-tier-readiness-gap §Phase 4 novel concern A.

## The concern

The factory assumes one project runs end-to-end at a time. Running two pipelines concurrently from one workstation hits:

- **MCP port collisions** — `/visual-review` preflight grabs the first free port from 4173+; two concurrent runs will fight.
- **Shared API rate limits** — single Anthropic key; both runs pull from the same per-minute cap.
- **.claude/worktrees/ scope** — each project has its own worktrees dir; two projects' dirs don't collide BUT their inner `git worktree add` invocations modify the same .git registry.
- **MCP authentication tokens** — some MCPs (icons8, unsplash) are per-account; concurrent runs may hit dedup issues.
- **Cost accounting** — `perPipelineMaxUsd` is per-pipeline-run but there's no global cap across concurrent runs.

## Why deferred

Zero current projects hit this. The factory's default use-pattern is serial (one project, start to finish, then the next). The workaround today is: "stop one pipeline before starting another" — a `/new-project` warning would cover it.

## Rough shape when it's time

- Per-project MCP scoping — each `projects/<name>/.mcp.json` lives in its own port-range (e.g. project A gets 4173-4199; project B gets 4200-4226). Allocation via a central `.claude/state/port-registry.json` at factory root.
- Per-project API-key pools — `~/.claude/models.yaml.projects.<name>.anthropicKey` overrides the global default.
- Global cost cap — `~/.claude/models.yaml.globalMaxConcurrentUsd` across all active runs.
- `/new-project --allow-concurrent` flag that opts into the shared registry + per-project port allocation.

Estimated size: medium refactor — ~5 files. Not a full re-architecture; more a set of guards against the current single-run assumption.

## When to revisit

When a user's workflow requires two apps in parallel (e.g. agency shop with 10+ simultaneous client projects) OR when CI wants to run factory builds concurrently across PR previews.
