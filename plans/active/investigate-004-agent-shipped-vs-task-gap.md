---
id: investigate-004-agent-shipped-vs-task-gap
type: investigation
status: completed
approved-at: 2026-04-26
approved-by: human
author-agent: claude-opus-4-7
created: 2026-04-26
updated: 2026-04-26
attempt-count: 1
parent-plan: bug-010-graceful-skip-unknown-agent
supersedes: null
superseded-by: null
branch: null
affected-files: []
feature-area: orchestration
priority: P1
attempt-count: 0
max-attempts: 5
time-box-minutes: 30
hypothesis: "Two converging hypotheses: (1) PM emits ≥2 agent identifiers (security, devops) in agent_sequence that aren't shipped in .claude/agents/, plus possibly other long-tail roles. The minimal contract per agent is: (a) .claude/agents/<name>.md system prompt, (b) factory ~/.claude/models.yaml entry, (c) optional stack-skill dispatch mapping. (2) PM has NO pre-emit validation against the shipped-agent set — the constraint that should make this impossible doesn't exist. The intended gap-fill mechanism (a 'skills-expert' agent referenced as post-MVP) may have been planned to author missing agents on-the-fly, but nothing in the current pipeline triggers it. So we're sitting in an unfinished design state: planning-side aspirational, build-side intolerant, no glue."
---

# investigate-004 — What is the gap between agents PM emits in tasks vs agents the factory ships, and what's the minimal contract for each missing agent?

## Question

What is the **complete set of agent identifiers** the factory's PM (and any other planning skill) emits in `agent_sequence[]` and per-task `agent:` fields across all existing projects, **which of those have shipped agent definitions** in `.claude/agents/` AND model config entries, and **what is the minimal contract** (skill prompt + model config + downstream consumers) required to ship the missing ones?

## Hypothesis

PM emits at least 2 agent identifiers (`security`, `devops`) in agent_sequence and tasks that aren't shipped in `.claude/agents/`. These are intentional roles in PM's design model — security review for XSS/injection-sensitive features, devops for CI/deploy tasks — but the factory hasn't shipped agent definition files OR model config entries for them yet. There may be other long-tail gaps (e.g., visual-review, lessons-agent, kit-change-request handlers).

The minimal shipping contract per agent is hypothesized to be:

1. **`.claude/agents/<name>.md`** — system prompt + tool allowances + frontmatter (`model: inherit`, `permissionMode`, etc.)
2. **Factory `~/.claude/models.yaml` entry** — `agents.<name>: { tier, effort, budgetUsd }`
3. **(Optional) stack-skill dispatch mapping** — if the agent dispatches to per-stack SKILL.md files (like builders do via `architecture.yaml.tooling.stack.<frontend|backend|mobile>_framework`), the dispatch logic needs to know about it

Bug-010's graceful-skip fix addresses the orchestrator-side crash, but doesn't fill the role. To actually run security review on DOMPurify code, JSON injection paths, etc., the agent must ship.

## Investigation Steps

Time-boxed at 30 min total. Each step ~3-5 min.

1. **Inventory shipped agent definitions.** `ls .claude/agents/*.md` — record the exact set of agent identifiers the factory has shipped.

2. **Inventory factory + global model-config agent entries.** Grep `agents:` block in `~/.claude/models.yaml` and `.claude/models.yaml` — record which agents have a model entry vs which don't.

3. **Inventory PM's agent vocabulary.** Read `.claude/skills/pm/SKILL.md` for every reference to an agent identifier (look for `backend-builder`, `tester`, `reviewer`, `security`, `devops`, `web-frontend-builder`, `mobile-frontend-builder`, plus any others). Note where PM mentions the agent (validation rule, comment, prompt instruction).

