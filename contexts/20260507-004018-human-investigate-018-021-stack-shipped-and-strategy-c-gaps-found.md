---
session-id: "20260507-004018"
timestamp: 2026-05-07T00:40:18Z
agent: human
task-id: investigate-021-parity-verify-silent-false-clean-and-422-class
previous-context: 20260506-134403-human-reading-log-01-shipped-and-factory-bugs.md
checkpoint: true
status: checkpoint
---

# Context snapshot — human — investigate-018-021-stack-shipped-and-strategy-c-gaps-found

## Summary

Marathon session shipping the full investigate-018+019+020 stack (8 factory
plans, 7 commits) for /fix-bugs throughput + reliability. Validated empirically
on reading-log-01 with 7 bugs resolved cleanly via the new class-batched
dispatch (feat-061). Then user spun up the live app and found CSS not loading +
POST /books returning 422 (frontend sends `status: "want-to-read"`, backend
expects `"to-read"`). Investigation revealed the gap is NOT what I initially
framed: reading-log-01 is the FIRST Strategy C (real-DB) project to ship
through /fix-bugs; Strategy D (RHD-01, page.route mocks) had the synthesized
e2e flow runner working, Strategy C never has — backend cold-boot exceeds
verifier's hardcoded 60s. Plus `audit-computed-styles.mjs` + `seed-app-state.mjs`
are shelf-ware in the orchestrator (only CLI mode). User approved ship plan in
priority order: bug-062 (Strategy C dev-server timeout) → bug-063 (Strategy C
seed wiring) → bug-064 (manual hand-fix for status enum) → feat-064 (wire Layer 3) → feat-065 (cross-package types). investigate-021 plan filed but contains
my pre-RHD-01-comparison framing — needs an attempt-log update before ship.

## Completed since last snapshot

- bug-055 shipped (4143df6) — orphan worktree + empty-merge silent-success guards
- feat-058 shipped (1cdcd88) — trim agentSequence per cause class
- bug-056 + bug-057 shipped (1cab305) — tier inference + stderr context
- bug-058 shipped (bc5310e) — fixup-master sync
- bug-059 + bug-060 shipped (23580a1) — event-loop starvation clamp + polling
  wall-clock timer + Windows MAX_PATH cleanup fallback
- investigate-020 + feat-058-followup + feat-061 shipped (f3dad4e) — class-
  batched-dispatch ON by default
- feat-062 drafted, deferred (be5eac1) — pure-verify mode pending Step 4
  empirical validation
- bug-061 shipped (f27b860) — per-bug worktrees ALWAYS teardown + recreate
- 7-bug clean run on reading-log-01 (b21y5103m) — first end-to-end working
  build through full /fix-bugs cycle ($7.97 / ~35 min wall-clock)
- Cherry-picked + manually merged fix branch to master (a20d35e)
- Project booted live at localhost:3000 + 3001 — first time
- USER DISCOVERED: no CSS loaded; postcss.config.mjs missing; @tailwind
  directives missing from globals.css; user-fixed both inline
- USER DISCOVERED: POST /books returns 422 — status enum drift between
  frontend `"want-to-read"` and backend `"to-read"`
- investigate-021 plan filed (initial framing was wrong — said audit-computed-
  styles + seed-app-state were "silently degrading", actual finding is they're
  NEVER WIRED into orchestrator)
- Diagnostic deep-dive comparing reading-log-01 to repo-health-dashboard-01:
  RHD-01 has 70 reachability-orphan bugs (audit-app-reachability.mjs working
  perfectly) + 4 visual-parity bugs; reading-log-01 has 0 orphans + 6 parity.
  styleDrift is `[]` in BOTH projects — never populated for either.
  Difference is Strategy D (RHD-01, page.route) vs Strategy C (reading-log-01,
  real backend) — Strategy C is FIRST SHIP, hits backend-timeout wall.

## Current state

- Branch: feat/quota-observability (f27b860)
- Tests: 742/743 orchestrator suite (1 pre-existing run-synthesized-flows
  failure unrelated)
