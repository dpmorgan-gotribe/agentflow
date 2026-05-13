---
id: bug-091-protected-files-guard
type: bug
status: approved
author-agent: human
created: 2026-05-13
updated: 2026-05-13
approved-by: human
approved-at: 2026-05-13
parent-plan: feat-066-fix-loop-effectiveness-v2
supersedes: null
superseded-by: null
branch: fix/protected-files-guard
affected-files:
  - .claude/agents/bug-fixer.md
  - .claude/agents/systemic-fixer.md
  - .claude/rules/protected-files-policy.md
  - orchestrator/src/protected-files.ts
  - orchestrator/src/fix-bugs-loop.ts
  - orchestrator/tests/protected-files.test.ts
feature-area: orchestrator/fix-loop
priority: P0
attempt-count: 0
max-attempts: 5
error-message: "bug-fixer / systemic-fixer dispatches silently delete load-bearing config files (e.g. apps/web/postcss.config.mjs); detection layers (parity-verify, perceptual-reviewer) are blind to 'page is unstyled' because both unstyled and styled DOM carry identical class attributes"
reproduction-steps: "run /fix-bugs against any react-next project with bugs that touch UI; observe one or more iterations delete apps/web/postcss.config.mjs and/or strip @tailwind directives from packages/ui-kit/src/styles/globals.css; verifier reports 'clean' for parity + perceptual passes; operator boot of dev-server shows site rendering raw HTML with no Tailwind utilities applied"
stack-trace: null
---

# bug-091: protected-files guard — agents can delete load-bearing config files mid-fix-loop

## Bug Description

`bug-fixer` and `systemic-fixer` agents have unrestricted `Write` / `Edit` tool permissions and operate on broad turn budgets (8 and 12 respectively). When they reason about a UI bug — particularly a perceptual-divergence finding routed via `systemic-fixer` per bug-087/bug-088 — they sometimes conclude that a config file is the source of unwanted styling and DELETE it. The most empirically destructive case is `apps/web/postcss.config.mjs`: removing it silently disables Tailwind utility compilation across the entire web app, returning the project to the broken state bug-077 originally fixed.

Adjacent failure modes observed in the same class:

- Stripping `@tailwind base; @tailwind components; @tailwind utilities;` directives from `packages/ui-kit/src/styles/globals.css`
- Emptying out `tailwind.config.ts` content paths
- Deleting `scripts/dev.mjs` in favor of a freshly invented spawn shape
- Touching `next.config.ts` / `vitest.config.ts` / `tsconfig.json` despite bug-023 having declared these scaffold-owned

**Why detection layers don't catch it:**

1. **parity-verify** compares the built DOM against mockup DOM. Both unstyled-page-DOM and styled-page-DOM carry IDENTICAL class attributes (the classnames are typed in source code; only their CSS resolution differs). DOM-diff sees no divergence.
2. **audit-computed-styles** would catch it in principle but is not yet wired (per bug-078 backlog).
3. **perceptual-reviewer** (Tier 4, feat-068) CAN see the unstyled page in PNG comparison. But when it files findings, bug-087/088 routes them back to `systemic-fixer` — the SAME agent class that caused the deletion. Compounding loop.
4. **bug-fixer / systemic-fixer self-verify** runs `pnpm typecheck` + `pnpm test`. Neither tooling pass exercises CSS compilation; both stay green with postcss.config.mjs removed.

**Empirical motivator (reading-log-02 feat-066 v2 epic, 2026-05-12):**

During the feat-068+073+087+088 stack's empirical Phase D runs against reading-log-02, multiple `/fix-bugs` iterations reported high resolution rates (~93-97% per metric). When the operator booted the dev-server and inspected the site mid-session, the page rendered RAW HTML with no Tailwind styling applied. Investigation showed:

