---
id: feat-021-pm-agent-availability-and-requests
type: feature
status: draft
author-agent: claude-opus-4-7
created: 2026-04-26
updated: 2026-04-26
parent-plan: investigate-004-agent-shipped-vs-task-gap
supersedes: null
superseded-by: null
branch: feat/pm-agent-availability-and-requests
affected-files:
  - .claude/skills/pm/SKILL.md
  - packages/orchestrator-contracts/src/tasks.ts
  - packages/orchestrator-contracts/src/agent-request.ts
  - scripts/validate-tasks-yaml.mjs
  - orchestrator/src/feature-graph.ts
  - .claude/skills/skills-agent/SKILL.md
  - .claude/agents/agent-expert.md
feature-area: orchestration
priority: P2
attempt-count: 0
max-attempts: 5
---

# feat-021 — PM agent-availability awareness + agent-change-request mechanism

## Problem Statement

Per investigate-004 + bug-010 + bug-011, the factory currently has a **structural gap between PM's vocabulary and the factory's shipped agent set**:

- PM emits `agent: security` per its design model (schema enum allows it)
- Factory hasn't shipped `.claude/agents/security.md` yet
- Orchestrator crashed (pre-bug-010) or now skips silently (post-bug-010, 2026-04-26)
- bug-011 ships `security` manually — but the SAME problem will recur for `devops` / future agents

**The root design gap is two-pronged:**

1. **PM has no runtime awareness** of which agents are actually shipped in `.claude/agents/`. PM emits per the schema enum (which is aspirational). PM cannot detect "I want to dispatch X but X doesn't exist".
2. **No mechanism exists for PM to REQUEST a new agent** when it identifies a role gap. The framework's existing `kit-change-request` pattern (PM emits `docs/screens/kit-change-requests/<screen-id>.md` when a UI primitive is missing, /stylesheet ships it, pipeline resumes) has no agent-side analog.

The current state forces every gap to be a manual ship-by-bug-plan cycle (bug-011 for security, hypothetical bug-012 for devops, etc.). The factory was designed against Design B (aspirational PM + meta-agent backfill per `scaffolding/26-039-agent-expert.md`) — but the meta-agent backfill mechanism was never wired up. This plan builds it.

**Reference:** brief — n/a (this is factory-tooling, not project-spec). Design intent surfaced in `investigate-004-agent-shipped-vs-task-gap.md` Findings.

## Approach

Three-phase build mirroring the existing kit-change-request pattern:

### Phase A — PM agent-availability awareness

Goal: PM knows which agents are shipped at the moment it generates tasks.yaml.

1. **Add `readShippedAgents()` helper** to PM's runtime (or a shared utility consumed by PM + the validator). Reads `.claude/agents/*.md` from the factory + project-level overrides; returns `Set<string>` of agent identifiers.

