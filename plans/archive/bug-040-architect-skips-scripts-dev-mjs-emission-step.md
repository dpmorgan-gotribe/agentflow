---
id: bug-040-architect-skips-scripts-dev-mjs-emission-step
type: bug
status: completed
author-agent: human
created: 2026-05-02
updated: 2026-05-03
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/architect-emits-dev-mjs
affected-files:
  - .claude/agents/architect.md
  - .claude/skills/architect/SKILL.md
  - .claude/templates/dev-multi-tier-python-fastapi.mjs.template # renamed from dev-multi-tier.mjs.template
  - .claude/templates/dev-multi-tier-node-fastify.mjs.template # NEW
  - .claude/templates/dev-multi-tier-node-trpc-nest.mjs.template # NEW (placeholder until first consumer)
  - .claude/templates/dev-multi-tier-node-express.mjs.template # NEW (placeholder until first consumer)
  - .claude/skills/agents/back-end/python-fastapi/SKILL.md # §dev-orchestrator pointer
  - .claude/skills/agents/back-end/node-fastify/SKILL.md # §dev-orchestrator pointer
  - .claude/skills/agents/back-end/node-trpc-nest/SKILL.md # §dev-orchestrator pointer
  - .claude/skills/agents/back-end/node-express/SKILL.md # §dev-orchestrator pointer (if shipped)
feature-area: architect/scaffold-compliance + per-stack-dev-template
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "projects/finance-track-01/scripts/dev.mjs missing — playwright global-setup can't reach the backend; verifier auto-boot has nothing to spawn for the api tier"
reproduction-steps: "Run /architect on a multi-tier project. After it completes, check projects/<name>/scripts/dev.mjs — it's missing despite SKILL.md §7c mandating its emission."
stack-trace: null
---

# bug-040: Architect skips its mandatory `scripts/dev.mjs` emission step (SKILL.md §7c not enforced)

## Bug Description

`.claude/skills/architect/SKILL.md §7c` (lines 253-258) mandates:

> "When the project has both tiers per step 7b, the architect MUST also emit a project-root `scripts/dev.mjs` that boots BOTH halves with port coordination. Copy from the factory template:
> `cp .claude/templates/dev-multi-tier.mjs.template <projectDir>/scripts/dev.mjs`"

**Two compounding factory bugs in this surface, not one:**

1. **Architect compliance gap** — even when SKILL.md §7c is followed, the agent skipped the emission step on finance-track-01.
2. **The template itself is FastAPI-only** — `.claude/templates/dev-multi-tier.mjs.template` hardcodes `uv run uvicorn api.main:app --app-dir src` + port-default 8000. A `cp` of this template into a `node-fastify` / `node-trpc-nest` project produces a `scripts/dev.mjs` that cannot boot the backend. The "stack-aware" expansion is **mandatory** for the fix to work across stacks; otherwise enforcing the cp just creates broken scripts everywhere.

Empirically, finance-track-01 has both tiers (`apps/api/` + `apps/web/`) per its `architecture.yaml`, but `projects/finance-track-01/scripts/dev.mjs` does NOT exist. Only validation scripts live in `scripts/`:

```
projects/finance-track-01/scripts/
  retrofit-ui-kit-data-attrs.mjs
  validate-architecture.mjs
  validate-brief.mjs
  validate-feature-context.mjs
  validate-screens.mjs
  validate-tasks-yaml.mjs
```

Working comparison: `projects/repo-health-dashboard-01/scripts/dev.mjs` EXISTS — that project's architect dispatch DID emit it.

This is the FIRST link in a 5-step seeding-pipeline failure chain that left ALL 9 finance-track-01 synthesized E2E flows landing on empty UI states.

## Reproduction Steps

