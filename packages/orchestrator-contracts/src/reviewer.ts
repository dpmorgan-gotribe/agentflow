import { z } from "zod";

/**
 * Reviewer return JSON contract — scaffolding/18-032-reviewer-agent.md
 * (refactor-005 aligned) + docs/reviewer-playbook.md (7 dimensions).
 *
 * Reviewer is the LAST agent in the typical feature.agent_sequence[]
 * chain (backend-builder → web-frontend-builder → mobile-frontend-builder
 * → tester → reviewer). Runs inside a feature worktree. Read-first by
 * design — does NOT rewrite tests or refactor code.
 *
 * Orchestrator validates against `ReviewerOutput` before advancing to
 * git-agent close-feature (on approved) OR routing retries to named
 * builders (on needs-revision) OR halting the feature (on blocked).
 */

/** The 7 canonical review dimensions per docs/reviewer-playbook.md. */
export const ReviewDimension = z.enum([
  "architecture",
  "security",
  "compliance",
  "maintainability",
  "a11y",
  "performance",
  "brief-delivery",
]);
export type ReviewDimension = z.infer<typeof ReviewDimension>;

/**
 * Agents the orchestrator can route retries to. Builders handle most
 * needs-revision issues; architect + pm receive routing when the issue
 * stems from a spec-level gap (wrong vendor picked, features[] grouped
 * wrongly) rather than implementation drift.
 */
export const ReviewRetryAgent = z.enum([
  "backend-builder",
  "web-frontend-builder",
  "mobile-frontend-builder",
  "architect",
  "pm",
]);
export type ReviewRetryAgent = z.infer<typeof ReviewRetryAgent>;

export const RetryTarget = z.object({
  agent: ReviewRetryAgent,
  /** Task IDs from the feature's tasks.yaml that this agent should revisit. */
  taskIds: z.array(z.string().min(1)).min(1),
});
export type RetryTarget = z.infer<typeof RetryTarget>;

/**
 * Per-issue detail. `playbookSection` cites the dimension + sub-section
 * of `docs/reviewer-playbook.md` that was violated (e.g. "§2.5
 * rate-limiting"). `retryTarget` is REQUIRED on needs-revision issues —
 * orchestrator can't route without it.
 */
export const ReviewIssue = z.object({
  dimension: ReviewDimension,
  playbookSection: z.string().min(1),
  severity: z.enum(["error", "warning"]),
  filePath: z.string().min(1),
  line: z.number().int().positive().optional(),
  message: z.string().min(1),
  retryTarget: RetryTarget,
});
export type ReviewIssue = z.infer<typeof ReviewIssue>;

/**
 * Per-dimension result. Discriminated union on `status`.
 *   - `pass`    — dimension passed all criteria
 *   - `fail`    — ≥1 criterion failed; issues[] populated
 *   - `skipped` — tooling unavailable (scratch repo, no dev server, etc.)
 *                  Not a fail. Feeds into warnings[], not issuesFound[].
 */
export const DimensionResult = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pass") }),
  z.object({
    status: z.literal("fail"),
    issues: z.array(ReviewIssue).min(1),
  }),
  z.object({
    status: z.literal("skipped"),
    reason: z.string().min(1),
  }),
]);
export type DimensionResult = z.infer<typeof DimensionResult>;

/**
 * Verdict-mapping rules (composed from dimensions):
 *   - `approved`       — zero `fail` dimensions (skipped + pass only)
 *   - `needs-revision` — ≥1 `fail` dimension where every issue has an
 *                        actionable retryTarget (builder retry ladder
 *                        max 3 can reach it)
 *   - `blocked`        — spec contradiction (e.g. brief says GDPR
 *                        required but architecture.compliance.gdpr:false);
 *                        needs human
 */
export const OverallVerdict = z.enum(["approved", "needs-revision", "blocked"]);
export type OverallVerdict = z.infer<typeof OverallVerdict>;

export const ReviewerOutput = z.object({
  success: z.boolean(),
  featureId: z.string().regex(/^feat-[a-z][a-z0-9-]{1,48}$/),
  /** One entry per ReviewDimension; all 7 keys present. */
  dimensions: z.object({
    architecture: DimensionResult,
    security: DimensionResult,
    compliance: DimensionResult,
    maintainability: DimensionResult,
    a11y: DimensionResult,
    performance: DimensionResult,
    "brief-delivery": DimensionResult,
  }),
  overallVerdict: OverallVerdict,
  /** Flat list of all issues across all dimensions — for easy consumer iteration. */
  issuesFound: z.array(ReviewIssue).default([]),
  /** Aggregated per-agent retry routing — dedupes across issuesFound. Orchestrator consumes this. */
  retryTargets: z.array(RetryTarget).default([]),
  /** Record of tool invocations reviewer ran (grep commands, typecheck, lint, knip, etc.). Audit trail. */
  toolsUsed: z.array(z.string()).default([]),
  /** null if reviewer made no commits (the usual case — reviewer is read-only). */
  headSha: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/)
    .nullable(),
  warnings: z.array(z.string()).default([]),
});
export type ReviewerOutput = z.infer<typeof ReviewerOutput>;
