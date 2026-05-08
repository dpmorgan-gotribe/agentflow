---
id: bug-073-fix-bugs-loop-cant-fix-flow-bugs-without-feat-050
type: bug
status: draft
author-agent: human
created: 2026-05-08
updated: 2026-05-08
parent-plan: feat-050-per-flow-seed-orchestration
supersedes: null
superseded-by: null
branch: fix/fix-bugs-loop-cant-fix-flow-bugs-without-feat-050
affected-files:
  - scripts/file-bug-plan.mjs
  - orchestrator/src/fix-bugs-loop.ts
  - .claude/skills/user-flows-generator/SKILL.md
  - schemas/user-flows-manifest.schema.json
  - scripts/synthesize-flow-e2e.mjs
feature-area: orchestration/fix-bugs-loop
priority: P0
attempt-count: 0
max-attempts: 5
error-message: |
  flow-2 captured no page content (page died before content() resolved).
  URL when error fired: http://localhost:3000/
  Error: locator.click: Test timeout of 30000ms exceeded.
  Call log:
    - waiting for locator('role=link[name=/The Overstory/i]')
reproduction-steps: |
  1. Run /fix-bugs against any project where /build-to-spec-verify auto-files flow-failure bugs and the user-flows-manifest.json lacks `requiredState` per flow (currently all shipped projects)
  2. Observe: per-bug worktrees retry the same fix shape iteratively (each builder adds 1 book to baseline seed.ts) without resolving
  3. Each unresolvable bug consumes ~3 attempts × 10min = ~30min wall-clock pre-failed status
stack-trace: null
---

# bug-073: /fix-bugs loop cannot resolve flow-failure bugs without feat-050

## Bug Description

The /fix-bugs loop dispatches `web-frontend-builder` per flow-failure
bug under feat-062 routing (1-agent dispatch). The builder is competent
but the underlying defect is in the synthesizer's manifest assumptions —
a per-bug builder cannot fix it. Result: the orchestrator burns 3
attempts × N flow-failure bugs of pure-loss compute before marking
each `failed`.

This is a **diagnostic + escalation** bug, not a defect-class bug.
The structural fix is `feat-050-per-flow-seed-orchestration`. This plan
captures the orchestrator-side gaps that compounded the problem so
they're addressed once feat-050 ships.

## Reproduction Steps

See `reproduction-steps` field in frontmatter. Empirical instance:
reading-log-02 /fix-bugs run b0e1281c (started 2026-05-08T01:00 UTC,
hard-paused 2026-05-08T01:30 UTC after 5 of 6 flow-failure bugs proven
unresolvable).

## Error Output

Per failure, the synthesized E2E spec calls `page.locator()` against a
selector that depends on a book/tag absent from the baseline seed.
Example from `docs/build-to-spec/failures/flow-2-failure.html`:

```
flow-2 captured no page content (page died before content() resolved).
URL when error fired: http://localhost:3000/
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('role=link[name=/The Overstory/i]')
```

The library page renders 0 books matching "Overstory" because:

- `apps/api/db/seed.ts` baseline contains: Dune, The Name of the Wind,
  ... (5 fixture books)
- The synthesized spec expects: "The Overstory" (Richard Powers)
- "The Overstory" is created at runtime by flow-1 only (via the
  add-book form) — but cross-spec data residue isn't reliable under
  per-bug worktree isolation

## Root Cause Analysis

Three interacting gaps:

1. **`docs/user-flows-manifest.json` has no `requiredState` field** per
   flow — the `/user-flows-generator` skill emits flows without
   declaring what DB state each flow requires. (Filed as Phase A of
   feat-050.)

2. **Synthesizer (`scripts/synthesize-flow-e2e.mjs`) emits specs that
   reference baseline-absent books** — the synthesizer infers a
   selector from the flow's narrative ("Rate and tag" → click "The
   Overstory"), assumes the book exists in baseline, and emits the
   selector verbatim. (Filed as Phase B of feat-050.)

