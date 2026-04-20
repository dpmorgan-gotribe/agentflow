---
task-id: "041"
title: "MCP Server Registration & .mcp.json Generation"
status: pending
priority: P2
tier: 7 — Build Pipeline
depends-on: ["020"]
estimated-scope: small
---

# 041: MCP Server Registration & .mcp.json Generation

## What This Task Produces

A skill at `.claude/skills/register-mcp-servers/SKILL.md` that reads `architecture.yaml` and produces the project's `.mcp.json`, plus updates every agent's YAML frontmatter `mcp_servers` list per the Toolshed scoping pattern.

This is the operational counterpart to task 020 (Architect), which specifies the `tooling` section of `architecture.yaml`. 020 decides WHAT MCP servers the project needs; this task PROVISIONS them.

## Why This Exists

Blueprint §14 L2191-2206 specifies _"Architect generates project-specific `.mcp.json` — only the MCP servers this project needs"_ but task 020 only documents the decision-making, not the file-generation mechanics. Blueprint §14 L2238-2249 further requires per-agent scoping — _"Each subagent's YAML frontmatter lists only the MCP servers relevant to its role"_ — which needs to be derived from `scoped_to` fields in architecture.yaml.

Without this task:

- `.mcp.json` generation is hand-waved across 020 and 035 with no owner
- Per-agent MCP scoping is never actually written into agent frontmatter
- Adding an MCP server mid-project requires manually editing N agent files
- **Feature-flagged servers (e.g., `image-generator` under `--nanobanana`) have nowhere to be filtered**; the `--nanobanana` opt-in in refactor-001 depends on this skill honoring `feature_flag` at registration time

## Scope

### SKILL.md

```yaml
---
name: register-mcp-servers
description: Generate .mcp.json and update agent MCP scoping from architecture.yaml. Run after /architect and any time architecture.yaml tooling section changes.
when_to_use: after /architect produces architecture.yaml; after mid-project MCP additions
allowed-tools: Read Write Bash Grep Glob
---
```

### Inputs

- `.claude/architecture.yaml` — especially the `tooling.mcp_servers` section (structure defined in task 020)
- `.claude/agents/*.md` — frontmatter of each agent gets updated in place
- `.env.example` (if exists) — checked for referenced env vars; missing vars added as empty placeholders
- **Active pipeline flag set** — passed in from the orchestrator (task 035) as a CLI argument or env var (e.g., `--flags=nanobanana` or `CLAUDE_PIPELINE_FLAGS=nanobanana`). Used to filter servers by `feature_flag`.

### Steps

1. **Read architecture.yaml**; abort with clear error if `tooling.mcp_servers` is missing or malformed
2. **Validate each server entry** has `name`, `purpose`, `scoped_to[]`, `config{}`. Optional: `feature_flag`, `budget`, `env_refs`.
3. **Filter by `feature_flag`**: for each server that declares a `feature_flag`, if that flag is NOT in the active pipeline flag set, mark the server as `inactive-for-run`. Inactive servers are:
   - Omitted from `.mcp.json`
   - Removed from every agent's `mcp_servers` frontmatter (even if the agent is listed in `scoped_to`)
   - Logged in the return JSON under `featureFlagOmissions`
   - Env vars for inactive servers are still documented in `.env.example` (so the user can enable the flag later without re-running 020)
4. **Generate `.mcp.json`** at project root — one entry per ACTIVE server in `mcp_servers`, using each entry's `config` block. Example with `--flags=nanobanana` ACTIVE (so `image-generator` is included):
   ```json
   {
     "mcpServers": {
       "unsplash": {
         "command": "npx",
         "args": ["@drumnation/unsplash-smart-mcp-server"],
         "env": { "UNSPLASH_ACCESS_KEY": "${UNSPLASH_ACCESS_KEY}" }
       },
       "icons8": {
         "url": "https://mcp.icons8.com/mcp/",
         "transport": "sse"
       },
       "image-generator": {
         "command": "npx",
         "args": ["@google/generative-ai-mcp"],
         "env": { "GOOGLE_API_KEY": "${GOOGLE_API_KEY}" }
       },
       "playwright": {
         "command": "npx",
         "args": ["@playwright/mcp@latest"]
       }
     }
   }
   ```
   Without `--flags=nanobanana`, the `image-generator` entry would be omitted entirely (see step 3 filter). Support both stdio (`command`+`args`+`env`) and SSE (`url`+`transport`) transports. Env values MUST use `${VAR}` interpolation, not literal keys.
