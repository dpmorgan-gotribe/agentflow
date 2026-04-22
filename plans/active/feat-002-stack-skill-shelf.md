---
id: feat-002-stack-skill-shelf
type: feature
status: completed
completed: 2026-04-22
author-agent: human
created: 2026-04-22
updated: 2026-04-22
parent-plan: investigate-001-post-design-pipeline-architecture
supersedes: null
superseded-by: null
branch: feat/stack-skill-shelf
affected-files:
  - .claude/skills/agents/front-end/react-next/SKILL.md # new
  - .claude/skills/agents/front-end/svelte-kit/SKILL.md # new
  - .claude/skills/agents/back-end/node-trpc-nest/SKILL.md # new
  - .claude/skills/agents/back-end/python-fastapi/SKILL.md # new
  - .claude/skills/agents/mobile/expo-rn/SKILL.md # new
  - scaffolding/11-020-architect-agent.md # stack picker
  - scaffolding/14-028-backend-builder-agent.md # → dispatcher
  - scaffolding/15-029-web-frontend-builder.md # → dispatcher
  - scaffolding/16-030-mobile-frontend-builder.md # → dispatcher
  - scaffolding/23-038-skills-agent.md # stack-skill authoring workflow
  - schemas/architecture.schema.json # extend tooling.stack
  - multi-agent-app-generation-blueprint.md # blueprint revision — multi-stack
feature-area: builders
priority: P1
attempt-count: 0
max-attempts: 5
---

# feat-002-stack-skill-shelf: Tech-stack agnostic builders + `.claude/skills/agents/{tier}/{stack}/SKILL.md` shelf

## Problem Statement

Current builders (tasks 028/029/030) and the blueprint (`multi-agent-app-generation-blueprint.md` §17) hardcode a single stack: Next.js + React + Tailwind + tRPC + Prisma + NestJS + Expo. Projects with different stack preferences (FastAPI backends, Svelte frontends, Flutter mobile) have no path through the pipeline.

Closes question **Q2** of `investigate-001-post-design-pipeline-architecture`. User requested: _"builders should be tech stack agnostic - this will be decided by the architect based on the brief and whats best. Should we generate skills to compensate for tech stack skills when a tech stack is highlighted... skills/agents/front-end/React/SKILL.md and somewhere we research exactly what is the best prompt for the agent to have to work with that stack."_

Depends on **refactor-004-task-driven-orchestration** (features[].tasks[] schema); each feature's `agent_sequence` will name generic builders (backend-builder / web-frontend-builder / mobile-frontend-builder) that dispatch into the stack skill based on `architecture.yaml.tooling.stack`.

## Approach

1. **Define the shelf structure** — `.claude/skills/agents/{tier}/{stack-slug}/SKILL.md`. Tiers: `front-end`, `back-end`, `mobile`. Each stack skill is a self-contained prompt pack: canonical project layout, idiomatic patterns, testing recipe (binds to Q3), gotchas, tooling commands (`lint`, `typecheck`, `test`, `build`, `dev`), dependency versions, anti-patterns.

2. **Author 5 initial stack skills** pre-researched:
   - `front-end/react-next/SKILL.md` — Next.js 15 + React 19 + Tailwind 4 + TypeScript + Vitest + Playwright
   - `front-end/svelte-kit/SKILL.md` — SvelteKit 2 + TS + Tailwind + Vitest + Playwright
   - `back-end/node-trpc-nest/SKILL.md` — NestJS + tRPC + Prisma + Zod + Vitest
   - `back-end/python-fastapi/SKILL.md` — FastAPI + SQLAlchemy + Alembic + Pydantic + pytest
   - `mobile/expo-rn/SKILL.md` — Expo SDK 52 + RN + NativeWind + jest-expo + Maestro

3. **Extend `schemas/architecture.schema.json`** with `tooling.stack`:

   ```yaml
   tooling:
     stack:
       web_framework: "react-next" | "svelte-kit" | "remix" | "astro" | "qwik" | null
       web_styling: "tailwind" | "vanilla-extract" | "css-modules"
       mobile_framework: "expo-rn" | "flutter" | "tauri-mobile" | null
       backend_language: "node" | "python" | "go" | "rust"
       backend_framework: "node-trpc-nest" | "node-trpc-only" | "python-fastapi" | "python-django" | "go-chi"
       orm: "prisma" | "drizzle" | "sqlalchemy" | "diesel" | null
   ```

   Values are stack-slugs matching skill shelf paths (`web_framework: "react-next"` → `skills/agents/front-end/react-next/SKILL.md`).

4. **Rewrite architect (task 020)** — add "stack-pick" sub-step: architect reads brief §7 (Architecture & Deliverables) + §8 (Build Decisions) + `docs/analysis/shared/integrations-options.md` + competitor stacks from `docs/analysis/shared/competitors.md`, chooses a stack per slot, writes to `architecture.yaml.tooling.stack`. Brief-hinted stack (e.g. "FastAPI" explicitly named) wins; else architect picks from the candidates per slot, justifies the pick in a `stackRationale[]` block.

