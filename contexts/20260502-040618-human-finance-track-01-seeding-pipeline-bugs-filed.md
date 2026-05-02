---
session-id: "20260502-040618"
timestamp: 2026-05-02T04:06:18Z
agent: human
task-id: null
previous-context: 20260502-030814-human-finance-track-01-mode-b-validated.md
checkpoint: true
status: checkpoint
---

# Context snapshot — human — finance-track-01: seeding-pipeline failure chain diagnosed + 3 P0 bugs filed; fix-loop killed

## Summary

Picked up from prior checkpoint (20260502-030814) where finance-track-01 had reached 17/17 features merged + 7 fix-loop-resolved bugs at $62.46. This session shipped 3 more factory bug-A phases (bug-037 Playwright auto-install, bug-038 stack-aware port resolution, bug-039 nullable flow-failure screen-ids) + completed investigate-014 (fix-loop parallelism + worktree cleanup). Then user inspected the verifier's flow test screenshots and discovered ALL 9 synthesized E2E flows landed on EMPTY UI states ("No accounts yet"). Investigation traced a 5-link seeding-pipeline failure chain — filed 3 P0 factory bugs (bug-040 architect-skips-scripts-dev-mjs, bug-041 playwright-config-missing-webserver, bug-042 global-setup-baseline-only-fx-cache). Killed the in-flight fix-loop because all 16 bugs in iteration 1 were FALSE positives — symptoms of empty UI states caused by no seed data, not real code bugs. ~$30+ quota saved by stopping early.

## Completed since last snapshot

- **bug-037 Phase A SHIPPED** (`90481cc`): synthesizer auto-adds @playwright/test to apps/web/package.json devDependencies when authoring specs. +2 regression tests. 592/592 orchestrator tests pass.
- **bug-038 Phase A SHIPPED** (`407b37b`): `resolveBackendPort` now reads `.env.local` (bug-033 canonical) + `architecture.yaml.tooling.stack.backend_framework` for stack-default port. New 6-tier precedence chain (env.PORT > env.BACKEND_PORT > .env.local > .env > stack-default > 8000-legacy). +15 regression tests covering each tier. 607/607 tests pass.
- **bug-039 Phase A SHIPPED** (`e9cb267`): FlowFailure schema's `fromScreenId` + `expectedScreenId` nullable; runner emits null (not "") when meta missing; consumers null-safe. +3 regression tests. Was the smoking-gun for the verifier's "0 passed, 0 failed" silent-failure mode.
- **investigate-014 COMPLETED** in 25 min of 60-min time-box. H1 (parallelism feasible via per-bug worktrees + bug-034 resolver) + H2 (worktree-remove failing on Windows file-lock; needs retry-with-backoff) confirmed. Disk inventory: 1.2GB per project (less than 10GB hypothesis). Recommendation: ship feat-046 + feat-047 paired, but DEFER behind higher-leverage work.
- **feat-046 + feat-047 FILED** as P2 draft follow-ups to investigate-014 (`1b71121`). Per-bug worktree parallelism + worktree auto-prune. Pair-ship recommended.
- **Manually installed @playwright/test + chromium binary** in `projects/finance-track-01/apps/web/` to enable verifier rerun.
- **Re-triggered verifier** with bug-037+038+039 fixes in place. Result: 16 bugs filed in fresh bugs.yaml (9 flow failures + 7 reachability/parity items). Fix-loop started iteration 1 sequentially.
- **USER AUDIT of test screenshots**: discovered ALL 9 flow failures landed on empty "No accounts yet" UI state. Root cause: data was never seeded.
- **5-link seeding-pipeline failure chain DIAGNOSED**:
  1. `projects/finance-track-01/scripts/dev.mjs` does NOT exist (architect skipped SKILL.md §7c)
  2. `apps/web/playwright.config.ts` has 0 `webServer` blocks (web-frontend-builder skipped react-next SKILL.md §3a)
  3. global-setup.ts seeds ONLY `fx_cache` (11 entries) — NO accounts/transactions
  4. Verifier's `dev-server.ts` auto-boot uses FastAPI-flavored `uv run uvicorn` even for node-fastify (covered indirectly by bug-038 Phase B)
  5. Verifier flow-execution doesn't distinguish "seed-missing" from "ui-bug" failures (covered by bug-042 Phase D)
- **Killed in-flight fix-loop** (bg task `b0cclg42o` + 8 child node procs) — was burning quota fixing FALSE positives.
- **bug-040 + bug-041 + bug-042 FILED** as P0 draft (`8dd14f9`). All 3 cover the seeding-pipeline failure chain at the right intervention points (architect compliance / web-frontend-builder compliance / synthesizer-time inference + global-setup template).

## Current state