- `apps/web/postcss.config.mjs` had been deleted somewhere in the fix-loop chain
- `@tailwind` directives were missing from `packages/ui-kit/src/styles/globals.css`
- Manual recovery (recreate postcss.config.mjs + re-add @tailwind directives + clear .next cache) restored the v2 fixes' visual impact

The bug-077 regression went undetected for the entire ~20-hour session despite verifier-reported metrics looking clean.

## Reproduction Steps

1. Start with any react-next project where bug-077's Phase fixes have shipped (postcss.config.mjs present + @tailwind directives in globals.css).
2. Run `/fix-bugs <project>` with at least 2-3 UI-touching bugs in `docs/bugs.yaml`.
3. Let the fix-loop run 2-3 iterations. Each iteration's per-bug worktree dispatch invokes bug-fixer (or systemic-fixer for systemic categories per bug-087/088 routing).
4. After the loop reports `status: clean`:
   - `ls projects/<name>/apps/web/postcss.config.mjs` → may be absent
   - `grep "@tailwind base" projects/<name>/packages/ui-kit/src/styles/globals.css` → may be empty
5. Boot `node scripts/dev.mjs` from the project. Site renders unstyled despite the loop's clean-resolution metric.

## Error Output

```
# Pre-loop state:
$ ls projects/reading-log-02/apps/web/postcss.config.mjs
apps/web/postcss.config.mjs  ✓ present

$ grep "@tailwind base" projects/reading-log-02/packages/ui-kit/src/styles/globals.css
3:@tailwind base;
4:@tailwind components;
5:@tailwind utilities;

# After /fix-bugs run (clean exit):
$ ls projects/reading-log-02/apps/web/postcss.config.mjs
ls: cannot access 'apps/web/postcss.config.mjs': No such file or directory

$ grep "@tailwind base" projects/reading-log-02/packages/ui-kit/src/styles/globals.css
(empty)

# Verifier said:
[fix-bugs-loop] status: clean. resolved: 41/45, failed: 4.
# But the site:
# raw HTML, no Tailwind output, full bug-077 regression
```

## Root Cause Analysis

### Layer 1 — Permission model gap

`.claude/agents/bug-fixer.md` and `.claude/agents/systemic-fixer.md` both declare `tools: Read, Write, Edit, Bash, Grep, Glob` in their frontmatter. There is NO allowlist or forbidden-path mechanism. The agent system prompts describe their dispatch scope as "the bug context" but don't enumerate which files MUST NOT be deleted.

### Layer 2 — Architectural precedent ignored

bug-024 (tester-modifies-source, archived 2026-04-29) shipped the canonical forbidden-paths pattern for the tester:

- `.claude/agents/tester.md` §Hard constraint declares allowed paths (`**/*.test.*`, `**/e2e/**`, etc.) + forbidden paths (`apps/{app}/src/**`, `packages/{any}/src/**`, scaffold-owned config files, package.json)
- `.claude/rules/testing-policy.md` §Genuine product bug — CONSTRAINT codifies the lane-discipline rule
- `orchestrator/src/tester-diff-audit.ts` (NOT yet shipped; the audit IS specified in testing-policy.md as the mechanical enforcement layer — currently the constraint relies on system-prompt callouts alone)

bug-023 (vitest-config-merge-thrash, archived 2026-04-29) shipped a complementary three-layer protection for scaffold-owned files:

- Stack-skill §Files NOT to modify
- web-frontend-builder §Hard rules guard
- `// SCAFFOLD-OWNED — DO NOT MODIFY per feature.` comment header on initial scaffolds

bug-fixer and systemic-fixer received NEITHER protection. The precedent shape was right; the coverage gap is that bug-024/023's lessons were applied to builder + tester lanes but never propagated to the fix-loop dispatchers introduced by feat-066/feat-070.

### Layer 3 — Detection blindness

The factory's verification stack does NOT currently detect "load-bearing config file deleted":

