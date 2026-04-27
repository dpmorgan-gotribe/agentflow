---
id: bug-016-pre-flight-snapshot-race
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
branch: fix/pre-flight-snapshot-race
affected-files:
  - orchestrator/src/invoke-agent.ts
  - orchestrator/tests/invoke-agent.test.ts
feature-area: orchestration
priority: P1
attempt-count: 0
max-attempts: 5
error-message: |
  [runCloseFeature] feature feat-XXX: project root has dirty/untracked state — auto-committing pre-merge snapshot to master.
  [runCloseFeature] feature feat-XXX: pre-merge snapshot failed: git command failed: git commit -F C:\Users\nagro\AppData\Local\Temp\agentflow-snapshot-XXXXXX\MSG
reproduction-steps: |
  1. /start-build <project> --max-concurrent>=2 --resume-feature-graph (any project with multiple features)
  2. Multiple features hit close-feature concurrently against the shared project root
  3. Each close-feature runs bug-008's pre-flight: git status --porcelain → git add -A → git commit -F <tempfile>
  4. Between status (returns dirty) and commit (runs ~50-200ms later), another concurrent close-feature has already committed those exact files
  5. The second commit fails with "nothing to commit, working tree clean"
  6. Caught in the catch block, reported as `pre-merge-snapshot-failed`, returned as `success: false, conflict: true`
  7. Orchestrator misclassifies as merge conflict → dispatches resolve-conflict-handoff to lastWritingAgent (~$1-2 wasted) → eventually merges anyway on retry
stack-trace: null
---

# bug-016 — Pre-flight snapshot race in concurrent close-feature

## Bug Description

bug-008's pre-flight snapshot (in `runCloseFeature`, `invoke-agent.ts:612-636`) has a **TOCTOU race** when multiple features are running close-feature concurrently against the same project root. Observed on every close-feature in kanban-webapp-10's resume run (4+ occurrences across feat-bootstrap, feat-not-found, feat-board-core, feat-card-detail-modal).

**Symptom**: Every close-feature emits the warning + reports `pre-merge-snapshot-failed`, the orchestrator misclassifies as merge conflict → dispatches resolve-conflict-handoff to lastWritingAgent at ~$1-2 each → feature eventually merges anyway via retry. **Wasted agent dispatch per feature with parallel siblings.**

The merges land successfully (the close-feature retry path eventually clears) but the run wastes meaningful agent budget on phantom conflict resolutions.

## Reproduction Steps

See frontmatter `reproduction-steps`. Reliably reproducible on any `--max-concurrent>=2` run; observed every time on kanban-webapp-10's resume (5 features in flight).

## Error Output

```
[runCloseFeature] feature feat-bootstrap: project root has dirty/untracked state — auto-committing pre-merge snapshot to master.
[runCloseFeature] feature feat-bootstrap: pre-merge snapshot failed: git command failed: git commit -F C:\Users\nagro\AppData\Local\Temp\agentflow-snapshot-LyRLEH\MSG
```

