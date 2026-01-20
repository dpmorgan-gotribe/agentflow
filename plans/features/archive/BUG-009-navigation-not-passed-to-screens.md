# BUG-009: Navigation Data Not Passed to Screen Generation

## Problem Description

The `webapp-screens.json` contains rich navigation specifications for each screen (header variant, footer type, sidemenu items), but this data is NOT being passed to the LLM agent when generating individual screens. As a result:

1. **Screens don't reflect their navigation context**: A screen that should have a wizard footer with Back/Next buttons gets a generic bottom nav instead
2. **Sidemenu items ignored**: The JSON specifies sidemenu items like "camping", "event", "following", "jobs", etc., but these aren't rendered in screens
3. **No interactive hamburger menu**: The sidemenu should be triggered by the hamburger menu icon, but screens don't include this interactive element

### Current Behavior

In `screens.ts` line 229:
```typescript
userPrompt: `Create the full design for screen: ${screenName}${platform ? ` (${platform} platform)` : ''}\n\nUse the stylesheet:\n${stylesheetContent}`
```

The LLM only receives:
- Screen name (e.g., "tribes-find")
- Platform (e.g., "webapp")
- Stylesheet CSS

### Expected Behavior

The LLM should receive the full screen specification from `webapp-screens.json`:
```json
{
  "id": "tribe-feed",
  "name": "Tribe Feed",
  "description": "Shows posts from tribe members...",
  "navigation": {
    "header": { "variant": "breadcrumb", "breadcrumbs": ["Tribes", "Tribe Details"] },
    "footer": { "variant": "tab-bar", "tabs": ["home", "profile", "chat"] },
    "sidemenu": { "visible": true, "items": ["welcome", "events", "groups", "jobs", "wiki", "members", "offerings", "garden"] }
  },
  "components": [...],
  "icons": [...]
}
```

## Root Cause Analysis

1. **screens.ts doesn't read full screen data**: While it loads `webapp-screens.json` to get screen names (line 84), it only extracts the file names and discards all other data including navigation specs.

2. **No navigation context in user prompt**: The userPrompt template (line 229) doesn't include navigation specifications for the screen being generated.

3. **Skill files have generic navigation**: The `design-screen-mobile.md` skill has a generic bottom-nav example but no instruction to use the provided navigation data.

## Implementation Plan

### Phase 1: Pass Navigation Data to Screen Generator

**File: `src/commands/screens.ts`**

1. Store full screen data when loading `webapp-screens.json`:
```typescript
interface ScreenData {
  id: string;
  file: string;
  name: string;
  description: string;
  section: string;
  navigation: NavigationConfig;
  components: string[];
  icons: string[];
  flows: string[];
}

let screenDataMap: Map<string, ScreenData> = new Map();

// When loading screens.json
if (screensData.version === '3.0' && screensData.app) {
  for (const screen of screensData.app.screens) {
    screenDataMap.set(screen.id, screen);
  }
  // Also store defaultNavigation
  const defaultNav = screensData.app.defaultNavigation;
}
```

2. Modify worker task creation to include navigation:
```typescript
const workerTasks = screensToGenerate.map((screenName, i) => {
  const screenData = screenDataMap.get(screenName);
  const nav = screenData?.navigation || defaultNavigation;

  return {
    id: `screen-${String(screenIndices[i] + 1).padStart(2, '0')}`,
    systemPrompt: `${systemPrompt}\n\n## Skill\n\n${skill}`,
    userPrompt: `Create the full design for screen: ${screenName}

## Screen Specification
${JSON.stringify(screenData, null, 2)}

## Navigation Context
Header: ${JSON.stringify(nav.header)}
Footer: ${JSON.stringify(nav.footer)}
Sidemenu: ${JSON.stringify(nav.sidemenu)}

## Default Navigation (when screen doesn't override)
${JSON.stringify(defaultNavigation, null, 2)}

Use the stylesheet:
${stylesheetContent}`
  };
});
```

### Phase 2: Update Skill Files with Navigation Instructions

**File: `src/templates/skills/design/design-screen-mobile.md`**

Add section:
```markdown
## Navigation Rendering

You will receive navigation specifications. Render them as follows:

### Header Variants
- `standard`: Logo + action icons
- `minimal`: Just logo, no icons
- `breadcrumb`: Back arrow + breadcrumb path

### Footer Variants
- `hidden`: No footer
- `tab-bar`: Bottom navigation with tabs
- `wizard-buttons`: Back/Next buttons for multi-step flows
- `payment-button`: Single action button (Pay, Confirm)

### Sidemenu (Hamburger Menu)
When sidemenu.items is provided, implement:
1. Hamburger icon in header (already present)
2. Slide-out drawer (hidden by default)
3. Drawer contains icons/labels from sidemenu.items

Example sidemenu drawer:
```html
<div class="sidemenu-overlay" onclick="closeSidemenu()"></div>
<nav class="sidemenu">
  <div class="sidemenu-item active">
    <img src="../../../assets/icons/camping.svg" alt="">
    <span>Tribes</span>
  </div>
  <!-- More items -->
</nav>
```

```css
.sidemenu-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 998;
  display: none;
}

.sidemenu {
  position: fixed;
  top: 0;
  left: -280px;
  width: 280px;
  height: 100%;
  background: var(--header-footer);
  z-index: 999;
  transition: left 0.3s;
  padding-top: 60px;
}

.sidemenu.open {
  left: 0;
}

.sidemenu-overlay.open {
  display: block;
}
```
```

### Phase 3: Interactive Sidemenu JavaScript

Add to skill file:
```javascript
function toggleSidemenu() {
  document.querySelector('.sidemenu').classList.toggle('open');
  document.querySelector('.sidemenu-overlay').classList.toggle('open');
}

function closeSidemenu() {
  document.querySelector('.sidemenu').classList.remove('open');
  document.querySelector('.sidemenu-overlay').classList.remove('open');
}
```

## Files to Modify

1. **`src/commands/screens.ts`**
   - Store full screen data from JSON
   - Pass navigation specs in user prompt

2. **`src/templates/skills/design/design-screen-mobile.md`**
   - Add navigation rendering instructions
   - Add sidemenu HTML/CSS patterns
   - Add JavaScript for interactivity

3. **`src/templates/skills/design/design-screen-webapp.md`**
   - Same updates for webapp skill

4. **`src/templates/skills/design/design-screen-desktop.md`**
   - Desktop-specific navigation (always-visible sidebar)

## Testing Checklist

- [ ] Regenerate a wizard screen (e.g., `tribe-create-type`) - should have Back/Next footer
- [ ] Regenerate a tribe-context screen (e.g., `tribe-feed`) - should have tab-bar footer and sidemenu
- [ ] Regenerate an auth screen (e.g., `auth-splash`) - should have minimal header, no footer
- [ ] Verify hamburger menu opens sidemenu drawer
- [ ] Verify sidemenu contains correct items from JSON
- [ ] Verify sidemenu items match icons from assets/icons/

## Rollback Plan

1. Revert changes to `screens.ts`
2. Revert skill file changes
3. Navigation falls back to LLM defaults (current behavior)

## Priority

**High** - This is a core feature gap affecting the quality of generated screens.

## Estimated Scope

- screens.ts changes: ~50 lines
- Skill file updates: ~100 lines per skill
- Testing: Regenerate 5-10 screens to validate
