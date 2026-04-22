# runtime-signoff-gate

**Deferred from**: investigate-002-build-tier-readiness-gap §Additional consideration (g).

## The concern

Gate 4 (`/user-flows-generator` viewer) binds `screensManifestHash` (static HTML) + `visualReviewReportHash` + `uiKitVersion`. The user approves the DESIGN — composed HTML screens that look like the finished app.

The BUILT app (after builders + tester + reviewer) may differ subtly from the sign-off screens:

- Responsive behaviour at real viewport sizes vs static template
- Interactive state that static HTML can't show (hover, loading, error, empty)
- Real data shape rendered via real API calls vs lorem-ipsum placeholders
- Stack-specific quirks (Svelte's hydration vs Next.js server-components)

Proposed: **gate 7** after reviewer passes. Orchestrator boots the built dev server, captures a screenshot per flow per viewport, renders a final viewer similar to gate-4. Human sees the BUILT app vs SIGNED-OFF app + approves the delta.

## Why deferred

- Reviewer's brief-delivery check (even Option A) catches gross mismatches
- Tester's E2E tests catch behavioural regressions
- Visual-review caught most layout issues at design time
- The static-vs-live delta is usually small when builders dispatch via stack skills that preserve structure

Gate 7 would catch the last 5% — a safety net for the first few autonomous runs. Not blocker-level for MVP.

## Rough shape when it's time

**`feat-020-runtime-signoff-gate`**:

1. After reviewer approves in feat-009, orchestrator boots dev servers:
   - `pnpm --filter @repo/web dev &` + wait-for-ready ping
   - `pnpm --filter @repo/mobile start &` + Expo Go / simulator boot
2. Per flow in `docs/analysis/{platform}/flows.md`, Playwright/Maestro walks the flow + captures screenshot at each step
3. Builds `docs/runtime-signoff-{timestamp}.html` viewer: side-by-side comparison of `docs/screens/{platform}/{flow}-step-N.html` (signed-off) vs `docs/runtime-screenshots/{platform}/{flow}-step-N.png` (live app)
4. POSTs to `http://localhost:PORT/api/runtime-signoff` on submit; binds `screensManifestHash + visualReviewReportHash + uiKitVersion + runtimeScreenshotsHash`
5. Drift rejection: if any hash moved since gate-4 signoff, the gate-7 viewer flags the delta

Estimated size: medium plan. ~400 LOC — shares 70% infra with gate-2 + gate-4 HTTP servers.

## When to revisit

After 2-3 autonomous runs ship + we see actual design-vs-build drift. If drift is ~0, gate 7 is paranoia; if drift is meaningful, gate 7 is load-bearing.

## Related

- Shares dev-server boot with `brief-delivery-validation-depth.md` — coordinate boots so only one dev server runs per review pass
- Overlaps with `/visual-review` screenshot infrastructure — reuse `scripts/visual-review-preflight.mjs`
