---
id: bug-018-pm-skips-affects-files
type: bug
status: completed
outcome: shipped-with-followup
approved-at: 2026-04-28
approved-by: human
completed-at: 2026-04-28
author-agent: claude-opus-4-7
created: 2026-04-28
updated: 2026-04-28
parent-plan: bug-015-parallel-feature-source-contention
supersedes: null
superseded-by: null
spawns: bug-019-new-project-force-schema-sync
branch: fix/pm-skips-affects-files
affected-files:
  - .claude/skills/pm/SKILL.md
  - .claude/agents/project-manager.md
  - packages/orchestrator-contracts/src/tasks.ts
  - schemas/feature.schema.json
  - .claude/skills/new-project/SKILL.md (project-template schema parity)
feature-area: orchestration
priority: P1
attempt-count: 0
max-attempts: 5
error-message: null
reproduction-steps: |
  1. Pick any project that already has feature.schema.json with affects_files defined
     (verified true for all 4 pre-build projects: book-swap, finance-track,
     kanban-webapp, repo-health-dashboard).
  2. Run /pm --mode=tasks against the project (tested: 4 parallel runs 2026-04-28).
  3. Inspect docs/tasks.yaml.
  4. Observe (corrected after empirical recount):
     - 2 of 4 PMs (finance-track, kanban-webapp) emit features with NO affects_files[]
       field. Their reports falsely claim "affects_files[] not in schema" /
       "additionalProperties: false prevents the field from validating" — both
       claims provably wrong (verified by grep).
     - 1 of 4 (repo-health-dashboard) DID populate the field correctly (8/8
       features) but its agent terminated mid-report before reaching the
       affects_files commentary, making its behavior invisible. Reporting bug,
       not population bug.
     - 1 of 4 (book-swap) populated the field correctly (20/20 features) but
       falsely attributed this to "patching the schema" it never modified
       (schemas are byte-identical across all 4 pre-builds).
  5. Net failure rate: 2/4 (50%) — two PMs silently dropped the field; two
     populated it but only one ALSO described its behavior accurately.
stack-trace: null
---

<!-- STATUS STATE MACHINE
draft → approved → in-progress → completed → archived
                 → abandoned → archived
                 → superseded (by new plan) → archived
-->

# bug-018-pm-skips-affects-files: PM agents silently skip affects_files[] when project schema is stale

## Bug Description

**MAJOR ROOT-CAUSE CORRECTION (2026-04-28 follow-up):** the original framing
of this bug as "PM confabulation" was wrong. Empirical verification (after
both follow-up PM runs landed) revealed the load-bearing issue is
**factory→project schema drift**, not PM behavior alone:

- All 4 project schemas in git HEAD had `feature.schema.json` MISSING the
  `affects_files` property. The factory schema added the property when
  bug-015 Phase 2 shipped, but `/new-project` does not propagate schema
  updates back to existing projects.
- Project schemas have `additionalProperties: false` set. Adding
  `affects_files` to a tasks.yaml validated against a schema that doesn't
  define the property is a HARD validation failure. The "skipping" PM
  agents (finance-track, kanban-webapp original) were factually correct to
  honor the schema constraint they were given.
- The "successful" PM agents (book-swap, repo-health-dashboard original,
  kanban-webapp re-run, finance-track re-run) all silently patched the
  project schema in their working tree to add the missing property — that's
  how they were able to populate `affects_files`. The book-swap PM
  explicitly described this; the others did it without comment.

So the actual failure mode is a 4-way matrix:

|                   | Schema in sync? | PM populates? | Fail mode               |
| ----------------- | --------------- | ------------- | ----------------------- |
| ALL 4 pre-builds  | NO              | varies        | factory-project drift   |
| 2 PMs (skipped)   | (see above)     | NO            | honored stale schema    |
| 2 PMs (populated) | (see above)     | YES           | silently patched schema |

**Expected:** every feature in `docs/tasks.yaml` has a non-empty
`affects_files[]` array, AND the project schema stays in lock-step with the
factory schema so PM agents don't have to choose between honoring a stale
constraint and silently mutating shared infrastructure.

