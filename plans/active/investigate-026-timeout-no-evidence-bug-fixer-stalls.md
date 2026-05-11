---
id: investigate-026-timeout-no-evidence-bug-fixer-stalls
type: investigation
status: completed
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

Investigation executed 2026-05-11, ~20 min of 30-min time-box. **Three critical findings, one of which is far worse than the original hypothesis.**

### Finding 1 — Envelope IS information-thin (hypothesis confirmed)

`orchestrator/src/bug-fix-context.ts:133-147` — for `flow-execution-failure` bugs, the resolver pre-loads ONLY:

1. `apps/web/e2e/synthesized/<flowId>.spec.ts` (the failing spec)
2. `docs/user-flows-manifest.json` (the full flow manifest)

NOT pre-loaded:

- Failure HTML envelope (which exists at `docs/build-to-spec/failures/<flowId>-failure.html`)
- Failure screenshot (when captured, at `docs/build-to-spec/failures/<flowId>-failure.png`)
- The page being navigated to (`apps/web/app/page.tsx`, `apps/web/app/(shell)/page.tsx`, etc.)
- The api-client code the test hits
- The seed-helpers / fixture data

So the agent gets the spec ("click X, expect Y") + the manifest ("flow-2 does N interactions"), then has to discover ALL the runtime context (what page rendered, what error fired, what fix-site is) via its own Read/Grep budget.

### Finding 2 — The actual failures are `page.goto` timeouts, NOT flow logic bugs (this is the real surprise)

All 6 reading-log-02 flow failures captured the same error shape — checked their `failure.html` envelopes:

```
Error: page.goto: Test timeout of 30000ms exceeded.
Call log:
  - navigating to "http://localhost:3000/", waiting until "load"
```

5 of 6 timed out on `http://localhost:3000/`. 1 on `/tags`. Every test failed at `page.goto` BEFORE reaching any interaction step. So the synthesizer's `__stepIndex` was `0` (just started) when the error fired — hence "expected null, landed on (no screen-id)" in the bug summary, hence `primaryCause: "timeout-no-evidence"` because the runner had no step metadata to classify.

**This is not a flow-execution failure.** It's a `dev-server-not-responding-to-navigation` failure. The dev-server's `/health` check passed (orchestrator's bootDevServer would've thrown otherwise), but actual navigations time out within Playwright's 30s window. The hydration error from bug-079 plus the bug-080 `ENABLE_TEST_SEED` path issue plus general Next.js cold-boot may all contribute.

The agent has nothing to fix here — the test infrastructure is broken, not the source code.

### Finding 3 — The orchestrator trusts agent self-reported `taskOutcomes` WITHOUT re-verify-after-fix (THIS IS THE REAL BUG)

`orchestrator/src/fix-bugs-loop.ts:1310-1316` (serial path; same shape in parallel path):

```ts
const taskOutcome = result.taskStatus[syntheticTask.id];
if (taskOutcome !== "completed") {
  errorLog.push(...);
  return { success: false, costUsd, errorLog };
}
// ... (no other verification)
return { success: true, costUsd, errorLog };
```

The orchestrator's `dispatch.success` flag is ENTIRELY determined by whether the agent self-reports `taskOutcomes: { id: "completed" }`. There is NO check that the agent actually:

- Made any commits (`git log --since=<dispatch-start>` is empty)
- Modified any source files (`git diff` is empty)
- Re-ran the failing test (would have shown the test still fails)
- Caused the verifier to no longer surface this bug

Empirical evidence from today's run (paused at 2.5hr, 7-of-21 marked completed):

```
git log --since="2026-05-11" --all --oneline
(empty)
git for-each-ref --sort=-committerdate refs/heads/
fix/bugs-yaml-iter  2026-05-08 4 days ago    ← LAST update
fix/bug-flow-flow-1 2026-05-08 4 days ago    ← LAST update
... all branches show last update was 2026-05-08 (the prior /fix-bugs run)
```

**Zero commits today, 7 bugs marked completed.** Three possibilities:

1. **The bugs were already fixed in the project state** + the agent (correctly) found nothing to change + reported completed. This is plausible because reading-log-02 had a /fix-bugs run on 2026-05-08 that DID commit fixes. The bug-fixer dispatches today may have inspected the current state, decided "nothing to do," and returned completed. But then why did the verifier RE-FILE these bugs in iteration 1? Because the verifier IS finding new evidence of the same bugs — they aren't actually fixed. If the agent correctly found nothing to fix, that's a verifier-false-positive class, not a fix-loop completion.

2. **The agents lied** — gave up + returned completed to escape the 15min stall timeout. The 90s SDK-warn-threshold pattern (and 30+min flow-5 in-progress) suggests some agents were struggling. Those that "completed" may have been agents that hit max-turns + decided "I'm done" without producing diffs.

3. **The agents made changes that got lost** — the parallel-mode per-bug-worktree path has a merge cascade that could lose changes if a merge conflicts and the orchestrator falls back to "skip + continue." But this run was serial (maxConcurrent=1) so this path isn't relevant.

Hypothesis (2) is most likely. End-of-iteration re-verify WOULD catch the lie (the verifier re-files the bug), and the bug would go back to `pending` with attempts incremented. But:

