---
id: bug-077-react-next-tailwind-pipeline
type: bug
status: draft
author-agent: human
created: 2026-05-08
updated: 2026-05-08
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/react-next-tailwind-pipeline
affected-files:
  - .claude/skills/agents/front-end/react-next/SKILL.md
  - .claude/skills/ui-designer/SKILL.md
  - scripts/build-to-spec-verify.mjs
feature-area: front-end
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "Tailwind utilities silently produce zero CSS — apps/web pages render unstyled despite class names being present in DOM"
reproduction-steps: "spin any factory-shipped web project's dev server (e.g. cd projects/reading-log-02 && node scripts/dev.mjs); browse to http://localhost:3000; observe page renders raw HTML with class attributes intact but no Tailwind utility CSS applied (no flex layout, no spacing, no colors)"
stack-trace: null
---

# bug-077-react-next-tailwind-pipeline: react-next scaffold ships without working Tailwind CSS pipeline

## Bug Description

**Every web project scaffolded from the factory's `react-next` stack skill ships with a broken Tailwind CSS compilation pipeline.** Class names appear in the DOM (because they're typed in source code) but produce **zero CSS output** because the two pieces required for Tailwind 3 to work are missing:

1. **No `postcss.config.{js,mjs,cjs}` anywhere in the project.** Tailwind 3 needs PostCSS as its entrypoint into Next.js's build. Without it, Next compiles CSS as raw passthrough — `@tailwind` directives become invalid CSS that browsers ignore.
2. **No `@tailwind base; @tailwind components; @tailwind utilities;` directives in any CSS file in the repo.** Even if PostCSS were configured, there'd be no injection point for Tailwind to insert utilities. Verified via `grep -rE "@tailwind|@apply" packages/ui-kit/src/` returns zero hits.

Empirical validation: searched `git log --all -S "@tailwind" -- "**/*.css"` on `projects/reading-log-02/` — **zero commits in the project's entire history have ever added these directives.** This means the project never rendered styled content, throughout any pipeline run, in any iteration of any bug-fix loop. Same expected for every other shipped factory web project.

The bug surfaces at the project's first manual visual inspection of the running dev server. Pipeline-internal verification stages do not catch it (see Why The Bug-Fix Loop Missed It).

## Reproduction Steps

1. `cd projects/reading-log-02` (or any factory-shipped web project)
2. `node scripts/dev.mjs` — boots api on :3001, web on :3000 cleanly
3. Browse to `http://localhost:3000/`
4. Observe: page renders with raw HTML structure (text content, buttons, inputs all present) but with **no Tailwind utility styles applied** — no flex layout, no spacing, no theming, no border radii, no font sizing
5. Inspect element → confirm class attributes are intact (e.g. `class="mx-auto w-full max-w-[980px] flex items-center"`) but `getComputedStyle()` shows none of those utilities resolve
6. `find . -name "postcss.config*" -not -path "*/node_modules/*"` → zero results
7. `grep -rE "@tailwind base" --include="*.css"` → zero results

## Error Output

```
# project file inventory:
$ find projects/reading-log-02 -maxdepth 5 -iname "postcss.config*" -not -path "*/node_modules/*"
(empty)

$ grep -rnE "@tailwind|@apply" projects/reading-log-02/packages/ui-kit/src/
(empty)

$ grep -rnE "@tailwind|@apply" projects/reading-log-02/apps/web/ --include="*.css"
(empty)

# stack-skill scaffold tree (the canonical source):
$ grep -nE "postcss|@tailwind base" .claude/skills/agents/front-end/react-next/SKILL.md
417:    "postcss": "^8.4.0",                  # in devDeps, but no config file scaffolded
619:@tailwindcss/postcss 4.0.0-beta.7         # version-list mention only
620:postcss              8.4.x                 # version-list mention only

# Result: postcss is in package.json devDeps but never wired into a working
# config; @tailwind directives never authored in any scaffold-time CSS file.
```

## Root Cause Analysis

### Where the gap lives

The canonical scaffold source is `.claude/skills/agents/front-end/react-next/SKILL.md`. Its directory tree (lines 38-50) lists:

