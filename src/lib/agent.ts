import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { join } from 'path';

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  skills: string[];
  model?: 'opus' | 'sonnet' | 'haiku';
  maxTokens?: number;
}

export async function loadAgent(projectDir: string, agentId: string): Promise<AgentConfig> {
  const configPath = join(projectDir, 'agents', agentId, 'agent.json');
  const content = await readFile(configPath, 'utf-8');
  return JSON.parse(content);
}

export async function loadSystemPrompt(projectDir: string, agentId: string): Promise<string> {
  const promptPath = join(projectDir, 'agents', agentId, 'system.md');
  return readFile(promptPath, 'utf-8');
}

export async function loadSkill(projectDir: string, skillPath: string): Promise<string> {
  const fullPath = join(projectDir, 'skills', `${skillPath}.md`);
  return readFile(fullPath, 'utf-8');
}

/**
 * Raw output enforcement wrapper added to system prompts.
 * This ensures Claude outputs content directly instead of using tools or adding commentary.
 */
const RAW_OUTPUT_ENFORCEMENT = `
## CRITICAL OUTPUT RULES

You are running in a pipeline that captures your stdout. You MUST:

1. Output the requested content DIRECTLY - no tool calls, no file writes
2. Start your response IMMEDIATELY with the content (no preamble like "Here's..." or "I've created...")
3. End your response with the content (no postamble like "Let me know..." or summaries)
4. Do NOT wrap output in markdown code fences unless explicitly requested
5. Do NOT describe what you're outputting - just output it

If asked to create HTML: Start with <!DOCTYPE html> and end with </html>
If asked to create markdown: Start with # and output only markdown
If asked to create JSON: Start with { or [ and output only valid JSON

NEVER say "I've created...", "Here's the...", "The file includes...", etc.
NEVER ask for permission or confirmation.
NEVER use Write, Edit, or Bash tools - they are disabled.

Your entire response will be captured and saved as a file. Output ONLY the file content.
`;

/**
 * Raw output enforcement WITH Read tool access.
 * Used when the agent needs to view images/files before generating output.
 */
const RAW_OUTPUT_ENFORCEMENT_WITH_READ = `
## CRITICAL: TWO-PHASE OUTPUT RULES

You are running in a pipeline. You have access to the Read tool for viewing images.

### PHASE 1 - MANDATORY: Read Referenced Files
BEFORE generating any output, you MUST use the Read tool to view ALL referenced images/files.
- Read each wireframe/image file mentioned in the task
- Analyze layouts, components, navigation patterns, and visual structure
- This step is REQUIRED - do not skip it

### PHASE 2 - Generate Output
After reading all files, output the requested content:
1. Start your FINAL output with the content (e.g., <!DOCTYPE html>)
2. End with the content (no postamble)
3. Do NOT wrap output in markdown code fences
4. Do NOT describe what you're outputting

NEVER use Write, Edit, or Bash tools - only Read is available.
Your final response will be captured and saved as a file.
`;

export interface InvokeAgentOptions {
  /** Timeout in milliseconds (default: 5 minutes) */
  timeout?: number;
  /** Whether to add raw output enforcement to system prompt (default: true) */
  enforceRawOutput?: boolean;
  /** Model to use: 'opus', 'sonnet', or 'haiku' (default: 'sonnet') */
  model?: 'opus' | 'sonnet' | 'haiku';
  /** Enable Read tool for image/file access (default: false) */
  allowRead?: boolean;
  /** Additional directories to grant tool access to */
  addDirs?: string[];
}

export async function invokeAgent(
  systemPrompt: string,
  userPrompt: string,
  options: InvokeAgentOptions = {}
): Promise<string> {
  const {
    timeout = 300000,
    enforceRawOutput = true,
    model = 'sonnet',
    allowRead = false,
    addDirs = []
  } = options;

  // Choose enforcement based on whether Read tool is enabled
  const enforcement = allowRead
    ? RAW_OUTPUT_ENFORCEMENT_WITH_READ
    : RAW_OUTPUT_ENFORCEMENT;

  // Add raw output enforcement to system prompt
  const finalSystemPrompt = enforceRawOutput
    ? `${systemPrompt}\n\n${enforcement}`
    : systemPrompt;

  // Build tools argument - enable Read if needed for image access
  const toolsArg = allowRead ? 'Read' : '""';

  // Choose append-system-prompt based on whether Read is enabled
  const appendPrompt = allowRead
    ? 'IMPORTANT: First use the Read tool to view all referenced images, then output the requested content.'
    : 'Output ONLY the requested content. No preamble, no postamble, no explanations. Start immediately with the content.';

  // Build CLI arguments
  const cliArgs = [
    '-p',
    '--model', model,
    '--tools', toolsArg,
    '--append-system-prompt', appendPrompt
  ];

  // Add directory access for each addDir
  for (const dir of addDirs) {
    cliArgs.push('--add-dir', dir);
  }

  return new Promise((resolve, reject) => {
    // Use shell=true for PATH resolution on Windows
    const claude = spawn('claude', cliArgs, {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Include system prompt context in the user prompt for stdin delivery
    const fullPrompt = `## Context\n${finalSystemPrompt}\n\n## Task\n${userPrompt}`;

    let output = '';
    let error = '';
    let timedOut = false;

    // Set up timeout
    const timeoutId = setTimeout(() => {
      timedOut = true;
      claude.kill('SIGTERM');
      reject(new Error(`Claude process timed out after ${timeout}ms`));
    }, timeout);

    claude.stdout.on('data', (data) => { output += data; });
    claude.stderr.on('data', (data) => { error += data; });

    claude.on('close', (code) => {
      clearTimeout(timeoutId);

      if (timedOut) {
        return; // Already rejected
      }

      if (code === 0) {
        resolve(output);
      } else {
        // Include stderr in error for debugging
        const errorMsg = error
          ? `Claude exited with code ${code}: ${error}`
          : `Claude exited with code ${code}`;
        reject(new Error(errorMsg));
      }
    });

    claude.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(new Error(`Failed to spawn Claude: ${err.message}`));
    });

    // Write full prompt (context + task) to stdin and close it
    claude.stdin.write(fullPrompt);
    claude.stdin.end();
  });
}

/**
 * Invoke agent with automatic retry on failure or invalid output.
 */
export async function invokeAgentWithRetry(
  systemPrompt: string,
  userPrompt: string,
  options: InvokeAgentOptions & {
    maxRetries?: number;
    validateOutput?: (output: string) => { valid: boolean; errors: string[] };
  } = {}
): Promise<{ output: string; attempts: number; errors: string[] }> {
  const { maxRetries = 2, validateOutput, ...invokeOptions } = options;
  let lastErrors: string[] = [];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Modify prompt on retry to emphasize the failure
      let prompt = userPrompt;
      if (attempt > 1 && lastErrors.length > 0) {
        prompt = `IMPORTANT: Your previous response was invalid. Errors: ${lastErrors.join('. ')}.\n\nYou MUST output ONLY the requested content. No explanations, no summaries.\n\n${userPrompt}`;
      }

      const output = await invokeAgent(systemPrompt, prompt, invokeOptions);

      // If no validator provided, return output
      if (!validateOutput) {
        return { output, attempts: attempt, errors: [] };
      }

      // Validate output
      const validation = validateOutput(output);
      if (validation.valid) {
        return { output, attempts: attempt, errors: [] };
      }

      // Invalid - store errors and retry
      lastErrors = validation.errors;

    } catch (err) {
      lastErrors = [(err as Error).message];
    }
  }

  // All retries exhausted
  return { output: '', attempts: maxRetries, errors: lastErrors };
}
