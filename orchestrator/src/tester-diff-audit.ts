/**
 * Tester diff audit (investigate-023 M-D, ships 2026-05-18).
 *
 * Post-tester mechanical check that scans the test-spec diff for the 6
 * anti-patterns documented in `.claude/rules/testing-policy.md §"Anti-patterns
 * that DISQUALIFY interpretive-latitude excuse — investigate-023"`. When a
 * pattern matches AND the tester DIDN'T flag a corresponding
 * `genuineProductBugs[]` entry, the dispatch is rejected — the tester is
 * forced to either acknowledge the product bug OR remove the suspicious
 * test mutation.
 *
 * Empirical motivator: reading-log-01 /fix-bugs 2026-05-07 ($35.63, 17-of-18
 * "resolved") — manual review surfaced 9+ tests where the tester reshaped
 * the spec to pass against a buggy build instead of flagging the bug.
 * Smoking gun was commit b83e39a (flow-3 spec): tester hardcoded
 * `BOOK_ID = "1001"` (numeric string) when production uses CUIDs because
 * the build's `Number(id)` chokes on CUIDs — the tester literally documented
 * "Numeric-string ID so the detail page's Number(id) conversion works
 * correctly" instead of flagging the type-coercion bug.
 *
 * bug-127 extension: this audit ALSO fires on tester stall-timeout aborts
 * (via the try/finally wrap in `runLlmAgent`'s tester dispatch path). When
 * the tester is killed mid-flight, any uncommitted bug-024 source-file mods
 * + suspicious test mutations still get caught — was: audit only fired on
 * normal completion JSON return, which never happens on stall-timeout.
 */
import { execSync } from "node:child_process";

export type AnitPatternKind =
  | "seed-data-shape"
  | "url-substitution"
  | "assertion-loosening"
  | "removed-assertions"
  | "long-sleep"
  | "type-coercion-fixture";

export interface AuditViolation {
  /** Which of the 6 anti-patterns matched. */
  kind: AnitPatternKind;
  /** File path relative to the worktree root. */
  file: string;
  /** 1-indexed line number in the post-diff state (or 0 when the pattern is "removed assertions" — no positive line). */
  line: number;
  /** ~120-char snippet of the matching line, trimmed. */
  snippet: string;
  /** Why this is suspicious + the right action (per testing-policy.md). */
  rationale: string;
}

export interface AuditTesterDiffOptions {
  /** Worktree path the tester wrote into. */
  worktreePath: string;
  /** Base ref to diff against — typically the merge-base with master OR HEAD~N for the tester's commits. */
  baseRef: string;
  /** True when the tester's return JSON populated genuineProductBugs[]. When true, suspicious patterns are warnings (the tester acknowledged the bug); when false, they're blocking. */
  genuineProductBugsFlagged?: boolean;
  /** Override exec for tests. Default delegates to node:child_process.execSync. */
  execGitDiff?: (worktreePath: string, baseRef: string) => string;
}

export interface AuditTesterDiffResult {
  /** All violations detected (both blocking + warnings). */
  violations: AuditViolation[];
  /** Subset of violations that block the tester dispatch (when genuineProductBugsFlagged === false). */
  blocking: AuditViolation[];
  /** Subset of violations that are warnings (when genuineProductBugsFlagged === true). */
  warnings: AuditViolation[];
}

function defaultExecGitDiff(worktreePath: string, baseRef: string): string {
  // Limit to test-spec files (the tester's allowed paths per
  // .claude/rules/testing-policy.md §"Allowed paths"). bug-024 source-file
  // mods are caught separately by protected-files.ts + reviewer.
  // We diff with `--unified=0` so only changed lines surface (less context noise).
  // Using execSync — synchronous OK because audits run at dispatch boundaries
  // (not in a hot loop) and the diff is bounded.
  const cmd = [
    "git",
    "-c",
    "core.longpaths=true",
    "diff",
    "--unified=0",
    baseRef,
    "--",
    "**/*.test.ts",
    "**/*.test.tsx",
    "**/*.spec.ts",
    "**/*.spec.tsx",
    "**/*.test.py",
    "**/*.spec.py",
    "**/*.test.js",
    "**/*.test.jsx",
    "**/*.spec.js",
    "**/*.spec.jsx",
    "tests/**",
    "e2e/**",
    "**/.maestro/**",
  ].join(" ");
  try {
    return execSync(cmd, {
      cwd: worktreePath,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024, // 64 MB ceiling; tester diffs rarely exceed 1 MB
    });
  } catch (err) {
    // git diff exits 0 even when there are diffs; exit-1 means git itself
    // failed (ref doesn't exist, etc.). Return empty so the audit is a no-op
    // rather than throwing — the caller catches the broader dispatch result.
    void err;
    return "";
  }
}

