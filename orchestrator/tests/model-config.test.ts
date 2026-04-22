import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readBudgetCaps, readModelConfig } from "../src/model-config.js";

let tmpDir: string;
let globalPath: string;
let projectPath: string;
const originalEnv = process.env.ANTHROPIC_MODEL;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "model-config-"));
  globalPath = join(tmpDir, "global.yaml");
  projectPath = join(tmpDir, "project.yaml");
  delete process.env.ANTHROPIC_MODEL;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  if (originalEnv === undefined) {
    delete process.env.ANTHROPIC_MODEL;
  } else {
    process.env.ANTHROPIC_MODEL = originalEnv;
  }
});

describe("readModelConfig — tier→model resolution", () => {
  it("resolves tier to model via defaults map", () => {
    writeFileSync(
      globalPath,
      `defaults:\n  planning: claude-opus-4-7\nagents:\n  analyst: { tier: planning, effort: max }\n`,
    );
    const cfg = readModelConfig("analyst", tmpDir, { globalPath, projectPath });
    expect(cfg.model).toBe("claude-opus-4-7");
    expect(cfg.effort).toBe("max");
  });

  it("direct model override on agent wins over tier", () => {
    writeFileSync(
      globalPath,
      `defaults:\n  planning: claude-opus-4-7\nagents:\n  analyst: { tier: planning, model: claude-sonnet-4-6 }\n`,
    );
    const cfg = readModelConfig("analyst", tmpDir, { globalPath, projectPath });
    expect(cfg.model).toBe("claude-sonnet-4-6");
  });

  it("defaults effort to 'medium' when agent omits it", () => {
    writeFileSync(
      globalPath,
      `defaults:\n  planning: claude-opus-4-7\nagents:\n  analyst: { tier: planning }\n`,
    );
    const cfg = readModelConfig("analyst", tmpDir, { globalPath, projectPath });
    expect(cfg.effort).toBe("medium");
  });

  it("defaults budgetUsd to 5 when agent omits it", () => {
    writeFileSync(
      globalPath,
      `defaults:\n  planning: claude-opus-4-7\nagents:\n  analyst: { tier: planning }\n`,
    );
    const cfg = readModelConfig("analyst", tmpDir, { globalPath, projectPath });
    expect(cfg.budgetUsd).toBe(5);
  });

  it("throws when no model can be resolved", () => {
    writeFileSync(
      globalPath,
      `defaults: {}\nagents:\n  analyst: { effort: max }\n`,
    );
    expect(() =>
      readModelConfig("analyst", tmpDir, { globalPath, projectPath }),
    ).toThrow(/No model resolved/);
  });
});

describe("readModelConfig — precedence (global < project < env)", () => {
  it("project config overrides global agent settings", () => {
    writeFileSync(
      globalPath,
      `defaults:\n  planning: claude-opus-4-7\n  building: claude-sonnet-4-6\nagents:\n  analyst: { tier: planning, effort: max }\n`,
    );
    writeFileSync(
      projectPath,
      `agents:\n  analyst: { tier: building, effort: low }\n`,
    );
    const cfg = readModelConfig("analyst", tmpDir, { globalPath, projectPath });
    expect(cfg.model).toBe("claude-sonnet-4-6");
    expect(cfg.effort).toBe("low");
  });

  it("project partial override merges with global (effort from project, tier from global)", () => {
    writeFileSync(
      globalPath,
      `defaults:\n  planning: claude-opus-4-7\nagents:\n  analyst: { tier: planning, effort: max }\n`,
    );
    writeFileSync(projectPath, `agents:\n  analyst: { effort: low }\n`);
    const cfg = readModelConfig("analyst", tmpDir, { globalPath, projectPath });
    expect(cfg.model).toBe("claude-opus-4-7"); // tier: planning inherited
    expect(cfg.effort).toBe("low"); // effort overridden
  });

  it("ANTHROPIC_MODEL env var overrides both configs", () => {
    writeFileSync(
      globalPath,
      `defaults:\n  planning: claude-opus-4-7\nagents:\n  analyst: { tier: planning }\n`,
    );
    process.env.ANTHROPIC_MODEL = "claude-haiku-4-5";
    const cfg = readModelConfig("analyst", tmpDir, { globalPath, projectPath });
    expect(cfg.model).toBe("claude-haiku-4-5");
  });

  it("project defaults override global defaults for tier mapping", () => {
    writeFileSync(globalPath, `defaults:\n  planning: claude-opus-4-7\n`);
    writeFileSync(
      projectPath,
      `defaults:\n  planning: claude-sonnet-4-6\nagents:\n  analyst: { tier: planning }\n`,
    );
    const cfg = readModelConfig("analyst", tmpDir, { globalPath, projectPath });
    expect(cfg.model).toBe("claude-sonnet-4-6");
  });
});

