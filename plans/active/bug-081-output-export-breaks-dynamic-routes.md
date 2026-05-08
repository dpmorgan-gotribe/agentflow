---
id: bug-081-output-export-breaks-dynamic-routes
type: bug
status: draft
author-agent: human
created: 2026-05-08
updated: 2026-05-08
parent-plan: null
branch: fix/output-export-breaks-dynamic-routes
affected-files:
  - .claude/skills/agents/front-end/react-next/SKILL.md
  - .claude/skills/architect/SKILL.md
feature-area: orchestrator/scaffolding
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "Server Error: Page \"/(shell)/books/[id]/page\" is missing exported function \"generateStaticParams()\", which is required with \"output: export\" config"
---

# bug-081: `output: "export"` in next.config.ts breaks all dynamic routes

## Bug Description

Empirical case from reading-log-02 census 2026-05-08 (item 18 of 30-bug census):

```
Error: Page "/(shell)/books/[id]/page" is missing exported function
"generateStaticParams()", which is required with "output: export" config.
```

The book detail page (`/books/[id]`) — a dynamic route — server-errors because `next.config.ts` has `output: "export"` set. `output: export` is for fully-static sites; it's incompatible with:

- Dynamic routes (`[id]`, `[...slug]`, `[[...catchall]]`) without `generateStaticParams()`
- API routes (`app/api/*`)
- Server-side rendering / server actions
- Any route that depends on request-time data

reading-log-02 has a backend (apps/api/) and depends on dynamic routes for book details. `output: export` is the wrong configuration for this project shape. Setting it ships every dynamic route as a server-error page.

## Reproduction Steps

1. `cd projects/reading-log-02 && node scripts/dev.mjs`
2. Browse to `http://localhost:3000/`
3. Click any book card (or navigate to `http://localhost:3000/books/seed-book-1`)
4. Observe Next.js error overlay: missing `generateStaticParams()` for `output: export`
5. `cat apps/web/next.config.ts` — confirm `output: "export"` is present

## Root Cause Analysis

Next.js's `output: "export"` flag was likely added to next.config.ts by either:

### Hypothesis A — react-next stack skill scaffold default
`.claude/skills/agents/front-end/react-next/SKILL.md` may have a `next.config.ts` template with `output: "export"` set by default. If so, every web project scaffolded from this skill ships with broken dynamic routes.

### Hypothesis B — Architect skill choice based on architecture.yaml
`.claude/skills/architect/SKILL.md` may decide deployment topology based on a project's brief (e.g. "static SPA" → output:export; "full-stack" → no output). If reading-log-02 was misclassified as static-SPA despite having a backend, that's the root cause.

### Hypothesis C — Project-side commit
Someone added `output: "export"` to reading-log-02's next.config.ts ad-hoc (e.g. as a workaround for a different bug). Check git blame.

## Fix Approach

Phase A — Investigation (~20 min):

1. Read `.claude/skills/agents/front-end/react-next/SKILL.md` next.config.ts template
2. Read `.claude/skills/architect/SKILL.md` deployment-topology decision logic
3. `cd projects/reading-log-02 && git log -p -- apps/web/next.config.ts` — when was output:export added?
4. Check other shipped projects (reading-log-01, finance-track-01) — same flag?

Output: which hypothesis confirmed.

Phase B — Fix (depending on findings):

- If react-next skill has it as default: REMOVE `output: "export"`. This is the wrong default for full-stack projects (which is the common case for factory-shipped apps).
- If architect makes the wrong choice: REFINE the heuristic to only emit `output: export` for genuinely-static projects (no apps/api/, no server actions, no dynamic routes).
- If project-side: revert the commit + identify why it was added.

Phase C — Backfill:

- Remove `output: "export"` from any shipped project that has a backend
- Verify dynamic routes work post-fix (reading-log-02's `/books/[id]` page renders without server error)

## Cross-references

- Surfaced via investigate-025 Step 1 census (reading-log-02 walkthrough 2026-05-08)
- bug-078 Phase 1B includes `tooling-config-mismatch` deterministic discriminator that would catch this class going forward (output:export + apps/api/ exists)
- Closely related to bug-077 (also a scaffold/config-defaults bug class)

## Rejected Fixes

- **Add `generateStaticParams()` to every dynamic route.** Rejected — that's a workaround for the wrong-default; the underlying bug is `output: "export"` shouldn't be set for projects with backends.
- **Document the limitation as expected behavior.** Rejected — every full-stack web project with dynamic routes IS a real use case; the factory should support it out of the box.

## Validation Criteria

1. Phase A investigation produces conclusive root-cause finding
2. Phase B fix lands in the right factory location (skill OR architect logic)
3. Phase C backfill: reading-log-02's `/books/[id]` page renders without server error
4. New /new-project scaffolds (full-stack) don't have `output: "export"` set
5. New /new-project scaffolds (static-only, if such a configuration is supported) DO get it correctly

## Attempt Log

<!-- Populated by executing agents. -->
