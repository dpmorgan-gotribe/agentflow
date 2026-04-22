---
id: investigate-001-post-design-pipeline-architecture
type: investigation
status: archived
author-agent: human
created: 2026-04-22
updated: 2026-04-22
completed: 2026-04-22
parent-plan: null
supersedes: null
superseded-by: null
branch: null
affected-files: []
feature-area: orchestration
priority: P1
attempt-count: 0
max-attempts: 5
time-box-minutes: 75
hypothesis: |
  The blueprint already anticipates several of these shifts (task-driven routing,
  tech-stack skills) but the implementation hasn't caught up. The post-design
  pipeline is likely hard-wired in the orchestrator spec (035) today, and the
  builders are stack-specific (build-web = Next.js, build-mobile = Expo) rather
  than stack-agnostic. Git-worktree checkout and ".claude/ privacy" are the two
  areas most likely to be genuinely missing rather than under-implemented.
---

# investigate-001-post-design-pipeline-architecture: Five entangled architectural concerns before /architect, /pm, builders, tester, and git-agent ship

## Question

**Integrated:** What's the right shape for the factory's post-design stack — git worktree discipline, tech-stack agnostic builders with per-stack skill packs, TDD vs tester-built E2E, non-linear task-driven orchestration, and project-repo privacy — given what the blueprint + scaffolding already anticipate?

**Five sub-questions**, each individually falsifiable:

1. **Git worktrees per feature.** Should the git agent checkout a worktree before each feature's work begins? Should PM define which work goes into which worktree? How does this interact with the existing `.claude/worktrees/` directory created by `/new-project`?

2. **Tech-stack agnostic builders + per-stack skills.** User envisions `.claude/skills/agents/front-end/{React,Svelte,Vue,...}/SKILL.md` + same shape for back-end / mobile. Architect decides stack; builders dynamically consult the matching stack skill. Is this already signalled anywhere in `multi-agent-app-generation-blueprint.md`? What's the blast radius of making the current build-web / build-mobile / build-backend agents stack-agnostic?

3. **TDD vs tester-built E2E.** Should builders write + confirm unit tests TDD-style as they go? Should the tester agent build E2E + run full test suites? Or both? What does the current `/test` + `/review` skill set assume?

4. **Non-linear post-design orchestration.** User wants the linear pipeline ONLY through: `/analyze` → `/mockups` → `/stylesheet` → `/screens` → `/architect` → `/pm` → git-agent (worktree checkout). After that, each task in `tasks.yaml` should declare its own agent sequence (some tasks skip frontend, some skip backend). Orchestrator routes task between named agents per that declared order; when all complete, git-agent merges (or bounces conflicts back to the implementing agent). Next feature unblocks. Is this task-driven DAG what the blueprint + task 035 orchestrator spec already plan for, or is the post-design pipeline currently hard-wired?

5. **Project git repo scope — hide the agentic layer?** Should `projects/<name>/.git` track the `.claude/` tree + hooks + plans + skills + contexts, or exclude them? User concern: if the project repo is pushed public, the agentic layer leaks. Options:
   - (a) Keep current (track everything)
   - (b) Split into two repos (app code vs agentic)
   - (c) Use `.gitignore` selectively to hide agentic files but leave them on disk
   - (d) Make this a `/new-project` flag (`--agentic-visibility=public|private|split`)

**Entanglement:** per-stack skills affect builder architecture, which affects task-driven orchestration, which affects what git-agent checks out, which affects whether `.claude/` is in the repo.

## Hypothesis

The blueprint already anticipates several of these shifts but the implementation hasn't caught up:

- **Task-driven routing (Q4)** — likely already the design intent in the blueprint / task 035; current shape is probably a hard-wired `/build-backend → /build-web → /test → /review → /git` chain that needs to become task-graph driven. Medium lift.
- **Per-stack skills (Q2)** — blueprint probably mentions `skills-audit --scope=build` but doesn't spec the per-stack-skill shelf. Builders are likely stack-specific today (build-web hardcoded to Next.js, build-mobile hardcoded to Expo). Converting to stack-agnostic builders that dispatch into stack skills is a moderate refactor touching every build agent + the skills-audit flow.
- **Git worktrees (Q1)** — `/new-project` creates `.claude/worktrees/` but it's likely just a placeholder. No existing git-agent that checks out worktrees per feature. Probably greenfield.
- **TDD (Q3)** — current `/test` + `/review` skills probably assume builders don't write tests; tester runs a suite the builders produced OR builds tests after the fact. TDD-as-default would be a policy flip, not a structural change.
- **Agentic privacy (Q5)** — probably zero prior thought. Current `/new-project` almost certainly commits everything under `projects/<name>/`. Adding a flag + `.gitignore` strategy is a small, self-contained change.

