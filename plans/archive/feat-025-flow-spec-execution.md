---
id: feat-025-flow-spec-execution
type: feature
status: completed
approved-at: 2026-04-27
approved-by: human
author-agent: claude-opus-4-7
created: 2026-04-27
updated: 2026-04-27
completed-at: 2026-04-27
parent-plan: feat-022-build-to-spec-verification
supersedes: null
superseded-by: null
branch: feat/flow-spec-execution
affected-files:
  - .claude/skills/build-to-spec-verify/SKILL.md
  - scripts/run-synthesized-flows.mjs
  - scripts/synthesize-flow-e2e.mjs (signature additions for failure paths)
  - orchestrator/src/build-to-spec-verify.ts (new run-flows subcommand)
  - .claude/skills/agents/front-end/react-next/SKILL.md (Playwright setup discipline)
  - .claude/skills/agents/front-end/svelte-kit/SKILL.md (same)
  - .claude/agents/tester.md (Playwright dep install + config requirement)
  - packages/orchestrator-contracts/src/build-to-spec-verify.ts (extend BuildToSpecVerifyOutput.flows.failed[].screenshot/html)
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-025 — Execute synthesized flow specs (Phase 2 of feat-022)

## Summary

feat-022 v1 ships a flow-E2E synthesizer (`scripts/synthesize-flow-e2e.mjs`) that emits Playwright `.spec.ts` files but **never executes them**. To actually catch behavioural integration gaps (modal-click-doesn't-open, missing nav links, broken transitions), the orchestrator must:

1. Ensure Playwright is installed + configured in the project
2. Start the project's dev server
3. Run the synthesized specs against it
4. Collect failures (screenshot + HTML dump)
5. Auto-file bug plans per failed flow
6. Tear down the dev server

Discovery from kanban-webapp-10 (2026-04-27 manual run): the project doesn't even have `@playwright/test` in `apps/web/package.json` despite agents writing `e2e/*.spec.ts` files. **This is a Mode B blind spot** — the tester agent emits Playwright tests but doesn't verify the runtime is installed. feat-025 must close both gaps: install-discipline AND execution.

## Goals

1. Detect behavioural integration gaps automatically (e.g. kanban-09's CardDetailModal-click-does-nothing, kanban-10's BoardColumns-orphan-blocks-board-render)
2. Make every Mode B run self-validating: spec failures → auto-bug-plans → builder retry → re-verify
3. Persist synthesized specs as a regression suite for the project (committed by feat-022 to `apps/web/e2e/synthesized/`)
4. **NEW**: enforce Playwright install-discipline at builder/tester time so the orchestrator doesn't have to ad-hoc install
5. Reuse `scripts/visual-review-preflight.mjs`'s dev-server lifecycle (already battle-tested at the design stage)

## Non-goals (deferred)

- Visual screenshot diffing against `docs/screens/` mockups (separate plan; high effort/low marginal catch over flow E2E)
- Cross-browser flow execution (chromium-only for v1)
- Per-test parallelism tuning (default Playwright workers)
- Mobile flow specs (same pattern but separate stack-skill update; v2)
- Dev-server warm-pool sharing across feature runs

## Approach

4 phases: install-discipline first (so projects HAVE Playwright), then runner script, then orchestrator integration, then bug-plan auto-author + retry routing.

### Phase 1 — Playwright install-discipline (~50 LOC docs + agent prompts)

Gap discovered on -10: `@playwright/test` not installed; no `playwright.config.ts`; no `test:e2e` script. Tester wrote `*.spec.ts` files anyway → unrunnable.

Updates:

- **`.claude/skills/agents/front-end/react-next/SKILL.md`** §Testing — extend the existing Playwright section with a §Self-verify install check: confirm `@playwright/test` is in devDependencies, `playwright.config.ts` exists at `apps/web/playwright.config.ts`, `test:e2e` script in `apps/web/package.json`. Author the config from the kit's reference (token-aware viewport, baseURL=http://localhost:3000, testDir=e2e).
- **`.claude/skills/agents/front-end/svelte-kit/SKILL.md`** §Testing — same.
- **`.claude/agents/tester.md`** §Self-verify (before signaling completion) — add a discipline rule: "if you author `*.spec.ts` files, you MUST verify the Playwright runtime is installed + configured. If not, install it first via `pnpm -C apps/web add -D @playwright/test` + write a minimal config + add `test:e2e: playwright test` script. Failure to do this produces unrunnable specs that fool downstream verification."
- **`scripts/synthesize-flow-e2e.mjs`** — at the END of generation, sanity-check the project has Playwright. If missing, emit a warning in the output JSON (`{ ok: true, warnings: ["@playwright/test not installed; specs will not run until installed"] }`) so the operator sees it.

Cost: ~50 LOC across 3 markdown files + ~20 LOC in the synthesizer. No new code paths.

### Phase 2 — Spec runner script (~250 LOC)

`scripts/run-synthesized-flows.mjs`:

```
Usage: node scripts/run-synthesized-flows.mjs <projectDir> [--browser=chromium]

Algorithm:
  1. Pre-flight: confirm <projectDir>/apps/web/package.json has @playwright/test + playwright.config.ts.
     If missing, return { ok: false, reason: "playwright-not-installed", remediation: "..." }
  2. Reuse visual-review-preflight.mjs to start the project's dev server (pnpm -C apps/web dev).
     Wait for "Ready" log line + http GET on baseURL returns 200, with a 60s timeout.
  3. Run: cd <projectDir>/apps/web && npx playwright test e2e/synthesized/ --reporter=json --output=docs/build-to-spec/playwright-output/
  4. Parse the JSON reporter output:
     - For each suite (= flow): extract pass/fail
     - For each fail: extract step-name, error, screenshot path, HTML path
  5. Tear down the dev server (kill the spawned process tree)
  6. Emit BuildToSpecVerifyOutput.flows = {
       passed: [flowId], failed: [{flowId, step, error, screenshot, html}], skipped: [...]
     }
```

Uses `child_process.spawn` (not exec) so we can manage the dev-server process tree explicitly. Cross-platform process-tree teardown via `tree-kill` package (already in monorepo deps via Playwright? confirm; otherwise add).

Tests: ~10 unit tests stubbing the spawn/exec + JSON-reporter parser. ~5 integration tests with a tiny fixture project that has a real dev server.

### Phase 3 — Orchestrator integration (~80 LOC)

In `orchestrator/src/build-to-spec-verify.ts`:

- Extend the existing wrapper to ALSO call `scripts/run-synthesized-flows.mjs` after the synthesizer succeeds (only if specs were generated AND Playwright preflight passes).
- Skip flow execution gracefully if Playwright not installed (warn in output, don't fail the verify stage — let Phase 1's install-discipline catch this upstream over time).
- Total verifier output now includes 3 sections: reachability, flow-synthesis, flow-execution.

In `orchestrator/src/feature-graph.ts`:

- No changes needed; the existing post-merge call already invokes the wrapper.

### Phase 4 — Bug-plan auto-author + retry routing (~120 LOC)

Extend `scripts/file-bug-plan.mjs` (shipped in feat-022 for orphan components) with a new template for flow failures:

```
bug-NNN-flow-{n}-{slug}
  ## Description
  Synthesized flow {flow.name} ({flow.id}) failed at step {N}: clicked
  `{selector}` on `[data-screen-id="{entry}"]`, expected to land on
  `[data-screen-id="{exit}"]` within {TRANSITION_TIMEOUT_MS}ms.

  ### Screenshot
  ![failure]({failure_screenshot_path})

  ### Page HTML at failure
  See `docs/build-to-spec/failures/flow-{n}-step-{N}.html`

  ## Likely cause (orphan-correlated, if applicable)
  {ComponentName} ({path}) is exported but never imported in production.
  Owning feature: {feature_id}
  Suggested integration point: {suggestedImporters[0]}

  ## Fix approach
  Wire {ComponentName} into {suggestedImporters[0]}; pass {expected_props}
  from parent state. See screen mockup at docs/screens/webapp/{exit}.html.

  ## Validation
  Re-run /build-to-spec-verify; flow-{n} must pass + reachability for
  {ComponentName} must clear.
```

Routing: when verify fails, orchestrator reads `verify.flows.failed[]` + correlates with `verify.reachability.orphanComponents[]` (matches by featureId from tasks.yaml). Files ONE consolidated bug plan per (flow, owning-feature) tuple. Dispatches `web-frontend-builder` (or stack-appropriate) for retry, max 3, escalation to human at 5 — same retry ladder as tester's `genuineProductBugs[]`.

## Validation criteria

- Re-run kanban-webapp-10 with feat-025 wired:
  - Flow-spec runner detects Playwright missing → emits warning, doesn't fail verify (graceful degradation per Phase 3)
  - feat-025 Phase 1's install-discipline + a re-run of tester would produce a properly-configured project on next run
- Run feat-025 against a project WITH Playwright already installed (e.g. by hand-installing it in -10 as a smoke test):
  - Synthesized specs execute against the running dev server
  - Failed flows produce screenshots + HTML dumps in `docs/build-to-spec/failures/`
  - Bug plans get auto-filed with consolidated orphan + flow context
- 614 + bug-016's tests still pass; +25 new tests across phases 2-4

## Cross-references

- **Parent**: feat-022 (post-Mode-B verifier; v1 spec-generation only)
- **Sibling fix**: bug-017 (cli-runner factoryRoot threading + verify-output surfacing) — must land FIRST so verify outputs are visible at all
- **Reuses**: `scripts/visual-review-preflight.mjs` (dev-server lifecycle)
- **Surfaces gap**: kanban-webapp-10 manual run found tester writes Playwright specs but doesn't install Playwright (Phase 1 closes this)
- **Architectural cousin**: feat-023 brief-coverage-assertion catches PM-stage holes; feat-022+025 catches build-stage integration gaps; together = full pipeline coverage

## Open questions

- Should flow-execution be a HARD gate (verify fails the run) or a SOFT signal (warns + files plans + lets run pass)? Suggest soft for v1, hard once we've tuned for false-positive rate.
- For dev-server flakiness (port conflicts, slow start), what's the right retry policy? Suggest 1 retry on dev-server-start failure, then graceful degrade to "skipped" with a clear message.
- For multi-app projects (mobile + web), does the runner spawn one dev server per app, or only the web? Suggest web-only for v1; mobile flow specs are out of scope.

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->
