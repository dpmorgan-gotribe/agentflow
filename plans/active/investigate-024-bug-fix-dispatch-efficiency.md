---
id: investigate-024-bug-fix-dispatch-efficiency
type: investigation
status: completed
author-agent: human
created: 2026-05-08
updated: 2026-05-08
parent-plan: null
supersedes: null
superseded-by: null
branch: null
affected-files: []
feature-area: orchestrator/fix-bugs-loop
priority: P0
attempt-count: 0
max-attempts: 5
time-box-minutes: 240
hypothesis: |
  Per-bug builder dispatch is slow because the agent receives the bug
  entry + retry context but NOT the bug-specific situational context
  (synthesized spec, failing test output, suspected fix-site files).
  Builders spend 15-25 min PER CLAUDE TURN doing exploratory tool calls
  (Read/Grep/Bash) to discover what they need, before they can plan a
  fix. The 2-3 min/bug target is achievable only with a stripped-down
  "bug-fixer" agent whose dispatch pre-loads situation context, has a
  narrow tool set, and uses a system prompt focused on "patch this
  specific defect" rather than "implement a full feature."
---

# investigate-024 — bug-fix dispatch efficiency: hit 2-3 min/bug

## Question

Where do the 15-25 min between Claude turns go in per-bug builder
dispatches, and what factory changes would bring per-bug wall-clock
from 25-90+ min down to 2-3 min?

## Hypothesis

Per-bug dispatch latency is dominated by the agent's exploratory tool
calls. Each Claude turn is followed by 15-25 min of Read/Grep/Bash
work before the next turn fires. The agent does this exploration
because the dispatch envelope ships only:

- The bug entry (id, summary, errorLog, agentSequence)
- The retry context (last 3 errorLog entries)
- The agent's static system prompt (`.claude/agents/web-frontend-builder.md`,
  ~200+ lines of feature-build guidance)

But NOT:

- The synthesized spec content for flow-failure bugs
- The failing test's exact assertion + line number
- The mockup HTML for parity-divergence bugs
- The component file(s) most likely to need editing
- A "minimum-viable-context" decomposition of the bug

The system prompt is also wrong-shape: it's optimised for "build a
new feature using @repo/ui-kit primitives, ship tests + coverage" —
mostly irrelevant for a 5-line patch.

If true, the 2-3 min target requires:

1. **Pre-loaded context** in the dispatch envelope (H2)
2. **Narrowed scope hint** ("the failing locator + likely fix-site") (H3)
3. **Smaller agent prompt** focused on "patch defect" (H5)
4. **Per-bug dispatch** (regress feat-061 batching for parity) (H4)
5. Plus orthogonal: bug-074 (clearer plan body), feat-060 (MCP lifecycle)

## Empirical anchor

reading-log-02 /fix-bugs run b0e1281c, paused 2026-05-08T04:10
after ~2hr observation:

| Metric                            | Observed                                                    | Target  |
| --------------------------------- | ----------------------------------------------------------- | ------- |
| Bugs resolved                     | 4 / 15                                                      | ≥13     |
| Wall-clock per bug                | 25-90+ min                                                  | 2-3 min |
| API calls per dispatch (median)   | 3-5                                                         | 1-2     |
| Avg gap between Claude turns      | 15-25 min                                                   | <60s    |
| Wall-clock-1500000ms aborts       | 6× layout-regrouping batch (1×), 6× retry (1×), flow-4 (1×) | 0       |
| Empty-merge attempts (att 1 fail) | 5 / 5 flow bugs                                             | <1 / 5  |
| seven_day quota burn (run total)  | ~5 percentage points (78%→84%)                              | <2pp    |

**Resolved bugs took these paths:**

- `flow-3` (iter 2, att 1): single dispatch shipped 9-file commit
  `f0c0b0b fix(web): use string IDs throughout`. The builder figured
  out the Number(id)→CUID issue from the seeded fixture. ~25 min wall.

- `flow-1` (iter 3, att 2): att 1 was empty-merge; att 2 shipped
  `edafed5 fix(e2e): use seed-db helpers in flow-1 beforeAll/afterAll`.
  ~25 min wall × 2 attempts = 50 min total.

