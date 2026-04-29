---
id: feat-033-idea-bucket
type: feature
status: draft
author-agent: claude-opus-4-7
created: 2026-04-29
updated: 2026-04-29
parent-plan: null
supersedes: null
superseded-by: null
branch: feat/idea-bucket
affected-files:
  - .claude/skills/idea/SKILL.md
  - .claude/skills/idea-list/SKILL.md
  - .claude/skills/idea-promote/SKILL.md
  - docs/ideas.md
feature-area: process
priority: P2
attempt-count: 0
max-attempts: 5
---

# feat-033 — `/idea` skill: lightweight bucket for half-baked thoughts

## Problem Statement

Mid-conversation, an operator (or Claude) frequently surfaces a
"this would be useful but isn't on the critical path" thought — like
"DAG observability would help" or "we should clean up bug-020 Layer 3
deferred work". Today these thoughts get lost in conversation history
or forgotten when context compacts.

`/plan-feature` is the heavyweight option: it requires problem
statement + approach + rejected alternatives + outcomes + validation.
Overkill for a one-liner you might revisit in 2 weeks.

A simpler bucket — a single `docs/ideas.md` markdown file appended to
via `/idea` — gives the operator a one-second capture for half-baked
thoughts, without forcing them through plan ceremony for every random
notion.

Inspired by the pattern in personal-notes systems (Things, etc.) — a
"someday/maybe" pile that gets reviewed periodically, not a backlog
that demands prioritization upfront.

## Approach

### Phase A — `/idea <text>` (capture)

1. `.claude/skills/idea/SKILL.md`:
   - Argument: free-form text (`/idea DAG observability via tree
render of tasks.yaml + progress.json`).
   - Behavior: appends one line to `docs/ideas.md` of the form:
     ```
     - [ ] 2026-04-29 14:32 — DAG observability via tree render of
           tasks.yaml + progress.json
     ```
   - Creates `docs/ideas.md` if absent (with a one-paragraph
     header explaining what the file is + how to promote ideas
     to plans).
   - Reports: "Idea captured at docs/ideas.md (N ideas total)".

### Phase B — `/idea-list` (review)

1. `.claude/skills/idea-list/SKILL.md`:
   - Reads `docs/ideas.md`, prints each unticked idea numbered for
     reference (`/idea-promote 7` later).
   - `--all` includes ticked-as-promoted ideas (history).
   - `--since <date>` filters by capture date.

### Phase C — `/idea-promote <N>` (graduate)

1. `.claude/skills/idea-promote/SKILL.md`:
   - Argument: idea number from `/idea-list`.
   - Reads idea text, runs `/check-existing-work` with the idea
     keywords, if no relevant prior plan exists, opens an
     interactive prompt: "Promote to: feature | bug | refactor |
     investigation | drop?"
   - Based on operator's response, dispatches `/plan-feature` (or
     equivalent) seeded with the idea text.
   - On successful plan creation, marks the idea as ticked in
     `docs/ideas.md` (`- [x]`) with a backref to the plan ID.

### Phase D — Periodic review nudge (optional)

1. A weekly hook (or a manual `/idea-review` skill) that surfaces
   stale unticked ideas (>30 days) and asks the operator to
   promote, edit, or drop them. Prevents `docs/ideas.md` from
   becoming a forgetting-pile.

## Rejected Alternatives

- **Use a separate `plans/ideas/` directory of mini-plans** —
  Rejected. Each idea-as-file is too much ceremony; the point is
  one-second capture. Markdown bullets in a single file are
  better.
- **Use `git issues` or external tracker** — Rejected. Adds an
  external dependency + breaks the pattern of "everything lives
  in the repo".
- **Make `/idea` auto-promote to `/plan-feature` immediately** —
  Rejected. Defeats the purpose: most ideas don't survive a
  week's reflection. Capture cheaply; promote selectively.
- **Stash ideas in CLAUDE.md memory** — Rejected. Memory is
  user-scoped; ideas are project-scoped. Plus memory is for
  durable facts about the user, not project backlogs.

## Expected Outcomes

- [ ] `/idea <text>` appends a timestamped bullet to
      `docs/ideas.md` and reports the new total
- [ ] `/idea-list` enumerates unticked ideas with numbers
- [ ] `/idea-promote N` reads idea N + dispatches the appropriate
      plan-\* skill seeded with the idea text + ticks the idea in
      `docs/ideas.md` on success
- [ ] `docs/ideas.md` is created on first `/idea` invocation with
      a self-explanatory header
- [ ] Each skill is registered + visible in the skill list

## Validation Criteria

1. **Capture round-trip**: `/idea X` → `cat docs/ideas.md` shows
   the idea with a timestamp; `/idea-list` shows it as item 1.
2. **Promote round-trip**: `/idea-promote 1` opens an interactive
   plan-creation prompt seeded with the idea text; on completion,
   `docs/ideas.md` has the idea marked `- [x] (→ feat-NNN-slug)`.
3. **Idempotency**: repeated `/idea X` on the same text dedupes
   (or warns + accepts duplicate, operator's call — design open).
4. **No git pollution**: `docs/ideas.md` is committed but each
   capture doesn't auto-commit (operator commits at logical
   breakpoints).

## Attempt Log

<!-- Populated automatically by agents.

RETRY POLICY:
  Attempt 1-2: Try different approaches
  Attempt 3: Run /plan-investigation
  Attempt 4: Try investigation's recommendation
  Attempt 5: STOP and escalate to human
  NEVER exceed 5 attempts on the same error
-->
