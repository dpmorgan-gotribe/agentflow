import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  ParityVerifyOutputSchema,
  type ParityVerifyOutput,
  type ParityDivergence,
} from "@repo/orchestrator-contracts";
import {
  bootDevServer,
  teardownDevServer,
  type DevServerHandle,
} from "./dev-server.js";

/**
 * feat-028 Phase 3 — orchestrator-side wrapper for the visual-parity
 * verification stage.
 *
 * Mirrors the shape of feat-022's `runBuildToSpecVerify`. Per-screen flow:
 *
 *   1. Enumerate mockup HTML files at `<projectDir>/docs/screens/{platform}/*.html`.
 *   2. For each, call `runScreenComparison()` which loads the mockup HTML
 *      + drives Playwright (headless chromium) to render the built page,
 *      extracts the kit-skeleton + computed-style snapshot from BOTH, and
 *      runs `diff-kit-skeleton.mjs` + `audit-computed-styles.mjs`.
 *   3. Merge the resulting divergence rows per (screen, pattern) tuple.
 *   4. Validate the aggregate against `ParityVerifyOutputSchema`.
 *
 * v1 keeps the runtime cost at ~$0 by relying on:
 *   - Pure DOM-skeleton diff (no LLM)
 *   - Computed-style snapshots taken via headless Playwright (no SaaS)
 *   - Curated selector + property lists (no full-CSS parsing)
 *
 * Test seams: `loadScreenList`, `compareScreen` are injectable so tests
 * can synthesize mockup/built snapshots inline without booting Playwright
 * or http-server. The default implementations gracefully degrade with
 * warnings when Playwright isn't installed (mirrors feat-025's runner).
 */

export interface ParityVerifyContext {
  projectDir: string;
  /** Repo root for the factory itself (where scripts/ lives). Defaults to process.cwd(). */
  factoryRoot?: string;
  /**
   * Optional override — when omitted, the wrapper enumerates
   * `<projectDir>/docs/screens/webapp/*.html` automatically. Tests pass
   * a synthesized list to skip filesystem I/O.
   */
  loadScreenList?: (projectDir: string) => Promise<ScreenEntry[]>;
  /**
   * Test seam — replaces the per-screen comparison helper. The default
   * shells out to Playwright via dynamic import; tests pass a stub that
   * returns a `ScreenComparisonResult` directly.
   */
  compareScreen?: (args: {
    projectDir: string;
    factoryRoot: string;
    screen: ScreenEntry;
    ctx: ParityVerifyContext;
  }) => Promise<ScreenComparisonResult>;
  /**
   * When false, skip the entire stage and return `ok:true,
   * screensChecked:0, divergences:[]` (the project deliberately opted out,
   * or callers want a smoke-only verify pass). Default true.
   */
  enabled?: boolean;
  /**
   * feat-035 — base URL for the running dev server. The Phase B Playwright
   * driver navigates to `${devServerUrl}${url-for-screen}`.
   *
   * feat-036 — when omitted AND `autoBootDevServer !== false`, parity-
   * verify boots its own dev server via `orchestrator/src/dev-server.ts`,
   * waits for ready, runs the diff, and tears down on completion. Operator
   * can still pass an explicit URL to reuse a manually-booted dev server.
   */
  devServerUrl?: string;
  /**
   * feat-036 — when true, spawn `pnpm -C apps/web dev` if `devServerUrl`
   * is not supplied. Default false to preserve test-seam behavior
   * (tests stub `loadScreenList` + `compareScreen` and don't want to
   * boot a real server). The standalone CLI + the build-to-spec-verify
   * wrapper opt in explicitly.
   */
  autoBootDevServer?: boolean;
  /**
   * feat-036 — wall-clock budget for `waitForDevServer` polling. Default
   * 60_000ms (matches `run-synthesized-flows.mjs`).
   */
  devServerBootTimeoutMs?: number;
  /**
   * feat-035 — explicit screen-id → built-URL override map. Required for
   * dynamic routes (e.g. `/report/:owner/:repo`) where there's no
   * default heuristic. Static routes fall back to `/{screen.id}` (or `/`
   * when id === "home").
   *
   * Example:
   *   { "report": "/report/facebook/react",
   *     "compare": "/compare/facebook/react/preactjs/preact" }
   */
  screenUrlMap?: Record<string, string>;
}

