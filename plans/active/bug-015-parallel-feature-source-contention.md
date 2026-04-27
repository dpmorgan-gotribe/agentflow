---
id: bug-015-parallel-feature-source-contention
type: bug
status: draft
author-agent: claude-opus-4-7
created: 2026-04-27
updated: 2026-04-27
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/parallel-feature-source-contention
affected-files:
  - .claude/skills/pm/SKILL.md
  - .claude/agents/web-frontend-builder.md
  - .claude/agents/backend-builder.md
  - .claude/agents/mobile-frontend-builder.md
  - orchestrator/src/feature-graph.ts (potentially)
feature-area: orchestration
priority: P1
attempt-count: 0
max-attempts: 5
error-message: "Parallel features both modify the same source file (e.g. apps/web/lib/store/index.ts) → UU content conflict at close-feature merge. With MERGE_CONFLICT_CAP=3, three resolve-conflict-handoff dispatches each rely on the agent doing a competent text-merge. Agent prompt has no general source-merge guidance — only bug-012's lockfile recipe."
reproduction-steps: |
  1. /start-build kanban-webapp-08 --max-concurrent=5
  2. Wave 2 dispatches feat-settings-data + feat-board-core in parallel
  3. Both features need to add slices to apps/web/lib/store/index.ts (settings store + board store)
  4. feat-settings-data merges first → apps/web/lib/store/index.ts on master has settings slice
  5. feat-board-core close-feature → 'UU apps/web/lib/store/index.ts' content conflict
  6. resolve-conflict-handoff dispatches lastWritingAgent (web-frontend-builder)
  7. Agent prompt knows lockfile recipe (bug-012) but has no general guidance on
     reading both versions of source code + producing a merged result
  8. Agent's resolution either fails (introduces syntax errors / breaks tests) or
     succeeds opportunistically; outcome is non-deterministic
stack-trace: null
---

# bug-015 — Parallel-feature legitimate source contention

## Bug Description

When `/start-build` runs Mode B with `--max-concurrent>=2`, the PM-emitted feature DAG can dispatch features in parallel that **both modify the same source file**. This is not a generated-artifact problem (bug-013/014 solved that class) — both branches WANT the file in git, with different content.

**Surfaced on kanban-webapp-08 (2026-04-27)**: `feat-settings-data` and `feat-board-core` both modified `apps/web/lib/store/index.ts` (each adding a slice — settings persistence + board CRUD). settings-data merged first; board-core hit `UU apps/web/lib/store/index.ts` at close-feature. With `MERGE_CONFLICT_CAP=1` this immediately emergency-aborted; with cap=3 (default), the agent gets 3 attempts to text-merge.

The current agent prompts (web/backend/mobile-frontend-builder + reviewer, all updated by bug-012) include the §Merge-conflict resolution block, but that block is **lockfile-specific**. There is no general guidance for "you've been dispatched as `lastWritingAgent` because of a real source-code merge conflict — here's how to do that competently."

## Reproduction Steps

See frontmatter `reproduction-steps`. Reliably reproducible on any project where the PM emits two parallel features both touching a central state-management module (very common pattern in React/Next.js apps).

## Error Output

```
[runCloseFeature] feature feat-board-core: lockfile auto-resolve attempt.
[lockfile-auto-resolve] no lockfile conflicts detected — skipping
[runCloseFeature] feature feat-board-core: merge failed.
conflictingFiles: apps/web/lib/store/index.ts
merge stdout: Auto-merging apps/web/lib/store/index.ts
CONFLICT (content): Merge conflict in apps/web/lib/store/index.ts

post-merge-failure-state:
projectRoot status:
  UU apps/web/lib/store/index.ts    ← real source contention
worktree status: (clean)
projectRoot HEAD: c41b52b   (= settings-data merged)
worktree HEAD: f29dc6d      (= feat/board-core tip)
```

## Root Cause Analysis

Two compounding factors:

### Factor 1: PM lacks file-affinity awareness

