---
id: bug-087-perceptual-category-routing
type: bug
status: in-progress
author-agent: human
created: 2026-05-12
updated: 2026-05-12
parent-plan: feat-066-fix-loop-effectiveness-v2
supersedes: null
superseded-by: null
branch: fix/perceptual-category-routing
affected-files:
  - scripts/file-bug-plan.mjs
  - orchestrator/tests/file-bug-plan-parity.test.ts
feature-area: orchestrator/fix-loop
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "bug-fixer fails on 89% of perceptual-divergence bugs because most aren't smallest-diff-shaped"
---

# bug-087: route perceptual-divergence bugs by category (functional → operator-review, missing-element → systemic-fixer)

## Bug Description

Empirical evidence from reading-log-02 feat-068 Phase D 2.0 run (2026-05-12): 42 perceptual-divergence bugs filed by Tier 4 vision-LLM. Of the 9 dispatched to bug-fixer before pause:

- 1 completed (~11% success)
- 7 caught by bug-082's unverified-completion guard (bug-fixer returned "completed" with no diff)
- 1 hit wall-clock-stall (15-min timeout)

That's the same ~80%+ failure rate bug-085 surfaced for layout-regrouping bugs. The empirical fix shape is identical: route by bug-class hint to the right agent.

The agent's emitted `category` field gives us the discriminator:

| Category cluster                                                                       | What it means                                     | Right agent                     |
| -------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------- |
| `functional`, `runtime-error`, `runtime`, `state-routing`, `missing-interactive-state` | Backend/data routing bug — no source fix possible | **operator-review** (`[]`)      |
| `missing-element`, `missing-component`, `layout`                                       | Structural cross-component drift                  | **systemic-fixer**              |
| `copy-mismatch`, `polish`, (no-category), `branding`, `nav`, element-name categories   | Element-level / source-of-truth lookups           | **bug-fixer** (current default) |

## Reproduction Steps

1. Re-run `/fix-bugs reading-log-02` (or any project) with the feat-068 stack active.
2. Wait for end-of-iteration verify to file `perceptual-divergence` bugs.
3. Inspect `docs/bugs.yaml` — every perceptual bug routes to `[bug-fixer]` regardless of category.
4. Watch bug-fixer dispatches: most return `taskOutcomes: completed` with no commit (bug-082 catches) OR hit the 15-min wall-clock cap.

Empirical: 42 perceptual bugs filed in the run above; 8 of 9 dispatched failed.

## Root Cause Analysis

`scripts/file-bug-plan.mjs:defaultAgentSequence` (post-feat-085):

```js
case "perceptual-divergence":
  return ["bug-fixer"];
```

Uniform routing. No category awareness. Identical anti-pattern to the pre-bug-085 `visual-parity` case before pattern-aware routing landed.

