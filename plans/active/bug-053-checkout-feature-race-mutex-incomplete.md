---
id: bug-053-checkout-feature-race-mutex-incomplete
type: bug
status: draft
author-agent: human
created: 2026-05-06
updated: 2026-05-06
parent-plan: bug-036-parallel-checkout-feature-race-on-dirty-state
supersedes: null
superseded-by: null
branch: fix/checkout-feature-race-mutex-incomplete
affected-files:
  - orchestrator/src/feature-graph.ts
  - orchestrator/src/invoke-agent.ts
  - orchestrator/tests/feature-graph.test.ts
feature-area: orchestrator/git-agent
priority: P1
attempt-count: 0
max-attempts: 5
error-message: "feat-books-core silently failed at checkout-feature on reading-log-01 resume run (2026-05-06 02:20). Same failure-mode signature as bug-036 — single `[runCheckoutFeature] auto-committing snapshot` stdout line, no worktree creation, immediate move to failed[]. Cascade-aborted feat-search-filter."
reproduction-steps: |
  1. Project with N>=4 features in a single wave (i.e. multiple features with deps satisfied simultaneously).
  2. Run /start-build with --max-concurrent N (or any concurrency >= 4).
  3. Observe: 1+ feature(s) silently fail at checkout-feature despite bug-036 Phase A's `acquireCheckoutLock` mutex.

  Empirical case 2026-05-06 reading-log-01 resume:
    - feat-bootstrap completed (manual recovery)
    - 4 features dispatched in parallel post-bootstrap: feat-books-core, feat-tags-manage, feat-settings, (feat-search-filter waited on books-core dep)
    - feat-tags-manage + feat-settings: succeeded
    - feat-books-core: silently failed
    - Manual `git worktree add -b feat/books-core .claude/worktrees/feat-books-core master` SUCCEEDED on first try → race was transient, not a permanent state issue
stack-trace: null
---

<!-- STATUS STATE MACHINE
draft → approved → in-progress → completed → archived
                 → abandoned → archived
-->

# bug-053: bug-036 Phase A's checkout-feature mutex didn't prevent the race on reading-log-01 resume

## Bug Description

bug-036 Phase A landed `acquireCheckoutLock` (a per-project-root mutex around `runCheckoutFeature`) in `orchestrator/src/feature-graph.ts:1037` to serialize the dirty-state auto-commit + `git worktree add` operations across concurrent feature dispatches. The mutex's documented purpose:

```ts
// bug-036 Phase A: per-project-root mutex for checkout-feature operations.
// `git worktree add` (and the dirty-state auto-commit branch in
// `runCheckoutFeature`) takes the project root's `.git/index.lock`; concurrent
// dispatches with maxConcurrentFeatures > 1 race on the lock and the losers
// silently fail with `worktree-seed-failed` / `index.lock: File exists`. This
// mutex serializes ONLY the checkout-feature step (the rest of runFeature —
// builder, tester, reviewer, close-feature merge — runs against the
// per-feature worktree's own .git and don't contend.)
```

**Phase A is shipped (mutex code is in feature-graph.ts) but did not prevent the race in our empirical case.** On reading-log-01 (2026-05-06 02:20 resume run, --max-concurrent 5), 4 features fired their checkout-feature step in parallel post-feat-bootstrap. One feature (`feat-books-core`) silently failed with the same fingerprint bug-036 documented (single stdout line `[runCheckoutFeature] auto-committing snapshot`, no worktree, no error in stdout, instant move to `failed[]`). Manual `git worktree add` for the same branch on the same project root succeeded on the next try — the race was transient.

This means **Phase A's mutex is necessary but not sufficient.** Possible gaps in Phase A's implementation:

1. **The mutex is per-process, not per-project-root filesystem-wide.** If the orchestrator process holds the lock but git's `.git/index.lock` is held by something OUTSIDE the orchestrator (e.g., a different orchestrator process, a stale lockfile from a crashed run, the IDE's git integration polling), the mutex doesn't help.

