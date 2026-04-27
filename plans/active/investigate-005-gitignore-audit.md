---
id: investigate-005-gitignore-audit
type: investigation
status: draft
author-agent: claude-opus-4-7
created: 2026-04-26
updated: 2026-04-26
parent-plan: bug-013-feature-context-gitignore
supersedes: null
superseded-by: null
branch: null
affected-files:
  - .gitignore
  - projects/kanban-webapp-pre-build/.gitignore
  - projects/book-swap-pre-build/.gitignore
  - projects/finance-track-pre-build/.gitignore
  - projects/repo-health-dashboard-pre-build/.gitignore
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
time-box-minutes: 25
hypothesis: "Multiple generated artifact patterns beyond `.feature-context.json` (bug-013) and `apps/*/out/` + `*.tsbuildinfo` + `playwright-report/` + `test-results/` (the in-flight bug-014 partial fix) get pulled into worktree commits by feat-018's `git add -A`. They cause the same class of AA/UU merge conflicts when parallel features merge. An exhaustive enumeration is needed to write a single complete `.gitignore` instead of patching one pattern at a time."
---

# investigate-005-gitignore-audit: Enumerate every generated artifact at risk of parallel-merge conflict

## Question

Beyond `.feature-context.json` (fixed via bug-013) and the just-discovered `apps/web/tsconfig.tsbuildinfo`, `apps/web/out/`, `apps/web/playwright-report/`, what other auto-generated build artifacts get committed by the orchestrator's feat-018 `git add -A` and risk producing AA / UU merge conflicts when wave-N features merge in parallel? Produce a single audit-grade enumeration so the next `.gitignore` patch is comprehensive rather than reactive.

## Hypothesis

The Next.js + Vitest + Playwright + TS + pnpm + Turborepo stack has a well-known generated-artifact surface; the current `.gitignore` covers ~70% of it but predictably misses:

1. **Test-cycle outputs** that don't exist when `.gitignore` is first authored but appear after `pnpm test` runs in a worktree (`coverage/`, `.vitest-cache/`, Playwright trace zips under `test-results/`)
2. **Per-build hash-named files** (`apps/web/out/_next/static/chunks/<hash>.js`) — covered by `apps/*/out/` but only AFTER bug-014's update
3. **Editor / OS noise** that Windows builders inadvertently produce (`Thumbs.db`, `desktop.ini`, `.idea/`)
4. **Reviewer-emitted files** (`docs/review-*.json`) that are unique-per-feature today (so safe) but become AA-conflict candidates if two features get the same review-id

The fix must be applied to BOTH the factory `.gitignore` (used during factory dev) AND the four `projects/*-pre-build/.gitignore` snapshots (used at `/new-project` to seed every new generated app).

## Investigation Steps

1. Read every `.gitignore` in scope (`agentflow_phase2/.gitignore` + `projects/{kanban,book-swap,finance-track,repo-health-dashboard}-pre-build/.gitignore`)
2. `git log --all --name-only --diff-filter=A` across the four kanban worktrees that have actually run Mode B (-01, -05, -06, -07) — extract every ADDED path, group by directory pattern, flag generated-looking ones
3. `git status --ignored` in -06 / -07 to see what's currently in the working tree but NOT covered (drift candidates)
4. Cross-check against canonical "best-practice" `.gitignore` for each stack the projects use (Next.js, Vitest, Playwright, TS, pnpm, Turborepo)
5. Compare per-project deltas — does `repo-health-dashboard-pre-build` need things `kanban-webapp-pre-build` doesn't? (different stack possibilities)
6. Check `packages/ui-kit/` for build artifacts that agents could commit (`dist/`, `storybook-static/`, `.tsbuildinfo`)

## Findings

### 1. Current `.gitignore` coverage (baseline)