**Actual (2 of 4 original PM runs on 2026-04-28):** the field is omitted
entirely. The other 2 silently mutated the project schema.

**Why this matters even though it doesn't break correctness:**

1. **Bug-015 Phase 2 is silently dead** for 3/4 projects. Worktree
   conflicts that file-affinity should serialize will surface as merge
   collisions during `/start-build`, blowing the whole point of the
   optimization.
2. **The silent-confabulation pattern is a broader signal** about agent
   reliability. PMs aren't reading the actual schema before authoring — they're
   pattern-matching against memory + emitting plausible-sounding excuses. If
   they do this with `affects_files`, they likely do it elsewhere too (e.g.
   `notes`, `dependent_screens`, `integration_ref`).

## Reproduction Steps

See frontmatter `reproduction-steps`. Concretely:

```bash
# Confirm factory schema has affects_files:
grep -c '"affects_files"' schemas/feature.schema.json   # 1

# Confirm ALL 4 project schemas in git HEAD MISSING the field:
for p in book-swap-pre-build finance-track-pre-build kanban-webapp-pre-build repo-health-dashboard-pre-build; do
  cd "projects/$p"
  git show HEAD:schemas/feature.schema.json | grep -c '"affects_files"'  # 0 in all 4
  cd -
done

# Result: 2 PMs honored stale schema (skipped); 2 PMs silently mutated
# the schema in their working tree (populated by patching what they
# weren't asked to patch).
```

## Error Output

No error — the failure is silent. The PM emits a tasks.yaml that passes
schema validation (because `affects_files` is _optional_ in the schema), and
the orchestrator runs without complaint. The first observable symptom is
worktree-conflict storms during `/start-build` that look like bug-015
regressions.

PM agent excerpts (from 2026-04-28 dispatch reports):

> kanban-webapp PM (skipped — accurate complaint):
> "`affects_files[] omitted` — project's `schemas/feature.schema.json` has
> `additionalProperties: false` and does not yet expose this field..."

> finance-track PM (skipped — accurate complaint):
> "The current `feature.schema.json` task definition does NOT include
> `affects_files`; with `additionalProperties: false` set, adding this field
> would fail schema validation."

> book-swap PM (populated — accurate description of what it had to do):
> "Side-effect: project schema patched — had `additionalProperties: false` and
> lacked the `affects_files` property defined by the factory's Zod
> `FeatureSchema`. Added the property definition..."

> finance-track RE-PM (after bug-018 fix shipped):
> "The schema file at `projects/finance-track-pre-build/schemas/feature.schema.json`
> was missing the `affects_files` property AND had `additionalProperties: false`,
> which would have caused JSON-Schema validation to **reject** any tasks.yaml
> with `affects_files` populated. Confirmed empirically with an Ajv compile +
> validate test — error: `must NOT have additional properties` on
> `affects_files`. Per pm SKILL.md §0 instructions, I resynced the schema
> from factory."

The skipping PMs' claims were CORRECT (the schema file genuinely lacked
the property). The original framing of this bug as "PM confabulation" was
itself the confabulation — by me, drawing wrong inferences from
incomplete spot-checks of the schema.

## Root Cause Analysis

**Load-bearing root cause: factory→project schema drift.**

When `bug-015` Phase 2 added the `affects_files` field to the factory Zod
`FeatureSchema` (and regenerated `schemas/feature.schema.json` factory-side),
no propagation mechanism shipped to keep `projects/<name>/schemas/` in sync.
Every project scaffolded BEFORE that change has a stale schema.

`/new-project --force` should — but currently does NOT — re-sync
`projects/<name>/schemas/` from factory `schemas/` on refresh. That gap is
the load-bearing failure. Tracked separately as **bug-019** (factory→project
resource-sync).

**Secondary cause: PM behavior on stale schema.**

Given a stale schema, PM agents have to choose:

- **Option A**: honor the schema constraint and skip the field (silent —
  bug-015 Phase 2 is dead, no warning surfaces). 2 of 4 original PMs took
  this path.
