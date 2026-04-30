# Active Plans

<!-- AUTO-GENERATED MANIFEST — Updated by /plan-status and /plan-archive skills.
     Each entry: ID | Type | Status | Priority | Branch | Summary -->

| ID                                                   | Type    | Status | Priority | Branch                                           | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------- | ------- | ------ | -------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| feat-015-factory-extensions-post-mvp                 | feature | draft  | P1       | feat/factory-extensions-post-mvp                 | Roadmap plans 9-13 (skills-audit auto-author, html-verifier, lessons-agent, register-mcp-build, git-agent alignment).                                                                                                                                                                                                                                                                                                                               |
| feat-016-post-mvp-catalog-promotion                  | feature | draft  | P2       | feat/post-mvp-catalog-promotion                  | Standardize post-mvp-scaffolding/ frontmatter + ship /post-mvp-review skill + run first 30-day cadence.                                                                                                                                                                                                                                                                                                                                             |
| feat-021-pm-agent-availability-and-requests          | feature | draft  | P2       | feat/pm-agent-availability-and-requests          | PM-side awareness + agent-change-request mechanism (analogous to kit-change-request). Phase A: PM reads `.claude/agents/`. Phase B: AgentChangeRequest schema. Phase C: orchestrator pre-Mode-B agent-fulfilment. Phase D: ship `agent-expert` with author-new-agent capability.                                                                                                                                                                    |
| feat-034-devops-agent                                | feature | draft  | P1       | feat/devops-agent                                | Ship `.claude/agents/devops.md` + 3 deploy stack skills (github-actions, vercel, fly-io) + models.yaml entry + PM/architect awareness. Closes the gap surfaced live on repo-health-dashboard-01: PM recruited `devops` but factory shipped no such agent → 4 tasks silently skipped.                                                                                                                                                                |
| feat-037-audit-reachability-ts-aware-rewrite         | feature | draft  | P2       | feat/audit-reachability-ts-aware-rewrite         | Replace regex-based `audit-app-reachability.mjs` with TS Compiler API or dependency-cruiser. Closes 5 structural gaps bug-030 Phase A patched surgically. Parent: bug-030.                                                                                                                                                                                                                                                                          |
| feat-038-deepen-synthesize-flow-e2e-and-data-seeding | feature | draft  | P0       | feat/deepen-synthesize-flow-e2e-and-data-seeding | Generated flows (`flow-N.spec.ts`) only do `page.goto(/)` — they don't fill forms, click submit, or assert on responses. Phase 0 investigates per-test-reseed vs shared-baseline vs hybrid; Phase 1 adds structured `steps[]` schema to user-flows-manifest; Phase 2 deepens synthesizer; Phase 3 updates `/user-flows-generator` to author steps; Phase 5 ships fixture-based regression harness. With bug-032, would have caught the 404 cleanly. |

<!--
ARCHIVED 2026-04-30 (sync-project-schemas extension, post-feat-038-Phase-2B):
- refactor-008 sync-project-schemas-rules-templates (P2, success) — extended scripts/sync-project-schemas.mjs to cover .claude/rules/ + .claude/templates/ via a recursive walker + 2 new SYNC_PAIRS entries + mkdirSync guard for nested file parents. Closes the manual factory→project copy tax (30 manual `cp` invocations this session alone). Single attempt; validated via dry-run against book-swap-pre-build (in-lockstep, 41 unchanged) + reverse-drift on kanban-webapp-09 (1 update + 18 creates including 5 nested ui-kit-eslint-plugin/ files preserved). Live --all run synced 12 projects. 568/568 orchestrator tests still pass.

ARCHIVED 2026-04-30 (Zod v4 typing migration, post-feat-038-Phase-1):
- refactor-007 zod-infer-types-tests (P2, success) — migrated 4 orchestrator-contracts test files (bugs-yaml / build-to-spec-verify / parity-verify / screen-fixtures) from `typeof Schema._type` (Zod v3) to `z.infer<typeof Schema>` (Zod v4). 15 occurrences, single attempt, mechanical. Closed the typecheck-red / tests-green split (vitest masks tsc errors via esbuild). 568/568 orchestrator + 398/398 contracts tests still pass.

ARCHIVED 2026-04-30 (verify+fix-loop end-to-end on repo-health-dashboard-01):
- bug-030 audit-reachability-false-positive-flood (P1, success) — Phase A surgical fixes to `audit-app-reachability.mjs`: drop `packages/` from SCAN_ROOTS, prepend `apps/web` to `@/` alias roots, extend `IMPORT_RE` for `export … from`. Empirical false-positive count 62 → 0 on repo-health-dashboard-01; regression-tested with synthetic orphan. Structural follow-up filed as feat-037 (TS-aware rewrite).
- bug-031 fix-loop-fixup-worktree-not-seeded (P0, success) — Phases A+B+D shipped: exported `seedWorktree` from invoke-agent.ts, `openFixupWorktree` now invokes it after `git worktree add` and re-runs idempotently on pre-existing worktrees, regression test asserting hooks + autonomous `permissions.allow` post-conditions. 568/568 orchestrator tests pass. Empirically validated on repo-health-dashboard-01: 2 parity bugs resolved through full builder→tester→reviewer chain in 1 attempt each.
- bug-032 api-base-url-not-coordinated-with-backend-port (P0, success) — Phases A+B+C shipped. Phase A: per-project `.env.example` files; Phase B: `scripts/dev.mjs` port-coordinated dev orchestrator (smoke-tested through 4 iterations of fixes); Phase C: factory-level — `dev-server.ts` co-boots backend during verify auto-boot, architect skill scaffolds env contract + `dev-multi-tier.mjs.template`, python-fastapi + react-next stack skills declare env contract as canonical. Phase D (synth-flow baseURL signal) deferred to feat-038. 568/568 orchestrator tests still pass.

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

