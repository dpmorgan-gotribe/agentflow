---
id: feat-017-auth-provider-config
type: feature
status: completed
approved-at: 2026-04-24
approved-by: human
author-agent: claude-opus-4-7
created: 2026-04-24
updated: 2026-04-24
completed-at: 2026-04-27
parent-plan: feat-014-mvp-completion-autonomous-e2e
supersedes: null
superseded-by: null
branch: feat/auth-provider-config
affected-files:
  - orchestrator/src/model-config.ts
  - orchestrator/src/stage-runner.ts
  - orchestrator/src/invoke-agent.ts
  - orchestrator/tests/model-config.test.ts
  - orchestrator/tests/stage-runner.test.ts
  - orchestrator/tests/invoke-agent.test.ts
  - packages/orchestrator-contracts/src/model-config.ts # new or extended
  - .claude/models.yaml # factory default
  - docs/agent-sdk-auth-providers.md # new — user-facing guide
  - CLAUDE.md # mention provider config
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-017 — Configurable auth provider (Claude Max default, API key optional)

## Problem Statement

Today the orchestrator's SDK calls (`orchestrator/src/stage-runner.ts::runStage` + `invoke-agent.ts::createInvokeAgent`) build an `Options` object without specifying `forceLoginMethod`. That means the Claude Agent SDK falls through its default auth chain: if `ANTHROPIC_API_KEY` is set in the environment, the SDK uses it — billing every `query()` call at API-rate.

The operator of this factory already has a Claude Max 20x subscription ($200/month) that covers interactive Claude Code usage. Subscription usage is NOT the same as API billing — API calls are billed per token against the Anthropic billing account, completely separate from the Max subscription quota. So right now, running `/start-build revolution-pictures` against the live orchestrator (feat-014 Phase 4) would charge extra per-token fees on top of the already-paid subscription — roughly $60-100 for a 12-feature project.

The SDK actually supports running through the subscription quota via the `Options.forceLoginMethod: 'claudeai'` flag (vs `'console'` for API-key mode). Plus `CLAUDE_CODE_USE_BEDROCK=1` + `CLAUDE_CODE_USE_VERTEX=1` env vars route to cloud-provider auth with no Anthropic cost at all (just the cloud's per-token fee, which is often cheaper + goes on the operator's existing AWS/GCP bill).

None of this is configurable today. The orchestrator doesn't know the operator has a Max subscription; can't route to Bedrock on a team that has an AWS discount; can't easily be turned into a public product where end users bring their own API key.

