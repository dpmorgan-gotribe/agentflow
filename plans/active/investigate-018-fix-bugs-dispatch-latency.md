---
id: investigate-018-fix-bugs-dispatch-latency
type: investigation
status: draft
author-agent: human
created: 2026-05-06
updated: 2026-05-06
parent-plan: null
supersedes: null
superseded-by: null
branch: null
affected-files:
  - orchestrator/src/fix-bugs-loop.ts
  - orchestrator/src/invoke-agent.ts
  - scripts/file-bug-plan.mjs
  - .claude/agents/web-frontend-builder.md
  - .claude/agents/backend-builder.md
  - .claude/agents/tester.md
  - .claude/agents/reviewer.md
feature-area: orchestrator/fix-bugs-loop
priority: P1
attempt-count: 0
max-attempts: 5
time-box-minutes: 60
hypothesis: |
  Per-bug dispatch wall-clock (~20-30min observed empirically on
  reading-log-01) is dominated by the 3-agent sequence
  [builder, tester, reviewer] running serially. For most bug classes,
  tester + reviewer add cost without catching the kinds of failures the
  loop's re-verify already catches. Skipping them on cheap classes drops
  per-bug latency by ~3x. Secondary: dev-server-compile bugs route to
  the wrong tier (web-frontend-builder for backend port-bind issues),
  burning 5-15min on a guaranteed-no-op dispatch before the empty-merge
  guard rejects it.
---

# investigate-018: Why are /fix-bugs dispatches taking ~20-30min per bug?

## Question

A simple bug like "backend port 3001 didn't bind" (one-line fix:
`prisma migrate deploy` in postinstall) takes ~20-30min wall-clock per
attempt in /fix-bugs. With 3 attempts/bug × N bugs × 5 iterations cap,
a real-world fix-bugs run can stretch to hours. The user's intuition:
most bugs are quick wins; per-bug latency should be 3-5min, not 20-30.

What's the actual time budget per dispatch, and where can we cut it
without losing the safety properties (proper test coverage, reviewer
catch on bad fixes)?

## Empirical anchor (reading-log-01 2026-05-06)

