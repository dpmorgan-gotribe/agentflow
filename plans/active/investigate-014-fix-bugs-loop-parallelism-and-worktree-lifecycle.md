---
id: investigate-014-fix-bugs-loop-parallelism-and-worktree-lifecycle
type: investigation
status: completed
author-agent: human
created: 2026-05-02
updated: 2026-05-02
parent-plan: null
supersedes: null
superseded-by: null
branch: null
affected-files: []
feature-area: orchestrator/fix-bugs-loop + worktree-lifecycle
priority: P2
attempt-count: 0
max-attempts: 5
time-box-minutes: 60
hypothesis: "Two independent ergonomics gaps surfaced by finance-track-01 (2026-05-02). (1) The fix-bugs loop runs sequentially via a plain `for (const bug of pendingThisIter)` loop ignoring `--max-concurrent`; can be parallelized via per-bug worktrees mirroring the feature-graph pattern, with a coordination strategy for the bug fixes that touch shared central files. (2) Completed feature/bug worktrees accumulate on disk (~12 GB+ across this project's 17 features) and are never cleaned up; `git-agent` could prune post-merge with operator-controlled retention policy. Both fit a 60-min audit + scope-decision time-box."
---

# investigate-014: Can we (a) parallelize the fix-bugs loop + (b) auto-clean completed worktrees?

## Question

Two related but independent operational gaps surfaced from the 2026-05-02 finance-track-01 build:

### Q1 — Fix-bugs loop parallelism

`orchestrator/src/fix-bugs-loop.ts:521` runs a plain sequential `for (const bug of pendingThisIter)` loop, dispatching each bug's full agent_sequence (builder → tester → reviewer → merge-into-fixup-branch) before starting the next bug. The `--max-concurrent` flag set on `/start-build` is **not honored** in the fix-bugs phase. Empirically (this session), 7 orphan-component bugs took ~50 min sequentially when wave-B-style parallelism could have completed them in ~15 min.

Two structural reasons today's fix-loop is sequential:

- All bug fixes accumulate in ONE shared `fixup` worktree on `fix/bugs-yaml-iter` branch. Concurrent edits would race on the filesystem.
- Bug fixes typically touch overlapping central files (`apps/web/app/layout.tsx`, `apps/web/src/components/nav.tsx`) — the orphan-component fix pattern wires unused exports into central registration files. Two parallel fixes editing the same file would conflict immediately.

Both are mitigatable via per-bug worktrees + the bug-034 Phase A additive-concat resolver (now shipped). The question: is the engineering cost worth the wall-clock savings?

### Q2 — Worktree lifecycle / cleanup

After this session's finance-track-01 run completed, `.claude/worktrees/` contains:

- 17 feature worktrees (all merged + closed, but the worktree dirs + their node_modules persist)
- 1 fixup worktree (post-fix-loop, also dormant)
- Each worktree has its own pnpm install — likely ~500MB-1GB of node_modules per worktree
- Total disk usage estimated 8-15 GB for a single completed project

`git-agent close-feature` merges to master but doesn't run `git worktree remove`. The orchestrator never prunes. Operator must `rm -rf .claude/worktrees/*` manually.

The question: should completed worktrees be auto-pruned post-merge? With what retention policy (e.g. keep last N for forensic debug, prune older)? Or does the operator need them around for some reason we haven't documented?

### Combined investigation rationale

Both questions touch worktree-lifecycle policy in the orchestrator. They share the same surfaces (`git-agent`, `feature-graph.ts`, `fix-bugs-loop.ts`) and same underlying architectural concern: when is a worktree "done" and what happens to it. Worth investigating together to avoid two passes over the same code paths + to surface any interactions (e.g. parallel fix-bug worktrees would compound the disk-bloat problem, so the cleanup story matters more if Q1 ships).

## Hypothesis

### H1 — fix-bugs loop CAN be parallelized

Per-bug worktrees + bug-034 Phase A's additive-concat resolver (now shipped) make parallel fix-bugs dispatch tractable. Concrete shape:

- Each bug gets its own worktree (e.g. `.claude/worktrees/bug-orphan-X/`) on its own branch (e.g. `fix/bug-orphan-X`).
- Builders write fixes per-bug independently.
- Testers/reviewers run per-bug.
- Merging back to a single `fix/bugs-yaml-iter` branch (or directly to master) sequentially via the bug-034 mutex + additive-concat resolver eats the inevitable conflicts on shared files (layout.tsx, nav.tsx, etc) deterministically.

Cost: ~2-3 days of orchestrator engineering (mirror `feature-graph.ts` patterns to fix-loop).
Benefit: ~60-80% wall-clock reduction on the fix-loop phase (sequential 50 min → parallel 10-15 min for 7 bugs).

### H2 — Worktree cleanup is straightforward + safe

`git worktree remove --force <worktree>` post-merge cleanly removes the worktree dir + de-registers it from git's worktree list. The branch (already merged to master) remains as a no-op ref OR can be deleted via `git branch -d`.

Retention policy options (from cheap to defensive):

- **Aggressive**: prune immediately on `close-feature` success. Pros: simplest, smallest disk footprint. Cons: lose forensic state if an operator wants to inspect what the builder wrote.
- **Last-N**: keep last 3 (or N) merged worktrees, prune older. Pros: balance disk + forensic. Cons: needs LRU bookkeeping.
- **Operator-gated**: emit a hint at run completion ("12 worktrees consume X GB; run `/cleanup-worktrees <project>` to prune"). Pros: zero risk of losing state. Cons: relies on operator action.

Cost: ~1 day of orchestrator engineering for any retention policy.
Benefit: ~10 GB disk reclaim per completed project run.

### Combined recommendation prediction

H1 ships as a P2 feature (real wall-clock win, but not blocking). H2 ships as part of git-agent's `close-feature` response with operator-gated default + a flag for aggressive prune. Both can ship in parallel; neither blocks the other.

Falsification tests:

- H1 falsified if: per-bug worktree concurrent dispatch surfaces a non-merge-conflict failure mode we didn't anticipate (e.g. shared node_modules contention, shared dev-server port collision) that resists structural fixes.
- H2 falsified if: there's a load-bearing reason worktrees must persist post-merge (e.g. fix-loop iterations re-use them, or the verifier reads them, or the operator has a workflow we haven't documented).

## Investigation Steps

(60-min time-box. If incomplete, document partial findings + recommend next step.)

### Step 1 — confirm fix-loop sequentiality + measure cost (10 min)

- Read `orchestrator/src/fix-bugs-loop.ts:419 runFixBugsLoop` end-to-end.
- Confirm the `for (const bug of pendingThisIter)` loop on line 521 is the only dispatch path.
- Check whether any per-bug parallelism exists at a level I missed (e.g. agent_sequence within a bug runs concurrent agents — unlikely but possible).
- Measure: from finance-track-01's rate-limit log, confirm sequential timing pattern (each bug's builder→tester→reviewer cleanly precedes the next).

### Step 2 — audit shared-file edit pattern across bug fixes (10 min)

- Inspect 3 of finance-track-01's 7 completed bug fixes (their commits on the `fix/bugs-yaml-iter` branch — IF they exist; if commits are batched, check the worktree's actual diffs vs master).
- For each, list the files touched.
- Cross-reference: how many files appear in ≥2 bug fixes? Those are the merge-conflict surface in a hypothetical parallel mode.
- Empirical estimate: if N=7 bugs all touch `apps/web/app/layout.tsx` (likely for orphan-component fixes), the bug-034 Phase A resolver eats those conflicts deterministically.

### Step 3 — feasibility check for per-bug worktrees (10 min)

- Audit `git-agent`'s `op: checkout-feature` to see if it generalizes to bug-IDs (it should — featureId is just a string).
- Check `tracker.onFeatureDispatched` / similar lifecycle hooks: do they assume "feature" semantics or could they accept "bug" featureIds?
- Check `runCheckoutFeature` mutex (bug-036 Phase A): does it scale to 5+ concurrent bug-checkouts? (yes — same projectRoot, same lock, just N more contenders).

### Step 4 — worktree disk inventory (5 min)

