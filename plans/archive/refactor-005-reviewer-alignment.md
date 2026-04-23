---
id: refactor-005-reviewer-alignment
type: refactor
status: completed
approved-at: 2026-04-23
approved-by: human
completed-at: 2026-04-23
author-agent: human
created: 2026-04-23
updated: 2026-04-23
parent-plan: investigate-002-build-tier-readiness-gap
supersedes: null
superseded-by: null
branch: refactor/reviewer-alignment
affected-files:
  - scaffolding/18-032-reviewer-agent.md
  - docs/reviewer-playbook.md
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
---

# refactor-005-reviewer-alignment: spec refresh for reviewer (pre-feat-010)

## Problem Statement

The current `scaffolding/18-032-reviewer-agent.md` is **68 lines and pre-refactor-004** — it predates the feature-graph Mode B worktree pattern, the feat-004 hybrid-TDD policy (where tester owns edge cases + integration + E2E while builders own happy-path), and the feat-002 stack-dispatch shelf (where reviewer dispatches per-tier to stack skills' §Review blocks). The existing "review checklist" is 6 high-level bullet points without pass/fail criteria — the blueprint's own warning "without explicit criteria, the verifier becomes theater" applies here.

Per investigate-002 resolved-question #4: `reviewer-playbook.md` is a required artefact. Concrete pass/fail criteria per dimension. Not AI-judgment blackbox.

Per build-tier-roadmap.md plan #3, refactor-005 is **spec-refresh only**. feat-010 (next plan) does the implementation; refactor-005 ships the reference material feat-010 binds to.

## Approach

Three phases. No runtime code, no tests.

### Phase 1 — Scaffolding refresh (`scaffolding/18-032-reviewer-agent.md`)

Update the scaffolding file to reflect current state:

1. **Position in pipeline (refactor-004 Mode B)**: reviewer runs INSIDE a feature worktree per `feature.agent_sequence[]`, AFTER tester completes. Last agent in the typical chain. Reads CWD = `.claude/worktrees/{feature.worktree}/`.
2. **Builder/tester handoff awareness (feat-004 hybrid-TDD)**: reviewer reads builder's happy-path tests + tester's edge-case tests + tester's coverage numbers + tester's `genuineProductBugs[]`. Reviewer is NOT a re-tester — it checks quality dimensions the test suite can't detect.
3. **Stack dispatch (feat-002)**: for each tier present in `tooling.stack.*`, reviewer loads the matching stack skill's §Review block (or §Gotchas — stack skills document stack-specific anti-patterns). Filter-then-load per feat-009 lesson: only load stack skills for tiers with reviewable code in scope.
4. **Return JSON contract**: `ReviewerOutput` — to be Zod-schema'd in feat-010 Phase 1. Shape: `{ featureId, dimensions: { architecture, security, compliance, maintainability, a11y, performance, briefDelivery }, overallVerdict: "approved" | "needs-revision" | "blocked", issuesFound: ReviewIssue[], retryTargets: { agent, taskIds[] }[], headSha, warnings }`.
5. **Retry routing**: on `needs-revision`, reviewer's `retryTargets[]` names which agent(s) should revisit which task(s). Orchestrator routes per refactor-004 per-task retry ladder (max 3). Common cases: security issue in backend code → retryTargets=[{agent: "backend-builder", taskIds: [...]}].
6. **Agent-history append**: same pattern as other agents — one entry on completion; set `last_writing_agent: "reviewer"` IF reviewer commits a fix (rare — normally reviewer only reads + reports). Most invocations don't commit; agent_history still gets the reviewer entry.
7. **Acceptance criteria rewritten** against the 7 dimensions enumerated in the playbook (phase 2).

**Exit**: scaffolding file is self-contained + current. Reading it plus the playbook tells feat-010 authors exactly what to build.

### Phase 2 — Playbook (`docs/reviewer-playbook.md`)

Author `docs/reviewer-playbook.md` with 7 review dimensions. For each:

1. **What it checks**
2. **Concrete pass/fail criteria** (grep commands, tool invocations, thresholds — no judgment-blackbox)
3. **Known-gap statement** (what's explicitly deferred to post-mvp-scaffolding)
4. **Retry target** (which builder/tester does a revision request go back to?)

**7 dimensions per investigate-002 decision log + build-tier-roadmap answer #2:**

1. **Architecture adherence**
   - Does every integration in architecture.yaml appear in committed code? (grep `integration_ref` paths)
   - Does `tooling.stack.*` match the app directories built (e.g. `apps/api/` scaffolded for node-trpc-nest, not FastAPI)?
   - Does `tasks.yaml features[].status` agree with committed work (no "completed" features with uncommitted tasks)?
   - Retry target: backend-builder / web-frontend-builder / mobile-frontend-builder

2. **Security** (MVP 15-item checklist; ASVS L1 full expansion deferred to `post-mvp-scaffolding/security-checklist-grounding.md`)
   - SQLi — prepared statements / ORM parameterization
   - XSS — output encoding on user-supplied text, no `dangerouslySetInnerHTML` without sanitizer
   - Auth bypass — every protected route has middleware guarding it
   - CSRF — state-changing POSTs have CSRF tokens or are cookie-SameSite=strict
   - Rate limiting — auth + password-reset + payment endpoints all have rate limits
   - Secret leakage — `.env` never imported by committed source files; no hex-like strings that look like keys in code
   - SSRF — URL fetch in user-supplied content goes through an allow-list
   - CORS — not `*` for credentialed endpoints
   - Input validation — every endpoint validates via Zod/Pydantic at the boundary
   - Output encoding — no raw SQL string-interpolation; no raw HTML concatenation
   - Crypto misuse — no `md5` / `sha1` for new code; no `Math.random()` for tokens
   - Session fixation — session IDs regenerated on login
   - IDOR — endpoint ownership checks present (user X can't read user Y's data)
   - File-upload abuse — extension + MIME + size validated; virus-scan if present
   - Rate-limit bypass — IP + user-id keying (not just one)
   - Retry target: backend-builder (most) / web-frontend-builder / mobile-frontend-builder

3. **Compliance per brief §14**
   - GDPR consent — cookie banner + data-processing consent flow present if `architecture.yaml.compliance.gdpr: true`
   - COPPA age-gate — if `compliance.coppa_under_13: excluded`, signup has age-gate rejecting <13
   - Data retention — privacy policy URL referenced; retention period documented
   - Export flow — "export my data" endpoint exists if GDPR
   - Delete flow — account-delete endpoint exists if GDPR
   - KYC/AML wiring — Stripe Identity (or equivalent) wired if `compliance.kyc_aml` set
   - Retry target: backend-builder + frontend-builder per endpoint

4. **Maintainability**
   - `pnpm typecheck` exit 0 across all packages
   - `pnpm lint` exit 0; rule config matches `eslint-plugin/` in ui-kit for frontend tiers
   - No TODOs in shipped code (grep `^\s*(TODO|FIXME|XXX|HACK)` — zero hits)
   - Public API documented (JSDoc/tsdoc on every exported function in `packages/types/` + `packages/api-client/` + service layer)
   - No `any` type without comment justifying (grep `: any` excluding lines with `// eslint-disable-next-line` or inline comment explaining)
   - No dead imports — `pnpm knip` or tsc `noUnusedLocals` (already enabled in `tsconfig.base.json`)
   - Retry target: whoever wrote the file

5. **A11y (MVP depth; deep axe-core integration deferred to `post-mvp-scaffolding/a11y-deep-coverage.md`)**
   - `:focus-visible` exists on every interactive element — grep CSS + JSX
   - Keyboard-reachable — no mouse-only handlers; every `onClick` also has `onKeyDown` OR is a `<button>` (has built-in keyboard support)
   - Semantic landmarks — every page has exactly one `<main>`, `<header>`, `<nav>` as appropriate
   - Form labels — every `<input>` has an associated `<label>` (by `htmlFor` or wrapping)
   - ARIA roles — no ARIA on native elements that already have it (button[role=button] etc.)
   - Retry target: web-frontend-builder / mobile-frontend-builder

6. **Performance signals**
   - Web: bundle-size diff vs `main` baseline (stretch: <5% growth); LCP target 2.5s on Lighthouse CI if the stack skill names Lighthouse
   - Mobile: bundle size; Hermes bytecode size for Expo
   - Backend: p95 endpoint response time <200ms per endpoint via `wrk`/`artillery` if a runnable dev server exists
   - Retry target: builder that owns the offending file

7. **Brief-delivery** (per investigate-002 answer #5 — static analysis, not runtime walkthrough)
   - Walk `tasks.yaml.features[]` — every feature with `status: "completed"` (merged to main) must have:
     - Each `integration_ref` resolving to actual code that imports the vendor SDK
     - Each task's `summary` reflected in a commit message on the feature's merge chain
   - Walk brief §11 catalog: every feature entry maps to a tasks.yaml features[] entry OR a documented deferral
   - Retry target: architect (if `integration_ref` is wrong) / pm (if features[] groups wrongly) / builder (if code doesn't match task summary)

For each dimension also include:

- **Tool invocation** — exact command reviewer runs (e.g. `pnpm -r typecheck`, `grep -rE '(TODO|FIXME|XXX|HACK)' apps/ packages/`, `npx knip`)
- **Pass threshold** — exact numeric or grep-match criterion (e.g. "zero hits", "exit 0", "<200ms p95")
- **What counts as needs-revision vs blocked**: needs-revision = actionable by a builder within retry budget; blocked = spec contradiction (requires human)

**Exit**: `docs/reviewer-playbook.md` is the operational reference. feat-010's skill will cite it directly per dimension.

### Phase 3 — Archive

1. Move plan from `plans/active/` to `plans/archive/`.
2. Update `plans/active.md` manifest.
3. Commit.

No scaffolding move — `18-032-reviewer-agent.md` stays in `scaffolding/` until feat-010 ships its implementation. (This refactor-005 plan updates the SPEC but doesn't complete the SCAFFOLDING task.)

## Rejected Alternatives

- **Alternative A: Merge the playbook into the scaffolding file (single-file spec)** — Rejected. The scaffolding file describes how feat-010 should BUILD the skill; the playbook describes how the skill RUNS at review time. Different audiences (plan author vs running agent) + different lifetimes (scaffolding archives when feat-010 ships; playbook stays canonical forever).

- **Alternative B: Make the 7 dimensions configurable per-project** — Rejected for MVP. All 7 apply universally; per-project config adds complexity without a clear use case. Dimensions 2 (security) + 3 (compliance) both reference project-specific data (`architecture.yaml.compliance`), which is sufficient customization.

- **Alternative C: Defer the playbook to feat-010** — Rejected. Per roadmap + investigate-002 answer #4, the playbook is a required artefact BEFORE the implementation plan. Without concrete criteria, feat-010 would either hand-wave ("review each dimension") or rediscover them; the playbook is the contract feat-010 implements against.

- **Alternative D: Defer brief-delivery to tester** — Rejected. Tester owns TEST coverage, not code-matches-brief. Brief-delivery is a cross-reference check (does code deliver what tasks.yaml promised?) that needs to read tasks.yaml + architecture.yaml + git log — reviewer's natural scope. Answer #5 already settled this.

- **Alternative E: Deep a11y + axe-core now instead of MVP depth** — Rejected. `post-mvp-scaffolding/a11y-deep-coverage.md` exists precisely because axe-core adds a non-trivial runtime (Playwright a11y tree dump, rule registry) that doesn't pay off until the app has real users. MVP depth is focus + keyboard + semantics + labels = ~80% of real a11y bugs caught at near-zero cost.

## Expected Outcomes

- [ ] `scaffolding/18-032-reviewer-agent.md` rewritten to reflect refactor-004 + feat-002 + feat-004 + feat-007/008/009 current state (worktree CWD, stack-dispatch, filter-then-load, happy-path-owned-by-builder, ReviewerOutput contract skeleton)
- [ ] `docs/reviewer-playbook.md` authored with 7 dimensions × 4 fields each (checks / pass-fail criteria / known-gap statement / retry target)
- [ ] Every security/compliance/maintainability check has an exact tool invocation + threshold (no judgment-blackbox language)
- [ ] Known gaps explicitly pointed at post-mvp-scaffolding/ stubs (security-checklist-grounding, a11y-deep-coverage, brief-delivery-validation-depth)
- [ ] Plan archived; active.md updated

## Validation Criteria

**Scaffolding refresh:**

- grep `18-032-reviewer-agent.md` for the word `worktree` — ≥1 hit (refactor-004 Mode B awareness)
- grep for `stack skill` / `stack-slug` — ≥1 hit (feat-002 dispatch)
- grep for `tester` — ≥1 hit (feat-004 handoff awareness)
- grep for `ReviewerOutput` — ≥1 hit (contract skeleton)
- Word count ≥500 (current 68 lines was insufficient)

**Playbook:**

- 7 dimensions, each as `## <N>. <Dimension>` section heading (grep `^## \d\.` returns 7)
- Each dimension has a `### Tool invocation` subsection with a concrete command (grep returns 7)
- Each dimension has a `### Pass threshold` subsection (grep returns 7)
- Each dimension has a `### Retry target` subsection
- Each dimension has a `### Known-gap` subsection linking to post-mvp-scaffolding/ where relevant

**No regression:**

- `pnpm test:all` green (no source code touched)
- Nothing in `orchestrator/` / `packages/` changes — pure docs refresh
- Existing scaffolding archive integrity preserved

## Attempt Log

### Attempt 1 — 2026-04-23 (succeeded in 2 phases + archive)

2 commits on `refactor/reviewer-alignment`:

- Phase 1 (e4a2d82): `scaffolding/18-032-reviewer-agent.md` refresh. 68 → 191 lines. Added refactor-004 worktree CWD awareness, feat-004 hybrid-TDD handoff semantics (no re-testing), feat-002 stack dispatch with filter-then-load, 8-step dispatcher, `ReviewerOutput` contract skeleton for feat-010, 7 hard rules, downstream implications (close-feature gated on approval; task-036 gate-6 as next human touch). Validation greps: worktree 6×, stack skill 5×, tester 12×, ReviewerOutput 8×.
- Phase 2 (ddaf236): `docs/reviewer-playbook.md` authored. 484 lines covering 7 dimensions × 4 fields each (what-it-checks / tool invocation / pass threshold / known-gap / retry target). 13 post-MVP deferral pointers. Every check names an exact grep/tool invocation + threshold — zero judgment-blackbox language.
- Phase 3 (this commit): archive.

**No runtime code shipped; no tests run; no regressions possible.** Pure spec-refresh per roadmap plan #3 intent.

## Lessons Learned

**Scaffolding files drift fast without discipline.** The 18-032 file was 68 lines of pre-refactor-004 assumptions, written before worktree Mode B + hybrid-TDD + stack dispatch existed. Five major refactors had landed between its authoring and feat-010's need for a current spec. **Action**: when a refactor ships, audit downstream scaffolding files for staleness and re-align them in the same plan where practical. This prevents "we refactored X but scaffolding/NN still says the pre-X way" drift.

**Concrete-criteria-in-writing is load-bearing for review agents.** The pre-refresh spec had "Security: no secrets in code, proper auth checks, input validation" — a 12-word bullet that a reviewer would fill in from general-purpose LLM priors. The refreshed playbook has 15 security checks with exact grep invocations + thresholds. Concretely: the pre-refresh version would have reviewed 100 different features 100 different ways; the post-refresh version reviews them identically. Consistency is the point of a playbook — not cleverness.

**Tool-unavailable skipping must be distinguishable from failure.** Lighthouse + axe-core + artillery all require a running dev server (or special installs). Scratch-repo smoke tests + first-run pipelines don't have these. The playbook distinguishes `status: "skipped"` (missing tooling — warning) from `status: "fail"` (actual violation). Without this distinction, scratch-repo tests would always block on perf — impractical. **Implication for feat-010**: dimension-skipping logic needs test coverage; ReviewerOutput Zod's DimensionResult union makes this explicit.

**Retry routing precision affects retry ladder efficiency.** If reviewer flags "security issue" without naming which builder, orchestrator has to re-invoke all 3 builders per-task, burning retry budget. Playbook forces `retryTarget.agent` + `retryTarget.taskIds[]` on every needs-revision issue. **Implication for feat-010**: `ReviewerOutput.retryTargets[]` is required; reviewer invocations with `overallVerdict: "needs-revision"` but empty retryTargets should fail contract validation.

**Known-gap-via-deferral-pointer is better than "TODO".** Each dimension explicitly links to the post-mvp-scaffolding file that owns the deeper treatment. A future reviewer reading the playbook sees "A11y MVP here; deep coverage in post-mvp-scaffolding/a11y-deep-coverage.md" — clear ownership + scope. No vague "future work" language.

**The scaffolding vs playbook split is load-bearing.** One-file would conflate build-time spec (how feat-010 authors the skill) with run-time spec (how the skill runs per invocation). Different audiences (plan author vs running agent), different lifetimes (scaffolding archives when feat-010 ships; playbook stays canonical forever). Splitting matches the plan vs runtime separation we already have elsewhere.

## Follow-up Work Unblocked

- **feat-010 reviewer-implementation** — directly unblocked. The scaffolding file tells feat-010 authors what to build; the playbook tells the built skill how to operate at runtime. Both are ready.
- **Stack skill §Review / §Gotchas block backfill** — a known-gap flagged in Phase 1 scaffolding. When stack skills (node-trpc-nest, react-next, expo-rn, python-fastapi, svelte-kit) lack §Review, reviewer falls back to the generic playbook and flags `stack-review-block-missing` as a warning. **Follow-up**: a future sweep to add §Review blocks to each shipped stack skill — ideally as a single cleanup plan before first live Mode B run, OR as part of feat-010 Phase 5 smoke-test observations.
- **`scripts/audit-brief-delivery.mjs`** — helper referenced in dimension 7. Does not exist yet. Reviewer can inline the grep logic in feat-010, OR we ship the standalone script as a side-quest. Recommendation: defer the script; inline in feat-010 works for MVP.

Follow-ups NOT addressed:

- **Runtime brief-delivery walkthrough** (option B) — fully deferred to `post-mvp-scaffolding/brief-delivery-validation-depth.md` per the decision log.
- **Automated SAST scan** (semgrep/snyk/trivy) — defer to CI layer, outside reviewer scope.
- **Full ASVS L1 checklist** — deferred to `post-mvp-scaffolding/security-checklist-grounding.md`.
- **Axe-core + Lighthouse CI + artillery baseline** — all tooling-heavy; defer to CI + `post-mvp-scaffolding/` per dimension cross-reference index.
