---
id: bug-012-lockfile-aware-conflict-resolution
type: bug
status: in-progress
approved-at: 2026-04-26
approved-by: human
author-agent: claude-opus-4-7
created: 2026-04-26
updated: 2026-04-26
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/lockfile-aware-conflict-resolution
affected-files:
  - orchestrator/src/invoke-agent.ts
  - orchestrator/tests/invoke-agent.test.ts
  - .claude/agents/web-frontend-builder.md
  - .claude/agents/backend-builder.md
  - .claude/agents/mobile-frontend-builder.md
  - .claude/agents/reviewer.md
  - projects/*/.claude/agents/{web-frontend-builder,backend-builder,mobile-frontend-builder,reviewer}.md
feature-area: orchestration
priority: P0
attempt-count: 1
max-attempts: 5
error-message: "merge-conflict exhausted after 3 attempts; emergency-abort fired (conflicting files: apps/web/package.json, apps/web/pnpm-lock.yaml)"
reproduction-steps: |
  1. /start-build kanban-webapp-05 (or equivalent) with --max-concurrent>=2
  2. Two parallel features both add deps (different packages) to apps/web/package.json
  3. First feature merges cleanly; second feature's close-feature hits a merge conflict on
     apps/web/package.json + apps/web/pnpm-lock.yaml
  4. Orchestrator dispatches resolve-conflict-handoff to the lastWritingAgent (e.g.
     web-frontend-builder)
  5. Agent attempts text-merge of pnpm-lock.yaml — pnpm's lockfile is structurally
     hard to text-merge (deterministic content-addressed nesting). Agent's resolution
     is either invalid YAML or invalid wrt the package.json
  6. close-feature retries 3× with same outcome
  7. emergency-abort fires; branch is deleted; all agent commits orphaned
stack-trace: null
---

# bug-012 — Lockfile-aware merge-conflict resolution (delete + regenerate)

## Bug Description

When two parallel features both modify `apps/web/package.json`, the second feature
to merge hits a conflict on the package manifest AND its lockfile (`pnpm-lock.yaml`,
`package-lock.json`, or `yarn.lock`). The orchestrator's current
resolve-conflict-handoff path dispatches the lastWritingAgent to text-resolve the
conflict in the worktree.

**Lockfiles are not text-mergeable in any reliable way.** pnpm-lock.yaml in
particular is content-addressed, deeply nested, and order-sensitive. Even an LLM
that produces YAML-valid output usually emits a lockfile that doesn't match the
post-merge `package.json` — `pnpm install --frozen-lockfile` then fails downstream,
the next merge-conflict-attempt repeats the same failure, the cap exhausts, and
emergency-abort fires.

This was first observed on **kanban-webapp-05** (2026-04-26): `feat-settings-data`
merge-conflict-aborted on `apps/web/package.json` + `apps/web/pnpm-lock.yaml` after
3× resolve-conflict-handoff retries. The agent (web-frontend-builder) succeeded
at resolving `package.json` each attempt but the regenerated lockfile was never
in sync with the merged manifest.

The deterministic fix is the standard pnpm/npm/yarn workflow:

1. Resolve the package.json conflict (text-merge — usually trivial: each side
   adds different deps to the same `dependencies` object)
2. Delete or `checkout --theirs` the conflicted lockfile
3. Run the package manager's install (`pnpm install`, `npm install`, `yarn`) to
   regenerate the lockfile against the merged manifest
4. Stage the regenerated lockfile and continue the merge

This is mechanical, deterministic, and belongs in the orchestrator — not in the
LLM agent's prompt. Pushing it to the agent burns ~$2-5 of model time on a
problem that has a 10-line shell-script answer.

## Reproduction Steps

See frontmatter `reproduction-steps`.

Minimal repro for testing:

```bash
# in a fresh project worktree with two existing parallel branches
cd projects/kanban-webapp-test
git checkout master
git checkout -b feat/a
echo '+ "lodash": "^4.17.21"' >> apps/web/package.json && pnpm install
git commit -am "feat: add lodash"
git checkout master
git checkout -b feat/b
echo '+ "ramda": "^0.30.1"' >> apps/web/package.json && pnpm install
git commit -am "feat: add ramda"
git checkout master
git merge --no-ff feat/a -m "merge a"        # clean
git merge --no-ff feat/b -m "merge b"        # CONFLICT on package.json + pnpm-lock.yaml
```

## Error Output

From kanban-webapp-05 run (truncated to the relevant frame):

```
[runCloseFeature] feature feat-settings-data: merge failed.
conflictingFiles: apps/web/package.json, apps/web/pnpm-lock.yaml
merge stderr: Auto-merging apps/web/package.json
              CONFLICT (content): Merge conflict in apps/web/package.json
              Auto-merging apps/web/pnpm-lock.yaml
              CONFLICT (content): Merge conflict in apps/web/pnpm-lock.yaml
              Automatic merge failed; fix conflicts and then commit the result.

[merge-conflict attempt 1/3] resolve-conflict-handoff → web-frontend-builder
[merge-conflict attempt 2/3] resolve-conflict-handoff → web-frontend-builder
[merge-conflict attempt 3/3] resolve-conflict-handoff → web-frontend-builder
[runCloseFeature] feature feat-settings-data: merge-conflict exhausted after 3 attempts; emergency-abort fired
```

## Root Cause Analysis

**Where**: `orchestrator/src/invoke-agent.ts::runCloseFeature` lines ~691-754
(the `git merge --no-ff` catch block) — the conflict-handler is purely reactive
(snapshot, capture conflicting files, return to feature-graph for handoff). It
makes no distinction between text-mergeable files (TS, JSON manifests, MD) and
deterministic-regen files (lockfiles).

**Why**: pnpm-lock.yaml, package-lock.json, and yarn.lock are
content-addressed/hash-keyed and structurally non-mergeable. The canonical
resolution recipe is: resolve the package.json side, then re-run install to
regenerate the lockfile. This recipe is identical across every Node project on
earth — there is nothing project-specific about it.

**Why we built it the way we did**: the original conflict-handler design assumed
LLM agents could resolve any merge conflict given enough context (the
mergeBaseSha, mainHeadSha, featureHeadSha + the conflicting file paths are all
threaded through). For source files this works. For lockfiles it doesn't, and
the cap of 3 retries × ~$1-2 each burns ~$3-6 per impacted feature before
emergency-aborting.

## Fix Approach

Two-phase fix: orchestrator-side deterministic preprocessor (load-bearing) +
agent-prompt guidance (defense-in-depth).

### Phase 1 — Orchestrator preprocessor in `runCloseFeature`

In `orchestrator/src/invoke-agent.ts`, between the `git diff --name-only
--diff-filter=U` capture (line ~707) and the `git merge --abort` (line ~720),
insert a `tryAutoResolveLockfileConflicts(...)` step.

```ts
async function tryAutoResolveLockfileConflicts(
  conflictingFiles: string[],
  projectRoot: string,
  execGit: ExecGitFn,
): Promise<{
  resolved: string[]; // lockfiles that auto-resolved cleanly
  remaining: string[]; // conflict files still needing handoff
  diagnostic: string[]; // log lines for the close-feature snapshot
}> {
  const LOCKFILES = new Set([
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
  ]);
  // Match by basename so nested workspace lockfiles (apps/web/pnpm-lock.yaml,
  // packages/foo/pnpm-lock.yaml) are all caught.
  const lockfileConflicts = conflictingFiles.filter((f) =>
    LOCKFILES.has(basename(f)),
  );
  const nonLockfile = conflictingFiles.filter(
    (f) => !LOCKFILES.has(basename(f)),
  );

  // STRICT GATE: only attempt auto-resolve if NO non-lockfile conflicts exist.
  // Reason: if the agent must still resolve package.json, we can't safely
  // regenerate the lockfile until that's done — agent's package.json edits +
  // our regen would race. Cleaner contract: orchestrator handles lockfile-only
  // conflicts; mixed conflicts go entirely to the agent (whose prompt now
  // knows the recipe — see Phase 2).
  if (lockfileConflicts.length === 0 || nonLockfile.length > 0) {
    return { resolved: [], remaining: conflictingFiles, diagnostic: [] };
  }

  const diagnostic: string[] = [
    `[lockfile-auto-resolve] detected ${lockfileConflicts.length} lockfile-only conflict(s): ${lockfileConflicts.join(", ")}`,
  ];
  const resolved: string[] = [];

  for (const lockfile of lockfileConflicts) {
    const pm = detectPackageManager(lockfile); // pnpm | npm | yarn
    try {
      // Prefer the incoming branch's lockfile (--theirs in merge context = the
      // branch being merged IN, i.e. the feature branch). After regen this is
      // overwritten anyway; we just need a valid file on disk for the
      // package manager to start from.
      await execGit(
        `git checkout --theirs ${shellQuote(lockfile)}`,
        projectRoot,
      );
      diagnostic.push(`  ✓ checkout --theirs ${lockfile}`);

      // Regenerate lockfile-only (no node_modules churn — fast on CI).
      const regenCmd = lockfileRegenCommand(pm, dirname(lockfile));
      await execShell(regenCmd, projectRoot);
      diagnostic.push(`  ✓ regen via ${pm}: ${regenCmd}`);

      await execGit(`git add ${shellQuote(lockfile)}`, projectRoot);
      diagnostic.push(`  ✓ git add ${lockfile}`);
      resolved.push(lockfile);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      diagnostic.push(`  ✗ ${lockfile} regen failed: ${msg}`);
      // Don't auto-resolve on partial failure — let the agent see the full set
      return { resolved: [], remaining: conflictingFiles, diagnostic };
    }
  }

  // All lockfiles resolved + no other conflicts → finalize the merge.
  // The merge is mid-flight (in-progress MERGE_HEAD); we commit it.
  try {
    await execShell(
      `git -c core.editor=true commit --no-edit -m "merge feat/${featureId}"`,
      projectRoot,
    );
    diagnostic.push(`  ✓ merge commit finalized`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    diagnostic.push(`  ✗ merge commit failed: ${msg}`);
    // best-effort recover: abort the merge so subsequent close-feature retry
    // starts clean
    try {
      await execGit("git merge --abort", projectRoot);
    } catch {
      /* skip */
    }
    return { resolved: [], remaining: conflictingFiles, diagnostic };
  }

  return { resolved, remaining: [], diagnostic };
}

