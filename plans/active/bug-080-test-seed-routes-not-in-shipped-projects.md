---
id: bug-080-test-seed-routes-not-in-shipped-projects
type: bug
status: draft
author-agent: human
created: 2026-05-08
updated: 2026-05-08
parent-plan: null
branch: fix/test-seed-routes-not-in-shipped-projects
affected-files:
  - .claude/skills/agents/back-end/node-fastify/SKILL.md
  - .claude/skills/architect/SKILL.md
  - .claude/skills/pm/SKILL.md
feature-area: orchestrator/scaffolding
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "POST http://localhost:3001/test/cleanup → 404 (Not Found) on reading-log-02 (and likely other shipped node-fastify projects)"
---

# bug-080: /test/cleanup + /test/seed-baseline endpoints not in shipped node-fastify projects

## Bug Description

Per `.claude/rules/testing-policy.md` Strategy-C-test-seed-contract (bug-042 Phase A.5/B), every full-stack project with a managed DB MUST expose three gated endpoints under `/test/*`, registered ONLY when `ENABLE_TEST_SEED=1`:

- `POST /test/seed`
- `POST /test/cleanup`
- `POST /test/seed-baseline`

Empirical case 2026-05-08: reading-log-02 (node-fastify backend, shipped through full pipeline) returns **404 Not Found** for `POST /test/cleanup`. Likely also missing `/test/seed-baseline`. This means:

- E2E synthesized flows that depend on per-test cleanup hit 404 in beforeAll → flow fails OR silently degrades
- The fix-bugs loop's "shell game" pattern (investigate-025 §H1 finding) is exacerbated because state can't be reset between iterations
- Per-bug verifier signal becomes non-deterministic across iterations

This is plausibly NOT just a reading-log-02 issue — likely affects all node-fastify projects shipped before whatever skill update was supposed to add the routes. Investigation needed to determine actual scope.

## Reproduction Steps

1. `cd projects/reading-log-02 && node scripts/dev.mjs`
2. `curl -X POST -H "Content-Type: application/json" -d '{"tables":["BookTag"]}' http://localhost:3001/test/cleanup`
3. Observe: `404 Not Found`
4. Repeat for: `/test/seed-baseline`, `/test/seed`
5. Verify scope: same probe against finance-track-01 (also node-fastify) — does it have them?

## Root Cause Analysis

Possibilities to investigate:

### Hypothesis A — Skill update post-dates project scaffold
The `.claude/skills/agents/back-end/node-fastify/SKILL.md` was updated to include the test-seed routes per bug-042 Phase A.5 (2026-05-03), but reading-log-02 was scaffolded BEFORE that — never picked up the change.

Check: when was reading-log-02 scaffolded? When was bug-042 Phase A.5 shipped? Confirm scaffolding chronology.

### Hypothesis B — Skill has the routes but the architect / PM didn't task them
The skill defines the contract but the architect's task graph or PM's task breakdown didn't generate a task that required the builder to wire them in. Without a task in `docs/tasks.yaml` referencing test-seed routes, the backend-builder never authored them.

Check: read the architect skill + PM skill for test-seed task generation logic; check reading-log-02's docs/tasks.yaml for any test-seed-related task.

### Hypothesis C — ENABLE_TEST_SEED env not set in dev.mjs
The routes only register when `ENABLE_TEST_SEED=1`. If dev.mjs / .env.example / .env.local doesn't set this, the routes ARE in the code but skipped at boot.

Check: grep ENABLE_TEST_SEED across reading-log-02; check apps/api/src/server.ts for the conditional registration.

### Hypothesis D — Combination
Most likely: the routes exist conditionally + dev.mjs doesn't set the env + project scaffolding doesn't include the env.

## Fix Approach

Phase A — Investigation (~30 min, time-boxed):

1. Check reading-log-02's apps/api/src/* for any `/test/*` route handlers
2. Check apps/api/src/server.ts for `ENABLE_TEST_SEED` conditional registration
3. Check apps/api/.env.example + scripts/dev.mjs for the env var
4. grep across other shipped node-fastify projects (finance-track-01) — same gap?
5. Check `.claude/skills/agents/back-end/node-fastify/SKILL.md` for the canonical route definition — does it exist?
6. Check `.claude/skills/architect/SKILL.md` + `.claude/skills/pm/SKILL.md` for test-seed task generation

Output: which hypotheses confirmed, which falsified.

Phase B — Fix (depending on findings):

- If skill missing the routes: ADD them per testing-policy contract; backport to existing skill
- If skill has routes but tasks don't reference them: update PM/architect skill to ALWAYS generate a test-seed-routes task for projects with managed DB
- If env not set in dev.mjs: update `scripts/dev.mjs` template to set `ENABLE_TEST_SEED=1` for dev mode
- If conditional registration missing in server.ts: ADD it per the canonical pattern

Phase C — Backfill (depending on findings):

- For shipped projects affected (reading-log-02, possibly others): ship the fix in each project's repo
- Track via a checklist in `docs/test-seed-backfill.md`

## Rejected Fixes

- **Disable the synthesized flows that depend on /test/cleanup until backfill is complete.** Rejected because flow E2E coverage is load-bearing for the verifier; disabling them would create silent gaps in detection.
- **Hardcode the test-seed routes in every project ad-hoc.** Rejected — the skill is the canonical source; ad-hoc fixes drift over time.

## Validation Criteria

1. Phase A investigation produces findings for all 4 hypotheses
2. Phase B fix lands in factory skill
3. Phase C backfill confirmed on reading-log-02 + finance-track-01: `curl /test/cleanup` returns 204
4. New /new-project scaffolds (test-rig project) have working /test/* endpoints out of the box
5. E2E synthesized flow's beforeAll cleanup succeeds

## Cross-references

- Surfaced via investigate-025 Step 1 census (reading-log-02 walkthrough 2026-05-08)
- Sister contract: `.claude/rules/testing-policy.md` Strategy-C-test-seed-contract
- Architectural dependency: bug-042 Phase A.5 (the contract definition)
- Cross-axis: bug-078 Phase 1B includes `tooling-test-seed-contract-broken` deterministic discriminator that would catch projects with this gap going forward

## Attempt Log

<!-- Populated by executing agents. -->
