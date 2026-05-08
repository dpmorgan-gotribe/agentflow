# Ideas — captured someday/maybe items

Lightweight stash for half-baked thoughts that aren't yet worth a full
plan-feature / plan-bug. Promote via /idea-promote N when ready.

---

- [ ] 2026-05-08 — `.gitattributes` to normalize CRLF/LF on Windows worktrees. Empirical: per-bug worktrees on Windows show every file as "modified" via `git status --short` due to `core.autocrlf=true` line-ending normalization. Diff content (`-w` / whitespace-ignoring) is empty, but: (a) noise in operator inspection, (b) larger orchestrator stdout when git diff stat returns 100+ files, (c) potential false-positive trip on any future "diff size" heuristic. Fix: add `* text=auto eol=lf` to `.gitattributes` factory-template + each shipped project. ~5 min change. Validation: post-fix, `git status --short` in a fresh per-bug worktree returns only files the orchestrator's seedWorktree intentionally edits (`.claude/settings.json`).

- [ ] 2026-05-08 — file-bug-plan body template should defend against null screen-ids in FlowFailure violations. Empirical: reading-log-02 bugs 003-008 all have body text like _"clicked `(no selector matched)` on `[data-screen-id="null"]`, expected to land on `[data-screen-id="null"]` within 2000ms; landed on `(no screen-id present)`. Reference the mockup at `docs/screens/webapp/null.html`."_ The synthesized spec's actual error (`waiting for locator('role=link[name=/The Overstory/i]')`) is far more useful than the structured-field interpolation. Fix: when `fromScreenId === null && expectedScreenId === null`, fall back to the FlowFailure.message + spec path + a "see synthesized spec for selector detail" pointer. Builders ignore the misleading body content and work from the spec instead — but a decent plan body would let them route to the right fix-site faster. (Sister: bug-074 if formalized.)
