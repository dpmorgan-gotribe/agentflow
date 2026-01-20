# Design Screen - Webapp (Responsive Web)

Create a full screen design optimized for **responsive web applications**.

## Platform Context: Webapp

This screen targets responsive web layouts with:
- **Responsive Design**: Mobile-first, scales to desktop
- **Semantic HTML**: Proper heading hierarchy, landmarks, ARIA
- **Accessibility**: Keyboard navigation, screen reader support
- **Interactions**: Hover states, focus indicators

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

## Webapp-Specific Requirements

### Responsive Container

```html
<main class="container">
  <!-- Content adapts to screen size -->
</main>
```

```css
.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 16px;
}

@media (min-width: 768px) {
  .container { padding: 0 24px; }
}
```

### Semantic HTML Structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body>
  <a href="#main" class="skip-link">Skip to main content</a>

  <header role="banner">
    <nav aria-label="Main navigation">...</nav>
  </header>

  <main id="main" role="main">
    <h1>Page Title</h1>
    <!-- Content with proper heading hierarchy (h1 > h2 > h3) -->
  </main>

  <footer role="contentinfo">...</footer>
</body>
</html>
```

### Hover & Focus States

Include hover states for all interactive elements:

```css
.button:hover { background: var(--hover-bg); }
.card:hover { box-shadow: var(--shadow-lg); }
.link:hover { text-decoration: underline; }

:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
```

### Responsive Images

```html
<picture>
  <source media="(min-width: 1024px)" srcset="large.jpg">
  <source media="(min-width: 768px)" srcset="medium.jpg">
  <img src="small.jpg" alt="Description" loading="lazy">
</picture>
```

### Responsive Grid

```css
.grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

@media (min-width: 768px) {
  .grid { grid-template-columns: repeat(2, 1fr); }
}

@media (min-width: 1024px) {
  .grid { grid-template-columns: repeat(3, 1fr); }
}
```

## Content Requirements

Single HTML file for one screen:
- Responsive layout (mobile to desktop)
- Complete layout matching stylesheet
- All components styled per stylesheet
- Realistic content with proper semantics
- Hover and focus states
- All states if applicable (loading, error, empty)

## Key Rules

- Use stylesheet CSS variables
- Mobile-first responsive breakpoints
- Header/footer appropriate for screen type
- Solid background colors on chrome
- Self-contained, no external deps
- Include skip link for accessibility

## CRITICAL: Navigation Context Implementation

You will receive a "Navigation Context" section specifying the exact navigation for this screen. You MUST implement it exactly as specified.

### Header Variants

**`standard`** - Full header with logo and action icons:
```html
<header class="header" role="banner">
  <button class="menu-btn" onclick="toggleSidemenu()" aria-label="Menu">
    <img src="../../../assets/icons/menu.svg" alt="">
  </button>
  <img src="../../../assets/logos/gotribe_transparent.png" class="logo" alt="GoTribe">
  <nav class="header-actions" aria-label="Quick actions">
    <button class="icon-btn" aria-label="Notifications"><img src="../../../assets/icons/notifications.svg" alt=""></button>
    <button class="icon-btn" aria-label="Messages"><img src="../../../assets/icons/chat.svg" alt=""></button>
    <button class="icon-btn" aria-label="Settings"><img src="../../../assets/icons/settings.svg" alt=""></button>
  </nav>
</header>
```

**`minimal`** - Logo only, no icons (for auth/splash screens):
```html
<header class="header header-minimal" role="banner">
  <img src="../../../assets/logos/gotribe_transparent.png" class="logo" alt="GoTribe">
</header>
```

**`breadcrumb`** - Back button with breadcrumb path:
```html
<header class="header" role="banner">
  <button class="header-back" onclick="history.back()" aria-label="Go back">
    <img src="../../../assets/icons/arrow_back.svg" alt="">
  </button>
  <nav class="breadcrumbs" aria-label="Breadcrumb">
    <a href="#">Tribes</a>
    <span class="separator" aria-hidden="true">›</span>
    <span class="current" aria-current="page">Tribe Details</span>
  </nav>
  <div class="header-actions">...</div>
</header>
```

### Footer Variants

**`hidden`** - No footer (wizard screens, modals):
- Do NOT render any footer element
- Adjust main padding accordingly

**`tab-bar`** - Bottom navigation with tabs (for mobile-style webapps):
```html
<nav class="bottom-nav" role="navigation" aria-label="Main navigation">
  <a href="#" class="nav-item active" aria-current="page">
    <img src="../../../assets/icons/home.svg" alt="">
    <span>Home</span>
  </a>
  <a href="#" class="nav-item">
    <img src="../../../assets/icons/account.svg" alt="">
    <span>Profile</span>
  </a>
  <a href="#" class="nav-item">
    <img src="../../../assets/icons/chat.svg" alt="">
    <span>Chat</span>
  </a>
</nav>
```

**`wizard-buttons`** - Back/Next navigation for multi-step flows:
```html
<footer class="wizard-footer">
  <button class="btn-secondary" onclick="history.back()">Back</button>
  <button class="btn-primary">Next</button>
</footer>
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
<!-- Overlay (closes menu when clicked) -->
<div class="sidemenu-overlay" onclick="closeSidemenu()"></div>

<!-- Sidemenu drawer -->
<nav class="sidemenu" role="navigation" aria-label="Main menu">
  <div class="sidemenu-header">
    <img src="../../../assets/logos/gotribe_transparent.png" class="sidemenu-logo" alt="GoTribe">
    <button class="sidemenu-close" onclick="closeSidemenu()" aria-label="Close menu">
      <img src="../../../assets/icons/close.svg" alt="">
    </button>
  </div>
  <div class="sidemenu-items">
    <a href="#" class="sidemenu-item active" aria-current="page">
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
  z-index: 998;
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
  background: var(--header-footer, #3D3D3D);
  z-index: 999;
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
  padding: 14px 20px;
  color: rgba(255,255,255,0.8);
  text-decoration: none;
  font-size: 15px;
  transition: background 0.2s;
}

.sidemenu-item:hover {
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

```html
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

// Close on escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSidemenu();
});
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
