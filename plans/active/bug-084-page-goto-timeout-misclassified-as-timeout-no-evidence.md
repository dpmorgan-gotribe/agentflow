---
id: bug-084-page-goto-timeout-misclassified-as-timeout-no-evidence
type: bug
status: draft
author-agent: human
created: 2026-05-11
updated: 2026-05-11
parent-plan: investigate-026-timeout-no-evidence-bug-fixer-stalls
supersedes: null
superseded-by: null
branch: fix/page-goto-timeout-misclassified
affected-files:
  - scripts/run-synthesized-flows.mjs
  - packages/orchestrator-contracts/src/build-to-spec-verify.ts
  - scripts/file-bug-plan.mjs
  - orchestrator/tests/run-synthesized-flows.test.ts
feature-area: orchestrator/verification-coverage
priority: P1
attempt-count: 0
max-attempts: 5
error-message: "page.goto timeouts (environmental dev-server-unavailable failures) get classified as timeout-no-evidence → routed to bug-fixer which has nothing to fix because the failure isn't in source"
---

# bug-084: `page.goto` timeouts misclassified as `timeout-no-evidence` flow-failures

## Bug Description

When the synthesized E2E spec fails at `await page.goto("/")` because the dev server doesn't respond to a navigation within Playwright's 30s timeout, the runner classifies the failure as `primaryCause: "timeout-no-evidence"` (per `scripts/run-synthesized-flows.mjs:728`) — which routes to bug-fixer for source-code fixing.

But the failure isn't in source code. It's environmental:

- The dev-server's `/health` endpoint responds (orchestrator's bootDevServer would have thrown otherwise) BUT
- Actual page navigations time out within 30s. Likely causes: hydration error preventing `networkidle` from firing, long-poll keeping the page busy, Next.js dev-mode cold-boot taking too long on Windows, or slow first-paint due to JS bundle size.

bug-fixer cannot fix this from source. The agent reads the spec ("click X, expect Y"), sees the error ("timeout 30s exceeded at page.goto"), tries to find a fix-site, finds none meaningful, eventually returns `completed` (or stalls without a fix). Empirical from reading-log-02 2026-05-11: 6 of 6 synthesized flow tests failed at `page.goto`; 3 went pending after attempt 1, 3 marked completed without any commits.

The right classification + routing for this class is **not** flow-execution-failure (which implies bug-in-flow-logic). It's a dev-server-readiness gap that needs operator triage OR a different specialist agent.

## Reproduction Steps

1. On a project with a hydration error or slow networkidle convergence (reading-log-02 today), run `/build-to-spec-verify`.
2. Observe: synthesized flow tests fail at `page.goto` with `Test timeout of 30000ms exceeded`.
3. Inspect the filed bug in `docs/bugs.yaml`: `primaryCause: timeout-no-evidence`, `agentSequence: [bug-fixer]`.
4. Inspect the failure envelope at `docs/build-to-spec/failures/<flowId>-failure.html` — contains `Error: page.goto: Test timeout of 30000ms exceeded` + `URL when error fired: http://localhost:3000/`.
5. Note: `__stepIndex === 0` in the spec at failure time (test never reached an interaction step).

## Root Cause Analysis

`scripts/run-synthesized-flows.mjs:728` (per feat-038 Phase 4 classifier):

```js
} else if (isTimedOut && !meta.step) {
  primaryCause = "timeout-no-evidence";
}
```

`meta.step` comes from `parseFailureMessage` which extracts the step index from the error message format `"flow-N (Name) failed at interaction N: <playwright error>"`. For `page.goto` timeouts at \_\_stepIndex 0, the synthesizer's catch block emits the same error format with `interaction 0`, but `parseFailureMessage` may not set `meta.step` to 0 OR the runner's classifier doesn't distinguish step-0 from missing-meta.

Either way, the classifier conflates two distinct failure modes:

1. **Genuine timeout-no-evidence**: the test reached step N > 0 but timed out at an interaction; the runner has no screen-id meta to classify what page state was reached. Bug-fixer can sometimes fix these (the screenshot + DOM dump reveal what was on screen).
2. **page.goto timeout at step 0**: the test never started — the page didn't load. Bug-fixer cannot fix this; the failure is environmental.

The classifier needs to distinguish (2) and route it to operator-review (or a new dev-server-readiness-investigator agent), not bug-fixer.

## Fix Approach

**Phase A — new FlowPrimaryCause + classifier branch (~2hr):**

