---
id: bug-114-screens-routepattern-population
type: bug
status: archived
author-agent: human
created: 2026-05-16
updated: 2026-05-16
approved-at: 2026-05-16
completed-at: 2026-05-16
outcome: success
parent-plan: bug-113-walkthrough-cascade-root-linkage
supersedes: null
superseded-by: null
branch: fix/screens-routepattern-population
affected-files:
  - .claude/skills/screens/SKILL.md
  - .claude/skills/pm/SKILL.md
feature-area: factory/screens-manifest-routepattern
priority: P1
attempt-count: 1
max-attempts: 5
error-message: null
reproduction-steps: |
  1. Scaffold + ship a project through Mode A → Mode B (`/screens` populates docs/screens-manifest.json).
  2. Inspect manifest: every files[] entry has `path`, `platform`, `screenId`, `sha256` but `routePattern` is OMITTED.
  3. Run /build-to-spec-verify. parity-verify resolves the live build URL via `resolveBuiltUrl` (orchestrator/src/parity-verify.ts). Without routePattern, step 5 falls back to `/{screen-id}` heuristic.
  4. Screen-id `tribe-directory-browse` → URL `http://localhost:3000/tribe-directory-browse` → Next.js 404.
  5. Tier 4 perceptual files bug "page-not-found" against the screen. Tier 3 parity files cascade "shell-stripping" + "layout-regrouping" findings (all from comparing mockup against the 404 page).
  6. /fix-bugs dispatches web-frontend-builder 3× per bug; none can fix a manifest-authoring gap, all fail at attempts 3/3. Per gotribe-tribe-directory 2026-05-15: ~$15 spent on 4 cascade bugs that one manifest edit would have prevented.
stack-trace: null
---

# bug-114-screens-routepattern-population: /screens skill omits routePattern from screens-manifest, producing verifier 404-cascade class

## Bug Description

`/screens` SKILL.md §8 documents the screens-manifest.json shape with a `files[]` example that omits `routePattern`. The skill agent follows the example verbatim and ships projects with no routePattern populated. Downstream verifier stages (parity-verify Tier 3 + perceptual-review Tier 4 + walkthrough-review Tier 5) all consume `routePattern` to know which URL to visit on the live build. When absent, `parity-verify.ts resolveBuiltUrl` falls back to `/{screen-id}` heuristic (line 333-337) — which produces non-existent URLs for any screen whose id doesn't match a real route.

Empirical motivator: `projects/gotribe-tribe-directory/` 2026-05-16 — every entry in `docs/screens-manifest.json` has `routePattern` omitted. The 3 screens (`tribe-directory-browse`, `tribe-detail`, `tribe-directory-empty-state`) all map to URLs that don't exist in the built app (`/`, `/tribes/:slug`, and `/?focus=*` respectively). The verifier visits `/tribe-directory-browse` → 404, `/tribe-detail` → 404, `/tribe-directory-empty-state` → 404 → bug-fix loop spent ~$15 dispatching web-frontend-builder 12× across 4 cascading false-positive bugs.

The pm SKILL.md §2c (bug-025) ALREADY emits a warning when routePattern is missing per-task. The warning didn't help — it appears in `tasks.yaml.warnings[]` but isn't load-bearing; gates pass with warnings present. By the time PM fires, the screens are already authored without the field; the gap is upstream at `/screens`.

## Root Cause Analysis

Two upstream gaps:

1. **`/screens` SKILL.md §8 manifest example omits `routePattern`.** The shape shown is `{ path, sha256 }`-only. The schema (`schemas/screens.schema.json`) marks `routePattern` as `optional`, so the agent's output is technically valid — but downstream consumers (parity-verify, perceptual-review, walkthrough) rely on it being populated to produce useful results.

2. **No `/screens` self-verify gate.** The skill writes the manifest without checking that every entry has routePattern. Even if §8 named the requirement in prose, an agent that misreads the example would still ship a broken manifest. The cheapest detection layer (failing in `/screens` itself) wasn't wired.

3. **PM SKILL.md §2c was warning-only, not error.** When a project ships with a manifest lacking routePattern, the PM stage emits `tasks.yaml.warnings[]: missing-route-pattern: ...` but gate 4 doesn't treat warnings as blockers. The pipeline proceeds to Mode B with the broken manifest in place.

## Fix Approach

Two SKILL.md patches on adjacent layers. Both ship together in one PR.

### Patch A — `/screens` SKILL.md §8 populates routePattern + self-verifies

`.claude/skills/screens/SKILL.md` §8:

1. Updated the inline manifest example to show `routePattern` on every `files[]` entry — both static (`/`) and dynamic (`/?focus=:focus`) forms.
2. Added a paragraph at the start of §8 declaring `routePattern` MANDATORY on every entry, naming the empirical motivator (gotribe-tribe-directory 2026-05-16) + the downstream consumers (parity-verify, perceptual-review, walkthrough-review).
3. Added a 5-rule derivation guide:
   - First screen of each user flow → `/` (the home/entry route)
   - `<noun>-detail` / `<noun>-edit` → `/{noun}/:slug` or `/{noun}/:id`
   - `<noun>-filtered` / `<noun>-empty-state` → same as base noun route + query params
   - Auxiliary pages (`about`, `contact`, etc.) → `/<kebab-screen-id>`
   - When in doubt: `/{kebab-screen-id}` + emit a `tasks.yaml.warnings[]` for operator review at gate 4
4. Documented dynamic-segment syntax (colon-prefixed `:slug` / `:id`; builders translate to stack-specific syntax at code-gen time).
5. Added a self-verify gate at end of §8: `assert files.every(f => typeof f.routePattern === "string" && f.routePattern.length > 0)`. Fails before writing the manifest.

