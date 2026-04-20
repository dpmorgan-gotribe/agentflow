#!/usr/bin/env bash
# .claude/hooks/enforce-boundaries.sh
#
# PreToolUse hook. Two roles:
#   1. Block writes to paths outside $CLAUDE_PROJECT_DIR.
#   2. Block writes to sensitive files (.env, .env.local, *.pem, *.key, ...).
#
# Contract: reads tool-call JSON on stdin. Exit 0 allow, exit 2 block (stderr
# surfaced back to the model). Wire into settings.json for Write / Edit /
# NotebookEdit so Read doesn't trigger the sensitive-file check.
#
# Pattern source: blueprint §15, lines 2311-2337.
set -euo pipefail

INPUT=$(cat)

_works() {
  "$1" --version >/dev/null 2>&1
}

PYTHON_BIN=""
if _works python; then
  PYTHON_BIN=python
elif _works python3; then
  PYTHON_BIN=python3
fi

# Extract file path from tool_input (try file_path then path).
if command -v jq >/dev/null 2>&1 && _works jq; then
  FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // ""')
elif [[ -n "$PYTHON_BIN" ]]; then
  FILE_PATH=$(printf '%s' "$INPUT" | "$PYTHON_BIN" -c 'import sys, json; ti=json.load(sys.stdin).get("tool_input",{}); print(ti.get("file_path") or ti.get("path") or "")')
else
  echo "BLOCKED: enforce-boundaries.sh requires either jq or python on PATH." >&2
  exit 2
fi

# No file path → not a file-writing tool call, allow.
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# $CLAUDE_PROJECT_DIR is injected by the Claude Code harness. Refuse to run
# without it — can't enforce a boundary we don't know.
if [[ -z "${CLAUDE_PROJECT_DIR:-}" ]]; then
  echo "BLOCKED: CLAUDE_PROJECT_DIR is not set. Cannot enforce project boundary." >&2
  exit 2
fi

# Resolve to absolute, canonical path. Prefer realpath -m (handles
# non-existent targets, which Write often hits — the file doesn't exist yet).
# Fall back to python for portability (macOS stock realpath lacks -m).
if realpath -m / >/dev/null 2>&1; then
  RESOLVED=$(realpath -m "$FILE_PATH" 2>/dev/null || printf '%s' "$FILE_PATH")
  PROJECT_RESOLVED=$(realpath -m "$CLAUDE_PROJECT_DIR" 2>/dev/null || printf '%s' "$CLAUDE_PROJECT_DIR")
elif [[ -n "$PYTHON_BIN" ]]; then
  RESOLVED=$("$PYTHON_BIN" -c "import os,sys; print(os.path.abspath(sys.argv[1]))" "$FILE_PATH")
  PROJECT_RESOLVED=$("$PYTHON_BIN" -c "import os,sys; print(os.path.abspath(sys.argv[1]))" "$CLAUDE_PROJECT_DIR")
else
  RESOLVED="$FILE_PATH"
  PROJECT_RESOLVED="$CLAUDE_PROJECT_DIR"
fi

# Normalize for case-insensitive compare + cross-format drive letters.
# Windows sees all four of these as the same directory:
#   C:/Dev/x   c:/dev/x   /c/Dev/x   /c/dev/x
# Convert any "X:/..." Windows-style prefix to "/x/..." mingw style, then
# lowercase. Strip trailing slash so project "/x" doesn't accept "/xy/file".
_normalize() {
  local p="${1,,}"                              # lowercase (bash 4+)
  p=$(printf '%s' "$p" | tr '\\' '/')             # backslashes -> forward
  p=$(printf '%s' "$p" | sed -E 's|^([a-z]):|/\1|') # C:/x -> /c/x
  p="${p%/}"                                    # strip trailing slash
  printf '%s' "$p"
}

RESOLVED_CMP=$(_normalize "$RESOLVED")
PROJECT_CMP=$(_normalize "$PROJECT_RESOLVED")

if [[ "$RESOLVED_CMP" != "$PROJECT_CMP" && "$RESOLVED_CMP" != "$PROJECT_CMP"/* ]]; then
  echo "BLOCKED: write outside project directory" >&2
  echo "  project: $PROJECT_RESOLVED" >&2
  echo "  target:  $RESOLVED" >&2
  exit 2
fi

# Block writes to sensitive files by basename match (shell glob).
# NOT blocked (intentional): .env.example, google-services.json,
# GoogleService-Info.plist — these are meant to ship with the app.
BASENAME=$(basename "$FILE_PATH")
BLOCKED_FILES=(
  # Environment / secrets
  ".env"
  ".env.local"
  # Generic key material
  "*.pem"
  "*.key"
  # SSH private keys (no extension)
  "id_rsa"
  "id_ed25519"
  "id_ecdsa"
  "id_dsa"
  # Cloud service account keys
  "credentials.json"
  "firebase-adminsdk-*.json"
  # Code-signing / Android & iOS
  "*.p12"
  "*.pfx"
  "*.keystore"
  "*.jks"
)
for blocked in "${BLOCKED_FILES[@]}"; do
  # shellcheck disable=SC2053  # intentional glob match on RHS
  if [[ "$BASENAME" == $blocked ]]; then
    echo "BLOCKED: cannot modify sensitive file: $FILE_PATH" >&2
    echo "  matched pattern: $blocked" >&2
    exit 2
  fi
done

exit 0
