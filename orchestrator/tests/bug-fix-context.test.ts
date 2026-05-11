import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BugEntry } from "@repo/orchestrator-contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildBugContextEnvelope } from "../src/bug-fix-context.js";

/**
 * Tests for `buildBugContextEnvelope` — investigate-024 §F1+F3 / feat-063.
 *
 * Verifies per-class file resolution, truncation, missing-file
 * diagnostics, and back-compat empty envelope for unknown bug sources.
 */

let projectRoot: string;

function makeBug(overrides: Partial<BugEntry> = {}): BugEntry {
  return {
    id: "bug-test",
    iteration: 1,
    source: "flow-execution-failure",
    severity: "P0",
    summary: "test bug",
    correlatedOrphanPath: null,
    owningFeature: null,
    affectsFiles: [],
    agentSequence: ["web-frontend-builder"],
    status: "pending",
    attempts: 0,
    maxAttempts: 3,
    flapResets: 0,
    resolvedInIteration: null,
    bugPlanPath: null,
    errorLog: [],
    ...overrides,
  } as BugEntry;
}

function writeProjectFile(relPath: string, content: string) {
  const abs = join(projectRoot, relPath);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "bug-fix-context-test-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("buildBugContextEnvelope — flow-execution-failure", () => {
  it("pre-loads the synthesized spec + manifest for a flow-failure bug", () => {
    writeProjectFile(
      "apps/web/e2e/synthesized/flow-3.spec.ts",
      `import { test, expect } from "@playwright/test";\n\ntest("walks", async ({ page }) => {\n  await page.goto("/");\n});\n`,
    );
    writeProjectFile(
      "docs/user-flows-manifest.json",
      JSON.stringify({ flows: [{ id: "flow-3" }] }, null, 2),
    );

    const bug = makeBug({
      id: "bug-flow-flow-3-edit-notes",
      source: "flow-execution-failure",
      flow: {
        id: "flow-3",
        name: "Edit notes",
        failedStep: 0,
        expectedScreenId: null,
        actualScreenId: null,
        selector: null,
        screenshot: null,
        htmlDump: null,
      },
    });
    const envelope = buildBugContextEnvelope({ bug, projectRoot });

    expect(envelope.text).toMatch(/Pre-loaded bug context/);
    expect(envelope.text).toMatch(/Failing synthesized spec.*flow-3\.spec\.ts/);
    expect(envelope.text).toMatch(/User-flows manifest/);
    expect(envelope.text).toMatch(/test\("walks"/);
    expect(envelope.resolvedFiles).toHaveLength(2);
    expect(envelope.missingFiles).toHaveLength(0);
  });

  it("reports missing spec via missingFiles[] when the spec doesn't exist", () => {
    // Manifest exists but spec does not.
    writeProjectFile(
      "docs/user-flows-manifest.json",
      JSON.stringify({ flows: [] }),
    );
    const bug = makeBug({
      source: "flow-execution-failure",
      flow: {
        id: "flow-99",
        name: "ghost",
        failedStep: 0,
        expectedScreenId: null,
        actualScreenId: null,
        selector: null,
        screenshot: null,
        htmlDump: null,
      },
    });
    const envelope = buildBugContextEnvelope({ bug, projectRoot });
    expect(envelope.missingFiles).toContainEqual({
      path: "apps/web/e2e/synthesized/flow-99.spec.ts",
      reason: "Failing synthesized spec",
    });
    expect(envelope.text).toMatch(/✗ `apps\/web\/e2e\/synthesized\/flow-99/);
  });
});

describe("buildBugContextEnvelope — visual-parity", () => {
  it("pre-loads the mockup HTML + 3-path fix-site fallback (route + index + component)", () => {
    writeProjectFile(
      "docs/screens/webapp/book-create.html",
      "<html><body><h1>Mockup</h1></body></html>",
    );
    writeProjectFile(
      "apps/web/app/book-create/page.tsx",
      "export default function Page() { return <div>page</div>; }",
    );
    writeProjectFile(
      "apps/web/app/page.tsx",
      "export default function Index() { return <main>index</main>; }",
    );
    const bug = makeBug({
      id: "bug-parity-book-create-layout-regrouping",
      source: "visual-parity",
      parity: {
        screen: "book-create",
        pattern: "layout-regrouping",
        detail: {
          missing: [],
          extra: [],
          variantDrift: [],
          styleDrift: [],
        },
      },
    });
    const envelope = buildBugContextEnvelope({ bug, projectRoot });
    expect(envelope.text).toMatch(/Mockup.*book-create\.html/);
    expect(envelope.text).toMatch(
      /Likely fix-site #1 \(route-named page\).*book-create\/page\.tsx/,
    );
    expect(envelope.text).toMatch(
      /Likely fix-site #2 \(index page.*\).*apps\/web\/app\/page\.tsx/,
    );
    expect(envelope.text).toMatch(/<h1>Mockup<\/h1>/);
    // 3 of 3 candidates resolved (mockup + 2 page files; component file
    // not created in this test → goes to missingFiles)
    expect(envelope.resolvedFiles).toHaveLength(3);
    expect(envelope.missingFiles).toContainEqual({
      path: "apps/web/components/books/book-create.tsx",
      reason: "Likely fix-site #3 (component named after screen)",
    });
  });

  it("feat-063-followup: pre-loads index page when route-named page is missing", () => {
    // Empirical reading-log-02 case: book-detail screen-id has no
    // apps/web/app/book-detail/page.tsx (the actual route is
    // apps/web/app/books/[id]/page.tsx). Pre-followup: bug-fixer received
    // a "file missing" diagnostic for the wrong path. Post-followup:
    // index page.tsx fills in as fallback.
    writeProjectFile(
      "docs/screens/webapp/book-detail.html",
      "<html><body>detail mockup</body></html>",
    );
    writeProjectFile(
      "apps/web/app/page.tsx",
      "export default function Index() { return <main>index</main>; }",
    );
    // NO apps/web/app/book-detail/page.tsx — the legacy heuristic
    // would have left bug-fixer empty-handed.
    const bug = makeBug({
      source: "visual-parity",
      parity: {
        screen: "book-detail",
        pattern: "layout-regrouping",
        detail: {
          missing: [],
          extra: [],
          variantDrift: [],
          styleDrift: [],
        },
      },
    });
    const envelope = buildBugContextEnvelope({ bug, projectRoot });
    expect(envelope.text).toMatch(
      /Likely fix-site #2 \(index page.*\).*apps\/web\/app\/page\.tsx/,
    );
    expect(envelope.missingFiles).toContainEqual({
      path: "apps/web/app/book-detail/page.tsx",
      reason: "Likely fix-site #1 (route-named page)",
    });
    // Mockup + index page resolved; route-named page + component missing.
    expect(envelope.resolvedFiles).toHaveLength(2);
  });
});

describe("buildBugContextEnvelope — reachability-orphan", () => {
  it("pre-loads orphan file + up to 3 suggested importers", () => {
    writeProjectFile(
      "apps/web/components/Stranded.tsx",
      "export function Stranded() { return <div>orphan</div>; }",
    );
    writeProjectFile(
      "apps/web/app/page.tsx",
      "export default function Page() { return <main />; }",
    );
    writeProjectFile(
      "apps/web/components/Layout.tsx",
      "export function Layout() { return <main />; }",
    );
    const bug = makeBug({
      id: "bug-orphan-stranded",
      source: "reachability-orphan",
      orphan: {
        componentPath: "apps/web/components/Stranded.tsx",
        exportNames: ["Stranded"],
        suggestedImporters: [
          "apps/web/app/page.tsx",
          "apps/web/components/Layout.tsx",
          "apps/web/components/MissingFile.tsx",
        ],
      },
    });
    const envelope = buildBugContextEnvelope({ bug, projectRoot });
    expect(envelope.text).toMatch(/Orphan component.*Stranded\.tsx/);
    expect(envelope.text).toMatch(/Suggested importer.*page\.tsx/);
    expect(envelope.text).toMatch(/Suggested importer.*Layout\.tsx/);
    expect(envelope.resolvedFiles).toHaveLength(3); // orphan + 2 found importers
    expect(envelope.missingFiles).toContainEqual({
      path: "apps/web/components/MissingFile.tsx",
      reason: "Suggested importer",
    });
  });

  it("caps suggested importers at 3 even if more provided", () => {
    writeProjectFile(
      "apps/web/components/Stranded.tsx",
      "export function Stranded() {}",
    );
    for (let i = 0; i < 5; i++) {
      writeProjectFile(`importer-${i}.tsx`, `// importer ${i}`);
    }
    const bug = makeBug({
      source: "reachability-orphan",
      orphan: {
        componentPath: "apps/web/components/Stranded.tsx",
        exportNames: ["Stranded"],
        suggestedImporters: [
          "importer-0.tsx",
          "importer-1.tsx",
          "importer-2.tsx",
          "importer-3.tsx",
          "importer-4.tsx",
        ],
      },
    });
    const envelope = buildBugContextEnvelope({ bug, projectRoot });
    // 1 orphan + 3 importers = 4 resolved
    expect(envelope.resolvedFiles).toHaveLength(4);
    // importer-3 + importer-4 NOT in the envelope text
    expect(envelope.text).not.toMatch(/importer-3\.tsx/);
    expect(envelope.text).not.toMatch(/importer-4\.tsx/);
  });
});

