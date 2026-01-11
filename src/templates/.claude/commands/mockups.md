---
description: Generate style mockup variations
allowed-tools: Bash(agentflow mockups:*)
---

Run the AgenticFlow mockups command to generate visual style mockups.

```bash
agentflow mockups $ARGUMENTS
```

**Options:**
- `--platform <name>` - Target platform (webapp, backend, ...)

**Examples:**
- `/mockups` - Generate mockups for all styles
- `/mockups --platform=webapp` - Generate mockups for webapp platform
- `/mockups --platform=backend` - Generate mockups for backend platform

**Note:** Asset mode (useAssets) is determined during `/analyze`. Run `/analyze --useAssets` to make all styles use user assets.
