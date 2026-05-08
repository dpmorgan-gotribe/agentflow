---
id: feat-063-pre-loaded-bug-fix-context
type: feature
status: completed
author-agent: human
created: 2026-05-08
updated: 2026-05-08
parent-plan: investigate-024-bug-fix-dispatch-efficiency
supersedes: null
superseded-by: null
branch: feat/pre-loaded-bug-fix-context
affected-files:
  - orchestrator/src/fix-bugs-loop.ts
  - orchestrator/src/invoke-agent.ts
  - orchestrator/tests/fix-bugs-loop.test.ts
feature-area: orchestrator/fix-bugs-loop
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-063: Pre-loaded bug-fix dispatch context

## Problem

Per investigate-024 §F1 + §F3, the per-bug dispatch envelope sends
~2-3K tokens of generic context (system prompt + 1-line bug summary +
short retry context) but ZERO bug-specific files. The agent then
spends 5-10 exploratory Read/Grep/Bash turns discovering the
synthesized spec, mockup HTML, fix-site files, and manifest data —
each turn taking 15-25 min wall-clock.

For flow-3 (the cleanest empirical resolution), the agent needed
~10 Reads + 9 Edits + ~2 Bashes ≈ 20 tool calls in 25 min. Pre-loading
the right files would collapse ~5-7 of those Reads up-front, the
agent reaches the fix decision in ~2-3 turns instead of ~7-10.

## Goals

1. New helper `buildBugContextEnvelope(bug, projectRoot, factoryRoot)`
   that reads the right files based on `bug.source` + injects them
   into the dispatch prompt before task lines.
2. Per-class file resolution — flow-failure pre-loads spec; parity-
   divergence pre-loads mockup; orphan pre-loads suggested-importer
   files; etc.
