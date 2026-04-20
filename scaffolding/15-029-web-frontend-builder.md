---
task-id: "029"
title: "Web Frontend Builder Agent"
status: pending
priority: P2
tier: 7 — Build Pipeline
depends-on: ["020", "027", "022b", "024", "025", "028"]
estimated-scope: medium
---

# 029: Web Frontend Builder Agent

## What This Task Produces

1. Agent definition at `.claude/agents/web-frontend-builder.md`
2. Skill at `.claude/skills/build-web-frontend/SKILL.md`

Both are locked to the **UI Kit consumption contract** (task 022b). The builder translates the signed-off HTML screens in `docs/screens/` into production Next.js pages that import exclusively from `@repo/ui-kit`.

## Why This Scope (per refactor-001)

Three concrete changes from the prior spec:

1. **Kit-only imports enforced mechanically.** The builder embeds `packages/ui-kit/CONTRACT.md` in its system prompt verbatim AND runs `pnpm ui-kit:validate-consumer` against its output before reporting success. Any violation fails the build — no "but shadcn would be easier" escape hatch.
2. **shadcn/ui dropped from the stated stack.** The UI Kit IS our component library; shadcn was the old spec's fallback for primitives we didn't have. The new kit has ≥20 primitives + ≥12 patterns + ≥5 layouts by construction (task 024), so shadcn is unnecessary and would introduce a parallel component library that violates the single-source-of-truth thesis.
3. **Kit version pinned and verified.** The builder reads `packages/ui-kit/package.json.version` and asserts it matches `docs/signoff-{timestamp}.json.uiKitVersion`. If they differ, the build aborts — sign-off is tied to a specific kit release (task 025).

## Scope

### Agent Definition

```yaml
---
name: web-frontend-builder
description: Builds Next.js frontend (apps/web, apps/admin) by translating docs/screens/**/*.html into JSX that imports exclusively from @repo/ui-kit. Runs ui-kit:validate-consumer post-generation; fails on any contract violation.
tools: Read, Write, Edit, Bash, Grep, Glob
model: inherit
permissionMode: acceptEdits
maxTurns: 40
skills:
  - react-patterns
  - nextjs-app-router
---
```

Note: `tailwind-conventions` and any shadcn-related skills are removed from the frontmatter. The kit owns Tailwind config; builders don't hand-author it.

### System Prompt — the UI Kit Contract (verbatim embed)

The agent's system prompt begins with the opening mandate, then embeds the CONTRACT.md content from `packages/ui-kit/CONTRACT.md` (factory template at `.claude/templates/ui-kit-contract.md`) verbatim. The contract's six numbered rules live in the prompt unaltered — any plugin or skill update doesn't change them.

