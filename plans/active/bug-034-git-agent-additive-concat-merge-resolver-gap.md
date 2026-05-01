---
id: bug-034-git-agent-additive-concat-merge-resolver-gap
type: bug
status: draft
author-agent: human
created: 2026-05-01
updated: 2026-05-01
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/git-agent-additive-concat-resolver
affected-files:
  - .claude/agents/git-agent.md
  - .claude/skills/git-agent/SKILL.md
  - orchestrator/src/feature-graph.ts
  - orchestrator/src/git-agent-runner.ts
  - .claude/templates/dev-multi-tier.mjs.template
  - .claude/skills/agents/back-end/node-fastify/SKILL.md
  - .claude/skills/agents/back-end/python-fastapi/SKILL.md
  - .claude/skills/agents/back-end/node-trpc-nest/SKILL.md
feature-area: orchestrator/git-agent
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "feat-transactions-crud — merge-conflict exhausted after 3 attempts; emergency-abort fired"
reproduction-steps: "Run /start-build on any project with ≥2 parallel features that each register a route in apps/api/src/app.ts and add a barrel export to packages/types/src/index.ts. The first to merge succeeds; the second hits CONFLICT (content) on both files; auto-resolver retries 3× without progress; emergency-abort destroys the work."
stack-trace: null
---

# bug-034: git-agent auto-resolver cannot handle additive same-region merge conflicts in central registration files

## Bug Description

The orchestrator's git-agent close-feature step calls `git merge --no-ff feat/<name>` to fold each feature's branch into master. When two features both add lines to the same region of a shared registration file (e.g. each registers its own route in `apps/api/src/app.ts`, each exports its own type from `packages/types/src/index.ts`), git emits `CONFLICT (content)` because the 3-way merge cannot algorithmically decide whether to take "ours", "theirs", or concat. The git-agent's auto-resolver retries the same heuristic 3 times, then fires `emergency-abort` — which deletes the feature branch, removes worktree source files, and cascade-aborts every dependent feature in the DAG.

This is **structurally guaranteed to recur** on every project where ≥2 parallel features each touch a central registration file. The pattern surfaced live during the 2026-05-01 finance-track-01 launch:

- **Successful merges (5)**: feat-db-schema-migrations → feat-test-seed-endpoint, feat-accounts-crud, feat-json-export-backend, feat-fx-cache-frankfurter (each was the FIRST to land its lines in `app.ts` + `packages/types/src/index.ts`).
- **Failed merge (1)**: feat-transactions-crud → reviewer approved, then merge hit CONFLICT on `apps/api/src/app.ts` (both fx + transactions branches added new `app.register(...)` calls) AND `packages/types/src/index.ts` (both added new barrel exports). 3 retries, then emergency-abort.
- **Cascade-aborted (10)**: reports-aggregation, csv-import-backend, spa-shell-dashboard, accounts-ui, transactions-ui, reports-ui, csv-import-ui, json-export-ui, runner, acceptance-suite. None did any work — pure DAG cascade from the transactions-crud failure.

Project-side recovery is documented in `projects/finance-track-01/plans/active/bug-002-transactions-crud-merge-conflict-recovery.md` (manual concat-resolve from the dangling commit). This factory-side plan addresses the underlying gap so the pattern doesn't recur on every Mode B run.

## Reproduction Steps

1. Bootstrap any project with `/start-build` whose `tasks.yaml` has ≥2 P0 features that:
   - Each register a new fastify (or express, fastapi) route in a central application entrypoint via `app.register(...)` / `app.use(...)` / `app.include_router(...)`.
   - Each add a new export line to `packages/types/src/index.ts` via `export * from "./<domain>"`.
2. Wave-1 feature merges cleanly (no conflict — first to land its lines).
3. Wave-2 (or later) feature's merge attempt hits two `CONFLICT (content)` failures in the same files.
4. `[runCloseFeature] feature feat-X: lockfile auto-resolve attempt.` runs.
5. `[lockfile-auto-resolve] no lockfile conflicts detected — skipping`.
6. Same merge fails identically on retry. After 3 attempts: `emergency-abort fired`.
7. Observe: dangling commit (recoverable) + deleted feature branch + deleted worktree source + cascade-aborted dependents.

