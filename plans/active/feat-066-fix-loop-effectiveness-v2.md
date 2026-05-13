---
id: feat-066-fix-loop-effectiveness-v2
type: feature
status: draft
author-agent: human
created: 2026-05-08
updated: 2026-05-08
parent-plan: investigate-025-fix-loop-effectiveness-v2
supersedes: null
superseded-by: null
branch: feat/fix-loop-effectiveness-v2
affected-files:
  - orchestrator/src/build-to-spec-verify.ts
  - orchestrator/src/parity-verify.ts
  - orchestrator/src/fix-bugs-loop.ts
  - scripts/audit-computed-styles.mjs
  - scripts/run-synthesized-flows.mjs
  - .claude/agents/bug-fixer.md
  - .claude/agents/systemic-fixer.md
feature-area: orchestrator/verification-coverage
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-066-fix-loop-effectiveness-v2: Bug-fix loop v2 — perceptual + systemic detection

## Problem Statement

Empirically validated by **investigate-025** + the reading-log-02 census 2026-05-08: the current 5-layer verifier (build, dev-server, synthesized E2E, parity DOM-diff, parity computed-styles, reachability) catches **~1 of 30 user-visible bugs** on a representative project. The 94% resolution metric reported by /fix-bugs is structurally biased toward bugs the verifier can already see, while shipping projects with load-bearing visual + interaction bugs invisible to all 5 layers.

Three load-bearing gaps confirmed:

1. **audit-computed-styles classifier silently drops 75% of its signal** — `PATTERN_ALLOWLIST` defaults to `["layout-regrouping"]` only. token-drift, copy-sizing-drift, spacing-token-drift all suppressed. Per-bucket cap of 5 + bug-fixer per-bug isolation turns systemic divergence into a shell game.
2. **No perceptual layer** — DOM structure + class strings compared exhaustively; pixel rendering + vision-level "does this look right" never compared.
3. **No human-walkthrough surface** — synthesized E2E specs execute deterministic selectors; never exercise the app like a user would; never check button-does-what-its-label-says, theme-toggle-actually-toggles, sidebar-fills-viewport.

## Approach — 7-phase v2 architecture

Phases ordered by leverage-per-effort. Each ships as its own ticket; can land independently.

| Phase                                                               | Ticket   | Effort | Empirical leverage (vs reading-log-02 30-bug census)                   |
| ------------------------------------------------------------------- | -------- | ------ | ---------------------------------------------------------------------- |
| 1 — audit-computed-styles config fix + deterministic discriminators | bug-078  | 6 hr   | ~17% (5 bugs caught) — was projected 70%; falsified down               |
| 2 — pixel-diff smoke layer                                          | feat-067 | 6 hr   | +50% (15 bugs caught: missing elements, color drifts, full-page break) |
| 3 — vision-LLM perceptual review                                    | feat-068 | 10 hr  | +15% (perceptual gaps Phase 2 misses)                                  |
| 4 — AI walkthrough (Playwright CLI variant)                         | feat-069 | 12 hr  | +15% (interaction-level bugs only this catches)                        |
| 5 — systemic-fixer agent variant                                    | feat-070 | 3 hr   | enables Phase 1+2's systemic-divergence dispatches                     |
| 6 — cluster-bugs-pre-dispatch                                       | feat-071 | 3 hr   | reduces total wall-clock at scale (50 → 1 dispatch when warranted)     |
| 7 — re-enable class-batched dispatch (selected)                     | feat-072 | 1 hr   | reduces wall-clock for pixel-minor-divergence batches                  |

**Total: ~41 hr engineering effort.** Phase 1+5 = 9 hr for ~17% catch + systemic-bug routing. Phase 1+2+5 = 15 hr for ~67% catch. Full Phase 1-7 = ~95% catch.