```
You are a Senior Next.js engineer. You translate signed-off HTML screens
into production React/JSX. You consume the project's UI Kit and nothing
else for UI.

## Stack (locked by architecture.yaml)

- Next.js 15 App Router (file-based routing)
- React 19
- @repo/ui-kit for ALL UI (primitives, patterns, layouts, tokens, icons)
- @repo/types for shared Zod schemas and types
- @repo/api-client for tRPC client hooks
- TypeScript strict mode

## Your inputs

1. `docs/signoff-{latest}.json` — the approved sign-off. You pin its
   `uiKitVersion` and refuse to build if `packages/ui-kit/package.json.version`
   differs.
2. `docs/screens/webapp/*.html` and `docs/screens/admin/*.html` — the
   HTML previews you translate into JSX. Structure and composition are
   authoritative; Tailwind classes in the HTML are your guide to which
   kit variants to pass.
3. `docs/selected-style.json` — the approved style (for sanity-checking
   that accent/font references in the HTML match the kit).
4. `architecture.yaml` — apps.web and apps.admin sections for routing,
   auth, state management.
5. `packages/ui-kit/src/index.ts` — the ONLY import surface for UI.

--- BEGIN UI KIT CONTRACT (from packages/ui-kit/CONTRACT.md) ---
[verbatim inclusion of the six numbered rules + allowed escape hatches
 + enforcement section + "when rules conflict with reality" section
 from the contract]
--- END UI KIT CONTRACT ---

## Translation rules (HTML → JSX)

The `/screens` skill (task 025) emits **data attributes** on every HTML element
that corresponds to a kit primitive / pattern / layout. This is the deterministic
translation key — you read these attributes, NOT the Tailwind class string (which
is a derived output of CVA and not reliably invertible).

Attribute shape 025 emits:

  <button data-kit-component="Button"
          data-kit-variant="primary"
          data-kit-size="md"
          data-kit-props='{"disabled":false}'
          class="<CVA-derived Tailwind classes>">
    Save
  </button>

Your translation:

  <Button variant="primary" size="md">Save</Button>

Rules:

- Element with `data-kit-component="X"` → `<X>` imported from `@repo/ui-kit`
- Element with `data-kit-variant="Y"` → pass `variant="Y"` prop
- Element with `data-kit-size="Z"` → pass `size="Z"` prop
- Element with `data-kit-props='{"k":"v", ...}'` → spread the JSON as extra props
- Top-level element with `data-kit-layout="AppShell"` → wrap the whole screen in `<AppShell>`
- Text nodes and children that have no `data-kit-*` attributes transfer verbatim
- Remove ALL Tailwind class strings from the JSX — the kit component applies its own classes via CVA at runtime. The HTML's Tailwind was only for the preview render.
- If an HTML element has `data-kit-component` but your kit's barrel doesn't export that name, STOP and emit a kit-change-request (see below). Do NOT build it locally.
- If an HTML element has NO `data-kit-*` attributes (e.g., pure layout `<div>` wrappers for CSS grid/flex): keep as `<div>` with the same Tailwind utility classes (layout utilities are allowed per the kit contract rule 6).

## Post-generation enforcement

After writing each app's source, you MUST run:
  pnpm ui-kit:validate-consumer 'apps/web/{app,src}/**/*.{ts,tsx}'
  pnpm ui-kit:validate-consumer 'apps/admin/{app,src}/**/*.{ts,tsx}'
  pnpm --filter web typecheck
  pnpm --filter admin typecheck
  pnpm --filter web lint
  pnpm --filter admin lint

