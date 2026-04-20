---
id: refactor-002-analyst-refactor-001-alignment
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
branch: refactor/analyst-refactor-001-alignment
affected-files:
  - .claude/skills/analyze/SKILL.md
  - .claude/skills/analyze/styles.md
  - .claude/skills/analyze/inspirations.md
  - .claude/skills/analyze/flows.md
  - .claude/skills/analyze/screens.md
  - scaffolding/034b-output-contract-zod-schemas.md
feature-area: planning-pipeline
priority: P1
attempt-count: 0
max-attempts: 5
---

# refactor-002: Analyst ↔ Refactor-001 Alignment

## Problem Statement

The Analyst (task 019) was implemented at `.claude/skills/analyze/` and committed on 2026-04-18. Refactor-001 landed on 2026-04-20 and updated downstream tasks (022–025b, 036) to expect analyst outputs the current implementation doesn't produce. A deeper sweep found **five** concrete gaps:

1. **Platform name drift across four analyst files.** `.claude/skills/analyze/SKILL.md` canonicalizes to `web | mobile | admin | desktop` (§5a, line 155), writes `brief-summary.json.platforms: ["web", "mobile"]` (lines 272, 338, 362), and has `--platforms web,mobile,admin` in its argument-hint (line 5). Sibling sub-skills repeat the same drift: `flows.md` line 27, `screens.md` line 23, `screens.md` line 105 (`runclub-web` appId example). Refactor-001 tasks (023, 025, 025b) expect `detectedPlatforms` containing `PlatformId` values: `webapp | mobile | admin`. **Internally inconsistent within the analyst itself:** `schemas/screens.schema.json` (v3.0) already uses `appType: webapp | mobile | admin | desktop`, and `screens.md` line 107 writes `webapp` for `appType` — but line 23 of the same file says platform input is `web`. The SKILL-level canonicalization is the root drift; sub-skill files inherit it.

2. **Dials missing from `styles.md`.** The per-style required-fields section doesn't include refactor-001's three integer dials (`design_variance`, `motion_intensity`, `visual_density`, 1–10). `/mockups` seeds `docs/mockups/style-{K}/dials.yaml` from them; `/stylesheet` reads them for token-scale decisions.

3. **Named references not structured per-style.** Current `styles.md` has an informal `**Basis**: "Inspired by {Competitor N}"` line. Refactor-001 expects each style to cite 2–3 concrete named-app references from a canonical pool (Linear, Stripe Dashboard, Arc, Raycast, Things 3, Vercel, Duolingo, Superhuman, Framer, Height, Retool, etc.) so the UI Designer can cite them when justifying decisions.

4. **`AnalyzeOutput` Zod schema (034b) doesn't match what the analyst emits.** Current schema:

   ```ts
   AnalyzeOutput = { success, targets: Target[], screenCount, skillsNeeded, assetsFound: {...}, warnings }
   ```

   Actual analyst report (SKILL.md lines 335–347):

   ```json
   { "success", "platforms", "screensByPlatform", "coverageByPlatform", "styleCount", "assetMode", "skillsNeeded", "mcpHints", "openQuestions", "warnings" }
   ```

   Six field mismatches (platforms↔targets, screensByPlatform↔screenCount, coverageByPlatform absent, styleCount absent, assetMode absent, mcpHints absent, openQuestions absent, assetsFound absent from analyst). This isn't a refactor-001 regression — it's a pre-existing scaffolding bug that surfaced while tracing PlatformId threading. Fixing it here because the two fixes are naturally co-located (schema already needs the `detectedPlatforms` rename).

5. **Informal design-systems list in `inspirations.md`.** Current list: Linear, Stripe, Vercel, Notion, Figma, Slack, Discord, Spotify, Material, Apple HIG. Refactor-001's named-references library (baked into 022's system prompt) adds Arc, Raycast, Things 3, Duolingo, Superhuman, Framer, Height, Retool. Alignment makes analyst-proposed references usable verbatim by the UI Designer.

Gaps 1–3 break the pipeline if run as-is. Gap 4 breaks schema validation at Layer 3 of the output contracts. Gap 5 is an alignment polish but makes the Analyst→Designer handshake tighter.

## Approach

Update the **implementation** at `.claude/skills/analyze/` AND the `AnalyzeOutput` schema at `scaffolding/034b-output-contract-zod-schemas.md`. Do NOT modify `scaffolding/archive/019-analyst-agent.md` — the archived task spec is a historical snapshot; alignment belongs in the refactor record itself, not in archived specs. Do NOT modify `brief-template.md` (verified platform-agnostic) or `schemas/brief-frontmatter.schema.json` (verified platform-agnostic).