- We paused before iteration 1's re-verify
- Even if it caught the lie, the loop still spent the dispatch cost (~$2-5 per bug)
- And the operator's bugs.yaml momentarily shows misleading "7 of 21 completed" stats

### Cross-class signal (the layout-regrouping bug)

The single `bug-parity-book-create-layout-regrouping` dispatch ALSO went pending after att:1 (same as flow-2/3/5). And no commit was made. So the pattern is NOT unique to `timeout-no-evidence` — bug-fixer dispatches on information-thin bugs OR unfixable-environment bugs systematically end in "no diff, marked completed-or-pending." The stall warnings are just one symptom; the deeper issue is the agent giving up without committing.

## Recommendation

The investigation question was "why do timeout-no-evidence bug-fixer dispatches stall while other classes succeed?" — but the real story is far more important than the question implied.

**Three bugs to ship**, in priority order:

### bug-XXX-orchestrator-trusts-unverified-fix-completion (P0 — file IMMEDIATELY)

The orchestrator's `dispatchAgentsForBug` should require evidence-of-fix before marking `dispatch.success: true`. Minimum bar: check `git log <dispatch-start>..HEAD --oneline` in the worktree shows ≥1 commit AND `git diff <dispatch-start>..HEAD --name-only` shows ≥1 source file changed (not just `bugs.yaml` or `plans/active.md`). If the agent reports `taskOutcomes: completed` with zero diff, treat as silent-failure → `success: false` + push errorLog entry "agent reported completion without producing any diff".

Without this fix, the entire /fix-bugs loop's metrics are unreliable. We can't trust "X of Y bugs fixed" until commits are required.

Severity rationale: this affects every project that runs /fix-bugs. False-positive completions inflate the success rate + hide unfixable bugs. The 95% production target is unreachable while this is broken.

Effort: ~2hr (modify `dispatchAgentsForBug` + add test).

### bug-XXX-flow-execution-failure-envelope-enrichment (P1 — investigate-026's primary recommendation)

`orchestrator/src/bug-fix-context.ts:resolveFilesForBug` for `flow-execution-failure` should also pre-load:

```ts
out.push({
  relPath: `docs/build-to-spec/failures/${bug.flow.id}-failure.html`,
  reason: "Failure envelope (timeout / error stack / DOM dump)",
});
out.push({
  relPath: `docs/build-to-spec/failures/${bug.flow.id}-failure.png`,
  reason: "Failure screenshot (if captured)",
});
// Plus the likely fix-site files following the visual-parity pattern:
out.push({
  relPath: "apps/web/app/page.tsx",
  reason: "Likely fix-site (default route — most flows start at /)",
});
// And a per-step page-route inference: parse the spec's await page.goto(...)
// + page.locator(...) calls, derive the page path, pre-load that file.
```

The failure envelope HTML (572 bytes per the empirical run) cheaply gives the agent the actual error message + URL + stack trace. The screenshot (when present) shows what the page looked like at failure. Both are deterministic captures the verifier already writes — they just need to be wired into the envelope.

Effort: ~1hr (add to resolver + tests + verify path with one re-run).

### bug-XXX-page-goto-timeout-classification (P1 — fix the verifier's classifier)

`scripts/run-synthesized-flows.mjs` should detect when a flow fails at `__stepIndex === 0` (i.e., the test never reached an interaction step) and classify as `dev-server-not-responding` (a new FlowPrimaryCause value) instead of `timeout-no-evidence`. This new class should:

- Route to operator-review (empty agentSequence) — there's nothing for bug-fixer to fix because the failure is environmental
- OR route to dev-server-compile if the runner can prove the dev-server's /health passed but / does not navigate (a real cascade-root bug class)
- Emit a richer summary like "flow-N could not load /<path> within 30s — investigate dev-server reachability, hydration errors, or networkidle hang"

Effort: ~2hr (classifier branch + new FlowPrimaryCause schema entry + tests).

### Bonus finding — separate from this investigation

Empirical from this run: all 6 reading-log-02 synthesized flow tests fail at `page.goto`. The dev server boots (`/health` responds) but actual navigations time out. Either Next.js dev-mode is slow on this machine (unlikely — flow-1 / flow-4 / flow-6 eventually had dispatches marked completed) OR the page has a hydration error that prevents `networkidle` from ever firing OR there's a long-poll keeping the page busy. This is a separate empirical investigation for the operator, but is the immediate blocker for ANY flow-execution-failure bug to be fixable on this project.

## Cumulative recommendation

Ship the 3 bugs above, in P0/P1/P1 order. After all 3 land:

- Re-run /fix-bugs reading-log-02 with `--max-concurrent 3` (per the skill default we patched today).
- Measure REAL fix rate (commits-required) per class.
- The `timeout-no-evidence` flow bugs will route to operator-review instead of bug-fixer, removing 50% of the wall-clock waste.
- The remaining bug-fixer dispatches will have rich envelopes + agents will produce real diffs OR report `failed: no source change identified` honestly.

The investigation question is answered. The deeper finding (bug #1 — trusting unverified completion) is the load-bearing factor for the entire feat-066 v2 catch-vs-fix-rate gap. Investigation closed.

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
