# BUG-004: Remove Legacy Schema Support - Enforce v3.0 Only

## Problem Description

The system currently supports three schema versions for `screens.json`:
- **v1.0**: Legacy flat schema (screens array + separate mappings)
- **v2.0**: Enhanced with apps/sections (backward compat with v1.0 fields)
- **v3.0**: Unified app-centric schema (everything derived from screens)

This backward compatibility adds complexity:
1. Multiple code paths for different schema versions
2. Compat accessor functions (`getComponentsCompat`, `getIconsCompat`, etc.)
3. Type guards for each version (`isUnifiedSchema`, `isEnhancedSchema`, `isLegacySchema`)
4. The Claude agent still outputs v2.0 instead of v3.0 (431 screens is too large)

We want to enforce v3.0 as the only supported format.

## Root Cause Analysis

**Primary Issue:** The Claude agent outputs v2.0 instead of v3.0 because:
1. 431 screens in a single JSON is too large for reliable generation
2. The v3.0 format requires more data per screen (components, icons, flows)
3. Agent truncates or simplifies to fit output limits

**Solution:** Split screens.json by platform/app:
- `webapp-screens.json` (210 screens)
- `admin-screens.json` (221 screens)

Each file is smaller and more likely to be generated correctly in v3.0 format.

A clean break to v3.0 only will:
1. Simplify the codebase
2. Force the analyze command to produce v3.0 output
3. Remove dead code paths
4. Enable per-platform processing for better reliability

## Implementation Steps

### Step 1: Platform-Based File Structure

**New Output Structure:**
```
outputs/analysis/
├── webapp-screens.json    # GoTribe Webapp (210 screens)
├── admin-screens.json     # GoTribe Admin (221 screens)
├── flows.md               # Shared user flows
├── research.md            # Competitive analysis
├── styles.md              # Style options
├── assets.md              # Asset definitions
└── inspirations.md        # Mood board
```

**Per-Platform Schema (v3.0 single-app):**
```json
{
  "version": "3.0",
  "generatedAt": "2026-01-11T12:00:00Z",
  "app": {
    "appId": "gotribe-webapp",
    "appName": "GoTribe Webapp",
    "appType": "webapp",
    "layoutSkill": "webapp",
    "defaultNavigation": { ... },
    "screens": [
      {
        "id": "auth-splash",
        "file": "auth-splash.html",
        "name": "Splash Screen",
        "description": "...",
        "section": "auth",
        "components": ["header", "button-primary"],
        "icons": ["language"],
        "flows": ["onboarding"]
      }
    ]
  }
}
```

**Key Change:** Instead of `apps: []` array, each file has a single `app: {}` object. This simplifies the schema and makes per-platform processing cleaner.

### Step 2: Update `navigation-schema.ts`

**Remove:**
- `LegacyScreensJson` interface
- `EnhancedScreensJson` interface
- `isLegacySchema()` function
- `isEnhancedSchema()` function
- `migrateLegacyToEnhanced()` function
- `extractLegacyFormat()` function
- `AnyScreensJson` type union
- `detectSchemaVersion()` function
- `getComponentsCompat()` function
- `getIconsCompat()` function
- `getScreenFilesCompat()` function
- Multi-app accessors (replaced by single-app)

**New Types (simplified):**
```typescript
// Single screen with all metadata
export interface Screen {
  id: string;
  file: string;
  name: string;
  description: string;
  section: string;
  parentEntity?: string;
  navigation?: Partial<NavigationState>;
  components: string[];
  icons: string[];
  flows: string[];
}

// Single app definition
export interface App {
  appId: string;
  appName: string;
  appType: 'webapp' | 'mobile' | 'admin';
  layoutSkill: 'webapp' | 'mobile' | 'desktop';
  defaultNavigation: NavigationState;
  screens: Screen[];
}

// Per-platform screens.json (single app)
export interface PlatformScreensJson {
  version: '3.0';
  generatedAt: string;
  app: App;
}

// Coverage derived from screens
export interface Coverage {
  total: number;
  inFlows: number;
  orphaned: string[];
  percent: number;
}
```