Single-branch refactor. Self-review per file before advancing, matching refactor-001's discipline.

## Proposed Changes

### UPDATE — `.claude/skills/analyze/SKILL.md`

Five concrete edits:

1. **Line 5 (frontmatter `argument-hint`):** change `[--platforms web,mobile,admin]` → `[--platforms webapp,mobile,admin]`.
2. **Line 155–156 (canonicalization):** change `Canonicalize to: 'web' | 'mobile' | 'admin' | 'desktop'. If nothing detected, default to 'web'.` → `Canonicalize to: 'webapp' | 'mobile' | 'admin' | 'desktop'. If nothing detected, default to 'webapp'.`
3. **Lines 147, 151 (detection heuristics):** keep the brief's lay terms (`"web"`) as _detection signals_ (users write "web" colloquially), but state clearly that detections map to canonical `webapp`. Add one sentence of intent: "Users can write 'web' in their brief — that's a detection signal, not the canonical name. Emit `webapp` in all outputs."
4. **Lines 266–283 (`brief-summary.json` shape):** rename field `platforms` → `detectedPlatforms`; rename nested `targets[].platform` → `targets[].platformId`; add explanatory paragraph pointing at 034b's PlatformId (design-side) vs Target (build-side) split with `platformIdToTarget()` mapper. Update the sample JSON.
5. **Lines 335–347 (stage-return Report JSON):** rename `platforms` → `detectedPlatforms`; keys of `screensByPlatform` / `coverageByPlatform` become PlatformId values. Update the sample.
6. **Line 362 (status output text):** change `web: 100% (42 screens)` → `webapp: 100% (42 screens)` so the human-readable summary matches the canonical names.

Also add `--platforms` argument validation: reject supplied names that aren't in `PlatformId`, suggesting `webapp` when user supplies `web`.

### UPDATE — `.claude/skills/analyze/flows.md`

**Line 27:** change `Platform name (\`web\` | \`mobile\` | \`admin\` | \`desktop\`)`→`Platform name (\`webapp\` | \`mobile\` | \`admin\` | \`desktop\`)`. That's the only hit.

### UPDATE — `.claude/skills/analyze/screens.md`

Two edits:

1. **Line 23 (platform input enumeration):** change `Platform name (\`web\` | \`mobile\` | \`admin\` | \`desktop\`)`→`Platform name (\`webapp\` | \`mobile\` | \`admin\` | \`desktop\`)`. Consistent with `appType` on line 107 of the same file.
2. **Line 105 (appId example):** change `runclub-web` → `runclub-webapp`. Small but consistent: appId convention is `{projectName}-{platformId}`.

### UPDATE — `.claude/skills/analyze/styles.md`

Add two required subsections to the per-style required-fields block (current content lines ~57–91):

```markdown
### Dials (1–10 integers, required)

- `design_variance` — 1 = perfectly symmetric / 10 = experimental, asymmetric
- `motion_intensity` — 1 = static / 10 = cinematic / spring-heavy
- `visual_density` — 1 = gallery-airy / 10 = cockpit-dense

Choose deliberately. A style's personality is carried as much by the dials
as by the palette. Recommended mapping:

- Bold / editorial / creative → variance 6–9, motion 5–8, density 3–5
- Corporate / productivity / B2B → variance 2–4, motion 2–4, density 6–8
- Consumer / playful → variance 5–7, motion 6–9, density 3–5
- Dashboard / data-heavy → variance 1–3, motion 1–3, density 7–9

### Named references (2–3 apps, required)

A short list of concrete apps whose design language inspired this style.
Cited by the UI Designer when justifying decisions (task 022's system
prompt includes this as its canonical pool). Prefer opinionated design
systems over obscure competitors.

Canonical pool: Linear, Stripe Dashboard, Arc, Raycast, Things 3, Vercel,
Notion, Duolingo, Superhuman, Height, Figma, Framer, PostHog, Retool,
Airbnb, Robinhood, Instagram, Apple HIG-native.
```

Update the output-structure template (around lines 140–193) to show each Style block containing the two new subsections with realistic filled-in values.

**Optional `### Dark Mode` subsection:** document as optional. If the Analyst knows a priori what the style's dark-mode tokens are (e.g., from a brand guide), emit them; otherwise `/stylesheet` (024) derives algorithmically.

