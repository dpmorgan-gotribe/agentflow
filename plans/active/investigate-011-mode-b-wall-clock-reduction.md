---
id: investigate-011-mode-b-wall-clock-reduction
type: investigation
status: draft
author-agent: claude-opus-4-7
created: 2026-04-29
updated: 2026-04-29
parent-plan: null
supersedes: null
superseded-by: null
branch: null
affected-files: []
feature-area: orchestration
priority: P1
attempt-count: 0
max-attempts: 5
time-box-minutes: 45
hypothesis: "Mode B wall-clock time has reduction levers analogous to feat-031's prompt-cache cost wins (3-5× cost cut empirically). Probable largest contributors: (a) sequential agent_sequence within a feature (builder → tester → reviewer hard-serialized when security + tester COULD run in parallel; reviewer COULD start speculatively while next feature's checkout begins); (b) per-task serialization within a builder dispatch (5-7 tasks fire as one Sonnet turn-bundle that does them sequentially when many have no inter-task deps); (c) mechanical tasks (scaffold-fastapi, scaffold-next-app) running on Sonnet when Haiku would be 2-3× faster + cheaper; (d) per-feature pnpm install (feat-019) taking minutes when most features touch zero new deps; (e) reviewer wall-clock dominated by re-reading SKILL.md + diff that's already cached. Combined estimate: 30-50% wall-clock reduction across (b)+(c)+(d) with low-risk implementation."
---

# investigate-011 — Mode B wall-clock reduction (analog of feat-031's cost win)

## Question

**Where does Mode B wall-clock time actually go, and what are the
top 3 reduction levers ranked by effort vs. estimated savings — so
we can replicate feat-031's 3-5× cost win on the time axis?**

Falsifiable subquestions:

1. What's the breakdown of a typical feature's wall-clock between
   (a) checkout-feature, (b) builder dispatch, (c) tester dispatch,
   (d) reviewer dispatch, (e) close-feature, (f) pnpm install, and
   (g) waiting-on-bucket-or-stall? Empirical answer from
   repo-health-dashboard-01's in-flight run + kanban-09 archive.
2. Are there agent_sequence steps that COULD run in parallel
   (security + tester both read builder output but don't conflict;
   reviewer + next-feature checkout-feature)?
3. Do mechanical tasks (scaffold-\*, package.json edits) get tiered
   down to Haiku, or are they running on Sonnet? Per-task model
   tiering may be available but unused.
4. What fraction of wall-clock is `pnpm install` that could be
   short-circuited by symlinking the factory's virtual store
   instead of fresh-installing per worktree?
5. Is there a "cache warmup" win — run a 1-token prompt at
   orchestrator startup so the first real dispatch already has
   the prompt-cache prefix loaded?

## Hypothesis

**Largest contributors** (ranked by gut, validated in step 4):

1. **Per-task serialization within a builder dispatch** — A feature
   has 5-7 tasks. The orchestrator dispatches the BUILDER ONCE per
   feature, the agent reads its task list, and works through tasks
   sequentially in turn-by-turn execution. Tasks with no
   inter-deps (e.g., scaffold-fastapi + in-memory-cache, both
   depend on root scaffold) could be authored in parallel from
   parallel tool calls within the same agent turn. The agent
   already CAN call multiple tools concurrently — but the
   prompt's task list reads as "do A, then B, then C" rather
   than "do A and B in parallel where deps allow". Big lever.

2. **Sequential agent_sequence** — Within a feature:
   `builder → tester → reviewer` (or `+security`). builder MUST go
   first (writes code). tester SHOULD go second (reads code).
   reviewer ALSO reads code — could run in parallel with tester
   on the same worktree. security ALSO reads code — could run
   parallel to tester. We currently serialize all of them.

3. **Mechanical tasks running on Sonnet** — `scaffold-fastapi`,
   `scaffold-next-app`, `gha-ci-pipeline` are template-author
   work. Sonnet is overkill (deep reasoning for boilerplate).
   Per-task `model: claude-haiku-4-5` overrides in tasks.yaml
   could cut these tasks' wall-clock 2-3× AND save 5-10× cost
   (already partially captured by feat-031 caching).

4. **`pnpm install` per-worktree** — feat-019 install-discipline
   runs `pnpm install` whenever package.json changes in a
   worktree. Each install is 30-90s. Most features touch zero
   new deps but still trigger it. Symlinking the factory's
   `node_modules/.pnpm/` into the worktree (post-checkout-feature)
   could eliminate the install for non-dep-changing features.

