---
id: bug-068-parity-verify-404-detection
type: bug
status: draft
author-agent: human
created: 2026-05-07
updated: 2026-05-07
parent-plan: bug-066-parity-verify-url-mapping-nextjs-routes
supersedes: null
superseded-by: null
branch: fix/parity-verify-404-detection
affected-files:
  - orchestrator/src/parity-verify.ts
  - scripts/diff-kit-skeleton.mjs
feature-area: orchestrator/parity-verify
priority: P1
attempt-count: 0
max-attempts: 5
error-message: |
  When parity-verify navigates to a URL that 404s (because of bug-066's
  URL-mapping miss OR a real broken route), it captures the Next.js 404
  page's DOM and diffs it against the mockup. Result: "missing: [AppShell[0]]
  + everything in the mockup]" reported as shell-stripping bug. False-
  positive that wastes agent dispatches on non-bugs.
---

# bug-068: parity-verify should detect 404 and not produce shell-stripping bugs

## Bug Description

Defense-in-depth for bug-066. Even after bug-066 ships proper URL
mapping, edge cases will exist (operator forgot to add routePattern,
project has aliased routes the verifier doesn't know about, etc.).
When the verifier navigates to a 404, it should detect that and emit
a different bug class (`verifier-route-mapping-error` or similar) —
NOT a structural-divergence bug that misleads the loop.

## Fix Approach (sketch)

In `defaultCompareScreen` after `await page.goto(builtUrl, ...)`:

```ts
// bug-068: detect Next.js 404 + bail before structural diff
const responseStatus = await ... // capture from page.goto's response
if (responseStatus === 404) {
  return {
    divergences: [],
    warnings: [
      `screen ${screen.id}: built URL ${builtUrl} returned 404 — verifier
      URL-mapping likely incorrect (see bug-066). Did NOT diff against
      mockup; would produce false-positive shell-stripping bug.`,
    ],
  };
}
```

Could also detect by inspecting the page DOM (Next.js 404 has a
specific `data-` marker or root content). HTTP status check is more
reliable.

## Status

Drafted; deferred until bug-066 ships and we see whether 404s still
slip through. If bug-066 covers all real-world cases, bug-068 may be
unnecessary.

## Attempt Log

(empty — drafted; deferred pending bug-066 empirical validation)