describe("buildBugContextEnvelope — back-compat", () => {
  it("returns empty envelope for runtime-error bug (no per-class heuristic yet)", () => {
    const bug = makeBug({
      source: "runtime-error",
      flow: {
        id: "flow-1",
        name: "boot",
        failedStep: 0,
        expectedScreenId: null,
        actualScreenId: null,
        selector: null,
        screenshot: null,
        htmlDump: null,
      },
    });
    const envelope = buildBugContextEnvelope({ bug, projectRoot });
    expect(envelope.text).toBe("");
    expect(envelope.resolvedFiles).toHaveLength(0);
    expect(envelope.missingFiles).toHaveLength(0);
  });

  it("returns empty envelope for dev-server-compile bug", () => {
    const bug = makeBug({
      source: "dev-server-compile",
      flow: {
        id: "flow-1",
        name: "compile",
        failedStep: 0,
        expectedScreenId: null,
        actualScreenId: null,
        selector: null,
        screenshot: null,
        htmlDump: null,
      },
    });
    const envelope = buildBugContextEnvelope({ bug, projectRoot });
    expect(envelope.text).toBe("");
  });
});

describe("buildBugContextEnvelope — file truncation", () => {
  it("truncates files larger than 200 lines + reports the truncation", () => {
    const bigContent = Array.from({ length: 300 }, (_, i) => `line ${i}`).join(
      "\n",
    );
    writeProjectFile("apps/web/e2e/synthesized/flow-big.spec.ts", bigContent);
    writeProjectFile(
      "docs/user-flows-manifest.json",
      JSON.stringify({ flows: [] }),
    );
    const bug = makeBug({
      source: "flow-execution-failure",
      flow: {
        id: "flow-big",
        name: "big",
        failedStep: 0,
        expectedScreenId: null,
        actualScreenId: null,
        selector: null,
        screenshot: null,
        htmlDump: null,
      },
    });
    const envelope = buildBugContextEnvelope({ bug, projectRoot });
    expect(envelope.text).toMatch(/\[\.\.\. 100 lines truncated\]/);
    // File is reported with its FULL line count (300), not the truncated count
    const specEntry = envelope.resolvedFiles.find((r) =>
      r.path.endsWith("flow-big.spec.ts"),
    );
    expect(specEntry?.loc).toBe(300);
  });
});

