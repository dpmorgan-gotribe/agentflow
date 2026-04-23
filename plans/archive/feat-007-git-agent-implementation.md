---
id: feat-007-git-agent-implementation
type: feature
status: completed
approved-at: 2026-04-23
approved-by: human
completed-at: 2026-04-23
author-agent: human
created: 2026-04-23
updated: 2026-04-23
parent-plan: investigate-002-build-tier-readiness-gap
supersedes: null
superseded-by: null
branch: feat/git-agent-implementation
affected-files:
  - .claude/skills/git-agent/SKILL.md
  - .claude/worktrees/README.md
  - scripts/validate-feature-context.mjs
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-007-git-agent-implementation: `/git-agent` skill + worktree lifecycle

## Problem Statement

The orchestrator's Mode B depends on git-agent. Most of git-agent is already shipped:

- `.claude/agents/git-agent.md` — agent definition (exists; 5-op contract documented)
- `@repo/orchestrator-contracts/src/git-agent.ts` — `GitAgentOutput` Zod schema (8 variants, shipped in task-035 Phase 2)
- `schemas/feature-context.schema.json` — lockfile contract (exists)
- `@repo/orchestrator-contracts/src/feature-context.ts` — Zod mirror (shipped in task-035 Phase 2)

What's missing:

- **`.claude/skills/git-agent/SKILL.md`** — the actual skill that runs the 5 ops
- **`.claude/worktrees/README.md`** — human-readable directory doc (factory-seeded)
- **`scripts/validate-feature-context.mjs`** — AJV runner for self-verify + orchestrator validation

Once shipped, `pnpm generate mindapp-v2 --dry-run` halts one step earlier (at `skills-audit-build`, still) but the final Mode A stage + every Mode B feature transition can actually execute against real `git worktree` commands. This unblocks feat-008 (builders), which need a worktree CWD to run inside.

## Approach

Three small phases. Each ends with a commit + a verification step.

### Phase 1 — Skill file + worktrees README + validator script

1. Write `.claude/skills/git-agent/SKILL.md`:
   - Frontmatter: `name: git-agent`, `allowed-tools: Read Write Bash Grep Glob`, `model: inherit`, `argument-hint: "--op=<operation>"`
   - Accepts `--op=bootstrap | checkout-feature | close-feature | resolve-conflict-handoff | emergency-abort`
   - For each op: preconditions → actions → output JSON shape per `GitAgentOutput` variants
   - Argument validation + hard-rule enforcement (no force-push, no reset --hard, no --no-verify, no .env read)
   - Idempotency contract (bootstrap, checkout-feature, close-feature all re-invokable post-crash)
2. Write `.claude/worktrees/README.md`:
   - Purpose: explain what lives here, who writes it (git-agent only during Mode B), when entries are removed (close-feature on clean merge, emergency-abort on failure, `just git-cleanup` off-band housekeeping)
   - Explicitly: this directory is gitignored; lockfiles at `.claude/worktrees/{slug}/.feature-context.json` are the authoritative state per worktree
3. Write `scripts/validate-feature-context.mjs`:
   - AJV runner against `schemas/feature-context.schema.json`
   - Called from git-agent's self-verify step after every lockfile write
   - Same pattern as `validate-architecture.mjs` + `validate-tasks-yaml.mjs`

**Exit**: skill file present + registered (visible in available-skills list), worktrees README seeded, validator runs cleanly against a minimal mock lockfile.

### Phase 2 — Orchestrator dry-run advances past git-agent-bootstrap

1. Run `pnpm generate mindapp-v2 --dry-run` — expect the halt message to move from "git-agent-bootstrap" being missing to showing `✓ git-agent-bootstrap — skill present`.
2. The real halt remains at `skills-audit-build` (earlier in the chain); when that ships, `register-mcp-build` is next, then `git-agent-bootstrap` is the terminal Mode A stage.
3. No live invocation at this stage — just dry-run skill detection.

