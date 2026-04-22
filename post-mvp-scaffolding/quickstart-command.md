# quickstart-command

**Deferred from**: investigate-002-build-tier-readiness-gap §Phase 4 novel concern C.

## The concern

Cold-start UX: a new user wants a working app in <30 min from a one-line idea as a confidence check. Today the path is 7-8 slash commands:

```
/new-project myapp --proposal "a daily-habits tracker with calm design"
/analyze --style-count=3
/mockups
/pick-style 0          (or pause at gate 2)
/stylesheet
/screens
/visual-review
/user-flows-generator
```

Each is a fine primitive but there's no "just run the happy path" command for a first-time demo.

## Why deferred

The 8-plan critical path delivers the BUILD tier. Adding quickstart before that just automates the DESIGN tier (which we can already demo via the walkthrough we did on mindapp-v2). Quickstart's real value kicks in once a demo can run brief → shipped PR in one command — which requires the build tier working.

Worth doing? Yes, eventually. MVP blocker? No.

## Rough shape when it's time

**`/quickstart <name> --proposal "<text>"` skill:**

1. `/new-project <name> --proposal "<text>"` — scaffolds + drafts brief
2. `/validate-brief` — confirms brief is legal
3. `/analyze --style-count=3` — 3 styles is enough for demo; faster than 10
4. `/mockups` — waits for gate 2 OR auto-picks style-0 with `--auto-select-first-style`
5. `/stylesheet` — default flags
6. `/screens` — generates all
7. `/visual-review` — scores
8. `/user-flows-generator` — emits gate-4 viewer
9. **pause** — user opens `docs/user-flows.html` + approves gate 4
10. `/architect` (when build tier ships) — continues automatically once gate 5 credentials land
11. _et cetera through build_
12. Output: "Your app ships to `projects/<name>/`. Open `user-flows.html` to approve OR `git log` to see the PR."

Flags:

- `--auto-select-first-style` — skip gate 2, auto-pick style-0 for demo speed
- `--stop-at=<stage>` — demo-mode stopping point (e.g. `--stop-at=user-flows`)
- `--budget=<usd>` — lower budget cap than default for demo safety

Estimated size: small plan. ~200 LOC skill + flag parsing + chained invocation + progress reporting. Depends on task-035 orchestrator runtime to chain stages programmatically.

## When to revisit

**After** the 8-plan critical path completes AND the first autonomous mindapp-v2 run succeeds. Quickstart then becomes the marketing-demo + contributor-onboarding command.

## Related

- Could be implemented partially today (design-tier-only quickstart) as a warm-up. But then needs rework once build tier lands. Single-shot implementation post-build-tier is cheaper.