Empirical case 1 (this session, 2026-05-01): finance-track-01 / feat-transactions-crud → conflict on `apps/api/src/app.ts` + `packages/types/src/index.ts`. ~5 minutes of agent work lost (recoverable from dangling commit) + 10 cascade-aborted features (no work done).

## Error Output

```
[runCloseFeature] feature feat-transactions-crud: merge failed.
conflictingFiles: apps/api/src/app.ts, packages/types/src/index.ts
merge stderr: (empty)
merge stdout: Auto-merging apps/api/src/app.ts
CONFLICT (content): Merge conflict in apps/api/src/app.ts
Auto-merging packages/types/src/index.ts
CONFLICT (content): Merge conflict in packages/types/src/index.ts
Automatic merge failed; fix conflicts and then commit the result.

merge err.message: git command failed: git merge --no-ff feat/transactions-crud -m "merge feat/feat-transactions-crud"

✗ feat-transactions-crud — merge-conflict exhausted after 3 attempts; emergency-abort fired
✗ feat-reports-aggregation — dependency feat-transactions-crud failed
✗ feat-csv-import-backend — dependency feat-transactions-crud failed
... [9 cascade-aborted features]
```

## Root Cause Analysis

### Surface failure

`git merge --no-ff feat/<name>` reports `CONFLICT (content)` whenever both sides modified textually-overlapping lines in a shared file. The auto-resolver currently has no rule for the **additive same-region concat** case — both sides ADDED new lines (no deletes, no modifications to existing lines), and the correct resolution is "keep both additions in stable order".

### Why it recurs structurally

Every project with a central registration pattern hits this. Three load-bearing files in shipped stack skills exhibit the pattern:

1. **`apps/api/src/app.ts`** (node-fastify + node-trpc-nest skills, similar in python-fastapi) — every feature adds `app.register(routes, { prefix: "/api/<domain>" })`.
2. **`packages/types/src/index.ts`** — every feature adds `export * from "./<domain>"`.
3. **(Likely) `apps/web/src/routes/index.ts` or `apps/web/src/App.tsx`** — every UI feature adds a `<Route path="/<domain>" />` registration.

The auto-resolver's current behavior is `git merge --no-ff` + retry-on-failure with no semantic awareness, so any conflict in these files is a guaranteed emergency-abort.

### Two non-overlapping fix surfaces

**Surface A — teach the resolver concat semantics** (Phase A below):
Add a "additive concat" auto-resolver as the first attempt before the existing strategies. For each conflict hunk, check: are both `<<<<<<<` and `>>>>>>>` segments NEW lines added (no lines deleted from common ancestor, no lines modified)? If yes, concat both segments and write the merged file. Re-run `git add <file>` on success. If the heuristic doesn't apply (genuine modify-modify or modify-delete), fall through to existing strategies.

**Surface B — restructure scaffolds to avoid central registration files** (Phase B):
Replace the central `app.register(...)` block with a filesystem-discovery loop:

```ts
// apps/api/src/app.ts
import { discoverRoutes } from "./routes/_discover.js";
...
await discoverRoutes(app);
```

Where `_discover.ts` walks `apps/api/src/routes/**/*.routes.ts` and registers each one with a derived prefix. Same pattern for `packages/types/src/index.ts` — replace explicit barrel re-exports with a per-domain TS pattern (e.g. each domain in its own subdirectory; consumers import from `@repo/types/accounts` rather than `@repo/types`). This eliminates the conflict by eliminating the shared file. More invasive, but the long-term right answer.

The plan ships **both** — Surface A as immediate harm reduction (1 PR, days of work), Surface B as the structural fix (multi-PR, weeks of stack-skill rewrites + per-project migrations).

## Fix Approach