- Branch: `feat/quota-observability` (`8dd14f9`)
- Tests: orchestrator 607/607 passing; orchestrator-contracts 408/408 passing (was 580 + 388 at session start; +27 + +20 across bug-035/036/034/037/038/039 regressions)
- Uncommitted: 2 — leftover `scripts/_tmp-render-viewer.mjs` + `scripts/_tmp-validate-manifest.mjs` (sandbox-blocked rm; harmless, ignored)
- finance-track-01 project state: 17/17 features merged at `8ca2ef9`; fix-loop iteration 1 was in-flight + KILLED with 16 unfixed bugs in bugs.yaml; orchestrator processes terminated; project is in "verified-but-broken" state — synthesized E2E shows real seeding failure
- Total Session 2 spend on this dev work + verifier reruns: ~$80-90 (rough — was $62.46 at prior checkpoint; the bug-fixes shipped + verifier reruns added meaningful but unmetered cost)
- Quota: 7-day bucket at ~82% (creeping up slowly); 7-day reset 2026-05-04T07:00 (~50h)
- Blockers: finance-track-01 project recovery requires manual scripts/dev.mjs + playwright webServer + global-setup expansion before verifier rerun can produce real bugs (not seeding-symptoms)

## Next steps

1. **Manual project-side recovery for finance-track-01** (pre-shipping factory fixes):
   - Step A (~5 min): `cp .claude/templates/dev-multi-tier.mjs.template projects/finance-track-01/scripts/dev.mjs`
   - Step B (~5 min): manually patch `apps/web/playwright.config.ts` to add the `webServer` block per react-next SKILL.md §3a (`command: "node ../../scripts/dev.mjs"`, `url: "http://localhost:3000"`)
   - Step C (~30 min): expand `apps/web/playwright/global-setup.ts` to seed accounts (3-5 across currencies) + transactions (50-100 across categories/months) + settings (display_currency=EUR) beyond the existing fx_cache baseline
2. **Re-run verifier** — flows now actually exercise populated UI states; failures that surface are REAL UI bugs (not seeding symptoms). Use `--bugs-yaml-mode=fresh` (default) to archive the prior 16 false-positive bugs.
3. **Fix-loop runs against REAL bugs** — much smaller surface; should converge in 1-3 iterations.
4. **Then archive bug-001 (project) as resolved-by-bug-035** — already auto-fixed during the prior fix-loop iteration that succeeded; just hasn't been formally archived.
5. **Then ship factory Phase B/C/D for the seeding-pipeline bugs** in subsequent sessions:
   - bug-040 Phase B: architect agent self-verify enforcement
   - bug-041 Phase A: synthesizer hard-error on missing webServer
   - bug-042 Phase A: synthesizer-time inference of required-baseline.json
   - These prevent the chain recurring on future projects (book-swap, etc).

## Open questions

- **Should I file a bug for orchestrator's `dev-server.ts spawnBackendDevServer` using FastAPI-flavored `uv run uvicorn` even for node-fastify backends?** Currently captured as a Phase concern in bug-038 + bug-040 cross-references; might need its own bug entry. Sister to bug-038's port resolution work — could fold into bug-038 Phase B as "stack-aware spawn command."
- **Is the global-setup builder responsible to the user-flows-manifest's read-only flow assertions, or to architecture.yaml's data-models.yaml entities?** bug-042 Phase A proposes the synthesizer infers from flow assertions. Open question whether stack-skill SKILL.md should also have a manual "must seed these tables" section per backend type.
- **finance-track-01's bugs.yaml has 16 FALSE positives still** — should they be archived (to docs/bugs-archive/) or hand-edited to drop the seeding-symptom ones + keep any genuine reachability/parity items? Cleanest: archive entirely, let the verifier refile from scratch post-recovery.
- **Should the operator-side workaround for finance-track-01 be its own project plan** (`bug-002` style for transactions-crud)? Probably yes — would document the manual recovery recipe + close the loop on the project's bug-001 properly.
- **Quota check before next big run** — at 82% with ~50h to reset, do steps 2+3 (verifier rerun + fix-loop) fit? Probably yes per Max 20× headroom but worth `/quota-status --all` pre-flight.

## Key files touched

### Factory (committed this session)

- `orchestrator/src/invoke-agent.ts` (bug-035, prior session)
- `orchestrator/src/feature-graph.ts` (bug-036 + bug-034, prior session)
- `orchestrator/src/model-config.ts` (reviewer 900s timeout, prior session)
- `scripts/synthesize-flow-e2e.mjs` — bug-037 Phase A: auto-add @playwright/test to apps/web/package.json
- `orchestrator/tests/synthesize-flow-e2e.test.ts` — +2 bug-037 regression tests
- `orchestrator/src/dev-server.ts` — bug-038 Phase A: 6-tier `resolveBackendPort` + new error message; STACK_DEFAULT_BACKEND_PORT table
- `orchestrator/tests/dev-server.test.ts` — NEW; 15 bug-038 regression tests
- `packages/orchestrator-contracts/src/build-to-spec-verify.ts` — bug-039: FlowFailure.fromScreenId + expectedScreenId nullable
- `packages/orchestrator-contracts/src/bugs-yaml.ts` — bug-039: BugFlowContextSchema.expectedScreenId nullable
- `packages/orchestrator-contracts/tests/build-to-spec-verify.test.ts` — +2 bug-039 regression tests
- `packages/orchestrator-contracts/tests/bugs-yaml.test.ts` — +1 bug-039 regression test
- `orchestrator/src/build-to-spec-verify.ts` — bug-039: correlateFlowFailureToOrphan handles null expectedScreenId
- `orchestrator/src/fix-bugs-loop.ts` — bug-039: bug-summary render handles null expectedScreenId
- `scripts/run-synthesized-flows.mjs` — bug-039: emit null (not "") when meta missing