**Density duality:** keep categorical `density: compact | comfortable | spacious` as a human-readable summary, but add a note: the numeric `dials.visual_density` is authoritative for downstream computation; the categorical label must agree with the dial.

### UPDATE — `.claude/skills/analyze/inspirations.md`

**Lines 93–100 (Design Systems to Reference table):** expand the canonical list to match 022's named-references library. Add: Arc, Raycast, Things 3, Duolingo, Superhuman, Framer, Height, Retool. Reorder by relevance to product type (productivity / dashboard / consumer / creative).

**Cross-reference instruction:** add a one-paragraph note: "After per-style mood-matching in styles.md, ensure each style's `namedReferences` field pulls from this table or an equivalent opinionated app. No style should cite only obscure competitors as its inspiration anchors."

### UPDATE — `scaffolding/034b-output-contract-zod-schemas.md` (`AnalyzeOutput`)

Replace the current schema with one that matches the analyst's actual report JSON (lines 335–347 of SKILL.md) AND uses `PlatformId` from refactor-001's common.ts:

```ts
// NEW — analyze.ts
import { z } from "zod";
import { PlatformId } from "./common.js";

export const AssetMode = z.enum(["standard", "useAssets"]);

export const AnalyzeOutput = z.object({
  success: z.literal(true),
  detectedPlatforms: z.array(PlatformId).nonempty(),
  screensByPlatform: z.record(PlatformId, z.number().int().nonnegative()),
  coverageByPlatform: z.record(PlatformId, z.number().int().min(0).max(100)),
  styleCount: z.number().int().positive(),
  assetMode: AssetMode,
  skillsNeeded: z.array(z.string()),
  mcpHints: z.array(z.string()),
  openQuestions: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});
export type AnalyzeOutput = z.infer<typeof AnalyzeOutput>;
```

Update the 034b task's acceptance-criteria list accordingly (add one line asserting the schema uses `PlatformId` and matches the analyst's emitted field set).

**Note:** the old schema referenced `Target` and a non-existent `assetsFound` block. The `assetsFound` counts _do_ exist elsewhere — the analyst consumes `docs/asset-inventory.json` (produced by `/scan-assets`, task 018) which carries counts. Those counts stay in that file; the stage-return JSON doesn't duplicate them. Update the 034b task note to make this distinction explicit.

## Rejected Alternatives

1. **Un-archive 019 and edit the task spec.** Rejected — breaks archive lineage. Alignment belongs in this refactor's record, not in rewritten archived specs.
2. **Append a post-archive note to `scaffolding/archive/019-analyst-agent.md`.** Initially considered, now rejected — violates the "archives are immutable" discipline from refactor-001's lessons. Anyone searching archived specs finds the historical snapshot; anyone searching current behavior finds the skill files + this refactor record.
3. **Leave `brief-summary.json.platforms` and have downstream skills (023, 025, 025b) translate.** Rejected — spreads the naming split, invites further drift, and contradicts refactor-001's "fix the source" pattern from the 022b rules.
4. **Make downstream skills tolerate both `web` and `webapp`.** Rejected — tolerant schemas always drift further. Fix the source.
5. **Add `dials` + `namedReferences` as _optional_ fields.** Rejected — making them required forces the Analyst to stake a deliberate claim per style. That's the whole point; defaults collapse back to safe-generic (the anti-slop failure mode refactor-001 was designed to prevent).
6. **Keep `AnalyzeOutput` simple and let richer fields live only in `brief-summary.json`.** Considered, rejected — the stage-return JSON is what the orchestrator validates per 034's Layer 3 policy. A schema that doesn't match reality causes every run to fail validation and trigger Layer 5 retries for no reason.
7. **Version `brief-summary.json` with a `schemaVersion` field.** Rejected for v1 — no generated projects in the wild, so no backfill burden. Add schema versioning when we ship to real users.

## Expected Outcomes

1. `/analyze` writes `docs/brief-summary.json.detectedPlatforms` as `PlatformId` values (`webapp | mobile | admin | desktop`).
2. Running `/mockups` / `/screens` / `/visual-review` directly after `/analyze` finds input files at `docs/analysis/webapp/...`, `docs/screens/webapp/...` without path translation.
3. `docs/analysis/shared/styles.md` per-style blocks carry deliberate `dials` triples and 2–3 `namedReferences` apiece.
4. `/mockups` seeds `docs/mockups/style-{K}/dials.yaml` directly from the Analyst's output.
5. UI Designer's system prompt (022) can cite analyst-proposed references when justifying decisions.
6. `AnalyzeOutput` Zod schema matches the analyst's actual stage-return JSON; Layer 3 validation passes on first emit.
7. No breaking changes to the pipeline shape — this is alignment, not re-architecture.

