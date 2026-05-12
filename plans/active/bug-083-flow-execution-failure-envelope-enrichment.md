---
id: bug-083-flow-execution-failure-envelope-enrichment
type: bug
status: in-progress
author-agent: human
created: 2026-05-11
updated: 2026-05-11
parent-plan: investigate-026-timeout-no-evidence-bug-fixer-stalls
supersedes: null
superseded-by: null
branch: fix/flow-execution-failure-envelope-enrichment
affected-files:
  - orchestrator/src/bug-fix-context.ts
  - orchestrator/tests/bug-fix-context.test.ts
feature-area: orchestrator/fix-loop
priority: P1
attempt-count: 0
max-attempts: 5
error-message: "bug-fix-context envelope for flow-execution-failure bugs only pre-loads the spec + manifest; the synthesizer-captured failure HTML + screenshot artefacts ARE on disk but never reach the dispatched agent"
---

# bug-083: bug-fix-context envelope is information-thin for flow-execution-failure bugs

## Bug Description

When the verifier files a `flow-execution-failure` bug, the synthesizer's per-spec try/catch already writes diagnostic artefacts to disk:

- `<projectDir>/docs/build-to-spec/failures/<flowId>-failure.html` — page DOM at failure OR envelope-fallback with URL + error message + stack trace
- `<projectDir>/docs/build-to-spec/failures/<flowId>-failure.png` — page screenshot at failure (when capture succeeded)

The bug-fix-context envelope resolver (`orchestrator/src/bug-fix-context.ts:133-147`) only pre-loads the failing spec + the user-flows-manifest. The failure artefacts are NEVER included in the dispatch envelope, despite being deterministic captures the verifier already writes.

Result: the bug-fixer agent receives the SPEC (which says "click X, expect Y") + the MANIFEST (which says "flow-N does N interactions") but has no information about WHY the test failed at runtime. It must Read/Grep its way to discovering the actual error — burning turn budget on diagnostic work the synthesizer already did.

Empirical (reading-log-02 /fix-bugs 2026-05-11):

- 6 flow-execution-failure bugs filed
- 6 failure HTML envelopes exist on disk (572 bytes each — minimal but contains `Error: page.goto: Test timeout of 30000ms exceeded` + URL + stack)
- 2 failure screenshots exist (flow-3, flow-5)
- 0 of these artefacts pre-loaded into bug-fixer dispatch envelopes
- Bug-fixer dispatches stalled at 90s+ SDK-warn-threshold trying to figure out what went wrong

## Reproduction Steps

1. Trigger any project's `/build-to-spec-verify` such that it produces a flow-execution-failure bug.
2. Verify the synthesizer wrote `docs/build-to-spec/failures/<flowId>-failure.html` (and possibly .png).
3. Trigger `/fix-bugs <project>` to dispatch a bug-fixer against that bug.
4. Inspect the dispatch envelope (or grep the agent's transcript) — note that the failure HTML / PNG path is not referenced.
5. Watch the agent's Read tool calls — it spends turns hunting for the same info already on disk.

## Root Cause Analysis

`orchestrator/src/bug-fix-context.ts:133-147` — the `flow-execution-failure` branch of `resolveFilesForBug` doesn't reference `docs/build-to-spec/failures/`:

```ts
if (bug.source === "flow-execution-failure" && bug.flow) {
  out.push({
    relPath: `apps/web/e2e/synthesized/${bug.flow.id}.spec.ts`,
    reason: "Failing synthesized spec",
  });
  out.push({
    relPath: "docs/user-flows-manifest.json",
    reason: "User-flows manifest (find this flow's requiredState)",
  });
}
```

When this code was written (feat-063), the failure-artefacts capture infrastructure already existed in the synthesizer (see `scripts/synthesize-flow-e2e.mjs` ~615 and bug-072 — the file-not-empty hardening). The envelope resolver just wasn't updated to consume it.

Compare with the `visual-parity` branch (line ~149) which DOES pre-load the diff PNG when present — feat-067 Phase C added that wiring. The flow-execution-failure branch never got the analogous update.

## Fix Approach

**Phase A — extend resolver (~30min):**

In `bug-fix-context.ts:resolveFilesForBug`'s `flow-execution-failure` branch, append:

```ts
out.push({
  relPath: `docs/build-to-spec/failures/${bug.flow.id}-failure.html`,
  reason:
    "Failure envelope (timeout / error message / stack trace / DOM dump when available)",
});
out.push({
  relPath: `docs/build-to-spec/failures/${bug.flow.id}-failure.png`,
  reason: "Failure screenshot (when captured)",
});
```

`emitFileSection` silently logs missing files in the diagnostic block, so over-specifying is safe — if the .png doesn't exist (some failure modes don't capture one), the diagnostic shows `✗ file missing` and the agent reads the .html instead.

**Phase B — page-route inference (~1hr; nice-to-have):**

Parse the failing spec's `await page.goto(<path>)` and `await page.locator(...).click()` calls. Derive the route from the path. Pre-load the likely route file:

- `page.goto("/")` → pre-load `apps/web/app/page.tsx`
- `page.goto("/books/X")` → pre-load `apps/web/app/books/[id]/page.tsx`
- `page.goto("/tags")` → pre-load `apps/web/app/tags/page.tsx`

This mirrors the multi-path heuristic in the `visual-parity` branch (line ~172-189). When unsure, include both `apps/web/app/<inferred>/page.tsx` AND `apps/web/app/page.tsx` (index fallback).

Phase B is optional for v1 of this fix — Phase A delivers most of the value. Defer Phase B if the empirical re-validation post-Phase-A shows the agent recovers without it.

**Phase C — tests (~30min):**

- Positive case: bug with `source: "flow-execution-failure"`, `flow.id: "flow-2"`, failure.html present → envelope.resolvedFiles contains the path with reason matching "Failure envelope".
- Negative case: same bug shape but failure.html missing → envelope.missingFiles records it; no crash.
- Negative case: failure.png missing (envelope-only) → resolves cleanly with diagnostic.

## Rejected Fixes

- **Embed the failure artefact contents into bug.flow context at file-bug-plan time** — would require schema changes + the artefacts go stale across iterations. Better to keep them on disk + reference by path.
- **Pre-load `docs/build-to-spec/failures/*` wholesale** — wasteful when the bug only needs one flow's artefacts.
- **Skip Phase A; do Phase B (route inference) directly** — Phase B is harder + the route file alone doesn't tell the agent WHAT failed. Phase A's diagnostic-text-from-the-runner is the load-bearing signal.

## Validation Criteria

- [x] flow-execution-failure bugs now resolve 2 additional envelope entries (failure.html + failure.png) when those files exist (`orchestrator/src/bug-fix-context.ts:resolveFilesForBug` flow-execution-failure branch — bug-083 block)
- [x] `bug-fix-context.test.ts` has 3 new tests covering positive case + 2 negative cases (full suite: 17/17 passing)
- [x] No regression on existing bug-fix-context tests (existing flow-execution-failure test #1 updated to account for the 2 new missingFiles[] entries; 14 prior tests stay green)
- [ ] Empirical: re-run /fix-bugs reading-log-02 after this fix lands; bug-fixer dispatches on flow-failures should now have access to the timeout error + URL + stack via the Read tool (visible in the agent's transcript reading docs/build-to-spec/failures/\*)

## Cross-references

- **investigate-026** Finding 1 surfaced this; this bug is the investigation's primary recommendation.
- **feat-067 Phase C** (`ca8a0fd`) added the analogous pre-load for visual-parity's diff PNG — same pattern as Phase A here.
- **bug-072** (blank failure HTML hardening) ensures the failure.html ALWAYS has at least the envelope-fallback content. Without bug-072 this fix would be lossy when page.content() failed.
- **bug-082** (orchestrator trusts unverified completion) is the higher-priority companion — without bug-082's commit-required guard, this enriched envelope just gives the agent more context to NOT use while still reporting completed. Ship bug-082 first.

## Attempt Log

### Attempt 1 — 2026-05-12 — landed (Phase A only; Phase B route-inference deferred)

- **Phase A — resolver extension**: Extended the flow-execution-failure branch of `orchestrator/src/bug-fix-context.ts:resolveFilesForBug` to append two new envelope entries: `docs/build-to-spec/failures/${bug.flow.id}-failure.html` and `docs/build-to-spec/failures/${bug.flow.id}-failure.png`. Mirrors the feat-067 Phase C visual-parity pattern (`ca8a0fd`). emitFileSection silently logs missing files as `✗ file missing` so the .png-not-captured edge case (common when page.goto times out before screenshot fires) resolves cleanly.

- **Phase C — tests**: Added 3 new tests to the existing `flow-execution-failure` describe block in `orchestrator/tests/bug-fix-context.test.ts`: (1) positive case — both failure.html exists, agent envelope includes the timeout error text inline; (2) negative case — neither artefact exists, both land in missingFiles[]; (3) common edge case — failure.html present (post bug-072 hardening always writes one) but failure.png missing because page.goto timeout precluded the screenshot. Also updated the existing "pre-loads the synthesized spec + manifest" test to account for the 2 new missingFiles[] entries it now reports (test's setup doesn't write failure.html/png). Final: 17/17 pass in bug-fix-context.test.ts; fix-bugs-loop.test.ts still 60/60.

- **Phase B — route inference**: DEFERRED per the plan's own guidance ("Phase B is optional for v1 — Phase A delivers most of the value"). The visual-parity branch's multi-path heuristic (route file + index + component) could be ported here for `page.goto("/books/X")` → `apps/web/app/books/[id]/page.tsx` inference. Defer until empirical re-run shows Phase A doesn't deliver enough lift on its own.

Outcome: Phase A+C landed. Empirical Phase D (re-run /fix-bugs reading-log-02) bundled with bug-082 + future bug-084 to amortize the ~2.5hr wall-clock + $5-10 spend cost.