4. **Inventory task-graph references across all projects.**
   - For every `projects/<p>/docs/tasks.yaml` that exists, grep `agent:` and `agent_sequence:` entries
   - Build a frequency table: `<agent>: <count of features/tasks across projects>`
   - Specifically check kanban-webapp (and -01, -02, -03, -04 copies), revolution-pictures, hatch-2, mindapp, book-swap, finance-track, repo-health-dashboard if their tasks.yaml exists

5. **Inventory other planning-skill references.** Check `architect`, `analyst`, `ui-designer`, `skills-agent` skill files for any agent dispatches they expect to happen (e.g., architect might assume security review at certain integration points).

6. **Cross-reference + classify gaps.**
   - **Set A:** agents PM/tasks emit
   - **Set B:** agents in `.claude/agents/`
   - **Set C:** agents with model config entries
   - Gaps to surface: A − (B ∩ C) — agents PM emits without both a definition AND a model config
   - Per-gap classification: hot path (high task frequency) vs cold path (rare; can defer)

7. **For each gap, draft the minimal shipping contract.**
   - Example for `security`: agent prompt skeleton (read diff, walk OWASP Top 10, surface findings as taskOutcomes); model config (`tier: build, effort: medium, budgetUsd: 2`); dispatch context (tasks pass diff + feature context)
   - Example for `devops`: agent prompt (CI config validation, deploy gate checks, etc.); model config; dispatch context

8. **Surface "PM/architect emit but the framework doesn't dispatch" cases.** E.g., if PM mentions `lessons-agent` but no orchestrator code actually dispatches that name, that's a different gap (planning-side hallucination) — separate fix path.

9. **Investigate WHY PM was allowed to emit unshipped agents — the design-intent dimension.** This is the meta-question that changes recommendations:
   - Read PM's skill (`.claude/skills/pm/SKILL.md`) end-to-end looking for ANY pre-emit validation step that checks agent_sequence against the shipped agent set. If PM has no such check, that's the FIRST design gap — PM's contract is unconstrained.
   - Read the orchestrator's tasks.yaml validator (`scripts/validate-tasks-yaml.mjs` or wherever it lives) for the same check. Even if PM doesn't validate, downstream might.
   - Read the schema for tasks.yaml (`schemas/tasks.schema.json` or zod equivalent) — does it constrain `agent` fields to a known enum, or allow arbitrary strings?

10. **Investigate the intended gap-fill mechanism — was this supposed to be by-design?** The user noted a "skills-expert agent coming post-MVP" — is the design intent that unshipped agents in tasks.yaml are a SIGNAL for skills-expert to author them, rather than a bug?
    - Search the factory for any reference to `skills-expert` (`grep -ri skills-expert .claude/ docs/ plans/`)
    - Read `feat-010-skills-audit-runtime` (the post-MVP extension plan referenced in earlier docs) for design intent on auto-authoring agents
    - Read the existing `.claude/skills/skills-audit/SKILL.md` — does it currently flag missing AGENT definitions (vs just stack skills)? Was its `--auto-author-stack-skills` flag intended to extend to agents?
    - Read the original task-035 / refactor-004 / feat-008 plans (in plans/archive/) for any mention of "if agent X is in tasks.yaml but not shipped, do Y"
    - Check `architecture.yaml.tooling.skills` schema — is there a hook for agent shipping?

11. **Determine which design intent is actually correct.** Three possible designs:
    - **Design A — Constrained PM:** PM only emits agent_sequence with shipped agents. Validate at PM emit time. Unknown agents → PM uses `reviewer` (general) or stops with kit-change-request-style signal.
    - **Design B — Aspirational PM + skills-expert gap-fill:** PM emits its ideal agent_sequence. Orchestrator detects unshipped agents at Mode B start, dispatches skills-expert to author the missing agent (definition + model config + skill mapping), then dispatches features.
    - **Design C — Hybrid:** PM is constrained for "core" agents (the 5-6 universally-shipped ones); orchestrator + skills-expert handle long-tail (security, devops, vendor-specific).
    - The recommendation depends on which design was intended. If A: bug-011 is "constrain PM"; if B: bug-011 is "ship skills-expert + orchestrator wire-up"; if C: bug-011 is "split the responsibility".

