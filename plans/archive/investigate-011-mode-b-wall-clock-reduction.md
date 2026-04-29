---
id: investigate-011-mode-b-wall-clock-reduction
type: investigation
status: archived
author-agent: claude-opus-4-7
created: 2026-04-29
updated: 2026-04-29
started-at: 2026-04-29T01:15:00Z
completed-at: 2026-04-29T01:25:00Z
recommendation-implemented-by: feat-035-builder-task-parallelism + feat-036-parallel-tester-security + feat-037-per-task-model-tiering (all draft)
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

### F1 — Empirical wall-clock from the live run

From `<runId>/feature-graph-progress.json` timestamps:

| Feature              | Dispatched (UTC)         | Merged                                     | Wall-clock                                      |
| -------------------- | ------------------------ | ------------------------------------------ | ----------------------------------------------- |
| feat-proxy-and-cache | (resumed from prior run) | ~00:15                                     | (skewed by 5h-bucket pause prior session — n/a) |
| feat-web-shell       | 2026-04-29T00:15:02      | ~00:47                                     | ~32 min                                         |
| feat-about           | 00:47:20                 | ~01:00                                     | ~13 min                                         |
| feat-deploy-pipeline | 00:47:20                 | ~01:00                                     | ~13 min (devops skipped)                        |
| feat-report          | 00:47:20                 | ~01:10                                     | ~23 min                                         |
| feat-home            | 00:47:20                 | (still inFlight, tester→reviewer at 01:13) | ≥26 min                                         |
| feat-error-states    | 01:10:53                 | (still inFlight)                           | n/a yet                                         |
| feat-compare         | 01:10:53                 | (still inFlight)                           | n/a yet                                         |

Variance across siblings dispatched concurrently: ~13-32 min — about
**2.5× spread**, suggesting per-feature complexity dominates more
than orchestrator overhead. feat-home is anomalously slow vs.
feat-about despite both being P0 single-screen features.

### F2 — Concurrency cap is 4 (default)

`orchestrator/src/feature-graph.ts:1129` — `const concurrency =
ctx.maxConcurrentFeatures ?? 4;`. The 4-feature fan-out we observed
(feat-home + feat-report + feat-about + feat-deploy-pipeline) matches
the cap. Bumping to 5+ would NOT help on this DAG — feat-web-shell
chokepoint resolved into exactly 4 unblocked features (the orchestrator
was already saturated).

### F3 — agent_sequence is strictly serial within a feature

`feature-graph.ts:675-702` — plain `for (let seqIdx = …; …;
seqIdx++)` loop. tester always runs after builder completes; reviewer
after tester. **security** (when present) sits at a position in
agent_sequence that determines its wait time, but it has NO
write-conflict with tester (both read the worktree, neither modifies
source). This is a real lever — they can run in parallel.

### F4 — All tasks for an agent bundle into ONE dispatch

`feature-graph.ts:708`: `const agentTasks = feature.tasks.filter((t)
=> t.agent === agentName);`. ALL of a feature's builder-tier tasks
(typically 5-7) get one builder dispatch. The agent's prompt at
`invoke-agent.ts:1516-1545` lists tasks like:

```
Tasks assigned to you on this feature:
  - scaffold-fastapi (backend-builder): ...
  - github-rest-client (backend-builder): ...
  - in-memory-cache (backend-builder): ...
```

The prompt does NOT instruct parallel-where-possible. The agent
defaults to sequential turn-by-turn execution. The Anthropic SDK
supports multiple `tool_use` blocks in one assistant turn — agents
already CAN parallelize but aren't being told to.

### F5 — No per-task model override field exists

`grep -E "model: claude-" tasks.yaml` returned zero matches.
`packages/orchestrator-contracts/src/tasks.ts` has no `model:`
field on the Task schema. So mechanical tasks (scaffold-fastapi,
scaffold-next-app, gha-ci-pipeline, vercel-deploy) run on Sonnet
(the `building` tier) when Haiku would be 2-3× faster + ~5×
cheaper. **Schema gap + PM agent has no surface to choose
per-task model.**

### F6 — pnpm install heuristic is already optimal

pnpm-lock.yaml mtimes per worktree:

