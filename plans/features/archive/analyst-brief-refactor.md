# Analyst & Brief Refactoring Plan

## Problem Statement

The current AgentFlow system has these issues:

1. **Screen Disconnection**: Screens like "documents" and "media" lose parent entity context (e.g., tribe-documents vs event-documents)
2. **Missing Screen Coverage**: `screens.json` outputs screens not guaranteed to appear in any user flow
3. **No Multi-App Awareness**: The `--platform` flag doesn't distinguish layout needs between user-facing apps and admin portals
4. **No Navigation Context**: Screens lack sidemenu/header/footer state information

## GoTribe Context

GoTribe has **3 distinct UI apps** that all need screen generation:
- **webapp** - User-facing web application (responsive layouts)
- **mobile** - User-facing mobile app (touch-optimized, safe areas)
- **backend** - Admin portal for platform administrators (desktop/dense layouts, data tables)

All 3 apps generate UI screens. The admin portal is NOT a backend API - it's an administrative interface.

## User Requirements

1. Enhanced `screens.json` with navigation context per section/app
2. 100% screen coverage - every screen must belong to at least one flow (auto-assign orphans)
3. Multi-app awareness - use appropriate layout skills per app type:
   - webapp → `webapp` skill (responsive)
   - mobile → `mobile` skill (touch-optimized)
   - backend → `desktop` skill (dense layouts for power users)
4. Generate `userflows.html` with box diagram wireframes for navigation validation
5. Embed navigation schema in flows.md output

---

## Critical Constraints (Backward Compatibility)

Analysis of downstream consumers revealed these **must-not-break** dependencies:

| Consumer | Required Fields | Format |
|----------|-----------------|--------|
| `screens.ts:69` | `screens` | Flat `string[]` array |
| `screens.ts:70` | `userflows` | `{id, name, screens: {id,name,file}[]}[]` |
| `stylesheet.ts:113-122` | `components` | Flat `string[]` array |
| `stylesheet.ts:137-165` | `icons` | Flat `string[]` array |
| `stylesheet.ts:121` | `screenComponents` | `Record<string, string[]>` |
| `mockups.ts:65-77` | `components` | Flat `string[]` (optional) |
| `flows.ts:47` | flows.md headers | `## Flow N: [Name]` (H2 format) |

**Solution**: Keep legacy fields, add new v2.0 fields alongside.

---

## Phase 1: Navigation Schema Types

**File**: `src/lib/navigation-schema.ts` (NEW)

```typescript
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

// App definition within a multi-app project
export interface AppDefinition {
  appId: string;
  appName: string;
  appType: AppType;
  briefFile: string;
  layoutSkill: 'webapp' | 'mobile' | 'desktop';  // which layout skill to use
  defaultNavigation?: NavigationState;
  sections: AppSection[];
}

// Section within an app (e.g., "auth", "tribe", "settings")
export interface AppSection {
  sectionId: string;
  sectionName: string;
  parentEntity?: string;  // e.g., "tribe" for tribe-documents
  navigationOverride?: Partial<NavigationState>;
  screens: string[];
}

// Enhanced screen definition with context
export interface EnhancedScreen {
  file: string;
  name: string;
  appId: string;
  sectionId: string;
  parentEntity?: string;
  navigationState: NavigationState;
  flowMembership: string[];  // flow IDs containing this screen
}

// Coverage tracking
export interface CoverageMetadata {
  totalScreens: number;
  screensInFlows: number;
  orphanedScreens: string[];
  autoAssignedScreens: Record<string, string>;  // screen -> flow
  coveragePercent: number;
}

// Enhanced screens.json v2.0 schema
export interface EnhancedScreensJson {
  // New v2.0 fields
  version: '2.0';
  apps?: AppDefinition[];
  enhancedScreens?: EnhancedScreen[];
  coverage?: CoverageMetadata;

  // Legacy fields (MUST keep for backward compat)
  screens: string[];
  userflows: LegacyUserflow[];
  components: string[];
  screenComponents: Record<string, string[]>;
  icons: string[];
  screenIcons: Record<string, string[]>;
}

// Legacy userflow format (keep for backward compat)
export interface LegacyUserflow {
  id: string;
  name: string;
  screens: { id: string; name: string; file: string }[];
}
```

