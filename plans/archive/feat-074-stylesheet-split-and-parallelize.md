---
id: feat-074-stylesheet-split-and-parallelize
type: feature
status: archived
author-agent: claude-opus-4-7
created: 2026-05-15
updated: 2026-05-16
approved-at: 2026-05-16
completed-at: 2026-05-16
outcome: success-narrow
shipped-scope: "Phases A+B+C+D (narrow ship); Phases C-per-stack §primitive-authoring sections + schema componentsApproved[] + investigate-029 core-6 gate DEFERRED to follow-ups"
ship-commits: ["07cb6fd", "702686c"]
parent-plan: investigate-028-stylesheet-stack-coupling-and-parallelism
supersedes: null
superseded-by: null
branch: feat/stylesheet-split-and-parallelize
affected-files:
  - .claude/skills/stylesheet/SKILL.md
  - .claude/skills/stylesheet-primitives/SKILL.md
  - .claude/skills/agents/front-end/react-next/SKILL.md
  - .claude/skills/agents/front-end/svelte-kit/SKILL.md
  - .claude/skills/agents/mobile/expo-rn/SKILL.md
  - .claude/skills/start-build/SKILL.md
  - .claude/skills/user-flows-generator/SKILL.md
  - schemas/signoff.schema.json
  - orchestrator/src/pipeline.ts
  - orchestrator/src/stage-runner.ts
  - orchestrator/src/stages-array.ts
  - scripts/verify-024.mjs
  - CLAUDE.md
  - .claude/templates/user-flows-template.html
feature-area: design-pipeline
priority: P1
attempt-count: 0
max-attempts: 5
---

# feat-074-stylesheet-split-and-parallelize: split `/stylesheet` framework-agnostic from `/stylesheet-primitives` stack-aware + parallelize the per-primitive loop

## Problem Statement

Today's `/stylesheet` runs pre-`/architect` and writes React `.tsx` primitives/patterns/layouts ~75–90 min before the tech stack is known. Per `plans/active/investigate-028-stylesheet-stack-coupling-and-parallelism.md` (completed 2026-05-15), three findings define the gap:

1. **Pre-architect React-coupling is unjustified.** `/screens`, `/user-flows-generator`, and gate-4 signoff consume the kit's CSS surface only (`tokens.css`, `globals.css`, `data-kit-*` attributes). The `.tsx` is unused until `web-frontend-builder` runs post-architect.
2. **For non-React stacks (svelte-kit, future Vue/Angular/Flutter), the ~90 min of `.tsx` authoring is structurally discarded.** The stack-skill re-authors primitives from the CSS contract. `svelte-kit/SKILL.md:15` already declares this explicitly.
3. **The per-primitive authoring loop is serial today.** 12 primitives + 12 patterns + 5 layouts at ~3 min each ≈ 87 min. Primitives have zero cross-imports (atomic). `/screens` already runs N=8 parallel sub-agents as proven precedent.

The cost: every project currently pays ~75–90 min of pre-architect React-coupling. For non-React stacks, that work is wasted; for React stacks, it's just slow. Operators see a "quiet CLI" between sub-agent dispatches and reasonably believe the run is stalled.

**Scope:** Split `/stylesheet` into two stages with the React-specific work deferred until post-`/architect`, and parallelize the per-primitive authoring loop. Keep the `/stylesheet` name on the framework-agnostic phase per operator preference (saves confusion vs renaming to `/stylesheet-tokens`).

Implements investigate-028 recommendation **B+A** (split + parallelize). Net expected wall-clock: design+architect+primitives drops from ~3h to ~1h.

## Approach

Five phases, ordered so each is independently shippable. Phases A–D are non-breaking (existing projects keep the current shape until Phase E flips the orchestrator). Phase E is the cut-over.

### Phase A — Schema additions (P0, ~2h)

`schemas/signoff.schema.json`:

- Add optional field `componentsApproved: string[]` (component PascalCase names from `.components-plan.json`; not file paths, not rendered .tsx).
- Add optional field `componentsRejected: string[]` (rejected names for next-iteration kit-change-request).
- Both optional → backward-compatible; existing signoff JSONs validate unchanged.

