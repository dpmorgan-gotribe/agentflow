---
id: refactor-009-schemas-ajv-uniform
type: refactor
status: archived
author-agent: claude-opus-4-7
created: 2026-05-15
updated: 2026-05-15
approved-at: 2026-05-15
completed-at: 2026-05-15
parent-plan: bug-106-validate-brief-ajv-draft07
supersedes: null
superseded-by: null
branch: refactor/schemas-ajv-uniform
affected-files:
  - schemas/architecture.schema.json
  - schemas/tasks.schema.json
  - schemas/tasks-coverage.schema.json
  - schemas/feature.schema.json
  - schemas/feature-context.schema.json
  - schemas/signoff.schema.json
  - schemas/visual-review-report.schema.json
  - scripts/validate-architecture.mjs
  - scripts/validate-feature-context.mjs
  - scripts/validate-tasks-yaml.mjs
  - orchestrator/tests/brief-capabilities-schema-ajv2020.test.ts
feature-area: validators
priority: P2
attempt-count: 1
max-attempts: 5
motivation: "Eliminate the latent crash class bug-106 surfaced. Today the factory works by careful per-validator alignment; one mis-paired Ajv-import + $schema-URL would re-fire bug-106 on a different surface."
---

# refactor-009-schemas-ajv-uniform: Consolidate factory schemas + validators to one draft-2020-12 / Ajv2020 regime

## Current State

The factory ships 17 JSON schemas in `schemas/` and 5 validator scripts in `scripts/`. Both are split across two meta-schema regimes today:

**Schemas — 8 draft-07, 9 draft-2020-12:**

| Schema                                    | Meta-schema                              |
| ----------------------------------------- | ---------------------------------------- |
| `architecture.schema.json`                | draft-07                                 |
| `feature-context.schema.json`             | draft-07                                 |
| `feature.schema.json`                     | draft-07                                 |
| `signoff.schema.json`                     | draft-07                                 |
| `tasks-coverage.schema.json`              | draft-07                                 |
| `tasks.schema.json`                       | draft-07                                 |
| `visual-review-report.schema.json`        | draft-07                                 |
| `brief-capabilities.schema.json`          | draft-2020-12 (just migrated by bug-106) |
| `brief-frontmatter.schema.json`           | draft-2020-12                            |
| `bugs-yaml.schema.json`                   | draft-2020-12                            |
| `build-to-spec-verify-output.schema.json` | draft-2020-12                            |
| `navigation.schema.json`                  | draft-2020-12                            |
| `parity-verify-output.schema.json`        | draft-2020-12                            |
| `screen-fixture.schema.json`              | draft-2020-12                            |
| `screens.schema.json`                     | draft-2020-12                            |
| `user-flows-manifest.schema.json`         | draft-2020-12                            |

**Validators — 3 default Ajv (draft-07), 2 Ajv2020:**

| Validator                                 | Ajv import                                   | Schema(s) compiled                                                            |
| ----------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------- |
| `scripts/validate-architecture.mjs:16`    | `import Ajv from "ajv"` (default = draft-07) | `architecture.schema.json` (draft-07) ✓                                       |
| `scripts/validate-feature-context.mjs:19` | `import Ajv from "ajv"` (draft-07)           | `feature-context.schema.json` (draft-07) ✓                                    |
| `scripts/validate-tasks-yaml.mjs:27`      | `import Ajv from "ajv"` (draft-07)           | `tasks.schema.json` + `feature.schema.json` via $ref (both draft-07) ✓        |
| `scripts/validate-brief.mjs:149,261,302`  | `loadDep("ajv/dist/2020.js")` (Ajv2020)      | `brief-frontmatter`, `navigation`, `brief-capabilities` (all draft-2020-12) ✓ |
| `scripts/validate-screens.mjs:68`         | `loadDep("ajv/dist/2020.js")` (Ajv2020)      | `screens.schema.json` (draft-2020-12) ✓                                       |

**The hidden invariant**: each validator's Ajv-import meta-schema regime currently matches the schemas it compiles. The factory works today by careful pairing. There is NO mechanism enforcing the pairing. Any of the following would re-fire bug-106 on a different surface:

- Someone changes a schema's `$schema` URL without checking which validator compiles it.
- Someone replaces a `import Ajv from "ajv"` with `loadDep("ajv/dist/2020.js")` for consistency reasons unaware of the meta-schema pairing.
- A future validator is authored using the wrong Ajv build for its target schema.
- A future Ajv version bump changes the default-export meta-schema (e.g., Ajv 9 making draft-2020-12 the default).

