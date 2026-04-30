---
id: bug-030-audit-reachability-false-positive-flood
type: bug
status: completed
author-agent: claude-opus-4-7
created: 2026-04-29
updated: 2026-04-29
completed-at: 2026-04-29
parent-plan: bug-028-audit-reachability-misses-router-push
supersedes: null
superseded-by: null
branch: fix/audit-reachability-false-positive-flood
affected-files:
  - scripts/audit-app-reachability.mjs
feature-area: orchestration
priority: P1
attempt-count: 1
max-attempts: 5
error-message: "62 P0 reachability-orphan bugs filed against repo-health-dashboard-01 in the verify+fix-loop run on 2026-04-29; ≥4 manually verified as false positives, sample suggests rate near 100%."
reproduction-steps: "Run /build-to-spec-verify (or `--resume-feature-graph --bugs-yaml-mode=fresh`) against any project whose ui-kit primitives are consumed via the @repo/ui-kit barrel and whose app components are consumed via folder-level `index.ts` re-exports."
stack-trace: null
---

# bug-030 — `audit-app-reachability.mjs` false-positive flood from barrel re-export blindness + path-alias gap

## Bug Description

The verify+fix-loop run for `repo-health-dashboard-01` on 2026-04-29 (commit `5317b01` head, run-id `6b5985b4-3543-4db2-8f3e-07d9026e76c8`) filed **64 bugs** to `docs/bugs.yaml`:

- **62 P0 reachability-orphan** (filed by `scripts/audit-app-reachability.mjs`)
- **2 P1 visual-parity** (filed by `parity-verify` Phase B)

Spot-check of the 62 reachability-orphan bugs against the project tree confirmed ≥4 are demonstrable false positives — production code that IS imported and rendered, but the audit script's reachability heuristic doesn't see the consumption. Pattern strongly suggests the false-positive rate across the 62 is near 100%.

If the loop had been allowed to dispatch builders against these false positives at ~$0.10–$0.50/dispatch × 62 bugs × up to 3 retries each, we'd burn $20–$90 on no-op fixes and risk builders accidentally breaking working code by deleting "unused" files.

**Expected:** the audit script flags only files that are genuinely unreferenced by any production-reachable surface.

**Actual:** the script flags files that are consumed via (a) workspace-package barrel re-exports through `@repo/ui-kit`, (b) intra-app folder-level `index.ts` barrel re-exports, and (c) potentially `@/` path-alias imports.

## Reproduction Steps

1. Project must have a populated `packages/ui-kit/` (primitives consumed via the package barrel) AND folder-level `index.ts` re-exports inside `apps/web/components/` (a common React App-Router idiom).
2. From factory root: `pnpm --filter orchestrator start generate <project> --resume-feature-graph --pipeline-run-id <run-id> --bugs-yaml-mode=fresh`
3. Verify stage runs `audit-app-reachability.mjs <project-dir>` and writes results to `docs/bugs.yaml`.
4. Inspect `docs/bugs.yaml` — observe orphans for files that are demonstrably consumed.

Confirmed reproduction on `repo-health-dashboard-01` (2026-04-29 run). Bug-tagged `componentPath` entries that are actually consumed:

| Flagged orphan                                         | Actual consumer (production code)                                                                                           |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `packages/ui-kit/src/primitives/tooltip/tooltip.tsx`   | `apps/web/app/about/page.tsx:14` (`import { Tooltip } from "@repo/ui-kit"`) used at line 198                                |
| `apps/web/components/header/header.tsx` (`SiteHeader`) | `apps/web/app/layout.tsx` (`import { SiteHeader } from "@/components/header"`) — folder barrel `header/index.ts` re-exports |
| `apps/web/components/providers.tsx` (`Providers`)      | `apps/web/app/layout.tsx` (`import { Providers } from "@/components/providers"`) — direct path-alias                        |
| `apps/web/lib/example-repos.ts` (`EXAMPLE_REPOS`)      | `apps/web/app/page.tsx` direct import                                                                                       |

## Error Output

Excerpt from `projects/repo-health-dashboard-01/docs/bugs.yaml` after the verify run:

```yaml
- id: bug-orphan-tooltip
  iteration: 1
  source: reachability-orphan
  severity: P0
  summary: Component Tooltip not rendered by any reachable page
  orphan:
    componentPath: packages/ui-kit/src/primitives/tooltip/tooltip.tsx
  ...
- id: bug-orphan-siteheader
  source: reachability-orphan
  severity: P0
  orphan:
    componentPath: apps/web/components/header/header.tsx
  ...
- id: bug-orphan-providers
  source: reachability-orphan
  severity: P0
  orphan:
    componentPath: apps/web/components/providers.tsx
  ...
```

Bug count by source (from grep against the 64-bug yaml):

```
   62  source: reachability-orphan   (severity P0)
    2  source: visual-parity         (severity P1)
```

## Root Cause Analysis

