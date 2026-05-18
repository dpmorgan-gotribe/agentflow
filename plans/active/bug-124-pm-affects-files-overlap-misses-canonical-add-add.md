---
id: bug-124-pm-affects-files-overlap-misses-canonical-add-add
type: bug
status: draft
author-agent: claude-opus-4-7
created: 2026-05-18
updated: 2026-05-18
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/pm-affects-files-overlap-canonical-shared
affected-files:
  - .claude/skills/pm/SKILL.md
  - .claude/agents/project-manager.md
feature-area: factory/pm
priority: P1
attempt-count: 0
max-attempts: 5
error-message: |
  feat-tribes-route + feat-test-seed-routes both list apps/api/src/server.ts in
  affects_files[] yet PM did NOT auto-add depends_on linkage. They dispatched
  in parallel (wave 3, maxConcurrent=3); both authored their own apps/api/src/{app,server}.ts
  from scratch on different branches. Second close-feature merge hit add/add
  conflicts on 3 files (app.ts, server.ts, routes/test-seed.ts) → orchestrator's
  conflict-handoff exhausted 3 retries → emergency-abort cascade-failed
  feat-tribes-route + 3 dependents (feat-events-routes, feat-calendar-views,
  feat-event-detail). ~$15.76 spent on the aborted run before manual recovery.
stack-trace: null
---

# bug-124: PM affects_files overlap detection misses the canonical-shared-file add/add case

## Bug Description

`.claude/skills/pm/SKILL.md` §4b ("File-affinity check") is supposed to auto-add `depends_on` between features whose `affects_files[]` globs overlap, so the merge cascade serializes their close-feature merges and avoids the parallel-feature source contention bug-015 catalogued.

The check **fired** on the gotribe-event-calendar 2026-05-17 run (no `feat-051-layout-mandate-skipped`-style warning, no `affects_files-missing`-style warning), and **both** features that ended up colliding listed the shared file in their `affects_files[]` explicitly:

```yaml
# docs/tasks.yaml — both features list apps/api/src/server.ts
- id: feat-tribes-route
  depends_on: [feat-db-schema-seed]
  affects_files:
    - apps/api/src/routes/tribes.ts
    - apps/api/src/middleware/current-tribe.ts
    - apps/api/src/server.ts # ← shared
- id: feat-test-seed-routes
  depends_on: [feat-db-schema-seed]
  affects_files:
    - apps/api/src/routes/test-seed.ts
    - apps/api/src/server.ts # ← shared
    - apps/api/src/plugins/**
```

Yet neither feature `depends_on` the other. Both dispatched in parallel on wave 3 (after `feat-db-schema-seed`), both authored their own `apps/api/src/{app,server}.ts` from scratch on disjoint branches, and the second close-feature merge hit add/add conflicts on 3 files:

```
CONFLICT (add/add): Merge conflict in apps/api/src/app.ts
CONFLICT (add/add): Merge conflict in apps/api/src/routes/test-seed.ts
CONFLICT (add/add): Merge conflict in apps/api/src/server.ts
```

The orchestrator's lockfile-auto-resolver doesn't handle add/add on source files; the conflict-handoff retried 3× and then emergency-aborted, cascade-failing `feat-tribes-route` + its 3 dependents (`feat-events-routes`, `feat-calendar-views`, `feat-event-detail`).

## Reproduction Steps

1. Author a `docs/tasks.yaml` with two features at the same wave that both list `apps/api/src/server.ts` (or any other shared canonical file) in `affects_files[]` and both have no `depends_on` cross-link.
2. Run `/start-build <project>` with `maxConcurrentFeatures >= 2`.
3. Observe: both features dispatch in parallel; both backend-builder agents create `apps/api/src/server.ts` on disjoint branches; second close-feature merge hits `CONFLICT (add/add)` on `server.ts` (and any other shared file).
4. After 3 conflict-handoff retries the orchestrator emergency-aborts the second feature; its dependents cascade-fail.

Empirical run: gotribe-event-calendar 2026-05-17, run-id `f07db107-df93-42e6-8150-72b2993ba587`. 5/9 features merged, 4 failed (1 conflict + 3 cascade). $15.76 burned before manual recovery.

## Hypothesis on the root cause

Either:

(a) **The overlap detection logic in PM SKILL.md §4b is incomplete.** The skill says "compute pairwise glob-overlap using minimatch semantics. Two features overlap if any glob in feature A matches a path that any glob in feature B would also match (literal path comparison after expansion is fine for the conservative case)." If implemented as a literal-path equality check, `apps/api/src/server.ts` vs `apps/api/src/server.ts` would obviously match — but if implemented as a minimatch-only glob expansion that requires either side to be a `**` glob to fire, the literal-vs-literal case would silently fall through.

