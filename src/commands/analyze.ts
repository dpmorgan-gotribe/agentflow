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
import {
  loadBrief,
  isBriefEmpty,
  extractNavigationSchema as extractBriefSchema,
  extractAllScreensFromSchema,
  formatScreenInventory,
  formatScreenList,
  getAllScreenIds,
  ExtractedAppScreens
} from '../lib/brief.js';
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
  printDetailedCoverageReport,
  extractNavigationSchema
} from '../lib/verification.js';
import {
  PlatformScreensJson,
  validateSchema,
  getScreensFilename,
  getAllComponents,
  getAllIcons,
  getCoverage,
  getPlatformId,
  detectAppType,
  getLayoutSkill
} from '../lib/navigation-schema.js';

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

  // Extract navigation schema from brief JSON (for consolidated briefs)
  let briefApps: ExtractedAppScreens[] = [];
  if (combinedBrief) {
    const briefSchema = extractBriefSchema(combinedBrief);
    if (briefSchema) {
      briefApps = extractAllScreensFromSchema(briefSchema);
      if (briefApps.length > 0) {
        console.log(`\nFound ${briefApps.length} app(s) in brief schema:`);
        for (const app of briefApps) {
          console.log(`  ${app.appId}: ${app.screens.length} screens (${app.appType})`);
        }
      }
    }
  }

  // Build helper function for asset mode instructions
  const buildAssetModeInstruction = (useAssets: boolean): string => {
    if (useAssets) {
      return `## ASSET MODE: useAssets=true
ALL styles (0 through ${styleCount - 1}) MUST:
- Use user icons from assets/icons/ (paths listed below)
- Use colors from the brief (NOT research competitors)
- Follow wireframe layout patterns

Styles vary ONLY in: typography, spacing, component styling, visual characteristics.
This creates variations of the user's vision, not research-inspired alternatives.

CRITICAL: Your output MUST start with: <!-- assetMode: useAssets -->
`;
    } else {
      return `## ASSET MODE: standard
- Style 0: Uses user assets (icons, colors from brief)
- Style 1+: Uses library icons and research-inspired colors

CRITICAL: Your output MUST start with: <!-- assetMode: standard -->
`;
    }
  };

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
    } else if (task.id === 'assets') {
      // Assets worker - needs useAssets mode handling
      const assetModeInstruction = buildAssetModeInstruction(options.useAssets || false);

      const iconInstructionForAssets = options.useAssets
        ? `## User Icons (REQUIRED FOR ALL STYLES)
ALL styles must use these icons from assets/icons/:
${userIcons.map(f => `- ${f}`).join('\n') || 'No icons found'}
`
        : iconInventory;

      userPrompt = `Inventory assets and provide recommendations for this project.

${assetModeInstruction}

${options.useAssets
  ? `**CRITICAL FOR useAssets MODE:**
ALL styles (0-${styleCount - 1}) MUST use the SAME colors from the brief.
ALL styles MUST use the same user icons from assets/icons/.
Styles vary ONLY in: font choices, spacing, visual characteristics.
Do NOT use competitor colors for ANY style.`
  : `Style 0: User assets from brief.
Style 1+: Competitor-inspired assets with different colors.`}

${logoInfo}

${iconInstructionForAssets}

## Project Brief
${combinedBrief || 'No brief provided. Analyze based on wireframes only.'}

## Wireframes
Files in assets/wireframes/: ${images.join(', ')}

## Competitive Research
${researchResult.output || 'No research available.'}

## Style Count
Generate asset recommendations for ${styleCount} styles.

Produce output according to the skill format.`;

    } else if (task.id === 'inspirations') {
      // Inspirations worker - needs useAssets mode handling
      const assetModeInstruction = buildAssetModeInstruction(options.useAssets || false);

      userPrompt = `Create mood board and inspirations for this project.

${assetModeInstruction}

${options.useAssets
  ? `**CRITICAL FOR useAssets MODE:**
All style inspirations should show variations of the user's vision.
Use the user's color palette (#6B9B37 green) as the foundation.
Show different typography, spacing, and visual treatments - not different brands.`
  : `Style 0: User's vision from brief.
Style 1+: Competitor-inspired alternatives.`}

## Project Brief
${combinedBrief || 'No brief provided. Analyze based on wireframes only.'}

## Wireframes
Files in assets/wireframes/: ${images.join(', ')}

## Competitive Research
${researchResult.output || 'No research available.'}

## Style Count
Generate inspirations for ${styleCount} styles.

Produce output according to the skill format.`;

    } else {
      // Generic fallback for any other tasks
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
        timeout: 600000, // 10 minutes for large screen inventories
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
        const strippedFlows = stripPreamble(flowsResult.output);
        await writeFile(join(platformDir, 'flows.md'), strippedFlows);
        console.log(`  Written: ${platform}/flows.md`);

        // Extract navigation schema from flows output
        const navSchema = extractNavigationSchema(strippedFlows);
        if (navSchema) {
          await writeFile(
            join(platformDir, 'navigation-schema.md'),
            `# Navigation Schema\n\n\`\`\`yaml\n${navSchema}\n\`\`\``
          );
          console.log(`  Written: ${platform}/navigation-schema.md`);
        }
      }

      // Screens worker for this platform - v3.0 single-app format
      const screensSkill = await loadSkill(projectDir, 'analysis/analyze-screens');
      const iconInventoryForScreens = userIcons.length > 0
        ? `## Available User Icons
The following icons are available in assets/icons/:
${userIcons.map(f => `- ${f.replace(/\.(svg|png)$/i, '')}`).join('\n')}

Use these exact icon names when identifying icons for screens.`
        : '## User Icons\nNo user icons found in assets/icons/';

      // Derive app metadata
      const platformId = getPlatformId(platform);
      const appType = detectAppType(platform);
      const layoutSkill = getLayoutSkill(appType);
      const appId = platform.includes('-') ? platform : `gotribe-${platformId}`;
      const appName = platform.charAt(0).toUpperCase() + platform.slice(1).replace('-', ' ');

      const MAX_RETRIES = 2;
      let validOutput: PlatformScreensJson | null = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 1) {
          console.log(`  Retry ${attempt}/${MAX_RETRIES} for ${platform}...`);
        }

        const screensResult = await runWorkerSequential({
          id: `screens-${platform}`,
          systemPrompt: `${systemPrompt}\n\n## Skill\n\n${screensSkill}`,
          timeout: 600000, // 10 minutes for large screen inventories
          userPrompt: `Extract all screens for the ${platform} platform in v3.0 single-app format.

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
3. Which flows this screen belongs to

OUTPUT v3.0 JSON FORMAT (SINGLE APP):
{
  "version": "3.0",
  "generatedAt": "${new Date().toISOString()}",
  "app": {
    "appId": "${appId}",
    "appName": "${appName}",
    "appType": "${appType}",
    "layoutSkill": "${layoutSkill}",
    "defaultNavigation": {
      "header": { "variant": "standard", "actions": ["search", "notifications"] },
      "footer": { "variant": "tab-bar", "tabs": ["home", "discover", "profile"] },
      "sidemenu": { "visible": false }
    },
    "screens": [
      {
        "id": "screen-id",
        "file": "screen-id.html",
        "name": "Screen Name",
        "description": "What this screen shows",
        "section": "section-id",
        "components": ["header", "bottom-nav", "card"],
        "icons": ["menu", "search", "home"],
        "flows": ["onboarding", "discovery"]
      }
    ]
  }
}

CRITICAL REQUIREMENTS:
1. Output SINGLE "app" object (NOT "apps" array)
2. Include ALL screens from the platform inventory
3. EVERY screen MUST have: components (min 2), icons (min 1), flows (min 1)
4. Use "miscellaneous" flow for screens not in any defined flow
${attempt > 1 ? '\n5. PREVIOUS ATTEMPT FAILED - ensure valid JSON with all required fields' : ''}

No markdown, no explanations, just JSON.`
        });

        if (screensResult.output) {
          let jsonContent = screensResult.output.trim();
          if (jsonContent.startsWith('```')) {
            jsonContent = jsonContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
          }

          try {
            const parsed = JSON.parse(jsonContent);

            // Validate v3.0 schema
            const validation = validateSchema(parsed);
            if (validation.valid) {
              validOutput = parsed as PlatformScreensJson;
              break;
            } else {
              console.warn(`  Schema validation failed:`);
              validation.errors.slice(0, 3).forEach(e => console.warn(`    - ${e}`));
              if (validation.warnings.length > 0) {
                validation.warnings.slice(0, 2).forEach(w => console.warn(`    ! ${w}`));
              }
            }
          } catch (e) {
            console.warn(`  Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}`);
          }
        }
      }

      // Write output (to shared directory with platform prefix)
      const screensFilename = getScreensFilename(platform);
      const screensPath = join(sharedDir, screensFilename);

      if (validOutput) {
        await writeFile(screensPath, JSON.stringify(validOutput, null, 2));
        console.log(`  Written: ${screensFilename}`);

        const screenCount = validOutput.app.screens.length;
        const components = getAllComponents(validOutput);
        const icons = getAllIcons(validOutput);
        const coverage = getCoverage(validOutput);

        console.log(`  Screens: ${screenCount}`);
        console.log(`  Components: ${components.length}`);
        console.log(`  Icons: ${icons.length}`);

        const status = coverage.percent === 100 ? '✓' : '⚠';
        console.log(`  ${status} Flow Coverage: ${coverage.inFlows}/${coverage.total} (${coverage.percent}%)`);
        if (coverage.orphaned.length > 0 && coverage.orphaned.length <= 5) {
          console.log(`    Orphaned: ${coverage.orphaned.join(', ')}`);
        }
      } else {
        console.warn(`  Warning: Failed to generate valid v3.0 schema for ${platform}`);
      }
    }
  } else {
    // Single platform analysis (with brief schema support)
    console.log('\n--- Phase 3: Screen, Component & Icon Mapping ---');

    // Build screen inventory from brief schema if available
    const screenInventoryForFlows = briefApps.length > 0
      ? formatScreenList(briefApps)
      : '';

    const flowsSkill = await loadSkill(projectDir, 'analysis/analyze-flows');
    const flowsResult = await runWorkerSequential({
      id: 'flows',
      systemPrompt: `${systemPrompt}\n\n## Skill\n\n${flowsSkill}`,
      timeout: 600000, // 10 minutes for large screen inventories
      userPrompt: `Analyze user flows and journeys for this project.
${wireframeReadInstruction}

CRITICAL: Output USER FLOWS only. Do NOT output:
- Color palettes
- Typography definitions
- Spacing systems
- Style analysis

Your output MUST follow the skill format with "## Flow N: [Name]" headers.

${screenInventoryForFlows ? `${screenInventoryForFlows}

**CRITICAL COVERAGE REQUIREMENT:**
Every screen listed above MUST appear in at least one flow.
After defining primary flows, create additional flows to cover remaining screens:
- "Settings & Profile Flow" for settings-*, profile-*, account-* screens
- "Financial Management Flow" for wallet-*, transaction-*, payment-* screens
- "Tribe Administration Flow" for tribe-admin-*, treasury-* screens
- "Content Management Flow" for wiki-*, document-*, media-* screens
- "Admin Operations Flow" for admin-* screens
- "Miscellaneous Flow" for any remaining orphaned screens

Your output MUST achieve 100% coverage of the screen list above.
` : ''}

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
      const strippedFlows = stripPreamble(flowsResult.output);
      await writeFile(join(sharedDir, 'flows.md'), strippedFlows);
      console.log('  Written: flows.md');

      // Extract navigation schema from flows output
      const navSchema = extractNavigationSchema(strippedFlows);
      if (navSchema) {
        await writeFile(
          join(sharedDir, 'navigation-schema.md'),
          `# Navigation Schema\n\n\`\`\`yaml\n${navSchema}\n\`\`\``
        );
        console.log('  Written: navigation-schema.md');
      }
    }

    // Screens mapping - generate per-platform v3.0 files
    if (flowsResult.output) {
      const screensSkill = await loadSkill(projectDir, 'analysis/analyze-screens');
      const iconInventoryForScreens = userIcons.length > 0
        ? `## Available User Icons
The following icons are available in assets/icons/:
${userIcons.map(f => `- ${f.replace(/\.(svg|png)$/i, '')}`).join('\n')}

Use these exact icon names when identifying icons for screens.`
        : '## User Icons\nNo user icons found in assets/icons/';

      // Process each app separately for per-platform files
      if (briefApps.length > 0) {
        console.log(`\n  Generating per-platform screens files for ${briefApps.length} app(s)...`);

        for (const briefApp of briefApps) {
          const platformId = getPlatformId(briefApp.appId);
          const appType = briefApp.appType as 'webapp' | 'mobile' | 'admin';
          const layoutSkillValue = getLayoutSkill(appType);
          const screenCount = briefApp.screens.length;

          console.log(`\n  Processing: ${briefApp.appId} (${screenCount} screens)`);

          // Build platform-specific screen inventory
          const platformInventory = formatScreenInventory([briefApp]);

          const MAX_RETRIES = 2;
          let validOutput: PlatformScreensJson | null = null;

          for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            if (attempt > 1) {
              console.log(`    Retry ${attempt}/${MAX_RETRIES}...`);
            }

            const screensResult = await runWorkerSequential({
              id: `screens-${platformId}`,
              systemPrompt: `${systemPrompt}\n\n## Skill\n\n${screensSkill}`,
              timeout: 600000,
              userPrompt: `Extract all screens for ${briefApp.appName} in v3.0 single-app format.

${platformInventory}

**CRITICAL**: Your output MUST include ALL ${screenCount} screens from the inventory above.

## Flows Analysis (filter for screens in this app)
${stripPreamble(flowsResult.output)}

## Project Brief (for component and icon context)
${combinedBrief || 'No brief provided.'}

${iconInventoryForScreens}

For each screen, identify:
1. UI components needed (header, bottom-nav, card, button-primary, modal, form-input, avatar, badge, etc.)
2. Icons needed (navigation icons, action icons, tab icons, feature icons)
3. Which flows this screen belongs to

OUTPUT v3.0 JSON FORMAT (SINGLE APP):
{
  "version": "3.0",
  "generatedAt": "${new Date().toISOString()}",
  "app": {
    "appId": "${briefApp.appId}",
    "appName": "${briefApp.appName}",
    "appType": "${appType}",
    "layoutSkill": "${layoutSkillValue}",
    "defaultNavigation": {
      "header": { "variant": "standard", "actions": ["search", "notifications"] },
      "footer": { "variant": "tab-bar", "tabs": ["home", "discover", "profile"] },
      "sidemenu": { "visible": false }
    },
    "screens": [
      {
        "id": "screen-id",
        "file": "screen-id.html",
        "name": "Screen Name",
        "description": "What this screen shows",
        "section": "section-id",
        "components": ["header", "bottom-nav", "card"],
        "icons": ["menu", "search", "home"],
        "flows": ["onboarding", "discovery"]
      }
    ]
  }
}

CRITICAL REQUIREMENTS:
1. Output SINGLE "app" object (NOT "apps" array)
2. Include ALL ${screenCount} screens from the inventory
3. EVERY screen MUST have: components (min 2), icons (min 1), flows (min 1)
4. Use "miscellaneous" flow for screens not in any defined flow
${attempt > 1 ? '\n5. PREVIOUS ATTEMPT FAILED - ensure valid JSON with all required fields' : ''}

No markdown, no explanations, just JSON.`
            });

            if (screensResult.output) {
              let jsonContent = screensResult.output.trim();
              if (jsonContent.startsWith('```')) {
                jsonContent = jsonContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
              }

              try {
                const parsed = JSON.parse(jsonContent);

                // Validate v3.0 schema
                const validation = validateSchema(parsed);
                if (validation.valid) {
                  validOutput = parsed as PlatformScreensJson;
                  break;
                } else {
                  console.warn(`    Schema validation failed:`);
                  validation.errors.slice(0, 3).forEach(e => console.warn(`      - ${e}`));
                }
              } catch (e) {
                console.warn(`    Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}`);
              }
            }
          }

          // Write per-platform file
          const screensFilename = getScreensFilename(briefApp.appId);
          const screensPath = join(sharedDir, screensFilename);

          if (validOutput) {
            await writeFile(screensPath, JSON.stringify(validOutput, null, 2));
            console.log(`    Written: ${screensFilename}`);

            const actualScreenCount = validOutput.app.screens.length;
            const components = getAllComponents(validOutput);
            const icons = getAllIcons(validOutput);
            const coverage = getCoverage(validOutput);

            console.log(`    Screens: ${actualScreenCount}/${screenCount}`);
            console.log(`    Components: ${components.length}`);
            console.log(`    Icons: ${icons.length}`);

            const status = coverage.percent === 100 ? '✓' : '⚠';
            console.log(`    ${status} Flow Coverage: ${coverage.inFlows}/${coverage.total} (${coverage.percent}%)`);
          } else {
            console.warn(`    Warning: Failed to generate valid v3.0 schema for ${briefApp.appId}`);
          }
        }
      } else {
        // Single app without brief schema - use default webapp
        console.log('  No brief schema found, generating single webapp-screens.json');

        const MAX_RETRIES = 2;
        let validOutput: PlatformScreensJson | null = null;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          if (attempt > 1) {
            console.log(`  Retry ${attempt}/${MAX_RETRIES}...`);
          }

          const screensResult = await runWorkerSequential({
            id: 'screens-webapp',
            systemPrompt: `${systemPrompt}\n\n## Skill\n\n${screensSkill}`,
            timeout: 600000,
            userPrompt: `Extract all screens in v3.0 single-app format.

## Flows Analysis
${stripPreamble(flowsResult.output)}

## Project Brief (for component and icon context)
${combinedBrief || 'No brief provided.'}

${iconInventoryForScreens}

For each screen, identify:
1. UI components needed (header, bottom-nav, card, button-primary, modal, form-input, avatar, badge, etc.)
2. Icons needed (navigation icons, action icons, tab icons, feature icons)
3. Which flows this screen belongs to

OUTPUT v3.0 JSON FORMAT (SINGLE APP):
{
  "version": "3.0",
  "generatedAt": "${new Date().toISOString()}",
  "app": {
    "appId": "webapp",
    "appName": "Web Application",
    "appType": "webapp",
    "layoutSkill": "webapp",
    "defaultNavigation": {
      "header": { "variant": "standard", "actions": ["search", "notifications"] },
      "footer": { "variant": "tab-bar", "tabs": ["home", "discover", "profile"] },
      "sidemenu": { "visible": false }
    },
    "screens": [
      {
        "id": "screen-id",
        "file": "screen-id.html",
        "name": "Screen Name",
        "description": "What this screen shows",
        "section": "section-id",
        "components": ["header", "bottom-nav", "card"],
        "icons": ["menu", "search", "home"],
        "flows": ["onboarding", "discovery"]
      }
    ]
  }
}

CRITICAL REQUIREMENTS:
1. Output SINGLE "app" object (NOT "apps" array)
2. Include ALL screens from the flows analysis
3. EVERY screen MUST have: components (min 2), icons (min 1), flows (min 1)
4. Use "miscellaneous" flow for screens not in any defined flow
${attempt > 1 ? '\n5. PREVIOUS ATTEMPT FAILED - ensure valid JSON with all required fields' : ''}

No markdown, no explanations, just JSON.`
          });

          if (screensResult.output) {
            let jsonContent = screensResult.output.trim();
            if (jsonContent.startsWith('```')) {
              jsonContent = jsonContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
            }

            try {
              const parsed = JSON.parse(jsonContent);

              // Validate v3.0 schema
              const validation = validateSchema(parsed);
              if (validation.valid) {
                validOutput = parsed as PlatformScreensJson;
                break;
              } else {
                console.warn(`  Schema validation failed:`);
                validation.errors.slice(0, 3).forEach(e => console.warn(`    - ${e}`));
              }
            } catch (e) {
              console.warn(`  Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}`);
            }
          }
        }

        // Write webapp-screens.json
        const screensPath = join(sharedDir, 'webapp-screens.json');

        if (validOutput) {
          await writeFile(screensPath, JSON.stringify(validOutput, null, 2));
          console.log('  Written: webapp-screens.json');

          const screenCount = validOutput.app.screens.length;
          const components = getAllComponents(validOutput);
          const icons = getAllIcons(validOutput);
          const coverage = getCoverage(validOutput);

          console.log(`  Screens: ${screenCount}`);
          console.log(`  Components: ${components.length}`);
          console.log(`  Icons: ${icons.length}`);

          const status = coverage.percent === 100 ? '✓' : '⚠';
          console.log(`  ${status} Flow Coverage: ${coverage.inFlows}/${coverage.total} (${coverage.percent}%)`);
        } else {
          console.warn('  Warning: Failed to generate valid v3.0 schema');
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
    const platformFiles = platforms.map(p => getScreensFilename(p)).join(', ');
    console.log(`
Analysis complete!

Shared outputs in outputs/analysis/shared/
  - research.md      (competitive analysis)
  - styles.md        (${styleCount} style options)
  - assets.md        (per-style assets)
  - inspirations.md  (mood board)
  - ${platformFiles} (per-platform v3.0 screens)

Platform outputs in outputs/analysis/{platform}/
${platforms.map(p => `  - ${p}/flows.md`).join('\n')}

Asset directories created:
  - assets/styles/style-0/ through style-${styleCount - 1}/

Next: Review the outputs, then run:
  agentflow mockups --platform=${platforms[0]}
`);
  } else {
    const screensFiles = briefApps.length > 0
      ? briefApps.map(app => getScreensFilename(app.appId)).join(', ')
      : 'webapp-screens.json';
    console.log(`
Analysis complete!

Outputs written to outputs/analysis/
  - research.md      (competitive analysis)
  - styles.md        (${styleCount} style options)
  - flows.md         (user journeys)
  - ${screensFiles}  (v3.0 per-platform screens)
  - assets.md        (per-style assets)
  - inspirations.md  (mood board)

Asset directories created:
  - assets/styles/style-0/ through style-${styleCount - 1}/

Next: Review the outputs, then run:
  agentflow mockups
`);
  }
}
