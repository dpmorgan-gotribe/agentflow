# Design Stylesheet - Webapp (Responsive Web)

Create a complete design system optimized for **responsive web applications**.

## Platform Context: Webapp

This stylesheet targets responsive web layouts with:
- **Breakpoints**: Mobile-first (320px, 768px, 1024px, 1440px)
- **Interactions**: Hover states, focus indicators, transitions
- **Accessibility**: WCAG 2.1 AA compliance, keyboard navigation
- **Layout**: CSS Grid, Flexbox, responsive containers

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

## Webapp-Specific CSS Requirements

### Responsive Breakpoints (REQUIRED)

```css
:root {
  /* Base (mobile-first) */
  --container-width: 100%;
  --grid-columns: 1;
}

@media (min-width: 768px) {
  :root {
    --container-width: 720px;
    --grid-columns: 2;
  }
}

@media (min-width: 1024px) {
  :root {
    --container-width: 960px;
    --grid-columns: 3;
  }
}

@media (min-width: 1440px) {
  :root {
    --container-width: 1200px;
    --grid-columns: 4;
  }
}

.container {
  max-width: var(--container-width);
  margin: 0 auto;
  padding: 0 16px;
}
```

### Hover States (REQUIRED)

All interactive elements MUST have hover states:

```css
.button:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

.card:hover {
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
}

.nav-item:hover {
  background: var(--hover-bg);
}

/* Disable hover on touch devices */
@media (hover: none) {
  .button:hover {
    transform: none;
    box-shadow: none;
  }
}
```

### Focus States (REQUIRED for Accessibility)

```css
:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.button:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

/* Skip link for keyboard users */
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
  background: var(--primary);
  color: white;
  padding: 8px 16px;
  z-index: 9999;
}
.skip-link:focus {
  top: 0;
}
```

### Transitions

```css
* {
  transition: background-color 0.2s, color 0.2s, transform 0.2s, box-shadow 0.2s;
}
```

## Content Requirements

HTML file containing:
- CSS variables (colors, fonts, spacing, breakpoints)
- Responsive grid system
- All component styles with hover/focus states
- Component showcase/examples
- Interactive states (hover, active, focus, disabled)
- **ALL components must have working HTML demos**
- **Icon gallery section**
- **Real placeholder images for media components**

## Responsive Navigation

### Desktop: Horizontal header with dropdown menus
### Tablet: Collapsible hamburger menu
### Mobile: Bottom navigation bar

```css
/* Desktop header */
@media (min-width: 1024px) {
  .header {
    padding: 0 24px;
  }
  .nav-desktop { display: flex; }
  .nav-mobile { display: none; }
  .bottom-nav { display: none; }
}

/* Mobile: bottom nav */
@media (max-width: 1023px) {
  .nav-desktop { display: none; }
  .bottom-nav { display: flex; }
}
```

## Structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      /* Color tokens */
      /* Typography tokens */
      /* Spacing tokens */
      /* Breakpoint tokens */
    }
    /* Responsive base styles */
    /* Component styles with hover/focus */
  </style>
</head>
<body>
  <!-- Skip link for accessibility -->
  <a href="#main" class="skip-link">Skip to main content</a>

  <!-- Responsive header -->
  <header class="header">...</header>

  <!-- Main content with component demos -->
  <main id="main" class="container">
    <!-- Responsive grid demos -->
    <!-- Component demos with hover states -->
  </main>

  <!-- Footer -->
  <footer>...</footer>
</body>
</html>
```
