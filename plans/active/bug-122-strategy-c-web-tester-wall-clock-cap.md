---
id: bug-122-strategy-c-web-tester-wall-clock-cap
type: bug
status: approved
author-agent: human
created: 2026-05-18
updated: 2026-05-18
approved-at: 2026-05-18
parent-plan: bug-107-strategy-d-web-tester-wall-clock-cap
supersedes: null
superseded-by: null
branch: fix/strategy-c-web-tester-wall-clock-cap
affected-files:
  - orchestrator/src/model-config.ts
  - orchestrator/tests/model-config.test.ts
feature-area: orchestrator/wall-clock-cap
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "feat-scaffold tester on gotribe-member-profile (persistence_layer=real-db) hit error_stall_timeout: wall-clock-1200000ms — bug-107's class-discriminator only matches external-api-only, not real-db. Strategy-C web testers run the same synthesize-flow-e2e + Playwright workload as Strategy-D web testers and need the same 30-min cap."
reproduction-steps: |
  1. Create a project with architecture.yaml.tooling.stack.{persistence_layer:"real-db", web_framework:"react-next"}.
  2. Run /start-build under tight rate-limit conditions (five_hour bucket ≥85%).
  3. Tester step on any feature with a web tier hits the 20-min stall-timeout cap.
  Empirical: gotribe-member-profile feat-scaffold tester 2026-05-17 — 2 attempts × 20 min, $3.01 burned.
stack-trace: null
---

# bug-122: Extend bug-107's tester wall-clock-cap discriminator to Strategy-C web testers

## Bug Description

`orchestrator/src/model-config.ts:227-238` `resolveDefaultStallTimeout` bumps the tester cap from 20min to 30min ONLY when `persistence_layer === "external-api-only"` AND `web_framework !== null` (Strategy D). Strategy-C web projects (`persistence_layer === "real-db"`) still get the 20-min default despite running the same synthesize-flow-e2e + Playwright + edge-case unit test + coverage workload.

Empirical case (2026-05-17 gotribe-member-profile feat-scaffold):

- architecture.yaml: `persistence_layer: "real-db"`, `web_framework: "react-next"`
- Tester step on feat-scaffold hit `error_stall_timeout: wall-clock-1200000ms` on both attempts
- 5 consecutive "no SDK message in 96-117s" warnings — same rate-limit-pressure signature as gotribe-tribe-directory's bug-107 empirical case
- Cost: $3.01 burned

The bug-107 author scoped to Strategy-D because the original empirical case (gotribe-tribe-directory) was Strategy-D. But the structural diagnosis (web tester workload exceeds 20min under rate-limit pressure) applies symmetrically to Strategy-C web. The synthesizer + Playwright + coverage runs are identical between strategies; only the data-seeding shape differs (page.route mocks vs /test/seed-baseline). Both contribute the same ~10-15min of synthesis + test-run wall-clock.

## Reproduction Steps

1. Set up `projects/<p>/.claude/architecture.yaml` with `tooling.stack: { persistence_layer: "real-db", web_framework: "react-next" }`.
2. Run `pnpm --filter orchestrator start generate <p> --resume-feature-graph` against a feature with a tester step.
3. Tester dispatch resolves stall-timeout to 20 \* 60 \* 1000 ms (the default), not 30min.
4. Under rate-limit pressure (five_hour bucket ≥85%), tester hits the cap before completing.

## Error Output

From gotribe-member-profile Mode B retry 2026-05-17 (run-id `2b07c387-bc4e-4bf6-a325-1e4a973106ec`):

```
[runLlmAgent] tester on feat-scaffold: no SDK message in 96-116s (×5)
[runLlmAgent] rate-limit warning: five_hour at 90% — pausing soon

✗ feat-scaffold — task scaffold-tests failed after 2 attempts:
                  error_stall_timeout: wall-clock-1200000ms
```

## Root Cause Analysis

`orchestrator/src/model-config.ts:223-238`:

```ts
function resolveDefaultStallTimeout(
  agentName: string,
  projectRoot: string,
): number | null {
  if (agentName === "tester") {
    const arch = readArchStackContext(projectRoot);
    if (
      arch &&
      arch.persistenceLayer === "external-api-only" && // ← bug-107 scope
      arch.webFramework !== null
    ) {
      return STRATEGY_D_WEB_TESTER_STALL_TIMEOUT;
    }
  }
  return DEFAULT_STALL_TIMEOUT_BY_AGENT[agentName] ?? null;
}
```

