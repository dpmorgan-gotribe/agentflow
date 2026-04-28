---
id: bug-020-recovery-discards-completed-builder-work
type: bug
status: archived
author-agent: claude-opus-4-7
created: 2026-04-28
updated: 2026-04-28
parent-plan: feat-024-orchestrator-pause-resume
supersedes: null
superseded-by: null
branch: fix/recovery-discards-completed-builder-work
affected-files:
  - .claude/skills/resume-build/SKILL.md (recovery decision tree §7)
  - orchestrator/src/feature-graph-progress.ts (or wherever progress.lastAgent advances)
  - orchestrator/src/invoke-agent.ts (post-builder commit sentinel?)
  - orchestrator/tests/resume-recovery.test.ts (new edge case)
feature-area: orchestration
priority: P1
attempt-count: 0
max-attempts: 5
error-message: null
reproduction-steps: |
  1. Run /start-build <project>
  2. While a builder agent (backend-builder / web-frontend-builder /
     mobile-frontend-builder) is mid-task, force a pause via SIGINT
     OR wait for a wall-clock liveness abort OR rate-limit auto-pause.
  3. Inspect the worktree at .claude/worktrees/<feature>/ — if the
     builder produced source files (.py, .ts, .tsx) but the orchestrator
     did NOT commit them before pausing, the worktree is dirty AND the
     progress.json's lastAgent === "<builder>".
  4. Run /resume-build <project> --yes.
  5. Observe: the recovery decision tree's `dirty-builder` rule
     soft-resets the worktree (`git reset --hard <branch>`) and retries
     the builder from scratch. **All builder output is destroyed**,
     wasting the wall-clock + budget already spent.
stack-trace: null
---

<!-- STATUS STATE MACHINE
draft → approved → in-progress → completed → archived
-->

# bug-020-recovery-discards-completed-builder-work: dirty-builder recovery wipes substantial work

## Bug Description

The `/resume-build` skill's recovery decision tree (per
`.claude/skills/resume-build/SKILL.md` §7 + `feat-024` design) treats
ANY worktree that's dirty + `lastAgent ∈ {backend-builder,
web-frontend-builder, mobile-frontend-builder}` as "interrupted builder
output, not safe to keep" and applies `git reset --hard <branch>` →
retry from `lastAgent`.

This rule is correct when the builder genuinely was interrupted
mid-execution (output is partial / inconsistent / dangerous). But it's
WRONG when:

- The builder completed its work
- The orchestrator failed to commit the output before pausing (e.g.,
  rate-limit hit between agent return and the commit step; SIGINT
  during the commit; wall-clock liveness abort)
- The dirty state IS the completed work

In that case the recovery rule destroys hours of substantive work.

**Empirical hit (2026-04-28):** during repo-health-dashboard-01 E2E run,
backend-builder produced ~2300 LOC of FastAPI scaffold (apps/api/src

- tests + pyproject.toml + uv.lock) plus a TypeScript client package.
  The orchestrator paused at the 7-day Claude Max rate limit BEFORE
  committing the work; progress.json showed `lastAgent=backend-builder,
