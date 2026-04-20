---
id: refactor-001-ui-designer-kit-pipeline
type: refactor
status: archived
author-agent: claude
created: 2026-04-20
updated: 2026-04-20
approved-at: 2026-04-20
approved-by: human
completed-at: 2026-04-20
archived-at: 2026-04-20
parent-plan: null
supersedes: null
superseded-by: null
branch: refactor/ui-designer-kit-pipeline
affected-files:
  - scaffolding/020-architect-agent.md
  - scaffolding/022-ui-designer-agent.md
  - scaffolding/022b-ui-kit-contract.md
  - scaffolding/023-mockups-skill.md
  - scaffolding/024-stylesheet-skill.md
  - scaffolding/025-screens-skill.md
  - scaffolding/025b-visual-review-skill.md
  - scaffolding/027-shared-packages.md
  - scaffolding/029-web-frontend-builder.md
  - scaffolding/030-mobile-frontend-builder.md
  - scaffolding/034-output-contracts.md
  - scaffolding/034b-output-contract-zod-schemas.md
  - scaffolding/035-orchestrator-core.md
  - scaffolding/036-hitl-gates.md
  - scaffolding/041-mcp-server-registration.md
  - scaffolding/000-scaffolding-index.md
  - multi-agent-app-generation-blueprint.md
feature-area: design-pipeline
priority: P1
attempt-count: 1
max-attempts: 5
---

# refactor-001: UI Designer → UI Kit Pipeline

## Problem Statement

Current scaffolding (tasks 022–025) models the UI Designer as producing mockups → design tokens → screens. Research (user conversation 2026-04-20) identified five structural gaps:

1. **No single clear style-selection gate.** `/mockups` already supports N styles via `--style-count`, but the review UX isn't defined, mockups don't reliably span every detected app, and the selection contract with downstream stages is hand-wavy.
2. **Tokens, stylesheet, and component library are scattered.** Task 024 produces `packages/tokens/` + `packages/ui/primitives/`, but they are not treated as one versioned **UI Kit** package with a single public API. Frontend builders (029, 030) have no kit-only-import contract, so styling drift is the default failure mode.
3. **No visual self-review loop.** Task 032b (HTML Verifier) is mechanical regex. Nothing screenshots a rendered screen at 3 viewports and critiques it against a rubric — the loop that cures "v0/Lovable default output."
4. **No image generation strategy.** Blueprint mentions `image-generator` MCP; no agent knows _when_ to use Nano Banana (hero, empty states) vs _never_ (UI chrome, icons). Cost/off switch is not user-controllable.
5. **No anti-slop constraints.** Agent prompts don't ban "AI lila" gradients, centered hero + gradient CTA, Inter-only typography, 3-column card grids, or cliché copy. Without explicit bans, the model defaults to generic.

Downstream, web-frontend-builder (029) and mobile-frontend-builder (030) import `@repo/ui` but have no rule forbidding raw styling — so even a great UI Kit gets bypassed screen-by-screen.

## Approach

Keep the existing 5-stage pipeline shape but **make `/mockups` the single style-selection gate** that spans all detected apps. Consolidate tokens + stylesheet + component library into one versioned `@repo/ui-kit`. Add a visual self-review loop. Make image generation opt-in via a pipeline-wide `--nanobanana` flag. Bake anti-slop constraints into prompts, hooks, and the review rubric.

### Pipeline shape

```
/analyze [N styles]
  → /mockups [M apps × N styles grid; 1 rep screen per app per style by default]
      [HITL gate: pick 1 style → docs/selected-style.json]
  → /stylesheet     builds @repo/ui-kit from selected-style.json + styles.md block
      [HITL gate: kit preview]
  → /screens        all remaining screens, composed from kit only
  → /visual-review  [NEW] Playwright screenshots + rubric, feeds retry loop
  → /user-flows-generator
      [HITL gate: final sign-off]
```

No separate `/style-direction` stage. `/mockups` IS the style gate — it already produces N mockup sets under `docs/mockups/style-{K}/`; this plan extends it across M apps and defines the selection contract and modal review UX.

### `/mockups` as the style gate — the core mental model

**Inputs:**

- `docs/brief-summary.json` → detected platforms (M apps: e.g. `webapp`, `mobile`, `admin`)
- `docs/analysis/shared/styles.md` → N style blocks (one per direction), each with hex colors, fonts, scales, named references, and proposed dials
- `docs/analysis/shared/assets.md` → per-style font URLs and icon library choice
- `docs/analysis/{platform}/screens.json` → authoritative per-platform screen list

**Output grid:** for `N` styles × `M` apps, produce `N × M` HTML mockups by default (one representative "home" screen per app, per style).

```
docs/mockups/
├── index.html                  style-chooser grid (N rows × M columns)
├── style-00/
│   ├── dials.yaml              editable at gate
│   ├── manifest.json           list of mockups + provenance
│   ├── webapp/home.html
│   ├── mobile/home.html
│   └── admin/dashboard.html
├── style-01/
│   ├── dials.yaml
│   ├── manifest.json
│   ├── webapp/home.html
│   ├── mobile/home.html
│   └── admin/dashboard.html
├── ...
└── archive/                    losing styles move here after gate
```

