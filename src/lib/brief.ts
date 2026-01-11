import { readFile } from 'fs/promises';
import { join } from 'path';

export async function loadBrief(projectDir: string): Promise<string | null> {
  try {
    const briefPath = join(projectDir, 'brief.md');
    return await readFile(briefPath, 'utf-8');
  } catch {
    return null;
  }
}

export function isBriefEmpty(brief: string | null): boolean {
  if (!brief) return true;
  return brief.includes('[Your brief here]') || brief.trim().endsWith('---');
}

/**
 * Load a platform-specific brief
 */
export async function loadPlatformBrief(projectDir: string, platform: string): Promise<string | null> {
  try {
    const briefPath = join(projectDir, `brief-${platform}.md`);
    return await readFile(briefPath, 'utf-8');
  } catch {
    return null;
  }
}