3. Dispatch envelope grows from ~2-3K tokens → ~10-15K tokens (well
   within Sonnet's 200K context).
4. Empirical target: 50-70% reduction in median wall-clock per
   dispatch (per investigate-024's projection).

## Non-goals

- Replace `buildAgentPrompt` (the dispatch wrapper stays; this just
  adds a pre-context block).
- Heuristic fix-site detection for runtime-error / dev-server-compile
  bugs — those use the verifier's stderrTail directly + can defer
  smart fix-site inference to a follow-up.
- Modify the bug-fix-loop's iteration cadence — pre-loading reduces
  per-attempt work, doesn't change retry/iteration semantics.

## Approach

### Phase A — `buildBugContextEnvelope` helper (1.5 hr)

New module `orchestrator/src/bug-fix-context.ts`:

```ts
export interface BugContextEnvelope {
  /** Multi-line markdown ready to inject into the agent prompt. */
  text: string;
  /** Diagnostic — which files were resolved + why. */
  resolvedFiles: { path: string; reason: string; loc: number }[];
  /** Diagnostic — which expected files were missing. */
  missingFiles: { path: string; reason: string }[];
}

export function buildBugContextEnvelope(args: {
  bug: BugEntry;
  projectRoot: string;
  factoryRoot: string;
}): BugContextEnvelope;
```

Per-class resolution:

| `bug.source`                                  | Pre-load                                                                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `flow-execution-failure` (kind: flow-failure) | spec at `apps/web/e2e/synthesized/<flow-id>.spec.ts` + `flow.requiredState` block from manifest                                    |
| `visual-parity` (kind: parity-divergence)     | mockup at `docs/screens/{platform}/{screen}.html` + the page-render JSX (heuristic: `apps/web/app/{screen}/page.tsx` if it exists) |
| `reachability-orphan`                         | the orphan file content + 2-3 suggestedImporters file content                                                                      |
| `runtime-error`                               | the verifier's stderrTail (already in errorLog) + suspected page.tsx                                                               |
| `dev-server-compile`                          | the stderrTail + the failing config file (heuristic from stderr — e.g. tsconfig.json, vitest.config.ts)                            |
| `build-gap`                                   | the failing test file + the production code under test                                                                             |
| Anything else / unknown                       | empty envelope (back-compat: no pre-loaded context)                                                                                |

Each file read is bounded — emit at most ~200 lines per file (truncate
with a `[... N lines truncated]` marker if larger). Total envelope
budget: ~15K tokens (roughly 5-8 files × 200 lines × ~10 tokens/line).

Output format (markdown, injected before existing task lines):

````
## Pre-loaded bug context

The orchestrator pre-loaded the following files so you don't need to
discover them via Read/Grep. Read additional files only if these
don't have the answer.

### Failing artefact: apps/web/e2e/synthesized/flow-3.spec.ts
```typescript
{file content, up to 200 lines}
````

### Required DB state (from docs/user-flows-manifest.json)

```json
{
  "kind": "custom",
  "fixtures": { "Book": [...] }
}
```

### Likely fix-site #1: apps/web/app/books/[id]/page.tsx

```typescript
{file content, up to 200 lines}
```

### Likely fix-site #2: packages/types/src/index.ts

```typescript
{file content, up to 200 lines}
```

### Diagnostic — files we pre-loaded vs missing

- ✓ apps/web/e2e/synthesized/flow-3.spec.ts (96 lines) — failing spec
- ✓ apps/web/app/books/[id]/page.tsx (87 lines) — bug class flow-failure suggests
- ✗ apps/web/app/page.tsx — exists but skipped (not on critical path per heuristic)

---

```

### Phase B — Wire into invoke-agent dispatch (1 hr)

`orchestrator/src/invoke-agent.ts::buildAgentPrompt` receives an
optional `preLoadedContext: string` field via the InvokeAgentFn args
interface. When present, it gets injected immediately after the
"You are the X agent" header + before the task lines.

`orchestrator/src/fix-bugs-loop.ts::dispatchAgentsForBug` calls
`buildBugContextEnvelope(...)` once per bug + threads the resulting
text through `ctx.invokeAgent({...preLoadedContext})`.

Same wiring in `dispatchAgentsForPatternGroup` (class-batched path)
when that's enabled — but bug-075 just disabled it by default, so
this path is a low-priority back-compat.

### Phase C — Tests (45 min)

`orchestrator/tests/bug-fix-context.test.ts` — new file:

1. `buildBugContextEnvelope` returns spec content for flow-failure bug
2. Returns mockup content for parity-divergence bug
3. Returns orphan + importer content for reachability-orphan bug
4. Truncates files larger than 200 lines with marker
5. Reports missing files in `missingFiles` (e.g. spec doesn't exist)
6. Returns empty envelope for unknown bug source (back-compat)
7. Total envelope size capped at ~15K tokens (no runaway pre-loads)

`orchestrator/tests/fix-bugs-loop.test.ts` — extend:

1. Verify `dispatchAgentsForBug` passes pre-loaded context through to
   invokeAgent when `bug.source === "flow-execution-failure"`
2. Verify NO pre-loaded context passes when bug source is unknown
   (back-compat)

### Phase D — Empirical validation (deferred to manual)

Re-run reading-log-02 /fix-bugs (post-Phase 1+2+3) and measure:

- Median wall-clock per bug
- API calls per dispatch
- Att 1 success rate

Compare against investigate-024's recorded baseline.

## Rejected Alternatives

- **Pre-load EVERY file recently touched on the branch** — Rejected:
  blows the token budget; pollutes context with irrelevant files.
- **Have the bug-plan body include the spec content verbatim** —
  Rejected: bug-plans are operator-readable artefacts; copying 200-line
  specs into them makes manual review expensive.
- **Use a separate "context discovery" agent that runs first + builds
  the envelope** — Rejected: doubles the per-bug dispatch overhead
  for marginal extra accuracy. The orchestrator already has the bug
  source + class; deterministic file resolution beats LLM-driven
  resolution at this layer.

## Expected Outcomes

- [ ] `buildBugContextEnvelope` exists + is unit-tested for all 6 bug
      sources
- [ ] Dispatch envelopes for flow-failure bugs include the spec content
- [ ] Dispatch envelopes for parity-divergence bugs include the mockup
- [ ] Token budget stays under 15K added per dispatch
- [ ] Existing fix-bugs-loop tests still pass (back-compat preserved)

## Validation Criteria

- All Phase C tests pass
- Manual reading-log-02 retry shows ≥50% wall-clock reduction per
  bug (investigate-024 §Recommendation projection)
- No regression on the 4 already-resolved bugs (compile, flow-3,
  flow-1, flow-2)

## Cross-references

- Parent: `investigate-024-bug-fix-dispatch-efficiency` §F1 + §F3
  (load-bearing findings)
- Sister: `bug-074` (orthogonal — bug body fix complements pre-loaded
  context, doesn't replace it)
- Sister: `feat-064-bug-fixer-agent` (Phase 4 of investigate-024 ship
  plan; depends on this feature landing)

## Attempt Log

### Attempt 1 — 2026-05-08 ✅ SHIPPED (Phases A + B + C)

**Phase A — `bug-fix-context.ts` module**: 232-line implementation with
`buildBugContextEnvelope({ bug, projectRoot })` + helpers. Per-class
file resolution:

- `flow-execution-failure` → spec at `apps/web/e2e/synthesized/<flow>.spec.ts`
  + `docs/user-flows-manifest.json`
- `visual-parity` → mockup at `docs/screens/webapp/<screen>.html` +
  `apps/web/app/<screen>/page.tsx`
- `reachability-orphan` → orphan file + up to 3 suggested importers
- Others (runtime-error, dev-server-compile, build-gap) → empty envelope
  for now (back-compat; stderr-aware resolution deferred to follow-up)

Per-file truncation at 200 lines (with `[... N lines truncated]` marker);
soft envelope cap at 1200 lines for runaway pre-loads. Output is markdown
with fenced code blocks per ext (typescript / json / yaml / html / etc.)
plus a diagnostic block (`✓ resolved` + `✗ missing`).

**Phase B — Dispatch wiring**:

- `feature-graph.ts::InvokeAgentFn` interface gains optional
  `preLoadedContext?: string` field
- `invoke-agent.ts::buildAgentPrompt` reads + injects it into the user
  prompt immediately after the agent header + before retry context
- `fix-bugs-loop.ts::dispatchAgentsForBug` calls
  `buildBugContextEnvelope(...)` once per bug + threads through every
  agent in the sequence (back-compat — empty text = no pre-load)

**Phase C — Tests**:

- New `orchestrator/tests/bug-fix-context.test.ts` with 8 cases covering
  flow-failure / visual-parity / reachability-orphan resolution +
  truncation + missing-file diagnostics + back-compat empty envelope
  for runtime-error / dev-server-compile
- All 8 new tests pass
- 56/56 fix-bugs-loop regression tests still pass

**Effort**: ~1.5 hr total (under the 3-4 hr Phase 3 estimate).

**Validation pending**: empirical measurement on next reading-log-02
/fix-bugs retry. investigate-024 §Recommendation projects 50-70%
reduction in median wall-clock per bug.
```
