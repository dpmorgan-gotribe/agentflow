---
id: task-036-hitl-gates-server
type: feature
status: completed
approved-at: 2026-04-23
approved-by: human
completed-at: 2026-04-23
author-agent: human
created: 2026-04-23
updated: 2026-04-23
parent-plan: investigate-002-build-tier-readiness-gap
supersedes: null
superseded-by: null
branch: feat/task-036-hitl-gates
affected-files:
  - orchestrator/src/gate-server-lifecycle.ts
  - orchestrator/src/pipeline.ts
  - orchestrator/src/feature-graph.ts
  - orchestrator/tests/gate-server-lifecycle.test.ts
  - packages/orchestrator-contracts/src/gates.ts
  - packages/orchestrator-contracts/tests/gates.test.ts
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
---

# task-036-hitl-gates-server: replace gate-server stub with real file-drop watchers + add gate 6

## Problem Statement

Task-035 Phase 9 shipped `orchestrator/src/gate-server-lifecycle.ts` as a **stub** that logs "task-036 HTTP server not yet shipped" and returns immediately — the orchestrator's `waitForGate` fn auto-approves every gate. That's fine for dry-runs; it's not fine for live runs where gates are load-bearing for autonomy.

For the first live Mode B run on hatch, two gates are actually load-bearing:

- **Gate 5 (credentials)** — fires after `/architect` writes `.env.example`; user fills in `.env` manually + drops `docs/credentials-confirmed.txt` with `proceed` / `defer:A,B` / `abort`. Builders can't run without this.
- **Gate 6 (PR review before merge)** — NEW per investigate-002 answer #1. Fires after reviewer approves a feature. git-agent creates a PR (via `gh pr create` or equivalent); file-watches `docs/gate-6-approved-{featureId}.txt`. On approved: git-agent merges to main. On reject: PR stays open for manual handling. Default opt-in for first 5 autonomous runs.

Gates 1-4 are file-drop-only in MVP scope; their HTTP-server UI (dial editor at gate 2, signoff form at gate 4) is deferred. File-drop works for every gate — write `docs/gate-{N}-approved.txt` with `proceed` / `revise:<section>` / `abort`. HTTP UI is a convenience, not a contract.

Scaffolding: `scaffolding/22-036-hitl-gates.md` (322 lines, pre-gate-6) specifies the full HTTP+file-drop mix. This plan ships MVP scope: all file-drop; HTTP deferred.

## Approach

Four phases.

### Phase 1 — GateDecision + GateResolution Zod contracts

1. Write `packages/orchestrator-contracts/src/gates.ts`:
   - `GateType` enum: `requirements | mockups | design-system | signoff | credentials | pr-review` (6 gates)
   - `GateDirective` enum: `proceed | revise | abort | approved | rejected` (union of all parse outcomes across gates)
   - `GateDecision`: `{ gateType, approved: boolean, directive, note?, payload? }`
   - `GateResolution`: what orchestrator receives — `{ approved, note?, payload? }` (narrowed from GateDecision)
   - `CredentialsGateOutput` (gate 5 specific): `{ decision: "proceed" | "defer" | "abort"; servicesConfirmed[]; servicesDeferred[]; deferralReasons: {[service]: reason}; envFileExists: boolean; warnings[] }`
   - `GateSixOutput` (new gate 6): `{ featureId, approved: boolean, prUrl?, comments? }`
2. Re-export via index.ts
3. Write `packages/orchestrator-contracts/tests/gates.test.ts` — ≥6 tests covering: enum values, directive parsing invariants, credentials-gate proceed/defer/abort shapes, gate-6 approved/rejected

**Exit**: contracts tests ≥155 (from 149).

### Phase 2 — Real file-drop watcher in gate-server-lifecycle.ts

Replace the stub with a real implementation:

1. `startGateServer({ stageName, projectRoot, gateType })` — returns `GateServerHandle`:
   - For gate types that are file-drop only (5, 6): `baseUrl: null` (matches existing stub), watch path per gate type
   - For gate types with HTTP UI (2, 4): fall back to file-drop MVP — watch `docs/gate-{N}-approved.txt`; HTTP server deferred
   - `stop()` — cleans up the fs.watch handle

2. `waitForGateDecision({ gateType, projectRoot, stageName })` — replaces auto-approve stub:
   - Compute expected file-drop path per gate type:
     - Gate 1 (requirements) → `docs/gate-1-approved.txt`
     - Gate 2 (mockups) → `docs/selected-style.json` exists AND valid (existing pattern)
     - Gate 3 (design-system) → `docs/gate-3-approved.txt`
     - Gate 4 (signoff) → `docs/signoff-*.json` exists AND `approved: true` (existing pattern)
     - Gate 5 (credentials) → `docs/credentials-confirmed.txt`
     - Gate 6 (pr-review) → `docs/gate-6-approved-{featureId}.txt`
   - fs.watch the path; poll interval 500ms; timeout configurable (default: wait forever)
   - On file written: read + parse per gate type's directive grammar
   - Return GateResolution `{ approved, note?, payload? }`

