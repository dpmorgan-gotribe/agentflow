---
id: bug-099-perceptual-blind-to-element-absences
type: bug
status: draft
author-agent: human
created: 2026-05-13
updated: 2026-05-13
parent-plan: feat-066-fix-loop-effectiveness-v2 (v2-Phase-4)
supersedes: null
superseded-by: null
branch: fix/perceptual-blind-to-absences
affected-files:
  - .claude/agents/perceptual-reviewer.md
  - orchestrator/src/perceptual-review.ts
feature-area: verifier/perceptual
priority: P1
attempt-count: 0
max-attempts: 5
error-message: "Perceptual reviewer (Tier 4) fails to file findings for large visible element-absences (missing logo, missing pagination, missing sidebar tag list, missing 'last added' subtitle, missing stats footer). The class is element-level + clearly present in mockup, absent in built — exactly what feat-068 was scoped to catch."
reproduction-steps: "1. Compare reading-log-02 user-reported bugs from manual session 2026-05-13 (Prompt 1, populated library) against the verifier's perceptual findings from the 2026-05-13 evening run (35 plans filed, 14 perceptual). The user reported 7 separate element-absences (logo/brand, pagination, tags-in-sidenav, sort dropdown, sidenav counts, 'last added' copy, black-pill-with-route). None of these surfaced in the verifier's perceptual findings."
stack-trace: null
---

# bug-099: perceptual reviewer is blind to large visible element-absences

## Bug Description

The vision-LLM perceptual reviewer (feat-068, Tier 4) is designed to surface element-level visible discrepancies — including elements present in the mockup but absent in the built version. Empirical 2026-05-13: user manual inspection of reading-log-02 surfaced 7 element-absences on a single screen (library/populated). The verifier's perceptual tier filed 14 findings TOTAL across 5 screens but none of the 7 user-reported absences appeared.

## Empirical evidence (Prompt 1 — library populated)

User found:

- No logo / Reading Log brand in topbar
- "Last added" copy missing under Library title
- No pagination controls (over 20 books should paginate, mockup shows 6/page)
- Tags not shown in sidenav
- No sort dropdown ("Recently added" in mockup)
- Sidenav book counts missing ("147 books / 23 finished this year" in mockup)
- Black pill with static route text (unexpected element present)

Verifier's perceptual findings for `books-list` screen (from `docs/_tmp-verify-output.json` 2026-05-13 19:48):

- Mostly noise from DB-cleanup pollution (which bug-095 was supposed to fix)
- One legit cosmetic finding about a different element

None of the 7 absences flagged.

## Root Cause Hypotheses

**H1 — Agent prompt over-narrows to cosmetic drift**: `.claude/agents/perceptual-reviewer.md` says "skip cosmetic drift covered by other reviewers" — the agent may interpret this too broadly + skip element-absences as "cosmetic." Need explicit prompt language for "missing UI elements present in mockup."

**H2 — Capture viewport too narrow**: perceptual review captures the built screen as a PNG. If the capture is above-fold-only (1440×900 viewport, not full-page), elements that live below the fold in the mockup (sidenav stats footer, pagination at bottom of list) are invisible to the comparison. The mockup PNG might capture full-page while the built PNG captures viewport — apples-to-oranges.

**H3 — Mockup-vs-built framing mismatch**: if mockup PNGs are rendered at a different viewport size than the built screenshots, padding/whitespace differs and the agent may interpret missing elements as cropping artifacts.

**H4 — Cascade-skip too aggressive**: when parity-verify (Tier 3) files ANY finding for a screen, perceptual cascades a "skip systemic" — so individual elements going missing don't get surfaced. Need to refine cascade to only skip shell-stripping / pixel-systemic; element-level absences should still surface.

## Fix Approach

**Step 1 (diagnostic)**: take ONE empirical case (books-list logo absence). Compare:

- Mockup PNG `docs/build-to-spec/pixel-diffs/books-list.mockup.png` viewport + content
- Built PNG `docs/build-to-spec/pixel-diffs/books-list.built.png` viewport + content
- Cascade-skip status from `docs/build-to-spec/perceptual/review.json`

**Step 2 (fix paths)**:

- **H1 fix**: update `.claude/agents/perceptual-reviewer.md` agent prompt — add explicit `## Element-absence findings` section instructing the agent to surface elements that are clearly in mockup but absent in built, even if other-cosmetic-difference. ~30min.
- **H2 fix**: switch the live capture to fullPage:true OR match the mockup's capture viewport. Single config change. ~15min.
- **H3 fix**: align rendering pipelines — same viewport at same scale. Inspect /screens skill's mockup-render command vs the verifier's playwright capture options.
- **H4 fix**: cascade-skip refinement — only skip on shell-stripping / pixel-systemic + dev-server-error. Element-absences shouldn't cascade.

**Step 3 (validation)**: re-run perceptual on reading-log-02 books-list. Expect agent to file ≥3 of the 7 user-found absences (logo, pagination, sidenav-tags).

## Cross-references

- **feat-068** — vision-LLM perceptual review. This bug is a Phase 5+ refinement of feat-068.
- **bug-098** — parity computed-styles under-firing. Together cluster #1+#2 from the 2026-05-13 root-cause analysis.
- **feat-066 v2 epic** — empirical metrics. Production target ≥95% catch — perceptual carrying its weight is load-bearing.

## Attempt Log

<!-- Populated by executing agents. -->
