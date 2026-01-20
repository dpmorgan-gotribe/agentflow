import { readFile, readdir, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { loadSystemPrompt, loadSkill } from '../lib/agent.js';
import { runWorkersParallel } from '../lib/worker.js';
import { validateAndCleanHTML, isValidHTMLStructure, correctAssetPaths, getScreensOutputInfo } from '../lib/validation.js';
import { detectPlatforms, resolvePlatform, getPlatformOutputDir, getSharedAnalysisDir, resolveSkill } from '../lib/platforms.js';
import { getAllScreenFiles, PlatformScreensJson, getPlatformId } from '../lib/navigation-schema.js';

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

interface NavigationConfig {
  header?: {
    variant?: string;
    actions?: string[];
    logo?: string;
    background?: string;
    breadcrumbs?: string[];
  };
  footer?: {
    variant?: string;
    tabs?: string[];
    activeTab?: string;
    buttons?: string[];
    button?: string;
  };
  sidemenu?: {
    variant?: string;
    visible?: boolean;
    background?: string;
    items?: string[];
    activeSection?: string;
    highlight?: string;
  };
}

interface FullScreenData {
  id: string;
  file: string;
  name: string;
  description: string;
  section: string;
  navigation?: NavigationConfig;
  components: string[];
  icons: string[];
  flows: string[];
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

  // Detect platforms from brief files
  const platforms = await detectPlatforms(projectDir);
  const isMultiPlatform = platforms.length > 0;

  // Allow --platform to work even without brief files
  let platform: string | null = null;
  if (options.platform) {
    // User explicitly specified a platform - use it directly
    platform = options.platform;
  } else if (isMultiPlatform) {
    platform = await resolvePlatform(projectDir, options.platform);
  }

  // Resolve which layout skill to use
  const skillType = resolveSkill(platform || 'webapp', options.skill);

  if (platform) {
    console.log(`Generating screens for platform: ${platform}, skill: ${skillType}`);
  } else {
    console.log(`Generating screens with skill: ${skillType}`);
  }

  // Determine paths
  const analysisDir = join(projectDir, 'outputs', 'analysis');

  const platformAnalysisDir = isMultiPlatform && platform
    ? getPlatformOutputDir(projectDir, 'analysis', platform)
    : analysisDir;

  let uniqueScreens: string[] = [];
  let userflows: Userflow[] = [];

  // Store full screen data and default navigation for passing to LLM
  const screenDataMap: Map<string, FullScreenData> = new Map();
  let defaultNavigation: NavigationConfig = {};

  // Load per-platform screens file (v3.0 format)
  const platformId = options.platform ? getPlatformId(options.platform) : 'webapp';
  const screensFilename = `${platformId}-screens.json`;

  // Try platform-specific file first, then fall back to common names
  const filesToTry = [
    join(analysisDir, screensFilename),
    join(analysisDir, 'webapp-screens.json'),
    join(analysisDir, 'admin-screens.json')
  ];

  let loadedFromFile = '';
  for (const filePath of filesToTry) {
    try {
      const screensJsonContent = await readFile(filePath, 'utf-8');
      const screensData = JSON.parse(screensJsonContent) as PlatformScreensJson;

      // Validate v3.0 format
      if (screensData.version === '3.0' && screensData.app) {
        const screenFiles = getAllScreenFiles(screensData);
        uniqueScreens = screenFiles.map(s => s.replace('.html', ''));
        loadedFromFile = filePath.split(/[/\\]/).pop() || '';
        console.log(`Loaded ${uniqueScreens.length} screen(s) from ${loadedFromFile}`);

        // Store default navigation from app config
        defaultNavigation = screensData.app.defaultNavigation || {};

        // Store full screen data for each screen
        for (const screen of screensData.app.screens) {
          screenDataMap.set(screen.id, screen as FullScreenData);
        }

        break;
      }
    } catch {
      // Try next file
    }
  }

  if (uniqueScreens.length === 0) {
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
    console.error('  1. Run `agentflow analyze` to generate {platform}-screens.json (v3.0)');
    console.error('  2. Run `agentflow flows` with id="screen-[name]" elements');
    process.exit(1);
  }

  // Apply limit if specified
  const limit = options.limit ? parseInt(options.limit) : undefined;
  if (limit && limit > 0 && limit < uniqueScreens.length) {
    console.log(`Limiting to first ${limit} of ${uniqueScreens.length} screens`);
    uniqueScreens = uniqueScreens.slice(0, limit);
  }

  // Determine output directory based on platform and skill
  const outputInfo = getScreensOutputInfo(platform, skillType);
  const outputDir = outputInfo.folderName
    ? join(projectDir, 'outputs', 'screens', outputInfo.folderName)
    : join(projectDir, 'outputs', 'screens');
  const assetDepth = outputInfo.depth;
  console.log(`Output directory: ${outputInfo.folderName || "screens"}`);

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
  const stylesheetDir = platform
    ? getPlatformOutputDir(projectDir, 'stylesheet', platform)
    : join(projectDir, 'outputs', 'stylesheet');

  let stylesheetContent: string;
  try {
    stylesheetContent = await readFile(join(stylesheetDir, 'showcase.html'), 'utf-8');
  } catch {
    // Try shared stylesheet if platform-specific does not exist
    try {
      stylesheetContent = await readFile(join(projectDir, 'outputs', 'stylesheet', 'showcase.html'), 'utf-8');
    } catch {
      console.error('No stylesheet found.');
      console.error('Run `agentflow stylesheet` first.');
      process.exit(1);
    }
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

  // Helper to build navigation context for a screen
  function buildNavigationContext(screenName: string): string {
    const screenData = screenDataMap.get(screenName);
    if (!screenData) {
      return `## Navigation Context\nUse default app navigation.\n\n## Default Navigation\n${JSON.stringify(defaultNavigation, null, 2)}`;
    }

    // Merge screen navigation with defaults (deep merge for nested objects)
    const nav = screenData.navigation || {};
    const effectiveNav = {
      header: { ...defaultNavigation.header, ...nav.header },
      footer: { ...defaultNavigation.footer, ...nav.footer },
      sidemenu: { ...defaultNavigation.sidemenu, ...nav.sidemenu }
    };

    // Extract specific navigation items
    const footerTabs = effectiveNav.footer?.tabs || [];
    const activeTab = effectiveNav.footer?.activeTab || footerTabs[0] || '';
    const sidemenuItems = effectiveNav.sidemenu?.items || [];
    const activeSection = effectiveNav.sidemenu?.activeSection || sidemenuItems[0] || '';
    const headerActions = effectiveNav.header?.actions || [];

    return `## Screen Specification
ID: ${screenData.id}
Name: ${screenData.name}
Description: ${screenData.description}
Section: ${screenData.section}
Components: ${screenData.components?.join(', ') || 'none'}
Icons needed: ${screenData.icons?.join(', ') || 'none'}

## NAVIGATION (MUST IMPLEMENT EXACTLY)

### Header
- Variant: ${effectiveNav.header?.variant || 'standard'}
- Actions: ${headerActions.length > 0 ? headerActions.join(', ') : 'none'}
${getHeaderInstructions(effectiveNav.header, headerActions)}

### Footer / Bottom Navigation
- Variant: ${effectiveNav.footer?.variant || 'hidden'}
${effectiveNav.footer?.variant === 'tab-bar' ? `- Tabs: [${footerTabs.join(', ')}]
- Active Tab: "${activeTab}" (HIGHLIGHT THIS ONE)
${getFooterInstructions(effectiveNav.footer, footerTabs, activeTab)}` : '- No bottom navigation for this screen'}

### Sidemenu / Side Drawer
- Visible: ${effectiveNav.sidemenu?.visible ? 'YES' : 'NO'}
${effectiveNav.sidemenu?.visible && sidemenuItems.length > 0 ? `- Menu Items: [${sidemenuItems.join(', ')}]
- Active Section: "${activeSection}" (HIGHLIGHT THIS ONE)
${getSidemenuInstructions(effectiveNav.sidemenu, sidemenuItems, activeSection)}` : '- No sidemenu for this screen'}

## Navigation JSON (for reference)
${JSON.stringify(effectiveNav, null, 2)}`;
  }

  function getHeaderInstructions(header?: NavigationConfig['header'], actions?: string[]): string {
    if (!header) return '- Use standard header with logo and icons';
    const actionList = actions || header.actions || [];
    switch (header.variant) {
      case 'minimal':
        return `- Show logo only, minimal or no action icons`;
      case 'breadcrumb':
        return `- Show back arrow on left, breadcrumbs: ${header.breadcrumbs?.join(' > ') || 'parent > current'}`;
      case 'standard':
        return `- Show logo centered
- Right side icons: ${actionList.join(', ') || 'search, notifications'}
- Left side: hamburger menu icon (if sidemenu visible)`;
      case 'admin':
        return `- Admin header with search bar
- Right side: ${actionList.join(', ') || 'search, notifications, profile'}`;
      default:
        return '- Standard header layout';
    }
  }

  function getFooterInstructions(footer?: NavigationConfig['footer'], tabs?: string[], activeTab?: string): string {
    if (!footer) return '';
    switch (footer.variant) {
      case 'hidden':
        return '';
      case 'tab-bar':
        const tabList = tabs || footer.tabs || ['home', 'profile', 'chat'];
        const active = activeTab || tabList[0];
        return `- Create bottom tab bar with ${tabList.length} tabs
- Each tab shows icon + label
- Tab "${active}" should be visually highlighted (active state)
- Other tabs use inactive/muted styling
- Tabs clickable (can link to # for mockup)`;
      case 'wizard-buttons':
        return `- Wizard footer with navigation buttons: ${footer.buttons?.join(', ') || 'Back, Next'}`;
      case 'payment-button':
        return `- Single prominent action button: "${footer.button || 'Continue'}"`;
      default:
        return '';
    }
  }

  function getSidemenuInstructions(sidemenu?: NavigationConfig['sidemenu'], items?: string[], activeSection?: string): string {
    if (!sidemenu || sidemenu.variant === 'hidden' || !sidemenu.visible) return '';
    const menuItems = items || sidemenu.items || [];
    const active = activeSection || menuItems[0] || '';
    if (menuItems.length > 0) {
      return `- Hamburger icon in header triggers slide-out drawer
- Drawer contains ${menuItems.length} menu items: ${menuItems.join(', ')}
- Item "${active}" should be highlighted as active/selected
- Other items use normal/inactive styling
- Include semi-transparent overlay behind drawer
- Close button or tap-outside to dismiss`;
    }
    return '- Standard sidemenu via hamburger icon';
  }

  // Create worker tasks (one per screen)
  const workerTasks = screensToGenerate.map((screenName, i) => ({
    id: `screen-${String(screenIndices[i] + 1).padStart(2, '0')}`,
    systemPrompt: `${systemPrompt}\n\n## Skill\n\n${skill}`,
    userPrompt: `Create the full design for screen: ${screenName}${platform ? ` (${platform} platform)` : ''}

${buildNavigationContext(screenName)}

Use the stylesheet:
${stylesheetContent}`
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

      // Correct asset paths based on output directory depth
      const correctedHtml = correctAssetPaths(validation.content, assetDepth);
      await writeFile(outputPath, correctedHtml);

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
  const outputPathDisplay = outputInfo.folderName
    ? `outputs/screens/${outputInfo.folderName}/`
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