- audit-app-reachability scans for orphan source files; doesn't enforce config-file presence
- parity-verify diffs DOM structure; identical classnames hide CSS regressions
- perceptual-reviewer (feat-068) sees the visual regression but its routing under bug-087/088 sends it BACK to systemic-fixer, the compounding loop
- Builder self-verify runs typecheck + tests; CSS pipeline failures are silent

The detection gap is investigate-021 territory — but the SOURCE gap (agents deleting the files in the first place) is the bug-091 surface.

## Fix Approach

Three-layer protection mirroring the bug-024 pattern.

### Phase A — protected-files manifest + agent system-prompt callouts (~30min)

1. Create `orchestrator/src/protected-files.ts` exporting a typed `PROTECTED_FILES` set (and `PROTECTED_GLOB_PATTERNS` for wildcard cases). v1 is hardcoded; later iterations can promote to JSON manifest or consult stack-skill canonical-paths registry.

   Initial entries (kebab-listed to match the existing scaffold-owned vocabulary from bug-023):

   ```ts
   // ABSOLUTE paths under projectRoot (no wildcards)
   const PROTECTED_FILES = new Set([
     "apps/web/postcss.config.mjs",
     "apps/web/postcss.config.js",
     "apps/web/postcss.config.cjs",
     "apps/web/tailwind.config.ts",
     "apps/web/tailwind.config.js",
     "apps/web/next.config.ts",
     "apps/web/next.config.mjs",
     "apps/web/vitest.config.ts",
     "apps/web/tsconfig.json",
     "apps/web/package.json",
     "apps/api/package.json",
     "scripts/dev.mjs",
     "package.json",
     "pnpm-workspace.yaml",
     "pnpm-lock.yaml",
   ]);

   // GLOB patterns (apply to all projects)
   const PROTECTED_GLOB_PATTERNS = [
     "packages/*/package.json",
     "packages/*/tsconfig.json",
   ];

   // CONTENT INVARIANTS — file must exist AND contain these literal substrings
   const PROTECTED_CONTENT_INVARIANTS: Record<string, string[]> = {
     "packages/ui-kit/src/styles/globals.css": [
       "@tailwind base",
       "@tailwind components",
       "@tailwind utilities",
     ],
   };
   ```

   The content-invariant map is the key innovation over bug-023's scaffold-owned-comment pattern: it catches the "file present but emptied out" case (the @tailwind directives one).

2. Update `.claude/agents/bug-fixer.md` system prompt with a §Protected files block:

   ```markdown
   ## Protected files — DO NOT DELETE OR EMPTY

   The factory ships load-bearing config files that downstream CSS compilation,
   build orchestration, and dev-server boot DEPEND ON. If you reason that a
   config file is the source of unwanted behavior, FLAG it in your output
   (`needsOperatorAttention: true` + reason) — do NOT delete or rewrite it.

   Files in this category (orchestrator/src/protected-files.ts is canonical):

   - apps/web/postcss.config.{mjs,js,cjs} — Tailwind PostCSS entrypoint
   - apps/web/tailwind.config.{ts,js} — Tailwind content roots
   - apps/web/next.config.{ts,mjs} — Next routing/bundling
   - apps/web/vitest.config.ts — bug-023 scaffold-owned
   - apps/web/tsconfig.json — bug-023 scaffold-owned
   - apps/web/package.json + apps/api/package.json + packages/\*/package.json
   - scripts/dev.mjs — multi-tier dev orchestrator
   - @tailwind directives in packages/ui-kit/src/styles/globals.css

   The post-dispatch invariant check rejects diffs that violate this list and
   marks your dispatch as failed. Save yourself the retry — flag, don't delete.
   ```

3. Mirror the block verbatim into `.claude/agents/systemic-fixer.md`. Both share the contract.

4. Create `.claude/rules/protected-files-policy.md` as the canonical rules doc (mirrors `.claude/rules/testing-policy.md` shape). Agent prompts cite this file; future agents/skills consume it.

