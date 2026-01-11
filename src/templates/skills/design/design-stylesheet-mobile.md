# Design Stylesheet - Mobile (Native Mobile App)

Create a complete design system optimized for **native mobile applications**.

## Platform Context: Mobile

This stylesheet targets mobile app layouts with:
- **Viewport**: Fixed 375px width reference (scales to device)
- **Touch Targets**: Minimum 44x44px tap areas
- **Safe Areas**: Notch, home indicator, status bar insets
- **Navigation**: Bottom tab bar, swipe gestures
- **NO HOVER STATES**: Touch-only interactions

## CRITICAL OUTPUT REQUIREMENTS

**YOUR ENTIRE RESPONSE MUST BE RAW HTML CODE ONLY.**

Do NOT use ANY tools - no Write, no Edit, no Bash. Just output text directly.
Do NOT summarize or describe what you're creating.
Do NOT write to files - just output the HTML directly.

Your response MUST:
- Start IMMEDIATELY with: `<!DOCTYPE html>` (no preamble)
- End with: `</html>` (no postamble)
- Be a complete, valid HTML file
- Include inline CSS in a `<style>` tag
- Be directly viewable in a browser

FORBIDDEN (will cause failure):
- Using Write or Edit tools
- Saying "I've created..." or "Here's the..."
- Wrapping in markdown code blocks
- Adding ANY text before `<!DOCTYPE html>`
- Adding ANY text after `</html>`

## Mobile-Specific CSS Requirements

### Fixed Viewport (REQUIRED)

```css
:root {
  /* Mobile viewport */
  --viewport-width: 375px;
  --safe-area-top: env(safe-area-inset-top, 44px);
  --safe-area-bottom: env(safe-area-inset-bottom, 34px);

  /* Touch-friendly spacing */
  --touch-target: 44px;
  --spacing-touch: 12px;
}

body {
  max-width: var(--viewport-width);
  margin: 0 auto;
  min-height: 100vh;
  padding-top: var(--safe-area-top);
  padding-bottom: var(--safe-area-bottom);
}
```

### Touch Targets (REQUIRED - 44px minimum)

```css
/* All interactive elements must be at least 44x44px */
.button, .nav-item, .list-item, .checkbox, .radio {
  min-height: var(--touch-target);
  min-width: var(--touch-target);
}

.button {
  min-height: 48px;
  padding: 12px 24px;
  font-size: 16px; /* Prevent zoom on iOS */
}

.form-input {
  min-height: 48px;
  font-size: 16px; /* Prevent zoom on iOS */
  padding: 12px 16px;
}

/* Touch-friendly list items */
.list-item {
  min-height: 56px;
  padding: 16px;
  display: flex;
  align-items: center;
  gap: 16px;
}
```

### Safe Area Insets (REQUIRED)

```css
/* Header with status bar safe area */
.header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  padding-top: var(--safe-area-top);
  height: calc(56px + var(--safe-area-top));
  z-index: 1000;
}

/* Bottom nav with home indicator safe area */
.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding-bottom: var(--safe-area-bottom);
  height: calc(56px + var(--safe-area-bottom));
  z-index: 1000;
}

/* Main content spacing */
main {
  padding-top: calc(56px + var(--safe-area-top));
  padding-bottom: calc(56px + var(--safe-area-bottom) + 16px);
}
```

### NO Hover States (Mobile is touch-only)

```css
/* Active states instead of hover */
.button:active {
  transform: scale(0.98);
  opacity: 0.9;
}

.card:active {
  background: var(--pressed-bg);
}

.nav-item:active {
  background: var(--pressed-bg);
}

/* Remove any hover effects */
@media (hover: none) {
  .button:hover,
  .card:hover,
  .nav-item:hover {
    /* No hover effects on touch devices */
  }
}
```

### Bottom Tab Navigation (Primary Navigation)

```css
.bottom-nav {
  display: flex;
  justify-content: space-around;
  align-items: center;
  background: var(--surface);
  border-top: 1px solid var(--border);
}

.nav-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 8px 0;
  min-height: 56px;
  gap: 4px;
}

.nav-item img {
  width: 24px;
  height: 24px;
}

.nav-item span {
  font-size: 10px;
}

.nav-item.active {
  color: var(--primary);
}
```

### Pull-to-Refresh Indicator

```css
.pull-to-refresh {
  position: absolute;
  top: -60px;
  left: 50%;
  transform: translateX(-50%);
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pull-to-refresh.visible {
  top: 16px;
}
```

### Swipe Actions

```css
.swipe-container {
  overflow-x: hidden;
  position: relative;
}

.swipe-content {
  transition: transform 0.2s;
}

.swipe-actions {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  display: flex;
}

.swipe-action {
  width: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

## Content Requirements

HTML file containing:
- CSS variables (colors, fonts, spacing, safe areas)
- Touch-optimized components (44px+ tap targets)
- Mobile navigation patterns (bottom nav, sticky header)
- Active states (no hover)
- **ALL components must have working HTML demos**
- **Icon gallery section**
- **Real placeholder images**

## Structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <style>
    :root {
      /* Color tokens */
      /* Typography tokens (16px min for inputs) */
      /* Spacing tokens (touch-friendly) */
      /* Safe area tokens */
    }
    /* Mobile-first styles */
    /* Touch target sizing */
    /* Active states (no hover) */
  </style>
</head>
<body>
  <!-- Status bar spacer -->
  <div class="status-bar-spacer"></div>

  <!-- Sticky header -->
  <header class="header">...</header>

  <!-- Main content -->
  <main>
    <!-- Touch-optimized component demos -->
  </main>

  <!-- Fixed bottom navigation -->
  <nav class="bottom-nav">
    <div class="nav-item active">
      <img src="..." alt="Home">
      <span>Home</span>
    </div>
    <!-- More nav items -->
  </nav>
</body>
</html>
```
