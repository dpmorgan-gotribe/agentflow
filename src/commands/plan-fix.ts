import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runWorkerSequential } from '../lib/worker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES = join(__dirname, '..', 'templates');

interface PlanFixOptions {
  context?: string;
}

async function getNextBugId(plansDir: string): Promise<string> {
  const bugsDir = join(plansDir, 'bugs');
  const archiveDir = join(bugsDir, 'archive');

  try {
    await mkdir(bugsDir, { recursive: true });
    await mkdir(archiveDir, { recursive: true });

    // Read from both main directory and archive
    const mainFiles = await readdir(bugsDir);
    let archiveFiles: string[] = [];
    try {
      archiveFiles = await readdir(archiveDir);
    } catch {
      // Archive may not exist yet
    }

    const allFiles = [...mainFiles, ...archiveFiles];
    const bugFiles = allFiles.filter(f => f.startsWith('BUG-') && f.endsWith('.md'));

    if (bugFiles.length === 0) {
      return 'BUG-001';
    }

    const ids = bugFiles.map(f => {
      const match = f.match(/^BUG-(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    });

    const maxId = Math.max(...ids);
    return `BUG-${String(maxId + 1).padStart(3, '0')}`;
  } catch {
    return 'BUG-001';
  }
}

export async function planFix(name: string, options: PlanFixOptions) {
  const cliRoot = join(__dirname, '..', '..');
  const plansDir = join(cliRoot, 'plans');

  console.log(`Creating bug fix plan: ${name}`);

  // Get next sequential ID
  const bugId = await getNextBugId(plansDir);
  console.log(`Assigned ID: ${bugId}`);

  // Load planner agent system prompt
  const systemPrompt = await readFile(
    join(TEMPLATES, 'agents', 'planner', 'system.md'),
    'utf-8'
  );

  // Load plan-fix skill
  const skill = await readFile(
    join(TEMPLATES, 'skills', 'planning', 'plan-fix.md'),
    'utf-8'
  );

  // Build user prompt
  const context = options.context || '';
  const userPrompt = `Create a bug fix plan for: ${name}

Bug ID: ${bugId}

${context ? `Additional Context:\n${context}\n` : ''}
Generate a complete plan following the skill format. Replace {ID} with ${bugId.replace('BUG-', '')} and {Title} with an appropriate title based on the bug name.`;

  // Invoke planner agent
  const result = await runWorkerSequential({
    id: bugId,
    systemPrompt: `${systemPrompt}\n\n## Skill\n\n${skill}`,
    userPrompt
  });

  if (result.error) {
    console.error(`Failed to generate plan: ${result.error}`);
    process.exit(1);
  }

  // Write plan to file
  const filename = `${bugId}-${name.toLowerCase().replace(/\s+/g, '-')}.md`;
  const outputPath = join(plansDir, 'bugs', filename);

  await writeFile(outputPath, result.output);

  console.log(`
Bug fix plan created!

Location: plans/bugs/${filename}

Next steps:
  1. Review the plan
  2. Refine if needed
  3. Start implementation
`);
}
