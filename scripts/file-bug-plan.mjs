#!/usr/bin/env node
// scripts/file-bug-plan.mjs — feat-022 Phase 4 helper.
//
// Auto-files a bug plan under `plans/active/bug-NNN-{slug}.md` from a
// `BuildToSpecVerifyOutput`-style violation. The orchestrator's
// `runBuildToSpecVerify()` post-Mode-B step calls this once per violation;
// the next builder retry consumes the resulting plan as `retryContext`.
//
// Two violation kinds:
//   1. orphan-component → bug-NNN-orphan-{ComponentName}.md
//   2. flow-failure     → bug-NNN-flow-{flowId}-{slug}.md
//
// We consolidate when an orphan-component AND a flow-failure share an
// owning feature: the plan body lists both under "Likely cause" — saves
// a builder round-trip.
//
// Usage (programmatic):
//   import { fileBugPlan } from "./file-bug-plan.mjs";
//   const planId = await fileBugPlan({ projectDir, violation });
//
// Usage (CLI):
//   echo '{...violation...}' | node scripts/file-bug-plan.mjs <projectDir>

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

/**
 * @typedef OrphanViolation
 * @property {"orphan-component"|"orphan-route"} kind
 * @property {string} path
 * @property {string|null} owningFeature
 * @property {string[]} suggestedImporters
 * @property {string[]} [exportNames]
 * @property {string} [routePattern]
 * @property {string[]} [suggestedNavSurfaces]
 * @property {string} reason
 */

/**
 * @typedef FlowFailureViolation
 * @property {"flow-failure"} kind
 * @property {string} flowId
 * @property {string} flowName
 * @property {number} step
 * @property {string} fromScreenId
 * @property {string} expectedScreenId
 * @property {string|null} actualScreenId
 * @property {string|null} selector
 * @property {string|null} screenshotPath
 * @property {string|null} htmlDumpPath
 * @property {string} message
 */

/** @typedef {OrphanViolation | FlowFailureViolation} Violation */

function nextBugSeq(plansDir) {
  // Walks plans/{active,archive}/ for any `bug-NNN-` plan and returns
  // max+1 (zero-padded to 3 digits). Idempotent — same call twice with
  // no other writes returns the same id.
  let max = 0;
  for (const sub of ["active", "archive"]) {
    const dir = path.join(plansDir, sub);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      const m = entry.match(/^bug-(\d{1,4})-/);
      if (m) max = Math.max(max, Number.parseInt(m[1], 10));
    }
  }
  return String(max + 1).padStart(3, "0");
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function bugIdFor(violation, seq) {
  if (violation.kind === "flow-failure") {
    return `bug-${seq}-flow-${slugify(violation.flowId)}-${slugify(violation.expectedScreenId)}`;
  }
  if (violation.kind === "orphan-component") {
    const name =
      violation.exportNames?.[0] ??
      path.basename(violation.path, path.extname(violation.path));
    return `bug-${seq}-orphan-${slugify(name)}`;
  }
  // orphan-route
  return `bug-${seq}-orphan-route-${slugify(violation.routePattern ?? violation.path)}`;
}

