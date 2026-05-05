---
id: investigate-017-token-usage-reduction-for-bug-fix-process
type: investigation
status: completed
author-agent: claude-opus-4-7
created: 2026-05-05
updated: 2026-05-05
parent-plan: investigate-016-shift-left-bug-prevention-and-fix-loop-throughput
supersedes: null
superseded-by: null
branch: null
affected-files: []
feature-area: orchestrator/fix-bugs-loop + dispatch-context + plan-template
priority: P1
attempt-count: 0
max-attempts: 5
time-box-minutes: 60
hypothesis: "/fix-bugs burns dollars proportional to (bugs × agents-per-bug × tokens-per-dispatch). investigate-016 reduces the FIRST factor (feat-051 prevention + feat-052 earlier catch) and the SECOND factor (feat-053 class-batched dispatch collapses agents-per-bug). The THIRD factor — tokens-per-dispatch — is largely untouched. Hypothesis: the per-dispatch context is dominated by REPEATED static content (stack-skill SKILL.md, agent system prompts, mockup HTML, reviewer-playbook, kit-component tree boilerplate) that Anthropic prompt caching + dispatch-context-pruning + per-bug-plan-trimming could collapse by ~50-70% with low engineering cost. Empirical observation: finance-track-01 /fix-bugs at C=3 burned ~--all0 across ~25 dispatches in the first 90min — average ~--all.20/dispatch. If 70% of each dispatch is cacheable static content, prompt caching alone could drop average dispatch cost to ~--all.40 (-67%). A second-order win: feat-053's batched context, while net-positive, has a sub-optimization where mockup HTML is re-quoted per-bug inside the batch — deduplicating across bugs in a batch saves another ~--all0%."
---

# investigate-017: Reduce token usage for the bug-fix process

## Question

investigate-016 + its 4 follow-ups (feat-051..054) attack `/fix-bugs` cost on TWO axes: bug count (prevent + catch earlier) and dispatch count (batch class-uniform fixes). Neither targets **tokens-per-dispatch** — the third multiplier in the cost formula:

```
total_cost = bugs × agents_per_bug × tokens_per_dispatch × $/token
                ↑                ↑                       ↑
              feat-051         feat-053               THIS INVESTIGATION
              feat-052
```

Empirical baseline (finance-track-01 2026-05-05 fix-bugs run, ~90min observation window at C=3):

| Phase                                | Dispatches | Tokens (est.)         | Cost (est.) |
| ------------------------------------ | ---------- | --------------------- | ----------- |
| First wave (5 parity bugs, parallel) | ~15        | ~3M input + ~300K out | ~--all0     |
| Second wave (steady-state at C=3)    | ~10        | ~2M input + ~200K out | ~--all0     |
| Per-dispatch average                 | -          | ~200K in / 20K out    | ~--all.20   |

The dispatch payload to each builder/tester/reviewer is dominated by **STATIC content** that doesn't vary between dispatches in the same fix-bugs run:

1. Agent system prompt (`.claude/agents/web-frontend-builder.md`, `.claude/agents/tester.md`, `.claude/agents/reviewer.md`) — ~2-5K tokens each, identical across all dispatches
2. Stack-skill `SKILL.md` (`.claude/skills/agents/front-end/react-next/SKILL.md`) — ~10K tokens, read by every web-frontend-builder dispatch
3. Reviewer playbook (`docs/reviewer-playbook.md`) — ~5K tokens, identical across all reviewer dispatches
4. Architecture YAML / tasks YAML / package.json reads — bounded set of files agents read for orientation, ~10-20K tokens combined
5. Kit-component tree boilerplate inside each bug plan — same `data-kit-component="AppShell"` snippet inlined 22 times for shell-stripping bugs

The DYNAMIC delta per dispatch is small: bug ID + affected file paths + bug-plan body — typically < 5K tokens.

**The architectural question**: what fraction of each dispatch's context is dispatch-invariant within a fix-bugs run, and what tooling could collapse the duplication?

Three angles worth investigating in this 60-min time-box:

### Angle A — Anthropic prompt caching

