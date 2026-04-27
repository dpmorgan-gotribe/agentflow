import { z } from "zod";

/**
 * `/build-to-spec-verify` output contract — feat-022.
 *
 * The deterministic post-Mode-B verification stage runs AFTER the last
 * feature merges and BEFORE the orchestrator emits "complete". It runs
 * two analyzers in parallel and aggregates their results:
 *
 *   1. Static reachability — flags components/routes exported but never
 *      imported in production code. The kanban-webapp-09 motivating gap:
 *      `CardDetailModal` was implemented + tested but never wired into
 *      `KanbanBoard`/`KanbanCard`, shipping orphan through the green
 *      pipeline.
 *
 *   2. Flow-driven E2E synthesis — generates Playwright specs from
 *      `docs/user-flows-manifest.json`, asserts each step's expected
 *      `data-screen-id` lands within 2s of the previous click. Failures
 *      capture screenshot + DOM dump for the auto-filed bug plan.
 *
 * Failures auto-file bug plans (one per integration gap) which the
 * orchestrator routes to the appropriate builder via the standard retry
 * ladder (max 3 per task; escalation at 5). Schema mirrors the
 * BuilderOutput discriminated-union pattern but is NOT discriminated —
 * a single shape; the schema's `ok` field is the success discriminator.
 *
 * Source: plans/active/feat-022-build-to-spec-verification.md §Phase 5.
 */

/**
 * Feature ownership attribution — every reachability violation maps back
 * to the feature in `docs/tasks.yaml` whose `affects_files[]` contains
 * the orphan path. `null` when no owning feature can be inferred (rare;
 * indicates a structural bug elsewhere).
 */
export const OwningFeature = z
  .string()
  .regex(/^feat-[a-z][a-z0-9-]{1,48}$/)
  .nullable();
export type OwningFeature = z.infer<typeof OwningFeature>;

/**
 * Static-reachability violation: a component file with at least one
 * production-public export, zero production importers (test sibling
 * imports don't count). `suggestedImporters` are heuristic — derived
 * from the owning feature's `summary` field cross-referenced against
 * the screen mockup containment graph.
 */
export const OrphanComponent = z.object({
  path: z.string().min(1),
  exportNames: z.array(z.string()).default([]),
  owningFeature: OwningFeature,
  suggestedImporters: z.array(z.string()).default([]),
  reason: z.string().min(1),
});
export type OrphanComponent = z.infer<typeof OrphanComponent>;

/**
 * Static-reachability violation: a Next.js route page (`app/**\/page.tsx`)
 * with no inbound `<Link href="...">` / `router.push("...")` / static href
 * referencing it from production code. `suggestedNavSurfaces` hints which
 * existing nav patterns (sidebar, header, footer) likely should expose
 * the route per the screen mockup containment graph.
 */
export const OrphanRoute = z.object({
  path: z.string().min(1),
  routePattern: z.string().min(1),
  owningFeature: OwningFeature,
  suggestedNavSurfaces: z.array(z.string()).default([]),
  reason: z.string().min(1),
});
export type OrphanRoute = z.infer<typeof OrphanRoute>;

/**
 * Flow-E2E violation: a synthesized spec failed at a specific transition.
 * `expected` is the screen-id encoded by the next step in the flow
 * manifest; `actual` is what `document.body.dataset.screenId` (or the
 * page-root attribute) actually was after the click+wait. The screenshot
 * + html dump capture the moment of failure for the bug-plan template.
 */
export const FlowFailure = z.object({
  flowId: z.string().min(1),
  flowName: z.string().min(1),
  step: z.number().int().nonnegative(),
  fromScreenId: z.string().min(1),
  expectedScreenId: z.string().min(1),
  actualScreenId: z.string().nullable(),
  selector: z.string().nullable(),
  screenshotPath: z.string().nullable(),
  htmlDumpPath: z.string().nullable(),
  message: z.string().min(1),
});
export type FlowFailure = z.infer<typeof FlowFailure>;

/** Reachability sub-report aggregating both orphan classes. */
export const ReachabilityReport = z.object({
  orphanComponents: z.array(OrphanComponent).default([]),
  orphanRoutes: z.array(OrphanRoute).default([]),
  scannedFiles: z.number().int().nonnegative().default(0),
  ignoredByAllowComment: z.array(z.string()).default([]),
});
export type ReachabilityReport = z.infer<typeof ReachabilityReport>;

/** Flow-E2E sub-report. `passed` is the flow IDs; `failed` carries detail. */
export const FlowsReport = z.object({
  passed: z.array(z.string()).default([]),
  failed: z.array(FlowFailure).default([]),
  generated: z.array(z.string()).default([]),
});
export type FlowsReport = z.infer<typeof FlowsReport>;

/**
 * Top-level contract returned by the `/build-to-spec-verify` skill +
 * consumed by the orchestrator's post-merge stage in feature-graph.ts.
 *
 * `ok === true` iff `reachability.orphanComponents.length === 0`
 * AND `reachability.orphanRoutes.length === 0`
 * AND `flows.failed.length === 0`. The schema does NOT enforce this
 * cross-field invariant (Zod refinements bloat error messages) — the
 * orchestrator validates it after parse and treats a mismatch as a
 * malformed-output failure.
 */
export const BuildToSpecVerifyOutput = z.object({
  ok: z.boolean(),
  reachability: ReachabilityReport,
  flows: FlowsReport,
  bugPlansFiled: z.array(z.string()).default([]),
  costUsd: z.number().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  warnings: z.array(z.string()).default([]),
});
export type BuildToSpecVerifyOutput = z.infer<typeof BuildToSpecVerifyOutput>;

/**
 * JSON Schema export — mirrors the `BuilderOutputJsonSchema` pattern from
 * bug-004. Used by the Agent SDK's `outputFormat: { type: "json_schema" }`
 * mechanism when invoking the deterministic skill wrapper, AND emitted to
 * `schemas/build-to-spec-verify-output.schema.json` for non-SDK consumers
 * (CI tooling, external validators).
 */
export const BuildToSpecVerifyOutputJsonSchema = z.toJSONSchema(
  BuildToSpecVerifyOutput,
);
