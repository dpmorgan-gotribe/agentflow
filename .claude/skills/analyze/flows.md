# Sub-skill: Per-Platform User Flows (phase 4, flows half)

You are one of N per-platform sub-workers for /analyze phase 4. You
produce the user-flow narrative AND the section-level navigation schema
for your assigned platform. Your sibling sub-skill `screens.md` handles
the v3.0 screens.json — you will likely be invoked together (one prompt
covers both deliverables).

## Output targets

- `docs/analysis/{platform}/flows.md`
- `docs/analysis/{platform}/navigation-schema.md`

## Output discipline

- flows.md: start with `# User Flows — {platform}`. Per-flow heading
  format: `## Flow N: {Name}`. Agents grep for this structure.
- navigation-schema.md: start with `# Navigation Schema — {platform}`.
  Use YAML inside a fenced `yaml` block for machine consumption.
- No styles, no colors, no typography in either file — that's the
  shared-analysis layer's job.
- No hand-waving. Every flow MUST name specific screens; every section
  MUST specify its navigation.

## Inputs you receive

- Platform name (`web` | `mobile` | `admin` | `desktop`)
- Brief slice for that platform (either section of brief.md or a
  companion `platform-briefs/{platform}.md`)
- Full brief.md for context
- `companion/navigation-schema.json` if the user supplied one
- competitors.md (for flow-pattern reference)

## Flows process

1. **Enumerate screens in this platform's slice.** Find every screen
   referenced — in markdown tables, JSON blocks, YAML trees, prose, or
   companion navigation schema. Normalize to `kebab-case-id.html`
   filenames. Deduplicate.

2. **Identify personas with actions on this platform.** Cross-reference
   brief §6 with platform-specific features. Not every persona uses
   every platform.

3. **Group screens into flows** per persona. Each flow is a goal-driven
   journey. Example: "As a new user, I want to create my first tribe,
   navigating: onboarding → create-tribe → invite → tribe-feed."

4. **100% coverage rule.** Every screen from step 1 MUST appear in at
   least one flow. If a screen fits nowhere, create a catch-all flow:
   - "Settings & Profile Flow" → settings-_, profile-_, account-\*
   - "Financial Management Flow" → wallet-_, transaction-_
   - "Admin Operations Flow" → admin-\*
   - "Miscellaneous Flow" → last resort for true orphans

5. **Write each flow with explicit screen sequences.** Use the screen
   IDs, not paraphrases.

## Navigation-schema process

1. **Group screens by section** (via filename prefix or brief hints).
   E.g., `tribe-feed`, `tribe-events`, `tribe-members` all belong to
   section `tribe-detail`.

2. **For each section, specify:**
   - Header variant: `minimal` | `standard` | `admin` | `transparent`
   - Header actions: array of action names (search, notifications,
     profile-menu, etc.)
   - Footer variant: `tab-bar` | `hidden`
   - If tab-bar: tabs array + default active tab for this section
   - Sidemenu: `visible: true/false`; if visible, items array + active
     section

3. **Output as a YAML block** that `screens.md` sub-skill can read
   verbatim.

## flows.md output structure

```markdown
# User Flows — {platform}

## Flow 1: Onboarding & Setup

**Persona**: New User
**Goal**: Get to first meaningful action.

**Screens**:

1. `welcome.html` → `signup.html` → `verify-email.html` → `onboarding-step-1.html` → `onboarding-step-2.html` → `home.html`

**Notes**:

- Email verification is a blocking step.
- Social login skips steps 2 and 3.

---

## Flow 2: {Name}

...

---

## Flow N: {Name}

...

---

## Coverage

Total screens in platform slice: {N}
Screens in flows: {M}
Coverage: {M/N \* 100}%

## Orphaned Screens

(List any screens that couldn't be placed, with a reason. If 0, write
"None — full coverage achieved.")
```

## navigation-schema.md output structure

````markdown
# Navigation Schema — {platform}

```yaml
sections:
  - id: tribe-detail
    header:
      variant: standard
      actions: [search, notifications]
    footer:
      variant: tab-bar
      tabs: [feed, profile, messages]
      activeTab: feed
    sidemenu:
      visible: true
      items: [welcome, events, groups, jobs]
      activeSection: welcome
    screens:
      - tribe-feed
      - tribe-events
      - tribe-members

  - id: settings
    header:
      variant: minimal
      actions: []
    footer:
      variant: hidden
    sidemenu:
      visible: false
    screens:
      - settings-account
      - settings-notifications
      - settings-privacy
```
````

```

## Quality bar

- **Use real screen IDs.** `feed.html`, `tribe-detail-events.html` —
  the exact names that will ultimately be rendered.
- **Cover 100%** unless the orchestrator accepts a warning. Abort
  (return error) if you can't reach 80%; this indicates the brief is
  too ambiguous for extraction.
- **Don't invent navigation.** If the brief is silent on navigation for
  a section, take the section's pattern from the closest competitor
  (competitors.md) and flag as `# NEEDS CLARIFICATION: navigation
  pattern inferred from {competitor}`.

## When to flag [NEEDS CLARIFICATION]

- Orphan screen that can't be placed in any plausible flow → put it in
  "Miscellaneous Flow" with a flag.
- Screen has no clear persona — flag the screen + propose the most
  likely persona.
- Navigation pattern absent in brief — flag with inferred pattern +
  source.
```
