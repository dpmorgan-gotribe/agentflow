---
session-id: "20260428-033617"
timestamp: 2026-04-28T03:36:17Z
agent: human
task-id: null
previous-context: null
checkpoint: true
status: final
---

# Context snapshot — human — e2e-paused-rate-limit

## Summary

Cold-start checkpoint. Multi-hour FLOW session that shipped 3 features
(feat-027, feat-028, feat-029) wrapping the verifier suite end-to-end,
fixed 1 bug (bug-018) and spawned 3 follow-up bugs (bug-019, bug-020,
bug-021), and kicked off the first repo-health-dashboard-01 E2E build.
The E2E paused at the 7-day Sonnet 4.6 rate-limit during backend-builder
on `feat-proxy-and-cache`; resume attempt exposed bug-021 (orchestrator
can't reuse existing worktrees on resume). Both pause + resume worktree
gaps are filed; the substantial backend-builder scaffold work is preserved
on the worktree branch as commit `feat/proxy-and-cache` HEAD.

User taking extended break + PC shutdown. Resume target: Mon 2026-05-04
07:00 UTC when Sonnet 4.6 quota resets.

## Completed since last snapshot

(no prior snapshot — full session recap below)

**Verifier suite expansion (commits `9622ad3`, `ce00f41`, `696414f`):**

- feat-027 runtime-error-capture: Playwright runtime listeners (page.on
  console/pageerror/requestfailed) + Next.js overlay probe; primaryCause
  classifier (compile/runtime/network/spec-mismatch); cascade-root bug
  routing FIRST + dependsOnBugId tagging; bugPriorityComparator promotes
  dev-server-compile + runtime-error to top of fix queue.
- feat-028 visual-parity-verifier: ParityVerifyOutput schema (7 patterns:
  shell-stripping / layout-regrouping / token-drift / copy-sizing-drift /
  spacing-token-drift / identity-contract-broken / uncategorized);
  diff-kit-skeleton.mjs + audit-computed-styles.mjs scripts; orchestrator
  chain integration; `data-kit-*` attribute contract documented in
  stylesheet + react-next + svelte-kit SKILLs.
- feat-029 screen-state-fixtures: ScreenFixtureSchema; Pattern A
  auto-derive (parse mockup HTML → store-shape); Pattern B flow-context
  with `@inherit-from`; dev-only `__seedFromUrl` helper documented in
  builder SKILLs; differ extended with `--fixture` routing.
- Closed feat-028 gap: `.claude/skills/parity-verify/SKILL.md` created.
- All 3 plans archived after empirical validation.

**bug-018 (PM affects_files; commits `ffeac54`, `e16b703` + per-project
syncs `4bdf2da` `24eb8ac` `55c2a1a` `388cc93`):**

- Original framing was "PM confabulation" — empirical follow-up showed the
  load-bearing root cause is factory→project schema drift (project
  `feature.schema.json` files were missing the `affects_files` property
  added factory-side by bug-015 Phase 2).
- Fix shipped: pm SKILL.md §0 "Mandatory output fields"; project-manager
  agent self-verify item 7 (≥80% coverage); validate-tasks-yaml.mjs
  Invariant 5 (warn on zero-coverage).
- All 4 pre-builds ran re-PM agents: 100% affects_files coverage achieved
  (52/52 features across book-swap=20, finance=14, kanban=10, repo-health=8).
- Spawned bug-019 for the underlying schema-sync mechanism.

**Pre-build inventory + propagation:**

- All 4 pre-build projects synced to factory state (skills + agents +
  hooks + rules + parity-verify NEW).
- All 4 PMs ran successfully (cumulative spend $0 via claude-max).

**E2E launched against repo-health-dashboard-01:**

- Copied from repo-health-dashboard-pre-build; gate-5 added
  (`defer:GITHUB_TOKEN`); orchestrator dispatched with --resume-feature-graph.
- Mode B started; bug-016 pre-flight snapshot fired correctly; backend-builder
  produced ~2300 LOC scaffold (apps/api FastAPI + tests + uv.lock,
  packages/api-client TS); wall-clock-1500000ms abort fired at 25min;
  task retried; then 7-day rate limit pause (graceful, feat-024 working).
- Resume attempt: scaffold preserved by manual commit in worktree (per
  bug-020 reasoning); paused.json deleted; orchestrator re-dispatched →
  failed on `stale-worktree` (per bug-021).

## Current state

- Branch: `fix/pm-skips-affects-files` (`870317f`)
- Tests: 888/888 passing (factory; contracts 344, orchestrator 544)
- Uncommitted files: factory has line-ending-only churn (CRLF/LF) — no
  real diffs; project repos each have committed bug-018 syncs but still
  hold large untracked design-pipeline trees (those have been there since
  Mode A and aren't blocking anything)
- Blockers: Sonnet 4.6 7-day rate limit (resets Mon 2026-05-04 07:00 UTC);
  bug-021 (resume can't reuse existing worktrees) blocks any E2E resume
  attempt regardless of rate limit

## Next steps

When you come back:

1. **First — load context.** Run `/load-context-chain` to walk this snapshot
   - verify the state matches what's described.
2. **Decide on bug fix order:**
   - bug-021 (P0) — orchestrator checkout-feature reuse path. Required
     before any E2E resume can work. Estimated 1-3 hours of TS work +
     tests. Factory-side, runs on Opus 4.7 (this conversation's bucket),
     does NOT touch Sonnet 4.6 quota.
   - bug-020 (P1) — recovery decision tree commit-not-discard. Smaller
     than bug-021 but stacks naturally with it (both touch the resume
     path). Same model bucket considerations as bug-021.
   - bug-019 (P1) — `/new-project --force` schema-sync mechanism.
     Independent of the resume work. Enables future projects to start
     without the bug-018 schema-drift workaround.
3. **After bug-021 + bug-020 ship**, resume the E2E:
   - Verify Sonnet 4.6 bucket has reset (check `claude.ai/settings/usage`).
   - `/resume-build repo-health-dashboard-01 --yes --ignore-master-drift`
     should now succeed; orchestrator will skip checkout-feature for
     feat-proxy-and-cache, advance to tester.
   - Watch for the new wall-clock liveness aborts (1500000ms / 25 min)
     — backend-builder hit it once; may need bumping for complex scaffolds.
4. **Optional sanity check** before re-dispatching: confirm the new
   `paused.json` (reason: user-request, written 2026-04-28T03:22:38Z) is
   removed before starting.
5. **Long-term cleanup** (no rush): factory branch
   `fix/pm-skips-affects-files` has accumulated 7 commits since the prior
   feat-029 archive — merge to master eventually.

## Open questions

- **Wall-clock 25min liveness cap** — appropriate for backend-builder on a
  scaffold-heavy task? Hit it once on `scaffold-fastapi`. May need a
  per-task or per-tier override (some scaffolds genuinely need >25min).
  Spawn bug-022 if hit again on resume.
- **Race between two orchestrator processes** — the second `/start-build`
  attempt today raced against a still-alive first orchestrator process.
  resume-build SKILL.md's "Operator note" already mentions this; deferred
  to feat-025-or-later. Worth promoting to a real bug if the resume
  ergonomics get cleaned up first.
- **Mockup CRLF/LF normalization** — every git operation prints "warning:
  LF will be replaced by CRLF the next time Git touches it" for many
  files. Cosmetic but verbose; could add `.gitattributes` to settle the
  EOL strategy globally.

## Key files touched

**Factory-side (new commits this session):**

- `9622ad3 feat(027 + 028)` — runtime errors + visual parity verifier
  (38 files, +5203 / -101)
- `1da786f plan(feat-029)` — drafted screen state fixtures
- `8c6b1b5 plan: archive feat-027 + feat-028`
- `ce00f41 feat(029)` — screen state fixtures + parity-verify SKILL gap
  (15 files, +2761)
- `696414f plan: archive feat-029`
- `ffeac54 bug-018: tighten pm SKILL + agent`
- `e16b703 plan: archive bug-018 + spawn bug-019`
- `6d6b63c plan: file bug-020`
- `870317f plan: file bug-021`

**Project-side bug-018 syncs:**

- `book-swap-pre-build:4bdf2da`, `finance-track-pre-build:24eb8ac`,
  `kanban-webapp-pre-build:55c2a1a`, `repo-health-dashboard-pre-build:388cc93`

**Worktree commit (preserves scaffold work — important for resume):**

- `projects/repo-health-dashboard-01/.claude/worktrees/feat-proxy-and-cache`
  branch `feat/proxy-and-cache` HEAD = `backend-builder: scaffold-complete
snapshot (recovery from rate-limit pause)` — DO NOT delete this worktree.

**Active plans (4):**

- `plans/active/feat-015-factory-extensions-post-mvp.md` (P1, draft)
- `plans/active/feat-016-post-mvp-catalog-promotion.md` (P2, draft)
- `plans/active/feat-021-pm-agent-availability-and-requests.md` (P2, draft)
- `plans/active/bug-019-new-project-force-schema-sync.md` (P1, draft)
- `plans/active/bug-020-recovery-discards-completed-builder-work.md` (P1, draft)
- `plans/active/bug-021-checkout-feature-no-worktree-reuse.md` (P0, draft)

## Decisions made

**Architectural / process:**

- **Verifier suite final shape**: `/build-to-spec-verify` chains 5 stages
  (reachability → flow synth → flow exec → runtime errors → visual parity).
  feat-029 fixtures bridge built-vs-designed apples-to-apples comparison.
  Why: each stage catches a different bug class; chaining gives one
  pass/fail outcome with structured per-stage attribution.
- **bug-018 framing correction**: original "PM confabulation" framing
  was wrong; load-bearing cause is schema drift. Why: empirical evidence
  (4 PM agents, 2 honored stale schema correctly + 2 silently mutated it)
  inverted the original hypothesis. Worth recording so future
  "agent-quality" bugs get the same empirical scrutiny before assuming
  PM did wrong.
- **Per-project commits over factory-only commits**: bug-018 syncs landed
  as 4 separate per-project commits (one per pre-build's master/feature
  branch). Why: each project is its own git repo; cross-repo atomic
  commits aren't a thing; per-project commits keep blame readable.
- **Manual commit in worktree before resume**: per bug-020, the standard
  `dirty-builder` recovery would discard substantial work. Workaround:
  commit manually, then resume reads the worktree as `clean`. Not
  scalable but correct for this case; bug-020's fix makes this automatic.

**Rate limits + model availability (CRITICAL for resume planning):**

Claude Max subscription has **per-model 7-day buckets** that are tracked
INDEPENDENTLY from the "All models 26%" aggregate shown at
claude.ai/settings/usage:

| Model bucket          | Status (2026-04-28 ~03:30 UTC)                    | Used by                                                                                                                                                                  |
| --------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `claude-opus-4-7[1m]` | OK                                                | THIS conversation (Claude Code session)                                                                                                                                  |
| `claude-opus-4-7`     | OK                                                | orchestrator's `analyst`, `architect`, `project-manager` (planning + meta tiers)                                                                                         |
| `claude-sonnet-4-6`   | **AT 100% CAP** (resets Mon 2026-05-04 07:00 UTC) | orchestrator's `backend-builder`, `web-frontend-builder`, `mobile-frontend-builder`, `ui-designer`, `tester`, `reviewer`, `security-reviewer` (building + quality tiers) |
| `claude-haiku-4-5`    | OK                                                | orchestrator's mechanical-tier work (`html-verifier`, etc.)                                                                                                              |

**Implications:**

- This conversation can continue indefinitely (Opus bucket has room) —
  use it for factory-side TypeScript fixes (bug-019/020/021).
- Any orchestrator dispatch on Sonnet 4.6 will re-pause IMMEDIATELY
  until Mon 7am UTC. That's most of the agent_sequence.
- Workaround if you need to push the E2E TODAY: edit `~/.claude/models.yaml`
  to remap Sonnet-tier agents to Haiku 4.5 (faster, cheaper, lower quality)
  OR Opus 4.7 (better quality, burns Opus quota). Both bypass the Sonnet
  bucket. Have NOT done this — recommend waiting for clean reset.
- Auth provider switch (`provider: anthropic-api-key` in models.yaml)
  bypasses subscription quotas entirely; per-token API spend instead.
  Estimated $10-30 to finish the repo-health-dashboard-01 E2E remaining
  features. Have NOT done this.

**Workflow rhythm observed:**

- Background agent dispatch + tee-to-log was the right pattern for the
  PM + implementation work. Cost: $0 via claude-max for this session.
- /pm dispatch needs FIRM prompts (per bug-018 lesson) — vague "do your
  best" language licenses agents to skip required fields.
- Per-project schema sync at PM time worked correctly after bug-018 fix
  shipped — both re-PM agents detected drift, resynced, emitted
  documenting warnings. This is the SKILL.md §0 prescribed behavior.

**Acknowledged from user — extended break.** PC shutdown. Resume planning:

1. Mon 2026-05-04 morning UTC: Sonnet 4.6 quota resets. Earliest E2E
   can resume.
2. Before resume: ship bug-021 (P0) so resume actually works. Optionally
   ship bug-020 (P1) at the same time. Both are factory TS work that
   uses Opus 4.7 (this conversation's model), not Sonnet.
3. The `feat/proxy-and-cache` worktree branch holds the backend-builder
   scaffold output committed as `backend-builder: scaffold-complete
snapshot (recovery from rate-limit pause)`. **This must be preserved
   when resuming** — DO NOT delete the worktree directory.
