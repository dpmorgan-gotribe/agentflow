# BUG-013: Initialize Git Repository During Project Creation

## Problem
When creating a new project with `agentflow init <name>`, a Git repository is not automatically initialized in the project directory. This forces users to manually run `git init` after project creation, breaking the expected development workflow and preventing immediate version control.

## Context
- **Location**: `src/commands/init.ts` - the project scaffolding logic
- **Affected Components**: 
  - `init` command implementation
  - New project directories in `projects/`
- **User Impact**: 
  - Users cannot immediately commit their initial project state
  - No `.gitignore` is created, risking accidental commits of `node_modules`, `dist`, etc.
  - Breaks CI/CD workflows that expect git-initialized projects
  - Inconsistent project state compared to typical `npm init` or framework CLIs

## Root Cause Analysis
The `init.ts` command copies template files and creates the project directory structure but does not include any Git initialization logic. The scaffolding process:
1. Creates the project directory
2. Copies template files from `src/templates/`
3. Potentially runs `npm install`
4. **Missing**: `git init` execution
5. **Missing**: `.gitignore` file creation/copying

This was likely an oversight in the initial implementation, as most modern CLI tools (Create React App, Vite, etc.) initialize Git by default.

## Implementation Steps

1. [ ] Add `.gitignore` template to `src/templates/`
   - Include common patterns: `node_modules/`, `dist/`, `.env`, `.DS_Store`, `*.log`
   - Consider AgenticFlow-specific patterns: `outputs/`, `*.tmp`

2. [ ] Modify `src/commands/init.ts` to copy `.gitignore` during scaffolding
   - Ensure it's included in the template copy logic
   - Verify it's copied with correct permissions

3. [ ] Add Git initialization function in `src/commands/init.ts`
   - Use `child_process.execSync` or `spawn` to run `git init`
   - Execute after all files are copied but before completion message
   - Handle the case where `git` is not installed on the system

4. [ ] Add initial commit creation (optional but recommended)
   - Stage all files with `git add .`
   - Create initial commit: `git commit -m "Initial AgenticFlow project"`
   - Make this opt-out via `--no-git` flag

5. [ ] Add `--no-git` flag to skip Git initialization
   - Register option in `src/index.ts` command definition
   - Pass option to `init.ts` handler
   - Skip Git steps when flag is present

6. [ ] Update success message to indicate Git status
   - Show "✓ Git repository initialized" when successful
   - Show "⚠ Git not found - skipping repository initialization" when git unavailable
   - Show "○ Git initialization skipped (--no-git)" when explicitly skipped

7. [ ] Handle error cases gracefully
   - Git not installed: warn but don't fail
   - Git init fails: warn but don't fail (project creation should still succeed)
   - Inside existing Git repo: detect and skip (or warn user)

## Testing

- [ ] **Happy path**: Run `agentflow init test-project` and verify `.git/` directory exists
- [ ] **Gitignore exists**: Verify `.gitignore` is present with expected patterns
- [ ] **Initial commit**: Verify `git log` shows initial commit (if implemented)
- [ ] **No-git flag**: Run `agentflow init test-project --no-git` and verify no `.git/` directory
- [ ] **Git not installed**: Mock/remove git from PATH, verify graceful warning and successful project creation
- [ ] **Nested git repo**: Run init inside existing git repo, verify appropriate behavior (skip or warn)
- [ ] **Existing directory**: Verify behavior when target directory already exists
- [ ] **Template integrity**: Verify `.gitignore` doesn't interfere with other template files
- [ ] **Cross-platform**: Test on Windows (MINGW64), macOS, and Linux

## Rollback Plan

1. Revert the commit(s) containing the Git initialization changes
2. If `.gitignore` was added to templates and causes issues:
   - Remove `src/templates/.gitignore`
   - Rebuild: `npm run build`
3. No database or configuration migrations required
4. Users with already-created projects are unaffected (Git initialization is per-project)
5. Publish previous package version if distributed via npm
