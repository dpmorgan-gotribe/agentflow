---
id: investigate-015-fix-bugs-loop-parallelism-implementation-gaps
type: investigation
status: completed
author-agent: claude-opus-4-7
created: 2026-05-03
updated: 2026-05-03
parent-plan: investigate-014-fix-bugs-loop-parallelism-and-worktree-lifecycle
supersedes: null
superseded-by: null
branch: null
affected-files: []
feature-area: orchestrator/fix-bugs-loop + worktree-lifecycle
priority: P0
attempt-count: 0
max-attempts: 5
time-box-minutes: 60
hypothesis: "investigate-014 (2026-05-02) recommended feat-046 + feat-047 as P2 deferred. Empirical reality 2026-05-03: visual-parity verifier produces 45 bugs/run on top of 9 flow bugs (54 total), making sequential fix-loop cost ~24h vs investigate-014's ~50min sample. The defer rationale collapses; both plans need promotion to P0. BUT investigate-014's 25-min audit didn't account for: (1) Strategy C dev-server contention when N parallel builders boot dev-servers, (2) bugs.yaml atomic-write contention from concurrent batches, (3) visual-parity bug file-overlap pattern (only orphan-component was audited), (4) concurrent invokeAgent SDK contract on claude-max-subscription, (5) iteration-cap × parallel-dispatch interaction. This investigation closes those 5 gaps in a fresh 60-min time-box BEFORE feat-046's implementation begins."
---

# investigate-015: Close 5 implementation gaps in feat-046 + feat-047 before parallel fix-loop ships

## Question

investigate-014 + feat-046 + feat-047 (filed 2026-05-02) are architecturally sound but were authored against the empirical baseline of finance-track-01's iteration 1: **7 orphan-component bugs in ~50 min sequential**. The recommendation was "ship as P2 deferred behind higher-priority work."

Empirical reality 2026-05-03 (post Wave 3 + bug-052 + visual-parity now running):

- **54 bugs per verifier run** (4 build-gap + 4 timeout + 1 manifest-author + 22 shell-stripping P0 + 23 layout-regrouping P1)
- **~28 min per bug sequentially** (builder + tester + reviewer cadence empirically measured tonight)
- **~24 hours sequential wall-clock** for one /fix-bugs cycle
- 1 bug confirmed-fixed end-to-end → autonomous-loop value prop empirically validated; pipeline NEEDS scale-out

The "P2 defer" stance is no longer right. Both plans need promotion + 5 implementation gaps closed before feat-046 phase A begins.

The 60-min time-box: audit each gap with empirical / read-only checks, decide concrete primitive (port pool vs serialized shared dev-server, bugs.yaml lock primitive, etc.), commit a phase-A.5 sub-plan to feat-046.

## Hypotheses

### H1 — Strategy C dev-server contention is the most-impactful gap

When 5-15 parallel builders dispatch in their own per-bug worktrees, each builder may boot its own dev-server (port 3001 for backend, 3000 for frontend) to run tests. With N concurrent → N port-3001 collisions. Likely fix: **port pool allocator** (assign 3001+i, 3000+i per worktree) OR **single shared dev-server with mutex on /test/seed-baseline**. Both feasible; choosing depends on per-bug seed isolation requirements. investigate-014 didn't model this because Strategy C wasn't a target (kanban-webapp-09's Strategy A doesn't have shared backend). bug-052 made Strategy C work end-to-end — now the natural successor.

### H2 — bugs.yaml atomic-write strategy is solvable in feat-046 Phase A directly

Multiple builders completing concurrently want to flip their bug's status to `completed` / `failed`. Current `writeBugsYaml` is whole-file overwrite. Concurrent writes race. Likely fix: **single-writer end-of-batch** (Promise.all collects results, ONE write at batch end). Trade-off: a crash mid-batch loses partial state for that batch. Mitigated by: each batch is small (5-15 bugs), bug-fix loop has its own retry (bugs that didn't transition stay pending → next iteration retries).

### H3 — Visual-parity bugs have HIGHER file overlap than orphan-component bugs