## Validation Criteria

- Post-run `grep -rE '"(\\"web\\"|''web''|`web`)' .claude/skills/analyze/` returns zero hits in _canonical-name_ positions (lay-term detection signals in prose are allowed; only enum-looking usages are fixed).
- `.claude/skills/analyze/SKILL.md`: argument-hint uses `webapp`; canonicalization sentence uses `webapp`; all three sample JSONs (brief-summary, stage-return Report, status text) use `webapp`.
- `.claude/skills/analyze/flows.md` line 27 uses `webapp`.
- `.claude/skills/analyze/screens.md` lines 23 + 105 use `webapp`.
- `.claude/skills/analyze/styles.md` per-style block includes `### Dials` and `### Named references` subsections with 3 required integer dials + 2–3 named apps.
- `scaffolding/034b-output-contract-zod-schemas.md` `AnalyzeOutput` uses `PlatformId`, includes `detectedPlatforms` / `screensByPlatform` / `coverageByPlatform` / `assetMode` / `mcpHints` / `openQuestions`; `assetsFound` removed.
- Running `/analyze` on a multi-platform brief produces `docs/brief-summary.json` and a stage-return JSON that both validate against the updated `AnalyzeOutput` schema.
- Sample `brief-summary.json` grep: `grep -E '"platforms":' docs/brief-summary.json` returns no hit; `grep -E '"detectedPlatforms":' docs/brief-summary.json` returns one hit.

## Gap Analysis (self-check)

| Area                                                             | Addressed?            | Notes                                                                                                                                                                                                      |
| ---------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform canonicalization in SKILL.md                            | ✅                    | Line 5 + 147/151 + 155–156                                                                                                                                                                                 |
| brief-summary.json field renames                                 | ✅                    | platforms → detectedPlatforms; targets[].platform → .platformId                                                                                                                                            |
| --platforms CLI arg validation                                   | ✅                    | Rejects `web`, suggests `webapp`                                                                                                                                                                           |
| Platform input in flows.md                                       | ✅                    | Line 27                                                                                                                                                                                                    |
| Platform input in screens.md                                     | ✅                    | Line 23 + line 105 appId                                                                                                                                                                                   |
| Per-style dials in styles.md                                     | ✅                    | Required 3-integer block with guidance                                                                                                                                                                     |
| Per-style named references                                       | ✅                    | Required 2–3 apps, canonical pool                                                                                                                                                                          |
| Optional darkMode subsection                                     | ✅                    | Documented as optional                                                                                                                                                                                     |
| Density categorical vs numeric                                   | ✅                    | Dial is authoritative                                                                                                                                                                                      |
| inspirations.md design-systems list                              | ✅                    | Expanded to match 022's library                                                                                                                                                                            |
| AnalyzeOutput schema realignment                                 | ✅                    | Full rewrite in 034b                                                                                                                                                                                       |
| screens.schema.json appType enum                                 | ✅                    | Already uses webapp — no change needed                                                                                                                                                                     |
| brief-template.md                                                | ✅ (no-op)            | Verified platform-agnostic                                                                                                                                                                                 |
| schemas/brief-frontmatter.schema.json                            | ✅ (no-op)            | Verified platform-agnostic                                                                                                                                                                                 |
| schemas/navigation.schema.json                                   | ✅ (no-op)            | Verified platform-agnostic                                                                                                                                                                                 |
| .claude/agents/analyst.md                                        | ✅ (no-op)            | Agent prompt is platform-agnostic; references schemas + sub-skills                                                                                                                                         |
| .claude/skills/draft-brief/                                      | ✅ (no-op)            | grep returned no platform-name hits                                                                                                                                                                        |
| scripts/validate-brief.mjs / validate-screens.mjs                | ✅ (no-op)            | Validate-screens calls screens.schema.json which already uses webapp                                                                                                                                       |
| Task 020 (Architect)                                             | ➖ Deferred           | Not yet implemented; will read `detectedPlatforms` correctly when written                                                                                                                                  |
| Task 021 (PM)                                                    | ➖ Deferred           | Same — not yet implemented                                                                                                                                                                                 |
| `.claude/skills/analyze/research.md` (competitors.md)            | ✅ (no-op — 2nd pass) | Platform-agnostic; no enum refs                                                                                                                                                                            |
| `.claude/skills/analyze/assets.md` (phase 3b output)             | ✅ (no-op — 2nd pass) | Per-style structure, no platform refs; consumed by 023/024 via styleId not platform                                                                                                                        |
| `.claude/skills/scan-assets/SKILL.md` (asset-inventory.json)     | ✅ (no-op — 2nd pass) | Catalog is filesystem-layout driven; no platform tagging                                                                                                                                                   |
| Phase-1 brief ingestion (SKILL.md §1)                            | ✅ (no-op — 2nd pass) | `/validate-brief` + `/scan-assets`; neither consumes platform enum values                                                                                                                                  |
| requirements.md template (SKILL.md §6b lines 221-264)            | ✅ (no-op — 2nd pass) | Uses `{platform}` template variable; renders webapp correctly under rename                                                                                                                                 |
| navigation-schema.md output (flows.md lines 122-158)             | ✅ (no-op — 2nd pass) | Platform name in heading only (`# Navigation Schema — {platform}`)                                                                                                                                         |
| coverage.md output (SKILL.md §5d)                                | ✅ (no-op — 2nd pass) | Platform name in heading only                                                                                                                                                                              |
| `assets/styles/style-{K}/palette.json` (phase 6)                 | ✅ (no-op — 2nd pass) | Color values only, no platform refs                                                                                                                                                                        |
| `schemas/brief-summary.schema.json`                              | ✅ (no-op — 2nd pass) | Doesn't exist; `brief-summary.json` isn't strictly validated — `AnalyzeOutput` in 034b is the de-facto schema for the stage-return subset                                                                  |
| Icon library naming drift (architect vs assets.md)               | ⚠ Out-of-scope        | 020 supports `lucide \| phosphor \| heroicons \| iconoir`; assets.md recommends `Lucide \| Heroicons \| Phosphor \| Feather \| Tabler`. Known cleanup; belongs in a separate plan when 020 is implemented. |
| `brief-summary.json.targets[].platform` → `platformId` semantics | ⚠ Clarifier           | Field currently carries PlatformId values (webapp/mobile/admin). Rename to `platformId` clarifies intent. When 020 reads it, `platformIdToTarget()` maps to the Target enum for build-dir naming.          |

