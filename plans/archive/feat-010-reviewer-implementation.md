---
id: feat-010-reviewer-implementation
type: feature
status: completed
approved-at: 2026-04-23
approved-by: human
completed-at: 2026-04-23
author-agent: human
created: 2026-04-23
updated: 2026-04-23
parent-plan: investigate-002-build-tier-readiness-gap
supersedes: null
superseded-by: null
branch: feat/reviewer-implementation
affected-files:
  - packages/orchestrator-contracts/src/reviewer.ts
  - packages/orchestrator-contracts/tests/reviewer.test.ts
  - .claude/agents/reviewer.md
  - .claude/skills/reviewer/SKILL.md
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-010-reviewer-implementation: `/reviewer` agent + skill (last agent in the chain)

## Problem Statement

refactor-005 just shipped the scaffolding refresh + `docs/reviewer-playbook.md`. What's missing: the actual agent + skill + Zod contract + smoke test. Once feat-010 ships, the typical `agent_sequence` chain is complete:

```
backend-builder → web-frontend-builder → mobile-frontend-builder → tester → reviewer
```

After reviewer approves a feature, `git-agent close-feature` merges it to main. After tester+reviewer+close-feature cycle through every feature, Mode B is done. That's the full build tier.

Scaffolding is at `scaffolding/18-032-reviewer-agent.md` (191 lines, refactor-005 refreshed). Playbook is at `docs/reviewer-playbook.md` (484 lines, 7 dimensions × concrete criteria). feat-010 IS the implementation that binds to both.

## Approach

Four phases, same cadence as feat-008/009.

### Phase 1 — ReviewerOutput Zod contract + tests

1. Write `packages/orchestrator-contracts/src/reviewer.ts` matching the TS skeleton in `scaffolding/18-032-reviewer-agent.md` §ReviewerOutput:
   - `ReviewDimension` enum (7 values: architecture / security / compliance / maintainability / a11y / performance / brief-delivery)
   - `DimensionResult` discriminated union on `status`: `{ pass } | { fail; issues[] } | { skipped; reason }`
   - `ReviewIssue`: dimension + playbookSection + severity + filePath + optional line + message + retryTarget
   - `RetryTarget`: agent enum (builder agents + architect + pm) + taskIds[]
   - `ReviewerOutput`: success + featureId (feat-pattern regex) + dimensions (Record<dimension, DimensionResult>) + overallVerdict enum (approved|needs-revision|blocked) + issuesFound[] + retryTargets[] (aggregated per-agent) + toolsUsed[] + headSha nullable + warnings[]
2. Re-export via index.ts
3. Write `packages/orchestrator-contracts/tests/reviewer.test.ts` — ≥8 tests covering: each dimension enum value, DimensionResult discriminated-union routing, overallVerdict enum, severity enum, RetryTarget agent enum rejection, happy-path approved, needs-revision with populated issuesFound, blocked with warnings, featureId pattern, toolsUsed array

**Exit**: contracts tests ≥130 (up from 121).

### Phase 2 — Agent definition

Write `.claude/agents/reviewer.md` per scaffolding §Agent Definition:

- Frontmatter: `tools: Read, Write, Edit, Bash, Grep, Glob`, `permissionMode: acceptEdits`, `maxTurns: 30`, `effort: high`, `model: inherit`
- System prompt themes from scaffolding:
  - **Read-first mandate** — review is a READ op; do NOT rewrite tests or refactor code; you REPORT per `docs/reviewer-playbook.md`
  - **Playbook-bound** — every flagged issue cites the playbook dimension + concrete criterion; "looks off" is never a finding
  - **Retry routing is load-bearing** — every `needs-revision` issue MUST name `retryTarget.agent + taskIds[]`; orchestrator routing depends on it
  - **Stack-aware** — load per-tier stack skills' §Review / §Gotchas blocks (filter-then-load per feat-009 lesson)
  - **Worktree CWD awareness** — CWD is `.claude/worktrees/{feature.worktree}/`; scope the diff via `git log --oneline main..HEAD`; append ONE agent_history entry on completion
- Hard rules list (per scaffolding)

**Exit**: agent file registered; grep confirms no framework hardcodes in body; no language that implies rewriting tests or refactoring code.

### Phase 3 — Skill (8-step dispatcher)

Write `.claude/skills/reviewer/SKILL.md` implementing the 8 steps from scaffolding:

1. Argument gate (`--feature-id=<feat-...>` required; `--skip-perf` optional)
2. Load context: architecture.yaml, tasks.yaml (filter to matching feature), brief.md §11+§14, `docs/reviewer-playbook.md`, tester's TesterOutput from agent_history (or orchestrator-passed-through), filter-then-load per-tier stack skills' §Review/§Gotchas
3. Confirm worktree CWD: read + validate `.feature-context.json`; confirm feature_id + tester success entry in agent_history with `policyCheck !== "blocked"`
4. Scope the diff: `git log --oneline main..HEAD` — reviewer checks ONLY files touched by this feature's branch
5. Walk 7 dimensions per playbook — each gets its own sub-section in the skill with the exact tool invocations + pass thresholds. Cross-reference the playbook by section (`playbook §2.5 rate-limiting`)
6. Compose overallVerdict: approved (zero fails or only P3 warnings) / needs-revision (≥1 fail with clear retry target) / blocked (spec contradiction)
7. Append ONE agent_history entry; `last_writing_agent: "reviewer"` ONLY if reviewer committed (rare)
8. Emit ReviewerOutput JSON

Additional behaviors per scaffolding:

- Tool-unavailable skipping: Lighthouse / axe-core / artillery missing → `DimensionResult.status: "skipped"`, not fail
- Dimension 2 security has 15 sub-checks inline; skill walks all 15
- Retry routing: aggregate issues by retryTarget.agent; emit deduped `retryTargets[]` alongside raw `issuesFound[]`

**Exit**: skill registered (visible in available-skills list); invoking `/reviewer` without `--feature-id=` returns clean rejection.

### Phase 4 — Smoke test against feat-008/009 scratch repo

Reuse `projects/backend-builder-smoke-20260423-013328/` scratch repo (already has builder + tester commits merged to main). Synthesize a reviewer-only feature; run reviewer end-to-end.

1. **Setup**: scratch repo main is at commit `6c7e820` (post-tester merge). Add a new `feat-review-coverage-knowledge-graph` feature to `docs/tasks.yaml` with one `agent: tester` task already complete (pre-seeded in agent_history) and one `agent: reviewer` task. Commit the tasks.yaml change to main.
2. **Bootstrap + checkout-feature via /git-agent** — open worktree for the new feature.
3. **Pre-seed `.feature-context.json`** with a tester success entry (`policyCheck: "pass"`, coverageTotal: 82, coverageBuilderOnly: 68) so reviewer's step-3 prerequisite passes.
4. **Invoke reviewer subagent** with `--feature-id=<id> --skip-perf` (backend-only, no Lighthouse/artillery):
   - Load architecture + tasks.yaml + playbook + testing-policy + (filter-then-load) node-trpc-nest stack skill
   - Walk 7 dimensions against the committed backend code from feat-008 (schema.prisma, knowledge-graph service, seed.ts) + feat-009 (edge-case test files):
     - Dim 1 Architecture: confirm Prisma + neo4j driver imports match architecture.yaml integrations
     - Dim 2 Security: run 15 grep sub-checks against apps/api/src/; expected zero hits (synthetic clean code)
     - Dim 3 Compliance: no GDPR flag in scratch architecture.yaml → skip with warning
     - Dim 4 Maintainability: typecheck + lint blocked by no-install (same pattern as feat-008/009) → skipped with reason
     - Dim 5 A11y: backend-only feature → N/A → skipped
     - Dim 6 Performance: --skip-perf → skipped
     - Dim 7 Brief-delivery: grep integration_ref paths → confirm imports present
   - Most dimensions skip in scratch-repo mode; dimensions 1 + 2 + 7 should produce real results (pass, since the builder code is clean starter)
   - Expected: `overallVerdict: "approved"` with several "skipped" dimensions in `warnings[]`
5. **Close-feature via /git-agent** — merge reviewer's (empty) contribution to main. Reviewer normally doesn't commit; the merge may be empty or only carry the mock tasks.yaml changes. git-agent handles empty-feature-branch gracefully.
6. **Report**: ReviewerOutput validates against Zod; scratch repo gets another merge commit on main; factory repo untouched.
7. **Archive plan.**

**Exit**: reviewer smoke test passes; `overallVerdict: "approved"` on clean starter code; 4 dimensions cleanly skipped in scratch mode with warnings explaining why.

## Rejected Alternatives

- **Alternative A: Implement reviewer's retry fix-up loop (orchestrator re-invoking builder with retry context)** — Rejected. That logic already exists in task-035's `runFeature` per-task retry ladder (max 3). Reviewer just surfaces `retryTargets[]`; orchestrator consumes + routes. Keep the separation.

- **Alternative B: Inline the 7 dimensions directly in the skill's step 5 instead of loading from playbook** — Rejected. The playbook is the stable contract; inlining would require updating 2 files when a dimension criterion changes. Let the skill reference the playbook by section.

