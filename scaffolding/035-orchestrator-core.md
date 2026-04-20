---
task-id: "035"
title: "Orchestrator Core (Stage Runner + SDK Integration)"
status: pending
priority: P2
tier: 9 — Orchestrator
depends-on: ["011", "013", "025b", "034", "034b", "036", "038", "041"]
estimated-scope: large
---

# 035: Orchestrator Core

## What This Task Produces

The external TypeScript orchestrator that drives the entire pipeline via the Claude Agent SDK.

## Scope

From blueprint Sections 3, 11, 24:

### Core Module: `orchestrator/index.ts`

Define `PipelineStage` interface:

```typescript
interface PipelineStage {
  name: string; // e.g., "analyze"
  slashCommand: string; // e.g., "/analyze"
  outputSchema: z.ZodSchema; // imported from task 034b
  gateEnabled: boolean; // HITL gate after this stage
  gateType?: "requirements" | "mockups" | "design-system" | "signoff";
  budgetUsd: number;
  agent: string; // resolves model via model-config
  dependsOn?: string[]; // stages that must complete first
  args?: string[]; // runtime invocation args appended to slashCommand (e.g., ["--screen", "webapp/dashboard"] for single-screen /screens retries)
}
```

### Stage sequence — refactor-003 order (canonical)

Refactor-003 reordered the pipeline so architect + PM run **after** design sign-off. Design stages run directly after analyze + skills-audit-design. Gate 5 (credentials, file-drop) sits between architect and PM. Blueprint Appendix C records the reasoning; this array is the source of truth.

```typescript
const STAGES: PipelineStage[] = [
  // ─── PLANNING PHASE ───
  {
    name: "analyze",
    slashCommand: "/analyze",
    gateEnabled: true,
    gateType: "requirements",
    agent: "analyst",
  },
  {
    name: "skills-audit-design", // refactor-003: split from the old "skills-audit" single stage
    slashCommand: "/skills-audit --scope=design",
    gateEnabled: false,
    agent: "skills",
  },
  // ─── DESIGN PHASE ───
  {
    name: "mockups",
    slashCommand: "/mockups",
    gateEnabled: true,
    gateType: "mockups",
    agent: "ui-designer",
  },
  {
    name: "stylesheet",
    slashCommand: "/stylesheet",
    gateEnabled: true,
    gateType: "design-system",
    agent: "ui-designer",
  },
  {
    name: "screens",
    slashCommand: "/screens",
    gateEnabled: false, // no gate — /visual-review runs right after
    agent: "ui-designer",
  },
  {
    name: "visual-review", // refactor-001 addition / task 025b
    slashCommand: "/visual-review",
    gateEnabled: false,
    agent: "ui-designer", // invokes html-verifier + Playwright MCP
    dependsOn: ["screens"],
  },
  {
    name: "user-flows",
    slashCommand: "/user-flows-generator",
    gateEnabled: true,
    gateType: "signoff", // design sign-off — binds screens + review + uiKitVersion
    agent: "ui-designer",
    dependsOn: ["visual-review"],
  },
  // ─── POST-DESIGN PLANNING (refactor-003) ───
  {
    name: "architect",
    slashCommand: "/architect",
    gateEnabled: true,
    gateType: "credentials", // gate 5 — file-drop; never disable (builders have no .env otherwise)
    agent: "architect",
    dependsOn: ["user-flows"],
  },
  {
    name: "pm",
    slashCommand: "/pm --mode=tasks", // refactor-003 dual-mode; main run is tasks.yaml
    gateEnabled: false,
    agent: "pm",
    dependsOn: ["architect"],
  },
  {
    name: "skills-audit-build", // refactor-003: second scope — vendor SDKs from architecture.yaml
    slashCommand: "/skills-audit --scope=build",
    gateEnabled: false,
    agent: "skills",
    dependsOn: ["pm"],
  },
  {
    name: "register-mcp-build", // refactor-003: usually no-op; preserved for architect MCP extensions
    slashCommand: "/register-mcp-servers --scope=build",
    gateEnabled: false,
    agent: "orchestrator",
    dependsOn: ["skills-audit-build"],
  },
  // ─── BUILD PHASE ───
  {
    name: "build-backend",
    slashCommand: "/build-backend",
    gateEnabled: false,
    agent: "backend-builder",
    dependsOn: ["register-mcp-build"],
  },
  {
    name: "build-web",
    slashCommand: "/build-web",
    gateEnabled: false,
    agent: "web-frontend-builder",
    dependsOn: ["build-backend"],
  },
  {
    name: "build-mobile",
    slashCommand: "/build-mobile",
    gateEnabled: false,
    agent: "mobile-frontend-builder",
    dependsOn: ["build-backend"],
  },
  { name: "test", slashCommand: "/test", gateEnabled: false, agent: "tester" },
  {
    name: "review",
    slashCommand: "/review",
    gateEnabled: false,
    agent: "reviewer",
  },
  // ─── SHIP PHASE ───
  { name: "git", slashCommand: "/git", gateEnabled: false, agent: "git" },
];
```

