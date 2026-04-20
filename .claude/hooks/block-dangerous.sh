#!/usr/bin/env bash
# .claude/hooks/block-dangerous.sh
#
# PreToolUse hook. Blocks destructive commands regardless of permission mode.
# Contract: reads tool-call JSON on stdin. Exit 0 to allow, exit 2 to block
# (stderr is surfaced back to the model).
#
# Pattern source: blueprint §15, lines 2281-2309.
# Extra patterns (flag re-ordering, --force-with-lease exemption) added so the
# hook catches realistic Windows/bash variations.
set -euo pipefail

# Read stdin once into a buffer so we can parse with whichever JSON tool is
# available. On a clean Windows Git Bash install `jq` is usually missing but
# Python is almost always on PATH.
INPUT=$(cat)

# Works? Tests if a binary actually runs (not just PATH-resolves). Needed
# because Windows ships a python3 "App Execution Alias" stub that resolves
# via PATH but exits non-zero on real input — treating it as a working parser
# would swallow every tool call.
_works() {
  "$1" --version >/dev/null 2>&1
}

PYTHON_BIN=""
if _works python; then
  PYTHON_BIN=python
elif _works python3; then
  PYTHON_BIN=python3
fi

if command -v jq >/dev/null 2>&1 && _works jq; then
  COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""')
elif [[ -n "$PYTHON_BIN" ]]; then
  COMMAND=$(printf '%s' "$INPUT" | "$PYTHON_BIN" -c 'import sys, json; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("command","") or "")')
else
  # Fail-closed: a safety hook that can't parse its input must not pretend
  # everything is safe. Tell the user how to fix it.
  echo "BLOCKED: block-dangerous.sh requires either jq or python on PATH." >&2
  echo "Install jq (https://jqlang.github.io/jq/) or ensure python is on PATH." >&2
  exit 2
fi

# Non-Bash tool call (Write, Edit, etc.) → nothing to check, allow.
if [[ -z "$COMMAND" ]]; then
  exit 0
fi

# Patterns are matched case-insensitively (grep -iE).
# Where flag order matters, we include both orderings.
#
# Deliberate exemptions (see EXEMPTIONS below):
# - `git push --force-with-lease` — safer than --force, does not clobber
# - `pnpm|npm|yarn|bun publish --dry-run` — doesn't actually publish
DANGEROUS_PATTERNS=(
  # --- Unix destruction (blueprint §15) ---
  'rm[[:space:]]+-[a-z]*r[a-z]*f?[[:space:]]+/($|[[:space:]])'     # rm -rf /
  'rm[[:space:]]+-[a-z]*r[a-z]*f?[[:space:]]+~($|[[:space:]])'     # rm -rf ~
  'rm[[:space:]]+-[a-z]*r[a-z]*f?[[:space:]]+\.($|[[:space:]])'    # rm -rf .
  ':\(\)\{[[:space:]]*:\|:&[[:space:]]*\};:'                       # fork bomb

  # --- Git destruction ---
  'git[[:space:]]+push.*(--force($|[[:space:]=])|[[:space:]]-f($|[[:space:]])).*\<(main|master)\>'
  'git[[:space:]]+push.*\<(main|master)\>.*(--force($|[[:space:]])|[[:space:]]-f($|[[:space:]]))'
  'git[[:space:]]+reset[[:space:]]+--hard'
  'git[[:space:]]+clean[[:space:]]+-[a-z]*f[a-z]*d'
  'git[[:space:]]+clean[[:space:]]+-[a-z]*d[a-z]*f'

  # --- SQL destruction ---
  'DROP[[:space:]]+TABLE'
  'DROP[[:space:]]+DATABASE'
  'TRUNCATE[[:space:]]+TABLE'

  # --- Tier A: publish / deploy (route through justfile instead) ---
  '(pnpm|npm|yarn|bun)[[:space:]]+publish([[:space:]]|$)'
  'eas[[:space:]]+submit([[:space:]]|$)'
  'vercel([[:space:]].*)?[[:space:]]--prod([[:space:]]|$)'
  '(fly|flyctl)[[:space:]]+deploy([[:space:]]|$)'
  'netlify[[:space:]]+deploy.*--prod'
  'docker[[:space:]]+push.*:latest($|[[:space:]])'

  # --- Tier B: data wipe (ORM / BaaS / S3) ---
  'prisma[[:space:]]+migrate[[:space:]]+reset'
  'drizzle-kit[[:space:]]+drop'
  'supabase[[:space:]]+db[[:space:]]+reset'
  'aws[[:space:]]+s3[[:space:]]+sync.*--delete'
)

# Exemptions: matched before the main loop. If an exempt pattern fires, the
# command is allowed even if it also matches a dangerous pattern.
EXEMPTIONS=(
  'git[[:space:]]+push.*--force-with-lease'
  '(pnpm|npm|yarn|bun)[[:space:]]+publish[[:space:]].*--dry-run'
)

for exempt in "${EXEMPTIONS[@]}"; do
  if printf '%s' "$COMMAND" | grep -qiE "$exempt"; then
    exit 0
  fi
done

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if printf '%s' "$COMMAND" | grep -qiE "$pattern"; then
    echo "BLOCKED: command matches dangerous pattern: $pattern" >&2
    echo "command: $COMMAND" >&2
    exit 2
  fi
done

exit 0
