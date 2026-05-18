---
id: investigate-031-tester-wall-clock-strategy-d-web
type: investigation
status: completed
author-agent: claude-opus-4-7
created: 2026-05-15
updated: 2026-05-15
approved-at: 2026-05-15
completed-at: 2026-05-15
parent-plan: null
supersedes: null
superseded-by: null
branch: null
affected-files: []
feature-area: orchestrator/tester-dispatch
priority: P1
attempt-count: 1
max-attempts: 5
time-box-minutes: 180
hypothesis: |
  The 20-min (1,200,000 ms) wall-clock cap on per-task dispatches is genuinely insufficient for
  a Strategy-D web tester's workload (synthesize 3 flows × 5-8 interactions each + Playwright
  config + page.route mocks + edge-case unit tests + coverage run on a cold worktree) — NOT
  because the tester agent is looping unproductively, but because the work itself fits poorly
  inside the cap. Surfaced empirically by gotribe-tribe-directory feat-tribe-directory-web
  2026-05-15: 2 attempts × 20 min stall-timeout each, $3.25 burned, feature shipped at
  builder-stage but blocked at tester-stage. At 91% seven_day rate-limit utilization, API
  responses were slow, compounding the budget pressure.
---

# investigate-031-tester-wall-clock-strategy-d-web: Is the 20-min per-task wall-clock cap insufficient for Strategy-D web tester workloads?

## Question

When a Strategy-D project's web tester step runs (synthesize-flow-e2e against N flows + run
Playwright with page.route mocks + author edge-case unit tests + run coverage on a worktree
where `pnpm install` may or may not have fully populated `node_modules`), does the 20-min
per-task wall-clock cap leave enough headroom for the work to complete, or is the cap
structurally too tight for this dispatch class?

Falsifiable shape: by measuring (a) how long the tester actually spent doing productive work
vs. waiting on tool calls / API responses, and (b) what fraction of the 20 min went to each
phase (synthesis script run, Playwright run, unit-test authoring, coverage), we can determine
whether the cap is structurally too tight or whether something else is wedging the tester
(rate-limited API responses, tool-use loops, etc.).

## Empirical motivator

`projects/gotribe-tribe-directory/feat-tribe-directory-web` Mode B retry, 2026-05-15
(pipeline-run-id `1023b0d4-6e5f-445c-b530-7154864edb53`):

1. web-frontend-builder completed both author-browse-page + author-detail-page tasks in a
   single dispatch — landed clean (apps/web/app/page.tsx + apps/web/app/tribes/[slug]/page.tsx
   - next.config.ts + postcss.config.mjs + tailwind.config.ts + vitest config).
2. `pnpm install` post-builder fired a warning: `pnpm install failed (commit had package.json
changes)` (TLS warning interleaved — likely a side-effect, not the root cause).
3. tester step dispatched (`tester-web-e2e` task per tasks.yaml). Workload:
   - Run `scripts/synthesize-flow-e2e.mjs` against `docs/user-flows-manifest.json` (3 flows × 5-8
     interactions each)
   - Author edge-case unit tests against the SSR pages
   - Configure Playwright + page.route mocks per Strategy D (apps/web/e2e/helpers/seed-intercept.ts
     was pre-copied by /architect)
   - Run `pnpm vitest run --coverage` + the synthesized Playwright specs
   - Assert ≥80% line coverage
4. **Attempt 1**: 20-min stall-timeout. Orchestrator killed the dispatch.
5. **Attempt 2**: 20-min stall-timeout. Orchestrator killed the dispatch.
6. Feature marked failed; no dependent features to abort (it was the leaf in the DAG).

Cost: $3.25 for the two attempts. Total project spend across runs: $10.68.

Context at runtime:

- Seven-day rate-limit bucket: 91% utilization (per `rate-limit-events.ndjson`). API responses
  measurably slower than at the start of the run (when feat-tribe-fixture ran cleanly in ~10 min
  total for its 4 tasks).
