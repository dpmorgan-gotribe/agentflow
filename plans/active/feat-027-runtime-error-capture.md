---
id: feat-027-runtime-error-capture
type: feature
status: in-progress
approved-at: 2026-04-28
approved-by: human
author-agent: claude-opus-4-7
created: 2026-04-28
updated: 2026-04-28
parent-plan: feat-025-flow-spec-execution
supersedes: null
superseded-by: null
branch: feat/runtime-error-capture
affected-files:
  - scripts/synthesize-flow-e2e.mjs (inject runtime error listeners)
  - scripts/run-synthesized-flows.mjs (extract attachments → enrich output)
  - scripts/file-bug-plan.mjs (new "runtime-error" bug template)
  - packages/orchestrator-contracts/src/build-to-spec-verify.ts (extend FlowFailure with runtimeErrors[])
  - packages/orchestrator-contracts/src/bugs-yaml.ts (new BugSource: "runtime-error")
  - orchestrator/src/build-to-spec-verify.ts (route runtime-error bugs FIRST)
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-027 — Runtime error capture in build-to-spec verifier

## Summary

Today the verifier (feat-022 + feat-025) is **blind to console errors, page errors, network failures, and dev-server compile errors** — exactly the class of bug that most often blocks an app from rendering at all. When the app fails to compile/render, every synthesized flow times out at 30s with the SAME root cause invisible to the orchestrator.

Concrete kanban-webapp-10 case (2026-04-28): a missing CSS import path crashed the dev-server compile → pages rendered as Next.js error overlay → all 6 synthesized flows timed out → verifier reported "6 flow failures" → bug-fix agent applied surface-level fixes (correct as far as they went) → re-run still failed because the actual blocker (CSS parse error → blank page) was invisible at the orchestrator layer.

The root-cause string ("Can't resolve '../../packages/ui-kit/src/styles/globals.css'") was sitting in `test-results/*/error-context.md` files Playwright auto-generates — but the runner script doesn't extract or surface them.

This feature wires the missing primitives. After it lands, console errors / page errors / network failures / dev-server compile errors **become first-class bug entries** in `bugs.yaml` (per feat-026), routed FIRST in any iteration since they typically root-cause everything else.

## Goals

1. Capture all runtime errors per spec execution: `console.error`, `page.error`, `request.failed`, Next.js error-overlay (`__nextjs_overlay`)
2. Bubble them through `BuildToSpecVerifyOutput.flows.failed[].runtimeErrors[]`
3. Auto-author dedicated `runtime-error` bug entries (separate template from flow-step-transition / orphan)
4. Route runtime-error bugs FIRST in feat-026's iteration ordering — they typically mask everything else, fix them first
5. Stack traces + file/line + suggested-category in the bug body so agents can root-cause without re-running

## Non-goals (deferred)

- Detecting non-blocking warnings (`console.warn`) — too noisy; would surface React's "key" warnings and friends
- Source-map decoding for minified production builds (dev mode only for v1)
- Lighthouse / a11y audits as runtime errors (separate plan)
- Network performance regressions (separate plan)

## Approach

4 phases. Phase A is the synthesizer change (smallest, immediate signal). Phase B extends the runner. Phase C adjusts schema. Phase D wires bug-author + routing.

### Phase A — Synthesizer instrumentation (~30 LOC)

In `scripts/synthesize-flow-e2e.mjs`, wrap every emitted spec with `beforeEach` / `afterEach` that listens for runtime events and attaches them as Playwright test attachments:

```ts
test.beforeEach(async ({ page }, testInfo) => {
  const ctx = ((testInfo as any).__runtimeCtx = {
    consoleErrors: [] as string[],
    pageErrors: [] as Array<{ message: string; stack?: string }>,
    networkFailures: [] as Array<{
      method: string;
      url: string;
      failureText: string;
    }>,
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") ctx.consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) =>
    ctx.pageErrors.push({ message: err.message, stack: err.stack }),
  );
  page.on("requestfailed", (req) =>
    ctx.networkFailures.push({
      method: req.method(),
      url: req.url(),
      failureText: req.failure()?.errorText ?? "unknown",
    }),
  );
});

test.afterEach(async ({}, testInfo) => {
  const ctx = (testInfo as any).__runtimeCtx;
  if (!ctx) return;
  if (
    ctx.consoleErrors.length ||
    ctx.pageErrors.length ||
    ctx.networkFailures.length
  ) {
    await testInfo.attach("runtime-errors", {
      body: JSON.stringify(ctx, null, 2),
      contentType: "application/json",
    });
  }
});
```

Also: at the start of each step, navigate via `page.goto(...)`, then probe the Next.js error overlay (`document.querySelector("#__next_error__, [data-nextjs-error-overlay]")`) — if present, capture its content as a `dev-server-compile-error` runtime event.

### Phase B — Runner extracts attachments (~80 LOC + 6 tests)

In `scripts/run-synthesized-flows.mjs`, when parsing the Playwright JSON reporter output:

```js
// Existing: extract step / error / screenshot per failed test
// New: also walk testResult.attachments[] for { name: "runtime-errors", contentType: "application/json" }
const runtimeAttachment = testResult.attachments?.find(
  (a) => a.name === "runtime-errors",
);
if (runtimeAttachment) {
  const body = readFileSync(runtimeAttachment.path, "utf8");
  const parsed = JSON.parse(body);
  failure.runtimeErrors = parsed; // { consoleErrors, pageErrors, networkFailures }
}
```

