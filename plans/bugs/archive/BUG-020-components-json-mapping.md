# BUG-020: Stylesheet Lacks Comprehensive Components - Add components.json

## Problem
The stylesheet generator doesn't have visibility into what components each screen needs. For complex apps like GoTribe with 94 screens across 17 userflows, the generated stylesheet may miss critical components because:

1. The analyst extracts screens/userflows but doesn't explicitly map components per screen
2. The stylesheet generator works from styles.md and components.md (generic lists)
3. No direct link between "screen X needs components A, B, C"

## Proposed Solution
During screen extraction (Phase 3), also extract component requirements per screen and output a `components.json` file that maps screens to their required components.

### Output Structure
```json
{
  "components": [
    "header",
    "bottom-nav",
    "card",
    "button-primary",
    "button-secondary",
    "form-input",
    "form-select",
    "avatar",
    "badge",
    "progress-bar",
    "modal",
    "tab-bar",
    "list-item",
    "empty-state",
    "toast",
    "dropdown",
    "checkbox",
    "radio",
    "toggle",
    "date-picker",
    "search-bar",
    "filter-pills",
    "stat-card",
    "story-circle"
  ],
  "screens": [
    {
      "id": "splash-welcome",
      "file": "splash-welcome.html",
      "components": ["header", "button-primary", "logo"]
    },
    {
      "id": "interest-selection",
      "file": "interest-selection.html",
      "components": ["header", "bottom-nav", "checkbox", "button-primary", "progress-bar"]
    },
    {
      "id": "tribe-profile-modal",
      "file": "tribe-profile-modal.html",
      "components": ["modal", "avatar", "badge", "button-primary", "button-secondary", "tab-bar", "stat-card"]
    }
  ],
  "componentDetails": {
    "header": {
      "description": "Fixed top navigation with logo, menu, and action icons",
      "variants": ["default", "transparent", "tribe-context"],
      "usedIn": ["splash-welcome", "interest-selection", "home-feed"]
    },
    "card": {
      "description": "Content container with image, title, meta, and actions",
      "variants": ["event-card", "tribe-card", "offering-card", "job-card"],
      "usedIn": ["home-feed", "upcoming-events-list", "offerings-directory"]
    }
  }
}
```

## Benefits
1. **Complete component coverage** - stylesheet knows exactly what's needed
2. **Screen-component traceability** - can verify each screen has its components
3. **Variant awareness** - knows when a component needs multiple variants
4. **Priority ordering** - components used on many screens are more critical

## Implementation Steps

### Phase 1: Remove components.md from Phase 2

1. [ ] **Remove components worker from analyze.ts Phase 2**
   - Remove `{ id: 'components', skill: 'analysis/analyze-components' }` from tasks array
   - Remove components.md from output summary
   - Delete or archive `analyze-components.md` skill

### Phase 2: Update analyze-screens.md skill

2. [ ] **Expand analyze-screens.md** to extract components per screen
   - For each screen, identify UI components needed
   - Build flat deduplicated component list
   - Track which screens use which components
   - Identify component variants

3. [ ] **Update output format** to include components:
   ```json
   {
     "screens": ["splash.html", ...],
     "userflows": [...],
     "components": ["header", "card", "button-primary", ...],
     "screenComponents": {
       "splash-welcome": ["header", "button-primary", "logo"],
       "tribe-profile-modal": ["modal", "avatar", "badge", "tab-bar"]
     }
   }
   ```

### Phase 3: Update analyze.ts Phase 3

4. [ ] **Rename Phase 3** from "Screen Extraction" to "Screen & Component Mapping"

5. [ ] **Update screens worker prompt** to request both screens and components:
   ```
   Extract all screens AND their required components from the flows analysis.
   For each screen, list the UI components it will need.
   ```

6. [ ] **Update output summary** - remove components.md, confirm screens.json has components

### Phase 4: Update stylesheet command

7. [ ] **Update stylesheet.ts** to use screens.json for components:
   ```typescript
   const screensJson = await readFile(
     join(projectDir, 'outputs', 'analysis', 'screens.json'),
     'utf-8'
   );
   const { components, screenComponents } = JSON.parse(screensJson);
   ```

8. [ ] **Include in stylesheet prompt**:
   ```
   ## Required Components
   Your stylesheet MUST include styles for ALL these components:
   ${components.join(', ')}

   ## Screen-Component Mapping
   ${JSON.stringify(screenComponents, null, 2)}
   ```

### Phase 5: Cleanup

9. [ ] **Remove analyze-components.md** from:
   - `src/templates/skills/analysis/analyze-components.md`
   - `projects/*/skills/analysis/analyze-components.md`

10. [ ] **Update mockups.ts** if it references components.md

## Testing

- [ ] Run `agentflow analyze 5` - verify NO components.md is created
- [ ] Verify screens.json now includes components array and screenComponents mapping
- [ ] Run `agentflow stylesheet --style=0` - verify all components are styled
- [ ] Verify stylesheet has more comprehensive component coverage

## Files to Modify

1. `src/commands/analyze.ts` - Remove components worker, update Phase 3
2. `src/templates/skills/analysis/analyze-screens.md` - Add component extraction
3. `src/commands/stylesheet.ts` - Use screens.json for components
4. `src/commands/mockups.ts` - Remove components.md reference if present
5. `src/templates/skills/analysis/analyze-components.md` - DELETE
6. `projects/*/skills/analysis/analyze-components.md` - DELETE
