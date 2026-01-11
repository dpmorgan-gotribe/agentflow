import { readFile } from 'fs/promises';
import { join } from 'path';

export interface CoverageReport {
  platform: string;
  briefScreenCount: number;
  generatedScreenCount: number;
  coverage: number;
  missing: string[];
  extra: string[];
}

export interface DetailedCoverageReport extends CoverageReport {
  componentUsage: Record<string, number>;
  iconUsage: Record<string, number>;
}

/**
 * Extract screen names from a platform brief
 * Looks for table rows with screen names in the format:
 * | 1.1 | **Screen Name** | Description |
 */
export function extractScreensFromBrief(briefContent: string): string[] {
  const screens: string[] = [];

  // Match table rows with screen number and bolded screen name
  // Pattern: | 1.1 | **Screen Name** | or | 1.1 | Screen Name |
  const rowPattern = /^\|\s*\d+\.\d+\s*\|\s*\*?\*?([^|*]+)\*?\*?\s*\|/gm;

  let match;
  while ((match = rowPattern.exec(briefContent)) !== null) {
    const screenName = match[1].trim();
    if (screenName && screenName !== '#' && screenName !== 'Screen') {
      // Convert to filename format: "Screen Name" -> "screen-name.html"
      const filename = screenName
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim() + '.html';
      screens.push(filename);
    }
  }

  return screens;
}

/**
 * Load screens.json for a platform
 */
async function loadScreensJson(projectDir: string, platform?: string): Promise<any | null> {
  try {
    const screensPath = platform
      ? join(projectDir, 'outputs', 'analysis', platform, 'screens.json')
      : join(projectDir, 'outputs', 'analysis', 'screens.json');

    const content = await readFile(screensPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Generate coverage report for a platform
 */
export async function generateCoverageReport(
  projectDir: string,
  platform: string,
  briefContent: string
): Promise<CoverageReport> {
  const briefScreens = extractScreensFromBrief(briefContent);
  const screensJson = await loadScreensJson(projectDir, platform);

  const generatedScreens: string[] = screensJson?.screens || [];

  // Normalize screen names for comparison
  const normalizeScreen = (s: string) => s.toLowerCase().replace(/\.html$/, '');

  const briefSet = new Set(briefScreens.map(normalizeScreen));
  const generatedSet = new Set(generatedScreens.map(normalizeScreen));

  const missing = briefScreens.filter(s => !generatedSet.has(normalizeScreen(s)));
  const extra = generatedScreens.filter(s => !briefSet.has(normalizeScreen(s)));

  const coverage = briefScreens.length > 0
    ? Math.round((generatedScreens.length / briefScreens.length) * 100)
    : 100;

  return {
    platform,
    briefScreenCount: briefScreens.length,
    generatedScreenCount: generatedScreens.length,
    coverage: Math.min(coverage, 100),
    missing,
    extra
  };
}

/**
 * Generate detailed coverage report with component and icon usage
 */
export async function generateDetailedCoverageReport(
  projectDir: string,
  platform: string,
  briefContent: string
): Promise<DetailedCoverageReport> {
  const basicReport = await generateCoverageReport(projectDir, platform, briefContent);
  const screensJson = await loadScreensJson(projectDir, platform);

  const componentUsage: Record<string, number> = {};
  const iconUsage: Record<string, number> = {};

  if (screensJson?.screenComponents) {
    for (const [, components] of Object.entries(screensJson.screenComponents as Record<string, string[]>)) {
      for (const component of components) {
        componentUsage[component] = (componentUsage[component] || 0) + 1;
      }
    }
  }

  if (screensJson?.screenIcons) {
    for (const [, icons] of Object.entries(screensJson.screenIcons as Record<string, string[]>)) {
      for (const icon of icons) {
        iconUsage[icon] = (iconUsage[icon] || 0) + 1;
      }
    }
  }

  return {
    ...basicReport,
    componentUsage,
    iconUsage
  };
}

/**
 * Print coverage report to console
 */
export function printCoverageReport(report: CoverageReport, detailed: boolean = false): void {
  console.log(`  ${report.platform}: ${report.generatedScreenCount}/${report.briefScreenCount} screens (${report.coverage}%)`);

  if (detailed) {
    if (report.missing.length > 0) {
      console.log(`    Missing: ${report.missing.slice(0, 5).join(', ')}${report.missing.length > 5 ? ` (+${report.missing.length - 5} more)` : ''}`);
    }
    if (report.extra.length > 0) {
      console.log(`    Extra: ${report.extra.slice(0, 5).join(', ')}${report.extra.length > 5 ? ` (+${report.extra.length - 5} more)` : ''}`);
    }
  }
}

/**
 * Print detailed coverage report
 */
export function printDetailedCoverageReport(report: DetailedCoverageReport): void {
  console.log(`\n=== Detailed Coverage: ${report.platform} ===`);
  console.log(`Brief screens: ${report.briefScreenCount}`);
  console.log(`Generated screens: ${report.generatedScreenCount}`);
  console.log(`Coverage: ${report.coverage}%`);

  if (report.missing.length > 0) {
    console.log(`\nMissing screens (${report.missing.length}):`);
    report.missing.forEach(s => console.log(`  - ${s}`));
  } else {
    console.log('\nMissing: None');
  }

  if (report.extra.length > 0) {
    console.log(`\nExtra screens (${report.extra.length}):`);
    report.extra.forEach(s => console.log(`  - ${s}`));
  }

  const componentEntries = Object.entries(report.componentUsage)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);

  if (componentEntries.length > 0) {
    console.log('\nTop component usage:');
    componentEntries.forEach(([component, count]) => {
      console.log(`  ${component}: ${count} screens`);
    });
  }

  const iconEntries = Object.entries(report.iconUsage)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);

  if (iconEntries.length > 0) {
    console.log('\nTop icon usage:');
    iconEntries.forEach(([icon, count]) => {
      console.log(`  ${icon}: ${count} screens`);
    });
  }
}
