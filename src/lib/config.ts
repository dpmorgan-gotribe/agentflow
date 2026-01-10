import { readFile } from 'fs/promises';
import { join } from 'path';

export interface AgentflowConfig {
  maxParallelAgents: number;
}

const DEFAULT_CONFIG: AgentflowConfig = {
  maxParallelAgents: 10
};

let cachedConfig: AgentflowConfig | null = null;

export async function loadConfig(projectDir?: string): Promise<AgentflowConfig> {
  // Return cached config if available
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPaths = [
    projectDir ? join(projectDir, 'agentflow.config.json') : null,
    join(process.cwd(), 'agentflow.config.json'),
  ].filter(Boolean) as string[];

  for (const configPath of configPaths) {
    try {
      const content = await readFile(configPath, 'utf-8');
      const userConfig = JSON.parse(content);
      const merged: AgentflowConfig = { ...DEFAULT_CONFIG, ...userConfig };
      cachedConfig = merged;
      return merged;
    } catch {
      // Config file not found, try next
    }
  }

  cachedConfig = { ...DEFAULT_CONFIG };
  return cachedConfig;
}

export function clearConfigCache(): void {
  cachedConfig = null;
}

export function getDefaultConfig(): AgentflowConfig {
  return { ...DEFAULT_CONFIG };
}
