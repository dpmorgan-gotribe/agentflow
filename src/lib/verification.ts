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

/**
 * Navigation override structure from navigation-schema.md
 */
export interface SectionNavigation {
  header?: {
    variant?: string;
    actions?: string[];
    breadcrumb?: boolean;
  };
  footer?: {
    variant?: string;
    tabs?: string[];
  };
  sidemenu?: {
    visible?: boolean;
    items?: string[];
    variant?: string;
  };
}

/**
 * Parse navigation-schema.md content and build screen->navigation lookup
 * Returns a map of screenId -> navigation override
 */
export function parseNavigationSchema(schemaContent: string): {
  defaultNavigation: SectionNavigation;
  screenNavigationMap: Map<string, SectionNavigation>;
} {
  const screenNavigationMap = new Map<string, SectionNavigation>();
  let defaultNavigation: SectionNavigation = {};

  // Parse YAML-like content (simple regex-based parsing)
  // Extract defaultNavigation block
  const defaultNavMatch = schemaContent.match(/defaultNavigation:\s*\n([\s\S]*?)(?=\n\s{4}sections:|\n\s{2}-\s)/);
  if (defaultNavMatch) {
    defaultNavigation = parseNavigationBlock(defaultNavMatch[1]);
  }

  // Split content by section markers
  const sectionBlocks = schemaContent.split(/(?=\n\s*-\s*sectionId:)/);

  for (const block of sectionBlocks) {
    // Extract sectionId
    const sectionIdMatch = block.match(/sectionId:\s*(\S+)/);
    if (!sectionIdMatch) continue;

    const sectionId = sectionIdMatch[1];

    // Extract screens list
    const screensMatch = block.match(/screens:\s*\[([^\]]+)\]/);
    if (!screensMatch) continue;

    const screens = screensMatch[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(s => s);

    // Extract navigationOverride block
    const navOverrideMatch = block.match(/navigationOverride:\s*\n([\s\S]*?)(?=\n\s{8}screens:|\n\s*-\s*sectionId:|\n\s*$)/);
    let navOverride: SectionNavigation = {};
    if (navOverrideMatch) {
      navOverride = parseNavigationBlock(navOverrideMatch[1]);
    }

    // Merge with default navigation
    const mergedNav = mergeNavigation(defaultNavigation, navOverride);

    // Assign to each screen in this section
    for (const screenId of screens) {
      screenNavigationMap.set(screenId, mergedNav);
    }
  }

  return { defaultNavigation, screenNavigationMap };
}

/**
 * Parse a navigation block from YAML-like content
 */
function parseNavigationBlock(block: string): SectionNavigation {
  const nav: SectionNavigation = {};

  // Parse header - look for header: followed by indented content or inline
  const headerMatch = block.match(/header:\s*\n([\s\S]*?)(?=\n\s*(?:footer|sidemenu):|$)/);
  if (headerMatch) {
    nav.header = {};
    const variantMatch = headerMatch[1].match(/variant:\s*(\S+)/);
    if (variantMatch) nav.header.variant = variantMatch[1];
    const actionsMatch = headerMatch[1].match(/actions:\s*\[([^\]]+)\]/);
    if (actionsMatch) nav.header.actions = actionsMatch[1].split(',').map(s => s.trim());
    const breadcrumbMatch = headerMatch[1].match(/breadcrumb:\s*(true|false)/);
    if (breadcrumbMatch) nav.header.breadcrumb = breadcrumbMatch[1] === 'true';
  }

  // Parse footer
  const footerMatch = block.match(/footer:\s*\n([\s\S]*?)(?=\n\s*(?:header|sidemenu):|$)/);
  if (footerMatch) {
    nav.footer = {};
    const variantMatch = footerMatch[1].match(/variant:\s*(\S+)/);
    if (variantMatch) nav.footer.variant = variantMatch[1];
    const tabsMatch = footerMatch[1].match(/tabs:\s*\[([^\]]+)\]/);
    if (tabsMatch) nav.footer.tabs = tabsMatch[1].split(',').map(s => s.trim());
  }

  // Parse sidemenu
  const sidemenuMatch = block.match(/sidemenu:\s*\n?([\s\S]*?)(?=\n\s*(?:header|footer):|$)/);
  if (sidemenuMatch) {
    nav.sidemenu = {};
    const visibleMatch = sidemenuMatch[1].match(/visible:\s*(true|false)/);
    if (visibleMatch) nav.sidemenu.visible = visibleMatch[1] === 'true';
    // Look for items or sections (both indicate menu items)
    const itemsMatch = sidemenuMatch[1].match(/(?:items|sections):\s*\[([^\]]+)\]/);
    if (itemsMatch) nav.sidemenu.items = itemsMatch[1].split(',').map(s => s.trim());
    const variantMatch = sidemenuMatch[1].match(/variant:\s*(\S+)/);
    if (variantMatch) nav.sidemenu.variant = variantMatch[1];
  }

  return nav;
}

