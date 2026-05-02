---
id: bug-042-global-setup-baseline-only-seeds-fx-cache
type: bug
status: draft
author-agent: human
created: 2026-05-02
updated: 2026-05-02
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/global-setup-baseline-coverage
affected-files:
  - .claude/templates/playwright-global-setup.ts.template
  - .claude/skills/agents/back-end/node-fastify/SKILL.md
  - .claude/skills/agents/back-end/python-fastapi/SKILL.md
  - .claude/skills/agents/back-end/node-trpc-nest/SKILL.md
  - .claude/agents/web-frontend-builder.md
feature-area: stack-skills/seed-baseline + Strategy-C-contract
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "Read-only flows fail because dashboard renders empty: global-setup seeds only fx_cache, never accounts/transactions. Spec expects 'This month' Card visible — app shows 'No accounts yet'."
reproduction-steps: "Run /start-build on a project with persistence_layer=real-db (Strategy C). Inspect projects/<name>/apps/web/playwright/global-setup.ts. Run E2E flows that depend on populated dashboard data — they fail because globalSetup only seeded fx_cache, not the entities the dashboard reads."
stack-trace: null
---

# bug-042: global-setup builder produces seed baseline that's INCOMPLETE — only `fx_cache`, missing accounts/transactions/etc

## Bug Description

Per `.claude/rules/testing-policy.md §E2E data-seeding strategy` Strategy C contract:

> "globalSetup seeds read-only baseline via a gated `/test/seed` endpoint; mutation flows wrap in `test.describe.serial` with their own beforeAll/afterAll"

The "read-only baseline" is meant to populate the data that all read-only flows depend on. For finance-track-01, that means at minimum:

- A handful of `accounts` (so dashboard shows balances, accounts page shows list)
- A handful of `transactions` (so "This month" card has totals, reports has data, transactions table has rows)
- Some `fx_cache` rows (so multi-currency normalization works)
- Maybe `settings` row (display_currency = EUR)

Empirically, `projects/finance-track-01/apps/web/playwright/global-setup.ts` ONLY seeds `fx_cache`:

```ts
const BASELINE_FX = [
  { base: "EUR", quote: "USD", rate: 1.08, fetched_at: TODAY },
  ... 11 entries
];

export default async function globalSetup() {
  ...
  const res = await ctx.post("/test/seed", {
    data: { fixtures: { fx_cache: BASELINE_FX } },
  });
  ...
}
```

NO accounts, NO transactions, NO settings. The dashboard reads accounts to render — finds none — shows "No accounts yet" empty state. flow-3 (Month-end review across currencies) expects "This month" card visible, fails because the entire populated dashboard never renders.

This is the THIRD link in the 5-step seeding-pipeline failure chain that left ALL 9 finance-track-01 synthesized E2E flows landing on empty UI states.

## Reproduction Steps

1. Run `/start-build` on a multi-tier project with `persistence_layer: real-db` and read-only-tier user flows that depend on populated data (e.g. dashboards, lists, reports).
2. After Mode B + verifier, inspect `projects/<name>/apps/web/playwright/global-setup.ts`.
3. Empirically: only fx_cache (or some other partial subset) is seeded; entities that user-flow `read-only` tier specs depend on (accounts, transactions, etc) are MISSING.
4. Run `pnpm -C apps/web exec playwright test e2e/synthesized` from project root (assuming bug-040+041 fixed so dev server actually boots).
5. Read-only flows fail with "element not found" on data-dependent UI components (Cards, Tables, Charts).

Empirical case: 2026-05-02 finance-track-01 — flow-3 (Month-end review, read-only tier) failed at interaction 2 (`expect '[data-kit-component="Card"]:has-text("This month")' visible`). Page snapshot shows entire dashboard rendering empty state.

## Error Output

From `projects/finance-track-01/apps/web/test-results/synthesized-flow-3-Month-e-03d5a-raction-s-deterministically-chromium/error-context.md`:

```
Error: flow-3 (Month-end review across currencies) failed at interaction 2:
  expect(locator).toBeVisible() failed
  Locator: locator('[data-kit-component="Card"]:has-text("This month")')
  Expected: visible
  ...
  Element(s) not found
```

Page snapshot shows:

```yaml
- main:
    - heading "No accounts yet" [level=3]
    - paragraph: "Add your first account to start tracking your finances across currencies."
    - button "Add account"
```

Dashboard rendered empty state because no accounts existed in the DB at test time.

## Root Cause Analysis

### Why global-setup only seeded fx_cache

The global-setup.ts builder (likely the `web-frontend-builder` for `feat-spa-shell-dashboard` OR a tester for a downstream feature) inferred WHAT to seed from somewhere — probably the architect's `architecture.yaml` integration list (which mentions Frankfurter / fx_cache prominently). It missed the broader inference: "what entities do the read-only flow specs READ from?"

Possible reasons:

1. **Builder didn't read user-flows-manifest.json's `seedingTier`** — for read-only flows, it should have inferred "what entities do these flows assert visibility of?" by reading the flow's `interactions[]` selectors + cross-referencing with `architecture.yaml.companion/data-models.yaml`.
2. **The `fx_cache` example dominated the prompt** — testing-policy.md mentions fx_cache + `/test/seed` heavily; builder anchored on that one example without thinking about the full read-only baseline.
3. **There's no canonical "what should global-setup seed" spec** — the testing policy mentions Strategy C abstractly but doesn't enumerate per-project required tables.

Most likely #1 + #3 — the builder needed BOTH a clearer spec AND the ability to read the flow specs to know what data they need.

### Why no agent caught it post-build

