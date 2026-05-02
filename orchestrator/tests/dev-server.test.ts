import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveBackendPort } from "../src/dev-server.js";

/**
 * bug-038 Phase A regression tests for `resolveBackendPort`. Covers the
 * extended 7-tier precedence chain:
 *
 *   1. process.env.PORT
 *   2. process.env.BACKEND_PORT
 *   3. apps/api/.env.local PORT or BACKEND_PORT
 *   4. apps/api/.env PORT or BACKEND_PORT
 *   5. architecture.yaml backend_framework stack-default
 *   6. legacy 8000 (FastAPI fallback)
 *
 * Each test seeds a temp project tree with the minimum files needed to
 * trigger one specific tier + asserts that tier is the one resolved.
 */

const STACK_DEFAULT_BACKEND_PORTS = {
  "python-fastapi": 8000,
  "node-fastify": 3001,
  "node-trpc-nest": 4000,
  "node-express": 4000,
};

function seedProjectWithApiTier(projectDir: string): void {
  mkdirSync(join(projectDir, "apps", "api"), { recursive: true });
}

function seedArchitecture(projectDir: string, backendFramework: string): void {
  mkdirSync(join(projectDir, ".claude"), { recursive: true });
  // Minimal architecture.yaml that the regex-based reader can parse.
  writeFileSync(
    join(projectDir, ".claude", "architecture.yaml"),
    `version: "1.0"
tooling:
  stack:
    backend_framework: ${backendFramework}
`,
    "utf8",
  );
}

describe("resolveBackendPort (bug-038 Phase A)", () => {
  let tempDir: string;
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "dev-server-bug038-"));
    envBackup.PORT = process.env.PORT;
    envBackup.BACKEND_PORT = process.env.BACKEND_PORT;
    delete process.env.PORT;
    delete process.env.BACKEND_PORT;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    if (envBackup.PORT === undefined) delete process.env.PORT;
    else process.env.PORT = envBackup.PORT;
    if (envBackup.BACKEND_PORT === undefined) delete process.env.BACKEND_PORT;
    else process.env.BACKEND_PORT = envBackup.BACKEND_PORT;
  });

  it("returns null when project has no apps/api/ tier", () => {
    expect(resolveBackendPort(tempDir)).toBeNull();
  });

  it("tier 1: process.env.PORT wins over everything else", () => {
    seedProjectWithApiTier(tempDir);
    seedArchitecture(tempDir, "node-fastify");
    writeFileSync(join(tempDir, "apps/api/.env.local"), "PORT=7777\n", "utf8");
    process.env.PORT = "9000";
    expect(resolveBackendPort(tempDir)).toBe(9000);
  });

  it("tier 2: process.env.BACKEND_PORT wins when PORT absent", () => {
    seedProjectWithApiTier(tempDir);
    seedArchitecture(tempDir, "node-fastify");
    writeFileSync(join(tempDir, "apps/api/.env.local"), "PORT=7777\n", "utf8");
    process.env.BACKEND_PORT = "9001";
    expect(resolveBackendPort(tempDir)).toBe(9001);
  });

  it("tier 3a: apps/api/.env.local BACKEND_PORT wins over .env (canonical post bug-033)", () => {
    seedProjectWithApiTier(tempDir);
    writeFileSync(
      join(tempDir, "apps/api/.env.local"),
      "BACKEND_PORT=4001\n",
      "utf8",
    );
    writeFileSync(join(tempDir, "apps/api/.env"), "PORT=8001\n", "utf8");
    expect(resolveBackendPort(tempDir)).toBe(4001);
  });

  it("tier 3b: apps/api/.env.local PORT works when BACKEND_PORT absent", () => {
    seedProjectWithApiTier(tempDir);
    writeFileSync(join(tempDir, "apps/api/.env.local"), "PORT=4002\n", "utf8");
    expect(resolveBackendPort(tempDir)).toBe(4002);
  });

  it("tier 4: apps/api/.env (legacy) when .env.local absent", () => {
    seedProjectWithApiTier(tempDir);
    writeFileSync(join(tempDir, "apps/api/.env"), "PORT=4003\n", "utf8");
    expect(resolveBackendPort(tempDir)).toBe(4003);
  });

  it("tier 5: architecture.yaml backend_framework stack-default — fastify→3001", () => {
    seedProjectWithApiTier(tempDir);
    seedArchitecture(tempDir, "node-fastify");
    expect(resolveBackendPort(tempDir)).toBe(
      STACK_DEFAULT_BACKEND_PORTS["node-fastify"],
    );
  });

  it("tier 5: architecture.yaml backend_framework stack-default — fastapi→8000", () => {
    seedProjectWithApiTier(tempDir);
    seedArchitecture(tempDir, "python-fastapi");
    expect(resolveBackendPort(tempDir)).toBe(
      STACK_DEFAULT_BACKEND_PORTS["python-fastapi"],
    );
  });

  it("tier 5: architecture.yaml backend_framework stack-default — trpc-nest→4000", () => {
    seedProjectWithApiTier(tempDir);
    seedArchitecture(tempDir, "node-trpc-nest");
    expect(resolveBackendPort(tempDir)).toBe(
      STACK_DEFAULT_BACKEND_PORTS["node-trpc-nest"],
    );
  });

  it("tier 5: architecture.yaml backend_framework stack-default — express→4000", () => {
    seedProjectWithApiTier(tempDir);
    seedArchitecture(tempDir, "node-express");
    expect(resolveBackendPort(tempDir)).toBe(
      STACK_DEFAULT_BACKEND_PORTS["node-express"],
    );
  });

  it("tier 6: legacy fallback to 8000 when nothing resolves", () => {
    seedProjectWithApiTier(tempDir);
    // No .env / .env.local / architecture.yaml — falls through to legacy 8000.
    expect(resolveBackendPort(tempDir)).toBe(8000);
  });

  it("tier 6: unknown backend_framework slug falls through to 8000", () => {
    seedProjectWithApiTier(tempDir);
    seedArchitecture(tempDir, "elixir-phoenix"); // not in STACK_DEFAULT table
    expect(resolveBackendPort(tempDir)).toBe(8000);
  });

  it("tolerates malformed architecture.yaml without throwing", () => {
    seedProjectWithApiTier(tempDir);
    mkdirSync(join(tempDir, ".claude"), { recursive: true });
    writeFileSync(
      join(tempDir, ".claude", "architecture.yaml"),
      "this is not valid yaml at all\n[[[",
      "utf8",
    );
    // Falls through to legacy 8000.
    expect(resolveBackendPort(tempDir)).toBe(8000);
  });

  it("ignores PORT lines that don't parse as positive integers", () => {
    seedProjectWithApiTier(tempDir);
    writeFileSync(
      join(tempDir, "apps/api/.env.local"),
      "PORT=not-a-number\n",
      "utf8",
    );
    seedArchitecture(tempDir, "node-fastify");
    // Falls through to stack-default.
    expect(resolveBackendPort(tempDir)).toBe(3001);
  });

  it("empirical case: finance-track-01-shape (fastify + .env.local PORT=4000)", () => {
    seedProjectWithApiTier(tempDir);
    seedArchitecture(tempDir, "node-fastify");
    writeFileSync(join(tempDir, "apps/api/.env.local"), "PORT=4000\n", "utf8");
    // Should hit tier 3 (.env.local PORT) → 4000, NOT tier 5 stack-default 3001
    // and definitely NOT legacy 8000 (the bug-038 broken behavior).
    expect(resolveBackendPort(tempDir)).toBe(4000);
  });
});
