import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runWorkerSequential } from '../lib/worker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES = join(__dirname, '..', 'templates');

interface PlanFeatureOptions {
  context?: string;
}

async function getNextFeatureId(plansDir: string): Promise<string> {
  const featuresDir = join(plansDir, 'features');
  const archiveDir = join(featuresDir, 'archive');

  try {
    await mkdir(featuresDir, { recursive: true });
    await mkdir(archiveDir, { recursive: true });

    // Read from both main directory and archive
    const mainFiles = await readdir(featuresDir);
    let archiveFiles: string[] = [];
    try {
      archiveFiles = await readdir(archiveDir);
    } catch {
      // Archive may not exist yet
    }

    const allFiles = [...mainFiles, ...archiveFiles];
    const featFiles = allFiles.filter(f => f.startsWith('FEAT-') && f.endsWith('.md'));

    if (featFiles.length === 0) {
      return 'FEAT-001';
    }

    const ids = featFiles.map(f => {
      const match = f.match(/^FEAT-(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    });

    const maxId = Math.max(...ids);
    return `FEAT-${String(maxId + 1).padStart(3, '0')}`;
  } catch {
    return 'FEAT-001';
  }
}

export async function planFeature(name: string, options: PlanFeatureOptions) {
  const cliRoot = join(__dirname, '..', '..');
  const plansDir = join(cliRoot, 'plans');

  console.log(`Creating feature plan: ${name}`);

  // Get next sequential ID
  const featId = await getNextFeatureId(plansDir);
  console.log(`Assigned ID: ${featId}`);

  // Load planner agent system prompt
  const systemPrompt = await readFile(
    join(TEMPLATES, 'agents', 'planner', 'system.md'),
    'utf-8'
  );

  // Load plan-feature skill
  const skill = await readFile(
    join(TEMPLATES, 'skills', 'planning', 'plan-feature.md'),
    'utf-8'
  );

  // Build user prompt
  const context = options.context || '';
  const userPrompt = `Create a feature implementation plan for: ${name}

Feature ID: ${featId}

${context ? `Additional Context:\n${context}\n` : ''}
Generate a complete plan following the skill format. Replace {ID} with ${featId.replace('FEAT-', '')} and {Title} with an appropriate title based on the feature name.`;

  // Invoke planner agent
  const result = await runWorkerSequential({
    id: featId,
    systemPrompt: `${systemPrompt}\n\n## Skill\n\n${skill}`,
    userPrompt
  });

  if (result.error) {
    console.error(`Failed to generate plan: ${result.error}`);
    process.exit(1);
  }

  // Write plan to file
  const filename = `${featId}-${name.toLowerCase().replace(/\s+/g, '-')}.md`;
  const outputPath = join(plansDir, 'features', filename);

  await writeFile(outputPath, result.output);

  console.log(`
Feature plan created!

Location: plans/features/${filename}

Next steps:
  1. Review the plan
  2. Refine if needed
  3. Start implementation
`);
}
