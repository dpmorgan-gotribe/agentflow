import { z } from "zod";
import { ParityVerifyOutputSchema } from "./parity-verify.js";

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
 * feat-027 Phase C — page error captured by the synthesizer's `pageerror`
 * listener. `stack` is optional because some pageerror events surface only
 * a string (e.g., dev-server overlay-relayed errors).
 */
export const RuntimePageError = z.object({
  message: z.string().min(1),
  stack: z.string().optional(),
});
export type RuntimePageError = z.infer<typeof RuntimePageError>;

/** feat-027 Phase C — failed network request captured by `requestfailed`. */
export const RuntimeNetworkFailure = z.object({
  method: z.string().min(1),
  url: z.string().min(1),
  failureText: z.string(),
});
export type RuntimeNetworkFailure = z.infer<typeof RuntimeNetworkFailure>;

/**
 * feat-027 Phase C — Next.js dev-server error overlay payload. `rawText` is
 * the verbatim overlay content (truncated to a sane length by the
 * synthesizer). `detected: true` means the overlay was visibly rendered at
 * the moment of capture; the verifier promotes this to `primaryCause:
 * "dev-server-compile"` since it cascades into every subsequent step.
 */
export const DevServerOverlay = z.object({
  rawText: z.string().min(1),
  detected: z.boolean(),
});
export type DevServerOverlay = z.infer<typeof DevServerOverlay>;

/**
 * feat-027 Phase C — runtime errors aggregated per spec execution. Captured
 * by the `test.beforeEach` / `test.afterEach` hooks emitted by
 * `scripts/synthesize-flow-e2e.mjs` and surfaced into FlowFailure by
 * `scripts/run-synthesized-flows.mjs` via the `runtime-errors` Playwright
 * test attachment. All fields default to empty so downstream code can
 * safely iterate without nullish checks.
 */
export const RuntimeErrors = z.object({
  consoleErrors: z.array(z.string()).default([]),
  pageErrors: z.array(RuntimePageError).default([]),
  networkFailures: z.array(RuntimeNetworkFailure).default([]),
  devServerOverlay: DevServerOverlay.optional(),
});
export type RuntimeErrors = z.infer<typeof RuntimeErrors>;

/**
 * feat-027 Phase C — primary cause classification for a failed flow. The
 * runner picks ONE based on a precedence ladder:
 *   1. devServerOverlay present → `dev-server-compile` (root-cause; cascades
 *      into every step)
 *   2. error message starts with `seedFixtures:` / `cleanupFixtures:` →
 *      `seed-setup` (feat-038 Phase 4) — Strategy C beforeAll/afterAll
 *      hook failed; this is an environment issue (backend not reachable,
 *      `ENABLE_TEST_SEED=1` not set, schema mismatch on the seed payload),
 *      NOT an app bug. The bug-author should route these to the operator
 *      with remediation guidance rather than dispatching a builder.
 *   3. ANY runtime signal (console/page/network) → `runtime-error`
 *   4. test timed out with no synthesizer-recorded transition meta →
 *      `timeout-no-evidence` (pre-feat-027 black-box state — surface so the
 *      auto-fix loop knows it lacks signal)
 *   5. default → `step-transition` (the synthesizer's own assertion fired)
 *
 * The bug-author + iteration router consume this to (a) emit the right bug
 * template (`runtimeErrorBody` vs `flowFailureBody` vs `seedSetupBody`),
 * and (b) sort runtime-error / dev-server-compile / seed-setup bugs FIRST
 * so the auto-fix loop resolves the cascade-root before chasing dependent
 * timeouts.
 */
export const FlowPrimaryCause = z.enum([
  "step-transition",
  "runtime-error",
  "dev-server-compile",
  "timeout-no-evidence",
  "seed-setup",
]);
export type FlowPrimaryCause = z.infer<typeof FlowPrimaryCause>;

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
  // bug-039 (2026-05-02): nullable. The v2.0 synthesizer emit path (post
  // feat-038 Phase 2A) wraps step actions in a try/catch whose error
  // message only includes __stepIndex + the underlying error — NOT the
  // `from-screen-id:` / `toward-screen-id:` markers the runner's regex
  // looks for in `parseFailureMeta`. Producer therefore can't populate
  // these fields for v2.0 specs; null is the honest signal.
  // Phase B (synthesizer embeds the markers in v2.0 catch messages) will
  // restore production; until then, downstream consumers MUST handle null.
  fromScreenId: z.string().nullable(),
  expectedScreenId: z.string().nullable(),
  actualScreenId: z.string().nullable(),
  selector: z.string().nullable(),
  screenshotPath: z.string().nullable(),
  htmlDumpPath: z.string().nullable(),
  /**
   * feat-025 Phase 3 — convenience aliases populated by the live spec
   * runner (`scripts/run-synthesized-flows.mjs`). They mirror
   * `screenshotPath` + `htmlDumpPath` but use the shorter names the
   * downstream bug-plan template + flow-failure template expect. Optional
   * to preserve back-compat with v1 emitters that only populate the
   * `*Path` fields. When both are present, the runner-populated `screenshot`
   * + `html` win for bug-plan rendering.
   */
  screenshot: z.string().optional(),
  html: z.string().optional(),
  /**
   * feat-027 Phase C — runtime errors observed during the failing spec.
   * Optional for back-compat with v1 emitters; when present, the bug-author
   * uses the runtimeError template instead of the step-transition template.
   */
  runtimeErrors: RuntimeErrors.optional(),
  /**
   * feat-027 Phase C — primary failure classification (see FlowPrimaryCause).
   * Optional so v1 emitters keep working; downstream bug-author defaults to
   * `step-transition` when omitted.
   */
  primaryCause: FlowPrimaryCause.optional(),
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
 * AND `flows.failed.length === 0`
 * AND (when present) `parity.divergences.length === 0`.
 * The schema does NOT enforce this cross-field invariant (Zod refinements
 * bloat error messages) — the orchestrator validates it after parse and
 * treats a mismatch as a malformed-output failure.
 *
 * **feat-028 Phase 4 — `parity` field**: optional, populated by the
 * `runParityVerify()` stage in `orchestrator/src/build-to-spec-verify.ts`
 * AFTER reachability + flow-execution. Absent when the parity stage was
 * disabled, the project lacks `docs/screens/{platform}/*.html` mockups,
 * or pre-feat-028 callers parse legacy outputs. When present, an `ok:false`
 * parity sub-report flips the top-level `ok` to false and contributes
 * bug-plans (one per (screen, pattern) tuple) to `bugPlansFiled[]`.
 */
export const BuildToSpecVerifyOutput = z.object({
  ok: z.boolean(),
  reachability: ReachabilityReport,
  flows: FlowsReport,
  parity: ParityVerifyOutputSchema.optional(),
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
