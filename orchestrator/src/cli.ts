#!/usr/bin/env node
import { Command } from "commander";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runCli } from "./cli-runner.js";

/**
 * Factory root is 2 levels up from this file: `orchestrator/src/cli.ts`
 * → `orchestrator/` → factory root. This lets `pnpm --filter orchestrator
 * start generate ...` resolve the factory root correctly even when
 * process.cwd() is the orchestrator package dir.
 */
const cliDir = dirname(fileURLToPath(import.meta.url));
const factoryRoot = resolve(cliDir, "..", "..");

const program = new Command();
program
  .name("agentflow")
  .description("Multi-agent app generation factory — two-mode orchestrator")
  .version("0.1.0");

program
  .command("generate")
  .argument(
    "[projectName]",
    "project directory under projects/ (omit if only one exists)",
  )
  .option(
    "--flags <csv>",
    "feature flags (comma-separated, e.g. 'nanobanana')",
    "",
  )
  .option(
    "--resume-from-stage <name>",
    "resume from a specific Mode A stage name",
  )
  .option("--resume-feature-graph", "resume Mode B after bootstrap")
  .option("--dry-run", "report the pipeline walk without invoking agents")
  .option(
    "--auto-merge-after-reviewer",
    "skip gate 6 (pr-review) — auto-merge once reviewer approves",
  )
  .option(
    "--max-concurrent <n>",
    "Mode B feature-graph concurrency cap (default: 4)",
    (v) => parseInt(v, 10),
  )
  .action(
    async (
      projectName: string | undefined,
      opts: {
        flags: string;
        resumeFromStage?: string;
        resumeFeatureGraph?: boolean;
        dryRun?: boolean;
        autoMergeAfterReviewer?: boolean;
        maxConcurrent?: number;
      },
    ) => {
      const optsForRunner: Parameters<typeof runCli>[0] = { flags: opts.flags };
      if (projectName) optsForRunner.projectName = projectName;
      if (opts.resumeFromStage)
        optsForRunner.resumeFromStage = opts.resumeFromStage;
      if (opts.resumeFeatureGraph)
        optsForRunner.resumeFeatureGraph = opts.resumeFeatureGraph;
      if (opts.dryRun) optsForRunner.dryRun = opts.dryRun;
      if (opts.autoMergeAfterReviewer)
        optsForRunner.autoMergeAfterReviewer = opts.autoMergeAfterReviewer;
      if (opts.maxConcurrent && opts.maxConcurrent > 0)
        optsForRunner.maxConcurrent = opts.maxConcurrent;
      const result = await runCli(optsForRunner, factoryRoot);
      for (const line of result.messages) {
        // eslint-disable-next-line no-console
        console.log(line);
      }
      process.exit(result.exitCode);
    },
  );

await program.parseAsync(process.argv);
