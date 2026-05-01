---
id: investigate-013-seed-state-coverage-from-brief
type: investigation
status: completed
author-agent: human
created: 2026-05-01
updated: 2026-05-01
parent-plan: null
supersedes: null
superseded-by: null
branch: null
affected-files: []
feature-area: pm/builders/stack-skills/seed-data
priority: P1
attempt-count: 1
max-attempts: 5
time-box-minutes: 45
hypothesis: "PM-side enumeration of state-coverage requirements in the seed-script task description (combined with a stack-skill checklist rule) eliminates the bug class without needing a heavier verifier-tier check. Investigation should confirm OR falsify by sampling 3-5 brief shapes across shipped projects."
---

# investigate-013: How should the factory ensure seed scripts cover every state the brief promises?

## Question

bug-001 (`projects/finance-track-01/plans/active/bug-001-seed-script-missing-archived-account.md`) is one instance of a structural bug class:

> **The seed script (or test fixtures, or canonical example data) does not include rows demonstrating every state the brief promises is supported.**

In the finance-track case: the brief promises archived accounts (§5: "Archiving an account is **not** the same as deleting it... archived accounts hide from pickers but their transactions still appear in historical reports"), but the backend-builder produced a seed script with 3 active accounts and 0 archived accounts. The reviewer caught it after 2 retry-loops. ~$1-2 + ~3 minutes wasted per loop.

This will recur on every project. Predictable failure modes by project:

- **Kanban**: brief promises completed cards → seed only includes active.
- **Subscription/SaaS**: brief promises trial/active/expired tiers → seed only seeds active subscribers.
- **Inventory**: brief promises in-stock/back-ordered/discontinued → seed only includes in-stock.
- **Auth**: brief promises verified/unverified/locked accounts → seed only includes verified.
- **E-commerce**: brief promises returned/refunded orders → seed only includes paid+shipped.

**The investigation question**: Where in the factory pipeline is the right intervention point, what does it look like, and what is its scope of coverage?

Specifically:

1. **Which surface should own the rule** — PM task spec authoring? Stack-skill `§Seed` checklist? Reviewer dimension? Builder self-check? Build-to-spec verifier?
2. **What is the format** of "state coverage requirements" — free-text English in the task description (cheapest), structured YAML in the data-models companion (richer), inferred at audit time from the brief (most robust)?
3. **Does the same rule cover test-fixture data, demo data, and example-app data, or are those separate problems** with different coverage rules?
4. **What's the cheapest fix that closes ≥80% of the bug class** — and is the heavier formal answer worth its incremental cost?

## Hypothesis

**Primary hypothesis (low-cost-plus-high-leverage path)**: PM-side enumeration in the task spec + stack-skill checklist rule together eliminate the bug class.

Concretely:

- **PM extension**: when authoring the `seed-script` (or `test-fixtures`, or `data-only`) task description, PM walks the brief's `§5` (distinctions / what's not the same as), `§11` (capabilities), and §12 (acceptance criteria) and emits an explicit `requiredStates: [...]` field on the task. Example output:
  ```yaml
  - id: seed-script-data
    description: "Seed 100+ representative transactions and 4 accounts (3 active + 1 archived)."
    requiredStates:
      - "accounts.archived ≥ 1 row (brief §5 distinguishes archive from delete)"
      - "transactions.category coverage = all 8 enum values (brief §11)"
      - "transactions span all 12 reporting months (acceptance §15.6)"
      - "≥1 transaction belongs to an archived account (brief §5)"
    ...
  ```
- **Stack-skill checklist** (node-fastify, python-fastapi, node-trpc-nest, react-next data-fixtures section): the `§Seed` (or `§Fixtures`) subsection adds a generic review rule: "for any nullable column where the brief distinguishes the null/non-null states, seed both. For any enum column where multiple values appear in the brief, seed at least one row per value. For any boolean state with brief-level meaning (e.g. `is_archived`, `is_verified`), seed at least one true + one false row." Builders read stack skills before writing code → checklist lands at builder-prompt time.

**Falsifiable predictions**:

- If hypothesis is right: a sample of 3-5 shipped/in-flight project briefs (kanban, repo-health, finance-track, book-swap, finance-track) should have ≥3 brief sections that match the "state distinction" pattern AND that PM could mechanically extract.
- If hypothesis is wrong: either (a) the brief signal is too implicit to extract reliably (e.g. "the app supports archive" never says "you must seed archived data") OR (b) PM-side intervention catches archived-state-class but misses the larger class of "tests pass but no fixture demonstrates the feature" (e.g. an OAuth flow that has no fixture user with a refresh-token-expired state).

