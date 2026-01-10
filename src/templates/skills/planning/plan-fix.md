# Plan Fix

Create a detailed bug fix plan.

## Process

1. Analyze the bug description and context
2. Identify the root cause
3. Determine affected components
4. Design the fix approach
5. Plan testing strategy
6. Consider rollback options

## Output Format

Output a markdown document with this exact structure:

```markdown
# BUG-{ID}: {Title}

## Problem
[Clear description of what is broken and how it manifests]

## Context
[Where the bug occurs, affected components, user impact]

## Root Cause Analysis
[Technical explanation of why the bug exists]

## Implementation Steps
1. [ ] [First concrete step]
2. [ ] [Second step]
3. [ ] [Continue as needed...]

## Testing
- [ ] [Test case 1: description]
- [ ] [Test case 2: description]
- [ ] [Edge case tests]

## Rollback Plan
[How to safely revert the changes if needed]
```

## Guidelines

- Be specific in implementation steps (include file paths when known)
- Each step should be independently verifiable
- Testing section should cover the fix AND prevent regressions
- Rollback plan should be safe and quick to execute
