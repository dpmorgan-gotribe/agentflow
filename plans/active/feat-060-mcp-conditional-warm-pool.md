---
id: feat-060-mcp-conditional-warm-pool
type: feature
status: draft
author-agent: human
created: 2026-05-08
updated: 2026-05-08
parent-plan: investigate-019-sdk-keepalive-stalls-during-parallel-dispatch
supersedes: null
superseded-by: null
branch: feat/mcp-conditional-warm-pool
affected-files:
  - orchestrator/src/agent-mcp-config.ts
  - orchestrator/src/invoke-agent.ts
  - orchestrator/src/mcp-warm-pool.ts
  - orchestrator/tests/agent-mcp-config.test.ts
  - orchestrator/tests/mcp-warm-pool.test.ts
  - .claude/agents/tester.md
  - plans/active/investigate-019-sdk-keepalive-stalls-during-parallel-dispatch.md
feature-area: orchestrator/mcp-lifecycle
priority: P2
attempt-count: 0
max-attempts: 5
---

# feat-060: Conditional + warm-pooled MCP server lifecycle

## Problem Statement

Per investigate-019 §H6 the @playwright/mcp cold-start was 60-300s
per dispatch. M-D (pin version) and M-F (per-agent scoping —
shipped 2026-05-08) cut the population that pays the tax: only
agents declaring `mcp_servers: ["playwright"]` (currently `tester`
and `ui-designer`) still trigger a spawn.

Two residual problems remain:

1. **Static declaration is too coarse.** `tester` declares
   `mcp_servers: ["playwright"]` unconditionally, but on dispatches
   where there are no E2E specs to run (or no Playwright config in
   `apps/web/`) the MCP cold-start is paid for nothing. Empirical
   anchor: in /fix-bugs runs under feat-062 routing the tester
   isn't dispatched per bug at all (only the builder is), but on
   a future feature-mode run with mixed test surfaces the
   dispatcher's actual need for Playwright varies per task.

2. **Cold-start cost persists where MCP IS needed.** Even after
   M-F narrows the population, every dispatcher that DOES need
   Playwright pays a fresh ~60-300s spawn. Across multiple tester
   dispatches in one orchestrator session this redundantly
   re-spawns the same MCP server. The Claude Agent SDK exposes
   `setMcpServers / toggleMcpServer / reconnectMcpServer` (per
   `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2023-2053`)
   suggesting the SDK supports dynamic add/remove of MCP servers,
   which would let one long-lived spawn serve many dispatches.

Goal: cut the residual MCP cold-start tax further by moving from
"every declared dispatch pays" to **"only dispatches that actually
need MCP pay, AND they share a warm pool"**.

This is a factory-infrastructure feature, not driven by a project
brief. (No `brief.md` reference — factory has no brief.)

## Approach

### Phase A — Investigation (cheap; ~2-3h)

Probe the SDK's deferred-MCP-loading capabilities before committing
to an architecture. Key questions:

1. Can `Options.mcpServers` be passed empty initially and the
   server added mid-session via `setMcpServers`? Or is the option
   only consumed at session creation?
2. Can a single MCP daemon process be spawned externally and
   `mcpServers: { playwright: { type: "sse", url: "..." } }` (or
   the equivalent stdio re-attachment) be passed to multiple
   `query()` calls?
3. What's the failure mode if the MCP fails to spawn or crashes
   mid-session — does the SDK abort, or retry, or silently drop
   the tool calls?
4. What's the SDK's behavior under SIGINT during MCP spawn
   (relevant to /pause-build hard-pause flow)?

Deliverable: an `investigate-019-followup` finding section OR a
short `mcp-sdk-deferred-loading.md` doc capturing the SDK's
contract. This determines whether Phase C is feasible.

### Phase B — Conditional load (medium; ~3-4h)

Introduce per-dispatch context-aware MCP filtering on top of the
M-F static declaration:

```ts
// orchestrator/src/agent-mcp-config.ts (extend M-F module)
export function effectiveMcpServers(
  factoryRoot: string,
  agentName: string,
  context: DispatchContext, // worktreeCwd, taskSpec, featureContext
): Record<string, McpServerConfig> | undefined {
  const declared = buildAgentMcpServersOption(factoryRoot, agentName);
  if (declared === undefined) return undefined; // back-compat preserved
  if (Object.keys(declared).length === 0) return declared; // no servers anyway
  return filterByContext(declared, context);
}
```

Heuristics for `filterByContext` (start narrow; broaden by
empirical signal):

