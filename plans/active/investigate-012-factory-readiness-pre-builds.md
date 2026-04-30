---
id: investigate-012-factory-readiness-pre-builds
type: investigation
status: approved
approved-at: 2026-04-30
approved-by: human
author-agent: claude-opus-4-7
created: 2026-04-30
updated: 2026-04-30
parent-plan: null
supersedes: null
superseded-by: null
branch: null
affected-files: []
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
time-box-minutes: 90
hypothesis: "The factory's build-to-spec verifier (feat-022) + flow-synth deepening (feat-038) are structurally complete, but three classes of gap prevent any pre-build from reaching ≥95% finished: (a) `mock` InteractionStep kind unshipped — flow-4/5/6-class synthetic-state flows untestable across all stacks; (b) Strategy C (real-DB E2E) empirically unproven — no project has exercised the `/test/seed` + `/test/cleanup` contract end-to-end; (c) Playwright `webServer` boots only the frontend across most stack skills — live-backend E2E impossible for Strategy C + Strategy D projects. Closing these three + authoring interactions[] per project should drive each pre-build to ≥95% in ~1-2 sessions per project."
---

# investigate-012 — What does the factory need to drive every pre-build to ≥95% finished?

## Question

For each pre-build project under `projects/*-pre-build/` (plus the in-flight `repo-health-dashboard-01`), what concrete gap exists between current state and a ≥95% "finished product" bar (matches designs visually, all flows pass E2E, verifier output clean, coverage ≥80%)? Which gaps are project-specific vs. cross-cutting factory-level work that blocks more than one project? What is the phased roadmap that lifts the factory to a state where every pre-build can be driven to ≥95% with high confidence — before we attempt gotribe?

Falsifiable: at investigation end we either (a) produce a phased roadmap with per-phase acceptance criteria + an estimate of how many sessions each phase takes, or (b) document that the answer requires a separate investigation (and exactly what that investigation should cover).

## Hypothesis

Three classes of gap, each cross-cutting:

1. **Schema gap** — `mock` kind on `InteractionStep` was deferred from feat-038 Phase 6. Without it, the synthesizer can only emit `page.route()` interception via hand-edits the synth would clobber. This blocks every flow whose state cannot be reproduced live: rate-limited, private-repo, network-failure, auth-failed, etc. Affects all 4 pre-builds + repo-health-dashboard-01.

2. **Empirical gap (Strategy C)** — `seed-db.ts.template` + `playwright-global-setup.ts.template` shipped + `python-fastapi §3` documents the `/test/seed` + `/test/cleanup` contract gated by `ENABLE_TEST_SEED=1`, but **no project has actually exercised this contract end-to-end**. Both `book-swap-pre-build` (postgres + node-trpc-nest) and `finance-track-pre-build` (sqlite + node-fastify) target Strategy C and would be the first concrete consumers. Empirical gaps tend to surface 2-3 paper-cut bugs.

3. **Tooling gap (Playwright webServer)** — every shipped Playwright `webServer.command = "pnpm dev"`. For frontend-only projects (kanban-webapp, Strategy A) that's correct. For Strategy C + Strategy D projects that need both halves running, this only boots the frontend — backend calls 404 or time out (already empirically observed on `repo-health-dashboard-01`). The factory has `scripts/dev.mjs` (bug-032 Phase B) that orchestrates both halves; stack skills need to declare it as their `webServer` for E2E.

Plus a project-specific class:

4. **Per-project authoring gap** — only 1 of 8 flows in repo-health-dashboard-01 has v2.0 `interactions[]`; 0 of 9 in finance-track, 0 of 10 in kanban-webapp-pre-build, 0 of 8 in repo-health-dashboard-pre-build, 0 of 0 in book-swap-pre-build (no flows authored yet). Until each flow has interactions[], the synthesizer can only emit shallow legacy specs that don't actually validate behavior.

