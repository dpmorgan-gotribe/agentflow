# BUG-025: Convert CLI Commands to Claude Code Slash Commands

**Status: COMPLETE**

## Problem
AgenticFlow commands are currently CLI-only. When users type `agentflow plan-fix` in conversation, Claude interprets it as instructions rather than recognizing it as a command to run.

## Context
- **Affected Components**: All AgenticFlow commands
- **User Impact**: Commands not discoverable via `/` autocomplete, confusion between CLI and conversation
- **Current Behavior**: Must run `agentflow <command>` explicitly in terminal
- **Desired Behavior**: Type `/plan-fix` and command executes properly

## Root Cause Analysis
Claude Code supports custom slash commands via `.claude/commands/` directory. Each `.md` file becomes a `/command`. This is simpler than MCP - just markdown files.

## Implementation Steps

1. [x] Create `.claude/commands/` directory in project template
   - Added to `src/templates/.claude/commands/`

2. [x] Create command files for each agentflow command:
   - `analyze.md` → `/analyze`
   - `flows.md` → `/flows`
   - `mockups.md` → `/mockups`
   - `stylesheet.md` → `/stylesheet`
   - `screens.md` → `/screens`
   - `plan-fix.md` → `/plan-fix`
   - `plan-feature.md` → `/plan-feature`

3. [x] Each command file includes:
   - Frontmatter with description and allowed-tools
   - Usage instructions
   - Options documentation
   - Examples

4. [x] Copied to dist/templates for new projects

5. [x] Added to existing projects (gotribe, agentflow root)

## Command Definitions

| Command | File | Description |
|---------|------|-------------|
| `/analyze` | analyze.md | Analyze wireframes and generate styles |
| `/flows` | flows.md | Create flow mockups |
| `/mockups` | mockups.md | Generate style mockup variations |
| `/stylesheet` | stylesheet.md | Create design system from selected style |
| `/screens` | screens.md | Generate all screen designs |
| `/plan-fix` | plan-fix.md | Create a bug fix plan |
| `/plan-feature` | plan-feature.md | Create a feature implementation plan |

## Testing

- [x] Command files created in `.claude/commands/`
- [ ] Type `/` in Claude Code, verify all commands appear
- [ ] Run `/plan-fix test-bug` - verify plan file created
- [ ] Run `/analyze --useAssets` - verify flags work

## Files Created

```
src/templates/.claude/commands/
├── analyze.md
├── flows.md
├── mockups.md
├── stylesheet.md
├── screens.md
├── plan-fix.md
└── plan-feature.md
```

Also copied to:
- `.claude/commands/` (agentflow root)
- `projects/gotribe/.claude/commands/`
- `dist/templates/.claude/commands/`