describe("readModelConfig — missing files", () => {
  it("works with no project file (inherits global entirely)", () => {
    writeFileSync(
      globalPath,
      `defaults:\n  planning: claude-opus-4-7\nagents:\n  analyst: { tier: planning, effort: high }\n`,
    );
    // projectPath not written — missing file OK
    const cfg = readModelConfig("analyst", tmpDir, { globalPath, projectPath });
    expect(cfg.model).toBe("claude-opus-4-7");
    expect(cfg.effort).toBe("high");
  });

  it("throws when unknown agent has no defaults to fall through to", () => {
    writeFileSync(globalPath, `defaults:\n  planning: claude-opus-4-7\n`);
    expect(() =>
      readModelConfig("no-such-agent", tmpDir, { globalPath, projectPath }),
    ).toThrow(/No model resolved for agent 'no-such-agent'/);
  });
});

describe("readBudgetCaps", () => {
  it("returns default perPipelineMaxUsd when no config provides one", () => {
    writeFileSync(globalPath, `defaults: {}\n`);
    const caps = readBudgetCaps(tmpDir, { globalPath, projectPath });
    expect(caps.perPipelineMaxUsd).toBe(150);
    expect(caps.perStageMaxUsd).toEqual({});
  });

  it("reads perPipelineMaxUsd from global", () => {
    writeFileSync(
      globalPath,
      `budget:\n  perPipelineMaxUsd: 200\n  perStageMaxUsd:\n    analyze: 3\n    mockups: 10\n`,
    );
    const caps = readBudgetCaps(tmpDir, { globalPath, projectPath });
    expect(caps.perPipelineMaxUsd).toBe(200);
    expect(caps.perStageMaxUsd.analyze).toBe(3);
    expect(caps.perStageMaxUsd.mockups).toBe(10);
  });

  it("project budget overrides global perPipelineMaxUsd", () => {
    writeFileSync(globalPath, `budget:\n  perPipelineMaxUsd: 150\n`);
    writeFileSync(projectPath, `budget:\n  perPipelineMaxUsd: 500\n`);
    const caps = readBudgetCaps(tmpDir, { globalPath, projectPath });
    expect(caps.perPipelineMaxUsd).toBe(500);
  });

  it("project perStageMaxUsd merges with global (per-key override)", () => {
    writeFileSync(
      globalPath,
      `budget:\n  perStageMaxUsd:\n    analyze: 3\n    mockups: 10\n`,
    );
    writeFileSync(
      projectPath,
      `budget:\n  perStageMaxUsd:\n    analyze: 5\n    screens: 30\n`,
    );
    const caps = readBudgetCaps(tmpDir, { globalPath, projectPath });
    expect(caps.perStageMaxUsd.analyze).toBe(5); // project overrides
    expect(caps.perStageMaxUsd.mockups).toBe(10); // global preserved
    expect(caps.perStageMaxUsd.screens).toBe(30); // project-only added
  });
});
