# Feature Plan: Remove Platform Flag from Mockups Command

## Problem Statement

The `mockups` command currently supports a `--platform` flag, but mockups should be **generic** (not platform-specific). Styles are design system decisions that apply across all platforms. Users should pick ONE style that then gets applied to all platforms during the `stylesheet` and `screens` phases.

## Current Flow (WRONG)
```
Multi-platform project
→ analyze (creates shared styles.md)
→ mockups --platform=webapp (creates webapp-specific styles)
→ mockups --platform=backend (creates different backend styles?)
```

## Correct Flow (DESIRED)
```
Multi-platform project
→ analyze (creates shared styles.md)
→ mockups (creates generic style-0, style-1, style-2)
→ user picks style 1
→ stylesheet --platform=webapp --style=1 (applies chosen style to webapp)
→ stylesheet --platform=backend --style=1 (applies SAME style to backend)
```

## Files to Modify

### 1. `src/index.ts`
- Remove `--platform` option from mockups command registration
- Lines ~40-43

### 2. `src/commands/mockups.ts`
- Remove platform detection logic (lines 38-45)
- Remove platform-specific directory handling (lines 52-58)
- Remove platform from user prompt (line 167)
- Change output directory to `outputs/mockups/` (not `outputs/mockups/{platform}/`)
- Lines ~210-212: Write to generic location

### 3. `src/commands/flows.ts`
- Update to read mockups from `outputs/mockups/` instead of platform-specific path
- Line ~85

### 4. `src/commands/stylesheet.ts`
- Update to read mockups from `outputs/mockups/` instead of platform-specific path
- Line ~96

### 5. `src/templates/commands/mockups.md`
- Remove platform flag from documentation
- Update examples

### 6. `src/templates/CLAUDE.md`
- Remove platform flag from mockups examples
- Update workflow documentation

## Implementation Steps

### Step 1: Update CLI Registration
```typescript
// src/index.ts - BEFORE
program
  .command('mockups')
  .option('--platform <name>', 'Target platform (webapp, backend, ...)')
  .description('Create style mockups')
  .action((options) => mockups({ platform: options.platform }));

// src/index.ts - AFTER
program
  .command('mockups')
  .description('Create style mockups')
  .action(() => mockups());
```

### Step 2: Simplify mockups.ts
- Remove `platform` parameter from function signature
- Remove platform detection and validation
- Always output to `outputs/mockups/`
- Load screens from `outputs/analysis/shared/` or use first available platform for representative screens

### Step 3: Update Downstream Commands
- `flows.ts`: Look for mockups in `outputs/mockups/style-{n}.html`
- `stylesheet.ts`: Look for mockups in `outputs/mockups/style-{n}.html`

### Step 4: Update Documentation
- Remove platform references from mockups command docs
- Clarify that mockups are universal style previews

## Testing

1. Run `agentflow mockups` on multi-platform project
2. Verify mockups written to `outputs/mockups/` (not platform-specific)
3. Run `agentflow stylesheet --platform=webapp --style=1`
4. Verify it finds the mockup correctly
5. Run `agentflow screens --platform=webapp`
6. Verify full workflow completes

## Notes

- Platform flags remain valid for: `flows`, `stylesheet`, `screens`
- Only `mockups` becomes platform-agnostic
- This aligns with the conceptual model: pick a style once, apply everywhere
