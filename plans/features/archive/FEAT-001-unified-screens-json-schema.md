# FEAT-001: Unified screens.json Schema v3.0

## Feature Description

Consolidate all design system information into a single, minimal `screens.json` file that serves as the single source of truth. The schema is **app-centric** - each app contains its screens, and each screen contains everything needed for generation.

**Core principle:** If data can be derived from screens, don't store it separately.

## Unified Schema Design (v3.0)

```json
{
  "version": "3.0",
  "generatedAt": "2026-01-11T10:30:00Z",
  "projectName": "GoTribe",

  "apps": [
    {
      "appId": "gotribe-webapp",
      "appName": "GoTribe Webapp",
      "appType": "webapp",
      "layoutSkill": "webapp",

      "defaultNavigation": {
        "header": { "variant": "standard", "logo": true, "actions": ["search", "notifications"] },
        "footer": { "variant": "tab-bar", "tabs": ["home", "discover", "create", "tribes", "profile"] },
        "sidemenu": { "visible": false }
      },

      "screens": [
        {
          "id": "auth-splash",
          "file": "auth-splash.html",
          "name": "Splash Screen",
          "description": "Logo, tagline, language selector, Get Started and Sign In buttons",
          "section": "auth",
          "navigation": {
            "header": { "variant": "minimal", "logo": true },
            "footer": { "variant": "hidden" }
          },
          "components": ["logo", "button-primary", "button-secondary", "language-selector"],
          "icons": ["language", "arrow_forward"],
          "flows": ["onboarding"]
        },
        {
          "id": "auth-signin",
          "file": "auth-signin.html",
          "name": "Sign In",
          "description": "Email/password login, social sign-in, forgot password link",
          "section": "auth",
          "navigation": {
            "header": { "variant": "minimal", "logo": true },
            "footer": { "variant": "hidden" }
          },
          "components": ["logo", "form-input", "button-primary", "button-secondary", "divider", "social-login"],
          "icons": ["arrow_back", "visibility", "visibility_off"],
          "flows": ["onboarding", "returning-user"]
        },
        {
          "id": "discovery-home-feed",
          "file": "discovery-home-feed.html",
          "name": "Home Feed",
          "description": "Aggregated content from followed tribes, users, events",
          "section": "discovery",
          "components": ["header", "bottom-nav", "post-card", "story-circle", "filter-pills", "fab"],
          "icons": ["menu", "search", "notifications", "home", "camping", "add", "chat", "account"],
          "flows": ["daily-use", "content-discovery"]
        },
        {
          "id": "tribe-feed",
          "file": "tribe-feed.html",
          "name": "Tribe Feed",
          "description": "Social posts from tribe members and announcements",
          "section": "tribe",
          "parentEntity": "tribe",
          "navigation": {
            "header": { "variant": "standard", "title": "{{tribe.name}}" },
            "sidemenu": { "visible": true, "activeItem": "feed" }
          },
          "components": ["header", "side-menu", "bottom-nav", "post-card", "announcement-card", "avatar", "fab"],
          "icons": ["menu", "notifications", "search", "add", "home", "camping", "chat", "account"],
          "flows": ["tribe-engagement", "content-creation"]
        }
      ]
    },
    {
      "appId": "gotribe-admin",
      "appName": "GoTribe Admin Portal",
      "appType": "admin",
      "layoutSkill": "desktop",

      "defaultNavigation": {
        "header": { "variant": "admin", "logo": true, "actions": ["search", "notifications", "user-menu"] },
        "footer": { "variant": "hidden" },
        "sidemenu": { "visible": true, "items": ["dashboard", "users", "tribes", "moderation", "finance"] }
      },

      "screens": [
        {
          "id": "admin-platform-overview",
          "file": "admin-platform-overview.html",
          "name": "Platform Overview",
          "description": "Key metrics, alerts, quick actions for platform health",
          "section": "dashboard",
          "components": ["header", "side-menu", "stat-card", "chart", "alert-card", "data-table"],
          "icons": ["menu", "notifications", "search", "dashboard", "trending_up", "warning"],
          "flows": ["admin-daily-review"]
        },
        {
          "id": "admin-users-list",
          "file": "admin-users-list.html",
          "name": "Users List",
          "description": "Searchable, filterable list of all platform users",
          "section": "users",
          "components": ["header", "side-menu", "search-bar", "filter-pills", "data-table", "pagination", "bulk-actions"],
          "icons": ["menu", "search", "filter", "more_vert", "edit", "block"],
          "flows": ["user-management", "moderation"]
        }
      ]
    }
  ]
}
```

