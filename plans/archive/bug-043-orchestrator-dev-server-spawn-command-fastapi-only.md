---
id: bug-043-orchestrator-dev-server-spawn-command-fastapi-only
type: bug
status: completed
author-agent: human
created: 2026-05-03
updated: 2026-05-03
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/dev-server-stack-aware-spawn-command
affected-files:
  - orchestrator/src/dev-server.ts
  - orchestrator/tests/dev-server.test.ts
  - .claude/skills/agents/back-end/python-fastapi/SKILL.md
  - .claude/skills/agents/back-end/node-fastify/SKILL.md
  - .claude/skills/agents/back-end/node-trpc-nest/SKILL.md
  - .claude/skills/agents/back-end/node-express/SKILL.md
feature-area: orchestrator/dev-server + verifier-auto-boot
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "parity: dev-server: auto-boot failed: backend (apps/api/) did not respond on http://localhost:3001/health within 60000ms — verify uv is on PATH and the project's pyproject.toml is valid"
reproduction-steps: "Run /build-to-spec-verify on a project with backend_framework != python-fastapi (e.g. node-fastify, node-trpc-nest). Verifier's auto-boot calls spawnBackendDevServer which hardcodes `uv run uvicorn api.main:app --app-dir src` even when there's no Python project. uv either fails to find pyproject.toml OR isn't installed → spawn fails → verifier degrades or skips with misleading 'verify uv is on PATH' error."
stack-trace: null
---

# bug-043: orchestrator `spawnBackendDevServer` hardcodes FastAPI spawn command — fails on every non-FastAPI backend stack

## Bug Description

`orchestrator/src/dev-server.ts:119-150 spawnBackendDevServer` hardcodes the FastAPI spawn command for ALL backends:

```ts
export function spawnBackendDevServer(
  projectDir: string,
  port: number,
): ChildProcess | null {
  const apiDir = join(projectDir, "apps", "api");
  if (!existsSync(apiDir)) return null;
  const cmd = "uv";
  const args = [
    "run",
    "uvicorn",
    "api.main:app",
    "--app-dir",
    "src",
    "--host",
    "0.0.0.0",
    "--port",
    String(port),
  ];
  // ... spawn with cwd: apps/api ...
}
```

