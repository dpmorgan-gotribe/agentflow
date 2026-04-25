---
id: bug-001-design-token-drift
type: bug
status: completed
author-agent: claude
created: 2026-04-24
updated: 2026-04-24
completed-at: 2026-04-24
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/design-token-drift
affected-files:
  - projects/hatch-2/apps/web/app/globals.css
  - projects/hatch-2/apps/web/tailwind.config.ts
  - projects/hatch-2/packages/ui-kit/src/tokens/tokens.css
  - projects/hatch-2/packages/ui-kit/src/tokens/tokens.json
  - projects/hatch-2/packages/ui-kit/src/index.ts
  - .claude/skills/agents/front-end/react-next/SKILL.md
feature-area: design-build-handoff
priority: P0
attempt-count: 0
max-attempts: 5
error-message: null
reproduction-steps: "Run hatch-2 dev server + compare rendered site against docs/design-system-preview.html"
stack-trace: null
---

# bug-001-design-token-drift: built site ignores design-system tokens + primitives

## Bug Description

**Expected** (per gate-3 design-system signoff + `docs/design-system-preview.html`): the hatch-2 build should render with the Risograph Riot style's palette, typography, and component treatments:

- Cream background (`#FFFBF2`) not white
- Riso-orange accent (`#F24E1E`) as primary brand color
- Bricolage Grotesque + Space Grotesk + Fraunces typography
- A real logo / brand mark (or at minimum a styled wordmark)
- Components visibly derived from the 50+ primitives listed in `docs/signoff-stylesheet-*.json.componentsApproved[]` (Button, Card, HeroStatement, etc.)

**Actual** (rendered at `http://localhost:3000` after `pnpm --filter @hatch-2/web dev`):

- White background (`#ffffff`)
- Generic orange accent (`#ff5a00`) — close to but NOT the style's riso-orange
- System sans-serif fonts (ui-sans-serif stack) — none of the Google Fonts the style specified
- Logo is the string "hatch" rendered in a generic font-display class — no designed mark
- Pages use plain HTML + ad-hoc Tailwind utility strings, not kit primitives

The site functions (8/8 routes return 200, 92/92 tests pass) but looks nothing like what was signed off at gate 3. The gap is visible within 2 seconds of loading the home page.

## Reproduction Steps

1. `cd projects/hatch-2 && pnpm --filter @hatch-2/web dev`
2. Open <http://localhost:3000> in a browser
3. Open `projects/hatch-2/docs/design-system-preview.html` in a second tab
4. Compare the hero background color — one is white, one is cream
5. Compare the accent button color — one is stock orange, one is riso-orange `#F24E1E`
6. Inspect the page's `<head>` — no `<link rel="stylesheet">` or `<link rel="preconnect">` to Google Fonts
7. Grep the site nav: `grep -r "hatch" projects/hatch-2/apps/web/components/site-nav.tsx` — the logo is a plain `<Link>hatch</Link>`

## Error Output

No runtime errors. This is a visual + contract drift, not a crash.

Direct evidence of the root cause:

```bash
# Real tokens DO exist and carry the Risograph Riot palette:
head -10 projects/hatch-2/packages/ui-kit/src/tokens/tokens.css
# → --color-accent-500: #f24e1e; (riso orange)

# But the web app's globals.css REDEFINES them with generic placeholders
# instead of IMPORTING the kit's tokens.css:
head -20 projects/hatch-2/apps/web/app/globals.css
# → --color-surface-base: #ffffff;  (white, not cream)
# → --color-accent-500: #ff5a00;    (generic, not riso)
# → font-sans: ui-sans-serif, system-ui, ...  (not Bricolage Grotesque)
# → Comment: "Hatch's ui-kit is 0.1.0-tokens-only — tokens are declared here
#            until the kit ships a tokens.css file."
#   ↑ FALSE assumption — tokens.css HAS been shipped, just never imported.

# Primitives are empty — design-system-preview referenced 50+ components,
# but nothing was actually generated:
ls projects/hatch-2/packages/ui-kit/src/primitives/
# → (empty)
```

## Root Cause Analysis

Three overlapping root causes, in order of severity:

### RC1 (primary — direct cause of the visual drift)

`projects/hatch-2/apps/web/app/globals.css` redefines `:root` CSS custom properties with **placeholder values** (white, generic orange, system fonts) instead of `@import`-ing `@repo/ui-kit/src/tokens/tokens.css`, which **does ship** the full Risograph Riot palette including:

- `--color-accent-500: #f24e1e` (riso orange)
- `--color-neutral-50: #fffbf2` (cream surface)
- `--color-secondary-500: #3b1fbe` (overprint blue)
- `--color-highlight-500: #ffeb3b` (sticker yellow)
- Full typography scale + Bricolage/Space Grotesk/Fraunces families

**This was introduced in feat-scaffold** (commit `0bf02a3`) when I wrote the initial scaffold. I added a comment saying "Hatch's ui-kit is 0.1.0-tokens-only — tokens are declared here until the kit ships a tokens.css file" — but `tokens.css` had already been shipped by `/stylesheet`. The scaffold author (me) didn't check before writing the placeholder block.

