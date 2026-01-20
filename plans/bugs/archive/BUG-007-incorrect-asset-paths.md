# BUG-007: Incorrect Asset Paths in Generated Screens

## Problem Description

Generated screens reference icons and logos with incorrect relative paths, causing images to not load.

**Screen location:** `outputs/screens/admin/screen-*.html`
**Asset location:** `assets/icons/*.svg`, `assets/logos/*.png`

**Current path in screens:** `../../assets/icons/menu.svg`
**Correct path should be:** `../../../assets/icons/menu.svg`

The LLM generates paths assuming screens are 2 levels deep from project root, but with platform subdirectories they're 3 levels deep.

## Directory Structure

```
projects/gotribe____/
├── assets/
│   ├── icons/
│   │   ├── menu.svg
│   │   ├── notifications.svg
│   │   └── ...
│   └── logos/
│       └── gotribe_transparent.png
└── outputs/
    └── screens/
        └── admin/           ← Platform subdirectory (3rd level)
            └── screen-01-admin-platform-overview.html
```

**Path calculation:**
- From `outputs/screens/admin/` going `../../` lands at `outputs/` (wrong)
- From `outputs/screens/admin/` going `../../../` lands at project root (correct)

## Root Cause

The skill files and LLM prompts don't specify the correct asset path depth. The LLM makes assumptions about directory structure that are incorrect when platform subdirectories are used.

## Solutions

### Option 1: Post-Process Path Correction (Recommended)

Add a path correction step in `screens.ts` after generation:

```typescript
function correctAssetPaths(html: string, platform: string | null): string {
  if (platform) {
    // Platform screens are 3 levels deep: outputs/screens/{platform}/
    return html
      .replace(/\.\.\/\.\.\/assets\//g, '../../../assets/')
      .replace(/\.\.\/assets\//g, '../../../assets/');
  }
  // Non-platform screens are 2 levels deep: outputs/screens/
  return html.replace(/\.\.\/assets\//g, '../../assets/');
}
```

### Option 2: Update Skill Files

Add explicit asset path guidance to skill files:

```markdown
## Asset Paths

Use these EXACT paths for assets:

For platform screens (outputs/screens/{platform}/):
- Icons: `../../../assets/icons/{name}.svg`
- Logos: `../../../assets/logos/{name}.png`

For non-platform screens (outputs/screens/):
- Icons: `../../assets/icons/{name}.svg`
- Logos: `../../assets/logos/{name}.png`
```

### Option 3: Use Absolute Paths from Project Root

Tell LLM to use paths relative to project root:

```markdown
Use paths starting from project root:
- `./assets/icons/{name}.svg`
- `./assets/logos/{name}.png`
```

Then document that users should open HTML files from project root or use a local server.

## Recommended Approach

**Option 1 (Post-Process)** is most reliable because:
- Doesn't rely on LLM compliance
- Can be applied to already-generated screens
- Handles both platform and non-platform cases

## Implementation Steps

### Step 1: Add Path Correction Function

In `src/lib/validation.ts`:

```typescript
export function correctAssetPaths(html: string, depth: number = 2): string {
  const prefix = '../'.repeat(depth);

  // Fix common incorrect patterns
  return html
    .replace(/src="\.\.\/\.\.\/assets\//g, `src="${prefix}assets/`)
    .replace(/src="\.\.\/assets\//g, `src="${prefix}assets/`)
    .replace(/src="assets\//g, `src="${prefix}assets/`)
    .replace(/href="\.\.\/\.\.\/assets\//g, `href="${prefix}assets/`)
    .replace(/href="\.\.\/assets\//g, `href="${prefix}assets/`);
}
```

### Step 2: Apply in screens.ts

After HTML validation, apply path correction:

```typescript
// After validation
const correctedHtml = correctAssetPaths(
  validation.content,
  platform ? 3 : 2  // 3 levels for platform, 2 for non-platform
);

await writeFile(outputPath, correctedHtml);
```

### Step 3: Fix Existing Screens

Add a utility command or one-liner to fix existing screens:

```bash
# Fix all admin screens
for f in outputs/screens/admin/*.html; do
  sed -i 's|\.\.\/\.\.\/assets/|../../../assets/|g' "$f"
done
```

## Testing Checklist

- [ ] New screens with `--platform=admin` have correct 3-level paths
- [ ] New screens without `--platform` have correct 2-level paths
- [ ] Icons display correctly when opening HTML in browser
- [ ] Logos display correctly
- [ ] Fix script works on existing screens

## Immediate Workaround

Fix existing screens with sed:

```bash
cd projects/gotribe____
for f in outputs/screens/admin/*.html; do
  sed -i 's|\.\.\/\.\.\/assets/|../../../assets/|g' "$f"
done
```

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/validation.ts` | Add `correctAssetPaths()` function |
| `src/commands/screens.ts` | Apply path correction after generation |
| `skills/design/design-screen-*.md` | Optionally add path guidance |