**Secondary hypothesis (heavier formal answer)**: a `state_coverage` companion file at `companion/state-coverage.yaml`, authored at the analyze-stage by analyst, consumed by PM (for task spec) + builder (as checklist) + reviewer (as verification target). Pros: single source of truth, machine-readable, queryable. Cons: another analyze-stage artifact to validate, another schema to maintain, blocking-on-analyst.

The investigation chooses between (or combines) these.

## Investigation Steps

(Time-box: 45 minutes. If incomplete, document partial findings + recommend next step.)

### Step 1 — sample brief audit (15 min)

Read brief.md + `companion/data-models.yaml` (where present) for 3-5 in-flight projects:

- `projects/finance-track-pre-build/brief.md` (the bug-001 case)
- `projects/repo-health-dashboard-01/brief.md` (shipped, validates "what bug class actually surfaced")
- `projects/kanban-webapp-pre-build/brief.md` (mutation-heavy multi-state)
- `projects/book-swap-pre-build/brief.md` (rich domain, multiple state machines)

For each, enumerate:

- **Brief-mentioned states** that the seed could fail to demonstrate. Categorize: nullable-column distinction (archived_at, deleted_at), enum coverage (status enums, category enums, tier enums), boolean state (verified, public, archived), composite state (transaction belonging to archived account, user with multiple subscriptions).
- **How the brief signals each one** — explicit ("must demonstrate X"), implicit-via-flow ("Flow 8 archives an account"), implicit-via-acceptance ("must work when archived"), or implicit-via-domain ("the system has accounts" + "archive is mentioned anywhere").
- **What PM would need to read** to pick up each signal — section, sentence, cross-reference between sections.

Goal: validate that PM can mechanically extract these signals OR identify the cases where extraction needs human judgment.

### Step 2 — current PM prompt audit (10 min)

Read `.claude/agents/pm.md` + `.claude/skills/pm/SKILL.md` to find:

- Where PM currently authors task descriptions (which prompt section, what context it has).
- Whether PM currently reads brief.md §5 (distinctions) — likely not, since §5 doesn't usually translate to task graph structure.
- Whether the `requiredStates` field would naturally fit on the existing task schema or needs a schema extension (`schemas/tasks.schema.json`).

Goal: scope the PM-side delta.

### Step 3 — current stack-skill seed sections audit (10 min)

Read the `§Seed` / `§Fixtures` / data-only subsections of:

- `.claude/skills/agents/back-end/node-fastify/SKILL.md`
- `.claude/skills/agents/back-end/python-fastapi/SKILL.md`
- `.claude/skills/agents/back-end/node-trpc-nest/SKILL.md`

Check what guidance exists today, and whether a 2-3 sentence "must-cover" rule could be added without disrupting the section's structure. Likely outcome: clean drop-in addition.

Also check whether the reviewer playbook (`docs/reviewer-playbook.md`) already has a brief-delivery dimension that touches this — if so, the PM/stack-skill changes complement existing reviewer behavior rather than replace it.

### Step 4 — alternative-design comparison (8 min)

Compare the 3 candidate intervention surfaces against 3 dimensions:

| Surface                         | Cost (eng-time)                                 | Coverage (% of bug class)              | Robustness (false-pos / false-neg)                      |
| ------------------------------- | ----------------------------------------------- | -------------------------------------- | ------------------------------------------------------- |
| PM task spec + stack skill      | 1-2 hours (text in 1 agent prompt + 3 skills)   | ?                                      | High (declarative, builder treats as checklist)         |
| Companion `state-coverage.yaml` | 1-2 weeks (new artefact + schema + validation)  | High (machine-readable, single source) | Highest (schema-validated)                              |
| Build-to-spec verifier check    | 1 week (verifier extension + state-spec format) | High (post-hoc catch)                  | Lowest (catches at the end, after builder spent budget) |

Step 1's findings populate the "Coverage" column.

### Step 5 — write findings + recommendation (2 min)

Document below.

## Findings

Investigation completed in **~18 min** of the 45-min time-box. The hypothesis was **falsified** — but in a strictly better direction. The actual fix is materially simpler than predicted.

### F1 — Brief-side signal is rich (Step 1, 4 briefs sampled)

