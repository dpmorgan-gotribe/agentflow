---
id: feat-037-audit-reachability-ts-aware-rewrite
type: feature
status: draft
author-agent: claude-opus-4-7
created: 2026-04-29
updated: 2026-04-29
parent-plan: bug-030-audit-reachability-false-positive-flood
supersedes: null
superseded-by: null
branch: feat/audit-reachability-ts-aware-rewrite
affected-files:
  - scripts/audit-app-reachability.mjs
  - orchestrator/src/build-to-spec-verify.ts
  - .claude/skills/build-to-spec-verify/SKILL.md
feature-area: orchestration
priority: P2
attempt-count: 0
max-attempts: 5
---

# feat-037 — `audit-app-reachability` TypeScript-aware rewrite

## Problem Statement

`scripts/audit-app-reachability.mjs` is a regex-based reachability heuristic. It works for the common cases shipped projects exercise, but it makes simplifying assumptions that have already produced one false-positive flood (bug-030: 62 P0 bugs filed in error against `repo-health-dashboard-01` on 2026-04-29) and will silently miss legitimate orphans whenever a project's TypeScript layout drifts from the assumptions.

bug-030 Phase A patched the three specific gaps that produced the empirical flood (drop `packages/` from `SCAN_ROOTS`, extend `@/` alias roots for the modern App Router layout, treat `export … from` as importer edges). Phase A leaves the script's _structural_ model unchanged — it's still regex+conventional path-aliases, not a real TypeScript-aware reachability analyzer. Specifically it still cannot:

1. **Read `tsconfig.json` `paths` mappings.** `@/` is hard-coded as a list of candidate roots. Projects that configure `@components/`, `@lib/`, `~ui/`, etc. via tsconfig are unsupported. Mobile (Expo) and Vite-flavored web stacks may diverge from the Next.js heuristic baked in.
2. **Resolve `@repo/<name>` workspace package aliases.** The audit treats any non-relative import as "outside the workspace" and skips it. So when `apps/web/app/about/page.tsx` does `import { Tooltip } from "@repo/ui-kit"`, the audit cannot follow the chain into `packages/ui-kit/src/index.ts → ./primitives/tooltip → ./tooltip.tsx`. bug-030 Phase A worked around this by _removing_ `packages/` from scan scope; a TS-aware audit could include it again.
3. **Trace re-export chains across files of arbitrary depth.** Phase A's regex extension handles single-hop `export * from "./x"` but not chains spanning 3+ hops with mixed `export *` / `export { foo }` / `export { default as Foo }` / namespace re-exports (`export * as ns from "..."`). A real AST parse + symbol-resolution pass handles all forms.
4. **Disambiguate named-vs-default exports.** Currently `parseExports()` returns both as a flat name list. A consumer's `import Foo from "./bar"` (default) versus `import { Foo } from "./bar"` (named) gets resolved identically — both add an importer edge. Fine for orphan detection (just need to know the file is reached at all) but loses fidelity for diagnostics ("which symbol triggered the reach?").
5. **Understand JSX as reachability evidence.** `<Tooltip />` in JSX is a _use_ of the imported `Tooltip` symbol, but the audit only counts the import line as a reach signal. The distinction matters for catching cases where a primitive is imported but never rendered (latent dead code). Real TS analysis can mark a symbol "used" only if it appears in JSX or a call site.

Each gap is small individually; together they make the audit fragile in proportion to project layout diversity. The factory ships several stack skills (`react-next`, `react-vite`, `svelte-kit`, `expo`, `python-fastapi`, `node-trpc-nest`) and projects under `projects/` exhibit each. As more projects ship, the audit's empirical false-positive rate will creep up unless the structural model is upgraded.

## Approach

