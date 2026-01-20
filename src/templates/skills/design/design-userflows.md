# Design Userflows Diagram

Generate an interactive HTML page showing userflows with navigation zone box diagrams.

## Output Requirements

OUTPUT ONLY RAW HTML. No explanations. No descriptions.

Your response must:
- Start with `<!DOCTYPE html>`
- End with `</html>`
- Be valid HTML with inline CSS and JavaScript
- Be directly viewable in a browser

DO NOT:
- Explain what you're creating
- Ask for permission
- Wrap in markdown code fences
- Add any text before or after the HTML
- Include external dependencies (all CSS/JS must be inline)

## Purpose

This diagram is for **structural validation**, not visual design. The goal is to:
- Verify navigation architecture is correct
- Ensure sidemenu/header/footer states make sense
- Identify disconnected screens
- Validate flow sequences before full mockups

## Layout Structure

```
+------------------------------------------------------------------+
| [App Tabs: Webapp | Mobile | Backend]                            |
+------------------------------------------------------------------+
| [Flow Tabs: Onboarding | Discovery | Tribe Management | ...]     |
+------------------------------------------------------------------+
|                                                                  |
| +--------+     +--------+     +--------+     +--------+          |
| |[Header]| --> |[Header]| --> |[Header]| --> |[Header]|          |
| |--------|     |--------|     |--------|     |--------|          |
| |[Side?] |     |        |     |[Side?] |     |        |          |
| |Content |     |Content |     |Content |     |Content |          |
| |--------|     |--------|     |--------|     |--------|          |
| |[Footer]|     |[Footer]|     |[Footer]|     |[Footer]|          |
| +--------+     +--------+     +--------+     +--------+          |
|   Login         Signup       Profile Setup      Home             |
+------------------------------------------------------------------+
```

## Box Diagram Specifications

Each screen is shown as a box with navigation zones:

### Header Zone (top)
- Light gray background (#f0f0f0)
- Show variant name (standard, minimal, hidden)
- Show action icons if any (e.g., "search, notifications")
- If hidden: dashed border, no fill

### Sidemenu Zone (left side, optional)
- Only show if `sidemenu.visible: true`
- Light blue background (#e3f2fd)
- Show active section name
- Width: ~60px

### Content Zone (center)
- White background
- Show screen name in bold
- Show 2-3 key components as small text
- Height: ~80px, Width: ~120px

### Footer Zone (bottom)
- Light gray background (#f0f0f0)
- Show variant name (tab-bar, minimal, hidden)
- Show active tab if any
- If hidden: dashed border, no fill

### Arrow Connectors
- Use CSS arrows or SVG lines between screens
- Arrows point from left to right in the flow sequence
- Arrow color: #666

## Color Coding

- Active tab/section: Brand primary color (#2196F3)
- Hidden zones: Dashed border (#ccc), no background fill
- Orphaned screens: Red border (#f44336) with "orphan" badge
- Normal zones: Light gray (#f0f0f0)
- Sidemenu: Light blue (#e3f2fd)

## Interactivity (JavaScript)

1. **App Tabs**
   - Click tab to filter to that app's flows
   - Highlight active app tab

2. **Flow Tabs**
   - Click flow to show its screen sequence
   - Highlight active flow tab

3. **Screen Hover**
   - Show tooltip with full navigation state JSON
   - Highlight the screen box

## HTML Structure Example

```html
<!DOCTYPE html>
<html>
<head>
  <title>Userflows - [Project Name]</title>
  <style>
    * { box-sizing: border-box; font-family: -apple-system, sans-serif; }
    body { margin: 0; padding: 20px; background: #fafafa; }

    .app-tabs, .flow-tabs {
      display: flex; gap: 8px; margin-bottom: 16px;
    }
    .tab {
      padding: 8px 16px; border-radius: 4px; cursor: pointer;
      background: #e0e0e0; border: none;
    }
    .tab.active { background: #2196F3; color: white; }

    .flow-diagram {
      display: flex; align-items: center; gap: 16px;
      padding: 24px; background: white; border-radius: 8px;
      overflow-x: auto;
    }

    .screen-box {
      display: flex; flex-direction: column;
      border: 2px solid #ccc; border-radius: 8px;
      overflow: hidden; min-width: 140px;
    }
    .screen-box.orphan { border-color: #f44336; }

    .header-zone, .footer-zone {
      padding: 4px 8px; font-size: 11px; color: #666;
      background: #f0f0f0;
    }
    .header-zone.hidden, .footer-zone.hidden {
      background: transparent; border: 1px dashed #ccc;
    }

    .content-row { display: flex; }
    .sidemenu-zone {
      width: 50px; padding: 8px 4px; font-size: 10px;
      background: #e3f2fd; text-align: center;
    }
    .content-zone {
      flex: 1; padding: 12px; min-height: 80px;
      display: flex; flex-direction: column; justify-content: center;
    }
    .screen-name { font-weight: 600; font-size: 13px; }
    .components { font-size: 10px; color: #888; margin-top: 4px; }

    .arrow {
      font-size: 24px; color: #666;
    }

    .tooltip {
      position: absolute; background: #333; color: white;
      padding: 8px 12px; border-radius: 4px; font-size: 11px;
      max-width: 300px; z-index: 100; display: none;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <h1>Userflows Diagram</h1>

  <div class="app-tabs">
    <button class="tab active" data-app="webapp">Webapp</button>
    <button class="tab" data-app="mobile">Mobile</button>
    <button class="tab" data-app="backend">Backend</button>
  </div>

  <div class="flow-tabs">
    <button class="tab active" data-flow="onboarding">Onboarding</button>
    <button class="tab" data-flow="discovery">Discovery</button>
    <!-- More flow tabs -->
  </div>

  <div class="flow-diagram" id="flow-onboarding">
    <div class="screen-box">
      <div class="header-zone">minimal</div>
      <div class="content-row">
        <div class="content-zone">
          <div class="screen-name">Login</div>
          <div class="components">form-input, button-primary</div>
        </div>
      </div>
      <div class="footer-zone hidden">hidden</div>
    </div>

    <div class="arrow">→</div>

    <div class="screen-box">
      <div class="header-zone">minimal</div>
      <div class="content-row">
        <div class="content-zone">
          <div class="screen-name">Signup</div>
          <div class="components">form-input, checkbox</div>
        </div>
      </div>
      <div class="footer-zone hidden">hidden</div>
    </div>

    <div class="arrow">→</div>

    <div class="screen-box">
      <div class="header-zone">standard | notifications</div>
      <div class="content-row">
        <div class="content-zone">
          <div class="screen-name">Home</div>
          <div class="components">card, filter-pills</div>
        </div>
      </div>
      <div class="footer-zone">tab-bar | home</div>
    </div>
  </div>

  <div class="tooltip" id="tooltip"></div>

  <script>
    // Tab switching
    document.querySelectorAll('.app-tabs .tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.app-tabs .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        // Filter flows by app
      });
    });

    document.querySelectorAll('.flow-tabs .tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.flow-tabs .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        // Show corresponding flow diagram
      });
    });

    // Tooltip on hover
    document.querySelectorAll('.screen-box').forEach(box => {
      box.addEventListener('mouseenter', (e) => {
        const tooltip = document.getElementById('tooltip');
        const navState = box.dataset.navState || 'No navigation state';
        tooltip.textContent = navState;
        tooltip.style.display = 'block';
        tooltip.style.left = e.pageX + 10 + 'px';
        tooltip.style.top = e.pageY + 10 + 'px';
      });
      box.addEventListener('mouseleave', () => {
        document.getElementById('tooltip').style.display = 'none';
      });
    });
  </script>
</body>
</html>
```

## Input Data Format

You will receive:
1. **Screen Data** - JSON with screens, userflows, components per platform
2. **Navigation Schema** - YAML with apps, sections, navigation states

Parse this data to generate the appropriate tabs, flows, and screen boxes.

## Key Points

- Keep it minimal - this is for structure validation, not visual design
- Focus on navigation zones, not detailed content
- Make sure orphaned screens are clearly marked
- Include all flows from all apps
- Show navigation state changes clearly (sidemenu appearing/disappearing, footer hiding)
