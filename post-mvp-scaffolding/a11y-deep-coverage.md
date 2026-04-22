# a11y-deep-coverage

**Deferred from**: investigate-002-build-tier-readiness-gap §Additional consideration (d).

## The concern

Visual-review rubric (`.claude/skills/visual-review/rubric.md`) checks for `:focus-visible` styles + WCAG AA contrast. That's not full accessibility coverage.

Genuine a11y requires:

- **Semantic HTML** — `<nav>`, `<main>`, `<aside>`, `<section>`, `<article>` used correctly; headings hierarchy (h1 → h2 → h3 with no skips)
- **Keyboard navigation** — tab order is logical; every interactive element is keyboard-reachable; escape closes modals; arrow keys work inside menus
- **Screen reader support** — `aria-label` / `aria-labelledby` / `aria-describedby` on non-text controls; `role` attributes where HTML elements don't suffice; live-region announcements for async changes
- **Form accessibility** — `<label for>` association; error messages linked via `aria-describedby`; required fields marked via `aria-required` not just asterisks
- **Skip links** — "skip to main content" on pages with big navs
- **Reduced motion** — respected via `prefers-reduced-motion` (visual-review checks global; needs per-animation discipline)
- **Color-independent information** — status always paired with icon/label, not color-only

## Why deferred

The reviewer agent's scope (per `reviewer-playbook.md` from refactor-005) includes an a11y dimension. MVP-level: reviewer walks a checklist + grades pass/fail. Upgrade: reviewer runs `@axe-core/playwright` against the running dev server + reports violations. The upgrade is what this file is about.

MVP checklist is sufficient for "don't ship a broken app"; the axe-core integration catches the 30% of violations a human checklist misses.

## Rough shape when it's time

**`feat-018-a11y-axe-integration`**:

1. Install `@axe-core/playwright` in the factory's workspace
2. Add `a11yCheck()` step to the tester's E2E flow per stack (web via `@axe-core/playwright`; mobile via manual audit since axe doesn't fully support RN)
3. Fail the feature's build if axe reports any `serious` or `critical` violations
4. `moderate` + `minor` violations surface as warnings in reviewer's output
5. Reviewer's playbook a11y dimension upgrades from "checklist-based" to "axe-driven + checklist residual"

Estimated size: small-medium plan. ~250 LOC + stack-skill updates for how to invoke axe per stack.

## When to revisit

When first autonomous mindapp-v2 run ships + the reviewer's a11y checklist surfaces gaps a tool would have caught automatically. Baseline real output first, upgrade later.

## Related

- The visual-review rubric already has rules that axe would also catch (focus-visible, contrast); coordinate so they don't duplicate effort
- Screen reader + keyboard navigation needs manual verification regardless of axe — axe doesn't catch "can a user actually complete the task with only a screen reader"
