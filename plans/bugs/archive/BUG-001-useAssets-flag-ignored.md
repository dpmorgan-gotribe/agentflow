# BUG-001: --useAssets Flag Not Applied to All Analysis Workers

## Problem Summary

When running `agentflow analyze 10 --useAssets`, the flag is only partially applied. The expected behavior is that ALL 10 styles should be variations of the user's vision using the same colors and icons. Instead:

- `styles.md` - **Partially works**: Uses user colors but template format still says "Inspired by [Competitor]"
- `assets.md` - **Broken**: Shows competitor colors for Styles 1-9 (e.g., Mighty Networks purple #6B4FBB)
- No metadata marker (`<!-- assetMode: useAssets -->`) in output to confirm mode

## Root Cause Analysis

### Issue 1: `analyze.ts` Only Passes useAssets to "styles" Task

**File**: `src/commands/analyze.ts`
**Lines**: 195-296

The code builds worker tasks for `styles`, `assets`, and `inspirations`. However, the `useAssets` mode instruction is ONLY included for the `styles` task (lines 201-268):

```typescript
if (task.id === 'styles') {
  // ... useAssets handling here ...
} else {
  // Lines 269-287: NO useAssets handling!
  userPrompt = `Analyze the project...
    - Style 1-${styleCount - 1}: Based on competitor research above  // <-- WRONG
  `;
}
```

The `assets` and `inspirations` tasks receive a generic prompt that says "Style 1+: Based on competitor research" regardless of the `--useAssets` flag.

### Issue 2: analyze-styles.md Template Shows "Inspired by Competitor" for ALL Modes

**File**: `src/templates/skills/analysis/analyze-styles.md`
**Lines**: 145-172

The output format template for Style 1+ shows:

```markdown
## Style 1: [Creative Name]
**Inspired by**: [Competitor 1 name from research]
```

This template is NOT conditional on asset mode. Even when useAssets=true, Claude sees this example and may follow it. The template should show TWO variants:
- Standard mode: "Inspired by: [Competitor]"
- useAssets mode: "Variation: [Description]" with note that colors come from brief

### Issue 3: analyze-assets.md Has No Asset Mode Concept

**File**: `src/templates/skills/analysis/analyze-assets.md`
**Lines**: 109-130

The skill template explicitly shows Style 1+ should use competitor-inspired assets:

```markdown
## Style 1 Assets ([Style Name])
### Fonts
| Usage | Font | Download |
| Headings | [From competitor research] | ...
### Icons
**Recommended Library**: [Matching competitor style]
```

There's no conditional handling for useAssets mode.

### Issue 4: No Output Validation

After Claude generates output, there's no validation that:
1. The `<!-- assetMode: -->` metadata comment exists
2. The mode matches the flag that was passed
3. Colors in assets.md match colors in styles.md

## Evidence from Actual Output

**styles.md** (partially works):
```markdown
## Style 1: Compact & Efficient
**Based on**: User's assets with compact variation  <-- Good!
### Colors
- Primary: #6B9B37 - Earthy green  <-- Correct user color!
```

**assets.md** (broken):
```markdown
## Style 1 Assets (Mighty Networks - Professional Purple)
### Color Palette
{
  "primary": "#6B4FBB",  <-- WRONG! Should be #6B9B37
```

The styles worker received useAssets instructions, but the assets worker did not.

---

## Implementation Plan

### Step 1: Pass useAssets to ALL Analysis Workers

**File**: `src/commands/analyze.ts`

**Changes**:

1. **Extract asset mode instruction builder** (refactor lines 205-232):

```typescript
function buildAssetModeInstruction(useAssets: boolean, styleCount: number): string {
  if (useAssets) {
    return `## ASSET MODE: useAssets=true
ALL styles (0 through ${styleCount - 1}) MUST:
- Use user icons from assets/icons/ (paths listed below)
- Use colors from the brief (NOT research competitors)
- Fonts can vary between styles
- Spacing/density can vary between styles

This creates variations of the user's vision, not research-inspired alternatives.

CRITICAL: Your output MUST start with: <!-- assetMode: useAssets -->
`;
  } else {
    return `## ASSET MODE: standard
- Style 0: Uses user assets (icons, colors from brief)
- Style 1+: Uses library icons and research-inspired colors

CRITICAL: Your output MUST start with: <!-- assetMode: standard -->
`;
  }
}
```

2. **Apply to ALL shared worker tasks** (modify lines 269-287):

Replace the generic else branch with task-specific handling that ALWAYS includes asset mode:

```typescript
} else if (task.id === 'assets') {
  const assetModeInstruction = buildAssetModeInstruction(options.useAssets, styleCount);

  userPrompt = `Analyze and inventory assets for this project.

${assetModeInstruction}

${options.useAssets
  ? `ALL styles use the SAME user icons and SAME colors from the brief.
Styles vary ONLY in: font choices and icon library recommendations.
Do NOT use competitor colors for any style.`
  : `Style 0: User assets. Style 1+: Competitor-inspired assets.`}

## Project Brief
${combinedBrief || 'No brief provided.'}
...`;

} else if (task.id === 'inspirations') {
  // Similar handling for inspirations
}
```

### Step 2: Update analyze-styles.md Template

**File**: `src/templates/skills/analysis/analyze-styles.md`

**Changes**:

1. **Add conditional template section** (replace lines 143-177):

```markdown
---

## Style 1+ Format (depends on asset mode)

### If assetMode: standard
\`\`\`
## Style 1: [Creative Name]
**Inspired by**: [Competitor 1 name from research]
**Personality**: [2-3 word description]

### Colors
(Use competitor-inspired colors, different from Style 0)
\`\`\`

### If assetMode: useAssets
\`\`\`
## Style 1: [Creative Name]
**Variation**: [Description - e.g., "Compact density with geometric fonts"]
**Personality**: [2-3 word description]

### Colors
(SAME colors as Style 0 from brief - copy exactly)
- Primary: [SAME as Style 0]
- Secondary: [SAME as Style 0]
...
\`\`\`

**CRITICAL for useAssets mode:**
- Copy the EXACT color values from Style 0 for all styles
- Only vary: Typography (font choices), Spacing (base unit, scale), Characteristics (rounded vs sharp, etc.)
```

2. **Update notes section** (lines 179-186):

```markdown
## Notes

- Style 0 is ALWAYS the user's vision based on their brief
- If assetMode: standard → Style 1+ are research-inspired with different colors
- If assetMode: useAssets → Style 1+ are variations with SAME colors, different typography/spacing
- Check the assetMode instruction in the user prompt to determine which mode
- Your output MUST start with the correct <!-- assetMode: --> comment
```

### Step 3: Update analyze-assets.md Template

**File**: `src/templates/skills/analysis/analyze-assets.md`

**Changes**:

1. **Add asset mode section** (after line 28):

```markdown
## Asset Modes

### Standard Mode (assetMode: standard)
- Style 0: Uses user assets (icons from assets/icons/, colors from brief)
- Style 1+: Research-inspired with library icons and competitor colors

### UseAssets Mode (assetMode: useAssets)
ALL styles use user assets:
- All styles use colors from brief (SAME palette)
- All styles use icons from assets/icons/ or same recommended library
- Styles vary ONLY in: font choices, icon library aesthetic
```

2. **Add conditional output format** (replace lines 109-135):

```markdown
## Style 1+ Assets (depends on asset mode)

### If assetMode: standard
\`\`\`markdown
## Style 1 Assets ([Competitor-Inspired Name])

### Fonts
| Usage | Font | Download |
|-------|------|----------|
| Headings | [From competitor research] | https://fonts.google.com/specimen/[Font] |

### Icons
**Recommended Library**: [Matching competitor style]

### Color Palette
\`\`\`json
{
  "primary": "#XXXXXX",  // Competitor-inspired color
  ...
}
\`\`\`
\`\`\`

### If assetMode: useAssets
\`\`\`markdown
## Style 1 Assets ([Variation Name])

### Fonts
| Usage | Font | Download |
|-------|------|----------|
| Headings | [Different from Style 0] | https://fonts.google.com/specimen/[Font] |

### Icons
**Source**: User icons from assets/icons/ (same as Style 0)
**Supplementary Library**: [If gaps exist] - https://lucide.dev

### Color Palette
\`\`\`json
{
  "primary": "#6B9B37",  // SAME as Style 0 - from brief
  "secondary": "#14b8a6",  // SAME as Style 0 - from brief
  ...
}
\`\`\`
\`\`\`
```

### Step 4: Add Output Validation

**File**: `src/commands/analyze.ts`

**Changes**:

After writing each output file, validate the asset mode marker:

```typescript
// After line 303 (writing shared outputs)
for (const result of sharedResults) {
  if (result.output) {
    const strippedOutput = stripPreamble(result.output);

    // Validate asset mode marker for styles and assets
    if (result.id === 'styles' || result.id === 'assets') {
      const expectedMode = options.useAssets ? 'useAssets' : 'standard';
      const modeMatch = strippedOutput.match(/<!--\s*assetMode:\s*(\w+)\s*-->/);

      if (!modeMatch) {
        console.warn(`  Warning: ${result.id}.md missing asset mode marker`);
      } else if (modeMatch[1] !== expectedMode) {
        console.warn(`  Warning: ${result.id}.md has assetMode: ${modeMatch[1]}, expected: ${expectedMode}`);
      }
    }

    await writeFile(join(sharedDir, `${result.id}.md`), strippedOutput);
  }
}
```

### Step 5: Add Color Consistency Check (Optional Enhancement)

**File**: `src/lib/verification.ts` (new function)

```typescript
export function validateColorConsistency(
  stylesContent: string,
  assetsContent: string,
  useAssets: boolean
): { valid: boolean; issues: string[] } {
  if (!useAssets) {
    return { valid: true, issues: [] };
  }

  const issues: string[] = [];

  // Extract primary color from Style 0 in styles.md
  const style0ColorMatch = stylesContent.match(/## Style 0[\s\S]*?Primary:\s*(#[A-Fa-f0-9]{6})/);
  if (!style0ColorMatch) {
    issues.push('Could not extract Style 0 primary color from styles.md');
    return { valid: false, issues };
  }

  const expectedPrimary = style0ColorMatch[1].toLowerCase();

  // Check all styles in assets.md use the same primary
  const assetColorMatches = assetsContent.matchAll(/"primary":\s*"(#[A-Fa-f0-9]{6})"/g);
  for (const match of assetColorMatches) {
    if (match[1].toLowerCase() !== expectedPrimary) {
      issues.push(`assets.md has primary ${match[1]}, expected ${expectedPrimary}`);
    }
  }

  return { valid: issues.length === 0, issues };
}
```

---

## Testing Checklist

### Test Case 1: Basic useAssets Flag
```bash
cd projects/gotribe____
agentflow analyze 3 --useAssets
```

**Expected**:
- [ ] Console shows "Asset Mode: All styles use user assets"
- [ ] `styles.md` starts with `<!-- assetMode: useAssets -->`
- [ ] `assets.md` starts with `<!-- assetMode: useAssets -->`
- [ ] All 3 styles in `styles.md` use #6B9B37 as primary
- [ ] All 3 styles in `assets.md` use #6B9B37 as primary
- [ ] Style 1-2 say "Variation:" not "Inspired by:"

### Test Case 2: Standard Mode (No Flag)
```bash
agentflow analyze 3
```

**Expected**:
- [ ] Console shows "Style 0: User's vision" and "Style 1-2: Research-inspired"
- [ ] `styles.md` starts with `<!-- assetMode: standard -->`
- [ ] Style 0 uses user colors, Style 1-2 use different colors
- [ ] Style 1-2 say "Inspired by: [Competitor]"

### Test Case 3: Single Style
```bash
agentflow analyze 1 --useAssets
```

**Expected**:
- [ ] Only Style 0 generated
- [ ] Uses user colors
- [ ] No competitor references

### Test Case 4: Validation Warnings
```bash
# Manually edit styles.md to have wrong mode marker, then re-run validation
```

**Expected**:
- [ ] Warning printed about mismatched asset mode

---

## Rollback Plan

If the fix causes issues:

1. **Revert analyze.ts changes**:
   ```bash
   git checkout HEAD~1 -- src/commands/analyze.ts
   npm run build
   ```

2. **Revert skill templates**:
   ```bash
   git checkout HEAD~1 -- src/templates/skills/analysis/analyze-styles.md
   git checkout HEAD~1 -- src/templates/skills/analysis/analyze-assets.md
   ```

3. **Clear cached outputs**:
   ```bash
   rm -rf projects/*/outputs/analysis/
   ```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/commands/analyze.ts` | Pass useAssets to all workers, add validation |
| `src/templates/skills/analysis/analyze-styles.md` | Add conditional template for useAssets mode |
| `src/templates/skills/analysis/analyze-assets.md` | Add asset mode section and conditional output |
| `src/lib/verification.ts` | Add color consistency validation (optional) |

## Estimated Complexity

- **analyze.ts**: Medium - refactor prompt building, ~50 lines changed
- **analyze-styles.md**: Medium - add conditional examples, ~30 lines added
- **analyze-assets.md**: Medium - add mode handling, ~40 lines added
- **verification.ts**: Low - new function, ~30 lines

**Total**: ~150 lines of changes across 4 files

---

## Summary

The `--useAssets` flag fails because:
1. Only the `styles` task receives the flag instructions
2. The `assets` and `inspirations` tasks get generic prompts ignoring the flag
3. The skill templates don't show conditional examples for different modes
4. There's no validation that output matches the expected mode

The fix requires:
1. Propagating useAssets instructions to ALL analysis workers
2. Updating skill templates with conditional output formats
3. Adding output validation to catch mismatches