2. **The auto-commit branch in `runCheckoutFeature` may not be inside the mutex.** Reread the code — if `acquireCheckoutLock` only spans the `git worktree add` call but NOT the `git add -A && git commit` preamble, racing auto-commits still hose each other.

3. **The mutex IS inside `runFeature` but NOT inside `runCheckoutFeature` itself** — i.e., the orchestrator-side caller serializes but the agent dispatch path may have its own race window during stdin/stdout streaming.

4. **Race on the project-root .git directory specifically when fixup-worktree (bug-054) is co-running.** bug-054 introduced a separate fixup-worktree for the bug-fix loop; if the orchestrator runs bug-fix logic concurrently with feature dispatch (it shouldn't here — there are no fix-loop bugs yet — but worth ruling out), the two paths could race.

5. **Windows-specific: the `.git/index.lock` file isn't atomically removed by every git operation.** Stale lockfiles after one operation can block the next. The mutex's logical serialization doesn't help if git's filesystem state is dirty.

## Reproduction Steps

(see frontmatter)

Concretely:
- Use a project with feat-bootstrap dependency satisfied + 4+ features in the next wave (reading-log-01 fits this pattern by design).
- Resume with --max-concurrent 5 (or any number ≥ 4).
- Observe: occasional silent failure of one feature at checkout-feature.

The failure is timing-dependent + non-deterministic. Reproduction may take multiple runs.

## Error Output

```
[runCheckoutFeature] feature feat-books-core: project root has dirty/untracked state — auto-committing snapshot before worktree creation.
   ← (no further output for feat-books-core; feature-graph-progress.json reflects feat-books-core in failed[] within seconds)
```

For comparison, the OTHER 2 features (tags-manage + settings) on the same wave dispatched cleanly — they didn't even emit the dirty-state auto-commit message. The mutex IS serializing something — it's just not enough.

## Root Cause Analysis

To be filled. Investigation order:

1. **Read `orchestrator/src/feature-graph.ts:697-1080`** carefully. Confirm the exact span of `acquireCheckoutLock` — does it cover BOTH the auto-commit AND the worktree add?
2. **Add stderr capture to `runCheckoutFeature`** (Phase C of bug-036, never shipped). The 2026-05-06 race produced ZERO error output. Without the actual git error, root-cause analysis is guessing.
3. **Re-read bug-036 Phase B** ("pre-wave dirty-state commit — structural") to see if a structural fix was deferred. If so, re-prioritize Phase B as the load-bearing follow-up here.
4. **Add a regression test** that simulates 5-feature parallel dispatch against a dirty project root + asserts all 5 features get worktrees. This exercise will likely reveal whether the mutex is missing a span.

## Fix Approach

Once root cause is identified, options:

- **Phase D (new)**: Extend bug-036 Phase A's mutex to cover the FULL `runCheckoutFeature` path including all stdout-streaming + agent-dispatch substeps. Likely this is the right fix.
- **Phase B (was deferred)**: Move the dirty-state auto-commit OUT of `runCheckoutFeature` entirely. Do it ONCE before the wave fires (in `runFeatureGraph`'s wave-dispatch preamble). Eliminates the race surface entirely. More invasive but truly structural.
- **Phase C (was deferred)**: Capture + surface checkout-feature stderr so silent failures become non-silent. Defense in depth — doesn't fix the race but at least makes future occurrences debuggable.

## Rejected Fixes

- **Workaround: re-run the orchestrator on failure** — Rejected because it's the operator's burden to recognize the silent-fail signature + manually intervene. The orchestrator's job is to handle this. Already explored as the manual recovery path on reading-log-01; works but doesn't scale.

- **Lower max-concurrent to 1** — Rejected because it eliminates the parallelism that makes the orchestrator useful. Defeats the purpose.

## Validation Criteria

- A 5-feature parallel-dispatch wave on a project with dirty state produces 5 worktrees (zero silent failures), repeated across 10+ runs.
- Regression test in `orchestrator/tests/feature-graph.test.ts` simulates the racing dispatch + asserts 100% checkout success.
- Pair-tested on reading-log-01 resume: the same wave that produced the bug now succeeds.

## Attempt Log

<!-- Populated by agents during fix.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
-->
