# AgenticFlow CLI

A minimal agentic design system: TypeScript CLI that orchestrates Claude agents for design generation.

## Project Structure

```
agenticflow_BASE-v2/
├── src/
│   ├── index.ts              # CLI entry point (commander.js)
│   ├── commands/             # Command implementations
│   │   ├── init.ts           # Create new project
│   │   ├── analyze.ts        # Run analyst (4 parallel workers)
│   │   ├── flows.ts          # Generate flow mockups
│   │   ├── mockups.ts        # Generate style mockups (3 options)
│   │   ├── stylesheet.ts     # Generate design system
│   │   ├── screens.ts        # Generate all screen HTMLs
│   │   ├── plan-fix.ts       # Create bug fix plan
│   │   └── plan-feature.ts   # Create feature plan
│   ├── lib/
│   │   ├── agent.ts          # Agent/skill loading, Claude invocation
│   │   ├── worker.ts         # Parallel/sequential worker execution
│   │   └── project.ts        # Project validation helpers
│   └── templates/            # Copied to new projects during init
│       ├── agents/           # Agent definitions
│       ├── skills/           # Skill definitions
│       ├── commands/         # Command documentation
│       └── CLAUDE.md         # Project-level docs
├── plans/                    # Bug and feature plans
│   ├── bugs/
│   │   └── archive/
│   └── features/
│       └── archive/
├── dist/                     # Compiled output
├── package.json
└── tsconfig.json
```

## How Agents Work

Each agent has:
- `agent.json` - Metadata (id, name, skills list)
- `system.md` - System prompt for Claude

```typescript
// Loading an agent
const agent = await loadAgent(projectDir, 'analyst');
const systemPrompt = await loadSystemPrompt(projectDir, 'analyst');
```

## How Skills Work

Skills are markdown files that define specific tasks:
- Located in `skills/<category>/<skill-name>.md`
- Concatenated to system prompt when invoking

```typescript
const skill = await loadSkill(projectDir, 'analysis/analyze-styles');
const fullPrompt = `${systemPrompt}\n\n## Skill\n\n${skill}`;
```

## Available Commands

| Command | Description |
|---------|-------------|
| `agentflow init <name>` | Create new project in `projects/` |
| `agentflow analyze` | Analyze wireframes (4 parallel workers) |
| `agentflow flows` | Generate flow mockups |
| `agentflow mockups` | Generate 3 style mockups |
| `agentflow stylesheet --style=N` | Generate design system |
| `agentflow screens` | Generate all screen HTMLs |
| `agentflow plan-fix <name>` | Create bug fix plan |
| `agentflow plan-feature <name>` | Create feature plan |

## Adding a New Command

1. Create `src/commands/my-command.ts`:
```typescript
export async function myCommand(options?: MyOptions) {
  const projectDir = process.cwd();
  // 1. Validate prerequisites
  // 2. Load agent/skills
  // 3. Create worker tasks
  // 4. Execute (parallel or sequential)
  // 5. Write outputs
  // 6. Display next steps
}
```

2. Register in `src/index.ts`:
```typescript
import { myCommand } from './commands/my-command.js';

program
  .command('my-command [args]')
  .description('Description')
  .action(myCommand);
```

3. Build: `npm run build`

## Development Workflow

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Link globally for testing
npm link

# Test commands
agentflow --help
agentflow init test-project
```

## Worker Execution

**Parallel** (analyze, flows, mockups, screens):
```typescript
const results = await runWorkersParallel(tasks);
```

**Sequential** (stylesheet):
```typescript
const result = await runWorkerSequential(task);
```

## Key Files

- `src/lib/agent.ts:invokeAgent()` - Spawns Claude CLI process
- `src/lib/worker.ts:runWorkersParallel()` - Parallel execution
- `src/commands/init.ts` - Project scaffolding logic
