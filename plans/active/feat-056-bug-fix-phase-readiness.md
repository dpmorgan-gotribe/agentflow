---
id: feat-056-bug-fix-phase-readiness
type: feature
status: draft
author-agent: human
created: 2026-05-06
updated: 2026-05-06
parent-plan: null
supersedes: null
superseded-by: null
branch: feat/bug-fix-phase-readiness
affected-files:
  - orchestrator/src/build-to-spec-verify.ts
  - scripts/run-synthesized-flows.mjs
  - scripts/synthesize-flow-e2e.mjs
  - .claude/skills/agents/front-end/react-next/SKILL.md
  - packages/orchestrator-contracts/src/build-to-spec-verify.ts
feature-area: orchestrator/verifier
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-056-bug-fix-phase-readiness: close the silent-success gap so /build-to-spec-verify actually surfaces real bugs

## Why this exists

**Empirical case 2026-05-06 reading-log-01 — the smoking gun:**

After 5/5 features merged via /start-build, the orchestrator's auto-trigger of /build-to-spec-verify reported:

```
flows: 0 passed, 0 failed
warnings:
  - flow-execution: playwright reporter stdout empty; stderr=Error: Cannot find module '@playwright/test'
  - parity: dev-server: auto-boot failed: backend (node-fastify) did not respond on http://localhost:3001/health
ok: true
```

**No bugs filed. /fix-bugs would find nothing to iterate on. Project shipped "complete".**

But running `pnpm exec playwright test e2e/synthesized` manually after pnpm install + browser binary install surfaced a REAL product bug:

```
[WebServer] apps/api/src/plugins/prisma.ts:2
[WebServer] import { PrismaClient } from "@prisma/client";
[WebServer]          ^
[WebServer] SyntaxError: The requested module '@prisma/client' does not provide an export named 'PrismaClient'
```

Prisma v6 changed `PrismaClient` from a named top-level export to a path-specific one — backend dev-server fails to start → webServer in playwright.config.ts times out → e2e specs can't run → verifier degrades gracefully → bugs.yaml empty.

**The bug-fix phase is structurally a no-op when the verifier silently passes.** /fix-bugs has nothing to iterate on. Real bugs ship to "complete".

## Goal

After /start-build completes, the operator can confidently say:

1. **/build-to-spec-verify catches actual product bugs** — not just static reachability + synthesizer authoring
2. **bugs.yaml is populated** with real findings when failures exist
3. **/fix-bugs has meaningful work** to dispatch to builders
4. **"complete" status only emits when verify actually validated something** — not when its tools failed silently

## Gap inventory

### Gap 1 — bug-037 Phase B+C+D (P0)

**Surface:** scripts/synthesize-flow-e2e.mjs + scripts/run-synthesized-flows.mjs + orchestrator/src/build-to-spec-verify.ts

**Phase A shipped this session** (commit `bc562f3` — react-next SKILL.md COPY VERBATIM templates). Phase A prevents fresh-project recurrence. Phase B+C+D close the runtime gap on existing projects + close the silent-success classification:

- **Phase B (synthesizer auto-fix-up)**: when `synthesize-flow-e2e.mjs` finds @playwright/test missing in `apps/web/package.json`, AUTO-EDIT to add it + emit a "package.json updated" warning. Defense-in-depth + heals projects scaffolded before Phase A landed.
- **Phase C (verifier hard-fail)**: `orchestrator/src/build-to-spec-verify.ts` flow-execution stage MUST return a HARD failure (not a warning) when `apps/web/e2e/synthesized/flow-N.spec.ts` files exist AND the runtime can't start. The current "graceful degradation" lets bugs ship invisibly.
- **Phase D (browser binary install strategy)**: decide one — post-install hook OR lazy install OR operator step. Document in react-next SKILL.md §3a. Without chromium binary, `pnpm exec playwright test` fails after the @playwright/test module is found.

### Gap 2 — bug-038 Phase A+B+C+D (P0)

**Surface:** orchestrator's parity-verify dev-server resolver

**Empirical recurrence 2026-05-06 reading-log-01:** "parity: dev-server: auto-boot failed: backend (node-fastify) did not respond on http://localhost:3001/health within 60000ms. Resolved port: 3001 (resolution chain — process.env.PORT > BACKEND_PORT > apps/api/.env.local > apps/api/.env > architecture.yaml backend_framework stack-default > 8000)."

The resolution chain found port 3001 (correct) but the backend STILL didn't respond — likely because the backend itself is broken (the Prisma import bug). bug-038 Phase A's port-resolution-chain might already cover this, but the recurrence suggests the chain isn't reading `apps/api/.env.local` properly OR the backend's exit-on-error isn't surfaced as a verifier-level failure.

Concretely:

- **Phase A**: reading-log-01 ships with backend on port 3001 (fastify default) — the resolver SHOULD find this. Empirical: it does (`Resolved port: 3001`). But the backend exits on import error → port never opens → verifier waits 60s → warning. Need to capture the spawn-process exit code + treat exit≠0 within wait-window as a HARD failure (not timeout-warning).
- **Phase B+C+D**: per bug-038 plan — stack-skill canonical-port docs, better diagnostic, empirical re-validation.

### Gap 3 — Webserver-timeout classification (NEW)

**Surface:** orchestrator/src/build-to-spec-verify.ts flow-execution + parity stages

When backend dev-server fails to start (whether from Prisma import error, port collision, missing dep, etc.), the verifier classifies this as a **warning** + reports `ok: true`. It SHOULD classify as a **hard failure** that gets filed to bugs.yaml + routes to the appropriate builder (backend-builder for backend-boot failures; web-frontend-builder for frontend-only).

