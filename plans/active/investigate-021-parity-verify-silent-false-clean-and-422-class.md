---
id: investigate-021-parity-verify-silent-false-clean-and-422-class
type: investigation
status: in-progress
author-agent: human
attempt-count: 1
created: 2026-05-07
updated: 2026-05-07
parent-plan: null
supersedes: null
superseded-by: null
branch: null
affected-files:
  - orchestrator/src/parity-verify.ts
  - scripts/audit-computed-styles.mjs
  - scripts/diff-kit-skeleton.mjs
  - scripts/seed-app-state.mjs
  - orchestrator/src/build-to-spec-verify.ts
  - packages/types/src/index.ts
  - packages/api-client/src/index.ts
feature-area: orchestrator/parity-verify + cross-package-type-contracts
priority: P0
attempt-count: 0
max-attempts: 5
time-box-minutes: 120
hypothesis: |
  CORRECTING MY PRIOR FRAMING: The factory DOES have visual-parity
  comparison + seed-data orchestration:
    - parity-verify.ts drives Playwright headless to render the BUILT
      page + capture kit-skeleton + computed-style snapshots
    - audit-computed-styles.mjs diffs computed styles per-property
      with tolerance
    - seed-app-state.mjs orchestrates seed→navigate→preActions before
      snapshot
    - visual-review (Mode A) screenshots mockup HTML at 3 viewports
  These should have caught BOTH the CSS-not-loading bug AND the
  status-enum drift (which surfaces as 422 on book create).
  Empirical reading-log-01: ALL 6 visual-parity bugs filed by parity-
  verify had `styleDrift: []` and `variantDrift: []` — the structural
  DOM diff caught layout-regrouping but the computed-style audit
  produced FALSE-CLEAN. The user found the CSS was completely missing
  (Tailwind utilities never generated; postcss.config.mjs absent;
  @tailwind directives absent from globals.css). With CSS not loading,
  EVERY computed property would drift. Empty styleDrift is the
  equivalent of bug-055's empty-merge silent-success at the parity
  layer — degraded output looking like clean output. Plus: seed step
  may have silently failed when backend rejected POSTs with 422
  (status enum mismatch), so populated-state screens never got
  populated for comparison.
---

# investigate-021: Why did parity-verify report `styleDrift: []` when CSS wasn't loading?

## Question

Empirical reading-log-01 (2026-05-06 fix-bugs final run b21y5103m): the
factory's parity-verify ran, filed 6 visual-parity bugs, all with
`styleDrift: []` and `variantDrift: []` (only `missing` + `extra`
DOM-skeleton arrays populated). Loop reported `status: clean` after
the agents fixed the layout-regrouping (DOM structure). User then
opened the live app — **no CSS loaded**, and book-create form returns
**422 Unprocessable Entity** because frontend sends
`status: "want-to-read"` while backend Zod schema expects
`status: "to-read" | "reading" | "read"`.

Both should have been caught by parity-verify (computed-style audit
on a CSS-broken page = massive drift on every property) AND by the
seeded interaction flow (POST /books from frontend → 422 from
backend = the seed step itself fails). Why didn't they?

## Empirical anchor

`projects/reading-log-01/docs/bugs.yaml` (post-final-run) — every
visual-parity bug:

```yaml
- id: bug-parity-book-create-layout-regrouping
  parity:
    detail:
      missing: [Modal[0], Modal[0] > Input[0], ...]   # ← populated
      extra:   [AppShell[0], ...]                      # ← populated
      variantDrift: []                                 # ← EMPTY
      styleDrift: []                                   # ← EMPTY (impossible if CSS broken)
```

`projects/reading-log-01/docs/visual-review/webapp/`:

```
book-create/        # mockup screenshots EXIST (Mode A artefact)
book-detail/
books-list/
books-list-empty/
settings/
tags-manage/
```

But no equivalent built-app screenshots in `parity-verify` output —
only the JSON divergence rows.

## Hypotheses

### H1 (highest confidence): Computed-style audit got DEGRADED output

When parity-verify can't capture computed styles from the built page
(Playwright fails, dev-server-not-ready, navigation timeout), it
returns empty `styleDrift` instead of failing the audit. This is the
exact silent-success pattern bug-055 closed at the merge layer —
empty result silently treated as "no drift".

Evidence:

- The verifier WAS able to boot frontend (`parity: dev-server:
auto-booted at http://localhost:3000 (took 2621ms)`)
- BUT backend timed out on its 60s budget (`flow-execution:
dev-server-not-ready... within 60s`)
- Without backend, frontend page renders empty/error states
- Computed-style snapshot of error state ≠ mockup populated state
- BUT the audit returned [] not "huge drift" — degraded path