(b) **The PM agent skipped step 4b.** The bug-018 failure mode — PM glossing over the file-affinity check entirely — could be happening despite the §0 grep enforcement, perhaps because the agent satisfied itself with §0's "schema field is present" check and didn't actually run the overlap analysis. The empirical signal that DISTINGUISHES (a) from (b) is: did PM emit any `file-affinity-serialization` warnings into `tasks.yaml.warnings[]`? On this run, `tasks.yaml.warnings[]` is empty — which is consistent with EITHER interpretation (logic bug → no overlap detected → no warning) OR (skipped step → no warning).

(c) **The PM dispatch prompt under-emphasised the literal-equal case.** My dispatch (operator hand-off) explicitly told PM to populate affects_files but didn't bullet-point that the overlap check applies to literal-equal entries — just the §4b text in SKILL.md. The agent may have interpreted the check as "scan for glob overlaps" and missed the literal-identical case.

## Related prior work

- **bug-015 (archived 2026-04-27)** — Original parallel-feature source-contention case (kanban-webapp-08, `apps/web/lib/store/index.ts` shared between `feat-settings-data` + `feat-board-core`). Phase 2 introduced the §4b auto-serialization mechanism. The mechanism works in the modify/modify case; this new bug surfaces the **add/add** sibling case.
- **bug-018 (archived 2026-04-28)** — PM agents fabricating reasons to skip §4b. Three of four PM agents claimed `affects_files` wasn't in the schema (false). §0 added the mandatory grep check. This bug may indicate §0's enforcement is necessary but not sufficient.
- **bug-119 (active)** — Distinct sibling: affects_files OMITS a needed file (`packages/utils/tsconfig.json`). Coverage/omission gap. THIS bug is the opposite: file IS listed but overlap detection didn't act.

## Investigation Plan

1. **Read PM SKILL.md §4b implementation guidance verbatim.** Confirm whether the documented algorithm is "literal path equality OR glob overlap" or just "glob overlap" (which would fail on literal-vs-literal because neither side has a `*` to expand against).
2. **Read `.claude/agents/project-manager.md`** — see if §4b is restated; check whether the agent's prompt instructs it on the overlap-detection mechanic vs leaving it to inference.
3. **Inspect the latest `docs/tasks.yaml` PM artefacts across recent projects** (gotribe-tribe-directory, gotribe-member-profile, gotribe-event-calendar) — grep for cases where two features share a canonical file via literal path AND aren't auto-serialized. Build a corpus of (a) vs (b) signal.
4. **Decide fix shape**:
   - If logic gap (a): extend the §4b algorithm spec to be explicit about literal-equal as a sufficient condition, then verify the PM agent's authoring follows the updated spec.
   - If skip-the-step (b): strengthen §0 enforcement to require PM to emit a "ran-§4b" sentinel in `tasks.yaml.warnings[]` even when zero overlaps detected ("no file-affinity overlaps found across N features × M pairs checked"). Absence of the sentinel becomes a hard signal that §4b was skipped.
   - If prompt under-emphasis (c): update factory dispatch templates (orchestrator/src/pm-dispatch.ts or equivalent) to bullet the canonical-shared-file case as a stop-and-think.

## Proposed Fix Shape (Phase 1 — minimum-viable)

Add to PM SKILL.md §4b a worked example explicitly covering the add/add literal-path case (`apps/api/src/server.ts` in two features), and require an emit of `file-affinity-no-overlaps` into `tasks.yaml.warnings[]` when the check ran but found zero overlaps. Absence of that warning AND zero `file-affinity-serialization` entries is a sign the check was skipped.

## Out of scope

- Solving merge-conflict-handoff competency at the git-agent level (separate concern; bug-015 Phase 3 territory).
- Adding a `verifyAffectsFilesCompleteness` mechanical check on tasks.yaml (overlaps with bug-119's territory).

## Acceptance criteria

- [ ] Root cause classified as (a), (b), or (c)
- [ ] PM SKILL.md §4b updated to make the literal-equal case explicit
- [ ] PM agent emits a `file-affinity-no-overlaps` sentinel warning when the check ran without finding any overlaps (turns "no warnings" from ambiguous → load-bearing-clean)
- [ ] Regression test added: synthetic 2-feature input where both list `apps/api/src/server.ts` literally; PM output must include `depends_on` cross-link between them
- [ ] Empirical re-run on a fresh project mirroring gotribe-event-calendar's shape: feat-tribes-route + feat-test-seed-routes must auto-serialize

## Attempt Log

_None yet — plan in draft._
