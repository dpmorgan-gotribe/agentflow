---
id: bug-074-nonsensical-flow-failure-body-on-null-screen-ids
type: bug
status: completed
author-agent: human
created: 2026-05-08
updated: 2026-05-08
parent-plan: feat-022-build-to-spec-verification
supersedes: null
superseded-by: null
branch: fix/nonsensical-flow-failure-body-on-null-screen-ids
affected-files:
  - scripts/file-bug-plan.mjs
  - orchestrator/tests/file-bug-plan-parity.test.ts
feature-area: orchestrator/file-bug-plan
priority: P1
attempt-count: 0
max-attempts: 5
error-message: |
  Bug body produced by file-bug-plan.mjs::flowFailureBody when violation has null screen-ids:

  > Synthesized flow `walks 4 interaction(s) deterministically` (flow-4)
  > failed at step 0: clicked `(no selector matched)` on
  > `[data-screen-id="null"]`, expected to land on `[data-screen-id="null"]`
  > within 2000ms; landed on `(no screen-id present)`.
  >
  > Likely cause: The trigger element on `null` either does not exist OR
  > navigates to a different screen than `null`.
  >
  > Fix approach: Add the missing nav element on `null` so it routes to
  > `null` when clicked. Reference the mockup at `docs/screens/webapp/null.html`.
reproduction-steps: |
  1. Project's docs/user-flows-manifest.json has any flow whose `steps[*]` lacks `fromScreenId` / `expectedScreenId` (every shipped project today; pre-feat-050-Phase-D the user-flows-generator skipped these fields)
  2. Run /build-to-spec-verify — synthesizer's flow-runner emits FlowFailure with `fromScreenId: null` + `expectedScreenId: null`
  3. file-bug-plan.mjs::flowFailureBody interpolates "null" verbatim into Description / Likely cause / Fix approach
  4. Resulting bug-NNN-flow-X-null.md says "Add a nav element on null reference docs/screens/webapp/null.html"
stack-trace: null
---

# bug-074: file-bug-plan body interpolates "null" verbatim when screen-ids missing

## Bug Description

`scripts/file-bug-plan.mjs::flowFailureBody` (line ~141) interpolates
`fromScreenId` / `expectedScreenId` into the bug-plan markdown body
without defending against null. When the upstream FlowFailure
violation lacks those fields (e.g. the manifest's `steps[*]` were
authored without screen-id chaining), the body emits literal "null"
in 6+ places + a `docs/screens/webapp/null.html` reference that
doesn't exist.

**Practical impact**: builders dispatched against the bug read a body
that says "Add a nav element on null". They ignore it + work from
the synthesized spec instead (which has clear `role=link[name=...]`
selectors + the full interaction script). The bug ID `-null` suffix
is also a tell — every flow-failure bug ID in reading-log-02 is
`bug-NNN-flow-X-null` because `bugIdFor` calls `slugify(expectedScreenId)`
on the null value.

flow-3 succeeded in /fix-bugs run b0e1281c.iter2 _despite_ the
nonsensical plan — the builder shipped commit
`f0c0b0b fix(web): use string IDs throughout` by reading the spec
directly. flow-1 + flow-2 failed iteration 1 (empty-merge / parse
error) likely partially because the misleading plan body confused
the builder's planning step.

## Reproduction Steps

See `reproduction-steps` field in frontmatter. Empirical instances:
all 6 reading-log-02 flow-failure bug plans (003-008) carry this
shape, plus the corresponding bugs.yaml entries with id suffix
`-null`.

## Error Output

```text
# bug-006-flow-flow-4-null — auto-filed by /build-to-spec-verify
## Description

Synthesized flow `walks 4 interaction(s) deterministically` (flow-4)
failed at step 0: clicked `(no selector matched)` on
`[data-screen-id="null"]`, expected to land on `[data-screen-id="null"]`
within 2000ms; landed on `(no screen-id present)`.

## Likely cause

- The trigger element on `null` either does not exist OR navigates to
  a different screen than `null`.

## Fix approach

Add the missing nav element on `null` so it routes to `null` when
clicked. Reference the mockup at `docs/screens/webapp/null.html`.
```

