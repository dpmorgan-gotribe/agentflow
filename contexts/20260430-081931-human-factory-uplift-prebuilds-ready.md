---
session-id: "20260430-081931"
timestamp: 2026-04-30T08:19:31Z
agent: human
task-id: investigate-012-factory-readiness-pre-builds
previous-context: 20260430-034811-human-feat-038-complete-and-projects-synced.md
checkpoint: true
status: checkpoint
---

# Context snapshot — human — factory uplift; both pre-builds ready for /start-build

## Summary

Major factory-uplift session executing investigate-012's validate-first roadmap. Authored + approved investigate-012 (12-step roadmap, 8-dim rubric, 4 cross-cutting blockers identified). Shipped 5 factory features end-to-end (feat-039 mock InteractionStep kind, feat-040 webServer wiring per stack-skill, feat-041 node-trpc-nest §Testing Strategy C, feat-042 node-fastify stack skill from scratch, bug-033 dev.mjs env propagation) plus testing-policy.md hardening (bug-119 class). First validation target proven: `repo-health-dashboard-01` reached 90/100 against the rubric (manual-sanity dim deferred). Both pre-build targets (book-swap-pre-build, finance-track-pre-build) now have all factory-side requirements met for /start-build; remaining blockers are HITL design-pipeline runs (gates 3/4/5 for book-swap, gate-4 for finance-track).

## Completed since last snapshot