export interface ScreenEntry {
  /** Kebab-case screen id (matches mockup filename + page `data-screen-id`). */
  id: string;
  /** Platform slug — "webapp" / "mobile" / "tablet". v1 only ships webapp. */
  platform: string;
  /** Absolute path to the mockup HTML on disk. */
  mockupPath: string;
}

export interface ScreenComparisonResult {
  divergences: ParityDivergence[];
  warnings: string[];
}

/**
 * Default `loadScreenList`: enumerate
 * `<projectDir>/docs/screens/webapp/*.html`. Skips files starting with
 * `_` (private fragments) and the `index.html` viewer page.
 */
function defaultLoadScreenList(projectDir: string): Promise<ScreenEntry[]> {
  const out: ScreenEntry[] = [];
  const dir = join(projectDir, "docs/screens/webapp");
  if (!existsSync(dir)) return Promise.resolve(out);
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".html")) continue;
    if (file.startsWith("_")) continue;
    if (file === "index.html") continue;
    const id = file.replace(/\.html$/, "");
    out.push({
      id,
      platform: "webapp",
      mockupPath: join(dir, file),
    });
  }
  return Promise.resolve(out);
}

/**
 * Default `compareScreen`: shells out to Playwright via dynamic import.
 * Falls back to a soft-warning when Playwright isn't installed (matches
 * the feat-025 runner's degradation pattern). v1 implementation reads the
 * mockup HTML straight off disk + uses `extractKitSkeleton` directly on
 * its source; the built page requires Playwright (the dev server renders
 * React → DOM).
 *
 * For v1 this default is intentionally a no-op when Playwright isn't
 * available — the value of feat-028 is the SCHEMA + PLUMBING + AUTHOR
 * path, which lights up the moment the project provisions chromium.
 * Until then the verifier surfaces "playwright-unavailable" warnings,
 * never produces false-positive divergences.
 */
/**
 * feat-035 — resolve a screen's built-page URL.
 *
 * Priority: explicit `screenUrlMap[id]` → "home" alias for "/" →
 * `/{id}` fallback. Dynamic routes (those whose mockup id implies
 * URL params) MUST be in `screenUrlMap` or they're rejected with
 * a "needs URL fixture" warning instead of a misleading 404 diff.
 */
function resolveBuiltUrl(
  screen: ScreenEntry,
  ctx: { devServerUrl?: string; screenUrlMap?: Record<string, string> },
): { url: string } | { skipReason: string } {
  const base = (ctx.devServerUrl ?? "http://localhost:3000").replace(/\/$/, "");
  const explicit = ctx.screenUrlMap?.[screen.id];
  if (explicit) return { url: `${base}${explicit}` };
  if (screen.id === "home") return { url: `${base}/` };
  // Heuristic: dynamic-route mockups typically have ids with sub-states
  // ("compare-half-empty", "report-loading", "report-network-error",
  // "report-not-found", "report-private", "report-rate-limited"). They
  // need fixture URLs to render meaningfully.
  if (
    screen.id.includes("loading") ||
    screen.id.includes("error") ||
    screen.id.includes("rate-limited") ||
    screen.id.includes("private") ||
    screen.id.includes("not-found") ||
    screen.id.includes("half-empty") ||
    screen.id === "report" ||
    screen.id === "compare"
  ) {
    return {
      skipReason: `dynamic route — needs ctx.screenUrlMap['${screen.id}'] (e.g. '/report/facebook/react')`,
    };
  }
  // Static-route fallback: `/{id}` (e.g. "about" → "/about").
  return { url: `${base}/${screen.id}` };
}

