---
id: feat-044-shepherd-kanban-webapp-09-to-95
type: feature
status: abandoned
abandoned-at: 2026-04-30
abandoned-reason: kanban-webapp-09 has 100+ uncommitted modifications + 18 broken unit tests (label-rename refactor stalled mid-flight). Operator pivoted to repo-health-dashboard-01 as the first validation target; a fresh kanban-webapp-pre-build /start-build (roadmap step 11) will produce a clean kanban project rather than triaging this one.
approved-at: 2026-04-30
approved-by: human
author-agent: claude-opus-4-7
created: 2026-04-30
updated: 2026-04-30
parent-plan: investigate-012-factory-readiness-pre-builds
supersedes: null
superseded-by: feat-045-shepherd-repo-health-dashboard-01-to-95
branch: feat/quota-observability
affected-files:
  - projects/kanban-webapp-09/docs/user-flows-manifest.json
  - projects/kanban-webapp-09/docs/bugs.yaml
  - projects/kanban-webapp-09/docs/build-to-spec/score.json
  - projects/kanban-webapp-09/docs/manual-sanity-confirmed.txt
  - projects/kanban-webapp-09/apps/web/e2e/synthesized/flow-{1..10}.spec.ts
feature-area: project-shepherding
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-044 — Shepherd kanban-webapp-09 to ≥95% finished

## Problem Statement

Step 1+2 of the validate-first roadmap from `investigate-012`. kanban-webapp-09 currently scores **56%** against the 8-dimension rubric — Mode A + Mode B + Reach + Parity + Verifier are full marks, but Flow E2E (0/10), Coverage (unread), Manual sanity (no file) are blanks. Closing those three dimensions takes the project to ≥95% and **proves the rubric on Strategy A** (localStorage-only, no backend, simplest stack) before we layer in F1/F2 dependencies for Strategy C/D projects.

This plan is the FIRST validation target for the factory readiness effort. If it fails, the rubric or roadmap need rework before fanning out.

## Approach

### Phase A — Author interactions[] for 10 flows (~30 min)

1. Read `projects/kanban-webapp-09/docs/user-flows-manifest.json` end-to-end. Identify all 10 flows + their step breadcrumbs.
2. Apply `/user-flows-generator` Phase 3 algorithm (per `.claude/skills/user-flows-generator/SKILL.md` step 4b) to each flow. Manually rather than dispatching the skill — flows are well-bounded and the algorithm is deterministic.
3. For each flow, author:
   - `interactions[]` array with discrete `kind`-typed steps (navigate, fill, click, waitForSelector, assertVisible, assertText, assertUrlMatches)
   - `seedingTier`: `"read-only"` if pure navigation (e.g. flow-1 first-time onboarding); `"mutation"` if state-changing (most flows here — cards get created/moved/deleted)
4. **Strategy A specifics**: every spec gets `localStorage.clear()` in beforeEach (per testing-policy §E2E data-seeding). For mutation flows, optional `localStorage.setItem` to seed starting state. NO `mock` interactions needed — the project is single-tier with no backend.
5. Selector preference order (from Phase 3 algorithm): role-based selectors > `data-kit-component` + text > plain text > `data-screen-id` transition.
6. Self-verify: schema-validate the manifest against `schemas/user-flows-manifest.schema.json`.

### Phase B — Regenerate synthesized specs + run E2E (~30 min)

7. Run `node scripts/synthesize-flow-e2e.mjs kanban-webapp-09` to regenerate `apps/web/e2e/synthesized/flow-{1..10}.spec.ts`.
8. Inspect 1-2 generated specs to confirm v2.0 path (interactions[] translator) was taken — look for `__stepIndex` markers + `clearMocks` from seed-intercept (NOT applicable — Strategy A; should use seed-localstorage.ts helper instead).
9. Boot the project's dev server (`pnpm -C apps/web dev` or root `pnpm dev`); run E2E suite (`pnpm -C apps/web exec playwright test e2e/synthesized/`).
10. Capture pass/fail counts. Failure mode classification:
    - **Selector miss** (auto-inference picked wrong selector) → adjust manifest interactions[] OR fall back to a more specific selector kind
    - **Real product bug** → file in `docs/bugs.yaml` per the verifier's classification rules
    - **Race / flake** → bump `retries: 1` per investigate-012 decision

