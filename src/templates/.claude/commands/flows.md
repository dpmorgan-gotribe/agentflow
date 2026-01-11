---
description: Create flow mockups showing user journeys
allowed-tools: Bash(agentflow flows:*)
---

Run the AgenticFlow flows command to generate user flow mockups.

```bash
agentflow flows $ARGUMENTS
```

**Options:**
- `--style <number>` - Style to use (0, 1, 2, ...)
- `--platform <name>` - Target platform (webapp, backend, ...)

**Examples:**
- `/flows` - Generate flows using default style
- `/flows --style=1` - Generate flows using style 1
- `/flows --platform=webapp` - Generate flows for webapp platform
