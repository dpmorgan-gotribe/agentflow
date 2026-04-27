---
name: svelte-kit
description: Prompt pack for the web-frontend-builder when architecture.yaml.tooling.stack.web_framework=svelte-kit. SvelteKit 2 + Svelte 5 runes + TypeScript + Tailwind, consuming @repo/ui-kit as CSS + token shelf.
stack_tier: front-end
stack_slug: svelte-kit
maturity: shipped
authoredAt: 2026-04-22
dependencyPinsRefreshedAt: 2026-04-22
---

# svelte-kit — SvelteKit 2 + Svelte 5 runes + Tailwind 4

Stack-skill prompt pack for the web-frontend-builder. Loaded when `architecture.yaml.tooling.stack.web_framework === "svelte-kit"`.

**Special note on @repo/ui-kit**: the kit ships React components, but its TOKENS + GLOBALS + PATTERNS are framework-agnostic CSS. SvelteKit consumes the CSS surface (`@repo/ui-kit/globals.css`, `@repo/ui-kit/tokens.css`, `data-kit-*` attributes) + authors its own Svelte primitives that match the kit's visual contract. This is explicit in `packages/ui-kit/CONTRACT.md` — the kit's JS exports are React-only, but the CSS + spacing + dials apply universally.

## 1. Canonical layout

```
apps/web/
├── src/
│   ├── routes/
│   │   ├── (marketing)/+layout.svelte
│   │   ├── (marketing)/+page.svelte
│   │   ├── (marketing)/pricing/+page.svelte
│   │   ├── (auth)/login/+page.svelte
│   │   ├── (auth)/login/+page.server.ts    # form action handler
│   │   ├── (auth)/signup/+page.svelte
│   │   ├── (app)/+layout.svelte
│   │   ├── (app)/+layout.server.ts          # auth gate
│   │   ├── (app)/dashboard/+page.svelte
│   │   ├── (app)/dashboard/+page.server.ts  # load() fetches data server-side
│   │   └── api/trpc/[...trpc]/+server.ts    # tRPC route handler
│   ├── lib/
│   │   ├── components/                       # Svelte primitives matching kit contract
│   │   │   ├── Button.svelte
│   │   │   ├── Input.svelte
│   │   │   └── Card.svelte
│   │   ├── trpc.ts                          # tRPC client (typed from @repo/api-client)
│   │   └── cn.ts                            # re-exports @repo/ui-kit cn helper
│   ├── app.css                              # imports @repo/ui-kit/globals.css
│   ├── app.html                             # shell HTML
│   └── hooks.server.ts                      # auth cookies + tRPC context
├── svelte.config.js
├── vite.config.ts                           # aliases @repo/* workspace packages
├── tailwind.config.ts                       # extends @repo/ui-kit/tokens.css
├── tsconfig.json                            # extends @repo/ui-kit/tsconfig.consumer.json
└── package.json
```

### 1b. Feature-sliced state convention (bug-015 Phase 3)

**Cross-component shared state MUST be feature-sliced.** Each feature owns ONE store file at `apps/web/src/lib/stores/{feature-slug}.svelte.ts` (rune-based) or `apps/web/src/lib/stores/{feature-slug}.ts` (writable-based). A thin barrel at `apps/web/src/lib/stores/index.ts` re-exports.

```
apps/web/src/lib/stores/
├── index.ts                  # re-exports — thin composition only
├── board.svelte.ts           # feat-board-core owns this file
├── settings.svelte.ts        # feat-settings-data owns this file
├── theme.svelte.ts           # feat-theme owns this file
└── filter.svelte.ts          # feat-filter owns this file
```

**Why**: parallel-feature builders writing to the SAME store file produce merge conflicts at close-feature time (kanban-webapp-08 burned $20+ on this). Feature slices = each builder touches only its own file = no contention.

**Rules:**

- A slice file is owned by exactly ONE feature. PM enforces via `feature.affects_files: ["apps/web/src/lib/stores/{feature-slug}.svelte.ts"]`.
- `stores/index.ts` is a SHARED touch-point. Only modified during architect scaffold OR a structural change request. Builders NEVER add new state to `index.ts`.
- Cross-slice composition via re-exported derived runes (`$derived(boardStore.active && filterStore.search)`).
- For tiny single-screen apps with no cross-feature state, a single `stores/app.svelte.ts` is fine. The slice convention kicks in the moment a SECOND feature needs shared state.

This convention is also enforced by the architect agent at scaffold time — see `.claude/agents/architect.md` §State module structure.

## 2. Idioms

