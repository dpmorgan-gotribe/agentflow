---
id: investigate-003-infrastructure-as-code
type: investigation
status: draft
author-agent: human
created: 2026-04-22
updated: 2026-04-22
parent-plan: null
supersedes: null
superseded-by: null
branch: null
affected-files: []
feature-area: infrastructure
priority: P1
attempt-count: 0
max-attempts: 5
time-box-minutes: 60
hypothesis: |
  Infrastructure-as-code + multi-env deployment + CI/CD is currently
  covered ONLY as feat-005-architect-implementation's "must-have
  minimum" — docker-compose.yml for local dev + .github/workflows/ci.yml.
  That covers dev-loop but NOT: multi-env deploy (dev/test/prod), cloud
  provider choice (AWS/GCP/Vercel/Fly/onprem), client-supplied infra
  constraints, production secrets management beyond single-env .env, or
  IaC tool choice (Terraform/Pulumi/Ansible/CDK).

  Likely right answer — mirror the existing integration-options pattern:
  ANALYST researches deploy-target candidates (phase 2.6 → emits
  deploy-options.md menu of 2-3 cloud/platform candidates per tier);
  ARCHITECT picks one + emits IaC per feat-002's stack-skill-dispatch
  pattern (new tier: .claude/skills/agents/infra/{terraform-aws,
  pulumi-gcp, vercel-managed, fly-io, cloudflare-workers, ansible-onprem,
  k8s-helm, ...}). Client-supplied constraints live in brief §8 (already
  exists in brief-template) + feed the analyst's research.

  Multi-env is a gate-5 evolution: instead of single .env, architect emits
  .env.dev + .env.test + .env.prod.example with per-env credential
  checklists; file-drop mechanic stays the same per env.

  MVP for first autonomous run: extend feat-005 must-haves with a lean
  "one target + one env" baseline (Vercel-web + Neon-db + single prod
  env). Full IaC shelf + multi-env is post-MVP deferral.
---

# investigate-003-infrastructure-as-code: How does infrastructure-as-code + multi-env deployment + CI/CD figure into the factory pipeline? Who decides, how is it configured, and when does it land?

## Question

**Integrated**: Given our goal of autonomous brief→shippable-PR, how does infrastructure-as-code (docker-compose for dev, CI/CD workflows, multi-env cloud deploys, production secrets management, client-supplied infra constraints) fit into the pipeline — which agent owns which decision, how do we capture constraints at `/new-project` vs `brief.md` time, and does this extend the 8-plan roadmap or stay a post-MVP concern?

**Sub-questions**, each falsifiable:

1. **Ownership split**: Does infra research (candidate cloud providers, IaC tool choice, deploy targets) belong with the analyst (phase 2.5-style research menu) or with the architect (fresh-decision per brief)? Or both — analyst researches menu, architect picks?

2. **Config surface**: Where does a client specify "we have an existing k8s cluster at our colo; deploy there" vs "we want Vercel" vs "we have no opinion, pick something cheap"? `brief.md §8`? A new `/new-project --deploy-target=<slug>` flag? An architect interactive prompt?

3. **Scope of "infra stack skill shelf"**: Should we mirror feat-002's stack shelf for IaC? `.claude/skills/agents/infra/{terraform-aws, pulumi-gcp, vercel-managed, fly-io, cloudflare-workers, ansible-onprem, k8s-helm, ...}/SKILL.md`? What's the minimum shipped-subset for MVP?

4. **Multi-environment strategy**: Dev + test + prod. Who generates each env's config? How does gate 5 (single `.env` today) evolve to handle multiple envs? Does each env get its own file-drop?

5. **CI/CD pipelines**: Who authors `.github/workflows/*.yml` (or GitLab CI / CircleCI equivalents)? Does the choice of CI vendor come from the brief / analyst / architect? What about deploy-to-production automation vs manual-approval gates?

6. **Observability at infra level**: feat-007 already wires SDK-level observability (Sentry/PostHog init in code). What about infra-level monitoring (CloudWatch, Datadog hosts, uptime checks, log aggregation from pods)? Architect's scope? New agent?

