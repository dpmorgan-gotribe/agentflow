---
id: investigate-026-timeout-no-evidence-bug-fixer-stalls
type: investigation
status: draft
author-agent: human
created: 2026-05-11
updated: 2026-05-11
parent-plan: feat-066-fix-loop-effectiveness-v2
supersedes: null
superseded-by: null
branch: null
affected-files: []
feature-area: orchestrator/fix-loop
priority: P0
attempt-count: 0
max-attempts: 5
time-box-minutes: 30
hypothesis: bug-fixer dispatches on `timeout-no-evidence` flow-failures stall because the pre-loaded envelope has insufficient diagnostic context — the synthesizer's spec just says "timed out at step N" with no screenshot / DOM dump / selector / actual-screen-id, so the agent burns its turn budget on Read/Grep trying to discover what the page was doing instead of fixing it
---

# investigate-026: Why do `timeout-no-evidence` bug-fixer dispatches stall while other classes succeed?

## Question

Why do bug-fixer dispatches on flow-failure bugs with `primaryCause: "timeout-no-evidence"` systematically stall + fail to produce a fix (5 dispatches, ~50% success rate, slow + repeated SDK-message-warn-threshold hits) while bug-fixer dispatches on cheap classes (orphan, parity) and systemic-fixer dispatches on systemic bugs succeed first-attempt 100%?

Empirical signal driving this question (reading-log-02 /fix-bugs run 2026-05-11, paused at ~2.5hr mark via SIGINT to pid 33392 in run-id `788ab078-973f-4ff0-9627-b919d9c08bf7`):

| Bug class                                                         | Dispatched | First-attempt success | Notes                                                                                                                                                                     |
| ----------------------------------------------------------------- | ---------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| systemic-fixer (pixel-systemic + systemic-divergence)             | 3          | 3 (100%)              | 8-12 min each, cleanly fixed                                                                                                                                              |
| bug-fixer on orphan-route                                         | 1          | 1 (100%)              | ~6 min, clean fix                                                                                                                                                         |
| bug-fixer on parity layout-regrouping                             | 1          | 0 (0%)                | book-create-layout-regrouping failed att 1; n=1 — needs more data                                                                                                         |
| bug-fixer on parity copy-sizing-drift                             | 1          | inconclusive          | interrupted by SIGINT mid-dispatch                                                                                                                                        |
| bug-fixer on parity layout-regrouping / pixel-minor (remaining 9) | 0          | n/a                   | never reached — paused before                                                                                                                                             |
| **bug-fixer on `timeout-no-evidence` flow-failures**              | **6**      | **3 (50%)**           | **3 stalled — flow-2/3/5 went pending after attempt 1; repeated 90s SDK-message-warn threshold hits; flow-5 in-progress for 30+min producing only sporadic SDK messages** |

**Cross-class signal:** the single parity-layout-regrouping dispatch ALSO went pending after att 1 (same shape as flow-2/3/5). n=1 isn't conclusive, but the investigation should check whether the stall pattern is unique to `timeout-no-evidence` OR broader. Hypothesis: bug-fixer struggles whenever the pre-loaded envelope is information-thin, regardless of bug class.

## Hypothesis

**Primary:** the `timeout-no-evidence` bug shape is fundamentally context-starved. Looking at the bug-fix-context envelope resolver (`orchestrator/src/bug-fix-context.ts:133-147`), `flow-execution-failure` bugs pre-load:

1. The failing synthesized spec (`apps/web/e2e/synthesized/<flowId>.spec.ts`)
2. The user-flows-manifest entry

But for `timeout-no-evidence` failures, the spec just has `await page.click("text=...").then(...)` followed by an implicit wait that timed out. The bug record carries:

- `failedStep: 0` (or some number)
- `expectedScreenId: null` (no transition meta in v2.0 synthesizer emit path)
- `actualScreenId: null`
- `selector: null`
- `screenshot: null`
- `htmlDump: null`

So the agent's dispatch envelope has: the spec (which says "click X, expect Y" but doesn't say WHY it failed), the manifest entry, and a bug.summary like "Flow flow-2 (walks 5 interaction(s) deterministically) failed at step 0: expected null, landed on (no screen-id)" — which is almost literally null information.

The agent then has to:

1. Run the dev server itself or read source carefully
2. Trace what the failing step DOES — what page, what selector, what state
3. Hypothesize why it timed out
4. Edit + verify

That's the work of the SYNTHESIZER + the AGENT combined, with the agent doing both halves from scratch. Hence the slow, stalling behavior.

**Secondary hypotheses:**

- The 90s-no-SDK-message warn threshold fires repeatedly because the agent is using extended-thinking blocks (don't emit SDK events) to reason through the missing context. The agent isn't stuck — it's THINKING in long blocks because it has nothing concrete to act on.
- The bug-fixer's maxTurns:8 cap may be insufficient for a flow that requires file-discovery + reasoning + fix — by the time it's understood the situation, it's out of turn budget.

## Investigation Steps

(Time-boxed 30 minutes — document findings even if incomplete.)

1. **Read `orchestrator/src/bug-fix-context.ts` `resolveFilesForBug()` for flow-execution-failure** — confirm what files get pre-loaded for `timeout-no-evidence`. Expected: just the spec + manifest.
2. **Inspect `apps/web/e2e/synthesized/flow-2.spec.ts` in reading-log-02** — what does the synthesizer emit for a `timeout-no-evidence` shape? Does it have selector info? Page-goto info? Anything actionable?
3. **Read 1-2 of the dispatched bug-fixer agents' outputs** — check if there's a log file for the dispatch (in `projects/reading-log-02/.claude/worktrees/bug-flow-flow-2-walks-5-interaction/` or via the orchestrator's `runId` state dir). What did the agent actually do? Where did it spend its turn budget?
4. **Cross-reference with synthesizer code** (`scripts/synthesize-flow-e2e.mjs`) — does the synthesizer emit DOM dump / screenshot on failure for this class? If yes, why isn't it in the bug record?
5. **Check `scripts/run-synthesized-flows.mjs`** — does the runner capture `runtimeErrors` / screenshot / htmlDump for timeout-no-evidence failures, or only for transition-failure failures? Looking at the bug-079 work, the runner extracts attachments — but does it do so for all failure modes or just `failed`?
6. **Compare bug-2 + bug-3 + bug-5 summaries** — are they all the same shape (same null fields, same vacuous summary text)?
7. **Triage the success cases (flow-1, flow-4)** — what made those fixable? Did the agent get lucky finding the fix-site quickly? Were those flows simpler (fewer interactions, more deterministic step paths)?

## Findings

<!-- Populated by executing agent. -->

## Recommendation

<!-- Populated based on findings. Likely candidates:

OPTION A: Enrich bug-fix-context for timeout-no-evidence
  - Pre-load apps/web/e2e/playwright.config.ts (test-runner config)
  - Pre-load the failing spec PLUS apps/web/app/page.tsx (likely first-page)
  - Pre-load docs/user-flows-manifest.json's interactions[] entry for this flow
    so the agent sees what each step is SUPPOSED to do
  - Pre-load any test-results/<flow>/* artefacts (screenshot, video, trace)
    that Playwright wrote on the failing test

OPTION B: Enrich the bug record itself at synthesizer emit time
  - When the runner detects a timeout-no-evidence failure, capture the page's
    DOM + screenshot regardless of attachment availability and write to
    bug.htmlDump + bug.screenshot
  - This requires modifying scripts/run-synthesized-flows.mjs to attach
    captures on timeout even when the test didn't formally fail
  - Larger change but produces actionable bug records that bug-fixer can fix

OPTION C: Re-classify timeout-no-evidence as "needs-tester-investigation"
  - Route this class to a tester dispatch (or a new "diagnostic-fixer" agent)
    with extended turn budget + permission to run the dev server + interact
    with the page directly to gather evidence before fixing
  - feat-068 (vision-LLM perceptual review, deferred) could play this role —
    look at the page, decide what's wrong, then dispatch the fix

OPTION D: Accept the limitation, mark timeout-no-evidence as low-confidence
  - These bugs may simply not be machine-fixable without operator intervention
  - Route to operator-review (empty agentSequence: []) like manifest-author
    classifications

Most likely useful: OPTION A (cheap, in-scope for the existing context resolver),
OR a combination of A + B (richer envelope + richer source bug record).

-->

## Attempt Log

<!-- Populated by executing agents. -->
