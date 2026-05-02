---
id: bug-039-verifier-schema-rejects-empty-flow-failure-screen-ids
type: bug
status: approved
author-agent: human
created: 2026-05-02
updated: 2026-05-02
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/flow-failure-screen-ids-nullable
affected-files:
  - packages/orchestrator-contracts/src/build-to-spec-verify.ts
  - packages/orchestrator-contracts/src/bugs-yaml.ts
  - scripts/run-synthesized-flows.mjs
feature-area: orchestrator/verifier-contract
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "runBuildToSpecVerify threw: [{ path: ['flows','failed',0,'fromScreenId'], message: 'Too small: expected string to have >=1 characters' }, ... × 9 ]"
reproduction-steps: "Run /start-build, get to verify stage on a v2.0 manifest project (interactions[]-driven specs), have ≥1 flow fail. Verifier crashes because runner emits fromScreenId: '' (the v2.0 spec failure messages don't embed screen-id metadata; runner falls back to ''; schema requires min(1))."
stack-trace: null
---

# bug-039: Verifier Zod schema rejects flow failures with empty `fromScreenId`/`expectedScreenId`; ALL 9 of finance-track-01's real flow failures got swallowed

## Bug Description

The `FlowFailure` schema in `packages/orchestrator-contracts/src/build-to-spec-verify.ts:162-167` requires:

```ts
fromScreenId: z.string().min(1),
expectedScreenId: z.string().min(1),
```

The runner (`scripts/run-synthesized-flows.mjs:527-528`) extracts these from the playwright failure error message via regex and falls back to empty string when not found:

```js
fromScreenId: meta.fromScreenId ?? "",
expectedScreenId: meta.expectedScreenId ?? "",
```

For v2.0 manifest projects (synthesizer's interactions[]-driven emit path, post feat-038 Phase 2A), the spec's failure messages have shape:

```
Error: flow-X (Name) failed at interaction ${__stepIndex}: ${message}
```

— NO embedded `from-screen-id:` / `toward-screen-id:` markers (those existed in v1.0 spec emissions only). So `meta.fromScreenId` and `meta.expectedScreenId` are always undefined → fall back to `""` → schema rejects → ENTIRE verifier output gets thrown as `runBuildToSpecVerify threw: [...zod-issues...]` → no bugs filed → fix-bugs loop reports `iteration 0/0; remaining: 0; status: no-bugs` → run completes with `completed-with-integration-failures` and the 9 ACTUAL product bugs go silently into `apps/web/test-results/` directories where no operator looks.

Empirical case (2026-05-02 finance-track-01 verifier rerun, post bug-037 + bug-038):

```
Build-to-spec verify:
  reachability:    0 orphan component(s), 0 orphan route(s)
  flows:           0 passed, 0 failed
  warnings:
    - runBuildToSpecVerify threw: [
  { "path": ["flows","failed",0,"fromScreenId"], "message": "Too small..." },
  { "path": ["flows","failed",0,"expectedScreenId"], "message": "Too small..." },
  ... 18 entries total (9 flows × 2 fields each)
]

Bug-fix loop:
  iteration 0/0; resolved: 0; failed: 0; remaining: 0; status: no-bugs

Run status: completed-with-integration-failures
```

But the actual playwright test-results directory has 18 sub-directories (9 flows × initial + retry), each with `error-context.md` documenting REAL failures like:

```
Error: flow-1 (First-time setup) failed at interaction 2:
expect(locator).toBeVisible() failed
Locator: locator('[data-kit-component="EmptyState"]:has-text("No accounts yet")')
```

— legitimate bugs the user predicted would surface. The verifier saw them but couldn't deliver them.

## Reproduction Steps

1. Run `/start-build <project>` to completion on a project with `web_framework` set + a v2.0 user-flows-manifest (interactions[]-driven).
2. Have ≥1 flow fail at runtime (any selector mismatch, timeout, network failure).
3. Observe: verifier output shows `runBuildToSpecVerify threw: [zod issues]` warning AND `flows: 0 passed, 0 failed` AND the bug-fix loop reports `no-bugs`.
4. Inspect `apps/web/test-results/` — many failure directories with real diagnostic data.

Empirical case: 2026-05-02 finance-track-01 — 9/9 flows failed at runtime; 0 reached bugs.yaml; 0 got auto-fixed.

## Error Output

From `tasks/b6zuh43xr.output:23-N`:

```
Build-to-spec verify:
  reachability:    0 orphan component(s), 0 orphan route(s)
  flows:           0 passed, 0 failed
  warnings:
    - runBuildToSpecVerify threw: [
  { "origin": "string", "code": "too_small", "minimum": 1,
    "path": ["flows","failed",0,"fromScreenId"],
    "message": "Too small: expected string to have >=1 characters" },
  ... [18 entries — 9 fromScreenId + 9 expectedScreenId errors]
]
Bug-fix loop:
  iteration 0/0; resolved: 0; failed: 0; remaining: 0; status: no-bugs
```

## Root Cause Analysis

### Two-sided producer/consumer mismatch

**Producer side** (`scripts/run-synthesized-flows.mjs:670-680`):

```js
function parseFailureMeta(message) {
  const out = {};
  const towardM = message.match(/toward-screen-id: ([\w-]+)/);
  if (towardM) out.expectedScreenId = towardM[1];
  const fromM = message.match(/from-screen-id: ([\w-]+)/);
  if (fromM) out.fromScreenId = fromM[1];
  // ... step, selector, etc
  return out;
}
```

The regex looks for `from-screen-id:` and `toward-screen-id:` markers. v1.0 synthesizer's spec emissions included these in failure messages; v2.0 (post feat-038 Phase 2A) doesn't — the v2.0 emit wraps step actions in a try/catch that only includes `__stepIndex` + the underlying error message, not screen-id breadcrumbs.

**Consumer side** (the schema) `packages/orchestrator-contracts/src/build-to-spec-verify.ts:162-167`:

```ts
export const FlowFailure = z.object({
  flowId: z.string().min(1),
  flowName: z.string().min(1),
  step: z.number().int().nonnegative(),
  fromScreenId: z.string().min(1),       // ← producer can't satisfy
  expectedScreenId: z.string().min(1),   // ← producer can't satisfy
  actualScreenId: z.string().nullable(),
  ...
});
```

Schema requires the fields the v2.0 producer can't populate. When schema rejects, `runBuildToSpecVerify` throws (the verifier's safe-parse) → the wrapping try/catch in `cli-runner.ts` surfaces it as a warning + skips the entire `flows.failed[]` array → bugs.yaml gets no flow-failure entries.

