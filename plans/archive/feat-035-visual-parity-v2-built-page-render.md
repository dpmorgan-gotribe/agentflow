---
id: feat-035-visual-parity-v2-built-page-render
type: feature
status: archived
author-agent: claude-opus-4-7
created: 2026-04-29
updated: 2026-04-29
completed-at: 2026-04-29
parent-plan: feat-028-visual-parity-verifier
supersedes: null
superseded-by: null
branch: feat/visual-parity-v2-built-page-render
affected-files:
  - orchestrator/src/parity-verify.ts
  - orchestrator/package.json (add playwright devDep + parity-verify script)
  - orchestrator/scripts/parity-verify.mjs (new — standalone CLI)
  - .claude/skills/parity-verify/SKILL.md (update §Phase B)
feature-area: orchestration
priority: P1
attempt-count: 0
max-attempts: 5
---

# feat-035 — Ship Phase B of visual-parity-verifier (built-page render via headless Chromium)

## Problem Statement

feat-028 v1 shipped Phase A only. The actual Playwright driver is
stubbed at `orchestrator/src/parity-verify.ts:149-166` — every
parity-verify run emits per-screen warnings:

```
playwright driver pending v2 — DOM-skeleton extracted from mockup;
built-page render deferred
```

→ no built-page comparison, no divergences, no auto-filed bugs from
visual parity. The whole "compare designed mockup vs built app"
contract is non-functional.

Surfaced live during repo-health-dashboard-01's `/build-to-spec-verify`
runs: 11 mockup screens flagged, 0 actually compared.

## Approach (Tier 1 — minimum viable v2, ~120 LOC)

### Phase A — Add Playwright as a proper dependency

```json
// orchestrator/package.json devDependencies
"playwright": "^1.48.0"
```

The current dynamic-import dance is fine for "soft fail when absent",
but for v2 we need it as a hard dep so production runs always have
the headless driver available. Keep the dynamic import for graceful
degradation when chromium isn't downloaded yet (`pnpm playwright
install chromium` is a separate one-time op).

### Phase B — Replace the stub block in `defaultCompareScreen`

Current code (parity-verify.ts:156-165) is `void chromium; ...
return warning`. Replace with:

```ts
let browser, page, builtHtml;
try {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({
    viewport: { width: 1440, height: 900 }, // desktop primary
  });
  const url = resolveBuiltUrl(screen, ctx);
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  builtHtml = await page.content();
} catch (err) {
  warnings.push(
    `screen ${screen.id}: built-page render failed: ${(err as Error).message}`,
  );
  if (browser) await browser.close().catch(() => {});
  return { divergences: [], warnings };
}
await browser.close();

// Real diff: structural DOM-skeleton via existing scripts/diff-kit-skeleton.mjs
const { diffAndClassify } = await import(
  `${factoryRoot}/scripts/diff-kit-skeleton.mjs`
);
const result = diffAndClassify({ screenId: screen.id, mockupHtml, builtHtml });
return {
  divergences: result.divergences ?? [],
  warnings: result.warnings ?? [],
};
```

### Phase C — URL resolution for dynamic routes

`resolveBuiltUrl(screen, ctx)`:

1. If `ctx.screenUrlMap[screen.id]` is set → use it (operator override).
2. Else if `screen.id === "home"` → `${devServerUrl}/`.
3. Else for static routes → `${devServerUrl}/${screen.id}` (e.g.,
   `about` → `/about`).
4. Else for dynamic-route screens with no map entry →
   skip + warning: `screen ${id}: dynamic route requires
