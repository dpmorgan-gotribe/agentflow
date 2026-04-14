# User-Supplied Assets

Drop your brand assets into the appropriate subdirectories below. The pipeline will detect and use them automatically. **User assets always override generated or researched assets.**

## Directory Structure

```
assets/
├── logos/
│   ├── primary.svg            # Main logo (required if any logos present)
│   ├── mark.svg               # Icon-only version
│   └── wordmark.svg           # Text-only version
├── icons/                     # Custom icons (SVG preferred)
├── fonts/                     # .woff2 / .ttf / .otf files
├── images/
│   ├── hero/                  # Hero images per screen
│   ├── backgrounds/
│   └── placeholders/
├── wireframes/                # PNG/PDF wireframes — UI Designer reads as layout blueprints
│   ├── admin-dashboard.png    # Name should match screen ID
│   └── mobile-home.png
├── brand-guides/              # Brand guideline PDFs to extract from
│   └── brand-guide.pdf
└── colors.json                # Explicit color palette override
```

## Guidelines

- **Logos**: SVG preferred. Include at minimum `primary.svg`.
- **Icons**: SVG format. Name them by function (e.g., `search.svg`, `profile.svg`).
- **Fonts**: Include all weight variants you need (e.g., `acme-sans-400.woff2`, `acme-sans-700.woff2`).
- **Wireframes**: Name files to match your screen IDs from the navigation schema. The UI Designer will use them as layout blueprints while applying your brand styling.
- **Brand guides**: PDF format. The Analyst will extract colors, typography, spacing, and voice guidelines.
- **colors.json**: Simple JSON with hex values:
  ```json
  {
    "primary": "#6B9B37",
    "secondary": "#14b8a6",
    "accent": "#f59e0b",
    "background": "#ffffff",
    "foreground": "#0f172a"
  }
  ```

## What Happens

1. The `/scan-assets` skill catalogs everything here into `docs/asset-inventory.json`
2. If logos exist but no colors.json, colors are extracted from the logo
3. If brand-guide PDFs exist, they're parsed for design rules
4. The UI Designer checks the inventory before generating any screen

## If This Directory Is Empty

No problem. The pipeline falls back to researched or generated assets without complaint.
