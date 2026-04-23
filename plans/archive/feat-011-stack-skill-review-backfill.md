---
id: feat-011-stack-skill-review-backfill
type: feature
status: completed
approved-at: 2026-04-23
approved-by: human
completed-at: 2026-04-23
author-agent: claude
created: 2026-04-23
updated: 2026-04-23
parent-plan: null
supersedes: null
superseded-by: null
branch: feat/stack-skill-review-backfill
affected-files:
  - .claude/skills/agents/back-end/node-trpc-nest/SKILL.md
  - .claude/skills/agents/back-end/python-fastapi/SKILL.md
  - .claude/skills/agents/front-end/react-next/SKILL.md
  - .claude/skills/agents/front-end/svelte-kit/SKILL.md
  - .claude/skills/agents/mobile/expo-rn/SKILL.md
  - .claude/skills/agents/_template/SKILL.md
feature-area: reviewer
priority: P1
attempt-count: 0
max-attempts: 5
---

# feat-011-stack-skill-review-backfill: stack-specific review criteria for the 5 shipped stack skills

## Problem Statement

The reviewer agent (feat-010) uses filter-then-load of per-tier stack skills' `§Review` / `§Gotchas` blocks to layer stack-specific checks on top of the generic 7-dimension playbook. All 5 shipped stack skills currently have `## 5. Gotchas` sections — but those are **builder-facing hints** ("if you do X, use Y"), not **reviewer-facing pass/fail criteria** ("grep for X; fail if matches > N; retry via builder Z"). The feat-010 smoke-test confirmed this: the reviewer emitted `stack-review-block-missing: node-trpc-nest` as a warning on the first live invocation, then fell back to the generic playbook. This backfill adds an explicit `## Review` section to each of the 5 shipped stack skills, structured to reviewer-playbook format, so live Mode B runs get stack-aware review coverage instead of graceful-degradation-only.

Trigger: feat-010 lessons learned §"Follow-up flagged from refactor-005 still applies: backfill §Review / §Gotchas blocks on the 5 shipped stack skills before first live Mode B run." Blocking first live run on hatch.

## Approach

Per stack skill, insert a new `## Review` section between §5 Gotchas and §6 Dependency pins. Each §Review block contains stack-specific augmentations to the generic playbook dimensions — not replacements. Format mirrors `docs/reviewer-playbook.md`: each check names an invocation (grep/command), a threshold, a retry target.

1. **Update `.claude/skills/agents/_template/SKILL.md`** — add the canonical §Review skeleton so future stack skills generated via `/skills-audit --auto-author-stack-skills` inherit it.
2. **Backfill node-trpc-nest** (`back-end/node-trpc-nest`) — architecture (module exports, tRPC router shape), security (raw-body webhook, input validation coverage), maintainability (procedure return-type inference), performance (Prisma N+1 patterns).
3. **Backfill python-fastapi** (`back-end/python-fastapi`) — architecture (dependency-injection via `Depends`, Pydantic model coverage), security (SQL-string interpolation, raw SQL in SQLAlchemy), maintainability (router discovery), performance (async vs sync endpoint mismatch).
4. **Backfill react-next** (`front-end/react-next`) — architecture (server vs client component boundary), a11y (`aria-*` + semantic-HTML grep), performance (bundle budget, Image vs img), security (XSS via `dangerouslySetInnerHTML`).
5. **Backfill svelte-kit** (`front-end/svelte-kit`) — architecture (+page.server.ts for auth/DB, no client secrets), a11y (same generic plus Svelte specifics), performance (load function parallelism), security (form actions + CSRF).
6. **Backfill expo-rn** (`mobile/expo-rn`) — architecture (file-based router, tab/stack layout conventions), a11y (accessibility props on pressables), performance (FlatList vs ScrollView, Image vs Expo.Image), security (SecureStore vs AsyncStorage for secrets).
7. **Verification**: each §Review section passes the reviewer's `loadStackReviewBlock(slug)` smoke-check — i.e. contains at least one stack-specific invocation and one retry-target reference; no `[TODO]` or placeholder text. Add a small `scripts/verify-stack-reviews.mjs` that greps each SKILL.md for `^## Review` + counts invocation-code-fences, confirming each stack has ≥3 concrete checks.

## Rejected Alternatives

- **Alternative A: rewrite §Gotchas as §Review (replace, not add)** — Rejected. §Gotchas are useful at BUILDER time ("don't do X because Y breaks"); §Review is useful at REVIEWER time ("grep for X; fail if matches"). These serve different agents. Collapsing loses the builder-facing framing; keeping both is cheap duplication of content framing (not content itself).

- **Alternative B: centralise stack checks in `docs/reviewer-playbook.md`** — Rejected. The playbook is stack-agnostic by design (refactor-005 binding); every stack-specific grep bloats it toward infinity as new stacks ship. Distributing checks to the per-stack SKILL.md keeps the playbook stable + aligns with feat-010's filter-then-load pattern.