bug-106 is closed against today's specific call site, but the crash class remains latent across the validator surface.

**Empirical confirmation that there's no behavioural reason for the split**: zero schemas across all 17 use any draft-2020-only keyword (`unevaluatedProperties`, `unevaluatedItems`, `prefixItems`, `$dynamicRef`, `$dynamicAnchor`). Confirmed by `Grep "unevaluatedProperties|unevaluatedItems|prefixItems|dynamicRef|dynamicAnchor" schemas/` returning zero matches. The split is purely historical — different authors at different times picked different meta-schemas without coordinating.

## Desired State

Single uniform regime across the factory:

- **All 17 schemas declare `"$schema": "https://json-schema.org/draft/2020-12/schema"`.** No draft-07 declarations anywhere.
- **All 5 validator scripts use `ajv/dist/2020.js` (Ajv2020)** via `loadDep("ajv/dist/2020.js")` or `import Ajv2020 from "ajv/dist/2020.js"` depending on which loader style the script already uses.
- **Regression test in `orchestrator/tests/brief-capabilities-schema-ajv2020.test.ts` extended** so its first assertion (the meta-schema-URL sentinel) loops across all 17 factory schemas instead of just brief-capabilities — fails loudly if any factory schema regresses to draft-07.

Properties the new structure has that the old one lacks:

- **One mental model.** "Factory schemas are draft-2020-12. Factory validators are Ajv2020." No per-validator pairing to remember.
- **Adding a new schema is safe.** A new author writes `"$schema": "https://json-schema.org/draft/2020-12/schema"` (matching the visible neighbours) and any validator can compile it.
- **Adding a new validator is safe.** A new author imports `ajv/dist/2020.js` (matching neighbours) and any schema compiles.
- **The bug-106 sentinel test catches regressions before they ship.** Today the sentinel only protects brief-capabilities; after this refactor it protects all 17.

## Motivation

Three orthogonal reasons:

1. **Eliminate the latent crash class bug-106 surfaced.** Today the factory works by careful per-validator-pair alignment. A single mismatched edit re-fires the same crash on a different surface. The risk is permanent until the regime is uniform.
2. **Reduce cognitive load on agents authoring new schemas/validators.** "What `$schema` URL does the factory use?" should have one answer, not "depends on which validator compiles it."
3. **Pre-empt Ajv version-bump risk.** When Ajv 9 ships and changes the default-import meta-schema regime (likely; the library is steadily moving toward draft-2020-12 as default), the factory's mixed-regime split becomes a migration headache. A single uniform regime makes the bump a one-line change.

Empirical motivator: bug-106 (shipped 2026-05-15) demonstrated the class is real, not theoretical. The fix was correct but pinpoint — this refactor closes the latent surface.

No brief.md reference applies — this is factory-internal infrastructure work, not project work.

## Migration Strategy

**Path X (chosen)**: all-draft-2020-12 + Ajv2020-uniform. Path Y (revert to all-draft-07 + default-Ajv) was considered + rejected — it would regress bug-106's just-shipped fix and require down-converting 8 schemas, vs Path X's purely-cosmetic flip of the remaining 7.

Five sequential steps. The refactor is purely additive at the meta-schema level (no keywords change), so each step is independently reversible.

### Step 1 — Bump the 7 remaining draft-07 schemas to draft-2020-12

Single-line edit on each. The body of each schema stays byte-identical except for the `$schema` URL.

```diff
- "$schema": "http://json-schema.org/draft-07/schema#",
+ "$schema": "https://json-schema.org/draft/2020-12/schema",
```

Files:

1. `schemas/architecture.schema.json`
2. `schemas/tasks.schema.json`
3. `schemas/tasks-coverage.schema.json`
4. `schemas/feature.schema.json`
5. `schemas/feature-context.schema.json`
6. `schemas/signoff.schema.json`
7. `schemas/visual-review-report.schema.json`

### Step 2 — Switch the 3 default-Ajv validators to Ajv2020

Two of them use the `import Ajv from "ajv"` style:

```diff
- import Ajv from "ajv";
+ import Ajv2020 from "ajv/dist/2020.js";
```

Then update the constructor call:

```diff
- const ajv = new Ajv({ allErrors: true });
+ const ajv = new Ajv2020({ allErrors: true });
```

Files (the import style at each):

- `scripts/validate-architecture.mjs:16` — `import Ajv from "ajv"`
- `scripts/validate-feature-context.mjs:19` — `import Ajv from "ajv"`
- `scripts/validate-tasks-yaml.mjs:27` — `import Ajv from "ajv"`