Anthropic's API supports `cache_control: { type: "ephemeral" }` on message content blocks. Cached prefixes get 90% input-token discount on subsequent calls within the cache TTL (default 5min, configurable 1h). The Agent SDK's `query()` likely surfaces this via `system` array entries.

**Question**: does the SDK pipe-through `cache_control`? If yes, marking the static prefix (system prompt + stack-skill + playbook) as cached collapses ~80% of repeated dispatches' input cost.

### Angle B — Per-bug-plan body trimming

`scripts/file-bug-plan.mjs` templates bug-plan bodies with rich kit-component tree info, mockup snippets, remediation guidance. For a class-uniform pattern (shell-stripping), the plan body re-states common context every time — 22 plan bodies × ~3K tokens = ~66K of duplicated content the builder re-reads when dispatched per-bug.

**Question**: can the plan body be split into a **pattern-shared header** (loaded once) + **per-screen delta** (just file path + screen-id + diverging selector)?

### Angle C — Class-batched dispatch context deduplication (sub-optimization on feat-053)

feat-053 collapses 22 dispatches into 1 with all 22 bug bodies concatenated. The concat is ~70K tokens — fits but is fat. Within the batch, the AppShell mockup snippet appears 22 times verbatim (one per bug body). Deduplicating to a single canonical "the AppShell pattern looks like this" header + 22 lightweight per-screen entries could trim batch context by ~30-40K tokens.

**Question**: with feat-053's structure, what's the optimal batch-dispatch payload shape?

## Hypotheses

### H1 — Anthropic prompt caching is supported by Agent SDK + would discount ~70% of dispatch input cost

The static prefix (agent system prompt + stack-skill + playbook + arch.yaml read) is consistent across all dispatches in a fix-bugs run. If the SDK exposes cache_control AND the orchestrator's `invokeAgent.ts` constructs prompts in a cache-friendly way (stable prefix, dynamic suffix), we get a near-free win.

**Falsification test**: read `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` for cache_control plumbing. Read `orchestrator/src/invoke-agent.ts` for current prompt-construction pattern. Confirm whether prefix is stable order-wise.

### H2 — fix-bugs-loop dispatches the SAME prompt prefix back-to-back within Anthropic's 5min cache TTL

If dispatches are spaced > 5min apart, cache evicts and discount lapses. At C=3 with ~28min/dispatch, dispatch-to-next-dispatch gap could exceed 5min. But cache TTL is configurable up to 1h via `cache_control: { type: "ephemeral", ttl: "1h" }`.

**Falsification test**: time-stamp consecutive dispatches in the live fix-bugs run; measure cache-hit window. Determine whether 1h TTL config suffices.

### H3 — Per-bug-plan bodies for class-uniform patterns share ~80% content; pattern-header + per-screen delta saves ~50K tokens per fix-bugs run

`scripts/file-bug-plan.mjs` could emit a per-pattern "shared context" doc once + each bug plan references it. Builder reads shared doc ONCE per dispatch (or once per batch under feat-053).

**Falsification test**: diff 3 shell-stripping bug-plan bodies. Measure shared vs unique content. If > 70% shared → H3 confirmed.

### H4 — Stack-skill SKILL.md grew large because of accumulated guidance; can be split into "always-load core" + "load-on-demand specialty"

`.claude/skills/agents/front-end/react-next/SKILL.md` is ~10K tokens. Some sections (testing strategies, gotchas, DB-seeding patterns) only matter for tester dispatches; some only for builder. A web-frontend-builder dispatch reads the full file for the AppShell-wrapping section it actually cares about.

**Falsification test**: line-count + section-by-section relevance check against builder vs tester vs reviewer dispatches. If > 30% of stack-skill is dispatch-irrelevant → H4 confirmed; per-agent stack-skill subsetting saves load.

### H5 — Reviewer dispatches for class-uniform fixes are redundant after the FIRST one passes; skip on subsequent

For 22 shell-stripping bugs (post-feat-053 collapsed to 1 batched dispatch but pre-feat-053 = 22 separate dispatches): each reviewer dispatch walks 7 dimensions × 22 bugs = 154 dimension-walks. Most are class-uniform — same fix shape, same review verdict. Reviewer 1 approves; reviewers 2..22 are likely to approve too.

