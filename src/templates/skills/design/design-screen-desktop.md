# Design Screen - Desktop (Desktop Application)

Create a full screen design optimized for **desktop applications**.

## Platform Context: Desktop

This screen targets desktop app layouts with:
- **Fixed Viewport**: 1440px+ width
- **Dense Layouts**: More information per screen
- **Navigation**: Sidebar, toolbar, status bar
- **Interactions**: Hover states, tooltips, keyboard shortcuts
- **Multi-pane**: Split views, resizable panels

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

## Desktop-Specific Requirements

### Desktop Viewport

```html
<meta name="viewport" content="width=1440">
```

### App Shell Layout

```html
<div class="app-layout">
  <aside class="sidebar">...</aside>
  <header class="toolbar">...</header>
  <main class="main-content">...</main>
  <footer class="status-bar">...</footer>
</div>
```

```css
.app-layout {
  display: grid;
  grid-template-columns: 240px 1fr;
  grid-template-rows: 48px 1fr 24px;
  height: 100vh;
}

.sidebar {
  grid-row: 1 / -1;
}

.toolbar {
  grid-column: 2;
}

.main-content {
  grid-column: 2;
  overflow: auto;
}

.status-bar {
  grid-column: 2;
}
```

### Sidebar Navigation

```html
<aside class="sidebar">
  <div class="sidebar-header">
    <img src="..." alt="Logo" class="logo">
  </div>
  <nav class="sidebar-nav">
    <div class="sidebar-item active">
      <img src="..." alt="">
      <span>Dashboard</span>
    </div>
    <div class="sidebar-item">
      <img src="..." alt="">
      <span>Projects</span>
    </div>
  </nav>
</aside>
```

### Toolbar

```html
<header class="toolbar">
  <div class="toolbar-group">
    <button class="toolbar-button" title="New" data-tooltip="New (Ctrl+N)">
      <img src="..." alt="New">
    </button>
    <button class="toolbar-button" title="Save">
      <img src="..." alt="Save">
    </button>
  </div>
  <div class="toolbar-divider"></div>
  <div class="toolbar-search">
    <input type="search" placeholder="Search... (Ctrl+K)">
  </div>
</header>
```

### Dense Data Display

```css
.data-table {
  font-size: 13px;
}

.data-table th,
.data-table td {
  padding: 8px 12px;
}

.data-table tr:hover {
  background: var(--row-hover);
}

.list-item-dense {
  min-height: 32px;
  padding: 6px 12px;
}
```

### Multi-Pane Layout

```html
<main class="split-view">
  <div class="pane pane-left">
    <!-- List/tree view -->
  </div>
  <div class="pane-resizer"></div>
  <div class="pane pane-center">
    <!-- Main content -->
  </div>
  <div class="pane-resizer"></div>
  <div class="pane pane-right">
    <!-- Details/inspector -->
  </div>
</main>
```

```css
.split-view {
  display: flex;
  height: 100%;
}

.pane {
  overflow: auto;
  min-width: 200px;
}

.pane-left { width: 240px; flex-shrink: 0; }
.pane-center { flex: 1; }
.pane-right { width: 320px; flex-shrink: 0; }

.pane-resizer {
  width: 4px;
  background: var(--border);
  cursor: col-resize;
}
```

### Hover States & Tooltips

```css
.toolbar-button:hover {
  background: var(--hover-bg);
}

.sidebar-item:hover {
  background: var(--hover-bg);
}

/* Tooltips */
[data-tooltip]:hover::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: -28px;
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 8px;
  background: var(--tooltip-bg);
  color: var(--tooltip-text);
  font-size: 12px;
  border-radius: 4px;
  white-space: nowrap;
}
```

### Keyboard Shortcuts Display

```html
<div class="menu-item">
  <span>Save</span>
  <span class="shortcut"><kbd>Ctrl</kbd>+<kbd>S</kbd></span>
</div>
```

### Status Bar

```html
<footer class="status-bar">
  <span class="status-item">Ready</span>
  <span class="status-item">Line 42, Col 15</span>
  <span class="status-item">UTF-8</span>
</footer>
```

## Content Requirements

Single HTML file for one screen:
- Fixed desktop viewport (1440px)
- App shell with sidebar/toolbar/status bar
- Dense, information-rich layouts
- Hover states and tooltips
- Keyboard shortcut hints
- Multi-pane layout if applicable
- Data tables with row hover
- Realistic desktop app content

## Key Rules

- Use stylesheet CSS variables
- Fixed viewport, no responsive
- Sidebar navigation (collapsible)
- Toolbar with icon buttons
- Status bar with app state
- Dense spacing and smaller fonts
- Hover states required
- Keyboard shortcuts visible
- Self-contained, no external deps