All three use the static-import style, so the change is symmetric across them. The constructor name should be normalized to `Ajv2020` everywhere it's instantiated (matches the regression test's pattern + `validate-brief.mjs` / `validate-screens.mjs`'s dynamic-loadDep pattern resolves to the same class).

### Step 3 — Verify each validator still works

For each validator, run it against a known-good fixture. Most fixtures live inside `projects/<name>/`:

| Validator                                   | Fixture command                                                                                                                   |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `validate-architecture.mjs`                 | `node scripts/validate-architecture.mjs projects/reading-log-02/.claude/architecture.yaml`                                        |
| `validate-feature-context.mjs`              | `node scripts/validate-feature-context.mjs <a-known-lockfile-or-fixture>` (find or skip if no fixture exists in active worktrees) |
| `validate-tasks-yaml.mjs`                   | `node scripts/validate-tasks-yaml.mjs projects/reading-log-02/docs/tasks.yaml`                                                    |
| `validate-brief.mjs` (already migrated)     | `(cd projects/gotribe-tribe-directory && node scripts/validate-brief.mjs --all --keep-going)`                                     |
| `validate-screens.mjs` (already on Ajv2020) | `node scripts/validate-screens.mjs projects/gotribe-tribe-directory/docs/analysis/webapp/screens.json`                            |

Each must exit 0 against a known-good fixture. If a fixture is missing, mark that validator as "no live fixture available — covered by the regression test in Step 5".

### Step 4 — Sync schemas to all 5 existing projects

```bash
for p in gotribe-tribe-directory reading-log-01 reading-log-02 reading-log-pre-bugs reading-log-pre-build; do
  node scripts/sync-project-schemas.mjs projects/$p
done
```

The script is idempotent (byte-compare) so only the 7 just-updated schemas will report `updated: ...`.

### Step 5 — Extend the bug-106 sentinel test to cover all 17 schemas

Edit `orchestrator/tests/brief-capabilities-schema-ajv2020.test.ts` so the first `it("declares a meta-schema that Ajv2020 can resolve")` block loops over every `schemas/*.schema.json` and asserts the `$schema` URL matches `/draft\/(2019-09|2020-12)\/schema$/`. Catches the next regression before it ships.

Optionally split into a new sibling test file (`orchestrator/tests/factory-schemas-meta-uniformity.test.ts`) to keep the bug-106-specific assertions narrow + add the factory-wide assertion separately. Author's call during implementation.

## Affected Consumers

The "consumers" of factory schemas + validators are: (a) the validator scripts themselves, (b) downstream `/sync-project-schemas.mjs` propagating to 5 projects, (c) Zod mirrors in `packages/orchestrator-contracts/` that mirror schema shapes at runtime.

| Consumer                                                   | File                                                                                                                     | Change Required                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `validate-architecture.mjs`                                | `scripts/validate-architecture.mjs`                                                                                      | Import `Ajv2020` from `ajv/dist/2020.js`; rename constructor calls                                               |
| `validate-feature-context.mjs`                             | `scripts/validate-feature-context.mjs`                                                                                   | Same as above                                                                                                    |
| `validate-tasks-yaml.mjs`                                  | `scripts/validate-tasks-yaml.mjs`                                                                                        | Same as above                                                                                                    |
| `validate-brief.mjs`                                       | `scripts/validate-brief.mjs`                                                                                             | No change — already uses Ajv2020 (bug-106)                                                                       |
| `validate-screens.mjs`                                     | `scripts/validate-screens.mjs`                                                                                           | No change — already uses Ajv2020                                                                                 |
| `sync-project-schemas.mjs`                                 | `scripts/sync-project-schemas.mjs`                                                                                       | No code change — script is meta-schema-agnostic. Re-runs to propagate 7 updated `$schema` URLs to all 5 projects |
| Zod mirrors (orchestrator-contracts)                       | `packages/orchestrator-contracts/src/*.ts`                                                                               | No change — Zod doesn't read `$schema` URLs; runtime shapes are identical                                        |
| Regression test (bug-106)                                  | `orchestrator/tests/brief-capabilities-schema-ajv2020.test.ts`                                                           | Extend the meta-schema URL sentinel to loop over all 17 schemas (or split to a new sibling file)                 |
| Existing schema-compile call sites in orchestrator runtime | (none — `orchestrator/src/**` does not directly compile these JSON schemas at runtime; consumes the Zod mirrors instead) | No change                                                                                                        |

## Validation Criteria

