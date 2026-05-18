---
id: bug-126-orchestrator-bug-009-windows-longpaths-race
type: bug
status: draft
author-agent: claude-opus-4-7
created: 2026-05-18
updated: 2026-05-18
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/bug-009-windows-longpaths-race
affected-files:
  - orchestrator/src/checkout-feature.ts
  - orchestrator/src/git-helpers.ts
feature-area: factory/orchestrator/worktree-lifecycle
priority: P0
attempt-count: 0
max-attempts: 5
error-message: |
  [runCheckoutFeature] feature feat-X: project root has dirty/untracked state — auto-committing snapshot before worktree creation.
  Failed features:
    ✗ feat-X — checkout-feature failed: {"op":"checkout-feature","success":false,"reason":"worktree-seed-failed",
      "detail":"bug-009 pre-worktree snapshot failed: git command failed: git commit -F C:\\Users\\...\\agentflow-snapshot-XXXXX\\MSG\n"}
---

# bug-126 — orchestrator bug-009 pre-worktree snapshot fails on Windows + pnpm + Storybook deep node_modules

## Problem

Orchestrator's `checkout-feature` runs a pre-worktree snapshot commit (bug-009 path) before opening a new git worktree. On Windows projects that have any sibling worktree with `node_modules/.pnpm/...` paths exceeding `MAX_PATH` (260 chars) — which happens automatically as soon as Storybook devDeps land in `packages/ui-kit/` (post-`/stylesheet-primitives`) — git status surfaces dozens of `warning: could not open directory '...': Filename too long` lines but reports no actual dirty files. The bug-009 path interprets the warnings as "dirty state present", stages nothing, then calls `git commit -F <tempfile>`, which fails because there's nothing to commit. The whole `checkout-feature` step exits `worktree-seed-failed` and the feature cascades.

**Reproduction:** 3-of-3 retries against `feat-presence-sidebar` in `gotribe-tribe-chat` (the 11th feature in the DAG, dispatched after kit + Storybook deps were installed in 4 prior worktrees). `git status --porcelain` from the project root returns empty; `git status --porcelain --ignored` emits the "Filename too long" warnings to stderr.

## Empirical motivator

**gotribe-tribe-chat 2026-05-18 final wave.** After 10/11 features merged cleanly, the 11th — `feat-presence-sidebar` — failed `checkout-feature` 3× in a row with identical bug-009 output. Each attempt cost $0 (failed pre-LLM-dispatch) but blocked the cascade. Workaround was manual worktree authoring + force-merge.

Setting `git config core.longpaths true` on the project root **did not fix it** because the orchestrator invokes git from the factory root via `-C <projectDir>`, and `-C` doesn't propagate the local config. The orchestrator would need to pass `-c core.longpaths=true` explicitly OR set it at the system level.

## Proposed fix

Three layers, additive (ship layer 1 minimally; layers 2+3 harden):

1. **Distinguish "warnings present, no real dirty state" from "actually dirty"** in `git-helpers.ts`. Run `git status --porcelain` (NOT `--ignored`) and check **exit code 0 + empty stdout** as the clean signal. Ignore stderr warnings. If stdout is empty → return `{ dirty: false }` and skip the auto-commit entirely.
2. **Pass `-c core.longpaths=true`** on every git invocation in `orchestrator/src/git-helpers.ts` when running on Windows (`process.platform === "win32"`). Per-invocation config beats per-repo because the orchestrator doesn't always own the repo's config.
3. **Catch "nothing to commit" specifically** in the auto-commit path. If `git commit -F` exits non-zero with stderr containing `"nothing to commit"` / `"no changes added"`, treat as success (no-op) instead of failure.

## Acceptance criteria

- [ ] `orchestrator/src/git-helpers.ts gitIsClean(projectDir)` returns `true` when `git status --porcelain` is empty, regardless of stderr warnings
- [ ] Every git invocation through the orchestrator's helpers passes `-c core.longpaths=true` on Windows
- [ ] `runCheckoutFeature` no-ops the auto-commit when the working tree is genuinely clean (no spurious `git commit -F` calls)
- [ ] Regression test in `orchestrator/tests/checkout-feature.test.ts`: simulate a project with sibling worktrees containing pnpm-style long-path node_modules; assert `checkout-feature` succeeds
- [ ] Manual reproduction: re-run the gotribe-tribe-chat `feat-presence-sidebar` dispatch path; succeeds without manual intervention

## Risk + rollback

- **Risk:** layer 2 (`-c core.longpaths=true` everywhere) changes git invocation surface across the orchestrator. Mitigated by adding the flag in a single `git-helpers.ts` choke point.
- **Rollback:** revert `git-helpers.ts` + checkout-feature.ts diff. The bug pre-existed; reverting restores status quo.

## Cross-references

- **bug-009** (parent) — original "auto-commit dirty state before opening worktree" introduction
- **feat-074** — split `/stylesheet` into `/stylesheet-primitives` which is what introduces Storybook devDeps into `packages/ui-kit/node_modules`
- **bug-117** — recent fix for `openPerBugWorktree` stale-branch-conflict; same code path as `checkout-feature` lifecycle
- **gotribe-tribe-chat** project (2026-05-18) — empirical motivator
