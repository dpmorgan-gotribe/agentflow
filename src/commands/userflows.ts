import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { loadSystemPrompt, loadSkill } from '../lib/agent.js';
import { runWorkerSequential } from '../lib/worker.js';
import { validateAndCleanHTML } from '../lib/validation.js';
import {
  detectPlatforms,
  getPlatformOutputDir,
  getSharedAnalysisDir
} from '../lib/platforms.js';

interface UserflowsOptions {
  platform?: string;
}

export async function userflows(options: UserflowsOptions = {}) {
  const projectDir = process.cwd();

  console.log('\nGenerating userflows diagram...');

  // Detect platforms
  const platforms = await detectPlatforms(projectDir);
  const isMultiPlatform = platforms.length > 0;

  // Load analysis data
  const analysisDir = isMultiPlatform
    ? getSharedAnalysisDir(projectDir)
    : join(projectDir, 'outputs', 'analysis');

  // Load screens.json for all platforms (or single platform)
  const allScreensData: Record<string, unknown> = {};

  if (isMultiPlatform) {
    for (const platform of platforms) {
      const platformAnalysisDir = getPlatformOutputDir(projectDir, 'analysis', platform);
      try {
        const content = await readFile(join(platformAnalysisDir, 'screens.json'), 'utf-8');
        allScreensData[platform] = JSON.parse(content);
        console.log(`  Loaded screens.json for ${platform}`);
      } catch {
        console.warn(`  Warning: No screens.json for platform: ${platform}`);
      }
    }
  } else {
    try {
      const content = await readFile(join(analysisDir, 'screens.json'), 'utf-8');
      allScreensData['default'] = JSON.parse(content);
      console.log('  Loaded screens.json');
    } catch {
      console.error('screens.json not found. Run `agentflow analyze` first.');
      process.exit(1);
    }
  }

  if (Object.keys(allScreensData).length === 0) {
    console.error('No screens data found. Run `agentflow analyze` first.');
    process.exit(1);
  }

  // Load navigation schema if available
  let navSchema: string | null = null;
  const navSchemaLocations = isMultiPlatform
    ? platforms.map(p => join(getPlatformOutputDir(projectDir, 'analysis', p), 'navigation-schema.md'))
    : [join(analysisDir, 'navigation-schema.md')];

  for (const navSchemaPath of navSchemaLocations) {
    try {
      const content = await readFile(navSchemaPath, 'utf-8');
      // Extract YAML from markdown
      const yamlMatch = content.match(/```yaml\n([\s\S]*?)```/);
      if (yamlMatch) {
        navSchema = (navSchema ? navSchema + '\n\n' : '') + yamlMatch[1];
      }
    } catch {
      // Skip if not found
    }
  }

  if (navSchema) {
    console.log('  Loaded navigation schema');
  } else {
    console.log('  No navigation-schema.md found, will infer from screens.json');
  }

  // Load skill and system prompt
  const systemPrompt = await loadSystemPrompt(projectDir, 'ui-designer');
  const skill = await loadSkill(projectDir, 'design/design-userflows');

  // Create worker task
  const task = {
    id: 'userflows',
    systemPrompt: `${systemPrompt}\n\n## Skill\n\n${skill}`,
    userPrompt: `Generate a userflows.html diagram.

## Screen Data (per platform)
${JSON.stringify(allScreensData, null, 2)}

## Navigation Schema
${navSchema || 'Not available - infer navigation states from screens.json apps/sections if present, otherwise use sensible defaults.'}

## Requirements
- Create app tabs for each platform: ${Object.keys(allScreensData).join(', ')}
- Create flow tabs for each userflow within each platform
- Show box diagrams with navigation zones (header/sidemenu/content/footer)
- Connect screens with arrows showing flow direction
- Mark orphaned screens (not in any flow) with red border
- Hover on screen shows navigation state

## Output
Generate a complete, self-contained HTML file with inline CSS and JavaScript.
The file should be immediately viewable in a browser.
`
  };

  console.log('  Invoking UI Designer agent...');
  const result = await runWorkerSequential(task);

  if (!result.output) {
    console.error('Failed to generate userflows diagram.');
    process.exit(1);
  }

  // Validate HTML output
  const validation = validateAndCleanHTML(result.output);

  // Write output
  const outputDir = join(projectDir, 'outputs', 'userflows');
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'userflows.html'), validation.content);

  if (!validation.valid) {
    console.warn('  Warning: Generated HTML may have issues');
  }

  console.log(`
Userflows diagram generated!

Output: outputs/userflows/userflows.html

Open in browser to:
- Switch between app tabs (${Object.keys(allScreensData).join(', ')})
- View flow sequences with navigation zones
- Validate sidemenu/header/footer states
- Identify orphaned screens (red border)
`);
}
