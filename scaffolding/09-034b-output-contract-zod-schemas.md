---
task-id: "034b"
title: "Output Contract Zod Schemas"
status: pending
priority: P2
tier: 8 — Quality & Ship
depends-on: ["026", "034"]
estimated-scope: small
---

# 034b: Output Contract Zod Schemas

## What This Task Produces

A TypeScript package providing runtime-validated Zod schemas for every pipeline stage's structured output AND for every persistent handshake file the stages write (selected-style.json, signoff.json). Task 034 documents Layer 3 (constrained decoding) as a pattern; this task is the concrete implementation consumed by the orchestrator (task 035) and stage runners.

Refactor-001 adds several new schemas and extends most existing ones. Schemas marked **NEW** or **EXTENDED** below were added or grew as part of the refactor.

## Why This Exists

Task 034 lists Zod schemas as the Layer 3 mechanism; this task ships them as one import site so the orchestrator, stage runners, and HTML Verifier (032b) all cross-check against the same source of truth. Without one home, schemas drift across agents and stage outputs silently diverge.

## Scope

### Package location

Place under `packages/orchestrator-contracts/` — importable by the orchestrator and any skill/agent running inside a generated project.

```
packages/orchestrator-contracts/
├── package.json                # name: @repo/orchestrator-contracts
├── tsconfig.json
├── src/
│   ├── index.ts                # re-exports + StageSchemas lookup
│   ├── common.ts               # Target, ScreenId, AssetRef, Sha256, Dials, PlatformId, FeatureFlag
│   ├── analyze.ts              # EXTENDED — adds integrationsResearched (refactor-003)
│   ├── skills-audit.ts         # EXTENDED — adds scope discriminator (refactor-003)
│   ├── architect.ts            # EXTENDED — vendor/self-hosted/declined counts (refactor-003)
│   ├── pm.ts                   # EXTENDED — mode discriminator (refactor-003)
│   ├── mockups.ts              # EXTENDED
│   ├── selected-style.ts       # NEW — validates docs/selected-style.json; iconLibrary field (refactor-003)
│   ├── stylesheet.ts           # EXTENDED
│   ├── screens.ts              # EXTENDED — now a discriminated union
│   ├── visual-review.ts        # NEW — validates docs/visual-review/report.json
│   ├── user-flows.ts
│   ├── signoff.ts              # EXTENDED — adds visualReviewReportHash + uiKitVersion
│   ├── build.ts                # EXTENDED — BuildBackend, BuildWebFrontend, BuildMobileFrontend
│   ├── credentials-gate.ts     # NEW — gate 5 file-drop output (refactor-003)
│   ├── test.ts
│   ├── review.ts
│   └── git.ts
└── scripts/
    └── export-json-schemas.ts  # zod-to-json-schema → schemas/*.schema.json for HTML form validators
```

### `common.ts` — shared primitives (EXTENDED)

```ts
import { z } from "zod";

/**
 * Two enums, intentionally NOT the same. They model two different concepts:
 *
 *  - `PlatformId` — the logical user-facing platform name. Used in
 *    design-pipeline artifacts (`docs/analysis/{platform}/screens.json`,
 *    `docs/mockups/style-K/{platform}/...`, `docs/screens/{platform}/...`,
 *    `SelectedStyle.appsCovered`). Values: `webapp | mobile | admin`.
 *
 *  - `Target` — the build-pipeline app directory name. Used in
 *    `architecture.yaml.apps.*`, build-output schemas, and `apps/{target}/`
 *    directories. Values: `web | mobile | admin | api`.
 *
 * The one-letter slip between `webapp` (platform) and `web` (target / dir)
 * is deliberate — design-time we care about what the user sees, build-time
 * we care about the Next.js app directory name. Consumers of both should
 * treat them as parallel but distinct enums. A helper `platformIdToTarget()`
 * maps one to the other when wiring (e.g., when builders read the signoff
 * manifest and find screens at `docs/screens/webapp/*`, they emit JSX into
 * `apps/web/src/app/...`).
 */
export const Target = z.enum(["admin", "web", "mobile", "api"]);
export type Target = z.infer<typeof Target>;