### RC2 (secondary — why builders fell back to plain HTML)

`packages/ui-kit/src/primitives/` (and `patterns/`, `layouts/`) are **empty directories**. `/stylesheet` generated the tokens but did NOT emit the primitives listed in the gate-3 `componentsApproved[]` (Button, Card, HeroStatement, etc.). The consumer contract (`@repo/ui-kit` public barrel) exports nothing consumable.

When feat-marketing-pages was dispatched, I explicitly told the subagent to "take option (b) — plain HTML + tailwind token bridge" because the primitives weren't shipped. So the builder did the right thing given the constraint; the constraint itself is the bug.

### RC3 (tertiary — no logo asset)

No logo SVG / raster asset exists in `projects/hatch-2/assets/logos/`. The design pipeline never produced a brand mark. `docs/asset-inventory.json.logos` is likely empty or absent. Builders rendered the string "hatch" in the display font as a best-effort wordmark.

### Why the factory let this through

- `/stylesheet` claims to produce an N×M×kit with primitives but shipped only tokens. The verify-024 script didn't catch this (or was lenient on empty primitive dirs).
- The gate-3 signoff lists `componentsApproved[]` as 50+ component names — aspirational not shipped. No gate-3 verifier checks that every listed component has a matching file under `packages/ui-kit/src/primitives/` or `patterns/`.
- The react-next stack skill's `§Idioms` says "`@repo/ui-kit` is the ONLY component source." but doesn't say what to do when the kit's primitives don't exist.
- The reviewer playbook's §1 architecture checks don't include "kit primitives exist for every signed-off component name".

## Fix Approach

Three layers, each smaller-than-the-last scoped. Start at layer A (unblocks the visual bug); decide on B + C based on user priorities.

### Layer A (fast fix — makes hatch-2 look right)

1. Edit `projects/hatch-2/apps/web/app/globals.css`: delete the hardcoded `:root` block, replace with `@import "@repo/ui-kit/tokens";` (resolves to `packages/ui-kit/src/tokens/tokens.css` via workspace path). If workspace `@import` path resolution is flaky through PostCSS, use a direct relative import: `@import "../../../../packages/ui-kit/src/tokens/tokens.css";`.
2. Verify `projects/hatch-2/apps/web/tailwind.config.ts` references the same CSS vars the kit's `tokens.css` actually declares (my scaffold used names like `--color-surface-base` but the kit uses `--color-neutral-50` for cream). Map them correctly.
3. Ensure Google Fonts are loaded — add `<link rel="preconnect">` + `<link>` tags to `apps/web/app/layout.tsx` or use `next/font/google` with Bricolage Grotesque + Space Grotesk + Fraunces.
4. Verify in browser: hero shows cream background + riso-orange accent + the style's typography.

**Acceptance**: opening hatch-2 and design-system-preview.html side by side shows matching palette + typography within tolerance.

### Layer B (ship the kit primitives — unblocks future projects too)

1. Author `packages/ui-kit/src/primitives/{Button,Card,Input,...}.tsx` for at least the 10–15 core primitives that the signed-off `componentsApproved[]` names.
2. Emit the public barrel `packages/ui-kit/src/index.ts` exporting each primitive.
3. Migrate hatch-2 marketing-pages to consume `<Button>`, `<Card>`, etc. from the kit instead of plain HTML.
4. This is a NEW feature (`feat-014-ui-kit-primitives-shipped` or similar), not a bug fix. Spawn a separate plan.

**Acceptance**: every component name in `docs/signoff-stylesheet-*.json.componentsApproved[]` has a corresponding `.tsx` file under `packages/ui-kit/src/{primitives,patterns,layouts}/`.

### Layer C (factory-level — prevent this class of bug)

