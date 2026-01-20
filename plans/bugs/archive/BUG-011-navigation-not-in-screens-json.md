# BUG-011: Navigation Items Not Captured in screens.json

## Problem Description

When generating screens for the webapp, the side menu and footer navigation items outlined in the brief are not being transferred to the final screens. The `navigation-schema.md` analysis output correctly captures detailed navigation per section:

```yaml
# From navigation-schema.md
sections:
  - sectionId: tribe-detail
    navigationOverride:
      footer:
        variant: tab-bar
        tabs: [feed, profile, messages]
      sidemenu:
        visible: true
        items: [welcome, events, groups, jobs, wiki, members, offerings, garden]
```

However, the `webapp-screens.json` output only stores:
- `components` array
- `icons` array
- `flows` array
- `navigation` with just `header`/`footer`/`sidemenu` variants (no items)

The user expects to:
1. See which footer tabs and sidemenu items each screen should display
2. Be able to amend the JSON manually if interpretation is wrong
3. Have the `screens` command generate correct navigation from the JSON

## Root Cause Analysis

### 1. Schema Definition Gap
The `NavigationState` interface in `navigation-schema.ts` has incomplete sidemenu/footer definitions:

```typescript
// Current schema (lines 9-25)
export interface NavigationState {
  sidemenu?: {
    visible: boolean;
    activeSection?: string;
    items?: string[];        // Has items but...
  };
  footer?: {
    variant: 'tab-bar' | 'minimal' | 'hidden';
    activeTab?: string;
    tabs?: string[];         // Has tabs but...
  };
}
```

The schema has the fields but they're not being populated by the analyzer.

### 2. Analyze-Screens Skill Doesn't Request Navigation Details
The `analyze-screens.md` skill shows a minimal navigation example:

```json
"navigation": {
  "header": { "variant": "minimal" },
  "footer": { "variant": "hidden" }
}
```

It doesn't demonstrate capturing:
- `footer.tabs` - which tabs should appear
- `sidemenu.items` - which menu items should appear
- `sidemenu.activeSection` - which section is highlighted

### 3. Screens Command Builds Navigation Without Items
The `buildNavigationContext()` function in `screens.ts` (line 274) attempts to use navigation but the data doesn't contain the actual items.

## Solution Design

### Phase 1: Extend analyze-screens.md Skill

Update the skill to explicitly request navigation details:

```json
{
  "navigation": {
    "header": {
      "variant": "standard",
      "actions": ["search", "notifications"]
    },
    "footer": {
      "variant": "tab-bar",
      "tabs": ["feed", "profile", "messages"],
      "activeTab": "feed"
    },
    "sidemenu": {
      "visible": true,
      "items": ["welcome", "events", "groups", "jobs", "wiki", "members"],
      "activeSection": "events"
    }
  }
}
```

### Phase 2: Update NavigationState Types (Already Adequate)

The TypeScript types already support these fields - no changes needed to `navigation-schema.ts`.

### Phase 3: Update screens.ts Navigation Builder

Enhance `buildNavigationContext()` to output specific items for the screen designer:

```typescript
function buildNavigationContext(screenName: string): string {
  const screenData = screenDataMap.get(screenName);
  // ...

  return `## Navigation Context
### Footer
- Variant: ${footer.variant}
- Tabs: ${footer.tabs?.join(', ')}
- Active Tab: ${footer.activeTab || 'first tab'}

### Sidemenu
- Visible: ${sidemenu.visible}
- Items: ${sidemenu.items?.join(', ')}
- Active Section: ${sidemenu.activeSection || 'none'}
`;
}
```

## Implementation Steps

### Step 1: Update analyze-screens.md Skill

**File:** `src/templates/skills/analysis/analyze-screens.md`

1. Add Navigation Items section explaining what to capture:
   - Footer tabs with which tab is active per screen
   - Sidemenu items with which section is active per screen

2. Update the example output format to show full navigation:
   ```json
   "navigation": {
     "footer": {
       "variant": "tab-bar",
       "tabs": ["feed", "profile", "messages"],
       "activeTab": "feed"
     },
     "sidemenu": {
       "visible": true,
       "items": ["welcome", "events", "groups", "jobs", "wiki"],
       "activeSection": "welcome"
     }
   }
   ```

3. Add section-based navigation lookup instructions:
   - Reference navigation-schema.md for section defaults
   - Inherit section navigation for screens in that section
   - Allow per-screen overrides when different from section default

### Step 2: Update Navigation Extraction in analyze.ts

**File:** `src/commands/analyze.ts`

1. After extracting screens, pass `navigation-schema.md` path to the agent
2. Instruct agent to look up section navigation and apply to each screen

### Step 3: Enhance screens.ts Navigation Context

**File:** `src/commands/screens.ts`

1. Update `buildNavigationContext()` to format navigation items clearly:
   ```
   ## Footer Navigation
   Show tab bar with: [Home, Discover, Tribes, Profile]
   Active tab: Tribes (highlight this one)

   ## Sidemenu
   Visible via hamburger icon
   Items: [Welcome, Events, Groups, Jobs, Wiki, Members, Offerings, Garden]
   Active section: Events (highlight this one)
   ```

2. Update helper functions to generate actionable instructions

### Step 4: Test on gotribe_tree_ Project

1. Re-run `agentflow analyze --useAssets`
2. Verify `webapp-screens.json` contains navigation items per screen
3. Re-run `agentflow screens`
4. Verify generated HTML has correct footer tabs and sidemenu items

## Testing Checklist

- [ ] `webapp-screens.json` includes `footer.tabs` array for screens with tab-bar
- [ ] `webapp-screens.json` includes `footer.activeTab` for tab-bar screens
- [ ] `webapp-screens.json` includes `sidemenu.items` array for screens with sidemenu
- [ ] `webapp-screens.json` includes `sidemenu.activeSection` for sidemenu screens
- [ ] Generated screens show correct footer tabs (not default)
- [ ] Generated screens show correct sidemenu items (not default)
- [ ] Manually editing screens.json navigation changes generated output

## Rollback Plan

1. Keep existing analyze-screens.md as backup
2. Navigation fields are optional (won't break existing projects)
3. Screens command falls back to defaults if navigation items missing

## Files Changed

1. `src/templates/skills/analysis/analyze-screens.md` - Add navigation items to output format
2. `src/commands/analyze.ts` - Pass navigation-schema.md to agent
3. `src/commands/screens.ts` - Enhance buildNavigationContext() function
4. `src/lib/navigation-schema.ts` - No changes needed (types already support items)

## Priority

High - This affects the usability of generated screens and user ability to correct navigation.
