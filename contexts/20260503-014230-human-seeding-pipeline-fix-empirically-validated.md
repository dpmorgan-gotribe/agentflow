---
session-id: "20260503-014230"
timestamp: 2026-05-03T01:42:30Z
agent: human
task-id: null
previous-context: 20260502-040618-human-finance-track-01-seeding-pipeline-bugs-filed.md
checkpoint: true
status: checkpoint
---

# Context snapshot — human — Wave 0/1/2 SHIPPED: 5-link seeding-pipeline failure chain empirically fixed

## Summary

Picked up from prior checkpoint (20260502-040618) where the 2026-05-02 finance-track-01 verifier had 9/9 synthesized E2E flows landing on empty "No accounts yet" UI states, with 3 P0 bugs filed (bug-040/041/042) covering the seeding-pipeline failure chain. This session expanded the factory-side scope (added bug-043 for the orchestrator's mirror surface, refined bug-040 + bug-042 with prerequisite phases) and shipped Wave 0+1+2 end-to-end. The empirical "No accounts yet" failure mode is FIXED across both hand-written and synthesized flow-3 specs — both now reach much further into their interaction sequences before hitting unrelated test-authoring issues, and the page snapshot definitively shows the populated dashboard ("May 2026 · normalized to EUR" subtitle, full nav, 3 active accounts seeded). Net: 4 factory commits across 3 P0 bug fixes + Phase A+B+D of bug-043 + Phase A.5+A+B+C of bug-040/041/042, ~3300 lines, contracts 408→409, orchestrator 607→620 tests, 100% factory-side stack-awareness for python-fastapi/node-fastify/node-trpc-nest/node-express across templates + skills + orchestrator + synthesizer.

## Completed since last snapshot

### Plan refinement + new bug filing (commit `78d8038`)

- **bug-040 plan refined**: added Phase A.5 (per-stack `dev-multi-tier-{slug}.mjs.template` files + thin §dev-orchestrator pointer in each backend SKILL.md); threaded stack-awareness through Phases A/B/C/D; expanded affected-files + validation criteria
- **bug-042 plan refined**: added Phase A.5 (uniform `/test/seed` + `/test/cleanup` + new `/test/seed-baseline` endpoint contract across 4 backend stack skills, gated on ENABLE_TEST_SEED=1, with finance-track-01's existing fastify route as canonical pattern); expanded affected-files + cross-references
- **bug-043 FILED + APPROVED** (`fix/dev-server-stack-aware-spawn-command`): orchestrator/src/dev-server.ts spawnBackendDevServer was hardcoded `uv run uvicorn api.main:app` for ALL backends; promoted from bug-040 cross-reference to its own plan because it lives on a different surface (orchestrator runtime vs project-side scaffold template)
- **plans/active.md** updated with refreshed bug-040/042 entries + new bug-043 row

### Wave 0 — bug-043 SOLO (commit `ec1af9e`)

- **Phase A**: STACK_BACKEND_SPAWN_COMMAND lookup table keyed by `architecture.yaml.tooling.stack.backend_framework`; resolveBackendSpawnSpec helper; spawnBackendDevServer refactored to consume the spec; FastAPI fallback when slug unknown for backward compat; readBackendFrameworkSlug extracted as shared helper between bug-038 + bug-043
- **Phase B**: bootDevServer's backend-failure error now names the actual spawn command attempted + per-stack hint via HINTS_BY_SLUG (replaces generic "uv/pnpm/etc" wording)
- **Phase D**: 10 regression tests in orchestrator/tests/dev-server.test.ts covering each backend slug + null fallback paths + port interpolation in FastAPI args + PORT-via-env contract for node-\* + empirical finance-track-01 case
- **Tests**: orchestrator 607→617 passing
- **Phase E smoketest** (1-shot vitest, deleted after pass): finance-track-01 → fastify spec ✓; repo-health-dashboard-01 → FastAPI spec (regression) ✓

### Wave 1 — bug-040 Phase A.5+B (commit `5a69eee`)

- **4 per-stack templates**:
  - `dev-multi-tier-python-fastapi.mjs.template` (renamed from `dev-multi-tier.mjs.template` via `git mv`; history preserved)
  - `dev-multi-tier-node-fastify.mjs.template` (NEW — `pnpm --filter @repo/api dev`, port 3001, cwd at PROJECT_ROOT)
  - `dev-multi-tier-node-trpc-nest.mjs.template` (NEW placeholder — `start:dev`, port 4000)
  - `dev-multi-tier-node-express.mjs.template` (NEW placeholder)
- **§dev-orchestrator subsections** in 3 backend SKILL.md (python-fastapi, node-fastify, node-trpc-nest) — each names canonical template + documents spawn-command shape
- **architect/SKILL.md §7c** rewritten with decision-table-driven template resolution (slug → `.claude/templates/dev-multi-tier-{slug}.mjs.template`); hard-fails on unknown slug
- **architect.md self-verify item 13**: post-scaffold check + auto-fix on missing scripts/dev.mjs for multi-tier projects
- **ArchitectOutputSchema** + tests gain `scaffoldedFiles: z.array(z.string()).default([])` (contracts 408→409)
- **Phase A.5 syntactic validation**: `node --check` passes on all 4 templates
- **Tests**: orchestrator 617/617 still passing

### Wave 1 — bug-041 Phase A+B+C (commit `b5ebb07`)

- **Phase A**: synthesizer (scripts/synthesize-flow-e2e.mjs) gains `errors[]` output array + post-flight check that reads playwright.config.ts content + asserts webServer: substring present; pushes hard error when absent; orchestrator/src/build-to-spec-verify.ts surfaces synth errors[] + warnings[] via `synth ERROR:` / `synth:` prefixes
- **Phase B**: react-next + svelte-kit SKILL.md §3a restructured — webServer block lifted into top-level "§3a.1 Required playwright.config.ts template — COPY VERBATIM" subsection with explicit MANDATORY label + stack-keyed decision table (Strategy A → "pnpm exec next dev" or "pnpm exec vite dev"; Strategy C/D → "node ../../scripts/dev.mjs"; absent/unknown → safe-default multi-tier)
- **Phase C**: web-frontend-builder.md self-verify item 6 — when task wrote apps/web/playwright.config.ts, immediately read back + grep for `webServer:`; auto-fix from §3a.1 decision table
- **Tests**: orchestrator 617→620 (+3 bug-041 cases)

### Wave 1 — bug-042 Phase A.5+A+B+C (commit `15b7d28`)

- **Phase A.5**: uniform `/test/seed-baseline` endpoint contract added to all 3 shipped backend SKILL.md (node-fastify, python-fastapi, node-trpc-nest); endpoint wraps the project's canonical db/seed.{ts,py}
- **Phase B**: testing-policy.md gains §Strategy-C-test-seed-contract section documenting cross-stack canonical contract (3 endpoints uniform across stacks)
- **Phase A**: synthesizer emits `apps/web/playwright/required-baseline.json` for Strategy C projects with `{strategy, persistenceLayer, callSeedBaseline:true, readOnlyFlowCount, mutationFlowCount}`; MVP signal (selector→table inference deferred — multi-day scope, signal is enough to unblock Phase C)
- **Phase C**: playwright-global-setup.ts.template rewritten — reads required-baseline.json signal, POSTs /test/seed-baseline when callSeedBaseline=true, falls through to additive seedFixtures(); seed-db.ts.template gains seedBaseline() helper
- **Tests**: orchestrator 620/620 still passing (no regression)

### Wave 2 — empirical end-to-end on finance-track-01 (uncommitted; project-side patches inside `projects/finance-track-01/` invisible to factory git per `agenticVisibility: private`)

- **Step 1 inventory**: scripts/dev.mjs already present (Wave 1 leftover from bug-040 smoke-test copy — node-fastify variant); webServer absent in playwright.config.ts; test-seed.ts has /seed + /cleanup but no /seed-baseline; no .env files
- **Step 2** patched `apps/web/playwright.config.ts` with the Strategy C webServer block per react-next SKILL.md §3a.1 (command="node ../../scripts/dev.mjs", url=http://localhost:3000, env block injects DATABASE_PATH/PORT/ENABLE_TEST_SEED/etc)
- **Step 3** added /test/seed-baseline route to `apps/api/src/routes/test-seed.ts` wrapping src/db/seed.ts's seed() function
- **Step 4** rewrote `apps/web/playwright/global-setup.ts` to call /test/cleanup → /test/seed-baseline → /test/seed (additive fx_cache + settings) — empirical run order
- **Step 5** ran `pnpm install` (multipart/static/papaparse were declared but uninstalled); ran `tsx src/db/migrate.ts` against `./data/finance-track-test.db` (file created, 61KB, schema applied)
- **Steps 6-7** smoke-test: dev.mjs booted both halves (backend on 3001, frontend on 3000); /api/health=200; /test/seed-baseline=204; /api/accounts returned 3 active accounts (US Checking USD, UK Current Account GBP, Japan Wallet JPY); /api/transactions returned 174+ transactions across 12 months × 3 currencies
- **Hand-written flow-3 spec**: failed at step 7 with `expect(toHaveURL(/^\//))` regex-vs-absolute-URL authoring bug (NOT a seeding symptom; was step 2 "Card not found" pre-fix)
- **Synthesized flow-3 spec**: failed at interaction 4+ with `waiting for locator('role=button[name="Display currency"]')` selector mismatch (NOT a seeding symptom; was interaction 2 "No accounts yet" page snapshot pre-fix)
- **Page snapshot from synthesized failure CONFIRMS populated dashboard**: heading "Dashboard", subtitle "May 2026 · normalized to EUR", full nav (Dashboard/Accounts/Transactions/Reports/Settings), branded "finance·track" header — vs 2026-05-02 which showed only "No accounts yet" empty-state heading + "Add account" button

## Current state

- Branch: `feat/quota-observability` at `15b7d28` (4 new commits this session: 78d8038, ec1af9e, 5a69eee, b5ebb07, 15b7d28)
- Tests: orchestrator 620/620; orchestrator-contracts 409/409 (was 607 + 408 at session start; +13 + +1 across bug-040/041/042/043)
- Uncommitted (factory): 0 (only the long-standing scripts/\_tmp-\*.mjs files which predate this session)
- Uncommitted (finance-track-01 project, invisible to factory git): playwright.config.ts (webServer block added), apps/api/src/routes/test-seed.ts (/seed-baseline route added), apps/web/playwright/global-setup.ts (calls /test/seed-baseline first), data/finance-track-test.db (migrated, populated via /seed-baseline)
- Quota: not measured this session; should run `/quota-status --all` at next session start
- Blockers: NONE for the seeding-pipeline fix. Subsequent test failures are real authoring/synthesizer/product issues, no longer seeding symptoms.

## Next steps

1. **Commit project-side patches** to finance-track-01's git (the project has its own git repo; factory git won't see these per agenticVisibility:private). Files: scripts/dev.mjs (Wave 1 leftover), apps/web/playwright.config.ts (webServer block), apps/api/src/routes/test-seed.ts (seed-baseline route), apps/web/playwright/global-setup.ts (seed-baseline call). Could be one commit "Wave 2 seeding-pipeline recovery."
2. **Archive bug-040 / bug-041 / bug-042 / bug-043 plans** to plans/archive/ with outcome=success now that all 4 factory phases shipped + empirical validation passed. Update plans/active.md.
3. **File new follow-up plans** for the genuine product/test-authoring bugs surfaced post-Wave-2:
   - hand-written flow-3 step 7 URL-regex bug (`expect(toHaveURL(/^\//))` vs absolute URL — likely tester-side fix)
   - synthesized flow-3 interaction 4 selector mismatch (`role=button[name="Display currency"]` doesn't exist — synthesizer-side selector inference improvement, OR product-side button name change, OR tester adjustment to use the actual button name from the rendered page)
4. **Re-run /build-to-spec-verify on finance-track-01** with `--bugs-yaml-mode=fresh` (archives the 16 false-positive bugs, files only the real ones surfaced post-Wave-2). Should converge in 1-3 fix-loop iterations on a much smaller surface.
5. **Roll forward** to book-swap (the next Mode B candidate) — Strategy C, real-DB, will exercise the new factory pipeline end-to-end on a fresh project.
6. **Optional Phase D follow-ups** (deferred this session, defense-in-depth): verifier seed-missing classifier (bug-042 Phase D), orchestrator post-feature-merge webServer check (bug-041 Phase D), orchestrator post-architect spawn-shape sanity check (bug-040 Phase C). Lower priority — empirical run shows current factory-side enforcement is sufficient.

## Open questions

- **Should bug-040/041/042/043 plans archive together as a single batch** (cohesive narrative) **or individually** (independent retry budgets)? They each shipped to success — archive batch makes sense; individual makes git history cleaner.
- **finance-track-01's playwright.config.ts webServer block hardcodes ENABLE_TEST_SEED=1 + DATABASE_PATH** — should this become factory template policy (per react-next SKILL.md §3a.1) or stay project-specific? Probably factory, since every Strategy C project will need this exact env block.
- **Synthesizer's `role=button[name="Display currency"]` selector guess** — is this a synthesizer-improvement opportunity (cross-ref docs/screens/{screen}.html for actual button names) or a synthesizer-is-fine-the-test-needs-tweaking thing? Worth investigating before committing to a fix path.
- **bug-040 Phase C (orchestrator post-architect spawn-shape sanity check)** was deferred — should it land now as defense-in-depth or stay deferred? Empirical run worked fine without it; data point against urgency.
- **Should `/test/seed-baseline` shipping in the contract be a CHECK in the synthesizer** ("backend has /test/seed-baseline route?" → hard error if absent on Strategy C projects)? Mirror of bug-041 Phase A's webServer check. Probably yes — file as a follow-up.

## Key files touched

### Factory (committed this session — 5 commits)

#### `78d8038` plans: refine bug-040 + bug-042 + file bug-043

- `plans/active/bug-040-architect-skips-scripts-dev-mjs-emission-step.md` — added Phase A.5 + threaded stack-awareness
- `plans/active/bug-042-global-setup-baseline-only-seeds-fx-cache.md` — added Phase A.5 + uniform contract
- `plans/active/bug-043-orchestrator-dev-server-spawn-command-fastapi-only.md` — NEW
- `plans/active.md` — manifest refresh

#### `ec1af9e` fix(dev-server): bug-043 Phase A+B+D

- `orchestrator/src/dev-server.ts` — STACK_BACKEND_SPAWN_COMMAND table + resolveBackendSpawnSpec + readBackendFrameworkSlug shared helper + stack-aware bootDevServer error
- `orchestrator/tests/dev-server.test.ts` — +10 regression tests
- `plans/active/bug-043-...md` — status: draft → approved

#### `5a69eee` feat(architect): bug-040 Phase A.5+B

- `.claude/templates/dev-multi-tier-python-fastapi.mjs.template` — RENAMED from dev-multi-tier.mjs.template
- `.claude/templates/dev-multi-tier-node-fastify.mjs.template` — NEW
- `.claude/templates/dev-multi-tier-node-trpc-nest.mjs.template` — NEW placeholder
- `.claude/templates/dev-multi-tier-node-express.mjs.template` — NEW placeholder
- `.claude/skills/agents/back-end/python-fastapi/SKILL.md` — §dev-orchestrator pointer
- `.claude/skills/agents/back-end/node-fastify/SKILL.md` — §dev-orchestrator pointer
- `.claude/skills/agents/back-end/node-trpc-nest/SKILL.md` — §dev-orchestrator pointer
- `.claude/skills/architect/SKILL.md` — §7c rewritten with decision-table-driven resolution
- `.claude/agents/architect.md` — self-verify item 13 + scaffoldedFiles[] in return JSON
- `packages/orchestrator-contracts/src/architect.ts` — scaffoldedFiles field
- `packages/orchestrator-contracts/tests/architect.test.ts` — +1 case

#### `b5ebb07` feat(synth+web-builder): bug-041 Phase A+B+C

- `scripts/synthesize-flow-e2e.mjs` — errors[] output + webServer presence check
- `orchestrator/src/build-to-spec-verify.ts` — surfaces synth errors[] + warnings[]
- `orchestrator/tests/synthesize-flow-e2e.test.ts` — +3 cases
- `.claude/skills/agents/front-end/react-next/SKILL.md` — §3a.1 COPY VERBATIM template + decision table
- `.claude/skills/agents/front-end/svelte-kit/SKILL.md` — same restructure
- `.claude/agents/web-frontend-builder.md` — self-verify item 6

#### `15b7d28` feat(test-seed-baseline): bug-042 Phase A.5+B+C

- `.claude/skills/agents/back-end/node-fastify/SKILL.md` — §3 /test/seed-baseline route + builder responsibilities updated
- `.claude/skills/agents/back-end/python-fastapi/SKILL.md` — same shape
- `.claude/skills/agents/back-end/node-trpc-nest/SKILL.md` — same shape
- `.claude/rules/testing-policy.md` — §Strategy-C-test-seed-contract section
- `.claude/templates/playwright-global-setup.ts.template` — reads required-baseline.json + POSTs /test/seed-baseline
- `.claude/templates/seed-db.ts.template` — seedBaseline() helper + 3-endpoint contract docblock
- `scripts/synthesize-flow-e2e.mjs` — emits required-baseline.json + signal in JSON output

### Project finance-track-01 (uncommitted — invisible to factory git)

- `scripts/dev.mjs` — Wave 1 leftover; node-fastify variant of the new template
- `apps/web/playwright.config.ts` — webServer block (Strategy C, dev.mjs command, env injection)
- `apps/api/src/routes/test-seed.ts` — /seed-baseline route added (wraps src/db/seed.ts seed())
- `apps/web/playwright/global-setup.ts` — calls /test/cleanup → /test/seed-baseline → /test/seed (additive)
- `data/finance-track-test.db` — migrated, populated via /test/seed-baseline (3 active accounts + 174+ transactions)
- `node_modules/` — populated via pnpm install (multipart/static/papaparse were declared but missing)

## Decisions made

- **Per-stack templates (fix-shape B) over runtime-stack-aware single template (A) or stack-skill-embedded (C)** for bug-040 — chose B because: (1) most factory templates already follow the per-strategy/per-stack pattern (playwright-global-setup, seed-db, etc); (2) ~400 lines of cross-platform plumbing is much cleaner as standalone files than embedded in 4 SKILL.md prose blocks; (3) adding a new backend = 1 new template file + 1 SKILL.md pointer line, scales linearly. C would have inflated each backend SKILL.md by 400 lines of duplication.
- **Filed bug-043 SEPARATELY rather than folding into bug-040** — different surfaces (orchestrator runtime TS vs project scaffold templates), different agent_sequence, different retry budgets. Mirrors precedent set by bug-037/038/039 (sister bugs filed independently even though they shipped together).
- **Wave 0 sequencing: bug-043 SOLO first, then bug-040+041+042 parallel-ish, then Wave 2 empirical** — chose smart middle path between sequential (slow but easy bisection) and all-parallel (fast but bad failure mode). bug-043 was smallest scope + highest leverage (unblocked verifier auto-boot for any non-FastAPI project). Validated cheaply before committing larger Wave 1 surface.
- **bug-042 Phase A MVP: required-baseline.json as SIGNAL, not selector→table inference** — chose MVP because the plan's Phase A vision (full selector→table inference cross-referencing screen mockups + data-models.yaml) was multi-day scope; signal is enough to unblock the load-bearing Phase C global-setup template. Selector inference deferred as feat-future depth.
- **/test/seed-baseline as a NEW endpoint wrapping existing seed()** rather than refactoring global-setup to manually duplicate fixture data — chose endpoint because: (1) global-setup needs ~150 lines of accounts+transactions otherwise; (2) /test/seed-baseline + canonical seed() converge on ONE source of truth (CLI db:seed and global-setup both invoke the same function); (3) tracks bug-119 lesson about "two duplicate fixture sets is one too many."
- **Wave 2 used existing finance-track-01 project as test bed** rather than creating a fresh smoke project — chose existing because: (1) it's the empirical case the bugs were filed against; (2) it has the actual brief + flow specs to validate against; (3) creating a fresh project would require running /architect + /pm + Mode B = $30-80 extra. Project-side patches are explicitly OK per checkpoint plan ("manual project-side recovery for finance-track-01" was step 1 of the deferred work).
- **Phase C/D defense-in-depth deferred for all 4 bugs** — empirical Wave 2 success means the load-bearing fixes (Phase A.5+A+B for each) are sufficient; Phase C/D adds blast-radius reduction we don't have empirical evidence we need. Better to ship and validate, then come back if drift surfaces.
- **Smoke-test Phase E for bug-043 used a one-shot vitest file** (orchestrator/tests/\_tmp-bug043-real-projects.test.ts, deleted after pass) rather than a permanent regression test — the synthetic-fixture Phase D tests already cover the lane; Phase E was just "does this work against real project files." One-shot keeps the test suite focused.
