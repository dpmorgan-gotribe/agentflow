# BUG-006: Mockups Output Description Instead of HTML

## Problem
The mockups command outputs descriptions/explanations of what the HTML would contain rather than actual HTML code. Example bad output:

```
I've created a comprehensive HTML mockup for Style 1...
The file is ready to be written...
Once you grant write permission, the mockup will include:
## What's in the Mockup
...
```

Expected output should be raw HTML starting with `<!DOCTYPE html>`.

## Context
- **Affected Command**: `agentflow mockups`
- **Affected Files**:
  - `src/templates/agents/ui-designer/system.md`
  - `src/templates/skills/design/design-mockup.md`
  - `src/commands/mockups.ts`

## Root Cause
The agent prompts don't explicitly:
1. Forbid explanatory text, preamble, or postamble
2. State that ONLY raw HTML should be output
3. Prevent Claude from asking for permission
4. Tell Claude to skip markdown code block wrapping

## Implementation Steps

### 1. Update UI Designer System Prompt
**File**: `src/templates/agents/ui-designer/system.md`

Add explicit output instructions:
```markdown
## Critical Output Rules

You are a code generation agent. Your responses must contain ONLY the requested code.

NEVER include:
- Explanations of what you're creating
- Descriptions of the output
- Questions asking for permission
- Markdown code fences (```)
- Preamble like "Here's the HTML..." or "I've created..."
- Postamble like "This mockup includes..." or "Let me know if..."

ALWAYS:
- Start output directly with the code (e.g., `<!DOCTYPE html>`)
- End output with the closing tag (e.g., `</html>`)
- Output complete, valid, self-contained files
```

### 2. Update Design Mockup Skill
**File**: `src/templates/skills/design/design-mockup.md`

Add output format section:
```markdown
## Output Format

OUTPUT ONLY RAW HTML. No explanations. No descriptions.

Your response must:
- Start with: `<!DOCTYPE html>`
- End with: `</html>`
- Be a complete, valid HTML file
- Include inline CSS in a <style> tag
- Be directly viewable in a browser

DO NOT:
- Explain what you're creating
- Ask for permission
- Wrap in markdown code blocks
- Add any text before or after the HTML
```

### 3. Update Mockups Command User Prompt
**File**: `src/commands/mockups.ts`

Add reinforcing instruction to user prompt:
```typescript
userPrompt: `Create a mockup for Style ${i}.

CRITICAL: Output ONLY raw HTML. Start with <!DOCTYPE html> and end with </html>.
No explanations. No descriptions. No markdown. Just complete HTML.

## Style Definitions
...`
```

## Testing

- [ ] Generated .html files start with `<!DOCTYPE html>`
- [ ] Files contain no explanatory text
- [ ] Files open directly in browser
- [ ] No markdown code block markers present
- [ ] All 5 styles generate valid HTML

## Rollback Plan

1. Revert system.md, design-mockup.md, and mockups.ts
2. `npm run build && cp -r src/templates dist/`
