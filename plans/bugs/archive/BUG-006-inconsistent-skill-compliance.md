# BUG-006: Inconsistent Skill Compliance in Screen Generation

## Problem Description

When generating screens with `--skill=mobile`, some screens follow mobile layout guidelines while others generate desktop-style layouts.

**Command run:**
```bash
agentflow screens --platform=admin --skill=mobile --limit=15
```

**Expected:** All 15 screens use mobile layout (375px width, touch targets, bottom nav)

**Actual:**
- 9 screens: Mobile style (375px max-width) ✓
- 6 screens: Desktop style (1200px-1400px max-width) ✗

**Affected screens (desktop instead of mobile):**
- screen-03-admin-alerts-dashboard.html (1400px)
- screen-05-admin-activity-log.html (1400px)
- screen-07-admin-user-detail.html (1200px)
- screen-10-admin-user-financial.html (1200px)
- screen-13-admin-user-communications.html (1400px)
- screen-15-admin-user-actions.html (1400px)

## Root Cause Analysis

The skill file `design-screen-mobile.md` clearly specifies mobile constraints:
- Fixed viewport: 375px width
- `max-width: 375px` in body CSS
- Touch targets: 44px minimum
- Safe area padding
- Bottom navigation

However, the LLM workers don't consistently follow these instructions. This is an inherent issue with LLM generation - the model sometimes "forgets" or deprioritizes skill instructions in favor of what it perceives as more appropriate for the screen type (e.g., data-heavy admin screens → desktop layout).

## Potential Solutions

### Option 1: Strengthen Skill Instructions (Low effort)

Add more emphatic language to the skill file:

```markdown
## CRITICAL: Mobile Layout Requirements

**YOU MUST use these exact values - NO EXCEPTIONS:**

body {
  max-width: 375px;  /* MANDATORY - DO NOT use wider values */
  margin: 0 auto;
}

NEVER use:
- max-width values greater than 375px
- Multi-column grid layouts
- Desktop-style sidebars
```

### Option 2: Post-Generation Validation (Medium effort)

Add validation step in screens.ts that checks generated HTML for mobile compliance:

```typescript
function validateMobileCompliance(html: string): ValidationResult {
  const issues: string[] = [];

  // Check max-width
  const maxWidthMatch = html.match(/max-width:\s*(\d+)px/);
  if (maxWidthMatch && parseInt(maxWidthMatch[1]) > 400) {
    issues.push(`Invalid max-width: ${maxWidthMatch[1]}px (expected <= 375px)`);
  }

  // Check for viewport-fit=cover
  if (!html.includes('viewport-fit=cover')) {
    issues.push('Missing viewport-fit=cover');
  }

  // Check for safe area insets
  if (!html.includes('env(safe-area-inset')) {
    issues.push('Missing safe area insets');
  }

  return { valid: issues.length === 0, issues };
}
```

If validation fails, either:
- Warn user and continue
- Auto-retry with stronger prompt
- Mark screen for manual review

### Option 3: Template Injection (Higher effort)

Instead of relying on LLM to generate correct boilerplate, inject a mobile template wrapper:

```typescript
// In screens.ts worker task creation
const mobileWrapper = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <style>
    body { max-width: 375px; margin: 0 auto; }
    /* Safe area styles... */
  </style>
</head>
<body>
  <!-- CONTENT_PLACEHOLDER -->
</body>
</html>
`;

// Prompt asks LLM to generate only the body content
userPrompt: `Generate ONLY the body content (no DOCTYPE, no html/head tags) for screen: ${screenName}. The mobile wrapper template is already applied.`
```

### Option 4: Retry on Failure (Medium effort)

Add retry logic with modified prompt when mobile validation fails:

```typescript
let attempts = 0;
let result;
do {
  result = await generateScreen(task);
  const validation = validateMobileCompliance(result);
  if (!validation.valid) {
    attempts++;
    task.userPrompt = `PREVIOUS ATTEMPT FAILED. Issues: ${validation.issues.join(', ')}\n\nYOU MUST follow mobile layout requirements. max-width: 375px is MANDATORY.\n\n${originalPrompt}`;
  }
} while (!validation.valid && attempts < 3);
```

## Recommended Approach

**Phase 1 (Immediate):** Strengthen skill instructions (Option 1)
- Low effort, may improve compliance
- Won't guarantee 100% compliance

**Phase 2 (Follow-up):** Add post-generation validation (Option 2)
- Warn users when screens don't match skill expectations
- Log non-compliant screens for review

**Phase 3 (If needed):** Add retry logic (Option 4)
- Auto-retry non-compliant screens with stronger prompt
- Limit to 2-3 retries to avoid infinite loops

## Implementation Steps

### Step 1: Strengthen Skill File

Update `skills/design/design-screen-mobile.md`:

```markdown
## CRITICAL LAYOUT REQUIREMENTS

**These values are MANDATORY - you MUST use them exactly:**

```css
body {
  max-width: 375px;  /* REQUIRED - This is a mobile screen */
  margin: 0 auto;
}
```

**NEVER generate:**
- max-width values over 400px
- Multi-column grid layouts
- Desktop sidebars
- Hover-only interactions

**ALWAYS include:**
- viewport-fit=cover in meta viewport
- safe area insets for iOS
- 44px minimum touch targets
- Bottom navigation bar
```

### Step 2: Add Validation Function

In `src/lib/validation.ts`, add:

```typescript
export interface SkillComplianceResult {
  compliant: boolean;
  skill: string;
  issues: string[];
}

export function validateSkillCompliance(html: string, skill: string): SkillComplianceResult {
  const issues: string[] = [];

  if (skill === 'mobile') {
    // Check max-width
    const maxWidthMatch = html.match(/max-width:\s*(\d+)px/);
    if (maxWidthMatch) {
      const width = parseInt(maxWidthMatch[1]);
      if (width > 400) {
        issues.push(`max-width: ${width}px exceeds mobile limit (375px)`);
      }
    }

    // Check viewport-fit
    if (!html.includes('viewport-fit=cover')) {
      issues.push('Missing viewport-fit=cover');
    }

    // Check safe area
    if (!html.includes('safe-area-inset')) {
      issues.push('Missing safe area insets');
    }
  }

  return {
    compliant: issues.length === 0,
    skill,
    issues
  };
}
```

### Step 3: Integrate Validation in screens.ts

After generating each screen, validate and warn:

```typescript
const compliance = validateSkillCompliance(result.output, skillType);
if (!compliance.compliant) {
  console.warn(`  ${result.id}: skill compliance issues - ${compliance.issues.join(', ')}`);
  // Optionally trigger retry
}
```

## Testing Checklist

- [ ] Generate screens with `--skill=mobile` - all should have 375px max-width
- [ ] Generate screens with `--skill=desktop` - should have wider layouts
- [ ] Validation correctly identifies non-compliant screens
- [ ] Warning messages shown for non-compliant screens
- [ ] Retry logic improves compliance rate (if implemented)

## Files to Modify

| File | Changes |
|------|---------|
| `skills/design/design-screen-mobile.md` | Strengthen MANDATORY requirements |
| `skills/design/design-screen-desktop.md` | Add corresponding desktop requirements |
| `src/lib/validation.ts` | Add skill compliance validation |
| `src/commands/screens.ts` | Integrate validation, add warnings |

## Immediate Workaround

Regenerate non-compliant screens individually with `--force`:

```bash
# Re-run with force for specific screens that failed
agentflow screens --platform=admin --skill=mobile --force --limit=15
```

Or manually review and fix the 6 affected screens.
