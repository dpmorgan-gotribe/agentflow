import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

export interface DesignContext {
  selectedStyle: string;
  styleName?: string;
  primaryColor?: string;
  secondaryColor?: string;
  fontFamily?: string;
  stylesheetPath: string;
}

const DESIGN_CONTEXT_MARKER = '<!-- DESIGN_CONTEXT -->';

export async function updateProjectContext(
  projectDir: string,
  context: DesignContext
): Promise<void> {
  const claudePath = join(projectDir, 'CLAUDE.md');

  let content: string;
  try {
    content = await readFile(claudePath, 'utf-8');
  } catch {
    console.warn('CLAUDE.md not found, skipping context update');
    return;
  }

  const contextSection = `
## Selected Design System

**Style:** ${context.selectedStyle}${context.styleName ? ` - ${context.styleName}` : ''}
${context.primaryColor ? `**Primary Color:** ${context.primaryColor}` : ''}
${context.secondaryColor ? `**Secondary Color:** ${context.secondaryColor}` : ''}
${context.fontFamily ? `**Font:** ${context.fontFamily}` : ''}
**Stylesheet:** ${context.stylesheetPath}

All subsequent screen generation uses this design system. The brief has been consumed
by the analyst - refer to outputs/analysis/ for extracted design decisions.
`;

  // Replace marker or append to end
  if (content.includes(DESIGN_CONTEXT_MARKER)) {
    content = content.replace(
      new RegExp(`${DESIGN_CONTEXT_MARKER}[\\s\\S]*$`),
      DESIGN_CONTEXT_MARKER + contextSection
    );
  } else {
    content += '\n' + DESIGN_CONTEXT_MARKER + contextSection;
  }

  await writeFile(claudePath, content);
}

export async function extractStyleInfo(
  stylesheetContent: string,
  styleNum: string
): Promise<Partial<DesignContext>> {
  const info: Partial<DesignContext> = {
    selectedStyle: styleNum
  };

  // Extract primary color (common patterns)
  const primaryMatch = stylesheetContent.match(/--primary[^:]*:\s*(#[a-fA-F0-9]{6}|#[a-fA-F0-9]{3})/);
  if (primaryMatch) {
    info.primaryColor = primaryMatch[1];
  }

  // Extract secondary color
  const secondaryMatch = stylesheetContent.match(/--secondary[^:]*:\s*(#[a-fA-F0-9]{6}|#[a-fA-F0-9]{3})/);
  if (secondaryMatch) {
    info.secondaryColor = secondaryMatch[1];
  }

  // Extract font family
  const fontMatch = stylesheetContent.match(/font-family:\s*['"]?([^'";,]+)/);
  if (fontMatch) {
    info.fontFamily = fontMatch[1].trim();
  }

  return info;
}