### Phase C — Verify + fix loop (~30 min)

11. Run `node scripts/audit-app-reachability.mjs projects/kanban-webapp-09` — should be clean (project shipped).
12. Run `/build-to-spec-verify` for kanban-webapp-09 — covers reachability + parity + flow synthesis + flow run.
13. If any new bugs surface in `docs/bugs.yaml`, run `/fix-bugs kanban-webapp-09` until clean OR cap.
14. Run vitest with coverage: `pnpm -C apps/web test --coverage`. Read `coverage-summary.json`. If <80%, builders extend tests until ≥80%.

### Phase D — Manual sanity sign-off (~15 min)

15. Boot project (`pnpm -C apps/web dev`); operator walks the golden path manually:
    - Open browser, hit localhost:3000
    - Verify each of the 10 flows visually (matches designs, no console errors)
    - Confirm visual-review screens look right at all 3 viewports
16. Operator authors `docs/manual-sanity-confirmed.txt` with **numbered checklist** (anti-rubber-stamp per investigate-012 decision):
    ```
    pass
    1. flow-1 first-time setup — board appears, three columns, no cards
    2. flow-2 daily session — drag card from To Do → In Progress works
    3. ...
    10. flow-10 (whatever it is) — confirmed
    ```
    Empty `pass` alone does NOT count; must include numbered confirmation per flow.

### Phase E — Score + verify ≥95% (~10 min)

17. Compute the 8-dimension score by hand (F6 score-gating not yet shipped — feat-043 ships in parallel; for this first project we compute manually):
    - Mode A: 4/5 gates × 10 = 8 (assume gate-4 catch-up gives full 10)
    - Mode B: 15 (apps built + features completed)
    - Reachability: 10 (audit clean)
    - Parity: 15 (parity-verify clean)
    - Flow E2E: 10/10 × 20 = 20 (target)
    - Coverage: ≥80% → 10
    - Verifier: 10 (no pending bugs)
    - Manual sanity: 10 (numbered checklist)
    - **Target: 98**
18. If score <95, identify which dimension is short, return to Phase B/C/D for that dimension.

### Phase F — Archive + update lessons (~5 min)

19. Run `/plan-archive` with outcome=success and lessons learned (anything surprising about applying Phase 3 algorithm at scale; selector-inference accuracy; coverage gaps).
20. Update `investigate-012` recommendation to mark step 1+2 as completed.

## Rejected Alternatives

- **Dispatch /user-flows-generator skill instead of manually applying Phase 3 algorithm** — skill burns ~$3-5 of LLM dispatch and gives equivalent output for a well-bounded 10-flow set. Manual is cheaper + faster + deterministic. Skill remains the right call when authoring flows from scratch (no manifest yet).
- **Wait for feat-043 (score-gating) to ship before validating** — score is currently computed manually from rubric definition. Waiting blocks step 1 on parallel step 3. Proceeding without it doesn't hurt; it just makes validation a bit more verbose. F6 ships in parallel.
- **Skip coverage remediation if it's <80%** — investigate-012 explicitly committed to "no shortcuts on rigor". Coverage at 80% is a testing-policy floor that catches bug regressions; bypassing it would defeat the validate-first mandate.

## Expected Outcomes

- [ ] All 10 flows in `user-flows-manifest.json` have non-empty `interactions[]` + `seedingTier`
- [ ] All 10 synthesized Playwright specs pass via `pnpm exec playwright test e2e/synthesized/`
- [ ] `coverage-summary.json` shows ≥80% line coverage (apps/web aggregate)
- [ ] `docs/bugs.yaml` has 0 pending entries (any surfaced bugs resolved by /fix-bugs)
- [ ] `docs/manual-sanity-confirmed.txt` exists with operator-numbered per-flow checklist
- [ ] Manual score computation = ≥95
- [ ] Plan archived with lessons learned

## Validation Criteria

