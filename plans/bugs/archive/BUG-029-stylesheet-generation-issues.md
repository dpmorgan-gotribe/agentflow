# BUG-029: Stylesheet Generation Issues

**Created:** 2026-01-10
**Status:** Investigation Complete - Awaiting Approval
**Priority:** High
**Affected Components:** `src/commands/stylesheet.ts`, `src/lib/platforms.ts`, stylesheet skill templates, generated CSS output

---

## Problem Description

Multiple issues have been identified across all three generated stylesheets (backend, webapp, mobile):

### Issue 1: Platform Fallback to Backend When Desktop Specified
- **Symptom:** Running `/stylesheet --platform=desktop` generates backend stylesheet instead
- **Root Cause:** In `platforms.ts:158-159`, when a specified platform is not found, it falls back to the first available platform with only a warning. The `detectPlatforms()` function only detects platforms based on `brief-*.md` files, not the `--platform` argument.
- **Impact:** Users cannot generate stylesheets for platforms without corresponding brief files

### Issue 2: Backend Stylesheet Missing Headers and Footers in Output
- **Symptom:** Backend stylesheet doesn't show proper header/footer component demos
- **Root Cause:** The backend stylesheet (`outputs/stylesheet/backend/showcase.html`) does show a header component demo at line 1348-1365, but:
  1. The header is inside a demo section, not as a fixed navigation element
  2. There is no footer navigation component (only showcases components, no actual footer)
- **Impact:** Incomplete design system reference for backend developers

### Issue 3: Backend Logo Has "gotribe" Text Next to It
- **Symptom:** Logo displays with text "gotribe" next to it
- **Root Cause:** This is intentional design from lines 1352-1355: `<img src="../../../assets/logos/gotribe_transparent.png" alt="GoTribe Logo" class="logo">` followed by `<span class="logo-text">gotribe</span>`
- **Impact:** May not match user's desired design (should be logo only or configurable)

### Issue 4: Webapp Stylesheet Has No Component Styling
- **Symptom:** Webapp stylesheet components appear unstyled
- **Root Cause:** The webapp stylesheet (`outputs/stylesheet/webapp/showcase.html`) is incomplete:
  1. It ends abruptly at line 1373 with just `</footer>` tag
  2. CSS definitions are truncated - only covers through line 248 with navigation styles
  3. Missing styles for: buttons, forms, cards, lists, badges, tags, modals, toasts, empty states, loading states, grids, carousels, image galleries, video players, calendars, charts
  4. The HTML structure references CSS classes that are never defined
- **Impact:** Webapp stylesheet is unusable for development

### Issue 5: Mobile Stylesheet Icons Out of Place
- **Symptom:** Icons appear misaligned/out of place
- **Root Cause:** Analysis of mobile stylesheet shows:
  1. Icon grid uses `grid-template-columns: repeat(4, 1fr)` (line 1116) which may overflow on narrow viewports
  2. Icon wrapper has fixed 48px dimensions (lines 1129-1130) but grid doesn't account for spacing
  3. Icon states section uses flex layout without proper gap handling (line 1152)
- **Impact:** Poor visual presentation of icon gallery

### Issue 6: Mobile Stylesheet Missing Images and Blank Video
- **Symptom:** No images display, video player is blank
- **Root Cause:**
  1. Image gallery section (lines 1774-1783) uses inline `background: linear-gradient(...)` instead of actual images
  2. Video player (line 1786) is just an empty `<div class="video-player"></div>` with no content
  3. Map component (line 1790) is also just an empty `<div class="map"></div>`
- **Impact:** Developers cannot see how media components should look

### Issue 7: Mobile Stylesheet Badges with Red Circles Covering Text
- **Symptom:** Badge notification indicators overlap with text
- **Root Cause:** The `.badge::after` pseudo-element (lines 145-156) positions the red dot at `top: 8px; right: 8px;` but the badge itself is re-defined at line 572-582 with conflicting styles. The header badge (lines 1237-1242) uses the notification badge class but the positioning is relative to the header icon, causing overlap issues.
- **Impact:** Notification badges are illegible

### Issue 8: No Working Side Menus
- **Symptom:** Side menus don't function
- **Root Cause:**
  1. Mobile stylesheet side menu (lines 937-981) has `transform: translateX(-100%)` which hides it off-screen
  2. The `.open` class is defined (line 950-952) but there's no JavaScript to toggle it
  3. The demo at lines 1859-1877 shows a static "preview" that is not the actual side menu component
- **Impact:** Side menu functionality cannot be demonstrated or tested

---

## Root Cause Analysis

### Primary Issues

1. **Incomplete CSS Generation:** The AI agent is generating truncated stylesheets, particularly for webapp which is missing most component styles.

2. **Platform Detection Logic:** The `detectPlatforms()` function in `platforms.ts` only looks for `brief-*.md` files, not a general platform parameter. When "desktop" is specified but no `brief-desktop.md` exists, it falls back silently.

3. **Demo Components vs Real Components:** Stylesheets show static "previews" of components instead of functional examples with proper interactions.

4. **Inconsistent Badge Styling:** The `.badge` class is defined twice in mobile stylesheet with conflicting purposes (notification indicator vs content badge).

5. **Missing Placeholder Content:** Media components (images, videos, maps) use gradients or empty divs instead of actual placeholder content.

6. **No JavaScript Interactions:** Interactive components (side menu, modals, dropdowns) are purely CSS with no toggle functionality.

---

## Proposed Solutions

### Solution 1: Fix Platform Validation (platforms.ts)