**Count argument refined (`$ARGUMENTS` on `/mockups`):**

- **No arg (default):** one representative screen per app per style. `N=10, M=3 → 30 files`. Scanning a row answers "does this style hold across webapp + mobile + admin together?" — enough for style selection.
- **`/mockups C`:** C archetype screens per app per style. Archetypes greedy-picked (home, list, detail, form, empty-state, …). `N=10, M=3, C=3 → 90 files`. Use when one screen per app isn't enough signal.
- **`/mockups 0` or negative:** reject with clear error.
- **`C > available archetypes`:** clamp to available, emit warning.

**Review UX (`docs/mockups/index.html`):**

- Grid: `N` rows (one per style) × `M` columns (one per detected app, labeled "Webapp · home" / "Mobile · home" / "Admin · dashboard")
- Each row header: index · style name · palette swatch · named references · dials badge · "Choose this style →" button
- Each cell: clickable thumbnail of the mockup. Click opens a **full-screen modal** with the real scrollable mockup loaded via iframe at that style's tokens.
- Modal chrome: viewport switcher (mobile 390×844 / tablet 820×1180 / desktop 1400×900), per-style dials editor, "Choose this style" CTA, close (Esc/backdrop).
- Visual prior-art for this UX is at `plans/active/refactor-001-style-grid-preview.html` (the interactive demo built in the research conversation).
- Sticky footer reflects `--nanobanana` state (on/off) and budget so the reviewer knows what was paid for.

**Dial editing at the gate:** styles.md ships per-style dial defaults (variance/motion/density, 1–10). The modal exposes sliders that write back to `docs/mockups/style-{K}/dials.yaml` before selection. Dials carried into `/stylesheet` control token spacing scale, motion preset density, and layout-template variance.

### Selection → downstream propagation (the contract)

This is the mechanic that "sends the mockup choice" to `/stylesheet` and everything after.

**When the reviewer clicks "Choose this style →"** on row K, the HITL gate handler (task 036):

1. Writes `docs/selected-style.json` with the full payload:
   ```json
   {
     "version": "1.0",
     "styleId": "style-03",
     "styleName": "Cobalt Pro",
     "selectedAt": "2026-04-20T14:22:00Z",
     "selectedBy": "human",
     "dials": {
       "design_variance": 2,
       "motion_intensity": 2,
       "visual_density": 8
     },
     "appsCovered": ["webapp", "mobile", "admin"],
     "mockupsManifest": "docs/mockups/style-03/manifest.json",
     "stylesSourceRef": "docs/analysis/shared/styles.md#style-03",
     "nanobananaUsed": false
   }
   ```
2. Moves losing style directories from `docs/mockups/style-{K}/` → `docs/mockups/archive/style-{K}/` with an `archived.json` breadcrumb naming the winner + timestamp. The winner stays in place.
3. Orchestrator detects the file, validates against a Zod schema (task 034b adds `SelectedStyle`), and proceeds to `/stylesheet`.

**What `/stylesheet` reads to build the kit:**

- `docs/selected-style.json` → which styleId + dials to use
- `docs/analysis/shared/styles.md` → jump to the matching block for exact hex values, font families, scale specs (already richer than anything we could re-derive from mockups)
- `docs/analysis/shared/assets.md` → font URLs, icon library choice for that style
- `docs/mockups/style-03/manifest.json` → downloaded assets inventory (to de-dup against the full-asset-download wave)
- `docs/mockups/style-03/dials.yaml` (if edited at gate; else dials from selected-style.json are authoritative)

**What every downstream stage reads:**

- `/stylesheet`, `/screens`, `/visual-review`, and the builder agents (029, 030) all dereference `selected-style.json` first. That single file is the binding handshake between "a human chose this look" and "every generator must conform to it."

**Mutation rule:** once `selected-style.json` is written, changing it counts as a design change and triggers a new HITL loop (not a silent stylesheet rebuild). This prevents mid-pipeline drift.

### Single-package UI Kit

`packages/tokens` + `packages/ui` collapse into one consolidated **`packages/ui-kit`** with the structure from the spec (§2): `tokens/`, `styles/`, `lib/`, `primitives/`, `patterns/`, `layouts/`, `icons/`, `illustrations/`. It is semver'd. Frontend builders get one rule: `import { X } from '@repo/ui-kit'`. No deep imports. No raw CSS. No token literals.

### `--nanobanana` toggle

`/mockups`, `/stylesheet`, `/screens`, `/visual-review` accept `--nanobanana` (opt-in). Pipeline-wide: orchestrator accepts it once and propagates. When absent:

- Hero/marketing imagery: `unsplash` MCP (scoped to hero use)
- Empty-state / onboarding illustrations: unDraw MIT-licensed vector set + Lucide icons
- Avatars: `picsum.photos/seed/{word}`
- Per-asset provenance logged as `stock` / `vector` / `researched` (not `generated`)
- `image-generator` MCP omitted from `.mcp.json` for the run

When enabled: hero/empty-state generated via Gemini Nano Banana 2, per the spec's $0.067/image envelope. Cost floor $0 / ceiling ~$3.50 per project.

