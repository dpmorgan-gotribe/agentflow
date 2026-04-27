---
name: build-to-spec-verify
description: Deterministic post-Mode-B verification stage. Runs static reachability + flow-driven E2E synthesis, auto-files bug plans on violations, returns BuildToSpecVerifyOutput. Wraps two scripts (audit-app-reachability.mjs + synthesize-flow-e2e.mjs); NO LLM dispatch. Invoked by the orchestrator (feat-022) after the last feature merges and before "complete" emits.
when-to-use: invoked by orchestrator runFeatureGraph() after all features merge AND before the "complete" signal; never invoked inline inside feature work; never invoked manually except for diagnostic re-runs against a green build
allowed-tools: Read Write Bash Grep Glob
model: inherit
---

# /build-to-spec-verify — Post-Mode-B integration verification

The deterministic stage that catches the kanban-webapp-09 class of gap (orphan `CardDetailModal` shipping through the green pipeline) BEFORE the orchestrator emits "complete". Combines two cheap, deterministic mechanisms — static reachability + flow-driven E2E synthesis — and routes failures via auto-filed bug plans through the standard retry ladder.

This skill is a **deterministic script wrapper** — it shells out to two pure-Node scripts in parallel, aggregates their output, and emits a typed JSON contract. No LLM dispatch. No vision calls. ~$0/run.

## Arguments

- `--project-dir <path>` (required) — absolute path to the project root (e.g. `projects/kanban-webapp-09`)
- `--factory-root <path>` (default `process.cwd()`) — repo root where `scripts/audit-app-reachability.mjs` + friends live
- `--no-bug-plans` — surface violations in the return JSON but do NOT auto-file plans (diagnostic mode)

## Steps

### 1. Pre-flight

Abort cleanly (no side effects) on any failure:

- `<project-dir>` exists and contains either `apps/web/src/` OR `apps/web/app/` (the analyzer otherwise has nothing to scan)
- `scripts/audit-app-reachability.mjs` exists at `<factory-root>`
- `scripts/synthesize-flow-e2e.mjs` exists at `<factory-root>`
- `<project-dir>/docs/user-flows-manifest.json` exists (synthesizer surfaces a warning when missing — not fatal, but the flows.generated[] list will be empty)

The wrapper reuses the lifecycle pattern from `scripts/visual-review-preflight.mjs` for any future steps that need a dev server. v1 does NOT need a server because the synthesizer only WRITES Playwright specs — it doesn't run them. Spec execution is owned by the next tester invocation (which already runs `pnpm playwright test`).

### 2. Run the two analyzers in parallel

Both are pure-Node scripts; spawn each via `node <script> <project-dir>` and capture stdout+stderr:

```bash
node scripts/audit-app-reachability.mjs <project-dir>
node scripts/synthesize-flow-e2e.mjs <project-dir>
```

The orchestrator wrapper (`orchestrator/src/build-to-spec-verify.ts`) does this via `child_process.spawn`. JSON results are parsed and merged into the return contract.

**Reachability output shape:**

```json
{
  "ok": true|false,
  "scannedFiles": <int>,
  "orphanComponents": [{ path, exportNames[], owningFeature, suggestedImporters[], reason }],
  "orphanRoutes": [{ path, routePattern, owningFeature, suggestedNavSurfaces[], reason }],
  "ignoredByAllowComment": [<rel-path>...]
}
```

**Synth output shape:**

```json
{
  "ok": true|false,
  "flowsCount": <int>,
  "generatedFiles": [<rel-path>...],
  "skippedFiles": [<rel-path>...],
  "projectDir": <abs-path>,
  "outDir": "apps/web/e2e/synthesized"
}
```

### 3. Auto-file bug plans (default behavior)

For each violation in `reachability.orphanComponents[]` + `reachability.orphanRoutes[]`, invoke `scripts/file-bug-plan.mjs` (programmatic via dynamic import). Each call:

1. Walks `plans/active/` + `plans/archive/` for existing `bug-NNN-` plans, picks `max+1`
2. Writes `plans/active/bug-NNN-{slug}.md` with frontmatter + body templated from the violation
3. Returns `{ planId, planPath }`

Plan body structure (see `scripts/file-bug-plan.mjs` for template):

```
## Description           — the violation in one paragraph
## Likely cause          — orphan attribution + owning feature
## Suggested integration — top 3 files from heuristic
## Fix approach          — explicit "wire X into Y" instruction
## Validation            — re-run /build-to-spec-verify to confirm
```

**Consolidation:** when an orphan component AND a flow failure share an `owningFeature`, the wrapper merges both into a single bug plan whose "Likely cause" lists both — saves a builder round-trip.

`--no-bug-plans` skips this step entirely; the violations still appear in the return JSON for diagnostic review.

### 4. Validate against the contract

The wrapper Zod-parses its own output against `@repo/orchestrator-contracts.BuildToSpecVerifyOutput` before returning. Schema drift between this code and the contract surfaces as a parse error — the orchestrator treats that as a verification crash and marks the run `completed-with-integration-failures` with a synthesized warning.

### 5. Return JSON

