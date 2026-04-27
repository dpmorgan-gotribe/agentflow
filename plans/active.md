# Active Plans

<!-- AUTO-GENERATED MANIFEST — Updated by /plan-status and /plan-archive skills.
     Each entry: ID | Type | Status | Priority | Branch | Summary -->

| ID                                          | Type    | Status | Priority | Branch                                  | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------- | ------- | ------ | -------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| feat-015-factory-extensions-post-mvp        | feature | draft  | P1       | feat/factory-extensions-post-mvp        | Roadmap plans 9-13 (skills-audit auto-author, html-verifier, lessons-agent, register-mcp-build, git-agent alignment). Runs AFTER MVP exit (achieved 2026-04-27 via kanban-webapp-09).                                                                                                                                                                                                                                                                                          |
| feat-016-post-mvp-catalog-promotion         | feature | draft  | P2       | feat/post-mvp-catalog-promotion         | Standardize post-mvp-scaffolding/ frontmatter + ship /post-mvp-review skill + run first 30-day cadence. Catalogs 17 deferred items; promotes triggered ones.                                                                                                                                                                                                                                                                                                                  |
| feat-021-pm-agent-availability-and-requests | feature | draft  | P2       | feat/pm-agent-availability-and-requests | Build the PM-side awareness + agent-change-request mechanism analogous to existing kit-change-request pattern. Phase A: PM reads `.claude/agents/` to know shipped set + falls back / emits requests for gaps. Phase B: `AgentChangeRequest` zod schema + `docs/agent-requests/<name>.md` emit format. Phase C: orchestrator pre-Mode-B agent-fulfilment dispatch. Phase D: ship `agent-expert` (scaffolding/26-039) with author-new-agent capability.                          |
| feat-022-build-to-spec-verification         | feature | draft  | P0       | feat/build-to-spec-verification         | New `/build-to-spec-verify` pipeline stage between last Mode B feature merge and orchestrator "complete" signal. Combines flow-driven E2E synthesizer (consumes `docs/user-flows-manifest.json` → emits Playwright specs that assert each step transition via `data-screen-id`) + static reachability analyzer (every exported component imported in production; every route linked from somewhere). Catches 5/8 of kanban-09 integration gaps. Per investigate-006.        |
| feat-023-pm-stage-brief-coverage-assertion  | feature | draft  | P0       | feat/pm-stage-brief-coverage-assertion  | Preventative coverage check at `/pm`: extract brief §11/§12 capabilities to `docs/brief-capabilities.json` at /analyze; PM emits `docs/tasks-coverage.json` mapping each capability to ≥1 task ID OR explicit `deferred[]` entry with reason. Deterministic `audit-brief-coverage.mjs` fails the `/pm` stage on silent drops. Catches the 3 gaps feat-022 can't (column rename/delete, /help — PM-stage holes). Per investigate-006 Pattern C.                              |

<!--
ARCHIVED 2026-04-27 (post-MVP-exit cleanup):

Bugs (validated by kanban-webapp-09 clean 10/10 autonomous run):
- bug-002 worktree-missing-hooks-perms — fixed via seedWorktree
- bug-003 builder-output-contract-mismatch — parser consumes BuilderOutput shape
- bug-004 agent-output-format-schema — SDK outputFormat for builders
- bug-005 windows-quoting-and-default-branch — tempfile commit + detectDefaultBranch
- bug-006 greedy-json-extractor — superseded by bug-007 (in plans/superseded/)
- bug-007 robust-output-extraction — sentinel + balanced-brace stack
- bug-008 close-feature-dirty-root — pre-flight auto-commit + diagnostic visibility
- bug-009 checkout-feature-snapshot — snapshot moved BEFORE worktree creation
- bug-010 graceful-skip-unknown-agent — try/catch in runLlmAgent for unknown agents
- bug-011 ship-security-agent — robust security agent (OWASP Top 10 methodology)
- bug-012 lockfile-aware-conflict-resolution — auto-resolve pnpm/npm/yarn lockfile conflicts
- bug-013 feature-context-gitignore — gitignore .feature-context.json
- bug-015 parallel-feature-source-contention — Phases 1+2+3 (agent recipe + PM file-affinity + architect feature-sliced)

Investigations (recommendations implemented):
- investigate-004 agent-shipped-vs-task-gap → bug-010 + bug-011
- investigate-005 gitignore-audit → bug-014 (folded into bug-013 commit + comprehensive .gitignore)
- investigate-006 build-to-spec-verification → feat-022 + feat-023

Features (validated by kanban-09 end-to-end):
- feat-014 mvp-completion-autonomous-e2e — MVP EXIT ACHIEVED (10/10 features merged, $45.03)
- feat-017 auth-provider-config — claude-max-subscription default working
- feat-018 mode-b-commit-discipline — auto-commit per task working
- feat-019 builder-install-discipline — pnpm install on package.json change working
-->
