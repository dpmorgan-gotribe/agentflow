---
id: bug-051-user-flows-generator-selector-quality-and-mocking-strategy
type: bug
status: draft
author-agent: claude-opus-4-7
created: 2026-05-03
updated: 2026-05-03
parent-plan: bug-046-user-flows-generator-malformed-css-role-selectors
supersedes: null
superseded-by: null
branch: fix/user-flows-generator-selector-quality
affected-files:
  - .claude/skills/user-flows-generator/SKILL.md
  - scripts/synthesize-flow-e2e.mjs
  - orchestrator/tests/synthesize-flow-e2e.test.ts
feature-area: orchestration
priority: P2
attempt-count: 0
max-attempts: 5
error-message: "2 of 9 finance-track-01 synthesized E2E failures (2026-05-03) caused by manifest-author selector quality issues — flow-2 strict-mode violation on `:has-text` ambiguity, flow-4 `page.route` mocking the wrong layer (browser-side mock vs backend-originated upstream call). /user-flows-generator SKILL.md doesn't warn about either trap."
reproduction-steps: 'Re-author any user-flows-manifest with `:has-text("X")` selector on a parent that contains BOTH X and another button; OR mock an external API via `page.route` when the build''s API call originates from the BACKEND not the browser. Run synthesizer + Playwright. Both fail with non-obvious diagnostics.'
stack-trace: null
---

# bug-051 — `/user-flows-generator` selector quality + mocking-layer guidance gaps

## Bug Description

Sister to bug-046+047 (the synthesizer hardening sprint). 2 of 9 flow failures on `finance-track-01` (2026-05-03) are caused by `/user-flows-generator` authoring selectors / mocks that look reasonable but fail in non-obvious ways.

### Case A — flow-2: `:has-text` strict-mode violation

Manifest interaction emits:

```ts
await page
  .locator(`[data-kit-component="Card"]:has-text("Import CSV")`)
  .locator(`role=button`)
  .click();
```

Failure: `strict mode violation — locator resolved to 2 elements`. The card's surface text contains BOTH "Import CSV" AND "Export JSON" (it's a settings card with both buttons), so `:has-text("Import CSV")` matches the SAME card whether searching for either string. Then the inner `role=button` finds 2 buttons.

The Playwright trap: `:has-text(...)` matches the element if the substring appears ANYWHERE inside its DOM subtree — it doesn't filter to "this is the descendant whose text contains X". Idiomatic Playwright instead uses `getByRole("button", { name: "Import CSV" })` — direct role+name selection.

### Case B — flow-4: `page.route` mocks the wrong layer

Manifest interaction emits:

```ts
await page.route(new RegExp("api\\.frankfurter\\.app"), (route) => route.fulfill({...}));
await page.locator(`[Card]:has-text("FX cache") >> role=button[name="Refresh FX now"]`).click();
await page.waitForResponse((r) => /\/api\/fx\/refresh/.test(r.url()) && r.status() === 200);
```

Failure: 30s timeout — `waitForResponse` never fires.

Root cause: `page.route()` intercepts BROWSER-originated network requests only. finance-track's `/api/fx/refresh` proxy runs in the BACKEND (Node) which fetches `api.frankfurter.app` from Node's network stack — Playwright's browser-context mock is invisible there. The page snapshot already shows "Refresh failed. Check your network connection." on initial load, confirming the backend's frankfurter call legitimately failed.

The architectural answer is one of:

1. Make the build resilient to upstream failure (already partially the case via `apps/api/src/fx/frankfurter.client.ts` fallback) AND adjust the flow to assert on cached-fallback behavior, not on a successful refresh
2. Use a backend-side mock — set `FRANKFURTER_BASE_URL` to a Playwright-managed mock server (e.g. via `webServer` + a mock-fixture sidecar)
3. Skip flow-4 in CI until backend mocking is wired up; document as `LIVE_API=1` smoke test

None of these are obvious from `/user-flows-generator`'s current SKILL.md. The generator authors `page.route()` because that's what the surface API teaches; the deeper architectural mismatch is invisible.

## Root Cause Analysis

### Gap 1 — `:has-text` selector idiom is recommended without warning

`/user-flows-generator/SKILL.md §4b` (post bug-046 expansion) documents engine-mix selectors but doesn't warn that `:has-text` matches whole subtrees. The authored manifest then propagates the trap.

### Gap 2 — `page.route` mocking strategy doesn't account for call-origin

The skill teaches `page.route` for mocking external APIs (per testing-policy §External-API-tests-must-mock). But `page.route` works only when the call is browser-originated. The skill's mock examples don't tell the operator to check whether the API call goes browser→external (mockable) or backend→external (not mockable from the browser).

## Approach

### Phase A — SKILL.md anti-pattern callouts

Two new subsections in `/user-flows-generator/SKILL.md §4b`:

#### §4b — `:has-text` strict-mode trap

