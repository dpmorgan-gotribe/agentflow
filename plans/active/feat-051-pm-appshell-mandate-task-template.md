---
id: feat-051-pm-appshell-mandate-task-template
type: feature
status: draft
author-agent: claude-opus-4-7
created: 2026-05-05
updated: 2026-05-05
parent-plan: investigate-016-shift-left-bug-prevention-and-fix-loop-throughput
supersedes: null
superseded-by: null
branch: feat/pm-appshell-mandate-task-template
affected-files:
  - .claude/skills/pm/SKILL.md
  - orchestrator/tests/pm-skill.test.ts
feature-area: pm-skill / design-pipeline
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-051: PM injects AppShell-mandate boilerplate into every page-rendering task

## Problem Statement

Per investigate-016 F1: empirical 2026-05-05 finance-track-01 verifier surfaced 22 `visual-parity / shell-stripping` P0 bugs — every page in the app rendered as a stand-alone island instead of wrapping in `<AppShell sidebar={...} header={...}>` (the layout primitive the mockups explicitly use).

22 different builders across 22 different feature worktrees made the same miss. Root cause: PM tasks carry detailed selector contracts + state breakdowns + behavioral specs but NEVER mandate AppShell wrapping. `feat-spa-shell-dashboard.spa-shell-static-export` says "Top-level layout includes nav + FX-status indicator" — builder reasonably authored a custom nav inside `apps/web/app/layout.tsx`, ignoring the stack-skill's explicit "Critical: do NOT strip the AppShell wrapper" mandate (which IS present in `react-next/SKILL.md` lines 195-200).

PM's task-proximal instructions overrule stack-skill conventions. The fix lives at PM, not the stack-skill.

## Approach

### Phase A — PM-skill update: detect page-rendering tasks + inject layout mandate

Update `.claude/skills/pm/SKILL.md` to add a new task-emission rule:

For any task with:

- `agent: web-frontend-builder` AND
- `affects_files` contains pattern matching `apps/web/app/**/page.tsx` (or stack-equivalent for non-Next.js stacks)

Append to the task's `notes` field (preserving existing notes):

```
LAYOUT MANDATE (per react-next SKILL.md §AppShell wrapping):
the rendered tree MUST wrap in the layout primitive the matching mockup
uses — typically `<AppShell sidebar={<Sidebar>…</Sidebar>} header={<TopBar>…</TopBar>}>`
imported from @repo/ui-kit. Mockup at docs/screens/webapp/<screen-id>.html
shows the exact composition. Do NOT replace this with a custom nav
implementation — the AppShell primitive is the binding contract per
stylesheet §9e + per-feature parity-verify enforcement.
```

The `<screen-id>` is templated from the task's mapped screen (PM already cross-references screens-manifest per existing logic).

### Phase B — Stack-aware variants

Other stacks have different layout primitives:

- `react-vite` → similar `<AppShell>` from @repo/ui-kit
- `svelte-kit` → `<AppShell>` Svelte component
- `expo` → mobile-platform-specific (NavigationContainer wraps + screen-stack)

PM's mandate template should branch on `architecture.yaml.tooling.stack.web_framework` (or mobile_framework). For v1: ship react-next variant; document the others as TODO follow-ups.

### Phase C — Regression test

`orchestrator/tests/pm-skill.test.ts` (new): given a synthesized architecture.yaml + screens-manifest with 3 page-rendering features, assert PM-emitted tasks.yaml's task notes ALL contain "LAYOUT MANDATE" + reference the correct mockup path.

### Phase D — Empirical re-validation

Apply to a fresh project (book-swap or new finance-track-02) post-feat-051 ship. Run /pm followed by /start-build. Verify:

- All page tasks carry the mandate in notes
- Builder dispatch context includes the mandate (via task notes propagation per bug-035)
- Post-merge /build-to-spec-verify shows ZERO `shell-stripping` bugs

## Rejected Alternatives

- **Strengthen react-next/SKILL.md instead of PM** — Rejected. The stack-skill ALREADY has the mandate (lines 195-200) but PM's task notes overrule it (more task-proximal). Adding more to the stack-skill doesn't fix the problem; the fix must be where the override happens.
- **Add a build-time linter that flags missing AppShell** — Rejected as Phase A. Useful as defense-in-depth (feat-054's role) but doesn't catch at the source. PM mandate is upstream.
- **Auto-generate scaffold pages with AppShell pre-wrapped** — Rejected. Heavy-handed scaffold step; conflicts with builder's autonomy on per-task customization. PM mandate steers without prescribing exact structure.

## Expected Outcomes

- [ ] PM emits LAYOUT MANDATE in task.notes for every page-rendering web-frontend task.
- [ ] Builder dispatch context (via task.notes propagation) includes the mandate visibly at agent dispatch time.
- [ ] On a fresh project: /build-to-spec-verify produces 0 `shell-stripping` bugs (vs finance-track-01's 22).
- [ ] Stack-aware: react-next stack ships in v1; svelte-kit + expo TODO documented.

## Validation Criteria

- [ ] Unit test: synthesized arch.yaml + 3-feature scenario → PM emits tasks with LAYOUT MANDATE in notes for the 3 page-rendering tasks; non-page tasks (backend, tests, infra) DON'T get the mandate.
- [ ] Empirical: book-swap or finance-track-02 fresh-build verifier shows ≤1 shell-stripping bug (vs current 22 per project).
- [ ] No regression: existing PM behavior (state breakdowns, selector contracts, react-query patterns) preserved.

## Cross-references

- Parent: `investigate-016-shift-left-bug-prevention-and-fix-loop-throughput` F1 + recommendation
- Stack-skill mandate already in place: `.claude/skills/agents/front-end/react-next/SKILL.md` §AppShell wrapping (lines 195-200)
- Sister: `feat-052` (per-feature parity-smoke — defense-in-depth at close-feature gate)
- Sister: `feat-054` (reviewer playbook 8th dimension — defense-in-depth at reviewer gate)
- Bug-class lineage: `bug-035-builder-dispatch-drops-task-notes-field` — proved task.notes propagation IS the right channel; this plan exploits it
