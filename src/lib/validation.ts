/**
 * HTML and output validation utilities for AgenticFlow
 * Ensures agent output is valid HTML before writing to files
 */

/**
 * Check if content has valid HTML structure
 */
export function isValidHTMLStructure(content: string): boolean {
  const trimmed = content.trim();
  const hasDoctype = trimmed.toLowerCase().startsWith('<!doctype html>');
  const hasHtmlStart = /<html/i.test(trimmed);
  const hasHtmlEnd = /<\/html>/i.test(trimmed);
  return (hasDoctype || hasHtmlStart) && hasHtmlEnd;
}

/**
 * Check if content contains required CSS tokens for a stylesheet
 */
export function hasRequiredCSSTokens(content: string): boolean {
  return content.includes(':root') && content.includes('{') && content.includes('<style');
}

/**
 * Required CSS classes that must be present in a stylesheet
 * Organized by category for clearer error messages
 */
const REQUIRED_COMPONENT_CLASSES = {
  buttons: ['.button-primary', '.btn-primary'],
  forms: ['.form-input', '.form-select'],
  cards: ['.card'],
  lists: ['.list-item'],
  navigation: ['.header', '.side-menu'],
  feedback: ['.modal', '.toast'],
  layout: ['.filter-pill']
};

/**
 * Check if stylesheet contains required component classes
 * Returns object with validation result and missing components
 */