function flowFailureBody(v, opts) {
  const owner =
    opts.relatedOwner ?? "(unknown — no docs/tasks.yaml affects_files match)";
  const importers = (opts.relatedImporters ?? []).slice(0, 3);
  // feat-025: prefer the runner-populated `screenshot` / `html` aliases,
  // fall back to the v1 `*Path` fields.
  const screenshotPath = v.screenshot ?? v.screenshotPath ?? null;
  const htmlPath = v.html ?? v.htmlDumpPath ?? null;
  const TRANSITION_TIMEOUT_MS = 2000;
  const lines = [
    "## Description",
    "",
    `Synthesized flow \`${v.flowName}\` (${v.flowId}) failed at step ${v.step}: clicked \`${v.selector ?? "(no selector matched)"}\` on \`[data-screen-id="${v.fromScreenId}"]\`, expected to land on \`[data-screen-id="${v.expectedScreenId}"]\` within ${TRANSITION_TIMEOUT_MS}ms; landed on \`${v.actualScreenId ?? "(no screen-id present)"}\`.`,
    "",
    `**Synthesizer message:** ${v.message}`,
    "",
  ];
  if (screenshotPath) {
    lines.push("### Screenshot");
    lines.push("");
    lines.push(`![flow-${v.flowId}-step-${v.step} failure](${screenshotPath})`);
    lines.push("");
  }
  if (htmlPath) {
    lines.push("### Page HTML at failure");
    lines.push("");
    lines.push(`See \`${htmlPath}\``);
    lines.push("");
  }
  lines.push("## Likely cause");
  lines.push("");
  if (opts.relatedOrphan) {
    const orphanName =
      opts.relatedOrphan.exportNames?.[0] ??
      path.basename(
        opts.relatedOrphan.path,
        path.extname(opts.relatedOrphan.path),
      );
    lines.push(
      `- **Orphan component (correlated):** \`${orphanName}\` (\`${opts.relatedOrphan.path}\`) is exported but never imported in production.`,
    );
    lines.push(`- **Owning feature:** \`${owner}\``);
    if (importers.length > 0) {
      lines.push("- **Suggested integration points:**");
      for (const i of importers) lines.push(`  - \`${i}\``);
    }
  } else {
    lines.push(
      `- The trigger element on \`${v.fromScreenId}\` either does not exist OR navigates to a different screen than \`${v.expectedScreenId}\`.`,
    );
    lines.push(`- **Owning feature:** \`${owner}\``);
  }
  lines.push("");
  lines.push("## Failure context");
  lines.push("");
  if (screenshotPath) lines.push(`- Screenshot: \`${screenshotPath}\``);
  if (htmlPath) lines.push(`- HTML dump: \`${htmlPath}\``);
  lines.push(
    `- Synthesized spec: \`apps/web/e2e/synthesized/${v.flowId.replace(/^flow-/, "flow-")}.spec.ts\``,
  );
  lines.push("");
  lines.push("## Fix approach");
  lines.push("");
  if (opts.relatedOrphan && importers.length > 0) {
    const orphanName =
      opts.relatedOrphan.exportNames?.[0] ??
      path.basename(
        opts.relatedOrphan.path,
        path.extname(opts.relatedOrphan.path),
      );
    lines.push(
      `Wire \`${orphanName}\` into \`${importers[0]}\`; pass the expected props from parent state. See screen mockup at \`docs/screens/${v.fromScreenId.startsWith("/") ? "" : "webapp/"}${v.expectedScreenId}.html\` for layout reference.`,
    );
  } else {
    lines.push(
      `Add the missing nav element on \`${v.fromScreenId}\` so it routes to \`${v.expectedScreenId}\` when clicked. Reference the mockup at \`docs/screens/webapp/${v.expectedScreenId}.html\`.`,
    );
  }
  lines.push("");
  lines.push("## Retry routing (feat-025 Phase 4)");
  lines.push("");
  lines.push(
    "Orchestrator dispatches `web-frontend-builder` (or stack-appropriate front-end builder) for retry. Per-task retry: max 3 attempts; escalation to human at 5 — same retry ladder as the tester's `genuineProductBugs[]`.",
  );
  lines.push("");
  lines.push("## Validation");
  lines.push("");
  lines.push(
    `Re-run \`/build-to-spec-verify\`; \`${v.flowId}\` must pass${opts.relatedOrphan ? ` + reachability for \`${opts.relatedOrphan.exportNames?.[0] ?? "the wired component"}\` must clear` : ""}.`,
  );
  return lines.join("\n");
}

function orphanComponentBody(v) {
  const name =
    v.exportNames?.[0] ?? path.basename(v.path, path.extname(v.path));
  const lines = [
    "## Description",
    "",
    `Component \`${name}\` (\`${v.path}\`) exports \`${(v.exportNames ?? []).join(", ") || "(default)"}\` but no production code imports it. ${v.reason}`,
    "",
    "## Likely cause",
    "",
    `- The component was implemented + tested but never wired into a parent. **Owning feature:** \`${v.owningFeature ?? "(unknown)"}\``,
    "",
    "## Suggested integration points",
    "",
  ];
  for (const i of (v.suggestedImporters ?? []).slice(0, 5)) {
    lines.push(`- \`${i}\``);
  }
  if (!v.suggestedImporters || v.suggestedImporters.length === 0) {
    lines.push("- (no heuristic match — manual review required)");
  }
  lines.push("");
  lines.push("## Fix approach");
  lines.push("");
  lines.push(
    `Import \`${name}\` into the most appropriate parent above and render it where the screen mockup expects. If the component is intentionally unused (e.g., behind a future-feature flag), add \`// reachability-allow: <reason>\` at the top of \`${v.path}\` to suppress the orphan check.`,
  );
  lines.push("");
  lines.push("## Validation");
  lines.push("");
  lines.push(
    "Re-run `/build-to-spec-verify`; orphan list must clear for this component.",
  );
  return lines.join("\n");
}