**New Accessor Functions:**
```typescript
// Get all components from a platform's screens
export function getAllComponents(data: PlatformScreensJson): string[] {
  const components = new Set<string>();
  for (const screen of data.app.screens) {
    screen.components?.forEach(c => components.add(c));
  }
  return [...components].sort();
}

// Get all icons from a platform's screens
export function getAllIcons(data: PlatformScreensJson): string[] {
  const icons = new Set<string>();
  for (const screen of data.app.screens) {
    screen.icons?.forEach(i => icons.add(i));
  }
  return [...icons].sort();
}

// Get all flows from a platform's screens
export function getAllFlows(data: PlatformScreensJson): string[] {
  const flows = new Set<string>();
  for (const screen of data.app.screens) {
    screen.flows?.forEach(f => flows.add(f));
  }
  return [...flows].sort();
}

// Get all screen files
export function getAllScreenFiles(data: PlatformScreensJson): string[] {
  return data.app.screens.map(s => s.file);
}

// Get screen by ID
export function getScreenById(data: PlatformScreensJson, screenId: string): Screen | undefined {
  return data.app.screens.find(s => s.id === screenId);
}

// Get screens by section
export function getScreensBySection(data: PlatformScreensJson, section: string): Screen[] {
  return data.app.screens.filter(s => s.section === section);
}

// Get screens in a flow
export function getScreensInFlow(data: PlatformScreensJson, flowId: string): Screen[] {
  return data.app.screens.filter(s => s.flows?.includes(flowId));
}

// Compute coverage
export function getCoverage(data: PlatformScreensJson): Coverage {
  const total = data.app.screens.length;
  let inFlows = 0;
  const orphaned: string[] = [];

  for (const screen of data.app.screens) {
    if (screen.flows?.length > 0) {
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

// Get component usage counts
export function getComponentUsage(data: PlatformScreensJson): Record<string, number> {
  const usage: Record<string, number> = {};
  for (const screen of data.app.screens) {
    for (const component of screen.components || []) {
      usage[component] = (usage[component] || 0) + 1;
    }
  }
  return usage;
}

// Get icon usage counts
export function getIconUsage(data: PlatformScreensJson): Record<string, number> {
  const usage: Record<string, number> = {};
  for (const screen of data.app.screens) {
    for (const icon of screen.icons || []) {
      usage[icon] = (usage[icon] || 0) + 1;
    }
  }
  return usage;
}

// Validate v3.0 schema
export function validateSchema(data: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const json = data as Record<string, unknown>;

  if (json.version !== '3.0') {
    errors.push(`Expected version 3.0, got ${json.version}`);
  }

  if (!json.app || typeof json.app !== 'object') {
    errors.push('Missing app object');
    return { valid: false, errors };
  }

  const app = json.app as Record<string, unknown>;
  if (!Array.isArray(app.screens)) {
    errors.push('Missing screens array in app');
    return { valid: false, errors };
  }

  for (const screen of app.screens as Record<string, unknown>[]) {
    if (!screen.id) errors.push('Screen missing id');
    if (!Array.isArray(screen.components) || screen.components.length < 2) {
      errors.push(`Screen ${screen.id} needs min 2 components`);
    }
    if (!Array.isArray(screen.icons) || screen.icons.length < 1) {
      errors.push(`Screen ${screen.id} needs min 1 icon`);
    }
    if (!Array.isArray(screen.flows) || screen.flows.length < 1) {
      errors.push(`Screen ${screen.id} needs min 1 flow`);
    }
  }

  return { valid: errors.length === 0, errors };
}
```

### Step 3: Update `analyze.ts` - Per-Platform Processing

**Key Changes:**
1. Process each app/platform separately
2. Generate `{platform}-screens.json` for each app
3. Run screens worker once per platform (smaller outputs)
4. Validate each output is v3.0 format
5. Retry if validation fails

