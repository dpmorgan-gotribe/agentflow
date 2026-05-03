---
id: bug-048-audit-reachability-js-extension-not-resolved
type: bug
status: draft
author-agent: claude-opus-4-7
created: 2026-05-03
updated: 2026-05-03
parent-plan: bug-030-audit-reachability-false-positive-flood
supersedes: null
superseded-by: null
branch: fix/audit-reachability-js-extension-resolution
affected-files:
  - scripts/audit-app-reachability.mjs
  - orchestrator/tests/audit-app-reachability.test.ts
  - orchestrator/tests/fixtures/audit-app-reachability/js-ext-resolution/**
feature-area: orchestration
priority: P1
attempt-count: 0
max-attempts: 5
error-message: '5 false-positive orphan-component reports filed against finance-track-01 by /build-to-spec-verify on 2026-05-03 — every flagged file is in fact imported, but via TS-as-ESM `.js` import suffixes (`from "../common/errors.js"`) which the analyzer''s `resolveCandidate()` cannot resolve back to source `.ts`.'
reproduction-steps: 'Run `node scripts/audit-app-reachability.mjs projects/finance-track-01` against any project whose backend tier uses TypeScript with `"module": "esnext"` (TS-as-ESM convention).'
stack-trace: null
---

# bug-048 — `audit-app-reachability` false positives on TS-as-ESM `.js` import suffixes

## Bug Description

Running `/build-to-spec-verify` against `finance-track-01` on 2026-05-03 (post bug-046+047 hardening) flagged 5 orphan components. 4 of the 5 are demonstrably consumed in production code:

| Flagged orphan                                             | Actual consumer                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/common/errors.ts` (`AppError`)               | `apps/api/src/plugins/error-handler.ts:3` (`import { AppError } from "../common/errors.js";`) + 7 more files |
| `apps/api/src/plugins/env.ts` (`AppConfig`, `EnvSchema`)   | `apps/api/src/app.ts` (`import { ... } from "./plugins/env.js";`)                                            |
| `apps/api/src/routes/reports/reports.service.ts`           | `apps/api/src/routes/reports/reports.routes.ts`                                                              |
| `apps/api/src/routes/transactions/transactions.service.ts` | `apps/api/src/routes/transactions/transactions.routes.ts`                                                    |

(The 5th, `apps/web/playwright/global-setup.ts`, is a different class — covered by sister plan bug-049.)

If `/fix-bugs` had been auto-dispatched against this output, the web-frontend-builder would have been called against 4 phantom bugs at ~$0.10–$0.50/dispatch × 4 × up to 3 retries = ~$5 wasted on no-op fixes, plus risk of accidentally deleting working code as "unused".

**Expected:** the analyzer resolves `from "./foo.js"` back to `./foo.ts` (the source file) when the `.js` doesn't physically exist. This is the canonical TS-as-ESM pattern: `tsc` emits `.js` from `.ts` sources, and the import specifier MUST carry the runtime extension.

**Actual:** `resolveCandidate()` only ever APPENDS extensions — `errors.js` becomes `errors.js.tsx`, `errors.js.ts`, `errors.js.jsx`, `errors.js.js` (none exist) — falls through to the literal-file check which also fails because the source is `.ts` not `.js`. The import edge is silently dropped.

## Reproduction Steps

1. Project must use TypeScript with `"module": "esnext"` (or `"nodenext"`/`"node16"`) and import siblings via `.js` suffixes — the standard TS-as-ESM emit pattern. Confirmed in `finance-track-01` `apps/api/src/**/*.ts`.
2. From factory root: `node scripts/audit-app-reachability.mjs projects/finance-track-01`
3. Observe `orphanComponents[]` includes files like `apps/api/src/common/errors.ts` that are demonstrably imported (verifiable via `grep -r "from.*common/errors" apps/api/`).

## Root Cause Analysis

`scripts/audit-app-reachability.mjs:288 resolveCandidate()` does NOT handle the `.js → .ts` extension swap. Code as of 2026-05-03 (commit `bf07ebe`):

```js
function resolveCandidate(candidate) {
  // Try exact + index variants in source extension preference order
  const tryExt = [".tsx", ".ts", ".jsx", ".js"];
  for (const ext of tryExt) {
    if (
      fs.existsSync(candidate + ext) &&
      fs.statSync(candidate + ext).isFile()
    ) {
      return candidate + ext;
    }
  }
  if (fs.existsSync(candidate)) { ... }
  return null;
}
```

For `import { AppError } from "../common/errors.js"`:

1. `baseDir = .../plugins/`, `candidate = path.resolve(baseDir, "../common/errors.js") = .../common/errors.js`.
2. Loop tries `errors.js.tsx`, `errors.js.ts`, `errors.js.jsx`, `errors.js.js` — none exist.
3. `fs.existsSync(.../common/errors.js)` — false (the source is `errors.ts`).
4. Returns null. Edge is silently dropped.

## Approach

### Phase A — narrow fix (immediate)

Extend `resolveCandidate()` to ALSO try replacing `.js` / `.jsx` / `.mjs` / `.cjs` suffix with `.ts` / `.tsx` when the literal candidate doesn't exist. Inserted between the existing append-extension loop and the literal-file check so behavior is purely additive (cannot regress prior cases):

```js
function resolveCandidate(candidate) {
  const tryExt = [".tsx", ".ts", ".jsx", ".js"];
  for (const ext of tryExt) {
    if (fs.existsSync(candidate + ext) && fs.statSync(candidate + ext).isFile()) {
      return candidate + ext;
    }
  }
  // bug-048: TS-as-ESM convention writes import specifiers with the RUNTIME
  // extension (`.js`/`.mjs`/`.cjs`) but the source file is `.ts`/`.tsx`. Try
  // the suffix swap when the literal `.js`-suffixed candidate doesn't exist.
  const swapMatch = candidate.match(/\.(?:js|jsx|mjs|cjs)$/);
  if (swapMatch) {
    const stripped = candidate.slice(0, -swapMatch[0].length);
    for (const tsExt of [".ts", ".tsx"]) {
      if (fs.existsSync(stripped + tsExt) && fs.statSync(stripped + tsExt).isFile()) {
        return stripped + tsExt;
      }
    }
  }
  if (fs.existsSync(candidate)) { ... }
  return null;
}
```

**Why narrow over feat-037 TS-aware rewrite:** feat-037 is the principled long-term cure (drop the regex heuristic for a real TypeScript-aware analyzer) but is P2 / multi-day. This Phase-A fix is one regex + one block, < 10 lines. Same intervention shape as bug-030 Phase A.

### Phase B — regression tests

New file `orchestrator/tests/audit-app-reachability.test.ts` mirrors the synthesizer test pattern:

- Fixture `orchestrator/tests/fixtures/audit-app-reachability/js-ext-resolution/`:
  - `apps/api/src/app.ts` imports `from "./plugins/env.js"`
  - `apps/api/src/plugins/env.ts` exports a runtime const + types
  - Expected output: `orphanComponents` does NOT include `apps/api/src/plugins/env.ts`
- Fixture `orchestrator/tests/fixtures/audit-app-reachability/baseline-orphan/`:
  - `apps/api/src/plugins/env.ts` exists with exports but NO file imports it
  - Expected output: `orphanComponents` DOES include `apps/api/src/plugins/env.ts` (the analyzer still detects real orphans)

### Phase C — empirical re-validation

Re-run `node scripts/audit-app-reachability.mjs projects/finance-track-01`. Expected: 4 of the 5 prior orphans drop out. The 5th (`global-setup.ts`) remains until bug-049 lands.

## Success Criteria

- [ ] Phase A: `resolveCandidate()` resolves `errors.js` → `errors.ts` when the literal `.js` doesn't exist
- [ ] Phase B: 2 fixture-driven tests pass (positive + negative case)
- [ ] Phase C: re-running `audit-app-reachability.mjs` against finance-track-01 reports 4 fewer orphans (the `.js`-suffix class)
- [ ] No regression in existing orchestrator tests (629/629 still passing post-fix)

## Cross-references

- Parent: `plans/archive/bug-030-audit-reachability-false-positive-flood.md` — the same false-positive-flood class fixed via narrow Phase A; same intervention shape
- Sister: `plans/active/bug-049-audit-reachability-config-string-references.md` — covers the global-setup.ts case (config-string property references)
- Long-term: `plans/active/feat-037-audit-reachability-ts-aware-rewrite.md` — TS-aware analyzer rewrite that obviates this whole class
- Lineage: `plans/archive/bug-028-audit-reachability-misses-router-push.md` — analyzer SCAN_ROOTS expansion; the original Phase-A surface
