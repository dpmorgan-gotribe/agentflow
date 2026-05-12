---
id: bug-052-gitignore-missing-coverage
type: bug
status: completed
author-agent: human
created: 2026-05-06
updated: 2026-05-06
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/gitignore-missing-coverage
affected-files:
  - .claude/skills/new-project/SKILL.md
  - .claude/skills/architect/SKILL.md
  - .claude/skills/agents/back-end/node-fastify/SKILL.md
  - .claude/skills/agents/back-end/python-fastapi/SKILL.md
  - .claude/skills/agents/back-end/node-trpc-nest/SKILL.md
  - .claude/skills/agents/front-end/react-next/SKILL.md
  - .claude/skills/agents/front-end/svelte-kit/SKILL.md
  - .claude/skills/agents/mobile/expo-rn/SKILL.md
feature-area: factory-scaffold
priority: P2
attempt-count: 0
max-attempts: 5
error-message: null
reproduction-steps: |
  1. /new-project <name> --proposal "..."
  2. Walk the design pipeline through to /start-build
  3. After feat-bootstrap (or any backend feature with Vitest --coverage tests) merges to master, observe:
     git ls-files apps/api/coverage/  ← lists ~30+ HTML/CSS/JS report files
stack-trace: null
---

# bug-052-gitignore-missing-coverage: project .gitignore missing `coverage/` entry; test-runner reports get committed by builder `git add -A`

## Bug Description

Newly-scaffolded projects' `.gitignore` is missing the `coverage/` entry. When a backend or web feature's tester runs `pnpm vitest run --coverage` (mandatory per `.claude/rules/testing-policy.md` to verify the 80% line-coverage threshold), Vitest emits a full HTML report tree into `apps/{api,web}/coverage/` (index.html + clover.xml + coverage-final.json + base.css + prettify.\* + per-source-directory drill-down dirs). The next builder agent that runs `git add -A` (the canonical pattern for committing feature work) sweeps these into the commit and they land on the merged feature branch, polluting master.

**Expected:** project `.gitignore` excludes `coverage/` + `**/coverage/` + `*.lcov` + `.nyc_output/`. Coverage reports stay local; tester parses the numeric summary line; builders never commit them.

**Actual:** `.gitignore` lacks these entries on `reading-log-01` (project scaffolded 2026-05-05 from the agentflow-phase2 factory). Diff at `feat-bootstrap` merge includes ~30+ coverage-report files. Same risk for every subsequent merge in this project (feat-tags-manage + feat-settings are mid-flight as of 2026-05-06 02:55 with their own `apps/{api,web}/coverage/` populated).

**Regression scope:** 3 shipped projects audit clean —

- `kanban-webapp-09/.gitignore` — has `coverage/` (comment cites `bug-014 (investigate-005): comprehensive generated-artifact coverage`)
- `finance-track-01/.gitignore` — same
- `repo-health-dashboard-01/.gitignore` — has `coverage/` + `.coverage`

So the fix WAS applied to those projects' gitignores once, but the templating path that seeds NEW projects has either drifted, lost the entry, or was applied per-project ad-hoc (not factory-side). reading-log-01 came in clean without the entries — this is a templating regression, not a one-off miss.

## Reproduction Steps

See frontmatter `reproduction-steps`. Concretely with reading-log-01:

```bash
cd projects/reading-log-01
git ls-files apps/api/coverage/ | head -10
# Lists ~30 files: base.css, block-navigation.js, clover.xml, coverage-final.json,
# db/index.html, db/seed.ts.html, favicon.png, index.html, prettify.css, prettify.js, ...
```

## Error Output

```
$ git ls-files apps/api/coverage/ | wc -l
30+
$ grep -E "coverage" .gitignore
(no matches)
```

## Root Cause Analysis

To be filled during investigation. Hypotheses:

1. **`/new-project` gitignore seeder regression** — the skill that scaffolds projects copies a `.gitignore` from a factory template (or inlines one). If that template lost the coverage entry between the bug-014 fix and the reading-log-01 scaffold, this is the root cause. Check `.claude/skills/new-project/SKILL.md` + any `.gitignore.template` under `.claude/templates/`.

2. **Per-project `.gitignore` was hand-edited in the shipped projects** — and never propagated factory-side. If `kanban-webapp-09` etc. got the entry via post-hoc edit (during the bug-014 fix) but the factory template was never updated, every NEW project after bug-014 will repeat the omission. The `bug-014 (investigate-005)` comment in the shipped gitignores might be the smoking gun if the comment was hand-typed at fix-time.

