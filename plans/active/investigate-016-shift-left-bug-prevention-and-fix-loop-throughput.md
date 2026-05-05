---
id: investigate-016-shift-left-bug-prevention-and-fix-loop-throughput
type: investigation
status: completed
author-agent: claude-opus-4-7
created: 2026-05-05
updated: 2026-05-05
parent-plan: null
supersedes: null
superseded-by: null
branch: null
affected-files: []
feature-area: orchestrator + design-pipeline
priority: P0
attempt-count: 0
max-attempts: 5
time-box-minutes: 60
hypothesis: "The empirical 54-bug surface from finance-track-01's /build-to-spec-verify (45 visual-parity P0/P1 + 9 flow-execution + 1 manifest-author + 4 timeout) burns 4-24h of /fix-bugs wall-clock to resolve. **Most bugs are class-uniform** — 22 screens all needed AppShell wrapping (shell-stripping) — meaning the PRE-build pipeline (PM + stack-skills + per-feature reviewer) had multiple opportunities to enforce the invariant before code shipped. Two pressure points: (a) shift-left detection — catch bugs at builder/reviewer/feature-merge boundaries instead of post-Mode-B verifier, and (b) fix-loop throughput — when bugs DO surface, batch class-uniform fixes (one dispatch fixes 22 screens, not 22 dispatches). Hypothesis: a PM-task-template + stack-skill-mandate + per-feature parity-smoke + class-batched fix-dispatch combination would reduce post-merge bug count by ~80% and reduce remaining-bug fix-time by ~60%."
---

# investigate-016: Shift-left bug prevention + fix-loop throughput

## Question

`finance-track-01`'s 2026-05-05 /build-to-spec-verify run produced **54 bugs in one verifier pass**. Empirical breakdown:

| Class                                    | Count | Pattern                                                                      |
| ---------------------------------------- | ----- | ---------------------------------------------------------------------------- |
| `visual-parity / shell-stripping` (P0)   | 22    | Every screen missing `<AppShell>` wrapper that the mockup specifies          |
| `visual-parity / layout-regrouping` (P1) | 23    | Per-screen JSX structure diverged from mockup DOM                            |
| `flow-execution / build-gap`             | 4     | Build missing element design intends (e.g. flow-3 "Display currency" button) |
| `flow-execution / timeout-no-evidence`   | 4     | Flow timed out, no specific signal                                           |
| `flow-execution / manifest-author`       | 1     | flow-5 targets `[data-kit-component="Table"]` but design uses `DataTable`    |

At `--max-concurrent=5` parallel dispatch, this is **~4-6h of /fix-bugs wall-clock** burning $20-80 in agent dispatches. At C=1 sequential: ~24h.

**The architectural question**: why did the BUILDERS not wrap pages in `<AppShell>`? The mockups CLEARLY show it (every mockup is wrapped). The kit primitive EXISTS (`packages/ui-kit/src/layouts/app-shell/`). 22 different web-frontend-builder dispatches across 22 different feature worktrees independently chose NOT to wrap. That's a **systematic gap** in the pre-build pipeline — not 22 individual builder mistakes.

Two pressure points worth investigating in this 60-min time-box:

### Pressure A — Shift-left detection (catch BEFORE /fix-bugs)

Where in Mode A → Mode B → /build-to-spec-verify could the 22 shell-stripping bugs have been caught EARLIER (cheaper to fix at the source)?

Candidate gates:

1. **PM tasks.yaml authoring** — does PM emit a "wrap in AppShell" requirement on every page-render task?
2. **Stack-skill (react-next/SKILL.md) dispatch context** — does the builder's prompt include AppShell-wrapping as a load-bearing convention?
3. **Per-feature reviewer** — do reviewers walk a "design-conformance" dimension that catches shell-stripping?
4. **Per-feature parity-smoke** — could a narrow parity-verify run as part of each feature's close-feature? Catches at feature granularity, not project-wide.
5. **Builder self-verify** — can the builder static-analyze its output JSX against the mockup's DOM-tree before commit?

### Pressure B — Fix-loop throughput (when bugs DO surface)

When 22 shell-stripping bugs DO reach /fix-bugs, the loop dispatches 22 separate builders. EACH dispatch is ~28min (builder+tester+reviewer). Class-uniform pattern means the fix is ALSO uniform — wrap in `<AppShell>`. Why dispatch 22 times instead of once-with-batched-context?

Candidate optimizations:

6. **Class-batched fix-dispatch** — group `pattern: shell-stripping` bugs into ONE web-frontend-builder dispatch. Builder sees ALL 22 affected pages + applies the same wrapper to all in one pass. Saves 21 × 28min = ~10h wall-clock.
7. **Pattern-keyed cached fix** — when a pattern has been fixed before (cross-project lessons), reuse the fix template. Sister to lessons-agent (feat-015 backlog).
8. **Skip-redundant tester/reviewer** — for class-uniform fixes that pass the FIRST screen's tester, skip tester/reviewer for the OTHER N-1 screens (template-match → trust). Risk: regressions hide; mitigated by post-batch /build-to-spec-verify re-run.
9. **Parallelize per-pattern, sequential merge** — feat-046's per-bug-worktree parallelism is generic. Add pattern-aware grouping: 22 shell-stripping bugs run as ONE compound task across 22 worktrees but with shared dispatch context.

## Hypotheses

### H1 — Shell-stripping pattern dominates because PM tasks don't mandate AppShell wrapping

PM emits per-task summaries from architecture.yaml's feature definitions. If feature `feat-spa-shell-dashboard`'s PM task didn't say "wrap rendered content in `<AppShell>`", the builder authored a stand-alone island. Subsequent feature builders (e.g. `feat-accounts-ui`, `feat-transactions-ui`) followed the same pattern — they were NOT told "the existing pages all need AppShell wrapping" because each feature is dispatched independently with its own PM task as context.

**Falsification test**: read 3 finance-track-01 PM tasks for page-rendering features. Check whether any reference AppShell. If none do → H1 confirmed; PM is the gap.

### H2 — Stack-skill (react-next/SKILL.md) doesn't surface AppShell as a load-bearing primitive

The stack-skill at `.claude/skills/agents/front-end/react-next/SKILL.md` is the dispatch-time prompt every web-frontend-builder reads. If it doesn't explicitly call out AppShell, builders won't know to wrap.

**Falsification test**: grep the react-next SKILL.md for `AppShell` or `layout primitive`. If absent → H2 confirmed; stack-skill is the gap.

### H3 — Reviewer's 7-dimension playbook lacks design-conformance / parity

Reviewer dispatches walk: architecture, security, compliance, maintainability, a11y, performance, brief-delivery. None of these are "compare built render to mockup". Reviewer flags design drift only via subjective brief-delivery interpretation.

**Falsification test**: read reviewer-playbook.md. Confirm absence of explicit "verify built JSX matches mockup DOM-tree shape" check.

### H4 — Per-feature parity-verify is technically tractable + would catch shell-stripping at feature granularity

Currently parity-verify runs ONCE post-merge. Each feature has its own worktree with its own dev-server (post-bug-052 Phase E). Could parity-verify run on JUST the screens THIS feature owns as part of close-feature?

**Falsification test**: audit parity-verify's required inputs. If it can run against a per-feature subset of screens.json + per-feature worktree dev-server → H4 confirmed feasible.

### H5 — Class-batched fix-dispatch is feasible AND high-leverage

22 shell-stripping bugs all want the SAME fix shape. Current loop: 22 dispatches × 28min = ~10h. Batched: 1 dispatch with all 22 in context, web-frontend-builder makes 22 mechanical edits in one pass = ~30-45min.

**Falsification test**: review the bug-plan body for shell-stripping (rich kit-component-tree info) — does a batched dispatch fit in agent context? At 22 × ~50 lines of plan body = ~1100 lines. Plus 22 × ~20 lines of mockup snippets = ~440 lines. ~1500 lines + tools' read overhead. Within Sonnet/Opus context window. Feasible.

### H6 — Lessons-agent feedback loop closes the cross-project pattern (out-of-scope for this investigation but worth flagging)

22 shell-stripping bugs in finance-track-01 today → finance-track-02 (or future projects) might benefit from a "we observed this pattern; next project's PM should mandate AppShell wrapping" lesson. Not a quick fix; multi-month signal.

## Investigation steps (60-min time-box)

### Step 1 — read 3 PM tasks for page-rendering features (10 min)

Read `projects/finance-track-01/docs/tasks.yaml` features for: `feat-spa-shell-dashboard`, `feat-accounts-ui`, `feat-transactions-ui`. Look at:

- Task `summary` field
- Task `notes` field (per investigate-013/bug-035 — notes carry detailed dispatch context)
- Any AppShell / layout / wrapper mention

Falsification target: H1.

### Step 2 — grep react-next SKILL.md for layout primitives (5 min)

`grep -nE "AppShell|layout primitive|wrapper" .claude/skills/agents/front-end/react-next/SKILL.md`

Falsification target: H2.

### Step 3 — read reviewer-playbook.md (5 min)

