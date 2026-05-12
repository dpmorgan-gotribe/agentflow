/**
 * feat-068 — vision-LLM perceptual review (Tier 4 detection layer).
 *
 * Per-screen dispatcher that:
 *   - Reads parity (Tier 3) output for cascade-skip + context-narrowing
 *   - Skips screens where Tier 2 (flow-execution) hit dev-server-not-responding
 *   - Skips screens already flagged systemic / shell-stripping by Tier 3
 *   - Invokes the perceptual-reviewer agent per remaining screen with mockup
 *     PNG + live PNG + parity findings as context
 *   - Reads the agent's per-screen findings JSON file post-dispatch
 *   - Aggregates into a PerceptualReviewOutput consumed by
 *     build-to-spec-verify
 *
 * The agent writes findings to
 * `<projectDir>/docs/build-to-spec/perceptual/<screenId>.json`. The
 * dispatcher reads + validates that file. If the agent reported `completed`
 * but failed to write the file, the dispatcher records a warning + treats
 * findings as empty for that screen.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  ParityVerifyOutput,
  PerceptualFinding,
  PerceptualReviewOutput,
  PerceptualScreenReview,
  FlowFailure,
} from "@repo/orchestrator-contracts";
import { PerceptualScreenReviewSchema } from "@repo/orchestrator-contracts";

import type { InvokeAgentFn } from "./feature-graph.js";

const PERCEPTUAL_AGENT = "perceptual-reviewer" as const;

export interface PerceptualReviewContext {
  /** Project under review. */
  projectDir: string;
  /** Factory root (for invokeAgent's cwd resolution). */
  factoryRoot: string;
  /** Screen ids to consider (full list — cascade-skip filters down). */
  screenIds: string[];
  /** Tier 3 output. Drives cascade-skip + per-screen prompt context. */
  parity?: ParityVerifyOutput;
  /** Tier 2 flow-execution failures. Drives dev-server-not-responding skip. */
  flowFailures?: FlowFailure[];
  /** Agent dispatch seam — wraps Claude Agent SDK. */
  invokeAgent: InvokeAgentFn;
  /** Pipeline run id (for telemetry passthrough). */
  pipelineRunId?: string;
}

const PARITY_PATTERNS_SUPPRESSING_PERCEPTUAL = new Set([
  // Tier 3 already filed a screen-wide systemic bug → vision-LLM redundant
  "pixel-systemic-divergence",
  "systemic-divergence",
  // Structural shell missing → fix the shell first; perceptual review wasted
  "shell-stripping",
]);

/**
 * Resolve the cascade-skip decision for one screen. Returns a skipReason
 * when the screen should be skipped; undefined when the screen proceeds
 * to perceptual review.
 */
function resolveSkipReason(
  screenId: string,
  projectDir: string,
  parity?: ParityVerifyOutput,
  flowFailures?: FlowFailure[],
): PerceptualScreenReview["skippedReason"] | undefined {
  // Tier 2 cascade — bug-084's dev-server-not-responding marks a flow as
  // unable-to-reach-page. The synthesizer's failure has a __stepIndex 0
  // shape; screens that share the same URL prefix would also be unreachable.
  // Simplest reliable check: if ANY flow-failure has primaryCause set to
  // dev-server-not-responding, skip ALL screens (the whole dev server is
  // down, not just one flow's target).
  if (
    flowFailures?.some((f) => f.primaryCause === "dev-server-not-responding")
  ) {
    return "dev-server-not-responding";
  }

  // Tier 3 cascade — parity already filed a systemic bug for this screen.
  const screenPatterns =
    parity?.divergences
      .filter((d) => d.screen === screenId)
      .map((d) => d.pattern) ?? [];
  if (
    screenPatterns.some((p) => PARITY_PATTERNS_SUPPRESSING_PERCEPTUAL.has(p))
  ) {
    // Distinguish the two for telemetry.
    if (screenPatterns.includes("shell-stripping")) {
      return "parity-shell-stripping";
    }
    return "parity-systemic";
  }

  // No-png cascade — without both PNGs we have no comparison to make.
  // parity-verify (post-feat-068 change) ALWAYS persists both PNGs per
  // screen, but cover the absence path for defensive correctness.
  const mockupPath = join(
    projectDir,
    "docs",
    "build-to-spec",
    "pixel-diffs",
    `${screenId}.mockup.png`,
  );
  const livePath = join(
    projectDir,
    "docs",
    "build-to-spec",
    "pixel-diffs",
    `${screenId}.built.png`,
  );
  if (!existsSync(mockupPath)) return "no-mockup-png";
  if (!existsSync(livePath)) return "no-live-png";

  return undefined;
}