- `flow-2` (iter 3, att 2): same shape — att 1 empty-merge, att 2
  shipped `f1d31f2 fix(e2e): correct flow-2 selector and URL pattern;
fix api-client base URL fallback`. The api-client fix is real
  product code, not just spec. ~50 min total.

The pattern is clear: **att 1 is exploration, att 2 is execution**.
The dispatch envelope doesn't give the agent enough context to do
both in a single attempt. Halving the attempt count (target: ship in
att 1) is what gets us to 2-3 min territory IF we also slash the
exploration time per attempt.

## Investigation Steps

### Step 1 — Per-attempt token + tool-call census (45 min)

Reconstruct what each builder dispatch actually DID. We have:

- `rate-limit-events.ndjson` — per-API-call timestamp + utilization
- Orchestrator stdout — keepalive warnings + dispatch boundaries
- Per-bug worktree git log — what commits actually landed
- bugs.yaml errorLog — failure shapes per attempt

Goals:

- For each bug × attempt: count Claude API calls, count keepalive
  pings (proxy for tool-call activity gaps), count commits.
- Compute `apiCalls / wallClockMin` ratio per attempt.
- Identify outliers: dispatches with very few API calls (suggests
  long tool-call gaps) vs many API calls (suggests tight loops).

If the SDK telemetry includes per-call duration / tokens, dump that
too. If not, that's a gap we should also fix (separate plan).

### Step 2 — Inspect the dispatch prompt verbatim (30 min)

Read `orchestrator/src/invoke-agent.ts::buildAgentPrompt` (line ~1640
per earlier inspection). Trace what the builder receives:

```
You are the {agent} agent for feature {featureContext.id}
(branch {featureContext.branch}, priority {featureContext.priority}).
Tasks assigned to you on this feature:
{taskLines}

[IF retryContext]
Retry context — prior attempt failed:
{taskId}: {errorMessage}
[END]

Your working directory is the feature worktree...
{sentinel-output instructions}
```

For a known-resolved bug (flow-3), reconstruct the prompt verbatim.
Compare against a hypothetical "minimum-viable-context" prompt:

```
Bug: flow-3 ("Edit notes" E2E flow fails at step 1 — locator
'role=link[name=/Project Hail Mary/i]' did not match)

Synthesized spec (apps/web/e2e/synthesized/flow-3.spec.ts):
{spec content, ~50 lines}

Failing test output:
{verifier capture: "locator.click: Test timeout 30000ms exceeded.
 Call log: waiting for locator('role=link[name=/Project Hail Mary/i]')"}

Likely fix-sites (most-recently-touched JSX matching the failing route):
- apps/web/app/page.tsx (renders /)
- apps/web/components/books/book-list-item.tsx (renders the link)

Required state per manifest:
{requiredState.fixtures.Book block}

Fix the bug. The spec must pass. Do not modify test files.
Commit with `fix(web): <one-line summary>`.
```

The minimum-viable prompt is ~5x denser. Estimate: with this prompt
the agent could often emit a 1-2-tool-call solution.

### Step 3 — Tool-call distribution for one resolved dispatch (30 min)

For flow-3 (the cleanest resolution case), if SDK message logs
exist, decompose the agent's run by tool. Even without per-call
logs, we can infer from the diff what the agent likely did:

flow-3's commit `f0c0b0b` touched 9 files. The agent had to:

- Read `apps/web/app/books/[id]/page.tsx` (the bug-site)
- Identify `Number(id)` is wrong
- Read 8 other files that depend on the ID type contract
- Edit each one
- Run typecheck (Bash)
- Run unit tests (Bash)
- Commit

Estimate: ~10 Reads, ~9 Edits, ~2-3 Bashes. With ~3 API calls (per
rate-limit data), the agent's per-turn ratio is ~7 tool calls per
turn.

A pre-loaded prompt could collapse "10 Reads" → 0 by providing the
relevant file contents up front. That's the H2/H3 leverage.

### Step 4 — Test the leverage hypotheses synthetically (60 min)

For 2-3 of the resolved bugs, draft a "bug-fixer" prompt template
that incorporates:

a. **Pre-loaded fix-site files** (top-3 most-likely files based on
the bug class)
b. **Verbatim failing-test output** (the exact selector / line
number / error message)
c. **Spec content** (for flow-failure) or **mockup HTML** (for
parity-divergence)
d. **Tight scope statement**: "patch this defect; do NOT refactor;
commit a 1-3 file change unless the bug genuinely spans more"