```
├── tailwind.config.ts            # extends @repo/ui-kit/tokens
├── tsconfig.json                 # extends @repo/ui-kit/tsconfig.consumer.json
├── package.json
├── .env.example                  # NEXT_PUBLIC_API_BASE contract (bug-032 Phase C)
└── .env.local                    # gitignored; user-authored from .env.example
```

**No `postcss.config.{js,mjs}` entry.** The skill's package.json template (line 417) lists `postcss: ^8.4.0` as a devDep but nothing scaffolds the matching config file.

The `@tailwind` directives are likewise missing. The ui-kit's globals.css template (consumed via `import "@repo/ui-kit/styles/globals.css"` in apps/web/app/layout.tsx) has CSS reset + tokens + fonts but no `@tailwind base/components/utilities` injection points. Because the ui-kit is owned by the design pipeline (`/stylesheet` stage authored by ui-designer), the gap may also live in `.claude/skills/ui-designer/SKILL.md` or whatever template it uses for globals.css.

### Why mockups looked fine despite the same gap

Mockups (`docs/screens/webapp/*.html`) use the **Tailwind Play CDN** per memory `feedback_html_preview_tailwind`: every mockup HTML inlines `<script src="https://cdn.tailwindcss.com">` plus a `tailwind.config = {...}` block. CDN-injected Tailwind generates utilities on-the-fly in the mockup's iframe → mockups render fully styled. The build's apps/web has no such fallback.

### Why the bug-fix loop missed it (the deeper question)

Each verifier layer in the fix-bugs loop has a known blindspot for this class:

| Layer                             | Result                     | Why                                                                                                                                                                                  |
| --------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm build` / `next build`       | passes                     | Next treats unmatched `@tailwind` directives as raw CSS — no compile error. Ditto for an empty CSS file.                                                                             |
| dev-server-compile probe          | passes                     | Server boots, serves /, returns 200. Bug is _runtime visual_, not _server error_.                                                                                                    |
| Synthesized E2E flows (flow-1..6) | passes                     | Playwright asserts on `data-screen-id`, text content, `getByRole`. All structural — selectors don't care if `class="flex"` actually computes flex.                                   |
| Visual parity verifier            | passes (load-bearing miss) | Compares **DOM structure + class-attribute strings** between mockups (CDN-styled) and live build (no CSS). Both have `<div class="flex items-center">`; structural diff = identical. |
| Reachability / orphan check       | n/a                        | Doesn't touch CSS pipeline.                                                                                                                                                          |

The single load-bearing miss: the parity verifier audits _what classes exist on each element_, not _what CSS rules those classes resolve to_. `investigate-022 Step 3` (commit `7bfc996`) wired `audit-computed-styles` into parity-verify intending to close exactly this gap, but either the audit didn't fire on this project, or its threshold is too lenient, or it needs a baseline this project's tokens don't expose. **The audit-computed-styles surface is the natural detection layer for this bug class** — see Phase D below.

## Fix Approach

### Phase A — react-next scaffold (canonical fix site, ships immediately)

1. **`.claude/skills/agents/front-end/react-next/SKILL.md`** — add `postcss.config.mjs` to the directory tree (between `tailwind.config.ts` and `tsconfig.json`):
   ```
   ├── postcss.config.mjs            # Tailwind 3 + autoprefixer pipeline (bug-077)
   ```
   Plus a sample-content block immediately after the `tailwind.config.ts` content section:
   ```js
   // apps/web/postcss.config.mjs
   export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
   ```
2. Add a "**Tailwind directives must live in the CSS entrypoint**" gotcha to the skill's §Gotchas section. Authoritative entrypoint is the consumed `@repo/ui-kit/styles/globals.css` (or apps/web's own globals if the skill prefers that boundary — doc the choice).

### Phase B — ui-designer / @repo/ui-kit scaffold (where globals.css is templated)

3. **`.claude/skills/ui-designer/SKILL.md`** (or wherever `packages/ui-kit/src/styles/globals.css` is generated) — prepend the `@tailwind` directives:

   ```css
   @tailwind base;
   @tailwind components;
   @tailwind utilities;

   @import "./fonts.css";
   @import "../tokens/tokens.css";
   ```

4. Decide the boundary explicitly: should the directives live in `@repo/ui-kit`'s globals.css (current ui-kit-owns-CSS pattern, simpler for consumers) OR in `apps/web/app/globals.css` (cleaner package boundary — apps/web owns its build pipeline)? Document the decision in both stack-skill + ui-designer skill.

### Phase C — backfill shipped projects

5. Catalog all shipped factory web projects (estimated: kanban-webapp-09, repo-health-dashboard-01, finance-track-01, reading-log-01, reading-log-02, plus any pre-builds). For each, ship the 2-file fix:
   - `apps/web/postcss.config.mjs` (3-line file)
   - `@tailwind` directives prepended to whichever CSS entrypoint that project uses
     Track via a small migration checklist; each project gets one tiny PR.

### Phase D — close the bug-fix loop's detection gap (the deeper fix)

6. Audit `scripts/build-to-spec-verify.mjs` (or wherever `audit-computed-styles` is wired) — investigate why the existing `investigate-022 Step 3` audit didn't catch reading-log-02's missing-CSS state. Likely root cause: the audit needs at least one baseline class to compare; if the baseline expects `display: flex` from `class="flex"` and gets `display: block` from no-CSS, the diff is detectable, but only if the audit RUNS.
7. Add a **"first-pixel" smoke step** to the verifier: render the home page, take a screenshot, compute `getComputedStyle()` on `body` — if the computed background-color, font-family, OR root-element-padding all match browser defaults (no theming applied), file a `tooling-css-pipeline-broken` bug class with `agentSequence: [bug-fixer]`. Cheap, deterministic, catches the entire class.
8. Spec test: a deliberately-broken project (postcss config removed) should make the verifier emit the new bug class on its first run.

## Rejected Fixes

- **Move @tailwind directives to apps/web/app/globals.css instead of @repo/ui-kit's** — Rejected for Phase A because: the ui-kit pattern centralizes "consumer imports one stylesheet" (per `packages/ui-kit/src/styles/globals.css` header comment). Reverting that pattern is a bigger boundary change than this bug requires. Reconsider in Phase B as part of the explicit boundary decision.
- **Use Tailwind 4's `@tailwindcss/postcss` plugin (per the version mentions on lines 619-620 of the react-next skill)** — Rejected for Phase A because: every shipped factory web project pins Tailwind 3 in apps/web/package.json; Tailwind 4 migration is a separate decision with its own breaking changes. The 619-620 mentions appear stale — recommend cleaning them up in Phase A so future agents don't get confused about which version is canonical.
- **Add Tailwind Play CDN to apps/web's HTML head as a fallback (mirror the mockup pattern)** — Rejected because: the CDN explicitly says "do not use in production", performance is dramatically worse than build-time compilation, and it would mask the real bug instead of fixing it.
- **File as a 4-phase factory-and-project bug with stop-the-line urgency** — Rejected because: shipped projects "work" for the operator's actual use cases (the design pipeline produces visually-correct mockups + the run-the-app step is rare during the autonomous build phase). P0 priority + Phase A immediate ship is the right urgency level; stop-the-line would over-rotate.

## Validation Criteria

1. **Phase A canonical**: a fresh `/new-project` scaffold from the updated skill produces an apps/web/ that includes `postcss.config.mjs`. Confirmed via `find apps/web -name "postcss.config*"` returning the file.
2. **Phase B canonical**: the ui-kit's scaffolded globals.css starts with `@tailwind base; @tailwind components; @tailwind utilities;`. Confirmed via `head -5 packages/ui-kit/src/styles/globals.css | grep -c "@tailwind"` returning 3.
3. **Phase A+B integration**: spinning the new project's dev server (`node scripts/dev.mjs`) and browsing localhost:3000 shows fully styled UI — flex layouts work, spacing applied, theme tokens render. Test via `getComputedStyle(body).fontFamily` returning the project's primary font (not browser default `serif`).
4. **Phase C backfill**: each shipped project gets the 2-file patch and the same dev-server-spin test passes. Empirically verify on `reading-log-02` first (already manually patched in this session) — confirm the fix is durable + reproducible.
5. **Phase D detection**: deliberately re-break a project (`rm apps/web/postcss.config.mjs`), run `/build-to-spec-verify`, confirm the verifier emits a `tooling-css-pipeline-broken` bug. Confirms the loop now self-detects.
6. **No false positives**: a correctly-configured project never emits the new bug class. Run all 5 shipped projects post-Phase-C and confirm zero spurious detections.

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->