- **Alternative C: Smoke-test a reviewer rejection path (fabricate a security issue)** — Rejected for this plan. Phase 4 exercises the happy-path (approved). Rejection paths + retry-routing end-to-end are better validated when real live Mode B runs surface real issues, OR via a follow-up bug plan. Adding synthetic rejection data to the scratch repo muddies the smoke test's signal-to-noise.

- **Alternative D: Author `scripts/audit-brief-delivery.mjs` as a separate runner** — Rejected for this plan. Inline the grep logic in step 5's dimension 7. The standalone script adds a fourth file to the plan without proportional value; if the script shape becomes repetitive, we extract it as a follow-up.

## Expected Outcomes

- [ ] `packages/orchestrator-contracts/src/reviewer.ts` exports ReviewerOutput Zod + re-exported via index
- [ ] `packages/orchestrator-contracts/tests/reviewer.test.ts` ≥8 tests; contracts tests ≥130
- [ ] `.claude/agents/reviewer.md` present; stack-agnostic; read-first mandate; retry-routing-required language
- [ ] `.claude/skills/reviewer/SKILL.md` registered in available-skills list
- [ ] Smoke test: reviewer walks 7 dimensions; outputs ReviewerOutput validating against Zod; overallVerdict approved on clean starter code
- [ ] `.feature-context.json` agent_history populated; lockfile still schema-valid
- [ ] All 121 → 130+ contracts tests still pass; 112 orchestrator tests still pass
- [ ] Plan archived with lessons

## Validation Criteria

**Skill coverage:**

- Rejects `/reviewer` without `--feature-id=`
- `--skip-perf` flag cleanly skips dimension 6
- Aborts when no tester entry in agent_history (prerequisite)
- Aborts when tester's `policyCheck: "blocked"` (routes back to builder, not reviewer)
- Tool-unavailable → `DimensionResult.status: "skipped"`, not fail
- Every needs-revision issue has a `retryTarget`

**Agent body cleanliness:**

- No framework hardcodes (grep for NestJS/Prisma/Next.js/Expo in non-disclaimer context → zero matches)
- No "rewrite tests" / "fix code" / "refactor" language in the body (grep returns zero — reviewer is read-report only)

**Smoke-test coverage:**

- Feature's merged builder + tester output survives reviewer walkthrough unchanged (reviewer doesn't commit code/tests)
- ReviewerOutput shape matches Zod; all 7 dimensions addressed (`dimensions.architecture.status`, etc.)
- warnings[] explains why skipped dimensions were skipped

**No regression:**

- `pnpm test:all` green across contracts + orchestrator
- Nothing in `orchestrator/` source changes — additive plan
- Factory repo untouched by smoke-test scratch operations

## Attempt Log

### Attempt 1 — 2026-04-23 (succeeded across all 4 phases)

4 commits on `feat/reviewer-implementation`:

- Phase 1: `packages/orchestrator-contracts/src/reviewer.ts` — ReviewerOutput Zod + ReviewDimension + ReviewRetryAgent + RetryTarget + ReviewIssue + DimensionResult discriminated union + OverallVerdict. 28 new tests. Contracts now at 149.
- Phase 2: `.claude/agents/reviewer.md` — 135 lines. Read-first mandate; playbook-bound; retry-routing-required on needs-revision; filter-then-load stack skills; worktree CWD awareness; 6 hard rules.
- Phase 3: `.claude/skills/reviewer/SKILL.md` — 229 lines. 8-step dispatcher walking all 7 dimensions from the playbook. Tool-unavailable → skipped not fail. Graceful degradation when stack skill has no §Review block.
- Phase 4 smoke test: reused feat-008/009 scratch repo. Reviewer subagent walked 7 dimensions; overallVerdict `approved`; zero issuesFound; 3 dimensions passed (architecture, security, brief-delivery) + 4 skipped (compliance, maintainability, a11y, performance). Empty-branch close-feature merged cleanly. Factory repo untouched. All schemas validate (after fixing one subagent-forgotten `started_at` field in the close-feature agent_history entry).

**Full agent chain now validated end-to-end** against sequential features in the same scratch repo's main:

```
*   d1805e4 (post-feat-010 smoke)    ← tasks.yaml + reviewer-playbook seeds
*   6c7e820 (feat-009 tester merge)   ← 33 edge-case tests added
*   72c1301 (feat-008 builder merge)  ← Prisma schema + knowledge-graph service + seed
*   ee06626 (initial)
```

Three complete Mode B feature cycles shipped into one scratch repo: builder → close / tester → close / reviewer → close. Factory git unchanged throughout.

