---
id: bug-070-globalsetup-port-resolution-and-env-var-name
type: bug
status: completed
author-agent: human
created: 2026-05-07
updated: 2026-05-07
parent-plan: bug-069-backend-cold-boot-exceeds-180s-strategy-c
supersedes: null
superseded-by: null
branch: fix/globalsetup-port-resolution-and-env-var-name
affected-files:
  - .claude/templates/playwright-global-setup.ts.template
  - projects/reading-log-01/apps/web/playwright/global-setup.ts
feature-area: orchestrator/strategy-c-seed-wiring
priority: P0
attempt-count: 1
max-attempts: 5
error-message: |
  apps/web/playwright/global-setup.ts hits port 8000 (Python FastAPI
  default) for ALL Strategy C projects regardless of backend stack.
  Plus reads `NEXT_PUBLIC_API_BASE_URL` (with `_URL` suffix) when the
  canonical env var per react-next + architect SKILLs is
  `NEXT_PUBLIC_API_BASE` (no suffix). Result: ECONNREFUSED on every
  globalSetup run for node-fastify projects (the majority Strategy C).
reproduction-steps: |
  1. Strategy C node-fastify project (e.g. reading-log-01) sets
     apps/web/.env.local NEXT_PUBLIC_API_BASE=http://localhost:3001
  2. Spawn playwright with backend pre-booted on :3001 + reuseExistingServer:true
  3. globalSetup runs, walks env chain:
     - SEED_BASE_URL: undefined
     - API_BASE_URL: undefined
     - NEXT_PUBLIC_API_BASE_URL: undefined ← MISMATCH (canonical is NEXT_PUBLIC_API_BASE)
     - falls through to "http://127.0.0.1:8000" ← Python default
  4. POST /test/seed-baseline → ECONNREFUSED 127.0.0.1:8000
  5. globalSetup fails → playwright suite fails → 0 tests run
