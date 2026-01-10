import { mkdir, cp, writeFile, readFile, access, appendFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES = join(__dirname, '..', 'templates');

interface InitOptions {
  noGit?: boolean;
}

/**
 * Check if git is available on the system
 */
function isGitAvailable(): boolean {
  try {
    execSync('git --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a directory is already a git repository
 */
async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await access(join(dir, '.git'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialize git repository in a directory
 */
function initGitRepo(dir: string): boolean {
  try {
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create initial commit in a git repository
 */
function createInitialCommit(dir: string, message: string): boolean {
  try {
    execSync('git add .', { cwd: dir, stdio: 'ignore' });
    execSync(`git commit -m "${message}"`, { cwd: dir, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure root directory has git initialized with projects/ ignored
 */
async function ensureRootGit(rootDir: string): Promise<{ initialized: boolean; ignored: boolean }> {
  const result = { initialized: false, ignored: false };

  if (!isGitAvailable()) {
    return result;
  }

  // Check if root is already a git repo
  const isRepo = await isGitRepo(rootDir);

  if (!isRepo) {
    // Initialize git at root
    if (initGitRepo(rootDir)) {
      result.initialized = true;
    }
  }

  // Ensure projects/ is in .gitignore
  const gitignorePath = join(rootDir, '.gitignore');
  let gitignoreContent = '';

  try {
    gitignoreContent = await readFile(gitignorePath, 'utf-8');
  } catch {
    // .gitignore doesn't exist yet
  }

  // Check if projects/ is already ignored
  if (!gitignoreContent.includes('projects/')) {
    const projectsIgnore = gitignoreContent ? '\n# AgenticFlow projects (separate repos)\nprojects/\n' : '# AgenticFlow projects (separate repos)\nprojects/\n';
    await appendFile(gitignorePath, projectsIgnore);
    result.ignored = true;
  }

  return result;
}

export async function init(name: string, options: InitOptions = {}) {
  const rootDir = process.cwd();
  const projectsDir = join(rootDir, 'projects');
  const projectDir = join(projectsDir, name);

  console.log(`Creating project: ${name}`);

  // Create directory structure
  const dirs = [
    'agents/analyst',
    'agents/ui-designer',
    'skills/analysis',
    'skills/design',
    'commands',
    'assets/wireframes',
    'assets/fonts',
    'assets/icons',
    'assets/logos',
    'outputs/analysis',
    'outputs/flows',
    'outputs/mockups',
    'outputs/stylesheet',
    'outputs/screens'
  ];

  for (const dir of dirs) {
    await mkdir(join(projectDir, dir), { recursive: true });
  }

  // Copy templates
  await cp(join(TEMPLATES, 'agents'), join(projectDir, 'agents'), { recursive: true });
  await cp(join(TEMPLATES, 'skills'), join(projectDir, 'skills'), { recursive: true });
  await cp(join(TEMPLATES, 'commands'), join(projectDir, 'commands'), { recursive: true });
  await cp(join(TEMPLATES, 'CLAUDE.md'), join(projectDir, 'CLAUDE.md'));
  await cp(join(TEMPLATES, 'brief.md'), join(projectDir, 'brief.md'));

  // Copy .gitignore template
  try {
    await cp(join(TEMPLATES, '.gitignore'), join(projectDir, '.gitignore'));
  } catch {
    // .gitignore template may not exist in older versions
  }

  // Copy agentflow config
  try {
    await cp(join(TEMPLATES, 'agentflow.config.json'), join(projectDir, 'agentflow.config.json'));
  } catch {
    // Config template may not exist in older versions
  }

  // Create .gitkeep files
  const gitkeeps = ['assets/wireframes', 'assets/fonts', 'assets/icons', 'assets/logos'];
  for (const dir of gitkeeps) {
    await writeFile(join(projectDir, dir, '.gitkeep'), '');
  }

  // Git initialization
  const gitStatus: string[] = [];

  if (!options.noGit && isGitAvailable()) {
    // Ensure root has git with projects/ ignored
    const rootGit = await ensureRootGit(rootDir);
    if (rootGit.initialized) {
      gitStatus.push('Initialized git repository at root');
    }
    if (rootGit.ignored) {
      gitStatus.push('Added projects/ to root .gitignore');
    }

    // Initialize git in project
    if (initGitRepo(projectDir)) {
      gitStatus.push('Initialized git repository in project');

      // Create initial commit
      if (createInitialCommit(projectDir, 'Initial AgenticFlow project')) {
        gitStatus.push('Created initial commit');
      }
    }
  } else if (options.noGit) {
    gitStatus.push('Git initialization skipped (--no-git)');
  } else {
    gitStatus.push('Git not found - skipping repository initialization');
  }

  // Print status
  const gitInfo = gitStatus.length > 0 ? `\nGit:\n${gitStatus.map(s => `  - ${s}`).join('\n')}` : '';

  console.log(`
Project created: projects/${name}
${gitInfo}
Next steps:
  cd projects/${name}
  1. Edit brief.md with your project requirements
  2. Add wireframes to assets/wireframes/
  3. Run: agentflow analyze
`);
}
