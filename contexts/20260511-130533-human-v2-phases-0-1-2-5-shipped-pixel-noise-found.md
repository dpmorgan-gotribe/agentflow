---
session-id: "20260511-130533"
timestamp: "2026-05-11T13:05:33Z"
agent: human
task-id: feat-067-pixel-diff-smoke-layer
previous-context: 20260508-225240-human-investigate-025-shipped-v2-epic-filed.md
checkpoint: true
status: in-progress
---

# Context snapshot — human — v2 Phases 0+1+2+5 shipped; pixel-diff noise discovered

## Summary

Long session (~10hr) that shipped v2 Phases 0 (emergency factory bugs), 1 (bug-078 audit-computed-styles config + pre-verify discriminators), 5 (feat-070 systemic-fixer agent), and 2 (feat-067 pixel-diff smoke layer). Two clean commits (`1c92a00` + `ca8a0fd`). Empirical re-validation on reading-log-02 hit ~70% catch rate against the 30-bug census — above the 67% Phase 2 cutover target. BUT — operator-eyeball of the 6 pixel-systemic-divergence diff PNGs revealed they're mostly NOISE: built renders dark mode vs mockup light mode; built has seeded data vs mockup has placeholder. Pixel-diff doesn't understand semantic equivalence so reports 94-98% pixel diff on every screen. The 6 pixel-systemic bugs are phantom-bug risk; running `/fix-bugs` against them would waste ~$25-35 of systemic-fixer dispatches. Session ends with Fix 1 (force light mode in parity-verify) proposed but unimplemented.

## Completed since last snapshot

**Phase 0 — Emergency factory bugs (commit `1c92a00`):**

- **bug-079** — elevate runtime errors on PASSING synth-E2E tests. `scripts/run-synthesized-flows.mjs` walks every passing test's `runtime-errors` attachment, dedups by signature, emits synthesized FlowFailure with `primaryCause: "runtime-error"`. 5 new tests. Plus mechanical fix of 18 pre-existing test stubs (stale post-bug-071 `spawnCallIdx === 1` pattern → simple single-spawn).
- **bug-080** — `ENABLE_TEST_SEED=1` factory contract enforced across 4 stack templates + architect skill §7b + 3 back-end skills. All 4 dev.mjs templates switched from `MERGED_ENV.X ?? "1"` to `process.env.X ?? "1"` so stale `.env` files no longer silently override the dev default. Reading-log-02 backport applied + operator-validated (`curl /test/cleanup` returns 204 ✓).
- **bug-081** — `output: "export"` discriminator + react-next skill §5 Gotcha + §7 Anti-pattern + Self-verify grep guard. Reading-log-02 backport applied + browser-validated (book detail page renders without error overlay ✓).

**Phase 1 — bug-078 (commit `1c92a00`):**

- `scripts/audit-computed-styles.mjs` — flipped conservative defaults: all 4 patterns ship (was: layout-regrouping only); `MAX_DRIFTS_PER_BUCKET` 5 → 20; new `systemic-divergence` fold for tuples >15 drifts. 6 new tests.
- **NEW** `orchestrator/src/pre-verify-discriminators.ts` — 3 filesystem-only checks (CSS pipeline / output:export mismatch / test-seed contract). Wired into `build-to-spec-verify.ts` — P0 hits short-circuit the entire expensive verifier stage in ~10ms vs ~30s. 21 new tests + 4 short-circuit integration tests.
- Caught a comment-string false positive on first reading-log-02 run (regex matched `output:"export"` inside the factory-backport comment); fixed by stripping line + block comments before scanning.

**Phase 5 — feat-070 (commit `1c92a00`):**

