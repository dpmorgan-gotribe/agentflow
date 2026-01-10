# Design Flow Mockup

Create a visual representation of a user flow.

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
- Include postamble like "This mockup includes..." or "Let me know if..."

## Content Requirements

Single HTML file showing:
- All screens in the flow (simplified)
- Arrows between screens
- User actions annotated
- Data requirements noted

## Template

Your output MUST start exactly like this (no text before):

```html
<!DOCTYPE html>
<html>
<head>
  <title>Flow: [Name]</title>
  <style>
    /* Flow layout styles */
  </style>
</head>
<body>
  <h1>Flow: [Name]</h1>
  <div class="flow">
    <div class="screen" id="screen-[name]">
      <!-- Simplified screen -->
    </div>
    <div class="arrow">→</div>
    <!-- More screens -->
  </div>
</body>
</html>
```

Your output MUST end with `</html>` (no text after).