function detectPackageManager(lockfile: string): "pnpm" | "npm" | "yarn" {
  const base = basename(lockfile);
  if (base === "pnpm-lock.yaml") return "pnpm";
  if (base === "package-lock.json") return "npm";
  if (base === "yarn.lock") return "yarn";
  throw new Error(`unknown lockfile: ${lockfile}`);
}

function lockfileRegenCommand(
  pm: "pnpm" | "npm" | "yarn",
  dir: string,
): string {
  // --lockfile-only / --package-lock-only / --no-immutable avoid node_modules
  // touches — we just want a valid lockfile on disk for the merge commit.
  // dir can be project root for npm/yarn or any workspace dir for pnpm.
  const cd = `cd ${shellQuote(dir)} && `;
  switch (pm) {
    case "pnpm":
      return `${cd}pnpm install --lockfile-only`;
    case "npm":
      return `${cd}npm install --package-lock-only`;
    case "yarn":
      return `${cd}yarn install --mode update-lockfile`;
  }
}
```

Integration point in `runCloseFeature`'s merge-failure catch block (line ~705):

```ts
// AFTER capturing conflictingFiles via git diff --name-only --diff-filter=U
// BEFORE git merge --abort:
const lockResult = await tryAutoResolveLockfileConflicts(
  conflictingFiles,
  projectRoot,
  execGit,
);