**New Flow:**
```typescript
// Phase 3: Screen, Component & Icon Mapping (PER PLATFORM)
console.log('\n--- Phase 3: Screen, Component & Icon Mapping ---');

// Extract apps from brief schema
const briefApps = extractAppsFromBrief(combinedBrief);
// e.g., [{ appId: 'gotribe-webapp', screens: [...] }, { appId: 'gotribe-admin', screens: [...] }]

for (const briefApp of briefApps) {
  const platformId = briefApp.appId.replace('gotribe-', ''); // 'webapp', 'admin'
  const screenCount = briefApp.screens.length;

  console.log(`\nProcessing: ${briefApp.appId} (${screenCount} screens)`);

  // Build platform-specific screen inventory
  const platformInventory = formatPlatformInventory(briefApp);

  // Run screens worker for this platform only
  const screensResult = await runWorkerSequential({
    id: `screens-${platformId}`,
    systemPrompt: `${systemPrompt}\n\n## Skill\n\n${screensSkill}`,
    timeout: 300000, // 5 minutes per platform
    userPrompt: `Generate v3.0 screens JSON for: ${briefApp.appName}

${platformInventory}

## Flows Analysis (filter for this app)
${filterFlowsForApp(flowsResult.output, briefApp.appId)}

${iconInventoryForScreens}

OUTPUT v3.0 JSON FORMAT (single app):
{
  "version": "3.0",
  "generatedAt": "${new Date().toISOString()}",
  "app": {
    "appId": "${briefApp.appId}",
    "appName": "${briefApp.appName}",
    "appType": "${briefApp.appType}",
    "layoutSkill": "${briefApp.layoutSkill}",
    "defaultNavigation": { ... },
    "screens": [
      {
        "id": "screen-id",
        "file": "screen-id.html",
        "name": "Screen Name",
        "description": "...",
        "section": "section-id",
        "components": ["component1", "component2"],
        "icons": ["icon1"],
        "flows": ["flow1"]
      }
    ]
  }
}

CRITICAL:
- Output ONLY this single app (${briefApp.appId})
- Include ALL ${screenCount} screens
- Every screen needs: components (min 2), icons (min 1), flows (min 1)
- Use "miscellaneous" flow for screens not in a defined flow

No markdown, no explanations, just JSON.`
  });

  if (screensResult.output) {
    let jsonContent = screensResult.output.trim();
    if (jsonContent.startsWith('```')) {
      jsonContent = jsonContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    try {
      const parsed = JSON.parse(jsonContent);

      // Validate v3.0 schema
      const validation = validateSchema(parsed);
      if (!validation.valid) {
        console.warn(`  ⚠ Validation errors for ${platformId}:`);
        validation.errors.slice(0, 5).forEach(e => console.warn(`    - ${e}`));
        // Could add retry logic here
      }

      // Write platform-specific file
      const filename = `${platformId}-screens.json`;
      await writeFile(join(sharedDir, filename), JSON.stringify(parsed, null, 2));
      console.log(`  Written: ${filename}`);

      // Report stats
      const screenCount = parsed.app?.screens?.length || 0;
      const components = getAllComponents(parsed);
      const icons = getAllIcons(parsed);
      const coverage = getCoverage(parsed);

      console.log(`  Screens: ${screenCount}`);
      console.log(`  Components: ${components.length}`);
      console.log(`  Icons: ${icons.length}`);
      console.log(`  Flow coverage: ${coverage.percent}%`);

    } catch (e) {
      console.warn(`  Warning: ${platformId}-screens.json output was not valid JSON`);
    }
  }
}
```

**Helper Functions:**
```typescript
// Extract apps from brief JSON schema
function extractAppsFromBrief(brief: string): BriefApp[] {
  // Parse the navigation schema JSON from brief
  const schemaMatch = brief.match(/```json\n(\{[\s\S]*?"apps"[\s\S]*?\})\n```/);
  if (!schemaMatch) return [];

  const schema = JSON.parse(schemaMatch[1]);
  return Object.entries(schema.apps).map(([appId, appData]: [string, any]) => ({
    appId,
    appName: appData.appName,
    appType: appData.appType,
    layoutSkill: appData.layoutSkill,
    screens: Object.values(appData.sections).flatMap((s: any) => s.screens)
  }));
}