Research will confirm or falsify these guesses per concern.

## Investigation Steps

### Phase 1 — Read the source of truth (20 min)

1. **Read `multi-agent-app-generation-blueprint.md`** at factory root. Extract:
   - Post-design pipeline shape (is it linear or task-driven?)
   - Any mention of per-stack skills / skills-audit scope=build
   - Git-agent + worktree protocol
   - Tester vs builder test-writing responsibility
   - Anything about agentic-layer privacy / repo split

2. **Read `scaffolding/000-scaffolding-index.md`** and scan `scaffolding/` + `scaffolding/archive/` for tasks that touch:
   - Orchestrator (task 035)
   - Architect (task 020)
   - PM (task 021)
   - Builders (build-backend / build-web / build-mobile — whatever IDs)
   - Tester / review / git
   - Skills-audit scope=build
   - `/new-project` v1 spec (the one currently implemented)

### Phase 2 — Survey the current implementation (20 min)

3. **List `.claude/agents/`** — which agents exist today vs which the blueprint expects. Read the frontmatter of: architect, pm, build-backend, build-web, build-mobile, tester, review, git (whichever exist).

4. **List `.claude/skills/`** — which skills exist today. Focus on: architect, pm, build-\*, test, review, git, skills-audit, skills-audit (scope=build variant). Note which have frontmatter `--scope=build` or stack-related flags.

5. **Read `.claude/skills/new-project/SKILL.md`** — steps 4 (file seeding) + 6 (project-level files incl. CLAUDE.md + `.gitignore`) + 8 (git init). Find what's tracked vs ignored today.

6. **Read `projects/mindapp-v2/.gitignore`** and `projects/mindapp-v2/.claude/CLAUDE.md` for the realised state. Compare to the /new-project template.

7. **Check if `docs/tasks.yaml` spec exists anywhere** — blueprint, scaffolding, or an existing schema file. If it does, read its shape — does it declare per-task agent sequences or assume a fixed pipeline?

### Phase 3 — Evaluate each concern (30 min)

Per concern:

- **Q1 Git worktrees**: does any current agent / skill create worktrees? Is there a git-agent definition or just a `/git` skill? What does the PM task-graph schema (if any) carry — a `worktree: <name>` field, a `branch: <name>` field, nothing? Recommendation options: (a) PM assigns worktrees per task/feature, git-agent checks out before first build agent touches work, merges after all required agents complete; (b) per-task branch without worktree (simpler, but no multi-feature parallelism); (c) per-feature worktree with PM grouping related tasks.

- **Q2 Tech-stack skills**: grep the blueprint for "stack", "React", "Expo", "Next.js", "FastAPI", etc. Count current builder agents. Look for any existing skills-audit scope=build spec. Compare to user's proposed shelf: `.claude/skills/agents/front-end/{React,Svelte,Vue}/SKILL.md`, `.claude/skills/agents/back-end/{Node-tRPC,FastAPI,Go-chi,...}/SKILL.md`, `.claude/skills/agents/mobile/{Expo-RN,Flutter,native-iOS}/SKILL.md`. Recommendation options: (a) keep builders stack-agnostic + dispatch via stack skill lookup from `architecture.yaml.tooling.stack`; (b) keep builders stack-named (Next.js builder, Expo builder) but generate new builder-per-stack on first use via skills-audit; (c) single monolithic builder that loads stack skill like an addon.

- **Q3 TDD vs tester**: read `/test` and `/review` skills (whichever exist) and the blueprint's testing philosophy section. Does it already say "builders write tests"? Is there a `--tdd` flag anywhere? Recommendation options: (a) builders write unit/integration tests for their own code, tester builds E2E + runs full suite; (b) tester writes all tests after builders ship; (c) hybrid — builders write happy-path unit tests, tester adds edge-case + E2E.