if (lockResult.resolved.length > 0 && lockResult.remaining.length === 0) {
  // Auto-resolved cleanly — return success
  console.warn(
    `[runCloseFeature] feature ${gitOp.featureId}: lockfile-only merge ` +
      `auto-resolved.\n${lockResult.diagnostic.join("\n")}`,
  );
  let mergeSha = "0000000";
  try {
    const res = await execGit("git rev-parse HEAD", projectRoot);
    mergeSha = res.stdout.trim();
  } catch {
    /* placeholder */
  }
  return {
    op: "close-feature",
    success: true,
    conflict: false,
    mergeSha,
    featureId: gitOp.featureId,
  };
}

// fall through to normal conflict-reporting (mixed conflicts or auto-resolve
// failed) — diagnostic is appended to conflictingFiles so the agent sees what
// the orchestrator tried.
```

### Phase 2 — Builder/reviewer agent prompt addendum

For the mixed-conflict case (lockfile + non-lockfile), the orchestrator can't
safely regen — the agent needs to do package.json first, THEN run the
regen recipe. Add a §Merge-Conflict-Resolution block to:

- `.claude/agents/web-frontend-builder.md`
- `.claude/agents/backend-builder.md`
- `.claude/agents/mobile-frontend-builder.md`
- `.claude/agents/reviewer.md`

```markdown
## Merge-Conflict Resolution (when invoked with retryContext.taskId starting "merge-conflict-")

You are being invoked to resolve a merge conflict the orchestrator could not
auto-resolve. The conflicting files are listed in `retryContext.errorMessage`.

