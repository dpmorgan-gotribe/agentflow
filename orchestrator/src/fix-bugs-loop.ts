import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import yaml from "js-yaml";
import {
  BugsYamlSchema,
  type BugEntry,
  type BugsYaml,
  type BuildToSpecVerifyOutput,
} from "@repo/orchestrator-contracts";
import { buildBugContextEnvelope } from "./bug-fix-context.js";
import type { BudgetTracker } from "./budget-tracker.js";
import type { BuildToSpecVerifyContext } from "./build-to-spec-verify.js";
import type { InvokeAgentFn } from "./feature-graph.js";
import { seedWorktree } from "./invoke-agent.js";
import { PauseSignal } from "./pause.js";

/**
 * feat-026 — automated bug-fix loop runner.
 *
 * Reads `<projectRoot>/docs/bugs.yaml` (orchestrator-managed, populated by
 * the verifier in feat-022/feat-025), iterates verify→fix→verify until
 * either every bug is `completed` OR an iteration cap is hit OR no
 * pending bug remains workable. The loop runs INSIDE a single shared
 * `fixup` worktree so bugs accumulate fixes across iterations without
 * the parallel-feature contention bug-015 surfaced.
 *
 * IMPORTANT separation: `/plan-bug` (user-only) is unchanged; this loop
 * never reads or writes those plans. The standalone `bug-NNN-*.md` files
 * referenced from BugEntry.bugPlanPath are the auto-filed variant
 * `scripts/file-bug-plan.mjs` writes for the verifier — same disk
 * location, different channel.
 */

/** Per-iteration breakdown for the loop's return summary. */
export interface IterationSummary {
  iteration: number;
  bugsAttempted: number;
  bugsCompleted: number;
  bugsFailed: number;
  bugsRemaining: number;
  /** True if the post-iteration verify pass came back clean. */
  verifyOk: boolean;
  /** New bug ids the verify pass surfaced + appended to bugs.yaml this iteration. */
  newBugIds: string[];
  /** Bug ids that were `completed` last iteration but reappeared (flap). */
  reappearedBugIds: string[];
  iterationCostUsd: number;
}

export interface FixBugsLoopResult {
  status: "clean" | "iteration-cap-hit" | "all-bugs-failed" | "no-bugs";
  iterationsRun: number;
  bugsResolved: string[]; // bug ids
  bugsFailed: string[];
  bugsRemaining: string[]; // pending after cap hit
  totalCostUsd: number;
  iterationLog: IterationSummary[];
  /** Final verify output (last iteration's verify pass), if any. */
  finalVerify?: BuildToSpecVerifyOutput;
}

export type RunBuildToSpecVerifyFn = (
  ctx: BuildToSpecVerifyContext,
) => Promise<BuildToSpecVerifyOutput>;

export interface FixBugsLoopContext {
  projectRoot: string;
  pipelineRunId: string;
  /** Repo root for the factory itself (where scripts/ lives). */
  factoryRoot: string;
  budget: BudgetTracker;
  invokeAgent: InvokeAgentFn;
  runBuildToSpecVerify: RunBuildToSpecVerifyFn;
  /** Loop-iteration cap. Default 5 (matches plan §Phase B). */
  iterationCap?: number;
  /**
   * Reset-to-pending count after which a bug is escalated to `failed`
   * (flapping detector). Default 3.
   */
  maxFlapResets?: number;
  /** Path to the shared fixup worktree. Default `<projectRoot>/.claude/worktrees/fixup`. */
  fixupWorktreePath?: string;
  /** Branch name for the fixup worktree. Default `fix/bugs-yaml-iter`. */
  fixupBranchName?: string;
  /**
   * bug-058 (2026-05-06) — project base branch the fixup worktree should
   * track. Default `master`. Configurable so projects using `main` or
   * other conventions can opt in.
   */
  baseBranchName?: string;
  /** Override path for `docs/bugs.yaml`. Default `<projectRoot>/docs/bugs.yaml`. */
  bugsYamlPath?: string;
  /**
   * When true, skip actually creating / closing the git worktree (tests
   * pass true; real runs leave undefined so default git behavior runs).
   * Defaults to true when invoked under vitest (NODE_ENV === "test")
   * unless explicitly overridden, false otherwise.
   */
  skipWorktreeManagement?: boolean;
  /**
   * feat-046 Phase A.1 (2026-05-05) — concurrent bug-dispatch cap. When
   * unset OR 1, the loop runs the existing sequential single-fixup-worktree
   * path (zero behavior change). When >= 2, per-bug worktrees on
   * `fix/<bug-id>` branches dispatch via `Promise.all` batches; per-batch
   * sequential merge cascade rolls each into the fixup branch. KNOWN
   * LIMITATION: Phase A.1 does NOT inject per-slot env vars (PORT,
   * NEXT_PUBLIC_API_BASE_URL, etc) — Strategy C projects (real-DB
   * backend) will collide on port 3001 across slots. Strategy A
   * (localStorage) + D (intercept) projects are safe at any concurrency
   * since they don't share a backend. Phase A.2 ships per-slot env
   * isolation; until then operators with Strategy C should keep
   * concurrency at 1.
   */
  maxConcurrent?: number;
  /**
   * feat-053 (2026-05-05) — class-batched fix-dispatch. When true, the
   * loop groups parity-divergence bugs by `bug.parity.pattern` and
   * dispatches groups of ≥ 2 same-pattern bugs as a SINGLE batched task
   * (one builder + one tester + one reviewer + one merge cascade) in a
   * shared per-pattern worktree.
   *
   * Empirical motivator (finance-track-01 2026-05-05): 22 shell-stripping
   * bugs all wanted the same `<AppShell>` wrap fix. Pre-feat-053: 22
   * dispatches × ~28min = ~10h at C=1 / ~5h at C=5. Post-feat-053: 1
   * dispatch × ~30-45min = ~13× faster + ~95% fewer agent dispatches.
   *
   * Default false — opt-in for empirical validation. Singleton groups
   * (size 1, or non-parity bugs) flow through the existing per-bug path
   * regardless. Tester is NOT skipped — class-uniform fix shape doesn't
   * guarantee class-uniform application; tester catches "builder missed
   * 1 of 22".
   */
  enableClassBatchedDispatch?: boolean;
}

/** Internal: filesystem helpers, injectable for tests via FixBugsLoopContext extras. */
function defaultBugsYamlPath(projectRoot: string): string {
  return join(projectRoot, "docs", "bugs.yaml");
}

function defaultFixupWorktreePath(projectRoot: string): string {
  return join(projectRoot, ".claude", "worktrees", "fixup");
}

