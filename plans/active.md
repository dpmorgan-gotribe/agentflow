# Active Plans

<!-- AUTO-GENERATED MANIFEST — Updated by /plan-status and /plan-archive skills.
     Each entry: ID | Type | Status | Priority | Branch | Summary -->

| ID                                          | Type    | Status      | Priority | Branch                                  | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------- | ------- | ----------- | -------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| feat-015-factory-extensions-post-mvp        | feature | draft       | P1       | feat/factory-extensions-post-mvp        | Roadmap plans 9-13 (skills-audit auto-author, html-verifier, lessons-agent, register-mcp-build, git-agent alignment).                                                                                                                                                                                                                                                                                                                                                                                                                              |
| feat-016-post-mvp-catalog-promotion         | feature | draft       | P2       | feat/post-mvp-catalog-promotion         | Standardize post-mvp-scaffolding/ frontmatter + ship /post-mvp-review skill + run first 30-day cadence.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| feat-021-pm-agent-availability-and-requests | feature | draft       | P2       | feat/pm-agent-availability-and-requests | PM-side awareness + agent-change-request mechanism (analogous to kit-change-request). Phase A: PM reads `.claude/agents/`. Phase B: AgentChangeRequest schema. Phase C: orchestrator pre-Mode-B agent-fulfilment. Phase D: ship `agent-expert` with author-new-agent capability.                                                                                                                                                                                                                                                                   |
| feat-026-automated-bug-fix-loop             | feature | in-progress | P0       | feat/automated-bug-fix-loop             | After /build-to-spec-verify produces bugs, orchestrator AUTO-invokes a fix-loop: dispatch agents per bug → re-run verify → if new bugs surface, iterate. Loop continues until 0 bugs OR iteration cap (default 5) OR per-bug attempt cap (3). New `docs/bugs.yaml` schema (analog of tasks.yaml) populated by verifier; SEPARATE from /plan-bug (which stays user-only). Single shared fixup worktree. Closes the verify→fix→verify→ship loop entirely autonomously.                                                                               |
| feat-027-runtime-error-capture              | feature | draft       | P0       | feat/runtime-error-capture              | Today's verifier is BLIND to console errors, page errors, network failures, and dev-server compile errors — exactly the bug class that most often blocks an app from rendering at all. Wires Playwright's `page.on("console")` / `page.on("pageerror")` / `page.on("requestfailed")` listeners into synthesized specs; extracts attachments via the runner; auto-files dedicated `runtime-error` bugs that feat-026 routes FIRST in iteration ordering (with `dependsOn` tagging on cascading flow timeouts). Surfaced today by kanban-10 CSS bug. |
| investigate-009-built-vs-designed-visual-parity | investigation | draft  | P0       | -                                       | Kanban-10 manual inspection shows substantial visual divergence between built app + designed mockups; NO current verifier stage catches it. investigate-006 deferred screenshot-diff as "high cost / low marginal catch" — kanban-10 invalidates that. 60-min time box. Survey 3 v1 options (DOM-diff via `data-kit-*` attrs / token-CSS audit / pixel-diff via Pixelmatch) + industry precedent (Chromatic, Percy, Playwright `toHaveScreenshot`). Recommend primary mechanism for `feat-028-visual-parity-verifier`. |

<!--
ARCHIVED 2026-04-27:

Bugs (validated by kanban-webapp-09 + -10 runs):
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
- bug-016 pre-flight-snapshot-race (TOCTOU race in concurrent close-feature)
- bug-017 verify-wiring-and-surfacing (factoryRoot + cli-runner result.verify) — completed inline

Investigations (recommendations implemented):
- investigate-004 agent-shipped-vs-task-gap → bug-010 + bug-011
- investigate-005 gitignore-audit → bug-014 (folded into bug-013 + .gitignore)
- investigate-006 build-to-spec-verification → feat-022 + feat-023
- investigate-007 orchestrator-liveness-and-pause → feat-024
- investigate-008 build-to-spec-verify-not-firing → bug-017 (factoryRoot + result.verify surfacing)

Features (validated by kanban-09/10 end-to-end):
- feat-014 mvp-completion-autonomous-e2e — MVP EXIT ACHIEVED (10/10 features, $45.03 on -09)
- feat-017 auth-provider-config — claude-max-subscription default working
- feat-018 mode-b-commit-discipline — auto-commit per task working
- feat-019 builder-install-discipline — pnpm install on package.json change working
- feat-022 build-to-spec-verification — post-Mode-B reachability + flow-E2E synth + auto-bug-plans
- feat-023 pm-stage-brief-coverage-assertion — PM gate on silent capability drops
- feat-024 orchestrator-pause-resume — SDK AbortController + keepalive watcher + /pause-build + /resume-build
- feat-025 flow-spec-execution — Phase 2 of feat-022 (actual spec execution + Playwright install-discipline + bug-plan auto-author); 644 tests passing
-->
