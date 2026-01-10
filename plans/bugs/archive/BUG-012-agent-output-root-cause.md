I've successfully created the bug fix plan for **BUG-012: Agent Output Root Cause**. 

## Summary

The plan has been created at:
```
C:\Development\ps\claude\claude_\agentflow\agenticflow_BASE-v2\plans\bugs\BUG-012-agent-output-root-cause.md
```

### Plan Highlights

**Title**: Agent Output Root Cause - Unreliable Raw Output from invokeAgent

**Problem**: The `invokeAgent()` function allows conversational responses to leak into captured output despite per-command validation workarounds.

**Root Cause Analysis** (5 issues identified):
1. No output format enforcement in CLI flags
2. `shell=true` causing escaping issues
3. No central retry logic (duplicated across commands)
4. stderr captured but not analyzed
5. No output streaming/buffering or timeout handling

**Implementation Steps** (14 steps across 4 phases):
- **Phase 1**: Fix invokeAgent core (output flags, remove shell=true, prompt wrapper, timeout)
- **Phase 2**: Centralize retry logic (`invokeAgentWithRetry()`, update worker.ts)
- **Phase 3**: Update all commands to use central logic
- **Phase 4**: Enhanced error diagnostics

**Files Affected**: 7 files (agent.ts, worker.ts, and 5 command files)

**Related Bugs**: BUG-010 (permission wait), BUG-011 (stylesheet validation)
