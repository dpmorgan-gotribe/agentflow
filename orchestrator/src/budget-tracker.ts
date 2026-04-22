import type { BudgetCaps } from "./model-config.js";

/**
 * Thrown when a projected cost would push cumulative spend past the
 * pipeline-wide cap. Orchestrator catches this at stage boundaries to
 * checkpoint context before aborting.
 */
export class BudgetExceededError extends Error {
  readonly cumulative: number;
  readonly projected: number;
  readonly cap: number;

  constructor(cumulative: number, projected: number, cap: number) {
    super(
      `Budget exceeded: cumulative ${cumulative.toFixed(4)} USD + projected ` +
        `${projected.toFixed(4)} USD = ${(cumulative + projected).toFixed(4)} USD ` +
        `> cap ${cap.toFixed(2)} USD (perPipelineMaxUsd).`,
    );
    this.name = "BudgetExceededError";
    this.cumulative = cumulative;
    this.projected = projected;
    this.cap = cap;
  }
}

/**
 * Pipeline-wide cost accumulator. Reads `perPipelineMaxUsd` from the
 * merged model config at construction; callers `assertUnderBudget()`
 * before firing a `query()` and `record()` after the call returns.
 *
 * Per-stage caps (`perStageMaxUsd`) are enforced by the stage-runner
 * separately — BudgetTracker holds the caps map but doesn't apply it
 * here. Single responsibility: cumulative pipeline spend.
 */
export class BudgetTracker {
  private cumulativeUsd = 0;
  private readonly caps: BudgetCaps;

  constructor(caps: BudgetCaps) {
    this.caps = caps;
  }

  /** Current cumulative spend in USD. */
  getCumulative(): number {
    return this.cumulativeUsd;
  }

  /** Pipeline-wide cap (read-only). */
  getPipelineCap(): number {
    return this.caps.perPipelineMaxUsd;
  }

  /** Per-stage cap for the given stage, or `undefined` if not configured. */
  getStageCap(stageName: string): number | undefined {
    return this.caps.perStageMaxUsd[stageName];
  }

  /**
   * Check whether the pipeline budget has already been exhausted. Returns
   * true when cumulative spend has reached (or exceeded) the cap.
   */
  exhausted(): boolean {
    return this.cumulativeUsd >= this.caps.perPipelineMaxUsd;
  }

  /**
   * Throw `BudgetExceededError` if adding `projectedUsd` would push
   * cumulative past `perPipelineMaxUsd`. Call this before firing a
   * `query()` when the stage has a cost estimate.
   */
  assertUnderBudget(projectedUsd: number): void {
    if (projectedUsd < 0) {
      throw new RangeError(
        `assertUnderBudget: projectedUsd must be ≥ 0, got ${projectedUsd}`,
      );
    }
    if (this.cumulativeUsd + projectedUsd > this.caps.perPipelineMaxUsd) {
      throw new BudgetExceededError(
        this.cumulativeUsd,
        projectedUsd,
        this.caps.perPipelineMaxUsd,
      );
    }
  }

  /**
   * Record actual cost of a completed `query()`. Negative values are
   * rejected; zero is allowed (dry-runs / cached responses).
   */
  record(costUsd: number): void {
    if (costUsd < 0) {
      throw new RangeError(`record: costUsd must be ≥ 0, got ${costUsd}`);
    }
    this.cumulativeUsd += costUsd;
  }

  /**
   * Serializable snapshot. Used by state-persistence (Phase 4) to survive
   * crashes. Cap values are static (come from YAML) — persistence only
   * needs cumulative.
   */
  toJSON(): { cumulativeUsd: number } {
    return { cumulativeUsd: this.cumulativeUsd };
  }

  /** Restore cumulative from a persisted snapshot. */
  restoreCumulative(cumulativeUsd: number): void {
    if (cumulativeUsd < 0) {
      throw new RangeError(
        `restoreCumulative: cumulativeUsd must be ≥ 0, got ${cumulativeUsd}`,
      );
    }
    this.cumulativeUsd = cumulativeUsd;
  }
}