stack-trace: |
  Error: apiRequestContext.post: connect ECONNREFUSED 127.0.0.1:8000
    Call log:
      - → POST http://127.0.0.1:8000/test/seed-baseline
        - user-agent: Playwright/1.59.1 (x64; windows 10.0) node/22.18
        - accept: */*
        - content-type: application/json
        - content-length: 2
---

# bug-070: globalSetup port-resolution falls through to Python default + env-var name mismatch

## Bug Description

Two issues in `apps/web/playwright/global-setup.ts` (and the
`.claude/templates/playwright-global-setup.ts.template` it's generated
from):

1. **Variable name mismatch**: chain checks `NEXT_PUBLIC_API_BASE_URL`
   but canonical env var is `NEXT_PUBLIC_API_BASE` (no `_URL` suffix —
   see react-next SKILL.md line 49, architect SKILL.md §7b). Apps' own
   `apps/web/.env.local` files set `NEXT_PUBLIC_API_BASE` per the
   contract, but globalSetup never reads it.

2. **Hardcoded Python default**: fallback is `http://127.0.0.1:8000`
   which only fits python-fastapi backends. node-fastify (3001),
   node-trpc-nest (3001), node-express (varies) all fail with this.

Combined effect: globalSetup hits port 8000 on every Strategy C
node-\* project → ECONNREFUSED → globalSetup throws → playwright
suite fails to start. This was masked by bug-067/069's webServer
timeout firing first; only surfaced empirically after pre-booting
backend manually.

## Reproduction Steps

See frontmatter.

## Empirical evidence

reading-log-01 2026-05-07 b3alrlt19 diagnostic (per bug-069 Step 2b):

```
[diag] backend up=true at +3.1s
[diag] spawning playwright at +3.1s
[diag] playwright exit=1 in 6.5s
[diag] tests parsed: {
  "errMsgs": ["Error: apiRequestContext.post: connect ECONNREFUSED 127.0.0.1:8000\n
                Call log: → POST http://127.0.0.1:8000/test/seed-baseline"]
}
```

Backend on :3001, globalSetup hits :8000 → fail.

## Fix Approach

Updated chain (in order of preference):

```ts
const seedBase =
  process.env.SEED_BASE_URL ?? // explicit operator override
  process.env.NEXT_PUBLIC_API_BASE ?? // canonical react-next env (NEW)
  process.env.API_BASE_URL ?? // alternate alias
  process.env.NEXT_PUBLIC_API_BASE_URL ?? // legacy alias (kept for back-compat)
  (typeof signal.backendPort === "number" // synthesizer-supplied port (NEW)
    ? `http://127.0.0.1:${signal.backendPort}`
    : "http://127.0.0.1:3001"); // last-resort node-* default (was 8000)
```

### Phase A — template fix (shipped this session)

`.claude/templates/playwright-global-setup.ts.template` line 53-57 updated.

### Phase B — project backfill (shipped this session)

`projects/reading-log-01/apps/web/playwright/global-setup.ts` updated
inline so reading-log-01's next /fix-bugs run benefits without
re-running architect.

### Phase C — synthesizer extension (DEFERRED)

`scripts/synthesize-flow-e2e.mjs` writes `apps/web/playwright/required-baseline.json`
for Strategy C. Should ALSO write `backendPort: <int>` derived from
`architecture.yaml.tooling.stack.backend_framework` (3001 for node-\*,
8000 for python-fastapi) so globalSetup can use that as a stack-aware
default before the last-resort 3001. Defer to follow-up; current fix
already unblocks via the env-var chain.

## Validation Criteria

1. Pre-booted-backend playwright run on reading-log-01 hits
   `http://127.0.0.1:3001/test/seed-baseline` (not 8000) → 200/404 (200
   if endpoint registered with ENABLE_TEST_SEED=1; 404 if not — but no
   ECONNREFUSED).
2. After bug-070 + bug-067 + bug-062 ship together, full /fix-bugs
   /verify run on reading-log-01 reaches the e2e flow execution layer
   (Layer 2 from investigate-021 framing) — synthesized specs actually
   run instead of failing in pre-flight.

## Cross-references

- `bug-067` — playwright webServer.timeout extension (closes the
  120s/180s timeout layer; bug-070 closes the seed-port layer)
- `bug-071` (drafted) — playwright webServer spawning produces 0 bytes;
  separate mystery, deferred pending bug-070 re-validation
- `bug-069` (parent investigation) — overall Strategy C cold-boot wall

## Attempt Log

### Attempt 1 (2026-05-07) — shipped + empirically validated

Template + project both patched. Validated end-to-end via diagnostic
(`_tmp-pw-bug070-validate.mjs`):

**Pre-fix (b3alrlt19)**:
```
playwright exit=1 in 6.5s
errMsgs: ["ECONNREFUSED 127.0.0.1:8000"]
```

**Post-fix (b2ejgj6yu, with ENABLE_TEST_SEED=1 + bug-070 patches)**:
```
playwright exit=1 in 40.5s
stats: { unexpected: 6, expected: 0 }
errorsCount: 0
suitesCount: 6
```

**6 synthesized e2e specs ACTUALLY RAN** against the real backend.
First time Strategy C's full Layer 2 (synthesized e2e flow execution)
has worked end-to-end. backend stdout shows real test traffic:
- POST /test/cleanup → 204 (per-flow cleanup)
- POST /test/seed-baseline → 204 (read-only baseline seeded — bug-070
  port resolution working)
- GET /books/NaN → 404 (synthesizer's [id] substitution coerced to NaN;
  real product gap to investigate later)

The 6 unexpected failures are genuine product-signal — actual flow
assertions failing on real UI state, not infrastructure errors. This
is exactly the signal the verifier was designed to surface.

bug-070 closed. Remaining unblock: bug-071 (playwright webServer
auto-spawn 0-byte mystery) is the only thing keeping fully-autonomous
/fix-bugs from working without operator pre-boot.
