---
id: bug-066-parity-verify-url-mapping-nextjs-routes
type: bug
status: completed
author-agent: human
created: 2026-05-07
updated: 2026-05-07
parent-plan: investigate-021-parity-verify-silent-false-clean-and-422-class
supersedes: null
superseded-by: null
branch: fix/parity-verify-url-mapping-nextjs-routes
affected-files:
  - orchestrator/src/parity-verify.ts
  - orchestrator/src/build-to-spec-verify.ts
  - scripts/synthesize-flow-e2e.mjs
  - .claude/skills/screens/SKILL.md
  - .claude/skills/pm/SKILL.md
feature-area: orchestrator/parity-verify
priority: P0
attempt-count: 1
max-attempts: 5
error-message: |
  parity-verify maps screen-id → URL via `/{screen-id}` literal heuristic.
  For projects with non-default Next.js routes (route groups, dynamic
  segments, alias paths), this maps to URLs that don't exist → Next.js
  404 page → no AppShell → false-positive shell-stripping bugs.
reproduction-steps: |
  1. /fix-bugs against any project where the design-stage screen-ids
     don't match the built-app URL paths verbatim.
  2. Empirical: reading-log-01 bk0g13gk1 (2026-05-07) — 4 screens
     filed shell-stripping bugs that were 100% false-positives because
     the verifier mapped:
     - books-list → /books-list (404; actual is /)
     - books-list-empty → /books-list-empty (404; actual is /)
     - book-detail → /book-detail (404; actual is /books/[id])
     - tags-manage → /tags-manage (404; actual is /tags)
stack-trace: null
---

# bug-066: parity-verify URL mapping doesn't account for Next.js route groups + dynamic routes

## Bug Description

`orchestrator/src/parity-verify.ts::resolveBuiltUrl` line 263 falls
through to `${base}/${screen.id}` for any screen without an explicit
`screenUrlMap` entry. For Next.js projects with:

- Route groups: `apps/web/app/(shell)/page.tsx` resolves to `/` (root),
  not `/(shell)`
- Dynamic segments: `apps/web/app/books/[id]/page.tsx` resolves to
  `/books/<some-id>`, not `/books-detail`
- Alias paths: design's `tags-manage` screen lives at `/tags`

The verifier hits 404s on these screens, gets the Next.js 404 page
(which has no AppShell layout because errors render outside the
shell route group), and reports "missing: AppShell[0]" as a
shell-stripping bug. Agents then dispatch to "fix" non-bugs.

Empirical: reading-log-01 bk0g13gk1 (2026-05-07 01:00) — 4 of 5
shell-stripping bugs were 100% false-positives. Only `book-create`
was real (genuinely outside `(shell)` group, lacks AppShell).

## Reproduction Steps

See frontmatter `reproduction-steps`.

## Error Output

```yaml
- id: bug-parity-books-list-shell-stripping
  parity:
    screen: books-list
    pattern: shell-stripping
    detail:
      missing:
        - AppShell[0]
      extra: []
```

But manually: `curl http://localhost:3000/books-list → 404`.
The built page DOES have AppShell on `/`. The verifier never visits `/`.

## Root Cause Analysis

`parity-verify.ts:263`:

```ts
// Static-route fallback: `/{id}` (e.g. "about" → "/about").
return { url: `${base}/${screen.id}` };
```

This works only when:

- screen-id matches the URL path verbatim
- No route groups in the path
- No dynamic segments

For projects with non-trivial routing (any real-world app), this is
wrong by default. The infrastructure exists to fix it
(`screenUrlMap?: Record<string, string>` accepted in the parity-verify
context — line 99) but **no caller populates it**. Build-to-spec-verify
just calls `parityVerify()` without supplying a map.

There are two parallel paths to populate it:

1. `pm` SKILL.md §2c (bug-025) calls for `routePattern` per-task in
   tasks.yaml — declared but not propagated to verifier
2. `screens-manifest.json.files[].routePattern` — should exist per the
   pm contract but reading-log-01's manifest only has `path/platform/screenId/sha256`

## Fix Approach

### Phase A — extend screens-manifest.json schema with routePattern (1h)

Add `routePattern: string` (optional) to each `files[]` entry in
`docs/screens-manifest.json`. The `/screens` skill writes this; if
absent, the verifier falls back to current heuristic with a warning
about the gap.

`.claude/skills/screens/SKILL.md` should already mandate this per
bug-025 (already in the pm skill). Verify the screens skill emits it.

### Phase B — verifier consumes routePattern from manifest (1h)

`orchestrator/src/parity-verify.ts::loadScreenList` currently returns
`{id, platform, mockupPath}`. Extend to also include
`routePattern?: string` from the manifest.

`resolveBuiltUrl` priority becomes:

1. explicit `ctx.screenUrlMap[id]` (test seam)
2. `screen.routePattern` (from manifest) — substitute placeholders
   like `[id]` with fixture values from screens.json or default
3. `home` alias for `/`
4. `/${id}` heuristic fallback (with warning if used)

### Phase C — emit warning when routePattern absent (30min)

When the verifier falls back to `/${id}` heuristic for a screen,
emit a `warnings[]` entry: `screen-route-mapping-missing: <screen-id>
defaulted to /<screen-id>; add routePattern to docs/screens-manifest.json
for accurate verification`. Operator-visible signal that prevents the
silent-false-positive class.

### Phase D — backfill reading-log-01 + RHD-01 manifests + tests (1h)

- Add routePattern fields to reading-log-01's screens-manifest.json
  manually so the next /fix-bugs run uses correct URLs
- Add the same to RHD-01 if it has dynamic routes (it does:
  /report/:owner/:repo, /compare/:slugs)
- 5 new tests in parity-verify.test.ts covering each path

## Rejected Fixes

- **Walk apps/web/app/**/page.tsx at verify-time + auto-derive URL
  map\*\*: heavier engineering; can't infer screen-id ↔ filename
  mapping reliably without convention. Defer until manifest path
  proves insufficient.
- **Operator-authored project-level screen-url-map.json**: more burden
  on humans; manifest is already auto-generated by /screens.

## Validation Criteria

1. screens-manifest.json files[] entries carry routePattern when
   /screens runs on a project with non-default routes.
2. reading-log-01 next /fix-bugs run: 4 false-positive shell-stripping
   bugs DON'T surface (or surface with corrected URLs).
3. Warning fires when routePattern is missing for a screen.
4. All existing parity-verify tests pass.

## Cross-references

- `pm` SKILL.md bug-025 — routePattern field in tasks.yaml (already
  defined; this bug propagates it to manifest + verifier)
- `screens` SKILL.md — emission point
- `bug-068` (sister) — defense-in-depth 404 detection for any
  remaining cases bug-066 misses

## Attempt Log

(implementation in progress — same session as plan filing)
