# BUG-028: Missing Mobile Stylesheet Skill

## Problem
The system is attempting to load a skill called `design-stylesheet-mobile` but it does not exist in the codebase. The application falls back to using `design-stylesheet` instead, which may not properly handle mobile-specific design requirements and responsive considerations.

## Context
- **Location**: Skill loading mechanism in `src/lib/agent.ts` or command execution in `src/commands/stylesheet.ts`
- **Affected Components**: 
  - Stylesheet generation for mobile/webapp platforms
  - Multi-platform design system creation
  - Mobile-specific design context generation
- **User Impact**: 
  - Mobile/webapp stylesheets may lack platform-specific optimizations
  - Touch targets, viewport scaling, and mobile UX patterns not properly addressed
  - Inconsistent design system across platforms when using `--platform=webapp`

## Root Cause Analysis
The skill loading logic is looking for a platform-specific skill variant (`design-stylesheet-mobile`) that was never created. This likely stems from:

1. The multi-platform support was added to brief structure (`brief-webapp.md`, `brief-backend.md`) but corresponding platform-specific skills were not created
2. The command logic in `stylesheet.ts` may be attempting to load platform-specific skills based on the `--platform` flag
3. The skills directory structure (`skills/design/`) only contains the base `design-stylesheet.md` without mobile/webapp variants

## Implementation Steps

1. [ ] Verify the skill loading logic in `src/commands/stylesheet.ts` to confirm it attempts to load platform-specific skills
2. [ ] Review `skills/design/design-stylesheet.md` to understand the current stylesheet generation approach
3. [ ] Create `skills/design/design-stylesheet-mobile.md` with mobile-specific guidance:
   - Touch target sizing (minimum 44x44pt iOS, 48x48dp Android)
   - Viewport and responsive breakpoints
   - Mobile typography scaling
   - Bottom navigation and mobile-first patterns
   - Safe area handling (notches, home indicators)
   - Mobile gestures and interactions
4. [ ] Create `skills/design/design-stylesheet-backend.md` for desktop admin interfaces:
   - Desktop-optimized layouts (sidebars, multi-column)
   - Data tables and complex forms
   - Desktop keyboard shortcuts
   - Higher information density
5. [ ] Update skill loading logic to gracefully handle missing platform-specific skills:
   - Try platform-specific skill first (e.g., `design-stylesheet-mobile`)
   - Fall back to base skill (`design-stylesheet`) with warning
   - Log which skill variant was used for debugging
6. [ ] Update `src/commands/stylesheet.ts` to pass platform context to the agent
7. [ ] Add skill variant documentation to `CLAUDE.md` in base project and templates

## Testing

- [ ] Test `agentflow stylesheet --platform=webapp --style=1` loads mobile skill
- [ ] Test `agentflow stylesheet --platform=backend --style=1` loads backend skill  
- [ ] Test `agentflow stylesheet --style=1` (no platform) uses base skill
- [ ] Verify generated mobile stylesheet includes touch targets and responsive considerations
- [ ] Verify generated backend stylesheet includes desktop-optimized patterns
- [ ] Test with missing skill file to confirm fallback behavior works correctly
- [ ] Verify no error messages for legitimate fallbacks (base skill usage)
- [ ] Edge case: Test with invalid platform value handles gracefully

## Rollback Plan

1. Remove newly created skill files (`design-stylesheet-mobile.md`, `design-stylesheet-backend.md`)
2. Revert changes to `src/commands/stylesheet.ts` skill loading logic
3. System will continue using base `design-stylesheet.md` for all platforms (existing behavior)
4. No data loss or corruption risk - only affects future stylesheet generation quality
