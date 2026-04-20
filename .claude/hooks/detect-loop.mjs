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
