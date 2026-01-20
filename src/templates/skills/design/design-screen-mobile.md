# Design Screen - Mobile (Native Mobile App)

Create a full screen design optimized for **native mobile applications**.

## CRITICAL: MANDATORY MOBILE LAYOUT

**This is a MOBILE screen. You MUST use these EXACT values:**

```css
body {
  max-width: 375px;   /* MANDATORY - DO NOT use any other value */
  margin: 0 auto;
}
```

**FORBIDDEN - You must NEVER use:**
- `max-width` values greater than 375px (NO 1200px, NO 1400px, NO 100%)
- Multi-column grid layouts
- Desktop-style sidebars
- Side navigation panels
- Wide data tables (use vertical card lists instead)
- Hover-only interactions

**If this is an admin screen, dashboard, or data-heavy screen:**
- It is STILL a mobile screen
- Use scrollable card lists instead of wide tables
- Stack content vertically
- Use collapsible sections for dense data
- 375px max-width is NON-NEGOTIABLE

## Platform Context: Mobile

This screen targets mobile app layouts with:
- **Fixed Viewport**: 375px width - NO EXCEPTIONS
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
- Have `body { max-width: 375px; }` - THIS IS REQUIRED

DO NOT:
- Explain what you're creating
- Ask for permission
- Wrap in markdown code blocks
- Add any text before or after the HTML
- Say "I've created..." or "Here's the..."
- Include postamble like "This screen includes..."
- Use max-width greater than 375px

## Mobile-Specific Requirements

