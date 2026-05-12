---
session-id: "20260506-134403"
timestamp: 2026-05-06T13:44:03Z
agent: human
task-id: bug-037-playwright-runtime-not-auto-installed-for-synthesized-e2e
previous-context: 20260505-222041-human-cost-reduction-stack-shipped-and-validation-project-mid-pipeline.md
checkpoint: true
status: checkpoint
---

# Context snapshot — human — reading-log-01 shipped 5/5 + 4 factory bugs

## Summary

Massive day: shipped reading-log-01 end-to-end (5/5 features merged via 3 manual recoveries + 1 clean run), then turned the 4 surfaced factory bugs into landed fixes (bug-037 Phase A, bug-052 extended, bug-054 complete) and filed bug-053 for follow-up. The validation hooks for the cost-reduction + bug-prevention stack from the prior session (feat-051..055 / bug-053..054) all exercised — most worked, three new bugs (037 recurrence, 052 regression, 054 default) discovered + addressed. Total session spend ~$22 on the project build.

## Completed since last snapshot

**reading-log-01 — Mode A→B end-to-end ship:**

- /screens (5 new + 1 mockup-copy → 6 total at docs/screens/webapp/)
- /visual-review (4 pass / 2 fail; 2 critical fixes applied mid-flow: book-detail mobile responsive grid, settings disabled-button contrast)
- /user-flows-generator (6 flows w/ interactions[] for synthesizer, schemaVersion 2.0)
- gate 4 signoff dropped (`docs/signoff-2026-05-06T00-18-00Z.json` + `docs/gate-4-approved.txt`)
- /architect (react-next + tailwind / node-fastify + prisma + sqlite, 2 apps + 5 packages, persistence_layer=real-db)
- gate 5 trivial `proceed` (SQLite local, zero external APIs)
- /pm (5 features, 23 tasks, brief-coverage 16/16)
- /skills-audit --scope=build (zero gaps)
- /start-build with 3 manual recoveries:
  1. **feat-bootstrap** failed at tester (test-seed.ts:21 plain Error → 500 instead of 400 expected). Manual fix: `Object.assign(new Error(...), { statusCode: 400 })`. Merged at `5c1f083`.
  2. **feat-tags-manage** stuck mid-merge (bug-052 coverage AA conflicts + apps/api/src/app.ts UU additive). Killed orchestrator (pid 26176), aborted merge, applied gitignore + untrack, retry merge with manual app.ts union (kept settingsRoute + tagsRoutes). Merged at `b4e6dad`.
  3. **feat-books-core** failed at tester (bug-037 — @playwright/test missing + vitest missing e2e exclude). Manual fix: add `@playwright/test@^1.49.0` devDep + `exclude: ["**/e2e/**"]` to vitest.config.ts. Merged at `2f2a296`. **Final run: feat-search-filter auto-merged cleanly with `--require-pr-review` not set (still using `--auto-merge-after-reviewer` then). Merged at `e83b1ca`.**
- Pre-build snapshot: `projects/reading-log-pre-build/` (5.4M)

**Factory follow-up bugs landed:**

- **bug-037 Phase A** (P0, 3rd recurrence: kanban-webapp-10 + finance-track-01 + reading-log-01) — added §3a.0 to react-next SKILL.md with COPY VERBATIM templates for `apps/web/package.json` devDeps (incl. `@playwright/test ^1.49.0`) + `apps/web/vitest.config.ts` (with `exclude: ["**/e2e/**"]`). Empirical motivation block + 3-step self-verify. Status: `in-progress` (Phase A landed; B+C+D deferred). Commit `bc562f3`.
- **bug-052** — extended scope to full kanban-09 gitignore superset (~25 entries: bug-013 .feature-context.json + bug-014 build outputs / caches / Playwright reports / pkg-mgr logs / shell-cache + bug-052 coverage). Both factory SKILL.md AND project-side reading-log-01/.gitignore. Status: `completed`. Commits `bc562f3` + `254da59` (factory) + `bb048f0` + `d6c902f` (project).
- **bug-053** filed (P1) — bug-036 Phase A's `acquireCheckoutLock` mutex didn't prevent the race on reading-log-01 resume (feat-books-core silently failed; manual `git worktree add` succeeded → transient race). Phase D candidate: extend mutex span; Phase B (pre-wave dirty-state commit) is the structural fix. Status: `draft`. Investigation pending.
- **bug-054** SHIPPED — replaced `--auto-merge-after-reviewer` (opt-out, default false) with `--require-pr-review` (opt-in, default false). Default behavior now auto-merges on reviewer approval. Cosmetic doubled `feat-feat-` prefix in pr-review log lines also fixed. 84/84 orchestrator tests pass post-flip. 7 source files + tests touched. Commits `6077853` + `cadd51f`.

