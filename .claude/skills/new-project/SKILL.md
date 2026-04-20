---
name: new-project
description: Bootstrap a new generated-app under projects/<name>/. Clones agentic resources from the factory and seeds brief.md for user authoring.
when_to_use: before any pipeline work on a new project; when user says "create a new project" or "start a new app"
argument-hint: <name> [--force] [--reset-brief] [--proposal "<text>" | --proposal-file <path> | --proposal-url <url>]
allowed-tools: Read Write Bash Glob Grep
---

# /new-project — Scaffold a Generated App

Creates `projects/<name>/` as a self-contained, independently git-tracked
app project. Copies the factory's agentic resources (agents, skills, hooks,
rules, templates) into the project so agents can run against it without
reaching back into the factory.

Factory (this repo) produces projects. Projects consume agentic resources.
That distinction is load-bearing — projects evolve their agents
independently after `/new-project`; factory changes don't auto-propagate.

## Arguments

- `<name>` (required) — project slug, kebab-case, regex `^[a-z][a-z0-9-]{1,48}$`
- `--force` — re-copy agentic resources on an existing project. **Preserves
  all user-authored content by default** (brief, assets, docs, plans, contexts).
  Backs up factory-owned files before overwriting (`.bak-{ISO-timestamp}`).
- `--reset-brief` — nuclear option, requires `--force`. Also overwrites
  `brief.md` back to the template. Use only if user explicitly wants
  brief edits discarded.
- `--proposal "<text>"` — optional. Freeform proposal text. After scaffold,
  invokes `/draft-brief "<text>"` inside the new project to fill in the
  20-section brief.
