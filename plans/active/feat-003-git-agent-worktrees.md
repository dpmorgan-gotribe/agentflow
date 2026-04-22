---
id: feat-003-git-agent-worktrees
type: feature
status: completed
completed: 2026-04-22
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

- [x] `.claude/agents/git-agent.md` exists with proper frontmatter + `mcp_servers: []` + `effort: low` + hard rules (no force push, no history rewrite, no hook skip)
- [x] `scaffolding/20-033-git-agent.md` rewritten from "simple branch/commit agent" to "worktree lifecycle owner" — documents all **5** operations (bootstrap, checkout-feature, close-feature, resolve-conflict-handoff, emergency-abort) with CLI-level specs, idempotency guarantees, failure paths
- [x] PM scaffolding (021) includes the feature-grouping heuristic + emits `worktree` + `branch` per feature in v2.0 tasks.yaml (landed via refactor-004; verified in place)
- [x] Orchestrator scaffolding (035) `runFeature()` pseudocode calls git-agent at feature boundaries (landed via refactor-004; pseudocode references all 5 ops by name)
- [x] `.claude/worktrees/README.md` documents the lifecycle for humans inspecting the dir (4 status values, manual recovery procedures, config pointers)
- [x] `schemas/feature-context.schema.json` authoritative (Draft-07 JSON Schema; 10 required fields + status enum)
- [x] Zod mirror for `FeatureContext` + `GitAgentOutput` discriminated union added to 034b scaffolding
- [ ] Manual smoke test: PM produces a 2-feature tasks.yaml fixture → orchestrator dry-run invokes git-agent twice in parallel → worktrees created at `.claude/worktrees/{slug}/` → merges back cleanly when fixture agents stub their `done` signal — **deferred to post-orchestrator-runtime (task 035 body)**

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

### Attempt 1 — 2026-04-22 · Scaffolding + agent + schema landed

**Scope:** scaffolding spec-only (no runtime yet — runtime is orchestrator task 035's body).

**Files created:**

- `.claude/agents/git-agent.md` (NEW) — agent definition with `effort: low`, `mcp_servers: []`, hard-rules block (no force-push, no history rewrite, no hook skip, no `.env` read), 5-op invocation contract, idempotency notes, output JSON discriminated on `op`
- `schemas/feature-context.schema.json` (NEW) — Draft-07 JSON Schema for `.feature-context.json` lockfile. 10 required fields (version, feature_id, worktree, branch, opened_at, opened_from, agent_sequence, agent_history, last_writing_agent, status). 4-state lifecycle enum (open → merge-conflict / closed / aborted). Kebab-case regexes on ids. Conflict-metadata fields (conflict_files, conflict_detected_at, merge_sha, failure_reason) populated as lifecycle progresses.
- `.claude/worktrees/README.md` (NEW) — human-facing directory lifecycle doc. Walks through open / merge-conflict / closed / aborted states; manual recovery procedures (`git worktree remove --force` + `git branch -D` as last resort); configuration pointer to `.claude/models.yaml stages.feature-graph`.

**Files updated:**

- `scaffolding/20-033-git-agent.md` — rewritten from the pre-refactor-001 "simple branch+commit agent" stub (70 lines) to the refactor-004-aligned worktree-lifecycle owner (full spec ~500 lines). 5 ops fully specified: **bootstrap** (Mode A's final stage, validates clean main), **checkout-feature** (opens worktree + writes lockfile, idempotent on matching feature_id), **close-feature** (`git merge --no-ff` + conflict detection), **resolve-conflict-handoff** (no git ops itself; updates lockfile + returns context), **emergency-abort** (force-remove + mark feature failed in tasks.yaml). Per-op acceptance criteria + human verification scenarios (happy path, conflict path, emergency path, cleanup path).
- `scaffolding/09-034b-output-contract-zod-schemas.md` — added `feature-context.ts` section (Zod mirror of FeatureContextSchema + FeatureContextHistoryEntry + FeatureContextAgentOp) + `git-agent.ts` section (GitAgentOutput discriminated union on `op` with 8 variants covering bootstrap success/fail, checkout-feature success/fail, close-feature success-no-conflict vs fail-with-conflict, resolve-conflict-handoff, emergency-abort). Index.ts re-exports both.

**Files already in place (landed via refactor-004, verified in this attempt):**

- `scaffolding/08-021-pm-agent.md` §Feature-grouping heuristic — 5-rule grouping (shared flow ID / brief §11 / architecture integration / no-signal single-task / auto-generated slug)
- `scaffolding/21-035-orchestrator-core.md` §Feature-graph phase + `runFeature()` pseudocode references git-agent operations by exact name (invokeAgent("git-agent", { op: "checkout-feature" }), etc.)

**Deferred (explicit):**

- Task 035 runtime `orchestrator/index.ts` — refactor-004 + feat-003 complete the SCAFFOLDING for feature-graph; the TypeScript implementation lives in task 035's body which is a separate plan.
- Smoke test on a synthetic 2-/3-feature fixture — needs runtime orchestrator to drive git-agent through its ops. Spec-level verification (every op has CLI commands + return-JSON shape) is complete.
- `cleanup-stale-worktrees` off-band housekeeping op — spec'd in 20-033; `justfile` target addition deferred.

**Ready to mark completed.**