**For lockfile conflicts (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`):
NEVER text-merge.** Lockfiles are content-addressed and structurally non-
mergeable. The recipe is:

1. Resolve all NON-lockfile conflicts first (e.g. `package.json` — usually a
   trivial union of two `dependencies` objects).
2. For each conflicted lockfile:
   - `git checkout --theirs <lockfile>` (drops the conflict markers)
   - Run the matching regen command in the lockfile's directory:
     - `pnpm-lock.yaml` → `pnpm install --lockfile-only`
     - `package-lock.json` → `npm install --package-lock-only`
     - `yarn.lock` → `yarn install --mode update-lockfile`
   - `git add <lockfile>`
3. Stage all resolved files, then `git commit --no-edit -m "merge feat/<id>"`.

The orchestrator will retry close-feature after your handoff returns. Your job
is to leave the worktree in a state where `git status` shows no conflicts and
the merge commit is staged or already committed.
```

### Phase 3 — Export to existing projects

Mirror bug-011's export pattern. After Phase 1 + Phase 2 land in factory:

```bash
for proj in projects/*/; do
  # Skip pre-build snapshots (they get refreshed on next /new-project --force)
  [[ "$proj" == *-pre-build/ ]] && continue
  for agent in web-frontend-builder backend-builder mobile-frontend-builder reviewer; do
    cp ".claude/agents/${agent}.md" "${proj}.claude/agents/${agent}.md"
  done
done
```

The orchestrator-side fix (Phase 1) lives in compiled JS — projects all import
from the same `orchestrator/dist/` so no per-project propagation needed there.

## Rejected Fixes

- **Text-merge the lockfile via the LLM agent** — Already tried implicitly
  for 3 attempts on kanban-webapp-05; lockfiles are not reliably text-mergeable
  by any LLM. Even when YAML-valid, the merged content is rarely consistent with
  the merged package.json. Burns money for no win.

- **Use a `.gitattributes` merge driver (e.g. `merge=ours` or a custom
  pnpm-lock driver)** — Requires every project to have `.gitattributes`
  configured AND the merge driver registered in `.git/config` (not in the
  repo). Brittle across worktrees, fresh clones, CI environments. Doesn't
  regenerate against merged package.json — `merge=ours` would just keep the
  base branch's lockfile, which is wrong.

- **Always rebase feature branches before merging (eliminate the conflict
  upstream)** — Doesn't actually eliminate the conflict; rebase produces the
  same lockfile collision. And rebasing parallel features against a moving
  master destabilizes the worktree-isolation model the orchestrator depends on.

- **Pin `--frozen-lockfile` and reject any merge that touches lockfiles** —
  Would block legitimate dep additions across parallel features. Too strict.

- **Phase 1 only (no Phase 2)** — Mixed conflicts (package.json +
  pnpm-lock.yaml) would still fall to the agent, who currently has no recipe.
  Phase 2 is light-weight (~30 LOC of prompt) and prevents the agent from
  text-merging lockfiles in the mixed case.

- **Phase 2 only (no Phase 1)** — Wastes ~$1-2 of agent time per pure-lockfile
  conflict on a problem with a deterministic 4-line shell answer. Phase 1 is
  the load-bearing fix.

## Validation Criteria

### Unit tests (orchestrator/tests/invoke-agent.test.ts)

- `tryAutoResolveLockfileConflicts` with no lockfile conflicts → returns
  `resolved: []`, `remaining: [original]`, no shell calls
- `tryAutoResolveLockfileConflicts` with pnpm-lock.yaml + nothing else →
  invokes `git checkout --theirs`, `pnpm install --lockfile-only`, `git add`,
  `git commit --no-edit`; returns `resolved: [lockfile]`, `remaining: []`
- Same for package-lock.json (npm) and yarn.lock (yarn)
- Mixed conflict (package.json + pnpm-lock.yaml) → returns
  `resolved: []`, `remaining: [both]`, no shell calls (gate enforced)
- Lockfile regen failure → returns `resolved: []`, `remaining: [original]`,
  diagnostic includes failure reason; no partial state on disk
- Merge commit failure post-regen → calls `git merge --abort`, returns
  `resolved: []`, `remaining: [original]`
- `runCloseFeature` with pnpm-lock.yaml conflict → integration test shows
  it returns `success: true, conflict: false` (no handoff dispatched)
- `runCloseFeature` with mixed conflict → returns `success: false,
conflict: true` with diagnostic mentioning the auto-resolve attempt
- Workspace-nested lockfile (`apps/web/pnpm-lock.yaml`,
  `packages/api/package-lock.json`) → detected via basename match, regen
  runs in correct directory

### Integration validation

- Re-run kanban-webapp on a fresh variant where wave-2 features add
  different deps — observe `feat-settings-data` (or equivalent parallel
  feature) closes cleanly without burning merge-conflict retries
- Inspect orchestrator logs for `[lockfile-auto-resolve]` diagnostic lines
- Verify final master tree has a valid `pnpm-lock.yaml` (`pnpm install
--frozen-lockfile` succeeds) and reflects deps from both features

### Regression check

- Existing close-feature happy-path tests still pass (no lockfile in
  conflict → no behavior change)
- Existing merge-conflict-cap exhaustion tests still pass (non-lockfile
  conflicts route to handoff as before)

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->

### Attempt 1 — 2026-04-26 — claude-opus-4-7

**Phase 1 (orchestrator)** — `orchestrator/src/invoke-agent.ts`

- Added `tryAutoResolveLockfileConflicts(conflictingFiles, projectRoot, featureId, execGit, execShell)` exported helper:
  - Strict gate: only acts when ALL conflicts are lockfiles (`pnpm-lock.yaml`/`package-lock.json`/`yarn.lock` matched by basename so workspace-nested lockfiles are caught)
  - Per-lockfile: `git checkout --theirs` → `<pm> install --lockfile-only` (in `dirname(lockfile)` cwd) → `git add`
  - Finalize with `git -c core.editor=true commit --no-edit -m "merge feat/<id>"` to seal the in-flight merge
  - On any sub-step failure: `tryMergeAbort` cleanup + return `resolved: []` so caller's normal path runs
- Wired into `runCloseFeature`'s merge-failure catch block: AFTER `git diff --name-only --diff-filter=U` capture, BEFORE `git merge --abort`. Auto-resolve success short-circuits to `success: true, conflict: false`. Non-success falls through unchanged.
- Plumbed `execShell: ShellExecFn` test-hook through `CreateInvokeAgentConfig` → `createInvokeAgent` → `runGitOp` → `runCloseFeature` (mirrors existing `execGit` plumbing). Default = `defaultShellExec`.
- Added `basename` to `node:path` import.

**Phase 1 (tests)** — `orchestrator/tests/invoke-agent.test.ts`

12 new tests in two describe blocks:

- `tryAutoResolveLockfileConflicts (bug-012)` — 9 unit tests:
  - empty conflicts → no-op
  - non-lockfile only → no shell/git calls
  - mixed → strict gate bails, no shell/git calls
  - pnpm-lock.yaml only → full sequence
  - package-lock.json → npm `--package-lock-only`
  - yarn.lock → yarn `--mode update-lockfile`
  - multiple lockfiles in different workspace dirs → all resolved
  - regen failure → merge --abort + remaining=all
  - commit failure → merge --abort + remaining=all
  - checkout --theirs failure → no regen attempted
- `runCloseFeature lockfile auto-resolve integration (bug-012)` — 2 integration tests:
  - pure pnpm-lock.yaml conflict → returns `success: true` with mergeSha
  - mixed package.json + pnpm-lock.yaml → falls through to normal handoff path; pnpm NOT invoked

Full suite: **271/271 passing** (was 259 → +12). Zero regressions.

**Phase 2 (agent prompts)** — added §Merge-conflict resolution block (placed BEFORE §Downstream) to:

- `.claude/agents/web-frontend-builder.md`
- `.claude/agents/backend-builder.md`
- `.claude/agents/mobile-frontend-builder.md`
- `.claude/agents/reviewer.md` (slightly different framing — reviewer dispatched as conflict-resolver only when no builder ran; doesn't apply normal `ReviewerOutput` JSON contract)

**Phase 3 (export)** — copied 4 updated agent .md files to all 9 live projects' `.claude/agents/` (skipped `*-pre-build` snapshots per bug-011 pattern):

- book-swap, finance-track, kanban-webapp, kanban-webapp-{01..05}, repo-health-dashboard
- 9 projects × 4 agents = 36 files updated, all verified to contain the new section

**Outcome**: implementation complete. Pending validation = next live Mode B run that hits parallel deps on package.json+lockfile (likely a fresh kanban-webapp variant); when surfaced, observe `[lockfile-auto-resolve] detected ... lockfile-only conflict(s)` log + `success: true` from close-feature instead of merge-conflict cap exhaustion.
