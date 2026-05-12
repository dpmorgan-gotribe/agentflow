/**
 * feat-068 — vision-LLM perceptual review contract.
 *
 * Tier 4 detection layer that runs AFTER parity-verify (Tier 3) in the
 * build-to-spec-verify pipeline. Compares each screen's mockup PNG against
 * its live-rendered PNG via a vision-capable LLM (perceptual-reviewer
 * agent). Emits visible-element-level discrepancies that the structural +
 * pixel-diff parity layer misses (color, sizing, polish, icon-shape,
 * typographic-hierarchy nuance).
 *
 * Cascade contract (load-bearing for v2):
 *   - Each per-screen invocation receives the parity findings for that
 *     screen as CONTEXT INPUT in the user prompt — the agent skips
 *     re-reporting drift already filed.
 *   - The dispatcher SKIPS screens that parity (Tier 3) already flagged
 *     with `pixel-systemic-divergence` or `shell-stripping` — those are
 *     systemic and downstream perceptual review is redundant.
 *   - The dispatcher SKIPS screens that flow-execution (Tier 2) flagged
 *     with `dev-server-not-responding` — no live page to compare against.
 */

import { z } from "zod";

/**
 * One visible discrepancy between mockup and live. The agent emits these
 * as JSON inside `<<<TASK_OUTCOME>>>` sentinels; the dispatcher parses
 * and validates against this schema.
 */
export const PerceptualFindingSchema = z.object({
  /** Brief element identifier the agent saw — e.g. "Pencil edit button on book card". */
  element: z.string().min(1),
  /** What the mockup shows for that element. */
  mockupValue: z.string().min(1),
  /** What the live build renders for that element. */
  actualValue: z.string().min(1),
  /** Severity per the agent's system prompt rubric. */
  severity: z.enum(["P0", "P1", "P2"]).default("P1"),
});
export type PerceptualFinding = z.infer<typeof PerceptualFindingSchema>;

/**
 * Per-screen perceptual review result. One of these per screen the
 * dispatcher invoked the agent against.
 */
export const PerceptualScreenReviewSchema = z.object({
  /** Screen-id (matches docs/screens/<platform>/<screen>.html stem). */
  screen: z.string().min(1),
  /**
   * Findings emitted by the agent. Empty when the live matched the
   * mockup OR when the agent couldn't compare (see `errors`).
   */
  findings: z.array(PerceptualFindingSchema).default([]),
  /**
   * Non-fatal per-screen errors from the agent (image unreadable,
   * shape-mismatch, etc.). Surfaced as warnings, not blocking.
   */
  errors: z.record(z.string(), z.string()).default({}),
  /** SDK cost in USD for this screen's dispatch. */
  costUsd: z.number().nonnegative().default(0),
  /**
   * Reason the dispatcher skipped this screen. Present iff the
   * cascade-skip rules suppressed the agent invocation. When set,
   * `findings` is empty + `costUsd` is 0.
   */
  skippedReason: z
    .enum([
      "parity-systemic",
      "parity-shell-stripping",
      "dev-server-not-responding",
      "no-live-png",
      "no-mockup-png",
    ])
    .optional(),
});
export type PerceptualScreenReview = z.infer<
  typeof PerceptualScreenReviewSchema
>;

/**
 * Top-level perceptual-review output. Folded into `BuildToSpecVerifyOutput`
 * alongside `parity`. `ok === true` iff every screen has 0 findings AND
 * 0 errors.
 */
export const PerceptualReviewOutputSchema = z.object({
  ok: z.boolean(),
  screensReviewed: z.number().int().nonnegative(),
  screensSkipped: z.number().int().nonnegative(),
  reviews: z.array(PerceptualScreenReviewSchema).default([]),
  warnings: z.array(z.string()).default([]),
  durationMs: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});
export type PerceptualReviewOutput = z.infer<
  typeof PerceptualReviewOutputSchema
>;
