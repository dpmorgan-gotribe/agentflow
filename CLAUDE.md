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
| `agentflow plan-lesson <desc>` | Create lesson plan for CLAUDE.md |
| `agentflow archive-lesson <file>` | Archive lesson after adding to CLAUDE.md |

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

---

## Lessons

Principles and patterns discovered during development. These inform all future work on this project.

### Adding New Lessons

When we discover an important principle or pattern:
1. Add it to this Lessons section
2. Use the lesson template format below
3. Include context (which bug/feature led to discovery)
4. Keep descriptions concise but actionable

---

### Agent Design

#### Lesson: File paths over inline content
**Added:** 2025-01-20
**Context:** BUG-010 investigation - stylesheet not matching mockup, screens extraction missing pages

Never embed large files inline in prompts. Instead:
1. Give the agent the file path
2. Grant read access to the directory
3. Let the agent read the file itself

| Approach | Problem |
|----------|---------|
| Inline content | Truncation, context overflow, agent skims |
| File path + read access | Full content, agent reads what it needs, can re-read |

**Applies to:** Brief files (1000+ lines), mockup HTML (500+ lines), any large context files.

**Implementation:**
```typescript
// Bad: inline content
userPrompt = `...\n${largeFileContent}\n...`;

// Good: file path with read access
const result = await runWorkerSequential({
  userPrompt: `Read this file: ${filePath}`,
  allowRead: true,
  addDirs: [parentDir]
});
```

**Real-world impact (BUG-010):**
- Inline brief → 75% of screens missing from extraction (118 of 483)
- Inline mockup → Stylesheet CSS variables didn't match selected style
- Solution: File paths with read access → Complete extraction, accurate styling

---

#### Lesson: Agent-centric parsing
**Added:** 2025-01-20
**Context:** BUG-010 investigation - brief format parsing

Don't build rigid TypeScript parsers for brief formats. Briefs can be in ANY format:
- Tree/ASCII structure
- JSON blocks
- Markdown tables
- Plain prose descriptions
- Mixed formats

Let the analyst agent decipher any format. Our job is to:
1. Give clear instructions
2. Validate outputs
3. Provide feedback when extraction is incomplete

**Anti-pattern:** Building `extractNavigationSchemaFromTree()` or `extractNavigationSchemaFromJSON()` functions.

**Better:** Pass full brief to agent with instructions: "Extract ALL screens regardless of format."

---

### Validation

#### Lesson: Validate outputs against source
**Added:** 2025-01-20
**Context:** BUG-010 investigation - 75% of screens missing

After agent extraction, validate completeness by comparing against source:

```typescript
// Count .html files in brief vs extracted screens
const briefHtmlFiles = new Set(briefContent.match(/[a-z0-9-]+\.html/g) || []);
const extractedFiles = new Set(result.screens.map(s => s.file));
const coverage = extractedFiles.size / briefHtmlFiles.size;

if (coverage < 0.9) {
  console.warn(`Warning: Only ${Math.round(coverage*100)}% screen coverage`);
}
```

**Applies to:**
- Screen extraction: Compare extracted count vs .html mentions in brief
- Stylesheet: Compare CSS variables in mockup vs generated
- Any extraction task: Validate output completeness
