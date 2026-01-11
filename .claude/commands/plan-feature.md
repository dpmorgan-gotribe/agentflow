---
description: Create a feature implementation plan
---

Create a structured feature implementation plan for the AgentFlow CLI.

```bash
agentflow plan-feature $ARGUMENTS
```

**Arguments:**
- `<name>` - Short name for the feature (required)
- `--context <text>` - Additional context

**Examples:**
- `/plan-feature dark-mode` - Create plan for dark mode
- `/plan-feature "user-auth" --context "OAuth with Google"` - With context

**Output:**
Creates `plans/features/FEAT-XXX-name.md` with:
- Feature description
- Requirements analysis
- Implementation steps
- Testing checklist
- Documentation needs

**Workflow:**
1. Run `/plan-feature <name>` to generate plan
2. Review the plan file
3. Approve and implement
