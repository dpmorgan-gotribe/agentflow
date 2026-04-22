# multi-env-deploy

**Deferred from**: investigate-003-infrastructure-as-code (punted to post-MVP without executing).

## The concern

Gate 5 today captures a single `.env` via file-drop. Real apps have **dev + test + prod** environments with different credentials, different resource scaling, different deploy approval thresholds. The factory currently emits one `.env.example`; user fills one `.env`; that's the only environment.

For true multi-env, we need:

- `.env.dev.example` — local dev overrides (e.g. `DATABASE_URL=postgresql://localhost/mydb_dev`)
- `.env.test.example` — CI test-run config (ephemeral DB, mock services, test-tier API keys)
- `.env.prod.example` — prod secrets + prod service URLs + locked-down settings

Gate 5 evolves into gate-5.a + gate-5.b + gate-5.c — one file-drop per env (`docs/credentials-confirmed-{env}.txt`). Architect emits three parallel checklists.

## Why deferred

MVP ships a PR that runs locally via docker-compose. Local-dev has `.env` at project root + defaults in code. There's no staging or prod environment to configure because there's no automated deploy. Multi-env is nonsense without cloud deploys — and cloud deploys are deferred to `iac-stack-shelf.md`.

Coupling is correct: multi-env lands WITH the IaC stack shelf, not before. Either both or neither.

## Rough shape when it's time

### Architect scope extension

```yaml
# architecture.yaml
envs:
  dev:
    hosting: local # docker-compose
    database: local-postgres-docker
    secrets_mode: env-file
  test:
    hosting: ephemeral # CI-only
    database: testcontainers-postgres
    secrets_mode: ci-secrets-injection
  prod:
    hosting: vercel-managed # from infra.hosting
    database: neon
    secrets_mode: doppler
    deploy_gate: manual-approval # gate-5.c
```

Architect emits:

- `.env.dev.example` / `.env.test.example` / `.env.prod.example`
- `docs/credentials-checklist-dev.md` / `-test.md` / `-prod.md` — per-env signup URLs + required keys
- `docs/deployment-checklist-prod.md` — prod-specific checks (DNS, certs, backup verified, monitoring configured, runbook URL)

### Gate 5 evolution

Current single gate 5 (file-drop `docs/credentials-confirmed.txt`) becomes 3 serial gates:

- **gate-5.a** (dev): `docs/credentials-confirmed-dev.txt` — user fills `.env.dev`; file-drop unblocks `/pm` through `/build-*` stages
- **gate-5.b** (test): `docs/credentials-confirmed-test.txt` — user fills CI secrets (or supplies a single "use test-tier keys" flag); unblocks `/test` + `/review`
- **gate-5.c** (prod): `docs/credentials-confirmed-prod.txt` — user fills prod-tier `.env.prod`; unblocks `git-agent bootstrap-pr`. Optional `defer:prod-deploy` body → PR is created but production deploy config stays empty; human does it post-merge

### Orchestrator impact

`task-036-hitl-gates-server` currently specifies single-gate-5. When multi-env lands, extend to 3-sub-gates. Either a gate-5 option flag (`multi_env: true`) or three separately-watched paths.

### Validation

Reviewer's compliance dimension gains:

- **Env isolation**: does prod `.env.prod` NEVER appear in `.env.dev` / `.env.test`? (gitignore covers; reviewer confirms)
- **Test-tier keys**: does CI use test-tier Stripe / Resend / etc. keys, not prod?
- **Secret scanning**: no hardcoded prod values in committed code

Estimated size: large plan — 800+ LOC across architect template updates + gate-5 evolution + orchestrator dispatch + reviewer dimensions.

## When to revisit

**Couple to `iac-stack-shelf.md`** — revisit both together. Multi-env without cloud deploy is architectural waste; cloud deploy without multi-env is unsafe (one mistake brings down prod).

Trigger: after first autonomous run + first human deploy + first "oh I used dev keys in prod by accident" bug. That real-world friction informs the multi-env design more than speculative planning.

## Related

- `iac-stack-shelf.md` — pair plan; ship together
- `ci-cd-deploy-automation.md` — CI runs need test-env secrets; prod deploys need prod-env + manual approval
- `security-checklist-grounding.md` — reviewer compliance for env isolation