/**
 * Parse a unified diff into a sequence of (file, line, +/- prefix, content)
 * tuples. We track only ADDED lines (`+` prefix, not the `+++` file header)
 * and track REMOVED `expect(...)` calls for the "removed-assertions" detector.
 * Returns an array — keeps the regex passes simple + cache-friendly.
 */
interface DiffLine {
  file: string;
  /** post-diff 1-indexed line number; 0 for removed lines (no post-diff anchor) */
  line: number;
  added: boolean;
  removed: boolean;
  content: string;
}

function parseUnifiedDiff(diffText: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let currentFile = "";
  let postLine = 0;
  for (const raw of diffText.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      // diff --git a/path b/path — extract the b/ side as the post-diff file.
      const m = raw.match(/^diff --git a\/(.+) b\/(.+)$/);
      currentFile = m?.[2] ?? "";
      postLine = 0;
      continue;
    }
    if (raw.startsWith("+++ ") || raw.startsWith("--- ")) {
      // File headers — already captured the file from `diff --git`; skip.
      continue;
    }
    if (raw.startsWith("@@")) {
      // Hunk header: @@ -<oldStart>,<oldCount> +<newStart>,<newCount> @@
      const m = raw.match(/\+([0-9]+)(?:,([0-9]+))?/);
      if (m) postLine = parseInt(m[1]!, 10);
      continue;
    }
    if (!currentFile) continue;
    if (raw.startsWith("+")) {
      lines.push({
        file: currentFile,
        line: postLine,
        added: true,
        removed: false,
        content: raw.slice(1),
      });
      postLine++;
    } else if (raw.startsWith("-")) {
      lines.push({
        file: currentFile,
        line: 0,
        added: false,
        removed: true,
        content: raw.slice(1),
      });
      // Removed lines don't advance postLine.
    } else if (raw.startsWith(" ")) {
      // Context line — advances postLine but isn't a change.
      postLine++;
    }
  }
  return lines;
}

const SNIPPET_MAX = 120;

function snippet(content: string): string {
  const trimmed = content.trim();
  return trimmed.length > SNIPPET_MAX
    ? `${trimmed.slice(0, SNIPPET_MAX - 1)}…`
    : trimmed;
}

/**
 * Pattern 1 — seed-data-shape manipulation.
 * Detects hardcoded literal IDs in fixture-shaped contexts that look non-CUID
 * / non-UUID (short numeric strings, short alpha-numeric). The empirical
 * smoking gun: `const BOOK_ID = "1001"` (the reading-log-01 incident).
 *
 * Conservative: only flag when the identifier name contains "id" or "ID" or
 * "Id" AND the assigned value is a string of length ≤ 6 OR a number literal.
 * False-positive case (`MAX_ID = "9999"`) is tolerated; the rationale tells
 * the operator to verify.
 */
