---
id: bug-095-in-loop-verifier-db-pollution
type: bug
status: completed
author-agent: human
created: 2026-05-13
updated: 2026-05-13
outcome: shipped — Option A (POST /test/seed-baseline between flow-execution and Tiers 4+5) landed in build-to-spec-verify.ts; visual-tier captures now happen against canonical seed state, not post-cleanup
parent-plan: feat-066-fix-loop-effectiveness-v2 (v2-Phase-3)
supersedes: null
superseded-by: null
branch: fix/in-loop-verifier-db-pollution
affected-files:
  - orchestrator/src/build-to-spec-verify.ts
  - orchestrator/tests/build-to-spec-verify.test.ts
feature-area: orchestrator/verifier-ordering
priority: P0
attempt-count: 1
max-attempts: 5
error-message: "rounds-orchestrator's mid-/fix-bugs re-verify runs flow-execution (which cleans DB tables to set up flow-specific seed state) BEFORE the perceptual + walkthrough tiers. Perceptual + walkthrough then capture a wiped DB state and file findings like 'book-detail returns 404', 'no API calls initiated', 'app renders broken error boundary' — all false-positive artefacts of the post-cleanup state."
reproduction-steps: "1. Generate a project with full /start-build through to verifier. 2. Trigger /fix-bugs invocation that takes >1 round. 3. Observe rounds-orchestrator's outer-iteration-2+ verifier output: perceptual + walkthrough will surface findings consistent with empty-DB rendering even though the project's seed data exists in apps/api/db/seed.ts."
stack-trace: null
---

# bug-095: in-loop verifier DB pollution — flow-execution wipes seed data before perceptual + walkthrough tiers run

## Bug Description

The `/build-to-spec-verify` tier chain currently runs in this order:

1. Tier 0 — build-sanity (no DB interaction)
2. Tier 1 — reachability (static analysis, no DB interaction)
3. Tier 2 — synth-flows (writes spec files, no DB interaction during synth)
4. **Tier 3 — flow-execution (runs Playwright specs; specs' `beforeAll` HITS `/test/cleanup` to wipe DB tables for flow-specific seed setup)**
5. Tier 4 — perceptual review (captures live screenshots of each screen)
6. Tier 5 — walkthrough (live captures network/console/screenshots across the journey)

When Tier 3's `beforeAll` cleanup fires, it leaves the DB in a partially-wiped state. Subsequent Tiers 4+5 capture screens against that state, observing:

- "Book detail returns 404" — book record was deleted by cleanup
- "Books list is empty" — books table was cleaned
- "No API calls initiated — data layer never reached" — pages 404 because of missing seed
- "App renders broken error boundary" — same root cause
- "Client enters infinite 1-second retry loop on persistent 404" — pages keep retrying the missing data

These all become bug entries that the next-round /fix-bugs dispatches against. The bug-fixer tries to "fix" `/books/[id]/page.tsx` to "not return 404" — but the page is correct; the DB just doesn't have the data. Wasted spend + thrash + false confidence loss.

## Empirical evidence (2026-05-13, reading-log-02)

`/fix-bugs reading-log-02 --max-concurrent=3` session (Saturday 2026-05-13, 5/5 iterations, $26.55):

- The rounds-orchestrator's outer iteration 2's re-verify surfaced 7 new "pending" bugs of which 4 mapped EXACTLY to the post-cleanup state:
  - `bug-perceptual-book-detail-book-detail-page-returns-404-e`
  - `bug-perceptual-books-list-empty-the-built-screenshot-shows-404`
  - `bug-perceptual-books-list-the-built-screenshot-shows-a-n` (404)
  - `bug-walkthrough-step-1-no-backend-api-calls-initiated`
- All 4 marked `failed` by the loop after 2 attempts each (~$1-2 per attempt in bug-fixer dispatches).
- Live site at the same moment, freshly reseeded: ALL pages render fully (`buus3ajsj` walkthrough captured screenshots).
- Manual operator triage: 8 of 19 new pending bugs identified as pollution.

## Root Cause Analysis

The tier ordering is correct for the OUTER `/start-build` post-Mode-B verify pass (where there's no preceding state to preserve). But mid-/fix-bugs re-verifies share a project root where:

1. The fix-loop just finished applying patches against the project's real state (including real seed data after the operator manually reseeded).
2. flow-execution's cleanup destroys that state before perceptual + walkthrough can capture it.
3. Perceptual + walkthrough then report on a transient torn-down state, NOT the post-fix state the operator wanted to verify.

The Strategy-C-test-seed contract (`.claude/rules/testing-policy.md`) defines `/test/seed-baseline` for exactly this restoration use case — but the verifier doesn't currently invoke it between Tier 3 and Tier 4.

## Fix Approach

Three viable patterns, in increasing complexity:

**Option A (simplest, recommended for first pass)**: After flow-execution and BEFORE perceptual/walkthrough fire, the verifier hits `POST /test/seed-baseline` to restore the canonical seed. This is exactly what the contract was designed for.

```ts
// in orchestrator/src/build-to-spec-verify.ts, after flow-execution block:
if (flowsResult && (perceptualEnabled || walkthroughEnabled)) {
  await fetch(`${apiBase}/test/seed-baseline`, { method: "POST", body: "{}" });
}
```

**Option B (more robust)**: per-flow-spec teardown should restore baseline in `afterAll` (not just `beforeAll` cleanup). The synthesizer already emits `afterAll` restoring baseline — verify it's actually running for all 6 specs. Today's 2026-05-13 run showed all 6 flows FAILED at step 0 (bug-052 regression), meaning `afterAll` likely never ran. Fixing bug-052 + this combine into a full restoration story.

**Option C (architectural)**: split flow-execution into a separate verifier invocation that doesn't share the project root with perceptual/walkthrough. Higher engineering cost; defer unless A+B prove insufficient.

Recommended order: ship Option A first (single-line fix), then B (depends on bug-096 below), evaluate whether C is still needed.

## Validation Criteria

- [ ] After Option A lands, re-run `/build-to-spec-verify` against reading-log-02 (post-fix-loop state).
- [ ] Perceptual + walkthrough screenshots show full Dune detail on /books/seed-book-1, populated books list on /, populated tags on /tags. NOT 404.
- [ ] Bug count: perceptual files ≤2 findings (real cosmetic divergences only), walkthrough files ≤2 findings (real behavioral observations only). NOT 13+4 like today.
- [ ] Compare cost-per-/fix-bugs-iteration: today $26.55 across 5 iterations; expect post-fix $10-15 range as ~half the noise disappears.

## Cross-references

- **bug-096** — bug-052 apiBase regression. Companion fix; without it, Option B can't ship because flow specs don't run end-to-end.
- **bug-097** — scaffold .env.example default. Companion; without it, the verifier pre-flight rejects before this tier ordering matters.
- **feat-068, feat-069** — the tiers that suffer the pollution. Their findings can't be trusted until this fix lands.
- **feat-071 cluster-bugs-pre-dispatch** — once findings are honest, clustering becomes useful; without honest findings, clustering would batch noise.
- **Strategy-C-test-seed contract** in `.claude/rules/testing-policy.md` — the `/test/seed-baseline` endpoint is the load-bearing primitive for Option A.

## Attempt Log

### 2026-05-13 — Option A shipped

Inserted a `POST /test/seed-baseline` call in `orchestrator/src/build-to-spec-verify.ts` between the parity bug-plan filing block (~line 824) and the Tier 4 perceptual review block (~line 826). The call fires only when ALL of:

- Visual tiers will fire (Tier 4 OR 5 is in `enabledTiers`, AND `runPerceptual !== false` OR `runWalkthrough !== false`)
- `flowsRan === true` (the new hoisted flag tracking whether `runFlows` actually executed — so we don't waste an HTTP call when Tier 3 was gated off)
- `sharedDevServerHandle?.backendUrl` is set (multi-tier project with Strategy-C backend)

The endpoint is idempotent + 204-on-success. If absent (project without `/test/seed-baseline`) or fails, the call surfaces a soft warning and the verifier continues — Tier 4+5 just observe whatever state they find. Hard failure isn't appropriate because the absence is project-dependent.

Tests added (`orchestrator/tests/build-to-spec-verify.test.ts`):

- "hits POST /test/seed-baseline after runFlows when visual tiers will fire + backendUrl is set" — vi.spyOn(global, "fetch") confirms the URL + method, asserts the warning surfaces.
- "does NOT call seed-baseline when visual tiers are gated off" — confirms the gate works (runPerceptual=false + runWalkthrough=false → 0 fetch calls).

Hoisting note: introduced a `flowsRan` boolean at the wider function scope (line 487) and set `true` inside the executeFlows block right after `runFlows` resolves. Cleaner than expanding `runResult`'s scope to outside its conditional block.

Options B + C from the plan body deferred: Option B (per-flow-spec teardown restores baseline in `afterAll`) requires bug-096 (apiBase regression) to land first since flow specs need to actually run end-to-end. Option C (split flow-execution into a separate verifier invocation) is architectural; defer until A+B prove insufficient.

Suite: 36/36 build-to-spec-verify tests + 944/944 full orchestrator suite green.

Empirical follow-up needed (next session against a fresh project): re-run /build-to-spec-verify on reading-log-02 and confirm perceptual + walkthrough no longer file "page returns 404" / "no API calls" findings post-fix.
