---
id: bug-069-backend-cold-boot-exceeds-180s-strategy-c
type: bug
status: in-progress
author-agent: human
attempt-count: 1
created: 2026-05-07
updated: 2026-05-07
parent-plan: bug-067-playwright-webserver-timeout-strategy-c
supersedes: null
superseded-by: null
branch: fix/backend-cold-boot-exceeds-180s-strategy-c
affected-files:
  - projects/reading-log-01/apps/api/src/server.ts
  - projects/reading-log-01/apps/api/package.json
  - .claude/skills/agents/back-end/node-fastify/SKILL.md
  - scripts/run-synthesized-flows.mjs
feature-area: orchestrator/dev-server-boot
priority: P1
attempt-count: 0
max-attempts: 5
error-message: |
  Even after bug-067 extended playwright.config.ts webServer.timeout from
  120s to 180s, backend cold-boot STILL exceeds the budget on Windows.
  Empirical reading-log-01 b2uq26kxj (2026-05-07 ~01:55) — verifier filed
  bug-compile-tooling-pre-flight again with the new bug-067 message
  ("runner pre-flight wait was 180s; (b) playwright.config.ts webServer
  timeout..."). Captured stderr is empty, so we can't tell whether
  backend is slow-booting OR crashing.
reproduction-steps: |
  1. /fix-bugs reading-log-01 with bug-067 in place (180s playwright
     webServer timeout for both backend + frontend)
  2. Verifier spawns playwright; playwright spawns backend via
     `pnpm --filter @repo/api dev`
  3. Backend doesn't respond on /health within 180s → playwright's
     webServer block fails → 0 tests run → webServerTimedOut heuristic
     fires → dev-server-compile bug filed
  4. Last stderr: empty (playwright doesn't capture child stderr by
     default? OR backend doesn't write meaningful stderr before
     timing out)
stack-trace: null
---

# bug-069: Backend cold-boot still exceeds 180s on Windows for Strategy C

## Bug Description

bug-062 + bug-067 raised both timeouts (runner pre-flight + playwright
webServer) to 180s. Backend STILL exceeds the budget on Windows for
reading-log-01. Two possibilities — investigation needed:

**A. Slow boot**: Prisma migrate-on-boot, pnpm shell, fastify init,
Windows file-IO + AV scanning combine to push real boot time past 180s.
Mitigations: cache the prisma client, skip migrate when migration
state is fresh, use a faster pnpm invocation, opt out of AV scanning
for project dirs.

**B. Crash boot**: backend starts but throws a fatal error during
init (Prisma plugin import error, port collision, missing env var).
Playwright sees no /health response → fires webServer-timeout. The
backend's own stderr would tell us — but currently `Last stderr:` is
empty in the bug entry.

Need diagnostic data first.

## Reproduction Steps

See frontmatter.

## Investigation Steps

### Step 1 — Time backend cold-boot manually (10min)

Boot backend in isolation, time from start to /health response:

```bash
cd projects/reading-log-01
time (pnpm --filter @repo/api dev &
       SERVER_PID=$!
       while ! curl -sf http://localhost:3001/health; do sleep 1; done
       kill $SERVER_PID)
```

Result categorizes:

- < 30s: backend is fine, problem is elsewhere
- 30-180s: bug-067's 180s should have worked; check whether playwright's
  spawn is slower than direct (e.g. nested pnpm shell)
- 180-300s: real slow boot; bump timeouts further OR optimize boot
- Never responds: backend is crashing; capture stderr

### Step 2 — Capture playwright's child stderr (15min)

`scripts/run-synthesized-flows.mjs` currently uses default playwright
which doesn't surface webServer child stderr to the bug remediation.
Add a capture mechanism:

- Either: instrument playwright config to log webServer child stderr
  to a file
- Or: pre-flight backend in the runner (already does /health poll)
  but also capture stderr when backend exits

Real stderr would tell us crash vs slow-boot in one signal.

### Step 3 — Decide mitigation based on Steps 1+2

If slow-boot:

- Skip Prisma migrate-on-boot when migrations are up-to-date (current
  code calls execSync unconditionally)
- Cache compiled Prisma client across boots (avoid re-compile)
- Stack-skill node-fastify SKILL.md update with optimization guidance

If crash-boot:

- Surface the real error as the bug message
- Builder-builder dispatched with actual error context can fix

### Step 4 — Update bug-067 / scaffold defaults if needed

If 180s isn't enough universally for Strategy C on slow Windows machines,
bump to 240s or 300s. Document in stack-skill.

## Empirical anchor

reading-log-01 b2uq26kxj (2026-05-07 01:58):

```yaml
bug-compile-tooling-pre-flight:
  errorLog:
    - "[verifier-captured-stderr] playwright webServer timed out — ...
      Two timeouts apply: (a) runner pre-flight wait was 180s; (b)
      playwright.config.ts webServer.timeout governs playwright's own
      spawn-and-wait... Last stderr: "
```

Note: empty `Last stderr` — diagnostic gap.

Plus prior runs (b3zwmyp7a, blj30h576, bj2kqzj19, bk0g13gk1) all hit
the same wall — this isn't transient. Strategy C on Windows currently
can't get through Layer 2 (synthesized e2e) without manual operator
intervention to get the backend booting fast enough.

## Recommendation

After Step 1+2 data:

- If slow-boot dominant → ship `bug-070-prisma-migrate-skip-when-clean`
  and/or `feat-066-stack-skill-cold-boot-optimizations`
- If crash dominant → ship `bug-071-capture-playwright-webserver-stderr`
  to surface the real error so agents can fix

For the immediate reading-log-01 unblock:

- Operator can manually pre-boot backend (`node scripts/dev.mjs &`)
  before /fix-bugs runs; use `reuseExistingServer: !process.env.CI`
  semantics (already in playwright.config.ts) to reuse it.

## Cross-references

- `bug-062` — runner pre-flight timeout (closed)
- `bug-067` — playwright webServer timeout + remediation message (closed
  but doesn't actually unblock backend boot if it's >180s)
- `feat-038` Phase 0 (Strategy C definition) — first-ship project hits
  these issues for the first time

## Attempt Log

### Attempt 1 (2026-05-07) — Steps 1+2 done; root cause splits into TWO sister bugs

**Step 1 result — backend cold-boot is FAST manually (3.1s)**

Diagnostic script `_tmp-time-backend-boot.mjs` spawned `pnpm --filter @repo/api dev` from project root with `shell: true` (matches orchestrator's pattern):

```
[diag] starting backend at +0s
[diag] spawned pid=10904 at +0.0s
[diag] DONE booted=true total=3.1s exitCode=null

stdout (last 2KB):
  Prisma schema loaded from prisma\schema.prisma
  Datasource "db": SQLite database "reading-log.db" at "file:./data/reading-log.db"
  No pending migrations to apply.
  Server listening at http://127.0.0.1:3001
```

**Backend boots in 3.1 seconds. NOT slow-boot.** The original H1 (slow-boot)
hypothesis is REFUTED. Backend is fast; something else is going wrong.

**Step 2a — playwright spawn produces 0 bytes for 180s**

Diagnostic `_tmp-time-playwright-spawn.mjs` ran `pnpm -C apps/web exec
playwright test e2e/synthesized/ --reporter=json --project=chromium`
(EXACT command + spawn shape from `scripts/run-synthesized-flows.mjs:486`):

```
[diag] +15s — stdout=0b stderr=0b
[diag] +30s — stdout=0b stderr=0b
... (every 15s)
[diag] +180s — stdout=0b stderr=0b
[diag] DONE total=182.1s exit=1
```

Playwright JSON output:

```json
"errors": [{"message": "Error: Timed out waiting 180000ms from config.webServer."}]
```

Backend produced **0 bytes of output for 180s** when spawned by playwright's
webServer block. Mystery: same `pnpm --filter @repo/api dev` command boots in
3.1s when I spawn it from Node directly, but produces nothing when spawned
by playwright's webServer mechanism.

**Step 2b — pre-booted backend → playwright runs in 6.5s, surfaces NEW bug**

Diagnostic `_tmp-pw-with-prebooted.mjs` pre-booted backend manually (3.1s),
then ran playwright with `reuseExistingServer: !process.env.CI` honoring
the existing server. Playwright completed in **6.5 seconds** with this error:

```json
"errors": [{
  "message": "Error: apiRequestContext.post: connect ECONNREFUSED 127.0.0.1:8000\n
              - → POST http://127.0.0.1:8000/test/seed-baseline"
}]
```

**`apps/web/playwright/global-setup.ts` is hitting port 8000, not 3001.**
Backend is on 3001 (node-fastify); 8000 is the Python FastAPI default.

Read the global-setup template (line 53-57):

```ts
const seedBase =
  process.env.SEED_BASE_URL ??
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ?? // ← _URL suffix mismatch
  "http://127.0.0.1:8000"; // ← Python default for ALL Strategy C
```

Two issues:

1. **Variable name mismatch**: env-file uses `NEXT_PUBLIC_API_BASE` (no
   `_URL` suffix); per react-next stack-skill SKILL.md and architect
   SKILL.md §7b, this is the canonical name. globalSetup template looks
   for `NEXT_PUBLIC_API_BASE_URL` (with `_URL`) — never matches.
2. **Hardcoded Python default**: 8000 only fits python-fastapi backends.
   node-fastify (3001), node-trpc-nest (3001), node-express (varies) all
   fail with this fallback.

### Reframing — bug-069 splits into TWO sister bugs

**bug-070 (CONFIRMED + SHIPPED THIS SESSION)**: globalSetup port-resolution
fix.

- Add `NEXT_PUBLIC_API_BASE` to the env chain (BEFORE the legacy
  `NEXT_PUBLIC_API_BASE_URL`)
- Use stack-derived port from `signal.backendPort` (synthesizer-supplied)
  before falling back
- Last-resort fallback bumped from 8000 → 3001 (majority shape; Strategy C
  is currently 3:1 node-fastify : python-fastapi in shipped projects)
- Files: `.claude/templates/playwright-global-setup.ts.template` +
  `projects/reading-log-01/apps/web/playwright/global-setup.ts` (project
  backfill)

**bug-071 (REMAINING — DEEPER MYSTERY, DEFERRED)**: Why does backend produce
0 bytes when spawned by playwright's webServer block? Same `pnpm --filter
@repo/api dev` command, same shell, but:

- Direct Node spawn: 3.1s to /health, full stdout/stderr captured
- Via playwright webServer: 0 bytes for 180s, then timeout

Hypotheses for bug-071:

- Playwright suppresses webServer child stdout/stderr by default; the 0
  bytes is a CAPTURE issue, not a spawn issue. Backend may actually be
  starting but its output never reaches the parent.
- Playwright's webServer cwd is `apps/web/` (config dir), not project
  root. `pnpm --filter @repo/api` should still resolve via workspace,
  but maybe it doesn't on Windows under playwright's spawn semantics.
- pnpm's recursive-exec error at the end (`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL
Command "playwright" not found`) suggests `pnpm -C apps/web exec` is
  doing something weird with cwd / workspace resolution.

**Defer bug-071** since bug-070 is the more immediate impact (any
correctly-booted server hitting the wrong port = same failure shape as
"server doesn't boot"). After bug-070 ships, a clean re-fire will tell us
whether bug-071 is also blocking OR whether bug-070 alone unblocks Strategy C.

### Operator workaround (immediate)

For developers running `/fix-bugs` while bug-071 is unresolved: pre-boot
the backend manually via `node scripts/dev.mjs` from project root before
firing `/fix-bugs`. Playwright's `reuseExistingServer: true` will detect
the running backend + skip its own webServer spawn, going straight to
test execution (which now works post-bug-070).

### Cross-references

- `bug-070-globalsetup-port-resolution-and-env-var-name`: shipped this
  session; closes the seed-baseline ECONNREFUSED class
- `bug-071-playwright-webserver-spawn-zero-bytes`: drafted; deferred
  pending bug-070 empirical re-validation
