---
id: bug-113-walkthrough-cascade-root-linkage
type: bug
status: archived
author-agent: human
created: 2026-05-15
updated: 2026-05-15
approved-at: 2026-05-15
completed-at: 2026-05-15
outcome: success
parent-plan: bug-112-dev-server-empty-error-and-pnpm-install
supersedes: null
superseded-by: null
branch: fix/walkthrough-cascade-root-linkage
affected-files:
  - orchestrator/src/build-to-spec-verify.ts
  - orchestrator/tests/build-to-spec-verify.test.ts
feature-area: orchestrator/build-to-spec-verify
priority: P1
attempt-count: 1
max-attempts: 5
error-message: null
reproduction-steps: |
  1. Run /build-to-spec-verify against a project where one screen renders a Next.js 404 / error page in the live build (e.g. gotribe-tribe-directory 2026-05-15: browse page route broken).
  2. Tier 4 perceptual files 1 bug: category=page-not-found.
  3. Tier 5 walkthrough flows visit the broken screen + try to interact with elements (click filter checkbox, click "Clear filters", etc.) — N findings, all symptoms of the same root.
  4. Pre-bug-113: walkthrough findings file FIRST (so they can't reference the perceptual planId) + carry no dependsOnBugId.
  5. /fix-bugs dispatches web-frontend-builder N+1 times for ONE structural fix (the broken route).
stack-trace: null
---

# bug-113-walkthrough-cascade-root-linkage: walkthrough findings should declare dependsOnBugId when a perceptual page-not-found bug exists

## Bug Description

When the verifier surfaces a perceptual `page-not-found` finding on the same iteration as walkthrough findings, the walkthrough findings are CASCADE SYMPTOMS of the broken route — they cannot resolve until the route renders. Without `dependsOnBugId` linkage, /fix-bugs dispatches web-frontend-builder once per walkthrough finding plus once for the perceptual bug, wasting retry budget on dependent symptoms.

Empirical motivator: gotribe-tribe-directory 2026-05-15 — bug-011 (perceptual: tribe-directory-browse renders Next.js 404) was the root of bug-007 (filter-checkboxes-have-no-accessible-name), bug-008 (Clear-filters-button-not-present), bug-009 (header-about-link-navigates-to-wrong-route), bug-010 (React-hydration-mismatch). All 4 walkthrough findings were on the SAME broken screen — the locator timeouts were symptoms of "page didn't render at all", not 4 distinct product bugs.

## Root Cause Analysis

`orchestrator/src/build-to-spec-verify.ts` filed walkthrough bugs BEFORE perceptual bugs (lines 1149-1181 ran before lines 1183-1221). The walkthrough filing site had no way to reference perceptual planIds because they hadn't been filed yet. dependsOnBugId could not be set.

The existing `dependsOnBugId` mechanism already works correctly downstream:

- `scripts/file-bug-plan.mjs` accepts it as a parameter and persists it to bugs.yaml.
- `orchestrator/src/fix-bugs-loop.ts` reads it and suppresses dependent dispatches until the root resolves.
- The flow-failure cascade routing (line 836) already uses this pattern for runtime-error / dev-server-compile bugs blocking timeout-no-evidence dependents.

This bug closes the same routing gap for the perceptual / walkthrough pair.

## Fix Approach

Two changes in `orchestrator/src/build-to-spec-verify.ts`:

1. **Swap filing order** — perceptual filing block (was at lines 1183-1221) moves BEFORE walkthrough filing block (was at lines 1149-1181). The semantics-of-cascade dictate that root files first; dependents file second.

2. **Track cascade root** — during perceptual filing, when a finding's `category === "page-not-found"`, capture its planId into `cascadeRootBugIdByScreen` (Map<screen, planId>) AND a `firstPageNotFoundBugId` scalar (any-screen root). During walkthrough filing, when `firstPageNotFoundBugId !== null`, set `args.dependsOnBugId` accordingly.

Scope: iteration-wide. If ANY perceptual page-not-found bug fires, ALL walkthrough findings depend on the first such planId. Per-flow scoping (matching walkthrough flow's expectedScreenId to perceptual screen) is deferred — coarse iteration-wide scope is correct because page-routing being broken anywhere blocks confident walkthrough verdict on every flow.

## Validation Criteria

- [x] `orchestrator/tests/build-to-spec-verify.test.ts` regression test: perceptual page-not-found + 2 walkthrough findings → perceptual files FIRST, both walkthrough findings carry dependsOnBugId pointing to the perceptual planId.
- [x] Regression test for non-cascade case: walkthrough finding without any perceptual page-not-found → dependsOnBugId remains undefined.
- [x] `pnpm --filter orchestrator test -- --run tests/build-to-spec-verify.test.ts` → 41/41 pass (+2 new bug-113 tests on 39 baseline).
- [x] TypeScript clean.

## Attempt Log

### Attempt 1 — 2026-05-15 — shipped in one PR (master commit + merge)

**What changed:**

- `orchestrator/src/build-to-spec-verify.ts` — swap perceptual+walkthrough filing order; track `cascadeRootBugIdByScreen` Map + `firstPageNotFoundBugId` scalar during perceptual filing; pass `firstPageNotFoundBugId` as `dependsOnBugId` on walkthrough filing.
- `orchestrator/tests/build-to-spec-verify.test.ts` — 2 new tests in `runBuildToSpecVerify — bug-113 walkthrough cascade-root linkage` describe block.

**Validation:**

- `pnpm --filter orchestrator test -- --run tests/build-to-spec-verify.test.ts` → 41/41 pass

### Lessons

1. **Filing order matters for dependsOnBugId.** The flow-failure cascade routing precedent already filed cascade-roots FIRST to capture planIds for dependents (line 657-674). bug-113 just extends that pattern to the perceptual+walkthrough pair.
2. **Coarse cascade scope is fine for v1.** Per-flow matching of walkthrough findings to perceptual screens requires consuming the user-flows-manifest.json + walkthrough's expectedScreenId map. The iteration-wide scope is conservatively correct: page-routing-broken-anywhere blocks confident walkthrough verdict on every flow.
3. **bug-113 is empirically validated.** Without bug-113, the gotribe-tribe-directory verifier output had 4 walkthrough findings + 1 perceptual finding with no linkage; /fix-bugs would dispatch web-frontend-builder 5×. Post-bug-113, the dispatch order is 1× perceptual + 4× walkthrough-with-dependsOnBugId — and /fix-bugs's existing dependsOnBugId-suppression collapses to 1 root dispatch + re-verify.

### Cross-references

- bug-112 (parent) — verifier-spawn empty-error class fix that made Tier 3+4+5 actually run, surfacing the cascade pattern
- investigate-033 (grandparent) — the investigation that proved Tier 4+5 were cascade-skipping
- bug-091 / flow-failure-cascade — precedent for filing cascade-roots first with dependents declaring dependsOnBugId
- gotribe-tribe-directory 2026-05-15 — empirical project where this surfaced
