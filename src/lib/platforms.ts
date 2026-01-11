import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

export interface PlatformBrief {
  platform: string;
  content: string;
  screenCount: number;
}

export interface ProjectBriefs {
  main: string | null;
  platforms: PlatformBrief[];
}

/**
 * Detect platforms by scanning for brief-*.md files
 * Returns array of platform names (e.g., ['webapp', 'backend'])
 */
export async function detectPlatforms(projectDir: string): Promise<string[]> {
  try {
    const files = await readdir(projectDir);
    const briefFiles = files.filter(f => /^brief-(.+)\.md$/.test(f));

    return briefFiles.map(f => {
      const match = f.match(/^brief-(.+)\.md$/);
      return match ? match[1] : '';
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Count screens in a brief by looking for table rows with screen numbers
 * Handles formats like "| 1.1 |" or "| 2.1 |"
 */
function countScreensInBrief(content: string): number {
  // Match table rows that start with a screen number pattern like "| 1.1 |" or "| 10.1 |"
  const screenPattern = /^\|\s*\d+\.\d+\s*\|/gm;
  const matches = content.match(screenPattern);
  return matches ? matches.length : 0;
}

/**
 * Load all briefs from project directory
 * Returns main brief and platform-specific briefs
 */
export async function loadAllBriefs(projectDir: string): Promise<ProjectBriefs> {
  const result: ProjectBriefs = {
    main: null,
    platforms: []
  };

  // Load main brief
  try {
    const mainPath = join(projectDir, 'brief.md');
    result.main = await readFile(mainPath, 'utf-8');
  } catch {
    // No main brief
  }

  // Detect and load platform briefs
  const platforms = await detectPlatforms(projectDir);

  for (const platform of platforms) {
    try {
      const briefPath = join(projectDir, `brief-${platform}.md`);
      const content = await readFile(briefPath, 'utf-8');
      const screenCount = countScreensInBrief(content);

      result.platforms.push({
        platform,
        content,
        screenCount
      });
    } catch {
      // Skip if can't read
    }
  }

  return result;
}

/**
 * Check if project is multi-platform (has platform-specific briefs)
 */
export function isMultiPlatform(briefs: ProjectBriefs): boolean {
  return briefs.platforms.length > 0;
}

/**
 * Get combined brief content for analysis
 * Merges main brief with all platform briefs
 */
export function getCombinedBrief(briefs: ProjectBriefs): string {
  const parts: string[] = [];

  if (briefs.main && !isBriefTemplate(briefs.main)) {
    parts.push('# Main Project Brief\n\n' + briefs.main);
  }

  for (const platform of briefs.platforms) {
    parts.push(`\n\n# Platform: ${platform.platform}\n\n${platform.content}`);
  }

  return parts.join('\n') || 'No brief provided.';
}

/**
 * Check if brief content is just the template placeholder
 */
function isBriefTemplate(brief: string): boolean {
  return brief.includes('[Your brief here]') || brief.trim().endsWith('---');
}

/**
 * Get output directory for a specific platform
 */
export function getPlatformOutputDir(
  projectDir: string,
  outputType: 'analysis' | 'mockups' | 'flows' | 'stylesheet' | 'screens',
  platform?: string
): string {
  const baseDir = join(projectDir, 'outputs', outputType);

  if (platform) {
    return join(baseDir, platform);
  }

  return baseDir;
}

/**
 * Get shared analysis output directory (for styles, research, assets, inspirations)
 */
export function getSharedAnalysisDir(projectDir: string): string {
  return join(projectDir, 'outputs', 'analysis', 'shared');
}

/**
 * Resolve platform name from user input or auto-detect
 * Returns first platform if none specified and multiple exist
 * Allows valid skill types (webapp, mobile, desktop) even without brief files
 */
export async function resolvePlatform(
  projectDir: string,
  specifiedPlatform?: string
): Promise<string | null> {
  const platforms = await detectPlatforms(projectDir);
  const validSkillTypes: SkillType[] = ['webapp', 'mobile', 'desktop'];

  if (platforms.length === 0) {
    // No brief files found - check if specifiedPlatform is a valid skill type
    if (specifiedPlatform && validSkillTypes.includes(specifiedPlatform as SkillType)) {
      console.log(`Note: No brief-${specifiedPlatform}.md found, using ${specifiedPlatform} skill type.`);
      return specifiedPlatform;
    }
    return null; // Single-platform project (legacy)
  }

  if (specifiedPlatform) {
    if (platforms.includes(specifiedPlatform)) {
      return specifiedPlatform;
    }

    // Allow valid skill types even without brief file
    if (validSkillTypes.includes(specifiedPlatform as SkillType)) {
      console.log(`Note: No brief-${specifiedPlatform}.md found, using ${specifiedPlatform} skill type.`);
      return specifiedPlatform;
    }

    console.warn(`Warning: Platform "${specifiedPlatform}" not found. Available: ${platforms.join(', ')}`);
    return platforms[0];
  }

  // Return first platform if none specified
  return platforms[0];
}

/**
 * Layout skill types for design generation
 * - webapp: Responsive web layouts with breakpoints, hover states
 * - mobile: Touch-optimized with 44px targets, safe areas, gestures
 * - desktop: Dense layouts, keyboard navigation, multi-pane
 */
export type SkillType = 'webapp' | 'mobile' | 'desktop';

/**
 * Default mapping from platform to skill type
 * Platforms without specific skills default to webapp
 */
const platformToSkillMap: Record<string, SkillType> = {
  webapp: 'webapp',
  mobile: 'mobile',
  desktop: 'desktop',
  // All other platforms (backend, admin, etc.) default to webapp
};

/**
 * Resolve which layout skill to use based on platform and optional override
 *
 * @param platform - The target platform (webapp, mobile, backend, etc.)
 * @param skillOverride - Optional skill override (webapp, mobile, desktop)
 * @returns The skill type to use for design generation
 *
 * @example
 * resolveSkill('webapp')                    // Returns 'webapp'
 * resolveSkill('mobile')                    // Returns 'mobile'
 * resolveSkill('backend')                   // Returns 'webapp' (default)
 * resolveSkill('backend', 'mobile')         // Returns 'mobile' (override)
 */
export function resolveSkill(platform: string, skillOverride?: string): SkillType {
  const validSkills: SkillType[] = ['webapp', 'mobile', 'desktop'];

  // If skill override provided, validate and use it
  if (skillOverride) {
    if (validSkills.includes(skillOverride as SkillType)) {
      return skillOverride as SkillType;
    }
    console.warn(`Warning: Invalid skill "${skillOverride}". Valid options: ${validSkills.join(', ')}. Using default.`);
  }

  // Use platform-to-skill mapping, default to webapp
  return platformToSkillMap[platform] || 'webapp';
}
