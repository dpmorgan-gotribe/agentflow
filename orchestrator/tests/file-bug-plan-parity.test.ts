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

// ─── bug-050 Phase B: defaultAgentSequence routes by primaryCause ────────────
//
// Pre-bug-050 every flow-failure bug got `[web-frontend-builder, tester,
// reviewer]` regardless of cause. This block validates the routing table:
//   - build-gap → web-frontend-builder (default; correct for design-intent gaps)
//   - manifest-author → [] (no dispatch; flow-author needs to regen, not a builder)
//   - seed-setup → backend-builder (Strategy C /test/seed-baseline endpoint)
//
// The classifier (feat-049 Phase B/C) populates primaryCause from the runner;
// here we test fileBugPlan respects it.
describe("fileBugPlan — bug-050 Phase B agent routing by primaryCause", () => {
  const stubFlowFailure = (primaryCause: string) => ({
    kind: "flow-failure" as const,
    flowId: "flow-1",
    flowName: "Test flow",
    step: 2,
    fromScreenId: null,
    expectedScreenId: "destination",
    actualScreenId: null,
    selector: '[data-kit-component="Foo"]',
    screenshotPath: null,
    htmlDumpPath: null,
    message: "test message",
    primaryCause,
  });

  it("primaryCause=build-gap → [web-frontend-builder, tester, reviewer]", async () => {
    const { fileBugPlan } = await importHelper();
    await fileBugPlan({
      projectDir,
      violation: stubFlowFailure("build-gap"),
      iteration: 1,
    });
    const doc = yaml.load(
      readFileSync(join(projectDir, "docs/bugs.yaml"), "utf8"),
    ) as { bugs: Array<{ agentSequence: string[] }> };
    expect(doc.bugs[0]?.agentSequence).toEqual([
      "web-frontend-builder",
      "tester",
      "reviewer",
    ]);
  });

  it("primaryCause=manifest-author → [] (skip dispatch)", async () => {
    const { fileBugPlan } = await importHelper();
    await fileBugPlan({
      projectDir,
      violation: stubFlowFailure("manifest-author"),
      iteration: 1,
    });
    const doc = yaml.load(
      readFileSync(join(projectDir, "docs/bugs.yaml"), "utf8"),
    ) as { bugs: Array<{ agentSequence: string[] }> };
    expect(doc.bugs[0]?.agentSequence).toEqual([]);
  });

  it("primaryCause=seed-setup → [backend-builder, tester, reviewer]", async () => {
    const { fileBugPlan } = await importHelper();
    await fileBugPlan({
      projectDir,
      violation: stubFlowFailure("seed-setup"),
      iteration: 1,
    });
    const doc = yaml.load(
      readFileSync(join(projectDir, "docs/bugs.yaml"), "utf8"),
    ) as { bugs: Array<{ agentSequence: string[] }> };
    expect(doc.bugs[0]?.agentSequence).toEqual([
      "backend-builder",
      "tester",
      "reviewer",
    ]);
  });

  it("primaryCause=step-transition (legacy) → default web-frontend-builder", async () => {
    const { fileBugPlan } = await importHelper();
    await fileBugPlan({
      projectDir,
      violation: stubFlowFailure("step-transition"),
      iteration: 1,
    });
    const doc = yaml.load(
      readFileSync(join(projectDir, "docs/bugs.yaml"), "utf8"),
    ) as { bugs: Array<{ agentSequence: string[] }> };
    expect(doc.bugs[0]?.agentSequence).toEqual([
      "web-frontend-builder",
      "tester",
      "reviewer",
    ]);
  });
});

