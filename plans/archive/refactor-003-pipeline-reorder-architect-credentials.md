---
id: refactor-003-pipeline-reorder-architect-credentials
type: refactor
status: archived
author-agent: claude
created: 2026-04-20
updated: 2026-04-22
approved-at: 2026-04-20
approved-by: human
completed: 2026-04-22
parent-plan: null
supersedes: null
superseded-by: null
branch: refactor/pipeline-reorder-architect-credentials
affected-files:
  - scaffolding/000-scaffolding-index.md
  - scaffolding/07-020-architect-agent.md
  - scaffolding/08-021-pm-agent.md
  - scaffolding/01-022-ui-designer-agent.md
  - scaffolding/03-023-mockups-skill.md
  - scaffolding/04-024-stylesheet-skill.md
  - scaffolding/05-025-screens-skill.md
  - scaffolding/12-026-turborepo-scaffold.md
  - scaffolding/13-027-shared-packages.md
  - scaffolding/14-028-backend-builder-agent.md
  - scaffolding/15-029-web-frontend-builder.md
  - scaffolding/16-030-mobile-frontend-builder.md
  - scaffolding/09-034b-output-contract-zod-schemas.md
  - scaffolding/21-035-orchestrator-core.md
  - scaffolding/22-036-hitl-gates.md
  - scaffolding/23-038-skills-agent.md
  - scaffolding/25-040-app-store-compliance.md
  - scaffolding/11-041-mcp-server-registration.md
  - .claude/skills/analyze/SKILL.md
  - .claude/skills/analyze/integrations.md
  - .claude/skills/new-project/SKILL.md
  - multi-agent-app-generation-blueprint.md
feature-area: pipeline-ordering-and-secrets
priority: P1
attempt-count: 0
max-attempts: 5
motivation: "Design stages don't need architecture decisions; architect can't prompt for real credentials before the user has seen what they're paying for. Current order forces premature vendor commitment + leaves credential capture undefined."
---

# refactor-003: Pipeline Reorder + Late Architect + Credential Capture

## Problem Statement

Three interlocking gaps in the current pipeline.

### Gap 1 — Architect runs before the user has seen anything visual

Blueprint §23 + task 035's `STAGES` array run `analyze → skills-audit → architect → pm → mockups → stylesheet → screens → visual-review → user-flows → build-*`. The architect decides data stack, auth provider, payment rails, analytics, storage, and email transport **before** the user has approved a single mockup. Two concrete problems:

1. **Vendor decisions are premature.** The architect's output pins the stack (e.g., "Stripe + Neon + Resend"). If the user rejects the design at mockup gate 2, architect output may no longer apply but the orchestrator doesn't re-run architect — it only retries the upstream stage.
2. **Credentials must be captured before the user has seen value.** Asking a user to paste `STRIPE_SECRET_KEY` or `SENDGRID_API_KEY` **before** they've approved a style is backwards — they haven't committed to the project yet. Real-world fail mode: user rage-quits the credential prompt, pipeline aborts, budget spent on architect + pm is wasted.

### Gap 2 — No credential-capture pattern exists

The current architect (020) writes `architecture.yaml` but has no contract for turning vendor choices into runnable config:

- No `.env.example` generation from the `tooling.mcp_servers[].env_refs` it already emits.
- No `.env` capture mechanism — the reviewer (032) has an acceptance criterion "no secrets in code" but nothing produces the secrets file in the first place.
- No signup-URL / free-tier-cap checklist handed back to the user.
- No HITL gate for "you still need N keys before `/build-backend` can run."
- No path for self-hosted integrations (Matrix/Conduwuit, PowerSync, K3s) that have no signup URL.

Third-party services the user actually has to sign up for are scattered across brief §7.3, §8, §12, §13, §14 and turned into loose prose in `requirements.md §Integrations`. The user ends up hunting signup URLs from the brief themselves.

### Gap 3 — Analyst over-reaches on vendor recommendations

In the refactor-002-era analyst output, `requirements.md §Integrations` lists specific vendor picks (e.g., `Stripe Connect`, `ThirdWeb embedded wallets`). That's a **decision**, not analysis. The analyst's job is "extract what the brief implies + research what the category needs"; the architect's job is "pick one vendor per slot". Today the analyst is effectively deciding, and the architect is rubber-stamping — which means when the architect moves late and gets proper decision authority, there's nothing for it to decide against.

## Approach

Four moves, in one branch:

**Move 1 — Reorder the pipeline.** Architect + PM run AFTER design sign-off (gate 4). Design stages run directly after `/analyze` + `/skills-audit --scope=design`. The monorepo + UI Kit package skeleton — fixed choices, no decision — roll into `/new-project`. Design-stage MCP servers (playwright, icons8, unsplash, chrome-devtools, optional image-generator) are a fixed factory default registered at `/new-project` time from `mcp-defaults-design.json` — no architect involvement pre-design.

**Move 2 — Split the skills audit.** `/skills-audit --scope=design` runs post-analyze; `/skills-audit --scope=build` runs post-architect. Each audits only the tooling needed for stages it precedes.

**Move 3 — Single late-running architect (no phases).** `/architect` runs once, post-signoff, pre-PM. Reads `docs/analysis/shared/integrations-options.md` + `docs/requirements.md` + brief + `docs/screens/**/*.html`. Decides one vendor per integration category (or `self-hosted` or `declined`). Writes the full `architecture.yaml` + `.env.example` (with signup URLs + required-by-stage comments) + `docs/credentials-checklist.md` + `docs/deployment-checklist.md` (for self-hosted services). On re-runs, reads prior `architecture.yaml` + writes `docs/credentials-diff.md` showing kept / new / changed / removed integrations.

**Move 4 — Extend the analyst to research vendor options (not pick).** New phase 2.5 in `/analyze` produces `docs/analysis/shared/integrations-options.md`: 2–3 candidates per integration category with pricing, free-tier caps, SDK maturity, lock-in risk, EU-residency, compliance-handling. No picks. Architect reads this + decides.

**Credential capture is a file-drop gate.** Architect emits `.env.example` + checklists. User copies to `.env`, edits in their own editor, drops `docs/credentials-confirmed.txt` containing `proceed` / `defer:SVC_A,SVC_B` / `abort`. Gate 5 file-watches for the confirmation file — no HTTP server, no browser form, no Claude-visible secrets. `block-dangerous.sh` keeps `.env` unreadable by agents; the builders hit missing keys loudly at runtime if the user lied about `proceed`.

Result: analyst researches menus, user evaluates design, architect decides the stack once the user is committed, credentials get captured at a file-drop gate where secrets never pass through Claude, reviewer + builders get real `.env` to work with.

## Proposed Pipeline Shape

```
/new-project <slug>                  [agentic resources + Turborepo skeleton + packages/ui-kit scaffold
                                      + register mcp-defaults-design.json servers]
    ↓
/analyze [--style-count N]           [+ NEW phase 2.5: integrations-options.md — research menu, no picks]
    ↓ HITL gate 1 (requirements)
/skills-audit --scope=design         [design-stage tooling: NativeWind, Storybook, CVA, Tailwind plugins]
    ↓
/mockups                             [N styles × M apps grid]
    ↓ HITL gate 2 (mockups — pick style, edit dials)
/stylesheet                          [builds packages/ui-kit]
    ↓ HITL gate 3 (design-system)
/screens                             [kit-only composition]
    ↓
/visual-review                       [Layer 7 LLM rubric + per-screen retry]
    ↓
/user-flows-generator                [composes navigation flow poster]
    ↓ HITL gate 4 (design sign-off — binds screens + report + uiKitVersion)
/architect                           [NEW late architect — vendor decisions, .env.example,
                                      credentials-checklist.md, deployment-checklist.md]
    ↓ HITL gate 5 (credentials — file-drop: edit .env + docs/credentials-confirmed.txt)
/pm                                  [tasks.yaml — now references concrete vendor decisions]
    ↓
/skills-audit --scope=build          [build-stage vendor SDKs: stripe-node, @thirdweb-dev/react, mapbox-gl, resend, etc.]
    ↓
/register-mcp-servers --scope=build  [usually no-op; only if architect added build-stage MCP servers]
    ↓
/build-backend                       [reads architecture.yaml + .env]
    ↓
/build-web || /build-mobile          [parallel; read kit + architecture.yaml + .env]
    ↓
/test → /review → /git
```

