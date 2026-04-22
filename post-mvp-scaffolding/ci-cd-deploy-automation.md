# ci-cd-deploy-automation

**Deferred from**: investigate-003-infrastructure-as-code (punted to post-MVP without executing).

## The concern

MVP's `feat-005` must-have emits `.github/workflows/ci.yml` that runs on pull_request + push-to-main with these jobs: typecheck + lint + test. That's **verification**, not deploy automation.

Missing (post-MVP):

- **Deploy-on-merge-to-main** → staging environment (auto)
- **Manual-approval-for-prod** → prod environment (human clicks approve in GitHub Actions UI)
- **PR-preview environments** — each PR gets an ephemeral deploy URL for reviewer to exercise
- **Rollback workflow** — click to revert prod to previous deploy
- **Smoke tests post-deploy** — hit `/healthcheck` + critical paths + page fail on regression
- **Deploy telemetry** — PR → CI time; merge → staging time; staging-verified → prod time; failure rates per stage
- **Multi-CI-vendor support** — GitHub Actions is default; GitLab CI + CircleCI + Drone as stack-skill alternatives

## Why deferred

MVP exit: "PR awaiting human approval before merge to main; app runs locally via docker-compose." There is no staging environment to deploy to; there is no prod deploy automation. Deploy-automation is meaningless without an infra target, and infra targets are deferred to `iac-stack-shelf.md`.

Even without automation, the existing feat-005 CI workflow catches regressions at PR time — which is what the MVP needs: "don't merge broken code to main." Production deploys are manual for the first few autonomous runs.

## Rough shape when it's time

### Stack-skill coupling

Each `iac-stack-shelf.md` infra skill ships with its own CI/CD workflow template:

- `vercel-managed/SKILL.md` → push-to-main triggers Vercel's native deploy (no workflow file needed; Vercel watches the branch)
- `fly-io/SKILL.md` → `.github/workflows/deploy-staging.yml` on merge-to-main + `deploy-prod.yml` with `environment: production` for approval gate
- `cloudflare-workers/SKILL.md` → `.github/workflows/deploy.yml` running `wrangler deploy`
- `terraform-aws-minimal/SKILL.md` → `.github/workflows/terraform-plan.yml` on PR + `.github/workflows/terraform-apply.yml` with manual approval on merge

Each skill's workflow uses `environment:` GitHub Actions feature for approval gates.

### PR preview deploys

Pattern: PR opens → CI builds + deploys to ephemeral URL (`https://pr-123.myapp.staging.example.com`) → URL commented on the PR + surfaced in gate-6 viewer. Reviewer clicks through the real running app instead of just reviewing code.

Varies by infra skill:

- Vercel: native preview deploys (no config needed)
- Fly: per-PR app name + cleanup on PR close
- Cloudflare Workers: custom preview subdomain
- AWS: most complex — requires ephemeral infra provisioning + teardown

Implementing preview deploys PER skill is substantial; ship only for the 1-2 simplest cases (Vercel + Cloudflare) first; others gain it later.

### Rollback + monitoring + smoke tests

- **Rollback**: `.github/workflows/rollback-prod.yml` with `workflow_dispatch` trigger + previous-sha input. Runs deploy with explicit sha.
- **Post-deploy smoke**: after deploy job succeeds, runs `curl $PROD_URL/healthcheck` + 2-3 critical-path requests; if fail, triggers auto-rollback workflow.
- **Deploy telemetry**: not in CI workflows; belongs in `cost-projection-preview.md`'s telemetry scope.

### Gate 6 evolution (human PR review)

With deploy-automation, gate 6 viewer shows:

- PR diff summary (existing)
- Reviewer playbook results (existing)
- **Preview-deploy URL** (new) — human clicks through real app
- **Deploy-to-staging checkbox** (new) — approved PR automatically deploys on merge; uncheck to defer

### Gate 7 (new) — prod deploy approval

After PR merges + staging deploy succeeds, a new gate-7 opens with file-drop `docs/gate-7-prod-deploy-approved.txt`. User checks staging, drops `proceed` / `abort`. Orchestrator triggers prod deploy workflow on `proceed`.

Estimated size: large — split into 3 plans:

1. `feat-NNN-ci-deploy-workflows-per-stack` (infra skill template extension)
2. `feat-NNN-pr-preview-deploys` (Vercel + Cloudflare first; others later)
3. `feat-NNN-gate-7-prod-approval` (multi-env gate evolution couples here)

## When to revisit

**After** `iac-stack-shelf.md` + `multi-env-deploy.md` land. Deploy automation is meaningless without cloud targets + multi-env config. Ship all 3 as a bundle.

Earliest reasonable trigger: after 3+ successful autonomous runs produce PRs that users manually deploy repeatedly — that friction drives the prioritization. Until then, the manual deploy is low-frequency + low-regret.

## Related

- `iac-stack-shelf.md` — source of truth for cloud target + IaC tool; ships CI workflow templates per skill
- `multi-env-deploy.md` — provides per-env secrets + deploy-approval thresholds
- `runtime-signoff-gate.md` — could subsume or extend gate-7's role (capture screenshots of running staging app + compare to signed-off designs)
- `factory-self-upgrade.md` — CI/CD for the FACTORY itself (when agent files evolve) parallel concern
