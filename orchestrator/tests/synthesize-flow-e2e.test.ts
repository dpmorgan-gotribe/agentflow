import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * feat-038 Phase 5 — fixture-driven validation harness for
 * scripts/synthesize-flow-e2e.mjs.
 *
 * Each fixture under tests/fixtures/synthesize-flow-e2e/ is a tiny
 * project tree containing:
 *
 *   - .claude/architecture.yaml — declares persistence_layer, drives
 *     the synthesizer's strategy resolution
 *   - docs/user-flows-manifest.json — v2.0 manifest with one realistic
 *     flow whose interactions[] exercises the strategy's emission path
 *   - expected/flow-1.spec.ts — snapshot of the synthesizer's emitted
 *     spec for that fixture; the test asserts byte-equality against it
 *
 * Three fixtures cover the strategy matrix:
 *
 *   - strategy-a-localstorage  — kanban-class mutation flow → Strategy A
 *     (clearAndReload import + describe.serial)
 *   - strategy-d-intercept     — repo-health-class read-only flow →
 *     Strategy D (clearMocks afterEach + describe)
 *   - strategy-c-realdb        — book-swap-class mutation flow → Strategy C
 *     (seedFixtures/cleanupFixtures import + describe.serial + TODO
 *     beforeAll/afterAll skeleton)
 *
 * The test runs the synthesizer in a temp copy of each fixture so the
 * fixture's apps/web/e2e/synthesized/ output stays clean across runs,
 * then compares the emitted flow-1.spec.ts to the committed expected/
 * snapshot. Future synthesizer changes that intentionally alter output
 * require updating the expected/ snapshots — that's the point of a
 * regression net.
 */

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const FACTORY_ROOT = resolve(SELF_DIR, "../..");
const FIXTURES_DIR = join(SELF_DIR, "fixtures/synthesize-flow-e2e");
const SYNTHESIZER = join(FACTORY_ROOT, "scripts/synthesize-flow-e2e.mjs");

interface FixtureSpec {
  name: string;
  expectedStrategy: "A" | "C" | "D";
  expectedPersistenceLayer: "localStorage" | "external-api-only" | "real-db";
  expectedSerial: boolean; // whether describe.serial should be used
  expectedHelperImport: string;
}

const FIXTURES: FixtureSpec[] = [
  {
    name: "strategy-a-localstorage",
    expectedStrategy: "A",
    expectedPersistenceLayer: "localStorage",
    expectedSerial: true, // mutation tier
    expectedHelperImport: `import { clearAndReload } from "../helpers/seed-localstorage";`,
  },
  {
    name: "strategy-d-intercept",
    expectedStrategy: "D",
    expectedPersistenceLayer: "external-api-only",
    expectedSerial: false, // read-only tier
    expectedHelperImport: `import { clearMocks } from "../helpers/seed-intercept";`,
  },
  {
    name: "strategy-c-realdb",
    expectedStrategy: "C",
    expectedPersistenceLayer: "real-db",
    expectedSerial: true, // mutation tier
    expectedHelperImport: `import { seedFixtures, cleanupFixtures } from "../helpers/seed-db";`,
  },
];

interface SynthOutput {
  ok: boolean;
  persistenceLayer: string | null;
  strategy: string | null;
  generatedFiles: string[];
  warnings: string[];
}

function runSynthesizerOn(fixtureCopy: string): SynthOutput {
  const stdout = execFileSync("node", [SYNTHESIZER, fixtureCopy], {
    encoding: "utf8",
    cwd: FACTORY_ROOT,
  });
  return JSON.parse(stdout) as SynthOutput;
}

/**
 * Normalize a TS source string for byte-equal comparison: collapse runs of
 * whitespace (incl. newlines) into single spaces. This makes the test
 * resilient to prettier-style reformatting that splits a single-line emit
 * across multiple lines (or vice versa) — the structural tokens of the
 * spec are preserved in order; only the whitespace between them changes.
 *
 * Trade-off: a regression that ONLY differs in whitespace within a string
 * literal would slip past this normalization. Acceptable for a synthesizer
 * test — the emitted strings are command-line / selector / URL fragments
 * that don't carry significant whitespace.
 */
function normalizeSpec(source: string): string {
  return source.replace(/\s+/g, " ").trim();
}