export const PlatformId = z.enum(["webapp", "mobile", "admin"]);
export type PlatformId = z.infer<typeof PlatformId>;

/** Map a design-time platform name to its build-time target directory. */
export const platformIdToTarget = (p: PlatformId): Exclude<Target, "api"> =>
  p === "webapp" ? "web" : p;

export const ScreenId = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/);

export const AssetRef = z.object({
  path: z.string(),
  kind: z.enum([
    "logo",
    "icon",
    "font",
    "image",
    "wireframe",
    "brand-guide",
    "color",
    "illustration",
  ]),
  provenance: z.enum([
    "user",
    "researched",
    "generated",
    "hybrid",
    "stock",
    "vector",
  ]),
});

export const Sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/);

/** Design dials — 1–10 integer range per spec */
export const Dials = z.object({
  design_variance: z.number().int().min(1).max(10),
  motion_intensity: z.number().int().min(1).max(10),
  visual_density: z.number().int().min(1).max(10),
});
export type Dials = z.infer<typeof Dials>;

/** Feature flags recognized by the orchestrator + 041 */
export const FeatureFlag = z.enum(["nanobanana"]);
export type FeatureFlag = z.infer<typeof FeatureFlag>;

/** Semver string for the @repo/ui-kit version pin */
export const SemverString = z.string().regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
```

### `mockups.ts` — **EXTENDED**

```ts
import { z } from "zod";
import { PlatformId } from "./common.js";

export const MockupsOutput = z.object({
  success: z.literal(true),
  styleCount: z.number().int().positive(),
  appsCovered: z.array(PlatformId).nonempty(),
  archetypesPerAppPerStyle: z.number().int().positive(),
  mockupsGenerated: z.number().int().positive(),
  mockupsPerStyle: z.record(z.string(), z.number().int().positive()),
  userAssetsUsed: z.array(z.string()),
  iconsFromMCP: z.number().int().nonnegative(),
  imagesFromMCP: z.number().int().nonnegative(),
  hybridWireframeCount: z.number().int().nonnegative(),
  nanobananaUsed: z.boolean(),
  imagesGeneratedCount: z.number().int().nonnegative(),
  imagesStockCount: z.number().int().nonnegative(),
  imagesVectorFallbackCount: z.number().int().nonnegative(),
  partialAssetRatio: z.string(), // human-readable summary
  selfCheckRegenerations: z.number().int().nonnegative(),
  reviewIndexPath: z.string(), // docs/mockups/index.html
  warnings: z.array(z.string()),
});
export type MockupsOutput = z.infer<typeof MockupsOutput>;
```

### `selected-style.ts` — **NEW** (refactor-003 extends with `iconLibrary`)

Validates `docs/selected-style.json`, the binding handshake written by the HITL mockup gate (task 036) or auto-populated by `/mockups` on the single-style fast path.

Refactor-003 adds `iconLibrary` so design-stage consumers (task 024 `/stylesheet`) can read the winning style's icon library choice directly instead of via `architecture.yaml.tooling.icon_library` (which doesn't exist yet at stylesheet time — architect runs post-design now).

```ts
import { z } from "zod";
import { Dials, PlatformId } from "./common.js";

export const IconLibrary = z.enum([
  "lucide",
  "phosphor",
  "heroicons",
  "iconoir",
  "tabler",
]);
export type IconLibrary = z.infer<typeof IconLibrary>;

export const SelectedStyleSchema = z.object({
  version: z.literal("1.0"),
  styleId: z.string().regex(/^style-\d{2,}$/),
  styleName: z.string().min(1),
  selectedAt: z.string().datetime({ offset: false }),
  selectedBy: z.enum(["human", "auto-single-style"]),
  dials: Dials,
  iconLibrary: IconLibrary, // NEW (refactor-003) — sourced from winning style's assets.md block
  appsCovered: z.array(PlatformId).nonempty(),
  mockupsManifest: z.string(), // path to docs/mockups/style-{K}/manifest.json
  stylesSourceRef: z.string(), // e.g. "docs/analysis/shared/styles.md#style-03"
  nanobananaUsed: z.boolean(),
});
export type SelectedStyle = z.infer<typeof SelectedStyleSchema>;
```

### `stylesheet.ts` — **EXTENDED**

```ts
import { z } from "zod";
import { SemverString } from "./common.js";