## Architectural diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                     /build-to-spec-verify v2                      │
│                                                                    │
│  Phase 1: Pre-verifier deterministic discriminators (NEW)         │
│   ├─ no postcss.config.* AND has tailwind.config → bug class      │
│   ├─ no @tailwind directives in any project CSS → bug class       │
│   ├─ output:export AND apps/api/ exists → bug class               │
│   └─ apps/api/ exists AND /test/cleanup not registered → bug class│
│                                                                    │
│  Existing verifier layers (refined per Phase 1):                  │
│   ├─ Build / dev-server compile probe    [unchanged]              │
│   ├─ Synthesized E2E flows (selector + runtime ctx)  [bug-079]    │
│   ├─ DOM kit-skeleton diff               [unchanged]              │
│   ├─ audit-computed-styles diff          [Phase 1 reconfig]       │
│   └─ Reachability                        [unchanged]              │
│                                                                    │
│  NEW perceptual layers:                                           │
│   ├─ Phase 2: Pixel-diff smoke (per screen)                       │
│   ├─ Phase 3: Vision-LLM perceptual review (per screen)           │
│   └─ Phase 4: AI walkthrough (per fix-loop iteration end)         │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│              fix-bugs-loop dispatch (with Phase 6 cluster pass)    │
│                                                                    │
│  Pre-dispatch:                                                    │
│   └─ Phase 6: Cluster N>10 same-pattern bugs → 1 systemic bug     │
│                                                                    │
│  Dispatch routing:                                                │
│   ├─ bug-fixer (existing) — narrow-scope, maxTurns:8 — 5-6 min    │
│   │     • parity-divergence, perceptual-divergence,               │
│   │       walkthrough-divergence, runtime-error                   │
│   ├─ systemic-fixer (NEW Phase 5) — maxTurns:12 — 8-10 min        │
│   │     • pixel-systemic-divergence, tooling-css-pipeline-broken, │
│   │       tooling-config-mismatch, clustered-systemic-divergence  │
│   └─ Phase 7: class-batched dispatch for pixel-minor-divergence   │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

## Wall-clock preservation contract

investigate-024's 5-6 min/bug median is preserved through v2. All new bug classes route to either bug-fixer (unchanged dispatch) or the new systemic-fixer (intentionally slower for cross-file work, but only fires for ~10% of bugs).

| Bug class                                                                                        | Routes to                             | Per-bug wall-clock     |
| ------------------------------------------------------------------------------------------------ | ------------------------------------- | ---------------------- |
| parity-divergence (incl. token-drift, copy-sizing-drift, spacing-token-drift, layout-regrouping) | bug-fixer                             | 5-6 min                |
| pixel-minor-divergence                                                                           | bug-fixer (or batched per Phase 7)    | 5-6 min                |
| pixel-systemic-divergence                                                                        | systemic-fixer                        | 8-10 min               |
| perceptual-divergence                                                                            | bug-fixer with image-rich pre-load    | 5-6 min                |
| walkthrough-divergence                                                                           | bug-fixer                             | 5-6 min                |
| runtime-error (now elevated for passing tests via bug-079)                                       | bug-fixer                             | 5-6 min                |
| tooling-css-pipeline-broken                                                                      | systemic-fixer (or trivial bug-fixer) | 5-6 min                |
| tooling-config-mismatch                                                                          | systemic-fixer                        | 8-10 min               |
| clustered-systemic-divergence (Phase 6)                                                          | systemic-fixer                        | 8-10 min once vs N×5-6 |

Total fix-loop wall-clock estimate (reading-log-02 30-bug census, with mitigations):

| Pipeline                            | Total fix-loop time | Bugs caught |
| ----------------------------------- | ------------------- | ----------- |
| Today (current 5-layer + bug-fixer) | 75-90 min           | 1/30        |
| Phase 1+5 only                      | 100-120 min         | ~10/30      |
| Phase 1-5                           | 180-220 min         | ~25/30      |
| Phase 1-7 (with mitigations)        | **130-160 min**     | ~25-28/30   |

Net: ~1.6× longer total run; ~25× more bugs caught per run. Per-bug stays at investigate-024's targets.

## Rejected alternatives

- **Option B — replace structural-DOM layers with pixel + walkthrough only.** Rejected because synthesized E2E flows are cheap, deterministic, and catch real selector regressions; ditching them costs more than it saves. They also serve as a fast pre-gate before expensive vision-LLM calls.
- **Use Playwright MCP instead of Playwright CLI for AI walkthroughs.** Rejected per user-research signal that CLI is ~4× cheaper for terminal agents (no per-step ARIA snapshot streaming). MCP variant deferred to future work for operator-triggered "let the AI poke around" mode.
- **Add tailwind4-style migration as part of v2.** Rejected — tailwind 3 vs 4 is a separate decision orthogonal to detection-layer effectiveness; conflating them would block v2 on a migration that has its own breaking-change risks. (See bug-077 cleanup of stale tailwind 4 mentions.)
- **Skip Phase 0.5/6/7 mitigations + accept 2× total wall-clock.** Rejected because investigate-024's 5-6 min/bug win is operator-load-bearing — a 2× total run regression would erode the cost-reduction gains.

