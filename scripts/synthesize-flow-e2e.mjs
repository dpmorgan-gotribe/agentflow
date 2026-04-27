#!/usr/bin/env node
// scripts/synthesize-flow-e2e.mjs — feat-022 Phase 3.
//
// Reads `docs/user-flows-manifest.json` + the screen mockups under
// `docs/screens/{platform}/*.html`. For each flow, generates a Playwright
// spec at `apps/web/e2e/synthesized/flow-{n}.spec.ts` whose body walks the
// flow's `steps[]` and asserts `data-screen-id` lands on the expected
// next-screen within 2s of clicking a heuristic-derived selector for the
// transition.
//
// The action DSL is intentionally tiny — flows-manifest.json doesn't carry
// explicit `action` fields per step, so the synthesizer infers a click
// target from the EXIT screen's mockup HTML (it scans for the most likely
// element that triggers navigation to that screen). On failure each spec
// captures a screenshot + DOM dump under
// `docs/build-to-spec/failures/flow-{n}-step-{m}.{html,png}`.
//
// Usage:
//   node scripts/synthesize-flow-e2e.mjs <projectDir>
//
// Output (stdout JSON):
//   { ok, generatedFiles[], flowsCount, projectDir }
//
// Exit code 0 always (synthesis errors are surfaced via JSON).

import fs from "node:fs";
import path from "node:path";

const projectDir = path.resolve(process.argv[2] ?? process.cwd());
if (!fs.existsSync(projectDir)) {
  console.error(`projectDir not found: ${projectDir}`);
  process.exit(2);
}

const manifestPath = path.join(projectDir, "docs/user-flows-manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.log(
    JSON.stringify({
      ok: false,
      reason: `missing ${path.relative(projectDir, manifestPath)} — run /user-flows-generator first`,
      generatedFiles: [],
      flowsCount: 0,
      projectDir,
    }),
  );
  process.exit(0);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (!Array.isArray(manifest.flows) || manifest.flows.length === 0) {
  console.log(
    JSON.stringify({
      ok: false,
      reason: "manifest has empty flows[]",
      generatedFiles: [],
      flowsCount: 0,
      projectDir,
    }),
  );
  process.exit(0);
}

// ─── Selector inference per transition ──────────────────────────────────────
//
// The manifest doesn't encode "click X" — it encodes "from screen A go to
// screen B". We need to guess a selector for the click that triggers that
// transition. Strategy: read the FROM screen's HTML, look for hints that
// match the TO screen's id (e.g., a button with text containing the
// to-screen's name; an <a href> matching to-screen's id; a kit-component
// known to navigate). Fall back to a broad cardlike-element click for
// modal-style transitions.

function readScreenHtml(platform, screenId) {
  const p = path.join(projectDir, "docs/screens", platform, `${screenId}.html`);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8");
}

/**
 * Build a Playwright selector chain to click for the transition
 * `from → to`. Returns a JS expression as a string (drop into spec body).
 */
