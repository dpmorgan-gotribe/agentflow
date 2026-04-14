---
task-id: "034"
title: "Output Contract Enforcement (6 Layers)"
status: pending
priority: P2
tier: 8 — Quality & Ship
depends-on: ["012", "022"]
estimated-scope: medium
---

# 034: Output Contract Enforcement

## What This Task Produces
The six-layer defense-in-depth system that prevents agents from returning prose instead of structured output.

## Scope
From blueprint Section 13 (lines 2025-2148):

### Layer 1: Prompt Engineering
Already embedded in agent system prompts (Task 022). The CRITICAL OUTPUT RULES.

### Layer 2: File-Based Output
Already specified in agent definitions. HTML → files, response → status only.

### Layer 3: Constrained Decoding (API-level)
Zod schemas for each stage's output:
- `AnalyzeOutput` — success, targets, screenCount, skillsNeeded, assetsFound, warnings
- `MockupsOutput` — success, mockupsGenerated, userAssetsUsed, iconsFromMCP
- `StylesheetOutput` — success, tokenCount, primitiveCount, assetsDownloaded
- `ScreensOutput` — success, screensGenerated, batches, failedScreens

Create these as Zod schemas in the orchestrator package (used in Task 035).

### Layer 4: Hook Validation
Create `.claude/hooks/validate-html-write.sh` from blueprint lines 2086-2113:
- PostToolUse hook on Write|Edit
- If file is in `mockups/` or `screens/`, verify starts with HTML tag
- Block if contains markdown code fences

### Layer 5: Retry with Feedback
Pattern documented for orchestrator (Task 035): when validation fails, retry with specific error in prompt. Max 3 retries.

### Layer 6: Separate Verifier
Document the HTML Verifier pattern: independent agent using Haiku that checks generated HTML output. Cheap, independent, catches self-evaluation bias.

## Acceptance Criteria
- [ ] Zod schemas for all four stage outputs created
- [ ] `.claude/hooks/validate-html-write.sh` exists and works
- [ ] All six layers documented in a reference file
- [ ] Retry-with-feedback pattern documented
- [ ] Verifier agent pattern documented

## Human Verification
Are the six layers overkill or appropriately cautious? The blueprint says the UI Designer prose-instead-of-HTML problem is common — do these layers address it?
