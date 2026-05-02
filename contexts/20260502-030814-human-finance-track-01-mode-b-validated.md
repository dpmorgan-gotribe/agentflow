---
session-id: "20260502-030814"
timestamp: 2026-05-02T03:08:14Z
agent: human
task-id: null
previous-context: 20260430-081931-human-factory-uplift-prebuilds-ready.md
checkpoint: true
status: checkpoint
---

# Context snapshot — human — finance-track-01: full Mode B + verify + fix-loop validated end-to-end

## Summary

First true autonomous Mode B + post-build-verify + fix-bugs-loop run on a node-fastify project, validated end-to-end on `projects/finance-track-01/`. Started from `finance-track-pre-build` per the recommended sequence (`/user-flows-generator` → `/pm` → clone → `/start-build`). Final outcome: **17/17 features merged + 7/7 orphan-component bugs auto-fixed** at $62.46 / $150 budget cap. Surfaced 4 factory bugs mid-run (bug-002 manual recovery, bug-035 dispatch-notes, bug-036 mutex, bug-034 resolver) — all 4 fixes shipped + committed during this session, several proven empirically against the same project. Session also surfaced 2 verifier-tier bugs filed as follow-ups (bug-037 playwright-not-installed, bug-038 parity-verify-port-default), plus investigate-014 (fix-loop parallelism + worktree cleanup ergonomics).

## Completed since last snapshot

