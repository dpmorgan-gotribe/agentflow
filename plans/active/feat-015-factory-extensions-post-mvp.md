---
id: feat-015-factory-extensions-post-mvp
type: feature
status: draft
author-agent: claude-opus-4-7
created: 2026-04-24
updated: 2026-04-24
parent-plan: investigate-002-build-tier-readiness-gap
supersedes: null
superseded-by: null
branch: feat/factory-extensions-post-mvp
affected-files:
  # Phase A — skills-audit auto-authoring mode
  - .claude/skills/skills-audit/SKILL.md
  - .claude/agents/skills-agent.md
  - scripts/verify-stack-skill.mjs # new
  # Phase B — html-verifier agent (Layer 6 CSS/token validator)
  - .claude/agents/html-verifier.md # new
  - .claude/skills/verify-html/SKILL.md # new
  - scripts/verify-html.mjs # new
  # Phase C — lessons-agent (auto plans/archive → docs/lessons.md)
  - .claude/agents/lessons-agent.md # new
  - .claude/skills/lessons/SKILL.md # new
  - .claude/hooks/on-plan-archive.mjs # new — trigger
  # Phase D — register-mcp-servers build-scope + git-agent skill refinements
  - .claude/skills/register-mcp-servers/SKILL.md
  - .claude/skills/git-agent/SKILL.md
  # Phase E — validation + archive
  - docs/extensions-completion-report.md # new
  - docs/build-tier-roadmap.md # append
feature-area: orchestration
priority: P1
attempt-count: 0
max-attempts: 5
---

# feat-015 — Factory extensions (roadmap plans 9-13)

## Problem Statement

`docs/build-tier-roadmap.md` §Extension plans named five follow-on plans that land AFTER MVP exit but represent quality-of-life upgrades every future project benefits from:

- Plan 9 (`feat-010-skills-audit-runtime`) — auto-authoring mode for stack + vendor skills so future projects that pick new stacks don't need hand-authoring
- Plan 10 (`feat-011-register-mcp-servers-runtime`) — build-scope MCP registration mostly no-op today, but the contract + idempotency coverage needs real content
- Plan 11 (`feat-012-html-verifier`) — Layer 6 CSS/token validator catching token-drift + inline-style leaks in screens BEFORE /visual-review's playwright-driven rubric runs (cheaper failure)
- Plan 12 (`feat-013-git-agent-skill-runtime`) — `.claude/skills/git-agent/SKILL.md` exists but the task-035 orchestrator bypasses it today by calling `git` CLI directly; the skill runtime needs alignment so agent-dispatched git-ops share one code path
- Plan 13 (`feat-014-lessons-agent`) — `plans/archive/` has grown to 14+ archived plans; `docs/lessons.md` is aggregated by hand. An agent that watches archive + auto-extracts lessons + selectively pushes high-signal items to `~/.claude/CLAUDE.md` closes the knowledge-capture loop

Each of these is **small on its own but load-bearing when the factory starts scaling beyond one-project-at-a-time**. Without Plan 9, every new stack requires hand-authoring. Without Plan 11, a brief that introduces a new build-stage MCP server silently no-ops. Without Plan 12, visual-review shoulders the token-drift catch alone (slow + expensive per failure). Without Plan 12, git-agent has two code paths (CLI-direct inside orchestrator; skill-dispatched for humans) that can drift. Without Plan 13, lessons decay — agents re-hit solved failures because no one told them the solution.

This plan bundles all five into a single execution pass because they're all short + factory-level + parallelize well. Each has its own testing gate.

Reference: `docs/build-tier-roadmap.md` §Extension plans; `plans/archive/investigate-002-build-tier-readiness-gap.md` §Recommendation §Extension.

## Approach

Five phases, mostly parallelizable after Phase A lands.

### Phase A — `skills-audit --scope=build --auto-author-stack-skills` real content

Goal: when an architect picks a stack-slug not in `.claude/skills/agents/{tier}/{slug}/` (e.g. `backend_framework: go-echo`), skills-audit authors a stub SKILL.md grounded in real vendor docs + the stack-skill template.

1. Extend `.claude/skills/skills-audit/SKILL.md`:
   - `--scope=build --auto-author-stack-skills` flag actually writes new files
   - Reads `.claude/skills/agents/_template/SKILL.md` as the shape skeleton
   - Reads vendor documentation via WebFetch or WebSearch (not real-time — cached per-stack in `docs/stack-research/<slug>.md` if present)
   - Emits SKILL.md with the 7 required sections + trailer comment `<!-- auto-authored 2026-04-24; human-review-recommended -->`
   - Logs to `docs/skills-audit-log.json` so the auto-author trail is auditable

2. Author `.claude/agents/skills-agent.md` if not already shipped in a usable form. Confirms the skill's agent frontmatter is factory-canonical.

3. `scripts/verify-stack-skill.mjs` — post-authoring validator that confirms each new skill has the 7 sections, runs `markdownlint`, greps for token leakage, and (optionally) `tsx --check`s any inline code snippets for syntactic validity.