### Plans (committed this session)

- `plans/active/bug-037-playwright-runtime-not-auto-installed-for-synthesized-e2e.md` (NEW, prior session)
- `plans/active/bug-038-parity-verify-backend-port-defaults-to-fastapi-8000.md` (NEW, prior session)
- `plans/active/bug-039-verifier-schema-rejects-empty-flow-failure-screen-ids.md` (NEW, this session — Phase A shipped)
- `plans/active/investigate-014-fix-bugs-loop-parallelism-and-worktree-lifecycle.md` (NEW, prior session — completed this session)
- `plans/active/feat-046-fix-bugs-loop-per-bug-parallelism.md` (NEW, this session — P2 draft)
- `plans/active/feat-047-worktree-auto-prune-on-close-feature.md` (NEW, this session — P2 draft)
- `plans/active/bug-040-architect-skips-scripts-dev-mjs-emission-step.md` (NEW, this session — P0 draft)
- `plans/active/bug-041-playwright-config-missing-webserver-block.md` (NEW, this session — P0 draft)
- `plans/active/bug-042-global-setup-baseline-only-seeds-fx-cache.md` (NEW, this session — P0 draft)
- `plans/active.md` — manifest entries for all of the above

### Project finance-track-01 (uncommitted to project's git)

- `apps/web/package.json` — @playwright/test added via manual `pnpm add` (~~bug-037 Phase A retroactive fix~~ — actually we ran it manually since the synthesizer fix only applies to FUTURE runs)
- `apps/web/node_modules/@playwright/test/` — installed
- `~/AppData/Local/ms-playwright/chromium-1217/` — browser binary
- `docs/bugs.yaml` — 16 false-positive bugs from killed iteration 1 (should be archived before next run)

### Session-internal state (orchestrator state files)

- `projects/finance-track-01/.claude/state/2276b8a1-1e71-4ec4-ad4c-e0f63f1024b1/feature-graph-progress.json` — 17 completed
- `projects/finance-track-01/docs/bugs-archive/bugs-2026-05-02T03-25-30-039Z-iter-2.yaml` — archived from prior fix-loop run that fixed the 7 orphan-component bugs
- `projects/finance-track-01/apps/web/test-results/` — 9 flow-failure dirs with error-context.md + test-failed-1.png

## Decisions made

- **Killed the in-flight fix-loop rather than letting it run to completion** — saved ~$30+ of quota that would have been spent fixing FALSE positives. The 16 bugs in iteration 1 were all symptoms of the seeding-pipeline gap, not real code bugs. Empirical learning: when verifier results don't make sense (every flow on same empty page), DEBUG THE INFRASTRUCTURE before letting the fix-loop assume real product bugs.
- **Filed 3 P0 bugs as separate plans rather than one umbrella** (bug-040/041/042) — each addresses a distinct factory surface (architect / web-frontend-builder / global-setup template). Easier to ship + track + assign retry budgets independently.
- **Nullable schema fields (bug-039) over hard-error+gate fix** — chose to relax `min(1)` constraint rather than fix the synthesizer to embed the screen-id markers. Cheaper to ship; the diagnostic richness loss is acknowledged in Phase B (synthesizer metadata embedding) deferred plan. Empty-string still rejected — preserves the "we don't know" vs "we got bad data" distinction.
- **Stack-aware backend port resolution (bug-038) ships with 6 precedence tiers** — chose to extend rather than replace the legacy 8000 fallback. Backward compat for existing python-fastapi projects + correct stack-shape for node-\* projects + operator escape hatches at top of chain.
- **investigate-014 recommendation: pair feat-046 + feat-047 but DEFER both** — even though parallelism would be nice, current 50min sequential cost isn't blocking + bug-040/041/042 are higher leverage (they unblock all future projects' E2E coverage). Prioritize blockers over optimizers.
- **Manual project-side recovery for finance-track-01 first** before shipping the factory Phase B/C/D fixes — gets THIS project actually finished + provides empirical validation of the recovery recipe + the factory fixes can then ship with one more empirical case to reference.
- **bug-040 root cause "most likely #4 (timing)" for finance-track-01 specifically but #1 (compliance gap) is the FACTORY bug** — finance-track-01's architect ran 2026-04-25 before bug-033 + dev-multi-tier work landed 2026-04-30. The TIMING explains why this specific project missed it, but the FACTORY fix has to enforce the SKILL.md §7c step regardless because a future architect dispatch could STILL skip it under different circumstances.
