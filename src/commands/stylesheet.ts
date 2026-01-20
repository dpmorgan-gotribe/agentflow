import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { join } from 'path';
import { loadSystemPrompt, loadSkill } from '../lib/agent.js';
import { runWorkerSequential } from '../lib/worker.js';
import { updateProjectContext, extractStyleInfo } from '../lib/context.js';
import { validateAndCleanHTML, hasRequiredCSSTokens, hasRequiredComponents, hasMinimumLength } from '../lib/validation.js';
import { detectPlatforms, resolvePlatform, getPlatformOutputDir, getSharedAnalysisDir, resolveSkill } from '../lib/platforms.js';
import { getAllComponents, getAllIcons, PlatformScreensJson, getPlatformId } from '../lib/navigation-schema.js';

interface StylesheetOptions {
  style: string;
  force?: boolean;
  platform?: string;
  skill?: string;
}

const MAX_RETRIES = 2;

export async function stylesheet(options: StylesheetOptions) {
  const projectDir = process.cwd();
  const styleNum = options.style || '1';
  const forceWrite = options.force || false;

  // Detect platforms
  const platforms = await detectPlatforms(projectDir);
  const isMultiPlatform = platforms.length > 0;
  const platform = isMultiPlatform ? await resolvePlatform(projectDir, options.platform) : null;

  // Resolve which layout skill to use
  const skillType = resolveSkill(platform || 'webapp', options.skill);

  if (isMultiPlatform && platform) {
    console.log(`Creating stylesheet for platform: ${platform}, style ${styleNum}, skill: ${skillType}`);
  } else {
    console.log(`Creating stylesheet for style ${styleNum}, skill: ${skillType}`);
  }

  // Determine paths
  const analysisDir = isMultiPlatform
    ? getSharedAnalysisDir(projectDir)
    : join(projectDir, 'outputs', 'analysis');

  const platformAnalysisDir = isMultiPlatform && platform
    ? getPlatformOutputDir(projectDir, 'analysis', platform)
    : analysisDir;

  // Load analysis outputs
  let stylesContent: string;
  let screensJsonData: PlatformScreensJson | null = null;
  let componentsList: string[] = [];
  let iconsList: string[] = [];

  try {
    stylesContent = await readFile(join(analysisDir, 'styles.md'), 'utf-8');

    // Load per-platform screens file
    const platformId = platform ? getPlatformId(platform) : 'webapp';
    const screensFilename = `${platformId}-screens.json`;

    // Try platform-specific file first, then fall back to common names
    const filesToTry = [
      join(analysisDir, screensFilename),
      join(analysisDir, 'webapp-screens.json'),
      join(analysisDir, 'admin-screens.json')
    ];

    for (const filePath of filesToTry) {
      try {
        const screensJson = await readFile(filePath, 'utf-8');
        screensJsonData = JSON.parse(screensJson) as PlatformScreensJson;

        // Validate it's v3.0 format
        if (screensJsonData.version === '3.0' && screensJsonData.app) {
          componentsList = getAllComponents(screensJsonData);
          iconsList = getAllIcons(screensJsonData);
          console.log(`Loaded from ${filePath.split(/[/\\]/).pop()}`);
          break;
        }
      } catch {
        // Try next file
      }
    }

    if (componentsList.length > 0) {
      console.log(`  ${componentsList.length} components`);
    }
    if (iconsList.length > 0) {
      console.log(`  ${iconsList.length} icons`);
    }
  } catch {
    console.error('Analysis outputs not found.');
    console.error('Run `agentflow analyze` first.');
    process.exit(1);
  }

  // Scan for user icons
  let userIcons: string[] = [];
  try {
    const iconsDir = join(projectDir, 'assets', 'icons');
    const iconFiles = await readdir(iconsDir);
    userIcons = iconFiles.filter(f => /\.(svg|png)$/i.test(f));
    console.log(`Found ${userIcons.length} user icon(s) in assets/icons`);
  } catch {
    // No icons directory - that's ok
  }

  // Build component requirements section (componentsList already loaded above)
  // Note: screenComponents mapping not available in v3.0 schema - components are embedded in each screen

  // Determine mockup path (mockups are always in generic location - they're style previews, not platform-specific)
  const mockupsDir = join(projectDir, 'outputs', 'mockups');
  const mockupPath = join(mockupsDir, `style-${styleNum}.html`);

  // Verify mockup exists (but don't load it - agent will read it)
  try {
    await readFile(mockupPath, 'utf-8');
  } catch {
    console.error(`Mockup style-${styleNum}.html not found.`);
    console.error('Run `agentflow mockups` first.');
    process.exit(1);
  }

  console.log(`Mockup file: ${mockupPath}`);

  // Load skill and system prompt (use platform-specific skill)
  const systemPrompt = await loadSystemPrompt(projectDir, 'ui-designer');
  const skillName = `design/design-stylesheet-${skillType}`;
  let skill: string;
  try {
    skill = await loadSkill(projectDir, skillName);
  } catch {
    // Fallback to generic skill if platform-specific doesn't exist
    console.log(`Skill ${skillName} not found, falling back to design-stylesheet`);
    skill = await loadSkill(projectDir, 'design/design-stylesheet');
  }

  // Build components section for prompts
  const componentsSection = componentsList.length > 0
    ? `## Required Components (${componentsList.length} total)
Your stylesheet MUST include styles for ALL these components:
${componentsList.join(', ')}`
    : '## Components\nNo component mapping found - include common UI components.';

  // Determine icon source based on style
  // Path depth: outputs/stylesheet/showcase.html = 2 levels, outputs/stylesheet/{platform}/showcase.html = 3 levels
  const assetPathPrefix = isMultiPlatform && platform ? '../../../' : '../../';
  const isUserStyle = styleNum === '0';
  const iconSource = isUserStyle
    ? { type: 'user', path: `${assetPathPrefix}assets/icons/`, format: '{name}.svg' }
    : { type: 'lucide', cdn: 'https://unpkg.com/lucide-static@latest/icons/', format: '{name}.svg' };

  // Build icons section for prompt
  const iconsSection = iconsList.length > 0
    ? `## Required Icons (${iconsList.length} total)
Your stylesheet MUST include an Icons Gallery section showing ALL these icons:
${iconsList.join(', ')}

## Icon Source
${isUserStyle
  ? `Type: User Icons (from assets/icons/)
Path: ${iconSource.path}
Available user icons: ${userIcons.map(f => f.replace(/\.(svg|png)$/i, '')).join(', ')}

Use: <img src="${iconSource.path}{icon-name}.svg" alt="icon-name" />`
  : `Type: Library Icons (Lucide)
CDN: ${iconSource.cdn}
Include comment: <!-- Icons: https://lucide.dev -->

Use: <img src="${iconSource.cdn}{icon-name}.svg" alt="icon-name" />`}

## Icon Gallery Requirements
Your showcase.html MUST include:
1. Icon grid showing ALL icons with their names
2. Icon states (default, active, disabled, inverted)
3. Icon sizes (16px, 24px, 32px, 48px)
4. Icons on both light and dark backgrounds`
    : '## Icons\nNo icon mapping found - include common UI icons.';

  // Retry loop for agent invocation
  let validOutput: string | null = null;
  let lastErrors: string[] = [];
  let wasExtracted = false;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 1) {
      console.log(`Retry ${attempt}/${MAX_RETRIES}...`);
    }

    // Build user prompt with retry emphasis if needed
    // NOTE: We pass the mockup FILE PATH instead of inline content to prevent truncation
    let userPrompt = `## YOUR PRIMARY TASK
Create a complete design system that EXACTLY matches mockup style-${styleNum}.

## STEP 1: READ THE MOCKUP FILE (CRITICAL)
**Mockup file path:** ${mockupPath}

You MUST use the Read tool to examine this mockup file. This is the SOURCE OF TRUTH.
Extract these EXACT values from the mockup:
- All CSS variables from :root { }
- Font family declarations
- Spacing/padding values
- Border radius values
- Shadow definitions
- Color values (primary, secondary, header-bg, etc.)

## STEP 2: Apply to Design System
${platform ? `Platform: ${platform}` : ''}

${componentsSection}

${iconsSection}

## Style Definitions (for reference)
${stylesContent}

## CRITICAL REQUIREMENTS
1. **READ the mockup file first** using the Read tool
2. Extract ALL CSS variables and values from the mockup's :root { } section
3. Your output MUST use the SAME font families as the mockup
4. Your output MUST use the SAME spacing values as the mockup
5. Your output MUST use the SAME border-radius as the mockup
6. Your output MUST use the SAME colors as the mockup
7. Do NOT use generic/default values - use what's in the mockup file

## STYLING TO MATCH FROM MOCKUP
After reading the mockup, replicate:
- **Header**: structure, background color, icon colors, logo placement
- **Footer**: structure, background color, icon colors, active indicator styling
- **Typography**: font families, sizes, weights from the mockup
- **Spacing**: padding, margins, gaps from the mockup
- **Colors**: all color values from the mockup's CSS variables

## COMPONENT COVERAGE CHECK
Before outputting, verify your stylesheet includes CSS for:
- All navigation components (header, bottom-nav, side-menu, tab-bar)
- All form components (form-input, form-select, checkbox, radio, toggle, etc.)
- All content components (card, list-item, avatar, badge, tag, etc.)
- All button variants (button-primary, button-secondary, button-icon, fab)
- All feedback components (modal, toast, empty-state, loading)
- All layout components (filter-pills, section-header, divider, grid)

## OUTPUT FORMAT
Output ONLY raw HTML starting with <!DOCTYPE html> and ending with </html>.
No explanations, no summaries, no markdown code fences.`;

    if (attempt > 1) {
      userPrompt = `IMPORTANT: Your previous response was invalid. ${lastErrors.join('. ')}.\n\nYou MUST output ONLY raw HTML starting with <!DOCTYPE html> and ending with </html>. No explanations, no summaries, no markdown.\n\nREMEMBER: Read the mockup file at ${mockupPath} first!\n\n${userPrompt}`;
    }

    const result = await runWorkerSequential({
      id: 'stylesheet',
      systemPrompt: `${systemPrompt}\n\n## Skill\n\n${skill}`,
      userPrompt,
      allowRead: true,
      addDirs: [mockupsDir, analysisDir, projectDir]
    });

    if (!result.output) {
      lastErrors = ['No output received from agent'];
      continue;
    }

    // Validate and clean the output
    const validation = validateAndCleanHTML(result.output);

    if (validation.valid) {
      // Additional check for stylesheet-specific content
      if (!hasRequiredCSSTokens(validation.content)) {
        lastErrors = ['Missing required CSS tokens (:root variables, <style> tag)'];
        continue;
      }

      // Check for required component classes
      const componentCheck = hasRequiredComponents(validation.content);
      if (!componentCheck.valid) {
        lastErrors = [`Missing required components (${componentCheck.coverage}% coverage): ${componentCheck.missing.join(', ')}`];
        continue;
      }

      // Check minimum length to catch truncated outputs
      const lengthCheck = hasMinimumLength(validation.content);
      if (!lengthCheck.valid) {
        lastErrors = [`Output too short (${lengthCheck.lines} lines, minimum ${lengthCheck.required}). Stylesheet may be truncated.`];
        continue;
      }

      validOutput = validation.content;
      wasExtracted = validation.extracted;
      break;
    } else {
      lastErrors = validation.errors;
    }
  }

  // Write outputs (platform-specific if multi-platform)
  const outputDir = isMultiPlatform && platform
    ? getPlatformOutputDir(projectDir, 'stylesheet', platform)
    : join(projectDir, 'outputs', 'stylesheet');

  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, 'showcase.html');

  if (validOutput) {
    if (wasExtracted) {
      console.log('Warning: Had to extract HTML from mixed output');
    }

    await writeFile(outputPath, validOutput);

    // Update project CLAUDE.md with design context
    const styleInfo = await extractStyleInfo(validOutput, styleNum);
    await updateProjectContext(projectDir, {
      ...styleInfo,
      selectedStyle: styleNum,
      stylesheetPath: isMultiPlatform && platform
        ? `outputs/stylesheet/${platform}/showcase.html`
        : 'outputs/stylesheet/showcase.html',
      platform: platform || undefined
    });
    console.log('Updated CLAUDE.md with design context');

    const outputPathDisplay = isMultiPlatform && platform
      ? `outputs/stylesheet/${platform}/`
      : 'outputs/stylesheet/';

    console.log(`
Stylesheet complete!

Outputs written to ${outputPathDisplay}

Design context locked in CLAUDE.md. The brief has been consumed.

Next: Review the design system, then run:
  agentflow screens${isMultiPlatform && platform ? ` --platform=${platform}` : ''}
`);
  } else if (forceWrite) {
    // Force write invalid output with warning
    console.warn('\nWarning: Output validation failed but --force flag used.');
    console.warn('Errors detected:');
    lastErrors.forEach(e => console.warn(`  - ${e}`));

    // Try to write whatever we have (use same detailed prompt with file path)
    const forcePrompt = `Create a complete design system based on style ${styleNum}.

## MOCKUP FILE (READ THIS FIRST)
${mockupPath}

Use the Read tool to examine the mockup file and extract all styling.

## Style Definitions
${stylesContent}

${componentsSection}

Match header/footer/icons from the mockup EXACTLY. Include all required components.
Output ONLY raw HTML.`;

    const result = await runWorkerSequential({
      id: 'stylesheet-force',
      systemPrompt: `${systemPrompt}\n\n## Skill\n\n${skill}`,
      userPrompt: forcePrompt,
      allowRead: true,
      addDirs: [mockupsDir, analysisDir, projectDir]
    });

    if (result.output) {
      await writeFile(outputPath, result.output);
      console.warn(`\nForce-wrote output to ${outputPath}`);
      console.warn('Manual review required - output may be invalid.');
    }
  } else {
    // Validation failed, show error
    console.error('\nStylesheet generation failed - invalid output detected:');
    lastErrors.forEach(e => console.error(`  - ${e}`));
    console.error('\nThe agent did not produce valid HTML. Possible causes:');
    console.error('  1. Agent output conversational text instead of raw HTML');
    console.error('  2. Agent requested permission instead of outputting content');
    console.error('  3. Agent wrapped output in markdown code fences incorrectly');
    console.error('\nOptions:');
    console.error('  - Run with --force to save output anyway');
    console.error('  - Check/update skills/design/design-stylesheet.md');
    console.error('  - Manually create the stylesheet');
    process.exit(1);
  }
}