3. **/fix-bugs loop has no escalation path for "structurally unfixable
   per-bug" bugs** — each flow-failure bug burns its 3-attempt cap
   even when the empirical pattern is "every retry adds the same kind
   of fix and verifier still rejects". The loop is missing a
   convergence detector.

The first 2 gaps are feat-050. The 3rd is THIS bug's contribution.

## Fix Approach

### Phase A — Bump feat-050 to P0 + ship it

Updated 2026-05-08: feat-050 priority bumped from P1 → P0 with
reading-log-02 empirical evidence appended. Phases A-D of feat-050
unblock the structural fix.

### Phase B — Convergence detector for fix-bugs-loop (this plan's contribution)

Add an early-failed transition to `orchestrator/src/fix-bugs-loop.ts`
that detects "the same builder is making the same kind of change
repeatedly" and short-circuits to `failed` without exhausting the
3-attempt cap. Heuristic candidates:

- **Diff-shape similarity** — if N-th attempt's diff overlaps ≥80%
  with (N-1)-th attempt's diff (e.g. both touch only `apps/api/db/seed.ts`
  with similar `prisma.book.upsert(...)` patterns), the builder is
  re-trying the same fix shape — escalate.
- **Verifier output similarity** — if the rejection signature (failing
  selector, failing spec line) is byte-identical across attempts, the
  fix isn't moving the needle — escalate.

Either heuristic would have caught reading-log-02 flow-2 by attempt 2.
Cost savings: ~2hr wall-clock per /fix-bugs run on the flow-failure
class while waiting for feat-050.

### Phase C — Project-side recovery (post-feat-050 ship)

Once feat-050 lands, re-author reading-log-02's
`docs/user-flows-manifest.json` flows with explicit `requiredState`:

| Flow                             | requiredState                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| flow-1 ("First-time setup")      | `{ "kind": "empty", "tablesToCleanup": ["BookTag", "Book"] }`                                                   |
| flow-2 ("Rate and tag")          | `{ "kind": "custom", "fixtures": { "Book": [{ "title": "The Overstory", "author": "Richard Powers", ... }] } }` |
| flow-3 ("Edit notes")            | `{ "kind": "custom", "fixtures": { "Book": [{ "title": "Project Hail Mary", "author": "Andy Weir", ... }] } }`  |
| flow-4 ("Search and filter")     | `{ "kind": "custom", "fixtures": { "Book": [...], "Tag": [...] } }` (matches the search query in the spec)      |
| flow-5 ("Delete book")           | `{ "kind": "custom", "fixtures": { "Book": [<deletable book>] } }`                                              |
| flow-6 ("Settings + tag manage") | `{ "kind": "custom", "fixtures": { "Tag": [{ "name": "<rename target>" }] } }`                                  |

Re-run /build-to-spec-verify; the 5 unresolvable flow-failure bugs
should now resolve cleanly under feat-062's 1-agent dispatch (or even
trivially without dispatch since the seeded state matches the spec).

### Phase D — `/user-flows-generator` SKILL.md hardening

Mirror feat-050's Phase D: add a section requiring the generator to
populate `requiredState` for any flow whose first interaction
references a domain entity (book, tag, account, transaction, ...).
Cross-link to `.claude/rules/testing-policy.md §E2E data-seeding strategy`
so it's discoverable from the test-policy entry-point too.

## Rejected Fixes

- **Have the builder write a beforeAll seeder per spec on the fly** —
  Rejected: the builder doesn't have authority to author manifest
  schema changes; even if they did, the per-bug worktree isolation
  would still cause cross-spec data residue races. Authority for
  cross-flow seed orchestration belongs at the user-flows-generator /
  synthesizer layer (feat-050).

- **Stop dispatching builders for flow-failure bugs entirely** —
  Rejected: too aggressive. flow-failure bugs DO sometimes have real
  product-level fixes (e.g. wrong selector in the JSX, missing
  `data-screen-id` attribute). The convergence detector (Phase B) is
  the right granularity — escalate when retries aren't progressing,
  but still try at least once.

