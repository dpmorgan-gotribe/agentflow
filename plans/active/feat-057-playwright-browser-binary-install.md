---
id: feat-057-playwright-browser-binary-install
type: feature
status: in-progress
author-agent: human
created: 2026-05-06
updated: 2026-05-06
parent-plan: bug-037-playwright-runtime-not-auto-installed-for-synthesized-e2e
supersedes: null
superseded-by: null
branch: feat/playwright-browser-binary-install
affected-files:
  - .claude/skills/agents/front-end/react-next/SKILL.md
  - .claude/skills/agents/front-end/svelte-kit/SKILL.md
  - scripts/run-synthesized-flows.mjs
  - orchestrator/src/build-to-spec-verify.ts
  - .claude/skills/start-build/SKILL.md
feature-area: orchestrator/verifier + stack-skills
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-057: Ship bug-037 Phase D — Playwright browser binary auto-install + verifier classification

## Why this exists

**Empirical case 2026-05-06 reading-log-01 — bug-fix loop hit infrastructure ceiling:**

After feat-056 Gap A landed (verifier files tool-failures as bugs), we ran /fix-bugs on reading-log-01 to validate the loop e2e. The bug `bug-runtime-tooling-pre-flight` (playwright-runner-failed-to-start) got filed correctly. The web-frontend-builder dispatched and made a REAL fix to `apps/web/playwright.config.ts` (added `projects: [{name:"chromium",...}]` + corrected health URL port). Fix merged to master at commits `dd4570b → 437c1b5 → be309c1`.

**But the bug ultimately marked `failed`.** Why? After the fix landed:

1. Verifier re-ran. Same `playwright-runner-failed-to-start` bug surfaced.
2. Reason: chromium browser binary still not installed at `~/.cache/ms-playwright/`. The `pnpm exec playwright test` command works (config OK now), but `0 tests` because chromium can't launch.
3. Verifier's heuristic ("0 tests in <15s = runner failed to start") fires same as before.
4. Loop dispatched builder again to fix what's already fixed → 2 more attempts (one stall timeout, one cmd.exe ENOENT) → maxAttempts hit → bug failed.

**bug-037 Phase D was deferred to "operator-step docs"** in the prior session — relying on operators to run `pnpm -C apps/web exec playwright install chromium` once per project. The empirical run proves docs-only is insufficient: the bug-fix loop can't recover from missing infrastructure.

## Goal

Close bug-037 fully so:

1. **New projects** scaffolded post-feat-057 ship with Playwright browser binary auto-install via postinstall hook (no operator action required for the common case)
2. **Legacy projects** (no postinstall hook yet) — verifier classifies `playwright-browser-missing` as a distinct reason, routes to operator-action retry-target instead of dispatching futile builder retries
3. **Bug-fix loop never wastes attempts** dispatching a builder to fix something the builder can't fix

## Phases

### Phase A — postinstall hook in stack-skill template (P0, immediate)

**Surface:** `.claude/skills/agents/front-end/react-next/SKILL.md` §3a.0 (where the COPY VERBATIM apps/web/package.json devDeps block lives, added by feat-056 Gap A).

**Change:** add `"postinstall": "playwright install chromium"` to the `scripts` section of the apps/web/package.json template.

Playwright's install command is **idempotent** — if the chromium binary for the requested version is already cached at `~/.cache/ms-playwright/`, the step is a fast no-op (~1s). On fresh installs / new machines, it downloads ~150MB once. Cached at the user level, so subsequent projects on the same machine skip the download entirely.

### Phase B — verifier classifies playwright-browser-missing distinctly (P0)

**Surface:** `scripts/run-synthesized-flows.mjs` (post-flight detection) + `orchestrator/src/build-to-spec-verify.ts` (TOOL_REASON_TO_CAUSE map).

**Change in run-synthesized-flows.mjs:** when the runner produces 0 tests + reporterStderr matches Playwright's missing-binary signature (e.g. `Executable doesn't exist` or `Please run.*playwright install`), return `{ ok: false, reason: "playwright-browser-missing", remediation: "..." }` instead of the generic `playwright-runner-failed-to-start`.

**Change in build-to-spec-verify.ts:** add `"playwright-browser-missing": "runtime-error"` to TOOL_REASON_TO_CAUSE.

### Phase C — operator-action retry-target (P1, may defer)

**Surface:** `scripts/file-bug-plan.mjs` defaultAgentSequence routing.

**Change:** when `primaryCause === "runtime-error"` AND reason is `playwright-browser-missing`, route to `agentSequence: []` with status `needs-operator-review` (per bug-050 Phase B's existing pattern for manifest-author bugs). The bug gets filed for visibility, but the loop doesn't auto-dispatch a futile builder retry.

### Phase D — backport to reading-log-01 (validation)

After Phase A ships, backport the postinstall hook to `projects/reading-log-01/apps/web/package.json` directly. Then re-run `pnpm install` (which triggers the postinstall) → chromium installs → re-run /fix-bugs → expect bug to actually resolve cleanly this time.

### Phase E — svelte-kit equivalent (deferred — 0 empirical recurrences)

Same shape edit to svelte-kit SKILL.md. Defer until first svelte-kit project ships + observes the gap.

## Cross-references

- **Parent bug-037**: this closes its Phase D + adds Phase B+C as architectural improvements
- **feat-056 Gap A**: validated by this run; feat-057 closes the infrastructure layer underneath
- **NEW factory bug to file (out-of-scope here)**: `cmd.exe ENOENT` in `[per-bug-merge-cascade-failed]` for the bug-fix loop. Worth a separate bug entry — file post-feat-057.

## Validation criteria

- [ ] react-next SKILL.md §3a.0 includes `"postinstall": "playwright install chromium"` in the package.json scripts template
- [ ] run-synthesized-flows.mjs distinguishes `playwright-browser-missing` from `playwright-runner-failed-to-start` based on stderr signature
- [ ] build-to-spec-verify.ts TOOL_REASON_TO_CAUSE includes the new reason key
- [ ] reading-log-01 apps/web/package.json gets the postinstall hook backported
- [ ] After backport: `pnpm install` triggers chromium download (~1-150MB depending on cache)
- [ ] Re-run /fix-bugs on reading-log-01 → bug resolves cleanly (no maxAttempts hit)
- [ ] reading-log-pre-bugs refreshed to mirror post-resolution state
- [ ] Tests pass: orchestrator suite still 703/703

## Attempt Log

<!-- to be populated -->
