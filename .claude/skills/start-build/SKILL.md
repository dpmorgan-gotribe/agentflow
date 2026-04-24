---
name: start-build
description: Drive the full end-to-end pipeline for a project — invokes the orchestrator binary (task 035) which walks Mode A stages (analyze → mockups → stylesheet → screens → visual-review → user-flows → architect → pm) respecting HITL gates, then Mode B (parallel feature-graph build from docs/tasks.yaml). Auto-detects pipeline state so it can be run on fresh scaffolds, half-completed projects, or projects waiting at Mode B.
when_to_use: after `/new-project <name>` has scaffolded a project and the user is ready to let the pipeline run; resumes from wherever the project left off; when the user says "start building", "run the pipeline", "kick off the build"
argument-hint: "<project> [--flags=<csv>] [--dry-run] [--resume-from-stage=<name>] [--resume-feature-graph] [--auto-merge-after-reviewer]"
allowed-tools: Read Bash Grep Glob
model: inherit
---

# /start-build — End-to-end pipeline driver

Single entry point that takes a project from wherever-it-is to shipped code. Delegates all real work to `orchestrator/` (task-035 binary at factory root). This skill adds: project-name validation, state-aware argument assembly, and a consistent transcript.

Pipeline walk the orchestrator executes (ref: `orchestrator/src/stages-array.ts`):

```
Mode A — linear, one stage at a time:
  analyze              → gate 1 (requirements)
  skills-audit(design)
  mockups              → gate 2 (pick-style)
  stylesheet           → gate 3 (design-system)
  screens
  visual-review
  user-flows           → gate 4 (design sign-off)
  architect            → gate 5 (credentials .env file-drop)
  pm --mode=tasks
  skills-audit(build)
  register-mcp(build)
  git-agent-bootstrap

Mode B — feature-graph parallel build:
  for each feat-* in docs/tasks.yaml:
    git-agent opens worktree → agent_sequence runs → git-agent merges
  (concurrent up to maxConcurrentFeatures, respecting depends_on)
```

The orchestrator auto-detects pipeline state (`orchestrator/src/project-state.ts`): each stage counts as complete only if its canonical artifact exists on disk. On invocation it resumes from the first incomplete stage. When every Mode A stage is done, it drops into Mode B.

## Arguments

- `<project>` (required) — project directory name under `projects/`. Must exist.
- `--flags=<csv>` — feature flags passed through to stages (e.g. `nanobanana` for image generation)
- `--dry-run` — report the walk plan + first missing skill, but invoke nothing
- `--resume-from-stage=<name>` — override auto-detection; force resume at a named stage
- `--resume-feature-graph` — skip Mode A entirely, go straight to Mode B (only valid if `docs/tasks.yaml` already exists)
- `--auto-merge-after-reviewer` — skip gate 6 (pr-review) in Mode B; merge as soon as the reviewer agent approves

Rejected inputs:

- Missing `<project>` → error with a list of available projects under `projects/`
- `<project>` names a directory that doesn't exist → error with guidance to run `/new-project <name> --proposal "..."` first
- Both `--resume-from-stage` and `--resume-feature-graph` → error (mutually exclusive)

## Prerequisites

- `projects/<project>/` exists (scaffolded via `/new-project`)
- `orchestrator/` is built (`pnpm --filter orchestrator build` ran at least once) OR invoke via `pnpm --filter orchestrator start` which tsx-runs source directly
- Factory workspace has its `node_modules/` installed (`pnpm install` at factory root)

## Steps

### 1. Parse + validate arguments

Extract `<project>` from `` (first positional). If empty, list projects and exit with a non-zero status:

```
/start-build requires a project name.
Available projects:
  - revolution-pictures
  - hatch-2
  - mindapp
Usage: /start-build <project> [--flags=...] [--dry-run]
```

Collect the flag pass-throughs (`--flags`, `--dry-run`, `--resume-from-stage`, `--resume-feature-graph`, `--auto-merge-after-reviewer`).

Reject mutually exclusive combinations:

- `--resume-from-stage=X --resume-feature-graph` → error: "pick one resume mode, not both"

