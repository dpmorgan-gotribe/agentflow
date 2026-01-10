# BUG-003: Missing Project Brief in Project Initialization

## Problem
When initializing a new AgenticFlow project, there is no mechanism to capture a project brief. The analyst operates blindly on wireframes without understanding the product vision.

## Key Insight: The Brief is Consumed by Analysis

After deep consideration, the correct architecture is:

```
brief.md (user input)
    ↓
ANALYST (consumes brief + wireframes)
    ↓
outputs/analysis/
├── styles.md      ← Brand colors, typography, 3 style options
├── flows.md       ← User journeys extracted from brief
├── components.md  ← UI components from wireframes
└── assets.md      ← Logo path, icons, fonts
    ↓
*** BRIEF IS NOW "SPENT" ***
All its value is encoded in analysis outputs
    ↓
flows, mockups, stylesheet, screens
(read from analysis outputs, NOT brief)
```

**Why this is correct:**
1. The analyst's job IS to extract and structure the brief into usable outputs
2. Downstream agents need structured data, not raw requirements
3. No need for a separate "brief processor" - the analyst IS the processor
4. Simpler architecture, fewer moving parts

---

## The Decision Point: Style Selection

After exploration (flows, mockups), the user selects a style. This is when design decisions get **locked in**:

```
User runs: agentflow stylesheet --style=1
    ↓
Creates: outputs/stylesheet/showcase.html (design system)
    ↓
Updates: CLAUDE.md with locked-in design context
    ↓
screens command reads CLAUDE.md for context
```

**Why update CLAUDE.md?**
- It's already the project's source of truth
- Humans and AI both read it naturally
- Becomes a living document reflecting project state
- No new file types to track

---

## Solution Architecture

### Phase 1: Input
```
project/
├── brief.md              ← User's raw input (any format)
├── assets/
│   ├── wireframes/*.png  ← Visual reference
│   └── logos/*.png       ← Brand assets
└── CLAUDE.md             ← Project documentation
```

### Phase 2: Analysis (Analyst consumes brief)
```
agentflow analyze
    ↓
Analyst reads: brief.md + wireframes
    ↓
outputs/analysis/
├── styles.md       ← Extracts brand from brief, proposes 3 styles
├── flows.md        ← Maps user journeys from brief requirements
├── components.md   ← Inventories UI components from wireframes
└── assets.md       ← Documents logo/icon paths from brief + assets/
```

### Phase 3: Exploration (Brief no longer needed)
```
agentflow flows    → outputs/flows/*.html
agentflow mockups  → outputs/mockups/style-{1,2,3}.html
```

### Phase 4: Lock-in (Update project context)
```
agentflow stylesheet --style=1
    ↓
Creates: outputs/stylesheet/showcase.html
    ↓
Updates CLAUDE.md:
┌─────────────────────────────────────────────────┐
│ ## Design Context (Auto-generated)              │
│                                                 │
│ **Selected Style**: Style 1 - Wireframe Faithful│
│ **Primary Color**: #6DB33F                      │
│ **Secondary Color**: #2E7D32                    │
│ **Logo**: assets/logos/gotribe_transparent.png  │
│ **Design System**: outputs/stylesheet/showcase  │
│                                                 │
│ This section is updated by `agentflow stylesheet`│
└─────────────────────────────────────────────────┘
```

### Phase 5: Production
```
agentflow screens
    ↓
Reads: CLAUDE.md (design context) + showcase.html (CSS)
    ↓
outputs/screens/*.html
```

---

## Implementation Steps

### Phase 1: Brief Infrastructure (Minimal)

1. [ ] Create `src/templates/brief.md`:
```markdown
# Project Brief

Describe your project here. The analyst will extract what it needs.

Include whatever is relevant:
- What is being built and why
- Who will use it (audience, context, devices)
- Brand identity (name, colors, tone, logo location)
- Key features and user flows
- Technical constraints
- Design preferences

There is no required format. Write naturally, paste existing docs,
or structure it however makes sense for your project.

---

[Your brief here]
```

