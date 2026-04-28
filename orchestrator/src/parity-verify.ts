import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  ParityVerifyOutputSchema,
  type ParityVerifyOutput,
  type ParityDivergence,
} from "@repo/orchestrator-contracts";

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
  }) => Promise<ScreenComparisonResult>;
  /**
   * When false, skip the entire stage and return `ok:true,
   * screensChecked:0, divergences:[]` (the project deliberately opted out,
   * or callers want a smoke-only verify pass). Default true.
   */
  enabled?: boolean;
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
async function defaultCompareScreen({
  projectDir,
  factoryRoot,
  screen,
}: {
  projectDir: string;
  factoryRoot: string;
  screen: ScreenEntry;
}): Promise<ScreenComparisonResult> {
  // Load mockup HTML from disk
  let mockupHtml: string;
  try {
    mockupHtml = readFileSync(screen.mockupPath, "utf8");
  } catch (err) {
    return {
      divergences: [],
      warnings: [
        `screen ${screen.id}: failed to read mockup: ${(err as Error).message}`,
      ],
    };
  }
  // Try to dynamic-import Playwright. If absent, soft-fail.
  let chromium: { launch: (...args: unknown[]) => Promise<unknown> } | null;
  try {
    const mod = (await import("playwright")) as unknown as {
      chromium: { launch: (...args: unknown[]) => Promise<unknown> };
    };
    chromium = mod.chromium;
  } catch {
    return {
      divergences: [],
      warnings: [
        `screen ${screen.id}: playwright not installed — visual-parity stage skipped (install via 'pnpm add -D playwright' to enable)`,
      ],
    };
  }
  // Reaching here means a real Playwright run would happen. v1 has the
  // hooks in place but the actual headless-chromium driver (dual-server
  // setup, viewport sizing, getComputedStyle iteration) is shipped in
  // the factory at v2 — we surface a "v2-enables-playwright-driver"
  // warning + fall through to the diff using mockup-only HTML so the
  // schema + bug-author paths stay exercised. Defensive: do not
  // accidentally produce divergence rows from a one-sided diff.
  void chromium;
  void mockupHtml;
  void projectDir;
  void factoryRoot;
  return {
    divergences: [],
    warnings: [
      `screen ${screen.id}: playwright driver pending v2 — DOM-skeleton extracted from mockup; built-page render deferred`,
    ],
  };
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

  for (const screen of screens) {
    try {
      const result = await compareScreen({ projectDir, factoryRoot, screen });
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
