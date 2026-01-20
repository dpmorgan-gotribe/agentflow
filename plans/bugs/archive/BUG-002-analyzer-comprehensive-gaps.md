# BUG-002: Comprehensive Analyzer Gaps - Multi-Platform, Flow Coverage, and v2.0 Schema

## Problem Summary

Running `agentflow analyze` produces incomplete output with multiple critical gaps:

| Issue | Severity | Impact |
|-------|----------|--------|
| Admin portal (221 screens) not analyzed | Critical | 50% of app missing |
| 67% of screens orphaned (not in flows) | High | Incomplete userflows |
| v2.0 schema fields missing from screens.json | High | No navigation context |
| Brief's JSON navigation schema ignored | High | Screen definitions unused |
| Only 10 flows generated (9+ missing) | Medium | Incomplete journeys |
| ~28 icons missing from mapping | Medium | Incomplete asset list |
| ~20-30 components missing | Medium | Incomplete component list |

## Root Cause Analysis

### Issue 1: Admin Portal Not Analyzed (221 screens missing)

**Root Cause**: Platform detection only finds `brief-{platform}.md` files

**File**: `src/lib/platforms.ts`
**Lines**: 20-32

```typescript
export async function detectPlatforms(projectDir: string): Promise<string[]> {
  const files = await readdir(projectDir);
  const briefFiles = files.filter(f => /^brief-(.+)\.md$/.test(f));
  return briefFiles.map(f => {
    const match = f.match(/^brief-(.+)\.md$/);
    return match ? match[1] : '';
  }).filter(Boolean);
}
```

**Problem**:
- gotribe____ project has ONE consolidated `brief.md` containing ALL apps (webapp + admin)
- No `brief-webapp.md` or `brief-admin.md` files exist
- `detectPlatforms()` returns `[]` (empty array)
- `isMultiPlatform()` returns `false`
- Analyzer takes "single-platform" path which ignores the JSON navigation schema

**Evidence**:
- `brief.md` contains JSON with `"gotribe-webapp"` (210 screens) AND `"gotribe-admin"` (221 screens)
- This JSON is completely ignored in single-platform mode

### Issue 2: Brief's JSON Navigation Schema Ignored

**Root Cause**: Single-platform code path doesn't extract screens from brief JSON

**File**: `src/commands/analyze.ts`
**Lines**: 513-543 (single-platform screens worker)

```typescript
userPrompt: `Extract all screens...from the flows analysis below.

## Flows Analysis
${stripPreamble(flowsResult.output)}  // <-- Primary source

