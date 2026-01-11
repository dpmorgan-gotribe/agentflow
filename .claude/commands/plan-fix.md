---
description: Create a bug fix plan
---

Create a structured bug fix plan for the AgentFlow CLI.

```bash
agentflow plan-fix $ARGUMENTS
```

**Arguments:**
- `<name>` - Short name for the bug (required)
- `--context <text>` - Additional context

**Examples:**
- `/plan-fix button-broken` - Create plan for button bug
- `/plan-fix "login fails" --context "Only on mobile"` - With context

**Output:**
Creates `plans/bugs/BUG-XXX-name.md` with:
- Problem description
- Root cause analysis
- Implementation steps
- Testing checklist
- Rollback plan

**Workflow:**
1. Run `/plan-fix <name>` to generate plan
2. Review the plan file
3. Approve and implement
