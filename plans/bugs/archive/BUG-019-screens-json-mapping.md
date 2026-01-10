# BUG-019: Add screens.json for Userflow-to-Screens Mapping

## Problem
The current `agentflow screens` command extracts screen names by regex from flow HTML files (`id="screen-(\w+)"`). This is:
1. Fragile - depends on specific HTML id convention
2. Loses context - doesn't know which flow each screen belongs to
3. Not reusable - can't easily display screens organized by userflow later

## Proposed Solution
Have the analyst output a `screens.json` file with:
1. A flat `screens` array for quick access to all screens
2. A `userflows` array that groups screens by flow

```json
{
  "screens": [
    "splash.html",
    "interests.html",
    "journey.html",
    "register.html",
    "tribe-type.html",
    "tribe-info.html",
    "tribe-vision.html"
  ],
  "userflows": [
    {
      "id": "onboarding",
      "name": "Seeker Onboarding",
      "screens": [
        { "id": "splash", "name": "Splash Screen", "file": "splash.html" },
        { "id": "interests", "name": "Interest Selection", "file": "interests.html" },
        { "id": "journey", "name": "Journey Stage", "file": "journey.html" },
        { "id": "register", "name": "Account Creation", "file": "register.html" }
      ]
    },
    {
      "id": "tribe-creation",
      "name": "Tribe Creation Wizard",
      "screens": [
        { "id": "tribe-type", "name": "Creation Type", "file": "tribe-type.html" },
        { "id": "tribe-info", "name": "Basic Information", "file": "tribe-info.html" },
        { "id": "tribe-vision", "name": "Vision & Purpose", "file": "tribe-vision.html" }
      ]
    }
  ]
}
```

## Benefits
1. **Reliable screen extraction** - no regex parsing needed
2. **Userflow context preserved** - screens grouped by flow
3. **Reusable metadata** - can generate flow viewers, navigation, sitemaps
4. **Human readable** - easy to review and edit if needed

## Implementation Steps

### Phase 1: Analyst outputs screens.json

1. [ ] **Create new analyst skill: analyze-screens.md** - Extract screens from flows.md and output JSON
   - Parse each "## Flow N: Name" section
   - Extract screen references (bullet points, numbered lists)
   - Generate unique IDs and filenames
   - Output valid JSON

2. [ ] **Update analyze.ts** - Add screens worker to parallel analysis
   ```typescript
   {
     id: 'screens',
     skill: 'analysis/analyze-screens',
     outputFile: 'screens.json'
   }
   ```

3. [ ] **Update analyze.ts output** - Write screens.json to outputs/analysis/

### Phase 2: Screens command uses screens.json

4. [ ] **Update screens.ts** - Load screens.json as primary source
   ```typescript
   // Try screens.json first
   let screenList: string[];
   let userflows: Userflow[] = [];
   try {
     const screensJson = await readFile(
       join(projectDir, 'outputs', 'analysis', 'screens.json'),
       'utf-8'
     );
     const data = JSON.parse(screensJson);
     screenList = data.screens;  // Simple flat array
     userflows = data.userflows; // Keep for context
     console.log(`Loaded ${screenList.length} screens from screens.json`);
   } catch {
     // Fall back to regex extraction from flows
     console.log('screens.json not found, extracting from flow HTMLs...');
     screenList = extractFromFlowHtmls();
   }
   ```

5. [ ] **Preserve userflow context** - Pass flow info to screen generator
   ```typescript
   // Include which flow this screen belongs to
   userPrompt: `Create screen: ${screen.name}
   Part of flow: ${userflow.name}
   Previous screen: ${prevScreen?.name || 'None'}
   Next screen: ${nextScreen?.name || 'None'}`
   ```

6. [ ] **Output screens by flow** - Organize output directory
   ```
   outputs/screens/
   ├── onboarding/
   │   ├── splash.html
   │   ├── interests.html
   │   └── register.html
   └── tribe-creation/
       ├── tribe-type.html
       └── tribe-info.html
   ```

### Phase 3: Update flows command for consistency

7. [ ] **Update flows.ts** - Read screens.json when generating flow mockups
   - Use exact screen IDs from JSON
   - Ensure `id="screen-{id}"` matches JSON

8. [ ] **Validate consistency** - Check that flow HTMLs match screens.json

## Testing

- [ ] Run `agentflow analyze 5` - verify screens.json is created
- [ ] Verify screens.json has valid structure with all flows from flows.md
- [ ] Run `agentflow screens` - verify it reads from screens.json
- [ ] Verify screens are organized by userflow in output directory
- [ ] Test fallback: delete screens.json, run screens, verify regex fallback works

## Files to Modify

1. `src/templates/skills/analysis/analyze-screens.md` - New skill
2. `src/commands/analyze.ts` - Add screens worker
3. `src/commands/screens.ts` - Use screens.json
4. `src/commands/flows.ts` - Reference screens.json for consistency
