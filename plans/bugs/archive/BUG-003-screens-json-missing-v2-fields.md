# BUG-003: screens.json Missing v2.0 Fields

## Problem Description

After running `agentflow analyze 10 --useAssets`, the generated `screens.json` file only contains a minimal structure:

```json
{
  "version": "2.0",
  "screens": ["screen-name.html", ...],
  "coverage": {
    "totalScreens": 431,
    "screensInFlows": 431,
    "orphanedScreens": [],
    "coveragePercent": 100
  }
}
```

**Expected v2.0 fields that are missing:**
- `userflows` - Array of user flow objects with screen sequences
- `components` - Array of all unique UI components
- `screenComponents` - Mapping of screen to required components
- `icons` - Array of all unique icons
- `screenIcons` - Mapping of screen to required icons
- `apps` - Array of app definitions with sections
- `enhancedScreens` - Detailed screen metadata with navigation state

## Root Cause Analysis

### Primary Cause: Claude Agent Non-Compliance
The analyze command at `src/commands/analyze.ts:662-739` correctly specifies the v2.0 JSON schema in the prompt sent to Claude. However, the Claude agent processing the `analyze-screens` skill returned a truncated response with only the minimal fields.

**Evidence:**
1. The skill file (`skills/analysis/analyze-screens.md:144-296`) clearly documents the required v2.0 output format
2. The analyze command prompt (lines 686-738) explicitly requests v2.0 format with all fields
3. The output JSON has `"version": "2.0"` indicating the agent acknowledged the schema request
4. But critical fields (`userflows`, `components`, `screenComponents`, `icons`, `screenIcons`, `apps`) are absent

### Contributing Factors

1. **Large Screen Count (431 screens)**: The project has 431 screens across 2 apps, making the full v2.0 JSON extremely large. The Claude agent may have:
   - Hit token output limits
   - Simplified output to avoid exceeding limits
   - Lost context mid-generation

2. **Prompt Complexity**: The prompt includes:
   - Screen inventory (431 screens)
   - Flows analysis output
   - Project brief
   - Icon inventory
   - v2.0 schema specification
   This may cause the model to prioritize some parts over others.

3. **No Output Validation**: The code at lines 741-811 writes whatever JSON the agent returns without validating v2.0 field completeness. It only logs what fields exist but doesn't enforce requirements.

## Implementation Steps

### Step 1: Add Output Validation
**File:** `src/commands/analyze.ts`

Add validation after parsing the screens JSON to check for required v2.0 fields:

```typescript
// After line 751: const parsed = JSON.parse(jsonContent);
const requiredV2Fields = ['userflows', 'components', 'screenComponents', 'icons', 'screenIcons'];
const missingFields = requiredV2Fields.filter(field => !parsed[field]);

if (missingFields.length > 0) {
  console.warn(`  Warning: screens.json missing v2.0 fields: ${missingFields.join(', ')}`);
  console.warn('  Re-running screens analysis with explicit field requirements...');
  // Retry logic here
}
```

### Step 2: Split Large Requests
For projects with 100+ screens, split the screens analysis into batches:

1. First pass: Generate `userflows` from flows.md
2. Second pass: Generate `screenComponents` for batches of 50-100 screens
3. Third pass: Generate `screenIcons` for batches of 50-100 screens
4. Merge results into final v2.0 JSON

### Step 3: Enforce Simpler Output First
For large projects, request a tiered output:
1. First request: Core `userflows` structure only
2. Second request: `components` and `screenComponents`
3. Third request: `icons` and `screenIcons`
4. Fourth request: `apps` structure

### Step 4: Add Retry with Focused Prompts
If initial output is incomplete, retry with more focused prompts:

```typescript
async function retryScreensAnalysis(
  projectDir: string,
  systemPrompt: string,
  initialResult: any,
  missingFields: string[]
): Promise<any> {
  // Build targeted prompt for missing fields
  const focusedPrompt = `
The previous screens analysis is missing these fields: ${missingFields.join(', ')}

Given this partial result:
${JSON.stringify(initialResult, null, 2)}

Please generate ONLY the missing fields in this format:
{
  ${missingFields.map(f => `"${f}": ...`).join(',\n  ')}
}
`;
  // Run worker and merge results
}
```

### Step 5: Update Skill Documentation
**File:** `skills/analysis/analyze-screens.md`

Add explicit size guidance:
```markdown
## Large Project Handling (100+ screens)

For projects with 100+ screens, you MAY output in phases:

**Phase 1 Response:** Core structure
- version, screens, userflows, coverage

**Phase 2 Response:** Components (if requested)
- components, screenComponents

**Phase 3 Response:** Icons (if requested)
- icons, screenIcons

Each phase must be valid JSON that can be merged.
```

## Testing Checklist

- [ ] Run `agentflow analyze` on small project (<50 screens) - verify all v2.0 fields present
- [ ] Run `agentflow analyze` on medium project (50-150 screens) - verify all v2.0 fields present
- [ ] Run `agentflow analyze 10 --useAssets` on gotribe project (431 screens) - verify all v2.0 fields present
- [ ] Verify `validateFlowCoverage()` works with complete v2.0 output
- [ ] Verify downstream commands (mockups, screens) can consume the full v2.0 schema
- [ ] Test retry logic triggers when fields are missing
- [ ] Test batch processing for large projects

## Rollback Plan

If the fix causes issues:
1. Revert changes to `src/commands/analyze.ts`
2. Keep skill documentation changes (they're informational)
3. The minimal output (screens array + coverage) is still usable for basic workflows

## Files to Modify

1. `src/commands/analyze.ts` - Add validation and retry logic
2. `src/lib/verification.ts` - Add v2.0 field completeness check
3. `skills/analysis/analyze-screens.md` - Add large project guidance
4. `src/lib/navigation-schema.ts` - Ensure types match expected v2.0 fields

## Priority

**High** - The v2.0 fields are critical for:
- `screenComponents` mapping drives stylesheet component generation
- `screenIcons` mapping drives icon integration
- `userflows` structure drives flow-based mockups
- `apps` structure enables multi-app projects

Without these fields, downstream commands will produce incomplete output.
