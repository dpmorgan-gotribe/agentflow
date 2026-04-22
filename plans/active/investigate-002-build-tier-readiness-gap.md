---
id: investigate-002-build-tier-readiness-gap
type: investigation
status: completed
completed: 2026-04-22
author-agent: human
created: 2026-04-22
updated: 2026-04-22
parent-plan: null
supersedes: null
superseded-by: null
branch: null
affected-files: []
feature-area: orchestration
priority: P1
attempt-count: 0
max-attempts: 5
time-box-minutes: 180
hypothesis: |
  The design tier is production-ready end-to-end (validated by the mindapp-v2
  walkthrough). The post-design tier is specified but has zero runtime
  implementation: orchestrator/index.ts, architect + PM + builder + tester +
  reviewer agent files, and gate backing servers are all scaffolding-spec-
  only. Closing the gap to "fully autonomous app build with little to no
  human interaction" likely needs 8-12 new plans in this order:

    1. orchestrator runtime (everything binds to its task routing)
    2. HITL gate 1 + 3 + 5 backing servers (gates 2 + 4 templates exist)
    3. architect + PM agent definitions (specs exist; .claude/agents/*.md don't)
    4. builder/tester/reviewer agent definitions + skill runtimes
    5. reviewer agent (most-missed role — there's no spec task at all)
    6. Lessons Agent (docs/lessons.md auto-update + global CLAUDE.md push)
    7. Telemetry + observability (cost tracking, attempt counters, failure patterns)
    8. Missing cross-cutting tooling (e.g. zod-to-pydantic codegen referenced by python-fastapi stack skill)

  Beyond filling the scaffolded gaps, at least four NEW concerns emerge
  that aren't anywhere in the plan yet:

    A. Multi-project orchestration — what if 3 projects run concurrently
       on one machine? Shared MCP tokens, port collisions, rate limits.
    B. Cost-budget enforcement — models.yaml has perPipelineMaxUsd; is
       there actually code to kill the orchestrator when budget exhausts?
    C. Cold-start UX — what does a first-time factory-runner experience?
       Is there a /quickstart path that produces a first app in <30 min?
    D. Self-upgrade — when factory agents evolve, how do in-flight
       projects get the new definitions without breaking mid-run?
---

# investigate-002-build-tier-readiness-gap: What gaps stand between the current factory state and fully autonomous app generation from brief → shipped PR with little-to-no human interaction?

## Question

**Integrated:** Given the target outcome of generating production-quality apps from a brief with little-to-no human interaction, what are the concrete gaps — in agents, skills, runtime, gates, tooling, schemas, telemetry, and cross-cutting concerns — between the current factory state (see `git log master` + `scaffolding/000-scaffolding-index.md` + `plans/archive/`) and that outcome, and what is the minimum-viable ordering of follow-up plans to close them?

**Sub-questions**, each falsifiable:

1. **Agent definitions.** Which of the 12 agents in blueprint §2 have `.claude/agents/*.md` files shipped today? Which don't? (Known: analyst + ui-designer + git-agent. Unknown: full roster delta.)
2. **Skills.** Which slash commands in the refactor-003/004 canonical pipeline have `.claude/skills/*/SKILL.md` shipped today? Which are spec'd but not implemented? Which are referenced but have no spec yet?
3. **Orchestrator runtime.** Task 035's spec is complete (refactor-004 Appendix D). What's the code-level scope of the implementation — line count, files, test strategy? What's the first runnable milestone?
4. **HITL gates.** Gate 2 + 4 have templates + a documented POST contract. What's the state of gate 1 (requirements review), gate 3 (design-system review), gate 5 (credentials file-drop)? Which have backing HTTP servers? Which are "file-watch only"? Which don't exist yet?
5. **Builder + tester + reviewer runtimes.** Specs exist for 028/029/030 (builders — now stack-dispatcher specs) and 031 (tester). What about reviewer — is there a spec task at all? What's the cross-cutting gap between spec + runtime for each?
6. **Cross-cutting tooling.** Python-fastapi stack skill references a `zod-to-pydantic` codegen. Does that exist? Mobile stack skills reference token mirrors (Dart / Colors.xcassets). Shipped? What else is referenced-but-missing?
7. **Telemetry + observability.** The retry ladder has 5 independent counters (Layer 5, visual, task, merge, kit-change detour). Where do these counters live at runtime? Is there a dashboard or log aggregation? How does a human know why a run failed?
8. **Lessons Agent.** Blueprint §21 names it; `docs/lessons.md` was just aggregated manually. What's the spec for an agent that watches `plans/archive/` + auto-updates lessons? Has it been scaffolded (task ~037)?
9. **Cost enforcement.** `~/.claude/models.yaml.perPipelineMaxUsd` is documented. Is there actual code that tracks spend + aborts? How does the orchestrator measure cost per query()?
10. **Novel concerns (NOT in the plan today):**
    - Multi-project concurrent orchestration on one machine (MCP port collisions, shared rate limits)
    - First-time-user cold-start UX (how does a new user produce their first app?)
    - Factory self-upgrade (when agent definitions evolve, what happens to in-flight projects?)
    - Quality ceiling (is 80% rubric pass + human-review-at-gate-4 actually enough for a production app?)

## Hypothesis

Captured in frontmatter above. Short version: design tier done, build tier specified-but-not-implemented. Filling the scaffolded gap is ~8-12 plans in strict dependency order. Four novel concerns emerge that aren't in any plan yet.

**Prior hypothesis verification:** investigate-001 accurately predicted that the post-design pipeline was stage-linear-hardwired (it was) and that per-stack skills were mentioned-but-not-specified (they were). This investigation's hypothesis is a direct continuation — investigate-001 fixed the SPEC; investigate-002 identifies what's needed to fix the RUNTIME.

## Investigation Steps

### Phase 1 — Inventory: what exists today (60 min)

1. **List all `.claude/agents/*.md`** — one-liner each: `{name, description-head-50-chars, tools, mcp_servers count, file-size}`. Confirms which of blueprint §2's 12 agents actually have definitions.

2. **List all `.claude/skills/*/SKILL.md`** + `.claude/skills/agents/**/SKILL.md` (stack-skill shelf) — same one-liner shape. Catalog the slash-command surface + stack-skill shelf.

3. **List all `schemas/*.schema.json`** — each with its title + whether a Zod mirror exists in `scaffolding/09-034b`. Check for gaps between JSON schemas + Zod schemas.

4. **List all `.claude/rules/*.md`** — each rule's scope + consumers.

5. **Read `scaffolding/000-scaffolding-index.md`** — parse status per task (pending / in-progress / completed). Produces a canonical "what scaffolding is implemented vs what isn't" table. Note: the scaffolding task file presence is NOT the same as runtime presence; a scaffolding file may exist without corresponding agent/skill/runtime.

6. **Read `plans/archive/` summary** — each archived plan's outcome + scope. Confirms what shipped in prior work. Cross-reference `docs/lessons.md` for themes.

7. **`git log master --since="3 months ago" --pretty=oneline | wc -l`** and `git log master --name-only | sort -u | wc -l` — rough sizing of what's been committed to date.

### Phase 2 — Target reference: what "done" means (30 min)

8. **Read blueprint §1 (primitives), §2 (agent roster), §3 (orchestration)** — capture the 12 agents + orchestrator model that "done" requires.

9. **Read blueprint §23 + Appendix C (refactor-003) + Appendix D (refactor-004) + Appendix E (feat-002)** — the canonical pipeline shape. This is the spec we measure against.

10. **Read `.claude/rules/testing-policy.md`** — the quality ceiling.

11. **Read `plans/archive/investigate-001-*.md`** Recommendation section — the 5 follow-up plans from investigate-001 are ALL done; confirm nothing was missed.

### Phase 3 — Gap analysis (45 min)

For each category, produce a table `{item, status, blocker, effort}`:

12. **Agent definitions gap** — 12 expected vs shipped count. Per missing agent: blueprint reference, scope, estimated file size based on peer-agent complexity.

13. **Skills gap** — every slash command in the pipeline → SKILL.md presence check. Per missing: what's the existing scaffolding spec, what's the runtime gap.

14. **Runtime gap** — per agent / skill: does it have an executable body, or only a spec? Count in rough file-lines (200-800 for most skills; 1000+ for orchestrator runtime).

15. **HITL gate gap** — per gate (1-5): template exists? Backing server exists? POST contract documented? File-watch wired? Can a human actually interact with it?

16. **Telemetry + observability gap** — retry counters, cost tracking, attempt logs, failure-pattern aggregation. What exists on paper vs what exists in code.

17. **Cross-cutting tooling gap** — codegens (zod-to-pydantic, Dart token mirror), validation runners, HTTP server helpers.

18. **Reviewer agent gap** — is there ANY spec? If not, draft the missing specification surface.

### Phase 4 — Novel concerns (20 min)

For each of the 4 novel concerns (multi-project, cold-start, self-upgrade, quality-ceiling), write:

19. **What the concern is** — in one paragraph with concrete scenarios.

20. **Whether any existing plan addresses it** — grep `plans/archive/` + `scaffolding/` for relevant signals.

21. **Rough shape of how it'd be addressed** — not a full plan; just enough to know "is this a new P1 / P2 / P3 follow-up plan, or a note in an existing plan, or not worth a plan at all".

### Phase 5 — Integrate + recommend (25 min)

22. **Integrated gap map** — a single table listing every identified gap with `{category, item, status, proposed-plan, priority, depends-on}` columns.

23. **Minimum viable ordering** — a numbered list of follow-up plans in dependency order. For each: one-line scope + depends-on + estimated size (small / medium / large). Total count should be ≤ 15 (if more, the roadmap is too fragmented).

24. **What NOT to do next** — explicit list of concerns that surfaced but shouldn't block build-tier start (e.g., "multi-project concurrency is a real concern but not MVP — runs are single-project today; address at v2").

25. **Critical path to first autonomous app** — name the 3-5 plans that, once done, enable the first end-to-end `/new-project → shipped PR` run with zero human intervention between brief + gate 5. Everything else is quality-of-life.

## Findings

### Phase 1 — Inventory

#### 1. Agent definitions — 3 of 12+ shipped

| Agent                       | File                                      | Status                                              |
| --------------------------- | ----------------------------------------- | --------------------------------------------------- |
| analyst                     | `.claude/agents/analyst.md` (6.2 KB)      | ✓ shipped                                           |
| ui-designer                 | `.claude/agents/ui-designer.md` (16.7 KB) | ✓ shipped                                           |
| git-agent                   | `.claude/agents/git-agent.md` (5.0 KB)    | ✓ shipped (via feat-003)                            |
| **architect**               | —                                         | ✗ spec at `scaffolding/07-020`; agent file missing  |
| **project-manager**         | —                                         | ✗ spec at `scaffolding/08-021`; agent file missing  |
| **backend-builder**         | —                                         | ✗ spec at `scaffolding/14-028`; agent file missing  |
| **web-frontend-builder**    | —                                         | ✗ spec at `scaffolding/15-029`; agent file missing  |
| **mobile-frontend-builder** | —                                         | ✗ spec at `scaffolding/16-030`; agent file missing  |
| **tester**                  | —                                         | ✗ spec at `scaffolding/17-031`; agent file missing  |
| **reviewer**                | —                                         | ✗ spec at `scaffolding/18-032`; agent file missing  |
| **html-verifier**           | —                                         | ✗ spec at `scaffolding/19-032b`; agent file missing |
| **skills-agent**            | —                                         | ✗ spec at `scaffolding/23-038`; agent file missing  |
| **lessons-agent**           | —                                         | ✗ spec at `scaffolding/24-037`; agent file missing  |
| **agent-expert**            | —                                         | ✗ spec at `scaffolding/26-039`; agent file missing  |

**Gap: 11 agent definition files.** Hand-written + short (4-10 KB each extrapolating from shipped agents); ~50-80 KB total writing. Each definition is per-task scaffolding spec already done; only the frontmatter + system prompt remain to author.

#### 2. Skills — 21 project-level + 6 stack shelf shipped; 13 runtimes missing

**Shipped** (28 total):

- **Pipeline skills**: analyze · mockups · pick-style · stylesheet · screens · visual-review · user-flows-generator
- **Project + brief**: new-project · draft-brief · validate-brief · scan-assets
- **Plan management**: plan-bug · plan-feature · plan-investigation · plan-refactor · plan-archive · plan-search · plan-status · check-existing-work
- **Context**: save-context · load-context-chain
- **Stack-skill shelf**: `_template` + react-next + svelte-kit + node-trpc-nest + python-fastapi + expo-rn (6 files)

**Missing runtimes** (13):

- `/architect` (task 020) — has spec, no SKILL.md
- `/pm` (task 021) — has spec, no SKILL.md
- `/skills-audit` (task 038) — dual-scope design+build, has spec, no SKILL.md
- `/register-mcp-servers` (task 041) — dual-scope, has spec, no SKILL.md
- `/build-backend` (task 028) — stack-dispatcher spec per feat-002, no SKILL.md
- `/build-web-frontend` (task 029) — stack-dispatcher spec, no SKILL.md
- `/build-mobile-frontend` (task 030) — stack-dispatcher spec, no SKILL.md
- `/test` (task 031) — narrow-scope tester per feat-004, no SKILL.md
- `/review` (task 032) — spec only
- `/verify-html` (task 032b) — spec only
- `/git-agent` or `/git` (task 033) — 5-op spec per feat-003, no SKILL.md
- `/lessons` (task 037) — spec only
- `/agent-expert` (task 039) — spec only

#### 3. Orchestrator runtime — ZERO code shipped

- `scaffolding/21-035-orchestrator-core.md` — fully specified (Mode A stages + Mode B feature-graph + runFeature pseudocode + 5-tier retry counter + Zod schema integration)
- `orchestrator/` directory — **does not exist**
- `packages/orchestrator-contracts/` — **does not exist**
- No TypeScript runtime, no `query()` wiring, no budget tracker, no task-to-agent dispatcher

This is the **single biggest gap**. Every scaffolding task below 035 specifies how it plugs into the orchestrator; there's no orchestrator to plug into.

#### 4. Schemas — 9 shipped + Zod mirrors

`schemas/*.schema.json`:

- architecture, brief-frontmatter, feature, feature-context, navigation, screens, signoff, tasks, visual-review-report

All feat-001-004 schemas have Zod mirrors in `scaffolding/09-034b-output-contract-zod-schemas.md`. The mirrors are scaffolding-spec-only; `packages/orchestrator-contracts/` (the runtime TS package importing them) doesn't exist.

#### 5. Rules — 1 shipped

`.claude/rules/testing-policy.md` (7.7 KB — feat-004). No other rule files. Blueprint mentions potential additions but none specced.

#### 6. Hooks — 4 shipped

- block-dangerous.sh · detect-loop.mjs · enforce-boundaries.sh · validate-brief.mjs

#### 7. Templates — 13 files shipped

UI Kit contract bundle (4 files) + ESLint plugin tree (5 files + plugin package) + mockups-index-template.html + user-flows-template.html + worktrees-README.md. Comprehensive design-side coverage.

#### 8. Scaffolding task count

- **Completed + archived**: 27 (Tiers 1-4 + Phase A design pipeline) — see `scaffolding/archive/`
- **Pending**: 20 files under `scaffolding/` root — tasks 020, 021, 026, 027, 028, 029, 030, 031, 032, 032b, 033 (spec updated), 034, 034b, 035, 036, 037, 038, 039, 040, 041
- Of the 20 pending, **tasks 026 + 027 are effectively implemented** — `/new-project` step 5b calls them at bootstrap time. Scaffolding files pending but work done.

### Phase 2 — Target reference

- Blueprint §2 names the roster; 12+ agents listed (analyst, architect, PM, UI-designer, backend-builder, web-frontend-builder, mobile-frontend-builder, tester, reviewer, skills, lessons, git, potentially security + devops as named-but-minor roles)
- Blueprint §3 orchestration model — stage-linear with dependsOn parallelism. Refactor-004 Appendix D splits this into Mode A (stage-linear) + Mode B (feature-graph)
- Blueprint §23 + Appendix C (refactor-003) + Appendix D (refactor-004) + Appendix E (feat-002) — canonical pipeline; design tier validated E2E on mindapp-v2; post-design tier specified but unrun
- `.claude/rules/testing-policy.md` — 60% builder / 80% total coverage; genuine-product-bugs routing
- investigate-001's 5 follow-ups: all complete

### Phase 3 — Gap tables

#### 12. Agent gap

| Agent                   | Spec location       | Effort                                                          | Depends on                              | Blocks                      |
| ----------------------- | ------------------- | --------------------------------------------------------------- | --------------------------------------- | --------------------------- |
| architect               | `07-020`            | medium — prompt + vendor decision heuristics                    | feat-002 (done) + testing-policy (done) | PM, builders                |
| project-manager         | `08-021`            | medium — feature-grouping heuristic + kit-change dual-mode      | architect                               | builders, git-agent         |
| backend-builder         | `14-028`            | small — dispatcher pattern; stack skills load dynamically       | architect + PM + feat-002               | tester                      |
| web-frontend-builder    | `15-029`            | small — dispatcher + CONTRACT.md embed                          | architect + PM + feat-002               | tester                      |
| mobile-frontend-builder | `16-030`            | small — dispatcher + null-skip                                  | architect + PM + feat-002               | tester                      |
| tester                  | `17-031` (feat-004) | small — hybrid TDD; dispatches via stack skill                  | builders                                | reviewer                    |
| reviewer                | `18-032`            | medium — cross-cutting correctness + security + compliance pass | tester                                  | sign-off                    |
| html-verifier           | `19-032b`           | small — Layer 6 CSS/token validator                             | stylesheet output                       | visual-review gate          |
| skills-agent            | `23-038`            | medium — design + build dual scope; auto-authoring path         | nothing direct                          | every skill-consuming agent |
| lessons-agent           | `24-037`            | small — watches plans/archive/ + aggregates                     | plan-archive (done)                     | maintenance only            |
| agent-expert            | `26-039`            | small — meta-agent for authoring new agents                     | nothing direct                          | nice-to-have only           |

**Total effort**: ~8-10 medium + 3 small agent files = 1-2 weeks of writing.

#### 13. Skill runtime gap

Same 13 slash commands as §2 inventory. Each needs a SKILL.md mirroring its scaffolding spec. **Most are mechanical** — the scaffolding already specifies inputs / steps / acceptance criteria / return-JSON. Translation task, not design task. Exception: `/architect` + `/pm` have non-trivial business logic (vendor picking + feature grouping) that's scaffolding-specified but still needs faithful implementation.

#### 14. Runtime gap (beyond agent + skill files)

- **`orchestrator/index.ts`** — THE critical path. ~800-1500 LOC estimate: `runStage()`, `runPipeline()`, `runFeature()`, `runFeatureGraph()`, budget tracking, retry counters, gate server lifecycle, Claude Agent SDK `query()` wrapper.
- **`packages/orchestrator-contracts/`** — the Zod schema package that scaffolding/09-034b specifies. ~500 LOC (mostly re-exports of schema definitions).
- **Cost/budget tracker** — readModelConfig reads `perPipelineMaxUsd` but no runtime code tracks cumulative spend or aborts on exhaust.
- **Telemetry + attempt-counter persistence** — retry counters live in-memory during a run; crash loses state. Needs a `.claude/state/{pipelineRun}/` cache.
- **HTTP gate server implementation** — task 036 specifies the contract; no Express/Fastify/Hono code exists.

#### 15. HITL gate gap

| Gate | Name                    | Template                                                    | Backing server   | Spec                              | Status                                                                    |
| ---- | ----------------------- | ----------------------------------------------------------- | ---------------- | --------------------------------- | ------------------------------------------------------------------------- |
| 1    | requirements review     | —                                                           | —                | implicit in /analyze              | **undefined** — no backing mechanic                                       |
| 2    | style selection         | `mockups-index-template.html` ✓                             | task 036 spec    | `22-036-hitl-gates.md` pending    | template only; pick-style CLI works; full HTTP server pending             |
| 3    | design-system approval  | `docs/design-system-preview.html` produced by /stylesheet ✓ | —                | task 036 spec                     | **conceptually missing** — preview generated but no formal HITL mechanism |
| 4    | sign-off                | `user-flows-template.html` + signoff.schema.json ✓          | task 036 spec    | pending                           | template + schema shipped; server pending                                 |
| 5    | credentials (file-drop) | — (no HTML; filesystem is the handoff)                      | file-watch logic | refactor-003 spec in orchestrator | no runtime                                                                |

**Gate 1 + 3 have NO formal definition today.** Gate 1 is implicit ("orchestrator pauses after /analyze; user reviews docs/requirements.md + docs/brief-summary.json"); gate 3 is implicit ("orchestrator pauses after /stylesheet; user reviews docs/design-system-preview.html"). Neither has a written spec, a pause mechanism, or a resume signal. If we want full autonomy with HITL at decision points only, gates 1 + 3 need formal defined pause + resume contracts (even if just file-watch for `docs/gate-1-approved.txt` mirroring gate 5's pattern).

#### 16. Telemetry + observability gap

- **Retry counters**: specified per-tier; no runtime persistence
- **Cost tracking**: `budgetUsd` in PipelineStage; `perPipelineMaxUsd` in models.yaml; zero enforcement code
- **Attempt logs**: plans/\*.md carry Attempt Log sections; no structured aggregate
- **Failure patterns**: no collection; Lessons Agent would eventually populate
- **Run visibility**: orchestrator would log stdout; no dashboard, no structured JSON export
- **Gap**: no answer today to "why did this run fail?" beyond reading raw stdout

#### 17. Cross-cutting tooling gap

- **`zod-to-pydantic` codegen** — referenced by `python-fastapi/SKILL.md`; doesn't exist
- **Dart token mirror codegen** — referenced by feat-002's blueprint Appendix E for Flutter stacks; doesn't exist
- **Colors.xcassets + strings.xml generator** — referenced for native-swift / native-kotlin stacks; doesn't exist
- **Aggregate lesson extractor** — manual today (scripts/archive-plans.mjs populates each plan; docs/lessons.md aggregated by hand)
- **Test runner output parsers** — each stack skill names a coverage command (`pnpm vitest run --coverage`); no parser translates stdout into policy-checker input
- **Gate-5 `.env` diff renderer** — architect spec mentions `docs/credentials-diff.md` on re-runs; no runtime code

None are P0 blockers — the first two stacks (react-next + node-trpc-nest) don't need codegens. But python-fastapi and the four mobile stacks would need them to function.

#### 18. Reviewer gap

Reviewer has a **spec** (`scaffolding/18-032-reviewer-agent.md`) — architecture adherence, quality, compliance. But:

- No agent file
- No skill runtime
- **No updates since refactor-004** — the spec still says "runs after builders"; feat-003 placed it as a per-feature `agent_sequence` member. Spec needs a refactor-004 alignment pass like tester got in feat-004.

Reviewer is the quality ceiling. Without it, the pipeline has no catch-all "would we ship this?" check — visual-review handles HTML only; tester handles tests only; architecture adherence + security + compliance + cross-cutting concerns have no agent owner today.

### Phase 4 — Novel concerns

#### 19. Concern A — Multi-project concurrency

**Scenario**: user runs `/new-project demo1` + `/new-project demo2` + kicks off pipelines on both simultaneously. Both want Playwright MCP; both compete for dynamic ports (`/visual-review` preflight uses 4173+); both pull rate-limit budget from the same Anthropic API key.

**Addressed by any plan?**: no. The factory today assumes one project runs at a time.

**Rough shape**: multi-project is v2 territory. Requires: per-project MCP server isolation (separate `.mcp.json` scoped to project), per-project API-key pools (`.claude/models.yaml.projects.*` scoped configs), port registry (shared cache of allocated dynamic ports across runs). Medium-large effort.

**Recommendation**: **Punt to v2**. Add a warning in `/new-project`: "Factory supports one active project run at a time; stop other pipelines before starting." Not MVP for first autonomous run.

#### 20. Concern B — Cost enforcement

**Scenario**: a recursive retry loop triggers the 3-tier × 3-counter retry pyramid + kit-change-request detours + visual-review re-runs. Without a budget cap, a confused pipeline could burn $500 before any human notices.

**Addressed by any plan?**: partially. `readModelConfig()` reads `perPipelineMaxUsd`; `PipelineStage` carries `budgetUsd`; but no runtime code tracks cumulative spend or kills the orchestrator on exhaust.

**Rough shape**: belongs INSIDE task 035 orchestrator runtime, not as a separate plan. Add acceptance criterion: "orchestrator tracks cumulative `query()` cost via response metadata; aborts cleanly (checkpoint context first) when cumulative spend exceeds `perPipelineMaxUsd`."

**Recommendation**: **add to task 035 orchestrator runtime as a P0 acceptance criterion**, not a separate plan. Critical-path inclusion.

#### 21. Concern C — Cold-start UX

**Scenario**: a new user clones the factory repo. They want a working app from a one-line brief in <30 min as a confidence check. Today the path is: `/new-project foo --proposal "..."` → `/analyze` → `/mockups` → `/pick-style` → `/stylesheet` → `/screens` → `/visual-review` → `/user-flows-generator` → (no more — gate 4 sign-off + post-design tier pending).

**Addressed by any plan?**: partially. `/new-project --proposal` chains to `/draft-brief` automatically. No plan bundles the whole design pipeline into a single command.

**Rough shape**: a new `/quickstart <name> --proposal "..."` skill that chains /new-project + /analyze + /mockups + auto-picks style-0 + /stylesheet + /screens + /visual-review + /user-flows-generator. Auto-mode for demo confidence; skips HITL gates by taking default choices.

**Recommendation**: **new plan — feat-005-quickstart**, medium priority. Schedule AFTER the critical path lands (otherwise quickstart would fail at the architect stage anyway). Shipping quickstart pre-build-tier is still useful — demos the design pipeline in one command.

#### 22. Concern D — Self-upgrade

**Scenario**: factory maintainer adds a new primitive to the UI Kit template. Existing projects that ran `/new-project` 3 months ago want the new primitive without re-running `/new-project --force` (which could disturb in-flight work).

**Addressed by any plan?**: partially. `/new-project --force` refreshes resources with backup. Doesn't handle: mid-run upgrade safety, architecture.yaml backward compat, plan-template migration.

**Rough shape**: a `/factory-upgrade <project>` skill that diffs current factory state against project state, surfaces safe vs risky deltas, applies safe ones automatically, flags risky ones for human review. Probably wants a versioned "factory-manifest" in each project recording when it was scaffolded.

**Recommendation**: **defer to v2**. No in-flight projects to protect today; `/new-project --force` covers the one-shot refresh case. Revisit after 3+ projects ship + a real upgrade need surfaces.

### Cross-cutting observations

1. **Orchestrator runtime is the pacing constraint for everything else.** Every other pending task has scaffolding; most are mechanical translations. 035 is the foundational unlock.
2. **Reviewer is the biggest silent gap.** It has a spec but that spec predates refactor-004 + feat-004; it needs alignment updates AND agent-file authoring AND skill runtime. Triple gap.
3. **Gates 1 + 3 have no formal mechanic.** Must be spec'd before autonomous run can reliably pause at those points.
4. **Cost enforcement is a one-line addition to task 035** — not a separate plan, just a P0 acceptance criterion within 035.
5. **Stack skills auto-authoring** (`/skills-audit --scope=build --auto-author-stack-skills`) is long-tail; shipped 5 covers react+svelte+node+python+expo. Non-React stacks' kit-token codegens remain unshipped.

## Recommendation

### Integrated gap map

| Category      | Item                               | Status                                   | Proposed plan                                       | Priority | Depends on                                    |
| ------------- | ---------------------------------- | ---------------------------------------- | --------------------------------------------------- | -------- | --------------------------------------------- |
| Runtime       | orchestrator/index.ts (task 035)   | spec complete; code absent               | **task-035-orchestrator-runtime**                   | P0       | nothing                                       |
| Runtime       | packages/orchestrator-contracts/   | spec complete; package absent            | included in task-035 runtime plan                   | P0       | —                                             |
| Runtime       | cost/budget enforcement            | spec mentions; code absent               | **acceptance criterion INSIDE task-035**            | P0       | —                                             |
| Runtime       | HITL gate HTTP server (task 036)   | templates shipped; server absent         | **task-036-hitl-gates-server**                      | P0       | task-035                                      |
| Agent+runtime | architect (task 020)               | spec done; agent + skill absent          | **feat-005-architect-implementation**               | P0       | task-035                                      |
| Agent+runtime | pm (task 021)                      | spec done; agent + skill absent          | **feat-006-pm-implementation**                      | P0       | task-035, architect                           |
| Agent+runtime | backend-builder (task 028)         | stack-agnostic spec done                 | **feat-007-builder-runtimes** (bundles 028/029/030) | P0       | architect, pm, feat-002 skills                |
| Agent+runtime | web-frontend-builder (task 029)    | stack-agnostic spec done                 | (bundled in feat-007)                               | P0       | —                                             |
| Agent+runtime | mobile-frontend-builder (task 030) | stack-agnostic spec done                 | (bundled in feat-007)                               | P0       | —                                             |
| Agent+runtime | tester (task 031)                  | feat-004 spec done; agent + skill absent | **feat-008-tester-implementation**                  | P0       | feat-007                                      |
| Spec update   | reviewer (task 032)                | spec exists but pre-refactor-004         | **refactor-005-reviewer-alignment** (spec refresh)  | P0       | —                                             |
| Agent+runtime | reviewer                           | spec incomplete; no agent; no skill      | **feat-009-reviewer-implementation**                | P0       | refactor-005                                  |
| Agent+runtime | skills-agent (task 038)            | dual-scope spec done                     | **feat-010-skills-audit-runtime**                   | P1       | task-035                                      |
| Agent+runtime | register-mcp-servers (task 041)    | spec done                                | **feat-011-register-mcp-servers-runtime** (small)   | P1       | task-035                                      |
| Agent+runtime | html-verifier (task 032b)          | spec exists                              | **feat-012-html-verifier**                          | P1       | task-036                                      |
| Agent+runtime | git-agent skill (task 033)         | agent file shipped; skill runtime absent | **feat-013-git-agent-skill-runtime**                | P1       | task-035                                      |
| Spec          | gate 1 (requirements review)       | undefined                                | **extend task 036 spec during feat-036 work**       | P0       | —                                             |
| Spec          | gate 3 (design-system approval)    | undefined                                | **extend task 036 spec during feat-036 work**       | P0       | —                                             |
| Agent+runtime | lessons-agent (task 037)           | spec exists                              | **feat-014-lessons-agent**                          | P2       | feat-007/008/009 (needs content to aggregate) |
| Tool          | zod-to-pydantic codegen            | referenced; absent                       | **feat-015-python-stack-codegens**                  | P2       | feat-007 (only triggers on python backend)    |
| Tool          | Dart/native token mirrors          | referenced; absent                       | **feat-016-mobile-stack-codegens**                  | P2       | feat-007 (only triggers on non-Expo mobile)   |
| UX            | quickstart command                 | novel concern C                          | **feat-017-quickstart**                             | P2       | design pipeline (done)                        |
| Agent+runtime | agent-expert (task 039)            | meta-agent spec                          | defer                                               | P3       | lessons, skills-audit                         |
| Layer         | app-store-compliance (task 040)    | spec                                     | defer                                               | P3       | feat-009 reviewer                             |
| Scope         | multi-project concurrency          | novel concern A                          | **NOT MVP — v2**                                    | —        | —                                             |
| Scope         | factory self-upgrade               | novel concern D                          | **NOT MVP — v2**                                    | —        | —                                             |

### Minimum-viable ordering (13 plans; 8 critical path + 5 extension)

**Critical path — first autonomous run (8 plans):**

1. **task-035-orchestrator-runtime** (P0, large) — `orchestrator/index.ts` + `packages/orchestrator-contracts/` + `runStage()` + `runPipeline()` + `runFeature()` + `runFeatureGraph()` + budget tracker + retry-counter persistence + Claude Agent SDK wrapper. Cost enforcement bundled as acceptance criterion. **Blocks**: everything.
2. **task-036-hitl-gates-server** (P0, medium) — HTTP server for gates 2+4; file-drop watcher for gate 5; **extend spec to cover gates 1 + 3** (formalize file-drop pattern for design-tier pauses). Blocks: any autonomous run reaching gate 5.
3. **refactor-005-reviewer-alignment** (P0, small) — align scaffolding/18-032-reviewer-agent.md spec with refactor-004 (feature-graph) + feat-004 (testing-policy) + feat-002 (stack-dispatch). No agent/skill authoring; spec-only refresh. **Required before** reviewer-implementation plan can be written.
4. **feat-005-architect-implementation** (P0, medium) — `.claude/agents/architect.md` + `.claude/skills/architect/SKILL.md`. Vendor-picking heuristic + stack-pick per feat-002 + `architecture.yaml` emission + credentials-checklist generation.
5. **feat-006-pm-implementation** (P0, medium) — `.claude/agents/project-manager.md` + `.claude/skills/pm/SKILL.md`. Dual-mode (tasks + kit-change-request). v2 tasks.yaml emission with feature-grouping heuristic.
6. **feat-007-builder-runtimes** (P0, medium — bundle 028/029/030) — agent files + skill runtimes for all three builders. Stack-skill dispatcher pattern. Happy-path test generation per feat-004. Shares 70% code across the three; bundling saves repetition.
7. **feat-008-tester-implementation** (P0, small) — tester agent + skill. Narrow scope per feat-004. Full-suite coverage + genuineProductBugs routing.
8. **feat-009-reviewer-implementation** (P0, medium) — reviewer agent + skill per refactor-005's refreshed spec. Architecture adherence + security + compliance pass. The quality ceiling.

**Extension (5 plans; land after critical path to harden + extend coverage):**

9. **feat-010-skills-audit-runtime** (P1, medium) — agent + dual-scope skill; stack-skill discovery from feat-002.
10. **feat-011-register-mcp-servers-runtime** (P1, small) — dual-scope registration skill; mostly mechanical.
11. **feat-012-html-verifier** (P1, small) — Layer 6 CSS/token validator; feeds into visual-review pipeline.
12. **feat-013-git-agent-skill-runtime** (P1, small) — skill runtime matching the 5-op spec from feat-003.
13. **feat-014-lessons-agent** (P2, small) — watches plans/archive/; auto-updates docs/lessons.md + (selectively) ~/.claude/CLAUDE.md.

**Deferrable (explicitly not MVP):**

- feat-015 python-stack-codegens — unlocks python-fastapi stack; only triggers if a project picks it
- feat-016 mobile-stack-codegens — unlocks Flutter / native stacks; only triggers if a project picks them
- feat-017-quickstart — cold-start UX polish; design-tier demo command
- agent-expert (039), app-store-compliance (040) — P3; revisit after first autonomous run

### Critical path to first autonomous app (5 plans — minimum viable)

Of the 8 critical-path plans, 5 are truly **hard-blockers** for a first E2E autonomous run:

1. **task-035-orchestrator-runtime** — without it, nothing runs
2. **task-036-hitl-gates-server** — without it, gate 5 can't open + autonomous run can't reach build phase
3. **feat-005-architect-implementation** — without it, no architecture.yaml → no builder context
4. **feat-006-pm-implementation** — without it, no tasks.yaml → no work for builders
5. **feat-007-builder-runtimes** — without it, no code gets written

With these five, the pipeline can run: brief → design → gate 4 sign-off → architect → gate 5 → PM → builders produce code. The first run won't have tester/reviewer coverage (gates 6/7 equivalent — those need feat-008/009), but the user sees a working app.

refactor-005 + feat-008 (tester) + feat-009 (reviewer) follow within days of the first 5 — they take the run from "code produced" to "code verified + shipped".

### What NOT to do next

- **Multi-project concurrency (concern A)**: real but v2. Factory assumes single-project-at-a-time today; warning in `/new-project` is sufficient for MVP.
- **Factory self-upgrade (concern D)**: no in-flight projects to protect; `/new-project --force` covers one-shot refresh. Revisit after 3+ projects ship.
- **App-store-compliance (task 040)**: P3 layer; Apple/Google submission checklists matter only after first production ship. Defer.
- **Agent-expert meta-agent (task 039)**: authoring new agents is rare; humans can do it directly. Defer.
- **Python + mobile codegens (feat-015 / feat-016)**: only trigger if a brief picks those stacks. Ship when the first such project comes in, not pre-emptively.
- **Over-specifying the HITL pause mechanic**: gate-5-style file-drop is simple + effective (`docs/gate-N-approved.txt` with `proceed` / `defer:reason` / `abort` body). Use the same pattern for gates 1 + 3 in task-036 spec extension; don't build a custom HTTP UI per gate.

### Open questions (leftover)

1. **What's the autonomous-run target?** — 100% autonomous (pipeline runs brief → PR; human only sees the PR)? 90% autonomous (HITL gates 2 + 4 stay; others auto-approve)? 70% autonomous (human approves every gate)? Choice drives how much work goes into quality ceiling + review capability. My recommendation: ship MVP as 90% (humans see gate 2 + gate 4; gate 5 is user-action anyway); pursue 100% as a v2 goal once failure patterns are known.
2. **What's "production-quality"?** — Accessibility? Performance? Security? Maintainability? Each has an agent owner implicit (reviewer for security + compliance; visual-review for a11y; performance unaddressed; maintainability via linting). Recommend: **reviewer agent scope explicitly lists which quality dimensions it owns**; anything not in that scope is known-uncovered for MVP.
3. **First autonomous project choice.** — Build a new project from scratch for the first E2E autonomous run? Or retry mindapp-v2 through the full pipeline now that design validates? Recommendation: **mindapp-v2 re-run** — it's already past gate 4; we can pick up at architect + build it through without redoing design.
4. **Quality of the reviewer** — most of the other agents have concrete skill catalogs to lean on (stack skills, kit contract, testing policy). The reviewer needs its own playbook or it becomes an AI-judgment blackbox. **refactor-005 should include a `reviewer-playbook.md` with explicit review dimensions** (architecture adherence, security checklist, compliance per brief §14, maintainability signals).
5. **Where does app-specific business-logic validation live?** — the brief has §12 Key Features + §19 Milestones + §6 Personas. Currently no agent explicitly validates "does the built app actually do what the brief said?" beyond test coverage. Possible answer: reviewer's scope. Or: a new agent (brief-delivery-check) — but probably over-fragmentation. **Add to reviewer's scope in refactor-005.**

## Attempt Log

### Attempt 1 — 2026-04-22 · Inventory + gap analysis + synthesis

**Time used:** ~90 min of the 180 min budget. Inventory ran fast (simple ls + grep + frontmatter-parse); gap analysis + synthesis took most of the time.

**Method:** direct inventory (no Explore subagent) — file listing, frontmatter grepping, schema presence check, orchestrator-runtime presence check all ran as Bash one-liners. Main-context synthesis for Phase 3 gap tables + Phase 4 novel concerns + Phase 5 ordering.

**Key data points collected:**

- 3 of 12+ agent files shipped (analyst, ui-designer, git-agent). 11 missing.
- 28 skill files shipped (21 project-level + 6 stack shelf + 1 \_template). 13 slash-command runtimes missing.
- 9 JSON schemas shipped; all have scaffolding Zod mirrors. No runtime `packages/orchestrator-contracts/` yet.
- 4 hooks shipped, 13 templates shipped, 1 rule shipped.
- 20 scaffolding tasks pending (26 numbered files minus 27 archived minus 000-index — actually 20 pending specs). Of those, 026 + 027 are work-done-spec-pending (absorbed into /new-project step 5b).
- **orchestrator/index.ts: does not exist.** packages/orchestrator-contracts/: does not exist.
- Cost enforcement: specified in 3 places; zero runtime code.

**Surprising findings:**

1. **Gates 1 + 3 are genuinely undefined**, not just under-implemented. Gate 5 has a file-drop pattern; gates 2 + 4 have templates; gates 1 + 3 have no formal mechanic at all. Would break an autonomous run's HITL-approval discipline if the orchestrator didn't know when/how to pause.
2. **Reviewer has a triple gap**: spec predates refactor-004/feat-004 (update needed), agent file missing, skill runtime missing. refactor-005 must happen before feat-009 (reviewer implementation) can be written.
3. **"Critical path" is 5 plans, not 10-15** — the minimum set to reach first autonomous run is task-035 + task-036 + feat-005 (architect) + feat-006 (pm) + feat-007 (builders). Tester + reviewer land days later, not weeks.
4. **Cost enforcement fits inside task-035**, not a separate plan. Saves a plan slot without compromising scope.
5. **Multi-project concurrency + factory self-upgrade are cleanly v2** — no project has hit either scenario yet; punting is low-regret.

**Recommendation shape in summary:**

- 13 plans total in ordered sequence
- 5 hard-blockers for first autonomous run
- 5 extension plans that run after critical path
- 3 deferrable plans (explicit "not MVP")
- 5 open questions flagged for human decision

**Execution plan discipline**: of the 5 open questions, #1 (autonomous target: 70% / 90% / 100%) and #2 (production-quality definition) block concrete scope definition for task-035 + feat-009 plans. Resolve those two before approving the follow-up plans; the other 3 can surface during plan authoring.

**Status**: Findings + Recommendation complete. Ready for human review + follow-up plan creation.
