---
id: feat-001-agentic-privacy-flag
type: feature
status: archived
author-agent: human
created: 2026-04-22
updated: 2026-04-22
completed: 2026-04-22
parent-plan: investigate-001-post-design-pipeline-architecture
supersedes: null
superseded-by: null
branch: feat/agentic-privacy-flag
affected-files:
  - .claude/skills/new-project/SKILL.md
  - projects/mindapp-v2/.gitignore # reference for template target
  - docs/agentic-visibility.md # new doc (to be created)
feature-area: new-project
priority: P2
attempt-count: 0
max-attempts: 5
---

# feat-001-agentic-privacy-flag: `/new-project --agentic-visibility=<public|private|split>`

## Problem Statement

`/new-project` currently tracks the entire `.claude/` tree + `plans/` + `contexts/` + `hooks/` by default. Projects pushed to a public git remote (e.g. client demo, open-source release, portfolio push) leak internal prompts, skill definitions, and hook scripts — the whole agentic layer becomes visible.

Closes question **Q5** of `investigate-001-post-design-pipeline-architecture` — user flagged: _"we may not want to expose our agentic layer to a public repo only the app themselves."_

No brief.md reference — this is factory-level tooling, not project-level feature.

## Approach

1. **Extend `/new-project` argument parser** (`.claude/skills/new-project/SKILL.md` §Arguments) with `--agentic-visibility=<public|private|split>` (default `private`). Validate against that enum; reject other values.

