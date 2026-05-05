---
id: feat-054-reviewer-playbook-design-conformance-dimension
type: feature
status: draft
author-agent: claude-opus-4-7
created: 2026-05-05
updated: 2026-05-05
parent-plan: investigate-016-shift-left-bug-prevention-and-fix-loop-throughput
supersedes: null
superseded-by: null
branch: feat/reviewer-playbook-design-conformance
affected-files:
  - docs/reviewer-playbook.md
  - .claude/agents/reviewer.md
feature-area: reviewer / design-pipeline
priority: P2
attempt-count: 0
max-attempts: 5
---

# feat-054: Reviewer playbook 8th dimension — design-conformance check

## Problem Statement

Per investigate-016 F3: `docs/reviewer-playbook.md` enumerates 7 review dimensions (architecture, security, compliance, maintainability, a11y, performance, brief-delivery). Zero of them programmatically check whether built JSX matches the mockup's structure (specifically: does the rendered tree wrap in the layout primitive — typically `<AppShell>` — that the mockup uses?).

Brief-delivery comes closest but is subjective interpretation; relies on the reviewer agent recognizing the design intent without a checkable contract. Empirically (finance-track-01 2026-05-05 run): 22 features each had reviewer dispatch APPROVE the merge, then post-merge parity-verify caught all 22 missing AppShell wrappings.

A defense-in-depth 8th dimension catches this class even when feat-051 (PM mandate) fails to land OR a future stack-skill change accidentally drops the AppShell convention.

## Approach

### Phase A — Add §8 to reviewer-playbook.md

Append to `docs/reviewer-playbook.md` after §7 Brief-delivery:

````markdown
## 8. Design conformance

Compare the built JSX tree against the matching mockup HTML. The mockup
at `docs/screens/webapp/<screen-id>.html` is the binding layout contract;
the built page MUST mirror its kit-component nesting at the layout
primitive level.

**Specific checks for any new file under `apps/web/app/**/page.tsx`:\*\*

1. **Layout primitive present.** If the mockup's root has
   `data-kit-component="AppShell"` (or stack-equivalent), the JSX MUST
   import + use the matching primitive from `@repo/ui-kit` (typically
   `<AppShell sidebar={...} header={...}>`). Empirical evidence: 22
   shell-stripping P0 bugs on finance-track-01 because every page
   skipped this wrap.

2. **Primary nav consistency.** If the mockup's `<aside data-kit-component="Sidebar">`
   contains nav links to other routes, the JSX MUST render the same
   sidebar via either the AppShell's `sidebar` slot OR a direct
   `<Sidebar>` import.

3. **Topbar consistency.** Same shape: if mockup has
   `<header data-kit-component="TopBar">` containing global actions
   (display-currency switcher, refresh, etc.), JSX MUST surface them
   via the AppShell `header` slot OR equivalent.

**Output (when divergence found):**

```json
{
  "dimension": "design-conformance",
  "severity": "P0",
  "screen": "<screen-id>",
  "missing": ["AppShell"],
  "remediation": "wrap rendered content in <AppShell sidebar={...} header={...}> per docs/screens/webapp/<screen-id>.html"
}
```
````

**Cross-reference: the matching primitive's import surface lives in
`packages/ui-kit/src/layouts/app-shell/`. The stack-skill at
`.claude/skills/agents/front-end/react-next/SKILL.md` §AppShell wrapping
documents the canonical composition. Reviewer flags = web-frontend-builder
retry per the genuine-bugs ladder.**

**This dimension is defense-in-depth.** The PRIMARY enforcement point
is feat-051's PM-mandate task template (catches at PM-emit time);
feat-052's per-feature parity-smoke catches at close-feature time;
this reviewer dimension catches at reviewer dispatch time. All 3 layers
together = ~99% pre-merge catch rate.

```

### Phase B — Update reviewer agent prompt

`.claude/agents/reviewer.md` references the playbook by structure. Add §8 to the dimension list + ensure the agent's system prompt enumerates it as a required pass.

### Phase C — Empirical re-validation

After PM mandate (feat-051) + per-feature parity-smoke (feat-052) ship: ensure feat-054's reviewer-dimension-8 catches anything THAT SLIPS THROUGH PM + close-feature gates. Should be near-zero residual but defense-in-depth value remains.

## Rejected Alternatives

- **Make reviewer RUN parity-verify itself** — Rejected. Reviewer is read-first per refactor-008; doesn't dispatch tools that boot dev-servers. Reviewer reads JSX + mockup HTML statically + makes the call.
- **Skip reviewer dimension entirely; rely on feat-052 parity-smoke** — Rejected. Defense-in-depth has positive expected-value: feat-052 might miss a screen (filter bug), reviewer's static check catches the JSX-level intent regardless.
- **Add it as a NEW agent (e.g. `design-reviewer`) instead of extending reviewer** — Rejected. New agent surface = new dispatch cost + new context-pollution risk. Extending the existing reviewer keeps the per-feature dispatch count flat.

## Expected Outcomes

- [ ] reviewer-playbook.md has §8 Design conformance with checkable contract.
- [ ] reviewer agent prompt includes §8 in its dimension list.
- [ ] On a fresh project (post-feat-051 + feat-052 + feat-054 ship): reviewer flags any AppShell-stripping miss that slipped through PM + parity-smoke.
- [ ] Combined catch-rate (3-layer): ~99% pre-merge bug prevention for shell-stripping class.

## Validation Criteria

- [ ] Documentation: §8 added with worked example + remediation guidance.
- [ ] Reviewer agent's system prompt enumerates §8.
- [ ] Empirical: synthesize a deliberately-broken page.tsx (no AppShell wrap) + dispatch reviewer → reviewer surfaces design-conformance finding with severity P0.
- [ ] Empirical: AppShell-correct page.tsx → reviewer doesn't false-flag.

## Cross-references

- Parent: `investigate-016-shift-left-bug-prevention-and-fix-loop-throughput` F3 + recommendation
- Sister (upstream): `feat-051` (PM mandate — primary catch); `feat-052` (close-feature parity-smoke — secondary catch)
- This plan: tertiary defense-in-depth at reviewer dispatch
- Stack-skill ground truth: `.claude/skills/agents/front-end/react-next/SKILL.md` §AppShell wrapping (lines 195-200)
- Reviewer infrastructure: `docs/reviewer-playbook.md`, `.claude/agents/reviewer.md`
```