## What's Derived (Not Stored)

These are computed at runtime from the screens data:

```typescript
// All unique components across all screens
function getAllComponents(data: UnifiedScreensJson): string[] {
  const components = new Set<string>();
  for (const app of data.apps) {
    for (const screen of app.screens) {
      screen.components.forEach(c => components.add(c));
    }
  }
  return [...components];
}

// All unique icons across all screens
function getAllIcons(data: UnifiedScreensJson): string[] {
  const icons = new Set<string>();
  for (const app of data.apps) {
    for (const screen of app.screens) {
      screen.icons.forEach(i => icons.add(i));
    }
  }
  return [...icons];
}

// All unique flows across all screens
function getAllFlows(data: UnifiedScreensJson): string[] {
  const flows = new Set<string>();
  for (const app of data.apps) {
    for (const screen of app.screens) {
      screen.flows.forEach(f => flows.add(f));
    }
  }
  return [...flows];
}

// Screens in a specific flow
function getScreensInFlow(data: UnifiedScreensJson, flowId: string): Screen[] {
  const screens: Screen[] = [];
  for (const app of data.apps) {
    for (const screen of app.screens) {
      if (screen.flows.includes(flowId)) {
        screens.push(screen);
      }
    }
  }
  return screens;
}

// Coverage stats
function getCoverage(data: UnifiedScreensJson): Coverage {
  let total = 0;
  let inFlows = 0;
  const orphaned: string[] = [];

  for (const app of data.apps) {
    for (const screen of app.screens) {
      total++;
      if (screen.flows.length > 0) {
        inFlows++;
      } else {
        orphaned.push(screen.id);
      }
    }
  }

  return { total, inFlows, orphaned, percent: Math.round((inFlows / total) * 100) };
}
```

## Schema Design Rationale

### 1. App-Centric Structure
```
apps[]
  └── screens[]  (fully self-contained)
```

Each app is a complete unit containing all its screens. No cross-referencing needed.

### 2. Screen Contains Everything
Each screen object has:
- **Identity**: `id`, `file`, `name`, `description`
- **Context**: `section`, `parentEntity` (optional)
- **Navigation**: Override from app default (only if different)
- **Requirements**: `components[]`, `icons[]`
- **Membership**: `flows[]`

### 3. Derive, Don't Duplicate
- Component library? Derive from `screen.components`
- Icon library? Derive from `screen.icons`
- Userflows? Derive from `screen.flows`
- Coverage? Compute from screens

### 4. Navigation Inheritance
- App defines `defaultNavigation`
- Screen only specifies `navigation` if it differs from default
- Merge at runtime: `{ ...app.defaultNavigation, ...screen.navigation }`

## Requirements Analysis

### Upstream (analyze command)

**Current State:**
- `analyze.ts` invokes `analyze-screens` skill
- Skill generates JSON with partial fields
- Large projects (400+ screens) cause truncation

**Required Changes:**
1. Extract app structure from brief JSON upfront
2. Generate screens per-app in batches
3. Merge into final unified JSON
4. Validate completeness

### Downstream (mockups, stylesheet, screens)

**Current State:**
- `mockups.ts` reads `screens.json` for components
- `stylesheet.ts` reads `screens.json` for components/icons
- `screens.ts` reads `screens.json` for screen list
- `userflows.ts` reads `screens.json` for navigation context