Need to read `parity-verify.ts` + `audit-computed-styles.mjs` for
the actual error path on Playwright failure.

### H2: Seed step silently failed on backend errors

`seed-app-state.mjs` orchestrates seed→navigate. If the seed POST
returns 422 (because of the status-enum mismatch we found),
parity-verify might fall through to comparing UNSEEDED frontend
against POPULATED mockup — which is itself massive drift, but the
audit might also degrade here.

Need to check seed-app-state's error-handling on backend rejection.

### H3: Computed-style snapshot was taken AGAINST THE WRONG TARGET

E.g. snapshotting the mockup HTML twice (mockup vs mockup, no built
page involved) — would always produce `styleDrift: []`. Easy to
verify by reading the parity-verify orchestration.

### H4: visual-review (Mode A) screenshots mockup HTML at 3 viewports — but never re-runs against the BUILT app

This is correct-by-design — visual-review is a design-stage gate
quality-checking the mockups themselves before /architect picks a
stack. It doesn't substitute for runtime visual diff against built
output. The user's "compare live screen against designed screens"
intuition is satisfied by parity-verify, not visual-review.

But there's a separate gap: the post-build visual-review-equivalent
that screenshots the LIVE app + diffs against mockup screenshots
(or runs the same LLM rubric on the live screenshots) doesn't
exist as a deliberate stage. parity-verify does the structural +
computed-style version; the "render two PNGs and pixel-diff" or
"LLM critique on a built screenshot" version is missing.

### H5: Cross-package type drift has no automated check

`packages/types/src/index.ts` exports `BookCreateInput`. `apps/api/src/schemas/book.ts`
defines `CreateBookBody` Zod schema independently. Frontend uses
`BookCreateInput`; backend validates against `CreateBookBody`. They
drift because:

- The status enum in BookCreateInput is `"want-to-read" | "reading" | "read"`
- The status enum in CreateBookBody is `"to-read" | "reading" | "read"`

There's no compile-time or runtime contract that they agree.
Independent of parity-verify, this is a class of bug the loop will
keep producing as long as types are duplicated across packages.

## Investigation Steps

### Step 1 — Read parity-verify error paths (15min)

Open `orchestrator/src/parity-verify.ts` + `scripts/audit-computed-styles.mjs`.
For each failure mode (Playwright not installed, navigation timeout,
seed step failed, computed-style capture threw), trace what the
output looks like. Specifically:

- Does empty styleDrift mean "no drift detected" OR "audit failed"?
- Is there a sentinel for "audit degraded — couldn't capture"?

If empty styleDrift conflates "clean" + "degraded", that's bug-055
all over again at this layer.

### Step 2 — Read seed-app-state error paths (10min)

When seed POST returns non-2xx, what does seed-app-state do?

- Throw → parity-verify catches → bug filed
- Silently continue → parity audits unseeded state → false output
- Warn-and-continue → some intermediate

If "silently continue", that's the smoking gun for our 422 case.

### Step 3 — Empirical replay of parity-verify on this project (20min)

Run the parity-verify wrapper directly:

```bash
node scripts/audit-computed-styles.mjs <args> --target=projects/reading-log-01
```

Or via the orchestrator's wrapper. Capture the actual computed-style
snapshots from BOTH mockup AND built page. If built-page snapshot is
empty / minimal (because CSS missing), the audit should produce
massive drift. If it returns [], H1 confirmed.

### Step 4 — Cross-package type contract audit (30min)

Walk every shared type between `packages/types`, `packages/api-client`,
and `apps/api/src/schemas`:

| Type                          | packages/types | packages/api-client | apps/api/src/schemas         | Match? |
| ----------------------------- | -------------- | ------------------- | ---------------------------- | ------ |
| Book.status enum              | TBD            | TBD                 | "to-read"\|"reading"\|"read" | TBD    |
| BookCreateInput               | TBD            | TBD                 | TBD                          | TBD    |
| coverUrl optional vs nullable | TBD            | TBD                 | TBD                          | TBD    |

Categorize each mismatch. Decide: generated types from Zod schemas
(z-to-ts), or hand-maintained with a verifier check, or contract-test.

### Step 5 — Decide architecture for the "live-app visual gate" (30min)

Three candidates:

**A. Make parity-verify reliable** — fix the H1/H2/H3 silent-degraded
paths. styleDrift becomes "[] only when audit ran successfully and
truly found no drift". On audit failure, return a sentinel value the
caller surfaces as a P0 bug (similar to bug-055 Phase B's empty-merge
guard). Lowest engineering cost; closes the immediate gap.

