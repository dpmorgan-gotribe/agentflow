---
id: bug-041-playwright-config-missing-webserver-block
type: bug
status: draft
author-agent: human
created: 2026-05-02
updated: 2026-05-02
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/web-builder-emits-webserver-block
affected-files:
  - .claude/agents/web-frontend-builder.md
  - .claude/skills/agents/front-end/react-next/SKILL.md
  - .claude/skills/agents/front-end/svelte-kit/SKILL.md
  - scripts/synthesize-flow-e2e.mjs
feature-area: web-frontend-builder/scaffold-compliance
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "projects/finance-track-01/apps/web/playwright.config.ts has 0 webServer blocks; playwright never auto-boots the dev server during E2E runs"
reproduction-steps: "Run /start-build on a project with web_framework=react-next + a backend tier. Inspect apps/web/playwright.config.ts after the spa-shell-dashboard feature merges — webServer block is missing despite SKILL.md §3a documenting it as required."
stack-trace: null
---

# bug-041: web-frontend-builder emits playwright.config.ts WITHOUT the mandatory `webServer` block

## Bug Description

`.claude/skills/agents/front-end/react-next/SKILL.md §3a` (lines 387-419) documents the required `playwright.config.ts` template, including a mandatory `webServer` block:

```ts
webServer: {
  // Per investigate-012 F2 / feat-040 — webServer.command depends on persistence_layer:
  //   - localStorage (Strategy A)      → "pnpm exec next dev"
  //   - external-api-only (Strategy D) → "node ../../scripts/dev.mjs"
  //   - real-db (Strategy C)           → "node ../../scripts/dev.mjs"
  command: "node ../../scripts/dev.mjs",
  url: "http://localhost:3000",
  reuseExistingServer: !process.env.CI,
  timeout: 180_000,
  ...
},
```

Empirically, finance-track-01 has `web_framework: react-next` + `persistence_layer: real-db` (Strategy C). Its `apps/web/playwright.config.ts` was emitted by `feat-spa-shell-dashboard`'s web-frontend-builder. Inspection:

```bash
$ grep -c "webServer" projects/finance-track-01/apps/web/playwright.config.ts
0
```

The webServer block is COMPLETELY ABSENT. Without it, when playwright runs (e.g. via `pnpm exec playwright test` OR via the verifier's spec-execution stage), it doesn't boot any dev server. Tests that depend on a running app fail with "Cannot connect to localhost:3000" (frontend down) and seed setup hits 404 on `/test/seed` (backend down).

This is the SECOND link in the 5-step seeding-pipeline failure chain that left ALL 9 finance-track-01 synthesized E2E flows landing on empty UI states.

## Reproduction Steps

1. Run `/start-build` on a project with `web_framework: react-next` (or `svelte-kit`) + a backend tier.
2. After the spa-shell-dashboard feature merges (or whichever feature owns playwright.config.ts), inspect:
   ```bash
   grep -A 8 "webServer" projects/<name>/apps/web/playwright.config.ts
   ```
3. Empirically: 0 occurrences of `webServer`.
4. Run `pnpm -C apps/web exec playwright test e2e/synthesized` from project root.
5. Tests fail with timeouts / connection refused — playwright never spawned the dev server.

Working comparison: `projects/repo-health-dashboard-01/apps/web/playwright.config.ts` line 23 has the webServer block. Earlier project's web-frontend-builder DID emit it.

## Error Output

From the verifier rerun (`tasks/b6zuh43xr.output`):

```
Build-to-spec verify:
  flows: 0 passed, 9 failed (after bug-039 fix)
```

Each failure's `error-context.md` shows the test landing on empty state — the frontend was up (verifier's auto-boot started the frontend) but had no backend → no data → empty.

## Root Cause Analysis

### Why web-frontend-builder skipped the webServer block

The web-frontend-builder agent's dispatch context includes `react-next/SKILL.md` as the canonical work guide. The §3a section explicitly documents the webServer requirement. Possible reasons the builder didn't emit it:

1. **Agent compliance gap** — builder read §3a, decided webServer was optional ("for E2E runs only" interpretation), or got confused by the conditional persistence-layer logic.
2. **The template snippet isn't EXTRACTED clearly enough** — §3a presents the config as one block of code wrapped in heavy contextual prose. Builder may have copied only PARTS of it (e.g. `defineConfig({ testDir: ..., projects: [...] })` but skipped the webServer.
3. **The persistence-layer conditional logic is too complex** — the builder needs to read `architecture.yaml.tooling.stack.persistence_layer` first, then pick the right webServer.command. The if-then logic may have failed silently when the field was absent or unexpected.

Most likely #2 — the SKILL.md mixes documentation prose with code template; without a clear "EXACTLY THIS, COPY-PASTE" demarcation, the builder gets creative.