- `playwright` needed only when EITHER:
  - `<worktreeCwd>/apps/web/playwright.config.ts` exists AND
    `<worktreeCwd>/apps/web/e2e/**/*.spec.ts` matches at least one
    file, OR
  - the dispatched task spec lists an E2E test artifact in its
    output contract (per `tasks.yaml`'s `outputs[]` field).

If neither signal is present, drop `playwright` from the effective
set. Apply the same contract-by-contract pattern for any other
MCP that lands in `.mcp.json` (currently only Playwright).

Wire `effectiveMcpServers` into `buildAgentOptions` —
swap the call from `buildAgentMcpServersOption` to
`effectiveMcpServers` and pass the dispatch context.

### Phase C — Warm pool (gated by Phase A finding; ~6-8h if feasible)

If Phase A confirms the SDK supports cross-session MCP reuse:

1. Spawn a long-lived `@playwright/mcp@0.0.74` process at
   orchestrator startup (lazily — only when the first dispatch
   declares it after Phase B's conditional gate). Keep it running
   for the orchestrator's lifetime.
2. Expose a small `mcp-warm-pool.ts` module with
   `acquire(serverName)` / `release(serverName)` / `shutdown()`.
   Connection details (port for SSE, or socket for stdio) are
   captured at spawn.
3. In `buildAgentOptions`, when the effective MCP set is
   non-empty, replace each declared spawn config with a
   re-attachment config pointing at the warm-pool process.
4. Fail gracefully — if the warm-pool process is unavailable (died
   between dispatches, port collision, etc.), fall back to a fresh
   per-dispatch spawn (current M-F behavior). Log the fallback
   once to surface degradation.

If Phase A finds the SDK does NOT support cross-session reuse,
defer Phase C with a `superseded-by` pointer to a follow-up plan
that pursues an alternative (e.g. just M-E global pre-install).

### Phase D — Tests + rollout flag (~1-2h)

1. Extend `orchestrator/tests/agent-mcp-config.test.ts` with cases
   for `effectiveMcpServers`:
   - Declared `[]` → still `[]` regardless of context.
   - Declared `["playwright"]` + worktree has Playwright config +
     specs → `{playwright: ...}`.
   - Declared `["playwright"]` + worktree has neither → `{}`.
   - Declared `["playwright"]` + worktree has config but no specs
     → `{}` (skip — no work to do).
2. New `orchestrator/tests/mcp-warm-pool.test.ts` (Phase C only):
   acquire/release lifecycle, fallback on warm-pool death, shutdown.
3. Env-var rollout flag: `FACTORY_MCP_CONDITIONAL=0` disables
   Phase B's filter (forces back to M-F static behavior);
   `FACTORY_MCP_WARM_POOL=0` disables Phase C (forces fresh
   per-dispatch spawn). Both default ON when shipped.
4. Manual sanity: re-run /fix-bugs on a project with E2E specs
   present + a project without — confirm tester dispatch behavior
   matches expectation (cold-start paid only when warranted).

## Rejected Alternatives

- **Static-only M-F (no conditional gate)** — Rejected: leaves the
  case where tester declares `["playwright"]` but the worktree has
  no E2E specs paying full cold-start. Empirically rare today (most
  shipped projects DO have specs), but factory needs to be
  defensive against future stack-skill variants.

- **M-E global pre-install only** — Rejected: would skip the
  60-150s download portion of cold-start but still pay the per-
  dispatch spawn (~10-30s of process init + handshake). Doesn't
  address the conditional-need axis at all. Also requires
  per-machine bootstrap which is more environment-coupled than
  the orchestrator preferentially wants to be.

- **Move Playwright spawn entirely outside the SDK** — Rejected:
  the SDK's MCP integration is what gives the agent typed tool
  bindings; spawning manually + injecting raw HTTP routes loses
  type safety and would require re-implementing the protocol
  bridge. Warm pool via SDK reuse (Phase C) keeps the SDK as
  source-of-truth.

- **Just bump the wall-clock + keepalive thresholds** —
  Rejected: cosmetic. Doesn't reduce real cost; just stops
  reporting it. Empirical evidence (investigate-019 §H6) is that
  the spawn time is real wall-clock the orchestrator can't get
  back.

## Expected Outcomes

- [ ] Phase A finding documents the SDK's deferred-MCP-loading
      contract (yes/no on cross-session reuse + failure modes)
- [ ] `effectiveMcpServers` filters out `playwright` when worktree
      has no Playwright config AND no E2E specs (Phase B)
- [ ] Tester dispatch on a no-E2E project records 0 MCP-spawn
      events in stall-log (Phase B validation)
- [ ] If Phase C ships: a single `@playwright/mcp@0.0.74` process
      survives across ≥3 sequential tester dispatches without
      respawn (warm-pool reuse)
- [ ] `FACTORY_MCP_CONDITIONAL=0` env var restores pre-feat-060
      behavior (rollback path verified)
- [ ] Cross-references in `investigate-019` plan updated with
      "M-conditional + M-warm-pool" status

## Validation Criteria

- All `agent-mcp-config.test.ts` cases pass (existing 14 + new
  ~6 for `effectiveMcpServers`)
- New `mcp-warm-pool.test.ts` passes (Phase C only)
- Smoke test: synthetic worktree with Playwright config but
  zero spec files → tester dispatch produces `mcpServers: {}`
  (no spawn)
- Smoke test: synthetic worktree with Playwright config + 1
  spec file → tester dispatch produces `mcpServers: { playwright: ... }`
- Empirical (Phase B): re-run /fix-bugs on reading-log-02 (no
  per-bug tester under feat-062 routing — should be a no-op
  for this run; useful as regression baseline for future feature-
  mode runs)
- Empirical (Phase C if shipped): a /start-build run with ≥3
  tester dispatches shows ≤1 `npx -y @playwright/mcp` spawn
  in process history
- No regression on agents that don't declare `mcp_servers`
  (analyst, architect, project-manager, skills-agent → still
  pass `undefined` Options.mcpServers, SDK handles discovery)

## Composition with the rest of the stack

- **investigate-019 M-D** (version pin): unaffected — pin still
  applies whether spawn is fresh or warm-pool re-attach
- **investigate-019 M-F** (per-agent scoping): this plan extends
  M-F's static declaration with a context filter; the frontmatter
  field stays as-is
- **investigate-019 M-E** (global pre-install): orthogonal but
  redundant if Phase C ships — defer indefinitely after Phase C
- **feat-062** (pure-verify routing): composes — the dispatchers
  feat-062 keeps in-play (mostly builders) don't pay MCP at all
  under M-F; this plan tightens the remaining (tester, ui-designer)
  cases
- **feat-057** (Playwright browser binary install): orthogonal —
  that's about installing Chromium for E2E runs, not the MCP
  server itself

## Attempt Log

(empty — plan filed by human 2026-05-08 after reading-log-02
/fix-bugs run validated M-F + raised the residual cold-start
question. Next step: schedule Phase A investigation when the
factory has bandwidth — not blocking the current run.)
