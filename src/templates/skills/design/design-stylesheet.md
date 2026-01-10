# Design Stylesheet

Create a complete design system.

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
- Saying "I've created..." or "Here's the..." or "The design system includes..."
- Wrapping in markdown code blocks
- Adding ANY text before `<!DOCTYPE html>`
- Adding ANY text after `</html>`
- Summarizing the output
- Asking for permission

## Content Requirements

HTML file containing:
- CSS variables (colors, fonts, spacing)
- All component styles
- Component showcase/examples
- Interactive states (hover, active, disabled)
- **ALL components must have working HTML demos** (REQUIRED - see below)
- **Icon gallery section** (REQUIRED - see below)
- **Real placeholder images for media components** (REQUIRED - see below)

## Complete Component Coverage (REQUIRED)

Every component in the components list MUST have BOTH:
1. CSS styles defined
2. Working HTML demo in the showcase

### Components That MUST Have Interactive Demos

**modal** - Include a working modal with open/close functionality:
```html
<button class="button-primary" onclick="document.getElementById('demoModal').style.display='flex'">
  Open Modal
</button>
<div class="modal" id="demoModal" style="display:none" onclick="if(event.target===this)this.style.display='none'">
  <div class="modal-content">
    <h3>Modal Title</h3>
    <p>Modal content</p>
    <button class="button-primary" onclick="document.getElementById('demoModal').style.display='none'">Close</button>
  </div>
</div>
```

**date-picker** - Include a calendar grid demo:
```html
<div class="date-picker">
  <div class="date-picker-header">
    <button class="button-icon">‹</button>
    <span>January 2025</span>
    <button class="button-icon">›</button>
  </div>
  <div class="date-grid">
    <div class="day-header">S</div><div class="day-header">M</div><!-- ... -->
    <div class="day">1</div><div class="day selected">15</div><!-- ... -->
  </div>
</div>
```

**carousel** - Include slides with navigation:
```html
<div class="carousel">
  <div class="carousel-inner">
    <img src="https://picsum.photos/800/400?random=1" alt="Slide 1">
  </div>
  <div class="carousel-nav">
    <span class="carousel-dot active"></span>
    <span class="carousel-dot"></span>
    <span class="carousel-dot"></span>
  </div>
</div>
```

## Placeholder Images (REQUIRED)

DO NOT use gradient divs or colored backgrounds for media components. Use real placeholder images:

| Component | Placeholder URL |
|-----------|----------------|
| avatar-sm (24px) | `https://picsum.photos/24/24?random=1` |
| avatar (40px) | `https://picsum.photos/40/40?random=1` |
| avatar-lg (64px) | `https://picsum.photos/64/64?random=1` |
| story-circle | `https://picsum.photos/64/64?random=2` |
| image-gallery item | `https://picsum.photos/150/150?random=N` |
| carousel slide | `https://picsum.photos/800/400?random=N` |
| card image | `https://picsum.photos/400/200?random=1` |

### Avatar Example
```html
<div class="avatar">
  <img src="https://picsum.photos/40/40?random=1" alt="Avatar">
</div>
```

### Story Circle Example
```html
<div class="story-circle">
  <img src="https://picsum.photos/64/64?random=1" alt="Story">
</div>
```

### Image Gallery Example
```html
<div class="image-gallery">
  <img src="https://picsum.photos/150/150?random=1" alt="Gallery 1">
  <img src="https://picsum.photos/150/150?random=2" alt="Gallery 2">
  <img src="https://picsum.photos/150/150?random=3" alt="Gallery 3">
</div>
```

### Video Player Example
Use a video poster or embed:
```html
<div class="video-player">
  <video poster="https://picsum.photos/400/600?random=1" controls>
    <source src="#" type="video/mp4">
  </video>
  <div class="video-overlay">
    <button class="play-button">▶</button>
  </div>
</div>
```

## Avatar CSS Update

Avatars should contain images, not just backgrounds:
```css
.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
```

## Icon Gallery Section (REQUIRED)

Your showcase.html MUST include an Icons section with:

```html
<section class="icon-gallery">
  <h2>Icons</h2>

  <!-- Icon grid showing ALL required icons -->
  <div class="icon-grid">
    <div class="icon-item">
      <img src="[icon-path]" alt="icon-name">
      <span>icon-name</span>
    </div>
    <!-- ... all icons ... -->
  </div>

  <!-- Icon states -->
  <h3>Icon States</h3>
  <div class="icon-states">
    <div class="state-row light-bg">
      <span>Light background:</span>
      <img class="icon-default" src="..." alt="default">
      <img class="icon-active" src="..." alt="active">
      <img class="icon-disabled" src="..." alt="disabled">
    </div>
    <div class="state-row dark-bg">
      <span>Dark background:</span>
      <img class="icon-inverted" src="..." alt="inverted">
      <img class="icon-active" src="..." alt="active">
    </div>
  </div>

  <!-- Icon sizes -->
  <h3>Icon Sizes</h3>
  <div class="icon-sizes">
    <img class="icon-sm" src="..."> 16px
    <img class="icon-md" src="..."> 24px
    <img class="icon-lg" src="..."> 32px
    <img class="icon-xl" src="..."> 48px
  </div>
</section>
```

