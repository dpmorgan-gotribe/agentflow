---
id: bug-047-synthesizer-tohaveurl-path-shape-pattern-mismatch
type: bug
status: draft
author-agent: human
created: 2026-05-03
updated: 2026-05-03
parent-plan: null
supersedes: null
superseded-by: null
branch: fix/synthesizer-assert-url-path-shape-rewrite
affected-files:
  - .claude/skills/user-flows-generator/SKILL.md
  - scripts/synthesize-flow-e2e.mjs
  - orchestrator/tests/synthesize-flow-e2e.test.ts
feature-area: synthesizer/url-pattern-translation + user-flows-generator-docs
priority: P1
attempt-count: 0
max-attempts: 5
error-message: "Error: flow-7 (Read monthly category report) failed at interaction 3: expect(page).toHaveURL(expected) failed. Expected pattern: /^\\/reports/. Received string: \"http://localhost:3000/reports\""
reproduction-steps: 'Author a user-flows manifest with `{ kind: "assertUrlMatches", pattern: "^/foo" }` (path-shape regex anchored with ^). Run /build-to-spec-verify. Synthesized spec emits `expect(page).toHaveURL(new RegExp("^/foo"))` which never matches the absolute URL `http://localhost:3000/foo`.'
stack-trace: null
---

# bug-047: synthesizer's `toHaveURL(new RegExp(pattern))` doesn't match path-shape regex against full URL

## Bug Description

Surfaced 2026-05-03 during finance-track-01 Wave 2 verifier-equivalent run. Synthesized flow-7 (Read monthly category report) failed at interaction 3:

```
expect(page).toHaveURL(expected) failed
Expected pattern: /^\/reports/
Received string:  "http://localhost:3000/reports"
```

Investigation: Playwright's `toHaveURL(regex)` matches against the **full URL string** (per [Playwright docs](https://playwright.dev/docs/api/class-pageassertions#page-assertions-to-have-url)). The pattern `/^\/reports/` matches strings that START with `/reports`. The actual URL `http://localhost:3000/reports` starts with `h`, never `/`. The assertion can never pass.

Two layers contribute:

1. **Synthesizer translation** (`scripts/synthesize-flow-e2e.mjs:275`):

   ```js
   case "assertUrlMatches":
     return `      ${idx} await expect(page).toHaveURL(new RegExp(${JSON.stringify(step.pattern)}));`;
   ```

   Translates `pattern: "^/reports"` → `expect(page).toHaveURL(new RegExp("^/reports"))` → never matches.

2. **/user-flows-generator SKILL.md teaches the bug**: lines 204 + 236 explicitly use `pattern: "^/report/"` as the worked example. The LLM dutifully follows.

Empirical scope:

- `finance-track-01`: 5 path-shape `^/...` patterns (`^/$`, `^/accounts`, `^/settings`, `^/transactions`, `^/reports`) — ALL broken.
- `repo-health-dashboard-01`: 1 unanchored pattern `/report/facebook/react` — accidentally works as partial match (no `^` to fail).
- Conclusion: the bug only triggers when the LLM follows SKILL.md's `^/...` example shape.

## Reproduction Steps

1. Author manifest with `{ "kind": "assertUrlMatches", "pattern": "^/foo" }`.
2. Run `node scripts/synthesize-flow-e2e.mjs <projectDir>` → emits `expect(page).toHaveURL(new RegExp("^/foo"))`.
3. Run `pnpm exec playwright test <generated-spec>`. Test fails with `Expected pattern: /^\/foo/. Received string: "http://localhost:3000/foo". Timeout: 5000ms`.

Empirical case: 2026-05-03 finance-track-01 flow-7 (path = `^/reports`).

## Error Output

From verifier-equivalent run:

```
9) [chromium] › e2e\synthesized\flow-7.spec.ts:71:7 › Read monthly category report (flow-7)

   Error: flow-7 (Read monthly category report) failed at interaction 3:
     expect(page).toHaveURL(expected) failed
     Expected pattern: /^\/reports/
     Received string:  "http://localhost:3000/reports"
     Timeout: 5000ms
```

Same root cause would hit any flow with a `^/...`-shape pattern.

## Root Cause Analysis

### Why /user-flows-generator authors path-shape patterns

`.claude/skills/user-flows-generator/SKILL.md §4b` step 5 + the worked example explicitly use the path-shape form:

> "Optional final URL assertion. When the route pattern is distinctive, emit `{ kind: \"assertUrlMatches\", pattern: \"^/report/\" }`..."

Line 236 in the worked example:

```json
{ "kind": "assertUrlMatches", "pattern": "^/report/" }
```

The intent is intuitive (path matching), but the runtime semantics don't match.

### Why the synthesizer translation is wrong

The synthesizer wraps the pattern verbatim in a JS regex: `new RegExp("^/foo")`. Playwright's `toHaveURL(regex)` matches against the full URL string — `http://...:port/path`. A `^`-anchored path pattern never matches.

Three valid translation alternatives:

1. **Unanchor the path** — translate `^/foo` → `/foo` (just match anywhere in the URL string). Loses precision (also matches `http://example.com/anything/foo`).
2. **Convert to URL-shape pattern** — translate `^/foo` → `^https?://[^/]+/foo`. Anchors to URL start, allows any host/port, matches the path. Preserves precision.
3. **Switch to pathname assertion** — emit `await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/foo/)`. Most semantically clear. More verbose at runtime.

Option 2 is best for backward compatibility: the manifest stays the same shape, the assertion stays `toHaveURL`, only the regex gets transformed.

### Why repo-health-dashboard-01's pattern works

Its manifest has `pattern: "/report/facebook/react"` (no `^`). The regex `/\/report\/facebook\/react/` does a partial match — finds the substring anywhere in `http://localhost:3000/report/facebook/react`. Accidentally correct.

