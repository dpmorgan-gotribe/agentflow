import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { loadSystemPrompt, loadSkill } from '../lib/agent.js';
import { runWorkersParallel } from '../lib/worker.js';
import { validateAndCleanHTML, isValidHTMLStructure } from '../lib/validation.js';

interface FlowsOptions {
  style?: string;
}

export async function flows(options: FlowsOptions = {}) {
  const projectDir = process.cwd();
  const styleNum = options.style || '0';

  // Load flows from analysis
  const flowsPath = join(projectDir, 'outputs', 'analysis', 'flows.md');
  let flowsContent: string;
  try {
    flowsContent = await readFile(flowsPath, 'utf-8');
  } catch {
    console.error('No outputs/analysis/flows.md found.');
    console.error('Run `agentflow analyze` first.');
    process.exit(1);
  }

  // Parse flows (extract flow names from markdown headers)
  const flowMatches = flowsContent.match(/^## Flow \d+: (.+)$/gm) || [];
  const flowNames = flowMatches.map(m => m.replace(/^## Flow \d+: /, ''));

  if (flowNames.length === 0) {
    // Check for common format issues
    const h3Flows = flowsContent.match(/^### Flow \d+:/gm) || [];
    const hasStyleContent = flowsContent.includes('Color Palette') || flowsContent.includes('Typography');

    if (h3Flows.length > 0) {
      console.error('Format error: Found flows with ### headers (H3)');
      console.error('Expected: ## Flow N: Name (H2 headers)');
      console.error('Re-run `agentflow analyze` to regenerate flows.md');
    } else if (hasStyleContent) {
      console.error('Content error: flows.md contains style analysis instead of user flows');
      console.error('Re-run `agentflow analyze` to regenerate flows.md');
    } else {
      console.error('No flows found in outputs/analysis/flows.md');
      console.error('Expected format: "## Flow N: Flow Name"');
    }
    process.exit(1);
  }

  console.log(`Found ${flowNames.length} flow(s): ${flowNames.join(', ')}`);
  console.log(`Using style ${styleNum}`);

  // Load skill and system prompt
  const systemPrompt = await loadSystemPrompt(projectDir, 'ui-designer');
  const skill = await loadSkill(projectDir, 'design/design-flow');
  const stylesContent = await readFile(
    join(projectDir, 'outputs', 'analysis', 'styles.md'),
    'utf-8'
  );

  // Load selected mockup HTML (if exists)
  let mockupHtml = '';
  try {
    mockupHtml = await readFile(
      join(projectDir, 'outputs', 'mockups', `style-${styleNum}.html`),
      'utf-8'
    );
    console.log(`Loaded mockup reference: style-${styleNum}.html`);
  } catch {
    // Mockup doesn't exist yet - flows may be run before mockups
    console.log(`Note: style-${styleNum}.html not found - using styles.md only`);
  }

  // Build mockup reference section if available
  const mockupReference = mockupHtml ? `
## Selected Mockup HTML Reference
The following HTML is the approved mockup for Style ${styleNum}. You MUST match its header, footer, logo, and icon styling EXACTLY.

\`\`\`html
${mockupHtml}
\`\`\`

CRITICAL STYLING REQUIREMENTS:
- Header: Match background color, icon colors, logo placement exactly
- Footer: Match background color, icon colors, active/inactive states exactly
- Icons: Match style (outlined vs filled), colors, sizes
- Logo: Match placement, size, and treatment
` : '';

  // Create worker tasks (one per flow)
  const workerTasks = flowNames.map((flowName, index) => ({
    id: `flow-${index + 1}`,
    systemPrompt: `${systemPrompt}\n\n## Skill\n\n${skill}`,
    userPrompt: `Create a flow mockup for: ${flowName}

CRITICAL: Output ONLY raw HTML. Start with <!DOCTYPE html> and end with </html>.
No explanations. No descriptions. No markdown. Just complete, valid HTML.

Use Style ${styleNum} from the styles below.
${mockupReference}
## Styles
${stylesContent}

## Flow Details
${flowsContent}

## Instructions
- Find "${flowName}" in the flow details above
- Create an HTML flow mockup showing the screens in sequence
- Use arrows or visual connectors between screens
- Apply Style ${styleNum} colors, typography, and spacing
- Match header/footer/logo/icons from the mockup reference EXACTLY

Remember: Output ONLY the HTML. Nothing else.`
  }));

  // Run workers in parallel
  const results = await runWorkersParallel(workerTasks);

  // Write outputs
  const outputDir = join(projectDir, 'outputs', 'flows');
  await mkdir(outputDir, { recursive: true });

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.output) {
      // Sanitize filename: lowercase, replace spaces/special chars with dashes, remove invalid chars
      const safeName = flowNames[i]
        .toLowerCase()
        .replace(/[\/\\:*?"<>|()&]/g, '') // Remove invalid filename chars
        .replace(/\s+/g, '-')              // Replace spaces with dashes
        .replace(/-+/g, '-')               // Collapse multiple dashes
        .replace(/^-|-$/g, '');            // Trim leading/trailing dashes
      const filename = `${result.id}-${safeName}.html`;
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
    console.warn(`\nWarning: ${failCount} flow(s) may have invalid HTML`);
  }

  console.log(`
Flow mockups complete!

Outputs written to outputs/flows/

Next: Review the flow mockups, then run:
  agentflow mockups
`);
}