1. **`grep -nE "draft-07" schemas/*.json` returns zero matches** post-refactor.
2. **`grep -nE 'import Ajv from "ajv"' scripts/validate-*.mjs` returns zero matches** post-refactor — every validator imports `ajv/dist/2020.js` uniformly.
3. **Every validator script exits 0 against its known-good fixture** (per the Step-3 table). If a fixture is unavailable for `validate-feature-context.mjs`, the Step-5 sentinel test substitutes.
4. **All 5 projects' `node scripts/validate-brief.mjs --all --keep-going` exits 0** after the Step-4 sync.
5. **`pnpm vitest run orchestrator/tests/brief-capabilities-schema-ajv2020.test.ts` passes** with the extended factory-wide sentinel — all 17 schemas declared draft-2019-09 or draft-2020-12.
6. **No new TypeScript or runtime errors** when re-running the orchestrator's existing test suite (`pnpm --filter orchestrator test`).
7. **No Zod-mirror drift** in `packages/orchestrator-contracts/` — these mirror schema shapes (`type`, `properties`, `required`, `enum`, etc.), not meta-schema URLs, so the refactor should be invisible to them. Spot-check by running the contracts tests.

## Attempt Log

### Attempt 1 — 2026-05-15 — claude-opus-4-7 — SUCCESS

Executed all 5 migration steps in order, plus one in-flight scope expansion (`scripts/audit-brief-coverage.mjs` was caught by `grep "import Ajv from \"ajv\""` after Step 2 and folded in — same crash class, same fix).

Changes:

**Schemas (7 files, `$schema` URL flip only — bodies byte-identical):**

- `schemas/architecture.schema.json`
- `schemas/tasks.schema.json`
- `schemas/tasks-coverage.schema.json`
- `schemas/feature.schema.json`
- `schemas/feature-context.schema.json`
- `schemas/signoff.schema.json`
- `schemas/visual-review-report.schema.json`

**Validators (4 files — 3 from plan + 1 in-flight scope expansion):**

- `scripts/validate-architecture.mjs` — `import Ajv from "ajv"` → `import { Ajv2020 } from "ajv/dist/2020.js"`; constructor `new Ajv(...)` → `new Ajv2020(...)`
- `scripts/validate-feature-context.mjs` — same
- `scripts/validate-tasks-yaml.mjs` — same
- `scripts/audit-brief-coverage.mjs` — same (caught in scope check post-Step 2; compiles `brief-capabilities` + `tasks-coverage`, both now draft-2020-12)

**Regression test (1 new file — sibling to the bug-106 test):**

- `orchestrator/tests/factory-schemas-meta-uniformity.test.ts` — 1 sentinel ("ships ≥10 schemas") + 16 schemas × 2 assertions each (`$schema` declares draft-2019-09|2020-12; compiles under Ajv2020 with sibling-$ref registration). 33 cases total.

**Synced to 5 projects** via `scripts/sync-project-schemas.mjs`: gotribe-tribe-directory, reading-log-01, reading-log-02, reading-log-pre-bugs, reading-log-pre-build. Each project got 7 updated schemas + 3 updated validators on this pass; subsequent runs are no-ops.

Validation (all 7 criteria green):

1. ✓ `grep "draft-07" schemas/*.json` returns zero matches.
2. ✓ `grep 'import Ajv from "ajv"' scripts/*.mjs` returns zero matches.
3. ✓ Each validator exits 0 against a known-good fixture:
   - `validate-architecture.mjs projects/reading-log-02/.claude/architecture.yaml` → `OK — ... validates`
   - `validate-tasks-yaml.mjs projects/reading-log-02/docs/tasks.yaml` → `OK — ... validates`
   - `validate-brief.mjs --all --keep-going` (in gotribe-tribe-directory) → `✓ Brief validation passed`
   - `validate-screens.mjs projects/gotribe-tribe-directory/docs/analysis/webapp/screens.json` → `✓ v3.0 screens.json valid (3 screens)`
   - `validate-feature-context.mjs projects/reading-log-01/.feature-context.json` → compiled cleanly + reported real validation errors against a stale worktree lockfile (refactor success — no Ajv crash)
   - `audit-brief-coverage.mjs projects/reading-log-02` → `{"ok": true, "uncovered": [], "deferred": [], "typoErrors": []}`
4. ✓ All 5 projects' `validate-brief.mjs --all --keep-going` exits 0.
5. ✓ `pnpm vitest run orchestrator/tests/factory-schemas-meta-uniformity.test.ts orchestrator/tests/brief-capabilities-schema-ajv2020.test.ts` → 38/38 passed in 706ms.
6. ✓ Full orchestrator suite (`pnpm --filter orchestrator test`) → 1033/1033 passed in 33.66s. No regressions.
7. ✓ Contracts suite (`pnpm --filter @repo/orchestrator-contracts test`) → 400/400 passed in 1.16s. No Zod-mirror drift.