All 4 sampled briefs expose state-coverage requirements through the same conventional sections:

| Project        | §5 (Key Distinctions)                                                      | §4 (Core Entities)                                                                                                                                                 | §11 (Screen Catalog)                                                    |
| -------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| finance-track  | "Archiving an account is **not** the same as deleting it" (5 distinctions) | "Account owns: archived flag" (entity field-level)                                                                                                                 | "with archived toggle to show/hide" (UI surface mentions)               |
| kanban-webapp  | (similar; Done-archive pattern)                                            | "default seed (To Do / In Progress / Done)" (column enum)                                                                                                          | (lifecycle in personas top-tasks)                                       |
| book-swap      | "Suspended user is not a deleted user" (state-machine distinctions)        | Listing.status: `pending_moderation \| active \| swapped \| removed` (5 explicit enums); Swap.state: `requested \| accepted \| declined \| completed \| cancelled` | "my-listings with status badges (pending / active / swapped / removed)" |
| repo-health-01 | "Cached vs stale (within TTL)", "403-rate vs 403-private vs 404"           | (no DB; CacheEntry is in-memory)                                                                                                                                   | (state surfaces in mock fixtures, not DB seed)                          |

**Pattern**: every brief has a §5 "Key Distinctions" section authored as `X is **not** the same as Y` bullets. Plus §4 entities enumerate state enums directly (`status: pending | active | swapped`). PM CAN mechanically extract these.

**Edge case** — repo-health-01 has no project-managed DB. The bug class doesn't apply uniformly; intervention should be conditional on `architecture.yaml.tooling.stack.persistence_layer == "real-db"`.

### F2 — PM ALREADY emits state-coverage requirements (Step 2)

Read `projects/finance-track-01/docs/tasks.yaml` lines 1034-1055 (the seed-script-data + reviewer-seed-script tasks PM emitted today):

```yaml
- id: seed-script-data
  agent: backend-builder
  summary: apps/api/src/db/seed.ts — pnpm --filter @repo/api db:seed creates 3 accounts (USD, GBP, JPY) + ~100 transactions across last 12 months across 8 categories.
  notes: |
    Per .claude/rules/testing-policy.md §When-this-policy-doesnt-apply:
    data-only tasks get builder happy-path only, no edge-case tester
    step. Idempotent (TRUNCATE allowlist + reseed) so dev can re-run.
    Includes one archived account for archive-flow testing. No fx
    rates seeded — fx-refresh hits Frankfurter on first run.
- id: reviewer-seed-script
  agent: reviewer
  summary: Reviewer pass — verify seed data exercises multi-currency totals + at least one archived account for testing.
```

PM **explicitly wrote** "Includes one archived account for archive-flow testing." in `notes:` and "verify ... at least one archived account" in the reviewer task summary. The PM-side intervention the original hypothesis proposed is already happening — and has been happening, because PM reads §5 / §11 / §15 already.

### F3 — Builder dispatch silently drops `task.notes` (Step 2, smoking gun)

`orchestrator/src/invoke-agent.ts:1516` — `buildAgentPrompt`:

```ts
const taskLines = tasks
  .map((t) => `  - ${t.id} (${t.agent})${t.summary ? `: ${t.summary}` : ""}`)
  .join("\n");
```

Only `t.id` + `t.summary` reach the agent's prompt. `t.notes` is **never read**. The builder receives:

```
Tasks assigned to you on this feature:
  - seed-script-data (backend-builder): apps/api/src/db/seed.ts — pnpm --filter @repo/api db:seed creates 3 accounts (USD, GBP, JPY) + ~100 transactions across last 12 months across 8 categories.
```

— with no mention of "archived account" anywhere. The builder produces a plausible 3-account seed. Two retries later, the reviewer (which DOES read tasks.yaml in full per the reviewer-playbook) catches the missing archived account because the reviewer's task summary names it explicitly.

This is the same shape as bug-024 (tester source-fix), bug-029 (UI primitives missing data-kit-component), bug-031 (fix-loop fixup-worktree not seeded) — a critical context channel was implicit when the orchestrator was MVP'd, then load-bearing material slipped through the gap.

### F4 — Reviewer DOES read full tasks.yaml (Step 3, partial)

Reviewer's playbook check confirms reviewer reads tasks.yaml directly + asserts brief-delivery. That's why the reviewer's verdict on feat-seed-script was specific and actionable ("seed.ts:26-38 ... add archived_at column to insertAccount INSERT") — the reviewer SAW the notes the builder didn't.

