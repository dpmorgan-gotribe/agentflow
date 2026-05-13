/**
 * feat-069 — AI walkthrough script (B.1 — route sweep MVP).
 *
 * Drives a Playwright-controlled browser through every route declared in
 * `docs/analysis/{platform}/screens.json`. Captures:
 *   - One screenshot per route → docs/build-to-spec/walkthrough/step-<N>-<slug>.png
 *   - Network requests + responses → docs/build-to-spec/walkthrough/network.ndjson
 *   - Console + pageerror events → docs/build-to-spec/walkthrough/console.ndjson
 *   - Step manifest summary → docs/build-to-spec/walkthrough/manifest.json
 *
 * The walkthrough-reviewer agent (Tier 5) consumes all of this in ONE
 * vision-LLM call + emits behavioral findings.
 *
 * B.1 scope: route sweep only (visit + screenshot per route). B.2 adds
 * per-flow empty-state triggers + generic interaction sweep (theme toggle
 * + search input + Tab traversal) for catching bug-094-class behavioral
 * bugs (duplicate-request, no-op-control, keyboard-nav skips).
 *
 * Cross-refs:
 *   - plans/active/feat-069-ai-walkthrough.md — the plan
 *   - .claude/agents/walkthrough-reviewer.md — the agent contract
 *   - orchestrator/src/walkthrough-review.ts — the dispatcher
 *   - scripts/run-synthesized-flows.mjs — sibling Playwright runner (Tier 2)
 */

import { chromium } from "playwright";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Read the screens.json metadata from a project's docs/analysis/{platform}/.
 * Tries common platform slugs (webapp, web) + falls back to a single-screen
 * default (`/`) when no screens.json exists.
 */
function discoverRoutes(projectDir) {
  const candidates = [
    "docs/analysis/webapp/screens.json",
    "docs/analysis/web/screens.json",
  ];
  for (const rel of candidates) {
    const abs = join(projectDir, rel);
    if (!existsSync(abs)) continue;
    try {
      const doc = JSON.parse(readFileSync(abs, "utf8"));
      const screens = doc?.app?.screens ?? doc?.screens ?? [];
      if (Array.isArray(screens) && screens.length > 0) {
        return screens
          .filter(
            (s) =>
              typeof s?.routePattern === "string" && s.routePattern.length > 0,
          )
          .map((s) => ({
            screenId: String(s.id ?? "unknown"),
            routePattern: String(s.routePattern),
            name: String(s.name ?? s.id ?? "unknown"),
          }));
      }
    } catch {
      // Continue to next candidate.
    }
  }
  return [{ screenId: "home", routePattern: "/", name: "Home (fallback)" }];
}

/**
 * Substitute a route pattern's dynamic segments with seeded test values.
 * `/books/[id]` → `/books/seed-book-1`. The seed values are project-agnostic
 * heuristics; future B.2 work can read live DB / use synthesized fixtures.
 */
function substituteRoutePattern(routePattern) {
  return routePattern
    .replace(/\[id\]/g, "seed-book-1")
    .replace(/\[slug\]/g, "default")
    .replace(/:id(?=\/|$)/g, "seed-book-1");
}

