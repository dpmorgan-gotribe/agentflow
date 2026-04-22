---
id: feat-005-architect-implementation
type: feature
status: approved
approved-at: 2026-04-22
approved-by: human
author-agent: human
created: 2026-04-22
updated: 2026-04-22
parent-plan: investigate-002-build-tier-readiness-gap
supersedes: null
superseded-by: null
branch: feat/architect-implementation
affected-files:
  # Agent definition
  - .claude/agents/architect.md
  # Skill
  - .claude/skills/architect/SKILL.md
  # Template
  - .claude/architecture.yaml.template
  # Schema
  - schemas/architecture.schema.json
  # Smoke test against mindapp-v2
  - projects/mindapp-v2/.claude/architecture.yaml
  - projects/mindapp-v2/.env.example
  - projects/mindapp-v2/docs/credentials-checklist.md
  - projects/mindapp-v2/docs/deployment-checklist.md
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-005-architect-implementation: `/architect` skill + agent

## Problem Statement

Task-035 shipped a working orchestrator runtime. Its dry-run against mindapp-v2 halts at stage 8 (`architect`) because `.claude/skills/architect/SKILL.md` doesn't exist — the orchestrator knows HOW to invoke the skill but the skill itself is missing. Until `/architect` ships, no project can advance past design sign-off.

The scaffolding at `scaffolding/07-020-architect-agent.md` (~460 lines) fully specifies what the skill must produce: `architecture.yaml` (v2 with `tooling.stack` per feat-002) + `.env.example` (grouped by required-now / later / optional) + `credentials-checklist.md` + `deployment-checklist.md` + `credentials-diff.md` on re-runs + per-self-hosted `config/{service}.toml.template`. It also specifies the three-way `deployment: vendor | self-hosted | declined` enum for every integration and the vendor-decision heuristics (brief signal → compliance fit → lock-in risk → scale realism).

Plus the build-tier-roadmap.md must-have: architect emits **`docker-compose.yml` + `.github/workflows/ci.yml`** so the generated app can boot on the user's machine beyond `pnpm install`.

## Approach

Five phases. Each ends with a commit + a passing smoke test against `projects/mindapp-v2/`.

### Phase 1 — Schemas + templates

1. Write `schemas/architecture.schema.json` strict on `tooling.stack` subtree, loose on consumer-specific app fields. Required fields per scaffolding L411–433.
2. Write `.claude/architecture.yaml.template` — illustrates every section (meta, apps.{web,mobile,api,admin}.integrations[], packages, tooling.stack, tooling.icon_library, tooling.design_dials, tooling.mcp_servers, tooling.skills.build, assets.provenance, compliance, stackRationale).
3. Write Zod schema `packages/orchestrator-contracts/src/architect.ts` — `ArchitectOutput` (the return JSON shape from scaffolding §Steps 13). Re-export via index.ts.

**Exit**: `schemas/architecture.schema.json` validates the template; `pnpm --filter @repo/orchestrator-contracts test` adds ~6 tests + stays green.

### Phase 2 — Agent definition

1. Write `.claude/agents/architect.md` with frontmatter per scaffolding L38-47 (`tools: Read, Write, Bash, Grep, Glob`, `model: inherit`, `maxTurns: 40`, `effort: max`).
2. System prompt body per scaffolding §Agent Definition:
   - Senior technical architect. Opinionated but evidence-driven.
   - Picks one vendor per slot from the research menu — no fence-sitting.
   - NEVER reads or writes `.env` (block-dangerous.sh enforces; agent spec makes the boundary explicit).
   - Three-way `deployment` enum per integration.
   - Self-hosted is a first-class deployment decision.
3. Add the agent to `.claude/models.yaml` (planning tier, effort: max) — already exists in `~/.claude/models.yaml` system defaults; verify + document.

**Exit**: agent file validates (Grep shows required sections; frontmatter parses); agent can be invoked via the Agent tool in isolation for a trivial prompt.

### Phase 3 — Skill: core logic (read inputs + pick vendors + compose architecture.yaml)