**B. Add screenshot-pixel-diff** — separate from computed-style audit,
take 3-viewport screenshots of BOTH mockup and built page, pixel-diff
with tolerance. Higher confidence (catches font/spacing/icon issues
computed-style misses) but introduces tolerance-tuning complexity +
slower.

**C. Add LLM-rubric on live screenshots** — re-use visual-review's
rubric.md on screenshots of the BUILT app. Highest fidelity (LLM
catches "looks broken to a human" issues neither A nor B would). $
cost per screen × N screens × 3 viewports.

Recommend A as the immediate ship; B + C as follow-ups conditional
on residual gap after A.

### Step 6 — Cross-package type contract solution (20min)

Decide between:

**Option X**: Generate TypeScript types from Zod schemas in
apps/api/src/schemas → re-export from packages/api-client. Single
source of truth; frontend imports from api-client, backend uses
the schemas directly.

**Option Y**: Keep duplicated types but add a contract-test that
validates them (e.g. import both, derive the structural shape via
type-level operations, assert equivalent).

**Option Z**: Just trust developers to keep them in sync. (Rejected
— this is exactly what failed.)

X is the right answer architecturally; cost is updating every
shipped project to adopt the pattern.

### Step 7 — Empirical re-validation (15min)

After ship: re-fire /fix-bugs reading-log-01 OR run a one-shot
parity-verify pass. Confirm:

1. styleDrift now contains real drift entries (not [])
2. seed step surfaces the 422 as a P0 bug
3. The book-create form bug is reported as either parity-divergence
   or a new bug class

## Findings

(populate after Steps 1-3 are done)

## Recommendation

Likely follow-up plans:

- **bug-062-parity-verify-silent-degraded-styledrift** — Step 5
  Option A. Empty styleDrift sentinel + audit-failure path. P0,
  ~2-3h.
- **bug-063-seed-app-state-silent-422-acceptance** — seed step
  must throw on backend rejection, not silently continue. P0,
  ~1h.
- **feat-063-cross-package-type-contract** — Step 6 Option X.
  Generate frontend types from backend Zod. P1, ~4-8h.
- **(immediate) bug-064-reading-log-01-422-status-enum-drift** —
  fix the actual reading-log-01 product bug so user can use the
  app. ~30min hand-fix or could be re-dispatched after factory fixes.

DEFER: B (pixel-diff) and C (LLM rubric on built screenshots) until
after A's fix proves insufficient.

## Cross-references

- `bug-055` Phase B (empty-merge silent-success at merge layer) —
  this investigation is the equivalent class at the parity layer
- `feat-022` (build-to-spec-verify) — the parent stage that
  invokes parity-verify
- `feat-028` (visual-parity verifier) — the original parity-verify
  ship; investigate-021 closes the silent-degraded gap discovered
  empirically post-feat-028
- `feat-029` Phase 3 (seed-app-state) — same lifecycle; investigate-021
  closes the silent-accept-on-422 gap
- `visual-review` skill — Mode A design-stage gate (mockup quality);
  NOT the same as the parity-verify built-app gate; both have
  legitimate uses

## Attempt Log

### Attempt 1 (2026-05-07) — Steps 1-3 done; original framing CORRECTED

The original hypothesis (H1: silent-degraded styleDrift, conflated empty
result with clean) is **partially right but mis-scoped**. After comparing
to repo-health-dashboard-01 (RHD-01), the actual finding is:

**`audit-computed-styles.mjs` and `seed-app-state.mjs` were SHIPPED but
NEVER WIRED into the orchestrator's parity-verify.** They're CLI-only
scripts. `grep -rn "audit-computed-styles\|seed-app-state" orchestrator/src/`
returns ZERO matches. `parity-verify.ts::defaultCompareScreen` only
invokes `diff-kit-skeleton.mjs` (line 343-380); the docstring at line 24
claims it ALSO runs `audit-computed-styles.mjs` but that wiring was
never built. `diff-kit-skeleton.mjs:306` writes `styleDrift: []` with
the comment "populated separately by audit-computed-styles.mjs" — that
"separate population" never happens.

Both files have the comment `populated separately by ...` patterns
indicating intent, but the orchestration glue was never written.

### Empirical comparison: RHD-01 vs reading-log-01