// Format screen inventory for a single platform
function formatPlatformInventory(app: BriefApp): string {
  return `## Complete Screen Inventory for ${app.appName}

Total: ${app.screens.length} screens

${app.screens.map((s: any, i: number) =>
  `${i + 1}. ${s.id} - ${s.description}`
).join('\n')}`;
}

// Filter flows.md content for a specific app
function filterFlowsForApp(flowsContent: string, appId: string): string {
  // Extract flows that mention this app's screens
  // Implementation depends on flows.md format
  return flowsContent; // Or filtered version
}
```

### Step 4: Update `mockups.ts` - Per-Platform Loading

**Changes:**
```typescript
// Before
import { getComponentsCompat, AnyScreensJson } from '../lib/navigation-schema.js';
const screensJsonPath = join(platformAnalysisDir, 'screens.json');
const components = getComponentsCompat(screensData);

// After
import { getAllComponents, PlatformScreensJson } from '../lib/navigation-schema.js';

// Load platform-specific screens file
const platformId = platform?.replace('gotribe-', '') || 'webapp';
const screensJsonPath = join(analysisDir, `${platformId}-screens.json`);

try {
  const screensJsonContent = await readFile(screensJsonPath, 'utf-8');
  const screensData = JSON.parse(screensJsonContent) as PlatformScreensJson;
  const components = getAllComponents(screensData);
  // ...
} catch {
  console.error(`${platformId}-screens.json not found. Run 'agentflow analyze' first.`);
}
```

### Step 5: Update `stylesheet.ts` - Per-Platform Loading

**Changes:**
```typescript
// Before
import { getComponentsCompat, getIconsCompat, AnyScreensJson } from '../lib/navigation-schema.js';
const screensJson = await readFile(join(platformAnalysisDir, 'screens.json'), 'utf-8');
componentsList = getComponentsCompat(screensJsonData);
iconsList = getIconsCompat(screensJsonData);

// After
import { getAllComponents, getAllIcons, PlatformScreensJson } from '../lib/navigation-schema.js';

// Load platform-specific screens file
const platformId = platform?.replace('gotribe-', '') || 'webapp';
const screensJsonPath = join(analysisDir, `${platformId}-screens.json`);

try {
  const screensJson = await readFile(screensJsonPath, 'utf-8');
  const screensJsonData = JSON.parse(screensJson) as PlatformScreensJson;
  componentsList = getAllComponents(screensJsonData);
  iconsList = getAllIcons(screensJsonData);
  console.log(`Loaded ${componentsList.length} components, ${iconsList.length} icons from ${platformId}-screens.json`);
} catch {
  console.error(`${platformId}-screens.json not found. Run 'agentflow analyze' first.`);
  process.exit(1);
}
```

### Step 6: Update `screens.ts` - Per-Platform Loading

**Changes:**
```typescript
// Before
import { isUnifiedSchema, getScreenFilesCompat, AnyScreensJson } from '../lib/navigation-schema.js';
const screensJsonPath = join(platformAnalysisDir, 'screens.json');
const screenFiles = getScreenFilesCompat(screensData);

// After
import { getAllScreenFiles, PlatformScreensJson } from '../lib/navigation-schema.js';

// Load platform-specific screens file
const platformId = platform?.replace('gotribe-', '') || 'webapp';
const screensJsonPath = join(analysisDir, `${platformId}-screens.json`);