5. **Cache warmup** — feat-031 caching needs 1 dispatch per
   agent class to create the prefix. The FIRST feature's
   builder/tester/reviewer pay full price. A startup-time
   warmup probe (similar to /quota-status) could pre-create
   the cache. Saves ~5-10% wall-clock on feature 1.

6. **Reviewer wall-clock** — Reviewer reads the diff + 7
   playbook dimensions. ~70% of the work is read-and-classify;
   the verdict JSON is small. With `excludeDynamicSections: true`
   the prefix is cacheable BUT the diff isn't. Splitting reviewer
   into a "fast pass" (security + lint regex) + "deep pass"
   (architecture + maintainability) might let the fast pass
   approve cleanly diffs in seconds.

7. **Speculative merge** — close-feature currently waits for
   reviewer approval. Speculatively merging on `policyCheck:
pass` + reverting on `needs-revision` would let the next
   feature start ~5-10 min sooner (the reviewer wall-clock).

Combined hypothesis: lever #1 (~20-30%), #2 (~15-25%), #3 (~10-15%
on mechanical-heavy features), #4 (~5-15% depending on dep churn),
total 30-50% wall-clock reduction. #5/#6/#7 are smaller.

## Investigation Steps

**Time box: 45 minutes total.** If a step blows past its allocation,
stop and write what you have.

### Step 1 — Empirical baseline from the live run (10 min)

Read the live run's instrumentation:

- `projects/repo-health-dashboard-01/.claude/state/<runId>/feature-graph-progress.json`
  — capture `dispatchedAt` for each feature, derive elapsed time
  for completed[] features.
- `projects/repo-health-dashboard-01/.claude/state/<runId>/rate-limit-events.ndjson`
  — count rate_limit_event timestamps per feature; see if any
  represent stall pauses.
- `projects/repo-health-dashboard-01/.claude/state/<runId>/counters.json`
  — `modelBreakdown.<model>.{inputTokens, outputTokens,
cacheReadInputTokens, costUsd}` per agent class.

Build a table: feature → elapsed wall-clock → input/output token
totals → cost. Identify outliers.

### Step 2 — Archive comparison (5 min)

Walk `projects/kanban-webapp-09/.claude/state/*/feature-graph-progress.json`
(if archived) — repeat the wall-clock-per-feature table. Compare
mean wall-clock per feature pre-feat-031 vs. on this run. If
caching is delivering 96% cache-hit but wall-clock is unchanged,
that's a strong signal that wall-clock is dominated by something
other than input tokens (e.g., output token generation, tool
execution, network round-trips).

### Step 3 — Read agent prompt + task-iteration code (8 min)

`orchestrator/src/invoke-agent.ts::buildAgentPrompt` (lines
1507-1548) — confirm the prompt instructs the agent to work
through tasks. Look for whether it suggests serial-vs-parallel
execution.

Look at `.claude/skills/agents/back-end/python-fastapi/SKILL.md`
(or similar) — does it instruct sequential or parallel work?

Check whether the existing per-task `agent: <name>` in
`tasks.yaml` is honored at orchestrator level (each task gets
its own agent dispatch?) or all tasks for a feature get
bundled into one builder invocation.

### Step 4 — Inspect concurrency config (5 min)

Find `--max-concurrent` parsing in `orchestrator/src/cli.ts` and
its usage in `runFeatureGraph`. Document:

- Default value (we noted earlier it might be 1 or 5)
- Whether it gates feature-level OR agent-sequence-internal
  concurrency
- Whether security + tester actually CAN run parallel today via
  config

### Step 5 — Per-task model tiering audit (5 min)

`grep -E "model: claude-" projects/repo-health-dashboard-01/docs/tasks.yaml`
and check `~/.claude/models.yaml` for whether per-task overrides
are honored. If yes: confirm PM agent isn't using them. If no:
this is a feature gap to fix.

### Step 6 — pnpm install measurement (4 min)

In the live worktrees, check `pnpm-lock.yaml` mtime vs.
worktree creation time. If pnpm-lock is hours old, the
install ran once at checkout-feature time. Estimate average
install duration from one worktree's `node_modules/.pnpm/lock.yaml`
mtime - the worktree's creation time.

### Step 7 — Recommend (8 min)

Pick:

- TOP 3 reduction levers ranked by estimated savings × ease
- Sketch follow-up `feat-NNN-` plans for each (no implementation
  required during this investigation)
- Note any "this is actually fine, leave alone" findings to
  prevent revisiting the same false leads

## Findings

<!-- Filled in by the executing agent. -->

## Recommendation

<!-- Filled in once findings are complete. -->

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->
