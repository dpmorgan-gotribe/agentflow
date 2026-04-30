---
id: feat-045-shepherd-repo-health-dashboard-01-to-95
type: feature
status: completed
completed-at: 2026-04-30
completion-note: "Score 90/100 with manual-sanity dimension deferred (operator-walk with numbered checklist not authored — operator pivoted to next project before the walk). All measurable dimensions full marks: Mode A 10/10, Mode B 15/15, Reachability 10/10 (0 orphans), Parity 15/15, Flow E2E 20/20 (8/8 specs pass), Coverage 10/10 (web 95.29%, api 97%), Verifier 10/10. Manual sanity 0/10 deferred. Surfaced 2 factory-wide bugs (bug-033 dev.mjs env propagation, bug-119-class testing-policy hardening) — both shipped same session."
approved-at: 2026-04-30
approved-by: human
author-agent: claude-opus-4-7
created: 2026-04-30
updated: 2026-04-30
parent-plan: investigate-012-factory-readiness-pre-builds
supersedes: feat-044-shepherd-kanban-webapp-09-to-95
superseded-by: null
branch: feat/quota-observability
affected-files:
  - projects/repo-health-dashboard-01/docs/user-flows-manifest.json
  - projects/repo-health-dashboard-01/apps/web/playwright.config.ts
  - projects/repo-health-dashboard-01/apps/web/e2e/synthesized/flow-{1..8}.spec.ts
  - projects/repo-health-dashboard-01/docs/bugs.yaml
  - projects/repo-health-dashboard-01/docs/build-to-spec/score.json
  - projects/repo-health-dashboard-01/docs/manual-sanity-confirmed.txt
feature-area: project-shepherding
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-045 — Shepherd repo-health-dashboard-01 to ≥95% finished

## Problem Statement

Step 1 (revised) of `investigate-012`'s validate-first roadmap. After `feat-044` was abandoned due to kanban-webapp-09's mid-rework state, `repo-health-dashboard-01` becomes the first validation target. Current score: **60%** against the 8-dimension rubric — Mode A + Mode B + Reach + Parity + Verifier are full marks, but Flow E2E (1/8 flows had interactions[], failing), Coverage (unread), Manual sanity (no file) need closing.

Stack: react-next + python-fastapi (Strategy D — `external-api-only`). Live-backend mode is unblocked by `GITHUB_TOKEN` in `.env.local`. Synthetic-state flows (4/5/6) require `feat-039`'s `mock` InteractionStep kind (now shipped).

This plan is the FIRST live validation of:

- The 8-dimension rubric on a real Strategy D project
- `feat-039`'s `mock` kind end-to-end (synthesizer → spec → run)
- The live-backend Playwright `webServer` wiring via `scripts/dev.mjs` (de facto F2 pre-shipment of `feat-040`)

If it lands at ≥95%, the rubric is proven and we move to roadmap step 6 (book-swap-pre-build, first from-zero Mode B + fix-bugs proof).

## Approach

### Phase A — Author interactions[] for 7 remaining flows (~30 min)

1. Read `docs/user-flows-manifest.json`. flow-1 already has interactions[] from feat-038 Phase 3 manual application.
2. Author flows 2-8 with conservative selectors:
   - **Flows 1, 2, 3, 7, 8**: live-backend (real GitHub via `GITHUB_TOKEN`). Use `waitForResponse` on `/api/report/`.
   - **Flows 4, 5, 6**: prefix with `kind: "mock"` to fake 429 / 403 / 500 responses (synthetic states unreachable live).
3. Bump `schemaVersion` to `"2.0"` if not already.
4. Validate against `schemas/user-flows-manifest.schema.json`.

### Phase B — Wire live-backend webServer + run E2E (~30-60 min)

5. Update `apps/web/playwright.config.ts` to invoke `node ../../scripts/dev.mjs` (boots both halves with port coordination per bug-032 Phase B).
6. Bump `retries: 1` for local runs per investigate-012 §F-5 decision.
7. Run `node scripts/synthesize-flow-e2e.mjs projects/repo-health-dashboard-01` to regenerate specs.
8. Run E2E: `pnpm -C apps/web exec playwright test e2e/synthesized/`.
9. Failure-mode iteration:
   - **Selector miss** → adjust manifest interactions[]
   - **Real product bug** → file in `docs/bugs.yaml`
   - **Backend not boot** → check `.env.local` GITHUB_TOKEN + port collision
   - **Race / flake** → retry budget already bumped; if persistent, surface

### Phase C — Verify + fix loop + coverage (~30 min)

10. Run `node scripts/audit-app-reachability.mjs projects/repo-health-dashboard-01` — should be clean (project shipped, bug-028 fixed audit).
11. Run `/build-to-spec-verify` — covers reachability + parity + flow synthesis + run.
12. If new bugs surface → run `/fix-bugs repo-health-dashboard-01` until clean OR cap.
13. Coverage: `pnpm -C apps/web test --coverage` (vitest) + `pnpm -C apps/api test --cov` (pytest). Read `coverage-summary.json` per app + aggregate. Target ≥80%.

### Phase D — Manual sanity sign-off (~15 min)