**Required Changes:**
1. Update TypeScript interfaces in `navigation-schema.ts`
2. Add helper functions to derive data from screens
3. Update each command to use new accessors

## Implementation Steps

### Phase 1: Schema & Types

**File: `src/lib/navigation-schema.ts`**

```typescript
// Core screen type - contains everything
interface Screen {
  id: string;
  file: string;
  name: string;
  description: string;
  section: string;
  parentEntity?: string;
  navigation?: Partial<NavigationState>;  // Only overrides
  components: string[];
  icons: string[];
  flows: string[];
}

// App type - contains its screens
interface App {
  appId: string;
  appName: string;
  appType: 'webapp' | 'mobile' | 'admin';
  layoutSkill: 'webapp' | 'mobile' | 'desktop';
  defaultNavigation: NavigationState;
  screens: Screen[];
}

// Root schema - just version, metadata, and apps
interface UnifiedScreensJson {
  version: '3.0';
  generatedAt: string;
  projectName: string;
  apps: App[];
}

// Accessor functions (derive everything from screens)
export function getAllComponents(data: UnifiedScreensJson): string[];
export function getAllIcons(data: UnifiedScreensJson): string[];
export function getAllFlows(data: UnifiedScreensJson): string[];
export function getScreensForApp(data: UnifiedScreensJson, appId: string): Screen[];
export function getScreensForSection(data: UnifiedScreensJson, section: string): Screen[];
export function getScreensInFlow(data: UnifiedScreensJson, flowId: string): Screen[];
export function getScreenById(data: UnifiedScreensJson, screenId: string): Screen | undefined;
export function getCoverage(data: UnifiedScreensJson): { total: number; inFlows: number; orphaned: string[]; percent: number };
```

### Phase 2: Update Skill

**File: `skills/analysis/analyze-screens.md`**

Update output format to v3.0:
```markdown
## Output Format (v3.0)

Output a single JSON object with this structure:

{
  "version": "3.0",
  "generatedAt": "<ISO timestamp>",
  "projectName": "<from brief>",
  "apps": [
    {
      "appId": "<app-id>",
      "appName": "<App Name>",
      "appType": "webapp|mobile|admin",
      "layoutSkill": "webapp|mobile|desktop",
      "defaultNavigation": { ... },
      "screens": [
        {
          "id": "<screen-id>",
          "file": "<screen-id>.html",
          "name": "<Screen Name>",
          "description": "<what the screen shows>",
          "section": "<section-id>",
          "parentEntity": "<entity-type>" (optional),
          "navigation": { ... } (only if different from app default),
          "components": ["component1", "component2", ...],
          "icons": ["icon1", "icon2", ...],
          "flows": ["flow1", "flow2", ...]
        }
      ]
    }
  ]
}

CRITICAL: Every screen MUST have:
- components array (minimum 2 components)
- icons array (minimum 1 icon)
- flows array (minimum 1 flow, use "miscellaneous" if truly standalone)
```

### Phase 3: Update Analyze Command

**File: `src/commands/analyze.ts`**

```typescript
// 1. Extract app structure from brief
const briefSchema = extractBriefSchema(combinedBrief);
const apps = briefSchema.apps; // [{appId, screens: [...]}]

// 2. Generate screens per app (or in batches for large apps)
const BATCH_SIZE = 100;
const result: UnifiedScreensJson = {
  version: '3.0',
  generatedAt: new Date().toISOString(),
  projectName: briefSchema.projectName,
  apps: []
};

for (const app of apps) {
  const appScreens = app.screens;

  if (appScreens.length <= BATCH_SIZE) {
    // Small app - generate all at once
    const appResult = await generateAppScreens(app, appScreens);
    result.apps.push(appResult);
  } else {
    // Large app - batch generation
    const batches = chunk(appScreens, BATCH_SIZE);
    const appData = { ...app, screens: [] };

    for (const batch of batches) {
      const batchScreens = await generateAppScreens(app, batch);
      appData.screens.push(...batchScreens.screens);
    }

    result.apps.push(appData);
  }
}

// 3. Validate completeness
const validation = validateV3Schema(result);
if (!validation.valid) {
  console.warn('Schema validation warnings:', validation.warnings);
}

// 4. Write output
await writeFile(join(outputDir, 'screens.json'), JSON.stringify(result, null, 2));
```