2. [ ] Modify `src/commands/init.ts`:
   - Copy brief.md template to project root
   - Update console output to mention editing brief.md

### Phase 2: Analyst Integration

3. [ ] Create `src/lib/brief.ts`:
```typescript
import { readFile } from 'fs/promises';
import { join } from 'path';

export async function loadBrief(projectDir: string): Promise<string | null> {
  try {
    const briefPath = join(projectDir, 'brief.md');
    return await readFile(briefPath, 'utf-8');
  } catch {
    return null;
  }
}
```

4. [ ] Modify `src/commands/analyze.ts`:
   - Load brief.md at start
   - Pass brief content to ALL analysis workers
   - Warn if brief.md is empty/missing (but continue)

```typescript
// In analyze.ts
const brief = await loadBrief(projectDir);
if (!brief || brief.includes('[Your brief here]')) {
  console.warn('Warning: brief.md is empty. Analysis will be based on wireframes only.');
}

// Pass to workers
userPrompt: `Analyze the wireframes and project brief.

## Project Brief
${brief || 'No brief provided.'}

## Wireframes
${images.join(', ')}

Produce output according to the skill.`
```

5. [ ] Update analysis skill templates to use brief:

**`analyze-styles.md`** - Extract brand from brief:
```markdown
# Analyze Styles

Extract visual style information from wireframes AND project brief.

## Process
1. **From Brief**: Extract brand colors, tone, style preferences
2. **From Wireframes**: Measure actual colors, spacing, typography
3. **Reconcile**: Align brief intent with wireframe reality
4. **Propose 3 Styles**:
   - Style 1: Wireframe Faithful (exact match)
   - Style 2: Brief-Aligned (honors brief preferences)
   - Style 3: Creative Interpretation

## Output Format
Include extracted brand info at top, then style options.
```

**`analyze-flows.md`** - Extract journeys from brief:
```markdown
# Analyze Flows

Map user journeys from wireframes AND project brief.

## Process
1. **From Brief**: Identify described user flows, features, entities
2. **From Wireframes**: Map visible screens and navigation
3. **Synthesize**: Create complete flow documentation

## Output
Document flows with: purpose, screens, user actions, data needs.
```

**`analyze-assets.md`** - Extract asset paths from brief:
```markdown
# Analyze Assets

Inventory assets from project AND brief references.

## Process
1. **From Brief**: Note any referenced logo paths, icon sets, fonts
2. **From Assets Folder**: Scan actual files in assets/
3. **Cross-reference**: Match brief references to actual files

## Output
Include logo path, icon inventory, font requirements.
```

### Phase 3: Style Lock-in (Update CLAUDE.md)

6. [ ] Create `src/lib/context.ts`:
```typescript
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

interface DesignContext {
  selectedStyle: string;
  primaryColor?: string;
  secondaryColor?: string;
  logoPath?: string;
  stylesheetPath: string;
}

export async function updateProjectContext(
  projectDir: string,
  context: DesignContext
): Promise<void> {
  const claudePath = join(projectDir, 'CLAUDE.md');
  let content = await readFile(claudePath, 'utf-8');

  // Remove existing design context section if present
  content = content.replace(/\n## Design Context[\s\S]*?(?=\n## |$)/, '');

  // Append new design context
  const contextSection = `

## Design Context (Auto-generated)

**Selected Style**: ${context.selectedStyle}
${context.primaryColor ? `**Primary Color**: ${context.primaryColor}` : ''}
${context.secondaryColor ? `**Secondary Color**: ${context.secondaryColor}` : ''}
${context.logoPath ? `**Logo**: ${context.logoPath}` : ''}
**Design System**: ${context.stylesheetPath}

_This section is updated automatically by \`agentflow stylesheet\`_
`;

  await writeFile(claudePath, content + contextSection);
}
```

7. [ ] Modify `src/commands/stylesheet.ts`:
   - After creating showcase.html, extract key design values
   - Call updateProjectContext() to update CLAUDE.md
   - Parse selected mockup for colors, check assets.md for logo path

```typescript
// After writing showcase.html
const assetsContent = await readFile(join(projectDir, 'outputs/analysis/assets.md'), 'utf-8');
const logoMatch = assetsContent.match(/Logo[:\s]+([^\n]+)/i);