export function hasRequiredComponents(content: string): {
  valid: boolean;
  missing: string[];
  coverage: number;
} {
  const missing: string[] = [];
  let found = 0;
  let total = 0;

  for (const [category, classes] of Object.entries(REQUIRED_COMPONENT_CLASSES)) {
    total++;
    // Check if at least one variant of the class exists
    const hasClass = classes.some(cls => content.includes(cls));
    if (!hasClass) {
      missing.push(`${category} (${classes.join(' or ')})`);
    } else {
      found++;
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    coverage: Math.round((found / total) * 100)
  };
}

/**
 * Minimum expected line count for a complete stylesheet
 * This helps catch truncated outputs
 */
const MIN_STYLESHEET_LINES = 500;

/**
 * Check if stylesheet meets minimum length requirements
 */
export function hasMinimumLength(content: string): {
  valid: boolean;
  lines: number;
  required: number;
} {
  const lines = content.split('\n').length;
  return {
    valid: lines >= MIN_STYLESHEET_LINES,
    lines,
    required: MIN_STYLESHEET_LINES
  };
}

/**
 * Extract HTML from mixed content (e.g., content with preamble/postamble text)
 */
export function extractHTMLFromMixed(content: string): string | null {
  // Try to find HTML document in the content
  const doctypeMatch = content.match(/(<!DOCTYPE html>[\s\S]*<\/html>)/i);
  if (doctypeMatch) {
    return doctypeMatch[1];
  }

  // Try without DOCTYPE
  const htmlMatch = content.match(/(<html[\s\S]*<\/html>)/i);
  if (htmlMatch) {
    return htmlMatch[1];
  }

  return null;
}

/**
 * Detect common failure patterns in agent output
 */
export function detectFailurePatterns(content: string): string[] {
  const errors: string[] = [];
  const lower = content.toLowerCase();

  // Permission-related failures
  if (lower.includes('waiting for permission')) {
    errors.push('Contains permission wait message');
  }
  if (lower.includes('need permission')) {
    errors.push('Contains permission request');
  }
  if (lower.includes('could you grant')) {
    errors.push('Contains permission request');
  }

  // Conversational preambles (agent didn't output raw HTML)
  if (lower.includes("i've created") || lower.includes("i have created")) {
    errors.push('Contains conversational preamble');
  }
  if (lower.includes("here's the") || lower.includes("here is the")) {
    errors.push('Contains conversational preamble');
  }
  if (lower.includes("the design system includes")) {
    errors.push('Contains summary instead of HTML');
  }
  if (lower.includes("## summary")) {
    errors.push('Contains markdown summary instead of HTML');
  }

  // Missing required elements
  if (!content.includes('<style')) {
    errors.push('Missing <style> tag');
  }
  if (!content.includes('<!DOCTYPE html>') && !content.includes('<!doctype html>')) {
    errors.push('Missing DOCTYPE declaration');
  }

  return errors;
}

/**
 * Strip markdown code fences from content
 * Handles: ```html, ```css, ```markdown, and generic ```
 */
export function stripCodeFences(content: string): string {
  let result = content.trim();

  // Remove opening fence with language identifier
  const openingFenceMatch = result.match(/^```(\w+)?\s*\n?/);
  if (openingFenceMatch) {
    result = result.slice(openingFenceMatch[0].length);
  }

  // Remove closing fence
  const closingFenceMatch = result.match(/\n?```\s*$/);
  if (closingFenceMatch) {
    result = result.slice(0, -closingFenceMatch[0].length);
  }

  return result.trim();
}

/**
 * Strip preamble text before first HTML element or markdown header
 */
export function stripPreamble(content: string): string {
  // For HTML content, find DOCTYPE or <html>
  const doctypeMatch = content.match(/<!DOCTYPE html>/i);
  if (doctypeMatch && doctypeMatch.index !== undefined && doctypeMatch.index > 0) {
    return content.slice(doctypeMatch.index);
  }

  const htmlMatch = content.match(/<html/i);
  if (htmlMatch && htmlMatch.index !== undefined && htmlMatch.index > 0) {
    return content.slice(htmlMatch.index);
  }

  // For markdown content, find first header
  const headerMatch = content.match(/^#\s/m);
  if (headerMatch && headerMatch.index !== undefined && headerMatch.index > 0) {
    return content.slice(headerMatch.index);
  }

  return content;
}

/**
 * Validate and clean HTML output from agent
 * Returns cleaned content or null if invalid
 */
export function validateAndCleanHTML(content: string): {
  valid: boolean;
  content: string;
  errors: string[];
  extracted: boolean;
} {
  // Step 1: Strip code fences
  let cleaned = stripCodeFences(content);

  // Step 2: Check for failure patterns
  const errors = detectFailurePatterns(cleaned);

  // Step 3: Check if it's valid HTML
  if (isValidHTMLStructure(cleaned) && errors.length === 0) {
    return { valid: true, content: cleaned, errors: [], extracted: false };
  }

  // Step 4: Try to extract HTML from mixed content
  const extracted = extractHTMLFromMixed(cleaned);
  if (extracted && isValidHTMLStructure(extracted)) {
    // Re-check for errors in extracted content
    const extractedErrors = detectFailurePatterns(extracted);
    if (extractedErrors.length === 0) {
      return { valid: true, content: extracted, errors: [], extracted: true };
    }
  }

  // Step 5: Return invalid with errors
  return { valid: false, content: cleaned, errors, extracted: false };
}

/**
 * Validate markdown output from agent (for analysis outputs)
 */
export function validateMarkdownOutput(content: string): {
  valid: boolean;
  content: string;
  errors: string[];
} {
  let cleaned = stripCodeFences(content);
  cleaned = stripPreamble(cleaned);

  const errors: string[] = [];

  // Check for failure patterns
  if (cleaned.toLowerCase().includes('waiting for permission')) {
    errors.push('Contains permission wait message');
  }

  // Markdown should have at least one header
  if (!cleaned.includes('#')) {
    errors.push('Missing markdown headers');
  }

  return {
    valid: errors.length === 0,
    content: cleaned,
    errors
  };
}

/**
 * Correct asset paths in generated HTML based on output directory depth
 * @param html - The HTML content to fix
 * @param depth - Number of directory levels from project root (e.g., 3 for outputs/screens/admin/)
 */
export function correctAssetPaths(html: string, depth: number): string {
  const correctPrefix = '../'.repeat(depth) + 'assets/';

  // Fix various incorrect patterns for src attributes
  const result = html
    .replace(/src="\.\.\/\.\.\/\.\.\/\.\.\/assets\//g, `src="${correctPrefix}`)
    .replace(/src="\.\.\/\.\.\/\.\.\/assets\//g, `src="${correctPrefix}`)
    .replace(/src="\.\.\/\.\.\/assets\//g, `src="${correctPrefix}`)
    .replace(/src="\.\.\/assets\//g, `src="${correctPrefix}`)
    .replace(/src="assets\//g, `src="${correctPrefix}`)
    // Fix href attributes
    .replace(/href="\.\.\/\.\.\/\.\.\/\.\.\/assets\//g, `href="${correctPrefix}`)
    .replace(/href="\.\.\/\.\.\/\.\.\/assets\//g, `href="${correctPrefix}`)
    .replace(/href="\.\.\/\.\.\/assets\//g, `href="${correctPrefix}`)
    .replace(/href="\.\.\/assets\//g, `href="${correctPrefix}`)
    .replace(/href="assets\//g, `href="${correctPrefix}`)
    // Fix url() in CSS
    .replace(/url\(['"]?\.\.\/\.\.\/\.\.\/\.\.\/assets\//g, `url('${correctPrefix}`)
    .replace(/url\(['"]?\.\.\/\.\.\/\.\.\/assets\//g, `url('${correctPrefix}`)
    .replace(/url\(['"]?\.\.\/\.\.\/assets\//g, `url('${correctPrefix}`)
    .replace(/url\(['"]?\.\.\/assets\//g, `url('${correctPrefix}`)
    .replace(/url\(['"]?assets\//g, `url('${correctPrefix}`);

  return result;
}

/**
 * Get default skill for a platform based on naming conventions
 */
export function getDefaultSkillForPlatform(platform: string): string {
  const lower = platform.toLowerCase();
  // Admin/backend platforms default to desktop skill
  if (lower.includes('admin') || lower.includes('backend') || lower.includes('dashboard')) {
    return 'desktop';
  }
  // Mobile platforms default to mobile skill
  if (lower.includes('mobile') || lower.includes('app') || lower.includes('ios') || lower.includes('android')) {
    return 'mobile';
  }
  // Everything else defaults to webapp
  return 'webapp';
}

/**
 * Get output directory name for screens based on platform and skill
 * Returns folder name and depth from project root
 */
export function getScreensOutputInfo(
  platform: string | null,
  skill: string
): { folderName: string; depth: number } {
  // No platform - use base screens directory
  if (!platform) {
    if (skill !== 'webapp') {
      return { folderName: skill, depth: 3 };
    }
    return { folderName: '', depth: 2 }; // outputs/screens/
  }

  // Get default skill for this platform
  const defaultSkill = getDefaultSkillForPlatform(platform);

  if (skill === defaultSkill) {
    // Using default skill - just use platform name
    return { folderName: platform, depth: 3 };
  }

  // Non-default skill - prefix with skill name
  return { folderName: `${skill}-${platform}`, depth: 3 };
}
