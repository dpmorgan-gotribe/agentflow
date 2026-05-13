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
   *
   * feat-069 B.3: scrollIntoViewIfNeeded BEFORE the visibility check so
   * affordances rendered below the fold (Delete button at bottom of book
   * detail page) get detected. Without this, the B.2 run missed the
   * Delete button entirely.
   */
  async function findFirstVisible(selectors, opts = {}) {
    const { scopeLocator = null, scrollIntoView = true } = opts;
    const root = scopeLocator ?? page;
    for (const sel of selectors) {
      try {
        const loc = root.locator(sel).first();
        if ((await loc.count()) === 0) continue;
        if (scrollIntoView) {
          try {
            await loc.scrollIntoViewIfNeeded({ timeout: 1000 });
          } catch {
            /* element may not be scrollable; visibility check still authoritative */
          }
        }
        if (await loc.isVisible()) return loc;
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
   * Delete-click interaction. Looks for a delete affordance, clicks the
   * trigger, then detects + clicks through a confirm dialog when present
   * (the typical destructive-action pattern). Captures the time window
   * across BOTH clicks + 2.5s settle so duplicate-request cascades in the
   * network log fall inside one step's tsBefore/tsAfter range.
   *
   * The bug-094 canonical detection — empirical motivator: single click
   * on the dialog's confirm produces 6 DELETE requests within 1.8s.
   *
   * feat-069 B.3:
   *  - Widened trigger selectors (text-match with "Delete book" was missed
   *    in B.2 due to scroll position; scrollIntoView in findFirstVisible
   *    + extra text variants fix it).
   *  - Confirm-dialog flow: after trigger, look for [role=dialog] /
   *    [role=alertdialog] / a visible dialog container; inside it find
   *    the destructive-confirm button and click it.
   *  - Native confirm() dialogs still auto-accepted as fallback.
   */
  async function runDeleteClick(routeSlug) {
    // Poll up to 3s for a Delete affordance. Empirical (reading-log-02
    // book-detail): networkidle resolves before React's post-fetch re-render
    // commits — Delete button isn't in the DOM at goto+500ms but appears
    // ~1.5s later when loadBook's useEffect finishes its setState cycle.
    // Without the poll the helper short-circuits on routes that DO carry a
    // Delete affordance, silently skipping the bug-094 detection surface.
    for (let i = 0; i < 6; i++) {
      const c = await page
        .locator('button:has-text("Delete")')
        .count()
        .catch(() => 0);
      if (c > 0) break;
      await page.waitForTimeout(500);
    }
    const deleteBtn = await findFirstVisible([
      'button[aria-label*="delete" i]',
      'button:has-text("Delete")',
      'button:text-matches("delete", "i")',
      '[role="button"]:has-text("Delete")',
      '[data-action="delete"]',
      '[data-action*="delete" i]',
    ]);
    if (!deleteBtn) return null;
    const step = nextStep();
    const tsBefore = Date.now();
    let screenshotPath = null;
    let confirmedThroughDialog = false;
    try {
      // Native window.confirm() fallback — many destructive flows use it.
      page.once("dialog", (dialog) => {
        dialog.accept().catch(() => {});
      });

      // Step 1: click the trigger (likely opens a confirm dialog).
      await deleteBtn.click({ timeout: 5000 });
      // Brief settle for dialog mount + Framer/Radix animation.
      await page.waitForTimeout(400);

      // Step 2: detect a confirm dialog. Common React patterns:
      //   <div role="dialog" aria-labelledby="..." aria-modal="true">
      //   <div role="alertdialog">
      //   Headless UI / Radix / shadcn variants emit role=dialog.
      const dialog = await findFirstVisible(
        [
          '[role="alertdialog"]',
          '[role="dialog"]',
          '[aria-modal="true"]',
          // Some apps don't set role but use a class-based modal — last resort.
          'div[class*="modal" i][class*="open" i]',
          'div[class*="dialog" i]',
        ],
        { scrollIntoView: false },
      );
      if (dialog) {
        // Inside the dialog, find the confirm button. The destructive
        // confirm typically reuses the same verb ("Delete") OR uses
        // "Confirm" / "Yes". Search the dialog scope only so we don't
        // accidentally re-click the original trigger.
        const confirmBtn = await findFirstVisible(
          [
            'button:has-text("Delete")',
            'button:has-text("Confirm")',
            'button:has-text("Yes")',
            'button:has-text("OK")',
            'button[data-variant="destructive"]',
            'button[type="submit"]',
          ],
          { scopeLocator: dialog, scrollIntoView: false },
        );
        if (confirmBtn) {
          await confirmBtn.click({ timeout: 5000 });
          confirmedThroughDialog = true;
        } else {
          warnings.push(
            `step ${step} (delete-click): confirm dialog detected but no confirm button matched — dialog may have a custom layout`,
          );
        }
      }

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
      confirmedThroughDialog,
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
    // ── duplicate-request / no-op-control / keyboard-nav-skip behavior.
    //
    // feat-069 B.3 ordering + route restoration:
    //  - runDeleteClick runs BEFORE runSearchFill because global search
    //    typically navigates (e.g. typing pushes ?q= and routes back to /).
    //    On /books/[id] empirical: search-fill swept the page from the
    //    book detail view to the filtered library list — subsequent delete
    //    + tab helpers couldn't find the per-page affordances.
    //  - After each helper that potentially navigates (any helper, really),
    //    re-navigate to the original URL so the next helper sees the
    //    declared route context.
    // ──
    const interactionSteps = [];
    for (const helper of [
      runThemeToggle,
      runDeleteClick,
      runSearchFill,
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
        if (page.url() !== url) {
          try {
            await page.goto(url, {
              waitUntil: "domcontentloaded",
              timeout: 15000,
            });
          } catch (navErr) {
            warnings.push(
              `re-navigate after interaction on ${url} failed: ${navErr instanceof Error ? navErr.message : String(navErr)}`,
            );
          }
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