- 16:25 — /fix-bugs fired (run #1)
- 16:27 — verifier complete, bug-compile-tooling-pre-flight filed
- 16:28 — agent dispatch begins (worktree created)
- 16:48 — orchestrator exits, loop reports "clean" (silent-success bug-055)
- **Run #1 dispatch wall-clock: ~20min** for a single bug, single agent
  pass that ultimately accomplished nothing (bug-055 root cause — the
  agent dispatched into an orphan dir; closePerBugWorktree's empty
  merge was accepted as success)

After bug-055 ship + bugs.yaml reset:

- 17:20 — /fix-bugs fired (run #2, post-bug-055)
- 17:21 — verifier complete, bug filed as fresh pending
- 17:21 — Phase A rm-rf'd orphan dir, registered fresh worktree
- 17:21 — agent dispatch begins
- 17:34 — agent still in-flight at attempts:1 (~13min so far)
- (run still going; data point will be added when complete)

## Hypothesis (testable)

**H1 (high confidence)**: The 3-agent sequence
`[web-frontend-builder, tester, reviewer]` is the dominant cost
per dispatch. Each agent is a fresh Claude SDK invocation with full
system-prompt + project-CLAUDE-md + skill-pack reload. Empirical SDK
overhead per agent: ~30-90s for prompt warmup + 3-12min for actual
reasoning + tool use. 3 agents × 5-15min = 15-45min/bug.

**H2 (high confidence)**: For dev-server-compile + runtime-error +
reachability-orphan bugs, **tester + reviewer add ~10-20min cost
without catching bugs the loop's re-verify can't catch**. The
re-verify step IS the test for dev-server-compile (does the server
boot now?). Reviewer is a defense-in-depth check that's load-bearing
for feature work but redundant for one-line plumbing fixes.

**H3 (medium confidence)**: `defaultAgentSequence` in
`scripts/file-bug-plan.mjs:702` routes dev-server-compile to
web-frontend-builder by default — the wrong tier for backend
port-bind issues. The agent reads frontend code, finds nothing
broken, eventually no-ops or makes irrelevant edits. Phase B's
empty-merge guard now rejects this, but the wasted dispatch still
burns 10-15min before the rejection.

**H4 (low-medium confidence)**: Bug summary is empty (`'Dev-server
compile error during tooling-pre-flight: '`). The agent has zero
context about WHY the dev server failed (the actual stderr is
captured into warnings[] but not propagated into the bug entry's
summary or retryContext). Even routed to the right tier, the agent
has to guess. Forwarding stderr cuts agent reasoning time by 30-60%.

**H5 (speculative)**: Agent SDK warmup (process spawn + prompt
parsing + skill-pack hydration) may be ~60-90s per invocation. With
3 agents per bug, that's 3-5min of pure overhead before any work
begins. Possible mitigations: keep-alive agent processes, prompt
caching per agent type, or merging tester+reviewer into one pass.

## Investigation Steps

### Step 1 — Instrument per-agent timing in dispatchAgentsForBug (15min)

`orchestrator/src/fix-bugs-loop.ts:787` already has the dispatch loop
calling `ctx.invokeAgent` per agent in `bug.agentSequence`. Add a
structured `process.stderr.write(\`[fix-bugs-loop] timing: bug=<id>
agent=<name> wallMs=<X> costUsd=<Y>\\n\`)` after each invocation so
we can see exactly where time goes per bug. No behavior change;
diagnostic-only.

Validation: run /fix-bugs reading-log-01 with at least 1 bug; capture
stderr; assert each bug emits N timing lines (N = agentSequence.length)
and the sum matches the loop's total.

### Step 2 — Quantify the 3-agent breakdown (5min, after Step 1)

From the captured timings:

- web-frontend-builder wallMs / total: \_\_%
- tester wallMs / total: \_\_%
- reviewer wallMs / total: \_\_%

If tester + reviewer ≥ 50% of total → H2 confirmed → Step 4.
If web-frontend-builder ≥ 70% of total → H1/H3 dominant → Step 5.

### Step 3 — Audit defaultAgentSequence routing for dev-server-compile (10min)

`scripts/file-bug-plan.mjs:730-740` switch statement: confirm
dev-server-compile, runtime-error, and reachability-orphan all fall
through to the default `[web-frontend-builder, tester, reviewer]`.
Then check the actual bug class for reading-log-01's
bug-compile-tooling-pre-flight: backend port 3001 not binding.
Web-frontend-builder cannot fix this; the right tier is
backend-builder.

Read the verifier's classification logic
(`orchestrator/src/build-to-spec-verify.ts`) to see what hints we
have at file-time about backend vs frontend ownership. The warnings
already contain `"backend (node-fastify) did not respond on
http://localhost:3001/health"` — that's a backend-tier signal we're
ignoring at routing time.

### Step 4 — Prototype: short agent sequences per cause class (decision)

Map each `primaryCause` to the minimum-viable agentSequence:

| primaryCause           | Current sequence                                 | Proposed minimal                                                       | Rationale                                                                                     |
| ---------------------- | ------------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| dev-server-compile     | web-frontend-builder, tester, reviewer           | backend-builder OR web-frontend (cause-routed), no tester, no reviewer | Re-verify IS the test (does dev-server boot now?); reviewer can't add value on plumbing fixes |
| runtime-error          | web-frontend-builder, tester, reviewer           | web-frontend-builder OR backend (cause-routed), reviewer only          | Tester redundant with re-verify's flow run; reviewer keeps semantic check                     |
| reachability-orphan    | web-frontend-builder, tester, reviewer           | web-frontend-builder, reviewer                                         | Tester writes new tests for the orphan, but the wiring fix is checked by re-verify            |
| visual-parity          | web-frontend-builder, tester, reviewer           | web-frontend-builder, reviewer                                         | Visual regression caught by parity-verify, not tester                                         |
| flow-execution-failure | web-frontend-builder, tester, reviewer (current) | web-frontend-builder, tester, reviewer (KEEP)                          | Tester is needed for new test coverage; this is "real feature work" territory                 |
| seed-setup             | backend-builder, tester, reviewer (current)      | backend-builder, tester, reviewer (KEEP)                               | Same reasoning — backend logic, full safety net                                               |
| build-gap              | web-frontend-builder, tester, reviewer (current) | web-frontend-builder, tester, reviewer (KEEP)                          | Real feature work surfaced post-build                                                         |
| manifest-author        | [] (no dispatch)                                 | [] (KEEP)                                                              | Already handled                                                                               |

Expected wall-clock impact (assuming ~10min/agent average):

- dev-server-compile: 30min → 10min (3x faster)
- runtime-error: 30min → 20min
- reachability-orphan: 30min → 20min
- visual-parity: 30min → 20min

Cost: tester + reviewer were defense-in-depth catches. Mitigation:
the loop's re-verify pass IS already the structural integration
check; if the bug doesn't reappear in the next iteration, the fix
landed. If it does reappear, flap detection escalates after 3
flaps.

### Step 4b — Decide: route to existing builders OR new bugfix-builder agent (20min)

**The strategic question that gates feat-058 + bug-056 ship order.**
Once we've trimmed the agent_sequence per cause class (Step 4) and
cause-routed the tier (Step 5 sketch), the next decision is what
shape the agent itself should take. Three options:

#### Option X — Route to existing builders (web-frontend-builder, backend-builder, mobile-frontend-builder)

The current model. `defaultAgentSequence` in `scripts/file-bug-plan.mjs`
picks one of the existing tier-specific builders based on bug class +
warning content.

- **Pros**: Builders already know their stack-skill (react-next /
  node-fastify / etc.); already know testing policy + file paths +
  commit conventions; no new agent surface; tier-specific knowledge
  intact (backend-builder knows Prisma migrations, port conventions).
- **Cons**: Builders are oriented around "build new feature" not
  "fix existing thing" — system prompt loaded with feature-build
  guidance not relevant to bug fixes, slowing prompt parsing +
  reasoning. Routing logic must be smart enough to pick the right
  tier from bug context.

#### Option Y — Create dedicated `bugfix-builder` agent

Single new agent that handles ALL bug-fix dispatches regardless of
tier. Loads `architecture.yaml.tooling.stack` at dispatch-time to
know which stack-skill to consult.

- **Pros**: System prompt optimized for bug-fix workflow specifically
  (skip feature-build guidance, focus on minimal-diff + targeted
  edits). Smaller prompt = potentially faster prompt parsing +
  skill-pack hydration (partial H5 win). Cross-stack — no upfront
  routing decision needed; agent figures out tier from the failing
  file path.
- **Cons**: New agent surface to author + maintain. Loses tier-
  specific deep knowledge UNLESS we load ALL stack skills
  conditionally — which negates the "smaller prompt" benefit. The
  factory's existing builders are already good at fixing specific
  files when pointed at them; the slowness is in routing + sequence
  length, not agent quality.

#### Option Z — Hybrid: existing builders + `bugFixMode` dispatch flag

Keep existing tier-specific builders. Add a `bugFixMode: true` field
to the `InvokeAgentArgs` so the dispatcher prepends a short
"bug-fix prefix" to the system prompt that:

- Names the explicit allowed-paths from bug.affectsFiles[]
- Enables aggressive minimal-diff bias (the agent shouldn't
  refactor; it should land the smallest possible patch)
- Skips feature-build sections of the agent's stack-skill
  (e.g. don't reload §1c page-root rendering rules when fixing a
  utility function)
- Includes the captured stderr / failure context up front
  (forward from bug.errorLog and verifier warnings — this is
  bug-057's overlap)

Dispatch resolution: `defaultAgentSequence` picks the right tier
(Option X's routing) AND sets `bugFixMode: true` (Option Y's prompt
optimization).

- **Pros**: Best of both — tier-specific knowledge + bug-fix-
  optimized prompt. No new agent definition file. Reusable across
  classes. The flag-based prompt-mode pattern is small surface area.
- **Cons**: Requires modifying each existing builder's agent prompt
  (4 files: web-frontend-builder.md, backend-builder.md,
  mobile-frontend-builder.md, plus the dispatch context). Conditional
  prompt branching adds cognitive load to the agent definition.

#### Decision criteria

After Steps 1+2 collect per-agent timing:

- **If builder wallMs is mostly reasoning (8-12min/dispatch) and
  prompt-warmup is < 60s** → reasoning is the cost, not prompt
  hydration → **Option X** (route to existing). Simplest path.
- **If builder wallMs has significant warmup (60-120s before any
  tool call) AND reasoning is short** → prompt hydration is the
  cost → **Option Z** (hybrid prefix). The bugFixMode flag would
  trim hydration time meaningfully.
- **If wallMs is split evenly across all 3 agents AND builder
  reasoning is short** → tester + reviewer are the dominant cost
  → **Step 4 alone** (trim sequence) gets us most of the way;
  routing + agent shape are second-order.

**Recommended a-priori bias** (without empirical data yet):
**Option X for ship-now**, with **Option Z deferred** until we see
whether sequence-trim + routing alone cuts wall-clock to acceptable.
Rationale: Option X requires zero new agent definitions; Option Z
adds complexity that only pays off if prompt warmup is significant.

The b3zwmyp7a empirical data (from this session's currently-running
/fix-bugs) plus Step 1's instrumentation answer the gating question.

### Step 5 — Cause-routing for dev-server-compile / runtime-error (15min)

Extend `defaultAgentSequence` to inspect the bug's flow + warnings
for backend-tier signals. Heuristics:

- Warnings contain `"backend"` OR `"http://localhost:300[1-9]"` →
  route to `backend-builder`
- Warnings contain `"frontend"` OR `"http://localhost:3000"` →
  route to `web-frontend-builder`
- Stack-trace mentions `apps/api/` → `backend-builder`
- Stack-trace mentions `apps/web/` → `web-frontend-builder`

Without enough signal: keep the current default (`web-frontend-builder`).

### Step 6 — Bug-summary enrichment (10min)

Currently `bug.summary` for dev-server-compile is `'Dev-server
compile error during tooling-pre-flight: '` (empty after colon).
The verifier captures the stderr in warnings; propagate the last
500 chars into `summary` AND `retryContext.errorMessage` so the
agent has a real starting point. This alone may cut per-bug
agent reasoning time by 30-60% by removing the
"figure out what's broken from nothing" overhead.

### Step 7 — Optional: SDK warmup measurement (5min)

If H5 turns out true (per-agent SDK overhead is 60-90s × 3 agents
= 3-5min wasted), look at whether `keepAliveMs` on the agent SDK
client or persistent process pooling saves wall-clock. Probably
DEFER unless Steps 4-6 don't get us to ~5min/bug.

## Findings

(to be populated after Steps 1-6 complete)

### Per-agent timing breakdown (from Step 1+2)

| Bug class                   | Builder wallMs | Tester wallMs | Reviewer wallMs | Total | Breakdown |
| --------------------------- | -------------- | ------------- | --------------- | ----- | --------- |
| dev-server-compile (run #2) | TBD            | TBD           | TBD             | TBD   | TBD       |

### Routing audit (from Step 3)

(file-bug-plan.mjs:730 switch table — confirmed/refuted)

### Proposed agentSequence-by-cause table acceptance (Step 4)

(decision: which entries to ship in the follow-up plan)

## Recommendation

After Steps 1-7, file follow-up plans:

- **feat-058-trim-agent-sequence-per-cause** — apply the table from
  Step 4. Ship priority: P0. Expected wall-clock impact: 2-3x
  faster /fix-bugs runs on common bug classes. Independent of
  Step 4b's agent-shape decision.

- **bug-056-route-dev-server-compile-by-tier-signal** — implement
  Step 5's heuristics. Ship priority: P1. Closes the
  bug-compile-tooling-pre-flight wrong-tier-dispatch waste.
  Compatible with both Option X and Option Z from Step 4b.

- **bug-057-bug-summary-stderr-enrichment** — Step 6. Ship priority:
  P1. Reduces agent reasoning time across all bug classes.
  Subsumes part of Step 4b Option Z's "include captured stderr up
  front" — overlap is intentional; bug-057 lands the data
  enrichment, Z would consume it.

- **(conditional) feat-059-bugfix-mode-prompt-prefix** — Step 4b
  Option Z if empirical data favors it. Ship priority: P2.
  Adds `bugFixMode: true` to `InvokeAgentArgs`; existing builders
  prepend a bug-fix-optimized prompt prefix when set. Defer until
  feat-058 + bug-056 + bug-057 measurements show whether prompt
  warmup is still a bottleneck.

If Step 7 confirms SDK warmup is significant beyond what Z fixes,
file **feat-060-agent-sdk-warm-pool** — keep-alive agent processes
across dispatches. Likely DEFER unless feat-058+056+057+(maybe 059)
don't get us under 5min/bug.

## Attempt Log

(populated during investigation — pending the b3zwmyp7a run completion
for empirical Step 1 data)
