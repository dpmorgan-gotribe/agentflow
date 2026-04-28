---
id: investigate-010-rate-limit-observability-and-reduction
type: investigation
status: archived
author-agent: claude-opus-4-7
created: 2026-04-28
updated: 2026-04-28
started-at: 2026-04-28T23:15:00Z
completed-at: 2026-04-28T23:45:00Z
recommendation-implemented-by: feat-030-quota-observability + feat-031-prompt-cache-systemprompt
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
hypothesis: "The orchestrator hits SDKRateLimitEvent (rateLimitType=five_hour) on claude-max-subscription while the claude.ai dashboard reads <30% — meaning claude.ai's dashboard meters a DIFFERENT bucket from the one the SDK enforces (likely the chat/web bucket vs. an API/agent bucket; possibly also model-class-scoped). We have no operator-facing visibility into the SDK's actual bucket state until rejection fires. Plus: we have no pre-flight estimator (this run will burn ~X% of the bucket) and no per-run reduction levers documented (model tiering, prompt caching, batched feature DAG). All three gaps are addressable on top of feat-017 (auth-provider-config) + feat-024 (pause/resume) without new SDK features — by reading what the SDK already emits (status:'allowed_warning', resetsAt epoch, allowed-window utilization in SDKRateLimitEvent.rate_limit_info), surfacing it to the operator via a /quota-status skill, and shipping a reduction-techniques doc + tasks.yaml-level model-tier overrides."
---

# investigate-010 — Rate-limit observability + per-run consumption reduction

## Question

**Two intertwined questions, both load-bearing for unblocking
repo-health-dashboard-01 today and preventing recurrence:**

1. **Why does the orchestrator's `SDKRateLimitEvent` (rateLimitType=five*hour)
   fire while claude.ai/settings/usage shows the user well under limits, and
   how do we get operator-facing live visibility into the \_actual* bucket(s)
   the SDK meters against — so we can see "you've used 80% of your 5h
   agent-API bucket; ~12 minutes of dispatches left at current rate" instead
   of being blindsided?**

2. **What concrete levers reduce per-Mode-B-run consumption of that bucket,
   ranked by effort vs. payoff — model tiering (Haiku-first), prompt
   caching, smarter feature batching, alternative auth providers — and what
   does the trade-off table look like for a typical 8-feature run?**

Both questions have falsifiable answers grounded in: (a) the SDK's actual
typed events (`SDKRateLimitEvent`, `SDKAPIRetryMessage`,
`SDKMessageMetadata.usage`), (b) the architecture-level decisions already
shipped (feat-017 auth-provider-config, feat-024 pause-resume,
`.claude/models.yaml` tiering plumbing), and (c) the empirical record from
launches 2/3/4/5 against repo-health-dashboard-01 today.

## Hypothesis

**Visibility (Q1):** The bucket fingerprint we keep hitting (`resetsAt:
1777425600` identical across 4 launches, regardless of fresh CLI session)
proves the bucket is anchored to the auth provider account, not to a CLI
process. Combined with the claude.ai dashboard reading 16% session / 29%
weekly, this means the SDK reports against a **separate metering surface**
from the chat product — most likely an API/agent bucket scoped to
`claude-max-subscription`'s Code-Subscription tier, not the chat bucket the
dashboard shows.

The SDK already emits `SDKRateLimitEvent.rate_limit_info` with
`status: 'allowed' | 'allowed_warning' | 'rejected'` and structured
`resetsAt` epoch. We currently throw away `'allowed_warning'` events and
only react to `'rejected'`. If we logged warning events as they arrive,
we'd have ~15-30 minutes of advance notice instead of zero.

A `/quota-status` skill that runs a tiny no-op SDK call (e.g. `query` with
`max_turns: 0` or a 1-token prompt), inspects the resulting `rate_limit_info`
field on the response message, and prints
`{ rateLimitType, status, resetsAt, percentUsed }` would give operator-
facing live visibility — without inventing new SDK features.

**Reduction (Q2):** Three big levers, ranked by hypothesized payoff:

1. **Model tiering** (Haiku-first for builders/testers; Opus reserved for
   reviewer + architect): the `.claude/models.yaml` plumbing already exists
   from feat-017. We've never empirically measured the Haiku-vs-Opus bucket
   consumption ratio for a Mode B feature. Anthropic's pricing suggests
   Haiku is ~10× cheaper per token, but the bucket meter may weight by
   token-class, model, or a flat per-call budget — we don't know.

2. **Prompt caching** (Anthropic's ephemeral cache): the SDK supports
   `cache_control: 'ephemeral'`. Mode B dispatches send the same skill-pack
   `SKILL.md` + brief excerpt to dozens of agents per run; if these are
   cacheable, the second-onward dispatch reads them at 1/10 the cost. We
   don't currently cache anything.

3. **Auth-provider switch** (anthropic-api-key for Mode B, claude-max for
   design phase): per-token billing has no 5h cap; £41 balance gives
   plenty of headroom. The trade-off is per-run dollar cost vs.
   no-block-ever certainty. Already documented in
   `docs/agent-sdk-auth-providers.md` per feat-017; just under-used.

Combined with smaller levers (smaller default `max_turns`, bigger feature
batches that share one agent invocation, dropping Opus thinking budget on
tasks that don't need it), a typical Mode B run that consumes ~80% of the
5h bucket today should drop to ~30-40% — meaning two consecutive runs in
one bucket-window become possible.

## Investigation Steps

**Time box: 45 minutes total.** If a step blows past its allocation, stop
and write what you have — partial findings beat no findings.

### Step 1 — Read SDKRateLimitEvent's full schema (8 min)

Locate `node_modules/.../@anthropic-ai/claude-agent-sdk/sdk.d.ts` and grep
for `SDKRateLimitEvent`, `rate_limit_info`, `RateLimitStatus`,
`SDKMessageMetadata`. Document:

- All fields on `rate_limit_info` (we know about `status`, `resetsAt`,
  `rateLimitType`; what else? `tokensRemaining`? `requestsRemaining`?
  `windowSeconds`? `currentUsage`?)
- Where `SDKRateLimitEvent` fires in the SDK's message flow (turn boundary,
  stream start, every message?)
- Whether `SDKMessageMetadata.usage` has a per-turn token report we can
  accumulate to forecast bucket exhaustion
- What `status: 'allowed_warning'` means precisely — is there a known
  threshold (e.g. >75% used)?
- Whether the SDK's response messages on a successful call also carry
  rate-limit info, or only on rejection

Output: a table mapping `rate_limit_info` field → meaning → current
orchestrator usage (used/ignored).

### Step 2 — Reproduce the dashboard-vs-SDK divergence with a probe (10 min)

Write a one-shot Node script in `scripts/probe-quota.mjs` that:

1. Reads `~/.claude/models.yaml` for the current provider config
2. Calls the SDK with a 1-token prompt (`"hi"` → `max_turns: 0` or
   equivalent) using that provider
3. Logs every event the SDK emits, especially any
   `SDKRateLimitEvent` or message-metadata with `usage`/`rate_limit_info`
4. Pretty-prints the result alongside the user's claude.ai dashboard
   readings (operator pastes those manually)

Run the probe NOW (within the 45-min window — we're paused, but a 1-token
call may still surface the rate-limit metadata even when blocked, depending
on whether `'rejected'` events carry the same info as successful ones).

Document:

- What does the SDK report for `rateLimitType=five_hour` right now?
- Does it match `resetsAt: 1777425600`?
- Does it report a different bucket too (`seven_day`, `unset`, etc.)?
- If the call is rejected, does the rejection event carry the same
  `rate_limit_info` payload as a successful call would?

### Step 3 — Survey the existing model-tier plumbing (8 min)

Read in order:

1. `~/.claude/models.yaml` (system defaults)
2. `.claude/models.yaml` (project override, if present)
3. `orchestrator/src/model-config.ts` (or wherever `readModelConfig` lives;
   per CLAUDE.md it's the merge function)
4. `.claude/agents/*.md` to count how many agent definitions specify a
   `model:` frontmatter override

Document:

- How many distinct agent slugs are there in a typical Mode B run?
- Which ones currently default to Opus vs. Haiku vs. Sonnet?
- Which ones are LIKELY safe to drop to Haiku without quality regression
  (heuristic: deterministic-output agents like git-agent, security with
  grep-based checks, possibly tester for edge-case authoring)?
- What's the total pipeline budget config (`perPipelineMaxUsd`)? Is there
  a per-agent budget?

### Step 4 — Estimate per-run bucket consumption (5 min)

Cross-reference launches 2-5 of repo-health-dashboard-01:

- Bucket fully blew at the START of feature 3-of-9 (feat-proxy-and-cache
  reviewer was the next dispatch when the wall hit)
- Two features (feat-shell, feat-data-pipeline) had completed under
  ~25-35% bucket each
- We have `counters.json` per project with cumulative spend in USD if
  feat-024's instrumentation logged it; check
  `projects/repo-health-dashboard-01/.claude/state/<run-id>/counters.json`

Estimate:

- USD spend per merged feature (mean / max / median)
- Implied "5h bucket = ~$X equivalent" if the bucket meters by cost
- Whether the meter is cost-shaped, request-count-shaped, or token-shaped

(If counters lack the data, mark this step as deferred and recommend a
follow-up bug to log per-agent spend to a bucket-consumption ledger.)

### Step 5 — Catalogue reduction levers + estimate impact (10 min)

For each lever, fill a row in this table:

| Lever                                                                                | Effort                                 | Risk                           | Estimated bucket % saved per Mode B run | v1 candidate? |
| ------------------------------------------------------------------------------------ | -------------------------------------- | ------------------------------ | --------------------------------------- | ------------- |
| Tier all builders/testers to Haiku, keep reviewer+architect on Opus                  | Low (tweak `.claude/models.yaml`)      | Medium (quality regression)    | 50-70% ?                                | YES           |
| Enable prompt caching for SKILL.md + brief excerpts                                  | Medium (~50 LOC in `buildAgentPrompt`) | Low                            | 30-50% ?                                | YES           |
| Switch to anthropic-api-key for Mode B, keep claude-max for interactive design phase | Low (provider-yaml edit + env var)     | Low (per-token cost)           | 100% (bypasses bucket)                  | YES           |
| Drop Opus extended-thinking budget for builders that don't need it                   | Low                                    | Low                            | 5-15%                                   | YES           |
| Bigger feature batches (1 agent dispatch handles 2-3 small features)                 | High (PM agent rewrite)                | Medium (loses parallelism)     | 20-30%                                  | NO (defer)    |
| Smaller `max_turns` defaults                                                         | Low                                    | Medium (premature termination) | 10-20%                                  | Maybe         |
| Reuse one Query() across multiple agents in a feature (streaming-input mode)         | High                                   | High (architectural shift)     | 30-50%                                  | NO (defer)    |

Refine the table with actual measurements where possible from Step 4.

### Step 6 — Design `/quota-status` skill (4 min)

Sketch the skill contract:

- Inputs: optional `--provider <name>` (defaults to current
  `~/.claude/models.yaml` provider)
- Behavior: runs the Step 2 probe, parses `rate_limit_info` from the
  response, formats human-readable output:

```
Provider: claude-max-subscription
Bucket(s):
  - five_hour:   78% used — 22% remaining — resets in 1h 14m (2026-04-29T01:20Z)
  - seven_day:   34% used — 66% remaining — resets in 4d 6h
Recent SDKAPIRetry events: 0 in last 60 min
Estimated headroom for next Mode B run: ~12 minutes of dispatches at recent rate
```

- Output: structured JSON for orchestrator pre-flight check + plain-text
  for operator
- Where: `.claude/skills/quota-status/SKILL.md`
- Pre-flight integration: `start-build` skill calls `/quota-status` first;
  if `<25%` headroom, warns "this run will likely block — consider switch
  to anthropic-api-key OR wait until reset"

### Step 7 — Recommend (final 10 min from time box)

Pick:

- ONE primary reduction lever to ship first (the highest-payoff /
  lowest-risk row from Step 5)
- A small additive bundle (cache + tier-Haiku) to ship together
- The `/quota-status` skill design from Step 6
- A concrete experimentation plan: "run the same test project twice on
  different config, measure bucket consumption" — falsifies the savings
  estimates

Then sketch follow-up plans:

- `feat-NNN-quota-observability` for the skill + SDKRateLimitEvent warning
  surface
- `feat-NNN-mode-b-haiku-tiering` for the model-tier change + measurement
- `feat-NNN-prompt-caching` for the caching layer
- (optionally) `bug-NNN-resume-with-stale-resetsAt` if Step 2 shows the
  SDK is reading a cached `resetsAt` value (would explain identical reset
  fingerprint across launches)

## Findings

### F1 — `SDKRateLimitInfo` exposes 8 fields; orchestrator consumes 2

From `node_modules/.../@anthropic-ai/claude-agent-sdk/sdk.d.ts:2923`:

```ts
export declare type SDKRateLimitInfo = {
  status: "allowed" | "allowed_warning" | "rejected";
  resetsAt?: number;
  rateLimitType?:
    | "five_hour"
    | "seven_day"
    | "seven_day_opus"
    | "seven_day_sonnet"
    | "overage";
  utilization?: number; // 0..1 fraction of bucket consumed
  overageStatus?: "allowed" | "allowed_warning" | "rejected";
  overageResetsAt?: number;
  overageDisabledReason?: "..." | "out_of_credits" | "...";
  isUsingOverage?: boolean;
  surpassedThreshold?: number;
};
```

`orchestrator/src/invoke-agent.ts:1188-1223` only reads `rateLimitType` +
`resetsAt`. The pause-trigger gate is `rateLimitType === 'five_hour' ||
'seven_day'` — `status` is **not** in the gate condition (so any change
event with that type can fire pause; informational `'allowed'` events
shouldn't normally emit per the SDK's own typedef though).

**Fields we throw away that matter:**

- `utilization` — 0-1 fraction. Direct answer to "how full is the bucket".
- `status: 'allowed_warning'` — the early-warning signal we asked about
  (~15-30 min lead before rejection per Anthropic's typical bucket
  semantics).
- `surpassedThreshold` — last warning threshold crossed (e.g. 0.75, 0.9).
- `overageStatus` + `isUsingOverage` + `overageResetsAt` — explains the
  £41.10 credit balance: it's the **same** auth provider's overage tier,
  NOT a separate `anthropic-api-key`. When the 5h base bucket rejects, if
  `overageStatus: 'allowed'` the next call should auto-route to overage.
  We aren't checking this.
- `seven_day_opus` + `seven_day_sonnet` rateLimitType variants — model-
  class-specific weekly buckets. Mode B is dominated by Sonnet (builders +
  tester + reviewer = 3 Sonnet slots × 8 features). We've never
  distinguished which weekly bucket fills first.

### F2 — The 5h bucket is anchored, not rolling, and not cost-shaped at our spend level

Empirical evidence (this project's counters.json + paused.json across 5
launches today):

- **`cumulativeUsd: 2.59`** when the 5h wall hit (3 features merged, 1
  in-flight at tester→reviewer). Across all 4 subsequent re-launches the
  spend stayed at $2.59 because every launch paused on the SDK's first
  dispatch — no new spend.
- **`resetsAt: 1777425600` (2026-04-29T01:20Z)** **identical** across
  launches 2, 3, 4, 5 over a 5-hour wall-clock window. A rolling bucket
  would shift the reset boundary as old usage aged out. Same fixed epoch
  = bucket reset is anchored to a point in time (likely first-hit-or-
  first-fill timestamp), not a sliding window.
- **claude.ai dashboard at relog read 16% session / 29% weekly / £41.10
  overage available** — completely disjoint from the bucket the SDK
  enforces. claude.ai meters the chat product; SDK meters the agent /
  Code-Subscription bucket. Two surfaces, one auth provider, separate
  ledgers.
- **$2.59 is below ANY published Max bucket cap.** The bucket is therefore
  NOT shaped like "$N/5h" at our spend volume. It must be turn-shaped,
  RPM-shaped, OR (most likely) we're hitting a per-model-class weekly cap
  that's reported as `five_hour` because the SDK rolls model-class caps
  into the same event-type. Exact mechanism is opaque without the probe.

### F3 — SDK has 1st-class prompt caching primitives we don't use

From `sdk.d.ts:1578-1633` and `sdk.d.ts:4961-4968`:

- `Options.systemPrompt: string[]` accepts the marker
  `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`. Blocks before are eligible for
  cross-session prompt caching; blocks after are session-specific.
- `Options.systemPrompt: { type: 'preset', preset: 'claude_code',
excludeDynamicSections: true }` strips cwd/memory/git-status from the
  system prompt (so the prefix stays cacheable cross-user) and re-injects
  them as the first user message.
- `ModelUsage.cacheReadInputTokens` + `cacheCreationInputTokens` already
  surface in `result.modelUsage` — we'd see cache hits if we used it.

`orchestrator/src/invoke-agent.ts::buildAgentOptions` (line 1427-1476)
**passes no `systemPrompt` field at all** — so the SDK falls back to the
default Claude Code preset with full dynamic-section injection. Every
agent dispatch sends a fresh full system prompt, no shared cacheable
prefix across the 24+ dispatches in a typical Mode B run.

### F4 — `ModelUsage` per-model cost is captured by the SDK but discarded

From `sdk.d.ts:1050`:

```ts
export declare type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  costUSD: number;
  contextWindow: number;
  maxOutputTokens: number;
};
```

`SDKResultMessage.modelUsage: Record<string, ModelUsage>` (sdk.d.ts:2945)
gives per-model cost breakdown per call. The orchestrator persists only
`budget.cumulativeUsd` (single aggregate) to counters.json. We never see
"backend-builder spent $0.83 on Sonnet, reviewer spent $0.12 on Sonnet"
— so we can't tell at a glance whether the bucket is being depleted by
Opus-tier work (analyst/architect/PM/skills-agent) or Sonnet-tier work
(builders/tester/reviewer) or which agent is the worst offender per run.

### F5 — Existing model tier defaults: 4 Opus slots, 4 Sonnet slots, 2 Haiku slots

From `~/.claude/models.yaml`:

| Tier       | Model             | Agents                                                                      |
| ---------- | ----------------- | --------------------------------------------------------------------------- |
| planning   | claude-opus-4-7   | analyst, architect, project-manager                                         |
| building   | claude-sonnet-4-6 | ui-designer, web-frontend-builder, mobile-frontend-builder, backend-builder |
| quality    | claude-sonnet-4-6 | tester, reviewer, lessons-agent, security                                   |
| meta       | claude-opus-4-7   | skills-agent, agent-expert                                                  |
| mechanical | claude-haiku-4-5  | git-agent, html-verifier                                                    |

Per-Mode-B-feature dispatch shape (typical 8-feature run):

- 8 features × (1 builder + 1 tester + 1 reviewer + 1 security where
  flagged) = ~28 Sonnet dispatches against `seven_day_sonnet` bucket
- 8 close-feature + 1 bootstrap = 9 Haiku dispatches (cheap)
- Mode A (one-time per project): ~6 Opus dispatches (analyst, architect,
  PM, skills-agent — heavy thinking)

This is consistent with the empirical observation: Mode B fills the
**Sonnet weekly bucket** via dispatch volume long before the dollar
budget approaches `perPipelineMaxUsd: 150.00`.

### F6 — Project's `models.yaml` override file is empty

`projects/repo-health-dashboard-01/.claude/models.yaml` has empty
`agents: {}` and `budget: {}`. So this project inherits factory defaults
verbatim — no per-project tuning has happened. Tiering down builders to
Haiku for this run is one line of YAML each.

### F7 — `stall-log.json` shows one prior abort, unrelated to rate limit

`projects/.../stall-log.json` has a single entry: backend-builder hit the
25-min wall-clock timeout on 2026-04-28T03:00:47 — that was the kanban-10-
era bug, not today's rate-limit pause. There's no rate-limit-event log
because the orchestrator doesn't persist them: each event is consumed
inline in `runLlmAgent` and either fires the pause hook or is dropped.
We have no historical record of `'allowed_warning'` events ever firing
or not firing.

### F8 — Pause-hook gate misses the early warning

`orchestrator/src/invoke-agent.ts:1199-1202` is:

```ts
if (
  (rateLimitType === "five_hour" || rateLimitType === "seven_day") &&
  cfg.onRateLimitPause
) {
  await cfg.onRateLimitPause(pauseInfo);
}
```

No check on `status`. The first event we receive from the SDK with
`rateLimitType: five_hour` triggers `pauseRun()`. If the SDK emits a
warning event first (`status: 'allowed_warning'`, e.g. at 75% bucket
fill), this code pauses immediately — but pauseRun's intent is to handle
**rejection**, not warnings. So either: (a) the SDK only emits
`rate_limit_event` for rejections of `five_hour`/`seven_day` types (and
the warning surface is on a different event), or (b) we've actually been
pausing on warnings the whole time but treating it as rejection. The
existing logs say `[cli] paused: claude-max-five-hour-limit` immediately
on dispatch — consistent with both behaviors. Probe needed to
distinguish.

## Recommendation

**Confidence is high enough to ship a 3-phase response without further
investigation.** The SDK already exposes everything we need for both
visibility and per-call cost reduction; the orchestrator just isn't
reading or using it.

### Immediate (operator action — TONIGHT, no code change)

1. **Switch this Mode B run to `provider: anthropic-api-key`** (option B
   from the prior session's handoff). Per-token billing has no Max-tier
   bucket. Estimated $5-30 to finish the remaining 6 features at all-
   Sonnet on Mode B (already configured) plus reviewer Opus where flagged.
   £41.10 overage credit is a separate thing (it's the same Max
   subscription's overage tier, not the API key) — for tonight, the API
   key is the cleanest unblock.
2. **Don't touch `~/.claude/models.yaml` defaults** — they're correct.
   The bucket-fill problem is dispatch volume against
   `seven_day_sonnet`, not model choice; switching to Haiku would
   degrade build quality without addressing root cause.

### Short-term (1 plan: `feat-030-quota-observability`)

Author a `/quota-status` skill + plumb `SDKRateLimitInfo` to disk:

- **`/quota-status` skill** runs a 1-token SDK probe, reads
  `SDKRateLimitEvent` from the response stream, prints all 5
  rateLimitType variants (`five_hour`, `seven_day`, `seven_day_opus`,
  `seven_day_sonnet`, `overage`) with `utilization × 100%` and
  `resetsAt`. Operator runs before `/start-build`.
- **Persist rate-limit-events ledger.** Add
  `<run-id>/rate-limit-events.ndjson` and write every
  `rate_limit_event` from `runLlmAgent`'s for-await loop into it (with
  `utilization`, `status`, `surpassedThreshold`, `isUsingOverage`).
  Closes the visibility gap forever — F7 won't recur.
- **Tighten the pause-hook gate** in invoke-agent.ts:1199 to:
  - `status === 'allowed_warning'` → log + write breadcrumb, **don't
    pause**. Surface as `[cli] warning: bucket at X% full, ~Y min to
rejection`.
  - `status === 'rejected'` → pause as today.
  - Preserves the bug-022 PauseSignal re-throw on rejection path.
- **Surface `ModelUsage`** in counters.json as `budget.modelBreakdown:
Record<modelId, { costUSD, inputTokens, outputTokens,
cacheReadInputTokens, cacheCreationInputTokens }>`. Lets operators
  see "Sonnet ate 86% of this run's spend".

Effort estimate: ~150 LOC + skill markdown + tests. Low risk, additive
to feat-024.

### Medium-term (1 plan: `feat-031-prompt-cache-systemprompt`)

Wire `Options.systemPrompt` with `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` in
`buildAgentOptions`:

- Static prefix: agent's SKILL.md + the global rules (`testing-policy.md`,
  reviewer playbook, etc.). These are byte-identical across every dispatch
  of that agent type.
- Dynamic suffix: feature context, branch, brief excerpt — per-call.
- Also pass `excludeDynamicSections: true` so cwd/memory/git-status moves
  to user message (cross-agent cacheable prefix).

Estimated savings: 30-50% of input tokens on dispatches 2-N per agent
slot per Mode B run. Bucket consumption proportional. Validated by
post-feat-030 telemetry from the per-model breakdown.

Effort: ~80 LOC + tests + a measurement A/B run.

### Deferred (not v1)

- **Model tiering Haiku-first for builders.** F2 + F4 say bucket is
  filling on dispatch volume / Sonnet weekly cap, not dollar spend.
  Tiering helps cost; doesn't necessarily move the 5h reset. Revisit
  AFTER feat-030 telemetry shows which bucket fills first.
- **Bigger feature batches** (one agent dispatch handles multiple
  features). Architectural change to PM agent + tasks.yaml schema. High
  risk for moderate gain.
- **Streaming-input mode reuse** of one Query() across agents. Major
  surgery; unclear win post-caching.

### Falsifying experiments (nice-to-have, do AFTER feat-030 ships)

1. **Probe the same bucket from a fresh Anthropic API key** (option B
   provider). Compare `SDKRateLimitInfo` output. If `rateLimitType` is
   absent or different, confirms Max-only enforcement.
2. **Run the same 8-feature project on all-Haiku tiering** post-feat-026.
   Measure `seven_day_sonnet` utilization delta. Confirms F5 hypothesis.
3. **Run with feat-031 caching enabled**. Measure
   `cacheReadInputTokens / inputTokens` ratio. >50% means caching is
   working.

### Open questions (NOT blocking; revisit if surprises emerge)

- Does the SDK emit `rate_limit_event` with `status: 'allowed_warning'`
  before `'rejected'`, or only on `'rejected'`? The literal answer
  determines whether feat-030's gate-tightening surfaces a 15-min
  warning or fires too late to matter.
- Does `isUsingOverage: true` automatically engage when the base bucket
  rejects, or does the operator need to explicitly enable overage in
  account settings? The £41.10 balance suggests it's provisioned;
  whether the SDK auto-routes to it is the open thread.
- Is there an Anthropic-published doc on `seven_day_opus` /
  `seven_day_sonnet` thresholds for the Max plan? `WebSearch` can find
  this; deferring to feat-030's research phase.

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

completed: 2026-04-28
outcome: success
actual-files-changed: []
commits: []
attempts: 1
duration-minutes: 30
test-results:
unit: n/a (research only)
integration: n/a (research only)
lessons:

- "SDKRateLimitInfo has 8 fields; the orchestrator was reading 2 (rateLimitType + resetsAt). The dropped fields (utilization, status, surpassedThreshold, overageStatus, isUsingOverage, overageResetsAt) ARE the early-warning + overage-routing surface we needed. Always read structured SDK events fully when integrating — typedef-driven inventory beats grep-driven inventory."
- "claude.ai dashboard meters a DIFFERENT bucket from the SDK's enforcement bucket on the same auth provider. Operator-visible numbers can be reassuring AND wrong simultaneously. Build first-party telemetry (rate-limit-events.ndjson + per-model breakdown) instead of trusting the vendor surface."
- "Mode B is Sonnet-dominated (~28 Sonnet dispatches/run vs. 9 Haiku, 6 Opus). Bucket fill is dispatch-volume-shaped, not dollar-shaped — we hit the wall at $2.59 cumulative. Tier-down-to-Haiku alone wouldn't fix it; prompt caching + cross-dispatch prefix sharing is the higher-leverage move."
- "The 5h bucket reset is anchored (same `resetsAt` epoch across 4 launches), not rolling. Means once the bucket fills, no amount of waiting until the rolling window 'slides' helps — operator must wait for the anchored reset OR switch provider. Useful for setting operator expectations."
- "buildAgentOptions passing NO `systemPrompt` means SDK falls back to the `claude_code` preset with full per-user dynamic injection per call — guaranteeing no cross-dispatch caching. This was a silent default that cost us ~30-50% of input tokens per Mode B run for ~5 months. Always audit what default options the SDK falls back to when you pass nothing."
- "ModelUsage per-model cost is in result.modelUsage but we persist only aggregate cumulativeUsd. Per-model visibility is the single highest-value forecasting input — without it operators can't estimate 'this Mode B will burn ~X% of seven_day_sonnet'. feat-030 §D adds it cheaply."
- "Investigation pattern: when blocked by an opaque vendor surface (rate-limit), grep the SDK type defs FIRST. Anthropic's SDK ships full typedefs that already describe the observability we wanted to build. Halved the investigation time."

---