This explains the empirical pattern: 5 features merged cleanly (their notes happened to overlap with what summary covers OR weren't load-bearing for the bug class), 1 feature failed precisely on the notes-vs-summary delta. Future projects with richer state-coverage requirements in notes will fail at higher rates.

### F5 — Stack-skill audit (Step 3, partial)

`node-fastify/SKILL.md` has no `§Seed` section per se; seed scripts are mentioned in passing in §3 Testing (Strategy C) and §1 Canonical Layout. No explicit "seed must demonstrate every state in the brief" rule. Adding one would help, BUT it's downstream of the dispatch fix — the rule is moot if the builder never sees the spec asking for the state coverage.

`python-fastapi/SKILL.md` and `node-trpc-nest/SKILL.md`: same shape (verified by analogy from prior reads in this session; a deeper audit is unnecessary now).

### F6 — Tests-pass / spec-fails masking (corollary)

The builder's own tests passed (8/8 in seed.test.ts) because the builder authored both the seed AND its happy-path tests against the same incomplete mental model. Coverage thresholds didn't catch it because the missing state isn't a code branch — it's a missing data row. This is a fundamental gap that test coverage CANNOT close (you can't measure coverage of unseeded states); only spec-vs-implementation comparison catches it. That comparison happens in two places today:

1. The reviewer's brief-delivery dimension — works, but only at attempt-3 latency.
2. The builder's interpretation of the task spec — DOESN'T work, because the spec the builder sees doesn't contain the state-coverage requirement.

## Recommendation

**Ship `bug-035-builder-dispatch-drops-task-notes-field` (factory-level, P0).** The fix is a 5-line edit to `orchestrator/src/invoke-agent.ts:1516` — include `task.notes` in the per-task prompt block. Add a regression test asserting `task.notes` appears in the prompt when present.

**Skip `feat-046-pm-state-coverage-enumeration`** as originally hypothesized — the PM-side work is already happening. Spending engineering time enumerating what PM already does is wasted motion.

**Optionally queue `feat-046-stack-skill-seed-coverage-rule`** (factory-level, P2) — add a "seed must demonstrate every state mentioned in the task notes / brief §5" rule to the seed sections of node-fastify, python-fastapi, node-trpc-nest stack skills. This is **redundant** with the dispatch fix (the spec is now in the prompt; the builder's job is to satisfy it) but is **cheap insurance** for variance — costs ~30 min of editing 3 SKILL.md files. Defer until the dispatch fix lands and we observe whether residual variance still produces the bug class.

### Why bug not feat

The dispatch-drops-notes is a regression of intent — PM puts it there for builder to read; the wiring to actually deliver it never landed. Calling it `feat-` would imply we're ADDING capability; we're FIXING a load-bearing channel that was assumed to work.

### Empirical validation criterion (post-fix)

Re-run `feat-seed-script` against the dispatched fix. Expected behavior: builder reads the explicit "Includes one archived account" requirement in its prompt, seed.ts emerges with archived account on first attempt, reviewer's existing brief-delivery check passes without retry. If this happens, the bug class is closed for the entire factory. If a future project still produces a similar miss, file feat-046 stack-skill-seed-coverage-rule.

### Cross-references

- **bug-035 to file** (factory): single-PR fix to `orchestrator/src/invoke-agent.ts:1516` + regression test.
- **bug-001** (project): `projects/finance-track-01/plans/active/bug-001-seed-script-missing-archived-account.md` — the empirical case. Once bug-035 lands, the orchestrator's retry of feat-seed-script should fix bug-001 automatically (no manual seed.ts edit needed). bug-001's "Validation Criteria" already cover the same checkpoints.
- **bug-024** (factory, archived) — sister bug class: tester source-fix. Same root cause shape (orchestrator's prompt-context delivery being incomplete).
- **bug-031** (factory, archived) — `fix-loop fixup-worktree not seeded`. Same root cause shape (worktree-context delivery being incomplete).

## Attempt Log

- 2026-05-01 (single attempt, completed in ~18 min of 45-min time-box): Steps 1-2 executed in parallel; Step 2 surfaced the smoking gun at `invoke-agent.ts:1516`. Steps 3-4 truncated (no value remaining once root cause was clear). Recommendation written. No follow-up `investigate-014` needed; bug class is fully scoped.

## Attempt Log

<!-- populated by agents -->