// ─── feat-058 (2026-05-06): trim agentSequence per cause class ────────────
//
// Pre-feat-058 every cause class returned a 3-agent sequence
// [<builder>, tester, reviewer]. Empirical anchor: reading-log-01 single-bug
// dispatches taking ~30min; tester+reviewer add ~10-20min for cheap classes
// (dev-server-compile, runtime-error, visual-parity, reachability-orphan)
// without catching what the loop's re-verify already catches. feat-058 trims:
//   - dev-server-compile  → [<tier>]                   (re-verify IS the test)
//   - runtime-error       → [<tier>, reviewer]         (drop tester)
//   - visual-parity       → [<tier>, reviewer]         (parity-verify is the check)
//   - reachability-orphan → [<tier>, reviewer]         (re-verify catches wiring)
//   - flow-execution      → [<tier>, tester, reviewer] (KEEP — feature work)
//   - build-gap           → [<tier>, tester, reviewer] (KEEP — feature work)
//   - seed-setup          → [backend-builder, tester, reviewer] (KEEP)
//   - manifest-author     → []                                  (KEEP — no dispatch)
//
// This block validates the new trimmed paths + that feature-class bugs keep
// their full safety net.
describe("fileBugPlan — feat-058 trimmed agentSequence per cause", () => {
  const stubFlowFailure = (primaryCause: string) => ({
    kind: "flow-failure" as const,
    flowId: "flow-1",
    flowName: "Test flow",
    step: 2,
    fromScreenId: null,
    expectedScreenId: "destination",
    actualScreenId: null,
    selector: '[data-kit-component="Foo"]',
    screenshotPath: null,
    htmlDumpPath: null,
    message: "test message",
    primaryCause,
  });

  it("primaryCause=dev-server-compile → [<tier>] only (no tester, no reviewer)", async () => {
    const { fileBugPlan } = await importHelper();
    await fileBugPlan({
      projectDir,
      violation: stubFlowFailure("dev-server-compile"),
      iteration: 1,
    });
    const doc = yaml.load(
      readFileSync(join(projectDir, "docs/bugs.yaml"), "utf8"),
    ) as { bugs: Array<{ agentSequence: string[] }> };
    expect(doc.bugs[0]?.agentSequence).toEqual(["web-frontend-builder"]);
  });

  it("primaryCause=runtime-error → [<tier>, reviewer] (drop tester, keep reviewer)", async () => {
    const { fileBugPlan } = await importHelper();
    await fileBugPlan({
      projectDir,
      violation: stubFlowFailure("runtime-error"),
      iteration: 1,
    });
    const doc = yaml.load(
      readFileSync(join(projectDir, "docs/bugs.yaml"), "utf8"),
    ) as { bugs: Array<{ agentSequence: string[] }> };
    expect(doc.bugs[0]?.agentSequence).toEqual([
      "web-frontend-builder",
      "reviewer",
    ]);
  });

  it("primaryCause=visual-parity → [<tier>, reviewer]", async () => {
    const { fileBugPlan } = await importHelper();
    // visual-parity bugs come via parity-divergence violation, not flow-failure.
    // The cause field still drives the sequence; the violation kind only
    // affects WHICH summary template is used.
    await fileBugPlan({
      projectDir,
      violation: stubFlowFailure("visual-parity"),
      iteration: 1,
    });
    const doc = yaml.load(
      readFileSync(join(projectDir, "docs/bugs.yaml"), "utf8"),
    ) as { bugs: Array<{ agentSequence: string[] }> };
    expect(doc.bugs[0]?.agentSequence).toEqual([
      "web-frontend-builder",
      "reviewer",
    ]);
  });

  it("orphan-component (no primaryCause) → [<tier>, reviewer] via synthesized routing", async () => {
    const { fileBugPlan } = await importHelper();
    await fileBugPlan({
      projectDir,
      violation: {
        kind: "orphan-component",
        path: "apps/web/src/components/Stranded.tsx",
        exportNames: ["Stranded"],
        owningFeature: "feat-foo",
        suggestedImporters: ["apps/web/app/page.tsx"],
        reason: "no importer found",
      },
      iteration: 1,
    });
    const doc = yaml.load(
      readFileSync(join(projectDir, "docs/bugs.yaml"), "utf8"),
    ) as { bugs: Array<{ agentSequence: string[] }> };
    expect(doc.bugs[0]?.agentSequence).toEqual([
      "web-frontend-builder",
      "reviewer",
    ]);
  });

  it("primaryCause=flow-execution-failure → [<tier>, tester, reviewer] KEEP full safety net", async () => {
    const { fileBugPlan } = await importHelper();
    await fileBugPlan({
      projectDir,
      violation: stubFlowFailure("flow-execution-failure"),
      iteration: 1,
    });
    const doc = yaml.load(
      readFileSync(join(projectDir, "docs/bugs.yaml"), "utf8"),
    ) as { bugs: Array<{ agentSequence: string[] }> };
    expect(doc.bugs[0]?.agentSequence).toEqual([
      "web-frontend-builder",
      "tester",
      "reviewer",
    ]);
  });
});

