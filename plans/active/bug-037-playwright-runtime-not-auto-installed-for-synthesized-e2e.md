---
id: bug-037-playwright-runtime-not-auto-installed-for-synthesized-e2e
type: bug
status: in-progress
author-agent: human
created: 2026-05-02
updated: 2026-05-06
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/auto-install-playwright-with-synthesized-e2e
affected-files:
  - .claude/skills/agents/front-end/react-next/SKILL.md
  - .claude/skills/agents/front-end/svelte-kit/SKILL.md
  - .claude/skills/tester/SKILL.md
  - .claude/templates/playwright-global-setup.ts.template
  - scripts/run-synthesized-flows.mjs
  - scripts/synthesize-flow-e2e.mjs
  - orchestrator/src/build-to-spec-verify.ts
feature-area: stack-skills/web/scaffolding + tester + verifier
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "flow-execution: playwright reporter stdout empty; stderr=Error: Cannot find module '@playwright/test'"
reproduction-steps: "Run /start-build on any project with web frontend. After Mode B + verify, the build-to-spec-verify flow-execution stage fails because apps/web doesn't have @playwright/test in devDependencies — even though the synthesizer authored apps/web/e2e/synthesized/flow-N.spec.ts files."
stack-trace: null
---

# bug-037: @playwright/test runtime not auto-installed despite synthesized E2E specs being authored

## Bug Description

The orchestrator's pipeline authors `apps/web/e2e/synthesized/flow-N.spec.ts` files via `scripts/synthesize-flow-e2e.mjs` (post-architect, pre-build) AND `apps/web/playwright.config.ts` is scaffolded by the react-next stack skill — but `@playwright/test` is **not** added to `apps/web/package.json devDependencies` automatically. When the post-build `/build-to-spec-verify` flow-execution stage tries to run the synthesized specs, it fails with:

```
flow-execution: playwright reporter stdout empty;
  stderr=Error: Cannot find module '@playwright/test'
```

The verifier degrades gracefully (warning, not failure) so the build still completes, but the synthesized E2E specs are **never actually executed** — they sit unrun in the worktree, silently masking any product bugs they would have caught.

The react-next stack skill's §3 explicitly documents this gap (line 380):

> "Authoring `*.spec.ts` files without the runtime installed produces **unrunnable specs that silently fool downstream verification**"

> "Discovery: kanban-webapp-10 shipped with 5+ e2e/\*.spec.ts files but no `@playwright/test` in devDependencies — the project literally couldn't run any of them."

The same pattern recurred on finance-track-01 (2026-05-02). Documentation isn't enforcement; the dep needs to be auto-installed.

## Reproduction Steps

1. `/start-build` any project with `web_framework: react-next` (or `svelte-kit`).
2. After Mode B + post-build verify completes, inspect:
   - `projects/<name>/apps/web/e2e/synthesized/` — synthesized flow specs exist (`flow-1.spec.ts` through `flow-N.spec.ts`).
   - `projects/<name>/apps/web/playwright.config.ts` — scaffolded by react-next SKILL.md.
   - `projects/<name>/apps/web/package.json` — `@playwright/test` is **NOT** in `devDependencies`.
3. Run `pnpm -C apps/web exec playwright test e2e/synthesized` from the project root.
4. Observe: `Error: Cannot find module '@playwright/test'`.
5. Verifier output shows: `flow-execution: playwright reporter stdout empty; stderr=Error: Cannot find module '@playwright/test'` (warning, not failure).

Empirical case (2026-05-02 finance-track-01): full Mode B run completed 17/17 features + 7/7 fix-bug-loop fixes, but flow-execution surfaced this exact error in the verifier output. None of the 9 synthesized flow specs ever ran.

## Error Output