## Required Icon CSS

Include these icon styles in your `<style>` tag:

```css
/* Icon Gallery */
.icon-gallery { padding: 24px 0; }
.icon-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 16px;
}
.icon-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px;
  border-radius: 8px;
  background: var(--surface, #f5f5f5);
}
.icon-item img { width: 24px; height: 24px; }
.icon-item span {
  font-size: 12px;
  margin-top: 8px;
  color: var(--text-secondary, #666);
}

/* Icon states */
.icon-default { }
.icon-active { filter: brightness(0) saturate(100%) invert(56%) sepia(41%) saturate(618%) hue-rotate(47deg); }
.icon-inverted { filter: brightness(0) invert(1); }
.icon-disabled { opacity: 0.4; }

/* Icon sizes */
.icon-sm { width: 16px; height: 16px; }
.icon-md { width: 24px; height: 24px; }
.icon-lg { width: 32px; height: 32px; }
.icon-xl { width: 48px; height: 48px; }

/* State row backgrounds */
.state-row { padding: 16px; display: flex; align-items: center; gap: 16px; }
.state-row.light-bg { background: #ffffff; }
.state-row.dark-bg { background: #3D3D3D; }
```

## Interactive Navigation Requirements (REQUIRED)

The showcase.html MUST display header, bottom-nav, side-menu, and FAB as **fixed, interactive elements** - NOT as static demos inside component-demo divs.

### Page Layout Structure

```html
<!DOCTYPE html>
<html>
<head>
  <style>/* styles */</style>
</head>
<body>
  <!-- FIXED HEADER - position: fixed; top: 0; -->
  <header class="header" style="position: fixed; top: 0; left: 0; right: 0; z-index: 1000;">
    <button class="menu-toggle" onclick="toggleSidebar()">☰</button>
    <img src="..." class="logo">
    <div class="header-icons"><!-- icons --></div>
  </header>

  <!-- SLIDE-OUT SIDEBAR - toggles visibility -->
  <aside class="side-menu" id="sidebar">
    <div class="side-menu-item active">Home</div>
    <div class="side-menu-item">Calendar</div>
    <!-- menu items -->
  </aside>
  <div class="sidebar-overlay" id="overlay" onclick="toggleSidebar()"></div>

  <!-- MAIN CONTENT - has margins for fixed header/footer -->
  <main style="margin-top: 72px; margin-bottom: 80px; padding: 24px;">
    <!-- All component demos go here -->
  </main>

  <!-- FIXED FAB - position: fixed; bottom: 80px; right: 16px; -->
  <button class="fab">+</button>

  <!-- FIXED BOTTOM NAV - position: fixed; bottom: 0; -->
  <nav class="bottom-nav" style="position: fixed; bottom: 0; left: 0; right: 0; z-index: 1000;">
    <div class="nav-item active"><img src="..."></div>
    <div class="nav-item"><img src="..."></div>
    <!-- nav items -->
  </nav>

  <script>
    function toggleSidebar() {
      const sidebar = document.getElementById('sidebar');
      const overlay = document.getElementById('overlay');
      sidebar.classList.toggle('open');
      overlay.classList.toggle('open');
    }
  </script>
</body>
</html>
```

### Required Sidebar CSS

```css
.side-menu {
  position: fixed;
  top: 56px;
  left: -280px;
  width: 280px;
  height: calc(100vh - 56px);
  background: var(--surface);
  box-shadow: 2px 0 8px rgba(0,0,0,0.1);
  transition: left 0.3s ease;
  z-index: 999;
  padding: 16px;
  overflow-y: auto;
}
.side-menu.open { left: 0; }

.sidebar-overlay {
  position: fixed;
  top: 56px;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.5);
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.3s;
  z-index: 998;
}
.sidebar-overlay.open {
  opacity: 1;
  visibility: visible;
}

.menu-toggle {
  background: none;
  border: none;
  color: white;
  font-size: 24px;
  cursor: pointer;
  padding: 8px;
}
```

### Navigation Placement Rules

1. **Header**: MUST be fixed at top, visible while scrolling
2. **Bottom Nav**: MUST be fixed at bottom, visible while scrolling
3. **Side Menu**: MUST slide out from left when menu button clicked
4. **FAB**: MUST be fixed above bottom nav (bottom: 80px)
5. **Main Content**: MUST have top/bottom margins to prevent overlap with fixed elements

### Component Demo Sections

Within `<main>`, organize component demos by category:
- Color Palette
- Typography
- Navigation (show demos of header/nav variants, NOT the fixed ones)
- Buttons
- Form Elements
- Content (cards, list items, avatars, etc.)
- Feedback (modal, toast, loading, etc.)
- Layout Components
- Media
- Icons

## Structure

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    :root {
      /* Color tokens */
      /* Typography tokens */
      /* Spacing tokens */
    }
    /* Component styles */
  </style>
</head>
<body>
  <!-- Fixed header -->
  <!-- Slide-out sidebar -->
  <!-- Main content with component demos -->
  <!-- Fixed FAB -->
  <!-- Fixed bottom nav -->
  <!-- Toggle script -->
</body>
</html>
```
