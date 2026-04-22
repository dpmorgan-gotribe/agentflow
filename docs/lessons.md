# Lessons — factory project lessons

Aggregated from `plans/archive/*.md` COMPLETION RECORD blocks. This file is the project-scope counterpart to `~/.claude/CLAUDE.md` (global). Per blueprint §21 (Self-learning loops), the Lessons Agent (task ~037, not yet shipped) is eventually responsible for keeping this file in sync with archived plans. Until then, maintained manually / re-generated after batch archives via `scripts/archive-plans.mjs` output.

**Last aggregated**: 2026-04-22 from 9 archived plans (refactor-001/002/003/004 + investigate-001 + feat-001/002/003/004).

Total: **33 lessons across 9 plans**. Organized by theme rather than by plan so similar insights cluster.

---

## 1. Plan + process discipline

**Per-step review beats end-of-plan review.** Each of the eight refactor-001 implementation steps was self-reviewed before moving on; ~30 real bugs (broken examples, wrong counts, inconsistent field names, line-drift hazards) were caught in-step. Batching review to the end would have compounded drift across dependent files. Default to per-step review for any refactor touching more than three files. — `refactor-001-ui-designer-kit-pipeline`

**Bundle entangled architectural questions; split independent ones.** investigate-001 tackled 5 interlocking post-design-pipeline concerns as one investigation — splitting would have forced re-threading the dependencies 5 times. Contrast: when the 5 follow-up plans were created, they were split cleanly because their dependencies were already mapped. Heuristic: if option selection in plan A changes the shape of plan B's approach, bundle. Otherwise split. — `investigate-001-post-design-pipeline-architecture`

**Hypothesis-before-investigation focuses the search.** investigate-001's Phase 3 explicitly recorded hypotheses before Phase 1+2 research ran. 3 of 5 hypotheses confirmed, 2 falsified — both outcomes produced concrete artefacts. No-hypothesis research would have wandered. — `investigate-001-post-design-pipeline-architecture`

**Delegate survey to an Explore agent; synthesize in main context.** investigate-001 Phase 1+2 (file reading + observation gathering) ran in an Explore subagent. Phase 3+4 (evaluation + recommendations) ran in the main agent. This split keeps the main context clean of grep output + gives architectural judgment calls to the agent with full plan-level context. — `investigate-001-post-design-pipeline-architecture`

---

## 2. Schema + contract design

**JSON Schema can't express cross-field invariants cleanly.** refactor-004's tasks.yaml v2 has rules like "every task.agent ∈ parent feature.agent_sequence" that don't map to Draft-07. Pattern: document the invariant in the Zod mirror's comment block as orchestrator-load-time checks; schema validates structure, loader validates cross-field. Split responsibilities cleanly between declarative (schema) and procedural (loader) validation. — `refactor-004-task-driven-orchestration`

**Enum + `additionalProperties: false` rejects typos at ajv time.** feat-002's `architecture.yaml.tooling.stack` subtree locks every slot to an enum and forbids extra keys. Typos like `backend_framework: next-trpc-nest` (missing `node-`) fail validation before reaching skill-resolution, where the error would be "Stack skill missing" + confusing auto-author suggestion. Boundary-at-schema, not boundary-at-use. — `feat-002-stack-skill-shelf`

**Discriminated unions for operation-output contracts.** feat-003's `GitAgentOutput` discriminates on `op` across 8 variants — bootstrap success/fail, checkout success/fail, close with-conflict vs without-conflict, resolve-conflict-handoff, emergency-abort. Each variant has a distinct success/failure shape. Single-union-type would have required optional fields everywhere; discriminated union makes each op's contract explicit. — `feat-003-git-agent-worktrees`

**Three-way enums beat forced binaries.** refactor-003's `deployment: vendor | self-hosted | declined` handles every integration cleanly — `declined` was the third we didn't know we needed until brief review surfaced cases where the user explicitly rejects an integration (e.g., "no analytics"). Boolean `vendor vs hosted` would have forced `declined` into either bucket with an ugly override field. — `refactor-003-pipeline-reorder-architect-credentials`

**5 ops captures a lifecycle without over-specifying.** feat-003's git-agent has bootstrap / checkout-feature / close-feature / resolve-conflict-handoff / emergency-abort. 4 would have missed Mode A's final bootstrap; 6 would have been over-segmented. Count ops by asking "what are the distinct state-transition boundaries this agent owns". — `feat-003-git-agent-worktrees`

**3-mode matrix was the minimum; 2 would have been too few, 4 too many.** feat-001's `/new-project --agentic-visibility=public|private|split` — two modes (public/private) had no split-repo path for clients who want factory-audit + public-push; four modes would have confused (what's the fourth?). 3 is the sweet spot when the concept has genuine variety along one axis. — `feat-001-agentic-privacy-flag`

