# Plan Feature

Create a detailed feature implementation plan.

## Process

1. Understand the feature goal and requirements
2. Identify integration points with existing code
3. Design the implementation approach
4. Break down into incremental steps
5. Plan testing strategy
6. Consider rollback options

## Output Format

Output a markdown document with this exact structure:

```markdown
# FEAT-{ID}: {Title}

## Goal
[What this feature accomplishes for users]

## Context
[Why this feature is needed, business value, user stories]

## Requirements
- [Requirement 1]
- [Requirement 2]
- [Continue as needed...]

## Implementation Steps
1. [ ] [First concrete step]
2. [ ] [Second step]
3. [ ] [Continue as needed...]

## Testing
- [ ] [Test case 1: description]
- [ ] [Test case 2: description]
- [ ] [Integration tests]

## Rollback Plan
[How to safely revert the changes if needed]
```

## Guidelines

- Be specific in implementation steps (include file paths when known)
- Each step should be independently verifiable
- Consider backward compatibility
- Testing section should cover new functionality AND existing features
- Rollback plan should be safe and quick to execute