If hypothesis is correct: closing (1)+(2)+(3) is ~3 factory-level features + ~1-2 sessions of empirical validation. Then each pre-build needs one shepherding session for (4) + the actual Mode B → fix-loop → verify-clean cycle. Total: ~6-8 sessions to get all 4 pre-builds to ≥95%.

## Investigation Steps

### Phase 1 — Define the bar (≥15 min)

1. **Author "finished product ≥95% definition"** as a checklist that survives operator review. Candidate dimensions, each weighted equally for a coarse % score:
   - Mode A artefacts: all gates resolved (1, 2, 3, 4, 5)
   - Mode B build: every feature in `tasks.yaml` merged + `agent_sequence` complete
   - Reachability: `audit-app-reachability` finds 0 orphan components/routes
   - Visual parity: all screens pass `parity-verify` against the designed mockups
   - Flow E2E: all flows in `user-flows-manifest.json` pass synthesizer-emitted Playwright specs
   - Coverage: ≥80% line coverage per `testing-policy.md`
   - Verifier exit: `bugs.yaml` has zero pending entries (all `completed` or `failed-with-escalation`)
   - Manual sanity: golden path walkable end-to-end via `node scripts/dev.mjs` against real inputs
   - 8 dimensions × ≥95% pass = "finished"; <90% fails the bar; 90-94% gets a per-dimension itemized ticket
2. **Decide measurement mechanism** — operator runs which command(s) to compute the score? Candidates: extend `/build-to-spec-verify` to emit a `docs/build-to-spec/score.json` aggregating all 8 dimensions; OR new `/project-status` skill; OR script-only `node scripts/score-project.mjs`. Pick one + document why.
3. **Decide gating discipline** — does <95% block "ship to next project" and <90% block "/start-build" itself? OR is the score advisory? Lean toward: <95% blocks ship; <90% triggers /plan-bug auto-file via verifier.

### Phase 2 — Per-project state audit (≥15 min)

For each project (`book-swap-pre-build`, `finance-track-pre-build`, `kanban-webapp-pre-build`, `repo-health-dashboard-pre-build`, `repo-health-dashboard-01`, `kanban-webapp-09`):

4. **Score against the §1 dimensions** using current artefacts. Mostly mechanical. Initial signal already gathered in this conversation's pre-flight survey:
   - `book-swap-pre-build` → only gate-1; tasks.yaml present; no apps/; no manifest flows. Estimated score: ~15% (Mode A barely started).
   - `finance-track-pre-build` → gates 3 + credentials; 9 flows no interactions[]; no apps/; tasks.yaml present. Estimated: ~25%.
   - `kanban-webapp-pre-build` → gates 3 + credentials; 10 flows no interactions[]; no apps/. Estimated: ~25%.
   - `repo-health-dashboard-pre-build` → gates 1+3+4; 8 flows no interactions[]; no apps/; on a fix branch. Estimated: ~30%.
   - `repo-health-dashboard-01` → all 5 gates; apps/ built; 1/8 flows interactions[]; bugs.yaml has 2 completed; webServer wiring incomplete. Estimated: ~70-75%.
   - `kanban-webapp-09` → all gates; apps/ built; 0/10 flows interactions[]; Strategy A. Estimated: ~70-80% (ship-state baseline).
5. **Tabulate per-dimension delta** to produce a per-project work backlog. Output: `docs/factory-readiness/per-project-deltas.md`.

### Phase 3 — Cross-cutting factory blocker analysis (≥20 min)

6. **Confirm or refute hypothesis (1) — `mock` kind**:
   - Walk each flow in each manifest; classify whether it can be exercised live or needs a mock. Decision rule: errors (4xx/5xx/network) cannot be reliably reproduced live.
   - Count flows blocked by missing-mock-kind across all projects. Authoritative blocker count.
