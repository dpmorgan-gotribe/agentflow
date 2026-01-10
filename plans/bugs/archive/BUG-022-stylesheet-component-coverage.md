# BUG-022: Stylesheet Component Coverage

## Problem Statement

The stylesheet/showcase.html displays all components as isolated demos in `component-demo` divs. However, key navigational components (header, bottom-nav, side-menu) should be displayed as **interactive, fixed-position elements** to demonstrate their real-world behavior.

## Current State

### Component Audit

Comparing `outputs/analysis/screens.json` with `outputs/stylesheet/showcase.html`:

| Component | In screens.json | In showcase.html | Display Type |
|-----------|-----------------|------------------|--------------|
| header | Yes | Yes | Static demo |
| bottom-nav | Yes | Yes | Static demo |
| side-menu | Yes | Yes | Static demo |
| button-primary | Yes | Yes | Demo |
| button-secondary | Yes | Yes | Demo |
| button-icon | Yes | Yes | Demo |
| form-input | Yes | Yes | Demo |
| form-select | Yes | Yes | Demo |
| form-textarea | Yes | Yes | Demo |
| checkbox | Yes | Yes | Demo |
| radio | Yes | Yes | Demo |
| toggle | Yes | Yes | Demo |
| card | Yes | Yes | Demo |
| list-item | Yes | Yes | Demo |
| avatar | Yes | Yes | Demo |
| badge | Yes | Yes | Demo |
| tag | Yes | Yes | Demo |
| modal | Yes | Yes | Demo |
| toast | Yes | Yes | Demo |
| empty-state | Yes | Yes | Demo |
| loading | Yes | Yes | Demo |
| error-state | Yes | Yes | Demo |
| filter-pills | Yes | Yes | Demo |
| search-bar | Yes | Yes | Demo |
| tab-bar | Yes | Yes | Demo |
| section-header | Yes | Yes | Demo |
| divider | Yes | Yes | Demo |
| progress-bar | Yes | Yes | Demo |
| stat-card | Yes | Yes | Demo |
| story-circle | Yes | Yes | Demo |
| image-gallery | Yes | Yes | Demo |
| video-player | Yes | Yes | Demo |
| fab | Yes | Yes | Demo |
| breadcrumb | Yes | Yes | Demo |
| date-picker | Yes | Yes | Demo |
| carousel | Yes | Yes | Demo |
| grid | Yes | Yes | Demo |

**Result**: All 37 components from screens.json ARE present in showcase.html.

## Issues to Fix

### 1. Header - Should be Fixed Position
- Currently: Displayed as static demo inside `component-demo` div
- Required: Fixed position at top of page, visible during scroll

### 2. Bottom Navigation - Should be Fixed Position
- Currently: Displayed as static demo inside `component-demo` div
- Required: Fixed position at bottom of page, visible during scroll

### 3. Side Menu - Should be Interactive
- Currently: Static demo showing menu items
- Required: Interactive slide-out sidebar with toggle button

### 4. FAB - Should be Fixed Position
- Currently: Demo with `position: relative` override
- Required: Fixed position in bottom-right corner

## Implementation Plan

### Step 1: Update design-stylesheet.md Skill

Add requirements to the skill file to enforce:
1. Header must be rendered with `position: fixed; top: 0;`
2. Bottom-nav must be rendered with `position: fixed; bottom: 0;`
3. Side-menu must have toggle functionality (hamburger icon trigger)
4. FAB must be rendered in fixed position
5. Main content must have appropriate margins to account for fixed elements

### Step 2: Add Interactive Sidebar JavaScript

The showcase.html should include minimal JavaScript to:
- Toggle sidebar visibility on hamburger icon click
- Close sidebar when clicking outside

### Step 3: Page Layout Structure

The showcase should have this structure:
```html
<body>
  <header class="header" style="position: fixed; top: 0; ...">
    <!-- Logo + hamburger + icons -->
  </header>

  <aside class="side-menu" style="position: fixed; left: -280px; ...">
    <!-- Slide-out menu -->
  </aside>

  <main style="margin-top: 56px; margin-bottom: 64px;">
    <!-- All component demos -->
  </main>

  <button class="fab" style="position: fixed; bottom: 80px; right: 16px;">
    <!-- FAB -->
  </button>

  <nav class="bottom-nav" style="position: fixed; bottom: 0; ...">
    <!-- Bottom navigation -->
  </nav>
</body>
```

## Files to Modify

1. `src/templates/skills/design/design-stylesheet.md`
   - Add section requiring interactive header/footer/sidebar
   - Specify fixed positioning requirements
   - Require minimal JS for sidebar toggle

2. After updating skill, regenerate stylesheet with:
   ```bash
   agentflow stylesheet --style=0
   ```

## Acceptance Criteria

- [ ] Header is fixed at top and visible during scroll
- [ ] Bottom navigation is fixed at bottom and visible during scroll
- [ ] Side menu slides out when hamburger icon is clicked
- [ ] FAB is fixed in bottom-right corner
- [ ] Main content has proper margins to not overlap with fixed elements
- [ ] All 37 components remain visible and properly styled
- [ ] Page scrolls smoothly with fixed elements in place

## Notes

This is an enhancement to the stylesheet output, not a bug in component detection. The analyze command correctly identified all 37 components and the stylesheet command included them all. The issue is HOW they are displayed, not WHETHER they are displayed.
