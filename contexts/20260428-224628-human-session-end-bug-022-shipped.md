---
session-id: "20260428-224628"
timestamp: 2026-04-28T22:46:28Z
agent: human
task-id: null
previous-context: 20260428-033617-human-e2e-paused-rate-limit.md
checkpoint: true
status: final
---

# Context snapshot — human — session-end bug-022 shipped

## Summary

Multi-hour FLOW session that shipped 4 P0/P1 bugs (bug-019, bug-020,
bug-021, bug-022) closing the resume-path correctness gap that the prior
session uncovered, plus a bug-018 followup commit and the
sync-project-schemas operator script. Full orchestrator + contracts
suites at 555 + 344 = 899 tests passing. All 4 bug plans archived.

Re-launched repo-health-dashboard-01 E2E twice — bug-021 hydration worked
correctly both times (tester completed against the existing worktree on
the first launch); bug-022 fix proved itself on the second launch
(pause emerged with reason="claude-max-five-hour-limit" instead of being
masked as "user-request"). Build is currently paused on a Claude Max
5-hour rate-limit bucket that fires regardless of model config — likely
tied to the Claude Code parent session's bucket since the orchestrator
inherits its auth tokens via `claude-max-subscription`.

User logging out now. Resume target: ≥ 2026-04-29T01:20Z (the rate-limit
resetsAt) for option A, OR earlier via auth-provider switch (option B).

## Completed since last snapshot