export const StylesheetOutput = z.object({
  success: z.literal(true),
  styleId: z.string(),
  kitVersion: SemverString,
  tokenCount: z.number().int().positive(),
  primitiveCount: z.number().int().min(20), // contract: ≥20 primitives
  patternCount: z.number().int().min(12), // contract: ≥12 patterns
  layoutCount: z.number().int().min(5), // contract: ≥5 layouts
  primitivesList: z.array(z.string()).nonempty(),
  patternsList: z.array(z.string()).nonempty(),
  layoutsList: z.array(z.string()).nonempty(),
  iconCount: z.number().int().nonnegative(),
  illustrationsCount: z.number().int().nonnegative(),
  nanobananaUsed: z.boolean(),
  imagesGeneratedCount: z.number().int().nonnegative(),
  imagesStockCount: z.number().int().nonnegative(),
  imagesVectorFallbackCount: z.number().int().nonnegative(),
  assetsDownloaded: z.object({
    icons: z.number().int().nonnegative(),
    fonts: z.number().int().nonnegative(),
    images: z.number().int().nonnegative(),
  }),
  assetsDedupedFromMockups: z.number().int().nonnegative(),
  tokensPackagePath: z.string(),
  storybookPath: z.string(),
  previewPath: z.string(),
  budgetExhausted: z.boolean(),
  gapsPath: z.string().nullable(),
  warnings: z.array(z.string()),
  noChange: z.boolean(), // true when re-run was a no-op
});
export type StylesheetOutput = z.infer<typeof StylesheetOutput>;
```

### `screens.ts` — **EXTENDED (discriminated union)**

The schema reflects the two invocation modes (batch vs single-screen retry mode used by 025b):

```ts
import { z } from "zod";
import { Sha256, SemverString } from "./common.js";

const ScreensOutputBatch = z.object({
  mode: z.literal("batch"),
  success: z.literal(true),
  styleId: z.string(),
  uiKitVersion: SemverString,
  screensGenerated: z.number().int().positive(),
  batches: z.array(
    z.object({
      batchId: z.number().int().positive(),
      screens: z.number().int().positive(),
      duration: z.string(),
    }),
  ),
  failedScreens: z.array(
    z.object({ screenId: z.string(), reason: z.string() }),
  ),
  kitChangeRequests: z.array(z.string()), // paths to emitted change-request files
  nanobananaUsed: z.boolean(),
  imagesGeneratedCount: z.number().int().nonnegative(),
  imagesStockCount: z.number().int().nonnegative(),
  imagesVectorFallbackCount: z.number().int().nonnegative(),
  screensManifestHash: Sha256,
});

const ScreensOutputSingle = z.object({
  mode: z.literal("single-screen"),
  success: z.literal(true),
  screen: z.string(), // "{platform}/{screen-id}"
  attempt: z.number().int().positive(),
  feedbackApplied: z.boolean(),
  nanobananaUsed: z.boolean(),
});

export const ScreensOutput = z.discriminatedUnion("mode", [
  ScreensOutputBatch,
  ScreensOutputSingle,
]);
export type ScreensOutput = z.infer<typeof ScreensOutput>;
```

### `visual-review.ts` — **NEW**

```ts
import { z } from "zod";
import { PlatformId } from "./common.js";

const Viewport = z.enum(["mobile", "tablet", "desktop"]);
const Severity = z.enum(["error", "warning", "info"]);

export const VisualReviewViolation = z.object({
  screen: z.string(), // "{platform}/{screen-id}"
  viewport: Viewport,
  rule: z.string(), // e.g. "color.accent-budget"
  severity: Severity,
  detail: z.string(),
});

export const VisualReviewOutput = z.object({
  success: z.literal(true),
  screensReviewed: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  retriesTriggered: z.number().int().nonnegative(),
  needsHumanReview: z.array(z.string()), // "{platform}/{screen-id}" after exhausted retries
  violations: z.array(VisualReviewViolation),
  reportPath: z.string(), // docs/visual-review/report.json
});
export type VisualReviewOutput = z.infer<typeof VisualReviewOutput>;
```

### `signoff.ts` — **EXTENDED** (nine fields, was seven)

```ts
import { z } from "zod";
import { Sha256, SemverString } from "./common.js";

