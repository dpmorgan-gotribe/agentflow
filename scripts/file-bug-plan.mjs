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

// bug-053 (2026-05-05): the seq-INDEPENDENT slug suffix that uniquely
// identifies a violation. Two violations with the same stable slug are
// the same logical bug (same screen+pattern, same flow+expected-screen,
// etc.) and should NOT each get a fresh plan-file. Empirical: finance-
// track-01 had 463 plan files for 54 unique bugs.yaml entries
// (~9× duplication across 9 verifier reruns) before this dedup landed.
function stableSlugFor(violation) {
  if (violation.kind === "flow-failure") {
    return `flow-${slugify(violation.flowId)}-${slugify(violation.expectedScreenId)}`;
  }
  // ── feat-027: runtime-error / dev-server-compile slug suffixes ───────────
  // The bugs.yaml id grammar allows `runtime` / `compile` prefixes per
  // packages/orchestrator-contracts/src/bugs-yaml.ts. We use the flow-id as
  // the slug since these failures are anchored to the spec that surfaced
  // them — even though the underlying defect is project-wide (cascade root).
  if (violation.kind === "runtime-error") {
    return `runtime-${slugify(violation.flowId)}`;
  }
  if (violation.kind === "dev-server-compile") {
    return `compile-${slugify(violation.flowId)}`;
  }
  // ── feat-028: visual-parity slug — one per (screen, pattern) tuple ───────
  if (violation.kind === "parity-divergence") {
    return `parity-${slugify(violation.screen)}-${slugify(violation.pattern)}`;
  }
  if (violation.kind === "orphan-component") {
    const name =
      violation.exportNames?.[0] ??
      path.basename(violation.path, path.extname(violation.path));
    return `orphan-${slugify(name)}`;
  }
  // orphan-route
  return `orphan-route-${slugify(violation.routePattern ?? violation.path)}`;
}

function bugIdFor(violation, seq) {
  return `bug-${seq}-${stableSlugFor(violation)}`;
}

// bug-053: walk plans/{active,archive}/ for any plan whose filename ends
// with `-<stableSlug>.md` (regardless of seq prefix). Returns the existing
// plan info — caller uses it to skip the duplicate write.
function findExistingPlanByStableSlug(plansDir, stableSlug) {
  for (const sub of ["active", "archive"]) {
    const dir = path.join(plansDir, sub);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      const m = entry.match(/^bug-\d{1,4}-(.+)\.md$/);
      if (m && m[1] === stableSlug) {
        return {
          planId: entry.replace(/\.md$/, ""),
          planPath: path.join(dir, entry),
          location: sub,
        };
      }
    }
  }
  return null;
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
  if (opts.dependsOnBugId) {
    lines.push("");
    lines.push(
      `> **Depends on**: \`${opts.dependsOnBugId}\` — this is a \`timeout-no-evidence\` failure that likely cascades from a runtime / compile error. The bug-fix loop will defer this entry until the cascade root resolves; on the next verify pass it should clear automatically.`,
    );
  }
  return lines.join("\n");
}

/**
 * feat-027 Phase D — runtime-error / dev-server-compile bug template.
 *
 * Used when a synthesized flow fails AND the runner extracted runtime
 * signals (console errors / page errors / network failures / Next.js
 * dev-server overlay) from the spec's `runtime-errors` attachment.
 *
 * The body surfaces:
 *   - The console / page / network errors verbatim (ordered, the FIRST one
 *     is the suspected root cause)
 *   - Dev-server overlay text when present (always cascade root)
 *   - Likely category heuristic (parse-error, missing-import,
 *     hydration-mismatch) so the agent has a starting point
 *   - Screenshot path so the agent can see what the user would see
 *   - dependsOnBugId reference (when applicable)
 */