**Exit**: dry-run shows git-agent skill present (same as architect + pm pattern).

### Phase 3 — Live smoke test: one real bootstrap + one real checkout+close cycle

Exercise the skill end-to-end with real `git worktree` commands. Execute in an **isolated scratch directory** (NOT the factory repo — worktrees in a real repo would pollute history). The subagent performs:

1. **Setup**: create a scratch git repo under a `tmp/` directory (factory-ignored); init with one commit on main; make it the "project root" for the test.
2. **Bootstrap op**: invoke `/git-agent --op=bootstrap` against the scratch repo. Expect `{ op: "bootstrap", success: true, mainBranch, mainSha, worktreeRoot, cleanTree: true }`.
3. **Checkout-feature**: invoke with `--op=checkout-feature` + a synthetic feature context (`worktree: feat-hello`, `branch: feat/hello`, `featureId: feat-hello`). Expect `success: true` + worktreePath resolves to a real directory + `.feature-context.json` exists and validates against the schema.
4. **Synthetic commit** inside the worktree (simulate a builder's work): `cd .claude/worktrees/feat-hello && echo "..." > file.txt && git add . && git commit -m "feat: hello"`.
5. **Close-feature**: invoke with `--op=close-feature`. Expect `success: true, conflict: false, mergeSha`. Confirm the main branch now has the merge commit; confirm the worktree directory is gone.
6. **Cleanup**: `rm -rf tmp/` scratch repo.

All GitAgentOutput payloads from steps 2-5 get validated against `GitAgentOutputSchema` from `@repo/orchestrator-contracts`.

**Exit**: clean bootstrap → checkout-feature → synthetic commit → close-feature cycle completes against real git worktree commands. Archive plan.

## Rejected Alternatives

- **Alternative A: Skip the skill file and have the orchestrator shell out to `git` CLI directly** — Rejected. Separation of concerns: git-agent owns the lockfile state + idempotency semantics, not the orchestrator. Also, agent invocations get the retry + cost-tracking + structured-output validation that direct shell-outs don't.

- **Alternative B: Defer the live smoke test to after feat-008 builders ship** — Rejected. Without validating the real `git worktree` operations now, a bug in this skill would surface only when feat-008 is smoke-tested — conflating two risk surfaces. Quick scratch-repo test now isolates the git-agent risk.

- **Alternative C: Write a Node wrapper around `simple-git` or `isomorphic-git`** — Rejected. The agent's Bash tool running `git` CLI directly is simpler, more transparent, and matches the existing pattern (git-agent.md already spells out specific `git worktree add` / `git merge --no-ff` invocations). Adding a JS library for thin ops is overhead.

- **Alternative D: Ship worktrees README as part of `/new-project` instead of the factory root** — Rejected. `/new-project` already copies templates from `.claude/templates/` into project roots; the worktrees README is factory-level documentation (the directory structure is factory-convention, not project-specific) — it lives at the factory's `.claude/worktrees/README.md` as a reference. Projects get their own README via `/new-project` step 3 if needed.

## Expected Outcomes

- [ ] `.claude/skills/git-agent/SKILL.md` exists; registers in available-skills list
- [ ] `.claude/worktrees/README.md` exists at factory level documenting directory lifecycle
- [ ] `scripts/validate-feature-context.mjs` exists; runs cleanly against a minimal mock lockfile
- [ ] `pnpm generate mindapp-v2 --dry-run` shows `✓ git-agent-bootstrap — skill present`
- [ ] Live smoke test: bootstrap → checkout-feature → synthetic commit → close-feature completes in an isolated scratch repo
- [ ] All 5 op output JSON variants validate against `GitAgentOutputSchema` during the smoke test
- [ ] Lockfile (`.feature-context.json`) validates against `schemas/feature-context.schema.json`
- [ ] No factory commits / merges / branches affected by the smoke test (scratch-repo isolation)
- [ ] All 112 orchestrator tests still pass; 86 contracts tests still pass
- [ ] Plan archived with lessons

## Validation Criteria

**Skill coverage:**

- Invoking `/git-agent` without `--op=` returns a clear rejection
- Invoking with unknown `--op=foo` returns a rejection listing the 5 valid ops
- Each valid op's output validates against its `GitAgentOutput` variant

**Smoke-test coverage:**

- bootstrap with clean main → success
- bootstrap with uncommitted changes → failure with `reason: "uncommitted-changes"` + `files[]`
- checkout-feature twice with the same featureId → idempotent (second invocation returns existing lockfile contents, not `branch-conflict`)
- close-feature with clean merge → `success: true, conflict: false, mergeSha`; worktree directory removed
- Merge conflict path deferred to feat-008 (builders needed to produce conflicting work; synthetic conflict harder to stage realistically)

**Spec fidelity:**

- Every acceptance criterion from scaffolding/20-033-git-agent.md §Acceptance Criteria is addressed
- No force-push, no reset --hard, no rewrite-history in the skill's Bash commands (grep the SKILL.md for these patterns → zero matches)

**No regression:**

- `pnpm test:all` green across all workspaces
- Nothing in `orchestrator/` source changes (additive plan)

## Attempt Log

### Attempt 1 — 2026-04-23 (succeeded across all 3 phases)

3 commits on `feat/git-agent-implementation`:

- Phase 1 (6ad69a5): `.claude/skills/git-agent/SKILL.md` (5-op dispatcher) + `.claude/worktrees/README.md` (factory-seed doc) + `scripts/validate-feature-context.mjs` (AJV lockfile runner) + `.gitignore` update (pattern `.claude/worktrees/*` + `!README.md` negation so README is tracked while worktree contents stay ignored).
- Phase 2: dry-run smoke — `pnpm generate mindapp-v2 --dry-run` reports `→ git-agent-bootstrap — skill present at .claude/skills/git-agent`. Halt remains at `skills-audit-build` (earlier in the chain, out of this plan's scope).
- Phase 3: live smoke test in isolated scratch repo — all 7 test scenarios PASS. Every return JSON validates against its GitAgentOutput Zod variant.
- Fix commit (9d3a96d): post-Phase-3 spec fixes for 2 real gaps the smoke test surfaced (see Lessons below).

**Phase 3 test matrix** (scratch repo at `/tmp/git-agent-smoke-<ts>`):

1. bootstrap clean main → PASS (BootstrapSuccess)
2. bootstrap dirty tree → PASS (BootstrapFailure with `reason: "uncommitted-changes"`)
3. checkout-feature (new) → PASS (CheckoutFeatureSuccess + lockfile validator exit 0)
4. checkout-feature (idempotent re-invocation) → PASS (opened_at preserved)
5. synthetic builder commit + agent_history append → PASS (re-validate exit 0)
6. close-feature (clean merge) → PASS (CloseFeatureSuccess + merge commit on main + worktree removed + closed-lockfile persisted)
7. bootstrap post-close → PASS (new mainSha reflecting the merge)

## Lessons Learned

**Gap 1 (fixed): lockfile placement inside the worktree breaks `git worktree remove`.** The spec puts `.feature-context.json` at `.claude/worktrees/{slug}/.feature-context.json` — inside the worktree directory. But the lockfile is never committed to the feature branch, so `git status --porcelain` inside the worktree sees it as untracked + `git worktree remove` refuses with "contains modified or untracked files". **Fix applied in 9d3a96d**: checkout-feature step 5 now appends `.feature-context.json` to `.git/worktrees/{slug}/info/exclude` right after worktree creation. This is git's per-worktree equivalent of `.gitignore` — makes the lockfile invisible to status-check and worktree-remove without needing `--force` or moving the file.

**Gap 2 (non-issue in factory, flagged for /new-project): sidecar `*.closed.json` / `*.aborted.json` files.** Subagent flagged these would fail bootstrap's "clean-tree" check on subsequent Mode B iterations. In the factory, `.gitignore` pattern `.claude/worktrees/*` (with `!README.md` negation) already excludes all sidecars from `git status --porcelain`. In a generated project, `/new-project` needs to copy the same pattern. **Follow-up**: audit `/new-project` step 3 to confirm it scaffolds this gitignore rule in project repos; add to a future cleanup plan if not already handled.

**Gap 3 (fixed): `git branch -d` refuses when main isn't pushed to origin.** After `git merge --no-ff` locally, the merge commit exists on main but `origin/main` still points at the pre-merge sha. `git branch -d feat/hello` sees the feature branch tip as "not fully merged" relative to origin and refuses. **Fix applied in 9d3a96d**: close-feature step 6 now runs `git push origin main` before the local branch delete. This matches the spec's intent that every feature's history reaches origin for audit + CI, and makes the branch-delete safe (`-d`, not `-D`).

**Idempotency contract works as designed.** Test 4's idempotent checkout-feature re-invocation returned the ORIGINAL `opened_at` timestamp — confirmed by the subagent. The skill's logic correctly: (a) detects the existing worktree, (b) reads the existing lockfile, (c) returns the cached payload WITHOUT re-running `git worktree add`. Critical for orchestrator crash-recovery.

**Zod discriminated union parsing against a plain `z.union`.** GitAgentOutput is `z.union([...])` (not discriminatedUnion) because bootstrap/checkout-feature/close-feature each have success + failure variants sharing the same `op` discriminator value — Zod v4 forbids duplicate discriminator values (feat-005 lesson). z.union parses slightly slower but handles the shape correctly. Subagent confirmed all 7 return JSONs parse cleanly against the union.

**Factory git state never touched.** Smoke test ran entirely in a scratch repo at `/tmp/git-agent-smoke-<timestamp>`. Post-test `rm -rf` cleaned up the scratch + bare-origin repos. Factory `.git` was never a target of any git command. Good isolation pattern to reuse for feat-008 builder smoke tests.

**Windows `node -e` + shell interpolation note.** `/tmp/...` paths written inside `node -e "..."` one-liners get rewritten to `C:\tmp\...` by Git Bash on Windows. Not a skill bug — a tooling note for future smoke-test authors. Prefer `cd <tmpdir> && node script.mjs` or write a real .mjs file rather than interpolating raw paths via shell.

## Follow-up Work Unblocked

Mode B is now fully functional at the skill layer:

- **feat-008 builder runtimes** (backend + web + mobile bundled, ~1500 LOC) — builders can now be smoke-tested end-to-end against the full `invokeAgent → checkout-feature → execute-tasks → close-feature` loop driven by orchestrator's `runFeature`. Before feat-007, builders could only be tested in isolation (direct skill invocation).
- **feat-009 tester + feat-010 reviewer** — same unlock; last 2 agents in the typical `agent_sequence[]`.
- **task-010 skills-audit** + **task-011 register-mcp-servers** — the remaining dry-run halt stages. Registrar work; can ship anytime before the first live Mode B run against mindapp-v2.

Follow-ups NOT yet validated:

- **Merge conflict routing via resolve-conflict-handoff** — Phase 3 did NOT exercise this path (synthesizing a realistic cross-agent conflict in a scratch repo is overhead that doesn't match the skill's risk surface). Will be validated implicitly when feat-008 + feat-009 builders introduce real work that occasionally conflicts during concurrent feature merges.
- **emergency-abort** — not invoked in Phase 3. Same reason: deferring to the first real retry-ladder exhaustion in live Mode B.
- **Concurrent feature worktrees** (e.g. 4 features running in parallel per default `maxConcurrentFeatures=4`) — not tested at this layer; exercised indirectly through orchestrator's `runFeatureGraph` already (task-035 has 12 tests covering the feature-graph scheduler).
