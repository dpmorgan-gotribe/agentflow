I've created the complete bug fix plan for BUG-002. Here's the plan I'm attempting to write to `plans/bugs/BUG-002-sequential-id-ignores-archive.md`:

---

# BUG-002: Sequential ID Generation Ignores Archived Plans

## Problem
When generating sequential IDs for bug fix plans or feature plans, the system only scans the main directory (`plans/bugs/` or `plans/features/`) but ignores the archive subdirectories. This causes ID collisions when a plan is moved to the archive folder - the next plan incorrectly reuses an existing ID instead of generating the next sequential one.

**Example**: When `BUG-001-missing-logo-directory.md` was archived to `plans/bugs/archive/`, the next bug plan was incorrectly assigned `BUG-001` instead of `BUG-002`, resulting in two plans with the same ID.

## Context
- **Affected Commands**: `agentflow plan-fix`, `agentflow plan-feature`
- **Affected Files**:
  - `src/commands/plan-fix.ts` (function `getNextBugId`)
  - `src/commands/plan-feature.ts` (function `getNextFeatureId`)
- **User Impact**: Duplicate IDs create confusion, break traceability, and could overwrite archived plans if they're ever restored
- **Current Evidence**:
  - `plans/bugs/archive/BUG-001-missing-logo-directory.md` (archived)
  - `plans/bugs/BUG-001-missing-project-brief.md` (incorrectly assigned same ID)

## Root Cause Analysis
The `getNextBugId()` function in `plan-fix.ts` (lines 14-36) only reads files from the main `plans/bugs/` directory:

```typescript
const bugsDir = join(plansDir, 'bugs');
const files = await readdir(bugsDir);  // Only reads main directory
```

It does not scan `plans/bugs/archive/` for existing IDs. The same issue exists in `getNextFeatureId()` in `plan-feature.ts` (lines 14-36).

When determining the next ID, the function calculates `Math.max(...ids) + 1` based only on the IDs found in the main directory, completely ignoring any archived plans.

## Implementation Steps
1. [ ] Open `src/commands/plan-fix.ts`
2. [ ] Modify `getNextBugId()` to also scan `plans/bugs/archive/` directory:
   - Add logic to read files from both `bugsDir` and `join(bugsDir, 'archive')`
   - Combine file lists before extracting IDs
   - Handle case where archive directory doesn't exist (use try/catch or check existence)
3. [ ] Open `src/commands/plan-feature.ts`
4. [ ] Apply the same fix to `getNextFeatureId()`:
   - Scan both `plans/features/` and `plans/features/archive/`
   - Combine file lists before extracting IDs
5. [ ] Build the project with `npm run build`
6. [ ] Rename the incorrectly numbered file:
   - Rename `plans/bugs/BUG-001-missing-project-brief.md` to `plans/bugs/BUG-003-missing-project-brief.md`
   - Update the heading inside the file to reflect `BUG-003`

## Testing
- [ ] **Archive Scan Test (Bugs)**: Create a test where `plans/bugs/archive/` contains `BUG-005-test.md` and `plans/bugs/` is empty. Run `agentflow plan-fix test` and verify it generates `BUG-006`
- [ ] **Archive Scan Test (Features)**: Same test for features - archive contains `FEAT-003-test.md`, verify next ID is `FEAT-004`
- [ ] **Combined Scan Test**: Place `BUG-002` in main folder and `BUG-005` in archive. Verify next ID is `BUG-006` (uses max from both)
- [ ] **Empty Archive Test**: Ensure command works when archive directory doesn't exist
- [ ] **Empty Both Test**: Ensure command works when both directories are empty (should return `-001`)
- [ ] **Build Test**: Ensure `npm run build` completes without errors
- [ ] **Regression Test**: Verify existing plan-fix and plan-feature functionality still works correctly

## Rollback Plan
1. Revert changes to `src/commands/plan-fix.ts` by restoring the original `getNextBugId()` function
2. Revert changes to `src/commands/plan-feature.ts` by restoring the original `getNextFeatureId()` function
3. Run `npm run build` to recompile
4. Document the known issue about archive IDs not being considered
5. No data loss risk as this change only affects ID generation logic

---

Please grant write permission to save this plan to the file.
