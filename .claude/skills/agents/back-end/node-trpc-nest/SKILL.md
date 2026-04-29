---
name: node-trpc-nest
description: Prompt pack for the backend-builder when architecture.yaml.tooling.stack.backend_framework=node-trpc-nest. NestJS 11 + tRPC 11 + Prisma 6 + Zod, consuming @repo/types for shared schemas.
stack_tier: back-end
stack_slug: node-trpc-nest
maturity: shipped
authoredAt: 2026-04-22
dependencyPinsRefreshedAt: 2026-04-22
---

# node-trpc-nest — NestJS 11 + tRPC 11 + Prisma 6

Stack-skill prompt pack for the backend-builder. Loaded when `architecture.yaml.tooling.stack.backend_framework === "node-trpc-nest"`.

## 1. Canonical layout

```
apps/api/
├── src/
│   ├── main.ts                          # NestJS bootstrap
│   ├── app.module.ts                    # root module
│   ├── trpc/
│   │   ├── trpc.module.ts               # exports TrpcService
│   │   ├── trpc.service.ts              # tRPC instance + context builder
│   │   └── app.router.ts                # root router — merges sub-routers
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.router.ts               # tRPC router for auth endpoints
│   │   ├── auth.service.ts              # business logic
│   │   ├── auth.middleware.ts           # tRPC middleware for protected procedures
│   │   └── auth.service.test.ts
│   ├── users/
│   │   ├── users.module.ts
│   │   ├── users.router.ts
│   │   ├── users.service.ts
│   │   └── users.service.test.ts
│   ├── common/
│   │   ├── errors.ts                    # TRPCError factory helpers
│   │   └── zod.ts                       # re-exports from @repo/types
│   └── prisma/
│       ├── prisma.module.ts
│       └── prisma.service.ts            # extends PrismaClient
├── prisma/
│   ├── schema.prisma
│   ├── seed.ts
│   └── migrations/
├── tsconfig.json                        # extends @repo/ui-kit/tsconfig.consumer.json base (no UI — but TS shape consistent)
├── nest-cli.json
└── package.json
```

Shared with consumers (web / mobile) via `@repo/api-client`:

```
packages/api-client/
├── src/
│   ├── index.ts                         # re-exports AppRouter type + createTrpcClient()
│   └── test-utils.ts                    # mockTrpcClient() for consumer tests
└── package.json
```

## 2. Idioms

- **One module per domain.** `AuthModule`, `UsersModule`, `BillingModule`. Each exports a router + a service. Routers compose at `app.router.ts`.
- **tRPC procedures via NestJS DI.** Services are NestJS providers (`@Injectable()`); routers construct procedures that call services. No business logic in the router file — routers are thin.
- **Zod schemas from `@repo/types`.** Never re-declare input/output schemas in the API; import + compose. `.input(UserCreateSchema)` inside a mutation definition.
- **Middleware for auth + logging.** `protectedProcedure = publicProcedure.use(authMiddleware)` — every protected router exports `protectedProcedure` from the base.
- **Context builder at each request.** `createContext({ req, res })` reads cookies + attaches `userId` + db client to the context; procedures destructure from `ctx`.
- **Prisma via a `PrismaService` singleton.** Extends `PrismaClient`; injected into service constructors. Migrations run as a separate command (`pnpm --filter @repo/api db:migrate`).
- **`TRPCError` for all failures.** Codes: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `BAD_REQUEST`, `INTERNAL_SERVER_ERROR`. Never `throw new Error()` in a procedure — the client gets a generic 500 instead of structured error.
- **Transactions via `prisma.$transaction()`.** For multi-step ops (create user + create session + send email), wrap in an interactive transaction callback.
- **Idempotency keys** on mutations that may retry (webhook handlers, payment flows). Persist a hash of input + check before processing.

## 3. Testing

Binds to `feat-004-builder-tdd-hybrid`.

- **Test-file naming**: `src/auth/auth.service.ts` → `src/auth/auth.service.test.ts` (co-located).
- **Test runner**: `pnpm --filter @repo/api test` (vitest); single file `pnpm --filter @repo/api test src/auth/auth.service.test.ts`; coverage `pnpm --filter @repo/api test:coverage`.
- **Service tests**: unit tests on services with Prisma mocked via `vitest-mock-extended`:

  ```ts
  import { mockDeep } from "vitest-mock-extended";
  import type { PrismaClient } from "@prisma/client";
  import { AuthService } from "./auth.service";

  test("creates user with hashed password", async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.user.create.mockResolvedValue({ id: "u_1", email: "a@b.c" } as any);
    const svc = new AuthService(prisma);
    const result = await svc.signup({ email: "a@b.c", password: "hunter2" });
    expect(result.id).toBe("u_1");
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: "a@b.c" }),
      }),
    );
    expect(prisma.user.create.mock.calls[0][0].data.password_hash).not.toBe(
      "hunter2",
    );
  });
  ```

