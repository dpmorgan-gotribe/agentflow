# Analyze Assets

Inventory existing user assets and recommend new ones for each style.

## Output Requirements

OUTPUT ONLY RAW MARKDOWN. No explanations. No descriptions.

Your response must:
- Start with: `# Asset Inventory`
- Be valid Markdown content
- Follow the output format below exactly

DO NOT:
- Explain what you're creating
- Ask for permission
- Wrap in markdown code fences (```)
- Add any text before or after the markdown
- Say "Now I have..." or "Let me..." or "Here's the..."

**CRITICAL: This skill outputs an ASSET INVENTORY, not style analysis.**
Do NOT output colors, typography definitions, or spacing systems - those belong in styles.md.

## Inputs
- Project brief (brand references)
- Assets folder (existing files)
- Competitive research (asset patterns)
- Number of styles: {styleCount}

## Process

1. **Inventory Existing**:
   - Scan assets/logos/ for logo files (list actual filenames)
   - Scan assets/icons/ for icon files (list actual filenames)
   - Scan assets/fonts/ for font files
   - List wireframes in assets/wireframes/

2. **Extract from Brief**:
   - Any mentioned asset paths
   - Brand guidelines references
   - Preferred fonts or icon styles

3. **Create Per-Style Asset Recommendations**:
   - For Style 0: Document user's existing assets with paths
   - For Style 1+: Recommend icon libraries and fonts with download links

4. **Provide Download Links**:
   - Google Fonts URLs for typography
   - Icon library links (Lucide, Heroicons, Phosphor)
   - Color palette generators

## CRITICAL OUTPUT RULES
- Output ONLY asset inventory following the format below
- Do NOT include color palettes, typography scales, or spacing systems
- Do NOT duplicate content from styles.md
- Focus on: file paths, download links, icon library recommendations

## Output Format

```markdown
# Asset Inventory

## Existing Assets

### Logos
| File | Dimensions | Format | Location |
|------|------------|--------|----------|
| [name] | [WxH] | [PNG/SVG] | assets/logos/ |

### Icons (Existing)
[List any existing icons or "None found"]

### Fonts (Existing)
[List any existing fonts or "None found"]

### Wireframes
| File | Description |
|------|-------------|
| [name.png] | [What screen it shows] |

---

## Style 0 Assets (User's Vision)

### Fonts
| Usage | Font | Download |
|-------|------|----------|
| Headings | [From brief or inferred] | https://fonts.google.com/specimen/[Font] |
| Body | [From brief or inferred] | https://fonts.google.com/specimen/[Font] |

### Icons
**Recommended Library**: [Based on brief tone]
**Link**: [Icon library URL]
**Key Icons Needed**: [list based on wireframes]

### Color Palette
```json
{
  "primary": "#XXXXXX",
  "secondary": "#XXXXXX",
  "accent": "#XXXXXX",
  "background": "#XXXXXX",
  "surface": "#XXXXXX"
}
```

---

## Style 1 Assets ([Style Name])

### Fonts
| Usage | Font | Download |
|-------|------|----------|
| Headings | [From competitor research] | https://fonts.google.com/specimen/[Font] |
| Body | [From competitor research] | https://fonts.google.com/specimen/[Font] |

### Icons
**Recommended Library**: [Matching competitor style]
**Link**: [Icon library URL]

### Color Palette
```json
{
  "primary": "#XXXXXX",
  "secondary": "#XXXXXX",
  "accent": "#XXXXXX",
  "background": "#XXXXXX",
  "surface": "#XXXXXX"
}
```

---

## Style N Assets ([Style Name])
...

---

## Icon Libraries Reference

| Library | Style | Link | Best For |
|---------|-------|------|----------|
| Lucide | Minimal line | https://lucide.dev | Clean, modern apps |
| Heroicons | Solid/outline | https://heroicons.com | Versatile, popular |
| Phosphor | Multiple weights | https://phosphoricons.com | Flexible styling |
| Feather | Thin line | https://feathericons.com | Minimal interfaces |
| Tabler | Line icons | https://tabler-icons.io | Dashboard/admin |

## Missing Assets (Action Required)
- [ ] [Asset type]: [What's needed, where to get it]
```

## Notes

- Each style gets its own asset recommendations section
- Style 0 uses user's existing assets + recommendations to fill gaps
- Style 1+ uses research-inspired assets with download links
- All font links should be valid Google Fonts URLs
- Do NOT include JSON color palettes - those belong in styles.md
- Focus on actionable asset links and file paths