- **investigate-012 authored + approved**. 8-dimension rubric defined with weights (Mode A 10 / Mode B 15 / Reach 10 / Parity 15 / Flow E2E 20 / Coverage 10 / Verifier 10 / Manual sanity 10 = 100). 4 cross-cutting blockers confirmed: H1 mock-kind missing, H2 Strategy C empirically unproven, H3 Playwright webServer wiring inadequate, **H4 (NEW) node-fastify stack skill missing entirely**. 12-step validate-first roadmap with operator-locked decisions: advisory gating, all 4 pre-builds in scope, kanban-09 first then repo-health-01, retries 0→1, manual-sanity 10% with anti-rubber-stamp, F3a wired regardless.
- **feat-044 abandoned**. kanban-webapp-09 had 100+ uncommitted source modifications + 18 broken unit tests (mid-rework refactor that didn't finish). Operator pivoted; kanban-webapp-pre-build /start-build (roadmap step 11) will produce a clean kanban instead. Phase A+B carryovers preserved: HomeBoardView dynamic-import fix to CardDetailModal (real bug fix; isomorphic-dompurify SSR pulled jsdom which 500'd dev server), seed-localstorage helper, 10 v2.0 flow specs.
- **feat-039 shipped (mock InteractionStep kind / F1)**. Added `MockInteractionStep` to discriminated union in packages/orchestrator-contracts/src/user-flows-manifest.ts with Zod fields (urlPattern, status 100-599, body string|object, optional contentType + method). Synthesizer (scripts/synthesize-flow-e2e.mjs) emits `await page.route(new RegExp(urlPattern), (route) => { method check; route.fulfill(...) })`. RegExp not glob — critical when SPA uses NEXT_PUBLIC_API_BASE-prefixed absolute URLs (the bug we'd otherwise hit). Synced JSON schema to all 12 projects. New strategy-d-with-mock fixture + structural assertion that mock precedes navigate. /user-flows-generator SKILL.md §4b extended with mock-authoring worked example. Tests: 398→404 contracts (+6), 576→578 orchestrator (+2). SKILL.md synced manually to 5 explicit-target projects.
- **feat-045 shipped — repo-health-dashboard-01 to 90/100** (manual-sanity 0/10 deferred). Full progression: Phase A (interactions[] for 8 flows; flows 1-3+7-8 attempted live, then converted to mocks after the GitHub rate-limit footgun) + Phase B (8/8 synthesized E2E pass in 13.3s with retries=1) + Phase C (vitest 95.29% web + pytest 97% api coverage; reachability 0 orphans; vitest config bumped to exclude `.next.broken*` patterns) + Phase D deferred + Phase E hand-computed score = 90. **Critical fix mid-Phase B**: HomeBoardView statically imported CardDetailModal which transitively pulled isomorphic-dompurify → jsdom into SSR; dev server 500'd on every / request. Fix: dynamic-import with `ssr: false` (real product bug; carried).
- **bug-033 shipped — `scripts/dev.mjs` env propagation (factory-wide)**. Surfaced live during feat-045 Phase B: live FastAPI returning 429 because GITHUB_TOKEN in `.env.local` wasn't reaching the subprocess (Node doesn't auto-load `.env.local`; Next does, but only its own process, not its spawned siblings). Added `parseEnvFile()` + `loadEnvFiles()` to `.claude/templates/dev-multi-tier.mjs.template`: loads `.env` then `.env.local` (latter wins), with `process.env` overriding both. Added `redactEnvForLog()` so boot log shows secrets-loaded count without values. Spread MERGED_ENV into both backend + frontend spawn env. Caught a frontend port-collision side effect (`.env.local PORT=4000` bled into Next via MERGED_ENV → both halves bound :4000); fix: explicit `PORT: String(FRONTEND_PORT)` for frontend spawn. **Validated live**: `curl http://localhost:4000/api/report/facebook/react` returns 200 with `rate_limit.remaining: 4998` (authenticated 5000/hr bucket), confirming token reaches FastAPI.
- **Testing-policy hardening — bug-119 class (factory-wide)**. New section in `.claude/rules/testing-policy.md`: "External-API tests must mock the upstream — CONSTRAINT". Includes empirical motivation, what-must-be-mocked list, approved primitives by stack (pytest-httpx / vi.spyOn / page.route via feat-039 mock kind), narrow LIVE_API=1 escape hatch, required tester behavior. Synced to all 12 projects.
- **bug-119 plan filed (project-level, repo-health-01)**. `test_ssrf_guard_rejects_malformed_segments[foo%2e%2e-etc]` fails when GitHub upstream is rate-limited — runs full pipeline against real GitHub instead of mocking. Fix approach: pytest-httpx mock + `assert httpx_mock.get_requests() == []` to prove SSRF guard rejects before upstream call. Drafted; not implemented (project-side; can be picked up by /fix-bugs once filed in bugs.yaml).
- **feat-041 shipped — node-trpc-nest §Testing block (Strategy C declaration)**. Added section after existing §3 mirroring python-fastapi §3 structure. Documents `/test/seed` + `/test/cleanup` Nest controller contract with Zod schemas, ENABLE_TEST_SEED=1 env gate, MODEL_REGISTRY allow-list pattern, builder + tester responsibilities. Plus the bug-119-class mocking constraint inline. Synced to book-swap-pre-build + book-swap. Unblocks book-swap Mode B.
- **feat-042 shipped — node-fastify stack skill (NEW, from scratch)**. Authored `.claude/skills/agents/back-end/node-fastify/SKILL.md` from scratch — 8 sections: §1 canonical layout (fastify factory + plugin pattern + better-sqlite3 db plugin + migrations dir), §2 idioms (one plugin per domain, pure-function services, sync transactions, AppError), §3 testing (vitest + app.inject() + Strategy C contract for fastify), §4 commands, §5 gotchas (better-sqlite3 native binding, sync DB in async handlers, WAL mode, Zod parse vs safeParse, env validation at boot, webhook raw body), §6 deps (fastify 5 / better-sqlite3 11.5 / fastify-type-provider-zod), §6.5 cross-tier conventions, §7 anti-patterns, §8 references. Synced to finance-track-pre-build + finance-track. Unblocks finance-track Mode B.
- **feat-040 shipped — webServer wiring per stack-skill**. Updated react-next + svelte-kit SKILL.md §Testing playwright.config.ts templates to declare `webServer.command="node ../../scripts/dev.mjs"` for multi-tier (Strategy C/D); `pnpm exec next dev` (or vite dev) for Strategy A. Bumped retries 0→1 for live-backend specs. Synced to all 12 react-next consumers (no svelte-kit consumers today; preventive update).
- **feat-043 drafted — score gating (F6)**. Plan only; not implemented. Specifies `/build-to-spec-verify` extension to compute the 8-dim score → `docs/build-to-spec/score.json` with verdict (≥95 ship-ready / 90-94 needs-itemized / <90 needs-major-revision). ADVISORY only per operator decision. Optional; the rubric is hand-computable today.
- **All factory plans authored + tracked in active.md** for traceability per operator request: feat-039 to feat-043 + bug-033 + investigate-012 + feat-044 (abandoned) + feat-045.