**Utility functions**:
```typescript
export function isEnhancedSchema(data: any): boolean {
  return data.version === '2.0';
}

export function detectAppType(platform: string): AppType {
  // Simple heuristics based on platform name:
  // - "backend" or "admin" in name -> admin
  // - "mobile" in name -> mobile
  // - default -> webapp
  if (platform.includes('backend') || platform.includes('admin')) {
    return 'admin';
  }
  if (platform.includes('mobile')) {
    return 'mobile';
  }
  return 'webapp';
}

export function getLayoutSkill(appType: AppType): 'webapp' | 'mobile' | 'desktop' {
  switch (appType) {
    case 'admin': return 'desktop';   // dense layouts for power users
    case 'mobile': return 'mobile';   // touch-optimized
    default: return 'webapp';         // responsive
  }
}
```

---

## Phase 2: Update Platform Detection

**File**: `src/lib/platforms.ts`

Add app-type detection:

```typescript
import { AppType } from './navigation-schema.js';

// Detect app type from platform name
export function detectAppType(platform: string): AppType {
  if (platform.includes('backend') || platform.includes('admin')) {
    return 'admin';
  }
  if (platform.includes('mobile')) {
    return 'mobile';
  }
  return 'webapp';
}

// Map app type to layout skill
export function getLayoutSkillForApp(appType: AppType): SkillType {
  switch (appType) {
    case 'admin': return 'desktop';   // dense layouts, data tables
    case 'mobile': return 'mobile';   // touch-optimized, safe areas
    default: return 'webapp';         // responsive layouts
  }
}

// Enhanced platform resolution with app info
export interface ResolvedApp {
  platform: string;
  appType: AppType;
  layoutSkill: SkillType;
}

export function resolveAppInfo(platform: string): ResolvedApp {
  const appType = detectAppType(platform);
  const layoutSkill = getLayoutSkillForApp(appType);
  return { platform, appType, layoutSkill };
}
```

**Update `resolveSkill()` function** to use app type:

```typescript
// Before (line ~85):
export function resolveSkill(platform: string, skillOverride?: string): SkillType {
  if (skillOverride) return skillOverride as SkillType;
  // ... old logic
}

// After:
export function resolveSkill(platform: string, skillOverride?: string): SkillType {
  if (skillOverride) return skillOverride as SkillType;
  const appType = detectAppType(platform);
  return getLayoutSkillForApp(appType);
}
```

---

## Phase 3: Update analyze-flows.md Skill

**File**: `src/templates/skills/analysis/analyze-flows.md`

Add these requirements:

```markdown
## Screen Naming Convention

CRITICAL: Screens that belong to a parent entity MUST include the parent prefix:
- `tribe-documents.html` NOT `documents.html`
- `tribe-media.html` NOT `media.html`
- `event-calendar.html` NOT `calendar.html`
- `user-settings.html` NOT `settings.html`

This prevents screen disconnection from parent context.

## Coverage Requirement

CRITICAL: Every screen defined in the brief MUST appear in at least one flow.

After mapping all flows:
1. List all screens from the brief
2. Check each screen appears in at least one flow
3. If orphaned screens exist, create a "Miscellaneous" flow containing them

## Navigation Schema Section

At the END of your output, add a navigation schema in YAML:

\`\`\`yaml
# navigation-schema
apps:
  - appId: webapp
    appName: "Web Application"
    appType: frontend-web
    defaultNavigation:
      header: { variant: standard, actions: [search, notifications, profile] }
      footer: { variant: tab-bar, tabs: [home, discover, tribes, events, profile] }
    sections:
      - sectionId: auth
        sectionName: "Authentication"
        navigationOverride:
          header: { variant: minimal }
          footer: { variant: hidden }
        screens: [login, signup, forgot-password, verify-email]
      - sectionId: tribe
        sectionName: "Tribe Section"
        parentEntity: tribe
        navigationOverride:
          sidemenu: { visible: true, items: [wiki, documents, media, members, settings] }
        screens: [tribe-detail, tribe-wiki, tribe-documents, tribe-media, tribe-members]
\`\`\`

This schema enables downstream navigation validation.
```

