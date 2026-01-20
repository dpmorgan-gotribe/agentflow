# BUG-010: GoTribe Tree Analysis Issues

## Summary
Three related issues discovered during the gotribe_tree project run:
1. Missing `admin-screens.json` - admin portal screens not extracted
2. Stylesheet `--style=N` does not match mockup N visually
3. Screen extraction misses 75% of screens (118 of 483 expected)

---

## Issue 1: Missing admin-screens.json

### Problem
The analyze command generated only `webapp-screens.json` but not `admin-screens.json`, despite the brief clearly defining an "ADMIN PORTAL [separate app]" section with ~80 screens.

### Root Cause
The `extractNavigationSchema()` function in `src/lib/brief.ts` looks for a **JSON code block** containing an `"apps"` key. When this isn't found, `briefApps` is empty, so only a single `webapp-screens.json` is generated.

**The fundamental issue:** The code tries to pre-parse the brief format in TypeScript, but briefs can be in ANY format - tree structure, JSON, markdown tables, or plain prose. This should be the analyst agent's job, not rigid code parsing.

### Evidence
- Brief contains: `└── ADMIN PORTAL [separate app]` (tree format, line 930)
- Brief contains ~80 admin screens: `pages:[admin-dashboard.html]`, etc.
- `extractNavigationSchema()` expects specific JSON format
- Result: Only webapp-screens.json generated, no admin-screens.json

---

## Issue 2: Stylesheet --style=N Does Not Match Mockup N

### Problem
When `--useAssets` is used, mockups 0-19 are generated with visual variety (different typography, spacing, component styling). However, when running `stylesheet --style=5` (or any N > 0), the generated stylesheet does NOT visually match `style-5.html` mockup.

**Expected behavior:** If I generate 20 mockups with `--useAssets` and run `stylesheet --style=15`, the resulting `showcase.html` should look like `style-15.html` mockup.

**Actual behavior:** The stylesheet looks like style-0 regardless of which style number is selected.

### Root Cause Analysis
Looking at `stylesheet.ts`, the code DOES load the correct mockup:

```typescript
// Line 116 - This correctly loads style-N.html
mockupContent = await readFile(join(mockupsDir, `style-${styleNum}.html`), 'utf-8');
```

And the prompt DOES include the mockup:
```typescript
userPrompt = `Create a complete design system based on style ${styleNum}...

## Selected Mockup HTML Reference
The following HTML is the approved mockup for Style ${styleNum}. Your design system MUST match its styling EXACTLY.

\`\`\`html
${mockupContent}
\`\`\`
```

**The bug is in agent behavior, not code logic.** The agent is:
1. Receiving the correct mockup HTML in the prompt
2. NOT faithfully replicating the mockup's unique styling
3. Defaulting to generic/style-0 patterns instead

### Potential Causes
1. **Prompt not emphatic enough** - Agent doesn't understand it must MATCH the specific mockup
2. **Mockup HTML too long / truncated** - Embedding large HTML inline may cause truncation, agent misses unique details
3. **Style definitions overriding** - `styles.md` content may be given more weight than the mockup HTML
4. **Agent confusion** - Multiple style references in prompt may confuse which to follow

### Fix Required

#### Fix 1: Use File Paths with Read Access (CRITICAL)
**Don't embed large files inline - give file paths and read access instead.**

Current approach (problematic):
```typescript
// Embeds entire mockup HTML in prompt - can be truncated
mockupContent = await readFile(join(mockupsDir, `style-${styleNum}.html`), 'utf-8');
userPrompt = `...
\`\`\`html
${mockupContent}  // Could be 500+ lines, gets truncated
\`\`\`
`;
```

Better approach:
```typescript
// Give agent the file path and read access
const mockupPath = join(mockupsDir, `style-${styleNum}.html`);

const result = await runWorkerSequential({
  id: 'stylesheet',
  systemPrompt: `${systemPrompt}\n\n## Skill\n\n${skill}`,
  userPrompt: `Create a design system that EXACTLY matches the mockup.

## SOURCE OF TRUTH
Read this mockup file: ${mockupPath}

Use the Read tool to examine the mockup HTML. Extract and replicate:
- All CSS variables from :root { }
- Font families
- Spacing values
- Border radius
- Shadow definitions
- Color palette

Your output must visually match this mockup exactly.`,
  allowRead: true,
  addDirs: [mockupsDir]  // Grant read access to mockups directory
});
```

**Benefits:**
- No truncation - agent reads the full file
- Agent can re-read sections as needed
- Cleaner prompts
- Agent has complete context

#### Fix 2: Strengthen prompt instructions
Make it crystal clear the mockup file is the source of truth.

#### Fix 3: Add validation
Compare generated stylesheet CSS variables against mockup CSS variables.

### Proposed Prompt (File Path Approach)
```typescript
userPrompt = `## YOUR ONLY TASK
Create a complete design system that EXACTLY matches mockup ${styleNum}.

## SOURCE OF TRUTH - READ THIS FILE
Mockup file: ${mockupPath}

Use the Read tool to examine the mockup HTML thoroughly. Extract these EXACT values:
- CSS variables (find :root { ... })
- Font family declarations
- Spacing/padding values
- Border radius values
- Shadow definitions
- Color values

## CRITICAL REQUIREMENTS
1. READ the mockup file first using the Read tool
2. Extract ALL CSS variables and values from the mockup
3. Your output MUST use the SAME values as the mockup
4. Do NOT use default values - use what's in the mockup
5. Do NOT use values from styles.md if they differ from the mockup

The mockup file is the FINAL APPROVED DESIGN. Match it exactly.
```