Estimate (without actually running): how many tool calls would each
of these dispatches need? Where could a 1-2-API-call solution emerge?

### Step 5 — Define the "bug-fixer" agent (45 min)

Concrete spec:

```
.claude/agents/bug-fixer.md
---
name: bug-fixer
description: Narrow-scope agent for /fix-bugs loop dispatches. Patches
  a single defect using pre-loaded fix-site context + the failing test
  output. Does NOT add tests, refactor surrounding code, or compose
  features. Optimised for 2-3 min/bug wall-clock.
tools: Read, Edit, Grep, Bash
model: inherit  # tier:building, effort:medium
permissionMode: acceptEdits
maxTurns: 8     # vs 30 for web-frontend-builder
effort: medium  # vs high
mcp_servers: [] # M-F continues
---

# Bug-Fixer — System Prompt

You patch ONE specific defect inside a per-bug worktree. The dispatch
envelope tells you:
- The bug ID + class (flow-failure | parity-divergence | runtime-error | ...)
- The failing test's exact error message + selector + spec path
- The 2-3 most-likely fix-site files (READ them first)
- The synthesized spec OR mockup that proves the defect

Your job: emit the smallest possible diff that makes the failing
artefact (spec / parity-verify / dev-server) pass. Commit with a
conventional commit message. Do NOT:
- Refactor unrelated code
- Add new tests (the fix-bugs loop's verify pass is the test)
- Touch files outside the implicated scope unless the bug spans
- Run pnpm install / typecheck / lint unless something genuinely fails

Maximum dispatch budget: ~8 turns, ~3-5 minutes wall-clock.

Output: sentineled JSON per existing contract.
```

Open questions for Step 5:

- Should bug-fixer use Sonnet 4-6 effort:medium or downgrade to Haiku
  4-5 effort:high? Empirical: investigate-019 showed Haiku struggling
  on subtle defects but is fine for plumbing fixes. Probably class-
  conditional: parity-divergence + runtime-error → Sonnet,
  dev-server-compile + reachability-orphan → Haiku.
- Should bug-fixer be tool-restricted (no Bash)? Pro: forces tighter
  scope. Con: can't run `git status`, can't verify edits with
  typecheck. Probably keep Bash but in `acceptEdits` mode where
  destructive ops are blocked.
- Should bug-fixer have a hard turn cap? Currently agents have
  `maxTurns: 30`; setting `maxTurns: 8` would force convergence or
  abort fast. Probably yes.

### Step 6 — Recommendation (30 min)

Synthesise findings into a phased ship plan. Each phase scored on
impact-per-effort:

1. **bug-074 fix** (already filed) — null-safe bug-plan body.
   Effort: ~1hr. Impact: 30-40% (kills att 1 confusion on null-screen-id bugs).

2. **Pre-loaded dispatch context** — orchestrator's `buildAgentPrompt`
   reads spec / mockup / suspected-fix-site files + injects them.
   Effort: ~3-4hr. Impact: 50-70% (collapses exploration time).

3. **bug-fixer agent** — new `.claude/agents/bug-fixer.md` +
   orchestrator routing for the bug-fix loop.
   Effort: ~3hr. Impact: 30-50% on top of (2). Tighter system prompt
   - smaller turn budget.

4. **Regress feat-061 batching** for parity bugs (split 6-bug batch
   into 6 per-bug dispatches). Each fits in 25-min wall-clock.
   Effort: ~30min (env var flip). Impact: 80% on parity wall-clock
   aborts (currently 100%).

5. **Class-aware model + effort** — Haiku for cheap classes
   (compile / orphan), Sonnet for harder. Effort: ~1hr. Impact: 20-30%
   on cheap-class wall-clock.

Ship order: 4 → 1 → 2 → 3 → 5. Cumulative impact target: 80-90%
reduction in per-bug wall-clock. Estimated 2-3 min/bug achieved
after (3) ships; (5) is polish.

### Step 7 — Validation criteria (out of scope, doc only)

After all 5 changes ship, re-run reading-log-02 /fix-bugs from
clean state and measure:

- Wall-clock per bug (target: median ≤3 min)
- API calls per dispatch (target: median 1-2)
- Att 1 success rate (target: ≥80%)
- Total run wall-clock for 15 bugs (target: ≤45 min)