3. Print terminal instructions per gate type when waiting starts (copy from scaffolding/22-036 §Gate 5 user flow; generalize for other gates). Re-print "Waiting for..." every 60s.

**Key simplification vs scaffolding**: all gates converge on the file-drop pattern. HTTP server is deferred; gates 2 + 4 still use file-existence + parse rather than form POST.

### Phase 3 — Gate 6 integration (new gate, new flow)

Extend `orchestrator/src/feature-graph.ts`:

1. In `runFeature`, after reviewer returns `overallVerdict: "approved"`, BEFORE calling git-agent `close-feature`:
   - Invoke gate 6 via `waitForGateDecision({ gateType: "pr-review", ... featureId })`
   - Print: "Reviewer approved feat-{id}. Ready to merge to main. Drop `docs/gate-6-approved-{id}.txt` with `approved` or `rejected:<reason>`. "
   - git-agent optionally creates PR via `gh pr create` (stretch; fallback: just push branch + inform user of branch name for manual PR)
   - On `approved`: proceed to git-agent `close-feature` (existing flow)
   - On `rejected`: skip merge; surface rejection reason in FeatureResult's abortReason; orchestrator leaves branch on origin for manual handling
2. Expose `--auto-merge-after-reviewer` CLI flag (default false) to disable gate 6 — matches investigate-002 answer #1 autonomy target ("default opt-in for first 5 autonomous runs; flag to disable once trust builds")

### Phase 4 — Tests + dry-run verification + archive

1. Unit tests in `orchestrator/tests/gate-server-lifecycle.test.ts` (≥5 tests):
   - File-drop watcher detects write → resolves with correct directive
   - Malformed directive → doesn't resolve; logs warning; keeps watching
   - `stop()` cleans up fs.watch handle (no hanging handles)
   - Gate 6 file-drop: approved vs rejected parsing
   - Credentials gate (5) parsing: proceed / defer:A,B / abort / malformed
