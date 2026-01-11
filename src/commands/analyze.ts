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
import {
  detectPlatforms,
  loadAllBriefs,
  isMultiPlatform,
  getCombinedBrief,
  getPlatformOutputDir,
  getSharedAnalysisDir
} from '../lib/platforms.js';
import {
  generateCoverageReport,
  generateDetailedCoverageReport,
  printCoverageReport,
  printDetailedCoverageReport
} from '../lib/verification.js';

interface AnalyzeOptions {
  verify?: boolean;
  useAssets?: boolean;
}

export async function analyze(styleCount: number = 1, options: AnalyzeOptions = {}) {
  const projectDir = process.cwd();

  console.log(`\nAnalyzing project with ${styleCount} style(s)...`);
  if (options.useAssets) {
    console.log('  Asset Mode: All styles use user assets (variations of user vision)');
    console.log(`  Style 0-${styleCount - 1}: Variations using user icons, colors, and layout patterns\n`);
  } else {
    console.log('  Style 0: User\'s vision (from brief)');
    if (styleCount > 1) {
      console.log(`  Style 1-${styleCount - 1}: Research-inspired alternatives\n`);
    }
  }

  // Detect platforms
  const platforms = await detectPlatforms(projectDir);
  const briefs = await loadAllBriefs(projectDir);
  const multiPlatform = isMultiPlatform(briefs);

  if (multiPlatform) {
    console.log(`Detected platforms: ${platforms.join(', ')}`);
    for (const pb of briefs.platforms) {
      console.log(`  ${pb.platform}: ~${pb.screenCount} screens`);
    }
    console.log('');
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

  // Get combined brief for shared analysis
  const combinedBrief = multiPlatform ? getCombinedBrief(briefs) : await loadBrief(projectDir);

  if (!multiPlatform && isBriefEmpty(combinedBrief)) {
    console.warn('Warning: brief.md is empty. Analysis will be based on wireframes only.');
    console.warn('Edit brief.md to provide project context for better results.\n');
  } else {
    console.log('Loaded project brief(s)');
  }

  // Load system prompt
  const systemPrompt = await loadSystemPrompt(projectDir, 'analyst');

  // Create output directories
  const sharedDir = multiPlatform ? getSharedAnalysisDir(projectDir) : join(projectDir, 'outputs', 'analysis');
  await mkdir(sharedDir, { recursive: true });

  if (multiPlatform) {
    for (const platform of platforms) {
      const platformDir = getPlatformOutputDir(projectDir, 'analysis', platform);
      await mkdir(platformDir, { recursive: true });
    }
  }

  // PHASE 1: Run research worker first (sequential)
  console.log('\n--- Phase 1: Research ---');
  const researchSkill = await loadSkill(projectDir, 'analysis/analyze-research');
  const researchResult = await runWorkerSequential({
    id: 'research',
    systemPrompt: `${systemPrompt}\n\n## Skill\n\n${researchSkill}`,
    userPrompt: `Research competitors and best practices for this project.

## Project Brief
${combinedBrief || 'No brief provided. Infer app type from wireframes.'}

## Wireframes
Files in assets/wireframes/: ${images.join(', ')}

## Style Count
Generate research for ${styleCount} styles total.
- Style 0 will be based on user's brief (no research needed for this)
- Research ${styleCount - 1} competitors to inspire Style 1 through Style ${styleCount - 1}

Produce output according to the skill format.`
  });

  // Write research output (shared)
  if (researchResult.output) {
    await writeFile(join(sharedDir, 'research.md'), stripPreamble(researchResult.output));
    console.log('  Written: research.md');
  }

  // PHASE 2: Run shared analysis workers in parallel
  console.log('\n--- Phase 2: Shared Analysis (parallel) ---');

  const sharedTasks = [
    { id: 'styles', skill: 'analysis/analyze-styles' },
    { id: 'assets', skill: 'analysis/analyze-assets' },
    { id: 'inspirations', skill: 'analysis/analyze-inspirations' }
  ];

  // Build icon and logo info
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

  const wireframeReadInstruction = `
IMPORTANT: You have access to the Read tool. USE IT to view the wireframe images.
The wireframes are in: ${wireframesDir}
Available wireframes: ${images.join(', ')}

Read and analyze the wireframe images to understand:
- Screen layouts and component placement
- Navigation patterns and user flows
- UI elements and their arrangement
`;

  const sharedWorkerTasks = await Promise.all(sharedTasks.map(async (task) => {
    const skill = await loadSkill(projectDir, task.skill);

    let userPrompt: string;
    let needsWireframeAccess = false;

    if (task.id === 'styles') {
      needsWireframeAccess = true;

      // Build asset mode instruction
      const assetModeInstruction = options.useAssets
        ? `## ASSET MODE: useAssets=true
ALL styles (0 through ${styleCount - 1}) MUST:
- Use user icons from assets/icons/ (paths listed below)
- Use colors from the brief (NOT research competitors)
- Follow wireframe layout patterns

Styles vary ONLY in: typography, spacing, component styling, visual characteristics.
This creates variations of the user's vision, not research-inspired alternatives.

IMPORTANT: Add this metadata at the very top of your output:
<!-- assetMode: useAssets -->
`
        : `## ASSET MODE: standard
- Style 0: Uses user assets (icons, colors from brief)
- Style 1+: Uses library icons and research-inspired colors

IMPORTANT: Add this metadata at the very top of your output:
<!-- assetMode: standard -->
`;

      const iconInstructionForAllStyles = options.useAssets
        ? `## User Icons (REQUIRED FOR ALL STYLES)
ALL styles must use these icons from assets/icons/:
${userIcons.map(f => `- ${f}`).join('\n') || 'No icons found'}

Reference with: <img src="../../assets/icons/[filename]" alt="..." />`
        : iconInventory;

      userPrompt = `Analyze visual styles for this project.
${wireframeReadInstruction}

${assetModeInstruction}

CRITICAL FOR ALL STYLES:
- Extract LAYOUT patterns from wireframes (navigation, screens, component placement)
- Colors come from the BRIEF, NOT wireframes (wireframe colors are grayscale placeholders)

${logoInfo}

${iconInstructionForAllStyles}

## Project Brief
${combinedBrief || 'No brief provided. Analyze based on wireframes only.'}

## Wireframes
Files in assets/wireframes/: ${images.join(', ')}

## Competitive Research
${researchResult.output || 'No research available.'}

## Style Count
Generate ${styleCount} complete style definitions:
${options.useAssets
  ? `ALL styles (0-${styleCount - 1}) are variations of the user's vision:
- All use user icons from assets/icons/
- All use colors from brief
- Vary typography, spacing, component styling, visual characteristics
- Style 0: Baseline user vision
- Style 1+: Creative variations (different fonts, spacing, component styles)`
  : `- Style 0: Based on user's brief, wireframe LAYOUTS, and user icons
${styleCount > 1 ? `- Style 1-${styleCount - 1}: Based on competitor research above (use library icons)` : ''}`}

Produce output according to the skill format.`;
    } else {
      userPrompt = `Analyze the project and produce output according to the skill.

## Project Brief
${combinedBrief || 'No brief provided. Analyze based on wireframes only.'}

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

    return {
      id: task.id,
      systemPrompt: `${systemPrompt}\n\n## Skill\n\n${skill}`,
      userPrompt,
      allowRead: needsWireframeAccess,
      addDirs: needsWireframeAccess ? [wireframesDir] : []
    };
  }));

  const sharedResults = await runWorkersParallel(sharedWorkerTasks);

  // Write shared outputs
  for (const result of sharedResults) {
    if (result.output) {
      await writeFile(join(sharedDir, `${result.id}.md`), stripPreamble(result.output));
    }
  }

  // PHASE 3: Run platform-specific analysis (flows and screens per platform)
  if (multiPlatform) {
    console.log('\n--- Phase 3: Platform Analysis ---');

    for (const platformBrief of briefs.platforms) {
      const platform = platformBrief.platform;
      console.log(`\nPlatform: ${platform}`);

      const platformDir = getPlatformOutputDir(projectDir, 'analysis', platform);

      // Flows worker for this platform
      const flowsSkill = await loadSkill(projectDir, 'analysis/analyze-flows');
      const flowsResult = await runWorkerSequential({
        id: `flows-${platform}`,
        systemPrompt: `${systemPrompt}\n\n## Skill\n\n${flowsSkill}`,
        userPrompt: `Analyze user flows and journeys for the ${platform} platform.
${wireframeReadInstruction}

CRITICAL: Output USER FLOWS only. Do NOT output:
- Color palettes
- Typography definitions
- Spacing systems
- Style analysis

Your output MUST follow the skill format with "## Flow N: [Name]" headers.

## Platform: ${platform}
This analysis is specifically for the ${platform} platform screens.

## Platform Screen Inventory
${platformBrief.content}

## Main Project Brief
${briefs.main || 'No main brief provided.'}

## Wireframes
Files in assets/wireframes/: ${images.join(', ')}

## Competitive Research (for flow patterns only)
${researchResult.output || 'No research available.'}

Produce output according to the skill format. Remember: FLOWS ONLY, not styles.`,
        allowRead: true,
        addDirs: [wireframesDir]
      });

      if (flowsResult.output) {
        await writeFile(join(platformDir, 'flows.md'), stripPreamble(flowsResult.output));
        console.log(`  Written: ${platform}/flows.md`);
      }

      // Screens worker for this platform
      const screensSkill = await loadSkill(projectDir, 'analysis/analyze-screens');
      const iconInventoryForScreens = userIcons.length > 0
        ? `## Available User Icons
The following icons are available in assets/icons/:
${userIcons.map(f => `- ${f.replace(/\.(svg|png)$/i, '')}`).join('\n')}

Use these exact icon names when identifying icons for screens.`
        : '## User Icons\nNo user icons found in assets/icons/';

      const screensResult = await runWorkerSequential({
        id: `screens-${platform}`,
        systemPrompt: `${systemPrompt}\n\n## Skill\n\n${screensSkill}`,
        userPrompt: `Extract all screens, their required UI components, AND required icons for the ${platform} platform.

## Platform: ${platform}
This analysis is specifically for the ${platform} platform.

## Platform Screen Inventory
${platformBrief.content}

## Flows Analysis
${flowsResult.output ? stripPreamble(flowsResult.output) : 'No flows available.'}

## Main Project Brief (for component and icon context)
${briefs.main || 'No main brief provided.'}

${iconInventoryForScreens}

For each screen, identify:
1. UI components needed (header, bottom-nav, card, button-primary, modal, form-input, avatar, badge, etc.)
2. Icons needed (navigation icons, action icons, tab icons, feature icons)

Output ONLY valid JSON with this structure:
{
  "platform": "${platform}",
  "screens": ["screen-name.html", ...],
  "userflows": [{ "id": "...", "name": "...", "screens": [...] }, ...],
  "components": ["header", "bottom-nav", "card", "button-primary", ...],
  "screenComponents": {
    "screen-name": ["header", "bottom-nav", "card"],
    ...
  },
  "icons": ["home", "search", "notifications", "menu", ...],
  "screenIcons": {
    "screen-name": ["menu", "search", "home"],
    ...
  }
}

No markdown, no explanations, just JSON.`
      });

      if (screensResult.output) {
        let jsonContent = screensResult.output.trim();
        if (jsonContent.startsWith('```')) {
          jsonContent = jsonContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }

        try {
          const parsed = JSON.parse(jsonContent);
          await writeFile(join(platformDir, 'screens.json'), JSON.stringify(parsed, null, 2));
          console.log(`  Written: ${platform}/screens.json`);
          if (parsed.screens) {
            console.log(`  Found ${parsed.screens.length} screens`);
          }
          if (parsed.components) {
            console.log(`  Found ${parsed.components.length} unique components`);
          }
          if (parsed.icons) {
            console.log(`  Found ${parsed.icons.length} unique icons`);
          }
        } catch {
          console.warn(`  Warning: ${platform}/screens.json output was not valid JSON, skipping`);
        }
      }
    }
  } else {
    // Single platform analysis (legacy behavior)
    console.log('\n--- Phase 3: Screen, Component & Icon Mapping ---');

    const flowsSkill = await loadSkill(projectDir, 'analysis/analyze-flows');
    const flowsResult = await runWorkerSequential({
      id: 'flows',
      systemPrompt: `${systemPrompt}\n\n## Skill\n\n${flowsSkill}`,
      userPrompt: `Analyze user flows and journeys for this project.
${wireframeReadInstruction}

CRITICAL: Output USER FLOWS only. Do NOT output:
- Color palettes
- Typography definitions
- Spacing systems
- Style analysis

Your output MUST follow the skill format with "## Flow N: [Name]" headers.

## Project Brief
${combinedBrief || 'No brief provided. Analyze based on wireframes only.'}

## Wireframes
Files in assets/wireframes/: ${images.join(', ')}

## Competitive Research (for flow patterns only)
${researchResult.output || 'No research available.'}

Produce output according to the skill format. Remember: FLOWS ONLY, not styles.`,
      allowRead: true,
      addDirs: [wireframesDir]
    });

    if (flowsResult.output) {
      await writeFile(join(sharedDir, 'flows.md'), stripPreamble(flowsResult.output));
      console.log('  Written: flows.md');
    }

    // Screens mapping
    if (flowsResult.output) {
      const screensSkill = await loadSkill(projectDir, 'analysis/analyze-screens');
      const iconInventoryForScreens = userIcons.length > 0
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
${stripPreamble(flowsResult.output)}

## Project Brief (for component and icon context)
${combinedBrief || 'No brief provided.'}

${iconInventoryForScreens}

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
  "icons": ["home", "search", "notifications", "menu", ...],
  "screenIcons": {
    "screen-name": ["menu", "search", "home"],
    ...
  }
}

No markdown, no explanations, just JSON.`
      });

      if (screensResult.output) {
        let jsonContent = screensResult.output.trim();
        if (jsonContent.startsWith('```')) {
          jsonContent = jsonContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }

        try {
          const parsed = JSON.parse(jsonContent);
          await writeFile(join(sharedDir, 'screens.json'), JSON.stringify(parsed, null, 2));
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
    }
  }

  // Create per-style asset directories
  const stylesDir = join(projectDir, 'assets', 'styles');
  for (let i = 0; i < styleCount; i++) {
    const styleDir = join(stylesDir, `style-${i}`);
    await mkdir(join(styleDir, 'fonts'), { recursive: true });
    await mkdir(join(styleDir, 'icons'), { recursive: true });
    await writeFile(
      join(styleDir, 'palette.json'),
      JSON.stringify({ note: 'Populate from styles.md' }, null, 2)
    );
  }

  // Coverage report
  if (multiPlatform) {
    console.log('\n--- Coverage Report ---');
    for (const platformBrief of briefs.platforms) {
      const report = options.verify
        ? await generateDetailedCoverageReport(projectDir, platformBrief.platform, platformBrief.content)
        : await generateCoverageReport(projectDir, platformBrief.platform, platformBrief.content);

      if (options.verify) {
        printDetailedCoverageReport(report as any);
      } else {
        printCoverageReport(report);
      }
    }
    if (!options.verify) {
      console.log('\n  Use --verify for detailed breakdown');
    }
  }

  // Summary
  if (multiPlatform) {
    console.log(`
Analysis complete!

Shared outputs in outputs/analysis/shared/
  - research.md      (competitive analysis)
  - styles.md        (${styleCount} style options)
  - assets.md        (per-style assets)
  - inspirations.md  (mood board)

Platform outputs in outputs/analysis/{platform}/
${platforms.map(p => `  - ${p}/flows.md, ${p}/screens.json`).join('\n')}

Asset directories created:
  - assets/styles/style-0/ through style-${styleCount - 1}/

Next: Review the outputs, then run:
  agentflow mockups --platform=${platforms[0]}
`);
  } else {
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
}