### Phase 4: Update Downstream Commands

**File: `src/commands/mockups.ts`**
```typescript
import { getAllComponents } from '../lib/navigation-schema.js';

// Before: const components = screensData.components || [];
// After:
const components = getAllComponents(screensData);
```

**File: `src/commands/stylesheet.ts`**
```typescript
import { getAllComponents, getAllIcons } from '../lib/navigation-schema.js';

// Before: const components = screensData.components || [];
// After:
const components = getAllComponents(screensData);
const icons = getAllIcons(screensData);
```

**File: `src/commands/screens.ts`**
```typescript
import { getScreensForApp } from '../lib/navigation-schema.js';

// Before: const screenList = screensData.screens || [];
// After:
const app = screensData.apps.find(a => a.appId === targetAppId) || screensData.apps[0];
const screenList = app.screens.map(s => s.file);
```

**File: `src/commands/userflows.ts`**
```typescript
import { getScreenById } from '../lib/navigation-schema.js';

// Navigation is now embedded in each screen
const screen = getScreenById(screensData, screenId);
const navigation = {
  ...app.defaultNavigation,
  ...screen.navigation  // Overrides
};
```

### Phase 5: Validation

**File: `src/lib/verification.ts`**

```typescript
export function validateV3Schema(data: UnifiedScreensJson): ValidationResult {
  const warnings: string[] = [];

  for (const app of data.apps) {
    for (const screen of app.screens) {
      if (!screen.components?.length) {
        warnings.push(`${screen.id}: missing components`);
      }
      if (!screen.icons?.length) {
        warnings.push(`${screen.id}: missing icons`);
      }
      if (!screen.flows?.length) {
        warnings.push(`${screen.id}: not in any flow`);
      }
    }
  }

  return {
    valid: warnings.length === 0,
    warnings
  };
}
```

## Testing Checklist

- [ ] Schema validation correctly identifies v3.0 format
- [ ] Accessor functions derive correct data from screens
- [ ] `agentflow analyze` generates valid v3.0 schema
- [ ] `agentflow mockups` reads components via accessor
- [ ] `agentflow stylesheet` reads components/icons via accessor
- [ ] `agentflow screens` generates screens from app.screens
- [ ] Small project (< 100 screens) - single generation works
- [ ] Large project (400+ screens) - batched generation works
- [ ] Multi-app project - both apps have complete screens

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/navigation-schema.ts` | New interfaces + accessor functions |
| `src/commands/analyze.ts` | Per-app generation, batching, validation |
| `src/commands/mockups.ts` | Use `getAllComponents()` |
| `src/commands/stylesheet.ts` | Use `getAllComponents()`, `getAllIcons()` |
| `src/commands/screens.ts` | Use `app.screens` |
| `src/commands/userflows.ts` | Use embedded navigation |
| `src/lib/verification.ts` | V3 validation |
| `skills/analysis/analyze-screens.md` | V3 output format |

## Success Criteria

1. `screens.json` contains only: `version`, `generatedAt`, `projectName`, `apps[]`
2. Each app contains only: `appId`, `appName`, `appType`, `layoutSkill`, `defaultNavigation`, `screens[]`
3. Each screen contains: `id`, `file`, `name`, `description`, `section`, `navigation` (optional), `components`, `icons`, `flows`
4. Everything else is derived at runtime
5. Works reliably for 400+ screens via batching
