---
id: bug-028-audit-reachability-misses-router-push
type: bug
status: draft
author-agent: claude-opus-4-7
created: 2026-04-29
updated: 2026-04-29
parent-plan: null
supersedes: null
superseded-by: null
branch: bug/audit-reachability-misses-router-push
affected-files:
  - scripts/audit-app-reachability.mjs
  - schemas/build-to-spec-verify-output.schema.json
feature-area: orchestration
priority: P1
attempt-count: 0
max-attempts: 5
---

# bug-028 — `audit-app-reachability.mjs` doesn't recognize `router.push` / `router.replace` / `redirect()` as nav targets

## Symptom

Empirically observed during repo-health-dashboard-01 launch 9 (verify
re-run after the bug-fix loop's iteration 1 had auto-fixed the
home-form's nav target):

- bug-fix loop iteration 1 changed `router.push('/r/${owner}/${repo}')`
  → `router.push('/report/${owner}/${repo}')`. Runtime-correct.
- Iteration 2 verify ran `audit-app-reachability.mjs` →
  `/report/[owner]/[repo]` flagged AGAIN as `reachability-orphan`.
- Bugs flap-reset to pending. New bug-fix attempt dispatched. Builder
  presumably tries another `router.push`-style fix. Audit re-flaps.
  Loop never converges.

The static `/about` route resolved cleanly in iteration 1 because
its nav was added via `<Link href="/about">` — JSX which the audit
DOES recognize. Dynamic routes (`/report/:owner/:repo`,
`/compare/[[...slugs]]`) are typically navigated programmatically
via `router.push` (Next.js App Router pattern for routes with
runtime-derived params) → audit blind → infinite flap.

## Root Cause

`scripts/audit-app-reachability.mjs` extracts nav targets by walking
the JSX/TSX AST for:

- `<Link href="...">` (or `href={...}` literals)
- `<a href="...">`
- Possibly `<form action="...">`

It does NOT walk function-call ASTs to find:

- `router.push(...)` (Next.js App Router `useRouter`)
- `router.replace(...)`
- `redirect(...)` (Next.js server-side redirect)
- `permanentRedirect(...)`
- `useRouter().push(...)` / inline pattern variants
- `Form` component's `action="..."` (Next.js 14+ Server Actions)

For routes that CAN ONLY be reached via these patterns (dynamic
`/[param]/[param]` routes navigated from a form submit), the audit
declares them orphaned even when the runtime navigation works fine.

## Impact

- **Direct**: 2 of 3 orphan-route bugs in the live run flap-loop on
  every iteration → bug-fix loop hits iteration cap (5) without
  converging → ~$5-10 wasted bucket per offending project.
- **Indirect**: operators see "iteration-cap-hit" and lose trust in
  verify's signal — they can't distinguish "real orphan" from
  "audit blind spot".
- **Cross-project**: ANY Next.js App Router project with a form-driven
  search/redirect flow will hit this. Common pattern, broadly
  applicable.

## Approach

### Phase A — Extend AST visitor in `audit-app-reachability.mjs`

Add a new collector pass that walks function-call ASTs for these
patterns:

1. `router.push(<string-literal-or-template>)`
2. `router.replace(<string-literal-or-template>)`
3. Imported `redirect(<string-literal-or-template>)` from `next/navigation`
4. Imported `permanentRedirect(...)` from `next/navigation`
5. `useRouter()` calls followed by `.push(...)` chain
6. JSX `<Form action={...}>` from `next/form`

Extract the route argument (string literal or template-string with
known-resolvable parameters). Add to the same nav-target set the
existing `<Link href>` collector populates.

### Phase B — Template-string handling

Routes are typically templates: `router.push(\`/report/${owner}/${repo}\`)`.
The audit needs to:

1. Detect the literal prefix (`/report/`)
2. Match against route directories that have dynamic-segment names
   (`[owner]/[repo]`, `[[...slugs]]`)
3. Mark the route as reachable IF the template's literal prefix
   matches the route's static prefix AND the parameter count matches
   the dynamic segment count

### Phase C — Test fixtures

Author fixtures in `orchestrator/tests/fixtures/audit-reachability/`
covering:

- A static route reachable via `<Link>` (already covered)
- A dynamic route reachable via `router.push` (NEW)
- A dynamic route reachable via `router.replace` (NEW)
- A static route reachable via `redirect()` from a server component (NEW)
- An UNREACHABLE route (not referenced from anywhere) → still flagged

### Phase D — Validation against repo-health-dashboard-01

Re-run `/build-to-spec-verify` after Phase A-C ships → expected
output: 0 orphan routes (vs. current 3). The bug-fix loop should
exit clean on first iteration.

## Rejected Alternatives

- **Just remove dynamic routes from the orphan-detector entirely** —
  Rejected. Real orphans (route file with no nav reference anywhere)
  are still valuable to flag.
- **Manual allowlist in tasks.yaml** — Rejected. Operators shouldn't
  have to whitelist every dynamic route the audit can't see; that's
  a DX regression.
- **Switch all builders to `<Link>` + URL state in the form** —
  Rejected. Sometimes `router.push` is the correct pattern (e.g., a
  form that constructs the URL from multiple inputs and conditionally
  redirects). Forcing JSX-only nav adds friction.

## Expected Outcomes

- [ ] AST visitor in `audit-app-reachability.mjs` extended for the
      6 patterns above
- [ ] Test fixtures cover all 6 cases
- [ ] Re-running verify against repo-health-dashboard-01 (current
      master HEAD `7d8435f`) reports 0 reachability orphans
- [ ] Bug-fix loop on a fresh smoke project exits clean on first
      iteration (no infinite flap)
- [ ] No regressions in 567/567 existing orchestrator tests

## Validation Criteria

1. **Synthetic test**: write a 2-route fixture (static via Link,
   dynamic via router.push) → audit reports 0 orphans.
2. **Live re-run**: `pnpm --filter orchestrator start generate
repo-health-dashboard-01 --resume-feature-graph
--pipeline-run-id 6b5985b4-3543-4db2-8f3e-07d9026e76c8` after
   Phase A ships → bugs.yaml's reachability-orphan entries
   either resolve or don't re-emit.
3. **Coverage**: ≥ 80% line coverage on the new AST-visitor code.

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->