### Why this should be fixed at the synthesizer (not just SKILL.md)

The manifest's `pattern` field semantics are intuitive (path-shape). Forcing /user-flows-generator to author URL-shape regex (`^https?://[^/]+/foo`) leaks transport-layer concerns into the manifest. The synthesizer is the right place to translate intent → mechanical Playwright code.

## Fix Approach

### Phase A — SKILL.md correction (P1)

1. **Update `.claude/skills/user-flows-generator/SKILL.md` line 204** — clarify that `pattern` is path-shape regex relative to the project's baseURL. Document explicit semantics:
   > "The `pattern` field is a regex source matching the URL pathname (the part after the host:port). Use leading `^/` to anchor to the path start. The synthesizer translates this to a full-URL regex at synthesis time."
2. **Update line 236 worked example** — keep `pattern: "^/report/"` (path-shape, intuitive) but note the synthesizer-time translation in surrounding prose.
3. Add edge-case examples: `pattern: "^/$"` matches root path; `pattern: "^/foo/[^/]+"` matches `/foo/<segment>`.

### Phase B — synthesizer auto-rewrite path-shape patterns (P1, load-bearing)

4. **Extend `scripts/synthesize-flow-e2e.mjs:275`** assertUrlMatches case:

   ```js
   case "assertUrlMatches": {
     // bug-047: manifest patterns are path-shape regex (matches the URL
     // pathname). toHaveURL matches the full URL string, so naive
     // `new RegExp("^/foo")` never matches "http://host:port/foo".
     // Detect path-shape patterns (start with "/" or "^/") and rewrite
     // to URL-shape: "^/foo" → "^https?://[^/]+/foo".
     const rewritten = rewritePathShapeToUrlShape(step.pattern);
     return `      ${idx} await expect(page).toHaveURL(new RegExp(${JSON.stringify(rewritten)}));`;
   }
   ```

5. **`rewritePathShapeToUrlShape` algorithm** (new helper):
   - Input pattern starts with `^/` → replace `^/` with `^https?://[^/]+/`
   - Input starts with `/` (no `^`) → leave unchanged (already partial-match-safe; see repo-health-01 working case)
   - Input doesn't start with `^` or `/` → leave unchanged (operator authored URL-shape explicitly; trust them)
   - Edge case: `^/$` → `^https?://[^/]+/$`

6. **Document the transform in synthesizer header comment** (lines 1-30 area) so future maintainers see the rewrite intent.

### Phase C — synthesizer regression tests (P1, ships with Phase B)

7. Add cases to `orchestrator/tests/synthesize-flow-e2e.test.ts`:
   - `pattern: "^/foo"` → emitted spec contains `new RegExp("^https?://[^/]+/foo")`
   - `pattern: "/foo"` → emitted spec contains `new RegExp("/foo")` (unchanged)
   - `pattern: "^/$"` → emitted spec contains `new RegExp("^https?://[^/]+/$")`
   - `pattern: "^https?://api.example.com/foo"` → unchanged (URL-shape preserved)

### Phase D — empirical re-validation

8. After Phases A+B+C ship, re-run `pnpm -C apps/web exec playwright test e2e/synthesized/flow-7.spec.ts` on finance-track-01. Expect: interaction 3 passes against the populated `/reports` URL.

## Rejected Fixes

- **Schema-level rejection of path-shape patterns** — Rejected. Path-shape is the intuitive form; punishing manifest authors for using it works against the design.
- **Switch translation to `expect.poll(() => new URL(page.url()).pathname).toMatch(...)`** — Rejected. More verbose; emitted spec becomes harder to read. The auto-rewrite preserves the natural `toHaveURL(regex)` assertion form.
- **Just unanchor the pattern** (`^/foo` → `/foo`) — Rejected. Loses precision: `/foo` matches anywhere in URL, including `http://example.com/anything/foo`. The URL-shape rewrite preserves the operator's anchoring intent.

## Validation Criteria

### Phase A

- [ ] SKILL.md documents `pattern` field semantics (path-shape regex, synthesizer translates).
- [ ] Worked example unchanged in shape but accompanied by translation explanation.

### Phase B

- [ ] `rewritePathShapeToUrlShape` helper exists + is unit-tested.
- [ ] Synthesizer's assertUrlMatches case calls the rewrite before emission.
- [ ] Header comment documents the transform.

### Phase C

- [ ] ≥4 regression tests cover the rewrite cases.
- [ ] Existing synthesizer tests still pass.

### Phase D

- [ ] finance-track-01 synthesized flow-7 interaction 3 passes after re-running synthesizer (no manifest change needed; just regenerate the spec from the existing manifest).
- [ ] Other 4 path-shape patterns in finance-track-01 manifest now translate correctly.

## Cross-references

- **Empirical case**: 2026-05-03 finance-track-01 Wave 2 verifier-equivalent run — surfaced after bug-040/041/042/043 fixed the seeding pipeline.
- **Sister bug**: bug-046 (mixed CSS+role= selectors) — same investigation; both manifest-authoring + synthesizer-translation issues.
- **Sister occurrence**: bug-044 (hand-written flow-3 toHaveURL regex) — same root semantic confusion (regex matching path-shape vs full-URL); fixed at the project test level. bug-047 fixes the SAME bug at the synthesizer level + SKILL.md level for ALL future projects.
- **Synthesizer surface**: `scripts/synthesize-flow-e2e.mjs:275` — the line with the buggy translation.
- **Predecessor SKILL.md**: feat-038 Phase 2A defined the InteractionStep vocabulary including assertUrlMatches; feat-038 Phase 3 authored the /user-flows-generator skill that emits the path-shape pattern.

## Attempt Log

<!-- populated as fix attempts are made -->