Replace the regex-based heuristic with a TypeScript-aware reachability analyzer. The factory already vendors `typescript` (it's a transitive dep of `tsx`), so no new install cost. Pick between two implementation paths after the investigation step.

### Phase 0 — Investigation (time-boxed: 1 hour)

Before any code, decide between:

- **Path A: TypeScript Compiler API.** Use `ts.createProgram` + `getResolvedModuleName` + `ts.findReferences` to build a real reachability graph. Reads `tsconfig.json` natively; resolves all `paths` aliases; understands re-exports + JSX + symbol identity. Heaviest but most correct.
- **Path B: `dependency-cruiser` or `madge`** (existing OSS tools). Both already do TS-aware reachability. `dependency-cruiser` has rule-based dead-code detection out of the box. Lighter integration cost; trade off control over output shape (would need to translate their report → our `BuildToSpecVerifyOutput.reachability` schema).

Compare on three axes: (a) install cost (size of dep tree), (b) cross-platform Windows behavior (the factory's primary dev surface — both options' behavior on Windows path normalization needs verification), (c) per-project runtime (must stay <10s for a 50-file project; the audit currently runs <1s).

### Phase 1 — Implement chosen path

Replace `scripts/audit-app-reachability.mjs` with a new module (likely `.mjs` retained for orchestrator's spawn-Node-script contract, or upgraded to `.ts` and added to orchestrator scripts dir if Path A demands compile-time TS checking). Output schema unchanged — must produce the same `{ ok, scannedFiles, orphanComponents[], orphanRoutes[] }` shape so `runBuildToSpecVerify` continues to work without changes.

Key invariants:

- **Output schema parity** with current script (validated by Zod in `runBuildToSpecVerify`).
- **No new spurious orphans** versus Phase A baseline (run side-by-side on `repo-health-dashboard-01`, all 5 pre-build projects, and any future kanban-\* test projects; new script must produce ≤ same orphan count).
- **Re-add `packages/` to scan scope** (now that re-export chains resolve correctly, ui-kit primitives that ARE genuinely unused should surface — but Tooltip et al should still NOT be flagged).
- **Cross-platform path normalization** verified on Windows (the factory's primary dev surface).

### Phase 2 — Validation harness

Add a `scripts/audit-app-reachability.test.mjs` (or `.test.ts`) with synthetic project fixtures under `tests/fixtures/audit-reachability/`:

- `barrel-only/` — primitives consumed only via package barrel (regression test for bug-030 cause)
- `path-alias-mixed/` — `@/`, `@components/`, `~/` aliases used in same project
- `genuine-orphan/` — file with no importers (must surface)
- `re-export-chain-3-hops/` — A → B → C → D barrel chain
- `default-vs-named-mixed/` — both default and named imports of same module
- `cross-package-barrel/` — `apps/web` consuming `packages/ui-kit` via `@repo/ui-kit`

Each fixture is a tiny tsconfig + 2–6 source files. Test asserts the audit's output matches a hand-authored expected JSON.

### Phase 3 — Cutover

- Run new script + old script side-by-side on every project under `projects/` for one cycle.
- If divergences appear, treat each as a P0 investigation (likely surfaces real orphans the regex missed).
- Once aligned, remove the old `.mjs`. Update `.claude/skills/build-to-spec-verify/SKILL.md` cross-references.

## Rejected Alternatives

- **Keep the regex script and patch each new false-positive class as it surfaces.** Rejected because (a) we already saw one flood and reactive patching is operationally expensive (each flood blocks a verify+fix-loop run for hours), (b) the structural model isn't getting better with patches — it's accumulating special-cases that future maintainers won't be able to reason about, (c) the audit is load-bearing for the verify+fix-loop's signal quality, and false positives at scale would erode operator trust in the loop entirely.
- **Drop the audit and rely on TypeScript's `noUnusedLocals` / `noUnusedExports`.** Rejected because (a) `noUnusedLocals` is per-file scope only; doesn't catch cross-file orphans, (b) `noUnusedExports` doesn't exist in stable TypeScript (it's a long-standing feature request), and (c) the audit's purpose is _route_ reachability + _component_ reachability _transitively from app entry points_ — a different question than "is this symbol referenced anywhere", which is what TS lints answer.
- **Replace with bundler analysis (Next.js + Webpack `stats.json`).** Rejected because (a) requires a full build to produce stats, slowing the verify pass from <10s to potentially 60s+, (b) per-stack: Next.js + Vite + SvelteKit + Expo each emit different stats shapes, multiplying the integration surface, (c) doesn't work without a fully-buildable project, blocking verify on broken builds (chicken-and-egg with the bug-fix loop).

## Expected Outcomes

- [ ] Phase 0 investigation completes with a documented choice between TypeScript Compiler API and dependency-cruiser/madge, including timing benchmarks against `repo-health-dashboard-01`.
- [ ] New audit produces identical output schema to current `audit-app-reachability.mjs` (Zod-validated).
- [ ] All 6 synthetic fixtures pass.
- [ ] Re-running on `repo-health-dashboard-01` post-Phase-A baseline produces the same orphan count (currently 0).
- [ ] `packages/` re-added to scan scope produces 0 orphans against shipped ui-kit primitives in `repo-health-dashboard-01` (Tooltip et al consumed via barrel chain are correctly traced).
- [ ] Genuine cross-package orphans surface — sanity test: `packages/ui-kit/src/lib/__zzz-unused.ts` (planted, no consumers) is flagged.
- [ ] Side-by-side run on all 5 pre-build projects + repo-health-dashboard-01 produces no NEW false positives versus Phase A.
- [ ] `audit-app-reachability` runtime stays <10s on the largest project (currently <1s — track regression).
- [ ] Old `.mjs` script removed; `runBuildToSpecVerify` + skill SKILL.md cross-references updated.
- [ ] Validation harness committed under `tests/fixtures/audit-reachability/` so future regressions surface in CI rather than in production verify runs.

## Open Questions

1. **Should the new audit live in `orchestrator/scripts/` (TS) or stay at `scripts/` (.mjs)?** Trade-off: TS gives type-safety + reuses orchestrator's tsx setup; .mjs keeps the `scripts/` colocation pattern that `sync-project-schemas.mjs` understands. Investigate during Phase 0.
2. **Mobile (Expo) project layouts use `apps/mobile/{App.tsx,app/}` — how do alias conventions diverge from web?** Factor into Phase 0 fixture set.
3. **Does Path A (TS Compiler API) need its own caching layer to stay sub-10s?** A cold `ts.createProgram` is ~2-3s on a small project; aggregate across the verify pass + repeat per fix-loop iteration could add up. Benchmark in Phase 0.
4. **Cross-cutting with feat-038-style allowlist (if filed):** the audit currently honors `// reachability-allow:` comments. Phase 1 must preserve that escape hatch for genuine orphans the operator wants to ignore (e.g., dev-seed scripts, demo fixtures).

## Cross-references

- `plans/active/bug-030-audit-reachability-false-positive-flood.md` (parent — Phase A surgical fixes)
- `plans/archive/bug-028-audit-reachability-misses-router-push.md` (grandparent — first round of audit fixes)
- `plans/archive/feat-022-build-to-spec-verification.md` (the verify pipeline this audit feeds)
- `scripts/audit-app-reachability.mjs` (current implementation, to be replaced)
- `orchestrator/src/build-to-spec-verify.ts` (orchestrator wrapper that runs the audit)
- `.claude/skills/build-to-spec-verify/SKILL.md` (skill that documents the audit's role in the verify pipeline)
