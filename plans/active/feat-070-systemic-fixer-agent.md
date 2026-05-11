---
id: feat-070-systemic-fixer-agent
type: feature
status: completed
author-agent: human
created: 2026-05-08
updated: 2026-05-11
parent-plan: feat-066-fix-loop-effectiveness-v2
branch: feat/quota-observability
affected-files:
  - .claude/agents/systemic-fixer.md (new)
  - .claude/models.yaml
  - packages/orchestrator-contracts/src/tasks.ts
  - packages/orchestrator-contracts/src/parity-verify.ts
  - packages/orchestrator-contracts/src/bugs-yaml.ts
  - scripts/file-bug-plan.mjs
  - orchestrator/src/model-config.ts
  - orchestrator/src/bug-fix-context.ts
  - orchestrator/tests/bug-fix-context.test.ts
feature-area: orchestrator/agent-routing
priority: P0
attempt-count: 1
max-attempts: 5
---

# feat-070: Phase 5 — systemic-fixer agent variant

## Problem Statement

feat-066 Phase 5. The bug-fixer agent (feat-064) is intentionally narrow-scoped: maxTurns:8, "smallest possible diff", "don't refactor". That's load-bearing for per-bug wall-clock (5-6 min target), but it's the WRONG dispatch for systemic bugs:

- bug-077 (Tailwind pipeline broken) was empirically a 1-line fix in TWO places (apps/web/postcss.config.mjs + ui-kit/styles/globals.css) but the bug-fixer's per-bug isolation made it impossible to recognize as one root cause across 30 surface symptoms
- Phase 1 will emit `systemic-divergence` bugs (when audit-computed-styles finds >15 drifts on a tuple)
- Phase 2 will emit `pixel-systemic-divergence` (whole-screen-broken)
- Phase 0.5 deterministic discriminators will emit `tooling-css-pipeline-broken`, `tooling-config-mismatch`, `tooling-test-seed-contract-broken`

All of these need a systemic-thinking dispatch — explicitly authorized to look across files, suspect the build pipeline / scaffold / kit-CSS layer, NOT just patch individual symptoms.

## Approach