## Root Cause Analysis

`scripts/file-bug-plan.mjs:153` (Description), :189 (Likely cause),
:216 (Fix approach) interpolate `v.fromScreenId` / `v.expectedScreenId`
without null-defence. The FlowFailure schema (`packages/orchestrator-
contracts/src/orchestrator-types.ts`) declares both as nullable:
`fromScreenId: string | null`. When the upstream user-flows-generator
manifests don't populate `steps[*].screenId` chains, runner-emitted
violations carry null verbatim.

The companion symptom is `bugIdFor` at line 89 calling
`slugify(violation.expectedScreenId)` on null → "null" → bug IDs
end with literal "-null".

Root cause: **the body template was written assuming the runner
ALWAYS resolves screen-ids**. With newer flow shapes (synthesizer
v2.0 — feat-038 Phase 2) the runner increasingly emits FlowFailures
where the failure happens at navigation step 0 (page-goto) before
any screen-id ever resolves, so null is the legitimate value.

## Fix Approach

### Phase A — null-safe body template (~30min)

Replace each null-vulnerable interpolation with a fallback:

```js
const fromLabel = v.fromScreenId ?? "(start)";
const toLabel = v.expectedScreenId ?? "(unresolved — see spec)";

// Description (line 153)
`Synthesized flow \`${v.flowName}\` (${v.flowId}) failed at step ${v.step}: clicked \`${v.selector ?? "(no selector matched)"}\` on \`[data-screen-id="${fromLabel}"]\`, expected to land on \`[data-screen-id="${toLabel}"]\` within ${TRANSITION_TIMEOUT_MS}ms; landed on \`${v.actualScreenId ?? "(no screen-id present)"}\`.`;

// Likely cause (line 189) — when both null, replace with a "see spec" pointer
if (v.fromScreenId === null && v.expectedScreenId === null) {
  lines.push(
    `- The synthesizer detected a flow-execution failure but couldn't resolve start/expected screen-ids from the manifest. The synthesized spec at \`apps/web/e2e/synthesized/${v.flowId}.spec.ts\` has the canonical selector + interaction sequence — read it for the failing-element detail.`,
  );
} else {
  // ... legacy template
}