---

## Phase 4: Update analyze-screens.md Skill

**File**: `src/templates/skills/analysis/analyze-screens.md`

Update output format:

```markdown
## Output Format (v2.0)

Your JSON output MUST include:

1. **Legacy fields** (required for backward compatibility):
   - `screens`: Flat array of filenames
   - `userflows`: Array of {id, name, screens}
   - `components`: Flat array of component names
   - `screenComponents`: Record<screenId, componentNames[]>
   - `icons`: Flat array of icon names
   - `screenIcons`: Record<screenId, iconNames[]>

2. **New v2.0 fields**:
   - `version`: "2.0"
   - `apps`: Array of app definitions with sections
   - `enhancedScreens`: Screens with navigation state and flow membership
   - `coverage`: Coverage metadata

## Coverage Validation

Before outputting, validate:
1. Count screens in `screens` array
2. Count unique screens across all `userflows`
3. Calculate coverage percentage
4. List orphaned screens (in screens but not in any flow)
5. Auto-assign orphans to "miscellaneous" flow

```json
{
  "version": "2.0",

  // Legacy (keep these exactly as before)
  "screens": ["login.html", "home.html", "tribe-detail.html", ...],
  "userflows": [...],
  "components": ["header", "bottom-nav", "card", ...],
  "screenComponents": {...},
  "icons": ["home", "search", ...],
  "screenIcons": {...},

  // New v2.0 fields
  "apps": [
    {
      "appId": "webapp",
      "appName": "Web Application",
      "appType": "webapp",
      "layoutSkill": "webapp",
      "defaultNavigation": {
        "header": { "variant": "standard", "actions": ["search", "notifications"] },
        "footer": { "variant": "tab-bar", "tabs": ["home", "discover", "tribes", "profile"] }
      },
      "sections": [
        {
          "sectionId": "auth",
          "navigationOverride": { "footer": { "variant": "hidden" } },
          "screens": ["login.html", "signup.html"]
        },
        {
          "sectionId": "tribe",
          "parentEntity": "tribe",
          "navigationOverride": {
            "sidemenu": { "visible": true, "items": ["wiki", "documents", "media", "members"] }
          },
          "screens": ["tribe-detail.html", "tribe-documents.html", "tribe-media.html"]
        }
      ]
    },
    {
      "appId": "mobile",
      "appName": "Mobile App",
      "appType": "mobile",
      "layoutSkill": "mobile",
      "defaultNavigation": {
        "header": { "variant": "standard", "actions": ["notifications"] },
        "footer": { "variant": "tab-bar", "tabs": ["home", "discover", "tribes", "profile"] }
      },
      "sections": [...]
    },
    {
      "appId": "backend",
      "appName": "Admin Portal",
      "appType": "admin",
      "layoutSkill": "desktop",
      "defaultNavigation": {
        "sidemenu": { "visible": true, "items": ["dashboard", "users", "tribes", "reports"] },
        "header": { "variant": "minimal", "actions": ["search", "admin-profile"] },
        "footer": { "variant": "hidden" }
      },
      "sections": [
        {
          "sectionId": "dashboard",
          "screens": ["admin-dashboard.html", "admin-metrics.html"]
        },
        {
          "sectionId": "user-management",
          "screens": ["admin-users.html", "admin-user-detail.html"]
        }
      ]
    }
  ],

  "enhancedScreens": [
    {
      "file": "tribe-documents.html",
      "name": "Tribe Documents",
      "appId": "webapp",
      "sectionId": "tribe",
      "parentEntity": "tribe",
      "flowMembership": ["tribe-management", "content-browsing"],
      "navigationState": {
        "sidemenu": { "visible": true, "activeSection": "documents" },
        "header": { "variant": "standard", "title": "Documents" },
        "footer": { "variant": "tab-bar", "activeTab": "tribes" }
      }
    }
  ],

  "coverage": {
    "totalScreens": 47,
    "screensInFlows": 47,
    "orphanedScreens": [],
    "autoAssignedScreens": {},
    "coveragePercent": 100
  }
}
```
```