5. **Update agent frontmatter** for every `.claude/agents/*.md`:
   - For each ACTIVE server, inspect `scoped_to[]`
   - For agents NOT listed, ensure their YAML `mcp_servers` does NOT contain this server (remove if present)
   - For agents IN the list, add the server name to their `mcp_servers` array if missing
   - For inactive (feature-flagged-off) servers: remove from all agent frontmatter regardless of `scoped_to`
   - Preserve existing frontmatter fields; surgical edit only
6. **Sync `.env.example`** — for every `env_refs` entry in architecture.yaml's server configs (active OR inactive), add `VARNAME=` lines if missing. Never overwrite existing non-empty values.
7. **Report** — return JSON summarizing changes:

   ```json
   {
     "success": true,
     "mcpJsonPath": ".mcp.json",
     "activeFlags": ["nanobanana"],
     "serversRegistered": [
       "unsplash",
       "icons8",
       "image-generator",
       "playwright"
     ],
     "featureFlagOmissions": [],
     "agentsUpdated": [
       {
         "agent": "ui-designer",
         "added": ["icons8", "unsplash", "image-generator", "playwright"],
         "removed": []
       },
       {
         "agent": "web-frontend-builder",
         "added": ["unsplash"],
         "removed": []
       },
       { "agent": "git", "added": [], "removed": ["unsplash"] }
     ],
     "envVarsAdded": ["UNSPLASH_ACCESS_KEY", "GOOGLE_API_KEY"]
   }
   ```

   When the pipeline runs without `--nanobanana`, the same architecture.yaml would produce:

   ```json
   {
     "activeFlags": [],
     "serversRegistered": ["unsplash", "icons8", "playwright"],
     "featureFlagOmissions": [
       {
         "server": "image-generator",
         "flag": "nanobanana",
         "reason": "flag not active for this run"
       }
     ],
     "agentsUpdated": [
       { "agent": "ui-designer", "added": [], "removed": ["image-generator"] }
     ],
     "envVarsAdded": []
   }
   ```

### Mid-project re-runs

This skill is idempotent. Running it again with no architecture.yaml changes must produce a no-op (zero agents updated, same `.mcp.json` bytes). Orchestrator (task 035) invokes it:

- Once after `/architect` during initial pipeline
- Automatically when `architecture.yaml` mtime changes and a stage about to run depends on MCP

### Pre-flight validation

Before writing:

- Every `scoped_to` agent must exist at `.claude/agents/<name>.md`. If not, abort with the missing agent listed.
- Every referenced env var in `.env.example` must be documented (name-only is fine; values are user-supplied)
- `.mcp.json` must be valid JSON after generation (re-parse as a self-check)

### Ready-to-use MCP server catalog

Ship a small reference doc at `.claude/skills/register-mcp-servers/mcp-catalog.md` enumerating §14 L2219-2229's ready-to-use servers with canonical `config` blocks the Architect can paste into architecture.yaml. Servers annotated `feature_flag: <flag>` are gated by the pipeline flag set (step 3 above):

- `icons8` (SSE, no auth required for basic tier) — scope: [ui-designer]
- `unsplash` (stdio, `UNSPLASH_ACCESS_KEY`) — scope: [ui-designer, web-frontend-builder]
- `pexels` (stdio, `PEXELS_API_KEY`) — alternative to unsplash
- `dalle` (stdio, `OPENAI_API_KEY`, **feature_flag: nanobanana**) — image generation (alternative)
- `gemini-nano-banana` (stdio, `GOOGLE_API_KEY`, **feature_flag: nanobanana**) — image generation via Gemini 2.5/3.x Flash Image; default for `image-generator` role
- `playwright` (stdio, no auth) — required by task 025b (/visual-review) for multi-viewport screenshots; scope: [ui-designer, html-verifier]
- `chrome-devtools` (stdio, no auth) — Lighthouse + DOM/CSS inspection during /visual-review; scope: [ui-designer]
- `figma` (SSE, `FIGMA_ACCESS_TOKEN`) — scope: [ui-designer]; optional design-system read/write for human handoff