2. **Update PM's `--mode=tasks` step 6 (or wherever agent_sequence is finalized)** to:
   - Read shipped-agent set
   - For each task PM wants to dispatch:
     - If `best-fit-agent ∈ shipped`: emit `agent: <name>` (today's behavior)
     - If `best-fit-agent ∉ shipped` AND `role is critical for this feature`: emit `agent: <name>` AND emit `docs/agent-requests/<name>.md` (Phase B's content)
     - If `best-fit-agent ∉ shipped` AND `role is nice-to-have`: emit `agent: reviewer` (general fallback) AND log a warning

3. **Update PM self-verify step** to validate the emitted tasks.yaml against the shipped-agent set (in addition to the existing schema validation). Surface any unshipped agents in the PM output report.

4. **Update `scripts/validate-tasks-yaml.mjs`** to ALSO check shipped-agent set when invoked outside PM (CI step, manual operator validation, etc.). Validation passes if every `agent` field is either in the shipped set OR has an accompanying `docs/agent-requests/<name>.md`.

### Phase B — agent-change-request schema + emit

Goal: the structured spec PM writes when it identifies a role gap.

1. **Define `AgentChangeRequest` zod schema** in `packages/orchestrator-contracts/src/agent-request.ts`:

   ```ts
   export const AgentChangeRequest = z.object({
     name: z.string().regex(/^[a-z][a-z0-9-]{1,48}$/),
     requestedBy: z.enum(["pm", "architect", "operator"]),
     requestedAt: z.string().datetime(),
     featureContext: z.string(), // which feature/feature_id triggered the request
     // Role spec (the information skills-agent / agent-expert needs)
     role: z.string().min(50), // 1-2 sentence description of what the agent does
     whenItRuns: z.string().min(20), // position in agent_sequence; pre/post conditions
     inputs: z.array(z.string()).min(1), // task summaries / featureContext / specific files
     outputs: z.string().min(50), // expected output shape (in prose); skills-agent translates to a zod schema
     toolsNeeded: z.array(z.string()).min(1), // Read/Write/Edit/Bash/Grep/Glob etc.
     similarTo: z.string().optional(), // closest existing agent (e.g. "modeled on reviewer.md") — helps skills-agent
     skillsConsumed: z.array(z.string()).optional(), // any per-stack/per-vendor skills it dispatches against
     priorityToShip: z.enum([
       "P0-blocker",
       "P1-degrades-feature",
       "P2-nice-to-have",
     ]),
   });
   ```

2. **PM emits these to `docs/agent-requests/<name>.md`** with frontmatter (the AgentChangeRequest fields) + body (richer prose explaining the role with examples). Mirror format of `docs/screens/kit-change-requests/<screen-id>.md`.

3. **Idempotent emit**: if `docs/agent-requests/<name>.md` already exists, PM appends a new "Requested again by feat-XYZ" entry to the body (don't overwrite). This lets multiple features that need the same role share a single request.

### Phase C — orchestrator pre-Mode-B agent-fulfilment dispatch

Goal: the orchestrator processes pending agent-change-requests BEFORE feature-graph kicks off.

1. **New stage `agent-fulfilment-bootstrap`** in `stages-array.ts` between `register-mcp-build` and `git-agent-bootstrap`. The stage:
   - Scans `docs/agent-requests/*.md` for any pending requests
   - For each unfulfilled request (no matching `.claude/agents/<name>.md` yet), dispatches the **skills-agent OR agent-expert** (whichever is available — see Phase D) with the AgentChangeRequest as context
   - Waits for the dispatched agent to author + commit `.claude/agents/<name>.md` + add the model config entry
   - Validates the new agent file exists + parses + has required frontmatter
   - On success: marks the request fulfilled in `docs/agent-requests/<name>.md` frontmatter (`fulfilledAt`)
   - On failure (agent author times out, validation fails, etc.): logs warning, leaves the request pending, proceeds to feature-graph (bug-010's graceful skip handles the unshipped agent at dispatch time as before)

2. **Concurrency**: agent-fulfilment is sequential (one request at a time) since each authors files in `.claude/agents/` which is shared state. Dispatching multiple skills-agent calls concurrently could conflict.

3. **Cost**: each agent-authoring dispatch ~$1-3. With ~1-2 unshipped agents per project (security + maybe devops), this adds $2-6 to Mode B startup. Worth it for autonomous role expansion vs hand-shipping each agent via bug-plan.

### Phase D — skills-agent (or agent-expert) gains author-new-agent capability

Goal: the actual agent that consumes AgentChangeRequest and ships a new agent.

The factory has TWO candidates:

- **skills-agent** (already shipped at `.claude/agents/skills-agent.md`) — currently audits skill availability + flags gaps; doesn't author. Could be extended.
- **agent-expert** (specced at `scaffolding/26-039-agent-expert.md`, P3 deferred) — the canonical answer per Design B. Specced to "Detect repeating task patterns... write new agent or skill definitions, validates, and add to .claude/agents/". This IS the right home long-term.

**Recommendation:** ship Phase D against `agent-expert` (build it to scaffolding/26-039 spec), not skills-agent. Two reasons:

1. agent-expert was specced for this; skills-agent has a different responsibility (audit). Conflating them muddies both.
2. agent-expert needs to ship eventually for the design to be complete; this plan is a natural occasion to do it.

agent-expert's prompt for the author-new-agent path:

1. Read the AgentChangeRequest + similar-to reference (e.g., reviewer.md if `similarTo: reviewer`)
2. Synthesize a system prompt grounded in the role description, when-it-runs, inputs/outputs
3. Author `.claude/agents/<name>.md` with frontmatter (tools, model: inherit, maxTurns, effort) + system prompt body
4. Author the corresponding zod schema in `packages/orchestrator-contracts/src/<name>.ts` if the agent emits structured output beyond `BuilderOutput`/`ReviewerOutput`/etc.
5. Add model config entry to factory `.claude/models.yaml` (using a reasonable tier guess based on similarTo)
6. Validate: file exists, parses, frontmatter has required fields, prompt body has required sections (role / scope / output)
7. Self-verify against tester-style "minimal dispatch sanity check" before committing

### Phase E — Tests

- PM unit test: `readShippedAgents()` returns correct set for a fixture .claude/agents/ dir
- PM unit test: emit-with-unshipped-agent → AgentChangeRequest written to disk + warning surfaced
- AgentChangeRequest schema test: parses valid examples; rejects malformed
- Orchestrator integration test: pending agent-request → agent-fulfilment-bootstrap dispatches agent-expert → mock agent-expert "ships" the agent → next stage proceeds
- agent-expert integration test (deferred to its own scaffold-039 implementation)
- E2E: a project's tasks.yaml has `agent: foo` (foo unshipped) → PM emits docs/agent-requests/foo.md → orchestrator pre-flight ships foo → foo dispatches normally during Mode B

### Phase F — Roll-out + migration

- Existing projects with `agent: security` in tasks.yaml: bug-011 ships `security` manually first; once feat-021 lands, future projects auto-request rather than depending on manual ship.
- Existing projects with `agent: devops` in summary counts but no actual tasks: no migration needed — devops never gets dispatched today.

## Rejected Alternatives

### Alternative A: constrain PM to shipped-agent enum at the schema level

**Why rejected:** Design A approach. Removes flexibility. Forces every new role to be a hand-shipped bug-plan cycle. Defeats the entire purpose of having a meta-agent like agent-expert.

### Alternative B: have PM author agents directly (skip the skills-agent/agent-expert middleman)

**Why rejected:** PM is a planning agent, not a meta-agent. PM's job is to map architecture + flows → task graph. Authoring system prompts is a different specialty (how do you write a system prompt that elicits good behavior?). Skills-agent/agent-expert is the right tier for this work; PM identifies gaps + emits requests, the meta-agent fulfills.

### Alternative C: bundle Phase D (build agent-expert) into bug-011

**Why rejected:** Bug-011 ships ONE agent (security). feat-021 builds the GENERAL mechanism. Conflating them would explode bug-011's scope from "ship one agent" to "build the meta-agent system + ship one agent". Better as separate plans with bug-011 unblocking immediate value.

### Alternative D: sync agent-fulfilment fires inside PM rather than as orchestrator pre-flight

**Why rejected:** PM is part of Mode A (design + planning). Mode A is HITL-gated and has its own stage pipeline. Adding agent-author dispatches inside PM mixes Mode A and meta-agent concerns. Cleaner: PM emits requests during Mode A; orchestrator processes them during Mode B startup.

### Alternative E: defer the entire plan to "after agent-expert ships organically"

**Why rejected:** This IS the natural occasion to ship agent-expert (Phase D). Deferring would just delay the design completion. Better to scope this plan to include shipping agent-expert with the auto-author capability + scaffolding/26-039's observational capability as separate sub-features (or split into feat-021a + feat-021b if the plan grows too large).

## Expected Outcomes

- **PM emits awareness** — every tasks.yaml run, PM knows which agents are shipped + emits AgentChangeRequest for any unshipped agent it wants to dispatch
- **Mode B auto-fulfills** — orchestrator processes pending agent-requests before feature-graph kicks off; dispatches agent-expert; new agents land + commit; Mode B runs against full agent set
- **bug-010 graceful skip becomes a never-fires safety net** — in normal operation, agent-fulfilment ships missing agents before they're dispatched; bug-010 only fires if agent-expert itself fails
- **Future role gaps self-heal** — when a new project type needs e.g. `accessibility-auditor` or `i18n-reviewer`, PM emits the request, agent-expert ships, no human bug-plan needed

## Validation Criteria

- `.claude/skills/pm/SKILL.md` updated with shipped-agent awareness step
- `packages/orchestrator-contracts/src/agent-request.ts` defines AgentChangeRequest zod schema
- `scripts/validate-tasks-yaml.mjs` validates against shipped-agent set + agent-request presence
- `orchestrator/src/feature-graph.ts` (or new stage in `stages-array.ts`) handles agent-fulfilment-bootstrap stage
- `.claude/agents/agent-expert.md` exists with author-new-agent capability (per scaffolding/26-039 + this plan's Phase D extensions)
- Test fixture: a project with `agent: foo` (foo unshipped) → PM emits request → orchestrator dispatches agent-expert → foo lands → Mode B runs normally
- Smoke test on a fresh kanban-webapp variant: orchestrator pre-flight handles `security` request automatically (post-feat-021, the manual bug-011 ship would still work but no longer be necessary for net-new projects)

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->

## References

- `plans/active/investigate-004-agent-shipped-vs-task-gap.md` — parent investigation; surfaced the design gap this plan addresses
- `plans/active/bug-010-graceful-skip-unknown-agent.md` — orchestrator-side robustness (no crash on unshipped agents) — load-bearing prerequisite
- `plans/active/bug-011-ship-security-agent.md` — ships ONE agent manually (security) for the immediate kanban-webapp need; feat-021 generalizes the mechanism
- `scaffolding/26-039-agent-expert.md` — the deferred meta-agent spec; Phase D builds against this
- `.claude/skills/pm/SKILL.md` — PM skill modified by Phases A + B
- `.claude/skills/screens/SKILL.md` (or similar) — the existing kit-change-request pattern this plan mirrors for agents
- `docs/screens/kit-change-requests/` — existing precedent for "PM identifies primitive gap → emits request → /stylesheet fulfills"