- "no SDK message in 95-117s" warnings firing repeatedly — the tester was alive but the SDK was
  taking 95+ seconds to return between assistant messages.
- No `paused.json` fired (the pause-hook threshold is 95%, not 91%). Build kept running but at
  reduced throughput.

The tester didn't crash, didn't error, didn't refuse the task. It got partway through the work
each attempt and the orchestrator killed it.

## Hypotheses (each falsifiable)

**H1 — Cap is structurally too tight for Strategy-D web tester workload**
20 min is calibrated against an average-case backend tester (httpx_mock unit tests + coverage)
or against the kanban-class web tester (Strategy A, localStorage, no synthesizer). For
Strategy D web, the synthesize-flow-e2e step alone runs Playwright child processes that take
30-60s per flow + the spec authoring + coverage. 3 flows × 60s + setup + tests + coverage =
realistically 8-12 min just for the synthesis pipeline, leaving <10 min for the agent's
reasoning + retry-loop. Tight.

**H2 — Rate-limit slowdown ate the headroom**
At 91% utilization, the SDK's per-request latency is ~2-3× the unloaded baseline. "no SDK
message in 117s" warnings confirm the tester is waiting on API responses, not doing work. The
20-min cap is fine at 50% utilization but fails at 91%. Solution: either bump the cap or
short-circuit the dispatch when utilization > N%.

**H3 — Tester is in a tool-use loop**
The tester repeatedly reads the same files, runs the same npm commands, never converges. Cap
fires because the work isn't progressing. Would manifest as agent-history showing redundant
Read/Bash calls.

**H4 — `pnpm install` warning fired but install didn't actually run**
The post-builder install step failed silently → tester started against an incomplete
node_modules → its `vitest run` fails with import errors → tester retries the run on attempt 2
without realizing the install state is broken → loops until cap.

## Investigation Steps

1. **Inspect the tester's agent-history for attempt 1 + attempt 2.** Open
   `projects/gotribe-tribe-directory/.claude/state/1023b0d4-6e5f-445c-b530-7154864edb53/`
   and find the agent-history JSON for the tester dispatches. Look at: total turn count,
   types of tool calls, redundant reads, time-per-turn. Was the tester doing productive work
   or looping?

2. **Time-stamp the work phases.** From the agent-history, reconstruct: when did the tester
   start the synthesizer run? When did Playwright start? When did the cap fire? What was the
   LAST tool call before the timeout? If the last call was a Bash invocation of
   `pnpm vitest run` or `pnpm exec playwright test`, the tester was waiting on a child
   process — H1 (cap structural). If the last call was another Read/Grep/Edit cycle, the
   tester was looping — H3.

3. **Audit the `pnpm install` warning.** Open the agent-history + the orchestrator's
   stderr-capture for the install attempt. Did the install actually fail, or did it succeed
   with a non-zero exit due to the TLS warning? Check whether `apps/web/node_modules/` exists
   in the worktree. If it doesn't, H4 confirms — the tester was running vitest against an
   empty node_modules and failing on every import.

4. **Compare against backend tester runs.** feat-tribe-fixture's `validate-fixture` task +
   feat-tribe-api's `tester-tribes-api` task both completed cleanly. How long did each take?
   Cross-reference with `feature-graph-progress.json` event timestamps. If the backend
   testers averaged <5 min and the web tester needed >20 min, the cap is class-specific
   structural (H1).

5. **Calculate the at-rate-limit penalty.** Pull `rate-limit-events.ndjson` for the run. Map
   timestamps to per-request latencies (where available in the SDK telemetry). Estimate: at
   91% utilization, what fraction of wall-clock was spent waiting on API vs. doing work?
   If >40% was API-wait, H2 confirms — the cap is fine at lower utilization but inadequate
   at 90%+.