---

## Issue 3: Screen Extraction Misses Most Pages

### Problem
Only 118 screens extracted from brief, but brief defines 483 unique HTML files.

Coverage: **24.4%** (118/483)

### Root Cause - REVISED
The original analysis suggested building a rigid tree parser or JSON parser. **This is the wrong approach.**

**Key insight from user:** Briefs can be in ANY format:
- Tree/ASCII structure (like gotribe_tree)
- JSON code blocks
- Markdown tables
- Plain prose descriptions
- Mixed formats

**The analyst agent's job is to decipher whatever format the brief uses.** We should NOT try to pre-parse briefs in TypeScript code. Instead:

1. Pass the FULL brief content to the analyst agent
2. Instruct the agent to extract ALL screens regardless of format
3. Let the agent figure out the structure
4. Validate completeness of output

### Current Flow Problem
In `analyze.ts`, the code tries to pre-extract apps/screens:
```typescript
const briefSchema = extractBriefSchema(combinedBrief);  // Rigid JSON parser
if (briefSchema) {
  briefApps = extractAllScreensFromSchema(briefSchema);  // Only works with JSON
}
```

When this fails (non-JSON brief), the downstream prompts don't have the full screen inventory, so the agent only extracts what it infers from flows.

### Fix Required - Agent-Centric Approach

**Remove rigid parsing, empower the analyst agent:**

#### Fix 1: Use File Paths with Read Access (CRITICAL)
**Don't embed large briefs inline - give file paths and read access instead.**

The brief can be hundreds or thousands of lines. Embedding it inline may cause:
- Truncation (agent misses screens at the end)
- Context overflow
- Agent skimming instead of reading carefully

Better approach - give the brief file path:
```typescript
const briefPath = join(projectDir, 'brief.md');

const result = await runWorkerSequential({
  id: 'screens-extraction',
  systemPrompt: `${systemPrompt}\n\n## Skill\n\n${skill}`,
  userPrompt: `Extract ALL screens from the project brief.

## BRIEF FILE
Read this file: ${briefPath}

Use the Read tool to examine the entire brief. The brief may use:
- Tree/ASCII format (├── Section pages:[file.html])
- JSON format
- Markdown tables
- Plain text descriptions
- Any combination of formats

## YOUR TASK
1. READ the entire brief file using the Read tool
2. Find EVERY screen/page mentioned (look for .html files)
3. Detect separate apps (look for "separate app", "admin portal", "mobile app", etc.)
4. Output structured JSON with ALL screens

## CRITICAL
- Do NOT skip any screens
- Read the ENTIRE brief, not just the beginning
- If brief is long, read it in sections to ensure complete coverage`,
  allowRead: true,
  addDirs: [projectDir]  // Grant read access to project directory
});
```

#### Fix 2: Format-agnostic instructions
Let the agent handle any brief format - tree, JSON, tables, prose, or mixed.

#### Fix 3: Completeness validation
```typescript
// After agent returns, do a simple regex count of .html files in brief
const briefContent = await readFile(briefPath, 'utf-8');
const briefHtmlFiles = new Set(briefContent.match(/[a-z0-9-]+\.html/g) || []);
const extractedFiles = new Set(result.screens.map(s => s.file));

const missing = [...briefHtmlFiles].filter(f => !extractedFiles.has(f));
const coverage = extractedFiles.size / briefHtmlFiles.size;

if (coverage < 0.9) {
  console.warn(`Warning: Only ${Math.round(coverage*100)}% screen coverage`);
  console.warn(`Brief mentions ${briefHtmlFiles.size} files, extracted ${extractedFiles.size}`);
  if (missing.length <= 10) {
    console.warn(`Missing: ${missing.join(', ')}`);
  }
}
```

#### Fix 4: Multi-app detection by agent
Let the agent identify app boundaries from context clues:
- "ADMIN PORTAL [separate app]"
- "Mobile App"
- "Backend Dashboard"
- Generate separate `{appId}-screens.json` files

2. **Add completeness validation:**
```typescript
// After agent returns, do a simple regex count of .html files in brief
const briefHtmlCount = (combinedBrief.match(/[a-z0-9-]+\.html/g) || []).length;
const extractedCount = result.screens.length;
const coverage = extractedCount / briefHtmlCount;

