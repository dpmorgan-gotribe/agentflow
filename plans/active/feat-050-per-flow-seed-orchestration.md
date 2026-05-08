---
id: feat-050-per-flow-seed-orchestration
type: feature
status: draft
author-agent: claude-opus-4-7
created: 2026-05-03
updated: 2026-05-08
parent-plan: bug-042-global-setup-baseline-only-seeds-fx-cache
supersedes: null
superseded-by: null
branch: feat/per-flow-seed-orchestration
affected-files:
  - schemas/user-flows-manifest.schema.json
  - .claude/skills/user-flows-generator/SKILL.md
  - scripts/synthesize-flow-e2e.mjs
  - .claude/templates/playwright-global-setup.ts.template
  - .claude/templates/seed-db.ts.template
  - .claude/skills/agents/back-end/node-fastify/SKILL.md
  - .claude/skills/agents/back-end/node-trpc-nest/SKILL.md
  - .claude/skills/agents/back-end/python-fastapi/SKILL.md
  - .claude/rules/testing-policy.md
  - orchestrator/tests/synthesize-flow-e2e.test.ts
feature-area: orchestration
priority: P0
attempt-count: 0
max-attempts: 5
---

# feat-050 — Per-flow seed orchestration via manifest extension

## Problem Statement

Empirical evidence on `finance-track-01` (2026-05-03 — synthesized E2E run): 3 of 9 flows fail because the baseline seed produces state that contradicts the flow's first interaction.

| Flow                          | Flow expects                               | Baseline seed actually produces             |
| ----------------------------- | ------------------------------------------ | ------------------------------------------- |
| flow-1 ("First-time setup")   | `[EmptyState]:has-text("No accounts yet")` | 3 accounts (USD/GBP/JPY) populated          |
| flow-8 ("Archive an account") | `[ListItem]:has-text("USD Cash")`          | account named "US Checking"                 |
| flow-9 ("Offline resilience") | `[Badge]:has-text("stale")`                | fx_cache row with fresh `last_refreshed_at` |

The bug-042 deferred follow-up named this exactly: "selector→table inference deferred as feat-future depth (would help with flow-1/5/8/9 seed-vs-flow mismatches if revisited)."

There's no factory mechanism for a flow to declare "I need the DB in state X before my interactions run." The current options are bad:

- Re-author flow manifest to match baseline (loses test coverage of empty-state UI; blurs flow intent)
- Re-author baseline to match a single flow (breaks the OTHER 6 flows that expect populated state)
- Run all flows against shared baseline (current; produces the empirical 3/9 mismatch)

Per the snapshot's open question — option (a) re-author flows OR (b) per-flow seed overrides — this plan ships option (b) since it's the architecturally clean answer that doesn't compromise test fidelity.

## Approach

### Phase A — Manifest schema extension

`schemas/user-flows-manifest.schema.json` gains a new optional per-flow field:

```json
{
  "id": "flow-1",
  "title": "First-time setup",
  "seedingTier": "mutation",
  "requiredState": {
    "kind": "empty",
    "tablesToCleanup": ["accounts", "transactions", "fx_cache"]
  }
}
```

Three `kind` variants:

- `"baseline"` (default; behavior unchanged) — call `/test/seed-baseline` as today
- `"empty"` — call `/test/cleanup` (already exists per bug-042) on the listed tables; skip baseline
- `"custom"` — call `/test/cleanup` then `/test/seed` with the flow-specific fixtures (verbatim shape from testing-policy §Strategy-C-test-seed-contract)

```json
{
  "id": "flow-9",
  "requiredState": {
    "kind": "custom",
    "tablesToCleanup": ["fx_cache"],
    "fixtures": {
      "fx_cache": [
        {
          "base": "EUR",
          "quote": "USD",
          "rate": 1.08,
          "last_refreshed_at": "2026-04-15T00:00:00Z"
        }
      ]
    }
  }
}
```

The `last_refreshed_at` is intentionally 2+ weeks old so the build's fx-status-indicator renders the "stale" badge.

### Phase B — Synthesizer emission

`scripts/synthesize-flow-e2e.mjs` reads `requiredState` per flow and emits stack-appropriate `beforeAll`:

```ts
test.describe.serial("Offline resilience (flow-9)", () => {
  test.beforeAll(async ({ request }) => {
    // feat-050: per-flow seed override
    await request.post("/test/cleanup", { data: { tables: ["fx_cache"] } });
    await request.post("/test/seed", { data: { fixtures: { fx_cache: [...] } } });
  });

  test.afterAll(async ({ request }) => {
    // Restore baseline so subsequent flows see clean state
    await request.post("/test/cleanup", { data: { tables: ["fx_cache"] } });
    await request.post("/test/seed-baseline", { data: {} });
  });

  test("walks ... interaction(s) deterministically", ...);
});
```

For `kind: "empty"`: only the cleanup half emits + the afterAll restores baseline.
For `kind: "baseline"`: nothing emits (current behavior).

### Phase C — Stack-skill `/test/seed` + `/test/cleanup` are already the contract

Per bug-042 Phase A.5, all 3 backend skills already document the 3-endpoint contract (`/test/seed`, `/test/cleanup`, `/test/seed-baseline`). This plan doesn't add new endpoints; it just exercises existing ones from the synthesizer side.

But: the `/test/seed` endpoint's bulk-insert MUST handle partial fixtures (e.g. seeding ONLY `fx_cache` without `accounts` should not fail FK constraints). Audit the 3 stack skills' implementations + tighten if needed.

