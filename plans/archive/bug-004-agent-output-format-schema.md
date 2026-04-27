---
id: bug-004-agent-output-format-schema
type: bug
status: completed
approved-at: 2026-04-26
approved-by: human
author-agent: claude-opus-4-7
created: 2026-04-26
updated: 2026-04-26
completed-at: 2026-04-27
parent-plan: bug-003-builder-output-contract-mismatch
supersedes: null
superseded-by: null
branch: fix/agent-output-format-schema
affected-files:
  - orchestrator/src/invoke-agent.ts
  - orchestrator/tests/invoke-agent.test.ts
  - packages/orchestrator-contracts/src/builder.ts
feature-area: orchestration
priority: P0
attempt-count: 1
max-attempts: 5
error-message: "feat-bootstrap — task scaffold-next-app failed after 1 attempts: agent produced no parseable outcome JSON"
reproduction-steps: |
  1. Apply bug-002 fix (worktree seed) AND bug-003 fix (parser consumes BuilderOutput shape)
  2. /start-build kanban-webapp --resume-feature-graph --max-concurrent=1 --auto-merge-after-reviewer
  3. Observe: feat-bootstrap fails after 1 attempt with the exact same surface error message as bug-003 ("agent produced no parseable outcome JSON") but WITHOUT the zod-hint suffix bug-003 added — meaning translateOutcomes hit its FIRST guard (parsed is null) rather than the BuilderOutput-shape-mismatch path; root cause is upstream in extractStructuredOutput
stack-trace: null
---

# bug-004 — Orchestrator doesn't request structured output from the SDK; relies on a brittle text regex

## Bug Description

**Expected:** when a builder agent runs successfully (subtype: "success") and produces its return JSON, the orchestrator's `extractStructuredOutput` reliably extracts the parsed object, and the canonical-shape `BuilderOutput` parser (added in bug-003) translates it into per-task outcomes.

**Actual:** the SDK's `result.structured_output` is `undefined` (because `buildAgentOptions` never declares an `outputFormat` when calling `query()`), so the orchestrator falls back to a regex (`/\{[\s\S]*\}\s*$/`) that requires the agent's text output to END with parseable JSON. LLM agents emit JSON in many shapes — wrapped in `json` markdown fences, followed by trailing prose ("Done!"), interleaved with progress notes — and the regex breaks on most of them. When the regex fails, `extractStructuredOutput` returns `null`, `translateOutcomes` hits its FIRST guard (parsed is null/non-object/array), and every dispatched task is marked `failed` with `"agent produced no parseable outcome JSON"` — the exact same surface message as bug-003, but a completely different root cause one layer up.

The Anthropic Agent SDK already has explicit support for this exact problem: `Options.outputFormat: { type: 'json_schema', schema: ... }` (sdk.d.ts:1393-1404). When set, the SDK enforces the schema, parses the agent's output, retries up to N times on validation failure (`error_max_structured_output_retries` subtype), and populates `result.structured_output` deterministically. The orchestrator never opted in.

This was discovered during the bug-003 validation re-run on kanban-webapp 2026-04-26 (~23:47Z 2026-04-25 UTC). The agent successfully wrote `apps/web/{app, lib, next.config.ts, package.json, postcss.config.mjs, tailwind.config.ts, tsconfig.json, vitest.config.ts}` plus `node_modules/`, but its terminal text response didn't end in parseable JSON (the previous run's $1.70 dispatch happened to emit JSON-without-fences; this run emitted JSON-with-fences — pure LLM non-determinism). The orchestrator marked the feature failed and aborted the entire 10-feature DAG. Cost: $1.33 — even cheaper than the bug-003 surfacing run thanks to TASK_RETRY_CAP=1 from bug-002.

## Reproduction Steps

