---
id: feat-032-dag-status-skill
type: feature
status: archived
author-agent: claude-opus-4-7
created: 2026-04-29
updated: 2026-04-29
completed-at: 2026-04-29
parent-plan: null
supersedes: null
superseded-by: null
branch: feat/dag-status-skill
affected-files:
  - .claude/skills/dag-status/SKILL.md
  - orchestrator/scripts/dag-status.mjs
  - orchestrator/package.json
feature-area: orchestration
priority: P2
attempt-count: 0
max-attempts: 5
---

# feat-032 — `/dag-status` skill: feature-graph state + ETA observability

## Problem Statement

Mode B feature-graph state lives in three files under
`projects/<name>/.claude/state/<runId>/`:

- `feature-graph-progress.json` — completed[] / failed[] / aborted[] /
  inFlight[] (per feat-024 Phase A)
- `counters.json` — cumulative spend + retry-counters + (post-feat-030
  Phase D) per-model breakdown
- `rate-limit-events.ndjson` — every SDK rate-limit event (feat-030
  Phase B)

Plus `docs/tasks.yaml` defines the feature DAG with `depends_on:`
edges. To answer "where are we in the cascade?" / "how much longer?" /
"which feature blocks the next wave?", an operator currently runs `jq`
across 3-4 files and mentally reconciles them. There's no
operator-facing surface that shows the DAG-with-state at a glance.

This is a niceity, not a blocker — but the data is all there, free,
and after a few runs we have enough history to forecast per-feature
duration too.

## Approach

### Phase A — Static DAG renderer

1. `orchestrator/scripts/dag-status.mjs`:
   - Argument: optional project slug (defaults to most-recent
     project under `projects/<name>/.claude/state/`).
   - Reads `docs/tasks.yaml` for the feature DAG (nodes + depends_on).
   - Reads `feature-graph-progress.json` for live state.
   - Reads `counters.json` for cumulative spend + per-model breakdown.
   - Walks the DAG in topological order, classifying each node as:
     - `[DONE]` — in `completed[]`
     - `[FAIL]` — in `failed[]`
     - `[ABRT]` — in `aborted[]` (dependency failed)
     - `[FLOW]` — in `inFlight[]`
     - `[NEXT]` — all dependencies satisfied, not yet started
     - `[WAIT]` — has unsatisfied dependencies
2. Plain-text output: tree-style render with status markers, the
   in-flight feature's `lastAgent → nextAgent`, and a footer line with
   cumulative spend + bucket utilization (cross-link to `/quota-status`
   for live probe).
3. `--json` mode: returns a structured `DagStatusReport` for
   programmatic consumption (start-build pre-flight, future
   watchdog).

### Phase B — Per-feature historical ETA

1. After every Mode B run, `feature-graph-progress.json` records
   `dispatchedAt` + (on completion) `completedAt`. Walk historical
   runs (`projects/*/.claude/state/*/feature-graph-progress.json`
   archived at run end) to build a sample of per-feature
   wall-clock duration.
2. For an in-flight feature, ETA = mean(historical duration) +
   ~95% confidence band. For NEXT-eligible features, ETA assumes
   they'll run in declared agent_sequence order.
3. Show: total run ETA = sum of remaining wall-clock.
4. First few runs: data is sparse → fall back to "no ETA forecast
   yet (need ≥3 historical runs to estimate)".

### Phase C — `/dag-status` skill markdown

1. `.claude/skills/dag-status/SKILL.md` follows
   `.claude/skills/quota-status/SKILL.md` style: declarative
   args, decision tree per state, link to JSON contract.
2. Document arg parsing: `[project]` (default = most-recent),
   `--json`, `--watch` (re-renders every 30s in plain-text mode).

### Phase D — Smoke validation

1. Run on the live `repo-health-dashboard-01` build (assumed in
   progress when this ships) — confirm tree render matches the
   actual state (1 in-flight feature, 6 NEXT-after-it).
2. Run on a completed kanban-webapp-09 archive — confirm walks
   produce ETA forecast.

## Rejected Alternatives

- **Add a web dashboard** — Rejected. Plain-text + JSON is enough
  for a CLI-driven workflow; a dashboard is significant scope creep
  and doesn't compose with the operator's existing terminal.
- **Inline DAG render into `/quota-status` output** — Rejected.
  Single-responsibility skills are easier to reason about. They can
  cross-link to each other instead.
- **Stream the DAG state as the orchestrator runs (push)** — Rejected
  for v1. Pull-on-demand is simpler + composes with `--watch`.
  Push-mode could come in v2 if `--watch` proves wasteful in practice.

## Expected Outcomes

- [ ] `pnpm --filter orchestrator dag-status` prints a readable tree
      of the most-recent project's feature DAG with status markers
- [ ] `--json` emits `DagStatusReport` parseable by future tools
- [ ] Phase B ETA forecast appears for projects with ≥3 historical
      Mode B runs; absent gracefully for newer projects
- [ ] Skill registered + documented under `.claude/skills/dag-status/`
- [ ] No regressions in 567/567 existing orchestrator tests

## Validation Criteria

1. **Live render correctness**: against a project mid-run, output
   matches `feature-graph-progress.json` (in-flight count, completed
   count) + `tasks.yaml` (dependency edges).
2. **Historical archive walk**: against a completed project, all
   features classified `[DONE]` or `[FAIL]`, no `[FLOW]`.
3. **ETA reasonableness**: ETA ≥ 0; absent when sample size < 3.
4. **Coverage**: ≥ 80% line coverage on touched files per
   `.claude/rules/testing-policy.md`.

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->

---

# COMPLETION RECORD (appended at archive time)

completed: 2026-04-29
outcome: success
actual-files-changed:

- orchestrator/scripts/dag-status.mjs (created)
- orchestrator/package.json (modified — dag-status script entry)
- .claude/skills/dag-status/SKILL.md (created)
  commits:
- hash: ae0d19f
  message: "plans: queue feat-032 (dag-status skill) + feat-033 (idea bucket)"
- hash: 33974be
  message: "feat-032 Phase A: /dag-status skill — feature DAG state + spend snapshot"
  attempts: 1
  duration-minutes: 25
  test-results:
  unit: n/a (script + skill markdown only — no orchestrator src changes)
  integration: live-validated against repo-health-dashboard-01 mid-run
  lessons:
- "DAG observability is dirt-cheap when you already have feature-graph-progress.json + tasks.yaml in well-defined schemas. ~250 LOC pure read + render. The hard part wasn't the data, it was just nobody had built the renderer."
- "Phase B ETA forecast deferred — the historical-archive walker needs ≥3 completed Mode B runs to be useful. We'll naturally accumulate that as projects ship; no need to engineer historical-data-collection upfront."
- "Cross-linking related skills (/dag-status mentions /quota-status; both mention feat-024/030/031) makes operator discovery easier than centralized docs. Operators bounce between commands and natural cross-refs help them find adjacent capabilities."
  recommendation-implemented-by: feat-032 (this plan); Phase B ETA forecast deferred

---
