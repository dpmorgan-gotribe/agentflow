---
id: feat-012-task-screens-mapping
type: feature
status: completed
approved-at: 2026-04-23
approved-by: human
completed-at: 2026-04-23
author-agent: claude
created: 2026-04-23
updated: 2026-04-23
parent-plan: null
supersedes: null
superseded-by: null
branch: feat/task-screens-mapping
affected-files:
  - packages/orchestrator-contracts/src/tasks.ts
  - packages/orchestrator-contracts/tests/tasks.test.ts
  - schemas/tasks.schema.json
  - .claude/skills/pm/SKILL.md
  - .claude/agents/web-frontend-builder.md
  - .claude/agents/mobile-frontend-builder.md
  - scripts/validate-tasks-yaml.mjs
feature-area: orchestration
priority: P1
attempt-count: 0
max-attempts: 5
---

# feat-012-task-screens-mapping: explicit screen-to-task mapping in tasks.yaml

## Problem Statement

Builders read `docs/screens/{platform}/*.html` as a wildcard input, so the "which screens does this feature own?" decision is agent-inferred rather than spec'd. Current `TaskSchema` (`packages/orchestrator-contracts/src/tasks.ts:60`) only carries `estimated_screens: N` — a count, not a list. Two failure modes this invites on first live Mode B:

- **Under-scoping**: a frontend-builder looks at the screens dir, guesses "these three look auth-related", implements them, and misses one that's actually part of the auth flow but lives in a differently-named file.
- **Overlap conflict**: two features touch the same screen (e.g. `feat-billing` + `feat-account-settings` both edit the subscription card). Each builder produces separate JSX for the same screen; merge-conflict routing fires or the later feature silently overwrites the earlier.

The PM already reads `docs/analysis/{platform}/flows.md` which contains explicit screen sequences per flow (`welcome.html → signup.html → verify-email.html → ...`). The mapping data exists; it just isn't propagated into `tasks.yaml` for the builder to consume.

Fix: add an explicit `screens: string[]` field to `TaskSchema`, populate it in PM mode=tasks by resolving flow-referenced screens against `docs/screens-manifest.json`, and narrow the builder agents' screen-scope from wildcard to the task's declared list.

## Approach

