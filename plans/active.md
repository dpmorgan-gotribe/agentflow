# Active Plans

<!-- AUTO-GENERATED MANIFEST — Updated by /plan-status and /plan-archive skills.
     Each entry: ID | Type | Status | Priority | Branch | Summary -->

| ID                                          | Type    | Status      | Priority | Branch                                  | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------- | ------- | ----------- | -------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| feat-015-factory-extensions-post-mvp        | feature | draft       | P1       | feat/factory-extensions-post-mvp        | Roadmap plans 9-13 (skills-audit auto-author, html-verifier, lessons-agent, register-mcp-build, git-agent alignment).                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| feat-016-post-mvp-catalog-promotion         | feature | draft       | P2       | feat/post-mvp-catalog-promotion         | Standardize post-mvp-scaffolding/ frontmatter + ship /post-mvp-review skill + run first 30-day cadence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| feat-021-pm-agent-availability-and-requests | feature | draft       | P2       | feat/pm-agent-availability-and-requests | PM-side awareness + agent-change-request mechanism (analogous to kit-change-request). Phase A: PM reads `.claude/agents/`. Phase B: AgentChangeRequest schema. Phase C: orchestrator pre-Mode-B agent-fulfilment. Phase D: ship `agent-expert` with author-new-agent capability.                                                                                                                                                                                                                                                                                                      |
| feat-027-runtime-error-capture              | feature | in-progress | P0       | feat/runtime-error-capture              | Verifier is BLIND to console errors, page errors, network failures, dev-server compile errors. Wires Playwright's `page.on("console")` / `page.on("pageerror")` / `page.on("requestfailed")` listeners into synthesized specs; extracts attachments via runner; auto-files dedicated `runtime-error` bugs feat-026 routes FIRST. Surfaced by kanban-10 CSS / fonts / Zustand bugs.                                                                                                                                                                                                    |
| feat-028-visual-parity-verifier             | feature | in-progress | P0       | feat/visual-parity-verifier             | Per investigate-009: 14/15 visual divergences ship green through every existing+planned verifier (dominant: shell-stripping). Structural DOM-diff via `data-kit-*` attribute trees + computed-style audit. 5 phases: (0) ui-kit primitives forward `data-kit-*` props (~30 LOC); (1) builder-skill translation pass-through; (2) ParityVerify zod schema + bugs.yaml `visual-parity` source; (3) `diff-kit-skeleton.mjs` + `audit-computed-styles.mjs`; (4) orchestrator chain + bug auto-author per (screen, pattern) cluster. Pixel-diff explicitly deferred with cutover criteria. |
| feat-029-screen-state-fixtures              | feature | draft       | P0       | feat/screen-state-fixtures              | Closes feat-028's blind spot: built app starts EMPTY but mockups show POPULATED state — DOM-diff would scream "everything missing". Hybrid fixture system: Pattern A auto-derives `<id>.fixture.json` from mockup HTML (parses `[data-kit-component="Card"]` etc.); Pattern B flow-context for dynamic screens (search-empty); dev-only `__seedFromUrl` helper applies fixture via `?_seed=<id>` query param. feat-028's differ navigates to seeded URL before snapshotting. 5 phases: schema → auto-derive → seed helper → flow-context fallback → differ integration.               |

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
