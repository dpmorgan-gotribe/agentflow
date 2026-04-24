---
id: feat-013-ui-kit-primitives-shipped
type: feature
status: draft
author-agent: claude
created: 2026-04-24
updated: 2026-04-24
parent-plan: null
supersedes: null
superseded-by: null
branch: feat/ui-kit-primitives-shipped
affected-files:
  - projects/hatch-2/packages/ui-kit/src/primitives/**
  - projects/hatch-2/packages/ui-kit/src/lib/cn.ts
  - projects/hatch-2/packages/ui-kit/src/lib/cva.ts
  - projects/hatch-2/packages/ui-kit/src/index.ts
  - projects/hatch-2/packages/ui-kit/package.json
  - projects/hatch-2/apps/web/components/case-study-card.tsx
  - projects/hatch-2/apps/web/components/hero-statement.tsx
  - projects/hatch-2/apps/web/components/package-tier.tsx
  - projects/hatch-2/apps/web/components/team-grid.tsx
  - projects/hatch-2/apps/web/components/testimonial-card.tsx
  - projects/hatch-2/apps/web/app/contact/contact-form.tsx
  - .claude/skills/stylesheet/SKILL.md (factory follow-up, small)
feature-area: ui-kit
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-013-ui-kit-primitives-shipped: author the 15 core kit primitives + migrate hatch-2 to consume them

## Problem Statement

Gate-3 signoff for hatch-2 (`docs/signoff-stylesheet-2026-04-22T00-00-00Z.json`) lists **52 approved components** — 20 canonical (Button, Input, Card, etc.) + 32 project-specific compositions (CaseStudyHero, HeroStatement, etc.). But `packages/ui-kit/src/primitives/` is **empty** — `/stylesheet` shipped only tokens, never the React components.

This surfaced as **bug-001-design-token-drift**'s Layer B concern: when feat-marketing-pages ran, the builder had nothing to import from `@repo/ui-kit`, so it wrote plain HTML + Tailwind utility strings instead. The result: `apps/web/components/*.tsx` exists as hand-rolled components that duplicate variant logic the kit should own, don't share tokens through a clean import surface, and carry TODO comments saying "swap for kit primitives once kit ships beyond tokens". The ui-kit's public barrel exports nothing usable.

This feature ships the 15 core primitives + migrates hatch-2's existing hand-rolled components to consume them. It also updates `/stylesheet` SKILL.md with a small addendum so future projects don't hit the same gap.

Bug-001-design-token-drift (Layer A) fixes the token-import bug in `apps/web/app/globals.css` — it's independent of this feat plan. Both plans can ship in either order; this plan doesn't depend on bug-001.

## Approach

### Phase 1 — Kit foundation

1. Add `packages/ui-kit/src/lib/cn.ts` — clsx + tailwind-merge composition (the canonical utility the stack skill names).
2. Add `packages/ui-kit/src/lib/cva.ts` — class-variance-authority re-export + preferred `cva` factory wrapper.
3. Update `packages/ui-kit/package.json` — add deps: `class-variance-authority@^0.7.1`, `clsx@^2.1.1`, `tailwind-merge@^2.5.5`. Dev: `@testing-library/react`, `vitest`, `@types/react`.
4. Keep `package.json.version` as `0.1.0-tokens-only` for now — bump to `0.2.0-primitives` on success of this feature (so downstream consumers see the shift via ui_kit_version in future signoffs).

### Phase 2 — Core primitives (12, must-ship)

For each: `{Name}.tsx` + `{Name}.variants.ts` + `{Name}.test.tsx` + index-barrel export. Variant logic honors the **Risograph Riot** style (pill radius, riso-orange primary, overprint-blue hover offset, Bricolage/Space-Grotesk typography) as baked-in defaults — future projects with different styles override via tokens.css.

1. **Button** — primary | secondary | ghost | destructive × sm | md | lg × icon-only | with-icon × disabled | loading. Pill radius (28px) per style. Primary hover = `box-shadow: 4px 4px 0 var(--color-secondary-500)` (riso overprint).
2. **Input** — default | with-error | with-icon × disabled. `aria-describedby` auto-linked to error slot.
3. **Textarea** — default | with-error × auto-resize. Same shape contract as Input.
4. **Select** — native `<select>` with ui-kit styling via `appearance-none` + custom chevron.
5. **Checkbox** — default | checked | indeterminate | disabled. Riso-blue checked fill.
6. **Radio + RadioGroup** — default | disabled. Keyboard nav within group via `role="radiogroup"`.
7. **Card** — default | interactive (hoverable) × header | body | footer slots. Sharp corners (no radius — style's characteristic).
8. **Badge** — default | accent | secondary | highlight × sm | md. Pill.
9. **Avatar** — with image | initials fallback × sm | md | lg.
10. **Separator** — horizontal | vertical × subtle | default | strong.
11. **Tabs** — default × underline | pills variants. Keyboard arrow-nav + aria-selected.
12. **FormField** — composite: label + (Input|Textarea|Select) + error + hint. Ties into React Hook Form via `register()` pattern but doesn't hard-depend on RHF.

### Phase 3 — Extended primitives (4, nice-to-ship)

If time + LOC budget allow:

13. **Breadcrumbs** — list of links with `/` separator.
14. **EmptyState** — icon slot + heading + description + action slot. Used on work-index empty-filter.
15. **PageHeader** — title + description + actions. Used on about + work-index.
16. **Notification** — info | success | warning | danger. Used for contact-form confirmation.

### Phase 4 — Public barrel

`packages/ui-kit/src/index.ts` exports every primitive. Also re-exports tokens as `tokens` runtime object + `cn` utility. This is the ONLY consumer import surface per task-022b contract (no deep imports allowed).

### Phase 5 — Migrate hatch-2 consumers

Replace plain-HTML patterns in existing files with kit-primitive imports:

- `apps/web/components/case-study-card.tsx` — use `<Card>` instead of `<article className="rounded-...">`
- `apps/web/components/hero-statement.tsx` — use `<Button>` for CTAs
- `apps/web/components/package-tier.tsx` — use `<Card>` + `<Badge>` + `<Button>`
- `apps/web/components/team-grid.tsx` — use `<Avatar>`
- `apps/web/components/testimonial-card.tsx` — use `<Card>` (+ optional `<Avatar>` for attribution photo)
- `apps/web/app/contact/contact-form.tsx` — use `<FormField>` + `<Input>` + `<Textarea>` + `<Select>` + `<Button>` + `<Checkbox>` (honeypot still hidden via `<input type="checkbox" hidden>`)
- Remove the TODO-swap-for-kit comments from each file

### Phase 6 — Verify

- `pnpm --filter @repo/ui-kit test` — new primitive tests pass (≥12 tests, 1 per primitive)
- `pnpm --filter @hatch-2/web typecheck` — app still typechecks after migration
- `pnpm --filter @hatch-2/web test` — existing 92 tests still pass (migrations may require small test-side updates if they assert DOM structure that changed)
- `pnpm --filter @hatch-2/web build` — still builds
- `pnpm --filter @hatch-2/web dev` — visual inspection: pages render with kit primitives; Riso style now visible in buttons (pill + riso hover)

### Phase 7 — Factory-level follow-up (small addendum)

Update `.claude/skills/stylesheet/SKILL.md` step 9–11 (the primitives/patterns/layouts section): add a hard check at the end of the skill — "self-verify: `ls packages/ui-kit/src/primitives/*.tsx | wc -l` returns ≥12 OR append `warnings[]` entry `primitives-not-shipped`". This closes the root-cause gap for future projects. (Fixing /stylesheet fully is out of scope — a proper refactor is tracked as a separate plan; this is just an alarm.)

## Rejected Alternatives

- **Alternative A — Ship all 52 signed-off components in this plan** — Rejected. The 32 project-specific compositions (CaseStudyHero, StudioManifesto, etc.) already exist as `apps/web/components/*.tsx` from feat-marketing-pages. Rebuilding them inside the kit doesn't add value for a single project; if future projects need these as kit primitives, promote them then. Scope this plan to the 20 canonical (minus Dialog/Drawer/Popover/Tooltip/Slider/Switch/Accordion/Toast/Skeleton — not referenced by any hatch-2 screen; defer).

- **Alternative B — Fix `/stylesheet` SKILL.md to emit primitives automatically for ALL future projects before shipping for hatch-2** — Rejected. That's a substantive refactor of the design pipeline stage (3–5 hours of SKILL.md authoring + verify-024 check + scaffolding 024 updates) before any concrete code moves. Ship hatch-2's kit directly first; the factory-level fix becomes a follow-up refactor plan with a proven reference implementation.

- **Alternative C — Use an off-the-shelf component library (Radix UI / shadcn/ui / HeroUI) instead of hand-authoring** — Rejected. The kit's value is being style-bound — a Risograph Riot primitive looks nothing like a Stripe Connect primitive. Off-the-shelf libraries have their own aesthetic built in; importing them means fighting their defaults with overrides. The kit's 0.1.0-tokens-only version already ships the right tokens; authoring the primitive surface on top is straightforward. Reconsider if a future style of sufficient complexity needs primitives with behaviors we'd rather not rebuild (focus-trap Dialog, floating Popover, etc.) — then wrap Radix primitives with kit styling, but that's a specific decision per component, not a wholesale library adoption.

- **Alternative D — Skip migration of existing `apps/web/components/*.tsx`** — Rejected. Shipping the kit without migrating the app's consumers means the 12 primitives are unused. The visual drift in bug-001 Layer A would be only partially fixed (tokens-only). Migration is ~10 small diffs per file; doing it in this plan keeps the handoff clean + surfaces any kit-API gaps immediately.

## Expected Outcomes

- [ ] `packages/ui-kit/src/primitives/` has ≥12 `.tsx` files with variant logic
- [ ] `packages/ui-kit/src/lib/cn.ts` + `cva.ts` exist
- [ ] `packages/ui-kit/src/index.ts` public barrel exports every primitive + tokens + cn utility
- [ ] Every primitive has a `{Name}.test.tsx` with ≥1 render test + ≥1 variant test
- [ ] `packages/ui-kit/package.json` deps updated (clsx, tailwind-merge, class-variance-authority)
- [ ] `packages/ui-kit/package.json.version` bumped to `0.2.0-primitives`
- [ ] `apps/web/components/{case-study-card,hero-statement,package-tier,team-grid,testimonial-card}.tsx` + `apps/web/app/contact/contact-form.tsx` consume kit primitives via `@repo/ui-kit` barrel import
- [ ] TODO-swap-for-kit comments in those files removed
- [ ] Cross-app test counts: kit adds ≥12 new tests; hatch-2 web stays green at ≥92 (migrations may adjust DOM assertions)
- [ ] `pnpm --filter @hatch-2/web build` still passes
- [ ] `.claude/skills/stylesheet/SKILL.md` has a primitives-shipped self-verify check (warning, not abort)

## Validation Criteria

### Kit test suite (new)

- ≥12 test files under `packages/ui-kit/src/primitives/*.test.tsx`
- Each primitive tested: renders with canonical props, rejects/accepts expected variant values, a11y attributes present (aria-label on icon-only, aria-describedby on FormField error)

### hatch-2 app regression

- `pnpm --filter @hatch-2/web typecheck` exit 0
- `pnpm --filter @hatch-2/web test` — ≥92 pass (the pre-migration baseline)
- `pnpm --filter @hatch-2/web build` — 14 static routes, no build errors, First Load JS within 10% of pre-migration (bundle-size guardrail)

### Visual contract (manual)

- `pnpm --filter @hatch-2/web dev` + open http://localhost:3000 — primary CTA button shows pill radius + riso-orange primary + overprint-blue offset on hover (vs current plain rounded-sm orange with no hover identity)
- Form on /contact renders with `<FormField>` composites — label + input + error slot structure visible
- `apps/web/components/*.tsx` source: zero remaining `TODO: swap plain elements for @repo/ui-kit primitives` comments
- Grep check: `grep -rE "className=\"[^\"]*\brounded-\b" apps/web/components/ apps/web/app/` — reduced by ≥50% (kit components now own the rounded treatment)

### Factory follow-up

- `.claude/skills/stylesheet/SKILL.md` contains a step (or clear addendum) that runs after primitive emission: "If `ls packages/ui-kit/src/primitives/*.tsx | wc -l` < 12, append `warnings[]: 'primitives-not-shipped — signed-off components referenced by gate-3 are aspirational; downstream builders will fall back to plain HTML'`".

## Attempt Log

<!-- Populated by executing agent. -->