1. **Schema extension (`packages/orchestrator-contracts/src/tasks.ts` + `schemas/tasks.schema.json`)**

   Add to `TaskSchema`:

   ```typescript
   screens: z.array(
     z.string().regex(/^(webapp|mobile|admin|desktop)\/[a-z0-9][a-z0-9-]*$/),
   ).default([]);
   ```

   Values are `{platform}/{screenId}` strings (no `.html` suffix), resolvable against `docs/screens-manifest.json.files[].screenId` + `.platform`. Default `[]` — back-compat for non-frontend tasks (backend-builder / tester / reviewer / devops don't own screens).

2. **Screen-scope invariant**

   Add a cross-field rule: for every task whose `agent` is a frontend-builder (`web-frontend-builder` OR `mobile-frontend-builder`) AND the parent feature's `skip[]` does NOT exclude that surface, `task.screens.length >= 1` (else warn: "frontend task has no assigned screens — overly narrow or missing flow"). Non-frontend tasks MUST have `task.screens.length === 0`.

3. **PM mode=tasks screen-resolution (`.claude/skills/pm/SKILL.md` §2–3)**

   Between current step 2 (feature-graph heuristic) and step 3 (compose structure), add step 2b:
   - For each feature that originated from a flow in `docs/analysis/{platform}/flows.md`:
     - Parse the flow's `**Screens**:` section to extract screen filenames (`welcome.html` → `welcome`)
     - Cross-reference against `docs/screens-manifest.json.files[]`: keep entries where `platform` matches the relevant frontend task AND `screenId` appears in the flow's sequence
     - Write the matched `{platform}/{screenId}` strings into `task.screens[]`
   - For features that originated from an integration (not a flow): leave `task.screens[]` empty if no flow associates; else carry the intersection.
   - **Overlap detection**: after all features are resolved, scan for screens claimed by ≥2 features. On overlap → emit warning listing the contested screens + feature IDs + surface in `tasks.yaml.warnings[]`. Don't auto-resolve; this is a PM signal that the flow decomposition is wrong.

4. **Builder agent updates (`.claude/agents/web-frontend-builder.md` + `.claude/agents/mobile-frontend-builder.md`)**

   Update the `## Screen-to-code translation` section: builder reads `feature.tasks.filter(t => t.agent === "<self>").flatMap(t => t.screens)` as the EXACT scope. Only those screens are in scope for this invocation. Update the `Inputs` table — `docs/screens/{platform}/*.html` (wildcard) → `docs/screens/{platform}/{screenId}.html` (per-task, resolved from `task.screens[]`). Flag silently-missing scoped screens as an abort-level precondition failure.

5. **Validator (`scripts/validate-tasks-yaml.mjs`)**

   Add a check pass: for each task's `screens[]` entry, confirm the path pattern + that the referenced screen exists in `docs/screens-manifest.json` when that file is present. When `screens-manifest.json` is absent (PM runs before `/screens` in refactor-003 ordering — architect runs POST-screens), skip the existence check but still validate the pattern.

   **Ordering verification** (refactor-003): `/pm` runs AFTER `/screens` in the 12-stage Mode A (`pm` depends on `architect` which depends on `user-flows` which depends on `visual-review` which depends on `screens`). So `screens-manifest.json` exists when PM runs. Confirm + document in plan's validation section.

6. **Tests**
   - Contract test (`packages/orchestrator-contracts/tests/tasks.test.ts`) — new block: `TaskSchema.screens[] shape`. Asserts pattern regex, default `[]`, valid samples (`webapp/home`, `mobile/feed`), invalid rejections (uppercase, `.html` suffix, unknown platform).
   - PM sub-test (if a unit test exists for PM-shape composition, add a case; else mock via integration-style test against a fixture `flows.md` + `screens-manifest.json` → expected `tasks.yaml`). If PM has no test harness currently, scope this to a single fixture-based case.

## Rejected Alternatives

- **Alternative A: per-screen tasks instead of per-feature tasks** — Rejected. Explodes task count (one 20-screen app = 20 tasks even for backend-free UI work), blurs the "feature = agent_sequence" model, and doesn't meaningfully improve builder scope beyond the list-on-task approach. The feature-level grouping is intentional (per refactor-004); this plan keeps it and just enriches task metadata.

- **Alternative B: leave as wildcard; trust builders to infer** — Rejected. That's the current state; its failure modes are documented above. First live run is the wrong time to discover whether agent inference holds up when the model is deciding which of 40+ screens belong to `feat-auth`. Cheap insurance.

- **Alternative C: compute screens[] lazily in the orchestrator at `runFeature` time** — Rejected. Same logic, worse placement: orchestrator would need to re-parse flows + screens-manifest on every feature invocation, and the data wouldn't be auditable in `tasks.yaml` (humans reviewing gate 4 sign-off wouldn't see the assignment). Tasks.yaml is the declarative contract; put the mapping there.

- **Alternative D: store screens[] on the feature, not the task** — Rejected for web/mobile split cases. A feature with both `web-frontend-builder` and `mobile-frontend-builder` tasks touches BOTH `webapp/...` and `mobile/...` screens; per-task split lets the web builder load only web screens and vice versa. Feature-level would force both builders to filter the same list.

## Expected Outcomes

- [ ] `TaskSchema.screens: z.array(z.string()).default([])` with pattern validation
- [ ] `schemas/tasks.schema.json` mirrors the Zod addition (JSON-schema definition tracks contract)
- [ ] PM mode=tasks populates `task.screens[]` for every frontend task that maps to a flow
- [ ] PM overlap-detection warns on screens claimed by ≥2 features
- [ ] Web + mobile builder docs reference `task.screens[]` as the binding scope (not wildcard)
- [ ] `scripts/validate-tasks-yaml.mjs` enforces the new field + cross-references screens-manifest when available
- [ ] Contracts test count: 168 → ≥172 (≥4 new tests for TaskSchema.screens)
- [ ] Orchestrator tests unchanged (145)
- [ ] Plan archived before first live Mode B run on hatch

