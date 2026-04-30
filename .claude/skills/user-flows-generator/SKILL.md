---
name: user-flows-generator
description: Produce the navigable docs/user-flows.html viewer — sidebar nav listing task-oriented user flows (each a discrete job with its own screen sequence), iframe-embedded screens with device-frame chrome, visual-review badges per step, persona pills on each flow, sign-off form that POSTs to gate 4. The final artefact the client signs off on.
allowed-tools: Read Write Bash Grep Glob
model: inherit
argument-hint: "(no flags)"
---

# /user-flows-generator — The final HITL gate viewer

Runs AFTER `/screens` batch generation completes AND after `/visual-review` (025b) has produced `docs/visual-review/report.json`. The viewer embeds per-screen visual-review badges so the reviewer sees pass / fail / needs-human-review status alongside each screen link.

Orchestrator (035) controls invocation — this skill does NOT fire inside `/screens`. Reason: the viewer needs the visual-review report to exist; `/screens` runs before `/visual-review`.

## Prerequisites

- `/screens` completed in batch mode → `docs/screens/**/*.html` populated + `docs/screens-manifest.json` written
- `/visual-review` (025b) completed → `docs/visual-review/report.json` exists
- `docs/analysis/{platform}/flows.md` exists per detected platform (produced by `/analyze` phase 4)
- `docs/brief-summary.json` exists (for persona list)
- `packages/ui-kit/package.json` exists (for uiKitVersion binding in sign-off)
- `.claude/templates/user-flows-template.html` exists (the viewer shell)

## Inputs (ordered)

1. `docs/brief-summary.json` → `projectName`, `detectedPlatforms[]`, `personas[]`
2. `docs/analysis/{platform}/flows.md` per platform → **authoritative journeys** — the Analyst has already grouped screens into flows with 100% coverage; don't re-derive, reuse
3. `docs/screens/**/*.html` → catalog of every rendered screen (path → screenId map via filename)
4. `docs/screens-manifest.json` → `screensManifestHash` to embed in the sign-off form
5. `docs/visual-review/report.json` → per-screen status (`pass` / `fail` / `needs-human-review`); embeds as `visualReviewReportHash` in the sign-off form
6. `packages/ui-kit/package.json.version` → `uiKitVersion` in the sign-off form
7. `.claude/templates/user-flows-template.html` → the viewer shell with placeholders

## Arguments

No flags. Always runs in full mode: merges all platforms' flows into a unified manifest + renders one viewer.

## Steps

### 1. Archive prior version (if exists)

If `docs/user-flows.html` already exists:

- Derive the prior timestamp: look for a matching `docs/signoff-{timestamp}.json` (the one that binds the current user-flows.html); if none, use the file's mtime formatted as ISO-8601
- Copy `docs/user-flows.html` → `docs/user-flows-archive/{prev-timestamp}.html`
- If the corresponding `docs/signoff-{timestamp}.json` exists, copy it alongside

This is the same archiving requirement /screens documents for batch invocations — executed here because this skill owns the actual `user-flows.html` write.

### 2. Read persona list + platform flows

**Flows are task-oriented journeys — not persona-narrative touchpoint dumps.**
A flow is one job a user completes (Onboarding, Lead Magnet Conversion,
Recipe Discovery, Evaluate Sector Fit, Deep-entry Referral). Multiple
personas may run the same flow; a flow may list one `primary persona` for
badging but the FLOW is the unit, not the person.

Bad (what NOT to produce): "Sophia's journey — home → services → work →
about → contact" (persona touchpoint dump masquerading as a flow).

Good: "Flow 3: Evaluate sector fit — home → service-visual →
case-study-detail → contact; primary persona: Sophia."

- From `docs/brief-summary.json.personas[]` → `[{ id, name, primaryGoal }]`
- For each platform in `detectedPlatforms`, parse `docs/analysis/{platform}/flows.md`:
  - **Required format**: `## Flow N: Name` sections, each containing:
    - `**Purpose**: one-line description of the task`
    - `**Primary persona**: <persona-id>` (optional — defaults to `any`)
    - `**Screens**: 1. [screen-id] → 2. [screen-id] → 3. [screen-id]`
    - Optional per-step `**Details**:` table with user action + system response
  - The parser extracts `name`, `purpose`, `primaryPersona`, `screenIds[]` per flow
- Union across platforms; tag each flow entry with its platform

