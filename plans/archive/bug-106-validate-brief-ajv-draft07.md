---
id: bug-106-validate-brief-ajv-draft07
type: bug
status: archived
author-agent: claude-opus-4-7
created: 2026-05-15
updated: 2026-05-15
approved-at: 2026-05-15
completed-at: 2026-05-15
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/validate-brief-ajv-draft07
affected-files:
  - scripts/validate-brief.mjs
  - schemas/brief-capabilities.schema.json
  - schemas/architecture.schema.json
  - schemas/tasks.schema.json
  - schemas/tasks-coverage.schema.json
  - schemas/feature.schema.json
  - schemas/feature-context.schema.json
  - schemas/signoff.schema.json
  - schemas/visual-review-report.schema.json
feature-area: validators
priority: P1
attempt-count: 1
max-attempts: 5
error-message: 'no schema with key or ref "http://json-schema.org/draft-07/schema#"'
reproduction-steps: |
  1. cd into any factory-scaffolded project (gotribe-tribe-directory, reading-log-02)
  2. Ensure docs/brief-capabilities.json exists (produced by /analyze phase 5)
  3. Run: node scripts/validate-brief.mjs --all --keep-going
  4. Observe Ajv compile failure at validate-brief.mjs line 321
stack-trace: |
  Error: no schema with key or ref "http://json-schema.org/draft-07/schema#"
      at Ajv2020.validate (.../ajv@8.18.0/.../core.js:148:23)
      at Ajv2020.validateSchema (.../ajv@8.18.0/.../core.js:261:28)
      at Ajv2020._addSchema (.../ajv@8.18.0/.../core.js:461:18)
      at Ajv2020.compile (.../ajv@8.18.0/.../core.js:159:26)
      at checkBriefCapabilities (scripts/validate-brief.mjs:321:24)
---

# bug-106 — validate-brief.mjs cannot compile draft-07 brief-capabilities.schema.json under Ajv2020

## Bug Description

`scripts/validate-brief.mjs` imports `ajv/dist/2020.js` (the Ajv2020 build) for all three of its schema-validation call sites. Ajv2020 only ships the JSON Schema draft-2020-12 + draft-2019-09 meta-schemas. When the validator tries to compile `schemas/brief-capabilities.schema.json` (which declares `"$schema": "http://json-schema.org/draft-07/schema#"`), Ajv2020 attempts to validate the schema against its declared meta-schema, can't find draft-07 registered, and throws synchronously before any data validation runs.

Empirically reproduces on every factory-scaffolded project that has reached /analyze phase 5 (which emits `docs/brief-capabilities.json`). Verified on:

- `projects/gotribe-tribe-directory/` (2026-05-15, fresh from /analyze run)
- `projects/reading-log-02/` (same crash, same line, same stack trace)

This is NOT specific to the brief-capabilities.json _data_ — that file passes `JSON.parse` cleanly and manually inspecting its shape against `brief-capabilities.schema.json` confirms structural correctness. The crash is purely Ajv2020 refusing to compile the schema itself.

**Expected behavior**: `node scripts/validate-brief.mjs --all --keep-going` passes when brief.md + companion files are valid, and surfaces the structural errors when they aren't. Today the validator crashes irrespective of brief correctness as soon as `docs/brief-capabilities.json` exists.

**Actual behavior**: hard crash at `checkBriefCapabilities` (line 321) with the Ajv "no schema with key or ref" error. Earlier checks (frontmatter, codeblocks, companions, structure) all pass; the crash happens in the LAST capability-coverage check.

**Latent scope** — the same crash class will fire for every draft-07 schema if Ajv2020 is later wired to compile it. The factory currently has 8 draft-07 schemas (see Affected Files) and 9 draft-2020-12 schemas. Today only `brief-capabilities.schema.json` is in this hot path; other draft-07 schemas (architecture, tasks, feature, feature-context, signoff, tasks-coverage, visual-review-report) are validated by separate scripts that may use a different Ajv build OR may currently work by luck. The investigation should audit the full validator surface.

## Reproduction Steps

1. `cd projects/gotribe-tribe-directory` (or any factory-scaffolded project that has run `/analyze`)
2. Confirm `docs/brief-capabilities.json` exists and is valid JSON: `node -e "JSON.parse(require('fs').readFileSync('docs/brief-capabilities.json'))"` → silent success.
3. Run `node scripts/validate-brief.mjs --all --keep-going`.
4. Observe:
   - `✓ Frontmatter valid`
   - `✓ Code blocks present in §7, §10`
   - `✓ All companion files present and valid`
   - `markdownlint-cli2 ...` `Summary: 0 error(s)` → `✓ Structure (markdownlint) valid`
   - Then: `Error: no schema with key or ref "http://json-schema.org/draft-07/schema#"` followed by the Node stack trace shown in frontmatter.

