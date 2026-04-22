---
name: react-next
description: Prompt pack for the web-frontend-builder when architecture.yaml.tooling.stack.web_framework=react-next. Next.js 15 App Router + React 19 + Tailwind + TypeScript, consuming @repo/ui-kit.
stack_tier: front-end
stack_slug: react-next
maturity: shipped
authoredAt: 2026-04-22
dependencyPinsRefreshedAt: 2026-04-22
---

# react-next — Next.js 15 App Router + React 19 + Tailwind 4

Stack-skill prompt pack for the web-frontend-builder. Loaded verbatim when `architecture.yaml.tooling.stack.web_framework === "react-next"`.

## 1. Canonical layout

```
apps/web/
├── app/
│   ├── (marketing)/
│   │   ├── page.tsx              # marketing home
│   │   └── pricing/page.tsx
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   ├── (app)/
│   │   ├── layout.tsx            # authenticated shell with sidebar
│   │   ├── dashboard/page.tsx
│   │   └── settings/
│   │       ├── page.tsx
│   │       └── profile/page.tsx
│   ├── api/
│   │   └── trpc/[trpc]/route.ts  # tRPC route handler (consumes @repo/api-client)
│   ├── layout.tsx                # root layout — imports @repo/ui-kit/globals.css
│   └── globals.css               # re-exports @repo/ui-kit/globals.css (or imports directly)
├── components/                    # app-specific composites built FROM @repo/ui-kit primitives
│   ├── providers.tsx             # QueryClient + tRPC + theme providers
│   └── nav/
│       ├── sidebar.tsx
│       └── top-bar.tsx
├── lib/
│   ├── auth.ts                   # auth helper (middleware + cookies)
│   └── trpc-client.ts            # tRPC hook exports from @repo/api-client
├── middleware.ts                 # auth + redirects
├── next.config.ts                # Turbopack + transpilePackages for workspace packages
├── tailwind.config.ts            # extends @repo/ui-kit/tokens
├── tsconfig.json                 # extends @repo/ui-kit/tsconfig.consumer.json
├── package.json
└── .env.local                    # never committed; user-authored at gate 5 from .env.example
```

## 2. Idioms

- **Server components by default.** Add `"use client"` only when a component needs interactivity (event handlers, state, browser APIs). Data fetching happens in server components via direct function calls or `fetch()`; client components receive data via props or tRPC hooks.
- **Route groups `(name)/`** for segmentation without adding URL segments. Use for `(marketing)`, `(auth)`, `(app)` auth-gated sections.
- **Per-segment layouts.** A layout at `app/(app)/layout.tsx` wraps everything under that group; puts shared chrome (sidebar, header) in one place.
- **tRPC for API.** Mutations + queries via `@repo/api-client` hooks in client components; direct tRPC caller in server components for streaming initial data.
- **`@repo/ui-kit` is the ONLY component source.** Never inline a `<Button>` — import from `@repo/ui-kit`. Kit primitives carry their own `data-kit-*` attributes from HTML translation; builders must preserve those attrs when converting screens.
- **`cn()` from `@repo/ui-kit/lib/cn`** for className composition — not `clsx` directly, not hand-concatenated strings. Consistent merging of Tailwind class conflicts via `tailwind-merge`.
- **Forms: React Hook Form + Zod.** Import Zod schemas from `@repo/types`; use `zodResolver`. Never re-declare the schema in the component.
- **Loading + error UI** via `loading.tsx` + `error.tsx` co-located with each `page.tsx`. Use kit's `Skeleton` for loading.
- **Suspense for streaming.** Wrap slow server-fetches in `<Suspense fallback={<Skeleton />}>` and let Next stream progressively.
- **`next/image` for ALL raster images.** Set explicit `width` + `height`. For hero imagery from Unsplash / picsum, include `unoptimized` only on external URLs where sizing is unknown.

## 3. Testing

Binds to `feat-004-builder-tdd-hybrid` policy.

- **Test-file naming**: `src/foo.tsx` → `src/foo.test.tsx` (co-located). App-router pages tested via the component's `export default` directly (import the `page.tsx` default export and render it with `@testing-library/react`).
- **Test runner**: `pnpm vitest run <file>` for a single file; `pnpm vitest` for watch mode; `pnpm vitest run --coverage` for coverage output.
- **Mocking patterns**:
  - Mock tRPC via `@repo/api-client/test-utils` — use the factory's `mockTrpcClient()` helper (lives in api-client package) to swap the real client for a stub.
  - Mock `next/navigation` via `vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))`.
  - Mock clock via `vi.useFakeTimers()` / `vi.setSystemTime(new Date('2026-01-01'))`.
- **Coverage expectation**: builder happy-path 60% line; tester raises total to 80% via edge cases + integration + Playwright E2E.
- **Example test** (`apps/web/components/button-counter.test.tsx`):

  ```tsx
  import { render, screen } from "@testing-library/react";
  import userEvent from "@testing-library/user-event";
  import { ButtonCounter } from "./button-counter";

  test("increments on click", async () => {
    render(<ButtonCounter initial={0} />);
    await userEvent.click(screen.getByRole("button", { name: /count/i }));
    expect(screen.getByRole("button")).toHaveTextContent("Count: 1");
  });
  ```