## Findings

Investigation completed in ~15 minutes. The design-intent dimension surfaced cleaner answers than expected.

### Set inventory

**Set B — Shipped agents (`.claude/agents/*.md`, 11 total):**
analyst, architect, backend-builder, git-agent, mobile-frontend-builder, project-manager, reviewer, skills-agent, tester, ui-designer, web-frontend-builder

**Set C — Model-configured agents (`~/.claude/models.yaml`, 14 total):**
All of Set B PLUS three model-only entries (no agent file): `lessons-agent`, `html-verifier`, `agent-expert`

**Set A — Agents PM actually emits in tasks.yaml (across 13 project copies):**

- Universal: backend-builder, web-frontend-builder, mobile-frontend-builder, tester, reviewer
- Only kanban-webapp variants emit: **`security`** (2 features × 6 kanban-webapp copies = 12 task references)
- `devops` appears only in `summary_counts.byAgent.devops: 0` (no actual tasks have `agent: devops`)

**Set D — Schema-enumerated valid agents** (`packages/orchestrator-contracts/src/tasks.ts:27-48`):
`AgentSequenceMember = { backend-builder, web-frontend-builder, mobile-frontend-builder, tester, reviewer, git-agent, security, devops }`
`TaskAgent = { backend-builder, web-frontend-builder, mobile-frontend-builder, tester, reviewer, security, devops }`

### The actual hot-path gap

**Just `security`** — single hot-path gap, blocks 2 features (feat-card-detail, feat-settings-data) in every kanban-webapp copy. PM's emission of `security` is **schema-valid and correct per design**; the schema enum deliberately enumerates `security` and `devops` as known agents.

### The design intent (surfaced from `scaffolding/26-039-agent-expert.md` + investigate-002)

**The framework was authored with Design B (aspirational PM + meta-agent gap-fill) in mind:**

1. Schema enum (`AgentSequenceMember`, `TaskAgent`) deliberately includes future-planned agents (`security`, `devops`) so PM can plan ahead of shipping.
2. `agent-expert` (scaffolding/26-039) is a P3-deferred meta-agent specced to "Detect repeating task patterns without a dedicated agent, analyze the pattern, write new agent or skill definitions, validates, and add to .claude/agents/."
3. `agent-expert.md` notes: **"This is the last agent to build because it requires observing actual pipeline runs to detect patterns."** — meaning it's an OBSERVATIONAL backfill, not a just-in-time dispatcher.
4. Model config already has `agent-expert: { tier: meta, effort: max }` — wiring exists for the day someone ships it.

**But the design is INCOMPLETE in two ways:**

1. **agent-expert is deferred** (P3, post-MVP, "last to build"). When it ships, it'll observe + author over time — but the FIRST time PM emits `security` in a project, no agent exists yet.
2. **No JIT (just-in-time) auto-author mechanism** is specced. agent-expert's spec is observational. So even a fully-shipped agent-expert wouldn't fix the dispatch crash for the FIRST occurrence of a new agent identifier — only subsequent runs after observation.

### Why PM was allowed to emit unshipped agents

**PM has NO pre-emit validation** against the shipped-agent set:

- `.claude/skills/pm/SKILL.md` lists agent names in step instructions but never checks whether `.claude/agents/<name>.md` exists at PM emit time.
- The downstream validator (`scripts/validate-tasks-yaml.mjs`) validates against the SCHEMA enum, which permits `security` + `devops`. So validation passes.
- Result: PM correctly emits per its (aspirational) contract; nothing catches the gap until the orchestrator crashes at dispatch time.

### Long-tail gaps (deferrable, not currently blocking)