Two distinct gaps in `scripts/audit-app-reachability.mjs`, exposed simultaneously by bug-028's `SCAN_ROOTS` expansion (commit referenced in `plans/archive/bug-028-audit-reachability-misses-router-push.md` — pre-bug-028, `packages/` was outside scan; bug-028 added it as a scan target so its primitives are now eligible for orphan-flagging).

### Gap 1 — barrel re-export chains not traced

The audit's reachability walker treats each file as an atomic node. When `packages/ui-kit/src/index.ts` contains `export * from "./primitives/tooltip"`, the walker marks `./primitives/tooltip/index.ts` as referenced. But `./primitives/tooltip/index.ts` itself is just `export * from "./tooltip"` — a second-hop re-export to `./tooltip.tsx` (the actual implementation file).

Reachability propagation stops at the first re-export. The implementation `.tsx` files are flagged orphan even though their public symbols are reached through the barrel chain.

**Manifestations in repo-health-dashboard-01:**

- Every `packages/ui-kit/src/primitives/*/{name}.tsx` (Tooltip, Textarea, etc. — ~12 primitives)
- Every `packages/ui-kit/src/layouts/*/{name}.tsx` (AppShell, Auth, FocusedTask, Marketing, SplitView)
- `packages/ui-kit/src/index.ts` (barrel itself, when nothing inside it is reached transitively)
- `packages/ui-kit/src/tokens/tokens.ts`
- `packages/ui-kit/src/lib/cn.ts`
- App-side folder barrels: `apps/web/components/header/header.tsx` (consumed via `@/components/header` → `header/index.ts` → `./header`), `apps/web/components/report/index.ts` (barrel), and the error-screen siblings re-exported through it

### Gap 2 — path-alias resolution (suspected)

`apps/web/components/providers.tsx` is consumed by `apps/web/app/layout.tsx` via direct path-alias import: `import { Providers } from "@/components/providers"`. There is no folder barrel between layout and providers — this should be a single-hop reachability detection.

The fact that this still got flagged suggests one of:

- The audit script doesn't resolve `@/` path-aliases at all (`@/` is a tsconfig.json `paths` mapping pointing at `apps/web/`)
- OR the audit script doesn't treat `apps/web/app/layout.tsx` as a reachability _root_ (it should — the App Router's `layout.tsx` wraps every route)
- OR the audit script does grep-only matching and the file's `import { Providers }` line happens to not be matched by whatever pattern is being applied

Investigation step needed to disambiguate before fixing. The `Providers` case is small but load-bearing: whichever of these mechanisms is broken almost certainly affects more than just `providers.tsx`.

## Fix Approach

Two viable paths — pick after the §Root Cause Analysis investigation step disambiguates Gap 2.

### Option A — Cheap: drop `packages/` from SCAN_TARGETS

Revert bug-028's `packages/` SCAN*ROOTS expansion. Library packages have their own consumer chain via `package.json` exports + bundler resolution; the audit's purpose is to find unreachable code in \_apps*, not in shared libs. Apps reference primitives via the `@repo/ui-kit` package alias — the audit doesn't need to resolve that alias into actual file paths to know primitives are consumed; the _symbol_ `Tooltip` showing up in app source already implies the primitive is reached.

This eliminates ~80% of the false positives (every primitive + layout + ui-kit internal). It does NOT fix the app-side barrel-traversal gap (Gap 1 within `apps/web/components/`) or the path-alias gap (Gap 2).

**Risk:** if a primitive really IS dead code in `packages/ui-kit/`, this option won't catch it. Acceptable trade-off — primitives' upstream ownership is `/stylesheet`, not the orchestrator's verify pass; that surface has its own gates (refactor-006 hard-gate on ≥12 primitives, `validate-consumer` ESLint rule).

### Option B — Correct: teach the audit to follow re-export chains AND resolve path-aliases

For Gap 1: when a `*.{ts,tsx}` file contains `export * from "./x"` or `export { Foo } from "./x"`, mark the resolved target (`./x.ts`, `./x.tsx`, `./x/index.ts`, `./x/index.tsx`) as reachable transitively from whatever marks the barrel as reachable. Same for cross-package re-exports through `@repo/<name>` package aliases.

For Gap 2: read the project's `apps/web/tsconfig.json` (if present) and apply its `paths` mapping when resolving import specifiers. If that's already happening, the bug is elsewhere (investigation step required).

**Risk:** AST-level re-export tracing is more code than a regex bandaid; cycles in re-export chains need a visited-set. tsconfig path-aliases vary across stacks (next, vite, sveltekit) — would need per-stack handling.

### Recommendation

**Ship Option A first** (commit message: "bug-030 Phase A: revert packages/ from SCAN_ROOTS — barrel re-export chains untraced"). This unblocks the verify+fix-loop end-to-end test on `repo-health-dashboard-01` immediately. File a follow-up `feat-` plan for Option B's correct re-export tracing (lower urgency now that the flood is gone). Run an investigation step on Gap 2 before deciding whether to fold it into Option A or treat as separate.

## Rejected Fixes

