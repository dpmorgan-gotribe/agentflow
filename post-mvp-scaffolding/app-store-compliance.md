# app-store-compliance

**Deferred from**: investigate-002-build-tier-readiness-gap §Deferred; scaffolding task 040.

## The concern

Apple App Store + Google Play Store have submission-time checklists: privacy manifest, age-rating, data-collection disclosure, permission justification strings, App Tracking Transparency, COPPA under-13 gate, export compliance cryptography declaration, accessibility audit, screenshot set per device size, app-store icon in N sizes, marketing copy fields. All automatable given the brief's compliance + assets sections.

Task 040 in scaffolding specifies this as tier-10 post-MVP compliance layer.

## Why deferred

First autonomous run (mindapp-v2) targets web + maybe mobile demo — not store submission. Shipped-to-store requires the reviewer's compliance dimension already + these store-specific artefacts. The MVP path ships to a GitHub PR, not a store.

## Rough shape when it's time

**`/app-store-compliance` skill** invoked as the final stage after reviewer passes:

1. Read `brief.md §14 Compliance` + `architecture.yaml` + `docs/analysis/shared/assets.md`
2. Emit `apps/mobile/ios/AppStoreConnect.config.json` — submission metadata
3. Emit `apps/mobile/android/play-console.config.json` — Google Play listing
4. Validate privacy-manifest requirements (iOS) against integrations.\* vendor list — e.g. Stripe requires "Purchase History" declaration; Firebase requires "Analytics Data"
5. Emit screenshot-capture script that renders each persona flow at every store-required device size
6. Human-review output before submission (not automated); factory doesn't actually submit

Estimated size: medium plan. ~500 LOC across skill + config templates + screenshot automation.

## When to revisit

When an app wants to be submitted to iOS App Store or Google Play. Projects targeting only web or only internal distribution skip this entirely.

## Related

- Relies on `brief.md §14` being thoroughly filled — if briefs skip compliance, this skill has nothing to work with
- Screenshot automation overlaps with `/visual-review`'s Playwright capture — could share the preflight helper
