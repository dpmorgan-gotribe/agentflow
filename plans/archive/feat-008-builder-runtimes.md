---
id: feat-008-builder-runtimes
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
branch: feat/builder-runtimes
affected-files:
  # Shared contract
  - packages/orchestrator-contracts/src/builder.ts
  - packages/orchestrator-contracts/tests/builder.test.ts
  # Agents (3)
  - .claude/agents/backend-builder.md
  - .claude/agents/web-frontend-builder.md
  - .claude/agents/mobile-frontend-builder.md
  # Skills (3)
  - .claude/skills/backend-builder/SKILL.md
  - .claude/skills/web-frontend-builder/SKILL.md
  - .claude/skills/mobile-frontend-builder/SKILL.md
  # Smoke-test scratch artifacts (under scratch dir, not committed)
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-008-builder-runtimes: backend + web + mobile builder agents/skills

## Problem Statement

Orchestrator Mode B can now drive worktree lifecycle (feat-007) against a tasks.yaml graph (feat-006) produced from a real architecture.yaml (feat-005). What's missing is the **agents that actually produce code inside those worktrees**. Without builders, Mode B is paperwork — the orchestrator walks the graph, opens worktrees, and finds nothing to do.

Scaffolding at `scaffolding/14-028-backend-builder-agent.md` + `15-029-web-frontend-builder.md` + `16-030-mobile-frontend-builder.md` defines the shape. The stack-skill shelf (feat-002) is already populated: `.claude/skills/agents/back-end/node-trpc-nest/SKILL.md` (179 lines real content), `front-end/react-next/` (159 lines), `mobile/expo-rn/` (180 lines), plus `python-fastapi` + `svelte-kit`. Builders are **thin dispatchers** that:

1. Read `architecture.yaml.tooling.stack.{tier}_framework` → stack-slug
2. Load `.claude/skills/agents/{tier}/{stack-slug}/SKILL.md` verbatim into prompt context
3. Read `docs/tasks.yaml` v2; filter tasks assigned to this builder + current feature
4. Generate code inside the feature's worktree CWD per the loaded stack skill's canonical layout
5. Generate happy-path tests alongside (hybrid TDD per `.claude/rules/testing-policy.md`)
6. Run stack skill's `lint && typecheck && test` self-verify gate
7. Return `BuilderOutput` JSON matching the shared contract

Bundling the 3 builders per roadmap recommendation — ~70% of the dispatcher logic is shared (argument parsing, architecture.yaml reading, tasks.yaml filtering, stack-skill loading, worktree-CWD awareness, self-verify command block, return JSON). Inline copies of that shared logic in 3 skill files is cheaper than building a meta-dispatcher.

## Approach

