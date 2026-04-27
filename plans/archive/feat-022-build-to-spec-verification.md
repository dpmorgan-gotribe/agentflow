---
id: feat-022-build-to-spec-verification
type: feature
status: completed
author-agent: claude-opus-4-7
created: 2026-04-27
updated: 2026-04-27
completed-at: 2026-04-27
parent-plan: investigate-006-build-to-spec-verification
supersedes: null
superseded-by: null
branch: feat/build-to-spec-verification
affected-files:
  - .claude/skills/build-to-spec-verify/SKILL.md
  - scripts/audit-app-reachability.mjs
  - scripts/synthesize-flow-e2e.mjs
  - schemas/build-to-spec-verify-output.schema.json
  - packages/orchestrator-contracts/src/build-to-spec-verify.ts
  - orchestrator/src/feature-graph.ts
  - orchestrator/src/invoke-agent.ts (post-Mode-B dispatch)
  - .claude/skills/screens/SKILL.md (data-screen-id convention)
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-022 — Post-Mode-B build-to-spec verification

## Summary

After Mode B reports `Features completed: N/N` the orchestrator currently emits "complete" without any check that the merged features compose into a working product. Per investigate-006 (kanban-webapp-09), 5 of 8 surfaced integration gaps are catchable by deterministic mechanisms: a **flow-driven E2E synthesizer** that consumes the existing `docs/user-flows-manifest.json` + a **static reachability analyzer** that flags exported components/routes never imported in production.

This feature ships both as a new pipeline stage `/build-to-spec-verify` that runs after the last feature merge and before the orchestrator's "complete" signal. Failures auto-file bug plans and route to the standard retry ladder (max 3 per task, escalation to human at 5).

## Goals

1. Catch the kanban-webapp-09 class of gap before the human discovers it (concretely: the orphan `CardDetailModal` + the missing settings nav link would have failed loud).
2. Deterministic + cheap: ~$2-5/run, reuse the existing visual-review Playwright MCP harness, no new LLM agents.
3. Failures preserved as regression tests for subsequent runs (synthesized specs persist at `apps/web/e2e/synthesized/flow-{n}.spec.ts`).
4. Bug plans auto-filed with enough context for a builder to fix on retry without human intervention.

## Non-goals (deferred)

