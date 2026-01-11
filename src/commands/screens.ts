import { readFile, readdir, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { loadSystemPrompt, loadSkill } from '../lib/agent.js';
import { runWorkersParallel } from '../lib/worker.js';
import { validateAndCleanHTML, isValidHTMLStructure } from '../lib/validation.js';
import { detectPlatforms, resolvePlatform, getPlatformOutputDir, getSharedAnalysisDir, resolveSkill } from '../lib/platforms.js';

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
  platform?: string;
  force?: boolean;
  batch?: string;
  skill?: string;
}

export async function screens(options: ScreensOptions = {}) {
  const projectDir = process.cwd();

  // Detect platforms
  const platforms = await detectPlatforms(projectDir);
  const isMultiPlatform = platforms.length > 0;
  const platform = isMultiPlatform ? await resolvePlatform(projectDir, options.platform) : null;

  // Resolve which layout skill to use
  const skillType = resolveSkill(platform || 'webapp', options.skill);

  if (isMultiPlatform && platform) {
    console.log(`Generating screens for platform: ${platform}, skill: ${skillType}`);
  } else {
    console.log(`Generating screens with skill: ${skillType}`);
  }

  // Determine paths
  const analysisDir = isMultiPlatform
    ? getSharedAnalysisDir(projectDir)
    : join(projectDir, 'outputs', 'analysis');

  const platformAnalysisDir = isMultiPlatform && platform
    ? getPlatformOutputDir(projectDir, 'analysis', platform)
    : analysisDir;

  let uniqueScreens: string[] = [];
  let userflows: Userflow[] = [];

  // Try to load screens.json first (preferred source, platform-specific if multi-platform)
  const screensJsonPath = join(platformAnalysisDir, 'screens.json');
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

    const flowsDir = isMultiPlatform && platform
      ? getPlatformOutputDir(projectDir, 'flows', platform)
      : join(projectDir, 'outputs', 'flows');

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

  // Determine output directory
  const outputDir = isMultiPlatform && platform
    ? getPlatformOutputDir(projectDir, 'screens', platform)
    : join(projectDir, 'outputs', 'screens');

  await mkdir(outputDir, { recursive: true });

  // Check for existing valid screens (skip if not --force)
  let screensToGenerate = uniqueScreens;
  let skippedCount = 0;

  if (!options.force) {
    const pending: string[] = [];
    for (let i = 0; i < uniqueScreens.length; i++) {
      const screenName = uniqueScreens[i];
      const filename = `screen-${String(i + 1).padStart(2, '0')}-${screenName}.html`;
      const outputPath = join(outputDir, filename);

      try {
        const existingContent = await readFile(outputPath, 'utf-8');
        if (isValidHTMLStructure(existingContent)) {
          skippedCount++;
          continue;
        }
      } catch {
        // File doesn't exist
      }
      pending.push(screenName);
    }
    screensToGenerate = pending;

    if (skippedCount > 0) {
      console.log(`Skipping ${skippedCount} existing valid screen(s)`);
    }
  }

  if (screensToGenerate.length === 0) {
    console.log('\nAll screens already generated and valid!');
    console.log('Use --force to regenerate all screens.');
    return;
  }

  console.log(`Generating ${screensToGenerate.length} screen(s)${options.force ? ' (forced)' : ''}`);

  // Load stylesheet (platform-specific if multi-platform)
  const stylesheetDir = isMultiPlatform && platform
    ? getPlatformOutputDir(projectDir, 'stylesheet', platform)
    : join(projectDir, 'outputs', 'stylesheet');

  let stylesheetContent: string;
  try {
    stylesheetContent = await readFile(join(stylesheetDir, 'showcase.html'), 'utf-8');
  } catch {
    console.error('No stylesheet found.');
    console.error('Run `agentflow stylesheet` first.');
    process.exit(1);
  }

  // Load skill and system prompt (use platform-specific skill)
  const systemPrompt = await loadSystemPrompt(projectDir, 'ui-designer');
  const skillName = `design/design-screen-${skillType}`;
  let skill: string;
  try {
    skill = await loadSkill(projectDir, skillName);
  } catch {
    // Fallback to generic skill if platform-specific doesn't exist
    console.log(`Skill ${skillName} not found, falling back to design-screen`);
    skill = await loadSkill(projectDir, 'design/design-screen');
  }

  // Get indices for screen naming (maintain original numbering)
  const screenIndices = screensToGenerate.map(name => uniqueScreens.indexOf(name));

  // Create worker tasks (one per screen)
  const workerTasks = screensToGenerate.map((screenName, i) => ({
    id: `screen-${String(screenIndices[i] + 1).padStart(2, '0')}`,
    systemPrompt: `${systemPrompt}\n\n## Skill\n\n${skill}`,
    userPrompt: `Create the full design for screen: ${screenName}${platform ? ` (${platform} platform)` : ''}\n\nUse the stylesheet:\n${stylesheetContent}`
  }));

  // Run workers in parallel
  const results = await runWorkersParallel(workerTasks);

  // Write outputs
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.output) {
      const screenName = screensToGenerate[i];
      const filename = `${result.id}-${screenName}.html`;
      const outputPath = join(outputDir, filename);

      // Validate the output
      const validation = validateAndCleanHTML(result.output);

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
    }
  }

  if (failCount > 0) {
    console.warn(`\nWarning: ${failCount} screen(s) may have invalid HTML`);
  }

  const totalGenerated = successCount + skippedCount;
  const outputPathDisplay = isMultiPlatform && platform
    ? `outputs/screens/${platform}/`
    : 'outputs/screens/';

  console.log(`
Screen generation complete!

Outputs written to ${outputPathDisplay}
  Generated: ${successCount} screen(s)
  Skipped: ${skippedCount} existing valid screen(s)
  Failed: ${failCount} screen(s)
  Total: ${totalGenerated}/${uniqueScreens.length}

Design pipeline finished!
`);
}
