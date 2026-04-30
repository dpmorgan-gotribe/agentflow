---
id: refactor-008-sync-project-schemas-rules-templates
type: refactor
status: completed
author-agent: claude-opus-4-7
created: 2026-04-30
updated: 2026-04-30
outcome: success
parent-plan: null
supersedes: null
superseded-by: null
branch: refactor/sync-rules-templates
affected-files:
  - scripts/sync-project-schemas.mjs
  - .claude/skills/new-project/SKILL.md
feature-area: orchestration
priority: P2
attempt-count: 1
max-attempts: 5
motivation: "scripts/sync-project-schemas.mjs only covers schemas + validate-* + retrofit-* dirs; .claude/rules/ and .claude/templates/ drift silently between factory and projects (recurring tax this session — manually copied 5 files × 5 projects to land Phase 0 testing-policy + Phase C dev-multi-tier template + Phase 2B seed-helper templates)."
---

# refactor-008: Extend sync-project-schemas to cover .claude/rules/ + .claude/templates/

## Current State

`scripts/sync-project-schemas.mjs` is the canonical factory→project file
overlay tool (bug-019). It currently syncs three categories declared in
`SYNC_PAIRS`:

```js
const SYNC_PAIRS = [
  {
    label: "schemas",
    factoryDir: "schemas",
    projectDir: "schemas",
    matcher: /\.schema\.json$/i,
  },
  {
    label: "validators",
    factoryDir: "scripts",
    projectDir: "scripts",
    matcher: /^validate-.*\.mjs$/i,
  },
  {
    label: "retrofits",
    factoryDir: "scripts",
    projectDir: "scripts",
    matcher: /^retrofit-.*\.mjs$/i,
  },
];
```

The walker (`listFactoryFiles`) is **non-recursive** —
`readdirSync(factoryAbsDir, { withFileTypes: true })` lists one level only.
That's fine for the existing categories (schemas/ + scripts/ are flat) but
means the script can't sync any directory with nested structure.

Two factory-canonical directories drift between factory and projects but
are NOT covered:

- `.claude/rules/` — 1 file at present (`testing-policy.md`); flat dir.
  This file changed as part of feat-038 Phase 0 (added §E2E data-seeding
  strategy) AND various earlier sessions. Each change required manual
  per-project sync.
- `.claude/templates/` — 18 files including a 1-level-deep
  `ui-kit-eslint-plugin/` subtree (5 files). Templates added this session:
  `seed-localstorage.ts.template`, `seed-intercept.ts.template`,
  `seed-db.ts.template`, `playwright-global-setup.ts.template` (Phase 2B),
  plus `dev-multi-tier.mjs.template` (bug-032 Phase C, prior session).

Empirical drift this session (factory → 5 target projects):

| File                                                    | Drift origin            |
| ------------------------------------------------------- | ----------------------- |
| `.claude/rules/testing-policy.md`                       | feat-038 Phase 0        |
| `.claude/templates/dev-multi-tier.mjs.template`         | bug-032 Phase C         |
| `.claude/templates/seed-localstorage.ts.template`       | feat-038 Phase 2B (NEW) |
| `.claude/templates/seed-intercept.ts.template`          | feat-038 Phase 2B (NEW) |
| `.claude/templates/seed-db.ts.template`                 | feat-038 Phase 2B (NEW) |
| `.claude/templates/playwright-global-setup.ts.template` | feat-038 Phase 2B (NEW) |

Each manually copied to 5 target projects = **30 manual file copies this
session alone** that the sync script could have done in one
`--all` invocation. Going forward, every factory-side rule or template
update requires the same 5×N tax. The cost compounds.

`.claude/skills/` has the same drift problem (3 SKILL.md files were also
manually copied this session — architect, python-fastapi, react-next),
but it's a much larger surface (100+ files across the tree) and includes
hooks that may have project-specific configuration. Out of scope for this
refactor; documented as a follow-up consideration in §Out of Scope.

## Desired State

`scripts/sync-project-schemas.mjs` covers `.claude/rules/` +
`.claude/templates/` with the same idempotent byte-compare semantics it
already applies to schemas/validators/retrofits. After this refactor:

