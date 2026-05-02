---
id: feat-046-fix-bugs-loop-per-bug-parallelism
type: feature
status: draft
author-agent: human
created: 2026-05-02
updated: 2026-05-02
parent-plan: investigate-014-fix-bugs-loop-parallelism-and-worktree-lifecycle
supersedes: null
superseded-by: null
branch: feat/fix-bugs-loop-per-bug-parallelism
affected-files:
  - orchestrator/src/fix-bugs-loop.ts
  - orchestrator/src/feature-graph.ts
  - orchestrator/tests/fix-bugs-loop.test.ts
feature-area: orchestrator/fix-bugs-loop
priority: P2
attempt-count: 0
max-attempts: 5
---

# feat-046: Per-bug worktree parallelism in fix-bugs loop

## Problem Statement

`orchestrator/src/fix-bugs-loop.ts:521` runs a sequential `for (const bug of pendingThisIter)` loop, dispatching each bug's full `agent_sequence` (builder → tester → reviewer → merge) before starting the next bug. The `--max-concurrent` flag set on `/start-build` is silently ignored in fix-bugs phase. Empirical wall-clock cost (2026-05-02 finance-track-01 iteration 1): 7 orphan-component bugs took ~50 minutes sequentially when wave-B-style parallelism would have completed them in ~10-15 minutes.

Per investigate-014 findings:

- All current bug fixes use a SHARED single `fixupWorktree` opened once at loop entry (line 466). Concurrent edits would race on the filesystem.
- Bug fixes routinely touch overlapping central files (apps/web/app/layout.tsx, nav.tsx, etc) — empirical 8 shared files in finance-track-01's 7-bug iteration. None shared with 3+ bugs.
- bug-034 Phase A's `tryAdditiveConcatResolve` (already shipped) handles the additive same-region merge-conflict pattern these shared-file fixes generate.

## Approach

### Phase A — per-bug worktree dispatch (P2 within feature)

1. **Refactor `runFixBugsLoop` in `orchestrator/src/fix-bugs-loop.ts:419+`**. Replace the single shared `fixupWorktree` with per-bug worktrees:
   - Each bug gets its own worktree at `.claude/worktrees/<bug-id>/` on its own branch (`fix/<bug-id>`).
   - bug-036 Phase A's `acquireCheckoutLock(projectRoot)` mutex (already shipped in `feature-graph.ts`) serializes the checkout step automatically.
   - Builder/tester/reviewer per bug run against the per-bug worktree.

2. **Replace the sequential `for` loop on line 521 with `Promise.all` batches**:

   ```ts
   const concurrency = ctx.maxConcurrent ?? 1;
   for (let i = 0; i < pendingThisIter.length; i += concurrency) {
     const batch = pendingThisIter.slice(i, i + concurrency);
     await Promise.all(batch.map(bug => dispatchAgentsForBug({ bug, ctx, ... })));
     // Per-batch: persist bugs.yaml updates atomically after batch completes
   }
   ```

3. **Per-iteration sequential merge-cascade**:
   - After all bugs in a batch complete, sequentially merge each bug's `fix/<bug-id>` branch into the iteration's `fix/bugs-yaml-iter` branch.
   - Use `git merge --no-ff` per bug; bug-034 Phase A's `tryAdditiveConcatResolve` fires for any conflicts.
   - On non-additive conflict, fall through to LLM handoff (existing path).

### Phase B — fixture-driven regression tests

4. **Build a fixture in `orchestrator/tests/fix-bugs-loop.test.ts`** that mirrors finance-track-01's empirical 8-shared-file pattern:
   - 7 bugs, each touching 2-4 files, ~8 files appearing in 2-bugs each
   - Assert: parallel dispatch completes ALL 7 in deterministic merge order
   - Assert: no merge conflicts surface in the LLM handoff path (additive-concat resolver eats them all)
   - Assert: per-iteration `bugs.yaml` updates atomically (no partial state)

5. **Negative test**: 2 bugs that BOTH delete the same line from a shared file (modify-modify pattern) — bug-034 Phase A correctly returns null → LLM handoff fires for one of them. Document the expected behavior.

### Phase C — orchestrator wiring

6. **Forward `--max-concurrent` from `/start-build` CLI to `runFixBugsLoop`** via the existing context plumbing in `cli-runner.ts`.

7. **Update `dag-status` skill output** to show per-bug worktrees + their merge state during fix-loop execution.

## Rejected Alternatives

- **Alternative A: Keep shared worktree but parallelize builders** — Rejected. Two builders writing to the same worktree filesystem at the same time would corrupt git state + create non-deterministic merge sequences. Per-bug worktrees are the right primitive.
- **Alternative B: Lock-based dispatch within shared worktree** — Rejected. Adding a per-file lock during builder dispatch would serialize the bottleneck (builders that touch shared files block each other) without releasing the parallelism benefit; per-bug worktrees with end-of-batch merge are cleaner.
- **Alternative C: Defer indefinitely (status quo)** — Rejected because the wall-clock cost compounds at scale. 50min × N projects with multi-iteration fix-loops becomes the dominant cost. Worth the 2 dev-day investment.
- **Alternative D: Fully async (no batching)** — Rejected. Unbounded concurrency would hammer the SDK rate limits; batching at `--max-concurrent` matches the feature-graph dispatch policy + respects the operator's quota controls.

## Expected Outcomes

- [ ] `runFixBugsLoop` dispatches bugs in `Promise.all` batches of `--max-concurrent`.
- [ ] Each bug runs in its own per-bug worktree (`.claude/worktrees/<bug-id>/`).
- [ ] bug-036 Phase A mutex serializes checkout-feature; downstream agents run concurrently.
- [ ] End-of-batch sequential merge-cascade leverages bug-034 Phase A resolver for additive conflicts.
- [ ] `--max-concurrent` flag honored in fix-bugs phase (currently silently ignored).
- [ ] Wall-clock for 7-bug iteration: 50min sequential → 10-15min parallel at cap=5.
- [ ] Sister feature feat-047 (worktree auto-prune) ships in same release window so transient disk amplification stays bounded.

## Validation Criteria

- [ ] Fixture-based test: 7 mock bugs with 8-shared-file pattern dispatch in parallel; ALL complete; deterministic merge order.
- [ ] Negative test: modify-modify conflict correctly falls through to LLM handoff.
- [ ] Empirical: re-run finance-track-01's iteration with 7 orphan bugs at `--max-concurrent=5`. Wall-clock measured + compared to ~50min sequential baseline.
- [ ] No regression in: bug-034 resolver's behavior, bug-036 mutex's behavior, existing fix-loop semantics for single-bug case.
- [ ] `/dag-status` skill renders per-bug worktrees + merge state during fix-loop.

## Attempt Log

<!-- populated as fix attempts are made -->
