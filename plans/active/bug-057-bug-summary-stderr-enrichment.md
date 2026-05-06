---
id: bug-057-bug-summary-stderr-enrichment
type: bug
status: completed
author-agent: human
attempt-count: 1
created: 2026-05-06
updated: 2026-05-06
parent-plan: investigate-018-fix-bugs-dispatch-latency
supersedes: null
superseded-by: null
branch: fix/bug-summary-stderr-enrichment
affected-files:
  - scripts/file-bug-plan.mjs
  - orchestrator/src/build-to-spec-verify.ts
  - orchestrator/src/fix-bugs-loop.ts
  - tests/file-bug-plan.test.mjs
feature-area: verifier/bug-filing + orchestrator/dispatch-context
priority: P1
attempt-count: 0
max-attempts: 5
error-message: |
  bug.summary for dev-server-compile + runtime-error bugs is empty
  after the colon (e.g. 'Dev-server compile error during
  tooling-pre-flight: '). The actual stderr / failure detail is
  captured in verify.warnings[] and verify.flows.failed[].stderr
  but never propagated into the bug entry the agent dispatcher
  reads. Result: the dispatched agent has zero context about WHY
  the dev-server failed, has to guess from scratch, burns 5-10min
  of reasoning to reproduce information the verifier already had.
reproduction-steps: |
  1. Run /build-to-spec-verify on a project with a backend that
     fails to boot (e.g. reading-log-01 with Prisma DB missing).
  2. Inspect docs/bugs.yaml — observe `summary: 'Dev-server
     compile error during tooling-pre-flight: '` (truncated, no
     stderr detail).
  3. Inspect orchestrator output — observe verify.warnings array
     contains the actual failure: `"Resolved spawn:
     pnpm.cmd --filter @repo/api dev ... last error: ..."`
  4. The agent dispatched against this bug receives only the
     empty summary; the rich warning data is dropped.
stack-trace: null
---

# bug-057: Propagate verifier stderr + warnings into bug.summary + retryContext

## Bug Description

The verifier captures rich failure detail (stderr from failed
dev-server boot attempts, full warnings array with cause hints,
spawn commands, port resolution chains) but truncates this when
filing the bug entry. By the time the fix-bugs loop dispatches an
agent, the only context it has is `bug.summary: 'Dev-server
compile error during tooling-pre-flight: '` — the colon followed
by NOTHING.

The agent then spends 5-10min independently:

- Reading verifier source to understand what tooling-pre-flight is
- Trying to start the dev-server itself to see what fails
- Reading apps/api/src/plugins/\*.ts looking for the broken plugin
- Eventually guessing at fixes

All of which the verifier ALREADY DID and dropped on the floor
when filing the bug.

## Reproduction Steps

See frontmatter `reproduction-steps`. Empirical anchor:
reading-log-01 2026-05-06 b3zwmyp7a run — verifier produced 4
detailed warnings about backend port-bind failure but
bug.summary was the empty-after-colon string.

## Error Output

Verifier output:

```
- parity: dev-server: auto-boot failed: backend (node-fastify) did
  not respond on http://localhost:3001/health within 60000ms.
  Resolved spawn: `pnpm.cmd --filter @repo/api dev` from
  `<projectDir>`. Resolved port: 3001 (resolution chain —
  process.env.PORT > BACKEND_PORT > apps/api/.env.local >
  apps/api/.env > architecture.yaml backend_framework
  stack-default > 8000). Verify pnpm is on PATH and
  apps/api/package.json declares a `dev` script (e.g. `tsx watch
  src/server.ts`). Underlying: last error: ; parity-verify will
  skip with screens unchecked
```

Bug entry filed (from bugs.yaml):

```yaml
- id: bug-compile-tooling-pre-flight
  source: dev-server-compile
  severity: P0
  summary: "Dev-server compile error during tooling-pre-flight: "
  flow:
    failedStep: 0
    expectedScreenId: null
    selector: null
    htmlDump: null # ← captured stderr would go here, but null
  errorLog: [] # ← would also be a logical home, but empty
```

The information loss is at file-time, not runtime. The agent never
sees the rich detail.

## Root Cause Analysis

Two layers of information drop:

### Layer 1 — Verifier doesn't pipe stderr into the FlowFailure

`orchestrator/src/build-to-spec-verify.ts` synthesizes
`FlowFailure` records when tooling fails. The `flow.htmlDump`
field is the natural place for stderr but it's null'd out for
non-screen-failure cases. Instead, the rich detail goes only to
`warnings[]` at the verify-output level, which file-bug-plan
doesn't consume per-bug.

### Layer 2 — file-bug-plan.mjs builds bug.summary by template

`scripts/file-bug-plan.mjs:769+` `buildBugEntry` constructs the
summary from `violation.kind` + `violation.flow.id` + (optional)
short message. There's no path that consumes warnings + stderr
into the summary or errorLog field.

## Fix Approach

### Phase A — Verifier wires stderr into FlowFailure (1h)

Modify `synthesizeToolFailure` in
`orchestrator/src/build-to-spec-verify.ts` to capture:

- The runner's stderr (last 500 chars)
- The dev-server-spawn-failure hint from `spawnBackendDevServer`
- Resolved-port-chain detail
- Suggested fix surface (e.g. "Check apps/api/src/plugins/\*.ts
  for module import errors")

Add these to the FlowFailure as a new optional field
`stderrTail: string | null` OR repurpose `htmlDump` (since
htmlDump is screen-failure-specific, dev-server-compile flows
don't use it). PICK: add `stderrTail` separately for clarity;
htmlDump stays per its existing semantics.

Schema change: `FlowFailureSchema` in
`packages/orchestrator-contracts/src/build-to-spec-verify.ts`
gains `.optional() .nullable()` `stderrTail` field.

### Phase B — file-bug-plan.mjs enriches summary + errorLog (1h)

`buildBugEntry`:

- If `violation.flow.stderrTail` is non-empty, include the first
  300 chars in `summary` (after the existing prefix).
- Push the full stderrTail (up to 1500 chars) into the bug's
  `errorLog: [stderrTail]` so the agent has it as a structured
  field too.

Schema: BugEntry already has `errorLog: string[]` — no schema
change.

### Phase C — Loop forwards bug.errorLog into retryContext (30min)

`orchestrator/src/fix-bugs-loop.ts:823+` (in
`dispatchAgentsForBug`) builds a `retryContext.errorMessage`. Today
it calls `buildRetryContextMessage(bug)`. Extend that helper to
include the most recent `bug.errorLog` entry (the stderrTail) so
the agent's prompt-context surfaces the failure detail at dispatch
time.

This is the load-bearing connection: even if Phase A+B land the
detail in bugs.yaml, the agent still needs it injected into its
prompt context. The retryContext is the channel.

### Phase D — Tests + empirical re-validation (1h)

- Unit tests for the FlowFailure schema with stderrTail
- Unit tests for buildBugEntry summary truncation + errorLog
  population
- Unit tests for buildRetryContextMessage including stderrTail
- Empirical: re-run /build-to-spec-verify on reading-log-01,
  inspect bugs.yaml summary+errorLog. Should contain the
  `node-fastify did not respond on :3001` detail.

## Rejected Fixes

- **Stuff stderr into bug.summary directly (no separate field)** —
  Rejected: summary should stay short for human readability in
  `/fix-bugs --dry-run` previews; the long form belongs in
  errorLog.

- **Add a 'verifierContext' field to BugEntry** — Rejected:
  errorLog already exists for this purpose (it's an array of
  string log entries about the bug's history); piggybacking on
  it preserves the existing schema.

- **Hold context in a sidecar file (docs/bug-context/<id>.md)** —
  Rejected: in-yaml is the source of truth; sidecars create
  ordering / dedup hazards.

## Validation Criteria

1. After ship: re-running /fix-bugs reading-log-01 (post-bugs.yaml
   reset) produces a bug entry whose `errorLog[0]` contains
   `node-fastify` AND `localhost:3001`.
2. Dispatched agent's retryContext.errorMessage contains the
   stderrTail.
3. Empirical: agent reasoning time drops on dev-server-compile
   class (target: 30-60% reduction). Measured against
   investigate-018 Step 1 instrumentation.

## Dependencies / sequencing

- **Independent of feat-058** (sequence trim) — bug-057 enriches
  context regardless of how many agents dispatch.
- **Independent of bug-056** (tier routing) — bug-057 enriches
  context regardless of which tier the bug routes to.
- **Compatible with feat-059** (bugFixMode prompt prefix, if it
  ships): feat-059 would consume the enriched stderrTail as
  part of the prompt prefix.

Recommended ship: parallel with feat-058, bug-056. Lowest
coupling.

## Attempt Log

(empty — plan filed by human 2026-05-06)
