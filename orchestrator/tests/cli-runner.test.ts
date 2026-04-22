import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli-runner.js";

let factoryRoot: string;

beforeEach(() => {
  factoryRoot = mkdtempSync(join(tmpdir(), "cli-runner-"));
  mkdirSync(join(factoryRoot, "projects"), { recursive: true });
  mkdirSync(join(factoryRoot, ".claude", "skills"), { recursive: true });
});

afterEach(() => {
  rmSync(factoryRoot, { recursive: true, force: true });
});

function scaffoldProject(name: string, filled: Record<string, string> = {}) {
  const root = join(factoryRoot, "projects", name);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, ".claude"), { recursive: true });
  for (const [relPath, content] of Object.entries(filled)) {
    const abs = join(root, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

function addSkill(name: string) {
  const dir = join(factoryRoot, ".claude", "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\n---\n\n# ${name}`);
}

describe("runCli — project resolution", () => {
  it("errors when no project name supplied and multiple projects exist", async () => {
    scaffoldProject("alpha");
    scaffoldProject("beta");
    const result = await runCli({ flags: "" }, factoryRoot);
    expect(result.exitCode).toBe(2);
    expect(result.messages.join("\n")).toContain("No project specified");
  });

  it("auto-selects when only one project exists", async () => {
    scaffoldProject("alpha", {
      "docs/brief-summary.json": '{"projectName":"alpha"}',
    });
    addSkill("analyze");
    const result = await runCli({ flags: "", dryRun: true }, factoryRoot);
    expect(result.exitCode).toBe(0);
    expect(result.messages[0]).toContain("projects");
    expect(result.messages[0]).toContain("alpha");
  });

  it("errors when named project does not exist", async () => {
    scaffoldProject("alpha");
    const result = await runCli(
      { flags: "", projectName: "nonexistent" },
      factoryRoot,
    );
    expect(result.exitCode).toBe(2);
  });
});

describe("runCli — dry-run stage walk", () => {
  it("detects completed stages via their artifact files", async () => {
    scaffoldProject("alpha", {
      "docs/brief-summary.json": "{}",
      "docs/mockups/manifest.json": "{}",
    });
    // make .claude/skills appear populated inside project for skills-audit-design
    mkdirSync(
      join(factoryRoot, "projects", "alpha", ".claude", "skills", "foo"),
      {
        recursive: true,
      },
    );
    const result = await runCli(
      { flags: "", projectName: "alpha", dryRun: true },
      factoryRoot,
    );
    expect(result.exitCode).toBe(0);
    const joined = result.messages.join("\n");
    expect(joined).toContain("Completed stages");
    expect(joined).toContain("analyze");
    expect(joined).toContain("mockups");
  });

  it("reports first-missing-skill diagnostic at halting stage", async () => {
    // Complete all design-tier artifacts so resume=architect
    scaffoldProject("alpha", {
      "docs/brief-summary.json": "{}",
      "docs/mockups/manifest.json": "{}",
      "docs/design-system-preview.html": "<!doctype html>",
      "docs/screens-manifest.json": "{}",
      "docs/user-flows-manifest.json": "{}",
    });
    const proj = join(factoryRoot, "projects", "alpha");
    mkdirSync(join(proj, ".claude", "skills", "foo"), { recursive: true });
    mkdirSync(join(proj, "docs", "visual-review"), { recursive: true });
    writeFileSync(join(proj, "docs", "visual-review", "report.json"), "{}");

    const result = await runCli(
      { flags: "", projectName: "alpha", dryRun: true },
      factoryRoot,
    );
    expect(result.exitCode).toBe(0);
    const joined = result.messages.join("\n");
    expect(joined).toContain("Resume from: architect");
    expect(joined).toContain(
      "skill MISSING (.claude/skills/architect/SKILL.md)",
    );
    expect(joined).toContain("Pipeline would halt at stage 'architect'");
  });

  it("reports success when all remaining skills exist (no halting diagnostic)", async () => {
    scaffoldProject("alpha", { "docs/brief-summary.json": "{}" });
    addSkill("skills-audit"); // covers /skills-audit slash command
    addSkill("mockups");
    addSkill("stylesheet");
    addSkill("screens");
    addSkill("visual-review");
    addSkill("user-flows-generator");
    addSkill("architect");
    addSkill("pm");
    addSkill("register-mcp-servers");
    addSkill("git-agent");
    mkdirSync(
      join(factoryRoot, "projects", "alpha", ".claude", "skills", "foo"),
      { recursive: true },
    );

    const result = await runCli(
      { flags: "", projectName: "alpha", dryRun: true },
      factoryRoot,
    );
    const joined = result.messages.join("\n");
    expect(result.exitCode).toBe(0);
    expect(joined).not.toContain("Pipeline would halt");
    expect(joined).toContain(
      "All remaining stages have their skills registered",
    );
  });
});

describe("runCli — flags + budget reporting", () => {
  it("reports parsed flags", async () => {
    scaffoldProject("alpha", { "docs/brief-summary.json": "{}" });
    const result = await runCli(
      { flags: "nanobanana", projectName: "alpha", dryRun: true },
      factoryRoot,
    );
    expect(result.messages.some((m) => m.includes("Flags: nanobanana"))).toBe(
      true,
    );
  });

  it("reports budget cap from readBudgetCaps default", async () => {
    scaffoldProject("alpha", { "docs/brief-summary.json": "{}" });
    const result = await runCli(
      { flags: "", projectName: "alpha", dryRun: true },
      factoryRoot,
    );
    expect(
      result.messages.some((m) => /Budget cap: \d+\.\d{2} USD/.test(m)),
    ).toBe(true);
  });
});