(actual `git commit` stderr is "nothing to commit, working tree clean" — confirmed by inspecting the commit's exit code path)

## Root Cause Analysis

In `orchestrator/src/invoke-agent.ts::runCloseFeature` lines 612-636:

```ts
const preflightStatus = await execGit("git status --porcelain", projectRoot);
if (preflightStatus.stdout.trim() !== "") {        // ← time-of-check (T1)
  console.warn("project root has dirty/untracked state...");
  await execGit("git add -A", projectRoot);        // T2
  // ...write tempfile...
  await execGit(`git commit -F ${shellQuote(snapMsg)}`, projectRoot);  // ← time-of-use (T3)
}
```

**The race**: with `--max-concurrent>=2`, two features (A and B) both reach `runCloseFeature` against the SAME `projectRoot`. They observe identical "dirty" state at T1. A wins the race to T3 and commits successfully. B reaches T3 ~100-500ms later and finds the working tree clean (because A's commit cleaned it). B's `git commit` fails with "nothing to commit".

**Why it didn't manifest pre-resume**: it probably DID manifest on previous concurrent runs but went unnoticed because (a) the run still landed via close-feature retry, and (b) the cost was masked in larger run-totals. On resume specifically (where 5 features all enter close-feature within seconds of each other re-running already-merged work) it's reliably 4-of-4-of-5 features hitting the race.

**Why it's misclassified as merge-conflict**: the catch block (lines 637-657) returns `{success: false, conflict: true, conflictingFiles: ["<pre-merge-snapshot-failed>: ..."]}`. The orchestrator's downstream conflict-handler treats this as a real merge conflict and dispatches resolve-conflict-handoff. The dispatched agent finds nothing to resolve (worktree clean) and returns; orchestrator retries close-feature; on the retry, status is clean (no race this time) and merge proceeds.

## Fix Approach

Two complementary changes; Phase 1 alone removes the symptom.

### Phase 1 — Distinguish "nothing to commit" from real failures (load-bearing)

In the catch block (lines 637-657), inspect the error to detect "nothing to commit" / "working tree clean" specifically. If matched: this is a benign race-loss, NOT a real failure. Re-check `git status --porcelain`; if now clean, proceed with merge as if pre-flight succeeded.

```ts
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  const stderr = (err as { stderr?: string })?.stderr ?? "";

  // bug-016: distinguish race-loss ("nothing to commit") from real failures.
  // Concurrent close-features against shared projectRoot routinely race here.
  const isNothingToCommit =
    /nothing to commit/i.test(stderr) ||
    /working tree clean/i.test(stderr) ||
    /no changes added to commit/i.test(stderr);

  if (isNothingToCommit) {
    // Re-check: if the working tree is now clean, the race winner committed
    // for us. Proceed with merge as if pre-flight succeeded.
    const recheck = await execGit("git status --porcelain", projectRoot).catch(
      () => ({ stdout: "", stderr: "", code: 1 }),
    );
    if (recheck.stdout.trim() === "") {
      console.warn(
        `[runCloseFeature] feature ${gitOp.featureId}: pre-merge snapshot ` +
        `race-lost to a concurrent close-feature; working tree now clean — ` +
        `proceeding with merge.`
      );
      // fall through to the rest of runCloseFeature (merge etc.)
    } else {
      // Status still dirty after the failed commit — this isn't just a race;
      // something else is going on. Return as before.
      return { /* original failure path */ };
    }
  } else {
    return { /* original failure path */ };
  }
}
```

Note: making the catch block fall-through to the rest of the function requires refactoring it into a labeled-block or extracting the pre-flight into a helper that returns "ok" / "race-loss-clean" / "fail" with the caller deciding flow.

### Phase 2 — Cross-process advisory lock (defense-in-depth)

Add a file-based advisory lock so only one close-feature pre-flights at a time:

```ts
const LOCK_PATH = join(projectRoot, ".claude", "state", "close-feature.lock");

async function withCloseFeatureLock<T>(fn: () => Promise<T>): Promise<T> {
  const fd = await acquireLock(LOCK_PATH, { timeoutMs: 30_000 });
  try { return await fn(); } finally { releaseLock(fd); }
}

// in runCloseFeature:
return withCloseFeatureLock(async () => { /* existing body */ });
```

Use `proper-lockfile` or hand-roll with `fs.openSync(O_EXCL)` + retry. Cross-platform (Windows + Linux + macOS) safe.

This eliminates the race AND serializes any other future shared-state-on-master operations. Cost: ~30 LOC + new dep (or hand-rolled).

Decision: **Phase 1 only for v1** (smaller surface; deterministic; doesn't add a dep). If post-fix runs still surface phantom failures, ship Phase 2.

### Same fix needed in bug-009's checkout-feature pre-flight

`runCheckoutFeature` (lines ~158-220 estimated; verify on read) has the SAME pattern: pre-flight `git status` → `git add -A` → `git commit -F`. Same race. Apply the same Phase 1 fix there.

## Rejected Fixes

- **Lock the project root with `git update-index --refresh` before status check** — Doesn't address the race; just shifts the check window.
- **Make pre-flight a no-op (skip the snapshot)** — Reintroduces the bug-008 / bug-009 failure modes those plans fixed. Pre-flight commit is load-bearing for projects with dirty pre-build state.
- **Serialize close-feature globally** — Defeats `--max-concurrent` parallelism for the wrong reason. The close-feature merge itself is fast; only the pre-flight needs serialization (Phase 2 covers this minimally).
- **Retry the commit N times** — Doesn't help; on the second attempt status is clean (race winner already committed) so commit fails the same way. Phase 1's "did the race winner clean the working tree?" check is the right shape.

## Validation Criteria

- Replay kanban-webapp-10's resume scenario (5 features in flight) — observe `pre-flight snapshot race-lost` warning instead of `pre-merge snapshot failed`. Merges proceed without dispatching resolve-conflict-handoff.
- Existing close-feature happy-path tests still pass.
- New unit test in `orchestrator/tests/invoke-agent.test.ts`: stub `execGit` to return dirty status then throw "nothing to commit" on commit then return clean status on re-check; assert function falls through to merge instead of returning `pre-merge-snapshot-failed`.
- New unit test: stub `execGit` to throw a NON-race error on commit; assert original failure-return path fires.

## Cross-references

- **Predecessor**: bug-008 (introduced the pre-flight in close-feature)
- **Predecessor**: bug-009 (introduced the pre-flight in checkout-feature — same race expected)
- **Surfaced by**: kanban-webapp-10 resume run 2026-04-27 (pre-stall stalled feat-filters; manual recovery via worktree+branch cleanup; resume re-attempted 5 features in parallel which reliably triggered the race on every close-feature)
- **Related**: feat-024's pause/resume (in-flight recovery decision tree should know about merged features so resume doesn't re-run them and amplify this race)

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->