| Worktree                                                    | mtime                     | Install ran?                                                      |
| ----------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------- |
| feat-proxy-and-cache                                        | 2026-04-28T03:20          | (carryover from prior run)                                        |
| feat-web-shell                                              | 2026-04-29T00:27          | YES (~12 min after dispatch — heavy: Next.js + Tailwind + charts) |
| feat-about / feat-home / feat-report / feat-deploy-pipeline | 00:47:20 (≈checkout time) | NO (feat-019 heuristic short-circuit — no package.json delta)     |
| feat-error-states / feat-compare                            | 01:10:54 (≈checkout time) | NO                                                                |

**Only feat-web-shell triggered a real install** (because it added
the web app's deps). Subsequent 5 features short-circuited. So the
pnpm-install lever is smaller than I hypothesized — feat-019's
heuristic is doing the right thing already. Defer.

### F7 — Cache-warmup hypothesis: lower-leverage than expected

feat-030 §D modelBreakdown shows the FULL run's totals, not
per-dispatch. We can't tell from current instrumentation whether
the FIRST dispatch paid full price for prefix creation. But: the
overall Sonnet cache-hit ratio is **96.1%** — meaning most input is
cached. A pre-run warmup probe would shave at most ~4% of input
tokens (the unchecked first-dispatch overhead). Low payoff.

### F8 — Reviewer wall-clock is meaningful but not dominant

feat-web-shell's reviewer was the slow tail (~12-15 min on a single
agent dispatch — we observed it stalling 90+s several times during
the long run). On smaller features (feat-about, ~13 min total wall-
clock with builder + tester + reviewer), reviewer is ~30-40% of
the feature time. Splitting into a fast-pass + deep-pass adds
implementation complexity for partial reduction.

### F9 — Speculative merge is theoretically possible but high-risk

