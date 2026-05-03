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
├── .env.example                  # NEXT_PUBLIC_API_BASE contract (bug-032 Phase C)
└── .env.local                    # gitignored; user-authored from .env.example (operator-copy step)
```

### 1a. Env contract — bug-032 Phase C

`apps/web/.env.example` is **part of the canonical scaffold**, not optional. The frontend's API client (`packages/api-client/src/client.ts`-style) reads `process.env.NEXT_PUBLIC_API_BASE` at build time to construct cross-tier URLs. With no `.env*` authored, the base URL is empty → URLs become same-origin relative → `/api/*` requests hit the Next.js dev server (404) instead of the backend.

Author at scaffold time:

```env
# apps/web/.env.example — frontend env contract.
# Copy to .env.local for local dev. .env.local is gitignored.

# Backend API origin — MUST match the FastAPI process's bound port.
# In dev:  copy to .env.local and set the port (default :8000).
# In prod: set in deployment env (Vercel project settings, etc.).
NEXT_PUBLIC_API_BASE=http://localhost:8000
```

`next.config.ts` exposes the var to the browser:

```ts
const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? "",
  },
  // ... rest of config
};
```

`.env.local` is gitignored AND blocked by the factory's `enforce-boundaries.sh` hook (secrets-pattern guard). The architect skill documents the operator copy step (`cp apps/web/.env.example apps/web/.env.local`) in `docs/credentials-checklist.md` — the builder MUST NOT auto-author `.env.local`.

For multi-tier projects (web + api), the project-root `scripts/dev.mjs` (also authored by architect — see architect SKILL §7c) handles port coordination automatically: it boots the backend, captures the actual bound port, propagates `NEXT_PUBLIC_API_BASE=http://localhost:<port>` into the frontend's env at spawn time. Operators run `node scripts/dev.mjs` instead of `pnpm dev` to get coordinated boots.

### 1b. Feature-sliced state convention (bug-015 Phase 3)

**Client-side state (Zustand / Jotai / Redux / Valtio) MUST be feature-sliced.** Each feature owns ONE slice file at `apps/web/src/store/{feature-slug}.ts`. A thin barrel at `apps/web/src/store/index.ts` re-exports + composes slices into the public hook.

```
apps/web/src/store/
├── index.ts                  # re-exports hook + selectors; thin composition only
├── board.ts                  # feat-board-core owns this file
├── settings.ts               # feat-settings-data owns this file
├── theme.ts                  # feat-theme owns this file
├── filter.ts                 # feat-filter owns this file
└── multiple-boards.ts        # feat-multiple-boards owns this file
```

**Each slice file** exports:

- A `create*Slice<T>(set, get)` factory (Zustand pattern) OR equivalent for the chosen store lib
- Typed selectors (`selectBoardById`, `selectFilteredCards`, etc.) — pure functions on the slice's state shape
- Action creators / reducers as needed

**`store/index.ts`** is the ONLY file that imports from each slice. Composes them into the root store via the lib's combiner pattern (Zustand: spread; Redux: combineReducers; etc.). Re-exports the hook + selectors. Never owns business logic — pure plumbing.

**Why this matters**: when feat-board-core and feat-settings-data both build in parallel worktrees, each touches ONLY its own slice file. No shared file → no merge conflict at close-feature time. (Pre-bug-015, both features mutated `store/index.ts`, causing the kanban-webapp-08 emergency-abort.)

**Rules:**

- A slice file is owned by exactly ONE feature. PM enforces via `feature.affects_files: ["apps/web/src/store/{feature-slug}.ts"]`.
- `store/index.ts` is a SHARED touch-point. Only modified during the architect's initial scaffold OR via a `kit-change-request`-style structural change. Builders must NEVER add new state to `index.ts` directly — emit a new slice file instead.
- Cross-slice reads are fine via composed selectors at the index level (e.g. `selectActiveBoardWithFilter` joins board + filter slices). Cross-slice WRITES go through explicit action creators that the slice owns.
- For tiny apps with no shared mutable state (single-screen toy projects), a single `store/index.ts` is fine. The slice convention kicks in the moment a SECOND feature needs to add state.

This convention is also enforced by the architect agent at scaffold time — see `.claude/agents/architect.md` §State module structure.

### 1c. `data-screen-id` on every page-root render (feat-022)

**Every `app/**/page.tsx`MUST render its mockup's`data-screen-id`on the page-root element so the post-build`/build-to-spec-verify` synthesizer can assert "after click → on screen Y" without URL-pattern guesswork.** The value is the kebab-case mockup screen id (`docs/screens/webapp/{screen-id}.html`→`data-screen-id="{screen-id}"`).

```tsx
// apps/web/app/(app)/dashboard/page.tsx
export default function DashboardPage() {
  return (
    <div data-screen-id="dashboard" className="...">
      ...
    </div>
  );
}

