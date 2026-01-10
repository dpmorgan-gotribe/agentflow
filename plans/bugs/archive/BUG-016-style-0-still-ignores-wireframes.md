# BUG-016: Style-0 Still Ignores Wireframes (Read Tool Not Being Used)

## Problem
Even after enabling the Read tool and `--add-dir` for style-0, Claude is not actually using the Read tool to view wireframe images. The generated mockup uses generic layouts instead of matching the wireframes.

## Root Cause Analysis

**The instructions are contradictory.** We enabled the Read tool but multiple prompt elements tell Claude NOT to use tools:

### Issue 1: RAW_OUTPUT_ENFORCEMENT (agent.ts:34-54)
```
NEVER use Write, Edit, or Bash tools - they are disabled.
Your entire response will be captured and saved as a file. Output ONLY the file content.
```
This implies "don't use tools, just output content" - Claude interprets this as "skip Read too".

### Issue 2: --append-system-prompt
```
Output ONLY the requested content. No preamble, no postamble, no explanations. Start immediately with the content.
```
This reinforces "don't do anything except output HTML".

### Issue 3: Prompt Structure
The prompt says "USE IT to view wireframe images" but then immediately says "Output ONLY raw HTML. Start with <!DOCTYPE html>". Claude prioritizes the output instruction over the Read instruction.

**Result:** Claude sees conflicting instructions and chooses to skip the Read tool entirely, outputting generic HTML immediately.

## Solution

When `allowRead` is enabled, we need to:
1. Modify instructions to explicitly REQUIRE reading images BEFORE outputting
2. Update RAW_OUTPUT_ENFORCEMENT to permit Read tool usage
3. Structure the prompt as a two-phase task: (1) Read wireframes, (2) Output HTML

## Implementation Steps

1. [x] Add `allowRead`-aware version of RAW_OUTPUT_ENFORCEMENT in agent.ts
2. [x] When allowRead=true, prepend "PHASE 1: Read all wireframe images first" instruction
3. [x] Modify mockups.ts style-0 prompt to require explicit wireframe reading step
4. [x] Update append-system-prompt to allow Read tool when enabled
5. [x] Test style-0 mockup generation
6. [x] Verify wireframe layouts are reflected in output

## Result

Style-0 now correctly reads wireframes and reflects their structure:
- Bottom navigation matches wireframe pattern (Home, Discover, Tribes, Chat, Profile)
- Uses user's actual icons from assets/icons/
- Header structure matches wireframe (menu, logo, notification badges)

## Code Changes

### `src/lib/agent.ts` - Lines 34-54

Add a variant for when Read is allowed:

```typescript
const RAW_OUTPUT_ENFORCEMENT_WITH_READ = `
## CRITICAL OUTPUT RULES

You are running in a pipeline. You have access to the Read tool for viewing images.

PHASE 1 - REQUIRED: First, use the Read tool to view ALL wireframe images listed.
PHASE 2: After viewing wireframes, output the requested content.

Output rules:
1. Start your FINAL response with the content (e.g., <!DOCTYPE html>)
2. End with the content (no postamble)
3. Do NOT wrap output in markdown code fences
4. NEVER use Write, Edit, or Bash tools - only Read is available

Your entire response will be captured and saved as a file.
`;
```

### `src/lib/agent.ts` - invokeAgent function

```typescript
// Choose enforcement based on allowRead
const enforcement = allowRead
  ? RAW_OUTPUT_ENFORCEMENT_WITH_READ
  : RAW_OUTPUT_ENFORCEMENT;

const finalSystemPrompt = enforceRawOutput
  ? `${systemPrompt}\n\n${enforcement}`
  : systemPrompt;

// Update append-system-prompt based on allowRead
const appendPrompt = allowRead
  ? 'First read all referenced images using the Read tool, then output the requested content.'
  : 'Output ONLY the requested content. No preamble, no postamble, no explanations.';
```

### `src/commands/mockups.ts` - Style-0 instructions

Make wireframe reading mandatory:

```typescript
const assetInstructions = isStyle0
  ? `## MANDATORY: Read Wireframes First

BEFORE generating any HTML, you MUST:
1. Use the Read tool to view EACH wireframe image in assets/wireframes/
2. Analyze the layout, navigation, and component placement
3. Note the screen flow and information architecture

Wireframe directory: ${join(projectDir, 'assets', 'wireframes')}
Wireframes to read: ${userAssets.wireframes.slice(0, 10).join(', ')}

After reading wireframes, create HTML that MATCHES their layouts.
...`
```

## Testing

- [ ] Run `agentflow mockups` on gotribev2
- [ ] Check style-0.html reflects wireframe layouts (bottom nav, card layouts, etc.)
- [ ] Verify Claude actually calls Read tool (check for image analysis in output before HTML)
- [ ] Confirm styles 1-4 still work without Read tool

## Estimated Impact

- Style-0 mockups will accurately reflect user's wireframe layouts
- Slightly longer generation time for style-0 (needs to read images first)
- No impact on styles 1-4 (they don't use Read tool)
