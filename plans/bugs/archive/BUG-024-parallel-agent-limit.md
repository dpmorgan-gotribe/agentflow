# BUG-024: Limit Parallel Agents to Configurable Amount

## Problem Statement

Currently, `runWorkersParallel` in `src/lib/worker.ts` spawns ALL tasks at once using `Promise.all`. This can overwhelm the system when there are many screens/flows to generate.

We need to:
1. Create a configuration file for agentflow settings
2. Add a `maxParallelAgents` setting (default: 10)
3. Modify `runWorkersParallel` to limit concurrent execution
4. Apply this limit everywhere parallel workers are used

## Current State

### Files Using `runWorkersParallel`:

| File | Line | Use Case |
|------|------|----------|
| `src/commands/screens.ts` | 111 | Generates all screens in parallel |
| `src/commands/flows.ts` | 117 | Generates all flow mockups in parallel |
| `src/commands/analyze.ts` | 239 | Runs 4 analysis workers in parallel |
| `src/commands/mockups.ts` | 175 | Generates style mockups in parallel |

### Current `runWorkersParallel` Implementation:

```typescript
// src/lib/worker.ts (lines 18-39)
export async function runWorkersParallel(tasks: WorkerTask[]): Promise<WorkerResult[]> {
  console.log(`Spawning ${tasks.length} workers in parallel...`);

  const promises = tasks.map(async (task) => {
    // ... runs ALL tasks immediately
  });

  return Promise.all(promises);  // No limit!
}
```

## Implementation Plan

### Step 1: Create Configuration Module

Create `src/lib/config.ts`:

```typescript
import { readFile } from 'fs/promises';
import { join } from 'path';

export interface AgentflowConfig {
  maxParallelAgents: number;
}

const DEFAULT_CONFIG: AgentflowConfig = {
  maxParallelAgents: 10
};

export async function loadConfig(projectDir?: string): Promise<AgentflowConfig> {
  const configPaths = [
    projectDir ? join(projectDir, 'agentflow.config.json') : null,
    join(process.cwd(), 'agentflow.config.json'),
    // Global config in user home could be added here
  ].filter(Boolean) as string[];

  for (const configPath of configPaths) {
    try {
      const content = await readFile(configPath, 'utf-8');
      const userConfig = JSON.parse(content);
      return { ...DEFAULT_CONFIG, ...userConfig };
    } catch {
      // Config file not found, try next
    }
  }

  return DEFAULT_CONFIG;
}
```

### Step 2: Update Worker Module

Modify `src/lib/worker.ts`:

```typescript
import { loadConfig } from './config.js';

// Helper to run tasks with concurrency limit
async function runWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = [];
  const executing: Promise<void>[] = [];

  for (const task of tasks) {
    const p = task().then(result => {
      results.push(result);
    });
    executing.push(p);

    if (executing.length >= limit) {
      await Promise.race(executing);
      // Remove completed promises
      executing.splice(0, executing.length,
        ...executing.filter(e => !e.then(() => false).catch(() => false))
      );
    }
  }

  await Promise.all(executing);
  return results;
}

export async function runWorkersParallel(tasks: WorkerTask[]): Promise<WorkerResult[]> {
  const config = await loadConfig();
  const limit = config.maxParallelAgents;

  console.log(`Spawning ${tasks.length} workers (max ${limit} parallel)...`);

  const taskFns = tasks.map((task) => async () => {
    console.log(`  Starting: ${task.id}`);
    try {
      const options: InvokeAgentOptions = {};
      if (task.model) options.model = task.model;
      if (task.allowRead) options.allowRead = task.allowRead;
      if (task.addDirs) options.addDirs = task.addDirs;
      const output = await invokeAgent(task.systemPrompt, task.userPrompt, options);
      console.log(`  Completed: ${task.id}`);
      return { id: task.id, output };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.log(`  Failed: ${task.id} - ${error}`);
      return { id: task.id, output: '', error };
    }
  });

  return runWithConcurrencyLimit(taskFns, limit);
}
```

### Step 3: Create Default Config File in Templates

Add `src/templates/agentflow.config.json`:

```json
{
  "maxParallelAgents": 10
}
```

### Step 4: Update Init Command

Modify `src/commands/init.ts` to copy the config file during project initialization.

### Step 5: Update Documentation

Add to `CLAUDE.md`:

```markdown
## Configuration

AgentFlow can be configured via `agentflow.config.json` in your project root:

```json
{
  "maxParallelAgents": 10
}
```

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `maxParallelAgents` | 10 | Maximum number of Claude agents to run simultaneously |
```

## Files to Create/Modify

1. **Create** `src/lib/config.ts` - Config loading module
2. **Create** `src/templates/agentflow.config.json` - Default config
3. **Modify** `src/lib/worker.ts` - Add concurrency limiting
4. **Modify** `src/commands/init.ts` - Copy config during init
5. **Update** `CLAUDE.md` - Document config options

## Testing

After implementation:

```bash
# Build
npm run build

# Test with default (10 parallel)
cd projects/gotribe_full
agentflow screens

# Test with custom limit
echo '{"maxParallelAgents": 5}' > agentflow.config.json
agentflow screens
```

## Acceptance Criteria

- [ ] Config file `agentflow.config.json` is created during `agentflow init`
- [ ] `maxParallelAgents` defaults to 10 if not specified
- [ ] `runWorkersParallel` respects the configured limit
- [ ] `screens` command runs at most N agents at a time
- [ ] `flows` command runs at most N agents at a time
- [ ] `analyze` command runs at most N agents at a time
- [ ] `mockups` command runs at most N agents at a time
- [ ] Console output shows the limit being used