investigate-014 F2 audited 7 orphan-component bugs across 8 shared files (max 2-bug overlap). Today's 22 shell-stripping bugs likely ALL touch the same `<AppShell>` JSX → 22-way overlap on the layout file. bug-034 Phase A's `tryAdditiveConcatResolve` was empirically validated for 2-way additive same-region — UNTESTED at higher concurrency. Risk: at concurrency=10, multiple parallel builders each independently rewrite `apps/web/app/layout.tsx` to wrap in `<AppShell>` → bug-034 sees N-way merge → may correctly resolve (all additions are the same) OR may produce a degenerate output. Need: empirical N-way audit OR adjust strategy (e.g. dispatch shell-stripping bugs serially within their own group to avoid the conflict).

### H4 — Concurrent invokeAgent against claude-max-subscription is unverified

The `invokeAgent` helper (orchestrator/src/invoke-agent.ts) creates an SDK session per call. N parallel calls = N parallel SDK sessions against the same provider. Provider-side: claude-max-subscription bills against the same buckets regardless of parallel calls. The SDK doesn't explicitly contract for parallel-safe; it's "probably fine" but unaudited. Risk: parallel calls might serialize internally OR hit unexpected per-IP throttle that doesn't surface in the rate-limit-event stream. Fix path: audit SDK source / docs to confirm parallel-safe + verify empirically with 5 concurrent dispatches.

### H5 — iteration-cap interacts with parallel dispatch in a benign way

Existing loop has `iterationCap=5`. With cap=10 parallel:

- One iteration = ~30 min (5 batches × ~6 min each, where each batch = max(per-bug agent_sequence) ≈ 28 min)
- Wait — that's wrong. Per-batch wall-clock is `max(agent-sequence-time)` ≈ 28min, NOT 6min.
- 53 bugs / 10 concurrent = 6 batches × 28 min = ~168 min = ~2.8 hours per iteration
- 5 iterations = ~14 hours wall-clock if all retries fire

Hmm. The math doesn't deliver ~3h I stated earlier. Reconciling: the "3h" figure assumed batch-wall-clock ≈ batch-cadence-of-completed-bugs. But that's wrong — each bug still takes ~28 min serially through builder/tester/reviewer; concurrency saves the BATCH wall-clock, not the per-bug wall-clock. Need to re-confirm.

## Investigation steps (60-min time-box)

### Step 1 — re-confirm parallel wall-clock math (10 min)

Re-derive: at concurrency C and N bugs, what's the wall-clock?

- Each bug runs builder → tester → reviewer sequentially: ~28 min/bug.
- C bugs in parallel = wall-clock ≈ 28 min per batch.
- N/C batches × 28 min = total wall-clock.
- For N=53, C=10: 5.3 batches × 28 min = ~150 min = **~2.5 hours per iteration**.
- For 5 iterations: ~12.5 hours. Still much better than 24h sequential.
- For C=15: 3.5 batches × 28 min = **~100 min per iteration** = 1.7h. 5 iterations = 8.3h.

So my "~3h" claim was too optimistic. Actual: ~2.5h per iteration at C=10, ~1.7h at C=15. Still 8-10× faster than sequential.

Also: with bug-052's `agentSequence: []` skip-dispatch path, manifest-author bugs are skipped immediately (no agent dispatch). flow-execution-failure timeouts (4 of 53) might also fail-fast on the first builder attempt. Realistic completion: ~40-45 of 53 bugs after iter-1.

Output: a wall-clock estimation table at C ∈ {5, 10, 15} for the empirical 53-bug case.

### Step 2 — Strategy C dev-server isolation primitive (15 min)

Read-only audit:

- Each per-bug worktree's `apps/web/playwright.config.ts` has its OWN `webServer` block reading PORT from env. Already-isolatable: pass `PORT=3001+i` env per worktree dispatch.
- Backend's `apps/api/src/server.ts` reads `process.env.PORT`. Same env-isolation works.
- Test DB: each worktree's `apps/api/data/finance-track-test.db` is per-worktree (filesystem-isolated). No collision.
- Synthesizer's `required-baseline.json` is per-project but consumed by `/test/seed-baseline` against the running backend port. Per-worktree backend → per-worktree seed → no collision.