/**
 * Build the per-screen pre-loaded context the agent receives in the user
 * prompt. Includes:
 *   - The mockup + live PNG paths (agent reads them via Read tool)
 *   - The output JSON path where the agent writes findings
 *   - Tier 3 parity findings for this screen (so the agent doesn't re-report)
 *   - The synthetic task id for the sentineled return
 */
function buildPerceptualPreload(args: {
  screenId: string;
  projectDir: string;
  outputPath: string;
  taskId: string;
  parityFindings: string[];
}): string {
  const lines: string[] = [];
  lines.push(
    `## Pre-loaded perceptual-review context (screen: ${args.screenId})`,
  );
  lines.push("");
  lines.push("Read these two PNGs and compare them visually:");
  lines.push("");
  lines.push(
    `- **Mockup (ground truth)**: \`docs/build-to-spec/pixel-diffs/${args.screenId}.mockup.png\``,
  );
  lines.push(
    `- **Live (built)**: \`docs/build-to-spec/pixel-diffs/${args.screenId}.built.png\``,
  );
  lines.push("");
  lines.push("Write your findings (JSON) to:");
  lines.push("");
  lines.push(`- \`docs/build-to-spec/perceptual/${args.screenId}.json\``);
  lines.push("");
  lines.push(
    `Synthetic task id (use in your sentineled outcome): \`${args.taskId}\``,
  );
  lines.push("");
  if (args.parityFindings.length > 0) {
    lines.push(
      "### Tier 3 (parity) findings ALREADY FILED — do NOT re-report these",
    );
    lines.push("");
    for (const f of args.parityFindings) lines.push(`- ${f}`);
    lines.push("");
    lines.push(
      "Focus your review on visible discrepancies NOT covered by the list above.",
    );
  } else {
    lines.push(
      "### No parity findings filed for this screen — the structural+pixel layer found it clean. Look for visual issues the structural layer can't see (color, polish, icon-shape, hierarchy).",
    );
  }
  return lines.join("\n");
}

/**
 * Format Tier 3 parity findings for one screen into one-line strings the
 * agent can read inline. Compact: `<pattern>: <count>-drift detail` style.
 */
function formatParityFindingsForScreen(
  screenId: string,
  parity: ParityVerifyOutput | undefined,
): string[] {
  if (!parity) return [];
  return parity.divergences
    .filter((d) => d.screen === screenId)
    .map((d) => {
      const variantCount = Array.isArray(
        (d.detail as Record<string, unknown>).variantDrift,
      )
        ? (d.detail as { variantDrift: unknown[] }).variantDrift.length
        : 0;
      const styleCount = Array.isArray(
        (d.detail as Record<string, unknown>).styleDrift,
      )
        ? (d.detail as { styleDrift: unknown[] }).styleDrift.length
        : 0;
      const missingCount = Array.isArray(
        (d.detail as Record<string, unknown>).missing,
      )
        ? (d.detail as { missing: unknown[] }).missing.length
        : 0;
      const counts: string[] = [];
      if (missingCount) counts.push(`${missingCount} missing`);
      if (variantCount) counts.push(`${variantCount} variantDrift`);
      if (styleCount) counts.push(`${styleCount} styleDrift`);
      const detail = counts.length > 0 ? ` (${counts.join(", ")})` : "";
      return `${d.pattern}${detail}`;
    });
}

/**
 * Read + validate the agent's per-screen findings JSON. Returns the
 * parsed review on success; on parse/validation failure, returns a
 * review with empty findings + an entry in errors describing the issue.
 */
function readAgentFindings(
  screenId: string,
  outputPath: string,
): PerceptualScreenReview {
  if (!existsSync(outputPath)) {
    return {
      screen: screenId,
      findings: [],
      errors: {
        "post-dispatch": "agent did not write the findings file",
      },
      costUsd: 0,
    };
  }
  try {
    const raw = JSON.parse(readFileSync(outputPath, "utf8")) as unknown;
    // The agent's JSON includes `screen`, `findings`, `errors`. Validate the
    // findings + errors fields against the contract; allow the screen field
    // to be either present + correct OR missing (we know which screen this is).
    if (typeof raw !== "object" || raw === null) {
      throw new Error("findings JSON is not an object");
    }
    const obj = raw as Record<string, unknown>;
    const validated = PerceptualScreenReviewSchema.safeParse({
      screen: screenId,
      findings: Array.isArray(obj.findings) ? obj.findings : [],
      errors:
        typeof obj.errors === "object" && obj.errors !== null ? obj.errors : {},
      costUsd: 0,
    });
    if (!validated.success) {
      return {
        screen: screenId,
        findings: [],
        errors: {
          "schema-validation": validated.error.issues[0]?.message ?? "invalid",
        },
        costUsd: 0,
      };
    }
    return validated.data;
  } catch (err) {
    return {
      screen: screenId,
      findings: [],
      errors: { "parse-error": (err as Error).message },
      costUsd: 0,
    };
  }
}

