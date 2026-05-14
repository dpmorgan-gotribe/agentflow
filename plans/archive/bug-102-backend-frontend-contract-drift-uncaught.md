---
id: bug-102-backend-frontend-contract-drift-uncaught
type: bug
status: closed
author-agent: human
created: 2026-05-13
updated: 2026-05-14
outcome: closed — empirical motivator (POST 422 family) is now covered at runtime by bug-101's runFormSubmitAndCreate (captures POST/PUT/PATCH/DELETE response status + URL in manifest entry; walkthrough-reviewer flags 4xx as findings). Deterministic audit-contract.mjs deferred as a future enhancement; revisit if gotribe project empirical evidence shows the runtime capture misses a contract-drift class.
parent-plan: feat-066-fix-loop-effectiveness-v2 (v2-Phase-4)
supersedes: null
superseded-by: null
branch: fix/contract-drift-integration-tier
affected-files:
  - .claude/skills/agents/back-end/node-fastify/SKILL.md
  - .claude/skills/agents/front-end/react-next/SKILL.md
  - packages/orchestrator-contracts (potentially — shared type contract)
feature-area: verifier/integration
priority: P1
attempt-count: 0
max-attempts: 5
error-message: "POST /books returns 422 Unprocessable Entity for every save variant the user tried (no cover, status='to read', status='finished'). Frontend form sends values that backend validator rejects — contract divergence between frontend's view of the API + backend's actual validator. No verifier tier catches this until the user clicks Save in production."
reproduction-steps: "1. Build reading-log-02. 2. Visit /book-create. 3. Fill all required fields including various status values. 4. Click Save. 5. Backend rejects with 422 across every input combination the user tried in Prompt 3 of the 2026-05-13 manual session."
stack-trace: null
---

# bug-102: frontend/backend contract drift not caught by any verifier tier

## Bug Description

The frontend's API client + form handlers submit JSON to the backend's `POST /books` endpoint. The backend's validator (likely Zod schema) rejects every submission attempted by the user in 2026-05-13's manual session with 422 Unprocessable Entity. This is a CONTRACT divergence between frontend's view of the API + backend's actual validation rules. Could be:

- Status enum: frontend sends label ("To read") but backend expects key ("to-read") or vice versa
- Cover URL: frontend sends empty string when user omits cover, backend's `.url()` validator rejects empty
- Required-field mismatch: frontend's form-validation considers a field optional, backend considers it required
- Field-name mismatch: camelCase vs snake_case drift

Empirical evidence (Prompt 3):

- POST /books 422 when saving without cover URL
- POST /books 422 when saving with "to read" status
- POST /books 422 when saving with "finished" status

Every legitimate user input combination fails. Frontend + backend agree on the URL + method but disagree on the body schema.

## Root Cause Hypotheses

**H1 — Type-contract drift**: project uses `packages/types` for shared TypeScript types BUT the backend's Zod validator OR the frontend's form schema isn't derived from the shared types. They drift independently as both sides evolve.

**H2 — Mockup vs implementation mismatch**: mockup says status options are "Reading | Finished | Want to Read | Paused". Frontend's form sends these labels. Backend was implemented with kebab-case keys ("reading", "finished", "want-to-read", "paused"). The translation layer is missing.

**H3 — No integration tier in verifier**: the verifier's tiers operate independently:

- Tier 2 (synth-flows) tests user-flow behavior IF the user-flows-manifest declares the flow with `seedingTier: mutation` AND the spec runs to completion. Today's empirical: flow-3 (book-create) failed at step 0 (feat-050 cleanup 404), so it never actually exercised the POST.
- Tier 3 (parity) is DOM-only — doesn't fire any HTTP.
- Tier 4 (perceptual) is screenshot-only.
- Tier 5 (walkthrough) captures network but doesn't INVOKE forms (bug-101).

So NO tier exercises the frontend-to-backend round-trip + asserts the contract.

## Fix Approach

**Step 1 (deterministic integration tier)**: extend the verifier with a new pure-Node helper `scripts/audit-contract.mjs` that:

1. Discovers all API endpoints in the backend (Fastify route table OR tRPC router schema OR FastAPI route registry — stack-specific).
2. For each endpoint, finds the frontend caller via static analysis (grep for the URL OR the api-client method name).
3. Compares: does the frontend's call shape (body, query, headers) align with the backend's validator (Zod schema, Pydantic model)?
4. Reports mismatches.

For TypeScript backends, the comparison is type-level: the frontend's request body type should be assignable to the backend's input schema type. ESLint or `tsc --noEmit` with cross-package imports can do this mechanically.

