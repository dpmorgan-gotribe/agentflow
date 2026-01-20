---
description: Create a lesson plan for CLAUDE.md
---

Create a structured lesson from a rough idea, ready for inclusion in CLAUDE.md.

```bash
agentflow plan-lesson $ARGUMENTS
```

**Arguments:**
- `<description>` - Your rough idea for the lesson (required)
- `--context <text>` - Additional context (bug/feature that led to discovery)

**Examples:**
- `/plan-lesson "always validate agent outputs"` - Create lesson plan
- `/plan-lesson "file paths over inline" --context "BUG-010"` - With context

**Output:**
Creates `plans/lessons/LESSON-XXX-name.md` with:
- Analysis of the core principle
- Suggested category and placement
- Final lesson formatted for CLAUDE.md
- Checklist for quality

**Workflow:**
1. Run `/plan-lesson "<your idea>"` to generate structured lesson
2. Review the suggested structure
3. Refine if needed
4. Copy the "Final Lesson" section to CLAUDE.md
5. Archive: `agentflow archive-lesson LESSON-XXX-name.md`

**Lesson Categories:**
- Agent Design - prompts, tasks, interactions
- Validation - verifying outputs, catching errors
- Performance - optimization patterns
- Code Patterns - TypeScript/JS patterns
- User Experience - CLI output, workflows
