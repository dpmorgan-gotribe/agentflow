---
id: bug-025-cross-feature-url-contract
type: bug
status: draft
author-agent: claude-opus-4-7
created: 2026-04-29
updated: 2026-04-29
parent-plan: null
supersedes: null
superseded-by: null
branch: bug/cross-feature-url-contract
affected-files:
  - schemas/screens.schema.json
  - .claude/skills/screens/SKILL.md
  - .claude/skills/pm/SKILL.md
  - .claude/skills/agents/front-end/react-next/SKILL.md
  - .claude/agents/web-frontend-builder.md
feature-area: orchestration
priority: P1
attempt-count: 0
max-attempts: 5
---

# bug-025 — Cross-feature URL contract not enforced between builders

## Symptom

On the live `repo-health-dashboard-01` build, the home form
navigates to **`/r/${owner}/${repo}`** but the actual report route
file lives at **`app/report/[owner]/[repo]/page.tsx`** → URL is
**`/report/${owner}/${repo}`**.

User-reproducible:

```
http://localhost:3000/                     → click form, submit
                                              → router.push('/r/facebook/react')
http://localhost:3000/r/facebook/react     → 404 (no such route)
http://localhost:3000/report/facebook/react → renders correctly
```

Source of the mismatch (apps/web/app/page.tsx:106):

```ts
router.push(`/r/${owner}/${repo}`);
```

vs. file system:

```
apps/web/app/report/[owner]/[repo]/page.tsx
```

## Root Cause

**Two different builders authored two different conventions
without coordination.** feat-home's web-frontend-builder wrote the
home page with `/r/:owner/:repo` (likely from the brief's prose
"`router.push('/r/:owner/:repo')`" in the home page's specification
comment we saw at apps/web/app/page.tsx line 10). feat-report's
web-frontend-builder created the route directory at
`app/report/[owner]/[repo]/` (matching the feature name + a
clearer URL convention).

Neither builder had a CONTRACT to consult — there's no canonical
"this feature's URL is X" field in screens.json or in the per-task
prompt context. Each builder made an independent decision that
seemed reasonable in isolation.

**The brief mentioned `/r/...`** in feat-home's comment, but the
brief is advisory prose, not a machine-checked schema. feat-report
ignored it.

## Factory contracts that COULD have caught this

1. **`screens.schema.json`** could include a `route_pattern` field
   per screen (e.g. `"route_pattern": "/report/:owner/:repo"`).
   Both builders would read the same canonical value. Currently
   absent.
2. **PM's tasks.yaml** could surface URL ownership per feature
   (which feature owns which route). Currently absent.
3. **Web-frontend-builder's stack skill** could declare a
   §Routing-Contract section instructing the builder to read
   route patterns from screens.json BEFORE writing nav links.
   Currently absent — builders just wing it.

## What verify SHOULD catch

When `/build-to-spec-verify` fires post-Mode-B (which it didn't on
this run because feat-error-states failed):

- **Reachability audit (`audit-app-reachability.mjs`)** — walks
  source for nav-targets vs. defined-routes. The `router.push('/r/...')`
  navigates to a route that doesn't exist → expected output:
  `orphanRoutes[]` entry OR `flow-execution-failure` (depending
  on which audit catches it first).
- **Flow E2E synthesis (`synthesize-flow-e2e.mjs`, feat-025)** —
  generates Playwright tests from `docs/user-flows.html`. Flow 1
  ("user submits repo → sees report") would 404 → flow-execution-
  failure bug auto-filed.
- **Auto-bug-plan** (feat-022) — both above auto-file to
  `projects/<name>/docs/bugs.yaml` with `source: reachability-orphan`
  or `flow-execution-failure`, then the orchestrator's bug-fix loop
  dispatches the appropriate builder to align URLs.

This bug plan exists to:

1. Validate that verify DOES catch it post-feat-error-states-completion
2. Prevent recurrence in FUTURE projects via factory contract changes
   (the verify side is reactive; the factory side is proactive).

## Approach

### Phase A — Add `route_pattern` to screens.schema.json

```jsonc
{
  "id": "report-screen",
  "title": "Repo Health Report",
  "route_pattern": "/report/:owner/:repo",   // NEW canonical field
  "navigates_to": ["compare-screen"],
  ...
}
```

Update `.claude/skills/screens/SKILL.md` to instruct screen authoring
to derive route_pattern from the brief OR a sensible default
(`/{feature-slug}/[param]/[param]`).

### Phase B — Update web-frontend-builder stack skill

Add a §Routing Contract section to
`.claude/skills/agents/front-end/react-next/SKILL.md` (and
react-vite when shipped):

```
## Routing contract (cross-feature)

Before writing ANY navigation code (Link, router.push, useRouter),
read screens.json for the canonical `route_pattern` of the target
screen. Use that pattern verbatim — do NOT invent a shorter one
"for clarity".

If you're authoring a NEW screen, your route directory MUST match
its screens.json `route_pattern`:

  screens.json route_pattern: "/report/:owner/:repo"
  Next.js file location:      app/report/[owner]/[repo]/page.tsx

If two builders disagree on a URL, the screens.json value wins.
File a kit-change-request if you believe screens.json is wrong.
```

### Phase C — Builder prompt guard

In `.claude/agents/web-frontend-builder.md`, add a single-line
guard to the §Worktree CWD awareness section:

> When writing navigation code, route patterns come from
> `screens.json[<screen-id>].route_pattern` — do not invent.

### Phase D — PM-side awareness

Update `.claude/skills/pm/SKILL.md` so the PM agent surfaces
route_pattern for each feature's affected screens in the
task summary. Closes the loop: PM knows the contract → builders
read PM's output → all features align.

## Rejected Alternatives

- **Just let verify catch it post-hoc and rely on the bug-fix loop**
  — Rejected. Verify catches the SYMPTOM (404 on a flow), but the
  bug-fix builder might align by changing the wrong side (rename
  the route to `/r/...` to match the home link, OR vice versa).
  Without an authoritative source, the fix is a coin flip.
  Verify + factory contract is the right combo.
- **Validate URLs at PM-stage instead of build-time** — Rejected.
  PM can't know what URLs builders will write; PM only knows
  feature scope. The contract has to be in screens.json (the
  designed-output spec), not tasks.yaml (the build plan).
- **Codegen routes from screens.json** — Rejected for v1. Too
  invasive; we'd need to add a build step. Plain-text contract
  - builder discipline is sufficient.

## Expected Outcomes

- [ ] `schemas/screens.schema.json` has `route_pattern` field
- [ ] Stack skill (react-next) has §Routing Contract section
- [ ] Builder + PM prompts read/surface route_pattern
- [ ] Re-run `/screens` on a fresh project → screens.json includes
      route_pattern for all routed screens
- [ ] Re-run Mode B → home page links match report route directory

## Validation Criteria

1. **Factory-side audit**: a fresh project's screens.json contains
   `route_pattern` for every screen marked `routed: true`.
2. **Build-side verification**: re-run repo-health-dashboard-01's
   feat-home + feat-report after the contract ships → router.push
   target == route file location.
3. **Verify pipeline catches the existing bug**: when
   `/build-to-spec-verify` fires post-feat-error-states completion,
   `bugs.yaml` should contain a `flow-execution-failure` or
   `reachability-orphan` entry citing `/r/...` → confirms verify
   was working all along, just hadn't fired yet.

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->
