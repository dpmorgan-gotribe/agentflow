---
id: feat-039-mock-interaction-step-kind
type: feature
status: completed
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
  - packages/orchestrator-contracts/src/user-flows-manifest.ts
  - packages/orchestrator-contracts/tests/user-flows-manifest.test.ts
  - schemas/user-flows-manifest.schema.json
  - scripts/synthesize-flow-e2e.mjs
  - orchestrator/tests/synthesize-flow-e2e.test.ts
  - orchestrator/tests/fixtures/synthesize-flow-e2e/strategy-d/
  - .claude/skills/user-flows-generator/SKILL.md
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-039 — Add `mock` InteractionStep kind to v2.0 user-flows-manifest schema

## Problem Statement

F1 of `investigate-012`. The v2.0 InteractionStep discriminated union ships 10 kinds (navigate / fill / click / select / waitForResponse / waitForSelector / assertVisible / assertText / assertUrlMatches / screenshot) but lacks any way to declare "this flow needs a mocked HTTP response to render the screen state". This blocks every flow whose state can't be reproduced live:

- **repo-health-dashboard-01 flow-4** (rate-limited) — can't trigger 5000/hr exhaustion live
- **repo-health-dashboard-01 flow-5** (private repo) — can't reach a private repo our token doesn't see
- **repo-health-dashboard-01 flow-6** (network failure) — can't reliably drop a connection
- Equivalent error-state flows in other Strategy D projects (auth-failed, 5xx, slow-network)

The `feat-038 Phase 6` was deferred for this. Now urgent because repo-health-dashboard-01 is the next validation target after kanban-09 was abandoned, and its 8 flows can only synthesize to ≥95% with the mock kind shipped.

## Approach

### Phase 1 — Schema bump (zod + JSON-schema mirror) (~30 min)

1. Add `MockInteractionStep` schema to `packages/orchestrator-contracts/src/user-flows-manifest.ts`:
   ```ts
   const MockInteractionStep = z.object({
     kind: z.literal("mock"),
     urlPattern: z.string(), // glob or regex string for page.route()
     status: z.number().int().min(100).max(599),
     body: z.union([z.string(), z.record(z.unknown())]), // string OR JSON-serializable object
     contentType: z.string().optional().default("application/json"),
     method: z
       .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
       .optional()
       .default("GET"),
   });
   ```
2. Add to the `InteractionStep` discriminated union.
3. Hand-mirror to `schemas/user-flows-manifest.schema.json`. Sync via `node scripts/sync-project-schemas.mjs --all` after.
4. Add 4 zod tests: round-trip valid mock; reject missing urlPattern; reject status out of range; nested-body JSON object accepted.

### Phase 2 — Synthesizer translator (~30 min)

5. Extend the kind switch in `scripts/synthesize-flow-e2e.mjs` (around line where existing kinds are translated):
   ```js
   case "mock": {
     const urlSrc = JSON.stringify(step.urlPattern);
     const bodySrc = typeof step.body === "string"
       ? JSON.stringify(step.body)
       : `JSON.stringify(${JSON.stringify(step.body)})`;
     const contentType = JSON.stringify(step.contentType || "application/json");
     const method = JSON.stringify(step.method || "GET");
     return `      ${idx} await page.route(${urlSrc}, (route) => {
        if (route.request().method() !== ${method}) { route.continue(); return; }
        route.fulfill({ status: ${step.status}, headers: { "content-type": ${contentType} }, body: ${bodySrc} });
      });`;
   }
   ```
6. Mock interactions must be emitted **before** the navigate that triggers the request (per Playwright semantics). Synthesizer doesn't reorder — flow-author orders correctly in `interactions[]`. Document this in `/user-flows-generator` SKILL.md step 4b.

### Phase 3 — Fixture-harness coverage (~20 min)

7. Add `orchestrator/tests/fixtures/synthesize-flow-e2e/strategy-d-with-mock/` fixture:
   - `architecture.yaml` (Strategy D: external-api proxy/cache, python-fastapi)
   - `user-flows-manifest.json` with one flow that uses `kind: "mock"` to fake a 429 response
   - `expected/flow-1.spec.ts` snapshot
8. Extend the existing structural-features test in `orchestrator/tests/synthesize-flow-e2e.test.ts` to assert: mock fixture emits `page.route(...)` call AND that call appears BEFORE the navigate.

### Phase 4 — `/user-flows-generator` skill update (~15 min)

9. Add new bullet to `.claude/skills/user-flows-generator/SKILL.md` step 4b: "When a flow's purpose is exercising an error/synthetic state (rate-limited, private, network-failure, 4xx/5xx response), insert one or more `kind: "mock"` interactions BEFORE the navigate that triggers the request. Each mock declares `urlPattern`, `status`, `body`, and optional `contentType`/`method`."
10. Add worked example showing repo-health-dashboard-01 flow-4 (rate-limited) authoring.

### Phase 5 — Project sync + propagation (~10 min)

11. Run `node scripts/sync-project-schemas.mjs --all` to propagate `schemas/user-flows-manifest.schema.json` to all 12 projects.
12. Manually copy `.claude/skills/user-flows-generator/SKILL.md` to the 5 explicit-target projects (4 pre-builds + repo-health-dashboard-01) per the agenticVisibility:private convention.

## Rejected Alternatives

- **Use `kind: "intercept"` instead of `mock`** — semantically equivalent but `mock` is the established term across Playwright + the testing-policy.md document. Naming consistency matters for grep-ability.
- **Auto-generate mock body shapes from architecture.yaml integration metadata** — too brittle; the operator/flow-author knows what response shape the SPA expects per flow. Synthesizer just emits the page.route() with the literal body.
- **Use a separate `mocks[]` array on each flow instead of inserting into `interactions[]`** — would force two-pass execution semantics; cleaner to keep mocks in execution order with the navigate that triggers them.
- **Defer to GHA / CI mocking layer (e.g. msw)** — adds a runtime dep; Playwright `page.route()` is built-in and deterministic. Stick with what's already there.

## Expected Outcomes

- [ ] `MockInteractionStep` shipped in `packages/orchestrator-contracts/src/user-flows-manifest.ts`
- [ ] `schemas/user-flows-manifest.schema.json` mirrored + synced to all 12 projects
- [ ] Synthesizer emits valid `page.route(...)` for `kind: "mock"`
- [ ] Fixture harness covers Strategy D + mock; structural assertion passes
- [ ] `/user-flows-generator` skill documents mock authoring with worked example
- [ ] All 398/398 contracts + 576/576 orchestrator tests still pass (+~6 new tests)

## Validation Criteria

- `pnpm --filter orchestrator-contracts test` passes (4 new tests for mock schema)
- `pnpm --filter orchestrator test` passes (1 new fixture covering mock translator)
- Manual smoke: author a one-step `mock` interaction in repo-health-01 flow-4; run synthesizer; inspect emitted spec — confirms `page.route()` call precedes navigate
- Schema validates against the existing user-flows-manifest.json files (no regression on legacy 5 manifests)

## Attempt Log

(empty)