// ─── bug-053 (2026-05-05): plan-file dedup when stable bug-id exists ────────
//
// Earlier each /build-to-spec-verify run minted a NEW `bug-NNN-*.md` plan-file
// even when the SAME violation (screen + pattern) already had a plan. Empirical
// at investigation time: finance-track-01's plans/active/ had 463 plan files
// for 54 unique bugs.yaml entries (~9× duplication across 9 verifier reruns).
// bugs.yaml IS deduped (idempotent on stable id), so the fix-bugs loop wasn't
// affected — but plans/active/ became operationally noisy. This block
// validates the short-circuit.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
describe("fileBugPlan — bug-053 plan-file dedup", () => {
  it("filing the same violation twice produces ONE plan file + ONE bugs.yaml entry", async () => {
    const { fileBugPlan } = await importHelper();
    const violation = stubShellStripping();
    const first = await fileBugPlan({ projectDir, violation, iteration: 1 });
    const second = await fileBugPlan({ projectDir, violation, iteration: 1 });

    // Same planId/Path; second call returns deduplicated:true.
    expect(second.planId).toBe(first.planId);
    expect(second.planPath).toBe(first.planPath);
    expect(second.deduplicated).toBe(true);
    expect(second.previouslyArchived).toBe(false);
    // First call DOESN'T carry deduplicated flag (fresh write).
    expect(first.deduplicated).toBeUndefined();

    // plans/active/ has exactly ONE bug plan file matching the stable slug.
    const activeDir = join(projectDir, "plans", "active");
    const matches = readdirSync(activeDir).filter((f) =>
      /^bug-\d+-parity-home-shell-stripping\.md$/.test(f),
    );
    expect(matches).toHaveLength(1);

    // bugs.yaml has ONE entry (idempotent at yaml level too — pre-existing).
    const yamlPath = join(projectDir, "docs/bugs.yaml");
    const doc = yaml.load(readFileSync(yamlPath, "utf8")) as {
      bugs: Array<{ id: string }>;
    };
    expect(doc.bugs).toHaveLength(1);
  });

  it("filing a violation whose plan was previously archived returns deduplicated:true + previouslyArchived:true", async () => {
    const { fileBugPlan } = await importHelper();

    // Pre-seed plans/archive/ with a plan matching the stable slug.
    const archiveDir = join(projectDir, "plans", "archive");
    mkdirSync(archiveDir, { recursive: true });
    const archivedPath = join(
      archiveDir,
      "bug-007-parity-home-shell-stripping.md",
    );
    writeFileSync(
      archivedPath,
      "---\nid: bug-007-parity-home-shell-stripping\n---\nold\n",
    );

    const result = await fileBugPlan({
      projectDir,
      violation: stubShellStripping(),
      iteration: 1,
    });

    expect(result.deduplicated).toBe(true);
    expect(result.previouslyArchived).toBe(true);
    expect(result.planPath).toBe(archivedPath);
    expect(result.planId).toBe("bug-007-parity-home-shell-stripping");

    // No new plan-file in plans/active/ since the archived one short-circuits.
    const activeDir = join(projectDir, "plans", "active");
    if (existsSync(activeDir)) {
      const matches = readdirSync(activeDir).filter((f) =>
        /^bug-\d+-parity-home-shell-stripping\.md$/.test(f),
      );
      expect(matches).toHaveLength(0);
    }
  });

  it("filing a NEW (never-seen) violation works exactly as before — no regression", async () => {
    const { fileBugPlan } = await importHelper();
    const result = await fileBugPlan({
      projectDir,
      violation: stubTokenDrift(),
      iteration: 1,
    });
    expect(result.deduplicated).toBeUndefined();
    expect(existsSync(result.planPath)).toBe(true);
    expect(result.planId).toMatch(/^bug-\d+-parity-settings-token-drift$/);
  });

  it("two DIFFERENT violations both file fresh plans (dedup is per stable-slug, not blanket)", async () => {
    const { fileBugPlan } = await importHelper();
    const a = await fileBugPlan({
      projectDir,
      violation: stubShellStripping(),
      iteration: 1,
    });
    const b = await fileBugPlan({
      projectDir,
      violation: stubTokenDrift(),
      iteration: 1,
    });
    expect(a.planId).not.toBe(b.planId);
    expect(a.deduplicated).toBeUndefined();
    expect(b.deduplicated).toBeUndefined();
    const activeDir = join(projectDir, "plans", "active");
    expect(readdirSync(activeDir)).toHaveLength(2);
  });
});
