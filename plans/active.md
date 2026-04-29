# Active Plans

<!-- AUTO-GENERATED MANIFEST — Updated by /plan-status and /plan-archive skills.
     Each entry: ID | Type | Status | Priority | Branch | Summary -->

| ID                                          | Type    | Status | Priority | Branch                                  | Summary                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------- | ------- | ------ | -------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| feat-015-factory-extensions-post-mvp        | feature | draft  | P1       | feat/factory-extensions-post-mvp        | Roadmap plans 9-13 (skills-audit auto-author, html-verifier, lessons-agent, register-mcp-build, git-agent alignment).                                                                                                                                                                                                                                                                         |
| feat-016-post-mvp-catalog-promotion         | feature | draft  | P2       | feat/post-mvp-catalog-promotion         | Standardize post-mvp-scaffolding/ frontmatter + ship /post-mvp-review skill + run first 30-day cadence.                                                                                                                                                                                                                                                                                       |
| feat-021-pm-agent-availability-and-requests | feature | draft  | P2       | feat/pm-agent-availability-and-requests | PM-side awareness + agent-change-request mechanism (analogous to kit-change-request). Phase A: PM reads `.claude/agents/`. Phase B: AgentChangeRequest schema. Phase C: orchestrator pre-Mode-B agent-fulfilment. Phase D: ship `agent-expert` with author-new-agent capability.                                                                                                              |
| feat-034-devops-agent                       | feature | draft  | P1       | feat/devops-agent                       | Ship `.claude/agents/devops.md` + 3 deploy stack skills (github-actions, vercel, fly-io) + models.yaml entry + PM/architect awareness. Closes the gap surfaced live on repo-health-dashboard-01: PM recruited `devops` but factory shipped no such agent → 4 tasks silently skipped.                                                                                                          |
| bug-023-vitest-config-merge-thrash          | bug     | draft  | P1       | bug/vitest-config-merge-thrash          | apps/web/vitest.config.ts gets gratuitously touched by web frontend builders + testers (current globs already auto-discover all tests; no functional reason to modify). Causes merge conflicts on parallel close-features, costs ~$0.50-1.00 + 3-5min/conflict via reviewer-mediated resolution. Fix: stack-skill §Files-NOT-to-modify + agent prompt guards + scaffold-owned comment header. |

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

ARCHIVED 2026-04-28 (PauseSignal propagation; commit 88c5b32):
- bug-022 pause-signal-swallowed-in-sdk-hooks (P0, success) — runLlmAgent's SDK hook catches (rate-limit / auth-failed / stall) plus the outer for-await catch swallowed PauseSignal, causing the agent to complete past the pause + the next iteration's poll to overwrite the original cause. Fix: re-throw PauseSignal from each catch (4 sites). Discovered while resuming repo-health-dashboard-01 — bug-021 fix worked correctly + revealed bug-022 as the next blocker. 555 orchestrator + 344 contracts passing (+3 tests).

ARCHIVED 2026-04-29 (rate-limit observability + prompt caching; commits c4e6c0f / 8b8351d / 1c05176 / fd71257):
- investigate-010 rate-limit-observability-and-reduction → feat-030 + feat-031
- feat-030 quota-observability (P1, success) — /quota-status skill + 1-token SDK probe (Haiku/Sonnet/Opus via --model or --all) + rate-limit-events.ndjson ledger + warning-vs-rejection gate split + per-model cost/cache breakdown in counters.json. 555 → 567 tests (+11). Live-validated via repo-health-dashboard-01 resume — first reviewer dispatch wrote rate_limit_event{status:allowed} to the ledger within 30s.
- feat-031 prompt-cache-systemprompt (P2, partial) — buildAgentOptions now passes `systemPrompt: { type: 'preset', preset: 'claude_code', excludeDynamicSections: true }`. Cacheable prefix cross-agent. Estimated 30-50% input-token cut on dispatches 2-N. Plan's elaborate buildSystemPromptArray() helper unnecessary — agents read SKILL.md via tools at runtime, not pre-loaded. A/B validation deferred; first post-feat-031 Mode B run will surface cache-hit ratio automatically via feat-030 §D modelBreakdown.cacheReadInputTokens.

ARCHIVED 2026-04-29 (DAG observability + idea bucket; commits ae0d19f / 33974be / 0dd2446):
- feat-032 dag-status-skill (P2, success) — /dag-status skill renders the feature DAG with state markers ([DONE]/[FLOW]/[NEXT]/[WAIT]/[FAIL]/[ABRT]) + per-feature dependency edges + cumulative spend + per-model cost+cache-hit breakdown. Live-validated against repo-health-dashboard-01 mid-run. Phase B ETA forecast deferred (needs ≥3 historical runs).
- feat-033 idea-bucket (P2, success) — /idea + /idea-list + /idea-promote skills for lightweight capture of half-baked thoughts to docs/ideas.md. Pure declarative SKILL.md (no helper scripts). Phase D periodic-review nudge deferred until empirical signal of stale-pile accumulation.

ARCHIVED 2026-04-29 (Mode B wall-clock investigation; commit 60c298e):
- investigate-011 mode-b-wall-clock-reduction (P1, success) — research-only. Identified concurrency cap default 4 (matches observed fan-out), agent_sequence is strict-serial loop (security+tester COULD parallelize on read-only access), all-tasks-bundle-into-one-builder-dispatch with no parallel-tool-use guidance, no per-task model override schema field, feat-019 pnpm install heuristic already short-circuiting correctly. Top 3 recommended levers (combined ~30-45% wall-clock reduction): (1) per-task parallelism via prompt + SKILL.md guidance for parallel tool_use; (2) Promise.all of read-only tester+security; (3) per-task model tiering for mechanical work (scaffold, gha-ci, deploy-config) → Haiku. Cache-warmup, pnpm-symlink, reviewer-fast-pass, speculative-merge all deferred (low payoff or high risk). Recommendation-implemented-by: feat-035 + feat-036 + feat-037 (to be authored).

ARCHIVED 2026-04-28 (resume-path correctness + schema-sync; commits 3561240 / afb7dee / f73e5f0):
- bug-021 checkout-feature-no-worktree-reuse (P0) — orchestrator's runFeature unconditionally dispatched checkout-feature on resume, hard-failing with stale-worktree. Three-gap fix: (1) createProgressTracker(seedSnapshot) hydrates inFlight[] from disk; (2) cli-runner --resume-feature-graph reads feature-graph-progress.json + threads through ctx.seedProgress; (3) runFeature detects in-flight, skips checkout, walks from nextAgent. +8 tests; 552 orchestrator + 344 contracts passing.
- bug-020 recovery-discards-completed-builder-work (P1) — replaced /resume-build SKILL.md §7 dirty-builder soft-reset with universal commit-and-advance; classes split by nextAgent (dirty-advance / dirty-final). Operator note covers the rare mid-execution edge case. Layer 3 timestamp work deferred. Outcome: partial (Layer 1 ships now; Layer 3 follow-up bug if needed).
- bug-019 new-project-force-schema-sync (P1) — authored scripts/sync-project-schemas.mjs; wired into /new-project --force step 5a (BOTH init + refresh modes). Idempotent byte-compare; --dry-run + --all flags. pm SKILL.md §0 cross-refs the script as the right answer to "field missing from schema". Synced all 12 projects on 2026-04-28.
-->
