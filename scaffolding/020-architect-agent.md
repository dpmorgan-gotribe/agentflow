---
task-id: "020"
title: "Architect Agent + Architecture.yaml Template"
status: pending
priority: P2
tier: 5 — Planning Agents
depends-on: ["019"]
estimated-scope: medium
---

# 020: Architect Agent + Architecture.yaml Template

## What This Task Produces

1. Agent definition at `.claude/agents/architect.md`
2. Architecture.yaml template at `.claude/architecture.yaml.template`
3. `/architect` skill at `.claude/skills/architect/SKILL.md` — the pipeline stage invoked by the orchestrator at §23 step 8
4. `.mcp.json` generation logic (invoked from the skill) — either inline or delegated to task 041

## Scope

### Agent Definition

The most critical planning agent. Reads requirements and produces `.claude/architecture.yaml` — the Architecture-as-Code spec that every downstream agent reads.

```yaml
---
name: architect
description: Produces architecture.yaml from requirements. The most critical planning agent — every downstream agent reads its output.
tools: Read, Write, Bash, Grep, Glob
model: inherit
maxTurns: 40
effort: max
---
```

### Architecture.yaml Template

Create a template showing the expected structure. Key sections from the blueprint:

- **apps**: target applications (admin, web, mobile, api) with routing, auth, state management
- **packages**: shared code packages (types, ui-kit, api-client, utils). Note: `ui-kit` replaces the previously-separate `tokens` + `ui` packages per refactor-001 — it bundles tokens + styles + primitives + patterns + layouts + illustrations under a single versioned public API
- **tooling**: MCP servers needed, skills needed, budget limits, icon_library, design_dials
- **assets**: provenance tracking (user | researched | generated | hybrid | stock | vector)
- **compliance**: privacy manifest, AI consent modal, required native features, account management, required assets

### /architect Skill

Skill at `.claude/skills/architect/SKILL.md`. This is the pipeline stage the orchestrator invokes at §23 step 8 (blueprint L2778-2782).

```yaml
---
name: architect
description: Read requirements and asset inventory, produce architecture.yaml and project-specific .mcp.json. The pipeline's Architecture-as-Code stage.
when_to_use: after /analyze passes HITL review, before /pm
allowed-tools: Read Write Bash Grep Glob
---
```

Steps:

1. Read `docs/requirements.md` and `docs/asset-inventory.json`
2. Read `brief.md` §7 (Architecture Overview), §8 (Infrastructure), §9 (Backend Modules)
3. Produce `.claude/architecture.yaml` from the template — fill every section
4. Produce project-specific `.mcp.json` (see MCP scoping below, or delegate to task 041's `/register-mcp-servers` skill)
5. Note compliance requirements in architecture.yaml for the reviewer agent
6. Self-verify: the produced architecture.yaml passes schema validation; `.mcp.json` references only servers listed in `tooling.mcp_servers`

### MCP scoping in architecture.yaml (§14 L2162-2206)

The `tooling` section drives `.mcp.json` generation AND per-agent scoping. Example structure the architect must produce:

```yaml
tooling:
  icon_library: lucide # lucide | phosphor | heroicons | iconoir — chosen per project to match selected style
  design_dials: # architect proposes defaults from brief; analyst may refine per style in styles.md;
    design_variance: 4 # human finalizes at the /mockups HITL gate, writing per-style dials.yaml
    motion_intensity: 3 # 1=static / 10=cinematic
    visual_density: 5 # 1=gallery-airy / 10=cockpit-dense
  mcp_servers:
    - name: unsplash
      purpose: Stock photos for UI screens (hero, placeholders)
      scoped_to: [ui-designer, web-frontend-builder]
      config:
        command: npx
        args: ["@drumnation/unsplash-smart-mcp-server"]
        env_refs: [UNSPLASH_ACCESS_KEY]
    - name: icons8
      purpose: Icon search and download
      scoped_to: [ui-designer]
      config:
        url: https://mcp.icons8.com/mcp/
        transport: sse
    - name: image-generator
      purpose: Hero images, onboarding/empty-state illustrations, logos
      scoped_to: [ui-designer]
      feature_flag: nanobanana # omitted from .mcp.json when the run does not include --nanobanana
      budget: { max_calls: 50, max_cost_usd: 10 }
      config:
        command: npx
        args: ["@google/generative-ai-mcp"]
        env_refs: [GOOGLE_API_KEY]
    - name: playwright
      purpose: Multi-viewport screenshots for /visual-review
      scoped_to: [ui-designer, html-verifier]
      config:
        command: npx
        args: ["@playwright/mcp@latest"]
    - name: chrome-devtools
      purpose: Lighthouse / a11y inspection during /visual-review (optional)
      scoped_to: [ui-designer]
      config:
        command: npx
        args: ["chrome-devtools-mcp@latest"]
  skills:
    - hero-image-generation
    - responsive-layout-patterns
  budget:
    total_mcp_cost_usd: 25
    total_image_gen_calls: 100 # enforced only when nanobanana flag is on
```

Rules:

- `scoped_to` lists the agents whose YAML frontmatter must include this MCP server. Other agents get NO access (git-agent, tester, etc.).
- `.mcp.json` contains only servers used by at least one agent on this project
- `feature_flag` (task 041): servers whose flag is off for the run are omitted from `.mcp.json` and every agent's frontmatter
- Environment variables referenced via `env_refs` must appear in `.env.example`
- Per-server budgets are picked up by the orchestrator's budget enforcer (task 036)
- `icon_library` is picked per project; the analyst's styles.md may suggest per-style overrides, but the kit ships with one library to keep the visual language coherent
- `design_dials` are initial defaults; the real final values for the winning style are captured in `docs/selected-style.json` at the mockup gate

### Ready-to-use MCP servers (§14 L2219-2229 + plan additions)

Architect should prefer these when they match a requirement rather than inventing new ones:

- **icons8** — 368K+ icons, 116 styles
- **unsplash** / **pexels** — stock photos
- **gemini-nano-banana** — image generation (Gemini 2.5/3.x Flash Image); gated by `feature_flag: nanobanana`
- **dalle** — alternative image generation (optional)
- **playwright** — required by task 025b (/visual-review) for multi-viewport screenshots
- **chrome-devtools** — optional; Lighthouse + DOM inspection during /visual-review
- **figma** — design system read/write (optional handoff target)

## Acceptance Criteria

- [ ] `.claude/agents/architect.md` exists
- [ ] `.claude/architecture.yaml.template` shows all key sections (apps, packages, tooling, assets, compliance)
- [ ] `.claude/architecture.yaml.template` includes the `tooling` block with MCP scoping pattern above
- [ ] `.claude/skills/architect/SKILL.md` exists with the six steps and frontmatter shown
- [ ] Skill produces BOTH `architecture.yaml` AND `.mcp.json` (directly or via 041)
- [ ] Asset provenance section included (user | researched | generated | hybrid)
- [ ] Compliance section included with privacy manifest fields
- [ ] MCP scoping pattern documented so downstream agent YAML frontmatter can be derived mechanically
- [ ] `tooling.icon_library` field documented with supported values (lucide / phosphor / heroicons / iconoir)
- [ ] `tooling.design_dials` block documented with the three dials (design_variance, motion_intensity, visual_density) and their 1–10 semantics
- [ ] `image-generator` server entry in the template includes `feature_flag: nanobanana` and a concrete `budget` block
- [ ] `playwright` and `chrome-devtools` entries present in the template as required for task 025b (/visual-review)

## Human Verification

Review the architecture.yaml template — does it capture everything a downstream builder agent would need to know?
