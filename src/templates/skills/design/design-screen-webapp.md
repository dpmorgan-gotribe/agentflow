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
