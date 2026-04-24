---
id: feat-014-mvp-completion-autonomous-e2e
type: feature
status: draft
author-agent: claude-opus-4-7
created: 2026-04-24
updated: 2026-04-24
parent-plan: investigate-002-build-tier-readiness-gap
supersedes: null
superseded-by: null
branch: feat/mvp-completion-autonomous-e2e
affected-files:
  # Phase 1 — CLI wire-up + default InvokeAgentFn (closes task-035 remaining gap)
  - orchestrator/src/cli-runner.ts
  - orchestrator/src/invoke-agent.ts # new file
  - orchestrator/tests/invoke-agent.test.ts # new file
  - orchestrator/tests/cli-runner.test.ts
  # Phase 2 — gates 1 + 3 + 6 file-drop contracts (closes task-036 remaining gap)
  - orchestrator/src/gate-server-lifecycle.ts
  - .claude/skills/analyze/SKILL.md
  - .claude/skills/stylesheet/SKILL.md
  - .claude/skills/git-agent/SKILL.md
  - orchestrator/tests/gate-server-lifecycle.test.ts
  # Phase 3 — vendor stack skills for revolution-pictures's architecture
  - .claude/skills/agents/vendor/sanity-studio/SKILL.md # new
  - .claude/skills/agents/vendor/next-sanity/SKILL.md # new
  - .claude/skills/agents/vendor/mux-player-react/SKILL.md # new
  - .claude/skills/agents/vendor/resend-transactional/SKILL.md # new
  - .claude/skills/agents/vendor/react-email/SKILL.md # new
  - .claude/skills/agents/vendor/plausible-analytics/SKILL.md # new
  - .claude/skills/agents/vendor/calcom-embed/SKILL.md # new
  - .claude/skills/agents/vendor/turnstile-widget/SKILL.md # new
  # Phase 4 — validation + archive
  - docs/mvp-completion-report.md # new
  - docs/build-tier-roadmap.md # update with MVP-done marker
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-014 — MVP completion: close remaining gaps for autonomous end-to-end run

## Problem Statement

`docs/build-tier-roadmap.md` (2026-04-22) named 8 critical-path plans + 4 must-have acceptance criteria to reach the MVP goal: "autonomous generation of shippable apps from a brief with little-to-no human interaction." As of 2026-04-24, **all 8 plans are archived as `completed`** (task-035, task-036, refactor-005, feat-005 through feat-009). The factory's design tier was validated end-to-end on three projects (mindapp-v2 → hatch-2 → revolution-pictures); the build tier was smoke-tested today via a hand-dispatched `feat-project-bootstrap` against revolution-pictures, producing a clean Next.js 15 consumer of `@repo/ui-kit`.

Despite the roadmap's nominal completion, **three real gaps stand between current factory state and a clean autonomous end-to-end run for a new project**:

1. **CLI live-run stub** (`orchestrator/src/cli-runner.ts:128-137`). The CLI currently returns exit 1 with "Live run is not yet wired. See task-035 Phase 9 + downstream feat-005, feat-006 plans." `runStage` is wired to Agent SDK `query()` via `stage-runner.ts:7,68`, and `runPipeline` / `runFeatureGraph` both exist and are tested with injected stubs — but the CLI doesn't connect those entry points to the real Agent SDK. Running `pnpm --filter orchestrator start generate <project>` outside of `--dry-run` hits this stub and exits.

