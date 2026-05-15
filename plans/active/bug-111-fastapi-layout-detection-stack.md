---
id: bug-111-fastapi-layout-detection-stack
type: bug
status: approved
author-agent: human
created: 2026-05-15
updated: 2026-05-15
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

(empty — to be populated by executing agents)
