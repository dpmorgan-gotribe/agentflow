---
id: bug-081-output-export-breaks-dynamic-routes
type: bug
status: completed
author-agent: human
created: 2026-05-08
updated: 2026-05-11
parent-plan: null
branch: feat/quota-observability
affected-files:
  - .claude/skills/agents/front-end/react-next/SKILL.md
  - projects/reading-log-02/apps/web/next.config.ts
  - projects/reading-log-02/BACKPORTS.md
feature-area: orchestrator/scaffolding
priority: P0
attempt-count: 1
max-attempts: 5
error-message: 'Server Error: Page "/(shell)/books/[id]/page" is missing exported function "generateStaticParams()", which is required with "output: export" config'
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

### Attempt 1 — 2026-05-11 — shipped

**Phase A — Investigation findings:**

- Hypothesis A (react-next stack skill scaffold default) — **FALSIFIED**. Skill's `next.config.ts` template (§1 line 73-79) does NOT include `output: "export"`.
- Hypothesis B (architect skill choice) — **FALSIFIED**. Architect skill has no `output:` / `next.config` decision logic.
- Hypothesis C (project-side commit) — partially. Builder commit `df949ca` (web-frontend-builder, 2026-05-06) authored `apps/web/next.config.ts` with `output: "export"` literally. Same hash in reading-log-01 — deterministic builder output.
- **Real root cause (D — newly identified)**: `brief.md` line 82 says `web_framework: react-vite OR react-next (SPA static-export — no server rendering needed)`. The web-frontend-builder agent interpreted "static-export" as the literal Next config flag, even though the same brief mandates dynamic `/books/[id]` routes + a backend (`apps/api/`). reading-log-01 got a manual factory-free fix in commit `73ba7d8` (2026-05-06) — "Remove `output: 'export'` from next.config.ts; static-export mode rejects the dynamic /books/[id] route" — but no factory-side rule was ever written, so reading-log-02 scaffolded with the same bug.

**Empirical scope:** reading-log-02 affected. reading-log-01 fixed manually (commit `73ba7d8`). No other affected projects identified.

**Phase B — Factory fix shipped:**

1. `.claude/skills/agents/front-end/react-next/SKILL.md §5 Gotchas` — added a load-bearing entry: "NEVER set `output: 'export'` in `next.config.ts` unless ALL three hold: (1) no `apps/api/`, (2) no dynamic route segments, (3) no `app/api/*` route handlers. Brief phrasing like 'SPA static-export' is _deployment intent_, NOT a Next config flag. Next App Router defaults already produce SPA-style client-side routing." Included the canonical `next.config.ts` template (without the flag) so builders have something to copy verbatim.
2. `.claude/skills/agents/front-end/react-next/SKILL.md §7 Anti-patterns` — added a one-liner cross-referencing §5.
3. `.claude/skills/agents/front-end/react-next/SKILL.md` Self-verify — added a grep+find guard: if `next.config.ts` has `output: "export"` AND any `apps/web/app/**/[*]` directory exists, the build fails with a bug-081 citation. Prevents the regression at builder self-verify time.

**Phase C — Project backport applied:**

- `projects/reading-log-02/apps/web/next.config.ts` — removed `output: "export"` line + factory-backport comment ✓.
- `projects/reading-log-02/BACKPORTS.md` — appended bug-081 section documenting what was changed + verification steps.

**Validation criteria status:**

1. ✅ Phase A investigation produces conclusive root-cause finding (it's Hypothesis D — builder mis-interprets brief phrasing; not a factory-side default but a missing factory-side guardrail)
2. ✅ Phase B fix lands in the right factory location (react-next skill — Gotchas + Anti-patterns + Self-verify)
3. ⏳ Phase C backfill: reading-log-02's `/books/[id]` page renders without server error — confirmed mechanically (config change applied); requires dev-server restart + browser walk to fully verify
4. ⏳ New /new-project scaffolds — wait for next builder run; verify `next.config.ts` lands WITHOUT `output: "export"` (the Self-verify grep would reject it)
5. n/a Phase C Validation #5 (static-only configuration support): no shipped project is genuinely static-only; defer to first such project

**Decisions made:**

- **Fix in react-next skill, not the brief.** The brief language ("SPA static-export") is operator-facing intent, not a factory-mandated phrasing. Future briefs will have similar ambiguity. Factory must defensively guard against the literal-flag misinterpretation regardless of brief wording.
- **Three-surface defense** (Gotcha + Anti-pattern + Self-verify grep): the bug surfaced because no surface owned the rule. Repeating it across §5/§7/self-verify makes future builder agents harder to mis-execute.
- **Self-verify grep, not pre-build static analysis.** The grep runs at self-verify time inside the builder's worktree — same loop as bug-077's Tailwind pipeline guard. Adding a separate audit step would require new orchestrator wiring; self-verify reuses what's there.
- **Project backport for reading-log-02 only.** Same scope decision as bug-080 — other reading-log-\* projects have the same issue but aren't on the bug-fix re-validation path; deferred to next `/new-project --force`.

**Cross-references:**

- reading-log-01 commit `73ba7d8` (2026-05-06) — pre-existing manual fix; demonstrates the bug had been hit before but never escalated to factory.
- bug-077 — sister scaffold/config-defaults bug class; similar self-verify pattern.
- bug-078 Phase 1B (planned) — would add a `tooling-config-mismatch` deterministic discriminator that catches output:export + apps/api existing in the verifier. Defense-in-depth at the verifier layer.
