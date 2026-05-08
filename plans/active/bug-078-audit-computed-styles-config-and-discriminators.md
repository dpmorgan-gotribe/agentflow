---
id: bug-078-audit-computed-styles-config-and-discriminators
type: bug
status: draft
author-agent: human
created: 2026-05-08
updated: 2026-05-08
parent-plan: feat-066-fix-loop-effectiveness-v2
branch: fix/audit-computed-styles-config-and-discriminators
affected-files:
  - scripts/audit-computed-styles.mjs
  - orchestrator/src/build-to-spec-verify.ts
feature-area: orchestrator/verification-coverage
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "audit-computed-styles classifier silently drops 75% of detected divergences"
---

# bug-078: Phase 1 — audit-computed-styles classifier defaults + deterministic discriminators

## Bug Description

Two adjacent issues that ship together as feat-066 Phase 1.

### 1A — audit-computed-styles classifier defaults

`scripts/audit-computed-styles.mjs:316` defines `PATTERN_ALLOWLIST = new Set(["layout-regrouping"])`. Of the 4 classifier output patterns, only ONE is filed by default:

- ✓ `layout-regrouping` (display, flex-direction, justify-content, align-items, width, height)
- ✗ `token-drift` (color, background-color, border-color, border-radius, border-width) — silently dropped
- ✗ `copy-sizing-drift` (font-family, font-size, font-weight, line-height) — silently dropped
- ✗ `spacing-token-drift` (padding, margin, gap, row/column-gap) — silently dropped

Plus `MAX_DRIFTS_PER_BUCKET = 5` (line 314) caps each (screen, pattern) tuple at top-5 drifts. With systemic failures (e.g. bug-077: ~50 layout-regrouping divergences across the page) only 5 file → bug-fixer "fixes" them with surface-level JSX changes → audit refires → finds DIFFERENT top-5 → endless shell game until iteration cap.

### 1B — Deterministic discriminators (cheap pre-verifier checks)

For known systemic classes, emit bugs WITHOUT running parity-verify. ~10ms per check; bugs of these classes today cost full parity-verify + per-screen vision passes to detect.

| Discriminator | Bug class emitted |
|---|---|
| No `apps/web/postcss.config.{js,mjs,cjs}` AND has `tailwind.config.ts` | `tooling-css-pipeline-broken` (bug-077 class) |
| No `@tailwind base/components/utilities` directive in any project CSS | `tooling-css-pipeline-broken` |
| `output: "export"` in `apps/web/next.config.ts` AND `apps/api/` directory exists | `tooling-config-mismatch` (bug-081 class) |
| `apps/api/` exists AND `/test/cleanup` returns 404 OR `/test/seed-baseline` returns 404 | `tooling-test-seed-contract-broken` (bug-080 class) |
| `apps/web/app/` has dynamic route `[...]` AND `output: "export"` set | `tooling-config-mismatch` |

These short-circuit the loop for the obvious cases — handle bug-077 in 0ms instead of routing 30 surface-level bugs through bug-fixer.

## Reproduction Steps

### 1A
1. Run /fix-bugs on a project with bug-077 (no postcss config + no @tailwind directives)
2. Watch parity-verify run: divergences detected for color, font, spacing on every element
3. Confirm only `layout-regrouping` divergences file as bugs; the rest silently filtered

### 1B
1. Verify reading-log-02 today: `find apps/web -name "postcss.config*"` → before bug-077 was missing; today exists. The discriminator would emit no bug → correct
2. Verify a deliberately-broken project (rm postcss.config + grep -L @tailwind): the discriminator should emit `tooling-css-pipeline-broken` BEFORE parity-verify runs

## Root Cause Analysis

### 1A — Classifier defaults

`PATTERN_ALLOWLIST = ["layout-regrouping"]` was set as a conservative default per investigate-022 Step 3 to bound noise during initial rollout. The conservatism became silently load-bearing — operators don't know to set `AUDIT_COMPUTED_ALL_PATTERNS=1` because there's no signal that bugs are being suppressed.

### 1B — Missing pre-verifier discriminators

The verifier today runs the full parity-verify stack even when deterministic checks would catch the entire bug class for free. The current architecture has no pre-verifier hook for cheap deterministic detection.

## Fix Approach

### 1A
1. **`scripts/audit-computed-styles.mjs:316`** — change `PATTERN_ALLOWLIST = new Set(["layout-regrouping"])` to `new Set(["layout-regrouping", "token-drift", "copy-sizing-drift", "spacing-token-drift"])`. Move the conservative path behind opt-OUT env var: `process.env.AUDIT_COMPUTED_LAYOUT_ONLY === "1"`.
2. **`scripts/audit-computed-styles.mjs:314`** — `MAX_DRIFTS_PER_BUCKET` from 5 → 20. Or compute dynamically: `min(20, ceil(numElementsOnScreen × 0.3))`.
3. **NEW classifier path: systemic-divergence**. When a single (screen, pattern) tuple has >15 drifts, fold them into ONE high-priority `pattern: "systemic-divergence"` bug instead of N individual ones (deduplicates the shell-game). Routes to systemic-fixer (Phase 5).
4. Add `AUDIT_COMPUTED_LAYOUT_ONLY` to the operator env-flag documentation.

### 1B
1. **NEW module `orchestrator/src/pre-verify-discriminators.ts`** — pure functions, no Playwright, ~150 lines. Each discriminator: a function `(projectRoot) → BugEntry | null`.
2. **Wire into `build-to-spec-verify.ts`** to run before parity-verify. If any discriminator fires, EMIT the bug AND skip parity-verify for that iteration (the systemic bug masks all the symptom-bugs anyway).
3. Add tests for each discriminator (at least one positive + one negative case each).

## Rejected Fixes

- **Drop classifier patterns entirely; emit raw drifts.** Rejected because bucket classification is what makes the bugs meaningful for bug-fixer dispatch — raw drift entries lack the "pattern" field that dispatch routing relies on.
- **Make the conservative path opt-IN via flag instead of opt-OUT.** Rejected because the empirical signal (1/30 catch rate today) shows the conservative default IS the problem; opt-OUT preserves it for operators who want it but doesn't impose it on everyone.
- **Skip 1B and rely entirely on parity-verify.** Rejected because parity-verify costs ~30s per screen + 500-1000ms per element; deterministic discriminators are 10ms total. For known classes it's pure waste.

## Validation Criteria

- [ ] On reading-log-02 with intentionally-broken Tailwind: discriminator emits `tooling-css-pipeline-broken` BEFORE parity-verify
- [ ] All 4 classifier patterns ship by default; opt-out via `AUDIT_COMPUTED_LAYOUT_ONLY=1`
- [ ] Drift cap raised from 5 to 20 (or dynamic); systemic-divergence pattern emitted at >15 drifts
- [ ] Empirical: re-run reading-log-02 census against v2-Phase-1-only; catch rate ≥17% (the 5 token/color/spacing drifts surfaced)
- [ ] No regression on reading-log-01 / reading-log-pre-bugs (those projects have a working Tailwind pipeline; discriminators stay silent)
- [ ] Test coverage: ≥80% on the new pre-verify-discriminators.ts module

## Attempt Log

<!-- Populated by executing agents. -->
