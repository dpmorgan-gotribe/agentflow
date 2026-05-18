---
id: feat-077-node-fastify-scaffold-canonical-error-handler
type: feature
status: draft
author-agent: claude-opus-4-7
created: 2026-05-18
updated: 2026-05-18
parent-plan: null
supersedes: null
superseded-by: null
branch: feat/node-fastify-error-handler-canonical
affected-files:
  - .claude/skills/agents/back-end/node-fastify/SKILL.md
feature-area: factory/stack-skills/node-fastify
priority: P2
attempt-count: 0
max-attempts: 5
error-message: |
  channels.edge-cases.test.ts > GET /channels/:slug/messages — limit validation > returns 400 when limit exceeds maximum of 100
  AssertionError: expected 500 to be 400 // Object.is equality
  - Expected: 400 / + Received: 500
---

# feat-077 — node-fastify scaffold ships canonical error-handler with ZodError/SyntaxError → 400

## Problem

Every node-fastify backend that uses Zod for request validation (which is all of them — Zod is the canonical pattern in the stack-skill) will hit the same class of bug: when a request fails validation, Zod throws a `ZodError`. The default Fastify catch-all error handler returns 500, not 400. The tester then writes edge-case tests like `expect(res.statusCode).toBe(400)` for "limit > 100 / limit < 1 / malformed BigInt" cases, the implementation returns 500, the tester flags genuine product bugs, the builder retries, can't reliably fix, feature marked failed.

The fix is **always the same one error-handler delta**: add `if (error instanceof ZodError) return reply.status(400).send(...)` + similar for `SyntaxError` (raised by malformed JSON parse, BigInt-from-non-numeric-string, etc.). Shipping this in the scaffold prevents the entire class for every future node-fastify project.

**Empirical:** gotribe-tribe-chat 2026-05-18 `feat-rest-channels` — 5 tester-flagged genuineProductBugs all root-caused in the same scaffold gap. Builder retried 2× and couldn't fix; feature marked failed; manual fix applied (single 18-line addition to `apps/api/src/plugins/error-handler.ts`) unblocked the cascade.

## Proposed fix

`.claude/skills/agents/back-end/node-fastify/SKILL.md` ships `apps/api/src/plugins/error-handler.ts` with the canonical handler:

```ts
import fp from "fastify-plugin";
import { ZodError } from "zod";
import { AppError } from "../common/errors.js";

export default fp(async (app) => {
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          issues: error.issues,
        },
      });
    }
    if (error instanceof SyntaxError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: error.message,
        },
      });
    }
    app.log.error(error);
    return reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
      },
    });
  });
});
```

Add an §AppError/error-envelope reference at the top of the SKILL's §3 backend lane describing the four error classes (AppError → custom statusCode; ZodError → 400; SyntaxError → 400; default → 500) and the shared error response shape (`{ error: { code, message, issues? } }`).

## Acceptance criteria

- [ ] `node-fastify` SKILL.md scaffold emits `apps/api/src/plugins/error-handler.ts` with the four-branch handler
- [ ] §3 backend lane documents the error-envelope shape + the four classes
- [ ] §Gotchas mentions feat-077 as the canonical-error-handling reference
- [ ] Smoke test: bootstrap a fresh node-fastify project + author a route that uses `z.object({ limit: z.coerce.number().int().min(1).max(100) })`. Send a request with `?limit=500`. Assert response is 400 (not 500).
- [ ] Optional: regression test added to the stack-skill scaffold smoke-test suite

## Risk + rollback

- **Risk:** projects that have already shipped a custom error-handler will be unaffected (the scaffold only ships for NEW projects; existing ones aren't retrofitted).
- **Rollback:** revert the stack-skill scaffold change. Existing projects retain their handlers.

## Cross-references

- **gotribe-tribe-chat** `feat-rest-channels` 2026-05-18 — empirical motivator; commit `54bc183` is the canonical shape
- **bug-024** — tester forbidden source-file mods; this scaffold fix REDUCES the rate at which testers write `genuineProductBugs[]` that builders can't fix, which in turn reduces the pressure that drives bug-024 violations
- **feat-042** — node-fastify stack-skill original definition