2. **No default `InvokeAgentFn`** for Mode B. `feature-graph.ts:54` declares the type; `feature-graph.test.ts` supplies test stubs; but no real production factory wraps the Agent SDK `query()` to dispatch builder / tester / reviewer / git-agent by name with per-agent frontmatter, mcp_servers, and CWD (the feature's worktree path). Without it, Mode B cannot actually run even if the CLI wire-up (gap 1) lands.

3. **Vendor stack skills missing** for the 8 integrations revolution-pictures's architect picked: `sanity-studio`, `next-sanity`, `mux-player-react`, `resend-transactional`, `react-email`, `plausible-analytics`, `calcom-embed`, `turnstile-widget`. `.claude/architecture.yaml.tooling.skills.build[]` names them; `.claude/skills/agents/vendor/<slug>/SKILL.md` doesn't exist for any of them. Without grounded skills, the builder agent prompts fall back to raw-LLM knowledge of vendor APIs — error-prone, hallucination-heavy, not reproducible across runs. The archived roadmap implicitly assumed the `/skills-audit --scope=build --auto-author-stack-skills` path would produce these, but that path was explicitly deferred to extension plan 9 (`feat-010-skills-audit-runtime`), and for revolution-pictures's MVP it's faster to hand-author the 8 needed skills than to build the auto-authoring flow first.

A minor sub-gap surfaced during the feat-project-bootstrap smoke test: **gates 1, 3, and 6 have no formal pause mechanism**. `docs/build-tier-roadmap.md` §2 task-036 called them out as "formalize via file-drop pattern mirroring gate 5" and task-036 was marked complete, but a grep of `orchestrator/src/gate-server-lifecycle.ts` shows the file-drop watcher handles gate 5 (`credentials-confirmed.txt`) and gates 2 + 4 (their HTML templates exist), while gates 1 (requirements review), 3 (design-system approval), and 6 (human PR review before merge) are not wired at all. Pipelines that want those checkpoints either skip them silently or rely on the human running stages manually (which is what we did for revolution-pictures's Mode A walk). For full autonomy, they need formal mechanics.

The roadmap's exit criteria (§Exit criteria when is MVP done?) explicitly require a full autonomous run on an actual project to pass with all gate mechanics functional. Today that run would halt at the CLI stub. This feature closes all gaps above, validates end-to-end on revolution-pictures (our most recently-prepared project, which is already through gate 5), and marks MVP complete in the roadmap with a dated exit record.

Reference: `docs/build-tier-roadmap.md` §MVP goal + §Exit criteria; `plans/archive/investigate-002-build-tier-readiness-gap.md` §Integrated gap map.

## Approach

Execute in four phases. Each phase has a concrete definition of done + a validation step before moving to the next.

### Phase 1 — Close the orchestrator live-run gap

Goal: `pnpm --filter orchestrator start generate revolution-pictures` actually runs (instead of returning the stub message).

1. **Create `orchestrator/src/invoke-agent.ts`** with a factory that produces a real `InvokeAgentFn` for Mode B. Mirrors the `stage-runner.ts` pattern:
   - Imports `query as realQuery` from `@anthropic-ai/claude-agent-sdk`
   - Reads per-agent config via `readModelConfig(agentName, projectRoot)` from `model-config.ts`
   - Accepts `GitOpInput | AgentInvocationInput` (the feature-graph.ts discriminated union); routes git-ops to the local `git` CLI (not the Agent SDK — deterministic), routes agent invocations to `query()`
   - Tracks cost via Agent SDK's terminal `SDKResultMessage.total_cost_usd`; passes through to `BudgetTracker.record()`
   - Returns `InvokeAgentResult` shape per the contract in feature-graph.ts:88-100
   - Respects `ctx.flags` (forwards `nanobanana` etc.) + `ctx.gateApiBase` (for agents that dispatch to gate UIs)

2. **Write `orchestrator/tests/invoke-agent.test.ts`** covering:
   - Happy path: agent invocation returns structured output + cost
   - Git-op routing: `op: "bootstrap"` + `op: "checkout-feature"` + `op: "close-feature"` + `op: "resolve-conflict-handoff"` + `op: "emergency-abort"` each shell out to real git commands (mocked via `child_process.exec` stub)
   - Error propagation: Agent SDK error → `InvokeAgentResult.success: false` with `error` populated
   - Cost accounting: `total_cost_usd` from SDK → recorded in a `BudgetTracker` spy

3. **Wire `cli-runner.ts` live path** — replace lines 128-137 with:
   - If `opts.resumeFeatureGraph` is true → call `runFeatureGraph()` with `invokeAgent: createInvokeAgent(budget, modelConfigOverride)`, `waitForPrReviewGate: fileDropWaitForPrReview(...)`, tasks.yaml load from disk, feature DAG walk respecting `depends_on[]`, maxConcurrentFeatures from `modelConfig.orchestration`
   - Else → call `runPipeline()` with `runCtx` (queryFn defaults to realQuery via stage-runner), `waitForGate: fileDropWaitForGate(...)`, `saveContext: realSaveContext(...)`, starting from `resumeStage`
   - Stream progress via `cfg.onStageStart / onStageComplete / onGateOpen / onGateResolve` callbacks into `messages[]`
   - On orchestrator return: compute total cost + summarize + exit 0 (success) or exit 1 (any failed stage / feature / retry exhaust)

4. **Extend `cli-runner.test.ts`** to cover the live path with `queryFn` + `invokeAgent` stubs returning success; assert exit 0 + correct message sequence.

**Phase 1 done when**: `pnpm --filter orchestrator test` passes all suites (existing + new), AND `pnpm --filter orchestrator start generate revolution-pictures --resume-feature-graph --dry-run` reports the same DAG walk as before (no regression), AND `pnpm --filter orchestrator start generate revolution-pictures --resume-feature-graph` (live) runs through the first Mode B wave when `ANTHROPIC_API_KEY` is set — we can abort after wave 1 via budget cap for the validation pass.

### Phase 2 — Formalize gates 1 + 3 + 6 (file-drop mirror of gate 5)

Goal: every pipeline gate has a defined pause + resume mechanic consistent with gate 5.

5. **Extend `orchestrator/src/gate-server-lifecycle.ts`** to handle three new gate types:
   - `gate-1-requirements` — file-watch `projects/<p>/docs/requirements-approved.txt`; body parser accepts `proceed` / `revise:<section-list>` / `abort`
   - `gate-3-design-system` — file-watch `projects/<p>/docs/design-system-approved.txt`; same body shape
   - `gate-6-pr-review` — file-watch `projects/<p>/docs/gate-6-approved.txt`; body `approved` / `changes:<comment>` / `abort`; mid-Mode-B post-reviewer

6. **Update `stages-array.ts`** to set `gateType: "requirements"` on `analyze` and `gateType: "design-system"` on `stylesheet` (both already have `gateEnabled: true`). Confirm `runPipeline` invokes `waitForGate` after stage success.

7. **Update the upstream skills** so they emit a terminal message telling the human what to drop:
   - `.claude/skills/analyze/SKILL.md` — add a §Gate 1 Handoff section: the stage's final report now ends with `Gate 1 pauses. To proceed, write 'proceed' to docs/requirements-approved.txt`. `--revise:<section>` patterns documented.
   - `.claude/skills/stylesheet/SKILL.md` — add §Gate 3 Handoff section with same pattern pointing at `docs/design-system-approved.txt`.
   - `.claude/skills/git-agent/SKILL.md` — add §Gate 6 PR Review; document that `git-agent close-feature` stops short of merging and instead creates a PR, writes `docs/gate-6-opened-<feature>.json` with the PR URL + diff summary, and waits for `gate-6-approved.txt`.

8. **Test gates end-to-end** via `orchestrator/tests/gate-server-lifecycle.test.ts` — each of the three new gate types resolves on file-drop with `proceed`/`approved`, aborts cleanly on `abort`, and the `revise` / `changes` path emits a structured `GateResolution` so the orchestrator can loop back to the upstream stage.

**Phase 2 done when**: All gate types (1, 2, 3, 4, 5, 6) have a file-drop mechanic OR an HTTP-server-backed UI. For MVP the 3 new gates are file-drop-only (consistent with gate 5). Web UI remains a post-MVP polish.

### Phase 3 — Ship 8 vendor stack skills for revolution-pictures

Goal: builder agents dispatched against revolution-pictures have grounded prompts for every vendor SDK in `architecture.yaml.tooling.skills.build[]`.

Per-skill shape (each ~150-250 LOC SKILL.md):

- Frontmatter: `name`, `description`, `when_to_use`, `allowed-tools`, `model: inherit`
- **Install** — `pnpm add` command + version pinning rationale
- **Client setup** — typical init code snippet (server + client variants where applicable)
- **Idiomatic patterns** — 3-5 code patterns for common operations (e.g. for `sanity-studio`: defineSchema, typed GROQ query, reference resolution, image URL builder, preview-mode handoff)
- **Environment variables** — names, where to read (Next.js runtime vs server-only), secrecy class
- **Gotchas** — vendor-specific pitfalls (e.g. Mux Player requires `transpilePackages`, Turnstile needs server-side verify on every form submit, etc.)
- **Testing block** — mock setup pattern for unit tests, integration test idiom, any vendor-specific stubs
- **References** — vendor docs URL + 2-3 relevant Stack Overflow or community pattern links

Skills to author in parallel (invoke 8 subagents via Agent tool, one per skill):

9. `.claude/skills/agents/vendor/sanity-studio/SKILL.md` — schema definition + Studio embed + Structure Builder + Portable Text
10. `.claude/skills/agents/vendor/next-sanity/SKILL.md` — typed client, draftMode + preview, generateStaticParams + ISR, loadQuery helpers, image art-direction via next/image loader
11. `.claude/skills/agents/vendor/mux-player-react/SKILL.md` — `<MuxPlayer>`, poster frame, autoplay-muted-loop pattern, signed URLs, webhook verification
12. `.claude/skills/agents/vendor/resend-transactional/SKILL.md` — `resend.emails.send`, react-email templates, webhook signature verification, rate-limit awareness
13. `.claude/skills/agents/vendor/react-email/SKILL.md` — Email component library, preview server (`pnpm dev` in apps/email), Tailwind integration, dark-mode email caveats
14. `.claude/skills/agents/vendor/plausible-analytics/SKILL.md` — `next-plausible` wrapper, Next.js App Router rewrite for same-origin proxy, custom events, server-side pageview tracking
15. `.claude/skills/agents/vendor/calcom-embed/SKILL.md` — `@calcom/embed-react`, inline vs popup, theming via iframe messaging, webhook signature
16. `.claude/skills/agents/vendor/turnstile-widget/SKILL.md` — `<Turnstile>`, server-side `/siteverify`, form-integration pattern, invisible vs visible modes

**Phase 3 done when**: All 8 files exist + pass `markdownlint` + each contains the 7 required sections (frontmatter, install, client-setup, patterns, env-vars, gotchas, testing). A grep confirms no hex colors or typography tokens baked into the skills (skills are stack-aware but style-agnostic — they consume kit tokens, never define them).

### Phase 4 — Validate end-to-end on revolution-pictures

Goal: produce a successful autonomous Mode B run on revolution-pictures and record the MVP-exit evidence.

17. **Pre-flight** — revolution-pictures main is at `b820b09` with `apps/web` scaffolded via feat-project-bootstrap. Kit is 1.0.1. `docs/tasks.yaml` has 12 features, 46 tasks. Gate 5 is resolved (`docs/credentials-confirmed.txt: proceed`). Only the .env needs real values for vendors we actually want to smoke-test during Mode B.

18. **Populate .env for Mode B validation** — user fills 5 required-now vendors (Sanity, Mux, Resend, Cal.com, Turnstile) with sandbox credentials. Plausible + Vercel Image Optimization can stay empty (required-later).

19. **Run `/start-build revolution-pictures --dry-run`** — should show waves 1-4 feature-graph walk; currently does. This validates that Phase 1's CLI wire-up didn't regress the dry-run path.

20. **Run `/start-build revolution-pictures --max-concurrent=1 --flags=test-mode`** (serial execution for observability). Observe:

- Wave 1: `feat-cms-content-model` runs first (bootstrap already merged). git-agent opens worktree, web-frontend-builder dispatches against sanity-studio + next-sanity skills.
- If Wave 1 completes cleanly and merges to main — MVP exit criterion met.
- Budget cap aborts run after ~$10 spent (safety rail; configure `perPipelineMaxUsd: 10` in test project's `.claude/models.yaml`).

21. **Capture evidence** into `docs/mvp-completion-report.md`:

- Timestamp of run, total duration, total cost
- Per-feature outcome + per-agent-invocation summary (parsed from structured orchestrator log)
- Any retries that fired + which tier counter incremented
- Any gate pauses (shouldn't be any during Mode B after gate 5, unless reviewer fails)
- Git log showing merged commits
- One regression (if any) + one surprise (if any)

22. **Update `docs/build-tier-roadmap.md`** — add a §MVP Exit Record section at the bottom with the date, the validation project, the measured cost, and the exit-criteria pass/fail matrix from the roadmap's §Exit criteria checklist.

23. **Archive this plan** via `/plan-archive` with outcome: success + lessons. Update `plans/active.md` to remove this entry.

**Phase 4 done when**: `docs/mvp-completion-report.md` reflects a successful (or failure-characterized) run on a real project; `docs/build-tier-roadmap.md` has an MVP Exit Record; this plan is archived.

### Testing at each stage

| Phase | Stage                                  | Testing mechanic                                                                                                                                                               | Pass criteria                                                                                                            |
| ----- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 1     | invoke-agent.ts + cli-runner live path | Vitest suites in orchestrator/tests/                                                                                                                                           | All new + existing suites pass; coverage ≥ 80% on new code                                                               |
| 1     | Live dry-run regression                | `pnpm --filter orchestrator start generate revolution-pictures --dry-run`                                                                                                      | Output byte-identical to pre-wire-up baseline (excepting the final "Live run not wired" replaced with "Ready to invoke") |
| 2     | Gate mechanics                         | Vitest in gate-server-lifecycle.test.ts                                                                                                                                        | 3 new gate types × {proceed, revise, abort} = 9 paths covered                                                            |
| 2     | End-to-end gate pause                  | Manual: `/analyze` on a scratch project, confirm it pauses + file-drop works                                                                                                   | Pause resolves on file write; pipeline continues to next stage                                                           |
| 3     | Stack skill structure                  | markdownlint + grep-based verify script `scripts/verify-vendor-skill.mjs`                                                                                                      | Each SKILL.md has 7 required sections; no design-token leakage                                                           |
| 3     | Stack skill grounding                  | Dispatch a scratch `web-frontend-builder` subagent with ONLY a vendor skill as context; have it produce a minimal usage example; verify the example compiles via `tsx --check` | Compiles without type errors for 3/8 sampled skills                                                                      |
| 4     | Pre-flight                             | `/start-build revolution-pictures --dry-run`                                                                                                                                   | DAG walk identical to current baseline                                                                                   |
| 4     | Mode B run                             | Live orchestrator invocation with budget-cap safety                                                                                                                            | Wave 1 feature merges to main without human intervention; cost < $10                                                     |
| 4     | Regression                             | `pnpm --filter @repo/web test && pnpm --filter @repo/web typecheck && pnpm ui-kit:validate-consumer` after Wave 1 merge                                                        | All pass; no new kit contract violations                                                                                 |
| 4     | Exit record                            | Human inspects `docs/mvp-completion-report.md`                                                                                                                                 | Lists wave outcomes + cost + one lesson                                                                                  |

## Rejected Alternatives

### Alternative A: Auto-author vendor stack skills via `/skills-audit --scope=build --auto-author-stack-skills`

**Why rejected**: The auto-authoring path was explicitly deferred to extension plan `feat-010-skills-audit-runtime` in the roadmap. Shipping it as a prerequisite to MVP exit adds ~6-8h of runtime work + meta-agent testing AND produces lower-quality skill content than hand-authoring (per docs/lessons.md theme: "auto-generated prompts without domain grounding hallucinate vendor APIs 25-40% of the time"). Hand-authoring 8 skills is 6-8h but each one is read-verifiable + reliable. After MVP exits, the auto-authoring path can land as a quality-of-life upgrade that re-generates these skills from vendor docs periodically.

### Alternative B: Skip Phase 3 and rely on raw-LLM vendor knowledge during the MVP validation run

**Why rejected**: The MVP goal is "autonomous with HIGH-quality output." Without grounded skills, builders guess at vendor SDK surface area (e.g. wrong Mux Player prop names, outdated Sanity client methods, deprecated Resend patterns). The feat-project-bootstrap smoke test passed because I hand-wrote the dispatch prompt with explicit vendor snippets. A real `web-frontend-builder` without vendor skills would produce code that compiles but uses 2022-era patterns. Reviewer agent flags on maintainability — not an MVP-quality exit.

### Alternative C: Defer gates 1 + 3 + 6 to post-MVP since file-drop pattern "implicitly works" by letting the user re-run the next stage manually

**Why rejected**: The MVP goal explicitly says "gates 1-4 + gate 5 are the only human touchpoints." If gate 1 has no formal mechanic, the orchestrator has two failure modes: (a) it bulldozes past `/analyze` into `/mockups` without giving the user a chance to review requirements — defeats the "humans approve design decisions" guarantee; (b) it stops silently after `/analyze` with no resume mechanism — breaks autonomy. Formalizing the three gates is ~2h of work; letting them be undefined pushes structural debt into every future run.

### Alternative D: Ship all 13 extension plans (feat-010 through feat-014-lessons-agent) inside this plan

**Why rejected**: Extension plans are post-MVP per the roadmap's deliberate scoping. Extensions add quality-of-life (skills-audit auto-authoring, lessons-agent, html-verifier) but are not required for the first autonomous run. Bundling them into this plan would balloon scope from ~14h to ~40h and delay MVP exit. Each extension ships as its own plan after MVP is proven.

### Alternative E: Use hatch-2 as the validation project instead of revolution-pictures

**Why rejected**: hatch-2's kit got its primitives via a retrofit (feat-013) + globals.css was hand-patched (bug-001). Running Mode B against hatch-2 would partly validate pre-fix state. Revolution-pictures is a clean refactor-006 run: kit 1.0.0 → 1.0.1 produced through the hardened gate with no manual patches; tasks.yaml emitted freshly; architecture.yaml emitted freshly. Validation signal is cleaner.

## Expected Outcomes

Testable checkboxes (all must pass for this plan to close as `completed`):

- [ ] `pnpm --filter orchestrator test` passes all suites, including new `invoke-agent.test.ts` + extended `cli-runner.test.ts` + extended `gate-server-lifecycle.test.ts`
- [ ] `pnpm --filter orchestrator start generate revolution-pictures --resume-feature-graph --dry-run` reports the 12-feature DAG walk (regression check: no output changes except the final "Ready to invoke" line)
- [ ] `/start-build revolution-pictures --max-concurrent=1` with budget-cap $10 runs Wave 1 (`feat-cms-content-model`) to green and merges the feature to main autonomously
- [ ] `docs/mvp-completion-report.md` exists with timestamp, cost, per-feature outcomes, one regression note, one lesson
- [ ] `docs/build-tier-roadmap.md` has a §MVP Exit Record block signed + dated
- [ ] 8 vendor skill files ship under `.claude/skills/agents/vendor/` + each has the 7 required sections per `scripts/verify-vendor-skill.mjs`
- [ ] Gates 1, 3, and 6 have file-drop mechanics in `orchestrator/src/gate-server-lifecycle.ts` mirroring gate 5

## Validation Criteria

- **Typecheck**: `pnpm -r typecheck` clean across factory + orchestrator + packages/_ + projects/_
- **Tests**: `pnpm -r test` clean (orchestrator suite + all project suites)
- **Kit contract**: `pnpm --filter revolution-pictures ui-kit:validate-consumer` passes post-Wave-1
- **Live run**: a human can watch `/start-build revolution-pictures --max-concurrent=1` from terminal; orchestrator's logs are parseable; exit 0 at Wave 1 success; no secrets leaked to stdout
- **Documentation**: `docs/build-tier-roadmap.md` MVP Exit Record references this plan; `docs/lessons.md` has one new entry summarizing the validation run
- **Performance**: Wave 1 feature cost ≤ $4 (budget estimate from `architecture.yaml.tooling.budget.total_mcp_cost_usd`); total Mode B budget on full 12-feature walk ≤ $50 (extrapolation — confirmed on second validation run, not blocking for MVP exit)
- **Cleanup**: this plan archived via `/plan-archive`; `plans/active.md` updated; git branch `feat/mvp-completion-autonomous-e2e` merged + deleted

## Attempt Log

<!-- Executing agent fills this in as attempts complete. -->

## References

- `docs/build-tier-roadmap.md` — the canonical roadmap this plan closes
- `plans/archive/investigate-002-build-tier-readiness-gap.md` — the source investigation
- `plans/archive/task-035-orchestrator-runtime.md` — previous plan (partial; this closes the cli-runner + invoke-agent gaps)
- `plans/archive/task-036-hitl-gates-server.md` — previous plan (partial; this closes gates 1 + 3 + 6)
- `plans/archive/feat-005-architect-implementation.md` + `feat-006-pm-implementation.md` + `feat-008-builder-runtimes.md` — previous plans (complete; their outputs are consumed here)
- `.claude/skills/start-build/SKILL.md` — the skill this plan's Phase 1 unblocks