1. Write `.claude/skills/architect/SKILL.md` with frontmatter + `when_to_use: after /user-flows-generator sign-off gate (gate 4) resolves approved=true; before /pm`.
2. Steps 1-5 from scaffolding:
   - Read all 10 inputs in order (signoff gating: abort if signoff.approved !== true).
   - Hash prior architecture.yaml if present (for diff).
   - Vendor picks per category from `integrations-options.md`, applying heuristics + recording `decisionRationale`.
   - Stack picks (feat-002) per `tooling.stack` slot with `stackRationale[]` entries; resolve to `.claude/skills/agents/{tier}/{stack-slug}/SKILL.md` paths.
   - Compose `apps.*`, `packages.*`, `tooling.*`, `compliance.*`.
   - Write `.claude/architecture.yaml` validated against the schema.
3. Write `scripts/validate-architecture.mjs` — AJV-based validator; called from both the skill (self-verify) and the reviewer agent (feat-009).

**Exit**: running the skill against mindapp-v2's design outputs produces a well-formed `architecture.yaml` that passes schema validation. No `.env.example` / checklists yet.

### Phase 4 — Skill: emission + diff + infrastructure

1. Steps 6-11 from scaffolding:
   - `.env.example` grouped by required-now / required-later / optional with signup URL comment blocks.
   - `docs/credentials-checklist.md` (table form, "☐" status column).
   - `docs/deployment-checklist.md` for self-hosted integrations.
   - `docs/config/{service}.toml.template` per self-hosted integration.
   - `docs/credentials-diff.md` on re-runs.
2. **Must-have infrastructure minimum** (build-tier-roadmap.md §feat-005 acceptance):
   - `docker-compose.yml` at project root: backend service + database (postgres-16 default) + optional Redis/queue per integrations. One healthcheck per service. `.env` driven (reads vendor-free keys like `DATABASE_URL`, `REDIS_URL`).
   - `.github/workflows/ci.yml` (or equivalent per `architecture.yaml.meta.ciProvider`): typecheck + lint + test + build jobs. `pnpm install` with `--frozen-lockfile`; runs against a postgres service container.
3. Invoke `/register-mcp-servers --scope=build` (task 041). This skill doesn't exist yet — stub the call with a warning log ("register-mcp-servers build scope not yet implemented; see task-041") + proceed. The actual registration is usually no-op (vendor SDKs are NPM, not MCP).
4. Self-verify step (scaffolding L420): every integration has `deployment` field + correct sub-fields per branch; no `.env` read/write anywhere in skill logic.
5. Return `ArchitectOutput` JSON matching the Phase 1 Zod schema.

**Exit**: running the skill against mindapp-v2 produces the FULL output set. `docker-compose.yml` validates with `docker compose config --dry-run`; `.github/workflows/ci.yml` validates with `actionlint`.

### Phase 5 — Smoke test + wire into orchestrator CLI dry-run