function orphanRouteBody(v) {
  const lines = [
    "## Description",
    "",
    `Route \`${v.routePattern ?? v.path}\` is implemented at \`${v.path}\` but no production code references it. ${v.reason}`,
    "",
    "## Likely cause",
    "",
    `- The route exists but no nav surface (sidebar, header, footer link) exposes it. **Owning feature:** \`${v.owningFeature ?? "(unknown)"}\``,
    "",
    "## Suggested nav surfaces",
    "",
  ];
  for (const s of (v.suggestedNavSurfaces ?? []).slice(0, 5)) {
    lines.push(`- \`${s}\``);
  }
  if (!v.suggestedNavSurfaces || v.suggestedNavSurfaces.length === 0) {
    lines.push("- (no heuristic match — manual review required)");
  }
  lines.push("");
  lines.push("## Fix approach");
  lines.push("");
  lines.push(
    `Add a \`<Link href="${v.routePattern}">\` (or equivalent) to one of the suggested nav surfaces.`,
  );
  lines.push("");
  lines.push("## Validation");
  lines.push("");
  lines.push(
    "Re-run `/build-to-spec-verify`; orphan-routes list must clear for this route.",
  );
  return lines.join("\n");
}

// ─── feat-026 Phase A: bugs.yaml writer ───────────────────────────────────
//
// In addition to writing the standalone bug-NNN-*.md plan, the verifier
// channel ALSO appends a structured entry to `docs/bugs.yaml` so the
// orchestrator's `runFixBugsLoop` can iterate over verifier-discovered
// bugs WITHOUT re-parsing markdown plans. The plan file still exists +
// stays the human-facing artefact; bugs.yaml is the machine-facing one.
//
// `/plan-bug` (user-only channel) is UNCHANGED + does NOT append here —
// the two channels never overlap by design.

/**
 * @param {Violation} violation
 * @returns {"reachability-orphan"|"flow-execution-failure"}
 */
function bugSourceFor(violation) {
  if (violation.kind === "flow-failure") return "flow-execution-failure";
  return "reachability-orphan"; // both orphan-component + orphan-route
}

/**
 * Bug-id grammar enforced by `BugEntrySchema` in
 * packages/orchestrator-contracts/src/bugs-yaml.ts is
 * `bug-(flow|orphan|coverage)-<slug>`. The plan-file id from `bugIdFor`
 * has the form `bug-NNN-<kind>-<slug>` (NNN is the sequential counter).
 * For the bugs.yaml entry we strip the NNN prefix so the shorter id
 * matches the schema regex.
 */
function shortBugIdFor(planId) {
  return planId.replace(/^bug-\d+-/, "bug-");
}

function defaultAgentSequence(violation) {
  // Per plan §Phase A: orphan/flow → web-frontend-builder, tester, reviewer.
  // (Future: pm-coverage-omission → [pm, ...] — not emitted by file-bug-plan
  // today; coverage gate fails earlier in Mode A.)
  void violation;
  return ["web-frontend-builder", "tester", "reviewer"];
}

function deriveAffectsFiles(violation, relatedOrphan) {
  /** @type {string[]} */
  const out = [];
  if (violation.kind === "orphan-component") {
    out.push(violation.path);
    for (const i of (violation.suggestedImporters ?? []).slice(0, 3))
      out.push(i);
  } else if (violation.kind === "orphan-route") {
    out.push(violation.path);
  } else {
    if (relatedOrphan?.path) out.push(relatedOrphan.path);
    for (const i of (relatedOrphan?.suggestedImporters ?? []).slice(0, 3)) {
      out.push(i);
    }
  }
  // Dedup, preserve order.
  return [...new Set(out)];
}

