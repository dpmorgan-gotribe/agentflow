// @ts-nocheck — testing a .mjs script via dynamic import; no type declarations.
//
// feat-028 Phase 4 — exercises the parity-divergence body template +
// bugs.yaml entry construction in scripts/file-bug-plan.mjs. The other
// violation kinds (orphan-component, flow-failure, runtime-error,
// dev-server-compile) have coverage via the integration tests in
// build-to-spec-verify.test.ts + fix-bugs-loop.test.ts.

import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import yaml from "js-yaml";

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "file-bug-plan-parity-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

const importHelper = async () =>
  (await import("../../scripts/file-bug-plan.mjs")) as typeof import("../../scripts/file-bug-plan.mjs");

const stubShellStripping = () => ({
  kind: "parity-divergence" as const,
  screen: "home",
  pattern: "shell-stripping",
  severity: "P0" as const,
  detail: {
    missing: [
      '[data-kit-component="AppShell"]',
      '[data-kit-component="Sidebar"]',
    ],
    extra: [],
    variantDrift: [],
    styleDrift: [],
  },
});

const stubTokenDrift = () => ({
  kind: "parity-divergence" as const,
  screen: "settings",
  pattern: "token-drift",
  severity: "P1" as const,
  detail: {
    missing: [],
    extra: [],
    variantDrift: [],
    styleDrift: [
      {
        selector: '[data-kit-component="Card"]',
        property: "background-color",
        mockupValue: "rgb(248, 250, 252)",
        builtValue: "rgb(255, 255, 255)",
      },
    ],
  },
});

describe("fileBugPlan — parity-divergence", () => {
  it("writes a bug plan with parity-* id format", async () => {
    const { fileBugPlan } = await importHelper();
    const { planId, planPath } = await fileBugPlan({
      projectDir,
      violation: stubShellStripping(),
      iteration: 1,
    });
    expect(planId).toMatch(/^bug-\d+-parity-home-shell-stripping$/);
    expect(existsSync(planPath)).toBe(true);
  });

  it("renders the shell-stripping template body with missing primitives + fix approach", async () => {
    const { fileBugPlan } = await importHelper();
    const { planPath } = await fileBugPlan({
      projectDir,
      violation: stubShellStripping(),
      iteration: 1,
    });
    const body = readFileSync(planPath, "utf8");
    expect(body).toMatch(/shell-stripping/);
    expect(body).toMatch(/AppShell/);
    expect(body).toMatch(/Sidebar/);
    expect(body).toMatch(/Wrap the rendered content in `<AppShell/);
    expect(body).toMatch(/docs\/screens\/webapp\/home\.html/);
  });

  it("renders the token-drift template body with computed-style drift", async () => {
    const { fileBugPlan } = await importHelper();
    const { planPath } = await fileBugPlan({
      projectDir,
      violation: stubTokenDrift(),
      iteration: 1,
    });
    const body = readFileSync(planPath, "utf8");
    expect(body).toMatch(/token-drift/);
    expect(body).toMatch(/background-color/);
    expect(body).toMatch(/rgb\(248, 250, 252\)/);
    expect(body).toMatch(/Replace arbitrary Tailwind values/);
  });

  it("appends a parity-source entry to docs/bugs.yaml", async () => {
    const { fileBugPlan } = await importHelper();
    const { bugYamlId } = await fileBugPlan({
      projectDir,
      violation: stubShellStripping(),
      iteration: 1,
    });
    expect(bugYamlId).toMatch(/^bug-parity-home-shell-stripping$/);

    const yamlPath = join(projectDir, "docs/bugs.yaml");
    expect(existsSync(yamlPath)).toBe(true);
    const doc = yaml.load(readFileSync(yamlPath, "utf8")) as {
      bugs: Array<{
        id: string;
        source: string;
        severity: string;
        parity: { screen: string; pattern: string };
      }>;
    };
    expect(doc.bugs).toHaveLength(1);
    expect(doc.bugs[0]?.source).toBe("visual-parity");
    expect(doc.bugs[0]?.severity).toBe("P0"); // shell-stripping → P0
    expect(doc.bugs[0]?.parity?.screen).toBe("home");
    expect(doc.bugs[0]?.parity?.pattern).toBe("shell-stripping");
  });

  it("preserves P1 severity for non-shell-stripping patterns", async () => {
    const { fileBugPlan } = await importHelper();
    await fileBugPlan({
      projectDir,
      violation: stubTokenDrift(),
      iteration: 1,
    });
    const yamlPath = join(projectDir, "docs/bugs.yaml");
    const doc = yaml.load(readFileSync(yamlPath, "utf8")) as {
      bugs: Array<{ severity: string }>;
    };
    expect(doc.bugs[0]?.severity).toBe("P1");
  });

  it("produces a one-line summary referencing screen + pattern + counts", async () => {
    const { fileBugPlan } = await importHelper();
    await fileBugPlan({
      projectDir,
      violation: stubShellStripping(),
      iteration: 1,
    });
    const yamlPath = join(projectDir, "docs/bugs.yaml");
    const doc = yaml.load(readFileSync(yamlPath, "utf8")) as {
      bugs: Array<{ summary: string }>;
    };
    expect(doc.bugs[0]?.summary).toMatch(
      /Parity shell-stripping on home \(2 missing\)/,
    );
  });
});