function runtimeErrorBody(v, opts = {}) {
  const re = v.runtimeErrors ?? {
    consoleErrors: [],
    pageErrors: [],
    networkFailures: [],
  };
  const screenshotPath = v.screenshot ?? v.screenshotPath ?? null;
  const htmlPath = v.html ?? v.htmlDumpPath ?? null;
  const isCompile = v.kind === "dev-server-compile" || re.devServerOverlay;
  const lines = [
    "## Description",
    "",
    isCompile
      ? `Dev-server compile error blocked rendering during synthesized flow \`${v.flowName}\` (${v.flowId}). The page rendered the Next.js error overlay instead of the expected screen — every downstream flow will time out until this resolves.`
      : `Runtime errors observed during synthesized flow \`${v.flowName}\` (${v.flowId}). The page may have rendered, but interactive behaviour is blocked by JavaScript errors.`,
    "",
  ];

  if (re.devServerOverlay) {
    lines.push("### Dev-server compile error (Next.js overlay)");
    lines.push("");
    lines.push("```");
    lines.push(re.devServerOverlay.rawText);
    lines.push("```");
    lines.push("");
  }

  if (re.consoleErrors.length > 0) {
    lines.push(`### Console errors (${re.consoleErrors.length})`);
    lines.push("");
    for (const msg of re.consoleErrors.slice(0, 10)) {
      lines.push(`- \`${msg.replace(/`/g, "\\`")}\``);
    }
    if (re.consoleErrors.length > 10) {
      lines.push(`- _… ${re.consoleErrors.length - 10} more_`);
    }
    lines.push("");
  }

  if (re.pageErrors.length > 0) {
    lines.push(`### Page errors (${re.pageErrors.length})`);
    lines.push("");
    for (const err of re.pageErrors.slice(0, 5)) {
      lines.push(`- **${err.message.replace(/\n/g, " ")}**`);
      if (err.stack) {
        const head = err.stack.split("\n").slice(0, 4).join("\n");
        lines.push("  ```");
        lines.push("  " + head.replace(/\n/g, "\n  "));
        lines.push("  ```");
      }
    }
    lines.push("");
  }

  if (re.networkFailures.length > 0) {
    lines.push(`### Failed network requests (${re.networkFailures.length})`);
    lines.push("");
    for (const n of re.networkFailures.slice(0, 10)) {
      lines.push(`- \`${n.method} ${n.url}\` → ${n.failureText}`);
    }
    lines.push("");
  }

  if (screenshotPath) {
    lines.push("### Screenshot at moment of failure");
    lines.push("");
    lines.push(`![flow-${v.flowId} runtime failure](${screenshotPath})`);
    lines.push("");
  }
  if (htmlPath) {
    lines.push(`Page HTML dump: \`${htmlPath}\``);
    lines.push("");
  }

  // Heuristic category — sniff the FIRST signal to suggest a fix family.
  const firstSignal =
    re.devServerOverlay?.rawText ??
    re.pageErrors[0]?.message ??
    re.consoleErrors[0] ??
    re.networkFailures[0]?.url ??
    "";
  const category = inferRuntimeCategory(firstSignal, re);
  lines.push("## Likely category");
  lines.push("");
  for (const hint of category.hints) lines.push(`- ${hint}`);
  lines.push("");

  lines.push("## Fix approach");
  lines.push("");
  lines.push(
    "Surface the FIRST listed error as the root cause; downstream errors often cascade from it. Re-run `/build-to-spec-verify` after the fix to confirm the cascade clears.",
  );
  if (isCompile) {
    lines.push("");
    lines.push(
      "Because this is a dev-server compile error, EVERY synthesized flow likely timed out behind it. Resolve this bug FIRST — the dependent timeouts (tagged `dependsOnBugId: " +
        "<this id>`) should clear automatically on the next verify pass.",
    );
  }
  lines.push("");

  lines.push("## Validation");
  lines.push("");
  lines.push(
    `Re-run \`/build-to-spec-verify\`; the runtime-errors attachment for \`${v.flowId}\` must be empty AND the page must render the expected screen \`${v.expectedScreenId}\` without console / page / network errors.`,
  );

  if (opts.dependsOnBugId) {
    lines.push("");
    lines.push(
      `> Dependent timeouts in this iteration are tagged \`dependsOn: ${opts.dependsOnBugId}\` (the cascade root).`,
    );
  }

  return lines.join("\n");
}