1. Run `/architect` on a multi-tier project (web + api).
2. Confirm `architecture.yaml.tooling.stack.{web_framework, backend_framework}` are both populated.
3. After architect completes, check `projects/<name>/scripts/dev.mjs` — empirically MISSING.
4. Run `node scripts/dev.mjs` from project root → fails (file doesn't exist).
5. Playwright global-setup tries `POST /test/seed` against backend → connection refused / 404 → seeding silently skipped.
6. Synthesized E2E specs run against frontend with no backend data → all fail with "element not found" on dashboard cards / lists.

Empirical case: 2026-05-02 finance-track-01 (architect ran 2026-04-25). 9/9 synthesized E2E flows failed at runtime; root cause = no scripts/dev.mjs → no coordinated boot → no seed data.

## Error Output

From the verifier rerun (`tasks/b6zuh43xr.output`):

```
Build-to-spec verify:
  flows:           0 passed, 9 failed (after bug-039 fix)
  warnings:
    - parity: dev-server: auto-boot failed: backend (apps/api/) did not respond
```

Plus per-flow page snapshots showing the empty "No accounts yet" state — the spec expected populated dashboard, app rendered empty state because the backend was never running with seed data.

## Root Cause Analysis

### Why architect skipped step 7c

The architect agent's dispatch context includes `architect/SKILL.md` as the canonical work guide, AND step 7c documents the requirement. So the agent KNEW it should run the cp. But empirically it didn't. Possible reasons:

1. **Agent compliance gap** — agent read step 7c, decided it didn't apply (false), or forgot mid-execution.
2. **The cp command was attempted but failed silently** — Windows path issues, missing parent directory, permission error. Agent didn't surface the failure in its return JSON.
3. **The cp ran successfully then was undone** — possible if a later scaffold step (e.g. .gitignore commit, sync-project-schemas) overwrote `scripts/` with only validation scripts.
4. **The architect dispatch predates the SKILL.md step 7c** — finance-track-01's architect ran 2026-04-25; bug-033 + dev-multi-tier.mjs.template work landed 2026-04-30. The architect MAY have run before §7c was added.

Most likely #4 (timing) for finance-track-01 SPECIFICALLY, but #1 (compliance gap) is the FACTORY bug worth fixing — without enforcement, future project architect runs may also skip the step.

### Where the verifier should have caught it

`orchestrator/src/dev-server.ts spawnDevServer` is supposed to detect `apps/api/` + co-boot the backend. Per the file header (line 12):

> "bug-032 Phase C: extended to detect `apps/api/` and co-boot the backend with port coordination."

So the verifier KNOWS to look for the backend tier but apparently the boot path either fails silently OR uses the WRONG dev command (it's hardcoded to `uv run uvicorn ...` which is FastAPI-specific, NOT fastify). For node-fastify, it needs `pnpm --filter @repo/api dev` or `node scripts/dev.mjs`.

This is technically a separate gap (sister bug to bug-038) but compounds bug-040: even if architect HAD scaffolded scripts/dev.mjs, the verifier's auto-boot wouldn't know to invoke it.

## Fix Approach

### Phase A.5 — make `dev-multi-tier.mjs.template` stack-aware (P0, prerequisite)

**This phase MUST ship before Phase B can land** — without it, enforcing the cp from a single FastAPI-only template just produces broken `scripts/dev.mjs` on every node-\* project.

Adopt **fix-shape B** (per-stack templates with thin SKILL.md pointer). Rationale: the bulk of `dev.mjs` (~400 lines: env-file parsing, port pre-flight, cross-platform process trees, signal teardown) is stack-agnostic; only `spawnBackend()` (~30 lines) is stack-specific. Embedding 400 lines per backend stack into SKILL.md is duplication; one shared scaffold per stack as a dedicated file keeps cross-platform plumbing lintable + testable. Matches the existing factory pattern (`playwright-global-setup.ts.template`, `seed-db.ts.template`).

1. **Rename existing template** to make stack explicit:
   - `mv .claude/templates/dev-multi-tier.mjs.template .claude/templates/dev-multi-tier-python-fastapi.mjs.template`
2. **Author `.claude/templates/dev-multi-tier-node-fastify.mjs.template`** — same structure as the FastAPI one but `spawnBackend()` runs `pnpm --filter @repo/api dev` (which `tsx watch src/server.ts` per node-fastify SKILL.md). Port-default 3001 (matches `STACK_DEFAULT_BACKEND_PORT["node-fastify"]` in `orchestrator/src/dev-server.ts:46`). Keep `loadEnvFiles` / `redactEnvForLog` / `killTree` / pre-flight port-collision check / `waitForBackend` / SIGINT teardown identical.
3. **Author `.claude/templates/dev-multi-tier-node-trpc-nest.mjs.template`** — placeholder mirroring node-fastify but with `pnpm --filter @repo/api start:dev` (Nest CLI default). Port-default 4000.
4. **Author `.claude/templates/dev-multi-tier-node-express.mjs.template`** — placeholder mirroring node-fastify. Port-default 4000.
5. **Add a §dev-orchestrator subsection to each backend stack skill** (`.claude/skills/agents/back-end/{python-fastapi,node-fastify,node-trpc-nest,node-express}/SKILL.md`) — 5-line pointer naming the canonical template file the architect should `cp` for that stack:

   ```
   ## §dev-orchestrator (multi-tier dev script)
   When `architecture.yaml.tooling.stack.web_framework` is non-null, the architect MUST emit
   `<projectDir>/scripts/dev.mjs` as part of step 7c. The canonical template for this stack is
   `.claude/templates/dev-multi-tier-{stack-slug}.mjs.template`. Copy it verbatim.
   ```

6. **Smoke-test each new template** in isolation: `cp` it into a sandbox project, set `apps/api/`+`apps/web/` to a minimal stub, run `node scripts/dev.mjs`, confirm both halves boot + `/health` returns 200.

### Phase A — retroactively repair finance-track-01 (P0, post-Phase-A.5)

7. `cp .claude/templates/dev-multi-tier-node-fastify.mjs.template projects/finance-track-01/scripts/dev.mjs`
8. Run `node projects/finance-track-01/scripts/dev.mjs`; confirm backend on :3001 + frontend on :3000 both respond.
9. Commit the file to finance-track-01's git.

### Phase B — architect agent enforcement (P0, post-Phase-A.5)

10. **Update architect/SKILL.md §7c** to look up the canonical template per backend stack:

    ```
    Resolve template path:
      template = `.claude/templates/dev-multi-tier-{architecture.yaml.tooling.stack.backend_framework}.mjs.template`
    cp $template <projectDir>/scripts/dev.mjs
    ```

    Hard-fail (not warn) if `architecture.yaml.tooling.stack.backend_framework` is unset or no matching template exists.

11. **Add a SELF-VERIFY check** to `.claude/agents/architect.md`: after the main scaffold loop, for multi-tier projects assert `<projectDir>/scripts/dev.mjs` exists. If missing, perform the stack-aware cp automatically (don't fail; auto-fix).
12. **Update architect's return JSON** to include `scaffoldedFiles[]` — the orchestrator surfaces this for operator visibility.

### Phase C — orchestrator post-architect verifier (P1, defense-in-depth)

13. **Add an orchestrator post-architect check**: when `apps/api/` + `apps/web/` both exist BUT `scripts/dev.mjs` doesn't, fail the architect stage with an actionable error pointing to bug-040.
14. **Also enforce**: `apps/api/.env.local` exists (per bug-033 canonical port-config); `apps/web/playwright.config.ts` has a `webServer` block (sister bug-041).
15. **Sanity-check stack alignment**: parse the first ~30 lines of the emitted `scripts/dev.mjs` to verify it matches the expected `spawnBackend()` shape for the project's `backend_framework`. Catches "wrong template was copied" silently. (Cheap regex check; doesn't need full JS parse.)

### Phase D — empirical re-validation

16. After Phases A.5 + B + C ship, dispatch /architect on a fresh node-fastify test project AND a fresh python-fastapi test project; confirm both produce a working `scripts/dev.mjs` for their respective stacks without operator intervention.

### Cross-stack interaction with bug-043

`scripts/dev.mjs` is the OPERATOR-side dev orchestrator. The orchestrator's verifier-time auto-boot path (`orchestrator/src/dev-server.ts spawnBackendDevServer`) is a SEPARATE surface that ALSO needs stack-awareness — filed as **bug-043**. Both must ship for end-to-end E2E to work on non-FastAPI stacks. Sequence: bug-043 → bug-040 (Phase A.5 + Phase A) → bug-041 → bug-042 (per the operator's Wave 0 / Wave 1 plan).

## Rejected Fixes

- **Make scripts/dev.mjs optional** — Rejected. It's load-bearing for multi-tier dev workflow + verifier auto-boot. Optional means "broken by default."
- **Auto-generate scripts/dev.mjs at orchestrator's verifier-time** — Rejected. The architect is the canonical scaffold owner; pushing scaffold work into the verifier blurs ownership. Architect should self-verify.
- **Document better, hope architect agent follows** — Rejected. Documentation already exists at SKILL.md §7c; clearly insufficient. Need automated enforcement.

## Validation Criteria

### Phase A.5 (per-stack templates)

- [ ] `.claude/templates/dev-multi-tier-python-fastapi.mjs.template` exists (renamed from `dev-multi-tier.mjs.template`).
- [ ] `.claude/templates/dev-multi-tier-node-fastify.mjs.template` exists + smoke-tested (boots fastify backend + Next frontend on a sandbox project).
- [ ] `.claude/templates/dev-multi-tier-node-trpc-nest.mjs.template` exists (placeholder, structurally complete).
- [ ] `.claude/templates/dev-multi-tier-node-express.mjs.template` exists (placeholder, structurally complete).
- [ ] Each backend stack skill has a §dev-orchestrator subsection naming the canonical template file.

### Phase A (finance-track-01 specific)

- [ ] `projects/finance-track-01/scripts/dev.mjs` exists + is committed (sourced from `dev-multi-tier-node-fastify.mjs.template`).
- [ ] `node projects/finance-track-01/scripts/dev.mjs` boots both backend (port 3001 per `STACK_DEFAULT_BACKEND_PORT["node-fastify"]`) + frontend (port 3000) without errors.
- [ ] `curl http://localhost:3001/health` returns 200.

### Phase B (factory)

- [ ] `architect/SKILL.md §7c` resolves the template by `backend_framework` slug (no longer hardcoded).
- [ ] `architect.md` self-verify check enforces `scripts/dev.mjs` for multi-tier projects + auto-fixes via stack-aware cp.
- [ ] Architect's return JSON includes `scaffoldedFiles[]`.
- [ ] Regression test: architect dispatch on a fresh multi-tier project produces a stack-correct `scripts/dev.mjs` without operator intervention.
- [ ] Hard-fail when `backend_framework` is set to a slug with no matching template (rather than silently copying nothing or copying a stale FastAPI default).

### Phase C (defense-in-depth)

- [ ] Orchestrator's post-architect check fails with actionable error if `scripts/dev.mjs` missing.
- [ ] Orchestrator's post-architect check parses the emitted `scripts/dev.mjs` first ~30 lines + verifies the `spawnBackend()` shape matches `architecture.yaml.tooling.stack.backend_framework` (catches "wrong template was copied" silently).

### Phase D (empirical)

- [ ] Fresh node-fastify project (e.g. clone finance-track-01's brief) demonstrates: architect → `scripts/dev.mjs` lands stack-correct → verifier auto-boots correctly → seed-loop fires → flows exercise populated data.
- [ ] Fresh python-fastapi project demonstrates the same end-to-end chain (regression — make sure FastAPI path didn't regress when we added node-\* paths).

## Cross-references

- **Empirical case**: 2026-05-02 finance-track-01 — first link in 5-step seeding-pipeline failure chain.
- **Sister bugs**: bug-041 (playwright.config.ts missing webServer block), bug-042 (global-setup baseline incomplete) — together with bug-040 they comprise the full broken-seeding story.
- **Predecessor**: bug-033 (dev-multi-tier.mjs.template) — created the template that bug-040 says should be copied (in its FastAPI-only form).
- **Verifier-side compounding (now filed as bug-043)**: `orchestrator/src/dev-server.ts spawnBackendDevServer` uses FastAPI-specific `uv run uvicorn` even for node-fastify projects — separate orchestrator surface, sister to bug-038. Both must ship for end-to-end E2E to work on non-FastAPI stacks.
- **Sequencing**: bug-043 SOLO first (Wave 0), then bug-040 + bug-041 + bug-042 in PARALLEL (Wave 1), then empirical end-to-end validation on finance-track-01 (Wave 2).

## Attempt Log

<!-- populated as fix attempts are made -->
