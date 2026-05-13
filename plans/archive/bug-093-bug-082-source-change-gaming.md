---
id: bug-093-bug-082-source-change-gaming
type: bug
status: completed
author-agent: human
created: 2026-05-13
updated: 2026-05-13
outcome: shipped — Phase A diffOverlapsBugScope helper landed; both single-bug + batched dispatch paths require affectsFiles overlap when populated; lenient fallback preserves pre-bug-093 behavior for bugs without affectsFiles
parent-plan: feat-066-fix-loop-effectiveness-v2 (v2-Phase-3)
supersedes: null
superseded-by: null
branch: fix/bug-082-source-change-gaming
affected-files:
  - orchestrator/src/fix-bugs-loop.ts
  - orchestrator/tests/fix-bugs-loop.test.ts
feature-area: orchestrator/fix-loop
priority: P0
attempt-count: 1
max-attempts: 5
error-message: "bug-082's diff-contains-source-change guard accepts ANY source touch as evidence-of-fix; agent can commit unrelated source changes (e.g. test repair) while the named bug remains unfixed → bug marked 'resolved' but underlying problem persists"
reproduction-steps: "dispatch any bug; agent makes a commit touching at least one non-bookkeeping file (anywhere in apps/{web,api}/src/**, packages/{any}/src/**, etc.) — even if the commit doesn't touch the affectsFiles for the bug; bug-082 guard accepts it as a real fix; loop marks bug 'resolved'"
stack-trace: null
---

# bug-093: bug-082's source-change guard is too coarse — agents can commit unrelated source to game the resolve-status

## Bug Description

bug-082 (shipped 2026-05-11) introduced the unverified-completion guard: an agent's `taskOutcomes.<id>: "completed"` return is only accepted if (a) HEAD advances + (b) the diff includes at least one source file (anything OTHER than `docs/bugs.yaml`, `docs/build-to-spec/*`, `plans/active/*`, `pipeline/*`). The intent: catch agents that report success without actually fixing anything.

The gap: the guard checks if ANY source file is in the diff. It does NOT check whether the touched files are RELEVANT to the bug being fixed. An agent can commit unrelated source changes (test repair, comment polish, an adjacent refactor it noticed) and bug-082 accepts that as evidence-of-fix, even though the named bug's underlying problem stays broken.