**Factory commits on `fix/pm-skips-affects-files` (8 new since the
prior session's `870317f` HEAD):**

- `01843da` bug-018 followup — regenerated factory `schemas/feature.schema.json`
  to include `affects_files` (the Zod was correct from commit ffeac54 but
  the JSON Schema regeneration was orphaned).
- `3561240` **bug-021 (P0)** — orchestrator resume-aware checkout. Three
  coordinated changes: (1) `createProgressTracker(seedSnapshot)` hydrates
  inFlight from disk; (2) cli-runner `--resume-feature-graph` reads
  `feature-graph-progress.json` + threads through `ctx.seedProgress`; (3)
  runFeature detects in-flight, skips checkout-feature, advances
  agent_sequence walk to nextAgent. +8 tests. Resume-build SKILL.md §12
  documents the orchestrator-side contract.
- `afb7dee` **bug-020 (P1)** — recovery commit-and-advance for any dirty
  in-flight worktree (replaced the soft-reset rule). Doc-only change to
  resume-build SKILL.md §7. Operator note covers the rare mid-execution
  edge case. Layer 3 timestamp work deferred.
- `f73e5f0` **bug-019 (P1)** — `scripts/sync-project-schemas.mjs` overlays
  factory `schemas/` + `scripts/validate-*.mjs` onto a project. Idempotent
  byte-compare, --dry-run + --all flags. new-project SKILL.md step 5a
  invokes it in BOTH init + refresh modes. pm SKILL.md §0 cross-refs the
  script as the right answer to "field missing from schema".
- `42372d8` plans: archive bug-019/020/021.
- `88c5b32` **bug-022 (P0)** — re-throw PauseSignal from SDK pause-hook
  catches in runLlmAgent. 4 catch sites fixed (3 per-hook + 1 outer
  for-await catch around the message stream). +3 tests. Discovered while
  resuming repo-health-dashboard-01 — bug-021 worked, then revealed
  bug-022 as the next blocker (PauseSignal was being swallowed, masking
  the real pause cause as "user-request").
- `0325d6f` plans: archive bug-022.

**Operator follow-up steps:**

- Ran `node scripts/sync-project-schemas.mjs --all` against all 12
  projects (8 created/updated/unchanged stats per project). Idempotent
  on second run (0/0/20).
- repo-health-dashboard-01: committed the sync as `5993303 chore: sync
schemas + validators from factory (bug-019)` on its
  `fix/screens-tailwind-not-compiled` branch.
- 4 bug plans archived to `plans/archive/`. `plans/active.md` manifest
  updated with new ARCHIVED 2026-04-28 sections.

**E2E launches (repo-health-dashboard-01):**

- Launch 1 (~21:56-22:01Z): bug-021 hydration kicked in. Tester ran
  successfully on Opus 4.7, committed `8002c3d tester: edge-case-tests`.
  Then paused with reason="user-request" — the pre-bug-022 pattern
  where the SDK hook fired but PauseSignal got swallowed.
- Launch 2 (~22:20-22:21Z): bug-022 fix in place. Same rate-limit fired
  but this time paused cleanly with reason="claude-max-five-hour-limit",
  resetsAt: 1777425600 (2026-04-29T01:20Z).
- Launch 3 (~22:30Z, all-Haiku config): SAME pause fired immediately,
  resetsAt unchanged. Confirmed the rate-limit bucket is NOT model-
  specific — likely the Claude Code parent session's bucket inherited
  via `claude-max-subscription` auth.

**Model config:** user changed `~/.claude/models.yaml` defaults to
all-Haiku (`planning: haiku-4-5`, `building: haiku-4-5`,
`quality: haiku-4-5`, `meta: haiku-4-5`, `mechanical: haiku-4-5`).
Did NOT bypass the 5h cap because of the auth-bucket inheritance.

## Current state

- Branch: `fix/pm-skips-affects-files` (`0325d6f`)
- Factory tests: 899/899 passing (orchestrator 555 + contracts 344;
  added 11 tests this session: 8 for bug-021, 3 for bug-022)
- Uncommitted files: only line-ending churn (`detect-loop.mjs`, `cli.ts`)
  - 3 untracked (`contexts/checkpoints.md` will land via this snapshot,
    `scripts/snapshot-project.mjs` is from prior session, the prior
    context file)
- Blockers:
  - **5h rate-limit cap** (resetsAt: 2026-04-29T01:20Z, ~3hr from this
    snapshot) — applies regardless of model config, tied to auth session
  - **`paused.json` is present** at
    `projects/repo-health-dashboard-01/.claude/state/6b5985b4-3543-4db2-8f3e-07d9026e76c8/paused.json`
    with reason="claude-max-five-hour-limit" — must be deleted before
    the next launch attempt
  - **£41 of extra-usage on the user's Anthropic billing** likely
    attributable to this conversation running on `claude-opus-4-7[1m]`
    (the 1M context variant, which is API-billed even on Max
    subscription per our hypothesis — needs verification at
    claude.ai/settings/usage)

## Next steps

When the user comes back:

1. **First — load context.** Run `/load-context-chain` to walk this
   snapshot + verify state. Two prior checkpoint snapshots in the chain.

2. **Decide on resume strategy.** Three options were laid out:
   - **A. Wait until 01:20 UTC** (resetsAt) — clean, free; assumes the
     5h bucket actually resolves. Re-launch then.
   - **B. Switch orchestrator auth to `anthropic-api-key`** — edit
     `~/.claude/models.yaml` top-level `provider: anthropic-api-key`,
     ensure ANTHROPIC_API_KEY env var is set. Per-token API billing
     bypasses ALL Max buckets. Estimated $5-30 to finish all 8 features
     on all-Haiku. NOT YET DONE.
   - **C. End this conversation** (option C from the convo) and start
     fresh in a new Claude Code session — tests the parent-session
     bucket hypothesis. Free. New session inherits no usage history.

3. **Whichever option** — pre-flight before re-dispatching:
   - Confirm `paused.json` is deleted (operator pattern: user runs
     `rm projects/repo-health-dashboard-01/.claude/state/6b5985b4-3543-4db2-8f3e-07d9026e76c8/paused.json`)
   - Verify `feat-proxy-and-cache` worktree HEAD is still
     `8002c3d tester: edge-case-tests` (the tester commit must survive
     for the resume to advance to reviewer cleanly per bug-021)
   - Verify `feature-graph-progress.json` still shows
     `lastAgent=tester, nextAgent=reviewer` (it does as of this snapshot)

4. **Dispatch command** (unchanged from prior launches):

   ```
   pnpm --filter orchestrator start generate repo-health-dashboard-01 \
     --resume-feature-graph \
     --pipeline-run-id 6b5985b4-3543-4db2-8f3e-07d9026e76c8 \
     --auto-merge-after-reviewer
   ```

5. **Watch for** (with bug-022 fix in place, all signals are now
   accurate):
   - Clean reviewer dispatch + auto-commit + close-feature merge
   - Then `feat-web-shell` and `feat-deploy-pipeline` dispatch (both
     direct deps on feat-proxy-and-cache)
   - Topological cascade through remaining 6 features
   - Bug-fix loop fires after all 8 features merge (per feat-026)

## Open questions

- **Is `claude-opus-4-7[1m]` API-billed even on Max subscription?**
  This is the load-bearing question for the £41. Verify at
  claude.ai/settings/usage.
- **Does the SDK's `rate_limit_event` fire against the auth-session
  bucket or against per-model buckets?** Prior assumption was
  per-model; empirical evidence (immediate pause on all-Haiku launch
  with same resetsAt) strongly suggests session-level.
- **Does Layer 3 of bug-020** (per-agent timestamp sentinel for
  fully-automated mid-execution-vs-completed discrimination) need
  shipping? Currently deferred. Spawn a follow-up bug only if the
  manual-inspection workaround proves insufficient in practice.
- **Should the orchestrator print a `Resuming with progress snapshot:
...` line BEFORE the first runFeature dispatch?** Currently the
  hydration runs but its messages get swallowed when PauseSignal
  throws before reaching `console.log(line)` in cli.ts. Minor UX gap.

## Key files touched

**Factory commits (this session):**

- `01843da` schemas/feature.schema.json — bug-018 close-out
- `3561240` orchestrator/src/feature-graph.ts (+ inlined
  `createProgressTracker(seedSnapshot)`, `runFeature` resume detection,
  pre-population of completed/failed/aborted on resume) +
  cli-runner.ts (+ readFeatureGraphProgress + ctx.seedProgress
  threading) + tests
- `afb7dee` .claude/skills/resume-build/SKILL.md §7 — recovery decision
  tree split on `nextAgent`
- `f73e5f0` scripts/sync-project-schemas.mjs (NEW) +
  .claude/skills/new-project/SKILL.md §5a + .claude/skills/pm/SKILL.md
  §0 cross-ref
- `88c5b32` orchestrator/src/invoke-agent.ts (4 catch sites, PauseSignal
  re-throw) + .test.ts (3 new tests) + drive-by typecheck fix to
  bug-021's tests in feature-graph.test.ts

**Project-side commit:**

- `repo-health-dashboard-01:5993303` — schemas + validators sync from
  factory via the new bug-019 script. Landed on
  `fix/screens-tailwind-not-compiled` branch (NOT master).

**Active plans (3):**

- `plans/active/feat-015-factory-extensions-post-mvp.md` (P1, draft)
- `plans/active/feat-016-post-mvp-catalog-promotion.md` (P2, draft)
- `plans/active/feat-021-pm-agent-availability-and-requests.md` (P2,
  draft)

(All 4 bugs filed this session — 019/020/021/022 — archived.)

**Worktree commits (preserved for resume — DO NOT delete worktree):**

- `projects/repo-health-dashboard-01/.claude/worktrees/feat-proxy-and-cache`
  branch `feat/proxy-and-cache` HEAD = `8002c3d tester: edge-case-tests`
  (one commit ahead of `4b5e2ba backend-builder: scaffold-fastapi, ...`)

## Decisions made

**Architectural / process:**

- **bug-021 Layer 1 over Layer 2**: Skip checkout entirely on resume
  (in feature-graph.ts) instead of adding a `reuseExisting` flag to
  invoke-agent.ts. Layer 1 obviates Layer 2; if a future caller ever
  dispatches checkout-feature on an existing worktree outside the
  resume path, the existing `stale-worktree` error remains informative.
- **bug-021 hydration also pre-populates completed/failed/aborted**:
  Without this, the topological loop would re-attempt already-resolved
  features. Subtle gap that wasn't in the original plan; caught on
  re-tracing the resume path.
- **bug-020 Layer 1 only (commit-and-advance for any dirty)**:
  The plan's proposed `lastAgent === nextAgent` discriminator doesn't
  actually work given the dispatch breadcrumb's semantics (lastAgent
  is set BEFORE the agent runs, identical to post-execution state).
  Practical fallback: bias for work-preservation (always commit-advance);
  the rare mid-execution-kill case is recoverable via the per-task retry
  ladder. Layer 3 (timestamp field) deferred — would close the rare
  case but is invasive.