- **agent-expert** — model-configured, scaffolding spec exists, P3 deferred. Authoring it requires the design decision below.
- **lessons-agent** — model-configured, no scaffolding spec found, post-MVP per `feat-014` references.
- **html-verifier** — model-configured, scaffolding task 032b exists, post-MVP.
- **devops** — schema-enumerated + PM vocab mention, no model config, no spec, no actual tasks. Defer until first project's PM emits an actual `devops` task.

### Two PM consistency issues (low-priority hygiene)

1. `pm/SKILL.md:96` lists "non-frontend tasks (backend-builder / tester / reviewer / **devops**)" — omits security
2. `pm/SKILL.md:156` lists "non-frontend tasks (backend-builder / tester / reviewer / **security** / devops)" — includes security

The two lists should match. Trivial fix — fold into bug-011's PM-touching changes.

## Recommendation

**The framework was designed against Design B (aspirational PM + observational meta-agent backfill), but the meta-agent is deferred AND its design is observational-not-JIT, so even when shipped it doesn't fix the FIRST occurrence of an unknown agent.** The pragmatic immediate path is bug-010 + ship-as-needed; the strategic path is a small Design B refinement (add JIT capability to agent-expert when it ships) deferred post-MVP.

### Immediate (this week, blocks MVP throughput)