- **Svelte 5 runes only.** `$state()`, `$derived()`, `$effect()` — no `let`-based reactivity, no `writable()` stores unless wrapping external reactive sources. Stores are fine for cross-component shared state, but rune-based `$state()` on a module-level `const` is preferred for simple cases.
- **Route files colocate.** Every route directory has `+page.svelte` (UI) + `+page.server.ts` (server-only loader + form actions) + optionally `+layout.svelte`. Server-only files run only on the server — put DB / tRPC caller / secrets access here.
- **`load()` functions for data.** Server `load()` returns typed data via `satisfies PageServerLoad`; the `+page.svelte` consumes via `export let data: PageData`.
- **Form actions for mutations.** Progressive-enhanced by default — no JS → form posts through; with JS → intercepted client-side, handled without navigation.
- **Native `<a href="/path">` for navigation.** SvelteKit handles client-side routing automatically; no `<Link>` component needed.
- **`goto()` from `$app/navigation`** for imperative nav inside handlers.
- **Kit tokens via CSS variables.** Import `@repo/ui-kit/globals.css` once in `src/app.css`; reference tokens via `var(--color-accent-500)` or Tailwind arbitrary values like `bg-[var(--color-surface-raised)]`.
- **Forms with `zod` + superforms.** sveltekit-superforms gives the same ergonomics as React Hook Form + Zod. Import Zod schema from `@repo/types`.
- **Loading skeletons** via the kit's `data-kit-component="Skeleton"` CSS + Svelte's `#await` block for promise resolution.
- **data-kit-\* attrs preserved.** Svelte primitives match the kit's React contract: every Svelte `<Button>` emits `data-kit-component="Button"` + `data-kit-variant="primary|..."` for HTML-structure parity with React builds.

## 3. Testing

- **Test-file naming**: `src/lib/foo.ts` → `src/lib/foo.test.ts`; component `src/lib/components/Button.svelte` → `src/lib/components/Button.test.ts`.
- **Test runner**: `pnpm vitest run <file>` (single); `pnpm vitest` (watch); `pnpm vitest run --coverage` (coverage).
- **Component rendering via `@testing-library/svelte`**:

  ```ts
  import { render, screen } from "@testing-library/svelte";
  import userEvent from "@testing-library/user-event";
  import Button from "./Button.svelte";

  test("renders primary variant", async () => {
    render(Button, { variant: "primary", label: "Save" });
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute(
      "data-kit-variant",
      "primary",
    );
  });
  ```

- **Mocking patterns**:
  - Mock `$app/navigation` via `vi.mock('$app/navigation', () => ({ goto: vi.fn() }))`.
  - Mock `$page` store via `vi.mock('$app/stores', () => ({ page: { subscribe: (fn) => { fn({ url: new URL('http://localhost/') }); return () => {}; } } }))`.
  - Mock tRPC via the `@repo/api-client/test-utils` `mockTrpcClient()` helper.
- **Load function tests** — test the plain function, not the SvelteKit invocation. Import the `load` export from `+page.server.ts` and call it with a mock event.
- **Coverage expectation**: 60% builder / 80% total (same as react-next).
- **Playwright E2E** (tester-owned): `apps/web/e2e/*.spec.ts`; runner `pnpm playwright test`.

## 4. Commands

```
lint:      pnpm --filter @repo/web lint
typecheck: pnpm --filter @repo/web check       # SvelteKit uses svelte-check
test:      pnpm --filter @repo/web test
build:     pnpm --filter @repo/web build
dev:       pnpm --filter @repo/web dev
```

`svelte-check` replaces `tsc --noEmit` for typechecking — it understands `.svelte` files natively.

## 5. Gotchas

- **Svelte 5 vs 4 syntax.** Runes (`$state`, `$derived`, `$effect`) require Svelte 5; legacy reactive statements (`$:`) still work but mixing styles in one component is confusing. Stick to runes for new code.
- **`+page.server.ts` vs `+page.ts`.** The `.server.ts` variant runs ONLY on the server; `.ts` (no `.server`) runs on both sides and ships to the client. Database access MUST use `.server.ts`.
- **Form actions return types.** `return fail(400, { message: '...' })` for validation errors (form-bound); `redirect(302, '/path')` (thrown, not returned) for post-success navigation. These aren't interchangeable.
- **Global styles scoping.** `:global(...)` in a Svelte component's `<style>` block leaks out. Prefer extending the kit's `globals.css` at the app root over scattered global overrides.
- **Cookie access in load functions.** Use `event.cookies.get('name')` — do NOT reach for `document.cookie` (it's SSR-first; DOM cookies don't exist server-side).
- **Vite aliases need both `svelte.config.js` + `tsconfig.json`.** Add workspace package aliases in BOTH files — SvelteKit's preprocessor reads svelte.config, but TypeScript reads tsconfig.
- **Hydration + `$state` initial value mismatch.** If the server renders with one `$state` initial value and the client hydrates with another, you get the same mismatch warning as React. Use the same `load()` data source on both sides.
- **`use:enhance` required for progressive form behavior.** Without it, form actions full-page-reload on submit; with it, the client intercepts + updates without navigation. Always add `use:enhance` to forms that the user interacts with frequently.

## Review

Stack-specific checks the reviewer agent runs IN ADDITION to `docs/reviewer-playbook.md`'s generic 7 dimensions. Scope: files in the feature's diff under `apps/web/`.

#### security — secrets in `+page.svelte`