ARCHIVED 2026-04-29 (live repo-health-dashboard-01 cycle — Phase B parity-verify + 7 bugs + 1 feat; multiple commits):
- feat-035 visual-parity-v2-built-page-render (P1, success) — Phase B Playwright driver shipped; standalone CLI added; live-validated. See plans/archive/feat-035-*.md for the deferred items per §Non-goals.
- bug-023 vitest-config-merge-thrash (P1, success) — three-layer scaffold-owned protection: stack-skill §Files NOT to modify, web-frontend-builder §Hard rules guard, SCAFFOLD-OWNED comment header on initial scaffold.
- bug-024 tester-modifies-source (P1, success) — three-layer hard constraint: tester.md §Hard constraint, testing-policy.md §Genuine product bug — CONSTRAINT, tester SKILL.md mirror. Empirically validated on the run that motivated it.
- bug-025 cross-feature-url-contract (P1, success) — four-layer URL contract: schemas/screens.schema.json `routePattern` field, react-next + svelte-kit §2.5 Routing Contract, web-frontend-builder §Hard rules nav-URL guard, PM SKILL.md §2c surfacer.
- bug-026 api-client-import-extensions (P1, success) — three-layer cross-tier package conventions: project hotfix dropping `.js` extensions, back-end stack-skills §6.5 Cross-tier package conventions, web-frontend-builder §Hard rules flag-don't-fix note.
- bug-027 fix-bugs-loop-auto-merge-fails (P1, success) — closeFixupWorktree reorder (remove worktree before merge) + surface warning instead of silent catch{}.
- bug-028 audit-reachability-misses-router-push (P1, success) — recursive dynamic-segment strip for template-literal matching + SCAN_ROOTS expansion (apps/web/components, apps/web/lib, packages/* now scanned). Validated 3 false-positive orphans → 0.
- bug-029 ui-kit-primitives-missing-data-kit-component (P1, partial) — Phase A (/stylesheet auto-retrofit on new projects) + Phase D (web-frontend-builder defensive flag-don't-fix note) shipped. Phases B (bulk retrofit script) + C (visual-parity bug-fix loop routing) deferred.

ARCHIVED 2026-04-29 (Mode B wall-clock investigation; commit 60c298e):
- investigate-011 mode-b-wall-clock-reduction (P1, success) — research-only. Identified concurrency cap default 4 (matches observed fan-out), agent_sequence is strict-serial loop (security+tester COULD parallelize on read-only access), all-tasks-bundle-into-one-builder-dispatch with no parallel-tool-use guidance, no per-task model override schema field, feat-019 pnpm install heuristic already short-circuiting correctly. Top 3 recommended levers (combined ~30-45% wall-clock reduction): (1) per-task parallelism via prompt + SKILL.md guidance for parallel tool_use; (2) Promise.all of read-only tester+security; (3) per-task model tiering for mechanical work (scaffold, gha-ci, deploy-config) → Haiku. Cache-warmup, pnpm-symlink, reviewer-fast-pass, speculative-merge all deferred (low payoff or high risk). Recommendation-implemented-by: feat-035 + feat-036 + feat-037 (to be authored).

ARCHIVED 2026-04-28 (resume-path correctness + schema-sync; commits 3561240 / afb7dee / f73e5f0):
- bug-021 checkout-feature-no-worktree-reuse (P0) — orchestrator's runFeature unconditionally dispatched checkout-feature on resume, hard-failing with stale-worktree. Three-gap fix: (1) createProgressTracker(seedSnapshot) hydrates inFlight[] from disk; (2) cli-runner --resume-feature-graph reads feature-graph-progress.json + threads through ctx.seedProgress; (3) runFeature detects in-flight, skips checkout, walks from nextAgent. +8 tests; 552 orchestrator + 344 contracts passing.
- bug-020 recovery-discards-completed-builder-work (P1) — replaced /resume-build SKILL.md §7 dirty-builder soft-reset with universal commit-and-advance; classes split by nextAgent (dirty-advance / dirty-final). Operator note covers the rare mid-execution edge case. Layer 3 timestamp work deferred. Outcome: partial (Layer 1 ships now; Layer 3 follow-up bug if needed).
- bug-019 new-project-force-schema-sync (P1) — authored scripts/sync-project-schemas.mjs; wired into /new-project --force step 5a (BOTH init + refresh modes). Idempotent byte-compare; --dry-run + --all flags. pm SKILL.md §0 cross-refs the script as the right answer to "field missing from schema". Synced all 12 projects on 2026-04-28.
-->