/**
 * feat-027 — heuristic category dispatcher for runtime errors. Returns a
 * small bag of category hints the bug-fix agent can pattern-match on
 * before re-deriving from scratch.
 */
function inferRuntimeCategory(firstSignal, re) {
  const sig = String(firstSignal).toLowerCase();
  /** @type {string[]} */
  const hints = [];
  if (
    /can'?t resolve|cannot find module|module not found/.test(sig) ||
    re.networkFailures?.some((n) => /\.(css|js|jsx?|tsx?)$/.test(n.url))
  ) {
    hints.push(
      "**missing-import**: grep for the failing module path; check `tsconfig.paths` + workspace alias (most common: `@repo/ui-kit/*` mis-typed or moved).",
    );
  }
  if (/syntax|unexpected token|parse error|@import.*before/.test(sig)) {
    hints.push(
      "**parse-error**: check the most-recently-edited CSS / TSX files in the cited path. Tailwind / PostCSS often surfaces ordering bugs (e.g. `@import` after `@tailwind`).",
    );
  }
  if (
    /hydration|server html.*didn'?t match|maximum (call stack|update depth)/.test(
      sig,
    )
  ) {
    hints.push(
      "**hydration-mismatch / infinite-loop**: check for `Date.now()` / `Math.random()` in server components, OR a Zustand selector returning a fresh object on every render.",
    );
  }
  if (
    re.networkFailures?.length > 0 &&
    !hints.some((h) => h.includes("missing-import"))
  ) {
    const url = re.networkFailures[0].url;
    hints.push(
      `**network-failure**: the request to \`${url}\` failed. Check for a missing API route, wrong base URL, or CORS misconfig.`,
    );
  }
  if (hints.length === 0) {
    hints.push(
      "**unknown**: review the FIRST error verbatim and inspect the screenshot to localise. Page-error stack traces (if present) usually point straight at the offending file.",
    );
  }
  return { hints };
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

// ─── feat-028 Phase 4: parityDivergenceBody template ─────────────────────
//
// One bug-plan per (screen, pattern) tuple — NOT one per individual
// missing/extra/variantDrift entry. The body lists all per-pattern details
// in a single plan so the builder can fix the cluster in one pass; the
// per-pattern suggested-fix wording matches the pattern's typical root
// cause (shell-stripping → wrap in AppShell; token-drift → re-bind the
// className to the kit token; etc.).

/**
 * @param {{
 *   screen: string,
 *   pattern: string,
 *   severity: "P0"|"P1"|"P2",
 *   detail: {
 *     missing: string[],
 *     extra: string[],
 *     variantDrift: { selector: string, mockupValue: string, builtValue: string }[],
 *     styleDrift: { selector: string, property: string, mockupValue: string, builtValue: string }[],
 *   }
 * }} v
 */