This is a CROSS-CUTTING concern with bug-037 Phase C + bug-038 Phase A — both are specific instances of the general "verifier degrades gracefully when its tools fail" antipattern. The fix is the same shape: classify tool-failures as bugs (not warnings) in their own taxonomy.

Concretely, extend the BugsYaml schema (or use existing `category`) with a `tooling-failure` class:

```yaml
- id: bug-NNN
  category: tooling-failure
  primaryCause: backend-boot
  detail: "backend (node-fastify) failed to start within 60s — check apps/api/src/plugins/prisma.ts (SyntaxError on @prisma/client import)"
  retryTarget: backend-builder
  failingArtifact: apps/api/src/plugins/prisma.ts
```

The verifier file-bug-plan flow auto-files these the same way reachability + flow-failures get filed. /fix-bugs picks them up.

### Gap 4 (advisory, not blocking) — bug-053 checkout-feature race

**Surface:** orchestrator/src/feature-graph.ts mutex + checkout step

Already filed (bug-053). Doesn't block bug-fix-phase readiness directly — it affects /start-build's RELIABILITY but the manual recovery path is well-documented. Schedule after Gaps 1-3 ship.

## Plan / phases / sequencing

### Phase 1 — Gap 3 first (verifier classification taxonomy)

**Why first:** it's the unifying surface. bug-037 Phase C + bug-038 Phase A's diagnostics are both specific instances of "tool-failure as bug". Establishing the taxonomy + auto-file path makes the per-bug fixes downstream cheaper.

**Concrete work:**

1. Extend `packages/orchestrator-contracts/src/bugs-yaml.ts` BugEntrySchema's `category` enum with `tooling-failure`.
2. Add `primaryCause` enum extension: `backend-boot`, `frontend-boot`, `playwright-runtime-missing`, `playwright-browser-missing`.
3. Update `orchestrator/src/build-to-spec-verify.ts`:
   - When flow-execution gets `Cannot find module '@playwright/test'` → file `tooling-failure` bug with `primaryCause: playwright-runtime-missing`, retry-target: web-frontend-builder.
   - When flow-execution gets backend timeout → file `tooling-failure` bug with `primaryCause: backend-boot`, retry-target: backend-builder.
   - Set `verify.ok = false` whenever tooling-failure bugs are filed.
4. Regression test: `tests/build-to-spec-verify.test.ts` covers both classifications.

**Empirical validation:** re-run the verifier on reading-log-01 (current state) → should now produce a bugs.yaml with the Prisma import bug surfaced as `tooling-failure / backend-boot`.

### Phase 2 — bug-037 Phase B+C+D

**After Phase 1 ships,** the per-bug work is straightforward:

- **Phase B** (synthesizer auto-fix-up): edit `scripts/synthesize-flow-e2e.mjs` — when `apps/web/package.json` lacks @playwright/test, auto-add + emit warning. Heals legacy projects.
- **Phase C** (verifier hard-fail): now subsumed by Phase 1's classification (tool-failure = bug, not warning). Phase 1 IS Phase C's implementation.
- **Phase D** (browser-binary install strategy): decide + document. Recommend operator-step (`pnpm -C apps/web exec playwright install chromium` once per project), document in `.claude/skills/start-build/SKILL.md` §Prerequisites + react-next SKILL.md §3a.

### Phase 3 — bug-038 Phase A+B+C+D

After Phase 1 ships, parity-verify's backend-boot timeout becomes a `tooling-failure` bug instead of a warning. Phase A still needs the port-resolution-chain to read `apps/api/.env.local` (per bug-033 cross-reference). Phase B+C+D per bug-038's plan.

### Phase 4 — empirical re-validation

After Phases 1-3 ship, re-run `/start-build` on a fresh test project (e.g. `book-swap-test`) end-to-end. Validate:

- /build-to-spec-verify catches the Prisma-import-bug class of issue
- bugs.yaml is populated with real `tooling-failure` entries
- /fix-bugs dispatches the right builder for each
- Run completes "completed-with-integration-failures" → /fix-bugs loop → "complete"

## Cross-references

- **bug-037**: 3rd recurrence smoking gun; Phase A shipped; B/C/D rolled into Phases 1-2 here.
- **bug-038**: parity-verify port-resolution; rolled into Phase 3 here.
- **bug-053**: checkout-feature race; advisory; schedule post-Phase-3.
- **investigate-012**: factory readiness pre-builds — sister investigation; covers similar gap class.
- **feat-026 (orchestrator-managed bug tracking)**: the bugs.yaml surface this plan extends.

## Validation criteria

- [ ] BugEntrySchema's `category` enum includes `tooling-failure`
- [ ] `primaryCause` enum extended with `backend-boot`, `frontend-boot`, `playwright-runtime-missing`, `playwright-browser-missing`
- [ ] orchestrator/src/build-to-spec-verify.ts files `tooling-failure` bugs on Playwright-runtime + backend-boot timeouts
- [ ] `verify.ok = false` whenever tooling-failure bugs are filed (currently `true` because warnings don't fail)
- [ ] Empirical: re-running verifier on reading-log-01 (with Prisma import broken) produces bugs.yaml with the Prisma issue
- [ ] /fix-bugs picks up the tooling-failure bugs + dispatches the correct retry-target
- [ ] Regression tests cover both new bug classes
- [ ] Documentation updated: build-to-spec-verify SKILL.md §Failure modes + retry routing table

## Attempt Log

<!-- to be populated -->
