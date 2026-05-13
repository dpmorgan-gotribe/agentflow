---
id: bug-102-backend-frontend-contract-drift-uncaught
type: bug
status: draft
author-agent: human
created: 2026-05-13
updated: 2026-05-13
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

<!-- Populated by executing agents. -->