- **Alternative C: defer until post-MVP** — Rejected. feat-010 flagged this as blocking first live Mode B run; the reviewer on live hatch will emit `stack-review-block-missing` for every tier and get only generic-playbook coverage. The MVP reviewer is meaningfully weaker without it. Cheap to close now (≤5 markdown edits, ≤300 lines).

- **Alternative D: exhaustive per-dimension coverage (≥1 check per dimension × 5 stacks = ≥35 checks)** — Rejected for first pass. Scope to 3-5 stack-specific checks per skill, covering the dimensions where that stack HAS stack-specific concerns. For dimensions where the generic playbook already covers the stack adequately (e.g. compliance — mostly data-flow, not stack-specific), leave the §Review block silent on that dimension. Can widen in a future pass.

## Expected Outcomes

- [ ] All 5 shipped stack skills have a `## Review` section between §Gotchas and §Dependency pins
- [ ] Each §Review has ≥3 stack-specific checks, each naming invocation + threshold + retry target
- [ ] Each §Review cites the generic playbook dimension it augments (e.g. "§Review — architecture · §2 security · §6 performance")
- [ ] `_template/SKILL.md` has the canonical §Review skeleton for future skills
- [ ] `scripts/verify-stack-reviews.mjs` passes for all 5 skills (≥3 checks each, zero placeholder text)
- [ ] `pnpm -r test` still green (no contract changes; this is skill-markdown only)
- [ ] Plan archived; first live Mode B run on hatch is unblocked

## Validation Criteria

- **Structural**: `grep -c "^## Review" <skill>` returns `1` for each of the 5 shipped skills + `_template`
- **Content**: each §Review contains ≥3 fenced code blocks (invocations) + ≥3 references to retry targets (`backend-builder` / `web-frontend-builder` / `mobile-frontend-builder`)
- **Dimension cross-reference**: each §Review names at least one playbook dimension it augments
- **Verifier script**: `node scripts/verify-stack-reviews.mjs` exits 0; reports per-skill check count
- **No regressions**: `pnpm -r typecheck && pnpm -r test` unchanged (313 tests green)
- **Reviewer-playbook alignment**: format of each §Review follows playbook's invocation / threshold / retry target rhythm

## Attempt Log

### Attempt 1 — 2026-04-23 — completed

Single pass; no rework needed.

- Added `## Review` (unnumbered, between §5 Gotchas + §6 Dependency pins) to all 5 shipped stack skills
- Each §Review has 5 stack-specific checks following the invocation / threshold / retry target / playbook-§ rhythm from `docs/reviewer-playbook.md`
- Coverage by stack:
  - **node-trpc-nest**: tRPC return-type inference, webhook raw-body, ConfigModule validation, Prisma N+1, circular-module deps
  - **python-fastapi**: SQL f-string injection, webhook raw body, sync-in-async event-loop block, response_model coverage, Depends() auth on protected routes
  - **react-next**: `dangerouslySetInnerHTML`, `<img>` vs `next/Image`, server/client boundary, icon-only button a11y, client bundle secret leak
  - **svelte-kit**: secrets in `+page.svelte`, DB/auth outside server files, sequential awaits in `load()`, CSRF on form actions, click handlers on non-interactive elements
  - **expo-rn**: SecureStore vs AsyncStorage for secrets, FlatList vs ScrollView, `expo-image` vs `react-native/Image`, accessibilityLabel on Pressables, Expo Router `_layout.tsx` conventions
- Updated `.claude/skills/agents/_template/SKILL.md` — added §6 Review as a required section with the canonical skeleton (invocation / threshold / retry target / playbook §) for future auto-authored stacks
- Wrote `scripts/verify-stack-reviews.mjs` — enforces ≥3 check headings + ≥3 grep invocations + ≥1 retry-target reference + ≥1 `Playbook §` cross-reference + zero placeholder text per shipped skill
- Verifier passes 5/5 with healthy margin (25 total check headings, 28 grep invocations, zero placeholder text)
- Full test suite unchanged: 313 tests green (168 contracts + 145 orchestrator)

### Lessons learned

- **Keep the template at `###` heading depth (sub-section of Required sections), but ship real skills at `##` depth.** The verifier enforces `^## Review` at top-level on shipped skills only; the template documents the skeleton as a sub-section so it doesn't pollute `## 6.` numbering. A single regex would struggle with both, so the verifier scopes to shipped skills and the template stays author-guidance.
- **Inline-grep regex needs `*` not `+`.** First cut used `` `[^`\n]+\bgrep[^`\n]*` `` which requires at least one char BEFORE `grep` inside the backticks. Since every invocation I wrote starts with `` `grep ... ``, the regex matched zero or one of them spuriously depending on content. Fix: `` `[^`\n]*\bgrep[^`\n]*` ``.
- **Backfill per-tier, not per-dimension.** The plan originally considered exhaustive per-dimension coverage (7 dimensions × 5 stacks = 35+ checks). Rejected in favor of 5 stack-concerning checks per skill; future passes can widen if the reviewer consistently misses stack-specific issues at review time. Cheap iteration > expensive one-shot.
