import { describe, expect, it } from "vitest";
import {
  auditTesterDiff,
  formatViolations,
  type AuditViolation,
} from "../src/tester-diff-audit.js";

/**
 * Tests for orchestrator/src/tester-diff-audit.ts (investigate-023 M-D).
 *
 * Each test crafts a synthetic unified-diff string + injects it via the
 * execGitDiff override, then asserts the 6 anti-pattern detectors fire (or
 * don't fire) per spec. No real git fixture needed — the diff parser is the
 * unit under test.
 */

function mkDiff(file: string, removed: string[], added: string[]): string {
  // Synthetic unified diff with --unified=0 shape — single hunk per file.
  const removedBlock = removed.map((l) => `-${l}`).join("\n");
  const addedBlock = added.map((l) => `+${l}`).join("\n");
  return [
    `diff --git a/${file} b/${file}`,
    `index 0000000..1111111 100644`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -10,${removed.length} +10,${added.length} @@`,
    removedBlock,
    addedBlock,
  ]
    .filter(Boolean)
    .join("\n");
}

function audit(diffText: string, flagged = false) {
  return auditTesterDiff({
    worktreePath: "/tmp/fake",
    baseRef: "HEAD~1",
    genuineProductBugsFlagged: flagged,
    execGitDiff: () => diffText,
  });
}

describe("tester-diff-audit — pattern 1: seed-data-shape", () => {
  it('flags const BOOK_ID = "1001" (reading-log-01 smoking gun)', () => {
    const diff = mkDiff(
      "apps/web/e2e/flow-3.spec.ts",
      [],
      [`const BOOK_ID = "1001";`, `await page.goto(\`/books/\${BOOK_ID}\`);`],
    );
    const result = audit(diff);
    expect(result.violations.length).toBeGreaterThanOrEqual(1);
    expect(result.violations[0]?.kind).toBe("seed-data-shape");
    expect(result.violations[0]?.file).toBe("apps/web/e2e/flow-3.spec.ts");
    expect(result.blocking).toHaveLength(result.violations.length);
  });

  it("flags numeric ID assigned to userId", () => {
    const diff = mkDiff("tests/foo.test.ts", [], [`const userId = 42;`]);
    const result = audit(diff);
    expect(result.violations.some((v) => v.kind === "seed-data-shape")).toBe(
      true,
    );
  });

  it("does NOT flag CUID-shaped fixture", () => {
    const diff = mkDiff(
      "tests/foo.test.ts",
      [],
      [`const id = "cmovsn7vwabc123def456";`],
    );
    const result = audit(diff);
    expect(
      result.violations.filter((v) => v.kind === "seed-data-shape"),
    ).toEqual([]);
  });

  it("downgrades to warning when genuineProductBugsFlagged=true", () => {
    const diff = mkDiff("tests/foo.test.ts", [], [`const userId = 42;`]);
    const result = audit(diff, true);
    expect(result.violations.length).toBeGreaterThanOrEqual(1);
    expect(result.blocking).toEqual([]);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
  });
});

describe("tester-diff-audit — pattern 2: url-substitution", () => {
  it("flags toHaveURL string change", () => {
    const diff = mkDiff(
      "apps/web/e2e/redirect.spec.ts",
      [`await expect(page).toHaveURL(/^\\/books\\/\\d+/);`],
      [`await expect(page).toHaveURL("/books");`],
    );
    const result = audit(diff);
    expect(result.violations.some((v) => v.kind === "url-substitution")).toBe(
      true,
    );
  });

  it("does NOT flag toHaveURL when only added (no paired removal)", () => {
    const diff = mkDiff(
      "tests/new.test.ts",
      [],
      [`await expect(page).toHaveURL("/dashboard");`],
    );
    const result = audit(diff);
    expect(
      result.violations.filter((v) => v.kind === "url-substitution"),
    ).toEqual([]);
  });
});

describe("tester-diff-audit — pattern 3: assertion-loosening", () => {
  it("flags toBe → toBeDefined swap", () => {
    const diff = mkDiff(
      "tests/api.test.ts",
      [`expect(result.id).toBe("expected-id");`],
      [`expect(result.id).toBeDefined();`],
    );
    const result = audit(diff);
    expect(
      result.violations.some((v) => v.kind === "assertion-loosening"),
    ).toBe(true);
  });

  it("flags toEqual → toBeTruthy swap", () => {
    const diff = mkDiff(
      "tests/api.test.ts",
      [`expect(payload).toEqual({ status: "ok" });`],
      [`expect(payload).toBeTruthy();`],
    );
    const result = audit(diff);
    expect(
      result.violations.some((v) => v.kind === "assertion-loosening"),
    ).toBe(true);
  });

  it("does NOT flag toBeDefined when no strong assertion was removed", () => {
    const diff = mkDiff("tests/new.test.ts", [], [`expect(x).toBeDefined();`]);
    const result = audit(diff);
    expect(
      result.violations.filter((v) => v.kind === "assertion-loosening"),
    ).toEqual([]);
  });
});