1. **NEW `.claude/agents/systemic-fixer.md`** — system prompt:
   - tools: Read, Write, Edit, Bash, Grep, Glob (same as bug-fixer)
   - mcp_servers: [] (keep cold-start tax low)
   - maxTurns: 12 (vs bug-fixer's 8 — needs more exploration)
   - effort: medium
   - System prompt: "You diagnose and fix SYSTEMIC defects — bugs whose symptoms are scattered across many files but whose root cause is in a single config / scaffold / library. Look ACROSS files. Suspect the build pipeline, the scaffold, or shared infrastructure FIRST before touching individual surface symptoms. Do NOT patch one symptom at a time — find the source. If you can't find a single root cause within maxTurns budget, document what you ruled out + flag for human review."

2. **Add to `AgentSequenceMember` enum** in `packages/orchestrator-contracts/src/tasks.ts`. Same shape as bug-fixer addition.

3. **Wire dispatch routing** in `scripts/file-bug-plan.mjs`:
   - `systemic-divergence`, `pixel-systemic-divergence`, `tooling-css-pipeline-broken`, `tooling-config-mismatch`, `tooling-test-seed-contract-broken`, `clustered-systemic-divergence` (from Phase 6) → `["systemic-fixer"]`

4. **Add to `.claude/models.yaml` + `FACTORY_DEFAULT_AGENT_TIERS`** in `model-config.ts`:
   - `systemic-fixer: { tier: building, effort: medium }` (one tier above bug-fixer's effort:medium for cross-file work)
   - `DEFAULT_STALL_TIMEOUT_BY_AGENT["systemic-fixer"] = 18 * 60 * 1000` (18 min — pairs with maxTurns:12)

5. **Pre-loaded context envelope** for systemic-fixer in `orchestrator/src/bug-fix-context.ts`:
   - For `systemic-divergence` / `clustered-systemic-divergence`: include all N drift entries as a single block; include the project's `tailwind.config.ts`, `next.config.ts`, `postcss.config.{mjs,js}` (or "FILE MISSING" markers), and the kit's `globals.css` so the agent sees the full pipeline state at-a-glance
   - For `tooling-*`: include the relevant config files + a one-paragraph diagnostic summary from the discriminator that fired

## Rejected Alternatives

- **Don't add a separate agent — let bug-fixer handle systemic bugs with longer maxTurns.** Rejected because the bug-fixer's "smallest diff" + "don't refactor" frontmatter actively blocks systemic-thinking; flipping that for some dispatches but not others would require per-dispatch system-prompt mutation (more orchestrator complexity than a separate agent).
- **Use Opus for systemic-fixer instead of Sonnet.** Rejected — investigate-024 evidence + bug-fixer empirical wins say Sonnet is sufficient for these tasks; Opus would 5× the cost without measurable quality lift.
- **Drop maxTurns to 8 (match bug-fixer) for cost parity.** Rejected — empirically bug-077-class bugs need cross-file exploration; an 8-turn cap would force the agent into the same shell-game pattern bug-fixer fell into.

## Expected Outcomes

- [ ] `.claude/agents/systemic-fixer.md` ships
- [ ] AgentSequenceMember + TaskAgent enums extended
- [ ] Dispatch routing emits `["systemic-fixer"]` for the 6 systemic bug classes
- [ ] models.yaml entry + FACTORY_DEFAULT_AGENT_TIERS fallback
- [ ] DEFAULT_STALL_TIMEOUT 18-min cap for systemic-fixer
- [ ] Pre-loaded context envelope per-class file resolution
- [ ] On a deliberately-broken Tailwind project: systemic-fixer resolves bug-077 in ONE dispatch (~10 min) instead of 30 surface dispatches (~3 hr)
- [ ] Median wall-clock for systemic dispatches: 8-12 min

## Validation Criteria

1. systemic-fixer dispatched on `tooling-css-pipeline-broken` (deliberately-broken project) → fixes BOTH postcss.config + @tailwind directives in one dispatch
2. systemic-fixer dispatched on `systemic-divergence` (>15 drifts on one tuple) → identifies root cause vs surface-patching
3. Per-dispatch wall-clock measured: 90%-percentile ≤ 12 min
4. Pre-loaded envelope for systemic-fixer includes the right config files (verified via dispatch log inspection)
5. No regression on bug-fixer dispatches (existing per-bug 5-6 min target preserved)

## Attempt Log

### Attempt 1 — 2026-05-11 — shipped

**Surfaces touched (8 files):**

1. **NEW `.claude/agents/systemic-fixer.md`** — agent frontmatter (tools, mcp_servers:[], maxTurns:12, effort:medium, model:inherit) + system prompt. Contract differs from bug-fixer in 4 ways: (a) authorized to edit multiple files in one dispatch, (b) authorized to remove/restructure code when fixing systemic root cause, (c) per-class diagnostic recipes for 6 bug classes (tooling-css-pipeline-broken, tooling-config-mismatch, tooling-test-seed-contract-broken, systemic-divergence, pixel-systemic-divergence, clustered-systemic-divergence), (d) instructs to look across files BEFORE editing.

2. **`packages/orchestrator-contracts/src/tasks.ts`** — added `"systemic-fixer"` to both `AgentSequenceMember` and `TaskAgent` enums with cross-referencing comments.

3. **`packages/orchestrator-contracts/src/parity-verify.ts`** + **`packages/orchestrator-contracts/src/bugs-yaml.ts`** — added 3 new pattern values to `ParityPatternSchema` + `BugParityContextSchema`: `systemic-divergence` (bug-078 fold output), `pixel-systemic-divergence` (feat-067 future), `clustered-systemic-divergence` (feat-071 future). **Critical schema gap** — bug-078's classifier was already emitting `systemic-divergence` patterns but the contract wouldn't accept them.

4. **`scripts/file-bug-plan.mjs`** — added a routing override at the top of the `agentSequence` IIFE. Detects systemic dispatches via two signals: (a) `violation.kind === "parity-divergence"` with `pattern` in the SYSTEMIC_PARITY_PATTERNS set, OR (b) `violation.kind === "dev-server-compile"` with `flowId` prefixed `pre-verify-tooling-` (bug-078 discriminator output). Both route to `["systemic-fixer"]` bypassing the default cause-based table.

5. **`orchestrator/src/model-config.ts`** — added `"systemic-fixer": { tier: "building", effort: "medium" }` to `FACTORY_DEFAULT_AGENT_TIERS` + `"systemic-fixer": 18 * 60 * 1000` to `DEFAULT_STALL_TIMEOUT_BY_AGENT`. 18 min pairs with maxTurns:12 (vs bug-fixer's 15min/8turns).

6. **`.claude/models.yaml`** — mirrored the agent-tier pin so factory dispatches resolve a model when `~/.claude/models.yaml` doesn't have it system-wide yet.

7. **`orchestrator/src/bug-fix-context.ts`** — added a new resolution branch keyed on `bug.agentSequence.includes("systemic-fixer")`. Pre-loads 6 files relevant to systemic diagnostics: `apps/web/tailwind.config.ts`, `apps/web/next.config.ts`, `apps/web/postcss.config.{mjs,js}` (one or both — `emitFileSection` silently drops missing files + logs in diagnostic), `packages/ui-kit/src/styles/globals.css`, `apps/api/.env.example`. 3 new tests in `bug-fix-context.test.ts` (positive case, FILE MISSING markers, bug-fixer negative case).

**Test results:** 821/824 vitest pass across 33 files. 3 pre-existing failures in `run-synthesized-flows.test.ts` are unrelated (documented in `docs/ideas.md` 2026-05-11). Typecheck has 1 pre-existing failure in `feature-graph.test.ts:2682` (stub uses `pattern: string` instead of the literal-union; confirmed pre-existing by stash-and-recheck).

**Validation criteria status:**

- [x] `.claude/agents/systemic-fixer.md` ships
- [x] AgentSequenceMember + TaskAgent enums extended
- [x] Dispatch routing emits `["systemic-fixer"]` for the 6 systemic bug classes (3 parity + 3 tooling discriminators)
- [x] models.yaml entry + FACTORY_DEFAULT_AGENT_TIERS fallback
- [x] DEFAULT_STALL_TIMEOUT 18-min cap for systemic-fixer
- [x] Pre-loaded context envelope resolves the 6 systemic pipeline files
- [ ] **EMPIRICAL** validation against reading-log-02 — deferred to task #7 (re-validation). Needs a fresh fix-bugs run to exercise the dispatch path end-to-end.
- [ ] **EMPIRICAL** wall-clock measurement (90%-percentile ≤ 12 min) — deferred to task #7.

**Decisions made:**

- **Routing on `agentSequence` membership, not `bug.source`.** Reason: `bug.source` is a small enum (6 values from `BugSourceSchema`); adding a "systemic" source would proliferate schema changes. The agent-sequence field is already free-form-enough to carry the routing decision + survives bugs.yaml round-trips via the AgentSequenceMember enum I extended.
- **Same Sonnet tier as bug-fixer (not Opus).** Reason: investigate-024 empirical evidence on bug-fixer says Sonnet handles narrow-context patches at Opus-equivalent quality for 1/5 the cost. Cross-file root-cause work is similar territory; if empirical re-validation shows Sonnet falls short, can flip to Opus via `.claude/models.yaml` without code changes.
- **18-min stall vs bug-fixer's 15-min.** Reason: cross-file Read budget needs ~20% more wall-clock than a 1-file diff. 18 gives systemic-fixer 3 extra minutes without losing the fail-fast discipline (vs 25-min full-builder cap).
- **Pre-load all 6 pipeline files unconditionally** for systemic-fixer dispatches, not class-specific subsets. Reason: `emitFileSection` silently logs missing files in the diagnostic block at ~0 token cost (~3 lines of "✗ file missing" markers). The agent benefits from seeing what DOESN'T exist as much as what does — the missing files ARE the signal for the discriminator cases.

**Cross-references:**

- Pairs with bug-078 (Phase 1, ships same day): bug-078's classifier produces `systemic-divergence` bugs + pre-verify discriminators; feat-070 routes those to the right dispatch.
- Future phases (feat-067 / feat-071) consume the same routing — `pixel-systemic-divergence` + `clustered-systemic-divergence` pattern values already added to the schema.
- `bug-fixer` agent (feat-064) remains the per-bug narrow-scope path; feat-070 is the systemic variant. No regression to bug-fixer's contract — both coexist.