## Project Brief (for component and icon context)  // <-- Secondary/ignored
${combinedBrief || 'No brief provided.'}
```

**Problem**:
- Screens are extracted FROM FLOWS OUTPUT, not from brief
- Brief is passed only "for component and icon context"
- The detailed JSON navigation schema in brief is not parsed

**Compare to multi-platform path** (lines 382-388):
```typescript
## Platform Screen Inventory
${platformBrief.content}  // <-- Explicitly passes platform brief as PRIMARY source
```

### Issue 3: Only 33% Flow Coverage (67% Orphaned Screens)

**Root Cause**: Multi-layered failure

1. **Flows are generated from wireframes + research, not from brief screens**
   - File: `src/commands/analyze.ts` lines 454-481
   - Flows worker receives wireframes and research, but brief is only "context"
   - Claude generates flows based on what it sees in wireframes (22 images)
   - 210 screens can't all be covered by 22 wireframe images

2. **Coverage enforcement in skill is ineffective**
   - File: `src/templates/skills/analysis/analyze-flows.md` lines 43-52
   - Skill says "Every screen defined in the brief MUST appear in at least one flow"
   - BUT: Claude doesn't have a structured screen list to verify against
   - The brief is prose/JSON, not a simple list Claude can check

3. **Screens worker extracts FROM flows, not FROM brief**
   - File: `src/commands/analyze.ts` lines 513-543
   - Prompt says: "Extract all screens...from the flows analysis below"
   - If a screen isn't in a flow, it won't appear in screens.json

### Issue 4: v2.0 Schema Fields Missing

**Root Cause**: Prompt template uses legacy JSON format

**File**: `src/commands/analyze.ts`
**Lines**: 527-541

```typescript
Output ONLY valid JSON with this structure:
{
  "screens": ["screen-name.html", ...],
  "userflows": [...],
  "components": [...],
  "screenComponents": {...},
  "icons": [...],
  "screenIcons": {...}
}
```

**Missing fields from v2.0 schema** (defined in `analyze-screens.md` lines 144-272):
- `"version": "2.0"`
- `"apps"` - array of app definitions with navigation
- `"enhancedScreens"` - screens with navigation state
- `"coverage"` - coverage metadata

**Problem**: The skill documentation shows v2.0 format, but the command prompt uses legacy format.

### Issue 5: Missing Flows (9+ critical journeys)

**Root Cause**: Flows generated from wireframes, not comprehensive brief

The brief defines these flows that wireframes don't cover:
- Retreat booking to attendance (14 screens)
- New member onboarding post-join (4 screens)
- Campaign creation & donation (5 screens)
- Work/task logging (6 screens)
- Wiki contribution (4 screens)
- Treasury management (7 screens)
- Document management (5 screens)
- Offering booking (7 screens)
- Seller management (6 screens)

Since wireframes only cover 22 screens, Claude can't generate flows for unseen screens.

### Issue 6: Missing Icons (~28) and Components (~20-30)

**Root Cause**: Derived from flows/screens that are themselves incomplete

If flows miss 141 screens, icon/component mapping will miss:
- Icons used only on orphaned screens
- Components needed only for orphaned screens

---

## Implementation Plan

### Phase 1: Parse JSON Navigation Schema from Brief

**Goal**: Extract apps and screens directly from the brief's JSON schema

**File**: `src/lib/brief.ts` (new or extend existing)

**New Functions**:

```typescript
interface BriefNavigationSchema {
  version: string;
  apps: {
    [appId: string]: {
      appId: string;
      appName: string;
      appType: string;
      layoutSkill: string;
      sections: {
        [sectionId: string]: {
          sectionId: string;
          sectionName: string;
          screens: Array<{
            id: string;
            file: string;
            description: string;
          }>;
        };
      };
    };
  };
}

/**
 * Extract navigation schema from brief JSON block
 */
export function extractNavigationSchema(briefContent: string): BriefNavigationSchema | null {
  // Find JSON block in brief
  const jsonMatch = briefContent.match(/```json\s*\n(\{[\s\S]*?"apps"[\s\S]*?\})\s*\n```/);
  if (!jsonMatch) return null;

  try {
    return JSON.parse(jsonMatch[1]);
  } catch {
    return null;
  }
}

/**
 * Extract all screens from navigation schema
 */
export function extractAllScreensFromSchema(schema: BriefNavigationSchema): {
  appId: string;
  screens: Array<{ id: string; file: string; section: string; description: string }>;
}[] {
  const result = [];

  for (const [appId, app] of Object.entries(schema.apps)) {
    const appScreens = [];
    for (const [sectionId, section] of Object.entries(app.sections)) {
      for (const screen of section.screens) {
        appScreens.push({
          id: screen.id,
          file: screen.file,
          section: sectionId,
          description: screen.description
        });
      }
    }
    result.push({ appId, screens: appScreens });
  }

  return result;
}
```

### Phase 2: Update analyze.ts to Use Brief Schema

**File**: `src/commands/analyze.ts`

**Changes**:

#### 2A: Detect apps from brief JSON (after line 108)

```typescript
import { extractNavigationSchema, extractAllScreensFromSchema } from '../lib/brief.js';

// After loading combinedBrief (line 109)
const briefSchema = extractNavigationSchema(combinedBrief);
const briefApps = briefSchema ? extractAllScreensFromSchema(briefSchema) : [];

if (briefApps.length > 0) {
  console.log(`Found ${briefApps.length} app(s) in brief schema:`);
  for (const app of briefApps) {
    console.log(`  ${app.appId}: ${app.screens.length} screens`);
  }
}
```

#### 2B: Generate screen list for flows worker (modify lines 454-481)

```typescript
// Build comprehensive screen list from brief schema
const screenListForFlows = briefApps.length > 0
  ? `## Screen Inventory from Brief
${briefApps.map(app => `
### ${app.appId} (${app.screens.length} screens)
${app.screens.map(s => `- ${s.id}: ${s.description}`).join('\n')}
`).join('\n')}

**CRITICAL**: Every screen listed above MUST appear in at least one flow.
Create additional flows (e.g., "Settings Flow", "Financial Flow", "Admin Operations") to cover all screens.
`
  : '';