## Expected outcomes

- [ ] All 7 phase tickets land + are validated against reading-log-02
- [ ] Catch rate against the 30-bug reading-log-02 census ≥85% (vs 1/30 today)
- [ ] Per-bug wall-clock for ~90% of bugs stays at 5-6 min (investigate-024 contract preserved)
- [ ] Total fix-loop wall-clock ≤ 1.7× current (with Phase 6+7 mitigations active)
- [ ] No regression in existing detection (DOM kit-skeleton, reachability, build, dev-server, synthesized E2E)

## Validation criteria

Before archiving feat-066:

1. **Empirical re-validation** — run /fix-bugs against a fresh project (e.g. reading-log-03 or one of the gotribe pre-builds). Census the running site; count bugs caught vs missed. Target ≥85% catch rate.
2. **Wall-clock measurement** — median per-bug wall-clock ≤ 6 min for 90%+ of bugs; ≤ 10 min for systemic-fixer dispatches.
3. **No regression on reading-log-02 v5 outcomes** — re-run the 15 previously-resolved bugs through v2; all should still resolve.
4. **operator-attested checklist** — `docs/v2-validation-confirmed.txt` after operator walkthrough confirms quality lift is real.

## Phase tickets

- bug-078 — Phase 1 audit-computed-styles config fix + deterministic discriminators
- feat-067 — Phase 2 pixel-diff smoke layer
- feat-068 — Phase 3 vision-LLM perceptual review
- feat-069 — Phase 4 AI walkthrough (Playwright CLI variant)
- feat-070 — Phase 5 systemic-fixer agent variant
- feat-071 — Phase 6 cluster-bugs-pre-dispatch
- feat-072 — Phase 7 re-enable class-batched dispatch (selected classes)

## Cross-references

- **Parent investigation (now archived)**: investigate-025-fix-loop-effectiveness-v2
- **Empirical motivator**: bug-077-react-next-tailwind-pipeline (the smoking gun)
- **Sister investigations**: investigate-021 (parity-verify silent false-clean), investigate-022 (8 missed bugs on reading-log-01), investigate-023 (tester product-bug masking)
- **Speed axis (preserved)**: investigate-024-bug-fix-dispatch-efficiency — v2 must not regress per-bug wall-clock
- **Emergency follow-ups (orthogonal to v2)**: bug-079 (runtime-errors not elevated for passing tests), bug-080 (test-seed routes not in shipped projects), bug-081 (output:export breaks dynamic routes)

## Attempt Log

### Phase 0+1+2+5 shipped — 2026-05-11

- `1c92a00` Phase 0 (bug-079/080/081) + Phase 1 (bug-078 audit-computed-styles defaults + pre-verify discriminators) + Phase 5 (feat-070 systemic-fixer)
- `ca8a0fd` Phase 2 (feat-067 pixel-diff smoke layer)
- `646ea00` feat-067 Phase D follow-up (force light-mode rendering + pixel-minor schema gap)

### Empirical validation — 2026-05-11 (paused mid-run)

`/fix-bugs reading-log-02` invoked at 18:05 UTC, paused at 19:55 UTC (runId `788ab078-973f-4ff0-9627-b919d9c08bf7`). Wall-clock ~2hr, 6 of 21 bugs resolved.

**Class-by-class first-attempt success rate:**

| Class                                                 | Dispatched | Succeeded | Rate        |
| ----------------------------------------------------- | ---------- | --------- | ----------- |
| systemic-fixer (pixel-systemic + systemic-divergence) | 3          | 3         | 100%        |
| bug-fixer on orphan-route                             | 1          | 1         | 100%        |
| bug-fixer on `timeout-no-evidence` flow-failures      | 5          | 2         | **40%**     |
| bug-fixer on parity (layout/copy/pixel-minor)         | 0          | n/a       | not reached |

**feat-070 systemic-fixer empirical validation: ✅ confirmed effective.** Single-dispatch cross-file fixes resolved the bug-077-class systemic patterns that bug-fixer's narrow-scope contract couldn't.

**Pause trigger:** the `timeout-no-evidence` bug-fixer dispatches systematically stalled (repeated 90s SDK-message-warn thresholds; 3 of 5 went pending after attempt 1; flow-5 in-progress for 30+min producing only sporadic SDK messages). Rate degraded from 9 min/bug → 20 min/bug. Cost of continuing was disproportionate to additional signal.