if (coverage < 0.9) {
  console.warn(`Warning: Only ${Math.round(coverage*100)}% of screens extracted`);
  console.warn(`Brief mentions ~${briefHtmlCount} files, extracted ${extractedCount}`);
}
```

3. **Multi-app detection by agent:**
   - Let the agent identify app boundaries from context clues
   - "ADMIN PORTAL [separate app]"
   - "Mobile App"
   - "Backend Dashboard"
   - Generate separate `{appId}-screens.json` files

---

## Revised Recommendations

### Issue 2 Fix: Stylesheet Mockup Matching
| Task | Effort | Priority |
|------|--------|----------|
| **Use file path + read access instead of inline mockup** | Low | P1 |
| Strengthen prompt to emphasize mockup as source of truth | Low | P1 |
| Add CSS variable validation (mockup vs generated) | Medium | P2 |

### Issue 1 & 3 Fix: Agent-Centric Screen Extraction
| Task | Effort | Priority |
|------|--------|----------|
| **Use file path + read access instead of inline brief** | Low | P1 |
| Remove/deprecate rigid `extractNavigationSchema()` | Low | P1 |
| Update analyze-screens skill with format-agnostic instructions | Medium | P1 |
| Add multi-app detection instructions to agent prompt | Medium | P1 |
| Add completeness validation (html file count check) | Low | P2 |
| Generate separate screens.json per detected app | Medium | P1 |

---

## Implementation Approach

### Phase 1: File Path Pattern (CRITICAL)
1. Update `stylesheet.ts` to pass mockup file PATH instead of inline content
2. Update `analyze.ts` to pass brief file PATH instead of inline content
3. Add `allowRead: true` and `addDirs: [...]` to worker configs
4. Update prompts to instruct agent to use Read tool

### Phase 2: Prompt Updates
1. Update stylesheet prompt to emphasize mockup file as source of truth
2. Update analyze-screens skill with format-agnostic extraction instructions
3. Add multi-app detection instructions

### Phase 3: Validation
1. Add coverage validation (compare extracted vs brief html count)
2. Add stylesheet validation (compare CSS variables)
3. Add console warnings when coverage is low

### Phase 4: Multi-App Support
1. Let agent detect multiple apps from brief context
2. Generate separate `{appId}-screens.json` files
3. Update downstream commands to handle multiple screen files

---

## Testing Checklist

### File Path Pattern
- [ ] Verify stylesheet agent receives mockup file PATH (not inline content)
- [ ] Verify analyze agent receives brief file PATH (not inline content)
- [ ] Verify agents use Read tool to access files
- [ ] Verify no truncation of large files

### Stylesheet Mockup Matching
- [ ] Generate mockups 0-19 with --useAssets
- [ ] Verify style-5.html has different fonts/spacing than style-0.html
- [ ] Run stylesheet --style=5
- [ ] Verify showcase.html fonts/spacing match style-5.html mockup
- [ ] Verify showcase.html CSS variables match style-5.html CSS variables

### Screen Extraction
- [ ] Run analyze on gotribe_tree brief
- [ ] Verify agent reads entire brief file (check for Read tool usage)
- [ ] Verify both webapp-screens.json AND admin-screens.json generated
- [ ] Verify 450+ screens extracted (>90% coverage)
- [ ] Verify coverage warning appears if extraction is incomplete
- [ ] Verify no screens from end of brief are missing (truncation check)

---

## Key Principles

### Principle 1: Don't fight the LLM - use it.

Instead of building rigid parsers for every possible brief format, let the analyst agent do what it's good at: understanding unstructured text and extracting structured data. Our job is to:
1. Give clear instructions
2. Validate outputs
3. Provide feedback when extraction is incomplete

### Principle 2: File paths over inline content.

**Never embed large files inline in prompts.** Instead:
1. Give the agent the file path
2. Grant read access to the directory
3. Let the agent read the file itself

| Approach | Problem |
|----------|---------|
| Inline content | Truncation, context overflow, agent skims |
| File path + read access | Full content, agent reads what it needs, can re-read |

This applies to:
- Brief files (can be 1000+ lines)
- Mockup HTML files (can be 500+ lines)
- Any large context files

### Principle 3: Validate outputs against source.

After agent extraction, compare outputs against source files:
- Count .html files in brief vs extracted screens
- Compare CSS variables in mockup vs generated stylesheet
- Warn when coverage is below threshold
