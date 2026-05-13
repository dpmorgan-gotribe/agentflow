---
id: bug-094-delete-fires-multiple-times
type: bug
status: superseded
author-agent: human
created: 2026-05-13
updated: 2026-05-13
parent-plan: null
supersedes: null
superseded-by: bug-delete-content-type-400 (project plan; root cause re-attributed)
branch: fix/delete-fires-multiple-times
affected-files:
  - .claude/skills/agents/front-end/react-next/SKILL.md
  - projects/reading-log-02/apps/web/app/(shell)/books/[id]/page.tsx
feature-area: front-end/react-next
priority: P1
attempt-count: 0
max-attempts: 5
error-message: "single user click on the book-detail Delete button fires N DELETE requests to /books/<id> (witnessed 6× DELETE for one click on reading-log-02); each from a distinct TCP source port → React component is re-mounting or the click handler is attached without de-duplication"
reproduction-steps: "cd projects/reading-log-02 && pnpm --filter @repo/api db:seed (if DB empty) && node scripts/dev.mjs ; open http://localhost:3000 ; click any book → click the Delete button once ; tail apps/api logs ; observe N DELETE /books/<id> requests fired in <2s, each from a different remoteAddress port"
stack-trace: null
---

# bug-094: book-detail delete button fires 6× DELETE requests for one click (react-next stack-skill design gap)

## Bug Description

In reading-log-02 (and likely every react-next-stack project), clicking the Delete button on the book-detail page fires multiple DELETE requests to the backend instead of one. Empirical witness from the 2026-05-13 manual inspection:

```
[api] req-1o  DELETE /books/seed-book-3   t=1778657147727  remotePort=56137
[api] req-1p  DELETE /books/seed-book-3   t=1778657148172  remotePort=49264
[api] req-1q  DELETE /books/seed-book-3   t=1778657148375  remotePort=51835
[api] req-1r  DELETE /books/seed-book-3   t=1778657148535  remotePort=56626
[api] req-1s  DELETE /books/seed-book-3   t=1778657149017  remotePort=53822
[api] req-1t  DELETE /books/seed-book-3   t=1778657149267  remotePort=59486
[api] req-1u  DELETE /books/seed-book-3   t=1778657149551  remotePort=50520
```

**Seven DELETE requests in 1.83 seconds.** Each from a distinct TCP source port → genuinely independent HTTP requests (not connection-pool reuse). The same pattern repeated for seed-book-1 (~2×) and seed-book-2 (4×) during the inspection.

Server-side impact: the second-through-Nth DELETE return 404 (book already gone). UX-side: works because the first DELETE succeeds + the redirect-after-delete navigates away before the subsequent 404s manifest as visible errors. But this is wasteful + reveals an underlying handler-de-duplication bug + creates network noise that masks real issues.

**This is exactly the bug class feat-069 (AI walkthrough Tier 5) is designed to catch.** Static perceptual review (feat-068 Tier 4) wouldn't see it — the screenshot before + after looks identical. Only behavioral walkthrough that captures network traffic + counts duplicate requests can detect it.

## Reproduction Steps

1. `cd projects/reading-log-02`
2. `pnpm --filter @repo/api db:seed` (seed DB if empty — required since the bug surfaced post-migrate)
3. `node scripts/dev.mjs` — boots backend on :3001 + frontend on :3000
4. Open `http://localhost:3000` in browser
5. Click any book entry → land on book detail page
6. Click the Delete button ONCE
7. Tail `[api]` logs → observe N DELETE /books/<id> requests (1.5-2s span, each from a different remotePort)

## Error Output

```
$ # one user click fires this sequence:
[api] req-1o DELETE /books/seed-book-3  remotePort=56137
[api] req-1p DELETE /books/seed-book-3  remotePort=49264
[api] req-1q DELETE /books/seed-book-3  remotePort=51835
... (4 more)
```

(See Bug Description for the full 7-request capture.)

## Root Cause Analysis

Two plausible causes — investigation needed before fix:

### Hypothesis 1 — React StrictMode / dev-mode double-invocation

Next.js 15 + React 18+ runs effects + state-setters twice in dev mode to expose impure render functions. If the delete handler is attached via `useEffect` or `onClick` derived from a destructured + re-computed callback, StrictMode would fire it twice. But StrictMode only doubles — not 6×. So this is partial at best.

### Hypothesis 2 — Multiple fetcher subscriptions (likely primary cause)

The empirical capture shows requests from MANY distinct TCP source ports (56137, 49264, 51835, 56626, 53822, 59486, 50520 = 7 distinct ports). Each port is a separate fetch from a different HTTP client (or the same client but parallel). The pattern matches:

- A SWR / React Query / similar fetcher firing the delete mutation N times
- Each instance of the component listening to a "delete" event bus firing concurrently
- An effect that subscribes-on-mount + the component is mounted in N parallel React trees (e.g. modal + page + sidebar all show the delete button)

The earlier capture also showed `/books`, `/tags`, `/settings` fetched 6× in one navigation — same multiplication factor → strongly suggests fetcher-subscription multiplication, not user double-click.

### Hypothesis 3 — `data-kit-component` introspection layer

