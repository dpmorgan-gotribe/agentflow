---
id: bug-125-reviewer-rejects-tester-types-blocks-merge
type: bug
status: approved
approved-at: 2026-05-18
approved-by: human
author-agent: claude-opus-4-7
created: 2026-05-18
updated: 2026-05-18
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/reviewer-tester-types-retry-routing
affected-files:
  - .claude/agents/reviewer.md
  - .claude/agents/tester.md
  - orchestrator/src/feature-graph.ts
  - docs/reviewer-playbook.md
feature-area: factory/reviewer-retry
priority: P2
attempt-count: 0
max-attempts: 5
error-message: |
  task event-detail-review failed after 2 attempts: TS2769 in
  apps/web/playwright/global-setup.test.ts:84,169 — ([url]: [string]) must be
  ([url]: string[]); production code passes all 4 review dimensions;
  retryTargets: [tester]

  The reviewer's verdict explicitly said the production code passed but the
  merge was rejected on a tester-authored test file's destructuring annotation.
  Retry routed to tester. Tester didn't fix it (likely because tester's
  forbidden-paths policy made it think modifying its own test was a re-author,
  not a fix, OR the tester didn't recognize the TS error as fixable within
  its allowed-paths set). After 2 attempts the feature failed.
stack-trace: null
---

# bug-125: Reviewer-rejects-on-tester-authored-type-error blocks merge despite production passing 4/4 dimensions

## Bug Description

`/start-build gotribe-event-calendar` 2026-05-18 run-id `f07db107...` resume —
`feat-event-detail`'s reviewer reported:

```
production code passes all 4 review dimensions; retryTargets: [tester]
```

But the merge was rejected because of a TS error in a **tester-authored** file:

```
TS2769 in apps/web/playwright/global-setup.test.ts:84,169 —
([url]: [string]) must be ([url]: string[])
```

The destructuring annotation in two `mockPost.mock.calls.find(...)` callsites
uses a tuple `[string]` shape when the mock-args contract is variadic
`string[]`. Production code is unaffected.

The retry routed to `tester` (per `retryTargets`). After 2 attempts the
feature was marked `failed` and the feature dependents (well, this was the
last feature, so just this one feature) lost.

Manual recovery: opened the `feat/event-detail` branch (still alive), merged
to master cleanly (no conflicts vs `feat-calendar-views`'s `apps/web/app/calendar/`
subpath), patched the two `[string]` → `string[]` annotations by hand,
committed. Total time-to-recover: ~3 minutes. Total cost of the 2 failed retries:
hard to attribute exactly but ~$1–2 of additional spend.

## Reproduction (synthetic)

This is reproducible from any project where:

1. The tester authors a `playwright/global-setup.test.ts` (or any test file the
   tester is allowed to write per the §Allowed-paths block in
   `.claude/rules/testing-policy.md`) with a TypeScript shape error that the
   typecheck step catches.
2. The reviewer runs `pnpm typecheck` as part of its 4-dimension walk and
   emits the failing file location + line numbers.
3. The reviewer correctly identifies the file as test-authored and sets
   `retryTargets: [tester]`.
4. The tester receives the dispatch with the failing TS error as retry context
   AND the SAME file path that previously failed.

Empirically observed: tester does NOT fix the TS error. The 2 attempts ran but
the file content stayed broken. Why?

## Hypothesis on the root cause

Three candidate root causes:

### (a) Tester treats "fix the test you authored" as re-authoring it from scratch

Tester's dispatch contract per `.claude/agents/tester.md` + `.claude/rules/testing-policy.md`
is to AUTHOR new edge-case / integration / E2E tests. The retry-with-failing-test-error
context is treated as "previous attempt was flawed; author it differently."
The agent may opt to rewrite the file using its own conventions rather than
spot-patching the existing annotation — and on the rewrite it makes the same
type mistake (or a different one).

### (b) Tester's allowed-paths gate misclassifies the fix

If the tester reads the failing-line context and decides the fix is a
1-character type annotation patch, it may consult its allowed-paths gate per
`.claude/rules/testing-policy.md §Allowed paths` and find:

- `apps/web/playwright/global-setup.test.ts` matches the `**/*.test.{ts,tsx,py}`
  rule → allowed
- BUT the tester's prompt also says "tester writes test files only" + "don't
  modify source files inline" — interpreting "the previous tester output
  has a type error I should fix" as a self-modification might trip a
  conservatism check.

The empirical signal is observable in tester's return JSON's `taskOutcomes` /
`genuineProductBugs` fields. If tester returned `taskOutcomes: { ...: "failed" }`
with no `genuineProductBugs[]` entry, that's the smoking gun for (b).

### (c) The retry context didn't include enough specificity