/**
 * Main entry point. Runs perceptual review against the project's screens,
 * applying cascade-skip rules per upstream-tier signal, dispatching the
 * perceptual-reviewer agent per remaining screen, and aggregating results.
 */
export async function runPerceptualReview(
  ctx: PerceptualReviewContext,
): Promise<PerceptualReviewOutput> {
  const start = Date.now();
  const warnings: string[] = [];
  const reviews: PerceptualScreenReview[] = [];
  let totalCost = 0;
  let screensReviewed = 0;
  let screensSkipped = 0;

  // Ensure output dir exists upfront so the agent's Write succeeds.
  const outputDir = join(ctx.projectDir, "docs", "build-to-spec", "perceptual");
  try {
    mkdirSync(outputDir, { recursive: true });
  } catch (err) {
    warnings.push(
      `perceptual: failed to mkdir output dir ${outputDir}: ${(err as Error).message}`,
    );
  }

  for (const screenId of ctx.screenIds) {
    const skip = resolveSkipReason(
      screenId,
      ctx.projectDir,
      ctx.parity,
      ctx.flowFailures,
    );
    if (skip) {
      reviews.push({
        screen: screenId,
        findings: [],
        errors: {},
        costUsd: 0,
        skippedReason: skip,
      });
      screensSkipped += 1;
      continue;
    }

    const taskId = `perceptual-${screenId}`;
    const outputPath = join(outputDir, `${screenId}.json`);
    const parityFindings = formatParityFindingsForScreen(screenId, ctx.parity);
    const preLoadedContext = buildPerceptualPreload({
      screenId,
      projectDir: ctx.projectDir,
      outputPath,
      taskId,
      parityFindings,
    });

    // Synthetic task — invoke-agent's tasks[] is typed as Task[] but the
    // runtime only reads id + agent for outcome tracking. Cast via unknown
    // is safe; perceptual-reviewer isn't in TaskAgent (verifier-side only).
    const syntheticTask = {
      id: taskId,
      agent: PERCEPTUAL_AGENT,
      depends_on: [],
      skills: [],
      status: "pending" as const,
      screens: [],
    };

    try {
      const result = await ctx.invokeAgent({
        agent: PERCEPTUAL_AGENT,
        cwd: ctx.projectDir,
        featureContext: {
          id: `perceptual-${screenId}`,
          branch: "perceptual-review",
          priority: "P1",
        },
        tasks: [
          syntheticTask as unknown as Parameters<InvokeAgentFn>[0]["tasks"][number],
        ],
        preLoadedContext,
      });

      totalCost += result.costUsd;

      const taskOutcome = result.taskStatus[taskId];
      if (taskOutcome !== "completed") {
        const errMsg = result.errors[taskId] ?? "agent did not return success";
        warnings.push(
          `perceptual: agent failed for screen ${screenId}: ${errMsg}`,
        );
        reviews.push({
          screen: screenId,
          findings: [],
          errors: { dispatch: errMsg },
          costUsd: result.costUsd,
        });
        screensReviewed += 1;
        continue;
      }

      // Agent returned completed → read the structured output it wrote.
      const review = readAgentFindings(screenId, outputPath);
      review.costUsd = result.costUsd;
      reviews.push(review);
      screensReviewed += 1;
    } catch (err) {
      warnings.push(
        `perceptual: invokeAgent threw for screen ${screenId}: ${(err as Error).message}`,
      );
      reviews.push({
        screen: screenId,
        findings: [],
        errors: { dispatch: (err as Error).message },
        costUsd: 0,
      });
      screensReviewed += 1;
    }
  }

  const ok = reviews.every(
    (r) => r.findings.length === 0 && Object.keys(r.errors).length === 0,
  );

  return {
    ok,
    screensReviewed,
    screensSkipped,
    reviews,
    warnings,
    durationMs: Date.now() - start,
    costUsd: totalCost,
  };
}

/**
 * Flatten per-screen findings into one-bug-per-finding violations for
 * build-to-spec-verify to file via fileBugPlan. Each violation maps 1:1
 * to a `perceptual-divergence` bug plan + bugs.yaml entry.
 */
export function perceptualReviewToViolations(output: PerceptualReviewOutput): {
  screen: string;
  element: string;
  mockupValue: string;
  actualValue: string;
  severity: PerceptualFinding["severity"];
}[] {
  const out: ReturnType<typeof perceptualReviewToViolations> = [];
  for (const review of output.reviews) {
    for (const finding of review.findings) {
      out.push({
        screen: review.screen,
        element: finding.element,
        mockupValue: finding.mockupValue,
        actualValue: finding.actualValue,
        severity: finding.severity,
      });
    }
  }
  return out;
}
