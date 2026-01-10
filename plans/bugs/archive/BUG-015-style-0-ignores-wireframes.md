# BUG-015: Style-0 Ignores Wireframes (Images Never Passed to Claude)

## Problem
Style-0 mockups don't follow wireframe layouts because **Claude never actually sees the wireframe images**. The system only passes filenames as text, not the image content.

## Root Cause

In `src/lib/agent.ts`, the `invokeAgent` function:
1. Uses `--tools ""` which **disables ALL tools** including Read
2. Only passes text via stdin
3. Never enables Claude to read image files

```typescript
const claude = spawn('claude', [
  '-p',
  '--model', model,
  '--tools', '""',  // <-- This disables Read tool, Claude can't see images!
  ...
]);
```

The prompts say "Files in assets/wireframes/: Screenshot_1.jpg, Screenshot_2.jpg..." but Claude only sees filenames, not images.

## Solution

Enable the `Read` tool and use `--add-dir` to grant access to the assets directory when image analysis is needed.

## Implementation Steps

1. [x] Identify root cause (tools disabled, images not passed)
2. [x] Update `InvokeAgentOptions` interface to support:
   - `allowRead?: boolean` - enables Read tool
   - `addDirs?: string[]` - directories to grant access to
3. [x] Update `invokeAgent` to conditionally enable Read tool
4. [x] Update `analyze` command to enable Read + add wireframes dir
5. [x] Update `mockups` command to enable Read + add assets dir for style-0
6. [x] Test that Claude can now see and describe wireframe images

## Code Changes

### `src/lib/agent.ts`

```typescript
export interface InvokeAgentOptions {
  timeout?: number;
  enforceRawOutput?: boolean;
  model?: 'opus' | 'sonnet' | 'haiku';
  allowRead?: boolean;      // NEW: Enable Read tool for image access
  addDirs?: string[];       // NEW: Directories to grant access
}

// In invokeAgent():
const toolsArg = options.allowRead ? '"Read"' : '""';
const args = [
  '-p',
  '--model', model,
  '--tools', toolsArg,
  ...(options.addDirs?.flatMap(d => ['--add-dir', d]) || []),
  ...
];
```

### `src/commands/analyze.ts`

Pass wireframes directory to workers:
```typescript
const workerTasks = tasks.map(task => ({
  ...task,
  allowRead: true,
  addDirs: [join(projectDir, 'assets', 'wireframes')]
}));
```

### `src/commands/mockups.ts`

For style-0 worker, enable reading wireframes:
```typescript
workerTasks.push({
  id: `style-${i}`,
  allowRead: isStyle0,  // Only style-0 needs to see wireframes
  addDirs: isStyle0 ? [join(projectDir, 'assets')] : [],
  ...
});
```

## Testing

- [ ] Run `agentflow analyze` and verify outputs reference actual wireframe content
- [ ] Run `agentflow mockups` and verify style-0 matches wireframe layouts
- [ ] Compare style-0 before/after fix
- [ ] Verify styles 1-4 still work (don't need wireframe access)

## Impact

- Style-0 will actually reflect user's wireframe layouts
- Analysis outputs will be based on actual wireframe images, not guesses
- Token usage may increase slightly due to image processing