// ─── feat-070 — systemic-fixer envelope ────────────────────────────────────
//
// When a bug's agentSequence routes to systemic-fixer (per file-bug-plan.mjs
// routing for systemic-divergence / tooling-* bug classes), the envelope
// pre-loads the cross-file build-pipeline view: tailwind/next/postcss
// configs + kit globals.css + apps/api/.env.example. Without this, the
// agent burns its turn budget on Read/Grep for files it always needs.

describe("buildBugContextEnvelope — systemic-fixer envelope (feat-070)", () => {
  it("pre-loads the pipeline files when agentSequence is [systemic-fixer]", () => {
    writeProjectFile("apps/web/tailwind.config.ts", "export default {};");
    writeProjectFile(
      "apps/web/next.config.ts",
      `const config = { transpilePackages: [] };\nexport default config;`,
    );
    writeProjectFile(
      "apps/web/postcss.config.mjs",
      "export default { plugins: { tailwindcss: {}, autoprefixer: {} } };",
    );
    writeProjectFile(
      "packages/ui-kit/src/styles/globals.css",
      "@tailwind base;\n@tailwind components;\n@tailwind utilities;",
    );
    writeProjectFile("apps/api/.env.example", "ENABLE_TEST_SEED=1\n");

    const bug = makeBug({
      id: "bug-parity-systemic-home",
      source: "visual-parity",
      agentSequence: ["systemic-fixer"],
      parity: {
        screen: "home",
        pattern: "systemic-divergence",
        severity: "P0",
        styleDriftCount: 18,
        missingCount: 0,
        extraCount: 0,
        variantDriftCount: 0,
      },
    });

    const envelope = buildBugContextEnvelope({ bug, projectRoot });

    expect(envelope.text).toMatch(/Pre-loaded bug context/);
    const paths = envelope.resolvedFiles.map((r) => r.path);
    expect(paths).toContain("apps/web/tailwind.config.ts");
    expect(paths).toContain("apps/web/next.config.ts");
    expect(paths).toContain("apps/web/postcss.config.mjs");
    expect(paths).toContain("packages/ui-kit/src/styles/globals.css");
    expect(paths).toContain("apps/api/.env.example");
  });

  it("emits FILE MISSING markers for absent pipeline files", () => {
    // Only tailwind.config exists — postcss + kit globals + next.config + .env.example missing.
    writeProjectFile("apps/web/tailwind.config.ts", "export default {};");

    const bug = makeBug({
      id: "bug-compile-pre-verify-css",
      source: "dev-server-compile",
      agentSequence: ["systemic-fixer"],
    });

    const envelope = buildBugContextEnvelope({ bug, projectRoot });
    const missingPaths = envelope.missingFiles.map((m) => m.path);
    expect(missingPaths).toContain("apps/web/next.config.ts");
    expect(missingPaths).toContain("apps/web/postcss.config.mjs");
    expect(missingPaths).toContain("packages/ui-kit/src/styles/globals.css");
    // The diagnostic block should call them out as ✗
    expect(envelope.text).toMatch(/postcss\.config\.mjs.*file missing/);
  });

  it("does NOT add pipeline files when agentSequence is bug-fixer (negative case)", () => {
    writeProjectFile("apps/web/tailwind.config.ts", "export default {};");
    writeProjectFile(
      "apps/web/e2e/synthesized/flow-1.spec.ts",
      `import { test } from "@playwright/test";\ntest("noop", () => {});`,
    );

    const bug = makeBug({
      id: "bug-flow-flow-1",
      source: "flow-execution-failure",
      agentSequence: ["bug-fixer"],
      flow: {
        id: "flow-1",
        name: "test",
        failedStep: 0,
        expectedScreenId: null,
        actualScreenId: null,
        selector: null,
        screenshot: null,
        htmlDump: null,
      },
    });

    const envelope = buildBugContextEnvelope({ bug, projectRoot });
    const paths = envelope.resolvedFiles.map((r) => r.path);
    // bug-fixer dispatch does NOT pre-load tailwind.config.ts etc.
    expect(paths).not.toContain("apps/web/tailwind.config.ts");
  });
});
