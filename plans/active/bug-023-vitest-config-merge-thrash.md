---
id: bug-023-vitest-config-merge-thrash
type: bug
status: draft
author-agent: claude-opus-4-7
created: 2026-04-29
updated: 2026-04-29
parent-plan: null
supersedes: null
superseded-by: null
branch: bug/vitest-config-merge-thrash
affected-files:
  - .claude/skills/agents/front-end/react-next/SKILL.md
  - .claude/skills/agents/front-end/react-vite/SKILL.md
  - .claude/skills/agents/front-end/scaffolds/vitest.config.ts (template)
  - .claude/agents/tester.md
  - .claude/agents/web-frontend-builder.md
feature-area: orchestration
priority: P1
attempt-count: 0
max-attempts: 5
---

# bug-023 — `apps/web/vitest.config.ts` merge-thrash on parallel feature merges

## Symptom

During the 2026-04-29 repo-health-dashboard-01 Mode B run, two
parallel features hit close-feature merge conflicts on
`apps/web/vitest.config.ts`:

- **feat-compare** at ~01:43Z — reviewer-mediated conflict
  resolution path successfully merged (commit `87e86c7
reviewer: resolve vitest.config.ts merge conflict — sync e2e
  exclusions with main`).
- **feat-error-states** (predicted) — its tester has
  `M apps/web/vitest.config.ts` in the working tree at the time
  of writing. When close-feature fires, same conflict expected.

The current `vitest.config.ts` (committed at master HEAD `15daeb8`)
ALREADY uses global glob excludes that cover every feature's test
files automatically:

```ts
exclude: ["**/node_modules/**", "**/e2e/**"],
coverage.exclude: ["coverage/**", "**/__snapshots__/**",
                   "**/*.config.{ts,mjs,js,cjs}", "**/*.d.ts",
                   "**/node_modules/**", "vitest.setup.ts",
                   "e2e/**"],
```

So there is **no functional reason** for any builder or tester to
modify this file after the initial scaffold. The current modifications
are gratuitous (probably auto-formatter touch + reflexive
"tidy the config to add my new test paths").

## Reproduction

1. Start a Mode B run with ≥3 web frontend features that each
   author edge-case tests (per hybrid-TDD policy).
2. Each feature's tester touches `apps/web/vitest.config.ts` (even
   trivially — line-ending or formatter churn is enough to trigger
   git's textual merge).
3. When two close-features race for project-root merge, second one
   gets `CONFLICT (content): Merge conflict in apps/web/vitest.config.ts`.
4. Reviewer-mediated conflict resolution path fires (the orchestrator
   dispatches reviewer with Read/Write/Edit tools to resolve the
   conflict + commit). Adds ~3-5 min wall-clock per conflicted merge.

## Impact

- **Cost**: Reviewer-mediated resolution dispatches add ~$0.50-$1.00
  per conflict (Sonnet turns to read both versions + author the
  resolution). Frequency: ~50% of feature close-features in
  high-fan-out DAGs.
- **Wall-clock**: 3-5 min per conflict × N parallel merges =
  10-30 min cumulative on a typical 8-feature run.
- **Operator confidence**: post-merge-failure-state diagnostic
  dumps look scary; operators see them and reach for manual
  intervention (we did exactly this on this run).

NOT a blocker — the orchestrator handles it autonomously. But it's
unnecessary friction.

## Root Cause Hypothesis

Web frontend builder + tester agents lack explicit guidance that
`vitest.config.ts` is **scaffold-owned** and shouldn't be modified
after initial generation. The stack-skill (`react-next` /
`react-vite`) probably DOES include vitest.config.ts in its
canonical layout but doesn't mark it as off-limits for subsequent
features.

Auxiliary factor: the file gets included in the agent's context
window when it Read()s it (e.g., to confirm test runner
configuration), and once read, an agent might "fix" what it
perceives as suboptimal (formatting, ordering, etc.) — touching
the file even when no functional change is needed.

## Approach

