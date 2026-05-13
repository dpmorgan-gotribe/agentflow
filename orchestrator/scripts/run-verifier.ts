// Operator driver to invoke runBuildToSpecVerify against a project end-to-end
// and write the output to docs/_tmp-verify-output.json for inspection. The
// canonical production path is `feature-graph.ts` (Mode B) or
// `fix-bugs-loop.ts` (the loop); this script is the standalone probe for
// running all 6 tiers (build-sanity / reachability / synth-flows / parity /
// perceptual / walkthrough) against a single project on demand.
//
// Usage: pnpm --filter orchestrator exec tsx scripts/run-verifier.ts <projectDir>
//
// Wires invokeAgent + BudgetTracker so Tier 4 (perceptual) + Tier 5
// (walkthrough) actually fire — without this plumbing they silently skip
// with "invokeAgent not provided" warnings.
//
// Empirically validated 2026-05-13 against reading-log-02: $1.50 + 15.6 min
// wall-clock for a 5-screen project (4 perceptual + 1 walkthrough dispatch).

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, existsSync } from "node:fs";
import { runBuildToSpecVerify } from "../src/build-to-spec-verify.js";
import { BudgetTracker } from "../src/budget-tracker.js";
import { createInvokeAgent } from "../src/invoke-agent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const projectDir = resolve(process.argv[2] ?? process.cwd());
if (!existsSync(projectDir)) {
  console.error(`projectDir not found: ${projectDir}`);
  process.exit(2);
}

const factoryRoot = resolve(__dirname, "../..");

async function main() {
  console.log(`Running verifier against ${projectDir}`);
  console.log(`Factory root: ${factoryRoot}`);
  const startedAt = Date.now();
  const pipelineRunId = `tmp-verify-${Date.now()}`;
  // Wire invokeAgent so Tier 4 (perceptual) + Tier 5 (walkthrough) can
  // dispatch their LLM agents. Without this the orchestrator skips both
  // with the "invokeAgent not provided" warning.
  const budget = new BudgetTracker({
    perPipelineMaxUsd: 10,
    perStageMaxUsd: {},
  });
  const invokeAgent = createInvokeAgent({
    projectRoot: projectDir,
    budget,
    flags: [],
    pipelineRunId,
  });
  const result = await runBuildToSpecVerify({
    projectDir,
    factoryRoot,
    autoFileBugPlans: true,
    pipelineRunId,
    iteration: 1,
    invokeAgent,
  });
  const elapsedMs = Date.now() - startedAt;

  const outPath = resolve(projectDir, "docs/_tmp-verify-output.json");
  writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");

  console.log(`\n=== verifier done in ${(elapsedMs / 1000).toFixed(1)}s ===`);
  console.log(`ok: ${result.ok}`);
  console.log(`warnings: ${result.warnings?.length ?? 0}`);
  console.log(
    `reachability orphans: ${result.reachability?.orphanComponents?.length ?? 0}`,
  );
  console.log(`flows passed: ${result.flows?.passed?.length ?? 0}`);
  console.log(`flows failed: ${result.flows?.failed?.length ?? 0}`);
  console.log(`bug plans filed: ${result.bugPlansFiled?.length ?? 0}`);
  console.log(`output written to: ${outPath}`);

  if (result.flows?.failed) {
    console.log(`\n=== flow failures by primaryCause ===`);
    const byCause = new Map<string, string[]>();
    for (const f of result.flows.failed) {
      const cause = f.primaryCause ?? "unknown";
      if (!byCause.has(cause)) byCause.set(cause, []);
      byCause.get(cause)!.push(f.flowId);
    }
    for (const [cause, ids] of byCause.entries()) {
      console.log(`  ${cause}: ${ids.join(", ")}`);
    }
  }
}

main().catch((err) => {
  console.error("verifier crashed:", err);
  process.exit(1);
});