The crash is deterministic. No flake.

## Error Output

```
markdownlint-cli2 v0.14.0 (markdownlint v0.35.0)
Finding: .../projects/gotribe-tribe-directory/brief.md brief.md brief-template.md !node_modules/** !.git/** !plans/** !contexts/** !scaffolding/**
Linting: 2 file(s)
Summary: 0 error(s)
✓ Structure (markdownlint) valid
C:\Development\ps\claude\claude_\agentflow_phase2\node_modules\.pnpm\ajv@8.18.0\node_modules\ajv\dist\core.js:148
                throw new Error(`no schema with key or ref "${schemaKeyRef}"`);
                      ^

Error: no schema with key or ref "http://json-schema.org/draft-07/schema#"
    at Ajv2020.validate (.../ajv@8.18.0/.../core.js:148:23)
    at Ajv2020.validateSchema (.../ajv@8.18.0/.../core.js:261:28)
    at Ajv2020._addSchema (.../ajv@8.18.0/.../core.js:461:18)
    at Ajv2020.compile (.../ajv@8.18.0/.../core.js:159:26)
    at checkBriefCapabilities (.../scripts/validate-brief.mjs:321:24)
    at async .../scripts/validate-brief.mjs:409:14

Node.js v22.18.0
```

## Root Cause Analysis

**Confirmed root cause** (one quick read of `scripts/validate-brief.mjs`):

```js
// scripts/validate-brief.mjs:149
const AjvModule = await loadDep("ajv/dist/2020.js");
const Ajv = AjvModule.default || AjvModule.Ajv2020 || AjvModule;
...
// scripts/validate-brief.mjs:319-321
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);  // ← throws here
```

The `Ajv2020` instance only ships draft-2019-09 + draft-2020-12 meta-schemas. The `brief-capabilities.schema.json` file declares:

```json
{ "$schema": "http://json-schema.org/draft-07/schema#", ... }
```

When `ajv.compile(schema)` is called, Ajv validates the SCHEMA itself against the declared meta-schema first (default behavior). Since draft-07 is not registered, it throws synchronously with "no schema with key or ref".

**Adjacent factory-wide concern**: 8 of 17 factory schemas (47%) declare draft-07:

| Schema                             | Meta-schema |
| ---------------------------------- | ----------- |
| `brief-capabilities.schema.json`   | draft-07 ⚠️ |
| `architecture.schema.json`         | draft-07    |
| `tasks.schema.json`                | draft-07    |
| `tasks-coverage.schema.json`       | draft-07    |
| `feature.schema.json`              | draft-07    |
| `feature-context.schema.json`      | draft-07    |
| `signoff.schema.json`              | draft-07    |
| `visual-review-report.schema.json` | draft-07    |

The other 9 use draft-2020-12. The crash only fires today because `validate-brief.mjs` is the only call site loading Ajv2020 and trying to compile a draft-07 schema in the same call site. The investigation should audit each other validator script to confirm whether they currently use a draft-07-compatible Ajv build (likely the default `ajv` import, not `ajv/dist/2020.js`) — and if so, decide whether the factory has a deliberate draft-07-vs-2020-12 split or an accidental one.

## Fix Approach

Two viable paths; pick during the plan-approval step.

### Option A — Bump `brief-capabilities.schema.json` to draft-2020-12 (smallest patch)

1. Change `"$schema": "http://json-schema.org/draft-07/schema#"` to `"$schema": "https://json-schema.org/draft/2020-12/schema"` in `schemas/brief-capabilities.schema.json`.
2. Verify Ajv2020 now compiles it cleanly: run `node scripts/validate-brief.mjs --all` against `projects/gotribe-tribe-directory/`.
3. Confirm the existing keywords used (`type`, `enum`, `const`, `required`, `additionalProperties`, `pattern`, `properties`, `items`, `minLength`) are all preserved in draft-2020-12 (they are — these are unchanged across drafts).
4. Sync the change to every project via `node scripts/sync-project-schemas.mjs projects/<name>` (script is already idempotent + reaches all projects via the standard sync flow).
5. Add a sentinel test: a tiny `tests/validate-brief-capabilities.test.mjs` that compiles + validates the schema against a known-good `brief-capabilities.json` fixture so future Ajv-version bumps don't regress.

**Pros**: ~5 line patch; touches one schema file + one downstream sync. **Cons**: doesn't address the latent factory-wide draft-07/2020-12 split — the other 7 draft-07 schemas remain vulnerable if any future validator imports `ajv/dist/2020.js`.

