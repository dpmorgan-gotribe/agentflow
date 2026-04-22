---
id: feat-003-git-agent-worktrees
type: feature
status: draft
author-agent: human
created: 2026-04-22
updated: 2026-04-22
parent-plan: investigate-001-post-design-pipeline-architecture
supersedes: null
superseded-by: null
branch: feat/git-agent-worktrees
affected-files:
  - scaffolding/20-033-git-agent.md
  - scaffolding/21-035-orchestrator-core.md # runFeature() lifecycle integration
  - scaffolding/08-021-pm-agent.md # feature grouping heuristic
  - .claude/agents/git-agent.md # new — define the agent frontmatter
feature-area: git
priority: P1
attempt-count: 0
max-attempts: 5
---

# feat-003-git-agent-worktrees: Git-agent owns per-feature worktree lifecycle

## Problem Statement

Tasks execute against the shared main working tree today. Multiple features in `tasks.yaml` that modify the same files collide. No isolation between sibling features means parallelism is limited to stage-level (`build-web || build-mobile` at best) — cross-feature parallelism is impossible.

Closes question **Q1** of `investigate-001-post-design-pipeline-architecture`. User requested: _"Git agent will need to checkout worktree before work begins perhaps pm agent will define what work belongs to which git worktree... once work is ready the task should indicate the order of agents... once that piece has been done the next agent should pick up the work until all required agents have completed their work on the feature and then the git agent merges and finds conflicts passes back to agent to resolve or merges to main."_