## Validation Criteria

**Contract coverage:**

- Pattern accepts `webapp/home`, `mobile/feed-detail`, `admin/users-list`
- Pattern rejects `Web/Home` (case), `webapp/home.html` (suffix), `weba/home` (bad platform)
- Default `[]` when omitted

**Cross-field invariants:**

- Frontend task on a non-skipped surface with `screens.length === 0` → warning (not fail — some frontend work is kit-only or routing-only)
- Backend-builder / tester / reviewer / devops tasks with `screens.length > 0` → validation fail
- Two features claiming the same `{platform}/{screenId}` → `warnings[]` entry in `tasks.yaml`, with both feature IDs

**PM behavior:**

- Fixture: 2-feature `flows.md` + 6-screen `screens-manifest.json` → tasks.yaml has `screens[]` populated on frontend tasks, covering all 6 screens, with no overlap
- Overlap fixture: same screen listed in 2 flows → `warnings[]` contains overlap note; `screens[]` populated on both tasks

**Builder behavior:**

- Builder doc explicitly states: "Scope is `feature.tasks.filter(t => t.agent === '<self>').flatMap(t => t.screens)`. Do NOT process screens outside this list."

**No regression:**

- `pnpm -r test` green; contracts 168 → ≥172
- `pnpm generate mindapp-v2 --dry-run` output unchanged (dry-run doesn't invoke PM)

## Attempt Log

### Attempt 1 — 2026-04-23 — completed

Single pass; one rework on TS strict-build (test fixtures needed `screens: []`).

- `TaskScreenRef` Zod regex + `TaskSchema.screens` array with `.default([])`
- `TaskSchema.superRefine` — rejects non-frontend agents declaring screens
- `schemas/feature.schema.json` — mirrors the field with the same pattern
- `scripts/validate-tasks-yaml.mjs` — 3 new invariant checks (non-frontend zero-screens hard fail, cross-feature overlap warning, manifest existence cross-check)
- PM skill step 2b — flows.md → screens-manifest.json resolution algorithm + overlap detection
- Web + mobile builder agents — scope narrowed from wildcard `docs/screens/{platform}/*.html` to `task.screens[]` list; precondition-fail check if declared screen missing
- Contracts tests: +7 (168 → 175). Orchestrator tests: 145 unchanged. Total: 320 green.
- Validator fixture smoke-tested: happy path passes; non-frontend-screens hard-fails with clear error; same-screen-in-two-features warns.

### Lessons learned

- **`z.array(...).default([])` makes the field required in the inferred type, not optional.** Tests constructing `Task` objects as literals (not via `.parse()`) hit TS2741 for every fixture. Same pattern exists on `depends_on` + `skills` + `status` — established. Adding `screens: []` to the ~10 affected test fixtures was a one-line `replace_all` against `depends_on: [],\n    skills: [],\n    status: "pending",\n},` — tolerable because the pattern was consistent. Future schema additions should follow the same idiom and accept the fixture-update tax.
- **`pnpm --filter <pkg> typecheck`** (noEmit) is more lenient than **`pnpm --filter <pkg> build`** (with emit). Typecheck passes silently; build catches strict-ness issues. Always run both before claiming done — this is the second time this session a noEmit-clean change broke the emitting build.
- **`superRefine` is the right home for "this field's value depends on another field"** invariants when Zod can't express them structurally. The `TaskAgent` enum can't be narrowed to frontend-only without breaking non-frontend task shape, so a post-parse refinement is the correct tool. Schema and validator both enforce; double-binding is OK because they run at different times.