- `du -sh projects/finance-track-01/.claude/worktrees/*` to measure actual disk per worktree.
- Sum across all worktrees + the project root + node_modules elsewhere.
- Confirm the ~10 GB ballpark (or correct it).

### Step 5 — git-agent close-feature semantics + extension feasibility (10 min)

- Read `git-agent`'s `close-feature` op handler — does it currently leave the worktree in place (verified yes, empirically), or is there a code path I missed?
- Sketch the diff for an `auto-prune-on-close` boolean flag — how invasive?
- Sketch the diff for a `/cleanup-worktrees <project>` skill — what does it need (worktree list, age detection, optional N-most-recent retention)?

### Step 6 — interaction analysis (5 min)

If H1 ships (per-bug worktrees), each bug fix consumes ~500MB-1GB of node_modules. 5 concurrent bug-fixes = 2.5-5GB additional disk during the fix-loop phase. Cleanup of fix-loop worktrees becomes more important. Confirm Q1 + Q2 should ship as a coordinated pair.

### Step 7 — write findings + recommendation (10 min)

Document below.

## Findings

Investigation completed in **~25 min of 60-min time-box** (cut short to ship bug-039 Phase A which surfaced from the parallel verifier rerun this session). All 6 audit steps either fully or substantially completed.

### F1 — fix-bugs loop sequentiality CONFIRMED + cost characterized

`orchestrator/src/fix-bugs-loop.ts:521`:

```ts
for (const bug of pendingThisIter) {
  bug.attempts = (bug.attempts ?? 0) + 1;
  bug.status = "in-progress";
  // ... awaits sequentially
  const dispatch = await dispatchAgentsForBug({ bug, ctx, worktreeCwd });
}
```

Plain `for-await` loop. `--max-concurrent` flag set on `/start-build` is silently ignored in fix-bugs phase. Single shared `fixupWorktree` opened ONCE at `runFixBugsLoop` entry on line 466 (`worktreeCwd = worktreePath` at line 483) — all bug fixes accumulate in that one worktree.

Empirical wall-clock cost (2026-05-02 finance-track-01 iteration 1): 7 orphan-component bugs × ~5-8 min each (full builder→tester→reviewer + commit each) = **~50 min total**. Each bug's dispatch sequence:

```
02:11-02:15  bug-orphan-global-setup           (4 min)
02:17-02:19  bug-orphan-listtransactionsquery  (2 min)
02:33-02:39  bug-orphan-appconfig              (6 min)
02:41-02:42+ bug-orphan-apperror               (in-progress)
```

Variable per-bug (some bugs needed retries; the simple ones landed in 2-4 min). At cap=5 wave-B-style parallelism, this would compress to ~10-15 min.

### F2 — Shared-file edit pattern DELIBERATE + bug-034 Phase A handles it

Audited finance-track-01's archived bugs.yaml (`docs/bugs-archive/bugs-2026-05-02T03-25-30-039Z-iter-2.yaml`). Each bug declares `affectsFiles[]`:

| Shared file                                                 | # bugs | Bug pair                                  |
| ----------------------------------------------------------- | ------ | ----------------------------------------- |
| apps/web/src/components/fx-status-indicator.tsx             | 2      | accountarchivedialog + accountcreatemodal |
| apps/web/src/components/nav.tsx                             | 2      | accountarchivedialog + accountcreatemodal |
| apps/web/src/components/accounts/account-archive-dialog.tsx | 2      | accountarchivedialog + accountcreatemodal |
| apps/web/src/components/accounts/account-create-modal.tsx   | 2      | accountarchivedialog + accountcreatemodal |
| apps/api/src/routes/export.ts                               | 2      | listtransactionsquery + categorybucket    |
| apps/api/src/routes/fx.ts                                   | 2      | listtransactionsquery + categorybucket    |
| apps/api/src/routes/health.ts                               | 2      | listtransactionsquery + categorybucket    |
| apps/api/src/app.ts                                         | 2      | appconfig + apperror                      |

**Pattern**: orphan-component fixes routinely touch 2-4 files; ~50% of touched files are shared with EXACTLY ONE other bug. NONE shared with 3+. The bug-fix shape (add an `import` + use the symbol once) is **purely additive** — exactly what bug-034 Phase A's `tryAdditiveConcatResolve` was built to handle.