- **HITL gate-4 prep**: ran `/user-flows-generator` against finance-track-pre-build to upgrade `user-flows-manifest.json` from v1 → v2.0 with `interactions[]` + `seedingTier` for all 9 flows. Discovered `uploadFile` and `press` aren't valid `InteractionStep.kind` values; substituted mocks for CSV upload + click-on-Save for inline-add. 9/9 flows have interactions; 6 mutation + 3 read-only.
- **PM refresh**: dispatched the `project-manager` agent → 14 features / 59 tasks → 17 features / 72 tasks. Added `feat-test-seed-endpoint` (P0, depends on schema-migrations); split csv-import + json-export into backend/UI feature pairs; backend-feature notes refreshed against the now-shipped node-fastify SKILL.md canonical layout.
- **Cloned `finance-track-pre-build` → `finance-track-01`** via `scripts/snapshot-project.mjs` (preserves `.git`, skips `node_modules`/build dirs). Baseline commit `eeae508`.
- **Mode B launch + first failure**: hit gate-6 (pr-review) HITL on first feature. Killed orchestrator without `/pause-build` → cascade-failed all 17 features (bug-002 recovery flow). Session memory updated: `feedback_orchestrator_pause_dont_kill.md`. Recovered with `--pipeline-run-id 2276b8a1-1e71-4ec4-ad4c-e0f63f1024b1 --auto-merge-after-reviewer`.
- **wave-1 complete**, **wave-2 fanout** hit bug-036 (parallel-checkout race on `.git/index.lock`). 2 of 3 features lost the race + cascade-aborted dependents.
- **bug-002 manual recovery for feat-transactions-crud**: recreated branch from dangling commit `ea8db14`, manual concat-resolved 2 files (`apps/api/src/app.ts` + `packages/types/src/index.ts`), committed merge (`351a805`).
- **Shipped bug-035 Phase A** (`d36198f`): `orchestrator/src/invoke-agent.ts:1516` now includes `task.notes` in builder prompts. Empirically proven later — feat-seed-script's reviewer approved on first attempt thanks to "Includes one archived account" note delivered to builder.
- **Shipped bug-036 Phase A** (`da52f1b`): per-project-root mutex around `runCheckoutFeature` in `orchestrator/src/feature-graph.ts`. Empirically proven — wave A 3-parallel + wave B 5-parallel dispatched cleanly, zero race losses.
- **Shipped reviewer 900s timeout bump** (`178378f`): `DEFAULT_STALL_TIMEOUT_BY_AGENT.reviewer` 10min → 15min. Empirically proven — feat-csv-import-backend's reviewer recovered on retry; feat-acceptance-suite's reviewer landed on attempt 2.
- **Shipped bug-034 Phase A** (`9e6e34a`): `tryAdditiveConcatResolve` deterministic merge-conflict resolver wired into `attemptCloseFeature` BEFORE the LLM handoff. In binary but never invoked this run (LLM handoff resolved feat-accounts-ui's conflict on retry first).
- **17/17 features merged** at master HEAD `8ca2ef9` after multiple recoveries.
- **Build-to-spec verifier ran**: 7 orphan-component bugs filed → fix-bugs loop iteration 1 of 5 → 7/7 resolved sequentially (~50 min).
- **2 verifier warnings surfaced**: `flow-execution: Cannot find module '@playwright/test'` (bug-037 filed) + `parity: dev-server: auto-boot failed: backend (apps/api/) did not respond on http://localhost:8000/health` (bug-038 filed).
- **investigate-014 filed**: combined audit of fix-bugs-loop parallelism (sequential `for` loop ignores `--max-concurrent`) + worktree lifecycle cleanup (~10GB/project disk bloat, no auto-prune post-merge).

## Current state

- Branch: `feat/quota-observability` (`9e6e34a`)
- Tests: orchestrator suite **590/590 passing** (was 578 at session start; +12 across bug-035/036/034 regressions)
- Uncommitted files: 5 — `plans/active.md` + 3 new plan files (bug-037, bug-038, investigate-014) + 2 leftover `.tmp-*.mjs` scripts in `scripts/` (sandbox blocked rm; harmless)
- `finance-track-01` project state: master HEAD `8ca2ef9 merge feat/feat-acceptance-suite`; 17 features merged; 7 orphan bugs fix-loop-resolved; verifier surfaced 2 warnings (bug-037, bug-038)
- Total spend on Mode B + verify + fix-loop: $62.46 ($50.68 build + $11.78 fix-loop)
- Quota: 7-day bucket at ~82%, ~52h to reset (Max 20× tier)
- Blockers: none for the factory work; finance-track-01 incomplete only in the sense the verifier's E2E + parity dimensions never ran (blocked by bug-037 + bug-038)

## Next steps

1. **Commit this session's pending work**: `plans/active.md` + 3 new plan files. (skip the `.tmp-*.mjs` leftovers; they're not load-bearing).
2. **Ship bug-037 Phase A** — add `@playwright/test` to react-next + svelte-kit SKILL.md scaffold templates so future projects ship with the runtime. Estimated ~30 min.
3. **Ship bug-038 Phase A** — extend `resolveBackendPort` resolution chain in `orchestrator/src/dev-server.ts:147` (env > BACKEND_PORT > .env.local > .env > scripts/dev.mjs > stack-default-by-backend_framework > throw). Estimated ~45 min.
4. **Re-run finance-track-01's verify pass** — `pnpm --filter orchestrator start verify finance-track-01` (or equivalent) — confirm both new lights are green and parity-verify completes with `screens checked` not `screens unchecked`.
5. **investigate-014** — 60-min time-box audit of fix-loop parallelism + worktree cleanup. Likely outputs feat-046 (parallelism) + feat-047 (auto-prune). Defer until bug-037/038 land.
6. **Eventually**: the user mentioned "this would be useful" energy around `/cleanup-worktrees` skill. Pair it with whatever investigate-014 recommends.

## Open questions

