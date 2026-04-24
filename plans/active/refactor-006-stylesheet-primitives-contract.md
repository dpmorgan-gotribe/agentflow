---
id: refactor-006-stylesheet-primitives-contract
type: refactor
status: draft
author-agent: claude
created: 2026-04-24
updated: 2026-04-24
parent-plan: feat-013-ui-kit-primitives-shipped
supersedes: null
superseded-by: null
branch: refactor/stylesheet-primitives-contract
affected-files:
  - .claude/skills/stylesheet/SKILL.md
  - scripts/verify-024.mjs
  - schemas/signoff.schema.json
  - plans/templates/refactor-plan.md
feature-area: stylesheet
priority: P1
attempt-count: 0
max-attempts: 5
motivation: "/stylesheet SKILL has shipped across 6 projects without ever generating a single primitive/pattern/layout file. Gap is systemic — next project hits the same empty-primitives state as hatch, hatch-2, gotribe-v1, mindapp, mindapp-v2, runclub, test-app."
---

# refactor-006-stylesheet-primitives-contract: make /stylesheet actually ship primitives — not just claim to

## Current State

`.claude/skills/stylesheet/SKILL.md` (step 10, steps 11-13) describes generating:

- ≥20 primitives under `packages/ui-kit/src/primitives/` with `{Name}.tsx` + `{Name}.variants.ts` + `{Name}.stories.tsx` + `index.ts`
- ≥12 patterns under `packages/ui-kit/src/patterns/`
- ≥5 layouts under `packages/ui-kit/src/layouts/`
- Component coverage aligned to `docs/analysis/shared/components.md`'s canonical list
- Storybook stories for each
- Public barrel `packages/ui-kit/src/index.ts` exporting every primitive

**Actual behavior across 6 projects run through the factory:**

| Project    | Tokens shipped? | Primitives shipped? | Patterns shipped? | Layouts shipped? |
| ---------- | --------------- | ------------------- | ----------------- | ---------------- |
| hatch      | ✅              | ❌ (0)              | ❌ (0)            | ❌ (0)           |
| gotribe-v1 | ✅              | ❌ (0)              | ❌ (0)            | ❌ (0)           |
| mindapp    | ✅              | ❌ (0)              | ❌ (0)            | ❌ (0)           |
| mindapp-v2 | ✅              | ❌ (0)              | ❌ (0)            | ❌ (0)           |
| runclub    | ✅              | ❌ (0)              | ❌ (0)            | ❌ (0)           |
| test-app   | ✅              | ❌ (0)              | ❌ (0)            | ❌ (0)           |
| hatch-2    | ✅ (via copy)   | ❌ (0)              | ❌ (0)            | ❌ (0)           |

The skill's tokens-emission path (step 4 `tokens.json`, step 6 `tokens.css` derivatives) **works reliably**. Downstream Storybook + public barrel + components.md alignment checks are never reached because step 10–12's primitive authoring has no sufficiently prescriptive contract for a subagent to execute.

The gate-3 signoff's `componentsApproved[]` array carries 20–50+ component names, which get tracked as "approved" but have no corresponding files on disk. Downstream consumers (builders) see empty `primitives/`, fall back to hand-rolled plain HTML + Tailwind, and visual fidelity to the design-system-preview drops.

Reviewer playbook §1 doesn't check "primitives shipped for every componentsApproved[]". `scripts/verify-024.mjs` doesn't assert primitive-count. The gap has been invisible until feat-013 surfaced it.

## Desired State

`/stylesheet` emits a working primitive shelf on every run, not just tokens. Specifically:

1. **SKILL.md step 10 is prescriptive enough for a subagent** — not aspirational. Every primitive has a concrete contract: file layout, variant-prop patterns, test pattern, Storybook story pattern, import/export rules. Less "author ≥20 primitives", more "for each entry in `docs/analysis/shared/components.md#canonical-primitives`, apply this template verbatim".
2. **feat-013's hatch-2 kit becomes the reference implementation** — 12–16 primitives shipped there, stylistically bound to Risograph Riot. SKILL.md ports patterns from that reference into stack-agnostic guidance. The variant-prop shapes (Button sizes sm/md/lg, Card header/body/footer slots, FormField composite) are the contract; the style tokens change per project.
3. **verify-024.mjs fails the /stylesheet stage if primitives are missing** — hard gate, not warning. Every component name in `signoff.componentsApproved[]` must have a matching `.tsx` file under `packages/ui-kit/src/{primitives,patterns,layouts}/`. Absent → stage returns `success: false`, orchestrator retries with the gap as context.
4. **signoff schema carries a shipped-vs-approved split** — `componentsApproved[]` stays as the design-time list; a new `componentsShipped[]` field captures which of those were actually authored by the time signoff resolves. Mismatch → signoff rejected at gate 3.
5. **Existing projects aren't retro-patched by this refactor** — hatch through runclub stay where they are (empty primitives). Reference implementation goes to hatch-2 via feat-013; next project through the pipeline gets the new SKILL.md and ships primitives.

## Motivation

Three reasons this needs to happen NOW rather than later:

1. **Every future project hits this today.** Until /stylesheet is fixed, every new project will land in the same empty-primitives state, triggering the same downstream drift (builders fall back to plain HTML, visual fidelity suffers, reviewers don't catch because their playbook doesn't check). We shouldn't ship another hatch-2-class pipeline run without this closed.
2. **The fix benefits from a reference implementation.** Authoring a SKILL.md contract that describes "how to generate a primitive" is easier when we've just done it concretely in feat-013. The shape of Button.tsx/Button.variants.ts/Button.test.tsx in hatch-2 becomes the template SKILL.md documents — not speculative.
3. **verify-024 + signoff-schema changes are small, high-leverage.** 10-line additions to a script + one field on a schema close the systemic gap. Cheap to ship compared to the damage (6 silent-degrade runs and counting).

## Migration Strategy

Sequenced to minimize churn + let feat-013 drive the contract shape.

