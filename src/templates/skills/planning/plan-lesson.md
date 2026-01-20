# Plan Lesson

Analyze a rough lesson idea and create a well-structured lesson for inclusion in CLAUDE.md.

## Process

1. Understand the core principle or pattern the user discovered
2. Identify why this lesson matters (what problem it solves)
3. Determine the best category for this lesson
4. Structure it clearly with actionable guidance
5. Include concrete examples that illustrate the principle
6. Ensure consistency with existing lessons in CLAUDE.md

## Output Format

Output a markdown document with this exact structure:

```markdown
# LESSON-{ID}: {Short Title}

## Analysis

### Core Principle
[One sentence summary of what this lesson teaches]

### Why This Matters
[2-3 sentences explaining the problem this solves]

### Category
[Suggested category: Agent Design | Validation | Performance | Code Patterns | User Experience | etc.]

### Placement
[Where in CLAUDE.md this should go - after which existing lesson, or as a new category]

---

## Suggested Revisions

[Optional: If the user's original idea could be improved or clarified, explain how]

---

## Final Lesson (Copy to CLAUDE.md)

#### Lesson: {Concise title}
**Added:** {Today's date YYYY-MM-DD}
**Context:** {Bug/Feature/Discovery that led to this lesson}

{2-5 sentence description of the principle. Be specific and actionable.}

{Optional table, code example, or diagram if it helps clarify}

**Applies to:** {Comma-separated list of situations where this lesson applies}

{Optional code example showing the right way vs wrong way}

---

## Checklist

- [ ] Lesson has a clear, descriptive title
- [ ] Description explains both WHAT and WHY
- [ ] Includes concrete example or code snippet
- [ ] "Applies to" section helps identify when to use this
- [ ] Consistent style with existing lessons
- [ ] No redundancy with existing lessons
```

## Guidelines

- **Be specific**: Vague lessons aren't useful. Include file paths, code patterns, specific scenarios.
- **Show don't tell**: Code examples are more valuable than abstract descriptions.
- **Keep it scannable**: Someone should grasp the lesson in 10 seconds.
- **Make it actionable**: Reader should know exactly what to do differently.
- **Avoid duplication**: Check existing lessons to ensure this adds new value.

## Categories

Common lesson categories:
- **Agent Design**: How to structure agent prompts, tasks, and interactions
- **Validation**: How to verify outputs and catch errors
- **Performance**: Optimization patterns and efficiency improvements
- **Code Patterns**: TypeScript/JS patterns specific to this codebase
- **User Experience**: CLI output, error messages, workflow improvements
- **Architecture**: System design decisions and trade-offs

## Example Lesson

#### Lesson: Use semantic version comparisons
**Added:** 2025-01-15
**Context:** FEAT-010 - Version compatibility checking

Never compare version strings directly. Use semver library for reliable comparisons.

```typescript
// Bad: string comparison fails for "1.10.0" vs "1.9.0"
if (version > "1.5.0") { ... }

// Good: semantic comparison
import { gt } from 'semver';
if (gt(version, "1.5.0")) { ... }
```

**Applies to:** Package version checks, CLI version validation, compatibility gates.
