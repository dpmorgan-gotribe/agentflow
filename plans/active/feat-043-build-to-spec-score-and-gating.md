---
id: feat-043-build-to-spec-score-and-gating
type: feature
status: draft
author-agent: claude-opus-4-7
created: 2026-04-30
updated: 2026-04-30
parent-plan: investigate-012-factory-readiness-pre-builds
supersedes: null
superseded-by: null
branch: feat/quota-observability
affected-files:
  - orchestrator/src/build-to-spec-verify.ts
  - packages/orchestrator-contracts/src/build-to-spec-verify.ts
  - schemas/build-to-spec-verify-output.schema.json
  - .claude/skills/build-to-spec-verify/SKILL.md
  - scripts/score-project.mjs # new
  - orchestrator/tests/build-to-spec-score.test.ts # new
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-043 — `/build-to-spec-verify` emits 8-dimension `score.json` with verdict gating

## Problem Statement

F6 of `investigate-012`. The 8-dimension rubric (Mode A / Mode B / Reach / Parity / Flow E2E / Coverage / Verifier / Manual) is defined in investigate-012 §F-1 but has no automated computation today. For feat-045 (repo-health-dashboard-01) we hand-compute the score per investigate-012's `Phase E — Compute score; verify ≥95`. That's tolerable for one project; not scalable for 6.

Operator decision (locked in investigate-012): score-gate is **advisory only** — verifier emits itemized tickets at <95 but never blocks `/fix-bugs` or `/start-build` exit. Operator decides when to ship.

## Approach

### Phase 1 — Score computation in `build-to-spec-verify.ts`

Extend the orchestrator's `runBuildToSpecVerify` (or wrap as a post-step) to compute each dimension's score:

- **Mode A** (10): count gate files (`gate-{1,3,4}-approved.txt` + `selected-style.json` + `credentials-confirmed.txt`) → score = (count/5) × 10
- **Mode B** (15): parse `tasks.yaml` features[]; cross-reference `feature-graph-progress.json` for `completed[]` count → score = (completed/total) × 15
- **Reachability** (10): existing audit run → score = `orphans == 0 ? 10 : max(0, 10 - 0.5 × orphans)`
- **Parity** (15): existing parity-verify run → score = (passing/total) × 15
- **Flow E2E** (20): existing run-synthesized-flows → score = (passing/total) × 20
- **Coverage** (10): NEW — read `apps/{web,api}/coverage/coverage-summary.json` (vitest) AND `apps/api/coverage.xml` (pytest) if present; aggregate `total.lines.pct`; score = `min(actual, 80) / 80 × 10`
- **Verifier exit** (10): read `bugs.yaml` post-fix-loop; score = `pending == 0 ? 10 : 0`
- **Manual sanity** (10): check `docs/manual-sanity-confirmed.txt` exists + contains numbered checklist (≥1 numbered line per flow, e.g. `^\d+\. `); score = `checklist_complete ? 10 : 0`

### Phase 2 — Verdict + score artefact

Emit `docs/build-to-spec/score.json`:

```json
{
  "version": "1.0",
  "computedAt": "2026-04-30T...",
  "score": 87,
  "verdict": "needs-itemized-tickets",
  "dimensions": {
    "modeA": { "weight": 10, "achieved": 10, "details": "5/5 gates resolved" },
    "modeB": {
      "weight": 15,
      "achieved": 12,
      "details": "8/10 features completed"
    },
    "reachability": { "weight": 10, "achieved": 10, "details": "0 orphans" },
    "parity": { "weight": 15, "achieved": 13, "details": "11/12 screens pass" },
    "flowE2E": { "weight": 20, "achieved": 16, "details": "6/8 flows pass" },
    "coverage": { "weight": 10, "achieved": 9, "details": "76%/80% baseline" },
    "verifierExit": {
      "weight": 10,
      "achieved": 10,
      "details": "0 pending bugs"
    },
    "manualSanity": {
      "weight": 10,
      "achieved": 0,
      "details": "manual-sanity-confirmed.txt missing"
    }
  },
  "itemizedTickets": [
    {
      "dimension": "coverage",
      "shortBy": 1,
      "remediation": "Bring web coverage to 80% (currently 76%)"
    },
    {
      "dimension": "manualSanity",
      "shortBy": 10,
      "remediation": "Operator: walk all 8 flows and author docs/manual-sanity-confirmed.txt with numbered per-flow checklist"
    }
  ]
}
```

Verdict thresholds:

- ≥95 → `"ship-ready"`
- 90-94 → `"needs-itemized-tickets"` (advisory)
- <90 → `"needs-major-revision"` (advisory)

**No hard gating** — `/start-build` and `/fix-bugs` continue to exit on their own success criteria; the score is a reporting artefact only.

### Phase 3 — Schema + contract

Extend `BuildToSpecVerifyOutput` Zod schema to include `score: ScoreJson` (optional during rollout). Sync JSON schema. Add tests.

### Phase 4 — Standalone `score-project.mjs` script

For ad-hoc operator-driven scoring (e.g. on a project that didn't go through /build-to-spec-verify recently):

```
node scripts/score-project.mjs <project-name>
```

Reads existing artefacts (gates, tasks.yaml, bugs.yaml, coverage-summary.json, etc.) and computes the score without re-running the verify pipeline. Useful during rubric tuning + roadmap progress audits.

### Phase 5 — Skill update

Update `.claude/skills/build-to-spec-verify/SKILL.md` to document the score emission step. Operator-facing reporting format.

## Rejected Alternatives

- **Hard-gate `/fix-bugs` at <90** — operator picked advisory in investigate-012 lock. Don't override.
- **Compute score from a separate skill (`/score-project`)** — would split logic across two surfaces; verifier owns measurement either way. Add a CLI shim (Phase 4 above) but keep the source-of-truth in `build-to-spec-verify`.
- **Auto-file `bugs.yaml` entries for short dimensions** — `bugs.yaml` is for runtime bugs, not score tickets. Itemized tickets in `score.json` keep the channels separate.
- **Land before feat-045** — would require feat-045 to wait. Hand-computed score for one project is fine; F6 can ship in parallel.

## Expected Outcomes

- [ ] `docs/build-to-spec/score.json` emitted by `/build-to-spec-verify` with all 8 dimensions populated
- [ ] Verdict thresholds wired (ship-ready / needs-itemized / needs-major)
- [ ] `BuildToSpecVerifyOutput` schema extended; sync to projects
- [ ] `scripts/score-project.mjs` ships for ad-hoc scoring
- [ ] Skill doc updated
- [ ] Tests cover each dimension's computation + threshold transitions

## Validation Criteria

- Hand-computed score for repo-health-dashboard-01 (feat-045 Phase E) matches the automated score
- Hand-computed score for kanban-webapp-09 (when re-built via kanban-webapp-pre-build) matches automated
- Tests confirm dimension boundary transitions (e.g. orphans 0→1 drops Reachability from 10 to 9.5; gates 4→5 raises Mode A from 8 to 10)
- score.json validates against its JSON schema

## Attempt Log

(empty — pending; ships in parallel with feat-045 Phase E so subsequent projects don't need hand-computation.)
