# FEAT-002: Lessons Storage System

## Summary
Create a persistent lessons storage system that Claude can access in subsequent sessions. Lessons capture important principles, patterns, and learnings discovered during development that should inform future work.

---

## Motivation

As we build AgentFlow, we discover important principles like:
- "File paths over inline content" - prevents truncation
- "Agent-centric parsing" - let LLMs handle any format
- "Validate outputs" - compare extracted vs expected

These lessons should be:
1. **Persistent** - Available in future sessions
2. **Accessible** - Claude can read them automatically
3. **Extensible** - Easy to add new lessons
4. **Organized** - Categorized for quick reference

---

## Proposed Solution

### Location: `CLAUDE.md` Lessons Section

The simplest and most effective approach is to add lessons directly to the project's `CLAUDE.md` file. This file is **automatically loaded as context** in every Claude session.

**Why CLAUDE.md?**
- Already exists in the project root
- Automatically included in Claude's context
- No new infrastructure needed
- Version controlled with the project
- Can be updated by both human and Claude

### Structure

Add a `## Lessons` section to `CLAUDE.md`:

```markdown
## Lessons

Principles and patterns discovered during development. These inform all future work.

### Agent Design

#### Lesson: File paths over inline content
**Added:** 2025-01-20
**Context:** BUG-010 investigation

Never embed large files inline in prompts. Instead:
1. Give the agent the file path
2. Grant read access to the directory
3. Let the agent read the file itself

| Approach | Problem |
|----------|---------|
| Inline content | Truncation, context overflow, agent skims |
| File path + read access | Full content, agent reads what it needs, can re-read |

Applies to: brief files, mockup HTML, any large context files.

---

#### Lesson: Agent-centric parsing
**Added:** 2025-01-20
**Context:** BUG-010 investigation

Don't build rigid TypeScript parsers for brief formats. Briefs can be:
- Tree/ASCII structure
- JSON blocks
- Markdown tables
- Plain prose
- Mixed formats

Let the analyst agent decipher any format. Our job is to:
1. Give clear instructions
2. Validate outputs
3. Provide feedback when extraction is incomplete

---

### Validation

#### Lesson: Compare outputs against source
**Added:** 2025-01-20
**Context:** BUG-010 investigation

After agent extraction, validate completeness:
- Count .html files in brief vs extracted screens
- Compare CSS variables in mockup vs generated stylesheet
- Warn when coverage is below threshold (e.g., 90%)

---
```

---

## Alternative Approaches Considered

### Option A: Separate `lessons.md` file
- **Pros:** Clean separation, focused file
- **Cons:** Not automatically in Claude's context, requires explicit loading
- **Verdict:** Rejected - CLAUDE.md is already loaded

### Option B: `lessons/` directory with individual files
- **Pros:** Each lesson is atomic, easy to manage
- **Cons:** Requires tooling to aggregate, not automatically loaded
- **Verdict:** Rejected - over-engineered for this use case

### Option C: JSON/YAML lessons database
- **Pros:** Structured, searchable, machine-readable
- **Cons:** Harder to write/read, not automatically in context
- **Verdict:** Rejected - markdown is simpler and works

### Option D: CLAUDE.md with lessons section (SELECTED)
- **Pros:** Zero new infrastructure, automatic context, version controlled
- **Cons:** CLAUDE.md could get long over time
- **Verdict:** Selected - simplest solution that works

---

## Implementation Plan

### Phase 1: Add Lessons Section to CLAUDE.md

1. Add `## Lessons` section to project CLAUDE.md
2. Add initial lessons from BUG-010:
   - File paths over inline content
   - Agent-centric parsing
   - Validate outputs against source

### Phase 2: Lesson Template

Create a consistent format for lessons:

```markdown
#### Lesson: [Short descriptive title]
**Added:** YYYY-MM-DD
**Context:** [Bug/Feature/Discovery that led to this lesson]

[2-5 sentence description of the principle]

[Optional: code example, table, or diagram]

[Optional: "Applies to:" list of situations]

---
```

### Phase 3: Document Lesson Management

Add to CLAUDE.md instructions:

```markdown
### Adding New Lessons

When we discover an important principle or pattern:
1. Add it to the Lessons section below
2. Use the lesson template format
3. Include context (which bug/feature led to discovery)
4. Keep descriptions concise but actionable
```

---

## Initial Lessons to Add

From BUG-010 investigation:

1. **File paths over inline content** - Prevent truncation by giving agents file paths with read access instead of embedding large content inline.

2. **Agent-centric parsing** - Let LLM agents handle any brief format (tree, JSON, prose) instead of building rigid TypeScript parsers.

3. **Validate outputs against source** - After agent extraction, compare output counts against source file to detect incomplete extraction.

---

## File Changes

### `CLAUDE.md` (modify)
Add lessons section with initial lessons.

---

## Testing Checklist

- [ ] Verify lessons section appears in CLAUDE.md
- [ ] Start new Claude session and verify lessons are in context
- [ ] Ask Claude about a lesson to confirm accessibility
- [ ] Add a new lesson and verify it persists

---

## Future Considerations

### If CLAUDE.md becomes too long
- Move lessons to `LESSONS.md` and add explicit include instruction in CLAUDE.md
- Or use collapsible sections (if supported)

### Lesson categories
As lessons grow, organize by category:
- Agent Design
- Validation
- Performance
- User Experience
- Code Patterns

### Lesson search
If we accumulate many lessons, consider adding a `/lesson <keyword>` command to search/filter.

---

## Success Criteria

1. Lessons persist across Claude sessions
2. Claude can reference lessons when relevant
3. Adding new lessons is simple (edit CLAUDE.md)
4. Lessons are version controlled with the project