2. Run `pnpm --filter orchestrator test` — all 112+ tests pass; new tests green
3. Run `pnpm generate mindapp-v2 --dry-run` — no regression; halt message unchanged (dry-run doesn't invoke gate watchers)
4. Archive plan + scaffolding 22-036 (rewrite index entry to point to archive/; mark MVP-shipped with HTTP deferred note)

## Rejected Alternatives

- **Alternative A: Ship full HTTP server for gates 2 + 4 now** — Rejected. HTTP server adds ~500 LOC (Express app + dial-editor endpoint + signoff endpoint + port management + per-browser session state + {{GATE_API_BASE}} placeholder substitution at skill render time). File-drop fallback works for every gate; HTTP UI is a convenience that post-MVP can layer on top. First live run on hatch only needs gate 5 + 6 — both file-drop.

- **Alternative B: Skip gate 6 entirely and auto-merge after reviewer** — Rejected. Investigate-002 answer #1 explicitly asked for gate 6 as the autonomy boundary: reviewer's "approved" is an AI decision; gate 6 is the human's final say before `main` gains code. Auto-merge risks shipping compounded errors when reviewer's criteria are wrong. Default-on gate 6 + `--auto-merge-after-reviewer` flag lets trust build incrementally.

- **Alternative C: Split into two plans (task-036a file-drop; task-036b HTTP)** — Rejected. File-drop + gate 6 are tightly coupled (same watcher infrastructure; gate 6 extends the same pattern). Splitting adds branching ceremony without independent value.

- **Alternative D: Use `chokidar` npm package instead of built-in `fs.watch`** — Rejected for MVP. `fs.watch` is built-in, zero deps, handles the single-file watch pattern we need. Chokidar's value is in recursive + glob watching at scale; we watch exactly one file per gate. Can swap later if cross-platform edge cases surface.

- **Alternative E: Build the gate-6 PR-creation via github-api client instead of `gh` CLI** — Rejected. `gh` CLI handles auth + retry + rate-limit gracefully; github-api client needs token management + error wrapping + CI-bot-account setup. CLI is what an experienced engineer uses; our PR is "push branch + create PR"; CLI is cleaner than writing a client.

## Expected Outcomes

- [ ] `packages/orchestrator-contracts/src/gates.ts` + tests; contracts tests ≥155
- [ ] `orchestrator/src/gate-server-lifecycle.ts` no longer a stub — real fs.watch-based file-drop watcher
- [ ] `orchestrator/src/pipeline.ts` consumes `waitForGateDecision` for all gate types (currently auto-approved)
- [ ] `orchestrator/src/feature-graph.ts` fires gate 6 between reviewer-approve and close-feature
- [ ] `--auto-merge-after-reviewer` CLI flag skips gate 6 when set
- [ ] Unit tests for watcher + gate-6 flow (≥5 tests)
- [ ] `pnpm generate mindapp-v2 --dry-run` halt unchanged (still "all stages registered; real invocation would start here")
- [ ] Plan archived; `scaffolding/22-036-hitl-gates.md` moved to archive with MVP-shipped note + deferred-HTTP note
- [ ] First live Mode B run on hatch can now pause at gate 5 + gate 6 for human approval

## Validation Criteria

**Contract coverage:**

- GateType enum includes all 6 gates (5 classic + gate 6 pr-review)
- GateDirective enum covers all parse outcomes across gates
- Credentials gate output distinguishes proceed / defer / abort
- Gate-6 output names featureId + approved + optional prUrl + comments

**Runtime coverage:**

- Watcher resolves on file-write within test timeout
- Malformed directive does NOT resolve (keeps waiting)
- `stop()` prevents handle leak (verify via process.getActiveResourcesInfo() in a test)
- Gate 5 parses all 3 directives correctly
- Gate 6 parses approved / rejected:<reason>

**Orchestrator integration:**

- Pipeline advances through gates 1, 3, 5 via file-drop (tested via mock fs.watch)
- Feature-graph runFeature calls gate 6 after reviewer-approved
- `--auto-merge-after-reviewer` short-circuits gate 6 to auto-approve

**No regression:**

- `pnpm test:all` green across contracts (149 → 155+) + orchestrator (112 → 117+)
- Dry-run unchanged (gate watchers not invoked in dry-run mode — orchestrator's cli-runner.ts already auto-approves via default `waitForGate: async () => ({ approved: true })`)

## Attempt Log

### Attempt 1 — 2026-04-23 — completed

Four phases shipped in sequence, no rework needed.

**Phase 1 — gates Zod contracts**

- `packages/orchestrator-contracts/src/gates.ts` (113 lines): GateType re-exported from stages.ts (extended to 6 values including `pr-review`), GateDirective enum, GateResolution, GateDecision, CredentialsGateOutput, GateSixOutput
- `packages/orchestrator-contracts/tests/gates.test.ts` (19 tests)
- Contracts total: 149 → **168 tests**

**Phase 2 — real file-drop watcher**

- Replaced `orchestrator/src/gate-server-lifecycle.ts` (41-line stub → 388 lines real impl)
- `startGateServer` returns `{ baseUrl: null }` (HTTP deferred); watchers live per `waitForGateDecision` call
- `waitForGateDecision` — fs.watch on docs/ + 500ms poll backstop, 60s re-print cadence, AbortSignal wired
- Per-gate parsers: text directives (1, 3, 5, 6), SelectedStyle JSON (2), Signoff JSON glob (4)
- Exported pure helpers (`resolveGateFilePath`, `tryResolveGateFile`) for testing
- Updated `orchestrator/src/pipeline.ts` to re-export `GateResolution` from contracts + added `fileDropWaitForGate()` factory for CLI wiring

**Phase 3 — gate 6 integration**

- `orchestrator/src/feature-graph.ts`: injected gate 6 between agent_sequence walk and close-feature
- Trigger: `reviewer` in agent_sequence AND !`ctx.autoMergeAfterReviewer`
- On `rejected` → feature fails with `gate-6-rejected: <note>`
- `orchestrator/src/cli.ts` + `cli-runner.ts`: added `--auto-merge-after-reviewer` flag

**Phase 4 — tests + dry-run**

- `orchestrator/tests/gate-server-lifecycle.test.ts` (29 tests): file-drop watcher paths, directive parsers, live watcher with setTimeout writes, AbortSignal cleanup
- 4 new gate-6 tests in `orchestrator/tests/feature-graph.test.ts`
- Orchestrator total: 112 → **145 tests**
- Cross-package: **313 tests green**; build clean; dry-run on mindapp-v2 unchanged

**Archive**

- `scaffolding/22-036-hitl-gates.md` → `scaffolding/archive/22-036-hitl-gates.md` with MVP-shipped note
- `scaffolding/000-scaffolding-index.md` updated to point at archive path
- Plan moved to `plans/archive/` with this outcome block

### Lessons learned

- **`waitForPrReviewGate` must default to auto-approve in test contexts** — otherwise tests that include `reviewer` in `agent_sequence` hang waiting on a filesystem file that never arrives. Fixed by threading an injectable `waitForPrReviewGate` through `FeatureGraphContext` with the test helper defaulting to `async () => ({ approved: true })`.
- **`exactOptionalPropertyTypes: true` bites** when building objects with `undefined`-valued optional fields. Either omit the key entirely or spread conditionally — never set to `undefined`.
- **Typecheck (`tsc --noEmit`) is more lenient than build (`tsc` with emit)** — a null-narrowing bug slipped past typecheck but failed the build. Always run `pnpm -r build` before claiming done.
- **fs.watch on a non-existent file throws on some platforms** — watch the parent directory instead; poll + fs.watch together give belt-and-suspenders reliability on Windows.