try {
  const screensJsonContent = await readFile(screensJsonPath, 'utf-8');
  const screensData = JSON.parse(screensJsonContent) as PlatformScreensJson;
  const screenFiles = getAllScreenFiles(screensData);
  uniqueScreens = screenFiles.map(s => s.replace('.html', ''));
  console.log(`Loaded ${uniqueScreens.length} screens from ${platformId}-screens.json`);
} catch {
  console.error(`${platformId}-screens.json not found. Run 'agentflow analyze' first.`);
  process.exit(1);
}
```

### Step 7: Update `verification.ts` - Simplified

**Changes:**
1. Remove `isEnhancedSchema` and `isUnifiedSchema` imports
2. Remove all legacy/enhanced handling
3. Use v3 accessors directly with `PlatformScreensJson`

```typescript
// Before
import {
  EnhancedScreensJson,
  LegacyScreensJson,
  UnifiedScreensJson,
  AnyScreensJson,
  isEnhancedSchema,
  isUnifiedSchema,
  getScreenFilesCompat,
  getComponentUsage,
  getIconUsage,
  getCoverage
} from './navigation-schema.js';

export function validateFlowCoverage(screensJson: AnyScreensJson): FlowCoverageReport {
  if (isUnifiedSchema(screensJson)) { ... }
  if (isEnhancedSchema(screensJson)) { ... }
  // legacy fallback
}

// After
import {
  PlatformScreensJson,
  getAllScreenFiles,
  getComponentUsage,
  getIconUsage,
  getCoverage
} from './navigation-schema.js';

export function validateFlowCoverage(screensJson: PlatformScreensJson): FlowCoverageReport {
  const coverage = getCoverage(screensJson);
  return {
    totalScreens: coverage.total,
    screensInFlows: coverage.inFlows,
    orphanedScreens: coverage.orphaned,
    coveragePercent: coverage.percent
  };
}

// generateDetailedCoverageReport - simplified
export async function generateDetailedCoverageReport(
  projectDir: string,
  platform: string,
  briefContent: string
): Promise<DetailedCoverageReport> {
  const basicReport = await generateCoverageReport(projectDir, platform, briefContent);

  // Load platform-specific screens file
  const platformId = platform.replace('gotribe-', '');
  const screensJsonPath = join(projectDir, 'outputs', 'analysis', `${platformId}-screens.json`);

  let componentUsage: Record<string, number> = {};
  let iconUsage: Record<string, number> = {};

  try {
    const content = await readFile(screensJsonPath, 'utf-8');
    const screensJson = JSON.parse(content) as PlatformScreensJson;
    componentUsage = getComponentUsage(screensJson);
    iconUsage = getIconUsage(screensJson);
  } catch {
    // File not found - return empty usage
  }

  return { ...basicReport, componentUsage, iconUsage };
}
```

### Step 8: Update Skill File - Single App Format

**File:** `skills/analysis/analyze-screens.md`

Update for per-platform single-app output:
```markdown
## CRITICAL: v3.0 Schema Required (Single App Format)

You MUST output v3.0 schema with a SINGLE `app` object (not an array).
This agent is called once per platform/app.

The response MUST:
1. Start with `{"version": "3.0"`
2. Have a single `app` object (NOT `apps` array)
3. The `app` contains a `screens` array
4. Each screen has: id, file, name, description, section, components[], icons[], flows[]

CORRECT FORMAT:
{
  "version": "3.0",
  "generatedAt": "...",
  "app": {
    "appId": "gotribe-webapp",
    "appName": "GoTribe Webapp",
    "appType": "webapp",
    "layoutSkill": "webapp",
    "defaultNavigation": { ... },
    "screens": [ ... ]
  }
}

DO NOT output:
- `apps` array (wrong - use single `app` object)
- Root-level `screens` array (v2.0 format)
- `screenComponents` mapping (deprecated)
- `screenIcons` mapping (deprecated)
- `userflows` array (deprecated - use `flows` on each screen)
```

### Step 9: Add Retry Logic for Non-v3.0 Output

**File:** `analyze.ts`

```typescript
const MAX_SCHEMA_RETRIES = 2;
let screensOutput = null;

