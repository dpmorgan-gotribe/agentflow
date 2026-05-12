---
session-id: "20260503-045718"
timestamp: 2026-05-03T04:57:18Z
agent: human
task-id: null
previous-context: 20260503-023937-human-synthesizer-hardening-shipped-end-of-day.md
checkpoint: true
status: in-progress
---

# Context snapshot — Wave 3 synthesizer-loop hardening — 3 of 5 factory gaps shipped

## Summary

Continued from prior checkpoint (20260503-023937). Today's session: re-ran the verifier on finance-track-01 to surface real product bugs, exposed FACTORY-LEVEL gaps in the autonomous-fix-bugs loop, and shipped 3 narrow factory bugs end-to-end. The verifier output is now provably clean for the false-positive classes; what remains is the bigger-scope routing + classification + per-flow seed work (3 more plans filed but not implemented). Finance-track-01 reachability cleared 5 false-positive orphans → 0; synthesizer post-flight now empirically surfaces the manifest-author class for flow-2/4/9.

## Completed since last snapshot

### Project-side commit (commit `cf157ba` on `fix/bugs-yaml-iter`)

- finance-track-01: bug-044 flow-3 toHaveURL fix + 9 regenerated synthesized specs + bug-042 required-baseline.json + @playwright/test ^1.44 → ^1.59.1 + reachability-allow comment on account-create-modal

### Factory: bug-048 + bug-049 — `audit-app-reachability` false-positive flood (commit `47d3444`)

- **bug-048 (P1)** — `resolveCandidate()` couldn't handle TS-as-ESM `.js` import suffix → `from "./foo.js"` never resolved to `foo.ts`. Added 4-line suffix-swap fallback: when `.js`/`.jsx`/`.mjs`/`.cjs` literal candidate doesn't exist, try `.ts`/`.tsx`. Affects every TS-as-ESM project.
- **bug-049 (P2)** — `IMPORT_RE` only matched 3 syntactic shapes (import, dynamic-import, export-from). Config-string property values like Playwright's `globalSetup: "./..."` invisible. Added complementary `CONFIG_STRING_PATH_RE` matching relative-path string literals ending in source extensions.
- +3 fixture-driven regression tests (`js-ext-resolution`, `config-string-ref`, `baseline-orphan`); orchestrator suite 629 → 632.
- Empirical: finance-track-01 reachability 5 false-positive orphans → 0 (verified post-fix).

### 9-flow synthesized E2E run + factory-gap analysis

Ran 9 synthesized flows on finance-track-01 (Playwright auto-booted via webServer; servers cleanly shut). All 9 failed; triaged into 3 distinct classes:

| Class           | Count | Examples                                                                                                                                        | Right agent for fix                                       |
| --------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| build-gap       | 4     | flow-3 currency selector missing, flow-5 Table primitive doesn't exist in ui-kit, flow-6 Filter button missing, flow-7 /api/reports never fired | web-frontend-builder                                      |
| seed-mismatch   | 3     | flow-1 expects empty (seed has 3 accounts), flow-8 expects "USD Cash" (seed has "US Checking"), flow-9 expects "stale" (seed has fresh)         | NEEDS DECISION (re-author flow OR per-flow seed override) |
| manifest-author | 2     | flow-2 `:has-text` strict-mode trap, flow-4 `page.route` mocks browser but call originates from backend                                         | user-flows-generator regen                                |

The factory's current taxonomy (`primaryCause`) collapses 3 classes into `step-transition`; `defaultAgentSequence()` does literal `void violation;` and routes EVERYTHING to web-frontend-builder. Auto-dispatching `/fix-bugs` would misroute 5/9 bugs.

### Factory: 4 plans filed for the gaps

