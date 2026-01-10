# Analyze Styles

Generate {styleCount} distinct style options based on research and brief.

## Output Requirements

OUTPUT ONLY RAW MARKDOWN. No explanations. No descriptions.

Your response must:
- Start with: `# Style Analysis`
- Be valid Markdown content
- Follow the output format below exactly

DO NOT:
- Explain what you're creating
- Ask for permission
- Wrap in markdown code fences (```)
- Add any text before or after the markdown
- Say "Now I have..." or "Let me..." or "Here's the..."

## Inputs
- Project brief (brand context, preferences)
- Wireframes (layout patterns)
- Competitive research (from research.md)
- Number of styles to generate: {styleCount}

## Process

1. **Style 0 - User's Vision**:
   - Based on user's brief AND wireframe layouts
   - Colors: From brief brand guidelines (NOT from wireframes - wireframe colors are grayscale placeholders)
   - Layout: Extract navigation patterns, screen structure, component placement from wireframes
   - Icons: Document available user icons from assets/icons/
   - This is "the user's actual design vision"

2. **Style 1..N - Research-Inspired**:
   - Each style inspired by a different competitor from research
   - Style 1 takes cues from Competitor 1
   - Style 2 takes cues from Competitor 2
   - Each should be meaningfully different
   - These styles use library icons (Lucide, Heroicons, etc.)

3. **For Each Style, Define**:
   - Color palette (primary, secondary, accent, backgrounds, text)
   - Typography (heading font, body font, scale)
   - Spacing system (base unit, scale)
   - Visual characteristics

4. **Style 0 ONLY - Also Include**:
   - Layout patterns from wireframes (navigation, screen structure)
   - User icon inventory with paths
   - IMPORTANT: Wireframe colors are placeholders - define colors from brief only

## Output Format

```markdown
# Style Analysis

## Brand Context
(From brief: name, tone, any specified colors/fonts/preferences)

## Research Insights
(Key learnings from competitive analysis)

---

## Style 0: User's Vision
**Based on**: User's brief and wireframe layouts
**Personality**: [2-3 word description]

### Layout Patterns (from wireframes)
IMPORTANT: These patterns come from analyzing wireframes. Wireframe COLORS are placeholders - ignore them.

- **Navigation**: [Describe navigation pattern - e.g., "Bottom tab bar with 5 tabs: Home, Discover, Tribes, Chat, Profile"]
- **Header**: [Describe header pattern - e.g., "Fixed header with hamburger menu, logo, and icon buttons"]
- **Screen Structure**: [Describe main content patterns - e.g., "Card-based layouts, list views with avatars"]
- **Key Screens**: [List main screens identified - e.g., "Home feed, Search/Discover, Profile, Settings"]

### User Icons (from assets/icons/)
Use these icons for Style 0 mockups:
- home.svg - Home/Feed navigation
- search.svg - Search/Discover
- [icon-name].svg - [intended use]
(List all available icons from assets/icons/)

### Colors (from brief - NOT wireframes)
- Primary: #XXXXXX - [color name] - [why this fits the brief]
- Secondary: #XXXXXX - [color name]
- Accent: #XXXXXX - [color name]
- Background: #XXXXXX
- Surface: #XXXXXX
- Text Primary: #XXXXXX
- Text Secondary: #XXXXXX
- Error: #DC2626
- Success: #16A34A

### Typography
- Headings: [Font Name] - https://fonts.google.com/specimen/[FontName]
- Body: [Font Name] - https://fonts.google.com/specimen/[FontName]
- Scale: 12 / 14 / 16 / 20 / 24 / 32 / 48

### Spacing
- Base unit: 4px
- Scale: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64

### Characteristics
- [Key characteristic 1]
- [Key characteristic 2]
- [Key characteristic 3]

---

## Style 1: [Creative Name]
**Inspired by**: [Competitor 1 name from research]
**Personality**: [2-3 word description]

### Colors
- Primary: #XXXXXX - [color name]
- Secondary: #XXXXXX - [color name]
- Accent: #XXXXXX - [color name]
- Background: #XXXXXX
- Surface: #XXXXXX
- Text Primary: #XXXXXX
- Text Secondary: #XXXXXX
- Error: #DC2626
- Success: #16A34A

### Typography
- Headings: [Font Name] - https://fonts.google.com/specimen/[FontName]
- Body: [Font Name] - https://fonts.google.com/specimen/[FontName]
- Scale: [sizes]

### Spacing
- Base unit: [4px or 8px]
- Scale: [values]

### Characteristics
- [Characteristic from competitor]
- [Characteristic from competitor]

---

## Style N: [Creative Name]
...
```

## Notes

- Style 0 is ALWAYS the user's vision based on their brief
- Style 1+ are research-inspired alternatives
- Each style must have complete, usable color/font/spacing values
- Google Fonts links should be real, valid URLs
- Colors must be valid hex codes