function detectSeedDataShape(lines: DiffLine[]): AuditViolation[] {
  const out: AuditViolation[] = [];
  // const X_ID = "1234" / let xId = "abc" / X_ID: "1001"
  // Capture identifier name + value.
  const pattern =
    /(?:const|let|var)?\s*([A-Z_][A-Z0-9_]*_ID|[a-zA-Z_]*[iI]d)\s*[:=]\s*["'`]([a-zA-Z0-9-]{1,6})["'`]/;
  const numericPattern =
    /(?:const|let|var)?\s*([A-Z_][A-Z0-9_]*_ID|[a-zA-Z_]*[iI]d)\s*[:=]\s*([0-9]+)\b/;
  for (const l of lines) {
    if (!l.added) continue;
    const m = pattern.exec(l.content) ?? numericPattern.exec(l.content);
    if (!m) continue;
    out.push({
      kind: "seed-data-shape",
      file: l.file,
      line: l.line,
      snippet: snippet(l.content),
      rationale: `Hardcoded short literal ID (${m[2]}) assigned to ${m[1]}. If production IDs are CUID/UUID-shaped (e.g. \"cmovsn7vw...\"), the build's Number(id) / String(id) may behave correctly on short IDs but fail on real ones. Verify the format matches production data — if it doesn't, flag as genuineProductBugs[] instead of seed-shaping the fixture.`,
    });
  }
  return out;
}

/**
 * Pattern 2 — URL substitution.
 * Detects diff lines that change the URL string inside toHaveURL / expect-
 * url / href assertions. The empirical case: spec expects /books/<id> after
 * book creation; tester "fixes" to expect /books because the build redirects
 * incorrectly.
 *
 * Conservative: only flag when the SAME diff hunk has both `-` and `+` lines
 * touching toHaveURL / .href / routePattern.
 */
function detectUrlSubstitution(lines: DiffLine[]): AuditViolation[] {
  const out: AuditViolation[] = [];
  const urlPattern = /toHaveURL\s*\(|expect\([^)]*url[^)]*\)|\.href\s*[=,)]/i;
  // Pair up removed + added lines on the same file when both match the URL pattern.
  const byFile = new Map<string, { removed: DiffLine[]; added: DiffLine[] }>();
  for (const l of lines) {
    if (!l.added && !l.removed) continue;
    if (!urlPattern.test(l.content)) continue;
    const slot = byFile.get(l.file) ?? { removed: [], added: [] };
    if (l.added) slot.added.push(l);
    else slot.removed.push(l);
    byFile.set(l.file, slot);
  }
  for (const [, slot] of byFile) {
    // Heuristic: if both removed + added URL lines exist in the same file's
    // diff, it's likely a substitution. Flag each added line.
    if (slot.removed.length > 0 && slot.added.length > 0) {
      for (const l of slot.added) {
        out.push({
          kind: "url-substitution",
          file: l.file,
          line: l.line,
          snippet: snippet(l.content),
          rationale:
            "URL string inside a toHaveURL / href assertion was changed (paired with a removed URL line in the same file's diff). If the build's URL differs from the spec, that's a routing bug — flag as genuineProductBugs[] instead of rewriting the expected URL.",
        });
      }
    }
  }
  return out;
}

/**
 * Pattern 3 — assertion loosening.
 * Detects `toBe(x)` / `toEqual(x)` being swapped for `toBeDefined()` /
 * `toBeTruthy()` / `toBeFalsy()` / `not.toBeUndefined()`. Same diff hunk
 * has a removed strong assertion + an added loose one.
 */
