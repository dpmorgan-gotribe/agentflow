---
task-id: "035"
title: "Orchestrator Core (Stage Runner + SDK Integration)"
status: pending
priority: P2
tier: 9 — Orchestrator
depends-on: ["011", "034"]
estimated-scope: large
---

# 035: Orchestrator Core

## What This Task Produces
The external TypeScript orchestrator that drives the entire pipeline via the Claude Agent SDK.

## Scope
From blueprint Sections 3, 11, 24:

### Core Module: `orchestrator/index.ts`
- Define `PipelineStage` interface: name, slashCommand, outputSchema, gateEnabled, budgetUsd
- Define the stage sequence: analyze → mockups → stylesheet → screens → architect → build-backend → build-frontend → test → review → git
- `runStage()` function that calls `query()` from Claude Agent SDK
- `runPipeline()` function that sequences stages with gate checks

### Model Config Reader: `orchestrator/model-config.ts`
From blueprint lines 862-918:
- `readModelConfig(agentName)` — reads and merges `~/.claude/models.yaml` + `.claude/models.yaml`
- Returns `{ model, effort, budgetUsd }`
- Supports env var override via `ANTHROPIC_MODEL`

### Stage Runner: `orchestrator/stage-runner.ts`
- Calls `query()` with resolved model, effort, budget
- Writes stage output to `pipeline/{stage}-output.json`
- Handles structured output via `outputFormat`

### Cost Estimation: `orchestrator/cost-estimator.ts`
From blueprint lines 966-985:
- Display estimated cost per stage before running
- Show pipeline budget
- Require user confirmation before proceeding

### Entry Point
- `pnpm generate` command that runs the orchestrator
- Pre-run: confirm cost estimate with user
- Post-run: archive contexts, move plans to archive

## Acceptance Criteria
- [ ] `orchestrator/` package exists with TypeScript source
- [ ] Stage sequence matches blueprint pipeline
- [ ] Model config reader merges global + project YAML
- [ ] Cost estimation displayed before pipeline start
- [ ] Each stage output written to `pipeline/` directory
- [ ] `pnpm generate` command wired up

## Human Verification
Review the orchestrator architecture — is the stage sequence correct? Is the SDK integration pattern sound?
