# BUG-018: Flows and Stylesheet Commands Don't Use Selected Mockup Styling

## Problem
The design pipeline doesn't propagate selected style choices consistently:
1. `agentflow flows` hardcodes "Style 0" - no `--style` parameter exists
2. `agentflow stylesheet --style=N` doesn't load the actual mockup HTML as reference
3. Header, logo, footer, and icons don't match the selected mockup in generated outputs

This breaks the design continuity promise where picking a style mockup should propagate that visual language through all subsequent outputs.

## Context
**Where:** Commands `agentflow flows` and `agentflow stylesheet`

**Affected Components:**
- `src/commands/flows.ts` - Flow mockup generation (hardcodes Style 0 on line 63)
- `src/commands/stylesheet.ts` - Design system generation
- `src/commands/screens.ts` - Screen HTML generation (consumes stylesheet)
- `outputs/mockups/style-{0,1,2,3,4}.html` - Source mockups with correct styling
- `outputs/flows/*.html` - Flow mockup outputs
- `outputs/stylesheet/showcase.html` - Design system output

**User Impact:** After selecting a preferred style mockup, users expect flows, stylesheet, and screens to all use that style. Currently they get Style 0 for flows regardless of preference.

## Root Cause Analysis

**flows.ts (line 63):**
```typescript
Use Style 0 (user's vision) from the styles below.
```
- Hardcoded to always use Style 0
- No `--style` parameter to select alternative styles
- Doesn't load the mockup HTML as visual reference

**stylesheet.ts:**
- Accepts `--style` parameter but only uses styles.md text definitions
- Doesn't load the actual mockup HTML (`outputs/mockups/style-N.html`)
- Agent can't see the visual implementation of header/footer/icons

**The Fix:**
1. Add `--style` parameter to `flows` command
2. Both commands should load the selected mockup HTML as reference
3. Prompts should instruct agent to match header/footer/logo/icons exactly

## Implementation Steps

### Phase 1: Add --style to flows command

1. [ ] **Add --style option to flows.ts** - Add commander option: `.option('--style <number>', 'Style to use (0-N)', '0')`

2. [ ] **Load selected mockup HTML in flows.ts** - After loading flows.md, load the mockup:
   ```typescript
   const mockupPath = join(projectDir, 'outputs', 'mockups', `style-${styleNumber}.html`);
   const mockupHtml = await readFile(mockupPath, 'utf-8');
   ```

3. [ ] **Update flows prompt to use mockup reference** - Replace hardcoded "Style 0" with dynamic selection and include mockup HTML:
   ```typescript
   Use Style ${styleNumber} from the styles below.

   ## Selected Mockup HTML Reference
   ${mockupHtml}

   CRITICAL: Match the header, footer, logo, and icon styling EXACTLY from the mockup HTML above.
   ```

### Phase 2: Load mockup HTML in stylesheet command

4. [ ] **Load mockup HTML in stylesheet.ts** - Add mockup loading after style validation:
   ```typescript
   const mockupPath = join(projectDir, 'outputs', 'mockups', `style-${styleNumber}.html`);
   const mockupHtml = await readFile(mockupPath, 'utf-8');
   ```

5. [ ] **Pass mockup HTML to stylesheet agent** - Include in the prompt with clear instructions:
   ```
   ## Selected Mockup HTML Reference
   ${mockupHtml}

   CRITICAL: Extract and replicate these elements EXACTLY from the mockup:
   - Header: structure, background color, icon colors, logo placement
   - Footer: structure, background color, icon colors, active states
   - Icons: style (outline/filled), colors (inactive/active)
   - Logo: size, position, treatment
   ```

### Phase 3: Update skills for consistency

6. [ ] **Update design-flow.md skill** - Add section emphasizing mockup fidelity:
   ```
   ## Header/Footer/Icon Matching
   You MUST match the selected mockup's:
   - Header background color and icon treatment
   - Footer background color and active/inactive states
   - Logo placement and sizing
   - Icon style (outlined vs filled, stroke width)
   ```

7. [ ] **Update design-stylesheet.md skill** - Add extraction requirements for structural components

### Phase 4: Register --style in CLI

8. [ ] **Update src/index.ts** - Register the --style option for flows command:
   ```typescript
   program
     .command('flows')
     .option('--style <number>', 'Style to use (0-N)', '0')
     .action(flows);
   ```

9. [ ] **Rebuild and test** - `npm run build` and verify both commands accept --style

## Testing

### Flows Command Tests
- [ ] Verify `agentflow flows` (no flag) defaults to Style 0
- [ ] Verify `agentflow flows --style=1` generates flows using Style 1
- [ ] Compare flow-1 header/footer between --style=0 and --style=1 - should be different
- [ ] Verify logo appears correctly in flow outputs
- [ ] Verify icons match the selected mockup style

### Stylesheet Command Tests
- [ ] Run `agentflow mockups` and verify style-1.html exists with distinct header/footer/icon treatment
- [ ] Run `agentflow stylesheet --style=1`
- [ ] Verify showcase.html header matches style-1.html header exactly
- [ ] Verify showcase.html footer matches style-1.html footer exactly
- [ ] Verify icon styles match (colors, active states)

### Full Pipeline Tests
- [ ] Run full pipeline with --style=0: `flows` → `mockups` → `stylesheet --style=0` → `screens`
- [ ] Run full pipeline with --style=2: `flows --style=2` → `stylesheet --style=2` → `screens`
- [ ] Verify visual consistency across all outputs for each style

### Edge Case Tests
- [ ] Test with missing mockup file (should error gracefully with clear message)
- [ ] Test `flows --style=99` with non-existent style (should error)
- [ ] Test running `agentflow screens` without first running `agentflow stylesheet` (should error/warn)

### Regression Tests
- [ ] Verify other stylesheet content (colors, typography, spacing) still generates correctly
- [ ] Verify screen content (forms, cards, lists) beyond header/footer still works
- [ ] Verify flows still extract correct screens for screens command

## Rollback Plan

**Safe Revert Steps:**
1. Revert commits to `src/commands/flows.ts`, `src/commands/stylesheet.ts`, and `src/index.ts`
2. Restore original skill files if modified
3. Run `npm run build` to recompile
4. Test that original behavior is restored

**Quick Validation:**
- Run `agentflow flows` - should complete (using Style 0)
- Run `agentflow stylesheet --style=1` - should complete without errors

**Data Safety:** No user data is affected - only generated files in `outputs/` directory. Users can re-run commands to regenerate after rollback.
