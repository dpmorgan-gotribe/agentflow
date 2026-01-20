/**
 * Navigation Schema Types (v3.0 Only)
 *
 * Per-platform screens.json with single app object.
 * Each platform generates its own file: webapp-screens.json, admin-screens.json, etc.
 */

// Navigation state for a screen
export interface NavigationState {
  sidemenu?: {
    visible: boolean;
    activeSection?: string;
    items?: string[];
  };
  header?: {
    variant: 'standard' | 'minimal' | 'hidden' | 'search';
    title?: string;
    actions?: string[];  // icon names
  };
  footer?: {
    variant: 'tab-bar' | 'minimal' | 'hidden';
    activeTab?: string;
    tabs?: string[];
  };
}

// App type - all types generate UI screens with different layout styles
export type AppType = 'webapp' | 'mobile' | 'admin';

// Layout skill type
export type LayoutSkill = 'webapp' | 'mobile' | 'desktop';

/**
 * Screen - fully self-contained with all metadata
 */
export interface Screen {
  id: string;
  file: string;
  name: string;
  description: string;
  section: string;
  parentEntity?: string;
  navigation?: Partial<NavigationState>;  // Only overrides from app default
  components: string[];
  icons: string[];
  flows: string[];
}

/**
 * App - single app definition with all its screens
 */
export interface App {
  appId: string;
  appName: string;
  appType: AppType;
  layoutSkill: LayoutSkill;
  defaultNavigation: NavigationState;
  screens: Screen[];
}

/**
 * PlatformScreensJson - per-platform screens file (v3.0)
 * Each platform has its own file: webapp-screens.json, admin-screens.json
 */
export interface PlatformScreensJson {
  version: '3.0';
  generatedAt: string;
  app: App;
}

/**
 * Coverage report derived from screens
 */
export interface Coverage {
  total: number;
  inFlows: number;
  orphaned: string[];
  percent: number;
}

// =============================================================================
// ACCESSOR FUNCTIONS
// =============================================================================

/**
 * Get all unique components across all screens
 */
export function getAllComponents(data: PlatformScreensJson): string[] {
  const components = new Set<string>();
  for (const screen of data.app.screens) {
    if (screen.components) {
      screen.components.forEach(c => components.add(c));
    }
  }
  return [...components].sort();
}

/**
 * Get all unique icons across all screens
 */
export function getAllIcons(data: PlatformScreensJson): string[] {
  const icons = new Set<string>();
  for (const screen of data.app.screens) {
    if (screen.icons) {
      screen.icons.forEach(i => icons.add(i));
    }
  }
  return [...icons].sort();
}

/**
 * Get all unique flows across all screens
 */
export function getAllFlows(data: PlatformScreensJson): string[] {
  const flows = new Set<string>();
  for (const screen of data.app.screens) {
    if (screen.flows) {
      screen.flows.forEach(f => flows.add(f));
    }
  }
  return [...flows].sort();
}

/**
 * Get all screen files as a flat array
 */
export function getAllScreenFiles(data: PlatformScreensJson): string[] {
  return data.app.screens.map(s => s.file);
}

/**
 * Get total screen count
 */
export function getTotalScreenCount(data: PlatformScreensJson): number {
  return data.app.screens.length;
}

/**
 * Get a screen by ID
 */
export function getScreenById(data: PlatformScreensJson, screenId: string): Screen | undefined {
  return data.app.screens.find(s => s.id === screenId);
}

/**
 * Get all screens for a specific section
 */
export function getScreensBySection(data: PlatformScreensJson, section: string): Screen[] {
  return data.app.screens.filter(s => s.section === section);
}

/**
 * Get all screens that belong to a specific flow
 */
export function getScreensInFlow(data: PlatformScreensJson, flowId: string): Screen[] {
  return data.app.screens.filter(s => s.flows?.includes(flowId));
}

/**
 * Compute coverage statistics from screens
 */
export function getCoverage(data: PlatformScreensJson): Coverage {
  const total = data.app.screens.length;
  let inFlows = 0;
  const orphaned: string[] = [];

  for (const screen of data.app.screens) {
    if (screen.flows && screen.flows.length > 0) {
      inFlows++;
    } else {
      orphaned.push(screen.id);
    }
  }

  return {
    total,
    inFlows,
    orphaned,
    percent: total > 0 ? Math.round((inFlows / total) * 100) : 100
  };
}

/**
 * Get component usage counts across all screens
 */
export function getComponentUsage(data: PlatformScreensJson): Record<string, number> {
  const usage: Record<string, number> = {};
  for (const screen of data.app.screens) {
    for (const component of screen.components || []) {
      usage[component] = (usage[component] || 0) + 1;
    }
  }
  return usage;
}

/**
 * Get icon usage counts across all screens
 */