- **Screenshot-diff** against `docs/screens/<id>.html` mockups. High engineering cost, lower marginal catch rate over flow-E2E for our gap distribution. Consider as v2.
- **Brief §11/§12 capability coverage** at the PM stage. Pattern C gaps (column rename/delete, `/help`) are PM-stage holes — fixed in feat-023, not here.
- **LLM-driven brief→E2E synthesis** (option #7 in the investigation). Higher variance than the deterministic flows-manifest path. v3.
- **Cross-platform**: web only for v1. Mobile (Maestro flows) follows the same pattern but ships separately.

## Approach

Five deliverables, ordered by load-bearing-ness.

### Phase 1 — `data-screen-id` convention

Each `docs/screens/{platform}/{id}.html` mockup already carries `data-kit-layout="..."` attributes for visual-review. Add a sibling convention: every screen mockup MUST carry `<body data-screen-id="{id}">`, and every built page MUST render the same attribute on its body or page-root wrapper.

Update:

- `.claude/skills/screens/SKILL.md`: require `data-screen-id` in mockup body
- `.claude/skills/web-frontend-builder/SKILL.md` (and stack-skill equivalents) §Page convention: require `data-screen-id` on page-root component
- `scripts/synthesize-flow-e2e.mjs` asserts `document.body.dataset.screenId === expected` between flow transitions

This is the single thread that lets the synthesizer assert "after clicking X, we're on screen Y". One-line per page; trivial to retrofit.

### Phase 2 — Static reachability analyzer

`scripts/audit-app-reachability.mjs`:

```
Input: docs/tasks.yaml (for owning-feature attribution)
       apps/{web,mobile,api}/src/ (or stack-skill canonical layouts)

Algorithm:
  1. Walk all *.tsx / *.ts under apps/*/src/ excluding *.test.* and *.spec.*
  2. For each file with a non-default export, find ALL importers in production code
     (anything not under tests/, .test., .spec., __tests__/, e2e/)
  3. Flag exports with zero production importers as orphan candidates
  4. Walk app/**/page.tsx (Next.js convention) — for each route, search for any
     <Link href="/route">, router.push("/route"), or static href text in
     production code
  5. Flag pages with no inbound links as orphan-routes

Output: { orphanComponents: [{path, owningFeature, suggestedImporters[]}],
          orphanRoutes:    [{path, owningFeature, suggestedNavSurfaces[]}] }
```

`suggestedImporters[]` uses the task's `summary` field to hint where the wiring should live (e.g. "render-card-modal" → suggest `KanbanBoard.tsx` / `HomeBoardView.tsx` based on screen mockup containment).

Ignore-list convention: a `// reachability-allow: <reason>` comment at the top of an exported file marks it as intentionally orphan (e.g., entry shims, future-feature components behind a flag). Per investigate-006 open question #4.

### Phase 3 — Flow-driven E2E synthesizer

`scripts/synthesize-flow-e2e.mjs`:

```
Input: docs/user-flows-manifest.json (already machine-readable; 10 flows for kanban-09)
       docs/screens/{platform}/*.html (asserted screenIds)

For each flow in manifest:
  1. Generate apps/web/e2e/synthesized/flow-{n}.spec.ts
  2. Each spec walks the steps:
     - Navigate to step.entry_screen
     - Assert document.body.dataset.screenId === step.entry_screen
     - Execute step.action (click, type, drag, keypress) per a small DSL
       (manifest already encodes these as semi-structured fields)
     - Assert document.body.dataset.screenId === step.exit_screen (within 2s)
  3. On failure: capture the failing step + a screenshot + the page's HTML
     to docs/build-to-spec/failures/flow-{n}-step-{m}.{html,png}

Output: spec files persist (regression suite for next run)
        failure context goes to BuildToSpecVerifyOutput
```

Action DSL is intentionally tiny — maps the manifest's `action: "click cardlike element"` field to `await page.locator(...).first().click()`. Keep the DSL well-known and small; LLMs author the manifest so the field names are predictable.

### Phase 4 — Orchestrator wiring + bug-plan auto-author

In `orchestrator/src/feature-graph.ts`, after the last feature merges:

```ts
if (allFeaturesMerged) {
  const verify = await ctx.invokeAgent({
    agent: "build-to-spec-verify",  // new skill, no LLM — deterministic script wrapper
    cwd: ctx.projectRoot,
    ...
  });
  if (verify.violations.length > 0) {
    for (const v of verify.violations) {
      await autoFileBugPlan(v);  // template based on violation kind
    }
    return { status: "completed-with-integration-failures", ... };
  }
}
```

Bug-plan templates (consolidate orphan-component + flow-failure into one plan when they share a feature):

```
bug-NNN-flow-{n}-{slug}
  ## Description
  Flow `{flow.name}` failed at step {m}: clicked `{selector}` on `{entry_screen}`,
  expected to land on `{exit_screen}` within 2s; landed on `{actual_screen}`.

  Likely cause (orphan analyzer correlates):
  - {ComponentName} ({path}) is exported but never imported in production
  - Owning feature: {feature_id}
  - Suggested integration point: {suggestedImporters[0]}

  ## Fix approach
  Wire {ComponentName} into {suggestedImporters[0]}; pass {expected_props} from
  parent state. See screen mockup at docs/screens/{platform}/{exit_screen}.html
  for layout reference.

  ## Validation
  Re-run /build-to-spec-verify; flow-{n} must pass + reachability for {ComponentName}
  must clear.
```

Routing: orchestrator dispatches `web-frontend-builder` (or appropriate by feature) with the bug-plan as `retryContext`, max 3 attempts per bug, escalation to human at 5 (matches existing `genuineProductBugs[]` ladder from tester).

### Phase 5 — Skill + schema

`.claude/skills/build-to-spec-verify/SKILL.md`:

- Inputs: project root path
- Steps: start dev server (reuse `visual-review-preflight.mjs`); run reachability + flow-E2E in parallel; teardown server; emit JSON
- Output contract: `BuildToSpecVerifyOutput` schema below

`packages/orchestrator-contracts/src/build-to-spec-verify.ts`:

```ts
export const BuildToSpecVerifyOutput = z.object({
  ok: z.boolean(),
  reachability: z.object({
    orphanComponents: z.array(OrphanComponent),
    orphanRoutes: z.array(OrphanRoute),
  }),
  flows: z.object({
    passed: z.array(z.string()), // flow ids
    failed: z.array(FlowFailure), // { flowId, step, expected, actual, screenshot, html }
  }),
  bugPlansFiled: z.array(z.string()), // plan IDs
  costUsd: z.number(), // ~$0 for v1 (no LLM)
  durationMs: z.number(),
});
```

`schemas/build-to-spec-verify-output.schema.json`: Zod-generated JSON schema (same pattern as `BuilderOutputJsonSchema` from bug-004).

## Validation criteria

- Re-run on a fresh kanban-webapp snapshot through to Mode B completion. Observe `/build-to-spec-verify` runs after last merge, fails on flow-4 (card modal) + flow-7 (settings nav), files 2 bug plans, dispatches builder retries.
- After retry resolves: re-run verify; flows pass; reachability clears for `CardDetailModal`. Synthesized specs persist as regression tests.
- A subsequent run on a different project (book-swap, finance-track) generates flow-specs from THAT project's user-flows-manifest with no project-specific code paths.
- Reachability analyzer: 0 false positives on the post-monkey-patch kanban-webapp-09 (where everything IS wired).
- Total runtime: < 90s for a 10-flow project. Total cost: < $1 (no LLM in v1).

## Cross-references

- **Parent**: investigate-006 — full option survey + gap catalog + per-option coverage matrix
- **Sibling**: feat-023 — PM-stage brief-coverage assertion (catches the 3 misses this plan can't catch: column rename/delete, /help)
- **Reuses**: `scripts/visual-review-preflight.mjs` (Playwright MCP harness + dev-server lifecycle)
- **Schema pattern**: bug-004 (`BuilderOutputJsonSchema`)
- **Retry ladder**: tester `genuineProductBugs[]` (testing-policy.md)
- **Open follow-ups (per investigate-006)**: data-screen-id retrofit strategy, ignore-list false-positive rate, visual-review-preflight.mjs hardening — defer to investigate-007 if they bite during build

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->
