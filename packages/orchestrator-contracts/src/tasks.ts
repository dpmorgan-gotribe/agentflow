import { z } from "zod";

/**
 * tasks.yaml v2 (refactor-004): PM output for the feature-graph phase.
 *
 * Authoritative spec: scaffolding/09-034b-output-contract-zod-schemas.md
 * + schemas/tasks.schema.json + schemas/feature.schema.json.
 *
 * Cross-field invariants the orchestrator MUST enforce beyond Zod's
 * structural checks (documented here; implementation in
 * orchestrator/feature-graph.ts phase 7):
 *
 *   1. Every feature.tasks[].agent must be a member of the same
 *      feature.agent_sequence. Schema can't express this cleanly.
 *   2. Every feature.depends_on[] reference must resolve to another
 *      feature.id in the same TasksV2 document.
 *   3. feature.depends_on[] must not form a cycle (DFS at load).
 *   4. Every task.depends_on[] must resolve to another task.id within
 *      the SAME feature (cross-feature task deps expressed at
 *      feature.depends_on level).
 *   5. summary_counts (if present) should agree with computed counts;
 *      disagreement = warning, not hard fail.
 */

export const FeatureIdSchema = z.string().regex(/^feat-[a-z][a-z0-9-]{1,48}$/);

export const AgentSequenceMember = z.enum([
  "backend-builder",
  "web-frontend-builder",
  "mobile-frontend-builder",
  "tester",
  "reviewer",
  "git-agent",
  "security",
  "devops",
]);
export type AgentSequenceMember = z.infer<typeof AgentSequenceMember>;

export const TaskAgent = z.enum([
  "backend-builder",
  "web-frontend-builder",
  "mobile-frontend-builder",
  "tester",
  "reviewer",
  "security",
  "devops",
]); // excludes git-agent — lifecycle is orchestrator-owned, never a task agent
export type TaskAgent = z.infer<typeof TaskAgent>;

export const TaskSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,80}$/),
  agent: TaskAgent,
  depends_on: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
  integration_ref: z.string().optional(),
  status: z
    .enum(["pending", "in-progress", "completed", "blocked", "skipped"])
    .default("pending"),
  estimated_screens: z.number().int().nonnegative().optional(),
  summary: z.string().max(200).optional(),
  notes: z.string().optional(),
});
export type Task = z.infer<typeof TaskSchema>;

export const FeatureSchema = z.object({
  id: FeatureIdSchema,
  worktree: z.string().regex(/^feat-[a-z][a-z0-9-]{1,48}$/),
  branch: z.string().regex(/^feat\/[a-z][a-z0-9-]{1,48}$/),
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  depends_on: z.array(FeatureIdSchema).default([]),
  skip: z.array(z.enum(["web", "mobile", "backend"])).default([]),
  agent_sequence: z.array(AgentSequenceMember).min(1),
  tasks: z.array(TaskSchema).min(1),
  summary: z.string().max(200).optional(),
  brief_reference: z.string().optional(),
});
export type Feature = z.infer<typeof FeatureSchema>;

export const TasksV2Schema = z.object({
  version: z.literal("2.0"),
  generated_at: z.string().datetime().optional(),
  project_name: z.string().optional(),
  architecture_ref: z.string().optional(),
  ui_kit_version: z.string().optional(),
  features: z.array(FeatureSchema),
  summary_counts: z
    .object({
      total_features: z.number().int().nonnegative(),
      total_tasks: z.number().int().nonnegative(),
      by_agent: z.record(z.string(), z.number().int().nonnegative()),
      by_priority: z.object({
        P0: z.number().int().nonnegative(),
        P1: z.number().int().nonnegative(),
        P2: z.number().int().nonnegative(),
        P3: z.number().int().nonnegative(),
      }),
    })
    .optional(),
  warnings: z.array(z.string()).default([]),
});
export type TasksV2 = z.infer<typeof TasksV2Schema>;