## Current state

- Branch: feat/quota-observability (8fac92c)
- Tests: 404/404 contracts + 578/578 orchestrator passing (was 398/398 + 576/576 at session start; +6 contracts mock-kind tests, +2 orchestrator mock-fixture assertions)
- Uncommitted: 23 items — all from this session's factory work + plan files. Modified: testing-policy.md, node-trpc-nest SKILL.md, react-next SKILL.md, svelte-kit SKILL.md, user-flows-generator SKILL.md, dev-multi-tier.mjs.template, synthesize-flow-e2e.mjs + tests, user-flows-manifest.ts + tests, schemas/user-flows-manifest.schema.json, plans/active.md. New: node-fastify SKILL.md dir, strategy-d-with-mock fixture dir, 8 plan files (investigate-012, feat-039 to 045, bug-033).
- Project state on repo-health-dashboard-01: 90/100. apps/web HomeBoardView.tsx dynamic-import fix not yet committed; user-flows-manifest.json v2.0 with 8 flows; synthesized specs all-mock; vitest.config.ts excludes .next.broken\* added; bug-119 plan filed.
- Project state on finance-track-pre-build: gates 2,3,5 done; gates 1+4 missing markers (gate-1 marker file lost but artefacts exist; gate-4 needs /screens + /user-flows-generator + signoff). 9 flows authored, 0/9 with interactions[].
- Project state on book-swap-pre-build: gates 1,2 done; gates 3,4,5 missing. tasks.yaml exists but pre-design-pipeline.
- Live dev server: was running for repo-health-01 demonstration (Next on 3000, FastAPI on 4000) at session end — unclear whether still up after my final messages.
- Blockers: none factory-side. Next-step blockers are HITL design-pipeline skills.

## Next steps

1. **Commit today's factory work**. Significant uncommitted state: 23 items spanning the testing-policy hardening, 5 stack-skill updates, dev.mjs template fix, schema bump, fixture, 8 plan files. Commit in logical batches: (a) factory rule + skill + template updates; (b) plan files; (c) per-project syncs. Run a typecheck + tests pass before committing to confirm nothing regressed.
2. **Stop the running repo-health-01 dev server if still up** — it was launched in the background at task ID b5hzykhf1; check `netstat -an | grep -E ":3000|:4000"` and kill PIDs if needed before next session boots fresh.
3. **Push finance-track-pre-build through gate-4** (closer to /start-build): touch docs/gate-1-approved.txt to repair the marker, run /screens to backfill any missing screens, run /user-flows-generator to author interactions[] for the 9 flows, operator approves gate-4 signoff, run /pm --mode=tasks to refresh tasks.yaml against the v2.0 manifest. Then `/start-build finance-track-pre-build` — first true autonomous Mode B + fix-bugs validation.
4. **Push book-swap-pre-build through gates 3-5** (full design pipeline): /stylesheet → /screens → /user-flows-generator → operator approves gate-4 → /architect → operator drops credentials-confirmed.txt → /pm --mode=tasks → /start-build. ~3-4 sessions of HITL skill work.
5. **Decide on bug-119 (project-level SSRF test fix)**: file in repo-health-01's docs/bugs.yaml + run /fix-bugs OR have a future builder dispatch pick it up. Project-side, not factory.
6. **Decide on feat-043 (score gating automation)**. Drafted but not implemented. Hand-computation works for 6 projects. If/when running 10+, automation pays off. Defer until empirical signal.

## Open questions