---

## 3. Documentation + line-drift discipline

**Append-only addenda to line-referenced docs.** refactor-001 initially added a 2-line top-of-document note that drifted every scaffolding task's `blueprint §X LYYY-ZZZ` citation by +2. Fix: put large addenda at the END (append-only = zero line drift). Apply to any doc cited by line number. — `refactor-001-ui-designer-kit-pipeline`

**Supersession-over-rewrite preserves rationale.** feat-002 marked blueprint §17 superseded by Appendix E rather than rewriting §17. The React-as-default rationale in §17 is still useful as the "defaults when brief is silent" case. Rewriting would have erased institutional memory; supersession keeps both readable in the right order. — `feat-002-stack-skill-shelf`

**Gitignored dirs need template-based README distribution.** feat-003 wrote `.claude/worktrees/README.md`; git silently ignored it because `.claude/worktrees/` is gitignored. Pattern: put the README at `.claude/templates/worktrees-README.md` + have `/new-project` step 5 copy it into the project. Any docs meant to live inside a gitignored dir need this template-pattern treatment. — `feat-003-git-agent-worktrees`

---

## 4. Orchestration + task flow

**Two-mode orchestrator is foundational for the whole build tier.** refactor-004's split into Mode A (stage-linear through design + planning) + Mode B (feature-graph post-PM) is the schema that feat-002 (builder dispatch), feat-003 (worktrees), and feat-004 (TDD) all bind to. Foundational refactors should land first; every downstream plan assumes their schema. — `refactor-004-task-driven-orchestration`

**Deprecate-without-migration when there's no v1 in the wild.** refactor-004's tasks.yaml v2 deprecates v1, and no migration code was needed because no project had produced a v1 yet. Sometimes the best migration is timing the change before the first consumer lands. — `refactor-004-task-driven-orchestration`

**Architect post-signoff, not pre-signoff.** refactor-003 moved architect + PM to run AFTER design sign-off. Pre-refactor architect had to guess user intent from a brief; post-refactor architect sees composed screens + approved style + actual components — vendor decisions reflect reality. Principle: let an agent decide something only after its inputs are actually true. — `refactor-003-pipeline-reorder-architect-credentials`

**Single-responsibility agents route through stateful glue.** feat-003's `resolve-conflict-handoff` updates the lockfile + returns context without running git ops — orchestrator owns the re-invocation; git-agent stays single-responsibility. Same pattern for any "route work back to the last writer" flow: one agent writes state, another agent reads state + dispatches. — `feat-003-git-agent-worktrees`

---

## 5. Testing + TDD

**Hybrid TDD beats pure TDD or pure post-build.** Pure TDD (red-green-refactor per builder) is too slow for AI builders with no internalization benefit. Pure post-build (tester writes all tests) has the tester reverse-engineering builder intent + becomes a bottleneck. Hybrid: builders write happy-path + run tests; tester adds edge cases + integration + E2E + runs full suite. — `feat-004-builder-tdd-hybrid`

**Stack-specific testing idioms live in stack skills, not in a central rule file.** feat-002's stack skills each carry their own §Testing block (Vitest patterns for react-next; pytest for python-fastapi; jest-expo for mobile). feat-004's `.claude/rules/testing-policy.md` provides cross-cutting policy (coverage thresholds, who-authors-what); stack specifics stay local. Policy globally; idiom locally. — `feat-004-builder-tdd-hybrid`

**Arbitrary coverage thresholds give clear stop signals.** 60% builder / 80% total felt arbitrary but gives builders + tester precise stop signals + the orchestrator a binary pass/fail at gate 4. The numbers don't matter much for motivation; the boundary matters a lot for automation. — `feat-004-builder-tdd-hybrid`

**Structured bug-routing field beats ad-hoc signalling.** feat-004's tester returns `genuineProductBugs[]` in its JSON when test failures trace to real implementation bugs. The orchestrator's retry loop reads this field + routes back to the last writing builder per per-task retry policy. Ad-hoc "throw an error" signalling would require the orchestrator to parse prose. Structured field = deterministic routing. — `feat-004-builder-tdd-hybrid`

---

## 6. Naming + domain modeling

**Don't unify vocabularies across legitimately-different domains.** refactor-001 initially tried to unify `webapp` as canonical across design-side + build-side. But design-side path `webapp` (what the user sees) and build-side dir `web` (where the code ships) are parallel-but-distinct. Unification would have rippled through 026/027/029 directory conventions. Fix: model both + supply `platformIdToTarget()` mapping. When two domains legitimately use different vocabularies, keep both + bridge via helper. — `refactor-001-ui-designer-kit-pipeline`