1. Add `"dev-server-not-responding"` to `FlowPrimaryCause` enum in `packages/orchestrator-contracts/src/build-to-spec-verify.ts`.
2. In `scripts/run-synthesized-flows.mjs::parseReporterJson`, detect the `page.goto` + `Test timeout of 30000ms exceeded` pattern in `errorMsg` OR detect `__stepIndex === 0` from the synthesizer's emit-format. Classify as `dev-server-not-responding` instead of `timeout-no-evidence`:

```js
const isGotoTimeout =
  isTimedOut &&
  /page\.goto:\s*Test timeout/.test(errorMsg) &&
  // Step 0 means the synthesizer's catch fired before any interaction
  (meta.step === 0 || meta.step === undefined);
if (isGotoTimeout) {
  primaryCause = "dev-server-not-responding";
}
```

(Order matters — `dev-server-not-responding` should be tested BEFORE the existing `timeout-no-evidence` branch.)

3. In `scripts/file-bug-plan.mjs::defaultAgentSequence`, add a case for the new cause:

```js
case "dev-server-not-responding":
  return []; // operator-only; no agent dispatch can fix dev-server availability
```

Routes to `agentSequence: []` (empty), which marks the bug as `needs-operator-review` per the existing manifest-author convention.

4. The bug-plan body template (`runtimeErrorBody` adjacent) should surface the diagnostic: the failing URL + error message + a one-liner pointing the operator at common causes (hydration error, slow Next.js cold-boot, networkidle hang). The investigator file `docs/build-to-spec/failures/<flowId>-failure.html` already has the raw info — the body template just needs to reference it + flag operator-review.

**Phase B — tests (~30min):**

- Unit test: synthesized flow stub with `__stepIndex === 0` + `page.goto` timeout in error → classifier emits `dev-server-not-responding`.
- Unit test: flow that times out at step 2 (interaction failure, no page.goto in error) → classifier emits `timeout-no-evidence` (existing behavior preserved).
- Unit test: file-bug-plan with `primaryCause: "dev-server-not-responding"` → agentSequence is `[]`.

**Phase C — documentation (~15min):**

- Update `docs/reviewer-playbook.md` or a relevant runbook with the new failure class + operator-action expectation.
- Cross-reference bug-071 (Playwright webServer spawn) — the dev-server-readiness problem space has multiple known surfaces; this classification helps operators triage without ML.

## Rejected Fixes

- **Bump Playwright's `page.goto` timeout from 30s to 60s+** — masks the underlying issue. If the page can't render in 30s on a dev machine, real users will hit the same wall. The slowness is the bug.
- **Auto-retry the spec on `page.goto` timeout** — adds wall-clock + doesn't fix the underlying readiness gap; flaky-test territory.
- **Route to bug-fixer with extended turn budget** — bug-fixer still can't fix environmental issues. More turns = more $$$ + same dead-end.
- **Add `page.goto` retry logic to the synthesizer's emit** — same issue as above; the cause is upstream.

## Validation Criteria

- [ ] `FlowPrimaryCause` enum extends with `dev-server-not-responding`
- [ ] `run-synthesized-flows.mjs` classifies `page.goto` timeout at \_\_stepIndex 0 as `dev-server-not-responding`
- [ ] `file-bug-plan.mjs::defaultAgentSequence` returns `[]` for the new cause → bug ends up with `status: needs-operator-review`
- [ ] 3 new tests cover the classifier branches + dispatch routing
- [ ] Empirical: re-run /fix-bugs reading-log-02 after this fix lands; the 6 page.goto-timeout bugs that previously routed to bug-fixer should now route to operator-review with `agentSequence: []`

## Cross-references

- **investigate-026** Finding 2 surfaced this — the apparent `timeout-no-evidence` bugs were all `page.goto` failures.
- **bug-082** (orchestrator-trusts-unverified-completion) — the highest-priority companion. Without bug-082's commit-required guard, this bug's misclassification is masked (the bugs get marked completed despite no fix); with bug-082, the misclassification becomes loudly visible as repeated `failed` outcomes that should never have been dispatched.
- **bug-083** (flow-execution-failure envelope enrichment) — sister fix in the same investigation; ships independently.
- **bug-071** (Playwright webServer spawn) — the bug-class-adjacent dev-server-readiness fix.
- **feat-068** (vision-LLM perceptual review, deferred Phase 3) — could potentially handle `dev-server-not-responding` by inspecting the page state + understanding "this is a loading error, not a UI bug." But that's vastly more expensive than the operator-review route bug-084 proposes.

## Attempt Log

<!-- Populated by executing agents. -->
