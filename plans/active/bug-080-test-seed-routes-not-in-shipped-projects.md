---
id: bug-080-test-seed-routes-not-in-shipped-projects
type: bug
status: completed
author-agent: human
created: 2026-05-08
updated: 2026-05-11
parent-plan: null
branch: feat/quota-observability
affected-files:
  - .claude/skills/architect/SKILL.md
  - .claude/skills/agents/back-end/node-fastify/SKILL.md
  - .claude/skills/agents/back-end/python-fastapi/SKILL.md
  - .claude/skills/agents/back-end/node-trpc-nest/SKILL.md
  - .claude/templates/dev-multi-tier-node-fastify.mjs.template
  - .claude/templates/dev-multi-tier-node-express.mjs.template
  - .claude/templates/dev-multi-tier-node-trpc-nest.mjs.template
  - .claude/templates/dev-multi-tier-python-fastapi.mjs.template
  - projects/reading-log-02/apps/api/.env.example
  - projects/reading-log-02/BACKPORTS.md (new)
feature-area: orchestrator/scaffolding
priority: P0
attempt-count: 1
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

1. Check reading-log-02's apps/api/src/_ for any `/test/_` route handlers
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
4. New /new-project scaffolds (test-rig project) have working /test/\* endpoints out of the box
5. E2E synthesized flow's beforeAll cleanup succeeds

## Cross-references

- Surfaced via investigate-025 Step 1 census (reading-log-02 walkthrough 2026-05-08)
- Sister contract: `.claude/rules/testing-policy.md` Strategy-C-test-seed-contract
- Architectural dependency: bug-042 Phase A.5 (the contract definition)
- Cross-axis: bug-078 Phase 1B includes `tooling-test-seed-contract-broken` deterministic discriminator that would catch projects with this gap going forward

## Attempt Log

### Attempt 1 — 2026-05-11 — shipped (factory) + operator-pending (project)

**Phase A — Investigation findings:**

- Hypothesis A (skill update post-dates project) — **FALSIFIED**. Routes ARE in `apps/api/src/routes/test-seed.ts` (all 3 endpoints — `/seed`, `/cleanup`, `/seed-baseline`). Skill mandates them; project has them.
- Hypothesis B (skill has routes but tasks didn't task them) — **FALSIFIED**. Routes exist + correctly gated in `apps/api/src/app.ts:38`: `if (process.env.ENABLE_TEST_SEED === "1") { await app.register(testSeedRoutes, { prefix: "/test" }); }`.
- Hypothesis C (`ENABLE_TEST_SEED` env not set) — **CONFIRMED**. All 4 reading-log projects ship with `ENABLE_TEST_SEED=0` in project-root `.env`, `apps/api/.env`, AND `apps/api/.env.example`. The skill contract (node-fastify §3 step 4) says `=1`, but some agent emits `=0`. Plus the bug-071 fix's `dev.mjs` template uses `MERGED_ENV.ENABLE_TEST_SEED ?? "1"` — the `??` doesn't fire when value is `"0"`, so `.env`'s `=0` wins over the dev default.
- Hypothesis D (combination) — partially confirmed (Hypothesis C alone explains the manual-dev 404).

**Verifier impact assessment:**

- **Orchestrator path** (`orchestrator/src/dev-server.ts:230` sets `ENABLE_TEST_SEED: "1"` in spawn env): probably works — child inherits the override; `import "dotenv/config"` in `apps/api/src/app.ts` doesn't overwrite existing process.env.
- **Manual `node scripts/dev.mjs`**: BROKEN — `loadProjectEnv` reads `.env`'s `=0` into `MERGED_ENV`; `??` keeps `"0"`. **Reproduces 404 reliably.**
- **Per-bug worktree `.env.local`** (`orchestrator/src/fix-bugs-loop.ts:659`): writes `=1`, but reading-log-02 uses plain `dotenv` (not `dotenv-flow`), so `.env.local` is ignored. Possible silent gap in fix-bugs-loop for plain-dotenv projects — separate concern.

**Phase B — Factory fix (shipped this attempt):**

1. `.claude/skills/architect/SKILL.md §7b` — added required `ENABLE_TEST_SEED=1` block to the `apps/api/.env.example` template when `persistence_layer == "real-db"`, with anti-pattern callout citing bug-080.
2. `.claude/skills/agents/back-end/{node-fastify,python-fastapi,node-trpc-nest}/SKILL.md §3 step 4` — strengthened wording: "The literal value MUST be `1`, not `0` (bug-080 empirical: all 4 reading-log projects shipped with `=0`)".
3. `.claude/templates/dev-multi-tier-{node-fastify,node-express,node-trpc-nest,python-fastapi}.mjs.template` — switched `ENABLE_TEST_SEED: MERGED_ENV.ENABLE_TEST_SEED ?? "1"` to `process.env.ENABLE_TEST_SEED ?? "1"`. Now only shell-level overrides count; a stale `.env` file with `=0` no longer silently breaks dev mode. Documented inline with bug-080 citation.

**Phase C — Project backport (partial — operator action pending):**

- `apps/api/.env.example` — flipped `=0` → `=1` + factory-backport comment ✓.
- `.env` (project root) — **operator-pending**. Factory's `.claude/hooks/enforce-boundaries.sh` (correctly) blocks agent writes to `.env`. Documented in `projects/reading-log-02/BACKPORTS.md` with the exact sed/PowerShell command.
- `apps/api/.env` — **operator-pending**. Same reason.

**Validation criteria status:**

1. ✅ Phase A investigation produces findings for all 4 hypotheses
2. ✅ Phase B fix lands in factory (4 skill files + 4 template files)
3. ⏳ Phase C backfill confirmed on reading-log-02 — operator must edit 2 `.env` files per `projects/reading-log-02/BACKPORTS.md`, then `curl /test/cleanup` should return 204
4. ⏳ New /new-project scaffolds — wait for next architect run; verify `.env.example` lands with `=1`
5. ⏳ E2E synthesized flow's beforeAll cleanup — re-validation pending Phase 0 ship (also blocked on operator backport)

**Decisions made:**

- **`process.env` over `MERGED_ENV` for dev.mjs override:** chosen because the documented escape hatch is "shell-level override", not "file-level override". File-level overrides for ENABLE_TEST_SEED have only ever been mis-scaffolds, not deliberate operator intent.
- **Defense-in-depth across 3 surfaces** (architect skill emit + back-end skill builder step + dev.mjs template): the bug surfaced because no single surface was sole owner. Stronger, repeated contract makes future agents harder to mis-execute.
- **Project backport scope = reading-log-02 only:** other reading-log-\* projects have the same bug but aren't on the bug-fix re-validation path; deferred to next `/new-project --force` pass.
- **Cross-package mutation of `fix-bugs-loop.ts` to write project-root `.env.local`** (so plain-dotenv projects also pick it up): **rejected**. The orchestrator's spawn-env override already handles the orchestrator path correctly; the manual-dev path is the one with the leak, and the dev.mjs template fix closes that. Adding a third write target risks divergence.

**Out of scope / follow-up flagged:**

- Plain-`dotenv` vs `dotenv-flow` mismatch (reading-log-02 uses plain dotenv → ignores `.env.local`): potentially affects per-bug worktree slot isolation if multiple slots run concurrently. Re-evaluate after re-validation if collisions appear.
