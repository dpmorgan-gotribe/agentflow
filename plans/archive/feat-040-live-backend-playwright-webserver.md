---
id: feat-040-live-backend-playwright-webserver
type: feature
status: archived
completed-at: 2026-04-30
approved-at: 2026-04-30
approved-by: human
author-agent: claude-opus-4-7
created: 2026-04-30
updated: 2026-04-30
parent-plan: investigate-012-factory-readiness-pre-builds
supersedes: null
superseded-by: null
branch: feat/quota-observability
affected-files:
  - .claude/skills/agents/front-end/react-next/SKILL.md
  - .claude/skills/agents/front-end/svelte-kit/SKILL.md
  - .claude/skills/agents/back-end/python-fastapi/SKILL.md
  - .claude/skills/agents/back-end/node-trpc-nest/SKILL.md
  - .claude/skills/agents/back-end/node-fastify/SKILL.md
  - .claude/templates/playwright.config.ts.template
feature-area: orchestration
priority: P1
attempt-count: 0
max-attempts: 5
---

# feat-040 — Live-backend Playwright `webServer` wiring per stack-skill

## Problem Statement

F2 of `investigate-012`. The `react-next` + `svelte-kit` stack skills' §Testing blocks declare a `playwright.config.ts` template with NO `webServer` block — Playwright runs against `http://localhost:3000` assuming the operator has booted dev manually. This is broken for multi-tier projects (Strategy C + Strategy D) because:

- `webServer.command = "pnpm dev"` only boots Next on :3000; the FastAPI / Express / Nest backend is never started, so SPA `/api/...` calls 404 or time out.
- Per-project hand-fixes work (we did this for `repo-health-dashboard-01` in feat-045 turn 19) but don't scale across 4 pre-builds + future projects.

The factory has `scripts/dev.mjs` (bug-032 Phase B) that orchestrates both halves with port coordination. Promoting it into stack-skill scaffolds means every multi-tier project gets a working `webServer` block at build time.

## Approach

### Phase 1 — Author per-stack `webServer` decision matrix

Stack skill `webServer.command` defaults per `architecture.yaml.tooling.stack.persistence_layer`:

| persistence_layer                | webServer.command                                | Notes                                                               |
| -------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------- |
| `localStorage` (Strategy A)      | `"pnpm exec next dev"` (or framework equivalent) | Single-tier; only frontend                                          |
| `external-api-only` (Strategy D) | `"node ../../scripts/dev.mjs"`                   | Multi-tier; needs backend for live calls + Playwright route() mocks |
| `real-db` (Strategy C)           | `"node ../../scripts/dev.mjs"`                   | Multi-tier with DB; needs `/test/seed` endpoint reachable           |

### Phase 2 — Update front-end stack skills

- `.claude/skills/agents/front-end/react-next/SKILL.md` §Testing — add the per-strategy webServer template fragment
- `.claude/skills/agents/front-end/svelte-kit/SKILL.md` §Testing — same
- Front-end builder dispatch reads `architecture.yaml.tooling.stack.persistence_layer` and emits the correct `webServer` block

### Phase 3 — Update back-end stack skills' §Testing-coordination notes

- `python-fastapi`, `node-trpc-nest`, `node-fastify` (when shipped) all declare in §Testing: "the front-end's `playwright.config.ts.webServer` must invoke `node ../../scripts/dev.mjs` to boot us alongside Next; do not hand-roll separate `pnpm dev` invocations per tier"

### Phase 4 — Bump retry budget for live-backend specs

Per investigate-012 §F-5 decision: `retries: process.env.CI ? 2 : 1` (was `: 0`) when persistence_layer ≠ `localStorage`.

### Phase 5 — Sync to projects + propagate

- `node scripts/sync-project-schemas.mjs --all` if any schema fields touched (none expected)
- Manually copy updated SKILL.md files to the 5 explicit-target projects

## Rejected Alternatives