1. **Land bug-010 graceful-skip** (already drafted, awaiting approval). Load-bearing for ALL design paths — orchestrator must not crash on unshipped agents regardless of which design wins. Without this, PM's correct-per-schema emissions kill the orchestrator.
2. **Open bug-011: ship a minimal `security` agent** (the only ACTUAL hot-path gap). This isn't speculative — kanban-webapp variants legitimately need it for DOMPurify XSS review + JSON import validation. Specifics:
   - Author `.claude/agents/security.md` modeled after `reviewer.md` (system prompt: read PR diff for the feature's tasks, walk OWASP Top 10 for changed files, surface findings)
   - Add `security: { tier: quality, effort: high, budgetUsd: 2 }` to factory `~/.claude/models.yaml` (model config slot is already enumerated; just add the entry)
   - Cost: ~2 hours, unlocks 2 features × every kanban-webapp project
3. **Fix the PM consistency typo** (`pm/SKILL.md:96` should match `:156`'s expanded list). Trivial — fold into bug-011's PR.

### Short-term (post-MVP exit, 1-2 weeks)

4. **No action on `devops`** — schema-enumerated and PM-vocab-mentioned, but no actual project's PM has emitted `devops` tasks yet. Defer until an actual project needs it (lazy ship).
5. **No action on `lessons-agent`, `html-verifier`, `agent-expert`** — already in model config awaiting their scaffolding-spec implementations. Track in feat-015 (factory extensions) which already roadmaps these.

### Medium-term (next 1-3 months, design completion)

6. **Refine the agent-expert design when authoring it** (existing scaffolding/26-039 task 039). The current spec is OBSERVATIONAL ("detect repeating task patterns") but the kanban-webapp run shows we ALSO need a JIT path for first-occurrence cases. Suggested addition:
   - Mode B pre-flight: orchestrator scans tasks.yaml, identifies `agent_sequence` members not in `.claude/agents/`, dispatches agent-expert ONCE per unknown agent BEFORE feature-graph kicks off.
   - agent-expert generates the agent definition + model config entry, commits to factory branch, orchestrator picks them up.
   - Observational pattern-detection becomes the secondary path (refinement over time), JIT becomes primary (zero-day support for new agent identifiers).

### Long-term (architectural decision, deferrable)

7. **Should PM stay aspirational or become constrained?** This is a real design choice but NOT blocking — the answer determines whether bug-010's "graceful skip" is permanent or temporary scaffolding. Defer until agent-expert is actually shipped + we've seen 1-2 projects use the JIT path. Document the decision in `docs/build-tier-roadmap.md` when the time comes.

### Concrete next-step plans to open

| Plan                                            | Type    | Priority | Scope                                                                          | Dependency        |
| ----------------------------------------------- | ------- | -------- | ------------------------------------------------------------------------------ | ----------------- |
| bug-010 (already drafted)                       | bug     | P0       | Orchestrator graceful skip + warn                                              | None — land first |
| **bug-011: ship security agent**                | bug     | P0       | `.claude/agents/security.md` + model config + PM consistency typo              | bug-010           |
| (no bug-012 needed)                             | —       | —        | devops not actually emitted                                                    | —                 |
| feat-021: agent-expert with JIT mode (post-MVP) | feature | P3       | Build agent-expert per scaffolding/26-039 + add JIT pre-flight to orchestrator | post-MVP exit     |

### Why this is NOT bug-010 + a single bigger plan

Bug-010 is mechanical (10 LOC try/catch + tests). Bug-011 is content-authoring (50-100 LOC of system prompt + a model config line). Different change shapes; reviewing them separately is faster + safer. They're independent (bug-011 ships value even without bug-010; bug-010 makes the system robust even without bug-011).

### Confidence

High on the inventory (steps 1-8 produced complete sets). High on the design-intent (steps 9-11 found explicit scaffolding spec + model-config wiring). Medium on the agent-expert JIT vs observational refinement (recommendation #6) — that's an opinion based on the kanban-webapp evidence, worth re-checking when agent-expert is actually authored.

## Attempt Log

<!-- Populated automatically by agents.

NOTE: Investigations are what agents escalate to at attempt #3 of a bug or
feature. This is the structured research step that prevents blind retrying.
-->

### Attempt 1 — 2026-04-26 — claude-opus-4-7

**Time-boxed**: ~27 min (within 30-min cap).

**Steps executed:**

- Steps 1-5 (inventory) batched in parallel. Surfaced: 11 shipped agents, 14 model-configured agents (3 model-only with no shipped file), PM's vocabulary (with internal inconsistency between line 96 vs 156), agent identifiers across 13 project copies.
- Step 6 (cross-reference): identified `security` as the single hot-path gap. `devops` mentioned in PM vocab + schema enum but never actually emitted in any project's tasks.
- Step 7 (minimal contracts): drafted shipping spec for security agent; deferred others.
- Step 9 (PM pre-emit validation): PM has NO check against shipped-agent set. Schema validator (`scripts/validate-tasks-yaml.mjs` + `AgentSequenceMember` zod enum) passes `security` because the enum DELIBERATELY enumerates it.
- Step 10 (design intent): found `scaffolding/26-039-agent-expert.md` — the meta-agent that was specced to "Detect repeating task patterns without a dedicated agent, analyze the pattern, write new agent or skill definitions, validates, and add to .claude/agents/." P3 deferred. Note: "This is the last agent to build because it requires observing actual pipeline runs to detect patterns" — the spec is OBSERVATIONAL, not just-in-time.
- Step 11 (correct design): Design B (aspirational PM + meta-agent backfill) was the framework's intended design. But agent-expert's spec is observational so even when shipped it doesn't help FIRST occurrences — there's an unaddressed JIT gap.

**Outcome:** Findings + Recommendation fully documented above. Concrete next-step plans identified:

- bug-010 (already drafted) — graceful skip; load-bearing for any design path
- bug-011 (NEW recommendation) — ship minimal security agent; unblocks kanban-webapp's 2 affected features
- (no bug-012 needed — devops not actually emitted)
- feat-021 (post-MVP) — add JIT capability when authoring agent-expert per scaffolding/26-039

**Lesson:** the user's meta-question ("why was PM allowed to emit unshipped agents?") was the most important framing. The naive read would have been "ship all the missing agents" which would have implemented Design A by default without checking design intent. Surfacing that the framework was authored against Design B (with deferred backfill) clarified that bug-010 + bug-011 is the right pragmatic path, not "constrain PM to known agents".