Gate count: 5. Gate 5 never disables — builders have no `.env` otherwise.

## Key Design Decisions

### Design-stage metadata independence (NEW — discovered during coherence audit)

Design stages (022–025b) must not read architect-produced fields. The current 023 + 024 specs read `architecture.yaml.tooling.design_dials` and `architecture.yaml.tooling.icon_library` — both break when architect moves post-design. Refactor-003 resolves by relocating these two decisions:

| Metadata                   | Old location                                                    | New location (refactor-003)                                                                                                                                        |
| -------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `design_dials`             | `architecture.yaml.tooling.design_dials`                        | Per-style in `docs/analysis/shared/styles.md` → locked in `docs/selected-style.json` at gate 2 (already carries them per refactor-001 `SelectedStyleSchema.dials`) |
| `icon_library`             | `architecture.yaml.tooling.icon_library`                        | Per-style in `docs/analysis/shared/assets.md` → locked in `docs/selected-style.json` at gate 2 (new field `selectedStyle.iconLibrary`)                             |
| `design-stage MCP servers` | `architecture.yaml.tooling.mcp_servers` (design-scoped entries) | Fixed factory default in `mcp-defaults-design.json` registered at `/new-project` time                                                                              |

Architect still records final values in `architecture.yaml.tooling` for downstream consumers and future coherence — but reads from `selected-style.json`, not decides. This makes the architect's tooling block a mirror of earlier user decisions, not a source of them.

### Architect decisions are three-way (vendor / self-hosted / declined)

Every integration in `architecture.yaml.apps.*.integrations.{category}` carries a `deployment` enum:

```yaml
apps:
  api:
    integrations:
      email-transactional:
        deployment: vendor
        vendor: resend
        signupUrl: https://resend.com
        credentialsRequired: [RESEND_API_KEY]
        requiredBy: [build-backend]
        requiredNow: true # blocks /build-backend
        freeTierNotes: "100 emails/day forever-free; paid from $20/mo for 50k"
      messaging:
        deployment: self-hosted
        vendor: conduwuit
        configTemplate: docs/config/conduwuit.toml.template
        deploymentChecklist: docs/deployment-checklist.md#matrix-homeserver
        credentialsRequired: [] # self-hosted — no vendor key
        requiredBy: [deploy]
      analytics:
        deployment: declined
        declinedRationale: "Brief §12 mentions ML but v1 ships without analytics; reconsider Release 3"
```

Emission paths differ per deployment:

- **`vendor`** → row in `.env.example` with signup-URL comment + entry in `credentials-checklist.md`
- **`self-hosted`** → config template under `docs/config/` + entry in `deployment-checklist.md`; no `.env` row
- **`declined`** → rationale field only; nothing emitted

### Gate 5 is pure file-drop, not an HTTP server

Architect emits:

- `.env.example` — every vendor-deployment key listed with a comment block:

  ```bash
  # Resend — https://resend.com (required by /build-backend)
  # Free tier: 100 emails/day; paid $20/mo for 50k
  # required-now: true
  RESEND_API_KEY=
  ```

- `docs/credentials-checklist.md` — human-readable table of vendor services with signup URLs, pricing tiers, credential names, and required-by stages.
- `docs/deployment-checklist.md` — self-hosted services with their config templates and operational notes.
- `docs/credentials-diff.md` (re-runs only) — kept / new / changed / removed integrations vs prior `architecture.yaml`.

User flow:

1. Review the three checklists.
2. `cp .env.example .env` (or copy in Windows PowerShell equivalent).
3. Edit `.env` in their own editor; paste real keys.
4. Drop `docs/credentials-confirmed.txt` containing one of:
   - `proceed` — "all required-now keys are set, continue to /pm"
   - `defer:SVC_A,SVC_B` — "I'm skipping these services; add rationale to deferred list in checklist; continue"
   - `abort` — "stop the pipeline; I need to reconsider"
5. Gate 5 file-watches for `docs/credentials-confirmed.txt`. On `proceed` or `defer`, orchestrator advances. On `abort`, orchestrator stops with a resumable checkpoint so re-running `/architect` onwards is cheap.

**Why file-drop wins:**

- `.env` never passes through Claude — `block-dangerous.sh` blocks reads; no exception or escape-hatch needed.
- No secrets in terminal scrollback or tool-call history.
- Matches 12-factor-app convention developers already know.
- No HTTP server to spin up, no port-clash, no browser-automation dependency.
- Orchestrator only needs a single file-watcher (simpler than gates 2 + 4).
- Builders fail loudly at `/build-backend` if the user lied about `proceed` — correct failure locus.

### Re-runs are diff-aware, preserve existing `.env`

Architect reads prior `.claude/architecture.yaml` if present, compares new vendor decisions to old, emits `docs/credentials-diff.md`:

```markdown
# Credentials Diff — 2026-04-21

## Kept (no action — keys in .env still valid)

- Stripe (STRIPE_PUBLISHABLE_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET)
- ThirdWeb (THIRDWEB_CLIENT_ID, THIRDWEB_SECRET_KEY)

## New (supply keys in .env)

- Resend (RESEND_API_KEY) — signup at https://resend.com

## Changed (vendor swap — supply new keys)

- Analytics: PostHog → Plausible
  - Remove: POSTHOG_API_KEY, POSTHOG_HOST
  - Add: PLAUSIBLE_DOMAIN, PLAUSIBLE_API_KEY — signup at https://plausible.io

## Removed (safe to delete from .env — no longer used)

- SendGrid (SENDGRID_API_KEY) — superseded by Resend
```

Architect NEVER reads, modifies, or deletes from `.env`. User is the sole `.env` author. This preserves manual edits, avoids destructive writes, and keeps the block-dangerous posture clean.

### Windows `.env` permissions

`.env` write happens in the architect via `fs.writeFileSync(path, '')` (empty-initialize is a no-op — architect only writes `.env.example`, never `.env`). Since the architect doesn't touch `.env`, permissions aren't an issue at the architect stage.

For `.env.example`, best-effort chmod:

```ts
try {
  fs.chmodSync(envExamplePath, 0o644);
} catch {
  /* Windows noop */
}
```

`.env.example` is intentionally world-readable (no secrets in it — just placeholder rows + comments). `.env` permissions are the user's responsibility in their own filesystem — agentic code never touches it.

## Proposed Changes

### UPDATE — `scaffolding/000-scaffolding-index.md`

Reshuffle tiers to match new order:

- **Tier 5: Planning (post-analyze)** — now only 019 Analyst. Remove 020 + 021 from this tier.
- **Tier 6: Design Pipeline (post-analyze, pre-architect)** — unchanged members (022–025b). No architect dependency.
- **NEW Tier 6.5: Post-Design Planning (post-signoff, pre-build)** — members: 020 Architect, 021 PM, 038 skills-audit-build.
- **Tier 7: Build Pipeline** — unchanged members; header note that 026 + 027 now run at `/new-project` time.
- **Tier 10: Meta & Compliance** — keep 038 as the skills agent but document it takes `--scope=design` or `--scope=build`; 038b is the design-scope variant run from Tier 6.