Confirm 7 dimensions don't include parity / design-conformance.

Falsification target: H3.

### Step 4 — audit parity-verify input contract (15 min)

Read `orchestrator/src/parity-verify.ts:runParityVerify` signature. Inputs: projectDir, devServerUrl, screensCatalog. Outputs: divergences[] + warnings.

Question: can it run against:

- **Subset of screens** (e.g. just the screens THIS feature owns per architecture.yaml.features[].affects_files)?
- **Per-feature worktree's dev-server** (each feature has its own apps/web; post-bug-052 Phase E backend boots in worktree)?

Sketch the per-feature parity-smoke shape:

```
git-agent close-feature → orchestrator runs runParityVerify({
  projectDir: <feature-worktree>,
  devServerUrl: <worktree's auto-booted localhost:3001>,
  screensCatalog: <subset filtered to screens this feature owns>,
})
→ if divergences[] non-empty: dispatch web-frontend-builder retry inside this worktree
→ else: proceed with merge
```

Falsification target: H4.

### Step 5 — sketch class-batched fix-dispatch (15 min)

Read `scripts/file-bug-plan.mjs` body templates for `parity-divergence`. Estimate:

- Token count for 22 shell-stripping plan bodies concatenated
- Token count for 22 mockup HTML snippets concatenated
- Total prompt context for web-frontend-builder dispatched against the batch

If < ~150K tokens: feasible for Sonnet/Opus context.

Sketch the batched-dispatch shape:

```
fix-bugs-loop groups bugs by `pattern` field
→ shell-stripping bugs (22): ONE dispatch with all 22 in context
→ layout-regrouping bugs (23): ONE dispatch with all 23 in context
→ Single per-pattern worktree (NOT per-bug)
→ Per-pattern tester + reviewer
→ Single merge cascade
```

Wall-clock: 4 patterns × ~30min = ~2h vs 54 × ~28min = ~25h sequential or ~5h at C=5.

Falsification target: H5.

### Step 6 — write findings + recommendation (10 min)

Document below.

## Findings

Investigation completed in **~25 min of 60-min time-box**. All 5 hypotheses tested.

### F1 — H1 CONFIRMED: PM tasks silent on AppShell mandate

Read `projects/finance-track-01/docs/tasks.yaml` features for `feat-spa-shell-dashboard`, `feat-accounts-ui`, `feat-transactions-ui`.

Empirical finding — task notes for page-rendering tasks include detailed selector contracts (`flow-9 manifest expects [data-kit-component="Badge"]`), state breakdowns (empty/populated/offline-stale), and behavioral specs (react-query invalidation, optimistic update with rollback). They do NOT mandate `<AppShell>` wrapping.

Worse: `feat-spa-shell-dashboard.spa-shell-static-export` says "Top-level layout includes nav + FX-status indicator". The builder reasonably interpreted this as "put nav in `apps/web/app/layout.tsx`" (the Next.js root layout) and built a CUSTOM nav rather than composing `<AppShell>`. PM's "include nav" SUPERSEDED stack-skill's "wrap in AppShell" because PM is more task-specific.

**Highest-leverage fix**: PM emits AppShell-aware boilerplate on every page-rendering task. ~0.5 dev-day for PM-skill update.

### F2 — H2 FALSIFIED: stack-skill IS explicit + load-bearing

`grep "AppShell"` against `.claude/skills/agents/front-end/react-next/SKILL.md` returns hits at lines 145, 193-200, 547. Lines 195-200 carry the EXPLICIT mandate:

> **Critical: do NOT strip the AppShell wrapper.** When the mockup wraps page content in `<div data-kit-component="AppShell">…</div>`, the React render MUST emit:
>
> ```tsx
> <AppShell sidebar={<Sidebar>…</Sidebar>} header={<TopBar>…</TopBar>}>
>   ...
> </AppShell>
> ```

The stack-skill is doing its job. Builders ARE seeing this — and ignoring it because PM's task notes don't reinforce it. The stack-skill mandate competes with PM's task instruction; PM wins (more task-proximal).

**Conclusion**: don't add MORE to the stack-skill — instead make PM's tasks reference the stack-skill mandate explicitly.

### F3 — H3 CONFIRMED: reviewer playbook lacks design-conformance dimension

`docs/reviewer-playbook.md` enumerates 7 dimensions (architecture, security, compliance, maintainability, a11y, performance, brief-delivery). Zero mention of `parity` / `mockup-render` / `AppShell` / design-conformance. Brief-delivery dimension is subjective interpretation; doesn't programmatically check JSX-vs-mockup shape.