7. **Compliance impact**: If brief §14 names "SOC2 required", that has deploy implications (VPC isolation, audit logging, encrypted backups, data residency). Does architect handle or does reviewer catch missing controls?

8. **Cost + budget**: Infra has a running-cost profile separate from factory-run cost. Does architect project "estimated monthly cost: $120/mo for MVP stack"? Does that go in `.env.example` or a separate `docs/infra-cost-projection.md`?

9. **Integration with existing 8-plan roadmap**: Which plans need scope extensions vs which spawn new plans? Specifically — does feat-005 (architect) need to own all of this, or do we split into feat-005 (app architecture) + new feat-NNN-infra-architect? Does the new "gate 6 PR review" become more complex with multi-env considerations (e.g., "approve merge to main → triggers staging deploy → separate approval for prod deploy")?

10. **Deferrable vs MVP-blocker**: What's the MINIMUM infra scope for first autonomous run on mindapp-v2? Local docker-compose + basic CI + single-env Vercel-like deploy? Or is that insufficient for "shippable"? And what's explicitly post-MVP?

## Hypothesis

Captured in frontmatter. Short version:

- **Mirror integrations-options pattern**: analyst researches deploy candidates (phase 2.6 → `docs/analysis/shared/deploy-options.md`); architect picks one + emits IaC.
- **Infra stack-skill shelf** modeled on feat-002: `.claude/skills/agents/infra/{slug}/SKILL.md` with ~5 shipped (vercel-managed, fly-io, cloudflare-workers, terraform-aws-minimal, docker-compose-only-local).
- **Brief §8 carries client constraints** (existing servers, compliance, cloud vendor preferences); `/new-project` flag is for non-client-specific demo convenience only.
- **Multi-env is gate-5 evolution**: `.env.dev.example` + `.env.test.example` + `.env.prod.example` with three `docs/credentials-confirmed-{env}.txt` file-drops.
- **MVP baseline = "one cloud target, single prod env"**: enough for a shippable-to-somewhere PR. Full shelf + multi-env is post-MVP.

Investigation will confirm the split or flag where it breaks.

## Investigation Steps

### Phase 1 — What brief + scaffolding already say (15 min)

1. **Read `brief-template.md` §7 Architecture + §8 Build Decisions + §13 Security + §14 Compliance + §18 Infrastructure** (if exists). Extract what the brief already captures about infra + deploy target + cloud preference + environments. Identify gaps.

2. **Read `scaffolding/07-020-architect-agent.md`** — current architect scope + the `.env.example` + `credentials-checklist.md` + `deployment-checklist.md` emission. Note: `deployment-checklist.md` EXISTS as a spec'd artefact — what does it currently cover?

3. **Read `feat-005-architect-implementation` must-have I wrote in `docs/build-tier-roadmap.md`** — "architect emits docker-compose.yml for local dev + .github/workflows/ci.yml". Scope check: does this cover multi-env? Does it cover non-Vercel deploy targets? Does it handle client-supplied infra?

4. **Read `docs/analysis/shared/integrations-options.md`** (produced by analyst phase 2.5 on mindapp-v2) — see the SHAPE of the research-menu pattern. Infrastructure could mirror this exactly.

5. **Read `post-mvp-scaffolding/`** — check if any stub already covers an infra concern that should be promoted.

### Phase 2 — What's explicitly missing (15 min)

6. **Catalog what's missing from "shippable"**:
   - Multi-env config + secrets
   - Cloud provider selection + IaC tool choice
   - CI/CD beyond single-workflow basic
   - Production deploy automation vs manual gates
   - Infra-level monitoring + uptime checks
   - DNS + cert provisioning
   - Compliance-driven infra constraints (SOC2/GDPR/HIPAA)
   - Cost projection

7. **For each missing item, check against `post-mvp-scaffolding/README.md`** — which are genuinely post-MVP vs which would block first autonomous run?

### Phase 3 — Decision framework (15 min)

8. **Ownership**: map each missing item to analyst (research menu) / architect (pick + emit) / tester (verify) / reviewer (compliance-check). Use the existing vendor-integration pattern as the template.