### Phase A — additive-concat resolver in git-agent (P0, immediate)

1. **Locate the merge-conflict handling** in `orchestrator/src/feature-graph.ts` + `orchestrator/src/git-agent-runner.ts`. Confirm where `runCloseFeature` triggers the merge + reads `git merge` exit code + extracts conflicting files.
2. **Add `tryAdditiveConcatResolve(conflictingFile)` helper** that:
   - Reads the file with conflict markers.
   - Splits at each `<<<<<<<` / `=======` / `>>>>>>>` block.
   - For each conflict block, checks: is this block additive-only? (heuristic: the lines outside the block were unchanged from common ancestor; both sides only INSERTED lines into the block, no shared lines were modified or deleted.)
   - If additive: write `<ours-block>\n<theirs-block>` (both sets of additions, ours first for stable ordering).
   - If not additive (mixed insert/delete/modify): leave conflict markers in place + return `false` for this file.
   - Stage the file with `git add <file>` if all blocks resolved.
   - Return `{ ok: true, resolvedFiles: [], unresolvedFiles: [] }` for the orchestrator to evaluate.
3. **Wire into the merge retry loop** in `runCloseFeature`:
   - On `git merge` failure: try `tryAdditiveConcatResolve` for each conflicting file as **attempt 1**.
   - If all conflicts resolved: `git commit --no-edit` to seal the merge; mark success.
   - If some unresolved: fall through to existing retry strategy (currently a no-op repeat) for **attempts 2-3**.
   - On final exhaustion: `emergency-abort` as today.
4. **Add unit tests** in `orchestrator/tests/git-agent.test.ts`:
   - Test fixture: 2 feature branches that each add a `import` + `app.register(...)` line to a shared `app.ts`. Merge first cleanly, then merge second; assert `tryAdditiveConcatResolve` produces a file with BOTH imports + BOTH registrations in deterministic order.
   - Test fixture: 2 feature branches that each add a `export * from "./<domain>"` to a `packages/types/src/index.ts`. Same assertion.
   - Negative test: a feature branch that DELETES a line both features modified — heuristic must correctly detect non-additive and leave conflict markers in place.
   - Heuristic-confidence test: a feature branch that adds NEW lines but ALSO modifies an existing line in the same conflict block — must fall through to non-additive path, NOT silently corrupt the file.
5. **Document the resolver** in `.claude/agents/git-agent.md` + `.claude/skills/git-agent/SKILL.md`:
   - New §"Additive concat auto-resolution" section explaining when the resolver fires, the heuristic, the failure modes.
   - Cross-reference bug-034 for the empirical motivation.

### Phase B — per-feature route discovery (P1, structural)

6. **Update node-fastify SKILL.md** (`.claude/skills/agents/back-end/node-fastify/SKILL.md`):
   - §1 Canonical layout: replace explicit `app.register(...)` block with `await discoverRoutes(app)`.
   - Ship `apps/api/src/routes/_discover.ts.template` that walks `routes/*.routes.ts` + registers each.
   - §5 Gotchas: note that route files MUST export named `<domain>Routes` (Plugin) + each file owns its prefix.
7. **Update python-fastapi SKILL.md** equivalently — `app.include_router(...)` pattern → directory scanner via `pkgutil.iter_modules`.
8. **Update node-trpc-nest SKILL.md** — Nest already does module-level discovery via `@Module({ imports: [...] })`, but the `imports[]` array is the equivalent shared file. Either (a) document that the additive-concat resolver covers it, or (b) split into per-domain feature modules with auto-discovery.
9. **Update `packages/types/src/index.ts` convention** — instead of one barrel, ship per-domain barrels: `@repo/types/accounts`, `@repo/types/transactions`, etc. Consumers import the specific surface they need. Refresh the new-project scaffold + reference example projects.
10. **Migration plan for in-flight projects** — finance-track, finance-track-01, book-swap, book-swap-pre-build, repo-health-dashboard-01 (which is already shipped — exempt) all need a one-time migration. Document in a follow-up refactor plan once Phase B lands.

