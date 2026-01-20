# LESSON-001: File Paths Over Inline Content

## Analysis

### Core Principle
Always pass file paths with read permissions to agents instead of embedding file content inline in prompts.

### Why This Matters
Large files embedded inline in prompts get truncated, skimmed, or cause context overflow. This leads to incomplete extraction (missing 75% of screens in BUG-010), mismatched outputs (stylesheet not matching mockup), and unreliable agent behavior. Agents work better when they can read files themselves at their own pace.

### Category
Agent Design

### Placement
This lesson already exists in CLAUDE.md under "### Agent Design" as the first lesson. The user's rough idea has already been properly structured and placed.

---

## Suggested Revisions

The existing lesson is well-structured and includes:
- ✅ Clear comparison table showing problems with each approach
- ✅ Concrete TypeScript code examples
- ✅ Specific "Applies to" guidance
- ✅ Implementation examples showing bad vs good patterns

**No revisions needed** - the lesson is already comprehensive and actionable.

---

## Final Lesson (Copy to CLAUDE.md)

*Note: This lesson already exists in CLAUDE.md. If you want to enhance it, consider adding:*

#### Lesson: File paths over inline content
**Added:** 2025-01-20
**Context:** BUG-010 investigation - stylesheet not matching mockup, screens extraction missing pages

Never embed large files inline in prompts. Instead:
1. Give the agent the file path
2. Grant read access to the directory
3. Let the agent read the file itself

| Approach | Problem |
|----------|---------|
| Inline content | Truncation, context overflow, agent skims |
| File path + read access | Full content, agent reads what it needs, can re-read |

**Applies to:** Brief files (1000+ lines), mockup HTML (500+ lines), any large context files.

**Implementation:**
```typescript
// Bad: inline content
userPrompt = `...\n${largeFileContent}\n...`;

// Good: file path with read access
const result = await runWorkerSequential({
  userPrompt: `Read this file: ${filePath}`,
  allowRead: true,
  addDirs: [parentDir]
});
```

**Real-world impact:**
- BUG-010: Inline brief → 75% of screens missing from extraction
- BUG-010: Inline mockup → Stylesheet CSS variables didn't match
- Solution: File paths with read access → 100% extraction accuracy

---

## Checklist

- [x] Lesson has a clear, descriptive title
- [x] Description explains both WHAT and WHY
- [x] Includes concrete example or code snippet
- [x] "Applies to" section helps identify when to use this
- [x] Consistent style with existing lessons
- [x] No redundancy with existing lessons