If any fail, fix and re-run. Do not report success with unresolved
violations.
```

### /build-web-frontend Skill

```yaml
---
name: build-web-frontend
description: Translate docs/screens/webapp and docs/screens/admin into Next.js apps. Enforces the UI Kit contract via validate-consumer + typecheck + lint.
allowed-tools: Read Write Edit Bash Grep Glob
model: inherit
argument-hint: "[--app web|admin|both]"
---
```

### Prerequisites

- `/screens` completed and `/user-flows-generator` sign-off received (`docs/signoff-{timestamp}.json` exists with `approved: true`)
- `packages/ui-kit/` populated by `/stylesheet` (24); version pinned in signoff
- `docs/screens/webapp/*.html` exists; `docs/screens/admin/*.html` exists if admin is in the target platform list
- `architecture.yaml.apps.web` and/or `apps.admin` blocks filled (produced by `/architect` post-signoff per refactor-003)
- **`.env` populated by user at gate 5** — refactor-003. Runtime public vars (e.g., `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_MAPBOX_TOKEN`) get baked into the Next.js client bundle at `next build` time. The builder reads `.env` to know which public keys to wire into the build config. **Never wires `*_SECRET_KEY` or `*_SECRET` keys into the client bundle** — those are backend-only. Reviewer (task 032) scans built output for leaked secret-prefixed keys per its "no secrets in code" criterion. Missing required public keys surface at `next build` as loud failures.

### Steps

1. **Pin the kit version.** Identify the most recent `docs/signoff-*.json` (max ISO-8601 timestamp in filename; if multiple share a timestamp, highest mtime wins). Verify `approved === true`. Read `packages/ui-kit/package.json.version`. Abort if they differ — sign-off is bound to a specific kit release.
2. **Read architecture.yaml** apps.web and/or apps.admin sections (routing, auth strategy, state management, API base URL, env vars)
3. **Read the UI Kit barrel** `packages/ui-kit/src/index.ts` to enumerate what's available. Build an internal map of `{ className → component variant }` by reading each primitive's `.variants.ts` file — this is the HTML-to-JSX translation key.
4. **For each screen** in `docs/screens/webapp/**/*.html` and `docs/screens/admin/**/*.html`:
   a. Parse the HTML file
   b. Identify the top-level layout; pick the matching kit layout component
   c. Walk the HTML tree; replace recognized kit-matching elements with their React component forms
   d. Preserve content verbatim; only styling/structure swaps to components
   e. Emit as `apps/{app}/src/app/{route}/page.tsx` (Next.js 15 App Router convention)
   f. If an HTML construct can't be mapped, emit `docs/screens/kit-change-requests/{screen-id}.md` (same format as 025's kit-change-request) and HALT the build for that app. Orchestrator picks up the request.
5. **Wire the data layer**: generate tRPC client calls using `@repo/api-client` hooks; wire auth / session / loading / error states per architecture.yaml
6. **Configure Next.js**: `next.config.js`, `tailwind.config.ts` extending the kit's preset, `postcss.config.js`, `tsconfig.json` extending `@repo/tsconfig/nextjs.json`
7. **Root layout** (`apps/{app}/src/app/layout.tsx`): import `@repo/ui-kit/styles/globals.css`, set up providers (tRPC, theme)
8. **Run enforcement gate**:
   - `pnpm ui-kit:validate-consumer 'apps/web/{app,src}/**/*.{ts,tsx}'` (and admin)
   - `pnpm --filter web typecheck`
   - `pnpm --filter admin typecheck`
   - `pnpm --filter web lint`
   - `pnpm --filter admin lint`
   - If any fail, emit structured violations and retry with feedback (max 3 attempts); if still failing, flag for human review
9. **Report** — return JSON matching `BuildWebFrontendOutput` (task 034b)

### Kit-change-request handling (shared with 025) — post-sign-off is catastrophic

Hitting a missing primitive / pattern / variant at THIS stage is an **escalation signal, not a routine path**. By the time the builder runs, `/screens` (025) has already enumerated every primitive used across every screen and emitted kit-change-requests as needed; the kit has already been bumped, re-run through /stylesheet, and the sign-off binds a specific kit version. A kit-change-request triggered by the builder means one of:

1. `/screens` missed a primitive during its own enumeration (bug in 025)
2. The kit was manually reverted between sign-off and build
3. A `data-kit-component` attribute in the HTML references a name that doesn't exist in the current kit's barrel

If it happens anyway:

1. Emit `docs/screens/kit-change-requests/{screen-id}.md` with:
   - Which primitive / pattern / variant is missing
   - The HTML snippet that would need it
   - Suggested API shape (prop names, variant values)
2. HALT the build for the affected app
3. The orchestrator (035) escalates: this invalidates the existing sign-off (the kit would bump to a new minor version, breaking `signoff.uiKitVersion`), so the pipeline re-enters `/screens → /visual-review → /user-flows-generator → sign-off` — a full design-pipeline restart. The human is notified with a red flag explaining the regression.

Builders never implement local workarounds.

### What NOT to do (negative scope — reinforces the contract)

- Do NOT install shadcn/ui, Radix UI, Material UI, Chakra, or any other component library. `@repo/ui-kit` is the component library.
- Do NOT author a `components/` directory inside `apps/web/` or `apps/admin/` for UI. The kit is authoritative.
- Do NOT write inline `className` with hex codes, arbitrary Tailwind values, or raw px.
- Do NOT deep-import `@repo/ui-kit/primitives/*` — the barrel `@repo/ui-kit` is the only surface.
- Do NOT generate `globals.css` inside `apps/`; the kit's `globals.css` is imported from the kit.

Any of these trigger validate-consumer errors or ESLint errors and block the build.

### Return JSON

```json
{
  "success": true,
  "appsBuilt": ["web", "admin"],
  "uiKitVersion": "1.0.0",
  "pagesGenerated": { "web": 48, "admin": 18 },
  "kitChangeRequests": [],
  "validateConsumerResult": { "web": "clean", "admin": "clean" },
  "typecheckResult": "pass",
  "lintResult": "pass",
  "retriesTriggered": 0,
  "warnings": []
}
```

### Runs in Parallel with Mobile

Web and mobile frontend builders run concurrently after `/stylesheet` + `/screens` + sign-off. They share the same kit version (pinned).

## Integration Points

- **Task 020** (Architect): produces `architecture.yaml.apps.web` + `apps.admin` — read here
- **Task 021** (PM agent): handles kit-change-requests flow when this builder halts
- **Task 022b** (UI Kit contract): CONTRACT.md embedded verbatim in system prompt; `validate-consumer.ts` runs post-generation; ESLint plugin's rules block violations at lint time
- **Task 024** (/stylesheet): produced `packages/ui-kit/` with CVA variants — this builder reads `.variants.ts` to build the HTML→JSX translation map
- **Task 025** (/screens): produced the HTML previews this builder translates; shares the kit-change-request flow
- **Task 027** (shared packages): scaffolded the workspace + `@repo/ui-kit` skeleton
- **Task 032** (Reviewer agent): asserts the builder's output passes the consumer contract at PR-review time
- **Task 034b** (schemas): `BuildWebFrontendOutput` schema covers the return JSON
- **Task 035** (orchestrator): invokes this skill in parallel with `/build-mobile-frontend`
- **Task 036** (HITL gates): sign-off verification — the builder fails if signoff.uiKitVersion ≠ kit's current version

## Acceptance Criteria

- [ ] `.claude/agents/web-frontend-builder.md` exists with the updated frontmatter (no shadcn/tailwind-conventions skills; react-patterns + nextjs-app-router only)
- [ ] System prompt embeds the CONTRACT.md verbatim (six rules + escape hatches + enforcement)
- [ ] System prompt drops shadcn/ui from the stated stack
- [ ] Stack lists: Next.js 15 App Router, React 19, @repo/ui-kit, @repo/types, @repo/api-client, TypeScript strict — nothing else for UI
- [ ] `.claude/skills/build-web-frontend/SKILL.md` exists
- [ ] Skill pins kit version from sign-off and aborts on mismatch
- [ ] Skill builds HTML→JSX translation map by reading each primitive's `.variants.ts`
- [ ] Skill emits `kit-change-request.md` and halts on unmappable HTML (does not build locally)
- [ ] Skill runs `pnpm ui-kit:validate-consumer` + typecheck + lint post-generation and fails on any violation
- [ ] Retry-with-feedback on enforcement failure (max 3 attempts)
- [ ] Root layout imports `@repo/ui-kit/styles/globals.css` (not a locally-authored globals.css)
- [ ] No `components/` directory created inside `apps/web/` or `apps/admin/` for UI
- [ ] No shadcn/radix/mui/chakra packages in `apps/*/package.json`
- [ ] Return JSON matches `BuildWebFrontendOutput` in 034b
- [ ] Runs in parallel with `/build-mobile-frontend`
- [ ] HTML → JSX translation uses `data-kit-*` attributes (emitted by 025), NOT pattern-matching on Tailwind class strings; Tailwind classes stripped from JSX output since the kit component applies its own via CVA
- [ ] Depends on 028 (backend) because `@repo/api-client` hooks are typed against the tRPC router 028 produces
- [ ] Post-sign-off kit-change-request is documented as an escalation signal (not a routine path), including the design-pipeline-restart consequence
- [ ] "Latest" sign-off file is identified by max ISO-8601 timestamp in filename (mtime tiebreaker)

## Human Verification

1. Run `/build-web-frontend` after a successful sign-off. Do `apps/web/` and `apps/admin/` get generated?
2. Does every `page.tsx` import from `@repo/ui-kit`? Run `grep -r "from ['\"]@repo/ui-kit" apps/web/src/ | wc -l` — non-zero?
3. Run `grep -rE "bg-\[#|from ['\"]shadcn|Radix" apps/web/src/`. Are there zero matches?
4. Hand-inject a raw hex in a generated page. Does `pnpm ui-kit:validate-consumer` catch it?
5. Bump `packages/ui-kit/package.json.version` from 1.0.0 to 1.1.0 between sign-off and build. Does the builder refuse to run?
6. Hand-inject an HTML screen that uses a component not in the kit. Does the builder emit a kit-change-request and halt rather than building locally?
7. Does `pnpm --filter web typecheck` pass on the generated code?
