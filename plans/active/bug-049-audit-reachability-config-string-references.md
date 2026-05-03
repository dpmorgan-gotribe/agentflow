---
id: bug-049-audit-reachability-config-string-references
type: bug
status: draft
author-agent: claude-opus-4-7
created: 2026-05-03
updated: 2026-05-03
parent-plan: bug-030-audit-reachability-false-positive-flood
supersedes: null
superseded-by: null
branch: fix/audit-reachability-config-string-refs
affected-files:
  - scripts/audit-app-reachability.mjs
  - orchestrator/tests/audit-app-reachability.test.ts
  - orchestrator/tests/fixtures/audit-app-reachability/config-string-ref/**
feature-area: orchestration
priority: P2
attempt-count: 0
max-attempts: 5
error-message: '1 false-positive orphan-component report against `apps/web/playwright/global-setup.ts` in finance-track-01 on 2026-05-03 — referenced by `playwright.config.ts:20` as `globalSetup: "./playwright/global-setup.ts"` (a config-string property), not via an `import` statement, so the analyzer''s IMPORT_RE never sees the edge.'
reproduction-steps: "Run `node scripts/audit-app-reachability.mjs projects/finance-track-01` against any project whose Playwright config uses `globalSetup` / `globalTeardown` to point at a relative file."
stack-trace: null
---

# bug-049 — `audit-app-reachability` misses config-file string-property references

## Bug Description

Sister to bug-048. The 5th orphan flagged on `finance-track-01` (2026-05-03) is `apps/web/playwright/global-setup.ts`, exported `default` but with no `import` edge from any production file.

It IS reached at runtime — `apps/web/playwright.config.ts:20` carries:

```ts
export default defineConfig({
  globalSetup: "./playwright/global-setup.ts",
  ...
});
```

Playwright's runtime treats this string as a path-spec and `require()`s the file on test startup. But the analyzer's `IMPORT_RE` only matches three syntactic shapes:

- `import ... from "..."`
- `import("...")` (dynamic)
- `export ... from "..."` (re-export)

A bare `key: "./..."` property value is invisible. Same class will surface for any framework that takes file paths as config-string properties (Playwright `globalTeardown`, Next.js' `serverComponents.experimental.serverActions.allowedOrigins`, etc.).

**Expected:** when a project's config file references another workspace file via a string literal that resolves to a real source file, the analyzer counts that as an importer edge.

**Actual:** silently dropped — file flagged as orphan.

## Reproduction Steps

1. Project must have a config-style file (basename matches `*.config.*` or known runner configs) that points at a sibling file via a relative string-literal property.
2. From factory root: `node scripts/audit-app-reachability.mjs projects/finance-track-01`
3. Observe `orphanComponents[]` includes `apps/web/playwright/global-setup.ts` with reason "exported (default) but no production importer found".

## Root Cause Analysis

`scripts/audit-app-reachability.mjs:317` defines a single `IMPORT_RE` that captures three explicit forms:

```js
const IMPORT_RE =
  /(?:^|\n)\s*(?:import\s+(?:[^'"]*?from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|export\s+(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+['"]([^'"]+)['"])/g;
```

The single-file scan loop (line 335) iterates each file's text and runs ONLY this regex. Config-string property values are never scanned, so any framework-config-driven file reference is invisible.

This gap is structurally smaller than bug-048's. The TS-as-ESM `.js` suffix issue affects EVERY file in the api tier of every TS-as-ESM project (4-of-5 orphans here). Config-string-only is a single-file class — limited mostly to Playwright globalSetup/globalTeardown, hence P2.

## Approach

### Phase A — narrow regex extension

Add a complementary regex that captures any string-literal whose body looks like a relative file path ending in a source extension:

```js
// bug-049: relative-path string literals (e.g. Playwright config's
// `globalSetup: "./..."`). Narrow to source-extension-suffixed paths so
// noise is bounded — random doc strings rarely end in `.ts`/`.tsx`.
const CONFIG_STRING_PATH_RE =
  /['"](\.\.?\/[^'"\s]+?\.(?:ts|tsx|js|jsx|mjs|cjs))['"]/g;
```

In the import-scanning loop (line 335), after `IMPORT_RE` runs, also iterate `CONFIG_STRING_PATH_RE` matches and feed each to `resolveImport()`. The downstream `resolveImport` already returns `null` for non-existent paths, so a string-literal that doesn't resolve to a workspace file silently does nothing.

Why apply broadly (not narrowed to config files): orphan detection benefits from over-counting reachability — false positives (real orphans missed) are infinitely better than false negatives (good code flagged). Strings that "look like" file paths in regular source rarely matter; if they DO resolve to a workspace file, it's likely a real reference.

### Phase B — regression test

Add to the same `orchestrator/tests/audit-app-reachability.test.ts` introduced by bug-048:

- Fixture `orchestrator/tests/fixtures/audit-app-reachability/config-string-ref/`:
  - `apps/web/playwright.config.ts` with `globalSetup: "./playwright/global-setup.ts"` property
  - `apps/web/playwright/global-setup.ts` exports `default async () => {}`
  - Expected output: `orphanComponents` does NOT include `apps/web/playwright/global-setup.ts`

### Phase C — empirical re-validation

Re-run `node scripts/audit-app-reachability.mjs projects/finance-track-01` after Phase A+B + bug-048 land. Expected: 0 orphan components (full pre-existing 5 cleared).

## Success Criteria

- [ ] Phase A: `CONFIG_STRING_PATH_RE` added + wired into the import-scanning loop
- [ ] Phase B: fixture-driven test passes (config-string ref correctly resolved as importer edge)
- [ ] Phase C: combined with bug-048, re-running analyzer against finance-track-01 reports `orphanComponents: []`
- [ ] No regression in existing orchestrator tests post-fix

## Cross-references

- Parent: `plans/archive/bug-030-audit-reachability-false-positive-flood.md` — sister Phase-A intervention
- Sister: `plans/active/bug-048-audit-reachability-js-extension-not-resolved.md` — landed alongside; together cover all 5 false positives surfaced 2026-05-03
- Long-term: `plans/active/feat-037-audit-reachability-ts-aware-rewrite.md` — would cover this case via principled symbol resolution