**Over-correction is cheaper to catch in review than in practice.** refactor-001's initial attempt at naming unification was caught in review and reverted. When a review surfaces a consistency gap, ask: "rename everything to match the cleaner name" vs "model the split explicitly". Both are valid; the split is usually less invasive. — `refactor-001-ui-designer-kit-pipeline`

**Stack-slug enum matches filesystem layout.** feat-002's `web_framework: "react-next"` resolves to `.claude/skills/agents/front-end/react-next/SKILL.md` — slug = directory name. One lookup, zero translation layer. When a config value drives a file-system resolution, make the value the resolution key. — `feat-002-stack-skill-shelf`

**Default `private` is the safer default than `public`.** feat-001's `/new-project --agentic-visibility=<mode>` defaulted to `private` (agentic layer gitignored). `public` is opt-in. Default value choice: pick the one whose failure mode is "user asks for more" not "user accidentally leaks". — `feat-001-agentic-privacy-flag`

---

## 7. Cross-task dependencies

**Explicit `depends-on` for every consumed artefact.** Builders 029/030 were initially missing 028 in depends-on even though they import `@repo/api-client` typed against 028's tRPC router. Silent dep misses cause downstream builds to fail confusingly. Rule: if task A reads a file / schema authored by task B, B goes in A's depends-on — even if A's happy path doesn't directly invoke B. — `refactor-001-ui-designer-kit-pipeline`

---

## 8. Feature flags

**Filter feature-flagged registrations at registration time, not runtime.** Task 041's `/register-mcp-servers` filters servers by `feature_flag` against the active pipeline flag set BEFORE writing `.mcp.json`. When `nanobanana` is off, `image-generator` literally doesn't exist for the run. Runtime-only gate would leave the server registered and let skills call it despite the flag being off. Fail at provisioning, not at call time. — `refactor-001-ui-designer-kit-pipeline`

---

## 9. HTML → JSX translation

**DSL artefacts carry structured metadata inline, don't reverse-engineer it.** `/screens` emits `data-kit-component` / `data-kit-variant` / `data-kit-size` attributes on every HTML element. Builders (029/030) read these attrs for deterministic HTML → JSX translation. Trying to pattern-match the CVA-emitted Tailwind classes would have failed (the classes are derived output, not invertible). When a DSL will be converted back to a typed form, have the DSL carry the structured metadata inline. — `refactor-001-ui-designer-kit-pipeline`

---

## 10. Gate + HITL mechanics

**Static HTML can't write files — gates need backing HTTP servers.** HITL gate 2 (dial editing, style selection) and gate 4 (sign-off) need POST endpoints. The orchestrator + HITL-gate tasks (035/036) own the server lifecycle; producing skills (023/025) emit the static HTML that fetches endpoints. Document the endpoint contract alongside the schema. — `refactor-001-ui-designer-kit-pipeline`

**File-drop beats HTTP for human-authored secret handoff.** Gate 5 (credentials) uses `docs/credentials-confirmed.txt` — no agent ever touches `.env`; the filesystem is the handoff. For anything where the agent MUST NOT see the content, prefer file-watching a separate token over HTTP POST bodies. — `refactor-003-pipeline-reorder-architect-credentials`

---

## 11. Shipped vs auto-authored

**Ship the backbone; auto-author the long tail.** feat-002 authored 5 stack skills by hand (react-next, svelte-kit, node-trpc-nest, python-fastapi, expo-rn). Draft auto-authoring (via `/skills-audit --scope=build --auto-author-stack-skills`) is the long-tail path for the remaining 20+ schema-enum-valid slugs. Shipped skills are human-reviewed quality; drafts are opt-in research starting points. Don't try to ship all N by hand; don't expect the auto-author path to be the primary use. — `feat-002-stack-skill-shelf`

---

## How to maintain this file

**Manual path (today)**: after a `/plan-archive` batch, re-run `node scripts/archive-plans.mjs --print-lessons` (future enhancement — currently lessons extraction is inline in the batch script) OR manually grep archived plans' COMPLETION RECORD blocks for `lessons:` entries + theme + cite.

**Automated path (future)**: Lessons Agent (task ~037, not yet shipped) watches `plans/archive/` + updates this file when plans are archived. It should also push global-relevant lessons to `~/.claude/CLAUDE.md` (blueprint §21).

**What goes here** (project-scope): lessons specific to THIS factory repo's architecture + conventions + decisions. Generic lessons ("use TypeScript strict mode") live in global config or stack skills.

**What goes elsewhere**:

- Per-agent lessons ("the analyst struggles with X") → `.claude/agent-memory/{agent}/MEMORY.md` (blueprint §21)
- Global lessons ("prefer workspace protocol over published packages in monorepos") → `~/.claude/CLAUDE.md`
- Stack-specific lessons → `.claude/skills/agents/{tier}/{slug}/SKILL.md` §Gotchas