Add a top-of-file note: "Refactor-003 (2026-04-20) reordered the pipeline so architect + PM run after design sign-off. Canonical stage order lives in 035's `STAGES` array; blueprint Appendix C records the decision."

### UPDATE — `scaffolding/07-020-architect-agent.md` (substantial rewrite, single invocation)

Current 020 bundles MCP-server selection + architecture-yaml authoring at tier 5. Rewrite as a single late-running stage at tier 6.5 with these concrete changes:

1. **Frontmatter:** `tier: 5 → tier: 6.5`; `depends-on: ["019"] → depends-on: ["019", "025b"]` (analyst + visual-review).
2. **Skill frontmatter** `when_to_use: "after /user-flows-generator signoff, before /pm"`.
3. **Inputs:** add `docs/analysis/shared/integrations-options.md` (analyst phase 2.5), `docs/screens/**/*.html` (composed screens for SDK scoping), optional prior `.claude/architecture.yaml` (re-run diff input).
4. **Outputs expanded:**
   - `.claude/architecture.yaml` (unchanged scope structurally; `apps.*.integrations[].deployment` is new)
   - `.mcp.json` — build-stage MCP servers only; design-stage servers already registered at `/new-project` time (041 edit below)
   - `.env.example` — generated from all `vendor`-deployment integrations with signup URL + free-tier + required-by comments
   - `docs/credentials-checklist.md` — human-readable table of vendor integrations
   - `docs/deployment-checklist.md` — self-hosted integrations with config templates + operational notes
   - `docs/credentials-diff.md` — re-runs only; kept / new / changed / removed vs prior architecture.yaml
   - `docs/config/{service}.toml.template` — per self-hosted integration
