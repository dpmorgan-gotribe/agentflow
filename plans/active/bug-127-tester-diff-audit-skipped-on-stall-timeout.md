---
id: bug-127-tester-diff-audit-skipped-on-stall-timeout
type: bug
status: blocked
author-agent: claude-opus-4-7
created: 2026-05-18
updated: 2026-05-18
parent-plan: investigate-023-tester-prefers-spec-fixes-over-flagging-product-bugs
supersedes: null
superseded-by: null
blocked-by: investigate-023 M-D
branch: fix/tester-diff-audit-stall-timeout
affected-files:
  - orchestrator/src/tester-diff-audit.ts
  - orchestrator/src/dispatch/tester-dispatch.ts
feature-area: factory/orchestrator/tester-audit
priority: P2
attempt-count: 0
max-attempts: 5
error-message: |
  Tester dispatch hits error_stall_timeout: wall-clock-1800000ms.
  Worktree contains uncommitted modifications to packages/types/src/index.ts +
  packages/types/src/ws-events.ts + packages/ui-kit/src/lib/motion.ts (.js → no-ext).
  These are bug-024 forbidden source-file mods. No genuineProductBugs[] flagged.
  Audit was skipped because dispatch never returned a normal completion JSON.
---

> **Discovery (2026-05-18 during ship-pass):** `orchestrator/src/tester-diff-audit.ts` **does not exist on disk**. `.claude/rules/testing-policy.md` lines 160 + 213 reference the module as "M-D, shipped" but a `find . -name 'tester-diff-audit*'` returns nothing under `orchestrator/src/`. The audit was never authored — `investigate-023`'s M-D mitigation is still pending. This bug's scope therefore needs to expand to _ship the audit module from scratch_ before the stall-timeout extension can land. Status changed `draft → blocked` until investigate-023 M-D is implemented OR this plan absorbs the M-D scope. See investigate-023 §"Mitigations" for the 6-anti-pattern checklist that the audit needs to mechanically detect.

# bug-127 — tester-diff-audit doesn't fire on stall-timeout abort, letting bug-024 source-file mods slip through

## Problem

The orchestrator's `tester-diff-audit.ts` (added per investigate-023 to mechanically detect bug-024 forbidden source-file modifications) fires only after a tester dispatch returns a normal completion JSON. When the tester hits `error_stall_timeout` (default 30-min wall-clock), the dispatch is killed mid-flight, no completion JSON is returned, and the audit is never invoked. Any source-file modifications the tester made before stalling remain in the worktree.

Manual operators have to inspect the worktree's `git status` post-stall to catch these. In the empirical case the modifications were broken (stripped `.js` extensions broke Node ESM consumption) but they passed unit tests in the vitest harness, so a force-merge would have shipped them silently if the operator hadn't inspected.

**Empirical:** gotribe-tribe-chat 2026-05-18 `feat-channel-view` — tester stalled writing Playwright WS E2E. Worktree had modifications to 3 source files outside the tester's allowed-paths whitelist (`packages/types/src/index.ts`, `packages/types/src/ws-events.ts`, `packages/ui-kit/src/lib/motion.ts`). The orchestrator marked the feature failed but didn't surface the bug-024 violations because the audit never ran.

## Proposed fix

Two layers:

1. **Run `tester-diff-audit` in a `finally` block** around the tester dispatch in `orchestrator/src/dispatch/tester-dispatch.ts`. Whether the dispatch returns normally, throws, or is killed by stall-timeout, the audit fires on the current worktree state.
2. **On stall-timeout + bug-024 violation detected,** include the violations in the failure context that downstream layers receive (so retry attempts know what to avoid + so the recovery flow can `git checkout --` the violated files automatically before re-dispatch).

Update `orchestrator/src/feature-graph.ts` failure-reason serialization to include `bug024Violations: [<files>]` when the audit catches violations during a stall-abort.

## Acceptance criteria

- [ ] `tester-diff-audit` runs in a `finally` around tester dispatch — fires on normal completion, exception, AND stall-timeout
- [ ] Stall-timeout failures that include bug-024 violations surface them in the `failed[]` entry's detail
- [ ] Retry context for the next tester attempt names the violated files + reverts them automatically before re-dispatch (so the tester starts from a clean source-file state)
- [ ] Regression test in `orchestrator/tests/tester-diff-audit.test.ts`: simulate a stall-aborted tester with bug-024 mods present; assert audit detects + reports

## Risk + rollback

- **Risk:** auto-reverting violated files on retry could lose tester work that was actually correct (rare — bug-024 mods are by definition out-of-scope for the tester). Mitigated by limiting auto-revert to files specifically named in the bug-024 violation list (not a broad `git checkout .`).
- **Rollback:** revert the `finally` block; auto-revert logic. Audit returns to "fire only on normal completion" behavior.

## Cross-references

- **bug-024** — tester forbidden source-file mods; this plan extends bug-024's mechanical enforcement to cover the stall-abort code path
- **investigate-023** — tester anti-pattern checklist; the audit's regex set already covers the modifications the empirical case hit
- **gotribe-tribe-chat** `feat-channel-view` 2026-05-18 — empirical motivator
- **feat-076** — sibling plan that reduces the rate at which WS-flow testers stall; this plan handles the residual cases where they still stall
