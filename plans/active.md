# Active Plans

<!-- AUTO-GENERATED MANIFEST — Updated by /plan-status and /plan-archive skills.
     Each entry: ID | Type | Status | Priority | Branch | Summary -->

| ID                                               | Type    | Status | Priority | Branch                                       | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------ | ------- | ------ | -------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| feat-015-factory-extensions-post-mvp             | feature | draft  | P1       | feat/factory-extensions-post-mvp             | Roadmap plans 9-13 (skills-audit auto-author, html-verifier, lessons-agent, register-mcp-build, git-agent alignment).                                                                                                                                                                                                                                                                                                                                                                                                                        |
| feat-016-post-mvp-catalog-promotion              | feature | draft  | P2       | feat/post-mvp-catalog-promotion              | Standardize post-mvp-scaffolding/ frontmatter + ship /post-mvp-review skill + run first 30-day cadence.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| feat-021-pm-agent-availability-and-requests      | feature | draft  | P2       | feat/pm-agent-availability-and-requests      | PM-side awareness + agent-change-request mechanism (analogous to kit-change-request). Phase A: PM reads `.claude/agents/`. Phase B: AgentChangeRequest schema. Phase C: orchestrator pre-Mode-B agent-fulfilment. Phase D: ship `agent-expert` with author-new-agent capability.                                                                                                                                                                                                                                                             |
| bug-019-new-project-force-schema-sync            | bug     | draft  | P1       | fix/new-project-force-schema-sync            | Spawned by bug-018. `/new-project --force` does not propagate factory `schemas/*.schema.json` updates to existing `projects/<name>/schemas/`. All 4 pre-builds had stale `feature.schema.json` (missing `affects_files` from bug-015 Phase 2). Fix: add schemas/ to the `--force` overlay list + ship `scripts/sync-project-schemas.mjs` for ad-hoc resync; audit other project-resident factory artifacts for the same drift class.                                                                                                         |
| bug-020-recovery-discards-completed-builder-work | bug     | draft  | P1       | fix/recovery-discards-completed-builder-work | `/resume-build` recovery decision tree's `dirty-builder` rule wipes completed builder work when the orchestrator paused AFTER builder return but BEFORE its commit fired. Hit empirically on repo-health-dashboard-01 (2300 LOC of FastAPI scaffold + TS client) — operator manually committed before resume to avoid the soft-reset. Fix: discriminate on `(lastAgent, nextAgent)` tuple — dirty + lastAgent !== nextAgent → commit + advance (Layer 1); per-agent commit sentinel between builder return and nextAgent dispatch (Layer 2). |

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

ARCHIVED 2026-04-28 (verifier suite expansion; commits 9622ad3 + ce00f41):
- feat-027 runtime-error-capture — Playwright runtime listeners + cascade-root bug routing + bugPriorityComparator promotion; 4 phases shipped in single agent pass
- feat-028 visual-parity-verifier — DOM-diff via data-kit-* + computed-style audit; 7-pattern classifier; one bug per (screen, pattern). Gap-fix folded into feat-029
- feat-029 screen-state-fixtures — closes feat-028 empty-app blind spot; hybrid auto-derive (Pattern A) + flow-context (Pattern B) fixture system + dev-only seed-from-URL helper + parity-verify SKILL.md gap closed
- Combined: 693 → 888 tests (+195)

ARCHIVED 2026-04-28 (PM affects_files; commit ffeac54 + project-side syncs):
- bug-018 pm-skips-affects-files — original framing was "PM confabulation" but empirical follow-up revealed the load-bearing root cause is factory→project schema drift. SKILL.md §0 + step 4b strengthening shipped (PMs now resync schema or file a bug instead of silently skipping); both re-PM agents (finance-track, kanban-webapp) achieved 100% affects_files coverage on retry. Spawned bug-019 for the underlying schema-sync mechanism.
-->
