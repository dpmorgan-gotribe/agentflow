# Project Design System

This project uses AgenticFlow for design generation.

## Commands

```bash
agentflow analyze      # Analyze wireframes and brief
agentflow flows        # Create flow mockups
agentflow mockups      # Create style mockups (3 options)
agentflow stylesheet   # Create design system (locks design context)
agentflow screens      # Create all screens
```

## Directory Structure

- `brief.md` - Project brief (consumed by analyst)
- `agents/` - Agent definitions
- `skills/` - Skill documentation
- `assets/` - Input wireframes, fonts, icons
- `outputs/` - Generated designs

## Workflow

1. Edit `brief.md` with project requirements
2. Add wireframes to `assets/wireframes/`
3. Run `agentflow analyze` (brief is consumed here)
4. Review `outputs/analysis/` for extracted design decisions
5. Run `agentflow flows`
6. Review `outputs/flows/`
7. Run `agentflow mockups`
8. Pick a style (1, 2, or 3)
9. Run `agentflow stylesheet --style=N` (design context locked below)
10. Review `outputs/stylesheet/`
11. Run `agentflow screens`
12. Final designs in `outputs/screens/`

## Brief Consumption

The project brief is consumed during analysis. The analyst extracts:
- Brand context, colors, and tone
- User flows and entities
- Asset requirements
- Component needs

After `agentflow stylesheet`, the design context is locked in this file.
All downstream commands use the selected design system.