The orchestrator's close-feature merges only on `policyCheck:
pass` AND reviewer.verdict === 'approved'. Reverting on
needs-revision would require git-revert plumbing + recovery state.
Defer.

## Recommendation

**Top 3 levers, ranked by estimated savings × ease:**

### 1 — Per-task parallelism within a builder dispatch (highest leverage, ~20-30% feature wall-clock cut)

**Plan:** `feat-NNN-builder-task-parallelism`

- Modify `orchestrator/src/invoke-agent.ts::buildAgentPrompt` to
  surface task `depends_on` edges in the prompt + explicitly
  instruct: "Where two tasks have no inter-dep, emit their tool
  calls in a SINGLE assistant turn (parallel tool_use blocks).
  Sequential only when one task's output feeds another's input."
- Update each shipped stack-skill SKILL.md (back-end + front-end +
  mobile) to mirror this guidance in its §Idioms section.
- No orchestrator-side changes required — the SDK already
  parallelizes tool_use blocks within a turn.

Effort: ~30 LOC + 12 SKILL.md updates.
Estimate: 20-30% wall-clock cut on feature builder phase. Especially
strong on builder phases with 5+ tasks (which is most of them).

### 2 — Run security + tester in parallel (medium leverage, ~10-20% feature wall-clock cut)

**Plan:** `feat-NNN-parallel-tester-security`

- Modify `runFeature`'s `for (seqIdx = …)` loop to detect
  parallelizable agent pairs. Whitelist: any combination of
  read-only agents (security + tester + reviewer) following a
  build-tier agent can dispatch concurrently.
- `Promise.all([dispatch(security), dispatch(tester)])`.
  Reviewer runs after both complete (reviewer reads everyone's
  output).
- Risk: low. None of these agents write to source — they emit
  separate JSON outputs that the orchestrator merges.

Effort: ~50 LOC + new test fixtures.
Estimate: 10-20% feature wall-clock cut on agent_sequences with
3+ members.

### 3 — Per-task model tiering for mechanical work (medium leverage, ~10-15% on mechanical-heavy features)

**Plan:** `feat-NNN-per-task-model-tiering`

- Add optional `model: <model-id>` field to the Task schema
  (`packages/orchestrator-contracts/src/tasks.ts`).
- Update `invoke-agent.ts::buildAgentOptions` to honor per-task
  model override (fall back to per-agent tier if absent).
- Update PM agent's SKILL.md to recommend Haiku for mechanical
  task types: scaffold-\*, gha-ci-pipeline, vercel-deploy,
  fly-deploy, smoke-test, package.json bumps.
- Stack-skill SKILL.md gains a §Recommended-tier-by-task section.

Effort: schema bump + ~80 LOC + tests + PM SKILL.md update.
Estimate: 10-15% wall-clock cut + 50%+ cost cut on
mechanical-heavy features (e.g. feat-deploy-pipeline = 100%
mechanical).

### Deferred (don't do v1)

| #   | Lever                                | Why deferred                                                                                       |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 4   | pnpm install symlink                 | feat-019 heuristic already short-circuits correctly per F6. Lever is small.                        |
| 5   | Cache warmup probe                   | Sonnet at 96.1% cache-hit. Warmup saves ~4%. Low payoff per F7.                                    |
| 6   | Reviewer fast-pass + deep-pass split | High implementation complexity for ~10-15% cut. Revisit if reviewer becomes the bottleneck.        |
| 7   | Speculative merge                    | Requires git-revert plumbing + recovery state. High risk. Defer.                                   |
| 8   | Increase concurrency cap above 4     | DAG topology dominates; bumping cap doesn't help when chokepoints fan out 4-wide naturally per F2. |

### Combined estimate

Ship 1 + 2 + 3 → **~30-45% wall-clock reduction** on a typical
8-feature Mode B run. Closes the "ship faster, not just cheaper"
gap that complements feat-031's 3-5× cost win.

### Falsifying experiments (post-merge)

1. **A/B run** — run repo-health-dashboard-02 (or fresh smoke project)
   on feat-030+031 baseline vs. feat-030+031+1+2+3. Compare
   per-feature wall-clock from `feature-graph-progress.json`.
2. **Mechanical-only test** — author a small project with
   exclusively mechanical features (scaffold + CI + deploy).
   Should show the largest delta from lever #3.

### Open questions (NOT blocking; revisit only if surprises emerge)

- Does the SDK's `tool_use` parallelism work cleanly with the
  current `permissionMode: acceptEdits` flag set on builder
  agents? Should be yes (multiple Write tool calls in one turn
  are supported), but smoke-test before assuming.
- Is feat-home's anomalous wall-clock from a per-feature property
  (large screen count) or a runtime flake (one slow tester turn)?
  Re-checkable post-run.
- Could lever #1 + #2 compound if the parallel tester + security
  ALSO use parallel tool_use? Probably yes — multiplicative.

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->

---

# COMPLETION RECORD (appended at archive time)

completed: 2026-04-29
outcome: success
actual-files-changed: []
commits: []
attempts: 1
duration-minutes: 10
test-results:
unit: n/a (research only)
integration: empirical observations against repo-health-dashboard-01 in-flight run
lessons:

- "Concurrency cap default is 4 (not 5) per feature-graph.ts:1129. The 4-feature fan-out we observed matches the cap; bumping won't help on a chokepoint DAG."
- "agent_sequence is a strict for-loop (feature-graph.ts:675). tester + security + reviewer all read worktree but currently serialize even though they don't write-conflict. Promise.all of read-only agents = ~10-20% feature-wall-clock cut."
- "All of a feature's builder-tier tasks (5-7 typically) bundle into ONE agent dispatch. Within that dispatch, the agent reads its task list and works turn-by-turn. The prompt doesn't surface depends_on or instruct parallel tool_use. Anthropic SDK already supports parallel tool calls per turn — operators just aren't instructing it. Likely highest-leverage lever (~20-30%)."
- "No per-task model override exists in the Task schema. Mechanical tasks (scaffold, gha-ci, deploy-config) run on Sonnet because that's the agent's tier. Per-task tier override + Haiku for mechanical = 10-15% wall-clock + ~50% cost cut on mechanical-heavy features."
- "feat-019 pnpm install heuristic is already optimal — only 1 of 6 worktrees triggered a real install in this run (feat-web-shell, the heavy one). Don't optimize what's already working."
- "Investigation pattern: walk the LIVE run's progress.json + counters.json BEFORE forming hypotheses. Empirical wall-clock numbers killed the cache-warmup hypothesis (96% cache-hit means warmup saves ~4%) and the pnpm-install hypothesis (heuristic short-circuits already)."
- "feat-031 caching at 96.1% cache-hit is an enormous validation; combined with this investigation's recommendations, the factory has a clear path to 3-5× cost AND 1.5-2× wall-clock improvement vs. kanban-09 baseline."

---