- **Mark flow-failure bugs as P3 / non-blocking until feat-050 ships** —
  Rejected: can't ship products with 5 failing E2E flows. The
  symptoms ARE blocking; the question is whether the orchestrator
  burns compute hitting the wall or escalates cleanly to human.

- **Special-case the flow-failure class in defaultAgentSequence to
  skip dispatch** — Rejected: the builder's iterative attempts at
  feat-050-shape fixes (e.g. flow-3 builder added "Project Hail Mary"
  to seed.ts — partially correct!) are useful evidence for the
  feat-050 manifest authoring. Killing dispatch entirely loses that
  signal.

## Validation Criteria

- [ ] feat-050 status: draft → approved → completed (Phase A
      gating dependency)
- [ ] Phase B convergence detector ships:
  - [ ] `fix-bugs-loop.ts` short-circuits to `failed` when diff-shape
        OR verifier-output similarity exceeds threshold
  - [ ] Regression test on reading-log-02 fixtures captured in
        `orchestrator/tests/fix-bugs-loop.test.ts` — synthetic 3-attempt
        sequence with identical diff-shape resolves to `failed` after
        attempt 2 (not 3)
- [ ] Phase C empirical re-run:
  - [ ] reading-log-02 user-flows-manifest.json populated with
        `requiredState` per flow per the table above
  - [ ] Re-run /fix-bugs (or /build-to-spec-verify standalone) →
        all 6 flow-failure bugs resolve OR don't get auto-filed
        in the first place
- [ ] Phase D documentation:
  - [ ] `/user-flows-generator` SKILL.md gains a "requiredState
        authoring" section mirroring feat-050 Phase D

## Attempt Log

### Attempt 1 — 2026-05-08 (Phase B shipped)

**Trigger**: post-pause, with feat-050 audit revealing that Phases
A+B were already shipped 2026-05-03 and only Phase D was missing.
Phase B convergence detector ships in parallel as a complement —
catches "orchestrator hits same wall" failure modes (port collision,
EBUSY teardown, recurring merge conflicts) that aren't fixed by
feat-050's manifest-side change.

**Shipped**:

1. `orchestrator/src/fix-bugs-loop.ts` gains 2 helpers:
   - `detectConvergedFailure(bug)` — returns `{ converged, reason }`
     by comparing the last 2 errorLog entries for byte-identical OR
     first-200-char-identical match
   - `transitionFailedDispatch(bug)` — single source-of-truth state
     transition: convergence first, then maxAttempts cap, else pending
2. All 4 escalation sites refactored to call
   `transitionFailedDispatch`:
   - sequential-path dispatch failure (line ~1483)
   - parallel-path open-failed (line ~1715)
   - parallel-path completed-or-failed not-success (line ~1728)
   - parallel-path merge-cascade failed (line ~1858)
3. `orchestrator/tests/fix-bugs-loop.test.ts`:
   - existing "marks failed after maxAttempts" test updated to use
     varying error messages (so the test asserts the maxAttempts
     cap path, not the convergence path)
   - existing "succeeds within attempt cap" test updated to vary the
     "first-agent flap" error per attempt
   - 2 new tests added for convergence detector:
     - byte-identical errorLog → fails at attempt 2 with bug-073 marker
     - first-200-char-prefix-identical errorLog → same outcome

**Tests**: `pnpm --filter orchestrator test -- fix-bugs-loop.test.ts`
56/56 pass.

**Deferred**:

- Phase A (feat-050 ship + Phase D guidance) — actually shipped this
  same session: feat-050 Phase A+B were already in factory pre-2026-05-08,
  Phase D shipped 2026-05-08
- Phase C (project-side recovery for reading-log-02) — manifest
  re-authored this session; pending /fix-bugs retry validation
- Phase D (additional `/user-flows-generator` hardening) — covered
  by feat-050 Phase D

**Validation pending**: re-run /fix-bugs reading-log-02 with new routing

- updated manifest. Expected outcome: flow-failure bugs resolve
  cleanly per-bug now that specs self-seed required state; convergence
  detector serves as defense-in-depth for any environmental walls.
