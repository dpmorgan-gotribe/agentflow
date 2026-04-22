import type { PipelineStage } from "@repo/orchestrator-contracts";
import { z } from "zod";

/**
 * Placeholder output schema — accepts any object with `success: boolean`
 * and optional warnings. Real per-stage schemas are authored by task 034b
 * (`StageSchemas[stageName]`); this stub lets runPipeline walk the array
 * end-to-end before those schemas land, and each stage swaps in its
 * concrete schema once 034b ships.
 */
const PlaceholderStageOutput = z
  .object({
    success: z.boolean(),
    warnings: z.array(z.string()).optional(),
  })
  .passthrough();

/**
 * Mode A stage array — refactor-003 + refactor-004 canonical order.
 * Every project walks these 12 stages in order (respecting dependsOn).
 * Mode B (feature-graph) kicks off AFTER `git-agent-bootstrap` completes.
 *
 * Scaffolding reference: scaffolding/21-035-orchestrator-core.md §STAGES.
 * Refactor-003 rationale: Appendix C. Refactor-004 rationale:
 * §Feature-graph phase.
 */
export const STAGES: readonly PipelineStage[] = [
  // ─── PLANNING PHASE ───
  {
    name: "analyze",
    slashCommand: "/analyze",
    outputSchema: PlaceholderStageOutput,
    gateEnabled: true,
    gateType: "requirements",
    budgetUsd: 5,
    agent: "analyst",
  },
  {
    name: "skills-audit-design",
    slashCommand: "/skills-audit --scope=design",
    outputSchema: PlaceholderStageOutput,
    gateEnabled: false,
    budgetUsd: 1,
    agent: "skills-agent",
    dependsOn: ["analyze"],
  },
  // ─── DESIGN PHASE ───
  {
    name: "mockups",
    slashCommand: "/mockups",
    outputSchema: PlaceholderStageOutput,
    gateEnabled: true,
    gateType: "mockups",
    budgetUsd: 10,
    agent: "ui-designer",
    dependsOn: ["skills-audit-design"],
  },
  {
    name: "stylesheet",
    slashCommand: "/stylesheet",
    outputSchema: PlaceholderStageOutput,
    gateEnabled: true,
    gateType: "design-system",
    budgetUsd: 2,
    agent: "ui-designer",
    dependsOn: ["mockups"],
  },
  {
    name: "screens",
    slashCommand: "/screens",
    outputSchema: PlaceholderStageOutput,
    gateEnabled: false,
    budgetUsd: 25,
    agent: "ui-designer",
    dependsOn: ["stylesheet"],
  },
  {
    name: "visual-review",
    slashCommand: "/visual-review",
    outputSchema: PlaceholderStageOutput,
    gateEnabled: false,
    budgetUsd: 2,
    agent: "ui-designer",
    dependsOn: ["screens"],
  },
  {
    name: "user-flows",
    slashCommand: "/user-flows-generator",
    outputSchema: PlaceholderStageOutput,
    gateEnabled: true,
    gateType: "signoff",
    budgetUsd: 1,
    agent: "ui-designer",
    dependsOn: ["visual-review"],
  },
  // ─── POST-DESIGN PLANNING (refactor-003) ───
  {
    name: "architect",
    slashCommand: "/architect",
    outputSchema: PlaceholderStageOutput,
    gateEnabled: true,
    gateType: "credentials",
    budgetUsd: 3,
    agent: "architect",
    dependsOn: ["user-flows"],
  },
  {
    name: "pm",
    slashCommand: "/pm --mode=tasks",
    outputSchema: PlaceholderStageOutput,
    gateEnabled: false,
    budgetUsd: 2,
    agent: "project-manager",
    dependsOn: ["architect"],
  },
  {
    name: "skills-audit-build",
    slashCommand: "/skills-audit --scope=build",
    outputSchema: PlaceholderStageOutput,
    gateEnabled: false,
    budgetUsd: 1,
    agent: "skills-agent",
    dependsOn: ["pm"],
  },
  {
    name: "register-mcp-build",
    slashCommand: "/register-mcp-servers --scope=build",
    outputSchema: PlaceholderStageOutput,
    gateEnabled: false,
    budgetUsd: 0.5,
    agent: "skills-agent",
    dependsOn: ["skills-audit-build"],
  },
  // ─── FEATURE-GRAPH BOOTSTRAP (refactor-004) ───
  {
    name: "git-agent-bootstrap",
    slashCommand: "/git-agent bootstrap",
    outputSchema: PlaceholderStageOutput,
    gateEnabled: false,
    budgetUsd: 0.5,
    agent: "git-agent",
    dependsOn: ["register-mcp-build"],
  },
];

/** Look up a stage by name. */
export function getStage(name: string): PipelineStage | undefined {
  return STAGES.find((s) => s.name === name);
}
