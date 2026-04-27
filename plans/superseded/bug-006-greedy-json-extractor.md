---
id: bug-006-greedy-json-extractor
type: bug
status: superseded
approved-at: 2026-04-26
approved-by: human
author-agent: claude-opus-4-7
created: 2026-04-26
updated: 2026-04-26
superseded-at: 2026-04-27
parent-plan: bug-005-windows-quoting-and-default-branch
supersedes: null
superseded-by: bug-007-robust-output-extraction
branch: fix/greedy-json-extractor
affected-files:
  - orchestrator/src/invoke-agent.ts
  - orchestrator/tests/invoke-agent.test.ts
feature-area: orchestration
priority: P0
attempt-count: 1
max-attempts: 5
error-message: |
  - "task <id> failed after 1 attempts: agent produced no parseable outcome JSON: JSON.parse threw on trailing-JSON match: Expected property name or '}' in JSON at position 2 (line 1 column 3); matched text was: \"{ boards, columns, cards, ... } — normalized with Record<id, entity> for O(1) lookups\\n- ...prose... \\n\\n{\\n  \\\"taskOutcomes\\\": { \\\"state-shell-localstorage\\\": \\\"completed\\\" }, \\\"errors\\\": {} }\""
reproduction-steps: |
  1. Apply bug-002, bug-003, bug-004, bug-005 fixes
  2. /start-build kanban-webapp --resume-feature-graph --max-concurrent=1 --auto-merge-after-reviewer
  3. The agent emits free-form prose containing JS-style `{ destructuring }` examples followed by a clean trailing JSON status block
  4. Observe: orchestrator's greedy regex /\{[\s\S]*\}\s*$/ matches from the FIRST { in the prose to the LAST }, swallowing prose between → JSON.parse fails at position 2 (`{ b` is invalid JSON) → task marked failed despite agent succeeding
stack-trace: null
---

# bug-006 — Greedy regex in `extractStructuredOutput` swallows prose containing `{...}`

## Bug Description

**Expected:** when an agent emits free-form prose followed by a trailing JSON status object, `extractStructuredOutput` finds the trailing JSON object and parses it.

**Actual:** the regex `/\{[\s\S]*\}\s*$/` is **greedy** — `[\s\S]*` matches as much as possible. When the agent's prose contains `{` characters (extremely common: JS destructuring examples like `{ boards, columns, cards }`, type-definition snippets like `{ Record<id, entity> }`, JSON examples in markdown), the regex matches from the FIRST `{` (in the prose) to the LAST `}` (in the trailing status JSON), swallowing all the prose in between. JSON.parse rejects the resulting concatenated text immediately at position 2 because the prose's destructuring uses unquoted keys (invalid JSON).

The agent's actual JSON is well-formed AND would parse successfully — the orchestrator's extractor never tries the right substring.

## Reproduction Steps

1. Apply bug-002 (`ff58d27`), bug-003 (`0d5a84d`), bug-004 (`37a9567`), bug-005 (`a0f618f`) fixes
2. Run `/start-build kanban-webapp --resume-feature-graph --max-concurrent=1 --auto-merge-after-reviewer`
3. The web-frontend-builder agent for `state-shell-localstorage` task naturally emits prose explaining its work (Zustand store with `{ boards, columns, cards, boardOrder, activeBoardId, theme, filter }` destructuring) followed by a clean JSON status block at the end
4. Observe orchestrator exit:
   - `task state-shell-localstorage failed after 1 attempts: agent produced no parseable outcome JSON: JSON.parse threw on trailing-JSON match: Expected property name or '}' in JSON at position 2 (line 1 column 3); matched text was: "{ boards, columns, cards, ... } — normalized with Record<id, entity> ... { "taskOutcomes": ... }"`
5. Inspect the project's master branch — **the agent actually completed the work, fixed its own typecheck/lint errors over 4 internal SDK turns, committed the result, AND merged feat/bootstrap → master autonomously**. The orchestrator just couldn't see the success signal.