### Phase C — orchestrator state-fixup capability (P2, operator ergonomics)

11. **Ship `/orchestrator-state-fixup` skill** that lets the operator surgically edit `feature-graph-progress.json` to:
    - Move a feature from `failed[]` → `completed[]` (after manual recovery).
    - Clear `aborted[]` so dependents are re-evaluated on the next resume.
    - Emit a structured audit-log entry recording who edited what, why.
      This eliminates the raw-JSON-edit step in bug-002's recovery recipe.

## Rejected Fixes

- **Just retry the merge with a longer backoff** — Rejected: the conflict is deterministic, not a flake. Retrying the same `git merge --no-ff` 10× produces the same conflict 10×.
- **Use `git merge -X ours` or `-X theirs`** — Rejected: silently DROPS one side's additions. Either fxRoutes or transactionsRoutes wouldn't be registered, leading to silent runtime 404s.
- **Serialize all features (max-concurrent=1)** — Rejected: defeats the entire purpose of parallel Mode B. Even serialized, a feature that branches earlier (e.g. transactions-crud branched after accounts-crud merged but before fx-cache-frankfurter merged) still hits the same conflict at its own merge time.
- **Pre-compute a merge ordering from `app.ts` / `index.ts` deltas** — Rejected: too fragile; depends on perfect prediction of every feature's eventual diff before any code is written.
- **Skip Phase B (just ship Phase A)** — Rejected: Phase A is harm reduction; Phase B is the right structural answer. Phase A unblocks shipping, Phase B prevents the class of conflict from existing.

## Validation Criteria

### Phase A

- [ ] `tryAdditiveConcatResolve` lives in `orchestrator/src/git-agent-runner.ts` (or sibling module) with full TypeScript types.
- [ ] Unit tests in `orchestrator/tests/git-agent.test.ts` cover: positive concat case (2 fixtures), negative non-additive case, heuristic-edge case (mixed insert/modify in same block).
- [ ] Wired into `runCloseFeature` as attempt-1 of the retry loop.
- [ ] Re-run finance-track-01 from a fresh `/start-build` — wave-2 features land cleanly without emergency-abort.
- [ ] Documented in `.claude/agents/git-agent.md` + `.claude/skills/git-agent/SKILL.md`.

### Phase B

- [ ] node-fastify, python-fastapi, node-trpc-nest stack skills updated with route-discovery pattern.
- [ ] `packages/types/src/_discover.ts.template` (or equivalent) shipped + documented.
- [ ] One project (book-swap-pre-build) successfully migrated to the new pattern + Mode B run completes without ANY auto-merge invocation on app.ts / index.ts.
- [ ] Migration recipe for in-flight projects documented in a follow-up refactor plan.

### Phase C

- [ ] `.claude/skills/orchestrator-state-fixup/SKILL.md` exists.
- [ ] Skill validates the JSON edit against the orchestrator's progress schema before writing.
- [ ] Skill emits an audit log to `pipeline/state-fixups/<timestamp>.json`.

## Cross-references

- **Project-side companion**: `projects/finance-track-01/plans/active/bug-002-transactions-crud-merge-conflict-recovery.md` — recovers the specific in-flight finance-track-01 state. That plan is fully self-contained (the dangling commit is the recovery source) and does not depend on Phase A landing.
- **Memory entry**: `~/.claude/projects/.../memory/feedback_orchestrator_pause_dont_kill.md` — sister memory for the orchestrator-kill recovery (different bug class, same broader theme of orchestrator-state recovery).
- **Related factory plan**: `feat-015-factory-extensions-post-mvp.md` mentions "git-agent alignment" as a Phase 13 item — Phase A of bug-034 should be folded into that scope OR explicitly linked from feat-015.
- **Stack skills affected**: node-fastify (shipped), python-fastapi (shipped), node-trpc-nest (shipped). All three need Phase B updates.

## Attempt Log

<!-- populated as fix attempts are made -->