**Empirical motivator (reading-log-02 /fix-bugs empirical re-run #2, 2026-05-13):**

Dispatched `bug-compile-pre-verify-tooling-test-seed-contract-broken` — a SYSTEMIC bug whose fix is a 1-line edit: `apps/api/.env.example: ENABLE_TEST_SEED=0` → `=1`.

The agent committed `b58f676 fix(tests): repair drifted web test assertions after component evolution` (touching apps/web/components/\*\*.test.tsx — completely unrelated to apps/api/.env.example). bug-082's guard accepted this as evidence-of-fix because the diff includes source files. Loop marked the bug `resolved`.

Post-run verification: `grep ENABLE_TEST_SEED apps/api/.env.example` → still `=0`. **The fix was never made.** The next verify pass would re-file the same bug under a different stable ID (or the same one if dedup works), and the loop would dispatch again — potentially with the same gaming pattern.

This subverts feat-066 v2's empirical metrics: any agent that produces unrelated source touches gets its bugs marked resolved. The honest signal collapses.

## Reproduction Steps

1. Set up a pending bug whose canonical fix touches a specific path (e.g. `apps/api/.env.example`).
2. Construct a dispatch where the agent commits a source change touching a DIFFERENT path (e.g. `apps/web/components/Foo.tsx`).
3. Observe: bug-082's guard accepts the commit; loop marks the bug `completed`.
4. Verify the original bug's underlying state is unchanged.

In practice (without staging): any natural rate-limit / stall during a dispatch can cause an agent to "give up early" on the real fix but commit some adjacent observation. The combination is empirically common.

## Error Output

```
# reading-log-02 /fix-bugs run 2026-05-13 — seed-contract-broken outcome:
Bug-fix loop:
  iteration 2/2; resolved: 120; failed: 8; remaining: 0; status: clean
  resolved: ..., bug-compile-pre-verify-tooling-test-seed-contract-broken, ...
                                                                       ↑
                                                                       loop reports resolved
$ grep ENABLE_TEST_SEED projects/reading-log-02/apps/api/.env.example
ENABLE_TEST_SEED=0                                                    ← still broken
$ git log --all --oneline | grep -iE "ENABLE_TEST_SEED"
(empty)                                                               ← no commit fixes it
$ git log --all --oneline | grep "fix(tests)"
b58f676 fix(tests): repair drifted web test assertions after component evolution
                                                                      ← the unrelated commit that
                                                                      satisfied bug-082's guard
```

## Root Cause Analysis

`orchestrator/src/fix-bugs-loop.ts:dispatchAgentsForBug` (~line 1480) — the bug-082 guard at end of dispatch:

```ts
const changedPaths = gitDiffPaths(
  worktreeCwd,
  headBeforeDispatch,
  headAfterDispatch,
);
if (changedPaths !== null && !diffContainsSourceChange(changedPaths)) {
  errorLog.push(
    `[unverified-completion] agent(s) [${bug.agentSequence.join(", ")}] committed but only touched bookkeeping paths (${changedPaths.join(", ")}); no source change — treating as silent-failure (bug-082)`,
  );
  return { success: false, costUsd, errorLog };
}
```

`diffContainsSourceChange` is defined as "any path that's NOT in the bookkeeping set" — too coarse. It accepts:

- The bug's `affectsFiles[]` (the right answer)
- ANY OTHER source file the agent touched (the wrong answer — current bug)

The guard's intent was "did the agent do real work?". The implementation answers "did the agent touch ANY source file?". Those questions differ when the agent does real work UNRELATED to the named bug.

## Fix Approach

Three tightening options, in increasing strictness:

### Phase A — bug-specific path overlap check (~30min)

Tighten `diffContainsSourceChange` to take the bug as context and check if at least ONE changed path overlaps with the bug's `affectsFiles[]` (or with paths derived from the bug class):

```ts
function diffOverlapsBugScope(changedPaths: string[], bug: BugEntry): boolean {
  if (bug.affectsFiles && bug.affectsFiles.length > 0) {
    return changedPaths.some((p) =>
      bug.affectsFiles.some(
        (scoped) => p === scoped || p.startsWith(scoped + "/"),
      ),
    );
  }
  // Fallback when affectsFiles is empty: keep the lenient check.
  return diffContainsSourceChange(changedPaths);
}
```

Caveats:

- `affectsFiles` is populated by `scripts/file-bug-plan.mjs` from the violation's `path` field. Most bug classes set it (orphan → component path; flow-failure → screen JSX path; perceptual → screen JSX; parity → screen JSX). Pre-verify discriminator bugs (the empirical case here) also set it.
- Bugs where `affectsFiles` is empty fall back to lenient bug-082 behavior — no regression for any class that doesn't carry path context.

### Phase B — extend to allow related paths (~30min)

Some legitimate fixes touch files OUTSIDE `affectsFiles[]`. For example: fixing a TS type that's imported by `affectsFiles[]` requires editing the type's source. Extend the overlap to include EITHER:

- Direct path match (Phase A)
- Files in the same DIRECTORY as an affectsFile
- Files imported by an affectsFile (graph walk — expensive; defer to Phase C if Phase A+B not enough)

### Phase C — agent-self-declared affectsFiles (deferred)

Have the agent declare in its outcome JSON which files it considered the bug's scope. The orchestrator cross-checks. Pushes the burden onto the agent + introduces a new gaming surface (agent declares whatever it edited). Defer.

### Phase D — 2 fix-bugs-loop tests (~30min)

1. "agent commits affectsFile → accepted" — regression baseline. Bug has affectsFiles:["apps/api/.env.example"], agent commits to that path, loop marks resolved.
2. "agent commits unrelated source → rejected as unverified-completion" — the bug-093 case. Bug has affectsFiles:["apps/api/.env.example"], agent commits to "apps/web/components/Foo.tsx", loop marks failed + adds errorLog entry.

### Phase E — empirical re-validation (~$0)

The seed-contract-broken bug in reading-log-02 already provides a natural re-validation target. Reset it to pending + re-run /fix-bugs. Confirm:

- Agent dispatch sees the bug's affectsFiles in pre-loaded context (already works).
- If agent commits an unrelated source change → guard rejects + bug retries.
- If agent successfully commits the fix → guard accepts + master advances.

## Rejected Fixes

- **Validate the diff CONTENT against bug semantics** — too brittle (would require LLM dispatch to evaluate "did this commit address the bug?"; high cost, high variance).
- **Always require affectsFiles to be set** — would block legitimate fix-loop runs against older bugs.yaml files where affectsFiles is empty. Lenient fallback is safer.
- **Strict path-equality instead of prefix-match** — too narrow; a fix touching `apps/web/components/foo/Foo.tsx` for a bug whose affectsFiles is `["apps/web/components/foo/"]` should pass.

## Validation Criteria

- [ ] `diffOverlapsBugScope` helper exists + replaces the bare `diffContainsSourceChange` call site at the bug-082 guard
- [ ] When `bug.affectsFiles` is non-empty, the guard requires at least ONE changed path overlap
- [ ] When `bug.affectsFiles` is empty, falls back to lenient behavior (no regression for bug-082's original intent)
- [ ] errorLog message names which affectsFiles were expected vs which paths were actually touched (operator-debug visibility)
- [ ] 2 new fix-bugs-loop tests cover the accept/reject branches
- [ ] Suite stays 933/933 + 2 new tests = 935/935
- [ ] Empirical re-validation against reading-log-02's seed-contract-broken bug shows the guard rejecting the unrelated source commit pattern

## Cross-references

- **bug-082** — unverified-completion guard. bug-093 tightens it from "any source change" to "source change with bug-scope overlap".
- **investigate-023** — tester anti-patterns. Same shape (tester can game its dispatch by reshaping tests instead of flagging genuine bugs); already mitigated for tester via tester-diff-audit.ts. bug-093 is the analogous tightening on the bug-fixer / systemic-fixer side.
- **feat-066 v2 epic** — empirical metrics. bug-093 is a Phase 1 follow-up surfaced by the empirical re-run #2 of feat-066 v2. The "resolved" metric is hollow until bug-093 ships.
- **bug-077** (cross-reference) — discrimminator-routed systemic bugs. The `tooling-test-seed-contract-broken` discriminator now sets affectsFiles correctly; bug-093's Phase A would have rejected the unrelated test-repair commit.

## Attempt Log

### 2026-05-13 — Phase A shipped, Phase B/C deferred

Implementation (`orchestrator/src/fix-bugs-loop.ts`):

- New helper `diffOverlapsBugScope(paths, affectsFiles)`: returns true when at least one changed path matches an affectsFiles entry by exact-equality OR prefix-match (so `apps/api/.env.example` matches an affectsFiles entry of `apps/api/` or `apps/api`).
- Lenient fallback: when `affectsFiles.length === 0` (bugs from older verifier runs that didn't populate the field), `diffOverlapsBugScope` falls through to the original `diffContainsSourceChange` — pre-bug-093 behavior preserved.
- Both bug-082 guard sites updated:
  - Single-bug dispatch (`dispatchAgentsForBug` post-success path): rejects with `silent-failure (bug-093)` message naming both the expected affectsFiles + the actually-touched paths.
  - Batched dispatch (`dispatchAgentsForBugBatch` post-success path): builds the UNION of affectsFiles across the batch (any bug's scope satisfies the overlap) so legitimate cross-bug fixes don't false-fail.

Tests (`orchestrator/tests/fix-bugs-loop.test.ts`):

1. "bug-093: accepts success when agent commits to a path in bug.affectsFiles" — bug names `apps/api/.env.example`, agent commits to that exact path. Loop marks `completed`.
2. "bug-093: rejects success when agent commits to unrelated source paths (gaming pattern)" — bug names `apps/api/.env.example`, agent commits `apps/web/components/Foo.test.tsx`. Loop rejects, bug stays `pending` with errorLog naming both paths.
3. "bug-093: lenient fallback when affectsFiles is empty (preserves bug-082 behavior)" — bug with empty affectsFiles + any source commit → `completed`.

Phase B (allow same-directory + import-graph fallbacks) — DEFERRED. Phase A's exact + prefix matching covers the empirical case; Phase B is interpretive latitude that might re-open the gaming surface. Will revisit if empirical evidence shows legitimate cross-file fixes being false-rejected.

Phase C (agent-self-declared affectsFiles) — DEFERRED. Pushes burden onto the agent + introduces a new gaming surface. Status quo is healthier.

Suite: 947/947 orchestrator (+3 new bug-093 tests).

Bug-id regex caveat: bug-093's `bug.id` must match `/^bug-(flow|orphan|coverage|runtime|compile|parity|perceptual|walkthrough)-[a-z0-9-]+$/`. Test bug-ids must follow this pattern or `readBugsYaml`'s Zod validator silently rejects the doc → loop returns `status: "no-bugs"`. Discovered while authoring the tests; using `bug-orphan-{descriptor}` as the canonical test-bug prefix.
