#!/usr/bin/env node
// scripts/audit-computed-styles.mjs — feat-028 Phase 3.
//
// Computed-style audit: for a curated selector list (the page-root +
// AppShell containers + every `[data-kit-component]`), capture
// `getComputedStyle()` snapshots from BOTH the mockup HTML and the built
// page, then diff with per-property tolerance. Catches the
// "token-drift", "spacing-token-drift", and "copy-sizing-drift" patterns
// from investigate-009 that pure DOM-skeleton diffing misses (the kit
// primitives are present + correctly named, but their tokens render
// differently).
//
// The actual `getComputedStyle()` capture lives in the Playwright wrapper
// (orchestrator/src/parity-verify.ts) — this file owns the curated
// property list, the per-property tolerance rules, and the diff itself.
// Pure functions; no Playwright import. This keeps the file dependency-
// free + sub-100ms-per-diff, mirrors `diff-kit-skeleton.mjs`'s shape.
//
// Usage (programmatic):
//   import {
//     CURATED_PROPERTIES,
//     diffComputedStyles,
//     classifyStyleDivergence,
//   } from "./audit-computed-styles.mjs";
//   const drifts = diffComputedStyles({ mockupSnapshot, builtSnapshot });
//
// Usage (CLI — debug only; reads two snapshot JSON files):
//   node scripts/audit-computed-styles.mjs <mockup-snap.json> <built-snap.json> [screenId]

import fs from "node:fs";

// ─── Curated property list ──────────────────────────────────────────────────
//
// We deliberately do NOT diff every CSS property — too noisy. The curated
// list captures the high-signal properties that map to design-token
// authority (color, font, spacing, radius). Per investigate-009 these are
// where 80% of the kanban-10 token drift surfaced.

export const CURATED_PROPERTIES = Object.freeze([
  // color tokens
  "color",
  "background-color",
  "border-color",
  "border-top-color",
  "border-bottom-color",
  // typography tokens
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  // spacing tokens
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "gap",
  "row-gap",
  "column-gap",
  // shape tokens
  "border-radius",
  "border-width",
  // layout flags (not tokens but explain layout-regrouping)
  "display",
  "flex-direction",
  "justify-content",
  "align-items",
]);

// Per-property tolerance: numeric properties tolerate ±1px drift (rounding
// noise from Tailwind's rem→px conversion across viewports). Color +
// font-family + display flags are exact-match.
const PIXEL_PROPERTIES = new Set([
  "font-size",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "gap",
  "row-gap",
  "column-gap",
  "border-radius",
  "border-width",
]);

const PIXEL_TOLERANCE = 1;

// ─── Snapshot shape ─────────────────────────────────────────────────────────
//
// A snapshot is `{ [selector]: { [property]: value } }`. The Playwright
// wrapper produces these by iterating over the curated selector list +
// invoking `getComputedStyle(node).getPropertyValue(prop)` per cell.
//
// For unit testing we synthesize them inline — that's the entire point of
// keeping this file Playwright-free.

/**
 * @typedef {Record<string, Record<string, string>>} ComputedStyleSnapshot
 */

/**
 * Parse a "12px" / "1.5rem" / "0" value into a pixel number, OR return
 * null if the value can't be reduced (e.g. "auto", "inherit"). For the
 * tolerance check we ONLY care about numeric matches — categorical
 * mismatches (e.g. "auto" vs "0px") still surface as drift.
 */
function parsePixelValue(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (trimmed === "0" || trimmed === "0px" || trimmed === "0rem") return 0;
  const m = trimmed.match(/^(-?\d+(?:\.\d+)?)(px|rem|em)?$/);
  if (!m) return null;
  const num = Number(m[1]);
  const unit = m[2] ?? "px";
  if (Number.isNaN(num)) return null;
  // Treat rem as 16px (the Tailwind default — the kit doesn't override
  // root font size). Em is context-dependent so we treat it the same;
  // imprecise but the tolerance check absorbs the noise.
  if (unit === "rem" || unit === "em") return num * 16;
  return num;
}

/**
 * Decide whether two values for `property` are equivalent within tolerance.
 * Returns true when they should NOT be flagged as drift.
 */
export function valuesEquivalent(property, mockupValue, builtValue) {
  if (mockupValue === builtValue) return true;
  if (mockupValue == null || builtValue == null) return false;
  if (PIXEL_PROPERTIES.has(property)) {
    const m = parsePixelValue(mockupValue);
    const b = parsePixelValue(builtValue);
    if (m == null || b == null) return false;
    return Math.abs(m - b) <= PIXEL_TOLERANCE;
  }
  // Color + font-family: normalise whitespace + case but otherwise exact.
  if (
    property === "font-family" ||
    property === "color" ||
    property.endsWith("color")
  ) {
    return (
      String(mockupValue).replace(/\s+/g, "").toLowerCase() ===
      String(builtValue).replace(/\s+/g, "").toLowerCase()
    );
  }
  return false;
}

// ─── Diff core ───────────────────────────────────────────────────────────────

/**
 * Diff two computed-style snapshots. For each selector present in BOTH,
 * compare every curated property; emit one `styleDrift` row per
 * (selector, property) mismatch.
 *
 * @param {{ mockupSnapshot: ComputedStyleSnapshot, builtSnapshot: ComputedStyleSnapshot }} args
 * @returns {{
 *   styleDrift: { selector: string, property: string, mockupValue: string, builtValue: string }[],
 *   selectorsCompared: number,
 *   missingInBuilt: string[],     // selector existed in mockup snapshot but built had no entry
 * }}
 */