**Critical: design-stage MCP servers are NOT registered here.** The fixed design-stage MCP default set (playwright, icons8, unsplash, chrome-devtools, and optional image-generator behind `--flags=nanobanana`) is registered at `/new-project` time from `mcp-defaults-design.json` via `/register-mcp-servers --scope=design`. By the time the orchestrator runs, those servers are already in `.mcp.json`. The `register-mcp-build` stage only appends vendor-specific MCP servers if the architect added any — usually zero, since vendor SDKs are NPM packages, not MCP servers. The stage is retained in the array so the registration contract is uniform.

**Refactor-003 ordering rationale:** Design stages (022–025b) are framework-agnostic by contract — they emit HTML + CSS + CVA variants, not React/Vue/Svelte. Nothing in the design flow reads architect output. Moving architect post-signoff means (a) vendor decisions reflect what the user actually approved, (b) credentials get captured at a gate where the user has full context, (c) the architect sees composed screens when scoping SDK imports. Blueprint §23 L2765-2822 is superseded by this array and by blueprint Appendix C.

**Refactor-001 design-phase note:** `screens` and `visual-review` are distinct stages with `visual-review` gating the user-flows sign-off. `screens` itself has no gate — its work always flows into `/visual-review`. If visual-review flags a screen, the orchestrator re-invokes `screens` in single-screen mode (see "Visual-review retry loop" below), not the whole design pipeline.

`build-web` and `build-mobile` run in parallel (both depend only on `build-backend`). The orchestrator respects `dependsOn` to schedule parallelism.

### Pipeline-wide flag set (refactor-001)

