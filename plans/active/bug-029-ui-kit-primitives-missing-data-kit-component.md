---
id: bug-029-ui-kit-primitives-missing-data-kit-component
type: bug
status: draft
author-agent: claude-opus-4-7
created: 2026-04-29
updated: 2026-04-29
parent-plan: feat-028-visual-parity-verifier
supersedes: null
superseded-by: null
branch: bug/ui-kit-primitives-missing-data-kit-component
affected-files:
  - .claude/skills/stylesheet/SKILL.md
  - .claude/skills/agents/front-end/react-next/SKILL.md
  - schemas/screens.schema.json
feature-area: orchestration
priority: P1
attempt-count: 0
max-attempts: 5
---

# bug-029 — Project ui-kit primitives ship without `data-kit-*` attributes (Phase 0 retrofit deferred)

## Symptom

Empirically observed via feat-035 v2 live run against
repo-health-dashboard-01:

- Mockup HTML for `home`: 11+ `data-kit-component="..."` attributes
  (AppShell, RateLimitPill, Button×3, Card, Input, ListItem, …)
- Built page DOM (rendered by Playwright from `localhost:3001/`):
  ZERO `data-kit-*` attributes on any element

Result: parity-verify reports `[P1] layout-regrouping  missing: 19
primitives` for home + similar for about. The components are real
React renders that DO appear in the DOM, but the verifier extracts
by `data-kit-component` attribute — so they're invisible from its
perspective.

After AppShell got the attribute manually applied (one-line edit
to its root `<div>`), parity-verify cleared the shell-stripping
P0. The remaining 19+20 missing primitives are everything else
in the kit that didn't get the same retrofit.

## Root Cause

feat-028 Phase 0 ("Kit-attribute retrofit") was designed but
explicitly deferred per the archive note:

> stylesheet/SKILL.md — actual code retrofit deferred (PROJECT-side
> ui-kit retrofit deferred).

The factory's contract documentation requires every primitive to
forward `data-kit-component` / `data-kit-variant` / `data-kit-size`
/ `data-kit-props` to its root rendered element — but no automatic
retrofit ships in `/stylesheet`. Each project's ui-kit gets
authored without it, and the parity-verifier sees ghosts.

## Impact

- **parity-verify v2 produces unactionable bugs at scale**: every
  project will report the same "primitives missing" pattern for
  every screen until someone manually retrofits all primitives.
- **Bug-fix loop can't fix this**: the bug-fix loop's web-frontend-
  builder works on `apps/web/`, not `packages/ui-kit/`. So
  auto-filed `visual-parity` bugs route to a builder that can't
  reach the actual root cause.
- **Demonstrated**: the live repo-health-dashboard-01 run found
  39+ "missing primitive" rows clustered under 2 layout-regrouping
  divergences. None of them are primitives the builders dropped —
  they're primitives the ui-kit doesn't expose for verification.

## Approach

### Phase A — `/stylesheet` skill auto-retrofit on primitive generation

Update `.claude/skills/stylesheet/SKILL.md` so every primitive +
layout the skill emits includes the data-kit-\* prop forwarding
boilerplate. New primitives ship with the contract by default.

```tsx
// Pattern every primitive must follow:
export function Button({ variant, size, ...rest }: ButtonProps) {
  return (
    <button
      data-kit-component="Button"
      data-kit-variant={variant}
      data-kit-size={size}
      {...rest}
    />
  );
}
```

### Phase B — Bulk retrofit script for existing projects

Author `scripts/retrofit-ui-kit-data-attrs.mjs` that walks
`packages/ui-kit/src/primitives/**/*.tsx` + `layouts/**/*.tsx`,
parses each component's signature, infers the component name from
filename, and inserts `data-kit-component` / variant / size on the
root element if absent.

Idempotent (skips files that already have the attribute on root).
Ships with `--dry-run` + `--list-changes`.

Run as a one-time fixup against:

- `projects/repo-health-dashboard-01/packages/ui-kit/`
- Any other shipped projects that pre-date this fix

### Phase C — Bug-fix loop routing for visual-parity bugs

When `bugs.yaml.source: visual-parity` and the divergence pattern
is `layout-regrouping`, route the dispatch to a `kit-builder` agent
(if shipped) OR queue an operator-handoff message: "Run
scripts/retrofit-ui-kit-data-attrs.mjs against this project's
ui-kit before continuing".

For v1 the routing fix can be: when visual-parity bug source
appears, the auto-filed bug plan's affected-files list includes
`packages/ui-kit/src/**` and the dispatch agent context surfaces
the retrofit script path.

### Phase D — Documentation

`.claude/skills/agents/front-end/react-next/SKILL.md` already calls
this out (per feat-028 Phase 1) but the project-side enforcement is
weak. Add to the `react-next` SKILL: "If verifying a built page
reports `layout-regrouping` divergences with `missing:` rows under
a known-rendered primitive, the ui-kit retrofit hasn't run — flag
in `genuineProductBugs[]` rather than fixing in `apps/web/`."

## Rejected Alternatives

- **Switch parity-verify to extract by class name / element type
  instead of data-kit-\***: rejected. The data-kit-\* contract is
  intentional — primitive identity should be stable across
  re-stylings. Identity-via-class is fragile.
- **Skip layout-regrouping for projects without retrofit**: Rejected.
  This bug surfaces real divergences when retrofit IS done; muting
  it would hide future regressions.
- **Make parity-verify scan node_modules/@repo/ui-kit/dist for
  primitive identity**: rejected; runtime DOM is the source of truth.

## Expected Outcomes

- [ ] `/stylesheet` skill emits primitives with data-kit-\* by default
- [ ] `scripts/retrofit-ui-kit-data-attrs.mjs` exists + idempotent
- [ ] Run retrofit against repo-health-dashboard-01 → parity-verify
      reports 0 layout-regrouping divergences for home + about
- [ ] Bug-fix loop routes visual-parity bugs to ui-kit context (or
      surfaces operator handoff) — not a futile apps/web/ dispatch
- [ ] No regressions in 567/567 existing orchestrator tests

## Validation Criteria

1. **Live re-run on repo-health-dashboard-01** post-retrofit →
   parity-verify shows 0 divergences on home + about (the static
   routes we have full coverage for).
2. **Fresh smoke project**: `/stylesheet` followed by parity-verify
   → 0 divergences from primitive identity (without manual
   intervention).
3. **Coverage**: ≥ 80% line coverage on the retrofit script.

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->