export function diffComputedStyles({ mockupSnapshot, builtSnapshot }) {
  /** @type {{ selector: string, property: string, mockupValue: string, builtValue: string }[]} */
  const styleDrift = [];
  /** @type {string[]} */
  const missingInBuilt = [];
  let selectorsCompared = 0;

  for (const [selector, mockupProps] of Object.entries(mockupSnapshot)) {
    const builtProps = builtSnapshot[selector];
    if (!builtProps) {
      missingInBuilt.push(selector);
      continue;
    }
    selectorsCompared += 1;
    for (const prop of CURATED_PROPERTIES) {
      const mockupValue = mockupProps[prop];
      const builtValue = builtProps[prop];
      // Skip when both sides are absent (snapshot didn't capture the prop)
      if (mockupValue == null && builtValue == null) continue;
      if (!valuesEquivalent(prop, mockupValue, builtValue)) {
        styleDrift.push({
          selector,
          property: prop,
          mockupValue: mockupValue ?? "(absent)",
          builtValue: builtValue ?? "(absent)",
        });
      }
    }
  }

  return { styleDrift, selectorsCompared, missingInBuilt };
}

// ─── Pattern classification ──────────────────────────────────────────────────
//
// Mirror of `diff-kit-skeleton.mjs#classifyDivergence` for the style-drift
// case. The emitted divergences slot into the same `ParityDivergence`
// shape; the orchestrator merges per-(screen, pattern) tuple before
// bug-author runs.

const COLOR_PROPERTIES = new Set([
  "color",
  "background-color",
  "border-color",
  "border-top-color",
  "border-bottom-color",
]);

const TYPOGRAPHY_PROPERTIES = new Set([
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
]);

const SPACING_PROPERTIES = new Set([
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "gap",
  "row-gap",
  "column-gap",
]);

/**
 * Classify each style-drift entry into a pattern bucket. Returns
 * `ParityDivergence`-shaped rows.
 *
 * @param {string} screenId
 * @param {{ styleDrift: { selector: string, property: string, mockupValue: string, builtValue: string }[] }} diff
 */
export function classifyStyleDivergence(screenId, diff) {
  /** @type {Map<string, { styleDrift: typeof diff.styleDrift, severity: "P0"|"P1"|"P2" }>} */
  const buckets = new Map();

  function bucket(pattern, severity = "P1") {
    let b = buckets.get(pattern);
    if (!b) {
      b = { styleDrift: [], severity };
      buckets.set(pattern, b);
    }
    return b;
  }

  for (const drift of diff.styleDrift) {
    if (
      COLOR_PROPERTIES.has(drift.property) ||
      drift.property === "border-radius" ||
      drift.property === "border-width"
    ) {
      bucket("token-drift").styleDrift.push(drift);
    } else if (TYPOGRAPHY_PROPERTIES.has(drift.property)) {
      // font-size mismatches usually indicate copy-sizing drift; family /
      // weight / leading land in the same bucket because the bug-plan fix
      // is the same: re-bind to kit token.
      bucket("copy-sizing-drift").styleDrift.push(drift);
    } else if (SPACING_PROPERTIES.has(drift.property)) {
      bucket("spacing-token-drift").styleDrift.push(drift);
    } else {
      // display / flex flags → layout-regrouping
      bucket("layout-regrouping").styleDrift.push(drift);
    }
  }

  return [...buckets.entries()].map(([pattern, b]) => ({
    screen: screenId,
    pattern,
    detail: {
      missing: [],
      extra: [],
      variantDrift: [],
      styleDrift: b.styleDrift,
    },
    severity: b.severity,
  }));
}

/**
 * Convenience wrapper: diff + classify in one call.
 *
 * @param {{
 *   screenId: string,
 *   mockupSnapshot: ComputedStyleSnapshot,
 *   builtSnapshot: ComputedStyleSnapshot,
 * }} args
 */
export function auditAndClassify({ screenId, mockupSnapshot, builtSnapshot }) {
  const diff = diffComputedStyles({ mockupSnapshot, builtSnapshot });
  return {
    diff,
    divergences: classifyStyleDivergence(screenId, diff),
  };
}

// ─── CLI mode (debug only) ───────────────────────────────────────────────────

if (
  process.argv[1] &&
  (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` ||
    import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`)
) {
  const [, , mockupSnapPath, builtSnapPath, screenId = "unknown"] =
    process.argv;
  if (!mockupSnapPath || !builtSnapPath) {
    console.error(
      "usage: node scripts/audit-computed-styles.mjs <mockup-snap.json> <built-snap.json> [screenId]",
    );
    process.exit(2);
  }
  const mockupSnapshot = JSON.parse(fs.readFileSync(mockupSnapPath, "utf8"));
  const builtSnapshot = JSON.parse(fs.readFileSync(builtSnapPath, "utf8"));
  const { diff, divergences } = auditAndClassify({
    screenId,
    mockupSnapshot,
    builtSnapshot,
  });
  console.log(
    JSON.stringify(
      {
        screenId,
        selectorsCompared: diff.selectorsCompared,
        missingInBuilt: diff.missingInBuilt,
        styleDriftCount: diff.styleDrift.length,
        divergences,
      },
      null,
      2,
    ),
  );
}