ctx.screenUrlMap['${id}'] (e.g., '/report/sample-owner/sample-repo')`.

Default `devServerUrl: "http://localhost:3000"`. Operator-supplied
via `ctx.devServerUrl`.

### Phase D — Standalone CLI entry point

Add `orchestrator/scripts/parity-verify.mjs`:

```js
node scripts/parity-verify.mjs <project-slug> [--url-map <path-to-json>] [--dev-server-url <url>]
```

- Reads project's `docs/screens/webapp/*.html` (Phase A side)
- Connects to dev server (operator must boot separately)
- Runs the v2 Playwright driver against each screen
- Prints divergences as plain-text + structured JSON (`--json`)
- Exit code 0 (clean) / 2 (divergences found)

Operator flow:

```
# Terminal 1: boot the dev server in the project
cd projects/repo-health-dashboard-01
just dev

# Terminal 2: run parity-verify standalone
pnpm --filter orchestrator parity-verify -- repo-health-dashboard-01
```

### Phase E — Skill markdown update

`.claude/skills/parity-verify/SKILL.md` §Phase B section: replace
"v2 deferred" copy with the actual driver design + the operator
two-terminal workflow.

## Rejected Alternatives

- **Multi-viewport (mobile + tablet + desktop)** — Rejected for v2. Per
  feat-028 §Non-goals, multi-viewport ships once desktop catch-rate
  is validated on 3+ projects. Tier 1 is desktop only.
- **Computed-style audit** — Rejected for v2. Per feat-028 §Non-goals,
  the curated computed-style selector list is post-validation work.
  v2 ships structural DOM-skeleton diff only (the dominant
  shell-stripping + missing-primitive patterns from investigate-009).
- **Auto-boot dev server** — Rejected. Adding lifecycle management
  (spawn pnpm dev → wait for ready → kill on exit) introduces
  flake + cross-platform brittleness. Operator-managed dev server
  is simpler + matches their existing workflow.
- **Fixture-driven URL mapping (full feat-029 integration)** —
  Rejected for v2. Add when feat-029 fixtures are present, but for
  v2 the simple `/{id}` fallback + explicit operator override
  covers 80% of cases.
- **Pixel-screenshot diff** — Rejected per feat-028 §Non-goals;
  cutover criteria documented there.

## Expected Outcomes

- [ ] `playwright` installed as orchestrator devDep
- [ ] `defaultCompareScreen` actually launches Chromium + extracts
      builtHtml via `page.content()`
- [ ] `diffAndClassify` from `scripts/diff-kit-skeleton.mjs` is
      invoked with mockup + built HTML pairs
- [ ] Standalone CLI at `orchestrator/scripts/parity-verify.mjs`
- [ ] Run against repo-health-dashboard-01 (with dev server running)
      produces real divergence rows OR `ok: true` when parity holds
- [ ] `parity-verify` SKILL.md updated to document the v2 workflow
- [ ] No regressions in 567/567 existing orchestrator tests

## Validation Criteria

1. **Live smoke**: boot repo-health-dashboard-01 dev server →
   `pnpm --filter orchestrator parity-verify -- repo-health-dashboard-01`
   → output shows real divergences from each comparable screen
   (home, about — static routes) + skip warnings for dynamic routes
   without explicit URL maps.
2. **Existing test suite**: 567/567 orchestrator tests pass; the
   stubbed-driver tests (which assert "v2-deferred warning") get
   updated to assert on the real driver path under fake-Playwright
   stubs (or skipped pending integration coverage).

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->

---

# COMPLETION RECORD (appended at archive time)

completed: 2026-04-29
outcome: success
actual-files-changed:

- orchestrator/src/parity-verify.ts (modified — Phase B Playwright driver)
- orchestrator/scripts/parity-verify.ts (created — standalone CLI)
- orchestrator/package.json (modified — playwright devDep + script entry)
- pnpm-lock.yaml (modified)
  commits:
- hash: (pending squash) feat-035: ship Phase B of visual-parity (built-page render via Playwright)
  attempts: 1
  duration-minutes: 60
  test-results:
  unit: 567/567 passed
  integration: live-validated against repo-health-dashboard-01 — 4 real divergences caught
  lessons:
- "Tier 1 ships in ~150 LOC by leveraging existing diffAndClassify from scripts/diff-kit-skeleton.mjs. The TS wrapper just needs to launch Playwright + capture page.content() + feed both HTMLs in. Don't reinvent extraction."
- "Dynamic-import path for playwright (graceful degradation when absent) is still useful even with playwright as devDep — chromium binary install is a separate operator step."
- "URL resolution for dynamic routes is the friction point. Heuristic (`/{id}` for static, skip-with-warning for dynamic) gets 80%; the remaining 20% needs explicit operator-supplied screenUrlMap."
- "Phase 0 retrofit gap (data-kit-\* on primitives) became visible the moment Phase B ran. Without the retrofit, parity-verify reports 'missing primitives' when they're actually rendered. Spawned bug-029."
- "Standalone CLI (orchestrator/scripts/parity-verify.ts via tsx) gives operators a fast feedback loop without re-running the full orchestrator chain. Pattern worth replicating for other verifier stages."
  recommendation-implemented-by: feat-035 (this plan); deferred items: multi-viewport (per §Non-goals), computed-style audit (per §Non-goals), auto-boot dev-server (per §Rejected Alternatives), fixture-driven URL map (per §Rejected Alternatives — gated on feat-029 fixture system being present)

---
