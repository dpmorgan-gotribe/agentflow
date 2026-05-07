---
id: investigate-022-factory-verifier-missed-8-review-bugs-on-reading-log-01
type: investigation
status: draft
author-agent: human
created: 2026-05-07
updated: 2026-05-07
parent-plan: null
supersedes: null
superseded-by: null
branch: null
affected-files:
  - orchestrator/src/parity-verify.ts
  - orchestrator/src/build-to-spec-verify.ts
  - scripts/audit-computed-styles.mjs
  - scripts/synthesize-flow-e2e.mjs
  - scripts/run-synthesized-flows.mjs
  - .claude/skills/build-to-spec-verify/SKILL.md
feature-area: orchestrator/verification-coverage
priority: P0
attempt-count: 0
max-attempts: 5
time-box-minutes: 90
hypothesis: |
  reading-log-01 shipped through the full factory pipeline (Mode A → Mode B
  build → /build-to-spec-verify → fix-bugs-loop → 9-of-10 bugs auto-resolved)
  but a manual review surfaced 8 NEW bugs the verifier didn't file. Three
  hypotheses for the gap pattern: (H1) the synthesized e2e flow tier is
  wedged by bug-071's playwright webServer 0-byte spawn — runtime + behavior
  bugs all slip through; (H2) audit-computed-styles.mjs exists but is
  CLI-only / never wired into the orchestrator's verify pipeline — visual /
  layout bugs all slip through; (H3) the parity audit's kit-skeleton diff
  only catches kit-component identity mismatches, missing whole categories
  (raw-HTML mockup elements like brand/logo, click-handler-wiring, hydration
  drift). H1 is the dominant gap (5 of 8 review bugs would be caught by it
  if working); H2 is the second (2 of 8); H3 is small (1 of 8).
---

# investigate-022: Why didn't the factory's verifier catch these 8 review bugs?

## Question

reading-log-01 went through the full factory pipeline + a /fix-bugs cycle that
resolved 9 of 10 verifier-reported bugs. A manual review afterward surfaced 8
NEW bugs the verifier never filed. Why? Which verifier layer SHOULD have caught
each, and what's the gap?

## The 8 review bugs

| #   | Bug                                                                                   | Surface  | Type             |
| --- | ------------------------------------------------------------------------------------- | -------- | ---------------- |
| 1   | Hydration mismatch on `<html data-theme="light">` (server) vs client; red dev overlay | runtime  | SSR/CSR drift    |
| 2   | Click book → `/books/NaN` → 404 (instead of `/books/<actual-id>`)                     | runtime  | nav/state bug    |
| 3   | Sidebar not full page height                                                          | layout   | CSS              |
| 4   | "New tag" button click does nothing                                                   | behavior | missing handler  |
| 5   | "Export JSON" in settings does nothing                                                | behavior | missing handler  |
| 6   | Brand + logo missing from header                                                      | layout   | missing element  |
| 7   | Header alignment off (Add book + search filter not placed per mockup)                 | layout   | CSS              |
| 8   | Status filter shows only "Reading"; "Read" + "To-read" tabs not visible               | behavior | filter rendering |

## Catch-layer mapping