### Phase B — post-dispatch invariant check (~1hr)

The system-prompt callout is the soft layer. The hard layer is a mechanical check that runs IMMEDIATELY after every bug-fixer / systemic-fixer dispatch in `runFixBugsLoop`:

1. After each per-bug worktree dispatch returns, before its commit lands on `fix/bugs-yaml-iter`, run `verifyProtectedFiles(worktreePath)`:
   - For each absolute path in `PROTECTED_FILES`: assert the file exists.
   - For each glob pattern in `PROTECTED_GLOB_PATTERNS`: assert all matched files still exist.
   - For each entry in `PROTECTED_CONTENT_INVARIANTS`: assert the file exists AND contains every literal substring.

2. If ANY check fails:
   - Mark the bug attempt `status: "failed"` with `failureReason: "protected-files-violation"`.
   - Set `genuineProductBugs[]`-shaped log entry naming the file + which invariant fired (deleted / emptied / missing-content).
   - Reset the worktree's HEAD (`git reset --hard HEAD~1` if the dispatch committed; `git restore --staged --worktree .` if not).
   - Surface in the orchestrator stdout: `⚠️  bug-<id> dispatch deleted/violated <file>; rolled back. Will retry up to maxAttempts.`

3. The bug stays in `pendingThisIter`. The next attempt's dispatch will see the rolled-back state PLUS the violation reason embedded in retry context, so the agent gets feedback on why its last attempt was rejected.

### Phase C — tests (~30min)

`orchestrator/tests/protected-files.test.ts`:

1. Happy path — well-behaved diff leaves all protected files intact → `verifyProtectedFiles` returns `ok: true`.
2. Absolute-path deletion — diff removes `apps/web/postcss.config.mjs` → `ok: false`, violation names the file.
3. Glob-pattern deletion — diff removes `packages/ui-kit/package.json` → `ok: false`, violation names the file.
4. Content-invariant violation — diff empties `packages/ui-kit/src/styles/globals.css` → `ok: false`, violation names which directive is missing.
5. Multiple violations in one diff — `ok: false`, all violations listed.

Integration test on `fix-bugs-loop`:

6. Mock a bug-fixer dispatch that deletes postcss.config.mjs → loop rolls back the worktree commit + marks attempt failed + bug returns to `pendingThisIter` with violation context attached.

### Phase D — empirical re-validation (~empirical)

Re-run `/fix-bugs` against reading-log-02 (post-bug-089 + bug-090 + bug-091) with intentionally-introduced UI bugs that have historically tempted agents into config-file deletion. Verify:

- No protected-file deletions in any per-bug worktree commit
- If an agent attempts the deletion, the loop rejects + retries cleanly
- Loop completes with `status: clean` AND the site boots with full Tailwind styling

This is part of "Empirical re-run #1" in the feat-066 v2 epic Phase 1 (alongside bug-089 + bug-090 validation).

## Rejected Fixes

- **Git pre-commit hook in the project repos** — out of agent scope; the dispatch operates in a worktree that doesn't necessarily share hooks; orchestrator-side invariant is the right layer.
- **Filesystem permissions (chmod 444)** — too coarse; agents legitimately need to read config files; permission errors would confuse them more than the rejection message.
- **Block ALL Edit/Write of files not in the bug's affected-files list** — too restrictive; bug-fixer often legitimately needs to edit adjacent files (a shared util, a co-located test). The protected-files set is the minimum viable allowlist.
- **Have the operator confirm every config-file mutation** — breaks autonomous-loop semantics; the whole point of /fix-bugs is unattended iteration. Hard rejection is the right outcome.
- **Use the agent's `needsOperatorAttention: true` exit shape and trust agents to use it** — already exists in the contract; agents demonstrably IGNORE it for this class. Mechanical enforcement is needed.
- **Promote the protected-files list to a JSON manifest immediately** — premature; v1 hardcoded TS set is grep-able + tree-shakable + type-checked. Extract to JSON when the list hits ~30+ entries OR a stack other than react-next needs distinct lists.