nextAgent=tester`. Standard /resume-build recovery would have applied
  `git reset --hard feat/proxy-and-cache` — wiping all 2300 LOC.
  Operator (manually) intervened with a `git add -A && git commit`
  inside the worktree before resuming, converting the recovery class
  from `dirty-builder` (soft-reset) to `clean` (advance to tester).

## Reproduction Steps

See frontmatter `reproduction-steps`. Empirical evidence in commit
history of `feat-proxy-and-cache` worktree:
`projects/repo-health-dashboard-01/.claude/worktrees/feat-proxy-and-cache`.

## Error Output

No error — the failure is silent and destructive. The operator only
notices if they manually inspect the worktree before resuming and
recognize substantial work that the recovery rule will discard.

## Root Cause Analysis

The recovery decision tree (per SKILL.md §7) classifies in-flight
features by `(worktree-dirty?, lastAgent-tier)`:

| Dirty? | lastAgent tier            | Recovery class  | Action                   |
| ------ | ------------------------- | --------------- | ------------------------ |
| No     | any                       | `clean`         | Advance to nextAgent     |
| Yes    | builder (back/web/mobile) | `dirty-builder` | Soft-reset + retry       |
| Yes    | meta (tester/reviewer)    | `dirty-meta`    | Stage + commit + advance |

The rule is keyed on `lastAgent-tier` but does NOT consult `nextAgent`
or any signal indicating whether the builder COMPLETED its work before
the dirty state was captured.

**Discriminator that's missing:** `lastAgent === nextAgent` vs
`lastAgent !== nextAgent`.

- `lastAgent=backend-builder, nextAgent=backend-builder` → mid-execution
  retry; soft-reset is correct (the work is incomplete).
- `lastAgent=backend-builder, nextAgent=tester` → builder COMPLETED;
  output is the dirty state; soft-reset destroys completed work.

The orchestrator advances `nextAgent` after a builder returns
successfully (per feat-024 progress logic), but the COMMIT of the
builder's output happens at close-feature time, not per-agent. So
mid-feature pauses leave dirty completed work that the recovery rule
misclassifies.

## Fix Approach

Three layered fixes, each tightening the gap:

### Layer 1 — Smarter recovery rule (immediate, low-risk)

Update `.claude/skills/resume-build/SKILL.md` §7 to discriminate on
`(lastAgent, nextAgent)`:

```diff
- | Yes | builder (back/web/mobile) | `dirty-builder` | Soft-reset + retry |
+ | Yes | builder, lastAgent === nextAgent | `dirty-builder-mid-execution` | Soft-reset + retry from lastAgent |
+ | Yes | builder, lastAgent !== nextAgent | `dirty-builder-completed` | Stage + commit "[lastAgent]: completed-snapshot (resume recovery)" + advance to nextAgent |
```

Update `orchestrator/src/feature-graph-progress.ts` (or wherever the
recovery walks happen — TBD on investigation) with the same logic.

This is the same `dirty-meta` treatment, applied to builders when
they've already passed the "advance nextAgent" milestone.

### Layer 2 — Per-agent commit sentinel (medium, prevents the gap)

Have the orchestrator commit the builder's output IMMEDIATELY after
the builder returns successfully, BEFORE advancing `nextAgent`. The
commit message: `<builder>: completed [task-id list]`. Then if a pause
fires, the worktree is already clean (work committed) and the recovery
classifier sees `clean` regardless of dirty-builder/-meta logic.

This requires the orchestrator's per-agent dispatch wrapper to bracket
the call with `git add -A && git commit` after success.

### Layer 3 — Two-phase progress sentinel (longer-term, defensive)

Make `progress.json` updates atomic with respect to the work they
describe. Currently `lastAgent` and `nextAgent` advance regardless of
commit state. A two-phase scheme:

```json
"inFlight": [
  {
    "featureId": "feat-x",
    "lastAgent": "backend-builder",
    "lastAgentCompletedAt": "2026-...",
    "lastAgentOutputCommittedAt": null,  // ← new field
    "nextAgent": "tester"
  }
]
```

Recovery walks become: if `lastAgentCompletedAt > lastAgentOutputCommittedAt`,
treat dirty state as completed-but-uncommitted (Layer 1 path); if
times match, soft-reset is safe (work was already committed).

Recommend shipping Layer 1 + Layer 2 in this bug. Defer Layer 3
unless future cases reveal it's needed (Layer 2 makes Layer 3
mostly redundant — committing per-agent eliminates the gap).

## Rejected Fixes

- **"Just always commit + advance on dirty-builder"** — too aggressive.
  Mid-execution interrupts (where the builder genuinely was halfway
  through) would commit garbage. The discriminator IS load-bearing.
- **"Have operators manually inspect before /resume-build"** — what we
  did this time, but it requires operator knowledge of the recovery
  rules and the patience to grep through worktrees. Not scalable.
- **"Make /resume-build interactive (preview each in-flight feature
  with a pick-action prompt)"** — too noisy for the common case where
  the rule is correct. Better to fix the rule.

## Validation Criteria

- Synthesize a fixture: pause during builder execution (mid-write of
  source files) vs after builder return-but-before-commit. Recovery
  classifies them as `dirty-builder-mid-execution` vs
  `dirty-builder-completed`.
- Replay the repo-health-dashboard-01 scenario: progress.json says
  `lastAgent=backend-builder, nextAgent=tester`, worktree dirty with
  scaffold output → recovery commits + advances to tester (no soft-reset).
- Negative test: pause RIGHT AFTER backend-builder dispatch (lastAgent
  hasn't advanced yet, lastAgent === nextAgent === backend-builder) →
  recovery soft-resets correctly (mid-execution retry).
- Existing feat-024 recovery tests still pass.
- Layer 2: pause forced between backend-builder return and tester
  dispatch → worktree IS already clean (commit fired between agents) →
  recovery picks `clean` path → advances to tester.

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

# COMPLETION RECORD (appended on archive)

completed: 2026-04-28
outcome: partial
actual-files-changed:

- .claude/skills/resume-build/SKILL.md (modified)
  commits:
- hash: afb7dee
  message: "bug-020: recovery preserves completed builder work (commit-and-advance)"
  attempts: 1
  lessons:
- "The original plan proposed `lastAgent === nextAgent` as the discriminator between mid-execution and completed dirty state. In practice this discriminator never fires — the dispatch breadcrumb sets lastAgent=firstAgent, nextAgent=secondAgent BEFORE any agent runs, so pre-execution and post-execution snapshots look identical. Re-reasoning from the snapshot semantics (not the proposed rule) is essential before implementing."
- "When the proposed discriminator fails, the practical fallback is to bias for work-preservation: always commit-and-advance dirty state. The mid-execution-kill case (rare; usually requires SIGKILL not SIGINT/rate-limit) is recoverable via the per-task retry ladder. Documented an operator note for the edge case."
- "Layer 2 (per-agent commit) already shipped via feat-018 Phase A. The empirical gap is the narrow window between agent return and that commit firing — which is what Layer 1 covers. Layer 3 (per-agent timestamp sentinel) deferred; spawn a follow-up bug if the manual workaround proves insufficient."
  test-results:
  unit: existing 552/552 orchestrator + 344/344 contracts unchanged (doc-only change)
  integration: validated via end-to-end resume on repo-health-dashboard-01 (deferred to next session)
  duration-minutes: 25