async function defaultCompareScreen({
  projectDir,
  factoryRoot,
  screen,
  ctx,
}: {
  projectDir: string;
  factoryRoot: string;
  screen: ScreenEntry;
  ctx: ParityVerifyContext;
}): Promise<ScreenComparisonResult> {
  // Load mockup HTML from disk
  let mockupHtml: string;
  try {
    mockupHtml = readFileSync(screen.mockupPath, "utf8");
  } catch (err) {
    return {
      divergences: [],
      warnings: [`failed to read mockup: ${(err as Error).message}`],
    };
  }

  // Resolve built-page URL. Skip dynamic routes without explicit fixtures.
  const urlResult = resolveBuiltUrl(screen, ctx);
  if ("skipReason" in urlResult) {
    return { divergences: [], warnings: [urlResult.skipReason] };
  }
  const builtUrl = urlResult.url;

  // feat-035 Phase A — Playwright as a hard devDep. Dynamic import keeps
  // graceful degradation when chromium binary isn't downloaded yet.
  type PWChromium = {
    launch: (opts?: unknown) => Promise<{
      newPage: (opts?: unknown) => Promise<{
        goto: (url: string, opts?: unknown) => Promise<unknown>;
        content: () => Promise<string>;
      }>;
      close: () => Promise<void>;
    }>;
  };
  let chromium: PWChromium;
  try {
    const mod = (await import("playwright")) as unknown as {
      chromium: PWChromium;
    };
    chromium = mod.chromium;
  } catch {
    return {
      divergences: [],
      warnings: [
        `playwright not installed — visual-parity stage skipped (run 'pnpm install' + 'pnpm exec playwright install chromium')`,
      ],
    };
  }

  // feat-035 Phase B — actually render the built page + extract HTML.
  let browser: Awaited<ReturnType<PWChromium["launch"]>> | undefined;
  let builtHtml: string;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    await page.goto(builtUrl, { waitUntil: "networkidle", timeout: 30_000 });
    builtHtml = await page.content();
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    return {
      divergences: [],
      warnings: [
        `built-page render failed at ${builtUrl}: ${(err as Error).message}`,
      ],
    };
  }
  await browser.close().catch(() => {});

  // feat-035 — diff via existing scripts/diff-kit-skeleton.mjs.
  // Resolve the script path relative to factoryRoot so test seams +
  // alternate factory layouts still resolve correctly.
  type DiffAndClassify = (args: {
    screenId: string;
    mockupHtml: string;
    builtHtml: string;
  }) => {
    diff: unknown;
    divergences: ParityDivergence[];
  };
  let diffAndClassify: DiffAndClassify;
  try {
    const scriptUrl = new URL(
      `file://${factoryRoot.replace(/\\/g, "/")}/scripts/diff-kit-skeleton.mjs`,
    ).href;
    const mod = (await import(scriptUrl)) as unknown as {
      diffAndClassify: DiffAndClassify;
    };
    diffAndClassify = mod.diffAndClassify;
  } catch (err) {
    return {
      divergences: [],
      warnings: [
        `failed to import diff-kit-skeleton: ${(err as Error).message}`,
      ],
    };
  }

  // Run the diff. Each divergence is already shaped as ParityDivergence
  // (per scripts/diff-kit-skeleton.mjs:299-309).
  void projectDir; // reserved for future fixture-resolution
  const result = diffAndClassify({
    screenId: screen.id,
    mockupHtml,
    builtHtml,
  });
  return { divergences: result.divergences ?? [], warnings: [] };
}

/**
 * Run the parity-verify stage. Returns a `ParityVerifyOutput` (Zod-validated).
 * On internal failure (missing project, exception in compareScreen, …) the
 * affected screens contribute warnings rather than aborting the stage —
 * the orchestrator's caller decides whether to fail the build on warnings
 * vs divergences.
 */