// Fix approach (line 216) — same fallback
if (v.fromScreenId === null && v.expectedScreenId === null) {
  lines.push(
    `Read the synthesized spec at \`apps/web/e2e/synthesized/${v.flowId}.spec.ts\`. The failing locator + flow narrative there describe what the build needs to expose. Likely fixes: (a) add the data-testid / role attribute the spec selects on, (b) wire the navigation route the spec expects, (c) seed the data the spec assumes (see flow.requiredState in the manifest).`,
  );
} else {
  // ... legacy template
}
```

### Phase B — bug-id slug fallback (~10min)

`bugIdFor` line 89: when `expectedScreenId` is null, fall back to
`flowId` so the bug ID becomes `bug-NNN-flow-3-edit-notes` (using
the slugified flow.name) rather than `bug-NNN-flow-3-null`.

```js
function stableSlugFor(violation) {
  // ...
  if (violation.kind === "flow-failure") {
    const target =
      violation.expectedScreenId ??
      violation.fromScreenId ??
      slugify(violation.flowName); // fallback to flow name
    return `flow-${slugify(violation.flowId)}-${slugify(target)}`;
  }
  // ...
}
```

This change is **NOT back-compat** — existing bug IDs (e.g.
`bug-006-flow-flow-4-null`) won't match the new slug shape, so
existing bugs.yaml entries will be considered "new" on next verify
re-run + a duplicate appended. Mitigation: ship Phase B with a
one-time migration that walks bugs.yaml + plans/active/ and
renames `bug-NNN-flow-X-null` → `bug-NNN-flow-X-<flowSlug>`. OR
keep the legacy slug for back-compat (acceptable — the body fix
is the load-bearing improvement).

### Phase C — orchestrator regression test (~20min)

Add a test in `orchestrator/tests/file-bug-plan-parity.test.ts`
asserting the body for a FlowFailure with null screen-ids contains:

- the spec path
- the flow id + name
- NO literal `null` interpolations
- the "see spec" fallback pointer

### Phase D — backfill rewrite for currently-stale plans (out of scope)

Rewriting reading-log-02's plans 003-008 in-place is operator
recovery; this plan ships the factory fix only. Operators can
delete + re-run /build-to-spec-verify to regenerate plans against
the new body template.

## Rejected Fixes

- **Reject the FlowFailure when screen-ids are null** — Rejected: the
  failure IS real (the synthesized spec failed); just because the
  manifest didn't populate screen-ids doesn't mean we should
  silently swallow the bug. The build IS broken; we just need a
  better description of how.

- **Make the verifier resolve null screen-ids before emitting
  FlowFailure** — Rejected: the verifier doesn't know what the
  manifest author INTENDED. Some flows legitimately fail at the
  navigate-step (no screen ever rendered) so there's no "from" or
  "to" to infer. The runtime is the source of truth — the body
  template should adapt.

- **Switch to a Zod-validated FlowFailure that requires non-null
  screen-ids** — Rejected: same as above. The schema correctly
  declares them nullable; the body template is what's wrong.

## Validation Criteria

- [ ] Phase A: `flowFailureBody` returns non-"null"-containing body for
      a FlowFailure with `fromScreenId: null && expectedScreenId: null`
- [ ] Phase A: body's "Fix approach" section points to the synthesized
      spec path with explicit "read the spec for selector detail"
      language when screen-ids unresolved
- [ ] Phase C: regression test in `file-bug-plan-parity.test.ts`
      passes + asserts no literal "null" in body output
- [ ] Empirical: re-run /build-to-spec-verify on reading-log-02 with
      the bugs.yaml cleared. Resulting plans for flow-2..6 must read
      coherently (the build SHOULD pass per feat-050; if any
      flow-failure persists, its plan body should be useful)

## Cross-references

- Sister: feat-050-per-flow-seed-orchestration (the structural fix
  for the underlying defect class — works orthogonally with this
  body fix)
- Sister: docs/ideas.md — companion CRLF autocrlf cleanup idea filed
  the same session
- Empirical: reading-log-02 plans 003-008 (all 6 stale flow-failure
  plans demonstrate the failure mode)
- Empirical: reading-log-02 /fix-bugs run b0e1281c iter 2 — flow-3
  succeeded DESPITE the misleading body, demonstrating the body is
  not load-bearing for fix correctness, just for fix routing speed

## Attempt Log

### Attempt 1 — 2026-05-08 ✅ SHIPPED (all 3 phases)

**Phase A — null-safe body template**: `scripts/file-bug-plan.mjs::flowFailureBody`
now defends against `fromScreenId === null && expectedScreenId === null`:

- Description line interpolates `(unresolved — see spec)` instead of "null"
- Likely-cause section emits a "see synthesized spec at <path>" pointer
- Fix-approach section instructs the builder to read the spec + lists
  the 3 likely fix shapes (a/b/c)
- Mockup-path interpolation guards against null `expectedScreenId`

**Phase B — bug-id slug fallback**: `stableSlugFor(violation)` for
flow-failure now falls through `expectedScreenId → fromScreenId →
flowName → flowId`. Existing slug shape preserved when ANY of the
non-null fields is set; `-null` suffix eliminated for null-screen-id
flow failures.

**Phase C — regression tests**: 4 new tests in
`orchestrator/tests/file-bug-plan-parity.test.ts`:

- body does NOT contain literal 'null' interpolation
- body points at the synthesized spec when screen-ids unresolved
- bug ID slug uses flowName fallback (not 'null')
- back-compat: body + slug still use screen-id labels when present

**Tests**: 40/40 file-bug-plan-parity tests pass (4 new + 36 existing).

**Effort**: ~30 min total (under the 1-hr Phase 2 estimate).

**Phase D (out-of-scope)**: backfilling reading-log-02's existing 6
stale plans is operator recovery — they'd be regenerated cleanly on
the next /build-to-spec-verify re-run.
