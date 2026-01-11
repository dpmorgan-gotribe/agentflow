# mockups

Create style mockups. Mockups are universal style previews that apply across all platforms.

## Usage

```bash
agentflow mockups
```

## Workers

Spawns parallel workers (one per style detected in analysis).

## Prerequisites

- outputs/analysis/styles.md exists (from `agentflow analyze`)
- outputs/analysis/inspirations.md exists

## Output

Writes to `outputs/mockups/`:
- style-0.html (user's vision)
- style-1.html (alternative)
- style-2.html (alternative)

## Notes

Mockups are **not platform-specific**. They demonstrate the design system (colors, typography, spacing) which applies universally. Pick a style here, then use `--platform` with downstream commands (`stylesheet`, `screens`) to generate platform-specific outputs.
