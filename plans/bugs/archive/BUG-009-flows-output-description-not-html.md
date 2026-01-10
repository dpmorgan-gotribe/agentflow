I don't have write permissions yet. Here is the complete bug fix plan for BUG-009:

---

# BUG-009: Flows Output Shows Description Instead of HTML

## Problem
The `agentflow flows` command outputs are showing descriptive text like "I've created a comprehensive flow mockup..." instead of actual HTML content. The Claude agent is explaining what it created rather than outputting raw HTML directly.

## Context
- **Affected Commands**: `agentflow flows`
- **Affected Files**:
  - `src/templates/skills/design/design-flow.md` - missing CRITICAL output rules
  - `src/templates/agents/ui-designer/system.md` - has rules but skill doesn't reinforce them
- **User Impact**: Flow mockup files contain prose descriptions instead of valid HTML, requiring manual regeneration
- **Related Bug**: BUG-006 (same issue for mockups command - already fixed)

## Root Cause Analysis

### Issue 1: Missing output enforcement in design-flow.md
The `design-flow.md` skill lacks the explicit output rules that exist in `design-mockup.md`. Compare:

**design-mockup.md** (correct - has enforcement):
```markdown
## Output Requirements

OUTPUT ONLY RAW HTML. No explanations. No descriptions.

Your response must:
- Start with: `<!DOCTYPE html>`
- End with: `</html>`
...

DO NOT:
- Explain what you're creating
- Ask for permission
- Wrap in markdown code blocks
- Add any text before or after the HTML
```

**design-flow.md** (broken - minimal guidance):
```markdown
## Output

Single HTML file showing:
- all screens in the flow (simplified)
- Arrows between screens
...
```

### Issue 2: Template without enforcement
The skill provides a template structure but doesn't explicitly tell Claude to output ONLY the HTML without any surrounding text. Claude's default behavior is to explain what it's creating.

### Issue 3: Skill overrides system prompt context
While `ui-designer/system.md` has "Critical Output Rules", these can be overridden when the skill itself doesn't reinforce them. Skills are concatenated after the system prompt, and Claude may prioritize the skill's implicit allowance of explanations.

## Implementation Steps

### Phase 1: Add output enforcement to design-flow.md

1. [ ] **Add Output Requirements section to `design-flow.md`**
   - File: `src/templates/skills/design/design-flow.md`
   - Add after line 1 (after the title):
   ```markdown
   ## Output Requirements

   OUTPUT ONLY RAW HTML. No explanations. No descriptions.

   Your response must:
   - Start with: `<!DOCTYPE html>`
   - End with: `</html>`
   - Be a complete, valid HTML file
   - Include inline CSS in a `<style>` tag
   - Be directly viewable in a browser

   DO NOT:
   - Explain what you're creating
   - Ask for permission
   - Wrap in markdown code blocks
   - Add any text before or after the HTML
   - Say "I've created..." or "Here's the..."
   - Include postamble like "This mockup includes..." or "Let me know if..."
   ```

2. [ ] **Update the existing Output section**
   - Rename `## Output` to `## Content Requirements`
   - This separates format requirements from content requirements

### Phase 2: Update the template section

3. [ ] **Add explicit start/end markers to template**
   - File: `src/templates/skills/design/design-flow.md`
   - Before the template code block, add:
   ```markdown
   ## Template

   Your output MUST start exactly like this (no text before):
   ```
   - After the template code block, add:
   ```markdown
   Your output MUST end with `</html>` (no text after).
   ```

### Phase 3: Copy to existing projects

4. [ ] **Update gotribe project skill**
   - File: `projects/gotribe/skills/design/design-flow.md`
   - Apply the same changes as above

### Phase 4: Rebuild

5. [ ] **Build and deploy changes**
   - Run: `npm run build`
   - Verify `dist/templates/skills/design/design-flow.md` contains updated content

## Final design-flow.md Content

After changes, the file should look like:

```markdown
# Design Flow Mockup

## Output Requirements

OUTPUT ONLY RAW HTML. No explanations. No descriptions.

Your response must:
- Start with: `<!DOCTYPE html>`
- End with: `</html>`
- Be a complete, valid HTML file
- Include inline CSS in a `<style>` tag
- Be directly viewable in a browser

DO NOT:
- Explain what you're creating
- Ask for permission
- Wrap in markdown code blocks
- Add any text before or after the HTML
- Say "I've created..." or "Here's the..."
- Include postamble like "This mockup includes..." or "Let me know if..."

## Content Requirements

Create a visual representation of a user flow.

Single HTML file showing:
- All screens in the flow (simplified)
- Arrows between screens
- User actions annotated
- Data requirements noted

## Template

Your output MUST start exactly like this (no text before):

```html
<!DOCTYPE html>
<html>
<head>
  <title>Flow: [Name]</title>
  <style>
    /* Flow layout styles */
  </style>
</head>
<body>
  <h1>Flow: [Name]</h1>
  <div class="flow">
    <div class="screen" id="screen-[name]">
      <!-- Simplified screen -->
    </div>
    <div class="arrow">→</div>
    <!-- More screens -->
  </div>
</body>
</html>
```

Your output MUST end with `</html>` (no text after).
```

## Testing

- [ ] Run `agentflow flows` on a test project
- [ ] Verify output files start with `<!DOCTYPE html>`
- [ ] Verify output files end with `</html>`
- [ ] Verify no descriptive text appears in output files
- [ ] Open output HTML files directly in browser to confirm validity
- [ ] Test with multiple flows to ensure consistency

## Rollback Plan

1. Revert changes to:
   - `src/templates/skills/design/design-flow.md`
   - `projects/gotribe/skills/design/design-flow.md`
2. Rebuild: `npm run build`

## Notes

This is the same issue that was fixed for BUG-006 (mockups command). The fix pattern is identical: add explicit output enforcement rules to the skill file that mirror what exists in `design-mockup.md`.

---

Would you like me to save this plan to `plans/bugs/BUG-009-flows-output-description-not-html.md`? I'll need write permissions to do so.