```json
{
  "ok": true|false,
  "reachability": { ... },
  "flows": {
    "passed": [<flowId>...],
    "failed": [<FlowFailure>...],
    "generated": [<rel-path>...]
  },
  "bugPlansFiled": [<planId>...],
  "costUsd": 0,
  "durationMs": <int>,
  "warnings": [<string>...]
}
```

`ok === true` iff:

- `reachability.orphanComponents.length === 0`
- `reachability.orphanRoutes.length === 0`
- `flows.failed.length === 0`

The orchestrator's `runFeatureGraph` reads `verify.ok` + sets the run-level `status`:

- `completed` — all features merged AND verify ok
- `completed-with-integration-failures` — all features merged BUT verify surfaced violations + filed bug plans
- `incomplete` — at least one feature failed (verify is skipped on this branch)

## What this skill does NOT do

- **Run the synthesized specs.** The synthesizer only WRITES the spec files; execution is the tester's job on the next pass. v2 may add a dev-server-launch + run-once step here for tighter feedback loops.
- **Screenshot-diff against mockups.** Out of scope per plan §Non-goals (high engineering cost, lower marginal catch-rate over flow-E2E).
- **Brief §11/§12 capability coverage.** That's feat-023's job (`/pm` stage).
- **LLM-driven brief→E2E synthesis.** Higher variance than the deterministic flows-manifest path; deferred to v3.
- **Cross-platform.** Web only for v1. Mobile (Maestro flows) follows the same pattern but ships separately.

## Failure modes + retry routing

| Symptom                               | Surfaced as                                   | Orchestrator routes to             |
| ------------------------------------- | --------------------------------------------- | ---------------------------------- |
| Orphan component                      | bug plan + `bugPlansFiled[]`                  | web-frontend-builder retry (max 3) |
| Orphan route                          | bug plan + `bugPlansFiled[]`                  | web-frontend-builder retry (max 3) |
| Flow E2E failure (next tester run)    | tester surfaces via `genuineProductBugs[]`    | builder per existing tester ladder |
| Synth crash (missing manifest)        | `warnings[]` entry; flows.generated[] empty   | operator review (not auto-routed)  |
| Reachability crash (script not found) | `warnings[]` entry; reachability empty arrays | operator review (not auto-routed)  |

All retries follow the standard ladder: max 3 per task, escalation to human at 5 (matches the tester's `genuineProductBugs[]` pattern from `testing-policy.md`).

## Cost + runtime

- Per-run: ~$0 (no LLM dispatch in v1)
- Runtime: < 10s for a 25-file / 10-flow project; scales linearly with file count
- Stage cap: $0.50 per run (defensive — catches v2 LLM additions if they accidentally land)

## Integration points

- **Task 035** (orchestrator): `runFeatureGraph` invokes this stage after all features merge; sets run-level `status` based on `verify.ok`
- **Task 034b** (output schemas): `BuildToSpecVerifyOutput` lives in `packages/orchestrator-contracts/src/build-to-spec-verify.ts`; JSON schema export at `schemas/build-to-spec-verify-output.schema.json`
- **`/screens` skill** §4e.1: every mockup body must carry `data-screen-id="{id}"` — the synthesizer's expected-screen assertion depends on this
- **react-next / svelte-kit stack skills** §1c: every page-root render must mirror the same `data-screen-id` on its topmost element
- **Task 037** (Lessons agent): aggregates `verify.reachability.orphanComponents[]` + `verify.flows.failed[]` across projects → populates the integration-gap pattern log

## Cross-references

- `plans/active/feat-022-build-to-spec-verification.md` — this skill's parent plan
- `plans/archive/investigate-006-build-to-spec-verification.md` — option survey + gap catalog
- `scripts/audit-app-reachability.mjs` — reachability analyzer (pure-Node)
- `scripts/synthesize-flow-e2e.mjs` — flow-E2E synthesizer (pure-Node)
- `scripts/file-bug-plan.mjs` — bug-plan auto-author (programmatic + CLI)
- `scripts/visual-review-preflight.mjs` — dev-server lifecycle pattern this skill mirrors for any future v2 server-needed steps
- `orchestrator/src/build-to-spec-verify.ts` — TypeScript wrapper that orchestrator dispatches to
- `packages/orchestrator-contracts/src/build-to-spec-verify.ts` — Zod schema + types
- `schemas/build-to-spec-verify-output.schema.json` — Zod-derived JSON Schema for non-SDK consumers

## Acceptance criteria

- [x] Skill markdown exists with the frontmatter above
- [x] Wraps `audit-app-reachability.mjs` + `synthesize-flow-e2e.mjs` (no LLM dispatch)
- [x] Auto-files bug plans via `file-bug-plan.mjs`; `--no-bug-plans` opts out
- [x] Returns shape matches `BuildToSpecVerifyOutput` Zod schema
- [x] Orchestrator integration sets `status: "completed-with-integration-failures"` when violations present
- [x] Orphan-component detection verified against kanban-webapp-09 HEAD pre-monkey-patch (catches `CardDetailModal`)
- [x] Zero false positives on the post-monkey-patch state
- [x] All existing orchestrator tests still pass after wiring
- [x] New tests cover happy + violation + skip + thrower paths in feature-graph
