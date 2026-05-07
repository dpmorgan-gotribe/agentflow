---
id: bug-067-playwright-webserver-timeout-strategy-c
type: bug
status: completed
author-agent: human
created: 2026-05-07
updated: 2026-05-07
parent-plan: bug-062-strategy-c-dev-server-timeout
supersedes: null
superseded-by: null
branch: fix/playwright-webserver-timeout-strategy-c
affected-files:
  - .claude/skills/agents/front-end/react-next/SKILL.md
  - projects/reading-log-01/apps/web/playwright.config.ts
  - scripts/run-synthesized-flows.mjs
feature-area: orchestrator/parity-verify
priority: P0
attempt-count: 1
max-attempts: 5
error-message: |
  bug-062 extended runSynthesizedFlows's pre-flight wait timeout from
  60s to 180s for Strategy C projects. But playwright has its OWN
  webServer.timeout in apps/web/playwright.config.ts (currently 120s
  per cb050f2). When backend cold-boot >120s, playwright's webServer
  block fails to spawn → 0 tests run → webServerTimedOut heuristic
  fires → dev-server-compile bug filed even though bug-062 said the
  runner waited longer. TWO independent timeouts; bug-062 only
  addressed one.
reproduction-steps: |
  1. /fix-bugs against any Strategy C project on Windows.
  2. Backend cold-boot takes 60-150s (Prisma migrate + pnpm + fastify).
  3. runSynthesizedFlows spawns playwright; playwright spawns its own
     dev-server processes per webServer block (timeout: 120_000).
  4. If backend takes >120s, playwright webServer fails → 0 tests run.
  5. webServerTimedOut heuristic in run-synthesized-flows.mjs:276 fires.
  6. dev-server-compile bug filed with hardcoded "within 60s" remediation
     text (also misleading — actual timeout is 120s, not 60s).
stack-trace: null
---

# bug-067: Playwright webServer.timeout doesn't extend with bug-062 + hardcoded 60s remediation text

## Bug Description

Two timeouts gate Strategy C dev-server boot:

1. **Runner pre-flight** (`runSynthesizedFlows.devServerTimeoutMs`) —
   bug-062 extended 60s → 180s for `persistence_layer === "real-db"`
2. **Playwright webServer** (`playwright.config.ts.webServer.timeout`)
   — STILL 120s (set by cb050f2 cherry-pick, hardcoded)

When playwright spawns its own dev-server (per its `webServer` block),
it enforces its OWN 120s timeout. If backend takes >120s on cold-boot,
playwright fails. bug-062's runner extension doesn't help.

Plus separate misleading-text issue: `run-synthesized-flows.mjs:340`
hardcodes `"within 60s"` in the remediation message. Even when timeout
is 120s or 180s, operators see "60s" — confusing.

Empirical: reading-log-01 bk0g13gk1 (2026-05-07 ~01:00) — verifier
filed dev-server-compile bug DESPITE bug-062 being shipped. Root cause
hypothesis: playwright's 120s fired, not the runner's 180s.

## Reproduction Steps

See frontmatter.

## Error Output

```yaml
- id: bug-compile-tooling-pre-flight
  errorLog:
    - >-
      [verifier-captured-stderr] playwright webServer timed out — backend
      or frontend dev-server failed to bind port within 60s.
      ...
```

The "60s" is hardcoded text; actual is 120s (project's playwright config)
or 180s (bug-062's runner extension).

## Root Cause Analysis

### `apps/web/playwright.config.ts` (project-side)

```ts
{
  command: "pnpm --filter @repo/api dev",
  url: "http://127.0.0.1:3001/health",
  timeout: 120_000,  // ← independent of bug-062's runner extension
},
```

This timeout is enforced by playwright's own webServer subsystem when
playwright is launched. The runner's `devServerTimeoutMs` (bumped by
bug-062) is for pre-flight /health polling BEFORE playwright launches.

### `scripts/run-synthesized-flows.mjs:340` (factory-side)

```js
remediation: `playwright webServer timed out — backend or frontend
dev-server failed to bind port within 60s. ...`;
```

Hardcoded 60s in the remediation TEXT. Doesn't reflect either of the
actual timeouts.

## Fix Approach

### Phase A — react-next stack-skill template extension (1h)

`.claude/skills/agents/front-end/react-next/SKILL.md` §3a or wherever
the playwright.config.ts template lives — set `timeout: 180_000` for
both webServer entries when `architecture.yaml.tooling.stack.persistence_layer === "real-db"`.

Template variants:

- `localStorage` (Strategy A) → `timeout: 60_000` (default)
- `external-api-only` (Strategy D) → `timeout: 60_000` (no real backend)
- `real-db` (Strategy C) → `timeout: 180_000` (Prisma + pnpm + framework init)

### Phase B — interpolate timeout in remediation message (15min)

`scripts/run-synthesized-flows.mjs:340`:

```js
// BEFORE:
remediation: `... within 60s. ...`;

// AFTER:
remediation: `... within ~${Math.round(devServerTimeoutMs / 1000)}s
(runner pre-flight) AND playwright.config.ts webServer.timeout
(typically 120s default; 180s for Strategy C projects). ...`;
```

Calls out BOTH timeouts so operators know which to extend.

### Phase C — backfill reading-log-01 + tests (45min)

- Update `projects/reading-log-01/apps/web/playwright.config.ts` to
  use `timeout: 180_000`
- 2 new tests for the remediation message interpolation

## Validation Criteria

1. reading-log-01 next /fix-bugs run: dev-server-compile bug does NOT
   recur (assuming backend genuinely boots in <180s; if it doesn't,
   that's a real product issue not a verifier issue)
2. New react-next-scaffolded Strategy C projects ship with 180s
   webServer timeout
3. Remediation text shows actual timeout values

## Rejected Fixes

- **PLAYWRIGHT_WEBSERVER_TIMEOUT env var**: playwright.config.ts can read
  it but operators have to know to set it; template is the right
  primary lever.
- **Just bump unconditionally to 180s**: penalizes Strategy A/D
  projects with longer fail-fast time. Conditional on persistence_layer
  is correct.

## Cross-references

- `bug-062` — runner pre-flight timeout extension (this bug closes
  the second of two timeouts)
- `react-next` SKILL.md — template scaffold

## Attempt Log

(implementation in progress)