- **Playwright E2E** (tester-owned, not builder): specs at `apps/web/e2e/*.spec.ts`; runner `pnpm playwright test`.

## 4. Commands

```
lint:      pnpm --filter @repo/web lint
typecheck: pnpm --filter @repo/web typecheck
test:      pnpm --filter @repo/web test
build:     pnpm --filter @repo/web build
dev:       pnpm --filter @repo/web dev
```

Builder self-verify gate: `pnpm --filter @repo/web lint && pnpm --filter @repo/web typecheck && pnpm --filter @repo/web test`. Failure retries up to 2× with the error context fed back.

## 5. Gotchas

- **Hydration mismatch.** Never use `Date.now()`, `Math.random()`, or `new Date()` inline in a component that renders on both server + client. Hoist into `useEffect` or pass as a server prop.
- **`"use client"` contagion.** The directive marks the file's component tree as client-side — importing a client component from a server component is fine, but importing a server component from a client component is NOT. If you need server-only code inside client boundary, import via `<Suspense>` + a server component prop.
- **Workspace transpilation.** `next.config.ts` must include `transpilePackages: ["@repo/ui-kit", "@repo/types", "@repo/api-client", "@repo/utils"]` — without it Next won't transform TypeScript from monorepo packages.
- **Env vars in client bundle.** Only `NEXT_PUBLIC_*` prefixed vars are exposed to client components. Sensitive keys (`STRIPE_SECRET_KEY`, `DATABASE_URL`) must stay server-only — accessing them from a client component leaks at build time.
- **`loading.tsx` suspense boundaries.** A `loading.tsx` file doesn't wrap a single page — it wraps the entire route segment. If you want finer-grained loading UI, use `<Suspense>` manually.
- **Cookie access in server components.** Use `cookies()` from `next/headers` (async in Next 15). Do NOT reach for `document.cookie` in a server component — it doesn't exist.
- **Middleware runtime.** Runs on the Edge runtime by default — no Node APIs, no Prisma client. If you need DB access in middleware, switch to Node runtime explicitly (`export const config = { runtime: 'nodejs' }` — Next 15+).
- **Server actions (`"use server"`) leak fn names in the bundle as route paths.** Fine for internal use; don't expose to untrusted callers without auth guards.
- **Tailwind `@apply` inside kit CSS** — kit styles compile at kit-build time, not at consumer build time. Don't add new `@apply` rules in `apps/web/` — extend the kit instead or use className directly.

## 6. Dependency pins

```
next                 15.1.0         # App Router stable; Turbopack dev + React 19
react                19.0.0         # required by Next 15; concurrent features stable
react-dom            19.0.0
typescript           5.6.x          # 5.7 has known issues with workspace TS projects
tailwindcss          4.0.0-beta.7   # v4 stable enough by 2026 Q2; lightning-css engine
@tailwindcss/postcss 4.0.0-beta.7
postcss              8.4.x
vitest               2.1.x          # 3.x breaks @testing-library/react 16 path resolution
@testing-library/react       16.1.x
@testing-library/user-event  14.5.x
@hookform/resolvers  3.9.x
react-hook-form      7.53.x
zod                  3.23.x
```

Workspace packages:

```
@repo/ui-kit           workspace:*
@repo/types            workspace:*
@repo/api-client       workspace:*
@repo/utils            workspace:*
```

## 7. Anti-patterns

- **Never `useEffect`-fetch in a server component.** Move the fetch up to the page's default export or a server wrapper.
- **Never wrap the whole app in `"use client"`.** Defeats the server-component default + ships the whole React tree as a client bundle.
- **Never inline `<style>` tags.** Kit tokens + Tailwind utilities only. Inline styles are banned per `@repo/ui-kit/CONTRACT.md`.
- **Never import from `@repo/ui-kit/src/...`.** Deep imports bypass the barrel. Only `@repo/ui-kit` (root) is a valid import path — consumer tsconfig enforces this.
- **Never redeclare a Zod schema in a component.** Import from `@repo/types` — single source of truth.
- **Never call `router.push()` in a server component.** Use `redirect()` from `next/navigation`.

## 8. References

- [Next.js 15 docs](https://nextjs.org/docs) — App Router, Server Components, Server Actions
- [React 19 release notes](https://react.dev/blog/2024/12/05/react-19) — `use()` hook, Actions, form status
- [Tailwind CSS v4 migration](https://tailwindcss.com/docs/v4-beta) — `@theme` directive, lightning-css engine
- [Vitest + React Testing Library](https://vitest.dev/guide/testing-types) — vitest config for RTL
- Blueprint §17 / Appendix E — stack-skill shelf policy
- `packages/ui-kit/CONTRACT.md` — consumer contract (the six rules)