### Attempt 3 — Escalated to investigation investigate-026-timeout-no-evidence-bug-fixer-stalls

See `plans/active/investigate-026-timeout-no-evidence-bug-fixer-stalls.md`. 30-min time-box; question: why do `timeout-no-evidence` bug-fixer dispatches systematically stall while other classes succeed? Investigation will produce a recommendation pointing at one of (A) enrich envelope, (B) capture artefacts at synthesizer emit time, (C) reroute to diagnostic-fixer, (D) accept-as-low-confidence operator-review-only.

feat-066 epic remains in-progress pending investigation result + decision on whether to ship Phase 3-7 (feat-068 vision-LLM, feat-069 AI walkthrough, feat-071 cluster-bugs, feat-072 class-batched re-enable) or whether investigate-026's recommendation closes the gap to the ≥95% production target without further phases.

### Phase 2 of the v2-epic shipped — 2026-05-13

(Note: "v2 epic Phase 2" ≠ feat-066's original "Phase 2 pixel-diff". The v2 epic renumbered its own phases: v2-Phase-1 = correctness infrastructure ship 2026-05-12; v2-Phase-2 = feat-069 AI walkthrough ship 2026-05-13.)

Shipped on `feat/vision-llm-perceptual-review`:

- `12aa669` v2-Phase-1 — bug-091 protected-files guard
- `e096be7` v2-Phase-1 — bug-089 auto-merge silent fail
- `aef062b` v2-Phase-1 — bug-090 verifier dedicated worktree
- `e8f000d` v2-Phase-1 — bug-092 mergeFirst on partial success
- `d82eefb` v2-Phase-2 — feat-069 Phase 1 (B.1 AI walkthrough route sweep)
- `05fb83e` v2-Phase-2 — feat-069 Phase B.2 (interaction sweep + dup-detector)
- `1ebb687` v2-Phase-2 — feat-069 Phase B.3 (confirm-dialog + render-aware poll)

**Empirical validation surface (2026-05-13, reading-log-02):**

- `/build-to-spec-verify` full 6-tier run with invokeAgent wired: $1.50, 15.6 min, 37 bug plans filed (16 from Tiers 4+5 newly active). 4 walkthrough findings + 13 perceptual findings + 16 carryover.
- Operator triage filtered 8 confident-pollution bugs (DB-wiped-before-perceptual artifacts); manually filed `bug-delete-content-type-400` from the walkthrough's empirically-validated finding.
- `/fix-bugs reading-log-02 --max-concurrent=3`: $26.55, 5/5 iterations, status `clean`, 0 pending bugs remaining. 9 of 91 bugs `failed` (4 pollution, 4 already-resolved, 1 tooling-infrastructure — none real product defects per post-run triage).
- Manual site verification: all 5 acceptance criteria pass (add book / edit-persist / search-filter / empty state / delete-with-confirm). DELETE returns 204, GET returns 404 — the `bug-delete-content-type-400` fix that ONLY feat-069's walkthrough Tier 5 could detect ships green.

**v2 epic Phase 3 candidates** (deferred for next session):

1. **In-loop verifier DB pollution** (P0) — rounds-orchestrator's mid-loop re-verify runs flow-execution (cleans DB tables) BEFORE perceptual + walkthrough tiers. Causes ~half the noise in /fix-bugs runs. New bug plan filed 2026-05-13.
2. **`bug-052` apiBase env regression** (P0) — synthesized flow specs hit :3000 instead of :3001 even with the bug-052 absolute-URL fix in place. New bug plan filed 2026-05-13.
3. **Scaffold `.env.example` ships with `ENABLE_TEST_SEED=0`** (P0) — verifier pre-flight rejects on contact; needed manual `=1` fix today. Scaffold-side issue; new bug plan filed 2026-05-13.
4. **bug-093 source-change-gaming** (P0) — pre-existing draft. Companion to #1.
5. **feat-071 cluster-bugs-pre-dispatch** (P1) — pre-existing draft. Once findings are honest (post-#1), batching kicks in for big cost wins.
6. **bugs.yaml `failureClass` field** — operator-side triage tool surfaced from today's 9-failed-bug experience.
7. **bug-094 — superseded** today by `bug-delete-content-type-400` (project-side); moved to `plans/superseded/`. No further action on this hypothesis.

Epic status: shipping v2-Phase-1 + v2-Phase-2 closes the ≥95% production target's biggest gaps (correctness infrastructure + behavioral detection). v2-Phase-3 is polish + cost-reduction, not gap-closure.