- **Invocation**: `grep -rnE "process\.env\.|import\.meta\.env\." apps/web/src/routes/**/+page.svelte`
- **Threshold**: zero hits inside `+page.svelte` files — server-only secrets belong in `+page.server.ts`; exposed env vars must be prefixed `PUBLIC_` (Vite convention) AND only touched in the client-side `<script>` of a page
- **Retry target**: web-frontend-builder
- **Playbook §**: augments §2 security (secret-leak sub-check)

#### architecture — DB / auth access only in `+page.server.ts` / `+server.ts`

- **Invocation**: `grep -rnE "(prisma|drizzle|supabaseClient|auth\(\))" apps/web/src/routes/**/+page.svelte apps/web/src/lib/**/*.svelte`
- **Threshold**: zero hits — DB clients + server-side auth flows run only in `+page.server.ts` / `+server.ts` endpoints. A DB client imported into a `.svelte` component ships to the client bundle
- **Retry target**: web-frontend-builder
- **Playbook §**: augments §1 architecture (SvelteKit server boundary) + §2 security

#### performance — parallel promises in load()

- **Invocation**: `grep -rnB2 -A10 "export const load\s*=" apps/web/src/routes/` filter for sequential `await`s: look for `const a = await ...; const b = await ...` patterns with no inter-dependency
- **Threshold**: sequential `await`s that could run in parallel are a fail; use `const [a, b] = await Promise.all([fetchA, fetchB])` — LCP penalty scales with the number of sequential awaits
- **Retry target**: web-frontend-builder
- **Playbook §**: augments §6 performance (LCP sub-check)

#### security — form actions + CSRF

- **Invocation**: in `svelte.config.js`: `grep -nE "csrf\s*:" svelte.config.js`. For each form-action file: `grep -rnE "export const actions\s*=" apps/web/src/routes/**/+page.server.ts` cross-referenced with `use:enhance` in the matching `+page.svelte`
- **Threshold**: `csrf.checkOrigin` is NOT set to `false` in svelte.config.js; every form action's matching `+page.svelte` uses `<form method="post" use:enhance>` (or explicit `action="?/name"` with kit CSRF defaults)
- **Retry target**: web-frontend-builder
- **Playbook §**: augments §2 security (CSRF sub-check)

#### a11y — click handlers on non-interactive elements

- **Invocation**: `grep -rnE "on:click=" apps/web/src/` → cross-reference with the enclosing element tag (skip `<button>`, `<a href>`, `<input>`, `<select>`, `<textarea>`)
- **Threshold**: zero hits on `<div>` / `<span>` / `<p>` / `<li>` without `role="button"` + `tabindex="0"` + keyboard handler (`on:keydown` filtering `Enter` / `Space`)
- **Retry target**: web-frontend-builder
- **Playbook §**: augments §5 a11y

## 6. Dependency pins

```
svelte               5.1.x
@sveltejs/kit        2.8.x
@sveltejs/adapter-auto 3.3.x        # switch to adapter-node/vercel/cloudflare per deploy target
vite                 5.4.x
typescript           5.6.x
svelte-check         4.0.x
tailwindcss          4.0.0-beta.7
@tailwindcss/vite    4.0.0-beta.7
postcss              8.4.x
vitest               2.1.x
@testing-library/svelte     5.2.x
@testing-library/user-event 14.5.x
sveltekit-superforms 2.20.x
zod                  3.23.x
@trpc/client         11.0.x
@trpc/server         11.0.x
```

Workspace packages:

```
@repo/ui-kit           workspace:*    # consumed as CSS + tokens, NOT as component library
@repo/types            workspace:*
@repo/api-client       workspace:*
@repo/utils            workspace:*
```

## 7. Anti-patterns

- **Never import `@repo/ui-kit` component exports in Svelte code.** They are React-only. Use `@repo/ui-kit/globals.css` + `@repo/ui-kit/tokens.css` for the CSS surface; author Svelte primitives locally under `src/lib/components/` that match the kit's visual + `data-kit-*` contract.
- **Never mix Svelte 4 reactive statements (`$:`) with Svelte 5 runes in the same component.** Pick one.
- **Never use `getStores()` or `getContext()` at module top-level.** Only inside component functions.
- **Never suppress ESLint on `onMount` fetches.** If you need server data, use `load()` — `onMount` runs only client-side and misses SSR.
- **Never ship secrets via `PUBLIC_*` env vars.** The `$env/static/public` + `$env/static/private` split is strict — public vars are baked into the client bundle, private vars are server-only.

## 8. References

- [SvelteKit 2 docs](https://svelte.dev/docs/kit) — routing, load functions, form actions
- [Svelte 5 runes migration](https://svelte.dev/docs/svelte/v5-migration-guide)
- [sveltekit-superforms](https://superforms.rocks/) — form + Zod integration
- [Tailwind CSS v4 for Vite](https://tailwindcss.com/docs/v4-beta)
- Blueprint §17 / Appendix E — stack-skill shelf policy
- `packages/ui-kit/CONTRACT.md` — consumer contract (CSS-only surface for non-React stacks)