```bash
node scripts/sync-project-schemas.mjs --all
```

…lands every drifted rule + template into every project under
`projects/*/`, dry-runnable via `--dry-run`, with the same per-file
created/updated/unchanged accounting + per-project log.

Properties:

- **Recursive walker**: `.claude/templates/ui-kit-eslint-plugin/` and any
  future nested template dirs sync correctly. Files preserve their
  relative path under the source directory.
- **Idempotent**: repeated runs against in-sync trees report
  `unchanged` for every file, write nothing, exit 0.
- **Same operator-facing semantics**: `--all`, `--dry-run`, single-project
  positional arg, exit-code conventions (0 success, 1 invocation error,
  2 partial failure) all unchanged.
- **Backward-compatible with existing SYNC_PAIRS**: the three current
  categories continue to work non-recursively (their flat structure is
  preserved by the walker treating depth-0 the same way).

## Motivation

**Why now**:

1. **Tax just paid 30× this session.** Every factory rule/template update
   ships with a 5×N-projects manual copy tax. This session: 6 files × 5
   projects = 30 manual `cp` invocations. Compounds across sessions.
2. **No project-specific conflict risk.** `.claude/rules/` + `.claude/
templates/` are both `agenticVisibility: private` (gitignored in
   project repos) AND project-side files there are 100% factory-canonical
   — there's no project-specific customization to clobber. Schemas had
   this same property and the bug-019 sync covered them safely.
3. **Path of least surprise.** The script already exists, already has
   the right operator-facing surface (`--all`, `--dry-run`, per-file
   logging), already runs at `/new-project --force` step 5a. Extending
   it covers the gap with minimal new ceremony — no new script, no new
   skill, no new mental model.
4. **Unblocks future template authoring without per-project tax.**
   feat-038 Phase 3+ will likely add more rule sections + helper
   templates; landing this refactor first means those phases ship
   without the manual copy step.

## Migration Strategy

Single mechanical pass. The script's structure already isolates the
walker (`listFactoryFiles`) from the per-file sync (`syncOneProject`)
from the operator surface (`main`), so the change is contained.

### Step 1 — Make `listFactoryFiles` recursive

Replace the `readdirSync` non-recursive call with a depth-walker that
returns paths relative to the factoryDir:

```js
function listFactoryFiles(category) {
  const factoryAbsDir = join(FACTORY_ROOT, category.factoryDir);
  if (!existsSync(factoryAbsDir)) return [];
  const out = [];
  const walk = (relDir) => {
    const abs = join(factoryAbsDir, relDir);
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const relPath = relDir ? join(relDir, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(relPath);
      } else if (entry.isFile() && category.matcher.test(entry.name)) {
        out.push(relPath.replace(/\\/g, "/"));
      }
    }
  };
  walk("");
  return out.sort();
}
```

