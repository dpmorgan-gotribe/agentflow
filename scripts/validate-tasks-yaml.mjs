#!/usr/bin/env node
/**
 * Validate a tasks.yaml v2 against schemas/tasks.schema.json +
 * schemas/feature.schema.json. Also enforces the 3 cross-field
 * invariants that JSON Schema can't express:
 *
 *   1. Every task.agent must be in its parent feature.agent_sequence
 *   2. feature.depends_on[] must not form a cycle (DFS)
 *   3. Every task.depends_on[] reference resolves within the SAME feature
 *
 * Usage:
 *   node scripts/validate-tasks-yaml.mjs <path/to/tasks.yaml>
 *
 * Exit code: 0 on success, 1 on validation or invariant error.
 *
 * Called from:
 *   - .claude/skills/pm/SKILL.md self-verify step (mode=tasks)
 *   - orchestrator Mode-B load-time validation (via TasksV2Schema in contracts)
 *   - future CI workflow step
 */

import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const factoryRoot = resolve(scriptDir, "..");
const schemasDir = join(factoryRoot, "schemas");

const input = process.argv[2];
if (!input) {
  console.error("Usage: node scripts/validate-tasks-yaml.mjs <path>");
  process.exit(1);
}

const tasksSchema = JSON.parse(
  readFileSync(join(schemasDir, "tasks.schema.json"), "utf8"),
);
const featureSchema = JSON.parse(
  readFileSync(join(schemasDir, "feature.schema.json"), "utf8"),
);

const raw = readFileSync(resolve(input), "utf8");
const parsed = yaml.load(raw);

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(featureSchema, "./feature.schema.json");
const validate = ajv.compile(tasksSchema);
const ok = validate(parsed);

if (!ok) {
  console.error(`Validation FAILED for ${input}:`);
  for (const err of validate.errors ?? []) {
    console.error(`  - ${err.instancePath || "<root>"}: ${err.message}`);
  }
  process.exit(1);
}

// Cross-field invariants
const invariantErrors = [];
const features = parsed.features ?? [];
const featureIds = new Set(features.map((f) => f.id));

for (const feature of features) {
  const agentSequence = new Set(feature.agent_sequence ?? []);
  const taskIds = new Set((feature.tasks ?? []).map((t) => t.id));

  // Invariant 1: task.agent ∈ feature.agent_sequence
  for (const task of feature.tasks ?? []) {
    if (!agentSequence.has(task.agent)) {
      invariantErrors.push(
        `feature ${feature.id}: task '${task.id}' agent '${task.agent}' is not in agent_sequence [${[...agentSequence].join(", ")}]`,
      );
    }
    // Invariant 3: task.depends_on entries resolve within same feature
    for (const dep of task.depends_on ?? []) {
      if (!taskIds.has(dep)) {
        invariantErrors.push(
          `feature ${feature.id}: task '${task.id}' depends on '${dep}' which is not a task within this feature (cross-feature deps belong at feature.depends_on)`,
        );
      }
    }
  }

  // feature.depends_on must reference known features
  for (const dep of feature.depends_on ?? []) {
    if (!featureIds.has(dep)) {
      invariantErrors.push(
        `feature ${feature.id}: depends_on references unknown feature '${dep}'`,
      );
    }
  }
}

// Invariant 2: feature.depends_on acyclic (DFS white/gray/black)
const WHITE = 0,
  GRAY = 1,
  BLACK = 2;
const color = new Map(features.map((f) => [f.id, WHITE]));
const graph = new Map(features.map((f) => [f.id, f.depends_on ?? []]));

function dfs(start) {
  const stack = [
    { id: start, iter: (graph.get(start) ?? [])[Symbol.iterator]() },
  ];
  color.set(start, GRAY);
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    const next = frame.iter.next();
    if (next.done) {
      color.set(frame.id, BLACK);
      stack.pop();
      continue;
    }
    const dep = next.value;
    if (color.get(dep) === GRAY) {
      invariantErrors.push(
        `feature.depends_on cycle detected — '${frame.id}' → '${dep}' closes the loop`,
      );
      return;
    }
    if (color.get(dep) === WHITE) {
      color.set(dep, GRAY);
      stack.push({ id: dep, iter: (graph.get(dep) ?? [])[Symbol.iterator]() });
    }
  }
}

for (const id of graph.keys()) {
  if (color.get(id) === WHITE) dfs(id);
}

if (invariantErrors.length > 0) {
  console.error(`Cross-field invariant errors for ${input}:`);
  for (const err of invariantErrors) console.error(`  - ${err}`);
  process.exit(1);
}

console.log(
  `OK — ${input} validates against schemas/tasks.schema.json + cross-field invariants`,
);
