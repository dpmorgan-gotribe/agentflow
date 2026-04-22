# python-stack-codegens

**Deferred from**: investigate-002-build-tier-readiness-gap §Phase 3 Cross-cutting tooling gap.

## The concern

`python-fastapi` stack skill (`/.claude/skills/agents/back-end/python-fastapi/SKILL.md`) references a `zod-to-pydantic` codegen that translates `@repo/types` Zod schemas into a matching Python `packages/python-types/` package. The codegen doesn't exist.

Without it, a Python backend can't consume the canonical `@repo/types` source — the backend would have to hand-maintain parallel Pydantic models with no enforced sync. Breaks the single-source-of-truth principle the rest of the factory depends on.

## Why deferred

No current project has picked `backend_framework: python-fastapi`. The factory's default is `node-trpc-nest` (Node + TypeScript + Zod native). Until a brief explicitly names Python, the codegen sits unused.

## Rough shape when it's time

1. **`scripts/zod-to-pydantic.mjs`** (factory-root, copied into project at `/new-project` step 5b when `backend_language: python`) — walks `packages/types/src/**/*.ts`, parses Zod schemas, emits equivalent Pydantic v2 models with `ConfigDict(from_attributes=True)`.
2. **Runs in a `pnpm run codegen:python-types` Turborepo task**, wired into the build pipeline so `packages/python-types/` is always current.
3. **CI check**: if `packages/types/` changed without a matching `packages/python-types/` regeneration, fail the build.
4. **Complex types** — Zod `.refine()`, `.transform()`, `.discriminatedUnion()` don't always have Pydantic equivalents. Codegen emits best-effort + flags TODOs in a comment block; reviewer agent surfaces unresolved TODOs.

**Reference implementations**: `zod-to-pydantic` (npm package) exists but is lightly maintained; evaluate vs rolling our own. Also `pydantic` + `datamodel-code-generator` in reverse (from JSON Schema) could route through `z.toJsonSchema(schema)`.

Estimated size: small-to-medium plan. ~300-500 LOC in the codegen + CI wiring + stack-skill update to reference the new script.

## Related

- Similar pattern needed for **Go** (`zod-to-go-structs` — when `backend_language: go`)
- Similar for **Rust** (`zod-to-serde` — when `backend_language: rust`)

Each follows the same shape: emit best-effort + flag unrepresentable constructs. Could share a `packages/orchestrator-contracts/codegen/` helper that plugs into each language backend.

## When to revisit

When a project's brief explicitly names FastAPI / Django / Flask / Go / Rust backend. The factory picks python-fastapi today only if the brief names it; so this lands on-demand.
