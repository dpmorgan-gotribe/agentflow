# AgenticFlow Multi-Platform Enhancement Plan

## Problem Statement

GoTribe specification includes **~430 screens** across two platforms:
- **Mobile/Webapp**: ~210 screens (brief-screens.md → rename to brief-webapp.md)
- **Backend Admin**: ~221 screens (brief-backend.md)

Current agentflow only supports single brief.md and single-platform output.

---

## User Decisions

1. **Brief naming**: Rename to standard pattern (brief-webapp.md)
2. **Review process**: Embedded in analyze (auto-show coverage report)
3. **Scale handling**: Skip existing valid screens (incremental generation)

---

## Pre-Implementation: Rename Brief File

```bash
# In projects/gotribe/
mv brief-screens.md brief-webapp.md
```

---

## Proposed Solution

### 1. Multi-Brief Loading

**Standard naming convention:**
```
brief.md           → Shared context (brand, vision, colors)
brief-webapp.md    → Platform: "webapp" (mobile/web app screens)
brief-backend.md   → Platform: "backend" (admin portal screens)
brief-{name}.md    → Platform: "{name}"
```

**Analysis consolidates all briefs:**
- Shared analysis (research, styles, assets, inspirations) runs once
- Platform-specific analysis (flows, screens) runs per platform

### 2. Platform-Aware Output Structure

```
outputs/
├── analysis/
│   ├── shared/           # styles.md, research.md, assets.md, inspirations.md
│   ├── webapp/           # flows.md, screens.json
│   └── backend/          # flows.md, screens.json
├── mockups/
│   ├── webapp/           # style-0.html, style-1.html, style-2.html
│   └── backend/
├── stylesheet/
│   ├── webapp/           # showcase.html
│   └── backend/
└── screens/
    ├── webapp/           # ~210 screen HTMLs
    └── backend/          # ~221 screen HTMLs
```

### 3. New Command Flags

| Command | New Flags | Description |
|---------|-----------|-------------|
| `analyze` | `--verify` | Show detailed coverage report |
| `mockups` | `--platform=<name>` | Target platform (default: auto) |
| `mockups` | `--useAssets` | Use user assets for ALL style variations |
| `flows` | `--platform=<name>` | Target platform |
| `stylesheet` | `--platform=<name>` | Target platform |
| `screens` | `--platform=<name>` | Target platform |
| `screens` | `--batch=<n>` | Batch size for parallel generation |

### 4. `--useAssets` Flag Behavior

**Current (without flag):**
- Style 0: Uses `../../assets/icons/` (user icons)
- Style 1+: Uses Lucide/Heroicons CDN

**With `--useAssets`:**
- ALL styles: Use `../../assets/icons/` (user icons)
- Creates visual variations (colors, typography, spacing) with same icon set

### 5. Coverage Verification (Embedded in Analyze)

**Auto-displayed after analyze completes:**
```
--- Coverage Report ---
webapp: 210/210 screens (100%)
backend: 221/221 screens (100%)

Use --verify for detailed breakdown
```

**With `--verify` flag:**
```
=== Detailed Coverage: webapp ===
Brief screens: 210
Generated screens: 210
Missing: None
Coverage: 100%

Component usage:
  header: 198 screens
  bottom-nav: 156 screens
  ...
```

### 6. Incremental Screen Generation

**Default behavior:**
- Check if `outputs/screens/{platform}/screen-*.html` exists
- Validate existing HTML (DOCTYPE, structure)
- Skip valid screens, only generate missing/invalid ones

**Override with `--force`:**
- Regenerate all screens regardless of existing files

---

## Implementation Phases

### Phase 1: Core Infrastructure
- [ ] Add `src/lib/platforms.ts` - Platform detection, brief loading
- [ ] Update `src/lib/brief.ts` - Multi-brief support
- [ ] Add `src/lib/verification.ts` - Coverage verification
- [ ] Update screens.json schema to v2 (platform-aware)

### Phase 2: Analyze Command
- [ ] Update `src/commands/analyze.ts`:
  - Auto-detect platforms from brief-*.md files
  - Run shared analysis once (research, styles, assets, inspirations)
  - Run platform analysis per platform (flows, screens)
  - Output to platform-namespaced directories
  - Auto-show coverage report after analysis
  - Add `--verify` flag for detailed report

### Phase 3: Downstream Commands
- [ ] Update `src/commands/mockups.ts`:
  - Add `--platform` flag
  - Add `--useAssets` flag
  - Read from platform-specific analysis dir
  - Output to platform-specific mockups dir
- [ ] Update `src/commands/flows.ts` - Platform flag
- [ ] Update `src/commands/stylesheet.ts` - Platform flag
- [ ] Update `src/commands/screens.ts`:
  - Platform flag
  - Skip existing valid screens (incremental)
  - Add `--force` to override
  - Add `--batch` flag for parallelism tuning

### Phase 4: Templates & Documentation
- [ ] Update skill templates for platform awareness
- [ ] Update CLAUDE.md template with multi-platform workflow
- [ ] Update command documentation

---

## Key Files to Modify

| File | Changes |
|------|---------|
| `src/commands/analyze.ts` | Multi-brief loading, platform-aware output, coverage report |
| `src/commands/mockups.ts` | --platform, --useAssets flags |
| `src/commands/screens.ts` | --platform, incremental generation, --force, --batch |
| `src/commands/flows.ts` | --platform flag |
| `src/commands/stylesheet.ts` | --platform flag |
| `src/lib/brief.ts` | Multi-brief loading, platform detection |
| `src/index.ts` | New flags registration |
| `src/templates/skills/analysis/analyze-screens.md` | Platform field in JSON output |

---

## Backwards Compatibility

- Single `brief.md` projects work unchanged (no platform dirs)
- Old screens.json format auto-detected and handled
- Commands without `--platform` default to first/only platform

---

## Scale Handling (430+ screens)

- Parallel generation: 10 agents default (configurable)
- Incremental: Skip existing valid screens
- ~43 batches for 430 screens = ~20-45 min (first run)
- Subsequent runs: Only regenerate missing/invalid screens

---

## Verification Steps

After implementation:
1. Rename `brief-screens.md` to `brief-webapp.md` in gotribe
2. Run `agentflow analyze` - confirm both platforms detected
3. Check coverage report shows 210 + 221 screens
4. Run `agentflow mockups --platform=webapp --useAssets`
5. Run `agentflow mockups --platform=backend --useAssets`
6. Verify all mockups use user icons (not CDN)
7. Run `agentflow stylesheet --platform=webapp --style=1`
8. Run `agentflow screens --platform=webapp --limit=5` (test first 5)
9. Re-run same command - verify it skips existing screens