- E2E suite: 10/10 synthesized specs pass on `pnpm exec playwright test`
- Coverage report: `apps/web/coverage/coverage-summary.json` shows `total.lines.pct >= 80`
- Reachability: `node scripts/audit-app-reachability.mjs projects/kanban-webapp-09` exits 0
- Parity: `node scripts/parity-verify.mjs ...` exits 0
- bugs.yaml: `grep -c "status: pending\|status: in-progress" docs/bugs.yaml` returns 0 (or file absent)
- Score: hand-computed total ≥95 against the rubric in investigate-012 §F-1

## Attempt Log

### Attempt 1 — 2026-04-30 — Phases A+B completed; Phase C surfaced project-state blocker; abandoned

**Phase A (interactions[] authoring)** — done. All 10 flows authored with v2.0 interactions[] + seedingTier. 4 iterations of selector tightening (initial role= syntax doesn't work in `page.locator()`; switched to attribute selectors + `:has-text()`; `:text("No boards yet")` strict-mode collision with sidebar empty-state; `aria-label="Add card to ..."` only renders for non-empty columns; inline-edit input only renders after dblclick which v2.0 InteractionStep schema doesn't support). Manifest schema-validated.

**Phase B (synthesizer + run E2E)** — done. After fixing a real product bug (`HomeBoardView.tsx` was statically importing `CardDetailModal` which transitively pulled `isomorphic-dompurify` → `jsdom` into SSR; jsdom tries to load `.next/browser/default-stylesheet.css` and 500s the dev server; fix: dynamic-import CardDetailModal with `ssr: false`), all 10 synthesized specs pass in 12.9s. Full Playwright suite (synthesized + hand-authored) = 48 passed, 14 skipped, 0 failed.

**Phase C (verify+fix+coverage)** — surfaced a structural blocker:

- `git status` on kanban-webapp-09 shows 100+ uncommitted modifications across source, tests, configs, schemas — none from this session
- 18 of 548 unit tests fail: source aria-label was renamed `Edit card: ${title}` → `Open card: ${title}`, but tests still look for `/edit card: ...` — a label-rename refactor that didn't finish
- Smoke test fails: `invariant expected app router to be mounted`
- Reachability has 1 known orphan (`apps/web/components/theme-toggle.tsx` shadowed by `apps/web/src/components/theme-toggle.tsx`)
- Coverage cannot be computed cleanly while tests fail (vitest exits with code 1)

**Operator decision (turn 13):** abandon kanban-09 as a validation target. A fresh `/start-build` against `kanban-webapp-pre-build` (roadmap step 11) will produce a clean kanban project rather than triaging this one.

**Carryovers preserved (not reverted):**

- `apps/web/src/components/HomeBoardView.tsx` — dynamic-import fix to `CardDetailModal` (real bug fix; SSR was broken pre-fix)
- `apps/web/e2e/helpers/seed-localstorage.ts` — copied from factory template per Strategy A scaffold
- `docs/user-flows-manifest.json` — v2.0 schema with interactions[] for 10 flows (will be regenerated when /start-build runs against kanban-webapp-pre-build)
- `apps/web/e2e/synthesized/flow-{1..10}.spec.ts` — synthesized; will be regenerated

**Lessons learned (folded into investigate-012 + future plans):**

1. v2.0 interactions[] schema cannot express drag-drop, dblclick, key-press, or file-upload — those interaction kinds need to be added (Phase 7 of feat-038). Documented as deferred items in flow descriptions.
2. `page.locator()` selector strings must use CSS / attribute / `:has-text()` / `:text()` — Playwright's `getByRole` chained API is not available in v2.0 (selectors are passed to `page.locator()` directly).
3. "Shipped" baselines are not necessarily clean. Validation targets should be checked for uncommitted state BEFORE plan authoring.
4. `isomorphic-dompurify` SSR import is a real footgun in Next 15+ — jsdom tries to resolve a non-existent path. Lazy-import / dynamic-import with `ssr: false` is the cleanest fix for client-only apps.

Superseded by: `feat-045-shepherd-repo-health-dashboard-01-to-95`.