| Metric                    | RHD-01 (Strategy D)                       | reading-log-01 (Strategy C)                |
| ------------------------- | ----------------------------------------- | ------------------------------------------ |
| Persistence layer         | external-API only                         | real-DB (Prisma + SQLite)                  |
| Reachability orphans      | 70 (audit-app-reachability ✓)             | 0 (no orphans, expected)                   |
| Skeleton-diff parity bugs | 4                                         | 6                                          |
| `styleDrift` populated    | NEVER (always `[]`)                       | NEVER (always `[]`)                        |
| Synthesized e2e specs ran | YES (page.route mocks; no backend needed) | NO (backend cold-boot exceeds 60s timeout) |
| Behavioral bugs surfaced  | Via flow-failure runs                     | Zero — flow runner couldn't start          |

**The "50+ bugs" the user remembered from RHD-01 was 70
reachability-orphans plus 4 skeleton-diff parity** — both
mechanisms that ARE wired and work fine. ZERO bugs ever came from the
shelf-ware computed-style audit or seed-app-state in either project.

### The decisive difference: Strategy C vs Strategy D (per testing-policy.md)

> repo-health-dashboard-01 (shipped, external-API only) — **Strategy D**.
> apps/web/e2e/compare.spec.ts:15 uses page.route("**/api/report/**", ...)
> to fake the GitHub-proxy responses. **No backend needed.**
>
> book-swap / finance-track (pre-builds, **real-DB**) — would need
> **Strategy C** when E2E lands. **No shipped pattern yet; first project
> to ship will define the canonical /test/seed endpoint shape.**

reading-log-01 is **literally the first Strategy C project** to ship
through /fix-bugs. The wall it hits is Strategy-C-specific:

1. Backend cold-boot (Prisma migrate-on-boot adds 5-15s; pnpm shell adds
   3-5s; fastify init adds 2-5s) routinely exceeds the verifier's
   hardcoded 60s for `dev-server-not-ready`.
2. Even if backend boots, the `/test/seed-baseline` endpoint exists in
   the project (per stack-skill scaffold) but the synthesizer
   (`scripts/synthesize-flow-e2e.mjs`) never generates the call to it.
3. Backend Zod accepts `status: "to-read" | "reading" | "read"` while
   frontend types use `"want-to-read"` — type drift across packages
   surfaces as 422 on POST /books, but only when seeded (which never
   happens).

### Reframed layer model

| Layer                            | Wired?                            | Strategy D              | Strategy C                    | Catches                          |
| -------------------------------- | --------------------------------- | ----------------------- | ----------------------------- | -------------------------------- |
| L1: reachability + skeleton-diff | ✓                                 | works                   | works                         | orphans, layout-regrouping       |
| L2: synthesized e2e flow runner  | ✓ but Strategy-D-only-effectively | runs (page.route mocks) | 0 tests run (backend timeout) | flow failures, behavioral bugs   |
| L3: computed-style audit         | ✗ NEVER WIRED                     | empty                   | empty                         | CSS drift, token drift           |
| L3: seed-app-state               | ✗ NEVER WIRED                     | empty                   | empty                         | populated-state bugs, type drift |

The user's intuition about "we have visual-parity that seeds + compares
screens" maps onto Layer 3, which has been shelf-ware since feat-028.
It hasn't actually surfaced bugs in any project; the wins to date have
all been L1 + L2.

### Decision: ship in this priority order

P0 (immediate, unblocks Layer 2 for Strategy C):

- **bug-062-strategy-c-dev-server-timeout** — extend 60s to 180s when
  `architecture.yaml.tooling.stack.persistence_layer === "real-db"`.
  Touch `scripts/run-synthesized-flows.mjs` + `orchestrator/src/dev-server.ts`.
- **bug-063-strategy-c-seed-baseline-not-invoked** — synthesizer should
  emit `globalSetup` calling `/test/seed-baseline` for Strategy C.
  Touch `scripts/synthesize-flow-e2e.mjs`.

P1 (immediate user-unblock):

- **bug-064-reading-log-01-status-enum-drift** — hand-fix project so app
  is usable. Status enum + coverUrl: null. ~30 min.

P2 (factory hygiene, deferred):

- **feat-064-wire-computed-style-audit + seed-app-state** — Layer 3
  proper wiring. Lower priority because Layer 2 (Strategy C e2e) catches
  the same class of bugs (incl. 422-class).
- **feat-065-cross-package-type-contract** — z-to-ts or contract test.
  Closes the class that produced the status enum drift in the first place.

P3 (also deferred):

- **bug-066-postcss-and-tailwind-directives-missing-from-react-next-scaffold**
  — react-next stack-skill should ship `postcss.config.mjs` + `@tailwind`
  directives in the ui-kit globals.css template. User patched both inline
  this session for reading-log-01.

The path forward is bug-062 + bug-063 + bug-064 first. Then re-fire
/fix-bugs against reading-log-01 — should surface 422 as a real bug
class via L2, then re-converge.
