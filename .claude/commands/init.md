---
description: Create a new AgentFlow design project
---

Initialize a new AgentFlow design project.

```bash
agentflow init $ARGUMENTS
```

**Arguments:**
- `<name>` - Project name (required)
- `--no-git` - Skip git initialization

**Examples:**
- `/init myapp` - Create new project called "myapp"
- `/init myapp --no-git` - Create without git

**Creates:**
```
projects/<name>/
├── .claude/commands/   (project slash commands)
├── agents/             (agent definitions)
├── skills/             (skill definitions)
├── assets/             (wireframes, icons, logos)
├── outputs/            (generated designs)
├── brief.md            (project requirements)
└── CLAUDE.md           (project context)
```