```markdown
**❌ wrong** — `:has-text` matches the entire subtree, not just the descendant
\`\`\`json
{ "selector": "[data-kit-component=\"Card\"]:has-text(\"Import CSV\")", "action": "click" }
\`\`\`
A card containing both "Import CSV" + "Export JSON" matches BOTH ways. Strict-mode violation.

**✓ right** — direct role+name selection
\`\`\`json
{ "selector": "role=button[name=\"Import CSV\"]", "action": "click" }
\`\`\`
Idiomatic Playwright. Resolves to the unique button regardless of surrounding card text.

**✓ better** — combine container scoping with terminal role+name
\`\`\`json
{ "selector": "[data-kit-component=\"Card\"]:has-text(\"Import CSV\") >> role=button[name=\"Import CSV\"]", "action": "click" }
\`\`\`
Only when the card-scoping is semantically important (e.g. distinguishing two cards on same page).
```

#### §4b — Mocking external APIs by call origin

```markdown
External API mocking depends on WHERE the call originates:

**Browser-originated** (frontend `fetch("api.example.com/...")`) — use `page.route()`:
\`\`\`json
{ "kind": "mock", "urlPattern": "api\\.example\\.com", "response": { "status": 200, "body": {...} } }
\`\`\`

**Backend-originated** (frontend → `/api/proxy` → backend → `api.example.com`) — `page.route()` does NOT work; the call leaves Node's stack, never crosses the browser. Options:

- Test the backend's offline-fallback behavior; assert on the cached-fallback UI state, not on a successful refresh.
- Skip the flow in CI; mark as `LIVE_API=1` smoke test (per testing-policy §External-API-tests-must-mock).
- Configure a backend-side mock server (Playwright `webServer` + sidecar). Document the project-specific shape if you go this route.

To classify a flow's external-API touch: trace the architecture. Frontend calls `/api/fx/refresh` → backend calls `api.frankfurter.app`. The mockable layer is `/api/fx/refresh` (browser-originated), not `api.frankfurter.app` (backend-originated).
```

### Phase B — Synthesizer post-flight `:has-text` strict-mode lint

Mirror bug-046's `ENGINE_MIX_RE` pattern. New regex detects `:has-text(...)` immediately followed by a chained selector that targets ambiguous descendants:

```js
// bug-051: warn when `:has-text("...")` is used as a parent scope but the
// chained child selector doesn't include `[name=...]` or `:nth-of-type(...)`
// — the strict-mode violation surface.
const HAS_TEXT_AMBIGUOUS_RE =
  /:has-text\([^)]+\)(?:\s*>>\s*|\s+\.locator\([^)]+\))(?!.*\[name=|:nth-of-type)/;
```

Push to `errors[]` (hard error, same as ENGINE_MIX_RE) when matched. Manifest authors must explicitly use role+name terminal selectors.

### Phase C — Synthesizer post-flight `page.route` mock-layer warning

Soft warning (push to `warnings[]`, not errors[]): when a flow contains a `kind: "mock"` interaction whose `urlPattern` matches a known backend-originated upstream pattern, surface guidance.

Implementation: configurable in the synthesizer via `architecture.yaml.tooling.externalApis[].callOrigin: "browser" | "backend"` slot. Architect populates this when picking integration vendors. Synthesizer reads + cross-references manifest mock URLs.

For v1 (this plan): skip the architect side; just emit warning when `urlPattern` matches `api.frankfurter.app|api.openai.com|generativelanguage.googleapis.com` etc. (a small known-backend-API allowlist). Architect-driven detection is feat-future depth.

### Phase D — Regression tests

`orchestrator/tests/synthesize-flow-e2e.test.ts` gains:

- 2 cases for `:has-text` strict-mode lint (positive: ambiguous → error; negative: unambiguous → no error)
- 1 case for backend-API mock warning (frankfurter URL + `kind: "mock"` → warning)

## Success Criteria

- [ ] Phase A: SKILL.md §4b has both new subsections with worked examples
- [ ] Phase B: synthesizer post-flight pushes hard error for `:has-text` strict-mode trap shape
- [ ] Phase C: synthesizer post-flight pushes warning for known-backend-API mock pattern
- [ ] Phase D: 3 new tests pass (632 → 635)
- [ ] Empirical: re-running synthesizer on finance-track-01 surfaces flow-2's `:has-text` trap as `errors[0]` and flow-4's frankfurter mock as `warnings[0]`

## Cross-references

- Parent: `bug-046-user-flows-generator-malformed-css-role-selectors` — sibling defense-in-depth shape (SKILL.md anti-pattern + synthesizer post-flight regex lint)
- Sister: `bug-050` — closes the `manifest-author` primaryCause class via classifier; this plan reduces the rate at the source
- Sister: `feat-048-synthesizer-output-linting` — broader output linting (TS typecheck + locator dry-create); this plan ships narrow-pattern linting now without waiting for feat-048's full Phase
- `.claude/rules/testing-policy.md §External-API-tests-must-mock` — the upstream-mocking constraint this plan tightens
- Empirical: 2/9 finance-track-01 flow failures (flow-2 strict-mode, flow-4 mock-layer mismatch)
