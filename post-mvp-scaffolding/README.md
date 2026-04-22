# post-mvp-scaffolding/ — deferred items to revisit after first autonomous run

Items captured here were identified during `investigate-002-build-tier-readiness-gap` as **legitimate concerns that aren't MVP blockers**. Each file documents:

1. What the concern is
2. Why it's deferred (what failure mode or use case surfaces it)
3. Rough shape of how we'd address it when it's time

The MVP target is the 8-plan critical path in `docs/build-tier-roadmap.md`: task-035 → task-036 → feat-005 (architect) → feat-006 (pm) → feat-007 (builders) → refactor-005 + feat-008 (tester) + feat-009 (reviewer). That gets us from brief → PR-awaiting-human-approval on mindapp-v2's re-run.

Items here are **explicitly NOT on that path**. Return after:

- First autonomous run ships successfully (mindapp-v2 re-run → approved + merged PR)
- OR a specific failure mode during the first run surfaces one of these concerns earlier
- OR enough time has passed that we have 3+ apps shipped + meaningful failure patterns to inform design

## Index

### From investigate-002's "deferred novel concerns"

- [multi-project-concurrency.md](./multi-project-concurrency.md) — running N pipelines concurrently on one machine (concern A)
- [factory-self-upgrade.md](./factory-self-upgrade.md) — propagating factory changes to in-flight projects (concern D)

### From investigate-002's "deferred follow-up plans"

- [python-stack-codegens.md](./python-stack-codegens.md) — `zod-to-pydantic` codegen + related plumbing
- [mobile-stack-codegens.md](./mobile-stack-codegens.md) — Dart/native token-mirror generators
- [quickstart-command.md](./quickstart-command.md) — cold-start UX: `/quickstart <name> --proposal` → full design run in one command
- [agent-expert-meta-agent.md](./agent-expert-meta-agent.md) — task 039, meta-agent that authors new agents
- [app-store-compliance.md](./app-store-compliance.md) — task 040, iOS/Android submission-ready checklists

### From "7 additional considerations for truly shippable code"

- [mutation-testing-policy.md](./mutation-testing-policy.md) — behavioural coverage beyond line coverage (concern a)
- [partial-failure-policy.md](./partial-failure-policy.md) — feature-graph: 12 of 20 features succeed; ship or abort? (concern b)
- [cost-projection-preview.md](./cost-projection-preview.md) — gate-5-time cost estimate "you're about to spend $~45" (concern c)
- [a11y-deep-coverage.md](./a11y-deep-coverage.md) — axe-core + semantic HTML + keyboard flows beyond visual-review (concern d)
- [security-checklist-grounding.md](./security-checklist-grounding.md) — OWASP ASVS Level 1 + Mobile Top 10 as concrete reviewer checklist (concern e)
- [brief-delivery-validation-depth.md](./brief-delivery-validation-depth.md) — Option B: reviewer boots dev server + walks every brief §12 P0 feature (concern f)
- [runtime-signoff-gate.md](./runtime-signoff-gate.md) — gate-7: capture running-app screenshots after build for final human sign-off (concern g)

## When to promote from here to active

Each file is a **stub**, not a full plan. When it's time to address one:

1. Read the stub — is the concern still live? Has the architecture changed so the concern is moot?
2. If live: author a full `/plan-feature` or `/plan-refactor` in `plans/active/`; reference this stub from the new plan's Problem Statement
3. Mark the stub as `status: promoted` with a pointer to the new plan ID
4. Leave the stub in place as audit trail — don't delete

## Cross-cutting philosophy

Deferring isn't neglect. Each item here was considered + scored against the MVP target. The thing that separates "MVP" from "post-MVP" in our factory is: **does the first autonomous run on mindapp-v2 produce a merge-able PR without this?** If yes, it's here. If no, it's on the 8-plan critical path.

Some items here will never ship — they might be superseded by design changes elsewhere. That's OK. The index is a conversation starter, not a contract.
