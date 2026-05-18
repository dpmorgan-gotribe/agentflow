---
id: feat-076-ws-aware-e2e-stack-skill-blocks
type: feature
status: draft
author-agent: claude-opus-4-7
created: 2026-05-18
updated: 2026-05-18
parent-plan: null
supersedes: null
superseded-by: null
branch: feat/ws-aware-e2e-stack-skill-blocks
affected-files:
  - .claude/skills/agents/front-end/react-next/SKILL.md
  - .claude/skills/agents/back-end/node-fastify/SKILL.md
  - .claude/rules/testing-policy.md
feature-area: factory/stack-skills/testing
priority: P1
attempt-count: 0
max-attempts: 5
error-message: |
  ✗ feat-channel-view — task channel-view-edge-tests failed after 2 attempts: error_stall_timeout: wall-clock-1800000ms
---

# feat-076 — react-next + node-fastify stack-skills add §"E2E for WebSocket flows" canonical patterns

## Problem

When the tester is dispatched on a feature that involves WebSocket flows (real-time updates, presence, message streams), it has **no canonical pattern to copy from** for writing Playwright E2E specs. Vitest + WebSocket is a known-flaky combination (open sockets across tests, race conditions on connection lifecycle, etc.). Playwright + WebSocket requires either two-browser-context coordination OR an injection endpoint (`/test/ws-event` per gotribe-tribe-chat brief §17).

Without a canonical template, the tester:

1. Spends agent budget exploring the problem space
2. Authors partial specs that compile but hang (waiting for page state that doesn't arrive)
3. Hits stall-timeout (default 30 min wall-clock)
4. Frequently also triggers bug-024 violations (modifies source files trying to make imports compile)
5. Gets marked failed; cascade aborts downstream features

**Empirical:** gotribe-tribe-chat 2026-05-18 — `feat-channel-view` tester hit the 30-min wall-clock on BOTH attempts trying to author `channel-view.spec.ts` + `composer.spec.ts`. Cascade aborted `feat-presence-sidebar` + `feat-delete-message-modal`. Manual recovery required force-merge of builder's committed work + later authoring of the deferred E2E specs.

**Brief §20 explicitly flagged this as the curriculum signal** — first WS project the factory built. Now that the signal landed, the patterns should ship.

## Proposed fix

Two stack-skill §Testing block extensions:

### react-next §"E2E for WebSocket flows"

Add a subsection documenting **two canonical patterns**:

1. **Single-context with `/test/ws-event` injection (preferred for deterministic asserts)**

   ```ts
   // apps/web/e2e/channel-view.spec.ts
   import { test, expect, request } from "@playwright/test";

   test("incoming message:new updates the stream", async ({
     page,
     baseURL,
   }) => {
     await page.goto("/c/general");
     await expect(page.getByText("Connected")).toBeVisible();

     const ctx = await request.newContext();
     await ctx.post(`${baseURL}/test/ws-event`, {
       data: {
         channel: 1,
         event: "message:new",
         payload: {
           id: "999",
           channelId: 1,
           body: "hello from test",
           authorId: 1,
           authorName: "Test User",
           sentAt: new Date().toISOString(),
           deleted: false,
         },
       },
     });

     await expect(page.getByText("hello from test")).toBeVisible({
       timeout: 5000,
     });
   });
   ```

2. **Two-browser-context for end-to-end broadcast (preferred for "actual lifecycle works" asserts)**
   ```ts
   test("send-from-A appears in B", async ({ browser }) => {
     const ctxA = await browser.newContext();
     const ctxB = await browser.newContext();
     const pageA = await ctxA.newPage();
     const pageB = await ctxB.newPage();
     await Promise.all([pageA.goto("/c/general"), pageB.goto("/c/general")]);
     // ... await composer ready, type+submit in pageA, assert in pageB
     await ctxA.close();
     await ctxB.close();
   });
   ```

Document the **trade-off explicitly**: pattern (1) skips the server-side broadcast path but is deterministic; pattern (2) exercises the real lifecycle but is more flake-prone. Each project picks per flow.

### node-fastify §"E2E for WebSocket flows"

Document the **server-side contract** that makes pattern (1) work:

- `/test/ws-event` endpoint (gated on `ENABLE_TEST_SEED=1`) takes `{ channel, event, payload }` and broadcasts via the in-process subscriber Map
- Must validate channel existence (return 404 if unknown) — see bug-126's sibling fix
- Reference implementation: `gotribe-tribe-chat/apps/api/src/routes/test-seed.ts` `/ws-event` handler

### testing-policy.md

Add a §"WebSocket flows" subsection cross-referencing both stack-skill blocks. Set the canonical expectation: **at least one in-process integration test** (two `ws` clients in one Vitest run) + **at least one E2E** (pattern 1 OR 2) per WS-touching feature.

## Acceptance criteria

- [ ] `react-next/SKILL.md` §Testing has the §"E2E for WebSocket flows" subsection with both patterns
- [ ] `node-fastify/SKILL.md` §Testing has the matching `/test/ws-event` server contract
- [ ] `.claude/rules/testing-policy.md` cross-references both
- [ ] Smoke test: rerun the gotribe-tribe-chat `feat-channel-view` dispatch path with the updated stack-skill (in a future curriculum brief #10+) — tester completes within budget instead of stall-timeout

## Risk + rollback

- **Risk:** none — purely additive documentation. Existing projects without WS don't hit this code path.
- **Rollback:** revert the stack-skill edits.

## Cross-references

- **gotribe-tribe-chat** brief §17 + §20 — curriculum signal motivator
- **gotribe-tribe-chat** `feat-channel-view` 2026-05-18 stall — empirical evidence
- **bug-024** — tester forbidden source-file mods; tester's stall triggered bug-024 violations as a side-effect (stripped .js extensions trying to make imports compile)
- **feat-038** — `synthesize-flow-e2e.mjs` deepening; the synthesizer should eventually emit pattern (1) automatically when a flow's `interactions[]` includes a WS event
- **feat-039** — `kind: "mock"` interaction step; complementary mechanism for HTTP mocking that doesn't apply to WS
- **investigate-001** Q3 — original "hybrid TDD" decision; this plan refines the tester's tool-belt for WS without changing the policy