function readBugsYaml(path: string): BugsYaml | null {
  if (!existsSync(path)) return null;
  try {
    const raw = yaml.load(readFileSync(path, "utf8"));
    const parsed = BugsYamlSchema.safeParse(raw);
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeBugsYaml(path: string, doc: BugsYaml): void {
  mkdirSync(dirname(path), { recursive: true });
  doc.generated_at = new Date().toISOString();
  writeFileSync(path, yaml.dump(doc, { lineWidth: 120 }));
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@/.:\\-]+$/.test(value)) return value;
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

/**
 * bug-082 (2026-05-11) — capture the worktree's current HEAD sha for the
 * unverified-completion guard. Returns null on any failure (no git repo,
 * detached state, etc.); the caller treats null as "can't verify, skip
 * guard" to avoid false negatives.
 */
function readGitHeadSafe(cwd: string): string | null {
  try {
    const out = execSync(`git rev-parse HEAD`, { cwd, encoding: "utf8" });
    return out.trim();
  } catch {
    return null;
  }
}

/**
 * bug-082 — return the list of paths changed between two refs in the
 * worktree. Returns null on any failure (caller treats as "can't verify").
 */
function gitDiffPaths(
  cwd: string,
  fromRef: string,
  toRef: string,
): string[] | null {
  try {
    const out = execSync(
      `git diff --name-only ${shellQuote(fromRef)} ${shellQuote(toRef)}`,
      { cwd, encoding: "utf8" },
    );
    return out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } catch {
    return null;
  }
}

/**
 * bug-082 — classify whether a list of changed paths contains a real
 * source-code change vs only bookkeeping. The orchestrator-managed bugs.yaml
 * and plan files don't count as "the agent fixed something" — the agent
 * may have only touched its own tracking artefacts.
 *
 * "Source change" = ANY path NOT in this denylist:
 *   - docs/bugs.yaml (orchestrator-managed; agent shouldn't touch it anyway)
 *   - plans/** (plan files; agent shouldn't touch them in a fix dispatch)
 *   - .claude/state/** (per-run state; orchestrator-managed)
 *
 * @returns true when at least one path is a non-denylist source change
 */
function diffContainsSourceChange(paths: readonly string[]): boolean {
  const isBookkeepingOnly = (p: string) =>
    p === "docs/bugs.yaml" ||
    p.startsWith("plans/") ||
    p.startsWith(".claude/state/");
  return paths.some((p) => !isBookkeepingOnly(p));
}

/**
 * Open the shared fixup worktree on master. Uses the same `git worktree
 * add` pattern as `runCheckoutFeature` in invoke-agent.ts (cross-platform
 * shell quoting via `shellQuote`).
 *
 * bug-031 Phase A: invokes `seedWorktree()` AFTER the worktree exists
 * (whether freshly added OR pre-existing from a prior session). Without
 * seeding, the fixup worktree lacks `.claude/hooks/` (gitignored at
 * `agenticVisibility: private` projects so `git worktree add` doesn't
 * bring it) AND the autonomous `permissions.allow` block — both of
 * which dispatched builders need to actually write fixes. Pre-bug-031
 * the loop dispatched into a half-provisioned sandbox and every fix
 * attempt failed at the permission/hook boundary.
 *
 * bug-031 Phase B: re-seeds even when the worktree already exists.
 * `seedWorktree()` is idempotent (existing entries preserved; missing
 * required entries appended). Re-seeding refreshes hooks/settings that
 * may have drifted from the factory revision since the worktree was
 * first created — common when an orchestrator session straddles a
 * factory upgrade.
 *
 * Skipped when `skipWorktreeManagement` is true (tests + standalone
 * verify-without-loop runs).
 */
function openFixupWorktree(args: {
  projectRoot: string;
  worktreePath: string;
  branch: string;
  /** bug-058 — project base branch (default "master"). */
  baseBranch?: string;
}): { ok: true } | { ok: false; reason: string } {
  // bug-076 (2026-05-08) — `existsSync` returns true for ANY directory at the
  // path, including:
  //   1. A live registered git worktree (created by `git worktree add`)
  //   2. An orphan empty dir left by a prior crash / Windows file-lock
  //      preventing teardown / partial cleanup
  // Without `isRegisteredGitWorktree` check, the function silently skips
  // `git worktree add` for case (2), so the fixup BRANCH is never created;
  // per-bug worktrees later branch from a missing ref + cascade-fail with
  // `per-bug-worktree-open-failed`. Empirical motivator: reading-log-02
  // /fix-bugs run b0e1281c retry 2026-05-08 — Windows held a kernel handle
  // on the empty `.claude/worktrees/fixup` dir; orchestrator's existsSync
  // returned true; per-bug worktrees all failed; bug-073 convergence
  // detector escalated 14 bugs to `failed`. Mirrors bug-061's force-recreate
  // pattern from openPerBugWorktree.
  // 3-state detection: registered / orphan / unknown. Only force-recreate
  // when DEFINITIVELY orphan (git worktree list succeeded + dir not in it);
  // when unknown (test env without git, or git failure), fall back to the
  // legacy "skip add when exists" behavior so existing tests continue to
  // exercise the seedWorktree-on-pre-existing-dir path.
  const exists = existsSync(args.worktreePath);
  let listOk = false;
  let registered = false;
  try {
    const out = execSync(`git worktree list --porcelain`, {
      cwd: args.projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    listOk = true;
    const target = resolve(args.worktreePath);
    for (const line of out.split("\n")) {
      if (!line.startsWith("worktree ")) continue;
      const reg = resolve(line.slice("worktree ".length).trim());
      if (reg === target) {
        registered = true;
        break;
      }
    }
  } catch {
    listOk = false;
  }
  const isOrphan = exists && listOk && !registered;
  if (!exists || isOrphan) {
    if (isOrphan) {
      // Orphan dir — try to remove before `git worktree add`. Tolerate
      // Windows file lock: an empty locked dir CAN still accept a
      // `git worktree add` write (verified on reading-log-02 2026-05-08).
      try {
        rmSync(args.worktreePath, { recursive: true, force: true });
      } catch {
        // Best-effort. Fall through; git worktree add may still succeed
        // into the empty locked dir.
      }
    }
    mkdirSync(dirname(args.worktreePath), { recursive: true });
    try {
      execSync(
        `git worktree add ${shellQuote(args.worktreePath)} -b ${shellQuote(args.branch)}`,
        { cwd: args.projectRoot, stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (err) {
      // Common follow-up: branch already exists (from a partial prior
      // attempt). Retry without `-b` so we re-attach to the existing branch.
      const errMsg = err instanceof Error ? err.message : String(err);
      if (
        /already exists|already used by worktree|not a valid object name/i.test(
          errMsg,
        )
      ) {
        try {
          execSync(
            `git worktree add ${shellQuote(args.worktreePath)} ${shellQuote(args.branch)}`,
            { cwd: args.projectRoot, stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (err2) {
          return {
            ok: false,
            reason: `bug-076 fallback failed: ${err2 instanceof Error ? err2.message : String(err2)} (initial: ${errMsg})`,
          };
        }
      } else {
        return { ok: false, reason: errMsg };
      }
    }
  }

  // bug-031: seed (or re-seed) the worktree with .claude/hooks/ + autonomous
  // permissions.allow. Idempotent — safe whether the worktree was just added
  // or pre-existed.
  const seed = seedWorktree(args.projectRoot, args.worktreePath);
  if (!seed.ok) {
    return {
      ok: false,
      reason: `fixup-worktree-seed-failed (${seed.reason}): ${seed.detail}`,
    };
  }

  // bug-058 — bring fixupBranch up to date with master if it has fallen
  // behind. Without this, per-bug worktrees branched from fixupBranch see
  // a stale tree — agents miss operator commits made between /fix-bugs
  // runs and may regress them. See bug-058 for empirical motivator
  // (reading-log-01 bjw01o7js: agent regressed .npmrc + tsconfig fixes
  // that landed on master via b1c3e20 between runs).
  const sync = ensureFixupTracksMaster({
    projectRoot: args.projectRoot,
    worktreePath: args.worktreePath,
    baseBranch: args.baseBranch ?? "master",
  });
  if (!sync.ok) return sync;

  return { ok: true };
}

/**
 * bug-058 (2026-05-06) — keep `fix/bugs-yaml-iter` aligned with master
 * across /fix-bugs runs. The fixup branch persists between runs only on
 * abnormal exits (auto-merge-to-master conflict, orchestrator crash,
 * manual paused.json removal); in the normal happy path closeFixupWorktree
 * deletes it. When it persists across runs, master may have moved forward
 * via operator commits — and per-bug worktrees branched from fixupBranch
 * will be stale.
 *
 * Decision tree:
 *   1. fixupBranch SHA === master SHA               → no-op
 *   2. fixupBranch is BEHIND master (FF possible)   → fast-forward
 *   3. fixupBranch is AHEAD of master (descendant)  → no-op (preserve WIP)
 *   4. fixupBranch + master have diverged           → real merge; on
 *                                                     conflict, abort +
 *                                                     return ok:false
 *
 * Returns `ok: true` on every state where the worktree is usable; ok:false
 * only on case (4) merge conflict OR rev-parse failure.
 */
export function ensureFixupTracksMaster(args: {
  projectRoot: string;
  worktreePath: string;
  baseBranch: string;
}): { ok: true } | { ok: false; reason: string } {
  let masterSha: string;
  let fixupSha: string;
  try {
    masterSha = execSync(`git rev-parse ${shellQuote(args.baseBranch)}`, {
      cwd: args.projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    fixupSha = execSync(`git rev-parse HEAD`, {
      cwd: args.worktreePath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    return {
      ok: false,
      reason: `bug-058: rev-parse failed for ${args.baseBranch} or fixup HEAD: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (masterSha === fixupSha) return { ok: true };

  const isAncestor = (
    cwd: string,
    ancestor: string,
    descendant: string,
  ): boolean => {
    try {
      execSync(
        `git merge-base --is-ancestor ${shellQuote(ancestor)} ${shellQuote(descendant)}`,
        { cwd, stdio: ["ignore", "pipe", "pipe"] },
      );
      return true;
    } catch {
      return false;
    }
  };

  // Case 2: fixup is behind master (master is descendant of fixup).
  if (isAncestor(args.projectRoot, fixupSha, masterSha)) {
    try {
      execSync(`git merge --ff-only ${shellQuote(args.baseBranch)}`, {
        cwd: args.worktreePath,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        reason: `bug-058: fast-forward of fixup branch to ${args.baseBranch} failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // Case 3: fixup is ahead of master (fixup is descendant of master).
  // WIP preserved — no-op. Subsequent merge cascades integrate it later.
  if (isAncestor(args.projectRoot, masterSha, fixupSha)) {
    return { ok: true };
  }

  // Case 4: diverged — real merge. On conflict, abort + surface.
  try {
    execSync(
      `git merge --no-ff ${shellQuote(args.baseBranch)} -m "merge ${args.baseBranch} into fixup (bug-058 stale-base recovery)"`,
      { cwd: args.worktreePath, stdio: ["ignore", "pipe", "pipe"] },
    );
    return { ok: true };
  } catch (err) {
    try {
      execSync(`git merge --abort`, {
        cwd: args.worktreePath,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      // best-effort; merge --abort fails when there's nothing to abort
    }
    return {
      ok: false,
      reason: `bug-058: fixup branch diverged from ${args.baseBranch} AND merge failed: ${err instanceof Error ? err.message : String(err)}. Manually reconcile fix/bugs-yaml-iter with ${args.baseBranch} before re-running /fix-bugs.`,
    };
  }
}

/**
 * feat-046 Phase A.1 (2026-05-05) — per-bug worktree helpers.
 * Used when `ctx.maxConcurrent >= 2`; mirrors `openFixupWorktree`'s
 * pattern but creates an isolated worktree at `.claude/worktrees/<bug-id>/`
 * on a `fix/<bug-id>` branch so parallel bug-fixes don't race on shared
 * filesystem state.
 *
 * The base branch is `args.baseBranch` (default `fix/bugs-yaml-iter` so
 * batch N's per-bug worktrees see batch N-1's already-merged fixes).
 */
function bugWorktreePath(projectRoot: string, bugId: string): string {
  return join(projectRoot, ".claude", "worktrees", bugId);
}
function bugBranchName(bugId: string): string {
  // bug ids already match `bug-(flow|orphan|parity|runtime|compile|coverage)-<slug>`
  // per BugEntrySchema. Use as-is so `git branch --list fix/<bug-id>` is grep-able.
  return `fix/${bugId}`;
}

/**
 * bug-055 Phase A — verify a directory is a registered git worktree, not
 * just a plain directory at the same path. The distinction matters because
 * `existsSync(worktreePath)` returns true for both:
 *   1. A live registered worktree (created by `git worktree add`)
 *   2. An orphan dir left behind by a prior crash / partial cleanup
 *
 * Without this check, openPerBugWorktree silently reuses orphan dirs;
 * subsequent agent dispatch into the orphan resolves git ops to the
 * project's main worktree (master), agent edits never land on the
 * per-bug branch, closePerBugWorktree's empty merge succeeds, and the
 * loop reports a fake "fix landed". See bug-055 root cause analysis.
 */
export function isRegisteredGitWorktree(
  projectRoot: string,
  candidatePath: string,
): boolean {
  let out: string;
  try {
    out = execSync(`git worktree list --porcelain`, {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return false;
  }
  const target = resolve(candidatePath);
  for (const line of out.split("\n")) {
    if (!line.startsWith("worktree ")) continue;
    const registered = resolve(line.slice("worktree ".length).trim());
    if (registered === target) return true;
  }
  return false;
}

export function openPerBugWorktree(args: {
  projectRoot: string;
  bugId: string;
  baseBranch: string;
  /**
   * feat-046 Phase A.2 (2026-05-05) — slot index for per-worktree port
   * isolation. When >= 0, the orchestrator computes
   * `(frontendPort, backendPort) = (3000 + slot*2, 3001 + slot*2)`
   * and injects them into the worktree via:
   *   1. Rewriting `apps/web/playwright.config.ts` (if present) to
   *      hardcode the slot's ports in the `webServer.env` block + the
   *      `use.baseURL` field.
   *   2. Writing `apps/api/.env.local` with `PORT=<backendPort>` etc.
   *      (Already-conventional file; `.env*` is in most project
   *      gitignores.)
   *   3. `git update-index --skip-worktree apps/web/playwright.config.ts`
   *      so the rewrite stays as a per-worktree-local override and
   *      doesn't enter the merge cascade. The flag is per-worktree-
   *      copy of the index; doesn't affect master or other worktrees.
   *
   * When undefined, no env-injection — Strategy A/D projects don't
   * need it. Defaults to undefined so legacy callers + tests don't
   * trip the rewrite path.
   */
  slot?: number;
}):
  | { ok: true; worktreePath: string; branch: string }
  | { ok: false; reason: string } {
  const worktreePath = bugWorktreePath(args.projectRoot, args.bugId);
  const branch = bugBranchName(args.bugId);

  // bug-061 (2026-05-06) — always teardown + recreate. Per-bug worktrees
  // are ephemeral (created at dispatch, supposed to be torn down at
  // closePerBugWorktree). When they survive across sessions (typically
  // because closePerBugWorktree's git-remove hits Windows MAX_PATH —
  // bug-060's lane — leaving the dir + branch persistent), reusing them
  // risks stale-base regression: the worktree sits at fixupBranch HEAD
  // from the PRIOR session, NOT current fixupBranch HEAD. Empirical
  // motivator: reading-log-01 bhs2ki3i6 — backend-builder ran 25 min in
  // a worktree at 0505bf4 (prior session) when current fixupBranch was
  // at 9b3ffe8 with the load-bearing migrate-on-boot fix. Wall-clock
  // aborted with zero commits.
  //
  // Supersedes bug-055 Phase A's orphan-only rm-rf — the orphan case is
  // a subset of "anything pre-existing should be destroyed".
  if (
    existsSync(worktreePath) ||
    isRegisteredGitWorktree(args.projectRoot, worktreePath)
  ) {
    let teardownErr: Error | null = null;
    // Cleanest path: git worktree remove --force.
    try {
      execSync(`git worktree remove --force ${shellQuote(worktreePath)}`, {
        cwd: args.projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (gitErr) {
      // Windows MAX_PATH or other failure — bug-060-style fallback:
      // git worktree prune (unregister) + Node fs.rmSync (NT-API path
      // handles long paths on absolute paths).
      try {
        execSync(`git worktree prune`, {
          cwd: args.projectRoot,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        /* best-effort prune */
      }
      try {
        rmSync(worktreePath, {
          recursive: true,
          force: true,
          maxRetries: 3,
        });
      } catch (rmErr) {
        teardownErr = rmErr instanceof Error ? rmErr : new Error(String(rmErr));
      }
    }
    if (teardownErr) {
      return {
        ok: false,
        reason: `bug-061: per-bug worktree teardown failed for ${worktreePath}: ${teardownErr.message}`,
      };
    }
    // Delete the per-bug branch if it exists. -D forces (in case it
    // has unmerged commits from a prior session that never made it into
    // fixupBranch). Per-bug branches are ephemeral; recreating from
    // fresh baseBranch is safer than reusing.
    try {
      execSync(`git branch -D ${shellQuote(branch)}`, {
        cwd: args.projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      /* branch may not exist; non-fatal */
    }
  }

  // Create fresh worktree from current baseBranch HEAD. (bug-061: always
  // reach this path — bug-055 Phase A's else-branch reuse path is gone.)
  mkdirSync(dirname(worktreePath), { recursive: true });
  try {
    execSync(
      `git worktree add ${shellQuote(worktreePath)} -b ${shellQuote(branch)} ${shellQuote(args.baseBranch)}`,
      { cwd: args.projectRoot, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    return {
      ok: false,
      reason: `git worktree add failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  // Seed hooks/permissions (same pattern as openFixupWorktree).
  const seed = seedWorktree(args.projectRoot, worktreePath);
  if (!seed.ok) {
    return {
      ok: false,
      reason: `per-bug-worktree-seed-failed (${seed.reason}): ${seed.detail}`,
    };
  }
  // feat-046 Phase A.2: per-slot env-injection.
  if (typeof args.slot === "number" && args.slot >= 0) {
    injectSlotEnvIntoWorktree({
      worktreePath,
      slot: args.slot,
    });
  }
  return { ok: true, worktreePath, branch };
}

/**
 * feat-046 Phase A.2 (2026-05-05) — write per-slot env into the per-bug
 * worktree so backends + frontends + Playwright don't collide on shared
 * ports. Idempotent: re-running is safe (just rewrites the same files).
 *
 * Slot-to-port map: slot 0 → (3000, 3001); slot 1 → (3002, 3003); etc.
 * Pool of ports 3000..3000+2N-1 must not collide with operator's other
 * dev-servers; configurable in feat-046 Phase A.3 if needed.
 *
 * Writes:
 *   - apps/api/.env.local — PORT, ENABLE_TEST_SEED, DATABASE_PATH, LOG_LEVEL
 *   - apps/web/.env.local — NEXT_PUBLIC_API_BASE_URL
 *   - apps/web/playwright.config.ts — REWRITE process.env.PORT/etc fallbacks
 *     to the slot's hardcoded ports + apply skip-worktree so the rewrite
 *     doesn't enter the merge cascade.
 *
 * Best-effort: cleanup failures don't fail the per-bug-worktree open.
 * The agent dispatch just runs against a worktree without slot env; it
 * may collide with another slot's backend, surfacing test failures the
 * operator can then triage.
 */
export function injectSlotEnvIntoWorktree(args: {
  worktreePath: string;
  slot: number;
}): void {
  const frontendPort = 3000 + args.slot * 2;
  const backendPort = 3001 + args.slot * 2;
  const apiEnvLocal = join(args.worktreePath, "apps", "api", ".env.local");
  const webEnvLocal = join(args.worktreePath, "apps", "web", ".env.local");
  const playwrightConfig = join(
    args.worktreePath,
    "apps",
    "web",
    "playwright.config.ts",
  );

  // 1. apps/api/.env.local — backend-tier env.
  try {
    mkdirSync(dirname(apiEnvLocal), { recursive: true });
    writeFileSync(
      apiEnvLocal,
      [
        `# feat-046 Phase A.2 — per-slot env (slot ${args.slot})`,
        `# Auto-generated by orchestrator/src/fix-bugs-loop.ts:injectSlotEnvIntoWorktree.`,
        `# Backend's tsx watch reads via dotenv-flow; do not edit by hand.`,
        `PORT=${backendPort}`,
        `ENABLE_TEST_SEED=1`,
        `DATABASE_PATH=./data/finance-track-test-slot${args.slot}.db`,
        `LOG_LEVEL=warn`,
        ``,
      ].join("\n"),
      "utf8",
    );
  } catch {
    /* best-effort */
  }

  // 2. apps/web/.env.local — frontend-tier env.
  try {
    mkdirSync(dirname(webEnvLocal), { recursive: true });
    writeFileSync(
      webEnvLocal,
      [
        `# feat-046 Phase A.2 — per-slot env (slot ${args.slot})`,
        `NEXT_PUBLIC_API_BASE_URL=http://localhost:${backendPort}`,
        `PORT=${frontendPort}`,
        ``,
      ].join("\n"),
      "utf8",
    );
  } catch {
    /* best-effort */
  }

  // 3. apps/web/playwright.config.ts — REWRITE the hardcoded fallbacks.
  // The webServer.env block reads `process.env.PORT ?? "3001"`; we
  // override the literal "3001" / "3000" fallbacks with the slot's
  // ports. Process.env at Playwright run time isn't per-call (parallel
  // dispatches share Node's global), so we MUST hardcode the literal.
  try {
    if (existsSync(playwrightConfig)) {
      const original = readFileSync(playwrightConfig, "utf8");
      let rewritten = original;
      // Replace common patterns. Keep regex narrow + idempotent.
      const replacements: Array<[RegExp, string]> = [
        // PORT fallback: "3001" → slot's backend port
        [
          /(process\.env\[["']PORT["']\]\s*\?\?\s*)["']3001["']/g,
          `$1"${backendPort}"`,
        ],
        // PORT fallback alt syntax: process.env.PORT ?? "3001"
        [/(process\.env\.PORT\s*\?\?\s*)["']3001["']/g, `$1"${backendPort}"`],
        // NEXT_PUBLIC_API_BASE_URL fallback: "http://localhost:3001" → slot's
        [
          /(\s*\?\?\s*)["']http:\/\/localhost:3001["']/g,
          `$1"http://localhost:${backendPort}"`,
        ],
        // baseURL fallback: "http://localhost:3000" → slot's frontend
        [
          /(\s*\?\?\s*)["']http:\/\/localhost:3000["']/g,
          `$1"http://localhost:${frontendPort}"`,
        ],
        // url field on webServer block (rare, but explicit)
        [
          /(url:\s*)["']http:\/\/localhost:3000["']/g,
          `$1"http://localhost:${frontendPort}"`,
        ],
      ];
      for (const [re, replacement] of replacements) {
        rewritten = rewritten.replace(re, replacement);
      }
      if (rewritten !== original) {
        writeFileSync(playwrightConfig, rewritten, "utf8");
        // Skip-worktree so this local rewrite doesn't enter the merge cascade.
        // Per-worktree-copy of the index — doesn't affect master.
        try {
          execSync(
            `git update-index --skip-worktree apps/web/playwright.config.ts`,
            { cwd: args.worktreePath, stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch {
          /* best-effort — without skip-worktree the rewrite would be merged */
        }
      }
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Sequentially merge a per-bug branch into the fixup branch + tear down
 * the per-bug worktree. Called from the per-batch merge cascade after all
 * batch dispatches complete. Returns the merge outcome so the caller can
 * decide whether to mark the bug `completed`/`failed`.
 *
 * bug-054 (2026-05-05): the merge runs in the dedicated fixup-worktree, NOT
 * in projectRoot. Earlier impl ran `git checkout <fixup-branch> + git merge`
 * directly in projectRoot — that broke when sibling stages (verifier
 * failure-artifact writes, synthesizer rewrites of e2e specs) accumulated
 * uncommitted state in projectRoot's working tree between merge attempts.
 * The fixup-worktree is exclusive to the fix-bugs-loop, so its working
 * tree stays clean. Worktree-ref operations (remove + branch -D) still
 * run from projectRoot since refs live in projectRoot's `.git/`.
 *
 * On merge conflict: leaves the worktree + branch intact for operator
 * inspection; surfaces conflict reason via `reason` field. Subsequent
 * batches' merge cascade re-attempts via the next iteration.
 */
export function closePerBugWorktree(args: {
  projectRoot: string;
  fixupWorktreePath: string;
  worktreePath: string;
  branch: string;
  fixupBranch: string;
}): { ok: true } | { ok: false; reason: string } {
  // The fixup-worktree was opened at loop bootstrap on `fixupBranch` and
  // stays checked out there; no `git checkout` needed. Just merge.
  //
  // bug-055 Phase B — capture HEAD before + after to detect empty merges.
  // `git merge --no-ff <branch>` returns exit-0 with "Already up to date"
  // when the branch has no commits ahead of fixupBranch — the loop must
  // NOT read that as "fix landed". HEAD-before === HEAD-after means the
  // agent never committed anything, dispatch is silent-success, return
  // ok: false so the caller can mark the bug pending/failed for retry.
  let beforeHead: string;
  try {
    beforeHead = execSync(`git rev-parse HEAD`, {
      cwd: args.fixupWorktreePath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    return {
      ok: false,
      reason: `pre-merge HEAD capture failed in ${args.fixupWorktreePath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  try {
    execSync(
      `git merge --no-ff ${shellQuote(args.branch)} -m "merge ${args.branch} into ${args.fixupBranch} (fix-bugs-loop parallel)"`,
      { cwd: args.fixupWorktreePath, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    // Abort the merge to leave fixup-branch in a clean state.
    try {
      execSync(`git merge --abort`, {
        cwd: args.fixupWorktreePath,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      // best-effort
    }
    return {
      ok: false,
      reason: `merge ${args.branch} into ${args.fixupBranch} (in fixup worktree) failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // bug-055 Phase B — empty-merge guard.
  let afterHead: string;
  try {
    afterHead = execSync(`git rev-parse HEAD`, {
      cwd: args.fixupWorktreePath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    return {
      ok: false,
      reason: `post-merge HEAD capture failed in ${args.fixupWorktreePath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (beforeHead === afterHead) {
    return {
      ok: false,
      reason: `empty-merge: ${args.branch} produced 0 commits ahead of ${args.fixupBranch} — agent dispatched but did not commit any work (HEAD ${beforeHead.slice(0, 7)} unchanged)`,
    };
  }

  // Tear down the per-bug worktree + branch — worktree refs live in
  // projectRoot's `.git/worktrees/` so these ops run from projectRoot
  // regardless of where the merge happened.
  //
  // bug-055 Cross-cutting — cleanup failures are now noisy. Silent
  // catch was the mechanism by which orphan dirs accumulate in the
  // first place. Surface the failure so operators (and the next
  // openPerBugWorktree call's orphan-recovery path) see it.
  try {
    execSync(`git worktree remove --force ${shellQuote(args.worktreePath)}`, {
      cwd: args.projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    execSync(`git branch -D ${shellQuote(args.branch)}`, {
      cwd: args.projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // bug-060 (2026-05-06) — Windows MAX_PATH fallback. `git worktree
    // remove --force` shells to Win32 file APIs without the `\\?\`
    // long-path prefix, so deep node_modules paths past 260 chars
    // fail with "Filename too long". Fall back to git-prune (cheap;
    // unregisters from metadata) + Node's fs.rmSync (which uses NT API
    // on absolute paths and handles long paths). On both-failed,
    // surface the original WARNING.
    if (
      process.platform === "win32" &&
      /Filename too long|path too long/i.test(msg)
    ) {
      try {
        execSync(`git worktree prune`, {
          cwd: args.projectRoot,
          stdio: ["ignore", "pipe", "pipe"],
        });
        rmSync(args.worktreePath, {
          recursive: true,
          force: true,
          maxRetries: 3,
        });
        try {
          execSync(`git branch -D ${shellQuote(args.branch)}`, {
            cwd: args.projectRoot,
            stdio: ["ignore", "pipe", "pipe"],
          });
        } catch {
          // Branch may have been auto-cleaned during prune; non-fatal.
        }
        // Recovery succeeded — no warning needed.
      } catch (rmErr) {
        process.stderr.write(
          `[fix-bugs-loop] WARNING: per-bug worktree cleanup for ${args.branch} failed (Windows MAX_PATH); ` +
            `git remove + fs.rmSync fallback both failed. Dir at ${args.worktreePath} persists as orphan. ` +
            `bug-055 Phase A will recover on next /fix-bugs run. Detail: ${rmErr instanceof Error ? rmErr.message : String(rmErr)}\n`,
        );
      }
    } else {
      process.stderr.write(
        `[fix-bugs-loop] WARNING: per-bug worktree cleanup for ${args.branch} failed; ` +
          `dir at ${args.worktreePath} may persist as orphan. Detail: ${msg}\n`,
      );
    }
    // Don't fail the close — merge already landed on fixup branch.
  }
  return { ok: true };
}

/**
 * Tear down the shared fixup worktree at loop exit. Best-effort — leaves
 * a warning on the result rather than throwing (the loop's bug outcomes
 * are the actual source of truth, not the worktree state).
 */
function closeFixupWorktree(args: {
  projectRoot: string;
  worktreePath: string;
  branch: string;
  mergeFirst: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (!existsSync(args.worktreePath)) return { ok: true };
  try {
    // bug-027: remove worktree FIRST. Empirically observed: when the
    // fixup worktree has the fix branch checked out, `git merge --no-ff
    // <branch>` from projectRoot fails with "branch is checked out
    // elsewhere" — silently swallowed by the prior try/catch, leaving
    // master without the fixes. Removing the worktree releases the
    // branch and lets the merge succeed.
    execSync(`git worktree remove --force ${shellQuote(args.worktreePath)}`, {
      cwd: args.projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (args.mergeFirst) {
      // Attempt to merge fixup branch back to master after worktree release.
      try {
        execSync(
          `git merge --no-ff ${shellQuote(args.branch)} -m "merge ${args.branch} (fix-bugs-loop)"`,
          { cwd: args.projectRoot, stdio: ["ignore", "pipe", "pipe"] },
        );
      } catch (mergeErr) {
        // Conflict or no commits — surface as warning instead of silent
        // (bug-027 root cause: prior code swallowed merge errors entirely,
        // operators only noticed when checking master HEAD post-run).
        const detail =
          mergeErr instanceof Error ? mergeErr.message : String(mergeErr);
        process.stderr.write(
          `[fix-bugs-loop] WARNING: auto-merge of ${args.branch} failed; fixes remain on the branch. Run \`git merge --no-ff ${args.branch}\` manually. Detail: ${detail}\n`,
        );
      }
    }
    try {
      execSync(`git branch -D ${shellQuote(args.branch)}`, {
        cwd: args.projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      /* branch may have been merged + auto-cleaned, or merge failed and
       operator wants to keep it for manual recovery */
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Comparator: P0 > P1 > P2; within tier, the cascade-root sources sort
 * FIRST (feat-027): dev-server-compile + runtime-error typically mask every
 * downstream flow failure, so the loop fixes them before chasing dependent
 * timeouts. After cascade-roots: orphan → flow → coverage. Visual-parity
 * (feat-028) sits between orphan and flow since a stripped-shell breaks
 * every assertion downstream.
 */
function bugPriorityComparator(a: BugEntry, b: BugEntry): number {
  const sevOrder = { P0: 0, P1: 1, P2: 2 } as const;
  const sevDelta = sevOrder[a.severity] - sevOrder[b.severity];
  if (sevDelta !== 0) return sevDelta;
  const sourceOrder: Record<BugEntry["source"], number> = {
    "dev-server-compile": 0, // feat-027 — page literally won't render
    "runtime-error": 1, // feat-027 — JS error prevents interaction
    "reachability-orphan": 2,
    "visual-parity": 3, // feat-028 — DOM-skeleton / computed-style mismatch
    "perceptual-divergence": 4, // feat-068 — vision-LLM finding (post-parity)
    "flow-execution-failure": 5,
    "pm-coverage-omission": 6,
  };
  return sourceOrder[a.source] - sourceOrder[b.source];
}

/**
 * Build the `retryContext.errorMessage` string handed to the dispatched
 * agent. Carries the bug summary + (when present) the screenshot path +
 * the suggested integration point so the builder doesn't have to
 * re-derive context from scratch.
 */
/**
 * investigate-023 M-D — post-tester anti-pattern audit.
 *
 * Wraps `scripts/audit-tester-diff.mjs` (CLI helper that diffs HEAD~1..HEAD
 * in the worktree + scans for the 6 disqualifying anti-patterns from
 * `.claude/rules/testing-policy.md §"Anti-patterns that DISQUALIFY
 * interpretive-latitude excuse"`). Returns the empty array when the
 * tester's commit is clean OR when the audit script can't be loaded
 * (graceful degradation — older projects without the script keep
 * working).
 *
 * Empirical anchor: reading-log-01 commit b83e39a (flow-3 spec) — caught
 * `const BOOK_ID = "1001"` (seed-data-shape) + the tester's own
 * "Number(id) conversion" comment (type-coercion-fixture). The audit's
 * exit code 1 + JSON output translate into AntiPatternFinding[].
 */
async function auditTesterCommit(worktreeDir: string): Promise<
  Array<{
    kind: string;
    file: string;
    evidence: string;
    lineNumber: number;
    explanation: string;
  }>
> {
  // Resolve scripts/audit-tester-diff.mjs relative to the orchestrator's
  // factory root. Use pathToFileURL so the dynamic import works on Windows
  // (raw `file://${path}` produces 2-slash URLs that don't load on Win).
  // ESM context — __dirname doesn't exist; derive from import.meta.url
  // (this file lives at orchestrator/src/fix-bugs-loop.ts; ../../ → factory root).
  const here = dirname(fileURLToPath(import.meta.url));
  const factoryRoot = resolve(here, "..", "..");
  const scriptPath = resolve(factoryRoot, "scripts", "audit-tester-diff.mjs");
  if (!existsSync(scriptPath)) return [];
  try {
    const mod = (await import(pathToFileURL(scriptPath).href)) as {
      auditTesterDiffFromGit: (args: {
        worktreeDir: string;
        oldRef?: string;
        newRef?: string;
      }) => Promise<
        Array<{
          kind: string;
          file: string;
          evidence: string;
          lineNumber: number;
          explanation: string;
        }>
      >;
    };
    return await mod.auditTesterDiffFromGit({ worktreeDir });
  } catch {
    // graceful degradation — audit failure should NOT crash the loop
    return [];
  }
}

function buildRetryContextMessage(bug: BugEntry): string {
  const lines: string[] = [];
  lines.push(`Bug ${bug.id} (iteration ${bug.iteration}): ${bug.summary}`);
  if (bug.flow) {
    // bug-039 (2026-05-02): expectedScreenId is nullable for v2.0 synth path.
    lines.push(
      `  Flow ${bug.flow.id} step ${bug.flow.failedStep}: clicked ${bug.flow.selector ?? "(no selector)"} on ${bug.flow.expectedScreenId ?? "(unknown screen)"}; landed on ${bug.flow.actualScreenId ?? "(no screen-id)"}`,
    );
    if (bug.flow.screenshot) lines.push(`  Screenshot: ${bug.flow.screenshot}`);
    if (bug.flow.htmlDump) lines.push(`  HTML dump: ${bug.flow.htmlDump}`);
  }
  if (bug.orphan) {
    lines.push(
      `  Orphan: ${bug.orphan.componentPath} exports ${(bug.orphan.exportNames ?? []).join(", ") || "(default)"}`,
    );
    if ((bug.orphan.suggestedImporters ?? []).length > 0) {
      lines.push(
        `  Suggested integration points: ${bug.orphan.suggestedImporters.slice(0, 3).join(", ")}`,
      );
    }
  }
  if (bug.bugPlanPath) lines.push(`  Plan: ${bug.bugPlanPath}`);
  if ((bug.errorLog ?? []).length > 0) {
    lines.push(`  Prior attempts:`);
    for (const e of bug.errorLog.slice(-3)) lines.push(`    - ${e}`);
  }
  return lines.join("\n");
}

/**
 * feat-053 (2026-05-05) — group dispatchable bugs by parity pattern so
 * class-uniform fixes (e.g. 22 shell-stripping bugs all needing the same
 * `<AppShell>` wrap) collapse into ONE builder dispatch instead of N.
 *
 * Group keys:
 *   - `pattern:shell-stripping`, `pattern:layout-regrouping`,
 *     `pattern:variant-drift`, `pattern:token-drift` (when ≥ 2 bugs share
 *     the pattern)
 *   - `__singleton__<bug-id>` for everything else (single-bug parity
 *     groups, flow-execution-failure, runtime-error, orphan-component, etc.)
 *
 * Single-bug groups flow through the existing per-bug-worktree path
 * (feat-046 Phase A); only multi-bug groups use the batched path.
 *
 * Pure function (no side effects); easy to test in isolation.
 */
export function groupDispatchableBugsByPattern(
  bugs: readonly BugEntry[],
): Map<string, BugEntry[]> {
  // Pass 1: tentative grouping by pattern (or singleton).
  const tentative = new Map<string, BugEntry[]>();
  for (const bug of bugs) {
    const pattern = bug.parity?.pattern;
    if (!pattern) {
      tentative.set(`__singleton__${bug.id}`, [bug]);
      continue;
    }
    const key = `pattern:${pattern}`;
    const existing = tentative.get(key) ?? [];
    existing.push(bug);
    tentative.set(key, existing);
  }
  // Pass 2: demote single-bug parity groups to singletons (no batching
  // benefit for size-1; the dispatch shape diverges for no reason).
  const out = new Map<string, BugEntry[]>();
  for (const [key, group] of tentative) {
    if (key.startsWith("pattern:") && group.length === 1) {
      out.set(`__singleton__${group[0]!.id}`, [group[0]!]);
    } else {
      out.set(key, group);
    }
  }
  return out;
}

/**
 * feat-053 — dispatch one agent_sequence against a GROUP of N same-pattern
 * bugs in a single per-pattern worktree. Mirrors dispatchAgentsForBug's
 * shape but synthesizes a multi-bug retryContext that lists all N bug-ids
 * + summaries for the builder to mechanically apply the same fix shape.
 *
 * v1 design choices:
 *  - One worktree per pattern-group (not per-bug) — names it
 *    `bug-pattern-<X>-batch` so the existing openPerBugWorktree helper
 *    can host it without further changes (it only cares about the dir
 *    name, not whether it's a single bug or a batch).
 *  - One web-frontend-builder + one tester + one reviewer pass.
 *  - On success: every bug in the group is marked completed in a single
 *    bugs.yaml write at batch end.
 *  - On failure: every bug in the group has the failure logged + moves
 *    to pending (or failed if attempts >= maxAttempts).
 *  - Tester is NOT skipped — class-uniform fix shape DOESN'T guarantee
 *    class-uniform application; tester catches "builder missed 1 of 22".
 */
async function dispatchAgentsForPatternGroup(args: {
  bugs: BugEntry[];
  pattern: string;
  ctx: FixBugsLoopContext;
  worktreeCwd: string;
}): Promise<{ success: boolean; costUsd: number; errorLog: string[] }> {
  const { bugs, pattern, ctx, worktreeCwd } = args;
  let costUsd = 0;
  const errorLog: string[] = [];
  // featureContext.id is synthetic — used by invokeAgent for telemetry +
  // featureContext.branch is consumed by the agent prompt builder. Use a
  // stable shape that downstream tooling can pattern-match if needed.
  const featureContext = {
    id: `pattern-${pattern}-batch-of-${bugs.length}`,
    branch: ctx.fixupBranchName ?? "fix/bugs-yaml-iter",
    priority: bugs[0]!.severity, // groups share severity (same pattern → same severity)
  };

  const baseTask = {
    depends_on: [] as string[],
    skills: [] as string[],
    status: "pending" as const,
    screens: [] as string[],
    summary: `Apply ${pattern} fix to ${bugs.length} screens: ${bugs
      .map((b) => b.parity?.screen ?? b.id)
      .slice(0, 5)
      .join(", ")}${bugs.length > 5 ? `, ... (${bugs.length - 5} more)` : ""}`,
  };

  const agentSequence = bugs[0]!.agentSequence;
  // bug-082 (2026-05-11) — capture HEAD BEFORE the batched agent sequence;
  // same unverified-completion guard as dispatchAgentsForBug. Empirical
  // motivator is the same: reading-log-02 2026-05-11 saw 7 single-bug
  // dispatches mark completed with zero commits; the batched path has the
  // same trust-the-agent shape + would exhibit the same false-positive.
  const headBeforeBatch = readGitHeadSafe(worktreeCwd);

  for (const agent of agentSequence) {
    if (agent === "git-agent") continue;
    const syntheticTask = {
      id: `pattern-${pattern}-batch-${agent}`,
      agent,
      ...baseTask,
    };
    const result = await ctx.invokeAgent({
      agent,
      cwd: worktreeCwd,
      featureContext,
      tasks: [syntheticTask],
      retryContext: {
        taskId: syntheticTask.id,
        errorMessage: buildBatchedRetryContextMessage(bugs, pattern),
      },
    });
    costUsd += result.costUsd;
    const taskOutcome = result.taskStatus[syntheticTask.id];
    if (taskOutcome !== "completed") {
      errorLog.push(
        `[${agent}] ${result.errors[syntheticTask.id] ?? "agent did not return success"} (pattern-batch ${pattern}; ${bugs.length} bugs)`,
      );
      return { success: false, costUsd, errorLog };
    }
    // investigate-023 M-D — post-tester anti-pattern audit. When the
    // tester's diff includes seed-data manipulation, type-coercion
    // fixtures, etc. (the 6 anti-patterns in
    // `.claude/rules/testing-policy.md`), reject the "test fixed"
    // outcome — the failing test was masking a product bug, not test-
    // authoring noise. Force the loop to retry (which gives the tester
    // another shot at flagging via genuineProductBugs[]).
    if (agent === "tester") {
      const findings = await auditTesterCommit(worktreeCwd);
      if (findings.length > 0) {
        errorLog.push(
          `[tester-anti-pattern-detected] ${findings.length} M-D anti-pattern(s) in tester's diff: ${findings
            .map((f) => `${f.kind} (${f.file}:${f.lineNumber})`)
            .join(
              ", ",
            )} — see investigate-023; tester should flag genuineProductBugs[] instead of working around the build's bug`,
        );
        return { success: false, costUsd, errorLog };
      }
    }
  }

  // bug-082 (2026-05-11) — unverified-completion guard for the batched
  // path. Mirror of the per-bug path's check (see dispatchAgentsForBug).
  if (headBeforeBatch !== null) {
    const headAfterBatch = readGitHeadSafe(worktreeCwd);
    if (headAfterBatch === null) {
      // git went away mid-dispatch (unusual). Skip guard.
    } else if (headAfterBatch === headBeforeBatch) {
      errorLog.push(
        `[unverified-completion] batched agent(s) [${agentSequence.join(", ")}] returned taskOutcomes:completed but HEAD did not advance (${headBeforeBatch.slice(0, 8)} === ${headAfterBatch.slice(0, 8)}); no commit produced for pattern-batch ${pattern} (${bugs.length} bugs) — treating as silent-failure (bug-082)`,
      );
      return { success: false, costUsd, errorLog };
    } else {
      const changedPaths = gitDiffPaths(
        worktreeCwd,
        headBeforeBatch,
        headAfterBatch,
      );
      if (changedPaths !== null && !diffContainsSourceChange(changedPaths)) {
        errorLog.push(
          `[unverified-completion] batched agent(s) [${agentSequence.join(", ")}] committed but only touched bookkeeping paths (${changedPaths.join(", ")}) for pattern-batch ${pattern}; no source change — treating as silent-failure (bug-082)`,
        );
        return { success: false, costUsd, errorLog };
      }
    }
  }

  return { success: true, costUsd, errorLog };
}

/**
 * Build the retryContext.errorMessage for a class-batched dispatch.
 * Lists every bug in the group with its screen + per-bug summary so the
 * builder can mechanically apply the same fix shape across all N.
 */
function buildBatchedRetryContextMessage(
  bugs: readonly BugEntry[],
  pattern: string,
): string {
  const lines: string[] = [];
  lines.push(
    `BATCHED FIX — ${bugs.length} bugs share pattern '${pattern}'. Apply the same fix shape to ALL ${bugs.length} affected files in a single pass.`,
  );
  lines.push("");
  lines.push("Affected screens + per-bug detail:");
  for (const bug of bugs) {
    const screen = bug.parity?.screen ?? "(unknown)";
    lines.push(`  - ${bug.id}: screen=${screen}, summary=${bug.summary}`);
    if (bug.bugPlanPath) {
      lines.push(`      Plan: ${bug.bugPlanPath}`);
    }
  }
  lines.push("");
  lines.push(
    `Read each plan body for per-screen detail. Apply the fix mechanically across all ${bugs.length} files; tester will verify per-screen on the next agent in the sequence.`,
  );
  return lines.join("\n");
}

/**
 * Run agent_sequence sequentially against a single bug in the fixup
 * worktree. Returns success once every agent completes; on first agent
 * failure aborts + logs to bug.errorLog, leaving the bug pending for
 * a future attempt (or for the loop's post-attempt cap check).
 */
async function dispatchAgentsForBug(args: {
  bug: BugEntry;
  ctx: FixBugsLoopContext;
  worktreeCwd: string;
}): Promise<{ success: boolean; costUsd: number; errorLog: string[] }> {
  const { bug, ctx, worktreeCwd } = args;
  let costUsd = 0;
  const errorLog: string[] = [];
  const featureContext = {
    id: bug.id,
    branch: ctx.fixupBranchName ?? "fix/bugs-yaml-iter",
    priority: bug.severity,
  };

  // Synthetic task — bug-fix work isn't expressed as a tasks.yaml task,
  // but the InvokeAgentFn contract takes a Task[] so we synthesize one
  // matching the bug shape. agent + id mirror the bug's identity.
  const syntheticTaskBase = {
    depends_on: [] as string[],
    skills: [] as string[],
    status: "pending" as const,
    screens: [] as string[],
    summary: bug.summary,
  };

  // feat-063 (2026-05-08) — pre-load fix-site / spec / mockup files
  // ONCE per bug + thread through every agent in the sequence. Same
  // envelope across the (typically) single web/backend-frontend-builder
  // dispatch; if the agent sequence has multiple agents (legacy paths),
  // they all benefit from the same pre-load. See investigate-024 §F1+F3.
  const preLoadEnvelope = buildBugContextEnvelope({
    bug,
    projectRoot: worktreeCwd,
  });

  // bug-082 (2026-05-11) — capture HEAD BEFORE dispatching the agent
  // sequence so we can verify the agent actually produced a commit when
  // it self-reports taskOutcomes:completed. Empirical reading-log-02
  // 2026-05-11: 7 of 21 bugs marked completed despite ZERO commits.
  // The orchestrator was trusting the agent's word; this guard requires
  // evidence-of-fix before accepting completion.
  const headBeforeDispatch = readGitHeadSafe(worktreeCwd);

  for (const agent of bug.agentSequence) {
    if (agent === "git-agent") continue; // worktree lifecycle is loop-owned
    const syntheticTask = {
      id: `${bug.id}-${agent}`,
      agent,
      ...syntheticTaskBase,
    };
    const result = await ctx.invokeAgent({
      agent,
      cwd: worktreeCwd,
      featureContext,
      tasks: [syntheticTask],
      retryContext: {
        taskId: syntheticTask.id,
        errorMessage: buildRetryContextMessage(bug),
      },
      ...(preLoadEnvelope.text.length > 0
        ? { preLoadedContext: preLoadEnvelope.text }
        : {}),
    });
    costUsd += result.costUsd;
    const taskOutcome = result.taskStatus[syntheticTask.id];
    if (taskOutcome !== "completed") {
      errorLog.push(
        `[${agent}] ${result.errors[syntheticTask.id] ?? "agent did not return success"}`,
      );
      return { success: false, costUsd, errorLog };
    }
    // investigate-023 M-D — post-tester anti-pattern audit (per-bug path).
    // Mirrors the batched-dispatch hook above. Rejects "test fixed"
    // outcomes when the tester's diff masks a product bug via the 6
    // disqualifying anti-patterns. Forces the loop to retry the agent
    // sequence so the tester can flag via genuineProductBugs[] instead.
    if (agent === "tester") {
      const findings = await auditTesterCommit(worktreeCwd);
      if (findings.length > 0) {
        errorLog.push(
          `[tester-anti-pattern-detected] ${findings.length} M-D anti-pattern(s) in tester's diff: ${findings
            .map((f) => `${f.kind} (${f.file}:${f.lineNumber})`)
            .join(
              ", ",
            )} — see investigate-023; tester should flag genuineProductBugs[] instead of working around the build's bug`,
        );
        return { success: false, costUsd, errorLog };
      }
    }
  }

  // bug-082 (2026-05-11) — unverified-completion guard. Every agent in the
  // sequence reported taskOutcomes:completed (we returned early otherwise
  // above). Now verify that SOMETHING actually got committed. Without this
  // check, agents that honestly determine "nothing to fix" OR agents that
  // give up under wall-clock pressure both look identical to "fixed it".
  //
  // The guard is best-effort: if git state can't be read (no repo, detached
  // HEAD, etc.), the guard silently skips so we don't introduce false
  // negatives. The orchestrator's end-of-iteration verify still catches
  // false-positive completions at the cost of one more iteration — this
  // guard just makes the failure-mode visible at dispatch time instead.
  if (headBeforeDispatch !== null) {
    const headAfterDispatch = readGitHeadSafe(worktreeCwd);
    if (headAfterDispatch === null) {
      // git went away mid-dispatch (unusual). Skip guard.
    } else if (headAfterDispatch === headBeforeDispatch) {
      errorLog.push(
        `[unverified-completion] agent(s) [${bug.agentSequence.join(", ")}] returned taskOutcomes:completed but HEAD did not advance (${headBeforeDispatch.slice(0, 8)} === ${headAfterDispatch.slice(0, 8)}); no commit produced — treating as silent-failure (bug-082)`,
      );
      return { success: false, costUsd, errorLog };
    } else {
      const changedPaths = gitDiffPaths(
        worktreeCwd,
        headBeforeDispatch,
        headAfterDispatch,
      );
      if (changedPaths !== null && !diffContainsSourceChange(changedPaths)) {
        errorLog.push(
          `[unverified-completion] agent(s) [${bug.agentSequence.join(", ")}] committed but only touched bookkeeping paths (${changedPaths.join(", ")}); no source change — treating as silent-failure (bug-082)`,
        );
        return { success: false, costUsd, errorLog };
      }
    }
  }

  return { success: true, costUsd, errorLog };
}

/**
 * Detect new bugs in the latest verify output that aren't already in
 * bugs.yaml. The verifier appends them to bugs.yaml automatically (via
 * `scripts/file-bug-plan.mjs` → `appendBugToYaml`); this returns the ids
 * for the iteration-summary breakdown.
 */
function detectNewBugIds(
  preVerifyIds: ReadonlySet<string>,
  postVerifyDoc: BugsYaml,
): string[] {
  const out: string[] = [];
  for (const b of postVerifyDoc.bugs) {
    if (!preVerifyIds.has(b.id)) out.push(b.id);
  }
  return out;
}

/**
 * Detect bugs that were `completed` last iteration but reappeared this
 * iteration. Flapping protection bumps `flapResets` and resets `attempts`
 * to 0; on `flapResets >= maxFlapResets`, the bug is marked `failed`.
 */
function applyFlappingDetection(args: {
  pre: ReadonlyMap<string, BugEntry>;
  post: BugsYaml;
  maxFlapResets: number;
}): { reappeared: string[]; flapEscalated: string[] } {
  const reappeared: string[] = [];
  const flapEscalated: string[] = [];
  for (const b of args.post.bugs) {
    const prior = args.pre.get(b.id);
    if (!prior) continue;
    if (prior.status === "completed" && b.status !== "completed") {
      reappeared.push(b.id);
      b.flapResets = (b.flapResets ?? 0) + 1;
      if (b.flapResets >= args.maxFlapResets) {
        b.status = "failed";
        b.errorLog.push(
          `flapping-detector: bug reappeared ${b.flapResets} times across iterations; escalating to failed`,
        );
        flapEscalated.push(b.id);
      } else {
        b.status = "pending";
        b.attempts = 0;
        b.errorLog.push(
          `flapping-detector: bug reappeared after iteration ${prior.resolvedInIteration ?? prior.iteration}; resetting attempts (flapResets=${b.flapResets})`,
        );
      }
    }
  }
  return { reappeared, flapEscalated };
}

/**
 * bug-073 Phase B (2026-05-08) — convergence detector.
 *
 * Detects when consecutive failed attempts produce identical (or
 * near-identical) errorLog entries, signalling that the orchestrator is
 * hitting the same wall with no forward progress. Escalates the bug to
 * `failed` early, before exhausting its maxAttempts cap.
 *
 * Empirical motivator: reading-log-02 /fix-bugs run b0e1281c showed 5 of
 * 6 flow-failure bugs producing byte-identical errorLog entries across
 * attempts (e.g. `[per-bug-merge-cascade-failed] merge fix/... failed: ...`
 * repeating verbatim). Each consumed its full 3-attempt cap = ~30min wall-
 * clock per bug = ~2.5hr per /fix-bugs run on this class. This detector
 * saves the marginal ~10min/bug spent on a known-dead-end retry.
 *
 * Heuristic: 2 consecutive identical (or first-200-chars-identical)
 * errorLog entries = converged. False-positive risk is low — even when
 * the underlying root cause is environmental (port collision, EBUSY,
 * merge conflict) rather than algorithmic, more retries don't help and
 * an operator escalation is the right next step.
 *
 * Cross-references:
 *   - plans/active/bug-073-fix-bugs-loop-cant-fix-flow-bugs-without-feat-050.md §Phase B
 *   - feat-050 (the structural fix this complements; ships in parallel)
 */
function detectConvergedFailure(bug: BugEntry): {
  converged: boolean;
  reason: string;
} {
  const entries = bug.errorLog;
  if (entries.length < 2) return { converged: false, reason: "" };
  const a = entries[entries.length - 1] ?? "";
  const b = entries[entries.length - 2] ?? "";
  if (a === b && a.length > 0) {
    return {
      converged: true,
      reason: `last 2 errorLog entries byte-identical: ${a.slice(0, 80).replace(/\n/g, " ")}${a.length > 80 ? "..." : ""}`,
    };
  }
  // Permissive: first 200 chars match. Catches messages with trailing
  // pid / timestamp / counter variation but identical failure shape.
  const NEAR_PREFIX = 200;
  if (
    a.length >= NEAR_PREFIX &&
    b.length >= NEAR_PREFIX &&
    a.slice(0, NEAR_PREFIX) === b.slice(0, NEAR_PREFIX)
  ) {
    return {
      converged: true,
      reason: `last 2 errorLog entries near-identical (first ${NEAR_PREFIX} chars match): ${a.slice(0, 80).replace(/\n/g, " ")}...`,
    };
  }
  return { converged: false, reason: "" };
}

/**
 * Transition a bug after a failed dispatch attempt. Mutates `bug.status`
 * (and possibly `bug.errorLog`) and returns the resulting status so the
 * caller can update its `failedCount` tally.
 *
 * Order of escalation:
 *   1. Convergence detected (bug-073) → `failed` (saves a retry slot)
 *   2. attempts >= maxAttempts → `failed` (existing cap)
 *   3. Otherwise → `pending` (next iteration will retry)
 */
function transitionFailedDispatch(bug: BugEntry): "failed" | "pending" {
  const conv = detectConvergedFailure(bug);
  if (conv.converged) {
    bug.errorLog.push(
      `[bug-073-convergence-detector] ${conv.reason} — escalating to failed without exhausting maxAttempts cap (saved ${bug.maxAttempts - bug.attempts} retry slot${bug.maxAttempts - bug.attempts === 1 ? "" : "s"})`,
    );
    bug.status = "failed";
    return "failed";
  }
  if (bug.attempts >= bug.maxAttempts) {
    bug.status = "failed";
    return "failed";
  }
  bug.status = "pending";
  return "pending";
}

/**
 * The main loop. See plan §Phase B for the spec; this implementation
 * matches the pseudocode there with the worktree-lifecycle decisions
 * called out in the file-level docstring above.
 */
export async function runFixBugsLoop(
  ctx: FixBugsLoopContext,
): Promise<FixBugsLoopResult> {
  const bugsYamlPath = ctx.bugsYamlPath ?? defaultBugsYamlPath(ctx.projectRoot);
  const iterationCap = ctx.iterationCap ?? 5;
  const maxFlapResets = ctx.maxFlapResets ?? 3;
  const worktreePath = resolve(
    ctx.fixupWorktreePath ?? defaultFixupWorktreePath(ctx.projectRoot),
  );
  const fixupBranch = ctx.fixupBranchName ?? "fix/bugs-yaml-iter";
  const skipWorktreeManagement =
    ctx.skipWorktreeManagement ??
    (process.env.NODE_ENV === "test" || process.env.VITEST !== undefined);

  const iterationLog: IterationSummary[] = [];
  let totalCostUsd = 0;
  let finalVerify: BuildToSpecVerifyOutput | undefined;

  let doc = readBugsYaml(bugsYamlPath);
  if (!doc) {
    return {
      status: "no-bugs",
      iterationsRun: 0,
      bugsResolved: [],
      bugsFailed: [],
      bugsRemaining: [],
      totalCostUsd: 0,
      iterationLog: [],
    };
  }
  if (doc.bugs.length === 0) {
    return {
      status: "no-bugs",
      iterationsRun: 0,
      bugsResolved: [],
      bugsFailed: [],
      bugsRemaining: [],
      totalCostUsd: 0,
      iterationLog: [],
    };
  }

  // Open the shared fixup worktree once at loop entry. We keep it open
  // across all iterations so per-iteration verify sees the accumulated
  // fixes (well, after each iteration's merge — see end-of-iteration
  // step below).
  if (!skipWorktreeManagement) {
    const open = openFixupWorktree({
      projectRoot: ctx.projectRoot,
      worktreePath,
      branch: fixupBranch,
      baseBranch: ctx.baseBranchName ?? "master",
    });
    if (!open.ok) {
      return {
        status: "all-bugs-failed",
        iterationsRun: 0,
        bugsResolved: [],
        bugsFailed: doc.bugs.map((b) => b.id),
        bugsRemaining: [],
        totalCostUsd: 0,
        iterationLog: [],
      };
    }
  }
  const worktreeCwd = skipWorktreeManagement ? ctx.projectRoot : worktreePath;

  let status: FixBugsLoopResult["status"] = "iteration-cap-hit";
  let iteration = doc.iteration;

  for (let i = 0; i < iterationCap; i++) {
    iteration = doc.iteration;
    const iterationStartCost = totalCostUsd;
    // Pick pending OR in-progress (resumed mid-attempt) bugs whose
    // attempts haven't hit their cap. Treat in-progress as pending: the
    // prior attempt either crashed or was killed mid-flight, so we get a
    // fresh attempt subject to the same cap.
    const pendingThisIter = [...doc.bugs]
      .filter(
        (b) =>
          (b.status === "pending" || b.status === "in-progress") &&
          (b.attempts ?? 0) < b.maxAttempts,
      )
      .sort(bugPriorityComparator);

    if (pendingThisIter.length === 0) {
      // No work to do. If the loop hasn't run a verify yet AND every bug
      // is already completed, treat as clean.
      const anyFailed = doc.bugs.some((b) => b.status === "failed");
      const anyPending = doc.bugs.some((b) => b.status === "pending");
      if (!anyFailed && !anyPending) {
        status = "clean";
      } else if (anyFailed && !anyPending) {
        status = "all-bugs-failed";
      } else {
        status = "iteration-cap-hit";
      }
      break;
    }

    let attemptedCount = 0;
    let completedCount = 0;
    let failedCount = 0;

    // First pass: mark skip-dispatch bugs (manifest-author with empty
    // agentSequence) up-front. ONE bugs.yaml write covers all skips.
    let anyMarkedNeedsReview = false;
    const dispatchableBugs: BugEntry[] = [];
    for (const bug of pendingThisIter) {
      if (!bug.agentSequence || bug.agentSequence.length === 0) {
        bug.status = "needs-operator-review";
        anyMarkedNeedsReview = true;
        continue;
      }
      dispatchableBugs.push(bug);
    }
    if (anyMarkedNeedsReview) {
      writeBugsYaml(bugsYamlPath, doc);
    }

    // feat-046 Phase A.1 (2026-05-05): branch on maxConcurrent.
    //   maxConcurrent === 1 (default) → existing sequential single-worktree
    //   maxConcurrent >= 2 → per-bug-worktree batched dispatch via Promise.all
    //
    // bug-059 Phase A (2026-05-06): clamp at 3 due to H4 (event-loop
    // starvation under parallel SDK dispatch). Empirical reading-log-01:
    // maxConcurrent=5 caused 5-17 keepalive ticks dropped (drift
    // 156-509s past configured deadline). 3-way concurrency keeps the
    // event loop responsive enough for timer-callback fidelity.
    // Operators can lift the cap via FIX_BUGS_MAXCONCURRENT_OVERRIDE env
    // var (no clamp) for empirical experimentation. Phase B's polling
    // wall-clock timer + Phase C's worker-thread keepalive (deferred)
    // will eventually allow the cap to lift safely.
    const maxConcurrentRequested = ctx.maxConcurrent ?? 1;
    const maxConcurrentCap =
      process.env.FIX_BUGS_MAXCONCURRENT_OVERRIDE !== undefined
        ? Number(process.env.FIX_BUGS_MAXCONCURRENT_OVERRIDE)
        : 3;
    const maxConcurrent = Math.min(maxConcurrentRequested, maxConcurrentCap);
    if (maxConcurrentRequested > maxConcurrentCap) {
      process.stderr.write(
        `[fix-bugs-loop] WARNING: maxConcurrent=${maxConcurrentRequested} clamped to ${maxConcurrentCap} ` +
          `(bug-059: H4 event-loop starvation under parallel dispatch). Set FIX_BUGS_MAXCONCURRENT_OVERRIDE ` +
          `env var to override the cap.\n`,
      );
    }

    if (maxConcurrent === 1) {
      // Sequential path — preserves pre-feat-046 behavior verbatim.
      for (const bug of dispatchableBugs) {
        bug.attempts = (bug.attempts ?? 0) + 1;
        bug.status = "in-progress";
        attemptedCount += 1;
        // Persist BEFORE dispatch so a crash mid-agent leaves the bug
        // marked in-progress (not pending) — the resume helper can then
        // detect partial work + decide whether to re-attempt.
        writeBugsYaml(bugsYamlPath, doc);

        const dispatch = await dispatchAgentsForBug({
          bug,
          ctx,
          worktreeCwd,
        });
        totalCostUsd += dispatch.costUsd;

        if (dispatch.success) {
          bug.status = "completed";
          bug.resolvedInIteration = iteration;
          completedCount += 1;
        } else {
          for (const entry of dispatch.errorLog) bug.errorLog.push(entry);
          // bug-073 Phase B — convergence detector escalates early when
          // consecutive attempts produce identical errorLog entries.
          // Falls back to the maxAttempts cap when no convergence
          // signal is present. Leaves the bug `pending` for a
          // subsequent iteration's retry pool when neither fires.
          if (transitionFailedDispatch(bug) === "failed") failedCount += 1;
        }
        // Persist after each bug so a crash mid-iteration leaves a usable
        // checkpoint for resume.
        writeBugsYaml(bugsYamlPath, doc);
      }
    } else {
      // feat-046 Phase A.1 parallel path.
      //
      // Per-bug worktrees on `fix/<bug-id>` branches branched off the
      // fixup branch HEAD. Promise.all batches of size `maxConcurrent`
      // dispatch in parallel. Per-batch sequential merge cascade rolls
      // each `fix/<bug-id>` into the fixup branch (`fix/bugs-yaml-iter`).
      // bugs.yaml is written ONCE before each batch (in-progress marks)
      // and ONCE after each batch (completion marks) per investigate-015 F3.
      //
      // KNOWN LIMITATION (Phase A.1): no per-slot env injection — Strategy
      // C projects (real-DB backend) WILL collide on port 3001 between
      // slots. Strategy A/D projects are safe at any concurrency.
      // Phase A.2 ships per-worktree env isolation.
      //
      // feat-053 (2026-05-05) — when enableClassBatchedDispatch is true,
      // we pre-group dispatchableBugs by parity-pattern. Groups of size ≥ 2
      // dispatch as a SINGLE batched unit (1 builder + 1 tester + 1
      // reviewer + 1 merge cascade) in a shared per-pattern worktree.
      // Singletons (size 1, or non-parity bugs) flow through the existing
      // per-bug path. Default false — the existing per-bug behavior is
      // preserved verbatim when the flag is omitted.
      type DispatchUnit =
        | { kind: "single"; bugs: [BugEntry]; unitId: string }
        | {
            kind: "batch";
            bugs: BugEntry[];
            pattern: string;
            unitId: string;
          };
      const dispatchUnits: DispatchUnit[] = [];
      if (ctx.enableClassBatchedDispatch) {
        const groups = groupDispatchableBugsByPattern(dispatchableBugs);
        for (const [key, groupBugs] of groups) {
          if (key.startsWith("pattern:") && groupBugs.length >= 2) {
            const pattern = key.slice("pattern:".length);
            dispatchUnits.push({
              kind: "batch",
              bugs: groupBugs,
              pattern,
              unitId: `pattern-${pattern}-batch`,
            });
          } else {
            const bug = groupBugs[0]!;
            dispatchUnits.push({
              kind: "single",
              bugs: [bug],
              unitId: bug.id,
            });
          }
        }
      } else {
        for (const bug of dispatchableBugs) {
          dispatchUnits.push({
            kind: "single",
            bugs: [bug],
            unitId: bug.id,
          });
        }
      }

      for (let i = 0; i < dispatchUnits.length; i += maxConcurrent) {
        const batch = dispatchUnits.slice(i, i + maxConcurrent);

        // Open one worktree PER UNIT (single bug OR batched group). Mark
        // every bug in the unit as in-progress before parallel dispatch.
        const batchOpens: Array<{
          unit: DispatchUnit;
          worktreePath: string | null;
          openError: string | null;
        }> = [];
        for (let bIdx = 0; bIdx < batch.length; bIdx++) {
          const unit = batch[bIdx]!;
          // feat-046 Phase A.2: slot index = position within the batch.
          // Pool (3000+2*slot, 3001+2*slot) is consistent within the
          // batch's lifetime; per-batch teardown returns slots so the
          // next batch reuses the same pool.
          const slot = bIdx;
          for (const bug of unit.bugs) {
            bug.attempts = (bug.attempts ?? 0) + 1;
            bug.status = "in-progress";
            attemptedCount += 1;
          }
          if (skipWorktreeManagement) {
            // Test path — skip git ops; reuse projectRoot as the cwd.
            batchOpens.push({
              unit,
              worktreePath: ctx.projectRoot,
              openError: null,
            });
            continue;
          }
          const open = openPerBugWorktree({
            projectRoot: ctx.projectRoot,
            bugId: unit.unitId,
            baseBranch: fixupBranch,
            slot,
          });
          if (open.ok) {
            batchOpens.push({
              unit,
              worktreePath: open.worktreePath,
              openError: null,
            });
          } else {
            batchOpens.push({
              unit,
              worktreePath: null,
              openError: open.reason,
            });
          }
        }
        // Single bugs.yaml write capturing all in-progress flips.
        writeBugsYaml(bugsYamlPath, doc);

        // Dispatch every batch entry in parallel. Bugs that failed to open
        // their per-bug worktree skip dispatch + count as failure.
        //
        // bug-052 follow-up (2026-05-05): pause-resume hardening. Wrap
        // each per-bug Promise in a try/catch that captures PauseSignal
        // as a result-shape rather than letting it abort Promise.all.
        // This is critical: without it, the FIRST PauseSignal from any
        // bug would reject Promise.all → post-batch yaml write doesn't
        // fire → completed-but-not-yet-merged bugs stay marked
        // in-progress on disk → resume re-attempts wasted work.
        // With this: every bug in the batch settles with a result, the
        // post-batch persistence captures all outcomes, then the
        // PauseSignal is re-thrown AFTER persistence so the orchestrator
        // unwinds cleanly.
        type DispatchResult =
          | {
              kind: "completed-or-failed";
              unit: DispatchUnit;
              success: boolean;
              costUsd: number;
              errorLog: string[];
            }
          | {
              kind: "open-failed";
              unit: DispatchUnit;
              openError: string;
            }
          | {
              kind: "paused";
              unit: DispatchUnit;
              pauseSignal: PauseSignal;
              costUsd: number;
            };
        const dispatchResults: DispatchResult[] = await Promise.all(
          batchOpens.map(async (entry): Promise<DispatchResult> => {
            if (entry.openError !== null || entry.worktreePath === null) {
              return {
                kind: "open-failed",
                unit: entry.unit,
                openError: entry.openError ?? "unknown",
              };
            }
            try {
              const dispatch =
                entry.unit.kind === "batch"
                  ? await dispatchAgentsForPatternGroup({
                      bugs: entry.unit.bugs,
                      pattern: entry.unit.pattern,
                      ctx,
                      worktreeCwd: entry.worktreePath,
                    })
                  : await dispatchAgentsForBug({
                      bug: entry.unit.bugs[0]!,
                      ctx,
                      worktreeCwd: entry.worktreePath,
                    });
              return {
                kind: "completed-or-failed",
                unit: entry.unit,
                success: dispatch.success,
                costUsd: dispatch.costUsd,
                errorLog: dispatch.errorLog,
              };
            } catch (err) {
              if (err instanceof PauseSignal) {
                return {
                  kind: "paused",
                  unit: entry.unit,
                  pauseSignal: err,
                  costUsd: 0,
                };
              }
              throw err;
            }
          }),
        );

        // Sequential merge cascade: each successful per-unit branch merges
        // into the fixup branch via `git merge --no-ff`. Conflicts flow
        // through bug-034 Phase A's additive-concat resolver. Failures
        // here mark the bug(s) as failed for THIS attempt; next iteration
        // may retry per the retry-counter.
        let capturedPauseSignal: PauseSignal | null = null;
        for (const result of dispatchResults) {
          totalCostUsd +=
            result.kind === "paused"
              ? 0
              : "costUsd" in result
                ? result.costUsd
                : 0;
          if (result.kind === "paused") {
            // Bug(s) stay in-progress on disk; resume picks them up via
            // pendingThisIter's `in-progress`-as-pending semantics. Capture
            // the signal so we re-throw AFTER post-batch persistence.
            if (capturedPauseSignal === null) {
              capturedPauseSignal = result.pauseSignal;
            }
            continue;
          }
          if (result.kind === "open-failed") {
            for (const bug of result.unit.bugs) {
              bug.errorLog.push(
                `[per-bug-worktree-open-failed] ${result.openError}`,
              );
              // bug-073 Phase B — convergence detector escalates early
              // on identical consecutive failures (e.g. recurring EBUSY
              // worktree teardown across attempts).
              if (transitionFailedDispatch(bug) === "failed") failedCount += 1;
            }
            continue;
          }
          // result.kind === "completed-or-failed"
          if (!result.success) {
            for (const bug of result.unit.bugs) {
              for (const entry of result.errorLog) bug.errorLog.push(entry);
              // bug-073 Phase B — convergence detector.
              if (transitionFailedDispatch(bug) === "failed") failedCount += 1;
            }
            continue;
          }
          // bug-055 Phase C — defense-in-depth $0-spend warning. Phase B's
          // empty-merge guard is the load-bearing fix; this is an
          // operator-visible signal for the next-class silent-success
          // (e.g. agent dispatch silently bypassed). When dispatch reports
          // success but $0 was spent on a real (non-test) run, log a
          // structured warning. Behavior unchanged — Phase B will still
          // fail the close-feature merge if no commits landed.
          if (
            result.success &&
            result.costUsd === 0 &&
            !skipWorktreeManagement
          ) {
            process.stderr.write(
              `[fix-bugs-loop] WARNING: unit ${result.unit.unitId} reported dispatch success with $0 spend — ` +
                `verify the agent actually fired (could indicate an orchestrator dispatch skip). ` +
                `Phase B's empty-merge guard will reject the close-feature step if no commits landed.\n`,
            );
          }
          // Try to merge the per-unit branch into the fixup branch.
          let mergedOk = true;
          if (!skipWorktreeManagement) {
            const wtPath = bugWorktreePath(ctx.projectRoot, result.unit.unitId);
            const branch = bugBranchName(result.unit.unitId);
            const close = closePerBugWorktree({
              projectRoot: ctx.projectRoot,
              fixupWorktreePath: worktreePath,
              worktreePath: wtPath,
              branch,
              fixupBranch,
            });
            if (!close.ok) {
              mergedOk = false;
              for (const bug of result.unit.bugs) {
                bug.errorLog.push(
                  `[per-bug-merge-cascade-failed] ${close.reason}`,
                );
              }
            }
          }
          if (mergedOk) {
            for (const bug of result.unit.bugs) {
              bug.status = "completed";
              bug.resolvedInIteration = iteration;
              completedCount += 1;
            }
          } else {
            for (const bug of result.unit.bugs) {
              // bug-073 Phase B — convergence detector escalates early
              // on identical consecutive merge-cascade failures (the
              // empirical reading-log-02 pattern: same merge-conflict
              // signature across 2+ attempts).
              if (transitionFailedDispatch(bug) === "failed") failedCount += 1;
            }
          }
        }
        // Single bugs.yaml write at batch end — captures ALL bug outcomes
        // including paused ones (which stay marked `in-progress`). This is
        // the LOSSLESS pause boundary: every completed bug's status is
        // persisted before we propagate the pause.
        writeBugsYaml(bugsYamlPath, doc);
        // Re-throw PauseSignal AFTER persistence so the orchestrator's
        // outer cli.ts catch sees it + exits 0 cleanly. Resume picks up
        // the in-progress bugs via pendingThisIter's filter.
        if (capturedPauseSignal !== null) {
          throw capturedPauseSignal;
        }
      }
    }

    // Snapshot pre-verify state for new-bug + flap detection.
    const preVerifyIds = new Set(doc.bugs.map((b) => b.id));
    const preVerifyByid = new Map(doc.bugs.map((b) => [b.id, { ...b }]));

    // Re-run verify with iteration+1 so any newly-filed bugs are tagged
    // with the iteration they FIRST appeared in (not the one we just
    // ran fixes against).
    const verifyArgs: BuildToSpecVerifyContext = {
      projectDir: ctx.projectRoot,
      autoFileBugPlans: true,
      pipelineRunId: ctx.pipelineRunId,
      iteration: iteration + 1,
      // feat-068 — thread invokeAgent so end-of-iteration verify can dispatch
      // the perceptual-reviewer agent (Tier 4 vision-LLM detection).
      invokeAgent: ctx.invokeAgent,
    };
    if (ctx.factoryRoot !== undefined) verifyArgs.factoryRoot = ctx.factoryRoot;
    let verify: BuildToSpecVerifyOutput | undefined;
    try {
      verify = await ctx.runBuildToSpecVerify(verifyArgs);
      finalVerify = verify;
      totalCostUsd += verify.costUsd;
    } catch {
      // Treat verify failure as iteration cap continuation; the loop will
      // retry on next pass. Persist warning into the iteration summary.
    }

    // Re-read bugs.yaml — the verify step appends new entries via
    // `scripts/file-bug-plan.mjs::appendBugToYaml`. We need the fresh
    // doc to detect new + reappeared bugs.
    const refreshed = readBugsYaml(bugsYamlPath);
    if (refreshed) doc = refreshed;

    const newBugIds = detectNewBugIds(preVerifyIds, doc);
    const flap = applyFlappingDetection({
      pre: preVerifyByid,
      post: doc,
      maxFlapResets,
    });
    const remainingPending = doc.bugs.filter(
      (b) => b.status === "pending",
    ).length;

    // Bump iteration counter for the next pass + persist.
    doc.iteration = iteration + 1;
    writeBugsYaml(bugsYamlPath, doc);

    iterationLog.push({
      iteration,
      bugsAttempted: attemptedCount,
      bugsCompleted: completedCount,
      bugsFailed: failedCount,
      bugsRemaining: remainingPending,
      verifyOk: verify?.ok ?? false,
      newBugIds,
      reappearedBugIds: flap.reappeared,
      iterationCostUsd: totalCostUsd - iterationStartCost,
    });

    // Exit condition: verify clean AND no pending bugs AND no failed bugs.
    // (Failed bugs override "clean" — they're a hard signal something
    // unfixable lives in the codebase even if verify happens to be ok.)
    const anyPending = doc.bugs.some((b) => b.status === "pending");
    const anyFailed = doc.bugs.some((b) => b.status === "failed");
    if (verify?.ok && !anyPending && !anyFailed) {
      status = "clean";
      break;
    }
    // Exit condition: nothing more we can work on.
    if (!anyPending) {
      const anyCompleted = doc.bugs.some((b) => b.status === "completed");
      if (anyFailed) {
        status = "all-bugs-failed";
      } else {
        status = anyCompleted ? "clean" : "all-bugs-failed";
      }
      break;
    }
  }

  if (!skipWorktreeManagement) {
    closeFixupWorktree({
      projectRoot: ctx.projectRoot,
      worktreePath,
      branch: fixupBranch,
      mergeFirst: status === "clean",
    });
  }

  const bugsResolved = doc.bugs
    .filter((b) => b.status === "completed")
    .map((b) => b.id);
  const bugsFailed = doc.bugs
    .filter((b) => b.status === "failed")
    .map((b) => b.id);
  const bugsRemaining = doc.bugs
    .filter((b) => b.status === "pending" || b.status === "in-progress")
    .map((b) => b.id);

  return {
    status,
    iterationsRun: iterationLog.length,
    bugsResolved,
    bugsFailed,
    bugsRemaining,
    totalCostUsd,
    iterationLog,
    ...(finalVerify ? { finalVerify } : {}),
  };
}
