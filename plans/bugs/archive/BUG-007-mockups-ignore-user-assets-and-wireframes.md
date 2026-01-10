# BUG-007: Mockups Ignore User Assets and Wireframes

## Problem
Generated mockups fail to use user-provided assets:
1. None of the mockups use the user's logo from `assets/logos/`
2. Style-0 doesn't use icons from `assets/icons/`
3. Style-0 doesn't reference wireframe styling (layout hints, not exact match)
4. Style 1+ don't have icon library recommendations/download links

## Context
- **Affected Commands**: `agentflow analyze`, `agentflow mockups`
- **Affected Files**:
  - `src/commands/analyze.ts` - assets worker
  - `src/commands/mockups.ts` - doesn't load assets
  - `src/templates/skills/analysis/analyze-assets.md` - skill output mismatch
  - `src/templates/skills/design/design-mockup.md` - missing asset rules

## Root Cause Analysis

### Issue 1: assets.md output format mismatch
The `analyze-assets.md` skill defines a structured format:
```markdown
# Asset Inventory
## Existing Assets
### Logos
| File | Dimensions | Format | Location |
...
## Style 0 Assets (User's Vision)
## Style 1 Assets ([Style Name])
```

But actual output contains full style analysis (colors, typography, spacing) instead of asset inventory. The skill isn't being followed.

### Issue 2: mockups.ts doesn't load assets
```typescript
// Current - only loads these:
stylesContent = await readFile(join(..., 'styles.md'));
componentsContent = await readFile(join(..., 'components.md'));
inspirationsContent = await readFile(join(..., 'inspirations.md'));

// Missing:
// - assets.md
// - Direct scan of assets/ directory
```

### Issue 3: No distinction between all-style and style-0 assets
- Logo: ALL mockups should use user's logo if provided
- Icons: Style-0 uses existing icons, Style 1+ get recommendations
- Wireframes: Style-0 references for layout hints (not exact match)

## Implementation Steps

### 1. Fix analyze-assets.md skill to enforce structured output
Update the skill to emphasize it must output the inventory format, NOT style analysis.

### 2. Update mockups.ts to load assets and scan directories

```typescript
// Load assets.md
let assetsContent = '';
try {
  assetsContent = await readFile(
    join(projectDir, 'outputs', 'analysis', 'assets.md'),
    'utf-8'
  );
} catch {
  // Continue without assets
}

// Scan actual asset directories
async function scanAssets(projectDir: string) {
  const scan = async (subdir: string) => {
    try {
      return await readdir(join(projectDir, 'assets', subdir));
    } catch {
      return [];
    }
  };

  return {
    logos: await scan('logos'),
    icons: await scan('icons'),
    wireframes: await scan('wireframes')
  };
}

const userAssets = await scanAssets(projectDir);
```

### 3. Include assets in ALL mockup prompts

```typescript
// Build asset section for all styles
const logoSection = userAssets.logos.length > 0
  ? `## User Logo (USE THIS)
The user has provided a logo. You MUST use it in the mockup:
${userAssets.logos.map(f => `- ../../assets/logos/${f}`).join('\n')}

Include the logo in the header/navigation area using:
<img src="../../assets/logos/${userAssets.logos[0]}" alt="Logo" class="logo" />
`
  : '';

// Add to all worker prompts
userPrompt: `Create a mockup for Style ${i}.

CRITICAL: Output ONLY raw HTML. Start with <!DOCTYPE html> and end with </html>.
No explanations. No descriptions. No markdown. Just complete, valid HTML.

${logoSection}

${i === 0 ? style0AssetSection : styleNAssetSection}
...`
```

### 4. Differentiate Style-0 vs Style 1+ asset handling

**Style-0 (User's Vision):**
```typescript
const style0AssetSection = `
## Style-0 Asset Instructions
- Use user's existing icons from assets/icons/ where appropriate
- Reference wireframes for LAYOUT HINTS (not exact match - wireframes may be incomplete)
- Available icons: ${userAssets.icons.map(f => `../../assets/icons/${f}`).join(', ')}
- Wireframe files for reference: ${userAssets.wireframes.join(', ')}
`;
```

**Style 1+ (Research-inspired):**
```typescript
const styleNAssetSection = `
## Style ${i} Asset Instructions
- Download or reference icons from recommended icon library in assets.md
- Use the style's recommended color palette and typography
- Include download links in HTML comments for any external assets
`;
```

### 5. Update design-mockup.md skill

Add to Key Rules:
```markdown
## Asset Usage Rules
- ALL styles: MUST use user's logo if provided (in header/navigation)
  - Use relative path: ../../assets/logos/[filename]
  - Include as <img> tag with appropriate sizing
- Style 0: Use existing icons from ../../assets/icons/
- Style 0: Reference wireframes for layout hints (not exact match)
- Style 1+: Reference icon library recommendations from assets.md
- Include download links as HTML comments: <!-- Icon library: https://... -->
```

### 6. Update analyze phase to properly output assets.md

In `analyze.ts`, ensure the assets worker is passing correct context and the skill output format is enforced in the prompt.

## Testing
- [ ] assets.md outputs structured inventory format (not style analysis)
- [ ] ALL mockups use user's logo from assets/logos/
- [ ] Style-0 uses icons from assets/icons/
- [ ] Style-0 references wireframes for layout (not exact match)
- [ ] Style 1+ include icon library recommendations
- [ ] Asset paths work when opening HTML in browser

## Rollback Plan
1. Revert mockups.ts, design-mockup.md, analyze-assets.md
2. `npm run build && cp -r src/templates dist/`
