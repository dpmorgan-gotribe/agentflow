import { readdir, readFile, writeFile, mkdir, rename } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runWorkerSequential } from '../lib/worker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES = join(__dirname, '..', 'templates');

interface PlanLessonOptions {
  context?: string;
}

async function getNextLessonId(plansDir: string): Promise<string> {
  const lessonsDir = join(plansDir, 'lessons');
  const archiveDir = join(lessonsDir, 'archive');

  try {
    await mkdir(lessonsDir, { recursive: true });
    await mkdir(archiveDir, { recursive: true });

    // Read from both main directory and archive
    const mainFiles = await readdir(lessonsDir);
    let archiveFiles: string[] = [];
    try {
      archiveFiles = await readdir(archiveDir);
    } catch {
      // Archive may not exist yet
    }

    const allFiles = [...mainFiles, ...archiveFiles];
    const lessonFiles = allFiles.filter(f => f.startsWith('LESSON-') && f.endsWith('.md'));

    if (lessonFiles.length === 0) {
      return 'LESSON-001';
    }

    const ids = lessonFiles.map(f => {
      const match = f.match(/^LESSON-(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    });

    const maxId = Math.max(...ids);
    return `LESSON-${String(maxId + 1).padStart(3, '0')}`;
  } catch {
    return 'LESSON-001';
  }
}

async function loadClaudeMdLessons(cliRoot: string): Promise<string> {
  try {
    const claudeMd = await readFile(join(cliRoot, 'CLAUDE.md'), 'utf-8');
    const lessonsMatch = claudeMd.match(/## Lessons[\s\S]*$/);
    if (lessonsMatch) {
      return lessonsMatch[0];
    }
    return 'No existing lessons found in CLAUDE.md';
  } catch {
    return 'Could not read CLAUDE.md';
  }
}

export async function planLesson(description: string, options: PlanLessonOptions) {
  const cliRoot = join(__dirname, '..', '..');
  const plansDir = join(cliRoot, 'plans');

  console.log(`Creating lesson plan...`);

  // Get next sequential ID
  const lessonId = await getNextLessonId(plansDir);
  console.log(`Assigned ID: ${lessonId}`);

  // Load existing lessons from CLAUDE.md for context
  const existingLessons = await loadClaudeMdLessons(cliRoot);

  // Load planner agent system prompt
  const systemPrompt = await readFile(
    join(TEMPLATES, 'agents', 'planner', 'system.md'),
    'utf-8'
  );

  // Load plan-lesson skill
  const skill = await readFile(
    join(TEMPLATES, 'skills', 'planning', 'plan-lesson.md'),
    'utf-8'
  );

  // Build user prompt
  const context = options.context || '';
  const userPrompt = `Analyze this rough lesson idea and create a structured lesson plan:

## User's Lesson Idea
${description}

${context ? `## Additional Context\n${context}\n` : ''}

## Lesson ID
${lessonId}

## Existing Lessons in CLAUDE.md (for reference and consistency)
${existingLessons}

## Your Task
1. Analyze the user's rough idea
2. Identify the core principle or pattern
3. Determine the best category (Agent Design, Validation, Performance, Code Patterns, etc.)
4. Create a structured lesson following the format in the skill
5. Include concrete examples where helpful
6. Suggest where this lesson should be placed in the existing structure`;

  // Invoke planner agent
  const result = await runWorkerSequential({
    id: lessonId,
    systemPrompt: `${systemPrompt}\n\n## Skill\n\n${skill}`,
    userPrompt
  });

  if (result.error) {
    console.error(`Failed to generate lesson plan: ${result.error}`);
    process.exit(1);
  }

  // Write plan to file
  const filename = `${lessonId}-${description.slice(0, 30).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')}.md`;
  const outputPath = join(plansDir, 'lessons', filename);

  await writeFile(outputPath, result.output);

  console.log(`
Lesson plan created!

Location: plans/lessons/${filename}

Next steps:
  1. Review the suggested lesson structure
  2. Refine if needed
  3. Add to CLAUDE.md (copy the "## Final Lesson" section)
  4. Archive this plan: move to plans/lessons/archive/
`);
}

export async function archiveLesson(lessonFile: string) {
  const cliRoot = join(__dirname, '..', '..');
  const lessonsDir = join(cliRoot, 'plans', 'lessons');
  const archiveDir = join(lessonsDir, 'archive');

  const sourcePath = join(lessonsDir, lessonFile);
  const destPath = join(archiveDir, lessonFile);

  try {
    await rename(sourcePath, destPath);
    console.log(`Archived: ${lessonFile} -> plans/lessons/archive/`);
  } catch (err) {
    console.error(`Failed to archive ${lessonFile}: ${err}`);
  }
}
