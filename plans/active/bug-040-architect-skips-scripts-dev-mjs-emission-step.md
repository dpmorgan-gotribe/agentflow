---
id: bug-040-architect-skips-scripts-dev-mjs-emission-step
type: bug
status: draft
author-agent: human
created: 2026-05-02
updated: 2026-05-02
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/architect-emits-dev-mjs
affected-files:
  - .claude/agents/architect.md
  - .claude/skills/architect/SKILL.md
  - .claude/templates/dev-multi-tier.mjs.template
feature-area: architect/scaffold-compliance
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

### Phase A — verify + retroactively repair finance-track-01 (P0, immediate)

1. **Confirm finance-track-01's missing scripts/dev.mjs** by running `cp .claude/templates/dev-multi-tier.mjs.template projects/finance-track-01/scripts/dev.mjs` manually.
2. **Run `node projects/finance-track-01/scripts/dev.mjs`** from project root to confirm the template works for this project's stack (fastify + react-next + better-sqlite3).
3. **Commit the manually-copied dev.mjs to finance-track-01's git** — unblocks the verifier rerun.

### Phase B — architect agent enforcement (P0)

4. **Add a SELF-VERIFY check to architect.md / architect/SKILL.md**: after the architect's main scaffold loop completes, for multi-tier projects assert that `<projectDir>/scripts/dev.mjs` exists. If missing, copy it from `.claude/templates/dev-multi-tier.mjs.template` automatically (don't fail; auto-fix).
5. **Update architect's return JSON** to include a `scaffoldedFiles[]` field that lists what was emitted, with `dev.mjs` callout when present. The orchestrator can surface this for operator visibility.

### Phase C — orchestrator post-architect verifier (P1, defense-in-depth)

6. **Add an orchestrator post-architect check**: after architect dispatch completes, if `apps/api/` + `apps/web/` both exist BUT `scripts/dev.mjs` doesn't, fail the architect stage with an actionable error pointing to bug-040.
7. **Also enforce**: `apps/api/.env.local` exists (per bug-033 canonical port-config location); `apps/web/playwright.config.ts` has a `webServer` block (sister bug-041).

### Phase D — empirical re-validation

8. After Phases A+B+C ship, dispatch /architect on a fresh test project; confirm `scripts/dev.mjs` lands automatically.

## Rejected Fixes

- **Make scripts/dev.mjs optional** — Rejected. It's load-bearing for multi-tier dev workflow + verifier auto-boot. Optional means "broken by default."
- **Auto-generate scripts/dev.mjs at orchestrator's verifier-time** — Rejected. The architect is the canonical scaffold owner; pushing scaffold work into the verifier blurs ownership. Architect should self-verify.
- **Document better, hope architect agent follows** — Rejected. Documentation already exists at SKILL.md §7c; clearly insufficient. Need automated enforcement.

## Validation Criteria

### Phase A (finance-track-01 specific)

- [ ] `projects/finance-track-01/scripts/dev.mjs` exists + is committed.
- [ ] `node projects/finance-track-01/scripts/dev.mjs` boots both backend (port 4000 per bug-038 resolved) + frontend (port 3000) without errors.
- [ ] `curl http://localhost:4000/health` returns 200.

### Phase B (factory)

- [ ] `architect.md` self-verify check enforces `scripts/dev.mjs` for multi-tier projects.
- [ ] Architect's return JSON includes `scaffoldedFiles[]`.
- [ ] Regression test: architect dispatch on fresh multi-tier project produces scripts/dev.mjs without operator intervention.

### Phase C (defense-in-depth)

- [ ] Orchestrator's post-architect check fails with actionable error if scripts/dev.mjs missing.

### Phase D (empirical)

- [ ] Fresh project (book-swap-pre-build OR a synthesized test) demonstrates the full chain: architect → scripts/dev.mjs lands → verifier auto-boots correctly → seed-loop fires → flows actually exercise data.

## Cross-references

- **Empirical case**: 2026-05-02 finance-track-01 — first link in 5-step seeding-pipeline failure chain.
- **Sister bugs**: bug-041 (playwright.config.ts missing webServer block), bug-042 (global-setup baseline incomplete) — together with bug-040 they comprise the full broken-seeding story.
- **Predecessor**: bug-033 (dev-multi-tier.mjs.template) — created the template that bug-040 says should be copied.
- **Verifier-side compounding**: orchestrator/src/dev-server.ts's auto-boot uses FastAPI-specific `uv run uvicorn` even for node-fastify projects — separate factory gap, sister to bug-038.

## Attempt Log

<!-- populated as fix attempts are made -->