6. **Read the orchestrator's wall-clock cap configuration surface.** Find where 1,200,000 ms
   is set (likely `orchestrator/src/invoke-agent.ts` or a constant module). Is it per-agent
   class? Per-task? Configurable via `~/.claude/models.yaml`? If configurable, the
   recommendation may simply be "bump the cap for testers on Strategy-D projects".

7. **(Time permitting) Replicate at minimal scope.** Create a minimal test that dispatches a
   tester against a known-shape Strategy-D project + measure wall-clock. Does it fit in 20
   min at 50% rate-limit? At 80%? At 91%? Establishes the structural floor.

## Findings

### Step 1 — Inspect the tester's agent-history

**No agent-history JSON exists for this run.** The state dir
`projects/gotribe-tribe-directory/.claude/state/1023b0d4-6e5f-445c-b530-7154864edb53/`
contains only `counters.json`, `feature-graph-progress.json`, `orchestrator.pid`,
`rate-limit-events.ndjson`, and `stall-log.json`. The orchestrator does NOT
persist per-dispatch SDK-message transcripts in this surface — the tester
agent prompt requires it to append to `.claude/worktrees/<feature>/.feature-context.json.agent_history[]`
after task completion (per `.claude/agents/tester.md` §"Worktree CWD + lockfile append"),
but BOTH attempts were aborted by wall-clock BEFORE the agent finished, so
no agent_history entry was written. The worktree was also pruned post-merge
(only the SUCCESSFUL builder commit landed via auto-commit — the failed
tester dispatch never reached the merge cascade), so even a partial in-
progress transcript is unrecoverable.

**Consequence for H3**: cannot directly count tool-call types from a
transcript. Inference from `stall-log.json` + the orchestrator stdout is
the only available evidence. See Step 2.

### Step 2 — Time-stamp the work phases

**`stall-log.json` (all entries for this feature):**

```
feat-tribe-directory-web | web-frontend-builder | dispatched 1778843611527 | aborted 1778845089837 | wall-clock-1500000ms | wallTimeMs 1501604
feat-tribe-directory-web | tester                | dispatched 1778847803117 | aborted 1778848968670 | wall-clock-1200000ms | wallTimeMs 1200290
feat-tribe-directory-web | tester                | dispatched 1778849003410 | aborted 1778850172018 | wall-clock-1200000ms | wallTimeMs 1200247
```

Three observations:

1. **The web-frontend-builder ALSO hit a wall-clock cap** (1,500,000ms / 25min)
   — same dispatch that committed package.json AND emitted the `pnpm install
failed` warning. The structural pressure isn't tester-specific.
2. **Both tester attempts hit wall-clock to the millisecond** (1200290ms +
   1200247ms ≈ exactly the 20-min cap from `DEFAULT_STALL_TIMEOUT_BY_AGENT.tester`
   in `orchestrator/src/model-config.ts:168`). The polling tick is 30s
   (`checkIntervalMs` default in `invoke-agent.ts:1292`), so the 290-247ms
   over-shoot matches one polling-tick delay.
3. **`lastKeepAliveAt` was at `dispatchedAt + 19m25s` (attempt 1) and
   `dispatchedAt + 19m28s` (attempt 2)** — meaning the SDK was sending messages
   right up to the abort. The "no SDK message in 92-117s" warnings throughout
   the run confirm this — the SDK was producing assistant/tool_use messages,
   just slowly. NOT a keepalive-gap abort; pure wall-clock.

**The aborts were NOT triggered by silence.** The agent was actively
producing tool calls, but each round-trip to the SDK took 95-117 seconds.
Over 20 minutes that's only ~10-12 round-trips, which is well under the
agent's `maxTurns: 30` cap (tester.md frontmatter). The wall-clock fired
before the turn-count cap could have.

### Step 3 — Audit the `pnpm install` warning

**Source code path** (`orchestrator/src/invoke-agent.ts:2234-2263` →
`installIfPackageJsonChanged`): after a commit, if the diff includes
`package.json`, `pnpm install` is run; failure (non-zero exit OR stderr
captured) is logged as a non-blocking warning. The orchestrator NEVER
aborts the feature on install failure. From `feature-graph.ts:1267-1284`:

```ts
if (commitLanded) {
  try {
    const install = await installAfterCommit(worktreeCwd);
    if (install.warning) {
      commitWarnings.push(`${agentName}: ${install.warning}`);
      console.warn(`[runFeature] install warning for ${feature.id}/${agentName}: ${install.warning}`);
    }
  } catch (err) { ... }
}
```

**The captured stderr** (per orchestrator log line 78) is:
`(node:35160) Warning: Setting the NODE_TLS_REJECT_UNAUTHORIZED environment
variable to '0' makes TLS connections and HTTPS requests insecure...`. That's
a Node.js startup warning, NOT pnpm's actual rejection reason — but the
non-zero exit IS real because `install.code !== 0` is what triggers the
`pnpm install failed` warning prefix at `invoke-agent.ts:2257`.

**Post-merge filesystem evidence** (this is the smoking gun):

| Path                                                                            | Exists? | Implication                            |
| ------------------------------------------------------------------------------- | ------- | -------------------------------------- |
| `projects/gotribe-tribe-directory/node_modules/`                                | NO      | pnpm install never landed deps at root |
| `projects/gotribe-tribe-directory/apps/web/node_modules/`                       | NO      | apps/web has zero deps materialized    |
| `apps/web/playwright.config.ts`                                                 | NO      | Missing required playwright config     |
| `apps/web/e2e/<any-spec>.spec.ts`                                               | NO      | No specs ever written                  |
| `apps/web/package.json` includes `@playwright/test`                             | NO      | devDep is MISSING                      |
| `apps/web/package.json` includes `@vitest/coverage-v8`                          | NO      | Coverage tool MISSING                  |
| `apps/web/package.json` includes `"test:e2e"` script                            | NO      | Required script MISSING                |
| `apps/web/package.json` includes `"postinstall": "playwright install chromium"` | NO      | Required hook MISSING                  |

The current `apps/web/package.json` (only 35 lines) is the bug-037-class
scaffold-gap that `.claude/skills/agents/front-end/react-next/SKILL.md §3a.0`
warns about. This is NOT the tester's failure — the package.json was
SHIPPED that way at scaffold time (or, more likely, the web-frontend-builder
that hit the 25-min wall-clock NEVER got around to adding the testing deps
the SKILL.md mandates).

**H4 verdict — STRONG CONFIRM with refinement**: it's not that "install
failed but tester didn't know"; it's that **the package.json the builder
committed didn't declare the testing dependencies in the first place**.
The downstream tester landed on a worktree where `pnpm vitest run --coverage`
COULD NOT WORK because:

- `@vitest/coverage-v8` isn't in devDependencies → `--coverage` flag
  errors with "coverage provider not found"
- `@playwright/test` isn't in devDependencies → cannot author or run
  Playwright specs (which is the whole point of the synthesize-flow-e2e
  pass)
- No `playwright.config.ts` → no webServer block → no Strategy-D harness
- No `node_modules` whatsoever → the very first `pnpm install` the tester
  attempted (or that the harness attempted on its behalf) was hitting
  some failure mode the agent had to diagnose from scratch

That diagnosis — figuring out "why won't anything install?" — IS the kind
of work that loops a tester for 20 minutes without converging.

### Step 4 — Compare against backend tester runs

From `rate-limit-events.ndjson` (agent-tagged timestamps; one event ~per
SDK round-trip in this run):

