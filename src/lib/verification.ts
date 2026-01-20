import { readFile } from 'fs/promises';
import { join } from 'path';
import {
  PlatformScreensJson,
  getAllScreenFiles,
  getComponentUsage,
  getIconUsage,
  getCoverage,
  getPlatformId
} from './navigation-schema.js';

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
 * Load per-platform screens.json file
 */
async function loadScreensJson(projectDir: string, platform?: string): Promise<PlatformScreensJson | null> {
  const analysisDir = join(projectDir, 'outputs', 'analysis');

  // Build list of files to try
  const platformId = platform ? getPlatformId(platform) : 'webapp';
  const filesToTry = [
    join(analysisDir, `${platformId}-screens.json`),
    join(analysisDir, 'webapp-screens.json'),
    join(analysisDir, 'admin-screens.json')
  ];

  for (const filePath of filesToTry) {
    try {
      const content = await readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as PlatformScreensJson;

      // Validate v3.0 format
      if (data.version === '3.0' && data.app) {
        return data;
      }
    } catch {
      // Try next file
    }
  }

  return null;
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

  // Use accessor to get screens from v3.0 schema
  const generatedScreens: string[] = screensJson
    ? getAllScreenFiles(screensJson)
    : [];

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

  let componentUsage: Record<string, number> = {};
  let iconUsage: Record<string, number> = {};

  if (screensJson) {
    componentUsage = getComponentUsage(screensJson);
    iconUsage = getIconUsage(screensJson);
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

/**
 * Flow coverage report - tracks which screens are in user flows
 */
export interface FlowCoverageReport {
  totalScreens: number;
  screensInFlows: number;
  orphanedScreens: string[];
  coveragePercent: number;
}

/**
 * Validate flow coverage from screens.json
 * Uses v3.0 schema - screens have flows[] array
 */
export function validateFlowCoverage(
  screensJson: PlatformScreensJson
): FlowCoverageReport {
  const coverage = getCoverage(screensJson);
  return {
    totalScreens: coverage.total,
    screensInFlows: coverage.inFlows,
    orphanedScreens: coverage.orphaned,
    coveragePercent: coverage.percent
  };
}

/**
 * Print flow coverage report to console
 */
export function printFlowCoverageReport(report: FlowCoverageReport): void {
  const status = report.coveragePercent === 100 ? '✓' : '⚠';
  console.log(`\n${status} Flow Coverage: ${report.screensInFlows}/${report.totalScreens} (${report.coveragePercent}%)`);

  if (report.orphanedScreens.length > 0) {
    console.log('  Orphaned screens (not in any flow):');
    report.orphanedScreens.forEach(s => console.log(`    - ${s}`));
  }
}

/**
 * Extract navigation schema from flows.md content
 * Looks for YAML code block with # navigation-schema marker
 */
export function extractNavigationSchema(flowsMarkdown: string): string | null {
  // Look for yaml code block with navigation-schema marker
  const match = flowsMarkdown.match(/```yaml\s*\n#\s*navigation-schema\n([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}