- **Add `webServer` blocks to a single shared playwright.config.ts.template** — hides the per-strategy decision behind a template; operator can't see WHY their config was emitted. Per-stack-skill is more transparent.
- **Always boot `scripts/dev.mjs` regardless of strategy** — wastes startup time for Strategy A projects (booting an unnecessary backend). Per-strategy is leaner.
- **Land this WITHIN feat-045 (the repo-health-01 shepherding)** — would couple a per-project hot-fix with a factory-wide rollout. Cleaner to ship F2 as its own plan; feat-045 records the de facto pre-shipment as an attempt-log carryover.

## Expected Outcomes

- [ ] react-next + svelte-kit SKILL.md §Testing blocks declare per-strategy `webServer.command`
- [ ] python-fastapi + node-trpc-nest + node-fastify §Testing blocks reference the front-end webServer contract
- [ ] Front-end builder emits correct `webServer` block based on `persistence_layer`
- [ ] Retries bumped to 1 for non-Strategy-A persistence layers
- [ ] All 12 projects synced + 5 explicit targets manually updated

## Validation Criteria

- New from-zero project that hits `/start-build` with `persistence_layer=external-api-only` produces a `playwright.config.ts` with `webServer.command = "node ../../scripts/dev.mjs"` automatically — no manual fix needed
- Schema sync run produces no surprise diffs

## Attempt Log

### Attempt 1 — 2026-04-30 — shipped + synced

react-next + svelte-kit SKILL.md §Testing now emit `webServer.command="node ../../scripts/dev.mjs"` for multi-tier (Strategy C/D); `pnpm exec next dev` for Strategy A. Retries bumped 0→1 for live-backend specs. python-fastapi + node-trpc-nest + node-fastify §Testing blocks reference the front-end webServer contract. Synced to all 12 react-next consumers via `sync-project-schemas.mjs --all`. The de facto pre-ship on `repo-health-dashboard-01` (feat-045 Phase B turn-19 hand-fix) became the empirical reference; rollout matched the hand-fix pattern 1:1.

**Outcome:** success.

---

# COMPLETION RECORD (appended to archived plan)

completed: 2026-04-30
outcome: success
actual-files-changed:

- .claude/skills/agents/front-end/react-next/SKILL.md (modified)
- .claude/skills/agents/front-end/svelte-kit/SKILL.md (modified)
- .claude/skills/agents/back-end/python-fastapi/SKILL.md (modified)
- .claude/skills/agents/back-end/node-trpc-nest/SKILL.md (modified)
- .claude/skills/agents/back-end/node-fastify/SKILL.md (modified — concurrent with feat-042)
- .claude/templates/playwright.config.ts.template (modified)
  commits:
- hash: 0b6fe06
  message: "factory: investigate-012 roadmap — feat-039/040/041/042 + bug-033 + bug-119-class testing-policy hardening"
  attempts: 1
  lessons:
- "Per-strategy webServer.command (vs single shared template) keeps the decision visible to the operator: they can see WHY their config invokes dev.mjs vs next dev directly. Stack skill §Testing is the right home — it's the surface the operator already reads when debugging E2E."
- "Strategy A projects should NOT boot dev.mjs (no backend to co-launch) — wastes startup time and risks port-collision noise. The strategy split avoids paying the multi-tier cost on single-tier projects."
- "retries: 1 (was 0) for non-Strategy-A is the right floor — live-backend has measurable network jitter; pure localStorage flows shouldn't need retries because there's nothing to flake on."
  test-results:
  unit: n/a (skill-doc + template change; exercised at synthesizer + project run time)
  integration: feat-045 flows 1-3 + 7-8 ran live against repo-health-dashboard-01 backend booted via `node ../../scripts/dev.mjs` — all hit the FastAPI proxy successfully (with bug-033's env propagation fix in place)
  duration-minutes: ~75 (single session, parallel with feat-039/041/042 + bug-033)
