# Design Style Mockup

Create a single-page HTML preview of a style.

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

## Content

Single HTML file showing:
- Representative page with full styling
- Key components visible (cards, buttons, inputs, navigation)
- The "feel" of this style direction
- Multiple screen sections demonstrating the style

## Key Rules

- Style 0: User's vision - use existing icons, reference wireframes for layout hints
- Style 1+: Research-inspired creative alternatives
- All CSS in `<style>` tag
- No external dependencies (except Google Fonts via link tag)
- Use CSS variables for colors and spacing

## Asset Usage Rules

### Logo (ALL Styles)
- If user provided a logo, you MUST include it in the header/navigation
- Use the relative path: `../../assets/logos/[filename]`
- Include as `<img>` tag with appropriate sizing (typically 32-48px height)
- Example: `<img src="../../assets/logos/logo.png" alt="Logo" class="logo" />`

### Icons
- **Style 0**: Use user's existing icons from `../../assets/icons/`
- **Style 1+**: Use icons from a recommended library (Lucide, Heroicons, Phosphor)
  - Include a comment with download link: `<!-- Icons: https://lucide.dev -->`
  - Can use inline SVGs or reference icon library CDN

### Wireframes (Style 0 Only)
- Reference wireframes for LAYOUT HINTS only
- Wireframes may be incomplete - do not match exactly
- Use them to understand intended screen structure and navigation