The orchestrator accepts a `--flags=<comma-separated>` CLI argument (currently only `nanobanana` is recognized by 041 + 034b's `FeatureFlag` enum). On pipeline start:

1. Parse the flag set; validate every name against `FeatureFlag` from `@repo/orchestrator-contracts`
2. Pass the flag set to `/register-mcp-servers` (task 041) as `--flags=nanobanana` so feature-flagged servers are included/omitted in `.mcp.json` + agent frontmatter accordingly
3. Forward the flag set as env var `CLAUDE_PIPELINE_FLAGS=nanobanana` into every `query()` invocation so skills can read it (most trust the MCP registry instead, but `/mockups` and `/stylesheet` record the flag state in their return JSON and manifests)
4. At budget-check time, only enforce `totalImageGenCalls` when `nanobanana` is in the active set

Switching flags between runs is deterministic — 041 is idempotent on identical `(architecture.yaml, flagSet)` inputs.

### Gate API base URL threading

Gates 2 and 4 (task 036) spin ephemeral HTTP servers on dynamic ports. The orchestrator:

1. Starts the server just before the producing stage renders its HTML (so the port is known when `/mockups` or `/user-flows-generator` writes `index.html` / `user-flows.html`)
2. Passes the resolved `GATE_API_BASE` (e.g., `http://localhost:8733`) to the stage as env var `CLAUDE_GATE_API_BASE`
3. Skills use it to replace the `{{GATE_API_BASE}}` placeholder in their templates before writing
4. Kills the server when the gate resolves (file watch on `docs/selected-style.json` or `docs/signoff-*.json`)

### Visual-review retry loop (refactor-001)

After `/screens` batch completes and `/visual-review` (025b) runs, the orchestrator processes the result:

```ts
for (const failure of visualReviewOutput.violations.filter(
  (v) => v.severity === "error",
)) {
  const screen = failure.screen; // "webapp/dashboard"
  const counter = visualRetryCounters.get(screen) ?? 0;
  if (counter >= 3) {
    visualReviewOutput.needsHumanReview.push(screen);
    continue;
  }
  visualRetryCounters.set(screen, counter + 1);
  // re-invoke /screens in single-screen mode; retry-feedback.md already written by 025b
  await runStage({
    ...STAGES.find((s) => s.name === "screens"),
    args: ["--screen", screen],
  });
  // re-run /visual-review (it's stateless — fresh report each run)
  visualReviewOutput = await runStage(
    STAGES.find((s) => s.name === "visual-review"),
  );
}
```

Visual retries are **independent** of Layer 5 retries:

- Layer 5 retries = retries of a whole stage after schema validation fails (max 3)
- Visual retries = per-screen retries after /visual-review rubric fails (max 3 per screen)

A screen can theoretically consume up to 6 retries total (3 Layer 5 on `/screens` producing it + 3 visual-review re-generations), but in practice 3+3 is the extreme case; screens flagged `needsHumanReview` move the decision to the human reviewer at gate 4.

### Kit-change-request detour (refactor-001 + refactor-003 PM dual-mode)

`/screens`, `/build-web`, and `/build-mobile` can all emit `docs/screens/kit-change-requests/{screen-id}.md` when a required primitive / pattern / layout doesn't exist in the kit. On detection:

1. Halt the emitting stage (no retry; this is a structural gap, not a generation failure)
2. **Invoke PM agent in `--mode=kit-change-request`** (refactor-003 dual-mode; see task 021). PM reads the kit-change-request file + current `packages/ui-kit/package.json` version, writes `plans/active/kit-change-request-{id}.md` mini-plan describing the needed kit update. PM in this mode does NOT require `architecture.yaml` to exist — crucially important since design-phase detours fire BEFORE the main architect stage has run.
3. Re-run `/stylesheet` (task 024) with the PM's mini-plan injected so the kit bumps to a new minor version (e.g., `1.0.0 → 1.1.0`); the kit's CHANGELOG.md gets a new entry
4. **If the detour was triggered DURING the design phase** (from `/screens`): resume `/screens`, then `/visual-review`, then `/user-flows-generator`. Sign-off is NOT yet bound — re-running is clean.
5. **If the detour was triggered AFTER sign-off** (from `/build-web` or `/build-mobile`): this is catastrophic — the kit bump breaks `signoff.uiKitVersion`, invalidating the sign-off. The orchestrator:
   - Surfaces a red-flag warning to the human
   - Reverts to `/screens` (regenerate with the new kit)
   - Re-runs `/visual-review`
   - Re-opens the sign-off gate (gate 4) — and since the sign-off is invalidated, gate 5's captured credentials may also need re-validation if the kit change altered vendor decisions. The orchestrator re-runs `/architect` in this case; the architect's re-run will emit `docs/credentials-diff.md` if vendor decisions changed, and gate 5 re-opens. If no vendor decisions changed, the existing `.env` stays valid and gate 5 auto-advances without re-prompting.
   - Once fresh sign-off + credentials land, resumes the build phase

**Main PM stage is unaffected.** The post-architect `pm` stage in STAGES still runs in `--mode=tasks` and produces `docs/tasks.yaml`. Detour PM invocations produce mini-plans only; the main stage subsumes them into tasks.yaml as "Kit v{1.1.0}: implement primitive X per plans/active/kit-change-request-{id}.md" task entries.

Either way, the detour is automated but transparent — the human sees the design-pipeline restart in the log. Max 2 kit-change detours per pipeline run before escalating to manual human-review (otherwise a circular kit-incomplete bug could burn unlimited budget).

### `runStage()` + `runPipeline()`

- `runStage()` calls `query()` from the Claude Agent SDK with resolved model/effort/budget. Forwards `CLAUDE_PIPELINE_FLAGS` and (when gated) `CLAUDE_GATE_API_BASE` as env vars.
- `runPipeline()` walks the stage array: reserve budget → run → validate output against `outputSchema` (from `StageSchemas` in task 034b) → checkpoint context (task 013) → check gate → proceed
- On validation failure: retry with feedback (§13 Layer 5), max 3 attempts
- On visual-review failure: run the visual-review retry loop above (per-screen, separate counter)
- On kit-change-request emission: trigger the detour flow above

### Model Config Reader: `orchestrator/model-config.ts` (§7 L862-918)

Reads and merges `~/.claude/models.yaml` + `.claude/models.yaml` with env override. Reference implementation:

```typescript
import yaml from "js-yaml";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

interface ModelConfig {
  model: string;
  effort: "low" | "medium" | "max";
  budgetUsd: number;
}

export function readModelConfig(
  agentName: string,
  projectRoot: string,
): ModelConfig {
  const globalPath = join(homedir(), ".claude", "models.yaml");
  const projectPath = join(projectRoot, ".claude", "models.yaml");

  const globalCfg = existsSync(globalPath)
    ? (yaml.load(readFileSync(globalPath, "utf8")) as any)
    : {};
  const projectCfg = existsSync(projectPath)
    ? (yaml.load(readFileSync(projectPath, "utf8")) as any)
    : {};

  // Project agents override global agents; project defaults override global defaults.
  const merged = {
    ...globalCfg.defaults,
    ...(globalCfg.agents?.[agentName] ?? {}),
    ...projectCfg.defaults,
    ...(projectCfg.agents?.[agentName] ?? {}),
  };

  // Env var is the final override (escape hatch per CLAUDE.md).
  if (process.env.ANTHROPIC_MODEL) merged.model = process.env.ANTHROPIC_MODEL;

  if (!merged.model)
    throw new Error(`No model resolved for agent '${agentName}'`);
  if (!merged.effort) merged.effort = "medium";
  if (!merged.budgetUsd) merged.budgetUsd = 5;

  return merged as ModelConfig;
}
```

### Stage Runner: `orchestrator/stage-runner.ts`

- Calls `query()` with resolved model/effort/budget from `readModelConfig(stage.agent, ...)`
- Writes stage output to `pipeline/{stage}-output.json` validated against `stage.outputSchema`
- Structured output enforced via SDK's `outputFormat` when available; else post-validates with Zod

### Cost Estimation: `orchestrator/cost-estimator.ts` (§7 L966-985)

```typescript
interface StageEstimate {
  stage: string;
  model: string;
  estimatedInputTokens: number; // heuristic: brief length × fan-out factor per stage
  estimatedOutputTokens: number; // heuristic per stage type
  estimatedUsd: number;
}

interface PipelineEstimate {
  stages: StageEstimate[];
  totalUsd: number;
  safetyMarkupPct: 20; // show totalUsd × 1.20 as the "up to" figure
  budgetCapUsd: number; // from project models.yaml
}
```

Display per-stage breakdown + total + markup-adjusted worst case BEFORE starting. Block if `totalUsd × 1.20` exceeds `budgetCapUsd`. Require typed `yes` to proceed (not just enter).

### Entry Point

- Root `package.json` (factory) adds: `"scripts": { "generate": "tsx orchestrator/index.ts generate" }`
- `pnpm generate [project-name]` — resolves `projects/<name>/` as the working directory
- If `<name>` omitted and only one project exists, use it; else list and prompt
- Pre-run: display cost estimate, await confirmation
- Post-run: invoke `/save-context` checkpoint, move completed plans to `plans/archive/`, invoke Lessons Agent (§23 step 22)

## Acceptance Criteria

- [ ] `orchestrator/` package exists with TypeScript source
- [ ] Stage sequence matches the refactor-003 `STAGES` array above EXACTLY (blueprint §23 L2765-2822 is historical; blueprint Appendix C is canonical)
- [ ] Pipeline order: `analyze → skills-audit-design → mockups → stylesheet → screens → visual-review → user-flows → architect → pm → skills-audit-build → register-mcp-build → build-backend → (build-web || build-mobile) → test → review → git`
- [ ] Architect runs POST-signoff, not pre-design; `architect.dependsOn` is `["user-flows"]`
- [ ] Gate 5 (credentials, file-drop, `gateType: "credentials"`) sits between `architect` and `pm`; `pm.dependsOn` is `["architect"]`
- [ ] `skills-audit-design` runs once pre-mockups (scope=design); `skills-audit-build` runs once post-PM (scope=build)
- [ ] `register-mcp-build` stage is present between `skills-audit-build` and `build-backend`; may be no-op when architect added no build-stage MCP servers
- [ ] Design-stage MCP servers are NOT registered by the orchestrator at runtime; they're pre-registered at `/new-project` time from `mcp-defaults-design.json`
- [ ] `screens` has `gateEnabled: false`; `user-flows` is where the design sign-off gate lives (`gateType: "signoff"`)
- [ ] `build-web` and `build-mobile` schedule in parallel (both `dependsOn: ["build-backend"]`)
- [ ] Model config reader merges global + project YAML with `ANTHROPIC_MODEL` env override
- [ ] Cost estimation displayed with per-stage breakdown + 20% safety markup; typed `yes` required
- [ ] Cost estimate blocks the run if markup-adjusted total exceeds project budget cap
- [ ] Each stage output validated against `StageSchemas[stageName]` from task 034b before proceeding
- [ ] Failed schema validation triggers Layer 5 retry-with-feedback, max 3 attempts
- [ ] `--flags=nanobanana` CLI argument parsed, validated against `FeatureFlag` enum, and forwarded to 041 + every `query()` invocation as `CLAUDE_PIPELINE_FLAGS` env var
- [ ] When `nanobanana` is active, `totalImageGenCalls` budget is enforced; when inactive, it's ignored and `image-generator` is absent from `.mcp.json`
- [ ] Gates 2 and 4 receive a dynamically-assigned `CLAUDE_GATE_API_BASE` env var; producing skills replace `{{GATE_API_BASE}}` placeholder at render time
- [ ] Visual-review retry loop: per-screen counter (max 3 per screen) separate from Layer 5 stage-retry counter; re-invokes `/screens` in `--screen {id}` mode
- [ ] Screens that exhaust visual retries land in `VisualReviewOutput.needsHumanReview` and surface at gate 4 for manual decision
- [ ] Kit-change-request detour triggers when `/screens`, `/build-web`, or `/build-mobile` emits `docs/screens/kit-change-requests/`: halts emitting stage, invokes PM with `--mode=kit-change-request` (refactor-003 dual-mode), re-runs `/stylesheet` (bumps kit minor version), resumes
- [ ] PM in `--mode=kit-change-request` does NOT require `architecture.yaml` to exist (design-phase detours fire before main architect stage)
- [ ] Post-sign-off kit-change-request is flagged red, reopens gate 4 (signoff invalidated by kit version drift), AND re-runs `/architect` if the kit change altered vendor decisions (gate 5 reopens only when architect's new decisions produce a non-empty credentials-diff.md)
- [ ] Max 2 kit-change detours per pipeline run before escalating to human
- [ ] `pnpm generate [project-name] [--flags=...]` resolves the correct `projects/<name>/` working directory
- [ ] Post-run hook archives plans and invokes Lessons Agent (§23 step 22)

## Human Verification

1. Run the pipeline end-to-end with all gates enabled. Does `screens → visual-review → user-flows-generator → sign-off gate` sequence in that exact order?
2. Run with `--flags=nanobanana`. Does `.mcp.json` include `image-generator`? Does the orchestrator enforce `totalImageGenCalls`?
3. Run without `--flags`. Is `image-generator` absent from `.mcp.json`? Do `/mockups` and `/stylesheet` record `nanobananaUsed: false` in their return JSON?
4. Hand-inject a failing visual-review result for one screen. Does the orchestrator re-invoke `/screens --screen {id}` with feedback? Does the counter reset per-screen?
5. Hand-inject a kit-change-request file during `/screens`. Does the detour trigger `/stylesheet` re-run + kit minor bump + resume?
6. Trigger a kit-change-request AFTER sign-off (e.g., from `/build-web`). Does the orchestrator re-open gate 4 with a red-flag warning?