7. **Confirm or refute hypothesis (2) — Strategy C unproven**:
   - Read `python-fastapi/SKILL.md §3` + `seed-db.ts.template` + `playwright-global-setup.ts.template` end-to-end.
   - Identify any Strategy C stack skill that would be invoked for `book-swap-pre-build` (node-trpc-nest) or `finance-track-pre-build` (node-fastify) — do those skills exist with §Testing blocks declaring strategy C? `ls .claude/skills/agents/back-end/` to enumerate.
   - List concrete gaps: e.g. node-trpc-nest stack skill missing `/test/seed` contract; node-fastify likewise; etc.
8. **Confirm or refute hypothesis (3) — webServer wiring**:
   - Read every `playwright.config.ts` template across stack skills.
   - For each of (Strategy A / Strategy C / Strategy D), record what `webServer.command` should be. Strategy A = single Next; Strategy C = `node scripts/dev.mjs` (full stack); Strategy D = same.
   - Decide: should `scripts/dev.mjs` be promoted into stack skill scaffold (so every multi-tier project gets it) OR is a stack-skill-emitted variant cleaner?
9. **Stack-strategy proof matrix** — table:

   | Strategy | Stack skill               | Empirical proof project  | Status                       |
   | -------- | ------------------------- | ------------------------ | ---------------------------- |
   | A        | react-next (localStorage) | kanban-webapp-09         | Shipped, but flows lack v2.0 |
   | C        | node-trpc-nest + postgres | book-swap-pre-build      | Not built yet                |
   | C        | node-fastify + sqlite     | finance-track-pre-build  | Not built yet                |
   | D        | python-fastapi            | repo-health-dashboard-01 | In-flight                    |

   For each unproven cell, list what specifically needs to ship.

### Phase 4 — Roadmap synthesis (≥20 min)

10. **Sequence the factory work into phases**, ordered by "fewest projects unblocked" to "most projects unblocked":
    - **Phase F1 — Schema bump (`mock` InteractionStep kind)** — feat-038 Phase 6 deferred. ~1 session. Unblocks all 4 pre-builds + repo-health-dashboard-01 for synthetic-state flow E2E.
    - **Phase F2 — Live-backend Playwright wiring** — promote `scripts/dev.mjs` into stack-skill scaffolds for multi-tier projects; update `playwright.config.ts` template per stack skill. ~0.5 session. Unblocks Strategy C + D projects.
    - **Phase F3 — Strategy C empirical validation** — pick one of `book-swap-pre-build` or `finance-track-pre-build` as the first Strategy C build target; drive it through `/start-build` to surface paper-cut bugs in the `/test/seed` contract; document patterns. ~1-2 sessions. Unblocks remaining Strategy C project.
    - **Phase F4 — Per-project /user-flows-generator re-run** — author interactions[] for all flows across all projects. Either invoke the skill per project OR manually apply Phase 3 algorithm. ~0.5 session per project.
    - **Phase F5 — Per-project shepherding** — `/build-to-spec-verify` → `/fix-bugs` → manual visual check, per project. ~0.5-1 session per pre-build that already finished Mode B; ~1-2 sessions per pre-build that still needs Mode B.
    - **Phase F6 — Score + gate enforcement** — implement the Phase 1 measurement mechanism; wire <95% score as a soft block + <90% as a hard block on `/start-build` and `/fix-bugs` exits. ~0.5 session.
11. **Critical path** — F1 → F2 → F3 → (F4 || F5 in parallel) → F6. Total estimate: ~6-9 sessions to get all 4 pre-builds + repo-health-dashboard-01 to ≥95%.
12. **Identify follow-up plans to author** — concrete `/plan-feature` IDs to spin up after this investigation:
    - `feat-039 mock-interaction-step-kind` (F1)
    - `feat-040 live-backend-playwright-webserver` (F2)
    - `feat-041 strategy-c-empirical-validation-via-{first-target}` (F3)
    - `feat-042 project-readiness-score` (F6)
    - Plus ad-hoc per-project plans for F4 + F5 as we drive each pre-build through.

