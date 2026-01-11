# Design Stylesheet - Desktop (Desktop Application)

Create a complete design system optimized for **desktop applications**.

## Platform Context: Desktop

This stylesheet targets desktop app layouts with:
- **Viewport**: Fixed 1440px+ width reference
- **Dense Layouts**: More information per screen
- **Interactions**: Hover states, tooltips, keyboard shortcuts
- **Navigation**: Sidebar navigation, toolbars, menu bars
- **Multi-pane**: Resizable panels, split views

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

## Desktop-Specific CSS Requirements

### Fixed Desktop Viewport

```css
:root {
  /* Desktop viewport */
  --viewport-width: 1440px;
  --sidebar-width: 240px;
  --sidebar-collapsed: 64px;
  --toolbar-height: 48px;
  --status-bar-height: 24px;

  /* Dense spacing */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 12px;
  --spacing-lg: 16px;
}

body {
  min-width: var(--viewport-width);
  min-height: 100vh;
  overflow: hidden;
}
```

### Dense Information Display

```css
/* Compact list items */
.list-item {
  min-height: 32px;
  padding: 6px 12px;
  font-size: 13px;
}

/* Dense data tables */
.table {
  font-size: 13px;
}
.table th, .table td {
  padding: 8px 12px;
}

/* Compact buttons */
.button-sm {
  height: 28px;
  padding: 4px 12px;
  font-size: 12px;
}

/* Dense form inputs */
.form-input-sm {
  height: 28px;
  padding: 4px 8px;
  font-size: 13px;
}
```

### Hover States & Tooltips (REQUIRED)

```css
/* Detailed hover states */
.button:hover {
  background: var(--hover-bg);
}

.list-item:hover {
  background: var(--row-hover);
}

.table tr:hover {
  background: var(--row-hover);
}

/* Tooltips */
.tooltip {
  position: relative;
}
.tooltip::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 8px;
  background: var(--tooltip-bg);
  color: var(--tooltip-text);
  font-size: 12px;
  border-radius: 4px;
  white-space: nowrap;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s;
}
.tooltip:hover::after {
  opacity: 1;
  visibility: visible;
}
```

### Keyboard Navigation (REQUIRED)

```css
/* Focus indicators */
:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 1px;
}

/* Keyboard shortcut hints */
.shortcut {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-secondary);
}
.shortcut kbd {
  background: var(--kbd-bg);
  border: 1px solid var(--kbd-border);
  border-radius: 3px;
  padding: 2px 6px;
  font-family: monospace;
  font-size: 11px;
}

/* Menu items with shortcuts */
.menu-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
}
.menu-item .shortcut {
  margin-left: 24px;
}
```

### Sidebar Navigation (Primary Navigation)

```css
.app-layout {
  display: grid;
  grid-template-columns: var(--sidebar-width) 1fr;
  grid-template-rows: var(--toolbar-height) 1fr var(--status-bar-height);
  height: 100vh;
}

.sidebar {
  grid-row: 1 / -1;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}

.sidebar.collapsed {
  width: var(--sidebar-collapsed);
}

.sidebar-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  cursor: pointer;
}
.sidebar-item:hover {
  background: var(--hover-bg);
}
.sidebar-item.active {
  background: var(--active-bg);
  color: var(--primary);
}

/* Collapsed sidebar shows only icons */
.sidebar.collapsed .sidebar-item span {
  display: none;
}
```

### Toolbar

```css
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: var(--toolbar-height);
  background: var(--toolbar-bg);
  border-bottom: 1px solid var(--border);
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-divider {
  width: 1px;
  height: 24px;
  background: var(--border);
  margin: 0 8px;
}

.toolbar-button {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}
.toolbar-button:hover {
  background: var(--hover-bg);
}
```

### Multi-Pane Layout

```css
.split-view {
  display: flex;
  height: 100%;
}

.pane {
  flex: 1;
  overflow: auto;
  min-width: 200px;
}

.pane-resizer {
  width: 4px;
  background: var(--border);
  cursor: col-resize;
}
.pane-resizer:hover {
  background: var(--primary);
}

/* Three-column layout */
.three-column {
  display: grid;
  grid-template-columns: 240px 1fr 320px;
}
```

### Status Bar

```css
.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  height: var(--status-bar-height);
  background: var(--status-bar-bg);
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-secondary);
}
```

### Context Menus

```css
.context-menu {
  position: fixed;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  min-width: 180px;
  padding: 4px 0;
  z-index: 9999;
}

.context-menu-item {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  gap: 8px;
  cursor: pointer;
}
.context-menu-item:hover {
  background: var(--hover-bg);
}

.context-menu-divider {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}
```

## Content Requirements

HTML file containing:
- CSS variables (colors, fonts, dense spacing)
- Desktop navigation patterns (sidebar, toolbar, status bar)
- Hover states and tooltips
- Keyboard shortcut displays
- **Data tables with sorting indicators**
- **Multi-pane layout demos**
- **Context menu demos**
- **ALL components must have working HTML demos**
- **Icon gallery section**

## Structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=1440">
  <style>
    :root {
      /* Color tokens */
      /* Typography tokens (smaller sizes) */
      /* Dense spacing tokens */
    }
    /* Desktop layout styles */
    /* Hover states, tooltips */
    /* Keyboard navigation */
  </style>
</head>
<body>
  <div class="app-layout">
    <!-- Sidebar navigation -->
    <aside class="sidebar">...</aside>

    <!-- Toolbar -->
    <header class="toolbar">...</header>

    <!-- Main content area -->
    <main class="split-view">
      <!-- Multi-pane content -->
    </main>

    <!-- Status bar -->
    <footer class="status-bar">...</footer>
  </div>

  <!-- Context menu (hidden by default) -->
  <div class="context-menu" style="display:none">...</div>
</body>
</html>
```
