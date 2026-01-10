# BUG-023: Stylesheet Complete Component Coverage & Real Media

## Problem Statement

The showcase.html needs to:
1. Display ALL 37 components from screens.json with working HTML demos
2. Use actual images and videos instead of gradient placeholder divs

## Component Audit

### screens.json Components (37 total)

| # | Component | CSS Present | HTML Demo | Status |
|---|-----------|-------------|-----------|--------|
| 1 | header | Yes (L74) | Yes (L931) | OK - Fixed position |
| 2 | bottom-nav | Yes (L173) | Yes (L1452) | OK - Fixed position |
| 3 | button-primary | Yes (L214) | Yes (L1050) | OK |
| 4 | button-secondary | Yes (L233) | Yes (L1054) | OK |
| 5 | button-icon | Yes (L251) | Yes (L1057) | OK |
| 6 | form-input | Yes (L301) | Yes (L1071) | OK |
| 7 | form-select | Yes (L317) | Yes (L1074) | OK |
| 8 | form-textarea | Yes (L328) | Yes (L1083) | OK |
| 9 | checkbox | Yes (L344) | Yes (L1086) | OK |
| 10 | radio | Yes (L358) | Yes (L1093) | OK |
| 11 | toggle | Yes (L372) | Yes (L1104) | OK |
| 12 | card | Yes (L412) | Yes (L1119) | OK |
| 13 | list-item | Yes (L433) | Yes (L1134) | OK |
| 14 | avatar | Yes (L448) | Yes (L1144) | NEEDS: Real images |
| 15 | badge | Yes (L468) | Yes (L1152) | OK |
| 16 | tag | Yes (L497) | Yes (L1165) | OK |
| 17 | modal | Yes (L508) | **NO** | MISSING HTML |
| 18 | toast | Yes (L532) | Yes (L1180) | OK |
| 19 | empty-state | Yes (L554) | Yes (L1192) | OK |
| 20 | loading | Yes (L568) | Yes (L1186) | OK |
| 21 | error-state | Yes (L589) | Yes (L1200) | OK |
| 22 | filter-pills | Yes (L596) | Yes (L1222) | OK |
| 23 | search-bar | Yes (L627) | Yes (L1215) | OK |
| 24 | tab-bar | Yes (L654) | Yes (L1034) | OK |
| 25 | section-header | Yes (L684) | Yes (L1231) | OK |
| 26 | divider | Yes (L692) | Yes (L1235) | OK |
| 27 | progress-bar | Yes (L699) | Yes (L1241) | OK |
| 28 | stat-card | Yes (L713) | Yes (L1248) | OK |
| 29 | story-circle | Yes (L733) | Yes (L1272) | NEEDS: Real images |
| 30 | image-gallery | Yes (L749) | Yes (L1283) | NEEDS: Real images |
| 31 | video-player | Yes (L764) | Yes (L1291) | NEEDS: Real video |
| 32 | fab | Yes (L271) | Yes (L1448) | OK |
| 33 | breadcrumb | Yes (L780) | Yes (L1255) | OK |
| 34 | date-picker | Yes (L795) | **NO** | MISSING HTML |
| 35 | carousel | Yes (L804) | **NO** | MISSING HTML |
| 36 | grid | Yes (L822) | Yes (L1302) | OK |
| 37 | side-menu | Yes (L108) | Yes (L952) | OK - Slide-out |

## Issues Found

### 1. Missing HTML Demos (3 components)

**modal** - CSS defined but no interactive demo
```html
<!-- NEEDS: Modal with trigger button and close functionality -->
<button onclick="openModal()">Open Modal</button>
<div class="modal" id="demoModal" style="display: none;">
  <div class="modal-content">
    <h3>Modal Title</h3>
    <p>Modal content here</p>
    <button onclick="closeModal()">Close</button>
  </div>
</div>
```

**date-picker** - CSS defined but no demo
```html
<!-- NEEDS: Interactive calendar grid demo -->
<div class="date-picker">
  <div class="date-picker-header">January 2025</div>
  <div class="date-grid">
    <!-- Calendar days -->
  </div>
</div>
```

**carousel** - CSS defined but no demo
```html
<!-- NEEDS: Carousel with navigation dots -->
<div class="carousel">
  <div class="carousel-inner">
    <div class="carousel-item"><img src="..."></div>
    <div class="carousel-item"><img src="..."></div>
  </div>
  <div class="carousel-nav">
    <button class="carousel-dot active"></button>
    <button class="carousel-dot"></button>
  </div>
</div>
```

### 2. Gradient Placeholders Instead of Real Media

**avatar** (lines 1144-1151)
- Currently: `background: linear-gradient(135deg, var(--primary-light), var(--primary-dark))`
- Needs: Real placeholder images from picsum.photos or similar

