# BUG-014: Token Usage Optimization

## Problem
AgenticFlow is consuming excessive tokens - 13% of weekly allowance in just a couple of hours. With 5+ parallel workers per command and no model optimization, costs are multiplied across every invocation.

## Root Cause Analysis

### Current Architecture Issues

1. **No Model Selection** - `src/lib/agent.ts:76` spawns Claude CLI without specifying a model:
   ```typescript
   const claude = spawn('claude', ['-p', '--tools', '""', ...])
   ```
   This defaults to whatever model the user has configured (likely Opus 4.5, the most expensive).

2. **No max_tokens Limit** - Agents can generate unlimited output, wasting tokens on verbose responses.

3. **Massive Context Per Worker** - Each of the 5-6 parallel workers receives:
   - Full 850-line brief (~12k tokens)
   - Full system prompt
   - Full skill definition
   - Full research output (passed to phase 2 workers)

4. **Parallel Multiplication** - `analyze` command runs 6 workers (research + 5 parallel), each with full context = 6x token cost.

## Model Recommendations by Task Type

| Agent/Skill | Current | Recommended | Reasoning |
|-------------|---------|-------------|-----------|
| **analyst** (analyze-*) | Default (Opus?) | **Sonnet** | Analysis/extraction is well-structured; Sonnet handles templates well |
| **ui-designer** (design-*) | Default (Opus?) | **Sonnet** | HTML/CSS generation is formulaic; doesn't need Opus reasoning |
| **planner** (plan-*) | Default (Opus?) | **Opus** (keep) | Planning benefits from deep reasoning |
| **research** | Default (Opus?) | **Sonnet** | Competitive research is straightforward extraction |
| **stylesheet** | Default (Opus?) | **Sonnet** | Design system generation is template-driven |

**Potential savings: 60-80%** by switching most tasks to Sonnet.

## Implementation Steps

### Phase 1: Add Model Selection (High Impact)

1. [ ] Update `AgentConfig` interface in `src/lib/agent.ts`:
   ```typescript
   export interface AgentConfig {
     id: string;
     name: string;
     description: string;
     skills: string[];
     model?: 'opus' | 'sonnet' | 'haiku';  // NEW
     maxTokens?: number;                    // NEW
   }
   ```

2. [ ] Update `invokeAgent` to accept and pass model parameter:
   ```typescript
   const claude = spawn('claude', [
     '-p',
     '--model', model || 'sonnet',  // Default to cheaper model
     '--max-tokens', String(maxTokens || 4096),
     '--tools', '""',
     ...
   ]);
   ```

3. [ ] Update all `agent.json` files with model assignments:
   - `analyst/agent.json`: `"model": "sonnet"`
   - `ui-designer/agent.json`: `"model": "sonnet"`
   - `planner/agent.json`: `"model": "opus"`

### Phase 2: Context Reduction (Medium Impact)

4. [ ] Create brief summarization - Extract key points instead of passing full 850-line brief:
   - Create `summarizeBrief()` function
   - Run once at start, pass summary to workers
   - Target: 200 lines max

5. [ ] Pass only relevant context to each worker:
   - Flows worker: Don't need full style definitions
   - Assets worker: Don't need full flow details
   - Currently all get everything

6. [ ] Compress research output before passing to phase 2:
   - Extract key findings only
   - Remove verbose explanations

### Phase 3: Output Limits (Medium Impact)

7. [ ] Set `maxTokens` per agent type in agent.json:
   - analyst: 4096 (structured output)
   - ui-designer: 8192 (HTML can be long)
   - planner: 2048 (plans should be concise)

8. [ ] Add truncation validation - ensure output isn't cut off mid-content

### Phase 4: Development Mode (Low Impact, High Convenience)

9. [ ] Add `--dev` flag to commands that uses Haiku for rapid iteration:
   ```bash
   agentflow analyze --dev  # Uses Haiku, faster but lower quality
   agentflow analyze        # Uses configured models (production)
   ```

10. [ ] Add `--dry-run` flag to estimate token usage without running:
    ```bash
    agentflow analyze --dry-run
    # Output: Estimated tokens: ~45,000 (6 workers × ~7,500 each)
    ```

### Phase 5: Monitoring (Low Impact, High Visibility)

11. [ ] Add token usage logging to `invokeAgent`:
    - Log input tokens (estimate from string length / 4)
    - Log output tokens from response
    - Write to `outputs/.token-log.json`

12. [ ] Create `agentflow stats` command:
    ```bash
    agentflow stats
    # Last 7 days: 125,000 tokens
    # By command: analyze (45%), screens (30%), flows (25%)
    ```

## Quick Wins (Do First)

1. **Add `--model sonnet` flag to Claude spawn** - 1 line change, 60%+ savings
2. **Add `--max-tokens 4096` flag** - 1 line change, prevents runaway responses
3. **Trim whitespace from prompts** - Remove blank lines, compress system prompts

## Testing

- [ ] Compare token usage: before/after for full workflow
- [ ] Verify output quality with Sonnet vs Opus for each agent type
- [ ] Test max_tokens doesn't truncate valid output
- [ ] Benchmark: `analyze 5` should use <50% of current tokens

## Files to Modify

```
src/lib/agent.ts                    # Model selection, max_tokens
src/templates/agents/*/agent.json   # Model assignments
src/commands/analyze.ts             # Context reduction
src/commands/flows.ts               # Context reduction
src/commands/mockups.ts             # Context reduction
src/commands/screens.ts             # Context reduction
```

## Estimated Impact

| Optimization | Estimated Savings |
|--------------|-------------------|
| Model selection (Sonnet default) | 60-70% |
| Context reduction | 15-20% |
| max_tokens limits | 5-10% |
| **Total** | **70-80%** |

Your 13% weekly usage in 2 hours could drop to ~3-4% with these changes.
