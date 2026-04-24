---
id: feat-016-post-mvp-catalog-promotion
type: feature
status: draft
author-agent: claude-opus-4-7
created: 2026-04-24
updated: 2026-04-24
parent-plan: investigate-002-build-tier-readiness-gap
supersedes: null
superseded-by: null
branch: feat/post-mvp-catalog-promotion
affected-files:
  - post-mvp-scaffolding/README.md
  - post-mvp-scaffolding/<each-stub>.md # add status + trigger frontmatter
  - .claude/skills/post-mvp-review/SKILL.md # new
  - .claude/skills/plan-status/SKILL.md # extend
  - scripts/post-mvp-review.mjs # new
  - docs/post-mvp-review-log.md # new — running ledger of reviews
feature-area: orchestration
priority: P2
attempt-count: 0
max-attempts: 5
---

# feat-016 — Post-MVP catalog promotion mechanic

## Problem Statement

`post-mvp-scaffolding/` currently has 17 stub files (14 originally from investigate-002 + 3 from investigate-003 IaC bundle) catalogued in `post-mvp-scaffolding/README.md`. Each stub has a **trigger** describing when to promote it to an active plan (e.g. "multi-project-concurrency.md — trigger: user runs 2+ pipelines at once"), but today the triggers are prose-only + there's no discipline for reviewing them.

Three problems result:

1. **Silent staleness**: a stub's trigger may have been met months ago without anyone noticing. Example: if the factory produces 4 apps in a quarter, `quickstart-command.md` (trigger: "after design pipeline ships") is now promotable — but nothing surfaces that fact.
2. **Unstructured promotion path**: the README says "When it's time: author a full /plan-feature". No tool, no timer, no cadence. Promotion is opt-in manual + forgettable.
3. **No review history**: we can't see what was considered + deferred + why, across review rounds. A stub that was "deferred, not-viable-yet" three times running might actually be a dead concern (factory evolved past it); without history, we re-consider from scratch every time.

This plan ships the **promotion mechanic** — not any individual item's implementation. After this, a `/post-mvp-review` skill surfaces promotable items per a review cadence; humans decide; history lives in `docs/post-mvp-review-log.md`. The 17 stubs themselves get a standardized frontmatter (status + trigger + last-reviewed + review-history) so machine-read of the catalog is reliable.

This is not a one-off setup — it's an ongoing discipline. The plan ships the first review run as validation + establishes the cadence.

Reference: `post-mvp-scaffolding/README.md`; `plans/archive/investigate-002-build-tier-readiness-gap.md` §Recommendation.

## Approach

Three phases.

### Phase A — Stub frontmatter standardization

Goal: every stub in `post-mvp-scaffolding/` has machine-parseable frontmatter tracking status + trigger + review history.

1. **Define frontmatter schema** in `schemas/post-mvp-stub.schema.json`:

```yaml
---
id: <slug> # e.g. "multi-project-concurrency"
status: deferred | promoted | superseded | dead
trigger:
  condition: <prose> # "user runs 2+ pipelines at once"
  observable: <grep pattern OR cmd> # optional — how to detect automatically
  priority-if-fired: P0 | P1 | P2 | P3 # triage hint
last-reviewed: YYYY-MM-DD
review-count: <int>
review-history:
  - date: YYYY-MM-DD
    decision: keep-deferred | promote | mark-dead | adjust-trigger
    note: <short reason>
promoted-to: <plan-id or null> # when status: promoted
superseded-by: <plan-id or null> # when design changes render moot
---
```