- **Router tests** use a real `appRouter` + `createCallerFactory` — no HTTP; just in-process invocation with a stubbed context.
- **Coverage expectation**: 60% builder / 80% total. Builder covers happy path per service; tester adds edge cases + concurrent-request integration + real-Postgres integration in a docker-compose test-db.
- **Integration tests** (tester-owned): `apps/api/integration/*.test.ts` with a real Postgres via `testcontainers` or a named Docker Compose service.

## 4. Commands

```
lint:        pnpm --filter @repo/api lint
typecheck:   pnpm --filter @repo/api typecheck
test:        pnpm --filter @repo/api test
build:       pnpm --filter @repo/api build
dev:         pnpm --filter @repo/api dev
db:generate: pnpm --filter @repo/api prisma generate
db:migrate:  pnpm --filter @repo/api prisma migrate dev
db:seed:     pnpm --filter @repo/api prisma db seed
```

Builder self-verify gate: `pnpm --filter @repo/api lint && pnpm --filter @repo/api typecheck && pnpm --filter @repo/api test`. Post-schema-change: also run `db:generate` before typecheck so `@prisma/client` types match.

## 5. Gotchas

- **Circular module deps.** If `AuthModule` imports `UsersModule` and `UsersModule` imports `AuthModule`, NestJS DI fails silently. Break with `forwardRef(() => OtherModule)` on one side.
- **tRPC procedure inference requires exact return type.** Never use `: any` on a procedure return — consumers lose end-to-end type safety.
- **Prisma `select` vs `include`.** `select` returns exactly-listed fields (strips others); `include` returns all base fields + listed relations. Mixing both errors at runtime. Pick one per query.
- **Middleware ordering.** NestJS middlewares run in declaration order within a module; tRPC middlewares chain via `.use()`. Auth middleware MUST run before any DB-access middleware.
- **Prisma transactions + concurrent callers.** Long-running `prisma.$transaction()` callbacks hold connections; under load you can exhaust the connection pool. Keep tx bodies short; move non-DB work outside the tx.
- **NestJS module imports.** Every used provider must be in a module's `providers` or `imports` array; DI fails with cryptic error otherwise. The typical "UnknownDependenciesException" means a missing import.
- **Environment variables at bootstrap.** Use `@nestjs/config` with a `validationSchema` (Zod or Joi) — fail fast at startup if `DATABASE_URL` or `JWT_SECRET` is missing. Never `process.env.X!` with the non-null assertion — too easy to mask misconfig.
- **Prisma generator output is stateful.** `pnpm prisma generate` writes into `node_modules/.prisma/client`. After pulling schema changes, re-run generate or types drift. CI: add `postinstall` hook.
- **Webhooks need raw body.** Stripe / Twilio webhook signature verification requires the unmodified request body. NestJS default JSON parser consumes it — configure a RawBodyMiddleware on just the webhook routes.

## Review

Stack-specific checks the reviewer agent runs IN ADDITION to `docs/reviewer-playbook.md`'s generic 7 dimensions. Scope: files in the feature's diff under `apps/api/`.

#### architecture — tRPC procedure return-type inference

- **Invocation**: `grep -rnE "(query|mutation)\s*\(.*\)\s*:\s*any" apps/api/src/`
- **Threshold**: zero hits (`: any` on a tRPC procedure breaks end-to-end type inference for every consumer)
- **Retry target**: backend-builder
- **Playbook §**: augments §1 architecture + §4 maintainability

#### security — raw-body middleware on webhook routes

- **Invocation**: for every integration in `architecture.yaml.apps.api.integrations` that posts webhooks (stripe, twilio, sendgrid, etc.), grep the webhook controller path for `rawBody` / `RawBodyInterceptor`: `grep -rnE "rawBody|RawBodyInterceptor|raw:\s*true" apps/api/src/`
- **Threshold**: ≥1 match per webhook-receiving integration (signature-verification impossible without raw body)
- **Retry target**: backend-builder
- **Playbook §**: augments §2 security (webhook-integrity sub-check)

#### security — ConfigModule schema validation at bootstrap

- **Invocation**: `grep -rnE "validationSchema\s*:|ConfigModule\.forRoot" apps/api/src/app.module.ts apps/api/src/main.ts`
- **Threshold**: ≥1 match referencing `validationSchema:` with Zod/Joi; fail if `process.env.X!` non-null assertions appear outside the validated config boundary
- **Retry target**: backend-builder
- **Playbook §**: augments §2.9 input-validation (applies at service boundary)

#### performance — Prisma N+1 detection

- **Invocation**: `grep -rnB1 -A3 "\.map\(" apps/api/src/ | grep -E "prisma\.(\w+)\.(findUnique|findFirst)"`
- **Threshold**: zero hits — `.map()` callbacks issuing per-item `findUnique` are N+1 queries; use `findMany({ where: { id: { in: ids } } })` or `prisma.$transaction([])` instead
- **Retry target**: backend-builder
- **Playbook §**: augments §6 performance (db-latency sub-check)