This plan ships a **provider-aware auth layer**: one config value drives every SDK call. Default is subscription mode (factory operator doesn't pay extra). Operator can flip to API mode per project (public product release), per session (testing), or globally (switch Anthropic accounts). Cloud-provider modes (Bedrock / Vertex) are covered by the same abstraction.

Blocker relationship: feat-014 Phase 4 is the first live Mode B run. Without this plan landing first, that run bills at API rate. So feat-017 is a prerequisite for feat-014 Phase 4 validation.

Reference: `orchestrator/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — `Options.forceLoginMethod`, `apiProvider` enum.

## Approach

Three phases; all in `orchestrator/` + `packages/orchestrator-contracts/`. No project-side changes.

### Phase A — Contract + default

Define the provider abstraction as a first-class config. Factory default = subscription; public product can flip default via environment detection.

1. **Define `Provider` type + Zod schema** in `packages/orchestrator-contracts/src/model-config.ts`:

```ts
export const Provider = z.enum([
  "claude-max-subscription", // Options.forceLoginMethod: "claudeai"
  "anthropic-api", // Options.forceLoginMethod: "console"; reads ANTHROPIC_API_KEY
  "bedrock", // CLAUDE_CODE_USE_BEDROCK=1; reads AWS_* env chain
  "vertex", // CLAUDE_CODE_USE_VERTEX=1; reads GOOGLE_* env chain
]);
export type Provider = z.infer<typeof Provider>;

export interface ProviderConfig {
  provider: Provider;
  /** For anthropic-api: the env var name to read the key from. Default: ANTHROPIC_API_KEY. Override if the factory runs in an env that already uses ANTHROPIC_API_KEY for a different purpose. */
  apiKeyEnvVar?: string;
  /** For bedrock: AWS region override (bedrock uses AWS_REGION by default). */
  awsRegion?: string;
  /** For vertex: GCP project override (vertex uses GOOGLE_CLOUD_PROJECT by default). */
  gcpProject?: string;
}
```

2. **Extend `~/.claude/models.yaml` schema** to include a top-level `provider:` key:

```yaml
version: 1
provider: claude-max-subscription # default; override at project level if needed
# OR for public-product or cloud-provider usage:
# provider: anthropic-api
# apiKeyEnvVar: ANTHROPIC_API_KEY        # optional; defaults to this name

agents:
  architect:
    tier: opus-4-7
    # ...
```

The `provider:` key lives at the top-level (NOT under `agents.X`) — same provider applies to every SDK call in the run. If a specific agent needs a different provider, that's a post-MVP feature.

3. **Update `orchestrator/src/model-config.ts::readModelConfig`** to return the provider alongside model/effort/budgetUsd:

```ts
export interface ModelConfig {
  provider: Provider;
  providerConfig: ProviderConfig;
  model: string;
  effort: "low" | "medium" | "high" | "max";
  budgetUsd: number;
}
```

Resolution order for provider:

1. `process.env.AGENTFLOW_PROVIDER` — session-level override (for testing / explicit force)
2. `<projectRoot>/.claude/models.yaml.provider` — project-level override
3. `~/.claude/models.yaml.provider` — global default
4. Factory fallback: `claude-max-subscription`

5. **Factory default**: update `.claude/models.yaml` (if it exists) or document the convention in `CLAUDE.md`. Factory ships with subscription mode; operator overrides if they want API billing.

### Phase B — Wire into SDK calls

5. **Extend `orchestrator/src/stage-runner.ts::buildOptions`** to set the auth field based on provider:

```ts
function buildOptions(
  stage: PipelineStage,
  ctx: RunContext,
  modelConfig: ModelConfig,
): Options {
  // ... existing env + model wiring ...
  const authOptions = resolveAuthOptions(modelConfig.providerConfig, env);
  return {
    model: modelConfig.model,
    effort: modelConfig.effort as NonNullable<Options["effort"]>,
    cwd: ctx.projectRoot,
    env: authOptions.env, // may inject CLAUDE_CODE_USE_BEDROCK=1 etc.
    maxBudgetUsd: stage.budgetUsd,
    ...(authOptions.forceLoginMethod
      ? { forceLoginMethod: authOptions.forceLoginMethod }
      : {}),
  };
}
```

6. **Create `orchestrator/src/auth-provider.ts`** with the pure resolver:

```ts
export interface ResolvedAuth {
  forceLoginMethod?: "claudeai" | "console";
  env: NodeJS.ProcessEnv; // may have CLAUDE_CODE_USE_BEDROCK, AWS_REGION, etc. set
}

export function resolveAuthOptions(
  cfg: ProviderConfig,
  baseEnv: NodeJS.ProcessEnv,
): ResolvedAuth {
  const env = { ...baseEnv };
  switch (cfg.provider) {
    case "claude-max-subscription":
      // Explicitly unset ANTHROPIC_API_KEY so the SDK doesn't accidentally bill.
      delete env.ANTHROPIC_API_KEY;
      return { forceLoginMethod: "claudeai", env };
    case "anthropic-api": {
      const keyName = cfg.apiKeyEnvVar ?? "ANTHROPIC_API_KEY";
      const key = env[keyName];
      if (!key) {
        throw new Error(
          `Provider 'anthropic-api' requires env var '${keyName}' to be set. ` +
            `Either set it, or change provider to 'claude-max-subscription' in ~/.claude/models.yaml.`,
        );
      }
      // If the user set a custom var name, copy its value to ANTHROPIC_API_KEY so the SDK picks it up.
      if (keyName !== "ANTHROPIC_API_KEY") env.ANTHROPIC_API_KEY = key;
      return { forceLoginMethod: "console", env };
    }
    case "bedrock":
      env.CLAUDE_CODE_USE_BEDROCK = "1";
      if (cfg.awsRegion) env.AWS_REGION = cfg.awsRegion;
      // AWS creds picked up via standard AWS SDK chain (env / ~/.aws/credentials / instance profile)
      return { env };
    case "vertex":
      env.CLAUDE_CODE_USE_VERTEX = "1";
      if (cfg.gcpProject) env.GOOGLE_CLOUD_PROJECT = cfg.gcpProject;
      return { env };
  }
}
```

7. **Update `orchestrator/src/invoke-agent.ts::createInvokeAgent`** to use the same resolver for LLM-agent calls (git-agent is deterministic + doesn't touch SDK, so no auth needed there).

### Phase C — Testing + documentation

8. **Extend `orchestrator/tests/model-config.test.ts`**:
   - Default provider resolution (no config → `claude-max-subscription`)
   - Project override beats global
   - Env var (`AGENTFLOW_PROVIDER`) beats both
   - Unknown provider value → zod validation error at load time

9. **Create `orchestrator/tests/auth-provider.test.ts`** (new file):
   - `claude-max-subscription` → `forceLoginMethod: "claudeai"` + `ANTHROPIC_API_KEY` removed from env
   - `anthropic-api` → `forceLoginMethod: "console"` + throws when key missing
   - `anthropic-api` with custom `apiKeyEnvVar` → copies value to `ANTHROPIC_API_KEY` in env
   - `bedrock` → `CLAUDE_CODE_USE_BEDROCK=1` + `AWS_REGION` override applied
   - `vertex` → `CLAUDE_CODE_USE_VERTEX=1` + `GOOGLE_CLOUD_PROJECT` override applied

10. **Update `orchestrator/tests/stage-runner.test.ts` + `invoke-agent.test.ts`**:
    - Assert `Options.forceLoginMethod` is forwarded when the resolver returns it
    - Assert env vars from resolved auth are merged into the SDK options

11. **Author `docs/agent-sdk-auth-providers.md`** — user-facing guide covering:
    - When to use each provider (flow-chart or table)
    - How to configure (`~/.claude/models.yaml.provider`)
    - How to override per-project (`projects/<name>/.claude/models.yaml.provider`)
    - How to override per-session (`AGENTFLOW_PROVIDER=... pnpm start generate ...`)
    - Troubleshooting ("SDK says no auth found" → check `claude login` or `ANTHROPIC_API_KEY`)
    - Cost implications: subscription mode is free (uses Max quota), API mode bills per token, cloud modes bill through cloud provider
    - Public product release path: distributed version flips default to `anthropic-api` via a factory-wide config toggle + requires user-supplied key on first run

12. **Update `CLAUDE.md`** §Model Configuration with a one-liner pointing at the new guide + noting the factory default.

### Phase D — First-invocation smoke test

13. **Local smoke test** (does not require spending money):
    - Run `ANTHROPIC_API_KEY=x pnpm --filter orchestrator test` — all tests pass with the stubbed key (tests never hit real SDK)
    - Run `pnpm --filter orchestrator start generate revolution-pictures --dry-run` — assert the dry-run line now reads `Auth: claude-max-subscription (Claude Max quota)` somewhere in the output (new log line added to cli-runner)
    - Validate `claude --version` works (confirms subscription is available locally)

14. **Live smoke test** (uses ~$0 of subscription quota):
    - Run the pipeline against a dry-test stage that fires one `query()` call asking for a trivial response (e.g. the `skills-audit --scope=build` stage which usually produces a no-op result for react-next stacks)
    - Confirm the call completes + charges the subscription (verify via claude.ai dashboard — pageview shows "Max subscription usage: X tokens")
    - Confirm ANTHROPIC_API_KEY is NOT consumed (billing dashboard shows no new charges)

### Testing at each stage

| Phase | Stage                | Mechanism                                                          | Pass criteria                                                    |
| ----- | -------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| A     | Contract schema      | Vitest — construct valid + invalid configs                         | Zod validates 4 provider values; rejects typos                   |
| A     | Config resolution    | Vitest with filesystem fixtures                                    | Correct precedence: env > project > global > factory-default     |
| B     | Auth resolver        | Vitest pure-function tests                                         | Each provider produces correct `{ forceLoginMethod, env }`       |
| B     | SDK Options assembly | Vitest against `buildOptions`                                      | `forceLoginMethod` forwarded; env merged                         |
| B     | End-to-end           | `--dry-run` with `AGENTFLOW_PROVIDER=anthropic-api` but no key set | Fails early with clear error (before SDK call)                   |
| C     | Docs                 | Markdownlint + human read                                          | Guide covers 4 providers + troubleshooting + public-product path |
| D     | Local smoke          | Dry-run + test suite                                               | All pass; new "Auth: ..." log line present                       |
| D     | Live smoke           | Real `query()` to a cheap stage                                    | Charges subscription, not API; verify via claude.ai dashboard    |

## Rejected Alternatives

### Alternative A: Default to `anthropic-api` for broader compatibility

**Why rejected**: The operator's explicit requirement — they don't want to pay extra when their $200/mo subscription covers the usage. Defaulting to API-billing would hide the cost (quiet surprise on the next statement). Default should match the operator's actual intent; `claude-max-subscription` does. For a future public product, we flip the default via a factory-wide build flag, not by changing the check-in default.

### Alternative B: Require the operator to always pass `--provider` on the CLI

**Why rejected**: Forgetting the flag on one run costs money. Config files are specifically designed to avoid per-invocation mistakes. The flag IS available (as `AGENTFLOW_PROVIDER` env var) for explicit overrides, but the default path should be frictionless.

### Alternative C: Just unset `ANTHROPIC_API_KEY` before every SDK call, no explicit provider config

**Why rejected**: This works for subscription mode today but fails the moment someone wants to use Bedrock, Vertex, or a public-product release with user-supplied API keys. It's a point solution that doesn't address the real shape of the problem (multiple auth backends). A 4-value enum with pure resolvers is the right abstraction; it's not over-engineered given we already have scaffolded support for all 4 paths in the SDK.

### Alternative D: Ship this after feat-014 Phase 4 instead of before

**Why rejected**: feat-014 Phase 4 is the MVP validation run against revolution-pictures. If we run it against API-billing first, we produce a $60-100 bill for the MVP smoke test — same information we'd get from a subscription-backed run at zero incremental cost. The order is: ship feat-017 (small plan, ~3-4h), THEN run feat-014 Phase 4 free. Inversion would be needlessly expensive.

### Alternative E: Use `CLAUDE_CODE_OAUTH_TOKEN` env var directly instead of `forceLoginMethod: 'claudeai'`

**Why rejected**: That env var is an internal Claude Code implementation detail. The SDK's public API surface is `Options.forceLoginMethod` — using the env var would bypass intended API boundaries and could break on SDK upgrades. Public API > internal env.

## Expected Outcomes

- [ ] `packages/orchestrator-contracts/src/model-config.ts` exports `Provider` + `ProviderConfig` zod + types
- [ ] `orchestrator/src/model-config.ts::readModelConfig` returns a `ModelConfig` that includes the resolved provider; resolution order respected
- [ ] `orchestrator/src/auth-provider.ts` exports `resolveAuthOptions(cfg, baseEnv): ResolvedAuth` — pure function, fully tested
- [ ] `orchestrator/src/stage-runner.ts::buildOptions` + `orchestrator/src/invoke-agent.ts::createInvokeAgent` both use the resolver
- [ ] `orchestrator/tests/auth-provider.test.ts` covers all 4 providers + error paths
- [ ] `orchestrator/tests/stage-runner.test.ts` + `invoke-agent.test.ts` assert provider wiring via stubs
- [ ] `docs/agent-sdk-auth-providers.md` exists + covers 4 providers + troubleshooting + public-product path
- [ ] `CLAUDE.md` §Model Configuration mentions the guide
- [ ] Factory default is `claude-max-subscription` (verified via empty `.claude/models.yaml` test case)
- [ ] Live smoke test: one real `query()` call charges subscription (not API) — verified via claude.ai dashboard

## Validation Criteria

- **Typecheck + tests**: `pnpm -r typecheck && pnpm -r test` clean factory-wide
- **Live smoke**: one real SDK call succeeds under `provider: claude-max-subscription`; Anthropic billing dashboard shows no new charge; claude.ai Max dashboard shows consumed quota
- **Public-product path**: setting `AGENTFLOW_PROVIDER=anthropic-api` + `ANTHROPIC_API_KEY=<key>` routes through API; setting only `AGENTFLOW_PROVIDER=anthropic-api` without the key throws the documented clear error
- **Bedrock/Vertex paths** (not validated live unless operator has AWS/GCP accounts; schema + resolver tested against stubs)
- **Documentation**: `docs/agent-sdk-auth-providers.md` reads as a complete reference (no TODOs, no broken cross-refs)
- **feat-014 dependency**: after this plan closes, feat-014 Phase 4 can proceed with zero API billing

## Attempt Log

<!-- Executing agent fills this in as attempts complete. -->

## References

- `orchestrator/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — `Options.forceLoginMethod`, `apiProvider` enum, `ApiKeySource` enum
- `orchestrator/src/model-config.ts` — where the provider resolution lands
- `plans/active/feat-014-mvp-completion-autonomous-e2e.md` — downstream dependent (Phase 4)
- `CLAUDE.md` §Model Configuration — existing model-config documentation patterns
- Claude Code docs: https://docs.anthropic.com/en/docs/claude-code (subscription + OAuth semantics)
- `~/.claude/models.yaml` — current config location