export const Signoff = z.object({
  version: z.literal("1.0"),
  signedAt: z.string().datetime({ offset: false }), // UTC Zulu
  clientName: z.string().min(1),
  approved: z.boolean(),
  comments: z.string(),
  screensApproved: z.number().int().positive(),
  screensManifestHash: Sha256,
  visualReviewReportHash: Sha256, // NEW — binds a specific visual-review state
  uiKitVersion: SemverString, // NEW — binds a specific kit release
});
export type Signoff = z.infer<typeof Signoff>;
```

### `build.ts` — **EXTENDED** (three schemas)

```ts
import { z } from "zod";
import { SemverString } from "./common.js";

const Passable = z.enum(["pass", "fail", "skipped"]);

/** Backend builder — tRPC routers, Prisma, migrations */
export const BuildBackendOutput = z.object({
  success: z.literal(true),
  routersGenerated: z.number().int().nonnegative(),
  migrationsGenerated: z.number().int().nonnegative(),
  typecheckResult: Passable,
  lintResult: Passable,
  retriesTriggered: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});
export type BuildBackendOutput = z.infer<typeof BuildBackendOutput>;

/** Web frontend — Next.js apps/web + apps/admin (build-time target names, NOT PlatformId) */
const WebBuildTarget = z.enum(["web", "admin"]);
export const BuildWebFrontendOutput = z.object({
  success: z.literal(true),
  appsBuilt: z.array(WebBuildTarget).nonempty(),
  uiKitVersion: SemverString,
  pagesGenerated: z.record(WebBuildTarget, z.number().int().nonnegative()),
  kitChangeRequests: z.array(z.string()),
  validateConsumerResult: z.record(
    WebBuildTarget,
    z.enum(["clean", "violations"]),
  ),
  typecheckResult: Passable,
  lintResult: Passable,
  retriesTriggered: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});
export type BuildWebFrontendOutput = z.infer<typeof BuildWebFrontendOutput>;

/** Mobile frontend — Expo + React Native */
export const BuildMobileFrontendOutput = z.object({
  success: z.literal(true),
  uiKitVersion: SemverString,
  screensGenerated: z.number().int().nonnegative(),
  kitChangeRequests: z.array(z.string()),
  validateConsumerResult: z.enum(["clean", "violations"]),
  typecheckResult: Passable,
  lintResult: Passable,
  nativePrimitivesVerified: z.number().int().nonnegative(),
  retriesTriggered: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});
export type BuildMobileFrontendOutput = z.infer<
  typeof BuildMobileFrontendOutput
>;
```

### `analyze.ts` — **EXTENDED** (per refactor-002 + refactor-003)

The prior `AnalyzeOutput` shape didn't match what `.claude/skills/analyze/SKILL.md` actually emits at phase 5. Refactor-002 aligned the schema to the analyst's real output and applied refactor-001's `PlatformId` canonicalization. Refactor-003 adds `integrationsResearched` for the new phase 2.5 integrations-options.md research output.

```ts
import { z } from "zod";
import { PlatformId } from "./common.js";

export const AssetMode = z.enum(["standard", "useAssets"]);
export type AssetMode = z.infer<typeof AssetMode>;

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
  integrationsResearched: z.number().int().nonnegative(), // NEW (refactor-003) — count of services in integrations-options.md
  warnings: z.array(z.string()),
});
export type AnalyzeOutput = z.infer<typeof AnalyzeOutput>;
```

**Note on `assetsFound`.** The prior schema had an `assetsFound: { logos, icons, fonts, images, wireframes, brandGuides }` block. Those counts live in `docs/asset-inventory.json` (produced by `/scan-assets`, task 018) — the stage-return JSON does not duplicate them. Downstream consumers read the inventory file directly.

**Note on `targets`.** The prior schema had `targets: Target[]`. The analyst's `docs/brief-summary.json` separately carries `targets: [{ platformId, appId, screenCount }]` (where `platformId` is `PlatformId`, not `Target`). The stage-return JSON used to return the schema's validation covers only `detectedPlatforms` — the richer per-app array stays in the on-disk artifact that downstream stages read by path.

### `architect.ts` — **EXTENDED** (per refactor-003)

Refactor-003 moves the architect from tier 5 (pre-design) to tier 6.5 (post-design-signoff) and introduces a three-way `deployment` enum for integrations (`vendor | self-hosted | declined`). The return schema now covers counts for each deployment bucket plus the env-var annotations that feed gate 5.

```ts
import { z } from "zod";