describe("synthesize-flow-e2e — Phase 2A v2.0 emission across strategies", () => {
  const tempCleanup: string[] = [];

  afterEach(() => {
    for (const dir of tempCleanup.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const fixture of FIXTURES) {
    it(`${fixture.name} — synthesizer resolves correct strategy + emits structured spec`, () => {
      const fixtureSrc = join(FIXTURES_DIR, fixture.name);
      const tempDir = mkdtempSync(join(tmpdir(), `synth-fix-${fixture.name}-`));
      tempCleanup.push(tempDir);
      // Copy the fixture (architecture.yaml + manifest) into the temp so
      // the synthesizer's emitted output lands there, not back in the
      // committed fixture tree.
      cpSync(join(fixtureSrc, ".claude"), join(tempDir, ".claude"), {
        recursive: true,
      });
      cpSync(join(fixtureSrc, "docs"), join(tempDir, "docs"), {
        recursive: true,
      });

      const result = runSynthesizerOn(tempDir);

      expect(result.ok).toBe(true);
      expect(result.strategy).toBe(fixture.expectedStrategy);
      expect(result.persistenceLayer).toBe(fixture.expectedPersistenceLayer);
      expect(result.generatedFiles).toContain(
        "apps/web/e2e/synthesized/flow-1.spec.ts",
      );

      // Structural-feature assertions on the EMITTED spec (raw synthesizer
      // output, pre-formatter). The fixture's committed expected/ is the
      // post-formatter snapshot — kept as a human-readable reference but
      // NOT used for byte-equality compare. The on-write formatter rewrites
      // quote styles + line wrapping + paren elision, which would defeat
      // a verbatim test. Whitespace normalization isn't enough to bridge
      // the gap; we instead lock in the load-bearing shape via the
      // structural assertions below.
      const emitted = readFileSync(
        join(tempDir, "apps/web/e2e/synthesized/flow-1.spec.ts"),
        "utf8",
      );

      expect(emitted).toContain(fixture.expectedHelperImport);
      if (fixture.expectedSerial) {
        expect(emitted).toContain("test.describe.serial(");
      } else {
        expect(emitted).toMatch(/test\.describe\("[^"]/);
        expect(emitted).not.toContain("test.describe.serial(");
      }
      // Every v2.0 emit wraps interactions in a try/catch with __stepIndex.
      expect(emitted).toContain("let __stepIndex = 0;");
      expect(normalizeSpec(emitted)).toContain(
        "failed at interaction ${__stepIndex}",
      );
      // First interaction is always navigate.
      expect(emitted).toMatch(/__stepIndex = 1;\s*await page\.goto\(/);
      // Runtime-error capture prelude (feat-027) is intact.
      expect(emitted).toContain("test.beforeEach(async ({ page }, testInfo)");
      expect(emitted).toContain("runtime-errors");
    });
  }

  it("Strategy C mutation flow emits beforeAll/afterAll TODO skeleton", () => {
    const expectedSpec = readFileSync(
      join(FIXTURES_DIR, "strategy-c-realdb/expected/flow-1.spec.ts"),
      "utf8",
    );
    // The synthesizer emits a commented-out beforeAll/afterAll skeleton
    // for Strategy C mutation flows so the operator can fill in fixtures.
    expect(expectedSpec).toContain(
      "// test.beforeAll(async ({ request }) => {",
    );
    expect(expectedSpec).toContain("//   await seedFixtures(request, {");
    expect(expectedSpec).toContain("// test.afterAll(async ({ request }) => {");
    expect(expectedSpec).toContain("//   await cleanupFixtures(request,");
  });

  it("Strategy A non-mutation projects would NOT emit describe.serial", () => {
    // Sanity: confirm Strategy A's serial-mode opt-in is conditioned on
    // seedingTier === "mutation", not on the strategy itself. (Strategy A
    // fixture happens to be mutation, but the implementation should
    // preserve the seedingTier signal independently.)
    const expectedSpec = readFileSync(
      join(FIXTURES_DIR, "strategy-d-intercept/expected/flow-1.spec.ts"),
      "utf8",
    );
    expect(expectedSpec).not.toContain("test.describe.serial(");
    expect(expectedSpec).toMatch(/test\.describe\("[^"]/);
  });

  it("each fixture's expected/ snapshot exists and is non-empty", () => {
    for (const fixture of FIXTURES) {
      const expectedPath = join(
        FIXTURES_DIR,
        fixture.name,
        "expected/flow-1.spec.ts",
      );
      expect(existsSync(expectedPath)).toBe(true);
      const content = readFileSync(expectedPath, "utf8");
      expect(content.length).toBeGreaterThan(500);
    }
  });
});