### Mobile Viewport Meta (REQUIRED)

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
```

### Safe Area Layout (REQUIRED)

```css
body {
  max-width: 375px;  /* MANDATORY */
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

### Bottom Navigation (REQUIRED for main screens)

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

### Single Column Layout (REQUIRED)

Mobile screens MUST use single-column layouts:

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

### Mobile Data Display Patterns

For data-heavy screens (dashboards, lists, reports), use these MOBILE patterns:

**Instead of wide tables, use card lists:**
```html
<div class="data-card">
  <div class="data-card-header">
    <span class="data-label">User Name</span>
    <span class="data-status">Active</span>
  </div>
  <div class="data-card-body">
    <div class="data-row">
      <span>Email</span>
      <span>user@example.com</span>
    </div>
    <div class="data-row">
      <span>Last Login</span>
      <span>2 hours ago</span>
    </div>
  </div>
</div>
```

**Instead of multi-column dashboards, use scrollable sections:**
```html
<section class="stat-section">
  <h2>Overview</h2>
  <div class="stat-scroll">
    <div class="stat-card">...</div>
    <div class="stat-card">...</div>
  </div>
</section>
```

## Content Requirements

Single HTML file for one screen:
- Fixed mobile viewport (375px) - MANDATORY
- Touch-friendly tap targets (44px+)
- Safe area padding with env()
- Bottom tab navigation
- Sticky header with back button
- Single-column layout - NO multi-column grids
- Active states (no hover)
- Realistic mobile content

## Key Rules

- Use stylesheet CSS variables
- Fixed 375px viewport - NO responsive breakpoints
- Header with back navigation
- Bottom nav for main navigation
- 44px minimum touch targets
- 16px minimum font size for inputs
- No hover states - active states only
- Self-contained, no external deps
- NEVER exceed 375px max-width

## CRITICAL: Navigation Context Implementation

You will receive a "Navigation Context" section specifying the exact navigation for this screen. You MUST implement it exactly as specified.

### Header Variants

**`standard`** - Full header with logo and action icons:
```html
<header class="header">
  <button class="menu-btn" onclick="toggleSidemenu()">
    <img src="../../../assets/icons/menu.svg" alt="Menu">
  </button>
  <img src="../../../assets/logos/gotribe_transparent.png" class="logo" alt="Logo">
  <div class="header-actions">
    <button class="icon-btn"><img src="../../../assets/icons/notifications.svg" alt=""></button>
    <button class="icon-btn"><img src="../../../assets/icons/chat.svg" alt=""></button>
  </div>
</header>
```

**`minimal`** - Logo only, no icons (for auth/splash screens):
```html
<header class="header header-minimal">
  <img src="../../../assets/logos/gotribe_transparent.png" class="logo" alt="Logo">
</header>
```

**`breadcrumb`** - Back button with breadcrumb path:
```html
<header class="header">
  <button class="header-back" onclick="history.back()">
    <img src="../../../assets/icons/arrow_back.svg" alt="Back">
  </button>
  <div class="breadcrumbs">
    <span>Tribes</span>
    <span class="separator">›</span>
    <span class="current">Tribe Details</span>
  </div>
  <div class="header-actions">...</div>
</header>
```

### Footer Variants

**`hidden`** - No footer (wizard screens, modals):
- Do NOT render any bottom-nav or footer element
- Adjust main padding accordingly

**`tab-bar`** - Bottom navigation with tabs:
```html
<nav class="bottom-nav">
  <div class="nav-item active">
    <img src="../../../assets/icons/home.svg" alt="">
    <span>Home</span>
  </div>
  <div class="nav-item">
    <img src="../../../assets/icons/account.svg" alt="">
    <span>Profile</span>
  </div>
  <div class="nav-item">
    <img src="../../../assets/icons/chat.svg" alt="">
    <span>Chat</span>
  </div>
</nav>
```

**`wizard-buttons`** - Back/Next navigation for multi-step flows:
```html
<footer class="wizard-footer">
  <button class="btn-secondary" onclick="history.back()">Back</button>
  <button class="btn-primary">Next</button>
</footer>
```
```css
.wizard-footer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  max-width: 375px;
  margin: 0 auto;
  padding: 16px;
  padding-bottom: calc(16px + env(safe-area-inset-bottom, 34px));
  background: var(--surface);
  display: flex;
  gap: 12px;
  border-top: 1px solid var(--border);
  z-index: 1000;
}
.wizard-footer .btn-secondary { flex: 1; }
.wizard-footer .btn-primary { flex: 2; }
```

**`payment-button`** - Single action button:
```html
<footer class="action-footer">
  <button class="btn-primary btn-full">Pay $25.00</button>
</footer>
```

### Sidemenu (Hamburger Drawer) - REQUIRED when specified

When sidemenu items are provided in the navigation context, you MUST include an interactive hamburger menu:

```html
<!-- Overlay (closes menu when tapped) -->
<div class="sidemenu-overlay" onclick="closeSidemenu()"></div>

<!-- Sidemenu drawer -->
<nav class="sidemenu">
  <div class="sidemenu-header">
    <img src="../../../assets/logos/gotribe_transparent.png" class="sidemenu-logo" alt="Logo">
    <button class="sidemenu-close" onclick="closeSidemenu()">
      <img src="../../../assets/icons/close.svg" alt="Close">
    </button>
  </div>
  <div class="sidemenu-items">
    <a href="#" class="sidemenu-item active">
      <img src="../../../assets/icons/camping.svg" alt="">
      <span>Tribes</span>
    </a>
    <a href="#" class="sidemenu-item">
      <img src="../../../assets/icons/event.svg" alt="">
      <span>Events</span>
    </a>
    <a href="#" class="sidemenu-item">
      <img src="../../../assets/icons/following.svg" alt="">
      <span>Following</span>
    </a>
    <a href="#" class="sidemenu-item">
      <img src="../../../assets/icons/jobs.svg" alt="">
      <span>Jobs</span>
    </a>
    <a href="#" class="sidemenu-item">
      <img src="../../../assets/icons/offerings.svg" alt="">
      <span>Offerings</span>
    </a>
    <a href="#" class="sidemenu-item">
      <img src="../../../assets/icons/shops.svg" alt="">
      <span>Shops</span>
    </a>
  </div>
</nav>
```

```css
.sidemenu-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 1998;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.3s, visibility 0.3s;
}

.sidemenu-overlay.open {
  opacity: 1;
  visibility: visible;
}

.sidemenu {
  position: fixed;
  top: 0;
  left: 0;
  width: 280px;
  height: 100%;
  background: var(--header-footer);
  z-index: 1999;
  transform: translateX(-100%);
  transition: transform 0.3s ease;
  display: flex;
  flex-direction: column;
}

.sidemenu.open {
  transform: translateX(0);
}

.sidemenu-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  padding-top: calc(16px + env(safe-area-inset-top, 44px));
  border-bottom: 1px solid rgba(255,255,255,0.1);
}

.sidemenu-logo {
  height: 32px;
  filter: brightness(0) invert(1);
}

.sidemenu-close {
  background: none;
  border: none;
  padding: 8px;
  cursor: pointer;
}

.sidemenu-close img {
  width: 24px;
  height: 24px;
  filter: brightness(0) invert(1);
}

.sidemenu-items {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.sidemenu-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
  color: rgba(255,255,255,0.8);
  text-decoration: none;
  font-size: 15px;
  transition: background 0.2s;
}

.sidemenu-item:active {
  background: rgba(255,255,255,0.1);
}

.sidemenu-item.active {
  color: white;
  background: rgba(107, 155, 55, 0.3);
  border-left: 3px solid var(--primary);
}

.sidemenu-item img {
  width: 24px;
  height: 24px;
  filter: brightness(0) invert(1);
  opacity: 0.8;
}

.sidemenu-item.active img {
  opacity: 1;
}
```

```javascript
<script>
function toggleSidemenu() {
  document.querySelector('.sidemenu').classList.toggle('open');
  document.querySelector('.sidemenu-overlay').classList.toggle('open');
  document.body.style.overflow = document.querySelector('.sidemenu').classList.contains('open') ? 'hidden' : '';
}

function closeSidemenu() {
  document.querySelector('.sidemenu').classList.remove('open');
  document.querySelector('.sidemenu-overlay').classList.remove('open');
  document.body.style.overflow = '';
}
</script>
```

### Icon Mapping

Use icons from assets/icons/ folder. Common mappings:
- camping.svg → Tribes
- event.svg → Events
- following.svg → Following
- jobs.svg → Jobs
- offerings.svg → Offerings
- shops.svg → Shops
- home.svg → Home
- account.svg → Profile
- chat.svg → Messages
- notifications.svg → Notifications
- settings.svg → Settings
- search.svg → Search/Discover
- menu.svg → Hamburger menu
- close.svg → Close
- arrow_back.svg → Back
- add.svg → Create/Add
- filter.svg → Filter
