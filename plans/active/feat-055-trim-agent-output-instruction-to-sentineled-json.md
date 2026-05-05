---
id: feat-055-trim-agent-output-instruction-to-sentineled-json
type: feature
status: draft
author-agent: claude-opus-4-7
created: 2026-05-05
updated: 2026-05-05
parent-plan: investigate-017-token-usage-reduction-for-bug-fix-process
supersedes: null
superseded-by: null
branch: feat/trim-agent-output-instruction
affected-files:
  - orchestrator/src/invoke-agent.ts
  - orchestrator/tests/invoke-agent.test.ts
feature-area: orchestrator/dispatch-prompt
priority: P1
attempt-count: 0
max-attempts: 5
---

# feat-055: Trim agent output instruction — sentineled JSON only, no markdown summary

## Problem Statement

Per investigate-017 F6: `orchestrator/src/invoke-agent.ts:1666-1669` instructs every dispatched agent to write a freeform markdown summary OUTSIDE the sentineled outcome JSON. Empirical telemetry from finance-track-01 (run `2276b8a1-...`):

- Sonnet output tokens: 817K total / ~110 dispatches ≈ **7.4K tokens output per dispatch**
- Structured outcome JSON typically: < 1K tokens
- Remaining ~6K tokens per dispatch: human-readable markdown summary that NO automated consumer reads + the operator scrolls past 95% of the time

At Sonnet output rate ($15/M), 6K × 110 dispatches = ~$10/project of pure-overhead output cost. **22% of total Sonnet spend.**

The structured outcome JSON already has `taskOutcomes` + `errors` fields with all machine-actionable info. Human reviewers needing narrative can read the code diff or check the per-task `errors[<task-id>]` field.

## Approach

### Phase A — invoke-agent.ts prompt edit

`orchestrator/src/invoke-agent.ts:1666-1669` currently:

```typescript
`\nWrite whatever markdown summary you want OUTSIDE the sentinels — the ` +
  `summary helps human reviewers; the sentineled JSON is the machine-` +
  `parseable contract. Do NOT wrap the JSON inside the sentinels in ` +
  `markdown code fences or backticks.\n`;
```

Replace with:

```typescript
`\nReturn ONLY the sentineled JSON. Do NOT write a markdown summary. ` +
  `Do NOT wrap the JSON inside the sentinels in markdown code fences or ` +
  `backticks. Diagnostic narrative belongs in the JSON's "errors" field ` +
  `keyed by task-id, not as free-form prose.\n`;
```

### Phase B — encourage rich `errors[<task-id>]` content as the narrative replacement

The orchestrator's parser already pulls `errors` out of the JSON for retry context. Update the dispatch prompt's outcome shape example (line ~1654-1656) to model a richer error message that captures what the markdown summary used to:

```typescript
`{ "taskOutcomes": { "<task-id>": "completed" | "failed", ... }, ` +
`"errors": { "<task-id>": "<one-line summary; if failed, include WHY in <=200 chars>" } }\n` +
```

### Phase C — regression tests

`orchestrator/tests/invoke-agent.test.ts`:

- Existing tests parse outcome JSON between sentinels. Verify they still pass.
- New test: dispatch a stub agent that returns ONLY `<<<TASK_OUTCOME>>> {...} <<<END_TASK_OUTCOME>>>` with no surrounding markdown. Assert outcome parses cleanly.
- New test: dispatch a stub agent that DOES write markdown around the sentinels (i.e. ignores the new instruction). Assert outcome STILL parses (graceful degradation).

### Phase D — empirical re-validation

After landing: run `/fix-bugs` against a fresh project. Compare output-token count per dispatch pre- vs post-feat-055. Target: ~50% reduction in Sonnet output tokens per dispatch (from ~7.4K to ~3.7K).

## Rejected Alternatives

- **Cap output tokens via SDK `maxThinkingTokens` / token-cap option** — Rejected. Hard cap risks truncating the outcome JSON itself, breaking the sentinel contract. Prompt-level instruction is graceful: agents that ignore it still parse correctly.
- **Post-process strip markdown outside sentinels in the parser** — Rejected. Doesn't reduce the cost; the markdown was already generated. Have to prevent generation, not post-process.
- **Bake the no-summary instruction into each agent's `.claude/agents/*.md` system prompt** — Rejected. The dispatch-time instruction is more uniformly enforceable; system prompts vary across 10+ agent definitions and would drift.

## Expected Outcomes

- [ ] Agent dispatch prompt instructs sentineled-JSON-only.
- [ ] Outcome JSON's `errors` field captures diagnostic narrative.
- [ ] No regression in outcome JSON parsing (graceful for agents ignoring the instruction).
- [ ] Empirical: per-dispatch Sonnet output tokens drop from ~7.4K to ~3.7K (~50% reduction).
- [ ] Aggregate: ~$10/project saved at finance-track-01 scale (~22% of Sonnet output spend).

## Validation Criteria

- [ ] Unit test: outcome parser handles JSON-only response (no markdown wrapping).
- [ ] Unit test: outcome parser still handles legacy markdown-wrapped responses (graceful fallback).
- [ ] Telemetry: post-deploy fresh-project run shows per-dispatch Sonnet output tokens < 5K average.
- [ ] No regression: `errors[<task-id>]` field carries failure detail when dispatch fails (pre-existing retry-loop relies on this).

## Cross-references

- **Parent**: `investigate-017-token-usage-reduction-for-bug-fix-process` F6 + R1
- **Sister plans (cost-reduction stack)**:
  - `feat-053-class-batched-fix-dispatch` — collapses dispatches; multiplies feat-055's per-dispatch saving
  - `feat-051-pm-appshell-mandate-task-template` — reduces bug count → fewer dispatches → multiplies savings further
  - `feat-052-per-feature-parity-smoke-at-close-feature` — earlier catch; same multiplier
- **Existing infrastructure**:
  - `orchestrator/src/invoke-agent.ts:1640-1672` — `buildAgentPrompt` function this plan edits
  - `orchestrator/tests/invoke-agent.test.ts` — sentinel-parser tests this plan extends
  - bug-007 — the sentinel contract this plan preserves
- **Empirical baseline**: finance-track-01 run `2276b8a1-...` (Sonnet output 817K / ~110 dispatches)
