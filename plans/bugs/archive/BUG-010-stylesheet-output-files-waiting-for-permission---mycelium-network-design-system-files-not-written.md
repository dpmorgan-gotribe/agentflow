I've prepared the complete bug fix plan for BUG-010. Here's the plan I've created:

---

# BUG-010: Stylesheet Output Contains Permission Wait Message Instead of Design System

## Problem
The `agentflow stylesheet` command produced an invalid output file. Instead of generating the complete Mycelium Network design system (CSS variables, component styles, and HTML showcase), the `outputs/stylesheet/showcase.html` file contains only a text summary stating "the file write is waiting for permission" followed by a description of what *should* have been created.

The file contains no actual CSS or HTML - only a markdown-formatted explanation of the intended design tokens, components, and files. This renders the stylesheet command output unusable for downstream `agentflow screens` generation.

## Context
- **Affected File:** `projects/gotribe/outputs/stylesheet/showcase.html`
- **Expected Content:** Complete HTML document with embedded CSS design system (`:root` variables, component classes, showcase examples)
- **Actual Content:** Plain text/markdown describing the design system, with a message about waiting for file write permission
- **User Impact:** Cannot proceed to `agentflow screens` command; design pipeline is blocked
- **Selected Style:** Style 0 (Mycelium Network theme)

## Root Cause Analysis

The Claude agent invoked by the stylesheet command encountered a file write permission barrier. Instead of:
1. Being granted write access automatically, or
2. Failing with an error that triggers retry logic

The agent produced conversational output explaining what it *would* write, and this explanation text was captured and saved as the output file. This indicates:

1. **Permission Model Mismatch**: The agent expected interactive permission prompts but the CLI invocation doesn't support interactive approval flows
2. **Output Capture Issue**: The worker captured the agent's conversational response (explaining the wait) as the final output instead of recognizing a permission failure
3. **Missing Write Permission Flags**: The `invokeAgent()` function in `src/lib/agent.ts` may not be passing the correct flags to enable file writes (e.g., `--dangerously-skip-permissions` or pre-approved paths)
4. **No Output Validation**: The stylesheet command doesn't validate that the output file contains valid HTML before considering the task complete

## Implementation Steps

1. [ ] **Investigate agent invocation flags** - Review `src/lib/agent.ts:invokeAgent()` to determine how Claude CLI is spawned and what permission flags are passed

2. [ ] **Add file write permission configuration** - Ensure the agent invocation includes appropriate flags to allow file writes to the `outputs/` directory:
   - Option A: Add `--dangerously-skip-permissions` flag for trusted output paths
   - Option B: Configure allowed paths in agent invocation settings
   - Option C: Use environment variables to pre-approve output directory writes

3. [ ] **Add output validation in stylesheet command** - In `src/commands/stylesheet.ts`, add validation after agent execution:
   - Check that output file exists
   - Verify file starts with `<!DOCTYPE html>` or `<html>`
   - Verify file contains `:root {` CSS variables section
   - If validation fails, throw error with clear message

4. [ ] **Add retry logic for permission failures** - If output validation fails, implement retry with escalated permissions or clearer error messaging

5. [ ] **Re-run stylesheet command** - After fix is implemented, re-execute `agentflow stylesheet --style=0` to generate valid design system

6. [ ] **Verify downstream compatibility** - Confirm the regenerated stylesheet works with `agentflow screens` command

## Testing

- [ ] **Test valid output generation**: Run `agentflow stylesheet --style=0` and verify `outputs/stylesheet/showcase.html` contains valid HTML with CSS variables
- [ ] **Test output validation**: Manually create an invalid showcase.html (with text only) and verify the command detects and reports the error
- [ ] **Test permission handling**: Run in restricted environment and verify clear error message instead of captured text
- [ ] **Test downstream integration**: After fix, run `agentflow screens` and verify it correctly consumes the design system
- [ ] **Regression test other commands**: Verify `agentflow flows` and `agentflow mockups` still work correctly (they may have similar permission patterns)

## Rollback Plan

1. If the fix causes issues, revert changes to `src/lib/agent.ts` and `src/commands/stylesheet.ts`
2. Manually generate the design system by:
   - Running Claude CLI directly with explicit write permissions
   - Copying the Mycelium Network design tokens from the summary in the current `showcase.html`
   - Manually creating the CSS file structure
3. Update project CLAUDE.md to note manual generation was required

---

The plan is ready to be written to `plans/bugs/BUG-010.md` once file write permissions are granted.
