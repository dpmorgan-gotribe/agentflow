---
id: bug-019-new-project-force-schema-sync
type: bug
status: archived
author-agent: claude-opus-4-7
created: 2026-04-28
updated: 2026-04-28
parent-plan: bug-018-pm-skips-affects-files
supersedes: null
superseded-by: null
branch: fix/new-project-force-schema-sync
affected-files:
  - .claude/skills/new-project/SKILL.md
  - scripts/sync-project-schemas.mjs (NEW)
  - .claude/skills/pm/SKILL.md (cross-ref to sync)
feature-area: orchestration
priority: P1
attempt-count: 0
max-attempts: 5
error-message: null
reproduction-steps: |
  1. Pick any project scaffolded before a factory-side schema change
     (verified true for all 4 pre-build projects on 2026-04-28).
  2. Compare project schema to factory schema:
       diff projects/<name>/schemas/feature.schema.json schemas/feature.schema.json
     Result: differs (project is stale).
  3. Run /new-project <name> --force.
  4. Re-diff: still differs. The --force refresh did NOT propagate the
     schema update.
  5. Run /pm against the project. Per bug-018 §0 the PM resyncs the
     schema as a workaround, but this should not be the PM's job — the
     refresh mechanism should handle it.
stack-trace: null
---

# bug-019-new-project-force-schema-sync: /new-project --force does not propagate factory schema updates

## Bug Description

The factory ships canonical JSON Schemas at `schemas/*.schema.json` (regenerated
from the Zod source-of-truth in `packages/orchestrator-contracts/src/`).
Generated projects under `projects/<name>/schemas/` get a copy at
`/new-project` time.

When the factory schema evolves (e.g. bug-015 Phase 2 adding the
`affects_files` property to `FeatureSchema`), no mechanism propagates the
update to existing projects. `/new-project --force` is supposed to "refresh
agentic resources in an existing project without losing user content" (per
CLAUDE.md), but it does not currently sync the `schemas/` directory.

**Result:** every project scaffolded before a schema change has stale
schemas. Downstream agents (PM, validator scripts) hit one of two failure
modes per bug-018:

1. **Honor the stale constraint** — silently skip new fields, breaking
   features built on them (bug-015 Phase 2 file-affinity gate dies in
   silence).
2. **Silently mutate the project schema** — patch the missing field into
   the local schema as a side-effect of the agent's work. Hides the drift;
   the human never sees it.

Both are silent failures. The right behavior is for the project schema to
stay in lock-step with the factory canonical via a refresh mechanism, so
agents never have to choose.

## Reproduction Steps

```bash
# All 4 pre-build projects shipped before bug-015 Phase 2 (which added
# affects_files). Their HEAD schemas are missing the field:
for p in book-swap-pre-build finance-track-pre-build kanban-webapp-pre-build repo-health-dashboard-pre-build; do
  echo -n "$p: "
  cd "projects/$p" && git show HEAD:schemas/feature.schema.json | grep -c '"affects_files"' && cd -
done
# Output: 0 in all 4 (field MISSING in HEAD)

# Factory schema HAS it:
grep -c '"affects_files"' schemas/feature.schema.json
# Output: 1
```

## Error Output

No error — the failure is silent. Until bug-018's pm SKILL.md §0 fix
landed, the symptom only surfaced when an operator ran `git diff` against
the project schema after a PM run and noticed the schema had changed
without explanation.

## Root Cause Analysis

`/new-project --force` (in `.claude/skills/new-project/SKILL.md`) walks
several agentic-resource directories and overlays factory copies onto
projects. The `schemas/` directory is not in the overlay list.

Likely reason: schemas are NOT git-ignored project-side (unlike `.claude/`),
so the original `/new-project` author treated them as project-resident
artifacts that, once created, belong to the project. That assumption was
correct at scaffolding time but breaks down whenever the factory schema
evolves.

## Fix Approach

1. **Add a sync step to `/new-project --force`** — overlay
   `factory/schemas/*.schema.json` onto `projects/<name>/schemas/`. Use
   `cp -r` (factory wins on conflict). Emit one log line per file synced.
2. **Author `scripts/sync-project-schemas.mjs`** — standalone CLI that does
   just the schema sync, callable both from `/new-project --force` and
   ad-hoc by operators (e.g. when they suspect drift between PM runs).
3. **Cross-reference from `pm SKILL.md` §0** — when PM detects schema
   drift, point at `node scripts/sync-project-schemas.mjs <projectDir>`
   instead of the current "patch and continue" flow.
4. **Audit OTHER project-resident factory artifacts for the same gap** —
   `scripts/validate-*.mjs`, `schemas/tasks.schema.json`,
   `schemas/brief-frontmatter.schema.json`, etc. The drift class is
   broader than just feature.schema.json.
5. **Sync the 4 existing pre-build projects' schemas** via the new script
   (or directly via `/new-project --force` once it's fixed).

## Rejected Fixes

- **"Make schemas a git submodule"** — rejected; submodules are operator
  cognitive overhead and break the "each project is a self-contained
  repo" invariant.
- **"Have PM always sync schemas before authoring"** — what bug-018's
  SKILL.md §0 currently prescribes as the workaround. Rejected as a
  permanent solution because it puts the burden on every consumer of
  schemas (PM, validators, future stages) instead of fixing the source.
  PM-side syncing should remain as a fallback, not the primary mechanism.
- **"Symlink projects/<name>/schemas/ → factory/schemas/"** — rejected;
  symlinks are platform-fragile (Windows in particular) and break the
  per-project-repo invariant.

## Validation Criteria

- `node scripts/sync-project-schemas.mjs projects/kanban-webapp-pre-build`
  → exits 0; writes one log line per file; project's
  `schemas/feature.schema.json` matches factory byte-for-byte after run.
- `/new-project <existing> --force` → re-running on a pre-bug-019 project
  results in synced schemas (verifiable via `diff projects/<name>/schemas/
schemas/`).
- Spot-check OTHER project-resident factory files for staleness; report
  any not yet synced.
- After fix lands, all 4 pre-builds + repo-health-dashboard-01 (E2E
  target) have schemas matching factory.

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->

---

# COMPLETION RECORD (appended on archive)

completed: 2026-04-28
outcome: success
actual-files-changed:

- scripts/sync-project-schemas.mjs (created)
- .claude/skills/new-project/SKILL.md (modified)
- .claude/skills/pm/SKILL.md (modified)
  commits:
- hash: f73e5f0
  message: "bug-019: schema-sync mechanism for /new-project --force + ad-hoc operator"
  attempts: 1
  lessons:
- "When a refresh-mode SKILL doesn't enumerate every category that needs sync, drift is silent. The /new-project --force overlay table never listed schemas/ — projects scaffolded before bug-015 Phase 2 stayed stale forever. Lesson: every project-resident factory artifact needs an explicit entry in the refresh-overlay list, with a guard that flags new factory categories at validation time."
- "Initial dry-run against all 12 projects revealed the actual drift was much wider than the bug-018 framing suggested: 4-6 newer schemas missing per project (brief-capabilities, bugs-yaml, build-to-spec-verify-output, parity-verify-output, screen-fixture, tasks-coverage) plus several validators stale or missing. Always dry-run-then-fix scripts that can't easily be reverted."
- "Idempotency via byte-compare (not mtime / hash) is the right choice for sync scripts that may be invoked repeatedly during operator triage. Re-runs just confirm no-op without spurious updates."
  test-results:
  unit: smoke-tested via --dry-run against 12 projects + --all run (idempotent on second invocation)
  integration: confirmed all 12 project schemas now match factory byte-for-byte
  duration-minutes: 50