function inferSelector(fromScreenId, toScreenId, fromHtml) {
  const toLabel = toScreenId.replace(/-/g, " ");
  const toLabelRe = new RegExp(toLabel.replace(/\s+/g, "[\\s-]+"), "i");

  // 1. Anchor whose href matches the to-screen
  if (
    fromHtml &&
    new RegExp(`href=["'][^"']*${toScreenId}`, "i").test(fromHtml)
  ) {
    return `page.locator('a[href*="${toScreenId}"]').first()`;
  }

  // 2. Button / element whose visible text matches the to-screen label
  if (fromHtml && toLabelRe.test(fromHtml)) {
    const escapedLabel = toLabel.replace(/'/g, "\\'");
    return `page.getByRole('button', { name: /${toLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/i }).first()`;
  }

  // 3. Special-case modal-style screens: clicking a card / list item opens
  //    the detail. Modal screen ids commonly contain "modal" / "detail" /
  //    "edit"; the trigger is usually a kit-component card-like element.
  const isModal = /modal|detail|edit|view/i.test(toScreenId);
  if (isModal) {
    return `page.locator('[data-kit-component="Card"], [data-kit-component="KanbanCard"], [role="article"], [role="listitem"]').first()`;
  }

  // 4. Sidebar / nav link for "settings"-style top-level screens
  if (/^(settings|profile|account|admin|help|about)$/i.test(toScreenId)) {
    return `page.getByRole('link', { name: /${toScreenId}/i }).first()`;
  }

  // 5. Fall back: any clickable that names the to-screen
  return `page.locator('a, button').filter({ hasText: /${toScreenId.replace(/-/g, "[\\s-]?")}/i }).first()`;
}

// ─── Spec generation ────────────────────────────────────────────────────────

function specForFlow(flow, flowIndex) {
  const platform = flow.platform ?? "webapp";
  const flowFileBase = `flow-${flowIndex + 1}`;
  const flowName = (flow.name ?? `flow ${flowIndex + 1}`).replace(/`/g, "\\`");
  const flowId = (flow.id ?? `flow-${flowIndex + 1}`).replace(/`/g, "\\`");
  const description = (flow.description ?? "").replace(/`/g, "\\`");

  const steps = Array.isArray(flow.steps) ? flow.steps : [];
  if (steps.length < 2) {
    return {
      content: `// ${flowFileBase}: skipped — flow has fewer than 2 steps (need at least entry + exit)\n`,
      skipped: true,
    };
  }

  const lines = [];
  lines.push(`/**`);
  lines.push(
    ` * ${flowFileBase}.spec.ts — synthesized by scripts/synthesize-flow-e2e.mjs (feat-022).`,
  );
  lines.push(` *`);
  lines.push(` * Flow: ${flowName} (${flowId})`);
  if (description) lines.push(` * ${description}`);
  lines.push(
    ` * DO NOT EDIT BY HAND — re-runs of /build-to-spec-verify regenerate this file.`,
  );
  lines.push(` * Failures land in docs/build-to-spec/failures/.`);
  lines.push(` */`);
  lines.push(`import { test, expect } from "@playwright/test";`);
  lines.push(``);
  lines.push(`const FAILURE_DIR = "../../docs/build-to-spec/failures";`);
  lines.push(`const TRANSITION_TIMEOUT_MS = 2000;`);
  lines.push(``);
  lines.push(`test.describe("${flowName} (${flowId})", () => {`);
  lines.push(
    `  test("walks ${steps.length} steps; each transition lands on expected screen-id", async ({ page }) => {`,
  );
  lines.push(`    const failures: string[] = [];`);
  lines.push(``);

  // Step 0: navigate to entry screen
  const entry = steps[0];
  lines.push(`    // Step 0: navigate to entry screen "${entry.screenId}"`);
  lines.push(`    await page.goto("/");`);
  lines.push(
    `    // Wait for any element with data-screen-id; SPA may take a tick.`,
  );
  lines.push(
    `    await page.waitForSelector("[data-screen-id]", { timeout: 5000 }).catch(() => null);`,
  );
  lines.push(``);

  for (let i = 0; i < steps.length - 1; i++) {
    const from = steps[i];
    const to = steps[i + 1];
    const fromHtml = readScreenHtml(platform, from.screenId);
    const selector = inferSelector(from.screenId, to.screenId, fromHtml);

    lines.push(`    // ── Step ${i + 1}: ${from.screenId} → ${to.screenId} ──`);
    lines.push(`    {`);
    lines.push(
      `      const before = await page.locator("[data-screen-id]").first().getAttribute("data-screen-id").catch(() => null);`,
    );
    lines.push(
      `      // Allow either the from-screen id OR an empty SPA-init state on first step`,
    );
    lines.push(
      `      if (${i === 0 ? "before !== null && " : ""}before !== "${from.screenId}") {`,
    );
    lines.push(
      `        failures.push(\`step ${i + 1}: expected on-screen "${from.screenId}" before click, got "\${before}"\`);`,
    );
    lines.push(`      }`);
    lines.push(`      const trigger = ${selector};`);
    lines.push(`      const triggerCount = await trigger.count();`);
    lines.push(`      if (triggerCount === 0) {`);
    lines.push(
      `        failures.push(\`step ${i + 1}: no clickable element found for "${from.screenId} → ${to.screenId}" (selector inference returned 0 matches)\`);`,
    );
    lines.push(`      } else {`);
    lines.push(`        await trigger.click({ trial: false });`);
    lines.push(
      `        // Wait for screen-id to flip to expected; capture context on failure.`,
    );
    lines.push(`        try {`);
    lines.push(`          await page.waitForFunction(`);
    lines.push(
      `            (expected) => document.querySelector("[data-screen-id]")?.getAttribute("data-screen-id") === expected,`,
    );
    lines.push(`            "${to.screenId}",`);
    lines.push(`            { timeout: TRANSITION_TIMEOUT_MS },`);
    lines.push(`          );`);
    lines.push(`        } catch (err) {`);
    lines.push(
      `          const actual = await page.locator("[data-screen-id]").first().getAttribute("data-screen-id").catch(() => null);`,
    );
    lines.push(
      `          await page.screenshot({ path: \`\${FAILURE_DIR}/${flowFileBase}-step-${i + 1}.png\`, fullPage: true }).catch(() => {});`,
    );
    lines.push(`          const html = await page.content().catch(() => "");`);
    lines.push(`          const fs = await import("node:fs");`);
    lines.push(`          fs.mkdirSync(FAILURE_DIR, { recursive: true });`);
    lines.push(
      `          fs.writeFileSync(\`\${FAILURE_DIR}/${flowFileBase}-step-${i + 1}.html\`, html);`,
    );
    lines.push(
      `          failures.push(\`step ${i + 1}: clicked toward "${to.screenId}" but landed on "\${actual}" (selector: ${selector.replace(/`/g, "\\`")})\`);`,
    );
    lines.push(`        }`);
    lines.push(`      }`);
    lines.push(`    }`);
    lines.push(``);
  }

  lines.push(`    if (failures.length > 0) {`);
  lines.push(
    `      throw new Error(\`${flowFileBase} (${flowName}) — \${failures.length} transition failure(s):\\n\${failures.map((f) => "  - " + f).join("\\n")}\`);`,
  );
  lines.push(`    }`);
  lines.push(`  });`);
  lines.push(`});`);
  lines.push(``);

  return { content: lines.join("\n"), skipped: false };
}

// ─── Write specs ────────────────────────────────────────────────────────────

const outDir = path.join(projectDir, "apps/web/e2e/synthesized");
fs.mkdirSync(outDir, { recursive: true });

const generated = [];
const skipped = [];

for (let i = 0; i < manifest.flows.length; i++) {
  const flow = manifest.flows[i];
  const { content, skipped: didSkip } = specForFlow(flow, i);
  const fileName = `flow-${i + 1}.spec.ts`;
  const fullPath = path.join(outDir, fileName);
  fs.writeFileSync(fullPath, content);
  const rel = path.relative(projectDir, fullPath).replace(/\\/g, "/");
  if (didSkip) skipped.push(rel);
  else generated.push(rel);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      flowsCount: manifest.flows.length,
      generatedFiles: generated,
      skippedFiles: skipped,
      projectDir,
      outDir: path.relative(projectDir, outDir).replace(/\\/g, "/"),
    },
    null,
    2,
  ),
);
process.exit(0);