| Bug | Expected catch-layer                                                                     | Actual outcome                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | feat-027 runtime-error capture in synth-e2e (`page.on("pageerror")` + `consoleErrors[]`) | bug-071 wedged synth-e2e → no specs ran → no console errors captured                                                                                                       |
| 2   | synth-e2e flow walking books-list → book-detail (asserts `/books/<id>` URL or screen-id) | bug-071 wedged synth-e2e; backend stdout DID surface `GET /books/NaN → 404` during /fix-bugs verifier output but only as a free-text warning, never escalated to bugs.yaml |
| 3   | `audit-computed-styles.mjs` (computed CSS height + position diff)                        | script exists at `scripts/audit-computed-styles.mjs` but is CLI-only / never invoked by orchestrator (per user-feedback memory + investigate-021 framing)                  |
| 4   | synth-e2e flow exercising tag-create button (assert modal opens after click)             | bug-071 wedged synth-e2e; ALSO depends on whether `user-flows-manifest.json` declares this flow                                                                            |
| 5   | synth-e2e flow exercising export-json button OR brief-coverage gate                      | bug-071 wedged synth-e2e; brief-coverage gate flags missing capability mappings, not missing IMPLEMENTATIONS                                                               |
| 6   | parity-audit kit-skeleton diff (`AppShellHeader > Brand` mismatch)                       | parity audit only matches when BOTH sides emit `data-kit-component=`; mockup uses raw `<a>` text for brand → invisible to skeleton walker                                  |
| 7   | `audit-computed-styles.mjs`                                                              | not wired (same as #3)                                                                                                                                                     |
| 8   | synth-e2e flow asserting all 5 status-filter tabs render                                 | bug-071 wedged synth-e2e; ALSO mockup pre-fix had wrong status labels (manually fixed in master commit 9d28a0d) so the parity audit saw an unrelated mismatch              |

## Gap-pattern summary

```
5 of 8 bugs (62.5%) — synth-e2e wedge (bug-071)        ← largest single gap
2 of 8 bugs (25%)   — audit-computed-styles unwired
1 of 8 bugs (12.5%) — parity audit's raw-HTML blind spot
```

## Hypothesis (per frontmatter)

H1 (synth-e2e wedge) is the dominant gap. Bug-071 — playwright's webServer
auto-spawn produces 0 bytes for 180s on Windows under nested pnpm shells —
prevents synthesized e2e specs from running at all. The verifier reports the
failure as a single free-text warning ("dev-server-not-ready") but never
escalates the underlying flow failures to individual bugs.yaml entries.

This means the entire **runtime + behavior layer** of verification is dark.
Every bug class that requires actually clicking buttons, navigating, or
observing console errors falls through to manual review.

## Investigation Steps

### Step 1 — Confirm bug-by-bug catch-layer mapping (15min)

For each of the 8 bugs:

1. Reproduce on the running master dev-server (`http://localhost:3000`).
2. For runtime bugs (#1, #2): open browser devtools, capture console + network
   traces.
3. For layout bugs (#3, #6, #7): screenshot + measure pixel positions.
4. For behavior bugs (#4, #5, #8): click + observe what (doesn't) happen.
5. For each, name the SPECIFIC verifier-layer assertion that would have
   caught it (e.g., "synth-e2e flow `flow-3` step 4 assert URL matches
   `/books/\\d+`").

### Step 2 — Audit synth-e2e wedge: how does verifier report flow-execution failures? (15min)

Read `scripts/run-synthesized-flows.mjs` + `orchestrator/src/build-to-spec-verify.ts`:

- When playwright's webServer times out (bug-071), what does the verifier
  report? Does it file individual bugs.yaml entries per failed flow, or just
  one warning at the run level?
- Does it surface the synthesized specs' failure HTML files (now non-empty
  per bug-072) anywhere in the bug-author downstream?
- Decision point: should the verifier file ONE per-flow bug.yaml entry per
  failed synth-e2e, even when the root cause is dev-server pre-flight?

Expected finding: verifier emits a single dev-server-not-ready warning + zero
behavior-tier bugs.yaml entries, even though the synth-e2e specs hold the
truth about which flows would have failed.

### Step 3 — Audit `audit-computed-styles.mjs` integration gap (15min)

Read the script + grep for invocations:

- Who calls `audit-computed-styles.mjs`? CLI only, or is there a TS wrapper?
- What does it produce? Per-screen layout-divergence data?
- Why was it never wired into `build-to-spec-verify`'s aggregate output?
- Is the integration risk pure plumbing (small TS wrapper + bug-class) or
  something deeper (false-positive rate, performance, missing deps)?

### Step 4 — Audit parity-verify's raw-HTML blind spot (10min)

Per bug #6 (brand/logo missing): if a mockup has `<a href="/" class="brand">…</a>`
without a `data-kit-component=` attribute, the kit-skeleton walker skips it
entirely. The build's kit-component-wrapped Brand (if present) shows as
"extra"; the build's raw-HTML brand-link (if present) is invisible too — net:
no parity divergence reported.

Decide: is this a kit-authoring mandate ("every visible element gets a
data-kit-component") or a parity-audit extension ("walk both kit-skeleton

- semantic-HTML structure")?

### Step 5 — Decide remediation roadmap (15min)

Based on Steps 1-4, draft prioritized fix list:

1. **Bug-071 unblock** (HIGHEST priority): single-bug fix that unblocks 5
   of 8 review-bug classes. Investigate-019's M-F (per-agent MCP scoping)
   reduces MCP cold-start frequency; orthogonally, bug-071 itself needs a
   fix or workaround in the verifier's dev-server lifecycle.
2. **Wire audit-computed-styles** (MEDIUM): Pure plumbing if the script
   already produces the right data. Reach 7 of 8 bug classes.
3. **Per-flow synth-e2e bug filing** (MEDIUM): Even when bug-071 still
   trips, make the verifier file individual bugs.yaml entries per failed
   flow so the failure-HTML envelope (bug-072) reaches the bug-author.
4. **Brand/logo parity audit** (LOW): Add a "semantic landmarks" sub-walker
   to the kit-skeleton differ that catches role=banner / brand /
   logo elements regardless of data-kit-component presence.
5. **Hydration-warning lint** (LOW-MEDIUM): The hydration mismatch on
   `data-theme="light"` is from a NEXT_PUBLIC env or stylesheet effect.
   Consider whether the reviewer agent or the synth-e2e runtime-capture
   should fail-loudly on hydration warnings (currently captured as
   warnings, never escalated).

## Empirical anchor

reading-log-01 master @ 9d28a0d (2026-05-07).

- 9 verifier-found bugs auto-resolved through 2 fix-bugs iterations (~$31.93)
- 1 verifier-found bug manually closed after exhausted retries (manual fix in
  9d28a0d — investigate-019 H6 keepalive starvation)
- 8 review-found bugs (this plan's catalogue) — verifier missed all 8

## Cross-references

- `bug-071-playwright-webserver-spawn-zero-bytes` — the wedge that gated
  Step 2 in the catch-layer mapping
- `investigate-019` H6 — root cause of the keepalive starvation that
  exhausted retries on the 1 manually-closed bug; M-D shipped factory commit
  76d29a5; M-F deferred but high-leverage for THIS investigation too
- `bug-072-blank-failure-html-files-from-page-content-swallow` — shipped
  factory commit 335642f; the envelope-fallback that means failure-HTML now
  carries useful debugging context when synth-e2e DOES run
- `investigate-021-post-design-pipeline-architecture` — the framing that
  catalogued Layer 1 (parity) vs Layer 2 (synth-e2e) as the verification
  stack; this investigation surfaces gap evidence for both layers

## Recommendation

If H1 (synth-e2e wedge) confirms in Step 2: ship M-F first (per investigate-019),
THEN re-fire /fix-bugs against reading-log-01 to see how many of the 8 review
bugs the verifier surfaces autonomously when synth-e2e is actually running.
That's the cheapest way to validate the gap-pattern hypothesis empirically.
If 5+ of 8 surface, H1 is confirmed and the rest of the roadmap (Steps 3-5)
can sequence behind M-F's empirical demonstration.

## Attempt Log

(empty — investigation drafted by human after manual review of master @ 9d28a0d)