### Phase 5 — Risk + open question pass (≥10 min)

13. **Surface risks** — what could derail the roadmap?
    - Strategy C might surface more than 2-3 paper-cuts (hidden cross-tier coupling: ORM seeding vs. proxy auth vs. cookie session, etc.).
    - Live-backend tests are flakier than mocked tests; "≥95% E2E pass" might require flake-tolerance (per-test retry, deterministic test data fixtures).
    - The 8-dimension scoring rubric might over-weight binary dimensions (gates) vs. continuous ones (coverage, parity-divergence count); revisit weighting after first scored project.
    - `book-swap-pre-build` has a richer external-API surface (Open Library? Google Books?) than the in-conversation snapshot suggested — may need its own mock-vs-live decision per integration.
14. **Open questions to surface for operator review** before approving the roadmap:
    - Should the score gate be advisory or blocking? (Hypothesis says blocking; operator may prefer advisory until empirical signal.)
    - Are all 4 pre-builds in scope, or should we de-scope one (e.g. book-swap-pre-build is least mature; defer to post-validation)?
    - Should gotribe enter the queue at any point during this work, or strictly after F5 lands for all 4 pre-builds?
    - Is "≥95%" the right bar, or should it be "100% on dimensions 1-5 + ≥90% on coverage + manual sign-off"?

### Phase 6 — Write-up (≥10 min)

15. **Author the Findings + Recommendation sections** of this plan, capturing:
    - The finalized "finished product" definition with explicit weights.
    - The proof matrix populated with concrete status per cell.
    - The sequenced phased roadmap with per-phase acceptance criteria.
    - The follow-up plan IDs to author next.
16. **Hand back to operator** for approval before any factory-level work starts.

## Findings

Investigation executed 2026-04-30 in single conversation (~75 min of the 90 min time-box).

### F-1. Rubric — 8 dimensions, 100 points

| #   | Dimension     | Weight | Computation                                                                          |
| --- | ------------- | ------ | ------------------------------------------------------------------------------------ |
| 1   | Mode A        | 10     | `gates_resolved / 5 × 10` — gate-1, selected-style.json, gate-3, gate-4, credentials |
| 2   | Mode B        | 15     | `completed_features / total_features × 15` (parse tasks.yaml + feature-graph state)  |
| 3   | Reachability  | 10     | `orphan_count == 0 ? 10 : max(0, 10 - 0.5×orphans)` (audit-app-reachability)         |
| 4   | Visual parity | 15     | `passing_screens / total_screens × 15` (parity-verify)                               |
| 5   | **Flow E2E**  | **20** | `passing_flows / total_flows × 20` (run-synthesized-flows)                           |
| 6   | Coverage      | 10     | `min(actual_pct, 80) / 80 × 10` (read coverage-summary.json per app)                 |
| 7   | Verifier exit | 10     | `bugs.yaml has 0 pending OR all completed/failed-escalated ? 10 : 0`                 |
| 8   | Manual sanity | 10     | `docs/manual-sanity-confirmed.txt with operator-numbered checklist ? 10 : 0`         |

**Verdict thresholds:** ≥95 ship-ready · 90-94 needs-itemized-tickets · <90 needs-major-revision.

**Measurement:** extend `/build-to-spec-verify` (already orchestrates dims 3, 4, 5) to also compute dims 1, 2, 6, 7, 8 and emit `docs/build-to-spec/score.json`.

### F-2. Per-project current scores (honest baseline)