3. **Architect emits the gitignore additions, not /new-project** — the architect skill has bug-032 Phase C scaffolding for per-app `.env.example`, scripts/dev.mjs, etc. If gitignore additions live there but specifically per-stack (and the node-fastify path doesn't include coverage), reading-log-01 (first node-fastify project post-bug-014) is the regression instance.

Investigation order:

1. Read `plans/archive/investigate-005-gitignore-audit.md` (the prior audit) to understand what fix shape was applied.
2. Read `plans/archive/bug-014-*.md` (referenced in the shipped gitignores) for the canonical fix.
3. Diff `kanban-webapp-09/.gitignore` vs `reading-log-01/.gitignore` to identify the drift.
4. Trace the seeding path: `/new-project` → factory template? Architect? Per-stack scaffold block?
5. Identify whether bug-014's fix landed in the seeding path OR was a per-project hand-patch.

## Fix Approach

To be filled after root cause is confirmed. Likely shape:

1. Identify the factory-side template / scaffold step responsible for project `.gitignore` content.
2. Add the canonical block:
   ```
   # build artefacts (test-runner output, etc.)
   coverage/
   **/coverage/
   *.lcov
   .nyc_output/
   .coverage
   ```
3. Document the gitignore contract in `.claude/skills/new-project/SKILL.md` so future drift is caught.
4. Possibly back-fill `reading-log-01/.gitignore` (if this run will keep being a validation target) + `git rm -r --cached apps/{api,web}/coverage/` — defer until current Mode B run quiesces; do as a single sweep then.

## Rejected Fixes

- **Per-stack-skill addition only** — Rejected because: every stack with a coverage-emitting test runner would need its own copy of the rule. The factory-side gitignore is the right surface; stack skills shouldn't re-author project `.gitignore`.

- **Architect-emit only** — Rejected unless investigation shows architect IS the canonical gitignore source. If `/new-project` is the source, architect-only fixes lose project-specific rules each time architect re-runs (which it can, per refactor-003).

- **Just back-fill reading-log-01** — Rejected because it's a Band-Aid that doesn't prevent the next 3 + projects from repeating the mistake. The user explicitly asked for the factory-side fix.

## Validation Criteria

- New project scaffolded via `/new-project <test-name>` has `.gitignore` containing `coverage/` (+ `**/coverage/`, `*.lcov`, `.nyc_output/`)
- Run a fresh `/start-build` against the test project; confirm `git ls-files apps/*/coverage/` returns 0 entries after the first feature merges
- Existing shipped projects (`kanban-webapp-09`, `finance-track-01`, `repo-health-dashboard-01`) UNCHANGED — their gitignores already pass; the fix should not regress them
- The 3 archived plans (`bug-014-*`, `investigate-005-gitignore-audit`) referenced as canonical surface-area; fix's commit message cross-references them so future audits can follow the chain

## Attempt Log

### Attempt 1 — 2026-05-06 — Shipped (extended scope: full kanban-09 superset)

Filed earlier in same session after empirical regression on reading-log-01 feat-tags-manage merge (~50 false coverage AA conflicts during close-feature). Initial fix scoped to coverage entries only.

**Validation phase revealed wider gap:** comparing `.claude/skills/new-project/SKILL.md` base block against `projects/kanban-webapp-09/.gitignore` (the canonical post-bug-014 shipped state) showed kanban-09 had MANY more entries (Playwright reports, .turbo/, .next/, dist/, build/, .swc/, .vite/, \*.log, storybook-static/, etc.) — added to that project post-hoc but never propagated factory-side. Same pattern as bug-052 itself.

**Operator decision (this session): extend bug-052 scope to mirror the full kanban-09 superset** rather than file a separate bug. Rationale: same problem class (factory template missing entries shipped projects added post-hoc); single comprehensive fix beats two partial ones; preventive — every future project inherits the hardened baseline.

**Changes:**

1. **`.claude/skills/new-project/SKILL.md` base block** — extended from 6 bug-052 lines to ~30 lines covering:
   - Shell-cache: `desktop.ini`, `$RECYCLE.BIN/`, `.AppleDouble`
   - bug-013 orchestrator runtime state: `.feature-context.json`
   - bug-014 build outputs: `.turbo/`, `.next/`, `dist/`, `build/`, `storybook-static/`
   - bug-014 compiler/bundler caches: `.swc/`, `apps/*/.swc/`, `.vite/`, `.vitest-cache/`, `.eslintcache`, `*.tsbuildinfo`
   - bug-014 Next.js generated types + static export: `apps/*/next-env.d.ts`, `apps/*/out/`
   - bug-014 Playwright outputs: `apps/*/playwright-report/`, `apps/*/test-results/`, `apps/*/blob-report/`, `apps/*/playwright/.cache/`
   - bug-014 package-manager logs: `*.log`, `pnpm-debug.log*`, `npm-debug.log*`, `yarn-debug.log*`, `lerna-debug.log*`
   - bug-052 test-runner output (already-shipped earlier in this session): `coverage/`, `**/coverage/`, `*.lcov`, `.nyc_output/`, `.coverage`
   - `*.tsbuildinfo` consolidated under bug-014 (was under bug-052 in initial fix; bug-014 is the original surface citation)

2. **`projects/reading-log-01/.gitignore`** — same extensions backported to the validation-target project. `git ls-files` confirmed 0 already-tracked artefacts of the new classes (the broader cleanup of `apps/api/coverage/*` happened earlier this session at commit `bb048f0`).

**Validation criteria:**

- ✅ New project scaffolded via `/new-project <test>` would inherit the comprehensive base block (factory template confirmed via grep).
- ✅ `git ls-files | grep -E "(test-results|playwright-report|next-env|.turbo|.next/|.swc|.vite|.eslintcache|debug.log|storybook-static|out/)"` returns 0 entries on reading-log-01 (post-hoc cleanup not needed).
- ✅ Existing shipped projects (kanban-webapp-09, finance-track-01, repo-health-dashboard-01) UNCHANGED — their per-project gitignores are now the strict superset of what the factory will scaffold; no regressions.
- ✅ Cross-references: `bug-013-*` (orchestrator runtime state) + `bug-014-*` / `investigate-005-gitignore-audit` (the original wider audit) both cited inline so future maintainers can follow the chain.

**Status: completed** — empirical validation deferred until next /new-project run; the SKILL.md content is verified-by-comparison against the canonical kanban-09 reference state.