The `persistenceLayer === "external-api-only"` check is the narrow scope. `real-db` (Strategy C) is structurally equivalent for the tester's workload but routes to the 20-min default.

Strategy-A (`localStorage`) is correctly excluded — kanban-class web testers don't run the synthesizer + Playwright dispatch chain and DO fit in 20min per the bug-107 investigation's own framing.

## Fix Approach

### Phase A — extend the discriminator (10-line change)

`orchestrator/src/model-config.ts:227-238`:

```ts
function resolveDefaultStallTimeout(
  agentName: string,
  projectRoot: string,
): number | null {
  if (agentName === "tester") {
    const arch = readArchStackContext(projectRoot);
    const isSynthesizerWorkloadLayer =
      arch &&
      (arch.persistenceLayer === "external-api-only" ||
        arch.persistenceLayer === "real-db");
    if (isSynthesizerWorkloadLayer && arch.webFramework !== null) {
      return STRATEGY_D_WEB_TESTER_STALL_TIMEOUT;
    }
  }
  return DEFAULT_STALL_TIMEOUT_BY_AGENT[agentName] ?? null;
}
```

Constant name `STRATEGY_D_WEB_TESTER_STALL_TIMEOUT` is preserved for git-blame stability; a follow-up rename to `WEB_TESTER_STALL_TIMEOUT_SYNTHESIZER` may happen later but is non-essential.

### Phase B — update existing test + add Strategy-A test

`orchestrator/tests/model-config.test.ts:455-466` currently asserts Strategy-C web tester keeps 20-min default. Flip the assertion to expect 30-min. Add a new test that Strategy-A (`localStorage`) web tester DOES keep the 20-min default (the negative case proving we didn't over-extend).

### Phase C — empirical re-test (deferred)

After this ships, re-run gotribe-member-profile from the Mode A snapshot. Expect feat-scaffold's tester to complete within the new 30-min cap (or fail for a different reason — that's a different bug).

## Rejected Fixes

- **Per-project override in models.yaml** — Rejected: pushing the burden onto every Strategy-C project's operator defeats the purpose of class-discrimination. The whole point of bug-107 was to NOT require per-project overrides for an empirically-known workload class.
- **Bump global default to 30min** — Rejected: backend testers + Strategy-A web testers do fit in 20min; bumping global wastes wall-clock budget for them.
- **Ship R2 (rate-limit pre-flight gate) as the fix** — Considered. R2 is a defensive defense-in-depth that addresses the proximate cause (rate-limit pressure made tester slow) rather than the structural cause (cap too tight for the workload). R2 is a separate bug if/when we ship it; this bug is scoped to cap-extension.

## Validation Criteria

- [ ] `resolveDefaultStallTimeout` discriminator extended to match `real-db` OR `external-api-only` (when `web_framework !== null`).
- [ ] Test at `model-config.test.ts:455` flipped to expect 30-min for Strategy-C web tester.
- [ ] New test added confirming Strategy-A (`localStorage`) web tester keeps 20-min default.
- [ ] Full orchestrator test suite passes.
- [ ] (Deferred — Phase C) gotribe-member-profile retry: tester step completes (or fails for a different reason).

## Cross-references

- **Parent**: `plans/archive/bug-107-strategy-d-web-tester-wall-clock-cap.md` — the original bug-107 shipped 2026-05-15 with Strategy-D-only scope. This bug extends it to Strategy-C.
- **Grandparent**: `plans/active/investigate-031-tester-wall-clock-strategy-d-web.md` — the investigation that surfaced both bug-107 and (implicitly) this bug. The investigation's R1 recommendation was Strategy-D-only because the empirical anchor was Strategy-D; bug-122 empirically validates the structural diagnosis applies to Strategy-C too.
- **Empirical case**: gotribe-member-profile Mode B retry 2026-05-17, run-id `2b07c387-bc4e-4bf6-a325-1e4a973106ec`. Cost: $3.01 burned on 2 stall-timeout attempts.

## Attempt Log

<!-- populated as the fix is made -->