## Proposed Changes (per scaffolding task)

### UPDATE — scaffolding/022-ui-designer-agent.md

- Replace current permissive prompt with the **opinionated identity** from spec §3 (Senior Product Designer + Design Systems Engineer with the taste of Linear/Stripe/Arc)
- Add **hard bans** list verbatim (centered hero + gradient CTA, Inter-only, 3-column card grid default, emoji headers, shadcn defaults, lorem ipsum, #8b5cf6 purple primary, rounded-full on everything, circular spinners)
- Add **forced constraints** (one accent, saturation <80%, asymmetric layouts when variance>4, real placeholder data, all 5 interactive states, all 4 stateful surface states)
- Add **tone-of-voice rules** for UI copy (verbs > adjectives, specific nouns, no `!` in chrome)
- Add **named-references library** (spec §7) as an embedded table in the system prompt
- Add `image-generator` MCP to `mcp_servers` frontmatter with `feature_flag: nanobanana`
- **Skills frontmatter additions**: `frontend-design` (Anthropic official plugin — additive taste layer, install via `/plugin install frontend-design@claude-plugins-official`), `taste-skill` (Leonxlnx), `platform-design-skills` (ehmo). These are layered; our 022 bans are authoritative and survive plugin changes.
- Clarify that screens MUST import from `@repo/ui-kit` only — no raw HTML with classes once we cross into code-gen

### UPDATE — scaffolding/023-mockups-skill.md (the single style gate)

Substantive rewrite. Key changes:

- **N × M grid semantics.** Read `docs/brief-summary.json` for detected apps; read `styles.md` for N styles; produce `N × M` mockups under `docs/mockups/style-{K}/{app}/{screen}.html`. Per-app representative screen is analyst-picked from `screens.json` (home/dashboard/landing as app-appropriate).
- **Count argument** (`$ARGUMENTS`): default=1 archetype/app/style; `C>1` expands to C archetypes/app/style via greedy archetype selection (spec'd already; reuse).
- **Per-style assets.** Keep hybrid fallback table from current 023. Add: only what the representative set needs. Defer hero/illustration fetches to `/stylesheet`.
- **`--nanobanana` argument.** When absent: orchestrator drops `image-generator` MCP from scope; hero/empty-state images come from Unsplash + unDraw + picsum.
- **Anti-slop self-check** before writing each mockup file: grep the generated HTML for raw `#[0-9a-f]{6}` (no tokens), `linear-gradient(.*, (purple|violet|#8b5cf6|#a855f7))`, `Lorem ipsum`, copy clichés (`Elevate|Seamless|Unleash|Next-Gen|Empower|Transform your`). Regenerate on hit; don't write.
- **Review UX output:** `docs/mockups/index.html` is an interactive N-row × M-column chooser with the modal viewer described above. Reference implementation: `plans/active/refactor-001-style-grid-preview.html`.
- **Per-style dials file** (`docs/mockups/style-{K}/dials.yaml`) emitted alongside mockups; editable at gate.
- **Per-style manifest** (`docs/mockups/style-{K}/manifest.json`) listing all mockups with per-asset provenance — consumed by `/stylesheet` to de-dup downloads.
- **Return JSON** adds: `styleCount`, `appsCovered: [...]`, `mockupsPerStyle: {...}`, `nanobananaUsed: bool`, `imagesGeneratedCount`, `imagesStockCount`, `imagesVectorFallbackCount`.
- **Single-style path preserved**: when `styleCount == 1`, `docs/selected-style.json` is written automatically (no gate needed).
- **Post-stage verification** unchanged: `/verify-html` runs after `/mockups`.

### UPDATE — scaffolding/024-stylesheet-skill.md (UI Kit assembly)

- Skill name stays `/stylesheet` for continuity; output is the full kit under `packages/ui-kit/`.
- Replace `packages/tokens/` + `packages/ui/primitives/` outputs with single `packages/ui-kit/` matching spec §2 structure.
- Replace the flat 20-primitive list with the tiered spec: **primitives** (≥20), **patterns** (≥12: EmptyState, ErrorState, DataTable, FormField, PageHeader, Breadcrumbs, SearchCombobox, CommandPalette, FileUploader, FilterBar, Pagination, Notification), **layouts** (AppShell, SplitView, FocusedTask, Marketing, Auth).
- **Require W3C DTCG tokens.json** (spec §5 Stage 2 schema) as the canonical source; `tokens.css` + `tokens.ts` + `tailwind.config.ts` are generated.
- **Require Storybook**: the kit ships a Storybook build as the visual QA surface; non-optional.
- **`--nanobanana`** for the `illustrations/` step; when absent, skip empty-state illustrations or use unDraw vector fallbacks.
- **CVA variants**: each primitive ships `*.variants.ts` using `class-variance-authority` so downstream builders compose, not restyle.
- **Version the kit**: `package.json` gets semver; first lock is `ui-kit@1.0.0`; token changes are major bumps.
- **Export contract**: only `index.ts` barrel is public; primitives/patterns/layouts internal paths forbidden to downstream (tsconfig paths + ESLint rule in task 022b).
- **Input contract reinforced**: reads `docs/selected-style.json` first, then the matching block of `docs/analysis/shared/styles.md` — NOT derived from mockups when styles.md is complete.

### UPDATE — scaffolding/025-screens-skill.md

- Screens MUST compose only from `@repo/ui-kit` imports; no inline styles, no raw `className` beyond layout utilities.
- **`--nanobanana`** argument — affects illustrations used within screens (empty states, hero panels).
- Explicit rule: if a screen needs a primitive/pattern that isn't in the kit, STOP and request it from the UI Designer (bump the kit to a new minor version, re-run `/stylesheet` partially); do not build locally.
- Keep batching, manifest hash, archive, sign-off flow as spec'd.

### NEW — scaffolding/025b-visual-review-skill.md

`/visual-review` skill — new stage, runs after `/screens` but before `/user-flows-generator`.

- **Inputs:** `docs/screens/**/*.html`, `docs/selected-style.json`, `packages/ui-kit/` for the rubric context
- **Action:** for every screen, spin a local static server, open via Playwright MCP at 390×844, 768×1024, 1440×900, screenshot each, run the **visual critique checklist** (spec §10 — composition, type, color, states, motion, mobile, slop-sniff)
- **Output:** `docs/visual-review/{screen}/{viewport}.png`, `docs/visual-review/{screen}/critique.md`, `docs/visual-review/report.json` (summary)
- **Retry loop:** on fail, write structured feedback to `docs/visual-review/retry-feedback-{screen}.md`, orchestrator re-invokes `/screens` for just that screen with feedback injected (max 3 visual retries per screen — separate from HTML-verifier retries)
- **MCP:** Playwright MCP (required), Chrome DevTools MCP (optional for Lighthouse)
- **No nanobanana:** observational, never generative

### NEW — scaffolding/022b-ui-kit-contract.md

Task defining the **UI Kit consumption contract** used by downstream builders. Produces:

- `packages/ui-kit/CONTRACT.md` — the rules frontend builders paste into their prompts (spec §12)
- `.eslintrc` rule: error on `@repo/ui-kit/primitives/*` deep imports, error on `className` containing hex codes or arbitrary values outside approved utilities
- `tsconfig.json` path aliases that expose only `@repo/ui-kit` (not subpaths)
- `packages/ui-kit/scripts/validate-consumer.ts` — CI script any app can run to assert it never broke the contract

### UPDATE — scaffolding/027-shared-packages.md

- Remove `@repo/tokens` and `@repo/ui` as separate packages; add `@repo/ui-kit` as the unified package per spec §2
- Keep `@repo/types`, `@repo/api-client`, `@repo/utils` as-is
- Add `class-variance-authority`, `clsx`, `tailwind-merge`, `@storybook/react-vite` to kit deps
- Add `cn`, `cva` utilities in `packages/ui-kit/lib/`
- `@repo/ui-kit` is a leaf package — imports nothing internal

### UPDATE — scaffolding/029-web-frontend-builder.md

- Replace "Use `@repo/ui` components before creating new ones" + "Tailwind CSS 4 + shadcn/ui" with the hard contract from spec §12:
  - All UI comes from `@repo/ui-kit` imports
  - Never write raw HTML with `className` for styling
  - Never deep-import (`@repo/ui-kit/primitives/*`)
  - Never reference tokens by literal value (no hex, no magic px)
  - If a component is missing, request it from UI Designer via a kit-change ticket — do not build locally
- Post-generation validator: run `pnpm ui-kit:validate-consumer` against `apps/web/` and `apps/admin/`; fail the build if violations detected
- Drop shadcn/ui from the stated stack — the UI Kit _is_ our component library
- Reads `docs/selected-style.json` to assert the build matches the approved style

### UPDATE — scaffolding/030-mobile-frontend-builder.md

- Same contract changes as 029, applied to mobile
- NativeWind tokens come from `@repo/ui-kit/tokens/tokens.ts` (shared across web + native via CSS variable → RN style bridge)
- `.native.tsx` variants live _inside_ `@repo/ui-kit/primitives/*` (platform variants are kit-internal, not downstream-overridden)
- Run consumer validator against `apps/mobile/`

### UPDATE — scaffolding/020-architect-agent.md

- Add `gemini-nano-banana` to the ready-to-use MCP catalog with full config
- Template `architecture.yaml` `tooling.mcp_servers` entry for `image-generator` must include `budget: { max_calls, max_cost_usd }` AND `feature_flag: "nanobanana"` so the orchestrator knows to skip provisioning when the run omits `--nanobanana`
- Add `tooling.design_dials` block with defaults sourced from the brief; analyst refines per style; user finalizes at the mockup gate
- Add `tooling.icon_library` field (Lucide / Phosphor / Heroicons) chosen per style

### UPDATE — scaffolding/034-output-contracts.md

- Layer 6 (HTML Verifier) stays mechanical (032b)
- **Add Layer 7 reference:** `/visual-review` as the LLM-based visual check
- Retry-with-feedback now has two parallel queues: `html-verify` retries (mechanical) and `visual-review` retries (rubric) — both cap at 3 per stage per file
- Add anti-slop grep patterns to Layer 4 hook (`validate-html-write.sh`): reject writes containing `linear-gradient(.*, (purple|violet|#8b5cf6|#a855f7))`, `Lorem ipsum`, cliché copy bigrams

### UPDATE — scaffolding/034b-output-contract-zod-schemas.md

Add/extend schemas:

- **NEW** `SelectedStyleSchema` — version, styleId, styleName, selectedAt, selectedBy, dials, appsCovered, mockupsManifest, stylesSourceRef, nanobananaUsed. Orchestrator validates at the mockup gate.
- **NEW** `VisualReviewOutput` — screensReviewed, passed, failed, violations: [{screen, viewport, rule, detail}], retriesTriggered
- **EXTEND** `MockupsOutput` with: `styleCount`, `appsCovered`, `mockupsPerStyle`, `nanobananaUsed`, `imagesGeneratedCount`, `imagesStockCount`, `imagesVectorFallbackCount`
- **EXTEND** `StylesheetOutput` / `ScreensOutput` with `nanobananaUsed` + image-count fields

### UPDATE — scaffolding/035-orchestrator-core.md

- Keep existing stage list (no `/style-direction` insertion); insert `/visual-review` between `/screens` and `/user-flows-generator`
- Plumb `--nanobanana` pipeline-wide flag: orchestrator accepts it at top level, forwards to every stage, and at provision time toggles `image-generator` MCP registration for the run (absent from `.mcp.json` when off)
- Budget abort: if `nanobanana` on and `total_image_gen_calls` exhausted, orchestrator aborts `/mockups`/`/stylesheet`/`/screens` before over-spend
- At the mockup gate, orchestrator reads the human's selection event, writes `docs/selected-style.json` (validated vs. `SelectedStyleSchema`), and archives losing style directories before advancing to `/stylesheet`

### UPDATE — scaffolding/036-hitl-gates.md

Four gates (unchanged count):

1. After `/analyze` — requirements review
2. After `/mockups` — **style selection** (pick 1 of N styles at the N×M grid; adjust dials; writes `docs/selected-style.json`; losers archived)
3. After `/stylesheet` — kit preview (Storybook URL + `design-system-preview.html`)
4. After `/screens` → `/visual-review` → `/user-flows-generator` — final sign-off (never disable)

The mockup gate is now the single direction-setting gate; make it unskippable when `styleCount > 1`.

### UPDATE — scaffolding/041-mcp-server-registration.md

- Add `gemini-nano-banana` to the catalog with full config, env var (`GOOGLE_API_KEY`), and a `feature_flag: nanobanana` annotation
- Skill must check `architecture.yaml.tooling.mcp_servers[*].feature_flag` against the pipeline run's flag set; omit servers whose flag is off from `.mcp.json` and from every agent's frontmatter
- Add mcp-catalog entries for `playwright` and `chrome-devtools` (required by `/visual-review`) — currently absent

### UPDATE — scaffolding/000-scaffolding-index.md

- Add tasks 022b (ui-kit-contract) and 025b (visual-review) to Tier 6
- Re-order Tier 7: 027 (refactored UI Kit) comes _before_ 029/030 in dependency chain
- No 022a / `/style-direction` task — do not add one

### UPDATE — multi-agent-app-generation-blueprint.md

- Section 10 (Pipeline Stages): clarify `/mockups` as the N-style × M-app gate; add `/visual-review` stage
- Section 11 (HITL): keep 4 gates; rewrite gate #2 to reflect the N×M selection UX
- Section 14 (MCP): add `feature_flag` field to server spec; document `--nanobanana` contract
- Section 13 (Output contracts): add Layer 7 visual-review reference
- Section 12 (User flows sign-off): unchanged, still the final gate
- Add a "Selection contract" subsection near §11 documenting the `docs/selected-style.json` schema and downstream read pattern

## Rejected Alternatives

1. **Keep packages split (`@repo/tokens` + `@repo/ui`), add a thin facade package.** Rejected — facade-only hides structure but doesn't prevent deep imports; split remains a footgun for downstream agents.
2. **Always-on nano-banana with hard budget.** Rejected — users will want free runs for prototyping, and Unsplash + unDraw covers most free needs. `--nanobanana` opt-in is a half-step to full image autonomy later.
3. **Dedicated `/style-direction` mood-board stage before `/mockups`.** Rejected — `/mockups` already produces per-style sets; adding a mood-board pre-filter creates two gates and duplicates the signal. Mockups _are_ the mood board, applied to real product surfaces.
4. **Single monolithic `/design` skill covering all stages.** Rejected — the existing staged pipeline with HITL gates is the research-validated pattern; one stage = one gate = one rollback point.
5. **Generate screens as React JSX immediately (not HTML).** Rejected for the design pipeline — HTML mockups iterate 10× faster, don't need typecheck gates, and the screen → JSX translation happens at `/build-frontend` against the final kit.
6. **Skip Storybook to save time.** Rejected — it is the visual contract between Designer and Builder agents.
7. **Import `frontend-design` plugin rules directly into 022's system prompt.** Rejected — plugin is Anthropic-maintained and may shift; reference by name in `skills:` frontmatter, keep our version-controlled bans authoritative.

## Expected Outcomes

1. A single versioned `@repo/ui-kit` that frontend builders are structurally unable to bypass
2. `/mockups` as an interactive N×M grid where the user selects once, dials can be edited in-place, and the contract to downstream stages is a single JSON file
3. Screenshot-based visual critique loop as part of the pipeline, not as a wish
4. `--nanobanana` opt-in keeps cost floor at $0 image spend while preserving ~$3.50/project imagery when enabled
5. Anti-slop bans baked into system prompts + hooks + visual review = three independent layers of "no AI lila gradient"
6. Downstream builders (029, 030) have a narrow, typed API — eliminating styling drift
7. `frontend-design` plugin + `taste-skill` + `platform-design-skills` stacked as additive taste layers beneath 022's authoritative prompt

## Validation Criteria

- `packages/ui-kit/` exists as a single package after `/stylesheet`; `packages/tokens/` and `packages/ui/` no longer exist
- `/mockups` with `N=10, M=3` produces 30 mockup HTML files in the documented directory layout
- `docs/mockups/index.html` loads as an interactive grid; clicking a cell opens a modal with a full scrollable mockup; choose button writes a schema-valid `docs/selected-style.json`
- Losing style directories present in `docs/mockups/archive/` after selection; winner remains in `docs/mockups/style-{K}/`
- `/stylesheet` dereferences `docs/selected-style.json` and builds `@repo/ui-kit` from the matching styles.md block
- Every web and mobile screen file imports from `@repo/ui-kit` only; ESLint rule catches deep imports as errors
- Storybook build succeeds for the kit before `/screens` runs
- Running pipeline with `--nanobanana` absent consumes zero image-gen credits (run report: `imagesGeneratedCount: 0`)
- Running with `--nanobanana` present consumes ≤ `total_image_gen_calls` budget; orchestrator aborts before overspend
- `/visual-review` produces screenshots at 3 viewports for every screen and a critique.md per screen
- Sign-off gate rejects any pipeline where `visual-review.failed > 0`
- Hand-authored mockup with `linear-gradient(to right, #a855f7, #3b82f6)` on a CTA is blocked by Layer 4 hook
- Generated screen with `<button>` instead of `Button` primitive is caught by Layer 6 verifier

## Gap Analysis (self-check)

| Area                                     | Addressed?  | Notes                                                                  |
| ---------------------------------------- | ----------- | ---------------------------------------------------------------------- |
| `/mockups` as N×M style gate             | ✅          | 023 rewrite                                                            |
| Modal review UX spec                     | ✅          | 023 + demo preview file                                                |
| Selection JSON contract                  | ✅          | 023 + 034b (`SelectedStyleSchema`) + 036                               |
| Loser archiving mechanic                 | ✅          | 023 + 036                                                              |
| Dial editing at gate                     | ✅          | 023 (per-style dials.yaml)                                             |
| Anti-slop rules in prompt                | ✅          | 022 update                                                             |
| Anti-slop hook                           | ✅          | 034 (Layer 4 extension)                                                |
| Tokens/stylesheet/library as one kit     | ✅          | 024 + 027                                                              |
| Storybook as visual contract             | ✅          | 024                                                                    |
| Semver for the kit                       | ✅          | 024                                                                    |
| Public API lock                          | ✅          | 022b (ESLint + tsconfig paths)                                         |
| Visual self-review                       | ✅          | 025b                                                                   |
| Nano Banana integration + wrapper        | ✅          | image-generator MCP + wrapper in 024                                   |
| `--nanobanana` flag threading            | ✅          | 023/024/025/025b/035                                                   |
| Builder contract (web)                   | ✅          | 029                                                                    |
| Builder contract (mobile)                | ✅          | 030                                                                    |
| Playwright/Chrome DevTools MCPs          | ✅          | 041 catalog                                                            |
| Dials (variance/motion/density)          | ✅          | 020 (defaults) + analyst styles.md + 023 gate edit                     |
| Named references library in prompt       | ✅          | 022                                                                    |
| `frontend-design` plugin integration     | ✅          | 022 skills frontmatter (additive, not authoritative)                   |
| `taste-skill` + `platform-design-skills` | ✅          | 022 skills frontmatter                                                 |
| Schema contracts for new outputs         | ✅          | 034b (SelectedStyle, VisualReviewOutput, extensions)                   |
| Orchestrator plumbing                    | ✅          | 035                                                                    |
| HITL gates updated                       | ✅          | 036 (4 gates, mockup is the style gate)                                |
| Blueprint reconciliation                 | ✅          | Blueprint update scoped                                                |
| Icon library selection                   | ✅          | 020 adds `tooling.icon_library`                                        |
| Figma MCP (handoff)                      | ➖ Deferred | List in 041 catalog as optional future add                             |
| Dark mode                                | ✅          | Implicit via tokens.css custom properties                              |
| Accessibility (axe)                      | ✅          | 024 Storybook gate                                                     |
| Backend builder unaffected               | ✅          | 028 untouched                                                          |
| Reviewer asserts kit contract            | ⚠ Minor     | Add one-liner to 032: at code review, assert consumer-validator passes |
| Lessons agent feeds anti-pattern log     | ⚠ Minor     | Spec §14 anti-pattern log routes through 037                           |

Items marked ⚠ are minor follow-ups, captured as sub-tasks — no plan-blocking gap remains.

## Implementation Order

1. **020, 022, 041** — prompt + MCP registration + feature flag plumbing (foundations)
2. **022b, 025b** — new UI Kit contract task + visual-review skill
3. **023** — rewrite `/mockups` for N×M grid + modal + selection contract
4. **024, 025** — `/stylesheet` kit assembly + `/screens` kit-only composition
5. **027** — consolidate packages into `@repo/ui-kit`
6. **029, 030** — lock builder contracts
7. **034, 034b, 035, 036** — schemas, orchestrator, gates
8. **000 + blueprint** — index + spec alignment last

Each step lands as its own PR. The dependency order prevents half-refactored states.

## Attempt Log

### Attempt 1 — 2026-04-20

Completed implementation across eight steps. Each step was self-reviewed for bugs/inconsistencies before advancing.

**Step 1** — foundations: 020 (architect + feature_flag + design_dials + icon_library), 022 (UI Designer opinionated identity + hard bans + named refs), 041 (feature_flag mechanics + playwright/chrome-devtools catalog). Review fixes: plugin skill-name lock-in softened to provisional; packages listing updated.

**Step 2** — new tasks: 022b (UI Kit consumption contract — ESLint plugin + validate-consumer.ts + CONTRACT.md), 025b (/visual-review — Layer 7 LLM critique + rubric + dial-aware severity). Review fixes: ESLint plugin name consistency; CSS import exception; kit-internal exemption; dark-mode rule as static CSS analysis.

**Step 3** — 023 rewrite for N × M style-selection gate: interactive index.html with modal + dial editor, selection writes docs/selected-style.json, anti-slop self-check, --nanobanana flag. Review fixes: archetype fallback; 2-pass asset download; top-level manifest schema; backing-server contract.

**Step 4** — 024 + 025 updated for unified kit: 024 as UI Kit assembly (tokens.json DTCG → tokens.css/ts/tailwind), 20/12/5 primitives/patterns/layouts with CVA + Storybook; 025 kit-consuming composition with single-screen retry mode. Review fixes: HTML-vs-React tension resolved via CSS-surface consumption; orchestrator-owned sequencing; POST /api/signoff mechanism.

**Step 5** — 027 consolidated `@repo/tokens` + `@repo/ui` into `@repo/ui-kit` skeleton. Review fixes: dependency count; pnpm workspace glob for nested ESLint plugin; CONTRACT.md authored from factory template at day zero.

**Step 6** — 029 + 030 locked to kit contract: CONTRACT.md verbatim in system prompts; HTML→JSX translation via `data-kit-*` attributes (contract back-ported to 025); dropped shadcn/ui + RN Reusables; kit version pinned from sign-off. Review fixes: data-kit-\* attribute protocol (not imagined class prefixes); 028 added to depends-on; NativeWind ingestion via metro.config.js.

**Step 7** — loop closure: 034 (7 layers + Layer 0 for TS/TSX; anti-slop grep in Layer 4; two parallel retry queues), 034b (SelectedStyleSchema + VisualReviewOutput + discriminated-union ScreensOutput + extended Signoff/Mockups/Stylesheet + three separate Build schemas + platform-id/target split with mapper), 036 (four gates with backing HTTP servers on dynamic ports; POST /api/dials, /api/select, /api/signoff with hash + kit-version binding; reserve-commit budget), 035 (visual-review stage insertion + pipeline-wide flag threading + per-screen retry loop + kit-change-request detour). Review fixes: Layer 4 PostToolUse ordering; config key alignment with stage names; server shutdown via server.close(); PipelineStage.args field; platform-naming deliberate split.

**Step 8** — closeout: 000-scaffolding-index updated (tier 6 extended with 022b + 025b); blueprint got a refactor-001 addendum at the top preserving line references for the hundreds of scaffolding cross-refs.

**Outcome:** scaffolding fully internally consistent; deferred cross-task follow-ups flagged in 025 (kit-change-request PM flow) and 020 (`tooling.icon_library`). No pipeline code written yet — this refactor updated only task specs that will be executed in the normal /new-project flow.

---

# COMPLETION RECORD (appended to archived plan)

```yaml
completed: 2026-04-20
outcome: success
actual-files-changed:
  - scaffolding/020-architect-agent.md (modified)
  - scaffolding/022-ui-designer-agent.md (modified)
  - scaffolding/022b-ui-kit-contract.md (created)
  - scaffolding/023-mockups-skill.md (modified)
  - scaffolding/024-stylesheet-skill.md (modified)
  - scaffolding/025-screens-skill.md (modified)
  - scaffolding/025b-visual-review-skill.md (created)
  - scaffolding/027-shared-packages.md (modified)
  - scaffolding/029-web-frontend-builder.md (modified)
  - scaffolding/030-mobile-frontend-builder.md (modified)
  - scaffolding/034-output-contracts.md (modified)
  - scaffolding/034b-output-contract-zod-schemas.md (modified)
  - scaffolding/035-orchestrator-core.md (modified)
  - scaffolding/036-hitl-gates.md (modified)
  - scaffolding/041-mcp-server-registration.md (modified)
  - scaffolding/000-scaffolding-index.md (modified)
  - multi-agent-app-generation-blueprint.md (modified — addendum appended)
  - plans/active/refactor-001-style-grid-preview.html (created — demo)
commits: [] # all work on fix/test-bug working tree; uncommitted at archive time
branch-note: "Plan nominally targeted refactor/ui-designer-kit-pipeline but work was done on the existing fix/test-bug branch working tree. No dedicated branch was created. Suggest squash-committing this refactor to a new branch named refactor/ui-designer-kit-pipeline before the next feature commit."
attempts: 1
lessons:
  - "Review-before-advance discipline is high-leverage. Each of the eight implementation steps was self-reviewed before moving on, and roughly thirty real bugs (not nits — broken examples, wrong counts, inconsistent field names, line-drift hazards) were caught and fixed in-step. Batching review to the end would have compounded the drift across dependent files. Make per-step review the default for any refactor touching more than three files."
  - "HTML→JSX translation can't pattern-match CVA-emitted Tailwind strings — they're derived output, not invertible. Solution: the producing stage (/screens, task 025) emits data-kit-component / data-kit-variant / data-kit-size attributes that builders (029/030) read for deterministic translation. If a later builder needs to convert a DSL artifact back to a typed form, have the DSL carry the structured metadata inline rather than asking the builder to reverse-engineer styling."
  - "Adding content to the top of a line-referenced document breaks every citation below. Eighteen scaffolding tasks reference the blueprint by §X LYYY-ZZZ line ranges; a two-line top-addendum I initially added drifted every reference by +2. Fix: put large addenda at the END of the referenced doc (append-only = zero line drift). Apply the same discipline when editing any doc that's cited by line number elsewhere."
  - "Cross-task dependencies must be explicit in `depends-on` frontmatter. Builders 029/030 were initially missing 028 (backend) in their depends-on even though they import @repo/api-client which is typed against 028's tRPC router. Silent dep misses cause downstream builds to fail in confusing ways. Rule: if task A reads a file or schema authored by task B, B goes in A's depends-on, even if A's happy path doesn't directly invoke B."
  - "Platform-naming split (webapp vs web) is intentional. Design-side paths use PlatformId = {webapp, mobile, admin}; build-side dirs use Target = {web, mobile, admin, api}. They model different concepts — what the user sees vs what ships in apps/. Bridging them via a helper (platformIdToTarget) is cleaner than forcing one name across both and breaking other tasks. When two domains legitimately use different vocabularies for parallel-but-distinct concepts, model both and supply the mapping."
  - "Over-correction on naming is cheaper in review than in practice. I initially tried to unify webapp as canonical across design + build, which would have rippled through 026, 027, 029 directory conventions. Catching that in review and reverting to the split (with the mapper) was simpler than either leaving the inconsistency or doing the ripple fix. When a review surfaces a consistency gap, ask whether the fix is 'rename everything to match the cleaner name' or 'model the split explicitly' — both are valid; the latter is often less invasive."
  - "Static HTML can't write files. Any HITL gate that asks the browser to produce a JSON handshake (dials.yaml edits, selected-style.json, signoff.json) needs a backing HTTP server with POST endpoints. The orchestrator + HITL gate tasks (035/036) own the server lifecycle; the producing skill (023/025) only emits the static HTML that fetches endpoints. Document the endpoint contract alongside the schema so both ends agree."
  - "Feature flags must be filterable at registration time, not only at runtime. Task 041 (/register-mcp-servers) filters servers by `feature_flag` against the active pipeline flag set BEFORE writing .mcp.json — so when nanobanana is off, the image-generator server literally doesn't exist for the run. A runtime-only gate leaves the server registered and lets skills call it despite the flag being off. Fail at provisioning, not at call time."
test-results:
  unit: n/a (scaffolding refactor — no executable code written)
  integration: n/a (scaffolding refactor — no executable code written)
  note: "This refactor updates task specs only. Tests for the implementation those specs describe will run when /new-project executes each task in sequence. Downstream verification: see the Human Verification sections of each modified task."
duration-minutes: 420
scope-summary:
  files-modified: 17
  scaffolding-tasks-updated: 13
  scaffolding-tasks-created: 2
  blueprint-addendum: 1
  plan-artifact: 1
  demo-html-preview: 1
deferred-followups:
  - "Task 021 (PM agent) needs the kit-change-request mini-plan flow (cross-referenced from 025 + 035 integration points). When a builder emits docs/screens/kit-change-requests/{id}.md, PM should accept it as a plan input."
  - "Task 032 (Reviewer agent) should assert `pnpm ui-kit:validate-consumer` passes as part of the PR review checklist."
  - "Task 037 (Lessons Agent) should aggregate `VisualReviewOutput.violations[]` across pipeline runs to populate the anti-patterns log per spec §14."
  - "Task 024 step 18 mentions `pnpm lint` against the kit. The kit's ESLint config (shipping its own plugin) needs explicit wiring so `pnpm lint` resolves the plugin from the workspace nested path — this is covered by 027's pnpm-workspace.yaml glob requirement but worth a sanity check during task 027 implementation."
---
```