- **Bypass via `--no-bug-plans`** — surfaces the orphans in the return JSON without filing bugs, but the verify stage's `ok === false` still propagates and the orchestrator marks the run `completed-with-integration-failures`. Doesn't actually fix the underlying scanner; just hides the noise. Rejected because the false positives still distort future runs and operators have to mentally filter.
- **Add an "orphan allowlist" to skip primitives** — fragile, leaks the barrel-blindness root cause into operator workflow, doesn't generalize to app-side barrels. Rejected.

## Validation Criteria

1. Re-run `node scripts/audit-app-reachability.mjs projects/repo-health-dashboard-01` after the fix.
2. Spot-check the 4 confirmed false positives above (`Tooltip`, `SiteHeader`, `Providers`, `EXAMPLE_REPOS`) — none should appear in `orphanComponents`.
3. Sanity-check that genuine orphans still surface — e.g., temporarily add a `apps/web/lib/zzz-unused.ts` exporting an un-imported symbol; the audit should flag it.
4. End-to-end test: run `/start-build repo-health-dashboard-01 --resume-feature-graph --pipeline-run-id 6b5985b4-... --bugs-yaml-mode=fresh` — expect `docs/bugs.yaml` to contain ≤ a handful of bugs (only the 2 visual-parity divergences and any TRULY unreachable orphans).
5. Regression: existing repo-health-dashboard-01 fixes for `/r/` → `/report/` (bug-028's empirical case) must still detect the original orphan-route pattern when reverted — i.e., bug-030's fix doesn't regress bug-028's coverage.

## Attempt Log

### Attempt 1 — Phase A shipped 2026-04-29 (this session)

Three surgical edits to `scripts/audit-app-reachability.mjs`:

1. **`SCAN_ROOTS` reverted to exclude `packages/`** (lines ~38–55). bug-028 had added it; reverting eliminates the entire ui-kit primitive flood (Tooltip, Textarea, AppShell, Card, etc.). Inline comment cites bug-030 explaining why packages/ is policed elsewhere (/stylesheet hard-gate + validate-consumer ESLint).
2. **`@/` alias roots prepend `apps/web`** (line ~257). Previously the alias resolver only tried `apps/web/src` and `apps/web/app`. For modern Next App Router projects whose `components/` and `lib/` sit alongside `app/` (not under `app/`), this resolved every `@/components/foo` import to a non-existent path → unresolved → file flagged orphan. Fixed by adding `apps/web` (the project root) and `apps/mobile` to the alias-root list.
3. **`IMPORT_RE` extended to capture `export … from`** (line ~298). Added a third alternative: `export\s+(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]`. This treats re-exports as importer edges, so folder barrels like `apps/web/components/header/index.ts → ./header` propagate reachability. The consumer now reads `m[1] ?? m[2] ?? m[3]`.

### Validation results

| Test                                                                        | Pre-fix                                          | Post-fix                                 |
| --------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------- |
| `node scripts/audit-app-reachability.mjs projects/repo-health-dashboard-01` | 62 orphans (4 spot-checked, all false positives) | **0 orphans** (`ok: true`)               |
| Synthetic regression (planted `apps/web/lib/__zzz-genuine-orphan.ts`)       | n/a                                              | Correctly flagged: 1 orphan, `ok: false` |
| Tooltip (was flagged)                                                       | flagged                                          | not flagged                              |
| SiteHeader via header/index.ts barrel                                       | flagged                                          | not flagged                              |
| Providers via `@/components/providers`                                      | flagged                                          | not flagged                              |
| EXAMPLE_REPOS via `@/lib/example-repos`                                     | flagged                                          | not flagged                              |

### Outcome

Empirical false-positive rate on `repo-health-dashboard-01`: **62 → 0**. Phase A objective met. The follow-up structural improvements (proper TypeScript-aware reachability via tsconfig.json `paths` reading, full re-export chain tracing across workspace packages, named-vs-default-export disambiguation) are deferred to **feat-037-audit-reachability-ts-aware-rewrite** — not load-bearing for the current verify+fix-loop end-to-end test.

### Lessons

1. **bug-028's SCAN_ROOTS expansion was too aggressive.** Including `packages/` made every workspace-package primitive an orphan candidate, exposing the audit's barrel-blindness as a noise source instead of a latent bug. The cheap revert (drop `packages/`) was correct because the audit's purpose is finding unreachable code in _apps_, not in shared libs which have their own dead-code policing surfaces (/stylesheet hard-gate + validate-consumer ESLint).
2. **The `@/` alias heuristic encoded an outdated Next.js convention.** Pre-App-Router projects placed components under `apps/web/src/`; modern App Router puts them as siblings of `apps/web/app/`. The fix trivially extends the alias-root candidate list.
3. **Regex-based re-export matching is sufficient for the common cases** (`export * from`, `export { X } from`). A full TS AST parse would be more correct but the marginal catch-rate over the regex extension is small for typical project layouts. Defer the AST rewrite until empirical evidence shows regex misses.
