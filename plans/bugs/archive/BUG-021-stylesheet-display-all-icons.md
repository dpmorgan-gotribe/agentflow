# BUG-021: Icon Management Across Styles and Stylesheet

## Problem
1. The stylesheet doesn't display all available icons
2. When user selects Style 1-4 (library icons like Lucide), there's no icon mapping
3. Icons needed per screen aren't captured in the analysis
4. No way to know which icons are required for the full app

## Root Cause
- Icons are only mentioned in Style 0's "User Icons" section in styles.md
- Screen/component analysis doesn't identify icons per screen
- Stylesheet command doesn't know what icons are needed or where to get them

## Proposed Solution

### 1. Add icons to screens.json during analysis
Capture required icons per screen alongside components:

```json
{
  "screens": [...],
  "userflows": [...],
  "components": [...],
  "screenComponents": {...},
  "icons": [
    "home", "search", "notifications", "account", "menu",
    "camping", "event", "chat", "settings", "filter",
    "add", "close", "arrow_back", "expand_content"
  ],
  "screenIcons": {
    "home-feed": ["home", "search", "notifications", "menu", "camping", "event"],
    "tribe-profile": ["arrow_back", "notifications", "chat", "camping"],
    "settings": ["settings", "account", "notifications", "close"]
  }
}
```

### 2. Map icons to sources based on style
- **Style 0**: User icons from `assets/icons/`
- **Styles 1-4**: Library icons (Lucide, Heroicons, etc.)

```json
{
  "iconSources": {
    "style-0": {
      "type": "user",
      "path": "../../assets/icons/",
      "format": "{name}.svg"
    },
    "style-1": {
      "type": "lucide",
      "cdn": "https://unpkg.com/lucide-static@latest/icons/",
      "format": "{name}.svg"
    },
    "style-2": {
      "type": "heroicons",
      "cdn": "https://unpkg.com/heroicons@2.0.18/24/outline/",
      "format": "{name}.svg"
    }
  }
}
```

### 3. Stylesheet uses correct icon source
Based on selected style, include appropriate icons in showcase.html.

### Icon Gallery Requirements
```html
<section class="icon-gallery">
  <h2>Icons</h2>

  <!-- Icon grid showing all icons -->
  <div class="icon-grid">
    <div class="icon-item">
      <img src="../../assets/icons/home.svg" alt="home">
      <span>home</span>
    </div>
    <div class="icon-item">
      <img src="../../assets/icons/search.svg" alt="search">
      <span>search</span>
    </div>
    <!-- ... all icons ... -->
  </div>

  <!-- Icon states -->
  <h3>Icon States</h3>
  <div class="icon-states">
    <div class="state-row light-bg">
      <span>Light background:</span>
      <img class="icon-default">
      <img class="icon-active">
      <img class="icon-disabled">
    </div>
    <div class="state-row dark-bg">
      <span>Dark background:</span>
      <img class="icon-inverted">
      <img class="icon-active">
    </div>
  </div>

  <!-- Icon sizes -->
  <h3>Icon Sizes</h3>
  <div class="icon-sizes">
    <img class="icon-sm"> 16px
    <img class="icon-md"> 24px
    <img class="icon-lg"> 32px
    <img class="icon-xl"> 48px
  </div>
</section>
```

## Implementation Steps

### Phase 1: Add icons to analyze-screens.md skill

1. [ ] **Update analyze-screens.md** to extract icons per screen:
   ```json
   {
     "screens": [...],
     "components": [...],
     "screenComponents": {...},
     "icons": ["home", "search", "notifications", ...],
     "screenIcons": {
       "home-feed": ["home", "search", "notifications"],
       ...
     }
   }
   ```

2. [ ] **Add icon identification guidelines** to skill:
   - Navigation icons (home, search, menu, back, close)
   - Action icons (add, edit, delete, share, save)
   - Status icons (notifications, chat, settings)
   - Content icons (camping/tribe, event, jobs, offerings)

### Phase 2: Update analyze.ts Phase 3

3. [ ] **Update screens worker prompt** to request icons:
   ```
   For each screen, also identify required icons:
   - Navigation icons in header/footer
   - Action icons on buttons
   - Status/indicator icons
   ```

4. [ ] **Pass user icon inventory** to help map names:
   ```
   Available user icons: home.svg, search.svg, camping.svg, ...
   Use these icon names when identifying icons for screens.
   ```

