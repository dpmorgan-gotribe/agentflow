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

## Multi-Platform Support

For multi-platform projects, create platform-specific briefs:
- `brief.md` - Shared context (brand, vision, colors)
- `brief-webapp.md` - Mobile/webapp screen inventory
- `brief-backend.md` - Backend admin screen inventory

Platform-specific commands:
```bash
agentflow analyze                         # Analyzes all platforms
agentflow analyze --useAssets             # All styles use user assets (variations)
agentflow mockups                         # Generate style mockups (universal)
agentflow stylesheet --platform=webapp --style=1  # Apply style to webapp
agentflow stylesheet --platform=backend --style=1 # Apply SAME style to backend
agentflow screens --platform=webapp       # Generate webapp screens
agentflow screens --force                 # Regenerate all screens
```

## Directory Structure

- `brief.md` - Project brief (consumed by analyst)
- `brief-{platform}.md` - Platform-specific screen inventories
- `agents/` - Agent definitions
- `skills/` - Skill documentation
- `assets/` - Input wireframes, fonts, icons
- `outputs/` - Generated designs

## Workflow

### Single Platform
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

### Multi-Platform
1. Edit `brief.md` with shared project context
2. Create `brief-webapp.md` and `brief-backend.md` with screen inventories
3. Add wireframes to `assets/wireframes/`
4. Run `agentflow analyze --useAssets --verify` (all styles use user assets)
5. Run `agentflow mockups` (generates universal style options)
6. Pick a style (0, 1, or 2)
7. For each platform (using the SAME style):
   - `agentflow stylesheet --platform=webapp --style=1`
   - `agentflow screens --platform=webapp`
   - `agentflow stylesheet --platform=backend --style=1`
   - `agentflow screens --platform=backend`

## Brief Consumption

The project brief is consumed during analysis. The analyst extracts:
- Brand context, colors, and tone
- User flows and entities
- Asset requirements
- Component needs

After `agentflow stylesheet`, the design context is locked in this file.
All downstream commands use the selected design system.