// apps/web/app/settings/page.tsx
export default function SettingsPage() {
  return <main data-screen-id="settings">...</main>;
}
```

Place the attribute on the topmost element the page returns (the route's render root), NOT on the global `<body>` — Next.js owns `<body>` via `app/layout.tsx`. For modal-style screens that render via portal/dialog, set `data-screen-id` on the dialog's outer `<div role="dialog">` so it becomes the active screen-id when the modal mounts. The synthesizer reads `document.querySelector('[data-screen-id]')` — it accepts ANY element, just needs one match.

The mockup's `<body data-screen-id="...">` (see screens skill §4e.1) is the source of truth — match it exactly. Mismatched IDs surface as flow-failure violations in `/build-to-spec-verify`.

## 2. Idioms

- **Server components by default.** Add `"use client"` only when a component needs interactivity (event handlers, state, browser APIs). Data fetching happens in server components via direct function calls or `fetch()`; client components receive data via props or tRPC hooks.
- **Route groups `(name)/`** for segmentation without adding URL segments. Use for `(marketing)`, `(auth)`, `(app)` auth-gated sections.
- **Per-segment layouts.** A layout at `app/(app)/layout.tsx` wraps everything under that group; puts shared chrome (sidebar, header) in one place.
- **tRPC for API.** Mutations + queries via `@repo/api-client` hooks in client components; direct tRPC caller in server components for streaming initial data.
- **`@repo/ui-kit` is the ONLY component source.** Never inline a `<Button>` — import from `@repo/ui-kit`. Kit primitives carry their own `data-kit-*` attributes from HTML translation; builders must preserve those attrs when converting screens.

### 2.5. Routing Contract (bug-025) — read screens.json before authoring nav code

Before writing ANY navigation code (`<Link href="…">`, `router.push("…")`, `router.replace("…")`, `redirect("…")`, `<Form action="…">`), read `docs/screens-manifest.json` (or the per-app `docs/analysis/{platform}/screens.json` if not yet manifest-ified) to find the **canonical `routePattern`** of the target screen. Use it verbatim — do NOT invent a shorter or "cleaner" URL.

If you're authoring a NEW screen (route owner), the Next.js file location MUST match its screens.json `routePattern`:

```
screens.json routePattern:  /report/:owner/:repo
Next.js file location:       app/report/[owner]/[repo]/page.tsx

screens.json routePattern:  /compare/:slugs*       (catch-all)
Next.js file location:       app/compare/[[...slugs]]/page.tsx
```

If two builders disagree on a URL, the screens.json value wins. If you believe screens.json is wrong, file a kit-change-request via `docs/screens/kit-change-requests/` — do NOT silently re-invent.

Empirical motivation: repo-health-dashboard-01 (2026-04-29) — feat-home authored `router.push('/r/${owner}/${repo}')` while feat-report independently created `app/report/[owner]/[repo]/page.tsx`. The home form's submit went to a 404 route. screens.json had no routePattern field at the time; bug-025 added it. Both features should have read the same `/report/:owner/:repo` value.

### 2a. HTML → JSX translation: `data-kit-*` pass-through (feat-028 visual-parity contract)

When translating a screen mockup at `docs/screens/webapp/{screen-id}.html` into a React page (`apps/web/app/**/page.tsx` + supporting `apps/web/components/**`), every `data-kit-*` attribute on the source HTML element MUST survive translation.

The mapping is mechanical:

```html
<!-- Mockup source -->
<button
  data-kit-component="Button"
  data-kit-variant="primary"
  data-kit-size="md"
>
  Save
</button>
```

```tsx
// Translated JSX — kit primitive forwards the attrs back via Phase 0 retrofit
import { Button } from "@repo/ui-kit";

<Button variant="primary" size="md">
  Save
</Button>;
```

The kit's `<Button>` primitive (per `/stylesheet` §9e) emits `data-kit-component="Button" data-kit-variant="primary" data-kit-size="md"` on its rendered root, restoring the contract. The same logic applies to AppShell + Sidebar + every other primitive — the mockup is the authority for which kit components compose the screen + how they nest.

**Critical: do NOT strip the AppShell wrapper.** When the mockup wraps page content in `<div data-kit-component="AppShell">…<aside data-kit-component="Sidebar">…</aside>…</div>`, the React render MUST emit:

```tsx
<AppShell sidebar={<Sidebar>…</Sidebar>} header={<TopBar>…</TopBar>}>
  {/* page content */}