This is the verifier's auto-boot path used by `/build-to-spec-verify` to spin up the backend before parity-verify + flow-execution stages. It is the **runtime sister** of bug-040's `scripts/dev.mjs` (which is the operator's manual dev path). Both surfaces hardcode the FastAPI command — bug-040 fixes the project-side template; bug-043 fixes the orchestrator-side spawn.

For non-FastAPI backends:

- **node-fastify** (finance-track-01): backend boots via `pnpm --filter @repo/api dev` (which `tsx watch src/server.ts`). `uv run uvicorn` either fails immediately (no pyproject.toml in `apps/api/`) or exits non-zero on Windows where `uv` isn't on PATH.
- **node-trpc-nest**: `pnpm --filter @repo/api start:dev` (Nest CLI default).
- **node-express**: `pnpm --filter @repo/api dev`.

Result: parity-verify auto-boot times out at 60s waiting for `/health`, parity-verify SKIPS with "screens unchecked", and the run completes without ever validating the build matches the design.

This is the **fourth factory bug** in the seeding-pipeline failure chain (was originally captured as a cross-reference in bug-040; promoted to its own plan because it lives on a different surface — orchestrator TypeScript code, not architect-emitted templates).

## Reproduction Steps

1. Set up a project with `architecture.yaml.tooling.stack.backend_framework: node-fastify` (e.g. finance-track-01) — has `apps/api/` but NO `pyproject.toml`.
2. Manually delete or rename `<projectDir>/scripts/dev.mjs` (so the verifier falls back to its built-in spawn path rather than reusing the project's dev script).
3. Run `/build-to-spec-verify` (or directly: `node scripts/build-to-spec-verify.mjs --project <name>`).
4. Observe the verifier's parity-verify stage:
   ```
   parity: dev-server: auto-boot failed: backend (apps/api/) did not respond
     on http://localhost:3001/health within 60000ms —
     verify uv is on PATH and the project's pyproject.toml is valid
   ```
5. Underlying spawn: `spawn uv run uvicorn api.main:app …` either
   - on Windows without uv installed → `ENOENT: 'uv'` → child exits immediately
   - on Linux/Mac with uv installed → uv attempts to resolve a Python project → fails with `error: Failed to discover project (no pyproject.toml or workspace.toml)`

Working comparison: when running the same verifier on `repo-health-dashboard-01` (python-fastapi), the spawn succeeds → parity-verify proceeds normally. The bug only surfaces on non-FastAPI stacks.

Empirical case: 2026-05-02 finance-track-01 verifier rerun. Operator manually installed `@playwright/test` + chromium (post-bug-037), confirmed playwright config (post-bug-039 schema fix), then ran the verifier. The frontend booted (`pnpm -C apps/web dev` is stack-agnostic by accident), but the backend boot path failed. Verifier ran flows against an empty-state UI (no backend) → 9 false-positive flow failures.

## Error Output

From `apps/web/test-results/synthesized-flow-{1..9}-{...}/error-context.md` (page snapshot during failure):

```yaml
- main:
    - heading "No accounts yet" [level=3]
    - paragraph: "Add your first account to start tracking your finances across currencies."
    - button "Add account"
```

The dashboard rendered the empty-state shell because no API ever responded. Test failed at `assertVisible('[data-kit-component="Card"]:has-text("This month")')` — but the real cause was "no backend, no data" not "missing UI component".

## Root Cause Analysis

### Why the spawn command was hardcoded

`spawnBackendDevServer` was authored as part of bug-032 Phase C (2026-04-30) when only one project existed (repo-health-dashboard-01, python-fastapi). The author baked in the FastAPI command literally because there was one stack. The header even calls this out:

> "bug-032 Phase C: spawn the FastAPI backend via `uv run uvicorn ...`"

This is the same shape of bug as bug-038 (port-resolution defaulted to 8000) which was fixed by adding a `STACK_DEFAULT_BACKEND_PORT` lookup table keyed by `architecture.yaml.tooling.stack.backend_framework`. The spawn-command needs the same treatment.

### Why bug-038's fix didn't cover this

bug-038 fixed `resolveBackendPort` (where to look for the port) but not `spawnBackendDevServer` (how to actually start the process). The two functions are co-located in `dev-server.ts` but address different concerns. bug-038's STACK_DEFAULT_BACKEND_PORT table can be extended for spawn commands too — the data is already keyed by the same backend_framework slug.

### Why the project-side `scripts/dev.mjs` doesn't shield this surface

For projects that ship a working `scripts/dev.mjs` (per bug-040's fix), the orchestrator's verifier _could_ delegate to that script instead of running its own spawn. But:

1. Some projects don't have `scripts/dev.mjs` (single-tier web-only projects, or pre-bug-040 projects).
2. The orchestrator's verifier needs explicit lifecycle control (port coordination, signal teardown, output capture) that's harder to get when delegating to an opaque external script.
3. The orchestrator already does its own spawn for the frontend (`pnpm -C apps/web dev`); duplicating spawn ownership for the backend keeps the surface uniform.

So: fix the spawn command directly. The project-side `scripts/dev.mjs` is for OPERATOR use; the orchestrator's `spawnBackendDevServer` is for VERIFIER use. Both need stack-awareness independently.

## Fix Approach

### Phase A — stack-aware spawn-command resolver (P0, immediate)

Mirror bug-038's pattern. Add a `STACK_BACKEND_SPAWN_COMMAND` lookup table keyed by `architecture.yaml.tooling.stack.backend_framework` slug. Each entry specifies `{ cmd, args, cwd }` for that stack:

```ts
interface BackendSpawnSpec {
  cmd: string; // e.g. "uv" or "pnpm" / "pnpm.cmd" on Windows
  args: string[]; // resolved at spawn time with the actual port
  cwdRelativeToProject: string; // typically "apps/api" or "" for monorepo-root commands
}

function resolveBackendSpawnSpec(
  projectDir: string,
  port: number,
): BackendSpawnSpec | null {
  // 1. Read backend_framework from architecture.yaml (existing helper from bug-038)
  const slug = readBackendFrameworkSlug(projectDir);
  if (!slug) return null; // unknown — caller falls back to FastAPI default for backward compat
  // 2. Look up canonical spec
  return STACK_BACKEND_SPAWN_COMMAND[slug] ?? null;
}

const STACK_BACKEND_SPAWN_COMMAND: Record<
  string,
  (port: number) => BackendSpawnSpec
> = {
  "python-fastapi": (port) => ({
    cmd: "uv",
    args: [
      "run",
      "uvicorn",
      "api.main:app",
      "--app-dir",
      "src",
      "--host",
      "0.0.0.0",
      "--port",
      String(port),
    ],
    cwdRelativeToProject: "apps/api",
  }),
  "node-fastify": (port) => ({
    cmd: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    args: ["--filter", "@repo/api", "dev"],
    cwdRelativeToProject: "", // pnpm filter runs from monorepo root
  }),
  "node-trpc-nest": (port) => ({
    cmd: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    args: ["--filter", "@repo/api", "start:dev"],
    cwdRelativeToProject: "",
  }),
  "node-express": (port) => ({
    cmd: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    args: ["--filter", "@repo/api", "dev"],
    cwdRelativeToProject: "",
  }),
};
```

Refactor `spawnBackendDevServer` to consume the spec rather than hardcoding the command:

```ts
export function spawnBackendDevServer(
  projectDir: string,
  port: number,
): ChildProcess | null {
  const apiDir = join(projectDir, "apps", "api");
  if (!existsSync(apiDir)) return null;
  const spec =
    resolveBackendSpawnSpec(projectDir, port) ??
    STACK_BACKEND_SPAWN_COMMAND["python-fastapi"](port); // backward-compat fallback
  const isWin = process.platform === "win32";
  const child = spawn(spec.cmd, spec.args, {
    cwd: join(projectDir, spec.cwdRelativeToProject),
    stdio: ["ignore", "pipe", "pipe"],
    detached: !isWin,
    windowsHide: true,
    shell: isWin,
    env: { ...process.env, PORT: String(port) },
  });
  // ... rest unchanged ...
}
```

### Phase B — improved error diagnostic (P1)

The current error message hardcodes "verify uv is on PATH and pyproject.toml is valid" which is misleading on non-FastAPI stacks. Make the error stack-aware:

```ts
// in dev-server.ts spawn-failure handler:
const slug = readBackendFrameworkSlug(projectDir) ?? "python-fastapi";
throw new Error(
  `backend (${slug}) failed to start on http://localhost:${port}/health. ` +
    `Spawn: \`${spec.cmd} ${spec.args.join(" ")}\` from \`${spec.cwdRelativeToProject}\`. ` +
    HINTS_BY_SLUG[slug],
);

const HINTS_BY_SLUG = {
  "python-fastapi":
    "Verify uv is on PATH (where.exe uv / which uv) and apps/api/pyproject.toml is valid.",
  "node-fastify":
    "Verify pnpm is on PATH and apps/api/package.json declares a `dev` script (typically `tsx watch src/server.ts`).",
  "node-trpc-nest":
    "Verify pnpm is on PATH and apps/api/package.json declares a `start:dev` script (Nest CLI).",
  "node-express":
    "Verify pnpm is on PATH and apps/api/package.json declares a `dev` script.",
};
```

### Phase C — cross-document the spawn command in each backend stack skill (P1)

Each backend stack skill (`.claude/skills/agents/back-end/{slug}/SKILL.md`) gains a §dev-server-spawn subsection naming the canonical spawn command + cwd. Mirrors the existing §dev-orchestrator subsection from bug-040 Phase A.5 but documents the orchestrator's verifier-time spawn (different surface, same command shape). Keeps the spawn-command spec discoverable from the stack-skill docs that builders + reviewers already read.

### Phase D — regression tests (P0, ships with Phase A)

Author `orchestrator/tests/dev-server.test.ts` cases:

- `resolveBackendSpawnSpec` returns the FastAPI spec for `backend_framework: python-fastapi` (regression).
- Returns the fastify spec for `backend_framework: node-fastify`.
- Returns the trpc-nest spec for `backend_framework: node-trpc-nest`.
- Returns the express spec for `backend_framework: node-express`.
- Returns null when `architecture.yaml` is absent (caller falls back to FastAPI default).
- Returns null when `backend_framework` slug is unknown (caller falls back to FastAPI default).
- Test fixture: synthetic project tree with `apps/api/` + `architecture.yaml` containing each slug.

Plus: extend the existing `spawnBackendDevServer` integration test (if any) to cover at least one non-FastAPI spawn end-to-end (mock the child_process.spawn to assert the correct cmd/args were invoked).

### Phase E — empirical re-validation

After Phase A + B + C + D ship:

1. Run `/build-to-spec-verify` on finance-track-01 with `scripts/dev.mjs` deleted (force the verifier's built-in spawn path).
2. Confirm: backend boots via `pnpm --filter @repo/api dev` on port 3001, `/health` returns 200, parity-verify proceeds.
3. Run `/build-to-spec-verify` on repo-health-dashboard-01 (regression).
4. Confirm: backend still boots via `uv run uvicorn` on port 8000 (no FastAPI regression).

## Rejected Fixes

- **Delegate to project's `scripts/dev.mjs` instead of orchestrator-side spawn** — Rejected. (1) Single-tier web-only projects don't have it. (2) Pre-bug-040 projects don't have it. (3) Orchestrator needs explicit lifecycle control (port coordination, signal teardown, child-output capture) that's harder when delegating. (4) Frontend already gets its own orchestrator-side spawn (`pnpm -C apps/web dev`); keeping backend ownership uniform.
- **Read the spawn command from `apps/api/package.json`'s `dev` script** — Rejected. Couples orchestrator to convention drift; some stacks use `start:dev` (Nest), some use `dev` (fastify), some don't have package.json at all (FastAPI). The architecture.yaml `backend_framework` slug is the canonical signal for stack-shape decisions.
- **Probe the apps/api/ directory to detect stack** (look for pyproject.toml vs package.json) — Rejected. Indirect signal; both can co-exist (e.g. python project with a tooling package.json). Architecture.yaml is the authoritative stack declaration.
- **Make the spawn fail fast with "missing architecture.yaml" instead of falling back to FastAPI** — Rejected for backward compat. Existing repo-health-dashboard-01 may not have an architecture.yaml in some operator workflows. Falling back to FastAPI on unknown slug preserves the legacy behavior; new projects with explicit slug benefit immediately.

## Validation Criteria

### Phase A (stack-aware resolver)

- [ ] `STACK_BACKEND_SPAWN_COMMAND` table covers python-fastapi, node-fastify, node-trpc-nest, node-express.
- [ ] `spawnBackendDevServer` consumes the spec instead of hardcoding `uv run uvicorn`.
- [ ] Backward-compat fallback to FastAPI when slug unknown / architecture.yaml absent.

### Phase B (diagnostic)

- [ ] Error message names the spawn command actually attempted (not just the FastAPI assumption).
- [ ] HINTS_BY_SLUG covers all 4 stacks.

### Phase C (stack-skill docs)

- [ ] Each backend SKILL.md has §dev-server-spawn subsection naming canonical cmd + cwd + port.

### Phase D (regression tests)

- [ ] `orchestrator/tests/dev-server.test.ts` has ≥4 cases for `resolveBackendSpawnSpec` + edge-case fallback cases.
- [ ] Existing 607/607 orchestrator tests still pass; ≥4 new cases bring it to 611+.

### Phase E (empirical)

- [ ] finance-track-01 verifier auto-boot succeeds without `scripts/dev.mjs` (proves orchestrator-side fix works in isolation from bug-040).
- [ ] repo-health-dashboard-01 verifier auto-boot still succeeds (regression).

## Cross-references

- **Sister to bug-038**: same surface (`orchestrator/src/dev-server.ts`), same lookup-table pattern, complementary concern (port resolution vs spawn command). bug-038 Phase A SHIPPED `407b37b` — bug-043 reuses its `readBackendFrameworkSlug` helper + `STACK_DEFAULT_BACKEND_PORT` table key shape.
- **Sister to bug-040**: same problem (FastAPI hardcoding) on a different surface (orchestrator runtime vs project-side template). Both must ship for end-to-end E2E to work on non-FastAPI stacks.
- **Empirical case**: 2026-05-02 finance-track-01 verifier rerun — surfaced as a cross-reference in bug-040 root-cause analysis; promoted to its own plan because it can ship + validate independently.
- **Sequencing**: Wave 0 — bug-043 SOLO first (smallest scope, validates stack-aware spawn approach cheaply). Wave 1 — bug-040 + bug-041 + bug-042 in parallel. Wave 2 — empirical end-to-end on finance-track-01.
- **Predecessor**: feat-042 (node-fastify stack skill, archived 2026-05-01) — the stack skill exists but doesn't yet declare the canonical spawn command. Phase C closes that gap.

## Attempt Log

<!-- populated as fix attempts are made -->