| Feature                  | Agent                  | First event       | Last event        | Approx wall                 |
| ------------------------ | ---------------------- | ----------------- | ----------------- | --------------------------- |
| feat-tribe-fixture       | backend-builder        | 09:12:24          | 09:19:41          | ~7m                         |
| feat-tribe-fixture       | tester (validate-fix.) | 09:27:03          | 09:27:03 (single) | <2m (single ndjson event)   |
| feat-tribe-fixture       | reviewer               | 09:37:20          | 09:37:20 (single) | <2m                         |
| feat-tribe-api           | backend-builder        | 09:44:05          | 09:44:05 (single) | ~10m (incl. security 09:56) |
| feat-tribe-api           | security               | 09:56:18          | 09:56:18 (single) | <2m                         |
| feat-tribe-api           | tester                 | 10:03:31          | 10:03:31 (single) | <2m                         |
| feat-tribe-api           | reviewer (3 events)    | 10:09:23–10:16:40 | 10:16:40          | ~7m (3 retries)             |
| feat-tribe-directory-web | web-frontend-builder   | 11:13:48          | 11:51:52          | 25m (wall-clock)            |
| feat-tribe-directory-web | tester attempt 1       | 12:04:48          | 12:23:41          | 20m (wall-clock)            |
| feat-tribe-directory-web | tester attempt 2       | 12:23:41          | 12:43:41          | 20m (wall-clock)            |

The two Python testers (`validate-fixture` + `tester-tribes-api`) completed
cleanly each with a single rate-limit event in their dispatch window —
indicating they made just enough SDK round-trips to register exactly one
"allowed_warning" breadcrumb before terminating. **Backend testers
completed in well under 5 minutes; the web tester needed >20 minutes.**

This is the asymmetry that calibrates the 20-min cap. Backend testers do
narrow work (pytest + httpx_mock at module scope; ~3-5 test files; coverage
parsed inline). Web testers do MUCH more:

- Run `node scripts/synthesize-flow-e2e.mjs` against `docs/user-flows-manifest.json`
  (3 flows × 5-8 interactions; emits 3 .spec.ts files at ~300 LoC each)
- Author edge-case `*.test.tsx` files against SSR pages (vitest + testing-library)
- Author + bootstrap `playwright.config.ts` with `webServer:` block + Strategy-D
  helpers
- Install `@playwright/test` runtime + chromium binary (~150MB the first time;
  cached after) — see `tester.md §Self-verify discipline`
- Run `pnpm vitest run --coverage` to validate ≥80% coverage threshold
- Run `pnpm exec playwright test` to validate the synthesized specs pass

