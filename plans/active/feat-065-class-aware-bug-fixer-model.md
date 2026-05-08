---
id: feat-065-class-aware-bug-fixer-model
type: feature
status: in-progress
author-agent: human
created: 2026-05-08
updated: 2026-05-08
parent-plan: investigate-024-bug-fix-dispatch-efficiency
supersedes: null
superseded-by: null
branch: feat/class-aware-bug-fixer-model
affected-files:
  - ~/.claude/models.yaml
  - orchestrator/src/model-config.ts
feature-area: orchestrator/model-config
priority: P1
attempt-count: 0
max-attempts: 5
---

# feat-065: Class-aware bug-fixer model + effort

## Problem

feat-064 shipped bug-fixer with `model: inherit` + `effort: medium`.
This means `~/.claude/models.yaml`'s defaults apply uniformly across
all bug classes. Per investigate-024 §F7, that's mostly fine (Sonnet
4-6 effort:medium handles most cheap-class fixes), but two refinements
help:

1. **Mechanical classes** (dev-server-compile, reachability-orphan)
   are plumbing fixes that Haiku 4-5 can handle in 1-2 turns. ~80%
   cost reduction on those classes vs Sonnet, with negligible quality
   loss.
2. **Wall-clock cap** for bug-fixer should be tighter than the
   web-frontend-builder default (25 min). bug-fixer's `maxTurns: 8`
   is what we use to force convergence; pairing with an 8-10 min
   wall-clock cap eliminates the "agent wandered 25 min" failure mode
   we saw in reading-log-02.

## Goals

1. Phase A — Basic config: bug-fixer in `~/.claude/models.yaml`
   `agents:` map at `tier: building`, `effort: medium`, plus an
   8-min `stallTimeoutMs` default.
2. Phase B — Class-aware (deferred): pass `bug.source` through the
   dispatch envelope; override model + effort in invoke-agent's
   options based on bug source. Documented but ships only after
   Phase A delivers empirical signal.

## Non-goals

- Don't ship class-aware in Phase A — the simpler "Sonnet medium
  for all bug classes" baseline buys most of the win. Class-aware
  is a 20-30% additional optimization, not load-bearing.
- Don't change the existing tier-specific builders (web/backend/mobile)
  — they're not on the bug-fix path post-feat-064.

## Approach

### Phase A — Basic config (~30 min) ⭐ SHIPS NOW

`~/.claude/models.yaml`:

```yaml
agents:
  # ... existing entries
  bug-fixer: { tier: building, effort: medium } # feat-065
```

`orchestrator/src/model-config.ts::DEFAULT_STALL_TIMEOUT_BY_AGENT`:

```ts
const DEFAULT_STALL_TIMEOUT_BY_AGENT: Record<string, number | null> = {
  "backend-builder": 25 * 60 * 1000,
  "web-frontend-builder": 25 * 60 * 1000,
  "mobile-frontend-builder": 25 * 60 * 1000,
  tester: 20 * 60 * 1000,
  reviewer: 15 * 60 * 1000,
  security: 15 * 60 * 1000,
  "git-agent": null,
  "bug-fixer": 10 * 60 * 1000, // ← feat-065 (tight cap; maxTurns:8 also forces convergence)
};
```

### Phase B — Class-aware override (deferred ~3 hr; gated on Phase A signal)

When bug-fixer dispatches arrive, the orchestrator can pass a class
hint via the dispatch envelope (e.g. via `bug.source`). The model-
config layer then optionally overrides `model` + `effort` based on:

| Bug source               | Model              | Effort | Rationale                              |
| ------------------------ | ------------------ | ------ | -------------------------------------- |
| `dev-server-compile`     | claude-haiku-4-5   | medium | Plumbing fix; Haiku is enough          |
| `reachability-orphan`    | claude-haiku-4-5   | medium | Wiring fix; mechanical                 |
| `visual-parity`          | claude-sonnet-4-6  | high   | Layout judgment; Sonnet                |
| `flow-execution-failure` | claude-sonnet-4-6  | high   | Often type/contract; Sonnet            |
| `runtime-error`          | claude-sonnet-4-6  | medium | Stack-trace + targeted edit            |
| `build-gap`              | (not on bug-fixer) | n/a    | Real feature work; tier-specific build |
| `seed-setup`             | (backend-builder)  | n/a    | Real backend work                      |