Canonical `config` blocks (paste-ready for architecture.yaml):

```yaml
# gemini-nano-banana — image generation, flag-gated
- name: image-generator
  purpose: Hero images, onboarding/empty-state illustrations, logos
  scoped_to: [ui-designer]
  feature_flag: nanobanana
  budget: { max_calls: 50, max_cost_usd: 10 }
  config:
    command: npx
    args: ["@google/generative-ai-mcp"]
    env_refs: [GOOGLE_API_KEY]

# playwright — visual review screenshots
- name: playwright
  purpose: Multi-viewport screenshots for /visual-review
  scoped_to: [ui-designer, html-verifier]
  config:
    command: npx
    args: ["@playwright/mcp@latest"]

# chrome-devtools — Lighthouse + DOM inspection
- name: chrome-devtools
  purpose: Lighthouse / a11y / CSS inspection during /visual-review
  scoped_to: [ui-designer]
  config:
    command: npx
    args: ["chrome-devtools-mcp@latest"]
```

Architects and Skills Agent can reference this catalog when populating `tooling.mcp_servers`, avoiding re-researching MCP configs per project.

## Acceptance Criteria

- [ ] `.claude/skills/register-mcp-servers/SKILL.md` exists with the frontmatter above
- [ ] Skill validates architecture.yaml structure before writing anything
- [ ] Generated `.mcp.json` supports both stdio and SSE transports
- [ ] Env vars interpolated as `${VAR}`, never hardcoded
- [ ] Every agent's `mcp_servers` frontmatter synced from `scoped_to` — both additions AND removals
- [ ] `.env.example` gets missing var placeholders added (including env_refs for feature-flagged-off servers, so enabling the flag later does not require re-running 020)
- [ ] Re-running the skill with unchanged architecture.yaml AND unchanged flag set produces byte-identical `.mcp.json` and zero agent changes
- [ ] Running with a different flag set (e.g., toggling `nanobanana`) deterministically adds/removes the gated servers from `.mcp.json` and agent frontmatter
- [ ] Aborts clearly when a `scoped_to` agent doesn't exist
- [ ] `mcp-catalog.md` documents at least: icons8, unsplash, pexels, dalle, gemini-nano-banana, playwright, chrome-devtools, figma (8 entries)
- [ ] `mcp-catalog.md` marks `image-generator` / `gemini-nano-banana` / `dalle` with `feature_flag: nanobanana`
- [ ] `mcp-catalog.md` includes paste-ready `config` blocks for `gemini-nano-banana`, `playwright`, `chrome-devtools`
- [ ] Task 020's `/architect` skill invokes this skill (or delegates to it explicitly)
- [ ] Task 035's orchestrator wires this into the pipeline after `/architect` and passes the active pipeline flag set
- [ ] Return JSON includes `activeFlags` and `featureFlagOmissions` so the orchestrator can log which servers were gated off

## Human Verification

1. Author an `architecture.yaml` with three MCP servers scoped to different agents; run the skill; inspect `.mcp.json` and every agent file. Are scopes correct?
2. Re-run without changes. Is it a true no-op (same JSON bytes, no agent edits)?
3. Edit architecture.yaml to remove a server; re-run. Does it disappear from `.mcp.json` AND from the previously-scoped agents' frontmatter?
4. Reference a missing agent in `scoped_to`. Does the skill abort with a clear message?
5. Run once with `--flags=nanobanana`, once without. Does `image-generator` appear/disappear from `.mcp.json` and from ui-designer's frontmatter as expected? Does `.env.example` retain `GOOGLE_API_KEY=` either way?