When a flow timed out (no step-transition failure recorded), and runtime errors WERE captured, surface those as the primary failure cause: `failure.primaryCause = "runtime-error"` + populate `failure.runtimeErrorSummary`.

### Phase C — Schema + contract updates (~40 LOC + 5 tests)

Extend `BuildToSpecVerifyOutput.flows.failed[]` schema in `packages/orchestrator-contracts/src/build-to-spec-verify.ts`:

```ts
runtimeErrors: z.object({
  consoleErrors: z.array(z.string()).default([]),
  pageErrors: z.array(z.object({
    message: z.string(),
    stack: z.string().optional(),
  })).default([]),
  networkFailures: z.array(z.object({
    method: z.string(),
    url: z.string(),
    failureText: z.string(),
  })).default([]),
  devServerOverlay: z.object({
    rawText: z.string(),
    detected: z.boolean(),
  }).optional(),
}).optional(),

primaryCause: z.enum(["step-transition", "runtime-error", "dev-server-compile", "timeout-no-evidence"]).optional(),
```

Extend `BugSourceSchema` in `packages/orchestrator-contracts/src/bugs-yaml.ts`:

```ts
export const BugSourceSchema = z.enum([
  "reachability-orphan",
  "flow-execution-failure",
  "runtime-error", // NEW (feat-027)
  "dev-server-compile", // NEW (feat-027)
  "pm-coverage-omission",
]);
```

### Phase D — Bug author + iteration routing (~100 LOC + 8 tests)

Extend `scripts/file-bug-plan.mjs` with `runtimeErrorBody()` template:

```
bug-runtime-{n}-{slug}
  ## Description
  Runtime errors observed during flow {flow.id} ({flow.name}):

  ### Console errors ({n})
  - <error 1>
  - <error 2>

  ### Page errors ({n})
  - <message + stack frame head>

  ### Failed network requests ({n})
  - GET /assets/foo.css → net::ERR_FILE_NOT_FOUND

  ### Dev-server compile error (if detected)
```

  <verbatim overlay text>
  ```

## Likely category

- parse-error → check most-recently-edited CSS/JS files in the
  cited path
- missing-import → grep for the failing module path; check tsconfig
  paths + workspace alias
- hydration-mismatch → check for Date.now() / Math.random() in
  server components

## Fix approach

Surface the FIRST listed error as the root cause; downstream errors
often cascade from it. Re-run /build-to-spec-verify after the fix to
confirm the cascade clears.

```

In `orchestrator/src/build-to-spec-verify.ts`, when correlating verify results into `bugs.yaml`:
- Bugs with `source: runtime-error` OR `source: dev-server-compile` → severity `P0`, sort FIRST in iteration order
- Bugs with `source: flow-execution-failure` AND `primaryCause: timeout-no-evidence` → tag with `dependsOn: <runtime-error-bug-id>` if any runtime-error bug exists in the same iteration (so feat-026's loop fixes the runtime error first, then re-verify naturally clears the timeout)

This sequencing is critical: today's kanban-10 case would have shown 1 dev-server-compile bug + 6 timeout-no-evidence bugs all flagged at once. With dependency tagging, feat-026 fixes the compile error in iteration 1, re-verifies, the 6 timeouts naturally clear → loop exits at iteration 2.

## Validation criteria

- Replay kanban-webapp-10 with the unfixed CSS bug + feat-027 in place: verifier reports `1 dev-server-compile bug + 6 dependent flow-execution bugs (suppressed pending dependency fix)` with the actual CSS error text in the dev-server-compile bug
- Synthetic test: stub Playwright JSON reporter output with `attachments: [{ name: "runtime-errors", body: ... }]` → assert runner extracts + surfaces them
- Synthetic test: pageError captured → bug template body includes the stack trace
- Synthetic test: network 404 captured → bug body includes the failed URL
- Synthetic test: feat-026 iteration ordering puts runtime-error bugs FIRST + tags timeouts as dependent
- 644 + bug-016 + feat-025 + feat-024 existing tests still pass; +21 new

## Cross-references

- **Parent**: feat-025 (flow-spec execution that this enriches)
- **Sibling**: feat-026 (auto-fix loop that consumes the new bug entries; sequencing depends on this feature's `dependsOn` tagging)
- **Reuses**: Playwright's existing test-info attachment API; no new deps
- **Blocked by nothing**: can ship in parallel with feat-026 (shared schema field; no runtime conflict)

## Open questions

- **Source-map handling for production builds**: dev-mode stack traces are readable; production builds would need source-map fetching. Defer to v2; v1 only useful for dev.
- **Console-warn promotion**: should certain warns ever escalate to bugs? E.g. React's "rendered fewer hooks than expected" is technically a warning but always a real bug. Maintain an allowlist? Defer.
- **Cross-flow runtime-error dedup**: if the same runtime error fires on every flow (today's kanban-10 case), filing 6 separate bugs would be noisy. Phase D's `dependsOn` tagging plus a "primary runtime error" promotion handles the common case but may need refinement (e.g. consolidate into ONE `runtime-error` bug listing all affected flows).

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->
```
