# factory-self-upgrade

**Deferred from**: investigate-002-build-tier-readiness-gap §Phase 4 novel concern D.

## The concern

Factory agentic resources (`.claude/agents/*`, `.claude/skills/*/SKILL.md`, `.claude/hooks/*`, `.claude/rules/*`, stack skills under `.claude/skills/agents/`) evolve over time. Existing projects scaffolded via `/new-project` carry a SNAPSHOT of those resources at scaffold time. When the factory improves them, existing projects go stale.

`/new-project --force` handles one-shot refresh with backup of tracked files. But it doesn't handle:

- **Mid-run upgrade** — user started a build yesterday; today they ran `--force` on the factory; now the in-flight project has mixed versions
- **Architecture.yaml backward compat** — v2 tasks.yaml schema evolves to v3; existing v2 files don't auto-migrate
- **Plan-template evolution** — `plans/templates/feature-plan.md` gets new sections; old plans in `plans/active/` don't pick them up
- **Stack-skill updates** — the factory authors a new react-next idiom; existing project's copy is frozen
- **Upgrade safety signals** — no way for factory to say "this upgrade is safe to apply mid-run" vs "abort in-flight builds first"

## Why deferred

No project has hit an upgrade scenario yet (refactor-003 worked precisely because nothing was mid-run). The single-project-at-a-time usage pattern means "finish the project; then factory evolves; next `/new-project` inherits the new state" works.

## Rough shape when it's time

**`/factory-upgrade <project>` skill:**

1. Diff the project's `.claude/` tree against the factory's current `.claude/`
2. Classify each diff: `safe-refresh` (no plan/contract changes), `plan-affecting` (plan templates changed; plans/active need migration), `breaking` (schema or contract incompatible — orchestrator will reject)
3. For safe-refresh: apply with backup
4. For plan-affecting: prompt user + provide migration guidance
5. For breaking: refuse; point to "finish in-flight plans + re-run factory-upgrade"
6. Write a `.factory-manifest.json` in the project recording: factory-version scaffolded + last-upgraded date + applied deltas

**Factory-version signal**: factory repo tags releases (`v1.0.0`, `v1.1.0`, etc.); `/new-project` records the tag at scaffold time; `/factory-upgrade` diffs from that.

Estimated size: medium plan — skill + diff logic + manifest schema. ~4 files.

## When to revisit

After 3+ apps have shipped and a real factory-evolution causes a real "my project went stale" complaint. Don't build ahead of need; the migration semantics will be cleaner once we know which changes actually happen in practice.