### Phase 3: Add icon source mapping to styles.md

5. [ ] **Update analyze-styles.md** to include icon source per style:
   ```markdown
   ### Icon Source
   - Type: user | lucide | heroicons | material
   - Path/CDN: [url or path]
   - Available icons: [list]
   ```

### Phase 4: Update stylesheet.ts

6. [ ] **Load icons from screens.json**:
   ```typescript
   const { icons, screenIcons } = screensData;
   ```

7. [ ] **Scan user icons directory**:
   ```typescript
   const userIcons = await readdir(join(projectDir, 'assets', 'icons'));
   ```

8. [ ] **Determine icon source based on style**:
   ```typescript
   const isUserStyle = styleNum === '0';
   const iconSource = isUserStyle
     ? { type: 'user', path: '../../assets/icons/' }
     : { type: 'lucide', cdn: 'https://unpkg.com/lucide-static@latest/icons/' };
   ```

9. [ ] **Include in stylesheet prompt**:
   ```
   ## Required Icons (${icons.length} total)
   ${icons.join(', ')}

   ## Icon Source
   Type: ${iconSource.type}
   Path: ${iconSource.path || iconSource.cdn}

   ## User Icons Available
   ${userIcons.join(', ')}

   Your stylesheet MUST include an Icons section showing:
   - All required icons in a grid with labels
   - Icon states (default, active, disabled)
   - Icon sizes (16px, 24px, 32px, 48px)
   - Icons on light and dark backgrounds
   ```

### Phase 5: Update design-stylesheet.md skill

10. [ ] **Add icon gallery requirements**:
    - Must display ALL icons from the icons list
    - Must use correct icon source (user path or CDN)
    - Must show states and sizes
    - Must work on light and dark backgrounds

### Phase 6: Icon CSS in showcase.html

11. [ ] **Required icon styles**:
    ```css
    .icon-gallery { }
    .icon-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 16px; }
    .icon-item { display: flex; flex-direction: column; align-items: center; padding: 16px; }
    .icon-item img { width: 24px; height: 24px; }
    .icon-item span { font-size: 12px; margin-top: 8px; color: var(--text-secondary); }

    /* Icon states */
    .icon-default { }
    .icon-active { filter: brightness(0) saturate(100%) invert(56%) sepia(41%) saturate(618%) hue-rotate(47deg); }
    .icon-inverted { filter: brightness(0) invert(1); }
    .icon-disabled { opacity: 0.4; }

    /* Icon sizes */
    .icon-sm { width: 16px; height: 16px; }
    .icon-md { width: 24px; height: 24px; }
    .icon-lg { width: 32px; height: 32px; }
    .icon-xl { width: 48px; height: 48px; }
    ```

## Updated screens.json Structure

```json
{
  "screens": ["home-feed.html", "tribe-profile.html", ...],
  "userflows": [...],
  "components": ["header", "bottom-nav", "card", ...],
  "screenComponents": {
    "home-feed": ["header", "bottom-nav", "card", "filter-pills"]
  },
  "icons": [
    "home", "search", "notifications", "account", "menu",
    "camping", "event", "chat", "settings", "filter",
    "add", "close", "arrow_back", "expand_content",
    "following", "donars", "offerings", "shops", "jobs", "kitchen"
  ],
  "screenIcons": {
    "home-feed": ["home", "search", "notifications", "account", "menu"],
    "tribe-profile": ["arrow_back", "notifications", "chat", "camping"],
    "settings": ["settings", "notifications", "close"]
  }
}
```

## Testing

- [ ] Run `agentflow analyze 5` - verify screens.json includes icons and screenIcons
- [ ] Verify icons array has all required icons for the app
- [ ] Run `agentflow mockups`
- [ ] Run `agentflow stylesheet --style=0` - verify user icons displayed
- [ ] Run `agentflow stylesheet --style=1` - verify library icons used
- [ ] Verify Icons section shows all icons with states and sizes

## Files to Modify

1. `src/templates/skills/analysis/analyze-screens.md` - Add icon extraction
2. `src/commands/analyze.ts` - Pass user icon inventory to Phase 3
3. `src/commands/stylesheet.ts` - Load icons, determine source, pass to prompt
4. `src/templates/skills/design/design-stylesheet.md` - Add icon gallery requirements
5. `projects/*/skills/analysis/analyze-screens.md` - Copy updated skill
6. `projects/*/skills/design/design-stylesheet.md` - Copy updated skill
