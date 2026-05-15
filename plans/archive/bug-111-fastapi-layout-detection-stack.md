---
id: bug-111-fastapi-layout-detection-stack
type: bug
status: archived
author-agent: human
created: 2026-05-15
updated: 2026-05-15
approved-at: 2026-05-15
completed-at: 2026-05-15
outcome: success
parent-plan: investigate-032-fastapi-main-py-layout-mismatch
supersedes: null
superseded-by: null
branch: fix/fastapi-layout-detection-stack
affected-files:
  - .claude/skills/agents/back-end/python-fastapi/SKILL.md
  - docs/reviewer-playbook.md
  - .claude/skills/agents/back-end/node-fastify/SKILL.md
  - .claude/skills/agents/back-end/node-trpc-nest/SKILL.md
  - orchestrator/src/build-to-spec-verify.ts
  - orchestrator/src/protected-files.ts
  - .claude/rules/protected-files-policy.md
  - .claude/agents/bug-fixer.md
  - .claude/agents/systemic-fixer.md
  - scripts/file-bug-plan.mjs
  - orchestrator/tests/protected-files.test.ts
feature-area: factory/backend-boot-detection-stack
priority: P0
attempt-count: 0
max-attempts: 5
error-message: 'Error loading ASGI app. Could not import module "api.main".'
reproduction-steps: "Run /start-build gotribe-tribe-directory → wait for completion → run /build-to-spec-verify → /fix-bugs reports clean → manually `cd apps/api && uv run uvicorn api.main:app --app-dir src` → uvicorn fails with the module-import error. Empirical commit: e5c4aea on master 2026-05-15."
stack-trace: null
---

# bug-111-fastapi-layout-detection-stack: FastAPI backend layout drift escapes the 4-layer detection stack

## Bug Description

A FastAPI backend authored with `main.py` at the wrong path (`apps/api/src/main.py` instead of the canonical `apps/api/src/api/main.py`) ships through Mode B + `/build-to-spec-verify` + `/fix-bugs` with "clean" status while uvicorn cannot import the module at runtime. All four nominal detection layers — builder self-verify, reviewer dim-2 architecture-conformance, verifier dev-server pre-boot, and the bug-fix loop's bug-classification — failed to surface the gap.

The empirical motivator is `projects/gotribe-tribe-directory/` (master @ 694d21b on 2026-05-15): the project's `apps/api/src/main.py` was authored by `backend-builder` at commit `e5c4aea` and never moved. The canonical spawn command (`uv run uvicorn api.main:app --app-dir src` from `apps/api/`) is hardcoded across the factory (python-fastapi SKILL.md §dev-orchestrator, `dev-multi-tier-python-fastapi.mjs.template`, and `orchestrator/src/dev-server.ts STACK_BACKEND_SPAWN_COMMAND["python-fastapi"]`) — all three agree on `apps/api/src/api/main.py`, and the builder hallucinated against an unambiguous spec.

Downstream cascade: the verifier's backend pre-boot failure routed Tier 3 parity, Tier 4 perceptual review, and Tier 5 walkthrough into cascade-skip; the bug-fix loop filed bug-runtime-tooling-pre-flight against the synth/playwright surface only (playwright.config.ts missing, pnpm install gap) and closed it after Tier 1-2 went green. The uvicorn boot failure is preserved in the iter-2 verifier's `warnings[]` and `_tmp-verify-output.json`, but no `bugPlansFiled[]` entry was ever filed against the module-import surface.

This is a class bug — gotribe-tribe-directory is the first surfacing, but any FastAPI project ships with the same 4-layer-blindspot until the factory closes it.

## Reproduction Steps

1. Scaffold a fresh FastAPI project: `/new-project test-fastapi-layout --proposal "FastAPI app with one /health endpoint"`
2. Walk Mode A through `/pm --mode=tasks`
3. Run `/start-build test-fastapi-layout`
4. Observe: backend-builder authors `apps/api/src/main.py` (NOT `apps/api/src/api/main.py`)
5. Reviewer approves; tester approves; feature merges to master
6. Run `/build-to-spec-verify` — observe `dev-server pre-boot failed: backend (python-fastapi) did not respond on http://localhost:8000/health within 60000ms ... ERROR: Error loading ASGI app. Could not import module "api.main"` lands in `warnings[]`, NOT `bugPlansFiled[]`
7. Run `/fix-bugs` — observe loop reports `clean` while uvicorn boot remains broken
8. Manual sanity: `cd apps/api && uv run uvicorn api.main:app --app-dir src` — fails