1. Apply bug-002 fix (commit `ff58d27`) — worktree seed for hooks + permissions
2. Apply bug-003 fix (commit `0d5a84d`) — parser consumes canonical `BuilderOutput` shape
3. Run `/start-build kanban-webapp --resume-feature-graph --max-concurrent=1 --auto-merge-after-reviewer` (or against any project that's completed Mode A through gate 5)
4. Observe orchestrator exit:
   - `feat-bootstrap — task scaffold-next-app failed after 1 attempts: agent produced no parseable outcome JSON` (no zod-hint suffix)
   - All 9 dependents abort
   - Total cost: ~$1.33

5. Inspect `<worktree>/apps/web/`: real scaffold files exist (proves agent ran AND emitted output, just not in a form the regex captured); `git log` shows only the init commit (agent didn't commit — same pattern as the bug-003 surfacing run)

## Error Output

From the orchestrator exit (2026-04-25 ~23:47Z UTC, pipeline run `1ca5acb8-9d71-4a31-ab1d-66ce7ec4e17d`):

```
Project: C:\Development\ps\claude\claude_\agentflow_phase2\projects\kanban-webapp
Features completed: 0
Features failed:    10
Total cost:         $1.33

Failed features:
  ✗ feat-bootstrap — task scaffold-next-app failed after 1 attempts: agent produced no parseable outcome JSON
  ✗ feat-board-core — dependency feat-bootstrap failed
  ... (8 more cascade aborts)
```

**Critical disambiguation from bug-003:** the bug-003 fix added a zod-hint suffix to the error string when `BuilderOutput.safeParse` fails (`"agent produced no parseable outcome JSON (BuilderOutput zod: ...)"`). This run's error message has NO zod-hint suffix, meaning we hit `translateOutcomes`'s FIRST guard (parsed is null), not the bug-003 path. So `extractStructuredOutput` returned `null`. So either the SDK reported `structured_output: undefined` AND `result.result` text didn't end in parseable JSON, OR `JSON.parse` threw on the regex match.

The earlier bug-003-surfacing run got past `extractStructuredOutput` (parsed an object, just not a `BuilderOutput`-shaped one); this run didn't even get that far. Same agent, same prompt, different random LLM output — proves the regex is the brittle layer.

## Root Cause Analysis

Three things conspire:

### 1. `buildAgentOptions` never declares `outputFormat`

`orchestrator/src/invoke-agent.ts:734-764`:

```ts
return {
  model: modelConfig.model,
  effort: modelConfig.effort as NonNullable<Options["effort"]>,
  cwd: args.cwd,
  env,
  maxBudgetUsd: modelConfig.budgetUsd,
  ...(auth.forceLoginMethod ? { forceLoginMethod: auth.forceLoginMethod } : {}),
};
```

No `outputFormat`. The SDK doesn't know the agent should emit structured output, so it runs in plain-text mode.

### 2. The SDK has explicit support for this

`orchestrator/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1393-1404`:

```ts
/**
 * Output format configuration for structured responses.
 * When specified, the agent will return structured data matching the schema.
 * @example
 * outputFormat: {
 *   type: 'json_schema',
 *   schema: { type: 'object', properties: { result: { type: 'string' } } }
 * }
 */
outputFormat?: OutputFormat;
```

And `JsonSchemaOutputFormat` at sdk.d.ts:807-810:

```ts
{
  type: "json_schema";
  schema: Record<string, unknown>;
}
```

Plus a dedicated retry subtype at sdk.d.ts:2937: `'error_max_structured_output_retries'` — the SDK has built-in retry semantics for when the model produces invalid output.

### 3. The fallback regex is too brittle for real LLM output

`orchestrator/src/invoke-agent.ts:770-781`:

```ts
function extractStructuredOutput(result: SDKResultMessage): unknown {
  if (result.subtype !== "success") return null;
  if (result.structured_output !== undefined) return result.structured_output;
  const text = result.result.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}\s*$/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}
```

The regex requires JSON at the absolute end of the string with only whitespace after. Common LLM emission patterns that break it:

- **Markdown code fences**: `...some text...\n\`\`\`json\n{...}\n\`\`\`\n`— closing fence + newline after`}`defeats`\s\*$`
- **Trailing prose**: `...{...}\n\nDone!` — "Done!" defeats `\s*$`
- **Multiple JSON objects**: `{"progress": 0.5}\n\n{"final": ...}` — `[\s\S]*` is greedy → matches from FIRST `{` to LAST `}` → produces invalid concatenated JSON → JSON.parse throws → returns null

LLM output is non-deterministic. The previous run's $1.70 dispatch happened to emit JSON-without-fences and got past the regex (then failed at the BuilderOutput shape check, surfacing bug-003). This run's $1.33 dispatch emitted JSON-with-fences (or some other regex-defeating shape) and didn't get past the regex at all.

The fix isn't "make the regex smarter" — it's "stop relying on a regex; use the SDK's actual mechanism."

### Why didn't tests catch this?

`orchestrator/tests/invoke-agent.test.ts` stubs the SDK to return `structured_output: { ... }` directly. The fallback regex path is never exercised in tests. The integration shape (real SDK + real agent + real LLM) was never tested end-to-end before bug-002 unblocked the autonomous Mode B run.

## Fix Approach

Single-phase structural fix + a defense-in-depth phase + tests + validation re-run.

### Phase 1 — Use the SDK's `outputFormat` for builder agents

File: `packages/orchestrator-contracts/src/builder.ts`. Export a JSON Schema derived from the canonical zod schema. Zod v4 ships `z.toJSONSchema()`, so no new dependency:

```ts
import { z } from "zod";
// ... existing schema definitions ...
export const BuilderOutputJsonSchema = z.toJSONSchema(BuilderOutput);
```

File: `orchestrator/src/invoke-agent.ts:734-764` (`buildAgentOptions`). Set `outputFormat` for builder agents only:

```ts
const isBuilder =
  agent === "backend-builder" ||
  agent === "web-frontend-builder" ||
  agent === "mobile-frontend-builder";
return {
  // ...existing fields...
  ...(isBuilder
    ? { outputFormat: { type: "json_schema", schema: BuilderOutputJsonSchema } }
    : {}),
};
```

Note: only builders emit `BuilderOutput`. Tester, reviewer, security each have their own contracts that need their own schemas — defer to a later bug if/when they surface the same regex-failure mode. For now, addressing the immediate Mode B blocker.

### Phase 2 — Defense-in-depth: enrich `extractStructuredOutput` failure detail

Even after Phase 1, the SDK can still fail to produce structured output (e.g., max retries hit → subtype: `"error_max_structured_output_retries"`). And tester/reviewer paths still rely on the regex fallback. Two small upgrades:

1. **Make the regex tolerant of markdown code fences.** Before regex match, strip a trailing `...` block if present. Pseudocode:

   ````ts
   let text = result.result.trim();
   // Strip trailing ```...``` markdown fence (with or without language tag)
   text = text.replace(/```[a-z]*\s*\n?([\s\S]*?)\n?```\s*$/i, "$1").trim();
   const jsonMatch = text.match(/\{[\s\S]*\}\s*$/);
   ````

2. **Surface diagnostics on null return.** Currently `extractStructuredOutput` returns `null` with no breadcrumb. Refactor to return either `{ ok: true, parsed }` or `{ ok: false, reason }` so `runLlmAgent` can surface a precise reason (e.g., "structured_output undefined AND text didn't end with `}`", "JSON.parse threw at position 142", "agent's output text was empty"). The current "agent produced no parseable outcome JSON" message is a $6+ debug session per occurrence.

### Phase 3 — Tests

File: `orchestrator/tests/invoke-agent.test.ts`. Add:

- `buildAgentOptions` sets `outputFormat: { type: "json_schema", schema: ... }` for backend/web/mobile builders
- `buildAgentOptions` does NOT set `outputFormat` for tester/reviewer/git-agent (preserves their text-output paths)
- `extractStructuredOutput` happy path: SDK provides `structured_output` directly → returned verbatim
- `extractStructuredOutput` markdown-fence fallback: text ending in `json {...} ` → fence stripped, JSON parsed
- `extractStructuredOutput` returns ok=false with a precise reason when subtype != success / structured_output missing AND no JSON / JSON.parse throws

### Phase 4 — Validation re-run

Re-fire `/start-build kanban-webapp --resume-feature-graph --max-concurrent=1 --auto-merge-after-reviewer` after Phases 1-3 land + the orphan worktree dir is manually cleared. Expected outcomes:

- **Best case**: SDK enforces BuilderOutput schema → agent's first attempt produces valid structured output → parser succeeds → tester runs → reviewer approves → git-agent merges → DAG progresses
- **Likely case**: SDK retries 1-2× internally to produce valid output (model adjusts on `error_max_structured_output_retries` retry), then succeeds OR exhausts retries with subtype: `"error_max_structured_output_retries"` (which is informative — much better than silent regex failure)
- **Other case**: a NEW failure mode surfaces (e.g., the agent's content fails downstream linting / typechecking) — at which point we have a NEW signal to chase, having spent ~$2 to learn it

## Rejected Fixes

- **Make the regex more permissive (strip code fences, handle trailing text, etc.) without using outputFormat.** Rejected as the PRIMARY fix: it patches the symptom, not the cause. The SDK has explicit structured-output support; not using it leaves us perpetually one model-output-shape away from the next regex break. Phase 2 includes a regex-tolerance upgrade as defense-in-depth (for tester/reviewer paths and SDK-retry-exhaustion edge cases), but the load-bearing fix is `outputFormat`.

- **Update the agent prompts to emit JSON in a more regex-friendly way (no fences, no trailing prose).** Rejected: prompt engineering against LLM non-determinism is fragile. The agent might emit clean JSON on 9 of 10 runs and break on the 10th. Schema enforcement at the SDK boundary is robust; prompt instructions are not.

- **Drop the regex fallback entirely after Phase 1.** Rejected: tester, reviewer, and any non-builder agent in `agent_sequence[]` still need a fallback (their schemas aren't defined yet, and they emit free-form text + a final JSON block). Keep the fallback as a safety net.

- **Use `z.toJSONSchema(BuilderOutputBase)` instead of `BuilderOutput`.** Rejected because `BuilderOutput` is a discriminated union on `tier` — the schema needs to encode the discriminator so the SDK can enforce the right shape per builder. `BuilderOutput` (the union) is correct; `BuilderOutputBase` (the inner shape) loses the discriminator.

## Validation Criteria

- The original error no longer occurs: a fresh `/start-build kanban-webapp --resume-feature-graph --max-concurrent=1 --auto-merge-after-reviewer` with the orphan worktree cleared produces `result.structured_output` populated by the SDK on the agent's first or first-retry attempt; `translateOutcomes` walks the canonical-shape arrays; per-task outcomes match the agent's `tasksCompleted`/`tasksFailed`/`tasksSkipped`.
- All 223 existing orchestrator tests still pass.
- New tests added for `buildAgentOptions` outputFormat configuration and the `extractStructuredOutput` upgrades; pass.
- `pnpm --filter orchestrator typecheck` clean.
- `pnpm --filter @repo/orchestrator-contracts typecheck` clean.
- Validation re-run on kanban-webapp progresses past `extractStructuredOutput` (either succeeds OR fails with a NEW signal in `result.subtype` like `"error_max_structured_output_retries"` — both prove bug-004 is structurally fixed).

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->

### Attempt 1 — 2026-04-26 — claude-opus-4-7

**Tried (Phases 1, 2, 3; Phase 4 = validation re-run pending):**

- **Phase 1 — JSON Schema export from `BuilderOutput`** (`packages/orchestrator-contracts/src/builder.ts`): added `export const BuilderOutputJsonSchema = z.toJSONSchema(BuilderOutput);` — zod v4 ships this natively, no new dependency.
- **Phase 1 — `outputFormat` in `buildAgentOptions`** (`orchestrator/src/invoke-agent.ts:734`): added `agent` parameter, then conditionally set `outputFormat: { type: "json_schema", schema: BuilderOutputJsonSchema }` when `isBuildAgent(agent)` returns true. Updated the call site at line 633 to pass `agent`. Other agent types (tester, reviewer, git-agent) keep the legacy regex fallback path until their schemas are formalized.
- **Phase 2 — `extractStructuredOutput` refactor** (`invoke-agent.ts:770`): changed return type from `unknown` to `ExtractResult` discriminated union (`{ ok: true, parsed }` or `{ ok: false, reason }`). Added markdown-fence stripping before regex match (`/```[a-zA-Z0-9]*\s*\n?([\s\S]*?)\n?```\s*$/`). Each failure path now returns a precise `reason` string: SDK subtype, empty result, no-trailing-JSON (with the last 200 chars of the agent's output), JSON.parse error message. Updated the call site in `runLlmAgent` to handle the new shape — on `ok: false`, all dispatched tasks are marked failed with `errors[t.id] = "agent produced no parseable outcome JSON: ${reason}"`.
- **Phase 3 — Tests** (`orchestrator/tests/invoke-agent.test.ts`): added a new describe block `invokeAgent — outputFormat + extractStructuredOutput (bug-004)` with 6 tests:
  - `buildAgentOptions` sets `outputFormat` for `backend-builder`
  - `buildAgentOptions` does NOT set `outputFormat` for `tester`
  - SDK-provided `structured_output` flows through (primary path)
  - Trailing markdown fence is stripped and JSON parsed (fallback path)
  - Empty `result.result` → precise reason "result.result was empty"
  - Text without trailing JSON → precise reason "text didn't end with parseable JSON" + tail breadcrumb

**What happened:**

- First test run after Phase 1+2: all 223 existing tests passed unchanged (the legacy regex fallback path is still functionally equivalent for non-builder agents; existing tests all stub `structured_output` directly so they never exercise the regex path).
- Second test run after adding the 6 new tests: **229/229 pass** on first try. `pnpm --filter orchestrator typecheck` clean. `pnpm --filter @repo/orchestrator-contracts typecheck` clean.

**Outcome:** Phases 1-3 implemented and verified at the unit-test level. Validation re-run on kanban-webapp pending — needs the orphan worktree dir cleared (user action) then a fresh `/start-build`.

**Lessons for future-claude:**

- **Read the SDK type definitions before writing brittle text parsers.** The Anthropic Agent SDK has explicit `Options.outputFormat: { type: 'json_schema', schema }` support with built-in retry semantics (`error_max_structured_output_retries` subtype). The orchestrator's regex-based fallback was authored as if structured output had to be DIY; in fact, the SDK does it natively. A 5-minute read of `sdk.d.ts` (specifically the Options interface around line 1393) would have surfaced this in feat-008 / task-035 and saved the bug-004 surfacing cycle entirely.
- **Silent null returns are a debugging tax.** The original `extractStructuredOutput` returned `null` with no breadcrumb on every failure path (subtype mismatch, empty text, no-trailing-JSON, JSON.parse throw). Each occurrence cost $1-6 of LLM dispatch + 30+ minutes of filesystem archaeology to diagnose. The refactor to `{ ok, reason }` adds ~10 LOC and turns each occurrence into a 30-second message read.
- **Zod v4 is more capable than typically used.** `z.toJSONSchema()` (added in v4) eliminates the need for a separate `zod-to-json-schema` dependency. Worth a sweep across the codebase for other places where we're hand-converting zod schemas or installing redundant deps.

## References

- `plans/active/bug-003-builder-output-contract-mismatch.md` — parent bug; bug-004 surfaced cheaply because bug-003's zod-hint enrichment let me distinguish the FIRST-guard path (no hint, this bug) from the BuilderOutput-mismatch path (with hint, bug-003) in the failure message
- `plans/active/bug-002-worktree-missing-hooks-perms.md` — grandparent; TASK_RETRY_CAP=1 from bug-002 keeps each iteration cost-bounded ($1-2)
- `plans/active/feat-014-mvp-completion-autonomous-e2e.md` — MVP plan; bug-004 is the next layer of the autonomous Mode B chain
- `orchestrator/src/invoke-agent.ts:734-781` — `buildAgentOptions` (missing outputFormat) + `extractStructuredOutput` (brittle regex)
- `orchestrator/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:807-810,1393-1404,2937` — SDK's outputFormat type, JsonSchemaOutputFormat, and structured-output retry subtype
- `packages/orchestrator-contracts/src/builder.ts` — canonical `BuilderOutput` schema (will export JSON Schema)
- Validation re-run output (transient): `tasks/brb02acal.output` — the failed run that surfaced the bug at $1.33
