---
description: Analyze wireframes and generate style options
allowed-tools: Bash(agentflow analyze:*)
---

Run the AgenticFlow analyzer to examine wireframes and generate style options.

```bash
agentflow analyze $ARGUMENTS
```

**Options:**
- `[styleCount]` - Number of styles to generate (default: 1)
- `--useAssets` - All styles use user assets (variations of user vision)
- `--verify` - Show detailed coverage report

**Examples:**
- `/analyze` - Generate 1 style
- `/analyze 3` - Generate 3 style options
- `/analyze 3 --useAssets` - Generate 3 variations using user assets
- `/analyze --verify` - Show platform coverage report