function buildBugEntry({
  planId,
  planPath,
  violation,
  relatedOrphan,
  iteration,
}) {
  const id = shortBugIdFor(planId);
  const source = bugSourceFor(violation);
  const owningFeature =
    violation.kind === "flow-failure"
      ? (relatedOrphan?.owningFeature ?? null)
      : (violation.owningFeature ?? null);

  /** @type {Record<string, any>} */
  const entry = {
    id,
    iteration,
    source,
    severity: "P0",
    summary: summaryFor(violation),
    correlatedOrphanPath: relatedOrphan?.path ?? null,
    owningFeature,
    affectsFiles: deriveAffectsFiles(violation, relatedOrphan),
    agentSequence: defaultAgentSequence(violation),
    status: "pending",
    attempts: 0,
    maxAttempts: 3,
    flapResets: 0,
    resolvedInIteration: null,
    bugPlanPath: path
      .relative(path.dirname(path.dirname(planPath)), planPath)
      .replace(/\\/g, "/")
      .replace(/^\.\.\//, ""),
    errorLog: [],
  };

  if (violation.kind === "flow-failure") {
    entry.flow = {
      id: violation.flowId,
      name: violation.flowName,
      failedStep: violation.step,
      expectedScreenId: violation.expectedScreenId,
      actualScreenId: violation.actualScreenId ?? null,
      selector: violation.selector ?? null,
      screenshot: violation.screenshot ?? violation.screenshotPath ?? null,
      htmlDump: violation.html ?? violation.htmlDumpPath ?? null,
    };
  } else if (violation.kind === "orphan-component") {
    entry.orphan = {
      componentPath: violation.path,
      exportNames: violation.exportNames ?? [],
      suggestedImporters: violation.suggestedImporters ?? [],
    };
  } else {
    // orphan-route — still represent under `orphan` slot for downstream agents
    entry.orphan = {
      componentPath: violation.path,
      exportNames: [],
      suggestedImporters: violation.suggestedNavSurfaces ?? [],
    };
  }
  return entry;
}

function summaryFor(violation) {
  if (violation.kind === "flow-failure") {
    const expected = violation.expectedScreenId;
    const actual = violation.actualScreenId ?? "(no screen-id)";
    return `Flow ${violation.flowId} (${violation.flowName}) failed at step ${violation.step}: expected ${expected}, landed on ${actual}`.slice(
      0,
      200,
    );
  }
  if (violation.kind === "orphan-component") {
    const name =
      violation.exportNames?.[0] ??
      path.basename(violation.path, path.extname(violation.path));
    return `${name} (${violation.path}) exported but never imported in production`.slice(
      0,
      200,
    );
  }
  return `Route ${violation.routePattern ?? violation.path} not referenced by any nav surface`.slice(
    0,
    200,
  );
}

/**
 * Append (or merge by id) a bug entry into `docs/bugs.yaml`. Idempotent:
 * if the same id already exists, the entry is left in place (the
 * orchestrator owns mutations to attempts / status / errorLog beyond
 * initial filing).
 *
 * Returns the entry id. Caller is the verifier (single-process); we
 * don't take a filesystem lock — the verifier emits violations
 * sequentially in `runBuildToSpecVerify`.
 *
 * @param {{
 *   projectDir: string,
 *   entry: Record<string, unknown>,
 *   pipelineRunId?: string,
 *   iteration?: number,
 * }} args
 */
export function appendBugToYaml({
  projectDir,
  entry,
  pipelineRunId,
  iteration,
}) {
  const bugsYamlPath = path.join(projectDir, "docs", "bugs.yaml");
  fs.mkdirSync(path.dirname(bugsYamlPath), { recursive: true });

  /** @type {{
   *   version: string,
   *   generated_at: string,
   *   project_name: string,
   *   source_run_id: string,
   *   iteration: number,
   *   iteration_cap: number,
   *   bugs: Array<Record<string, unknown>>,
   * }} */
  let doc;
  if (fs.existsSync(bugsYamlPath)) {
    try {
      const raw = yaml.load(fs.readFileSync(bugsYamlPath, "utf8"));
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        doc = /** @type {any} */ (raw);
      } else {
        doc = freshDoc({ projectDir, pipelineRunId, iteration });
      }
    } catch {
      doc = freshDoc({ projectDir, pipelineRunId, iteration });
    }
  } else {
    doc = freshDoc({ projectDir, pipelineRunId, iteration });
  }
  if (!Array.isArray(doc.bugs)) doc.bugs = [];

  // Idempotent — skip when an entry with this id already exists.
  if (!doc.bugs.some((b) => b && b.id === entry.id)) {
    doc.bugs.push(entry);
    doc.generated_at = new Date().toISOString();
  }

  fs.writeFileSync(bugsYamlPath, yaml.dump(doc, { lineWidth: 120 }));
  return /** @type {string} */ (entry.id);
}

function freshDoc({ projectDir, pipelineRunId, iteration }) {
  return {
    version: "1.0",
    generated_at: new Date().toISOString(),
    project_name: path.basename(path.resolve(projectDir)),
    source_run_id: pipelineRunId ?? "unknown",
    iteration: iteration ?? 1,
    iteration_cap: 5,
    bugs: [],
  };
}