- **Q4 Task-driven orchestration**: read task 035 orchestrator spec (if it exists as a scaffolding file). Today's pipeline likely looks like `const stages = [analyze, mockups, stylesheet, screens, architect, pm, build-backend, build-web, test, review, git]`. User wants: `const designStages = [...]; for (const task of tasks.yaml) { runTask(task.agentSequence) }`. Check if `tasks.yaml` carries an `agents: [...]` field today or if it's implied by task `type:`. Recommendation options: (a) extend `tasks.yaml` schema with `required_agents: [...]` per task; orchestrator reads and routes; (b) infer from `type: api | ui | mobile | infra` → fixed-per-type sequence; (c) full DAG w/ explicit dependencies.

- **Q5 Agentic privacy**: read `/new-project` step 6 — what's in `.gitignore`? Check `projects/mindapp-v2/.gitignore`. Recommendation options: (a) add flag `--agentic-visibility=tracked|gitignored|split` to `/new-project`; (b) default to gitignored `.claude/`, `plans/`, `contexts/`, `hooks/`, `pipeline/` + track only app code + brief.md + docs/; (c) two git roots — the project itself at `projects/<name>/` (tracks .claude/\*), apps at `projects/<name>/apps/` (public-ready).

### Phase 4 — Integrate + write findings + recommendations (5 min)

8. **Write the Findings section** — one sub-section per concern with bullet-pointed observations + file citations.

9. **Write the Recommendation section** — one sub-section per concern with the preferred option + justification + which downstream plans it'd spawn. End with an integrated "what changes in what order" list.