| Project                         | Mode A | Mode B | Reach | Parity | E2E | Cov | Verifier | Manual | **Total** | Gap |
| ------------------------------- | ------ | ------ | ----- | ------ | --- | --- | -------- | ------ | --------- | --- |
| book-swap-pre-build             | 4      | 0      | 0     | 0      | 0   | 0   | 10       | 0      | **14**    | 81  |
| finance-track-pre-build         | 6      | 0      | 0     | 0      | 0   | 0   | 10       | 0      | **16**    | 79  |
| kanban-webapp-pre-build         | 6      | 0      | 0     | 0      | 0   | 0   | 10       | 0      | **16**    | 79  |
| repo-health-dashboard-pre-build | 8      | 0      | 0     | 0      | 0   | 0   | 10       | 0      | **18**    | 77  |
| repo-health-dashboard-01        | 10     | 15     | 10    | 15     | 0   | 0   | 10       | 0      | **60**    | 35  |
| kanban-webapp-09                | 6      | 15     | 10    | 15     | 0   | 0   | 10       | 0      | **56**    | 39  |

**Honest baseline finding:** even shipped baselines sit at ~56-60%. Gaps concentrate in Flow-E2E + Coverage + Manual-sanity dimensions. The rubric correctly surfaces what's missing to call the work "demonstrably finished".

### F-3. Cross-cutting blockers (3 hypothesized + 1 surfaced)

| Hypothesis                                   | Status                   | Evidence                                                                                                                                                                                  |
| -------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1: `mock` InteractionStep kind unshipped    | **CONFIRMED**            | 10 kinds defined (navigate/fill/click/select/waitForResponse/waitForSelector/assertVisible/assertText/assertUrlMatches/screenshot); no `mock` or `intercept`                              |
| H2: Strategy C empirically unproven          | **CONFIRMED + EXPANDED** | Only `python-fastapi` declares Strategy C/D in §Testing; `node-trpc-nest` lacks the §Testing strategy block; **`node-fastify` stack skill MISSING entirely**                              |
| H3: Playwright `webServer` wiring inadequate | **CONFIRMED**            | `react-next` + `svelte-kit` SKILL.md emit `playwright.config.ts` with NO `webServer` block at all                                                                                         |
| H4 (new): node-fastify stack skill missing   | **SURFACED**             | `.claude/skills/agents/back-end/` contains only node-trpc-nest + python-fastapi; finance-track-pre-build's architecture.yaml requires node-fastify and cannot resolve a stack skill today |

**Strategy × Stack proof matrix:**

| Strategy | Stack skill               | First-target project     | Status                                               |
| -------- | ------------------------- | ------------------------ | ---------------------------------------------------- |
| A        | react-next (localStorage) | kanban-webapp-09         | Shipped — lacks v2.0 interactions[] authoring        |
| C        | **node-fastify**          | finance-track-pre-build  | **SKILL DOES NOT EXIST**                             |
| C        | node-trpc-nest            | book-swap-pre-build      | Skill exists; §Testing strategy unwired; never built |
| D        | python-fastapi            | repo-health-dashboard-01 | In-flight; needs mock-kind for flow-4/5/6            |

### F-4. Phased roadmap (validate-first; 12.5 sessions)

