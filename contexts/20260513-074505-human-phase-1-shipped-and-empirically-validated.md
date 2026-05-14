---
session-id: "20260513-074505"
timestamp: 2026-05-13T07:45:05Z
agent: human
task-id: feat-066-fix-loop-effectiveness-v2
previous-context: 20260512-205712-human-v2-near-shippable-rest-checkpoint.md
checkpoint: true
status: in-progress
---

# Context snapshot — human — Phase 1 of feat-066 v2 epic shipped + empirically validated

## Summary

~12 hour session shipped the FULL Phase 1 stack of feat-066 v2 epic: bug-091 (protected-files guard) + bug-089 (auto-merge robustness) + bug-090 (verify worktree on fix/bugs-yaml-iter) + bug-092 (mergeFirst on partial success). All four commits include unit tests, integration tests against real git repos, and zero-out of pre-existing test rot (37 timeout failures cleared across build-to-spec-verify / cli-runner / run-synthesized-flows tests). Suite passes 933/933 across 39 test files.

Empirical re-run #1 against reading-log-02 (cost: $2.83) validated bug-089 (silent success — master advanced cleanly from manual-merge state `7636c80` to fix-loop-auto-merged state `b853489`) + bug-090 (verify worktree alive at `f553395` detached HEAD per the dispatch-time inspection) + bug-092 (master advanced despite the loop ending with 5 failed bugs in addition to 1 resolved). bug-091's guard wasn't exercised (no agent attempted protected-file deletion).