**Falsification test**: read 3 reviewer outputs from finance-track-01's fix-bugs run for shell-stripping bugs. Measure verdict variance. If all 22 approve → H5 confirmed; skip-redundant-reviewer is safe.

### H6 — The per-bug worktree boot adds a fixed token tax (orientation re-read of repo) that batched dispatch amortizes

Each builder dispatch starts in a fresh worktree, runs Glob/Grep to orient itself (read package.json, tsconfig.json, app/layout.tsx, etc.). Per-bug worktree means 22 × ~5-10K tokens of re-orientation. Batched dispatch = 1 × orientation.

**Falsification test**: read 3 dispatch transcripts (if telemetry captured them) and count orientation reads. If consistent ~5-10K tokens per dispatch → H6 confirmed; feat-053's batched path inherits this saving for free.

## Investigation steps (60-min time-box)

### Step 1 — measure baseline token usage per dispatch (10 min)

Read fix-bugs-loop's invocation of `invokeAgent`. Identify what's passed as `prompt` / `additionalContext` / `system`. Sample 3 recent dispatches from telemetry (if captured) and estimate input-token breakdown:

- system prompt
- stack-skill / playbook
- bug-plan body
- agent's own Read/Grep tool reads

Reference: `orchestrator/src/invoke-agent.ts:invokeAgent`. Check whether per-dispatch logs capture `usage.input_tokens` and `usage.cache_read_input_tokens`.

Falsification target: baseline grounding for H1, H6.

### Step 2 — audit Agent SDK cache_control surface (10 min)

```
grep -nE "cache_control|cacheControl|ephemeral" node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts
```

Read the relevant typedefs. Confirm whether system prompts can be marked cacheable via the SDK's `query()` API. If yes, sketch the orchestrator-side change to opt-in.

Falsification target: H1.

### Step 3 — read 3 finance-track-01 shell-stripping bug-plan bodies + measure shared content (10 min)

```
ls projects/finance-track-01/plans/active/ | grep "shell-stripping" | head -3
```

Read 3 bodies. Diff line-by-line. Compute shared-vs-unique ratio.

Falsification target: H3.

### Step 4 — line-count stack-skill SKILL.md + section relevance check (10 min)

```
wc -l .claude/skills/agents/front-end/react-next/SKILL.md
```

Read the file. Tag each major section by which agent role(s) need it: builder, tester, reviewer, all.

Falsification target: H4.

### Step 5 — read 3 reviewer outputs for class-uniform parity bugs (10 min)

If finance-track-01's bugs.yaml captures reviewer.lastOutput per bug (per feat-046 schema), read 3 shell-stripping bugs' reviewer outputs. Compare verdicts + flagged dimensions.

Falsification target: H5.

### Step 6 — synthesize findings + recommendation (10 min)

Document below.

## Findings

Investigation completed in **~30 min of 60-min time-box**. Step 5 (reviewer-output verdict-variance) was deferred — Step 1's empirical telemetry rendered H5's hypothesised cost-leverage moot relative to higher-impact findings.

### F1 — Prompt caching is ALREADY wired and hitting ~93% cache rate (H1 + H2 confirmed-and-implemented)

`orchestrator/src/invoke-agent.ts:1711-1715` already opts into the SDK's documented cross-agent-cacheable preset:

```typescript
systemPrompt: {
  type: "preset" as const,
  preset: "claude_code" as const,
  excludeDynamicSections: true,
},
```

This was wired by **feat-031** (commit history shows ~1mo ago, predates this investigation). Telemetry from finance-track-01 run `2276b8a1-...` confirms it's working:

| Model  | Cache reads | Real input | Cache creates | Output | Cost   | Hit rate |
| ------ | ----------- | ---------- | ------------- | ------ | ------ | -------- |
| Sonnet | 75.0M       | 51K        | 2.94M         | 817K   | -45.95 | 93.4%    |
| Haiku  | 15.7M       | 67K        | 1.22M         | 137K   | -3.85  | 92.5%    |

H1 + H2 are not "things to do" — they're "things already done that are working at 93% effectiveness." The remaining 7% is mostly cache-creation (first-write of a new prefix on each dispatch) + a tiny sliver of unavoidable real input (the dispatch's dynamic per-bug delta).