---

## Phase 5: Update analyze.ts Command

**File**: `src/commands/analyze.ts`

Key changes:

```typescript
// 1. After flows.md is generated, extract navigation schema
const flowsOutput = await runWorkerSequential(flowsTask);
const navSchemaYaml = extractNavigationSchema(flowsOutput.output);

// Write navigation-schema.md
if (navSchemaYaml) {
  await writeFile(
    join(analysisDir, 'navigation-schema.md'),
    `# Navigation Schema\n\n\`\`\`yaml\n${navSchemaYaml}\n\`\`\``
  );
  console.log('  Generated navigation-schema.md');
}

// 2. After screens.json is generated, validate coverage
const screensJson = JSON.parse(screensOutput.output);

if (screensJson.coverage) {
  const { coveragePercent, orphanedScreens, autoAssignedScreens } = screensJson.coverage;

  console.log(`\nFlow Coverage: ${coveragePercent}%`);

  if (orphanedScreens.length > 0) {
    console.log(`  Orphaned screens: ${orphanedScreens.length}`);
    orphanedScreens.forEach(s => console.log(`    - ${s}`));
  }

  if (Object.keys(autoAssignedScreens).length > 0) {
    console.log(`  Auto-assigned to miscellaneous: ${Object.keys(autoAssignedScreens).length}`);
  }
}

// 3. Helper to extract nav schema from flows.md
function extractNavigationSchema(flowsMarkdown: string): string | null {
  const match = flowsMarkdown.match(/```yaml\s*\n#\s*navigation-schema\n([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}
```

---

## Phase 6: Enhanced Coverage Validation

**File**: `src/lib/verification.ts`

Add new functions:

```typescript
export interface FlowCoverageReport {
  totalScreens: number;
  screensInFlows: number;
  orphanedScreens: string[];
  coveragePercent: number;
}

export function validateFlowCoverage(screensJson: EnhancedScreensJson): FlowCoverageReport {
  const allScreens = new Set(screensJson.screens.map(s => s.replace('.html', '')));
  const screensInFlows = new Set<string>();

  for (const flow of screensJson.userflows) {
    for (const screen of flow.screens) {
      screensInFlows.add(screen.id);
    }
  }

  const orphaned = [...allScreens].filter(s => !screensInFlows.has(s));

  return {
    totalScreens: allScreens.size,
    screensInFlows: screensInFlows.size,
    orphanedScreens: orphaned,
    coveragePercent: allScreens.size > 0
      ? Math.round((screensInFlows.size / allScreens.size) * 100)
      : 100
  };
}

export function printFlowCoverageReport(report: FlowCoverageReport): void {
  const status = report.coveragePercent === 100 ? '✓' : '⚠';
  console.log(`\n${status} Flow Coverage: ${report.screensInFlows}/${report.totalScreens} (${report.coveragePercent}%)`);

  if (report.orphanedScreens.length > 0) {
    console.log('  Orphaned screens (not in any flow):');
    report.orphanedScreens.forEach(s => console.log(`    - ${s}`));
  }
}
```

---

## Phase 7: New userflows Command

**File**: `src/commands/userflows.ts` (NEW)

```typescript
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { loadSystemPrompt, loadSkill } from '../lib/agent.js';
import { runWorkerSequential } from '../lib/worker.js';
import { detectPlatforms, resolvePlatform, getPlatformOutputDir, getSharedAnalysisDir } from '../lib/platforms.js';

interface UserflowsOptions {
  platform?: string;
}

export async function userflows(options: UserflowsOptions = {}) {
  const projectDir = process.cwd();

  // Detect platforms
  const platforms = await detectPlatforms(projectDir);
  const isMultiPlatform = platforms.length > 0;

  // Load analysis data
  const analysisDir = isMultiPlatform
    ? getSharedAnalysisDir(projectDir)
    : join(projectDir, 'outputs', 'analysis');

  // Load screens.json (for all platforms if multi-platform)
  const allScreensData: Record<string, any> = {};

  if (isMultiPlatform) {
    for (const platform of platforms) {
      const platformAnalysisDir = getPlatformOutputDir(projectDir, 'analysis', platform);
      try {
        const content = await readFile(join(platformAnalysisDir, 'screens.json'), 'utf-8');
        allScreensData[platform] = JSON.parse(content);
      } catch {
        console.warn(`No screens.json for platform: ${platform}`);
      }
    }
  } else {
    try {
      const content = await readFile(join(analysisDir, 'screens.json'), 'utf-8');
      allScreensData['default'] = JSON.parse(content);
    } catch {
      console.error('screens.json not found. Run `agentflow analyze` first.');
      process.exit(1);
    }
  }

  // Load navigation schema if available
  let navSchema: string | null = null;
  try {
    navSchema = await readFile(join(analysisDir, 'navigation-schema.md'), 'utf-8');
  } catch {
    console.log('No navigation-schema.md found, using screens.json data');
  }

  // Load skill and system prompt
  const systemPrompt = await loadSystemPrompt(projectDir, 'ui-designer');
  const skill = await loadSkill(projectDir, 'design/design-userflows');

  // Create worker task
  const task = {
    id: 'userflows',
    systemPrompt: `${systemPrompt}\n\n## Skill\n\n${skill}`,
    userPrompt: `Generate a userflows.html diagram.

## Screen Data (per platform)
${JSON.stringify(allScreensData, null, 2)}

## Navigation Schema
${navSchema || 'Not available - infer from screens.json apps/sections'}

## Requirements
- Create app tabs for each platform: ${Object.keys(allScreensData).join(', ')}
- Create flow tabs for each userflow within each platform
- Show box diagrams with navigation zones (header/sidemenu/content/footer)
- Connect screens with arrows showing flow direction
- Hover on screen shows navigation state
`
  };

  console.log('Generating userflows diagram...');
  const result = await runWorkerSequential(task);

  // Write output
  const outputDir = join(projectDir, 'outputs', 'userflows');
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'userflows.html'), result.output);

  console.log(`
Userflows diagram generated!

Output: outputs/userflows/userflows.html

Open in browser to:
- Switch between app tabs (${Object.keys(allScreensData).join(', ')})
- View flow sequences with navigation zones
- Validate sidemenu/header/footer states
`);
}
```

**File**: `src/templates/skills/design/design-userflows.md` (NEW)

```markdown
# Design Userflows Diagram

