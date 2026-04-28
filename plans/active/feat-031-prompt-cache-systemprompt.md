---
id: feat-031-prompt-cache-systemprompt
type: feature
status: draft
author-agent: claude-opus-4-7
created: 2026-04-28
updated: 2026-04-28
parent-plan: investigate-010-rate-limit-observability-and-reduction
supersedes: null
superseded-by: null
branch: feat/prompt-cache-systemprompt
affected-files:
  - orchestrator/src/invoke-agent.ts
  - orchestrator/src/build-agent-prompt.ts
  - orchestrator/test/invoke-agent.test.ts
feature-area: orchestration
priority: P2
attempt-count: 0
max-attempts: 5
---

# feat-031 — Prompt-cache cross-dispatch via `systemPrompt` + `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` + `excludeDynamicSections`

## Problem Statement

`runLlmAgent`'s `buildAgentOptions` (orchestrator/src/invoke-agent.ts:
1427-1476) passes **no `systemPrompt` field at all** to the SDK. Per
the SDK type defs (`sdk.d.ts:1578-1633`), this means the SDK falls back
to its default `claude_code` preset with full per-user dynamic
sections (cwd, memory, git status) injected into the system prompt for
every dispatch.

Consequences during Mode B (~24-28 dispatches per run):

1. **No cross-dispatch caching** — every agent invocation sends the
   same SKILL.md + global rules (testing-policy.md, reviewer-playbook,
   architecture-rules, etc.) as fresh tokens. ~10K-20K input tokens
   per dispatch × 24 dispatches = ~240K-480K wasted tokens/run.
2. **Per-user dynamic sections aren't cacheable cross-agent** — the
   default preset includes cwd/memory/git-status, which differ across
   sessions and prevent the prefix from matching the SDK's
   `cache_creation` window.
3. **`ModelUsage.cacheReadInputTokens` is always 0** in current run
   counters (verifiable post-feat-030 §D).

The SDK has 1st-class primitives we don't use:

- `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` marker — splits a `string[]`
  systemPrompt into a static (cacheable) prefix and dynamic
  (per-call) suffix.
- `{ type: 'preset', preset: 'claude_code', excludeDynamicSections:
true }` — strips per-user content from the system prompt and
  re-injects it as the first user message; prefix stays cacheable
  cross-agent.

Estimated savings (post-feat-030 telemetry will validate): 30-50%
input-token reduction on dispatches 2-N per agent slot. Bucket
consumption proportional. Especially impactful on `seven_day_sonnet`
(per investigate-010 §F5: ~28 Sonnet dispatches/run).

Cross-references: investigate-010 §F3 (parent), feat-030 (validates
savings via per-model telemetry), feat-024 (the existing SDK
integration this extends).

## Approach

### Phase A — Static-prefix construction

1. New file `orchestrator/src/build-agent-prompt.ts` (or extend the
   existing prompt builder) with `buildSystemPromptArray(agent,
featureContext, projectRoot)` that returns a `string[]` shape:
   ```ts
   [
     /* static prefix, cross-dispatch cacheable */
     defaultClaudeCodePresetCore, // base SDK preset minus dynamic
     readSkillMarkdown(agent.slug), // .claude/skills/agents/.../SKILL.md
     readGlobalRules(), // testing-policy.md + reviewer-playbook + …
     SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
     /* dynamic suffix, per-call */
     featureContextBlock(featureContext), // featureId, branch, brief excerpt
     timestampLine(), // current time/date
   ];
   ```
2. The static portion is byte-deterministic per agent slug — so two
   `backend-builder` dispatches in the same Mode B run share the
   prefix and the SDK's cache prefix-match succeeds.
3. The dynamic portion stays small (~200-500 tokens) so the cost of
   the cache-miss tail is low.

### Phase B — Wire `systemPrompt` + `excludeDynamicSections` into `buildAgentOptions`

1. Modify `buildAgentOptions` (invoke-agent.ts:1427) to add the
   `systemPrompt` option:
   ```ts
   return {
     model: modelConfig.model,
     effort: modelConfig.effort,
     cwd: args.cwd,
     env,
     maxBudgetUsd: modelConfig.budgetUsd,
     systemPrompt: buildSystemPromptArray(
       agent,
       args.featureContext,
       cfg.projectRoot,
     ),
     ...(abortController ? { abortController } : {}),
     // existing options preserved
   };
   ```
2. The `defaultClaudeCodePresetCore` factor uses the SDK's preset with
   `excludeDynamicSections: true` to strip cwd/memory/git-status (which
   re-injected as first user message). Cross-agent prefix unification.

### Phase C — Cache-hit telemetry surface