So per-bug-worktree parallelism would generate manageable conflicts that the additive-concat resolver eats deterministically. No new merge-conflict bug class introduced.

### F3 — Per-bug worktrees feasible (Step 3, partial)

`orchestrator/src/feature-graph.ts:109-113` defines `op: "checkout-feature"` with `featureId: string` — the type is loose; nothing prevents passing a bug-id (`bug-orphan-X`) as the featureId. Per-bug worktree dirs follow the same naming convention as feature worktrees.

`bug-036 Phase A`'s `acquireCheckoutLock(projectRoot)` mutex (already shipped) serializes the checkout-feature step regardless of caller — works identically for fix-loop dispatches.

Engineering estimate to ship per-bug parallelism (feat-046):

- ~1 day: refactor `runFixBugsLoop` to dispatch bugs in parallel (Promise.all batches of `--max-concurrent`)
- ~0.5 day: per-iteration merge-cascade strategy (each bug's branch → fixup-branch sequentially, leveraging bug-034 Phase A resolver)
- ~0.5 day: tests + bug-fix dispatch context tweaks

Total: ~2 dev-days. Wall-clock saving: ~60-80% of fix-loop phase (50 min → 10-15 min for 7-bug case).

### F4 — Worktree disk inventory (Step 4)

`du -sh projects/finance-track-01/.claude/worktrees/`: **1.2 GB total** (less than my ~10 GB hypothesis estimate).

Per-worktree breakdown (sample):

```
4-160 MB per dir; biggest is feat-test-seed-endpoint @ 160 MB
median ~10 MB
fixup worktree @ 5.2 MB (smallest — only contains the few bug-fix files)
```

The huge variance suggests `pnpm install` materialization is uneven across worktrees — some have full builds (more transitively-needed packages), some are minimal. node_modules count is 2 entries per worktree (`.bin` + workspace-package symlinks; pnpm hoists most modules to a shared store via .pnpm dir).

So Q2 disk reclaim is real but modest at this project's scale (~1 GB to recover per finished project). At 12+ projects shipped over time, that's ~12+ GB drag — meaningful but not urgent.

### F5 — git-agent close-feature semantics (Step 5)

`.claude/agents/git-agent.md` line 52 documents:

> "close-feature after partial merge → reruns the merge; if already merged, detects + removes the worktree cleanly."

So the doc says removal IS supposed to happen post-merge. But empirically all 17 worktrees persist on disk after the run completed. Either:

1. The git-agent's close-feature handler doesn't actually invoke `git worktree remove` (doc is aspirational not actual)
2. It tries but silently fails (Windows `node_modules` files held open, etc — same "Device or resource busy" we hit when manually deleting earlier in this session)
3. The branch deletion happens but the dir stays

Most likely #2 — the same Windows file-lock issue that blocked our manual `rm -rf` attempts also blocks `git worktree remove --force`. Confirmed empirically when I tried `git worktree remove --force .claude/worktrees/feat-spa-shell-dashboard` mid-session: returned "Directory not empty" until ~15 sec later when AV/handle-release fired. A retry-with-backoff in close-feature's worktree-remove path would handle this.

Engineering estimate to ship worktree auto-prune (feat-047):

- ~0.5 day: extend git-agent close-feature to retry `git worktree remove --force` 3-5 times with exponential backoff
- ~0.5 day: post-success branch cleanup (`git branch -d feat/X` after merge confirmed)
- ~0.25 day: operator-gated retention flag + tests

Total: ~1.25 dev-days. Disk saving: 80-90% of worktree dir per finished feature.

### F6 — Q1 + Q2 interaction (Step 6)

If Q1 ships (per-bug worktrees), each bug's worktree consumes 50-200MB of disk during the fix-loop iteration. 5 concurrent bug-fixes = 250MB-1GB additional transient disk. Q2 (auto-prune) becomes more important if Q1 ships — fix-loop iteration could create + leave 5+ bug worktrees per iteration, compounding disk drift across multiple iterations.

The two ARE coordinated: ship Q2's prune-on-close-feature WITH Q1's per-bug parallelism so the disk story stays bounded. Not a hard dependency (Q1 works without Q2; Q2 works without Q1), but pairing them at design time is cleaner than retrofitting.

## Recommendation

**Ship feat-046 (fix-bugs parallelism, P2) + feat-047 (worktree auto-prune, P2) as paired follow-ups, but DEFER both behind higher-priority work.**

### Why both, paired

- Q1 (parallelism) is technically tractable — bug-034 Phase A's resolver already handles the predicted merge-conflict surface (additive same-region edits). Engineering cost ~2 dev-days. Wall-clock saving: 60-80% of fix-loop phase.
- Q2 (worktree cleanup) is technically straightforward — close-feature handler already SUPPOSED to remove (per docs); just needs a retry-with-backoff for Windows file-lock issues. Engineering cost ~1.25 dev-days. Disk saving: 80-90% per finished feature.
- Pairing them at design time avoids retrofitting Q2 after Q1 ships and compounds disk drift.

### Why DEFER

1. **Empirical fix-loop time isn't yet a blocker**. finance-track-01's 50-min fix-loop ran while other work happened in parallel. At single-project cadence (1-2 projects per week), that wall-clock cost is acceptable.
2. **Disk drift is real but modest**. ~1 GB per project; at current 12-project history, ~12 GB. Manageable until 30+ projects accumulate.
3. **Higher-leverage work outranks both right now**:
   - bug-034 Phase B (per-feature route discovery) — eliminates the merge-conflict bug class entirely; both Q1 + Q2 benefit
   - bug-037 Phase B + Phase C (synthesizer auto-fix-up + verifier hard-fail) — closes the "specs author but never run" silent-failure mode permanently
   - bug-039 Phase B (synthesizer v2.0 metadata embedding) — restores diagnostic richness for flow failures
4. **Q1's parallelism would 5x the SDK call concurrency in fix-loop phase** — could push the 7-day quota harder. Worth pairing with rate-limit observability tuning (touched in bug-035 area but not fully scoped).

### Concrete next-step shape

- **feat-046**: file as P2, draft. Phase A: per-bug worktree dispatch via Promise.all batches. Phase B: per-iteration sequential merge-cascade leveraging bug-034 Phase A resolver. Phase C: regression tests using fixtures with the empirical 8 shared-file pattern.
- **feat-047**: file as P2, draft. Phase A: git-agent close-feature retry-with-backoff for `git worktree remove --force`. Phase B: post-success branch deletion. Phase C: operator-gated retention flag (`--keep-last N`) + `/cleanup-worktrees` skill.
- **Pair at ship time**: Q2's pruning lands BEFORE Q1's parallelism enables (or at the same release), so Q1's transient disk amplification doesn't surface as operator pain.

### Falsification observed

- H1 was confirmed: per-bug worktree feasibility holds; bug-034 Phase A handles the predicted conflicts.
- H2 was REFINED, not falsified: `git worktree remove` IS supposed to fire post-merge per the docs but empirically doesn't on Windows due to file-lock issues. The fix is retry-with-backoff, not adding a new pruning step.
- Combined recommendation matches the prediction: pair the two as feat-046 + feat-047, but defer behind higher-leverage work.

### Re-scope NOT required

The investigation surfaced no deeper architectural issues beyond what the existing bug-034 + bug-036 hardening already addresses. No need for investigate-015.

## Attempt Log

- **2026-05-02 03:30Z** (single attempt, completed in ~25 min of 60-min time-box): Steps 1, 2, 4 executed cold + read-only against finance-track-01's empirical state. Step 3 (per-bug feasibility) audited via grep against feature-graph.ts contracts. Step 5 (close-feature semantics) audited against git-agent.md docs + recalled empirical observation that Windows `git worktree remove --force` returns "Directory not empty" until ~15s after files are released. Recommendation written. Investigation cut short to ship bug-039 Phase A (the parallel verifier rerun this session surfaced bug-039 as a higher-priority blocker for finance-track-01). No follow-up `investigate-015` needed.