The empirical run surfaced 3 follow-up issues now filed as bug-093 (bug-082 source-change-gaming — agent committed unrelated test-repair changes to satisfy the unverified-completion guard while ENABLE_TEST_SEED=0 fix was never made), bug-094 (delete-fires-multiple-times — 6× DELETE per single click in reading-log-02's UI, canonical motivator for feat-069), and an updated feat-069 plan (AI walkthrough Tier 5) extended with Phases A-H ready for Phase 2 implementation in a fresh session.

Test policy added to CLAUDE.md (NON-NEGOTIABLE): no test rot. Default fix is the test, not the production code — production changes require evidence-of-bug, never chase tests by modifying implementation.

## Completed since last snapshot

- **bug-091 (commit `12aa669`)** — protected-files guard. New `orchestrator/src/protected-files.ts` module with `PROTECTED_FILES`, `PROTECTED_PACKAGES_FILES`, `PROTECTED_CONTENT_INVARIANTS`, baseline-relative `verifyProtectedFiles(projectRoot, baselineRoot?)`. Wired into `runFixBugsLoop` after per-bug dispatch — on violation, marks attempt failed + skips merge cascade + threads violation into bug.errorLog for retry context. System-prompt §Protected files blocks in bug-fixer.md + systemic-fixer.md. Canonical rules doc at `.claude/rules/protected-files-policy.md`. 19 unit tests + 3 fix-bugs-loop integration tests. Also bundled the test rot zero-out (37 timeouts cleared).
- **CLAUDE.md test policy** — NON-NEGOTIABLE no-test-rot policy. Default-fix-test-not-production caveat per user concern about chasing tests blindly.
- **Production-code seams (additive, optional)** — `BuildToSpecVerifyContext.bootDevServer?` (test stub for the dev-server pre-boot), `CliOptions.skipBuildToSpecVerify?` (cli-runner test bypass), `BuildToSpecVerifyContext.bugFilingProjectDir?` (bug-090's split-read/write seam).
- **bug-089 (commit `e096be7`)** — auto-merge robustness. `FixBugsLoopResult.status` gains `auto-merge-failed` variant. `closeFixupWorktree` returns `mergeOutcome` ("merged" | "skipped-no-merge" | "recovered" | "blocked") + optional blockers list. Loud multi-line stderr banner with stash-or-restore remediation. Phase B whitelist auto-recovery (`AUTO_MERGE_SAFE_RESET_PATTERNS`: synthesized E2E specs / `.claude/models.yaml` / prisma DB files / .env). `parseMergeBlockers(stderr)` reads git's "would be overwritten by merge:" block (more precise than git status --porcelain). 3 fix-bugs-loop integration tests.
- **bug-090 (commit `aef062b`)** — verifier reads from dedicated verify worktree. New `orchestrator/src/verify-worktree.ts` with `ensureVerifyWorktree` (created / already-fresh / fast-forwarded / recreated outcomes) + `teardownVerifyWorktree`. **Detached HEAD** at `fix/bugs-yaml-iter`'s sha (mandatory — fixup worktree may also have that branch checked out + git refuses two worktrees on same branch). Wired into the runFixBugsLoop's verify dispatch (projectDir → verify worktree cwd for source reads; bugFilingProjectDir → operator-facing projectRoot for bug-plan writes). teardownVerifyWorktree fires BEFORE closeFixupWorktree (otherwise `git branch -D` would fail). 7 unit tests.
- **bug-092 (commit `e8f000d`)** — mergeFirst on partial success. The previous `mergeFirst: status === "clean"` was too narrow. New gate: `mergeFirst: doc.bugs.some(b => b.status === "completed")`. Surfaced via empirical re-run #1 where the systemic-fixer's css-pipeline fix landed on fix/bugs-yaml-iter but never reached master (status flipped to "all-bugs-failed" because the seed-contract-broken bug failed). 2 fix-bugs-loop tests.
- **Test rot zero-out** — 37 pre-existing timeout failures cleared: 29 in build-to-spec-verify.test.ts (via `BENIGN_NO_DEV_SERVER` / `BENIGN_NO_PARITY_OR_PERCEPTUAL` / `BENIGN_NO_FLOWS_OR_PERCEPTUAL` helper constants + `stubBootDevServer`), 5 in cli-runner.test.ts (via `CliOptions.skipBuildToSpecVerify?`), 3 in run-synthesized-flows.test.ts (one was a real semantic drift requiring assertion update per bug-052's evolution, two were stuck on `baseUrlOverride`'s hardcoded 10s wait).
- **Empirical re-run #1** ($2.83, ~30min wall-clock) — dispatched 2 pre-verify systemic bugs. tooling-config-mismatch resolved (systemic-fixer committed `9c5c3a3 fix(tooling): add missing postcss.config.mjs and remove output:export from next.config.ts`). tooling-test-seed-contract-broken FAILED (rate-limit stall on dispatch). Master initially stayed at `f1c2930` because pre-bug-092 gate said "any failure = no merge". Manual merge `git merge --no-ff fix/bugs-yaml-iter` to `7636c80` recovered the stranded fix.
- **Empirical re-run #2** ($2.83 again, ~30min wall-clock) — after bug-092 shipped + seed-contract bug reset to pending. systemic-fixer landed a NEW fix on top: `f553395 fix(css-pipeline): add missing @tailwind directives to globals.css`. Auto-merge fired → master advanced to `b853489`. The verify worktree was visible at `f553395 (detached HEAD)` mid-run — concrete proof bug-090 works.
- **Site inspection** — reading-log-02 spun up post-validation. After re-running prisma migrate + db:seed (DB had been wiped at some point), site rendered cleanly with Tailwind styling. User-witnessed bug-094 (6× DELETE per click) → filed.
- **bug-093 + bug-094 + extended feat-069 plan** filed (this session).
- **Suite final state**: 933/933 across 39 test files. +29 net new tests across the four Phase 1 commits.

## Current state

- **Branch:** `feat/vision-llm-perceptual-review` — 19 commits ahead of factory master, not yet pushed to origin
- **HEAD:** `e8f000d` (bug-092)
- **Project state (reading-log-02):** master at `b853489`. bugs.yaml: 71 total bugs, ~60 completed, 4 op-review, 4 failed (the long-standing perceptual edge cases that have failed across runs — bug-perceptual-book-detail-built-version-renders-book-not / settings-bottom-left-overlay / tags-manage-nav-item-book-count-badges-abs / books-list-duplicate-book-entry-visible-i). seed-contract-broken's status is currently "resolved" but **the actual fix didn't land** (ENABLE_TEST_SEED=0 still on master) — bug-093 follow-up surfaces this.
- **Suite:** 933/933 passing across 39 test files. Coverage stable.
- **Uncommitted state:** the operator's pre-existing WIP from prior sessions still stashed in reading-log-02 (`stash@{0}: bug-092-empirical-prep — operator WIP set aside before manual merge of fix/bugs-yaml-iter`). The current factory-side tree has the typical CRLF/LF phantom-mod noise on ~50 files but `git diff -w --stat` is clean except for `contexts/checkpoints.md` (1 line) + `plans/active/bug-088-*.md` (2 lines).
- **Blockers:** none for next session — Phase 1 is shipped; Phase 2 work has 3 candidates (bug-093 / bug-094 / feat-069) ready to start.

## Next steps

1. **bug-093 (P0)** — ship the `diffOverlapsBugScope` tightening of bug-082's unverified-completion guard. Phase A (path-overlap check via affectsFiles) + Phase D (2 tests). ~1hr. Plan: `plans/active/bug-093-bug-082-source-change-gaming.md`.
2. **bug-094 (P1)** — investigate root cause (StrictMode vs. fetcher-subscription multiplication vs. data-kit-\* layer). Probably 1-3hr including the fix + react-next stack-skill update if it's a design-gap. Plan: `plans/active/bug-094-delete-fires-multiple-times.md`. Note: feat-069 is the structural fix for this class; bug-094 is the immediate one.
3. **feat-069 — AI walkthrough Tier 5 (multi-day)** — Phases A-H now drafted. Start with Phase A (contracts + agent skeleton). Plan: `plans/active/feat-069-ai-walkthrough.md`.
4. **Optional cleanup** — pop the reading-log-02 stash@{0} when the operator's WIP is reviewed; teardown the many orphan per-bug worktrees in reading-log-02 (`.claude/worktrees/bug-*` — bug-061 handles this on next /fix-bugs invocation but a `git worktree prune` would also clean it now).
5. **Push the branch** — `feat/vision-llm-perceptual-review` is 19 commits ahead. When confident, push to origin.

## Open questions

- **bug-093 Phase B (extend to allow related paths)** — does Phase A alone (direct path-overlap with affectsFiles) catch enough cases? Empirical: would only fail if a legitimate fix touches something OUTSIDE affectsFiles (e.g. shared type changes). Recommend ship Phase A first + observe.
- **bug-094 root cause** — Hypothesis 2 (multi-subscriber fetcher pattern) is strongly indicated by the parallel-port empirical signal but needs verification. If confirmed AND the pattern is in the react-next stack skill scaffold, it auto-propagates to every future project.
- **feat-069 Phase A model choice** — `walkthrough-reviewer` agent at tier `building` (Sonnet 4.6 default) vs. `design` (cheaper). The original 2026-05-08 plan estimated $0.05-0.10 per walkthrough at Sonnet pricing; viable for the loop's spend budget.
- **feat-069 Phase B walkthrough script complexity** — implementing the full route-map sweep + per-flow empty-state trigger + generic interaction sweep is non-trivial (~3-4hr alone). Worth bisecting: start with route-sweep + screenshot-only (catches static issues), add interaction sweep + network capture (catches bug-094 class) as Phase B.1 / B.2.
- **bug-082-gaming + the long-standing 4 failed perceptual bugs** — both are pre-existing concerns that bug-093 + feat-069 should reduce empirically but won't eliminate. The 4 failed bugs may need operator-review routing (per bug-087's category-aware default agent sequence pattern).

## Key files touched

### Phase 1 commits' surfaces

- `orchestrator/src/protected-files.ts` (NEW, bug-091) — manifest + `verifyProtectedFiles(projectRoot, baselineRoot?)`. Baseline-relative semantics so off-canonical projects (mobile-only / backend-only) don't trip.
- `orchestrator/src/verify-worktree.ts` (NEW, bug-090) — `ensureVerifyWorktree` + `teardownVerifyWorktree`. Detached-HEAD design is load-bearing (concurrent fixup worktree).
- `orchestrator/src/fix-bugs-loop.ts` — three major changes: (a) bug-091 guard call between dispatch + closePerBugWorktree, (b) bug-089 robust closeFixupWorktree rewrite + `tryWhitelistRecovery` + `parseMergeBlockers`, (c) bug-090 ensureVerifyWorktree + teardownVerifyWorktree wired around verify dispatch + close-out, (d) bug-092 mergeFirst gate change.
- `orchestrator/src/build-to-spec-verify.ts` — bootDevServer? seam (test stubbing) + bugFilingProjectDir? seam (bug-090's read/write split).
- `orchestrator/src/cli-runner.ts` — `skipBuildToSpecVerify?` CliOptions field threaded through to feature-graph.
- `.claude/agents/bug-fixer.md` + `.claude/agents/systemic-fixer.md` — §Protected files system-prompt blocks (bug-091).
- `.claude/rules/protected-files-policy.md` (NEW) — canonical bug-091 rules doc.
- `CLAUDE.md` — NON-NEGOTIABLE Test Policy section (no test rot + bias-to-fix-test-not-production).

### Test surfaces (+29 net new tests)

- `orchestrator/tests/protected-files.test.ts` (NEW) — 19 unit tests for bug-091's verifier.
- `orchestrator/tests/verify-worktree.test.ts` (NEW) — 7 unit tests for bug-090's worktree lifecycle.
- `orchestrator/tests/fix-bugs-loop.test.ts` — +8 integration tests across bug-089 (3) + bug-091 (3) + bug-092 (2).
- `orchestrator/tests/build-to-spec-verify.test.ts` — 29 patches via the BENIGN\_\* helpers.
- `orchestrator/tests/cli-runner.test.ts` — 5 patches via skipBuildToSpecVerify.
- `orchestrator/tests/run-synthesized-flows.test.ts` — 3 fixes (1 semantic drift via bug-052 evolution, 2 baseUrlOverride hardcoded-10s issue).

### Plan files created/updated

- `plans/active/bug-091-protected-files-guard.md` (NEW + approved)
- `plans/active/bug-089-fix-loop-auto-merge-silent-fail.md` (status: draft → approved)
- `plans/active/bug-090-verify-freshness-dedicated-worktree.md` (NEW status: draft → approved)
- `plans/active/bug-092-merge-first-too-restrictive-on-partial-success.md` (NEW + approved)
- `plans/active/bug-093-bug-082-source-change-gaming.md` (NEW, draft — needs approval before shipping)
- `plans/active/bug-094-delete-fires-multiple-times.md` (NEW, draft)
- `plans/active/feat-069-ai-walkthrough.md` (extended with Phases A-H; status: draft → approved)

### Project-side recovery (reading-log-02)

- master advanced from `f1c2930` → `7636c80` (manual merge mid-session) → `b853489` (auto-merge in empirical re-run #2)
- `apps/api/prisma/data/reading-log.db` re-created via `prisma migrate deploy` + `db:seed` (was missing pre-session)
- Stash `stash@{0}` holds operator WIP set aside before the manual merge

## Decisions made

- **bug-091's baseline-relative semantics** — initial implementation checked absolute presence; refined to flag only REGRESSIONS vs. the per-bug branch's base (the fixup worktree). Off-canonical projects (mobile-only) don't false-positive. The `tierRootPresent` map handles `apps/web` + `apps/api` gates. Hard-coded in v1; can promote to JSON manifest later.
- **bug-089's stderr-parsing approach** — initially attempted `git status --porcelain` to identify blockers, found Windows showing directories (`apps/`, `docs/`) instead of files. Switched to parsing git's own "would be overwritten by merge:" stderr block. More precise, more reliable.
- **bug-090's detached HEAD** — load-bearing. The fixup worktree has fix/bugs-yaml-iter checked out in production; git refuses two worktrees on same branch. Detached HEAD with `reset --hard <sha>` to advance is the only viable shape.
- **bug-092's gate via `doc.bugs.some(b => completed)`** — not `status === "clean"`. Decision: a single resolved bug = "we made progress, ship it." Empty/no-progress runs still skip merge.
- **Test policy bias-toward-fixing-test, not production** — per user's explicit feedback. Production-code changes require evidence-of-bug; chasing tests by modifying production can break working features.
- **Empirical re-run #1 + manual merge** — bug-092 surfaced AFTER bug-089/090/091 already shipped. The previous gate was wrong; new bug filed + shipped same session. The manual merge to recover stranded fixes simulates what bug-092 should do automatically; re-run #2 confirmed it does.
- **Phase 1 shipped without bug-091 empirical fire** — the protected-files guard's preconditions (agent attempts to DELETE a load-bearing file) didn't come up in the empirical run. The systemic-fixer correctly ADDED files (postcss.config.mjs, @tailwind directives) — bug-077-class fixes. The guard isn't validated end-to-end yet, but it doesn't BLOCK anything. Unit tests (19) prove the mechanics; live validation will come when a future dispatch actually tries to delete.
- **feat-069 Phase A-H structure** — extended the existing 2026-05-08 draft (which had high-level approach) with shippable phases. bug-094 named as canonical empirical motivator. round-state integration is already wired (feat-073 set `enabledTiers: ALL_TIERS` for round 4) — no round-state code changes needed.
- **Operator-side stash + worktree orphans** — explicitly NOT cleaned up. Operator's WIP is theirs to review; orphan worktrees self-heal on next /fix-bugs invocation per bug-061's teardown-recreate.
- **CRLF/LF phantom mods on the factory** — explicitly NOT addressed. Git autocrlf + Windows leaves ~50 files marked as modified that have zero actual diff (`git diff -w --stat` confirms). Touching them would create churn for zero value. Left for a future cross-cutting normalization pass.
