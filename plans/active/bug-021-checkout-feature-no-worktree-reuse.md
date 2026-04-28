---
id: bug-021-checkout-feature-no-worktree-reuse
type: bug
status: draft
author-agent: claude-opus-4-7
created: 2026-04-28
updated: 2026-04-28
parent-plan: feat-024-orchestrator-pause-resume
supersedes: null
superseded-by: null
branch: fix/checkout-feature-no-worktree-reuse
affected-files:
  - orchestrator/src/invoke-agent.ts (runCheckoutFeature — lines 368, 422)
  - orchestrator/src/feature-graph.ts (resume dispatch path)
  - orchestrator/tests/invoke-agent.test.ts (add reuse-existing happy path)
  - orchestrator/tests/feature-graph.test.ts (add resume-with-inflight-feature integration test)
  - .claude/skills/resume-build/SKILL.md (clarify orchestrator-side responsibility)
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
error-message: |
  Failed features:
    ✗ feat-proxy-and-cache — checkout-feature failed: {"op":"checkout-feature","success":false,"reason":"stale-worktree","existingWorktree":"...feat-proxy-and-cache"}
    ✗ feat-web-shell — dependency feat-proxy-and-cache failed
    ✗ feat-home — dependency feat-web-shell failed
    [... 5 more cascade-failures]
  Run status: incomplete
reproduction-steps: |
  1. Run /start-build <project> — orchestrator opens worktrees + dispatches
     builders.
  2. Force a pause mid-feature (SIGINT, rate-limit, or wall-clock liveness
     abort). Worktree directory remains under .claude/worktrees/<feature>.
     progress.json marks the feature as in-flight.
  3. Run /resume-build <project> --yes.
  4. Skill executes recovery decision tree against the in-flight worktree
     (clean / dirty-builder / dirty-meta), then dispatches:
       pnpm --filter orchestrator start generate <project> --resume-feature-graph --pipeline-run-id <id>
  5. Orchestrator's feature-graph loop dispatches checkout-feature for
     feat-X (in-flight). Pre-flight check at invoke-agent.ts:368 returns:
       { reason: "stale-worktree", existingWorktree: "..." }
     Feature marked FAILED. All dependent features cascade-fail.
  6. Result: zero features resume successfully.
stack-trace: null
---

<!-- STATUS STATE MACHINE
draft → approved → in-progress → completed → archived
-->

# bug-021-checkout-feature-no-worktree-reuse: orchestrator's checkout-feature has no resume-aware reuse path

## Bug Description

The /resume-build SKILL.md (per feat-024) documents a recovery decision tree
that classifies in-flight worktrees by `(dirty?, lastAgent-tier)` and
prescribes per-class actions (clean → advance, dirty-builder → soft-reset,
dirty-meta → commit + advance). The implicit assumption is that once the
recovery actions are applied + paused.json is deleted, the dispatched
orchestrator will recognize the in-flight feature, SKIP `checkout-feature`
(worktree already exists), and resume from `nextAgent`.

**The orchestrator does not implement this contract.**

`runCheckoutFeature` in `orchestrator/src/invoke-agent.ts` has TWO failure
paths for existing worktrees:

- **Line 368** (pre-flight): `if (existsSync(worktreePath))` → return
  `{ reason: "stale-worktree" }`. Hard-fails before any check of whether
  this is a resume scenario.
- **Line 422** (git error catch): if `git worktree add` reports "worktree
  already exists" → return `{ reason: "stale-worktree" }`. Same hard-fail.

There is NO code path that reuses an existing worktree, even when the
feature ID is in `progress.inFlight[]` and the orchestrator has been
launched with `--pipeline-run-id <existing>`.

**Empirical hit (2026-04-28):** during repo-health-dashboard-01 E2E recovery,
`/resume-build --yes --ignore-master-drift` deleted paused.json, the recovery
class for feat-proxy-and-cache was `clean` (operator had committed the
backend-builder scaffold per bug-020), and the orchestrator dispatched
`--resume-feature-graph --pipeline-run-id 6b5985b4-...`. On the first
checkout-feature call, it errored with `stale-worktree`. Cascade-failed all
8 features. Worktree state was unaltered (good — no destructive action) but
no progress made.

## Reproduction Steps

See frontmatter `reproduction-steps`. Concretely from the failed run:

```
[output excerpt]
Failed features: 8
  ✗ feat-proxy-and-cache — checkout-feature failed: {"op":"checkout-feature","success":false,"reason":"stale-worktree",...}
  ✗ feat-web-shell — dependency feat-proxy-and-cache failed
  [... 6 more]
Run status: incomplete
Exit status 1
```

## Error Output

`runCheckoutFeature` returns `GitAgentOutput` with `success: false, reason: "stale-worktree"`. The feature-graph loop (in `feature-graph.ts`) treats this as a feature-level failure, marks the feature failed, and cascade-fails dependents.

## Root Cause Analysis

`runCheckoutFeature` was designed for the FRESH-START case only:

```ts
// orchestrator/src/invoke-agent.ts:366-375
// Pre-flight checks — the real git command will also fail, but we want
// clean failure reasons for the orchestrator's `CheckoutFeatureFailure`.
if (existsSync(worktreePath)) {
  return {
    op: "checkout-feature",
    success: false,
    reason: "stale-worktree",
    existingWorktree: worktreePath,
  };
}
```

The comment makes the intent clear: "stale-worktree" is meant to catch
ORPHANED worktrees from prior crashed runs that the operator should
manually clean up. It was not designed to distinguish "stale orphan from
previous run" vs "in-flight worktree from current resumed run."

The `--pipeline-run-id` flag (added by feat-024 Phase D) tells the
orchestrator to reuse the run-id, but that signal isn't threaded through
to `runCheckoutFeature`. The function has no way to know it's in a resume
context.

The /resume-build SKILL.md §7 recovery decision tree assumed the
orchestrator would handle the worktree-already-exists case naturally. The
SKILL is documentation; the matching orchestrator behavior was never
implemented.

## Fix Approach

Two changes — one in feature-graph.ts (skip checkout entirely for in-flight),
one defensive in invoke-agent.ts (reuse if explicitly told to):

### Layer 1 — feature-graph.ts: skip checkout-feature for in-flight features

In the feature-graph loop, BEFORE dispatching `checkout-feature` for a
feature, consult `progress.inFlight[]`. If `featureId` is in there:

- Verify the worktree directory + branch still exist
- Verify the lockfile is consistent
- Skip checkout-feature entirely; jump straight to `nextAgent` from the
  progress snapshot
- If the worktree state is inconsistent (directory missing, branch
  missing), apply the SKILL.md §7 fallbacks (`orphaned` → mark failed;
  `aborted` → surface to operator)

This makes the orchestrator's resume path actually honor the recovery
decision tree.

### Layer 2 — invoke-agent.ts: optional `reuseExisting` flag

Add a `reuseExisting?: boolean` field to the `CheckoutFeatureOp` input.
When true:

- Skip the existsSync check at line 368
- Skip the `git worktree add` call entirely (worktree exists; `git
worktree list` should show it)
- Verify branch matches expectation; verify lockfile presence
- Return `success: true, op: "checkout-feature", reused: true`

Layer 1 obviates the need for Layer 2 in the common case (orchestrator
just doesn't call checkout-feature for in-flight features), but Layer 2
is defense-in-depth: if some other caller tries to checkout an existing
worktree under a resume context, this gives them a clean way to do it.

### Layer 3 (consider only if needed) — fail-fast guard for double-orchestrator

Per the SKILL's "Operator note": running `/start-build` while a previous
orchestrator is still alive (race) creates two orchestrator processes
both touching the same project. Add a pre-flight check in feature-graph
that reads `orchestrator.pid`, checks if the PID is still running, and
refuses to start if so (with override flag). The 2026-04-28 incident hit
this race symptom (a stale orchestrator from the original /start-build
re-paused itself when my /resume-build process raced into the same state
files). Already mentioned in SKILL.md as deferred to feat-025; bug-021's
fix can incorporate it or leave it for the original deferral.

## Rejected Fixes

- **"Make checkout-feature always reuse if worktree exists"** — rejected.
  In a fresh-start context, a stale orphaned worktree IS an error; the
  current behavior is correct for that case. The discriminator must be
  "are we in a resume context?", not "does the worktree exist?"
- **"Have /resume-build delete the worktree before dispatching"** —
  rejected. That destroys all uncommitted in-flight work (which bug-020
  also addresses). The recovery design EXPECTS the worktree to persist.
- **"Manual operator workaround: pre-merge the worktree branch + remove
  the worktree, then resume"** — what we'd have to do without the fix.
  Skips tester + reviewer for the in-flight feature. Acceptable as an
  escape hatch but not as a permanent solution.

## Validation Criteria

- Repro test: pause a feature mid-flight (SIGINT or wall-clock abort),
  run /resume-build --yes, orchestrator successfully advances to
  nextAgent without stale-worktree error.
- Replay the repo-health-dashboard-01 scenario: paused.json deleted,
  worktree clean (post bug-020 commit), /resume-build dispatches → tester
  runs against the worktree → feature progresses through tester →
  reviewer → close-feature → merge to master.
- Negative test: a TRULY orphaned worktree (no entry in
  progress.inFlight[]) still errors with stale-worktree on a fresh /start-build.
- Layer 2 unit test: `runCheckoutFeature({ ..., reuseExisting: true })`
  returns success when worktree exists; returns clean error when worktree
  is missing or branch mismatch.
- All existing feat-024 + bug-016 + bug-008 tests still pass.

## Cross-references

- **Related**: bug-020 (recovery decision tree's `dirty-builder` rule
  destroys completed-but-uncommitted work — a complementary gap in the
  resume design).
- **Parent**: feat-024 (orchestrator pause/resume — the feature that
  introduced the resume contract that this gap breaks).
- **Deferred sibling**: feat-025-or-later "another orchestrator already
  running" pre-flight guard (per SKILL.md operator note).

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->
