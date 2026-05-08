// feat-063 (2026-05-08) — Pre-loaded bug-fix dispatch context.
//
// Per investigate-024 §F1 + §F3, the per-bug dispatch envelope ships
// ~2-3K tokens of generic context (system prompt + 1-line bug summary
// + short retry context) but ZERO bug-specific files. The agent then
// spends 5-10 exploratory Read/Grep/Bash turns discovering the
// synthesized spec, mockup HTML, fix-site files, and manifest data
// before it can plan a fix. Each turn is 15-25 min wall-clock.
//
// This module reads the right files based on `bug.source` + emits a
// markdown block ready to inject into the agent prompt before the
// task lines. The dispatch envelope grows from ~2-3K → ~10-15K tokens
// (well within Sonnet's 200K context).
//
// Cross-references:
//   - plans/active/investigate-024-bug-fix-dispatch-efficiency.md §F1+F3 (load-bearing findings)
//   - plans/active/feat-063-pre-loaded-bug-fix-context.md (this plan)
//   - orchestrator/src/fix-bugs-loop.ts::dispatchAgentsForBug (caller)
//   - orchestrator/src/invoke-agent.ts::buildAgentPrompt (consumer)

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BugEntry } from "@repo/orchestrator-contracts";

/** Result shape from the envelope builder. */
export interface BugContextEnvelope {
  /** Multi-line markdown ready to inject into the agent prompt. */
  text: string;
  /** Diagnostic — which files were resolved + why + how many lines. */
  resolvedFiles: { path: string; reason: string; loc: number }[];
  /** Diagnostic — which expected files were missing. */
  missingFiles: { path: string; reason: string }[];
}

/**
 * Cap each file's pre-loaded content at 200 lines. Files larger than
 * this get truncated with a `[... N lines truncated]` marker so the
 * envelope stays under ~15K tokens for typical 5-8 file pre-loads.
 */
const MAX_LINES_PER_FILE = 200;

/** Soft cap on total envelope output to prevent runaway pre-loads. */
const MAX_ENVELOPE_LINES = 1200;

/**
 * Read a file safely + truncate to MAX_LINES_PER_FILE. Returns null if
 * the file doesn't exist or can't be read (the caller decides whether
 * to mark this as a `missingFiles` entry).
 */