9. **Config capture**: for each item, decide where config lives — brief §8 / `/new-project` flag / architect interactive prompt / analyst default. Prefer brief-first; flags for demo-only.

10. **Stack skill shelf shape**: if infra needs a shelf, what are the minimum 3-5 shipped stacks for MVP? Draft the list + justifications (vercel-managed = cheapest path to ship; fly-io = full-stack cheap; terraform-aws-minimal = for compliance-required projects; cloudflare-workers = edge-first; docker-compose-only-local = no deploy, user handles).

### Phase 4 — Integration with 8-plan roadmap (10 min)

11. **Per plan in `docs/build-tier-roadmap.md`, check if infra impact requires scope extension**:
    - task-035 orchestrator: probably unchanged (infra work doesn't change how orchestrator dispatches)
    - task-036 HITL gates: potentially affected — does gate 5 become "gate 5.a/5.b/5.c per env"?
    - feat-005 architect: almost certainly extended — this is where IaC lands
    - feat-006 PM: potentially — do infra tasks get their own feature ID in tasks.yaml, or fold into backend-builder scope?
    - feat-007 builders: probably unchanged — builders make app code, not infra
    - feat-008 tester: potentially extended — infra tests (does docker-compose boot? does CI workflow lint?)
    - feat-009 reviewer: extended — compliance checks include infra
    - refactor-005 reviewer alignment: playbook needs infra dimensions

12. **Which concerns spawn NEW plans vs extend existing**:
    - Full infra stack shelf → likely new plan (feat-NNN-infra-stack-shelf)
    - Multi-env gate 5 → task-036 extension OR new plan
    - Analyst phase 2.6 deploy-options.md → could be refactor on analyst scaffolding (task 019 equivalent) OR small feature plan
    - Post-MVP deferrals for compliance-driven infra, infra-monitoring, cost-projection

### Phase 5 — Recommendation (5 min)

13. Write a clear recommendation that answers:
    - What's the MVP infra scope (minimum to ship mindapp-v2 autonomously)?
    - What's post-MVP with return criteria?
    - What's the delta to the 8-plan roadmap (scope extensions + new plans + updated must-haves)?
    - What's the first concrete change — do we update docs/build-tier-roadmap.md to version 2 before approving task-035?

## Findings

<!-- Filled by executing agent.

Structure mirroring Investigation Steps:

### Phase 1 — What brief + scaffolding already say
1-5. Observations per step with file:line citations

### Phase 2 — What's explicitly missing
6-7. Gap table: { item, current-state, missing-details, MVP-blocker? }

### Phase 3 — Decision framework
8-10. Ownership matrix + config-capture decisions + infra stack shelf draft

### Phase 4 — Roadmap integration
11-12. Per-plan scope-extension list + new-plan proposals

### Cross-cutting observations
- Surprises
- Things that look MVP but turn out to be post-MVP (or vice versa)
- Interdependencies surfaced
-->

## Recommendation

<!-- Filled by executing agent.

Structure:

### MVP infra scope (one paragraph)

The minimum infra story for first autonomous run on mindapp-v2.

### Per-roadmap-plan delta

- feat-005: extend must-haves with {X, Y, Z}
- task-036: extend with {A, B}
- refactor-005: reviewer playbook dimension for infra → {dimensions}

### New plans (if any)

- feat-NNN-infra-stack-shelf — scope + size estimate
- feat-NNN-analyst-phase-2.6-deploy-options — scope + size estimate

### Post-MVP additions to post-mvp-scaffolding/

- Full IaC shelf (Terraform/Pulumi/CDK) beyond shipped 5
- Multi-env gate evolution
- Infra-level observability
- Compliance-driven infra constraints
- Cost projection

### What changes in docs/build-tier-roadmap.md

Is there a v2 of the roadmap that captures the MVP infra scope before
we approve task-035? Or is the delta small enough to patch in place?

### Open questions (leftover)

- Does client-supplied on-prem target need day-1 support, or defer?
- What's the default cloud when brief is silent?
- Does reviewer's security/compliance dimension need infra-specific
  subcategories?
-->

## Attempt Log

<!-- Populated automatically by agents. -->