/** Convert a route pattern into a filesystem-safe slug for screenshot naming. */
function slugifyRoute(routePattern) {
  return (
    routePattern
      .replace(/^\//, "")
      .replace(/\//g, "_")
      .replace(/[\[\]]/g, "")
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .toLowerCase() || "root"
  );
}

/**
 * Run the walkthrough. Returns an outcome object:
 *   {
 *     ok: boolean,
 *     stepsRun: number,
 *     screenshotsCount: number,
 *     errors: string[],
 *     warnings: string[],
 *     durationMs: number,
 *     outDir: string,
 *     manifestPath: string,
 *   }
 */
export async function runAiWalkthrough({
  projectDir,
  baseUrl,
  outDirRel = "docs/build-to-spec/walkthrough",
  // Test seam — replaces playwright import. When unset, uses real chromium.
  launchBrowser,
}) {
  const startedAt = Date.now();
  const errors = [];
  const warnings = [];
  const outDir = resolve(projectDir, outDirRel);
  mkdirSync(outDir, { recursive: true });

  const routes = discoverRoutes(projectDir);
  if (routes.length === 0) {
    return {
      ok: false,
      stepsRun: 0,
      screenshotsCount: 0,
      errors: ["no routes discovered (no screens.json + no fallback)"],
      warnings,
      durationMs: Date.now() - startedAt,
      outDir,
      manifestPath: null,
    };
  }

  // Open network + console NDJSON sinks. Each line a JSON event.
  const networkLogPath = join(outDir, "network.ndjson");
  const consoleLogPath = join(outDir, "console.ndjson");
  writeFileSync(networkLogPath, ""); // truncate
  writeFileSync(consoleLogPath, "");

  const appendNdjson = (path, obj) => {
    try {
      appendFileSync(path, JSON.stringify(obj) + "\n");
    } catch {
      /* best-effort; missing logs surface as agent-side warnings */
    }
  };

  let browser;
  let context;
  try {
    if (launchBrowser) {
      // Test seam path.
      ({ browser, context } = await launchBrowser());
    } else {
      browser = await chromium.launch({ headless: true });
      context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        baseURL: baseUrl,
      });
    }
  } catch (err) {
    return {
      ok: false,
      stepsRun: 0,
      screenshotsCount: 0,
      errors: [
        `failed to launch browser: ${err instanceof Error ? err.message : String(err)}. Chromium binary may not be installed; run \`pnpm -C apps/web exec playwright install chromium\` at the project root.`,
      ],
      warnings,
      durationMs: Date.now() - startedAt,
      outDir,
      manifestPath: null,
    };
  }

  const page = await context.newPage();

  // Network capture — request + response paired by URL+method+time-window.
  page.on("request", (request) => {
    appendNdjson(networkLogPath, {
      kind: "request",
      ts: Date.now(),
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
    });
  });
  page.on("response", (response) => {
    appendNdjson(networkLogPath, {
      kind: "response",
      ts: Date.now(),
      method: response.request().method(),
      url: response.url(),
      status: response.status(),
    });
  });

  // Console capture — all log levels + uncaught errors.
  page.on("console", (msg) => {
    appendNdjson(consoleLogPath, {
      kind: "console",
      ts: Date.now(),
      level: msg.type(),
      text: msg.text(),
      url: msg.location()?.url ?? null,
    });
  });
  page.on("pageerror", (err) => {
    appendNdjson(consoleLogPath, {
      kind: "pageerror",
      ts: Date.now(),
      level: "error",
      text: err.message,
      stack: err.stack ?? null,
    });
  });

  const manifest = {
    version: "1.0",
    schemaVersion: "feat-069-B.2",
    generatedAt: new Date().toISOString(),
    baseUrl: baseUrl ?? null,
    steps: [],
  };

  let screenshotsCount = 0;
  let stepCounter = 0;
  const nextStep = () => ++stepCounter;
  const screenshotFor = (slug, label) =>
    `step-${String(stepCounter).padStart(2, "0")}-${slug}${label ? "-" + label : ""}.png`;

  // ── Interaction helpers (feat-069 B.2). Each returns a manifest step on
  // ── trigger; null when the element isn't on the page (skip silently). ──

  /**
   * Find the first locator matching one of the given selectors that exists
   * AND is visible. Returns null if none match. Used by all interaction
   * helpers so detection failure is graceful.
   */
  async function findFirstVisible(selectors) {
    for (const sel of selectors) {
      try {
        const loc = page.locator(sel).first();
        if ((await loc.count()) > 0 && (await loc.isVisible())) {
          return loc;
        }
      } catch {
        // Selector parse error → try next.
      }
    }
    return null;
  }

  /**
   * Theme-toggle interaction. Looks for a theme-button by common selectors,
   * clicks it up to 3 times (cycling through theme states), captures a
   * screenshot + the page's data-theme attribute after each click.
   */
  async function runThemeToggle(routeSlug) {
    const themeBtn = await findFirstVisible([
      'button[aria-label*="theme" i]',
      'button:has-text("Theme")',
      '[data-action="theme-toggle"]',
      '[role="switch"][aria-label*="theme" i]',
    ]);
    if (!themeBtn) return null;
    const step = nextStep();
    const tsBefore = Date.now();
    const themesObserved = [];
    let screenshotPath = null;
    try {
      // Capture initial theme.
      const initial = await page.evaluate(() =>
        document.documentElement.getAttribute("data-theme"),
      );
      themesObserved.push(`initial:${initial ?? "(none)"}`);
      for (let i = 0; i < 3; i++) {
        await themeBtn.click({ timeout: 5000 });
        await page.waitForTimeout(400);
        const after = await page.evaluate(() =>
          document.documentElement.getAttribute("data-theme"),
        );
        themesObserved.push(`cycle-${i + 1}:${after ?? "(none)"}`);
      }
      screenshotPath = screenshotFor(routeSlug, "theme-toggle");
      await page.screenshot({ path: join(outDir, screenshotPath) });
      screenshotsCount += 1;
    } catch (err) {
      warnings.push(
        `step ${step} (theme-toggle): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return {
      step,
      kind: "theme-toggle",
      tsBefore,
      tsAfter: Date.now(),
      screenshotPath,
      themesObserved,
    };
  }

  /**
   * Search-input interaction. Looks for a search input, focuses + types a
   * test query, captures a screenshot. Reveals controlled-component bugs +
   * search-handler wiring issues.
   */
  async function runSearchFill(routeSlug) {
    const searchInput = await findFirstVisible([
      'input[type="search"]',
      'input[placeholder*="search" i]',
      'input[aria-label*="search" i]',
      '[role="searchbox"]',
    ]);
    if (!searchInput) return null;
    const step = nextStep();
    const tsBefore = Date.now();
    let screenshotPath = null;
    const query = "test query";
    try {
      await searchInput.fill(query, { timeout: 5000 });
      await page.waitForTimeout(500); // debounce window
      screenshotPath = screenshotFor(routeSlug, "search-fill");
      await page.screenshot({ path: join(outDir, screenshotPath) });
      screenshotsCount += 1;
    } catch (err) {
      warnings.push(
        `step ${step} (search-fill): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return {
      step,
      kind: "search-fill",
      tsBefore,
      tsAfter: Date.now(),
      screenshotPath,
      query,
    };
  }

  /**
   * Delete-click interaction. Looks for a delete affordance (book-detail
   * route specifically), clicks it ONCE, captures the 2s window of
   * network requests + a post-action screenshot. The bug-094 canonical
   * detection — duplicate DELETE requests show as N entries in the
   * network log for one click.
   */
  async function runDeleteClick(routeSlug) {
    const deleteBtn = await findFirstVisible([
      'button[aria-label*="delete" i]',
      'button:has-text("Delete")',
      '[data-action="delete"]',
    ]);
    if (!deleteBtn) return null;
    const step = nextStep();
    const tsBefore = Date.now();
    let screenshotPath = null;
    try {
      // Auto-confirm any browser-native confirm() dialog the click triggers,
      // so the second-click confirm path proceeds without operator input.
      // Many apps use window.confirm("Are you sure?") for destructive ops.
      page.once("dialog", (dialog) => {
        dialog.accept().catch(() => {});
      });
      await deleteBtn.click({ timeout: 5000 });
      // Wait long enough for any duplicate-request cascade to land in the
      // network log (empirical bug-094: 6 DELETE requests within 1.8s).
      await page.waitForTimeout(2500);
      screenshotPath = screenshotFor(routeSlug, "delete-click");
      await page.screenshot({ path: join(outDir, screenshotPath) });
      screenshotsCount += 1;
    } catch (err) {
      warnings.push(
        `step ${step} (delete-click): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return {
      step,
      kind: "delete-click",
      tsBefore,
      tsAfter: Date.now(),
      screenshotPath,
    };
  }

  /**
   * Keyboard Tab traversal. Focuses the page + presses Tab 8 times,
   * capturing the focused element's tag + aria-label after each press.
   * Reveals tabindex bugs + focus-trap leaks + skipped focusable elements.
   */
  async function runTabTraversal(routeSlug) {
    const step = nextStep();
    const tsBefore = Date.now();
    let screenshotPath = null;
    const focusPath = [];
    try {
      // Click body to reset focus to a known starting point.
      await page.evaluate(() => document.body?.focus());
      await page.waitForTimeout(100);
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press("Tab");
        await page.waitForTimeout(80);
        const focused = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el) return null;
          return {
            tag: el.tagName.toLowerCase(),
            role: el.getAttribute("role") ?? null,
            ariaLabel: el.getAttribute("aria-label") ?? null,
            text:
              el.textContent?.trim().slice(0, 30) ??
              el.getAttribute("placeholder") ??
              null,
            id: el.getAttribute("id") ?? null,
          };
        });
        focusPath.push({ tab: i + 1, ...focused });
      }
      screenshotPath = screenshotFor(routeSlug, "tab-traversal");
      await page.screenshot({ path: join(outDir, screenshotPath) });
      screenshotsCount += 1;
    } catch (err) {
      warnings.push(
        `step ${step} (tab-traversal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return {
      step,
      kind: "tab-traversal",
      tsBefore,
      tsAfter: Date.now(),
      screenshotPath,
      focusPath,
    };
  }

  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    const slug = slugifyRoute(route.routePattern);
    const url = substituteRoutePattern(route.routePattern);
    const routeStep = nextStep();
    const screenshotName = screenshotFor(slug);
    const screenshotPath = join(outDir, screenshotName);

    const tsBefore = Date.now();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    } catch (err) {
      // page.goto can throw on networkidle timeout for SPAs with persistent
      // long-poll connections; fall back to a softer wait.
      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        });
        warnings.push(
          `step ${routeStep} (${url}): networkidle timed out; fell back to domcontentloaded`,
        );
      } catch (err2) {
        errors.push(
          `step ${routeStep} (${url}): page.goto failed — ${err2 instanceof Error ? err2.message : String(err2)}`,
        );
        manifest.steps.push({
          step: routeStep,
          kind: "route-visit",
          screenId: route.screenId,
          routePattern: route.routePattern,
          url,
          screenshotPath: null,
          tsBefore,
          tsAfter: Date.now(),
          error: err2 instanceof Error ? err2.message : String(err2),
        });
        continue;
      }
    }

    // Short settle: wait 500ms for any post-mount data fetches to settle.
    await page.waitForTimeout(500);

    try {
      await page.screenshot({ path: screenshotPath, fullPage: false });
      screenshotsCount += 1;
    } catch (err) {
      errors.push(
        `step ${routeStep} (${url}): screenshot failed — ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    manifest.steps.push({
      step: routeStep,
      kind: "route-visit",
      screenId: route.screenId,
      routePattern: route.routePattern,
      url,
      screenshotPath: screenshotName,
      tsBefore,
      tsAfter: Date.now(),
    });

    // ── feat-069 B.2 interaction sweep — exercise common UI affordances
    // ── + capture evidence so the walkthrough-reviewer agent can find
    // ── duplicate-request / no-op-control / keyboard-nav-skip behavior. ──
    const interactionSteps = [];
    for (const helper of [
      runThemeToggle,
      runSearchFill,
      runDeleteClick,
      runTabTraversal,
    ]) {
      try {
        const result = await helper(slug);
        if (result) {
          interactionSteps.push({
            ...result,
            parentRouteStep: routeStep,
            screenId: route.screenId,
            url,
          });
        }
      } catch (err) {
        warnings.push(
          `interaction helper failed on ${url}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    for (const s of interactionSteps) manifest.steps.push(s);
  }

  const manifestPath = join(outDir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  try {
    await context.close();
    await browser.close();
  } catch {
    /* best-effort */
  }

  return {
    ok: errors.length === 0,
    stepsRun: routes.length,
    screenshotsCount,
    errors,
    warnings,
    durationMs: Date.now() - startedAt,
    outDir,
    manifestPath,
  };
}

// CLI mode: `node scripts/ai-walkthrough.mjs <projectDir> <baseUrl>`
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , projectDirArg, baseUrlArg] = process.argv;
  if (!projectDirArg) {
    console.error("usage: node ai-walkthrough.mjs <projectDir> [baseUrl]");
    process.exit(2);
  }
  const projectDir = resolve(projectDirArg);
  const baseUrl = baseUrlArg ?? "http://localhost:3000";
  runAiWalkthrough({ projectDir, baseUrl })
    .then((out) => {
      console.log(JSON.stringify(out, null, 2));
      process.exit(out.ok ? 0 : 1);
    })
    .catch((err) => {
      console.error("walkthrough crashed:", err);
      process.exit(1);
    });
}