**Reference**: see the old agentflow `projects/clari/outputs/analysis/flows.md`
for the canonical task-oriented shape the Analyst should emit. Hatch's
`docs/analysis/webapp/flows.md` (post-refactor) is the structured format
this skill consumes.

### 3. Walk `docs/screens/**/*.html`

Build a path → screenId map:

```
docs/screens/webapp/home.html           → webapp/home
docs/screens/webapp/filter-tribes.html  → webapp/filter-tribes
docs/screens/mobile/discover-home.html  → mobile/discover-home
```

Cross-reference with each flow's screen-id list to attach full file paths. Flag any flow-referenced screen-id that doesn't resolve → warn but don't abort (could be an in-progress screen the flow expected but /screens hasn't generated yet).

### 4. Attach visual-review status per screen

Parse `docs/visual-review/report.json`. Read `screens[]` only — ignore the sibling
`violations[]` (that's the flat shape consumed by the retry loop, same data
different slicing). Expected `screens[]` entry shape:

```json
{
  "platform": "webapp",
  "screenId": "home",
  "status": "pass" | "fail" | "needs-human-review",
  "issues": [
    { "rule": "color.accent-budget", "severity": "error", "detail": "..." }
  ]
}
```

`issues[]` is empty when `status === "pass"` and populated (error + warning
severities) otherwise.

Full report.json shape is documented in
`.claude/skills/visual-review/SKILL.md` step 4. The `generatedAt` field is
the timestamp to surface in the viewer header; it's an alias of `runAt` in
the source report.

For each screen in the manifest, inject its status. If a screen isn't in the
report, default to `not-reviewed` + warn.

### 4b. Author `interactions[]` + `seedingTier` per flow (feat-038 Phase 3)

Each flow needs a structured Playwright action script (`interactions[]`) +
a per-flow seeding signal (`seedingTier`) so `scripts/synthesize-flow-e2e.mjs`
can emit deterministic E2E specs that exercise the full user journey, not
just `page.goto("/")`. Both fields landed in v2.0 of the manifest schema
(see `schemas/user-flows-manifest.schema.json` + `packages/orchestrator-
contracts/src/user-flows-manifest.ts`); the synthesizer falls back to the
v1.0 screen-breadcrumb heuristic when these fields are absent.

#### A. Infer `seedingTier`

Binary signal feeding the per-stack-skill seeding strategy declared in
`.claude/rules/testing-policy.md §E2E data-seeding strategy`. Rule:

- If the flow's `name` OR `description` (case-insensitive) contains any
  **mutation verb** — `create`, `add`, `save`, `edit`, `update`, `delete`,
  `remove`, `archive`, `restore`, `upload`, `publish`, `submit`, `post`,
  `send`, `assign`, `unassign`, `accept`, `decline`, `approve`, `reject`,
  `pay`, `checkout`, `signup`, `register` — set `"seedingTier": "mutation"`.
- Otherwise default to `"seedingTier": "read-only"`.

Read-only flows produce specs that run in parallel; mutation flows opt
into `test.describe.serial` so cross-test order is deterministic. Borderline
cases (e.g. "Save preferences" — a setting toggle that persists — vs.
"Save to favourites" — a UI bookmark) lean **mutation** to be safe; the
serial-execution overhead is minor and avoids flaky parallel runs.

#### B. Infer `interactions[]`

For each flow, walk its `steps[]` (the screen breadcrumbs already attached
in steps 2-4) and emit a structured action script. Selectors come from
reading the actual mockup HTML at `docs/screens/{platform}/{screenId}.html`
— the kit primitives carry `data-kit-component="X"` attributes, the page
root carries `data-screen-id="Y"`, and visible text on buttons/links is
the most stable disambiguator.

**Per-flow algorithm:**

1. **Entry navigate.** First entry is always
   `{ kind: "navigate", to: "<route>" }`. Most flows enter at `/`; for
   flows whose first screen is a sub-route (e.g. `/settings`,
   `/report/:owner/:repo`), use the route from `screens.json`'s
   `routePattern` field if present, else the screen-id with leading slash
   (`/settings`, `/about`).

2. **Per transition (screen[i] → screen[i+1]).** Read screen[i]'s HTML.
   Identify the interactive element that triggers navigation to
   screen[i+1]. Selector preference order:
   1. **Visible-text role selector** — `role=button[name="Submit"]` or
      `role=link[name="Sign in"]` when the element's accessible name is
      unambiguous and matches a button/link triggering the transition.
      Most stable across re-runs.
   2. **`data-kit-component` + text disambiguation** —
      `[data-kit-component="Button"]:has-text("Generate report")` when
      multiple buttons exist and text discriminates.
   3. **Plain text selector** — `text=Generate report` when no role
      attribute exists.
   4. **kit-component selector with sibling/parent narrowing** —
      `[data-kit-component="Card"]:has([data-kit-component="StarsChart"])`
      for compound elements.