Implementation sketch (Phase B): extend `Task` shape with optional
`classHint?: BugSource` field. `dispatchAgentsForBug` passes it for
bug-fixer dispatches. Model resolution checks for the hint + applies
the per-class override.

Phase B holds until Phase A has been validated empirically against
≥1 reading-log retry. If Phase A's "Sonnet medium for all" already
hits the 2-3 min target, Phase B is polish; if not, Phase B closes
the remaining gap.

## Rejected Alternatives

- **Hardcode class-aware in Phase A** — Rejected: too much change
  in one ship cycle; Phase A delivers the baseline + empirical signal
  before optimising further.
- **Use Haiku for ALL bug-fixer dispatches** — Rejected: visual-parity
  - flow-execution-failure benefit from Sonnet's nuance. Empirical
    evidence: flow-3's Number(id) → string-id fix touched 9 files across
    packages/types + api-client; Haiku may miss the cross-package
    contract reasoning.

## Expected Outcomes

- [ ] Phase A: bug-fixer is in `~/.claude/models.yaml` agents map
- [ ] Phase A: `DEFAULT_STALL_TIMEOUT_BY_AGENT.bug-fixer` is set to
      10 min (vs 25 min default for full-builder)
- [ ] Phase A: dispatching bug-fixer resolves to Sonnet 4-6 effort:medium
- [ ] Phase B (deferred): documented + tracked for next ship cycle

## Validation Criteria

- All existing model-config tests pass (no regression)
- Empirical reading-log-02 retry shows median wall-clock ≤3 min/bug

## Cross-references

- Parent: `investigate-024-bug-fix-dispatch-efficiency` §F8
- Sister: `feat-064-bug-fixer-agent` (Phase 4, MUST land before this)

## Attempt Log

### Attempt 1 — 2026-05-08 ✅ SHIPPED Phase A

**Model assignment**: bug-fixer added to `agentflow_phase2/.claude/models.yaml`
agents map at `tier: building, effort: medium` (vs the high effort used
by web/backend/mobile-frontend-builder). Effort:medium reflects the
"narrow-scope patch with pre-loaded context" design — bug-fixer doesn't
need exploration depth.

**Wall-clock cap**: bug-fixer added to
`orchestrator/src/model-config.ts::DEFAULT_STALL_TIMEOUT_BY_AGENT`
at 10 min (vs 25 min for tier-specific builders). Combined with
`maxTurns:8` from the agent frontmatter, this eliminates the
"agent wandered 25 min" failure mode observed in reading-log-02
b0e1281c.

**System-wide TODO**: ~/.claude/models.yaml (operator-managed) does
not yet have bug-fixer. The factory's `.claude/models.yaml` override
covers the immediate need; when the operator updates the system
defaults, they can remove the factory-level pin. Boundary-hook
prevented the orchestrator from editing the home file directly
(correct enforcement).

**Tests**: 153/153 pass across 5 suites (model-config /
file-bug-plan-parity / agent-mcp-config / bug-fix-context /
fix-bugs-loop). No regression.

**Effort**: ~15 min total (under the 30-min Phase A estimate).

### Phase B — DEFERRED

Class-aware model + effort override (per-bug-source) is documented
in §Approach above but NOT shipped. Rationale: Phase A's "Sonnet
medium for all bug classes" baseline is the simplest viable config;
class-aware shaves another 20-30% on cheap-class wall-clock + cost.
Ship after Phase A's empirical signal lands (next reading-log-02
retry). If the 2-3 min target is hit by Phase A alone, Phase B is
optional polish.