1. **Depend on feat-013 completing first.** This refactor stays in `draft` until feat-013 ships its 12–16 primitives into hatch-2's kit. That's the reference implementation.
2. **Codify the generalizable parts.** Read feat-013's final primitives + tests + barrel; extract the shape that's stack-agnostic (variant-prop naming, test-file pattern, barrel rules, Tailwind class-composition via `cn` + `cva`). Token values + specific style characteristics (pill radius, riso-orange hover) stay in tokens.css/tokens.json per-project; the CONTRACT is what's generalized.
3. **Rewrite SKILL.md steps 9–12.** Replace the existing aspirational text with a prescriptive per-primitive template plus a canonical-primitives roster derived from `docs/analysis/shared/components.md`. Keep the hybrid-fallback rule (if a primitive is genuinely out of scope for a project, document the skip in a warning; don't silently omit).
4. **Add verify-024 check.** Extend `scripts/verify-024.mjs` to walk `signoff.componentsApproved[]` and assert each has a matching `.tsx` under `packages/ui-kit/src/{primitives,patterns,layouts}/`. Output: the per-component file-exists status, exit non-zero on any miss.
5. **Extend signoff.schema.json.** Add `componentsShipped: string[]` field (required). Update `/stylesheet` to populate it from the actual on-disk files after emission. Signoff at gate 3 rejects if `componentsShipped` is a strict subset of `componentsApproved`.
6. **Update `scripts/verify-refactor-003.mjs` checklist.** Add a line item for "primitives shipped contract enforced" and mark it done once refactor-006 completes.
7. **Test end-to-end on a fresh scratch project.** `/new-project scratch-primitives-test --proposal "minimal marketing site"` → `/analyze` → `/mockups` → `/stylesheet --flags=nanobanana OR whatever`. Verify primitives/ populates. Delete the scratch project after.
8. **Document the SKILL change.** Update `multi-agent-app-generation-blueprint.md` section on the UI-kit stage to reflect the now-enforced primitives contract. Update `docs/lessons.md` with "the quiet failure — six projects shipped tokens-only before this gap surfaced".

## Affected Consumers

| Consumer                   | File                                                               | Change Required                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Stylesheet skill           | `.claude/skills/stylesheet/SKILL.md`                               | Rewrite steps 9–12 with prescriptive per-primitive template                                                                                     |
| Skills audit (build scope) | `.claude/skills/skills-audit/SKILL.md`                             | Minor: add a note that primitive presence is now a /stylesheet contract, not a skills-audit concern                                             |
| Verify-024                 | `scripts/verify-024.mjs`                                           | Extend: walk componentsApproved, assert per-component .tsx exists, exit non-zero on miss                                                        |
| Signoff schema             | `schemas/signoff.schema.json`                                      | Add `componentsShipped: string[]` required field                                                                                                |
| Orchestrator contracts     | `packages/orchestrator-contracts/src/*.ts`                         | Sync the schema change into the Zod contract (mirrors JSON schema)                                                                              |
| Reviewer playbook          | `docs/reviewer-playbook.md`                                        | §1 architecture — add a check that every primitive imported from `@repo/ui-kit` resolves to a shipped file (ties into the build-tier guardrail) |
| Stack skills               | `.claude/skills/agents/front-end/{react-next,svelte-kit}/SKILL.md` | §Idioms — restate "the kit IS shipped and populated by /stylesheet" (remove any tokens-only-era caveats that slip in)                           |
| Factory lessons            | `docs/lessons.md`                                                  | Add entry on the quiet-failure pattern + how verify-024 now catches it                                                                          |
| New-project scaffold       | `.claude/skills/new-project/SKILL.md`                              | No change — scaffold still seeds empty primitives/, /stylesheet populates them                                                                  |

Projects that have already shipped (hatch, gotribe-v1, mindapp-v2, etc.) are **not** retroactively patched. They're locked in their current state for historical audit. If any one of them needs primitives later, it's a per-project feat plan, not a refactor concern.

## Validation Criteria

### SKILL-level

- Reading `.claude/skills/stylesheet/SKILL.md` step 10 gives a subagent unambiguous instructions to generate Button.tsx end-to-end — variant names, prop shapes, `cn`+`cva` composition, a11y attributes, test shape, barrel export.
- The SKILL no longer says "≥20 primitives" in aspiration; it enumerates the 20 canonical primitives by name with per-primitive variant lists referencing the tokens they consume.

### Script-level

- `scripts/verify-024.mjs` with a signoff that lists `componentsApproved: ["Button", "Card"]` but only `packages/ui-kit/src/primitives/Button.tsx` exists → exits non-zero with a message naming `Card` as missing.
- Same script with both files present → exits 0.

### Schema-level

- `schemas/signoff.schema.json` declares `componentsShipped` as a required string array.
- Loading the schema in Zod (via `@repo/orchestrator-contracts`) compiles without errors.
- An existing signoff like hatch-2's `docs/signoff-stylesheet-2026-04-22T00-00-00Z.json` fails validation (missing `componentsShipped`) — confirmed via `node scripts/validate-architecture.mjs` (or the equivalent signoff validator if one exists).
- Adding `"componentsShipped": []` to that file makes it validate again — so the regression path is visible to anyone re-running.

### End-to-end

- Fresh scratch project through `/analyze` → `/mockups` → `/stylesheet` populates `packages/ui-kit/src/primitives/` with the canonical set. Counted by `ls packages/ui-kit/src/primitives/*.tsx | wc -l` ≥ 12.
- `/stylesheet` output JSON includes `componentsShipped[]` matching the actual on-disk files.
- Re-running `/stylesheet` with no input change is a no-op (idempotent per its existing fingerprint contract).

### No regression on existing projects

- hatch-2's bug-001 + feat-013 land independently of this refactor. None of hatch-2's files are touched by this plan.
- Existing hatch, gotribe-v1, etc. signoffs stay as-is; adding `componentsShipped: []` to them is a one-line manual patch each if/when we want them to re-validate, not automated by this refactor.

## Attempt Log

<!-- Populated by executing agent. -->
