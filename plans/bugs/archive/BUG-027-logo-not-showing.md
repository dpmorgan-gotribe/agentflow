# BUG-027: Logo Image Not Displaying in UI

## Problem
The application logo is not rendering in the user interface. The image element exists in the DOM but the actual logo image fails to load, likely appearing as a broken image icon or empty space.

## Context
- **Location**: UI component that displays the application logo (header, splash screen, or navigation)
- **Affected Components**: Logo component/element using path `../../../assets/icons/menu.svg`
- **User Impact**: Branding visibility is compromised; users see broken image instead of GoTribe logo
- **Current Implementation**: Element reference uses relative path pattern `../../../assets/icons/menu.svg`
- **Expected Behavior**: GoTribe logo (`gotribe_transparent.png`) should display correctly

## Root Cause Analysis
The bug stems from an incorrect asset reference. The element is attempting to load `menu.svg` (the hamburger menu icon) when it should be loading the GoTribe logo. Additionally, the path uses triple parent directory traversal (`../../../`) which may not resolve correctly depending on the component's location in the file structure.

**Root Issues**:
1. Wrong asset file referenced (`menu.svg` instead of logo file)
2. Relative path depth may not match actual component location
3. File type mismatch - logo is PNG (`gotribe_transparent.png`) but reference points to SVG

## Implementation Steps

1. [ ] Locate the component rendering the logo (search codebase for `assets/icons/menu.svg` references in logo/header context)
2. [ ] Verify the correct logo asset exists at `assets/logos/gotribe_transparent.png`
3. [ ] Update the image source path from `../../../assets/icons/menu.svg` to the correct logo path
4. [ ] Determine the component's location in the directory structure to calculate correct relative path depth
5. [ ] Replace relative path with one of the following (in order of preference):
   - Absolute import using project alias (e.g., `@/assets/logos/gotribe_transparent.png`)
   - Framework-specific asset import (e.g., `require()` or `import` statement)
   - Correct relative path based on component location
6. [ ] If using React Native/Expo, ensure asset is properly registered in `app.json` or similar
7. [ ] Verify image element has appropriate width/height or styling to render at intended size
8. [ ] Clear build cache and rebuild application

## Testing

- [ ] **Visual verification**: Logo displays correctly in all instances (header, splash, etc.)
- [ ] **Multiple platforms**: Test on both web and mobile if multi-platform
- [ ] **Different screen sizes**: Verify logo renders appropriately on mobile, tablet, desktop
- [ ] **Asset loading**: Check browser/metro bundler network tab to confirm asset loads successfully
- [ ] **Build verification**: Test in both development and production builds
- [ ] **Edge cases**: 
  - Logo displays on initial app load
  - Logo persists after navigation between screens
  - Logo renders correctly in offline mode (if applicable)
- [ ] **Regression check**: Verify menu icon (`menu.svg`) still works correctly in its proper location
- [ ] **Performance**: Confirm logo loads without significant delay

## Rollback Plan

**Immediate Rollback** (if fix causes issues):
1. Revert the file containing the logo reference to previous commit
2. Run `git revert <commit-hash>` if already deployed
3. Clear build cache and rebuild
4. Redeploy if necessary

**Safe Revert Steps**:
- Keep the incorrect reference path documented in comments for comparison
- Tag the working commit before deploying fix
- Monitor error logs for 24 hours after deployment
- If using feature flags, wrap logo change to enable quick toggle-off

**Fallback Options**:
- Temporarily use a base64-encoded inline image as logo source
- Serve logo from public/static directory with absolute URL
- Use a placeholder image until proper fix is verified
