# FEAT-001: Platform-Specific Design Skills

## Goal
Enable layout-appropriate design generation by splitting design skills into layout variants (webapp, mobile, desktop), while maintaining design consistency from a single mockup source. Any platform brief can use any layout skill.

## Context

**Current behavior:**
- `--platform` flag already exists - refers to which brief/app we're building (webapp, mobile, backend, etc.)
- Single mockup design informs all platforms
- Design skills don't account for different screen sizes/interaction patterns

**Proposed behavior:**
- Add `--skill` flag to select layout type: `webapp`, `mobile`, or `desktop`
- Skills handle screen size differences and interaction patterns
- Any platform can use any skill (e.g., backend admin using mobile layout)

## Key Concepts

| Flag | Purpose | Values |
|------|---------|--------|
| `--platform` | Which brief/app to build | webapp, mobile, backend, etc. (from `brief-*.md`) |
| `--skill` | Which layout pattern to use | webapp, mobile, desktop |

**Examples:**
```bash
# Default: platform matches skill
agentflow stylesheet --platform=webapp              # Uses webapp skill
agentflow stylesheet --platform=mobile              # Uses mobile skill

# Cross-platform: backend admin with mobile layout
agentflow stylesheet --platform=backend --skill=mobile

# Desktop app for webapp brief
agentflow screens --platform=webapp --skill=desktop
```

## Skills to Create

| Skill | Screen Size | Key Patterns |
|-------|-------------|--------------|
| `design-stylesheet-webapp.md` | Responsive (mobile-first) | Hover states, breakpoints, CSS Grid |
| `design-stylesheet-mobile.md` | 320-428px | Touch targets (44px), safe areas, gestures |
| `design-stylesheet-desktop.md` | 1024px+ | Dense layouts, keyboard nav, multi-pane |
| `design-screen-webapp.md` | Responsive | Semantic HTML, accessibility, progressive enhancement |
| `design-screen-mobile.md` | Fixed mobile | Touch-optimized, bottom nav, swipe patterns |
| `design-screen-desktop.md` | Fixed desktop | Sidebars, toolbars, keyboard shortcuts |

**Note:** No backend-specific skills. Backend platforms use webapp/mobile/desktop skills for their admin UI.

## Files to Change

### Commands (Modify)

| File | Changes |
|------|---------|
| `src/commands/stylesheet.ts` | Add `--skill` option, resolve skill based on platform or override |
| `src/commands/screens.ts` | Add `--skill` option, resolve skill based on platform or override |

### Skills (Create)

| File | Description |
|------|-------------|
| `src/templates/skills/design/design-stylesheet-webapp.md` | Responsive web layouts |
| `src/templates/skills/design/design-stylesheet-mobile.md` | Mobile-native patterns |
| `src/templates/skills/design/design-stylesheet-desktop.md` | Desktop app patterns |
| `src/templates/skills/design/design-screen-webapp.md` | Responsive HTML screens |
| `src/templates/skills/design/design-screen-mobile.md` | Mobile-optimized screens |
| `src/templates/skills/design/design-screen-desktop.md` | Desktop app screens |

### Skills (Deprecate)

| File | Changes |
|------|---------|
| `src/templates/skills/design/design-stylesheet.md` | Keep as webapp alias, add deprecation notice |
| `src/templates/skills/design/design-screen.md` | Keep as webapp alias, add deprecation notice |

### Lib (Modify)

| File | Changes |
|------|---------|
| `src/lib/platforms.ts` | Add `resolveSkill(platform, skillOverride)` function |

## Implementation Steps

### Phase 1: Skill Resolution Logic
1. [ ] Update `src/lib/platforms.ts`
   - Add `SkillType` type: `'webapp' | 'mobile' | 'desktop'`
   - Add `resolveSkill(platform: string, skillOverride?: string): SkillType`
   - Default mapping: webapp→webapp, mobile→mobile, backend→webapp, desktop→desktop

2. [ ] Update `src/commands/stylesheet.ts`
   - Add `--skill` option (optional)
   - Call `resolveSkill()` to determine which skill to load
   - Load `design/design-stylesheet-{skill}` instead of `design/design-stylesheet`

3. [ ] Update `src/commands/screens.ts`
   - Add `--skill` option (optional)
   - Call `resolveSkill()` to determine which skill to load
   - Load `design/design-screen-{skill}` instead of `design/design-screen`

### Phase 2: Create Stylesheet Skills
4. [ ] Create `design-stylesheet-webapp.md`
   - Responsive breakpoints (mobile-first: 320px, 768px, 1024px, 1440px)
   - Hover states, focus indicators, transitions
   - CSS variables for colors, spacing, typography
   - Flexbox/Grid patterns

5. [ ] Create `design-stylesheet-mobile.md`
   - Fixed viewport (375px reference)
   - Touch targets minimum 44x44px
   - Safe area insets (notch, home indicator)
   - Bottom navigation patterns
   - Swipe gestures, pull-to-refresh
   - No hover states (touch-only)

6. [ ] Create `design-stylesheet-desktop.md`
   - Fixed viewport (1440px reference)
   - Dense information display
   - Hover states, tooltips
   - Keyboard navigation patterns
   - Multi-column layouts
   - Resizable panels

### Phase 3: Create Screen Skills
7. [ ] Create `design-screen-webapp.md`
   - Semantic HTML5
   - Responsive images
   - Accessibility (ARIA, focus management)
   - Progressive enhancement

8. [ ] Create `design-screen-mobile.md`
   - Single-column layouts
   - Bottom tab navigation
   - Card-based content
   - Touch-friendly spacing
   - Sticky headers

9. [ ] Create `design-screen-desktop.md`
   - Sidebar navigation
   - Toolbar patterns
   - Data tables
   - Modal dialogs
   - Keyboard shortcuts hints

### Phase 4: Backward Compatibility
10. [ ] Update `design-stylesheet.md`
    - Add header: "DEPRECATED: Use design-stylesheet-webapp.md"
    - Keep content as-is for existing projects

11. [ ] Update `design-screen.md`
    - Add header: "DEPRECATED: Use design-screen-webapp.md"
    - Keep content as-is for existing projects

### Phase 5: Documentation
12. [ ] Update project `CLAUDE.md` template
    - Document `--skill` flag
    - Add examples of cross-platform usage

## Testing

### Command Tests
- [ ] `agentflow stylesheet --platform=webapp` uses webapp skill
- [ ] `agentflow stylesheet --platform=mobile` uses mobile skill
- [ ] `agentflow stylesheet --platform=backend` defaults to webapp skill
- [ ] `agentflow stylesheet --platform=backend --skill=mobile` uses mobile skill
- [ ] `agentflow screens --platform=webapp --skill=desktop` uses desktop skill

### Skill Output Tests
- [ ] Webapp stylesheet includes breakpoints and hover states
- [ ] Mobile stylesheet includes 44px touch targets and safe areas
- [ ] Desktop stylesheet includes keyboard nav patterns
- [ ] Screen outputs match skill layout patterns

### Regression Tests
- [ ] Existing commands without `--skill` still work
- [ ] Old projects with `design-stylesheet.md` still work

## Rollback Plan

1. Remove `--skill` option from commands
2. Revert to loading `design/design-stylesheet` directly
3. Keep new skill files (no harm if unused)
4. Run `npm run build` and verify
