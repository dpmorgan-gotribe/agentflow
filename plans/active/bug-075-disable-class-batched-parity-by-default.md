---
id: bug-075-disable-class-batched-parity-by-default
type: bug
status: completed
author-agent: human
created: 2026-05-08
updated: 2026-05-08
parent-plan: investigate-024-bug-fix-dispatch-efficiency
supersedes: null
superseded-by: null
branch: fix/disable-class-batched-parity-by-default
affected-files:
  - orchestrator/src/feature-graph.ts
  - orchestrator/tests/fix-bugs-loop.test.ts
feature-area: orchestrator/fix-bugs-loop
priority: P0
attempt-count: 0
max-attempts: 5
error-message: |
  pattern-layout-regrouping-batch-of-6 hit error_stall_timeout: wall-clock-1500000ms (25min cap) on attempt 1 AND attempt 2 of /fix-bugs reading-log-02 run b0e1281c.
reproduction-steps: |
  1. Project has ≥4 parity-divergence bugs sharing the same `pattern` (e.g. 6× layout-regrouping)
  2. Run /fix-bugs with default settings
  3. fix-bugs-loop creates a single batched dispatch for the N-bug cluster
  4. Observe: builder runs the full 25-min wall-clock budget, fails to commit, gets aborted
stack-trace: null
---

# bug-075: Class-batched parity dispatch over-packs the 25-min wall-clock cap

## Bug Description

`feat-061` shipped class-batched-fix-dispatch ON by default (parity bugs
sharing a `pattern` get one builder dispatch instead of N). Empirical
evidence on reading-log-02 (2026-05-08, /fix-bugs run b0e1281c):

- 6 layout-regrouping bugs batched into one dispatch
- Hit `wall-clock-1500000ms` (25-min cap) on attempt 1
- Retried — hit wall-clock cap AGAIN on attempt 2
- All 6 bugs marked failed without ever committing

Per-bug parity dispatch (each in its own 25-min budget) easily fits.
The mechanical rationale of feat-061 (1 fix shape, N applications)
holds for `shell-stripping` bugs but NOT for `layout-regrouping` —
each screen needs per-page judgment, not a uniform fix.

Per investigate-024 §F4 finding: "the batch is structurally over-packed.
~4 min/screen total. Realistic per-screen work for a layout-regrouping
fix is more like 5-10 min."

## Reproduction Steps

See `reproduction-steps` field in frontmatter. Empirical instance:
reading-log-02 /fix-bugs run b0e1281c — pattern-layout-regrouping-batch-of-6
hit wall-clock 1500000ms 2× (att 1 + att 2 retry).

## Error Output

```
[web-frontend-builder] error_stall_timeout: wall-clock-1500000ms
(pattern-batch layout-regrouping; 6 bugs)
```

Six different parity bugs all carry this errorLog entry. None of them
ever committed code.

## Root Cause Analysis

`orchestrator/src/feature-graph.ts:1830-1831`:

```ts
enableClassBatchedDispatch:
  process.env.FIX_BUGS_DISABLE_CLASS_BATCHING !== "1",
```

Default is `true` (opt-out). Feat-061's empirical motivator was
"shell-stripping with 22 affected screens benefits from batching".
Layout-regrouping has different work-shape: each screen is unique
JSX restructuring, not a uniform wrap.

The wall-clock cap is the right mechanism (prevents runaway dispatches);
batching groups too aggressively for non-mechanical fix classes.

## Fix Approach

### Phase A — Flip the default (10 min)

```ts
// orchestrator/src/feature-graph.ts (line ~1830)
// BEFORE:
enableClassBatchedDispatch:
  process.env.FIX_BUGS_DISABLE_CLASS_BATCHING !== "1",

// AFTER:
enableClassBatchedDispatch:
  process.env.FIX_BUGS_ENABLE_CLASS_BATCHING === "1",
```

Default OFF; opt-in via env var. Operators who want batching for
shell-stripping-heavy projects can flip it back on per-run.

### Phase B — Test update (10 min)

Update any test in `orchestrator/tests/fix-bugs-loop.test.ts` that
asserts class-batched dispatch behavior — adjust to either explicitly
pass `enableClassBatchedDispatch: true` OR set the new env var.

### Phase C — Plan + manifest update (10 min)

Update `feat-061-class-batched-fix-dispatch.md` to note the default
flip + the empirical evidence.

## Rejected Fixes

- **Bump the wall-clock cap from 25 → 60 min for batched dispatches** —
  Rejected: hides the root cause (batches are over-scoped). Operator
  feedback latency would also degrade — a stuck batch eats 60 min
  before the orchestrator notices.

- **Smarter pattern-class detection** (auto-batch only for "mechanical"
  classes like shell-stripping) — Rejected: complex heuristic; class
  taxonomy isn't stable. Cleaner to make batching opt-in and let the
  operator decide per-run.

- **Per-pattern batch-size cap** (e.g. max 3 bugs per batch) — Rejected:
  arbitrary number; doesn't address the root cause. Per-bug dispatch
  with 25-min cap is structurally cleaner.

## Validation Criteria

- [ ] `enableClassBatchedDispatch` defaults to `false` after Phase A
- [ ] `FIX_BUGS_ENABLE_CLASS_BATCHING=1` env var opts back in
- [ ] Existing fix-bugs-loop tests still pass (with explicit
      `enableClassBatchedDispatch: true` for batching-specific tests)
- [ ] Empirical: re-run reading-log-02 /fix-bugs and observe:
  - Each parity bug dispatches as its own 1-bug worktree
  - Each finishes within 25-min wall-clock
  - Zero `wall-clock-1500000ms (pattern-batch …)` aborts

## Cross-references

- Parent: `investigate-024-bug-fix-dispatch-efficiency` §F4 (load-bearing
  finding for this fix)
- Sister: `feat-061-class-batched-fix-dispatch` (the feature this
  un-defaults — does NOT supersede; the mechanism stays available
  for opt-in)

## Attempt Log

### Attempt 1 — 2026-05-08 ✅ SHIPPED

Flipped `feature-graph.ts:1830-1833` from
`process.env.FIX_BUGS_DISABLE_CLASS_BATCHING !== "1"` (default-on, opt-out)
to `process.env.FIX_BUGS_ENABLE_CLASS_BATCHING === "1"` (default-off, opt-in).

Updated comment block to reference investigate-024 §F4 + the empirical
reading-log-02 evidence.

**Tests**: 56/56 fix-bugs-loop tests pass. Existing batching-specific
tests pass `enableClassBatchedDispatch: true` explicitly so they're
unaffected by the default flip. Production path (cli-runner.ts) now
defaults to per-bug dispatch.

**Effort**: ~10 min code change + 5 min test verification = 15 min total
(under the 30-min Phase 1 estimate).
