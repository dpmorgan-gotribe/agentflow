---
id: bug-104-bug-095-seed-baseline-404-during-verifier
type: bug
status: draft
author-agent: human
created: 2026-05-13
updated: 2026-05-13
parent-plan: feat-066-fix-loop-effectiveness-v2 (v2-Phase-4)
supersedes: null
superseded-by: null
branch: fix/bug-095-seed-baseline-404
affected-files:
  - orchestrator/src/build-to-spec-verify.ts
  - orchestrator/src/dev-server.ts
feature-area: verifier/seed-baseline
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "bug-095's POST /test/seed-baseline call (between flow-execution and visual tiers) returns 404 during /build-to-spec-verify runs, even when the same endpoint returns 204 when invoked from curl outside the verifier. Result: Tiers 4+5 still observe post-cleanup DB pollution. bug-095's defensive empirical fix landed but is functionally a no-op in the verifier context."
reproduction-steps: "1. Boot reading-log-02 dev-servers (pnpm run dev or operator equivalent). 2. Confirm curl POST /test/seed-baseline returns 204. 3. Run /build-to-spec-verify on the project. 4. Inspect output warnings: 'bug-095: seed-baseline restore at http://localhost:3001/test/seed-baseline returned 404 — Tier 4+5 may observe post-cleanup DB state'. 5. Inspect Tier 4+5 findings: still polluted with '404 / no API / empty DB' artefacts."
stack-trace: null
---

# bug-104: bug-095's seed-baseline restore call 404s during verifier despite endpoint being reachable externally

## Bug Description

bug-095 (shipped commit `dbfccb8`) added a `POST /test/seed-baseline` call to `build-to-spec-verify.ts` between flow-execution (Tier 3) and the visual tiers (Tier 4 + 5) to restore DB state polluted by flow-execution's cleanup beforeAll. The fix:

1. Reads `sharedDevServerHandle.backendUrl` (canonically `http://localhost:3001` for node-fastify Strategy-C projects)
2. Constructs `${backendUrl}/test/seed-baseline`
3. Fires POST + soft-warns on non-2xx

Empirical 2026-05-13 verifier run (b18vw2rdn, 18 min):

```
warnings:
  dev-server: pre-booted at http://localhost:3000 (took 60ms)
  flow-execution: dev-server: pre-booted by caller at http://localhost:3000 (bug-071 fix path)
  bug-095: seed-baseline restore at http://localhost:3001/test/seed-baseline returned 404 — Tier 4+5 may observe post-cleanup DB state
```

Right BEFORE + AFTER this verifier run, `curl -X POST http://localhost:3001/test/seed-baseline` returns 204. So the endpoint exists + is reachable. But during the verifier window, it returned 404.

Tiers 4+5 then captured the polluted post-cleanup state + filed 14 perceptual + 5 walkthrough findings, ALL of which trace to the empty DB ("book detail 404", "CORS failure", "no API calls initiated", "no focusable elements"). bug-095's intended outcome — clean visual-tier captures against canonical seed data — did NOT happen.

## Root Cause Hypotheses

**H1 — dev-server pre-boot doesn't actually start the API tier**: the 60ms pre-boot timing screams "reuse existing process" path. But the dev-server.ts code might only reuse the FRONTEND (port 3000), spawning its OWN backend on 3001. The spawned backend may inherit a different env where ENABLE_TEST_SEED=0 (or unset), so /test/\* routes aren't registered → Fastify default 404.

**H2 — port collision**: if the verifier's spawned backend tries to bind :3001 but the operator's pre-existing API is already on :3001, Fastify might fail silently OR the verifier's backend might bind to a DIFFERENT port + dev-server.ts records that different port as `backendUrl` — except the warning explicitly says `:3001`, so this is unlikely.

**H3 — Playwright webServer block races the orchestrator**: `playwright.config.ts` has its own webServer block that spawns the API with `env: { ENABLE_TEST_SEED: "1" }`. If Playwright's flow-execution stage spawns the backend differently than the orchestrator's pre-boot, the backendUrl the orchestrator records may NOT correspond to the process Playwright is using during flow-execution. By the time bug-095 fires the fetch (after flow-execution finishes), the Playwright-spawned backend may have been torn down + only a half-state remains.

**H4 — race between cleanup-completion and seed-baseline-call**: flow-execution's beforeAll cleanup hits /test/cleanup. If the response sequence is `cleanup-204 → API process restarts (HMR or env reload) → during restart bug-095's POST hits 404 → API finishes restart → curl in test now succeeds`, we'd see exactly this pattern.

**H5 — env propagation issue**: the orchestrator's dev-server.ts spawns the API child process with a specific env object. If that env object lacks ENABLE_TEST_SEED=1, the spawned process doesn't register /test/\* routes. The .env file's value doesn't matter — the spawn env overrides it.

## Diagnostic Steps

**Step 1 — verify which process is responding on :3001 during the verifier window**:

Add a one-shot diagnostic to `build-to-spec-verify.ts`'s bug-095 fetch path. BEFORE the seed-baseline POST, fire `GET /health` to the same backendUrl + log the response. If health returns 200, the API is up. Compare against the seed-baseline 404: it's a routes-not-registered issue.

**Step 2 — check the env propagation**:

In `orchestrator/src/dev-server.ts`, find the API-spawn code path. Verify the env passed to the child process includes `ENABLE_TEST_SEED: "1"`. If not, fix.

**Step 3 — confirm hypothesis via single-call trace**:

Run the verifier with `DEBUG=*` (or equivalent for the orchestrator's child-process spawn). Capture the API process's stdout/stderr. Look for "test-seed routes registered" log line (Fastify's plugin-load log). If absent, ENABLE_TEST_SEED wasn't `=1` in the spawn env.

## Fix Approach

Likely fix per H5 (env propagation): in `orchestrator/src/dev-server.ts` when spawning the API child process, explicitly set `ENABLE_TEST_SEED=1` in the env object. This mirrors what `playwright.config.ts`'s webServer block does and ensures the orchestrator's spawned backend matches the test-seed contract regardless of the project's `.env` state.

```ts
// In dev-server.ts, near the API spawn:
const apiEnv = {
  ...process.env,
  ENABLE_TEST_SEED: "1", // bug-104: verifier's pre-booted API MUST register /test/* routes
};
spawn(apiCommand, apiArgs, { env: apiEnv, ... });
```

## Validation Criteria

- [ ] Re-run /build-to-spec-verify on reading-log-02. Confirm the seed-baseline warning either disappears OR changes to "returned 204".
- [ ] Confirm Tier 4 + 5 findings drop the "404 / no API / empty DB" pollution class.
- [ ] Confirm the curl smoke (POST /test/seed-baseline returns 204) still passes outside the verifier.

## Cross-references

- **bug-095** — in-loop verifier DB pollution. bug-104 is the empirically-discovered follow-up: bug-095's fix landed correctly but its dependency (a responsive /test/seed-baseline endpoint) doesn't hold in the verifier context.
- **bug-097** — scaffold .env=1 default. bug-097 fixes the EXAMPLE template; bug-104 fixes the verifier's spawn env which may not read .env at all.
- **bug-052** — apiBase regression. The browser-side analog of this server-side spawn-env issue.

## Attempt Log

<!-- Populated by executing agents. -->