### Why the synthesizer didn't catch it

`scripts/synthesize-flow-e2e.mjs` post-flight checks (lines 754+) verify:

- `apps/web/package.json` has `@playwright/test` (bug-037 Phase A now auto-fixes)
- `apps/web/playwright.config.ts` exists (warns if missing)

But it does NOT verify the playwright.config has a webServer block. So even after bug-037 ships its fixes, this gap silently persists.

## Fix Approach

### Phase A — synthesizer auto-validates webServer presence (P0, immediate)

1. **Extend `scripts/synthesize-flow-e2e.mjs`** post-flight check (line 786 area where `hasPlaywrightConfig` is checked):
   - Read `apps/web/playwright.config.ts` content
   - Verify `webServer:` substring is present
   - If missing, surface a HARD error (not warning) — synthesizer return JSON includes `errors[]`
   - Suggest the fix: copy from react-next/svelte-kit SKILL.md §3a webServer template

### Phase B — SKILL.md template restructure (P1)

2. **Restructure react-next/SKILL.md §3a** — move the webServer block into a CLEAR top-level "Required playwright.config.ts template" subsection with a "COPY THIS VERBATIM" header. Remove ambiguity about whether it's optional or conditional.

3. **Make persistence-layer logic explicit** — add a decision-table at the top of §3a:

   | persistence_layer   | webServer.command                                        |
   | ------------------- | -------------------------------------------------------- |
   | `localStorage`      | `pnpm exec next dev`                                     |
   | `external-api-only` | `node ../../scripts/dev.mjs`                             |
   | `real-db`           | `node ../../scripts/dev.mjs`                             |
   | (absent/unknown)    | `node ../../scripts/dev.mjs` (safe default per feat-040) |

4. **Same restructure** for svelte-kit SKILL.md.

### Phase C — web-frontend-builder agent enforcement (P1)

5. **Add a SELF-VERIFY check** to the web-frontend-builder's post-write step: when it writes `apps/web/playwright.config.ts`, immediately read it back + assert the `webServer:` block is present. If absent, edit to add it (auto-fix).

### Phase D — orchestrator post-feature verifier (P2, defense-in-depth)

6. **Add a check in the orchestrator's post-feature-merge stage**: when a feature merges that includes `apps/web/playwright.config.ts`, validate the webServer block is present. Fail the merge if missing (catches it before downstream verification work depends on it).

### Phase E — empirical re-validation

7. After Phases A+B+C ship, dispatch `/start-build` on a fresh test project; confirm `apps/web/playwright.config.ts` has the webServer block automatically.

## Rejected Fixes

- **Make the synthesizer auto-edit playwright.config.ts to add webServer** — Rejected. The webServer block depends on persistence_layer which the synthesizer doesn't currently consult for that purpose. Cleaner to fail loudly + let the builder retry.
- **Move webServer wiring out of stack-skill into orchestrator** — Rejected. Stack-skill ownership is correct; the issue is enforcement, not ownership.
- **Document better, hope agent follows** — Rejected. Same anti-pattern as bug-040; documentation already exists. Need automated enforcement.

## Validation Criteria

### Phase A

- [ ] Synthesizer's post-flight check reads playwright.config.ts content + asserts `webServer:` present.
- [ ] Returns hard error (in `errors[]` not `warnings[]`) when missing.
- [ ] Regression test in synthesizer test suite covers the missing-webServer scenario.

### Phase B

- [ ] react-next + svelte-kit SKILL.md §3a restructured with clear "COPY VERBATIM" demarcation + decision table.
- [ ] Builder dispatch reads SKILL.md → produces playwright.config.ts WITH webServer 100% of the time on fresh project tests.

### Phase C

- [ ] web-frontend-builder agent self-verify catches the gap + auto-fixes if it slips through.

### Phase D

- [ ] Orchestrator's post-feature-merge check fails feature merge if webServer missing.

### Phase E

- [ ] Fresh-project test: spa-shell-dashboard's web-frontend-builder produces playwright.config.ts WITH webServer block on first attempt; verifier's flow-execution actually runs.

## Cross-references

- **Empirical case**: 2026-05-02 finance-track-01 — second link in 5-step seeding-pipeline failure chain. Even with bug-037 fix (playwright runtime installed), tests don't run because no dev server boots.
- **Sister bugs**: bug-040 (architect skips scripts/dev.mjs), bug-042 (global-setup baseline incomplete) — together with bug-041 they comprise the full broken-seeding story.
- **Predecessor specs**: feat-040 (live-backend-playwright-webServer) shipped the SKILL.md guidance; this bug is the enforcement gap.

## Attempt Log

<!-- populated as fix attempts are made -->
