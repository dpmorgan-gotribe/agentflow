import { invokeAgent, InvokeAgentOptions } from './agent.js';
import { loadConfig } from './config.js';

export interface WorkerTask {
  id: string;
  systemPrompt: string;
  userPrompt: string;
  model?: 'opus' | 'sonnet' | 'haiku';
  allowRead?: boolean;
  addDirs?: string[];
  /** Timeout in milliseconds (default: 300000 = 5 minutes) */
  timeout?: number;
}

export interface WorkerResult {
  id: string;
  output: string;
  error?: string;
}

// Run tasks with concurrency limit
async function runWithConcurrencyLimit<T>(
  taskFns: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = new Array(taskFns.length);
  let currentIndex = 0;

  async function runNext(): Promise<void> {
    while (currentIndex < taskFns.length) {
      const index = currentIndex++;
      results[index] = await taskFns[index]();
    }
  }

  // Start up to 'limit' concurrent runners
  const runners = Array(Math.min(limit, taskFns.length))
    .fill(null)
    .map(() => runNext());

  await Promise.all(runners);
  return results;
}

export async function runWorkersParallel(tasks: WorkerTask[]): Promise<WorkerResult[]> {
  const config = await loadConfig();
  const limit = config.maxParallelAgents;

  console.log(`Spawning ${tasks.length} workers (max ${limit} parallel)...`);

  const taskFns = tasks.map((task) => async (): Promise<WorkerResult> => {
    console.log(`  Starting: ${task.id}`);
    try {
      const options: InvokeAgentOptions = {};
      if (task.model) options.model = task.model;
      if (task.allowRead) options.allowRead = task.allowRead;
      if (task.addDirs) options.addDirs = task.addDirs;
      if (task.timeout) options.timeout = task.timeout;
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

export async function runWorkerSequential(task: WorkerTask): Promise<WorkerResult> {
  console.log(`Running: ${task.id}`);
  try {
    const options: InvokeAgentOptions = {};
    if (task.model) options.model = task.model;
    if (task.allowRead) options.allowRead = task.allowRead;
    if (task.addDirs) options.addDirs = task.addDirs;
    if (task.timeout) options.timeout = task.timeout;
    const output = await invokeAgent(task.systemPrompt, task.userPrompt, options);
    console.log(`Completed: ${task.id}`);
    return { id: task.id, output };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.log(`Failed: ${task.id} - ${error}`);
    return { id: task.id, output: '', error };
  }
}