## Lessons Learned

**Empty-feature-branch close-feature is a real edge case.** When `agent_sequence` includes only meta-tasks (reviewer-only, tester-only, or both) and no one commits, `git merge --no-ff` reports `Already up to date` — no merge commit is created, but the close-feature succeeds semantically. The skill should document this explicitly: in the degenerate case, `mergeSha` equals the pre-merge main HEAD (which is `opened_from`'s sha). Current SKILL.md doesn't explicitly call this out; future live runs will hit this whenever a feature is meta-only. **Action**: add a note to git-agent SKILL.md Op 3 step 6 explaining the degenerate `Already up to date` path + what mergeSha means in that case.

**Security dimension's 15 sub-checks should emit individual toolsUsed entries.** The smoke-test subagent batched them into one grep call, which is efficient but loses audit-trail granularity. A human reviewing reviewer output wants to see each security sub-check as its own line in `toolsUsed[]` (so they can confirm 2.5 rate-limiting was actually run vs implicitly skipped). **Action**: update skill's step 5 dim 2 instruction to explicitly enumerate each sub-check separately.

**Lockfile rewrites should use Edit (append-one-entry), not Write (full rewrite).** The smoke-test subagent's 3rd consecutive `Write` to the same lockfile tripped the loop-detection hook. Reviewer's step 7 (append agent_history entry) should explicitly use Edit-mode append to avoid friction. Same pattern applies to builders + tester. **Action**: cross-cutting note to add to all agent SKILL.md files: "append to lockfile via Edit (single-entry append), not Write (full rewrite)".

**Missing brief.md → dimension 7 skips §14 cross-check gracefully.** Production projects always have brief.md (enforced at /new-project); scratch repos may not. Skill handles this correctly by noting in warnings + skipping. Passes trivially when all tasks in the feature are meta (no implementation to cross-reference against brief).

**Filter-then-load with missing §Review block works.** node-trpc-nest stack skill has no §Review section → reviewer emitted `stack-review-block-missing: node-trpc-nest` warning + fell back to generic playbook. Worked as designed. **Follow-up flagged from refactor-005 still applies**: backfill §Review / §Gotchas blocks on the 5 shipped stack skills before first live Mode B run.

**Subagents sometimes forget schema-required fields.** The close-feature agent_history entry was missing `started_at` in the subagent's output — I manually fixed post-hoc. Not a skill bug; Zod/AJV caught it. **Implication**: reviewer/tester/builder skills should explicitly list `started_at` as non-skippable in their agent_history append step. Also consider a post-close validate step that catches this before persisting the closed.json.

**Scope-fallback for empty diff is ad-hoc.** When a feature's branch has no commits, reviewer scoped review to files added by the previous merge (using `git log --name-only --diff-filter=A ee06626..72c1301`). This worked for the smoke test but is awkward in general — a proper solution is: orchestrator skips reviewer on empty-diff features (no code to review) OR reviewer emits `overallVerdict: "approved"` trivially with all dimensions skipped. For now, skill handles via warnings. **Action**: add a branch at step 4: if `git log main..HEAD` is empty, short-circuit to `overallVerdict: "approved"` with all dimensions skipped + reason "empty branch diff; no code in scope".

## Follow-up Work Unblocked

- **Builder → tester → reviewer chain is now COMPLETE** at the skill layer. Last agent in the typical `agent_sequence[]` done.
- **task-036 HITL gates** is next: replaces orchestrator's gate-server stub (from task-035 Phase 9) with real HTTP server + adds gate 6 (PR review before merge to main). After reviewer approves, gate 6 is what stops the orchestrator from auto-merging.
- **task-010 skills-audit + task-011 register-mcp-servers** — the last 2 dry-run halts before the Mode A pipeline walks cleanly end-to-end.
- **Stack-skill §Review / §Gotchas backfill** — dependency of live reviewer invocations. Should land before first live Mode B run against mindapp-v2.

Follow-ups NOT tested in this plan:

- **Reviewer rejection path** (`overallVerdict: "needs-revision"` with populated `retryTargets[]`) — deferred. A synthetic security bug in the scratch could exercise this; left for when live Mode B surfaces real issues.
- **Orchestrator retry routing** (builder re-invoked with reviewer's retryTargets) — consumed by task-035's runFeature retry ladder; separate concern, not reviewer's.
- **Real tool runs** (pnpm typecheck, knip, Lighthouse, artillery) — need a real install; validated on first live run.
- **Dimension 2's 15 individual sub-check toolsUsed entries** — noted as improvement above.
- **Empty-diff short-circuit in step 4** — noted as action above.