2. **Patch each of the 17 stubs** with this frontmatter. Status starts `deferred`; trigger copies from existing prose; review-history starts empty; last-reviewed set to `2026-04-24` (this plan's creation).

3. **Update `post-mvp-scaffolding/README.md`** to document the frontmatter convention + the review cadence (see Phase B). README parse its own directory to auto-generate the index table instead of hand-maintaining.

### Phase B — `/post-mvp-review` skill

Goal: one-command review surface. `/post-mvp-review` lists all stubs, flags ones whose triggers have likely fired, proposes promotion / mark-dead / keep-deferred per stub, and logs the decision.

4. **Author `.claude/skills/post-mvp-review/SKILL.md`**:
   - Load every `post-mvp-scaffolding/*.md` + parse frontmatter
   - For each stub: run `trigger.observable` if present (e.g. grep logs, check file counts, ask the user yes/no for prose-only triggers)
   - Surface findings to user: "3 stubs have likely-fired triggers: quickstart-command (factory has 4 projects), cost-projection-preview (you've asked 'how much will this cost?' 3 times), lessons-agent (14 plans archived without aggregation). Promote? [y/n per stub]"
   - For items the user decides to promote: author a `/plan-feature` stub in `plans/active/` referencing the post-mvp stub; mark the stub status: `promoted` + record `promoted-to`
   - For items the user marks dead: status: `dead` + review-history entry explaining why
   - For items the user keeps deferred: increment review-count + update last-reviewed
   - Append every decision to `docs/post-mvp-review-log.md` with timestamp

5. **Script `scripts/post-mvp-review.mjs`** — non-interactive sibling for CI / cron. Emits a JSON report of "triggered but unpromoted" stubs (so a human notices even if they haven't run the skill in months). Useful for a "monthly review" GitHub Action.

6. **Extend `/plan-status`** to surface the review-cadence alert: "Next post-mvp review due: 2026-05-24 (30 days since last review)." The cadence is 30 days default, configurable in `~/.claude/models.yaml.orchestration.postMvpReviewCadenceDays`.

### Phase C — First review + cadence establishment

7. **Run the first review** — validates the skill + catalog simultaneously. Decisions made here become the baseline review-history entries.

Expected outcomes of the first review:

| Stub                            | Likely decision        | Reason                                                      |
| ------------------------------- | ---------------------- | ----------------------------------------------------------- |
| multi-project-concurrency       | keep-deferred          | still 1 project at a time                                   |
| factory-self-upgrade            | keep-deferred          | no in-flight projects to protect                            |
| python-stack-codegens           | keep-deferred          | no python brief yet                                         |
| mobile-stack-codegens           | keep-deferred          | no native mobile brief yet                                  |
| quickstart-command              | **consider promoting** | 3 projects scaffolded; cold-start is a real UX pain         |
| agent-expert-meta-agent         | keep-deferred          | no 4th new agent needed                                     |
| app-store-compliance            | keep-deferred          | no app store submission target                              |
| mutation-testing-policy         | keep-deferred          | no real tester output yet                                   |
| partial-failure-policy          | keep-deferred          | no feature-graph runs with mixed outcomes yet               |
| cost-projection-preview         | **consider promoting** | 3 runs yielded cost data; gate-5 preview is reasonable now  |
| a11y-deep-coverage              | keep-deferred          | reviewer's a11y checklist hasn't missed anything reviewable |
| security-checklist-grounding    | keep-deferred          | reviewer's starter checklist hasn't missed issues yet       |
| brief-delivery-validation-depth | keep-deferred          | Option A (static) hasn't failed yet                         |
| runtime-signoff-gate            | keep-deferred          | no design-vs-build drift observed                           |
| iac-stack-shelf                 | keep-deferred          | no cloud-deploy target                                      |
| multi-env-deploy                | keep-deferred          | coupled with iac-stack-shelf                                |
| ci-cd-deploy-automation         | keep-deferred          | coupled with iac-stack-shelf                                |

The two "consider promoting" items (quickstart + cost-projection) produce concrete candidate plans; human decides whether to author full plans now or defer again.

8. **Record the baseline** in `docs/post-mvp-review-log.md` with timestamp + decisions + any plans promoted.

9. **Set next review** — 30 days from first review (≈ 2026-05-24). Recorded in the log. A GitHub Action or cron could run `scripts/post-mvp-review.mjs --report-only` and open a GitHub issue if triggered stubs sit > 60 days without promotion decision.

### Testing at each stage

| Phase | Stage               | Testing mechanic                                          | Pass criteria                                                                                |
| ----- | ------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| A     | Frontmatter schema  | validate-post-mvp-schema.mjs against all 17 stubs         | All parse as schema-valid                                                                    |
| A     | README parse        | README rebuilds its index from frontmatter                | Output identical to prior hand-authored version (modulo formatting)                          |
| B     | Skill structure     | markdownlint + dispatch dry-run                           | Skill loads + produces structured JSON output on each stub                                   |
| B     | Observable triggers | Each stub with an `observable` defined; run the predicate | Either returns boolean cleanly, or reports "requires human input" without crashing           |
| B     | Log append          | Dry-run the skill against fixtures                        | docs/post-mvp-review-log.md appends a review-block without mutating prior entries            |
| C     | First review        | Interactive run on real 17 stubs                          | User-facing prompt lists all 17 with triage hints; decisions persist to frontmatter + log    |
| C     | Plan emission       | User chooses to promote quickstart-command                | plans/active/feat-017-quickstart.md (or next feat-id) drafted correctly referencing the stub |

## Rejected Alternatives

### Alternative A: Hand-review the stubs periodically without tooling

**Why rejected**: Already failing today. `investigate-002` stubbed 14 items; several have had their triggers met (3+ projects shipped, 14+ plans archived) without surfacing. Hand-review without a surface is forgetful-by-default. Surfacing + logging cadence are cheap; the missed-signal cost compounds.

### Alternative B: Auto-promote triggered stubs without human review

**Why rejected**: Triggers are probabilistic, not authoritative. "user runs 2+ pipelines at once" could fire because of a copy-paste test run rather than genuine need. Auto-promotion produces noise; keep-deferred-by-default with human confirmation stays signal-rich.

### Alternative C: Delete deferred stubs once the factory evolves past them instead of marking `status: dead`

**Why rejected**: Audit trail matters. Knowing "we considered this + decided against it + here's why" protects future us from re-arguing decisions + rediscovering context. Dead stubs are ~2KB each; cost to keep is trivial; cost to rebuild context is not.

### Alternative D: Ship this after all extension plans complete (feat-015)

**Why rejected**: feat-016 is near-free (~3-4h). Running it before feat-015 isn't a dependency (feat-015 is self-contained), but running it soon after feat-014 MVP-exit means the first review happens while the factory's state + failure patterns are freshest. Deferring it to after feat-015 costs review-freshness for no real benefit.

## Expected Outcomes

- [ ] All 17 `post-mvp-scaffolding/*.md` have schema-valid frontmatter (status + trigger + review-history)
- [ ] `schemas/post-mvp-stub.schema.json` ships + `scripts/validate-post-mvp-schema.mjs` passes
- [ ] `.claude/skills/post-mvp-review/SKILL.md` loads + runs against all 17 without crashing
- [ ] `scripts/post-mvp-review.mjs --report-only` emits JSON listing triggered-but-unpromoted stubs
- [ ] First review run recorded in `docs/post-mvp-review-log.md` with a timestamp + 17 decisions
- [ ] At most 2 stubs promoted to new active plans (quickstart + cost-projection are the likeliest candidates); human confirms each promotion
- [ ] `/plan-status` surfaces "Next post-mvp review: YYYY-MM-DD" in its output

## Validation Criteria

- **Schema**: `node scripts/validate-post-mvp-schema.mjs post-mvp-scaffolding/*.md` exits 0
- **No regressions**: `/plan-status` still works for regular plan listing
- **Log integrity**: `docs/post-mvp-review-log.md` structured as append-only; re-running the skill doesn't mutate prior entries
- **Promotion integrity**: any promoted plan has frontmatter `parent-plan` pointing at this plan's ID (or the underlying investigation if deeper); the promoted stub has frontmatter `promoted-to: <new-plan-id>`
- **Cadence recording**: `~/.claude/models.yaml.orchestration.postMvpReviewCadenceDays` respected; `/plan-status` alert fires when overdue

## Attempt Log

<!-- Executing agent fills this in as attempts complete. -->

## References

- `post-mvp-scaffolding/README.md` — current catalog
- `plans/archive/investigate-002-build-tier-readiness-gap.md` — source of 14 stubs
- `plans/archive/investigate-003-infrastructure-as-code.md` — source of 3 IaC stubs
- `docs/build-tier-roadmap.md` §Post-MVP scaffolding
- `plans/active/feat-014-mvp-completion-autonomous-e2e.md` — MVP exit produces the first ready-for-review signal
- `plans/active/feat-015-factory-extensions-post-mvp.md` — sibling plan; runs independently
