# Multi-Agent App Generation System

**A unified blueprint and principles guide for building a Claude Code-based pipeline that generates React and React Native applications end-to-end from a structured brief.**

---

## How to read this document

This document has two jobs. It is a **blueprint** you implement against, and it is a **principles guide** that explains why each decision was made so you can adapt confidently when reality diverges from the plan. It is organized in six parts:

1. **Foundations** — the primitives, agents, file structure, and orchestration model
2. **Inputs and memory** — how specifications enter the system and how work history is preserved
3. **Pipeline stages** — the actual step-by-step flow from brief to working code
4. **Tools, safety, and compliance** — how agents access tools, avoid destructive actions, and ship apps that pass review
5. **Stack and delivery** — the specific React/React Native tooling and quality gates
6. **Reference** — comparisons, end-to-end sequence, and areas of evolving practice

Every section follows the same pattern: **principle** (what and why), **pattern** (how it's implemented), **example** (concrete code or config). Where decisions were open, I've locked them with reasoning so the blueprint is unambiguous.

---

# Part 1 — Foundations

---

## 1. Claude Code's agentic primitives

Claude Code provides six primitives. Understanding what each one is for — and what it is *not* for — prevents the most common failure mode of agent systems: jamming every feature through the first primitive you learn.

### Subagents

Subagents are specialized AI instances that run in **isolated context windows** with their own system prompts, tool access, and permissions. The parent sends a prompt string via the Agent tool; the subagent works independently and returns its final message verbatim as the tool result. Subagents **cannot spawn other subagents** — if nested delegation is needed, chain from the main conversation.

Agent files live in `.claude/agents/` as Markdown with YAML frontmatter:

```yaml
---
name: frontend-builder
description: Builds React and Next.js frontend components from architecture specs. Use when generating UI code for web targets.
tools: Read, Write, Edit, Bash, Grep, Glob
model: sonnet
permissionMode: acceptEdits
maxTurns: 30
skills:
  - react-patterns
  - tailwind-conventions
memory: project
color: blue
---

You are a senior React/Next.js developer. You build production-grade
frontend code from architecture specifications.

When invoked:
1. Read the architecture spec at .claude/architecture.yaml
2. Read the relevant screen definitions from docs/screens/
3. Generate components following the project's design token system
4. Run `pnpm typecheck` after every file you create
5. Return a summary of files created and any issues found
```

Subagents are discovered with priority ordering: managed settings > `--agents` CLI flag > `.claude/agents/` (project) > `~/.claude/agents/` (user) > plugin agents. Higher priority wins on name conflict.

Each subagent can maintain **persistent memory** via `MEMORY.md` at `.claude/agent-memory/<name>/` (project) or `~/.claude/agent-memory/<name>/` (user). The first 200 lines or 25KB loads automatically.

### Skills

Skills extend what Claude can do via `SKILL.md` files that load only when invoked — unlike CLAUDE.md which always loads. This **progressive disclosure** is the key design insight: skill descriptions (~30–100 tokens) load at startup, but full skill content loads only on demand, making it practical to install dozens of skills with minimal context cost.

```
my-skill/
├── SKILL.md           # Main instructions (required)
├── scripts/           # Executable scripts Claude can run
├── references/        # Documentation loaded as needed
├── examples/          # Example outputs
└── templates/         # Code templates
```

```yaml
---
name: react-component
description: >
  Generates React components following project conventions. Use whenever
  creating new UI components, pages, or layouts.
when_to_use: component creation, new page, new screen, UI generation
argument-hint: [component-name] [target-app]
allowed-tools: Read Write Edit Bash(pnpm *)
model: sonnet
effort: high
paths: "src/**/*.tsx, apps/**/components/**"
---

# React Component Generator

Read design tokens from `packages/tokens/src/index.ts` and patterns
from `packages/ui/src/`. Generate the component using $ARGUMENTS[0]
as the name. Place it in the correct app based on $ARGUMENTS[1].
Run `pnpm typecheck` to verify.
```

Skills support dynamic context injection — shell commands prefixed with `!` run before the skill content reaches Claude:

```markdown
## Current branch context
- Branch: !`git branch --show-current`
- Recent changes: !`git log --oneline -5`
```

### Slash commands

Slash commands are now unified with skills. Both `.claude/commands/deploy.md` and `.claude/skills/deploy/SKILL.md` create `/deploy`. **Use skills going forward** — they support bundled resources, scripts, and richer metadata. The legacy commands format is a single markdown file with optional YAML frontmatter.

### Hooks

Hooks are **deterministic** shell commands, HTTP endpoints, LLM prompts, or agent invocations at specific lifecycle points. Unlike CLAUDE.md instructions (advisory), hooks provide guaranteed enforcement.

| Event | Purpose |
|---|---|
| `PreToolUse` | Block dangerous commands, enforce file boundaries, validate inputs |
| `PostToolUse` | Auto-format code, run linters, update progress logs |
| `Stop` | Run final validation, update lesson logs |
| `SubagentStop` | Validate subagent output, trigger next pipeline stage |
| `SessionStart` | Inject environment context, load architecture spec |
| `PreCompact` | Save context snapshot before auto-compaction wipes state |
| `Notification` | Alert human on approval gates |

Configuration lives in `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{
          "type": "command",
          "command": "node .claude/hooks/block-dangerous.js"
        }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [{
          "type": "command",
          "command": "npx prettier --write \"$CLAUDE_TOOL_INPUT_FILE_PATH\" 2>/dev/null || true"
        }]
      }
    ]
  }
}
```

PreToolUse hooks control execution through exit codes: **exit 0 allows**, **exit 2 blocks** (stderr fed back to Claude as reason). Hooks can return JSON with `permissionDecision: "allow" | "deny" | "ask" | "defer"`. **Hooks fire even in `--dangerously-skip-permissions` mode** — they are your guardrails.

### MCP servers

Model Context Protocol servers provide external tool integration via `.mcp.json` at project root (team-shared) or `claude mcp add` (personal). Use MCP when you need a persistent, stateful service or cross-tool compatibility. Use skills when instructions and playbooks suffice.

```json
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.github.com/mcp",
      "headers": { "Authorization": "Bearer ${GITHUB_TOKEN}" }
    }
  }
}
```

### CLAUDE.md memory files

CLAUDE.md provides persistent instructions loaded every session. Claude walks upward from the working directory to the filesystem root, loading every CLAUDE.md and CLAUDE.local.md found.

| Scope | Location | Purpose |
|---|---|---|
| Enterprise | System dirs | Org-wide rules |
| User | `~/.claude/CLAUDE.md` | Personal preferences |
| Project | `./CLAUDE.md` | Team conventions |
| Local | `./CLAUDE.local.md` | Personal, gitignored |
| Subdirectory | `apps/web/CLAUDE.md` | Loaded when files in that dir are accessed |

CLAUDE.md supports `@` imports: `@docs/architecture.md` or `@~/.claude/global-rules.md` (max depth 5). Keep each CLAUDE.md **under 200 lines**.

### Decision tree

| Need | Primitive |
|---|---|
| Persistent project facts and conventions | CLAUDE.md or `.claude/rules/` |
| Reusable procedure or playbook | Skill (SKILL.md) |
| Context isolation and specialized tools | Subagent |
| Deterministic enforcement of rules | Hook |
| Persistent external service or API | MCP server |
| Quick user-triggered action | Slash command (via skill) |

---

## 2. The 12-agent roster

Your pipeline needs twelve agents organized into three tiers.

### Planning tier

**Analyst** — Receives the brief, validates it, scans for user-supplied assets, identifies targets (admin/web/mobile), maps user flows, outputs `docs/requirements.md` and `docs/asset-inventory.json`.

```yaml
---
name: analyst
description: Analyzes brief.md and user assets. Use at the start of every new project.
tools: Read, Write, Bash, Grep, Glob, WebSearch, WebFetch
model: opus
maxTurns: 40
effort: max
---
```

**Project Manager** — Decomposes requirements into a task graph with dependencies, priorities, and agent assignments. Outputs `docs/tasks.yaml`.

**Architect** — Reads requirements and produces `.claude/architecture.yaml` — the Architecture-as-Code specification that every downstream agent reads. This is the most critical planning agent.

### Building tier

**UI Designer** — Generates design tokens in `packages/tokens/`, HTML mockups in `docs/mockups/`, and the user flows sign-off screen. When user wireframes are present, reads them via vision and uses them as layout blueprints.

**Web Frontend Builder** — Next.js 15 App Router, Tailwind CSS, shadcn/ui.

**Mobile Frontend Builder** — Expo, React Native, NativeWind, React Native Reusables.

Separating web from mobile builders ensures each has focused expertise rather than context-switching between platforms.

**Backend Builder** — Generates tRPC routers, Prisma schema, database migrations, middleware, and authentication into `apps/api/`.

### Quality tier

**Tester** — Vitest unit tests for web, jest-expo for mobile, Playwright for web E2E, Maestro YAML for mobile E2E.

**Reviewer** — Checks architecture adherence, code quality, security, cross-target consistency. Can trigger builders to fix issues.

**Git Agent** — Creates feature branches, conventional commits, pull requests, branch-per-feature workflow.

### Meta tier

**Skills Agent** — Audits whether the project has skills for the chosen stack. If missing, researches documentation, authors new SKILL.md with bundled resources, validates on a minimal test case, deposits at root, clones into project.

**Agent Expert (Meta-Agent)** — When the system encounters a repeating task pattern without a dedicated agent, analyzes the pattern, writes a new agent definition, validates it, and adds it to `.claude/agents/`. This is the self-improvement loop.

**Lessons Agent** — Captures lessons from every run. When a builder hits an error requiring multiple attempts, the Lessons Agent records the pattern and solution. Global lessons → `~/.claude/CLAUDE.md`. Project lessons → `./CLAUDE.md` or `docs/lessons.md`. Agent-specific → `.claude/agent-memory/<name>/MEMORY.md`.

---

## 3. Orchestration and thread model

### The single-thread aspiration vs. reality

Your instinct that "one long thread from prompt to working solution" is the right aspiration is correct, but needs qualification. Anthropic's research shows **orchestrator-subagent** is the recommended pattern because it "handles the widest range of problems with minimal coordination overhead."

**Locked decision: external TypeScript orchestrator** using the Claude Agent SDK, not a single Claude Code session.

The external orchestrator calls `query()` once per stage. Each stage gets a fresh context window — eliminating the context bloat problem when analyst research, mockup HTML, stylesheets, and screen components would accumulate in one conversation. Structured JSON contracts between stages are API-enforced.

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

interface PipelineStage {
  name: string;
  slashCommand: string;
  prompt: (input: any) => string;
  schema: object;
  model?: string;
  gateEnabled: boolean;
  budgetUsd: number;
}

async function runStage(stage: PipelineStage, input: any): Promise<any> {
  let result: any = null;
  for await (const message of query({
    prompt: stage.prompt(input),
    options: {
      allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
      permissionMode: "acceptEdits",
      model: stage.model ?? await readModelConfig(stage.name),
      maxBudgetUsd: stage.budgetUsd,
      outputFormat: { type: "json_schema", schema: stage.schema }
    }
  })) {
    if (message.type === "result" && message.subtype === "success") {
      result = message.structured_output;
    }
  }
  await fs.writeFile(
    `./pipeline/${stage.name}-output.json`, 
    JSON.stringify(result, null, 2)
  );
  return result;
}
```

### Maintaining architectural awareness

Every agent must be able to answer: "What am I building, and how does my piece fit?" The solution is **Architecture-as-Code** — a machine-readable specification file (`.claude/architecture.yaml`) that serves as the single source of truth. Every agent reads it via the Read tool rather than having it stuffed into their system prompt.

### Token economics

Multi-agent systems use approximately **15× more tokens** than standard chat. Anthropic found **token usage alone explains 80% of performance variance** in agent tasks. The "pass file paths not content" principle directly addresses this:

```
# BAD: Passing content in the prompt
"Here is the full architecture spec: {5000 tokens of YAML}..."

# GOOD: Passing a file reference
"Read the architecture spec at .claude/architecture.yaml, focusing on
the 'apps.admin' section. Generate the dashboard page component."
```

### Context compaction

Claude Code auto-compacts at approximately 64–75% capacity. During compaction, it summarizes the conversation, preserving architectural decisions while discarding redundant tool outputs. Trigger manual compaction at milestone boundaries: `/compact Preserve all file paths, the architecture spec location, and the list of completed vs remaining tasks`.

Structure work so each subagent completes a self-contained task (one screen, one API route, one component) before returning. This prevents mid-task compaction.

---

## 4. File structure

### Global tool structure

Your agentic system itself — global agents, skills, commands, lessons — persists across all projects:

```
~/.claude/
├── CLAUDE.md                          # Global preferences and lessons
├── models.yaml                        # DEFAULT model assignment per agent
├── agents/                            # Global agent definitions (12 agents)
├── skills/                            # Global skills library
│   ├── validate-brief/
│   ├── parse-brief/
│   ├── author-brief/
│   ├── asset-scanner/
│   ├── check-existing-work/
│   ├── plan-feature/
│   ├── plan-bug/
│   ├── plan-refactor/
│   ├── plan-investigation/
│   ├── plan-status/
│   ├── plan-archive/
│   ├── plan-search/
│   ├── save-context/
│   ├── load-context-chain/
│   ├── react-patterns/
│   ├── expo-patterns/
│   ├── trpc-setup/
│   ├── turborepo-setup/
│   ├── tailwind-tokens/
│   ├── testing-patterns/
│   ├── user-flows-generator/
│   └── app-store-compliance/
├── hooks/
│   ├── block-dangerous.js
│   ├── detect-loop.mjs
│   ├── check-plan-ownership.mjs
│   ├── validate-brief.mjs
│   └── enforce-boundaries.sh
└── settings.json
```

### Per-project structure

When your init function creates a project, it clones from global and sets up:

```
my-generated-app/
├── brief.md                           # THE canonical project input
├── brief.manifest.json                # Index of all input files
├── companion/                         # Large structured data
│   ├── navigation-schema.json
│   ├── data-models.yaml
│   └── design-tokens.json
├── schemas/                           # JSON Schemas for validation
│   ├── brief-frontmatter.schema.json
│   └── navigation.schema.json
├── assets/                            # USER-SUPPLIED assets (optional)
│   ├── README.md
│   ├── logos/
│   ├── icons/
│   ├── fonts/
│   ├── images/
│   ├── wireframes/
│   ├── brand-guides/
│   └── colors.json
├── .claude/
│   ├── CLAUDE.md                      # Project-level instructions
│   ├── settings.json                  # Project hooks + permissions
│   ├── settings.local.json            # Local overrides (gitignored)
│   ├── models.yaml                    # PROJECT model override (cloned from global)
│   ├── architecture.yaml              # Architecture-as-Code
│   ├── agents/                        # Project agent overrides
│   ├── skills/                        # Project-cloned skills
│   ├── rules/                         # Modular rule files
│   │   ├── code-style.md
│   │   ├── mobile-rules.md
│   │   └── api-conventions.md
│   ├── hooks/
│   ├── state/
│   │   └── recent-attempts.json       # Loop detection state
│   └── worktrees/                     # Git worktrees (gitignored)
├── contexts/                          # Chained context snapshots
│   ├── checkpoints/                   # Dense summaries
│   └── archive/                       # Shipped project contexts
├── plans/
│   ├── active/                        # Current plans
│   ├── archive/                       # Completed plans
│   ├── superseded/                    # Replaced plans
│   ├── active.md                      # Auto-generated manifest
│   └── templates/
├── docs/
│   ├── requirements.md                # Analyst output
│   ├── tasks.yaml                     # PM output
│   ├── asset-inventory.json           # Asset scanner output
│   ├── mockups/                       # UI Designer mockups
│   ├── user-flows.html                # Sign-off screen
│   ├── screens/                       # Screen definitions
│   └── lessons.md                     # Project-specific lessons
├── apps/
│   ├── admin/                         # Next.js admin portal
│   ├── web/                           # Next.js web portal
│   ├── mobile/                        # Expo mobile app
│   └── api/                           # tRPC backend
├── packages/
│   ├── ui/                            # Shared components
│   ├── types/                         # Zod schemas + TS types
│   ├── tokens/                        # Design tokens
│   ├── api-client/                    # tRPC client + hooks
│   ├── utils/                         # Shared business logic
│   ├── eslint-config/
│   └── typescript-config/
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
├── justfile                           # Safe command recipes
├── CLAUDE.md                          # Root project instructions
└── .mcp.json                          # Shared MCP servers
```

### How agents navigate

Agents find things through three mechanisms:

- **Known paths**: architecture spec always at `.claude/architecture.yaml`, requirements at `docs/requirements.md`, tasks at `docs/tasks.yaml`
- **Naming conventions**: `index.ts` barrel exports, `page.tsx` for Next.js routes, `_layout.tsx` for Expo Router
- **CLAUDE.md references**: the project CLAUDE.md explicitly states where key files live

---

# Part 2 — Inputs and Memory

---

## 5. Brief.md — the canonical project input

### Why a structured brief beats a chat prompt

The fundamental problem with vibe coding is that it optimizes for the first iteration while destroying maintainability. A structured brief.md solves this. Where a chat prompt is ephemeral and ambiguous, a brief is **versioned, parseable, and auditable**. Every agent reads the same canonical source of truth.

Industry convergence: Kiro (Amazon), GitHub Spec Kit, BMAD Method, Cline Memory Bank, TaskMaster all use structured markdown as specification format.

A brief.md is a **hybrid agentic PRD** — strategic context of a BRD, acceptance criteria of a PRD, technical precision of an RFC, all structured for machine consumption. It describes *what to build*. CLAUDE.md describes *how to work*. Keep them separate.

### Schema-locked structure

Every brief.md starts with YAML frontmatter validated against JSON Schema:

```yaml
---
$schema: ./schemas/brief-frontmatter.schema.json
version: "1.0.0"
status: draft          # draft | review | approved | locked
project-name: "Acme Dashboard"
author: "Jane Doe"
created: 2026-01-15
last-modified: 2026-04-14
brief-schema-version: "1.0"
companion-files:
  - path: ./companion/navigation-schema.json
    type: navigation
    required: true
  - path: ./companion/data-models.yaml
    type: schema
    required: true
tags: [mvp, react-native, fintech]
amendments: []
---
```

The 20-section structure is enforced via markdownlint MD043:

```
1. Vision & Principles
2. Visual Design Requirements
3. Problem Statement
4. Core Entities
5. Key Distinctions
6. User Personas
7. Architecture Overview         [MUST contain code block]
8. Infrastructure Architecture
9. Backend Module Architecture
10. Navigation Schema            [MUST contain code block]
11. Screen Catalog
12. Key Features Summary
13. Security
14. Regulatory Notes
15. Success Metrics
16. Development Workflow
17. Testing Strategy
18. Deployment Pipeline
19. Milestones & Timeline
20. Appendix
```

### Validation pipeline

Three layers protect brief integrity:

**Layer 1: CI workflow** runs on every PR touching `brief.md`, `companion/**`, or `schemas/**`:

```yaml
# .github/workflows/validate-brief.yml
- uses: mheap/frontmatter-json-schema-action@v1
  with:
    path: brief.md
    schema: schemas/brief-frontmatter.schema.json
- run: npx markdownlint-cli2 brief.md
- run: node scripts/validate-brief.mjs --all
```

**Layer 2: PreToolUse hook** blocks agents from writing malformed briefs:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Write|Edit|MultiEdit",
      "hooks": [{
        "type": "command",
        "command": "node .claude/hooks/validate-brief.mjs"
      }]
    }]
  }
}
```

**Layer 3: `/validate-brief` skill** runs on-demand:

```markdown
---
name: validate-brief
description: Validate brief.md structure, frontmatter, companion files,
  and embedded code blocks. Run before starting implementation.
allowed-tools: Read Bash Grep Glob
---

Run in sequence:
1. `npx markdownlint-cli2 brief.md`
2. `node scripts/validate-brief.mjs --frontmatter`
3. `node scripts/validate-brief.mjs --codeblocks`
4. `node scripts/validate-brief.mjs --companions`
Report all errors with line numbers, or "✓ Brief validation passed"
```

### Brief authoring workflow

Three authoring patterns:

**Conversational** (new projects) — the `/author-brief` skill interviews the user one question at a time, filling the template progressively.

**Template-fill** (experienced teams) — edit `brief-template.md` directly.

**Amended** (existing projects) — frontmatter `amendments` array tracks scope changes with `sections-affected` and `downstream-impact` fields.

### Brief decomposition

The brief is the root of a DAG of artifacts. Each downstream agent reads specific sections:

```
brief.md
├─→ Analyst → requirements.md, asset-inventory.json, brief-summary.json
├─→ Architect → architecture.yaml  (reads §7, §8, §9)
├─→ PM → tasks.yaml  (reads §12, §19, requirements.md)
├─→ UI Designer → screens/*.html, user-flows.html
│     (reads §2, §10, §11 + companion/navigation-schema.json via jq)
├─→ Backend Builder → apps/api/**  (reads §9, architecture.yaml, tasks.yaml)
├─→ Security Agent → security-review.md  (reads §13, §14)
└─→ DevOps Agent → infra/**  (reads §8, §16, §18)
```

**File-reference discipline** — agents reference `brief.md § 7. Architecture Overview`, they never copy content. CLAUDE.md enforces:

```markdown
## Brief Protocol
- The canonical specification is `brief.md` at project root
- Read brief.md FIRST before starting any work
- Never ask the user for information that is in the brief
- Reference brief sections, never copy content from them
- For large companion files, use jq to extract targeted sections
- If brief.md is missing or invalid, STOP and report the error
```

### Companion files

Split into a companion file when content exceeds ~50 lines of structured data, is consumed by tools or build systems, would create noisy diffs, or represents a machine-readable contract. The navigation-schema.json at 1,787 lines is a canonical example.

For large companions:
- Provide a **`.summary.md`** human-readable outline — agents read this first
- Use **jq extraction** for targeted reads: `jq '.routes[] | select(.guard == "auth")' companion/navigation-schema.json`
- Index in `brief.manifest.json` with JSONPath markers

---

## 6. User-supplied assets ingestion

### Principle

When users bring their own brand assets — fonts, logos, icons, wireframes, images — the pipeline should detect these and use them rather than generating new ones. **User assets always override generated or researched assets.** This preserves brand consistency and respects work the user has already done.

### Directory convention

Users drop assets into `./assets/` before running the pipeline:

```
assets/
├── README.md                  # Tells user what to put where
├── logos/
│   ├── primary.svg            # Required if any logos present
│   ├── mark.svg               # Icon-only version
│   └── wordmark.svg           # Text-only version
├── icons/                     # User's custom icons (SVG preferred)
├── fonts/                     # .woff2 / .ttf / .otf files
├── images/
│   ├── hero/                  # Hero images per screen
│   ├── backgrounds/
│   └── placeholders/
├── wireframes/                # PNG/PDF wireframes — UI Designer reads as blueprints
│   ├── admin-dashboard.png
│   └── mobile-home.png
├── brand-guides/              # Brand guideline PDFs to extract from
│   └── brand-guide.pdf
└── colors.json                # Explicit color palette override
```

The `assets/README.md` tells users exactly what they can drop in, with examples. If the directory is absent or empty, the pipeline falls back to researched/generated assets without complaint.

### Asset scanner skill

The Analyst's first step is invoking `/scan-assets`:

```markdown
---
name: asset-scanner
description: Detect and catalog user-supplied brand assets at ./assets/.
  Run first during Analyst phase.
allowed-tools: Read Bash Glob
---

## Steps
1. Check if ./assets/ exists — if not, write empty asset-inventory.json
2. Glob ./assets/**/* and catalog by subdirectory
3. For images, extract dimensions via `file` or `identify`
4. For fonts, detect format and family name via `fc-query` or filename
5. For logos/icons (SVG), read the file to get viewBox
6. For colors.json, parse and validate hex values
7. For wireframes, note the screen/page name from filename stem
8. For brand-guides PDFs, mark for later parsing by Analyst
9. Write docs/asset-inventory.json

## Output format
{
  "hasUserAssets": true,
  "logos": {
    "primary": { "path": "assets/logos/primary.svg", "viewBox": "0 0 240 60" },
    "mark": { "path": "assets/logos/mark.svg", "viewBox": "0 0 60 60" }
  },
  "icons": [
    { "name": "search", "path": "assets/icons/search.svg" }
  ],
  "fonts": [
    { "family": "AcmeSans", "weights": [400, 700], 
      "files": ["assets/fonts/acme-sans-400.woff2", "assets/fonts/acme-sans-700.woff2"] }
  ],
  "images": { "hero": [...], "backgrounds": [...] },
  "wireframes": [
    { "screen": "admin-dashboard", "path": "assets/wireframes/admin-dashboard.png" }
  ],
  "brandGuides": ["assets/brand-guides/brand-guide.pdf"],
  "colors": { "primary": "#6B9B37", "secondary": "#14b8a6" }
}
```

### Wireframe-driven mockup generation

When wireframes are present, the UI Designer reads them via Claude's vision capabilities and uses them as **layout blueprints**. The mockup keeps the user's structural decisions (where the sidebar is, how cards are arranged) but applies the extracted brand system for visual polish.

UI Designer prompt pattern:

```
INPUTS (file references):
- Asset inventory: docs/asset-inventory.json
- If asset-inventory.json.wireframes[] includes this screen, read the
  wireframe image and use it as the LAYOUT BLUEPRINT
- Use fonts from asset-inventory.json.fonts (reference by path in CSS)
- Use colors from asset-inventory.json.colors
- Use logos from asset-inventory.json.logos where a logo belongs
- Use icons from asset-inventory.json.icons — only fetch from Icons8
  MCP if a needed icon is missing from the user's set

PRIORITY:
  user-supplied > researched > generated
```

### Brand extraction

When users provide logos but no explicit color palette, extract colors with node-vibrant (JS) or Pillow (Python). When a brand-guide PDF is present, the Analyst reads it via vision to extract colors, typography names, spacing rules, and voice guidelines into `docs/brand-extracted.yaml`.

Extracted brand data flows into `packages/tokens/`:

```typescript
// packages/tokens/tailwind-preset.ts
import assetInventory from "../../docs/asset-inventory.json";

const userColors = assetInventory.colors ?? {};
const userFonts = assetInventory.fonts ?? [];

export const sharedPreset = {
  theme: {
    extend: {
      colors: {
        primary: userColors.primary ?? defaultPalette.primary,
        secondary: userColors.secondary ?? defaultPalette.secondary,
      },
      fontFamily: {
        sans: userFonts.length 
          ? [userFonts[0].family, 'system-ui', 'sans-serif']
          : ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
};
```

### Hybrid fallback

Per-asset-type fallback is essential because users rarely provide everything:

| Asset | User has | User missing |
|---|---|---|
| Logo | Use `assets/logos/primary.svg` | Generate via DALL-E MCP in logo style matching brand-guide |
| Colors | Use `assets/colors.json` or extracted | Research from competitors, pick palette |
| Fonts | Reference `assets/fonts/*.woff2` | Google Fonts API pick matching brand guide |
| Icons | Use `assets/icons/*.svg` | Icons8 MCP, matched by keyword |
| Images | Use `assets/images/*` | Unsplash MCP or DALL-E generation |
| Wireframes | Use as layout blueprint | UI Designer generates layout from scratch |

### Architecture.yaml records asset provenance

```yaml
# In architecture.yaml
assets:
  provenance: hybrid      # user | researched | generated | hybrid
  userProvided:
    logos: true
    icons: partial        # user has some, generating rest
    fonts: true
    wireframes: [admin-dashboard, mobile-home]
  generated:
    icons: [notifications, profile, settings]
    heroImages: all
```

---

## 7. Model configuration system

### Principle

Not every agent needs Opus. The Git Agent renaming branches can use Haiku. The Architect making foundational decisions benefits from Opus's deeper reasoning. A config file pins model assignment per agent with hierarchical override, so cost and quality can be tuned without editing agent files.

### Current Claude Code model mechanisms

Claude Code provides several overlapping ways to set the model:

| Mechanism | Scope | Precedence |
|---|---|---|
| `ANTHROPIC_MODEL` env var | Process | 1 (highest) |
| `--model` CLI flag | Invocation | 2 |
| `/model` slash command | Session | 3 |
| Agent YAML `model:` field | Per-agent | 4 |
| `settings.json` default | Project | 5 |
| Claude Code default | Global | 6 (lowest) |

The `model: inherit` value in agent YAML means "use whatever the parent/session is using." This is useful for generic helper agents.

### Locked recommendation: YAML config with hierarchical override

**System-level default** at `~/.claude/models.yaml`:

```yaml
# ~/.claude/models.yaml — System defaults
version: "1.0"

defaults:
  planning:   claude-opus-4-6           # Deep reasoning needed
  building:   claude-sonnet-4-6         # Balanced quality/cost
  quality:    claude-sonnet-4-6         # Careful review
  meta:       claude-opus-4-6           # System-building is high-stakes
  mechanical: claude-haiku-4-5          # Cheap deterministic work

agents:
  analyst:             { tier: planning, effort: max }
  architect:           { tier: planning, effort: max }
  project-manager:     { tier: planning, effort: high }
  ui-designer:         { tier: building, effort: high }
  web-frontend-builder:    { tier: building, effort: high }
  mobile-frontend-builder: { tier: building, effort: high }
  backend-builder:     { tier: building, effort: high }
  tester:              { tier: quality,  effort: medium }
  reviewer:            { tier: quality,  effort: high }
  git-agent:           { tier: mechanical, effort: low }
  skills-agent:        { tier: meta,     effort: high }
  agent-expert:        { tier: meta,     effort: max }
  lessons-agent:       { tier: quality,  effort: medium }

budget:
  perStageMaxUsd:
    analyze:    3.00
    mockups:    10.00
    stylesheet: 2.00
    screens:    25.00    # Scales with screen count
    code:       50.00
    test:       10.00
    review:     5.00
  perPipelineMaxUsd: 150.00
```

**Project-level override** at `.claude/models.yaml` — cloned from global on `init`, edited freely per project:

```yaml
# .claude/models.yaml — Project override
extends: ~/.claude/models.yaml

agents:
  # This project has complex auth — use Opus for backend
  backend-builder: { tier: planning, effort: max }
  
  # Simple UI — downgrade to Haiku
  ui-designer:     { tier: mechanical, effort: medium }

budget:
  perPipelineMaxUsd: 250.00     # Larger project budget
```

### How the orchestrator reads config

```typescript
// orchestrator/model-config.ts
import fs from "fs";
import yaml from "yaml";
import os from "os";
import path from "path";

interface ModelConfig {
  version: string;
  defaults: Record<string, string>;
  agents: Record<string, { tier: string; effort: string }>;
  budget: any;
}

export async function readModelConfig(agentName: string): Promise<{
  model: string;
  effort: string;
  budgetUsd: number;
}> {
  const globalConfig = parseConfig(
    path.join(os.homedir(), ".claude", "models.yaml")
  );
  const projectConfig = parseConfig(".claude/models.yaml");
  
  // Project extends global
  const merged = projectConfig 
    ? mergeConfigs(globalConfig, projectConfig)
    : globalConfig;

  // Env var override
  const envOverride = process.env.ANTHROPIC_MODEL;
  
  const agentMeta = merged.agents[agentName];
  const model = envOverride ?? merged.defaults[agentMeta.tier];
  
  return {
    model,
    effort: agentMeta.effort,
    budgetUsd: merged.budget.perStageMaxUsd[agentName] ?? 5.00,
  };
}

function mergeConfigs(global: ModelConfig, project: ModelConfig): ModelConfig {
  return {
    version: project.version ?? global.version,
    defaults: { ...global.defaults, ...project.defaults },
    agents: { ...global.agents, ...project.agents },
    budget: {
      perStageMaxUsd: {
        ...global.budget.perStageMaxUsd,
        ...project.budget?.perStageMaxUsd,
      },
      perPipelineMaxUsd: project.budget?.perPipelineMaxUsd 
        ?? global.budget.perPipelineMaxUsd,
    },
  };
}
```

### Agent YAML stays model-agnostic

Agent files specify `model: inherit` so they pick up whatever the orchestrator assigns at runtime:

```yaml
---
name: backend-builder
description: Generates tRPC routers, Prisma schema, migrations.
tools: Read, Write, Edit, Bash, Grep, Glob
model: inherit      # Orchestrator sets via config
permissionMode: acceptEdits
---
```

The orchestrator invokes the agent with the resolved model:

```typescript
const { model, effort, budgetUsd } = await readModelConfig("backend-builder");
const messages = query({
  prompt: buildPrompt(agent, input),
  options: {
    model,
    effort,
    maxBudgetUsd: budgetUsd,
    // ...
  }
});
```

### CLAUDE.md documents the convention

```markdown
## Model Configuration
- System defaults: ~/.claude/models.yaml (managed by platform team)
- Project overrides: .claude/models.yaml (edit freely per project)
- To switch a single agent to a different tier, add it to `agents:` 
  in the project config
- Budget limits are enforced by the orchestrator — exceeding 
  perPipelineMaxUsd aborts the run
- To bypass config entirely for debugging: ANTHROPIC_MODEL=claude-sonnet-4-6
```

### Cost estimation

The orchestrator reports expected cost before running a stage:

```
Pipeline: generate-app
Stages and estimated costs:
  /analyze          analyst      opus-4-6   ~$2.50
  /mockups          ui-designer  sonnet-4-6 ~$8.00
  /stylesheet       ui-designer  sonnet-4-6 ~$1.50
  /screens          ui-designer  sonnet-4-6 ~$20.00  (80 screens × $0.25)
  /architect        architect    opus-4-6   ~$4.00
  /build-backend    backend      sonnet-4-6 ~$15.00
  /build-frontend   frontends    sonnet-4-6 ~$30.00  (parallel)
  /test             tester       sonnet-4-6 ~$8.00
  /review           reviewer     sonnet-4-6 ~$4.00
  /git              git-agent    haiku-4-5  ~$0.20
                                            ────────
  Estimated total:                          ~$93.20
  Pipeline budget:                          $150.00
  
Proceed? [y/N]
```

---

## 8. Plan/archive system

### Principle

The most common failure mode in agentic coding is **repeated work**: an agent tries a fix, fails, tries the same fix, fails, loops. The plan/archive system prevents this by making every unit of work a **file** that persists across sessions, with explicit status tracking and searchable history.

Every production AI coding tool has converged on this: Claude Code Plan Mode, Kiro, GitHub Spec Kit, Aider `/architect`, Cursor Plan Mode, Cline Memory Bank, TaskMaster, Devin Playbooks. The unifying insight: **plans must be files, not conversations**.

### Plan file structure

```markdown
---
id: feat-001
type: feature          # feature | bug | refactor | investigation
status: in-progress    # draft | approved | in-progress | completed 
                       # | abandoned | superseded
author-agent: architect
created: 2026-04-14
updated: 2026-04-14
parent-plan: null
supersedes: null
superseded-by: null
branch: feat/user-auth
affected-files:
  - src/auth/**
  - src/middleware/auth.ts
  - packages/api/routes/auth.ts
feature-area: authentication
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-001: User Authentication System

## Problem Statement
The application requires JWT-based authentication with email/password
login, OAuth2 social providers, and role-based access control.

Brief reference: `brief.md § 13. Security`

## Approach
1. Implement Clerk integration for auth provider
2. Add auth middleware to Fastify routes
3. Create RBAC guards matching navigation-schema.json guard definitions
4. Add session management with refresh token rotation

## Rejected Alternatives
- **Firebase Auth** — rejected because brief specifies Clerk
- **Custom JWT implementation** — rejected for security risk

## Expected Outcomes
- [ ] Login/register screens render correctly
- [ ] JWT tokens issued on successful auth
- [ ] Protected routes return 401 without valid token
- [ ] RBAC guards enforce role-based access

## Validation Criteria
- All auth unit tests pass
- Integration test: login → access protected route → logout
- No secrets in committed code

## Attempt Log
<!-- Populated automatically by agents -->
```

### Status state machine

```
draft → approved → in-progress → completed → archived
                 → abandoned → archived
                 → superseded (by new plan) → archived
```

Only PM or human can transition `draft → approved`. The executing agent transitions `approved → in-progress` and `in-progress → completed`. The HITL gate can force `→ abandoned`. The `→ superseded` transition requires a `superseded-by` reference.

Plan ID convention: `{type}-{sequence}-{slug}`: `feat-001-user-auth`, `bug-042-login-crash`, `refactor-003-db-layer`.

### Archive system

When a plan completes or is abandoned, the archive captures:

- The plan file itself
- A **completion summary** YAML block appended at the end
- Git diff hash for implementing commits
- Lessons learned
- Test results at completion

```yaml
---
# COMPLETION RECORD (appended to archived plan)
completed: 2026-04-15
outcome: success       # success | partial | failed | abandoned
actual-files-changed:
  - src/auth/clerk.ts (created)
  - src/middleware/auth.ts (created)
  - packages/api/routes/auth.ts (modified)
commits:
  - hash: abc1234
    message: "feat: implement Clerk auth integration"
attempts: 2
lessons:
  - "Clerk SDK v5 changed the session API — had to reference migration guide"
  - "RBAC guard names must exactly match navigation-schema.json guard field"
test-results:
  unit: 14/14 passed
  integration: 3/3 passed
duration-minutes: 45
---
```

Agents search the archive via four indexes:
- **By affected file**: `grep -rl "src/auth" plans/archive/`
- **By feature area**: frontmatter `feature-area` field
- **By error message**: for bug plans
- **By outcome**: `grep -l "outcome: failed" plans/archive/`

### Loop detection via circuit breaker

A hash-based loop detection hook blocks the third identical attempt:

```javascript
// .claude/hooks/detect-loop.mjs
import crypto from 'crypto';
import fs from 'fs';

const ATTEMPTS_FILE = '.claude/state/recent-attempts.json';
const MAX_IDENTICAL = 3;

function hashAttempt(action) {
  const sig = `${action.tool}:${action.file}:${action.content?.slice(0, 200)}`;
  return crypto.createHash('sha256').update(sig).digest('hex').slice(0, 12);
}

let input = '';
for await (const chunk of process.stdin) input += chunk;
const toolInput = JSON.parse(input);

const hash = hashAttempt({
  tool: toolInput.tool_name,
  file: toolInput.tool_input?.file_path || toolInput.tool_input?.command,
  content: toolInput.tool_input?.content || toolInput.tool_input?.new_string
});

const attempts = fs.existsSync(ATTEMPTS_FILE)
  ? JSON.parse(fs.readFileSync(ATTEMPTS_FILE, 'utf8'))
  : [];

const identical = attempts.filter(a => a.hash === hash).length;

if (identical >= MAX_IDENTICAL) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        `LOOP DETECTED: This exact action has been attempted ${identical} times. ` +
        `Previous attempts failed. Try a fundamentally different approach or ` +
        `escalate to human with /plan-bug.`
    }
  }));
  process.exit(0);
}

attempts.push({ hash, timestamp: Date.now(), tool: toolInput.tool_name });
fs.mkdirSync('.claude/state', { recursive: true });
fs.writeFileSync(ATTEMPTS_FILE, JSON.stringify(attempts.slice(-50), null, 2));
process.exit(0);
```

### Escalation ladder

CLAUDE.md configures the retry policy:

```markdown
## Retry Policy
- Attempt 1-2: Try different approaches to the same problem
- Attempt 3: Run `/plan-investigation` to research the problem
- Attempt 4: Try the investigation's recommended approach
- Attempt 5: STOP. Write findings to the plan's attempt log and
  escalate to human with a clear summary of what was tried
- NEVER exceed 5 attempts on the same error
```

### Pre-work check discipline

Every agent's first action — before reading code, before planning, before touching any file — is `/check-existing-work`:

```markdown
---
name: check-existing-work
description: Search active and archived plans for work related to the
  current task. Run BEFORE starting any new work. Returns summaries 
  with file references, not full plan content.
allowed-tools: Read Bash Grep Glob
---

1. Accept search query (file path, feature name, error message)
2. Search plans/active/ for matching plans
3. Search plans/archive/ for matching completed/abandoned work
4. Search plans/superseded/ for replaced plans
5. For each match, return: plan ID, type, status, outcome, one-line 
   summary, and link to full plan file (do NOT paste content)
6. If matches found, warn: "Related work exists — review before proceeding"
7. If no matches: "No related work found — safe to proceed"
```

### Plan skills (slash commands)

All plan operations are skills exposing slash commands:

- `/plan-feature` — scaffold new feature plan
- `/plan-bug` — scaffold bug investigation plan
- `/plan-refactor` — refactor plan
- `/plan-investigation` — time-boxed research plan
- `/plan-status` — show all active plans
- `/plan-archive` — complete and archive with outcome summary
- `/plan-supersede` — mark old plan replaced
- `/plan-search` — search active + archived

```markdown
---
name: plan-feature
description: Create a new feature implementation plan.
allowed-tools: Read Write Bash Grep Glob
---

1. Accept feature description from $ARGUMENTS or ask user
2. Run `/check-existing-work` — verify no duplicate plans
3. Generate next plan ID: count existing feat-*.md files + 1
4. Read plans/templates/feature-plan.md
5. Fill in: problem statement (from brief.md reference), approach,
   affected files (by searching codebase), expected outcomes,
   rejected alternatives (at least one)
6. Set status "draft", attempt-count 0
7. Write to plans/active/feat-{ID}-{slug}.md
8. Create git branch: feat/{slug}
9. Report: "Plan created. Review and `/plan-approve feat-{ID}` to start."
```

### Plan ownership and multi-agent coordination

Each plan's frontmatter specifies `author-agent` and `assigned-agents`. A PreToolUse hook blocks edits to files owned by other plans:

```javascript
// .claude/hooks/check-plan-ownership.mjs
// Read all active plans, extract affected-files, check if the file
// being edited belongs to a different plan's ownership
```

Git worktree isolation: `claude --worktree feat-user-auth` creates an isolated checkout so parallel plans don't collide.

---

## 9. Chained context preservation

### Principle

Conversational context dies on compaction, session restart, or crash. **Chained context snapshots** preserve work state as compact markdown files that link backward, forming a chain an agent can follow until it has enough state to resume.

This differs from:
- **CLAUDE.md** (stable project facts that always apply)
- **Plans** (intent: what we're doing and why)
- **Lessons** (generalized insights from completed work)

Contexts are the **ephemeral working state** — "what was happening when the session ended."

### Snapshot format

Filename: `contexts/YYYYMMDD-HHMMSS-<agent>-<brief>.md`

```markdown
---
session-id: "20260414-153022"
timestamp: 2026-04-14T15:30:22Z
agent: backend-builder
task-id: feat-012-user-profiles
previous-context: 20260414-143801-backend-builder-user-profiles.md
checkpoint: false
status: in-progress     # in-progress | blocked | checkpoint | final
---

# Context snapshot — backend-builder — user profiles API

## Summary
Implementing the user profile CRUD endpoints for feat-012. Schema done,
routes partially wired. Stuck on a Zod validation issue.

## Completed since last snapshot
- Added users table migration in packages/db/migrations/0042_users.sql
- Wrote Zod schema in packages/types/src/user.ts
- Implemented GET /users/:id route in apps/api/routes/users.ts

## Current state
- Working branch: feat/user-profiles (commit 7a3f2c1)
- Tests: 4/7 passing
- Failing: POST /users — Zod refuses to accept nullable optional `bio`

## Next steps
1. Fix Zod schema — `bio: z.string().nullish()` instead of `z.string().nullable().optional()`
2. Add PUT /users/:id route
3. Add DELETE /users/:id route (soft delete per brief §13)
4. Run full test suite and update tasks.yaml

## Open questions
- Should profile images go through the media module or inline upload?
  → Posted to Slack #architecture, awaiting Architect agent response.

## Key files touched
- packages/db/migrations/0042_users.sql
- packages/types/src/user.ts
- apps/api/routes/users.ts
- apps/api/routes/__tests__/users.test.ts

## Decisions made
- Chose UUID v7 for user IDs (time-ordered, better index locality)
- Soft delete via `deleted_at` column, not separate `deleted_users` table
```

### Checkpoint snapshots

Every ~5 regular snapshots or at logical milestones, produce a **checkpoint** — a denser summary that makes the chain self-contained from that point forward. Agents following the chain backward can stop at a checkpoint:

```markdown
---
session-id: "20260414-160000"
timestamp: 2026-04-14T16:00:00Z
agent: orchestrator
task-id: feat-012-user-profiles
previous-context: 20260414-153022-backend-builder-user-profiles.md
checkpoint: true
status: checkpoint
---

# CHECKPOINT — End of day, feat-012 user profiles

## Everything needed to resume this feature from scratch

### Feature goal
User profile CRUD with soft delete, per brief.md § 11 screen catalog
"Profile Settings" and companion/data-models.yaml `User` entity.

### What's done
- Migration 0042: users table with UUID v7, soft delete, timestamps
- Zod schema at packages/types/src/user.ts
- GET /users/:id, POST /users working with 7/7 tests passing
- Plan: plans/active/feat-012-user-profiles.md (status: in-progress)

### What's left
- PUT /users/:id route
- DELETE /users/:id (soft delete)
- Frontend builders haven't started — waiting for API complete
- Integration with media module for profile images — BLOCKED awaiting
  Architect decision (see last 3 snapshots)

### Key architectural decisions
- UUID v7 (not v4) for time-ordered IDs
- Soft delete via deleted_at column
- Profile images: DECISION PENDING (architect async)

### To resume: next agent should
1. Read this checkpoint
2. Check plans/active/feat-012-user-profiles.md
3. Read apps/api/routes/users.ts current state
4. Continue with PUT route implementation
```

### Avoiding context bloat

Three disciplines prevent the chain becoming its own problem:

1. **Each snapshot under 500 lines.** If you have more to say, make a checkpoint instead.
2. **Checkpoints bound chain depth.** Agents stop at the most recent checkpoint when following the chain backward.
3. **Archive after ship.** Once a project ships, move `contexts/` to `contexts/archive/` so new work starts from a clean chain.

### Save-context and load-context-chain skills

```markdown
---
name: save-context
description: Capture current work state as a chained context snapshot.
  Run at logical breakpoints, before session end, or when blocked.
allowed-tools: Read Write Bash
---

1. Generate session-id from current timestamp: YYYYMMDD-HHMMSS
2. Find the most recent file in contexts/ to link as previous-context
3. Determine if this should be a checkpoint:
   - Every 5th snapshot
   - At end-of-session
   - At major milestones
   - When user requests `/save-checkpoint`
4. Gather state from:
   - git status / git log --oneline -5
   - Failing tests from last test run (if any)
   - Current plan file if one is active
   - Files touched this session (git diff --name-only)
5. Write snapshot to contexts/{session-id}-{agent}-{slug}.md
6. If checkpoint, also add to contexts/checkpoints/ symlink
7. Return snapshot path
```

```markdown
---
name: load-context-chain
description: Reconstruct work state by following context chain backward
  until a checkpoint or sufficient state is accumulated.
allowed-tools: Read Bash Glob
---

1. Find the most recent context in contexts/ (sorted by filename)
2. Read that context fully
3. If checkpoint: stop. You have complete state.
4. Otherwise: follow frontmatter `previous-context` to next file
5. Keep following until:
   a. You reach a checkpoint (stop, you have enough)
   b. You've read 5 non-checkpoint snapshots (stop, summarize and warn)
   c. Chain breaks (previous-context file missing) — warn user
6. Synthesize: summarize what's been done, current state, next steps,
   open questions, key files. Report this to the user before acting.
```

### Integration with hooks

**SessionStart hook** — at the start of a fresh session, remind the agent to check for prior context:

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "echo '{\"additionalContext\": \"If resuming work, run /load-context-chain to reconstruct state from previous sessions. Check contexts/ for most recent snapshot.\"}'"
      }]
    }]
  }
}
```

**PreCompact hook** — save a snapshot before auto-compaction wipes state:

```json
{
  "hooks": {
    "PreCompact": [{
      "hooks": [{
        "type": "command",
        "command": "node .claude/hooks/auto-save-context.mjs"
      }]
    }]
  }
}
```

**Stop hook** — save a final snapshot when the session ends:

```json
{
  "hooks": {
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "node .claude/hooks/save-final-context.mjs"
      }]
    }]
  }
}
```

### CLAUDE.md protocol

```markdown
## Context Preservation Protocol
- Before starting work, run `/load-context-chain` to check for prior state
- After significant steps (completing a sub-task, before switching context, 
  end of session), run `/save-context`
- If you're the first agent on a task: no prior chain exists, start fresh
- If you find an open question in a prior context, address it or escalate
- Checkpoints are made every 5 snapshots or at major milestones
- Never read more than 5 snapshots deep without hitting a checkpoint — 
  if the chain goes longer without checkpoint, it's broken. Make a 
  checkpoint to bound the damage.
```

### Crash resilience workflow

```
10:00  Agent starts work on feat-012
10:15  /save-context → contexts/20260414-101500-backend-...md
10:45  /save-context → contexts/20260414-104501-backend-...md (previous: 101500)
11:00  SYSTEM CRASH
       
11:30  Fresh session starts
       SessionStart hook reminds: "run /load-context-chain"
       Agent runs /load-context-chain
       Reads 104501 (most recent), reads 101500 (previous)
       Both non-checkpoints, but they contain the state needed
       Agent summarizes: "Was implementing POST /users, stuck on Zod schema"
       User confirms, agent resumes work from exact spot
```

---

# Part 3 — Pipeline Stages and Orchestration

---

## 10. Pipeline stages: the locked slash commands

**Locked decision**: `/analyze`, `/mockups`, `/stylesheet`, `/screens` are the canonical stage slash commands. They are skills (SKILL.md in `.claude/skills/`) exposing slash commands. The external orchestrator wraps them for automated end-to-end runs; the slash commands stay available for manual step-by-step debugging and client-driven iteration.

### /analyze — the Analyst stage

```markdown
---
name: analyze
description: Analyze brief.md and user assets, produce requirements.md,
  asset-inventory.json, and brief-summary.json. First stage of every pipeline.
allowed-tools: Read Write Bash Grep Glob WebSearch WebFetch
model: inherit
---

## Prerequisites
- brief.md exists at project root
- Run `/validate-brief` first — abort if validation fails

## Steps
1. Run `/validate-brief` — abort on failure
2. Run `/scan-assets` — produces docs/asset-inventory.json
3. Read brief.md section by section, validating each against schema
4. If asset-inventory.hasUserAssets, bias the analysis toward user's 
   existing brand (extract colors, fonts, style)
5. Identify targets: admin portal, web portal, mobile app
6. Map user journeys per persona (brief.md §6)
7. List all screens per target (cross-reference brief.md §11 and 
   companion/navigation-schema.json)
8. Identify integrations (auth provider, payments, analytics, AI)
9. Research external technologies the Architect may need skills for — 
   note as "skills needed" in requirements
10. Write docs/requirements.md with structured sections
11. Write docs/brief-summary.json (compact index for other agents)
12. Report to orchestrator: target count, screen count, skills needed,
    assets found, compliance flags

## Output contract
- docs/requirements.md exists and is valid
- docs/asset-inventory.json exists and validates against schema
- docs/brief-summary.json exists with required fields
- Return JSON: { success: bool, targets: [...], screenCount: N, 
  skillsNeeded: [...], assetsFound: bool, warnings: [...] }

## Self-verification
Before completing, verify:
- All three output files exist
- brief-summary.json is valid JSON
- requirements.md has no [NEEDS CLARIFICATION] markers (if any,
  report them to orchestrator as gaps)
```

After `/analyze`, the HITL gate kicks in: human reviews requirements and asset inventory, approves or requests changes.

### /mockups — the UI Designer mockup stage

```markdown
---
name: mockups
description: Generate HTML mockups for all screens, using user wireframes
  as blueprints when present. Produces docs/mockups/*.html.
allowed-tools: Read Write Bash Grep Glob
model: inherit
argument-hint: [count]   # Optional: limit to N mockups for initial review
---

## Prerequisites
- /analyze has completed successfully
- docs/requirements.md, docs/asset-inventory.json exist

## Steps
1. Read docs/asset-inventory.json — catalog what user assets exist
2. Read docs/requirements.md — get screen list and journeys
3. Read companion/navigation-schema.json via jq for screen metadata
4. If $ARGUMENTS specifies a count N, limit this pass to N representative 
   mockups spanning different screen types (1 dashboard, 1 list, 1 form, 
   1 detail, etc.) — defer the rest to a later /mockups run after approval
5. For each mockup:
   a. If assets/wireframes/{screen}.png exists, read it as layout blueprint
   b. If user has logos/colors/fonts, use those (not generated)
   c. If icons needed and user has them, use user's; else queue for Icons8
   d. Generate mockup as pure HTML (not React) for speed of iteration
   e. Write to docs/mockups/{screen-id}.html
6. Generate docs/mockups/index.html — grid view of all mockups for review
7. Report to orchestrator: mockup count, styles used, icons downloaded

## Critical output rules
- ALWAYS write HTML output to the file path specified
- NEVER include HTML in your response text
- Response should ONLY contain the file path and status
- DO NOT explain the HTML. DO NOT add markdown. DO NOT wrap in backticks.
- Self-verify: read back each file and confirm it starts with <!doctype or <html

## Output contract
- docs/mockups/*.html files exist (one per screen)
- docs/mockups/index.html exists as grid review page
- Return JSON: { success: bool, mockupsGenerated: N, 
  userAssetsUsed: [...], iconsFromMCP: [...] }
```

After `/mockups`, HITL gate: client reviews the mockup grid, approves style direction or requests changes (which loops back to `/mockups`).

### /stylesheet — the design token stage

```markdown
---
name: stylesheet
description: Generate the canonical design token system and shared 
  stylesheet from approved mockups and user assets. Produces 
  packages/tokens/ and packages/ui/ base styles.
allowed-tools: Read Write Bash Grep Glob
model: inherit
---

## Prerequisites
- /mockups completed and approved by HITL gate
- docs/asset-inventory.json exists

## Steps
1. Analyze approved mockups to extract the consistent visual vocabulary:
   - Color palette (from user assets first, then from mockups)
   - Typography scale (from user fonts first, then from mockups)
   - Spacing rhythm (4px or 8px base unit — detect from mockups)
   - Border radii, shadows, transitions
2. Do a FULL asset inventory download now — every icon, font, image
   referenced across all mockups. Partial inventory was for mockups;
   full inventory is for production.
3. Generate packages/tokens/:
   - tailwind-preset.ts with extended theme
   - index.ts exporting tokens as TypeScript
   - css-variables.css for runtime theming
4. Generate packages/ui/primitives/ base components following the
   locked style: Button, Input, Card, Modal, Badge, etc.
5. Generate one reference HTML that shows every primitive with every 
   variant — the design system preview
6. Write to docs/design-system-preview.html
7. Report to orchestrator

## Output contract
- packages/tokens/* files exist and pnpm typecheck passes
- packages/ui/primitives/* components exist
- docs/design-system-preview.html exists
- Return JSON: { success: bool, tokenCount: N, primitiveCount: M,
  assetsDownloaded: [...] }
```

After `/stylesheet`, HITL gate: review design system preview, approve or iterate.

### /screens — the full screen generation stage

```markdown
---
name: screens
description: Generate all remaining screens as HTML mockups using the 
  approved stylesheet and primitives. Produces the complete visual spec 
  for code generation.
allowed-tools: Read Write Bash Grep Glob
model: inherit
---

## Prerequisites
- /stylesheet completed and approved
- packages/tokens/ and packages/ui/primitives/ exist

## Steps
1. Read companion/navigation-schema.json via jq — full screen list
2. Identify which screens still need mockups (vs /mockups representative 
   set that were approved)
3. For each remaining screen:
   a. Reference approved style from packages/tokens/
   b. Compose from packages/ui/primitives/ (via HTML/CSS equivalents)
   c. If wireframe exists, follow layout blueprint
   d. Write to docs/screens/{target}/{screen-id}.html
4. After ALL screens complete, invoke /user-flows-generator skill to 
   build docs/user-flows.html
5. Report progress in batches of 20 screens (don't wait until all done)

## Batching strategy for large apps (450+ screens)
- Group screens by feature area and user journey
- Generate in batches of 20–40 screens per Claude invocation
- Checkpoint contexts between batches
- If a batch fails, retry only that batch, not the whole set

## Output contract
- docs/screens/{target}/*.html for every screen in navigation-schema
- docs/user-flows.html exists and is navigable
- Return JSON: { success: bool, screensGenerated: N, 
  batches: [...], failedScreens: [...] }
```

After `/screens`, the **final HITL gate**: client reviews user-flows.html and signs off. Only after sign-off does code generation (`/architect`, `/build-backend`, `/build-frontend`) begin.

### Stage summary

```
/analyze → /mockups → [HITL: mockup approval]
         → /stylesheet → [HITL: design system approval]
         → /screens → [HITL: user flows sign-off]
         → /architect → /build-backend → /build-frontend → /test → /review → /git
```

Each stage is a skill. Each stage has an output contract. Each stage can be run manually (for debugging or client iteration) or via the orchestrator (for automation).

---

## 11. Human-in-the-loop gates

### The decision: external orchestrator as primary

Four approaches were evaluated: pause/resume checkpoints, slash commands per stage, hooks-based gates, external orchestrator. **The external orchestrator wins** because it gives fresh context per stage (eliminating bloat), structured JSON contracts between stages, trivial gate toggling, and a clean path to full automation later.

The slash commands (`/analyze` through `/screens`) remain as the **manual fallback** for debugging and client-driven iteration. Hooks remain as **quality enforcement within stages**.

### Orchestrator architecture

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readModelConfig } from "./model-config";
import fs from "fs/promises";

interface PipelineStage {
  name: string;
  slashCommand: string;
  outputSchema: object;
  gateEnabled: boolean;
  onGate?: (output: any) => Promise<GateDecision>;
}

interface GateDecision {
  approved: boolean;
  feedback?: string;
}

const stages: PipelineStage[] = [
  {
    name: "analyze",
    slashCommand: "/analyze",
    outputSchema: analyzeOutputSchema,
    gateEnabled: true,
    onGate: requirementsReviewGate,
  },
  {
    name: "mockups",
    slashCommand: "/mockups",
    outputSchema: mockupsOutputSchema,
    gateEnabled: true,
    onGate: mockupsReviewGate,
  },
  {
    name: "stylesheet",
    slashCommand: "/stylesheet",
    outputSchema: stylesheetOutputSchema,
    gateEnabled: true,
    onGate: designSystemGate,
  },
  {
    name: "screens",
    slashCommand: "/screens",
    outputSchema: screensOutputSchema,
    gateEnabled: true,
    onGate: userFlowsSignOffGate,     // THE FINAL SIGN-OFF GATE
  },
  {
    name: "architect",
    slashCommand: "/architect",
    outputSchema: architectOutputSchema,
    gateEnabled: false,     // Auto-proceed after screens approved
  },
  // ... build-backend, build-frontend, test, review, git
];

async function runPipeline(): Promise<void> {
  let currentInput: any = null;
  
  for (const stage of stages) {
    let approved = false;
    let attempts = 0;
    
    while (!approved && attempts < 3) {
      const { model, effort, budgetUsd } = await readModelConfig(stage.name);
      
      let result: any = null;
      for await (const message of query({
        prompt: stage.slashCommand + (currentInput?.feedback 
          ? ` \n\nPrevious feedback: ${currentInput.feedback}` 
          : ""),
        options: {
          allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
          permissionMode: "acceptEdits",
          model,
          effort,
          maxBudgetUsd: budgetUsd,
          outputFormat: { type: "json_schema", schema: stage.outputSchema },
        },
      })) {
        if (message.type === "result" && message.subtype === "success") {
          result = message.structured_output;
        }
      }
      
      await fs.writeFile(
        `./pipeline/${stage.name}-output.json`,
        JSON.stringify(result, null, 2)
      );
      
      if (!stage.gateEnabled) {
        approved = true;
        currentInput = result;
        break;
      }
      
      // HITL gate
      const decision = await stage.onGate!(result);
      if (decision.approved) {
        approved = true;
        currentInput = result;
      } else if (decision.feedback) {
        currentInput = { ...result, feedback: decision.feedback };
        attempts++;
      } else {
        throw new Error(`Pipeline aborted at stage: ${stage.name}`);
      }
    }
    
    if (!approved) {
      throw new Error(`Stage ${stage.name} failed after 3 attempts`);
    }
  }
}
```

### Gate toggling for full autonomy

Each stage has `gateEnabled: boolean`. To go fully autonomous, set all gates to false:

```typescript
// config/pipeline.yaml
stages:
  analyze:    { gateEnabled: true }
  mockups:    { gateEnabled: true }
  stylesheet: { gateEnabled: true }
  screens:    { gateEnabled: true }      # The one gate you never disable
  architect:  { gateEnabled: false }
  build:      { gateEnabled: false }
  test:       { gateEnabled: false }
  review:     { gateEnabled: false }
  git:        { gateEnabled: false }
```

Even in "full autonomy" mode, **keep the screens sign-off gate enabled**. Shipping without client sign-off creates the wrong kind of surprise.

---

## 12. User flows sign-off screen

### Principle

After all screens are generated, the UI Designer produces `docs/user-flows.html` — a single navigable page that demos every screen organized by user journey. This is the deliverable clients sign off on before code generation begins. It is the most important HITL gate in the pipeline.

### What it is

- Single `docs/user-flows.html` file that the orchestrator opens in a browser
- Sidebar navigation grouped by persona and user journey
- Main view: iframe embedding the current screen, with device frame chrome (mobile/tablet/desktop)
- Annotations: numbered steps showing "1. User lands on login → 2. Enters credentials → 3. Redirected to dashboard"
- Approval button that writes `docs/signoff-{timestamp}.json` with client name, version, date, and approval state
- Version bar showing previous sign-offs for comparison when iterating

### Not

- Not a working app (no real data, no API calls)
- Not a Figma prototype (lives in the repo, versioned with the code)
- Not Storybook (screens, not isolated components)

### User flows generator skill

```markdown
---
name: user-flows-generator
description: Generate docs/user-flows.html — the navigable demo of all 
  screens used for client sign-off. Invoked at the end of /screens.
allowed-tools: Read Write Bash Glob
---

## Steps
1. Read docs/screens/**/*.html — catalog every screen
2. Read docs/requirements.md §User Journeys — get journey definitions
3. Read brief.md §6 User Personas
4. Read companion/navigation-schema.json via jq for navigation metadata
5. Read .claude/templates/user-flows-template.html for the viewer
6. For each persona, group relevant screens into journeys:
   e.g., "New user onboarding: auth-splash → auth-signup → auth-verify 
   → onboarding-1 → onboarding-2 → discover-home"
7. Generate screens-manifest.json:
   {
     "version": "1.0",
     "personas": [
       { 
         "id": "seeker", 
         "name": "Sarah the Seeker",
         "journeys": [
           {
             "id": "discovery",
             "title": "Discovering a community",
             "screens": [
               { "id": "auth-splash", "path": "screens/webapp/auth-splash.html",
                 "note": "First impression — value prop must be clear" },
               { "id": "auth-interests", "path": "...",
                 "note": "Select 3+ interests for better matching" }
             ]
           }
         ]
       }
     ],
     "targets": ["admin", "webapp", "mobile"]
   }
8. Inject manifest as JSON in the HTML viewer
9. Write docs/user-flows.html
10. Write docs/user-flows-manifest.json
11. Report URL to orchestrator: file:///path/to/docs/user-flows.html
```

### Viewer template structure

The `user-flows-template.html` is a self-contained HTML file with inline CSS and JS (no build step needed). Key features:

```html
<!-- docs/user-flows.html structure -->
<!DOCTYPE html>
<html>
<head>
  <title>User Flows — {project-name}</title>
  <style>/* inline styles */</style>
</head>
<body>
  <aside id="sidebar">
    <h1>{project-name} User Flows</h1>
    <nav>
      <!-- Populated from manifest -->
      <section data-persona="seeker">
        <h2>Sarah the Seeker</h2>
        <ul data-journey="discovery">
          <li><a href="#auth-splash">1. Splash</a></li>
          <li><a href="#auth-interests">2. Interests</a></li>
          <!-- ... -->
        </ul>
      </section>
    </nav>
  </aside>
  
  <main>
    <div id="controls">
      <label>Device: 
        <select id="device">
          <option value="mobile">Mobile (375×667)</option>
          <option value="tablet">Tablet (768×1024)</option>
          <option value="desktop">Desktop (1440×900)</option>
        </select>
      </label>
      <label>Target:
        <select id="target">
          <option value="webapp">Webapp</option>
          <option value="mobile">Mobile app</option>
          <option value="admin">Admin portal</option>
        </select>
      </label>
    </div>
    
    <div id="screen-frame">
      <div class="device-chrome" data-device="mobile">
        <iframe id="screen" src=""></iframe>
      </div>
    </div>
    
    <div id="annotations">
      <h3>Step annotations</h3>
      <ol id="annotation-list"></ol>
    </div>
  </main>
  
  <footer id="signoff">
    <div>
      <strong>Version:</strong> 1.0
      <strong>Generated:</strong> 2026-04-14
      <strong>Previous sign-offs:</strong> <a href="signoff-20260410.json">2026-04-10</a>
    </div>
    <form id="signoff-form">
      <input type="text" placeholder="Client name" name="clientName" required>
      <label><input type="checkbox" name="approved" required>
        I approve these flows and authorize code generation to begin</label>
      <button type="submit">Sign off</button>
    </form>
  </footer>
  
  <script>
    const manifest = {/* injected by skill */};
    // Render sidebar, handle nav, device switching, signoff POST
  </script>
</body>
</html>
```

### Sign-off capture

The sign-off form POSTs to a small local endpoint the orchestrator runs (or writes to a file watched by the orchestrator). The orchestrator detects `docs/signoff-{timestamp}.json` appears with `approved: true` and proceeds.

```json
// docs/signoff-20260414-161542.json
{
  "version": "1.0",
  "signedAt": "2026-04-14T16:15:42Z",
  "clientName": "Acme Corp / Jane Doe",
  "approved": true,
  "comments": "Love the onboarding flow. One concern: the empty state on
    Discover feels a bit sparse. Not a blocker, please address in a 
    follow-up.",
  "screensApproved": 483,
  "screensManifestHash": "sha256:7a3f2c1..."
}
```

The manifest hash proves the sign-off applies to the exact screens generated — if anything changes after sign-off, the hash won't match and a new sign-off is needed.

### Versioning

Each `/screens` iteration produces a new `user-flows.html`. Previous versions are archived to `docs/user-flows-archive/{timestamp}.html` so clients can see how the flow evolved between revisions.

---

## 13. Output contract enforcement

### Principle

The UI Designer sometimes returns chat/prose explanations instead of pure HTML. This isn't a prompt engineering failure — it's a structural one. The fix requires **defense in depth** at six layers, not just better prompts.

### The six layers

```
Layer 1: Prompt engineering ........ Agent system prompt + CLAUDE.md rules (soft)
Layer 2: File-based output ......... Write tool for HTML, response text for status only (structural)
Layer 3: API constraints ........... output_config.format + strict: true (hard guarantee)
Layer 4: Hook validation ........... PostToolUse + SubagentStop + Stop hooks (deterministic)
Layer 5: Retry with feedback ....... Zod validation → error injection → re-attempt (recovery)
Layer 6: Separate verifier ......... Independent agent checks output (defense-in-depth)
```

### Layer 2: file-based output (the strongest single intervention)

Instead of returning HTML in response text, instruct the agent to write HTML to a file and return only status. This eliminates the prose-in-response problem structurally.

```markdown
# In ui-designer.md agent file
## CRITICAL OUTPUT RULES
1. ALWAYS write HTML output to the file path specified in the task
2. NEVER include HTML in your response text
3. Your response should ONLY contain the file path and status
4. DO NOT explain the HTML. DO NOT add markdown. DO NOT wrap code in backticks.

## Output Protocol
1. Generate the HTML component
2. Write it to the specified output path using the Write tool
3. Verify the file by reading it back
4. Report ONLY: "✅ Written to {path}" or "❌ Error: {reason}"
```

### Layer 3: constrained decoding

The API's `output_config.format` with JSON Schema compiles a grammar that physically constrains token generation. This is not a prompt trick — it's an API-level guarantee.

```typescript
const UIDesignerOutput = z.object({
  filePath: z.string(),
  status: z.enum(["success", "partial", "error"]),
  mockupId: z.string(),
  assetsUsed: z.array(z.string()),
  errors: z.array(z.string()).optional(),
});

const response = await client.messages.create({
  model: "claude-sonnet-4-6",
  messages: [/*...*/],
  output_config: { format: zodOutputFormat(UIDesignerOutput) },
});
// response.content[0].text is GUARANTEED to parse as UIDesignerOutput
```

For large HTML outputs that exceed schema complexity limits, use structured output for the status envelope while routing actual HTML through the file-based pattern.

### Layer 4: hook validation

PostToolUse hook validates HTML immediately after Write:

```bash
#!/bin/bash
# .claude/hooks/validate-html-write.sh
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path')

if [[ "$FILE_PATH" != */mockups/*.html && "$FILE_PATH" != */screens/*.html ]]; then 
  exit 0
fi

CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // empty')

# Must start with HTML tag or doctype
if ! echo "$CONTENT" | head -5 | grep -qiE '^\s*(<\!doctype|<html|<div|<section|<header|<main|<form)'; then
  echo '{"decision":"block","reason":"HTML file must start with an HTML tag. Rewrite with pure HTML."}' >&2
  exit 2
fi

# Must not contain markdown code fences
if echo "$CONTENT" | grep -q '```'; then
  echo '{"decision":"block","reason":"HTML file contains markdown code fences. Write pure HTML."}' >&2
  exit 2
fi

exit 0
```

### Layer 5: retry with feedback

When validation fails, retry with the specific error in the prompt:

```typescript
async function generateHTMLWithRetry(prompt: string, outputPath: string, maxRetries = 3) {
  let lastError: string | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const fullPrompt = lastError
      ? `${prompt}\n\n⚠️ PREVIOUS ATTEMPT FAILED:\n${lastError}\nFix the issue. Write ONLY valid HTML to ${outputPath}.`
      : prompt;
    
    await callUIDesignerAgent(fullPrompt, outputPath);
    
    const fileContent = await readFile(outputPath, "utf-8").catch(() => null);
    if (!fileContent) { 
      lastError = `No file written to ${outputPath}.`; 
      continue; 
    }
    
    const validation = validateHTML(fileContent);
    if (validation.valid) return outputPath;
    
    lastError = validation.errors.join("\n");
  }
  
  throw new Error(`UI Designer failed after ${maxRetries} attempts.`);
}
```

### Layer 6: separate verifier

For the sycophantic self-evaluation problem, deploy a separate HTML Verifier agent using Haiku. Cheap, independent, catches what the generating agent misses.

---

# Part 4 — Tools, Safety, Compliance

---

## 14. The Toolshed pattern

### Principle

Stripe's "Toolshed" hosts ~500 MCP tools shared across their agent fleet. A deterministic orchestrator curates ~15 relevant tools per task before the LLM starts. Every MCP tool definition burns context tokens — GitHub MCP alone is ~42K tokens. With all tools loaded, accuracy drops from ~95% to ~71%. **Aggressive curation is not optional.**

### Locked decision: hybrid approach

**Project-level MCP configuration** (configured once per project, consumes context for full pipeline) + **task-level skill specifications** (lightweight, ~100 tokens, loaded on demand).

**Analyst determines project-level tooling** during `/analyze`:

```yaml
# In architecture.yaml
tooling:
  mcp_servers:
    - name: unsplash-mcp
      purpose: Stock photos for UI screens
      scoped_to: [ui-designer, frontend-builder]
    - name: icons8-mcp
      purpose: Icon search and download
      scoped_to: [ui-designer]
    - name: image-generator-mcp
      purpose: Hero images, logos, placeholders
      scoped_to: [ui-designer]
      budget: { max_calls: 50, max_cost_usd: 10 }
  skills:
    - hero-image-generation
    - responsive-layout-patterns
    - react-native-navigation-patterns
  budget:
    total_mcp_cost_usd: 25
    total_image_gen_calls: 100
```

**Architect generates project-specific `.mcp.json`** — only the MCP servers this project needs:

```json
{
  "mcpServers": {
    "unsplash": {
      "command": "npx",
      "args": ["@drumnation/unsplash-smart-mcp-server"],
      "env": { "UNSPLASH_ACCESS_KEY": "${UNSPLASH_KEY}" }
    },
    "icons8": {
      "url": "https://mcp.icons8.com/mcp/",
      "transport": "sse"
    }
  }
}
```

**Tasks specify lightweight skills inline**:

```yaml
# tasks.yaml excerpt
- id: build-landing-page
  agent: frontend-dev
  skills: [hero-image-generation, responsive-layout]
  # Agent automatically has access to project-level MCP tools
```

### Ready-to-use MCP servers

| Need | Server | Notes |
|---|---|---|
| Icons | Icons8 MCP (`mcp.icons8.com/mcp`) | 368K+ icons, 116 styles |
| Stock photos | Unsplash Smart MCP | Context-aware search, auto attribution |
| Stock photos | Pexels MCP | Free alternative |
| Image generation | DALL-E MCP / Gemini Nano Banana MCP | Hero images, logos |
| Design systems | Figma MCP (`mcp.figma.com/mcp`) | Read designs, write to canvas |

**Fonts and color palettes** lack dedicated MCP servers — wrap Google Fonts API as a simple MCP or package color theory as a skill (more efficient for this use case).

### Partial vs. full inventory pattern

Fits naturally with the pipeline stages:
- **`/mockups` (partial)** — download only what each representative mockup needs
- **`/stylesheet` (full)** — download complete asset inventory for production
- **`/screens` (incremental)** — additional assets as new screens require them

### Tool scoping

Each subagent's YAML frontmatter lists only the MCP servers relevant to its role:

```yaml
# .claude/agents/ui-designer.md
mcp_servers:
  - icons8
  - unsplash
  - image-generator
# git-agent sees NONE of these — it has no business calling image gen
```

### Budget enforcement

The reserve-commit pattern: before every MCP call, the orchestrator atomically reserves budget. Prevents runaway costs when an agent retry-storms or fans out to sub-agents.

```typescript
interface Budget {
  reserve(amount: number, scope: string): Promise<Reservation>;
  commit(reservation: Reservation, actualAmount: number): Promise<void>;
  release(reservation: Reservation): Promise<void>;
}

// Before calling image generation
const res = await budget.reserve(0.04, "ui-designer/image-gen");
try {
  const image = await generateImage(prompt);
  await budget.commit(res, actualCostFromResponse(image));
} catch (e) {
  await budget.release(res);
  throw e;
}
```

---

## 15. Safety, hooks, and justfile

### PreToolUse protection hooks

Your safety perimeter. They run before every tool call and block regardless of permission mode.

```bash
#!/usr/bin/env bash
# .claude/hooks/block-dangerous.sh
set -euo pipefail

COMMAND=$(cat | jq -r '.tool_input.command // ""')

DANGEROUS_PATTERNS=(
  'rm -rf /'
  'rm -rf ~'
  'rm -rf \.'
  'git push.*--force.*main'
  'git push.*--force.*master'
  'git reset --hard'
  'git clean -fd'
  'DROP TABLE'
  'DROP DATABASE'
  ':(){ :|:& };:'
)

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qiE "$pattern"; then
    echo "BLOCKED: Command matches dangerous pattern: $pattern" >&2
    exit 2
  fi
done

exit 0
```

File boundary enforcement:

```bash
#!/usr/bin/env bash
# .claude/hooks/enforce-boundaries.sh
set -euo pipefail

FILE_PATH=$(cat | jq -r '.tool_input.file_path // .tool_input.path // ""')
PROJECT_DIR="$CLAUDE_PROJECT_DIR"
RESOLVED=$(realpath -m "$FILE_PATH" 2>/dev/null || echo "$FILE_PATH")

if [[ ! "$RESOLVED" == "$PROJECT_DIR"* ]]; then
  echo "BLOCKED: Write outside project directory: $RESOLVED" >&2
  exit 2
fi

# Block sensitive files
BLOCKED_FILES=(".env" ".env.local" "*.pem" "*.key")
for blocked in "${BLOCKED_FILES[@]}"; do
  if [[ "$(basename "$FILE_PATH")" == $blocked ]]; then
    echo "BLOCKED: Cannot modify sensitive file: $FILE_PATH" >&2
    exit 2
  fi
done

exit 0
```

### Justfile as safe command wrapper

Curate all allowed commands as `just` recipes, then restrict Claude to running only `just` commands. This makes `--dangerously-skip-permissions` safe because the only commands available are curated.

```just
# justfile — curated safe commands for Claude Code
set dotenv-load
set shell := ["bash", "-euo", "pipefail", "-c"]

default:
    @just --list

# Development
dev:
    pnpm turbo dev

build:
    pnpm turbo build

# Testing
test *args:
    pnpm turbo test {{args}}

test-e2e target:
    pnpm turbo test:e2e --filter={{target}}

# Quality
lint:
    pnpm turbo lint

typecheck:
    pnpm turbo typecheck

format:
    pnpm prettier --write "**/*.{ts,tsx,json,md}"

# Git (safe operations only)
status:
    git status

diff *args:
    git diff {{args}}

commit message:
    git add -A && git commit -m "{{message}}"

branch name:
    git checkout -b {{name}}

# Dependencies
install:
    pnpm install

add-dep package target:
    pnpm --filter={{target}} add {{package}}
```

Settings restrict Bash to `just` commands:

```json
{
  "permissions": {
    "allow": [
      "Read(*)",
      "Grep(*)",
      "Glob(*)",
      "Bash(just *)"
    ],
    "deny": [
      "Bash(rm *)",
      "Bash(curl * | *)",
      "Bash(wget *)"
    ]
  }
}
```

### Layered safety architecture

Five rings, outermost to innermost:

1. **Containerization** — devcontainer with network firewall whitelisting only essential domains
2. **Permission hooks** — PreToolUse blocks dangerous patterns
3. **Justfile whitelist** — only curated commands available
4. **Git checkpoints** — `git add -A && git commit -m "checkpoint"` before each session
5. **Loop detection** — hash-based circuit breaker prevents runaway retries

---

## 16. App Store compliance

### The March 2026 crackdown

Apple pulled or blocked updates for multiple vibe coding platforms. Anything was removed March 30, 2026. Replit had updates blocked mid-March. Vibecode was blocked until it removed Apple device generation. App Store submissions jumped 84% in one quarter; Apple's review times stretched from 24–48 hours to 7–30 days. **Generating apps that pass review is now a first-class concern, not an afterthought.**

### Five guidelines that kill AI-generated apps

**4.3 Spam/Duplicate** — highest risk. Apple detects duplicate code structures across mass-generated apps. Each generated app needs genuinely unique binary structure, UI layout, and functionality.

**4.2 Minimum Functionality** — #1 reason AI apps fail. "Why does this need to be an app instead of a bookmark?" Include features that cannot be replicated in a mobile browser.

**2.5.2 Code Execution** — the guideline Apple used against vibe coding platforms. Apps must be self-contained. OTA JS updates allowed (Expo EAS Update) but must not change primary purpose.

**5.1.2(i) Third-Party AI Data Sharing** (added November 13, 2025) — apps using external AI must name the provider, disclose data shared, obtain explicit opt-in consent before first transmission, and explain purpose. Apple compares onboarding, privacy policy, and App Privacy answers line-by-line.

**Privacy Manifest** (`PrivacyInfo.xcprivacy`) — required. Common reason codes for React Native/Expo: `NSPrivacyAccessedAPICategoryFileTimestamp` (C617.1), `NSPrivacyAccessedAPICategorySystemBootTime` (35F9.1), `NSPrivacyAccessedAPICategoryDiskSpace` (E174.1), `NSPrivacyAccessedAPICategoryUserDefaults` (CA92.1).

### What each agent must do

**Analyst** gathers upfront: data collection, third-party AI usage, age rating, regulated industry status, privacy policy URL, terms URL, support URL.

**Architect** includes in architecture.yaml:

```yaml
compliance:
  privacy_manifest:
    accessed_api_types:
      - type: NSPrivacyAccessedAPICategoryFileTimestamp
        reasons: ["C617.1"]
      - type: NSPrivacyAccessedAPICategorySystemBootTime
        reasons: ["35F9.1"]
      - type: NSPrivacyAccessedAPICategoryDiskSpace
        reasons: ["E174.1"]
      - type: NSPrivacyAccessedAPICategoryUserDefaults
        reasons: ["CA92.1"]
    collected_data_types: []  # From Analyst output
  
  ai_consent_modal:
    required: true
    provider: "Anthropic Claude"
    data_types: ["user text", "app preferences"]
    purpose: "Generating personalized recommendations"
    
  required_native_features:
    - push_notifications
    - offline_support
    - haptic_feedback
    - native_navigation
    
  account_management:
    account_deletion: true
    apple_sign_in_revocation: true
    
  required_assets:
    icon: "./assets/icon.png"
    splash: "./assets/splash.png"
    adaptive_icon: "./assets/adaptive-icon.png"
```

**Builders produce**:
- Custom icon 1024×1024 PNG no alpha (iOS), adaptive icon (Android), custom branded splash
- Realistic content everywhere — no Lorem ipsum, no sample data
- Platform-specific features: native tab bar, haptic feedback, push notifications, offline handling
- Fully configured app.json with unique bundleIdentifier, specific permission descriptions, deep linking
- Store listing: unique name, accurate description, screenshots of actual functionality

**Reviewer verifies before submission**:
- `npx expo-doctor` passes
- Privacy manifest includes aggregated reasons from all dependencies
- All permission descriptions are specific ("We use your location to show nearby gyms" not "This app uses your location")
- Zero placeholder text (grep for "Lorem", "placeholder", "TODO", "sample", "test")
- AI consent modal appears before first data transmission
- Account deletion works; Sign in with Apple token revocation implemented
- "Restore Purchases" button if subscriptions
- App Privacy labels match actual data collection
- Backend is live and accessible
- Demo credentials prepared for App Review Notes

### Review Notes template

```
Thank you for reviewing [App Name].

[One-sentence description of purpose and unique value]

AI Usage:
- This app uses [provider] for [specific purpose]
- User data shared: [data types]
- Consent obtained before first use via [consent flow description]
- AI outputs are moderated via [moderation strategy]

Demo Account:
- Email: review@example.com
- Password: [secure password]

Key Features to Test:
1. [Feature 1] — [navigation path]
2. [Feature 2] — [navigation path]
3. [Feature 3] — [navigation path]

Privacy: All data practices match our App Privacy labels
and privacy policy at [URL].
```

---

# Part 5 — Stack and Delivery

---

## 17. React/React Native stack

Every piece generates well with AI agents: convention-based routing (file = route), copy-paste components (no complex deps), shared styling vocabulary (same Tailwind classes everywhere).

| Layer | Technology | Why |
|---|---|---|
| Web portals | Next.js 15 App Router | File-based routing = AI creates route by creating file |
| Mobile | Expo SDK 52+ + Expo Router | Auto-detects monorepos, managed native modules |
| Styling (web) | Tailwind CSS 4 + shadcn/ui | Utility classes, copy-paste components |
| Styling (mobile) | NativeWind 4 + React Native Reusables | Same className syntax as web |
| API | tRPC 11 + Zod | End-to-end type safety without codegen |
| Database | Prisma 6 + PostgreSQL | Generated types from schema |
| Auth | Clerk or Supabase Auth | Cross-platform SDKs |
| State | Zustand + TanStack Query | Minimal boilerplate |
| Forms | React Hook Form + Zod resolvers | Shared validation via @repo/types |
| Monorepo | Turborepo + pnpm | Simple config, parallel builds |

### Turborepo layout

`apps/` = target applications, `packages/` = shared code. Turborepo's `dependsOn: ["^build"]` ensures packages build before consuming apps.

```json
{
  "$schema": "https://turborepo.com/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": [".next/**", "dist/**"] },
    "dev": { "persistent": true, "cache": false },
    "lint": { "dependsOn": ["^lint"] },
    "typecheck": { "dependsOn": ["^typecheck"] },
    "test": { "dependsOn": ["^build"] }
  }
}
```

Turborepo wins over Nx for AI-generated code: 20 lines of config vs 200+, native Vercel integration, less error-prone generated files.

### Shared code strategy

Five packages eliminate duplication:

- **`@repo/types`** — Zod schemas and TS types. Single source of truth for data shape.
- **`@repo/tokens`** — Design tokens as Tailwind preset. Used by both Tailwind (web) and NativeWind (mobile).
- **`@repo/ui`** — Shared components via React Native Web. Platform variants via `.web.tsx` / `.native.tsx`.
- **`@repo/api-client`** — tRPC client + shared query hooks.
- **`@repo/utils`** — Pure business logic.

### Component library

**shadcn/ui** for web, **React Native Reusables** for mobile. Both follow copy-paste-into-your-project, perfect for AI generation. Platform variants via file extension: `Button.tsx` (web), `Button.native.tsx` (mobile). Metro and webpack resolve automatically. Clean imports: `import { Button } from '@repo/ui'`.

### Parallel build

Turborepo builds all three targets in parallel automatically. Orchestrator dispatches three builder subagents concurrently after shared packages are generated.

---

## 18. Testing strategy

### Dual approach

**Vitest** for web code and shared packages (5–28× faster than Jest, native TS/ESM). **Jest via `jest-expo`** for mobile (RN ecosystem mandates Jest). Component tests: `@testing-library/react` (web), `@testing-library/react-native` (mobile).

### E2E

**Playwright** for web (cross-browser, auto-waiting, parallel). **Maestro** for mobile — YAML tests are simpler to generate, no app code modifications, <1% flakiness:

```yaml
appId: com.myapp.mobile
---
- launchApp
- tapOn: "Sign In"
- inputText:
    id: "email-input"
    text: "test@example.com"
- tapOn: "Continue"
- assertVisible: "Welcome"
```

### Self-validation at every layer

- Builder agents run `pnpm typecheck` and `pnpm lint` after generating code
- Tester agent runs the tests it generates to confirm they pass
- Reviewer agent checks generated code against architecture spec
- Git agent verifies branch names match conventional commit patterns

Max 3 iterations on quality failures, then escalate to human review with the best attempt and specific failure notes.

---

## 19. Prompt engineering for agents

### Universal template

```
ROLE: You are [specific role] with expertise in [domain].

CONTEXT: The project is [brief description]. Architecture spec is at
.claude/architecture.yaml. Requirements are at docs/requirements.md.

INPUTS (file references):
- Architecture spec: .claude/architecture.yaml (focus on [section])
- Design tokens: packages/tokens/src/index.ts
- Task assignment: docs/tasks.yaml#[task-id]

TASK: [Single clear imperative sentence]

OUTPUT CONTRACT:
- Create files at: [specific paths]
- Each file must: [validation criteria]
- Return: [summary format]

CONSTRAINTS:
- Never modify files outside [boundary]
- Use @repo/ui components before creating new ones
- All code must pass `pnpm typecheck`

SUCCESS CRITERIA:
- [ ] All specified files created
- [ ] TypeScript compiles without errors
- [ ] Components use design tokens from @repo/tokens
```

### Why long prompts fail

Prompts exceeding ~4K tokens of instructions suffer from lost-in-the-middle (middle receives less attention), increase cost per request, create instruction interference, and are harder to maintain. The file-reference pattern solves this — pass paths, not content.

---

## 20. Self-validation and quality gates

### Generator-verifier pattern

Anthropic's recommended quality pattern: one agent generates, another verifies against **explicit criteria** (not "check if it's good"). Max 3 rounds with fallback to human review. Without explicit criteria, the verifier becomes theater.

### Hook-enforced quality

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [
        {
          "type": "command",
          "command": "npx prettier --write \"$CLAUDE_TOOL_INPUT_FILE_PATH\" 2>/dev/null || true"
        },
        {
          "type": "command",
          "command": "npx eslint --fix \"$CLAUDE_TOOL_INPUT_FILE_PATH\" 2>/dev/null || true"
        }
      ]
    }]
  }
}
```

---

## 21. Self-learning loops

### Capturing lessons during runs

The Lessons Agent monitors the entire pipeline. When a builder hits an error requiring multiple attempts, when the reviewer finds a recurring issue, when a plan archives with surprising lessons — it records them.

Three scopes:
- **Global** (`~/.claude/CLAUDE.md`) — applies across all projects
- **Project** (`./CLAUDE.md` or `docs/lessons.md`) — project-specific
- **Agent** (`.claude/agent-memory/<name>/MEMORY.md`) — agent-specific refinements

### Meta-agent self-improvement

The Agent Expert detects repeating manual patterns and generates new skills or agents:

1. Detect repeating manual pattern
2. Analyze requirements (inputs, steps, outputs)
3. Author new SKILL.md or agent definition
4. Validate on minimal test case
5. Deposit in appropriate library
6. System is now better at this task forever

### Versioning

Treat agent and skill files as code. Commit to version control. Semantic versioning in SKILL.md description. Keep previous versions in `_archive/` until new version is validated in production.

---

# Part 6 — Reference

---

## 22. Comparison with alternatives

### The competitive landscape

Seven alternatives warrant comparison:

**LangGraph** — best visualization and debugging (LangSmith), model-agnostic, 400+ production deployments. But **no built-in coding tools** — you build file operations, terminal execution, git integration yourself. Use if you need model flexibility or complex non-coding workflows.

**CrewAI** — fastest prototyping via YAML, role-based teams, visual editor. But also **no native coding tools**. Better for business process automation than software development.

**Microsoft Agent Framework** — deep Azure integration, enterprise compliance (SOC 2, HIPAA), A2A protocol. Best for .NET/Azure enterprise shops, but public preview and smaller community.

**Devin** — closest to fully autonomous coding agent, sandboxed cloud environment, Devin 2.0 supports parallel fleet. But ~33% of PRs need significant rework, code runs in Cognition's cloud. Best for well-defined junior-level tasks.

**Cursor** — richest visual experience, agent-first IDE, parallel agents via worktrees, multiple models. But **no programmatic SDK or headless mode** — unsuitable as foundation for automated pipelines.

**Aider** — best git integration, free, open-source, model-agnostic. But single-agent only, no subagent spawning or parallelism.

**OpenAI Codex CLI** — closest architectural competitor. Subagents, headless mode, skills, native coding tools, same patterns (AGENTS.md, worktrees, MCP). Locked to OpenAI models.

### Recommendation: stay with Claude Code

For multi-agent app generation, Claude Code uniquely combines orchestration primitives (subagents, skills, hooks) with native coding tools (file read/write/edit, Bash, git) in a single programmable SDK. The alternatives provide orchestration without coding (LangGraph, CrewAI) or coding without programmable SDK (Cursor, Aider). Claude Agent SDK's Python and TypeScript bindings enable full automation pipelines via headless mode (`claude -p`), CI/CD integration, programmatic subagent spawning.

Cost mitigation: Haiku for simple subagents (Git Agent), Sonnet for builders, Opus only for Architect and Analyst where reasoning depth matters most. The model config system in Section 7 operationalizes this.

---

## 23. Complete pipeline sequence

End-to-end flow from brief to working application:

```
0. User authors brief.md (via /author-brief or template)
1. User drops brand assets into ./assets/ (optional)
2. User runs orchestrator: `pnpm generate`
3. Orchestrator reads ~/.claude/models.yaml and .claude/models.yaml
4. Orchestrator confirms pipeline estimated cost with user

─── PLANNING PHASE ───
5. /analyze
   ├─ /validate-brief
   ├─ /scan-assets
   ├─ Research external technologies needed
   └─ Produce requirements.md, asset-inventory.json, brief-summary.json
6. [HITL GATE: requirements review]

7. Skills Agent audits required skills, researches and creates missing ones

8. /architect
   ├─ Read requirements + asset-inventory
   ├─ Produce architecture.yaml (Architecture-as-Code)
   ├─ Produce project-specific .mcp.json
   └─ Note compliance requirements for reviewer
9. /pm (Project Manager)
   └─ Produce tasks.yaml

─── DESIGN PHASE ───
10. /mockups [count=N for initial review]
    ├─ Use wireframes as blueprints where present
    ├─ Apply user brand assets
    └─ Produce representative HTML mockups
11. [HITL GATE: mockup style approval]

12. /stylesheet
    ├─ Full asset inventory download
    ├─ Extract design system from approved mockups
    └─ Generate packages/tokens/ + packages/ui/primitives/
13. [HITL GATE: design system approval]

14. /screens
    ├─ Generate all remaining screens using approved style
    ├─ Batch in groups of 20-40 with checkpoint contexts
    └─ Invoke /user-flows-generator
15. [HITL GATE: user flows sign-off — THE FINAL GATE]

─── BUILD PHASE ───
16. /build-backend
    └─ Generate apps/api/, packages/types/, packages/api-client/
17. /build-frontend (parallel):
    ├─ Web Frontend Builder → apps/web/ and apps/admin/
    └─ Mobile Frontend Builder → apps/mobile/
18. /test
    └─ Generate Vitest, Playwright, Maestro tests
19. /review
    └─ Check architecture adherence, quality, compliance
20. Fix loop: builders fix reviewer issues (max 3 iterations)

─── SHIP PHASE ───
21. /git
    └─ Commit, create PR
22. Lessons Agent captures lessons, updates CLAUDE.md files
23. All contexts archived, plans moved to plans/archive/
```

Each arrow in the pipeline is a potential `/save-context` checkpoint. Each gate is a potential resumption point after a crash.

---

## 24. Headless mode and SDK integration

Claude Code's headless mode enables the entire pipeline programmatically:

```bash
claude -p "/analyze" \
  --allowedTools "Read,Write,Edit,Bash,Grep,Glob" \
  --permission-mode acceptEdits \
  --output-format json \
  --max-turns 40 \
  --model claude-opus-4-6
```

The Agent SDK provides full programmatic control:

```python
from claude_agent_sdk import query, ClaudeAgentOptions

async for message in query(
    prompt="/screens",
    options=ClaudeAgentOptions(
        allowed_tools=["Read", "Write", "Edit", "Bash"],
        permission_mode="acceptEdits",
        system_prompt="You are a senior React developer...",
        max_budget_usd=25.0,
        output_format={"type": "json_schema", "schema": screens_schema}
    ),
):
    if hasattr(message, "result"):
        handle_result(message.result)
```

Session continuity is maintained via `session_id` in JSON output. Each stage of the pipeline is an independent `query()` call with fresh context, with state passed through files (contract outputs in `./pipeline/`).

---

## 25. Areas of evolving practice

Several aspects are still maturing:

**Subagent nesting** — Claude Code subagents currently cannot spawn other subagents. If Anthropic enables this, the orchestrator pattern can become hierarchical (e.g., Frontend Builder spawning component-level subagents). Design for the possibility but don't depend on it.

**Skill validation** — no standardized framework for auto-validating new skills produce correct output. The Skills Agent's validation is bespoke per skill.

**Agent Teams vs. Orchestrator-Subagent** — Anthropic's Agent Teams pattern (persistent teammates accumulating domain knowledge) may prove superior to ephemeral subagents for large codebases. Monitor this.

**Hook reliability** — community reports indicate PreToolUse hooks don't block certain operations in all edge cases. Always test safety hooks manually; use layered defense (hooks + justfile + containerization).

**Auto Mode vs. bypass permissions** — Anthropic shipped Auto Mode (classifier reviewing every action) as a safer alternative to `--dangerously-skip-permissions`. The classifier has 0.4% false positive rate and automates 93% of permission decisions. For production pipelines, increasingly the recommended approach even in containers.

**Context engineering** — the field is moving from "prompt engineering" to "context engineering" — treating the context window as a finite resource with diminishing marginal returns and designing systems that maximize signal-to-noise in every token.

**Structured outputs** — constrained decoding is relatively new; watch for schema complexity limits and failure modes as you scale to the full agent roster.

---

## Appendix A: Quick-reference decision table

| Question | Answer |
|---|---|
| Canonical input format | brief.md (20-section schema-locked markdown) |
| Input companion files | JSON/YAML in `./companion/`, referenced by path |
| User assets location | `./assets/` with subdirs (logos, icons, fonts, images, wireframes, brand-guides) |
| Asset priority | user-supplied > researched > generated |
| Architecture spec | `.claude/architecture.yaml` (Architecture-as-Code) |
| Model config location | `~/.claude/models.yaml` (system) → `.claude/models.yaml` (project) |
| Pipeline stages | `/analyze` → `/mockups` → `/stylesheet` → `/screens` → build → test → review → git |
| Stage implementation | Skills in `.claude/skills/` exposing slash commands |
| Orchestration | External TypeScript orchestrator via Claude Agent SDK |
| HITL gates | After analyze, mockups, stylesheet, screens (= final sign-off) |
| Sign-off artifact | `docs/user-flows.html` with client name + approval JSON |
| Output contracts | Six-layer defense-in-depth, file-based primary |
| Plans | Markdown files in `plans/active/`, `plans/archive/`, `plans/superseded/` |
| Plan operations | `/plan-feature`, `/plan-bug`, `/plan-archive`, `/plan-search`, etc. |
| Loop detection | Hash-based circuit breaker in PreToolUse hook, max 3 identical attempts |
| Context preservation | Chained markdown snapshots in `contexts/` with `previous-context` link |
| Context checkpoints | Every 5 snapshots, or at milestones, or on-demand |
| Crash recovery | SessionStart hook → `/load-context-chain` follows chain to most recent checkpoint |
| Toolshed | Project-level `.mcp.json` + task-level skill specifications |
| Safety | justfile + containerization + PreToolUse hooks + Auto Mode |
| Monorepo | Turborepo + pnpm |
| Stack | Next.js 15, Expo, tRPC + Zod, Prisma, shadcn/ui + RN Reusables, NativeWind, Tailwind |
| Testing | Vitest (web), jest-expo (mobile), Playwright (web E2E), Maestro (mobile E2E) |
| Compliance baseline | Privacy manifest, AI consent modal, native features, custom icon/splash, real content |
| Recommended runtime | Claude Code via external orchestrator (not alternatives) |

---

## Appendix B: CLAUDE.md template for projects

```markdown
# Project CLAUDE.md

## Project Specification
- The canonical specification is `brief.md` at project root
- Read brief.md FIRST before starting any work
- Never ask the user for information that is in the brief
- Reference brief sections, never copy content from them
- For large companion files, read .summary.md first, use jq for targeted extraction
- If brief.md is missing or invalid, STOP and report the error
- Run `/validate-brief` if you suspect issues

## Agent Section Assignments
- Analyst: all sections (validation + requirements extraction)
- Architect: §7, §8, §9 + companion/data-models.yaml
- PM: §12, §19, requirements.md
- UI Designer: §2, §10, §11 + companion/navigation-schema.json
- Security: §13, §14
- DevOps: §8, §16, §18

## User Assets
- Check `./assets/` for user-supplied logos, icons, fonts, wireframes
- User assets ALWAYS override generated or researched assets
- Asset inventory lives at `docs/asset-inventory.json` after /scan-assets
- If wireframe exists for a screen, use it as layout blueprint

## Model Configuration
- System defaults: `~/.claude/models.yaml`
- Project overrides: `.claude/models.yaml`
- Orchestrator resolves model per agent at invocation time
- To bypass: `ANTHROPIC_MODEL=claude-sonnet-4-6`

## Plan/Archive System (NON-NEGOTIABLE)
### Before ANY Work
1. Run `/check-existing-work [keywords]` to search for related plans
2. If related archived plans exist, READ their lessons
3. Create a plan: `/plan-feature`, `/plan-bug`, `/plan-refactor`, or `/plan-investigation`
4. Get plan approved before implementing (status: draft → approved)

### During Work
- Work on your plan's git branch
- Log attempts in plan's Attempt Log section
- If stuck after 3 attempts, run `/plan-investigation`
- If stuck after 5 attempts, STOP and escalate to human
- NEVER try the same fix twice — check the attempt log

### After Work
- Run `/plan-archive` with outcome and lessons learned
- Lessons feed into `.claude/lessons.md` for future agents

### File Ownership
- Check `affected-files` in active plans before editing any file
- If claimed by another plan, coordinate with PM agent

## Context Preservation
- Before starting work, run `/load-context-chain` for prior state
- After significant steps, run `/save-context`
- Checkpoints every 5 snapshots or at milestones
- Never read more than 5 snapshots deep without hitting a checkpoint

## Retry Policy
- Attempt 1-2: Try different approaches
- Attempt 3: Run `/plan-investigation`
- Attempt 4: Try investigation's recommendation
- Attempt 5: STOP and escalate
- NEVER exceed 5 attempts on the same error

## Output Contracts
- UI Designer writes HTML to files, returns only status
- Never include HTML/code in response text
- Self-verify by reading back files before reporting complete
```

---

## Closing note

This blueprint is opinionated by design. Every open decision has been locked with reasoning so you can implement against it without re-litigating. Where you find the reality diverges from the blueprint as you build — and it will — the principles sections tell you what each decision was protecting so you can adapt without losing the underlying property the decision was preserving.

The system you are building is ambitious: one structured brief, dozens of agents working in concert, hundreds of screens generated, three targets shipped. The patterns here — brief as canonical input, Architecture-as-Code, file-reference discipline, plan/archive memory, chained context preservation, slash-command pipeline stages with HITL gates, defense-in-depth output contracts, justfile safety, App Store compliance by design — are all subordinate to a single organizing idea: **make every important thing a file, make every file structured, and make structure enforceable**. Files survive crashes. Structure survives compaction. Enforcement survives agent drift.

Build from Part 1 outward. Don't try to implement everything at once. The pipeline stages, orchestrator, plan system, and context chain should come first. The Toolshed, asset ingestion, user flows sign-off, and App Store compliance layer on top. The self-learning loop comes last — you can't capture lessons until you have runs to capture from.
