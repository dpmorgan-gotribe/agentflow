---
id: bug-044-flow-3-tohaveurl-regex-vs-absolute-url
type: bug
status: draft
author-agent: human
created: 2026-05-03
updated: 2026-05-03
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/flow-3-tohaveurl-absolute-url
affected-files:
  - projects/finance-track-01/apps/web/e2e/flow-3.spec.ts
feature-area: project-finance-track-01/test-authoring
priority: P2
attempt-count: 0
max-attempts: 5
error-message: "Error: flow-3 (Month-end review across currencies) failed at step 7: expect(page).toHaveURL(expected) failed. Expected pattern: /^\\//. Received string: \"http://localhost:3000/\""
reproduction-steps: "From projects/finance-track-01: DATABASE_PATH=./data/finance-track-test.db PORT=3001 ENABLE_TEST_SEED=1 NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 pnpm -C apps/web exec playwright test e2e/flow-3.spec.ts → first test passes through step 6 then fails at step 7 with the regex/string mismatch above."
stack-trace: null
---

# bug-044: hand-written flow-3 step 7 uses `toHaveURL(/^\//)` which doesn't match the absolute URL

## Bug Description

Surfaced 2026-05-03 during Wave 2 empirical validation of the bug-040/041/042/043 chain. The seeding pipeline now works (3 active accounts seeded, 174+ transactions, dashboard renders populated UI). The hand-written flow-3 spec passes 6 steps and fails at step 7 on a Playwright `toHaveURL` assertion that uses a regex pattern intended to match a path-only URL (`/^\//`) but Playwright's `toHaveURL` matches against the FULL URL (`http://localhost:3000/`).

This is a test-authoring bug, not a product bug — the URL is correct (root path), the assertion is just wrong about what `toHaveURL` matches against. Was masked previously because step 2 failed first (the bug-042 empty-state symptom) — only visible now that the seeding pipeline works.

## Reproduction Steps

```
cd projects/finance-track-01
DATABASE_PATH=./data/finance-track-test.db \
  PORT=3001 \
  ENABLE_TEST_SEED=1 \
  NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 \
  pnpm -C apps/web exec playwright test e2e/flow-3.spec.ts --reporter=list
```

Empirical output (2026-05-03):

```
✘  1 [chromium] › e2e\flow-3.spec.ts:59:7 › Month-end review across currencies (flow-3)
   › dashboard renders month summary; display currency switch reflects in subtitle (7.7s)
✓  2 [chromium] › e2e\flow-3.spec.ts:125:7 › ... display currency persists in localStorage across a page reload (854ms)

Error: flow-3 (...) failed at step 7: expect(page).toHaveURL(expected) failed
  Expected pattern: /^\//
  Received string:  "http://localhost:3000/"
  Timeout: 5000ms
  Call log:
    - Expect "toHaveURL" with timeout 5000ms
    2 × unexpected value "http://localhost:3000/settings/"
    7 × unexpected value "http://localhost:3000/"
```

## Root Cause Analysis

`flow-3.spec.ts:99` (or wherever step 7 lives) likely contains:

```ts
await expect(page).toHaveURL(/^\//);
```

The intent is "the page is at any path starting with /" (i.e., didn't navigate to an external URL). But Playwright's `toHaveURL` matches against the full URL string (per the docs: "URL string, regex, or predicate receiving the full URL"). The regex `/^\//` matches a string that STARTS with `/`, but the full URL is `http://localhost:3000/`, which starts with `h`. So the regex never matches.

The 2 settings page hits in the call log (`localhost:3000/settings/`) suggest step 6 navigated to settings successfully, then step 7 expects to be back at `/` after some action (a back-navigation? a default redirect?) but the assertion form is wrong.

## Fix Approach

Three viable fixes; the right one depends on what step 7 was supposed to assert:

### Option A — match path with regex anchored to host

```ts
await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/$/);
```

Asserts the URL is the root path. Tightly bound; clear intent.

### Option B — use `new URL()` decomposition

```ts
await expect
  .poll(
    async () => {
      return new URL(page.url()).pathname;
    },
    { timeout: 5000 },
  )
  .toBe("/");
```

More verbose but pathname-only assertion is unambiguous.

### Option C — use Playwright's path-relative matcher

```ts
await expect(page).toHaveURL(""); // empty string = root path relative to baseURL
```

OR

```ts
await expect(page).toHaveURL("/");
```

Playwright's docs say `toHaveURL("/")` checks for absolute URL `<baseURL>/` when baseURL is set. Cleanest for this case.

**Recommended: Option C** (`"/"`). Matches the spec's intent + reads naturally + leverages Playwright's existing baseURL handling.

## Validation Criteria

- [ ] Step 7 passes against the populated dashboard (post-Wave-2 seeding chain).
- [ ] No regression on step 6 (settings navigation) or step 8+ (whatever comes after).
- [ ] Spec passes 1/1 instead of 0/1.

## Cross-references

- **Empirical case**: 2026-05-03 finance-track-01 Wave 2 validation — surfaced after bug-040/041/042/043 fixed the seeding-pipeline failure chain (was masked behind the empty-state symptom at step 2).
- **Sister bug**: bug-045 (synthesized flow-3 selector mismatch) — also a test-authoring issue surfaced post-Wave-2.
- **Predecessor**: bug-040/041/042/043 — Wave 2 empirical validation that proved the seeding chain works end-to-end.

## Attempt Log

<!-- populated as fix attempts are made -->