Depends on **refactor-004-task-driven-orchestration** for the `features[]` schema (every feature has `worktree: <name>` + `branch: <name>` fields that this plan's git-agent consumes).

## Approach

1. **Extend PM (`scaffolding/08-021-pm-agent.md`)** with a feature-grouping heuristic:
   - Tasks sharing a dominant screen cluster (e.g. all the account-settings screens from `docs/analysis/webapp/flows.md` flow 7) merge into one feature
   - Tasks sharing a brief §11 feature ID merge into one feature
   - Tasks with no grouping signal become single-task features
   - Each feature gets an auto-generated slug from its dominant screen or brief ID
   - Each feature carries `worktree: feat-{slug}` and `branch: feat/{slug}` matching the naming convention

2. **Author the git-agent definition** at `.claude/agents/git-agent.md` (does not exist today):
   - Frontmatter: `tools: Bash, Read, Grep`
   - `mcp_servers: []` — pure git operations, no MCPs needed
   - Description: "Owns worktree lifecycle + branch management + merge-to-main + conflict routing. Invoked by orchestrator at feature boundaries, never inline inside builder/tester/reviewer work."

3. **Rewrite `scaffolding/20-033-git-agent.md`** with full worktree lifecycle. Four operations:
   - **`checkout-feature`** — `git worktree add .claude/worktrees/{slug} -b feat/{slug} origin/main`. Writes the worktree location to a lockfile at `.claude/worktrees/{slug}/.feature-context.json` with `{feature_id, branch, opened_at, agent_sequence}`.
   - **`close-feature`** — runs AFTER all agents in `agent_sequence` signal done. Performs `git -C {worktree} push origin feat/{slug}` → `git checkout main` (in main worktree) → `git merge --no-ff feat/{slug}` → on success `git worktree remove .claude/worktrees/{slug}`. On merge conflict: don't remove worktree; emit conflict event with `{ feature_id, conflicting_files[], last_writing_agent }`.
   - **`resolve-conflict-handoff`** — orchestrator-triggered re-invocation of the last writing agent with the conflict files + `.feature-context.json`. Agent re-edits. git-agent retries close-feature. Bounded retries (3).
   - **`emergency-abort`** — if a feature irrecoverably fails after all retries, git-agent destroys the worktree + deletes the branch + writes the failure reason into tasks.yaml for human review.

4. **Orchestrator integration** (extend `scaffolding/21-035-orchestrator-core.md` from refactor-004):
   - `runFeature(feature)` pseudocode now includes:
     ```
     1. git-agent checkout-feature(feature.worktree, feature.branch)
     2. for agent in feature.agent_sequence:
          run agent in worktree context (CWD=.claude/worktrees/{slug})
          on agent failure → orchestrator retry policy (max 3)
     3. git-agent close-feature(feature.worktree)
     4. on merge conflict → git-agent resolve-conflict-handoff(feature)
     5. on success → mark feature complete; unblock dependents
     ```
   - Concurrency: orchestrator runs up to `maxConcurrentFeatures` worktrees in parallel (default 4, configurable in `.claude/models.yaml` like stages' `concurrency`).

5. **Worktree location convention**: `.claude/worktrees/{slug}/` — already gitignored from step 6 of `/new-project SKILL.md`. Reuse that path. Add a README at `.claude/worktrees/README.md` explaining the directory's purpose + lifecycle (created by git-agent checkout-feature, destroyed by close-feature).

6. **Failure isolation**: a crashed feature's worktree stays on disk for forensics until `/plan-archive` on its feature removes it, OR `git-agent cleanup-stale-worktrees` reaps worktrees older than N days without recent agent activity (default 7 days).

## Rejected Alternatives

- **Alternative A: Branch-per-feature without worktrees** — Rejected. Single working tree means agents stomp on each other's uncommitted changes when orchestrator switches features. Worktrees give each feature its own directory, eliminating the collision.

- **Alternative B: One worktree per task (not per feature)** — Rejected. Tasks sharing a feature often edit the same files (backend endpoint + frontend form + test). Splitting them across worktrees forces unnecessary merge coordination within a single feature. Feature = worktree is the right scope.

- **Alternative C: Have every agent manage its own worktree** — Rejected. Scatters git knowledge across every agent + means conflict handling is duplicated 5+ places. Centralizing in git-agent keeps the rest of the system unaware of git.

## Expected Outcomes

- [ ] `.claude/agents/git-agent.md` exists with proper frontmatter + `mcp_servers: []`
- [ ] `scaffolding/20-033-git-agent.md` documents all 4 operations (checkout-feature, close-feature, resolve-conflict-handoff, emergency-abort) with CLI-level specs
- [ ] PM scaffolding (021) includes the feature-grouping heuristic + emits `worktree` + `branch` per feature in v2.0 tasks.yaml
- [ ] Orchestrator scaffolding (035) `runFeature()` pseudocode calls git-agent at feature boundaries
- [ ] `.claude/worktrees/README.md` documents the lifecycle for humans inspecting the dir
- [ ] Manual smoke test: PM produces a 2-feature tasks.yaml fixture → orchestrator dry-run invokes git-agent twice in parallel → worktrees created at `.claude/worktrees/{slug}/` → merges back cleanly when fixture agents stub their `done` signal

## Validation Criteria

**Scaffolding coherence:**

- Git-agent operations are documented as idempotent where possible (checkout-feature on an existing worktree is a no-op that reuses; close-feature after already-closed is a no-op)
- Orchestrator spec references git-agent by exact operation name; no inline `git` CLI invocations anywhere else in the pipeline

**Contract:**

- `.feature-context.json` shape is schema'd in `schemas/feature-context.schema.json` (new file)
- Conflict event shape includes `conflicting_files[]`, `last_writing_agent`, `feature_id` — enough for orchestrator to route the re-invocation

**Smoke test:**

- Build a synthetic 3-feature tasks.yaml: feature-A (backend-only), feature-B (web + backend depends_on A), feature-C (mobile-only, independent). Run orchestrator in dry-run mode. Expected: A + C start in parallel (independent); B waits on A; all three merge back to main on completion.

**Failure paths:**

- Synthetic conflict: two features edit the same file. Confirm git-agent's conflict event fires + routes to the last writing agent for re-edit. After 3 failed re-edits, emergency-abort fires.

## Attempt Log

<!-- Populated by executing agent. -->