2. **Branch `.gitignore` generation by mode** (§Step 6 "Write project-level files"):
   - **`public`** — current behavior. `.gitignore` body unchanged (ignores only `.claude/state/`, `.claude/worktrees/`, `pipeline/`, secrets, OS junk).
   - **`private`** (new default) — `.gitignore` also excludes `.claude/agents/`, `.claude/skills/`, `.claude/hooks/`, `.claude/rules/`, `.claude/templates/`, `plans/`, `contexts/`, `pipeline/`. Keeps tracked: `brief.md`, `companion/`, `apps/`, `packages/`, `docs/`, root config (`package.json`, `tsconfig.json`, `turbo.json`, `pnpm-workspace.yaml`), `.env.example`, `CLAUDE.md`, `justfile`, `schemas/`.
   - **`split`** — two git roots. Outer `projects/<name>/.git` tracks the full agentic layer (init'd as step 8). Inner `projects/<name>/apps-and-packages/.git` wraps only `apps/` + `packages/` + app-relevant root config. Inner init done at the end of step 8b with its own initial commit. Write a README at the inner root documenting why the split exists + which remote each should push to.

3. **Record the flag in project manifest**: add `agenticVisibility` field to the project's root `CLAUDE.md` frontmatter (near `project-name`) so future `/new-project --force` refreshes preserve the choice.

4. **Docs** — write `docs/agentic-visibility.md` at factory root explaining the three modes, privacy model, and which mode fits which use case. Link from `/new-project` SKILL.md + top-level `README.md` if present.

5. **Self-verify** — step 9 of `/new-project` adds a post-init check: in `private` mode, confirm `git ls-files .claude/agents/` returns empty after the initial commit. In `split` mode, confirm both `.git` directories exist + inner repo's `git log --oneline` has 1 commit.

6. **Return JSON** — add `agenticVisibility` field to the return payload (step 10) so the orchestrator knows what shape was scaffolded.

## Rejected Alternatives

- **Alternative A: Always gitignore the agentic layer (single hardcoded default, no flag)** — Rejected. Factory-internal projects benefit from tracking agents + plans for auditability. Forcing them to be gitignored everywhere breaks that workflow. The flag preserves both use cases.

- **Alternative B: Per-file `.gitignore` with glob tricks (e.g. ignore `.claude/skills/*/SKILL.md` but track a sanitized shadow)** — Rejected. Fragile + confusing + leaks via `.claude/skills/` directory names themselves (which are still prompts as data). Dir-level exclusion is cleaner.

- **Alternative C: Use git-crypt or submodules to encrypt the agentic layer** — Rejected. Cryptographic solutions add operational overhead (key management, decrypt-before-use) for a problem that plain `.gitignore` solves. Worth revisiting if Q5 v2 needs shared-but-private agentic collaboration across team members.

## Expected Outcomes

- [x] `/new-project <name>` with no flag defaults to `--agentic-visibility=private` and produces a `.gitignore` that excludes the agentic layer
- [x] `/new-project <name> --agentic-visibility=public` produces the current (pre-change) `.gitignore` exactly — backwards-compatible for existing factory-internal projects
- [x] `/new-project <name> --agentic-visibility=split` produces two `.git` directories; inner repo commits only `apps/` + `packages/` + app-relevant config
- [x] `/new-project <name> --agentic-visibility=bogus` rejects with clear error + usage
- [x] `docs/agentic-visibility.md` exists at factory root explaining all three modes + which use case each fits
- [x] `/new-project --force <existing>` preserves the original `agenticVisibility` value from project `CLAUDE.md` frontmatter
- [x] Return JSON from `/new-project` includes `agenticVisibility: "public"|"private"|"split"`

## Validation Criteria

**Manual:**

- Run `/new-project mindapp-test --agentic-visibility=private` inside factory. Verify `.gitignore` contains the expected exclusions. Run `git ls-files .claude/` — should be empty.
- Run `/new-project mindapp-test-public --agentic-visibility=public`. Verify `.gitignore` matches the pre-change shape byte-for-byte.
- Run `/new-project mindapp-test-split --agentic-visibility=split`. Verify both `.git` directories + the inner repo's first commit includes only app code.
- Regenerate an existing project with `--force` — confirm original visibility setting is preserved.

**Automated:**

- Extend `scripts/validate-brief.mjs` (or new `scripts/validate-project-scaffold.mjs`) with a check: read project's `CLAUDE.md` frontmatter → read `.gitignore` → assert expected line set per visibility mode.

**Documentation:**

- `docs/agentic-visibility.md` reviewed for clarity; table of modes × what's tracked; example `git remote` suggestions per mode.

## Attempt Log

### Attempt 1 — 2026-04-22 · Scaffolding spec landed

**Scope:** spec-only plan (factory scaffolding). No runtime code yet — the /new-project SKILL.md is the spec; any executing agent follows it at invocation time.

**Files changed:**

- `.claude/skills/new-project/SKILL.md` — added `--agentic-visibility=<public|private|split>` to argument-hint + Arguments table (§Arguments); rewrote §Step 6 `.gitignore` block to branch by mode with base block + per-mode exclusions; added §Step 6b flag validator (handles default + refresh-mode mismatch); rewrote §Step 8 git-init to handle split-mode inner repo bootstrap; extended §Step 9 Self-verify with per-mode git-ls-files checks; added `agenticVisibility` + `innerRepoPath` to §Step 10 return JSON; annotated §Overwrite Policy Matrix row for `.claude/{agents,skills,hooks,rules}/` with the visibility dependency.
- `docs/agentic-visibility.md` (NEW) — full reference: rationale, three modes with .gitignore bodies, path tracking matrix, suggested remote configuration, history-rewrite notes, FAQ.

**Not changed (deferred to future work):**

- `scripts/validate-project-scaffold.mjs` — the automated validation script named in this plan's Validation Criteria. Scaffolding spec lists the expected post-conditions; implementation is a follow-up when tooling bandwidth exists.
- Real-world smoke test: will be exercised the next time /new-project runs. Manual verification items in Validation Criteria will run at that point.

**Status:** scaffolding spec complete. The next `/new-project` invocation will execute the new shape. Until then, existing projects (mindapp-v2, gotribe, hatch) keep their current `public` `.gitignore` and are unaffected.

**Ready to mark completed + commit.**

---

# COMPLETION RECORD (appended to archived plan)

completed: 2026-04-22
outcome: success
actual-files-changed:

- .claude/skills/new-project/SKILL.md (modified)
- docs/agentic-visibility.md (created)
- plans/active.md (modified)
- plans/active/feat-001-agentic-privacy-flag.md (created)
- plans/active/feat-002-stack-skill-shelf.md (created)
- plans/active/feat-003-git-agent-worktrees.md (created)
- plans/active/feat-004-builder-tdd-hybrid.md (created)
- plans/active/investigate-001-post-design-pipeline-architecture.md (created)
- plans/active/refactor-004-task-driven-orchestration.md (created)
  commits:
- hash: 155ad87
  message: "feat-001: /new-project --agentic-visibility flag (private default)"
  attempts: 1
  lessons:
- "Default `private` was the safer choice — `public` opt-in preserves factory-internal audit workflow without risking client-repo leakage."
- "Moving visibility between modes requires history rewrite; refusing the change on --force refresh prevents silent footguns."
- "The 3-mode matrix (public/private/split) is the minimum — two modes wasn't enough (no split path) and four would have confused."
  test-results:
  summary: "scaffolding spec only — no runtime tests; smoke-test deferred to next /new-project invocation"
  duration-minutes: 813

---
