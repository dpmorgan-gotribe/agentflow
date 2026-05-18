---
id: feat-078-builder-dispatch-inlines-mockup-html
type: feature
status: draft
author-agent: claude-opus-4-7
created: 2026-05-18
updated: 2026-05-18
parent-plan: null
supersedes: null
superseded-by: null
branch: feat/builder-dispatch-inline-mockup-html
affected-files:
  - .claude/agents/web-frontend-builder.md
  - .claude/agents/mobile-frontend-builder.md
  - orchestrator/src/dispatch/feature-builder-context.ts
feature-area: factory/builder-dispatch
priority: P2
attempt-count: 0
max-attempts: 5
error-message: |
  ✗ feat-channel-list — task channel-list-reviewer failed after 2 attempts: needs-revision:
    (1) app/c/page.tsx subtitle <p> still missing ('Sunrise Collective · 6 members · 4 active channels', mockup L291-293);
    (2) app/c/page.tsx aggregate-unread badge+icon still absent (mockup L295-308);
    (3) app/c/layout.tsx /c nav Link still missing aria-current='page' + active-state classes (mockup L235).
---

# feat-078 — builder dispatch envelope includes mockup HTML inline for screens being implemented

## Problem

The web/mobile frontend builder dispatch envelope today includes the screens.json contract (`{ section, components, icons, flows, navigation }`) + the kit `.components-plan.json` + the LAYOUT MANDATE for page-rendering tasks. It does **not** include the raw mockup HTML at `docs/screens/{platform}/{screen-id}.html`. So the builder authors from spec but misses chrome details — header subtitle, aggregate-unread badges, active-nav-state classes, hover-revealed timestamp tooltips, etc. — that the reviewer later compares against the mockup line-by-line.

The reviewer rejects the builder's work; the builder retries with the reviewer's feedback but only sees the rejection summary, not the mockup; the retries don't converge; the feature gets marked failed.

**Empirical:** gotribe-tribe-chat 2026-05-18 `feat-channel-list` — 3 reviewer-rejection attempts, each flagging the SAME 3 chrome drifts versus `docs/screens/webapp/channel-list.html` lines 235 + 291-293 + 295-308. Each retry the builder fixed something else; never converged on the 3 actual flagged items. Manual fix applied (3 small JSX additions matching the mockup) merged cleanly.

## Proposed fix

Modify the orchestrator's feature-builder dispatch context (`orchestrator/src/dispatch/feature-builder-context.ts` or wherever the context envelope is composed) so that for every task with `screens[]` non-empty, the dispatch:

1. Reads each `docs/screens/{platform}/{screen-id}.html` referenced by the task
2. Inlines them under a `### Mockup HTML for {screen-id}` heading in the dispatch prompt
3. Includes the source-of-truth note: "This is the binding visual contract the reviewer compares your output against. Match its DOM structure, chrome (header subtitle/badges/active-nav-state), and `data-kit-*` attributes. Tailwind class strings may differ if you compose via primitives; the rendered DOM must match."

Update `.claude/agents/web-frontend-builder.md` + `.claude/agents/mobile-frontend-builder.md` system prompts to acknowledge the mockup HTML block + treat it as authoritative for chrome details.

**Size guard:** if a task's combined mockup HTML exceeds ~30 KB, summarize the chrome blocks (header / footer / sidebar / page-shell) rather than inlining the full file — the message stream / list bodies are less likely to be the rejection class.

## Acceptance criteria

- [ ] Dispatch envelope composer reads `docs/screens/{platform}/{screen-id}.html` per task's `screens[]`
- [ ] Inlined under `### Mockup HTML for {screen-id}` heading with the binding-contract note
- [ ] `web-frontend-builder.md` + `mobile-frontend-builder.md` system prompts mention the new block
- [ ] Size guard at ~30 KB per task (sum across screens); above threshold, only chrome blocks are inlined
- [ ] Smoke test: rerun a feat-channel-list-class feature with the new dispatch envelope; reviewer approves on first or second pass instead of looping past max-attempts

## Risk + rollback

- **Risk:** dispatch envelopes grow by 20-40 KB per task. Modest token-cost increase but well within Sonnet's context budget. Mitigated by the size guard.
- **Rollback:** revert the dispatch composer + agent prompt changes. Reverts to spec-only authoring.

## Cross-references

- **gotribe-tribe-chat** `feat-channel-list` 2026-05-18 — empirical motivator
- **feat-051** — LAYOUT MANDATE injection (sibling — also closes a class of reviewer-rejection by giving the builder a stronger anchor)
- **bug-052** — tester forbidden paths; same general "give the agent the full context once instead of letting it iterate" principle
- **investigate-023** — tester anti-pattern checklist; complementary lane (this plan reduces upstream builder-rejection-loops; investigate-023 addresses downstream tester-loops)
