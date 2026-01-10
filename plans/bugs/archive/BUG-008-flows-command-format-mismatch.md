I don't have write permissions yet. Here is the complete bug fix plan for BUG-008:

---

# BUG-008: Flows Command Format Mismatch

## Problem
The `agentflow flows` command fails to parse the output from `analyze-flows.md` skill:
1. The skill defines output format as `### Flow 1:` but `flows.ts` expects `## Flow N:` regex pattern
2. The `flows.md` output sometimes contains style analysis instead of user flows (skill not enforced)
3. No validation that flows.md contains actual flow definitions before parsing

## Context
- **Affected Commands**: `agentflow analyze`, `agentflow flows`
- **Affected Files**:
  - `src/commands/flows.ts` - regex pattern mismatch on line 21
  - `src/templates/skills/analysis/analyze-flows.md` - uses `### Flow N:` format
  - `src/commands/analyze.ts` - flows worker may not enforce output format
- **User Impact**: Command fails with "No flows found" error despite analyze completing successfully

## Root Cause Analysis

### Issue 1: Header level mismatch
The `analyze-flows.md` skill defines flow headers at H3 level:
```markdown
### Flow 1: Onboarding (Primary)
### Flow 2: [Core Action Name]
### Flow N: [Name]
```

But `flows.ts` line 21 uses regex expecting H2 level:
```typescript
const flowMatches = flowsContent.match(/^## Flow \d+: (.+)$/gm) || [];
```

This mismatch causes zero flows to be detected even when properly formatted output exists.

### Issue 2: Output contamination
The skill doesn't strongly enforce its output format. Claude may generate:
- Style analysis content instead of flow analysis
- Free-form prose without structured flow headers
- Mixed content that doesn't follow the template

### Issue 3: No output validation in analyze.ts
The analyze command writes whatever output Claude returns without verifying it matches the expected format. Bad output propagates to the flows command.

## Implementation Steps

### Phase 1: Fix the format mismatch

1. [ ] **Update `analyze-flows.md` to use H2 headers** (preferred approach - maintains consistency with other skills)
   - File: `src/templates/skills/analysis/analyze-flows.md`
   - Change all flow headers from `### Flow N:` to `## Flow N:`
   - Update the output format template section (lines 50-88)
   - Change line 52: `### Flow 1:` -> `## Flow 1:`
   - Change line 72: `### Flow 2:` -> `## Flow 2:`
   - Change line 86: `### Flow N:` -> `## Flow N:`
   - Change lines 94-100: `### Suggested:` -> `## Suggested:`

2. [ ] **Copy updated skill to dist**
   - Run: `npm run build` or manually copy to `dist/templates/skills/analysis/analyze-flows.md`

### Phase 2: Enforce output format

3. [ ] **Add format enforcement to analyze-flows.md skill**
   - Add a "Critical Requirements" section at the top of the skill:
   ```markdown
   ## Critical Requirements
   - Output MUST follow the exact format below
   - Each flow MUST start with `## Flow N: [Flow Name]` (H2 header)
   - Do NOT include style analysis, colors, or typography
   - Focus ONLY on user journeys and screen sequences
   ```

4. [ ] **Add output reminder at end of skill**
   ```markdown
   ## Output Reminder
   Your output MUST:
   1. Start with `# Flow Analysis`
   2. Use `## Flow N: [Name]` format for each flow (H2 level, not H3)
   3. Include only flow/journey content, no style information
   ```

### Phase 3: Add validation in flows.ts

5. [ ] **Add better error messaging in flows.ts**
   - File: `src/commands/flows.ts`
   - After line 24, add diagnostic output:
   ```typescript
   if (flowNames.length === 0) {
     // Check for common format issues
     const h3Flows = flowsContent.match(/^### Flow \d+: (.+)$/gm) || [];
     if (h3Flows.length > 0) {
       console.error('Format error: Found flows with ### headers (H3)');
       console.error('Expected: ## Flow N: Name (H2 headers)');
       console.error('Re-run `agentflow analyze` to regenerate flows.md');
     } else {
       console.error('No flows found in outputs/analysis/flows.md');
       console.error('Expected format: "## Flow N: Flow Name"');
     }
     process.exit(1);
   }
   ```

### Phase 4: Update existing project templates

6. [ ] **Update any existing projects with old skill format**
   - Check `projects/*/skills/analysis/analyze-flows.md`
   - Update header format in each to match new H2 format

### Phase 5: Rebuild and test

7. [ ] **Build and deploy changes**
   - Run: `npm run build`
   - Verify dist/templates contains updated skill

## Testing
- [ ] Verify `analyze-flows.md` skill shows `## Flow N:` format (H2 headers)
- [ ] Run `agentflow analyze` on a test project and check flows.md output uses correct format
- [ ] Run `agentflow flows` and verify it successfully parses flow names
- [ ] Verify flows.md contains flow analysis, not style analysis
- [ ] Test error message when flows.md has wrong format (manually create bad file)
- [ ] Test with project that has no flows.md (should show "run analyze first" message)

## Rollback Plan
1. Revert changes to:
   - `src/templates/skills/analysis/analyze-flows.md`
   - `src/commands/flows.ts`
2. Rebuild: `npm run build`
3. For existing projects, manually fix flows.md or re-run analyze

---

Would you like me to save this plan to `plans/bugs/BUG-008-flows-command-format-mismatch.md`? I'll need write permissions to do so.