describe("tester-diff-audit — pattern 4: removed-assertions", () => {
  it("flags net negative expect() calls", () => {
    const diff = mkDiff(
      "tests/foo.test.ts",
      [`expect(a).toBe(1);`, `expect(b).toBe(2);`, `expect(c).toBe(3);`],
      [`expect(a).toBe(1);`],
    );
    const result = audit(diff);
    expect(result.violations.some((v) => v.kind === "removed-assertions")).toBe(
      true,
    );
  });

  it("does NOT flag when expect() count grows", () => {
    const diff = mkDiff(
      "tests/foo.test.ts",
      [`expect(a).toBe(1);`],
      [`expect(a).toBe(1);`, `expect(b).toBe(2);`],
    );
    const result = audit(diff);
    expect(
      result.violations.filter((v) => v.kind === "removed-assertions"),
    ).toEqual([]);
  });
});

describe("tester-diff-audit — pattern 5: long-sleep", () => {
  it("flags page.waitForTimeout(5000)", () => {
    const diff = mkDiff(
      "apps/web/e2e/spec.ts",
      [],
      [`await page.waitForTimeout(5000);`],
    );
    const result = audit(diff);
    expect(result.violations.some((v) => v.kind === "long-sleep")).toBe(true);
  });

  it("does NOT flag waitForTimeout(500)", () => {
    const diff = mkDiff("e2e/spec.ts", [], [`await page.waitForTimeout(500);`]);
    const result = audit(diff);
    expect(result.violations.filter((v) => v.kind === "long-sleep")).toEqual(
      [],
    );
  });

  it("flags sleep(3000)", () => {
    const diff = mkDiff("tests/foo.test.ts", [], [`await sleep(3000);`]);
    const result = audit(diff);
    expect(result.violations.some((v) => v.kind === "long-sleep")).toBe(true);
  });
});

describe("tester-diff-audit — pattern 6: type-coercion-fixture", () => {
  it("flags Number(BOOK_ID)", () => {
    const diff = mkDiff(
      "tests/foo.test.ts",
      [],
      [`const numericId = Number(BOOK_ID);`],
    );
    const result = audit(diff);
    expect(
      result.violations.some((v) => v.kind === "type-coercion-fixture"),
    ).toBe(true);
  });

  it("flags parseInt(userId)", () => {
    const diff = mkDiff("tests/foo.test.ts", [], [`return parseInt(userId);`]);
    const result = audit(diff);
    expect(
      result.violations.some((v) => v.kind === "type-coercion-fixture"),
    ).toBe(true);
  });

  it("flags Number on a literal id-shaped string", () => {
    const diff = mkDiff("tests/foo.test.ts", [], [`Number("abc-123-id");`]);
    const result = audit(diff);
    expect(
      result.violations.some((v) => v.kind === "type-coercion-fixture"),
    ).toBe(true);
  });

  it("does NOT flag Number on an obviously-numeric expression", () => {
    const diff = mkDiff(
      "tests/foo.test.ts",
      [],
      [`const total = sum.reduce((a, b) => a + b);`],
    );
    const result = audit(diff);
    expect(
      result.violations.filter((v) => v.kind === "type-coercion-fixture"),
    ).toEqual([]);
  });
});

describe("tester-diff-audit — happy path (clean diff)", () => {
  it("returns zero violations on a diff that adds a single normal expect()", () => {
    const diff = mkDiff(
      "tests/api.test.ts",
      [],
      [`expect(result.name).toBe("foo");`],
    );
    const result = audit(diff);
    expect(result.violations).toEqual([]);
    expect(result.blocking).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("returns zero violations on an empty diff", () => {
    const result = audit("");
    expect(result.violations).toEqual([]);
  });
});

describe("tester-diff-audit — formatViolations", () => {
  it("formats violations as numbered lines with kind + location", () => {
    const v: AuditViolation[] = [
      {
        kind: "seed-data-shape",
        file: "tests/foo.test.ts",
        line: 12,
        snippet: `const BOOK_ID = "1001";`,
        rationale: "rationale text",
      },
    ];
    const out = formatViolations(v);
    expect(out).toContain("[seed-data-shape]");
    expect(out).toContain("tests/foo.test.ts:12");
    expect(out).toContain(`const BOOK_ID = "1001";`);
  });

  it("returns empty string on no violations", () => {
    expect(formatViolations([])).toBe("");
  });
});