const flowsResult = await runWorkerSequential({
  id: 'flows',
  // ... existing config
  userPrompt: `Analyze user flows and journeys for this project.
${wireframeReadInstruction}

${screenListForFlows}

CRITICAL: Output USER FLOWS only...`
});
```

#### 2C: Pass screen list to screens worker with v2.0 format (modify lines 510-543)

```typescript
// Build screen inventory from brief
const briefScreenInventory = briefApps.length > 0
  ? `## Complete Screen Inventory from Brief
${briefApps.map(app => `
### App: ${app.appId}
| Screen ID | File | Section | Description |
|-----------|------|---------|-------------|
${app.screens.map(s => `| ${s.id} | ${s.file} | ${s.section} | ${s.description} |`).join('\n')}
`).join('\n')}

**CRITICAL**: Your output MUST include ALL screens from this inventory.
If a screen is not in any flow, add it to a "Miscellaneous" flow.
`
  : '';

const screensResult = await runWorkerSequential({
  id: 'screens',
  systemPrompt: `${systemPrompt}\n\n## Skill\n\n${screensSkill}`,
  userPrompt: `Extract all screens, components, and icons.

${briefScreenInventory}

## Flows Analysis (for userflow mapping)
${stripPreamble(flowsResult.output)}

## Project Brief
${combinedBrief || 'No brief provided.'}

${iconInventoryForScreens}

OUTPUT v2.0 JSON FORMAT with these fields:
{
  "version": "2.0",
  "screens": [...],
  "userflows": [...],
  "components": [...],
  "screenComponents": {...},
  "icons": [...],
  "screenIcons": {...},
  "apps": [
    {
      "appId": "webapp",
      "appName": "...",
      "appType": "webapp",
      "sections": [...]
    }
  ],
  "enhancedScreens": [...],
  "coverage": {
    "totalScreens": N,
    "screensInFlows": N,
    "orphanedScreens": [...],
    "coveragePercent": 100
  }
}

CRITICAL: Include ALL screens from the brief inventory above.
Coverage MUST be 100% - create "Miscellaneous" flow for orphans.`
});
```

### Phase 3: Update Skills to Enforce Coverage

**File**: `src/templates/skills/analysis/analyze-flows.md`

**Add after line 52**:

```markdown
## Screen List Enforcement

If a "Screen Inventory from Brief" section is provided in the input:
1. Parse the complete screen list
2. Track which screens appear in your flows
3. After defining all primary flows, check for orphaned screens
4. Create additional flows to cover orphans:
   - "Settings & Profile Flow" for settings-*, profile-* screens
   - "Financial Management Flow" for wallet-*, transaction-*, payment-* screens
   - "Tribe Administration Flow" for tribe-admin-*, tribe-treasury-* screens
   - "Content Management Flow" for wiki-*, document-*, media-* screens
   - "Miscellaneous Flow" for any remaining orphans

Your output MUST achieve 100% coverage of the provided screen list.
```

**File**: `src/templates/skills/analysis/analyze-screens.md`

**Replace lines 144-146** with explicit v2.0 requirement:

```markdown
## Output Format (v2.0 REQUIRED)