The agent IS emitting `category` (the schema-evolution work in `5dd011a` captured it through bugs.yaml's `BugPerceptualContext`). The routing layer just doesn't read it.

## Fix Approach

### Phase A — category-aware routing (~30min)

In `scripts/file-bug-plan.mjs`:

**1. Preserve `category` through the violation→routing remap.** Mirror the bug-085 pattern (which preserves `parity.pattern`):

```js
} else if (violation.kind === "perceptual-finding") {
  violationForRouting = {
    primaryCause: "perceptual-divergence",
    perceptual: { category: violation.category },
  };
}
```

**2. Read `perceptual.category` in `defaultAgentSequence`:**

```js
case "perceptual-divergence": {
  const category = violation?.perceptual?.category;
  if (category === undefined) return ["bug-fixer"];

  const OPERATOR_REVIEW_CATEGORIES = new Set([
    "functional",
    "runtime-error",
    "runtime",
    "state-routing",
    "missing-interactive-state",
  ]);
  const SYSTEMIC_FIXER_CATEGORIES = new Set([
    "missing-element",
    "missing-component",
    "layout",
  ]);

  if (OPERATOR_REVIEW_CATEGORIES.has(category)) return [];
  if (SYSTEMIC_FIXER_CATEGORIES.has(category)) return ["systemic-fixer"];
  return ["bug-fixer"]; // copy-mismatch / polish / branding / element-name / no-category
}
```

### Phase B — tests (~15min)

5 routing branches to cover in `orchestrator/tests/file-bug-plan-parity.test.ts`:

1. `perceptual-finding` + `category: "functional"` → `agentSequence: []` (operator-review)
2. `perceptual-finding` + `category: "missing-element"` → `["systemic-fixer"]`
3. `perceptual-finding` + `category: "copy-mismatch"` → `["bug-fixer"]` (default-other)
4. `perceptual-finding` + no `category` → `["bug-fixer"]` (default-undefined)
5. `perceptual-finding` + `category: "runtime-error"` → `[]` (operator-review)

### Phase C — empirical re-validation (~1hr wall-clock + ~$2-3)

Reset the 33 dispatched perceptual bugs back to pending. Reset the 30 untouched bugs' agentSequence to whatever bug-087 determines per their category. Re-run /fix-bugs. Expected:

- ~12-15 bugs route to operator-review (functional / runtime / state-routing)
- ~15-20 bugs route to systemic-fixer (missing-element / missing-component / layout)
- ~5-10 bugs stay at bug-fixer (copy-mismatch / polish / element-name)

Target: systemic-fixer should clear 60%+ of its bugs (mirroring bug-085's empirical 100% on layout-regrouping). bug-fixer success rate on its narrower lane should jump to 50%+.

## Conservative scope notes

**Categories I'm NOT including in bug-087 v1** (and why):

- `branding`, `nav`, `header`, `search`, `book-list-item`, `filter-tabs`, `tag-filter` — these are **element-name** categories, not bug-shape categories. They describe WHERE the bug is, not WHAT KIND. Default to bug-fixer; observe empirically whether they need promotion.
- `polish` — by definition small, bug-fixer's lane.
- Unknown / future categories — default to bug-fixer. Adding rows to the routing table is a non-breaking change.

The categories I AM including are the ones where I have HIGH confidence based on the 9-bug empirical sample. As we accumulate more category data, we expand the table.

## Rejected Fixes

- **Tighten the agent's `category` taxonomy** — useful eventually but doesn't solve today's routing gap. The agent already emits useful categories; the orchestrator just ignores them. Routing first, prompt-engineering second.
- **Default ALL perceptual-divergence to operator-review** — wastes the cases where bug-fixer CAN actually fix things (1 of 9 succeeded; that's not nothing).
- **Route by severity (P0 → operator-review, P1/P2 → bug-fixer)** — every perceptual bug in this run was rated P0, so severity doesn't discriminate. Category does.
- **Bump bug-fixer's maxTurns / wall-clock cap** — same reason as bug-085 rejected this: turn budget isn't the problem; the smallest-diff contract is.

## Validation Criteria

- [ ] `scripts/file-bug-plan.mjs` preserves `category` in the perceptual-finding violation→routing remap
- [ ] `defaultAgentSequence`'s `perceptual-divergence` case routes by category per the table above
- [ ] 5 new tests in `file-bug-plan-parity.test.ts` cover all routing branches
- [ ] Empirical: re-run /fix-bugs reading-log-02 after Phase A lands; ~12-15 perceptual bugs route to needs-operator-review (`agentSequence: []`) on file; ~15-20 route to systemic-fixer; the rest to bug-fixer
- [ ] No regression on existing 49 file-bug-plan-parity tests

## Cross-references

- **bug-085** (`40defc9`) — pattern-aware routing for visual-parity. bug-087 mirrors the exact same approach for perceptual-divergence.
- **bug-086** (`dc4521a`) — extended bug-085's routing to copy-sizing-drift. Same series.
- **feat-068** Phase A (`04b722b`) + followup (`5dd011a`) — the perceptual-review layer + the schema-evolution that captured `category` from the agent.
- **feat-071** (cluster-bugs-pre-dispatch) — orthogonal but adjacent: clusterer would collapse 7-of-7 same-screen findings into one cluster, then bug-087's category routing decides which agent gets the cluster.
- **reading-log-02 feat-068 Phase D 2.0 run 2026-05-12** — the empirical case file. 42 perceptual bugs, 9 dispatched, 8 failed.

## Attempt Log

### Attempt 1 — 2026-05-12 — Phase A+B landed

- **Phase A — routing**: Added category-aware branch in `scripts/file-bug-plan.mjs:defaultAgentSequence`. The `perceptual-divergence` case now reads `violation.perceptual.category` and routes per the table:
  - `functional`, `runtime-error`, `runtime`, `state-routing`, `missing-interactive-state` → `[]` (operator-review)
  - `missing-element`, `missing-component`, `layout` → `["systemic-fixer"]`
  - All other categories (including `undefined`/`null`) → `["bug-fixer"]` (default)

- **Companion fix — preserve `category` through the remap**: Mirror of bug-085's preservation pattern. The fileBugPlan call-site at line ~1222 now constructs `violationForRouting = { primaryCause: "perceptual-divergence", perceptual: { category: violation.category } }` so defaultAgentSequence can read the category.

- **Phase B — tests**: 5 new tests in `orchestrator/tests/file-bug-plan-parity.test.ts`:
  - `feat-068` test renamed: "without category → [bug-fixer] (default)" — preserves the original assertion shape.
  - `bug-087: category=functional → []`
  - `bug-087: category=runtime-error → []`
  - `bug-087: category=missing-element → ["systemic-fixer"]`
  - `bug-087: category=copy-mismatch → ["bug-fixer"]`
  - `bug-087: category=unrecognized-future-value → ["bug-fixer"]` (forward-compat safe default)

- 225/225 tests passing across 7 suites (file-bug-plan-parity + rounds-orchestrator + round-state + perceptual-review + fix-bugs-loop + bug-fix-context + feature-graph).

- **Phase C — empirical re-validation pending**. Re-running /fix-bugs reading-log-02 will require resetting the 9 already-dispatched perceptual bugs back to pending. The 30 untouched perceptual bugs already have `agentSequence: ["bug-fixer"]` in their bugs.yaml entries — those would need their agentSequence re-derived by category. Two options for the re-validation:
  1. Reset all 42 perceptual bugs to pending + re-derive agentSequence per category from their existing `bug.perceptual.category` field. New tmp script needed.
  2. Delete the 42 perceptual entries from bugs.yaml, let the next verify pass re-file them with bug-087 active. Cleaner but loses iteration history.

Recommend option 1 for the immediate re-validation (preserves errorLog history; same empirical baseline as before).

Outcome: Phase A+B landed. Empirical Phase C ready to execute.