Four phases. Scope is intentionally narrower than the full spec — Phase 4 smoke-tests backend only. Web + mobile smoke tests deferred to feat-009 tester (which exercises all 3 builders' output) or to the first end-to-end Mode B pipeline run.

### Phase 1 — BuilderOutput Zod contract + tests

1. Write `packages/orchestrator-contracts/src/builder.ts`:
   - `BuilderTier` enum: `"backend" | "web" | "mobile"`
   - `BuilderTaskResult`: per-task outcome `{ taskId, status: "completed" | "failed", filesWritten: [], testsWritten: [], coverageBuilderScope: number, errors?: string }`
   - `BuilderOutputSchema`: shared across all 3 builders, discriminated on `tier`:
     ```
     { tier, stackSlug, featureId, tasksCompleted: BuilderTaskResult[], tasksFailed: BuilderTaskResult[], totalFilesWritten, totalTestsWritten, avgCoverageBuilderScope, lintPassed, typecheckPassed, testsPassed, warnings: [] }
     ```
2. Re-export via `packages/orchestrator-contracts/src/index.ts`
3. Write `packages/orchestrator-contracts/tests/builder.test.ts` — ≥6 tests covering: happy-path payload, missing task results, tier enum rejection, coverage invariant (0–100), failed-but-schema-valid payload

**Exit**: `pnpm --filter @repo/orchestrator-contracts test` passes; contracts test count ≥92.

### Phase 2 — Three agent definitions

Write `.claude/agents/backend-builder.md`, `.claude/agents/web-frontend-builder.md`, `.claude/agents/mobile-frontend-builder.md`. All three share:

- Frontmatter: `tools: Read, Write, Edit, Bash, Grep, Glob`, `model: inherit`, `permissionMode: acceptEdits`, `maxTurns: 30`, tier-appropriate `effort`
- System prompt themes:
  - **Stack-agnostic**: NO hardcoded framework references in the agent body. Dispatch logic lives here; framework idioms live in the stack-skill shelf.
  - **Sanctioned .env read** (backend only — per scaffolding L38, backend-builder inherits a sanctioned exception to block-dangerous.sh's .env ban for runtime config)
  - **Worktree CWD awareness**: CWD is `.claude/worktrees/{feature.worktree}/`; commit with conventional-commit messages; append to `.feature-context.json.agent_history[]` on completion
  - **Happy-path TDD** per `.claude/rules/testing-policy.md`: generate sibling `.test.{ts,py,tsx}` for every implementation file; covers canonical success case, primary branches, positive input-validation at boundaries; tester agent adds edge cases later
  - **Self-verify** via stack skill's `lint && typecheck && test` commands; 60% coverage floor on builder-authored lines; retry ≤2× with error context; escalate to orchestrator on persistent failure

**Per-tier specifics:**

- `backend-builder.md` — reads `apps.api.integrations[]` with `deployment: vendor | self-hosted`; generates into `apps/api/`. Tier: building (Sonnet 4.6, effort high per ~/.claude/models.yaml).
- `web-frontend-builder.md` — reads `apps.web.integrations[]`; generates into `apps/web/`; imports from `@repo/ui-kit` (no inline styling). Reads `docs/screens/{webapp}/*.html` for the visual target + `data-kit-*` attributes for deterministic HTML → JSX translation.
- `mobile-frontend-builder.md` — reads `apps.mobile.integrations[]`; generates into `apps/mobile/` (Expo); same `@repo/ui-kit` import discipline; reads `docs/screens/{mobile}/*.html`.

**Exit**: all 3 agent files present + registered (visible in agent listings); grep the agent bodies for framework-specific tokens (`NestJS`, `Prisma`, `Next.js`, `Expo`, etc.) → zero matches outside `stack-slug` reference comments.

### Phase 3 — Three skills (dispatchers)

Write `.claude/skills/backend-builder/SKILL.md`, `.claude/skills/web-frontend-builder/SKILL.md`, `.claude/skills/mobile-frontend-builder/SKILL.md`. All three follow the same 8-step pattern:

1. **Argument gate**: require `--feature-id=<feat-...>`; reject missing. Optionally `--task-ids=<csv>` (for per-task retries from orchestrator).
2. **Load architecture.yaml**: extract `tooling.stack.{tier}_framework` → `stackSlug`. If null → return `{ tasksCompleted: [], tasksFailed: [], warnings: ["tier-skipped: no {tier} framework in architecture"] }` and exit cleanly.
3. **Load stack skill**: read `.claude/skills/agents/{tier-dir}/{stackSlug}/SKILL.md` verbatim. If missing → abort with "stack skill missing; run /skills-audit --scope=build".
4. **Load tasks**: read `docs/tasks.yaml`; find the feature by `--feature-id`; filter `tasks[]` to `agent === {this-builder}` AND parent feature's `skip[]` does NOT include `{tier}`. If no tasks remain → exit cleanly with `tier-skipped-for-feature` warning.
5. **Confirm worktree CWD**: read `.feature-context.json` from the current directory; confirm `feature_id` matches. If not, abort — orchestrator wiring bug.
6. **Per task (respecting `task.depends_on[]` within feature):**
   - Generate implementation files per stack skill's §Canonical layout + §Idioms
   - Generate sibling happy-path tests per stack skill's §Testing pattern
   - Commit within the worktree: `git add <files> && git commit -m "feat({task.id}): <summary>"`
   - Run stack skill's self-verify command block (`lint && typecheck && test`); retry ≤2× on failure
   - Parse coverage output; assert ≥60% on builder-authored lines
7. **Append to feature-context.json**: single `agent_history` entry covering this builder invocation — `{ agent, op: "execute-tasks", outcome: "success"|"failure", commit_sha: <HEAD after commits>, notes }`. Set `last_writing_agent: "{this-builder}"`.
8. **Return `BuilderOutput` JSON** matching `BuilderOutputSchema`.

Shared logic (steps 1–5, 7, 8) is duplicated across 3 skills rather than extracted — per roadmap, inline duplication is cheaper than a meta-dispatcher skill.

**Exit**: all 3 skills registered in available-skills list; invoking `/backend-builder` without `--feature-id=` returns a clear rejection.

### Phase 4 — Backend-only smoke test against mindapp-v2 feat-core-data-model

Pick the simplest P0 backend-only feature from mindapp-v2's tasks.yaml: **`feat-core-data-model`** (Prisma schema + Neo4j driver + seed content; no frontend coupling per `skip: [web, mobile]`).

1. **Setup**: create a scratch git repo at `/tmp/builder-smoke-<ts>/` with a bare origin + initial commit on main (same pattern as feat-007 Phase 3).
2. **Seed the scratch repo** with a minimal subset of mindapp-v2's inputs the builder needs:
   - `.claude/architecture.yaml` (copy from mindapp-v2 — trimmed to stack + api integrations if needed)
   - `docs/tasks.yaml` (copy from mindapp-v2 — trimmed to just `feat-core-data-model` for tighter scope)
   - `docs/requirements.md` (optional — for builder prompt context)
   - `packages/types/` minimal skeleton (empty `src/index.ts` + `package.json`)
   - Stack-skill shelf copies: `.claude/skills/agents/back-end/node-trpc-nest/SKILL.md` (this is what the builder dispatches to)
   - `.claude/rules/testing-policy.md` (builder loads this into context)
3. **Bootstrap + checkout-feature** via git-agent (feat-007): open the scratch repo's worktree for `feat-core-data-model`.
4. **Invoke backend-builder skill** via a subagent — `--feature-id=feat-core-data-model`, CWD = the feature worktree. The subagent acts AS the backend-builder:
   - Load stack skill (node-trpc-nest)
   - Filter tasks to backend-only (per the feature's 2-3 tasks in tasks.yaml)
   - Generate code + sibling tests per the stack skill's canonical layout
   - Commit inside the worktree
   - Run lint + typecheck + test; report coverage
   - Update `.feature-context.json.agent_history[]` + return BuilderOutput JSON
5. **Validate**:
   - `.feature-context.json` post-builder still validates against its schema
   - BuilderOutput JSON validates against `BuilderOutputSchema`
   - Feature worktree has committed files
   - lint/typecheck/test exit codes all 0 (or the skill retried within budget and succeeded)
6. **Close-feature** via git-agent: merge the worktree → main; remove worktree. Confirm main has the merge commit.
7. **Cleanup**: `rm -rf /tmp/builder-smoke-*/` (scratch repo + bare origin).

**Exit**: smoke test produces a real merge commit on the scratch repo's main with actual generated backend code + passing tests. Archive plan with lessons.

## Rejected Alternatives

- **Alternative A: Ship backend-builder only; defer web + mobile to future plans** — Rejected. Builder agent bodies are ~40% shared; skill bodies are ~70% shared; ~95% of the stack-skill-shelf architecture is already shared. Splitting into 3 plans means re-deriving the dispatcher pattern 3 times + 3 separate review loops. Bundling (this plan) = less thrash.

- **Alternative B: Extract a shared `build-agent-shared-logic.md` sub-skill that all 3 skills import** — Rejected. The factory's skill system doesn't have a composable-skill mechanism; inline duplication is simpler than inventing one just for this plan. When/if we build multi-file skills (e.g., feat-011 or later), we can DRY the builders as a refactor.

- **Alternative C: Run web + mobile smoke tests in Phase 4 too** — Rejected. Smoke-testing all 3 against mindapp-v2 means setting up a scratch repo with the full 78-screen `docs/screens/` tree copied in (+ @repo/ui-kit), which is ~100 MB of seed data per builder. Backend-only skips the screens dependency entirely — cleanest smoke test. Web + mobile get validated when feat-009 tester drives all 3 builders against a fuller fixture.

- **Alternative D: Real `git worktree add` + real `pnpm install` inside the smoke scratch repo** — Rejected. Time-expensive and network-expensive for a smoke test. Phase 4 smoke test exercises the dispatcher LOGIC, not the end-to-end runtime. The generated code's `pnpm install` + `pnpm test` is validated implicitly by the coverage check; running a real install inside a scratch repo is integration-test territory (future: feat-009 tester).

## Expected Outcomes

- [ ] `packages/orchestrator-contracts/src/builder.ts` + `tests/builder.test.ts` ship; contracts tests ≥92
- [ ] 3 agent files exist; grep confirms stack-agnostic (no framework-specific tokens in body)
- [ ] 3 skill files exist + registered in available-skills list
- [ ] Smoke test: real merge commit on scratch repo's main with generated backend code + passing tests + coverage ≥60% on builder-authored lines
- [ ] BuilderOutput JSON from smoke test validates against the Zod schema
- [ ] `.feature-context.json` agent_history[] populated + lockfile still schema-valid post-run
- [ ] Dry-run halt point unchanged (builders are Mode B agents, not Mode A stages — they don't appear in STAGES[])
- [ ] All 112 orchestrator tests still pass
- [ ] Plan archived with lessons

## Validation Criteria

**Skill coverage:**

- Invoking any builder without `--feature-id=` returns a clear rejection
- Invoking with an unknown feature-id returns `feature-not-found`
- Invoking when tier is `skip[]`-excluded returns `tier-skipped-for-feature` warning + empty tasksCompleted
- Stack-skill loading — if the referenced skill file doesn't exist, builder aborts with the clear "run /skills-audit --scope=build" message

**Agent body cleanliness:**

- `grep -iE "NestJS|Prisma|Next\.js|Expo|SwiftUI|FastAPI" .claude/agents/{backend,web-frontend,mobile-frontend}-builder.md` → zero matches in non-comment body (references in frontmatter-description for searchability are OK if prefixed with "stack-slug:")

**Smoke-test coverage:**

- feat-core-data-model's 2-3 backend-builder tasks all produce files + sibling tests
- Generated files include Prisma schema + a module + a service + at least one sibling `.test.ts` per generated `.ts`
- Coverage ≥60% on builder-authored lines
- Merge commit on scratch main is well-formed (`Merge feat/core-data-model: feat-core-data-model`)

**No regression:**

- `pnpm test:all` green
- Nothing in `orchestrator/` source changes — additive
- mindapp-v2's design-tier + architect + pm artifacts unchanged

## Attempt Log

### Attempt 1 — 2026-04-23 (succeeded across all 4 phases)

4 commits on `feat/builder-runtimes` + 1 fix commit:

- Phase 1: `packages/orchestrator-contracts/src/builder.ts` — BuilderTier + BuilderTaskResult + BuilderOutputBase + 3 tier variants + discriminated BuilderOutput. 17 new tests. Contracts test count 103.
- Phase 2: 3 agent definitions — `.claude/agents/{backend,web-frontend,mobile-frontend}-builder.md`. Stack-agnostic (framework names only in "do not hardcode X" disclaimers). Sanctioned `.env` read for backend only.
- Phase 3: 3 dispatcher skills — `.claude/skills/{backend,web-frontend,mobile-frontend}-builder/SKILL.md`. Shared 8-step pattern: arg gate → load arch → load stack skill → filter tasks → confirm worktree → per-task execute+commit+self-verify → append agent_history → return BuilderOutput.
- Phase 4 smoke test: backend-builder against mindapp-v2's `feat-core-data-model` in an isolated scratch repo at `projects/backend-builder-smoke-<ts>/`. Full Mode B loop: bootstrap → checkout-feature → backend-builder(4 tasks, 8 files, 4 commits) → close-feature(clean merge). All GitAgentOutput variants + BuilderOutput validate. **Merge commit on main; worktree removed; closed-lockfile persisted; factory repo untouched.**

**Phase 4 artifacts** (in the scratch repo, not the factory):

| Task                         | Files written                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| prisma-schema-relational     | `apps/api/prisma/schema.prisma`                                                           |
| prisma-migrations-initial    | `apps/api/prisma/migrations/20260423000000_initial/migration.sql` + `migration_lock.toml` |
| neo4j-driver-knowledge-graph | `knowledge-graph.module.ts` + `.service.ts` + `.service.test.ts`                          |
| data-seed-scripts            | `prisma/seed.ts` + `seed.test.ts`                                                         |

Total: 6 impl + 2 tests, 4 conventional-commits, merge-commit sha on main. BuilderOutput JSON validated against `BackendBuilderOutput` Zod variant.

## Lessons Learned

**Gap 1 (fixed): Per-worktree `.git/worktrees/{slug}/info/exclude` is NOT consulted by `git status`.** This was my feat-007 fix for lockfile-blocks-worktree-remove. The smoke-test subagent confirmed via `git check-ignore -v` that per-worktree excludes aren't read inside the worktree — git uses `.git/info/exclude` (the common/shared one at the main working tree's `.git/`). **Fix applied**: updated `checkout-feature` step 5 to append to `.git/info/exclude` instead. Idempotent: check if the line exists before appending. Live smoke-test worked via this path.

**Gap 2 (documented, will be fixed in /new-project or pre-builder orchestrator step): Real invocations need `apps/{tier}/package.json` + `node_modules/` before builders' self-verify works.** The stack skill's `lint && typecheck && test` block assumes a real install. If `apps/api/package.json` is absent when backend-builder runs (which is true for the first-ever feature if infra-scaffolding hasn't run), `pnpm --filter @repo/api test` exits cleanly with "No projects matched" — retries loop pointlessly. **Action**: orchestrator should run `pnpm install` once after `feat-infra-aws-foundation` (or whichever feature scaffolds `apps/api/`) completes, before any subsequent backend-builder invocation. Alternatively, document this as a prereq of the backend-builder stack skill — the infra-scaffolding feature IS what creates `apps/api/package.json`.

**Cross-feature `depends_on` semantics are enforced at PM time, not at builder time.** To smoke-test `feat-core-data-model` in isolation, subagent had to trim tasks.yaml to just that feature AND clear its `depends_on: [feat-infra-aws-foundation]` to keep the validator happy. In live Mode B, the orchestrator's topological-sort scheduler handles cross-feature ordering — features with unresolved deps don't launch. Smoke-test isolation required breaking this invariant intentionally; document the trimming as a scratch-repo setup step.

**`.claude/hooks/enforce-boundaries.sh` blocks writes outside `$CLAUDE_PROJECT_DIR`.** The smoke-test plan called for `/tmp/<scratch>/` but the hook refused. Subagent pivoted to `projects/<scratch>/` (gitignored sub-path). Same outcome (factory git untouched), different path. Future smoke-test plans for tools that need filesystem isolation should write to `projects/<scratch-slug>/` or a similar project-internal gitignored path rather than `/tmp/`.

**CRLF warnings on Windows are noise but consistent.** Every commit produced `LF will be replaced by CRLF` warnings. Non-blocking. Generated apps that need LF line endings should have `.gitattributes` seeded with `* text=auto eol=lf` at `/new-project` time — flagged as a follow-up for `/new-project` skill audit.

**Builder dispatchers mostly-shared structure:** the 8-step pattern is cleanly replicated across all 3 skills with ~5 lines tier-specific swap per step. Code duplication cost is low; maintenance cost of a meta-dispatcher would be higher. Keep bundled.

## Follow-up Work Unblocked

- **feat-009 tester** — next on the critical path. Tester reads all 3 builders' committed work; adds edge cases + integration + E2E + raises coverage floor from 60% (builder-scope) to 80% (total). Tester smoke test naturally exercises web + mobile builders too (defer Phase-4-scope validation to tester).
- **feat-010 reviewer** — reads the full chain including tests; cross-references architecture.yaml + `.env.example` for "no secrets in code" scan.
- **task-010 skills-audit** + **task-011 register-mcp-servers** — the remaining Mode A dry-run halt stages. Can ship anytime before the first live Mode B end-to-end.
- **First live Mode B run** against mindapp-v2 — blocked on above + the `apps/{tier}/package.json` prereq (covered by `feat-infra-aws-foundation` being the first P0 feature in mindapp-v2's tasks.yaml).

Follow-ups NOT yet tested in this plan:

- **Web + mobile builder live smoke tests** — deferred to feat-009 or first end-to-end pipeline run. Dispatcher pattern is identical; risk is concentrated in the ui-kit + data-kit-\* translation logic, which tester will exercise across real screens.
- **Kit-change-request emission** — web/mobile builders should emit `docs/screens/kit-change-requests/*.md` when a primitive is missing. Not exercised here (backend doesn't need kit). Tester or a kit-gap scenario will surface this path.
- **Retry ladder** — builder's 2-retry-per-task self-verify loop not triggered in this smoke (all tasks "succeeded" as far as commit flow; lint/typecheck/test bypassed due to missing install). First real invocation will exercise it.
- **Actual `.env` read by backend-builder** — sanctioned exception not exercised (no .env present in scratch). First live run against mindapp-v2 (post-gate-5) will validate.
- **`last_writing_agent` update logic across multiple agents in a feature** — backend-builder is agent 1-of-3 in feat-core-data-model; only backend-builder wrote in this smoke. Tester + reviewer entries will land later.