Generate an interactive HTML page showing userflows with navigation zone diagrams.

## Output Requirements

OUTPUT ONLY RAW HTML. No explanations.

Start with `<!DOCTYPE html>`, end with `</html>`.

## Layout Structure

```
+------------------------------------------------------------------+
| [App Tabs: Webapp | Mobile | Backend]                            |
+------------------------------------------------------------------+
| [Flow Tabs: Onboarding | Discovery | Tribe Management | ...]     |
+------------------------------------------------------------------+
|                                                                  |
| +--------+     +--------+     +--------+     +--------+          |
| |[Header]| --> |[Header]| --> |[Header]| --> |[Header]|          |
| |--------|     |--------|     |--------|     |--------|          |
| |[Side?] |     |        |     |[Side?] |     |        |          |
| |Content |     |Content |     |Content |     |Content |          |
| |--------|     |--------|     |--------|     |--------|          |
| |[Footer]|     |[Footer]|     |[Footer]|     |[Footer]|          |
| +--------+     +--------+     +--------+     +--------+          |
|   Login         Signup       Profile Setup      Home             |
+------------------------------------------------------------------+
```

## Box Diagram Styling

Each screen box shows:
- **Header zone**: Light gray, show variant + active actions
- **Sidemenu zone**: Only if visible, show active section
- **Content zone**: White, show screen name + key components
- **Footer zone**: Light gray, show active tab highlighted

## Interactivity (JavaScript)

- Click app tab → show that app's flows
- Click flow tab → show that flow's screen sequence
- Hover screen → tooltip with full navigation state JSON
- Arrow connectors (SVG or CSS) between sequential screens

