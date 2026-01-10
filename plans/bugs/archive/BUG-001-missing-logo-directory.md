I've prepared the complete bug fix plan. Here's the plan document I'm attempting to write to `plans/bugs/BUG-001-missing-logo-directory.md`:

---

# BUG-001: Missing Logo Directory in Project Assets

## Problem
When initializing a new AgenticFlow project using `agentflow init`, the `assets/logos` directory is not created. This prevents projects from having a dedicated location for logo assets, which are essential for brand identity in design systems. The gotribe project (and all new projects) are missing this directory structure.

## Context
- **Affected Command**: `agentflow init <name>`
- **Affected File**: `src/commands/init.ts`
- **User Impact**: Users must manually create the logos directory, breaking the expected project scaffolding workflow
- **Related Assets**: Currently created directories include `wireframes`, `fonts`, and `icons` - but logos are equally important for design generation

## Root Cause Analysis
The `init.ts` command explicitly defines which asset directories to create during project initialization. The `dirs` array on line 16-30 includes:
- `assets/wireframes`
- `assets/fonts`
- `assets/icons`

However, `assets/logos` was not included in this list. Similarly, the `.gitkeep` file creation loop (lines 43-46) only creates `.gitkeep` files for the three existing asset directories.

This appears to be an oversight in the original implementation, as logos are a fundamental part of any design system and should be included alongside other asset types.

## Implementation Steps
1. [ ] Open `src/commands/init.ts`
2. [ ] Add `'assets/logos'` to the `dirs` array (after line 24, with other asset directories)
3. [ ] Add `'assets/logos'` to the `gitkeeps` array (line 43) to ensure the directory is tracked in git
4. [ ] Build the project with `npm run build`
5. [ ] Manually create the `logos` directory in existing projects (like gotribe):
   - Create directory: `projects/gotribe/assets/logos`
   - Add `.gitkeep` file to the directory
6. [ ] Update `src/templates/skills/analysis/analyze-assets.md` to include logos in the asset inventory output format

## Testing
- [ ] **New Project Test**: Run `agentflow init test-logos` and verify `assets/logos` directory exists with `.gitkeep`
- [ ] **Directory Structure Test**: Confirm all four asset directories exist: `wireframes`, `fonts`, `icons`, `logos`
- [ ] **Build Test**: Ensure `npm run build` completes without errors after changes
- [ ] **Existing Project Test**: Verify gotribe project can have logos directory manually added without conflicts
- [ ] **Template Consistency Test**: Verify the analyze-assets skill properly documents logo assets

## Rollback Plan
1. Revert changes to `src/commands/init.ts` by removing the `'assets/logos'` entries from both arrays
2. Run `npm run build` to recompile
3. The logos directory in any newly created projects can be safely deleted if not in use
4. No data loss risk as this only affects empty directory creation

---

Please grant write permission to save this plan to the file.