5. **Rewrite builders (tasks 028/029/030) as dispatchers.** Each builder:
   - Reads `architecture.yaml.tooling.stack.<relevant-slot>`
   - Loads `skills/agents/<tier>/<stack-slug>/SKILL.md` verbatim into its composition prompt
   - Executes tasks from `tasks.yaml.features[].tasks[]` filtered to `agent: <self>`
   - Stack skill provides the stack-specific commands (lint / typecheck / test) the builder runs in self-verify

6. **Extend `/skills-audit --scope=build` (task 038)** with stack-skill discovery:
   - If `architecture.yaml.tooling.stack.<slot>` points to a stack-slug that lacks a `SKILL.md` on disk, either (a) fail with "Stack skill not shipped; author required" OR (b) auto-research the stack via WebSearch/WebFetch and draft a new SKILL.md for HITL review. Default to (a) for v1; flag `--auto-author-stack-skills` for v2.

7. **Blueprint revision** — update `multi-agent-app-generation-blueprint.md` §17 to describe the multi-stack model. Current §17 ("React/React Native stack") becomes "Stack selection + skill shelf", and React becomes one of several documented defaults, not THE stack.

8. **Seed skill template** — create `.claude/skills/agents/_template/SKILL.md` (stack-skill authoring template) so future additions follow the same shape: frontmatter + §Canonical layout + §Idioms + §Testing + §Commands + §Gotchas + §Dependency pins.

## Rejected Alternatives

- **Alternative A: Keep builders stack-named (next-js-builder, svelte-kit-builder, fastapi-builder, ...)** — Rejected. Proliferates agent definitions with high overlap. Hard to add a new stack (needs a full agent + skill). Dispatcher pattern keeps agents thin; stacks are prompt packs.

- **Alternative B: Single monolithic builder that loads the stack skill as an addon** — Rejected. Collapses backend/web/mobile into one agent. Loses the task-routing benefit of distinct `agent: backend-builder | web-frontend-builder | mobile-frontend-builder` fields in tasks.yaml. Three dispatcher agents keeps the separation.

- **Alternative C: Author skills dynamically per-project on first run rather than shipping a pre-researched shelf** — Rejected for v1. Pre-researched skills ensure quality + consistency. Dynamic authoring is valuable for long-tail stacks but should be opt-in (flag `--auto-author-stack-skills`) to avoid silent drift.

## Expected Outcomes

- [x] `.claude/skills/agents/{front-end,back-end,mobile}/{5 initial stack slugs}/SKILL.md` exist and validate against the `_template/SKILL.md` shape
- [x] `schemas/architecture.schema.json` includes `tooling.stack` with enum constraints matching shipped stack slugs
- [x] Architect scaffolding (`scaffolding/07-020-architect-agent.md`) documents the stack-pick sub-step + `stackRationale[]` output
- [x] Builder scaffolding files (028/029/030) rewritten as dispatchers — no hardcoded framework references remain in agent definitions; each reads `architecture.yaml.tooling.stack.<slot>` + loads the matching stack skill
- [x] `scaffolding/23-038-skills-agent.md` documents stack-skill discovery for `--scope=build` (shipped/draft/auto-author paths + 90-day freshness)
- [x] Blueprint §17 supersession note + Appendix E (feat-002 Stack-Skill Shelf) published
- [ ] Test: pick a non-default stack (e.g. svelte-kit + fastapi) in a fixture `architecture.yaml`, confirm orchestrator dry-run logs loading svelte-kit + fastapi skills — deferred to post-orchestrator-implementation (task 035 runtime)

## Validation Criteria

**Schema:**

- ajv validates the new `architecture.schema.json.tooling.stack` subtree
- Invalid combinations (e.g. `backend_language: "python", backend_framework: "node-trpc-nest"`) rejected — add cross-field validation rule

**Skill shelf:**

- Each of the 5 initial SKILL.md files: frontmatter parses, §Commands block contains `lint` + `typecheck` + `test` entries, §Dependency pins names exact versions
- Spot-check: open each SKILL.md in a browser + verify it reads as a self-contained prompt pack (no external references required to understand)

**Builder dispatch:**

- Scaffolding file for 028 shows a step "Read `architecture.yaml.tooling.stack.backend_framework` → load `.claude/skills/agents/back-end/{slug}/SKILL.md`"
- Same for 029 (web) + 030 (mobile)

**Blueprint:**

- §17 revision published; React is one of several options, not THE stack
- Links from §17 to representative stack SKILL.md in each tier

## Attempt Log

### Attempt 1 — 2026-04-22 · Scaffolding + shelf landed

**Scope:** scaffolding spec-only (schema + 5 stack skills + 4 scaffolding files updated + blueprint supersession + Appendix E).

**Files created:**