reading-log-02 uses `data-kit-*` attributes for parity-verify's DOM introspection. If the build tool or runtime renders the same component into multiple DOM positions (sidebar + detail + modal) for parity-verifier hooks, each instance attaches its own click handler.

### Likely root cause (combined): the project's data-fetching hook pattern + parity-verifier introspection together cause the same component to render N times, each attaching its own delete handler.

## Fix Approach

### Phase A — investigate (~1hr)

1. Open `projects/reading-log-02/apps/web/app/(shell)/books/[id]/page.tsx` + trace where the Delete button's onClick is wired. Count handler subscriptions.
2. Open `apps/web/lib/api-client.ts` or wherever fetch is centralized. Check for SWR/RQ multi-instance patterns.
3. Open `packages/ui-kit/src/patterns/custom/` for any pattern that wraps the book detail. Check for double-render.
4. Bisect: temporarily wrap the delete handler with a console.log + click once + count log lines.

### Phase B — narrow the fix to the root cause (~1-2hr)

Likely fixes per hypothesis:

- StrictMode + effect-handler: use `useRef` to memoize + guard the handler against re-attachment.
- Fetcher-subscription multiplication: ensure the mutation is scoped to ONE subscriber per page-mount (e.g. SWR's `mutate(key)` global broadcast issue — fix by passing `{ revalidate: false }` or scoping the key).
- data-kit-\* layer or duplicate rendering: lift the Delete button to the topmost component + share via context.

### Phase C — update react-next stack-skill (~30min)

If the root cause is a stack-skill design gap (e.g. the canonical scaffold's data-fetcher pattern produces this multiplication), update `.claude/skills/agents/front-end/react-next/SKILL.md` with the corrected pattern + a §Gotchas entry naming this empirical regression. This propagates the fix to every future react-next project.

### Phase D — empirical re-validation (~$0)

Re-run the manual inspection on reading-log-02:

1. Reboot dev server
2. Click delete on a book once
3. Confirm exactly ONE DELETE request fires
4. Confirm subsequent navigation produces ONE GET (not N)

### Phase E — file as a feat-069 Tier 5 walkthrough test case (deferred)

Once feat-069 ships, the AI walkthrough should include "click-delete-once-asserts-single-request" as part of every project's behavioral validation. This bug becomes its canonical motivator.

## Rejected Fixes

- **Debounce the delete handler client-side** — masks the underlying multi-render bug; the redundant network traffic still fires from the multi-subscriber pattern.
- **Add server-side idempotency-key handling** — addresses the SYMPTOM (network noise) but not the cause (UI handler de-duplication).
- **Disable React StrictMode** — would only fix StrictMode-related doubling (which is 2×, not 6×); deeper than this bug.

## Validation Criteria

- [ ] Root cause identified + documented in this plan's Attempt Log
- [ ] One click on Delete button fires exactly ONE DELETE request
- [ ] One navigation to a page fetches each endpoint exactly ONCE (the same multiplication pattern affects /books + /tags + /settings)
- [ ] If root cause is stack-skill design gap, react-next/SKILL.md is updated with the corrected pattern + §Gotchas callout
- [ ] Empirical re-validation on reading-log-02: clean network log on book-delete + book-navigation

## Cross-references

- **feat-069 (planned)** — AI walkthrough Tier 5. bug-094 is the canonical empirical motivator: this bug class (behavior multiplication) is exactly what walkthrough Tier 5 detects + static perceptual Tier 4 misses.
- **feat-068** — perceptual review. Demonstrably did NOT catch this bug across all reading-log-02 runs — screenshots before + after delete look identical regardless of how many requests fired.
- **feat-066 v2 epic** — empirical motivation. bug-094 surfaced during the Phase 1 empirical re-run's manual site inspection (2026-05-13).

## Attempt Log

### 2026-05-13 — empirical contradiction + supersede

Today's feat-069 B.3 empirical run (`buus3ajsj`) finally fired real DELETE requests through the walkthrough's delete-click helper after B.3 fixed the helper-ordering + render-aware-poll + confirm-dialog gaps. Network capture: **exactly 1 DELETE per click**, not 6. The "6× DELETE" witness in this plan's reproduction-steps could not be reproduced under controlled conditions.

What the empirical run DID surface:

- DELETE returned **HTTP 400** instead of 204, because `packages/api-client/src/index.ts` sends `Content-Type: application/json` on body-less DELETEs. Fastify rejects with 400 before the route handler runs → the resource is NEVER deleted → user sees "nothing happened on click."

This is a real P0 product bug. It was filed as `bug-delete-content-type-400` in the project (reading-log-02) and resolved by the /fix-bugs loop on 2026-05-13.

### Decision: supersede

The "6× DELETE" hypothesis in this plan was empirically wrong. The root cause of the user-visible "delete doesn't work" symptom was the Content-Type-on-body-less-DELETE bug, not handler multiplication. Closing this plan as `status: superseded` and pointing `superseded-by` at the project-side `bug-delete-content-type-400`.

If a future project DOES exhibit true handler multiplication (which would be a real react-next stack-skill issue), file a fresh bug plan with new evidence — don't re-open this one. The walkthrough's deterministic dup-detector now catches the pattern automatically: threshold ≥3 requests in one interaction step's time window, severity routes by count.
