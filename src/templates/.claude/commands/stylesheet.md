---
description: Create design system from selected style
allowed-tools: Bash(agentflow stylesheet:*)
---

Run the AgenticFlow stylesheet command to generate a complete design system.

```bash
agentflow stylesheet $ARGUMENTS
```

**Options:**
- `--style <number>` - Style to use (0, 1, 2, ...) - default: 1
- `--platform <name>` - Target platform (webapp, backend, ...)
- `--force` - Write output even if validation fails

**Examples:**
- `/stylesheet --style=1` - Generate design system from style 1
- `/stylesheet --style=0` - Use the user's original vision
- `/stylesheet --platform=webapp --style=2` - Platform-specific stylesheet

**Note:** This locks the design context in CLAUDE.md. All subsequent screen generation uses this design system.
