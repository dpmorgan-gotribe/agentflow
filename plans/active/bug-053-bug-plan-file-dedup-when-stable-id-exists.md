---
id: bug-053-bug-plan-file-dedup-when-stable-id-exists
type: bug
status: draft
author-agent: claude-opus-4-7
created: 2026-05-05
updated: 2026-05-05
parent-plan: investigate-017-token-usage-reduction-for-bug-fix-process
supersedes: null
superseded-by: null
branch: bug/bug-plan-file-dedup
affected-files:
  - scripts/file-bug-plan.mjs
  - scripts/file-bug-plan.test.mjs
feature-area: scripts/file-bug-plan
priority: P2
attempt-count: 0
max-attempts: 3
---

# bug-053: file-bug-plan.mjs writes duplicate plan files when same screen+pattern already filed

## Description

Per investigate-017 F4: each `/build-to-spec-verify` run files NEW plan files via `nextBugSeq` (returns max+1) even when the SAME screen+pattern already has a plan file in `plans/active/`. `bugs.yaml` IS deduped (idempotent on the stable bugs.yaml id at `scripts/file-bug-plan.mjs:976-979`), but the `plans/active/bug-NNN-*.md` files accumulate.

Empirical evidence: finance-track-01's `plans/active/` has **317 parity-bug plan files** (110 shell-stripping + 207 layout-regrouping) but `docs/bugs.yaml` has only **45 unique parity entries** (22 shell-stripping + 23 layout-regrouping). That's **~7× duplication** across 9 verifier runs.

This is NOT a token-cost bug (the fix-bugs loop dispatches against bugs.yaml entries, not plan files), but it:

- Slows Glob walks during agent dispatch context-build
- Pollutes `/check-existing-work` results with stale "active" plans
- Confuses operators ("we have 317 active bug plans" vs reality "45 unique bugs")
- Inflates `nextBugSeq` numbers unnecessarily — bug-310, bug-311, etc., when only ~50 unique bugs exist

## Likely cause

`scripts/file-bug-plan.mjs:nextBugSeq` (lines 57-71) walks `plans/{active,archive}/` and returns max+1 unconditionally. The caller `fileBugPlan` (line ~1010+) computes:

```js
const seq = nextBugSeq(plansDir);
const planId = bugIdFor(violation, seq);
```

`bugIdFor` includes the seq in the id (`bug-${seq}-${slugify(...)}`) — so even when the SAME violation is filed twice, the planId differs because seq differs. The plan file path changes → new file written.

Compare to bugs.yaml where the entry id is computed from the violation alone (no seq) → idempotent.

## Fix approach

Extend `fileBugPlan` to:

1. Compute the stable-slug (the same way `bugYamlIdFor` does — without seq prefix) FIRST.
2. Glob `plans/active/bug-*-<stable-slug>.md` AND `plans/archive/bug-*-<stable-slug>.md`.
3. If a match exists in EITHER:
   - In active: return the existing `{planId, planPath}`. Skip plan-file write entirely. Bugs.yaml entry write still proceeds (idempotent there).
   - In archive: STILL skip the new plan-file write, but log a warning that this bug was previously archived — the verifier is re-detecting a regression. (Surface in the warnings[] of /build-to-spec-verify return.)
4. Otherwise: proceed with the existing nextBugSeq + write path.

### Phase A — implement dedup helper

```js
function findExistingPlanByStableSlug(plansDir, stableSlug) {
  for (const sub of ["active", "archive"]) {
    const dir = path.join(plansDir, sub);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      // Match any seq prefix; assert the stable-slug suffix matches exactly.
      const m = entry.match(/^bug-\d{1,4}-(.+)\.md$/);
      if (m && m[1] === stableSlug) {
        return {
          planPath: path.join(dir, entry),
          location: sub,
          planId: entry.replace(/\.md$/, ""),
        };
      }
    }
  }
  return null;
}
```

### Phase B — wire into fileBugPlan

Before the existing `nextBugSeq` + `bugIdFor` block, compute the stable slug and short-circuit:

```js
const stableSlug = stableSlugFor(violation); // mirror of bugYamlIdFor sans seq
const existing = findExistingPlanByStableSlug(plansDir, stableSlug);
if (existing) {
  // Bugs.yaml entry write still happens below — idempotent there.
  if (appendToYaml) await appendBugYamlEntry({ projectDir, violation, ... });
  return {
    planId: existing.planId,
    planPath: existing.planPath,
    bugYamlId: ...,
    skipped: true,
    skipReason: existing.location === "archive" ? "previously-archived" : "already-active",
  };
}
// ... existing path
```

### Phase C — extend BuildToSpecVerifyOutput.warnings[]

When `skipped: true` AND `skipReason: "previously-archived"`, push a warning to the verifier's return JSON:

```
"Bug previously archived re-detected: <stableSlug>. Possible regression."
```

This surfaces in `/build-to-spec-verify`'s output and signals a regression for operator review.

### Phase D — regression tests

`scripts/file-bug-plan.test.mjs`:

- Filing the same violation twice → second call returns the SAME planId; only ONE plan file exists on disk
- Filing a violation whose plan was previously archived → returns the existing archive path + `skipReason: "previously-archived"`
- Filing a NEW violation → existing path unchanged (no regression)
- bugs.yaml is updated on BOTH filings (idempotent at yaml level — pre-existing behavior preserved)

### Phase E — one-off cleanup of finance-track-01

After landing: run a script that walks `projects/finance-track-01/plans/active/`, identifies plan-file dups (same stable-slug), keeps the LOWEST-seq plan, deletes the rest. Sister cleanup for repo-health-dashboard-01 + book-swap if dups exist.

## Validation

- [ ] Unit test: filing same violation twice produces ONE plan file + ONE bugs.yaml entry.
- [ ] Unit test: filing a violation whose archive entry exists short-circuits with `skipReason: "previously-archived"`.
- [ ] Empirical: re-run /build-to-spec-verify on finance-track-01 (post-cleanup); plan-file count stays flat across runs.
- [ ] No regression: filing a NEW (never-seen) violation works exactly as before.

## Cross-references

- **Parent**: `investigate-017-token-usage-reduction-for-bug-fix-process` F4 + R3
- **Existing infrastructure**:
  - `scripts/file-bug-plan.mjs:nextBugSeq` (line 57) + `bugIdFor` (line 81) + `fileBugPlan` (line ~1010) — the surfaces this plan extends
  - bugs.yaml idempotence at line 976 — already correct; this plan just extends idempotence to plan-files too
- **Empirical**: finance-track-01 has 317 parity-bug plan files vs 45 unique bugs.yaml entries (~7× dup ratio across 9 verifier runs)
