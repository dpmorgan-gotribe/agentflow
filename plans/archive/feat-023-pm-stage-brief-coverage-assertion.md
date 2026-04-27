---
id: feat-023-pm-stage-brief-coverage-assertion
type: feature
status: completed
author-agent: claude-opus-4-7
created: 2026-04-27
updated: 2026-04-27
completed-at: 2026-04-27
parent-plan: investigate-006-build-to-spec-verification
supersedes: null
superseded-by: null
branch: feat/pm-stage-brief-coverage-assertion
affected-files:
  - .claude/skills/pm/SKILL.md
  - .claude/agents/project-manager.md
  - scripts/audit-brief-coverage.mjs
  - schemas/brief-coverage-output.schema.json
  - packages/orchestrator-contracts/src/brief-coverage.ts
  - orchestrator/src/stage-runner.ts (gate after /pm)
feature-area: pm
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-023 — PM-stage brief coverage assertion

## Summary

Per investigate-006 Pattern C: 3 of 8 kanban-webapp-09 integration gaps were **PM-stage holes** — `tasks.yaml` simply omitted features the brief promised:

- Column rename (brief §12 "users can rename a column inline") — no task, no store action shipped
- Column delete (brief §12 "users can delete an empty column") — same
- `/help` route (brief §11.4) — deferred during PM authoring, never resurfaced

These can't be caught at Mode B by feat-022 (it can only verify what the task graph asked for). They need a **preventative coverage check at the PM stage**: assert every brief §11/§12 capability has a corresponding task in `tasks.yaml` before gate 4 sign-off allows Mode B to start.

## Goals

1. PM agent emits `tasks.yaml` AND a coverage report mapping each brief capability to one or more task IDs.
2. Coverage gaps fail the `/pm` stage (or warn loudly) BEFORE gate 4 sign-off, BEFORE any Mode B agent burns budget building a partial app.
3. Acceptable misses are explicit: a `coverage-deferred:` block in `tasks.yaml` lists capabilities the user agrees to defer (with reason), so silent omissions become impossible.

## Non-goals (deferred)

- Implementation-quality assertion ("the column rename actually works") — that's feat-022's job at Mode B time.
- Brief authoring quality (vague vs. testable capabilities) — out of scope; assumes brief is well-formed per existing `/validate-brief` skill.
- Cross-task dependency analysis (does feature A really depend on feature B?) — different concern.

## Approach

Three-phase: schema + coverage authoring on the PM side, deterministic audit script, orchestrator gate enforcement.

### Phase 1 — Brief capability catalog

Brief sections §11 (User stories) and §12 (Functional requirements) already enumerate capabilities in semi-structured form. Define a small parser convention:

- Each capability gets a stable identifier: `cap-<section>-<slug>` (e.g. `cap-12-column-rename`, `cap-11-help-route`)
- The brief itself doesn't change format; the parser extracts capabilities from the existing bullet/numbered structure
- Output: `docs/brief-capabilities.json` (machine-readable list authored at `/analyze` time, validated at `/validate-brief`)

```json
{
  "version": "1.0",
  "capabilities": [
    {
      "id": "cap-12-column-rename",
      "source": "brief.md#12",
      "summary": "Users can rename a column inline (click title → input → enter to save)",
      "category": "core"
    },
    ...
  ]
}
```

Update `.claude/skills/analyze/SKILL.md` (or wherever section §11/§12 is parsed today) to also emit this companion file.

### Phase 2 — PM-side coverage emission

Update `.claude/agents/project-manager.md` + `.claude/skills/pm/SKILL.md`:

After PM authors `tasks.yaml`, it ALSO emits `docs/tasks-coverage.json`:

```json
{
  "version": "1.0",
  "covers": {
    "cap-12-card-create":      ["task-board-core-card-create"],
    "cap-12-card-edit-inline": ["task-board-core-inline-card-edit"],
    "cap-12-column-rename":    ["task-board-core-column-rename"],   // ← if PM authored it
    ...
  },
  "deferred": [
    {
      "capability": "cap-11-help-route",
      "reason": "MVP scope: brief §11.4 marked optional; user can re-add post-launch",
      "approvedBy": "pm-agent-decision"
    }
  ]
}
```

PM agent prompt extension:

- "Before emitting tasks.yaml, READ docs/brief-capabilities.json"
- "For EACH capability, EITHER assign one or more task IDs that deliver it OR add it to `deferred[]` with a justification"
- "If a capability is core (`category: 'core'`) and you defer it, you MUST emit a `coverage-warning:` field in tasks.yaml so the human sees it at gate-4"

### Phase 3 — Deterministic audit script

`scripts/audit-brief-coverage.mjs`:

```
Inputs:  docs/brief-capabilities.json (authoritative list)
         docs/tasks-coverage.json     (PM's claim)
         docs/tasks.yaml              (the real task graph — sanity-cross-ref)

Algorithm:
  1. Load all 3 files; validate against schemas
  2. For each capability in brief-capabilities.json:
     - If covered by ≥1 task (per tasks-coverage.json + cross-checked it exists in tasks.yaml): pass
     - Else if in deferred[] with reason + approvedBy: warn (visible in gate-4 review)
     - Else: FAIL — capability is silently dropped
  3. For each task ID claimed in tasks-coverage.json: assert it actually exists in tasks.yaml
     (catches PM typos that would let a capability appear "covered" but the task DNE)

Output: BriefCoverageOutput JSON with { ok, uncovered: [], deferred: [], typoErrors: [] }
```

This is a pure script (no LLM). Runs in ~1s. Idempotent.

### Phase 4 — Gate enforcement

Update `orchestrator/src/stage-runner.ts` (or the `/pm` skill's post-step) to:

1. Run `audit-brief-coverage.mjs` immediately after PM emits `tasks.yaml`
2. If `uncovered.length > 0` (silent drops): fail the `/pm` stage with the list. PM must re-emit (with explicit deferral or actual coverage).
3. If `deferred.length > 0` and `category === "core"`: emit a `coverage-warning:` block to the gate-4 sign-off file so the human sees it before approving design + greenlighting Mode B.
4. If `typoErrors.length > 0`: hard fail PM (typos make coverage claims meaningless).

Gate-4 sign-off file (`docs/signoff-{timestamp}.json`) gets a new field:

```json
{
  "screensManifestHash": "...",
  "visualReviewReportHash": "...",
  "uiKitVersion": "...",
  "coverageWarnings": [
    {
      "capability": "cap-11-help-route",
      "category": "optional",
      "reason": "..."
    }
  ]
}
```

User reviews coverageWarnings during gate-4. If they want any of those built, they reject sign-off + ask PM to re-author.

## Validation criteria

- On a fresh kanban-webapp run: `/pm` emits tasks.yaml + tasks-coverage.json + the `audit-brief-coverage.mjs` step runs.
- If we mocked PM forgetting `cap-12-column-rename`, the audit fails the stage with: `UNCOVERED: cap-12-column-rename — brief §12 promises 'users can rename a column inline'. Add a task or add to deferred[] with reason.`
- For `cap-11-help-route` (legitimately optional in brief §11.4), PM lists it in `deferred[]`; gate-4 sign-off file shows the warning; human can accept or push back.
- After feat-023 lands, re-run kanban-webapp end-to-end: tasks.yaml includes column-rename + column-delete tasks; Mode B builds them; feat-022 verifies them.
- 0 false positives on briefs with full coverage.

## Cross-references

- **Parent**: investigate-006 — surfaced the Pattern C gaps that feat-022 cannot catch
- **Sibling**: feat-022 — Mode B verifier; feat-023 prevents the upstream omission, feat-022 catches the downstream wiring failure
- **Touches**: `/analyze` (capability extraction), `/pm` (coverage emission), `/validate-brief` (schema validation)
- **Existing code**: `.claude/skills/analyze/SKILL.md` already parses brief sections; this builds on that
- **Schema pattern**: feat-022's `BuildToSpecVerifyOutput` (deterministic-script wrapper)

## Open questions

These don't block feat-023 but are worth noting:

1. **Capability granularity**: how fine-grained should `cap-*` IDs be? "card editing" vs "card title edit" + "card description edit" + "card priority edit". Suggest: one ID per brief bullet point — coarsening loses signal, finer requires brief reformat.
2. **Already-built projects**: kanban-webapp-09 + others lack `brief-capabilities.json`. Backfill is one-time; can be authored by re-running `/analyze` against the existing brief or by hand for the 4 active test projects.
3. **PM agent compliance**: the prompt change in Phase 2 relies on the PM agent following a new rule. If PM regularly skips it, the audit catches it (script is the enforcement layer; prompt is the cooperation layer).

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->