5. **Decision discipline:** document the three-way `deployment: vendor | self-hosted | declined` enum. Every integration category in integrations-options.md maps to exactly one decision; declined categories MUST include a rationale field.
6. **Vendor-decision heuristics:** document how architect picks when brief gives signal (honour brief §7.3 direct vendor mentions), when integrations-options.md has 2–3 candidates (pick by: pricing fit for user's implied scale, EU residency if GDPR flag, SDK maturity, lock-in risk tiebreaker — lower wins).
7. **Acceptance criteria updates:**
   - Single invocation, no `--phase` arg
   - Every integration in integrations-options.md → one decision in architecture.yaml.apps.\*.integrations (or a documented category-drop)
   - Every `.env.example` row has signup URL + required-by-stage comment + required-now boolean annotation
   - Re-runs produce credentials-diff.md; do NOT touch `.env`
   - `.mcp.json` contains build-stage servers only (design-stage defaults merged in at /new-project time, not re-written by architect)
   - No secrets appear in any architect output file

### UPDATE — `scaffolding/08-021-pm-agent.md`

Update position note: "Runs AFTER `/architect`, not after `/analyze`." One-paragraph addition to §Scope noting that tasks.yaml now references concrete vendor decisions (e.g., "Task: wire Resend transactional-email templates") rather than abstract placeholders. No scope rewrite — PM still consumes requirements.md + architecture.yaml + brief §12 / §19.

**Dual-invocation for kit-change-request mini-plans.** The existing kit-change-request detour (035) invokes PM mid-design when `/screens` or a builder flags a missing primitive. That invocation produces a _mini-plan_ (single kit-bump spec), not the pipeline's main `tasks.yaml`. In refactor-003, the main PM stage still runs post-architect, but PM remains on-call for mini-plans during design. Add to §Scope: "PM is an on-demand agent. Main invocation produces `docs/tasks.yaml` post-architect; detour invocations produce `plans/active/kit-change-request-{id}.md` mini-plans during design. Both modes share the same agent definition; the orchestrator passes a `--mode=tasks | --mode=kit-change-request` arg."

### UPDATE — `scaffolding/01-022-ui-designer-agent.md`

One frontmatter edit:

- **Line 7:** `depends-on: ["020"] → depends-on: ["019"]`. UI Designer now runs before architect; its direct dependency is the analyst (019) whose outputs (styles.md, assets.md, inspirations.md, screens.json) are what the agent actually consumes.

No body changes — 022's system prompt already reads from analyst outputs, not architect. The stale frontmatter dep is the only break.

### UPDATE — `scaffolding/03-023-mockups-skill.md`

Two concrete edits targeting the architect dependency:

1. **Lines 43-49 (§Prerequisites) — remove architect prereq.** Strike "Task 020 (Architect) has set `tooling.design_dials` defaults and `tooling.icon_library`". Replace with: "Per-style `design_dials` come from `docs/analysis/shared/styles.md` (refactor-002 Dials block). Each style's mockup card surfaces the dials in the HTML; gate 2's backing server persists edits to `docs/mockups/{styleId}/dials.yaml` and writes the final values into `docs/selected-style.json`. No architect output is read at this stage."
2. **Line 163 (dials fallback input) — redirect source.** Currently "fallback to `architecture.yaml.tooling.design_dials`". Change to "fallback to `docs/analysis/shared/styles.md` style block's Dials field." If styles.md is missing the block, this is a refactor-002 compliance bug, not a design_dials resolution step.

Task 041 provisioning prereq (line 49) stays but is now satisfied by `/new-project` step 5b (factory-default design-scope MCPs), not architect.

### UPDATE — `scaffolding/04-024-stylesheet-skill.md`

One concrete edit:

- **Line 67 (§Inputs item 6).** Currently reads `architecture.yaml.tooling.icon_library`. Change to `docs/selected-style.json.iconLibrary` — the winning style's per-style icon-library choice locked at gate 2. Rewrite the accompanying paragraph:

  > The icon_library is chosen by the analyst per-style (in `assets.md`) and locked when the user picks a style at gate 2 (`docs/selected-style.json.iconLibrary`). The kit ships with exactly one library for visual coherence across all apps — the one carried by the winning style. User-supplied icons in `asset-inventory.json.icons[]` still take precedence; they're used verbatim rather than swapped for library equivalents.

This inverts the old "architect decides project-level" stance to "user-pick-at-gate-2 decides per-style" — which actually matches the intuition that icon style should follow typographic style, not infrastructure decisions.

Also: add `iconLibrary` to `SelectedStyleSchema` (034b addition — noted separately below).

### UPDATE — `scaffolding/05-025-screens-skill.md`

One §Cross-task note edit around lines 106-107 (kit-change-request detour):

Add a paragraph clarifying the detour flow under refactor-003:

> **Kit-change-request under refactor-003.** When `/screens` emits a kit-change-request during design, the orchestrator invokes PM in `--mode=kit-change-request` to write a mini-plan (not the main tasks.yaml). PM in kit-change-request mode reads only the emitted request + current kit version; it does NOT require `architecture.yaml` to exist yet. The main PM stage (post-architect) later subsumes any mini-plans that landed during design. Orchestrator (035) enforces the dual-mode invocation; 025 only needs to know the detour will be honoured.

No other change to 025's scope.

### UPDATE — `scaffolding/14-028-backend-builder-agent.md`

One §Inputs addition documenting `.env` as an authoritative input:

> **`.env` (gate-5-captured)** — reads build-time secrets. `.env` is user-authored at gate 5 after `/architect` emits `.env.example` with placeholders + signup URL comments. `block-dangerous.sh` keeps `.env` unreadable by agents outside the build stages; backend-builder inherits a scoped exception by virtue of needing runtime config. Missing required-now keys surface as loud failures at container startup / first API call — correct failure mode since the user was warned at gate 5.

No code-shape change — backend-builder would naturally read env vars via `process.env.*` anyway. This is a documentation update so the spec is consistent with refactor-003's `.env` lifecycle.

### UPDATE — `scaffolding/15-029-web-frontend-builder.md` + `030-mobile-frontend-builder.md`

Same one-paragraph `.env` addition as 028, adjusted for web/mobile runtime:

> **`.env` (gate-5-captured)** — reads build-time public env vars (e.g., `NEXT_PUBLIC_*`, `EXPO_PUBLIC_*`) injected into client bundles. Never bundles secret-prefixed keys (`*_SECRET_KEY`) — reviewer (032) scans builds for accidental secret-leakage per its existing "no secrets in code" criterion. Missing required public keys surface at `next build` / `expo build` as loud failures.

Mobile (030) also gets a note about `.env` keys destined for EAS Build secrets vs baked-into-bundle public vars — the mobile-specific distinction that web doesn't have.

### UPDATE — `scaffolding/12-026-turborepo-scaffold.md` + `027-shared-packages.md`

Move the invocation trigger. Both run as part of `/new-project` (see §`/new-project` edit below). Rationale: Turborepo + pnpm + package layout is a fixed factory-level decision, not per-project. No architectural freedom means no architect call needed.

Concrete edits in each task file:

- Change frontmatter `tier: 7 → tier: 4` with note "invoked from /new-project, not as a standalone pipeline stage".
- Update §Invocation Point subsection.
- Note that the architect overlays its `.claude/architecture.yaml` on top of this fixed skeleton; architect does NOT create the monorepo.

### UPDATE — `.claude/skills/new-project/SKILL.md`

Add a new step **5b** between existing step 5 (copy agentic resources) and step 6 (write project-level files):

```markdown
### 5b. Scaffold the Turborepo + shared-package skeleton

- Run `pnpm init` at project root; write `turbo.json` with the factory's canonical task-graph config.
- Create `packages/` with stub directories: `ui-kit/`, `types/`, `utils/`, `api-client/`. Each gets a minimal `package.json` (name + version 0.0.0) and a README describing the package's role. `ui-kit/` specifically gets placeholder directories for `tokens/`, `primitives/`, `patterns/`, `layouts/`, `stories/`.
- Copy `mcp-defaults-design.json` from the factory into the project root. This file lists the fixed design-stage MCP servers (playwright, icons8, unsplash, chrome-devtools, and image-generator gated behind feature_flag: nanobanana).
- Invoke `/register-mcp-servers --scope=design --input=mcp-defaults-design.json` to populate the initial `.mcp.json`. Architect will later append build-stage servers to the same file; the design-stage block is stable across pipeline runs.
```

Update the directory-tree diagram in step 3 to include `packages/`, `mcp-defaults-design.json`, `turbo.json`, root `package.json`. Update return-JSON `filesCopied` to track monorepo-scaffold files.

### UPDATE — `scaffolding/11-041-mcp-server-registration.md`

`/register-mcp-servers` gains a `--scope` arg:

- **`--scope=design`**: reads a fixed input file (`mcp-defaults-design.json` by convention), registers design-stage MCP servers. Invoked once from `/new-project` step 5b. Idempotent on re-runs (same input = same output).
- **`--scope=build`**: reads `architecture.yaml.tooling.mcp_servers` filtered to build-stage `scoped_to` agents. Invoked once from the orchestrator after `/architect` runs. Most vendor SDKs are NPM packages, not MCP servers, so this call often produces zero new entries — but the registration point is preserved for the case where architect adds e.g. a custom in-house MCP server or a hosted data-catalog MCP.

The 041 skill's underlying registration logic doesn't change; only the invocation surface does. `.mcp.json` ends up as the union of design-scope + build-scope registrations. Both invocations are safe to re-run.

### UPDATE — `scaffolding/23-038-skills-agent.md`

Add `--scope=design | --scope=build` arg; split the skill-audit responsibilities:

- **`/skills-audit --scope=design`** (post-analyze, pre-mockups): audits skills for design-stage tech — NativeWind 4, Storybook 8 with Tailwind preset, CVA v1, any Tailwind plugins referenced in styles.md (typography, container-queries), MCP client usage (playwright, icons8, image-generator if nanobanana). Reads `docs/requirements.md.skillsNeeded` filtered to design-scope subset + `styles.md` + `inspirations.md`.
- **`/skills-audit --scope=build`** (post-architect, pre-build): audits build-phase vendor SDKs. Reads `architecture.yaml.apps.*.integrations` (the concrete vendor list, not the analyst's menu). Examples: `stripe-node`, `@thirdweb-dev/react`, `mapbox-gl`, `resend`, `@getpostman/newman` for testing, etc.

Shared underlying logic (research → author → validate → deposit); only the audit-target list differs. Update §Invocation Point to list both stages; update §Responsibilities to document the two scopes.

### UPDATE — `scaffolding/09-034b-output-contract-zod-schemas.md`

Four schema changes:

1. **Extend `AnalyzeOutput`** — add `integrationsResearched: z.number().int().nonnegative()` (count of services the analyst produced options for).
2. **Extend `SelectedStyleSchema`** — add `iconLibrary: z.enum(["lucide","phosphor","heroicons","iconoir","tabler"])`. Populated from the winning style's `assets.md` icon-library choice at gate 2. Read by 024 `/stylesheet` instead of `architecture.yaml.tooling.icon_library`.
3. **Extend `ArchitectOutput`** — add fields:

   ```ts
   export const ArchitectOutput = z.object({
     success: z.literal(true),
     appsCount: z.number().int().nonnegative(),
     packagesCount: z.number().int().nonnegative(),
     vendorDecisions: z.number().int().nonnegative(), // deployment=vendor count
     selfHostedDecisions: z.number().int().nonnegative(), // deployment=self-hosted count
     declinedDecisions: z.number().int().nonnegative(), // deployment=declined count
     envVarsRequiredNow: z.number().int().nonnegative(), // blocks /build-backend
     envVarsRequiredLater: z.number().int().nonnegative(), // for /deploy
     envVarsOptional: z.number().int().nonnegative(), // feature-flag gated
     credentialsDiffEmitted: z.boolean(), // true on re-runs
     buildMcpServersAdded: z.number().int().nonnegative(), // usually 0
     warnings: z.array(z.string()),
   });
   ```

4. **New `CredentialsGateOutput`** — gate 5's post-confirmation summary:

   ```ts
   export const CredentialsGateOutput = z.object({
     success: z.literal(true),
     decision: z.enum(["proceed", "defer", "abort"]),
     servicesConfirmed: z.array(z.string()), // vendor IDs user confirmed
     servicesDeferred: z.array(z.string()), // vendor IDs user deferred with reason
     deferralReasons: z.record(z.string(), z.string()), // { serviceId: reason }
     envFileExists: z.boolean(), // true if user created .env
     warnings: z.array(z.string()),
   });
   ```

5. **Update `StageSchemas` lookup table** in `index.ts` to include `credentialsGate: CredentialsGateOutput`.

Note in §Notes: architect NEVER reads `.env` — `envFileExists` comes from orchestrator's file-stat check, not a read.

### UPDATE — `scaffolding/21-035-orchestrator-core.md`

Rewrite the STAGES array to match refactor-003 order:

```ts
const STAGES: PipelineStage[] = [
  // ─── PLANNING ───
  {
    name: "analyze",
    slashCommand: "/analyze",
    gateEnabled: true,
    gateType: "requirements",
    agent: "analyst",
  },
  {
    name: "skills-audit-design",
    slashCommand: "/skills-audit --scope=design",
    gateEnabled: false,
    agent: "skills",
  },

  // ─── DESIGN ───
  {
    name: "mockups",
    slashCommand: "/mockups",
    gateEnabled: true,
    gateType: "mockups",
    agent: "ui-designer",
  },
  {
    name: "stylesheet",
    slashCommand: "/stylesheet",
    gateEnabled: true,
    gateType: "design-system",
    agent: "ui-designer",
  },
  {
    name: "screens",
    slashCommand: "/screens",
    gateEnabled: false,
    agent: "ui-designer",
  },
  {
    name: "visual-review",
    slashCommand: "/visual-review",
    gateEnabled: false,
    agent: "ui-designer",
    dependsOn: ["screens"],
  },
  {
    name: "user-flows",
    slashCommand: "/user-flows-generator",
    gateEnabled: true,
    gateType: "signoff",
    agent: "ui-designer",
    dependsOn: ["visual-review"],
  },

  // ─── POST-DESIGN PLANNING ───
  {
    name: "architect",
    slashCommand: "/architect",
    gateEnabled: true,
    gateType: "credentials",
    agent: "architect",
    dependsOn: ["user-flows"],
  },
  {
    name: "pm",
    slashCommand: "/pm",
    gateEnabled: false,
    agent: "pm",
    dependsOn: ["architect"],
  },
  {
    name: "skills-audit-build",
    slashCommand: "/skills-audit --scope=build",
    gateEnabled: false,
    agent: "skills",
    dependsOn: ["pm"],
  },
  {
    name: "register-mcp-build",
    slashCommand: "/register-mcp-servers --scope=build",
    gateEnabled: false,
    agent: "orchestrator",
    dependsOn: ["skills-audit-build"],
  },

  // ─── BUILD ───
  {
    name: "build-backend",
    slashCommand: "/build-backend",
    gateEnabled: false,
    agent: "backend-builder",
    dependsOn: ["register-mcp-build"],
  },
  {
    name: "build-web",
    slashCommand: "/build-web",
    gateEnabled: false,
    agent: "web-frontend-builder",
    dependsOn: ["build-backend"],
  },
  {
    name: "build-mobile",
    slashCommand: "/build-mobile",
    gateEnabled: false,
    agent: "mobile-frontend-builder",
    dependsOn: ["build-backend"],
  },
  { name: "test", slashCommand: "/test", gateEnabled: false, agent: "tester" },
  {
    name: "review",
    slashCommand: "/review",
    gateEnabled: false,
    agent: "reviewer",
  },

  // ─── SHIP ───
  { name: "git", slashCommand: "/git", gateEnabled: false, agent: "git" },
];
```

Acceptance criteria updates:

- Stage order matches this array exactly (remove reference to pre-refactor §23 L2765-2822; replaced by blueprint Appendix C).
- Gate 5 (`credentials`) gate-type introduced between `architect` and `pm`.
- `register-mcp-build` is a structural stage but often a no-op — still present so architect extensions (custom MCP servers) flow through registration consistently.
- Kit-change-request detour logic unchanged; if fired post-signoff it re-opens gate 4 but **not** gate 5 (credentials persist across a re-opened design signoff unless architect re-runs AND a vendor decision changes — architect then emits credentials-diff.md and gate 5 re-opens).

### UPDATE — `scaffolding/22-036-hitl-gates.md`

Extend to five gates and document gate 5 as file-drop-only:

| #     | After stage           | gateType        | Writes                                             | Validates                 |
| ----- | --------------------- | --------------- | -------------------------------------------------- | ------------------------- |
| 1     | /analyze              | requirements    | (approval only)                                    | AnalyzeOutput             |
| 2     | /mockups              | mockups         | docs/selected-style.json + archives losers         | SelectedStyleSchema       |
| 3     | /stylesheet           | design-system   | (approval only)                                    | StylesheetOutput          |
| 4     | /user-flows-generator | signoff         | docs/signoff-{ts}.json + locks uiKitVersion        | Signoff                   |
| **5** | **/architect**        | **credentials** | **docs/credentials-confirmed.txt (user-authored)** | **CredentialsGateOutput** |

Add new **§Gate 5 — Credentials (file-drop)** subsection:

```markdown
Unlike gates 2 + 4, gate 5 has NO backing HTTP server. The architect's outputs are all file artifacts the user reads and responds to via file-drop. No secrets ever pass through Claude.

Flow:

1. Architect completes and emits .env.example, credentials-checklist.md, deployment-checklist.md, and (on re-runs) credentials-diff.md.
2. Orchestrator prints a summary in the terminal:
   "Architect complete. Review docs/credentials-checklist.md.
   To proceed: cp .env.example .env, fill in required-now keys, then:
   echo proceed > docs/credentials-confirmed.txt
   To defer specific services:
   echo 'defer:Service1,Service2' > docs/credentials-confirmed.txt
   To abort:
   echo abort > docs/credentials-confirmed.txt"
3. Orchestrator file-watches docs/credentials-confirmed.txt (chokidar or fs.watch; ~500ms poll).
4. On write, orchestrator reads the confirmation file (permitted — it's not .env), parses the decision, emits CredentialsGateOutput, and advances or aborts.

Orchestrator does NOT read .env. Deferred services surface as warnings in CredentialsGateOutput.servicesDeferred; if a deferred service has requiredNow=true, orchestrator logs a loud warning ("/build-backend will fail at runtime if these keys remain unset") but does not block. block-dangerous.sh keeps .env unreadable by agents — the user is solely responsible for their .env contents.

Gate 5 is never disableable in autonomous mode — builders have no .env to work with otherwise. The "abort" path is the only escape hatch during autonomous runs; it writes a clean checkpoint so resuming later is cheap.
```

Remove the HTTP-server text from earlier drafts of this refactor. Gate 5's server endpoints are NOT implemented.

### UPDATE — `scaffolding/25-040-app-store-compliance.md`

One-line addition: "Runs after `/architect` so that `architecture.yaml.compliance` (populated by architect) is available." No other change — the compliance task reads the same fields as today.

### NEW — `.claude/skills/analyze/integrations.md` — phase 2.5 sub-skill

New analyst sub-worker matching the phase-3 worker pattern. Inputs: brief (full), competitors.md, asset-inventory.json. Output: `docs/analysis/shared/integrations-options.md`.

Shape of integrations-options.md:

```markdown
# Integration Options — Research Menu

Research-only. 2–3 candidates per integration category. /architect picks one per slot. No decisions made here.

## Category: Authentication

### Candidate 1: ThirdWeb Embedded Wallets

- **Signup:** https://thirdweb.com/dashboard
- **Pricing tier:** Free up to 10k MAUs; paid from $99/mo
- **Credentials:** THIRDWEB_CLIENT_ID, THIRDWEB_SECRET_KEY
- **SDK maturity:** v5 stable, React + React Native SDKs
- **Lock-in risk:** medium (proprietary account-abstraction API)
- **EU residency:** available on enterprise
- **Compliance:** SOC 2, GDPR-capable DPA
- **Brief signal:** §7.3 explicitly names ThirdWeb

### Candidate 2: Clerk

- **Signup:** https://dashboard.clerk.com
- ...

## Category: Transactional Email (inferred — brief doesn't specify provider)

### Candidate 1: Resend

### Candidate 2: SendGrid

...

## Category: Messaging

### Candidate 1: Matrix + Conduwuit (self-hosted)

- **Deployment:** self-hosted homeserver per node
- **Config:** conduwuit.toml
- **No vendor signup required**
- **Brief signal:** §7.3 names Conduwuit explicitly
  ...
```

Categories to cover (analyst infers which apply from brief + competitors): auth, payments, treasury, governance, attestations, messaging, push, maps, media-hosting, transactional-email, analytics, ai-inference, offline-sync, i18n, kyc, monitoring/observability, feature-flags, error-tracking. Self-hosted candidates get a `Deployment: self-hosted` marker so architect knows not to emit signup-URL entries.

Invoked from `/analyze SKILL.md` §3.5 (new phase inserted between phase 2 and phase 3). Single Agent subagent call. Budget: ~$0.30–0.80 per run (WebSearch + WebFetch heavy).

### UPDATE — `.claude/skills/analyze/SKILL.md`

Three concrete edits:

1. **Add §3.5 — Phase 2.5 (integrations research).** Runs after phase 2 (competitors), before phase 3 (shared workers). Single subagent invoking `integrations.md` sub-skill. Output: `docs/analysis/shared/integrations-options.md`.
2. **Update §2 argument parsing.** Add `--skip-integrations` flag symmetric with `--skip-research` for dev mode.
3. **Update §6 Report JSON.** Add `integrationsResearched: <count>` to the return shape (matches AnalyzeOutput extension).
4. **Update §7 Self-verification** to require `docs/analysis/shared/integrations-options.md` exists unless `--skip-integrations`.

Note also: analyst's `requirements.md §Integrations` section STOPS naming specific vendors. Becomes: "See `docs/analysis/shared/integrations-options.md` for the vendor research menu; architect decides at post-signoff stage." One-line edit to the requirements.md template in SKILL.md §6b.

### UPDATE — `multi-agent-app-generation-blueprint.md` — addendum

Append a new **§Appendix C — Refactor-003 Pipeline Reorder (2026-04-20)** to the END of the blueprint (not interleaved, matches refactor-001/002 discipline). Content:

- Canonical stage order is now 035's STAGES array; blueprint §23 L2765-2822 walkthrough is historical.
- Reasoning: design-stage framework-agnosticism means architect can run late; credential UX requires the user to have seen design deliverables before paying for vendor signups.
- Five-gate diagram (instead of four).
- Three-way `deployment: vendor | self-hosted | declined` enum is the load-bearing pattern.
- Gate 5 file-drop mechanism; `.env` never flows through Claude.
- Supersession breadcrumb for §23 walkthrough.

## Migration Strategy

Single branch `refactor/pipeline-reorder-architect-credentials`. One logical commit per file pair where feasible, mirroring refactor-001's discipline:

1. Write 034b schema changes FIRST (contract-first) — AnalyzeOutput.integrationsResearched, extended ArchitectOutput, new CredentialsGateOutput.
2. Add integrations.md sub-skill + update analyze SKILL.md.
3. Rewrite 020 architect spec (single-invocation, three-way deployment enum, credential emission contract).
4. Update 035 orchestrator STAGES array.
5. Update 036 HITL gates (add gate 5 file-drop spec).
6. Update 038 skills-agent split.
7. Update 041 MCP-registration --scope arg.
8. Update 021, 026, 027, 040 position notes.
9. Update /new-project SKILL.md step 5b (monorepo scaffold + design-MCP registration).
10. Update 000-scaffolding-index.md tier membership.
11. Append blueprint Appendix C.
12. Self-review each file after editing before advancing.
13. Dry-run mental walkthrough: simulate the full pipeline on a fictional project; at each hop verify every read is a file written by a prior stage or scaffolded at /new-project time.

No code runs in this refactor — all changes are spec + skill updates. Smoke-testing the new architect on gotribe-v1 happens in a separate feature plan when 020 is actually implemented.

## Affected Consumers

| Consumer                | File                                                                                | Change Required                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| Analyst skill           | `.claude/skills/analyze/SKILL.md`                                                   | Add phase 2.5 step + integrations.md sub-skill invocation; update return-JSON shape; stop naming vendors in requirements.md template |
| NEW analyst sub-skill   | `.claude/skills/analyze/integrations.md`                                            | Create file — research menu producer                                                                                                 |
| Architect task spec     | `scaffolding/07-020-architect-agent.md`                                             | Substantial rewrite: single late invocation; vendor/self-hosted/declined enum; credential emission contract                          |
| Orchestrator spec       | `scaffolding/21-035-orchestrator-core.md`                                           | Rewrite STAGES array; document register-mcp-build no-op-OK stage                                                                     |
| HITL gates spec         | `scaffolding/22-036-hitl-gates.md`                                                  | Add gate 5 file-drop spec; no HTTP server for gate 5                                                                                 |
| Zod schemas             | `scaffolding/09-034b-output-contract-zod-schemas.md`                                | Add AnalyzeOutput.integrationsResearched; extend ArchitectOutput; new CredentialsGateOutput                                          |
| Skills agent            | `scaffolding/23-038-skills-agent.md`                                                | Split by --scope=design                                                                                                              | build; document dual invocation |
| MCP registration        | `scaffolding/11-041-mcp-server-registration.md`                                     | Add --scope arg; design-scope runs at /new-project, build-scope runs post-architect                                                  |
| PM agent                | `scaffolding/08-021-pm-agent.md`                                                    | Position note: now post-architect, not post-analyze; add dual-mode (`--mode=tasks` main run / `--mode=kit-change-request` detour)    |
| UI Designer agent       | `scaffolding/01-022-ui-designer-agent.md`                                           | Frontmatter fix: `depends-on: ["020"] → ["019"]`. UI Designer runs before architect now.                                             |
| /mockups skill          | `scaffolding/03-023-mockups-skill.md`                                               | Remove architect prereq; read `design_dials` from `styles.md` / `selected-style.json`, not `architecture.yaml`                       |
| /stylesheet skill       | `scaffolding/04-024-stylesheet-skill.md`                                            | Read `icon_library` from `selected-style.json`, not `architecture.yaml`. Add `iconLibrary` field to SelectedStyleSchema (034b)       |
| /screens skill          | `scaffolding/05-025-screens-skill.md`                                               | Document kit-change-request detour under refactor-003 (PM dual-mode invocation)                                                      |
| Backend builder         | `scaffolding/14-028-backend-builder-agent.md`                                       | §Inputs addition documenting `.env` as a gate-5-captured authoritative input                                                         |
| Web frontend builder    | `scaffolding/15-029-web-frontend-builder.md`                                        | §Inputs addition: `.env` (public-prefixed keys only for bundle); reviewer scans for leakage                                          |
| Mobile frontend builder | `scaffolding/16-030-mobile-frontend-builder.md`                                     | §Inputs addition: `.env` + EAS Build-secrets vs public-vars distinction                                                              |
| Monorepo scaffold       | `scaffolding/12-026-turborepo-scaffold.md`, `scaffolding/13-027-shared-packages.md` | Move invocation to /new-project step 5b                                                                                              |
| /new-project skill      | `.claude/skills/new-project/SKILL.md`                                               | Add step 5b: monorepo scaffold + mcp-defaults-design.json registration                                                               |
| App Store compliance    | `scaffolding/25-040-app-store-compliance.md`                                        | One-line note: runs after /architect                                                                                                 |
| Scaffolding index       | `scaffolding/000-scaffolding-index.md`                                              | Reshuffle tiers; add Tier 6.5                                                                                                        |
| Blueprint               | `multi-agent-app-generation-blueprint.md`                                           | Append Appendix C at EOF                                                                                                             |

Design-stage tasks (025b, 022b, 032b) need no edits — they read analyst + selected-style + kit outputs only. 022, 023, 024, 025 DO need the edits listed above (discovered during the coherence audit — frontmatter/depends-on + three architect-field reads that had to be relocated to `selected-style.json`).

Build-stage tasks (028, 029, 030) need the `.env` documentation addition called out above; they already read `architecture.yaml` semantically but the spec was silent on `.env`.

Tester (031), Reviewer (032), Git Agent (033), Lessons Agent (037), Agent Expert (039) are clean — zero refactor-003 dependency.

## Validation Criteria

1. **STAGES array self-consistency** — every `dependsOn` resolves to a prior stage name; gate 4 precedes `architect`; gate 5 precedes `pm`.
2. **No stage reads a file produced after it** — mental walkthrough: for each stage, every file mentioned in inputs is written by an earlier stage or scaffolded at /new-project time.
3. **Design-stage metadata independence** — greps of 022, 023, 024, 025, 025b for `architecture.yaml` return zero hits (except explanatory prose in 020/036 that references the file by name). `design_dials` and `icon_library` sourced from `styles.md` / `selected-style.json` only in design stages.
4. **Architect never reads `.env`** — spec 020 explicitly states: "Architect reads .env.example, never .env. Orchestrator reads neither; file-watches credentials-confirmed.txt only."
5. **Gate 5 has no HTTP server** — 036 gate-5 subsection describes file-drop mechanism only; no endpoint specification.
6. **AnalyzeOutput schema version bump** — `integrationsResearched` is a new required field; document in 034b that refactor-003's shape isn't interchangeable with refactor-002's.
7. **SelectedStyleSchema gains `iconLibrary`** — 034b edit adds this field; 024 reads it; 020 acceptance criteria requires architect to mirror it into `architecture.yaml.tooling.icon_library` (mirror not decide).
8. **Three-way deployment enum enforced** — 020 acceptance criteria requires every integration to have `deployment: vendor | self-hosted | declined`.
9. **PM dual-mode enforced** — 035 STAGES array invokes PM post-architect with `--mode=tasks`; kit-change-request detour invokes PM with `--mode=kit-change-request`. 021 acceptance criteria lists both modes.
10. **Scaffolding-index tier numbers match task frontmatter tiers** — 020 tier 6.5, 021 tier 6.5, 022 tier 6, 023 tier 6, 024 tier 6, 025 tier 6, 038 documented as running in two tiers (6 via design-scope, 6.5 via build-scope).
11. **Blueprint Appendix C appears at EOF** — matches refactor-001/002 precedent; doesn't perturb earlier line refs.
12. **Every `.env.example` row documented in 020 has signup URL + required-by-stage + required-now annotation.**
13. **Self-hosted integrations produce config templates, NOT .env rows** — 020 acceptance criteria enforces separation.
14. **Credentials-diff.md only emitted on re-runs** — spec documents detection logic: architect reads prior architecture.yaml; emits diff only if one exists.
15. **028/029/030 §Inputs explicitly list `.env`** — grep each for `.env` after edits; non-zero hits required.

## Risks + Rejected Alternatives

**Risk — architect decision quality.** Picking one vendor from a menu of 2–3 requires judgment the architect may not have (e.g., PCI footprint nuances). Mitigation: architect cites reasoning in `architecture.yaml.apps.*.integrations[].decisionRationale` so the user can audit + override at gate 5 by editing architecture.yaml and re-running.

**Risk — file-drop gate 5 is easy to miss.** User might forget to `touch docs/credentials-confirmed.txt` and assume the pipeline is stuck. Mitigation: orchestrator prints the exact next-step command in the terminal + re-prints every 60s while waiting (soft reminder, not spam).

**Risk — self-hosted services have no validation path.** Architect emits config-template but no runtime check. Mitigation: task 040 app-store compliance already has a "demo credentials" step that builders can extend to "deployment smoke-test" for self-hosted services. Out of scope for this refactor.

**Risk — user deletes `.env.example` manually and gate 5 can't print the checklist.** Mitigation: architect always re-writes `.env.example` on re-run; orchestrator uses a stat check (not a read) to detect `.env` existence. No dependency on user-owned files being intact.

**Rejected — browser form for gate 5.** Secrets passing through localhost HTTP + reflected in forms introduces XSS-via-self risk and complicates block-dangerous posture. File-drop keeps the boundary clean.

**Rejected — CLI AskUserQuestion for gate 5.** Secrets in terminal scrollback + copy/paste history. Claude also holds the prompt-response in tool-call history. File-drop isolates secrets to the user's editor.

**Rejected — single architect run, no late invocation.** Would require design stages to bootstrap without any architecture decisions at all. That works for UI Kit location / Turborepo (fixed) but means architect couldn't see the composed screens when deciding vendor SDKs — weaker decisions.

**Rejected — two-phase architect (tooling + full).** Earlier draft of this refactor had phase=tooling running pre-design for `icon_library` + `design_dials` + MCP provisioning. All three dissolve: icon_library + dials lock in selected-style.json at gate 2; design-stage MCPs are a fixed factory default registered at `/new-project`. Phase A was solving a non-problem.

**Rejected — architect writes `.env` directly.** Would require an escape hatch in `block-dangerous.sh`. Every escape hatch is a future foot-gun. File-drop preserves the hook's simplicity.

## Out of Scope

- Implementation of 020 architect agent (spec update only; implementation is a separate feature plan).
- Implementation of 038 skills-agent scope split (spec update only).
- gotribe-v1 re-run with new ordering (happens post-020-implementation; not this plan).
- Encryption-at-rest for `.env` (user's filesystem responsibility; 12-factor convention relies on filesystem perms + gitignore).
- Cloud secret-manager integration (Doppler, AWS Secrets Manager, Vault) — could be added later as an architect decision category.
- Architect re-decide loop at gate 5 (user rejects vendor pick, wants a different candidate from integrations-options.md) — gate 5 is currently capture-only. Future plan can add a `revise:vendor:CATEGORY` confirmation-file directive that loops back to architect with a pinned new choice.

## Attempt Log

### Attempt 1 — 2026-04-20 · Scaffolding spec updates

**Scope:** all scaffolding tasks in `affected-files` received refactor-003 amendments — architect post-signoff, dual-mode PM, split skills-audit scopes, dual-mode `/register-mcp-servers`, gate 5 file-drop mechanic, three-way deployment enum (vendor / self-hosted / declined), design-stage MCP pre-registration at `/new-project` time.

Blueprint Appendix C appended explaining the reorder reasoning. Scaffolding index (`000-scaffolding-index.md`) renumbered to reflect the new tier ordering.

### Attempt 2 — 2026-04-20 to 2026-04-22 · Pipeline skills + templates + schemas implemented

The scaffolding spec changes alone weren't enough — the design-stage skills named in the new order had to actually exist for the orchestrator to route through them. Work landed iteratively over three sessions:

**New skills** (each matching its refactor-003-amended scaffolding task):

- `.claude/skills/mockups/` (task 023) — N styles × M apps HTML grid + interactive review index
- `.claude/skills/stylesheet/` (task 024) — @repo/ui-kit assembly from winning style
- `.claude/skills/screens/` (task 025) — kit-only screen composition with `data-kit-*` attrs
- `.claude/skills/visual-review/` (task 025b) — 28-rule rubric × 3 viewports
- `.claude/skills/user-flows-generator/` — gate-4 viewer with sign-off form
- `.claude/skills/pick-style/` — CLI-equivalent of HITL gate 2 (task 036 is the production-path full HTTP server; pick-style unblocks testing)

**Templates** (factory-owned, copied into projects at `/new-project` step 5b):

- `.claude/templates/mockups-index-template.html` — the gate-2 review shell with viewport switcher + dial editor
- `.claude/templates/user-flows-template.html` — the gate-4 sign-off viewer shell
- `.claude/templates/ui-kit-*.{md,json,ts}` + `.claude/templates/ui-kit-eslint-plugin/` — task 022b UI Kit consumption contract templates

**Schemas** (factory `schemas/`, copied into projects at `/new-project` step 4):

- `schemas/signoff.schema.json` — gate-4 sign-off body (task 036 contract)
- `schemas/visual-review-report.schema.json` — aggregate report validator (task 025b)

**MCP registration mechanic**:

- `mcp-defaults-design.json` at factory root — the design-stage MCP default set (playwright, icons8, unsplash, chrome-devtools; image-generator behind `--flags=nanobanana`)
- `.mcp.json` at factory — the active registration (populated by `/register-mcp-servers --scope=design`)
- `/new-project` step 5b invokes `--scope=design` at project-bootstrap time so design stages have MCPs from the start

**Skill-level refinements** (walkthrough-derived):

- `.claude/skills/analyze/flows.md` — task-oriented flows structure (`## Flow N: Name`) replacing persona-narrative touchpoint dumps
- `.claude/skills/analyze/styles.md` — dials-per-style discipline + aesthetic-territory anti-convergence
- `.claude/skills/mockups/SKILL.md` — `--style-count` rejection (it's an analyze-only arg); per-style dials validation; archetype-selection algorithm fallback
- `.claude/hooks/detect-loop.mjs` — narrow exemption for Playwright capture tools + additional discriminators (url, query, width, height, filename, time, text, textGone)

**Scripts** (factory `scripts/`, copied into projects for local validation + build):

- `aggregate-components.mjs` — cross-platform component catalog aggregator (called from `/analyze` phase 6e)
- `build-screens-manifest.mjs` — screens-manifest canonical-hash builder
- `build-user-flows.mjs` — user-flows viewer builder
- `verify-024.mjs`, `verify-025.mjs`, `verify-025b.mjs` — per-stage verification scripts
- `visual-review-preflight.mjs` — static-server spawner/teardown for /visual-review
- `visual-review-aggregate.mjs`, `visual-review-inline-emit.mjs` — rubric report aggregation

### Attempt 3 — 2026-04-22 · End-to-end walkthrough on mindapp-v2 (refactor-003 validation)

Full pipeline run through the new order validated the refactor end-to-end:

- `/new-project mindapp-v2` (refactor-003 step 5b — Turborepo scaffold + shared packages + design-stage MCPs registered at bootstrap time) ✅
- `/analyze --style-count=10` (refactor-002 per-style dials + integrations-options.md menu from phase 2.5) ✅
- `/mockups` (10 styles × 2 apps = 20 mockups; `--style-count` correctly rejected as analyze-only) ✅
- `/pick-style 3` (Forest Hush) → `docs/selected-style.json` written with iconLibrary binding ✅
- `/stylesheet` → `@repo/ui-kit` at v0.1.0-tokens-only with 52 components bound + design-system-preview.html ✅
- `/screens` (78 screens × 5 ui-designer waves in parallel; 0 anti-slop violations) ✅
- `/visual-review` (240 PNGs × 28-rule rubric × 5 general-purpose agents; 41/80 pass, 39 fail on two clustered root causes) ✅
- `/user-flows-generator` (24 flows, 73 unique screens linked, dual-source parser handling mobile brackets vs webapp backticks) ✅

The walkthrough confirmed:

- Design-stage MCPs available from `/new-project` onward (no need to re-register post-signoff)
- `/stylesheet` reads `selected-style.json.iconLibrary` (refactor-003 `tooling.stack` shift validated)
- `/visual-review` report.json dual shape (screens[] + violations[]) consumed correctly by `/user-flows-generator` for per-step badges
- Signoff contract (screensManifestHash + visualReviewReportHash + uiKitVersion) binds atomically; all hashes in place

**Status:** refactor-003 spec is implemented in full + validated end-to-end. `/architect` through gate 5 remains pending (tasks 020 + 036 haven't shipped yet — blocked on separate plans) but that's expected: the architect + gate 5 were always "post-design" in refactor-003, and validation of those stages depends on the upstream design path being live (which it now is).

**Ready to mark completed.**

---
# COMPLETION RECORD (appended to archived plan)
completed: 2026-04-22
outcome: success
actual-files-changed:
  - .claude/hooks/detect-loop.mjs (modified)
  - .claude/skills/analyze/SKILL.md (modified)
  - .claude/skills/analyze/flows.md (modified)
  - .claude/skills/analyze/integrations.md (created)
  - .claude/skills/analyze/styles.md (modified)
  - .claude/skills/mockups/SKILL.md (modified)
  - .claude/skills/new-project/SKILL.md (modified)
  - .claude/skills/pick-style/SKILL.md (created)
  - .claude/skills/screens/SKILL.md (created)
  - .claude/skills/stylesheet/SKILL.md (created)
  - .claude/skills/user-flows-generator/SKILL.md (created)
  - .claude/skills/visual-review/SKILL.md (created)
  - .claude/skills/visual-review/rubric.md (created)
  - .claude/templates/mockups-index-template.html (modified)
  - .claude/templates/user-flows-template.html (created)
  - .gitignore (modified)
  - .mcp.json (created)
  - docs/022b-verification.md (modified)
  - docs/refactor-003-checklist.md (created)
  - docs/refactor-003-checklist.md (modified)
  - mcp-defaults-design.json (created)
  - multi-agent-app-generation-blueprint.md (modified)
  - package.json (modified)
  - plans/active.md (modified)
  - plans/active/refactor-003-pipeline-reorder-architect-credentials.md (created)
  - plans/active/refactor-003-pipeline-reorder-architect-credentials.md (modified)
  - plans/archive/refactor-002-analyst-refactor-001-alignment.md (modified)
  - pnpm-lock.yaml (modified)
  - proposals/hatch-proposal.md (created)
  - scaffolding/000-scaffolding-index.md (modified)
  - scaffolding/020-architect-agent.md (modified)
  - scaffolding/021-pm-agent.md (modified)
  - scaffolding/022-ui-designer-agent.md (modified)
  - scaffolding/023-mockups-skill.md (modified)
  - scaffolding/024-stylesheet-skill.md (modified)
  - scaffolding/025-screens-skill.md (modified)
  - scaffolding/026-turborepo-scaffold.md (modified)
  - scaffolding/027-shared-packages.md (modified)
  - scaffolding/028-backend-builder-agent.md (modified)
  - scaffolding/029-web-frontend-builder.md (modified)
  - scaffolding/030-mobile-frontend-builder.md (modified)
  - scaffolding/034b-output-contract-zod-schemas.md (modified)
  - scaffolding/035-orchestrator-core.md (modified)
  - scaffolding/036-hitl-gates.md (modified)
  - scaffolding/038-skills-agent.md (modified)
  - scaffolding/040-app-store-compliance.md (modified)
  - scaffolding/041-mcp-server-registration.md (modified)
  - schemas/signoff.schema.json (created)
  - schemas/visual-review-report.schema.json (created)
  - scripts/aggregate-components.mjs (created)
  - scripts/build-screens-manifest.mjs (created)
  - scripts/build-user-flows.mjs (created)
  - scripts/verify-024.mjs (created)
  - scripts/verify-025.mjs (created)
  - scripts/verify-025b.mjs (created)
  - scripts/verify-refactor-003.mjs (created)
  - scripts/verify-refactor-003.mjs (modified)
  - scripts/visual-review-aggregate.mjs (created)
  - scripts/visual-review-inline-emit.mjs (created)
  - scripts/visual-review-preflight.mjs (created)
commits:
  - hash: 3c2a55a
    message: "refactor-003: pipeline reorder + late architect + gate 5 credentials"
  - hash: 4242913
    message: "refactor-003: add verification checklist script + rendered report"
  - hash: 949b5c4
    message: "refactor-003: rename pending scaffolding files by build order"
  - hash: f44f796
    message: "refactor-003: consolidate pipeline reorder implementation + walkthrough"
attempts: 3
lessons:
  - "Moving architect + PM post-signoff let vendor decisions reflect actually-approved design; pre-refactor architect had to guess at user intent."
  - "Gate 5 file-drop mechanic (docs/credentials-confirmed.txt) beats an HTTP server for credentials — no agent ever touches .env."
  - "The walkthrough on mindapp-v2 validated the full design pipeline end-to-end; this kind of smoke test catches integration gaps scaffolding review misses."
  - "Three-way deployment enum (vendor/self-hosted/declined) handles every integration cleanly — declined was the missing third we didn't know we needed until brief review surfaced it."
test-results:
  summary: "design pipeline validated E2E on mindapp-v2 (80 screens generated, 41 pass / 39 fail via rubric)"
duration-minutes: 3693
---
