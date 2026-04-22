# brief-delivery-validation-depth

**Deferred from**: investigate-002-build-tier-readiness-gap §Additional consideration (f).

## The concern

User's answer #5 to investigate-002 open questions: **add brief-delivery check to reviewer's scope** (rather than a new brief-delivery-check agent). Reviewer confirms "the app delivers what brief §12 promises."

There are two depths this check can take:

- **Option A (MVP)** — reviewer walks `tasks.yaml.features[]` + confirms each has `status: completed` + reviews the committed code matches the feature's description. **Static-analysis depth.**
- **Option B (post-MVP)** — reviewer boots the dev server via Playwright + walks every brief §12 P0 feature's golden path as a real user; captures screenshots + confirms UI renders + interactions work. **Runtime-behaviour depth.**

Option A ships with feat-009 reviewer implementation. Option B is this file's scope.

## Why deferred

Option A catches the big failures (feature-not-built, feature-half-built). Option B catches subtle runtime regressions (feature-built-but-buggy-at-runtime) — but those should be caught by tester's E2E flows already. Option B is additive insurance, not primary defense.

## Rough shape when it's time

**`feat-019-reviewer-runtime-walkthrough`**:

1. Reviewer reads brief §12 Key Features; filters to P0
2. For each P0 feature, reads the matching `docs/analysis/{platform}/flows.md#flow-N` to get the user-action sequence
3. Invokes Playwright (web) / Maestro (mobile) to execute the flow against a dev-server-booted instance
4. Captures final screenshot; confirms no JavaScript errors in console; confirms HTTP response codes match expected
5. On failure: flags `brief-delivery-failure[]` in reviewer's return JSON with per-feature screenshots + console output

Estimated size: medium plan. ~400 LOC + per-stack dev-server boot commands (already in stack skills' §Commands `dev:` block).

## When to revisit

After Option A (in feat-009) runs on first autonomous mindapp-v2 + we see what it catches vs misses. Option B adds cost (~$3-5 per feature walkthrough × N features) so we want to know it's adding real signal before committing.

## Related

- Overlaps with `runtime-signoff-gate.md` — both involve booting the built app. Coordinate so one boot serves both checks.
- `/visual-review` already captures screenshots of composed HTML; this is different — it captures the LIVE RUNNING app with real data + real clicks.
