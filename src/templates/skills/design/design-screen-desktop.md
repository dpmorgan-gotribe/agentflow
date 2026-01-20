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

## CRITICAL: Navigation Context Implementation

You will receive a "Navigation Context" section specifying the exact navigation for this screen. You MUST implement it exactly as specified.

### Desktop Navigation Structure

Desktop apps have an always-visible sidebar (not hamburger drawer). The navigation context tells you which items to include.

### Header/Toolbar Variants

**`standard`** - Top toolbar with search and actions:
```html
<header class="toolbar" role="banner">
  <div class="toolbar-left">
    <button class="toolbar-btn" aria-label="Search">
      <img src="../../assets/icons/search.svg" alt="">
    </button>
    <input type="search" class="toolbar-search" placeholder="Search... (Ctrl+K)">
  </div>
  <div class="toolbar-right">
    <button class="toolbar-btn" aria-label="Notifications">
      <img src="../../assets/icons/notifications.svg" alt="">
    </button>
    <button class="toolbar-btn" aria-label="Settings">
      <img src="../../assets/icons/settings.svg" alt="">
    </button>
    <div class="admin-profile">
      <img src="../../assets/icons/account.svg" alt="" class="avatar">
      <span>Admin</span>
    </div>
  </div>
</header>
```

**`minimal`** - Just logo and minimal controls:
```html
<header class="toolbar toolbar-minimal">
  <img src="../../assets/logos/gotribe_transparent.png" class="logo" alt="GoTribe">
</header>
```

### Sidebar Navigation (Always Visible)

When sidemenu items are provided, render them in the sidebar:

```html
<aside class="sidebar">
  <div class="sidebar-header">
    <img src="../../assets/logos/gotribe_transparent.png" class="sidebar-logo" alt="GoTribe">
  </div>
  <nav class="sidebar-nav" aria-label="Main navigation">
    <a href="#" class="sidebar-item active" aria-current="page">
      <img src="../../assets/icons/home.svg" alt="">
      <span>Dashboard</span>
    </a>
    <a href="#" class="sidebar-item">
      <img src="../../assets/icons/account.svg" alt="">
      <span>Users</span>
    </a>
    <a href="#" class="sidebar-item">
      <img src="../../assets/icons/camping.svg" alt="">
      <span>Tribes</span>
    </a>
    <a href="#" class="sidebar-item">
      <img src="../../assets/icons/event.svg" alt="">
      <span>Events</span>
    </a>
    <a href="#" class="sidebar-item">
      <img src="../../assets/icons/shops.svg" alt="">
      <span>Marketplace</span>
    </a>
    <a href="#" class="sidebar-item">
      <img src="../../assets/icons/settings.svg" alt="">
      <span>Settings</span>
    </a>
  </nav>
  <div class="sidebar-footer">
    <button class="sidebar-collapse-btn" onclick="toggleSidebar()" aria-label="Collapse sidebar">
      <img src="../../assets/icons/menu.svg" alt="">
    </button>
  </div>
</aside>
```

```css
.sidebar {
  width: 240px;
  background: var(--header-footer, #2D2D2D);
  display: flex;
  flex-direction: column;
  transition: width 0.2s;
}

.sidebar.collapsed {
  width: 64px;
}

.sidebar.collapsed .sidebar-item span {
  display: none;
}

.sidebar-header {
  padding: 16px;
  border-bottom: 1px solid rgba(255,255,255,0.1);
}

.sidebar-logo {
  height: 32px;
  filter: brightness(0) invert(1);
}

.sidebar-nav {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.sidebar-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  color: rgba(255,255,255,0.7);
  text-decoration: none;
  border-radius: 6px;
  font-size: 14px;
  transition: background 0.2s, color 0.2s;
}

.sidebar-item:hover {
  background: rgba(255,255,255,0.1);
  color: white;
}

.sidebar-item.active {
  background: var(--primary);
  color: white;
}

.sidebar-item img {
  width: 20px;
  height: 20px;
  filter: brightness(0) invert(1);
  opacity: 0.8;
}

.sidebar-item.active img,
.sidebar-item:hover img {
  opacity: 1;
}

.sidebar-footer {
  padding: 8px;
  border-top: 1px solid rgba(255,255,255,0.1);
}

.sidebar-collapse-btn {
  width: 100%;
  background: none;
  border: none;
  padding: 10px;
  cursor: pointer;
  display: flex;
  justify-content: center;
}

.sidebar-collapse-btn img {
  width: 20px;
  height: 20px;
  filter: brightness(0) invert(1);
  opacity: 0.7;
}

.sidebar-collapse-btn:hover img {
  opacity: 1;
}
```

```html
<script>
function toggleSidebar() {
  document.querySelector('.sidebar').classList.toggle('collapsed');
  document.querySelector('.main-content').classList.toggle('sidebar-collapsed');
}
</script>
```

### Footer Variants

**`hidden`** - No status bar:
- Do NOT render status bar

**`status-bar`** - Standard desktop status bar:
```html
<footer class="status-bar">
  <span class="status-item">Ready</span>
  <span class="status-item">Last updated: 2 mins ago</span>
  <span class="status-spacer"></span>
  <span class="status-item">v2.1.0</span>
</footer>
```

### Icon Mapping

Use icons from assets/icons/ folder. Common mappings:
- home.svg → Dashboard
- account.svg → Users/Profile
- camping.svg → Tribes
- event.svg → Events
- shops.svg → Marketplace
- settings.svg → Settings
- search.svg → Search
- notifications.svg → Notifications/Alerts
- menu.svg → Menu/Collapse