#### maintainability — circular module dependencies

- **Invocation**: `grep -rnE "forwardRef\s*\(" apps/api/src/`
- **Threshold**: ≤1 hit total, and every hit requires a `// justification:` comment naming why the circularity can't be broken by module split
- **Retry target**: backend-builder
- **Playbook §**: augments §4 maintainability

## 6. Dependency pins

```
@nestjs/core        11.0.x
@nestjs/common      11.0.x
@nestjs/platform-express 11.0.x
@nestjs/config      3.3.x
@trpc/server        11.0.x
@trpc/client        11.0.x
prisma              6.1.x
@prisma/client      6.1.x
zod                 3.23.x
bcrypt              5.1.x
jsonwebtoken        9.0.x
typescript          5.6.x
vitest              2.1.x
vitest-mock-extended 2.0.x
@types/node         22.x
```

Workspace packages:

```
@repo/types              workspace:*
@repo/api-client         workspace:*    # this package EXPORTS the AppRouter type from here
@repo/utils              workspace:*
@repo/orchestrator-contracts workspace:*
```

## 6.5. Cross-tier package conventions (bug-026)

When you author a `packages/<name>/` workspace package consumed by the web frontend (typed clients, shared schemas, error utilities), use the **frontend-compatible import convention** — bare specifiers, NOT NodeNext's explicit `.js` extensions.

The factory's web tier consumes workspace packages via Next.js `transpilePackages` (Webpack 5). Webpack does NOT rewrite `.js` to `.ts` like NodeNext does. Authoring with `from "./client.js"` produces `Module not found: Can't resolve './client.js'` at the consumer.

```ts
// packages/api-client/src/index.ts — CORRECT
export { fetchReport } from "./client"; // bare specifier
export type { ApiClientOptions } from "./client";

// INCORRECT — breaks Webpack consumer
export { fetchReport } from "./client.js";
```

Rules:

1. No `.js` extensions in workspace-package imports. Bare specifiers only.
2. `package.json.main` and `.types` point at TS source (`"./src/index.ts"`). No build step.
3. `type: "module"` is fine; bare specifiers work under ESM too.

For the same-tier case (NodeNext-only consumers like a sibling backend package), the `.js` convention IS correct. The issue is specifically when a package crosses the back-end / web tier boundary. When in doubt, check `apps/web/next.config.ts.transpilePackages` — packages listed there must use bare specifiers internally.

Empirical motivation: see `plans/active/bug-026-api-client-import-extensions.md` (repo-health-dashboard-01 2026-04-29: api-client authored with `.js` extensions; dev server compile failed; hotfix at commit 7d8435f).

## 7. Anti-patterns

- **Never re-declare Zod schemas in the API.** Import from `@repo/types`. Web + mobile + API consume the same schemas; divergence is a correctness bug.
- **Never `throw new Error()` in a tRPC procedure.** Use `TRPCError` with a proper code.
- **Never use `prisma.$executeRawUnsafe()`** with user input interpolated. Use `$queryRaw` with tagged template literals (parameterized) or ORM query-builder methods.
- **Never export the `PrismaClient` instance directly.** Always wrap in `PrismaService` so NestJS DI lifecycle + `onModuleInit` + `onModuleDestroy` hooks run.
- **Never inline middleware in a single file.** Extract to a reusable module — even if the first use is single-call.
- **Never persist secrets at rest.** Password hashes via bcrypt (cost ≥ 10); JWT secrets in env only; webhook signing keys via env.

## Self-verify (RUN BEFORE REPORTING TASK COMPLETE)

After authoring code + tests for a task, run these commands IN ORDER from the worktree root. Each must succeed before you report `taskStatus: "completed"` for that task. ANY failure → set `taskStatus: "failed"` for the task and surface the stderr in the `errors` field of your return JSON.

```bash
# 1. Install: catches "I added a package.json line but the lockfile doesn't have it"
pnpm install

# 2. Typecheck: catches missing types, schema drift, Prisma client out-of-date
pnpm --filter @repo/api typecheck

# 3. Tests: runs the .test.ts files you authored
pnpm --filter @repo/api test
```

After a Prisma schema change, also run `pnpm --filter @repo/api prisma generate` BEFORE step 2 so `@prisma/client` types match what your code expects.

If you skip ANY of these commands, your task will fail downstream when feat-018's commit-discipline gate evaluates. The orchestrator will mark the feature failed via `feature-no-commits`. Save yourself the round-trip: run the three commands.

If `pnpm install` fails because of a registry network issue, retry once with `--prefer-offline`. If still failing, report the failure verbatim — don't try to work around it.

## 8. References

- [NestJS 11 docs](https://docs.nestjs.com/) — modules, DI, middleware
- [tRPC 11 server docs](https://trpc.io/docs/server) — procedures, middleware, context
- [Prisma 6 migration guide](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-6)
- [OWASP Node.js cheatsheet](https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html)
- Blueprint §17 / Appendix E