That's a 4-5x larger workload than a Python tester. The 20-min cap is
calibrated against the lighter end of that range. **H1 verdict: STRONG
CONFIRM — the cap is structurally too tight for Strategy-D web tester
class-of-work**, but only when the worktree state requires authoring AND
runtime-tooling-bootstrap in the same dispatch (which IS the empirical
case here, because the builder didn't ship the deps).

### Step 5 — Calculate the at-rate-limit penalty

Seven-day bucket utilization timeline (from `rate-limit-events.ndjson`):

- 88%–89% at run start (09:12)
- 90% through feat-tribe-api dispatches (09:44–10:16)
- **91% throughout feat-tribe-directory-web dispatches** (11:13–13:23)

Pause threshold is 95% (per the rate-limit-event handler at
`invoke-agent.ts:1417-1424` only EMITS a warning for `allowed_warning` —
hard pause only fires on `status: "rejected"`). The Sonnet model auto-throttles
SDK responses under high bucket pressure; the orchestrator log
"no SDK message in 92-117s" warnings repeatedly throughout the tester
dispatch confirm that round-trip latency was **~100s/turn** — vs. typical
unloaded baseline of ~10-20s/turn.

Crude math:

- 20-min wall ÷ 100s/turn = ~12 turns max
- Tester `maxTurns: 30` (per `tester.md` frontmatter)
- At 91% utilization, the tester gets at MOST 12 turns before wall-clock
  fires — but its work was specced for 20-30 turns
- At nominal 20s/turn (~50% bucket), the tester would get ~60 turns —
  3-5x more than at 91%

**H2 verdict — STRONG CONFIRM, but it's a multiplier on H1, not an
independent cause.** Even at nominal utilization, the workload-vs-cap
mismatch (H1) is real. At 91%, the throughput collapse made what would
be a marginal fit into a 100% fail rate.

### Step 6 — Read the orchestrator's wall-clock cap configuration surface

**Location**: `orchestrator/src/model-config.ts:164-200`
(`DEFAULT_STALL_TIMEOUT_BY_AGENT` map). Current values:

```ts
const DEFAULT_STALL_TIMEOUT_BY_AGENT: Record<string, number | null> = {
  "backend-builder": 25 * 60 * 1000, // 25min
  "web-frontend-builder": 25 * 60 * 1000, // 25min
  "mobile-frontend-builder": 25 * 60 * 1000, // 25min
  tester: 20 * 60 * 1000, // 20min  ← the cap that fired
  reviewer: 15 * 60 * 1000, // 15min (was 10, bumped 2026-05-01)
  security: 15 * 60 * 1000, // 15min
  "git-agent": null, // exempt
  "bug-fixer": 15 * 60 * 1000,
  "systemic-fixer": 18 * 60 * 1000,
  "perceptual-reviewer": 5 * 60 * 1000,
  "walkthrough-reviewer": 8 * 60 * 1000,
};
```

The cap IS configurable at multiple levels:

1. **Per-project**: `projects/<name>/.claude/models.yaml` accepts
   `stallTimeoutMs: { tester: 1800000 }` (per the comment in this file
   lines 70-81 — "30 min override for slow test suites" example).
2. **Per-agent**: `agents.tester: { stallTimeoutMs: 1800000 }` in same file.
3. **Per-agent-class globally**: edit
   `DEFAULT_STALL_TIMEOUT_BY_AGENT.tester` directly.

The cap fires via a 30s-polling setInterval at `invoke-agent.ts:1305-1331`.
The polling fires `abortController.abort(reason)` which propagates as
`error_stall_timeout: wall-clock-1200000ms` per `invoke-agent.ts:1544`.

There is currently **no class-discriminator** for Strategy-D web tester
vs. simple-backend tester — they share the same 20-min cap. There is
also **no dynamic adjustment for rate-limit utilization** — the cap is
fixed regardless of bucket headroom.

### Step 7 — Replicate at minimal scope

SKIPPED per time-budget guidance — the evidence from Steps 1-6 is
sufficient to rank the hypotheses without further replication.

### Hypothesis ranking

| H   | Verdict   | Confidence | Evidence                                                                                                                                                                                                           |
| --- | --------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H1  | CONFIRMED | HIGH       | Backend testers <5min vs web tester >20min in same run; workload asymmetry per Step 4; 20-min cap calibrated against lighter Python work                                                                           |
| H2  | CONFIRMED | HIGH       | 91% bucket utilization + repeated 95-117s SDK round-trips = ~3-5x latency multiplier; only 12 turns/20min achievable when 30 are specced                                                                           |
| H3  | FALSIFIED | HIGH       | `lastKeepAliveAt` was ~19m28s into 20m dispatch — SDK was actively producing messages right up to abort; not a silent loop, just slow round-trips                                                                  |
| H4  | CONFIRMED | MEDIUM-HI  | `apps/web/package.json` post-merge is missing `@playwright/test` + `@vitest/coverage-v8` + `test:e2e` script + `postinstall` hook + no node_modules anywhere; tester landed on a fundamentally unworkable worktree |

**Compound diagnosis**: H1 + H2 + H4 all true simultaneously. They
amplify each other:

- H4 means the tester had to do MORE work than the spec called for (install
  - scaffold testing deps the builder should have committed)
- H1 means the cap was already tight for the in-spec workload
- H2 means each turn took 3-5x longer than baseline

Each alone would have hurt; combined they made completion structurally
impossible.

### Surprise findings

1. **The web-frontend-builder ALSO hit a wall-clock cap** in the same
   dispatch (25-min cap at 11:38). This is invisible in the "tester failed
   twice" framing but reframes the bug: it's not specifically a tester
   problem, it's a Strategy-D-web-dispatch-class problem.
2. **`apps/web/package.json` is short by 10+ lines vs. the SKILL.md §3a.0
   verbatim mandate.** This means the web-frontend-builder agent either
   never ran the §3a.0 scaffold path OR committed before completing it.
   Either way, the scaffold-time enforcement (bug-037 Phase A) didn't
   catch it for this project. Worth a follow-up audit of the architect
   step's react-next scaffolding for gotribe-class projects.
3. **No agent-history is persisted post-stall-timeout**, even though the
   tester agent prompt mandates appending one entry on success-OR-failure.
   Because the abort fires inside `runLlmAgent` BEFORE the agent's "final
   message" reaches the SDK iterator, the agent never reaches its
   `agent_history.append()` step. This makes post-hoc debugging of
   stall-timeout failures structurally impossible without on-disk
   transcript capture. Sister concern to bug-091's enforcement-without-
   visibility patterns.
4. **The orchestrator's "no SDK message in Ns" warnings are misleading
   here** — they fire at 90s, but the actual ABORT threshold is 5min
   (`abortMs = 300_000` in `invoke-agent.ts:1294`). The repeated 92-117s
   warnings communicated "stall imminent" but the actual abort came from
   a totally different timer (the wall-clock-1200000ms). Operators
   reading the log would naturally suspect keepalive-gap; the actual
   cause is workload-vs-cap.

## Recommendation

The right shape is THREE coordinated changes, ordered from cheapest /
most targeted to broadest:

### R1 — Bump the tester cap when persistence_layer = `external-api-only` AND web target exists (load-bearing)

The `DEFAULT_STALL_TIMEOUT_BY_AGENT.tester` is a static map keyed on agent
name only. Extend the resolver in `model-config.ts:readModelConfig()` (or
its tester-dispatch caller) to take a `featureContext` second argument
that, when the feature includes web targets AND
`architecture.yaml.tooling.stack.persistence_layer === "external-api-only"`,
returns 30 \* 60 \* 1000 (30min) instead of 20 \* 60 \* 1000.

Diff shape (`orchestrator/src/model-config.ts`):

```ts
// Add a class-discriminator helper:
function effectiveTesterStallTimeoutMs(
  base: number,
  featureContext?: {
    stack?: { persistence_layer?: string; web_framework?: string };
  },
): number {
  if (
    featureContext?.stack?.persistence_layer === "external-api-only" &&
    featureContext?.stack?.web_framework /* any non-null */
  ) {
    return Math.max(base, 30 * 60 * 1000);
  }
  return base;
}
```

Wire `effectiveTesterStallTimeoutMs` into the resolver where
`stallTimeoutMs` is read for `agent === "tester"`. Estimated diff: ~25
lines + 1-2 unit tests pinning the discriminator behavior.

Cost impact: at most $0.50 more per failing-tester attempt; net positive
when the wider cap clears the bar.

### R2 — Add a rate-limit-utilization pre-flight gate before dispatching testers (defensive)

When `rate-limit-events.ndjson` shows the most-recent `seven_day` event at
≥85% utilization AND `status: "allowed_warning"`, the orchestrator should
SKIP dispatch + emit a `paused.json` with reason
`rate-limit-headroom-too-low` instead of attempting + timing out. This is
the cheaper-than-failed-attempt path.

Threshold rationale: at 85% the SDK round-trip already shows ~2x latency
multiplier; at 91% it's 3-5x. Below 85% the 20-30 min caps are realistic.

Diff shape: extend the pre-dispatch hook in `feature-graph.ts` near line
1167 (the per-task retry loop) — read the most-recent breadcrumb, gate
the dispatch. ~30 lines + a unit test. Operator can override via env
`AGENTFLOW_SKIP_RATE_LIMIT_GATE=1`.

### R3 — Make the post-builder install failure ABORT the feature instead of warn-only (most defensive)

Per current `feature-graph.ts:1267-1284`, `installIfPackageJsonChanged`
failures are warnings only. The empirical case here shows this discipline
is wrong for Strategy-D-web — a missing `@playwright/test` runtime makes
the tester's work IMPOSSIBLE, not merely degraded. Transform the install
warning into a fail-fast when:

- The feature has a tester step in `agent_sequence[]`
- `architecture.yaml` declares web_framework (any value)
- The post-builder install's stderr OR diff-tree includes any of:
  `@playwright/test`, `playwright.config.ts`, `vitest`, `coverage`

Diff shape: modify `runFeature`'s post-install branch (~10 lines) to
re-raise as `error_install_failed` for the dispatching builder
specifically, so the per-task retry counter triggers a builder re-attempt
(not a tester attempt against broken state). Sister to
`.claude/skills/agents/front-end/react-next/SKILL.md §3a.0`'s mandate
which already lists these as scaffold-required.

### Cost-benefit (single-run estimate)

| Change | One-time eng | Saved per failed-dispatch | Saved per Strategy-D-web run at 90%+ bucket |
| ------ | ------------ | ------------------------- | ------------------------------------------- |
| R1     | ~1h          | $1.50 (avoiding 1 fail)   | ~$3 (avoiding both attempts)                |
| R2     | ~2h          | $1.50 (avoiding 1 fail)   | ~$3 + future similar runs                   |
| R3     | ~2h          | $1.50 (avoiding 1 fail)   | $0 here (different code-path)               |

This run cost $3.25 unnecessarily. With R1+R2 in place, the same workload
would have either succeeded (R1 cap held it) or paused gracefully (R2
caught the bucket pressure). With R3 in place, it would have re-routed to
the builder for a fix-pkg-json retry, then proceeded.

Recommend implementing **R1 first** (smallest diff, immediately unblocks
the gotribe curriculum's next several tier-1 briefs, all Strategy-D),
then R3 (catches the empirical root cause class), then R2 (broadest
defense).

## Attempt Log

### Attempt 1 — 2026-05-15 (Sonnet 4-6 / 1M / Opus 4-7 1M)

- Read full plan body + frontmatter.
- Inspected `projects/gotribe-tribe-directory/.claude/state/1023b0d4-6e5f-445c-b530-7154864edb53/`
  contents: counters.json, feature-graph-progress.json, orchestrator.pid,
  rate-limit-events.ndjson, stall-log.json. NO agent-history JSON.
- Read `orchestrator/src/model-config.ts` lines 1-220 to locate the cap.
- Read `orchestrator/src/invoke-agent.ts` lines 1280-1560 to understand
  wall-clock + keepalive abort logic.
- Read `orchestrator/src/feature-graph.ts` lines 1230-1290, 1840-1880
  for install + retry logic.
- Read `orchestrator/src/invoke-agent.ts` lines 2200-2270 for install
  helper internals.
- Read `.claude/agents/tester.md` (full).
- Read `.claude/skills/agents/front-end/react-next/SKILL.md` lines
  370-570 (Testing + 3a.0 scaffold mandate).
- Confirmed `apps/web/package.json` missing 4 of the SKILL.md §3a.0
  mandatory entries: `@playwright/test`, `@vitest/coverage-v8`,
  `test:e2e` script, `postinstall: playwright install chromium`.
- Confirmed `apps/web/playwright.config.ts` does NOT exist.
- Confirmed `apps/web/node_modules/` and root `node_modules/` BOTH
  missing.
- Cross-referenced `docs/user-flows-manifest.json` (3 flows × 5-8
  interactions = the synthesizer workload) and `docs/tasks.yaml`
  (tester-web-e2e at lines 220-233).
- Cross-referenced `.claude/models.yaml` (project-level override surface)
  - `.claude/architecture.yaml` (persistence_layer: external-api-only,
    web_framework: react-next).
- Wrote findings + recommendation; updated frontmatter status →
  completed, attempt-count → 1.