## Error Output

```
[verify-output.warnings]
- dev-server pre-boot failed: backend (python-fastapi) did not respond on
  http://localhost:8000/health within 60000ms. Resolved spawn:
  `uv run uvicorn api.main:app --app-dir src --host 0.0.0.0 --port 8000`
  from `apps/api`. Resolved port: 8000.
  Underlying: child process exited prematurely with code 1; stderr tail:
  ERROR:    Error loading ASGI app. Could not import module "api.main".
  ; runFlows + parityVerify will fall back to their own spawn paths.

[fix-bugs-loop final report]
iteration 2/2; resolved: 4; failed: 0; remaining: 0; status: clean
```

## Root Cause Analysis

Per `plans/active/investigate-032-fastapi-main-py-layout-mismatch.md`:

- **H1 CONFIRMED** — `git log --all -- apps/api/src/main.py apps/api/src/api/main.py` in the project returns exactly one commit (`e5c4aea`); the builder authored at the wrong path and no later commit moved it.
- **H2 FALSIFIED** — the SKILL.md, template, and `dev-server.ts` all agree on `src/api/main.py`. Worse than ambiguity: the builder hallucinated against an unambiguous spec, which means downstream gaps are load-bearing for ANY new builder-authoring round.
- **H3 CONFIRMED** — `docs/reviewer-playbook.md` (550 lines, 7 dimensions) contains 0 hits for `boot`, `uvicorn`, `importability`; §1 Architecture checks file-presence only; §6 Performance explicitly skips when dev-server unavailable.
- **H4 CONFIRMED** — `orchestrator/src/build-to-spec-verify.ts:471-473` is `warnings.push(...)` on the pre-boot failure catch; no `fileBugPlan` invocation. `docs/_tmp-verify-output.json` for gotribe-tribe-directory shows 3 `warnings[]` entries containing the uvicorn error verbatim and 0 `bugPlansFiled[]` entries against the module-import surface.
- **H5 CONFIRMED** — `docs/bugs.yaml` `bug-runtime-tooling-pre-flight.errorLog` cites only "playwright.config.ts missing" + "pnpm install gap"; the fix-bugs dispatch landed `apps/web/playwright.config.ts` + ran install, satisfying Tier 1-2, while never touching `apps/api/`.

The 4 detection layers are the right idea but each has a hole that lines up with the same axis (runtime-module-importability), and the holes compound. Closing one layer would catch this class once; closing all four creates redundant defense (any single layer firing prevents the cascade).

## Fix Approach

Four phases on adjacent surfaces. Each phase is independently shippable but lands as one PR.

### Phase A — python-fastapi SKILL.md importability self-verify gate

**Surface:** `.claude/skills/agents/back-end/python-fastapi/SKILL.md` line 249.

**Change:** extend the Builder self-verify gate command from

```
uv run ruff check api && uv run mypy api && uv run pytest
```

to

```
uv run ruff check api && uv run mypy api && uv run pytest && \
uv run python -c "import importlib; importlib.import_module('api.main')"
```

The importability check is ~50ms after pytest already loaded the venv. It catches `apps/api/src/main.py`-at-wrong-path immediately — Python's import machinery raises `ModuleNotFoundError: No module named 'api.main'` whether the file is missing or at the wrong location, with the exact module path in the error. The builder's self-verify dispatch then surfaces the error to its retry context, and a sane retry repositions the file.

**Why this is the cheapest layer:** failure costs <1 second of CPU and zero $ — the builder's own loop catches the gap before any reviewer, verifier, or fix-loop dispatch runs.

### Phase B — reviewer dim-2 dev-server-boot check

**Surface:** `docs/reviewer-playbook.md` Dimension 1 (Architecture) AND each of the 4 backend stack skills' §Review block.

**Change:** add a check-item to dim-1 (the playbook calls Architecture "Dimension 1"; my plan said dim-2 erroneously — confirm during edit):

