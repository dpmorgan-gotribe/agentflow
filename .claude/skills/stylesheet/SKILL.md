---
name: stylesheet
description: Assemble the @repo/ui-kit package (tokens + styles + primitives + patterns + layouts + illustrations + Storybook) from the winning style at docs/selected-style.json. Produces the versioned toolkit every downstream agent imports.
allowed-tools: Read Write Bash Grep Glob
model: inherit
argument-hint: "[--nanobanana]"
---

# /stylesheet — UI Kit assembly

Third pipeline stage (after `/analyze` + `/mockups` + gate 2, before `/screens`). Consumes the winning style from `docs/selected-style.json` and produces the canonical `@repo/ui-kit` package — a single versioned front-end toolkit (tokens + globals + primitives + patterns + layouts + illustrations + Storybook) that is the binding source of truth for every downstream screen and build agent.

Skill name is `stylesheet` for historical continuity with earlier scaffolding; the output is a full kit, not just a stylesheet.

## Prerequisites

- `/mockups` completed and ONE of:
  - HITL gate 2 wrote `docs/selected-style.json` (multi-style path), or
  - `/mockups` single-style fast path auto-wrote it
- `docs/selected-style.json` parses against `SelectedStyleSchema` (task 034b — refactor-003 added the `iconLibrary` field)
- `docs/mockups/style-{K}/manifest.json` exists for the winning style K (used for asset de-dup)
- `packages/ui-kit/` skeleton exists (scaffolded at `/new-project` step 5b by tasks 026+027)
- Task 022b's consumer-contract templates already copied into `packages/ui-kit/` at `/new-project` step 5b (CONTRACT.md, tsconfig.consumer.json, scripts/validate-consumer.ts stub, eslint-plugin/)
- Task 041 has provisioned the ui-designer-scoped MCP servers; if `--nanobanana` is active, `image-generator` is in scope

## Inputs (ordered by authority)

1. `docs/selected-style.json` → `styleId`, `styleName`, `dials`, `stylesSourceRef`, `iconLibrary`, `nanobananaUsed`, `mockupsManifest`
2. `docs/analysis/shared/styles.md` block at `stylesSourceRef` → **authoritative** source for exact hex palette, typography (family + scale), spacing scale, radius scale, shadow definitions, characteristics. Do not re-derive from mockups when this block is complete; the Analyst already specified the values.
3. `docs/analysis/shared/assets.md` → font URLs + icon library choice for this style (also echoed in `selected-style.json.iconLibrary`)
4. `docs/mockups/style-{K}/manifest.json` → already-downloaded asset inventory (de-dup against the full download wave)
5. `docs/brand-extracted.yaml` (optional) → overrides styles.md where it has stronger sources (e.g., exact typography family names from a brand-guide PDF)
6. `docs/selected-style.json.iconLibrary` → which icon library the kit standardizes on. **Refactor-003 change:** this field now lives on the selected-style contract (locked at gate 2), not on `architecture.yaml.tooling.icon_library` — architect runs POST-design in refactor-003, so `architecture.yaml` doesn't exist when `/stylesheet` runs. Each analyst style block in `assets.md` declares its own icon library (Lucide for minimal, Phosphor for playful, etc.); gate 2's backing server copies the winning style's value into `selected-style.json.iconLibrary`. The kit ships with exactly one library for visual coherence across all apps — the one carried by the winning style. User-supplied icons in `asset-inventory.json.icons[]` still take precedence — they're used verbatim rather than swapped for library equivalents.
7. `docs/asset-inventory.json` → user-supplied fonts / icons / logos / colors take precedence over anything downloaded or researched

**Fallback (gap-fill only):** `node-vibrant` on approved mockups is a last-resort color extractor when `styles.md` AND `brand-extracted.yaml` both have a gap in palette specification. If both are complete, skip node-vibrant entirely.

## Arguments — `$ARGUMENTS`

- `--nanobanana` (boolean flag) — whether the orchestrator-provided pipeline run includes `--flags=nanobanana`. Trust `.mcp.json`'s registration of `image-generator` rather than re-parsing the flag. Only gates the illustrations step; everything else is always code-gen.

## Output: `packages/ui-kit/` structure

```
packages/ui-kit/
├── package.json                # name: "@repo/ui-kit", version follows semver rules (see "Versioning policy")
├── CHANGELOG.md                # seeded with 1.0.0 release notes on first run; appended per re-run
├── CONTRACT.md                 # from task 022b — consumer rules (left alone if already present)
├── UI-KIT.md                   # living consumption guide — written by this skill
├── tsconfig.json
├── tsconfig.consumer.json      # from 022b — path aliases expose ONLY the public barrel
├── .input-fingerprint.json     # hash of resolved inputs; enables no-op re-runs
├── src/
│   ├── index.ts                # PUBLIC BARREL — the ONLY import surface for consumers
│   ├── tokens/
│   │   ├── tokens.json         # W3C DTCG — source of truth
│   │   ├── tokens.css          # generated — CSS custom properties + .dark override block
│   │   ├── tokens.ts           # generated — TypeScript types + runtime constants
│   │   └── README.md           # naming conventions + dark-mode derivation explanation
│   ├── styles/
│   │   ├── globals.css         # resets + base typography + imports tokens.css
│   │   ├── fonts.css           # @font-face declarations (variable fonts where available)
│   │   └── tailwind.config.ts  # consumes tokens via CSS vars
│   ├── lib/
│   │   ├── cn.ts               # clsx + twMerge
│   │   ├── cva.ts              # class-variance-authority setup
│   │   └── motion.ts           # shared motion presets from tokens.motion
│   ├── primitives/             # ≥20 atomic, single-concept components (see table below)
│   │   └── {button,input,textarea,select,checkbox,radio,switch,slider,card,dialog,drawer,popover,tooltip,toast,badge,avatar,skeleton,separator,tabs,accordion}/
│   ├── patterns/               # ≥12 composed, context-aware components (see table below)
│   │   └── {empty-state,error-state,data-table,form-field,page-header,breadcrumbs,search-combobox,command-palette,file-uploader,filter-bar,pagination,notification}/
│   ├── layouts/                # ≥5 page-level shells
│   │   └── {app-shell,split-view,focused-task,marketing,auth}/
│   ├── icons/
│   │   ├── generated/          # SVG → React components via svgr
│   │   └── index.ts            # icon barrel
│   └── illustrations/          # optional; gated by --nanobanana
│       ├── empty-states/
│       ├── onboarding/
│       ├── hero/
│       └── manifest.json       # provenance per illustration (generated | vector | user)
├── eslint-plugin/              # from task 022b — rules filled in HERE
│   ├── package.json
│   ├── index.js
│   └── rules/
│       ├── no-deep-imports.js
│       ├── no-hex-in-className.js
│       ├── no-arbitrary-tailwind.js
│       └── no-inline-style-tokens.js
├── scripts/
│   └── validate-consumer.ts    # from task 022b — real implementation HERE
├── .storybook/                 # Storybook config
│   ├── main.ts
│   └── preview.ts
└── storybook-static/           # built Storybook output (produced here)
```

Every primitive/pattern/layout directory ships `{Name}.tsx` + `{Name}.variants.ts` + `{Name}.stories.tsx` + `index.ts`.

## Steps

### 1. Read the selected style (primary source)

- Parse `docs/selected-style.json`; abort if it fails `SelectedStyleSchema` validation (034b)
- Open `docs/analysis/shared/styles.md` and extract the block referenced by `stylesSourceRef`
- Parse hex palette, typography family + scale, spacing scale, radius scale, shadow definitions, characteristics
- Read `docs/selected-style.json.dials` — values drive token-scale choices (see "Dial → token mapping" below)
- Read `docs/selected-style.json.iconLibrary` — this is the kit's single icon library (refactor-003: locked at gate 2, not at architect time)

### 2. Fingerprint inputs + check for no-op re-run