14. Boot project (`node scripts/dev.mjs`). Operator walks each of 8 flows:
    - flow-1 (Generate single report on `facebook/react`)
    - flow-2 (Compare facebook/react vs vercel/next.js)
    - flow-3 (404 on `nonexistent-org/nonexistent-repo`)
    - flow-4 (rate-limited — needs synthetic 429; observable in dev via DevTools mock)
    - flow-5 (private — synthetic 403)
    - flow-6 (network failure — synthetic 500)
    - flow-7 (recent searches + example chips render)
    - flow-8 (about page navigation)
15. Operator authors `docs/manual-sanity-confirmed.txt` with **numbered per-flow confirmation** (anti-rubber-stamp per investigate-012):
    ```
    pass
    1. flow-1 — facebook/react report renders all 7 charts + 4 header cards
    2. flow-2 — compare view aligns metrics horizontally
    3. flow-3 — 404 message + return-home affordance
    4. flow-4 — rate-limited message + reset countdown
    5. flow-5 — private repo message; no token-elevation prompt
    6. flow-6 — network-failure message + Retry preserves URL state
    7. flow-7 — example chips visible; recent searches list hydrates
    8. flow-8 — about page renders without leaving the app
    ```

### Phase E — Score + verify ≥95% (~10 min)

16. Hand-compute the 8-dim score:
    - Mode A: 5/5 gates × 10 = 10
    - Mode B: 15 (apps built, features completed)
    - Reachability: 10 (audit clean)
    - Parity: 15 (parity-verify clean)
    - Flow E2E: passing/8 × 20 (target ≥7.6/8 = 19+)
    - Coverage: ≥80% → 10
    - Verifier: 10 (no pending bugs)
    - Manual sanity: 10 (numbered checklist)
    - **Target: ≥95**
17. If <95, return to Phase B/C/D for the short dimension.

### Phase F — Archive + update lessons (~5 min)

18. `/plan-archive` with outcome=success + lessons.
19. Mark investigate-012 step 1 as completed in the recommendation section.

## Rejected Alternatives

- **Use `kind: "mock"` for ALL 8 flows** (no live backend) — simpler, deterministic, but doesn't exercise the live FastAPI proxy + GitHub integration. Rubric mandate is "matches designs + working e2e" — proxy verification is part of "working e2e".
- **Skip flows 4/5/6 entirely** — would lower max possible score to 5/8 × 20 = 12.5 on Flow E2E, capping at 87.5% total. Below 95% threshold. Mock kind landing in feat-039 is cheaper.
- **Defer manual-sanity to a later session** — would leave a 10-pt gap in the score. Anti-rubber-stamp checklist is explicit operator deliverable per investigate-012 decision.

## Expected Outcomes

- [ ] All 8 flows in `user-flows-manifest.json` have non-empty `interactions[]` + `seedingTier`
- [ ] All 8 synthesized Playwright specs pass (target: 7-8/8 pass, ≥95% threshold allows 1 flake)
- [ ] `coverage-summary.json` (web aggregate) shows ≥80% line coverage
- [ ] FastAPI pytest --cov shows ≥80% line coverage
- [ ] `docs/bugs.yaml` has 0 pending entries
- [ ] `docs/manual-sanity-confirmed.txt` exists with numbered per-flow checklist
- [ ] Hand-computed score ≥95
- [ ] Plan archived with lessons learned

## Validation Criteria

- E2E: 8/8 (or 7/8) synthesized specs pass via `pnpm exec playwright test e2e/synthesized/`
- Reachability: `node scripts/audit-app-reachability.mjs projects/repo-health-dashboard-01` exits 0
- Parity: parity-verify clean (already verified in iteration 1 of last bugs.yaml)
- Coverage: `apps/web/coverage/coverage-summary.json` `total.lines.pct >= 80`; same for `apps/api/`
- bugs.yaml: 0 pending entries (current state — both prior parity bugs are completed)
- Score: hand-computed ≥95

## Attempt Log

### Attempt 1 — 2026-04-30 — in progress

**Pre-flight (turn 17):** Confirmed repo-health-01 is clean (only `.next.broken2/` + `docs/build-to-spec/` untracked — both build artifacts). Branch: main. apps/api + apps/web present. flow-1 already had v2.0 interactions[] from feat-038 Phase 3.

**Phase A (turn 18-19):** Authored interactions[] for flows 2-8. Live-backend selectors for flows 1/2/3/7/8 use `input[name="url"]`, `button[type="submit"]`, `[data-screen-id="X"]`, `a[href="/about"]`, `section[aria-label="Example repositories"]`. Synthetic-state flows 4/5/6 use `kind: "mock"` for /api/report/ with status 429/403/500 respectively. Manifest schema-validates against the project's synced schema.

**Phase B (turn 19-20):** Updated `apps/web/playwright.config.ts` to invoke `node ../../scripts/dev.mjs` (de facto F2 pre-shipment) + bumped `retries: 1` for local runs. Synthesizer regenerated all 8 specs cleanly: persistenceLayer=external-api-only, strategy=D, no warnings. First test run hit a port-8000 collision — PID 24152 listening on port 8000 from outside our session. Surfaced to operator for resolution (kill PID vs override port).

**Pending:** Resolve port collision → run E2E suite → iterate on selector misses or real bugs → coverage → manual sanity → score.
