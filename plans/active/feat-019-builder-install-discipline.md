---
id: feat-019-builder-install-discipline
type: feature
status: draft
author-agent: claude-opus-4-7
created: 2026-04-25
updated: 2026-04-25
parent-plan: feat-018-mode-b-commit-discipline
supersedes: null
superseded-by: null
branch: feat/builder-install-discipline
affected-files:
  # Phase A — agent-side install + typecheck-first self-verify
  - .claude/skills/agents/front-end/react-next/SKILL.md
  - .claude/skills/agents/back-end/node-trpc-nest/SKILL.md
  - .claude/skills/agents/back-end/python-fastapi/SKILL.md
  - .claude/skills/agents/mobile/expo-rn/SKILL.md
  - .claude/agents/web-frontend-builder.md
  - .claude/agents/backend-builder.md
  - .claude/agents/mobile-frontend-builder.md
  # Phase B — orchestrator-side install on package.json change
  - orchestrator/src/invoke-agent.ts
  - orchestrator/src/feature-graph.ts
  - orchestrator/tests/invoke-agent.test.ts
  - orchestrator/tests/feature-graph.test.ts
  # Phase C — vendor skills hardening (Sanity v5 specifically)
  - .claude/skills/agents/vendor/sanity-studio/SKILL.md
  - .claude/skills/agents/vendor/next-sanity/SKILL.md
  # Phase D — re-run + report
  - docs/mvp-completion-report.md
  - docs/build-tier-roadmap.md
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-019 — Builder install discipline + vendor-skill hardening

## Problem Statement

feat-018 e2e validation (run 2026-04-24, halted after ~80 min) demonstrated that **builder agents produce excellent code** but **typecheck fails because of unresolved deps**. Two patterns surfaced:

### Pattern 1 — agent adds deps but `pnpm install` never runs

When `web-frontend-builder` worked on `feat-cms-content-model`, it correctly added `sanity@^5.22.0` to `apps/web/package.json` (per the sanity-studio vendor skill). The agent ran its self-verify (typecheck), which passed in the worktree because... actually it probably didn't pass. The agent reported `taskStatus: completed` anyway, OR feat-018 wasn't yet in place.

Once we manually committed the work to `revolution-pictures` main (commit `8ccc498`) + ran `pnpm install` at the project root, typecheck on main showed:

- `Cannot find module 'sanity'` in `sanity.config.ts`
- `Cannot find module '@sanity/vision'` in `sanity.config.ts`
- `Parameter 'Rule' implicitly has an 'any' type` (cascades from Sanity types not resolvable)

These are environment-resolution failures, not code-quality failures. The agent's code is right; the dep tree wasn't refreshed.

### Pattern 2 — agent uses outdated SDK patterns

Same agent used `__experimental_actions: ["update", "publish"]` in two schemas (about.ts, latestWorkGrid.ts) — Sanity v3 syntax that was removed in v5. The agent installed v5.22.0 but coded against v3 patterns. My `sanity-studio` vendor skill (factory commit `11b4273`) didn't explicitly call out v3 → v5 breaking changes.

### Combined effect on the smoke run

The orchestrator behaved correctly:

- feat-018 commit-discipline: agent reported failure (typecheck failed because of pattern 1) → `commitWorktreeChanges` correctly skipped → `close-feature` defensive guard correctly returned `feature-no-commits` → orchestrator marked feature failed → moved on.

The pipeline is mechanically sound. The failures are at the **environment plumbing + skill-grounding** layer.

## Approach

Three phases. Phase A (skill-level install discipline) is the bulk of the fix; Phase B (orchestrator-level safety net) backstops it; Phase C hardens the specific vendor skills that surfaced the issue.

### Phase A — Stack-skill self-verify checklist

Update each shipped stack skill's §Testing or §Self-verify section to mandate this exact sequence in the builder's tear-down (NOT the test-authoring phase — actually as the LAST step before returning):

```bash
# 1. Make sure all deps are wired (catches "I added a package.json line but the lockfile wasn't regenerated")
pnpm install

# 2. Typecheck the consumer surface (catches v3-vs-v5 SDK pattern drift)
pnpm --filter <appName> typecheck

# 3. Run unit tests
pnpm --filter <appName> test

# 4. Run kit consumer-contract validator (web tier only)
pnpm ui-kit:validate-consumer
```

