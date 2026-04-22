import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BudgetTracker } from "./budget-tracker.js";
import {
  detectStageCompletions,
  firstIncompleteStage,
  skillExists,
  type StageCompletion,
} from "./project-state.js";
import { readBudgetCaps } from "./model-config.js";
import { STAGES, getStage } from "./stages-array.js";

export interface CliOptions {
  projectName?: string;
  flags: string;
  resumeFromStage?: string;
  resumeFeatureGraph?: boolean;
  dryRun?: boolean;
}

export interface CliResult {
  exitCode: number;
  messages: string[];
}

/**
 * Drive the orchestrator from CLI arguments. Returns structured data
 * rather than calling `process.exit` so tests can assert on it.
 *
 * MVP scope (Phase 9):
 *   - Project resolution from `projects/<name>/`
 *   - Stage-completion detection via project-state.ts
 *   - --dry-run mode: report the walk plan + flag first missing skill
 *   - No actual Agent SDK invocation yet (wire-up in follow-up plans
 *     feat-005 architect, feat-006 pm, etc., or via direct skill calls)
 */
export async function runCli(
  opts: CliOptions,
  factoryRoot: string,
): Promise<CliResult> {
  const messages: string[] = [];
  const projectRoot = resolveProjectRoot(opts.projectName, factoryRoot);
  if (!projectRoot) {
    messages.push("No project specified and no unambiguous default found.");
    messages.push("Available projects in projects/:");
    for (const name of listProjects(factoryRoot)) messages.push(`  - ${name}`);
    messages.push(
      "Usage: pnpm generate <project-name> [--flags=...] [--dry-run]",
    );
    return { exitCode: 2, messages };
  }

  messages.push(`Project: ${projectRoot}`);
  messages.push(`Factory: ${factoryRoot}`);

  const flags = opts.flags
    ? opts.flags
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean)
    : [];
  if (flags.length > 0) messages.push(`Flags: ${flags.join(", ")}`);

  const completions = detectStageCompletions(projectRoot);
  const completedNames = completions
    .filter((c) => c.complete)
    .map((c) => c.stage);
  const pendingNames = completions
    .filter((c) => !c.complete)
    .map((c) => c.stage);
  messages.push(
    `Completed stages (${completedNames.length}): ${completedNames.join(", ") || "(none)"}`,
  );
  messages.push(
    `Pending stages   (${pendingNames.length}): ${pendingNames.join(", ")}`,
  );

  const resumeStage = opts.resumeFromStage ?? firstIncompleteStage(completions);
  if (!resumeStage) {
    messages.push(
      "All Mode A stages complete. Mode B (feature-graph) would start here — not yet implemented in CLI.",
    );
    return { exitCode: 0, messages };
  }
  messages.push(`Resume from: ${resumeStage}`);

  if (opts.resumeFromStage && opts.resumeFromStage !== resumeStage) {
    // Explicit override — honor it but warn
    messages.push(
      `(warning: --resume-from-stage=${opts.resumeFromStage} does not match auto-detected ${resumeStage})`,
    );
  }

  const caps = readBudgetCaps(projectRoot);
  const budget = new BudgetTracker(caps);
  messages.push(
    `Budget cap: ${caps.perPipelineMaxUsd.toFixed(2)} USD per pipeline`,
  );

  if (opts.dryRun) {
    messages.push("");
    messages.push("--- DRY RUN ---");
    const walk = simulateWalk(factoryRoot, completions, resumeStage);
    for (const entry of walk.lines) messages.push(entry);
    if (walk.firstMissingSkill) {
      messages.push("");
      messages.push(
        `Pipeline would halt at stage '${walk.firstMissingSkill.stage}' because ` +
          `'${walk.firstMissingSkill.slashCommand}' resolves to skill '${walk.firstMissingSkill.skillName}' ` +
          `which does not exist at .claude/skills/${walk.firstMissingSkill.skillName}/SKILL.md.`,
      );
      messages.push(
        `See build-tier-roadmap.md for the plan that ships this skill (look for '${walk.firstMissingSkill.skillName}').`,
      );
    } else {
      messages.push("");
      messages.push(
        "All remaining stages have their skills registered. Real invocation would start here.",
      );
    }
    messages.push(
      `Cumulative spend: ${budget.getCumulative().toFixed(2)} USD (dry-run — nothing was invoked)`,
    );
    return { exitCode: 0, messages };
  }

  // Live run — not yet wired in Phase 9. Surface the expected behavior
  // rather than attempt a real SDK call that would need agents we don't
  // have yet.
  messages.push("");
  messages.push(
    "Live run is not yet wired. See task-035 Phase 9 + downstream feat-005, feat-006 plans.",
  );
  messages.push("Use --dry-run to inspect the pipeline walk.");
  return { exitCode: 1, messages };
}

function resolveProjectRoot(
  name: string | undefined,
  factoryRoot: string,
): string | null {
  const projectsDir = join(factoryRoot, "projects");
  if (!existsSync(projectsDir)) return null;
  if (name) {
    const candidate = join(projectsDir, name);
    return existsSync(candidate) ? candidate : null;
  }
  const names = listProjects(factoryRoot);
  if (names.length === 1) return join(projectsDir, names[0]!);
  return null;
}

function listProjects(factoryRoot: string): string[] {
  const projectsDir = join(factoryRoot, "projects");
  if (!existsSync(projectsDir)) return [];
  return readdirSync(projectsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

interface WalkLine {
  stage: string;
  status: string;
  skillExists: boolean;
}

interface WalkResult {
  lines: string[];
  firstMissingSkill?: {
    stage: string;
    slashCommand: string;
    skillName: string;
  };
}

function simulateWalk(
  factoryRoot: string,
  completions: readonly StageCompletion[],
  resumeStage: string,
): WalkResult {
  const lines: string[] = ["Stage walk:"];
  const completionByStage = new Map<string, StageCompletion>(
    completions.map((c) => [c.stage, c]),
  );
  let firstMissingSkill: WalkResult["firstMissingSkill"];
  let reached = false;

  for (const stage of STAGES) {
    const completion = completionByStage.get(stage.name);
    if (!reached && stage.name !== resumeStage) {
      if (completion?.complete) {
        lines.push(
          `  ✓ ${stage.name} — already complete (${completion.artifactPath})`,
        );
      } else {
        lines.push(`  · ${stage.name} — skipped (earlier than resume point)`);
      }
      continue;
    }
    reached = true;
    const skillName =
      stage.slashCommand.replace(/^\//, "").split(/\s+/)[0] ?? "";
    const present = skillExists(factoryRoot, stage.slashCommand);
    const gate = stage.gateEnabled ? ` [gate: ${stage.gateType}]` : "";
    if (present) {
      lines.push(
        `  → ${stage.name} — skill present at .claude/skills/${skillName}${gate}`,
      );
    } else {
      lines.push(
        `  ✗ ${stage.name} — skill MISSING (.claude/skills/${skillName}/SKILL.md)${gate}`,
      );
      if (!firstMissingSkill) {
        firstMissingSkill = {
          stage: stage.name,
          slashCommand: stage.slashCommand,
          skillName,
        };
      }
    }
  }

  const _walkLines: WalkLine[] = [];
  void _walkLines;
  const result: WalkResult = { lines };
  if (firstMissingSkill) result.firstMissingSkill = firstMissingSkill;
  return result;
}

// re-export for direct consumers
export { getStage };
