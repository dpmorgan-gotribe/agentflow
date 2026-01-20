# BUG-008: Screen Output Directory Structure and Asset Paths

## Problem Description

Two related issues with screen generation:

### Issue 1: Skill Variants Overwrite Each Other

When generating screens with different skills for the same platform, they overwrite each other:

```bash
agentflow screens --platform=admin --skill=desktop  # → outputs/screens/admin/
agentflow screens --platform=admin --skill=mobile   # → outputs/screens/admin/ (overwrites!)
```

**Expected:** Separate directories for each platform+skill combination.

### Issue 2: Incorrect Asset Paths

Generated screens use incorrect relative paths for assets:
- Current: `../../assets/icons/` (2 levels)
- Needed: `../../../assets/icons/` (3 levels for platform subdirs)

## Proposed Directory Structure

```
outputs/screens/
├── admin/              # --platform=admin (default skill: desktop)
├── mobile-admin/       # --platform=admin --skill=mobile
├── webapp/             # --platform=webapp (default skill: webapp)
├── mobile-webapp/      # --platform=webapp --skill=mobile
├── desktop-webapp/     # --platform=webapp --skill=desktop
└── desktop-admin/      # --platform=admin --skill=desktop (explicit)
```

**Naming convention:** `{skill}-{platform}` when skill differs from default, otherwise just `{platform}`.

## Implementation Plan

### Step 1: Update Output Directory Logic in screens.ts

```typescript
function getScreensOutputDir(
  projectDir: string,
  platform: string | null,
  skill: string
): { dir: string; depth: number } {
  const baseDir = join(projectDir, 'outputs', 'screens');

  if (!platform) {
    // No platform specified - use skill as folder name or 'default'
    const folderName = skill !== 'webapp' ? skill : 'default';
    return { dir: join(baseDir, folderName), depth: 3 };
  }

  // Determine default skill for this platform
  const defaultSkill = getDefaultSkillForPlatform(platform);

  if (skill === defaultSkill) {
    // Using default skill - just use platform name
    return { dir: join(baseDir, platform), depth: 3 };
  }

  // Non-default skill - prefix with skill name
  const folderName = `${skill}-${platform}`;
  return { dir: join(baseDir, folderName), depth: 3 };
}

function getDefaultSkillForPlatform(platform: string): string {
  // Admin platforms default to desktop skill
  if (platform.includes('admin') || platform.includes('backend')) {
    return 'desktop';
  }
  // Mobile platforms default to mobile skill
  if (platform.includes('mobile') || platform.includes('app')) {
    return 'mobile';
  }
  // Everything else defaults to webapp
  return 'webapp';
}
```

### Step 2: Add Asset Path Correction

```typescript
function correctAssetPaths(html: string, depth: number): string {
  const correctPrefix = '../'.repeat(depth) + 'assets/';

  // Fix various incorrect patterns
  return html
    // Fix src attributes
    .replace(/src="\.\.\/\.\.\/\.\.\/assets\//g, `src="${correctPrefix}`)
    .replace(/src="\.\.\/\.\.\/assets\//g, `src="${correctPrefix}`)
    .replace(/src="\.\.\/assets\//g, `src="${correctPrefix}`)
    .replace(/src="assets\//g, `src="${correctPrefix}`)
    // Fix href attributes
    .replace(/href="\.\.\/\.\.\/\.\.\/assets\//g, `href="${correctPrefix}`)
    .replace(/href="\.\.\/\.\.\/assets\//g, `href="${correctPrefix}`)
    .replace(/href="\.\.\/assets\//g, `href="${correctPrefix}`)
    .replace(/href="assets\//g, `href="${correctPrefix}`);
}
```

### Step 3: Update screens.ts Integration

```typescript
// In screens() function:

// Get output directory with correct depth
const { dir: outputDir, depth: assetDepth } = getScreensOutputDir(
  projectDir,
  platform,
  skillType
);

await mkdir(outputDir, { recursive: true });

// Log the output location
console.log(`Output directory: ${outputDir.replace(projectDir, '.')}`);

// ... generation code ...

// After validation, correct asset paths
const correctedHtml = correctAssetPaths(validation.content, assetDepth);
await writeFile(outputPath, correctedHtml);
```

### Step 4: Update Skill Files with Asset Path Guidance

Add to each design-screen-*.md skill file:

```markdown
## Asset References

When referencing project assets, use placeholder paths that will be auto-corrected:
- Icons: `../../assets/icons/{name}.svg`
- Logos: `../../assets/logos/{name}.png`
- Fonts: `../../assets/fonts/{name}.woff2`

The build system will correct these paths based on output location.
```

## Output Directory Matrix

| Platform | Skill | Output Directory | Asset Depth |
|----------|-------|------------------|-------------|
| admin | desktop (default) | `outputs/screens/admin/` | 3 |
| admin | mobile | `outputs/screens/mobile-admin/` | 3 |
| admin | webapp | `outputs/screens/webapp-admin/` | 3 |
| webapp | webapp (default) | `outputs/screens/webapp/` | 3 |
| webapp | mobile | `outputs/screens/mobile-webapp/` | 3 |
| webapp | desktop | `outputs/screens/desktop-webapp/` | 3 |
| (none) | webapp | `outputs/screens/` | 2 |
| (none) | mobile | `outputs/screens/mobile/` | 3 |

## Files to Modify

| File | Changes |
|------|---------|
| `src/commands/screens.ts` | Add `getScreensOutputDir()`, `correctAssetPaths()`, update output logic |
| `src/lib/validation.ts` | Optionally move `correctAssetPaths()` here for reuse |
| `skills/design/design-screen-*.md` | Add asset path guidance |

## Testing Checklist

- [ ] `--platform=admin` → `outputs/screens/admin/`
- [ ] `--platform=admin --skill=mobile` → `outputs/screens/mobile-admin/`
- [ ] `--platform=admin --skill=desktop` → `outputs/screens/admin/` (default)
- [ ] `--platform=webapp` → `outputs/screens/webapp/`
- [ ] `--platform=webapp --skill=mobile` → `outputs/screens/mobile-webapp/`
- [ ] Asset paths corrected to `../../../assets/` for all platform dirs
- [ ] Icons load correctly in browser
- [ ] Logos load correctly in browser
- [ ] Running mobile then desktop doesn't overwrite

## Migration for Existing Screens

Existing screens in `outputs/screens/admin/` that were generated with `--skill=mobile` should be moved:

```bash
# If you generated mobile screens in admin/, move them
mv outputs/screens/admin/ outputs/screens/mobile-admin/

# Then regenerate desktop admin screens
agentflow screens --platform=admin --skill=desktop
```

## Implementation Order

1. Add `getScreensOutputDir()` function
2. Add `correctAssetPaths()` function
3. Update screens.ts to use new functions
4. Update console output to show target directory
5. Test all platform+skill combinations
6. Update skill files with asset path guidance
