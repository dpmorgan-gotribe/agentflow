---
id: bug-013-feature-context-gitignore
type: bug
status: in-progress
approved-at: 2026-04-27
approved-by: human
author-agent: claude-opus-4-7
created: 2026-04-27
updated: 2026-04-27
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/feature-context-gitignore
affected-files:
  - .gitignore
  - projects/*/.gitignore
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "AA (add/add) merge conflict on .feature-context.json — every parallel feature branch contains a different version of this per-worktree runtime metadata file"
reproduction-steps: |
  1. /start-build <project> --max-concurrent>=2 (Mode B feature-graph)
  2. Two parallel features run; tester (or feat-018 auto-commit) commits .feature-context.json
     into each feature branch with that feature's content
  3. First feature merges to master cleanly; master tree now has feature-A's
     .feature-context.json at root
  4. Second feature attempts merge → AA add/add conflict on .feature-context.json
  5. With MERGE_CONFLICT_CAP=1 → emergency-abort; with cap=3 → 3× retries with
     same outcome
stack-trace: null
---

# bug-013 — `.feature-context.json` is per-worktree state but not gitignored

## Bug Description

`.feature-context.json` is documented in `packages/orchestrator-contracts/src/feature-context.ts` as **"Per-worktree lockfile at .claude/worktrees/{worktree}/.feature-context.json"** — runtime metadata tracking agent_history, last_writing_agent, status, conflict_files, merge_sha, etc. It exists per-feature-worktree to support:

- Routing merge conflicts back to last_writing_agent
- Resume-after-crash (idempotent checkout-feature)
- Tracking state transitions across agent handoffs

**It has no business being committed.** But it's not in `.gitignore`, so:

1. When agents write `.feature-context.json` in their worktree's root (e.g. tester updating `agent_history` after writing tests)
2. Orchestrator's feat-018 auto-commit step runs `git add -A && git commit ...` which catches everything in working tree, including `.feature-context.json`
3. Each parallel feature branch ends up with a DIFFERENT `.feature-context.json` (different feature_id, different agent_history)
4. First close-feature merges fine — master now has that feature's `.feature-context.json`
5. Second close-feature → **AA (add/add) merge conflict** on `.feature-context.json` because both branches added the same path with different content

Surfaced on **kanban-webapp-06** (2026-04-27) at $~10 cost: `feat-settings-data` close-feature aborted with `AA .feature-context.json` after `feat-not-found` merged its own version. Same root cause hit `feat-board-core` on `kanban-webapp-05` previously — `UU .feature-context.json` was in that diagnostic too but masked by other concurrent issues (bug-008/009).

bug-012 worked correctly: its strict gate identified `.feature-context.json` is NOT a lockfile (basename doesn't match `pnpm-lock.yaml`/`package-lock.json`/`yarn.lock`) → punted to handoff. bug-012 is not the fix here.

## Reproduction Steps

See frontmatter `reproduction-steps`.

Actual hit on kanban-webapp-06:

```
[runCloseFeature] feature feat-settings-data: lockfile auto-resolve attempt.
[lockfile-auto-resolve] no lockfile conflicts detected — skipping
[runCloseFeature] feature feat-settings-data: merge failed.
conflictingFiles: .feature-context.json
merge stderr: (empty)
merge stdout: Auto-merging .feature-context.json
CONFLICT (add/add): Merge conflict in .feature-context.json
```

## Error Output

```
post-merge-failure-state:
projectRoot status:
  AA .feature-context.json     ← THE conflict
  M  apps/web/lib/store.ts
  M  apps/web/package.json
  M  pnpm-lock.yaml
  ... (other staged files from bug-008 pre-flight)

worktree status:
  (clean)
projectRoot HEAD: f77b33e (= master, with feat-not-found merged)
worktree HEAD: eb3a869 (= feat/settings-data tip)
```

## Root Cause Analysis

Two co-conspirators:

1. **Schema header lied about location.** `feature-context.ts` line 4 says "Per-worktree lockfile at `.claude/worktrees/{worktree}/.feature-context.json`" — implying it lives nested at `.claude/worktrees/{name}/.feature-context.json`. But agents writing the file from inside the worktree (cwd = `.../worktrees/{name}/`) write to PATH `.feature-context.json` (relative to their cwd), which is the WORKTREE'S root — and after merge, lands at the project root. The "nested under .claude/worktrees" path described in the schema header IS the same physical location when viewed from project root, but the visible path on master after merge is `.feature-context.json` (root-relative), not nested.

2. **No `.gitignore` entry.** `.gitignore` excludes `.claude/worktrees/*` (good — keeps worktree directories out of master) but does NOT exclude `.feature-context.json` at any level. So when an agent writes the file inside a worktree (which is its own git working tree), `git status` in that worktree sees it as untracked → feat-018's `git add -A` stages it → orchestrator commits it → it lands on master post-merge.

## Fix Approach

Single-line change, applied factory-wide:

### Phase 1 — Add `.feature-context.json` to factory `.gitignore`

```
# .feature-context.json (orchestrator runtime per-worktree state, NEVER commit)
.feature-context.json
```

Place near the existing `.claude/worktrees/*` block for context coherence.

### Phase 2 — Propagate to all 13 project `.gitignore` files

```bash
for proj in projects/*/; do
  if ! grep -q "^\.feature-context\.json$" "${proj}.gitignore"; then
    echo "" >> "${proj}.gitignore"
    echo "# orchestrator runtime per-worktree state (bug-013)" >> "${proj}.gitignore"
    echo ".feature-context.json" >> "${proj}.gitignore"
  fi