The PM agent (`/pm --mode=tasks`) generates `docs/tasks.yaml` with feature-level `depends_on:` declarations based on logical dependency (e.g. "card-detail depends on board-core because cards live on a board"). It does NOT analyze which files each feature will modify. So two features can be marked as parallel-safe (`depends_on` doesn't link them) even though their implementation will mutate the same files.

For kanban-webapp specifically, the central app state lives in `apps/web/lib/store/index.ts` — a Zustand store. Multiple features need to add slices to this store:

- feat-board-core: board state (cards, columns, drag handlers)
- feat-settings-data: settings state (theme, density, JSON export/import)
- feat-multiple-boards: multi-board state (active board, board list)
- feat-filter: filter state (search query, active filters)
- feat-theme: theme state (light/dark mode)

PM scheduled 4 of these as wave-2 parallel (theme, not-found, settings-data, board-core). Result: file-level contention regardless of logical-DAG correctness.

### Factor 2: Agent prompts have no general merge-resolution guidance

bug-012's §Merge-conflict resolution block (in 4 agent files) covers ONE specific case: lockfile conflicts. It tells agents:

- For pnpm-lock.yaml: `git checkout --theirs + pnpm install --lockfile-only + git add`
- For package.json: "trivial union of two `dependencies` objects"

It does NOT cover:

- Generic source-file conflicts (read both versions, semantically merge, run typecheck/tests)
- When to bail vs when to attempt
- How to handle multi-file conflicts coherently

So when resolve-conflict-handoff dispatches the agent for `UU apps/web/lib/store/index.ts`, the agent improvises. Outcomes range from "good merge" → "syntax-broken merge" → "agent gives up + re-emits the conflict markers". With 3 attempts, sometimes one succeeds; often all three produce the same broken result.

## Fix Approach

Three-phase, ordered by load-bearing-ness (Phase 1 alone may be sufficient for MVP).

### Phase 1 — Add general source-merge recipe to agent prompts

For all 4 agent files (`web-frontend-builder.md`, `backend-builder.md`, `mobile-frontend-builder.md`, `reviewer.md`), extend the §Merge-conflict resolution block with a general source-merge subsection.

```markdown
### General source-file conflicts

For non-lockfile, non-package.json conflicts (TypeScript / JavaScript / TSX / source code):

1. **Read both versions**: `git show :2:<path>` (master/ours) and `git show :3:<path>` (feature/theirs). Compare against the merge base: `git show :1:<path>`.
2. **Identify what each side changed**:
   - Pure additions on each side → almost always safe to combine
   - Modifications to overlapping lines → need to understand intent
   - Renames or signature changes → highest risk
3. **Produce a merged version** that preserves BOTH sides' intent. Don't pick a winner — combine.
4. **Validate the merge**:
   - Open the file, manually verify no `<<<<<<<`/`=======`/`>>>>>>>` markers remain
   - Run `pnpm -C apps/web typecheck` (or the stack's equivalent) — must pass
   - Run the affected tests: `pnpm -C apps/web test <file-glob>` — must pass
5. **Stage + commit**:
   - `git add <path>`
   - `git commit --no-edit -m "merge feat/<id>"` (the merge is mid-flight; this finalizes it)

If you cannot produce a safe merge after 1 attempt (e.g., the changes are semantically incompatible — both sides redefine the same function differently), DO NOT guess. Leave the file with conflict markers, return your best diagnosis in your output JSON's `summary` field, and let close-feature fail. The orchestrator will surface the conflict to a human.

**Common patterns**:

| Conflict type                                       | Recipe                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| Two slices added to a Zustand/Redux store           | Combine: keep both `set/get` blocks, both selectors, both action types |
| Two routes added to a Next.js app/page.tsx          | Combine: both `<Route>` declarations                                   |
| Two test cases added to the same `describe` block   | Concatenate the `it(...)` blocks                                       |
| Two imports added to the same `import { ... }` line | Sort + dedupe the imports                                              |
| Two divergent edits to the same function body       | Read both — if behavior is incompatible, BAIL with a diagnostic        |
```

### Phase 2 — PM-side file-affinity heuristic

Update `.claude/skills/pm/SKILL.md` to include a §File-affinity check during task graph generation.

When PM emits `docs/tasks.yaml`, after the logical `depends_on` analysis, run a second pass:

1. For each feature, declare `affects_files: [<glob-list>]` based on the feature's task summaries (e.g., "feat-board-core" affects `apps/web/lib/store/board.ts`, `apps/web/components/board/**`, etc.)
2. Detect file-overlap pairs: two features that share a file in `affects_files`
3. If overlap exists AND no `depends_on` link between them, ADD an explicit `depends_on` to serialize them (e.g., feat-board-core → feat-settings-data, since both touch the central store)

This pushes the conflict resolution back to the PM where it's a single-file edit, not a runtime cascade.

The heuristic is imperfect (PM doesn't know the EXACT files agents will touch) but conservative: when in doubt, sequentialize.

### Phase 3 — Architecture-side: feature-sliced module structure

Long-term fix. Update the architect agent prompt to favor **feature-sliced module structure** for shared-mutation modules:

- Instead of `apps/web/lib/store/index.ts` (one file, all slices)
- Generate `apps/web/lib/store/{board,settings,theme,filter}.ts` (one file per feature) + thin `apps/web/lib/store/index.ts` that re-exports

Then each feature only touches its own slice file → no contention → parallel-safe by construction.

This requires architect-prompt updates + may require updates to ui-kit / shared-package conventions. Larger scope; defer until Phase 1+2 prove insufficient.

## Rejected Fixes

- **Increase MERGE_CONFLICT_CAP to 5+** — Doesn't fix root cause; just throws more agent time at a problem the agent prompts don't equip them to solve. Wastes $.

- **Auto-merge with `git checkout --theirs` (always take feature branch)** — Drops master changes. Catastrophic for shared modules.

- **Auto-merge with `git checkout --ours` (always keep master)** — Drops feature changes. Equally catastrophic.

- **Refuse to dispatch parallel features at all (force --max-concurrent=1)** — Sequential is safe but slow. Defeats the purpose of the worktree-isolation design. Acceptable as a safety-mode flag (e.g., `--safe-serial`) but not as default.

- **Merge driver via `.gitattributes`** — Brittle (per-clone config), and source-code merge drivers are research-grade hard. Not a real solution.

## Validation Criteria

After Phase 1 lands:

- Re-run kanban-webapp-NN where wave-2 features touch the same store file — observe `web-frontend-builder` dispatched as `lastWritingAgent`, agent reads both sides, produces a merged file, close-feature succeeds on attempt 2 or 3
- Tester runs cleanly post-merge (no broken tests from the agent's text merge)
- If agent bails with diagnostic (per the "DO NOT guess" rule), output JSON contains a clear `summary` flagging the human-required path

After Phase 2 lands:

- PM-generated `docs/tasks.yaml` for kanban-webapp shows `feat-settings-data depends_on: [feat-bootstrap, feat-board-core]` (or vice-versa) — the file-affinity heuristic serialized them
- Wave 2 only dispatches features with no shared-file overlap

After Phase 3 lands:

- New project's architect output produces feature-sliced module layout
- Wave-2 parallel features ONLY touch disjoint files → no merge conflicts ever

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->