## Implementation Order

1. **`.claude/skills/analyze/SKILL.md`** — six edits in one pass (canonicalization, brief-summary field renames, Report JSON, status text, arg-hint, arg validation).
2. **`.claude/skills/analyze/flows.md`** — single-line fix.
3. **`.claude/skills/analyze/screens.md`** — two-line fix.
4. **`.claude/skills/analyze/styles.md`** — add Dials + Named references subsections; update output-structure template.
5. **`.claude/skills/analyze/inspirations.md`** — expand design-systems table.
6. **`scaffolding/034b-output-contract-zod-schemas.md`** — rewrite `AnalyzeOutput` schema + update acceptance criteria.
7. Self-review each file per refactor-001's discipline before advancing.

Single branch (`refactor/analyst-refactor-001-alignment` off `refactor/ui-designer-kit-pipeline`); single commit.

## Attempt Log

### Attempt 1 — 2026-04-20

Completed in one pass. Six files touched (.claude/skills/analyze/SKILL.md, flows.md, screens.md, styles.md, inspirations.md; scaffolding/034b). Self-review grep confirmed:

- Zero remaining `"platforms": [...]` old-field-name hits
- Only 2 `web` mentions in SKILL.md remain — both intentional (detection-signal note + argument-validation error message). Canonical outputs all use `webapp`.
- `### Dials` and `### Named references` subsections appear twice in styles.md (Style 0 + Style 1 templates)
- `AnalyzeOutput` Zod schema rewritten with `detectedPlatforms: PlatformId[]`, `screensByPlatform`, `coverageByPlatform`, `styleCount`, `assetMode`, `skillsNeeded`, `mcpHints`, `openQuestions`, `warnings`. The removed `assetsFound` block is documented as living in `docs/asset-inventory.json` (produced by task 018).

Commit: `ce8b2d8` on branch `refactor/analyst-refactor-001-alignment` (off `refactor/ui-designer-kit-pipeline`). 8 files, +411/−20.

