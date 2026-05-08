---
id: bug-079-runtime-errors-not-elevated-for-passing-tests
type: bug
status: draft
author-agent: human
created: 2026-05-08
updated: 2026-05-08
parent-plan: null
branch: fix/runtime-errors-elevated-on-passing-tests
affected-files:
  - scripts/run-synthesized-flows.mjs
feature-area: orchestrator/verification-coverage
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "scripts/run-synthesized-flows.mjs:652 — extractRuntimeErrors only runs when anyFailed === true; passing tests with hydration / console errors silently shelved as test-result attachments"
---

# bug-079: runtime-error attachments not elevated to bug class for passing tests

## Bug Description

The synthesizer emits a `test.afterEach` hook (per `apps/web/e2e/synthesized/flow-*.spec.ts`) that attaches a `runtime-errors` payload to test results when console errors / page errors / network failures / dev-server-overlay are detected during a test run. The orchestrator's `scripts/run-synthesized-flows.mjs::extractRuntimeErrors()` reads this attachment, classifies it as `runtime-error` bug class, and would route to bug-fixer.

**But that extraction only runs when the test FAILED.** Smoking gun at line 652:
```js
if (anyFailed) {
  const firstFailed = allResults.find((r) => r.status === "failed" || r.status === "timedOut");
  // ... extractRuntimeErrors(attachments, warnings) only happens here
}
```

If the test PASSED but the page emitted hydration errors / console errors during the run, the attachment exists (afterEach captured it) but the runner never reads it. Errors silently shelved in `test-results/<test>/runtime-errors`.

Empirical case from reading-log-02 census 2026-05-08: hydration error visible in dev console for the entire validation run (item 12 of the 30-bug census). Should have filed as `runtime-error` bug → routed to bug-fixer → addressed. Instead it's been live the whole time with the verifier giving a green light.

## Reproduction Steps

1. Spin a project with a known hydration error (e.g. reading-log-02 today)
2. Run /fix-bugs (or just /run-synthesized-flows)
3. All flows pass (selectors are role-based; structural pass)
4. Inspect `test-results/<flow>/runtime-errors` — JSON exists with consoleErrors[] populated
5. Inspect bugs.yaml — no `runtime-error` bug filed
6. Confirm: the error never made it to dispatch

## Root Cause Analysis

`scripts/run-synthesized-flows.mjs:652` — runtime-error elevation gated on `anyFailed === true`. The original feat-027 design assumed runtime errors only matter when they cause a test to fail. Empirically wrong: hydration errors don't crash tests (selectors still hit, page still renders enough for assertions to pass) but they ARE real product bugs.

Plus: per-test-run attachment extraction means the runner never aggregates runtime errors across PASSING tests. A run-wide aggregation would catch the cumulative signal.

## Fix Approach

1. **Move `extractRuntimeErrors()` out of the `if (anyFailed)` block.** Extract from EVERY test result regardless of pass/fail status.

2. **Per-spec aggregation**: collect all runtime-errors from passing AND failing tests into a single per-spec runtimeErrors[] array.

3. **Emit `runtime-error` bug class** when ANY non-empty runtime-errors are detected, not gated on test failure:
   - If spec passed AND has consoleErrors → file `runtime-error` bug (severity P1 — non-fatal but real)
   - If spec failed AND has consoleErrors → existing path; severity P0 (fatal AND with diagnostic context)

4. **De-duplicate** across tests in same spec — if hydration error fires on every flow's `page.goto("/")`, file ONE bug, not N.

5. **Add tests** (`scripts/__tests__/run-synthesized-flows.test.mjs` or similar): synthetic test results with passing tests + runtime-errors attachment → assertion that `runtime-error` bug class fires.

## Rejected Fixes

- **Fail the test if runtime errors exist (treat as test failure).** Rejected — Playwright tests are about behavior assertions, not console hygiene; failing-on-warning would create false-positive flakes from upstream library noise.
- **Only file runtime-error for "severe" errors (e.g. Hydration / TypeError but not console.warn).** Rejected — let the bug-fixer triage; orchestrator's job is to surface the signal, not classify severity beyond P0/P1.
- **Document the gap as expected behavior.** Rejected — empirical evidence that this is the load-bearing miss for items like the hydration error means it's a real bug, not a feature.

## Validation Criteria

1. Test spec passes AND has consoleErrors → orchestrator files `runtime-error` bug
2. Test spec fails AND has consoleErrors → existing severity-P0 path preserved
3. Multiple specs with same runtime error → de-duplicated to ONE bug
4. No false positives on a clean build (no spurious bugs filed)
5. On reading-log-02 census state → hydration error fires as `runtime-error` bug

## Cross-references

- Surfaced via investigate-025 Step 2 root-cause analysis (2026-05-08)
- Cross-axis: feat-066 v2 umbrella — independent of v2 architecture but ships in parallel
- Sister: feat-027 (the original runtime-error elevation feature)

## Attempt Log

<!-- Populated by executing agents. -->