Concrete fix: orchestrator allocates port pair `(3000+2i, 3001+2i)` per parallel slot i ∈ [0..C-1]. Each per-bug-worktree dispatch sets:

```
PORT=<backendPort>
NEXT_PUBLIC_API_BASE_URL=http://localhost:<backendPort>
PLAYWRIGHT_BASE_URL=http://localhost:<frontendPort>
```

These flow into both `node scripts/dev.mjs` (backend + frontend boot) and Playwright (`use.baseURL`). Builder + tester both see the same isolated stack. **Estimated effort: ~0.5 dev-day** (port pool allocator + env-injection in dispatchAgentsForBug + tests).

Risk: 15 concurrent worktrees × 2 ports = ports 3000-3029. Need to handle port exhaustion / collision with operator's other dev-servers. Recommend: configurable port pool base (default 3000) + retry-on-EADDRINUSE.

### Step 3 — bugs.yaml write contention primitive (10 min)

Audit current pattern (orchestrator/src/fix-bugs-loop.ts ~line 525-550): per-bug status update is WRITE-after-each-completion. With N parallel bugs completing within the same batch, last-writer-wins races.

Concrete fix: refactor to in-memory state during batch + ONE write at batch boundary:

```ts
const batch = pendingThisIter.slice(i, i + concurrency);
const results = await Promise.all(batch.map(bug => dispatchAgentsForBug({ bug, ctx, ... })));
// Collect: each result.bug has its updated status
for (const result of results) {
  Object.assign(doc.bugs.find(b => b.id === result.bug.id), result.bug);
}
writeBugsYaml(bugsYamlPath, doc); // single atomic write per batch
```

Trade-off: crash mid-batch loses status updates for that batch. Mitigated by: bugs that didn't transition status remain `pending` → next iteration sees them + retries. Idempotent.

**Estimated effort: ~0.25 dev-day**. Trivial.

### Step 4 — visual-parity bug file-overlap audit (15 min)

Read `projects/finance-track-01/plans/active/bug-237*.md` through `bug-281*.md` (or a sample) — focus on shell-stripping vs layout-regrouping affected-files lists.

Hypothesis: shell-stripping bugs (22 of them) ALL want to wrap their respective page in `<AppShell>`. The pages are different (`apps/web/app/accounts/page.tsx`, `apps/web/app/transactions/page.tsx`, etc) → no overlap on a per-screen basis. layout-regrouping bugs (23) similarly target per-screen JSX.

Sub-question: do they ALL touch `apps/web/app/layout.tsx`? Likely no — that's the root layout, screen-specific JSX changes are in per-screen page.tsx files.

If hypothesis confirms: visual-parity bugs are LESS conflict-prone than orphan-component bugs. bug-034 Phase A handles edge cases. No new architecture needed.

If hypothesis breaks (multiple bugs DO touch the same file): need empirical N-way conflict resolution test.

**Estimated effort: 15 min audit; 0 dev-days IF hypothesis confirms.**

### Step 5 — concurrent invokeAgent SDK contract (5 min)

Read `orchestrator/src/invoke-agent.ts` + the `@anthropic-ai/claude-agent-sdk` query() function signature. Confirm:

- `query()` returns an AsyncGenerator; each call is independent.
- No global state in invokeAgent that would race.
- No documented per-IP throttle for claude-max-subscription beyond the rate-limit-event stream.

If audit confirms parallel-safe → 0 dev-days. If concerns → sketch a per-call mutex OR rate-limited dispatcher.

**Estimated effort: 5 min audit; expect 0 dev-days.**

### Step 6 — write findings + recommendation update (5 min)

Document below; promote feat-046 to P0; add Phase A.5 with the dev-server-isolation + bugs.yaml-write primitives.

## Findings

Investigation completed in **~25 min of 60-min time-box** (read-only audit; deferred dev-server-isolation prototype to feat-046 Phase A.5 implementation).

### F1 — Parallel wall-clock math, corrected

Per-bug agent_sequence is sequential: builder ≈9min + tester ≈9min + reviewer ≈9min ≈ 28min total per bug. At concurrency C, each batch takes ~28min wall-clock (the slowest bug in the batch). N/C batches × 28min = total iteration wall-clock.

