---
id: feat-018-mode-b-commit-discipline
type: feature
status: in-progress
approved-at: 2026-04-24
approved-by: human
author-agent: claude-opus-4-7
created: 2026-04-24
updated: 2026-04-24
parent-plan: feat-014-mvp-completion-autonomous-e2e
supersedes: null
superseded-by: null
branch: feat/mode-b-commit-discipline
affected-files:
  # Phase A — auto-commit per task in invoke-agent
  - orchestrator/src/invoke-agent.ts
  - orchestrator/src/feature-graph.ts
  - orchestrator/tests/invoke-agent.test.ts
  - orchestrator/tests/feature-graph.test.ts
  # Phase B — close-feature defensive commit + abort-on-empty-merge
  - orchestrator/src/invoke-agent.ts
  # Phase C — observations from feat-014 Phase 4 smoke run
  - docs/mvp-completion-report.md # new (Phase 4 evidence)
  - docs/build-tier-roadmap.md # append observations
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-018 — Mode B commit discipline

## Problem Statement

feat-014 Phase 4's first live Mode B run on revolution-pictures uncovered a **silent factory contract gap**: build agents produce real code via the SDK, but **never `git commit`** their work to the feature branch. When git-agent's close-feature merges feat/<id> into main, the merge is a no-op (both at the same SHA). The orchestrator marks the feature "completed" because `git merge --no-ff` returns success ("already up-to-date"), but no work has actually reached `main`. The worktree directory contains the produced files; they're orphaned the moment the worktree is removed.

Concrete evidence from the smoke run (commit `bmjfb62le`, 2026-04-24 ~21:46-22:30):

- `feat/cms-content-model` worktree has `apps/web/sanity-schemas/` with 7 schema files + index + tests authored by `web-frontend-builder`
- `git log feat/cms-content-model --oneline -1` → `b820b09` (same as main)
- Orchestrator return: `{ status: "completed", taskOutcomes: { ... "completed" }, costUsd: > 0 }`
- Reality: zero commits on the feature branch; close-feature's merge to main is a no-op

The root cause spans three places:

1. **`orchestrator/src/invoke-agent.ts::runLlmAgent`** — when an LLM agent (builder/tester/reviewer/security/devops) reports task success via `taskStatus: { ... "completed" }`, the orchestrator records it but doesn't stage or commit the worktree changes. The agent's prompt (Phase 1's `runLlmAgent` builder) tells the agent to "execute your skill" + "return a final JSON" but never instructs them to `git add . && git commit`.

2. **`orchestrator/src/invoke-agent.ts::handleCloseFeature`** — the close-feature git-op runs `git merge --no-ff <branch>` against main. If the branch has no new commits, the merge is "Already up to date." → success → schema-valid `CloseFeatureSuccess`. There's no guard against "feature branch === main HEAD" (which would be the signal that nothing was committed).

3. **Stack skills** (`.claude/skills/agents/{tier}/{slug}/SKILL.md`) — none instruct the agent to commit on task completion. They cover code patterns + testing but assume git discipline lives elsewhere.

This gap was masked in the Phase 0 smoke test because I (the human-in-the-loop) committed the work by hand from the outer session. Mode B has no human in the loop; the gap surfaces immediately.

Reference: `plans/active/feat-014-mvp-completion-autonomous-e2e.md` Phase 4 — the run produced the evidence; this plan closes the gap.

## Approach

Two phases — small, focused. Plus a Phase C documentation trailer.

### Phase A — Auto-commit per successful task

Goal: every task that completes successfully in the LLM-agent path produces a git commit on the feature branch with a deterministic message. Failures don't commit (preserves worktree dirty for retry context).

1. **`orchestrator/src/feature-graph.ts::runFeature`** — between the LLM-agent invocation and the next iteration of `agent_sequence`, when `result.taskStatus[<task>] === "completed"`:
   - Run `git add -A` then `git commit -m "<task-id>: <task summary first 60 chars>" -m "Co-Authored-By: <agent> via orchestrator"` from inside the worktree (using a new helper `commitWorktreeChanges(cwd, message)` exported from `invoke-agent.ts` — same `execGit` test hook).
   - On clean tree (`git status --porcelain` empty), skip the commit (no-op tasks legitimately exist).
   - On commit failure (e.g. nothing to commit error), log a warning but don't fail the task.

2. **Helper `commitWorktreeChanges(cwd, message, execGit?)`** in `orchestrator/src/invoke-agent.ts`:

```ts
async function commitWorktreeChanges(
  cwd: string,
  message: string,
  exec: ExecGitFn = execGitDefault,
): Promise<{ committed: boolean; sha?: string; warning?: string }> {
  const status = await exec("status --porcelain", cwd);
  if (status.stdout.trim() === "") return { committed: false };
  const add = await exec("add -A", cwd);
  if (add.code !== 0)
    return { committed: false, warning: `git add failed: ${add.stderr}` };
  const commit = await exec(`commit -m ${shellQuote(message)}`, cwd);
  if (commit.code !== 0)
    return { committed: false, warning: `git commit failed: ${commit.stderr}` };
  const rev = await exec("rev-parse HEAD", cwd);
  return { committed: true, sha: rev.stdout.trim() };
}
```

3. **Tests** in `orchestrator/tests/invoke-agent.test.ts`:
   - `commitWorktreeChanges` with clean tree returns `committed: false`, no error
   - With dirty tree → calls `add -A` + `commit -m` + `rev-parse HEAD`; returns `{ committed: true, sha }`
   - With `add` failure → returns `{ committed: false, warning }`, no throw
   - Shell-quote test: messages with `"` / `$` / backticks don't break the commit

4. **Tests** in `orchestrator/tests/feature-graph.test.ts`:
   - When task succeeds, `runFeature` calls `commitWorktreeChanges` once with the right message
   - When task fails, no commit attempt
   - When all tasks succeed, end-of-feature has N commits on the branch

### Phase B — close-feature defensive checks

Goal: detect and surface the "no work to merge" failure mode loudly, instead of silently no-op'ing.

5. **`orchestrator/src/invoke-agent.ts::handleCloseFeature`** — before merging:
   - `git rev-parse main` and `git rev-parse <branch>` (both from the worktree's parent project)
   - If they're equal AND `git status --porcelain` is non-empty in the worktree → return failure: `{ op: "close-feature", success: false, conflict: false, reason: "feature-no-commits", worktreePath, dirtyFiles: [...] }`
   - If they're equal AND clean → log a warning ("feature branch had no new commits — likely a no-op feature"), proceed with merge (which will succeed as already-up-to-date), return success
   - Otherwise proceed normally

6. **Schema update** in `packages/orchestrator-contracts/src/git-agent.ts` — add `feature-no-commits` to the close-feature failure-reason enum (small additive change; doesn't break existing tests).

7. **Tests** — assert close-feature returns the new failure reason when the branch has no commits AND the tree is dirty (the diagnostic case Phase A is meant to prevent).

### Phase C — Documentation + evidence

8. **Author `docs/mvp-completion-report.md`** with the Phase 4 evidence:
   - Timestamps + cost ($0.69 Mode A; ~$X Mode B from final run output)
   - What worked (orchestrator dispatch, SDK auth, worktrees, file generation)
   - What didn't (commit discipline gap)
   - Per-feature outcomes from final run
   - Lessons + the patches feat-018 ships

9. **Append §MVP Exit Record (partial)** to `docs/build-tier-roadmap.md`:
   - Date + project (revolution-pictures)
   - Cost summary
   - Exit-criteria status: 8 of 10 met; "feature merged to main autonomously" deferred to feat-018 + re-run
   - Pointer to feat-018 + this plan

### Testing at each stage

| Phase | Stage                            | Mechanism                                            | Pass criteria                                                                            |
| ----- | -------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| A     | commitWorktreeChanges            | Vitest with execGit stub                             | 4 paths: clean / dirty-success / add-fail / commit-fail                                  |
| A     | runFeature commit-on-task        | Vitest with stub feature + 2 tasks                   | After 2 successful tasks, branch has 2 commits                                           |
| A     | Skip commit on task failure      | Vitest                                               | Failed task → no commit on branch                                                        |
| B     | close-feature feature-no-commits | Vitest + git fixture repo                            | Returns the new reason when branch === main + dirty                                      |
| B     | Schema additive                  | Existing tests                                       | All previously-passing tests still pass                                                  |
| B+C   | End-to-end re-run                | revolution-pictures Mode B (subscription budget $15) | feat-cms-content-model commits land on main; orchestrator reports `mergeSha != mainPrev` |

## Rejected Alternatives

### Alternative A: Make stack skills + agent prompts do the commit, not the orchestrator

**Why rejected**: Each stack skill would need separate commit instructions (8+ vendor skills × 5+ stack skills = lots of duplication). One agent forgetting the commit would silently break the pipeline. Centralizing commit discipline at the orchestrator layer means it's enforced once + can't drift. Builders + testers + reviewers focus on their work; commit is infra.

### Alternative B: Have close-feature do `git add . && git commit` on dirty trees before merging

**Why rejected**: Loses per-task commit granularity (one fat commit per feature instead of one per task). Per-task commits are useful for `git bisect`, blame, + audit trails when something breaks downstream. Phase A's per-task commit is the right grain.

### Alternative C: Commit on the next agent's invocation start (instead of after this agent's success)

**Why rejected**: Coupling commit timing to the next agent's start (vs the previous one's success) creates ambiguity when the next agent doesn't run (e.g. last agent in agent_sequence). Tying commit to task-success is unambiguous + symmetric.

### Alternative D: Defer this fix; revolution-pictures' uncommitted work is fine for a smoke test

**Why rejected**: Without this fix, every Mode B run on every project produces hollow "completed" features. The smoke test signal is already there (orchestrator dispatch works) — but every project we test will hit the same wall. Fix the gap before testing more projects.

## Expected Outcomes

- [ ] `commitWorktreeChanges` exported from `invoke-agent.ts`; covers the 4 test paths
- [ ] `runFeature` calls it after every successful task; produces N commits on the feature branch (one per task) before close-feature
- [ ] close-feature detects + surfaces `feature-no-commits` for the diagnostic case
- [ ] `pnpm --filter orchestrator test` passes all suites (currently 187; expecting +6-8 new tests)
- [ ] revolution-pictures re-run produces real commits on feature branches; main moves past `b820b09`
- [ ] `docs/mvp-completion-report.md` exists with Phase 4 evidence
- [ ] `docs/build-tier-roadmap.md` has §MVP Exit Record (partial)

## Validation Criteria

- **Typecheck + tests**: `pnpm -r typecheck && pnpm -r test` clean
- **Live re-run**: `/start-build revolution-pictures --resume-feature-graph --max-concurrent=1` produces ≥1 feature with non-empty merge to main; `git log main -10` shows feature merge commits
- **Backwards compat**: existing 187 tests still pass; the schema addition is additive
- **Cost**: re-run on revolution-pictures stays under $15 budget cap

## Attempt Log

<!-- Executing agent fills this in as attempts complete. -->

## References

- `plans/active/feat-014-mvp-completion-autonomous-e2e.md` Phase 4 — produced the evidence
- `orchestrator/src/invoke-agent.ts` — Phase 1 of feat-014 shipped the LLM-agent path; this plan extends it
- `orchestrator/src/feature-graph.ts::runFeature` — where task-by-task iteration lives
- `packages/orchestrator-contracts/src/git-agent.ts` — `GitAgentOutput` zod (schema-additive change)
- Phase 4 smoke run output: `tasks/bmjfb62le.output`