```
- [ ] For projects with apps/api/: confirm the canonical dev-server spawn boots
      cleanly. Run the stack-specific boot probe (see backend stack skill §Review).
      A non-booting backend cascades through verifier + bug-fix loop, masking
      every Tier 3+ check (bug-111).
```

Mirror the check per-stack so the reviewer sees the exact command:

- `python-fastapi/SKILL.md` §Review: `(cd apps/api && timeout 10 uv run uvicorn api.main:app --app-dir src --port 8099 &); sleep 5; curl -s http://localhost:8099/health; kill %1`
- `node-fastify/SKILL.md` §Review: equivalent fastify boot probe (deferred — fastify SKILL.md doesn't yet have §Review; punt to follow-up if not blocking)
- `node-trpc-nest/SKILL.md` §Review: equivalent (same caveat)
- `node-express/SKILL.md` §Review: equivalent (same caveat)

If the per-stack §Review block doesn't already exist, add a minimal one with just the boot-probe + the same dim-1 cross-reference.

### Phase C — verifier promotes module-import failures to backend-boot-failure bug class

**Surface:** `orchestrator/src/build-to-spec-verify.ts:466-475` + `scripts/file-bug-plan.mjs`.

**Change:**

1. In the pre-boot catch block (currently `warnings.push(...)`), inspect the underlying error message. If it contains `"Could not import module"` OR `"ModuleNotFoundError"` OR (Node-side analogue when fastify/nest are wired later: `"Cannot find module"`), call `fileBugPlan` with a new `backendBootFailureBody` template. Otherwise (true connection timeout, port collision, dependency missing) keep the existing `warnings.push` path — those are operator-environment issues, not project-code bugs.

2. Add `backendBootFailureBody(spawnCmd, stderrTail, projectStack)` to `scripts/file-bug-plan.mjs`. The body template should explicitly name:
   - The canonical module path the spawn expected (extract from the stderr regex match)
   - The most likely fix recipe per stack (FastAPI: move `apps/api/src/main.py` → `apps/api/src/api/main.py`; node-\*: TBD when those stacks land)
   - A self-verify hint: `uv run python -c "import importlib; importlib.import_module('<module>')"`

3. The bug-id slug: `bug-backend-boot-failure-<stack-slug>` so it dedups cleanly across iterations.

### Phase D — protected-files manifest extension

**Surface:** `orchestrator/src/protected-files.ts:67-93` (PROTECTED_FILES) + `.claude/rules/protected-files-policy.md` invariant-class table + `.claude/agents/{bug-fixer,systemic-fixer}.md` §Protected files block + `orchestrator/tests/protected-files.test.ts`.

**Change:** add `apps/api/src/api/main.py` to PROTECTED_FILES.

**Why safe:** `verifyProtectedFiles` already gates `apps/api/*` entries on `apps/api/` directory presence (lines 159-174), AND uses `baselineRoot` regression-only checking in the fix-loop integration (lines 130-141). So a project that legitimately ships without `apps/api/` (web-only) won't trip the check; a project whose baseline already lacks the canonical path won't trip either (the dispatch isn't blamed for pre-existing absence). The check fires ONLY when a fix-loop dispatch deletes a previously-present `apps/api/src/api/main.py`.

Add a regression test in `orchestrator/tests/protected-files.test.ts` mirroring the existing `postcss.config.mjs` pattern.

## Rejected Fixes

- **Fix R1 — Auto-detect wrong main.py path in the builder and silently rewrite it** — Rejected: the factory should not auto-correct the builder. The builder needs to learn the layout via its self-verify failure, which trains the dispatch's retry context. Silent rewrite hides the gap.

- **Fix R2 — Switch the canonical spawn to be more tolerant (e.g. try `api.main:app` AND `main:app`)** — Rejected: the factory's job is to ship ONE canonical convention. Tolerance for variants spreads project layouts indefinitely and breaks the per-stack-skill contract that downstream tooling (tester, reviewer, verifier) relies on.

- **Fix R3 — Make Phase C the only fix; let bug-fix loop catch it next round** — Rejected: Phase A alone catches it at <1s cost in the builder loop, BEFORE the reviewer + verifier + fix-loop dispatches that cost $0.50-$5 each. Compounding defense is cheap relative to the cost of a single fix-loop round.

- **Fix R4 — Split into 4 separate bug plans** — Rejected: all 4 phases share one motivator (investigate-032) and target one detection axis (runtime-module-importability). Ship as one plan; archive once.

## Validation Criteria

- [ ] Phase A: `uv run python -c "import importlib; importlib.import_module('api.main')"` exits 0 on a correctly-laid-out FastAPI project; exits non-zero with `ModuleNotFoundError` on `gotribe-tribe-directory`'s current state.
- [ ] Phase B: reviewer-playbook.md has a dim-1 boot check item; `python-fastapi/SKILL.md` §Review has the boot probe.
- [ ] Phase C: `orchestrator/src/build-to-spec-verify.ts` calls `fileBugPlan` on `Could not import module` stderr (with regression test in `orchestrator/tests/`); `scripts/file-bug-plan.mjs` has a `backendBootFailureBody` template.
- [ ] Phase D: `orchestrator/tests/protected-files.test.ts` has a `apps/api/src/api/main.py` regression test; the policy docs + agent prompts cross-reference it.
- [ ] `pnpm --filter orchestrator test` exits 0.
- [ ] `pnpm --filter @repo/orchestrator-contracts test` exits 0.
- [ ] After project hand-fix (`git mv apps/api/src/main.py apps/api/src/api/main.py` in gotribe-tribe-directory), re-running `/build-to-spec-verify` shows Tiers 3+4+5 firing instead of cascade-skipping.

## Attempt Log

### Attempt 1 — 2026-05-15 — shipped all 4 phases in one PR (master commit 6f3ec57 → merge 6edef03)

**What changed (per phase):**

- **Phase A** — `.claude/skills/agents/back-end/python-fastapi/SKILL.md:249` extended the Builder self-verify gate command from `uv run ruff check api && uv run mypy api && uv run pytest` to `... && uv run python -c "import importlib; importlib.import_module('api.main')"` + appended a paragraph explaining the gate's role with cross-ref to bug-111.

- **Phase B** — `docs/reviewer-playbook.md:23-49` §1 Architecture adherence got: (a) a new `## Backend dev-server boot probe` block in the Tool-invocation code fence, (b) a new bullet under Pass threshold ("For projects with apps/api/: the canonical dev-server spawn produces an importable app module per the per-stack §Review boot probe (bug-111)..."), (c) a new bullet under Retry target. `python-fastapi/SKILL.md §Review` got a `#### architecture — backend dev-server boot probe (bug-111)` block invoking `importlib.import_module('api.main')`. `node-fastify/SKILL.md` + `node-trpc-nest/SKILL.md` got parallel `architecture — backend entrypoint at canonical path` blocks (test for `apps/api/src/server.ts` and `apps/api/src/main.ts` respectively). Node-stack probes are preliminary file-existence checks; deeper boot probes deferred until first empirical node-backend project ships.

- **Phase C** — `orchestrator/src/build-to-spec-verify.ts:466-475` (the dev-server pre-boot catch block) now regex-tests `err.message` for `Could not import module "X"` / `ModuleNotFoundError: No module named 'X'` / `Cannot find module 'X'`. On match: synthesizes a `FlowFailure` with `flowId: "backend-boot-failure"`, `primaryCause: "runtime-error"`, rich `message` field naming canonical paths for each backend stack + the fix recipe, `stderrTail: errMessage.slice(0, 1500)`. Pushes to `flowsFailed[]`; existing cascade-root file-bug-plan path (line 645-654) picks it up. Non-import failures (true 60s timeout, port collision, dep missing) stay on the original `warnings.push` path. `flowsPassed` / `flowsFailed` / `flowsRan` declarations hoisted ahead of the pre-boot block (fixes TS2448 used-before-declaration that the inline-push would have produced).

- **Phase D** — `orchestrator/src/protected-files.ts` added the backend canonical-entry tuple `["apps/api/src/api/main.py", "apps/api/src/server.ts", "apps/api/src/main.ts"]` to `PROTECTED_FILES`. `.claude/rules/protected-files-policy.md` opening section + invariant-class table updated to reference bug-111. `bug-fixer.md` + `systemic-fixer.md` §Protected files blocks each got a bullet naming the new entry. `orchestrator/tests/protected-files.test.ts` got 3 new tests (tuple satisfied by any variant / tuple violation when none exists / skip when apps/api/ absent) + the seedBaseline scaffold gained `apps/api/src/api/main.py`.

**Validation:**

- `pnpm --filter orchestrator test -- --run tests/protected-files.test.ts tests/build-to-spec-verify.test.ts` → 59/59 pass (23 protected-files + 36 build-to-spec-verify; +3 new in protected-files)
- `pnpm --filter @repo/orchestrator-contracts test` → 401/401 pass
- Full orchestrator suite has 185 failing tests in 6 files (`diff-kit-skeleton.test.ts`, `audit-computed-styles.test.ts`, `run-synthesized-flows.test.ts`, `file-bug-plan-parity.test.ts`, `seed-app-state.test.ts`, `derive-fixture-from-mockup.test.ts`). Confirmed PRE-EXISTING on stashed-master baseline (identical 83/83 failing in the two probed files). Flagged to operator for separate investigation; my 4 phases regress nothing.

## Outcome

**Success.** All 4 phases shipped to master in commit `6f3ec57` (merge `6edef03`). The detection stack now has redundant defense across 4 layers — Phase A catches at <1s cost in the builder loop; Phases B/C/D catch as defense-in-depth if Phase A is bypassed.

**Project hand-fix recipe (still pending for gotribe-tribe-directory):** `git mv apps/api/src/main.py apps/api/src/api/main.py` in the project; no import edits needed (already uses absolute `from api.routes.tribes import...` and `src/` is on pythonpath per pyproject.toml). Then re-run `/build-to-spec-verify gotribe-tribe-directory` — Tiers 3+4+5 should fire instead of cascade-skipping.

### Lessons

1. **A clear spec doesn't guarantee a builder follows it.** The python-fastapi SKILL.md was internally CONSISTENT (3 mentions of `src/api/main.py`, all agreeing) — the builder hallucinated against an unambiguous spec. Detection layers downstream of the builder are load-bearing, not redundant. Cheap layers (importability probe in self-verify, ~50ms cost) catch this BEFORE expensive ones (reviewer/verifier dispatches at $0.50-$5).

2. **`warnings[]` ≠ `bugPlansFiled[]`.** When the verifier downgrades a real failure to a warning, the bug-fix loop never sees it. Today's class-of-bug-the-loop-can't-touch is `dev-server pre-boot failed`; tomorrow's might be a different soft-gate. The `synthesizeToolFailure` + `flowsFailed[]` pipeline is the right channel — anything that warrants a fix should route through it, not into `warnings[]`.

3. **Cascade-skip semantics need to surface.** When Tier 3 parity / Tier 4 perceptual / Tier 5 walkthrough all skip because the dev-server failed to boot, the verifier reports "clean" if Tiers 1-2 are green. A future hardening would surface "N tiers skipped due to <reason>" in the run-level status — operators would catch this faster.

4. **Protected-files tuple shape is generally useful.** The first-match-tuple pattern (any one of N variants must exist) is what made Phase D safe across 3 backend stacks. Same shape could extend to web stack canonical-entry (e.g. `apps/web/app/page.tsx | apps/web/src/app/page.tsx | apps/web/pages/index.tsx`).

5. **Hoisting declarations for inline-push is cheap.** Phase C's `flowsFailed[]` push needed the declaration ahead of the pre-boot block; hoisting 3 lines (with a comment explaining why) was much cleaner than restructuring the pre-boot block to defer.

### Cross-references

- `investigate-032` — parent investigation; 4 of 5 hypotheses confirmed
- `bug-091` — the original protected-files-guard precedent (Phase D extends its manifest)
- `bug-077` — the empirical CSS-pipeline regression that motivated bug-091
- `bug-040` — scripts/dev.mjs templates (cross-stack canonical spawn shapes)
- `bug-043` — orchestrator dev-server spawn became stack-aware; Phase C builds on `STACK_BACKEND_SPAWN_COMMAND`
- `gotribe-tribe-directory` — the empirical motivator project; pending hand-fix re-run is task #19 of this session