**Fix**: add 8th dimension (`8. Design conformance`) to reviewer-playbook with a checkable contract: "for any new page component under `apps/web/app/**/page.tsx`, confirm the rendered tree wraps in the layout primitive the matching mockup uses". ~0.25 dev-day for playbook update + reviewer agent's prompt regeneration.

### F4 — H4 CONFIRMED FEASIBLE: per-feature parity-smoke is a clean extension

Read `orchestrator/src/parity-verify.ts:39 ParityVerifyContext`:

| Field               | Per-feature usage                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `projectDir`        | Set to feature worktree path (`.claude/worktrees/<feature-id>/`)                             |
| `loadScreenList`    | Inject filter: only screens in `architecture.yaml.features[].affects_files` for this feature |
| `devServerUrl`      | Per-bug-052-Phase-E: feature worktree boots its own dev-server with isolated ports           |
| `autoBootDevServer` | Opt-in true; tester already booted dev-server, parity-smoke reuses it                        |
| `screenUrlMap`      | Inherit from project-level overrides; per-feature subset filter doesn't break this           |

Architectural shape (close-feature handler runs AFTER reviewer approves, BEFORE merge to master):

```
git-agent close-feature →
  if (feature is web-frontend AND has page-rendering tasks) {
    parityResult = await runParityVerify({
      projectDir: featureWorktreePath,
      loadScreenList: filterToFeatureScreens(arch, feature.id),
      autoBootDevServer: true,
    });
    if (parityResult.divergences.length > 0) {
      // Route back to web-frontend-builder retry within this worktree
      return { conflict: false, retryReason: "parity-divergence", divergences };
    }
  }
  proceed with git merge to master
```