## Validation Criteria

- [ ] `orchestrator/src/protected-files.ts` ships with `PROTECTED_FILES`, `PROTECTED_GLOB_PATTERNS`, `PROTECTED_CONTENT_INVARIANTS`, and a `verifyProtectedFiles(projectRoot): { ok: boolean; violations: Violation[] }` function
- [ ] `.claude/agents/bug-fixer.md` + `.claude/agents/systemic-fixer.md` carry §Protected files blocks naming the manifest
- [ ] `.claude/rules/protected-files-policy.md` ships as canonical rules doc + cross-linked from both agent prompts
- [ ] `runFixBugsLoop` calls `verifyProtectedFiles` after each per-bug dispatch; rolls back the worktree commit + marks attempt failed on violation
- [ ] Violation context (which file, which invariant) is threaded into the next attempt's retry context so the dispatched agent sees why its prior attempt was rejected
- [ ] `protected-files.test.ts` covers happy + 4 violation classes + 1 integration test against `runFixBugsLoop`
- [ ] Empirical: reading-log-02 re-run shows zero protected-file violations across a full /fix-bugs cycle; if an agent attempts a deletion, the loop rolls back + retries cleanly + ultimately resolves the underlying bug without regressing config files

## Cross-references

- **bug-077 (active, P0)** — the empirical regression case. `apps/web/postcss.config.mjs` deletion + missing `@tailwind` directives reopened bug-077's Tailwind-pipeline gap on reading-log-02. bug-091 prevents the same class of regression on EVERY future fix-loop run.
- **bug-024 (archived 2026-04-29)** — the architectural precedent. Tester forbidden-paths shipped the three-layer protection pattern (agent prompt §Hard constraint + .claude/rules/testing-policy.md §Genuine product bug — CONSTRAINT + orchestrator/src/tester-diff-audit.ts mechanical audit). bug-091 applies the same shape to bug-fixer + systemic-fixer with a different protected set.
- **bug-023 (archived 2026-04-29)** — the scaffold-owned-files precedent. Three-layer protection (stack-skill §Files NOT to modify + web-frontend-builder §Hard rules + SCAFFOLD-OWNED inline comment header). bug-091's `PROTECTED_FILES` set overlaps with bug-023's scaffold-owned list; both layers complement each other (bug-023 protects against BUILDER lane drift; bug-091 protects against FIX-LOOP-DISPATCHER lane drift).
- **bug-087 + bug-088 (active, P0, in-progress)** — perceptual-divergence category-aware routing to systemic-fixer. The routing layer that ROUTES UI findings to systemic-fixer is what makes this guard P0 (systemic-fixer with broad turn budgets + UI bugs is the empirical combo that produces config-file deletions).
- **feat-066 v2 epic** — bug-091 is Phase 1 alongside bug-089 (auto-merge silent fail) + bug-090 (verifier-freshness dedicated worktree). The three together restore honest verifier metrics: bug-089 ensures fixes reach master, bug-090 ensures the verifier sees the fixed state, bug-091 ensures fixes don't silently regress prior structural correctness.
- **bug-078 (active, draft)** — audit-computed-styles backlog. Complementary downstream detection layer: even with bug-091's source guard, a wired audit-computed-styles would catch CSS-pipeline regressions from OTHER causes (e.g. operator-side hand-edits, stale build cache). Independent of bug-091 but in the same defense-in-depth shape.
- **investigate-021 (active, P0, draft)** — parity-verify silent-false-clean + 422-class. Tracks the broader question of "how does parity-verify miss visual regressions when DOM structure is intact?" bug-091 plugs the agent-source side of that gap; investigate-021 will plug the verifier-detection side.

## Attempt Log

<!-- Populated by executing agents. -->