If validation fails the targets, re-open this investigation OR file
a follow-up.

## Findings

### F1 — The dispatch envelope is dramatically thin (CONFIRMS H2 + H3)

The full prompt sent to web-frontend-builder for a flow-failure bug
contains exactly three things:

1. **System prompt**: `.claude/agents/web-frontend-builder.md` (204 lines,
   ~2K tokens). Mostly feature-build guidance: kit primitives, AppShell,
   testing-policy, stack-skill dispatch, etc. Almost none of it relevant
   to "patch this defect."

2. **Task lines** (`buildAgentPrompt` lines 1635-1646, `dispatchAgentsForBug`
   lines 1199-1213): just `agent` + `id` + `summary`. The `summary` is
   the verifier's auto-generated 1-liner — for null-screen-id bugs this is
   the literal `"clicked (no selector matched) on [data-screen-id="null"]..."`
   nonsense that bug-074 covers.

3. **Retry context** (`buildRetryContextMessage` line 974-1001): bug.id
   - bug.summary + flow context + last 3 errorLog entries + a one-line
     pointer to `bug.bugPlanPath`. This is ~10-15 lines of structured text.

**What the dispatch DOES NOT include:**

- The synthesized spec content (`apps/web/e2e/synthesized/flow-N.spec.ts` —
  136 lines for flow-3, a clean signal of what's expected)
- The mockup HTML (for parity-divergence bugs)
- The verifier's verbatim error output (failing locator, line number,
  assertion message — beyond the 1-liner summary)
- Any guess at fix-site files (no recently-touched-files heuristic, no
  "where did this bug class historically land?" hint)
- The `flow.requiredState` block from the manifest (which IS the bug's
  data contract for feat-050)

Total dispatch tokens: ~2-3K (system prompt + task lines + retry context).
Token budget for context-priming would comfortably absorb 5-10 files = 10-15K
tokens. We have headroom.

### F2 — Empirical wall-clock signature confirms exploration dominance (CONFIRMS H6 + indirectly H2)

Per-bug rate-limit-event timing (recent 2hr window post-resume):

| Bug                   | API calls | Wall (min)                | min/call | Outcome                 |
| --------------------- | --------- | ------------------------- | -------- | ----------------------- |
| flow-3 (att 1, won)   | 11        | ~25                       | ~2.3     | Resolved iter 2         |
| flow-1 (att 2, won)   | 4         | ~25                       | ~6.3     | Resolved iter 3         |
| flow-2 (att 2, won)   | 3         | ~25                       | ~8.3     | Resolved iter 3         |
| flow-4 (att 1+2)      | 5         | ~75                       | ~15      | wall-clock-1500000ms    |
| flow-5 (att 2)        | 2         | ~75                       | ~37      | empty-merge             |
| flow-6 (att 2)        | 3         | ~75                       | ~25      | empty-merge             |
| pattern-layout-of-6   | 5         | ~52 (1×) + ~25 (2×) = ~77 | ~15      | wall-clock × 2          |
| pattern-identity-of-2 | 4         | ~14 (1×) + 25 (2×) = ~39  | ~10      | wall-clock + parse-fail |

Pattern: **fewer API calls per minute = more time spent in tool calls**.
flow-3 (the resolved happy-path bug) had ~2.3 min/call — the agent kept
Claude busy with frequent state updates. flow-5 (empty-merge fail) had
~37 min/call — the agent spent enormous time between turns,
likely doing heavy Read/Grep/Bash exploration without finding the fix.

The "resolved" bugs share a pattern: a tight inner loop where the agent
finds the right fix-site early and iterates fast on it. The "stalled" bugs
share a pattern: the agent wandered exploring broad code surface area
without converging.

### F3 — flow-3's resolution shows the cost of exploration even on success (CONFIRMS H2 quantitatively)

flow-3's commit `f0c0b0b` (the Number(id) → string fix) modified 9 files:

```
apps/web/app/books/[id]/page.tsx              (THE bug-site)
packages/api-client/src/index.ts              (function signatures)
packages/types/src/index.ts                   (type definitions)
plus 6 test/component files updated for type contract
```

For the agent to land this commit it had to:

1. Read flow-3.spec.ts (136 lines) to see the failing interaction
2. Trace the test selector `role=link[name=/Project Hail Mary/i]` to a route
3. Read `apps/web/app/page.tsx` (the index — find the link)
4. Read `apps/web/components/books/book-list-item.tsx` (the link emitter)
5. Read `apps/web/app/books/[id]/page.tsx` (the destination)
6. Find `Number(id)` — recognize CUID incompatibility
7. Read `@repo/types` and `@repo/api-client` to understand the type contract
8. Edit ~5 source files
9. Read 4 test files to update fixture types
10. Edit those 4 test files
11. Run typecheck (Bash) to confirm
12. Commit

Estimate: ~10-12 Reads + ~9 Edits + ~1-2 Bashes = ~20+ tool calls.
With ~11 Claude API calls in 25 min, average ~2 tool calls per turn.
That's about as efficient as the current envelope allows.

If the dispatch had pre-included `flow-3.spec.ts` + `page.tsx` +
`@repo/types/index.ts`, the agent could have skipped Reads 1, 5, 7
(maybe 8 too) — collapsing to ~6-8 Reads + 9 Edits = ~15 tool calls.
At the same per-turn ratio that's ~7-8 turns instead of 11 → ~17 min
instead of 25. Real but modest win on a happy-path case.

The bigger win is on FAILED dispatches. flow-5/6 burned 75 min each
without committing — that's ~50 min of unfocused exploration that
pre-loaded context would have cut to ~15 min.

### F4 — Parity batches over-pack the wall-clock budget (CONFIRMS H4)

Pattern-layout-regrouping-batch-of-6 hit `wall-clock-1500000ms` (25 min)
on BOTH attempt 1 and attempt 2 of iter 3. The dispatch is asked to:

- Read 6 different mockup HTMLs
- Read the 6 corresponding rendered pages
- Compare DOM structure for each
- Edit 6 different JSX files
- Verify each (ideally)

In 25 min that's ~4 min/screen total. Realistic per-screen work for a
layout-regrouping fix (wrap children differently) is more like 5-10 min.
The batch is structurally over-packed.

Pattern-identity-contract-broken-batch-of-2 (only 2 bugs) succeeded on
the first call's reasoning but emitted malformed JSON on output —
unrelated failure mode but ALSO a 1-attempt-per-iter cost.

**Recommendation for parity:** ship feat-061's opt-out flag flip
(`FIX_BUGS_DISABLE_CLASS_BATCHING=1`). For the bug classes we've
empirically observed (parity in reading-log-02), per-bug dispatch
fits the budget where 6-bug batches don't.

### F5 — The system prompt is the wrong shape for bug fixing (CONFIRMS H5)