function detectAssertionLoosening(lines: DiffLine[]): AuditViolation[] {
  const out: AuditViolation[] = [];
  const strongRemoved =
    /\.(toBe|toEqual|toStrictEqual|toHaveText|toContainEqual)\s*\(/;
  const looseAdded =
    /\.(toBeDefined|toBeTruthy|toBeFalsy|toBeNull|toBeUndefined)\s*\(|\.not\.toBeUndefined\s*\(/;
  const byFile = new Map<string, { removed: DiffLine[]; added: DiffLine[] }>();
  for (const l of lines) {
    if (!l.added && !l.removed) continue;
    const matches = l.added
      ? looseAdded.test(l.content)
      : strongRemoved.test(l.content);
    if (!matches) continue;
    const slot = byFile.get(l.file) ?? { removed: [], added: [] };
    if (l.added) slot.added.push(l);
    else slot.removed.push(l);
    byFile.set(l.file, slot);
  }
  for (const [, slot] of byFile) {
    if (slot.removed.length > 0 && slot.added.length > 0) {
      for (const l of slot.added) {
        out.push({
          kind: "assertion-loosening",
          file: l.file,
          line: l.line,
          snippet: snippet(l.content),
          rationale:
            "Assertion loosened (strong matcher removed + loose matcher added in the same file's diff). If the build emits an unexpected value, that's a product bug — flag as genuineProductBugs[] instead of relaxing the test.",
        });
      }
    }
  }
  return out;
}

/**
 * Pattern 4 — removed assertions.
 * Detects net negative `expect(...)` calls — strong-removed > strong-added.
 * Flagged at the file level (no specific line) when the net delta is < 0.
 */
function detectRemovedAssertions(lines: DiffLine[]): AuditViolation[] {
  const out: AuditViolation[] = [];
  const expectCall = /\bexpect\s*\(/;
  const perFile = new Map<
    string,
    {
      addCount: number;
      removeCount: number;
      firstAdd: DiffLine | null;
      firstRemove: DiffLine | null;
    }
  >();
  for (const l of lines) {
    if (!l.added && !l.removed) continue;
    if (!expectCall.test(l.content)) continue;
    const slot = perFile.get(l.file) ?? {
      addCount: 0,
      removeCount: 0,
      firstAdd: null,
      firstRemove: null,
    };
    if (l.added) {
      slot.addCount++;
      slot.firstAdd = slot.firstAdd ?? l;
    } else {
      slot.removeCount++;
      slot.firstRemove = slot.firstRemove ?? l;
    }
    perFile.set(l.file, slot);
  }
  for (const [file, slot] of perFile) {
    if (slot.removeCount > slot.addCount) {
      const anchor = slot.firstRemove!;
      out.push({
        kind: "removed-assertions",
        file,
        line: 0,
        snippet: `[net ${slot.removeCount - slot.addCount} expect() removed] ${snippet(anchor.content)}`,
        rationale: `${slot.removeCount} expect() call(s) removed, only ${slot.addCount} added — net loss of test coverage. If the build can't satisfy the assertions, that's a product bug — flag as genuineProductBugs[] instead of deleting the expect() calls.`,
      });
    }
  }
  return out;
}

/**
 * Pattern 5 — long-sleep race workaround.
 * Detects added `page.waitForTimeout(N)` / `sleep(N)` / `setTimeout(..., N)`
 * where N > 1000ms. Anything ≤ 1000ms is genuine async-settle; above that
 * is race-masking.
 */
function detectLongSleep(lines: DiffLine[]): AuditViolation[] {
  const out: AuditViolation[] = [];
  const sleepPattern =
    /(?:waitForTimeout|sleep|setTimeout)\s*\(\s*(?:[^,)]*,\s*)?([0-9_]+)/;
  for (const l of lines) {
    if (!l.added) continue;
    const m = sleepPattern.exec(l.content);
    if (!m) continue;
    const ms = parseInt(m[1]!.replace(/_/g, ""), 10);
    if (Number.isNaN(ms) || ms <= 1000) continue;
    out.push({
      kind: "long-sleep",
      file: l.file,
      line: l.line,
      snippet: snippet(l.content),
      rationale: `Long sleep (${ms}ms > 1000ms) likely masks a product timing bug. If the test races a real bug, that's a product bug — flag as genuineProductBugs[] instead of waiting it out. (Sleeps ≤ 1000ms for genuine async settle are fine.)`,
    });
  }
  return out;
}

/**
 * Pattern 6 — type-coercion fixture.
 * Detects added `Number(...)` / `parseInt(...)` / `String(...)` calls in test
 * files. The empirical case: tester wraps a fixture ID with Number() to make
 * the build's Number(id)-on-CUID code path work — masking the type bug.
 */
function detectTypeCoercionFixture(lines: DiffLine[]): AuditViolation[] {
  const out: AuditViolation[] = [];
  const coercionPattern =
    /\b(Number|parseInt|parseFloat|String)\s*\(\s*(?:["'`][a-zA-Z0-9_-]+["'`]|[a-zA-Z_$][a-zA-Z0-9_$]*(?:[Ii][Dd]|_ID)\b)/;
  for (const l of lines) {
    if (!l.added) continue;
    const m = coercionPattern.exec(l.content);
    if (!m) continue;
    out.push({
      kind: "type-coercion-fixture",
      file: l.file,
      line: l.line,
      snippet: snippet(l.content),
      rationale: `Type-coercion call (${m[1]}(...)) on an ID-shaped value. If the build's code path requires this coercion to work, that's a type bug in the build — flag as genuineProductBugs[] instead of adding the coercion to the fixture.`,
    });
  }
  return out;
}

export function auditTesterDiff(
  opts: AuditTesterDiffOptions,
): AuditTesterDiffResult {
  const exec = opts.execGitDiff ?? defaultExecGitDiff;
  const diffText = exec(opts.worktreePath, opts.baseRef);
  const lines = parseUnifiedDiff(diffText);

  const violations: AuditViolation[] = [
    ...detectSeedDataShape(lines),
    ...detectUrlSubstitution(lines),
    ...detectAssertionLoosening(lines),
    ...detectRemovedAssertions(lines),
    ...detectLongSleep(lines),
    ...detectTypeCoercionFixture(lines),
  ];

  const isFlagged = opts.genuineProductBugsFlagged === true;
  const blocking = isFlagged ? [] : violations;
  const warnings = isFlagged ? violations : [];

  return { violations, blocking, warnings };
}

/**
 * Format violations for inclusion in error messages / retry context. One
 * line per violation. Numbered.
 */
export function formatViolations(
  violations: readonly AuditViolation[],
): string {
  if (violations.length === 0) return "";
  return violations
    .map((v, i) => {
      const loc = v.line > 0 ? `${v.file}:${v.line}` : v.file;
      return `  ${i + 1}. [${v.kind}] ${loc} — ${v.snippet}\n     ${v.rationale}`;
    })
    .join("\n");
}
