---
id: bug-072-blank-failure-html-files-from-page-content-swallow
type: bug
status: in-progress
author-agent: human
created: 2026-05-07
updated: 2026-05-07
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/blank-failure-html-files-from-page-content-swallow
affected-files:
  - scripts/synthesize-flow-e2e.mjs
feature-area: verifier/synthesized-flow-failure-capture
priority: P1
attempt-count: 0
max-attempts: 5
error-message: |
  Synthesized e2e specs emit catch blocks that swallow page.content()
  errors via .catch(() => "") and writeFileSync the empty string,
  producing 0-byte failure HTML files in docs/build-to-spec/failures/.
  Operators see blank files with no debugging context when the verifier
  flags a flow as failed.
reproduction-steps: |
  1. Project with synthesized e2e flows (any Strategy A/C/D)
  2. Run /build-to-spec-verify when at least one flow is broken
  3. Observe docs/build-to-spec/failures/flow-N-failure.html files
  4. Empirical: reading-log-01 2026-05-07 02:44 — 6× 0-byte files
     after the verifier filed bugs.yaml against bug-070-shaped failures
stack-trace: null
---

# bug-072: Blank failure HTML files from page.content() swallow

## Bug Description

`scripts/synthesize-flow-e2e.mjs` emits catch blocks into every
generated spec that swallow `page.content()` errors and write empty
strings to disk:

```js
catch (err) {
  await page.screenshot({ ... }).catch(() => {});
  const html = await page.content().catch(() => "");   // ← swallow
  fs.mkdirSync(FAILURE_DIR, { recursive: true });
  fs.writeFileSync(`${FAILURE_DIR}/${flowFileBase}-failure.html`, html);
  ...
}
```

When `page.content()` throws — typically because the page never loaded
(early navigation failure, page closed by playwright timeout, browser
crash, globalSetup-thrown abort) — the `.catch(() => "")` substitutes
empty string and `writeFileSync` writes 0-byte files.

The error message itself IS preserved (re-thrown to playwright's JSON
output 6 lines below: `failed at interaction \${__stepIndex}: ${message}`)
but the HTML capture loses everything. Operator's POV: blank file = no
debugging context. The whole point of the failure-html artifact is to
let the bug-author downstream understand what the page looked like
when it broke.

Two emission sites both have the swallow:

- `specForFlowInteractions` (feat-038 v2 path) at line 615-621
- `specForFlow` (legacy feat-022 path) at line 807-813

## Reproduction Steps

See frontmatter.

## Empirical evidence

reading-log-01 2026-05-07:

```
$ ls -la docs/build-to-spec/failures/
flow-1-failure.html  0 bytes
flow-2-failure.html  0 bytes
flow-3-failure.html  0 bytes
flow-4-failure.html  0 bytes
flow-5-failure.html  0 bytes
flow-6-failure.html  0 bytes
```

These were created at 02:44 by the verifier run that filed our current
bugs.yaml. At that time bug-070 (port-resolution) was unfixed →
globalSetup threw ECONNREFUSED :8000 on every flow → page.content()
failed → empty string written.

## Fix Approach

Replace the swallow at both emit sites with an envelope-fallback that
captures the error context when page.content() can't be read:

```js
let html = null;
try { html = await page.content(); } catch { /* page closed */ }
if (!html) {
  let url;
  try { url = page.url(); } catch { url = "<unavailable>"; }
  const errMsg = err instanceof Error ? err.message : String(err);
  const errStack = (err instanceof Error && err.stack) ? err.stack : "";
  html = `<!doctype html><html><body><pre>` +
    `flow-N captured no page content (page died before content() resolved).\n\n` +
    `URL when error fired: ${url}\n` +
    `Error: ${errMsg}\n\n` +
    `Stack:\n${errStack}\n` +
    `</pre></body></html>`;
}
fs.writeFileSync(...);
```

Strict superset of existing behavior — when `page.content()` succeeds,
identical output. When it fails, the operator gets the URL + error
message + stack trace inside a minimal HTML envelope instead of a
0-byte file. Blank files become impossible.

## Validation Criteria

1. After patch ships, future verifier runs that produce flow failures
   write non-empty HTML files containing at minimum the error message
2. When page is fully alive (the common case), failure HTML is
   identical to pre-patch (full page content)
3. When page is dead (globalSetup threw, browser crashed), failure HTML
   contains the envelope instead of 0 bytes
4. No new specs need authoring; the patch only changes the emit-site
   templates in synthesize-flow-e2e.mjs

## Cross-references

- `scripts/synthesize-flow-e2e.mjs` lines 615-621 + 807-813 — the two
  emit sites being patched
- `bug-070` — the kind of upstream failure that produces blank capture
  files (globalSetup ECONNREFUSED before any test body runs)
- `feat-022` — original verifier; the failure-capture mechanism this
  patch hardens
- `feat-038` — Phase 2A v2 path that introduced specForFlowInteractions
  (the second emit site)

## Attempt Log

(empty — patch about to ship)
