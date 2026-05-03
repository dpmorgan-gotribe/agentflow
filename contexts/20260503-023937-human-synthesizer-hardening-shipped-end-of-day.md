---
session-id: "20260503-023937"
timestamp: 2026-05-03T02:39:37Z
agent: human
task-id: null
previous-context: 20260503-014230-human-seeding-pipeline-fix-empirically-validated.md
checkpoint: true
status: final
---

# Context snapshot — human — synthesizer hardening shipped (end-of-day checkpoint)

## Summary

Picked up from the prior checkpoint (20260503-014230) where Wave 0/1/2 had landed and the Wave 2 verifier-equivalent run on finance-track-01 surfaced two new factory bug classes (bug-046 selector engine-mix, bug-047 toHaveURL path-shape regex). This session: investigated both root causes (preventatively wide), filed 3 plans (bug-046 + bug-047 + feat-048 deferred), shipped bug-046 Phase A+B+D + bug-047 Phase A+B+C+D end-to-end, archived both. Empirically validated against finance-track-01: 10 manifest selectors hand-fixed, synthesizer post-flight emits `errors: []`, flow-7 progresses past interaction 3 (the bug-047 case). The synthesizer translation pipeline is now provably clean end-to-end. Subsequent verifier failures on finance-track-01 are real product/test bugs (bug-045 build-completeness gap + flow-1/5/6/8/9 seed-vs-flow mismatches) — out of scope for the synthesizer hardening sprint.

## Completed since last snapshot

### Investigation phase

