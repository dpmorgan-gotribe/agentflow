---
session-id: "20260430-001912"
timestamp: 2026-04-30T00:19:12Z
agent: human
task-id: bug-032-api-base-url-not-coordinated-with-backend-port
previous-context: 20260428-225900-human-launch4-paused-option-c-handoff.md
checkpoint: true
status: in-progress
---

# Context snapshot — human — bug-032 Phase A+B handoff

## Summary

This session shipped `bug-030` (audit-app-reachability false-positive flood) Phase A and `bug-031` (fix-loop fixup-worktree not seeded) Phases A+B+D — both archived. Then re-ran the verify+fix-loop end-to-end on `repo-health-dashboard-01`: the loop reported `clean` and resolved 2 legitimate parity bugs in 1 attempt each ($10.34 cost), but the fixes landed as 31 uncommitted files on `main` rather than as commits on the fix branch (the orchestrator's auto-merge step was a no-op because builders wrote via path-traversal out of the worktree). Manual browser test then surfaced an unrelated 404 on `/api/report/*` — root cause: `NEXT_PUBLIC_API_BASE` empty by default, so frontend calls hit Next.js `:3000` instead of FastAPI `:8000`. Filed bug-032 (port-coordination) and feat-038 (synthesizer too shallow + data-seeding strategy investigation). Started bug-032 Phase A+B; pausing for operator smoke-test before Phase C (factory-level structural work).

## Completed since last snapshot

- Shipped bug-031 Phases A+B+D — exported `seedWorktree` from `invoke-agent.ts`, wired into `openFixupWorktree` (idempotent on existing worktrees), regression test asserting hooks + autonomous `permissions.allow` post-conditions. 568/568 orchestrator tests pass.
- Empirically validated bug-030 + bug-031: re-ran `--resume-feature-graph --pipeline-run-id 6b5985b4-... --bugs-yaml-mode=fresh` against `repo-health-dashboard-01` → exit 0, `iteration 1/1; resolved: 2; failed: 0; status: clean`. Verify produced exactly 2 legitimate visual-parity bugs (bug-030 holds — no flood). Fixup worktree seeded with hooks + autonomous permissions (bug-031 holds).
- Archived bug-030 + bug-031 to `plans/archive/`; updated `plans/active.md` with archive comment.
- Filed bug-032 (api-base-url-not-coordinated-with-backend-port, P0) — three structural gaps: missing `apps/web/.env*`, no port-coordination between processes, verify auto-boot only knows about Next.js side. Phases A (per-project env files), B (`scripts/dev.mjs`), C (factory-level wiring), D (synthesize-flow-e2e baseURL signal).
- Filed feat-038 (deepen-synthesize-flow-e2e-and-data-seeding, P0) — Phase 0 investigation of per-test reseed vs shared baseline vs hybrid; Phases 1-5 deepen the synthesizer + add structured `steps[]` schema.
- Shipped bug-032 Phase A: authored `apps/web/.env.example` + `apps/api/.env.example` for `repo-health-dashboard-01`. `.env.local` write was correctly blocked by `enforce-boundaries.sh` (secrets-pattern guard) — finding logged in bug-032 plan; Phase C must document operator-copy step instead of auto-authoring.
- Shipped bug-032 Phase B: authored `scripts/dev.mjs` (~180 LOC) at project root — port-coordinated dev orchestrator that spawns FastAPI, captures bound port, propagates `NEXT_PUBLIC_API_BASE=http://localhost:<port>` into Next.js env, then spawns Next.js. Cross-platform spawn pattern mirrors `orchestrator/src/dev-server.ts`. Not smoke-tested (uv not installed locally).

## Current state

- Branch: feat/quota-observability (4c70dc3)
- Tests: 568/568 orchestrator passing (last run before this segment ended)
- Uncommitted files: 9 in factory (audit-app-reachability.mjs + sync-project-schemas.mjs + invoke-agent.ts + fix-bugs-loop.ts + fix-bugs-loop.test.ts + cli.ts + detect-loop.mjs + stylesheet/SKILL.md + plans/active.md). Plus 31 in `projects/repo-health-dashboard-01/` from the fix-loop run that never got committed.
- Blockers: operator smoke-test of `node scripts/dev.mjs` blocked by `uv` not installed locally (`winget install astral-sh.uv` is the one-time setup).

## Next steps

1. **Operator actions before resume:**
   - `winget install astral-sh.uv` (one-time)
   - `echo "NEXT_PUBLIC_API_BASE=http://localhost:8000" > projects/repo-health-dashboard-01/apps/web/.env.local` (hook blocks Claude from doing this)
   - Review + commit the 31 fix-loop files + Phase A+B output on `repo-health-dashboard-01` (recommendation: commit; diff audit shows legitimate parity-fix work)
   - Smoke-test: `cd projects/repo-health-dashboard-01 && node scripts/dev.mjs`. Open http://localhost:3000/, paste `facebook/react`, submit. Expect: report renders, zero `/api/*` 404s in console.
   - Test port override: `PORT=8001 node scripts/dev.mjs` — backend should bind 8001, frontend's `NEXT_PUBLIC_API_BASE` should follow.
2. **Resume here with bug-032 Phase C** (factory-level structural):
   - `.claude/skills/architect/SKILL.md` — author env-contract authoring requirements; document `.env.local` operator-copy step (not auto-author — `enforce-boundaries.sh` correctly blocks).
   - `orchestrator/src/dev-server.ts` — extend `bootDevServer()` to detect `apps/api/` presence and run port-coordinated boot during verify-stage auto-boot.
   - `.claude/skills/agents/back-end/python-fastapi/SKILL.md` + `.claude/skills/agents/front-end/react-next/SKILL.md` — make env-contract part of canonical scaffold.
3. **Then bug-032 Phase D** (small): update `scripts/synthesize-flow-e2e.mjs` so generated specs use `process.env.PLAYWRIGHT_BASE_URL` for API origin.
4. **Then feat-038 Phase 0** (1hr investigation, time-boxed): per-test seed vs shared-baseline vs hybrid. Benchmark on `book-swap-pre-build`.
5. **Then feat-038 Phases 1-5**: structured `steps[]` schema, deepened synthesizer, `/user-flows-generator` updates, fixture-based regression harness.
6. **Then feat-034 devops-agent** (P1): close the missing-agent gap surfaced live (PM recruited `devops`, factory shipped no such agent → 4 tasks silently skipped).

## Open questions

- The 31-file uncommitted state on `repo-health-dashboard-01` mixes (a) the parity-bug fix-loop output (about-page restructure, header layout regroup, home-page `data-kit-component` additions, ui-kit primitive `data-kit-component`s) with (b) earlier-session retrofit-script output that also never got committed. All look legitimate per spot-check, but a careful review before commit is the operator's call.
- Should the `scripts/dev.mjs` orchestration become a stack-skill-scaffolded artifact (per `react-next` + `python-fastapi`) or remain per-project? Lean toward stack-skill-scaffolded with project overrides — covered as Phase C §Open Questions in bug-032.
- For verify-stage auto-boot, should the backend bind a deterministic port (read from `apps/api/.env`) OR a randomly-chosen free port? Random-free avoids parallel-project collisions but complicates env propagation. Lean deterministic + collision-fail-loud.
- The orchestrator's `closeFixupWorktree` `mergeFirst: true` step was a no-op this run because builders wrote via path-traversal out of the worktree, not into the worktree's working tree. The fix branch had no new commits to merge → silent no-op merge. This is a **third class of bug** distinct from bug-027 (merge ordering) and bug-031 (missing seed). Symptom: fix-loop reports clean but the work is uncommitted on main rather than committed on the branch. Worth filing as bug-033 if the user hits it again or wants the structural fix (Write(\*) glob in seedWorktree's `permissions.allow` is too broad; should scope to `Write(<worktree>/**)`).

## Key files touched

- `scripts/audit-app-reachability.mjs` — bug-030 Phase A: dropped `packages/` from SCAN_ROOTS, prepended `apps/web` to `@/` alias roots, extended `IMPORT_RE` for `export … from`. **Modified, not yet committed in factory.**
- `scripts/sync-project-schemas.mjs` — added `retrofits/` to SYNC_PAIRS so codemod scripts (`retrofit-*.mjs`) travel to all projects. **Modified, not yet committed.**
- `orchestrator/src/invoke-agent.ts` — bug-031 Phase A: exported `seedWorktree` + `SeedResult` (visibility-only change). **Modified.**
- `orchestrator/src/fix-bugs-loop.ts` — bug-031 Phase A+B: imports `seedWorktree`, `openFixupWorktree` invokes it after `git worktree add` (and on already-existing worktrees, idempotent re-seed). **Modified.**
- `orchestrator/tests/fix-bugs-loop.test.ts` — bug-031 Phase D: regression test asserting hooks + autonomous permissions post-`openFixupWorktree`. **Modified.**
- `.claude/skills/stylesheet/SKILL.md` — §18 finalize step now invokes `node scripts/retrofit-ui-kit-data-attrs.mjs .` as auto-safety-net. **Modified.**
- `plans/active.md` — bug-030 + bug-031 archived; bug-032 + feat-038 added; feat-037 description tightened. **Modified.**
- `plans/active/bug-032-api-base-url-not-coordinated-with-backend-port.md` — **NEW**, draft.
- `plans/active/feat-038-deepen-synthesize-flow-e2e-and-data-seeding.md` — **NEW**, draft.
- `plans/archive/bug-030-audit-reachability-false-positive-flood.md` — **MOVED** from active.
- `plans/archive/bug-031-fix-loop-fixup-worktree-not-seeded.md` — **MOVED** from active.
- `plans/active/feat-037-audit-reachability-ts-aware-rewrite.md` — **NEW** earlier this session, draft.
- `projects/repo-health-dashboard-01/apps/web/.env.example` — bug-032 Phase A: declares `NEXT_PUBLIC_API_BASE` contract.
- `projects/repo-health-dashboard-01/apps/api/.env.example` — bug-032 Phase A: declares `PORT` contract.
- `projects/repo-health-dashboard-01/scripts/dev.mjs` — bug-032 Phase B: port-coordinated dev orchestrator. NOT YET smoke-tested.

## Decisions made

- **Ship bug-030 as Phase A surgical fixes (not full TS-aware rewrite).** The empirical false-positive flood needed unblocking immediately; the structural rewrite is queued as `feat-037` and only justified once the regex approach hits a NEW false-positive class. Why: empirical zero-false-positive rate post-Phase-A means urgency is low; engineering investment is high.
- **bug-031 Phase B (re-seed on existing worktrees) is on by default, idempotent.** Why: cheap insurance against state drift when sessions straddle a factory upgrade — `seedWorktree` already preserves existing entries, only appends missing ones. No measurable cost; closes a quiet flap mode.
- **bug-032 Phase A's `.env.local` write must be done by operator, not Claude.** Why: `enforce-boundaries.sh` (correctly) blocks `.env.local`-pattern writes as a secrets guard. Logged as a Phase C requirement: architect skill must document the operator copy step instead of attempting auto-authoring.
- **bug-032 Phase B `scripts/dev.mjs` lives at project root, NOT in the factory `scripts/`.** Why: it's a per-project orchestration script that consumes project-specific paths (`apps/api/.env`, `apps/web/`); generalizing it to factory-level requires Phase C's stack-skill-scaffolded approach. Project root is the right home for now.
- **scripts/retrofit-ui-kit-data-attrs.mjs added to sync-project-schemas.mjs's SYNC_PAIRS.** Why: codemod-style scripts must travel to projects so skills (`/stylesheet` §18) can invoke them from project CWD. Generalizes the pattern: any future codemod following `retrofit-*.mjs` naming auto-syncs.
- **Pause before Phase C (factory-level work) for operator smoke-test.** Why: Phase C touches architect-skill + dev-server.ts + 2 stack skills (multi-hour structural). Validating Phase B's `scripts/dev.mjs` empirically first prevents locking in a pattern that doesn't actually work.