export const ArchitectOutput = z.object({
  success: z.literal(true),
  appsCount: z.number().int().nonnegative(),
  packagesCount: z.number().int().nonnegative(),
  vendorDecisions: z.number().int().nonnegative(), // deployment=vendor count
  selfHostedDecisions: z.number().int().nonnegative(), // deployment=self-hosted count
  declinedDecisions: z.number().int().nonnegative(), // deployment=declined count
  envVarsRequiredNow: z.number().int().nonnegative(), // blocks /build-backend
  envVarsRequiredLater: z.number().int().nonnegative(), // for /deploy
  envVarsOptional: z.number().int().nonnegative(), // feature-flag gated
  credentialsDiffEmitted: z.boolean(), // true on re-runs (prior architecture.yaml existed)
  buildMcpServersAdded: z.number().int().nonnegative(), // usually 0 — most vendor SDKs are NPM, not MCP
  warnings: z.array(z.string()),
});
export type ArchitectOutput = z.infer<typeof ArchitectOutput>;
```

**Architect never reads `.env`.** The schema does not carry a `.env` key count — `.env` is user-authored at gate 5. The orchestrator's post-gate-5 `CredentialsGateOutput` carries the captured/deferred counts. Separation is load-bearing: `block-dangerous.sh` keeps `.env` unreadable by agents.

### `credentials-gate.ts` — **NEW** (refactor-003)

Validates the orchestrator's summary after gate 5 resolves. Gate 5 is a file-drop gate (no HTTP server); this schema is constructed by the orchestrator from the parsed `docs/credentials-confirmed.txt` directive + stat of the user's `.env` file.

```ts
import { z } from "zod";

export const CredentialsGateOutput = z.object({
  success: z.literal(true),
  decision: z.enum(["proceed", "defer", "abort"]),
  servicesConfirmed: z.array(z.string()), // vendor IDs user confirmed
  servicesDeferred: z.array(z.string()), // vendor IDs user deferred with reason
  deferralReasons: z.record(z.string(), z.string()), // { serviceId: reason }
  envFileExists: z.boolean(), // orchestrator stat check; NEVER reads contents
  warnings: z.array(z.string()),
});
export type CredentialsGateOutput = z.infer<typeof CredentialsGateOutput>;
```

**Note on `envFileExists`.** Stat-only. `block-dangerous.sh` prevents any read of `.env` — the orchestrator detects existence via `fs.statSync(envPath).isFile()` and treats the result as a coarse signal ("user has begun credential setup"). Required-now missing keys surface as loud build failures at `/build-backend`, which is the correct failure locus.

### `pm.ts` — **EXTENDED** (per refactor-003)

Refactor-003 splits PM invocation into two modes: main (`--mode=tasks`) produces `docs/tasks.yaml` post-architect; detour (`--mode=kit-change-request`) produces `plans/active/kit-change-request-{id}.md` on-demand during design. The output schema gains a `mode` discriminator.

```ts
import { z } from "zod";

export const PmOutput = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("tasks"),
    success: z.literal(true),
    tasksCount: z.number().int().nonnegative(),
    tasksYamlPath: z.string(), // docs/tasks.yaml
    warnings: z.array(z.string()),
  }),
  z.object({
    mode: z.literal("kit-change-request"),
    success: z.literal(true),
    miniPlanPath: z.string(), // plans/active/kit-change-request-{id}.md
    requestedPrimitives: z.array(z.string()),
    targetKitVersion: z.string(), // e.g. "1.1.0"
    warnings: z.array(z.string()),
  }),
]);
export type PmOutput = z.infer<typeof PmOutput>;
```

### `skills-audit.ts` — **EXTENDED** (per refactor-003)

Refactor-003 splits the skills-audit by scope. Output schema gains a `scope` discriminator.

```ts
import { z } from "zod";