</AppShell>
```

Stripping the shell is the dominant divergence pattern investigate-009 catalogued — the post-build `/build-to-spec-verify` parity stage (feat-028) flags it as `shell-stripping` (P0) + auto-files a bug plan with a per-pattern fix template.

### 2b. Self-verify: kit-attribute presence

Before returning `taskStatus: "completed"`, run a quick presence check on the feature's authored components — emit a warning (NOT a failure; the kit primitives themselves emit the attrs at render-time, so source-grep is best-effort) when the count of `data-kit-component` references in the diff is suspiciously low:

```bash
# From the worktree root, after authoring:
grep -rE "data-kit-component" apps/web/src apps/web/components apps/web/app 2>/dev/null | wc -l
```

A count of 0 in a feature whose mockups DO use kit primitives is a strong signal that the translation pass dropped the attributes — re-check each `page.tsx` against its mockup. The actual contract enforcement happens in `/build-to-spec-verify`'s parity stage which renders the built page + diffs against the mockup HTML; this self-verify only catches the most-egregious omissions before the orchestrator gets there.

### 2c. Dev-only `__seedFromUrl` helper (feat-029 fixture seed contract)

The post-build parity verifier (feat-028 + feat-029) navigates to `/?_seed=<screenId>` to populate the app with the same data shape the mockup depicts BEFORE diffing the rendered DOM. Without this, the built app renders empty (no boards, no cards, no settings) while the mockup shows populated state — every parity check fails for the wrong reason ("everything missing").

Every project MUST ship a dev-only `__seedFromUrl` helper that:

1. Reads `?_seed=<id>` from `window.location.search`
2. Fetches `/docs/screens/webapp/fixtures/<id>.fixture.json`
3. Applies the fixture's `storeState` to `localStorage` (or whichever persistence layer the store reads from on hydration)
4. Strips the query param + reloads the page so the store rehydrates from seeded state
5. Is a NO-OP in production builds (guarded by `process.env.NODE_ENV !== "production"`)

Canonical implementation lives at `apps/web/src/lib/dev-seed.ts`:

```ts
// apps/web/src/lib/dev-seed.ts
// Dev-only fixture seeder for the post-build parity verifier (feat-029).
// In production this whole module compiles to a no-op via the NODE_ENV guard.
"use client";

import { useEffect } from "react";

const STORAGE_KEY = "app-store"; // match your Zustand persist key

export function useDevSeedOnMount(): void {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const seedId = params.get("_seed");
    if (!seedId) return;
    void (async () => {
      try {
        const res = await fetch(
          `/docs/screens/webapp/fixtures/${seedId}.fixture.json`,
        );
        if (!res.ok) {
          console.warn(
            `[dev-seed] fixture ${seedId} not found (${res.status})`,
          );
          return;
        }
        const fixture = await res.json();
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ state: fixture.storeState, version: 0 }),
        );
        // Strip the query param + reload so the store rehydrates from seeded state.
        const url = new URL(window.location.href);
        url.searchParams.delete("_seed");
        window.location.replace(url.toString());
      } catch (err) {
        console.warn("[dev-seed] failed to apply fixture:", err);
      }
    })();
  }, []);
}
```

Wire into the providers shell at `apps/web/components/providers.tsx`:

```tsx
// apps/web/components/providers.tsx
"use client";

