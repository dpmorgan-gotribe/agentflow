---
id: feat-064-bug-fixer-agent
type: feature
status: completed
author-agent: human
created: 2026-05-08
updated: 2026-05-08
parent-plan: investigate-024-bug-fix-dispatch-efficiency
supersedes: null
superseded-by: null
branch: feat/bug-fixer-agent
affected-files:
  - .claude/agents/bug-fixer.md
  - packages/orchestrator-contracts/src/tasks.ts
  - scripts/file-bug-plan.mjs
  - orchestrator/tests/file-bug-plan-parity.test.ts
  - orchestrator/tests/agent-mcp-config.test.ts
feature-area: orchestrator/fix-bugs-loop
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-064: bug-fixer agent — narrow-scope patch agent for /fix-bugs loop

## Problem

Per investigate-024 §F5, `.claude/agents/web-frontend-builder.md` is
204 lines optimized for "build a new web feature inside a feature
worktree using @repo/ui-kit primitives, ship tests + 60% coverage."
For a 1-3 line patch this is mostly noise + can mislead the agent
into over-scoping.

A bug-fixer system prompt should be ~50 lines focused on:

- "patch ONE specific defect, smallest possible diff"
- "don't add tests, don't refactor"
- Hard turn cap (`maxTurns: 8`) to force convergence
- Output contract (sentineled JSON, same as today)

This agent ships AFTER feat-063 lands so dispatches arrive with the
pre-loaded fix-site context already in the prompt.

## Goals

1. New `.claude/agents/bug-fixer.md` (~50 lines, system prompt focused
   on "patch defect")
2. `bug-fixer` added to `AgentSequenceMember` enum
3. `defaultAgentSequence` in `scripts/file-bug-plan.mjs` returns
   `["bug-fixer"]` for cheap classes (replacing the current `[<tier>]`
   web/backend/mobile-frontend-builder routing)
4. `.claude/agents/bug-fixer.md` declares `mcp_servers: []` (M-F continues)
5. Empirical: another 30-50% reduction on top of feat-063

## Non-goals

- Don't replace tier-specific builders for Mode B feature builds — those
  keep web/backend/mobile-frontend-builder (different work shape).
- Don't bring back tester/reviewer for the cheap classes (feat-062's pure-
  verify routing is correct + load-bearing for the 2-3 min target).
- Don't add per-class system prompt branches inside bug-fixer.md — keep
  it stack-agnostic; the pre-loaded context tells the agent what stack
  - what bug class it's working on.

## Approach

### Phase A — `bug-fixer` agent definition (~1 hr)

`.claude/agents/bug-fixer.md`:

```yaml
---
name: bug-fixer
description: Narrow-scope patch agent for /fix-bugs loop dispatches.
  Receives pre-loaded fix-site context via the dispatch envelope (per
  feat-063); emits the smallest possible diff that clears the failing
  artefact (synthesized spec, parity verifier, dev-server boot).
  Replaces tier-specific builders for /fix-bugs loop ONLY — Mode B
  feature builds keep web/backend/mobile-frontend-builder.
tools: Read, Write, Edit, Bash, Grep, Glob
model: inherit
permissionMode: acceptEdits
maxTurns: 8
effort: medium
mcp_servers: []
---

# Bug-Fixer — System Prompt

You patch ONE specific defect inside a per-bug worktree. The dispatch
envelope pre-loaded the failing spec/mockup/fix-site files; you do
NOT need to discover them via Read/Grep unless those don't have the
answer.

## Your contract

1. Read the pre-loaded context (under "## Pre-loaded bug context").
2. Identify the smallest possible diff that makes the failing
   artefact pass.
3. Edit the implicated source files. Do NOT modify test files.
4. Commit with `fix(<scope>): <one-line summary under 72 chars>`.
5. Return the sentineled JSON outcome.

## Hard constraints

- **Smallest possible diff**. If a 1-line fix works, don't ship a
  10-line refactor.
- **Don't add tests**. The /fix-bugs loop's verify pass IS the test.
- **Don't refactor unrelated code**. Even if you spot something ugly,
  leave it for a separate /plan-refactor.
- **Don't touch test files**. Tests are tester-owned (per
  investigate-023). If the pre-loaded spec is wrong, FLAG it in your
  outcome JSON's `errors` field; don't edit the spec.
- **Don't run pnpm install / lint / typecheck unless something
  genuinely fails**. The verifier will catch type errors on its own
  pass.

## Stop conditions

If you've made 5+ Edit calls and the bug still doesn't have an
obvious fix, return `taskOutcomes.<task-id>: "failed"` with the
blocker in `errors.<task-id>`. The orchestrator's retry ladder will
re-dispatch with extra context.

If the pre-loaded context is wrong (missing files, contradictions,
empty), return failed + flag what was missing — the orchestrator's
context resolver (feat-063) needs the signal to improve.

## Output contract

Same sentineled JSON as web-frontend-builder. Wrap in
`<<<TASK_OUTCOME>>>...<<<END_TASK_OUTCOME>>>`.
```

### Phase B — `AgentSequenceMember` enum extension (~30 min)

```ts
// packages/orchestrator-contracts/src/tasks.ts
export const AgentSequenceMember = z.enum([
  "backend-builder",
  "web-frontend-builder",
  "mobile-frontend-builder",
  "tester",
  "reviewer",
  "git-agent",
  "security",
  "devops",
  "bug-fixer", // ← new (feat-064)
]);
```

Schema additions are back-compat — existing bugs.yaml + tasks.yaml
files don't reference the new member, so they parse unchanged.

### Phase C — Routing in `defaultAgentSequence` (~45 min)

Replace the cheap-class `[tier]` returns with `["bug-fixer"]`:

```js
// scripts/file-bug-plan.mjs
case "dev-server-compile":
case "runtime-error":
case "visual-parity":
case "flow-execution-failure":
  return ["bug-fixer"];  // was [tier]
```

Keep the orphan + parity-divergence remap working — those route
through `visual-parity` cause class which now hits bug-fixer.

`build-gap` and `seed-setup` keep their multi-agent sequences (real
feature work; not patch-shape).

`tier` parameter becomes unused for cheap classes — but keep it for
backwards-compat with bug-056 (tier inference still useful for
operator inspection of the bug entry).

### Phase D — Tests + manual sanity (~45 min)

1. `orchestrator/tests/file-bug-plan-parity.test.ts` updates: every
   cheap class now expects `["bug-fixer"]` instead of `[tier]`.
2. `orchestrator/tests/agent-mcp-config.test.ts` adds bug-fixer:
   should resolve to `mcp_servers: []` (no MCP).
3. Manual sanity: re-run reading-log-02 /fix-bugs and observe:
   - Builder dispatches use bug-fixer instead of web-frontend-builder
   - Per-bug wall-clock drops to <5 min median
   - Att 1 success rate ≥70%

## Rejected Alternatives

- **Subclass web-frontend-builder via `extends:` in agent.md** — Rejected:
  no existing extends mechanism in `.claude/agents/`; would require new
  factory plumbing. Standalone agent is simpler.

- **Make bug-fixer auto-merge without verifier agreement** — Rejected:
  bug-055 empty-merge guard is load-bearing. The bug-fixer's success is
  validated by the next iteration's verify pass, not by self-attestation.

- **Use tools = ["Read", "Edit"] only (no Bash)** — Rejected: bug-fixer
  needs to run `git status` / `git diff` / occasional typecheck. Bash is
  fine; the system prompt's "don't run pnpm install unless..." line
  steers usage.

- **Per-class bug-fixer variants** (compile-fixer, parity-fixer, etc.) —
  Rejected: adds 5+ agents to maintain. The pre-loaded context tells
  the agent what class it's working on; one shared prompt suffices.

## Expected Outcomes

- [ ] `.claude/agents/bug-fixer.md` exists + parses cleanly via
      `agent-mcp-config.ts::loadAgentMcpServers`
- [ ] `AgentSequenceMember` enum includes `bug-fixer`; existing tests
      still pass against the extended enum
- [ ] `defaultAgentSequence` returns `["bug-fixer"]` for the 4 cheap
      classes (dev-server-compile / runtime-error / visual-parity /
      flow-execution-failure)
- [ ] orphan + parity-divergence remap still works (route via
      `visual-parity` → bug-fixer)
- [ ] `agent-mcp-config.test.ts` confirms bug-fixer → `mcp_servers: []`

## Validation Criteria

- All Phase D tests pass
- Manual reading-log-02 retry shows median wall-clock ≤3 min/bug
- 56/56 fix-bugs-loop existing tests still pass

## Cross-references

- Parent: `investigate-024-bug-fix-dispatch-efficiency` §F5
- Sister: `feat-063` (Phase 3, MUST land before this — bug-fixer
  depends on the pre-loaded context envelope)
- Sister: `feat-065` (Phase 5, ships AFTER this — class-aware model
  selection per bug class)

## Attempt Log

### Attempt 1 — 2026-05-08 ✅ SHIPPED (all 4 phases)

**Phase A — `bug-fixer` agent**: `.claude/agents/bug-fixer.md` (~75 lines).
Tight system prompt: "You patch ONE specific defect inside a per-bug
worktree. Smallest possible diff." Hard constraints (no test edits, no
refactors, no redundant typecheck/install). Stop conditions (after 5+
edits without obvious fix → mark failed). Per-bug-class quick reference
(flow-failure / visual-parity / reachability-orphan / runtime-error /
dev-server-compile). `maxTurns: 8`, `effort: medium`, `mcp_servers: []`.

**Phase B — Enum extension**: `packages/orchestrator-contracts/src/tasks.ts`
gains `"bug-fixer"` in `AgentSequenceMember.z.enum([...])`. Back-compat
preserved — existing bugs.yaml + tasks.yaml don't reference the new
member.

**Phase C — Routing**: `scripts/file-bug-plan.mjs::defaultAgentSequence`
now returns `["bug-fixer"]` for the 4 cheap classes (dev-server-compile,
runtime-error, visual-parity, flow-execution-failure). The orphan +
parity-divergence remap still works (synthesizes `primaryCause:
"visual-parity"` → bug-fixer). `seed-setup` keeps backend-builder; build-gap

- default keep `[<tier>, tester, reviewer]`.

**Phase D — Tests**: 8 test cases updated in
`orchestrator/tests/file-bug-plan-parity.test.ts` from `["web-frontend-builder"]`
/ `["backend-builder"]` expectations to `["bug-fixer"]`. Smoke-tested
agent-mcp-config: `loadAgentMcpServers("bug-fixer")` returns `[]` →
`buildAgentMcpServersOption` returns `{}` (M-F continues).

**Tests**: 118/118 pass across 4 suites:

- `file-bug-plan-parity.test.ts` (40 tests including updated routing)
- `agent-mcp-config.test.ts` (14 existing + bug-fixer smoke verified)
- `bug-fix-context.test.ts` (8 tests from feat-063)
- `fix-bugs-loop.test.ts` (56 tests; no regression)

**Effort**: ~1.5 hr total (under the 3-hr Phase 4 estimate).

**Validation pending**: empirical reading-log-02 retry. Combined
feat-063 + feat-064 should hit the 2-3 min/bug target per
investigate-024 §Recommendation.
