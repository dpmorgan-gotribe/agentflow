---
id: bug-116-affectsfiles-glob-mismatch-on-bracket-paths
type: bug
status: approved
author-agent: human
created: 2026-05-16
updated: 2026-05-16
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/affectsfiles-glob-bracket-paths
affected-files:
  - orchestrator/src/fix-bugs-loop.ts
  - orchestrator/tests/fix-bugs-loop.test.ts
feature-area: orchestrator/fix-bugs-loop/affects-files-check
priority: P1
attempt-count: 0
max-attempts: 5
error-message: |
  [unverified-completion] agent(s) [systemic-fixer] committed source changes but NONE overlap with
  bug.affectsFiles (expected one of: docs/screens/webapp/tribe-detail.html, apps/web/app/**/page.tsx;
  actually touched: apps/web/app/tribes/[slug]/page.tsx, ...); rejecting as silent-failure (bug-093)
reproduction-steps: |
  1. Run /fix-bugs against a Next.js project with a dynamic route like apps/web/app/tribes/[slug]/page.tsx.
  2. A verifier-filed bug carries affectsFiles like ["docs/screens/webapp/tribe-detail.html", "apps/web/app/**/page.tsx"].
  3. The dispatched bug-fixer correctly modifies apps/web/app/tribes/[slug]/page.tsx.
  4. orchestrator/src/fix-bugs-loop.ts bug-093 affectsFiles overlap check is invoked post-commit.
  5. The check claims NO overlap between the committed files + the affectsFiles glob. Reports as silent-failure.
  6. Two consecutive attempts produce near-identical bug-093 rejections. bug-073 escalates to failed.
stack-trace: null
---

# bug-116-affectsfiles-glob-mismatch-on-bracket-paths: bug-093 affectsFiles glob check fails to match Next.js [bracket] paths against `**/page.tsx` glob

## Bug Description

`orchestrator/src/fix-bugs-loop.ts` post-commit check (added under bug-093) verifies the bug-fixer/systemic-fixer's committed files overlap with the bug's `affectsFiles` glob list. The check is meant to catch agents that commit changes to files unrelated to the bug (silent-failure mode).

But the check fails for Next.js dynamic routes: `apps/web/app/**/page.tsx` should match `apps/web/app/tribes/[slug]/page.tsx`, but bug-093 reports `NONE overlap`. The `[slug]` bracket segment trips the glob matcher (likely minimatch interpreting `[` as character-class syntax + treating the path part as non-matching).

**Empirical impact:** 4 of 28 fix-loop dispatches on gotribe-tribe-directory 2026-05-16 round 3 failed via this class. Agent correctly modified the route file (matched the bug + did the right thing) — got rejected post-commit + escalated to failed.

## Error Output

```
[unverified-completion] agent(s) [systemic-fixer] committed source changes but
NONE overlap with bug.affectsFiles (expected one of:
docs/screens/webapp/tribe-detail.html, apps/web/app/**/page.tsx;
actually touched:
apps/api/src/api/upstream/fixtures/tribes.json,
apps/web/app/tribes/[slug]/page.tsx,
packages/types/src/index.ts);
rejecting as silent-failure (bug-093)
```

Note: `apps/web/app/tribes/[slug]/page.tsx` SHOULD match `apps/web/app/**/page.tsx`.

## Root Cause Analysis

`apps/web/app/**/page.tsx` is a standard glob:

- `apps/web/app/` literal prefix
- `**` matches any nested directory chain (including empty + multi-segment)
- `/page.tsx` literal suffix

`apps/web/app/tribes/[slug]/page.tsx` should match (`**` consumes `tribes/[slug]`).

The likely cause: bug-093's glob-check uses minimatch (or similar) with default options. Minimatch interprets `[...]` as a character-class. When the FILE PATH contains `[slug]`, minimatch may be mis-treating it. Two failure shapes:

1. **Character-class confusion**: minimatch sees `[slug]` in the path + interprets as "match any single char from {s,l,u,g}" against `**/page.tsx` glob — irrelevant for matching `**`, but may abort early.
2. **Path separator mismatch on Windows**: actual commits return paths with `/` (git's normal output) — should be fine. But if any layer in the orchestrator normalizes paths to `\` for Windows, that would break the match.

Also: even with proper glob behavior, the affectsFiles authoring might be overly narrow. bug-093 also rejected for `apps/api/src/api/upstream/tribes_source.py` (a backend file the agent touched legitimately to fix the tribe-detail issue) — because the original bug's affectsFiles only listed the screen HTML + `apps/web/app/**/page.tsx`. The OVERLAP check is "≥1 of committed files matches ≥1 glob" — only 1 match needed, but `[slug]/page.tsx` didn't even match its expected glob. Fix the glob first.

## Fix Approach

Three patches:

### Patch A — Identify the failing glob library + replace with bracket-safe matcher

`orchestrator/src/fix-bugs-loop.ts` (or wherever bug-093 is implemented): find the import for minimatch / glob / fast-glob. Test it locally:

```js
import { minimatch } from "minimatch";
console.log(
  minimatch("apps/web/app/tribes/[slug]/page.tsx", "apps/web/app/**/page.tsx"),
);
// Expected: true. If false: the library has the bug-116 class.
```

If the library is broken, options:
(a) Pass `minimatch(..., { noglobstar: false, dot: true, nobrace: true })` to disable brace expansion + character-class handling
(b) Escape the path's `[` `]` before matching: `path.replace(/\[/g, '\\[').replace(/\]/g, '\\]')`
(c) Switch to picomatch (more lenient with bracket handling)

Most likely needed: BOTH (a) AND (b) — disable bracket-as-character-class semantics on the glob side AND escape brackets on the path side.

### Patch B — Add a "Next.js dynamic-route literal" recognizer

When the path contains a bracket-segment like `[slug]` / `[id]` / `[...slug]`, recognize it as a Next.js dynamic-route literal (NOT a glob character class). Patch B's helper: `normalizeBracketsForGlob(path)` that detects path-segment-style brackets and either escapes them or wraps them in a literal-match pattern.

### Patch C — Loosen affectsFiles authoring (separate but related)

`scripts/file-bug-plan.mjs` populates affectsFiles when filing a verifier-detected bug. Today the authoring is narrow (matches the bug's exact surface: e.g. `docs/screens/webapp/tribe-detail.html`, `apps/web/app/**/page.tsx`). The bug-fixer often needs to touch ADJACENT files (api fixtures, types, etc.) to fix the surface bug. The check should also accept these "related" files.

Patch C — extend affectsFiles to ALSO include the architecture-aware "downstream files" for each surface. For a parity-tribe-detail bug, the affectsFiles should include:

- The screen HTML (mockup reference)
- The route file (apps/web/app/tribes/[slug]/page.tsx)
- Any reasonable adjacent files: api fixture (apps/api/src/api/upstream/fixtures/), types (packages/types/), api client (packages/api-client/)

Patch C is the broader fix; Patch A is the immediate fix. Ship A first, C as follow-up if A doesn't fully resolve.

## Rejected Fixes

- **R1 — Drop the bug-093 check entirely.** Rejected: the check catches genuinely silent failures (agent returns completed without modifying anything relevant). Loosen, don't delete.

- **R2 — Make bug-093 warning-only, not failure.** Rejected: would re-introduce the silent-success class that bug-093 was filed to prevent. Better to fix the glob.

## Validation Criteria

- [ ] Patch A: `minimatch("apps/web/app/tribes/[slug]/page.tsx", "apps/web/app/**/page.tsx")` returns `true` after fix.
- [ ] Regression test in `orchestrator/tests/fix-bugs-loop.test.ts`: simulate 4 bug-093 failure cases (Next.js [slug], [id], [...slug] catch-all, deeply nested [...rest]) — all should return overlap-found.
- [ ] After ship: re-run /fix-bugs on gotribe-tribe-directory. The 4 parity failures should at minimum get PAST bug-093's check (whether the underlying parity divergences resolve is a separate question).

## Cross-references

- bug-115 (sibling, filed same session) — the OTHER class of failure from gotribe-tribe-directory round 3 (Windows .pyc worktree-creation block). Both ship together — both essential for next /fix-bugs run.
- bug-093 (archived) — the original silent-success-detection layer. This bug refines it.
- bug-082 (archived) — sibling "HEAD did not advance" silent-failure detection. Sometimes co-fires with bug-093 — agent first dispatch returns completed-without-commit (bug-082); second dispatch commits to wrong-glob (bug-093). Both are part of the same "agent silently failed" detection family.

## Attempt Log

(empty — to be populated when implementation runs)