Compute a SHA-256 hash of: `docs/selected-style.json` bytes + the extracted styles.md block + the resolved asset list (icon-library name, font families, user-asset paths + sizes). Compare against `packages/ui-kit/.input-fingerprint.json`:

- **Match AND** `packages/ui-kit/package.json` exists AND `packages/ui-kit/storybook-static/index.html` exists → no-op re-run. Emit return JSON with `noChange: true, success: true` and exit without regenerating.
- **Mismatch OR** kit missing → continue to step 3 and eventually overwrite `.input-fingerprint.json` at step 18.

This guarantees byte-identical output for identical inputs.

### 3. Resolve asset authorities (in order)

For every token category, check sources in this order and use the first concrete value found:

1. User assets in `docs/asset-inventory.json` (user fonts, user icons, user colors, user logos take precedence over everything else)
2. `docs/brand-extracted.yaml` (when gaps exist and the brand guide provides authoritative values)
3. The styles.md block (the Analyst's canonical specification)
4. `node-vibrant` fallback — **palette only, rare**; extracts dominant colors from approved mockup screenshots when styles.md + brand-extracted both have gaps

### 4. Generate `packages/ui-kit/src/tokens/tokens.json`

W3C DTCG format. Required top-level keys:

```json
{
  "color": {
    "neutral": { "50..950": "#..." },
    "accent": { "50..950": "#..." },
    "semantic": {
      "success": "#...",
      "warning": "#...",
      "danger": "#...",
      "info": "#..."
    },
    "surface": {
      "base": "#...",
      "raised": "#...",
      "overlay": "#...",
      "inverted": "#..."
    },
    "text": {
      "primary": "#...",
      "secondary": "#...",
      "tertiary": "#...",
      "inverted": "#..."
    },
    "border": { "subtle": "#...", "default": "#...", "strong": "#..." }
  },
  "typography": {
    "fontFamily": { "sans": "...", "mono": "...", "display": "..." },
    "fontSize": { "xs..6xl": "..." },
    "fontWeight": {
      "regular": 400,
      "medium": 500,
      "semibold": 600,
      "bold": 700
    },
    "lineHeight": { "tight": 1.1, "snug": 1.3, "normal": 1.5, "relaxed": 1.75 },
    "letterSpacing": { "tight": "-0.02em", "normal": "0", "wide": "0.04em" }
  },
  "spacing": { "0, 0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24": "..." },
  "radius": { "none, sm, md, lg, xl, 2xl, full": "..." },
  "shadow": { "xs, sm, md, lg, xl": "..." },
  "motion": {
    "duration": { "instant, fast, normal, slow, slower": "..." },
    "easing": { "linear, standard, decel, accel, spring": "..." }
  },
  "zIndex": { "base, dropdown, sticky, overlay, modal, toast, tooltip": "..." }
}
```

Populate values from the step-3-resolved authorities. Accent ramp is derived from the style's accent color (LCH-based 50-950 scale). Neutral ramp is derived from the style's textPrimary/background/surface (warm-greys / cool-slates / true-neutrals depending on the style's characteristics).

**Token key index (dotted-identifier form for downstream readers):**

- `color.neutral.{50..950}`, `color.accent.{50..950}`
- `color.semantic.{success, warning, danger, info}`
- `color.surface.{base, raised, overlay, inverted}`
- `color.text.{primary, secondary, tertiary, inverted}`
- `color.border.{subtle, default, strong}`
- `typography.fontFamily.{sans, mono, display}`
- `typography.fontSize.{xs..6xl}`
- `typography.fontWeight.{regular, medium, semibold, bold}`
- `typography.lineHeight.{tight, snug, normal, relaxed}`
- `typography.letterSpacing.{tight, normal, wide}`
- `spacing.{0, 0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24}`
- `radius.{none, sm, md, lg, xl, 2xl, full}`
- `shadow.{xs, sm, md, lg, xl}`
- `motion.duration.{instant, fast, normal, slow, slower}`
- `motion.easing.{linear, standard, decel, accel, spring}`
- `zIndex.{base, dropdown, sticky, overlay, modal, toast, tooltip}`

### 5. Dial → token mapping (from `docs/selected-style.json.dials`)

These integer dials (1-10) shift token defaults:

- `visual_density` ≤ 3 → spacing defaults to `spacing.6`/`spacing.8`; line-height `relaxed`; card-based list patterns
- `visual_density` ≥ 7 → spacing defaults to `spacing.2`/`spacing.3`; line-height `snug`; border-top dividers instead of cards in list patterns
- `motion_intensity` ≤ 3 → `motion.duration.normal = 150ms`; no spring easing by default; fades only
- `motion_intensity` ≥ 7 → `motion.duration.normal = 400ms`; spring easing named preset available; scroll-linked motion allowed
- `design_variance` ≤ 3 → layouts default to symmetric centered compositions
- `design_variance` ≥ 7 → layouts default to asymmetric; at least one layout pattern uses a broken grid

Record the applied dial mapping at the top of `packages/ui-kit/CHANGELOG.md`'s entry so re-runs know which dial value drove which default.

### 6. Generate derivatives

- **`tokens.css`** — every token as a CSS custom property (`--color-accent-500: #...`). Include a `.dark` override block with dark-mode values (see "Dark-mode derivation" below). One file — no separate light/dark builds.
- **`tokens.ts`** — typed exports so consumers can `import { tokens } from '@repo/ui-kit'` for runtime reads. This is the 022b-sanctioned escape hatch for dynamic style decisions that can't be expressed as class names.
- **`styles/tailwind.config.ts`** — extends theme by referencing CSS variables (`backgroundColor: { accent: 'var(--color-accent-500)' }`), so Tailwind utilities resolve to the kit's tokens.

#### Dark-mode derivation

If `styles.md` declares a `darkMode:` subsection for the selected style, use its hex values directly. If not (the common case — Analyst only specifies light mode), derive dark-mode tokens algorithmically:

- **Neutrals**: swap the ramp — `neutral.50` ↔ `neutral.950`, `neutral.100` ↔ `neutral.900`, …, `neutral.400` ↔ `neutral.600`; `neutral.500` stays
- **Surface tokens**: `surface.base = neutral.950`; `surface.raised = neutral.900`; `surface.overlay = neutral.800`; `surface.inverted = neutral.50`
- **Text tokens**: `text.primary = neutral.50`; `text.secondary = neutral.400`; `text.tertiary = neutral.600`; `text.inverted = neutral.950`
- **Border tokens**: `border.subtle = neutral.800`; `border.default = neutral.700`; `border.strong = neutral.600`
- **Accent + semantic ramps**: unchanged (same hues work in both modes; contrast comes from surface/text inversion)
- **Shadows**: reduce opacity by ~40% on dark (dark shadows are less visible against dark surfaces)

The derivation is deterministic. Document it in `packages/ui-kit/src/tokens/README.md` so any designer can see why a specific dark value was chosen.

### 7. Generate `packages/ui-kit/src/styles/`

- **`globals.css`** — CSS reset (modern normalize), focus-visible styles, scrollbar styling, base typography (body font + default leading), color-scheme meta. Imports `tokens.css` at top.
- **`fonts.css`** — `@font-face` declarations. Prefer variable fonts; declare `font-display: swap`. One family per declaration; don't lump.
- **`tailwind.config.ts`** — extends theme via `var(--...)` references only; no hex in config.
- **`preview-bootstrap.html`** (refactor-007 — load-bearing for `/mockups` + `/screens` HTML preview) — a paste-ready fragment that downstream skills inline into every preview HTML's `<head>`. It contains the Tailwind Play CDN script + an inline `<script>tailwind.config = {...}</script>` block whose theme.extend mirrors the kit's `tailwind.config.ts` exactly (with `var(--color-*)` references preserved as string values). Without this fragment in their `<head>`, Tailwind utility classes used by mockups/screens (`bg-accent-500`, `font-display`, `rounded-md`, etc.) resolve to nothing and the page renders unstyled — `globals.css` alone provides only token CSS variables + a base reset, not compiled Tailwind utilities. Production builders consume the kit at JSX-time and run a real Tailwind build, so this fragment is preview-only.

  **Required shape** (emit this verbatim, replacing the `theme.extend` body with values derived from this run's `tailwind.config.ts`):

  ```html
  <!-- preview-bootstrap.html — inline this into every mockup/screen <head>.
       Generated by /stylesheet step 7. Do NOT hand-edit; re-run /stylesheet to regenerate. -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: ["class", '[data-theme="dark"]'],
      theme: {
        extend: {
          colors: {
            neutral: {
              50: "var(--color-neutral-50)",
              /* ...50→950 */ 950: "var(--color-neutral-950)",
            },
            accent: {
              50: "var(--color-accent-50)",
              /* ...50→950 */ 950: "var(--color-accent-950)",
            },
            secondary: {
              500: "var(--color-secondary-500)",
              600: "var(--color-secondary-600)",
            },
            highlight: {
              300: "var(--color-highlight-300)",
              500: "var(--color-highlight-500)",
            },
            success: "var(--color-success)",
            warning: "var(--color-warning)",
            danger: "var(--color-danger)",
            info: "var(--color-info)",
            surface: {
              base: "var(--color-surface-base)",
              raised: "var(--color-surface-raised)",
              overlay: "var(--color-surface-overlay)",
              inverted: "var(--color-surface-inverted)",
            },
            text: {
              primary: "var(--color-text-primary)",
              secondary: "var(--color-text-secondary)",
              tertiary: "var(--color-text-tertiary)",
              inverted: "var(--color-text-inverted)",
            },
            border: {
              subtle: "var(--color-border-subtle)",
              DEFAULT: "var(--color-border-default)",
              strong: "var(--color-border-strong)",
            },
          },
          fontFamily: {
            sans: "var(--font-family-sans)",
            mono: "var(--font-family-mono)",
            display: "var(--font-family-display)",
          },
          fontSize: {
            xs: "var(--font-size-xs)",
            sm: "var(--font-size-sm)",
            md: "var(--font-size-md)",
            lg: "var(--font-size-lg)",
            xl: "var(--font-size-xl)",
            "2xl": "var(--font-size-2xl)",
            "3xl": "var(--font-size-3xl)",
            "4xl": "var(--font-size-4xl)",
            "5xl": "var(--font-size-5xl)",
            "6xl": "var(--font-size-6xl)",
          },
          spacing: {
            0.5: "var(--spacing-0_5)",
            1: "var(--spacing-1)",
            2: "var(--spacing-2)",
            3: "var(--spacing-3)",
            4: "var(--spacing-4)",
            5: "var(--spacing-5)",
            6: "var(--spacing-6)",
            8: "var(--spacing-8)",
            10: "var(--spacing-10)",
            12: "var(--spacing-12)",
            16: "var(--spacing-16)",
            20: "var(--spacing-20)",
            24: "var(--spacing-24)",
          },
          borderRadius: {
            none: "var(--radius-none)",
            sm: "var(--radius-sm)",
            DEFAULT: "var(--radius-md)",
            md: "var(--radius-md)",
            lg: "var(--radius-lg)",
            xl: "var(--radius-xl)",
            "2xl": "var(--radius-2xl)",
            full: "var(--radius-full)",
          },
          boxShadow: {
            xs: "var(--shadow-xs)",
            sm: "var(--shadow-sm)",
            DEFAULT: "var(--shadow-md)",
            md: "var(--shadow-md)",
            lg: "var(--shadow-lg)",
            xl: "var(--shadow-xl)",
          },
          zIndex: {
            dropdown: "var(--z-dropdown)",
            sticky: "var(--z-sticky)",
            overlay: "var(--z-overlay)",
            modal: "var(--z-modal)",
            toast: "var(--z-toast)",
            tooltip: "var(--z-tooltip)",
          },
        },
      },
    };
  </script>
  ```

  Sync this fragment with `tailwind.config.ts` on every `/stylesheet` run — they are the same theme expressed once for the JIT build (TS) and once for the Play CDN (inline JS). Drift between them is a bug; the fingerprint hash (step 2) covers `tailwind.config.ts` so any change forces a regenerate of both files together.

### 8. Generate `packages/ui-kit/src/lib/`

- **`cn.ts`** — `clsx` + `tailwind-merge` composition. One default export `cn(...classes)`.
- **`cva.ts`** — `class-variance-authority` re-export + the kit's preferred `cva` factory wrapper with default `compoundVariants: []`.
- **`motion.ts`** — named presets derived from `tokens.motion.duration` + `tokens.motion.easing` (`fadeIn`, `slideUp`, `scaleIn`, `springPop`, etc.). Each preset returns a CSS string or a `framer-motion` variant object per the kit's motion abstraction.

### 8.5. Read components catalog + compute coverage union

**Load `docs/analysis/shared/components.md`** (produced by `/analyze` step 6e). Parse its machine-readable JSON trailer (fenced `json` block at end of file) to extract:

- `primitives[]` — analyst-observed primitive usage, mapped to canonical kit names
- `patterns[]` — analyst-observed pattern usage
- `layouts[]` — analyst-observed layout usage
- `projectSpecific[]` — custom compositions (e.g. `wallet-balance`, `vote-button`, `chat-bubble`, `stepper`) — one entry per component with `name`, `screenCount`, `platforms[]`
- `canonicalCoverage.primitivesUnused[]` / `patternsUnused[]` — canonical items the analyst DIDN'T call out

**Compute the generation plan** (union):

1. **All 20 canonical primitives** from step 9's table are generated unconditionally (future-proofing; some are unused-now but may be needed by `/screens` retry passes or post-gate-4 edits). Analyst-observed primitives get preview priority.
2. **All 12 canonical patterns** from step 10's table are generated unconditionally.
3. **All 5 canonical layouts** from step 11.
4. **ONE custom pattern per project-specific entry** — generated in step 10.5 (below). Pattern name derived from kebab-case → PascalCase (`wallet-balance` → `WalletBalance`). Lives under `src/patterns/custom/{name}/` with the same `{Name}.tsx` + `.variants.ts` + `.stories.tsx` + `index.ts` shape as canonical patterns.

**Record the plan** in `packages/ui-kit/.components-plan.json`:

```json
{
  "canonicalPrimitivesGenerated": 20,
  "canonicalPatternsGenerated": 12,
  "canonicalLayoutsGenerated": 5,
  "customPatternsGenerated": [
    {
      "name": "WalletBalance",
      "source": "wallet-balance",
      "screenCount": 13,
      "platforms": ["mobile"]
    },
    {
      "name": "VoteButton",
      "source": "vote-button",
      "screenCount": 18,
      "platforms": ["mobile"]
    }
  ],
  "canonicalUnused": {
    "primitives": ["Slider", "Accordion"],
    "patterns": ["CommandPalette"]
  }
}
```

Downstream: step 14's public barrel exports EVERY component in the plan (primitives + patterns + custom patterns + layouts). Step 17's preview renders EVERY component with its analyst-derived screen count (or "Available, no current screens use it" for unused canonicals).

### 9. Generate primitives (12 core mandatory + 8 extended on-demand)

Primitives are the kit's non-negotiable surface. **Historical gap (refactor-006):** before this rewrite, this step said "generate ≥20" in the aspirational voice and six projects (hatch, gotribe-v1, mindapp, mindapp-v2, runclub, test-app) shipped tokens-only without a single primitive. Step 18's self-verify is now a hard gate: <12 primitives = stage fails.

**Reference implementation:** hatch-2's `packages/ui-kit/src/primitives/` (shipped by feat-013, commit `b9e0d21`). Use its file layout + `cn`/`cva` utility pattern + variant shapes as the template. ~2100 LOC across 16 primitives + tests is the shipped benchmark.

#### 9a. Prerequisite files (author once, re-use across primitives)

1. **`src/lib/cn.ts`** — clsx + tailwind-merge composition:

   ```ts
   import { clsx, type ClassValue } from "clsx";
   import { twMerge } from "tailwind-merge";
   export function cn(...inputs: ClassValue[]) {
     return twMerge(clsx(inputs));
   }
   ```

2. **`src/lib/cva.ts`** — class-variance-authority re-export:

   ```ts
   export { cva, cx, type VariantProps } from "class-variance-authority";
   ```

3. **`package.json` runtime deps** — add: `class-variance-authority ^0.7.1`, `clsx ^2.1.1`, `tailwind-merge ^2.5.5`. DevDeps: `@testing-library/react ^16.1.0`, `@testing-library/jest-dom ^6.6.3`, `vitest ^2.1.8`, `jsdom ^25.0.1`, `@types/react ^19.0.2`. PeerDeps: `react ^19`, `react-dom ^19`.

4. **`vitest.config.ts` + `vitest.setup.ts`** — jsdom environment, import `@testing-library/jest-dom/vitest` in setup.

5. **`tsconfig.json`** — extends the monorepo root with `"jsx": "react-jsx"` and `"moduleResolution": "bundler"`.

#### 9b. Per-primitive file layout (identical for every primitive)

```
packages/ui-kit/src/primitives/{kebab-name}/
├── {kebab-name}.tsx         # React component — uses cn() + cva-derived variants
├── {kebab-name}.variants.ts # cva() call — variant prop definitions (OPTIONAL for single-variant primitives like FormField)
├── {kebab-name}.test.tsx    # happy-path: 3-5 tests — renders, variants apply, a11y
└── index.ts                 # export * from "./{kebab-name}"
```

Then `packages/ui-kit/src/primitives/index.ts` barrel re-exports every primitive directory's index.

#### 9c. Core mandatory roster (12 primitives — hard-gate by step 18)

The subagent MUST author a `.tsx` + `.test.tsx` for each of these 12. Skipping any fails the stage.

| Primitive     | Props / variants (minimum)                                                                                                                                                                                  | Style-specific binding from selected-style                                                                                                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Button**    | `variant: primary \| secondary \| ghost \| destructive` × `size: sm \| md \| lg` + `iconOnly?: boolean` + `loading?: boolean` (sets `aria-busy`). Forwards ref; native `<button>` semantics.                | Radius from `tokens.radius.button` (style-4 → `rounded-full` pill; style-0 → `rounded-md`). Primary hover: if style declares `shadow.offsetHover` (style-4 riso overprint), emit `box-shadow: 4px 4px 0 var(--color-secondary-500)`. |
| **Input**     | `type: text \| email \| password \| number \| search \| tel \| url` + `hasError?: boolean` (sets `aria-invalid`). Forwards ref.                                                                             | Border `var(--color-border-default)`; focus ring `var(--color-accent-500)`. Radius from `tokens.radius.input` (usually matches Card — sharp for style-4).                                                                            |
| **Textarea**  | Same as Input + `rows?: number` + auto-resize option.                                                                                                                                                       | Same styling as Input.                                                                                                                                                                                                               |
| **Select**    | Native `<select>` with `appearance-none` + custom chevron SVG data-URI. Same `hasError` as Input.                                                                                                           | Chevron color = `var(--color-text-primary)`.                                                                                                                                                                                         |
| **Checkbox**  | `<input type="checkbox">` + custom box. Supports `indeterminate` ref-set.                                                                                                                                   | Checked fill = `var(--color-secondary-500)` (style-4) OR `var(--color-accent-500)` per style characteristic.                                                                                                                         |
| **Radio**     | `<input type="radio">` + custom circle. Same fill logic as Checkbox.                                                                                                                                        | Circular.                                                                                                                                                                                                                            |
| **Card**      | `interactive?: boolean` (hover elevates + translates), optional `CardHeader` / `CardBody` / `CardFooter` subcomponents.                                                                                     | Radius from `tokens.radius.card` (style-4 → `rounded-none` sharp corners — the characteristic).                                                                                                                                      |
| **Badge**     | `variant: default \| accent \| secondary \| highlight` × `size: sm \| md`.                                                                                                                                  | Pill (rounded-full) regardless of style. Text-xs uppercase tracking-wide.                                                                                                                                                            |
| **Avatar**    | `src?: string` + `alt?: string` + `initials?: string` (auto-computes from alt if absent) + `size: sm \| md \| lg`.                                                                                          | Square (no radius) — matches brutalist/riso aesthetics. Round only if style characteristic declares `avatar.round: true`.                                                                                                            |
| **Separator** | `orientation: horizontal \| vertical` + `emphasis: subtle \| default \| strong` → maps to `--color-border-{subtle,default,strong}`.                                                                         | —                                                                                                                                                                                                                                    |
| **Tabs**      | `<Tabs>` root + `<TabsList>` + `<TabsTrigger>` + `<TabsContent>`. `variant: underline \| pills`. Keyboard: ArrowLeft/Right/Up/Down/Home/End. `aria-selected` + `role="tab"`.                                | —                                                                                                                                                                                                                                    |
| **FormField** | Composite: `<label>` + child (Input/Textarea/Select) + optional `error?: string` + optional `hint?: string`. Uses React.cloneElement to inject `id`, `aria-describedby`, `aria-invalid` on the child input. | —                                                                                                                                                                                                                                    |

#### 9d. Extended roster (8 primitives — ship on-demand per signoff)

Author these ONLY IF the gate-3 signoff's `componentsApproved[]` names them (i.e., the analyst/previous stage flagged them as used). If not referenced, skip — don't silently author. Skipping an unreferenced extended primitive does NOT fail the stage.

| Primitive        | When to ship                                                          |
| ---------------- | --------------------------------------------------------------------- |
| **Breadcrumbs**  | when analyst observed breadcrumb navigation on any screen             |
| **EmptyState**   | when any screen has `empty-state` variant metadata                    |
| **PageHeader**   | when multi-section pages use a shared page-title + description block  |
| **Notification** | when the project has contact-form or transactional flows              |
| **Dialog**       | when any flow includes a modal confirmation                           |
| **Drawer**       | when mobile-first design implies slide-in nav                         |
| **Popover**      | when tooltip-rich or dropdown-menu UI is signed off                   |
| **Skeleton**     | when loading states are explicitly designed (most projects skip this) |

Primitives outside both rosters (Toast, Accordion, Slider, Switch, Tooltip) are authored only on explicit project demand and documented as "extended" in the kit's CHANGELOG.

#### 9e. Shared authoring rules (apply to every primitive)

- **Class composition via `cn()`** — never concatenate className strings by hand; never ad-hoc-switch variants via inline conditionals. Variants go through `cva()` in the companion `.variants.ts` file.
- **No raw hex or inline styles** — all colors via `var(--color-*)` through Tailwind token classes. Exception: inline `style={{ backgroundImage: "url(data:image/svg+xml;...)" }}` is acceptable for data-URI icons (custom Select chevron, Checkbox mark). Record these as `inline-style-tokens-exempt` in the returned warnings so 022b's ESLint exempts the specific file.
- **Accessibility minimums per primitive**: focus-visible ring (2px offset), ARIA role where semantic HTML doesn't provide it, keyboard navigation on composites (Tabs arrow keys; RadioGroup arrow keys), `aria-describedby` linkage between FormField and its error/hint, `aria-invalid` on error state, `aria-busy` on Button loading, `aria-current="page"` on Breadcrumbs terminal item.
- **Default to server components** — only add `"use client"` when the primitive NEEDS interactivity. Button/Input/Card/Badge/Avatar are server-safe. Tabs, Checkbox with ref-set-indeterminate, and FormField with dynamic error linkage need client. Flag in the primitive's JSDoc header so consumers know.
- **Tests per primitive**: at minimum 3 cases — renders with canonical props, applies variant-class changes, carries expected a11y attribute. Use `@testing-library/react` + `@testing-library/jest-dom` matchers. Mock `next/navigation` + external modules only at the app boundary, not in the kit.
- **Dark-mode support**: the kit's `tokens.css` defines a `.dark` selector block with the inverted palette. Primitives read CSS vars, so dark-mode works automatically — test does NOT need to exercise both modes; the visual-review stage handles that.
- **Version bump** — first successful primitive-shipping run bumps `package.json.version` from `0.1.0-tokens-only` to `0.2.0-primitives` (semver minor per "new primitive surface" per the versioning policy below).

#### 9f. Public barrel (`src/index.ts`)

```ts
// Primitives (12 mandatory + any shipped extended)
export * from "./primitives/button";
export * from "./primitives/input";
// ... one line per primitive directory

// Utilities
export { cn } from "./lib/cn";
export { cva, cx, type VariantProps } from "./lib/cva";

// Runtime token access (the 022b-sanctioned escape hatch)
export { default as tokens } from "./tokens/tokens.json";
```

If the TS/Node version rejects direct JSON import, create `src/tokens/index.ts` that reads tokens.json via `import` with `resolveJsonModule: true` in tsconfig, then re-export. Feat-013's hatch-2 kit uses this workaround.

#### 9g. JSDOM gotchas (learned from feat-013)

- **Avatar with `src`** — outer `<span role="img">` + inner `<img>` both match `getByRole("img")`. Tests must disambiguate via `getByAltText()` for the inner img.
- **Select chevron data-URI** — JSDOM silently drops complex `style={{ backgroundImage: "url(data:image/svg+xml;...)" }}` values, which ALSO clears the entire inline style attribute. Don't test the URL directly; assert the companion `appearance-none` Tailwind class OR skip the test with a comment.
- **React 19 + vitest** — ensure `esbuild.jsx: "automatic"` in `vitest.config.ts` or JSX transforms to the classic runtime and tests fail with `ReferenceError: React is not defined`.

### 10. Generate patterns (minimum 12 canonical + N custom)

**10a. Canonical patterns.** Each pattern composes primitives (never reinvents atomics). Required:

Each pattern composes primitives (never reinvents atomics). Required:

| Pattern          | Composes                                                            |
| ---------------- | ------------------------------------------------------------------- |
| `EmptyState`     | Illustration slot + title + description + action Button             |
| `ErrorState`     | inline + full-page variants; recovery action required               |
| `DataTable`      | Table primitive + sort + selection + row skeleton states            |
| `FormField`      | Label + Input/Textarea/Select + helper + error; Zod schema optional |
| `PageHeader`     | Title + description + actions slot; breadcrumb slot                 |
| `Breadcrumbs`    | Separator-driven; accessible                                        |
| `SearchCombobox` | Input + Popover + keyboard nav                                      |
| `CommandPalette` | Keyboard-first overlay; inline actions; Cmd/Ctrl+K                  |
| `FileUploader`   | Drag-drop + file list + progress                                    |
| `FilterBar`      | Chip row + "Add filter" + active-filter summary                     |
| `Pagination`     | numbered + prev/next; responsive                                    |
| `Notification`   | Banner variant; actionable; dismissible                             |

**10b. Custom patterns (project-specific, per `.components-plan.json.customPatternsGenerated[]`).**

For each entry in the components plan's `customPatternsGenerated[]`, generate a custom pattern file tree at `src/patterns/custom/{name}/`:

```
src/patterns/custom/WalletBalance/
├── WalletBalance.tsx           # composes primitives (Card, Badge, Skeleton) to render the custom composition
├── WalletBalance.variants.ts   # CVA variants if the composition has multiple states
├── WalletBalance.stories.tsx   # Storybook story — MUST include: default / empty / loading / error states
└── index.ts
```

**Generation rules for custom patterns:**

1. **Compose — don't atomize.** A custom pattern composes canonical primitives. `WalletBalance` might use `Card` + `Badge` + `Skeleton`. `VoteButton` extends `Button` with a count indicator. Never redefine atomics inside a custom pattern.
2. **Infer from the analyst's component name + usage context.** `wallet-balance` implies a balance display — render with a monetary figure + token symbol + optional trend indicator. `chat-bubble` implies left/right message alignment with avatar. The generator uses the component name + brief context (§1 / §6 / §12) to choose the sensible composition. When ambiguous, produce a minimal working version and flag in `warnings[]` for human review at gate 3.
3. **Screen-count drives priority + polish.** High-traffic (≥20 screens) patterns get full variants + all 5 interaction states + dark-mode verified. Low-traffic (<5 screens) patterns get minimum-viable implementations (default state + one-line story).
4. **Match the selected style's characteristics.** If the style has a dark-mode-default (Style 3 Midnight Press pattern), custom patterns render correctly on that surface. If the dials say `visual_density: 8` (cockpit-dense), custom patterns use tight spacing defaults.

### 11. Generate layouts (minimum 5)

| Layout        | Shape                                                           |
| ------------- | --------------------------------------------------------------- |
| `AppShell`    | Sidebar + top bar + main; responsive (mobile: sidebar → drawer) |
| `SplitView`   | Master-detail; resizable; mobile stacks                         |
| `FocusedTask` | Single column, `max-w-prose`; centered reading surface          |
| `Marketing`   | Hero + sections + footer; no chrome                             |
| `Auth`        | Split-screen or centered card                                   |

### 12. `--nanobanana` step (optional, illustrations only)

The `--nanobanana` flag gates only the illustrations step — everything else is always code-gen and runs regardless of flag state.

- **Flag on** (`.mcp.json` has `image-generator`): generate hero / empty-state / onboarding illustrations via `image-generator` MCP using prompt patterns that respect the selected style's palette + characteristics. Respect per-server budget cap. Provenance → `generated`.
- **Flag off**: skip generation; provide a small unDraw vector set in `illustrations/` with file headers tokenized on the accent color. `EmptyState` pattern accepts an `illustration` prop that falls back gracefully when no matching illustration exists. Provenance → `vector`.
- Record every illustration in `packages/ui-kit/src/illustrations/manifest.json` with `{ name, provenance, source, recoloredTo }`.

### 13. Fill in 022b artifacts

Skeletons were already placed inside `packages/ui-kit/` at `/new-project` step 5b. This step replaces the stubs with real implementations:

- **`packages/ui-kit/eslint-plugin/rules/*.js`** — real rule implementations for the four rules (`no-deep-imports`, `no-hex-in-className`, `no-arbitrary-tailwind`, `no-inline-style-tokens`)
- **`packages/ui-kit/scripts/validate-consumer.ts`** — real grep-validator replacing 027's exit-0 stub. Targets `apps/*/src/**/*.{ts,tsx,js,jsx}` (not the kit itself)
- **`packages/ui-kit/tsconfig.consumer.json`** — path aliases exposing only the public barrel (`@repo/ui-kit` → `./packages/ui-kit/src/index.ts`). No subpath wildcards
- **Do NOT touch** `packages/ui-kit/CONTRACT.md` — `/new-project` step 5b wrote it from the factory template; it's project-invariant and safe to leave alone across re-runs

### 14. Generate `src/index.ts` — the public barrel

The ONLY import surface for consumers. Exports:

- Every primitive (named export — `Button`, `Input`, `Textarea`, ...)
- Every pattern (named export — `EmptyState`, `ErrorState`, `DataTable`, ...)
- Every layout (named export — `AppShell`, `SplitView`, ...)
- The `tokens` object (escape-hatch runtime read; from `tokens.ts`)
- `cn`, `cva` utilities (from `lib/`)
- Icon named exports from `icons/index.ts`
- Nothing else — no internal paths re-exported, no wildcards beyond the icon barrel

### 15. Write `package.json`

```json
{
  "name": "@repo/ui-kit",
  "version": "1.0.0",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./styles/globals.css": "./src/styles/globals.css",
    "./styles/fonts.css": "./src/styles/fonts.css",
    "./eslint-plugin": "./eslint-plugin/index.js"
  },
  "scripts": {
    "storybook": "storybook dev -p 6006",
    "build-storybook": "storybook build -o storybook-static",
    "validate-consumer": "tsx scripts/validate-consumer.ts 'apps/*/src/**/*.{ts,tsx,js,jsx}'"
  },
  "dependencies": {
    "clsx": "...",
    "tailwind-merge": "...",
    "class-variance-authority": "..."
  },
  "peerDependencies": { "react": ">=18", "react-dom": ">=18" },
  "devDependencies": { "@storybook/react-vite": "...", "...": "..." }
}
```

The `exports` field restricts subpath access to `./styles/*.css` + `./eslint-plugin`. No other subpaths resolvable. Deep imports will fail at the module-resolution layer — enforced BEFORE the ESLint plugin fires, double-layered defense per 022b.

### 16. Build Storybook

Run `pnpm build-storybook` via Bash. Static output lives at `packages/ui-kit/storybook-static/`. This is the **visual contract** the HITL gate (036 gate 3) serves for review and downstream reviewers check.

If Storybook build fails, capture the error, write `docs/design-system-gaps.md` with the failure details, and emit return JSON with `success: false` + the error.

### 17. Generate `docs/design-system-preview.html`

Single standalone HTML page. This is NOT a docs grid. **The preview MUST read as a real, interactive application** — the reviewer evaluates whether the look + feel holds at production density, not whether each atom renders correctly in isolation.

**UX philosophy (applies to every project):**

1. **Real app chrome wraps everything.** Derive the header + sidebar + footer pattern from the winning style's `/mockups` output (read `docs/mockups/style-{K}/webapp/*.html` from the pre-archive working set OR from `docs/mockups/archive/style-{K}/` if `/pick-style` moved it). Use identical palette + type + spacing as the picked mockup. Gotribe example: dark charcoal `#3D3D3D` top header with logo + search + notifications-with-badge + avatar; left sidebar with nav items. Hatch example: minimal typographic-centered header, no sidebar. Mindapp example: mastery-color-tokened chrome. The preview must be recognisable as "the same product family" as the selected mockup.

2. **Reference real user assets by relative path — never inline-redraw.** `<img src="../assets/logos/{file}.{ext}">` for the logo. `<img src="../assets/icons/{name}.svg">` for every user-supplied icon. Icons inherit the filter/color treatment from the style's chrome (e.g. `filter: invert(1)` on dark-chrome headers for monochromatic SVGs). Drives home that the preview is real, not approximated.

3. **Every component is active — no greyed-out "unused canonical" state.** A Slider the analyst didn't call out is still draggable. A Popover the analyst didn't list still opens on click. Future screens may need them; reviewer should see the real behaviour today. "Unused" classification lives only in the tooltip metadata, never in visual treatment.

4. **No cards wrapping components with metadata clustered around them.** Components sit in realistic layouts (grids, lists, feeds, forms) — not in individual documentation boxes. Metadata moves to a **tooltip on hover** (see snippet below). When the reviewer hovers an outlined element, they see `ComponentName · tier · usage count · platforms`. When they're not hovering, the UI reads as a clean product.

5. **Organise content into realistic app sections, not a component taxonomy.** Sections derive from brief §11 screen catalog + analyst flows — e.g. for gotribe: Dashboard, Activity feed, Tribes list, Events, Governance, Marketplace, Messaging, Map, Forms, Feedback overlays, Content patterns, Special widgets. For hatch: Home hero, Service overview, Featured work, Testimonial, Contact. Each section uses the components that belong to that app surface, composed the way they'll be composed at `/screens` time.

6. **Everything that can be interactive IS interactive.** Explicit requirements:
   - Sliders / range inputs: draggable, reflect value
   - Tabs: click switches active tab
   - Accordion `<details>`: click expands/collapses
   - Switch / Checkbox / Radio: toggle on click
   - Chips (filter-bar): click to toggle active state
   - Rating: click a star to set rating
   - VoteButton: click to toggle upvote/downvote with count flip
   - Dialog: triggered by a real button; `<dialog>` element with `.showModal()`; Esc closes; backdrop click closes
   - Drawer: triggered by real button; slides in via `transform: translateX`; backdrop click closes
   - Toast: triggered by buttons; real `fireToast()` function appends to a toast stack with auto-dismiss
   - Popover: click to open, outside-click to close
   - FAB (if mobile is a detected platform): floats bottom-right, fires a toast on click
   - Search combobox: focus opens suggestions, blur closes
   - RichText editor: `contenteditable="true"` so reviewer can actually type

7. **Every rendered instance carries a `data-comp` attribute** with this shape: `"ComponentName · tier · usage-line"` (e.g. `"Button · primary variant · 571 screens · all platforms"`). The tooltip JS (below) splits on `·` and renders the parts with distinct styling.

**Tooltip implementation — ship this snippet verbatim in every preview:**

```html
<div id="tooltip"></div>
<style>
  #tooltip {
    position: fixed;
    z-index: 10000;
    pointer-events: none;
    background: var(--color-neutral-900);
    color: var(--color-neutral-50);
    padding: 8px 12px;
    border-radius: var(--radius-md);
    font-size: var(--font-size-xs);
    font-family: var(--font-family-mono);
    opacity: 0;
    transition: opacity 120ms ease;
    white-space: nowrap;
    box-shadow: var(--shadow-lg);
    max-width: 300px;
  }
  #tooltip.show {
    opacity: 1;
  }
  #tooltip .name {
    font-weight: var(--font-weight-semibold);
    color: var(--color-accent-300);
  }
  #tooltip .tier {
    opacity: 0.7;
    margin-left: 6px;
  }
  #tooltip .usage {
    display: block;
    margin-top: 2px;
    color: var(--color-neutral-300);
  }
  [data-comp] {
    cursor: help;
  }
  [data-comp]:hover {
    outline: 2px dashed rgba(107, 155, 55, 0.4);
    outline-offset: 2px;
    border-radius: 4px;
  }
</style>
<script>
  const tip = document.getElementById("tooltip");
  document.addEventListener("mouseover", (e) => {
    const el = e.target.closest("[data-comp]");
    if (!el) return;
    const parts = el.getAttribute("data-comp").split(" · ");
    tip.innerHTML =
      `<span class="name">${parts[0]}</span>` +
      `<span class="tier">${parts[1] || ""}</span>` +
      (parts.slice(2).length
        ? `<span class="usage">${parts.slice(2).join(" · ")}</span>`
        : "");
    tip.classList.add("show");
    tip.style.left =
      Math.min(e.clientX + 16, window.innerWidth - tip.offsetWidth - 12) + "px";
    tip.style.top =
      Math.min(e.clientY + 16, window.innerHeight - tip.offsetHeight - 12) +
      "px";
  });
  document.addEventListener("mousemove", (e) => {
    if (!tip.classList.contains("show")) return;
    tip.style.left =
      Math.min(e.clientX + 16, window.innerWidth - tip.offsetWidth - 12) + "px";
    tip.style.top =
      Math.min(e.clientY + 16, window.innerHeight - tip.offsetHeight - 12) +
      "px";
  });
  document.addEventListener("mouseout", (e) => {
    if (!e.relatedTarget || !e.relatedTarget.closest("[data-comp]"))
      tip.classList.remove("show");
  });
</script>
```

The outline-on-hover + dashed rectangle is a universal affordance: hovering reveals every reviewable element at a glance. Reviewer can scan the page for olive dashed outlines to find anything unreviewed.

**Full-coverage assertion (unchanged).** Before writing the preview, verify: every entry in `components.md`'s JSON trailer (`primitives`, `patterns`, `layouts`, `projectSpecific` combined) has at least one corresponding rendered instance with a matching `data-comp` attribute. If any analyst-observed component is missing from the preview, abort — this is the load-bearing contract that prevents unreviewed components leaking into `/screens`.

**Grep-based verifier:** after writing, grep for `data-comp=` and confirm the unique component-name set matches `.components-plan.json`'s union. Abort on any mismatch (missing OR extra).

**Interaction smoke-check before emitting:** open the file in a headless browser (via the `chrome-devtools` MCP in the `ui-designer`-scoped set) and click each trigger (Open Dialog / Open Drawer / fire Toast). Confirm no JS errors in console. If the MCP isn't available at runtime, skip with a `warnings[]` note.

### 18. Finalize + verify

- Write `packages/ui-kit/CHANGELOG.md` entry — `1.0.0` release lists every primitive, pattern, layout, token scale, dial values
- Write `packages/ui-kit/UI-KIT.md` — living consumption guide (import examples, dark-mode toggle, dial-change impact summary)
- Write `packages/ui-kit/.input-fingerprint.json` — hash from step 2 + metadata (regeneration date, resolved-inputs summary)
- Run `pnpm typecheck` in the monorepo
- Run `pnpm lint` against the kit (the ESLint plugin is disabled on kit internals via `overrides` per 022b — it applies to `apps/*` only)
- `validate-consumer` is NOT run against the kit itself — its purpose is to scan `apps/**`, which don't exist yet at this stage
- **Primitives-shipped HARD GATE (refactor-006)** — count non-test `.tsx` files under `packages/ui-kit/src/primitives/`:

  ```bash
  node scripts/verify-024.mjs --primitives-count
  # OR inline:
  find packages/ui-kit/src/primitives -maxdepth 3 -name '*.tsx' -not -name '*.test.tsx' 2>/dev/null | wc -l
  ```

  **Threshold: ≥12 core primitives** (the mandatory roster from step 9c). If below threshold, the stage **fails** — return `success: false` with abort-reason:

  ```
  primitives-shipped-gate-failed: authored N of 12 mandatory core primitives.
  Missing: [list-from-roster-minus-shipped].
  gate-3 componentsApproved[] cannot be approved until the core roster ships —
  downstream builders have no import surface. Re-author missing primitives then
  re-run /stylesheet.
  ```

  Orchestrator (035) retries via Layer 5 stage-level retry (up to 3 attempts). After exhaustion, human review via normal failed-stage escalation.

  **History (what this gate prevents):** before refactor-006, this was a soft warning. Six projects (hatch, gotribe-v1, mindapp, mindapp-v2, runclub, test-app) shipped tokens-only — hatch-2 surfaced the gap at build time when builders fell back to plain HTML + Tailwind. Bug-001 Layer B (feat-013) retro-shipped hatch-2's kit; refactor-006 closes the systemic hole.

- Emit return JSON (include `primitivesShipped: string[]` — the kebab-names of every primitive directory under `src/primitives/`)

## Full asset-download wave (second of two)

This is the SECOND MCP download wave — partial happened during `/mockups`; full runs here.

- **Scope**: only MCP servers scoped to `ui-designer` in `.mcp.json`, filtered by `feature_flag` (e.g. `image-generator` only when `--nanobanana` is on)
- **Budget**: respect per-server budget. Tracked by the orchestrator (035) against the stage-budget cap resolved from `~/.claude/models.yaml`. Enforced via reserve-commit (task 036 gate mechanics)
- **Download this wave**:
  - Full icon set referenced across all `docs/analysis/{platform}/screens.json` (via `icons` field per screen)
  - All font weights referenced in the kit's type scale (usually 400, 500, 600, 700 + italic variants if styles.md declares them)
  - Hero/background images for screens marked `hero: true` in screens.json
  - Empty-state illustrations for screens referenced by `EmptyState` pattern instantiations
- **De-duplication**: compare against `docs/mockups/style-{K}/manifest.json.assets[]` for the winning style K. Assets already downloaded there are reused, not re-billed
- **Failure policy**: if budget exhausts mid-download, write partial kit + `docs/design-system-gaps.md` listing missing assets with suggested manual fallbacks. Do NOT silently generate lower-quality substitutes

## Versioning policy

- First successful run locks `ui-kit@1.0.0`
- Re-runs of `/stylesheet` bump according to what changed:
  - Token value change (hex, font family, scale value) → **major** (e.g. `2.0.0`)
  - New primitive / new pattern / new layout / new variant → **minor** (`1.1.0`)
  - Bug fix / illustration swap / story addition → **patch** (`1.0.1`)
- The skill writes a `packages/ui-kit/CHANGELOG.md` diff entry per re-run
- Downstream apps pin a specific version in their `package.json`; a version bump requires deliberate consumer update, not a silent rebuild

## Re-run idempotency

Running `/stylesheet` twice with the same `docs/selected-style.json` and unchanged inputs must produce byte-identical kit output (same token values, same component source, same Storybook build). Step 2's fingerprint check enforces this.

## Return JSON

```json
{
  "success": true,
  "styleId": "style-03",
  "kitVersion": "1.0.0",
  "tokenCount": 128,
  "primitiveCount": 20,
  "patternCount": 12,
  "layoutCount": 5,
  "primitivesList": ["button", "input", "textarea", "..."],
  "patternsList": ["empty-state", "data-table", "..."],
  "layoutsList": ["app-shell", "split-view", "..."],
  "iconCount": 86,
  "illustrationsCount": 5,
  "nanobananaUsed": false,
  "imagesGeneratedCount": 0,
  "imagesStockCount": 0,
  "imagesVectorFallbackCount": 5,
  "assetsDownloaded": { "icons": 72, "fonts": 8, "images": 4 },
  "assetsDedupedFromMockups": 14,
  "tokensPackagePath": "packages/ui-kit/",
  "storybookPath": "packages/ui-kit/storybook-static/index.html",
  "previewPath": "docs/design-system-preview.html",
  "budgetExhausted": false,
  "gapsPath": null,
  "warnings": [],
  "noChange": false
}
```

Matches `StylesheetOutput` in task 034b.

## Output contract summary

- `packages/ui-kit/` exists and `pnpm typecheck` passes
- `packages/ui-kit/src/index.ts` exports every primitive, pattern, layout; no internal paths
- `packages/ui-kit/storybook-static/` is built
- `packages/ui-kit/CHANGELOG.md` entry written
- `docs/design-system-preview.html` covers every primitive × variant + pattern × state + layout × breakpoint
- `docs/design-system-gaps.md` exists ONLY when budget was exhausted mid-run
- Return JSON matches `StylesheetOutput` schema

## Post-stage verification

Orchestrator invokes `/verify-html` (task 032b) against `docs/design-system-preview.html`. Layer 6 catches mechanical issues. HITL gate 3 (task 036) runs against the Storybook build — human previews the kit before `/screens` starts composing from it.

## Error handling

- `docs/selected-style.json` missing → abort: "`/stylesheet` requires `docs/selected-style.json`. Run `/mockups` first and complete gate 2."
- `SelectedStyleSchema` fails → abort with Zod error path and exit non-zero
- `packages/ui-kit/` skeleton missing → abort: "`packages/ui-kit/` skeleton not found. Run `/new-project <name> --force` to refresh scaffold."
- `pnpm build-storybook` fails → write `docs/design-system-gaps.md`, emit `{ success: false, ...errors }`; do NOT advance the pipeline
- `--nanobanana` budget exhausted mid-download → write partial kit + `docs/design-system-gaps.md`, emit `budgetExhausted: true` in return JSON; orchestrator decides whether to retry with higher budget or surface to human
- `tokens.json` fails W3C DTCG schema validation → abort; either inputs were malformed or the generator has a bug
- `node-vibrant` fallback invoked BUT styles.md + brand-extracted.yaml both have complete palettes → abort; indicates a resolution-order bug. Fix step 3 before rerunning
- `pnpm typecheck` fails on the kit → abort; surface TypeScript errors in return JSON's `warnings[]` and set `success: false`
- `package.json.exports` field missing or permissive (allows deep imports) → abort; the restricted exports are a load-bearing 022b invariant

## Integration Points

- **Task 018** (`/scan-assets`): produces `docs/asset-inventory.json` — prerequisite (user assets have precedence)
- **Task 019** (`/analyze`): produces `docs/analysis/shared/styles.md` + `assets.md` — authoritative for tokens
- **Task 022** (ui-designer agent): invokes this skill with the winning style context
- **Task 022b** (UI Kit contract): consumer-contract artifacts land inside `packages/ui-kit/` HERE (real implementations, not 027's stubs)
- **Task 023** (`/mockups`): writes `docs/selected-style.json` (or gate 2 server does) + per-style manifest used for de-dup
- **Task 025** (`/screens`): composes screens from this kit ONLY; must pin the exact kit version
- **Task 025b** (`/visual-review`): LLM-critiques screens composed from this kit
- **Task 026** (Turborepo + pnpm workspace): `/new-project` step 5b scaffolds the monorepo baseline that this kit lives inside
- **Task 027** (shared packages skeleton): `/new-project` step 5b scaffolds empty `packages/ui-kit/` skeleton that this skill populates
- **Task 032b** (`/verify-html`): validates `docs/design-system-preview.html`
- **Task 034b** (schemas): `StylesheetOutput` must cover the return-JSON shape
- **Task 035** (orchestrator): invokes this skill after mockup gate 2 closes; propagates `--nanobanana` state
- **Task 036** (HITL gates): gate 3 serves the Storybook build for human design-system review
- **Task 041** (MCP registration): provisions `icons8`, `unsplash`, conditionally `image-generator` at `/new-project` step 5b

## Related skills / files

- `.claude/skills/stylesheet/SKILL.md` — this file
- `.claude/skills/mockups/SKILL.md` — preceding stage; de-dup partner
- `.claude/agents/ui-designer.md` — the agent whose identity this skill embodies
- `.claude/templates/ui-kit-contract.md` — 022b factory template for `CONTRACT.md`
- `.claude/templates/ui-kit-tsconfig-consumer.json` — 022b factory template for path aliases
- `.claude/templates/ui-kit-validate-consumer.ts` — 022b factory template for the grep validator
- `.claude/templates/ui-kit-eslint-plugin/` — 022b factory templates for the four ESLint rules
- `scaffolding/09-034b-output-contract-zod-schemas.md` — defines `StylesheetOutput` + `SelectedStyleSchema`
- `scaffolding/21-035-orchestrator-core.md` — invokes this skill; post-stage retry logic
- `scaffolding/22-036-hitl-gates.md` — gate 3 (design-system review) serves Storybook
- `scaffolding/11-041-mcp-server-registration.md` — `.mcp.json` provisioning

## HITL gate 3 backing-server contract (task 036 must honor)

The Storybook build + `docs/design-system-preview.html` emitted here are the artifacts gate 3 reviews. The gate server:

1. Serves `storybook-static/` + `design-system-preview.html` over HTTP (port assigned dynamically)
2. Surfaces a "Approve kit" / "Request changes" control
3. On approve → write `docs/signoff-stylesheet-{timestamp}.json` with `{ kitVersion, approvedAt, approvedBy, inputFingerprint, componentsApproved: [...] }`. The `componentsApproved` array is the FULL list of component names (from `.components-plan.json`) rendered on the preview. This is the handshake `/screens` reads to enforce: **any screen whose `components[]` array contains a name NOT in `componentsApproved` is rejected**. Prevents unreviewed components leaking into composed screens.
4. On "Request changes" → write `docs/design-system-feedback.md` with the reviewer's notes; orchestrator re-invokes this skill with the feedback as input context. If the reviewer objects to a specific component's look-and-feel, gate 3 can emit `componentsRejected: ["wallet-balance", ...]` which forces re-generation of only those patterns in the next `/stylesheet` run.

Server lifecycle: started when orchestrator enters gate 3, killed when signoff is written. Port assigned dynamically; orchestrator passes the base URL to the reviewer.

## Acceptance criteria

- [ ] `.claude/skills/stylesheet/SKILL.md` exists with the frontmatter above
- [ ] Reads `docs/selected-style.json` and validates against `SelectedStyleSchema`
- [ ] Produces `packages/ui-kit/` matching the directory structure above
- [ ] `tokens.json` is W3C DTCG format with all required top-level keys (color / typography / spacing / radius / shadow / motion / zIndex)
- [ ] `tokens.css` + `tokens.ts` + `tailwind.config.ts` are generated, not hand-authored
- [ ] Dial → token mapping rules applied: `visual_density` drives spacing defaults, `motion_intensity` drives duration defaults, `design_variance` drives layout-template defaults
- [ ] ≥20 primitives present, each with `.tsx` + `.variants.ts` + `.stories.tsx` + `index.ts`
- [ ] Every primitive has the required variants from the table
- [ ] ≥12 patterns present, composed from primitives (never reinvented)
- [ ] ≥5 layouts present
- [ ] Every component has all 5 interaction states + dark-mode via CSS variables
- [ ] Accessibility: proper ARIA, keyboard navigation, focus management, contrast AA minimum; axe checks pass in Storybook
- [ ] CVA used for every variant definition (not ad-hoc `className` switching)
- [ ] `--nanobanana` gates only the `illustrations/` step; everything else is always code-gen
- [ ] Illustrations fall back to unDraw vectors when `--nanobanana` is off
- [ ] 022b artifacts (`CONTRACT.md`, `eslint-plugin/`, `scripts/validate-consumer.ts`, `tsconfig.consumer.json`) land inside `packages/ui-kit/` with real implementations
- [ ] `src/index.ts` is the only public surface; no internal paths re-exported
- [ ] `package.json` `exports` field restricts subpath access to `./styles/*.css` + `./eslint-plugin`
- [ ] `package.json` version starts at `1.0.0` on first run; re-runs follow semver bump rules
- [ ] Storybook build succeeds; `storybook-static/` populated
- [ ] `docs/design-system-preview.html` covers every primitive × variant + pattern × state + layout × breakpoint
- [ ] Full asset-download wave respects budget; on exhaustion writes `docs/design-system-gaps.md` + partial kit
- [ ] De-duplicates against `docs/mockups/style-{K}/manifest.json.assets[]`
- [ ] Re-run with unchanged inputs is a no-op (`noChange: true` in return JSON; byte-identical kit)
- [ ] `packages/ui-kit/CHANGELOG.md` entry written per run
- [ ] Return JSON matches `StylesheetOutput` in task 034b
- [ ] Dark-mode derivation rules documented in `packages/ui-kit/src/tokens/README.md`
- [ ] Icon library resolution: `docs/selected-style.json.iconLibrary` is the single library the kit ships (refactor-003 — locked at gate 2, NOT from architect which runs later); user-supplied icons in `asset-inventory.json` still take precedence over library equivalents
- [ ] `validate-consumer.ts` is NOT run against the kit itself in the verify step (glob targets `apps/*` only per 022b)
- [ ] Post-stage `/verify-html` invocation wired via orchestrator
- [ ] HITL gate 3 invariant: signoff binds `{ kitVersion, inputFingerprint }` — drift detection for downstream stages

## Gate 3 Handoff (post-stage HITL pause)

When `/stylesheet` completes, the orchestrator pauses for human review of `packages/ui-kit/` (primitives + patterns + layouts + Storybook) + `docs/design-system-preview.html`. To resume, write ONE of the following directives to **`docs/gate-3-approved.txt`**:

- **`proceed`** — design-system approved; pipeline continues to `/screens`. The kit version at `packages/ui-kit/package.json.version` becomes the binding `uiKitVersion` for gate 4 sign-off.
- **`revise:<note>`** — reject with a note; pipeline halts. Hand-patch the kit OR re-run `/stylesheet` after editing inputs (e.g. `docs/selected-style.json` dials), then drop a fresh `proceed`.
- **`abort`** — stop the pipeline entirely.

The orchestrator recomputes the kit's `inputFingerprint` on drop; if `packages/ui-kit` is dirty relative to the fingerprint recorded at stage start, the gate rejects with `stale-kit` and the operator must re-run `/stylesheet` to produce a fresh preview.