### Patch B — `/pm` SKILL.md §2c upgrades warning to hard error

`.claude/skills/pm/SKILL.md` §2c:

Documented bug-114 upgrade: missing-route-pattern is now HARD-FAILED at gate 4, not warned. The pm skill MUST surface missing-routePattern entries in `tasks.yaml.errors[]` (not `warnings[]`) so the orchestrator's gate-4 validator treats them as a block. Operator unblock recipe documented: re-run `/screens` OR hand-edit the manifest with the §8 heuristics.

The pm-stage check is defense-in-depth: `/screens` Patch A catches the issue at design time (cheapest layer), but if `/screens` is bypassed or the manifest is hand-edited, pm catches it at task-generation time.

### Patch C (deferred to follow-up bug if empirically needed)

Schema-level enforcement — change `schemas/screens.schema.json` `routePattern: optional` to `required`. This is a breaking change for any project whose manifest was generated pre-bug-114 (e.g. gotribe-tribe-directory itself). Migration recipe needed: orchestrator at re-entry detects missing routePattern in legacy manifests + offers operator-prompted re-run of `/screens` to back-fill. Deferred because (a) Patches A + B cover new projects, (b) the warning-style detection in Patch B already nudges legacy operators, (c) schema-required without migration would brick existing projects on next CI run.

## Rejected Fixes

- **R1 — Auto-discover routePattern from `apps/web/app/` tree at verify time.** Rejected because `/screens` runs at DESIGN time, BEFORE the builder authors page files. The manifest is the SOURCE OF TRUTH for "which URL renders this screen"; the builder reads it to know where to put the page file. Inverting the flow makes the contract unidirectional in the wrong way.

- **R2 — Make `parity-verify.ts resolveBuiltUrl` smarter (try `/` as fallback before `/{screen-id}`).** Rejected because the existing fallback chain is already 5 deep; adding another layer compounds heuristic mismatches and masks the actual gap (missing routePattern in manifest). Better to fail loud at the design-time layer than silently work around it downstream.

- **R3 — Auto-fix gotribe-tribe-directory's manifest as part of this bug.** Rejected per operator-explicit scoping (option (c) chosen 2026-05-16): factory-only ship; gotribe-tribe-directory stays at its current state. Project-side hand-fix is a separate operator action if/when they want to re-verify.

- **R4 — Split into 2 separate bug plans.** Rejected because Patches A + B share one motivator (gotribe-tribe-directory) + target one defect axis (missing routePattern enforcement) + ship in adjacent SKILL.md sections. One plan, two patches.

## Validation Criteria

- [x] `.claude/skills/screens/SKILL.md` §8 declares routePattern MANDATORY, includes 5-rule derivation guide, names a self-verify gate.
- [x] `.claude/skills/pm/SKILL.md` §2c documents the warning → error upgrade with operator unblock recipe.
- [x] Manifest example in §8 shows routePattern on every files[] entry.
- [ ] Future `/screens` invocation on a new project produces a manifest with routePattern populated on every entry (will validate empirically when the next project ships).
- [ ] gotribe-tribe-directory's existing manifest stays as-is per operator scope decision; no project-side hand-fix shipped under bug-114.

## Attempt Log

### Attempt 1 — 2026-05-16 — shipped Patches A + B in one PR

**What changed:**

- `.claude/skills/screens/SKILL.md` §8 — added routePattern requirement paragraph + 5-rule derivation guide + dynamic-segment syntax doc + self-verify gate. Manifest example updated to show routePattern on every entry.
- `.claude/skills/pm/SKILL.md` §2c — documented bug-114 upgrade (warning → error). Operator unblock recipe for legacy projects added.

**Validation:**

- These are markdown SKILL prompts, not code. No unit tests apply.
- Empirical validation deferred to the next project that ships through `/screens` (will produce a manifest with routePattern populated).

### Lessons

1. **Markdown example shapes drive agent behavior.** The §8 manifest example showed `{ path, sha256 }`-only and that's exactly what shipped projects had. Schema-level optionality let the gap survive code review. Lesson: SKILL.md examples are authoritative even when the schema disagrees; align them or one of the two will lose.

2. **Warning-only validation isn't load-bearing.** PM SKILL.md §2c had a warning for missing routePattern for ~6 months pre-bug-114. The warning was emitted; the gate didn't check; the pipeline shipped broken manifests. Either upgrade warnings to errors or accept that they don't enforce.

3. **Defense-in-depth across pipeline stages is correct.** Even though `/screens` Patch A is the cheapest detection layer, Patch B's PM upgrade adds defense for projects whose `/screens` was bypassed or manifest was hand-edited. Same shape as bug-091's three-layer protection (agent prompt + rules doc + mechanical check) — apply here as two-layer (skill prompt + PM validation).

### Cross-references

- bug-025 (factory-wide, archived) — original routePattern-as-screen-property feature. Added the field to the schema but didn't enforce its population.
- bug-066 (factory-wide, archived) — `parity-verify.ts resolveBuiltUrl` consumes routePattern. Built before bug-025 + bug-114 fully closed the authoring gap.
- bug-113 (today, archived) — walkthrough cascade-root linkage. Adjacent factory bug; same empirical motivator (gotribe-tribe-directory verifier round 2).
- gotribe-tribe-directory project (2026-05-15/16) — the empirical motivator. 4 of 11 bug-fix-loop failures cascade from this gap. Per operator scope, project-side hand-fix is NOT shipped under bug-114 — factory-only.