function readFileTruncated(
  absPath: string,
): { content: string; loc: number } | null {
  if (!existsSync(absPath)) return null;
  let raw: string;
  try {
    raw = readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
  const lines = raw.split(/\r?\n/);
  const loc = lines.length;
  if (loc <= MAX_LINES_PER_FILE) return { content: raw, loc };
  const head = lines.slice(0, MAX_LINES_PER_FILE).join("\n");
  return {
    content: `${head}\n[... ${loc - MAX_LINES_PER_FILE} lines truncated]`,
    loc,
  };
}

/**
 * Detect the file extension's fenced-code language for markdown
 * formatting. Returns "" for unknown extensions (renders as a plain
 * fenced block).
 */
function langForExt(path: string): string {
  if (/\.tsx?$/.test(path)) return "typescript";
  if (/\.jsx?$/.test(path)) return "javascript";
  if (/\.json$/.test(path)) return "json";
  if (/\.ya?ml$/.test(path)) return "yaml";
  if (/\.html?$/.test(path)) return "html";
  if (/\.css$/.test(path)) return "css";
  if (/\.py$/.test(path)) return "python";
  if (/\.md$/.test(path)) return "markdown";
  if (/\.prisma$/.test(path)) return "prisma";
  return "";
}

/**
 * Format one resolved file as a markdown section + return its line
 * count for the diagnostic.
 */
function emitFileSection(args: {
  relPath: string;
  absPath: string;
  reason: string;
  resolved: BugContextEnvelope["resolvedFiles"];
  missing: BugContextEnvelope["missingFiles"];
}): string {
  const read = readFileTruncated(args.absPath);
  if (!read) {
    args.missing.push({ path: args.relPath, reason: args.reason });
    return "";
  }
  args.resolved.push({
    path: args.relPath,
    reason: args.reason,
    loc: read.loc,
  });
  const lang = langForExt(args.relPath);
  const lines: string[] = [];
  lines.push(`### ${args.reason}: ${args.relPath}`);
  lines.push("");
  lines.push("```" + lang);
  lines.push(read.content);
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

/**
 * Per-class file resolution. Each branch returns an array of
 * `{ relPath, reason }` tuples that the envelope builder reads + emits.
 *
 * Heuristics aim for the 2-3 most-likely files per class. Wider
 * exploration is the agent's job — the orchestrator's pre-load
 * shortcuts the discovery step, not the entire investigation.
 */
function resolveFilesForBug(
  bug: BugEntry,
): { relPath: string; reason: string }[] {
  const out: { relPath: string; reason: string }[] = [];

  if (bug.source === "flow-execution-failure" && bug.flow) {
    // Pre-load the synthesized spec — the canonical signal of what's
    // expected. Builder reads this first to understand the failing
    // interaction.
    out.push({
      relPath: `apps/web/e2e/synthesized/${bug.flow.id}.spec.ts`,
      reason: "Failing synthesized spec",
    });
    // Pre-load the user-flows-manifest entry for this flow — gives
    // the requiredState block that drives feat-050 seeding.
    out.push({
      relPath: "docs/user-flows-manifest.json",
      reason: "User-flows manifest (find this flow's requiredState)",
    });
  }

  if (bug.source === "visual-parity" && bug.parity) {
    // Pre-load the mockup — the structural ground truth for the parity
    // comparison. Per the testing-policy, mockups live at
    // `docs/screens/{platform}/{screen}.html`. Default platform is
    // "webapp" for web projects (architecture.yaml-driven in future).
    out.push({
      relPath: `docs/screens/webapp/${bug.parity.screen}.html`,
      reason: "Mockup (structural ground truth)",
    });
    // feat-063-followup (2026-05-08) — empirical evidence on reading-log-02:
    // many screen-ids don't map to a `apps/web/app/<screen>/page.tsx` path:
    //   - book-create → opens as Modal from /page.tsx (no /book-create route)
    //   - book-detail → at /books/[id]/page.tsx (dynamic route)
    //   - books-list-empty → empty-state branch in /page.tsx
    //   - tags-manage → at /tags/page.tsx (different slug)
    //   - settings → /settings/page.tsx (matches)
    // Without these fallbacks, bug-fixer received a "file missing"
    // diagnostic + no real fix-site → ran maxTurns:8 trying to find
    // the right file → bailed empty-merge.
    //
    // Multi-path heuristic: include several likely candidates in
    // priority order. emitFileSection silently drops missing files +
    // logs them in the diagnostic block, so over-specifying is cheap.
    const screen = bug.parity.screen;
    out.push({
      relPath: `apps/web/app/${screen}/page.tsx`,
      reason: "Likely fix-site #1 (route-named page)",
    });
    out.push({
      relPath: "apps/web/app/page.tsx",
      reason: "Likely fix-site #2 (index page — common host for sub-screens / empty-states)",
    });
    // Component-named-after-screen: book-list-item, book-create-modal,
    // tag-rename-modal, etc. Bug-fixer can Read more siblings if the
    // first guess misses.
    out.push({
      relPath: `apps/web/components/books/${screen}.tsx`,
      reason: "Likely fix-site #3 (component named after screen)",
    });
  }

  if (bug.source === "reachability-orphan" && bug.orphan) {
    // Pre-load the orphan file itself — the agent needs to see what's
    // exported + how it's shaped to wire it correctly.
    out.push({
      relPath: bug.orphan.componentPath,
      reason: "Orphan component (needs wiring)",
    });
    // Pre-load up to 3 suggested importers — likely insertion sites.
    for (const importer of (bug.orphan.suggestedImporters ?? []).slice(0, 3)) {
      out.push({
        relPath: importer,
        reason: "Suggested importer",
      });
    }
  }

  // dev-server-compile + runtime-error + build-gap: no deterministic
  // fix-site heuristic without parsing the verifier's stderr. The
  // stderrTail already lives in bug.errorLog; the agent can read it
  // there. Pre-loading is deferred to a follow-up that adds
  // stderr-aware file resolution.

  return out;
}

/**
 * Build a pre-loaded context envelope for a bug dispatch.
 *
 * Resolves per-class files, reads them (truncating large ones), and
 * emits a markdown block ready to inject into the agent prompt. Returns
 * an empty `text` (back-compat) when no files apply or none could be
 * read.
 */
export function buildBugContextEnvelope(args: {
  bug: BugEntry;
  projectRoot: string;
}): BugContextEnvelope {
  const { bug, projectRoot } = args;
  const resolved: BugContextEnvelope["resolvedFiles"] = [];
  const missing: BugContextEnvelope["missingFiles"] = [];

  const targets = resolveFilesForBug(bug);
  if (targets.length === 0) {
    return { text: "", resolvedFiles: [], missingFiles: [] };
  }

  const sections: string[] = [];
  for (const target of targets) {
    const absPath = join(projectRoot, target.relPath);
    const section = emitFileSection({
      relPath: target.relPath,
      absPath,
      reason: target.reason,
      resolved,
      missing,
    });
    if (section) sections.push(section);
  }

  if (sections.length === 0 && missing.length === 0) {
    // Nothing resolved + nothing tried — back-compat empty envelope.
    return { text: "", resolvedFiles: [], missingFiles: [] };
  }

  // Diagnostic block at the end so the agent knows what was attempted.
  const diagnosticLines: string[] = [];
  diagnosticLines.push("### Pre-load diagnostic");
  diagnosticLines.push("");
  for (const r of resolved) {
    diagnosticLines.push(`- ✓ \`${r.path}\` (${r.loc} lines) — ${r.reason}`);
  }
  for (const m of missing) {
    diagnosticLines.push(`- ✗ \`${m.path}\` (file missing) — ${m.reason}`);
  }

  const header: string[] = [
    "## Pre-loaded bug context",
    "",
    "The orchestrator pre-loaded the files below so you don't need to discover them via Read/Grep. Read additional files only if these don't have the answer.",
    "",
  ];

  let text = [...header, ...sections, ...diagnosticLines, ""].join("\n");

  // Soft envelope cap: if we somehow exceed MAX_ENVELOPE_LINES, truncate
  // tail-wise + add a marker. Defense-in-depth — per-file caps should
  // already keep us under this, but a 5-importer reachability-orphan
  // bug could in theory push past.
  const lineCount = text.split(/\r?\n/).length;
  if (lineCount > MAX_ENVELOPE_LINES) {
    const head = text.split(/\r?\n/).slice(0, MAX_ENVELOPE_LINES).join("\n");
    text = `${head}\n\n[... envelope truncated at ${MAX_ENVELOPE_LINES} lines (orig ${lineCount}); ${lineCount - MAX_ENVELOPE_LINES} lines dropped]\n`;
  }

  return { text, resolvedFiles: resolved, missingFiles: missing };
}
