# .claude/worktrees/ — feature worktree staging area

This directory holds one subdirectory per **active feature worktree** during orchestrator Mode B. Each worktree is a full git worktree (not a copy) checked out at the feature's dedicated branch.

## Lifecycle (managed entirely by `.claude/skills/git-agent/`)

| Op                               | When                               | What changes here                                                                                                                                     |
| -------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bootstrap`                      | Final Mode A stage                 | Creates this directory if missing; verifies this README exists.                                                                                       |
| `checkout-feature`               | Start of each feature (runFeature) | Creates `.claude/worktrees/{slug}/` via `git worktree add` + writes `.feature-context.json` lockfile.                                                 |
| Builder / tester / reviewer runs | During feature execution           | CWD = `.claude/worktrees/{slug}/`; agents commit their own work with conventional-commit messages; append to `.feature-context.json.agent_history[]`. |
| `close-feature` (clean merge)    | End of feature                     | Removes `.claude/worktrees/{slug}/` after `git merge --no-ff`; persists a closed-lockfile at `.claude/worktrees/{slug}.closed.json` for audit.        |
| `close-feature` (conflict)       | Merge conflict                     | Leaves worktree intact; updates lockfile `status: "merge-conflict"`; awaits `resolve-conflict-handoff`.                                               |
| `resolve-conflict-handoff`       | On conflict                        | No git ops. Updates lockfile + returns handoff context. Orchestrator re-invokes the last-writing agent.                                               |
| `emergency-abort`                | Irrecoverable failure              | Force-removes worktree + branch; writes `.claude/worktrees/{slug}.aborted.json`; surgically updates `docs/tasks.yaml` with `failure_reason`.          |

## Directory layout

```
.claude/worktrees/
├── README.md                           ← this file (factory-seeded; do NOT delete)
├── {feat-slug}/                        ← one per active feature
│   ├── .feature-context.json           ← lockfile (schemas/feature-context.schema.json)
│   ├── (full project tree at feat/{slug} branch HEAD)
│   └── .git                            ← worktree git metadata (managed by git)
├── {other-feat-slug}/
│   └── ...
├── {some-closed-slug}.closed.json      ← closed-feature audit trail (housekeeping sweeps)
└── {some-aborted-slug}.aborted.json    ← emergency-abort audit trail
```

## Gitignored contents

This directory is **gitignored** at the factory root (see `.gitignore`) — worktrees are ephemeral, branch-scoped state. Only this README is tracked.

Closed-lockfiles (`*.closed.json`, `*.aborted.json`) are also not tracked; they're for local audit + housekeeping decisions.

## Rules (enforced by git-agent)

- `.claude/worktrees/` is **NEVER** edited by the orchestrator or by any agent other than git-agent + the agent currently running in that worktree.
- Worktree slug matches `features[].worktree` in `docs/tasks.yaml` exactly — always `feat-{kebab-slug}`.
- Branch name inside the worktree matches `features[].branch` — always `feat/{kebab-slug}` (or `fix/` / `refactor/` / `chore/`).
- No manual `rm -rf .claude/worktrees/{slug}` — that loses lockfile state. Use `just git-cleanup` for housekeeping (sweeps closed + aborted + stale-past-threshold entries).

## Housekeeping

```bash
just git-cleanup
```

Scans for:

- Entries with `.feature-context.json.status = "closed"` or `"aborted"`
- Entries with `opened_at > staleWorktreeReapDays` (default 7, configurable in `.claude/models.yaml`)

Removes their directories + deletes their local branches. Never touches `open` or `merge-conflict` entries.

## See also

- Skill: `.claude/skills/git-agent/SKILL.md`
- Agent: `.claude/agents/git-agent.md`
- Lockfile schema: `schemas/feature-context.schema.json`
- Zod mirror: `@repo/orchestrator-contracts/src/feature-context.ts`
- Orchestrator integration: `orchestrator/src/feature-graph.ts` (Mode B driver)
- Scaffolding spec: `scaffolding/20-033-git-agent.md`