### Option B — Make `validate-brief.mjs` use a draft-07-compatible Ajv build

1. Change `loadDep("ajv/dist/2020.js")` to `loadDep("ajv")` (default build = draft-07; Ajv2020 is the special-case build).
2. This means `brief-capabilities.schema.json` stays draft-07; consistent with the other 7 draft-07 factory schemas.
3. Risk: any place in `validate-brief.mjs` that depends on draft-2020-12-specific features breaks. Audit the three `new Ajv(...)` call sites for `unevaluatedProperties`, `unevaluatedItems`, `$dynamicRef`, `$dynamicAnchor`, `prefixItems`, `contains.minContains/maxContains`. Quick `grep` against the three currently-compiled schemas (`brief-frontmatter.schema.json` is draft-2020-12; `navigation.schema.json` is draft-2020-12; `brief-capabilities.schema.json` is draft-07) tells us what's actually needed.

**Pros**: aligns with the de-facto factory-wide draft-07 convention for the OTHER 7 schemas. **Cons**: bigger blast radius (touches the validator script, not a schema file); requires audit of draft-2020-12-specific keyword usage.

### Option C — Add draft-07 meta-schema to the Ajv2020 instance (compatibility shim)

1. In `validate-brief.mjs`, after constructing `new Ajv(...)`, call `ajv.addMetaSchema(require('ajv/dist/refs/json-schema-draft-07.json'))`.
2. This makes the same Ajv2020 instance accept both draft-07 and draft-2020-12 schemas.
3. Cleanest middle ground if the factory genuinely wants a mixed-meta-schema regime.

**Pros**: heterogeneous-meta-schema factory works; no schema-file changes; no validator-script meta-schema change. **Cons**: every Ajv instance creation site needs the same shim — easy to forget at the next call site; adds a non-obvious dependency.

### Recommendation

**Option A** (bump the schema to draft-2020-12) is the smallest, most isolated fix. Open the operator question of "should the factory enforce a single meta-schema regime?" as a separate `/plan-refactor` AFTER this bug ships. Keep this bug narrow: get `validate-brief.mjs --all` green.

## Rejected Fixes

(Populated during investigation. Currently empty — no fix attempts yet.)

## Validation Criteria

1. The original error no longer occurs: `node scripts/validate-brief.mjs --all --keep-going` exits 0 when run inside `projects/gotribe-tribe-directory/` with the existing `docs/brief-capabilities.json`.
2. The same command exits 0 when run inside `projects/reading-log-02/` (the canary that already has the same `brief-capabilities.json` shape).
3. A new test fixture at `tests/validate-brief-capabilities.test.mjs` (or equivalent) compiles the schema + validates the canonical-shape capability object, and fails loudly if a future Ajv version bump regresses the meta-schema resolution.
4. Bonus (not required for this bug): an audit note added to a future `/plan-refactor` plan explicitly tracking whether the factory wants a single meta-schema regime or a deliberate draft-07/2020-12 split. Don't block this bug on that decision.

## Related Work