1. Add a factory-level check to `scripts/verify-024.mjs` (or a new `scripts/verify-design-system-shipped.mjs`): for every component name in `docs/signoff-stylesheet-*.json.componentsApproved[]`, assert there's a matching file under `packages/ui-kit/src/{primitives,patterns,layouts}/`. Fail the stage if ANY component is missing.
2. Add a reviewer-playbook check (new §8 or addendum to §1 architecture): for every app in `architecture.yaml.apps.*`, `grep -q "@repo/ui-kit/tokens" apps/{app}/app/globals.css` (or the stack-skill's equivalent path). Zero hits + non-empty primitives dir → fail `needs-revision: web-frontend-builder`.
3. Update the react-next stack skill's `§Idioms` to explicitly say "import `@repo/ui-kit` tokens at the app's global stylesheet boundary — never redefine CSS vars in the app".
4. Document in the factory's lessons (`docs/lessons.md`) the "scaffold-wrote-placeholder-tokens-instead-of-import" anti-pattern.

**Acceptance**: re-running the factory end-to-end on a fresh project produces a site that matches its own design-system-preview without human intervention.

## Rejected Fixes

- **Fix α — revert feat-scaffold and re-scaffold from a stack-skill-enforced template** — Rejected. feat-scaffold's structure is fine (package.json, tsconfig, next.config, route layout); only the `globals.css` token block is wrong. A two-line diff fixes it (delete hardcoded block, add `@import`) without a full re-scaffold.

- **Fix β — manually author primitives in this bug plan** — Rejected. Authoring 10–15 React components + variants + stories + tests is easily 2000+ LOC, well beyond a bug fix. Split to feat-014.

- **Fix γ — retroactively generate a logo with image-gen** — Rejected for this bug's scope. A bug plan shouldn't author new design assets; that's a brief/design-pipeline loop. Surface to user as a separate gap.

- **Fix δ — leave Layer A as "known issue" and only fix C (factory prevention)** — Rejected. The user is staring at a broken-looking hatch-2 today; fixing future projects without fixing the current one is the wrong order.

## Validation Criteria

Layer A (primary, blocking):

- [ ] `projects/hatch-2/apps/web/app/globals.css` does NOT redefine `--color-accent-500` / `--color-surface-*` / font families in its own `:root` block
- [ ] It DOES `@import` or reference `packages/ui-kit/src/tokens/tokens.css`
- [ ] `pnpm --filter @hatch-2/web dev` + visual inspection: hero background = cream (`#fffbf2`), primary accent button = riso orange (`#f24e1e`), body font = Space Grotesk (or `-webkit-font-family-set` shows it)
- [ ] `92/92` vitest tests still pass (no regression)
- [ ] `next build` still succeeds
- [ ] Diff against `docs/design-system-preview.html` — palette + typography match within tolerance

Layer B + C: out-of-scope for this bug plan; tracked in follow-up plans.

## Attempt Log

<!-- Populated by executing agent. -->

## Attempt log

### Attempt 1 — 2026-04-24 — completed across three layers

All three layers of the fix approach shipped via a plan-triage sequence.

**Layer A — hatch-2 globals.css token import** (hatch-2 commits 31b3439 + d6083b3, 2026-04-24)

- apps/web/app/globals.css: deleted the hardcoded `:root` placeholder block; added `@import "../../../packages/ui-kit/src/tokens/tokens.css";` at the top (3-up relative path, not 4-up — count bug caught by build).
- apps/web/tailwind.config.ts: renamed all `--typography-fontFamily-*` references to `--font-family-*` (matching the kit's actual token var names); added `secondary`/`highlight` color tokens.
- apps/web/app/layout.tsx: next/font/google imports for Space Grotesk + Bricolage Grotesque + Fraunces, attached via html className.
- Validation: 92/92 app tests + 14-route build + dev-smoke 200 on `/`. Compiled CSS payload contains `#fffbf2` cream + `#f24e1e` riso orange + "Space Grotesk" + "Bricolage Grotesque".

**Layer B — ship the missing primitives** (feat-013, closed 2026-04-24)

- Shipped 16 kit primitives (12 core + 4 extended) in hatch-2 via feat-013 Agent 1 (b9e0d21) + Agent 2 (4e0bf48) + JSDOM test fix (dc1c497).
- Migrated 6 hatch-2 consumers to `@repo/ui-kit` imports.
- Kit version bumped `0.1.0-tokens-only` → `0.2.0-primitives`.
- 60/60 kit tests + 92/92 app tests green; build clean; TODO-swap-for-kit comments removed from all 5 component files.
- Kit API gaps noted for future work: Button `asChild`, Card polymorphic `as`, chip-style RadioGroup/CheckboxGroup.

**Layer C — factory-level prevention** (refactor-006, closed 2026-04-24)

- .claude/skills/stylesheet/SKILL.md step 9 rewritten from aspirational 20-row table to prescriptive 12-core-mandatory + 8-extended-on-demand contract.
- Step 18 alarm upgraded from soft warning to HARD GATE (returns `success: false` with abort-reason when <12 core primitives shipped).
- scripts/verify-024.mjs extended with `--primitives-count` CLI mode — walks primitives/, asserts all 12 mandatory directories present, emits structured JSON.
- Gate verified on hatch-2 (pass, 16 shipped) + hatch (fail, 0 shipped). The six pre-refactor projects would now all fail fast instead of silently shipping tokens-only.

**Root-cause summary**

Three overlapping issues. **RC1**: my scaffold authoring during feat-scaffold wrote placeholder tokens into globals.css despite the kit shipping real tokens.css (my mistake — a real builder following react-next SKILL.md's canonical layout would probably have imported). **RC2**: /stylesheet SKILL.md promised 20 primitives but never actually shipped any — factory-wide pattern across 6 projects. **RC3**: no logo asset ever produced by the design pipeline (this one NOT closed by this bug; a separate gap to file later if a project needs branded identity).

**Lessons learned**

- "The kit is tokens-only" became a self-reinforcing myth because the kit literally was tokens-only, and the factory's SKILL.md was aspirational. feat-013 + refactor-006 broke both halves of the loop.
- Inline scaffold authoring is risky — the subagent that would've followed react-next SKILL.md more faithfully might have gotten the token import right. My shortcut introduced the placeholder.
- Compiled-CSS payload grep is a cheap + reliable post-validation pattern — catches token-substitution bugs without needing full browser automation.