/**
 * Merge default navigation with section override
 */
function mergeNavigation(defaultNav: SectionNavigation, override: SectionNavigation): SectionNavigation {
  return {
    header: override.header ? { ...defaultNav.header, ...override.header } : defaultNav.header,
    footer: override.footer ? { ...defaultNav.footer, ...override.footer } : defaultNav.footer,
    sidemenu: override.sidemenu ? { ...defaultNav.sidemenu, ...override.sidemenu } : defaultNav.sidemenu
  };
}

/**
 * Apply navigation from schema to screens JSON
 * Post-processes the screens array to add navigation details
 */
export function applyNavigationToScreens(
  screens: Array<{ id: string; section?: string; navigation?: any; [key: string]: any }>,
  screenNavigationMap: Map<string, SectionNavigation>,
  defaultNavigation: SectionNavigation
): void {
  for (const screen of screens) {
    // Look up navigation by screen id
    let nav = screenNavigationMap.get(screen.id);

    // If not found by id, try to infer from section
    if (!nav && screen.section) {
      // Find any screen in the same section that has navigation
      for (const [screenId, screenNav] of screenNavigationMap.entries()) {
        if (screenId.startsWith(screen.section + '-') || screenId.includes(screen.section)) {
          nav = screenNav;
          break;
        }
      }
    }

    // Apply navigation (use default if not found)
    const effectiveNav = nav || defaultNavigation;

    if (effectiveNav && Object.keys(effectiveNav).length > 0) {
      // Build full navigation object with activeTab/activeSection
      screen.navigation = {
        header: effectiveNav.header || { variant: 'standard' },
        footer: effectiveNav.footer ? {
          ...effectiveNav.footer,
          activeTab: inferActiveTab(screen.id, effectiveNav.footer.tabs)
        } : { variant: 'hidden' },
        sidemenu: effectiveNav.sidemenu ? {
          ...effectiveNav.sidemenu,
          activeSection: inferActiveSection(screen.id, effectiveNav.sidemenu.items)
        } : { visible: false }
      };
    }
  }
}

/**
 * Infer which tab should be active based on screen id
 */
function inferActiveTab(screenId: string, tabs?: string[]): string | undefined {
  if (!tabs || tabs.length === 0) return undefined;

  // Check if screen id contains any tab name
  for (const tab of tabs) {
    if (screenId.includes(tab)) {
      return tab;
    }
  }

  // Default to first tab
  return tabs[0];
}

/**
 * Infer which section should be active in sidemenu
 */
function inferActiveSection(screenId: string, items?: string[]): string | undefined {
  if (!items || items.length === 0) return undefined;

  // Check if screen id contains any item name
  for (const item of items) {
    if (screenId.includes(item)) {
      return item;
    }
  }

  // Default to first item
  return items[0];
}
