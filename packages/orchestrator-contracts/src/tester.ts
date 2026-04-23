import { z } from "zod";

/**
 * Tester return JSON contract (scaffolding/17-031 + .claude/rules/testing-policy.md).
 *
 * Tester runs after builders in `feature.agent_sequence[]`. Hybrid-TDD
 * per feat-004: tester does NOT author happy-path tests (builders do);
 * tester adds edge-case + integration + E2E + runs full suite with
 * coverage. Raises coverage from builder's 60% scope floor to 80% total.
 *
 * Orchestrator validates via `TesterOutput` before advancing agent_sequence
 * (typically to reviewer).
 */

/** Which test layer the tester authored. */
export const TesterTestLayer = z.enum(["edge-case", "integration", "e2e"]);
export type TesterTestLayer = z.infer<typeof TesterTestLayer>;

/**
 * A failing tester test attributed to a genuine builder bug (not a
 * test-authoring mistake). Orchestrator routes this back to the
 * last-writing builder via the task-retry ladder (refactor-004, max 3).
 */
export const GenuineProductBug = z.object({
  taskId: z.string().min(1),
  builderAgent: z.enum([
    "backend-builder",
    "web-frontend-builder",
    "mobile-frontend-builder",
  ]),
  testFile: z.string().min(1),
  testName: z.string().min(1),
  failureMessage: z.string().min(1),
  likelyCause: z.string().optional(),
});
export type GenuineProductBug = z.infer<typeof GenuineProductBug>;

/** Coverage + pass/fail for the full suite run (builder tests + tester tests). */
export const FullSuiteRun = z.object({
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export type FullSuiteRun = z.infer<typeof FullSuiteRun>;

export const TesterOutput = z.object({
  success: z.boolean(),
  featureId: z.string().regex(/^feat-[a-z][a-z0-9-]{1,48}$/),
  /** Counts by test layer; tester only — NOT including builder-authored happy-path tests. */
  testsWritten: z.object({
    edgeCase: z.number().int().nonnegative(),
    integration: z.number().int().nonnegative(),
    e2e: z.number().int().nonnegative(),
  }),
  /** Files the tester wrote (for audit + retry diffing). */
  testFilesWritten: z.array(z.string()).default([]),
  /** Full-suite run — builder tests + tester tests combined. */
  testsRun: FullSuiteRun,
  /** Total coverage across both sources, 0-100. */
  coverageTotal: z.number().min(0).max(100),
  /** Coverage on builder-authored lines only, 0-100. Should already be ≥60 pre-tester. */
  coverageBuilderOnly: z.number().min(0).max(100),
  /**
   * Policy check per `.claude/rules/testing-policy.md`:
   *   pass    — coverageTotal ≥ 80
   *   fail    — coverageTotal < 80 after retries; gate-4 signoff invalidated
   *   blocked — full-suite run didn't complete (install/runtime failure); needs
   *             human diagnosis before retry
   */
  policyCheck: z.enum(["pass", "fail", "blocked"]),
  /** Routed back to last-writing builder for retry. Empty when tester found no real bugs. */
  genuineProductBugs: z.array(GenuineProductBug).default([]),
  /** HEAD sha after the tester's test-only commits. null if no commits. */
  headSha: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/)
    .nullable(),
  warnings: z.array(z.string()).default([]),
});
export type TesterOutput = z.infer<typeof TesterOutput>;
