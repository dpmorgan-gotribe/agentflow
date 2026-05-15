---
id: investigate-032-fastapi-main-py-layout-mismatch
type: investigation
status: completed
author-agent: human
created: 2026-05-15
updated: 2026-05-15
parent-plan: null
supersedes: null
superseded-by: null
branch: null
affected-files: []
feature-area: factory/python-fastapi-stack-skill
priority: P0
attempt-count: 0
max-attempts: 5
time-box-minutes: 60
hypothesis: "Backend-builder authored `apps/api/src/main.py` while the factory's canonical spawn (`uvicorn api.main:app --app-dir src`) + python-fastapi SKILL.md both expect `apps/api/src/api/main.py`; the verifier detects the boot failure but downgrades it to a non-actionable warning, and the bug-fix loop closes the resulting bug-runtime-tooling-pre-flight on greening Tier 1-2 without moving the file."
---

# investigate-032-fastapi-main-py-layout-mismatch: Why does a FastAPI backend ship via Mode B with uvicorn unable to import its app module?

## Question

When `gotribe-tribe-directory`'s Mode B build completed (3/3 features merged, $10.68 spent) and `/fix-bugs` closed bug-runtime-tooling-pre-flight as "resolved", `uv run uvicorn api.main:app --app-dir src` (the factory canonical spawn) STILL fails at startup with `Error loading ASGI app. Could not import module "api.main"`. The empirical cause is that `apps/api/src/main.py` exists but `apps/api/src/api/main.py` does not. **Why didn't ANY of the three detection layers — builder self-verify, reviewer dim-2 (architecture-conformance), or `/build-to-spec-verify` dev-server pre-boot — block this from being declared shipped?**

## Hypothesis

Three compounding failures shipped a non-booting FastAPI backend through a "clean" pipeline:

1. **Builder authored at the wrong path.** The python-fastapi SKILL.md §dev-orchestrator and §3 both say the canonical location is `apps/api/src/api/main.py`. But somewhere in the builder dispatch context (or the SKILL.md's authoring guidance itself) was ambiguous enough that the agent put `main.py` at `apps/api/src/main.py`. The builder's self-verify ran `uv run ruff check api && uv run mypy api && uv run pytest` — pytest discovered the test file at `apps/api/src/api/test_guards.py` and ran successfully because pytest finds tests by directory walk, NOT by needing to import `api.main`. So the self-verify gate passed.

2. **Reviewer dim-2 (architecture-conformance) doesn't actually exercise the spawn command.** The reviewer reads the diff, walks the 8 dimensions, runs typecheck + tests. None of those require `uvicorn` to boot. The reviewer-playbook.md's architecture dimension probably doesn't include "actually try to spawn the dev-server" as a check item — it's a structural / diff-based read.

3. **Verifier filed the boot failure as a warning, not a hard bug.** From the iter-2 log: `dev-server pre-boot failed: backend (python-fastapi) did not respond on http://localhost:8000/health within 60000ms... ERROR: Error loading ASGI app. Could not import module "api.main"` was emitted as a WARNING line, alongside `parity-verify will skip with screens unchecked` and `walkthrough-review skipped: no dev-server pre-boot handle`. The bug-fix loop classified bug-runtime-tooling-pre-flight against the synth/playwright surface (playwright.config.ts missing, pnpm install needed) — NOT the module-import surface. When the fix-bugs dispatch landed the playwright config + the install, Tier 1-2 went green, and the loop marked the bug resolved despite the uvicorn boot still being broken in the final verifier pass.

**Falsifiable sub-claims:**

- H1 (builder path): if I read `git show <feat-tribe-api commit>:apps/api/src/main.py`, the file should be there; `git show <feat-tribe-api commit>:apps/api/src/api/main.py` should be `does not exist`. **Falsified if main.py landed at the right path and was moved later.**
- H2 (skill ambiguity): the python-fastapi SKILL.md should consistently say `apps/api/src/api/main.py`. **Falsified if the skill itself has conflicting guidance** (e.g. one section says `src/main.py` while another says `src/api/main.py`).
- H3 (reviewer surface): `.claude/agents/reviewer.md` + `docs/reviewer-playbook.md` should NOT list "verify dev-server boots" as a dim-2 check item. **Falsified if there IS such a check and the reviewer ignored it.**
- H4 (verifier classification): `orchestrator/src/build-to-spec-verify.ts` + `orchestrator/src/dev-server.ts` should produce a `warnings[]` entry (not a `bugPlansFiled[]` entry) when the backend pre-boot fails. **Falsified if the verifier DID file a separate bug-module-import-failure and we missed it.**
- H5 (loop classification): the bug-fix loop's resolution of bug-runtime-tooling-pre-flight should reference the synth/playwright surface only, not the uvicorn module-path issue. **Falsified if the loop's fix commits actually attempted (and failed) to move main.py.**

## Investigation Steps

Time-boxed at 60 minutes. Each step produces an observation.

1. **Confirm the empirical state of the project** (5 min):
   - `ls projects/gotribe-tribe-directory/apps/api/src/`
   - `ls projects/gotribe-tribe-directory/apps/api/src/api/`
   - Confirm `main.py` is at `src/`, not `src/api/`
   - Run `cd projects/gotribe-tribe-directory/apps/api && uv run uvicorn api.main:app --app-dir src --port 8001` and observe the exact error

2. **Trace the builder's authoring trail** (10 min):
   - `git log --all --oneline -- 'apps/api/src/main.py' 'apps/api/src/api/main.py'` from the project root
   - Identify the commit that introduced main.py — was it `e5c4aea` (backend-builder: author-guards, author-tribes-route) or a later commit?
   - Read the actual builder dispatch context from `projects/gotribe-tribe-directory/pipeline/feature-graph/` — what did the dispatch envelope tell the builder about `main.py` location?
   - **Tests H1 (builder authored at wrong path) + H5 (loop never touched main.py)**

3. **Audit the python-fastapi SKILL.md for self-consistency** (10 min):
   - `.claude/skills/agents/back-end/python-fastapi/SKILL.md` — grep for every mention of `main.py`. List each path and its surrounding context.
   - Cross-check against `.claude/templates/dev-multi-tier-python-fastapi.mjs.template`'s spawn command
   - Cross-check against `orchestrator/src/dev-server.ts STACK_BACKEND_SPAWN_COMMAND["python-fastapi"]`
   - **Tests H2 (skill ambiguity).** Expected: all three should agree on `src/api/main.py`. If even one diverges, H2 confirmed.

4. **Audit reviewer-playbook.md + reviewer.md for dev-server-boot check** (10 min):
   - `.claude/agents/reviewer.md` — does dim-2 architecture-conformance include "verify the dev-server boots" as a check item?
   - `docs/reviewer-playbook.md` (if it exists at factory root) — same audit
   - **Tests H3 (reviewer surface). Expected: NO such check exists — that's a real gap, not a regression.**

5. **Audit verifier classification of backend pre-boot failure** (10 min):
   - `orchestrator/src/build-to-spec-verify.ts` — when `spawnBackendDevServer` returns a failure, what shape does it produce? Is it routed to `warnings[]` or to `bugPlansFiled[]`?
   - `orchestrator/src/dev-server.ts` — does the spawn helper inspect stderr for "Could not import module" and classify it differently from "connection timeout"?
   - **Tests H4 (verifier filed as warning, not bug). Expected: warnings-only path — that's the load-bearing gap.**

6. **Audit the bug-fix loop's bug-runtime-tooling-pre-flight closure** (10 min):
   - Read `projects/gotribe-tribe-directory/docs/bugs.yaml` — what is the full body of bug-runtime-tooling-pre-flight? What was the symptom list it was filed against?
   - Read the loop's per-iteration dispatch context for that bug (envelope in `pipeline/` or `.claude/state/`) — did the dispatched agent ever consider moving main.py?
   - `git log --oneline -- 'apps/api/src/main.py' 'apps/api/src/api/main.py'` after the fix-bugs run — confirms no commit during fix-bugs touched either path
   - **Tests H5 (loop closed bug without addressing module-import gap).**

7. **Synthesize fix-recipe scope** (5 min):
   - Once H1-H5 are confirmed or falsified, draft a factory-level fix recipe covering each confirmed gap:
     - Skill change (clarify canonical layout if H2 confirmed)
     - Reviewer dim-2 amendment (add dev-server-boot check if H3 confirmed)
     - Verifier classification change (promote import-module-failure from warning to actionable bug-class if H4 confirmed)
     - Loop bug-filing recipe addition (route Tier 2.5 backend-boot-failure to its own bug class, NOT bundled with synth/playwright)
   - Identify the project-side hand-fix (`mv apps/api/src/main.py apps/api/src/api/main.py` + adjust imports inside) so the operator can re-run after the factory ships

## Findings

### Empirical state of the project (step 1)

- `apps/api/src/` contents: `__init__.py`, `main.py` (479 B, 20 lines), `api/` directory.
- `apps/api/src/api/` contents: `__init__.py` (empty), `guards.py`, `routes/`, `upstream/`, `test_guards.py`. **No `main.py`.**
- `apps/api/src/main.py` declares `from api.routes.tribes import router as tribes_router` and `app = FastAPI(...)` — runnable code, but at the wrong path.
- Canonical spawn `uv run uvicorn api.main:app --app-dir src` (cwd `apps/api/`) resolves the module `api.main` → expects `apps/api/src/api/main.py` → fails with `Error loading ASGI app. Could not import module "api.main".` (literal stderr captured in `docs/_tmp-verify-output.json` line 60 + `parity.warnings[0]`).
- `pyproject.toml` declares `pythonpath = ["src"]` + `[tool.coverage.run] source = ["api"]` — consistent with the `src/api/` layout the skill expects; no project-side config drift saving the file at the wrong path.

### Commit trail (step 2)

```
$ git log --all --oneline -- 'apps/api/src/main.py' 'apps/api/src/api/main.py'
e5c4aea backend-builder: author-guards, author-tribes-route
 apps/api/src/main.py | 20 ++++++++++++++++++++
```

- **Single commit** ever touched `main.py`. It introduced the file at `apps/api/src/main.py` (the wrong path) in the feat-tribe-api builder dispatch (`e5c4aea`).
- No subsequent commit (including the entire fix-bugs run: `77ca1a2`, `d901a05`, `9d9550d`, merge `694d21b`) ever moved or recreated `main.py` at any path. The bug-fix loop never even touched the file.

### python-fastapi SKILL.md self-consistency audit (step 3)

Grep for every `main.py` mention:

```
.claude/skills/agents/back-end/python-fastapi/SKILL.md:24:│       ├── main.py                      # FastAPI app + middleware wiring
.claude/skills/agents/back-end/python-fastapi/SKILL.md:212:Mount-time gate (in `apps/api/src/api/main.py`):
.claude/skills/agents/back-end/python-fastapi/SKILL.md:244:dev:         uv run fastapi dev src/api/main.py
```

All three references agree: `apps/api/src/api/main.py`. The skill is **internally consistent**.

Cross-references:

- `.claude/templates/dev-multi-tier-python-fastapi.mjs.template` (line 155-166): spawn `uv run uvicorn api.main:app --app-dir src` at cwd `apps/api/` → expects `apps/api/src/api/main.py`. Consistent.
- `orchestrator/src/dev-server.ts` STACK_BACKEND_SPAWN_COMMAND["python-fastapi"] (line 81-95): same args. Consistent.

**No drift between skill, template, and orchestrator spawn.**

### Reviewer playbook audit (step 4)

`docs/reviewer-playbook.md` (550 lines, 7 dimensions: architecture / security / compliance / maintainability / a11y / performance / brief-delivery). Grep for boot/dev-server/uvicorn/main.py/api.main mentions:

```
398:# LCP via Lighthouse (requires dev server + Chrome):
406:# Requires a running dev server + a fixture workload.
415:- Backend p95: ≤200ms on `/health` + 1-2 primary endpoints (if artillery + dev server available)
419:- Most perf checks require a running dev server which scratch-repos + first-run pipelines don't have. Reviewer SKIPS this dimension...
```

- All 4 hits are in the **performance** dimension (§6) and refer to skipping perf checks when the dev server is unavailable — the opposite direction of what we'd need.
- **Section 1 (Architecture adherence)** uses `test -d apps/api && test "$(yq .tooling.stack.backend_framework ...) != null"` plus integration-import greps. It checks file _presence_ (the dir exists), never that the dev-server boots, never that `apps/api/src/api/main.py` resolves.
- **No dimension** asks the reviewer to run `uvicorn ... --check` or any equivalent importability probe.
- `python-fastapi/SKILL.md §Review` (lines 274-311) adds 5 stack-specific checks (SQL string interp, webhook raw-body, sync-def in async app, response_model coverage, Depends() auth) — none of them exercises module importability.

### Verifier classification audit (step 5)

`orchestrator/src/build-to-spec-verify.ts` line 462-474:

```ts
try {
  ...
  sharedDevServerHandle = await bootDevServerFn(projectDir, bootTimeoutMs);
  warnings.push(`dev-server: pre-booted at ...`);
} catch (err) {
  warnings.push(
    `dev-server pre-boot failed: ${(err as Error).message}; runFlows + parityVerify will fall back to their own spawn paths (which trip bug-071 on Strategy C — synth-e2e likely 0-tests-run)`,
  );
}
```

- **Pre-boot failure → `warnings.push`. No `fileBugPlan` call.** No actionable bug. No `bugPlansFiled[]` entry.
- The same failure resurfaces 2 more times (line 822 perceptual-skip, line 998 walkthrough-skip, line 1006 walkthrough-no-handle) — every downstream tier dutifully logs to `warnings[]` and skips, never converts to a bug.
- `docs/_tmp-verify-output.json` proves the runtime shape: `bugPlansFiled: [bug-001-runtime-tooling-pre-flight, bug-002-orphan-route-tribes-slug]` (synth + orphan-route surfaces); the uvicorn `Error loading ASGI app. Could not import module "api.main"` appears verbatim in three `warnings[]` entries (parity, top-level warnings, walkthrough) but never in `bugPlansFiled[]`.
- `scripts/file-bug-plan.mjs runtimeErrorBody()` (line 323) is keyed on flow-runner-extracted `runtimeErrors: { consoleErrors, pageErrors, networkFailures, devServerOverlay }` — fields that originate from a Playwright spec page session. An orchestrator-side spawn failure (uvicorn dying before any spec ever runs) has none of those fields, so it can't be filed by the existing runtime-error bug template.

### Bug-fix loop classification audit (step 6)

`projects/gotribe-tribe-directory/docs/bugs.yaml` — `bug-runtime-tooling-pre-flight`:

```yaml
errorLog:
  - "[verifier-captured-stderr] apps/web/playwright.config.ts missing — author per .claude/skills/agents/front-end/{stack}/SKILL.md §3a"
status: completed
attempts: 2
resolvedInIteration: 2
```

- The bug's `errorLog` references **only** the playwright.config.ts surface. No mention of uvicorn / main.py / module-import.
- `projects/gotribe-tribe-directory/plans/active/bug-001-runtime-tooling-pre-flight.md` description: "Runtime errors observed during synthesized flow `tool pre-flight (dev-server / playwright)`" — frames it entirely as a flow-runner-side surface.
- `pipeline/fix-bugs-2026-05-15.log` line 8/11/13: the only auto-fix the loop applied was `AUTO-FIXED apps/api/.env.example: appended missing ENABLE_TEST_SEED=1 (bug-097)` — the pre-verify discriminator's separate concern. The actual bug-fixer dispatches against bug-001 + bug-002 produced no commit that touched `main.py` (confirmed via `git log` step 2).
- Loop reported `status: clean` at iteration 2/2 after fixing playwright config + orphan-route — the uvicorn boot was never the loop's perceived target.

### Hypothesis verdicts

| H   | Statement                                                                                 | Verdict       | One-line evidence                                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | Builder authored at wrong path                                                            | **CONFIRMED** | Commit `e5c4aea` shows `apps/api/src/main.py` was the original (and only) authoring location; no later commit moved it.                                                                                                                                     |
| H2  | python-fastapi SKILL.md internally inconsistent                                           | **FALSIFIED** | All 3 `main.py` mentions in SKILL.md + the template + the orchestrator spawn agree on `apps/api/src/api/main.py`. Builder hallucinated against an unambiguous spec.                                                                                         |
| H3  | Reviewer dim-2 has no dev-server-boot check                                               | **CONFIRMED** | playbook.md grep returns 0 hits for boot/uvicorn/importability; §1 Architecture checks file-presence only; §6 Performance explicitly _skips_ when dev-server unavailable.                                                                                   |
| H4  | Verifier classifies backend pre-boot as warning, not bug                                  | **CONFIRMED** | `build-to-spec-verify.ts:471` is a `warnings.push(...)`; no `fileBugPlan` call on the catch path. `_tmp-verify-output.json` shows the uvicorn error in 3 warnings entries and 0 bugPlansFiled entries.                                                      |
| H5  | Loop bundled module-import into bug-runtime-tooling-pre-flight (synth/playwright surface) | **CONFIRMED** | `bugs.yaml` errorLog cites only playwright.config.ts; bug-001 plan description names "synthesized flow tooling-pre-flight"; fix-bugs commits produced no main.py edit; loop reported `clean` while uvicorn warnings persisted in the final verifier output. |

**Net: 4 of 5 confirmed, 1 falsified.** The single falsified hypothesis (H2) actually makes the picture worse — the spec is unambiguous, the builder hallucinated anyway, and the three downstream detection layers (reviewer / verifier / fix-loop) all failed to catch the hallucination.

## Recommendation

Four detection layers failed in a chain. Each can be patched at a single small surface; the value comes from shipping all four together so re-runs don't recreate the same gap.

### Proposed single bug plan: `bug-NNN-fastapi-layout-detection-stack`

The four fixes share one motivator (the empirical failure on `gotribe-tribe-directory` + the FastAPI-layout root cause) and live in adjacent surfaces (skill + reviewer + verifier + fix-loop). Pack them into a single P0 bug plan with four phases, mirroring the bug-091 / bug-024 three-layer-enforcement pattern.

#### Phase A — Builder-side defensive scaffold

**Surface:** `.claude/skills/agents/back-end/python-fastapi/SKILL.md` §Self-verify (lines 391-408).

**Patch:** add a 4th self-verify step BEFORE reporting `taskStatus: completed`:

```bash
# 4. Importability gate: catches "I authored main.py but at the wrong path"
uv run python -c "import importlib; importlib.import_module('api.main')"
```

Run from `apps/api/` cwd (where `pyproject.toml` lives + `pythonpath = ["src"]` resolves the package). One-line; cheap (~50ms); cannot pass when `src/api/main.py` is missing or unimportable. Builder retries within its own per-task ladder before reviewer ever runs.

Tighten the §Canonical layout text (line 17-24) to mark the path as **mandatory** — bold callout that the entry point is `apps/api/src/api/main.py` (not `apps/api/src/main.py`). Add a one-line anti-pattern in §Anti-patterns naming the failure mode + the importability gate above as the catch.

#### Phase B — Reviewer dim-2 dev-server-boot check

**Surface:** `docs/reviewer-playbook.md` §1 Architecture adherence (lines 23-66) + the per-stack §Review block in `python-fastapi/SKILL.md` (lines 274-311).

**Patch (playbook §1):** add a new sub-criterion under "What it checks":

> When `tooling.stack.backend_framework` is non-null, the backend's canonical entry module MUST be importable. Reviewer runs the stack skill's importability gate; failure → `fail` with retry target `<tier>-builder`.

**Patch (python-fastapi/SKILL.md §Review):** add a new sub-block mirroring the others:

```
#### architecture — backend dev-server module importable

- Invocation: `cd apps/api && uv run python -c "import importlib; importlib.import_module('api.main')"`
- Threshold: exit code 0
- Retry target: backend-builder
- Playbook §: augments §1 architecture (importability sub-check)
```

Repeat the equivalent for `node-fastify` (`pnpm --filter @repo/api exec node -e "require('./src/server.ts')"` adjusted for tsx) + `node-trpc-nest` (`pnpm --filter @repo/api exec nest build --dry-run`) + `node-express` so the detection layer is uniform across all 4 backend stacks.

#### Phase C — Verifier promotes module-import failure from warning to bug

**Surface:** `orchestrator/src/build-to-spec-verify.ts` line 461-475 (the `bootDevServer` try/catch).

**Patch:** on catch, inspect `(err as Error).message` for the canonical module-import signature (`Could not import module|cannot import name|ModuleNotFoundError|ImportError`); when it matches, file a dedicated bug plan via `fileBugPlan({ kind: "backend-module-import-failure", primaryCause: "backend-boot-failure", ... })` IN ADDITION to the warning. The bug body names the resolved spawn cmd + stderr tail + the canonical entry module path expected per the stack skill.

This requires a new bug template in `scripts/file-bug-plan.mjs` (call it `backendBootFailureBody(v, opts)`) keyed on the spawn-failure shape (no playwright `runtimeErrors` fields available). The template surfaces:

- Stack slug (from architecture.yaml)
- Resolved spawn command + cwd
- stderr tail
- Canonical entry-module path per the stack skill (`apps/api/src/api/main.py` for FastAPI; `apps/api/src/server.ts` for Fastify; etc.)
- Likely category: "module-path-mismatch" | "uv-missing" | "port-collision" | "depencency-not-installed"

#### Phase D — Bug-fix loop bug-class routing (defense in depth)

**Surface:** `scripts/file-bug-plan.mjs` `defaultAgentSequence()` (line 998+) — add a routing case for `primaryCause: "backend-boot-failure"`.

**Patch:** route to `bug-fixer` (single-file dispatch — moving `main.py` is a one-file mv) with the bug template from Phase C as pre-loaded context. The bug-fixer's pre-loaded context already cites the canonical path per stack skill → it should mechanically run `git mv apps/api/src/main.py apps/api/src/api/main.py` (FastAPI) or the equivalent for other backends and re-run the importability gate from Phase A.

Add `apps/api/src/api/main.py` (for FastAPI projects) to `orchestrator/src/protected-files.ts` `PROTECTED_FILES` so once it's at the right path, the bug-091 guard prevents a later fix-loop dispatch from deleting it again.

### Tests to add

- `orchestrator/tests/build-to-spec-verify.test.ts` — new case: mock `bootDevServer` to reject with "Could not import module ..."; assert `bugPlansFiled[]` contains a `backend-boot-failure` entry.
- `orchestrator/tests/protected-files.test.ts` — add the new path entry.
- `.claude/skills/agents/back-end/python-fastapi/tests/` (if present) — self-verify-step-4 importability gate dry-run.

### Operator hand-fix recipe (run AFTER factory fix ships)

For the currently-broken `gotribe-tribe-directory` project, the corrective steps are:

```pwsh
cd C:\Development\ps\claude\claude_\agentflow_phase2\projects\gotribe-tribe-directory\apps\api
git mv src\main.py src\api\main.py
# Verify import surface — no edits needed; the file already declares
#   `from api.routes.tribes import router as tribes_router`
# which resolves identically from src/api/main.py (api package is on
# src/ pythonpath per pyproject.toml line 25).
cd ..\..
uv --directory apps\api run python -c "import importlib; importlib.import_module('api.main')"  # should exit 0
# Manual boot to confirm:
uv --directory apps\api run uvicorn api.main:app --app-dir src --port 8001
# In another shell: curl http://localhost:8001/health  -- should 200 or 404 (not connect-refuse)
git add apps\api
git commit -m "fix(layout): move main.py to apps/api/src/api/main.py (canonical FastAPI entry point per python-fastapi SKILL.md §1)"
```

Then re-run `/build-to-spec-verify gotribe-tribe-directory` — Tier 1-2 should remain clean, Tier 3 (parity) should now have `screensChecked > 0`, Tiers 4 (perceptual) + 5 (walkthrough) should fire instead of cascade-skipping.

No edits to `apps/api/src/api/__init__.py` needed (it's already an empty package marker). No edits to imports needed (the file already uses absolute `from api.routes.tribes import ...` which resolves identically at the new path because `src/` is on pythonpath).

Pyproject.toml's `[tool.coverage.run] source = ["api"]` already targets the right package; no change needed.

## Attempt Log

## Attempt 1 — investigation execution (2026-05-15)

Executed all 7 steps of the plan body within the 60-minute time box.

**Step 1 — Project state confirmed:** `apps/api/src/main.py` (479 B) exists, `apps/api/src/api/main.py` does NOT. The `src/api/` directory has `__init__.py` + `guards.py` + `routes/` + `upstream/` + `test_guards.py` but no main.py. The runtime error in `docs/_tmp-verify-output.json` is captured verbatim: `Error loading ASGI app. Could not import module "api.main"`. Did NOT manually re-run uvicorn — the empirical state was already in the verifier output, and re-running would have needed `uv run uvicorn ...` which the operator can do post-fix.

**Step 2 — Builder trail traced:** `git log --all --oneline -- 'apps/api/src/main.py' 'apps/api/src/api/main.py'` returns exactly ONE commit: `e5c4aea backend-builder: author-guards, author-tribes-route` adding `apps/api/src/main.py | 20 ++++++++++++++++++++` and zero hits at the canonical path. **H1 confirmed.** Reviewed full project commit log — no main.py movement during fix-bugs phase (commits `77ca1a2`, `d901a05`, `9d9550d`, merge `694d21b`).

**Step 3 — SKILL.md audited:** 3 mentions of `main.py` in `.claude/skills/agents/back-end/python-fastapi/SKILL.md` at lines 24, 212, 244 — all three point at `apps/api/src/api/main.py` or `src/api/main.py`. Template `dev-multi-tier-python-fastapi.mjs.template` line 155-166 spawns `uv run uvicorn api.main:app --app-dir src` at cwd `apps/api/` — resolves to `apps/api/src/api/main.py`. `orchestrator/src/dev-server.ts` line 81-95 STACK_BACKEND_SPAWN_COMMAND["python-fastapi"] uses identical args. **H2 falsified — three sources agree, builder hallucinated.**

**Step 4 — Reviewer audit:** read `.claude/agents/reviewer.md` (183 lines) + grep'd `docs/reviewer-playbook.md` (550 lines) for boot/uvicorn/main.py/importability. 4 hits, all in §6 Performance and all in the _opposite_ direction (perf checks skip when dev-server unavailable). §1 Architecture checks file presence (`test -d apps/api`) but never module importability. python-fastapi/SKILL.md §Review (lines 274-311) lists 5 stack checks; none probe importability. **H3 confirmed.**

**Step 5 — Verifier classification:** `orchestrator/src/build-to-spec-verify.ts:461-475` shows `bootDevServer` failure → `warnings.push(...)` only; no `fileBugPlan` call on the catch path. Read `scripts/file-bug-plan.mjs runtimeErrorBody()` lines 308-429 — keyed on Playwright-spec-extracted `runtimeErrors: { consoleErrors, pageErrors, networkFailures, devServerOverlay }` fields, which a pre-spec spawn failure doesn't have. `docs/_tmp-verify-output.json` shows `bugPlansFiled: [bug-001-runtime-tooling-pre-flight, bug-002-orphan-route-tribes-slug]` (synth surface + orphan-route surface) while the uvicorn `Could not import module "api.main"` appears verbatim in 3 separate `warnings[]` entries. **H4 confirmed.**

**Step 6 — Loop closure:** `docs/bugs.yaml` bug-runtime-tooling-pre-flight `errorLog` references `apps/web/playwright.config.ts missing` only — no uvicorn / main.py mentions. Bug plan body (`plans/active/bug-001-runtime-tooling-pre-flight.md`) frames the bug entirely as a "synthesized flow" surface. `pipeline/fix-bugs-2026-05-15.log` shows the only auto-fix was bug-097's `ENABLE_TEST_SEED=1` to `.env.example`. Loop reported `status: clean` at iter 2/2 while the uvicorn warning persisted in the final verifier output. `git log` confirmed no fix-bugs commit touched main.py. **H5 confirmed.**

**Step 7 — Recommendation synthesized:** single P0 bug plan covering all 4 detection layers (skill self-verify + reviewer dim-2 + verifier classification + loop routing); operator hand-fix is a one-file `git mv` (no import edits needed because the file already uses absolute imports that resolve identically at the new path).

Final outcome: 4 of 5 hypotheses confirmed, 1 falsified (H2 — the SKILL.md is unambiguous, which makes the builder hallucination + downstream detection-layer cascade _worse_, not better, because no source has wrong guidance to point at). Findings + Recommendation populated; plan transitioned `draft → completed`.
