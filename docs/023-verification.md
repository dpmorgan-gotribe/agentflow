# Task 03/023 — /mockups Skill: Verification Report

## files (2/2)

- [x] exists: .claude/skills/mockups/SKILL.md
- [x] exists: .claude/templates/mockups-index-template.html

## frontmatter (3/3)

- [x] name: mockups
- [x] allowed-tools includes Read Write Bash Grep Glob
- [x] argument-hint covers [count] and --nanobanana

## inputs (5/5)

- [x] reads docs/analysis/{platform}/screens.json (NOT navigation-schema.json)
- [x] reads shared styles.md / assets.md / inspirations.md
- [x] reads brief-summary.json for detectedPlatforms + styleCount
- [x] reads asset-inventory.json
- [x] refactor-003 note: no architect.yaml dependency

## count arg (3/3)

- [x] documents count=1 default (N × M × 1)
- [x] documents count=C > 1 caps per-app with warning
- [x] rejects 0 / negative / non-integer

## archetype alg (2/2)

- [x] algorithm enumerates 9 archetype categories in order
- [x] fallback to first-screen documented

## output (4/4)

- [x] layout tree shown
- [x] re-run idempotency: removes old style-{K}/ + leaves archive/ untouched
- [x] single-style path auto-writes selected-style.json with selectedBy auto-single-style
- [x] multi-style path exits without selected-style.json

## fallback table (4/4)

- [x] covers 8 asset types — all 8
- [x] differs by --nanobanana state (on/off columns)
- [x] picsum.photos seeded avatars when flag off
- [x] unDraw fallback for empty-state when flag off

## anti-slop (6/6)

- [x] AI-lila regex present
- [x] cliché copy bigrams listed
- [x] 1-retry cap documented
- [x] Lorem ipsum check
- [x] emoji-section-header rule
- [x] unstyled defaults rule

## manifests (3/3)

- [x] per-style manifest.json schema documented (mockups[] + assets[] + provenance)
- [x] top-level manifest.json schema documented
- [x] dials.yaml shape documented

## review ux (3/3)

- [x] template placeholders documented (5 placeholders)
- [x] IMAGE_BUDGET comes from models.yaml (not architecture.yaml)
- [x] backing-server contract (/api/dials + /api/select)

## nanobanana (2/2)

- [x] flag on vs flag off branches documented
- [x] records flag state in per-style manifests + return JSON

## two-pass (2/2)

- [x] step 5 Pass 1 + Pass 2 documented
- [x] cross-style de-dup rule

## return json (1/1)

- [x] matches MockupsOutput shape

## file output (2/2)

- [x] HTML to files, response = status only
- [x] post-stage /verify-html invocation noted

## template (10/10)

- [x] all 5 placeholders present
- [x] viewport switcher has 3 sizes (390/820/1400)
- [x] dial editor with 3 sliders (variance/motion/density)
- [x] choose button + close button + dialog modal
- [x] POSTs to /api/dials and /api/select
- [x] dial POST is debounced 300ms
- [x] backdrop click + Escape close modal
- [x] prefers-reduced-motion respected
- [x] iframe sandbox attribute set
- [x] renders with test data (no unresolved placeholders) — clean

## integration (3/3)

- [x] depends on 018 (asset inventory) + 019 (analyze) + 022 (ui-designer)
- [x] no dependency on architect (020) — checks for post-design note
- [x] integrates with 024 /stylesheet, 032b /verify-html, 034b, 035 orchestrator, 036 HITL gate, 041 MCP

## Total: 55/55