The matcher continues to apply to the BASENAME only (so a regex like
`/\.schema\.json$/i` doesn't accidentally match a directory name).
Returned paths are forward-slash-normalised so Windows + POSIX produce
the same set.

### Step 2 — Update `syncOneProject` to handle nested paths

The function currently does `join(projectAbsTargetDir, fname)` where
`fname` is a basename. After step 1, `fname` may be `subdir/file.ext` —
the join still works on POSIX, on Windows the forward-slash gets
normalised. Confirm by reading the full `syncOneProject` function;
likely no change needed, but if `mkdirSync(projectAbsTargetDir, { recursive: true })`
only creates the top-level dir, also `mkdirSync` the parent of each
nested file before `copyFileSync`.

### Step 3 — Add two new SYNC_PAIRS entries

```js
{
  label: "rules",
  factoryDir: ".claude/rules",
  projectDir: ".claude/rules",
  // .md files only — skip .gitkeep + future hidden marker files
  matcher: /\.md$/i,
},
{
  label: "templates",
  factoryDir: ".claude/templates",
  projectDir: ".claude/templates",
  // Match the established suffixes — extend if new template kinds land:
  // .template (canonical suffix), .json (e.g. ui-kit-tsconfig-consumer.json),
  // .md (e.g. ui-kit-contract.md), .ts (e.g. ui-kit-validate-consumer.ts),
  // .html (e.g. mockups-index-template.html), .js (eslint plugin rules)
  matcher: /\.(template|json|md|ts|html|js)$/i,
},
```

### Step 4 — Update `.claude/skills/new-project/SKILL.md` cross-reference

The script's docblock already mentions the §5 sync list ("If you add a
category here, also update .claude/skills/new-project/SKILL.md §5 sync
list"). Update that doc to reflect rules + templates are now covered so
operators reading the skill know the canonical sync surface.

### Step 5 — Validate

1. `node scripts/sync-project-schemas.mjs --all --dry-run` — preview
   every rule/template that would land per project. Expect each of 5
   target projects to show 0 created (we just manually synced them) +
   N unchanged for rules + templates.
2. Run full real sync: `node scripts/sync-project-schemas.mjs --all` —
   expect zero net changes since this session already manually-synced
   the same files.
3. **Reverse drift test**: `git checkout HEAD~1 .claude/rules/testing-policy.md`
   in one project, re-run `--all`, confirm sync re-overlays the factory
   version. Then revert.
4. Existing categories (schemas/validators/retrofits) continue to work:
   confirm `pnpm --filter @repo/orchestrator-contracts test` still
   passes (the sync script isn't tested there but no test should regress).
5. Confirm `--dry-run` continues to write nothing — important since the
   script runs from `/new-project --force` and dry-run is the safety net.

### Step 6 — Archive plan with completion record

Single attempt expected; mechanical refactor with clear validation gates.

## Affected Consumers

| Consumer                             | File                                  | Change Required                                                                                                                                                                          |
| ------------------------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sync-project-schemas.mjs` itself    | `scripts/sync-project-schemas.mjs`    | Recursive walker + 2 new SYNC_PAIRS entries + `mkdirSync` for nested file parents                                                                                                        |
| `/new-project --force` SKILL.md      | `.claude/skills/new-project/SKILL.md` | Update §5 sync-list documentation to reflect rules + templates are now covered                                                                                                           |
| Operator workflows (factory authors) | (no file)                             | After this lands, factory rule/template edits ship via `node scripts/sync-project-schemas.mjs --all` instead of manual `cp ... × N projects`. No code change — pure operator-doc impact. |

No production code or test path consumes `SYNC_PAIRS` or
`listFactoryFiles` directly outside this script. The script itself is not
unit-tested (operator-facing utility); validation is via the manual
`--dry-run` walkthrough in step 5.

## Validation Criteria

Done when ALL of:

- [ ] `node scripts/sync-project-schemas.mjs --all --dry-run` reports
      zero `WOULD CREATE` / `WOULD UPDATE` lines for rules + templates
      across all 12 projects (we just manually synced; in-sync state
      should be detected as `unchanged`).
- [ ] After deliberate drift (revert one project's
      `.claude/rules/testing-policy.md` to a prior commit), the next
      `--all` run reports 1 `updated` line for that file and the diff
      returns clean post-sync.
- [ ] `--all` with `.claude/templates/ui-kit-eslint-plugin/` files
      synced into a fresh project copies all 5 nested files with their
      directory structure intact (verified via `find <project>/.claude/templates/ui-kit-eslint-plugin -type f | wc -l` == 5).
- [ ] `pnpm --filter orchestrator test` still 568/568 passing (no
      cross-package regression — the script doesn't import from
      orchestrator).
- [ ] `.claude/skills/new-project/SKILL.md` §5 mentions rules + templates
      in the sync-list documentation.
- [ ] `--dry-run` continues to write zero files (preserved safety net).

## Out of Scope

- **`.claude/skills/` sync.** Larger surface (100+ files), more risk of
  project-side customization conflict, and `/new-project --force` is the
  established mechanism. Defer to a follow-up plan if/when manual skills
  drift becomes a recurring tax. Empirical signal this session: 3 SKILL.md
  files synced manually (architect, python-fastapi, react-next). Not yet
  enough to justify scope expansion; revisit after 2-3 more sessions.
- **`.claude/agents/` sync.** Agent prompt files have project-specific
  frontmatter (mcp_servers list, model overrides) so byte-identical sync
  is unsafe. Different mechanism needed.
- **`.claude/hooks/` sync.** Project-specific `.claude/settings.json` /
  `.claude/scheduled_tasks.lock` live in the same dir; hook config can
  be project-specific. Out of scope.
- **Adding a `--include-skills` flag.** Speculative until skills drift
  proves recurring; the principle "ship the simplest thing that solves
  the proven pain" applies.

## Attempt Log

### Attempt 1 — 2026-04-30 — claude-opus-4-7 — success

Mechanical refactor as planned in §Migration Strategy. Single attempt:

1. Replaced non-recursive `listFactoryFiles` with a depth-walker that
   returns forward-slash-normalised relative paths from the category's
   `factoryDir`. Matcher continues to apply to basenames only.
2. Added `mkdirSync(parentDir, { recursive: true })` guard before
   `copyFileSync` in `syncOneProject` to handle nested file paths
   (e.g. `templates/ui-kit-eslint-plugin/rules/no-deep-imports.js`).
3. Added two new SYNC_PAIRS entries: `rules` (`.claude/rules/` matcher
   `/\.md$/i`) and `templates` (`.claude/templates/` matcher
   `/\.(template|json|md|ts|html|js)$/i`).
4. Updated `.claude/skills/new-project/SKILL.md §5a` cross-reference.

**Validation results:**

- ✅ `node scripts/sync-project-schemas.mjs projects/book-swap-pre-build --dry-run`
  reports 41 files all `unchanged` (16 schemas + 5 validators + 1
  retrofit + 1 rule + 18 templates including the 5 nested
  `ui-kit-eslint-plugin/` files).
- ✅ Reverse-drift test: `kanban-webapp-09` (never manually synced this
  session) shows `1 updated` (testing-policy.md) + `18 created`
  (entire templates/ tree absent, including all nested files
  preserved with their dir structure).
- ✅ Live `--all` run: 12 projects synced. The 5 manually-synced targets
  this session report 0 created / 0 updated; the other 7 picked up
  13–18 new files each (varies by which template-files those projects
  already had).
- ✅ `pnpm --filter orchestrator test`: 568/568 passing (no
  cross-package regression).

## Outcome

**Success.** All six validation criteria from §Validation Criteria met.
Going forward, factory rule + template edits ship via a single
`node scripts/sync-project-schemas.mjs --all` instead of N×projects
manual `cp` invocations. The 30-copy tax this session paid (Phase 0
testing-policy + Phase 2B seed-helpers × 5 projects) won't recur.

## Lessons Learned

1. **Recursive walker is a one-time cost.** The original
   `readdirSync(...).filter(...)` scoped the script to flat dirs,
   which was right for v1's `schemas/` + `scripts/` matchers — those
   directories are flat by convention. But the moment a category needs
   nesting (`.claude/templates/ui-kit-eslint-plugin/...`), the walker
   has to grow. Not worth pre-building recursion before there's a real
   need; the cost when a need surfaces is small (~10 LOC).
2. **`mkdirSync(..., { recursive: true })` is the right idempotent
   guard.** Easy trap: only `mkdirSync` the top-level `projectDir`, then
   `copyFileSync` to a nested path that doesn't exist yet → ENOENT. The
   fix is one line. Document it because the next contributor will hit
   it without the breadcrumb.
3. **Drift tax compounds invisibly across sessions.** This session paid
   30 manual `cp` invocations across 6 factory updates × 5 projects.
   That cost compounds: each future factory rule/template edit reopens
   the wound. Shipping the sync extension at the moment the manual
   copies become tedious (rather than waiting for a clean "tooling
   sprint") keeps the wound from healing as scar tissue. Pattern:
   if you find yourself doing the same multi-target operator work
   twice, automate it.
4. **Project-side gitignore matters for sync-design decisions.** All
   `.claude/{rules,templates,skills,agents,hooks}` are gitignored under
   `agenticVisibility: private`. Sync just overlays files; agents read
   them at runtime. Tracked status doesn't matter for the sync — but
   the script's `listProjectsWithSchemas` filter (uses `schemas/`
   existence as the project-detector) correctly identifies project
   dirs even when their `.claude/` is gitignored.