Your JSON output MUST include ALL of these fields - the v2.0 schema is MANDATORY:
```

### Phase 4: Add Coverage Validation

**File**: `src/commands/analyze.ts`

**Add after screens output (around line 567)**:

```typescript
// Validate coverage against brief
if (briefApps.length > 0) {
  const totalBriefScreens = briefApps.reduce((sum, app) => sum + app.screens.length, 0);
  const briefScreenIds = new Set(briefApps.flatMap(app => app.screens.map(s => s.id)));

  const generatedScreens = new Set(
    parsed.screens.map((s: string) => s.replace('.html', ''))
  );

  const missingScreens = [...briefScreenIds].filter(id => !generatedScreens.has(id));

  if (missingScreens.length > 0) {
    console.warn(`\n  Warning: ${missingScreens.length} screens from brief not in output:`);
    missingScreens.slice(0, 10).forEach(s => console.warn(`    - ${s}`));
    if (missingScreens.length > 10) {
      console.warn(`    ... and ${missingScreens.length - 10} more`);
    }
  } else {
    console.log(`  Coverage: 100% (${totalBriefScreens} screens from brief)`);
  }
}
```

### Phase 5: Fix --useAssets for All Workers (From BUG-001)

See `BUG-001-useAssets-flag-ignored.md` for details. Summary:

**File**: `src/commands/analyze.ts` lines 269-287

Pass `useAssets` mode to `assets` and `inspirations` workers, not just `styles`.

---

## Testing Checklist

### Test Case 1: Consolidated Brief with Multiple Apps
```bash
cd projects/gotribe____
agentflow analyze 3 --useAssets
```

**Expected**:
- [ ] Console shows "Found 2 app(s) in brief schema: gotribe-webapp (210), gotribe-admin (221)"
- [ ] flows.md contains flows covering both webapp and admin screens
- [ ] screens.json includes ALL 431 screens (210 + 221)
- [ ] screens.json has `"version": "2.0"` and `"apps"` array
- [ ] Coverage is 100% (no orphaned screens)

### Test Case 2: Separate Platform Briefs (Existing Behavior)
```bash
cd projects/gotribe
agentflow analyze 3
```

**Expected**:
- [ ] Detects brief-webapp.md and brief-backend.md
- [ ] Multi-platform path triggers
- [ ] Platform-specific outputs generated

### Test Case 3: Flow Coverage Enforcement
```bash
cd projects/gotribe____
agentflow analyze 1
```

**Expected**:
- [ ] flows.md includes "Settings & Profile Flow" or similar for orphan coverage
- [ ] flows.md includes "Financial Management Flow"
- [ ] flows.md includes "Tribe Administration Flow"
- [ ] All 210 webapp screens appear in at least one flow

### Test Case 4: v2.0 Schema Fields
```bash
cat outputs/analysis/screens.json | jq '.version, .apps, .coverage'
```

**Expected**:
- [ ] `"version": "2.0"`
- [ ] `"apps"` array with webapp and admin definitions
- [ ] `"coverage"` object with `totalScreens`, `screensInFlows`, `coveragePercent: 100`

### Test Case 5: Complete Icon and Component Coverage
```bash
cat outputs/analysis/screens.json | jq '.icons | length, .components | length'
```

**Expected**:
- [ ] At least 50 icons (not just 22)
- [ ] At least 60 components (not just 42)

---

## Files to Modify

| File | Changes | Lines Affected |
|------|---------|----------------|
| `src/lib/brief.ts` | Add `extractNavigationSchema()` and `extractAllScreensFromSchema()` | New ~80 lines |
| `src/commands/analyze.ts` | Parse brief schema, pass to workers, validate coverage | ~100 lines modified |
| `src/templates/skills/analysis/analyze-flows.md` | Add screen list enforcement section | ~30 lines added |
| `src/templates/skills/analysis/analyze-screens.md` | Emphasize v2.0 requirement | ~10 lines modified |

---

## Rollback Plan

1. **Revert all changes**:
   ```bash
   git checkout HEAD~1 -- src/commands/analyze.ts
   git checkout HEAD~1 -- src/lib/brief.ts
   git checkout HEAD~1 -- src/templates/skills/analysis/analyze-flows.md
   git checkout HEAD~1 -- src/templates/skills/analysis/analyze-screens.md
   npm run build
   ```

2. **Clear outputs**:
   ```bash
   rm -rf projects/*/outputs/analysis/
   ```

---

## Dependencies

- **BUG-001** (--useAssets flag): Should be fixed first or in parallel
- No external dependencies

---

## Summary

The analyzer has fundamental issues with how it extracts screens:

1. **It relies on wireframes and flows**, not the comprehensive brief
2. **It doesn't parse the JSON navigation schema** in the brief
3. **It uses legacy JSON format** instead of v2.0
4. **Coverage enforcement is ineffective** without a structured screen list

The fix requires:
1. Parsing the brief's JSON schema to get ALL screens
2. Passing this screen list to flows and screens workers
3. Enforcing 100% coverage in the skill prompts
4. Using v2.0 JSON format in the output prompt
5. Validating coverage after generation

This is a significant change but essential for the analyzer to work with comprehensive briefs like GoTribe's.