`bugs-yaml.ts:62` has the same `min(1)` constraint on `expectedScreenId` for the `BugFlowDetail` type — same fix needed there.

## Fix Approach

### Phase A — schema relaxation (P0, immediate)

1. **`packages/orchestrator-contracts/src/build-to-spec-verify.ts:162-167`** — change `fromScreenId` + `expectedScreenId` from `z.string().min(1)` to `z.string().nullable()`. (The fields remain useful when the producer CAN populate them; nullable acknowledges the v2.0 emit reality.)
2. **`packages/orchestrator-contracts/src/bugs-yaml.ts:62`** — same change for `expectedScreenId` in `BugFlowDetail`.
3. **`scripts/run-synthesized-flows.mjs:527-528`** — change fallback from `""` to `null` so the field accurately reports "we don't have this datum" rather than misleadingly emitting empty-string.
4. **Add regression tests** in `orchestrator-contracts/tests/build-to-spec-verify.test.ts`:
   - Positive: `FlowFailure.parse({ fromScreenId: null, expectedScreenId: null, ... })` accepts.
   - Positive: `FlowFailure.parse({ fromScreenId: "home", expectedScreenId: "settings", ... })` still works (back-compat).
   - Negative: `FlowFailure.parse({ fromScreenId: "" })` rejects (empty-string is intentional bad data — would mask null vs unknown).

### Phase B — synthesizer v2.0 metadata embedding (P1, structural)

5. **Update `scripts/synthesize-flow-e2e.mjs` v2.0 emit path** — embed `from-screen-id:` + `toward-screen-id:` comments in the catch block's error message so the runner's regex can extract them. Restores v1.0's diagnostic richness for v2.0 specs.
   - This requires the synthesizer to know each interaction's "before" and "after" screen-ids (from the manifest's `flow.steps[]` breadcrumbs).
   - Per-interaction mapping: `interaction[i]` corresponds to the transition from `steps[i]` to `steps[i+1]`. Synthesizer can compute + embed at emit time.

### Phase C — flow-failure → bug-yaml entry path retest (P2)

6. **End-to-end test** that a flow failure flows through verifier → bugs.yaml → fix-bugs loop dispatch correctly with nullable screen-ids. Confirms the schema relaxation doesn't break downstream consumers (bug template rendering, fix-loop bug.flow.expectedScreenId access, etc).

## Rejected Fixes

- **Drop the `fromScreenId`/`expectedScreenId` fields entirely** — Rejected: useful diagnostic when present; Phase B will restore production by the v2.0 synthesizer.
- **Add a default value `"unknown"` in the runner** — Rejected: lies about the data. Null is honest; the consumer can render "(unknown)" if needed.
- **Lower runner's regex to be more permissive** — Rejected: the regex is correct; the v2.0 spec emission just doesn't HAVE the markers. Phase B fixes the producer side.
- **Catch the schema error + emit the malformed data anyway** — Rejected: silent data corruption. Better to fail loudly OR relax the constraint deliberately (this fix).

## Validation Criteria

### Phase A

- [ ] `FlowFailure.fromScreenId` + `expectedScreenId` are `z.string().nullable()`.
- [ ] `BugFlowDetail.expectedScreenId` likewise nullable.
- [ ] Runner emits `null` (not `""`) when meta missing.
- [ ] Regression tests cover null + populated + empty-rejection paths.
- [ ] Re-run finance-track-01's verifier — expect `flows: 0 passed, 9 failed` + 9 entries in fresh `bugs.yaml`.

### Phase B

- [ ] Synthesizer v2.0 emit embeds `from-screen-id:` + `toward-screen-id:` in the catch's error message.
- [ ] Runner's regex extracts the metadata; failures populated with screen-ids.

### Phase C

- [ ] End-to-end test: synthesized flow failure → verifier flow failure entry → fix-bugs dispatch reads the failure correctly.

## Cross-references

- **Empirical case**: 2026-05-02 finance-track-01 — 9/9 v2.0 flows failed at runtime, ALL got swallowed by schema rejection.
- **Sister bugs (verifier output-quality class)**: bug-037 (Playwright runtime not auto-installed), bug-038 (backend port resolution stack-aware). All 3 fired on the same finance-track-01 verifier run; bug-037 + bug-038 fixes unblocked the verifier's ability to run flows; bug-039 unblocks its ability to REPORT them.
- **Producer / consumer evolution**: feat-038 Phase 2A introduced the v2.0 synthesizer emit path WITHOUT updating the runner's failure-message regex OR the schema's nullable-ness. This bug is the gap that surfaces.

## Attempt Log

<!-- populated as fix attempts are made -->