```typescript
// In resolvePlatform(), add explicit platform validation
export async function resolvePlatform(
  projectDir: string,
  specifiedPlatform?: string
): Promise<string | null> {
  const platforms = await detectPlatforms(projectDir);

  // NEW: Check if specifiedPlatform is a valid skill type even without brief
  const validSkillTypes = ['webapp', 'mobile', 'desktop'];

  if (specifiedPlatform) {
    if (platforms.includes(specifiedPlatform)) {
      return specifiedPlatform;
    }

    // NEW: Allow valid skill types even without brief file
    if (validSkillTypes.includes(specifiedPlatform)) {
      console.log(`Note: No brief-${specifiedPlatform}.md found, using ${specifiedPlatform} skill.`);
      return specifiedPlatform;
    }

    console.warn(`Warning: Platform "${specifiedPlatform}" not found. Available: ${platforms.join(', ')}`);
    return platforms[0];
  }

  return platforms.length > 0 ? platforms[0] : null;
}
```

### Solution 2: Fix Stylesheet Skill Templates

Update `design-stylesheet-webapp.md`, `design-stylesheet-mobile.md`, and `design-stylesheet-desktop.md` to:

1. **Add explicit checklist:** Require agent to verify ALL components have styles before outputting
2. **Add minimum line count validation:** Ensure stylesheet is at least 2000 lines
3. **Require placeholder images:** Use placeholder.com or similar for media demos
4. **Separate badge classes:** Use `.notification-badge` for notification dots, `.badge` for content badges
5. **Include basic JS toggles:** Add simple JavaScript for interactive components

### Solution 3: Add CSS Validation (validation.ts)

```typescript
export function hasRequiredComponents(html: string): boolean {
  const requiredClasses = [
    '.button-primary', '.button-secondary',
    '.form-input', '.form-select', '.form-textarea',
    '.card', '.list-item', '.avatar', '.badge', '.tag',
    '.modal', '.toast', '.empty-state', '.loading',
    '.header', '.bottom-nav', '.side-menu',
    '.filter-pill', '.tab-bar', '.breadcrumb'
  ];

  return requiredClasses.every(cls => html.includes(cls));
}
```

### Solution 4: Fix Badge Naming Conflict

In skill templates, specify:
```css
/* Notification indicator (used in header) */
.notification-dot {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 8px;
  height: 8px;
  background-color: var(--error);
  border-radius: 50%;
}

/* Content badge (used in cards, lists) */
.badge {
  display: inline-flex;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}
```

### Solution 5: Add Interactive Component Templates

Include basic JavaScript in skill templates:
```html
<script>
// Side menu toggle
document.querySelector('.menu-icon')?.addEventListener('click', () => {
  document.querySelector('.side-menu')?.classList.toggle('open');
});

// Modal toggle
document.querySelectorAll('[data-modal-trigger]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelector(btn.dataset.modalTrigger)?.classList.add('open');
  });
});
</script>
```

### Solution 6: Add Media Placeholders

Update skill templates to require:
```html
<!-- Image gallery with placeholders -->
<div class="image-gallery">
  <img src="https://via.placeholder.com/300x300?text=Photo+1" alt="Gallery 1">
  <img src="https://via.placeholder.com/300x300?text=Photo+2" alt="Gallery 2">
</div>

<!-- Video player with poster -->
<div class="video-player">
  <video controls poster="https://via.placeholder.com/640x360?text=Video+Poster">
    <source src="#" type="video/mp4">
    Your browser does not support video.
  </video>
</div>
```

---

## Implementation Steps

### Phase 1: Platform Handling Fix
1. [ ] Update `src/lib/platforms.ts` to allow valid skill types without brief files
2. [ ] Add clear error message when platform not found
3. [ ] Test with `--platform=desktop` without `brief-desktop.md`

### Phase 2: Skill Template Updates
4. [ ] Update `design-stylesheet-webapp.md` with complete component checklist
5. [ ] Update `design-stylesheet-mobile.md` with badge naming fix
6. [ ] Update `design-stylesheet-desktop.md` with toolbar/sidebar requirements
7. [ ] Add media placeholder requirements to all templates
8. [ ] Add basic JavaScript toggle requirements

### Phase 3: Validation Enhancements
9. [ ] Add `hasRequiredComponents()` to `src/lib/validation.ts`
10. [ ] Update `stylesheet.ts` to validate component coverage
11. [ ] Add minimum output length validation

### Phase 4: Regenerate Stylesheets
12. [ ] Regenerate mobile stylesheet with fixes
13. [ ] Regenerate webapp stylesheet with fixes
14. [ ] Regenerate backend stylesheet with fixes
15. [ ] Verify all components styled and functional

---

## Testing Checklist

- [ ] `agentflow stylesheet --platform=desktop` generates desktop-style output
- [ ] `agentflow stylesheet --platform=webapp` generates complete webapp CSS
- [ ] `agentflow stylesheet --platform=mobile` generates properly positioned icons
- [ ] All stylesheets have working header demos
- [ ] All stylesheets have working footer demos
- [ ] Badge notifications don't overlap text
- [ ] Side menus toggle on click
- [ ] Image galleries show placeholder images
- [ ] Video players show poster images
- [ ] All buttons have hover/active states
- [ ] All forms have focus states
- [ ] Icon gallery shows all required icons in all states/sizes

---

## Rollback Plan

If fixes cause regressions:
1. Revert `platforms.ts` changes
2. Restore original skill templates from git
3. Keep existing generated stylesheets as backup in `outputs/stylesheet/{platform}/showcase.html.bak`

---

## Files to Modify

1. `src/lib/platforms.ts` - Platform resolution logic
2. `src/lib/validation.ts` - Component validation
3. `src/commands/stylesheet.ts` - Validation integration
4. `skills/design/design-stylesheet-webapp.md` - Skill template
5. `skills/design/design-stylesheet-mobile.md` - Skill template
6. `skills/design/design-stylesheet-desktop.md` - Skill template