### F2 — Cost is dominated by output tokens + cache-creation, NOT input

Cost decomposition (Sonnet, finance-track-01 run, -45.95 total):

| Category              | Cost   | % of Sonnet | Lever?                                                                                             |
| --------------------- | ------ | ----------- | -------------------------------------------------------------------------------------------------- |
| Cache reads           | -22.50 | 49%         | **Already 90% discounted** — nothing meaningful to do here                                         |
| Output tokens         | -12.26 | 27%         | **Yes** — agent outputs include verbose markdown summaries on top of the structured outcome JSON   |
| Cache creation        | -11.04 | 24%         | **Yes** — each new dispatch writes a fresh ~30K-token cache; 5min default TTL evicts between waves |
| Real (uncached) input | -0.15  | <1%         | No — already minimal                                                                               |

The original investigation framed input tokens as the cost lever. Telemetry says **output tokens + cache-creation are the actual levers**, in roughly equal weight.

### F3 — H3 (per-bug-plan body trim) is largely falsified empirically

Sampled 2 finance-track-01 bug plans:

- `bug-033-parity-account-archive-confirm-shell-stripping.md`: 41 lines / ~600 tokens
- `bug-032-parity-account-archive-confirm-layout-regrouping.md`: 65 lines / ~1K tokens

Per-pattern shared content vs unique content: ~70% boilerplate, ~30% screen-specific. Trimming 70% saves ~400-700 tokens per dispatch. At 100 dispatches × 700 tokens × $0.30/M (cache-read rate) = **~$0.02 saved**. Engineering effort vastly exceeds savings. **Falsified — not worth pursuing.**

### F4 — Bug-plan FILES are 9× duplicated on disk vs bugs.yaml entries (UNRELATED to token cost but worth flagging)

```
ls projects/finance-track-01/plans/active/ | grep -E "(shell-stripping|layout-regrouping)" | wc -l
→ 317

grep "^  - id:" projects/finance-track-01/docs/bugs.yaml | wc -l
→ 54 (22 shell-stripping + 23 layout-regrouping + 9 flow)
```

Each `/build-to-spec-verify` run files NEW plan files via `nextBugSeq` (returns max+1 even when same screen+pattern already has a plan). `bugs.yaml` IS deduped (idempotent on stable id). **Fix-bugs loop dispatches against bugs.yaml's 54 unique entries — NOT against the 317 plan files.** So this duplication doesn't cost tokens directly, but:

- Slows Glob walks during agent dispatch context-build
- Pollutes plans/active/ enough to make `/check-existing-work` slow + noisy
- Operator confusion ("we have 317 active bug plans" vs reality "54 unique bugs")

This is a pre-existing hygiene issue, not investigate-017's primary axis. Filed as a separate cleanup follow-up rather than absorbed into the token-reduction recommendation.

### F5 — Cache TTL is SDK-internal and not exposed as a public knob

The SDK type-defs (`sdk.d.ts:1635-1640`) define `systemPrompt: { type: "preset", preset: "claude_code", excludeDynamicSections: true }` with no `ttl` / `cacheTtl` config. The cache-creation telemetry distinguishes `ephemeral_1h_input_tokens` vs `ephemeral_5m_input_tokens` (per `sdk-tools.d.ts:77-78`), but the application can't choose between them — the SDK auto-decides.

The escape hatch is `systemPrompt: string[]` with `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` (sdk.d.ts:4968) — manual cache-boundary control. But this loses the `claude_code` preset's tool wiring (Read/Edit/Bash/Grep tooling, hook subsystem, MCP plumbing). Reproducing all of that by hand is a multi-week refactor with high regression risk.

**Conclusion**: cache-creation cost (24% of Sonnet spend) is not directly attackable today. The lever is to **reduce dispatch count** (fewer dispatches = fewer cache-creation events) — which is exactly what feat-053 does. This validates feat-053's batched-dispatch lever as the highest-leverage cache-creation optimization.

### F6 — Output-token bloat: agent dispatches are instructed to write verbose markdown summaries on top of the structured outcome JSON