Factory `agentflow_phase2/.gitignore` covers: `node_modules/`, `.pnpm-store/`, `.next/`, `dist/`, `.expo/`, `.turbo/`, `coverage/` (NOT explicitly — wait, it's NOT in factory; only `.next/`, `dist/`, `.expo/`, `.turbo/`), `.DS_Store`, `Thumbs.db`, `.idea/`, `.vscode/`, `*.swp`, `.feature-context.json`, `.playwright-mcp/`, `pipeline/`, `.env`, `*.pem`, `*.key`, `*.p12`, plus the bug-014 partial fix: `apps/*/out/`, `apps/*/playwright-report/`, `apps/*/test-results/`, `apps/*/blob-report/`, `apps/*/playwright/.cache/`, `*.tsbuildinfo`.

`projects/kanban-webapp-pre-build/.gitignore` covers a similar set BUT ALSO adds `build/` and `coverage/` (factory does not). It's missing `.expo/`, `.idea/`, `.vscode/`, `*.swp`, `.pnpm-store/`, `.playwright-mcp/`. Otherwise consistent with factory + bug-014 entries.

`projects/book-swap-pre-build/.gitignore` — same as kanban (has `coverage/`, missing IDE/OS extras). One ordering difference (`dist/` before `.next/`).

`projects/finance-track-pre-build/.gitignore` — identical to kanban.

`projects/repo-health-dashboard-pre-build/.gitignore` — **missing `.next/`, `dist/`, `build/`, `.turbo/`, `coverage/`**. This is a real gap; if `/architect` picks `react-next` for this project (likely per `repo-health-dashboard-pre-build/CLAUDE.md`), these are guaranteed to surface.

### 2. Confirmed risks (already observed in commit history)

Each finding below cites a real commit + worktree where the file was ADDED as evidence.

- **`apps/web/tsconfig.tsbuildinfo`** — TypeScript `--incremental` cache. Binary-ish, regenerated on every `tsc`. ADDED in `kanban-webapp-05` commit `fe45670` (web-frontend-builder bootstrap), `kanban-webapp-06` commit `8dd3dd4`, `kanban-webapp-07` commit `a6a6703`. Already in `.gitignore` via `*.tsbuildinfo` (bug-014 partial fix). **CONFIRMED — already covered.**

- **`apps/web/out/**`** — Next.js static export (`next export` output, ~30 hash-named files: `_next/static/chunks/<hash>.js`, `_next/static/css/<hash>.css`, plus generated HTML for every route). ADDED in `kanban-webapp-05` commit `e650905` (single feature added 30 files in one commit). Hash-named files differ on every build → guaranteed AA conflict if two features both run `next build`. Already in `.gitignore` via `apps/*/out/` (bug-014). **CONFIRMED — already covered.**

- **`apps/web/playwright-report/index.html`** — Playwright HTML test report (~960KB monolithic file). ADDED in `kanban-webapp-05` commits `d428433` + `e09ac3e` (2 feature branches both committed it). Different timestamp/run-id per feature → AA conflict on parallel merge. Already covered via `apps/*/playwright-report/` (bug-014). **CONFIRMED — already covered.**

- **`apps/web/test-results/.last-run.json`** — Playwright last-run metadata (~50 bytes). ADDED in `kanban-webapp-05` commits `d428433` + `e09ac3e`. Same AA risk. Already covered via `apps/*/test-results/` (bug-014). **CONFIRMED — already covered.**

- **`apps/web/next-env.d.ts`** — Auto-generated by Next.js dev/build. ADDED in `kanban-webapp-05` commits `e650905` + `e09ac3e` (two features both regenerated it differently), `kanban-webapp-06` commit `8dd3dd4`. Currently MODIFIED in `kanban-webapp-06` working tree (uncommitted drift). Also currently MODIFIED in `kanban-webapp-07` (the same file appears in `git status` as modified, even after the bug-014 fix). **NOT IN .gitignore** — Next.js convention is "commit it" but it's literally regenerated by `next dev|build` each run, and we've seen it cause MM (modify/modify) on parallel branches. RECOMMEND: ignore it and let `next build` regenerate post-merge. .gitignore line: `apps/*/next-env.d.ts`. **CONFIRMED RISK — not covered.**

- **`.feature-context.json`** — Orchestrator runtime state. Hit on `kanban-webapp-05` (commit `c2800bc`) + `kanban-webapp-06` (commit `eb3a869` + `97feb33`). Already covered via bug-013. **CONFIRMED — already covered.**

### 3. Speculative risks (not yet observed but high-probability under the stack)

These haven't appeared in commit history but are commonly produced by the test/build stack and will surface on future feature waves. Ranked by likelihood.

- **`apps/web/coverage/`** — Vitest coverage output (`pnpm vitest run --coverage` per `testing-policy.md`). HTML + lcov + json files, regenerated each run. The tester runs this on every feature; if `git add -A` fires, every parallel feature commits a different `coverage/` tree → guaranteed AA. Factory `.gitignore` MISSING `coverage/`; project `.gitignore` files HAVE it (except `repo-health-dashboard-pre-build`). RECOMMEND: add `coverage/` to factory + `repo-health-dashboard-pre-build`.

- **`apps/*/.next/`** — Already covered factory-wide via `.next/`. SAFE.

- **`apps/*/.swc/`** — SWC compilation cache (Next.js + Vitest both use SWC; `.swc/` cache persists across runs). Not covered anywhere. RECOMMEND: add `apps/*/.swc/` and `.swc/` (root-level).

- **`apps/web/.turbo/`** — Per-app turbo cache (in addition to repo-root `.turbo/`). Already covered via `.turbo/` (top-level), which matches anywhere. SAFE.

- **`apps/web/playwright/.cache/`** — Playwright browser binary cache. Already covered (bug-014). SAFE.

- **`apps/web/blob-report/`** — Playwright blob (Playwright Service) report directory. Already covered (bug-014). SAFE.

- **`apps/web/test-results/<test-name>/trace.zip` + `screenshot.png`** — Playwright failure traces (binary). The dir `apps/*/test-results/` is covered (bug-014), so children are covered. SAFE.

- **`*.log`** — pnpm install logs, Next.js error logs (`pnpm-debug.log`, `next-lint-debug.log`). Hit during `pnpm install` failures. Not covered. RECOMMEND: `*.log`, `pnpm-debug.log*`, `npm-debug.log*`, `yarn-debug.log*`, `lerna-debug.log*`.

- **`.eslintcache`** — ESLint cache produced by `eslint --cache`. Different per branch. Not covered. RECOMMEND: `.eslintcache`.

- **`.vitest-cache/` / `.vite/`** — Vite & Vitest dev caches. Not covered. RECOMMEND: `.vitest-cache/`, `.vite/`.

- **`packages/*/dist/`** — If any non-source-only package adds a build step (ui-kit currently ships source-only via `"main": "./src/index.ts"`, so SAFE today). Already covered via top-level `dist/`. SAFE.

- **`packages/ui-kit/storybook-static/`** — If Storybook is ever added to ui-kit (currently isn't). Not covered. RECOMMEND: `storybook-static/`.

- **Editor/OS noise on Windows** — `desktop.ini`, `$RECYCLE.BIN/`, `.AppleDouble`. Not covered. Builders running on Windows + macOS have produced these in other orgs; cheap to add. RECOMMEND: `desktop.ini`, `$RECYCLE.BIN/`, `.AppleDouble`.

- **`apps/*/.next/cache/`** — Already covered via parent `.next/`. SAFE.

- **`*.tsbuildinfo` at non-app paths** — e.g. `packages/types/tsconfig.tsbuildinfo` if `tsc --build` runs at the workspace root. Already covered via `*.tsbuildinfo` (bug-014). SAFE.

### 4. Reviewer-output ambiguity (NOT a generated-artifact issue but flagged for awareness)

- **`docs/review-*.json`** — Reviewer-agent emits these (e.g. `docs/review-bootstrap-review.json`, `docs/review-theme-review.json` in kanban-06). Each is keyed by feature/`reviewId` and is unique per feature, so AA collisions are unlikely TODAY. BUT: if two features ever share a `reviewId` (or the reviewer ever emits a shared filename like `docs/review-summary.json`), AA risk returns. This is a reviewer-agent contract issue, not a `.gitignore` issue. **NOT recommending a `.gitignore` entry** — these are intentional artifacts of record. Flagging here so a separate plan can audit reviewer-agent output naming if needed.

### 5. Stack-specific recommendations

| Stack | Already covered | Missing — recommended |
|---|---|---|
| **Next.js 15** | `.next/`, `apps/*/out/`, `apps/*/playwright/.cache/` | `apps/*/next-env.d.ts`, `apps/*/.swc/`, `.swc/` |
| **TypeScript** | `*.tsbuildinfo`, `dist/` | (none — covered) |
| **Vitest** | (project-level `coverage/` only — factory misses it) | `coverage/` (factory + repo-health-dashboard-pre-build), `.vitest-cache/` |
| **Playwright** | `apps/*/playwright-report/`, `apps/*/test-results/`, `apps/*/blob-report/`, `apps/*/playwright/.cache/` | (none — covered) |
| **pnpm** | `node_modules/`, `.pnpm-store/` | `pnpm-debug.log*` |
| **Turborepo** | `.turbo/` | (none — covered) |
| **ESLint** | (nothing) | `.eslintcache` |
| **Vite (transitive via Vitest)** | (nothing) | `.vite/` |
| **General** | `.DS_Store`, `Thumbs.db` | `*.log`, `desktop.ini`, `$RECYCLE.BIN/`, `.AppleDouble` |
| **Orchestrator runtime** | `.feature-context.json`, `.claude/state/`, `.claude/worktrees/` | (none — covered post-bug-013) |

### 6. Per-project deltas

- **`projects/kanban-webapp-pre-build/.gitignore`** — most complete; baseline for the others. Apply the additions in §5 uniformly.
- **`projects/book-swap-pre-build/.gitignore`** — book-swap is a multi-surface project (admin + customer + mobile), so `apps/*/` patterns are more important. May ALSO need expo-specific ignores when mobile is added: `apps/mobile/.expo/`, `apps/mobile/web-build/`, `apps/mobile/dist/`, plus Maestro test artifacts: `apps/mobile/.maestro/cache/`. Add these speculatively now since the brief says mobile is in scope.
- **`projects/finance-track-pre-build/.gitignore`** — full-stack web + SQLite. Add SQLite-specific ignores: `*.sqlite`, `*.sqlite-journal`, `*.sqlite-wal`, `*.sqlite-shm`, `*.db`, `*.db-journal` — to prevent accidental commit of dev SQLite databases (the brief's `DATABASE_PATH` env var implies file-based storage at a configurable path which agents could put inside the repo).
- **`projects/repo-health-dashboard-pre-build/.gitignore`** — **MUST add the basics that are missing today**: `.next/`, `dist/`, `build/`, `.turbo/`, `coverage/`. Plus the new entries from §5.

## Recommendation

Create a follow-up `bug-014-gitignore-comprehensive` plan (or extend the in-flight bug-014) to apply the consolidated `.gitignore` patch below to all five files. Single PR; idempotent (use `grep -q` to skip lines already present). Re-run `kanban-webapp-08` (next clean Mode B test) to validate that no further unexpected artifacts surface.

### Exact lines to ADD to factory `.gitignore` (`agentflow_phase2/.gitignore`)

```gitignore
# Vitest coverage (factory was missing this — projects had it)
coverage/

# Next.js auto-generated type shim — regenerated each `next build`
apps/*/next-env.d.ts

# SWC cache (Next.js + Vitest)
.swc/
apps/*/.swc/

# Vite/Vitest dev cache
.vite/
.vitest-cache/

# ESLint cache
.eslintcache

# Common log dribble (causes MM conflicts when two builders both fail install)
*.log
pnpm-debug.log*
npm-debug.log*
yarn-debug.log*
lerna-debug.log*

# Storybook (if ever added to ui-kit or any app)
storybook-static/

# Windows + macOS noise not yet covered
desktop.ini
$RECYCLE.BIN/
.AppleDouble
```

### Exact lines to ADD to all four `projects/*-pre-build/.gitignore`

Same as factory additions above, PLUS per-project extras:

**`projects/kanban-webapp-pre-build/.gitignore`** — additions only (already has most basics):

```gitignore
# Same block as factory additions above
```

**`projects/book-swap-pre-build/.gitignore`** — factory additions PLUS Expo/mobile:

```gitignore
# Expo (mobile)
apps/mobile/.expo/
apps/mobile/web-build/
apps/mobile/dist/

# Maestro E2E cache
apps/mobile/.maestro/cache/
```

**`projects/finance-track-pre-build/.gitignore`** — factory additions PLUS SQLite:

```gitignore
# SQLite (DATABASE_PATH may resolve inside repo)
*.sqlite
*.sqlite-journal
*.sqlite-wal
*.sqlite-shm
*.db
*.db-journal
```

**`projects/repo-health-dashboard-pre-build/.gitignore`** — **CRITICAL MISSING BASICS** + factory additions:

```gitignore
# Build outputs (currently missing entirely from this file)
.next/
dist/
build/
.turbo/
coverage/

# (then the same factory additions block)
```

### Order of operations for the fix PR

1. Apply factory additions block to `agentflow_phase2/.gitignore`
2. Apply factory additions to all four `projects/*-pre-build/.gitignore` files
3. Apply per-project extras to book-swap / finance-track
4. Apply CRITICAL MISSING BASICS to `repo-health-dashboard-pre-build` first, then additions
5. For LIVE projects (kanban-webapp-01, -05, -06, -07): apply the same updates to their `.gitignore` (the file is project-local now; pre-build snapshot only seeds new projects)
6. Run `git rm --cached` on already-tracked files now newly ignored: `apps/*/next-env.d.ts`, `apps/*/tsconfig.tsbuildinfo` (already removed?), `.feature-context.json` (already removed via bug-013), then commit removal so live history stops drifting
7. Validate: `git check-ignore -v apps/web/coverage/index.html` from a fresh worktree returns the new rule

### Out-of-scope (separate plans)

- **Reviewer-agent output naming audit** — `docs/review-*.json` is intentional commit; ensure reviewer never emits shared filenames. Flag a `refactor-008-reviewer-output-naming` plan if needed.
- **Structural relocation of `.feature-context.json` to `.claude/state/feature-contexts/`** — bug-013 already noted this as a post-MVP cleanup. Out of scope for this audit.
- **Address the root cause: `git add -A` is too greedy** — A separate refactor could change feat-018's auto-commit to use an explicit allowlist of paths-to-stage rather than `-A`. That would belong in `refactor-009-explicit-commit-allowlist` and would render most of these `.gitignore` entries belt-and-suspenders rather than load-bearing. Recommend doing both: tight `.gitignore` AND explicit-allowlist commit, defense in depth.

## Attempt Log

<!-- Populated automatically by agents. -->