10. **Propose follow-up plans** (don't create them — just list IDs + one-line summaries) in the Recommendation. User picks which to pull into active plans.

## Findings

### Q1 — Git worktrees

- Blueprint mentions worktrees descriptively once (`multi-agent-app-generation-blueprint.md:1265`): `"claude --worktree feat-user-auth creates an isolated checkout so parallel plans don't collide"`. Line 2833 cites Cursor's "parallel agents via worktrees" as a peer pattern. No prescription, just capability awareness.
- `scaffolding/20-033-git-agent.md` (git-agent) — scope is **branch-per-plan + conventional commits + PRs**. Zero mention of worktree lifecycle, per-feature checkout, or handing worktrees between agents.
- `scaffolding/08-021-pm-agent.md` tasks.yaml shape: `{id, agent, depends-on, priority, skills, status, estimated-screens}`. No `worktree` / `feature_id` / `agent_sequence` fields.
- `scaffolding/21-035-orchestrator-core.md` — `runStage()` is process-level via `query()`; no worktree context switching.
- Current state on disk: `.claude/worktrees/` exists as gitignored placeholder (`new-project SKILL.md:195`). Empty.
- **Gap:** zero implementation. Capability available, architectural decision deferred.

### Q2 — Tech-stack agnostic builders + per-stack skills

- Blueprint is **explicitly stack-locked**: `blueprint.md:2626–2640` specifies Next.js 15 + React 19 + Tailwind + tRPC + Prisma for web; Expo + React Native + NativeWind for mobile; NestJS + tRPC + Prisma + Drizzle for backend.
- Tasks 028 (backend), 029 (web), 030 (mobile) are **single-implementation agents**, not dispatcher factories. Each hardcodes its stack. Zero Svelte/Vue/FastAPI/Django branch logic anywhere.
- `scaffolding/23-038-skills-agent.md` `--scope=build` audits **vendor SDKs** (Stripe, ThirdWeb, Mapbox, Resend) — NOT build-stack options. No existing skill authoring for per-stack idioms.
- `.claude/skills/` current state: no `agents/` subdirectory. Zero per-stack skill shelf.
- Architecture.yaml schema (task 034) is not yet deployed; its shape doesn't commit to stack choice vs stack lock.
- **Gap:** user's vision requires a full refactor — 3 dispatcher agents + schema extension + a shelf of 6-10 initial stack skills. Biggest concern by blast radius.

### Q3 — TDD vs tester-built E2E

- Blueprint is crystal clear: `scaffolding/17-031-tester-agent.md` says **tester generates ALL tests** (Vitest unit, component, integration, Playwright E2E, Maestro mobile) and **runs them to confirm they pass** (max 3 iterations on failures).
- `scaffolding/14-028-backend-builder-agent.md` step 7: "Run `pnpm typecheck` and `pnpm lint`" — **NOT** `pnpm test`. Builders do not write or run tests.
- This is **E2E-first / post-build validation**, not TDD. Tester reads "what was built" then generates tests that validate it.
- Builder's feedback loop is typecheck + lint only — no test-level signal while building.
- **Gap:** current spec is coherent but trades away the benefit of builders catching their own unit-level regressions during the build loop.

### Q4 — Non-linear task-driven orchestration

- Design pipeline IS linear and correct (STAGES array, `scaffolding/21-035-orchestrator-core.md:44-94` post refactor-003): `analyze → skills-audit-design → mockups → stylesheet → screens → visual-review → user-flows → gate-4 → architect → pm → skills-audit-build → register-mcp-build → build-backend → (build-web || build-mobile) → test → review → git`.
- tasks.yaml schema (`scaffolding/08-021-pm-agent.md:50-72`) has **`agent: <single>`** + `depends-on[]`. One agent per task.
- **Cross-cutting finding from research:** "Orchestrator is stage-linear, not task-linear. The STAGES array is stage-granularity, not task-granularity. Spec says builders read tasks.yaml but doesn't show how orchestrator assigns tasks to agents or schedules them."
- Within the build phase, builders self-select tasks by agent field — but there's no `agent_sequence` concept for tasks that need multiple agents sequentially (e.g., a feature needing backend → web → tester → reviewer).
- **Gap:** user is right that current shape is hard-wired. Post-PM needs a per-feature agent-sequence model, and features should be first-class groupings above tasks.

### Q5 — Agentic-layer privacy

- `/new-project SKILL.md:191-210` writes `.gitignore` that **ignores only**: `.claude/state/`, `.claude/worktrees/`, `pipeline/`, `node_modules/`, `.env*` (except `.env.example`), `*.pem`, `*.key`, `credentials.json`, `*.p12`, `*.pfx`, `*.keystore`, `*.jks`, `.DS_Store`, `Thumbs.db`.
- **Tracked by default**: `.claude/agents/`, `.claude/skills/`, `.claude/hooks/`, `.claude/rules/`, `.claude/CLAUDE.md`, `.claude/settings.json`, `.claude/models.yaml`, `plans/**`, `contexts/**`, `docs/**`, `CLAUDE.md`, `justfile`, `brief.md`, `companion/`, `schemas/`.
- `projects/mindapp-v2/.gitignore` confirms the shape in practice. Verified.
- Rationale per `new-project SKILL.md:16-18`: "Factory produces projects. Projects consume agentic resources. Projects evolve their agents independently after `/new-project`; factory changes don't auto-propagate."
- **Gap:** the design assumes the agentic layer SHOULD travel with the project. If the project is pushed public, prompts + skill definitions + hooks leak — a legitimate privacy concern. No flag currently exists to hide them.

### Cross-cutting observations

1. **Q4 is the foundational unlock.** Tasks 021/035 need the `features[]` + `agent_sequence[]` schema before Q1 (worktrees bind to features) or Q2 (per-task stack skill dispatch) can land correctly. Do Q4 first.
2. **Q2 is the biggest lift** — 15-20 file changes, rewrites tasks 028/029/030, extends architecture.yaml schema, introduces a new skill-authoring workflow (`skills-audit --scope=stack-skills`).
3. **Q5 is the smallest + independent** — can ship anytime, zero blocking dependencies.
4. **Q3 is a policy flip**, not a structural change — 4 task spec edits, no new tasks.
5. **Blueprint intent vs implementation gap:** the blueprint is opinionated (React everywhere, tester owns all tests, linear pipeline). If we diverge from blueprint intent on Q2 or Q3, the blueprint itself needs an update — otherwise new contributors will rebuild the old shape from the blueprint.

## Recommendation

### Integrated recommendation

Shape the post-design stack around **features as first-class primitives** between PM and builders. The design pipeline stays strictly linear (unchanged from refactor-003); the post-design layer becomes task-graph-driven:

```
Design (linear, unchanged):
/analyze → /mockups → gate-2 → /stylesheet → gate-3 →
/screens → /visual-review → /user-flows-generator → gate-4

Post-signoff architecture phase (linear, once):
/architect (picks stacks; extends architecture.yaml.tooling.stack) →
/pm (groups tasks into FEATURES with agent_sequence[]) →
/skills-audit --scope=build (authors missing stack skills) →
/git-agent-bootstrap (opens main repo state)

Per-feature build loop (parallel where depends_on permits):
for feature in tasks.yaml.features:
  git-agent: checkout worktree feat/{slug}
  for agent in feature.agent_sequence:
    agent executes its tasks in the worktree
    (builders load skills/agents/{tier}/{stack}/SKILL.md — Q2 dispatch)
    (builders generate unit tests alongside code + run pnpm test — Q3 hybrid)
  git-agent: merge feature → main (conflicts bounce back to last agent)
  downstream features unblock
```

Project scaffold adds `/new-project --agentic-visibility=private|public|split` (default `private`) so the `.claude/` tree doesn't leak when projects are pushed public.

The whole stack is ~5 plans, ordered so Q4's schema ships first (everything else binds to it).

### Per-concern

**Q1 — Git worktrees:** option **(a) PM assigns worktrees per feature; git-agent owns worktree lifecycle (create → hand to agents → merge → destroy)**.

- Rationale: parallel features is a real unlock; PM has the task-graph context to group related tasks into features; git-agent centralizes merge-conflict routing.
- Blast radius: task 021 (add feature grouping), task 033 (full worktree lifecycle rewrite), task 035 (add `runFeature()` method), tasks.yaml schema extension. ~5-8 files.
- Follow-up plan: **feature-006-git-agent-worktrees**.

**Q2 — Tech-stack agnostic builders + per-stack skills:** option **(a) keep builders stack-agnostic + dispatch via stack skill lookup from `architecture.yaml.tooling.stack`**.

- Rationale: user's stated vision is correct; locking to React+NestJS+Expo defeats the purpose of a general-purpose factory. Per-stack skills are authored once + reused across projects. Dispatch is a clean pattern — builder reads architecture.yaml, loads the right skill, composes it into its prompt.
- Schema: `architecture.yaml.tooling.stack = { web_framework, web_styling, mobile_framework, backend_language, backend_framework, orm }`. Skill shelf: `.claude/skills/agents/{front-end|back-end|mobile}/{stack-slug}/SKILL.md`.
- Ship 3-5 initial stacks pre-researched (react-next, svelte-kit, expo-rn, node-nest-trpc, python-fastapi). skills-audit-build authors the rest on demand.
- Blast radius: ~15-20 files. Rewrite tasks 028/029/030 as dispatchers, extend architecture.yaml schema + architect (020), add stack-skill authoring workflow to 038. Blueprint needs an update to acknowledge multi-stack.
- Follow-up plan: **feature-005-stack-skill-shelf**.

**Q3 — TDD vs tester-built E2E:** option **(c) hybrid — builders write + run happy-path unit tests; tester owns edge cases + integration + E2E**.

- Rationale: pure TDD is overkill for AI builders; pure post-build tester misses unit-level invariants the builder knows best. Builders generating unit tests alongside code catches regressions during the build loop (stronger gate than typecheck-only).
- Policy change, not structural: task 028/029/030 add step "generate unit tests alongside code" + "run `pnpm test <file>` in self-verify". Task 031 narrows scope: edge cases + integration + E2E + full-suite run.
- Blast radius: 4 task spec edits, no new tasks. Smallest concern-set after Q5.
- Follow-up plan: **feature-007-builder-tdd-hybrid**.

**Q4 — Task-driven orchestration:** option **(a) extend tasks.yaml with `features[]` + `agent_sequence[]`; orchestrator has two modes — stage-linear (design) + feature-graph (post-PM)**.

- Rationale: user identifies a real gap. Current tasks.yaml has `agent: <one>` per task; many tasks need a sequence (backend → web → tester → reviewer). Features group related tasks; `agent_sequence` per feature tells the orchestrator the agent order within the feature's worktree.
- Schema: `features: [{ id, worktree, branch, agent_sequence: [...], tasks: [...], skip?: [mobile|web] }]`.
- Orchestrator gets `runFeature(feature)` method: opens worktree, loops through `agent_sequence`, handles per-task retry, closes worktree on success (or signals conflict).
- Blast radius: ~10 files. Biggest rewrite on task 035 orchestrator + task 021 PM output. Foundational — Q1 and Q2 bind to this schema.
- Follow-up plan: **refactor-004-task-driven-orchestration**.

**Q5 — Agentic-layer privacy:** option **(d) `/new-project --agentic-visibility=<public|private|split>` flag, default `private`**.

- Rationale: user's concern is legitimate — pushing a project repo to a public remote today leaks `.claude/agents/` prompts + skill definitions + hooks. Default should be safer. Power users opt into `public` (factory-internal projects).
- `private` adds to `.gitignore`: `.claude/agents/`, `.claude/skills/`, `.claude/hooks/`, `.claude/rules/`, `plans/`, `contexts/`, `pipeline/`. Keeps tracked: `brief.md`, `apps/`, `packages/`, `docs/`, root config, `.env.example`, `CLAUDE.md` (sanitized project-level).
- `split` creates two git roots: outer `projects/<name>/.git` (tracks agentic layer, for factory-internal or private remote) + inner `projects/<name>/apps-and-packages/.git` (app code only, for public push).
- Blast radius: 3 files — `/new-project` SKILL (conditional `.gitignore` write), args table, docs. Smallest + fully independent. Can ship anytime.
- Follow-up plan: **feature-008-agentic-privacy-flag**.

### What changes in what order

1. **refactor-004-task-driven-orchestration (Q4)** — foundational. Extends tasks.yaml schema with `features[]` + `agent_sequence[]`; rewrites orchestrator `runFeature()`. Everything downstream binds to this schema. ~10 files.
2. **feature-005-stack-skill-shelf (Q2)** — adds `.claude/skills/agents/{tier}/{stack}/` shelf; rewrites architect + builders (028/029/030) as dispatchers; extends `architecture.yaml.tooling.stack`; seeds 3-5 initial stacks. Depends on Q4's schema. ~15-20 files.
3. **feature-006-git-agent-worktrees (Q1)** — rewrites git-agent (033) to own worktree lifecycle; PM extension to group tasks into features. Depends on Q4's `features[]` schema. ~5-8 files.
4. **feature-007-builder-tdd-hybrid (Q3)** — updates builder specs to generate + run unit tests; narrows tester scope. Can land after Q2 (otherwise every stack skill also needs a test-generation pattern). ~4 files.
5. **feature-008-agentic-privacy-flag (Q5)** — `/new-project --agentic-visibility` flag. Fully independent — can land anytime, first if you want a quick win. ~3 files.

**Recommended kickoff order:** Q5 first (smallest, fully independent, immediate user-facing benefit), then Q4 (unlocks the rest), then Q2 in parallel with Q1, then Q3 last.

**Blueprint update:** Q2 will require a blueprint revision (the current blueprint commits to React+NestJS+Expo). If we ship Q2 without updating the blueprint, new contributors will rebuild the old stack-locked shape from the blueprint. Bundle blueprint update into feature-005 acceptance criteria.

## Attempt Log

### Attempt 1 — 2026-04-22 · Phase 1 + 2 research

- Delegated to Explore subagent. Surveyed `multi-agent-app-generation-blueprint.md`, `scaffolding/000-scaffolding-index.md` + scaffolding task files, `.claude/agents/`, `.claude/skills/`, `/new-project` SKILL.md, `projects/mindapp-v2/.gitignore` + CLAUDE.md.
- Agent returned 1800-word structured findings per concern with file:line citations + blast-radius map + items not confirmed in time-box.

### Attempt 2 — 2026-04-22 · Phase 3 + 4 synthesis (main context)

- Evaluated each concern against research findings + user's stated preferences from original question.
- Wrote Findings + Recommendation sections to this plan.
- Surfaced 5 follow-up plans with ordering.
- Status → ready for human review; on approval, will create the 5 follow-up plans per the "What changes in what order" list.

<!-- Populated automatically by agents.

NOTE: Investigations are what agents escalate to at attempt #3 of a bug or feature.
  This is the structured research step that prevents blind retrying.
-->

---
# COMPLETION RECORD (appended to archived plan)
completed: 2026-04-22
outcome: success
actual-files-changed: []
commits: []  # investigation — no branch
attempts: 2
lessons:
  - "Bundling 5 entangled architectural questions into one investigation was the right call — splitting would have re-threaded the dependencies 5 times."
  - "Delegating Phase 1+2 (source survey) to an Explore agent kept the main context clean; main agent synthesized Phase 3+4 recommendations."
  - "Hypothesis-before-investigation discipline paid off — 3 of 5 hypotheses confirmed, 2 falsified with concrete evidence."
test-results:
  summary: "n/a (investigation — no branch)"
duration-minutes: 813
---
