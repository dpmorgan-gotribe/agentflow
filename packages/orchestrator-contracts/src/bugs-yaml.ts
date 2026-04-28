import { z } from "zod";
import { AgentSequenceMember } from "./tasks.js";

/**
 * `docs/bugs.yaml` schema — feat-026.
 *
 * Orchestrator-managed channel populated EXCLUSIVELY by the
 * `/build-to-spec-verify` stage (feat-022 + feat-025). Drives the
 * automated bug-fix loop (`runFixBugsLoop`) which iterates verify→fix→verify
 * until clean OR caps hit.
 *
 * **Critical separation from `/plan-bug`**: `plans/active/bug-NNN-*.md` is
 * the user-only channel for human-discovered bugs. `bugs.yaml` is the
 * orchestrator-only channel for verifier-discovered bugs. The two channels
 * never overlap by design — the same `bug-NNN` plan file referenced from
 * `bugPlanPath` here is auto-filed by `scripts/file-bug-plan.mjs`, not
 * authored by `/plan-bug`.
 */

/** Where the bug came from. The verifier emits all three; nothing else writes here. */
export const BugSourceSchema = z.enum([
  "reachability-orphan", // feat-022 reachability analyzer
  "flow-execution-failure", // feat-025 spec runner
  "pm-coverage-omission", // feat-023 brief-coverage gate (rare; usually fails earlier)
]);
export type BugSource = z.infer<typeof BugSourceSchema>;

/** Lifecycle states an entry walks during `runFixBugsLoop`. */
export const BugStatusSchema = z.enum([
  "pending",
  "in-progress",
  "completed",
  "failed", // hit per-bug attempt cap or flapping detector
  "skipped", // dependency-failed cascade
]);
export type BugStatus = z.infer<typeof BugStatusSchema>;

/** Severity tier — verifier emits all bugs as P0 in v1; field exists for future tuning. */
export const BugSeveritySchema = z.enum(["P0", "P1", "P2"]);
export type BugSeverity = z.infer<typeof BugSeveritySchema>;

/**
 * Source-specific context for a flow-execution-failure bug. Mirrors
 * `FlowFailure` from `build-to-spec-verify.ts` but flatter (no nested
 * `screenshotPath` aliases — the verifier picks one when emitting).
 */
export const BugFlowContextSchema = z.object({
  id: z.string().min(1), // e.g. "flow-4"
  name: z.string().min(1), // e.g. "Open detail-edit modal"
  failedStep: z.number().int().nonnegative(),
  expectedScreenId: z.string().min(1),
  actualScreenId: z.string().nullable(),
  selector: z.string().nullable(),
  screenshot: z.string().nullable(),
  htmlDump: z.string().nullable(),
});
export type BugFlowContext = z.infer<typeof BugFlowContextSchema>;

/** Source-specific context for a reachability-orphan bug. */
export const BugOrphanContextSchema = z.object({
  componentPath: z.string().min(1),
  exportNames: z.array(z.string()).default([]),
  suggestedImporters: z.array(z.string()).default([]),
});
export type BugOrphanContext = z.infer<typeof BugOrphanContextSchema>;

/**
 * One bug entry. `iteration` records when the verifier first detected it;
 * `attempts` is the per-bug attempt counter the loop respects. Either
 * `flow` or `orphan` is populated (matching `source`); the other is
 * undefined / omitted.
 *
 * Bug ID grammar: `bug-(flow|orphan|coverage)-<slug>`. The slug is
 * derived by `scripts/file-bug-plan.mjs` so the orchestrator + the writer
 * agree on identity for cross-iteration dedup.
 */
export const BugEntrySchema = z.object({
  id: z.string().regex(/^bug-(flow|orphan|coverage)-[a-z0-9-]+$/),
  iteration: z.number().int().min(1),
  source: BugSourceSchema,
  severity: BugSeveritySchema.default("P0"),
  summary: z.string().min(1).max(200),

  // Source-specific context (one of these will be populated)
  flow: BugFlowContextSchema.optional(),
  orphan: BugOrphanContextSchema.optional(),

  // Correlation (set when verifier matches a flow failure to an orphan)
  correlatedOrphanPath: z.string().nullable().default(null),
  owningFeature: z.string().nullable().default(null),
  affectsFiles: z.array(z.string()).default([]),

  // Assignment + retry
  agentSequence: z.array(AgentSequenceMember).min(1),
  status: BugStatusSchema.default("pending"),
  attempts: z.number().int().min(0).default(0),
  maxAttempts: z.number().int().min(1).default(3),

  /**
   * feat-026 flapping detector — number of times this bug has been marked
   * `completed` by the loop only to reappear in a subsequent verify pass.
   * On reaching `maxFlapResets` (default 3 in `runFixBugsLoop`) the bug
   * is escalated to `failed` regardless of remaining attempts.
   */
  flapResets: z.number().int().min(0).default(0),

  /**
   * Iteration in which the bug was resolved (set when status flips to
   * `completed`). Stays in bugs.yaml for audit per Phase E lifecycle.
   */
  resolvedInIteration: z.number().int().min(1).nullable().default(null),

  // Cross-references
  bugPlanPath: z.string().nullable().default(null), // plans/active/bug-NNN-...md
  errorLog: z.array(z.string()).default([]), // append per attempt
});
export type BugEntry = z.infer<typeof BugEntrySchema>;

/**
 * Top-level `docs/bugs.yaml` shape. `iteration` reflects the current loop
 * iteration; `iteration_cap` defaults to 5 per plan §Phase B.
 */
export const BugsYamlSchema = z.object({
  version: z.literal("1.0"),
  generated_at: z.string(),
  project_name: z.string().min(1),
  source_run_id: z.string().min(1), // pipelineRunId of the run that filed bugs
  iteration: z.number().int().min(1),
  iteration_cap: z.number().int().min(1).default(5),
  bugs: z.array(BugEntrySchema).default([]),
});
export type BugsYaml = z.infer<typeof BugsYamlSchema>;

/**
 * JSON Schema export — mirrors `BuildToSpecVerifyOutputJsonSchema` from
 * feat-022. Emitted to `schemas/bugs-yaml.schema.json` for non-SDK
 * consumers (CI / external validators / future bugs-yaml linters).
 */
export const BugsYamlJsonSchema = z.toJSONSchema(BugsYamlSchema);

/**
 * Auto-derive the agent sequence the orchestrator should dispatch for a
 * given bug source. Per plan §Phase A:
 *   - reachability-orphan        → web-frontend-builder, tester, reviewer
 *   - flow-execution-failure     → web-frontend-builder, tester, reviewer
 *   - pm-coverage-omission       → pm, web-frontend-builder, tester, reviewer
 *
 * For `pm-coverage-omission`, `pm` is NOT in `AgentSequenceMember` (PM is
 * Mode A, not Mode B); we treat coverage bugs as builder work in v1 and
 * surface them with the same builder-led sequence. Future: wire a real
 * Mode A re-entry for coverage bugs (deferred per plan §non-goals).
 */
export function defaultAgentSequenceForSource(
  source: BugSource,
): readonly z.infer<typeof AgentSequenceMember>[] {
  switch (source) {
    case "reachability-orphan":
    case "flow-execution-failure":
    case "pm-coverage-omission":
      return ["web-frontend-builder", "tester", "reviewer"] as const;
  }
}
