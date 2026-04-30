---
session-id: "20260430-010524"
timestamp: 2026-04-30T01:05:24Z
agent: human
task-id: feat-038-deepen-synthesize-flow-e2e-and-data-seeding
previous-context: 20260430-001912-human-bug-032-phase-ab-handoff.md
checkpoint: true
status: in-progress
---

# Context snapshot — human — feat-038 Phase 0 handoff

## Summary

Closed the entire bug-030 + bug-031 + bug-032 trilogy that was blocking the verify+fix-loop end-to-end on `repo-health-dashboard-01` (all archived with status:completed + lessons). Shipped bug-032 Phase A+B+C (factory-level multi-tier env contract + dev-server co-boot + architect/stack-skill scaffolding). Then completed feat-038 Phase 0 — time-boxed investigation of the E2E data-seeding strategy, producing the empirical decision that strategy is stack-determined (not one-size-fits-all). Now pausing before feat-038 Phases 1-5 (the multi-hour synthesizer-deepening work) so the fresh-session benefits from a clean context window.

## Completed since last snapshot

- Empirically validated `bug-032 Phase B` (`scripts/dev.mjs`) end-to-end via operator smoke-test on `repo-health-dashboard-01`. Four iterations of fixes during smoke-test: drop `uv.exe` literal, set spawn cwd at apps/api/ (uv's `-C` is `--config-setting`), use `uvicorn api.main:app --app-dir src` for src-layout, dual-port pre-flight refuse-to-start (defends against false-ready races + CORS allowlist mismatches when Next.js falls back to :3001).
- Shipped `bug-032 Phase C` (factory-level structural):
  - `orchestrator/src/dev-server.ts`: `bootDevServer()` detects `apps/api/` and co-boots backend with port coordination during verify auto-boot. New exports `spawnBackendDevServer()` + `resolveBackendPort()`. `DevServerHandle` gains optional `backendProcess` + `backendUrl`. 568/568 tests still pass.
  - `.claude/skills/architect/SKILL.md`: new step 7b (per-app `.env.example`), 7c (copy `dev-multi-tier.mjs.template`), step 8 "Local dev setup" sub-section.
  - `.claude/skills/agents/back-end/python-fastapi/SKILL.md` + `react-next/SKILL.md`: section 1a in each declares env contract is part of canonical scaffold.
  - `.claude/templates/dev-multi-tier.mjs.template`: verbatim copy of validated dev.mjs.
- Archived bug-032 with completion record (Phases A+B+C shipped, Phase D folded into feat-038).
- Completed `feat-038 Phase 0` — empirical survey of factory projects' E2E patterns, producing the decision documented in `.claude/rules/testing-policy.md §E2E data-seeding strategy`. Strategy is per-stack-skill based on persistence layer:
  - localStorage-only (Zustand-persist) → Strategy A (per-test reseed via `localStorage.clear() + reload`, ~10ms)
  - External API + proxy cache → Strategy D (`page.route()` interception, ~0ms)
  - Real DB-backed → Strategy C (hybrid: globalSetup baseline + describe-block scoped mutations)
- Plus committed everything cleanly:
  - factory commits: `fae6163`, `e1dead8`, `58e3986`, `745bf78`
  - project commits: `6885edc`, `495367a`

## Current state

- Branch: feat/quota-observability (745bf78)
- Tests: 568/568 orchestrator passing
- Uncommitted in factory: 3 files I never touched this session (`.claude/hooks/detect-loop.mjs`, `orchestrator/src/cli.ts`, `scripts/snapshot-project.mjs` untracked) — pre-existing in-flight work from prior sessions. Plus an orphan `D plans/active/bug-032-...md` git status entry (file IS in plans/archive/, archival committed; stale unstaged-deletion noise that can be `git checkout HEAD --` cleared).
- Uncommitted in project (`repo-health-dashboard-01`): `apps/web/.next.broken2/` (build artifact, gitignore candidate).
- Blockers: none. feat-038 Phase 1+ is ready to start; Phase 0's decision is the load-bearing input.

## Next steps

1. **Resume in fresh session.** First action: `/load-context-chain` to walk back through the chain of snapshots and synthesize state.
2. **feat-038 Phase 1 — manifest schema extension** (~1 hr):
   - Extend `docs/user-flows-manifest.json` schema to include structured `steps[]` per flow (`{kind: navigate|fill|click|select|waitForResponse|assertVisible|assertText|...}`) plus `seedingTier: "read-only" | "mutation"`.
   - Add Zod schema to `packages/orchestrator-contracts/` mirroring the JSON schema.
   - Update `schemas/user-flows-manifest.schema.json` so existing validation gates accept the new shape.
3. **feat-038 Phase 2 — deepen the synthesizer** (~2-3 hr):
   - Rewrite `scripts/synthesize-flow-e2e.mjs` to consume the new schema and emit one Playwright statement per step.
   - Generate `playwright/global-setup.ts` content per the project's `architecture.yaml.tooling.stack.persistence_layer`-determined strategy (A/C/D) per `.claude/rules/testing-policy.md §E2E data-seeding strategy`.
   - Generate `apps/web/e2e/fixtures/seed-helpers.ts` with the per-strategy helpers.
4. **feat-038 Phase 3** (~1 hr): update `/user-flows-generator` skill prompt so it authors `steps[]` alongside the existing prose task description (Path 3a — extend the generator's prompt; rejected Path 3b's separate post-processing skill).
5. **feat-038 Phase 4** (~30 min): verify pipeline integration — surface seed-failures distinctly from spec-failures; possibly extend `BuildToSpecVerifyOutput.flows.failed[]` with a discriminator.
6. **feat-038 Phase 5** (~1-2 hr): validation harness under `tests/fixtures/synthesize-flow-e2e/` covering all three strategies with synthetic projects.
7. **Then feat-034** (devops-agent, P1, independent of feat-038) — close the missing-agent gap surfaced live (PM recruited `devops` but factory shipped no such agent → 4 tasks silently skipped).

## Open questions

- **Should the seeding-tier signal in user-flows-manifest be inferable** from the flow's screen-id sequence (e.g. screens with `data-screen-id` matching a known mutation pattern) OR explicitly authored by `/user-flows-generator`? Lean toward explicit — the LLM has the full mockup HTML when authoring; can mark each flow's tier deterministically based on whether the flow's task description involves create/update/delete verbs.
- **Does the `/test/seed` endpoint contract need to be specified per-stack** (FastAPI shape / Express shape / etc.) **or is one canonical JSON envelope sufficient**? Lean toward one canonical envelope (`POST /test/seed { fixtures: { table_name: row[] } }`); per-stack skills implement the consumer.
- **For feat-034 devops-agent**, does it need to know about `scripts/dev.mjs` → translate to a CI workflow that boots both apps for E2E? Probably yes — feat-034 §Phases should reference the multi-tier dev orchestration as one of its scaffolded outputs (CI variant: launch backend container + run frontend tests against it).
- **The orphan `bug-032` git-status entry** — looks like git's index sees the file as deleted-but-not-staged because the move went through `git mv` without explicit staging. `git checkout HEAD -- plans/active/bug-032-...md` should clear it; the actual archive lives in `plans/archive/` and is committed. Worth verifying on next session before trusting branch state.

## Key files touched

- `.claude/rules/testing-policy.md` — new section "E2E data-seeding strategy (feat-038 Phase 0)" with the canonical per-stack-skill strategy table. Committed in `745bf78`.
- `plans/active/feat-038-deepen-synthesize-flow-e2e-and-data-seeding.md` — Phase 0 §Decision section added with empirical findings + rejected alternatives + out-of-scope deferred items. Committed in `745bf78`.
- `plans/archive/bug-030-...md` + `bug-031-...md` + `bug-032-...md` — three completed plans with full Attempt Log + Lessons sections.
- `orchestrator/src/dev-server.ts` — extended with `spawnBackendDevServer()`, `resolveBackendPort()`, and `bootDevServer()` co-boot logic. Committed in `e1dead8`.
- `.claude/skills/architect/SKILL.md` + `python-fastapi/SKILL.md` + `react-next/SKILL.md` — env-contract scaffolding requirements. Committed in `e1dead8`.
- `.claude/templates/dev-multi-tier.mjs.template` — committed in `e1dead8`.
- `projects/repo-health-dashboard-01/scripts/dev.mjs` — committed in project repo as `495367a`.
- `projects/repo-health-dashboard-01/apps/{web,api}/.env.example` — committed in project as part of `6885edc`.

## Decisions made

- **bug-032 Phase D folded into feat-038 instead of shipping standalone.** The synthesizer's current shallow `page.goto("/")` output is port-agnostic (relative to Playwright's baseURL) — Phase D's "synth-flow baseURL signal" is meaningful only when feat-038's structured `steps[]` lands. Shipping Phase D against the current synthesizer would have been ceremonial. Why: avoids over-investing in retrofitting the regex-based synthesizer; correctness lands in feat-038 Phase 2's rewrite.
- **Per-stack-skill seeding strategy declaration over a global rule.** Empirical survey showed `kanban-09` uses localStorage-clear (cheap), `repo-health-dashboard-01` uses `page.route()` interception (no backend), and DB-backed projects (book-swap, finance-track pre-builds) will need hybrid when they ship. Forcing a single global pattern would either bloat localStorage projects with unused machinery OR cripple performance for DB-backed ones. Why: each project pays the minimum overhead its architecture actually requires; matches the "do the simplest thing that works for THIS stack" philosophy already encoded in stack-skill dispatch.
- **Phase C's `dev-multi-tier.mjs.template` lives in `.claude/templates/`, copied verbatim by architect.** Alternative was per-stack-skill scaffolding (each stack authors its own dev.mjs slice), but that splits the cross-stack coordination logic across 2+ skills. Centralized template + architect-copy is simpler. Why: empirical lessons from the smoke-test (uv invocation, src-layout uvicorn, dual-port pre-flight) are baked into the single template; future stack additions extend the template's `spawnBackend()` switch rather than reinventing.
- **Pause before Phase 1+ for fresh session.** Phase 1+ touches user-flows-manifest schema, the synthesizer, the user-flows-generator skill, validation fixtures — significant scope that benefits from clean context. Why: cumulative session context is high after shipping bug-030/031/032 + Phase 0; a fresh window gives Phase 1+ better attention.