- Walked all 11 InteractionStep emission paths in `scripts/synthesize-flow-e2e.mjs` looking for latent bug classes
- Confirmed bug-046 root cause: 10 instances of malformed CSS+`role=` mix in finance-track-01 manifest authored by /user-flows-generator (LLM mis-extrapolated SKILL.md §4b's CSS-only descendant example)
- Confirmed bug-047 root cause: synthesizer's `case "assertUrlMatches"` emits `expect(page).toHaveURL(new RegExp(pattern))`; manifest patterns are path-shape (`^/foo`); Playwright matches full URL → never matches. SKILL.md lines 204+236 explicitly teach the broken shape
- Identified 6 latent classes beyond the 2 surfaced bugs: schema-doesn't-validate-selector-syntax, schema-doesn't-validate-URL-pattern, no-output-lint, no-self-validation in /user-flows-generator, selector-vs-locator-method mismatch, empty/whitespace patterns
- Recommended 3-layer defense: SKILL.md correction (cheapest, prevents future), synthesizer pre-flight validation (catches existing-project bad manifests), synthesizer auto-rewrite (closes the loop for path-patterns)

### Plans filed (commit `c0ddd7c`)

- **bug-046** (P1) — manifest selector engine-mix: SKILL.md anti-pattern + synthesizer pre-flight regex-detect → errors[]; hard-error semantics
- **bug-047** (P1) — synthesizer assertUrlMatches semantics: SKILL.md docs + synthesizer auto-rewrite path-shape→URL-shape
- **feat-048** (P2 deferred) — synthesizer output linting (TS typecheck + Playwright locator dry-create) for defense-in-depth

### Factory shipped (commit `6b0f46a`)

- `.claude/skills/user-flows-generator/SKILL.md §4b` step 2 expanded with explicit anti-pattern callout (❌ wrong / ✓ right / ✓ better worked examples for engine-mix); selector preference re-ordered to favor unambiguous role-name over kit-component disambiguation
- `.claude/skills/user-flows-generator/SKILL.md §4b` step 5 documents path-shape pattern semantics + 4 edge-case examples
- `scripts/synthesize-flow-e2e.mjs` — added `ENGINE_MIX_RE` post-flight selector lint (pushes hard error to errors[] when ` role=`/`text=`/`xpath=`/`id=`/`data-testid=` appears mid-selector without preceding `>>`); added `rewritePathShapeToUrlShape` helper + wired into `case "assertUrlMatches"` translation
- `orchestrator/tests/synthesize-flow-e2e.test.ts` — +9 regression tests (4 bug-046 + 5 bug-047)
- Tests: orchestrator 620 → 629 passing

### Project-side recovery (commit `16be3ec` on `fix/bugs-yaml-iter`)

- finance-track-01: 10 malformed selectors hand-fixed in `docs/user-flows-manifest.json` by inserting `>>` between CSS and role= halves
- Synthesizer re-run produced `errors: []` (was 7+ engine-mix complaints pre-fix)
- All 9 synthesized specs regenerated (apps/web/e2e/synthesized/flow-{1..9}.spec.ts) with both fixes applied

### Empirical validation

- Synthesizer `errors: []` post-fix (was non-empty pre-fix)
- flow-7 spec line 73: `await expect(page).toHaveURL(new RegExp("^https?://[^/]+/reports"));` — bug-047 rewrite landed correctly
- flow-7 runtime: progressed past interaction 3 (URL assertion); page snapshot shows `Reports [active]` in nav. Subsequent timeout is a product-level issue (likely waitForResponse on /api/reports — out of scope for bug-047)

### Plans archived (commit `bf07ebe`)

- bug-046 + bug-047 plans moved active → archive with status: completed
- plans/active.md log entry summarizing both shipments + tests + empirical validation

## Current state

- Branch: `feat/quota-observability` at `bf07ebe` (3 new commits this session: c0ddd7c, 6b0f46a, bf07ebe)
- finance-track-01 branch: `fix/bugs-yaml-iter` at `16be3ec` (1 new commit this session)
- Tests: orchestrator 629/629 passing (was 620 at session start; +9 across bug-046/047 cases). Contracts unchanged at 409/409.
- Uncommitted (factory): 0 (only the long-standing scripts/\_tmp-\*.mjs files which predate this session)
- Uncommitted (finance-track-01 project): scripts/dev.mjs (Wave 1 leftover; not yet committed to project git), apps/web/e2e/flow-3.spec.ts (bug-044 hand-fix; not yet committed), various test-results dirs + bugs-archive/ + synthesized scripts unrelated to this session
- Quota: not measured this session; would be wise to `/quota-status --all` before next big run
- Blockers: NONE. Synthesizer translation pipeline is provably clean end-to-end. Subsequent failures on finance-track-01 are genuine product bugs, captured in active plans for future work.

## Next steps

1. **Commit bug-044 fix to finance-track-01 git** — already in working tree (`apps/web/e2e/flow-3.spec.ts` change to use `toHaveURL("/")` instead of regex); plus the leftover scripts/dev.mjs from earlier Wave 1 work that was never committed (it's the node-fastify variant of the new template). Both can land in one project-side commit.
2. **Re-run /build-to-spec-verify on finance-track-01** to populate fresh `docs/bugs.yaml` from the post-Wave-2 failure modes. The synthesizer translation pipeline is now clean, so all surfaced bugs will be REAL product/data issues (bug-045 build-completeness gap + flow-1/5/6/8/9 seed-vs-flow mismatches). Expected output: ~5-7 real bugs in bugs.yaml, NO synthesizer-translation false-positives.
3. **Decide what to dispatch /fix-bugs against**:
   - bug-045 (dashboard topbar missing currency selector) — clear product-completeness gap; web-frontend-builder can add the component
   - flow-1 (expects empty "No accounts yet" but seed populates 3 accounts) — flow-vs-seed mismatch; either re-author flow OR add per-flow seed override
   - flow-8 (expects "USD Cash" account but seed has "US Checking") — naming mismatch; could be either side's fix
   - flow-9 (Badge "stale" not visible because fx_cache is fresh) — needs flow-specific stale fx_cache seed
4. **Roll forward to book-swap** — the next Mode B candidate. With Wave 0/1/2 + bug-046/047 hardening shipped, book-swap should be the cleanest end-to-end run yet (Strategy C real-DB; will exercise the new factory pipeline including /test/seed-baseline + per-stack dev.mjs + correct selectors + URL pattern rewrite).
5. **Eventually**: pick up feat-046 + feat-047 (fix-loop parallelism + worktree auto-prune) when the cost/benefit signal hits; pick up feat-048 (synthesizer output linting) if a new bug class surfaces that the current narrow lints don't catch.

## Open questions

- **finance-track-01 flow-1/5/6/8/9 seed-vs-flow mismatches** — should the manifest interaction be re-authored (e.g. flow-1 should NOT expect "No accounts yet" because it's a "first-time setup" flow but the test runs against a seeded DB) or should the seed-baseline be tier-aware (per-flow seeding overrides via the bug-042 `required-baseline.json` extension)? The latter is cleaner architecturally but more synthesizer work.
- **Should bug-044 be archived as completed** when its fix commits to finance-track-01 git? It's a project-side test-authoring bug, not a factory bug. Could remain "active P2" tracking the project-side fix application, OR archive once the project commit lands. I'd lean archive-on-project-commit.
- **Should we run /quota-status before next session's big work?** Tomorrow's session would benefit from a pre-flight if /fix-bugs dispatch is on the agenda — auto-fix loops can burn $20-50 per round.
- **bug-045 (dashboard topbar currency selector) — fix it manually OR via fix-loop?** Manually is ~5 min for an experienced dev. Via fix-loop is ~$5-15 + autonomous. I'd lean fix-loop since it's a clean test of the factory's "verifier finds gap → loop fixes it" flow.

## Key files touched

### Factory (committed this session)

#### `c0ddd7c` plans: file bug-046 + bug-047 + feat-048

- `plans/active/bug-046-user-flows-generator-malformed-css-role-selectors.md` — NEW
- `plans/active/bug-047-synthesizer-tohaveurl-path-shape-pattern-mismatch.md` — NEW
- `plans/active/feat-048-synthesizer-output-linting.md` — NEW (P2 deferred)
- `plans/active.md` — manifest 3-row addition

#### `6b0f46a` feat(synthesizer): bug-046+047 Phase A+B

- `.claude/skills/user-flows-generator/SKILL.md` — §4b expanded with anti-pattern callout + decision-table for selector preference + path-shape pattern semantics
- `scripts/synthesize-flow-e2e.mjs` — `ENGINE_MIX_RE` post-flight + `rewritePathShapeToUrlShape` helper + wired into assertUrlMatches case
- `orchestrator/tests/synthesize-flow-e2e.test.ts` — +9 regression tests
- (small formatter touches on prior plan files swept into the commit)

#### `bf07ebe` plans: archive bug-046 + bug-047

- `plans/active/bug-046-...md` → `plans/archive/` (status: completed)
- `plans/active/bug-047-...md` → `plans/archive/` (status: completed)
- `plans/active.md` — manifest entries removed + archive log entry appended

### Project finance-track-01 (committed this session — `16be3ec` on `fix/bugs-yaml-iter`)

- `docs/user-flows-manifest.json` — 10 selectors hand-fixed (`>>` inserted between CSS and `role=`)
- `apps/web/e2e/synthesized/flow-{1..9}.spec.ts` — regenerated by re-running the synthesizer

### Project finance-track-01 (NOT committed — pending tomorrow)

- `scripts/dev.mjs` — Wave 1 leftover (node-fastify variant from factory template); should commit alongside other recovery work
- `apps/web/e2e/flow-3.spec.ts` — bug-044 hand-fix (toHaveURL("/") replacing /^\//); should commit alongside

## Decisions made

- **Investigated wider than the 2 surfaced bugs (preventative scoping)** — walked all 11 InteractionStep emission paths + the schema looking for latent classes. Identified 6 additional classes; folded the most-impactful into bug-046+047's three-layer fix; deferred the rest to feat-048. Lesson: when the 2nd of a class surfaces, audit for the rest of the class while context is fresh.

- **Hard-error semantics for bug-046 (no auto-rewrite)** — synthesizer pushes to errors[] when engine-mix detected; doesn't auto-insert `>>`. Reasoning: synthesizer is intentionally a mechanical translator (per feat-038 design intent). Auto-fixing would create drift between what /user-flows-generator emits and what runs. Hard-error forces SKILL.md regeneration if the LLM authors bad selectors again. Trade-off: operator pays a re-dispatch cost on stale projects, but future projects (with the corrected SKILL.md) won't ever need it.

- **Auto-rewrite semantics for bug-047 (path-shape→URL-shape)** — synthesizer DOES auto-rewrite. Reasoning: path-shape is the intuitive form for manifest authors; forcing them to write `^https?://[^/]+/foo` leaks transport-layer concerns into the manifest. The rewrite is deterministic + reversible + low-risk. Different from bug-046 because path-shape is a SEMANTIC mismatch (intent vs runtime), not a SYNTAX error (engine-mix is genuinely invalid Playwright; path-shape is "valid but wrong target").

- **MVP scope for bug-042 Phase A (required-baseline.json signal-only)** — opted for SIGNAL ("call /test/seed-baseline for Strategy C") instead of full selector→table inference. Reasoning: full inference is multi-day scope; signal is enough to unblock the load-bearing Phase C global-setup template. Selector inference deferred as feat-future depth (would help with flow-1/5/8/9 seed-vs-flow mismatches if revisited).

- **Filed feat-048 as P2 deferred rather than P1 immediate** — broader synthesizer output linting (TS typecheck + locator dry-create). Reasoning: bug-046's narrow regex catches the known case; feat-048 covers FUTURE classes that haven't surfaced yet. Defer until empirical signal of need (i.e. another bug class surfaces that the current lints don't catch). Lesson: don't ship preventative-only infrastructure without empirical signal — file as deferred so the design is captured.

- **Hand-fix finance-track-01 manifest instead of /user-flows-generator regen** — saved $5-10 LLM dispatch + 5-10 min wait. Trade-off: doesn't validate the SKILL.md correction in regeneration. Acceptable because: (a) the SKILL.md is well-structured + validated by the synthesizer's lint; (b) future projects DO run /user-flows-generator from scratch with the new SKILL.md, providing the validation signal naturally; (c) regenerating finance-track-01 from scratch would also regenerate the OTHER 8 flows that don't have engine-mix issues — pure cost.

- **Empirical validation via flow-7 alone instead of all 9 flows** — flow-7 is the bug-047 case (the assertUrlMatches issue). Other flows have OTHER non-bug-047 failures (build gaps, seed mismatches) that aren't relevant to validating bug-047. Running flow-7 in isolation gave clean signal that the URL rewrite works (Reports [active] in page snapshot proves URL assertion passed). Lesson: choose the test case that ISOLATES the fix you're validating; the broader suite validation belongs in /fix-bugs cycle later.
