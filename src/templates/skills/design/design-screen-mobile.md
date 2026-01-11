# Design Screen - Mobile (Native Mobile App)

Create a full screen design optimized for **native mobile applications**.

## Platform Context: Mobile

This screen targets mobile app layouts with:
- **Fixed Viewport**: 375px width reference
- **Touch Targets**: Minimum 44x44px tap areas
- **Safe Areas**: Status bar, home indicator insets
- **Navigation**: Bottom tab bar, sticky headers
- **NO HOVER**: Active states only (touch)

## Output Requirements

OUTPUT ONLY RAW HTML. No explanations. No descriptions.

Your response must:
- Start with: `<!DOCTYPE html>`
- End with: `</html>`
- Be a complete, valid HTML file
- Include inline CSS in a `<style>` tag
- Be directly viewable in a browser

DO NOT:
- Explain what you're creating
- Ask for permission
- Wrap in markdown code blocks
- Add any text before or after the HTML
- Say "I've created..." or "Here's the..."
- Include postamble like "This screen includes..."

## Mobile-Specific Requirements

### Mobile Viewport Meta

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
```

### Safe Area Layout

```css
body {
  max-width: 375px;
  margin: 0 auto;
  padding-top: env(safe-area-inset-top, 44px);
  padding-bottom: env(safe-area-inset-bottom, 34px);
}

.header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  padding-top: env(safe-area-inset-top, 44px);
  z-index: 1000;
}

.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding-bottom: env(safe-area-inset-bottom, 34px);
  z-index: 1000;
}

main {
  padding-top: calc(56px + env(safe-area-inset-top, 44px));
  padding-bottom: calc(56px + env(safe-area-inset-bottom, 34px) + 16px);
}
```

### Touch Targets (44px minimum)

```css
.button {
  min-height: 48px;
  padding: 12px 24px;
}

.list-item {
  min-height: 56px;
  padding: 16px;
}

.nav-item {
  min-height: 56px;
  min-width: 64px;
}

.form-input {
  min-height: 48px;
  font-size: 16px; /* Prevents iOS zoom */
}
```

### Active States (NO Hover)

```css
.button:active {
  transform: scale(0.98);
  opacity: 0.9;
}

.card:active {
  background: var(--pressed-bg);
}

.list-item:active {
  background: var(--pressed-bg);
}
```

### Bottom Navigation

```html
<nav class="bottom-nav">
  <div class="nav-item active">
    <img src="..." alt="Home">
    <span>Home</span>
  </div>
  <div class="nav-item">
    <img src="..." alt="Search">
    <span>Search</span>
  </div>
  <!-- More items -->
</nav>
```

```css
.bottom-nav {
  display: flex;
  justify-content: space-around;
  background: var(--surface);
  border-top: 1px solid var(--border);
}

.nav-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  gap: 4px;
}

.nav-item img {
  width: 24px;
  height: 24px;
}

.nav-item span {
  font-size: 10px;
}
```

### Sticky Header

```html
<header class="header">
  <button class="header-back">
    <img src="..." alt="Back">
  </button>
  <h1 class="header-title">Screen Title</h1>
  <button class="header-action">
    <img src="..." alt="More">
  </button>
</header>
```

### Pull-to-Refresh (Optional)

```html
<div class="pull-indicator">
  <div class="spinner"></div>
</div>
```

### Single Column Layout

Mobile screens should use single-column layouts:

```css
.content {
  padding: 16px;
}

.card-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
```

## Content Requirements

Single HTML file for one screen:
- Fixed mobile viewport (375px)
- Touch-friendly tap targets (44px+)
- Safe area padding
- Bottom tab navigation
- Sticky header with back button
- Single-column layout
- Active states (no hover)
- Realistic mobile content

## Key Rules

- Use stylesheet CSS variables
- Fixed viewport, no responsive breakpoints
- Header with back navigation
- Bottom nav for main navigation
- 44px minimum touch targets
- 16px minimum font size for inputs
- No hover states
- Self-contained, no external deps