export const SkillsAuditOutput = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal("design"),
    success: z.literal(true),
    skillsAudited: z.number().int().nonnegative(),
    skillsAuthored: z.number().int().nonnegative(),
    warnings: z.array(z.string()),
  }),
  z.object({
    scope: z.literal("build"),
    success: z.literal(true),
    skillsAudited: z.number().int().nonnegative(),
    skillsAuthored: z.number().int().nonnegative(),
    vendorSdksAudited: z.number().int().nonnegative(),
    warnings: z.array(z.string()),
  }),
]);
export type SkillsAuditOutput = z.infer<typeof SkillsAuditOutput>;
```

### Unchanged schemas (preserved from prior spec)

- `user-flows.ts` — `UserFlowsOutput` (shape unchanged; references signoff for hash bindings)
- `test.ts` — `TestOutput`
- `review.ts` — `ReviewOutput`
- `git.ts` — `GitOutput`

### `index.ts` — lookup table

```ts
export * from "./common.js";
export * from "./analyze.js";
export * from "./skills-audit.js";
export * from "./architect.js";
export * from "./pm.js";
export * from "./mockups.js";
export * from "./selected-style.js";
export * from "./stylesheet.js";
export * from "./screens.js";
export * from "./visual-review.js";
export * from "./user-flows.js";
export * from "./signoff.js";
export * from "./build.js";
export * from "./credentials-gate.js";
export * from "./test.js";
export * from "./review.js";
export * from "./git.js";

import { AnalyzeOutput } from "./analyze.js";
import { SkillsAuditOutput } from "./skills-audit.js";
import { ArchitectOutput } from "./architect.js";
import { PmOutput } from "./pm.js";
import { MockupsOutput } from "./mockups.js";
import { StylesheetOutput } from "./stylesheet.js";
import { ScreensOutput } from "./screens.js";
import { VisualReviewOutput } from "./visual-review.js";
import { UserFlowsOutput } from "./user-flows.js";
import {
  BuildBackendOutput,
  BuildWebFrontendOutput,
  BuildMobileFrontendOutput,
} from "./build.js";
import { CredentialsGateOutput } from "./credentials-gate.js";
import { TestOutput } from "./test.js";
import { ReviewOutput } from "./review.js";
import { GitOutput } from "./git.js";

export const StageSchemas = {
  analyze: AnalyzeOutput,
  "skills-audit-design": SkillsAuditOutput, // scope discriminated internally
  "skills-audit-build": SkillsAuditOutput,
  mockups: MockupsOutput,
  stylesheet: StylesheetOutput,
  screens: ScreensOutput,
  "visual-review": VisualReviewOutput,
  "user-flows": UserFlowsOutput,
  architect: ArchitectOutput,
  "credentials-gate": CredentialsGateOutput, // NEW (refactor-003)
  pm: PmOutput, // mode discriminated internally
  "build-backend": BuildBackendOutput,
  "build-web": BuildWebFrontendOutput,
  "build-mobile": BuildMobileFrontendOutput,
  test: TestOutput,
  review: ReviewOutput,
  git: GitOutput,
} as const;