### Phase D — `/user-flows-generator` SKILL.md guidance

When authoring a flow whose first interaction expects state contradicting the baseline, the generator must populate `requiredState` instead of authoring the interaction to match the baseline. Examples in SKILL.md:

- Empty-state flow: "First-time" / "Onboarding" / "Welcome" naming triggers `kind: "empty"`
- Stale-data flow: "Offline" / "Stale" / "Outdated" narrative triggers `kind: "custom"` with old-timestamp fixtures
- Different-name flow: only `kind: "custom"` if the spec deliberately tests a different account name; otherwise the flow should match the baseline naming for consistency

### Phase E — Empirical re-validation against finance-track-01

Once Phases A-D land:

1. Re-author flow-1, flow-8, flow-9 manifest entries with `requiredState` per the table above
2. Run synthesizer → emit per-flow seeding hooks
3. Run E2E suite → all 3 mismatch failures should clear

This is project-side recovery work. Track separately as `bug-Xxx` in finance-track-01 once factory work is in.

## Success Criteria

- [ ] Phase A: schema accepts the 3 `kind` variants with appropriate validation
- [ ] Phase B: synthesizer emits per-flow `beforeAll`/`afterAll` correctly for each kind; +3 regression tests
- [ ] Phase C: `/test/seed` endpoints in node-fastify, node-trpc-nest, python-fastapi handle partial-table fixtures cleanly
- [ ] Phase D: SKILL.md examples cover the 3 mismatch shapes (empty-state, stale-data, different-content)
- [ ] Phase E: finance-track-01 flows 1+8+9 pass after re-authoring

## Cross-references

- Parent: `plans/archive/bug-042-global-setup-baseline-only-seeds-fx-cache.md` — the baseline contract this builds on
- Sister: `bug-050` — closes the `seed-mismatch` primaryCause class with this plan's primitive
- Sister: `feat-049` — discriminator that fires bug-050's `seed-mismatch` classification
- Sister: `bug-073` (filed 2026-05-08) — reading-log-02 empirical instance of the
  same class; project-side recovery work tracks separately, factory fix is here
- `.claude/rules/testing-policy.md §Strategy-C-test-seed-contract` — the 3-endpoint contract this exercises
- Empirical: 3/9 finance-track-01 flow failures (flow-1, flow-8, flow-9) — the
  original motivating cases (2026-05-03)
- Empirical: 5/6 reading-log-02 flow failures (flow-2/3/4/5/6 fail; flow-1
  passes only because it CREATES the baseline state via add-book interaction;
  evidence captured 2026-05-08 mid /fix-bugs run b0e1281c) — confirms the
  defect class generalises beyond finance-track-01

## Empirical evidence — reading-log-02 (2026-05-08)

Mid-/fix-bugs run b0e1281c, after feat-062 (pure-verify routing) +
investigate-019 M-F (per-agent MCP scoping) shipped, /fix-bugs auto-filed
6 flow-failure bugs (bug-flow-flow-1..6). Builders dispatched per
feat-062's `[web-frontend-builder]` 1-agent sequence. Outcome at
attempts:1-2:

| Bug                  | Status      | Why                                                                                                                                                                              |
| -------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bug-flow-flow-1-null | ✅ resolved | flow-1 ("First-time setup") creates "The Overstory" via the add-book form; doesn't depend on baseline seed                                                                       |
| bug-flow-flow-2-null | ❌ pending  | spec opens `role=link[name=/The Overstory/i]` — book missing from baseline `apps/api/db/seed.ts`; only flow-1 creates it; cross-spec data residue is non-deterministic           |
| bug-flow-flow-3-null | 🔄 att 3    | builder added "Project Hail Mary" to baseline seed for the "Edit notes" flow (commit 6bc7528 fix(seed): add Project Hail Mary to baseline seed for flow-3 E2E) — right direction |
| bug-flow-flow-4-null | ❌ pending  | spec navigates to `/?q=overstory` — same book absence as flow-2                                                                                                                  |
| bug-flow-flow-5-null | 🔄 att 1    | "Delete book" — needs a deletable book; same shape                                                                                                                               |
| bug-flow-flow-6-null | 🔄 att 1    | "Settings and tag management" — needs a tag to rename                                                                                                                            |

Empirical signature confirms feat-050's hypothesis: the synthesizer
emits specs assuming baseline contains the books/tags they reference,
but the manifest has no `requiredState` field, so the
user-flows-generator never declared what state each flow needs, and
the seeder operates blind. Each builder is independently
re-discovering this and adding 1 book to baseline `seed.ts` — but
those changes converge on a single fixup branch with merge ordering
that loses some additions.

**Failure-mode taxonomy** observed in reading-log-02 confirms the
3-kind variant set is sufficient:

- `kind: "empty"` — flow-1 ("First-time setup") wants empty library
- `kind: "baseline"` — flow-3 ("Edit notes") would work if baseline
  had a book to edit — needs the seeder to know which book
- `kind: "custom"` — flow-9-style ("Offline resilience") not present
  in reading-log-02 but the schema variant covers it

**Quantitative impact**: at /fix-bugs convergence-time, 5 of 6
flow-failure bugs were unresolvable per-bug because the structural
fix is upstream (manifest authoring + synthesizer emission). Each
unresolvable bug costs ~3× attempts × ~10min = 30 min/bug =
**~2.5 hr wasted per /fix-bugs run on this class**.

Attempt-3 spend on these bugs is pure-loss compute; until feat-050
ships, the orchestrator retry ladder cannot make forward progress
on this defect class.