import { useDevSeedOnMount } from "@/lib/dev-seed";

export function Providers({ children }: { children: React.ReactNode }) {
  useDevSeedOnMount(); // no-op in production
  return <>{children}</>;
}
```

**Production-build exclusion contract:** the `process.env.NODE_ENV === "production"` guard is the FIRST statement inside the effect. Next.js inlines `process.env.NODE_ENV` at build time, so the production bundle compiles the entire fetch+localStorage block away as dead code. Verify with:

```bash
pnpm --filter @repo/web build
grep -r "useDevSeedOnMount" apps/web/.next/static/chunks/ | wc -l
# Expect: 0 (dead-code-eliminated)
```

**Self-verify command** (run before reporting `taskStatus: "completed"` for ANY feature that touches `apps/web/components/providers.tsx`):

```bash
# Confirm helper file exists + is wired into Providers
test -f apps/web/src/lib/dev-seed.ts && echo "ok: dev-seed.ts present"
grep -c "useDevSeedOnMount" apps/web/components/providers.tsx
# Expect: ≥1
grep -c "process.env.NODE_ENV" apps/web/src/lib/dev-seed.ts
# Expect: ≥1 (production guard required)
```

A count of 0 on either grep is a feature-failing condition — the parity verifier downstream will produce no useful signal without the seed handler in place.

**Storage-key alignment:** the `STORAGE_KEY` constant MUST match the `name` your Zustand `persist()` middleware uses (or equivalent for Jotai's `atomWithStorage` / Redux Persist's `key`). Mismatch = seeded data sits in localStorage but the store reads from a different key + ignores it. PM-emitted store-slice scaffold should hardcode the key as a re-exportable constant from `apps/web/src/store/index.ts` so dev-seed.ts and the store agree on a single source of truth.

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

### E2E data-seeding strategy (feat-038 Phase 2B)

Strategy resolution comes from `architecture.yaml.tooling.stack.persistence_layer` (set by `/architect`); the synthesizer (`scripts/synthesize-flow-e2e.mjs`) maps the slot to one of three Playwright patterns documented in `.claude/rules/testing-policy.md §E2E data-seeding strategy`:

| persistence_layer   | Strategy | Helper imported into synthesized specs                         | Per-test cost | Empirical reference                                                                    |
| ------------------- | -------- | -------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------- |
| `localStorage`      | A        | `apps/web/e2e/helpers/seed-localstorage.ts` (`clearAndReload`) | ~10ms         | `kanban-webapp-09/apps/web/e2e/board.spec.ts:23`                                       |
| `external-api-only` | D        | `apps/web/e2e/helpers/seed-intercept.ts` (`clearMocks`)        | ~0ms          | `repo-health-dashboard-01/apps/web/e2e/compare.spec.ts:15`                             |
| `real-db`           | C        | `apps/web/e2e/helpers/seed-db.ts` (`seedFixtures`/`cleanup`)   | 50–500ms      | book-swap (first DB-backed; canonical FastAPI shape in python-fastapi/SKILL.md §3 E2E) |

The architect skill copies the appropriate template from `.claude/templates/seed-{strategy}.ts.template` into `apps/web/e2e/helpers/seed-{strategy}.ts` at the project's architect step (see `.claude/skills/architect/SKILL.md §7d`). The web-frontend-builder MUST NOT modify the helper file's exports — they're the contract the synthesizer + tester-authored specs both consume. If the project's seeding pattern needs a primitive the template doesn't ship (e.g. `seedAuthCookies` for a project that mixes localStorage + a server cookie), open a kit-change-request rather than inline-editing the helper.

Tester responsibilities (when authoring E2E specs alongside the synthesized ones):

1. Read which strategy applies before authoring — check `architecture.yaml.tooling.stack.persistence_layer`.
2. Strategy A: `test.beforeEach: clearAndReload(page)` (the synthesizer emits this automatically for synthesized specs; hand-authored specs MUST follow the same pattern). Pre-seed via `seedLocalStorage(page, { ... })` when the test needs non-empty starting state.
3. Strategy D: install mocks per-test via `mockApiResponse(page, urlPattern, response)` in the test body BEFORE the first navigate; the synthesizer emits `clearMocks(page)` in `afterEach` automatically so mocks don't leak across tests.
4. Strategy C: tests run AFTER `playwright/global-setup.ts` has seeded the read-only baseline. Mutation tests opt into `test.describe.serial` + author `beforeAll: seedFixtures(...)` / `afterAll: cleanupFixtures(...)`. The backend MUST be running with `ENABLE_TEST_SEED=1` (see `.claude/skills/agents/back-end/python-fastapi/SKILL.md §3 E2E data-seeding strategy` for the FastAPI implementation; equivalent gate exists for other backend stacks).

- **`apps/web/vitest.config.ts` initial scaffold** (bug-023): when authoring the initial config (only on the scaffold-fastapi / scaffold-next-app task or equivalent), include the SCAFFOLD-OWNED comment header at the top — gives downstream features inline guidance even if they don't read the SKILL.md:

  ```ts
  // SCAFFOLD-OWNED — DO NOT MODIFY per feature.
  // Test discovery is glob-based; new test files match the existing
  // `**/*.test.{ts,tsx}` + `**/*.spec.{ts,tsx}` patterns automatically.
  // Changes to this file go through a kit-change-request, NOT inline
  // edits during a feature's builder/tester dispatch. Per bug-023.
  import { defineConfig } from "vitest/config";
  ...
  ```

  Same comment header on `vitest.setup.ts` and `tsconfig.json` (with appropriate phrasing). This is in addition to the §6.5 Files NOT to modify section that documents the contract for builders/testers.

### 3a. Playwright runtime self-verify (feat-025 install-discipline)

Authoring `*.spec.ts` files without the runtime installed produces **unrunnable specs that silently fool downstream verification** (the post-Mode-B `/build-to-spec-verify` flow-execution stage will skip them, no failures surface, the builder thinks it's green). Discovery: kanban-webapp-10 shipped with 5+ `e2e/*.spec.ts` files but no `@playwright/test` in devDependencies — the project literally couldn't run any of them.

Before any agent commits a Playwright spec, the runtime MUST be installed + configured. The tester is the canonical owner per `.claude/agents/tester.md` §Self-verify discipline; builders confirm presence as a precondition before authoring component-tests-that-might-promote-to-spec.

**Required artifacts:**

1. `apps/web/package.json` devDependencies includes `@playwright/test` (^1.48.0 or newer)
2. `apps/web/playwright.config.ts` exists with the **MANDATORY `webServer:` block** documented in §3a.1 below (bug-041 Phase B 2026-05-03 — making this section's mandate explicit + machine-checkable per the synthesizer's bug-041 Phase A enforcement).
3. `apps/web/package.json` scripts includes `"test:e2e": "playwright test"`

#### 3a.1. Required `playwright.config.ts` template — COPY VERBATIM

Builder MUST emit this exact structure. Inline edits or omissions are bug-041 root causes — every flag below has a documented reason; deletion silently breaks the post-Mode-B verifier flow-execution stage.

**Decision table — `webServer.command` resolution (the only variable):**

| `architecture.yaml.tooling.stack.persistence_layer` | Strategy | `webServer.command`            | Why                                                                                 |
| --------------------------------------------------- | -------- | ------------------------------ | ----------------------------------------------------------------------------------- |
| `localStorage`                                      | A        | `"pnpm exec next dev"`         | Single-tier project; only the frontend boots; localStorage-only state               |
| `external-api-only`                                 | D        | `"node ../../scripts/dev.mjs"` | Multi-tier; dev.mjs propagates `.env.local` per bug-033 + handles port coordination |
| `real-db`                                           | C        | `"node ../../scripts/dev.mjs"` | Multi-tier + DB; same boot path as Strategy D                                       |
| (absent / unknown)                                  | -        | `"node ../../scripts/dev.mjs"` | Safe default — dev.mjs degrades gracefully when no apps/api/ exists                 |

**Template:**

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Bumped local from 0 → 1 for live-backend specs (real API calls have ~5% flake rate).
  // Strategy A (localStorage-only) projects can keep retries: 0 — deterministic.
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? "list" : "html",
  use: { baseURL: "http://localhost:3000", trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // ⚠️ MANDATORY — without webServer, playwright doesn't auto-boot the dev
  // server during tests; specs run against a down/empty backend → false-
  // positive flow failures (bug-041 empirical case: 2026-05-02 finance-track-01
  // where 9/9 synthesized E2E flows landed on "No accounts yet" because no
  // backend was running). The synthesizer's bug-041 Phase A check enforces
  // the block's presence at post-flight; absent → hard error in errors[].
  webServer: {
    command: "node ../../scripts/dev.mjs", // ← per decision table above
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
```

For Strategy A projects, replace `webServer.command` with `"pnpm exec next dev"` and drop the `timeout`/`stdout`/`stderr` extras (single-tier doesn't need them). For all other strategies (or unknown/absent persistence_layer), use the multi-tier form above verbatim — `scripts/dev.mjs` falls back gracefully when no `apps/api/` exists, so the multi-tier form is the safe default.

**Self-verify before reporting task complete:** after writing playwright.config.ts, read it back + grep for `webServer:` substring. If absent (or partially typed), edit to add the block per the decision table. Bug-041 root cause was builder omitting the block silently; this self-verify closes the gap.

**Install command** (run from project root): `pnpm -C apps/web add -D @playwright/test && pnpm -C apps/web exec playwright install chromium`. The `playwright install` step downloads the browser binary (~150MB); skip it if CI provisions a pre-cached browser image. The orchestrator's `scripts/run-synthesized-flows.mjs` pre-flight checks the three artifacts above and gracefully degrades (warning, not failure) if any are missing — but the project still ships unrunnable specs, so the tester must close the gap.

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

## Review

Stack-specific checks the reviewer agent runs IN ADDITION to `docs/reviewer-playbook.md`'s generic 7 dimensions. Scope: files in the feature's diff under `apps/web/`.

#### security — `dangerouslySetInnerHTML` usage

- **Invocation**: `grep -rnE "dangerouslySetInnerHTML" apps/web/`
- **Threshold**: every hit must be accompanied by an `isomorphic-dompurify` / `DOMPurify.sanitize` call on the same or immediately-adjacent line; raw HTML from user input with no sanitizer is a fail
- **Retry target**: web-frontend-builder
- **Playbook §**: augments §2.2 XSS

#### performance — `<img>` vs `next/image`

- **Invocation**: `grep -rnE "<img\s" apps/web/`
- **Threshold**: zero hits outside of `apps/web/**/icon-*.tsx` or `<svg><image>` patterns — `next/Image` handles LCP + CLS + format negotiation; raw `<img>` breaks the bundle-budget gate
- **Retry target**: web-frontend-builder
- **Playbook §**: augments §6 performance (LCP + bundle-budget sub-checks)

#### architecture — server vs client boundary

- **Invocation**: `grep -rlE "useState|useEffect|useRef|onClick=|onChange=" apps/web/` → cross-reference against `grep -L "^\"use client\"" <file>`
- **Threshold**: every file that uses interactivity hooks / event handlers MUST declare `"use client"` at the top. Cross-check opposite direction too: `grep -rlE "async function.*\{" apps/web/app/` — async server components must NOT also declare `"use client"`
- **Retry target**: web-frontend-builder
- **Playbook §**: augments §1 architecture (Next 15 App Router layering)

#### a11y — icon-only buttons without accessible label

- **Invocation**: `grep -rnB1 -A3 "<Button" apps/web/ | grep -E "<(Icon|svg)" | grep -vE "aria-label|aria-labelledby"`
- **Threshold**: every icon-only button has `aria-label` OR wraps an `<sr-only>` span with descriptive text
- **Retry target**: web-frontend-builder
- **Playbook §**: augments §5 a11y

#### architecture — secrets in client bundle

- **Invocation**: `grep -rnE "process\.env\.[A-Z_]+" apps/web/` then cross-reference each match against `.env.example` — any env-var name WITHOUT `NEXT_PUBLIC_` prefix referenced inside a `"use client"` file or server action exposed to a client is a fail
- **Threshold**: zero hits of non-`NEXT_PUBLIC_` env-vars reachable from client bundle
- **Retry target**: web-frontend-builder
- **Playbook §**: augments §2 security (secret-leak sub-check)

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

## 6.5. Files NOT to modify (bug-023 + bug-024)

These files are **scaffold-owned**: configured at scaffold time and intentionally NOT edited per feature. New test files match the existing globs automatically; nav-target lists are auto-discovered; tsconfig paths are architect-owned. If you believe one MUST change, that's a kit-change-request — emit one via `docs/screens/kit-change-requests/` instead of modifying inline.

- `apps/web/vitest.config.ts` — globs (`**/*.test.{ts,tsx}`, `**/e2e/**` exclude) auto-discover all features' test files
- `apps/web/vitest.setup.ts` — global test setup; per-test setup goes in the test file itself
- `apps/web/next.config.ts` — only architect or kit-change-request flow modifies this
- `apps/web/tailwind.config.ts` — kit-bump only
- `apps/web/tsconfig.json` — paths are architect-owned

Empirical motivation: parallel features each touching `vitest.config.ts` cause merge conflicts on close-feature (~3-5 min/conflict via reviewer-mediated resolution). On a high-fan-out 8-feature DAG that's 10-30 min wasted wall-clock per run. Verified via repo-health-dashboard-01 (commits 87e86c7 + ba36d2f resolved two of these conflicts manually).

If your worktree's `git status --porcelain` shows any of the files above as modified, your task is over-scoped. Revert the change + add the actual edit you needed somewhere in the allowed surface (test file, source file under `apps/web/components`, etc.).

## 7. Anti-patterns

- **Never `useEffect`-fetch in a server component.** Move the fetch up to the page's default export or a server wrapper.
- **Never wrap the whole app in `"use client"`.** Defeats the server-component default + ships the whole React tree as a client bundle.
- **Never inline `<style>` tags.** Kit tokens + Tailwind utilities only. Inline styles are banned per `@repo/ui-kit/CONTRACT.md`.
- **Never import from `@repo/ui-kit/src/...`.** Deep imports bypass the barrel. Only `@repo/ui-kit` (root) is a valid import path — consumer tsconfig enforces this.
- **Never redeclare a Zod schema in a component.** Import from `@repo/types` — single source of truth.
- **Never call `router.push()` in a server component.** Use `redirect()` from `next/navigation`.

## Self-verify (RUN BEFORE REPORTING TASK COMPLETE)

After authoring code + tests for a task, run these commands IN ORDER from the worktree root. Each must succeed before you report `taskStatus: "completed"` for that task. ANY failure → set `taskStatus: "failed"` for the task and surface the stderr in the `errors` field of your return JSON.

```bash
# 1. Install: catches "I added a package.json line but the lockfile doesn't have it"
pnpm install

# 2. Typecheck: catches missing types, v3-vs-v5 SDK pattern drift, kit contract violations
pnpm --filter @repo/web typecheck

# 3. Tests: runs the .test.tsx + .test.ts files you authored
pnpm --filter @repo/web test

# 4. Kit consumer contract: catches @repo/ui-kit deep-imports, hex colors, arbitrary Tailwind values
pnpm ui-kit:validate-consumer
```

If you skip ANY of these commands, your task will fail downstream when feat-018's commit-discipline gate evaluates. The orchestrator will mark the feature failed via `feature-no-commits`. Save yourself the round-trip: run the four commands.

If `pnpm install` fails because of a registry network issue, retry once with `--prefer-offline`. If still failing, report the failure verbatim — don't try to work around it.

## 8. References

- [Next.js 15 docs](https://nextjs.org/docs) — App Router, Server Components, Server Actions
- [React 19 release notes](https://react.dev/blog/2024/12/05/react-19) — `use()` hook, Actions, form status
- [Tailwind CSS v4 migration](https://tailwindcss.com/docs/v4-beta) — `@theme` directive, lightning-css engine
- [Vitest + React Testing Library](https://vitest.dev/guide/testing-types) — vitest config for RTL
- Blueprint §17 / Appendix E — stack-skill shelf policy
- `packages/ui-kit/CONTRACT.md` — consumer contract (the six rules)