- **finance-track gate-1 marker** — file is missing but analysis artefacts (9 flows, personas, selected-style.json) exist. Was the file deleted in a prior session, or did /analyze never write it for that project? If the latter, /analyze may need to re-run to author the marker properly. If the former, a touch is sufficient.
- **Tasks.yaml staleness** — both pre-builds have tasks.yaml from earlier sessions. Post-feat-038 + feat-039 + feat-040, the PM agent's task graph may need updating to reflect the new test-seed feature + the new webServer scaffolding step. Re-run /pm --mode=tasks after each project's gate-4 to refresh.
- **Architect re-run on finance-track-pre-build** — gate-5 (credentials-confirmed.txt) exists but architect.yaml was authored pre-bug-033 + pre-feat-040 + pre-feat-042. The architect MAY need to re-run to pick up: (a) MERGED_ENV-aware dev.mjs (already templated), (b) the new node-fastify skill's scaffold templates, (c) feat-040's webServer wiring guidance. Need to check architecture.yaml's `scaffolding_version` or similar versioning hint to decide.
- **Should we delete `.next.broken*/` directories** in repo-health-01 after the rubric is settled? They consume disk + drag tooling. Or keep as forensic record of the SSR fix path?
- **Does book-swap-pre-build's tasks.yaml predate the v2.0 manifest** + the new `test-seed-endpoint` feature concept? Almost certainly yes (size 55K, dated). Re-run of /pm --mode=tasks expected after the design pipeline finishes.

## Key files touched

### Factory side

- `.claude/rules/testing-policy.md` — added "External-API tests must mock the upstream — CONSTRAINT" section (bug-119 class)
- `.claude/skills/agents/back-end/node-trpc-nest/SKILL.md` — extended §3 with Strategy C declaration + /test/seed Nest controller contract + ENABLE_TEST_SEED gate (feat-041)
- `.claude/skills/agents/back-end/node-fastify/SKILL.md` — NEW, 8 sections, authored from scratch (feat-042)
- `.claude/skills/agents/front-end/react-next/SKILL.md` — webServer.command per persistence_layer + retries 0→1 (feat-040)
- `.claude/skills/agents/front-end/svelte-kit/SKILL.md` — same as react-next (feat-040)
- `.claude/skills/user-flows-generator/SKILL.md` — added `kind: "mock"` authoring rule + worked example for rate-limit synthetic state (feat-039)
- `.claude/templates/dev-multi-tier.mjs.template` — parseEnvFile + loadEnvFiles + MERGED_ENV propagation + frontend PORT scoping (bug-033)
- `packages/orchestrator-contracts/src/user-flows-manifest.ts` — added MockInteractionSchema to discriminated union (feat-039)
- `packages/orchestrator-contracts/tests/user-flows-manifest.test.ts` — 6 new tests for mock kind
- `schemas/user-flows-manifest.schema.json` — regenerated via z.toJSONSchema, mock kind included
- `scripts/synthesize-flow-e2e.mjs` — emits `page.route(new RegExp(...), (route) => { method check; fulfill })` for kind="mock"
- `orchestrator/tests/synthesize-flow-e2e.test.ts` — strategy-d-with-mock fixture entry + ordering test (mock BEFORE navigate)
- `orchestrator/tests/fixtures/synthesize-flow-e2e/strategy-d-with-mock/` — NEW fixture (architecture.yaml + manifest + expected/flow-1.spec.ts)
- `plans/active/investigate-012-...md` (NEW)
- `plans/active/feat-039-...md` through `feat-045-...md` (8 NEW plan files)
- `plans/active/bug-033-dev-mjs-env-not-propagated-to-fastapi.md` (NEW)
- `plans/active.md` — manifest updated with 9 new entries + status changes

### Project side