Update `/user-flows-generator` gate-3 backing server (`.claude/templates/user-flows-template.html` POST handler if present; or `.claude/skills/user-flows-generator/SKILL.md` §gate-3 contract) to write the field on approve.

Unit tests: `orchestrator/tests/signoff-schema.test.ts` (extend or author) — assert validity with/without the new fields.

### Phase B — Slim `/stylesheet` to framework-agnostic only (P0, ~4h)

`.claude/skills/stylesheet/SKILL.md`:

- **Keep** steps 1, 2, 3, 4, 5, 6 (tokens + derivatives), 7 (styles/globals/fonts/preview-bootstrap), 8.5 (components catalog), 12 (illustrations), 13 (eslint-plugin rules + validate-consumer.ts + tsconfig.consumer.json), 17 (design-system-preview.html), 18 (finalize+verify — restrict to agnostic verification only: tokens.json schema, globals.css presence, preview-html generated).
- **Drop** steps 8 (lib/cn/cva/motion — moves to Phase D dispatcher prereq), 9 (primitives), 10 (patterns), 11 (layouts), 14 (public barrel), 16 (Storybook build), 18 partial (primitives-shipped check).
- **Update step 17** (design-system-preview.html) to render component shapes using vanilla HTML + Tailwind classes only (no React import). It already does this today per investigate-028 Q1 evidence; verify no regression.
- **Update gate-3 contract** (SKILL.md:1015): gate-3 approves VISUAL contract — `tokens.json`, `tokens.css`, `globals.css`, `design-system-preview.html`, `componentsApproved[]` name list. NOT primitive `.tsx` files (those don't exist yet post-Phase-B).
- **Add a §post-conditions section** declaring what `/stylesheet` no longer produces (primitives/patterns/layouts/barrel/Storybook) so any consuming skill knows to look at `/stylesheet-primitives` for them.

`scripts/verify-024.mjs`: relocate the primitive-existence check OUT of `/stylesheet`'s verify pass; the script is invoked from `/stylesheet-primitives` instead (Phase D).

`.claude/skills/screens/SKILL.md`: Prerequisites section needs a brief addition — "Note: `/stylesheet`'s output does not include framework-specific primitives anymore; those land post-`/architect`. `/screens` consumes the CSS surface only, so this is fine — but kit-change-request enforcement (§ref-here) now compares against `componentsApproved[]` names rather than file existence."

### Phase C — Per-stack `§primitive-authoring` sections (P1, ~8h)

For each existing front-end stack skill, add a new top-level section `§Primitive Authoring (for /stylesheet-primitives dispatcher)`. The section is consumed verbatim by the Phase D dispatcher — operators do NOT invoke it directly.

Each section follows a standard structure:

1. **Input contract** — files the section can assume exist: `packages/ui-kit/src/tokens/tokens.json`, `.components-plan.json`, `docs/selected-style.json`.
2. **Output contract** — files to author per primitive/pattern/layout, naming conventions, framework idioms.
3. **Authoring template** — verbatim per-primitive template (variant shapes, `data-kit-*` attrs, JSDoc, test pattern, Storybook story pattern).
4. **DAG** — primitives (atomic, parallelizable) → patterns (depend on primitives) → layouts (depend on patterns + primitives).
5. **Tail-serialized writes** — public barrel (`src/index.ts`), Storybook config, eslint-plugin rules (if any per-name references).

**Skills to extend:**

- `.claude/skills/agents/front-end/react-next/SKILL.md` — extract steps 9–11 of current `/stylesheet` verbatim. Most lift-and-shift; minor edits for "input is pre-authored tokens.json" instead of "compute tokens here".
- `.claude/skills/agents/front-end/svelte-kit/SKILL.md` — formalize the ad-hoc post-hoc authoring pattern. Svelte 5 runes + `<script setup>`-style components. Maintain `data-kit-*` attribute parity with the React contract.
- `.claude/skills/agents/mobile/expo-rn/SKILL.md` — React Native primitives. Different idiom (Pressable, View, no className → StyleSheet from tokens.json). `data-kit-*` attribute parity becomes test-id parity on RN.

**No new stack skills authored in this phase.** Future stacks (Vue, Angular, Flutter) get a `§primitive-authoring` section when the stack skill itself ships — out of scope for feat-074.

### Phase D — Author `/stylesheet-primitives` dispatcher (P0, ~6h)

`.claude/skills/stylesheet-primitives/SKILL.md` (new):

```
name: stylesheet-primitives
description: Stack-aware authoring of @repo/ui-kit primitives/patterns/layouts.
              Runs post-architect, parameterized by web_framework. Auto-fires
              from the orchestrator on architect:complete. Not operator-invoked
              under normal operation.
```

**Steps:**

1. **Resolve stack-slug.** Read `architecture.yaml.tooling.stack.web_framework`. Fail if missing.
2. **Load the matching `§primitive-authoring` section.** From `.claude/skills/agents/front-end/{slug}/SKILL.md` (or `.claude/skills/agents/mobile/{slug}/SKILL.md` for mobile-only projects).
3. **Read prerequisites.** `packages/ui-kit/src/tokens/tokens.json`, `.components-plan.json`, `docs/selected-style.json`.
4. **Author the lib helpers** (cn.ts, cva.ts, motion.ts). Step 8 of current `/stylesheet`. Single-write, no parallelism.
5. **Phase 1 — Primitives (parallel N=4).** Dispatch 12 primitives across 3 waves of 4 sub-agents. Each sub-agent receives: section template + one primitive's component-plan entry + tokens.json (path). Writes to `packages/ui-kit/src/primitives/{name}/`. Self-verify: file exists, types compile.
6. **Phase 2 — Patterns (parallel N=4).** Same shape, depends on Phase 1 complete. 12 patterns in 3 waves.
7. **Phase 3 — Layouts (parallel N=4).** 5 layouts in 2 waves.
8. **Tail (serial).** Author public barrel (`src/index.ts`), Storybook config (`.storybook/main.ts`), build Storybook, run `verify-024.mjs` against `componentsApproved[]` from gate-3 signoff. If any approved name has no shipped file → return `success: false` with the gap list.

**Return JSON:** `{ stackSlug, primitivesShipped[], patternsShipped[], layoutsShipped[], wallClockMs, parallelFanout, success }`.

**Concurrency cap:** N=4 per investigate-028 Q3 + investigate-019 burst-cap. Configurable via `architecture.yaml.tooling.stylesheet_primitives.fanout` for future tuning.

**Failure model:** any sub-agent dispatch failing → primitives-shipped list omits that name. Tail's verify-024 catches the gap and returns `success: false`. Orchestrator retries per attempt-policy (max 3 per investigate-028 Phase E).

### Phase E — Orchestrator wiring + auto-fire on architect:complete (P0, ~2h)

`orchestrator/src/stages-array.ts` (or wherever the stage ordering lives — likely `pipeline.ts`):

- **Insert** `stylesheet-primitives` stage immediately after `architect` and BEFORE `pm`.
- **Mark** `stylesheet-primitives` as fire-and-await-completion BUT runnable in parallel with gate-5 (operator credentials drop). Orchestrator dispatches the skill on `architect:complete` event; the credentials gate runs concurrently. `pm` waits for BOTH `stylesheet-primitives:complete` AND `credentials-confirmed.txt` to exist.
- **Update** `stage-runner.ts` to track the parallel pair (`stylesheet-primitives` + `gate-5`) as a join-point before `pm`.

`/start-build` SKILL.md: update Mode A stage list to reflect the new ordering. Pre-flight check: refuse to run if `architecture.yaml.tooling.stack.web_framework` is missing (would block the auto-fire). Refuse to run if `/stylesheet-primitives` ran but `success: false` (gap in primitives).

`CLAUDE.md` (project): update the design-pipeline-order paragraph to reflect the new shape:

> `/analyze → /mockups → (gate 2: /pick-style) → /stylesheet → (gate 3) → /screens → /user-flows-generator → (gate 4: design signoff) → /architect → /stylesheet-primitives ‖ (gate 5: credentials, parallel) → /pm → /start-build`

Migration: leave `/stylesheet` as-is (already slimmed in Phase B); the orchestrator simply doesn't run the old monolith. Old in-flight projects whose `/stylesheet` ran the monolithic version are unaffected — they keep their existing kit and run through `/start-build` normally.

## Rejected Alternatives

- **Alternative A — Parallelize only, no split (investigate-028 Option A).** Smaller change; saves the per-primitive serial cost (~60 min) but leaves the cross-stack waste. For Svelte/Vue/Angular/Flutter targets, the React `.tsx` is still authored pre-architect then discarded. **Rejected**: the parallelization is cheap to bundle with the split, and the split unlocks the long-tail framework value. Doing A now means doing B later anyway, with the parallelization needing redesign for the split shape.

- **Alternative B-only — Split, no parallelize.** Defers the wall-clock fix to a later cycle. **Rejected**: parallelization is essentially free once the split is in place (proven precedent in `/screens` at N=8), and operators are already feeling the pain of the serial loop today (the gotribe-tribe-directory run is the empirical motivator). Combining is strictly additive.

- **Alternative C — Stack-agnostic IR + per-stack codegen (investigate-028 Option C).** Highest ceiling — a JSON-Schema'd "primitive description language" rendered into any framework. **Rejected** for v1: ~3× the implementation cost (need to design the IR schema, validate it across at least three frameworks, write per-stack codegen). The factory currently has only 3 shipped front-end stack skills (react-next, svelte-kit, expo-rn) and no project has yet shipped on Svelte. Defer until 2+ non-React projects ship and the codegen amortizes.

- **Alternative D — Rename `/stylesheet` to `/stylesheet-tokens` for clarity.** Operator-explicit rejection: "saves confusion to keep the name `/stylesheet`". The slimmer scope is documented in SKILL.md §post-conditions; downstream consumers reference `/stylesheet` by name regardless. **Rejected** per operator decision 2026-05-15.

- **Alternative E — Run `/stylesheet-primitives` after gate-5 (serial).** Conservative: keeps credentials always-before-primitives. **Rejected**: `/stylesheet-primitives` doesn't need credentials (it consumes `architecture.yaml.tooling.stack.web_framework` only — no API keys, no DB URLs). Running it in parallel with gate-5 saves the operator ~20 min of wall-clock for free.

- **Alternative F — Use `/screens`'s exact N=8 fan-out width.** **Rejected** for v1: investigate-019 advises a more conservative steady-state cap (N=3 base, N=5 burst) for SDK-dispatch workloads. `/stylesheet-primitives` is closer to /screens's load profile than fix-bugs', but starting at N=4 gives headroom while still delivering ~3.2× speedup. The fanout is configurable per `architecture.yaml.tooling.stylesheet_primitives.fanout` for future tuning without code changes.

## Expected Outcomes

- [ ] `/stylesheet` output contains tokens + CSS + globals + Tailwind config + preview-HTML + ESLint rules + illustrations only. No `packages/ui-kit/src/primitives/`, `patterns/`, `layouts/`, no `src/index.ts` barrel (those land in `/stylesheet-primitives`).
- [ ] `/stylesheet-primitives` skill exists and dispatches per `architecture.yaml.tooling.stack.web_framework`. Default `react-next` projects ship `.tsx` primitives. `svelte-kit` projects ship `.svelte` primitives in the same kit directory shape.
- [ ] Orchestrator auto-fires `/stylesheet-primitives` on `architect:complete` without operator invocation. Gate-5 credentials drop runs in parallel; `/pm` waits for both before dispatching.
- [ ] Per-primitive authoring fans out N=4 in parallel inside `/stylesheet-primitives`. Empirical wall-clock for the post-architect primitives phase: ≤30 min on a fresh project with 12 primitives + 12 patterns + 5 layouts.
- [ ] `schemas/signoff.schema.json` accepts optional `componentsApproved[]` and `componentsRejected[]` fields. Existing signoff JSONs (from pre-feat-074 projects) validate unchanged.
- [ ] At least one shipped scratch project end-to-end on the new pipeline: `/new-project test-feat-074 → … → /start-build`. Pre-architect phase wall-clock for `/stylesheet`: ≤15 min. Post-architect `/stylesheet-primitives`: ≤30 min.
- [ ] No regression on in-flight projects (existing kit directories unchanged; existing `/stylesheet` output still parses against the slimmed contract by virtue of being a superset).

## Validation Criteria

**Phase-level checks:**

1. **Phase A** — `pnpm test --filter @repo/orchestrator-contracts -- signoff` passes with new optional fields. Author 4 test cases: (a) signoff without componentsApproved validates, (b) signoff with empty componentsApproved validates, (c) signoff with name list validates, (d) signoff with rejected list validates.

2. **Phase B** — `/stylesheet` run on a scratch project produces tokens + CSS + preview only (assert via `find packages/ui-kit -name '*.tsx' | wc -l` = 0). Pre-architect wall-clock measured ≤15 min.

3. **Phase C** — Per-stack `§primitive-authoring` sections present in all 3 stack-skill SKILL.md files. Manual review (or shell `grep '## Primitive Authoring' .claude/skills/agents/{front-end,mobile}/*/SKILL.md | wc -l` ≥ 3).

4. **Phase D** — `/stylesheet-primitives --stack=react-next` on a scratch project produces 12+ primitives + 12+ patterns + 5+ layouts. Wall-clock ≤30 min at N=4. Repeat with `--stack=svelte-kit` on a separate scratch project; assert `.svelte` files emitted with matching `data-kit-*` attributes.

5. **Phase E** — Orchestrator integration test (`orchestrator/tests/pipeline.test.ts` or `stage-runner.test.ts`): mock the architect:complete event; assert `/stylesheet-primitives` and gate-5 both spawned; assert `/pm` waits for both to converge.

**End-to-end check (gates the feature complete):**

Author a scratch project `test-feat-074-scratch` via `/new-project`, run through the full new pipeline. Measure:

- Pre-architect total (analyze + mockups + stylesheet + screens + user-flows-generator): expected ≤2.5h (today's run takes ~3h).
- Architect → stylesheet-primitives wall-clock: expected ≤30 min.
- No `.tsx` written before `/architect` runs (assert via `find projects/test-feat-074-scratch/packages/ui-kit -name '*.tsx' -newer projects/test-feat-074-scratch/docs/selected-style.json | wc -l` = 0).
- `/start-build` runs end-to-end without errors. The kit imported by builders matches the contract.

**Regression check:** run a previously-shipped project (`projects/reading-log-01` or `projects/gotribe-tribe-directory` once the current /stylesheet run completes) through `/start-build` again. Assert no orchestrator failures from missing primitives or stale skill expectations.

## Phasing + dependencies

- Phase A → B → D → E is the critical path (must be sequential).
- Phase C can run in parallel with Phase B (different files, no merge contention).
- Phase E depends on D being complete (orchestrator wiring needs the dispatcher to exist).

**Estimated total effort: ~22h** (Phase A ~2h + B ~4h + C ~8h + D ~6h + E ~2h). Realistic calendar: 3-4 working days.

## Cross-references

- `plans/active/investigate-028-stylesheet-stack-coupling-and-parallelism.md` — parent investigation; all three findings + composite recommendation.
- `plans/archive/refactor-003-pipeline-reorder-architect-credentials.md` — pipeline-order precedent; iconLibrary inverse-analogy.
- `plans/archive/refactor-006-stylesheet-primitives-contract.md` — the plan that introduced the React lock-in this split corrects.
- `plans/active/investigate-019-sdk-keepalive-stalls-during-parallel-dispatch.md` — fan-out concurrency cap (N=4 is below the empirical burst limit).
- `.claude/skills/screens/SKILL.md:304-321` — proven N=8 parallel dispatch pattern to copy.
- `.claude/skills/agents/front-end/svelte-kit/SKILL.md:15` — precedent statement that the kit's JS is React-only and CSS is universal.
- `.claude/skills/stylesheet/SKILL.md:1015` — current gate-3 `componentsApproved[]` handshake (skill-described, schema-undefined; Phase A closes the gap).

## Attempt Log

<!-- Populated by executing agents per the standard attempt-log format. -->