export type StageName = keyof typeof StageSchemas;
```

Stage-name ordering matches task 035's `STAGES` array (refactor-003 order). `skills-audit` appears twice in the lookup keyed by the orchestrator stage name (`skills-audit-design` / `skills-audit-build`), both sharing the `SkillsAuditOutput` schema which is discriminated on its `scope` field.

### JSON Schema export (for HTML form validators)

Task 025's sign-off form validator AND the mockup gate's `POST /api/select` handler both consume JSON-Schema equivalents of these Zod schemas. The script at `scripts/export-json-schemas.ts` runs `zod-to-json-schema` over:

- `Signoff` → `schemas/signoff.schema.json`
- `SelectedStyleSchema` → `schemas/selected-style.schema.json`

…and emits draft-07 JSON Schema. These are imported by the HITL gate server (task 036) at runtime to validate incoming POST bodies before writing to disk.

## Acceptance Criteria

- [ ] `packages/orchestrator-contracts/` exists with the file structure above
- [ ] Every stage in task 035's stage array has a matching schema entry in `StageSchemas`
- [ ] `common.ts` exports `Target`, `PlatformId`, `ScreenId`, `AssetRef`, `Sha256`, `Dials`, `FeatureFlag`, `SemverString`
- [ ] `AssetRef.provenance` enum includes all six values: `user | researched | generated | hybrid | stock | vector`
- [ ] `MockupsOutput` includes all refactor-001 fields: `styleCount`, `appsCovered`, `archetypesPerAppPerStyle`, `mockupsPerStyle`, `nanobananaUsed`, `imagesGeneratedCount`, `imagesStockCount`, `imagesVectorFallbackCount`, `selfCheckRegenerations`, `reviewIndexPath`, `warnings`
- [ ] `SelectedStyleSchema` exists and validates `docs/selected-style.json`; `selectedBy` accepts both `"human"` and `"auto-single-style"`; **`iconLibrary` field exists** (refactor-003) and uses the `IconLibrary` enum
- [ ] `IconLibrary` enum exported from `selected-style.ts` with values `lucide | phosphor | heroicons | iconoir | tabler`
- [ ] `AnalyzeOutput` includes `integrationsResearched: number` (refactor-003)
- [ ] `ArchitectOutput` exists with the refactor-003 shape: `appsCount`, `packagesCount`, `vendorDecisions`, `selfHostedDecisions`, `declinedDecisions`, `envVarsRequiredNow`, `envVarsRequiredLater`, `envVarsOptional`, `credentialsDiffEmitted`, `buildMcpServersAdded`, `warnings`
- [ ] `CredentialsGateOutput` exists with `decision: "proceed"|"defer"|"abort"`, `servicesConfirmed[]`, `servicesDeferred[]`, `deferralReasons`, `envFileExists`, `warnings`
- [ ] `PmOutput` is a discriminated union on `mode: "tasks" | "kit-change-request"` (refactor-003)
- [ ] `SkillsAuditOutput` is a discriminated union on `scope: "design" | "build"` (refactor-003)
- [ ] `StylesheetOutput` includes `kitVersion`, primitives/patterns/layouts lists + counts (≥20 / ≥12 / ≥5), `noChange`, `budgetExhausted`, `gapsPath`
- [ ] `ScreensOutput` is a discriminated union on `mode: "batch" | "single-screen"`
- [ ] `ScreensOutput.batch` includes `uiKitVersion`, `kitChangeRequests`, image-count fields, `screensManifestHash`
- [ ] `ScreensOutput.single-screen` includes `screen`, `attempt`, `feedbackApplied`, `nanobananaUsed`
- [ ] `VisualReviewOutput` exists with `screensReviewed`, `passed`, `failed`, `retriesTriggered`, `needsHumanReview[]`, `violations[]`, `reportPath`
- [ ] `Signoff` extended with `visualReviewReportHash` + `uiKitVersion` (nine fields total)
- [ ] `BuildWebFrontendOutput` + `BuildMobileFrontendOutput` + `BuildBackendOutput` exist as separate schemas
- [ ] `StageSchemas` lookup covers all 17 refactor-003 stages — keys: `analyze, skills-audit-design, mockups, stylesheet, screens, visual-review, user-flows, architect, credentials-gate, pm, skills-audit-build, build-backend, build-web, build-mobile, test, review, git`
- [ ] `zod-to-json-schema` exports produce `signoff.schema.json` + `selected-style.schema.json` (draft-07)
- [ ] Task 034 references this task for the Zod schema deliverable
- [ ] Task 035 imports `StageSchemas` and validates every stage output against it

## Human Verification

1. Pick any two pipeline stages — are their schemas strict enough to catch a degraded agent output (e.g., missing field, wrong type)?
2. Attempt to import `SelectedStyleSchema` from the orchestrator-contracts package — does it type-check?
3. Run the JSON Schema export — do `schemas/signoff.schema.json` and `schemas/selected-style.schema.json` round-trip cleanly when validated against hand-authored valid samples?
4. Write a sample `docs/selected-style.json` with `selectedBy: "auto-single-style"` — does the schema accept it?
5. Write a sample `docs/screens-output.json` with `mode: "single-screen"` missing the `screen` field — does the discriminated union reject it with a clear error?