- Uncommitted files: 2 contexts/_ manifest entries, 4 plans (touched but
  not committed — bug-037/052/053 + feat-056), several `\_tmp-_` script files
  in orchestrator/scripts + scripts/, several context .md files (this
  snapshot will land alongside)
- Live dev server running on PID(s) for reading-log-01 backend + frontend
  (pnpm `--filter @repo/api dev` + `--filter @repo/web dev` via
  `node scripts/dev.mjs`) — task-id b99adddza or whatever followed
- Blockers: investigate-021 plan needs attempt-log update reflecting the
  CORRECT framing (not silent-degradation; the scripts are unwired) before
  any of bug-062/063 ship

## Next steps

1. **Update investigate-021 attempt-log** with the empirical findings from
   the RHD-01 comparison: confirm `audit-computed-styles.mjs` +
   `seed-app-state.mjs` never wired in orchestrator (CLI-only); RHD-01
   "50+ bugs" was actually 70 reachability-orphans + 4 skeleton-parity, not
   styleDrift. Strategy D vs C is the critical lens.
2. **File bug-062-strategy-c-dev-server-timeout** (P0): extend hardcoded 60s
   timeout in verifier to 180s when `architecture.yaml.tooling.stack.persistence_layer === "real-db"`.
   Touch points: `scripts/run-synthesized-flows.mjs`, `orchestrator/src/dev-server.ts`.
   Empirical motivator: reading-log-01 backend cold-boot ~30-60s with Prisma
   migrate-on-boot; verifier fires at 60s before /health responds.
3. **File bug-063-strategy-c-seed-baseline-not-invoked** (P0): synthesizer
   (`scripts/synthesize-flow-e2e.mjs`) should emit `globalSetup` calling
   `/test/seed-baseline` when `persistence_layer === "real-db"`. The
   endpoint exists in reading-log-01 (per stack-skill scaffold) but the
   synthesizer never generates the call.
4. **File bug-064-reading-log-01-status-enum-drift** (P1, project-side):
   hand-fix frontend `book-create-modal.tsx` to send `"to-read"` instead
   of `"want-to-read"`; coverUrl: `null` → omit when empty. ~30min hand-fix.
5. **(P2 deferred) feat-064-wire-computed-style-audit + seed-app-state**:
   connect both shelf-ware scripts into parity-verify. Lower priority
   because Layer 2 (Strategy C e2e) is the higher-leverage fix — running
   the synthesized e2e specs catches behavioral bugs (incl. 422 class)
   while computed-style audit only catches CSS drift.
6. **(P2) feat-065-cross-package-type-contract**: generate frontend types
   from backend Zod schemas via z-to-ts or contract test. Closes the
   class of bug that produced the status enum drift.
7. **Empirical re-validation**: re-fire /fix-bugs reading-log-01 after
   bug-062 + bug-063 land. Synthesized e2e should run; seed should fire;
   422 should surface as a real bug; verifier should converge cleanly OR
   produce the right list.

## Open questions

- Should bug-062's timeout extension be conditional on `persistence_layer`
  or unconditional 180s? Conditional is correct architecturally; unconditional
  is simpler. Strategy A/D projects don't need the extension since they
  don't boot a backend at all — for those, current 60s is generous.
- Should `/test/seed-baseline` be the synthesizer's call, or should the
  builder agents emit it inside their flow specs? feat-038 Phase 1+ called
  for synthesizer-emission ("strategy resolution at synthesis time"). That
  was the right call but never implemented for Strategy C. Revisit feat-038.
- Is there an HTML mockup → live screenshot LLM-rubric Layer-3 worth shipping
  separately? Lower confidence; defer.

## Key files touched

- `orchestrator/src/fix-bugs-loop.ts` — bug-055 + bug-058 + bug-059 + bug-060 +
  bug-061 + feat-058 + feat-061 changes (cumulative)
- `orchestrator/src/feature-graph.ts` — feat-061 enableClassBatchedDispatch
  default ON
- `orchestrator/src/invoke-agent.ts` — bug-059 Phase B polling timer (single
  setInterval handles both wall-clock + keepalive)