1. Run `pnpm generate mindapp-v2 --dry-run` — dry-run now reports `architect` skill EXISTS; next halt should be `pm` (feat-006).
2. Run `/architect` manually against mindapp-v2's design outputs. Inspect:
   - `architecture.yaml` has all apps (web + mobile per mindapp-v2's brief), populates `tooling.stack`, mirrors `iconLibrary` + `dials` from `selected-style.json`.
   - `.env.example` has required-now / required-later / optional groups.
   - `credentials-checklist.md` + `deployment-checklist.md` populated.
   - `docker-compose.yml` + `.github/workflows/ci.yml` emitted.
3. Document Phase 5 results in the plan's Attempt Log.
4. Update plans/active.md manifest to reflect completion.

**Exit**: `pnpm generate mindapp-v2 --dry-run` advances to halt at `pm`; architect output is realistic enough to commit to `projects/mindapp-v2/` as a reference artifact.

## Rejected Alternatives

- **Alternative A: Split into 3 separate plans (feat-005a for agent, feat-005b for skill, feat-005c for infrastructure)** — Rejected. The three are too tightly coupled: agent, skill, and infrastructure all ship together because the smoke test requires the full chain. Splitting creates artificial plan boundaries with no independent value until all three land.

- **Alternative B: Defer docker-compose + CI workflow to a post-MVP plan** — Rejected. build-tier-roadmap.md §feat-005 flags these as "must-have acceptance criteria" — without them, "first run's app can't boot on the user's machine beyond `pnpm install`". Deferring breaks the roadmap's definition of "demonstrable app".

- **Alternative C: Have architect author `.env` directly (with placeholder values)** — Rejected. Hard boundary per scaffolding §Scope L53: "NEVER reads or writes `.env`. That file is gate-5 user territory, enforced by `block-dangerous.sh`." The `.env.example` / gate-5 file-drop flow is load-bearing for user trust.

- **Alternative D: Skip the three-way `deployment` enum; just emit `vendor | null`** — Rejected. Self-hosted is a first-class decision (matrix homeservers, k3s clusters, garage media stores). Collapsing to vendor/null loses the deployment-checklist.md output path.

- **Alternative E: Use Jinja2 or Handlebars templates for architecture.yaml** — Rejected. The structure is too variable (apps[] dimensionality changes per project). A procedural writer (Zod-validated output + js-yaml serializer) is more robust than a template engine for this shape.

## Expected Outcomes

- [ ] `.claude/agents/architect.md` exists with documented `.env` prohibition
- [ ] `.claude/skills/architect/SKILL.md` exists; frontmatter declares post-gate-4 / pre-/pm position
- [ ] `.claude/architecture.yaml.template` demonstrates every section
- [ ] `schemas/architecture.schema.json` validates the template + mindapp-v2's actual output
- [ ] `packages/orchestrator-contracts/src/architect.ts` exports `ArchitectOutputSchema` + re-exports via index
- [ ] Running `/architect` against mindapp-v2 produces: `architecture.yaml`, `.env.example`, `credentials-checklist.md`, `deployment-checklist.md`, `docker-compose.yml`, `.github/workflows/ci.yml`
- [ ] `pnpm generate mindapp-v2 --dry-run` halts at `pm` (not `architect`) — proves the skill is registered
- [ ] Re-running `/architect` after editing one integration produces `docs/credentials-diff.md` with kept/new/changed/removed groups
- [ ] All 112 existing orchestrator tests still pass
- [ ] ~6 new tests in orchestrator-contracts validating `ArchitectOutputSchema`

## Validation Criteria

**Unit test coverage:**

- `packages/orchestrator-contracts/tests/architect.test.ts` — ≥6 tests covering `ArchitectOutputSchema` happy-path + vendor/self-hosted/declined variants + required-now count invariants
- `scripts/validate-architecture.mjs` smoke-tested against the template + mindapp-v2 output

**Skill coverage:**

- Running `/architect` against mindapp-v2's existing design outputs produces all acceptance-criterion files
- `docker-compose config` passes validation for the emitted compose file
- `actionlint .github/workflows/ci.yml` passes (or equivalent CI-linter check) — stretch goal; if actionlint isn't already installed, document but defer

**Orchestrator integration:**

- `pnpm generate mindapp-v2 --dry-run` output changes from "halt at architect" to "halt at pm"
- The dry-run report's `Resume from:` line advances from `architect` to `pm`

**Spec fidelity:**

- Every acceptance criterion from scaffolding §Acceptance Criteria (~25 checkboxes at scaffolding L423-448) has a corresponding assertion in Phase 3 or Phase 4 of this plan
- `grep -ri "\.env" .claude/skills/architect/ | grep -v ".env.example"` returns zero matches (skill never touches `.env`)

**No regression on existing work:**

- `pnpm test:all` remains green (112 orchestrator tests + all contracts tests)
- Nothing in `orchestrator/` source needs to change — this plan is additive
- mindapp-v2's existing design-tier artefacts (screens, manifests, signoff) are not modified

## Attempt Log

<!-- Populated by executing agent. -->