await updateProjectContext(projectDir, {
  selectedStyle: `Style ${styleNum}`,
  primaryColor: extractPrimaryColor(result.output),
  logoPath: logoMatch?.[1]?.trim(),
  stylesheetPath: 'outputs/stylesheet/showcase.html'
});

console.log('Updated CLAUDE.md with design context');
```

### Phase 4: Update Templates

8. [ ] Update `src/templates/CLAUDE.md`:
```markdown
# Project Design System

This project uses AgenticFlow for design generation.

## Quick Start

1. Edit `brief.md` with your project requirements
2. Add wireframes to `assets/wireframes/`
3. Run the pipeline:

```bash
agentflow analyze     # Extracts styles, flows, components from brief
agentflow flows       # Creates flow mockups
agentflow mockups     # Creates 3 style options
agentflow stylesheet --style=N  # Locks in design system
agentflow screens     # Generates all screens
```

## Directory Structure

- `brief.md` - Project requirements (input for analyst)
- `agents/` - Agent definitions
- `skills/` - Skill documentation
- `assets/` - Wireframes, logos, icons, fonts
- `outputs/` - Generated designs

## Design Context

_This section will be auto-populated when you run `agentflow stylesheet`_
```

---

## Data Flow Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                         INPUT PHASE                              │
├─────────────────────────────────────────────────────────────────┤
│  brief.md (any format)  +  assets/wireframes/*.png              │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      ANALYSIS PHASE                              │
│                   (Brief is CONSUMED here)                       │
├─────────────────────────────────────────────────────────────────┤
│  Analyst reads brief + wireframes                               │
│  Outputs: styles.md, flows.md, components.md, assets.md         │
│                                                                 │
│  *** Brief value now encoded in analysis outputs ***            │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     EXPLORATION PHASE                            │
│                 (Uses analysis outputs only)                     │
├─────────────────────────────────────────────────────────────────┤
│  flows command  → outputs/flows/*.html                          │
│  mockups command → outputs/mockups/style-{1,2,3}.html           │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      LOCK-IN PHASE                               │
│               (Design decisions captured)                        │
├─────────────────────────────────────────────────────────────────┤
│  stylesheet --style=N                                           │
│  Creates: outputs/stylesheet/showcase.html                      │
│  Updates: CLAUDE.md with design context                         │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     PRODUCTION PHASE                             │
│              (Uses locked-in design context)                     │
├─────────────────────────────────────────────────────────────────┤
│  screens command                                                │
│  Reads: CLAUDE.md context + showcase.html CSS                   │
│  Outputs: outputs/screens/*.html                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## What We're NOT Building

❌ `brief-context.json` - Not needed, analyst handles raw brief
❌ `agentflow brief` command - Not needed, analysis IS brief processing
❌ Brief processor agent - Not needed, analyst IS the processor
❌ `extract-context.md` skill - Not needed, analysis skills do this

## What We ARE Building

✅ `brief.md` template - Simple guide for users
✅ `src/lib/brief.ts` - Load brief for analyst
✅ `src/lib/context.ts` - Update CLAUDE.md with design context
✅ Updated `analyze.ts` - Pass brief to workers
✅ Updated analysis skills - Extract from brief
✅ Updated `stylesheet.ts` - Lock in design context

---

## Testing

- [ ] **Init creates brief.md**: New project has brief.md template
- [ ] **Analysis uses brief**: Brief content appears in worker prompts
- [ ] **Analysis without brief**: Works but shows warning
- [ ] **Style lock-in**: stylesheet updates CLAUDE.md
- [ ] **Screens use context**: Design context available to screens
- [ ] **Full pipeline**: brief → analyze → flows → mockups → stylesheet → screens

## Rollback Plan

1. Remove `src/lib/brief.ts` and `src/lib/context.ts`
2. Revert analyze.ts (remove brief loading)
3. Revert stylesheet.ts (remove context update)
4. Revert skill templates
5. Remove brief.md from templates
6. Run `npm run build`
