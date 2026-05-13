---
id: bug-097-scaffold-env-test-seed-default
type: bug
status: completed
author-agent: human
created: 2026-05-13
updated: 2026-05-13
outcome: shipped — root cause re-attributed (skill templates are correct; architect emit didn't follow) + defense-in-depth landed (architect self-verify step 14 + pre-verify discriminator auto-fix)
parent-plan: feat-066-fix-loop-effectiveness-v2 (v2-Phase-3)
supersedes: null
superseded-by: null
branch: fix/scaffold-env-test-seed-default
affected-files:
  - .claude/agents/architect.md
  - orchestrator/src/pre-verify-discriminators.ts
  - orchestrator/tests/pre-verify-discriminators.test.ts
feature-area: stack-skills/scaffold-templates
priority: P0
attempt-count: 1
max-attempts: 5
error-message: "/build-to-spec-verify pre-flight discriminator rejects projects whose apps/api/.env.example sets ENABLE_TEST_SEED=0. The contract (.claude/rules/testing-policy.md Strategy-C) requires =1 in dev; production should override to =0. The scaffold templates ship the inverse default, so every fresh project gets pre-flight-blocked until manually patched."
reproduction-steps: "1. /new-project foo --stack node-fastify (or python-fastapi or node-trpc-nest). 2. Run /analyze .. /architect .. through to /start-build verify. 3. Verifier pre-flight fails with 'pre-verify-discriminator: tooling-test-seed-contract-broken — apps/api/.env.example sets ENABLE_TEST_SEED=0'. Verifier files bug-091-compile-pre-verify-tooling-test-seed-contract-broken (project-side). Operator must manually edit apps/api/.env.example to =1 before re-running."
stack-trace: null
---

# bug-097: scaffold templates ship apps/api/.env.example with ENABLE_TEST_SEED=0 — verifier pre-flight rejects every fresh project

## Bug Description

The backend stack skills (node-fastify, python-fastapi, node-trpc-nest) scaffold projects with `apps/api/.env.example` containing `ENABLE_TEST_SEED=0`. The verifier's pre-flight tooling discriminator rejects this on contact:

```
pre-verify-discriminator: tooling-test-seed-contract-broken —
apps/api/.env.example sets ENABLE_TEST_SEED=0. Per the Strategy-C
test-seed-contract this MUST be `=1` in dev; otherwise POST /test/seed*,
/test/cleanup, /test/seed-baseline all 404 + Playwright globalSetup fails.
See bug-080.
```

The verifier then halts the entire tier chain, files a bug plan, and exits with `ok: false`. Tiers 1-5 never get a chance to run. The operator has to manually edit the file to `=1` to unblock.

## Empirical evidence

2026-05-13, reading-log-02: first `/build-to-spec-verify` run blocked at pre-flight in 37 ms. Edit `apps/api/.env.example` line 27: `=0` → `=1`. Re-run: pre-flight passes, all 6 tiers proceed normally. The dev `.env` (not `.env.example`) already had `=1` — only the template was wrong.

## Root Cause

The stack-skill templates were authored before the Strategy-C contract landed. The historical intuition was "default to OFF for safety" — but that intuition is wrong for THIS contract: the `/test/*` endpoints are explicitly gated behind `ENABLE_TEST_SEED=1`, so leaving them off means tests can't seed/cleanup, Playwright globalSetup fails, the verifier's flow-execution tier fails, etc.

The correct default is `=1` for the dev template. Production deployments override via their own env mechanism.

## Fix Approach

Update each backend stack-skill's `apps/api/.env.example` template (and any internal templates that scaffold this file) so the default shipped value is `=1` with a comment indicating production should override:

```env
# E2E test-seed gating. Required `=1` in dev per Strategy-C test-seed
# contract (.claude/rules/testing-policy.md) so the verifier's pre-flight
# passes + Playwright globalSetup can call /test/seed-baseline.
# Production should override to `=0`.
ENABLE_TEST_SEED=1
```

Files to update (one line each):

- `.claude/skills/agents/back-end/node-fastify/SKILL.md` — the embedded `.env.example` template
- `.claude/skills/agents/back-end/python-fastapi/SKILL.md` — same
- `.claude/skills/agents/back-end/node-trpc-nest/SKILL.md` — same

Plus regenerate any inline test fixtures that reference the templates.

## Validation Criteria

- [ ] Update the 3 stack-skill templates to `=1`.
- [ ] Generate a fresh project from each of node-fastify, python-fastapi, node-trpc-nest.
- [ ] Confirm `apps/api/.env.example` ships with `=1`.
- [ ] Run `/build-to-spec-verify` against the fresh project: pre-flight passes, no `bug-compile-pre-verify-tooling-test-seed-contract-broken` filed.
- [ ] Production deployment override path documented in stack-skill §Production section.

## Cross-references

- **`.claude/rules/testing-policy.md` §Strategy-C-test-seed-contract** — the contract this scaffold defaults violate.
- **bug-080** (factory archive) — the original discriminator that catches this. Its existence is what made today's bug visible.
- **bug-095** — in-loop verifier DB pollution. Companion; bug-097 makes bug-095 NOT immediately re-fire on every fresh project.
- **bug-096** — apiBase env regression. Companion; the test-seed-contract reliability set.

## Attempt Log

### 2026-05-13 — root cause re-attributed + defense-in-depth shipped

Initial bug-097 framing said "stack-skill templates ship `=0`". On inspection, all three backend stack-skill SKILL.md files explicitly require `=1` (node-fastify §3 step 4 line 232; python-fastapi §3 line 227; node-trpc-nest §3 line 212). The architect-skill template (`.claude/skills/architect/SKILL.md` line 254) also emits `=1` with a `NEVER ship this file with =0` comment. The templates are correct.

The empirical bug is that reading-log-02's `.env.example` shipped with `=0` despite the correct templates — meaning either (a) the project was generated before the templates were updated, or (b) a downstream agent (post-architect) flipped it, or (c) the architect agent didn't follow its skill precisely on that specific run.

Defense-in-depth landed:

1. **Architect self-verify step 14** (`.claude/agents/architect.md`): when `backend_framework` is non-null, mechanically verify `apps/api/.env.example` matches `/^ENABLE_TEST_SEED=1$/m`. AUTO-FIX (append canonical comment block + `=1`) when missing; HARD-FAIL when explicitly `=0`. Prevents new projects from shipping wrong.

2. **Pre-verify discriminator auto-fix** (`orchestrator/src/pre-verify-discriminators.ts`): when `testSeedContractDiscriminator` detects `=0` OR missing line, rewrites/appends in place and returns `null` (no bug filed). Emits a stderr warning so the operator sees the auto-fix happened. Heals existing projects already in the bad state.

Tests updated to reflect new behavior:

- `orchestrator/tests/pre-verify-discriminators.test.ts`: 2 tests rewritten to assert auto-fix (P0 + P2 cases). Added file-content assertions confirming the rewrite.
- `orchestrator/tests/build-to-spec-verify.test.ts`: 1 test ("does NOT short-circuit on a P1/P2-only hit") rewritten — no longer expects a warning in `result.warnings`; instead asserts the file was modified to `=1`.

Suite: 23/23 discriminator tests pass; 942/942 full orchestrator suite green.
