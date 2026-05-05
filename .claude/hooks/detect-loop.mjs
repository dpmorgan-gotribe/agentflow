#!/usr/bin/env node
// .claude/hooks/detect-loop.mjs
//
// PreToolUse circuit breaker. Blocks the THIRD identical action in a row,
// so blind retries can't burn attempts 3-5 of the retry ladder. Feeds the
// escalation policy — attempt 3 should trigger /plan-investigation rather
// than another identical retry.
//
// Contract: reads the full PreToolUse payload on stdin. Always exits 0;
// signals deny via the newer hookSpecificOutput JSON on stdout.
// Pattern source: blueprint §13, lines 1110-1157 (with the off-by-one fix
// described in the comments below).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const STATE_DIR = path.join(PROJECT_DIR, ".claude", "state");
const ATTEMPTS_FILE = path.join(STATE_DIR, "recent-attempts.json");

// Block threshold: if this many prior identical attempts are in state, the
// current one is the 3rd — deny it. Blueprint's `>= 3` would have blocked
// the 4th attempt, one past the retry-policy escalation point.
const MAX_PRIOR_IDENTICAL = 2;

// Rolling window — prevents the state file from growing unbounded.
const WINDOW_SIZE = 50;

function hashAction({ tool, file, content, extra }) {
  const sig = `${tool || ""}:${file || ""}:${(content || "").slice(0, 200)}:${(extra || "").slice(0, 200)}`;
  return crypto.createHash("sha256").update(sig).digest("hex").slice(0, 12);
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

let raw = "";
for await (const chunk of process.stdin) raw += chunk;

let payload;
try {
  payload = JSON.parse(raw || "{}");
} catch {
  // Unparseable input — don't block the whole session. Allow.
  process.exit(0);
}

const toolInput = payload.tool_input || {};
// Playwright MCP capture tools are inherently iterative: a /visual-review
// batch over N screens × 3 viewports makes N copies of each resize /
// navigate / take_screenshot call. The hook's deny-on-3rd-identical rule
// was tuned for Write/Edit/Bash where a repeat IS a retry; for capture-loop
// tools it misfires on the 3rd+ screen. Scope narrow — only the 5 capture
// tools, not the broader mcp__playwright__* namespace.
const CAPTURE_TOOLS = new Set([
  "mcp__playwright__browser_resize",
  "mcp__playwright__browser_navigate",
  "mcp__playwright__browser_wait_for",
  "mcp__playwright__browser_take_screenshot",
  "mcp__playwright__browser_close",
]);
if (CAPTURE_TOOLS.has(payload.tool_name || "")) {
  process.exit(0);
}
const hash = hashAction({
  tool: payload.tool_name,
  // Bash → command; Write/Edit/Read → file_path. Either is fine as the
  // signature input as long as it's stable for identical actions.
  file: toolInput.file_path || toolInput.path || toolInput.command,
  // Write → content; Edit → new_string; Agent → prompt (each subagent
  // spawn has a task-specific prompt and should not collide with sibling
  // spawns). Bash/Read → (nothing extra beyond command or file_path).
  content: toolInput.content || toolInput.new_string || toolInput.prompt,
  // Per-tool discriminators. Without these, three Reads of different
  // offsets into the same file would hash identically and trip the loop.
  // Likewise two Edits to different regions of the same file.
  // Agent calls need subagent_type + description too — without them, a
  // parallel multi-agent orchestration (e.g., /analyze phase 3 spawning
  // 3 analyst subagents) trips the loop even when each has a distinct
  // task-specific prompt.
  // TaskCreate/TaskUpdate/TaskGet have no file/command/content — they
  // discriminate on taskId, status, subject. Without these, running a
  // task list (TaskUpdate three times in a row for three different
  // tasks) trips the loop even when each call targets a distinct task.
  // ToolSearch has no file/command/content either — it discriminates
  // solely on `query`. Without it, three distinct schema-loads (e.g.,
  // Playwright MCP + TaskCreate + a later lookup) hash identically and
  // the 3rd is wrongly denied, bricking MCP-heavy skills like /visual-review.
  // Playwright MCP tools discriminate on `url` (browser_navigate),
  // `width`/`height` (browser_resize), `time`/`text`/`textGone` (browser_wait_for),
  // and `filename` (browser_take_screenshot). Without these, the three
  // sequential viewport captures per screen collide on a single hash and
  // the 3rd viewport is wrongly denied — same failure class as the query case.
  // Skill tool (2026-05-05): discriminates on `skill` (skill name) +
  // `args` (per-invocation arguments). Without these, EVERY Skill call
  // — `pause-build`, `resume-build`, `analyze`, `mockups`, `pick-style`,
  // `stylesheet`, etc. — hashes identically because none of the other
  // toolInput fields are populated. Three Skill calls in a session would
  // wrongly trigger the loop-detector on the 3rd, blocking legitimate
  // pipeline progression. Empirical: blocked /stylesheet on a fresh
  // reading-log-01 validation run after analyze → mockups → pick-style
  // had populated 3 Skill entries in recent-attempts.json.
  extra: [
    toolInput.offset,
    toolInput.limit,
    toolInput.old_string,
    toolInput.pattern,
    toolInput.subagent_type,
    toolInput.description,
    toolInput.taskId,
    toolInput.status,
    toolInput.subject,
    toolInput.query,
    toolInput.url,
    toolInput.width,
    toolInput.height,
    toolInput.filename,
    toolInput.time,
    toolInput.text,
    toolInput.textGone,
    toolInput.skill,
    toolInput.args,
  ]
    .filter((v) => v !== undefined && v !== null)
    .join("|"),
});

let attempts = [];
if (fs.existsSync(ATTEMPTS_FILE)) {
  try {
    attempts = JSON.parse(fs.readFileSync(ATTEMPTS_FILE, "utf8"));
    if (!Array.isArray(attempts)) attempts = [];
  } catch {
    attempts = [];
  }
}

const prior = attempts.filter((a) => a.hash === hash).length;

if (prior >= MAX_PRIOR_IDENTICAL) {
  deny(
    `LOOP DETECTED: this exact action has been attempted ${prior + 1} times. ` +
      `Previous attempts failed. Try a fundamentally different approach, or ` +
      `escalate with /plan-bug (if this is a bug) or /plan-investigation ` +
      `(if the root cause is unclear).`,
  );
}

attempts.push({ hash, timestamp: Date.now(), tool: payload.tool_name || null });
try {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(
    ATTEMPTS_FILE,
    JSON.stringify(attempts.slice(-WINDOW_SIZE), null, 2),
  );
} catch (err) {
  // Don't block on state-write failure — log to stderr and allow.
  process.stderr.write(`detect-loop: failed to write state: ${err.message}\n`);
}

process.exit(0);