for (let attempt = 1; attempt <= MAX_SCHEMA_RETRIES; attempt++) {
  const result = await runWorkerSequential({ ... });

  if (result.output) {
    const parsed = JSON.parse(result.output);
    const validation = validateV3Output(parsed);

    if (validation.valid) {
      screensOutput = parsed;
      break;
    }

    if (attempt < MAX_SCHEMA_RETRIES) {
      console.warn(`  Attempt ${attempt}: Invalid v3.0 output, retrying...`);
      console.warn(`  Errors: ${validation.errors.slice(0, 3).join(', ')}`);
      // Retry with more explicit prompt
    }
  }
}

if (!screensOutput) {
  console.error('Failed to generate valid v3.0 screens.json after retries');
  process.exit(1);
}
```

## Files to Modify

| File | Action |
|------|--------|
| `src/lib/navigation-schema.ts` | Remove legacy types, add `PlatformScreensJson` with single `app` object |
| `src/commands/analyze.ts` | Per-platform processing, v3 validation, retry logic per platform |
| `src/commands/mockups.ts` | Load `{platform}-screens.json`, use v3 accessors |
| `src/commands/stylesheet.ts` | Load `{platform}-screens.json`, use v3 accessors |
| `src/commands/screens.ts` | Load `{platform}-screens.json`, use v3 accessors |
| `src/lib/verification.ts` | Use `PlatformScreensJson`, remove legacy handling |
| `skills/analysis/analyze-screens.md` | Single-app v3.0 format enforcement |

## Testing Checklist

### Per-Platform File Generation
- [ ] `agentflow analyze` produces `webapp-screens.json` for webapp platform
- [ ] `agentflow analyze` produces `admin-screens.json` for admin platform
- [ ] Each file contains single `app` object (not `apps` array)
- [ ] Each screen has `components[]`, `icons[]`, `flows[]` arrays
- [ ] Retry logic triggers if v3.0 validation fails

### Downstream Commands (Per-Platform)
- [ ] `agentflow mockups --platform=webapp` loads `webapp-screens.json`
- [ ] `agentflow mockups --platform=admin` loads `admin-screens.json`
- [ ] `agentflow stylesheet --platform=webapp` loads `webapp-screens.json`
- [ ] `agentflow stylesheet --platform=admin` loads `admin-screens.json`
- [ ] `agentflow screens --platform=webapp` loads `webapp-screens.json`
- [ ] `agentflow screens --platform=admin` loads `admin-screens.json`

### Code Quality
- [ ] All TypeScript compiles without errors
- [ ] No references to `AnyScreensJson`, `LegacyScreensJson`, `EnhancedScreensJson`
- [ ] No references to `getComponentsCompat`, `getIconsCompat`, `getScreenFilesCompat`
- [ ] No references to `isLegacySchema`, `isEnhancedSchema`

### Edge Cases
- [ ] Error message when platform screens file not found
- [ ] Single-platform projects work with default `webapp-screens.json`

## Rollback Plan

If issues arise:
1. Revert changes to `navigation-schema.ts` to restore compat types
2. Revert command files to use compat accessors
3. The v3 accessors remain available for future use

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Claude still outputs v2.0 | Medium | Per-platform reduces output size, retry logic |
| Existing v2.0 projects break | Medium | Projects must re-run analyze |
| Large projects timeout | Low | Per-platform processing (210 screens vs 431) |
| Platform detection fails | Low | Default to 'webapp' platform |

## Success Criteria

1. `PlatformScreensJson` type with single `app` object is the only schema type
2. Each platform generates its own `{platform}-screens.json` file
3. Legacy types removed: `LegacyScreensJson`, `EnhancedScreensJson`, `AnyScreensJson`
4. Compat functions removed: `getComponentsCompat`, `getIconsCompat`, `getScreenFilesCompat`
5. `analyze` command processes each platform separately with v3.0 validation
6. All downstream commands load platform-specific screens file
7. TypeScript compiles without errors