**story-circle** (lines 1272-1282)
- Currently: Gradient divs inside story circles
- Needs: Real placeholder images

**image-gallery** (lines 1283-1290)
- Currently: Gradient divs instead of images
- Needs: Real placeholder images showing gallery functionality

**video-player** (lines 1291-1298)
- Currently: Gradient div with "Video Player" text
- Needs: Embedded video (e.g., sample MP4 or video poster image)

## Implementation Plan

### Step 1: Update design-stylesheet.md Skill

Add requirements for:
1. All 37 components MUST have HTML demos (not just CSS)
2. Use placeholder images from `https://picsum.photos/` for:
   - avatars: `https://picsum.photos/40/40` (sm: 24, lg: 64)
   - story-circle: `https://picsum.photos/64/64`
   - image-gallery: `https://picsum.photos/150/150`
   - carousel: `https://picsum.photos/800/400`
3. Use sample video for video-player
4. Modal, date-picker, and carousel MUST have interactive demos

### Step 2: Required Placeholder URLs

```
Avatar Small:   https://picsum.photos/24/24
Avatar Medium:  https://picsum.photos/40/40
Avatar Large:   https://picsum.photos/64/64
Story Circle:   https://picsum.photos/64/64
Gallery Item:   https://picsum.photos/150/150
Carousel Slide: https://picsum.photos/800/400
Card Image:     https://picsum.photos/400/200
```

### Step 3: Interactive Components

**Modal Demo:**
```html
<div class="component-demo">
  <div class="component-title">Modal</div>
  <button class="button-primary" onclick="document.getElementById('demoModal').style.display='flex'">
    Open Modal
  </button>
</div>

<!-- At end of body -->
<div class="modal" id="demoModal" style="display: none;" onclick="if(event.target===this)this.style.display='none'">
  <div class="modal-content">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h3>Join Community</h3>
      <button class="button-icon" onclick="document.getElementById('demoModal').style.display='none'">×</button>
    </div>
    <p style="margin-bottom: 16px;">Are you ready to become part of our community?</p>
    <button class="button-primary" onclick="document.getElementById('demoModal').style.display='none'">Confirm</button>
  </div>
</div>
```

**Date Picker Demo:**
```html
<div class="component-demo">
  <div class="component-title">Date Picker</div>
  <div class="date-picker-demo">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <button class="button-icon">‹</button>
      <span style="font-weight: 600;">January 2025</span>
      <button class="button-icon">›</button>
    </div>
    <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; text-align: center;">
      <div style="color: var(--text-secondary); font-size: 12px;">S</div>
      <div style="color: var(--text-secondary); font-size: 12px;">M</div>
      <!-- ... days ... -->
      <div style="padding: 8px; cursor: pointer; border-radius: 4px;">1</div>
      <div style="padding: 8px; cursor: pointer; border-radius: 4px; background: var(--primary); color: white;">15</div>
      <!-- ... more days ... -->
    </div>
  </div>
</div>
```

**Carousel Demo:**
```html
<div class="component-demo">
  <div class="component-title">Carousel</div>
  <div class="carousel" id="demoCarousel">
    <div class="carousel-inner">
      <div class="carousel-item active">
        <img src="https://picsum.photos/800/400?random=1" alt="Slide 1">
      </div>
      <div class="carousel-item">
        <img src="https://picsum.photos/800/400?random=2" alt="Slide 2">
      </div>
      <div class="carousel-item">
        <img src="https://picsum.photos/800/400?random=3" alt="Slide 3">
      </div>
    </div>
    <div class="carousel-nav">
      <button class="carousel-dot active" onclick="goToSlide(0)"></button>
      <button class="carousel-dot" onclick="goToSlide(1)"></button>
      <button class="carousel-dot" onclick="goToSlide(2)"></button>
    </div>
  </div>
</div>
```

## Files to Modify

1. `src/templates/skills/design/design-stylesheet.md`
   - Add requirement for all 37 components to have HTML demos
   - Specify placeholder image URLs to use
   - Require interactive modal, date-picker, carousel
   - Specify video placeholder approach

2. After updating, copy to project and regenerate:
   ```bash
   cp src/templates/skills/design/design-stylesheet.md projects/gotribe_full/skills/design/
   agentflow stylesheet --style=0
   ```

## Acceptance Criteria

- [ ] All 37 components have working HTML demos
- [ ] Modal opens/closes when triggered
- [ ] Date picker shows interactive calendar
- [ ] Carousel shows multiple slides with navigation
- [ ] Avatars display real placeholder images
- [ ] Story circles display real placeholder images
- [ ] Image gallery displays real placeholder images
- [ ] Video player shows video or video poster
- [ ] No gradient-only placeholders for media components