- `--proposal-file <path>` — same, but read the proposal from a file (path
  resolved against the user's CWD at invocation time — NOT the new project).
- `--proposal-url <url>` — same, but fetch the proposal from a URL.
- The three `--proposal*` flags are mutually exclusive. If none is
  supplied, the scaffold leaves brief.md as the empty template and the
  user runs `/draft-brief` later.

## Steps

### 1. Validate `<name>`

- Regex: `^[a-z][a-z0-9-]{1,48}$` — starts with a letter, kebab-case, 2-49 chars
- Reject these reserved names: `active`, `archive`, `templates`, `test`,
  `shared`, `factory`
- On failure, error with `Project name '<name>' invalid. Must match {regex}
and not be a reserved word.`

### 2. Pre-flight

- If `projects/<name>/` does NOT exist → proceed to step 3 (init mode)
- If it exists AND no `--force` → error and stop:
  ```
  Project 'projects/<name>/' already exists. Use --force to refresh
  agentic resources (preserves user content), or pick a different name.
  ```
- If it exists WITH `--force` → proceed to step 5 (refresh mode, skipping
  init-only steps)
- `--reset-brief` without `--force` → error: "--reset-brief requires --force"

### 3. Create per-project directory tree (INIT MODE ONLY)

```
projects/<name>/
├── brief.md
├── brief.manifest.json
├── companion/
├── schemas/
├── assets/
│   └── README.md
├── .claude/
│   ├── CLAUDE.md
│   ├── settings.json
│   ├── models.yaml
│   ├── agents/
│   ├── skills/
│   ├── hooks/
│   ├── rules/
│   ├── state/
│   └── worktrees/
├── contexts/
│   ├── checkpoints/
│   └── archive/
├── plans/
│   ├── active/
│   ├── archive/
│   ├── superseded/
│   └── templates/
├── docs/
├── pipeline/
├── CLAUDE.md
├── .gitignore
└── justfile
```

Use `mkdir -p` for each directory. Add `.gitkeep` to otherwise-empty dirs
that should be tracked (`contexts/`, `plans/active/`, `docs/`, `companion/`).

### 4. Seed user-authored files (INIT MODE ONLY)

- `projects/<name>/brief.md` ← copy from factory `brief-template.md`
  (task 016), then sed-replace `project-name: "REPLACE_ME"` with the
  actual `<name>` and the current date in `created` / `last-modified`
- `projects/<name>/brief-template.md` ← copy from factory, so `/draft-brief`
  inside the project can find its template locally
- `projects/<name>/brief.manifest.json` ← `{ "version": "1.0", "sections": {} }`
- `projects/<name>/assets/README.md` ← copy from factory `assets/README.md`
- `projects/<name>/schemas/` ← copy factory `schemas/` (needed by
  `/validate-brief` running inside the project)
- `projects/<name>/scripts/validate-brief.mjs` ← copy factory
  `scripts/validate-brief.mjs`. The script auto-resolves paths from CWD
  (bug-fixed 2026-04-18) and reaches factory `node_modules/` via Node's
  upward module resolution when run from `projects/<name>/`. Projects that
  are later moved out of the factory tree should `pnpm install` standalone
- `projects/<name>/plans/templates/` ← copy factory `plans/templates/`
- `projects/<name>/.markdownlint.jsonc` ← copy from factory, so
  markdownlint's MD043 20-section rule applies per-project
- `projects/<name>/.markdownlint-cli2.jsonc` ← copy from factory (scopes
  markdownlint to brief files only)
- `projects/<name>/.prettierignore` ← copy from factory (keeps prettier
  from mangling YAML in `brief.md` frontmatter)
- `projects/<name>/.gitignore` ← see step 6 content
- `projects/<name>/justfile` ← copy factory `justfile`

### 5. Copy agentic resources (BOTH MODES — backup first in refresh mode)

For each of these factory paths, `cp -r` into the matching project path.
In refresh mode, before overwriting an existing file, copy it to
`{path}.bak-{ISO-timestamp}` first:

| Factory source          | Project destination                     |
| ----------------------- | --------------------------------------- |
| `.claude/agents/`       | `projects/<name>/.claude/agents/`       |
| `.claude/skills/`       | `projects/<name>/.claude/skills/`       |
| `.claude/hooks/`        | `projects/<name>/.claude/hooks/`        |
| `.claude/rules/`        | `projects/<name>/.claude/rules/`        |
| `.claude/settings.json` | `projects/<name>/.claude/settings.json` |

**Exception — `.claude/models.yaml` is preserved in refresh mode** (user
may have tuned it). Init mode copies it fresh.

**Exception — `projects/<name>/CLAUDE.md` and `projects/<name>/.claude/CLAUDE.md`**
are re-copied in refresh mode with backup.

Track what was preserved, overwritten, and backed up — the return payload
needs these lists.

### 5b. Scaffold the Turborepo + shared-package skeleton + design-stage MCPs (refactor-003)

**INIT MODE ONLY** for the filesystem scaffold; `--scope=design` MCP registration runs in BOTH modes (idempotent on refresh — no-op when unchanged).

Refactor-003 moved the monorepo scaffold + design-stage MCP registration here from the old tier-7 pipeline position. Design stages write into `packages/ui-kit/` and need design-stage MCP servers (playwright, icons8, unsplash, chrome-devtools) registered before they run. Since these are fixed factory-level decisions (not per-project architectural freedom), they scaffold at project-bootstrap time.

Steps:

1. **Turborepo + pnpm workspace** (task 026 content; run once in init mode):
   - `pnpm init` at project root
   - Write `turbo.json` with factory canonical task-graph config
   - Write `pnpm-workspace.yaml` defining `apps/*` and `packages/*`
   - Write root `tsconfig.json` (base TS config)
2. **Shared-package skeletons** (task 027 content; run once in init mode):
   - Create `packages/ui-kit/`, `packages/types/`, `packages/utils/`, `packages/api-client/`, `packages/orchestrator-contracts/` each with minimal `package.json` (name + version `0.0.0`) and README
   - `packages/ui-kit/` gets placeholder directories for `tokens/`, `primitives/`, `patterns/`, `layouts/`, `stories/`
   - `packages/ui-kit/CONTRACT.md` — copied from factory template at `.claude/templates/ui-kit-contract.md` with real content (not a placeholder). Task 022b owns that template; it's project-invariant.
3. **Design-stage MCP defaults** (refactor-003 mechanic):
   - Copy factory `mcp-defaults-design.json` into project root
   - Invoke `/register-mcp-servers --scope=design --input=mcp-defaults-design.json` (task 041 contract). Safe to re-run — idempotent.
   - `--scope=design` registers: `playwright`, `icons8`, `unsplash`, `chrome-devtools`, and (when `--flags=nanobanana` is active for the run) `image-generator`. Populates `.mcp.json` and the `ui-designer` + `html-verifier` agent frontmatters' `mcp_servers` arrays.

Refresh mode (`--force`) re-invokes only step 3 (MCP registration); steps 1-2 preserve the existing monorepo state.

Add to `filesCopied` tracker: `turbo.json`, `pnpm-workspace.yaml`, `tsconfig.json`, root `package.json`, `packages/ui-kit/{package.json, CONTRACT.md, README.md}`, `packages/{types,utils,api-client,orchestrator-contracts}/{package.json,README.md}`, `mcp-defaults-design.json`, `.mcp.json`.

### 6. Write project-level files (INIT MODE ONLY)

**`projects/<name>/CLAUDE.md`** (root) — short file referencing factory
patterns, project-specific paths. Include the Brief Protocol section from
factory CLAUDE.md. Reference `brief.md` at project root as the canonical
spec.

**`projects/<name>/.claude/CLAUDE.md`** — nested CLAUDE.md that gives
agent-specific guidance for this project (inherits from factory).

**`projects/<name>/.gitignore`**:

```
.claude/state/
.claude/worktrees/
pipeline/
node_modules/
.env
.env.*
!.env.example
*.pem
*.key
credentials.json
*.p12
*.pfx
*.keystore
*.jks
.DS_Store
Thumbs.db
```

### 7. If a `--proposal*` flag was supplied, invoke `/draft-brief`

Run BEFORE git init so the initial commit captures the drafted brief, not
the empty template:

- Exactly-one check: if more than one of `--proposal`, `--proposal-file`,
  `--proposal-url` is present, error: "Only one of --proposal,
  --proposal-file, --proposal-url may be supplied."
- `cd projects/<name>/` first (so `/draft-brief` resolves its own factory
  paths relative to the project).
- Compose the draft-brief invocation:
  - `--proposal "<text>"` → `/draft-brief "<text>"`
  - `--proposal-file <path>` → resolve `<path>` against the ORIGINAL CWD
    (pre-cd) to an absolute path, then `/draft-brief <abs-path>`
  - `--proposal-url <url>` → `/draft-brief <url>`
- Capture draft-brief's report verbatim for the return payload under
  `draftResult`. If draft-brief fails (non-zero or missing deps), include
  its error under `draftResult.error` and continue — the scaffold itself
  is still valid, user can re-run `/draft-brief` after fixing.
- Skip this step entirely in refresh mode (`--force`) — `--proposal*`
  flags with `--force` are accepted but route through `/draft-brief`'s
  normal preserve-or-overwrite logic, not re-scaffold.

### 8. Initialize git (INIT MODE ONLY — SKIP IN REFRESH)

- `cd projects/<name> && git init`
- `git add -A && git commit -m "chore: initialize project <name> from factory"`
  (or `"chore: initialize project <name> from factory with drafted brief"`
  if a proposal was supplied)
- Do NOT re-init or re-commit in refresh mode — user's git state is preserved

### 9. Self-verify

Read back at least:

- `projects/<name>/brief.md` — first line is `---` (frontmatter fence)
- `projects/<name>/.claude/CLAUDE.md` — file exists and non-empty
- One file from each of `.claude/{agents,skills,hooks,rules}/` — confirms
  the copy worked
- `projects/<name>/.git/HEAD` — confirms git was initialized (init mode)

If any check fails, return `{ success: false, reason: "..." }` WITHOUT
rolling back — partial state is easier to debug than an invisible cleanup.

### 10. Return structured JSON

```json
{
  "success": true,
  "mode": "init" | "refresh",
  "projectPath": "projects/<name>",
  "filesCopied": {
    "agents": N,
    "skills": N,
    "hooks": N,
    "rules": N,
    "templates": N,
    "schemas": N
  },
  "preserved": ["projects/<name>/brief.md", "projects/<name>/assets/", "..."],
  "overwritten": ["projects/<name>/.claude/agents/analyst.md", "..."],
  "backups": ["projects/<name>/.claude/agents/analyst.md.bak-2026-04-18T00-00-00Z", "..."],
  "draftResult": null,
  "nextStep": "Author brief.md at projects/<name>/brief.md, then run /validate-brief."
}
```

When a `--proposal*` flag triggers `/draft-brief`, `draftResult` is:

```json
"draftResult": {
  "success": true,
  "filledSections": [1, 3, 6, 11, 12],
  "inferredSections": [4, 5, 7, 8, 15],
  "todoSections": [9, 13, 14, 16, 17, 18, 19, 20],
  "frontmatterPrefilled": true,
  "validationPassed": true,
  "validationErrors": []
}
```

In init mode, `preserved` and `overwritten` and `backups` are empty arrays.
In refresh mode with `--reset-brief`, `overwritten` includes `brief.md`.

## Overwrite Policy Matrix

| File / dir                                                         | No `--force` | `--force` (preserve default)         | `--force --reset-brief`    |
| ------------------------------------------------------------------ | ------------ | ------------------------------------ | -------------------------- |
| `brief.md`                                                         | abort        | preserved                            | overwritten (backup saved) |
| `assets/`, `companion/`, `docs/`, `plans/`, `contexts/`            | abort        | preserved                            | preserved                  |
| `.git/`                                                            | abort        | preserved (no reinit)                | preserved                  |
| `.claude/{agents,skills,hooks,rules}/`                             | abort        | re-copied (backups of changed files) | re-copied                  |
| `.claude/settings.json`                                            | abort        | re-copied (backup saved)             | re-copied                  |
| `.claude/models.yaml`                                              | abort        | preserved (user may have tuned)      | preserved                  |
| `.claude/CLAUDE.md`, project `CLAUDE.md`, `.gitignore`, `justfile` | abort        | re-copied (backup saved)             | re-copied                  |

## Edge Cases

- **User runs in a non-factory directory**: check for `.claude/agents/`
  and `brief-template.md` at CWD. If absent, error: "This doesn't look
  like the factory repo. Run from the agentflow-phase2 root."
- **`projects/<name>/` exists but `.git/` is missing**: treat as
  inconsistent state, refuse to `--force`. Ask user to either delete the
  directory or manually `git init` it first.
- **Factory `brief-template.md` missing** (task 016 not shipped): error
  clearly: "brief-template.md not found at factory root — task 016 must
  ship before /new-project can seed briefs." Do not create a broken project.
- **Backup file already exists for the same timestamp** (shouldn't happen
  in normal operation): append a disambiguator: `.bak-{timestamp}-{N}`
- **Name collision with reserved words** (`templates`, etc.): error
  before touching filesystem.
- **Git init fails** (e.g., git not on PATH, or already-inited parent):
  return `{ success: false }` with the git error. Do NOT leave partial
  `.claude/` copies behind if this is the only failure — but also don't
  recursively delete without confirmation. Let the user clean up and retry.