## Color Coding

- Active tab/section: Primary brand color
- Hidden zones: Dashed border, no fill
- Orphaned screens: Red border (coverage warning)

## Example Output Structure

```html
<!DOCTYPE html>
<html>
<head>
  <title>Userflows - [Project Name]</title>
  <style>
    /* Tabs, boxes, arrows, tooltips */
  </style>
</head>
<body>
  <div class="app-tabs">...</div>
  <div class="flow-tabs">...</div>
  <div class="flow-diagram">
    <div class="screen-box">
      <div class="header-zone">standard | search, notifications</div>
      <div class="content-zone">Login</div>
      <div class="footer-zone hidden">hidden</div>
    </div>
    <div class="arrow">→</div>
    ...
  </div>
  <script>/* Tab switching, tooltips */</script>
</body>
</html>
```
```

---

## Phase 8: Register Command

**File**: `src/index.ts`

```typescript
import { userflows } from './commands/userflows.js';

program
  .command('userflows')
  .description('Generate visual userflows diagram with navigation zones')
  .option('--platform <platform>', 'Filter to specific platform')
  .action((options) => userflows(options));
```

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/navigation-schema.ts` | CREATE | TypeScript interfaces for nav schema |
| `src/lib/platforms.ts` | MODIFY | Add `detectAppType()`, `resolveAppInfo()` |
| `src/lib/verification.ts` | MODIFY | Add `validateFlowCoverage()` |
| `src/commands/analyze.ts` | MODIFY | Extract nav schema, validate coverage |
| `src/commands/userflows.ts` | CREATE | New userflows command |
| `src/templates/skills/analysis/analyze-flows.md` | MODIFY | Add nav schema output, coverage req |
| `src/templates/skills/analysis/analyze-screens.md` | MODIFY | Add v2.0 schema fields |
| `src/templates/skills/design/design-userflows.md` | CREATE | Box diagram skill |
| `src/index.ts` | MODIFY | Register userflows command |

---

## Verification Checklist

After implementation, verify:

1. **Backward Compatibility**
   - [ ] Existing projects with v1.0 screens.json still work
   - [ ] `screens.ts` reads legacy `screens` array correctly
   - [ ] `stylesheet.ts` reads legacy `components`/`icons` arrays
   - [ ] `mockups.ts` works with legacy format
   - [ ] `flows.ts` parses H2 headers correctly

2. **New Features**
   - [ ] `analyze` generates `navigation-schema.md`
   - [ ] `screens.json` has `version: "2.0"` and new fields
   - [ ] Coverage report shows flow membership percentage
   - [ ] Orphaned screens are auto-assigned to "miscellaneous" flow
   - [ ] Screen names include parent entity prefix (tribe-documents, not documents)

3. **Userflows Command**
   - [ ] `agentflow userflows` generates `outputs/userflows/userflows.html`
   - [ ] HTML has app tabs for each platform
   - [ ] HTML has flow tabs for each userflow
   - [ ] Box diagrams show header/sidemenu/content/footer zones
   - [ ] Arrows connect sequential screens

4. **Multi-App Awareness**
   - [ ] `webapp` platform uses `webapp` skill (responsive layouts)
   - [ ] `mobile` platform uses `mobile` skill (touch-optimized)
   - [ ] `backend` platform uses `desktop` skill (dense admin layouts)
   - [ ] All 3 apps generate UI screens with appropriate styling

---

## Implementation Order

1. Create `src/lib/navigation-schema.ts` with types
2. Update `src/lib/platforms.ts` with app-type detection
3. Update `src/templates/skills/analysis/analyze-flows.md` with nav schema section
4. Update `src/templates/skills/analysis/analyze-screens.md` with v2.0 schema
5. Update `src/lib/verification.ts` with flow coverage functions
6. Update `src/commands/analyze.ts` to use new features
7. Create `src/templates/skills/design/design-userflows.md`
8. Create `src/commands/userflows.ts`
9. Update `src/index.ts` to register command
10. Build and test with gotribe project