- `plans/archive/feat-023-pm-stage-brief-coverage-assertion.md` — the plan that introduced `brief-capabilities.json` + `brief-capabilities.schema.json` (2026-04-27). The schema's draft-07 declaration was chosen there, predating the factory's drift to mixed meta-schemas.
- `plans/archive/feat-005-architect-implementation.md` — earlier AJV+ajv-formats factory setup; documents that `validate-architecture.mjs` uses AJV via the default import. Worth verifying whether `validate-architecture.mjs` would crash today on `architecture.schema.json` (also draft-07) if it used `ajv/dist/2020.js` like `validate-brief.mjs` does — quick spot-check during investigation.
- `.claude/rules/testing-policy.md` — the fix should add a sentinel test that survives future Ajv version bumps (per the policy's "no test rot" principle).

## Attempt Log

### Attempt 1 — 2026-05-15 — claude-opus-4-7 — SUCCESS

Implemented **Option A** (smallest patch).

Changes:

- `schemas/brief-capabilities.schema.json` — `"$schema"` changed from `"http://json-schema.org/draft-07/schema#"` → `"https://json-schema.org/draft/2020-12/schema"`. Body unchanged; every keyword used (`type`, `enum`, `const`, `required`, `additionalProperties`, `pattern`, `properties`, `items`, `minLength`) is stable across drafts.
- Synced to all 5 projects via `node scripts/sync-project-schemas.mjs projects/<name>` — each reported `updated: schemas/brief-capabilities.schema.json` on this pass. Subsequent runs are no-ops (byte-compare unchanged).
- `orchestrator/tests/brief-capabilities-schema-ajv2020.test.ts` — new regression test (5 cases): meta-schema-URL sentinel; Ajv2020 compiles without throwing; canonical-shape object validates; unknown category enum rejected; malformed id pattern rejected.

Validation:

- `node scripts/validate-brief.mjs --all --keep-going` inside `projects/gotribe-tribe-directory/` → `✓ brief-capabilities.json validates (15 capabilities)` + `✓ Brief validation passed`. Exit 0.
- Same command inside `projects/reading-log-02/` → `✓ brief-capabilities.json validates (16 capabilities)` + `✓ Brief validation passed`. Exit 0.
- `pnpm vitest run tests/brief-capabilities-schema-ajv2020.test.ts` → 5 passed in 64ms.
- `pnpm vitest run tests/brief-capabilities-schema-ajv2020.test.ts tests/brief-coverage-gate.test.ts` → 19 passed in 827ms (adjacent test suite still green).

All four Validation Criteria from the plan body cleared (criteria 1, 2, 3 directly; criterion 4 is bonus / non-blocking).

### Lessons

1. **The factory ships in a mixed-meta-schema state** (8 draft-07 + 9 draft-2020-12 across 17 schemas). This bug was the first call site where the mismatch surfaced because `validate-brief.mjs` is the only validator that loads `ajv/dist/2020.js` (the strict Ajv2020 build) AND compiles a draft-07 schema in the same call site. Other draft-07 schemas (architecture, tasks, tasks-coverage, feature, feature-context, signoff, visual-review-report) survive today because their validators use the default `ajv` import. A future refactor that consolidates Ajv imports would expose the same crash class on every draft-07 schema simultaneously — worth tracking as a refactor candidate (see Recommended follow-up below).

2. **Schema files copy unchanged across the draft-07 / draft-2020-12 boundary for our use cases.** All keywords used by every factory schema are present + identically-shaped in both drafts. The only difference is meta-schema resolution behaviour at Ajv compile time. A draft-2020-12-only factory regime is the lower-friction default.

3. **`sync-project-schemas.mjs` byte-compare propagation works correctly** — one factory edit, then 5 idempotent project-side updates with one log line per file. No project-side hand-edits needed. The script remains the right answer to "schemas drifted, sync them".

### Recommended follow-up (not blocking this bug)

A `/plan-refactor` to bump the remaining 7 draft-07 factory schemas to draft-2020-12 + align all 3 `validate-*.mjs` scripts to use `ajv/dist/2020.js` uniformly. ~30-line refactor; pre-empts the latent crash class on any future validator-import consolidation. Author when next touching the validator surface.

---

# COMPLETION RECORD (appended to archived plan)

```yaml
completed: 2026-05-15
outcome: success
actual-files-changed:
  - schemas/brief-capabilities.schema.json (modified)
  - orchestrator/tests/brief-capabilities-schema-ajv2020.test.ts (created)
  - plans/active/bug-106-validate-brief-ajv-draft07.md (created)
  - plans/active.md (modified)
commits:
  - hash: 67e0226
    message: "fix(bug-106): bump brief-capabilities.schema.json to draft-2020-12"
attempts: 1
lessons:
  - "Factory ships in a mixed-meta-schema state (8 draft-07 + 9 draft-2020-12 across 17 schemas). This bug was the first call site where the mismatch surfaced because validate-brief.mjs is the only validator that loads ajv/dist/2020.js (strict Ajv2020 build) AND compiles a draft-07 schema in the same call site. Other draft-07 schemas survive today because their validators use the default ajv import. A future refactor consolidating Ajv imports would expose the same crash class simultaneously on every draft-07 schema."
  - "Schema files copy unchanged across the draft-07 / draft-2020-12 boundary for our use cases — all keywords used (type, enum, const, required, additionalProperties, pattern, properties, items, minLength) are stable across drafts; only meta-schema resolution behaviour differs at compile time. A draft-2020-12-only factory regime is the lower-friction default."
  - "sync-project-schemas.mjs byte-compare propagation works correctly — one factory edit, then 5 idempotent project-side updates with one log line per file. No project-side hand-edits needed. The script remains the right answer to 'schemas drifted, sync them'."
test-results:
  unit: 5/5 passed (orchestrator/tests/brief-capabilities-schema-ajv2020.test.ts)
  integration: validate-brief.mjs --all --keep-going exits 0 on projects/gotribe-tribe-directory + projects/reading-log-02 (the two empirical canaries)
duration-minutes: 30
```