- **NEW** `.claude/agents/systemic-fixer.md` — cross-file root-cause variant of bug-fixer (maxTurns:12, multi-file edit authority, per-class diagnostic recipes for 6 systemic bug classes).
- Schema extensions to `packages/orchestrator-contracts/src/{tasks,parity-verify,bugs-yaml}.ts` (closes a latent gap — bug-078's `systemic-divergence` pattern was being emitted but rejected by the parity-pattern enum).
- `scripts/file-bug-plan.mjs` — routing override directs systemic patterns + pre-verify-tooling-\* discriminator hits to `["systemic-fixer"]`.
- `orchestrator/src/model-config.ts` + `.claude/models.yaml` — tier:building + effort:medium + 18-min stall cap.
- `orchestrator/src/bug-fix-context.ts` — new envelope branch pre-loads the 6 systemic-diagnostic files (tailwind/next/postcss/globals.css/.env.example) when agentSequence includes systemic-fixer.

**Phase 2 — feat-067 pixel-diff smoke layer (commit `ca8a0fd`):**

- **NEW** `orchestrator/src/audit-pixel-diff.ts` — pure-function pixelmatch diff + classify. Two patterns: `pixel-minor-divergence` (P1) at diffRatio in (MINOR, SYSTEMIC], `pixel-systemic-divergence` (P0) above SYSTEMIC. 14 tests.
- `orchestrator/src/parity-verify.ts` — per-screen loop now captures `page.screenshot({type:"png", fullPage:false})` for both built + mockup; dynamically imports `auditAndClassifyPixels` + merges output. Diff PNG persists at `<projectDir>/docs/build-to-spec/pixel-diffs/<screenId>.diff.png` + populates `detail.diffPngPath` on the divergence.
- Schema extensions to `ParityDivergenceDetailSchema` (`diffPngPath` + `pixelStats`); mirrored in `BugParityContextSchema` so bugs.yaml round-trip preserves them.
- **Subtle bug discovered + fixed:** `mergeByScreenPattern` was destructuring detail with only the 4 well-known arrays, silently stripping pixel fields. Fix: spread `...div.detail` first, then override arrays with fresh copies + add last-write-wins merge for pixel fields.
- `orchestrator/src/bug-fix-context.ts` — when `bug.parity.detail.diffPngPath` is set, pre-load the diff PNG as the FIRST envelope file (load-bearing for pixel-\* dispatches). 2 new tests.
- Diagnostic addition (uncommitted): also persists `<screenId>.{built,mockup}.png` alongside the diff so operators can triangulate signal vs noise.

**Re-validation:**

- v2 verifier files 21 bug plans against reading-log-02 (15 from Phase 1 + 6 new pixel-systemic).
- ~70% catch rate vs 30-bug investigate-025 census — above 67% Phase 2 cutover threshold.
- Initially looked like a clean v2 ship. Then operator-eyeball of the diff PNGs revealed the noise problem (see Decisions section).

**Issue tracking:**

- 32 pre-existing test failures documented in `docs/ideas.md` 2026-05-11 (29 in build-to-spec-verify.test.ts + 3 in run-synthesized-flows.test.ts). Confirmed pre-existing by checkout-at-commit-011d487. All require ~30 mechanical edits to add `runParity: false` / similar seam stubs. Bundled in docs/ideas.md as a single test-infra plan to bring forward later.

## Current state

- Branch: `feat/quota-observability` (`ca8a0fd`)
- Tests: **103/103 pass** across the 5 v2-touching test files (audit-pixel-diff, parity-verify, bug-fix-context, pre-verify-discriminators, audit-computed-styles). 32 pre-existing rot failures remain in build-to-spec-verify + run-synthesized-flows (documented in `docs/ideas.md` 2026-05-11 — orthogonal to v2 work).
- Uncommitted files: 1 substantive change (parity-verify.ts source-PNG persistence addition, ~10 LOC, ~5 of the M-flagged files are pre-existing user WIP from earlier sessions). The full `M` set in `git status` includes ~20 plan-file edits from prior sessions that I haven't touched + a handful of factory files showing as M because of CRLF normalization (no actual content diff).
- Blockers: **pixel-diff noise on reading-log-02 needs render-mode fix before `/fix-bugs` is safe to run.** Without Fix 1, the 6 pixel-systemic-divergence bugs are mostly phantom + would burn $25-35 of systemic-fixer dispatches.

## Next steps

1. **Ship Fix 1 — force light mode in parity-verify** (~15 min). Add Playwright `context.setColorScheme('light')` or `colorScheme: 'light'` on `newPage()` for both built and mockup. If kit uses `class="dark"` toggle instead of media-query, need to inject DOM cleanup before screenshot. Re-validate and see if diff ratios drop from 94-98% into a meaningful range.
2. **Decide based on Fix 1 result:**
   - If diff ratios drop to 5-30% range → real signal present; commit Fix 1 + run live `/fix-bugs reading-log-02` (~$50-200, 1.5-3hr).
   - If diff ratios stay >50% → Fix 2 needed (uniform data seeding into mockup + built before screenshot) OR ship feat-068 (vision-LLM perceptual review) which can understand semantic equivalence.
3. **Commit the source-PNG persistence diagnostic addition** to parity-verify.ts even before Fix 1 ships — useful diagnostic for future projects.
4. **Bundle test-infra rot fix** as a separate small plan (per docs/ideas.md entries). ~30 mechanical edits across `build-to-spec-verify.test.ts` + `run-synthesized-flows.test.ts`. Low-priority but should land before the next session that runs the full vitest suite.
5. **Plan-archive the v2 phase plans** once Fix 1/2 decisions settle. feat-066 v2 umbrella stays open until empirical re-validation confirms ≥95% production-quality bar (currently at ~70% catch + unknown fix-rate).

## Open questions

- **Q1 — Pixel-diff fundamental limitation on reading-log-02-shaped projects?** The 3 observed mismatches (dark/light, seeded data, mockup placeholder) are STRUCTURAL — they're not project-specific bugs. Future reading-log-02-like projects will hit the same noise. Is the right answer (a) force the mockup + build to render in the same mode + with same fixture data via factory contract, OR (b) accept pixel-diff is noisy for content-driven projects and rely on feat-068 (vision-LLM) for the semantic-equivalence judgment?
- **Q2 — How do we get from 70% catch to 95% production target?** Catch rate doesn't equal fix rate. The fix-loop could converge from 70% catch via iterations OR shell-game. We haven't run end-to-end yet. The empirical signal is gated on Fix 1 landing.
- **Q3 — Should we add the source-PNG persistence as a permanent factory feature or just keep it as diagnostic?** Cheap (small write per screen, 200-500KB total). Highly useful for operator triage when pixel-\* bugs surface. Probably yes-make-permanent + add an env flag to disable for cost-conscious runs.
- **Q4 — Is the `bug-fix-context.ts` envelope's diff PNG resolution actually load-bearing?** The dispatched systemic-fixer would Read the diff.png. But if the diff is noise (per the dark-mode observation), the agent reads a noise image + tries to fix phantom bugs. Needs Fix 1 to validate.

## Key files touched

**Factory commits this session (2 commits):**

- `1c92a00` v2 Phase 0+1+5 — 34 files, +2397 / -115 LOC:
  - NEW: `.claude/agents/systemic-fixer.md`, `orchestrator/src/pre-verify-discriminators.ts`, `orchestrator/tests/pre-verify-discriminators.test.ts`, `scripts/_tmp-v2-validation.mjs`
  - Modified: 4 dev.mjs templates, 3 back-end skill files, react-next skill, architect skill, models.yaml, scripts/audit-computed-styles.mjs, scripts/file-bug-plan.mjs, scripts/run-synthesized-flows.mjs, orchestrator src + tests, packages/orchestrator-contracts/src

- `ca8a0fd` feat-067 Phase 2 — 11 files, +853 / -14 LOC:
  - NEW: `orchestrator/src/audit-pixel-diff.ts`, `orchestrator/tests/audit-pixel-diff.test.ts`
  - Modified: parity-verify.ts (PNG capture + persistence + mergeByScreenPattern fix), bug-fix-context.ts (envelope wiring), bug-fix-context.test.ts (2 new tests), contracts schemas (diffPngPath + pixelStats), package.json + lockfile (pixelmatch + pngjs deps), feat-067 plan + docs/ideas.md

**Uncommitted (Phase D diagnostic):**

- `orchestrator/src/parity-verify.ts` — source-PNG persistence addition (`<screen>.built.png` + `<screen>.mockup.png` alongside `<screen>.diff.png`). ~15 LOC. Ready to commit alongside Fix 1.

**Project-side (reading-log-02 — gitignored from factory):**

- 18 PNGs persisted at `projects/reading-log-02/docs/build-to-spec/pixel-diffs/` (6 screens × {built, mockup, diff})
- bugs.yaml regenerated multiple times via validation re-runs; current state has 21 pending bugs (no fix-loop has been run against it)
- `BACKPORTS.md` documents bug-080/081 backports + feat-067 validation result + threshold-tuning guidance

## Decisions made

- **Pixel-diff module as TS not .mjs.** Originally wrote `scripts/audit-pixel-diff.mjs` with `createRequire("pngjs")` for CJS interop; vitest's vite transformer mishandled it when co-running with other tests, throwing SyntaxErrors. Moved to `orchestrator/src/audit-pixel-diff.ts` (standard TS transformer) — completely sidesteps the issue. Future audit modules should follow this pattern unless there's a specific reason for .mjs.
- **Viewport-only screenshots (fullPage:false) in v1 pixel-diff.** Full-page captures are 5-10× larger + don't help the load-bearing whole-screen mismatches we're targeting. Add behind env flag if below-the-fold bugs surface.
- **Source PNG persistence as a diagnostic addition, not a bug-author-feeding feature.** The diff overlay is what the agent reads via Read tool. The source PNGs are operator-triage only (eyeball-the-diff workflow). Saves disk space + complexity.
- **Pre-verify-discriminator regex strips comments before scanning.** Empirical false positive: factory-backport explanatory comment containing `output:"export"` triggered the discriminator. Fix: strip `//` line + `/* */` block comments before regex. Mirror this pattern in any future text-based discriminators.
- **mergeByScreenPattern preserves all detail fields via `...div.detail` spread.** Pre-fix it destructured only the 4 well-known arrays. Adding new schema fields without updating this merge function would silently strip them on the orchestrator side. Generic lesson: any code that "rebuilds" a typed object from its parts is a regression risk when the schema grows.
- **`PIXELMATCH_THRESHOLD` env override is operator-driven, not factory-defaulted.** Per investigate-025 §Decisions, threshold tuning is empirical operator work. Defaults stay at MINOR=0.02 / SYSTEMIC=0.15 / PIXELMATCH=0.1.
- **`build-to-spec-verify.test.ts` rot is pre-existing, not a regression I introduced.** Confirmed by `git stash` + checkout-pre-v2 reproduction. The earlier "821/824 passing" measurements were misreads. Bundle the fix with the run-synthesized-flows rot — ~30 mechanical edits.
- **70% catch rate vs 95% production target — distinction matters.** Catch rate is the verifier's first-pass detection; fix rate is what we ACTUALLY want (% of caught bugs the fix-loop resolves). Hitting 95% is a function of (a) catch rate × (b) loop convergence behavior. We have (a) but haven't measured (b). The user's concern is valid: 70% catch isn't sufficient by itself.
- **Pixel-diff is fundamentally noisy on content-driven projects.** Dark/light mode + data-presence mismatches produce 90%+ pixel diff even when structure matches. This is a CLASS limitation of pixel-diff, not a calibration bug. Long-term answer is feat-068 (vision-LLM perceptual review). Short-term answer is forcing render-mode + data parity in the verifier capture phase.