export function getIconUsage(data: PlatformScreensJson): Record<string, number> {
  const usage: Record<string, number> = {};
  for (const screen of data.app.screens) {
    for (const icon of screen.icons || []) {
      usage[icon] = (usage[icon] || 0) + 1;
    }
  }
  return usage;
}

/**
 * Get effective navigation for a screen (merged with app defaults)
 */
export function getEffectiveNavigation(data: PlatformScreensJson, screenId: string): Partial<NavigationState> {
  const screen = getScreenById(data, screenId);

  if (!screen) {
    return {};
  }

  const app = data.app;
  const result: Partial<NavigationState> = {};

  if (app.defaultNavigation.header || screen.navigation?.header) {
    result.header = { ...app.defaultNavigation.header, ...screen.navigation?.header } as NavigationState['header'];
  }
  if (app.defaultNavigation.footer || screen.navigation?.footer) {
    result.footer = { ...app.defaultNavigation.footer, ...screen.navigation?.footer } as NavigationState['footer'];
  }
  if (app.defaultNavigation.sidemenu || screen.navigation?.sidemenu) {
    result.sidemenu = { ...app.defaultNavigation.sidemenu, ...screen.navigation?.sidemenu } as NavigationState['sidemenu'];
  }

  return result;
}

// =============================================================================
// VALIDATION
// =============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate v3.0 schema structure
 */
export function validateSchema(data: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const json = data as Record<string, unknown>;

  // Check version
  if (json.version !== '3.0') {
    errors.push(`Expected version 3.0, got ${json.version}`);
  }

  // Check app object (not apps array)
  if (!json.app || typeof json.app !== 'object') {
    errors.push('Missing app object');
    return { valid: false, errors, warnings };
  }

  // Check for incorrect apps array
  if ('apps' in json && Array.isArray(json.apps)) {
    errors.push('Found "apps" array - should be single "app" object');
  }

  const app = json.app as Record<string, unknown>;

  // Check required app fields
  if (!app.appId) errors.push('Missing app.appId');
  if (!app.appName) errors.push('Missing app.appName');
  if (!app.appType) errors.push('Missing app.appType');
  if (!app.layoutSkill) errors.push('Missing app.layoutSkill');

  // Check screens array
  if (!Array.isArray(app.screens)) {
    errors.push('Missing screens array in app');
    return { valid: false, errors, warnings };
  }

  const screens = app.screens as Record<string, unknown>[];

  // Validate each screen
  for (const screen of screens) {
    const screenId = screen.id as string || 'unknown';

    if (!screen.id) errors.push('Screen missing id');
    if (!screen.file) errors.push(`Screen ${screenId} missing file`);
    if (!screen.name) errors.push(`Screen ${screenId} missing name`);
    if (!screen.section) errors.push(`Screen ${screenId} missing section`);

    // Check arrays exist and have minimum items
    if (!Array.isArray(screen.components)) {
      errors.push(`Screen ${screenId} missing components array`);
    } else if (screen.components.length < 2) {
      warnings.push(`Screen ${screenId} has fewer than 2 components`);
    }

    if (!Array.isArray(screen.icons)) {
      errors.push(`Screen ${screenId} missing icons array`);
    } else if (screen.icons.length < 1) {
      warnings.push(`Screen ${screenId} has no icons`);
    }

    if (!Array.isArray(screen.flows)) {
      errors.push(`Screen ${screenId} missing flows array`);
    } else if (screen.flows.length < 1) {
      warnings.push(`Screen ${screenId} has no flows`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Check if data looks like v3.0 schema (for quick detection)
 */
export function isV3Schema(data: unknown): data is PlatformScreensJson {
  return typeof data === 'object' && data !== null &&
    'version' in data && (data as Record<string, unknown>).version === '3.0' &&
    'app' in data && typeof (data as Record<string, unknown>).app === 'object';
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Detect app type from platform name
 */
export function detectAppType(platform: string): AppType {
  const lowerPlatform = platform.toLowerCase();
  if (lowerPlatform.includes('backend') || lowerPlatform.includes('admin')) {
    return 'admin';
  }
  if (lowerPlatform.includes('mobile')) {
    return 'mobile';
  }
  return 'webapp';
}

/**
 * Get layout skill for app type
 */
export function getLayoutSkill(appType: AppType): LayoutSkill {
  switch (appType) {
    case 'admin': return 'desktop';   // dense layouts for power users
    case 'mobile': return 'mobile';   // touch-optimized
    default: return 'webapp';         // responsive
  }
}

/**
 * Get platform ID from app ID (e.g., "gotribe-webapp" -> "webapp")
 */
export function getPlatformId(appId: string): string {
  // Remove common prefixes
  return appId.replace(/^gotribe-/, '').replace(/^app-/, '');
}

/**
 * Get screens filename for a platform
 */
export function getScreensFilename(platform: string): string {
  const platformId = getPlatformId(platform);
  return `${platformId}-screens.json`;
}