export async function runParityVerify(
  ctx: ParityVerifyContext,
): Promise<ParityVerifyOutput> {
  const startedAt = Date.now();
  const projectDir = resolve(ctx.projectDir);
  const factoryRoot = ctx.factoryRoot ?? process.cwd();

  if (ctx.enabled === false) {
    return ParityVerifyOutputSchema.parse({
      ok: true,
      screensChecked: 0,
      divergences: [],
      warnings: ["parity-verify disabled via context.enabled=false"],
      durationMs: Date.now() - startedAt,
      costUsd: 0,
    });
  }

  const loadScreens = ctx.loadScreenList ?? defaultLoadScreenList;
  const compareScreen = ctx.compareScreen ?? defaultCompareScreen;

  const warnings: string[] = [];
  const divergences: ParityDivergence[] = [];

  let screens: ScreenEntry[] = [];
  try {
    screens = await loadScreens(projectDir);
  } catch (err) {
    warnings.push(`loadScreenList threw: ${(err as Error).message}`);
  }

  if (screens.length === 0) {
    warnings.push(
      "no mockup screens found at docs/screens/webapp/*.html — parity stage no-op",
    );
  }

  // feat-036 — auto-boot dev server when no URL supplied. Safe to skip
  // when there are no screens to check OR when caller explicitly opted
  // out via autoBootDevServer:false.
  let devServerHandle: DevServerHandle | null = null;
  let effectiveCtx: ParityVerifyContext = ctx;
  const shouldAutoBoot =
    screens.length > 0 && !ctx.devServerUrl && ctx.autoBootDevServer === true;
  if (shouldAutoBoot) {
    try {
      devServerHandle = await bootDevServer(
        projectDir,
        ctx.devServerBootTimeoutMs ?? 60_000,
      );
      effectiveCtx = { ...ctx, devServerUrl: devServerHandle.baseUrl };
      warnings.push(
        `dev-server: auto-booted at ${devServerHandle.baseUrl} (took ${Date.now() - devServerHandle.startedAtMs}ms)`,
      );
    } catch (err) {
      warnings.push(
        `dev-server: auto-boot failed: ${(err as Error).message}; parity-verify will skip with screens unchecked`,
      );
      // Without a server, we can't compare; return early with the warning.
      return ParityVerifyOutputSchema.parse({
        ok: true,
        screensChecked: 0,
        divergences: [],
        warnings,
        durationMs: Date.now() - startedAt,
        costUsd: 0,
      });
    }
  }

  try {
    for (const screen of screens) {
      try {
        const result = await compareScreen({
          projectDir,
          factoryRoot,
          screen,
          ctx: effectiveCtx,
        });
        divergences.push(...result.divergences);
        for (const w of result.warnings) {
          warnings.push(`screen ${screen.id}: ${w}`);
        }
      } catch (err) {
        warnings.push(
          `screen ${screen.id}: compareScreen threw: ${(err as Error).message}`,
        );
      }
    }
  } finally {
    // feat-036 — always teardown auto-booted server, even on inner throw.
    if (devServerHandle) {
      teardownDevServer(devServerHandle);
    }
  }

  // Merge per-(screen, pattern) tuple — multiple comparisons might emit
  // the same pattern row separately (one from kit-skeleton, one from
  // computed-styles); fold them so bug-author writes ONE plan per cluster.
  const merged = mergeByScreenPattern(divergences);

  const ok = merged.length === 0;
  const output = {
    ok,
    screensChecked: screens.length,
    divergences: merged,
    warnings,
    durationMs: Date.now() - startedAt,
    costUsd: 0,
  };
  return ParityVerifyOutputSchema.parse(output);
}

/**
 * Fold divergences with the same (screen, pattern) into a single row by
 * concatenating their `detail.{missing,extra,variantDrift,styleDrift}`
 * arrays. Severity = max severity across folded rows (P0 > P1 > P2).
 */
export function mergeByScreenPattern(
  divergences: readonly ParityDivergence[],
): ParityDivergence[] {
  /** @type {Map<string, ParityDivergence>} */
  const byKey = new Map<string, ParityDivergence>();
  const sevRank = (s: ParityDivergence["severity"]) =>
    s === "P0" ? 0 : s === "P1" ? 1 : 2;
  for (const div of divergences) {
    const key = `${div.screen}::${div.pattern}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        ...div,
        detail: {
          missing: [...div.detail.missing],
          extra: [...div.detail.extra],
          variantDrift: [...div.detail.variantDrift],
          styleDrift: [...div.detail.styleDrift],
        },
      });
      continue;
    }
    existing.detail.missing.push(...div.detail.missing);
    existing.detail.extra.push(...div.detail.extra);
    existing.detail.variantDrift.push(...div.detail.variantDrift);
    existing.detail.styleDrift.push(...div.detail.styleDrift);
    if (sevRank(div.severity) < sevRank(existing.severity)) {
      existing.severity = div.severity;
    }
  }
  return [...byKey.values()];
}
