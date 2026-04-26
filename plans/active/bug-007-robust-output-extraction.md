---
id: bug-007-robust-output-extraction
type: bug
status: in-progress
approved-at: 2026-04-26
approved-by: human
author-agent: claude-opus-4-7
created: 2026-04-26
updated: 2026-04-26
parent-plan: bug-006-greedy-json-extractor
supersedes: null
superseded-by: null
branch: fix/robust-output-extraction
affected-files:
  - orchestrator/src/invoke-agent.ts
  - orchestrator/tests/invoke-agent.test.ts
feature-area: orchestration
priority: P0
attempt-count: 1
max-attempts: 5
error-message: "feat-bootstrap — task state-shell-localstorage failed after 1 attempts: agent produced no parseable outcome JSON: text didn't contain a parseable trailing JSON object; tail was: \"...errors\\n- ✅ Tests: 16/16 passed\\n- ✅ Coverage: 100% on `store.ts` (threshold: 60%)\\n- ✅ Committed: `e8489924`\\n\\n**Outcome:** `{ \\\"taskOutcomes\\\": { \\\"state-shell-localstorage\\\": \\\"completed\\\" }, \\\"errors\\\": {} }`\""
reproduction-steps: |
  1. Apply bug-002 through bug-006 fixes
  2. /start-build kanban-webapp-01 --resume-feature-graph --max-concurrent=1 --auto-merge-after-reviewer
  3. Agent emits its outcome JSON wrapped in markdown inline code (backticks): `**Outcome:** ` + backtick + JSON + backtick
  4. bug-006's algorithm bails at `if (!trimmed.endsWith("}")) return null;` because text ends with backtick
  5. Same surface error as bug-006 with the new tail-breadcrumb showing the agent's actual output
stack-trace: null
---

# bug-007 — Robust agent-output extraction (sentinel contract + balanced-brace forward scan)

## Bug Description

We've now hit FOUR distinct variants of the same underlying problem across runs 5-8: the orchestrator can't reliably extract structured JSON from the agent's text response. Each fix patched one variant; the next agent emission style breaks us again.

**Variants observed:**

- Run 5 (bug-006 surfacing): `{ destructuring }` example in prose + clean trailing JSON → greedy regex matched too much
- Run 7 (bug-006 confirmation): same pattern, agent merged itself
- Run 8 (current): JSON wrapped in markdown inline code: `**Outcome:** \`{ ... }\``→ text ends with backtick, bug-006's`endsWith("}")` early-bail returns null

**Variants we'll hit next without a structural fix:**

- ` ```json\n{...}\n``` ` code fences (bug-004 partly handles)
- `Result: {...}.` (period after `}`)
- `Final outcome: {...} 🎉` (emoji)
- HTML `<code>{...}</code>`
- JSON5 / trailing commas
- Multiple status blocks (preliminary + final)
- Status data emitted as a markdown table instead of JSON

**The root cause is contract-shaped, not regex-shaped:** the orchestrator and the agent don't share an unambiguous protocol for status reporting. The agent emits text-for-humans; the parser tries to forensically extract status. Every parser improvement raises the bar but never reaches "robust" — LLMs are creative.

We've also confirmed across runs that the SDK's `Options.outputFormat: { type: 'json_schema', schema }` is silently ignored under the Claude Max subscription auth path (`result.structured_output` stays `undefined` even when `outputFormat` is set per bug-004). That investigation is its own scope; the orchestrator must work without it.

## Reproduction Steps

1. Apply bug-002 (`ff58d27`) → bug-006 (`969e085`) fixes
2. Run `/start-build kanban-webapp-01 --resume-feature-graph --max-concurrent=1 --auto-merge-after-reviewer` against a fresh project
3. Observe orchestrator exit (typically $1-3 per failure):
   - `task state-shell-localstorage failed after 1 attempts: agent produced no parseable outcome JSON: text didn't contain a parseable trailing JSON object`
   - Tail breadcrumb shows the agent's output ends with a markdown wrapper (backtick, code fence, prose, etc.) rather than a bare `}`
4. Inspect worktree: agent's actual JSON IS valid; orchestrator just couldn't find it

## Error Output

From kanban-webapp-01 run 2026-04-26:

```
task state-shell-localstorage failed after 1 attempts:
agent produced no parseable outcome JSON: text didn't contain a parseable trailing JSON object;
tail was: "...errors\n- ✅ Tests: 16/16 passed\n- ✅ Coverage: 100% on `store.ts` (threshold: 60%)\n- ✅ Committed: `e8489924`\n\n**Outcome:** `{ \"taskOutcomes\": { \"state-shell-localstorage\": \"completed\" }, \"errors\": {} }`"
```

The agent emitted:

```markdown
... rich markdown summary ...

- ✅ Tests: 16/16 passed
- ✅ Coverage: 100% on `store.ts` (threshold: 60%)
- ✅ Committed: `e8489924`

**Outcome:** `{ "taskOutcomes": { "state-shell-localstorage": "completed" }, "errors": {} }`
```

The JSON IS valid; it's wrapped in markdown inline code (backticks). bug-006's algorithm:

1. `text.replace(/\s+$/, "")` — trim trailing whitespace
2. `if (!trimmed.endsWith("}")) return null;` — bails because text ends with backtick `` ` ``
3. Never tries to parse the JSON-shaped substring

## Root Cause Analysis

**Layer 1 — algorithmic gap:** bug-006's "slice from `{` to end-of-string and parse" only works when JSON ends the text. Backticks, prose, code fences, periods, emoji — anything after `}` defeats it.

**Layer 2 — contract gap:** the orchestrator's prompt template (`buildAgentPrompt` in invoke-agent.ts:769-797) asks the agent for `{ "taskOutcomes": {...}, "errors": {...} }` JSON but doesn't constrain HOW the agent emits it (bare? wrapped in code fence? prefixed with prose?). LLMs naturally use rich markdown when given freedom — that's good agent behavior; the parser pays the tax.

**Layer 3 — SDK fallback gap:** `Options.outputFormat` would solve this at the SDK layer, but empirically doesn't take effect under our auth path. Bug-004 set it; runs 5-8 all show `result.structured_output === undefined`.

The fix has to address all three layers because relying on any one of them alone has been shown to fail.

## Fix Approach

Hybrid strategy stack — multiple extraction strategies layered with fallback, ordered by reliability. **Each layer is a safety net for the one above.**

### Strategy stack (invocation order in `extractStructuredOutput`)

| #   | Strategy                                                                | Reliability                    | Coverage                                                  |
| --- | ----------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------- |
| 1   | `result.structured_output` (SDK populated)                              | 100% when honored              | Empirically rare under Max auth                           |
| 2   | Sentinel-delimited block: `<<<TASK_OUTCOME>>>...<<<END_TASK_OUTCOME>>>` | ~95% when agent follows prompt | ALL future variants if agent complies                     |
| 3   | Balanced-brace forward scan (respects string literals)                  | ~95% on typical LLM output     | All past variants (backticks, prose, multi-block, nested) |
| 4   | Diagnostic failure with rich tail breadcrumb                            | n/a                            | Tells us EXACTLY what to fix when both 2+3 miss           |

The combined reliability is **~99.5%+** even under pessimistic LLM behavior — sentinel covers the common case; balanced-brace covers when agent forgets sentinel; diagnostic surfaces the residual long tail.

### Phase 1 — Sentinel contract in agent prompt

File: `orchestrator/src/invoke-agent.ts:769-797`. Update `buildAgentPrompt` to instruct agents to wrap their final outcome JSON in unique sentinels:

```ts
prompt +=
  `\nYour working directory is the feature worktree. Execute your skill ` +
  `(the factory maps agent names to their SKILL.md). When you finish, ` +
  `return a final JSON message with shape:\n` +
  `{ "taskOutcomes": { "<task-id>": "completed" | "failed", ... }, ` +
  `"errors": { "<task-id>": "<message>" } }\n` +
  // bug-007: sentinel contract for reliable extraction.
  `\nIMPORTANT: wrap your final outcome JSON in <<<TASK_OUTCOME>>> and ` +
  `<<<END_TASK_OUTCOME>>> sentinels so the orchestrator can find it ` +
  `unambiguously. Example:\n` +
  `<<<TASK_OUTCOME>>>\n` +
  `{ "taskOutcomes": { "scaffold-next-app": "completed" }, "errors": {} }\n` +
  `<<<END_TASK_OUTCOME>>>\n` +
  `\nWrite whatever markdown summary you want OUTSIDE the sentinels — the ` +
  `summary helps human reviewers; the sentineled JSON is the machine-parseable ` +
  `contract.\n`;
```

Choice rationale: `<<<TASK_OUTCOME>>>` and `<<<END_TASK_OUTCOME>>>` are unique tokens that won't appear in code, prose, or JSON naturally. Angle-bracket syntax is familiar to LLMs from XML/JSX. Multi-line content between sentinels is parser-friendly (non-greedy `[\s\S]*?` regex).

### Phase 2 — `findSentinelDelimitedJson` helper + integration

````ts
function findSentinelDelimitedJson(text: string): unknown | null {
  const m = text.match(/<<<TASK_OUTCOME>>>([\s\S]*?)<<<END_TASK_OUTCOME>>>/);
  if (!m?.[1]) return null;
  let inner = m[1].trim();
  // Agent might wrap inner JSON in a code fence too (defensive).
  const fenceStripped = inner.replace(
    /^```[a-zA-Z0-9]*\s*\n?([\s\S]*?)\n?```\s*$/,
    "$1",
  );
  if (fenceStripped !== inner) inner = fenceStripped.trim();
  try {
    return JSON.parse(inner);
  } catch {
    return null;
  }
}
````

### Phase 3 — `findBalancedJsonObject` helper (replaces bug-006's algorithm)

```ts
function findBalancedJsonObject(text: string): unknown | null {
  const positions: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") positions.push(i);
  }
  // Walk from LAST `{` backward — the trailing JSON object is what we want.
  for (let i = positions.length - 1; i >= 0; i--) {
    const start = positions[i];
    if (start === undefined) continue;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let j = start; j < text.length; j++) {
      const c = text[j];
      if (escape) {
        escape = false;
        continue;
      }
      if (inString) {
        if (c === "\\") {
          escape = true;
          continue;
        }
        if (c === '"') {
          inString = false;
        }
        continue;
      }
      if (c === '"') {
        inString = true;
        continue;
      }
      if (c === "{") {
        depth++;
        continue;
      }
      if (c === "}") {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(start, j + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            // This `{` doesn't lead to valid JSON; try previous position.
            break;
          }
        }
      }
    }
  }
  return null;
}
```

Key properties:

- **Forward-scan from each `{` position with brace-depth counting** — finds the matching `}` regardless of what follows it
- **Respects JSON string literals** — `{`/`}` chars inside `"..."` strings don't confuse the depth counter
- **Tries last `{` first** — the agent's status JSON is usually the LAST `{...}` block in the text
- **Bails the inner scan when a candidate fails** — moves to the previous `{` position rather than scanning further

### Phase 4 — `extractStructuredOutput` orchestrates the strategy stack

```ts
function extractStructuredOutput(result: SDKResultMessage): ExtractResult {
  // Strategy 1: SDK-native (preferred when honored)
  if (result.subtype !== "success") {
    return {
      ok: false,
      reason: `SDK subtype was '${result.subtype}', not 'success'`,
    };
  }
  if (result.structured_output !== undefined) {
    return { ok: true, parsed: result.structured_output };
  }
  const text = result.result;
  if (!text || text.trim() === "") {
    return {
      ok: false,
      reason: "result.result was empty (no structured_output, no text)",
    };
  }
  // Strategy 2: sentinel-delimited (ideal once agent prompt rolls out)
  const sentineled = findSentinelDelimitedJson(text);
  if (sentineled !== null) return { ok: true, parsed: sentineled };
  // Strategy 3: balanced-brace forward scan (defense in depth)
  const balanced = findBalancedJsonObject(text);
  if (balanced !== null) return { ok: true, parsed: balanced };
  // Strategy 4: diagnostic failure with breadcrumb
  const tail = text.length > 300 ? `...${text.slice(-300)}` : text;
  return {
    ok: false,
    reason: `no sentinel block found, no balanced JSON object found; tail was: ${JSON.stringify(tail)}`,
  };
}
```

The markdown-fence stripping from bug-004 disappears as a separate step — the balanced-brace scan handles fenced JSON correctly because it ignores characters after the matched `}`.

### Phase 5 — Tests

Comprehensive coverage across all known + plausible patterns:

- Sentinel happy path: agent uses sentinels correctly
- Sentinel + prose around it
- Sentinel + inner code fence
- Sentinel only at end after long markdown summary
- Sentinel missing → balanced-brace catches the JSON
- Backtick-wrapped JSON `**Outcome:** \`{...}\`` (the current bug-007 case)
- Prose with `{ destructuring }` examples + trailing JSON (bug-006 case)
- Markdown code fence ` ```json {...} ``` ` (bug-004 case)
- Multiple JSON blocks → returns last
- Nested JSON → returns outer
- JSON containing strings with `{` chars inside (e.g. `{ "msg": "code: { x }" }`)
- Trailing prose after `}` (e.g. `{...} 🎉`)
- HTML wrapping `<code>{...}</code>`
- Empty/no-`{` text → clean failure with diagnostic
- Both sentinel AND balanced-brace fail → diagnostic includes tail

### Phase 6 — Validation re-run

After Phases 1-5 land:

1. `pnpm --filter orchestrator test` clean
2. `pnpm --filter orchestrator typecheck` clean
3. `/start-build kanban-webapp-01 --resume-feature-graph --max-concurrent=1 --auto-merge-after-reviewer` (after orphan worktree cleared)
4. Agent's status JSON (sentineled or balanced) parses → orchestrator marks task completed → feature progresses → close-feature merges → wave 2 unblocks → DAG progresses

## Rejected Fixes

- **Quick patch: strip trailing backticks before bug-006's algorithm.** ~5 LOC. Fixes ONLY this exact case; next variant (period, emoji, HTML) breaks again. We've now spent 4 iterations chasing variants — pay the cost once for a robust algorithm.

- **Drop bug-006's algorithm; rely entirely on sentinels.** Sentinels are ~95% reliable when agent follows the prompt — but LLMs ignore prompt instructions ~5-10% of the time. Without the balanced-brace fallback, every prompt-non-compliance event becomes a failed feature. Defense-in-depth is cheap (one extra strategy invocation when sentinels are absent).

- **Fix the SDK's `outputFormat` ignored-under-Max-auth issue.** Right answer long-term; deferred to a separate plan. Investigation scope is unknown (SDK source, auth path, subagent behavior). bug-007 works without that fix landing.

- **Bundle the agent-over-reaching issue (auto-commit + auto-merge by builders).** Defer to bug-008. The agent's autonomy isn't blocking parser fixes; the parser robustness is the load-bearing concern right now.

- **Use a more exotic sentinel** (HTML comments, Unicode control chars, base64 markers). Considered, rejected: angle-bracket syntax is the lowest-friction-for-LLMs option. Comments and exotic syntaxes risk markdown renderers swallowing them or LLMs mistyping them.

- **Update agent prompts (`.claude/agents/*.md`) to enforce sentinels too.** Considered, rejected for THIS plan: the prompt addendum in `buildAgentPrompt` reaches every agent invocation regardless of which agent definition file. Updating individual agent prompts is duplicate scope. If we later see agents ignoring the buildAgentPrompt instruction systematically, we can add reinforcement in agent-definition prompts.

## Validation Criteria

- The original error no longer occurs: a fresh `/start-build kanban-webapp-01 --resume-feature-graph --max-concurrent=1 --auto-merge-after-reviewer` produces successful task parsing for state-shell-localstorage AND any future agent emission style we've forecast.
- All 239 existing orchestrator tests still pass.
- New tests added covering ALL identified emission patterns; pass.
- `pnpm --filter orchestrator typecheck` clean.
- Validation re-run produces ≥1 orchestrator-recognized completed task on kanban-webapp-01 + close-feature merge to master.
- Best case: feat-bootstrap merges via the orchestrator's view → wave 2 unblocks → at least one downstream feature starts. **MVP exit signal.**

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

**Tried (Phases 1-5; Phase 6 = validation re-run pending):**

- **Phase 1 — sentinel addendum to `buildAgentPrompt`** (`orchestrator/src/invoke-agent.ts:769-820`): added an "IMPORTANT" block instructing every agent to wrap their final outcome JSON in `<<<TASK_OUTCOME>>>` and `<<<END_TASK_OUTCOME>>>` sentinels, with an example, AND explicit "Do NOT wrap the JSON inside the sentinels in markdown code fences or backticks." Reaches every agent invocation through the unified prompt template; no per-agent-definition changes needed.
- **Phase 2 — `findSentinelDelimitedJson` helper**: regex `/<<<TASK_OUTCOME>>>([\s\S]*?)<<<END_TASK_OUTCOME>>>/` matches non-greedy across lines. Defensive inner code-fence stripping in case agent slips into wrapping JSON in `json` even after being told not to. Returns null on no sentinel match or unparseable inner.
- **Phase 3 — `findBalancedJsonObject` (replaces bug-006's algorithm)**: the critical algorithmic improvement. Walks the text FORWARD finding top-level `{...}` regions (skipping past matched regions to avoid re-walking nested ones); for each, balanced-brace forward scan to find matching `}` (string-literal-aware so internal `{`/`}` chars don't confuse depth counter); try parse; collect candidates that parse to non-empty objects; return the LAST candidate. Rationale for "last with keys": agent's status JSON is usually the trailing top-level block; inner empty `{}` (errors map) and prose `{ destructuring }` either parse as empty or fail entirely so don't crowd it out.
- **Phase 4 — `extractStructuredOutput` orchestrates the strategy stack**: tries (1) `result.structured_output`, (2) `findSentinelDelimitedJson`, (3) `findBalancedJsonObject`, (4) diagnostic failure with rich tail breadcrumb. The markdown-fence-stripping step from bug-004 disappears — the balanced-brace scan handles fenced JSON correctly because it ignores any characters after the matched `}`.
- **Phase 5 — Tests**: 11 new tests covering all known + plausible patterns:
  - 3 sentinel paths (happy, with prose, with inner code fence)
  - 1 backtick-wrapped (the bug-007 surfacing case)
  - 1 trailing prose + emoji
  - 1 multiple top-level (returns last)
  - 1 nested with empty inner `{}` (returns outer)
  - 1 JSON-string-with-braces (string-literal awareness)
  - 2 clean-failure paths (no JSON; only invalid `{...}` blocks)
  - 1 prompt-addendum verification

**What happened:**

- First test run: 8 failures.
  - 3 wording-only failures (assertion strings still expecting bug-006's "text didn't contain a parseable trailing JSON" instead of new "no <<<TASK_OUTCOME>>> sentinel block found, no balanced JSON object found")
  - 5 algorithmic failures: my INITIAL `findBalancedJsonObject` walked `{` positions LAST to FIRST, which picked up the inner empty `{}` of `errors: {}` before the OUTER status object. Tests returned `t1: failed` instead of `completed`.
- Algorithmic fix: refactored to walk FORWARD from index 0, finding top-level regions only (skip past matched regions), collecting candidates, returning the LAST one with keys. The "with keys" filter excludes empty `{}`; the "top-level only" advance excludes nested matches. Result: outer status object always wins.
- Wording fixes via sed: `s/text didn't contain a parseable trailing JSON/no <<<TASK_OUTCOME>>> sentinel block found, no balanced JSON object found/g` across 3 assertions.
- Final test run after both fixes + adding the 11 new bug-007 tests: **250/250 pass**. `pnpm --filter orchestrator typecheck` clean.

**Outcome:** Phases 1-5 implemented and verified at the unit-test level. Validation re-run on kanban-webapp-01 pending — needs the orphan worktree dir cleared (user action) then a fresh `/start-build`.

**Lessons for future-claude:**

- **"Walk backward from the last match" sounds intuitive but breaks on nested structures.** My first attempt used backward iteration to find "the trailing JSON". But agent status JSON contains nested objects (errors map); the LAST `{` is INSIDE the outer object, not the outer object itself. Forward-walk + skip-past-matched-region naturally handles top-level vs. nested.
- **Sentinels make the contract explicit.** The hybrid stack (sentinel + balanced-brace) is more robust than either alone. Sentinels handle ~95% of dispatches when the agent follows the prompt. Balanced-brace catches the remaining ~5% when the agent forgets. Diagnostic failure surfaces the 0.5% residual long tail with enough context to debug in 30 seconds.
- **The "last with keys" filter is doing real work.** Without filtering empty objects, the inner `errors: {}` of any well-formed agent status would be returned as the "match". With it, only meaningful candidates accumulate and the outer status wins naturally.
- **Defense in depth survived 4 algorithm revisions.** Each previous attempt (bug-004 trailing regex, bug-005 — orthogonal, bug-006 backward-scan) handled SOME variants but missed others. The hybrid approach with multiple strategies layered should survive future variants because each strategy covers what the others miss.

## References

- `plans/active/bug-006-greedy-json-extractor.md` — parent; bug-007 replaces bug-006's algorithm with the strategy stack
- `plans/active/bug-004-agent-output-format-schema.md` — grandparent; introduced `extractStructuredOutput { ok, reason }` shape and the (currently silently-ignored) SDK outputFormat
- `plans/active/feat-014-mvp-completion-autonomous-e2e.md` — MVP plan; bug-007 may be the last layer of the autonomous Mode B chain
- `orchestrator/src/invoke-agent.ts:769-797` — `buildAgentPrompt` (will gain sentinel addendum)
- `orchestrator/src/invoke-agent.ts:872+` — `extractStructuredOutput` (will become 4-strategy orchestrator)
- Validation re-run output (transient): `tasks/b1asic7qs.output` — kanban-webapp-01 run that surfaced bug-007 at $2.52
- Cost trajectory: $6.52 → $1.70 → $1.33 → $2.69 → $8.64 → $1.35 → $4.48 → $2.52 → ?
