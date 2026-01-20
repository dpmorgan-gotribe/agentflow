# BUG-005: Platform-Specific Skill Files Missing in Projects

## Problem Description

The `--skill` option exists for `agentflow screens` and `agentflow stylesheet` commands, but doesn't work because:

1. The CLI correctly accepts `--skill=mobile`, `--skill=desktop`, `--skill=webapp`
2. The `resolveSkill()` function correctly handles the override
3. BUT the platform-specific skill files aren't copied to projects during `init`

**Expected behavior:**
```bash
agentflow screens --platform=admin --skill=mobile
# Should use design-screen-mobile.md to create mobile-style admin screens

agentflow screens --platform=webapp --skill=desktop
# Should use design-screen-desktop.md to create desktop-style webapp screens
```

**Actual behavior:**
```
Skill design/design-screen-mobile not found, falling back to design-screen
```

## Root Cause Analysis

**Source templates (exist):**
```
src/templates/skills/design/
├── design-screen.md           # Generic fallback
├── design-screen-webapp.md    # Responsive web layouts
├── design-screen-mobile.md    # Touch-optimized mobile
├── design-screen-desktop.md   # Dense admin/power-user layouts
├── design-stylesheet.md       # Generic fallback
├── design-stylesheet-webapp.md
├── design-stylesheet-mobile.md
├── design-stylesheet-desktop.md
```

**Project skills (missing platform variants):**
```
projects/gotribe____/skills/design/
├── design-screen.md           # Only generic
├── design-stylesheet.md       # Only generic
├── design-flow.md
├── design-mockup.md
```

The `init` command doesn't copy platform-specific skill files.

## Implementation Steps

### Step 1: Add Platform Skills to Templates

Verify these files exist in `src/templates/skills/design/`:
- [x] `design-screen-webapp.md`
- [x] `design-screen-mobile.md`
- [x] `design-screen-desktop.md`
- [ ] `design-stylesheet-webapp.md`
- [ ] `design-stylesheet-mobile.md`
- [ ] `design-stylesheet-desktop.md`

### Step 2: Update `init.ts` to Copy All Skills

**File:** `src/commands/init.ts`

Ensure all skill files are copied during project initialization:

```typescript
// Copy all skills including platform variants
const skillFiles = await readdir(join(templatesDir, 'skills', 'design'));
for (const file of skillFiles) {
  if (file.endsWith('.md')) {
    await copyFile(
      join(templatesDir, 'skills', 'design', file),
      join(projectDir, 'skills', 'design', file)
    );
  }
}
```

### Step 3: Create Missing Stylesheet Skills

Create platform-specific stylesheet skills if they don't exist:

**`design-stylesheet-mobile.md`:**
- Focus on touch targets (44px minimum)
- Bottom sheet patterns
- Swipe interactions
- Mobile-first typography scales

**`design-stylesheet-desktop.md`:**
- Dense information layouts
- Data tables with many columns
- Sidebar navigation patterns
- Hover states, tooltips

**`design-stylesheet-webapp.md`:**
- Responsive breakpoints
- Flexible grid layouts
- Progressive enhancement

### Step 4: Add Skill Copy Command (Optional Enhancement)

Add a command to update skills in existing projects:

```bash
agentflow update-skills
```

Or document manual copy instructions for existing projects.

## Quick Fix for Existing Projects

Copy the platform skills manually:

```bash
# From agentflow root directory
cp src/templates/skills/design/design-screen-*.md projects/gotribe____/skills/design/
cp src/templates/skills/design/design-stylesheet-*.md projects/gotribe____/skills/design/
```

## Testing Checklist

- [ ] `agentflow init test-project` creates project with all platform skills
- [ ] `agentflow screens --skill=mobile` uses design-screen-mobile.md
- [ ] `agentflow screens --skill=desktop` uses design-screen-desktop.md
- [ ] `agentflow screens --skill=webapp` uses design-screen-webapp.md
- [ ] `agentflow stylesheet --skill=mobile` uses design-stylesheet-mobile.md
- [ ] Fallback to generic skill works when platform skill missing
- [ ] Warning message shown when invalid skill specified

## Files to Modify

| File | Action |
|------|--------|
| `src/commands/init.ts` | Copy all skill files including platform variants |
| `src/templates/skills/design/design-stylesheet-mobile.md` | Create if missing |
| `src/templates/skills/design/design-stylesheet-desktop.md` | Create if missing |
| `src/templates/skills/design/design-stylesheet-webapp.md` | Create if missing |

## Immediate Workaround

For the current project, copy the skills manually:

```bash
cd C:\Development\ps\claude\claude_\agentflow\agentflow_version2\agentflow
cp src/templates/skills/design/design-screen-webapp.md projects/gotribe____/skills/design/
cp src/templates/skills/design/design-screen-mobile.md projects/gotribe____/skills/design/
cp src/templates/skills/design/design-screen-desktop.md projects/gotribe____/skills/design/
```

Then test:
```bash
agentflow screens --platform=webapp --skill=mobile --limit=2
agentflow screens --platform=admin --skill=desktop --limit=2
```