- **bug-022 found a 4th catch site (the outer for-await loop)** beyond
  the 3 listed in the plan. Lesson recorded: trace the FULL throw path,
  don't trust the plan's count. PauseSignal funnels every pause cause
  through one type, so anything catching `Error` generically swallows it.
- **All-Haiku model config** (user-set after the Opus 5h pause): did
  NOT bypass the 5h rate-limit. Empirical evidence that the SDK's
  `rate_limit_event` fires at auth-session level, not per-model level,
  when using `claude-max-subscription`.

**Bug-022's drive-by lesson on testing discipline:**

- bug-021 tests passed `pnpm test` but had typecheck errors (bogus
  TasksV2 fields, readonly literals from `as const`). Lesson: tests
  are code; run `tsc --noEmit` after adding them, not just the
  test runner. Vitest doesn't substitute for typecheck on test files.

**Auth-bucket hypothesis (not yet verified):**

- Claude Code parent session's 5h rolling bucket appears to be the
  shared cap that orchestrator inherits via `claude-max-subscription`.
  This explains: (1) all-Haiku launch immediately pausing with the
  same resetsAt; (2) the £41 in extra-usage likely from this
  conversation's `claude-opus-4-7[1m]` (1M context variant, possibly
  API-billed separately from Max). Verification: claude.ai/settings/usage
  breakdown, or test option C (end conversation, fresh session) to
  see if a fresh session picks up new headroom.

**Workflow rhythm observed:**

- Per-bug commit on a single shared branch (`fix/pm-skips-affects-files`)
  worked well for stacking related factory fixes. Plan/archive cadence
  per CLAUDE.md was followed; bug-022 was filed mid-session as a
  follow-up bug from bug-021's empirical resume.
- Background-launch + Monitor pattern was correct for the orchestrator
  E2E — events fire on key transitions, conversation stays responsive.
  Two false-positive notifications from `tail -F` replaying stale log
  lines on initial start — minor.

**Acknowledged from user — session ending:**

- £41 in Anthropic extra-usage flagged. Most plausible source: this
  conversation's `claude-opus-4-7[1m]` API-billed usage. User will
  verify on the dashboard.
- All-Haiku config didn't bypass the 5h cap. Confirmed via empirical
  re-launch.
- User chose to /save-context + logout rather than wait 3 hours or
  spend more on API key bypass. Resume strategy deferred to next
  session (options A/B/C laid out in §Next steps).
