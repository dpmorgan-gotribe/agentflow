import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { BudgetTracker } from "./budget-tracker.js";
import { RetryCounters, type RetryCountersSnapshot } from "./retry-counters.js";

/**
 * Serialized pipeline-run state on disk. Persisted after every retry
 * increment + every budget record so a mid-run crash can be resumed via
 * `--resume-from-stage` without losing retry ledger or budget ledger.
 *
 * Location: `<projectRoot>/.claude/state/{pipelineRunId}/counters.json`
 */
export interface PipelineState {
  version: "1.0";
  pipelineRunId: string;
  lastUpdatedAt: string;
  retryCounters: RetryCountersSnapshot;
  budget: { cumulativeUsd: number };
}

const STATE_VERSION = "1.0" as const;

export function statePath(projectRoot: string, pipelineRunId: string): string {
  return join(projectRoot, ".claude", "state", pipelineRunId, "counters.json");
}

/**
 * Atomic-ish write: writes to a temp file in the same directory then
 * renames over the final path. Protects against torn writes on crash.
 * Creates parent directories as needed.
 */
export function saveState(
  projectRoot: string,
  pipelineRunId: string,
  retryCounters: RetryCounters,
  budget: BudgetTracker,
): void {
  const finalPath = statePath(projectRoot, pipelineRunId);
  mkdirSync(dirname(finalPath), { recursive: true });

  const state: PipelineState = {
    version: STATE_VERSION,
    pipelineRunId,
    lastUpdatedAt: new Date().toISOString(),
    retryCounters: retryCounters.toJSON(),
    budget: budget.toJSON(),
  };

  const tmpPath = `${finalPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmpPath, finalPath);
}

/**
 * Load the pipeline-run state if present. Mutates the provided
 * `retryCounters` + `budget` in place for crash recovery. Returns the
 * parsed state object, or null if no state file exists.
 */
export function loadState(
  projectRoot: string,
  pipelineRunId: string,
  retryCounters: RetryCounters,
  budget: BudgetTracker,
): PipelineState | null {
  const path = statePath(projectRoot, pipelineRunId);
  if (!existsSync(path)) return null;

  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError(
      `loadState: expected object at ${path}, got ${typeof parsed}`,
    );
  }
  const s = parsed as Partial<PipelineState>;
  if (s.version !== STATE_VERSION) {
    throw new Error(
      `loadState: version mismatch at ${path}; expected ${STATE_VERSION}, got ${String(s.version)}`,
    );
  }
  if (s.pipelineRunId !== pipelineRunId) {
    throw new Error(
      `loadState: pipelineRunId mismatch at ${path}; file has '${String(s.pipelineRunId)}', caller asked for '${pipelineRunId}'`,
    );
  }
  if (!s.retryCounters || !s.budget) {
    throw new Error(`loadState: missing retryCounters or budget at ${path}`);
  }

  const restoredSnapshot = RetryCounters.fromJSON(s.retryCounters).toJSON();
  retryCounters.restoreFromSnapshot(restoredSnapshot);
  budget.restoreCumulative(s.budget.cumulativeUsd);

  return {
    version: STATE_VERSION,
    pipelineRunId: s.pipelineRunId,
    lastUpdatedAt: s.lastUpdatedAt ?? new Date().toISOString(),
    retryCounters: restoredSnapshot,
    budget: s.budget,
  };
}
