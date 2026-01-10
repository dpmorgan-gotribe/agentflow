import { readFile, readdir, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { loadSystemPrompt, loadSkill } from '../lib/agent.js';
import { runWorkersParallel } from '../lib/worker.js';
import { validateAndCleanHTML, isValidHTMLStructure } from '../lib/validation.js';

interface ScreenInfo {
  id: string;
  name: string;
  file: string;
}

interface Userflow {
  id: string;
  name: string;
  screens: ScreenInfo[];
}

interface ScreensJson {
  screens: string[];
  userflows: Userflow[];
}

interface ScreensOptions {
  limit?: string;
}

export async function screens(options: ScreensOptions = {}) {
  const projectDir = process.cwd();

  let uniqueScreens: string[] = [];
  let userflows: Userflow[] = [];

  // Try to load screens.json first (preferred source)
  const screensJsonPath = join(projectDir, 'outputs', 'analysis', 'screens.json');
  try {
    const screensJsonContent = await readFile(screensJsonPath, 'utf-8');
    const screensData: ScreensJson = JSON.parse(screensJsonContent);

    // Use the flat screens array directly
    uniqueScreens = screensData.screens.map(s => s.replace('.html', ''));
    userflows = screensData.userflows || [];

    console.log(`Loaded ${uniqueScreens.length} screen(s) from screens.json`);
    if (userflows.length > 0) {
      console.log(`Found ${userflows.length} userflow(s): ${userflows.map(u => u.name).join(', ')}`);
    }
  } catch {
    // Fall back to extracting from flow HTML files
    console.log('screens.json not found, extracting from flow HTMLs...');

    const flowsDir = join(projectDir, 'outputs', 'flows');
    let flowFiles: string[];
    try {
      flowFiles = await readdir(flowsDir);
    } catch {
      console.error('No outputs/flows/ directory found.');
      console.error('Run `agentflow flows` first.');
      process.exit(1);
    }

    // Read all flows and extract screens
    const screens: { name: string; flow: string }[] = [];
    for (const file of flowFiles) {
      if (file.endsWith('.html')) {
        const content = await readFile(join(flowsDir, file), 'utf-8');
        // Extract screen names from flow mockup (look for screen divs/sections)
        const screenMatches = content.match(/id="screen-(\w+)"/g) || [];
        for (const match of screenMatches) {
          const name = match.replace(/id="screen-/, '').replace(/"/, '');
          screens.push({ name, flow: file });
        }
      }
    }

    // Deduplicate screens
    uniqueScreens = [...new Set(screens.map(s => s.name))];
  }

  if (uniqueScreens.length === 0) {
    console.error('No screens found.');
    console.error('Either:');
    console.error('  1. Run `agentflow analyze` to generate screens.json');
    console.error('  2. Run `agentflow flows` with id="screen-[name]" elements');
    process.exit(1);
  }

  // Apply limit if specified
  const limit = options.limit ? parseInt(options.limit) : undefined;
  if (limit && limit > 0 && limit < uniqueScreens.length) {
    console.log(`Limiting to first ${limit} of ${uniqueScreens.length} screens`);
    uniqueScreens = uniqueScreens.slice(0, limit);
  }

  console.log(`Generating ${uniqueScreens.length} unique screen(s)`);

  // Load stylesheet
  let stylesheetContent: string;
  try {
    stylesheetContent = await readFile(
      join(projectDir, 'outputs', 'stylesheet', 'showcase.html'),
      'utf-8'
    );
  } catch {
    console.error('No stylesheet found.');
    console.error('Run `agentflow stylesheet` first.');
    process.exit(1);
  }

  // Load skill and system prompt
  const systemPrompt = await loadSystemPrompt(projectDir, 'ui-designer');
  const skill = await loadSkill(projectDir, 'design/design-screen');

  // Create worker tasks (one per screen)
  const workerTasks = uniqueScreens.map((screenName, index) => ({
    id: `screen-${String(index + 1).padStart(2, '0')}`,
    systemPrompt: `${systemPrompt}\n\n## Skill\n\n${skill}`,
    userPrompt: `Create the full design for screen: ${screenName}\n\nUse the stylesheet:\n${stylesheetContent}`
  }));

  // Run workers in parallel
  const results = await runWorkersParallel(workerTasks);

  // Write outputs
  const outputDir = join(projectDir, 'outputs', 'screens');
  await mkdir(outputDir, { recursive: true });

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.output) {
      const filename = `${result.id}-${uniqueScreens[i]}.html`;
      const outputPath = join(outputDir, filename);

      // Check if file already exists with valid HTML
      let existingContent = '';
      try {
        existingContent = await readFile(outputPath, 'utf-8');
      } catch {
        // File doesn't exist yet
      }

      // Validate the output
      const validation = validateAndCleanHTML(result.output);

      // Only write if existing file is not valid HTML or new output is valid
      if (!isValidHTMLStructure(existingContent) || validation.valid) {
        await writeFile(outputPath, validation.content);

        if (validation.valid) {
          successCount++;
          if (validation.extracted) {
            console.log(`  ${result.id}: extracted HTML from mixed output`);
          }
        } else {
          console.warn(`  ${result.id}: validation failed - ${validation.errors.join(', ')}`);
          failCount++;
        }
      } else {
        console.log(`  ${result.id}: kept existing valid HTML`);
        successCount++;
      }
    }
  }

  if (failCount > 0) {
    console.warn(`\nWarning: ${failCount} screen(s) may have invalid HTML`);
  }

  console.log(`
All screens complete!

Outputs written to outputs/screens/

Design pipeline finished!
`);
}