### 2. Verify project directory

```bash
test -d "projects/<project>"
```

If missing, error:

```
Project directory projects/<project>/ does not exist.
Run this first: /new-project <project> --proposal "<one-line description>"
```

### 3. State detection (informational; orchestrator does the authoritative detection)

Quick grep for the canonical artifacts so the skill's own transcript can tell the user where we are before the orchestrator fires:

| Artifact exists                                | Stage complete  |
| ---------------------------------------------- | --------------- |
| `projects/<p>/docs/brief-summary.json`         | analyze         |
| `projects/<p>/docs/mockups/manifest.json`      | mockups         |
| `projects/<p>/docs/design-system-preview.html` | stylesheet      |
| `projects/<p>/docs/screens-manifest.json`      | screens         |
| `projects/<p>/docs/visual-review/report.json`  | visual-review   |
| `projects/<p>/docs/user-flows-manifest.json`   | user-flows      |
| `projects/<p>/.claude/architecture.yaml`       | architect       |
| `projects/<p>/docs/tasks.yaml`                 | pm              |
| `projects/<p>/docs/signoff-*.json`             | gate 4 resolved |
| `projects/<p>/docs/credentials-confirmed.txt`  | gate 5 resolved |

Emit a one-line status block:

```
Project state: revolution-pictures
  ✓ analyze   ✓ mockups   ✓ stylesheet   ✓ screens   (visual-review skipped)
  ✓ user-flows   ✓ architect   ✓ pm   · gate-5 proceed
  → Mode B (feature-graph) next — 12 features, 46 tasks
```

### 4. Build the orchestrator command

Default form:

```bash
pnpm --filter orchestrator start generate <project> [forwarded flags]
```

Auto-inject `--resume-feature-graph` when ALL of the following hold AND the user didn't override:

- `projects/<p>/docs/tasks.yaml` exists
- `projects/<p>/docs/signoff-*.json` exists with `approved: true`
- `projects/<p>/docs/credentials-confirmed.txt` starts with `proceed` or `defer:`

This lets `/start-build <p>` be the canonical "just go" command at any pipeline position.

### 5. Confirm before running (live mode)

**If `--dry-run` is set, skip this step and go straight to step 6.**

For live runs, because Mode B spends real Claude-Agent-SDK budget, print the plan first and ask for confirmation:

```
About to run:
  pnpm --filter orchestrator start generate revolution-pictures --resume-feature-graph

Budget cap (from ~/.claude/models.yaml): $25.00
Mode B will dispatch 46 tasks across 12 features in parallel worktrees.

Proceed? [y/N]
```

**Exception**: if the user passed `--dry-run`, the orchestrator is free — just run it. If the user passed `--flags=autonomous` (future), skip the prompt.

For the v1 skill, always require confirmation for live Mode B. Bypass flag TBD.

### 6. Execute

Shell out:

```bash
cd <factory-root>
pnpm --filter orchestrator start generate <project> [flags]
```

Stream stdout to the skill transcript unchanged. The orchestrator already emits:

- Starting stage headers
- Per-stage `stage=<name> output=<hash> cost=<usd>`
- Gate-pause messages (e.g. "Gate 2 waiting for pick-style / HITL server at :4241")
- Error messages with retry-ladder status (attempts 1/3, 2/3, etc.)

### 7. Report exit

On exit 0:

```
/start-build revolution-pictures complete.
Committed to projects/revolution-pictures/main (or feature branches merged).
Total spend: $X.XX
```

On non-zero, surface the failing stage + its last retry:

```
/start-build revolution-pictures halted at stage `screens` (retry 3/3 failed).
See projects/revolution-pictures/pipeline/screens/error.log for details.
Resume with: /start-build revolution-pictures --resume-from-stage=screens
```

### 8. Self-verify

- `projects/<project>/` unchanged except for artifacts the orchestrator wrote (`pipeline/`, `docs/`, new `.claude/state/` entries)
- No secrets logged to transcript (orchestrator redacts; skill just proxies)
- Exit code matches orchestrator's exit code verbatim

## Error paths