- `orchestrator/src/build-to-spec-verify.ts` — bug-057 stderrTail propagation
- `orchestrator/src/parity-verify.ts` — READ ONLY (confirmed audit-computed-styles
  not wired)
- `scripts/file-bug-plan.mjs` — feat-058 + bug-056 (inferTierFromViolation) +
  bug-057 + feat-058-followup (parity-divergence routing)
- `scripts/audit-computed-styles.mjs` — READ ONLY (confirmed CLI-only mode;
  never imported in orchestrator/)
- `scripts/seed-app-state.mjs` — READ ONLY (confirmed CLI-only mode)
- `packages/orchestrator-contracts/src/build-to-spec-verify.ts` — bug-057
  stderrTail field
- `projects/reading-log-01/.npmrc` — manual fix for Prisma 6 + pnpm Windows
  hoist (b1c3e20 + master cherry-pick)
- `projects/reading-log-01/apps/api/src/server.ts` — agent-authored
  prisma migrate deploy on boot (cb050f2 cherry-pick)
- `projects/reading-log-01/apps/web/playwright.config.ts` — webServer timeout
  120s (cb050f2 cherry-pick)
- `projects/reading-log-01/apps/web/postcss.config.mjs` — created inline this
  session (factory scaffold gap; not yet committed/factory-fixed)
- `projects/reading-log-01/packages/ui-kit/src/styles/globals.css` — added
  @tailwind base/components/utilities directives inline this session (factory
  scaffold gap; not yet committed/factory-fixed)
- `plans/active/investigate-018-fix-bugs-dispatch-latency.md`
- `plans/active/investigate-019-sdk-keepalive-stalls-during-parallel-dispatch.md`
- `plans/active/investigate-020-fix-bugs-loop-architecture-tester-reviewer-economics.md`
- `plans/active/investigate-021-parity-verify-silent-false-clean-and-422-class.md`
  (NEEDS attempt-log update)
- 8 bug-/feat- plan files corresponding to commits

## Decisions made

- **Pure-verify mode (feat-062) deferred**: requires investigate-020 Step 4
  empirical data on tester-redundancy per class against ≥3 shipped projects.
  Without that data, dropping tester+reviewer for cheap classes risks silently
  missing regressions verify doesn't catch.
- **bug-061 chose remove+recreate over sync** (per user pick): per-bug
  worktrees are ephemeral by design; reuse-with-sync (bug-058 fixup pattern)
  adds complexity for no benefit since per-bug branches don't carry value
  across sessions.
- **bug-059 clamp at 3 (not lower)**: empirical drift was 5-17 ticks at
  maxConcurrent=5; 3-way concurrency keeps timer-callback fidelity. Override
  via FIX_BUGS_MAXCONCURRENT_OVERRIDE env var preserves operator latitude.
- **feat-061 default ON, opt-out via env**: feat-053 infrastructure already
  shipped class-batched-dispatch; just flipping the default is low-risk and
  high-value (~7x dispatch reduction at scale).
- **investigate-021 reframing post-RHD-01-comparison**: NOT silent-degradation
  ("audit failed → returned [] looking like clean"). The actual finding is
  audit-computed-styles + seed-app-state were SHIPPED but NEVER WIRED into
  the orchestrator's parity-verify. Strategy D (RHD-01) didn't expose this
  because Layer 2 (synthesized e2e with page.route mocks) caught behavioral
  bugs without needing Layer 3. Strategy C (reading-log-01) is the first
  ship to need Layer 2 against a real backend, and that's the wall we hit.
- **Reading-log-01 immediate fix path: hand-fix the 422 + commit it as
  bug-064 in the project**: don't wait for full Strategy C factory fix. The
  user needs a working app to find the next class of bugs empirically.

## Cross-references

- Prior context: `20260506-134403-human-reading-log-01-shipped-and-factory-bugs.md`
- Active investigation: `investigate-021-parity-verify-silent-false-clean-and-422-class`
- Empirical-evidence projects: reading-log-01 (Strategy C, this session) +
  repo-health-dashboard-01 (Strategy D, comparison anchor)
- Strategy taxonomy: `.claude/rules/testing-policy.md §E2E data-seeding strategy`
