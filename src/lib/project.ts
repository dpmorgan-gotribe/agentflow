import { access, readdir } from 'fs/promises';
import { join } from 'path';

export async function validateProject(projectDir: string): Promise<boolean> {
  const requiredDirs = [
    'agents/analyst',
    'agents/ui-designer',
    'skills/analysis',
    'skills/design',
    'commands',
    'assets/wireframes',
    'outputs'
  ];

  for (const dir of requiredDirs) {
    try {
      await access(join(projectDir, dir));
    } catch {
      return false;
    }
  }

  return true;
}

export async function hasWireframes(projectDir: string): Promise<boolean> {
  const wireframesDir = join(projectDir, 'assets', 'wireframes');
  try {
    const files = await readdir(wireframesDir);
    const images = files.filter(f => /\.(png|jpg|jpeg|gif)$/i.test(f));
    return images.length > 0;
  } catch {
    return false;
  }
}

export async function getWireframes(projectDir: string): Promise<string[]> {
  const wireframesDir = join(projectDir, 'assets', 'wireframes');
  const files = await readdir(wireframesDir);
  return files.filter(f => /\.(png|jpg|jpeg|gif)$/i.test(f));
}

export async function hasAnalysisOutput(projectDir: string): Promise<boolean> {
  const requiredFiles = [
    'outputs/analysis/styles.md',
    'outputs/analysis/flows.md',
    'outputs/analysis/assets.md',
    'outputs/analysis/components.md'
  ];

  for (const file of requiredFiles) {
    try {
      await access(join(projectDir, file));
    } catch {
      return false;
    }
  }

  return true;
}

export async function hasFlowsOutput(projectDir: string): Promise<boolean> {
  const flowsDir = join(projectDir, 'outputs', 'flows');
  try {
    const files = await readdir(flowsDir);
    return files.some(f => f.endsWith('.html'));
  } catch {
    return false;
  }
}

export async function hasMockupsOutput(projectDir: string): Promise<boolean> {
  const mockupsDir = join(projectDir, 'outputs', 'mockups');
  try {
    const files = await readdir(mockupsDir);
    return files.some(f => f.endsWith('.html'));
  } catch {
    return false;
  }
}

export async function hasStylesheetOutput(projectDir: string): Promise<boolean> {
  try {
    await access(join(projectDir, 'outputs', 'stylesheet', 'showcase.html'));
    return true;
  } catch {
    return false;
  }
}
