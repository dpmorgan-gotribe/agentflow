# BUG-017: Style-0 Wrong Colors and Too-Strict Wireframe Content

## Problem

Style-0 mockup has two issues:
1. **Wrong colors**: Using wireframe grayscale colors instead of Style 0 palette
2. **Too-strict content**: Copying placeholder text from incomplete wireframes

## Architectural Analysis

### Current Flow
```
analyze (analyst) ──► styles.md (Style 0-4 definitions)
                          │
mockups (ui-designer) ────┴──► [style-0 also reads wireframes again]
                                      │
                               style-0.html (confused - two sources for visuals)
```

### The Core Issue

**Style-0 reads wireframes twice** - once during analysis, once during mockups. This causes confusion:
- Analyst extracts Style 0 colors from brief (green palette)
- UI-designer sees wireframe images (gray/dark colors)
- UI-designer gets confused about which colors to use

### Better Architecture

Move ALL wireframe visual extraction to the analyst. Mockups should ONLY read analysis outputs, never raw wireframes.

```
analyze (analyst) ──► reads wireframes ──► styles.md includes:
    │                                        - Style 0 colors (from brief)
    │                                        - Layout patterns (from wireframes)
    │                                        - Component structure (from wireframes)
    │                                        - Navigation patterns (from wireframes)
    │
mockups (ui-designer) ──► reads ONLY styles.md ──► style-0.html
                          (no wireframe access)     (clear single source)
```

### Reasoning

1. **Single source of truth**: All wireframe information flows through analysis outputs
2. **Clear separation**: Analyst extracts, Designer executes
3. **No confusion**: Designer doesn't see conflicting visual info
4. **Consistent with other styles**: Styles 1-4 don't read wireframes, style-0 shouldn't either

### What Needs to Change

**In `analyze` command:**
- Analyst already reads wireframes (BUG-015 fix)
- BUT: Need to ensure `styles.md` Style 0 section includes:
  - Layout patterns extracted from wireframes
  - Navigation structure (bottom tabs, header icons)
  - Component placement guidance
  - Clear note: "wireframe colors are placeholders, use palette below"

**In `mockups` command:**
- REMOVE `allowRead` and `addDirs` from style-0 worker
- Style-0 should work exactly like styles 1-4: read analysis outputs only
- All layout info should come from `styles.md`, not re-reading wireframes

### Asset Handling (Logo & Icons)

**Logo (ALL styles):**
- User's logo from `assets/logos/` must be used in ALL mockups (0-4)
- Already handled by `logoSection` in mockups.ts
- Verify this is passed to all style prompts

**Icons (Style-0 only):**
- User's icons from `assets/icons/` should be used in Style 0
- Styles 1-4 use library icons (Lucide, Heroicons, etc.)
- Need to pass icon inventory to Style 0 via `styles.md` or `assets.md`
- Style 0 section should list available user icons and their intended use

## Implementation Steps

### Phase 1: Enhance Analyst Output

1. [ ] Update `skills/analysis/analyze-styles.md` to include wireframe layout extraction for Style 0:
   - Navigation patterns observed
   - Screen layouts identified
   - Component placement notes
   - Explicit: "Colors in wireframes are placeholders - define palette from brief"
   - List of user icons from `assets/icons/` and their recommended usage

2. [ ] Update `src/commands/analyze.ts` styles worker prompt to:
   - Emphasize layout extraction from wireframes
   - Include user icon inventory in Style 0 section
   - Note that logo path should be referenced

### Phase 2: Simplify Mockups

3. [ ] Remove `allowRead: isStyle0` from mockups.ts - style-0 no longer reads wireframes
4. [ ] Remove `addDirs: isStyle0 ? [assetsDir] : []` from mockups.ts
5. [ ] Update style-0 prompt to:
   - Use layout info from styles.md only
   - Reference user icons from assets/icons/ (paths passed in prompt)
   - Include user logo (already in logoSection, verify it works)
6. [ ] Verify logoSection is included for ALL styles (not just style-0)
7. [ ] Add icon paths to style-0 prompt (e.g., `../../assets/icons/home.svg`)

### Phase 3: Test

8. [ ] Run `agentflow analyze 5` - verify styles.md Style 0 includes layout + icon info
9. [ ] Run `agentflow mockups` - verify:
   - style-0 uses correct colors (green, not gray)
   - style-0 uses user icons from assets/icons/
   - ALL styles (0-4) include user logo
   - No placeholder text from wireframes

## Code Changes

### `src/commands/mockups.ts`

Remove wireframe reading for style-0:
```typescript
// BEFORE
workerTasks.push({
  id: `style-${i}`,
  allowRead: isStyle0,  // REMOVE
  addDirs: isStyle0 ? [assetsDir] : [],  // REMOVE
  userPrompt: isStyle0 ? style0Prompt : otherStylePrompt  // SIMPLIFY
});

// AFTER
workerTasks.push({
  id: `style-${i}`,
  // No allowRead, no addDirs - all styles work the same
  userPrompt: stylePrompt  // Same prompt structure for all styles
});
```

### `skills/analysis/analyze-styles.md`

Add wireframe layout extraction for Style 0:
```markdown
## Style 0: User's Vision

For Style 0, extract from wireframes:
- Navigation structure (describe tabs, menus, header layout)
- Screen layouts (describe component placement)
- Content hierarchy (describe groupings)

Note: Wireframe colors are grayscale placeholders.
Define actual colors from the project brief's brand guidelines.

### Layout Patterns (from wireframes)
[Analyst fills this in after reading wireframes]

### Color Palette (from brief)
[Analyst defines based on brief, NOT wireframes]
```

## Expected Result

After fix:
- Analyst reads wireframes → extracts layout patterns → writes to styles.md
- Mockups reads styles.md only → applies Style 0 with correct colors + layout
- No duplication, no confusion, clean architecture

## Testing Checklist

- [ ] `styles.md` Style 0 section includes layout patterns from wireframes
- [ ] `styles.md` Style 0 section includes user icon inventory
- [ ] `styles.md` Style 0 colors come from brief (green), not wireframes (gray)
- [ ] `style-0.html` uses green header (from Style 0 palette)
- [ ] `style-0.html` has correct navigation structure (from styles.md layout notes)
- [ ] `style-0.html` uses user icons (`../../assets/icons/*.svg`)
- [ ] `style-0.html` has no placeholder text ("Test as:", etc.)
- [ ] ALL styles (0-4) include user logo (`../../assets/logos/*`)
- [ ] Styles 1-4 use library icons (Lucide, etc.), not user icons
- [ ] Styles 1-4 still work correctly