Cost: ~30-60s per feature (parity-verify dom-walk + style-audit on the feature's screens). Already have dev-server up from tester; minimal extra wall-clock.

Pre-merge gating means the 22 shell-stripping bugs would have been caught at the FIRST feature build — feature-spa-shell-dashboard's reviewer would reject; web-frontend-builder retries with AppShell wrapping; merge proceeds. The OTHER 21 features then inherit the AppShell pattern naturally (they branched off the corrected master).

**Estimated impact**: ~80% reduction in post-merge bug count if shipped.

### F5 — H5 CONFIRMED: class-batched fix-dispatch is high-leverage + feasible

Sample bug-plan body (`bug-033-parity-account-archive-confirm-shell-stripping.md`): ~60 lines. Mockup snippet (the AppShell wrapping section): ~20 lines.

For 22 shell-stripping bugs: 22 × (60 + 20) = ~1760 lines = ~22K tokens. Plus system prompt (~5K) + tools (~10K) + repo context (~30K) = ~70K total. Comfortably within Sonnet's 200K context and Opus's 200K context.

Architectural shape:

```
fix-bugs-loop groups dispatchableBugs by `pattern` field (when present)
→ for each pattern group of size >= 2:
   ONE per-pattern worktree at .claude/worktrees/pattern-<name>/
   ONE web-frontend-builder dispatch with ALL bugs in the group as context
   ONE tester dispatch (verifies all N screens pass)
   ONE reviewer dispatch
   ONE merge cascade
→ Singletons fall through to existing per-bug-worktree path
```

Wall-clock estimate (54-bug case):

- 22 shell-stripping → 1 dispatch × 30min = 30min
- 23 layout-regrouping → 1 dispatch × 30min = 30min
- 4 build-gap → 4 dispatches × 28min = 112min OR 1 batch dispatch = 30min
- 4 timeout-no-evidence → 4 dispatches × 28min = 112min (no batching — distinct fixes)
- 1 manifest-author → SKIP-DISPATCH

Total: 30 + 30 + 30 + 112 = **~3.5h serialized, ~1.5h with the small parallelism still applying**.

Vs current C=5 parallel: ~5h.
Vs current C=1 sequential: ~25h.

**~2-3× faster than current parallel** AND uses ~70% fewer agent dispatches (cheaper). High leverage.

## Recommendation

**Ship 4 follow-ups, prioritized by impact-per-dev-day:**

### feat-051 (P0, ~0.5 day) — PM AppShell-mandate task template

Update `.claude/skills/pm/SKILL.md` to inject AppShell-aware boilerplate on every web-frontend page-rendering task. PM detects page-rendering tasks via the `agent: web-frontend-builder` + `affects_files` includes `apps/web/app/**/page.tsx`. For each, append to task.notes:

```
LAYOUT MANDATE (per react-next SKILL.md §AppShell wrapping): wrap rendered
content in <AppShell sidebar={<Sidebar>…</Sidebar>} header={<TopBar>…</TopBar>}>
imported from @repo/ui-kit. Mockup at docs/screens/webapp/<screen-id>.html
shows the exact composition.
```

Single source of truth: every PM-emitted page task carries the mandate.

### feat-052 (P0, ~1 day) — Per-feature parity-smoke at close-feature

Extend `git-agent close-feature` to run a narrow parity-verify against the feature's screens before merging. On divergences, route back to web-frontend-builder retry within the worktree. Failures here become reviewer-style retries, not post-merge fix-bugs.

Phases:

- A: parity-verify subset-filter (loadScreenList wrapper that respects architecture.yaml.features[].affects_files)
- B: close-feature handler integration + retry routing
- C: contract update (`CloseFeatureSuccess` gains `parityChecked: boolean` field)
- D: tests + finance-track-02 empirical validation

### feat-053 (P1, ~0.5 day) — Class-batched fix-dispatch

Extend feat-046 fix-bugs-loop with pattern-aware grouping. When `--max-concurrent >= 2` AND >= 2 bugs share a `pattern` field (parity divergences only — flow-execution bugs are heterogenous), dispatch them as a SINGLE batch with all bugs in the agent's context.

Phases:

- A: groupDispatchableBugsByPattern helper
- B: per-pattern dispatch path (parallel where possible)
- C: regression tests using fixtures of 7-shell-stripping pattern
- D: empirical re-run on finance-track-02

### feat-054 (P2, ~0.25 day) — Reviewer playbook 8th dimension

Add `## 8. Design conformance` to `docs/reviewer-playbook.md`:

```
For any new component under `apps/web/app/**/page.tsx`, confirm the
rendered tree wraps in the layout primitive the matching mockup uses
(typically <AppShell>). If the mockup at docs/screens/webapp/<id>.html
contains data-kit-component="AppShell" at its root, the JSX render MUST
import + use the @repo/ui-kit AppShell primitive. Drift here cascades
into 1-2 visual-parity P0 bugs per stripped page; catch at reviewer
to save fix-bugs-loop dispatches downstream.
```

This is a defense-in-depth layer — even if PM forgets to mandate, reviewer catches.

### Combined impact

If all 4 ship pre-finance-track-02:

- **Pre-emptive (feat-051 + feat-052 + feat-054)**: predicted bug count drops from 54 to ~5-10 (only genuinely-new bug classes survive). Reduction ~85%.
- **Throughput (feat-053)**: remaining bugs fix in ~30min batched vs ~3h dispatched. Reduction ~85%.

Combined: a Strategy C project's /fix-bugs phase goes from ~5-25h wall-clock to ~30-60min — within a single five_hour bucket window.

### Re-scope decision

If feat-052 (per-feature parity-smoke) reveals that parity-verify's existing dom-walk DOESN'T support per-feature screen filtering cleanly → escalate to feat-052-investigation for a dedicated audit. Current read suggests it WILL work via `loadScreenList` injection, but empirical validation needed.

If feat-053 (class-batched fix) hits unforeseen merge-conflict patterns when one builder edits 22 files in one go → fall back to per-pattern parallel dispatch (same group, separate worktrees, single shared system prompt).

No additional investigations required. All 4 plans can be filed + scheduled directly off this finding.

## Cross-references

- Sister: `investigate-014` (fix-bugs parallelism) + `investigate-015` (parallelism gaps) + `feat-046` (per-bug worktrees) — Pressure B's PRIOR layer; this investigation explores ABOVE-loop fixes
- Sister: `feat-022-build-to-spec-verification` — the verifier framework that surfaces these bugs; per-feature parity-smoke (H4) extends it
- Parent: `investigate-006-build-to-spec-verification` — option survey for the verifier; Pressure-A ideas reflect lessons from the original survey
- Empirical motivator: 2026-05-05 finance-track-01 /fix-bugs run @ ~4h wall-clock at C=5 (45 of 54 bugs visual-parity); pre-fix-loop catch-rate was 0%
- Lineage: `feat-015-factory-extensions-post-mvp` (lessons-agent — H6's longer-term cure)

## Re-scope decision

If H4 (per-feature parity-smoke) requires invasive parity-verify refactoring → file as `feat-051` follow-up rather than ship in this investigation's scope.

If H5 (class-batched fix) reveals context-window limits → narrow to "group by pattern WITHIN a batch's worktrees, share builder system prompt" instead.

If H1+H2+H3 all confirm — straightforward ship: PM task template + stack-skill update + reviewer playbook 8th dimension. Likely ~2-3 dev-days total. Highest leverage of any path explored.