1. Already shipped in feat-030 §D — `modelBreakdown` includes
   `cacheReadInputTokens` + `cacheCreationInputTokens` per model.
2. After feat-031 ships, run a Mode B project (smoke target — kanban-
   webapp-13 or repo-health-dashboard-02 ideally, NOT the still-
   blocked -01) and check `counters.json.budget.modelBreakdown
[claude-sonnet-4-6]`. Expected:
   - `cacheReadInputTokens / inputTokens > 0.50` after the 2nd
     dispatch (first dispatch creates the cache, subsequent hit it).
3. Document expected ratio in
   `docs/architecture/prompt-cache-architecture.md` (new file) so
   future regressions are catchable.

### Phase D — Validation A/B run (post-merge)

1. After feat-030 + feat-031 are both merged, pick a small Mode B
   target (4-feature project or a fresh smoke-run of an existing
   one). Run twice:
   - **Baseline (pre-feat-031)**: revert `systemPrompt` plumbing;
     full Mode B; capture counters.json.modelBreakdown +
     rate-limit-events.ndjson per agent.
   - **With caching**: full Mode B with feat-031 enabled.
2. Compare:
   - `inputTokens` total (expect cache-with > cache-without
     because cache_creation_input_tokens count separately, but
     `inputTokens` per dispatch should drop sharply)
   - `costUSD` per Sonnet dispatch (expect 30-50% reduction)
   - `seven_day_sonnet.utilization` rate of fill (expect ~50%
     slower per the investigate-010 §F5 dispatch-volume model)

## Rejected Alternatives

- **Use `cache_control: 'ephemeral'` on individual messages instead of
  systemPrompt-level caching** — Rejected because Mode B's repeat
  content is the SKILL.md / rules prefix, not in-message tool calls.
  systemPrompt caching is the right granularity.
- **Re-author every SKILL.md as cache-friendly** — Rejected because
  SKILL.md content is already byte-deterministic per agent (no
  per-call interpolation); the issue is that we don't pass them to
  the SDK at all currently. No content surgery needed.
- **Skip `excludeDynamicSections: true`** — Rejected because cwd +
  memory + git-status are the THREE highest-churn fields in the
  default preset; without excluding them the prefix differs every
  call and cache-prefix-match fails. Including them as user message
  is the explicit Anthropic-blessed pattern.
- **Implement per-tier caching (only Sonnet, not Opus)** — Rejected
  because the SDK applies cache logic uniformly; tier-gating adds
  branching for no benefit. Opus dispatches are fewer (~6/Mode A) so
  the cache-creation cost is amortized.
- **Defer until Anthropic ships a v2 cache API** — Rejected because
  the current API is stable and `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` is
  documented as the supported pattern. Waiting for hypothetical v2
  costs us bucket fill on every run.

## Expected Outcomes

- [ ] `buildAgentOptions` passes `systemPrompt` array with
      `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` separator
- [ ] First dispatch of an agent type per run logs
      `cacheCreationInputTokens > 0`
- [ ] Subsequent dispatches of the same agent type log
      `cacheReadInputTokens > 0` AND `cacheCreationInputTokens == 0`
- [ ] Across a Mode B run, `cacheReadInputTokens / inputTokens > 0.50`
      for Sonnet
- [ ] `costUSD` per Sonnet dispatch drops by ≥ 30% on the same Mode B
      project compared to baseline (A/B in Phase D)
- [ ] `excludeDynamicSections: true` does NOT regress agent quality
      — measured by feature-completion rate ≥ 95% on the smoke project
      (no new flaky failures)
- [ ] No regressions in orchestrator + contracts test suites

## Validation Criteria

1. **Type-level integration**: `Options.systemPrompt` is a typed
   `string[]` per SDK 1578-1633; TS compile passes; unit test asserts
   the array shape.
2. **Cache-prefix determinism test** — run `buildSystemPromptArray`
   twice with the same agent + projectRoot but different
   featureContext; assert the prefix portion (everything before
   `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`) is byte-identical.
3. **Live cache-hit verification** — A/B Mode B runs as in Phase D.
   Diff the two `counters.json.budget.modelBreakdown` blocks. Expected
   delta on `cacheReadInputTokens` from 0 → > 50% of inputTokens.
4. **Quality regression check** — same Mode B project ships in both
   runs without new test failures, lower bug-plan auto-author count,
   and the same reviewer verdict. Authoring-quality preserved.
5. **Coverage**: ≥ 80% line coverage on touched files per
   `.claude/rules/testing-policy.md`.
6. **Documentation**: `docs/architecture/prompt-cache-architecture.md`
   committed; references SDK type names and the
   `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` semantics.

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->