done
```

Includes BOTH live projects AND `*-pre-build` snapshots so any fresh project copy inherits the ignore rule.

### Phase 3 — Verify no orchestrator code reads `.feature-context.json` from master

The schema documentation says the orchestrator consumes this for:
- "Route merge conflicts back to last_writing_agent" — happens DURING close-feature; reads from worktree-internal path, not master
- "Resume after crash (idempotent checkout-feature if lockfile matches)" — reads from `.claude/worktrees/{name}/.feature-context.json` (the lockfile path), not from master
- "Track state transitions across agent handoffs" — happens within the live worktree

Sanity-check via grep: confirm no code path reads `.feature-context.json` from a non-worktree cwd. If any does, that path is the bug, not the .gitignore.

```bash
grep -rn "\.feature-context\.json\|featureContextJson" orchestrator/src/ packages/ | grep -v "node_modules"
```

Expected: only references inside `packages/orchestrator-contracts/src/feature-context.ts` (the schema) and tests/agent prompts that mention the file in worktree-context language.

## Rejected Fixes

- **`merge=ours` driver via `.gitattributes`** — Requires per-clone `.git/config` registration; brittle across worktree creation. Doesn't fix the root cause (file shouldn't be in git at all).

- **Custom merge driver that picks the most-recent timestamp** — Same `.gitattributes` problem PLUS adds complexity. The file isn't intended to survive merges; "winning" doesn't make sense.

- **Stop agents from writing `.feature-context.json` at all** — Would break the resume-after-crash + conflict-routing semantics that depend on persisted state. The file is needed; it just doesn't belong in git.

- **Move agents to write `.feature-context.json` to `.claude/state/feature-contexts/{name}.json`** — Cleaner long-term but a much bigger refactor; touches every agent prompt + git-agent + orchestrator. `.gitignore` is the correct local fix for now; structural relocation can be a post-MVP cleanup.

- **`git rm` it on close-feature before merge** — Delete-then-merge has its own conflict modes (delete/modify) and changes the master branch tree gratuitously. `.gitignore` is the cleanest path.

## Validation Criteria

After fix applied:

- `cat <project>/.gitignore | grep .feature-context.json` returns the entry
- Run `git check-ignore -v .feature-context.json` from a fresh worktree; should return the rule + line number
- Re-run kanban-webapp build (Phase 4: kanban-webapp-07): observe wave-2 features all merge to master without `.feature-context.json` AA conflicts
- After successful Mode B run on -07: `git log --all --oneline -- .feature-context.json` returns ZERO commits (the file is never in any git history)

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->

### Attempt 1 — 2026-04-27 — claude-opus-4-7

In progress. Phases 1-2 about to land; Phase 3 sanity-check pending; -07 fresh validation run pending.