From `tasks/bdr9m4527.output` (orchestrator's final state print):

```
Build-to-spec verify:
  reachability:    7 orphan component(s), 0 orphan route(s)
  flows:           0 passed, 0 failed
  bug plans filed: bug-003-orphan-accountarchivedialog, ... (7 entries)
  warnings:
    - flow-execution: playwright reporter stdout empty; stderr=Error: Cannot find module '@playwright/test'
Require stack:
- C:\...\projects\finance-track-01\apps\web\playwright.config.ts
- ...
```

The "flows: 0 passed, 0 failed" is the load-bearing tell — the verifier didn't run ANY flows. Combined with "warnings: flow-execution ... Cannot find module '@playwright/test'", the diagnosis is unambiguous.

## Root Cause Analysis

Three intervention surfaces, each at a different stage of the pipeline:

### Surface A — react-next/svelte-kit stack skill scaffold

The SKILL.md's §3 documents the requirement but doesn't enforce it. The scaffold step (which writes `apps/web/package.json`, `playwright.config.ts`, `vitest.config.ts`, etc) should:

- Include `"@playwright/test": "^1.48.0"` in the scaffolded `apps/web/package.json` devDependencies
- Trigger a `pnpm install` after package.json is written so `node_modules/@playwright/test` is materialized
- Optionally also run `pnpm -C apps/web exec playwright install chromium` (heavier — downloads ~150MB browser binary)

Today the SKILL.md leaves this to "the tester" but the tester runs much later AND treats it as advisory, not load-bearing.

### Surface B — synthesizer pre-flight check

`scripts/synthesize-flow-e2e.mjs` already emits warnings when the runtime is missing (per the synthesizer's existing warnings array; we saw `"@playwright/test not installed; specs will not run until installed"` earlier in this session at finance-track-pre-build synthesis time). But it's a soft warning, not a hard failure or auto-install.

The synthesizer could:

- Detect missing `@playwright/test` in `apps/web/package.json`
- AUTO-EDIT package.json to add it (cheap)
- Surface the change in its return-JSON warnings + suggest `pnpm install` follow-up

### Surface C — verifier-tier hard failure

`orchestrator/src/build-to-spec-verify.ts`'s flow-execution stage emits a WARNING when synthesized specs can't run. Should be a HARD ERROR if there are spec files in `apps/web/e2e/synthesized/` but no runtime — the failure condition is unambiguous (specs exist + can't be executed = pipeline lied about coverage).

The current behavior of "graceful degradation" hides a class of real bugs. Better to fail loudly with an actionable error than to ship a project whose E2E coverage is silently zero.

### Why Surface A is the right primary fix

- Scaffold-time installation is the simplest possible fix (one line in package.json template).
- Catches the bug at the EARLIEST possible point (Mode A → packed in apps/web before Mode B even starts).
- No verifier refactor needed; downstream stages just work.
- Aligns with the "scaffold the dev tools you'll need" pattern already used for vitest, tailwind, postcss, etc.

Surfaces B + C are defense-in-depth — if Surface A fails or someone manually deletes the dep, the synthesizer catches it again, and if the synthesizer ALSO fails, the verifier hard-errors.

## Fix Approach

### Phase A — scaffold-time install (P0, immediate)

1. **Update `.claude/skills/agents/front-end/react-next/SKILL.md` §1 Canonical layout / §3 Testing**:
   - Add `"@playwright/test": "^1.48.0"` to the `apps/web/package.json devDependencies` template snippet.
   - Note that `pnpm install` after scaffold materializes the dep into node_modules.
   - Note that `pnpm -C apps/web exec playwright install chromium` is REQUIRED before specs can run; recommend running it as a post-install hook OR documenting it as a separate operator step.

2. **Update `.claude/skills/agents/front-end/svelte-kit/SKILL.md`** equivalently.

3. **Verify the architect's scaffolding step picks up the change** — when /architect runs the stack-skill scaffold, the new package.json template should land with @playwright/test included.

4. **Empirical validation**: re-run a small project's Mode A → Mode B → verify; confirm `apps/web/package.json` ships with @playwright/test + the verifier's flow-execution stage runs the synthesized specs (passes or fails on real assertions, not on missing module).

### Phase B — synthesizer auto-fix-up (P1)

5. **Extend `scripts/synthesize-flow-e2e.mjs`**: when authoring synthesized specs, if `apps/web/package.json` is missing `@playwright/test`, AUTO-EDIT to add it + emit a "package.json updated" warning. The operator runs `pnpm install` to materialize, OR the orchestrator can wire it up via the existing `installIfPackageJsonChanged` hook (feat-019 Phase B).

### Phase C — verifier hard failure (P2)

6. **Extend `orchestrator/src/build-to-spec-verify.ts` flow-execution stage**: when `apps/web/e2e/synthesized/flow-N.spec.ts` files exist AND the runtime is missing, return a HARD failure (not a warning). This forces the operator to install before the run is considered complete.

### Phase D — playwright browser install (P2)

7. The `playwright install chromium` step downloads ~150MB. Options:
   - Run as a post-install hook in apps/web/package.json (cost: every install hits ~150MB once)
   - Run lazily before first spec dispatch (cost: first build is slower)
   - Document as an operator step (cost: easy to forget)
     Phase D picks one; Phase A unblocks #1 + #2 above; Phase D refines the runner story.

## Rejected Fixes

- **"Tester should install it"** — Rejected: tester runs much LATER in the pipeline (per-feature, not per-project). By the time tester sees the gap, multiple builders have already run + the synthesizer has produced specs assuming the runtime exists. Earliest-fix wins.
- **"Add as a workspace-root devDep"** — Rejected: pnpm workspace hoisting is project-specific; some projects use isolated package.json per app. Adding to apps/web/package.json directly is the canonical pattern.
- **"Just document it more loudly"** — Rejected: the SKILL.md ALREADY documents it (line 380 mentions kanban-webapp-10 hit this). Documentation is not enforcement.
- **"Make verifier the only enforcement point"** — Rejected: verifier runs LAST. By then the build is "complete" + the operator has spent budget building specs that can't run. Catching at scaffold-time saves cost + cycle time.

## Validation Criteria

### Phase A

- [ ] react-next SKILL.md §1/§3 includes `@playwright/test` in `apps/web/package.json` devDependencies template.
- [ ] svelte-kit SKILL.md equivalent.
- [ ] Re-run a small project's Mode A → Mode B → verify; confirm apps/web/package.json ships with @playwright/test.
- [ ] Verifier flow-execution stage runs synthesized specs (passes/fails on real assertions, not on missing module).

### Phase B

- [ ] Synthesizer auto-edits apps/web/package.json when @playwright/test missing.
- [ ] Emits "package.json updated" warning in return JSON.

### Phase C

- [ ] Verifier flow-execution returns hard failure (not warning) when specs exist + runtime missing.

### Phase D

- [ ] Browser binary install strategy decided + documented (post-install hook OR lazy OR operator step).

## Cross-references

- **Empirical case 1**: kanban-webapp-10 (per react-next SKILL.md §3 line 380 — "shipped with 5+ e2e/\*.spec.ts files but no @playwright/test in devDependencies").
- **Empirical case 2**: finance-track-01 (2026-05-02 — full Mode B run, 17/17 features merged, but `flows: 0 passed, 0 failed` because no runtime).
- **Sister bug**: bug-038 (parity-verify backend port detection assumes :8000) — both surfaced from the same finance-track-01 verify-stage warnings.

## Attempt Log

### Attempt 1 — 2026-05-06 — Phase A landed (react-next SKILL.md)

After 3rd recurrence on reading-log-01 feat-books-core (web-frontend-builder authored apps/web/e2e/books.spec.ts but didn't add @playwright/test devDep + didn't add vitest exclude → vitest parse-error → tester reported policyCheck unmeasurable → orchestrator retry-exhausted → cascade-aborted feat-search-filter), shipped Phase A's react-next surface:

**Patch**: `.claude/skills/agents/front-end/react-next/SKILL.md` §3a — added new §3a.0 "Required scaffold deps + configs — COPY VERBATIM" block above §3a.1, with:

1. **`apps/web/package.json` devDependencies verbatim block** — explicit JSON snippet listing all required devDeps including `@playwright/test: ^1.49.0`. Previously the SKILL listed @playwright/test as "required" in narrative form (line 386); now it's a copy-verbatim template.
2. **`apps/web/vitest.config.ts` verbatim template** — explicit `exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"]` line. Previously the SCAFFOLD-OWNED comment header at line 364 mentioned the exclude in passing but didn't show the full config. Now it's verbatim copy-paste.
3. **3-step self-verify** after scaffold: grep package.json for @playwright/test; grep vitest.config.ts for `**/e2e/**`; run `pnpm --filter @repo/web test` to confirm no parse-error.
4. **Empirical motivation block** documenting all 3 recurrences (kanban-webapp-10, finance-track-01, reading-log-01) for the next agent's context.
5. **Required artifacts list extended** (line 384-388) — added 4th entry: vitest.config.ts must exclude e2e/.

Phase A is the structural fix at the earliest pipeline surface. Phase B (synthesizer auto-fix-up) + Phase C (verifier hard-fail) remain as defense-in-depth — drafted in original plan, deferred until Phase A's empirical effectiveness is observed on the next project build.

**Next validation**: re-run `/start-build` on a fresh project (or `/new-project foo --proposal "..."` then full pipeline) and confirm:
- `apps/web/package.json` ships with `@playwright/test` in devDeps
- `apps/web/vitest.config.ts` ships with `**/e2e/**` excluded
- post-build flow-execution stage runs synthesized specs (not "Cannot find module")

**Empirical effectiveness observation deferred** — no fresh-project run scheduled in this session; will validate on next project bootstrap.

**Skipped from plan**: svelte-kit SKILL.md equivalent edit. Justification: 0/3 empirical recurrences are on svelte-kit projects (all 3 are react-next). Patch when first svelte-kit project is built; don't do speculative factory work.