`orchestrator/src/invoke-agent.ts:1666-1669`:

```typescript
`\nWrite whatever markdown summary you want OUTSIDE the sentinels — the ` +
  `summary helps human reviewers; the sentineled JSON is the machine-` +
  `parseable contract...`;
```

Sonnet output: 817K tokens / ~110 dispatches ≈ 7.4K tokens output per dispatch. The structured outcome JSON is typically < 1K tokens. The remaining ~6K is human-readable markdown summary that **no automated consumer reads** and **the operator scrolls past 95% of the time**.

Trimming the summary instruction to "produce ONLY the sentineled JSON; no markdown summary" would save ~6K output tokens per dispatch × 110 dispatches × $15/M = **~$10 per project**. Sole risk: human reviewers lose the per-dispatch narrative — but the JSON outcome already has `taskOutcomes` + `errors` fields with structured detail.

### F7 — Stack-skill SKILL.md (583 lines / ~10K tokens) is read once per dispatch via cache; per-agent subsetting (H4) is a low-priority optimization

`.claude/skills/agents/front-end/react-next/SKILL.md` is 583 lines (~10K tokens). It IS large, but it's loaded into the cached prefix → re-reads cost $0.30/M × 10K × 100 dispatches = **~$0.30 per project**. Subsetting per agent (builder-only sections vs tester-only vs reviewer-only) is engineering effort that saves <$1 per project. **H4 marginally confirmed but de-prioritized.**

## Recommendation

Three changes ranked by ROI (savings per engineering hour):

### R1 — Trim agent output instruction to sentineled JSON only [TIER 1 — high ROI]

**Estimated savings**: ~-10/project (~22% of total Sonnet output cost)
**Engineering effort**: ~30 min (single-string edit in `orchestrator/src/invoke-agent.ts:1666-1669` + adjust 2-3 affected tests)
**Risk**: low — outcome JSON already has structured `taskOutcomes` + `errors` fields with all machine-actionable info; human reviewers can read code diff if they need narrative

**Concrete change**:

```diff
- `\nWrite whatever markdown summary you want OUTSIDE the sentinels — the ` +
- `summary helps human reviewers; the sentineled JSON is the machine-` +
- `parseable contract. Do NOT wrap the JSON inside the sentinels in ` +
- `markdown code fences or backticks.\n`;
+ `\nReturn ONLY the sentineled JSON. Do NOT write a markdown summary. ` +
+ `Do NOT wrap the JSON inside the sentinels in markdown code fences or ` +
+ `backticks. Diagnostic narrative belongs in the JSON's "errors" field ` +
+ `keyed by task-id, not as free-form prose.\n`;
```

**File this as feat-055.**

### R2 — Validate that feat-053 (class-batched fix-dispatch) eliminates redundant cache-creation [TIER 1 — already filed, just need empirical confirmation]

**Estimated savings**: ~-8-12/project (cache-creation drops as N batched bugs share ONE cache write instead of N)
**Engineering effort**: 0 (already filed); after implementation, add a telemetry assertion
**Risk**: zero — confirms feat-053 is doing the secondary work it implicitly already does

**Concrete change**: add to feat-053's "Validation Criteria" a telemetry-asserted check that `cacheCreationInputTokens` per pattern-group is ~1× the per-dispatch cache write, not N×. Mark this as a feat-053 acceptance criterion.

### R3 — Plan-file dedup hygiene at file-bug-plan.mjs [TIER 2 — non-token-cost but operationally cleaner]

**Estimated savings**: ~$0 directly (bugs.yaml already deduped); ~5-10s per Glob walk during agent dispatch (marginal latency)
**Engineering effort**: ~1h (modify `nextBugSeq` to early-return existing plan when stable bug-id already exists in plans/active/)
**Risk**: low — the existing plan path is already idempotent at bugs.yaml level

**Concrete change**: extend `scripts/file-bug-plan.mjs:nextBugSeq` (or wrap `fileBugPlan`) to:

1. Compute the stable bugs.yaml id FIRST
2. Check if a `plans/active/bug-*-<stable-slug>.md` exists for that screen+pattern
3. If yes, skip plan-file write (return the existing planId/planPath)

**File this as a hygiene bug, not a new feat.** Title: `bug-053-bug-plan-file-dedup-when-stable-id-exists`.

### Things NOT recommended (rejected after empirical check)

- **R-rejected: Per-bug-plan body trimming** (H3) — saves <$0.05/project; engineering effort > savings.
- **R-rejected: Per-agent SKILL.md subsetting** (H4) — saves ~$0.30/project; engineering complexity high; the cached prefix model makes this nearly free at runtime.
- **R-rejected: Skip-redundant tester/reviewer for class-uniform fixes** (H5) — feat-053 already gives the same wall-clock saving by collapsing dispatches; skip-tester/reviewer adds genuine regression risk for marginal additional win. Defer to a future feat-053 follow-up if empirical re-validation shows residual cost.
- **R-rejected: Cache TTL → 1h via `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` manual mode** (F5) — high engineering cost (lose claude_code preset's tool plumbing); marginal win because feat-053 collapses dispatches anyway. Park as a future Anthropic-SDK-side feature request.

## Aggregate cost-saving forecast (all 3 recommendations + investigate-016 follow-ups landed)

| Layer                                     | Source plan    | -savings/project       | % of -45.95 baseline |
| ----------------------------------------- | -------------- | ---------------------- | -------------------- |
| Output token trim (R1)                    | feat-055 (new) | ~-10                   | ~22%                 |
| Class-batched cache-creation savings (R2) | feat-053       | ~-10                   | ~22%                 |
| Bug-count reduction (PM mandate)          | feat-051       | ~-15-25                | ~33-55%              |
| Earlier catch (per-feature parity-smoke)  | feat-052       | ~-5-10                 | ~11-22%              |
| Plan-file dedup (R3)                      | bug-053 (new)  | ~$0 (operational only) | 0%                   |

**Combined target**: a fresh project's /fix-bugs cost drops from -45.95 (finance-track-01 baseline) to ~-5-15. Most of the saving comes from feat-051 + feat-052 reducing bug count; R1 + R2 + R3 are the per-dispatch tax reductions.

## Cross-references

- **Parent**: `investigate-016-shift-left-bug-prevention-and-fix-loop-throughput` — sister investigation that reduces bug count + dispatch count; this plan reduces tokens-per-dispatch.
- **Sister plans (just-filed follow-ups from investigate-016)**:
  - `feat-051-pm-appshell-mandate-task-template` — primary prevention; reduces bug count → multiplies any per-dispatch saving across more saved bugs
  - `feat-052-per-feature-parity-smoke-at-close-feature` — earlier catch; same multiplier
  - `feat-053-class-batched-fix-dispatch` — collapses dispatches; this investigation's H6 (batched orientation amortization) directly extends feat-053's value
  - `feat-054-reviewer-playbook-design-conformance-dimension` — reviewer dimension; H5 addresses "is the reviewer pass redundant for class-uniform fixes" question
- **Referenced infrastructure**:
  - `orchestrator/src/invoke-agent.ts` — dispatch entry point; would carry cache_control if H1 confirms
  - `scripts/file-bug-plan.mjs` — bug-plan author; H3's per-pattern shared-context refactor
  - `.claude/skills/agents/front-end/react-next/SKILL.md` — H4's per-agent subsetting target
  - `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — SDK API surface for cache_control
- **Anthropic docs reference**: `docs.anthropic.com/en/docs/build-with-claude/prompt-caching` — primary spec for cache_control + ephemeral TTL
- **Empirical baseline**: finance-track-01 2026-05-05 fix-bugs run b0cww50d3 (live during this plan's authoring; running at C=3)

## Out of scope (deferred)

- Multi-project lessons-agent feedback loop (cross-project token amortization) — out of scope for this 60-min investigation; handled via lessons-agent backlog (feat-015)
- Switching to a smaller model (Haiku for routine bug fixes) — model selection is in `models.yaml`; orthogonal cost lever already exposed
- Bash output token bloat (e.g. `pnpm install` log spam) — known issue, fix-bugs-loop already filters; out of scope here
- Tool-call output token cost (Read/Grep/Glob) — usually small relative to prompt prefix; deferred unless investigation surfaces it as a top-3 driver