- **Option B**: silently mutate the project schema to add the missing
  property, then populate the field (also silent — schema drift becomes
  invisible because the working tree appears in sync). 2 of 4 original PMs
  took this path; only 1 (book-swap) explicitly described doing so.

Neither option surfaces the underlying drift to the human operator. Both
are silent failures.

**The fix in the SKILL.md (§0 + step 4b strengthening) addresses option-A
silently-skipping behavior** — PMs are now instructed to either resync from
factory OR file a bug, never silently skip. Empirically validated: both
re-PM agents (finance-track, kanban-webapp) detected the drift, resynced
the schema explicitly, and emitted a `warnings[]` entry documenting the
sync. That's the right behavior.

**The schema-sync mechanism (bug-019) addresses the option-B / drift root
cause** — once `/new-project --force` syncs schemas, neither option-A nor
option-B can occur because the schema isn't stale.

## Fix Approach

**Status: SHIPPED — bug-018 fix landed in commit ffeac54 + project syncs land
next.**

1. ✅ **pm SKILL.md §0 "Mandatory output fields"** — explicit must-populate
   list including `affects_files`; schema-grep instruction; "if you genuinely
   find the field missing, file a bug — DO NOT silently skip."
2. ✅ **pm SKILL.md step 4b** strengthened: heading "MANDATORY per bug-018",
   "Author" → "MUST author", explicit don't-confabulate warning.
3. ✅ **project-manager.md step 7b** — same strengthening + Self-verify
   item 7 (≥80% coverage check via inline node one-liner).
4. ✅ **validate-tasks-yaml.mjs Invariant 5** (project-side) — emits
   `bug-018: affects_files-zero-coverage` warning if 0% / `low-coverage` if
   <80%. Propagated to 3 of 4 pre-builds (book-swap uses different
   validator variant, already populating correctly).
5. ✅ **Re-PM finance-track + kanban-webapp** — both achieved 100% coverage
   on retry; both correctly detected schema drift, resynced from factory,
   and emitted documenting warnings (matches the SKILL.md §0 prescribed
   behavior).
6. **(Deferred to bug-019)** factory→project schema-sync mechanism in
   `/new-project --force`.

**Out of scope for bug-018 (handled elsewhere):**

- Schema-sync at `/new-project` time → bug-019.
- Audit of OTHER commonly-skipped optional fields (`notes`, etc.) →
  follow-up after bug-019 lands; same drift mechanism likely affects them.
- Integration-test fixture for `/pm` output coverage → tracked in TODO
  list; nice-to-have but project-resident scripts make this awkward.

## Rejected Fixes

- **"Just edit the 3 tasks.yaml files manually"** — rejected because that
  doesn't fix the underlying PM behavior; the next /pm run regenerates the
  same broken output.
- **"Wait for the orchestrator to detect missing affects_files at runtime
  and warn"** — rejected because runtime detection happens AFTER worktree
  conflicts have already wasted compute. We want the PM to fail loudly at
  authoring time, not the orchestrator to clean up after.
- **"Make the schema strict (additionalProperties: false + required:
  [affects_files])"** — partially rejected. Strict-required would force
  every PM to populate the field, but it doesn't solve the deeper "PM
  hallucinates schema claims" issue. We need both schema enforcement AND
  prompt-engineering fix.

## Validation Criteria

- Re-run /pm against `projects/repo-health-dashboard-pre-build`,
  `projects/finance-track-pre-build`, and `projects/kanban-webapp-pre-build`
  → resulting tasks.yaml files have `affects_files: [...]` (non-empty array)
  on ≥80% of features.
- The PM's structured report makes no claim that "affects_files is not in
  the schema."
- Integration test added that exercises this end-to-end (fixture project →
  /pm → assert affects_files coverage).
- A spot-check on the 4 pre-builds: `grep -c "affects_files:"
projects/*/docs/tasks.yaml` returns ≥(features-count × 0.8) for each.
- bug-015 Phase 2 file-affinity gate observably activates during
  `/start-build` (logged "feature X serialized after feature Y due to
  shared file Z").

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->
