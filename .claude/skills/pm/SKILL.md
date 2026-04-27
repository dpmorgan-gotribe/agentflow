---
name: pm
description: Dual-mode Project Manager skill. --mode=tasks produces docs/tasks.yaml v2 from architecture.yaml + requirements.md + flows. --mode=kit-change-request produces a kit-bump mini-plan from a docs/screens/kit-change-requests/*.md file. Cross-field invariant enforcement + schema validation + retry loop.
when_to_use: mode=tasks after /architect resolves (post-signoff pipeline); mode=kit-change-request when /screens or a builder emits docs/screens/kit-change-requests/*.md
allowed-tools: Read Write Bash Grep Glob
model: inherit
argument-hint: "--mode=tasks | --mode=kit-change-request --request-file=<path>"
---

# /pm — dual-mode Project Manager

Runs in one of two modes. The orchestrator (task-035) controls invocation position; this skill enforces the mode contract + writes the appropriate outputs.

## Arguments

- `--mode=<tasks | kit-change-request>` (required). Invocation without `--mode` is rejected with a clear error.
- `--request-file=<path>` (required only when `--mode=kit-change-request`). Must be an absolute or project-relative path to an existing `docs/screens/kit-change-requests/*.md` file.

## Prerequisites

### mode=tasks

- `/architect` has resolved — `.claude/architecture.yaml` exists and validates against `schemas/architecture.schema.json`
- `docs/requirements.md` exists
- `docs/brief-summary.json` exists
- `brief.md` §12 + §19 readable
- Per-platform `docs/analysis/{platform}/flows.md` present (from `/analyze`)
- `packages/ui-kit/package.json` exists (for `ui_kit_version` field)

### mode=kit-change-request

- `--request-file` resolves to an existing `docs/screens/kit-change-requests/*.md`
- `packages/ui-kit/package.json` + `packages/ui-kit/CHANGELOG.md` exist
- Does NOT require `.claude/architecture.yaml` — design-phase detours fire pre-architect

## Outputs

### mode=tasks

| Path                       | Purpose                                                                                                                                                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/tasks.yaml`          | v2 task graph. `features[]` + `tasks[]`. Validates against `schemas/tasks.schema.json`.                                                                                                                                                       |
| `docs/tasks-coverage.json` | feat-023 brief-coverage claim: maps every brief §11/§12 capability to ≥1 task ID OR explicit deferral. Validates against `schemas/tasks-coverage.schema.json`. Skipped when `docs/brief-capabilities.json` is absent (pre-feat-023 projects). |

### mode=kit-change-request

| Path                                      | Purpose                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `plans/active/kit-change-request-{id}.md` | Mini-plan scoping exactly one primitive / pattern / layout. References emitting screen. Carries proposedKitVersion. |

## mode=tasks steps

### 1. Argument + prereq gate

- Verify `--mode=tasks` is set. Missing mode → abort with message.
- Read `.claude/architecture.yaml` — abort with "requires /architect to have run" if missing.
- Read `docs/requirements.md`, `docs/brief-summary.json`, `brief.md`, every `docs/analysis/{platform}/flows.md`.
- Read `packages/ui-kit/package.json.version` for `ui_kit_version` field.

### 2. Build feature graph via heuristic

For each integration in `architecture.yaml.apps.*.integrations.*` where `deployment: vendor | self-hosted`:

1. Check if the integration belongs to a known user-flow (look for `integration:category` mentions in flows.md). If yes, merge into the flow's feature.
2. Otherwise, check if the integration maps to a brief §11 catalogue entry. If yes, use that feature slug.
3. Otherwise, single-integration feature.

Apply in precedence order. The result is a set of proposed `features[]` entries.

For each flow in `docs/analysis/{platform}/flows.md`:

1. Create a feature (if not already created by integration grouping above).
2. Tasks inside: one backend-builder task for any API endpoint implied by the flow, one frontend-builder task per relevant platform, one tester task, one reviewer task.

### 2b. Resolve screens per frontend task (feat-012)

Between grouping (step 2) and composition (step 3), bind each frontend task to its explicit screen set. This replaces the wildcard `docs/screens/{platform}/*.html` scope with an authoritative per-task list so builders know exactly which screens they own.

Inputs:

- `docs/analysis/{platform}/flows.md` — per-platform flows with `**Screens**:` sequences (`welcome.html → signup.html → ...`)
- `docs/screens-manifest.json` — authoritative `files[]` with `{ path, platform, screenId, sha256 }` entries (produced by `/screens` — exists when PM runs per the refactor-003 ordering: `pm` depends on `architect` → `user-flows` → `visual-review` → `screens`)

Algorithm, per frontend task (`agent` is `web-frontend-builder` or `mobile-frontend-builder`):

1. Identify the feature's originating flow(s) (via `brief_reference` / the integration-flow mapping from step 2)
2. Extract screen filenames from each flow's `**Screens**:` section (strip `.html`, split on `→` + `,` whitespace)
3. For each filename, match against `screens-manifest.files[]` where `platform` equals the task's surface (`webapp` for web-frontend-builder; `mobile` for mobile-frontend-builder)
4. Populate `task.screens[]` with the matched `{platform}/{screenId}` strings. De-dupe; preserve flow order where possible.

Example: `feat-auth` maps to flow 1 in `docs/analysis/webapp/flows.md` whose screens are `welcome.html → signup.html → verify-email.html`; manifest has matching entries. The web-frontend-builder task gets:

```yaml
screens: [webapp/welcome, webapp/signup, webapp/verify-email]
```

Non-frontend tasks (backend-builder / tester / reviewer / security / devops) MUST leave `screens` unset (Zod superRefine rejects otherwise).

**Overlap detection.** After all features + tasks have their `screens[]` populated, scan for any `{platform}/{screenId}` that appears on tasks in ≥2 different features. For each collision:

- Emit `tasks.yaml.warnings[]`: `screen-overlap: {platform}/{screenId} claimed by feat-A, feat-B — flow decomposition likely wrong; reconcile at gate 4`
- DO NOT auto-resolve. This signals that the Analyst's flow grouping placed a shared screen in two flows; human should adjust flows.md and re-run PM.

**Empty-screens warning.** If a frontend task on a non-skipped surface has `screens.length === 0`, emit `tasks.yaml.warnings[]`: `frontend-task-zero-screens: feat-X task-Y — kit-only or routing-only work, or missing flow mapping`. Warning only; some UI work is kit-scaffolding and doesn't touch named screens.

### 3. Compose tasks.yaml structure

```yaml
version: "2.0"
generated_at: "{now-ISO-8601}"
project_name: "{from brief-summary.projectName}"
architecture_ref: .claude/architecture.yaml
ui_kit_version: "{from packages/ui-kit/package.json.version}"
features:
  - id: feat-{slug}
    worktree: feat-{slug}
    branch: feat/{slug}
    priority: P0|P1|P2|P3
    depends_on: [...]
    skip: [...] # web | mobile | backend surfaces NOT touched by this feature
    agent_sequence: [
        backend-builder,
        web-frontend-builder,
        mobile-frontend-builder,
        tester,
        reviewer,
      ] # trimmed per skip[]
    summary: "..."
    brief_reference: "brief.md §12 / docs/analysis/webapp/flows.md#flow-N"
    tasks:
      - id: { kebab-slug }
        agent: { one of agent_sequence members }
        depends_on: [...] # other task.id within this feature
        skills: [stack-skill-slug-1, vendor-skill-slug-2]
        priority: P0|P1|P2|P3
        integration_ref: architecture.yaml#apps.api.integrations.payments # when applicable
        estimated_screens: N # on frontend tasks (count — advisory)
        screens: [webapp/login, webapp/signup] # feat-012: REQUIRED on frontend tasks (exact scope); MUST be absent/[] on backend/tester/reviewer/devops
        status: pending
        summary: "..."
summary_counts:
  total_features: N
  total_tasks: M
  by_agent: { ... }
  by_priority: { P0: n, P1: n, P2: n, P3: n }
warnings: [...]
```

### 4. Enforce cross-field invariants

Before writing:

1. For each task, confirm `task.agent` appears in its parent `feature.agent_sequence[]`. If not, either add the agent to the sequence (preferred) or reassign the task (rarely correct).
2. DFS-walk `feature.depends_on[]` to detect cycles. On cycle: reshape the graph (break the cycle at the lowest-priority edge) or surface as a warning + abort.
3. For each task, confirm `task.depends_on[]` entries all resolve to other task.id values **within the same feature**. Cross-feature deps belong at `feature.depends_on`; move them up if present.
4. For each integration in architecture.yaml with `requiredNow: true`, confirm at least one `P0` task references it via `integration_ref`. If not, bump the corresponding task to P0 or emit a warning.
5. **Screens ownership (feat-012)**. Non-frontend tasks (`backend-builder` / `tester` / `reviewer` / `security` / `devops`) MUST have `screens: []`. Zod superRefine rejects otherwise at validation time; catch earlier by refusing to populate the field. Frontend tasks on a non-skipped surface SHOULD have ≥1 screen entry; zero-screen frontend tasks emit a warning (see step 2b).

### 4b. File-affinity check (bug-015 Phase 2)

After step 4 invariants pass, populate `feature.affects_files[]` and serialize features that share files. **This pushes parallel-feature merge conflicts back to the PM stage where they're a one-line dependency edit, instead of letting them surface at runtime in close-feature where they cost $5+ per conflict (per kanban-webapp-08 incident).**

Algorithm, per feature:

1. **Author `affects_files[]`** — a glob list of files this feature is expected to mutate. Derive conservatively from task summaries + screens. For a `feat-board-core` with tasks "render-empty-no-board", "dnd-kit-cards-and-columns", "inline-card-edit", expected globs include:
   - `apps/web/src/components/board/**` (component scope)
   - `apps/web/src/store/board.ts` OR `apps/web/src/store/index.ts` (state scope — pick whichever the architect chose; see Phase 3 below)
   - `apps/web/app/page.tsx` (route scope, if the home route changes)

   When in doubt, list MORE globs. False positives (over-serializing) cost ~5min of wall-clock per feature; false negatives (under-serializing) cost $5+ per merge conflict.

2. **Detect overlap pairs**. After all features have `affects_files[]`, compute pairwise glob-overlap using minimatch semantics. Two features overlap if any glob in feature A matches a path that any glob in feature B would also match (literal path comparison after expansion is fine for the conservative case).

3. **Auto-add `depends_on`** for overlapping features that aren't already linked:
   - If A and B overlap AND neither `A in B.depends_on` nor `B in A.depends_on`: add `B → depends_on: [..., A]` (sequence the higher-numbered feature on the lower-numbered one — stable + arbitrary)
   - Emit `tasks.yaml.warnings[]`: `file-affinity-serialization: feat-A and feat-B both touch {path-glob} — auto-added feat-B depends_on feat-A`

4. **Skip the auto-serialization** for features with the SAME `affects_files[]` glob if both are already in a wave that the user explicitly approved as parallel-safe (e.g., both touch `apps/web/components/{specific-feature}/**` where the paths are disjoint despite the parent glob). Heuristic: if no SHARED leaf path exists despite the glob match, no overlap. (Most common false-positive source.)

**Example — kanban-webapp**:

```yaml
- id: feat-board-core
  affects_files:
    - apps/web/src/store/index.ts # ← shared with settings-data
    - apps/web/src/components/board/**
    - apps/web/app/page.tsx
- id: feat-settings-data
  affects_files:
    - apps/web/src/store/index.ts # ← shared with board-core
    - apps/web/src/components/settings/**
    - apps/web/app/settings/page.tsx
  depends_on: [feat-bootstrap, feat-board-core] # ← auto-added because of store/index.ts
```

**Limitation**: PM doesn't know the EXACT files agents will touch — it works from task summaries. The heuristic is conservative (over-serializes when uncertain). Phase 3 (architect feature-sliced module structure) is the long-term fix that makes this check a no-op for state modules.

### 4c. Brief-coverage authoring (feat-023)

After step 4b file-affinity is settled and BEFORE writing tasks.yaml in step 5, emit `docs/tasks-coverage.json` mapping every brief capability (from `docs/brief-capabilities.json`) to ≥1 task ID OR an explicit deferral with reason. This is the authoritative coverage claim that the post-stage gate (`scripts/audit-brief-coverage.mjs`) audits. **Silent omissions become impossible** because the audit fails the `/pm` stage when a capability is neither covered nor deferred.

Inputs:

- `docs/brief-capabilities.json` — authored at `/analyze` time; lists every brief §11/§12 capability the project must deliver. Schema: `schemas/brief-capabilities.schema.json`.
- The in-memory `features[].tasks[].id` set you've drafted in steps 2-4.

Algorithm:

1. Read `docs/brief-capabilities.json`. If absent, emit `tasks.yaml.warnings[]: brief-capabilities-missing — pre-feat-023 project; coverage audit will be skipped` and skip this step (legacy behavior). Otherwise:
2. For EACH capability in the catalog:
   - **Find the task(s) that deliver it.** The mapping is heuristic: scan task `summary` + `notes` for keywords from `capability.summary`; check the parent feature's `brief_reference`; if the capability is core, prefer P0 tasks. List ALL tasks that contribute (e.g. one backend + one frontend task may both be required for `cap-12-card-create`).
   - **If you cannot map it to any task**, decide whether to:
     - **Add a task** — preferred when the capability is `core`. Walk back to step 2 and add the missing task to the appropriate feature.
     - **Defer it** — only acceptable when the capability is `optional` / `stretch` OR when the human has explicitly scoped it out. Add to `deferred[]` with a concrete reason.
3. Author the mapping per the schema below.

Schema (Zod mirror: `packages/orchestrator-contracts/src/brief-coverage.ts`; JSON Schema: `schemas/tasks-coverage.schema.json`):

```json
{
  "version": "1.0",
  "covers": {
    "cap-12-card-create": ["task-board-core-card-create"],
    "cap-12-card-edit-inline": ["task-board-core-inline-card-edit"],
    "cap-12-column-rename": ["task-board-core-column-rename"]
  },
  "deferred": [
    {
      "capability": "cap-11.4-help-route",
      "reason": "MVP scope: brief §11.4 marked optional; user can re-add post-launch",
      "approvedBy": "pm-agent-decision"
    }
  ]
}
```

Authoring rules:

- `covers[<capability-id>]` MUST be an array with ≥1 entry. Empty arrays are rejected.
- Every task ID in `covers` MUST also exist in `tasks.yaml` (cross-checked by the audit; dangling refs are reported as `typoErrors`).
- `deferred[].approvedBy = "pm-agent-decision"` when YOU decide to defer; use `"human:<name>"` when honoring a human-scoped deferral from the brief.
- **Core deferrals require `coverage-warning`**: if you defer a capability with `category: "core"`, ALSO emit a `tasks.yaml.warnings[]` entry: `coverage-warning: deferred core capability cap-X — reason`. The orchestrator surfaces these to the gate-4 sign-off file's `coverageWarnings[]` block so the human sees them before greenlighting Mode B.

After authoring, the orchestrator (post-step) runs `node scripts/audit-brief-coverage.mjs <projectRoot>` automatically and fails the `/pm` stage on `uncovered.length > 0` or `typoErrors.length > 0`. You don't need to invoke the audit yourself — but you can preview-run it locally to verify your mapping before returning.

### 5. Write + validate

- Serialize with js-yaml (`noRefs: true, lineWidth: 120`) to `docs/tasks.yaml`.
- Run `node scripts/validate-tasks-yaml.mjs docs/tasks.yaml`. Must exit 0.
- On schema validation failure: retry steps 2-5 up to 3 times with the validation error as context. After 3 failures: abort with the error messages.

### 6. Self-verify

1. Schema validation passed.
2. Cross-field invariants (1-4 above) all hold.
3. No zero-task features.
4. Every feature's worktree + branch name follows the `feat-{slug}` / `feat/{slug}` convention.

### 7. Emit PmTasksOutput JSON

```json
{
  "mode": "tasks",
  "success": true,
  "tasksYamlPath": "docs/tasks.yaml",
  "featuresCount": N,
  "tasksCount": M,
  "byAgent": { "backend-builder": n, "web-frontend-builder": n, ... },
  "byPriority": { "P0": n, "P1": n, "P2": n, "P3": n },
  "schemaValidated": true,
  "warnings": [...]
}
```

## mode=kit-change-request steps

### 1. Argument + prereq gate

- Verify `--mode=kit-change-request` AND `--request-file=<path>` are both set. Missing either → abort.
- Read the request file at `--request-file=<path>`. Must exist; must match `docs/screens/kit-change-requests/*.md` shape.
- Read `packages/ui-kit/package.json` + `packages/ui-kit/CHANGELOG.md`.
- DO NOT require `.claude/architecture.yaml` (design-phase detour).

### 2. Parse the request

The request file has frontmatter + a body describing what's needed. Extract:

- Requesting agent (`/screens`, `web-frontend-builder`, `mobile-frontend-builder`)
- Emitting screen ID (from filename or frontmatter)
- Requested component name
- Narrative: why the current kit doesn't cover it

### 3. Compute new kit version

Read `currentKitVersion` from `packages/ui-kit/package.json.version`. Compute `proposedKitVersion` as a minor bump (semver: `X.Y.Z` → `X.(Y+1).0`).

### 4. Author the mini-plan

Write `plans/active/kit-change-request-{id}.md` using `plans/templates/kit-change-request-plan.md` as the shape reference. Frontmatter:

```yaml
---
id: kit-change-request-{id}
type: refactor
status: draft
created: { YYYY-MM-DD }
branch: design/kit-bump-{id}
affected-files:
  - packages/ui-kit/CHANGELOG.md
  - packages/ui-kit/src/primitives/{NewComponent}.tsx   (or patterns/ or layouts/)
  - packages/ui-kit/stories/{NewComponent}.stories.tsx
feature-area: ui-kit
priority: P1
---
```

Body sections:

- `# Kit Change Request — {summary}` — one-line purpose
- `## Missing primitive / pattern / layout` — quote from request file
- `## Proposed addition` — **exactly ONE** component / pattern / layout. Reject a request if it implies multi-primitive bundling.
- `## Kit version bump` — `{current} → {proposed} (minor)`
- `## Consumers requiring regeneration` — list emitting screen + any other screens the PM spots as benefiting (grep screens-manifest.json for related patterns)

### 5. Self-verify

1. Mini-plan frontmatter parses as valid YAML.
2. Body has exactly ONE `## Proposed addition` subsection.
3. Proposed version is a valid semver minor bump over current.

### 6. Emit PmKitChangeRequestOutput JSON

```json
{
  "mode": "kit-change-request",
  "success": true,
  "miniPlanPath": "plans/active/kit-change-request-{id}.md",
  "requestedComponent": "{name}",
  "requestingAgent": "{agent}",
  "emittingScreen": "{screenId or null}",
  "currentKitVersion": "{semver}",
  "proposedKitVersion": "{semver}",
  "warnings": [...]
}
```

## Error paths

- **Missing `--mode`** → abort: "/pm requires --mode=tasks or --mode=kit-change-request".
- **Missing `--request-file` in kit-change-request mode** → abort: "/pm --mode=kit-change-request requires --request-file=<path>".
- **mode=tasks without architecture.yaml** → abort: "/pm --mode=tasks requires /architect to have produced .claude/architecture.yaml".
- **Schema validation fails 3x** → abort with validation errors listed.
- **Cross-field invariant violation can't be auto-fixed** → abort with the specific invariant + offending feature/task ID.
- **Multi-primitive mini-plan requested** → abort: "Kit-change-request must scope exactly one primitive/pattern/layout. Split into multiple requests."

## Integration Points

- **Task 035 orchestrator** reads tasks.yaml at Mode A → Mode B transition via `TasksV2Schema`.
- **Task 036 kit-change-request detour** (in `orchestrator/kit-change-request-detour.ts`) calls this skill via `invokePMKitChangeRequest` with `--mode=kit-change-request --request-file=<path>`.
- **Builders (028/029/030)** read their assigned tasks; resolve `integration_ref` to fetch vendor specifics from architecture.yaml.
- **Tester (031) + Reviewer (032)** placed last in `agent_sequence[]` by convention.

## Acceptance criteria

- [ ] `.claude/skills/pm/SKILL.md` exists with frontmatter above
- [ ] Rejects invocations without `--mode=`
- [ ] Rejects `--mode=kit-change-request` without `--request-file=`
- [ ] `--mode=tasks` reads architecture.yaml + requirements.md + flows.md + brief
- [ ] `--mode=tasks` applies feature-grouping heuristic in precedence order
- [ ] `--mode=tasks` enforces 3 cross-field invariants before writing
- [ ] `--mode=tasks` schema-validates output via scripts/validate-tasks-yaml.mjs; retries ≤3x
- [ ] `--mode=tasks` emits warnings for requiredNow integrations lacking P0 task coverage
- [ ] `--mode=kit-change-request` does NOT require architecture.yaml
- [ ] `--mode=kit-change-request` rejects multi-primitive requests
- [ ] Return JSON validates against `PmOutputSchema` (discriminated on mode)