`.claude/agents/web-frontend-builder.md` is 204 lines optimised for
"build a new web feature inside a feature worktree using @repo/ui-kit
primitives, ship tests + 60% coverage". For a 1-line patch this is mostly
noise + can mislead the agent into over-scoping ("should I add a new test?
should I refactor the AppShell wrapper to be cleaner?").

A bug-fixer system prompt should be ~30-50 lines:

- "You patch ONE specific defect. Smallest possible diff."
- "Don't add tests, don't refactor. Just fix."
- Output contract (sentineled JSON, same as today)
- Hard turn cap suggestion ("if you're past 5 turns and haven't edited,
  state your blocker in the failed outcome JSON")

### F6 — H1 / bug-074 contributes but isn't the load-bearing fix

Even with bug-074 fixed (clear bug body), the agent still needs to discover
the spec / fix-site / mockup files via tool calls. bug-074 saves ~1-2
turns on confused exploration; pre-loaded context saves 5-10 turns.

Order: bug-074 is cheap polish that compounds with the bigger leverage.

### F7 — H7 (MCP cold-start) and H8 (model choice) are NOT load-bearing

H7: Process tree showed ONE Playwright MCP per ~3 dispatches (M-F partially
working) but the cold-start tax is at most ~2-3 min per dispatch — not the
15-25 min between turns. MCP is a constant overhead, not the bottleneck.

H8: Sonnet 4-6 effort:high is appropriate for the work. Haiku 4-5 might be
fast enough for compile/orphan classes but would miss subtle cross-package
defects (like the Number(id) flow-3 fix). A class-conditional model picker
is polish, not the core fix.

## Recommendation

Phased ship plan, ordered by impact-per-effort:

### Phase 1 — Disable class-batched parity (env flag flip) — ~30 min ⭐ FIRST

`FIX_BUGS_DISABLE_CLASS_BATCHING=1` for the next reading-log-02 retry.
Per-bug parity dispatches each fit the 25-min wall-clock budget.

**Impact:** 80%+ reduction in wall-clock-aborted parity attempts.
**Risk:** Regresses feat-061's "1 dispatch fixes N similar bugs" win for
bug classes where it still applies. Empirically that win didn't materialise
on reading-log-02 — the parity work was non-mechanical enough that
sequential per-bug dispatches outperform.
**Followup:** investigate when class-batching IS the right choice
(probably for shell-stripping which IS mechanical AppShell-wrap; not for
layout-regrouping which is per-page judgment).

### Phase 2 — bug-074 fix (null-safe plan body) — ~1 hr

Already filed as bug-074. Ships orthogonally. Eliminates the "Add a nav
on null" misdirection.

**Impact:** ~30% reduction on att-1 confusion for null-screen-id bugs.
Confirmed contributor, not load-bearing.

### Phase 3 — Pre-loaded dispatch context — ~3-4 hr ⭐ BIGGEST LEVERAGE

Modify `orchestrator/src/fix-bugs-loop.ts::buildRetryContextMessage` (or
add a new `buildBugContextEnvelope` helper) to attach the following per
bug class:

| Bug class           | Pre-load                                              |
| ------------------- | ----------------------------------------------------- |
| flow-failure        | flow.spec.ts content + flow.requiredState block       |
| parity-divergence   | mockup HTML + the page-render JSX file                |
| reachability-orphan | the orphan file + 2-3 suggestedImporters file content |
| dev-server-compile  | the verifier's stderrTail + the suspected config file |
| runtime-error       | runtime-errors attachment + likely page.tsx           |

The envelope grows from ~600 tokens to ~10-15K tokens — well within
Sonnet's 200K context.

**Impact:** 50-70% reduction in per-bug wall-clock. Removes 5-10
exploratory Reads per dispatch. Most bugs would resolve in att 1.

**Implementation:** new helper `buildBugContextEnvelope(bug, projectRoot)`
that reads the right files based on `bug.source`, formatted as:

```
## Pre-loaded context

### Failing test
File: apps/web/e2e/synthesized/flow-3.spec.ts
Lines: <full content>

### Required DB state (from manifest)
{
  "kind": "custom",
  "fixtures": { "Book": [{ "id": "flow-3-hail-mary", ... }] }
}

### Likely fix-site files
File: apps/web/app/books/[id]/page.tsx
Lines: <full content, ~80 lines>

File: packages/types/src/index.ts
Lines: <full content, ~50 lines>
```

Then `buildAgentPrompt` injects this BEFORE the task lines.

### Phase 4 — bug-fixer agent — ~3 hr

New `.claude/agents/bug-fixer.md` (~50 lines, system prompt focused on
"patch defect, don't refactor, smallest diff"). Replaces
`web-frontend-builder` + `backend-builder` + `mobile-frontend-builder` in
`defaultAgentSequence` for the fix-bugs loop ONLY (Mode B feature builds
keep their original tier-specific builders).

Routing change: `scripts/file-bug-plan.mjs::defaultAgentSequence` returns
`["bug-fixer"]` for bug classes that previously routed to a tier-specific
builder. The bug-fixer system prompt internally branches on bug class for
file-write conventions.

Frontmatter spec:

```yaml
name: bug-fixer
description: Narrow-scope patch agent for /fix-bugs loop. Pre-loaded
  with fix-site context; emits the smallest possible diff to clear the
  failing artefact. Does NOT add tests, refactor, or touch out-of-scope
  files.
tools: Read, Edit, Grep, Bash
model: inherit
permissionMode: acceptEdits
maxTurns: 8
effort: medium
mcp_servers: []
```

**Impact:** 30-50% additional reduction on top of Phase 3. Tighter prompt
keeps the agent from over-exploring even with pre-loaded context.

### Phase 5 — Class-aware model + effort — ~1 hr

Override `model-config` for the bug-fixer agent based on bug class:

| Bug class           | Model             | Effort | Rationale                           |
| ------------------- | ----------------- | ------ | ----------------------------------- |
| dev-server-compile  | claude-haiku-4-5  | medium | Plumbing fixes; Haiku is enough     |
| reachability-orphan | claude-haiku-4-5  | medium | Wiring fixes; mechanical            |
| visual-parity       | claude-sonnet-4-6 | high   | Layout judgment needs Sonnet        |
| flow-failure        | claude-sonnet-4-6 | high   | Often touches type/contract code    |
| runtime-error       | claude-sonnet-4-6 | medium | Stack-trace reading + targeted edit |
| build-gap           | claude-sonnet-4-6 | high   | Real feature work; full Sonnet      |

Implement via the existing per-agent `model:` frontmatter pattern, or
extend bug-fixer to accept a "tier hint" in its dispatch envelope.

**Impact:** 20-30% on cheap-class wall-clock + meaningful cost reduction
(~80% less Sonnet spend on plumbing fixes).

### Cumulative target

After all 5 phases:

| Metric                    | Current   | After Phase 1-2 | After Phase 3 | After Phase 4-5 |
| ------------------------- | --------- | --------------- | ------------- | --------------- |
| Median wall-clock per bug | 25-35 min | 15-20 min       | 5-8 min       | **2-3 min**     |
| Att 1 success rate        | ~30%      | ~40%            | ~70%          | ~85%            |
| Wall-clock-aborts per run | 6-8       | 1-2             | 0             | 0               |
| 15-bug run total          | ~3-5 hr   | ~2 hr           | ~45 min       | **~30 min**     |

Phase 4 is the line where the 2-3 min/bug target lands. Phases 1-3
deliver a usable factory; Phases 4-5 close the gap.

### Anti-patterns to avoid

Don't do these:

- Crank concurrency (bug-059 H4 already capped at 3)
- Make the bug-fixer auto-merge without verifier agreement (bug-055
  empty-merge guard is load-bearing)
- Bypass the orchestrator's per-attempt retry tracking (convergence
  detector + maxAttempts cap are correct)
- Skip the synthesized-spec read in pre-loaded context — it's the
  CANONICAL source-of-truth for what the bug expects

### Cross-references for the ship plan

Each phase should produce its own follow-up plan when scheduled:

- Phase 1: `bug-075-disable-class-batched-parity` (P0, ~30 min)
- Phase 2: `bug-074-…` (already filed, ~1 hr)
- Phase 3: `feat-063-pre-loaded-bug-fix-context` (P0, ~4 hr)
- Phase 4: `feat-064-bug-fixer-agent` (P0, ~3 hr; depends on feat-063)
- Phase 5: `feat-065-class-aware-bug-fixer-model` (P1, ~1 hr; polish)

### Out-of-scope (mentioned for completeness)

- **MCP M-F lifecycle** (feat-060) — tracked separately; Phase A
  investigation pending. Not a bug-fix-loop bottleneck.
- **investigate-019 H6** (Playwright cold-start) — same as above.
- **Per-bug worktree CRLF noise** — filed as docs/ideas.md item; not a
  performance issue (whitespace-only diffs aren't included in
  pre-loaded context).

## Attempt Log

(empty — plan filed by human 2026-05-08T04:10 mid /fix-bugs run
b0e1281c hard-pause. Investigation triggered by 2hr empirical
observation showing 4/15 bugs resolved at unsustainable cost.)

## Cross-references

- `bug-074` — misleading bug-plan body when screen-ids null
  (orthogonal but contributes; see H1)
- `feat-060` — MCP conditional + warm-pool (H7 captured here)
- `feat-062` — pure-verify routing (shipped — bug-fix loop is
  already 1-agent dispatch)
- `feat-061` — class-batched dispatch (shipped — H4 questions
  whether this still wins for current bug class)
- `investigate-019` — SDK keepalive stalls (M-D + M-F shipped;
  this investigation is the systemic next-step)
- `bug-073` — convergence detector (shipped Phase B; complementary)
- `feat-021` — PM agent-change-request mechanism (related — Phase D
  could ship a similar shape for new agents like bug-fixer)

## Anti-goal

This investigation should NOT propose "throw more concurrency at it".
bug-059 H4 (event-loop starvation) already proved 3-way parallel is
the sustainable cap. The 2-3 min target must come from making each
individual dispatch CHEAPER, not from running more in parallel.