**Testing**: pick a stack NOT in the current shelf (e.g. `go-echo` or `rust-axum`), invoke `skills-audit --scope=build --auto-author-stack-skills` against a synthetic architecture.yaml declaring that stack. Expect a SKILL.md written + verified + the auto-authored trailer present. Run on 2-3 stacks in CI to surface hallucination patterns.

### Phase B — `html-verifier` agent (Layer 6 CSS/token validator)

Goal: every HTML emitted by `/screens` runs through a fast static check (no Playwright, no rendering) before `/visual-review` burns a ~15¢ rubric pass per screen.

4. Author `.claude/agents/html-verifier.md` — frontmatter + system prompt + allowed-tools: `[Read, Bash, Grep]`. No MCP servers (static analysis only).

5. Author `.claude/skills/verify-html/SKILL.md`:
   - Walks `docs/screens/**/*.html`
   - Checks: zero raw hex colors (unless style's imageryPolicy allows), all font-family values match `assets.md` lane, no `style=""` inline attributes beyond the whitelist, all image paths resolve (relative + picsum seeds), all classes reference kit tokens via CSS custom property (spot-check)
   - Emits per-screen `{status: pass | fail, issues: [...]}` to `docs/html-verifier-report.json`
   - Integrates into `/screens`'s own self-verify step + `/visual-review`'s preflight

6. Hook `scripts/verify-html.mjs` — standalone runner callable from CI + from the skill + from pre-commit.

**Testing**: run against revolution-pictures's 16 screens — all should pass (already validated by visual-review conceptually + anti-slop checks). Then introduce a deliberate regression (inline hex color in one screen) + confirm the verifier catches it.

### Phase C — `lessons-agent` (plans/archive/ watcher)

Goal: when a plan archives, its Lessons Learned section auto-appends to `docs/lessons.md` + high-signal items get proposed for `~/.claude/CLAUDE.md`.

7. Author `.claude/agents/lessons-agent.md` — short system prompt focused on extraction + categorization (DRY-factor recognition across archived plans).

8. Author `.claude/skills/lessons/SKILL.md`:
   - Input: `plans/archive/*.md` changed since last run (tracked in `docs/lessons-state.json` with file mtimes + hashes)
   - Extract ##Lessons Learned sections; de-duplicate against `docs/lessons.md`; propose concatenation
   - Flag "global-signal" lessons (explicit markers in the plan OR recurrence across ≥3 plans) for proposed promotion to `~/.claude/CLAUDE.md` — write to `docs/lessons-promotion-candidates.md` for human review (NOT auto-pushed to global CLAUDE.md; that's a user decision)

9. `.claude/hooks/on-plan-archive.mjs` — triggered by `/plan-archive` skill completion; kicks off lessons-agent with a 5-min debounce (so back-to-back archives batch into one run)

**Testing**: archive a synthetic plan with a distinctive lesson marker; confirm the lesson lands in `docs/lessons.md`. Run the promotion-candidate check; confirm triple-recurrence heuristic fires correctly. Dry-run mode that writes the proposed diff without touching lessons.md, for safety.

### Phase D — register-mcp-servers --scope=build + git-agent skill alignment

Goal: bring the two partially-shipped skills to full parity with their archived specs.

10. `.claude/skills/register-mcp-servers/SKILL.md` — confirm `--scope=build` path actually reads `architecture.yaml.tooling.mcp_servers` + writes `.mcp.json` + syncs agent frontmatter. Add test fixture: architecture.yaml with 2 build-scope MCP servers; skill invocation produces exactly those + preserves design-scope entries; re-run is idempotent.

11. `.claude/skills/git-agent/SKILL.md` — align with the orchestrator's actual usage pattern. Today the orchestrator calls `git` CLI directly for worktree ops; the skill is consumed for human-invoked operations. Make both paths share the same 5-op contract (`bootstrap` / `checkout-feature` / `close-feature` / `resolve-conflict-handoff` / `emergency-abort`) so git-agent invocations from different call sites produce identical audit trails in `docs/git-agent-log.json`.

**Testing**: vitest + manual smoke; each op produces a structured JSON log entry; idempotency of register-mcp-servers verified by diffing the resulting `.mcp.json` across two runs.

### Phase E — validation + archive

12. `docs/extensions-completion-report.md` — short doc recording each phase's test outcomes, any surprises, cumulative cost
13. Append a §Post-MVP Extensions Complete block to `docs/build-tier-roadmap.md` with date + evidence pointers
14. Archive this plan via `/plan-archive`

### Testing at each stage

| Phase | Stage                       | Testing mechanic                                                                                 | Pass criteria                                                                                  |
| ----- | --------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| A     | skills-audit auto-authoring | Dispatch against 2-3 stacks not in shelf; run verify-stack-skill.mjs                             | Each produces valid SKILL.md + passes the 7-section audit; no empty sections                   |
| A     | Stack skill grounding       | Feed output to a web-frontend-builder subagent on a scratch project; produce a usage example     | Example compiles + matches idiomatic vendor usage per docs                                     |
| B     | html-verifier               | Run against revolution-pictures's 16 screens                                                     | 16/16 pass; deliberate regression (1 injected inline hex) caught with clear error              |
| B     | Integration with /screens   | Invoke /screens on scratch project; verify html-verifier runs automatically post-screen-emission | Report.json emitted; ≥95% precision on synthetic failures                                      |
| C     | lessons-agent               | Archive a test plan with known lesson; run skill                                                 | Lesson lands in docs/lessons.md verbatim; de-dup heuristic prevents double-insertion on re-run |
| C     | Promotion candidates        | Synthesize 3 plans with same lesson pattern                                                      | Triple-recurrence triggers promotion candidate write to docs/lessons-promotion-candidates.md   |
| D     | register-mcp-servers        | Fixture architecture.yaml with 2 build MCPs                                                      | Written to .mcp.json + agent frontmatters updated + idempotent on re-run                       |
| D     | git-agent skill             | 5 ops on scratch repo with worktrees                                                             | All produce matching JSON log entries; behavior matches orchestrator's CLI-direct path         |
| E     | Report                      | Read docs/extensions-completion-report.md                                                        | All phase checkmarks present; lessons written                                                  |

## Rejected Alternatives

### Alternative A: Ship each extension as its own small plan

**Why rejected**: Five plans of 200-500 LOC each produce overhead (5 × plan frontmatter + 5 × archival + 5 × branch management) for work that parallelizes cleanly. A single bundled plan is easier to track + review + merge. Precedent: `feat-008-builder-runtimes` bundled 028 + 029 + 030 per similar reasoning.

### Alternative B: Ship only html-verifier + lessons-agent now; defer the rest indefinitely

**Why rejected**: The 5 items share an execution substrate (agent authoring + skill authoring + self-verify tooling). Shipping 2 of 5 leaves dangling pieces (skills-audit auto-author is the only real escape hatch for future stacks — without it, every new stack requires hand-authoring). Partial closure of an extension set is an anti-pattern for factory work — we either finish the extension category or don't start it.

### Alternative C: Execute before MVP exit to avoid post-MVP drift

**Why rejected**: The roadmap's deliberate scoping explicitly makes these post-MVP. Shipping them pre-MVP delays the first autonomous run signal by ~10-15h. MVP exit gives high-signal data (did the pipeline work end-to-end?) that these extensions benefit from; running them before MVP is premature optimization.

### Alternative D: Skip lessons-agent; rely on manual aggregation

**Why rejected**: Manual aggregation has missed 3+ lessons from archived plans this month (sampled by a quick read of archive vs. lessons.md). The failure mode is silent — no one notices what's missing. lessons-agent costs ~2h to ship + unlocks compounding knowledge capture for every future factory run.

## Expected Outcomes

- [ ] `pnpm --filter orchestrator test` clean after all 5 phases (none of these touch orchestrator source, but shared-skeleton tests must still pass)
- [ ] skills-audit can auto-author 2-3 stack skills against scratch architecture.yaml fixtures without hallucinating vendor APIs
- [ ] html-verifier runs against revolution-pictures's 16 screens with 16/16 pass AND catches an injected regression cleanly
- [ ] lessons-agent auto-extracts from a test plan archive + de-dups correctly
- [ ] register-mcp-servers build-scope writes + re-reads .mcp.json idempotently with vendor entries beyond the design set
- [ ] git-agent skill runtime produces JSON logs matching the orchestrator's CLI-direct path on the 5 ops
- [ ] `docs/extensions-completion-report.md` reflects all 5 phases green OR characterizes failures
- [ ] `docs/build-tier-roadmap.md` has a §Post-MVP Extensions Complete record

## Validation Criteria

- **Typecheck + tests**: `pnpm -r typecheck && pnpm -r test` both clean factory-wide
- **Agent discovery**: `.claude/agents/{html-verifier,lessons-agent,skills-agent}.md` all load without frontmatter errors (script: `node scripts/validate-agent-frontmatter.mjs`)
- **Skill discovery**: `.claude/skills/{verify-html,lessons}/SKILL.md` register-able via skill list probe
- **No regressions**: run `/start-build revolution-pictures --dry-run` + confirm output unchanged from pre-feat-015 baseline
- **Documentation**: new skills + agents indexed in `.claude/agents/README.md` + `.claude/skills/README.md` (if those indexes exist)

## Attempt Log

<!-- Executing agent fills this in as attempts complete. -->

## References

- `docs/build-tier-roadmap.md` §Extension plans
- `plans/archive/investigate-002-build-tier-readiness-gap.md` §Recommendation §Extension
- `plans/active/feat-014-mvp-completion-autonomous-e2e.md` — prerequisite; this plan depends on MVP exit
- `.claude/skills/agents/_template/SKILL.md` — shape reference for Phase A
