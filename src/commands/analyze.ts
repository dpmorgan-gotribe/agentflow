import { readdir, writeFile, mkdir } from 'fs/promises';

// Strip preamble text before the first markdown header
function stripPreamble(content: string): string {
  const headerMatch = content.match(/^#\s/m);
  if (headerMatch && headerMatch.index !== undefined && headerMatch.index > 0) {
    return content.slice(headerMatch.index);
  }
  return content;
}
import { join } from 'path';
import { loadSystemPrompt, loadSkill } from '../lib/agent.js';
import { runWorkersParallel, runWorkerSequential } from '../lib/worker.js';
import { loadBrief, isBriefEmpty } from '../lib/brief.js';

export async function analyze(styleCount: number = 1) {
  const projectDir = process.cwd();

  console.log(`\nAnalyzing project with ${styleCount} style(s)...`);
  console.log('  Style 0: User\'s vision (from brief)');
  if (styleCount > 1) {
    console.log(`  Style 1-${styleCount - 1}: Research-inspired alternatives\n`);
  }

  // Verify wireframes exist
  const wireframesDir = join(projectDir, 'assets', 'wireframes');
  let wireframes: string[];
  try {
    wireframes = await readdir(wireframesDir);
  } catch {
    console.error('No assets/wireframes/ directory found.');
    console.error('Run this command from a project created with `agentflow init`.');
    process.exit(1);
  }

  const images = wireframes.filter(f => /\.(png|jpg|jpeg|gif)$/i.test(f));

  if (images.length === 0) {
    console.error('No wireframes found in assets/wireframes/');
    console.error('Add PNG or JPG files and try again.');
    process.exit(1);
  }

  console.log(`Found ${images.length} wireframe(s)`);

  // Scan for user icons
  const iconsDir = join(projectDir, 'assets', 'icons');
  let userIcons: string[] = [];
  try {
    const iconFiles = await readdir(iconsDir);
    userIcons = iconFiles.filter(f => /\.(svg|png)$/i.test(f));
    console.log(`Found ${userIcons.length} user icon(s)`);
  } catch {
    // No icons directory - that's ok
  }

  // Scan for user logos
  const logosDir = join(projectDir, 'assets', 'logos');
  let userLogos: string[] = [];
  try {
    const logoFiles = await readdir(logosDir);
    userLogos = logoFiles.filter(f => /\.(svg|png|jpg|jpeg)$/i.test(f));
    console.log(`Found ${userLogos.length} user logo(s)`);
  } catch {
    // No logos directory - that's ok
  }

  // Load project brief
  const brief = await loadBrief(projectDir);
  if (isBriefEmpty(brief)) {
    console.warn('Warning: brief.md is empty. Analysis will be based on wireframes only.');
    console.warn('Edit brief.md to provide project context for better results.\n');
  } else {
    console.log('Loaded project brief');
  }

  // Load system prompt
  const systemPrompt = await loadSystemPrompt(projectDir, 'analyst');

  // PHASE 1: Run research worker first (sequential)
  console.log('\n--- Phase 1: Research ---');
  const researchSkill = await loadSkill(projectDir, 'analysis/analyze-research');
  const researchResult = await runWorkerSequential({
    id: 'research',
    systemPrompt: `${systemPrompt}\n\n## Skill\n\n${researchSkill}`,
    userPrompt: `Research competitors and best practices for this project.

## Project Brief
${brief || 'No brief provided. Infer app type from wireframes.'}

## Wireframes
Files in assets/wireframes/: ${images.join(', ')}

## Style Count
Generate research for ${styleCount} styles total.
- Style 0 will be based on user's brief (no research needed for this)
- Research ${styleCount - 1} competitors to inspire Style 1 through Style ${styleCount - 1}

Produce output according to the skill format.`
  });

  // Write research output
  const outputDir = join(projectDir, 'outputs', 'analysis');
  await mkdir(outputDir, { recursive: true });

  if (researchResult.output) {
    await writeFile(join(outputDir, 'research.md'), stripPreamble(researchResult.output));
    console.log('  Written: research.md');
  }

  // PHASE 2: Run remaining workers in parallel (all receive research output)
  console.log('\n--- Phase 2: Analysis (parallel) ---');

  const tasks = [
    { id: 'styles', skill: 'analysis/analyze-styles' },
    { id: 'flows', skill: 'analysis/analyze-flows' },
    { id: 'assets', skill: 'analysis/analyze-assets' },
    { id: 'inspirations', skill: 'analysis/analyze-inspirations' }
  ];

  // Enable Read tool for workers that need to view wireframe images
  const wireframeReadInstruction = `
IMPORTANT: You have access to the Read tool. USE IT to view the wireframe images.
The wireframes are in: ${wireframesDir}
Available wireframes: ${images.join(', ')}

Read and analyze the wireframe images to understand:
- Screen layouts and component placement
- Navigation patterns and user flows
- UI elements and their arrangement
`;

  const workerTasks = await Promise.all(tasks.map(async (task) => {
    const skill = await loadSkill(projectDir, task.skill);

    // Customize user prompt based on worker type
    let userPrompt: string;

    if (task.id === 'flows') {
      // Flows worker: Focus on user journeys, NOT styles
      userPrompt = `Analyze user flows and journeys for this project.
${wireframeReadInstruction}

CRITICAL: Output USER FLOWS only. Do NOT output:
- Color palettes
- Typography definitions
- Spacing systems
- Style analysis

Your output MUST follow the skill format with "## Flow N: [Name]" headers.

## Project Brief
${brief || 'No brief provided. Analyze based on wireframes only.'}

## Wireframes
Files in assets/wireframes/: ${images.join(', ')}

## Competitive Research (for flow patterns only)
${researchResult.output || 'No research available.'}

Produce output according to the skill format. Remember: FLOWS ONLY, not styles.`;
    } else if (task.id === 'styles') {
      // Styles worker: Full style analysis with icon inventory
      const iconInventory = userIcons.length > 0
        ? `## User Icons (for Style 0)
Available in assets/icons/:
${userIcons.map(f => `- ${f}`).join('\n')}

Include these in Style 0's "User Icons" section with their intended usage.`
        : '## User Icons\nNo user icons found in assets/icons/';

      const logoInfo = userLogos.length > 0
        ? `## User Logo
Available in assets/logos/: ${userLogos.join(', ')}
All styles should reference this logo.`
        : '';

      userPrompt = `Analyze visual styles for this project.
${wireframeReadInstruction}

CRITICAL FOR STYLE 0:
- Extract LAYOUT patterns from wireframes (navigation, screens, component placement)
- Colors come from the BRIEF, NOT wireframes (wireframe colors are grayscale placeholders)
- Include the user icon inventory in Style 0

${logoInfo}

${iconInventory}

## Project Brief
${brief || 'No brief provided. Analyze based on wireframes only.'}

## Wireframes
Files in assets/wireframes/: ${images.join(', ')}

## Competitive Research
${researchResult.output || 'No research available.'}

## Style Count
Generate ${styleCount} complete style definitions:
- Style 0: Based on user's brief, wireframe LAYOUTS, and user icons
${styleCount > 1 ? `- Style 1-${styleCount - 1}: Based on competitor research above (use library icons)` : ''}

Produce output according to the skill format.`;
    } else {
      // Other workers: Standard prompt (inspirations, assets - may not need wireframe vision)
      userPrompt = `Analyze the project and produce output according to the skill.

## Project Brief
${brief || 'No brief provided. Analyze based on wireframes only.'}

## Wireframes
Files in assets/wireframes/: ${images.join(', ')}

## Competitive Research
${researchResult.output || 'No research available.'}

## Style Count
Generate content for ${styleCount} styles:
- Style 0: Based on user's brief and existing assets
${styleCount > 1 ? `- Style 1-${styleCount - 1}: Based on competitor research above` : ''}

Produce output according to the skill format.`;
    }

    // Enable Read tool for workers that need to view wireframes
    const needsWireframeAccess = ['flows', 'styles'].includes(task.id);

    return {
      id: task.id,
      systemPrompt: `${systemPrompt}\n\n## Skill\n\n${skill}`,
      userPrompt,
      allowRead: needsWireframeAccess,
      addDirs: needsWireframeAccess ? [wireframesDir] : []
    };
  }));

  // Run workers in parallel
  const results = await runWorkersParallel(workerTasks);

  // Write outputs
  for (const result of results) {
    if (result.output) {
      await writeFile(join(outputDir, `${result.id}.md`), stripPreamble(result.output));
    }
  }

  // PHASE 3: Generate screens.json with component and icon mapping (needs flows output)
  console.log('\n--- Phase 3: Screen, Component & Icon Mapping ---');
  const flowsOutput = results.find(r => r.id === 'flows')?.output;
  if (flowsOutput) {
    const screensSkill = await loadSkill(projectDir, 'analysis/analyze-screens');

    // Build user icon inventory for the prompt
    const iconInventory = userIcons.length > 0
      ? `## Available User Icons
The following icons are available in assets/icons/:
${userIcons.map(f => `- ${f.replace(/\.(svg|png)$/i, '')}`).join('\n')}

Use these exact icon names when identifying icons for screens.`
      : '## User Icons\nNo user icons found in assets/icons/';

    const screensResult = await runWorkerSequential({
      id: 'screens',
      systemPrompt: `${systemPrompt}\n\n## Skill\n\n${screensSkill}`,
      userPrompt: `Extract all screens, their required UI components, AND required icons from the flows analysis below.

## Flows Analysis
${stripPreamble(flowsOutput)}

## Project Brief (for component and icon context)
${brief || 'No brief provided.'}

${iconInventory}

For each screen, identify:
1. UI components needed (header, bottom-nav, card, button-primary, modal, form-input, avatar, badge, etc.)
2. Icons needed (navigation icons, action icons, tab icons, feature icons)

Output ONLY valid JSON with this structure:
{
  "screens": ["screen-name.html", ...],
  "userflows": [{ "id": "...", "name": "...", "screens": [...] }, ...],
  "components": ["header", "bottom-nav", "card", "button-primary", ...],
  "screenComponents": {
    "screen-name": ["header", "bottom-nav", "card"],
    ...
  },
  "icons": ["home", "search", "notifications", "menu", "camping", ...],
  "screenIcons": {
    "screen-name": ["menu", "search", "home", "camping"],
    ...
  }
}

No markdown, no explanations, just JSON.`
    });

    if (screensResult.output) {
      // Try to extract valid JSON from the output
      let jsonContent = screensResult.output.trim();

      // Remove markdown code fences if present
      if (jsonContent.startsWith('```')) {
        jsonContent = jsonContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      // Validate it's valid JSON
      try {
        const parsed = JSON.parse(jsonContent);
        await writeFile(join(outputDir, 'screens.json'), JSON.stringify(parsed, null, 2));
        console.log('  Written: screens.json');
        if (parsed.components) {
          console.log(`  Found ${parsed.components.length} unique components`);
        }
        if (parsed.icons) {
          console.log(`  Found ${parsed.icons.length} unique icons`);
        }
      } catch {
        console.warn('  Warning: screens.json output was not valid JSON, skipping');
      }
    }
  } else {
    console.warn('  Warning: No flows output available, skipping screens.json');
  }

  // Create per-style asset directories
  const stylesDir = join(projectDir, 'assets', 'styles');
  for (let i = 0; i < styleCount; i++) {
    const styleDir = join(stylesDir, `style-${i}`);
    await mkdir(join(styleDir, 'fonts'), { recursive: true });
    await mkdir(join(styleDir, 'icons'), { recursive: true });
    // Create empty palette.json
    await writeFile(
      join(styleDir, 'palette.json'),
      JSON.stringify({ note: 'Populate from styles.md' }, null, 2)
    );
  }

  console.log(`
Analysis complete!

Outputs written to outputs/analysis/
  - research.md      (competitive analysis)
  - styles.md        (${styleCount} style options)
  - flows.md         (user journeys)
  - screens.json     (screens, userflows, and component mapping)
  - assets.md        (per-style assets)
  - inspirations.md  (mood board)

Asset directories created:
  - assets/styles/style-0/ through style-${styleCount - 1}/

Next: Review the outputs, then run:
  agentflow mockups
`);
}