3. **Form submission flows.** When the transition involves submitting a
   form (input fields visible, submit button triggers nav), emit:
   - One `{ kind: "fill", selector, value }` per input field with a sane
     test value (URLs use `facebook/react`-shaped real-but-stable
     placeholders; emails use `test@example.com`; passwords use
     `TestPass123!`).
   - One `{ kind: "click", selector }` for the submit button.
   - One `{ kind: "waitForResponse", urlPattern: "/api/<path>" }` if the
     transition involves a network roundtrip (mutation tier OR fetch on
     submit). Read the screen HTML for hints — if the form posts to
     `/api/report/`, the urlPattern is `"/api/report/"`.

4. **Final-step assertion.** After the last navigation lands, emit at
   least one `{ kind: "assertVisible", selector }` on a key element
   that's distinctive to the destination screen — typically the screen's
   primary heading or a kit-component unique to that screen (e.g.
   `[data-kit-component="ContributorsChart"]` for the report screen).
   This is the assertion that catches kanban-09 / repo-health-01-class
   integration bugs (the navigate succeeded, but the chart didn't
   render because the API call 404'd silently).

5. **Optional final URL assertion.** When the route pattern is
   distinctive, emit
   `{ kind: "assertUrlMatches", pattern: "^/report/" }` so a flow that
   navigates client-side without changing the URL fails clearly.

**Worked example — "Generate a single repo health report"** (flow-1 from
`repo-health-dashboard-01`):

Screen breadcrumb: `home` → `report-loading` → `report`. Reading
`docs/screens/webapp/home.html` the URL form has a `<input type="text">`
inside `[data-kit-component="Input"]` and a submit button
`[data-kit-component="Button"]` with visible text "Generate report".
Reading `docs/screens/webapp/report.html` the main content is wrapped in
`[data-kit-component="ContributorsChart"]` and similar charts.

Author this `interactions[]`:

```json
[
  { "kind": "navigate", "to": "/" },
  {
    "kind": "fill",
    "selector": "[data-kit-component=\"Input\"] input[type=\"text\"]",
    "value": "facebook/react"
  },
  {
    "kind": "click",
    "selector": "role=button[name=\"Generate report\"]"
  },
  { "kind": "waitForResponse", "urlPattern": "/api/report/", "status": 200 },
  {
    "kind": "assertVisible",
    "selector": "[data-kit-component=\"ContributorsChart\"]"
  },
  { "kind": "assertUrlMatches", "pattern": "^/report/" }
]
```

`seedingTier`: `"read-only"` (the flow's name is "Generate" but the
generation reads from GitHub via a proxy cache — no project-managed
mutation; the tier is determined by the project's persistence_layer +
whether the flow CHANGES persisted state, not by the verb in isolation).

#### C. Edge cases

- **Screen HTML missing** for a step. Skip the transition and emit a
  `// TODO: screen HTML missing — add interaction manually` comment
  step (NOT a real interaction, just a JSON comment-string in the
  description for the operator). Or: omit the flow's `interactions[]`
  entirely and surface a warning. Prefer the latter — partial
  interactions[] are worse than none (the synthesizer's legacy
  fallback path produces a meaningful screen-breadcrumb spec).
- **Ambiguous selector** for a transition (two buttons with the same
  text). Add a `nth=` qualifier: `role=button[name="Submit"] >> nth=0`.
  If still ambiguous, prefer the kit-component selector and disambiguate
  via parent: `[data-kit-component="Card"]:has-text("Project A") [data-kit-component="Button"]`.
- **Modal-style transitions** (clicking a card opens a detail modal in
  the same route). The `assertVisible` step should target the modal
  container; the `assertUrlMatches` step is omitted (URL doesn't
  change).
- **Error-recovery flows** (flow-3 "Recover from a 404" in
  `repo-health-dashboard-01`). The fill value should trigger the
  expected error path — e.g. `value: "nonexistent-org/nonexistent-repo"`
  for a 404 flow. The `waitForResponse` step asserts `status: 404`.
  The destination assertion is `assertVisible` on the error banner's
  kit-component.
- **Synthetic-state flows requiring `kind: "mock"`** (feat-039). When a
  flow's purpose is exercising a synthetic state that cannot be
  reproduced live — rate-limited (HTTP 429), private/forbidden (HTTP
  403), network-failure, auth-failed, generic 5xx — insert one or more
  `{ kind: "mock", urlPattern, status, body, contentType?, method? }`
  interactions BEFORE the navigate that triggers the request. The
  synthesizer emits `await page.route(urlPattern, ...)` at exactly the
  position you place the mock; ordering is your responsibility. Common
  shape:

  ```json
  [
    {
      "kind": "mock",
      "urlPattern": "/api/report/",
      "method": "GET",
      "status": 429,
      "body": { "error": "rate_limited", "retryAfter": 60 }
    },
    { "kind": "navigate", "to": "/" },
    {
      "kind": "fill",
      "selector": "input[name=\"url\"]",
      "value": "facebook/react"
    },
    { "kind": "click", "selector": "button[type=\"submit\"]" },
    {
      "kind": "assertVisible",
      "selector": "[data-screen-id=\"report-rate-limited\"]"
    }
  ]
  ```

  Defaults: `method` defaults to `"GET"`; `contentType` defaults to
  `"application/json"` for object bodies, `"text/plain"` for string
  bodies. String bodies pass through verbatim; object bodies are
  `JSON.stringify`'d before send. Status must be 100-599. The mock
  applies for the lifetime of the test (auto-cleaned by Strategy D's
  `clearMocks` afterEach hook). Mocks for happy-path flows (where the
  real backend is reachable, e.g. with `GITHUB_TOKEN` set) are
  unnecessary — only use this for genuinely synthetic states.

- **No `interactions[]` if confidence is low.** If the LLM can't infer
  selectors with reasonable confidence (e.g. the screen HTML is heavily
  custom with no kit attributes), omit `interactions[]` for that flow
  and surface a warning. The synthesizer's v1.0 fallback path emits a
  meaningful spec from `steps[]` alone.

#### D. Output

Each flow gains two new fields:

```json
{
  "id": "flow-1",
  "name": "Generate a single repo health report",
  "description": "...",
  "primaryPersona": "diane-em",
  "steps": [
    /* unchanged screen breadcrumbs */
  ],
  "interactions": [
    /* the structured script per algorithm above */
  ],
  "seedingTier": "read-only"
}
```

Set `manifest.schemaVersion = "2.0"` once at least one flow has
`interactions[]` populated.

### 5. Generate `docs/user-flows-manifest.json`

Aggregate everything into one manifest:

```json
{
  "version": "1.0",
  "schemaVersion": "2.0",
  "generatedAt": "2026-04-21T14:00:00Z",
  "projectName": "gotribe-v1",
  "platforms": ["webapp", "mobile", "admin"],
  "uiKitVersion": "1.0.0",
  "screensManifestHash": "sha256:...",
  "visualReviewReportHash": "sha256:...",
  "flows": [
    {
      "id": "flow-1",
      "platform": "webapp",
      "name": "Onboarding & Authentication",
      "description": "Convert a first-time visitor into a signed-in user.",
      "primaryPersona": "sarah-the-seeker",
      "steps": [
        {
          "screenId": "home",
          "platform": "webapp",
          "file": "docs/screens/webapp/home.html",
          "status": "pass",
          "title": "Home"
        },
        {
          "screenId": "signin",
          "platform": "webapp",
          "file": "docs/screens/webapp/signin.html",
          "status": "pass",
          "title": "Sign in"
        }
      ],
      "interactions": [
        { "kind": "navigate", "to": "/" },
        {
          "kind": "click",
          "selector": "role=link[name=\"Sign in\"]"
        },
        {
          "kind": "fill",
          "selector": "[data-kit-component=\"Input\"][name=\"email\"]",
          "value": "test@example.com"
        },
        {
          "kind": "fill",
          "selector": "[data-kit-component=\"Input\"][name=\"password\"]",
          "value": "TestPass123!"
        },
        {
          "kind": "click",
          "selector": "role=button[name=\"Sign in\"]"
        },
        {
          "kind": "waitForResponse",
          "urlPattern": "/api/auth/signin",
          "status": 200
        },
        {
          "kind": "assertVisible",
          "selector": "[data-screen-id=\"discover-home\"]"
        }
      ],
      "seedingTier": "mutation"
    }
  ],
  "personas": [
    {
      "id": "sarah-the-seeker",
      "name": "Sarah the Seeker",
      "primaryGoal": "Find a tribe that matches her values",
      "flowIds": ["flow-1"]
    }
  ],
  "screensCounts": {
    "total": 483,
    "pass": 461,
    "fail": 18,
    "needs-human-review": 4
  }
}
```

`schemaVersion: "2.0"` is set whenever ≥1 flow has `interactions[]`
populated. Manifests with `schemaVersion` absent fall back to v1.0
semantics — readers (synthesizer + viewer) handle both shapes.

### 6. Compute hashes

- `screensManifestHash` — SHA-256 of canonical `docs/screens-manifest.json` (sorted, no-whitespace, LF) — SAME algorithm as /screens skill §Screens manifest hash algorithm
- `visualReviewReportHash` — SHA-256 of `docs/visual-review/report.json` (same canonical form)
- `uiKitVersion` — literal copy from `packages/ui-kit/package.json.version`

These three values are embedded into the sign-off form as hidden fields. On submit, the form POSTs them unchanged so the gate server can re-verify.

### 7. Render the viewer

Read `.claude/templates/user-flows-template.html`. Substitute placeholders:

| Placeholder                     | Value                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `{{PROJECT_NAME}}`              | from `brief-summary.json`                                                                      |
| `{{MANIFEST_JSON}}`             | inlined JSON of `user-flows-manifest.json` (JS object literal, no quotes around top-level `=`) |
| `{{UI_KIT_VERSION}}`            | string                                                                                         |
| `{{SCREENS_MANIFEST_HASH}}`     | full `sha256:...` string                                                                       |
| `{{VISUAL_REVIEW_REPORT_HASH}}` | full `sha256:...` string                                                                       |
| `{{GATE_API_BASE}}`             | HITL gate server base URL; orchestrator passes via env or CLI arg                              |
| `{{SCREENS_COUNT}}`             | total screen count (integer)                                                                   |

Write to `docs/user-flows.html`.

### 8. Self-verify

Before reporting complete:

- `docs/user-flows.html` exists + is > 4 KB (template alone is ~6 KB; anything smaller is a template-miss)
- No unresolved `{{...}}` placeholders remain (grep the output — zero matches)
- `docs/user-flows-manifest.json` exists + parses as JSON
- Archive directory populated if prior version existed

### 9. Return JSON

```json
{
  "success": true,
  "projectName": "gotribe-v1",
  "uiKitVersion": "1.0.0",
  "viewerPath": "docs/user-flows.html",
  "manifestPath": "docs/user-flows-manifest.json",
  "archivedFrom": "docs/user-flows-archive/2026-04-14T16-15-42Z.html",
  "personasCovered": 5,
  "flowsCovered": 14,
  "flowsWithInteractions": 12,
  "seedingTierCounts": {
    "read-only": 9,
    "mutation": 3
  },
  "schemaVersion": "2.0",
  "screensLinked": 483,
  "screensByStatus": {
    "pass": 461,
    "fail": 18,
    "needs-human-review": 4,
    "not-reviewed": 0
  },
  "screensManifestHash": "sha256:...",
  "visualReviewReportHash": "sha256:...",
  "warnings": []
}
```

The `flowsWithInteractions` count is < `flowsCovered` when some flows
fell back to v1.0 emit (low-confidence selectors, missing screen HTML).
Each gap surfaces as a warning naming the flow id. `schemaVersion` is
`"2.0"` whenever ≥1 flow gained `interactions[]`; otherwise it's omitted
and downstream readers fall back to v1.0 semantics.

## Viewer mechanics (template contract — lives at `.claude/templates/user-flows-template.html`)

The template is self-contained HTML + inline CSS/JS. No build step. Key features:

- **Sidebar navigation** organised by persona → journey → step. Click a step to load it in the iframe.
- **Device switcher** — 3 fixed viewports matching `/visual-review` (025b): `390×844` (mobile) / `820×1180` (tablet) / `1400×900` (desktop). Selected viewport applies to the iframe width/height.
- **Target switcher** — webapp / mobile / admin (filters the sidebar to one platform at a time; default = all). Toggles a `data-platform-filter` attribute on the body.
- **Visual-review badge per step** — inline badge next to each step link:
  - `✓ pass` — olive-green background
  - `✗ fail` — red background
  - `⚠ needs-human-review` — amber background
  - `— not-reviewed` — grey (fallback if a screen isn't in the report)
- **Step annotations** — each flow carries a short description pulled from `flows.md`. Shown above the iframe.
- **Sign-off form** — reveals via "Sign off" button in the top-right:
  - Client name input (required)
  - Approved checkbox (default checked; unchecking blocks submit)
  - Comments textarea
  - Hidden fields: `screensManifestHash`, `visualReviewReportHash`, `uiKitVersion`, `screensApproved` (total count)
  - Submit → `POST {{GATE_API_BASE}}/api/signoff` with the body matching `schemas/signoff.schema.json`
  - On 200: shows confirmation; disables further edits
  - On 4xx: shows the server's rejection reason (usually "stale screens hash" or "uiKitVersion drift")
- **`prefers-reduced-motion: reduce`** respected throughout — no carousel auto-advance, no ambient animations
- **Keyboard nav**: arrow keys move through steps in the current flow; `]` / `[` jump flows; `ESC` closes the sign-off form

## HITL gate 4 backing-server contract (task 036 must honor)

- **`POST /api/signoff`** — body matches `schemas/signoff.schema.json`. Handler:
  1. Validates body against the schema; rejects 400 on any violation
  2. Recomputes `screensManifestHash` from current `docs/screens-manifest.json` → if mismatch with body, reject 409 (`screens-manifest-drift`)
  3. Recomputes `visualReviewReportHash` from current `docs/visual-review/report.json` → if mismatch, reject 409 (`visual-review-drift`)
  4. Reads `packages/ui-kit/package.json.version` → if ≠ body's `uiKitVersion`, reject 409 (`ui-kit-version-drift`)
  5. On all passes, atomically writes `docs/signoff-{signedAt-as-filename}.json` with the validated body
  6. Returns 200 with the written payload

**Drift rejection is the load-bearing contract.** If anything changes between the viewer being rendered and the sign-off being submitted, the sign-off is rejected. The client must re-review the new state.

- **No `/api/dials` endpoint here** — that's `/mockups` gate 2. Gate 4 is single-button approve.

## Integration Points

- **Task 018b** (`/new-project`): scaffolds `schemas/signoff.schema.json` into the project skeleton at step 5b — this skill assumes it's there
- **Task 019** (`/analyze`): produces `docs/analysis/{platform}/flows.md` — primary input
- **Task 024** (`/stylesheet`): sets `packages/ui-kit/package.json.version` that gets bound here
- **Task 025** (`/screens`): produces `docs/screens-manifest.json` + every screen HTML file
- **Task 025b** (`/visual-review`): produces `docs/visual-review/report.json` with per-screen status — this skill embeds badges from it
- **Task 034b** (schemas): `UserFlowsOutput` covers the return-JSON shape; `SignoffOutput` defines the sign-off body
- **Task 035** (orchestrator): invokes this skill AFTER `/visual-review` reports complete; passes `{{GATE_API_BASE}}` at render time
- **Task 036** (HITL gates): gate 4 serves `docs/user-flows.html` + handles `POST /api/signoff` per the contract above

## Related skills / files

- `.claude/skills/user-flows-generator/SKILL.md` — this file
- `.claude/skills/screens/SKILL.md` — preceding stage, produces the screens
- `.claude/templates/user-flows-template.html` — the viewer shell
- `schemas/signoff.schema.json` — body schema for gate 4

## Acceptance criteria

- [ ] `.claude/skills/user-flows-generator/SKILL.md` exists with the frontmatter above
- [ ] Reads `docs/analysis/{platform}/flows.md` as authoritative journey source (does NOT re-derive journeys)
- [ ] Reads `docs/screens-manifest.json` + `docs/visual-review/report.json` for hash + status embedding
- [ ] Reads `packages/ui-kit/package.json.version` for `uiKitVersion` binding
- [ ] Generates `docs/user-flows-manifest.json` before the viewer
- [ ] Renders `docs/user-flows.html` from `.claude/templates/user-flows-template.html`
- [ ] All `{{...}}` placeholders substituted (grep-verified zero remaining)
- [ ] Prior `docs/user-flows.html` archived to `docs/user-flows-archive/{prev-ts}.html` on re-run
- [ ] Visual-review badges present per step link (pass / fail / needs-human-review / not-reviewed)
- [ ] Device switcher includes 390×844 / 820×1180 / 1400×900 (matches 025b)
- [ ] Target switcher filters sidebar by webapp / mobile / admin
- [ ] Sign-off form POSTs to `{{GATE_API_BASE}}/api/signoff` with body matching `schemas/signoff.schema.json`
- [ ] Return JSON matches `UserFlowsOutput` in 034b
- [ ] `/screens` does NOT auto-invoke this skill (orchestrator controls invocation)