function parityDivergenceBody(v) {
  const lines = [
    "## Description",
    "",
    `The built page \`/${v.screen}\` diverges from its mockup at \`docs/screens/webapp/${v.screen}.html\`. Pattern: **\`${v.pattern}\`** (severity \`${v.severity}\`).`,
    "",
  ];

  // Per-pattern explanation
  switch (v.pattern) {
    case "shell-stripping":
      lines.push(
        "The mockup wraps page content in an `AppShell` (sidebar + topbar) but the built page renders the content as a stand-alone island. Every downstream nav-flow assertion will fail until the shell is wired in.",
      );
      break;
    case "layout-regrouping":
      lines.push(
        "Kit primitives are present but reorganised into a different layout than the mockup specifies. Builder likely composed children differently than the mockup HTML.",
      );
      break;
    case "token-drift":
      lines.push(
        "Computed colors, radii, or border widths drift from the mockup's token-bound values. Most often the className references an arbitrary value (`bg-[#ff0000]`) instead of the kit's tokenised utility (`bg-accent-500`).",
      );
      break;
    case "copy-sizing-drift":
      lines.push(
        "Typography (font-family, font-size, font-weight, line-height) drifts from the mockup. Builder probably swapped a kit primitive's preset variant for a hand-rolled className.",
      );
      break;
    case "spacing-token-drift":
      lines.push(
        "Padding, margin, or gap values drift off the kit's spacing scale. Builder likely used arbitrary Tailwind values (`p-[18px]`) instead of token-bound utilities (`p-4`).",
      );
      break;
    case "identity-contract-broken":
      lines.push(
        "A brand identity element (logo, wordmark, brand-mark) is missing or swapped. The mockup is the contract for brand presentation; deviations leak into screenshots + visual-review.",
      );
      break;
    default:
      lines.push(
        "Mismatch between mockup + built page that doesn't fit a known pattern; review missing/extra/drift below.",
      );
  }
  lines.push("");

  if (v.detail.missing.length > 0) {
    lines.push("## Missing kit nodes");
    lines.push("");
    lines.push(
      "Present in mockup, absent from built page (paths are dotted-component selectors, e.g. `AppShell[0] > Sidebar[0] > Button[2]`):",
    );
    lines.push("");
    for (const sel of v.detail.missing.slice(0, 20)) lines.push(`- \`${sel}\``);
    if (v.detail.missing.length > 20)
      lines.push(`- … (${v.detail.missing.length - 20} more)`);
    lines.push("");
  }

  if (v.detail.extra.length > 0) {
    lines.push("## Extra kit nodes");
    lines.push("");
    lines.push("Present in built page, absent from mockup:");
    lines.push("");
    for (const sel of v.detail.extra.slice(0, 20)) lines.push(`- \`${sel}\``);
    if (v.detail.extra.length > 20)
      lines.push(`- … (${v.detail.extra.length - 20} more)`);
    lines.push("");
  }

  if (v.detail.variantDrift.length > 0) {
    lines.push("## Variant drift");
    lines.push("");
    lines.push(
      "Same primitive in same position, but `data-kit-variant` / `data-kit-size` differs:",
    );
    lines.push("");
    for (const d of v.detail.variantDrift.slice(0, 20)) {
      lines.push(
        `- \`${d.selector}\` — mockup: \`${d.mockupValue}\` → built: \`${d.builtValue}\``,
      );
    }
    if (v.detail.variantDrift.length > 20)
      lines.push(`- … (${v.detail.variantDrift.length - 20} more)`);
    lines.push("");
  }

  if (v.detail.styleDrift.length > 0) {
    lines.push("## Computed-style drift");
    lines.push("");
    lines.push(
      "Curated computed-style properties differ between mockup + built page (numeric ±1px tolerance applied):",
    );
    lines.push("");
    for (const d of v.detail.styleDrift.slice(0, 20)) {
      lines.push(
        `- \`${d.selector}\` \`${d.property}\` — mockup: \`${d.mockupValue}\` → built: \`${d.builtValue}\``,
      );
    }
    if (v.detail.styleDrift.length > 20)
      lines.push(`- … (${v.detail.styleDrift.length - 20} more)`);
    lines.push("");
  }

  // Per-pattern fix approach
  lines.push("## Fix approach");
  lines.push("");
  switch (v.pattern) {
    case "shell-stripping":
      lines.push(
        `Wrap the rendered content in \`<AppShell sidebar={...} header={...}>\` from \`@repo/ui-kit\`. Pull the sidebar + topbar tree from the mockup at \`docs/screens/webapp/${v.screen}.html\` (the kit's \`AppShell\` primitive accepts \`sidebar\` + \`header\` slot props). The \`data-kit-component\` attributes on the mockup elements are the binding contract — every primitive in the mockup's shell must surface in the built page with the matching attributes.`,
      );
      break;
    case "layout-regrouping":
      lines.push(
        `Re-shuffle the JSX so kit primitives appear in the same parent → child structure as \`docs/screens/webapp/${v.screen}.html\`. Walk the mockup's DOM, match each \`[data-kit-component]\` to a JSX import, preserve order. If a primitive in the missing/extra list has been intentionally moved per a kit-change-request, document the deviation in the feature plan rather than fixing here.`,
      );
      break;
    case "token-drift":
      lines.push(
        `Replace arbitrary Tailwind values (\`bg-[#ff0000]\`, \`rounded-[12px]\`) with kit-token utilities (\`bg-accent-500\`, \`rounded-md\`). The kit's \`tailwind.config.ts\` exposes the full token table — the mockup's classes are the source of truth.`,
      );
      break;
    case "copy-sizing-drift":
      lines.push(
        `Swap any hand-rolled typography classNames for the kit's pre-bound utilities (\`text-lg\` instead of \`text-[18px]\`; the kit's font scale is in \`packages/ui-kit/src/tokens/tokens.json\`). When a heading level differs, match the semantic tag (\`<h1>\` vs \`<h2>\`) AND its kit class — don't fix one without the other.`,
      );
      break;
    case "spacing-token-drift":
      lines.push(
        `Swap arbitrary spacing values for the kit's spacing scale: \`p-4\` instead of \`p-[16px]\`, \`gap-2\` instead of \`gap-[8px]\`. The kit's spacing scale is in \`packages/ui-kit/src/tokens/tokens.json\`.`,
      );
      break;
    case "identity-contract-broken":
      lines.push(
        `Restore the missing brand element from \`docs/asset-inventory.json\` (user-supplied) OR the mockup at \`docs/screens/webapp/${v.screen}.html\`. If a brand element was renamed/restructured, file a kit-change-request rather than fixing here.`,
      );
      break;
    default:
      lines.push(
        `Manual review required — the divergence didn't fit a curated pattern. Reference \`docs/screens/webapp/${v.screen}.html\` as the contract.`,
      );
  }
  lines.push("");

  lines.push("## Validation");
  lines.push("");
  lines.push(
    `Re-run \`/build-to-spec-verify\`; the parity report's \`${v.pattern}\` divergence on \`${v.screen}\` must clear (no missing/extra/drift entries).`,
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
 * @returns {"reachability-orphan"|"flow-execution-failure"|"runtime-error"|"dev-server-compile"|"visual-parity"}
 */
function bugSourceFor(violation) {
  if (violation.kind === "flow-failure") return "flow-execution-failure";
  if (violation.kind === "runtime-error") return "runtime-error";
  if (violation.kind === "dev-server-compile") return "dev-server-compile";
  if (violation.kind === "parity-divergence") return "visual-parity";
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

function defaultAgentSequence(violation, tier = "web-frontend-builder") {
  // bug-050 Phase B (2026-05-03) — route by primaryCause when present.
  // feat-058 (2026-05-06) — trim sequence length per cause class. Empirical
  //   anchor: reading-log-01 single-bug dispatches taking ~30min with full
  //   3-agent sequence; for cheap classes (dev-server-compile,
  //   reachability-orphan, visual-parity, runtime-error) tester+reviewer
  //   add ~10-20min without catching what the loop's re-verify already
  //   catches. See investigate-018 + feat-058 for the full reasoning.
  //
  // Routing table (post-feat-058):
  //
  //   CHEAP CLASSES (re-verify is the natural test; reviewer adds ~0):
  //     - dev-server-compile → [<tier>]
  //         Re-verify literally answers "does the dev-server boot now?".
  //         Reviewer can't add semantic value on plumbing fixes.
  //     - runtime-error      → [<tier>, reviewer]
  //         Re-verify catches the runtime failure; reviewer kept for
  //         semantic check (was the fix correct or a workaround?).
  //     - visual-parity      → [<tier>, reviewer]
  //         Parity-verify is the structural check; tester redundant.
  //     - reachability-orphan→ [<tier>, reviewer]
  //         Wiring fix verified by re-verify; reviewer for semantic.
  //         (Orphan violations have no primaryCause — handled at the
  //         buildBugEntry call-site separately.)
  //
  //   FEATURE-CLASS BUGS (real work, full safety net):
  //     - build-gap          → [<tier>, tester, reviewer]
  //     - seed-setup         → [backend-builder, tester, reviewer]
  //         (Strategy C `/test/seed-baseline` endpoint missing/broken —
  //         backend's lane regardless of <tier>.)
  //     - flow-execution-failure → [<tier>, tester, reviewer]
  //
  //   OPERATOR-ONLY (no dispatch):
  //     - manifest-author    → []
  //         Flow author hallucinated; fix is /user-flows-generator regen
  //         in design-stage skill, not Mode B builders.
  //
  //   UNKNOWN / step-transition → [<tier>, tester, reviewer] (default;
  //         conservative — keep full sequence until classifier narrows).
  //
  // The `tier` parameter (default web-frontend-builder for backward
  // compat with pre-bug-056 callers) lets bug-056 layer tier inference
  // on top of feat-058's sequence trim. Cause-specific overrides
  // (e.g. seed-setup → backend-builder) take precedence over `tier`.
  const cause = violation && violation.primaryCause;
  switch (cause) {
    // Cheap classes: re-verify is the test; reviewer adds 0 on plumbing.
    case "dev-server-compile":
      return [tier];
    // Cheap classes with semantic risk: drop tester, keep reviewer.
    case "runtime-error":
    case "visual-parity":
      return [tier, "reviewer"];
    // Real backend work: full safety net (overrides `tier`).
    case "seed-setup":
      return ["backend-builder", "tester", "reviewer"];
    // Operator-review-only — out-of-band fix.
    case "manifest-author":
      return [];
    // Real feature work: full safety net.
    case "build-gap":
    case "flow-execution-failure":
    default:
      return [tier, "tester", "reviewer"];
  }
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
  } else if (violation.kind === "parity-divergence") {
    // Parity bugs reference the mockup as the contract + the page-render
    // root as the most-likely fix-site (the build-to-spec wrapper doesn't
    // know which JSX file owns the rendered page; the builder resolves
    // it from `data-screen-id`).
    out.push(`docs/screens/webapp/${violation.screen}.html`);
    out.push(`apps/web/app/**/page.tsx`);
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
  dependsOnBugId,
}) {
  const id = shortBugIdFor(planId);
  const source = bugSourceFor(violation);
  const owningFeature =
    violation.kind === "flow-failure" ||
    violation.kind === "runtime-error" ||
    violation.kind === "dev-server-compile"
      ? (relatedOrphan?.owningFeature ?? null)
      : violation.kind === "parity-divergence"
        ? null // parity bugs aren't owned by a single feature — span the page render
        : (violation.owningFeature ?? null);

  // feat-028 — parity violations carry their own severity (P0 for
  // shell-stripping, P1 for everything else). Other kinds default to P0
  // per the verifier's "treat all integration bugs as P0 in v1" stance.
  const severity =
    violation.kind === "parity-divergence"
      ? (violation.severity ?? "P0")
      : "P0";

  /** @type {Record<string, any>} */
  const entry = {
    id,
    iteration,
    source,
    severity,
    summary: summaryFor(violation),
    correlatedOrphanPath: relatedOrphan?.path ?? null,
    owningFeature,
    affectsFiles: deriveAffectsFiles(violation, relatedOrphan),
    // feat-058 — reachability-orphan violations have no primaryCause field
    // (they come from the reachability analyzer, not the flow runner). They
    // are wiring fixes the loop's re-verify catches on next pass; trim
    // tester out per the cheap-class table. Synthesize a primaryCause
    // sentinel so defaultAgentSequence gets the trimmed path.
    agentSequence: defaultAgentSequence(
      violation.kind === "orphan-component" || violation.kind === "orphan-route"
        ? { primaryCause: "visual-parity" } // shares the [<tier>, reviewer] sequence
        : violation,
    ),
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

  // feat-027 Phase D — surface dependsOnBugId so the bug-fix loop knows to
  // defer this bug until the cascade root resolves. Schema-wise this is a
  // free-form pass-through field on bugs.yaml entries (BugEntrySchema uses
  // .strip() so unknown fields are dropped silently — extend the schema in
  // a follow-up if we want strict validation).
  if (dependsOnBugId) {
    entry.dependsOnBugId = dependsOnBugId;
  }

  if (
    violation.kind === "flow-failure" ||
    violation.kind === "runtime-error" ||
    violation.kind === "dev-server-compile"
  ) {
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
    if (
      violation.kind !== "flow-failure" &&
      violation.runtimeErrors !== undefined
    ) {
      // feat-027 Phase D — preserve the captured runtime payload so bug-fix
      // agents can inspect it without re-running the spec.
      entry.runtimeErrors = violation.runtimeErrors;
    }
    if (violation.primaryCause !== undefined) {
      entry.primaryCause = violation.primaryCause;
    }
  }

  if (violation.kind === "orphan-component") {
    entry.orphan = {
      componentPath: violation.path,
      exportNames: violation.exportNames ?? [],
      suggestedImporters: violation.suggestedImporters ?? [],
    };
  } else if (violation.kind === "orphan-route") {
    // orphan-route — still represent under `orphan` slot for downstream agents
    entry.orphan = {
      componentPath: violation.path,
      exportNames: [],
      suggestedImporters: violation.suggestedNavSurfaces ?? [],
    };
  } else if (violation.kind === "parity-divergence") {
    // feat-028 — surface the (screen, pattern) tuple + detail counts so the
    // bug-fix loop has enough context without re-running the verifier.
    // Schema-wise this is a free-form pass-through field; BugEntrySchema
    // strips unknown fields, so the loop reads it via the YAML doc rather
    // than the parsed Zod type.
    entry.parity = {
      screen: violation.screen,
      pattern: violation.pattern,
      detail: violation.detail,
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
  if (violation.kind === "dev-server-compile") {
    const overlay = violation.runtimeErrors?.devServerOverlay?.rawText ?? "";
    const head =
      overlay.split("\n")[0]?.trim().slice(0, 120) ?? "compile error";
    return `Dev-server compile error during ${violation.flowId}: ${head}`.slice(
      0,
      200,
    );
  }
  if (violation.kind === "runtime-error") {
    const re = violation.runtimeErrors ?? {
      consoleErrors: [],
      pageErrors: [],
      networkFailures: [],
    };
    const first =
      re.pageErrors?.[0]?.message ??
      re.consoleErrors?.[0] ??
      re.networkFailures?.[0]?.url ??
      "runtime error";
    return `Runtime error during ${violation.flowId}: ${String(first).slice(0, 140)}`.slice(
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
  if (violation.kind === "parity-divergence") {
    // feat-028: per-(screen, pattern) tuple summary; counts the most
    // salient detail bucket so the operator gets a one-line gist.
    const d = violation.detail ?? {
      missing: [],
      extra: [],
      variantDrift: [],
      styleDrift: [],
    };
    const counts = [];
    if (d.missing.length) counts.push(`${d.missing.length} missing`);
    if (d.extra.length) counts.push(`${d.extra.length} extra`);
    if (d.variantDrift.length)
      counts.push(`${d.variantDrift.length} variantDrift`);
    if (d.styleDrift.length) counts.push(`${d.styleDrift.length} styleDrift`);
    const tail = counts.length ? ` (${counts.join(", ")})` : "";
    return `Parity ${violation.pattern} on ${violation.screen}${tail}`.slice(
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
 * @param {{projectDir: string, violation: Violation, relatedOrphan?: OrphanViolation, pipelineRunId?: string, iteration?: number, appendToYaml?: boolean, dependsOnBugId?: string}} args
 * @returns {Promise<{planId: string, planPath: string, bugYamlId?: string}>}
 */
export async function fileBugPlan({
  projectDir,
  violation,
  relatedOrphan,
  pipelineRunId,
  iteration,
  appendToYaml,
  dependsOnBugId,
}) {
  const plansDir = path.join(projectDir, "plans");
  fs.mkdirSync(path.join(plansDir, "active"), { recursive: true });

  // bug-053 (2026-05-05): dedup short-circuit. If a plan-file already
  // exists for this violation's stable slug (active OR archive), reuse
  // the existing planId/path instead of writing a fresh `bug-NNN+1-*.md`.
  // The bugs.yaml entry write below is INDEPENDENTLY idempotent (keyed
  // on stable id, not seq) and still happens — `runFixBugsLoop` reads
  // bugs.yaml, not plan-files. When the existing plan was archived, the
  // verifier signals a regression by including `previouslyArchived` in
  // the return so /build-to-spec-verify's warnings[] surfaces it.
  const stableSlug = stableSlugFor(violation);
  const existing = findExistingPlanByStableSlug(plansDir, stableSlug);
  if (existing) {
    let bugYamlId;
    if (appendToYaml !== false) {
      const entry = buildBugEntry({
        planId: existing.planId,
        planPath: existing.planPath,
        violation,
        relatedOrphan,
        iteration: iteration ?? 1,
        dependsOnBugId,
      });
      try {
        bugYamlId = appendBugToYaml({
          projectDir,
          entry,
          pipelineRunId,
          iteration: iteration ?? 1,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[fileBugPlan] failed to append ${existing.planId} to docs/bugs.yaml: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return {
      planId: existing.planId,
      planPath: existing.planPath,
      ...(bugYamlId !== undefined ? { bugYamlId } : {}),
      deduplicated: true,
      previouslyArchived: existing.location === "archive",
    };
  }

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
      dependsOnBugId,
    });
  } else if (
    violation.kind === "runtime-error" ||
    violation.kind === "dev-server-compile"
  ) {
    body = runtimeErrorBody(violation, { dependsOnBugId });
  } else if (violation.kind === "parity-divergence") {
    body = parityDivergenceBody(violation);
  } else if (violation.kind === "orphan-component") {
    body = orphanComponentBody(violation);
  } else {
    body = orphanRouteBody(violation);
  }

  const affected = [];
  if (
    violation.kind === "flow-failure" ||
    violation.kind === "runtime-error" ||
    violation.kind === "dev-server-compile"
  ) {
    if (relatedOrphan?.path) affected.push(relatedOrphan.path);
    if (relatedOrphan?.suggestedImporters?.[0])
      affected.push(relatedOrphan.suggestedImporters[0]);
  } else if (violation.kind === "orphan-component") {
    affected.push(violation.path);
    if (violation.suggestedImporters?.[0])
      affected.push(violation.suggestedImporters[0]);
  } else if (violation.kind === "parity-divergence") {
    // Reference the mockup as the contract; the build-to-spec wrapper
    // doesn't know which page.tsx renders the screen.
    affected.push(`docs/screens/webapp/${violation.screen}.html`);
  } else {
    affected.push(violation.path);
  }

  const owningFeature =
    violation.kind === "flow-failure" ||
    violation.kind === "runtime-error" ||
    violation.kind === "dev-server-compile"
      ? (relatedOrphan?.owningFeature ?? null)
      : violation.kind === "parity-divergence"
        ? null
        : violation.owningFeature;

  const branch = `fix/${planId}`;

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
      dependsOnBugId,
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