The verifier's flow-execution stage runs the specs but reports them as failures (per bug-039 we now correctly file them). But the failure reason "element not found" doesn't naturally suggest "seed data is missing" — it suggests "UI bug." So fix-bugs loop dispatches a builder to "fix" the UI Card component that's actually correct. False-positive bug class compounds quota burn.

## Fix Approach

### Phase A — synthesizer-time inference of required baseline (P0, immediate)

1. **Extend the synthesizer (`scripts/synthesize-flow-e2e.mjs`)** to compute a `readOnlyBaseline[]` derived from each `flow.interactions[]` of read-only-tier flows:
   - Find every `assertVisible` step's selector
   - Cross-reference with screen mockups to identify the rendering component (e.g. `[data-kit-component="Card"]:has-text("This month")` → Card in dashboard.html)
   - Cross-reference with `architecture.yaml.companion/data-models.yaml` to identify the data shape the component reads
   - Output a JSON manifest `apps/web/playwright/required-baseline.json` listing: `{ table_name: required_row_count_min }`

2. **global-setup builder consumes `required-baseline.json`** to know what to seed beyond fx_cache. Builder generates plausible test fixtures matching each table's schema + the required min count.

### Phase B — testing-policy.md baseline-spec section (P1)

3. **Add `.claude/rules/testing-policy.md §Strategy-C-baseline-spec`** — per-project canonical spec for what global-setup should seed:
   - For each entity in `architecture.yaml.companion/data-models.yaml` referenced by read-only flow assertions, seed AT LEAST 2 rows.
   - Cross-currency / cross-state coverage: if a Distinction (per `brief.md §5`) calls out a state, seed at least 1 row in each state.
   - Per-table sane defaults: 3-5 accounts (each currency present), 50-100 transactions across categories + months, settings row with sensible display_currency.

4. **Stack-skill §Testing block updates**: each backend stack skill (node-fastify, python-fastapi, node-trpc-nest) gains a "What global-setup must seed" sub-section pointing at the policy spec.

### Phase C — global-setup builder canonical template (P1)

5. **Ship `.claude/templates/playwright-global-setup.ts.template` (or update the existing one)** with a clear seeding pattern that includes ALL canonical entity types — not just fx_cache. Use placeholder `{{TABLES_TO_SEED}}` filled by the synthesizer/builder per Phase A's required-baseline.json.

### Phase D — verifier-time false-positive detection (P2, defense-in-depth)

6. **Verifier's flow-execution stage**: after a flow fails, query the backend's data tables (via `/test/inspect` or similar — new endpoint or temp via direct DB read for the test environment). If the table the spec's selector implies is empty, classify the failure as `seed-missing` rather than `ui-bug`. The fix-loop then routes the bug to the global-setup builder rather than a UI builder — fixes the root cause not the symptom.

### Phase E — empirical re-validation against finance-track-01

7. After Phases A+B+C ship + finance-track-01's global-setup gets re-built, re-run the verifier. Expect: read-only flows ACTUALLY exercise populated UI states; failures that surface are REAL UI integration bugs, not seed-data symptoms.

## Rejected Fixes

- **Hand-write a per-project global-setup with full seed data** — Rejected as the SCALABLE answer (works for finance-track-01 once but doesn't help future projects). Acceptable as Phase A interim while the synthesizer extension ships.
- **Make every flow seed its own data via `beforeAll: seedFixtures(...)`** — Rejected. Defeats the read-only/mutation tier distinction; mutation overhead per test slows the suite. The Strategy C contract correctly separates baseline (global-setup) from per-test mutation seeds.
- **Have builders run flows manually, observe failures, retry with bigger seed** — Rejected as automation regression. Builders shouldn't need empirical iteration to know what to seed; the spec should be derivable from manifest + data models.
- **Just relax the spec assertions** (e.g. allow flow-3 to pass on empty state) — Rejected. Spec assertions are correct; data is wrong. Don't lie about coverage.

## Validation Criteria

### Phase A

- [ ] Synthesizer extension produces `apps/web/playwright/required-baseline.json` per flow's read-only assertions.
- [ ] global-setup builder consumes the file + emits a complete seed.
- [ ] Regression test in synthesizer test suite covers the inference path.

### Phase B

- [ ] testing-policy.md §Strategy-C-baseline-spec section added with the per-project canonical rules.
- [ ] Stack-skill §Testing blocks updated with cross-references.

### Phase C

- [ ] `.claude/templates/playwright-global-setup.ts.template` updated with clear seeding-all-tables pattern.

### Phase D

- [ ] Verifier flow-execution distinguishes `seed-missing` failures from `ui-bug` failures + routes accordingly.

### Phase E

- [ ] finance-track-01 re-run: flow-3 passes (or fails on a REAL UI bug); other read-only flows similarly exercise populated UI.

## Cross-references

- **Empirical case**: 2026-05-02 finance-track-01 — third link in 5-step seeding-pipeline failure chain. ALL 9 read-only + mutation flows landed on empty states because dashboard had no data to render.
- **Sister bugs**: bug-040 (architect skips scripts/dev.mjs), bug-041 (playwright.config.ts missing webServer) — together with bug-042 they comprise the full broken-seeding story.
- **Related investigation**: investigate-013 (seed state coverage from brief) — the seed-script-data path Phase A. bug-042 is the analog for E2E baseline rather than dev-seed.
- **Predecessor specs**: feat-038 Phase 0 (E2E data-seeding strategy decision) defined Strategy C as "globalSetup seeds read-only baseline." bug-042 is the enforcement gap — the policy was specced but not OPERATIONALIZED.

## Attempt Log

<!-- populated as fix attempts are made -->
