# Active Plans

<!-- AUTO-GENERATED MANIFEST — Updated by /plan-status and /plan-archive skills.
     Each entry: ID | Type | Status | Priority | Branch | Summary -->

| ID                                          | Type    | Status | Priority | Branch                                  | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------- | ------- | ------ | -------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| feat-015-factory-extensions-post-mvp        | feature | draft  | P1       | feat/factory-extensions-post-mvp        | Roadmap plans 9-13 (skills-audit auto-author, html-verifier, lessons-agent, register-mcp-build, git-agent alignment). Runs AFTER MVP exit (achieved 2026-04-27 via kanban-webapp-09).                                                                                                                                                                                                                                                    |
| feat-016-post-mvp-catalog-promotion         | feature | draft  | P2       | feat/post-mvp-catalog-promotion         | Standardize post-mvp-scaffolding/ frontmatter + ship /post-mvp-review skill + run first 30-day cadence. Catalogs 17 deferred items; promotes triggered ones.                                                                                                                                                                                                                                                                             |
| feat-021-pm-agent-availability-and-requests | feature | draft  | P2       | feat/pm-agent-availability-and-requests | Build the PM-side awareness + agent-change-request mechanism analogous to existing kit-change-request pattern. Phase A: PM reads `.claude/agents/` to know shipped set + falls back / emits requests for gaps. Phase B: `AgentChangeRequest` zod schema + `docs/agent-requests/<name>.md` emit format. Phase C: orchestrator pre-Mode-B agent-fulfilment dispatch. Phase D: ship `agent-expert` (scaffolding/26-039) with author-new-agent capability. |
| feat-025-flow-spec-execution                | feature       | draft       | P0       | feat/flow-spec-execution                | Phase 2 of feat-022: actually EXECUTE the synthesized Playwright flow specs (v1 only generated them). Spawn dev server via visual-review-preflight harness → run `playwright test e2e/synthesized/` → parse JSON reporter → file bug plans per failed flow → tear down. Plus Phase 1 Playwright install-discipline (kanban-10 finding: tester writes specs but never installs @playwright/test). Soft-gate for v1.                                                                  |
| investigate-008-build-to-spec-verify-not-firing | investigation | completed   | P1       | -                                       | Why didn't /build-to-spec-verify auto-run on kanban-webapp-10 resume? Two real bugs: (1) cli-runner.ts builds graphCtx without forwarding factoryRoot → verify wrapper falls back to process.cwd() (orchestrator package dir) → spawn fails silently; (2) cli-runner only logs completed/failed/totalCost, never surfaces result.status or result.verify → verify failures invisible. Both fixed in bug-017 (one-line + log additions).                                          |
| bug-017-verify-wiring-and-surfacing         | bug           | completed-inline | P1   | -                                       | factoryRoot threading + verify-result surfacing in cli-runner. Found by investigate-008. Fixed inline 2026-04-27 — applied directly without separate plan file (one-line + log additions).                                                                                                                                                                                                                                                                                  |
| bug-016-pre-flight-snapshot-race            | bug     | in-progress  | P1       | fix/pre-flight-snapshot-race            | bug-008/009's pre-flight snapshot has TOCTOU race: with --max-concurrent>=2, two close-features both observe dirty state, race-winner commits, race-loser's commit fails with "nothing to commit" → misclassified as merge-conflict → wasted resolve-conflict-handoff dispatch (~$1-2 per feature). Observed every close-feature on kanban-webapp-10 resume (5 features in flight). Fix Phase 1: distinguish race-loss from real failure + fall through to merge.      |

<!--
ARCHIVED 2026-04-27 (post-MVP-exit cleanup + ongoing):

Bugs (validated by kanban-webapp-09 clean 10/10 autonomous run):
- bug-002 worktree-missing-hooks-perms
- bug-003 builder-output-contract-mismatch
- bug-004 agent-output-format-schema
- bug-005 windows-quoting-and-default-branch
- bug-006 greedy-json-extractor (→ superseded by bug-007 in plans/superseded/)
- bug-007 robust-output-extraction
- bug-008 close-feature-dirty-root
- bug-009 checkout-feature-snapshot
- bug-010 graceful-skip-unknown-agent
- bug-011 ship-security-agent
- bug-012 lockfile-aware-conflict-resolution
- bug-013 feature-context-gitignore
- bug-015 parallel-feature-source-contention (3 phases)

Investigations (recommendations implemented):
- investigate-004 agent-shipped-vs-task-gap → bug-010 + bug-011
- investigate-005 gitignore-audit → bug-014 (folded into bug-013 + .gitignore)
- investigate-006 build-to-spec-verification → feat-022 + feat-023
- investigate-007 orchestrator-liveness-and-pause → feat-024

Features (validated by kanban-09 end-to-end + the spec-verification suite + pause/resume landing):
- feat-014 mvp-completion-autonomous-e2e — MVP EXIT ACHIEVED (10/10 features, $45.03)
- feat-017 auth-provider-config — claude-max-subscription default working
- feat-018 mode-b-commit-discipline — auto-commit per task working
- feat-019 builder-install-discipline — pnpm install on package.json change working
- feat-022 build-to-spec-verification — post-Mode-B reachability + flow-E2E synth + auto-bug-plans
- feat-023 pm-stage-brief-coverage-assertion — PM gate on silent capability drops
- feat-024 orchestrator-pause-resume — SDK-native AbortController + keepalive watcher + /pause-build + /resume-build (614 tests passing)
-->