## Error Output

From the orchestrator exit (2026-04-26 ~01:39Z UTC, pipeline run):

```
task state-shell-localstorage failed after 1 attempts: agent produced no parseable outcome JSON:
JSON.parse threw on trailing-JSON match: Expected property name or '}' in JSON at position 2 (line 1 column 3);
matched text was: "{ boards, columns, cards, boardOrder, activeBoardId, theme, filter } — normalized with Record<id, entity> for O(1) lookups\n- **`filter` is ephemeral**: excluded via `partialize`, never written to l...(61 chars elided)... tests**: 26 happy-path (builder) + 24 edge-case (tester) — all passing\n- **94.19% line coverage** across store\n\n{\n  \"taskOutcomes\": {\n    \"state-shell-localstorage\": \"completed\"\n  },\n  \"errors\": {}\n}"
```

The matched text contains TWO `{...}` blocks:

1. **Prose**: `{ boards, columns, cards, boardOrder, activeBoardId, theme, filter }` (JS destructuring example) — invalid JSON
2. **Status JSON** at end: `{ "taskOutcomes": { "state-shell-localstorage": "completed" }, "errors": {} }` — valid JSON

The greedy regex captures from the first `{` to the last `}`, producing one giant string that begins with the invalid prose and is therefore unparseable.

Filesystem evidence the agent succeeded:

```
$ git log --oneline projects/kanban-webapp
8ebb844 feat(bootstrap): merge feat/bootstrap → master   ← agent merged itself
0b30fed fix(reviewer): resolve TS typecheck + ESLint gate blockers   ← agent fixed lints
b4c586c chore: initialize project kanban-webapp from factory

$ git ls-tree -r master | grep apps/web/
apps/web/e2e/smoke.spec.ts
apps/web/eslint.config.mjs
apps/web/next.config.ts
apps/web/src/app/{layout,page,settings/page}.tsx
apps/web/src/components/theme-provider.tsx
apps/web/src/store/{kanban-store,kanban-store.test,kanban-store.edge.test}.ts
apps/web/src/test/setup.ts
apps/web/{playwright,postcss,tailwind,tsconfig,vitest}.config.* + package.json
```

50/50 tests passing, 94.19% coverage, lint + typecheck clean — all on master from this run.

## Root Cause Analysis

`orchestrator/src/invoke-agent.ts:850-859` (post-bug-004):