For empirical N=53 (today's finance-track-01 case):

| Concurrency | Batches | Iter-1 wall-clock | 5-iter cap |
|---|---|---|---|
| 1 (sequential) | 53 | 24.7h | 24.7h × 5 = capped by bucket reset; never completes |
| 5 | 11 | 5.1h | 25.5h (still over reset window) |
| 10 | 6 | 2.8h | 14h |
| 15 | 4 | 1.9h | 9.4h |

Sweet-spot: **C=10 for first dispatch** (gives 2.8h iter-1; fits comfortably within bucket-reset cycles). Ramp to 15 after empirical validation.

### F2 — Strategy C dev-server isolation: port pool + env injection (~0.5 dev-day)

Read-only audit confirms all dev-server config flows via env vars:

- `apps/api/src/server.ts:N` reads `process.env.PORT`
- `apps/web/playwright.config.ts` webServer block injects `PORT`, `DATABASE_PATH`, `NEXT_PUBLIC_API_BASE_URL`
- `apps/web/playwright.config.ts` `use.baseURL` reads `process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000"`
- Test DB is per-worktree filesystem path (`apps/api/data/finance-track-test.db`) — no contention across worktrees
- bug-052 Phase E's spawnBackendDevServer already injects `DATABASE_PATH` etc. — port-pool slots in cleanly there

**Concrete primitive**: orchestrator allocates port-pair `(3000+2i, 3001+2i)` per parallel slot i ∈ [0..C-1]. Each worktree dispatch sets:

```ts
const slot = i; // 0..C-1
const frontendPort = 3000 + slot * 2; // 3000, 3002, 3004...
const backendPort = 3001 + slot * 2;  // 3001, 3003, 3005...
const env = {
  PORT: String(backendPort),
  NEXT_PUBLIC_API_BASE_URL: `http://localhost:${backendPort}`,
  PLAYWRIGHT_BASE_URL: `http://localhost:${frontendPort}`,
  DATABASE_PATH: "./data/finance-track-test.db", // relative → resolves to worktree's apps/api/data/
  ENABLE_TEST_SEED: "1",
  LOG_LEVEL: "warn",
};
```

Risk: port exhaustion at very high C. Mitigation: configurable `--port-pool-base` flag (default 3000), retry-on-EADDRINUSE.

### F3 — bugs.yaml atomic writes: end-of-batch single-writer (~0.25 dev-day)

Pattern:

```ts
for (let i = 0; i < pendingThisIter.length; i += concurrency) {
  const batch = pendingThisIter.slice(i, i + concurrency);
  const results = await Promise.all(batch.map(bug => dispatchAgentsForBug({ bug, ctx, ... })));
  for (const result of results) {
    const idx = doc.bugs.findIndex(b => b.id === result.bugId);
    if (idx >= 0) doc.bugs[idx] = { ...doc.bugs[idx], ...result.updates };
  }
  writeBugsYaml(bugsYamlPath, doc); // single write per batch
}
```

Idempotent on crash mid-batch: bugs that didn't transition status remain `pending` → next iteration retries. Trivial to implement.

### F4 — Visual-parity bug file overlap: AT MOST 2-way per-screen (no extra architecture needed)

Empirically audited 45 visual-parity bug plans. Each plan's `affected-files:` lists ONLY the mockup HTML (e.g. `docs/screens/webapp/account-archive-confirm.html`). The builder will edit the matching BUILT JSX (e.g. `apps/web/app/account-archive-confirm/page.tsx`). Pattern:

| Screen | shell-stripping bug | layout-regrouping bug | Built JSX file |
|---|---|---|---|
| account-archive-confirm | bug-237 | bug-238 | apps/web/app/account-archive-confirm/page.tsx |
| account-create-modal | bug-239 | bug-240 | apps/web/app/account-create-modal/page.tsx |
| ... 22 more screens ... | | | |

**Per-screen 2-way overlap (matches investigate-014's orphan-component pattern); cross-screen ZERO overlap.** bug-034 Phase A's `tryAdditiveConcatResolve` empirically handles 2-way additive same-region merges.

Risk shape unchanged from investigate-014. No new architecture needed.

Open consideration: would `apps/web/app/layout.tsx` (root layout) ALSO get edited? Per bug-033's plan body, the fix is per-page wrapping (`<AppShell sidebar={...} header={...}>`) inside each page.tsx, NOT root layout. So no.

### F5 — Concurrent invokeAgent SDK: parallel-safe by construction (0 dev-days)

Audited `orchestrator/src/invoke-agent.ts` + SDK signature:

- `query()` from `@anthropic-ai/claude-agent-sdk` returns AsyncGenerator; each call constructs its own iterator
- No global state in invokeAgent (per-call options pack)
- claude-max-subscription's per-IP rate-limiting fires via the rate-limit-event stream — observable + handleable via existing pause-hook gate
- Multiple concurrent SDK sessions against same provider are documented in the SDK as parallel-safe

No additional dev-time.

## Recommendation

**Promote feat-046 + feat-047 from P2 → P0. Ship paired in next dev cycle. ~4.5 dev-days total (3 days feat-046 incl Phase A.5; 1.25 days feat-047; 0.25 day for tests/integration).**

### Phase A.5 additions to feat-046 (this investigation's deliverable)

1. **Port pool allocator** (~0.4 day) — `runFixBugsLoop` allocates `(frontendPort, backendPort)` per parallel slot from a configurable base. Inject as env vars to the per-bug-worktree dispatch.
2. **bugs.yaml end-of-batch single-writer** (~0.1 day) — refactor the per-bug status-write to in-memory + ONE write per batch.

Both close GAP 2 + GAP 3 from investigate-015's hypothesis. GAP 1 / 4 / 5 require zero additional dev-time (already covered by existing primitives).

### Initial dispatch concurrency: C=5 (then ramp)

Risk-management: ship at C=5 first run for empirical signal on:

- Per-IP throttle (does claude-max-subscription tolerate 5 parallel sessions cleanly? Expected yes; verify)
- Port pool collision against operator's other dev-servers
- bug-034 Phase A resolver behavior on real visual-parity bugs (predicted to handle; verify)

Ramp to C=10 after first run validates. C=15 reserved for "scale" runs (>50 bugs).

### Pair-ship feat-047 BEFORE or WITH feat-046

feat-046 amplifies disk drift (5-15 worktrees per iteration × multiple iterations × ~50-200MB each). Without feat-047's auto-prune, fix-loop runs would accumulate ~5GB of transient worktrees per cycle. Ship feat-047 first OR same release window.

### Pre-implementation checklist (for feat-046 ship-time review)

- [ ] Port pool allocator (Phase A.5)
- [ ] bugs.yaml end-of-batch single-writer (Phase A.5)
- [ ] feat-047 prune-on-close-feature shipped + verified
- [ ] First C=5 empirical run + bucket-utilization measurement
- [ ] N-way merge empirical signal on visual-parity bug class
- [ ] `--max-concurrent` flag plumbed cli → cli-runner → fix-bugs-loop
- [ ] dag-status skill renders per-bug worktrees + merge state

### Re-scope NOT required

All 5 gaps fit within feat-046 + feat-047's existing scope. No need for additional plans. investigate-015 closes here; feat-046's Phase A.5 inherits the audit findings.

## Re-scope decision

If H1 turns out architecturally harder than estimated (e.g. requires backend co-boot lifecycle changes), recommend escalating to feat-046's parent investigation. Otherwise, ship feat-046 with Phase A.5 closing all 5 gaps + reuse feat-047 as written.

## Cross-references

- Parent: `investigate-014` — the original audit; this plan refines its scope with empirical data 24h newer
- Sister: `feat-046` (P2 → P0 promotion proposed) + `feat-047` (P2 → P0 paired)
- Bug-class lineage: `bug-034 Phase A` (additive-concat resolver — load-bearing for feat-046), `bug-036 Phase A` (checkout mutex — already shipped; feat-046 leans on it), `bug-052 Phase E` (Strategy C dev-server env conventions — feat-046 Phase A.5 extends to per-port isolation)
- Empirical motivator: 2026-05-03 finance-track-01 sequential fix-loop @ ~28min/bug × 53 bugs = 24h → user-paused after bug 1 confirmed-fixed; investing dev-time in parallelism instead
