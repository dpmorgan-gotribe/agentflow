---
id: bug-100-pm-missing-mockup-element-coverage-check
type: bug
status: draft
author-agent: human
created: 2026-05-13
updated: 2026-05-13
parent-plan: feat-066-fix-loop-effectiveness-v2 (v2-Phase-4)
supersedes: null
superseded-by: null
branch: fix/pm-mockup-element-coverage
affected-files:
  - .claude/agents/project-manager.md
  - .claude/skills/pm/SKILL.md
  - docs/tasks.yaml (per-project artefact)
feature-area: pm-agent/task-decomposition
priority: P1
attempt-count: 0
max-attempts: 5
error-message: "PM agent generates tasks.yaml from brief.md + screens + analysis but does not enforce that every visible element in the mockup screens maps to a task. Features visible in mockups (pagination, sort dropdowns, multi-select filters, sidenav stats footer, library brand logo) get omitted from tasks.yaml → builders never receive the spec → shipped product lacks those features → perceptual + parity catch SOME via element-absence detection but PM-side prevention would catch all + earlier."
reproduction-steps: "1. Compare reading-log-02 manual session 2026-05-13 user-found bugs (5 features visible in mockup but absent from build) against the project's docs/tasks.yaml. 2. Grep tasks.yaml for: pagination, sort dropdown, multi-select, library counts in sidenav. None map to explicit tasks. 3. The PM agent's decomposition step didn't enumerate these from the screens."
stack-trace: null
---

# bug-100: PM agent doesn't enforce mockup-element coverage in tasks.yaml

## Bug Description

The PM agent reads `brief.md` + `docs/analysis/*` + `docs/screens/*` and emits `docs/tasks.yaml` — the canonical decomposition of work into features. Empirical 2026-05-13: 5 distinct user-visible features present in reading-log-02's mockups did NOT appear as discrete tasks in tasks.yaml. Builders never received spec → built product shipped without them → perceptual + parity caught SOME at the absence-detection layer (when those layers work — see bug-099) but PM-side prevention is the earlier + cheaper catch.

## Empirical evidence (reading-log-02 user session 2026-05-13)

Features visible in mockup but absent from tasks.yaml + thus from build:

1. **Pagination at N=6/page**: mockup shows pagination controls below the book list; build shows infinite scroll. Pagination is a discrete feature requiring tasks for: pagination component, page-size token, route param `?page=N`, "Showing 1-6 of 23" subtitle copy.
2. **Sort dropdown (Recently added | Title (A-Z) | Rating (highest))**: mockup shows it in the library header; build doesn't render it. Needs tasks: sort-control component, URL state binding, sort-by query handling.
3. **Multi-select filters (tags AND status combined)**: mockup shows multi-selection via filter chips; build supports single-select.
4. **Sidenav stats footer ("147 books / 23 finished this year")**: mockup shows it at sidenav bottom; build doesn't render.
5. **Reading Log brand + logo in topbar**: mockup shows a book-icon + brand text; build's topbar lacks both.

Each is a 1-3 hr task that the PM didn't author.

## Root Cause Hypotheses

**H1 — PM relies on brief §11 capabilities for decomposition**: if brief §11 enumerates "search by tag, filter by status, view library" without explicitly listing "pagination" or "sort", PM has no signal. The mockup HAS the signal (the elements are drawn), but PM doesn't cross-check against mockup elements.

**H2 — PM has a mockup-coverage step but it's text-only**: maybe PM reads screens.json's element list but only the top-level routes, not the individual UI elements within each screen.

**H3 — Visual coverage is intentionally deferred**: PM ships a "minimum viable spec" and trusts the verifier's perceptual tier to catch element absences in build. Empirically the verifier doesn't catch them (bug-099), so this strategy fails open.

## Fix Approach

**Step 1 (audit)**: read PM agent prompt + skill. Enumerate what PM checks:

- `.claude/agents/project-manager.md` — system prompt
- `.claude/skills/pm/SKILL.md` — invocation skill
- Compare against what screens.json + brief.md contain

**Step 2 (extend PM contract)**: add a §Mockup-element coverage step to PM:

> For each screen in `docs/screens/*`, enumerate visible interactive elements + content blocks. Cross-reference each with the proposed tasks.yaml entries. Any element NOT mapped to a task is flagged for explicit decision: (a) add a task, (b) document as "out of scope for v1" in a `pm-coverage-decisions.md` record, OR (c) cite a capability in brief §11 that subsumes it. Run as PM's self-verify step before emitting tasks.yaml.

**Step 3 (validate)**: re-run PM agent against reading-log-02's brief + screens. Expect tasks.yaml to gain ≥5 new entries for the empirical-case features. Compare against the user-found bug list — coverage should reach 100% of features-visible-in-mockup.

**Step 4 (cross-link)**: when PM's coverage check fires, it should ALSO update screens.json's `expectedTasks[]` array so the perceptual reviewer + parity-verify can see "this screen's mockup includes X, Y, Z" and surface absences in the right format.

## Cross-references

- **bug-099** — perceptual blind to absences. Companion fix; without bug-100 the spec is incomplete, without bug-099 the build's deviation from spec isn't caught.
- **feat-023** — PM brief-coverage gate. bug-100 extends feat-023's capability-coverage to element-coverage.
- **bug-051** (factory archive) — PM LAYOUT-MANDATE task notes. Established that PM tasks should explicitly mandate visual decisions; bug-100 generalizes to ALL mockup elements.

## Attempt Log

<!-- Populated by executing agents. -->