- **bug-037 Phase A install location**: should `@playwright/test` go in `apps/web/package.json` devDependencies template OR be a workspace-root devDep that hoists? Stack-skill convention is per-app today; investigate-014's worktree audit may surface deeper convention questions.
- **bug-038 Phase A precedence ordering**: the current 7-tier chain (env > BACKEND_PORT > .env.local > .env > dev.mjs > stack-default > throw) — do we want a `--backend-port` CLI flag at the top (operator override) or is process.env enough?
- **fix-bugs loop commit cadence**: docs/bugs.yaml shows status="completed" for resolved bugs but no commits land on `fix/bugs-yaml-iter` branch until iteration ends (or maybe never — I didn't observe the actual merge to master post-iteration). Worth tracing in investigate-014.
- **Should bug-037 Phase A also auto-trigger `playwright install chromium`?** ~150MB browser binary. Phase D in the plan defers this decision; Phase A unblocks the dev-dep install but specs still won't actually run without the binary.

## Key files touched

### Factory (committed)

- `orchestrator/src/invoke-agent.ts:1515-1531` — task.notes now indented under each task line in builder prompts (bug-035)
- `orchestrator/tests/invoke-agent.test.ts` — +2 regression tests for bug-035
- `orchestrator/src/feature-graph.ts:518-546` — `acquireCheckoutLock` per-project-root mutex (bug-036 Phase A)
- `orchestrator/src/feature-graph.ts:583-651` — `tryAdditiveConcatResolve` pure helper + `tryAdditiveConcatMergeResolution` end-to-end resolver + `abortFailedMerge` rollback (bug-034 Phase A)
- `orchestrator/src/feature-graph.ts:677-728` — `attemptCloseFeature` wired to call `tryAdditiveConcatMergeResolution` BEFORE the LLM handoff (bug-034)
- `orchestrator/src/feature-graph.ts:680-728` — `runFeature` checkout-feature wrapped in mutex (bug-036)
- `orchestrator/tests/feature-graph.test.ts` — +1 mutex regression test (bug-036) +9 resolver tests (bug-034)
- `orchestrator/src/model-config.ts:103-104` — reviewer + security stallTimeoutMs 10 → 15 min
- `orchestrator/tests/model-config.test.ts` — updated assertion to 15 min

### Factory (uncommitted)

- `plans/active.md` — manifest entries for bug-034, bug-035, bug-036, bug-037, bug-038, investigate-013, investigate-014
- `plans/active/bug-037-playwright-runtime-not-auto-installed-for-synthesized-e2e.md` (NEW)
- `plans/active/bug-038-parity-verify-backend-port-defaults-to-fastapi-8000.md` (NEW)
- `plans/active/investigate-014-fix-bugs-loop-parallelism-and-worktree-lifecycle.md` (NEW)

### Project finance-track-01 (committed in project's own git)

- 17 feature merges + 7 fix-loop bug-resolution worktrees (all on master via `8ca2ef9`)
- `apps/web/package.json` — pnpm.onlyBuiltDependencies added for better-sqlite3 + esbuild (during bug-002 manual merge work)
- `apps/api/src/app.ts` + `packages/types/src/index.ts` — manually concat-resolved during bug-002 recovery

### Memory (saved)

- `~/.claude/projects/.../memory/feedback_orchestrator_pause_dont_kill.md` — never kill orchestrator mid-run; always `/pause-build` first to preserve run-id state

## Decisions made

- **Bumped reviewer stallTimeoutMs to 15min as a band-aid** rather than re-architecting per-dimension reasoning — defensible because empirical 3/30 failure rate at 10min, ample margin within Max 20× quota. Real fix (per-dimension cap or diff-summarization pre-pass) deferred to future bug.
- **bug-034 Phase A picks "ours-then-theirs" concat order** — preserves master's append-after-master semantics; deterministic ordering matters for git history readability. Empty-side detection (modify/delete pattern) returns null so LLM handoff still gets a chance.
- **bug-036 mutex scopes to checkout-feature ONLY** — builder/tester/reviewer/close-feature all run against per-feature worktree's own .git, no contention. Mutex during checkout is the only contended window.
- **Combined Q1+Q2 into investigate-014** rather than 2 separate investigations — they share same orchestrator surfaces (git-agent, feature-graph, fix-bugs-loop), same architectural concern (worktree lifecycle), and have strong interaction (parallel fix-bugs would compound disk bloat).
- **Recovery preference: let LLM handoff try first, manual concat as fallback** — bug-034 Phase A in binary but the empirical accounts-ui case showed the LLM path eventually wins (after 1-3 retries) for many additive-region cases. The deterministic fast-path is value-add insurance, not a primary path.
- **Sequential fix-bugs loop is OK for now** — wall-clock cost of ~50min on 7 bugs isn't blocking; investigate-014 will scope whether parallel is worth the engineering. Don't pre-optimize.
- **Project-side bug-002 recovery + factory bug-034 are sister fixes** — bug-002 documents the manual recipe for any future merge-conflict emergency-abort; bug-034 Phase A reduces the frequency of needing it.