- **Orchestrator binary missing**: `pnpm --filter orchestrator …` fails with `no such package`. Error: "Factory orchestrator/ package not found — run `pnpm install` at factory root."
- **Orchestrator reports stage budget exceeded**: surface the budget-tracker error + recommend editing `~/.claude/models.yaml` `perPipelineMaxUsd`
- **HITL gate waiting indefinitely**: orchestrator handles the wait loop + its own timeout; this skill just streams the "gate waiting" message so the user knows to open the web UI or drop the file
- **Mid-stage crash**: orchestrator writes `pipeline/<stage>/error.log` + sets retry counter. `/start-build <p>` again picks up at the failed stage (same stage-resume semantics)

## Examples

### Fresh project, full walk

```
/start-build revolution-pictures
→ analyze starts; gate 1 at 5 USD
→ mockups starts; gate 2 web UI at :4241 for pick-style
→ ...
→ Mode B dispatches feat-project-bootstrap
→ exit 0 after all 12 features merge
```

### Dry-run to inspect

```
/start-build revolution-pictures --dry-run
→ prints the stage walk + first missing skill (if any)
→ does not invoke any agent
```

### Resume just Mode B (skip Mode A entirely)

```
/start-build revolution-pictures --resume-feature-graph
→ skips the 12 Mode A stages
→ reads docs/tasks.yaml + opens worktrees
```

### Skip design-gate, rerun architect

```
/start-build revolution-pictures --resume-from-stage=architect
→ re-runs architect through pm (regenerates architecture.yaml + tasks.yaml)
→ then flows into Mode B
```

## Factory ↔ project distinction

`/start-build` is a **factory-level skill**. It lives at `.claude/skills/start-build/SKILL.md` in the factory root; it does NOT get copied into `projects/<name>/.claude/skills/`. Rationale: the skill's job is to invoke the factory's `orchestrator/` binary against a named project — so it must run from factory root where that binary is installed.

If a user wants to invoke build from inside a project dir, they step up one level and run `/start-build <project>` from the factory — or use the raw `pnpm --filter orchestrator start generate <project>` command, which works from any subdirectory thanks to the `factoryRoot` resolution in `orchestrator/src/cli.ts`.

## Integration points

- **Task 035 orchestrator** — the binary this skill wraps. `orchestrator/src/cli.ts` is the entrypoint; `orchestrator/src/cli-runner.ts` handles the resume logic + dry-run mode; `orchestrator/src/project-state.ts` is the state detector.
- **Task 036 HITL gates** — the orchestrator spawns gate servers per stage; this skill is oblivious, just streams the "gate waiting" message.
- **`/new-project`** — precondition. `/start-build` fails loudly if the project hasn't been scaffolded.
- **All pipeline skills** (`/analyze`, `/mockups`, `/stylesheet`, `/screens`, `/visual-review`, `/user-flows-generator`, `/architect`, `/pm`, etc.) — the orchestrator invokes them in sequence. Each skill is invoked via the Agent SDK with the project's CWD as the working directory.
- **`~/.claude/models.yaml`** + `projects/<p>/.claude/models.yaml` — budget caps are read by `orchestrator/src/model-config.ts` before any stage fires.

## Acceptance criteria

- [ ] `.claude/skills/start-build/SKILL.md` exists with the frontmatter above
- [ ] Accepts `<project>` as required positional; rejects with available-projects list when missing
- [ ] Rejects when `projects/<project>/` doesn't exist (points at `/new-project`)
- [ ] Rejects `--resume-from-stage` + `--resume-feature-graph` combination
- [ ] State-detection block reads the same 8 canonical artifacts `project-state.ts` checks
- [ ] Auto-injects `--resume-feature-graph` when tasks.yaml + signoff + credentials-confirmed all exist
- [ ] Confirms before live Mode B run; skips confirmation for `--dry-run`
- [ ] Delegates all real work to `pnpm --filter orchestrator start generate` — no agent invocation inside the skill itself
- [ ] Exit code matches orchestrator's exit code
- [ ] `--dry-run` path exits without invoking any agent
- [ ] Factory-level only (NOT copied by `/new-project` into per-project skill dirs)
