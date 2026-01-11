---
description: Generate all screen designs
allowed-tools: Bash(agentflow screens:*)
---

Run the AgenticFlow screens command to generate all screen HTML files.

```bash
agentflow screens $ARGUMENTS
```

**Options:**
- `--platform <name>` - Target platform (webapp, backend, ...)
- `--limit <number>` - Limit number of screens to generate
- `--force` - Regenerate all screens (ignore existing valid screens)
- `--batch <number>` - Batch size for parallel generation

**Examples:**
- `/screens` - Generate all screens
- `/screens --platform=webapp` - Generate webapp screens only
- `/screens --limit=5` - Generate first 5 screens (for testing)
- `/screens --force` - Regenerate all screens from scratch

**Note:** By default, existing valid screens are skipped. Use `--force` to regenerate.