```ts
const jsonMatch = text.match(/\{[\s\S]*\}\s*$/);
if (!jsonMatch) {
  return { ok: false, reason: `text didn't end with parseable JSON object; tail was: ${...}` };
}
try {
  return { ok: true, parsed: JSON.parse(jsonMatch[0]) };
} catch (err) {
  // bug-006: ends up here when prose contains a leading `{` like `{ boards, ... }`
  return { ok: false, reason: `JSON.parse threw on trailing-JSON match: ${msg}` };
}
```

The regex `/\{[\s\S]*\}\s*$/` works correctly when the text ends with JSON AND contains no other `{` characters earlier. As soon as the agent's prose contains any `{`, the greedy `[\s\S]*` swallows everything between the prose's `{` and the trailing JSON's `}`.

LLM agents emit `{` characters very frequently in their prose:

- JS/TS destructuring examples: `{ user, posts, comments }`
- Type definitions: `Record<string, { id: number }>`
- React props: `<Component prop={{ key: value }}>`
- JSON examples in markdown
- Config snippets

So the bug fires on a substantial fraction of agent dispatches — anywhere prose precedes the status JSON.

### Secondary finding: bug-004's `outputFormat` is silently ignored

The agent emitted free-form prose + LEGACY `taskOutcomes: { ... }` shape — NOT the canonical `BuilderOutput` structure that bug-004's `outputFormat: { type: 'json_schema', schema: BuilderOutputJsonSchema }` should have enforced. Two possibilities:

1. The Claude Max subscription auth path bypasses the SDK's structured-output enforcement (it uses claude.ai infrastructure rather than the API)
2. The Agent SDK v0.2.0 declares `outputFormat` in its types but doesn't actually wire it through to the model

Either way, **the regex fallback is the load-bearing path in production right now** — `outputFormat` is a hint at best, not enforcement. Fixing the greedy regex is therefore the highest-value single change. The deeper investigation (why outputFormat doesn't take effect; whether it works under API auth; whether subagent dispatch loses outputFormat) deserves its own plan post-MVP.

## Fix Approach

Single-phase surgical fix to `extractStructuredOutput`'s text-fallback path: replace the greedy regex with a backward-scanning algorithm that finds the LAST balanced JSON object at the end of the text.

### Phase 1 — `findTrailingJsonObject` helper

File: `orchestrator/src/invoke-agent.ts`. Add a private helper (sibling to `extractStructuredOutput`):

```ts
/**
 * bug-006: find the last well-formed JSON object that ends the text.
 * Handles the common LLM emission pattern: prose (possibly containing
 * `{` chars from destructuring / type / JSON examples) followed by a
 * clean trailing status JSON block.
 *
 * Algorithm: collect indices of every `{` in the text, then try
 * `JSON.parse(text.slice(idx))` from the LAST `{` backward. First
 * successful parse wins. O(n) scans + O(k * n) parse attempts where
 * k = count of `{` chars (typically 1-5; very fast in practice).
 */
function findTrailingJsonObject(text: string): unknown | null {
  const trimmed = text.trimEnd();
  if (!trimmed.endsWith("}")) return null;
  const positions: number[] = [];
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === "{") positions.push(i);
  }
  // Walk from last `{` backward — first successful parse wins.
  for (let i = positions.length - 1; i >= 0; i--) {
    const candidate = trimmed.slice(positions[i]);
    try {
      const parsed = JSON.parse(candidate);
      // Must be an object (not number / string / null / array starting with {)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      /* try next position */
    }
  }
  return null;
}
```

Then update `extractStructuredOutput`'s fallback path to use it:

```ts
const parsed = findTrailingJsonObject(text);
if (parsed === null) {
  const tail = text.length > 200 ? `...${text.slice(-200)}` : text;
  return {
    ok: false,
    reason: `text didn't contain a parseable trailing JSON object; tail was: ${JSON.stringify(tail)}`,
  };
}
return { ok: true, parsed };
```

The old `JSON.parse threw on trailing-JSON match` failure path goes away — the new algorithm tries multiple candidates and only fails if NONE parse. The diagnostic when it does fail still includes the tail (so future debug stays cheap).

### Phase 2 — Tests

File: `orchestrator/tests/invoke-agent.test.ts`. Add tests covering:

- **Happy path**: text with prose containing `{` chars + clean trailing JSON → finds the JSON. Use the literal kanban-webapp message from the bug as a fixture (the destructuring example + actual status block).
- **Backward-scan correctness**: text with multiple `{` blocks where only the last one is valid JSON → returns the last one.
- **Nested JSON**: `{"foo": {"bar": 1}}` → returns the outer object, not the inner.
- **No trailing brace**: text ending in prose without any `}` → returns null with precise reason.
- **All `{`s lead to invalid JSON**: text with multiple destructuring examples but no real JSON → returns null.
- **Markdown fence still works**: text ending in `json {valid} ` → fence stripped (existing bug-004 behavior preserved) THEN findTrailingJsonObject succeeds.
- **Single-`{` happy path**: backward-compat with simple cases where the first `{` IS the JSON (most existing tests fall in this case).

### Phase 3 — Validation re-run

After Phases 1-2 land:

1. Confirm `pnpm --filter orchestrator test` passes (existing 233 + new tests).
2. Re-fire `/start-build kanban-webapp --resume-feature-graph --max-concurrent=1 --auto-merge-after-reviewer` (after orphan worktree cleared).
3. Watch for: state-shell-localstorage's status JSON parses successfully → orchestrator marks task `completed` → feature progresses through agent_sequence → close-feature merges → wave 2 unblocks → DAG progresses.
4. Best case: feat-bootstrap + 1+ downstream features complete autonomously = MVP exit signal.

## Rejected Fixes

- **Make the regex non-greedy: `/\{[\s\S]*?\}\s*$/`.** Wrong direction. Non-greedy matches the FEWEST chars between first `{` and the next `}` — would match the first `{...}` block, which is the prose example (e.g., `{ boards, columns }`). Same parse failure, different position.

- **Strip the prose entirely with a heuristic** (e.g., "remove everything before the last `\n\n{`").\*\* Brittle: agents don't consistently use blank lines before status JSON. The backward-scan algorithm is more robust because it lets JSON.parse be the validator.

- **Force the agent prompt to NEVER emit `{` in prose.** Impossible to enforce — agents naturally emit code examples + destructuring + types. Even with strict prompts, models slip ~5-10% of the time. Schema enforcement at the SDK boundary IS the right answer (bug-004's intent), but until SDK + auth-mode behavior changes, the orchestrator must be robust against natural LLM output.

- **Wrap the agent's response in a sentinel** (e.g., `<<<STATUS>>>{...}<<<END>>>`) and parse between sentinels.\*\* Considered, rejected for now: requires updating all 5+ agent prompts (builder × 3, tester, reviewer) AND the parser, and creates a new contract surface that can drift. The backward-scan algorithm is invisible to agents — works regardless of what the agent emits.

- **Investigate why `outputFormat` doesn't take effect (bypass the regex entirely).** Worth doing post-MVP, deferred to a separate plan. The greedy-regex fix here is small and high-value; the SDK-introspection investigation is its own scope (Claude Max subscription path, v0.2.0 SDK behavior, subagent context). Both can land independently.

- **Bundle the agent-over-reaching issue (agent ran tester+reviewer+merge by itself, beyond its scope).** Defer to a future plan. The over-reach got us further than expected this round; correcting it requires re-thinking the agent-prompt/orchestrator contract more carefully and isn't blocking.

## Validation Criteria

- The original error no longer occurs: a fresh `/start-build kanban-webapp --resume-feature-graph --max-concurrent=1 --auto-merge-after-reviewer` produces successful task parsing for state-shell-localstorage (and any other task whose agent emits prose-with-braces).
- All 233 existing orchestrator tests still pass.
- New tests added for `findTrailingJsonObject`'s backward-scan behavior; pass.
- `pnpm --filter orchestrator typecheck` clean.
- Validation re-run produces orchestrator-recognized successful task completion(s) — feat-bootstrap merges via orchestrator (NOT via the agent doing it itself), or at least gets marked `completed` by the orchestrator.
- Best case: feat-bootstrap completes per the orchestrator's view + 1+ dependent features unblock and start = MVP exit signal.

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

**Tried (Phases 1, 2; Phase 3 = validation re-run pending):**

- **Phase 1 — `findTrailingJsonObject` helper + `extractStructuredOutput` integration** (`orchestrator/src/invoke-agent.ts`):
  - Replaced the greedy `text.match(/\{[\s\S]*\}\s*$/)` regex with a call to a new `findTrailingJsonObject(text)` helper
  - Algorithm: trim trailing whitespace; bail if not ending in `}`; collect all `{` positions; walk them from LAST to FIRST trying `JSON.parse(text.slice(idx))`; first successful parse wins
  - Returns `unknown | null`; `null` when no `{` position yields valid JSON
  - Updated the failure-reason wording from "text didn't end with parseable JSON object" → "text didn't contain a parseable trailing JSON object"
  - Removed the now-obsolete `JSON.parse threw on trailing-JSON match` failure path (the new algorithm tries multiple candidates before giving up)
- **Phase 2 — Tests** (`orchestrator/tests/invoke-agent.test.ts`):
  - Updated 1 existing bug-004 test assertion to match the new error wording
  - Added 6 new bug-006 tests:
    - Happy path: prose with `{ boards, columns, ... }` destructuring + trailing JSON → finds the JSON
    - Multiple `{...}` blocks where only the last is valid → returns the last
    - Nested JSON object → returns outer object verbatim
    - No trailing `}` → null with precise reason
    - All `{` positions yield invalid JSON → null with precise reason + tail breadcrumb
    - Markdown fence + JSON inside → fence-strip works (bug-004 preserved) AND backward-scan finds the JSON

**What happened:**

- First test run after Phase 1: 232/233 pass; 1 bug-004 test failed because its assertion expected the old error wording. Updated the assertion to match new wording.
- Second test run after fixing the assertion: 233/233 pass.
- Third test run after adding the 6 new bug-006 tests: **239/239 pass** on first try.
- `pnpm --filter orchestrator typecheck`: clean.

**Outcome:** Phases 1 + 2 implemented and verified at the unit-test level. Validation re-run on kanban-webapp pending — needs the orphan worktree dir cleared (user action, then a fresh `/start-build`).

**Lessons for future-claude:**

- **Greedy regex + LLM output = fragile.** Any `[\s\S]*` (or `.*` with `dotAll`) pattern bracketed between two characters that the model might emit in prose (curly braces, square brackets, quotes, parens) is a debt waiting to surface. The right pattern when extracting structured data from natural-language output is "try multiple candidate slices and let the parser validate". The cost of trying 5 candidates is microseconds; the cost of failing on a good output is dollars + hours of confused debugging.
- **The bug-004 diagnostic enrichment paid for itself.** The prior "agent produced no parseable outcome JSON" was a $6+ debug session (manual filesystem archaeology to figure out what the agent emitted). Bug-004's tail breadcrumb + bug-006's `matched text was: ...` enrichment gave us the EXACT prose string in the failure message — the next bug surfaced as "ah, here's the destructuring example mid-prose" instead of "what is happening". Diagnostic enrichments compound.
- **Sometimes the agent succeeds harder than the orchestrator can see.** This run's agent did the entire feature autonomously (web-frontend-builder + tester + reviewer roles, 4 SDK turns, lint+typecheck fixes, commit + merge to master) — the orchestrator marked it failed because of a parser bug. The agents are more capable than the dispatch layer assumes. Worth a future plan (deferred bug-007) to either (a) reign in agent scope to fit the orchestrator's task-by-task model, OR (b) embrace the agent's autonomy and have the orchestrator track higher-level outcomes ("did the feature merge?") rather than lower-level ones ("did this specific task report success?").

## References

- `plans/active/bug-005-windows-quoting-and-default-branch.md` — parent bug; bug-006 surfaced cheaply ($1.35) because bug-005 unblocked the per-task-commit + close-feature paths. The diagnostic patch on bug-004's failure-detail enrichment let me see the actual matched text for the first time.
- `plans/active/bug-004-agent-output-format-schema.md` — grandparent; introduced the `extractStructuredOutput` { ok, reason } shape that bug-006 extends with a smarter algorithm
- `plans/active/feat-014-mvp-completion-autonomous-e2e.md` — MVP plan; bug-006 may be the last layer of the autonomous Mode B chain
- `orchestrator/src/invoke-agent.ts:846-870` — `extractStructuredOutput`'s fallback regex (the defective greedy match)
- Validation re-run output (transient): `tasks/bt7e8peyl.output` — the failed run that surfaced the bug at $1.35
- Project master post-bug-005-run: `projects/kanban-webapp` HEAD `8ebb844` (the agent's merge commit) — proof the agent's work is sound; only the orchestrator's parser is the bottleneck