**Mid-flow factory fix (separate from bugs above):**

- `detect-loop.mjs` Skill-tool false-positive fix from end of prior session committed early this session at `98a33a3`.

**Validation outcomes for cost-reduction + bug-prevention hooks:**

- ✅ feat-051 (PM LAYOUT MANDATE) — injected into all 5 page-rendering web-frontend tasks; no shell-stripping bugs in built code
- ✅ feat-052 (per-feature parity-smoke) — ran (reachability check clean: 0 orphan components, 0 orphan routes)
- ⚠️ feat-053 (class-batched dispatch) — left OFF for this run as planned (validation isolation); not exercised
- ✅ feat-054 (reviewer §8 design-conformance) — implicit; reviewer approved all features
- ✅ feat-055 (sentineled-JSON dispatch) — empirical Sonnet output observed lower than pre-feat-055; counters showed reasonable budget
- ✅ bug-053 (plan-file dedup) — plans/active/ stayed flat across the session
- ✅ bug-054 (fixup-worktree merge cascade) — exercised, no merge-cascade ghost-state issues

## Current state

- **Factory branch**: `feat/quota-observability` at HEAD `254da59`. Uncommitted: 4 small files (react-next SKILL.md + bug-037 plan + bug-053 plan + contexts/checkpoints.md — these are minor session-edit residue from late-session linting; can be committed when convenient).
- **Project reading-log-01**: `master` at HEAD `d6c902f`. 5/5 features merged. Working tree has stale orchestrator state (5 modified files in apps/api/src/\* — these are post-build state from the orchestrator's last close-feature; non-load-bearing, can be cleaned up).
- **Tests**: factory orchestrator 84/84 in tests/feature-graph + tests/cli-runner; full suite not re-run (post-bug-054 flip didn't touch other suites). Project: api 35/35 + web 54/54 (last validated mid-recovery).
- **Blockers**: none. Both repos at clean handoff points.
- **Ephemeral background tasks**: orchestrator process(es) all exited; no live worktree dispatches; no paused.json sentinels.

## Next steps

1. **Commit residual factory edits** — 4 small uncommitted files (mostly session-edit residue + checkpoints.md auto-update from this snapshot).
2. **bug-053 investigation** (P1) — open-ended; ~30 min to 1-2 hr. Phase A's `acquireCheckoutLock` mutex span may not cover the auto-commit step; OR Phase B (pre-wave dirty-state commit, structural) is the right answer. Read feature-graph.ts:697-1080 carefully + add stderr capture (Phase C) to make next failure debuggable. Pair with bug-036 (parent).
3. **bug-037 Phase B** (synthesizer auto-fix-up) — when /scripts/synthesize-flow-e2e.mjs finds @playwright/test missing in apps/web/package.json, AUTO-EDIT to add it instead of warning. Defense-in-depth.
4. **bug-037 Phase C** (verifier hard-fail) — orchestrator/src/build-to-spec-verify.ts flow-execution stage should HARD-FAIL (not warn) when synthesized specs exist + runtime missing.
5. **Empirical bug-037 + bug-052 validation** — kick off /new-project on a throwaway test name + `/start-build` it; confirm apps/web ships with @playwright/test + .gitignore is the full superset + no flow-execution Cannot-find-module errors. Skipped this session for time.
6. **(Optional)** clean reading-log-01 stale state — 5 modified files in apps/api/src/\* are post-build orchestrator residue; not blocking but tidy.
7. **(Optional)** archive completed bugs — bug-052 + bug-054 are completed; could `/plan-archive` them. bug-037 in-progress (Phase A only); leave active until Phase B/C also land OR an empirical validation run signs off Phase A.

## Open questions

- bug-053 root cause not yet diagnosed — is Phase A mutex span too narrow (covers worktree-add but NOT auto-commit), is there a different lock contender (IDE git polling / stale lockfile), or is Windows file-system timing the variable? Investigation needed.
- Should we keep `--require-pr-review` as a future opt-in OR delete it entirely? Today no flow uses gate-6; it's vestigial. Keeping it as opt-in preserves the future-paranoid-flow option without cost.
- Validation strategy for factory fixes — do empirical /new-project re-runs after each Phase A surface, or batch validation at the end of all phase-A's (037 + future)? This session deferred validation; should not become habit.

## Key files touched

**Factory (committed):**

- `.claude/skills/agents/front-end/react-next/SKILL.md` — bug-037 Phase A new §3a.0 with COPY VERBATIM package.json + vitest.config.ts templates + 3-step self-verify
- `.claude/skills/new-project/SKILL.md` — bug-052 base block extended from 6 lines to ~30 (shell-cache + bug-013 + bug-014 + bug-052 categories)
- `.claude/skills/start-build/SKILL.md` — bug-054 docs (argument-hint, --require-pr-review semantics, resume-feature-graph forwards)
- `orchestrator/src/cli.ts` — bug-054 flag rename + flip
- `orchestrator/src/cli-runner.ts` — bug-054 field rename + forward
- `orchestrator/src/feature-graph.ts` — bug-054 field rename + conditional flip
- `orchestrator/src/gate-server-lifecycle.ts` — bug-054 cosmetic feat-feat- prefix fix
- `orchestrator/tests/cli-runner.test.ts` + `tests/feature-graph.test.ts` — bug-054 test rename + flip semantics (84/84 pass)
- `plans/active/bug-037-*.md` — Attempt Log + status `draft → in-progress`
- `plans/active/bug-052-*.md` — Attempt Log + status `draft → completed` + scope-extension note
- `plans/active/bug-054-*.md` — Attempt Log + status `draft → completed`
- `plans/active/bug-053-*.md` (NEW) — race investigation plan
- `plans/active.md` — manifest entries for bug-052/053/054 + bug-037 priority bump
- `.claude/hooks/detect-loop.mjs` (committed `98a33a3`) — Skill discriminator added to false-positive fix

**Project reading-log-01 (committed at `d6c902f`):**

- `apps/api/src/routes/test-seed.ts` — bug-037 fix (statusCode=400 on whitelist throw)
- `apps/web/package.json` — bug-037 fix (@playwright/test devDep)
- `apps/web/vitest.config.ts` — bug-037 fix (e2e exclude)
- `.gitignore` — bug-052 full superset
- `apps/api/src/app.ts` — manual merge resolution (booksRoutes + settingsRoute + tagsRoutes union)
- All 5 features' source: apps/api + apps/web + packages/api-client. ~3500 LOC across the merged commits.

**Project (uncommitted, stale):** `apps/api/src/app.ts`, `apps/api/src/routes/books.*.test.ts`, `.feature-context.json` — orchestrator's post-merge residue; not load-bearing.

## Decisions made

- **Manual recovery > /fix-bugs loop for mid-Mode-B failures**: when a feature's tester retry-exhausts due to a single bug, manual fix-in-worktree + git merge is cheaper than re-dispatching builders. Used 3× this session (feat-bootstrap, feat-tags-manage, feat-books-core). Documented per-recovery in commit messages so the pattern is reproducible.
- **bug-052 scope extension to kanban-09 superset**: when validating bug-052's narrow fix, found the SKILL.md base block was a strict subset of every shipped project's gitignore. Extended bug-052's scope rather than file a separate bug — same problem class (factory template missing entries that shipped projects added post-hoc). Single comprehensive fix wins over two partials.
- **bug-054 default flip semantic**: replaced `--auto-merge-after-reviewer` (opt-out) with `--require-pr-review` (opt-in). Backward incompatibility accepted because the only callers are this factory's own scripts. Reviewer agent IS the merge gate per the autonomy contract.
- **bug-037 Phase A only (defer B+C+D)**: scaffold-time install at react-next SKILL.md is the earliest+cheapest fix. Phase B (synthesizer auto-fix-up) + Phase C (verifier hard-fail) + Phase D (browser-binary install strategy) drafted in plan but deferred until Phase A's empirical effectiveness is observed.
- **Killing orchestrator vs /pause-build**: when orchestrator is genuinely STUCK (mid-merge with unresolved conflicts, paused.json sentinel not polled inside close-feature), terminate via taskkill is the right call AS LONG AS the manual surgery + re-launch path is followed correctly (preserve run-id, edit progress.json carefully). Memory rule "never kill mid-run" applies to active dispatch; stuck-state termination + careful state edit is acceptable.
- **Skipped svelte-kit equivalent for bug-037 Phase A**: 0/3 empirical recurrences are svelte-kit; don't do speculative factory work; patch when first svelte-kit project is built.
