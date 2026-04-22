# agent-expert-meta-agent

**Deferred from**: investigate-002-build-tier-readiness-gap §Deferred; scaffolding task 039.

## The concern

Blueprint §21 mentions a meta-agent that authors new agents. Scaffolding task 039 specifies it with dependency on lessons-agent (037) + skills-agent (038). Idea: when a new capability needs a new agent (e.g. a specialised "accessibility auditor" separate from reviewer), the agent-expert walks you through authoring the agent file + skill + hooking it in.

## Why deferred

Authoring new agents is rare — we've hand-authored every agent in the factory so far without friction. A meta-agent is cool-factor, not need-factor. Human developers can follow the existing patterns (read analyst.md, ui-designer.md, git-agent.md) + write a new one by hand faster than a meta-agent would reason through the same task.

## Rough shape when it's time

**`/agent-expert <new-agent-name> --scope "<one-line description>"`** — walks the user through:

1. Gather scope (what does this agent own that existing agents don't?)
2. Emit agent-file template matching factory conventions (frontmatter shape, system-prompt structure)
3. Emit skill-file template (or skip if the new agent is just an extension of an existing skill)
4. Wire into `scaffolding/` with the next task-id number
5. If the agent needs a new output schema, emit stub in `schemas/` + Zod mirror in `09-034b`
6. Register with orchestrator's STAGES[] or feature-graph `agent_sequence` enum if required

Estimated size: small plan. ~150 LOC skill + agent template bank.

## When to revisit

When the factory needs its 4th+ new agent AND a human hand-authoring one hits friction. Realistically: v2 or v3. Not urgent.