### Phase A — Stack-skill update (front-end skills)

Update `.claude/skills/agents/front-end/{react-next,react-vite}/SKILL.md`
to add a §Files-NOT-to-modify section listing scaffold-owned config
files:

```
## Files NOT to modify after scaffold

These files are configured at scaffold time and should NEVER be
modified by feature builders or testers:

- apps/web/vitest.config.ts        (test discovery is glob-based; new
                                    test files match automatically)
- apps/web/vitest.setup.ts         (global test setup; per-test setup
                                    goes in the test file itself)
- apps/web/next.config.ts          (only architect or kit-change-request
                                    flow modifies this)
- apps/web/tailwind.config.ts      (kit-bump only)
- apps/web/tsconfig.json paths     (architect-owned)

If you believe one of these MUST change for your feature, that's a
kit-change-request — emit one via docs/screens/kit-change-requests/
instead of modifying inline.
```

### Phase B — Tester + builder agent prompt update

Add a single-line explicit guard to
`.claude/agents/tester.md` and `.claude/agents/web-frontend-builder.md`
in their §Worktree CWD awareness section:

```
DO NOT modify scaffold-owned config files (see stack-skill §Files-NOT-
to-modify). New test files match the existing globs automatically.
```

### Phase C — Initial-scaffold template hardening

The factory's vitest.config.ts template at
`.claude/skills/agents/front-end/scaffolds/vitest.config.ts` should
be the canonical version. Audit + fix any divergence.

Consider adding a comment at the top of the file:

```
// SCAFFOLD-OWNED — DO NOT MODIFY per feature. Test discovery is
// glob-based; new test files match automatically. Changes to this
// file go through kit-change-request.
```

The comment serves as inline guidance even if an agent doesn't
read the SKILL.md — the file itself tells the agent to leave it alone.

### Phase D — Empirical validation

After this ships, run a fresh Mode B project with ≥4 web frontend
features and confirm:

- No `M apps/web/vitest.config.ts` in any worktree's status
- No reviewer-mediated conflict resolution commits on vitest.config.ts
- Cumulative spend lower vs. baseline by ~$2-4 (skipped resolution
  dispatches)

## Rejected Alternatives

- **Add vitest.config.ts to lockfile-auto-resolve allowlist** —
  Rejected. The file has actual JS expressions; mechanical merge
  isn't safe. The reviewer-driven resolution is the right
  semantics; we just want it to fire LESS often.
- **Move to per-package vitest configs (micro-monorepo style)** —
  Rejected. Architectural change with broader impact; doesn't
  address the root cause (unnecessary mutations).
- **Disable Read access to scaffold-owned files** — Rejected. Agents
  legitimately need to READ the config (to know test runner
  semantics); they just shouldn't WRITE to it. Read+don't-write is
  enforceable via prompt guidance, not technical lockdown.

## Expected Outcomes

- [ ] `.claude/skills/agents/front-end/react-next/SKILL.md` has
      §Files-NOT-to-modify section
- [ ] `.claude/skills/agents/front-end/react-vite/SKILL.md` has
      §Files-NOT-to-modify section
- [ ] `.claude/agents/tester.md` + `web-frontend-builder.md` have
      one-line guards
- [ ] Scaffold template has a SCAFFOLD-OWNED comment header
- [ ] Next Mode B run shows zero modifications to
      `apps/web/vitest.config.ts` across feature worktrees
- [ ] No regressions in 567/567 existing orchestrator tests

## Validation Criteria

1. **Smoke project**: a fresh `/new-project` smoke run with 4+
   web features completes without any worktree showing
   `M apps/web/vitest.config.ts` in `git status`.
2. **Repo-health-dashboard-01 retro**: this project's worktrees
   should NOT show vitest.config.ts modifications after the next
   Mode B re-run (post-fix).
3. **Coverage**: ≥ 80% line coverage on touched skill files
   (which is mostly markdown — assertion is "no breakage in
   builder dispatch tests").

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->
