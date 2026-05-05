---
id: feat-053-class-batched-fix-dispatch
type: feature
status: draft
author-agent: claude-opus-4-7
created: 2026-05-05
updated: 2026-05-05
parent-plan: investigate-016-shift-left-bug-prevention-and-fix-loop-throughput
supersedes: null
superseded-by: null
branch: feat/class-batched-fix-dispatch
affected-files:
  - orchestrator/src/fix-bugs-loop.ts
  - orchestrator/tests/fix-bugs-loop.test.ts
  - packages/orchestrator-contracts/src/bugs-yaml.ts
feature-area: orchestrator/fix-bugs-loop
priority: P1
attempt-count: 0
max-attempts: 5
---

# feat-053: Class-batched fix-dispatch — group bugs by `pattern`, fix N together in 1 dispatch

## Problem Statement

Per investigate-016 F5: 22 of finance-track-01's `visual-parity / shell-stripping` bugs all want the SAME fix shape (wrap each affected page in `<AppShell>`). Current feat-046 fix-bugs-loop dispatches one builder PER bug — 22 dispatches × ~28min agent_sequence = ~10h wall-clock at C=1, ~5h at C=5.

A SINGLE web-frontend-builder dispatch with all 22 bug-plan bodies + mockup snippets in context (~70K tokens — comfortably within Sonnet/Opus 200K window) can apply the same wrapping mechanically across all 22 page.tsx files in one ~30-45min pass. ~13× faster + ~95% fewer agent dispatches.

## Approach

### Phase A — pattern-aware grouping in fix-bugs-loop

Extend `runFixBugsLoop`'s `dispatchableBugs` filter (currently produces a flat list). New helper `groupDispatchableBugsByPattern`:

```ts
function groupDispatchableBugsByPattern(
  bugs: BugEntry[],
): Map<string, BugEntry[]> {
  const groups = new Map<string, BugEntry[]>();
  for (const bug of bugs) {
    // Only parity-divergence bugs carry `pattern` — flow-execution etc. fall
    // through to the singleton path.
    const pattern = bug.parity?.pattern;
    if (!pattern) {
      groups.set(`__singleton__${bug.id}`, [bug]);
      continue;
    }
    const key = `pattern:${pattern}`;
    const existing = groups.get(key) ?? [];
    existing.push(bug);
    groups.set(key, existing);
  }
  return groups;
}
```

Group keys: `pattern:shell-stripping`, `pattern:layout-regrouping`, `pattern:variant-drift`, `pattern:token-drift`, plus `__singleton__<bug-id>` for non-parity bugs.

### Phase B — per-pattern dispatch path

When `ctx.maxConcurrent >= 2` AND a pattern group has ≥ 2 bugs, dispatch as a single batched task:

- ONE per-pattern worktree at `.claude/worktrees/pattern-<name>/` on `fix/pattern-<name>` branch
- ONE `web-frontend-builder` dispatch with all N bug-plan bodies in context (the synthetic task carries the LIST of bug-ids + a per-bug detail block)
- ONE tester dispatch (verifies all N affected screens pass)
- ONE reviewer dispatch
- ONE merge cascade (per-pattern branch → fixup branch)

The dispatch context is a synthetic task whose `summary` is "Fix N bugs of pattern <X>: [list]" and whose `notes` field concatenates all N bug-plan bodies (or links to them).

### Phase C — backward-compat singletons + flow-execution fallthrough