### Lessons

1. **In-flight scope expansion was correct, not creep.** The plan named 3 default-Ajv validators but a post-Step-2 `Grep` for `import Ajv from "ajv"` factory-wide surfaced a 4th call site (`scripts/audit-brief-coverage.mjs`) that compiles the same draft-2020-12 schemas. Folding it in preserved the refactor's spirit ("single uniform regime") at minimal extra cost. Lesson for future refactors: after the named-targets step, always re-grep for the symptom — there's usually a straggler the plan-authoring grep missed.

2. **The `addSchema(siblingSchema, "./<name>")` pattern is the right way to compile factory schemas under test.** Some factory schemas use `$ref` to siblings (e.g. `tasks.schema.json` references `feature.schema.json`). Without sibling-registration, Ajv2020's compile call throws a different "no schema with key or ref" error against the sibling path. The factory-uniformity test handles this by walking the whole `schemas/` directory and pre-registering every sibling before compiling the target. Worth keeping the pattern handy for any future schema-test work.

3. **`sync-project-schemas.mjs` correctly propagates validator scripts too**, not just schemas — the script copies the 3 updated `validate-*.mjs` files into each project's `scripts/validators/` directory alongside the schema files. Confirmed end-to-end: 10 files updated per project (7 schemas + 3 validators) on this pass.

4. **The contracts Zod mirrors were genuinely invisible to this refactor** — 400/400 contracts tests passed without modification. The mirrors validate shape (`type`, `properties`, `required`, `enum`, etc.); they do not read `$schema` URLs. Confirms the refactor's "purely cosmetic" framing.

### Cross-references

- `bug-106-validate-brief-ajv-draft07` — parent. Pinpoint fix; this refactor closes the latent surface.
- `orchestrator/tests/factory-schemas-meta-uniformity.test.ts` — the load-bearing regression guard going forward. Any future schema authored at draft-07 fires it. Any future validator that compiles a schema and fails fires it.

---

# COMPLETION RECORD (appended to archived plan)

```yaml
completed: 2026-05-15
outcome: success
actual-files-changed:
  - schemas/architecture.schema.json (modified)
  - schemas/tasks.schema.json (modified)
  - schemas/tasks-coverage.schema.json (modified)
  - schemas/feature.schema.json (modified)
  - schemas/feature-context.schema.json (modified)
  - schemas/signoff.schema.json (modified)
  - schemas/visual-review-report.schema.json (modified)
  - scripts/validate-architecture.mjs (modified)
  - scripts/validate-feature-context.mjs (modified)
  - scripts/validate-tasks-yaml.mjs (modified)
  - scripts/audit-brief-coverage.mjs (modified — in-flight scope expansion)
  - orchestrator/tests/factory-schemas-meta-uniformity.test.ts (created)
  - plans/active.md (modified — manifest row added)
attempts: 1
lessons:
  - 'In-flight scope expansion was correct, not creep. The plan named 3 default-Ajv validators; a post-Step-2 grep for the symptom (`import Ajv from "ajv"`) surfaced a 4th call site (scripts/audit-brief-coverage.mjs) that compiles the same draft-2020-12 schemas. Always re-grep for the symptom after the named-targets step.'
  - 'addSchema(siblingSchema, "./<name>") is the right way to compile factory schemas under test. Some schemas $ref siblings (tasks.schema.json → feature.schema.json); without sibling-registration, Ajv2020 throws a different no-schema-with-key error. The factory-uniformity test walks schemas/ and pre-registers every sibling before compiling the target.'
  - "sync-project-schemas.mjs propagates validator scripts too, not just schemas. End-to-end: 10 files updated per project (7 schemas + 3 validators) in a single sync pass."
  - "Contracts Zod mirrors were genuinely invisible to this refactor (400/400 tests passed unchanged). The mirrors validate shape, not $schema URLs. Confirms the refactor's purely-cosmetic framing."
test-results:
  unit: 38/38 passed (new factory-uniformity + bug-106 sentinel; 33 + 5 cases)
  integration: 1033/1033 orchestrator + 400/400 contracts passed (no regressions across the full suites)
  fixtures: 6/6 validators exit 0 against known-good fixtures (validate-architecture, validate-tasks-yaml, validate-brief, validate-screens, validate-feature-context, audit-brief-coverage)
duration-minutes: 25
```
