# BUG-026: Missing Icons and Logo Assets

## Problem
Icons and logo assets are not displaying in generated mockups, even though the HTML contains correct asset references.

## Finding
The HTML **is generating asset references correctly**:
```html
<img src="../../assets/logos/gotribe_transparent.png" alt="GoTribe Logo" class="logo">
<img src="../../assets/icons/search.svg" alt="Search">
```

However, the **relative paths are incorrect** for the actual directory structure:
- Mockups location: `outputs/mockups/webapp/style-0.html` (3 levels deep)
- Assets location: `assets/icons/`, `assets/logos/` (at project root)
- Path `../../assets/` resolves to `outputs/assets/` (wrong!)
- Should be `../../../assets/` to reach project root

## Root Cause
The mockup/stylesheet/screens agents are using `../../assets/` which assumes 2 directory levels, but the actual output paths are 3 levels deep:
```
outputs/mockups/webapp/style-0.html  →  ../../  →  outputs/  (wrong)
outputs/mockups/webapp/style-0.html  →  ../../../  →  project root (correct)
```

## Affected Files
| Output Type | Location | Correct Path |
|-------------|----------|--------------|
| Mockups | `outputs/mockups/{platform}/style-N.html` | `../../../assets/` |
| Stylesheet | `outputs/stylesheet/{platform}/stylesheet.html` | `../../../assets/` |
| Screens | `outputs/screens/{platform}/screen-N.html` | `../../../assets/` |

## Implementation Steps

### 1. Identify Where Paths Are Set
- [ ] Check mockup agent/skill for asset path instructions
- [ ] Check stylesheet agent/skill for asset path instructions
- [ ] Check screen agent/skill for asset path instructions
- [ ] Determine if path is hardcoded or computed dynamically

### 2. Fix Asset Paths
**Option A: Update agent prompts** (if paths are instructed in prompts)
- [ ] Update mockup skill to use `../../../assets/` instead of `../../assets/`
- [ ] Update stylesheet skill to use `../../../assets/`
- [ ] Update screen skill to use `../../../assets/`

**Option B: Update agent code** (if paths are computed in TypeScript)
- [ ] Find where asset paths are generated in `src/commands/`
- [ ] Update path computation to account for 3-level depth
- [ ] Consider making path depth configurable based on output location

### 3. Regenerate Outputs
- [ ] Run `agentflow mockups --platform=webapp` to test fix
- [ ] Verify icons and logo display in browser
- [ ] Run `agentflow mockups --platform=mobile`
- [ ] Verify mobile mockups also display correctly

## Testing

### Path Resolution Tests
- [ ] Open `outputs/mockups/webapp/style-0.html` in browser
- [ ] Verify logo displays (check Network tab for 404s)
- [ ] Verify icons display (home, search, settings, etc.)
- [ ] Repeat for all 5 styles
- [ ] Repeat for mobile platform

### Cross-Platform Tests
- [ ] Webapp mockups: icons and logo visible
- [ ] Mobile mockups: icons and logo visible
- [ ] Backend mockups (if generated): icons and logo visible

### Browser Console Check
- [ ] No 404 errors for asset files
- [ ] No broken image placeholders
- [ ] All img elements have valid src paths

## Quick Verification
Run this in project root to check actual path resolution:
```bash
# From mockup location, verify path resolves
cd outputs/mockups/webapp
ls ../../../assets/icons/
ls ../../../assets/logos/
```

## Rollback Plan
If fix causes other issues:
1. Revert agent/skill changes
2. Mockups will revert to `../../assets/` paths
3. Users can manually fix paths or serve files via local server