- **bug-050 (P1, plan only)** — verifier failure-class taxonomy + agent-routing gap. Extends primaryCause enum with build-gap/manifest-author/seed-mismatch + routes by class. Depends on feat-049's classifier.
- **feat-049 (P1, plan only)** — screens.json cross-reference for build-gap vs manifest-author classification. Builds in-memory ScreensCatalog from docs/screens/\*.json + mockup HTML DOM walk; classifySelector() helper drives the bug-050 enum widening.
- **feat-050 (P1, plan only)** — per-flow seed orchestration via manifest schema extension. Per-flow `requiredState: { kind: "baseline" | "empty" | "custom", tablesToCleanup, fixtures }`. Closes seed-mismatch class. Synthesizer emits per-flow `beforeAll`/`afterAll` calling existing /test/cleanup + /test/seed (bug-042 contract).
- **bug-051 (P2, FULLY SHIPPED in commit `db79046`)** — /user-flows-generator selector quality. SKILL.md §4b gains 2 anti-pattern callouts: `:has-text` strict-mode trap + `page.route` browser-vs-backend mock-layer. Synthesizer post-flight gains `detectHasTextStrictModeTrap` (hard error) + `isLikelyBackendOriginatedMock` (warning, allowlist of 8 known backend APIs: frankfurter, openai, anthropic, plaid, stripe, etc.). +4 regression tests (632 → 636). Updated existing bug-046 valid-chain test to terminate with `[name=...]`.

### Empirical bug-051 validation against finance-track-01

Re-ran synthesizer post-fix:

- **flow-2** strict-mode trap → `errors[0]` (correct)
- **flow-4** frankfurter mock → `warnings[0]` (correct)
- **flow-9** frankfurter mock → `warnings[1]` (BONUS — bug-051 lint caught a 3rd case missed in initial triage; flow-9's PRIMARY failure is still seed-mismatch, but the manifest also has the mock-layer issue)

## Current state

- Factory branch: `feat/quota-observability` at `db79046` (2 new commits this session: 47d3444, db79046)
- Tests: orchestrator 636/636 (was 629; +7 across bug-048/049/051). Contracts unchanged.
- Uncommitted (factory): 0 (only the long-standing `scripts/_tmp-*.mjs` files which predate this session)
- finance-track-01 branch: `fix/bugs-yaml-iter` at `cf157ba` (1 new commit this session)
- Quota: not measured this session
- Blockers: NONE for this checkpoint. The remaining 3 factory plans (bug-050, feat-049, feat-050) are multi-day scope work not started yet.

## Next steps

1. **Continue Wave 3 — ship feat-049 (screens.json catalog).** This is the FOUNDATION for bug-050's classifier widening. Without it, bug-050 Phase B routing has nothing to route on. Estimated: 3-4 hours focused work. Phase A (catalog builder) → Phase B (classifySelector helper) → Phase C (plumbing) → Phase D (/screens SKILL.md tightening).
2. **Then feat-050 (per-flow seed orchestration).** Independent of feat-049. Estimated: 3-4 hours. Phase A (manifest schema) → Phase B (synthesizer emission) → Phase C (backend partial-fixture audit) → Phase D (SKILL.md guidance) → Phase E (empirical re-validate finance-track-01 flows 1+8+9).
3. **Then bug-050 (taxonomy + routing).** Builds on feat-049 + ships the new agentSequence routing. Estimated: 2 hours.
4. **finance-track-01 project-side recovery — defer to AFTER factory work lands:**
   - 4 build-gap bugs need filing + fix (flow-3 currency selector / flow-5 Table primitive / flow-6 Filter button / flow-7 Reports fetch). With bug-050 routing in place, these will auto-route to web-frontend-builder cleanly.
   - 3 seed-mismatch flows need re-author with `requiredState` (per feat-050 schema). Project-side commit.
   - 2 manifest-author flows need /user-flows-generator regen (now SKILL.md + lint catch the issues at synthesis time).
5. **Subsequent: roll forward to book-swap.** With factory Wave 3 fully shipped, book-swap should be the cleanest end-to-end run yet.

## Open questions

- **Is feat-049's scope right?** Building a ScreensCatalog from BOTH screens.json AND mockup HTML DOM-walk doubles the parse work. Could simplify to mockup-DOM-only since that's higher-fidelity (actually-rendered elements). Trade-off: less authoritative source-of-truth attribution. Lean: ship both, the marginal cost is small + redundancy is healthy.
- **Should bug-050 Phase B (routing) ship without feat-049?** Routing change alone would mean: keep current `step-transition` catch-all routing + add explicit handling for `seed-setup` (already exists). This is mostly a no-op until classifier widens. Probably skip — wait for feat-049.
- **Should we run /quota-status before next session's big work?** Tomorrow's feat-049 + feat-050 implementations could burn $20-50 in agent dispatch + tests if anything goes wrong. Pre-flight would be wise.
- **Project-side bugs filing — wait for factory routing OR file now?** Filing now means manually setting `agentSequence: [web-frontend-builder, ...]` for the 4 build-gap bugs (correct route already today). For the 3 seed-mismatch bugs, no clean target exists today. Lean: defer until factory routing in place.

## Key files touched

### Factory commit `47d3444` (bug-048+049 analyzer fix)

- `scripts/audit-app-reachability.mjs` — `resolveCandidate()` `.js → .ts` swap + `CONFIG_STRING_PATH_RE` post-flight
- `orchestrator/tests/audit-app-reachability.test.ts` — 3 fixture-driven tests (NEW)
- `orchestrator/tests/fixtures/audit-app-reachability/{js-ext-resolution,config-string-ref,baseline-orphan}/` — fixture trees (NEW)
- `plans/active/bug-048-...md` + `plans/active/bug-049-...md` (NEW)

### Factory commit `db79046` (Wave 3 — bug-051 ship + plans)

- `.claude/skills/user-flows-generator/SKILL.md` — §4b expanded with 2 new anti-pattern callouts (`:has-text` trap + mock-layer guidance)
- `scripts/synthesize-flow-e2e.mjs` — `detectHasTextStrictModeTrap` (hard error) + `isLikelyBackendOriginatedMock` (warning) post-flight checks
- `orchestrator/tests/synthesize-flow-e2e.test.ts` — +4 bug-051 tests; updated bug-046 valid-chain test to terminate with `[name=...]`
- `plans/active/bug-050-...md` + `plans/active/bug-051-...md` + `plans/active/feat-049-...md` + `plans/active/feat-050-...md` (4 NEW)
- `plans/active.md` — manifest +4 rows

## Decisions made

- **Filed FOUR factory plans before implementing any** — preserved investigation context in plan documents so the implementations can be paced across sessions without losing fidelity. Trade-off: front-loads documentation effort, but bug-046+047 archive lessons proved this approach pays back via clean Phase organization.

- **Shipped bug-051 first, deferred bug-050/feat-049/feat-050** — bug-051 was smallest + had immediate empirical impact (closes manifest-author class at the SOURCE for future projects, before E2E even runs). bug-050 routing is useless without feat-049 classifier; feat-049 + feat-050 are multi-hour each. Better to checkpoint cleanly than rush brittle implementations of feat-049/050.

- **Mock-layer warning targets backend-originated APIs only** — chose narrow allowlist (8 known backend services: frankfurter, openai, anthropic, googleapis, plaid, stripe, openexchangerates, fixer) instead of broad heuristic. Trade-off: misses unknown backend APIs but ZERO false positives on browser-originated mocks. Future projects whose backend hits a new external can extend the allowlist.

- **Updated existing bug-046 "valid chain" test under bug-051 contract** — that test was empirically invalid under bug-051's stricter selector contract (the chained `>> role=button` without `[name=...]` is exactly the strict-mode trap). Test now uses `>> role=button[name="Import CSV"]` — passes under both bug-046 + bug-051 contracts.

- **Bonus discovery: flow-9 also has mock-layer issue** — initial triage classified flow-9 purely as seed-mismatch, but the bug-051 lint also flagged its `api.frankfurter.app` mock. Both issues exist; the seed-mismatch is the LOAD-BEARING failure (test never gets to the mock-impacted step), but the mock-layer issue is real and will surface once seed-mismatch is fixed. Lesson: lints often catch issues beyond the surfaced failure case — preventative scoping.

- **Two-commit boundary** — kept bug-048+049 (analyzer fixes) separate from bug-051+plans (Wave 3 hardening). Easier to revert one without the other; clearer git log narrative; bug-048+049 are tactical false-positive fixes while Wave 3 is strategic loop-closing work.