Singleton groups (`__singleton__<bug-id>` keys) flow through the existing per-bug-worktree path from feat-046 Phase A. No behavior change for flow-execution-failure bugs (heterogenous fixes — class-batching doesn't help).

When `maxConcurrent === 1` (sequential default): groups STILL form, but each batch runs sequentially. The wall-clock benefit is reduced (no parallelism between groups) but the dispatch-count benefit remains (1 dispatch fixes 22 screens vs 22 dispatches).

### Phase D — regression tests

`orchestrator/tests/fix-bugs-loop.test.ts` new tests:

- 7 shell-stripping bugs + 5 unrelated singletons → groups correctly: 1 pattern-group of 7 + 5 singletons
- Pattern-group dispatch invokes ONE builder with all 7 bug-ids in context (assert via stub-spy)
- Single tester + reviewer for the pattern (3 SDK calls per group, not 3 × 7 = 21)
- Merge cascade single-shot

### Phase E — empirical re-run

Apply to a fresh project (post-feat-052 ship). Compare:

- /fix-bugs wall-clock: pre-feat-053 ~5h at C=5 → post-feat-053 ~1.5h
- Agent dispatches: pre-feat-053 ~150 (54 bugs × ~3 agents) → post-feat-053 ~30-50 (4-6 patterns × ~3 agents + singletons)

## Rejected Alternatives

- **Group by file overlap, not pattern** — Rejected. File-overlap groupings vary per project; pattern groupings are stable + well-typed. Pattern is THE invariant.
- **Concatenate bug-plan bodies into a single mega-prompt** — That IS Phase B's approach. Estimated 70K tokens; fits Sonnet/Opus context. If a future project has so many same-pattern bugs that 200K is exceeded, fall back to chunked sub-batches (Phase A.5 work — defer to feat-future).
- **Auto-merge ALL bugs of a pattern into a single bug entry in bugs.yaml** — Rejected. Loses per-screen failure detail; complicates resume. The per-bug entries stay; only the dispatch is batched.
- **Skip tester+reviewer when pattern is class-uniform** — Rejected as Phase A. Useful as Phase F follow-up but skips a quality gate. Class-uniform DOESN'T guarantee class-uniform application — a builder might miss 1 of 22 screens. Tester catches.

## Expected Outcomes

- [ ] groupDispatchableBugsByPattern groups parity-divergence bugs by pattern; non-parity bugs flow as singletons.
- [ ] Pattern groups of size ≥ 2 dispatch as one batched task (N bugs → 1 builder + 1 tester + 1 reviewer).
- [ ] feat-046 Phase A's per-bug-worktree path remains for singletons.
- [ ] Empirical: 54-bug load fix-bugs phase wall-clock drops from ~5h (current C=5) to ~1.5h.

## Validation Criteria

- [ ] Unit test: 7-shell-stripping + 5-singleton scenario groups correctly + dispatches accordingly.
- [ ] Tester + reviewer fire ONCE per pattern group (assert call counts).
- [ ] Merge cascade: per-pattern branch merges cleanly into fixup branch (additive same-region edits leverage bug-034 Phase A resolver per pattern, not per bug).
- [ ] No regression: existing per-bug parallel + sequential paths preserved for non-parity bugs.
- [ ] No regression: fix-loop's lossless-pause-resume (bug-052 follow-up) still works for pattern groups (PauseSignal mid-pattern → group's bugs stay in-progress).
- [ ] **Telemetry (per investigate-017 R2)**: per-pattern-group `cacheCreationInputTokens` is ~1× per-dispatch cache write, not N×. Asserts feat-053's secondary cost win — collapsing N dispatches into 1 means ONE cache-creation event covers all N bugs, not N separate creations.

## Cross-references

- Parent: `investigate-016-shift-left-bug-prevention-and-fix-loop-throughput` F5 + recommendation
- Sister: `feat-046-fix-bugs-loop-per-bug-parallelism` (pre-feat-053 baseline; per-bug structure that this plan extends with pattern-grouping)
- Sister: `feat-051` (upstream PM mandate — best case is feat-051 ships first AND prevents most class-uniform bugs; feat-053 still helps the residual)
- Sister: `investigate-017` R2 — feat-053 inherits cache-creation savings; the new telemetry assertion validates the secondary cost win.
- Bug-class lineage: visual-parity classes from feat-022 + feat-028; `bug.parity.pattern` field already exists in BugsYamlSchema (per feat-028)
