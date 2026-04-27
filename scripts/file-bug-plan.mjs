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

/**
 * @param {{projectDir: string, violation: Violation, relatedOrphan?: OrphanViolation}} args
 * @returns {Promise<{planId: string, planPath: string}>}
 */
export async function fileBugPlan({ projectDir, violation, relatedOrphan }) {
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
  return { planId, planPath };
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
