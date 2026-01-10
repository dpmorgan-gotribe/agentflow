# BUG-004: Analyst Skills Lack Research Intelligence

## Problem
The current analyst skills are too simplistic - they only do basic extraction from wireframes and brief without any external research, competitive analysis, or intelligent suggestions.

---

## Complete Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER INPUTS                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  brief.md              - Project requirements, brand info, goals            │
│  assets/wireframes/    - User's wireframe images                            │
│  assets/logos/         - User's existing brand assets                       │
│  [styleCount]          - How many styles to research (default: 1)           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         COMMAND: agentflow analyze [N]                       │
│                              (Analyst Agent)                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  PHASE 1: Research (Sequential - runs first)                                │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  research worker                                                        │ │
│  │  - Identifies app category from brief                                   │ │
│  │  - Web searches for N top competitors                                   │ │
│  │  - Analyzes competitor features, flows, visual styles                   │ │
│  │  - Extracts best practices                                              │ │
│  │  → outputs/analysis/research.md                                         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    ▼                                         │
│  PHASE 2: Analysis (Parallel - 5 workers, all receive research.md)          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                         │
│  │    styles    │ │    flows     │ │    assets    │                         │
│  │              │ │              │ │              │                         │
│  │ Style 0:     │ │ Flows from   │ │ Per-style    │                         │
│  │  User brief  │ │ brief +      │ │ asset lists: │                         │
│  │  & assets    │ │ wireframes   │ │              │                         │
│  │              │ │              │ │ style-0/     │                         │
│  │ Style 1..N:  │ │ + Suggested  │ │  fonts/      │                         │
│  │  Research-   │ │ flows from   │ │  icons/      │                         │
│  │  inspired    │ │ competitors  │ │  palette     │                         │
│  │              │ │              │ │              │                         │
│  │              │ │              │ │ style-1/     │                         │
│  │              │ │              │ │  fonts/      │                         │
│  │              │ │              │ │  icons/      │                         │
│  │              │ │              │ │  palette     │                         │
│  └──────────────┘ └──────────────┘ └──────────────┘                         │
│  ┌──────────────┐ ┌──────────────┐                                          │
│  │  components  │ │ inspirations │                                          │
│  │              │ │              │                                          │
│  │ UI patterns  │ │ Mood board   │                                          │
│  │ from wires   │ │ Dribbble/    │                                          │
│  │              │ │ Behance refs │                                          │
│  │ Library recs │ │              │                                          │
│  └──────────────┘ └──────────────┘                                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ANALYSIS OUTPUTS                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  outputs/analysis/                                                           │
│  ├── research.md       ← Competitors, best practices, market gaps           │
│  ├── styles.md         ← Style 0 (user) + Style 1..N (research-based)       │
│  ├── flows.md          ← User journeys + suggested competitor flows         │
│  ├── assets.md         ← Per-style asset directories with download links    │
│  ├── components.md     ← Component inventory + library recommendations      │
│  └── inspirations.md   ← Mood board, design references                      │
│                                                                              │
│  assets/styles/        ← Downloaded/organized assets per style              │
│  ├── style-0/          (user's original assets, organized)                  │
│  │   ├── fonts/                                                              │
│  │   ├── icons/                                                              │
│  │   └── palette.json                                                        │
│  ├── style-1/          (research-inspired, downloaded)                      │
│  │   ├── fonts/                                                              │
│  │   ├── icons/                                                              │
│  │   └── palette.json                                                        │
│  └── style-N/                                                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         COMMAND: agentflow flows                             │
│                            (UI Designer Agent)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│  CONSUMES:                                                                   │
│  ├── outputs/analysis/flows.md        (user journeys, screen sequences)     │
│  ├── outputs/analysis/components.md   (what components exist)               │
│  └── assets/wireframes/               (visual reference)                    │
│                                                                              │
│  PRODUCES:                                                                   │
│  └── outputs/flows/                                                          │
│      ├── flow-onboarding.html         (interactive flow mockup)             │
│      ├── flow-core-action.html                                               │
│      └── flow-*.html                                                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        COMMAND: agentflow mockups                            │
│                            (UI Designer Agent)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│  CONSUMES:                                                                   │
│  ├── outputs/analysis/styles.md       (all style definitions)               │
│  ├── outputs/analysis/components.md   (component patterns)                  │
│  ├── outputs/analysis/inspirations.md (mood/references)                     │
│  ├── assets/styles/style-N/           (per-style assets)                    │
│  └── assets/wireframes/               (layout reference)                    │
│                                                                              │
│  PRODUCES:                                                                   │
│  └── outputs/mockups/                                                        │
│      ├── style-0.html                 (user's original direction)           │
│      ├── style-1.html                 (research-inspired option 1)          │
│      └── style-N.html                 (research-inspired option N)          │
│                                                                              │
│  USER REVIEWS MOCKUPS AND SELECTS ONE                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                          User selects style N
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   COMMAND: agentflow stylesheet --style=N                    │
│                            (UI Designer Agent)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│  CONSUMES:                                                                   │
│  ├── outputs/analysis/styles.md       (style N definition)                  │
│  ├── outputs/analysis/components.md   (all components to style)             │
│  ├── outputs/mockups/style-N.html     (selected mockup)                     │
│  └── assets/styles/style-N/           (fonts, icons, palette)               │
│                                                                              │
│  PRODUCES:                                                                   │
│  └── outputs/stylesheet/                                                     │
│      └── showcase.html                (complete design system)              │
│          - All components styled                                             │
│          - CSS variables                                                     │
│          - Typography scale                                                  │
│          - Color tokens                                                      │
│          - Spacing system                                                    │
│                                                                              │
│  UPDATES:                                                                    │
│  └── CLAUDE.md                        (locks in design context)             │
│      - Selected style name                                                   │
│      - Primary/secondary colors                                              │
│      - Font family                                                           │
│      - Path to stylesheet                                                    │
│                                                                              │
│  *** DESIGN DECISIONS NOW LOCKED ***                                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         COMMAND: agentflow screens                           │
│                            (UI Designer Agent)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│  CONSUMES:                                                                   │
│  ├── CLAUDE.md                        (locked design context)               │
│  ├── outputs/stylesheet/showcase.html (design system CSS)                   │
│  ├── outputs/analysis/flows.md        (screen sequences)                    │
│  ├── outputs/analysis/components.md   (component inventory)                 │
│  ├── outputs/flows/*.html             (flow mockups for reference)          │
│  └── assets/wireframes/               (layout reference)                    │
│                                                                              │
│  PRODUCES:                                                                   │
│  └── outputs/screens/                                                        │
│      ├── screen-home.html                                                    │
│      ├── screen-profile.html                                                 │
│      ├── screen-settings.html                                                │
│      └── screen-*.html                (all app screens, production-ready)   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Style Numbering Convention

| Style | Source | Assets | Description |
|-------|--------|--------|-------------|
| **Style 0** | User's brief + existing assets | `assets/styles/style-0/` | Faithful to what user provided |
| **Style 1** | Research competitor 1 | `assets/styles/style-1/` | Inspired by top competitor |
| **Style 2** | Research competitor 2 | `assets/styles/style-2/` | Inspired by 2nd competitor |
| **Style N** | Research competitor N | `assets/styles/style-N/` | Inspired by Nth competitor |

**Command**: `agentflow analyze [N]`
- `agentflow analyze` → 1 style (Style 0 only - user's direction)
- `agentflow analyze 3` → 3 styles (Style 0 + 2 research-inspired)
- `agentflow analyze 5` → 5 styles (Style 0 + 4 research-inspired)

---

## What Each Command Consumes & Produces

| Command | Consumes | Produces |
|---------|----------|----------|
| `analyze [N]` | brief.md, wireframes, logos | research.md, styles.md, flows.md, assets.md, components.md, inspirations.md, assets/styles/style-N/ |
| `flows` | flows.md, components.md, wireframes | outputs/flows/*.html |
| `mockups` | styles.md, components.md, inspirations.md, assets/styles/*, wireframes | outputs/mockups/style-N.html |
| `stylesheet --style=N` | styles.md (style N), components.md, mockups/style-N.html, assets/styles/style-N/ | outputs/stylesheet/showcase.html, updates CLAUDE.md |
| `screens` | CLAUDE.md, showcase.html, flows.md, components.md, flows/*.html, wireframes | outputs/screens/*.html |

---

## Key Changes from Current Implementation

### 1. Default Style Count: 1 (was 3)
```bash
agentflow analyze        # Default: 1 style (just Style 0)
agentflow analyze 3      # Generate 3 styles
```

### 2. Style 0 = User's Vision
- Always generated first
- Based purely on user's brief and assets
- No research influence
- Represents "what user asked for"

### 3. Style 1+ = Research-Inspired
- Each maps to a researched competitor
- Fonts/icons/palette downloaded per style
- Represents "what successful apps do"

### 4. Per-Style Asset Directories
```
assets/styles/
├── style-0/           # User's assets organized
│   ├── fonts/
│   ├── icons/
│   └── palette.json
├── style-1/           # Downloaded for research style 1
│   ├── fonts/         # Google Fonts files
│   ├── icons/         # Icon set files
│   └── palette.json   # Color definitions
```

### 5. Research Runs First (Sequential)
- Research worker runs before all others
- Output feeds into styles, flows, assets workers
- Ensures research insights inform everything

---

## Implementation Steps

### 1. Update CLI
**File**: `src/index.ts`
```typescript
program
  .command('analyze [styleCount]')
  .description('Analyze wireframes and research competitors')
  .action((styleCount) => analyze(parseInt(styleCount) || 1));
```

### 2. Create Research Skill
**File**: `src/templates/skills/analysis/analyze-research.md`

### 3. Update Styles Skill
- Style 0 always from user brief/assets
- Style 1..N from research competitors
- Each with full color/font/spacing definitions

### 4. Update Assets Skill
- Create per-style asset directories
- Download fonts from Google Fonts
- Download icon sets
- Generate palette.json files

### 5. Update Flows Skill
- Extract from brief + wireframes
- Add suggested flows from research

### 6. Update Components Skill
- Inventory from wireframes
- Add library recommendations

### 7. Create Inspirations Skill
- Mood board from research
- Dribbble/Behance references

### 8. Update analyze.ts
- Accept styleCount argument (default: 1)
- Run research first (sequential)
- Pass research to all parallel workers
- Create asset directories per style

---

## Testing

- [ ] `agentflow analyze` generates only Style 0
- [ ] `agentflow analyze 3` generates Style 0, 1, 2
- [ ] Style 0 matches user brief/assets
- [ ] Style 1+ inspired by research
- [ ] `assets/styles/style-N/` directories created
- [ ] mockups command creates one HTML per style
- [ ] stylesheet --style=0 uses user assets
- [ ] stylesheet --style=1 uses research assets
- [ ] screens command uses locked design from CLAUDE.md

## Rollback Plan

1. Revert to original 4-worker analyze.ts
2. Remove new skill files
3. Remove assets/styles/ directory structure
4. Revert CLI to no arguments
5. `npm run build`