/**
 * @param {{projectDir: string, violation: Violation, relatedOrphan?: OrphanViolation, pipelineRunId?: string, iteration?: number, appendToYaml?: boolean}} args
 * @returns {Promise<{planId: string, planPath: string, bugYamlId?: string}>}
 */
export async function fileBugPlan({
  projectDir,
  violation,
  relatedOrphan,
  pipelineRunId,
  iteration,
  appendToYaml,
}) {
  const plansDir = path.join(projectDir, "plans");
  fs.mkdirSync(path.join(plansDir, "active"), { recursive: true });
  const seq = nextBugSeq(plansDir);
  const planId = bugIdFor(violation, seq);
  const planPath = path.join(plansDir, "active", `${planId}.md`);

  const today = new Date().toISOString().slice(0, 10);
  let body;
  if (violation.kind === "flow-failure") {
    body = flowFailureBody(violation, {
      relatedOrphan,
      relatedOwner: relatedOrphan?.owningFeature ?? null,
      relatedImporters: relatedOrphan?.suggestedImporters ?? [],
    });
  } else if (violation.kind === "orphan-component") {
    body = orphanComponentBody(violation);
  } else {
    body = orphanRouteBody(violation);
  }

  const affected = [];
  if (violation.kind === "flow-failure") {
    if (relatedOrphan?.path) affected.push(relatedOrphan.path);
    if (relatedOrphan?.suggestedImporters?.[0])
      affected.push(relatedOrphan.suggestedImporters[0]);
  } else if (violation.kind === "orphan-component") {
    affected.push(violation.path);
    if (violation.suggestedImporters?.[0])
      affected.push(violation.suggestedImporters[0]);
  } else {
    affected.push(violation.path);
  }

  const owningFeature =
    violation.kind === "flow-failure"
      ? (relatedOrphan?.owningFeature ?? null)
      : violation.owningFeature;

  const branch =
    violation.kind === "flow-failure" ? `fix/${planId}` : `fix/${planId}`;

  const frontmatter = [
    "---",
    `id: ${planId}`,
    "type: bug",
    "status: draft",
    "author-agent: build-to-spec-verify",
    `created: ${today}`,
    `updated: ${today}`,
    "parent-plan: feat-022-build-to-spec-verification",
    "supersedes: null",
    "superseded-by: null",
    `branch: ${branch}`,
    `affected-files:`,
    ...affected.map((f) => `  - ${f}`),
    `owning-feature: ${owningFeature ?? "null"}`,
    `feature-area: orchestration`,
    `priority: P1`,
    `attempt-count: 0`,
    `max-attempts: 3`,
    "---",
    "",
    `# ${planId} — auto-filed by /build-to-spec-verify`,
    "",
  ].join("\n");

  fs.writeFileSync(planPath, frontmatter + body + "\n");

  // ─── feat-026 Phase A: append to docs/bugs.yaml (verifier channel) ────────
  // Default-on so the orchestrator's `runFixBugsLoop` finds the new bug
  // immediately. Callers that explicitly pass `appendToYaml: false` (e.g.
  // a future preview/dry-run mode) skip the append. NOTE: the standalone
  // bug-NNN-*.md plan is ALWAYS written above — bugs.yaml is the
  // additional machine-facing artefact, not a replacement.
  let bugYamlId;
  if (appendToYaml !== false) {
    const entry = buildBugEntry({
      planId,
      planPath,
      violation,
      relatedOrphan,
      iteration: iteration ?? 1,
    });
    try {
      bugYamlId = appendBugToYaml({
        projectDir,
        entry,
        pipelineRunId,
        iteration: iteration ?? 1,
      });
    } catch (err) {
      // Don't let a bugs.yaml write failure break the verifier — the
      // standalone plan file still gives the operator a fix path.
      // eslint-disable-next-line no-console
      console.warn(
        `[fileBugPlan] failed to append ${planId} to docs/bugs.yaml: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return bugYamlId !== undefined
    ? { planId, planPath, bugYamlId }
    : { planId, planPath };
}

// CLI mode
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  const projectDir = path.resolve(process.argv[2] ?? process.cwd());
  let buf = "";
  process.stdin.on("data", (chunk) => (buf += chunk));
  process.stdin.on("end", async () => {
    try {
      const violation = JSON.parse(buf);
      const result = await fileBugPlan({ projectDir, violation });
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error(`fileBugPlan failed: ${err.message}`);
      process.exit(1);
    }
  });
}