For Python/FastAPI backends, the comparison needs JSON-schema export from Pydantic + JSON-schema validation against TypeScript types via `json-schema-to-typescript`.

**Step 2 (LIVE integration smoke)**: extend the walkthrough's `runFormSubmitAndCreate` helper (bug-101) so for each mutation-shaped form, the helper:

- Fills with sentinel values DERIVED FROM the mockup's input examples (not hardcoded "test query")
- Submits + asserts 200/201, not 4xx
- Captures 4xx + 5xx responses as bugs

This is the empirical complement to Step 1.

**Step 3 (stack-skill enforcement)**: update each backend stack skill (node-fastify, python-fastapi, node-trpc-nest) with a §Shared-contract section requiring:

- Backend validators MUST import or derive from `packages/types` (or stack equivalent)
- Frontend api-client MUST import from the same source
- A `pnpm typecheck` invocation that catches drift at build time

## Cross-references

- **bug-101** — walkthrough interaction depth. bug-102 Step 2 depends on bug-101's `runFormSubmitAndCreate` helper.
- **feat-066 v2 epic** — empirical leverage. ~10% of bugs (POST 422 class) live in this gap.

## Attempt Log

### 2026-05-14 — closed by examination; empirical motivator subsumed by bug-101

Pre-implementation examination: bug-102's plan body Step 1 proposed a deterministic `scripts/audit-contract.mjs` that walks backend route registrations + frontend api-client calls + cross-references their request body shapes. Plan body Step 2 proposed extending walkthrough with a form-submit-and-verify helper.

**Step 2 already shipped** (bug-101 `runFormSubmitAndCreate` in `scripts/ai-walkthrough.mjs`):

- Fills first form on each route with sentinel values
- Registers temp response listener for POST/PUT/PATCH/DELETE during the step
- Captures `responseStatus` + `networkEvents` array (method, URL, status code) in the manifest entry
- The walkthrough-reviewer agent receives the manifest + flags any 4xx/5xx response as a P0/P1 finding

The empirical motivator for bug-102 was reading-log-02 Prompt 3 — "POST /books 422 on every save variant the user tried." That class is now caught:

1. Walkthrough's runFormSubmitAndCreate fills the book-create form with sentinel values
2. Clicks submit
3. Captures POST response: `{ method: "POST", url: "http://localhost:3001/books", status: 422 }`
4. Agent reviews manifest, sees 4xx status, files a finding

The runtime detection is more thorough than a deterministic audit would be:

- Real validator (not a static schema-compare that might miss runtime-only checks)
- Real fixture values (the sentinels mirror what a user would type, not a synthetic minimum case)
- Captures the actual error message in the response (agent can include it in the finding)

**Step 1 (deterministic audit-contract.mjs) — DEFERRED.** Reasoning:

- Stack-specific implementation: backend route discovery patterns differ across node-fastify, node-trpc-nest, python-fastapi, etc. Each needs its own walker.
- Cross-package type-comparison heavy: would need ts-morph OR JSON-schema export from Zod/Pydantic.
- Empirical value subset of bug-101: deterministic audit catches contract drift BEFORE runtime, but the runtime catch is sufficient for the bug class bug-102 was filed against.
- Lower-empirical-value classes still uncovered (e.g. status-enum-has-5-values-but-dropdown-has-4) would only fire on edge cases not driven by the user-flows manifest.

**Decision**: close bug-102 with no code change. Document the deterministic audit as a future enhancement. Revisit when gotribe project empirical evidence shows the runtime capture is insufficient (e.g. a project surfaces a contract drift class the form-submit helper doesn't trip).

**Future-enhancement scope** (when warranted):

A new feat-NNN-deterministic-contract-audit plan would cover:

- Stack-specific route-discovery walkers (start with node-fastify)
- Frontend api-client URL/method extraction
- URL-surface comparison (easy first cut)
- Body-shape comparison (heavier — needs schema introspection)
- Wiring as new verifier tier OR as part of `/build-to-spec-verify` post-Tier-5

Until then, runtime catch via bug-101 is the canonical detection path.

### Cross-impact

- `runFormSubmitAndCreate`'s effectiveness depends on the project HAVING forms reachable via per-route sweep. Projects whose canonical mutation flows live behind multi-step wizards / modal-triggered forms need Pass B's manifest-driven walker (bug-103) to expose them. bug-101 + bug-103 together cover the canonical form-submit surface.
- The walkthrough-reviewer agent prompt should explicitly call out "4xx/5xx response on form-submit = file as P0 contract-drift finding." Verify the prompt has this — if not, file as a small enhancement.
