# Refactor-003 Verification Checklist

## files (23/23)

- [x] exists: scaffolding/000-scaffolding-index.md
- [x] exists: scaffolding/020-architect-agent.md
- [x] exists: scaffolding/021-pm-agent.md
- [x] exists: scaffolding/022-ui-designer-agent.md
- [x] exists: scaffolding/023-mockups-skill.md
- [x] exists: scaffolding/024-stylesheet-skill.md
- [x] exists: scaffolding/025-screens-skill.md
- [x] exists: scaffolding/026-turborepo-scaffold.md
- [x] exists: scaffolding/027-shared-packages.md
- [x] exists: scaffolding/028-backend-builder-agent.md
- [x] exists: scaffolding/029-web-frontend-builder.md
- [x] exists: scaffolding/030-mobile-frontend-builder.md
- [x] exists: scaffolding/034b-output-contract-zod-schemas.md
- [x] exists: scaffolding/035-orchestrator-core.md
- [x] exists: scaffolding/036-hitl-gates.md
- [x] exists: scaffolding/038-skills-agent.md
- [x] exists: scaffolding/040-app-store-compliance.md
- [x] exists: scaffolding/041-mcp-server-registration.md
- [x] exists: .claude/skills/analyze/SKILL.md
- [x] exists: .claude/skills/analyze/integrations.md
- [x] exists: .claude/skills/new-project/SKILL.md
- [x] exists: multi-agent-app-generation-blueprint.md
- [x] exists: mcp-defaults-design.json

## 034b schema (10/10)

- [x] AnalyzeOutput.integrationsResearched added
- [x] SelectedStyleSchema.iconLibrary added (uses IconLibrary enum)
- [x] IconLibrary enum exported with 5 values
- [x] ArchitectOutput shape rewritten with refactor-003 fields
- [x] CredentialsGateOutput added
- [x] PmOutput as discriminated union on mode
- [x] SkillsAuditOutput as discriminated union on scope
- [x] StageSchemas lookup includes refactor-003 keys
- [x] Package src/ tree includes credentials-gate.ts
- [x] Acceptance criteria list all 17 refactor-003 stages

## analyst (9/9)

- [x] integrations.md sub-skill file exists
- [x] integrations.md documents research-only discipline
- [x] integrations.md lists core + project-specific categories
- [x] SKILL.md argument-hint lists --skip-integrations
- [x] SKILL.md has §3.5 Phase 2.5
- [x] SKILL.md Report JSON includes integrationsResearched
- [x] SKILL.md self-verification lists integrations-options.md
- [x] requirements.md template no longer names specific vendors
- [x] Related skills list references integrations.md

## 020 architect (11/11)

- [x] tier moved to 6.5
- [x] depends-on includes analyst + visual-review
- [x] single late invocation (no --phase arg)
- [x] three-way deployment enum documented
- [x] emits .env.example (never .env)
- [x] emits credentials-checklist.md
- [x] emits deployment-checklist.md
- [x] emits credentials-diff.md on re-runs
- [x] mirrors selected-style.json.iconLibrary (not decides)
- [x] vendor-decision heuristics documented
- [x] invokes /register-mcp-servers --scope=build

## 035 orchestrator (10/10)

- [x] STAGES includes skills-audit-design
- [x] STAGES includes skills-audit-build
- [x] STAGES includes register-mcp-build
- [x] architect runs post-signoff (dependsOn user-flows)
- [x] architect has gateType: credentials (gate 5)
- [x] pm depends on architect
- [x] pm uses --mode=tasks flag
- [x] kit-change-request detour uses PM dual-mode
- [x] design-stage MCPs NOT registered by orchestrator
- [x] post-signoff kit-change re-runs architect if vendors change

## 036 gate 5 (9/9)

- [x] gates table expanded to 5 rows
- [x] Gate 5 subsection with file-drop spec
- [x] proceed / defer / abort directives documented
- [x] orchestrator NEVER reads .env (stat-only)
- [x] Windows perms noted
- [x] gate 5 never-disable policy
- [x] file-watcher list includes credentials-confirmed.txt
- [x] defer path warns red for requiredNow services
- [x] Acceptance criteria list all 5 gates

## 038 skills (5/5)

- [x] title notes scope-split
- [x] argument-hint supports --scope
- [x] design-scope targets documented
- [x] build-scope reads architecture.yaml filtered to vendor
- [x] rejects invocations without --scope

## 041 mcp (5/5)

- [x] argument-hint supports --scope
- [x] design-scope reads mcp-defaults-design.json
- [x] build-scope reads architecture.yaml.tooling.mcp_servers
- [x] depends-on includes 018b /new-project
- [x] additive merge preserves other scope's entries

## 021 pm (6/6)

- [x] tier moved to 6.5
- [x] depends-on includes architect (020)
- [x] dual-mode documented
- [x] kit-change-request mode does NOT require architecture.yaml
- [x] tasks.yaml template includes integration-ref field
- [x] acceptance lists rejection on missing --mode

## position notes (5/5)

- [x] 026 tier moved to 4 (invoked from /new-project)
- [x] 026 Invocation Point section added
- [x] 027 tier moved to 4 (invoked from /new-project)
- [x] 027 Invocation Point section added
- [x] 040 notes it runs after /architect

## new-project (5/5)

- [x] step 5b section exists
- [x] step 5b scaffolds Turborepo + pnpm workspace
- [x] step 5b creates packages/ui-kit + siblings
- [x] step 5b copies mcp-defaults-design.json
- [x] step 5b invokes /register-mcp-servers --scope=design

## mcp defaults (2/2)

- [x] factory file has all 5 design-stage servers
- [x] image-generator has feature_flag: nanobanana

## design-stage independence (5/5)

- [x] 022 depends-on fixed to ["019"]
- [x] 023 removes architect prereq for design_dials
- [x] 023 reads design_dials from styles.md
- [x] 024 reads iconLibrary from selected-style.json
- [x] 025 kit-change-request uses PM dual-mode

## builder .env (4/4)

- [x] 028 backend documents .env as gate-5-captured
- [x] 028 documents sanctioned .env read exception
- [x] 029 web documents NEXT_PUBLIC_* boundary
- [x] 030 mobile documents EXPO_PUBLIC_* vs EAS secrets

## index (4/4)

- [x] refactor-003 banner at top
- [x] Tier 5 bullet list contains only 019 (020 + 021 in prose only) — bullets: analyst:true architect:false pm:false (020+021 in descriptive prose only is expected)
- [x] Tier 6.5 exists with 020 + 021
- [x] 026 + 027 listed in Tier 4 (Brief System)

## blueprint (3/3)

- [x] Appendix C exists at EOF
- [x] Appendix C lists canonical STAGES order
- [x] Appendix C includes supersession breadcrumb for §23

## plan (3/3)

- [x] plan exists
- [x] plan status is approved
- [x] plan listed in active manifest

## Total: 119/119