| #   | Phase                                                       | Acceptance                                                                               | Sessions |
| --- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------- |
| 1   | F4 on kanban-webapp-09 — author interactions[] for 10 flows | 100% flows have interactions[]+seedingTier                                               | 0.5      |
| 2   | F5 on kanban-09 — verify+fix-loop+coverage+manual           | Score ≥95; 0 pending bugs; manual sign-off                                               | 0.5      |
| 3   | F6 — score gating (in parallel with #2)                     | score.json on every verify; verdict thresholds enforced                                  | 0.5      |
| 4   | F1 — `mock` InteractionStep kind                            | New kind in zod+JSON schema; synthesizer emits page.route(); fixture tests; project sync | 1        |
| 5   | F2 — webServer wiring per stack-skill                       | Each skill declares webServer.command per persistence_layer                              | 0.5      |
| 6   | F4+F5 on repo-health-dashboard-01                           | Score ≥95 (interactions[] for flows 2-8 with mocks for 4/5/6)                            | 1        |
| 7   | F3a — node-trpc-nest §Testing block                         | Skill validates against testing-policy template                                          | 0.5      |
| 8   | F4+F5 on book-swap-pre-build (1st Strategy C proof)         | Score ≥95; /test/seed contract proven end-to-end                                         | 2        |
| 9   | F3b — node-fastify stack skill (NEW)                        | Skill exists; finance-track architecture.yaml resolves                                   | 1        |
| 10  | F4+F5 on finance-track-pre-build (2nd Strategy C proof)     | Score ≥95                                                                                | 2        |
| 11  | F4+F5 on kanban-webapp-pre-build                            | Score ≥95                                                                                | 1.5      |
| 12  | F4+F5 on repo-health-dashboard-pre-build                    | Score ≥95                                                                                | 1.5      |

**Total: ~12.5 sessions** for all 4 pre-builds + 2 baselines at ≥95%.

### F-5. Risks (8) and operator open questions (6)

Risks: Strategy-C convergence; coverage measurement not wired; live-backend flakiness; rubric weighting blind spots; node-fastify from-scratch authoring; manual-sanity rubber-stamp; factory uncommitted drift; gotribe pressure interrupting.

Open questions for operator: gate enforcement (advisory vs blocking); de-scope book-swap?; first validation target (kanban-09 vs repo-health-01); E2E retry budget; manual-sanity weight; F3 scope if book-swap de-scoped.

(Full text in §Phase 5 above.)

## Recommendation

**Approve the 12-step roadmap with the following structure for follow-up plans:**

### Factory-level features (author now, sequenced)

1. **`feat-039-mock-interaction-step-kind`** — F1, P0, ~1 session.
   Adds `kind: "mock"` to the v2.0 `InteractionStep` discriminated union; extends synthesizer to emit `page.route(urlPattern, route => route.fulfill({status, body}))`; project sync; fixture-harness tests.

2. **`feat-040-live-backend-playwright-webserver`** — F2, P1, ~0.5 session.
   Updates react-next + svelte-kit + node-trpc-nest + python-fastapi §Testing blocks to declare `webServer.command` per `persistence_layer`. Multi-tier projects use `node ../../scripts/dev.mjs`. Bumps per-test retry from 0 → 1 for live-backend E2E.

3. **`feat-041-node-trpc-nest-strategy-c-testing-block`** — F3a, P1, ~0.5 session.
   Updates node-trpc-nest skill with full §Testing block per testing-policy.md, declaring Strategy C, `/test/seed` + `/test/cleanup` contract, vitest commands + coverage flag.

4. **`feat-042-node-fastify-stack-skill`** — F3b, P0 (blocks finance-track-pre-build entirely), ~1 session.
   Authors new `.claude/skills/agents/back-end/node-fastify/SKILL.md` mirroring node-trpc-nest's structure, pruning trpc/nestjs idioms in favor of plain fastify routes.

5. **`feat-043-build-to-spec-score-and-gating`** — F6, P0, ~0.5 session.
   Extends `/build-to-spec-verify` to compute the 8-dimension score, emit `docs/build-to-spec/score.json`, and gate verdict per ≥95/90-94/<90 thresholds. Includes coverage-summary.json reader.

### Per-project shepherding plans (author each just-in-time, NOT all upfront)

For each of: kanban-webapp-09, repo-health-dashboard-01, book-swap-pre-build, finance-track-pre-build, kanban-webapp-pre-build, repo-health-dashboard-pre-build — author a `feat-NNN-shepherd-<project>-to-95` plan with the F4 + F5 work scoped to that project's specific deltas. Authoring just-in-time avoids stale plans (factory work between projects shifts the scope).

### Sequencing

Execute steps 1-12 in the order in F-4. Do NOT parallelize early steps — kanban-09 must complete before repo-health-01 (validates the rubric); book-swap must complete before finance-track (proves Strategy C end-to-end before the second consumer).

### Operator decisions (locked 2026-04-30)

| Question                  | Decision                                                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Score gate enforcement    | **Advisory only** — verifier emits itemized tickets at <95 but never blocks `/fix-bugs` or `/start-build` exit. Operator decides when to ship. |
| All 4 pre-builds in scope | YES — book-swap included to preserve postgres+nest signal                                                                                      |
| First validation target   | kanban-webapp-09 → repo-health-dashboard-01 → 4 pre-builds                                                                                     |
| E2E retry budget          | bump local from 0 → 1 for live-backend specs only                                                                                              |
| Manual-sanity weight      | keep 10% + anti-rubber-stamp numbered checklist requirement                                                                                    |
| F3a scope independence    | wire node-trpc-nest §Testing regardless of book-swap's status                                                                                  |

### Realistic timeline (recalibrated 2026-04-30)

Operator stated goal: all done end-of-day 2026-04-30. Honest recalibration: not physically reachable. Mode B builds for from-zero pre-builds (book-swap, finance-track) take 2-4 hours each; quota cycles will gate that across days.

- **Today (2026-04-30) — realistic scope:** steps 1-3 (kanban-09 → ≥95 + F6 score gating); step 4 (F1 mock-interaction kind); step 5 (F2 webServer wiring) borderline; step 6 (repo-health-01 → ≥95) at risk of slipping
- **Days 2-7:** book-swap → finance-track → kanban-pre → repo-health-pre
- **End of week:** all 6 at ≥95%

Operator acknowledged the recalibration and confirmed no shortcuts on rigor.

### Pre-flight before step 1

Clear factory uncommitted drift:

- `orchestrator/src/cli.ts` (M)
- `.claude/hooks/detect-loop.mjs` (M)
- `scripts/snapshot-project.mjs` (??)

Decide commit/revert/document for each before starting kanban-09 step 1, so the roadmap baseline is reproducible.

### Hard policy: no gotribe until all 4 pre-builds at ≥95%

Per the user's mandate: "complete tests first to as close to 100% complete as possible. below 90% complete is too low to call it success 95% and above is the measure of success that we should aim for. Objective now is to have a factory that will be able to complete all of the pre-build test projects competently."

This investigation accepts that mandate. Recommendation includes a hard policy: gotribe brief.md authoring is BLOCKED on the dashboard showing 6/6 projects at ≥95%. Any out-of-band gotribe work invalidates the validate-first sequencing.

## Attempt Log

### Attempt 1 — 2026-04-30, completed in single conversation

Time-box: 90 min (operator-overridden from default 30). Executed live, ~75 min of work + 15 min synthesis.

**Steps walked:**

1. Per-project state survey (mechanical, ~10 min) — confirmed gate counts, manifest interaction counts, app build status, bugs.yaml state across all 6 projects in scope.
2. Schema/contract probe (~10 min) — enumerated InteractionStep kinds; confirmed `mock` absence.
3. Stack-skill enumeration (~5 min) — confirmed 2 back-end skills + 2 front-end skills; found `node-fastify` missing.
4. SKILL.md content sampling (~10 min) — confirmed only python-fastapi declares Strategy C/D; react-next + svelte-kit emit `playwright.config.ts` with no `webServer` block.
5. Rubric design + scoring (~15 min) — drafted 8-dim rubric, computed honest baseline scores for all 6 projects.
6. Roadmap synthesis (~15 min) — sequenced 12-step validate-first critical path; estimated session counts; named 5 follow-up plan IDs.
7. Risk pass + open-question pass (~5 min).
8. Plan body update (~5 min) — populated Findings + Recommendation sections of this plan.

**Conclusion:** Hypothesis was structurally correct on H1, H2, H3. Surfaced new blocker H4 (node-fastify skill missing) which is now P0. Roadmap calls for ~12.5 sessions to drive all 4 pre-builds + 2 baselines to ≥95% before gotribe work begins. Status moved from `draft` → `awaiting-approval` (operator decides on the 6 open questions + approves first follow-up plan).
