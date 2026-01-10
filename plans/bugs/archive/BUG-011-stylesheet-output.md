Now I have a complete picture. The BUG-010 already documents a permission-related issue. For BUG-011, I need to create a plan about a different aspect of the `stylesheet-output` - likely related to the output format/validation issues. Let me create a comprehensive bug fix plan based on what I've discovered:

Based on my analysis of the codebase, the key issues I see with stylesheet output are:

1. **No output validation** - The command writes whatever output is returned without checking if it's valid HTML
2. **Agent might return conversational text** instead of raw HTML (as documented in BUG-010)
3. **Code fence stripping is incomplete** - Only handles `html` but not other fence types
4. **No retry mechanism** for malformed output

Let me create the bug fix plan:

---

# BUG-011: Stylesheet Output Validation and Quality Assurance

## Problem
The `agentflow stylesheet` command writes agent output directly to `outputs/stylesheet/showcase.html` without validating that the output is actually valid HTML. This results in corrupted or unusable stylesheet files that break the downstream `agentflow screens` command.

The command may produce output files that contain:
- Conversational text ("I've created a design system...")
- Markdown descriptions instead of HTML
- Partial HTML with missing closing tags
- Code fence wrappers that weren't fully stripped
- Permission-related messages instead of actual content

## Context
- **Affected Command**: `agentflow stylesheet`
- **Affected File**: `src/commands/stylesheet.ts`
- **Output Path**: `outputs/stylesheet/showcase.html`
- **Downstream Impact**: `agentflow screens` command fails when consuming invalid stylesheet
- **Related**: BUG-010 (permission wait message issue - same root cause, different symptom)

## Root Cause Analysis

1. **No Output Validation**: The `stylesheet.ts` command blindly writes `result.output` to file without checking content validity (lines 77-82)

2. **Insufficient Code Fence Stripping**: The `stripCodeFences()` function (lines 4-15) only handles basic cases:
   - Only strips `\`\`\`html` and generic `\`\`\``
   - Doesn't handle `\`\`\`css`, `\`\`\`markdown`, or nested fences
   - Doesn't validate result after stripping

3. **Agent Output Unpredictability**: Despite skill instructions (design-stylesheet.md) being explicit about raw HTML output, the agent may:
   - Add preamble text before HTML
   - Add postamble summaries after HTML
   - Return conversational responses when confused
   - Output error messages instead of content

4. **No Error Recovery**: When output is invalid, the command still reports success and updates CLAUDE.md context, propagating the error downstream

## Implementation Steps

1. [ ] **Create HTML validation utility** - Add `src/lib/validation.ts` with functions:
   - `isValidHTML(content: string): boolean` - Check for DOCTYPE and basic structure
   - `extractHTML(content: string): string | null` - Extract HTML from mixed content
   - `validateStylesheet(content: string): { valid: boolean; errors: string[] }` - Check for required CSS sections

2. [ ] **Improve code fence stripping** in `src/commands/stylesheet.ts`:
   - Handle all common fence types (`html`, `css`, `markdown`, generic)
   - Use regex to find and extract content between fences
   - Handle multiple/nested fence scenarios

3. [ ] **Add output validation** after agent invocation in `stylesheet.ts`:
   - Validate output starts with `<!DOCTYPE html>` or `<html>`
   - Validate output contains `:root {` CSS variables section
   - Validate output ends with `</html>`
   - Check for common failure patterns (permission messages, summaries)

4. [ ] **Add content extraction fallback** - If validation fails but HTML exists somewhere in output:
   - Try to extract HTML between `<!DOCTYPE html>` and `</html>`
   - Re-validate extracted content
   - Log warning about extraction being needed

5. [ ] **Add retry mechanism** - If output fails validation:
   - Retry agent invocation with stronger instruction emphasis
   - Maximum 2 retries before failing
   - Include previous failure reason in retry prompt

6. [ ] **Fail gracefully on invalid output**:
   - Don't write invalid content to file
   - Don't update CLAUDE.md with bad context
   - Display clear error message with diagnostic info
   - Suggest manual intervention steps

7. [ ] **Add --force flag** for edge cases:
   - Allow writing output even if validation fails
   - Useful for debugging or when validation is overly strict
   - Log warning when used

## Code Changes

**New File**: `src/lib/validation.ts`
```typescript
export function isValidHTMLStructure(content: string): boolean {
  const trimmed = content.trim();
  const hasDoctype = trimmed.toLowerCase().startsWith('<!doctype html>');
  const hasHtmlStart = /<html/i.test(trimmed);
  const hasHtmlEnd = /<\/html>/i.test(trimmed);
  return (hasDoctype || hasHtmlStart) && hasHtmlEnd;
}

export function hasRequiredCSSTokens(content: string): boolean {
  return content.includes(':root') && content.includes('{');
}

export function extractHTMLFromMixed(content: string): string | null {
  const match = content.match(/(<!DOCTYPE html>[\s\S]*<\/html>)/i);
  return match ? match[1] : null;
}

export function detectFailurePatterns(content: string): string[] {
  const errors: string[] = [];
  if (content.includes('waiting for permission')) errors.push('Contains permission wait message');
  if (content.includes("I've created")) errors.push('Contains conversational preamble');
  if (content.includes("Here's the")) errors.push('Contains conversational preamble');
  if (!content.includes('<style>')) errors.push('Missing <style> tag');
  if (!content.includes(':root')) errors.push('Missing :root CSS variables');
  return errors;
}
```

**Modified**: `src/commands/stylesheet.ts` - Add validation after line 71 and before writing:
```typescript
// Validate output before writing
const cleanedOutput = stripCodeFences(result.output);
const errors = detectFailurePatterns(cleanedOutput);

if (errors.length > 0 || !isValidHTMLStructure(cleanedOutput)) {
  // Try extraction fallback
  const extracted = extractHTMLFromMixed(cleanedOutput);
  if (extracted && isValidHTMLStructure(extracted)) {
    console.warn('Warning: Had to extract HTML from mixed output');
    // Use extracted content
  } else {
    console.error('Stylesheet generation failed - invalid output:');
    errors.forEach(e => console.error(`  - ${e}`));
    console.error('\nRun with --force to save anyway, or check agent configuration.');
    process.exit(1);
  }
}
```

## Testing

- [ ] **Test valid output**: Run with agent producing correct HTML - verify file written correctly
- [ ] **Test preamble handling**: Mock output with "I've created..." prefix - verify extraction works
- [ ] **Test code fence stripping**: Test with `\`\`\`html`, `\`\`\`css`, nested fences
- [ ] **Test failure detection**: Mock output with permission message - verify error shown
- [ ] **Test extraction fallback**: Mock mixed content - verify HTML extracted correctly
- [ ] **Test --force flag**: Run with invalid output and --force - verify file written with warning
- [ ] **Test retry mechanism**: Mock first failure, second success - verify retry works
- [ ] **Integration test**: Full `analyze -> mockups -> stylesheet -> screens` pipeline

## Rollback Plan

1. Revert changes to `src/commands/stylesheet.ts`
2. Delete `src/lib/validation.ts` if created
3. `npm run build`
4. Manually inspect agent output if issues persist:
   - Run `claude -p` directly with stylesheet skill
   - Copy valid HTML portion manually to output file