The reviewer's `retryTargets: [tester]` doesn't say WHICH FILE has the error.
If the dispatch envelope to tester just says "reviewer flagged TS errors on
your tests; fix them" without naming `apps/web/playwright/global-setup.test.ts:84,169`
verbatim, the tester may have rewritten OTHER test files or added new ones
without touching the offending lines.

### (d) Reviewer's 4-dimension judgment is binary; doesn't distinguish severity

The reviewer's dispatch returns either `approved` or `needs-revision` per
dimension. A TS error in a test file that's mechanically a 1-character fix
gets the same `needs-revision` severity as a production-code architecture
defect that needs wholesale rework. The retry budget (2 attempts before failure)
treats both the same. For trivial test-type fixes, even attempt 1 should
succeed — but the tester's authoring discipline ("write a clean test from
scratch") fights the spot-patch nature of the fix.

## Empirical context

Reviewer's stated verdict (paraphrased from orchestrator stdout):

> production code passes all 4 review dimensions; retryTargets: [tester]

So dimensions 1–4 (likely: architecture/correctness, security, maintainability,
a11y/perf/brief-delivery — see `docs/reviewer-playbook.md`) all approved.
The blocker was the typecheck step, which the reviewer ran as a 5th
mechanical check across the union of production + test files.

## Related prior work

- **bug-024 (archived 2026-04-29)** — Tester modifies source files (the
  opposite failure: tester reaches OUT of test files into production). Led to
  the strict `genuineProductBugs[]` flag + allowed-paths gate. This new bug
  is what happens when the tester is correctly inside its lane but the type-error
  is in its OWN file and the agent doesn't recognize the spot-patch shape.
- **investigate-023 (active)** — Tester prefers spec-fixes over flagging
  product bugs. The 6 anti-patterns are about masking product bugs with
  test rewrites. This bug surfaces the inverse: a real fix-the-test case that
  the tester doesn't recognize.
- **feat-010 (archived)** — Reviewer implementation. The 4-dimension verdict
  shape was introduced here. The "production passes but test-side blocks"
  case wasn't anticipated in the original retry routing.

## Proposed Fix Shape (Phase 1 — minimum-viable)

### A. Strengthen the retry-context envelope

When the reviewer's typecheck flag fires on a file path that's in the tester's
allowed-paths set, the dispatch envelope to the retry-target tester MUST
include:

- The exact failing file path (`apps/web/playwright/global-setup.test.ts`)
- The exact failing line numbers (`84, 169`)
- The exact TypeScript error code + message (`TS2769: ([url]: [string]) must be ([url]: string[])`)
- An explicit directive: "this is a spot-patch — DO NOT rewrite the file
  from scratch; preserve existing test names + bodies; only adjust the
  type annotation/expression that triggered the error."

### B. Add a tester recipe for "fix tester-authored type error"

`.claude/agents/tester.md` §Type-error-fix-recipe block: when the dispatch
envelope says "retry on TS error in your-own-test-file", the tester's first
action is to Read the failing line, identify the smallest possible patch,
Edit (NOT Write — file already exists), and re-run typecheck. Do not
re-author the file.

### C. Reviewer retry routing — distinguish "test typecheck" from "test logic"

Reviewer's `retryTargets` could be enriched with a granularity hint:

```json
{
  "retryTargets": [
    {
      "agent": "tester",
      "scope": "type-annotation-spot-patch",
      "files": ["apps/web/playwright/global-setup.test.ts:84,169"]
    }
  ]
}
```

The orchestrator's tester-dispatch prompt template branches on `scope` to
emit the spot-patch envelope (A) vs the standard test-authoring envelope.

## Out of scope

- Adding a 3rd tester retry attempt (current cap is 2 reviewer-attempts ×
  per-task-retry = 2). The right fix is to make attempt 1 succeed, not raise
  the retry budget.
- General reviewer 4-dimension verdict reform (separate concern; investigate-023
  territory).

## Acceptance criteria

- [ ] Root cause classified as (a), (b), (c), (d), or a combination
- [ ] Retry-context envelope enriched to include exact failing file:line:error
      on type-fix-class retries
- [ ] Tester agent prompt updated with a `Type-error-fix-recipe` block
      steering toward spot-patch (Edit) over re-author (Write)
- [ ] Regression test: synthetic project where tester authors a test file
      with a known TS error, reviewer flags it, retry dispatches to tester,
      tester fixes via single-line Edit on attempt 1
- [ ] Empirical re-run on a fresh project mirroring gotribe-event-calendar's
      shape: a flow-3 test-authored TS error must self-resolve within the
      reviewer's standard 2 retries

## Attempt Log

_None yet — plan in draft._