- `projects/repo-health-dashboard-01/apps/web/src/components/HomeBoardView.tsx` — dynamic-import for CardDetailModal (real bug; SSR was broken via isomorphic-dompurify → jsdom)
- `projects/repo-health-dashboard-01/apps/web/playwright.config.ts` — webServer.command via scripts/dev.mjs + retries=1 (de facto pre-shipment of feat-040)
- `projects/repo-health-dashboard-01/apps/web/vitest.config.ts` — added `.next.broken*/**` to coverage exclude (95.29% line cov result)
- `projects/repo-health-dashboard-01/apps/web/e2e/synthesized/flow-{1..8}.spec.ts` — regenerated against v2.0 manifest with mock-based flows
- `projects/repo-health-dashboard-01/apps/web/e2e/helpers/seed-intercept.ts` — clearMocks helper (already existed)
- `projects/repo-health-dashboard-01/docs/user-flows-manifest.json` — bumped to schemaVersion=2.0; 8 flows with interactions[] + seedingTier; flows 1/4/5/6 use kind="mock"; flows 2/3 use mocks too (rate-limit footgun)
- `projects/repo-health-dashboard-01/scripts/dev.mjs` — synced from updated factory template (bug-033 fix)
- `projects/repo-health-dashboard-01/plans/active/bug-119-ssrf-guard-test-relies-on-live-github.md` (NEW)
- All 12 projects synced via sync-project-schemas.mjs (testing-policy.md + dev-multi-tier.mjs.template)
- 5 explicit-target projects manually synced (.claude/skills/\* gitignored): repo-health-01, repo-health-pre-build, kanban-pre-build, book-swap-pre-build, finance-track-pre-build (and book-swap, finance-track for the back-end skill copies)

## Decisions made

- **kanban-09 abandoned over triage**. Operator decision when 100+ uncommitted source mods + 18 broken unit tests surfaced. The factory's value proposition is "drive a fresh /start-build to ≥95%", not "rescue a half-refactored existing project". kanban-webapp-pre-build (roadmap step 11) will demonstrate the kanban capability with clean state.
- **All-mocks strategy for repo-health-01 E2E**. Initially intended live-backend for happy paths (flows 1/2/3) + mocks for synthetic states (4/5/6). After empirically discovering the GITHUB_TOKEN propagation bug AND the resulting GitHub rate-limit chain reaction (unauth 60/hr exhausted instantly), pragmatically converted ALL 8 flows to mocks. Trade-off: doesn't exercise the real proxy → GitHub integration in synthesized E2E. Mitigation: that integration has unit tests via pytest-httpx + can be verified via manual sanity (Phase D) operator-walk. The bug-119 hardening canonicalizes this trade-off as a factory rule.
- **page.route() with RegExp not glob**. Critical synthesizer choice — `page.route("/api/report/", ...)` would be glob-matched (exact match against the path) and fail to intercept absolute URLs prefixed with NEXT_PUBLIC_API_BASE. Using `new RegExp("/api/report/")` matches anywhere in the URL string, consistent with how waitForResponse handles the same field.
- **Fronted-PORT scoping in dev.mjs**. The MERGED_ENV propagation discovered a side-effect: `.env.local PORT=4000` (intended for backend) bled into Next via MERGED_ENV → port collision. Fix: explicit `PORT: String(FRONTEND_PORT)` on frontend spawn env. Documented inline so future readers don't revert it.
- **node-fastify skill structure**. Mirrors node-trpc-nest's 8-section layout but adapted for plain fastify routes + better-sqlite3 + plugin DI (no Nest). Strategy C declaration in §3 mirrors python-fastapi §3 verbatim (test-seed contract is essentially the same; only the route-handler shape changes per framework).
- **Score gating (feat-043) deferred to draft-only**. Hand-computation works for 6 projects. The automation pays off at 10+ projects or when shipping with regular cadence. Until empirical signal, the verdict thresholds + dimension formulas live in investigate-012 §F-1 + the operator hand-computes per project.
- **finance-track is closer to /start-build than book-swap**. Initially I assumed book-swap was closer (existing skill); the fresh gate scan flipped that — finance-track has gates 2/3/5 done (just needs gate-4) while book-swap has only 1/2 done (needs full design pipeline). finance-track becomes the recommended next /start-build target.
- **Plan-traceability concession**. Authored 4 factory plans (feat-040, 041, 042, 043) upfront despite the original investigate-012 recommendation to "author per-project shepherding plans just-in-time, NOT all upfront." Operator pushed for traceability of all factory work being done; per-project shepherding plans (book-swap, finance-track, kanban-pre, repo-health-pre) remain just-in-time.
- **Live-backend retry budget bumped 0→1 across react-next + svelte-kit**. Per investigate-012 §F-5 decision. Strategy A projects can keep retries=0 (deterministic).
