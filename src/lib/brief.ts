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

// ============================================
// Navigation Schema Extraction (v2.0)
// ============================================

export interface BriefScreen {
  id: string;
  file: string;
  description: string;
  sidemenuActive?: string;
}

export interface BriefSection {
  sectionId: string;
  sectionName: string;
  parentEntity?: string;
  navigationOverride?: Record<string, unknown>;
  screens: BriefScreen[];
}

export interface BriefApp {
  appId: string;
  appName: string;
  appType: string;
  layoutSkill: string;
  description?: string;
  defaultNavigation?: Record<string, unknown>;
  sections: Record<string, BriefSection>;
}

export interface BriefNavigationSchema {
  version: string;
  apps: Record<string, BriefApp>;
}

export interface ExtractedAppScreens {
  appId: string;
  appName: string;
  appType: string;
  layoutSkill: string;
  screens: Array<{
    id: string;
    file: string;
    section: string;
    sectionName: string;
    description: string;
    parentEntity?: string;
  }>;
}

/**
 * Extract navigation schema from brief JSON block
 * Looks for a JSON code block containing "apps" key
 */
export function extractNavigationSchema(briefContent: string): BriefNavigationSchema | null {
  if (!briefContent) return null;

  // Find JSON block in brief - look for ```json blocks containing "apps"
  const jsonBlockRegex = /```json\s*\n([\s\S]*?)\n```/g;
  let match;

  while ((match = jsonBlockRegex.exec(briefContent)) !== null) {
    const jsonStr = match[1];

    // Check if this block contains "apps" key
    if (jsonStr.includes('"apps"')) {
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.apps && typeof parsed.apps === 'object') {
          return parsed as BriefNavigationSchema;
        }
      } catch {
        // Not valid JSON, continue looking
        continue;
      }
    }
  }

  return null;
}

/**
 * Extract all screens from navigation schema, organized by app
 */
export function extractAllScreensFromSchema(schema: BriefNavigationSchema): ExtractedAppScreens[] {
  const result: ExtractedAppScreens[] = [];

  for (const [appId, app] of Object.entries(schema.apps)) {
    const appScreens: ExtractedAppScreens = {
      appId,
      appName: app.appName,
      appType: app.appType,
      layoutSkill: app.layoutSkill,
      screens: []
    };

    if (app.sections) {
      for (const [sectionId, section] of Object.entries(app.sections)) {
        if (section.screens && Array.isArray(section.screens)) {
          for (const screen of section.screens) {
            appScreens.screens.push({
              id: screen.id,
              file: screen.file,
              section: sectionId,
              sectionName: section.sectionName,
              description: screen.description,
              parentEntity: section.parentEntity
            });
          }
        }
      }
    }

    if (appScreens.screens.length > 0) {
      result.push(appScreens);
    }
  }

  return result;
}

/**
 * Get a flat list of all screen IDs from extracted apps
 */
export function getAllScreenIds(apps: ExtractedAppScreens[]): Set<string> {
  const ids = new Set<string>();
  for (const app of apps) {
    for (const screen of app.screens) {
      ids.add(screen.id);
    }
  }
  return ids;
}

/**
 * Format screen inventory for Claude prompts
 */
export function formatScreenInventory(apps: ExtractedAppScreens[]): string {
  if (apps.length === 0) return '';

  const parts: string[] = ['## Complete Screen Inventory from Brief\n'];

  for (const app of apps) {
    parts.push(`### App: ${app.appId} (${app.appName})`);
    parts.push(`Type: ${app.appType} | Layout: ${app.layoutSkill}`);
    parts.push(`Total Screens: ${app.screens.length}\n`);

    // Group by section
    const bySection = new Map<string, typeof app.screens>();
    for (const screen of app.screens) {
      const key = screen.section;
      if (!bySection.has(key)) {
        bySection.set(key, []);
      }
      bySection.get(key)!.push(screen);
    }

    for (const [sectionId, screens] of bySection) {
      const sectionName = screens[0]?.sectionName || sectionId;
      parts.push(`#### Section: ${sectionName} (${sectionId})`);
      parts.push('| Screen ID | File | Description |');
      parts.push('|-----------|------|-------------|');
      for (const screen of screens) {
        parts.push(`| ${screen.id} | ${screen.file} | ${screen.description} |`);
      }
      parts.push('');
    }
  }

  parts.push(`\n**CRITICAL**: Your output MUST include ALL ${apps.reduce((sum, app) => sum + app.screens.length, 0)} screens listed above.`);
  parts.push('If a screen is not covered by a primary flow, add it to a category-specific flow (e.g., "Settings Flow", "Financial Flow").');

  return parts.join('\n');
}

/**
 * Format a concise screen list for coverage checking
 */
export function formatScreenList(apps: ExtractedAppScreens[]): string {
  if (apps.length === 0) return '';

  const parts: string[] = ['## Screen List for Coverage Validation\n'];

  for (const app of apps) {
    parts.push(`### ${app.appId} (${app.screens.length} screens)`);
    for (const screen of app.screens) {
      parts.push(`- ${screen.id}: ${screen.description}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}