- `schemas/architecture.schema.json` (NEW) — authoritative definition of `tooling.stack` with 7 enum-locked slots (web_framework, web_styling, mobile_framework, backend_language, backend_framework, orm, database) + `stackRationale[]` block
- `.claude/skills/agents/_template/SKILL.md` (NEW) — stack-skill authoring template (8 required sections)
- `.claude/skills/agents/front-end/react-next/SKILL.md` (NEW) — Next.js 15 + React 19 + Tailwind 4
- `.claude/skills/agents/front-end/svelte-kit/SKILL.md` (NEW) — SvelteKit 2 + Svelte 5 runes + Tailwind (special CSS-only kit consumption pattern for non-React stack)
- `.claude/skills/agents/back-end/node-trpc-nest/SKILL.md` (NEW) — NestJS 11 + tRPC 11 + Prisma 6
- `.claude/skills/agents/back-end/python-fastapi/SKILL.md` (NEW) — FastAPI + SQLAlchemy 2 async + Pydantic v2 (uses `packages/python-types/` codegen from `@repo/types` Zod)
- `.claude/skills/agents/mobile/expo-rn/SKILL.md` (NEW) — Expo SDK 52 + RN 0.76 + NativeWind 4

**Files updated:**

- `scaffolding/07-020-architect-agent.md` — added step 3b (stack-pick sub-step w/ 4-rule picking heuristic: brief-hinted → competitor alignment → factory defaults → null for no-tier); added `tooling.stack` block to the architecture.yaml template + `stackRationale[]` acceptance criterion; 7 new acceptance checkboxes
- `scaffolding/14-028-backend-builder-agent.md` — agent definition rewritten as stack-agnostic dispatcher; 5-step /build-backend skill rewritten around stack-skill load; 10 new acceptance criteria covering dispatch, worktree CWD, v2 tasks.yaml filter
- `scaffolding/15-029-web-frontend-builder.md` — agent frontmatter `skills: []`; system prompt opens with stack-dispatch FIRST then UI Kit contract embedding; explicit React-vs-non-React kit consumption split; acceptance criteria updated
- `scaffolding/16-030-mobile-frontend-builder.md` — same shape: stack-dispatch + mobile-tier null-skip logic + kit-mirror pattern for non-JS stacks (Flutter/native) documented; acceptance criteria updated
- `scaffolding/23-038-skills-agent.md` — `--scope=build` gains stack-skill audit section: shipped/draft/auto-author/stale-pin paths + enum-valid-but-draft registry + hard-abort message when `--auto-author-stack-skills` not passed
- `scaffolding/09-034b-output-contract-zod-schemas.md` — `SkillsAuditOutput` build variant gains 5 new fields: `stackSkillsAuditedShipped`, `stackSkillsAuditedDraft`, `stackSkillsAuthored`, `stackSkillsStalePin`, `stackSkillsMissing[]`
- `multi-agent-app-generation-blueprint.md` — §17 marked superseded with rationale-preserving note; Appendix E (feat-002 Stack-Skill Shelf) appended (9 subsections covering §17 supersession, slot definitions, shelf structure, maturity levels, dispatch pattern, non-React kit consumption, skills-audit integration, feat-004 cross-cutting, downstream tasks)

**Not changed — deferred to downstream plans or runtime:**

- Orchestrator dry-run fixture test (stack-dispatch smoke test) — deferred until task 035 runtime ships; specs agree at the document level
- `skills-audit-build` runtime logic (auto-authoring via WebSearch + WebFetch) — scaffolding spec only; implementation pending task 038
- Cross-field validation on `tooling.stack` (e.g., reject `backend_language: python` + `backend_framework: node-trpc-nest`) — spec-level note added to schema description; strict enum-by-enum validator is a follow-up

**Shipped stack registry (initial drop — 5 skills):**

- front-end: `react-next`, `svelte-kit`
- back-end: `node-trpc-nest`, `python-fastapi`
- mobile: `expo-rn`

**Draft-on-first-use candidates** (schema-enum-valid, auto-authored on demand):

- front-end: `remix`, `astro`, `qwik`, `vue-nuxt`, `solid-start`
- back-end: `node-trpc-only`, `node-express`, `node-fastify`, `python-django`, `go-chi`, `go-echo`, `rust-axum`, `ruby-rails`
- mobile: `bare-rn`, `flutter`, `tauri-mobile`, `native-kotlin`, `native-swift`

**Stack slug → prompt pack coverage:** each shipped SKILL.md has 8 required sections filled (canonical layout, idioms, testing, commands, gotchas, dependency pins, anti-patterns, references) totalling ~5-6 KB per skill. All are single-source-of-truth: importing a React component into a svelte-kit project is explicitly forbidden; Python backends use generated Pydantic mirrors from `@repo/types`; mobile frameworks consume kit tokens via their respective mirror pattern.

**Status:** scaffolding spec + stack shelf complete. Builder implementations that actually DISPATCH will come when tasks 028/029/030 runtime ships.

**Ready to mark completed.**
