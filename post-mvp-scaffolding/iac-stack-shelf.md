# iac-stack-shelf

**Deferred from**: investigate-003-infrastructure-as-code (punted to post-MVP without executing).

## The concern

The MVP roadmap says feat-005 architect emits `docker-compose.yml` for local dev + `.github/workflows/ci.yml` for PR checks. That's the **local-dev + lint-on-PR** minimum. It doesn't cover:

- **Cloud provider selection** — AWS / GCP / Azure / Vercel / Fly / Cloudflare / onprem
- **IaC tool choice** — Terraform / Pulumi / CDK / Ansible / Helm
- **Infra stack skills** analogous to feat-002's app-stack shelf: `.claude/skills/agents/infra/{vercel-managed, fly-io, terraform-aws-minimal, pulumi-gcp, cloudflare-workers, ansible-onprem, k8s-helm, docker-compose-only-local}/SKILL.md`

Without these, every autonomous run's output PR lands as "clone + docker-compose up locally"; a human is still responsible for the actual cloud deploy.

## Why deferred

MVP exit criterion = "PR awaiting human approval before merge to main; app runs locally via docker-compose." That's a defensible split — factory generates, human deploys. For the first 1-5 autonomous runs, human cloud deploy is acceptable; once the factory proves itself, automation earns trust for higher-risk work.

Starting without IaC avoids: 60+ min of investigation time, scope drift on feat-005 mid-implementation, and premature commitment to a cloud-provider opinion before we have real project data on what users actually ask for in briefs.

## Rough shape when it's time

### Tier 1: analyst-side research menu

**Analyst phase 2.6** — new step after phase 2.5 integrations-options. Analyst researches 2-3 candidates per infra slot from brief §7 + §8 + competitor analysis + cost constraints. Emits `docs/analysis/shared/deploy-options.md` following the same structure as `integrations-options.md`:

- **Hosting**: 2-3 candidates (Vercel / Fly / AWS ECS / ...)
- **CDN**: Cloudflare / Fastly / AWS CloudFront
- **Database hosting**: Neon / Supabase / AWS RDS / self-managed Postgres
- **Secrets**: Doppler / AWS Secrets Manager / Vault / env-file-only
- **CI/CD vendor**: GitHub Actions / GitLab CI / CircleCI / Drone

Each candidate includes: tier pricing at MVP scale, compliance fit, lock-in assessment, deploy-model (push-to-deploy vs IaC), typical operational cost.

### Tier 2: architect-side decision + IaC emission

Architect reads `deploy-options.md` + brief §8 constraints + reviewer's compliance requirements. Picks one per slot. Writes to `architecture.yaml.tooling.infra`:

```yaml
tooling:
  stack:
    web_framework: react-next
    # ...
  infra:
    hosting: vercel-managed
    cdn: vercel-managed # same provider
    database_hosting: neon
    secrets: doppler
    ci_vendor: github-actions
    iac_tool: null # managed providers don't need IaC
```

Dispatches via `.claude/skills/agents/infra/{slug}/SKILL.md` to emit the IaC artefacts.

### Tier 3: infra stack-skill shelf (initial shipped subset)

Author 3-5 shipped skills matching the most common choices:

- `vercel-managed` — no IaC; `vercel.json` + `.env.production` placeholder + `.github/workflows/deploy-on-merge.yml` that triggers Vercel's native deploy
- `fly-io` — `fly.toml` + `.github/workflows/deploy.yml` running `flyctl deploy`
- `docker-compose-only-local` — MVP's current scope (no cloud)
- `terraform-aws-minimal` — `infra/*.tf` for ECS Fargate + RDS + ALB; cheapest AWS starter
- `cloudflare-workers` — Wrangler config + `.github/workflows/deploy-workers.yml`

Draft-on-first-use: when architect picks an unshipped slug, `/skills-audit --scope=build --auto-author-stack-skills` researches + authors the skill (same pattern as feat-002's long-tail).

Estimated size: large plan — 1000+ LOC across analyst phase 2.6 + architect scope extension + 3-5 stack skills + architecture.yaml schema extension. Split into 3 plans:

- `feat-NNN-analyst-deploy-options-research` (phase 2.6)
- `feat-NNN-architect-infra-decision` (architect scope extension)
- `feat-NNN-infra-stack-shelf` (initial 3-5 shipped skills)

## When to revisit

After first 2-3 successful MVP autonomous runs. By then we know:

- Which cloud providers users actually ask for in briefs
- Which costs scale cleanly vs surprise
- Which deploy patterns are common vs client-specific

Without that data, any infra stack shelf decision is a guess. With it, the shelf is informed.

## Related

- `multi-env-deploy.md` — dev/test/prod separation; pairs with deploys
- `ci-cd-deploy-automation.md` — PR-merge → staging deploy + prod approval gate
- `security-checklist-grounding.md` — reviewer's compliance dimension flags infra gaps today; full ASVS coverage + cloud-specific checks land alongside IaC