Spec each stack skill explicitly. If ANY step fails, the agent MUST surface the error in its return JSON's `errors` field for that task — and report `taskStatus: "failed"` on the task. The orchestrator's existing failure-routing (no commit, surface to next attempt or close-feature failure) handles the rest.

Files to touch:

- `.claude/skills/agents/front-end/react-next/SKILL.md` — §Self-verify subsection (new or extend existing)
- `.claude/skills/agents/back-end/node-trpc-nest/SKILL.md`
- `.claude/skills/agents/back-end/python-fastapi/SKILL.md` — substitute `uv sync` for `pnpm install`
- `.claude/skills/agents/mobile/expo-rn/SKILL.md`

Plus update each builder agent's frontmatter prompt:

- `.claude/agents/web-frontend-builder.md` — add a sentence to the system prompt: "Before reporting a task as `completed`, run the stack skill's §Self-verify command block in full. Failures there block commit and require iteration."
- `.claude/agents/backend-builder.md` — same
- `.claude/agents/mobile-frontend-builder.md` — same

### Phase B — Orchestrator-side fallback

Even if an agent forgets, the orchestrator can detect-and-recover. After a builder agent completes (per feat-018's commit-on-success path), if `package.json` was in the diff for that commit, run `pnpm install` automatically before the NEXT agent in `agent_sequence` runs.

This is defense-in-depth — Phase A is the primary fix, Phase B catches the gap when an agent forgets or their self-verify command doesn't include install.

Implementation:

1. Extend `commitWorktreeChanges` (or add a sibling helper `installIfPackageJsonChanged`) that detects `package.json` in the just-committed change set + runs `pnpm install` from the worktree root.

2. `runFeature` calls it AFTER each successful agent commit and BEFORE invoking the next agent. Surface install warnings via `result.commitWarnings` (already plumbed in feat-018).

```ts
// after commitWorktreeChanges succeeds in feature-graph.ts:
const lastCommit = ...; // from commitResult.sha
const filesChanged = await execGit(`diff-tree --no-commit-id --name-only -r ${lastCommit}`, worktreeCwd);
if (filesChanged.stdout.split("\n").some(f => f.endsWith("package.json"))) {
  const install = await exec("pnpm install --frozen-lockfile=false", worktreeCwd);
  if (install.code !== 0) {
    commitWarnings.push(`pnpm install failed after ${agent}: ${install.stderr.slice(0, 200)}`);
  }
}
```

3. Tests: assert the install fires when `package.json` is in the diff; doesn't fire when it isn't; failures are warnings not aborts.

### Phase C — Vendor-skill hardening (Sanity)

Update the two Sanity vendor skills to explicitly call out v5 vs v3 breaking changes that bit the cms-content-model run:

`.claude/skills/agents/vendor/sanity-studio/SKILL.md`:

- Add a §v5 Breaking Changes subsection listing the patterns that DON'T work:
  - `__experimental_actions` → REMOVED. Singleton-document enforcement moved to Studio's `actions` config in `sanity.config.ts`. Show the migration:
    ```ts
    // sanity.config.ts (v5 way to lock a singleton)
    export default defineConfig({
      // ...
      document: {
        actions: (input, { schemaType }) =>
          schemaType === "about"
            ? input.filter(
                ({ action }) => !["delete", "duplicate"].includes(action),
              )
            : input,
      },
    });
    ```
  - `Rule` validation type → must import `Rule as ValidationRuleBuilder` from `sanity` for typed contexts (or accept `any` — explicit `Rule: any` for now)
  - Other v3→v5 changes from official upgrade guide

- Pin examples to `sanity@^5.x` syntax verbatim. Mark any v3-era patterns with `<!-- DEPRECATED in v5 -->` HTML comments.

`.claude/skills/agents/vendor/next-sanity/SKILL.md`:

- Pin `next-sanity@^9.x` patterns; flag v8 → v9 changes (already partly done; verify against the run).

### Phase D — Re-run + evidence

Re-fire Mode B after Phase A + B + C land. Validate that:

1. feat-cms-content-model's existing work doesn't need additional patches (Phase C corrects the SDK pattern; Phase A's install discipline backfills the dep tree)
2. feat-home + feat-galleries can complete autonomously: agent writes code → install fires → typecheck passes → tests pass → `commitWorktreeChanges` commits → close-feature merges → main moves forward
3. Update `docs/mvp-completion-report.md` with: full Mode B run cost, per-feature outcome, lessons.

### Testing at each stage

| Phase | Stage                                    | Mechanism                                                                                      | Pass criteria                                                                      |
| ----- | ---------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| A     | Stack skill §Self-verify additions       | markdownlint + grep for the 4-step command block in each shipped skill                         | All 4 skills have install + typecheck + test + (web only) ui-kit-validate-consumer |
| A     | Builder agent prompt update              | grep `.claude/agents/*-builder.md` for the new sentence                                        | All 3 builder agents reference the §Self-verify discipline                         |
| B     | `installIfPackageJsonChanged` helper     | Vitest with execGit + exec stubs                                                               | Fires on package.json change; no-op otherwise; warnings on failure                 |
| B     | feature-graph integration                | Vitest with stubs                                                                              | After commit-on-success, install fires when applicable                             |
| C     | Sanity skill v5-breaking-changes section | grep for `<!-- DEPRECATED in v5 -->` markers OR named subsection                               | Section exists + lists `__experimental_actions` migration                          |
| C     | Skill grounding test                     | Dispatch web-frontend-builder against a scratch Sanity feature; agent produces v5-correct code | Manual review of agent output for v5 patterns                                      |
| D     | Live e2e re-run                          | `/start-build revolution-pictures --resume-feature-graph --max-concurrent=1`                   | feat-home merges to main autonomously; cost < $40 budget                           |

## Rejected Alternatives

### Alternative A: Skip Phase A; rely on Phase B's orchestrator-level install

**Why rejected**: Phase B is defense-in-depth — the agent should still know it's responsible for self-verify. Skill-level docs make the contract explicit + auditable. Pure orchestrator-side install loses signal when an agent's tests fail (the agent's own report becomes muddied).

### Alternative B: Run `pnpm install` once at orchestrator startup, not per-feature

**Why rejected**: Wouldn't catch deps added BY the orchestrator's own agent dispatch. Per-commit is the right granularity.

### Alternative C: Fold the Sanity v5 breaking-changes content into Phase A's stack-skill update

**Why rejected**: stack skills are tier-level (react-next, expo-rn, etc.), not vendor-specific. Vendor-specific drift (Sanity v3→v5, Mux SDK changes, Resend webhook signature changes) belongs in vendor skills under `.claude/skills/agents/vendor/`. Keep concerns separated.

### Alternative D: Skip Phase C entirely; rely on Phase A's install discipline to surface the v3-vs-v5 mismatch via failed typecheck

**Why rejected**: Install + typecheck WOULD eventually catch the mismatch as a build failure → agent retries up to 3 times → likely still fails → feature marked failed. That's 3× the cost + slower feedback. Phase C teaches the agent to write v5-correct code on the first try.

## Expected Outcomes

- [ ] All 4 shipped stack skills have a §Self-verify subsection with the 4-step command block (or 3-step for non-web tiers)
- [ ] All 3 builder agent definitions reference the discipline
- [ ] `installIfPackageJsonChanged` helper exists + tested
- [ ] `runFeature` integrates it after `commitWorktreeChanges`
- [ ] Sanity vendor skills explicitly cover v5 breaking changes
- [ ] `pnpm --filter orchestrator test` passes (currently 203; expecting +6-10 new)
- [ ] feat-home builds + tests + commits + merges autonomously in a Phase D re-run
- [ ] `docs/mvp-completion-report.md` records the e2e success

## Validation Criteria

- **Typecheck + tests**: `pnpm -r typecheck && pnpm -r test` clean
- **Live re-run**: revolution-pictures Mode B produces ≥1 feature with real merge to main
- **Backwards compat**: existing 203 orchestrator tests still pass
- **Cost**: re-run on revolution-pictures stays under $40 budget cap

## Attempt Log

<!-- Executing agent fills this in. -->

## References

- `plans/active/feat-018-mode-b-commit-discipline.md` — parent plan; this addresses the next layer up
- `plans/active/feat-014-mvp-completion-autonomous-e2e.md` — original MVP plan
- Sanity v5 upgrade guide: https://www.sanity.io/docs/upgrade-v5
- Run output: `tasks/bpkud89fh.output` (the e2e attempt that surfaced these issues)
- Manual fixes to cms-content-model already on revolution-pictures main: commit `5bc1f77` (Sanity v5 patches)
