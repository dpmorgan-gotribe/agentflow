---
id: bug-069-backend-cold-boot-exceeds-180s-strategy-c
type: bug
status: draft
author-agent: human
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

(empty — drafted; deferred pending Step 1+2 diagnostics. Currently
running run b2uq26kxj will produce another data point.)
